
// ── Plugins (W5 — mirror the TUI's Shift+P browser) ────────────────────
// Top-level Plugins route. Sub-routes select a plugin and its sub-views:
//   #/plugins                       → hub
//   #/plugins/crunchr               → transcribed-recordings list + search
//   #/plugins/crunchr/rec/<id>      → transcript + analysis
//   #/plugins/archiver              → archived channels
//   #/plugins/archiver/<channelId>  → channel catalog
//   #/plugins/viewguard             → fraud verdicts
//   #/plugins/insights              → word freq / topics / speakers
// Chat client route — Twitch IRC over anonymous WSS, multi-tab Chatterino-
// style layout. The room list comes from the backend (followed Twitch
// channels live first); each active tab opens its own WS that auto-
// reconnects on close. Filter chips run client-side via the same logic
// shape the host's strivo-chat crate uses.
const chatState = {
  rooms: [],
  active: null,           // active room name (Twitch login)
  buffers: {},            // room → { messages: [], unread, mentions, watched_user }
  sockets: {},            // room → WebSocket
  filters: [],            // [{ kind, needle?, user? }]
  watched_user: null,     // your own twitch login if known (mention highlight)
  paint_timer: null,
};
const CHAT_TWITCH_WS = "wss://irc-ws.chat.twitch.tv:443";
const CHAT_ANON_NICK = () => `justinfan${Math.floor(10000 + Math.random() * 89999)}`;
const CHAT_BUFFER_CAP = 500;

// Chat-paint fan-out. Each visible chat surface (the /chat route's body,
// the player view's right-rail) registers a painter so a single
// schedulePaintChat() updates every surface that's currently mounted.
// `mountedChatRooms` gates the route-leave socket teardown — a room
// still referenced by a painter (e.g. the rail open over /library)
// survives navigation.
const chatPaintListeners = new Set();
const mountedChatRooms = new Set();
function registerChatPainter(fn) {
  chatPaintListeners.add(fn);
  return () => chatPaintListeners.delete(fn);
}
function trackMountedChatRoom(room) {
  mountedChatRooms.add(room);
  return () => mountedChatRooms.delete(room);
}

// Persisted UI state for the /chat tabs panel collapse.
const CHAT_TABS_COLLAPSED_KEY = "strivo-chat-tabs-collapsed";
function loadChatTabsCollapsed() {
  try { return localStorage.getItem(CHAT_TABS_COLLAPSED_KEY) === "1"; } catch (_) { return false; }
}
function saveChatTabsCollapsed(v) {
  try { localStorage.setItem(CHAT_TABS_COLLAPSED_KEY, v ? "1" : "0"); } catch (_) {}
}

function chatPushMsg(room, msg) {
  const buf = chatState.buffers[room] ||= { messages: [], unread: 0, mentions: 0 };
  if (buf.messages.length >= CHAT_BUFFER_CAP) buf.messages.shift();
  buf.messages.push(msg);
  buf.unread += 1;
  if (chatState.watched_user && msgMentionsUser(msg.text, chatState.watched_user)) {
    buf.mentions += 1;
  }
  schedulePaintChat();
}
function msgMentionsUser(text, user) {
  const target = user.replace(/^@/, "").toLowerCase();
  return text.split(/\s+/).some((w) => {
    const cleaned = w.replace(/[.,!?]+$/, "");
    return cleaned.startsWith("@") && cleaned.slice(1).toLowerCase() === target;
  });
}
function schedulePaintChat() {
  if (chatState.paint_timer) return;
  chatState.paint_timer = setTimeout(() => {
    chatState.paint_timer = null;
    // Fan out to every registered chat surface. The /chat route + the
    // player rail each install their own painter so the firehose
    // updates both simultaneously.
    for (const fn of chatPaintListeners) {
      try { fn(); } catch (_) {}
    }
    // Backwards-compat: a /chat route mounted without registering a
    // painter (legacy code path) still gets its body painted directly.
    if (chatPaintListeners.size === 0 && document.getElementById("chat-body")) {
      try { paintChatBody(); } catch (_) {}
    }
  }, 50);
}
// Minimal client-side mirror of strivo-chat's parse_twitch_irc. We could
// round-trip through /plugins/chat/parse to use the host parser, but the
// WS firehose is high-rate and adding network latency per line would lag
// the live feed. Keep parity by reusing the host parser in batched
// previews (e.g. filter test on the recent buffer).
function parseTwitchIrc(line) {
  let rest = line.replace(/[\r\n]+$/, "");
  let tags = {};
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    if (sp < 0) return null;
    const raw = rest.slice(1, sp);
    for (const pair of raw.split(";")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      tags[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    rest = rest.slice(sp + 1);
  }
  if (!rest.startsWith(":")) return null;
  const sp1 = rest.indexOf(" ");
  if (sp1 < 0) return null;
  const prefix = rest.slice(1, sp1);
  const sender = prefix.split("!")[0];
  rest = rest.slice(sp1 + 1);
  const sp2 = rest.indexOf(" ");
  if (sp2 < 0) return null;
  const verb = rest.slice(0, sp2);
  if (verb !== "PRIVMSG") return null;
  rest = rest.slice(sp2 + 1);
  const colon = rest.indexOf(" :");
  if (colon < 0) return null;
  const channel = rest.slice(0, colon).replace(/^#/, "");
  let text = rest.slice(colon + 2);
  let is_action = false;
  // Twitch wraps /me as CTCP \x01ACTION text\x01.
  const CTCP = String.fromCharCode(1);
  if (text.startsWith(CTCP) && text.endsWith(CTCP)) text = text.slice(1, -1);
  if (text.startsWith("ACTION ")) {
    text = text.slice("ACTION ".length);
    is_action = true;
  }
  // Badges with versions: 'subscriber/12,vip/1' → [{id:'subscriber',v:'12'},…]
  const badges = (tags["badges"] || "")
    .split(",")
    .filter(Boolean)
    .map((b) => {
      const [id, v] = b.split("/");
      return { id, version: v || "1" };
    });
  // Twitch native emote ranges: 'emote_id:start-end,start-end/emote_id:…'.
  // Parsed client-side mirroring strivo-chat::parse_twitch_emotes; the SPA
  // can't round-trip through the host parser cheaply on the live firehose.
  const emote_ranges = parseTwitchEmotes(tags["emotes"] || "");
  return {
    id: tags["id"] || `${channel}-${tags["tmi-sent-ts"] || Date.now()}`,
    room: channel,
    sender: tags["display-name"]?.replace(/\\s/g, " ") || sender,
    sender_color: tags["color"] || null,
    text,
    timestamp_ms: parseInt(tags["tmi-sent-ts"] || "0", 10),
    badges,
    emote_ranges,
    is_action,
    is_system: false,
    deleted: false,
  };
}

function parseTwitchEmotes(raw) {
  if (!raw) return [];
  const out = [];
  for (const group of raw.split("/")) {
    const colon = group.indexOf(":");
    if (colon < 0) continue;
    const id = group.slice(0, colon);
    for (const run of group.slice(colon + 1).split(",")) {
      const dash = run.indexOf("-");
      if (dash < 0) continue;
      const s = parseInt(run.slice(0, dash), 10);
      const e = parseInt(run.slice(dash + 1), 10);
      if (!isFinite(s) || !isFinite(e) || e < s) continue;
      out.push({ id, start: s, end: e });
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

// BTTV global emotes — fetched once per session, keyed by emote code so
// the per-message tokenizer can substitute them inline. We don't pull
// channel-scoped BTTV/FFZ here (that needs the Twitch user id resolved
// at chat-join time; a future iter).
const bttvCache = { ready: false, map: new Map() };
async function ensureBttvGlobal() {
  if (bttvCache.ready) return bttvCache.map;
  try {
    const r = await fetch("https://api.betterttv.net/3/cached/emotes/global");
    if (!r.ok) throw new Error("bttv fetch failed");
    const list = await r.json();
    for (const e of list) {
      bttvCache.map.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/1x`);
    }
  } catch (_) { /* graceful: chat works without BTTV */ }
  bttvCache.ready = true;
  return bttvCache.map;
}

// FFZ global emotes — same shape as BTTV. Endpoint:
// https://api.frankerfacez.com/v1/set/global
const ffzCache = { ready: false, map: new Map() };
async function ensureFfzGlobal() {
  if (ffzCache.ready) return ffzCache.map;
  try {
    const r = await fetch("https://api.frankerfacez.com/v1/set/global");
    if (!r.ok) throw new Error("ffz fetch failed");
    const j = await r.json();
    for (const setId of j.default_sets || []) {
      const set = (j.sets || {})[setId];
      if (!set) continue;
      for (const e of set.emoticons || []) {
        const url = (e.urls && (e.urls["1"] || e.urls["2"])) || "";
        if (url) {
          // FFZ urls are scheme-relative — coerce to https.
          const full = url.startsWith("//") ? `https:${url}` : url;
          ffzCache.map.set(e.name, full);
        }
      }
    }
  } catch (_) { /* graceful */ }
  ffzCache.ready = true;
  return ffzCache.map;
}

// 7TV global emotes. Endpoint: https://7tv.io/v3/emote-sets/global
const seventvCache = { ready: false, map: new Map() };
async function ensureSeventvGlobal() {
  if (seventvCache.ready) return seventvCache.map;
  try {
    const r = await fetch("https://7tv.io/v3/emote-sets/global");
    if (!r.ok) throw new Error("7tv fetch failed");
    const j = await r.json();
    for (const e of j.emotes || []) {
      const host = e.data?.host;
      if (!host) continue;
      // Prefer the smallest WebP for chat density. host.url is
      // scheme-relative.
      const file = (host.files || []).find((f) => f.name === "1x.webp")
        || (host.files || [])[0];
      if (!file) continue;
      const base = host.url.startsWith("//") ? `https:${host.url}` : host.url;
      seventvCache.map.set(e.name, `${base}/${file.name}`);
    }
  } catch (_) { /* graceful */ }
  seventvCache.ready = true;
  return seventvCache.map;
}

// Merge global third-party emote maps into one EmoteMap-shape Map.
// Precedence: Twitch native (in-message ranges) > BTTV > FFZ > 7TV.
async function ensureThirdPartyEmotes() {
  const [bttv, ffz, stv] = await Promise.all([
    ensureBttvGlobal(),
    ensureFfzGlobal(),
    ensureSeventvGlobal(),
  ]);
  const merged = new Map();
  // Lowest precedence first — later sets overwrite earlier ones.
  for (const [k, v] of stv.entries()) merged.set(k, v);
  for (const [k, v] of ffz.entries()) merged.set(k, v);
  for (const [k, v] of bttv.entries()) merged.set(k, v);
  return merged;
}

function connectChatRoom(room) {
  if (chatState.sockets[room]) return;
  // Kick off per-channel third-party fetches in the background —
  // channel-scoped emotes + sub badges. By the time the first PRIVMSG
  // arrives the caches are usually warm; the tokenizer falls back to
  // globals if not.
  const meta = (chatState.rooms || []).find((r) => r.room === room);
  if (meta?.user_id) {
    ensureChannelEmotes(meta.user_id).then(() => schedulePaintChat());
    ensureChannelBadges(meta.user_id).then(() => schedulePaintChat());
  }
  const ws = new WebSocket(CHAT_TWITCH_WS);
  chatState.sockets[room] = ws;
  ws.onopen = () => {
    ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
    ws.send(`NICK ${CHAT_ANON_NICK()}`);
    ws.send(`JOIN #${room.toLowerCase()}`);
  };
  ws.onmessage = (ev) => {
    for (const line of ev.data.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith("PING ")) {
        try { ws.send(line.replace("PING", "PONG")); } catch (_) {}
        continue;
      }
      const m = parseTwitchIrc(line);
      if (m) chatPushMsg(room, m);
    }
  };
  ws.onclose = () => {
    delete chatState.sockets[room];
    // Auto-reconnect with backoff if room is still active.
    if (chatState.active === room) {
      setTimeout(() => connectChatRoom(room), 2500);
    }
  };
  ws.onerror = () => {
    try { ws.close(); } catch (_) {}
  };
}
function disconnectChatRoom(room) {
  const ws = chatState.sockets[room];
  if (ws) try { ws.close(); } catch (_) {}
  delete chatState.sockets[room];
}

function chatRoomMatchesFilters(msg) {
  for (const f of chatState.filters) {
    switch (f.kind) {
      case "keyword_in":
        if (!msg.text.toLowerCase().includes((f.needle || "").toLowerCase())) return false;
        break;
      case "keyword_out":
        if (msg.text.toLowerCase().includes((f.needle || "").toLowerCase())) return false;
        break;
      case "from_user":
        if (msg.sender.toLowerCase() !== (f.user || "").toLowerCase()) return false;
        break;
      case "no_links":
        if (msg.text.includes("http://") || msg.text.includes("https://")) return false;
        break;
      case "no_actions":
        if (msg.is_action) return false;
        break;
      case "mentions_user":
        if (!msgMentionsUser(msg.text, f.user || "")) return false;
        break;
    }
  }
  return true;
}

// Build the HTML for a single message — factored out so both the
// full-repaint and the append-only-diff path can call into it.
function chatMsgHtml(m) {
  const cls = `chat-msg${m.deleted ? " deleted" : ""}${m.is_action ? " action" : ""}`;
  const senderCol = m.sender_color ? `style="color:${htmlEscape(m.sender_color)}"` : "";
  const badges = renderChatBadges(m.badges || [], m.room);
  const tokens = renderChatTokens(m.text, m.emote_ranges || [], m.room);
  const mentioned = chatState.watched_user && msgMentionsUser(m.text, chatState.watched_user)
    ? " mentioned" : "";
  // data-mid lets the diff renderer map back from DOM to message
  // id without re-running filter logic on every repaint.
  return `<div class="${cls}${mentioned}" data-mid="${htmlEscape(m.id)}">
    ${badges}<span class="chat-sender" ${senderCol}>${htmlEscape(m.sender)}</span><span class="chat-sep">:</span> <span class="chat-text">${tokens}</span>
  </div>`;
}

// Mount a chat surface for `room` (Twitch login) into `parentBody`.
// Owns one connection's worth of paint lifecycle for the player rail.
// Reuses the global chatState buffers/sockets — multiple surfaces of
// the same room share the same firehose. Returns { teardown }.
function mountChatRail(parentBody, room) {
  if (!parentBody || !room) return { teardown() {} };
  parentBody.innerHTML = "";
  parentBody.dataset.room = room;

  // Warm caches in the background — chatMsgHtml's badge/emote
  // resolvers will rehydrate once these land.
  ensureGlobalBadges().then(() => schedulePaintChat());
  ensureThirdPartyEmotes().then(() => schedulePaintChat());
  const meta = (chatState.rooms || []).find((r) => r.room === room);
  if (meta?.user_id) {
    ensureChannelEmotes(meta.user_id).then(() => schedulePaintChat());
    ensureChannelBadges(meta.user_id).then(() => schedulePaintChat());
  }

  connectChatRoom(room);
  const unmountRoom = trackMountedChatRoom(room);

  // Mark this room as read while it's actively painted on the rail —
  // tab badges in /chat shouldn't count messages the user is already
  // staring at.
  if (chatState.buffers[room]) {
    chatState.buffers[room].unread = 0;
    chatState.buffers[room].mentions = 0;
  }

  const paint = () => {
    if (!parentBody.isConnected) return;
    const buf = chatState.buffers[room] || { messages: [] };
    const wasAtBottom = parentBody.scrollHeight - parentBody.scrollTop - parentBody.clientHeight < 80;
    const visible = buf.messages.filter(chatRoomMatchesFilters).slice(-200);
    const seen = new Set();
    for (const node of parentBody.children) {
      const id = node.dataset.mid;
      if (id) seen.add(id);
    }
    const fragments = [];
    for (const m of visible) {
      if (!seen.has(m.id)) fragments.push(chatMsgHtml(m));
    }
    if (fragments.length) {
      parentBody.insertAdjacentHTML("beforeend", fragments.join(""));
    }
    while (parentBody.childElementCount > visible.length) {
      parentBody.removeChild(parentBody.firstElementChild);
    }
    if (wasAtBottom) parentBody.scrollTop = parentBody.scrollHeight;
  };
  paint(); // initial
  const unsubPaint = registerChatPainter(paint);
  return {
    teardown() {
      unsubPaint();
      unmountRoom();
      // If no other surface still wants this room, drop the socket.
      // The /chat route's active room is exempt — it owns its own
      // reconnect loop and we don't want to fight it.
      if (!mountedChatRooms.has(room) && chatState.active !== room) {
        try { disconnectChatRoom(room); } catch (_) {}
        delete chatState.buffers[room];
      }
    },
  };
}

// Curated unicode emoji palette for the compose-bar's Emoji tab. Trimmed
// to the most-used per category — full Unicode CLDR is 3000+ glyphs which
// blows up the popup. Users typing Twitch chat reach for these the most.
const UNICODE_EMOJI_CATEGORIES = [
  { key: "smileys", label: "😀", title: "Smileys", emoji: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","😎","🤓","🧐","😕","😟","🙁","☹","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠","💩","🤡","👹","👺","👻","👽","👾","🤖"] },
  { key: "gestures", label: "👋", title: "People & Gestures", emoji: ["👋","🤚","🖐","✋","🖖","👌","🤌","🤏","✌","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","💪","🦾","🤳","💅","🤴","👸","🧑","👤","👥","👶","🧒","👦","👧","🧓","👴","👵"] },
  { key: "animals", label: "🐶", title: "Animals & Nature", emoji: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🪳","🪰","🪲","🐢","🐍","🦎","🦂","🦀","🦑","🐙","🦐","🐠","🐟","🐡","🐬","🦈","🐳","🐋","🐊","🐅","🐆","🦓","🦍","🦧","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐈","🐓","🦃","🦚","🦜","🦢","🦩","🕊","🐇","🦝","🦨","🦡","🦦","🦥","🐁","🐀","🌲","🌳","🌴","🌱","🌵","🌾","🌿","☘","🍀","🍁","🍂","🍃","🌷","🌹","🥀","🌺","🌸","🌼","🌻","🌞","🌝","🌛","🌜","🌚","🌕","🌖","🌗","🌘","🌑","🌒","🌓","🌔","🌙","🌎","🌍","🌏","🪐","💫","⭐","🌟","✨","⚡","☄","💥","🔥","🌪","🌈","☀","🌤","⛅","🌥","🌦","🌧","⛈","🌩","🌨","❄","☃","⛄","🌬","💨","💧","💦","☔","☂","🌊","🌫"] },
  { key: "food", label: "🍔", title: "Food & Drink", emoji: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶","🫑","🌽","🥕","🧄","🧅","🥔","🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🦴","🌭","🍔","🍟","🍕","🥪","🥙","🧆","🌮","🌯","🫔","🥗","🥘","🫕","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","☕","🫖","🍵","🍶","🍾","🍷","🍸","🍹","🍺","🍻","🥂","🥃","🥤","🧋","🧃","🧉","🧊"] },
  { key: "activities", label: "⚽", title: "Activities", emoji: ["⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍","🏏","🪃","🥅","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸","🥌","🎿","⛷","🏂","🪂","🏋","🤼","🤸","⛹","🤺","🤾","🏌","🏇","🧘","🏄","🏊","🤽","🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎖","🏵","🎗","🎫","🎟","🎪","🤹","🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷","🎺","🪗","🎸","🪕","🎻","🎲","♟","🎯","🎳","🎮","🎰","🧩"] },
  { key: "objects", label: "💻", title: "Objects", emoji: ["⌚","📱","📲","💻","⌨","🖥","🖨","🖱","🖲","🕹","🗜","💽","💾","💿","📀","📼","📷","📸","📹","🎥","📽","🎞","📞","☎","📟","📠","📺","📻","🎙","🎚","🎛","🧭","⏱","⏲","⏰","🕰","⌛","⏳","📡","🔋","🔌","💡","🔦","🕯","🪔","🧯","🛢","💸","💵","💴","💶","💷","🪙","💰","💳","💎","⚖","🪜","🧰","🪛","🔧","🔨","⚒","🛠","⛏","🪚","🔩","⚙","🪤","🧱","⛓","🧲","🔫","💣","🧨","🪓","🔪","🗡","⚔","🛡","🚬","⚰","🪦","⚱","🏺","🔮","📿","🧿","💈","⚗","🔭","🔬","🕳","🩹","🩺","💊","💉","🩸","🧬","🦠","🧫","🧪","🌡","🧹","🪠","🧺","🧻","🚽","🚰","🚿","🛁","🛀","🧼","🪥","🪒","🧽","🪣","🧴","🛎","🔑","🗝","🚪","🪑","🛋","🛏","🛌","🧸","🪆","🖼","🪞","🪟","🛍","🛒","🎁","🎈","🎏","🎀","🪄","🪅","🎊","🎉","🎎","🏮","🎐","🧧","✉","📩","📨","📧","💌","📥","📤","📦","🏷","🪧","📪","📫","📬","📭","📮","📯","📜","📃","📄","📑","🧾","📊","📈","📉","🗒","🗓","📆","📅","🗑","📇","🗃","🗳","🗄","📋","📁","📂","🗂","🗞","📰","📓","📔","📒","📕","📗","📘","📙","📚","📖","🔖","🧷","🔗","📎","🖇","📐","📏","🧮","📌","📍","✂","🖊","🖋","✒","🖌","🖍","📝","✏","🔍","🔎","🔏","🔐","🔒","🔓"] },
  { key: "symbols", label: "❤", title: "Symbols", emoji: ["❤","🧡","💛","💚","💙","💜","🤎","🖤","🤍","💔","❣","💕","💞","💓","💗","💖","💘","💝","💟","☮","✝","☪","🕉","☸","✡","🔯","🕎","☯","☦","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛","🉑","☢","☣","📴","📳","🈶","🈚","🈸","🈺","🈷","✴","🆚","💮","🉐","㊙","㊗","🈴","🈵","🈹","🈲","🅰","🅱","🆎","🆑","🅾","🆘","❌","⭕","🛑","⛔","📛","🚫","💯","💢","♨","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗","❕","❓","❔","‼","⁉","🔅","🔆","〽","⚠","🚸","🔱","⚜","🔰","♻","✅","🈯","💹","❇","✳","❎","🌐","💠","Ⓜ","🌀","💤","🏧","🚾","♿","🅿","🛗","🈳","🈂","🛂","🛃","🛄","🛅","🚹","🚺","🚼","⚧","🚻","🚮","🎦","📶","🈁","🔣","ℹ","🔤","🔡","🔠","🆖","🆗","🆙","🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🔢","#️⃣","*️⃣","⏏","▶","⏸","⏯","⏹","⏺","⏭","⏮","⏩","⏪","⏫","⏬","◀","🔼","🔽","➡","⬅","⬆","⬇","↗","↘","↙","↖","↕","↔","↪","↩","⤴","⤵","🔀","🔁","🔂","🔄","🔃","🎵","🎶","➕","➖","➗","✖","♾","💲","💱","™","©","®","〰","➰","➿","🔚","🔙","🔛","🔝","🔜","✔","☑","🔘","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔺","🔻","🔸","🔹","🔶","🔷","🔳","🔲","▪","▫","◾","◽","◼","◻","⬛","⬜","🟥","🟧","🟨","🟩","🟦","🟪","🟫","🔈","🔇","🔉","🔊","🔔","🔕","📣","📢","💬","💭","🗯","♠","♣","♥","♦","🃏","🎴","🀄","🕐","🕑","🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛","🕜","🕝","🕞","🕟","🕠","🕡","🕢","🕣","🕤","🕥","🕦","🕧"] },
];

// Slash-command quick-pick for the compose bar. Twitch-flavoured today;
// the YouTube path is moderator-only and goes through the Live Chat
// Messages API (separate plumbing), so we surface the same labels and
// let the backend route or reject based on platform.
const CHAT_SLASH_COMMANDS = [
  { cmd: "/me ", label: "/me", hint: "Italicized action message" },
  { cmd: "/announce ", label: "/announce", hint: "Channel announcement (mods)" },
  { cmd: "/timeout ", label: "/timeout", hint: "/timeout <user> <secs> [reason]" },
  { cmd: "/ban ", label: "/ban", hint: "/ban <user> [reason]" },
  { cmd: "/unban ", label: "/unban", hint: "/unban <user>" },
  { cmd: "/mod ", label: "/mod", hint: "/mod <user>" },
  { cmd: "/unmod ", label: "/unmod", hint: "/unmod <user>" },
  { cmd: "/vip ", label: "/vip", hint: "/vip <user>" },
  { cmd: "/unvip ", label: "/unvip", hint: "/unvip <user>" },
  { cmd: "/clear", label: "/clear", hint: "Clear chat (mods)" },
  { cmd: "/slow ", label: "/slow", hint: "/slow <secs>" },
  { cmd: "/slowoff", label: "/slowoff", hint: "Disable slow mode" },
  { cmd: "/subscribers", label: "/subscribers", hint: "Subs-only mode on" },
  { cmd: "/subscribersoff", label: "/subscribersoff", hint: "Subs-only mode off" },
  { cmd: "/emoteonly", label: "/emoteonly", hint: "Emote-only mode on" },
  { cmd: "/emoteonlyoff", label: "/emoteonlyoff", hint: "Emote-only mode off" },
  { cmd: "/followers ", label: "/followers", hint: "/followers <duration>" },
  { cmd: "/followersoff", label: "/followersoff", hint: "Disable followers-only" },
  { cmd: "/raid ", label: "/raid", hint: "/raid <channel>" },
  { cmd: "/unraid", label: "/unraid", hint: "Cancel raid" },
  { cmd: "/shoutout ", label: "/shoutout", hint: "/shoutout <user>" },
  { cmd: "/color ", label: "/color", hint: "/color <hex|name>" },
];

// Chatterino-style compose bar. Owns its textarea, emote palette, slash-
// command menu, char counter, send button. Per-platform accent driven by
// the `data-platform` attribute on the root element — Twitch purple,
// YouTube red, Patreon coral, all swap when setRoom() is called with a
// new (room, platform) pair. Returns a controller object.
function mountChatCompose(parent, opts = {}) {
  if (!parent) return { setRoom() {}, teardown() {} };
  const root = document.createElement("div");
  root.className = "chat-compose-bar";
  root.dataset.platform = opts.platform || "none";
  root.dataset.compact = opts.compact ? "1" : "0";
  root.innerHTML = `
    <div class="cc-popup cc-emote-popup" hidden>
      <div class="cc-popup-tabs" role="tablist">
        <button class="cc-popup-tab active" data-tab="channel" type="button" title="Channel emotes (BTTV / FFZ / 7TV)">⭐</button>
        <button class="cc-popup-tab" data-tab="global" type="button" title="Global emotes">🌐</button>
        <button class="cc-popup-tab" data-tab="emoji" type="button" title="Unicode emoji">😀</button>
      </div>
      <div class="cc-popup-search">
        <input type="text" class="cc-emote-search" placeholder="Search emotes…" autocomplete="off" />
      </div>
      <div class="cc-popup-body cc-emote-body" role="listbox"></div>
    </div>
    <div class="cc-popup cc-cmd-popup" hidden>
      <div class="cc-popup-search">
        <input type="text" class="cc-cmd-search" placeholder="Filter commands…" autocomplete="off" />
      </div>
      <div class="cc-popup-body cc-cmd-body" role="listbox"></div>
    </div>
    <div class="cc-row">
      <button class="cc-tool cc-emote-btn" type="button" title="Emotes (Ctrl+E)" aria-label="Open emote palette" aria-haspopup="true">😀</button>
      <button class="cc-tool cc-cmd-btn" type="button" title="Slash commands (Ctrl+/)" aria-label="Open commands" aria-haspopup="true">/</button>
      <textarea class="cc-input" rows="1" maxlength="500"
                placeholder="${opts.placeholderRoom ? `Send a message to #${opts.placeholderRoom}` : "Send a message…"}"
                aria-label="Chat message"></textarea>
      <div class="cc-meta">
        <span class="cc-count" aria-live="polite">0</span>
        <button class="cc-send" type="button" title="Send (Enter)" aria-label="Send message">▶</button>
      </div>
    </div>
    <span class="cc-hint pg-cap-hint" aria-live="polite"></span>
  `;
  parent.appendChild(root);

  const input = root.querySelector(".cc-input");
  const sendBtn = root.querySelector(".cc-send");
  const count = root.querySelector(".cc-count");
  const hint = root.querySelector(".cc-hint");
  const emoteBtn = root.querySelector(".cc-emote-btn");
  const cmdBtn = root.querySelector(".cc-cmd-btn");
  const emotePop = root.querySelector(".cc-emote-popup");
  const cmdPop = root.querySelector(".cc-cmd-popup");
  const emoteBody = root.querySelector(".cc-emote-body");
  const emoteSearch = root.querySelector(".cc-emote-search");
  const cmdBody = root.querySelector(".cc-cmd-body");
  const cmdSearch = root.querySelector(".cc-cmd-search");
  const emoteTabs = root.querySelectorAll(".cc-popup-tab");

  let currentRoom = opts.room || null;
  let currentPlatform = opts.platform || "none";
  let activeEmoteTab = "channel";
  const channelEmoteMap = new Map(); // populated on setRoom
  const globalEmoteMap = new Map();  // populated lazily

  // Char counter & textarea auto-grow.
  const updateCount = () => {
    const n = input.value.length;
    count.textContent = String(n);
    count.classList.toggle("near-cap", n > 400);
    count.classList.toggle("at-cap", n >= 500);
  };
  const autogrow = () => {
    input.style.height = "auto";
    // Cap at ~6 lines so the rail compose doesn't crowd the messages.
    const max = root.dataset.compact === "1" ? 100 : 160;
    input.style.height = `${Math.min(max, input.scrollHeight)}px`;
  };
  const insertAtCursor = (text) => {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    // Pad with spaces if the surroundings aren't whitespace, so emote
    // codes are sliced cleanly by Twitch's parser.
    const padBefore = before && !/\s$/.test(before) ? " " : "";
    const padAfter = after && !/^\s/.test(after) ? " " : "";
    input.value = `${before}${padBefore}${text}${padAfter}${after}`;
    const caret = before.length + padBefore.length + text.length + padAfter.length;
    input.setSelectionRange(caret, caret);
    input.focus();
    updateCount();
    autogrow();
  };

  // Send.
  const submit = async () => {
    const text = input.value.trim();
    if (!text || !currentRoom) {
      hint.textContent = currentRoom ? "Empty message" : "No room selected";
      return;
    }
    sendBtn.disabled = true;
    try {
      await API.chatSend(currentRoom, text);
      input.value = "";
      updateCount();
      autogrow();
      hint.textContent = "";
    } catch (err) {
      hint.textContent = (err && err.message) || "Send failed";
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  };
  sendBtn.addEventListener("click", submit);
  input.addEventListener("input", () => { updateCount(); autogrow(); });
  input.addEventListener("keydown", (e) => {
    // Enter sends; Shift+Enter inserts newline. Familiar everywhere.
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      submit();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
      e.preventDefault();
      togglePopup(emotePop, emoteBtn);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      togglePopup(cmdPop, cmdBtn);
    } else if (e.key === "Escape") {
      hidePopup(emotePop, emoteBtn);
      hidePopup(cmdPop, cmdBtn);
    }
  });

  // Popup helpers — one popup open at a time; outside-click closes both.
  const showPopup = (pop, btn) => {
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    // Hide the other popup if open.
    const other = pop === emotePop ? cmdPop : emotePop;
    const otherBtn = pop === emotePop ? cmdBtn : emoteBtn;
    hidePopup(other, otherBtn);
    if (pop === emotePop) {
      renderEmoteBody();
      setTimeout(() => emoteSearch.focus(), 0);
    } else {
      renderCmdBody();
      setTimeout(() => cmdSearch.focus(), 0);
    }
  };
  const hidePopup = (pop, btn) => {
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  const togglePopup = (pop, btn) => {
    if (pop.hidden) showPopup(pop, btn);
    else { hidePopup(pop, btn); input.focus(); }
  };
  emoteBtn.addEventListener("click", () => togglePopup(emotePop, emoteBtn));
  cmdBtn.addEventListener("click", () => togglePopup(cmdPop, cmdBtn));
  const onDocClick = (e) => {
    if (!root.contains(e.target)) {
      hidePopup(emotePop, emoteBtn);
      hidePopup(cmdPop, cmdBtn);
    }
  };
  document.addEventListener("click", onDocClick);

  // Emote-popup tab switching.
  emoteTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      emoteTabs.forEach((t) => t.classList.toggle("active", t === tab));
      activeEmoteTab = tab.dataset.tab;
      renderEmoteBody();
    });
  });
  emoteSearch.addEventListener("input", renderEmoteBody);

  function renderEmoteBody() {
    const q = (emoteSearch.value || "").trim().toLowerCase();
    const items = [];
    if (activeEmoteTab === "channel") {
      for (const [code, url] of channelEmoteMap.entries()) {
        if (!q || code.toLowerCase().includes(q)) {
          items.push({ code, url, label: code });
        }
      }
      if (items.length === 0 && !q) {
        emoteBody.innerHTML = `<div class="cc-popup-empty pg-cap-hint">
          ${currentRoom ? "No channel emotes — BTTV / FFZ / 7TV haven't returned yet, or this channel has none." : "Pick a stream to load channel emotes."}
        </div>`;
        return;
      }
    } else if (activeEmoteTab === "global") {
      for (const [code, url] of globalEmoteMap.entries()) {
        if (!q || code.toLowerCase().includes(q)) {
          items.push({ code, url, label: code });
        }
      }
    } else {
      // Unicode emoji tab.
      const inSearch = q.length > 0;
      for (const cat of UNICODE_EMOJI_CATEGORIES) {
        for (const e of cat.emoji) {
          if (!inSearch || cat.title.toLowerCase().includes(q)) {
            items.push({ code: e, url: null, label: cat.title });
          }
        }
      }
    }
    items.sort((a, b) => a.code.localeCompare(b.code));
    if (items.length > 240) items.length = 240; // sane cap for popup grid
    emoteBody.innerHTML = items.map((it) => {
      if (it.url) {
        return `<button class="cc-emote-cell" type="button" data-insert="${htmlEscape(it.code)}" title="${htmlEscape(it.code)}">
          <img loading="lazy" src="${htmlEscape(it.url)}" alt="${htmlEscape(it.code)}"></button>`;
      }
      return `<button class="cc-emote-cell cc-emoji-cell" type="button" data-insert="${htmlEscape(it.code)}" title="${htmlEscape(it.label)}">${it.code}</button>`;
    }).join("");
    emoteBody.querySelectorAll(".cc-emote-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        insertAtCursor(cell.dataset.insert);
      });
    });
  }

  cmdSearch.addEventListener("input", renderCmdBody);
  function renderCmdBody() {
    const q = (cmdSearch.value || "").trim().toLowerCase();
    const items = CHAT_SLASH_COMMANDS.filter((c) =>
      !q || c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q),
    );
    cmdBody.innerHTML = items.map((c) => `
      <button class="cc-cmd-cell" type="button" data-cmd="${htmlEscape(c.cmd)}">
        <span class="cc-cmd-label">${htmlEscape(c.label)}</span>
        <span class="cc-cmd-hint pg-cap-hint">${htmlEscape(c.hint)}</span>
      </button>`).join("");
    cmdBody.querySelectorAll(".cc-cmd-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        // Replace any leading slash command on the line with this one,
        // else insert at the start.
        const cur = input.value;
        const lineStart = cur.lastIndexOf("\n") + 1;
        const head = cur.slice(0, lineStart);
        const tail = cur.slice(lineStart);
        const cleaned = tail.replace(/^\/\S*\s*/, "");
        input.value = `${head}${cell.dataset.cmd}${cleaned}`;
        input.focus();
        const pos = head.length + cell.dataset.cmd.length;
        input.setSelectionRange(pos, pos);
        hidePopup(cmdPop, cmdBtn);
        updateCount();
        autogrow();
      });
    });
  }

  // setRoom — swap room / platform; refresh palette caches.
  async function setRoom(room, platform) {
    currentRoom = room || null;
    currentPlatform = (platform || "none").toLowerCase();
    root.dataset.platform = currentPlatform;
    input.placeholder = room ? `Send a message to #${room}` : "Send a message…";
    input.disabled = !room;
    sendBtn.disabled = !room;
    channelEmoteMap.clear();
    if (!room) {
      renderEmoteBody();
      return;
    }
    // Prime the global emote map once; persist across room swaps.
    if (globalEmoteMap.size === 0) {
      try {
        const m = await ensureThirdPartyEmotes();
        for (const [k, v] of m.entries()) globalEmoteMap.set(k, v);
      } catch (_) {}
    }
    // Per-channel BTTV/FFZ/7TV.
    const meta = (chatState.rooms || []).find((r) => r.room === room);
    if (meta?.user_id) {
      try {
        const m = await ensureChannelEmotes(meta.user_id);
        for (const [k, v] of m.entries()) channelEmoteMap.set(k, v);
      } catch (_) {}
    }
    renderEmoteBody();
  }

  // Initial state.
  updateCount();
  autogrow();
  if (currentRoom) setRoom(currentRoom, currentPlatform);
  else { input.disabled = true; sendBtn.disabled = true; }

  return {
    setRoom,
    teardown() {
      document.removeEventListener("click", onDocClick);
      root.remove();
    },
    focus() { input.focus(); },
  };
}

// Stable, deterministic hue for a channel name (Twitch login) so
// letter-avatars on the rail keep the same colour every render.
function chatAvatarHue(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function paintChatBody(opts = {}) {
  const body = document.getElementById("chat-body");
  if (!body) return;
  const room = chatState.active;
  if (!room) return;
  const buf = chatState.buffers[room] || { messages: [] };
  const wasAtBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  const visible = buf.messages.filter(chatRoomMatchesFilters).slice(-200);

  // Full-repaint path: room switch, filter change, or first paint.
  // Marked by the missing data-room attribute or an explicit
  // {full: true} request.
  const needsFull = opts.full
    || body.dataset.room !== room
    || !body.firstElementChild
    || body.childElementCount > visible.length + 20; // sanity: drifted too far
  if (needsFull) {
    body.dataset.room = room;
    body.innerHTML = visible.map(chatMsgHtml).join("");
    if (wasAtBottom) body.scrollTop = body.scrollHeight;
    paintChatTabs();
    return;
  }

  // Diff path: append messages whose id isn't already on the DOM,
  // trim front when we exceed the 200-window, leave existing nodes
  // untouched so the browser doesn't repaint / re-decode emote
  // images. This is what kills the flicker the user reported.
  const seen = new Set();
  for (const node of body.children) {
    const id = node.dataset.mid;
    if (id) seen.add(id);
  }
  const fragments = [];
  for (const m of visible) {
    if (!seen.has(m.id)) fragments.push(chatMsgHtml(m));
  }
  if (fragments.length) {
    body.insertAdjacentHTML("beforeend", fragments.join(""));
  }
  // Trim from the front so the DOM matches the 200-message window.
  while (body.childElementCount > visible.length) {
    body.removeChild(body.firstElementChild);
  }
  if (wasAtBottom) body.scrollTop = body.scrollHeight;
  paintChatTabs();
}

// Twitch badge resolution. The unauthenticated badges.twitch.tv
// endpoint returns a full set/version → image_url map for the
// platform's global badges (broadcaster/moderator/vip/subscriber etc.).
// Channel-scoped sub badges still need an authenticated /helix/chat/
// badges call against the broadcaster's id — left for a follow-up iter.
const badgeCache = { ready: false, map: new Map() }; // key "<id>/<ver>" → image url
async function ensureGlobalBadges() {
  if (badgeCache.ready) return badgeCache.map;
  try {
    const r = await fetch("https://badges.twitch.tv/v1/badges/global/display?language=en");
    if (!r.ok) throw new Error("badge fetch failed");
    const j = await r.json();
    for (const [id, set] of Object.entries(j.badge_sets || {})) {
      for (const [ver, def] of Object.entries(set.versions || {})) {
        const url = def.image_url_1x || def.image_url_2x || def.image_url_4x;
        if (url) badgeCache.map.set(`${id}/${ver}`, url);
      }
    }
  } catch (_) { /* graceful */ }
  badgeCache.ready = true;
  return badgeCache.map;
}
// Channel-scoped third-party emote sets — fetched once per session
// per channel. Keyed by twitch user_id; result map is room-specific
// and consulted by the tokenizer alongside the global maps. The
// classic "subscriber emote shows up as plain text" symptom is
// channel-scoped data falling through; these closures fix it.
const channelEmoteCache = {}; // user_id → Map<code, url>
async function ensureChannelEmotes(userId) {
  if (!userId) return new Map();
  if (channelEmoteCache[userId]) return channelEmoteCache[userId];
  const merged = new Map();
  // BTTV channel — /3/cached/users/twitch/<id>
  try {
    const r = await fetch(`https://api.betterttv.net/3/cached/users/twitch/${userId}`);
    if (r.ok) {
      const j = await r.json();
      for (const e of [...(j.channelEmotes || []), ...(j.sharedEmotes || [])]) {
        merged.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/1x`);
      }
    }
  } catch (_) { /* graceful */ }
  // 7TV channel — /v3/users/twitch/<id>
  try {
    const r = await fetch(`https://7tv.io/v3/users/twitch/${userId}`);
    if (r.ok) {
      const j = await r.json();
      const set = j.emote_set;
      for (const e of (set?.emotes || [])) {
        const host = e.data?.host;
        if (!host) continue;
        const file = (host.files || []).find((f) => f.name === "1x.webp") || (host.files || [])[0];
        if (!file) continue;
        const base = host.url.startsWith("//") ? `https:${host.url}` : host.url;
        merged.set(e.name, `${base}/${file.name}`);
      }
    }
  } catch (_) { /* graceful */ }
  channelEmoteCache[userId] = merged;
  return merged;
}

// Channel-scoped badge set (subscriber tiers, bits, founder, …).
// Uses the legacy unauthenticated endpoint so OAuth isn't required.
const channelBadgeCache = {}; // user_id → Map<"id/ver", url>
async function ensureChannelBadges(userId) {
  if (!userId) return new Map();
  if (channelBadgeCache[userId]) return channelBadgeCache[userId];
  const map = new Map();
  try {
    const r = await fetch(`https://badges.twitch.tv/v1/badges/channels/${userId}/display?language=en`);
    if (r.ok) {
      const j = await r.json();
      for (const [id, set] of Object.entries(j.badge_sets || {})) {
        for (const [ver, def] of Object.entries(set.versions || {})) {
          const url = def.image_url_1x || def.image_url_2x || def.image_url_4x;
          if (url) map.set(`${id}/${ver}`, url);
        }
      }
    }
  } catch (_) { /* graceful */ }
  channelBadgeCache[userId] = map;
  return map;
}

function renderChatBadges(badges, room) {
  const channelBadges = room && chatState.rooms
    ? channelBadgeCache[chatState.rooms.find((r) => r.room === room)?.user_id] || null
    : null;
  return badges.map((b) => {
    const key = `${b.id}/${b.version}`;
    const url = (channelBadges && channelBadges.get(key)) || badgeCache.map.get(key);
    if (url) {
      return `<img class="chat-badge-img" alt="${htmlEscape(b.id)}" title="${htmlEscape(b.id)}/${htmlEscape(b.version)}" src="${htmlEscape(url)}">`;
    }
    return `<span class="chat-badge">${htmlEscape(b.id)}</span>`;
  }).join("");
}

// Token renderer with Twitch emote-range overlay + BTTV global emote
// substitution. Mirrors strivo-chat::tokenize_text_with_ranges so a
// future host parser switch keeps the same shape.
function renderChatTokens(text, ranges = [], room = null) {
  const channelEmotes = room && chatState.rooms
    ? channelEmoteCache[chatState.rooms.find((r) => r.room === room)?.user_id] || null
    : null;
  // Helper that classifies a single whitespace-split run.
  const classifyRun = (run) => {
    if (!run) return "";
    if (run.startsWith("@")) {
      const user = run.replace(/[.,!?]+$/, "").slice(1);
      if (/^[A-Za-z0-9_]+$/.test(user)) {
        return `<span class="chat-mention">@${htmlEscape(user)}</span>`;
      }
    }
    if (/^https?:\/\//.test(run)) {
      return `<a class="chat-link" href="${htmlEscape(run)}" target="_blank" rel="noopener noreferrer">${htmlEscape(run)}</a>`;
    }
    // Third-party emote precedence: channel-scoped wins over globals
    // so a channel's subscriber-only emote always renders.
    // Then BTTV → FFZ → 7TV globally. First hit wins.
    const tpUrl = (channelEmotes && channelEmotes.get(run))
      || bttvCache.map.get(run)
      || ffzCache.map.get(run)
      || seventvCache.map.get(run);
    if (tpUrl) {
      return `<img class="chat-emote" loading="lazy" alt="${htmlEscape(run)}" title="${htmlEscape(run)}" src="${htmlEscape(tpUrl)}">`;
    }
    return htmlEscape(run);
  };
  // Plain text path when there are no Twitch emote ranges.
  const renderPlain = (s) =>
    s.split(/(\s+)/).map((p) => /^\s+$/.test(p) ? p : classifyRun(p)).join("");
  if (!ranges.length) return renderPlain(text);
  // Twitch ranges are in CODE-POINT indices, not byte offsets. Walk by
  // chars so multi-byte codepoints (emoji-prefixed messages) stay aligned.
  const chars = Array.from(text);
  const out = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start >= chars.length) continue;
    if (r.start > cursor) out.push(renderPlain(chars.slice(cursor, r.start).join("")));
    const end = Math.min(r.end + 1, chars.length);
    const name = chars.slice(r.start, end).join("");
    const url = `https://static-cdn.jtvnw.net/emoticons/v2/${r.id}/default/dark/1.0`;
    out.push(`<img class="chat-emote" loading="lazy" alt="${htmlEscape(name)}" title="${htmlEscape(name)}" src="${htmlEscape(url)}">`);
    cursor = end;
  }
  if (cursor < chars.length) out.push(renderPlain(chars.slice(cursor).join("")));
  return out.join("");
}

function paintChatTabs() {
  const tabs = document.getElementById("chat-tabs");
  if (!tabs) return;
  tabs.innerHTML = chatState.rooms.map((r) => {
    const buf = chatState.buffers[r.room] || { unread: 0, mentions: 0 };
    const active = r.room === chatState.active ? "active" : "";
    const mentionPill = buf.mentions > 0 ? `<span class="chat-tab-mentions">${buf.mentions}</span>` : "";
    const unreadPill = (buf.unread > 0 && r.room !== chatState.active)
      ? `<span class="chat-tab-unread">${buf.unread}</span>` : "";
    const liveDot = r.is_live ? `<span class="chat-tab-live" title="live">◉</span>` : "";
    const offline = r.connectable === false ? " offline" : "";
    return `<button class="chat-tab ${active}${offline}" data-room="${htmlEscape(r.room)}" ${!r.connectable ? "disabled" : ""}>
      ${liveDot}<span class="chat-tab-name">${htmlEscape(r.display_name)}</span>${mentionPill}${unreadPill}
    </button>`;
  }).join("");
  tabs.querySelectorAll(".chat-tab").forEach((t) => {
    t.addEventListener("click", () => {
      const room = t.dataset.room;
      switchChatRoom(room);
    });
  });
}

function switchChatRoom(room) {
  if (room === chatState.active) return;
  chatState.active = room;
  // Mark prior room as read (snapshot unread counter is preserved in buf,
  // but the badge clears on switch).
  if (chatState.buffers[room]) {
    chatState.buffers[room].unread = 0;
    chatState.buffers[room].mentions = 0;
  }
  connectChatRoom(room);
  paintChatTabs();
  paintChatBody({ full: true });
  const activeLabel = document.getElementById("chat-main-active");
  if (activeLabel) activeLabel.textContent = `#${room}`;
  // Swap the compose bar's emote palette + platform accent to follow
  // the new tab.
  if (chatState.compose) {
    const platform = (chatState.rooms.find((r) => r.room === room)?.platform || "twitch").toLowerCase();
    chatState.compose.setRoom(room, platform);
  }
}

async function renderChat() {
  const tabsCollapsed = loadChatTabsCollapsed();
  chatState.tabsCollapsed = tabsCollapsed;
  root.innerHTML = chrome(`
    <div id="chat-root" class="chat-root${tabsCollapsed ? " tabs-collapsed" : ""}">
      <aside id="chat-tabs" class="chat-tabs" role="tablist"></aside>
      <main class="chat-main">
        <div class="chat-main-head">
          <button class="sm chat-tabs-toggle" id="chat-tabs-toggle"
                  type="button" aria-pressed="${tabsCollapsed ? "true" : "false"}"
                  title="${tabsCollapsed ? "Show channel list" : "Hide channel list"}">
            ${tabsCollapsed ? "☰ Channels" : "◀ Hide channels"}
          </button>
          <span class="chat-main-active pg-cap-hint" id="chat-main-active"></span>
        </div>
        <div class="chat-filters">
          <input id="chat-filter-kw" type="text" placeholder="filter: contains…" />
          <input id="chat-filter-out" type="text" placeholder="filter: hide…" />
          <label class="chat-filter-tog"><input type="checkbox" id="chat-no-links"> no links</label>
          <label class="chat-filter-tog"><input type="checkbox" id="chat-no-actions"> no /me</label>
        </div>
        <div id="chat-body" class="chat-body" role="log" aria-live="polite"></div>
        <div id="chat-compose-host" class="chat-compose-host"></div>
      </main>
    </div>
  `);

  // Tabs toggle — collapses the left channel list. Useful when the
  // window is narrow or the user knows which channel they want and
  // wants more room for messages.
  document.getElementById("chat-tabs-toggle")?.addEventListener("click", () => {
    chatState.tabsCollapsed = !chatState.tabsCollapsed;
    saveChatTabsCollapsed(chatState.tabsCollapsed);
    const rootEl = document.getElementById("chat-root");
    if (rootEl) rootEl.classList.toggle("tabs-collapsed", chatState.tabsCollapsed);
    const btn = document.getElementById("chat-tabs-toggle");
    if (btn) {
      btn.textContent = chatState.tabsCollapsed ? "☰ Channels" : "◀ Hide channels";
      btn.title = chatState.tabsCollapsed ? "Show channel list" : "Hide channel list";
      btn.setAttribute("aria-pressed", chatState.tabsCollapsed ? "true" : "false");
    }
  });

  // Register this route's body as a chat paint surface. Persists for
  // the lifetime of the route; the painter self-unregisters when the
  // chat-body DOM is gone (route navigation removed it).
  const routeUnsub = registerChatPainter(() => {
    if (!document.getElementById("chat-body")) { routeUnsub(); return; }
    paintChatBody();
  });
  // Kick off the third-party emote fetches (BTTV + FFZ + 7TV) in the
  // background; we don't await because the chat firehose should never
  // block on a third party. Caches are merged on demand in the
  // tokenizer via mergedEmoteMap().
  ensureThirdPartyEmotes().then(() => schedulePaintChat());
  // Twitch global badge images — same pattern. No auth required.
  ensureGlobalBadges().then(() => schedulePaintChat());
  let rooms;
  try {
    rooms = (await API.chatRooms()).rooms || [];
  } catch (e) {
    document.getElementById("chat-root").innerHTML =
      `<div class="empty"><div class="glyph">⚠</div>${htmlEscape(e.message)}</div>`;
    return;
  }
  // Live first, then alpha.
  rooms.sort((a, b) => {
    if (a.is_live !== b.is_live) return a.is_live ? -1 : 1;
    return a.display_name.localeCompare(b.display_name);
  });
  chatState.rooms = rooms;
  // Default to the first connectable room.
  const first = rooms.find((r) => r.connectable);
  if (first) chatState.active = first.room;
  paintChatTabs();
  const activeLabel = document.getElementById("chat-main-active");
  if (activeLabel) {
    const r = rooms.find((x) => x.room === chatState.active);
    activeLabel.textContent = r ? `#${r.room}` : "";
  }
  if (chatState.active) {
    connectChatRoom(chatState.active);
    paintChatBody({ full: true });
  } else {
    document.getElementById("chat-body").innerHTML =
      `<div class="empty"><div class="glyph">💬</div>
        <p>No Twitch channels followed yet. Add some in Settings → Channels.</p>
        <p class="pg-cap-hint">YouTube live chat needs an OAuth flow — coming soon.</p></div>`;
  }
  // Filter inputs.
  const applyFilters = () => {
    const kw = document.getElementById("chat-filter-kw").value.trim();
    const out = document.getElementById("chat-filter-out").value.trim();
    const noLinks = document.getElementById("chat-no-links").checked;
    const noActions = document.getElementById("chat-no-actions").checked;
    chatState.filters = [];
    if (kw) chatState.filters.push({ kind: "keyword_in", needle: kw });
    if (out) chatState.filters.push({ kind: "keyword_out", needle: out });
    if (noLinks) chatState.filters.push({ kind: "no_links" });
    if (noActions) chatState.filters.push({ kind: "no_actions" });
    paintChatBody({ full: true });
  };
  document.getElementById("chat-filter-kw").addEventListener("input", applyFilters);
  document.getElementById("chat-filter-out").addEventListener("input", applyFilters);
  document.getElementById("chat-no-links").addEventListener("change", applyFilters);
  document.getElementById("chat-no-actions").addEventListener("change", applyFilters);

  // Chatterino-style compose bar. Mounted once; setRoom() swaps the
  // platform accent + per-channel emote palette whenever the user
  // clicks a different tab. The widget owns its own send call,
  // emote/command popups, and char counter — no per-route plumbing
  // beyond the room-change hook below.
  const composeHost = document.getElementById("chat-compose-host");
  const composePlatform = (chatState.rooms.find((r) => r.room === chatState.active)?.platform || "twitch").toLowerCase();
  chatState.compose = mountChatCompose(composeHost, {
    room: chatState.active,
    platform: composePlatform,
    compact: false,
  });
}

