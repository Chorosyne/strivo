
// Viewer route — single stream embed + collapsible chat sidepane.
// Reuses the existing chat plumbing (connectChatRoom, paintChatBody,
// emote + badge caches) so the chat in the sidepane is the same
// engine as the standalone /chat route. Channel selection sticks via
// URL hash (?room=<login>).
async function renderViewer() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  let room = params.get("room") || "";
  let rooms;
  try { rooms = (await API.chatRooms()).rooms || []; }
  catch (e) {
    root.innerHTML = chrome(`<div class="empty"><div class="glyph">⚠</div>${htmlEscape(e.message)}</div>`);
    return;
  }
  rooms.sort((a, b) => {
    if (a.is_live !== b.is_live) return a.is_live ? -1 : 1;
    return a.display_name.localeCompare(b.display_name);
  });
  chatState.rooms = rooms;
  if (!room && rooms.length) room = (rooms.find((r) => r.is_live && r.connectable) || rooms.find((r) => r.connectable))?.room || "";
  if (!room) {
    root.innerHTML = chrome(`<div class="empty"><div class="glyph">📺</div>
      <p>No connectable channels. Follow some on Twitch via Settings → Platforms.</p></div>`);
    return;
  }
  chatState.active = room;
  const sidepaneOpen = (localStorage.getItem("strivo-viewer-sidepane") || "open") !== "closed";
  const picker = rooms.filter((r) => r.connectable).map((r) =>
    `<option value="${htmlEscape(r.room)}" ${r.room === room ? "selected" : ""}>${r.is_live ? "● " : ""}${htmlEscape(r.display_name)}</option>`
  ).join("");
  root.innerHTML = chrome(`
    <div id="viewer-root" class="viewer-root ${sidepaneOpen ? "" : "side-collapsed"}" role="main">
      <div class="viewer-toolbar">
        <label>Channel <select id="viewer-channel">${picker}</select></label>
        <button class="sm" id="viewer-toggle-side" type="button" title="Toggle chat sidepane">${sidepaneOpen ? "↦ Hide chat" : "↤ Show chat"}</button>
      </div>
      <div class="viewer-stage">
        <iframe id="viewer-iframe" class="viewer-iframe" allow="autoplay; fullscreen" allowfullscreen frameborder="0"></iframe>
      </div>
      <aside class="viewer-chat" id="viewer-chat">
        <div class="chat-filters">
          <input id="chat-filter-kw" type="text" placeholder="filter: contains…" />
          <input id="chat-filter-out" type="text" placeholder="filter: hide…" />
        </div>
        <div id="chat-body" class="chat-body" role="log" aria-live="polite"></div>
        <form id="chat-compose" class="chat-compose" autocomplete="off">
          <input id="chat-input" type="text" placeholder="Send message… (Enter)" maxlength="500" />
          <button class="sm" type="submit">▶</button>
          <span class="chat-compose-hint pg-cap-hint" id="chat-compose-hint"></span>
        </form>
      </aside>
    </div>
  `);
  setupChromeHandlers();
  // Wire third-party + per-channel caches once.
  ensureThirdPartyEmotes().then(() => schedulePaintChat());
  ensureGlobalBadges().then(() => schedulePaintChat());
  // Mount the embed iframe — Twitch needs parent= hostname.
  // Twitch's embed validator REJECTS bare IP addresses (and 'localhost'
  // works only when accessed via 'localhost'). LAN dogfooding via
  // http://<ip>:8181 fails with 'embed misconfigured'. We detect the
  // bare-IP case, rewrite parent= to a nip.io equivalent
  // (<ip-dashed>.nip.io), and offer the user a one-click banner that
  // navigates the WHOLE page to the matching nip.io URL so the
  // iframe's referer lines up with parent=. nip.io resolves
  // <ip-dashed>.nip.io → that IP via wildcard DNS — no setup needed.
  const rawHost = location.host;
  const hostNoPort = rawHost.split(":")[0];
  const port = rawHost.includes(":") ? rawHost.split(":")[1] : "";
  const isLocalhost = hostNoPort === "localhost" || hostNoPort === "127.0.0.1";
  const isHttps = location.protocol === "https:";
  // Twitch's parent= validator + its embed CSP together require:
  //   * a hostname (no bare IPs)
  //   * either https:// access, OR access via 'localhost' over http
  // Anything else gets the 'embed misconfigured' / CSP-violation
  // error. We rewrite bare IP → nip.io so the parent= validator
  // passes, but the CSP rule still needs https for nip.io.
  const parent = embedParentHost(rawHost);
  const embedBlocked = !isLocalhost && !isHttps;
  const stage = document.querySelector(".viewer-stage");
  if (embedBlocked) {
    const nipUrl = `http://${parent}${port ? ":" + port : ""}${location.pathname}${location.hash}`;
    // Render a fix overlay above the iframe with three working
    // paths so the user can pick whichever is easiest.
    const banner = document.createElement("div");
    banner.className = "viewer-embed-banner";
    banner.innerHTML = `
      <p><strong>Twitch can't embed over plain HTTP on a remote host.</strong>
      Their player CSP requires <code>https://</code> for any parent that isn't <code>localhost</code>. Pick one of these:</p>
      <ol class="viewer-embed-options">
        <li><strong>SSH tunnel (easiest)</strong> — on your laptop run
          <code>ssh -L 8181:localhost:8181 ${htmlEscape(hostNoPort)}</code>
          then open <a href="http://localhost:8181${location.pathname}${location.hash}">http://localhost:8181${htmlEscape(location.pathname + location.hash)}</a> — Twitch whitelists localhost over HTTP.</li>
        <li><strong>HTTPS via nip.io + a cert</strong> — front the serve with Caddy / nginx terminating TLS for
          <code>${htmlEscape(parent)}${port ? ":" + port : ""}</code>, then access via
          <a href="${htmlEscape(nipUrl.replace(/^http:/, "https:"))}">https://${htmlEscape(parent)}${port ? ":" + htmlEscape(port) : ""}</a>.</li>
        <li><strong>SOCKS over the LAN</strong> — proxy the laptop browser through the strivo host (any SOCKS proxy will do) and treat it as localhost.</li>
      </ol>
      <p class="pg-cap-hint">The chat sidepane on the right works regardless — Twitch chat connects via WebSocket without the embed CSP. Use it while you sort out the player path.</p>`;
    stage.prepend(banner);
  }
  document.getElementById("viewer-iframe").src =
    buildEmbedUrl("Twitch", room, { host: rawHost });
  // Sidepane toggle persists.
  document.getElementById("viewer-toggle-side").addEventListener("click", () => {
    const root_ = document.getElementById("viewer-root");
    const open = !root_.classList.contains("side-collapsed");
    if (open) { root_.classList.add("side-collapsed"); localStorage.setItem("strivo-viewer-sidepane", "closed"); }
    else { root_.classList.remove("side-collapsed"); localStorage.setItem("strivo-viewer-sidepane", "open"); }
    document.getElementById("viewer-toggle-side").textContent = open ? "↤ Show chat" : "↦ Hide chat";
  });
  // Channel picker rewrites the URL — render() reruns via hashchange.
  document.getElementById("viewer-channel").addEventListener("change", (ev) => {
    const next = ev.target.value;
    window.location.hash = `#/viewer?room=${encodeURIComponent(next)}`;
  });
  connectChatRoom(room);
  paintChatBody({ full: true });
  // Filter inputs + compose box — reuse the same handlers as renderChat
  // by setting up a tiny applyFilters local.
  const applyFilters = () => {
    const kw = document.getElementById("chat-filter-kw").value.trim();
    const out = document.getElementById("chat-filter-out").value.trim();
    chatState.filters = [];
    if (kw) chatState.filters.push({ kind: "keyword_in", needle: kw });
    if (out) chatState.filters.push({ kind: "keyword_out", needle: out });
    paintChatBody({ full: true });
  };
  document.getElementById("chat-filter-kw").addEventListener("input", applyFilters);
  document.getElementById("chat-filter-out").addEventListener("input", applyFilters);
  document.getElementById("chat-compose").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = (document.getElementById("chat-input").value || "").trim();
    if (!text) return;
    try {
      await API.chatSend(room, text);
      document.getElementById("chat-input").value = "";
    } catch (err) {
      document.getElementById("chat-compose-hint").textContent = err.message || "Send failed";
    }
  });
}

// Multi-stream viewer route. Server returns tiles already laid out for
// the requested container size + mode, plus each stream's ready-to-mount
// embed URL. Mode is kept in URL params so refresh / share preserves the
// view.
// Background poll handle so route switches can cancel the previous
// timer before mounting a new one.
// A12: deprecated. playerState.refreshTimer is the canonical handle;
// this dual reference is retained so teardownAcrossRoutes() can keep
// clearing both during a transitional release. New code MUST use
// playerState.refreshTimer.
let _watchRefreshTimer = null;

// Append the muted-state parameter Twitch / YouTube embeds use.
// ── Tile audio ───────────────────────────────────────────────────────
//
// Volume per tile is the source of truth; muted simply means zero. That
// split matters because "which tile is focused" and "which tile is audible"
// were the same flag before, so you could not run a main stream loud with a
// second quietly underneath — the only reachable states were one-audible or
// all-silent.
//
// `playerState.soloPath` survives as the FOCUS marker (it steers the chat
// rail and the focus-aware quality policy); it no longer decides audio.
const PLAYER_VOLUME_KEY = "strivo:tile-volumes";
function loadTileVolumes() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYER_VOLUME_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch (_) {
    return {};
  }
}
function saveTileVolumes() {
  try {
    localStorage.setItem(PLAYER_VOLUME_KEY, JSON.stringify(playerState.volumes || {}));
  } catch (_) {
    /* private mode */
  }
}
/// Everything starts silent: a wall that begins making noise on open is
/// hostile, and it matches the previous mute-all default.
function tileVolumeForKey(key) {
  if (!key) return 0;
  const v = (playerState.volumes || {})[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
function tileVolumeAt(path) {
  return tileVolumeForKey(contentKeyOf(getNodeAt(playerState.layout, path)));
}
function setTileVolumeAt(path, vol) {
  const key = contentKeyOf(getNodeAt(playerState.layout, path));
  if (!key) return;
  playerState.volumes = { ...(playerState.volumes || {}), [key]: Math.max(0, Math.min(1, vol)) };
  saveTileVolumes();
}
/// Solo is a preset, not a mode: raise this tile, silence the rest. The
/// viewer is free to nudge any of them afterwards.
function soloTileAt(path) {
  const next = {};
  walkLayout(playerState.layout, (node, p) => {
    const key = contentKeyOf(node);
    if (key) next[key] = p === path ? 1 : 0;
  });
  playerState.volumes = next;
  playerState.soloPath = path;
  saveTileVolumes();
}
function muteAllTiles() {
  const next = {};
  walkLayout(playerState.layout, (node) => {
    const key = contentKeyOf(node);
    if (key) next[key] = 0;
  });
  playerState.volumes = next;
  playerState.soloPath = "";
  saveTileVolumes();
}

/// Muted is derived, never stored: a tile is muted exactly when silent.
function computeMuted(path) {
  return tileVolumeAt(path) === 0;
}

// Single source of truth for a live tile's iframe src.
//
// Autoplay has to be stated explicitly because the two providers disagree
// out of the box: Twitch's player autoplays unless told not to, YouTube's
// embed does the opposite. Leaving it implicit is why opening a 3x3 wall
// used to start nine Twitch streams at once.
//
// The base URL is kept on the element in `data-embed-base` so repaints
// rebuild from it rather than regex-stripping params off a previous src.
function tileSrc(embedUrl, { muted, playing }) {
  if (!embedUrl) return embedUrl;
  const yt = embedUrl.includes("youtube.com");
  const params = [
    yt ? `mute=${muted ? 1 : 0}` : `muted=${muted}`,
    yt ? `autoplay=${playing ? 1 : 0}` : `autoplay=${playing}`,
  ];
  return embedUrl + (embedUrl.includes("?") ? "&" : "?") + params.join("&");
}

// Multi-view quality defaults, per provider.
//
// Deliberately NOT normalised into one cross-platform scale: the same
// "1080p" is a different bitrate on Twitch than on YouTube, and differs
// between streamers on the same platform. The UI therefore offers what each
// provider actually exposes, and says plainly where a provider exposes
// nothing.
const MULTIVIEW_QUALITY_KEY = "strivo:multiview-quality";
const MULTIVIEW_QUALITY_DEFAULTS = { twitch: "best", youtube: "auto" };
const MULTIVIEW_QUALITY_CHOICES = [
  ["best", "Best available"],
  ["auto", "Let the platform decide"],
  ["low", "Lowest (save bandwidth/CPU)"],
  ["focus", "Best on the focused tile, lowest on the rest"],
];
function multiviewQuality() {
  try {
    const raw = JSON.parse(localStorage.getItem(MULTIVIEW_QUALITY_KEY) || "{}");
    return { ...MULTIVIEW_QUALITY_DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  } catch (_) {
    return { ...MULTIVIEW_QUALITY_DEFAULTS };
  }
}
function setMultiviewQuality(provider, value) {
  const next = { ...multiviewQuality(), [provider]: value };
  try {
    localStorage.setItem(MULTIVIEW_QUALITY_KEY, JSON.stringify(next));
  } catch (_) {
    /* private mode */
  }
}
/// Resolve the effective policy for one tile. "focus" is the only setting
/// that varies per tile; everything else applies uniformly.
function qualityPolicyFor(kind, path) {
  const provider = kind === "youtube" ? "youtube" : "twitch";
  const setting = multiviewQuality()[provider] || "auto";
  if (setting !== "focus") return setting;
  const focused = playerState.soloPath || "";
  return path === focused ? "best" : "low";
}

// ── Player controllers ───────────────────────────────────────────────
//
// A tile's vendor player is owned by a controller keyed on CONTENT
// (`s:<streamId>` / `r:<recordingId>`), held in `playerState.controllers`
// for the whole watch session — deliberately NOT keyed on layout path and
// NOT owned by the DOM.
//
// That distinction is the entire point. Stage HTML is rebuilt wholesale on
// preset switches, composer edits, and Play-all; when the player lived in
// that HTML, every rebuild tore it down and Twitch/YouTube restarted the
// stream. Because the registry outlives any single paint, a rebuild now
// just re-parents the existing element into its new mount point, and a
// stream the user never touched keeps playing.
//
// Every controller is created through a swappable factory so e2e can inject
// a fake and assert on lifecycle without loading a real vendor player.

/// Is this platform YouTube, whichever way the API spelled it?
///
/// `/channels` serialises PlatformKind as "YouTube" while
/// `/multistream/tiles` serialises multistream::Platform as "you_tube".
/// Comparing against a single spelling sent YouTube streams to the Twitch
/// controller, which handed a YouTube channel id to player.twitch.tv and
/// produced "Failed to determine content classification" — a Twitch error,
/// for a Twitch player, about a channel that was never Twitch's.
function isYouTubePlatform(p) {
  return String(p || "").toLowerCase().replace(/[_\s-]/g, "") === "youtube";
}

/// Stable identity for whatever a slot holds. Returns null for empty slots.
function contentKeyOf(node) {
  if (!node) return null;
  if (node.streamId) return `s:${node.streamId}`;
  if (node.recordingId) return `r:${node.recordingId}`;
  return null;
}

/// Today's behaviour, wrapped: a plain cross-origin iframe whose only
/// control surface is its `src`. Mute and playback still cost a reload
/// here — that is inherent to a bare iframe, and is what the vendor-SDK
/// controllers in later phases exist to avoid. This stays as the permanent
/// fallback for when a vendor script is blocked or fails to load, so a
/// missing SDK degrades to exactly the old experience rather than a blank
/// tile.
function makeIframeController(spec) {
  const el = document.createElement("iframe");
  el.className = "watch-tile-iframe ms-iframe";
  el.setAttribute(
    "allow",
    "autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write",
  );
  el.setAttribute("allowfullscreen", "");
  el.setAttribute("frameborder", "0");
  let base = spec.embedUrl || "";
  let muted = !!spec.muted;
  const playing = spec.playing !== false;
  el.setAttribute("data-embed-base", base);
  const sync = () => {
    if (!base) return;
    const next = tileSrc(base, { muted, playing });
    // Assigning src reloads the player, so only write on a real change.
    if (el.getAttribute("src") !== next) el.setAttribute("src", next);
  };
  sync();
  return {
    kind: "iframe-fallback",
    root: el,
    mount(container) {
      if (el.parentElement !== container) container.appendChild(el);
    },
    destroy() {
      el.remove();
    },
    setMuted(next) {
      if (next !== muted) {
        muted = next;
        sync();
      }
    },
    setVolume() {
      /* not addressable without a player API — see the Twitch controller */
    },
    setQuality() {
      /* ditto */
    },
    repoint(next) {
      const url = next && next.embedUrl;
      if (url && url !== base) {
        base = url;
        el.setAttribute("data-embed-base", base);
        sync();
      }
    },
    isReady() {
      return true;
    },
  };
}

/// Local recording playback. A `<video>` already has a real API, so this
/// never needed the reload workaround — it is a controller purely so the
/// reconciler can treat every tile the same way, and so a repaint stops
/// dropping playback position on the floor.
function makeRecordingController(spec) {
  const el = document.createElement("video");
  el.className = "watch-tile-iframe ms-video";
  el.controls = true;
  el.playsInline = true;
  el.muted = !!spec.muted;
  const playing = spec.playing !== false;
  el.preload = playing ? "metadata" : "none";
  if (playing) el.autoplay = true;
  if (spec.src) el.src = spec.src;

  // A recording can be on disk, non-zero, and still unplayable — an
  // interrupted VOD pull leaves a truncated MP4 with no moov atom, and the
  // browser then hunts forever for an index that was never written. Without
  // this the tile just sits there looking like it is still loading, which is
  // indistinguishable from a slow network.
  const fail = (why) => {
    if (el.dataset.failed) return;
    el.dataset.failed = "1";
    const note = document.createElement("div");
    note.className = "ms-media-error";
    note.innerHTML =
      `<strong>Can't play this recording</strong><span>${htmlEscape(why)}</span>` +
      `<span class="pg-cap-hint">The file is on disk but its container is unreadable — ` +
      `an interrupted capture usually leaves it without an index.</span>`;
    el.parentElement?.appendChild(note);
  };
  el.addEventListener("error", () => {
    const codes = {
      1: "playback aborted",
      2: "network error",
      3: "the file could not be decoded",
      4: "the format is not supported",
    };
    fail(codes[el.error?.code] || "the media failed to load");
  });
  // `error` never fires for a file that merely never finishes loading its
  // metadata, which is exactly the truncated-MP4 case, so time it out too.
  let settled = false;
  const seen = () => { settled = true; };
  el.addEventListener("loadedmetadata", seen);
  el.addEventListener("playing", seen);
  setTimeout(() => {
    if (!settled && el.isConnected && el.readyState === 0) {
      fail("it never returned any playable data");
    }
  }, 15000);

  return {
    kind: "recording",
    root: el,
    mount(container) {
      if (el.parentElement !== container) container.appendChild(el);
    },
    destroy() {
      try {
        el.pause();
      } catch (_) {
        /* already detached */
      }
      el.removeAttribute("src");
      el.remove();
    },
    setMuted(next) {
      if (el.muted !== next) el.muted = next;
    },
    setVolume(v) {
      el.volume = Math.max(0, Math.min(1, v));
    },
    setQuality() {
      /* the file is the file */
    },
    repoint(next) {
      if (next && next.src && next.src !== el.getAttribute("src")) el.src = next.src;
    },
    isReady() {
      return true;
    },
  };
}

/// Load Twitch's embed SDK once, shared by every tile.
///
/// Memoised on the PROMISE, not a boolean: two tiles starting at the same
/// moment must share one in-flight load rather than injecting the script
/// twice. Rejection is sticky and harmless — the factory simply keeps
/// handing out iframe controllers.
let _twitchSdk = null;
function loadTwitchSdkOnce() {
  if (_twitchSdk) return _twitchSdk;
  _twitchSdk = new Promise((resolve, reject) => {
    if (window.Twitch && window.Twitch.Player) return resolve(window.Twitch);
    const el = document.createElement("script");
    el.src = "https://player.twitch.tv/js/embed/v1.js";
    el.async = true;
    el.onload = () =>
      window.Twitch && window.Twitch.Player
        ? resolve(window.Twitch)
        : reject(new Error("Twitch SDK loaded without a Player"));
    el.onerror = () => reject(new Error("Twitch SDK failed to load"));
    document.head.appendChild(el);
  });
  return _twitchSdk;
}

/// Pull the channel and parent back out of an embed URL we built ourselves.
function parseTwitchEmbed(url) {
  try {
    const u = new URL(url);
    return {
      channel: u.searchParams.get("channel") || "",
      parent: u.searchParams.get("parent") || embedParentHost(),
    };
  } catch (_) {
    return null;
  }
}

/// Twitch tile driven through `Twitch.Player`.
///
/// The whole point: mute, volume and quality are method calls, so none of
/// them reload the stream the way rewriting an iframe `src` does. Quality is
/// the big one on a wall — several 1080p60 decodes is the dominant cost, and
/// background tiles do not need source.
function makeTwitchController(spec) {
  const host = document.createElement("div");
  host.className = "watch-tile-iframe ms-iframe ms-twitch";
  const parsed = parseTwitchEmbed(spec.embedUrl) || { channel: "", parent: embedParentHost() };

  let player = null;
  let ready = false;
  let qualities = [];
  let pendingQualityTier = null;
  let muted = !!spec.muted;
  let volume = typeof spec.volume === "number" ? spec.volume : 1;

  /// Map a policy onto whatever this stream actually offers.
  ///
  /// The quality string vocabulary is NOT documented by Twitch — community
  /// reports resolution-coded names like "1080p60 (source)" — so options are
  /// discovered per player and never hardcoded. A resolution label is also
  /// not a quality measure: the same "1080p" differs in bitrate between
  /// streamers and platforms, which is why nothing here normalises across
  /// providers. Anything unexpected means: do nothing and let Twitch's own
  /// auto stand, which is always a safe answer.
  const applyQuality = (policy) => {
    if (!player || !ready || !policy || policy === "auto") return;
    // getQualities() returns entries with a `group` id and a human `name`.
    // Drop the synthetic "auto" entry; what remains is highest-first per
    // Twitch's ordering, but do not rely on that — pick by explicit ends.
    const usable = qualities.filter((q) => q && q.group && q.group !== "auto");
    if (usable.length < 2) return;
    const pick = policy === "low" ? usable[usable.length - 1] : usable[0];
    if (!pick || !pick.group) return;
    try {
      if (player.getQuality() !== pick.group) player.setQuality(pick.group);
    } catch (_) {
      /* advisory only — never worse than leaving auto alone */
    }
  };

  loadTwitchSdkOnce()
    .then((Twitch) => {
      if (!host.isConnected && !host.parentElement) {
        // Tile was removed while the SDK was loading.
        return;
      }
      player = new Twitch.Player(host, {
        channel: parsed.channel,
        parent: [parsed.parent],
        width: "100%",
        height: "100%",
        muted,
        autoplay: spec.playing !== false,
      });
      player.addEventListener(Twitch.Player.READY, () => {
        ready = true;
        try {
          // getQualities() ordering is not documented either; sort so the
          // highest is first regardless of what Twitch hands back.
          qualities = (player.getQualities() || []).slice();
        } catch (_) {
          qualities = [];
        }
        try {
          player.setMuted(muted);
          player.setVolume(volume);
        } catch (_) {
          /* pre-ready calls can throw on some builds */
        }
        if (pendingQualityTier) applyQuality(pendingQualityTier);
      });
    })
    .catch(() => {
      // SDK blocked or offline: fall back to a plain iframe in place, so
      // the tile still plays rather than sitting empty.
      const fb = makeIframeController(spec);
      host.replaceWith(fb.root);
      player = null;
      controller.root = fb.root;
      controller.setMuted = fb.setMuted;
      controller.setVolume = fb.setVolume;
      controller.repoint = fb.repoint;
      controller.destroy = fb.destroy;
      controller.mount = fb.mount;
    });

  const controller = {
    kind: "twitch",
    root: host,
    mount(container) {
      if (controller.root.parentElement !== container) container.appendChild(controller.root);
    },
    destroy() {
      try {
        // The SDK exposes no documented destroy; dropping the node releases
        // the iframe it created underneath.
        player = null;
      } finally {
        controller.root.remove();
      }
    },
    setMuted(next) {
      muted = next;
      if (player && ready) {
        try {
          player.setMuted(next);
          return;
        } catch (_) {
          /* fall through */
        }
      }
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (player && ready) {
        try {
          player.setVolume(volume);
        } catch (_) {
          /* advisory */
        }
      }
    },
    setQuality(tier) {
      pendingQualityTier = tier;
      applyQuality(tier);
    },
    getPlaybackStats() {
      try {
        return player && ready ? player.getPlaybackStats() : null;
      } catch (_) {
        return null;
      }
    },
    repoint(next) {
      const p = next && next.embedUrl ? parseTwitchEmbed(next.embedUrl) : null;
      if (!p || !p.channel || p.channel === parsed.channel) return;
      parsed.channel = p.channel;
      if (player) {
        try {
          // Retarget in place — no teardown, no reload.
          player.setChannel(p.channel);
        } catch (_) {
          /* leave the tile on its current channel rather than blanking it */
        }
      }
    },
    isReady() {
      return ready;
    },
  };
  return controller;
}

/// Load YouTube's IFrame Player API — ON DEMAND ONLY.
///
/// This is a Google-hosted script executing with page privileges, which is a
/// heavier trust posture than a sandboxed cross-origin iframe. This project
/// deliberately serves fonts from Bunny Fonts rather than Google to avoid
/// leaking client IP/referer, so this must never load merely because someone
/// opened the wall:
/// it loads the first time a YouTube tile is actually played, at which point
/// the viewer has already chosen to contact Google.
///
/// Memoised on the PROMISE so two YouTube tiles started together share one
/// in-flight load rather than injecting the script twice.
let _ytApi = null;
function loadYouTubeApiOnce() {
  if (_ytApi) return _ytApi;
  _ytApi = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    // The API signals readiness through this single global callback, so
    // chain rather than clobber any existing one.
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") {
        try {
          prev();
        } catch (_) {
          /* not ours to fix */
        }
      }
      window.YT && window.YT.Player
        ? resolve(window.YT)
        : reject(new Error("YouTube API ready without a Player"));
    };
    const el = document.createElement("script");
    el.src = "https://www.youtube.com/iframe_api";
    el.async = true;
    el.onerror = () => reject(new Error("YouTube IFrame API failed to load"));
    document.head.appendChild(el);
  });
  return _ytApi;
}

/// YouTube tile driven through `YT.Player`.
///
/// Parity with Twitch on the basics — mute and volume without reloading —
/// which is the point: a mute button that works on one platform and not the
/// other is more confusing than either behaviour applied consistently.
///
/// Quality is deliberately absent. Google decommissioned it: setPlaybackQuality
/// is a documented no-op, so a control here could not take effect.
function makeYouTubeController(spec) {
  const host = document.createElement("div");
  host.className = "watch-tile-iframe ms-iframe ms-youtube";

  let player = null;
  let ready = false;
  let muted = !!spec.muted;
  let volume = typeof spec.volume === "number" ? spec.volume : 1;
  let videoId = spec.videoId || "";

  // No video id means no player API: YT.Player addresses a video, and the
  // live embed strivo builds addresses a channel. Fall straight back rather
  // than construct something that cannot work.
  if (!videoId) return makeIframeController(spec);

  /// Swap this controller's guts for the plain iframe, in place.
  ///
  /// `spec.embedUrl` is the channel-live embed, which is a different (and
  /// historically more forgiving) surface than addressing the video by id,
  /// so this is a genuine second chance rather than a repeat of the same
  /// request. Idempotent: a failing player can report more than once.
  let fellBack = false;
  const fallBackToIframe = () => {
    if (fellBack) return;
    fellBack = true;
    let fb;
    try {
      if (player && typeof player.destroy === "function") player.destroy();
    } catch (_) {
      /* the node is replaced below regardless */
    }
    player = null;
    ready = false;
    fb = makeIframeController(spec);
    const parent = controller.root.parentElement;
    controller.root.replaceWith(fb.root);
    controller.root = fb.root;
    controller.setMuted = fb.setMuted;
    controller.setVolume = fb.setVolume;
    controller.repoint = fb.repoint;
    controller.destroy = fb.destroy;
    controller.mount = fb.mount;
    controller.isReady = fb.isReady;
    if (parent) fb.mount(parent);
    // Re-apply the level the tile is supposed to be at.
    try {
      fb.setMuted(muted);
    } catch (_) {
      /* best effort */
    }
  };

  loadYouTubeApiOnce()
    .then((YT) => {
      if (!host.parentElement) return; // tile removed while loading
      player = new YT.Player(host, {
        videoId,
        playerVars: {
          autoplay: spec.playing !== false ? 1 : 0,
          mute: muted ? 1 : 0,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            ready = true;
            try {
              if (muted) player.mute();
              else player.unMute();
              player.setVolume(Math.round(volume * 100));
            } catch (_) {
              /* pre-ready races */
            }
          },
          // Any player-side failure falls back to the plain channel-live
          // iframe — the path used before this controller existed. The API
          // is only worth having when it works; when it does not, playing
          // the stream matters more than being able to set its volume.
          onError: (e) => {
            const codes = {
              2: "invalid parameter",
              5: "HTML5 player error",
              100: "video not found",
              101: "embedding disallowed by the owner",
              150: "embedding disallowed by the owner",
              153: "missing referer",
            };
            console.warn(
              `[strivo] YouTube player error ${e && e.data} (${codes[e && e.data] || "unknown"}) — falling back to the iframe embed`,
            );
            fallBackToIframe();
          },
        },
      });
    })
    .catch(() => fallBackToIframe());

  const controller = {
    kind: "youtube",
    root: host,
    mount(container) {
      if (controller.root.parentElement !== container) container.appendChild(controller.root);
    },
    destroy() {
      try {
        if (player && typeof player.destroy === "function") player.destroy();
      } catch (_) {
        /* fall through to dropping the node */
      }
      player = null;
      controller.root.remove();
    },
    setMuted(next) {
      muted = next;
      if (player && ready) {
        try {
          next ? player.mute() : player.unMute();
        } catch (_) {
          /* advisory */
        }
      }
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (player && ready) {
        try {
          player.setVolume(Math.round(volume * 100));
        } catch (_) {
          /* advisory */
        }
      }
    },
    setQuality() {
      // Intentionally empty: Google decommissioned setPlaybackQuality.
    },
    repoint(next) {
      const id = next && next.videoId;
      if (!id || id === videoId) return;
      videoId = id;
      if (player && ready) {
        try {
          player.loadVideoById(id);
        } catch (_) {
          /* leave the tile where it is rather than blanking it */
        }
      }
    },
    isReady() {
      return ready;
    },
  };
  return controller;
}

function defaultPlayerControllerFactory(kind, spec) {
  if (kind === "recording") return makeRecordingController(spec);
  if (kind === "twitch") return makeTwitchController(spec);
  if (kind === "youtube") return makeYouTubeController(spec);
  return makeIframeController(spec);
}

let _playerControllerFactory = defaultPlayerControllerFactory;
function setPlayerControllerFactory(fn) {
  _playerControllerFactory = fn || defaultPlayerControllerFactory;
}

/// Diff the controller registry against the mount points in freshly-painted
/// stage HTML. Called by BOTH the full repaint and the surgical patch path,
/// so neither needs its own notion of player lifecycle.
function reconcileControllers(stage) {
  if (!stage) return;
  const wanted = new Map();
  stage.querySelectorAll(".ms-mount[data-content-key]").forEach((mount) => {
    wanted.set(mount.dataset.contentKey, mount);
  });

  // Anything no longer on the wall is destroyed. Skipping this leaks a live
  // vendor connection — bandwidth and CPU for a tile that is gone.
  for (const [key, ctl] of playerState.controllers) {
    if (!wanted.has(key)) {
      try {
        ctl.destroy();
      } catch (_) {
        /* a controller that fails to tear down must not block the rest */
      }
      playerState.controllers.delete(key);
    }
  }

  for (const [key, mount] of wanted) {
    const path = mount.dataset.path || "";
    const muted = computeMuted(path);
    let ctl = playerState.controllers.get(key);
    if (!ctl) {
      try {
        ctl = _playerControllerFactory(mount.dataset.kind || "iframe-fallback", {
          embedUrl: mount.dataset.embedBase || "",
          src: mount.dataset.src || "",
          // YouTube's player API addresses a video; the daemon resolves the
          // airing broadcast's id during live detection.
          videoId: mount.dataset.videoId || "",
          muted,
          volume: tileVolumeForKey(key),
          playing: mount.dataset.playing !== "0",
        });
      } catch (e) {
        // A factory that throws must not take the wall down with it.
        tracingWarn("player controller failed to construct", e);
        continue;
      }
      playerState.controllers.set(key, ctl);
    } else if (mount.dataset.embedBase || mount.dataset.src) {
      // Same content, different URL (host changed, for instance) — retarget
      // rather than rebuild.
      ctl.repoint({
        embedUrl: mount.dataset.embedBase || "",
        src: mount.dataset.src || "",
        videoId: mount.dataset.videoId || "",
      });
    }
    ctl.mount(mount);
    const vol = tileVolumeForKey(key);
    ctl.setMuted(vol === 0);
    ctl.setVolume(vol);
    ctl.setQuality(qualityPolicyFor(mount.dataset.kind || "", path));
  }
}

/// Drop every controller — used when leaving the watch route entirely.
function destroyAllControllers() {
  for (const [, ctl] of playerState.controllers) {
    try {
      ctl.destroy();
    } catch (_) {
      /* best effort */
    }
  }
  playerState.controllers.clear();
}

function tracingWarn(msg, e) {
  console.warn(`[strivo] ${msg}:`, e);
}

// Tiles start paused. A wall of live streams that all begin playing the
// moment it opens burns bandwidth and CPU on streams the viewer has not
// chosen to watch yet, so the default is a still, cheap grid you press
// play on. Persisted so the preference survives a reload.
const PLAYER_AUTOPLAY_KEY = "strivo-player-autoplay";
function loadPlayerAutoplay() {
  try { return localStorage.getItem(PLAYER_AUTOPLAY_KEY) === "1"; } catch (_) { return false; }
}
function savePlayerAutoplay() {
  try {
    localStorage.setItem(PLAYER_AUTOPLAY_KEY, playerState.autoplay ? "1" : "0");
  } catch (_) { /* private mode */ }
}
/// Is this slot playing? A stream the viewer pressed play on stays playing
/// while the wall default is paused.
///
/// Keyed on CONTENT, not layout path, for the same reason the controller
/// registry is: a tile that moves is still the same stream. Keying on path
/// meant switching preset — which relocates a stream from "" to "a.a" —
/// silently paused it, because the new path had never been started.
function tilePlaying(node) {
  if (playerState.autoplay) return true;
  const key = contentKeyOf(node);
  return !!key && (playerState.playing || []).includes(key);
}
function setTilePlaying(node, on) {
  const key = contentKeyOf(node);
  if (!key) return;
  const set = new Set(playerState.playing || []);
  if (on) set.add(key); else set.delete(key);
  playerState.playing = [...set];
}

// ── Player layout tree (multi-view collapsed into the player) ────────
//
// The viewing stage is a recursive layout tree. Two node kinds:
//   slot:  { kind: "slot", streamId: string|null }
//   split: { kind: "split", dir: "h"|"v", ratio: 0..1, a: node, b: node }
//
// 'h' splits stack left|right, 'v' splits stack top|bottom. The split
// ratio governs how much room the 'a' child gets. Presets always
// create EMPTY slots (per user request) — picking a preset never
// auto-populates streams.
//
// Cap at 9 leaves keeps the iframe count reasonable; beyond that the
// browser starts paging and Twitch/YT rate-limit your IP.

const PLAYER_LEAF_CAP = 9;
const PLAYER_LAYOUT_KEY = "strivo-player-layout";
const PLAYER_PRESET_KEY = "strivo-player-preset";

// A slot can hold ONE of (or neither):
//   streamId      — live channel (rendered as a platform embed iframe)
//   recordingId   — finished recording (rendered as a <video> sourced
//                   from /api/v1/recordings/<id>/download — the /file
//                   route is DELETE-only)
function _slot(streamId = null, recordingId = null) { return { kind: "slot", streamId, recordingId }; }
function _split(dir, ratio, a, b) { return { kind: "split", dir, ratio, a, b }; }
// Row builders for the grid presets — kept as helpers so the trees read as
// rows rather than as nested split soup.
function _row2() { return _split("h", 0.5, _slot(), _slot()); }
function _row3() { return _split("h", 1 / 3, _slot(), _split("h", 0.5, _slot(), _slot())); }

// Strict drag-payload parser. Validates the shape and ID grammar so a
// stray browser URL drag (or a corrupted/old payload) can't slip into
// the layout as a real stream. Returns:
//   { type: "tile",      path: string }
//   { type: "stream",    id:   string }
//   { type: "recording", id:   string }
// or null when the payload doesn't match any known schema.
function parsePlayerDragPayload(text) {
  if (typeof text !== "string" || !text) return null;
  // Path can be empty (root); slug chars only beyond that.
  if (text.startsWith("strivo-tile:")) {
    const path = text.slice("strivo-tile:".length);
    if (path !== "" && !/^[ab](\.[ab])*$/.test(path)) return null;
    return { type: "tile", path };
  }
  if (text.startsWith("strivo-stream:")) {
    const id = text.slice("strivo-stream:".length);
    // Backend stream-id shape: 'PlatformDebug:Id' — alphanumeric +
    // colons/dashes/underscores. Reject anything wilder.
    if (!/^[A-Za-z0-9:_-]+$/.test(id)) return null;
    return { type: "stream", id };
  }
  if (text.startsWith("strivo-recording:")) {
    const id = text.slice("strivo-recording:".length);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    return { type: "recording", id };
  }
  return null;
}

const PLAYER_PRESETS = {
  single: () => _slot(),
  "split-screen": () => _split("h", 0.5, _slot(), _slot()),
  // Split / quadrant = 3 streams: left half single, right split top/bottom.
  "split-quadrant": () => _split("h", 0.5, _slot(), _split("v", 0.5, _slot(), _slot())),
  // 2×2 grid.
  quadrant: () => _split("v", 0.5,
    _split("h", 0.5, _slot(), _slot()),
    _split("h", 0.5, _slot(), _slot()),
  ),
  // Grids are built rows-first so a depth-first walk visits tiles in
  // reading order — that walk is what "fill the next empty tile" uses, and
  // a column-major tree makes clicked sources land in a scattered order.
  // 2 columns x 3 rows.
  "grid-6": () => _split("v", 1 / 3,
    _row2(),
    _split("v", 0.5, _row2(), _row2()),
  ),
  // 3x3 wall — 9 leaves, exactly the cap countLeaves enforces.
  "grid-9": () => _split("v", 1 / 3,
    _row3(),
    _split("v", 0.5, _row3(), _row3()),
  ),
  // One large focus tile with a stacked sidebar of three.
  "focus-3": () => _split("h", 0.68,
    _slot(),
    _split("v", 1 / 3, _slot(), _split("v", 0.5, _slot(), _slot())),
  ),
  custom: () => _slot(),
};

const PLAYER_PRESET_LABELS = {
  single: "Single",
  "split-screen": "Split-screen (2)",
  "split-quadrant": "Split / Quadrant (3)",
  quadrant: "Quadrant (4)",
  "focus-3": "Focus + 3",
  "grid-6": "Grid (6)",
  "grid-9": "Wall (9)",
  custom: "Custom",
};

const PLAYER_CHAT_RAIL_KEY = "strivo-player-chat-rail-open";
function loadPlayerChatRailOpen() {
  try { return localStorage.getItem(PLAYER_CHAT_RAIL_KEY) === "1"; } catch (_) { return false; }
}
function savePlayerChatRailOpen() {
  try { localStorage.setItem(PLAYER_CHAT_RAIL_KEY, playerState.chatRailOpen ? "1" : "0"); } catch (_) {}
}

const playerState = {
  layout: null,        // root layout node
  preset: "single",    // last-applied preset name (for the toolbar label)
  soloPath: "",        // path to soloed (audible) slot — "" = mute-all
  refreshTimer: null,
  resizeFx: null,      // gutter drag state
  chatRailOpen: loadPlayerChatRailOpen(),  // right-rail chat persistence
  chatRailRoom: null,  // currently-rendered room (Twitch login) on the rail
  chatRailMount: null, // teardown handle from mountChatRail
  chatRailLastStreams: [], // last streams[] cache for toggle re-reconciliation
  chatRailCompose: null,   // mountChatCompose controller for the rail
  lastPaintedLayout: null, // snapshot used by tryPatchPlayerStage to diff
  autoplay: loadPlayerAutoplay(), // wall-wide default; false = open paused
  playing: [],         // paths the viewer explicitly started while paused
  // contentKey -> PlayerController. Outlives every repaint; see the
  // "Player controllers" block for why ownership is not in the DOM.
  controllers: new Map(),
  volumes: loadTileVolumes(), // contentKey -> 0..1; muted is volume === 0
};

// Path strings are dot-joined sequences of "a"/"b" descending the tree.
// Root = "". Example: "a.b" → root.a.b.
function pathParts(path) { return path ? path.split(".") : []; }
function pathStr(parts) { return parts.join("."); }

// Walk a layout. Calls cb(node, path) for every node (depth-first).
function walkLayout(layout, cb, path = "") {
  cb(layout, path);
  if (layout.kind === "split") {
    walkLayout(layout.a, cb, path ? `${path}.a` : "a");
    walkLayout(layout.b, cb, path ? `${path}.b` : "b");
  }
}

function countLeaves(layout) {
  let n = 0;
  walkLayout(layout, (node) => { if (node.kind === "slot") n++; });
  return n;
}

// Collect every live-Twitch tile in layout order. The chat rail uses
// this to render a PFP/letter-avatar strip the user can tap to swap
// chat rooms. YouTube/Patreon are skipped — only Twitch chat is wired
// end-to-end on the SPA today.
function collectChatableStreams(streams) {
  if (!streams || streams.length === 0 || !playerState.layout) return [];
  const seen = new Set();
  const out = [];
  walkLayout(playerState.layout, (n, path) => {
    if (n.kind !== "slot" || !n.streamId) return;
    if (seen.has(n.streamId)) return;
    const s = streams.find((x) => x.stream_id === n.streamId);
    // Only Twitch chat is wired end-to-end on the SPA. The backend
    // returns the platform tag in lowercase; the rest of the SPA uses
    // the canonical capitalised form. Accept both.
    if (!s) return;
    const plat = (s.platform || "").toLowerCase();
    if (plat !== "twitch") return;
    seen.add(n.streamId);
    out.push({ stream: s, path });
  });
  return out;
}

// Default stream for the rail when the user hasn't explicitly picked
// one (or the previously-picked stream dropped off): solo wins, else
// first chatable tile in layout order.
function derivePlayerChatDefault(streams) {
  const chatable = collectChatableStreams(streams);
  if (chatable.length === 0) return null;
  const soloPath = playerState.soloPath || "";
  if (soloPath) {
    const soloed = chatable.find((c) => c.path === soloPath);
    if (soloed) return soloed.stream;
  }
  return chatable[0].stream;
}

// Reconcile the chat rail against the current layout + streams. Idempotent;
// safe to call after every player paint. Honours the user's explicit room
// pick when it's still in the layout, else falls back to the focus default.
function reconcilePlayerChatRail(streams) {
  const rail = document.getElementById("player-chat-rail");
  if (!rail) return;
  const body = rail.querySelector(".player-chat-rail-body");
  const tabs = rail.querySelector(".player-chat-rail-tabs");
  const roomLabel = rail.querySelector(".player-chat-rail-room");
  if (!body || !tabs) return;

  if (!playerState.chatRailOpen) {
    if (playerState.chatRailMount) {
      try { playerState.chatRailMount.teardown(); } catch (_) {}
      playerState.chatRailMount = null;
    }
    if (playerState.chatRailCompose) {
      try { playerState.chatRailCompose.teardown(); } catch (_) {}
      playerState.chatRailCompose = null;
    }
    playerState.chatRailRoom = null;
    tabs.innerHTML = "";
    body.innerHTML = "";
    if (roomLabel) roomLabel.textContent = "";
    return;
  }

  const chatable = collectChatableStreams(streams);
  // PFP/letter-avatar strip. Click to override follow-focus and switch
  // the rail to that channel's chat.
  tabs.innerHTML = chatable.map(({ stream: s }) => {
    const room = (s.channel_name || "").toLowerCase();
    const display = s.channel_name || room;
    const hue = chatAvatarHue(display);
    const active = room === playerState.chatRailRoom ? " active" : "";
    return `
      <button class="player-chat-rail-tab${active}" type="button"
              data-room="${htmlEscape(room)}"
              data-stream-id="${htmlEscape(s.stream_id)}"
              title="Chat: ${htmlEscape(display)}">
        <span class="player-chat-rail-avatar"
              style="background:hsl(${hue} 55% 32%);">${htmlEscape(display.slice(0, 1).toUpperCase())}</span>
      </button>`;
  }).join("");
  tabs.querySelectorAll(".player-chat-rail-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const room = btn.dataset.room || "";
      if (!room || room === playerState.chatRailRoom) return;
      playerState.chatRailRoom = room;
      reconcilePlayerChatRail(playerState.chatRailLastStreams);
    });
  });

  // Resolve target room: respect explicit pick if still valid; else
  // fall back to the default (solo / first leaf).
  const validRooms = new Set(chatable.map((c) => (c.stream.channel_name || "").toLowerCase()));
  let targetRoom = playerState.chatRailRoom;
  if (!targetRoom || !validRooms.has(targetRoom)) {
    const def = derivePlayerChatDefault(streams);
    targetRoom = def ? (def.channel_name || "").toLowerCase() : null;
  }

  // Resolve the platform of the target room — drives the compose-bar
  // per-platform accent. chat-rooms metadata may report `youtube`
  // (rejected for chat today, connectable:false), so we coerce here.
  const targetMeta = (chatState.rooms || []).find((r) => r.room === targetRoom);
  const targetPlatform = (targetMeta?.platform || "twitch").toLowerCase();

  if (targetRoom === (playerState.chatRailMount ? playerState.chatRailRoom : null) && targetRoom) {
    // Already mounted to the right room — just sync UI bits.
    playerState.chatRailRoom = targetRoom;
    if (roomLabel) roomLabel.textContent = `#${targetRoom}`;
    tabs.querySelectorAll(".player-chat-rail-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.room === targetRoom);
    });
    if (playerState.chatRailCompose) {
      playerState.chatRailCompose.setRoom(targetRoom, targetPlatform);
    }
    return;
  }

  // Different room (or first mount, or no room): drop old, mount new.
  if (playerState.chatRailMount) {
    try { playerState.chatRailMount.teardown(); } catch (_) {}
    playerState.chatRailMount = null;
  }
  playerState.chatRailRoom = targetRoom;
  if (!targetRoom) {
    body.innerHTML = `<div class="player-chat-rail-empty pg-cap-hint">No Twitch stream in the layout.</div>`;
    if (roomLabel) roomLabel.textContent = "—";
    // Tear down compose too — nothing to send to.
    if (playerState.chatRailCompose) {
      try { playerState.chatRailCompose.teardown(); } catch (_) {}
      playerState.chatRailCompose = null;
    }
    return;
  }
  if (roomLabel) roomLabel.textContent = `#${targetRoom}`;
  tabs.querySelectorAll(".player-chat-rail-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.room === targetRoom);
  });

  // Ensure the compose bar exists — mount once per rail-open session,
  // then call setRoom on each subsequent target change.
  const composeHost = rail.querySelector("#player-chat-rail-compose");
  if (composeHost && !playerState.chatRailCompose) {
    composeHost.innerHTML = "";
    playerState.chatRailCompose = mountChatCompose(composeHost, {
      room: targetRoom,
      platform: targetPlatform,
      compact: true,
    });
  }

  // Mount the message body for the target room.
  const proceed = () => {
    if (playerState.chatRailRoom !== targetRoom) return; // race: another switch landed
    playerState.chatRailMount = mountChatRail(body, targetRoom);
    if (playerState.chatRailCompose) {
      playerState.chatRailCompose.setRoom(targetRoom, targetPlatform);
    }
  };
  // Pre-populate the rooms cache if the rail came up before /chat
  // ever ran (otherwise per-channel emote/badge prefetch can't find
  // user_id).
  if (!chatState.rooms || chatState.rooms.length === 0) {
    API.chatRooms()
      .then((r) => { chatState.rooms = r.rooms || []; proceed(); })
      .catch(() => proceed());
  } else {
    proceed();
  }
}

// Stage size handed to /multistream/tiles. Fixed for now; the layout lane
// replaces this with a measurement of the real stage.
function stageGeometry() {
  return { w: 800, h: 450 };
}

function getNodeAt(layout, path) {
  let n = layout;
  for (const step of pathParts(path)) n = n[step];
  return n;
}

// Replace the node at path with newNode (immutably-ish — we structuredClone
// the root and patch). Returns the new root.
function setNodeAt(layout, path, newNode) {
  const root = structuredClone(layout);
  if (!path) return newNode;
  const parts = pathParts(path);
  let parent = root;
  for (let i = 0; i < parts.length - 1; i++) parent = parent[parts[i]];
  parent[parts[parts.length - 1]] = newNode;
  return root;
}

function savePlayerLayout() {
  try {
    localStorage.setItem(PLAYER_LAYOUT_KEY, JSON.stringify(playerState.layout));
    localStorage.setItem(PLAYER_PRESET_KEY, playerState.preset);
  } catch (_) {}
}

// Validate a parsed layout tree. Rejects null/undefined, unknown kinds,
// out-of-range ratios, malformed children. Recursive — every node has
// to pass on its own merits.
function validatePlayerLayout(node) {
  if (!node || typeof node !== "object") return false;
  if (node.kind === "slot") {
    // streamId / recordingId either null/undefined or non-empty string.
    if (node.streamId !== null && node.streamId !== undefined && typeof node.streamId !== "string") return false;
    if (node.recordingId !== null && node.recordingId !== undefined && typeof node.recordingId !== "string") return false;
    return true;
  }
  if (node.kind === "split") {
    if (node.dir !== "h" && node.dir !== "v") return false;
    if (typeof node.ratio !== "number" || node.ratio <= 0 || node.ratio >= 1) return false;
    return validatePlayerLayout(node.a) && validatePlayerLayout(node.b);
  }
  return false;
}

function loadPlayerLayout() {
  try {
    const raw = localStorage.getItem(PLAYER_LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (validatePlayerLayout(parsed)) {
        playerState.layout = parsed;
        playerState.preset = localStorage.getItem(PLAYER_PRESET_KEY) || "custom";
        return;
      }
    }
  } catch (_) {}
  // Anything invalid drops back to a single empty slot. The user is
  // never silently stuck with a corrupted layout.
  playerState.layout = PLAYER_PRESETS.single();
  playerState.preset = "single";
}

async function renderWatch() {
  // teardownAcrossRoutes() in render() already cleared any prior refresh
  // poll (playerState.refreshTimer + the legacy _watchRefreshTimer
  // alias). A12 consolidation — don't duplicate the clear here.
  if (!playerState.layout) loadPlayerLayout();

  // Honour URL params from rail / dashboard clicks:
  //   ?focus=<streamId>      → load that LIVE stream into the (empty) single slot
  //   ?recording=<recId>     → load that RECORDING into the (empty) single slot
  // 'fresh=1' forces a single-slot reset before loading so the user
  // doesn't end up dropping a click target into a stale multi-tile layout.
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const focusId = params.get("focus") || "";
  const recordingId = params.get("recording") || "";
  const fresh = params.get("fresh") === "1";
  const seekTo = parseFloat(params.get("t") || "0") || 0;
  // B12: explicit null/undefined check — a serialised slot with
  // streamId: "" should still be treated as empty here.
  const slotIsEmpty = playerState.layout.kind === "slot"
    && (playerState.layout.streamId == null || playerState.layout.streamId === "")
    && (playerState.layout.recordingId == null || playerState.layout.recordingId === "");
  if (focusId || recordingId) {
    const target = recordingId ? _slot(null, recordingId) : _slot(focusId);
    if (fresh || slotIsEmpty || playerState.layout.kind === "slot") {
      // Single-tile layout (or an explicit reset): the request owns the wall.
      // This used to require the slot be EMPTY, so clicking a live channel
      // while the last thing you watched was still loaded silently did
      // nothing and left you staring at that old recording.
      playerState.preset = "single";
      playerState.layout = target;
    } else {
      // Multi-tile: honour the click without destroying the wall — fill the
      // first empty tile, else replace the first one.
      const dest = firstEmptyPath(playerState.layout) ?? firstLeafPath(playerState.layout);
      if (dest !== null && dest !== undefined) {
        playerState.layout = setNodeAt(playerState.layout, dest, target);
      }
    }
    // An explicit "watch this" click is a request to watch it, so it starts
    // playing even though the wall opens paused by default.
    setTilePlaying(target, true);
    savePlayerLayout();
  }

  // Channel + recording caches are guaranteed hydrated by render()'s
  // ensureRouteHydration() before this runs.
  // The watch root holds a `.watch-content` (toolbar + stage) and an
  // `<aside class="player-chat-rail">` that follows the focused tile.
  // The rail can be collapsed via the toggle; its open/closed state
  // persists in localStorage.
  const railOpen = playerState.chatRailOpen ? "true" : "false";
  const railToggleGlyph = playerState.chatRailOpen ? "▶" : "◀";
  const railTitle = playerState.chatRailOpen ? "Collapse chat rail" : "Open chat rail";
  root.innerHTML = chrome(`
    <div id="watch" class="watch-root ${playerState.chatRailOpen ? "has-chat-rail" : ""}" role="main">
      <div class="watch-content"><div class="empty">Loading…</div></div>
      <aside class="player-chat-rail" id="player-chat-rail" data-open="${railOpen}">
        <div class="player-chat-rail-head">
          <button class="player-chat-rail-toggle sm" id="player-chat-rail-toggle"
                  type="button" title="${railTitle}" aria-pressed="${railOpen}">${railToggleGlyph}</button>
          <span class="player-chat-rail-title">Chat</span>
          <span class="player-chat-rail-room"></span>
        </div>
        <div class="player-chat-rail-tabs" role="tablist"
             title="Tap a stream to switch chats"></div>
        <div class="player-chat-rail-body" role="log" aria-live="polite"></div>
        <div class="player-chat-rail-compose" id="player-chat-rail-compose"></div>
      </aside>
    </div>
  `);
  setupChromeHandlers();
  const watch = document.getElementById("watch");
  const watchContent = watch.querySelector(".watch-content");

  // Rail toggle — flip persisted state, sync class + glyph, reconcile.
  document.getElementById("player-chat-rail-toggle")?.addEventListener("click", () => {
    playerState.chatRailOpen = !playerState.chatRailOpen;
    savePlayerChatRailOpen();
    watch.classList.toggle("has-chat-rail", playerState.chatRailOpen);
    const rail = document.getElementById("player-chat-rail");
    if (rail) rail.dataset.open = playerState.chatRailOpen ? "true" : "false";
    const btn = document.getElementById("player-chat-rail-toggle");
    if (btn) {
      btn.textContent = playerState.chatRailOpen ? "▶" : "◀";
      btn.title = playerState.chatRailOpen ? "Collapse chat rail" : "Open chat rail";
      btn.setAttribute("aria-pressed", playerState.chatRailOpen ? "true" : "false");
    }
    reconcilePlayerChatRail(playerState.chatRailLastStreams);
  });

  let resp;
  try {
    // Backend still drives 'which live streams are present + embed URLs';
    // we ignore its tile geometry and lay things out via the layout tree.
    resp = await API.multistreamTiles(stageGeometry().w, stageGeometry().h, { mode: "auto" }, window.location.host);
  } catch (e) {
    watchContent.innerHTML = `<div class="empty"><div class="glyph">⚠</div>${htmlEscape(e.message)}</div>`;
    return;
  }
  // `let`, not `const`: the background refresh below updates this baseline
  // in place when the live-set changes, so a one-off go-live/offline doesn't
  // make every subsequent tick compare against a stale set.
  let streams = resp.streams || [];
  playerState.chatRailLastStreams = streams;
  paintPlayerStage(watchContent, streams);
  reconcilePlayerChatRail(streams);
  // Apply ?t=<sec> from in-context tools (Crunchr transcript jump,
  // cuepoints tick, EDL jumps) once the video element has rendered.
  if (seekTo > 0) {
    setTimeout(() => {
      const v = watchContent.querySelector("video.ms-video");
      if (v) {
        const apply = () => { try { v.currentTime = seekTo; v.play?.(); } catch (_) {} };
        if (v.readyState >= 1) apply();
        else v.addEventListener("loadedmetadata", apply, { once: true });
      }
    }, 0);
  }

  // Background refresh: poll the tiles endpoint every 30s and patch the
  // per-tile viewer counts in place. Avoids tearing the iframes (the
  // streams keep playing) but keeps the meta-line fresh.
  playerState.refreshTimer = setInterval(async () => {
    if (document.hidden) return;
    try {
      const r = await API.multistreamTiles(stageGeometry().w, stageGeometry().h, { mode: "auto" }, window.location.host);
      const byId = new Map((r.streams || []).map((s) => [s.stream_id, s]));
      const have = new Set(streams.map((s) => s.stream_id));
      const got = new Set([...byId.keys()]);
      const sameSet = have.size === got.size && [...have].every((x) => got.has(x));
      if (!sameSet) {
        // Live-set changed (a followed channel went live/offline — routine
        // with a dozen follows). Repaint via paintPlayerStage, NOT
        // renderWatch: paintPlayerStage's fast path patches only the slots
        // whose contents actually changed and re-attaches the still-playing
        // iframes, so the rail's stream-picker refreshes without reloading
        // the open stream. It also rebuilds the rail itself.
        //
        // Calling renderWatch here was the reload bug: it did a full
        // root.innerHTML reset (remounting every iframe) AND armed a fresh
        // 30s interval without clearing this one. Because each interval's
        // `streams` baseline was frozen, a single set change made it mismatch
        // forever — so it pumped a renderWatch every tick, the intervals
        // multiplied, and the player reloaded on a ~30-90s beat.
        //
        // Update the baseline so the next tick compares against reality.
        streams = r.streams || [];
        playerState.chatRailLastStreams = streams;
        paintPlayerStage(watchContent, streams);
        return;
      }
      // Same set — patch viewer counts in place.
      watchContent.querySelectorAll(".ms-leaf").forEach((tile) => {
        const s = byId.get(tile.dataset.streamId);
        if (!s) return;
        const meta = tile.querySelector('[data-watch-meta="viewers"]');
        if (meta && s.viewer_count != null) meta.textContent = formatCount(s.viewer_count);
      });
    } catch (_) {}
  }, 30000);
  // A12: keep the legacy _watchRefreshTimer in sync so any external
  // teardown (test harness, browser extension) that knew about the
  // old name still works during the deprecation window.
  _watchRefreshTimer = playerState.refreshTimer;
}

// ── Player stage rendering + interactions ────────────────────────────
//
// paintPlayerStage walks the layout tree, emits HTML, then wires every
// interaction (preset menu, split buttons, gutter drag, slot stream
// picker, click-to-swap drag-drop, fullscreen, solo).

// True iff two layouts have an identical tree shape (kind + split dir at
// every node). Slot contents (streamId / recordingId) may differ; that
// is the patchable subset. Anything else (split→slot, dir flip, etc.)
// triggers a full repaint.
function sameLayoutShape(a, b) {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "split") {
    return a.dir === b.dir && sameLayoutShape(a.a, b.a) && sameLayoutShape(a.b, b.b);
  }
  return true; // both slots — shape matches regardless of content
}

// Re-bind interactive handlers on a single freshly-replaced .ms-leaf
// tile. Mirrors the per-tile loops at the bottom of paintPlayerStage so
// surgical patches don't need a full repaint just to wire up drag /
// drop / solo / fs / remove / slot-picker on one tile.
function wireTileHandlers(tile, stage, watch, streams) {
  // Tile-source drag (populated tiles only).
  if (tile.dataset.streamId || tile.dataset.recordingId) {
    tile.draggable = true;
    tile.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", `strivo-tile:${tile.dataset.path || ""}`);
      e.dataTransfer.effectAllowed = "move";
      tile.classList.add("is-dragging");
    });
    tile.addEventListener("dragend", () => tile.classList.remove("is-dragging"));
  }
  // Drop targets — every tile, populated or empty.
  tile.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    tile.classList.add("is-drop-target");
  });
  tile.addEventListener("dragleave", () => tile.classList.remove("is-drop-target"));
  tile.addEventListener("drop", (e) => {
    e.preventDefault();
    tile.classList.remove("is-drop-target");
    const parsed = parsePlayerDragPayload(e.dataTransfer.getData("text/plain"));
    const toPath = tile.dataset.path || "";
    if (!parsed) return;
    if (parsed.type === "tile") {
      const fromPath = parsed.path;
      if (fromPath === toPath) return;
      const fromNode = getNodeAt(playerState.layout, fromPath);
      const toNode = getNodeAt(playerState.layout, toPath);
      let next = setNodeAt(
        playerState.layout,
        fromPath,
        _slot(toNode.streamId || null, toNode.recordingId || null),
      );
      next = setNodeAt(
        next,
        toPath,
        _slot(fromNode.streamId || null, fromNode.recordingId || null),
      );
      playerState.layout = next;
      savePlayerLayout();
      paintPlayerStage(watch, streams);
      return;
    }
    if (parsed.type === "stream") {
      playerState.layout = setNodeAt(playerState.layout, toPath, _slot(parsed.id, null));
      savePlayerLayout();
      // If the dropped stream isn't in our current cache (rail showed
      // it as live but the multistream snapshot is stale — race between
      // the channels poll and the tiles poll), refresh before
      // repainting so renderSlot can resolve the embed URL. Without
      // this the dropped tile renders the "Stream offline" pill even
      // though the channel is fine — the bug the user kept hitting.
      if (!streams.find((x) => x.stream_id === parsed.id)) {
        API.multistreamTiles(stageGeometry().w, stageGeometry().h, { mode: "auto" }, window.location.host)
          .then((resp) => {
            const fresh = resp.streams || [];
            playerState.chatRailLastStreams = fresh;
            paintPlayerStage(watch, fresh);
          })
          .catch((err) => {
            Toast.error(`Couldn't load dropped stream: ${err && err.message || err}`);
            paintPlayerStage(watch, streams);
          });
        return;
      }
      paintPlayerStage(watch, streams);
      return;
    }
    if (parsed.type === "recording") {
      playerState.layout = setNodeAt(playerState.layout, toPath, _slot(null, parsed.id));
      savePlayerLayout();
      paintPlayerStage(watch, streams);
    }
  });

  // Focus on background click (not on buttons / iframe / picker).
  tile.addEventListener("mousedown", (e) => {
    if (e.target.closest("button, select, iframe")) return;
    stage.querySelectorAll(".ms-leaf.is-focused").forEach((x) => x.classList.remove("is-focused"));
    tile.classList.add("is-focused");
  });

  // Empty-slot stream picker.
  const sel = tile.querySelector("select.ms-slot-pick");
  if (sel) {
    sel.addEventListener("change", () => {
      const path = sel.dataset.path || "";
      const val = sel.value;
      if (!val) return;
      let next;
      if (val.startsWith("rec:")) next = _slot(null, val.slice(4));
      else if (val.startsWith("live:")) next = _slot(val.slice(5), null);
      else next = _slot(val);
      playerState.layout = setNodeAt(playerState.layout, path, next);
      savePlayerLayout();
      paintPlayerStage(watch, streams);
    });
  }

  wireTileChrome(tile, { stage, watch, streams });
}

// Try to apply a slot-content diff between `prev` and `curr` without
// rebuilding the whole stage. Returns true if the patch succeeded
// (caller can skip the full repaint).
//
// Preserves existing iframes for any slot whose streamId/recordingId is
// unchanged — Twitch embeds pause/reload on DOM detach, so the only
// safe way to "add a stream" without nuking the others is to leave
// their tile DOM entirely alone. Falls back to a full repaint when the
// tree shape changes (split / collapse / preset switch).
function tryPatchPlayerStage(watch, prev, curr, streams) {
  const stage = watch.querySelector(".ms-stage");
  if (!stage || !prev || !sameLayoutShape(prev, curr)) return false;

  // Walk both trees in lockstep, patching only slots whose content
  // changed. The mute state for unchanged tiles is also reapplied
  // (mute is a function of soloPath, not slot content).
  const work = [];
  (function walkParallel(p, c, path) {
    if (p.kind === "split") {
      walkParallel(p.a, c.a, path ? `${path}.a` : "a");
      walkParallel(p.b, c.b, path ? `${path}.b` : "b");
      return;
    }
    work.push({ path, prevNode: p, currNode: c });
  })(prev, curr, "");

  for (const { path, prevNode, currNode } of work) {
    const tile = stage.querySelector(`.ms-leaf[data-path="${cssEscape(path)}"]`);
    if (!tile) return false; // shape thought it was the same but DOM disagrees → bail
    const sameContent =
      (prevNode.streamId || null) === (currNode.streamId || null) &&
      (prevNode.recordingId || null) === (currNode.recordingId || null);
    if (sameContent) {
      // Same content. Mute may have flipped; the controller owns how that
      // is applied, so this path no longer touches media elements at all.
      const muted = computeMuted(path);
      // Swap solo/unsolo button label.
      const soloBtn = tile.querySelector(".ms-solo, .ms-unsolo");
      if (soloBtn) {
        if (muted && !soloBtn.classList.contains("ms-solo")) {
          soloBtn.classList.remove("ms-unsolo");
          soloBtn.classList.add("ms-solo");
          soloBtn.textContent = "🔇";
          soloBtn.title = "Unmute (solo this tile)";
        } else if (!muted && !soloBtn.classList.contains("ms-unsolo")) {
          soloBtn.classList.remove("ms-solo");
          soloBtn.classList.add("ms-unsolo");
          soloBtn.textContent = "🔊";
          soloBtn.title = "Mute (mute-all)";
        }
      }
      continue;
    }
    // Content changed. Render the new tile, swap it in, re-wire it.
    // Existing iframes in OTHER tiles never get detached — only this
    // tile's old element does.
    const tmp = document.createElement("div");
    tmp.innerHTML = renderSlot(currNode, path, streams);
    const newTile = tmp.firstElementChild;
    if (!newTile) return false;
    tile.replaceWith(newTile);
    wireTileHandlers(newTile, stage, watch, streams);
  }

  // Apply mute / mount any tile this patch swapped in. The patch path
  // edits tiles in place, so without this a solo change would update the
  // button label and nothing else.
  reconcileControllers(watch.querySelector(".ms-stage"));

  // Toolbar reflects layout-aware bits (preset label, leaf count,
  // mute-all pressed state). Tree shape didn't change, so the only
  // things that can shift are leaf-count (same — slots unchanged) and
  // the mute-all pressed state.
  const muteAll = watch.querySelector("#watch-mute-all");
  if (muteAll) muteAll.classList.toggle("active", !playerState.soloPath);
  return true;
}

// Robust CSS attribute-selector escaping for data-path values (root is
// "" and paths are alphabetic). Falls back when the browser lacks
// CSS.escape (some older runtimes).
function cssEscape(s) {
  if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return String(s).replace(/[^A-Za-z0-9_-]/g, (m) => `\\${m}`);
}

function paintPlayerStage(watch, streams) {
  const layout = playerState.layout;
  // Fast path: if the tree shape didn't change, patch only the slots
  // whose contents differ. Unchanged tiles' DOM is never touched, so
  // their iframes never detach — adding / removing / dropping a
  // single stream no longer reloads the others. Falls through to the
  // full repaint when the tree shape changes (split / collapse / preset
  // switch / first paint).
  if (playerState.lastPaintedLayout
      && tryPatchPlayerStage(watch, playerState.lastPaintedLayout, layout, streams)) {
    playerState.lastPaintedLayout = structuredClone(layout);
    playerState.chatRailLastStreams = streams;
    reconcilePlayerChatRail(streams);
    return;
  }
  const leaves = countLeaves(layout);

  // Build the preset menu (rendered as a details element). The current
  // preset's label is the summary; click expands to the option list.
  const presetLabel = PLAYER_PRESET_LABELS[playerState.preset] || "Custom";
  const presetOpts = Object.entries(PLAYER_PRESET_LABELS).map(([k, v]) => `
    <button class="sm ms-preset-opt${k === playerState.preset ? " active" : ""}" type="button" data-preset="${k}">${htmlEscape(v)}</button>`).join("");

  // Toolbar — preset dropdown · split buttons (custom-mode) · mute-all.
  const muteAllPressed = playerState.soloPath ? "" : "active";
  const customTools = playerState.preset === "custom" ? `
    <span class="watch-tb-sep" aria-hidden="true">·</span>
    <span class="pg-cap-hint">Focus a tile, then split:</span>
    <button class="sm ms-split-h" type="button" title="Split focused tile horizontally (side-by-side)">▥ Split H</button>
    <button class="sm ms-split-v" type="button" title="Split focused tile vertically (top + bottom)">▤ Split V</button>
    <button class="sm ms-collapse" type="button" title="Collapse the focused tile back into its sibling">↶ Undo split</button>` : "";
  const toolbar = `
    <div class="watch-toolbar">
      <span class="watch-count pg-cap-hint">${streams.length} live · ${leaves}/${PLAYER_LEAF_CAP} tile${leaves === 1 ? "" : "s"}</span>
      <details class="ms-preset" id="ms-preset-menu">
        <summary class="sm ms-preset-summary" title="Multi-stream layout presets">▦ Multi-stream: ${htmlEscape(presetLabel)} ▾</summary>
        <div class="ms-preset-menu">${presetOpts}</div>
      </details>
      ${customTools}
      <span class="watch-tb-sep" aria-hidden="true">·</span>
      <button class="sm ms-compose-open" id="ms-compose-open" type="button"
              title="Open the multi-view composer — drag streams onto the plane">⊞ Compose</button>
      <button class="sm watch-playall ${playerState.autoplay ? "active" : ""}" id="watch-playall"
              type="button" title="${playerState.autoplay ? "Pause every tile" : "Start every tile"}">${playerState.autoplay ? "⏸ Pause all" : "▶ Play all"}</button>
      <button class="sm watch-mute-all ${muteAllPressed}" id="watch-mute-all" title="Mute every tile">🔇 Mute all</button>
    </div>`;

  // Capture existing iframes/videos before we blow the stage away so
  // we can re-attach them to the new layout intact. Adding a stream,
  // switching presets, splitting tiles, etc. should not reload the
  // streams that were already playing — only newly-added slots
  // actually need fresh media elements. Keyed by stream/recording id
  // because layout paths shift across operations.
  // No detach/reattach dance any more: controllers are not owned by this
  // DOM, so wiping it cannot destroy a player. Rebuild freely, then let
  // reconcileControllers re-parent the survivors.
  const stage = document.createElement("div");
  stage.className = "ms-stage";
  stage.innerHTML = renderLayoutNode(layout, "", streams);

  watch.innerHTML = "";
  watch.insertAdjacentHTML("beforeend", toolbar);
  watch.appendChild(stage);

  reconcileControllers(stage);

  // ── Preset menu ──
  watch.querySelectorAll(".ms-preset-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.preset;
      if (!PLAYER_PRESETS[p]) return;
      // Preserve any populated streams across the preset switch. The
      // user expects 'go from single to quadrant' to keep the open
      // stream in the first slot, not to wipe it. Collect every
      // populated slot from the current layout (depth-first, a→b),
      // build the fresh preset, then refill the first N empty slots
      // with the preserved streams in order.
      const preserved = [];
      // Also capture which source path was previously soloed so the
      // user's audio choice survives the layout switch.
      const prevSoloPath = playerState.soloPath || "";
      walkLayout(playerState.layout, (n, path) => {
        if (n.kind === "slot" && (n.streamId || n.recordingId)) {
          preserved.push({ streamId: n.streamId || null, recordingId: n.recordingId || null, wasSoloed: path === prevSoloPath });
        }
      });
      let next = PLAYER_PRESETS[p]();
      let newSoloPath = "";
      if (preserved.length) {
        const slotPaths = [];
        walkLayout(next, (n, path) => {
          if (n.kind === "slot") slotPaths.push(path);
        });
        for (let i = 0; i < Math.min(preserved.length, slotPaths.length); i++) {
          next = setNodeAt(next, slotPaths[i], _slot(preserved[i].streamId, preserved[i].recordingId));
          if (preserved[i].wasSoloed) newSoloPath = slotPaths[i];
        }
      }
      playerState.preset = p;
      playerState.layout = next;
      // Restore soloPath if the soloed source landed in the new layout.
      if (newSoloPath) playerState.soloPath = newSoloPath;
      else if (prevSoloPath) playerState.soloPath = ""; // its source dropped off — fall back to mute-all
      savePlayerLayout();
      paintPlayerStage(watch, streams);
    });
  });

  // ── Custom-mode split / collapse ──
  const splitFocused = (dir) => {
    const focused = stage.querySelector(".ms-leaf.is-focused") || stage.querySelector(".ms-leaf");
    if (!focused) return;
    const path = focused.dataset.path || "";
    if (countLeaves(playerState.layout) >= PLAYER_LEAF_CAP) {
      Toast.error(`Tile cap reached (${PLAYER_LEAF_CAP}) — collapse a tile first.`);
      return;
    }
    const node = getNodeAt(playerState.layout, path);
    if (node.kind !== "slot") return;
    const next = _split(dir, 0.5, _slot(node.streamId), _slot());
    playerState.layout = setNodeAt(playerState.layout, path, next);
    playerState.preset = "custom";
    savePlayerLayout();
    paintPlayerStage(watch, streams);
  };
  watch.querySelector(".ms-split-h")?.addEventListener("click", () => splitFocused("h"));
  watch.querySelector(".ms-split-v")?.addEventListener("click", () => splitFocused("v"));
  watch.querySelector(".ms-collapse")?.addEventListener("click", () => {
    const focused = stage.querySelector(".ms-leaf.is-focused") || stage.querySelector(".ms-leaf");
    if (!focused) return;
    const path = focused.dataset.path || "";
    if (!path) return; // can't collapse the root
    const parts = pathParts(path);
    const parentPath = pathStr(parts.slice(0, -1));
    const parent = getNodeAt(playerState.layout, parentPath);
    if (!parent || parent.kind !== "split") return;
    const siblingKey = parts[parts.length - 1] === "a" ? "b" : "a";
    playerState.layout = setNodeAt(playerState.layout, parentPath, parent[siblingKey]);
    playerState.preset = "custom";
    savePlayerLayout();
    paintPlayerStage(watch, streams);
  });

  // Per-tile interactions (dragstart on populated, drop targets on all,
  // slot picker on empty, solo/fs/remove on populated). Single source
  // of truth — `wireTileHandlers` is also called by the in-place patch
  // path so a surgical tile replacement gets identical wiring.
  stage.querySelectorAll(".ms-leaf").forEach((tile) => {
    wireTileHandlers(tile, stage, watch, streams);
  });

  // Mute-all toolbar button: top-level, not per-tile.
  watch.querySelector("#watch-mute-all")?.addEventListener("click", () => {
    playerState.soloPath = "";
    paintPlayerStage(watch, streams);
  });

  watch.querySelector("#watch-playall")?.addEventListener("click", () => {
    playerState.autoplay = !playerState.autoplay;
    // Pausing the wall also clears per-tile plays, so "Pause all" means it.
    if (!playerState.autoplay) playerState.playing = [];
    savePlayerAutoplay();
    // Full repaint: every tile's src changes, so the patch fast-path has
    // nothing to conserve here.
    playerState.lastPaintedLayout = null;
    paintPlayerStage(watch, streams);
  });

  watch.querySelector("#ms-compose-open")?.addEventListener("click", () => {
    openComposer(watch, streams);
  });

  // Channel-list rail rows are draggable as a stream source. <a> tags
  // are draggable by default (the browser drags the href); our custom
  // dragstart MUST run AND set effectAllowed first so the browser's
  // URL-drag default doesn't win.
  document.querySelectorAll(".ch-row[data-channel-key]").forEach((row) => {
    if (!row.dataset.liveStreamId) return;
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", `strivo-stream:${row.dataset.liveStreamId}`);
      e.dataTransfer.effectAllowed = "copy";
    });
  });

  // ── Resize gutters ──
  stage.querySelectorAll(".ms-gutter").forEach((gutter) => {
    gutter.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const path = gutter.dataset.path || "";
      const split = getNodeAt(playerState.layout, path);
      if (!split || split.kind !== "split") return;
      const parent = gutter.parentElement;
      const rect = parent.getBoundingClientRect();
      const dir = split.dir;
      playerState.resizeFx = { path, parentRect: rect, dir };
      document.body.classList.add("ms-resizing");
      const onMove = (ev) => {
        const fx = playerState.resizeFx;
        if (!fx) return;
        const pos = fx.dir === "h"
          ? (ev.clientX - fx.parentRect.left) / fx.parentRect.width
          : (ev.clientY - fx.parentRect.top) / fx.parentRect.height;
        const ratio = Math.min(0.9, Math.max(0.1, pos));
        const node = getNodeAt(playerState.layout, fx.path);
        node.ratio = ratio;
        // Live update without full repaint — tweak flex on siblings.
        const a = parent.children[0];
        const b = parent.children[2];
        if (a && b) {
          a.style.flex = `${ratio} ${ratio} 0`;
          b.style.flex = `${1 - ratio} ${1 - ratio} 0`;
        }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("ms-resizing");
        playerState.resizeFx = null;
        savePlayerLayout();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });

  // Snapshot the layout we just painted so the next call can try the
  // fast in-place patch path instead of rebuilding the stage. Stashed
  // *after* the full paint so a mid-paint exception doesn't leave the
  // diff comparing against a partial state.
  playerState.lastPaintedLayout = structuredClone(layout);
  playerState.chatRailLastStreams = streams;
  reconcilePlayerChatRail(streams);
}

// Recursive renderer. Returns an HTML string.
function renderLayoutNode(node, path, streams) {
  if (node.kind === "slot") return renderSlot(node, path, streams);
  // Split: flex container with two children + a gutter between.
  const flexDir = node.dir === "h" ? "row" : "column";
  const r = node.ratio;
  return `
    <div class="ms-split ms-split-${node.dir}" style="flex-direction:${flexDir}" data-path="${htmlEscape(path)}">
      <div class="ms-pane" style="flex:${r} ${r} 0">${renderLayoutNode(node.a, path ? `${path}.a` : "a", streams)}</div>
      <div class="ms-gutter ms-gutter-${node.dir}" data-path="${htmlEscape(path)}" title="Drag to resize"></div>
      <div class="ms-pane" style="flex:${1 - r} ${1 - r} 0">${renderLayoutNode(node.b, path ? `${path}.b` : "b", streams)}</div>
    </div>`;
}

// ── Multi-view composer ──────────────────────────────────────────────
//
// A modal for building the wall: pick a tiling, then fill it by dragging
// sources onto cells or by clicking a cell and then a source. Everything
// applies to the live stage immediately — there is no OK/Cancel, because
// the stage behind the modal *is* the preview.
//
// The mini-map renders the same layout tree the stage uses, so cell paths
// and drop semantics are shared with the real tiles rather than reimplemented.
let composerSelectedPath = null;

function composerSourceChips(streams) {
  const live = (streams || []).map((s) => `
    <button type="button" class="msc-src" draggable="true"
            data-src-kind="stream" data-src-id="${htmlEscape(s.stream_id)}"
            title="${htmlEscape(s.channel_name)} · ${htmlEscape(s.platform)}">
      <span class="msc-src-dot ${htmlEscape(String(s.platform || "").toLowerCase())}"></span>
      <span class="msc-src-name">${htmlEscape(s.channel_name)}</span>
      <span class="msc-src-meta">${s.viewer_count != null ? formatCount(s.viewer_count) : "live"}</span>
    </button>`).join("");
  const recs = (recCache || [])
    .filter((r) => r.state === "Finished" && r.file_exists !== false)
    .sort((a, b) => recordingTime(b) - recordingTime(a))
    .slice(0, 12)
    .map((r) => `
    <button type="button" class="msc-src msc-src-rec" draggable="true"
            data-src-kind="rec" data-src-id="${htmlEscape(r.id)}"
            title="${htmlEscape(niceTitle(r.stream_title) || r.channel_name || r.id)}">
      <span class="msc-src-dot rec"></span>
      <span class="msc-src-name">${htmlEscape(niceTitle(r.stream_title) || r.channel_name || r.id.slice(0, 8))}</span>
      <span class="msc-src-meta">${htmlEscape(shortWhen(r.started_at))}</span>
    </button>`).join("");
  return `
    <div class="msc-src-group">
      <div class="msc-src-head">Live now <span class="ch-count">${(streams || []).length}</span></div>
      <div class="msc-src-list">${live || '<div class="empty sm">No live channels</div>'}</div>
    </div>
    <div class="msc-src-group">
      <div class="msc-src-head">Recent recordings</div>
      <div class="msc-src-list">${recs || '<div class="empty sm">No recordings</div>'}</div>
    </div>`;
}

/// Recursively render the layout tree as a proportional mini-map. Mirrors
/// the stage's own geometry so what you arrange is what you get.
function composerMapHtml(node, path, streams) {
  if (!node) return "";
  if (node.kind === "split") {
    const dir = node.dir === "h" ? "row" : "column";
    const ratio = Math.max(0.1, Math.min(0.9, node.ratio ?? 0.5));
    return `
      <div class="msc-split" style="flex-direction:${dir}">
        <div class="msc-branch" style="flex:${ratio}">${composerMapHtml(node.a, path ? path + ".a" : "a", streams)}</div>
        <div class="msc-branch" style="flex:${1 - ratio}">${composerMapHtml(node.b, path ? path + ".b" : "b", streams)}</div>
      </div>`;
  }
  const sel = composerSelectedPath === path ? " is-selected" : "";
  if (node.streamId) {
    const s = (streams || []).find((x) => x.stream_id === node.streamId);
    const name = s ? s.channel_name : node.streamId;
    const stale = s ? "" : " is-stale";
    return `
      <div class="msc-cell is-filled${sel}${stale}" data-path="${htmlEscape(path)}" draggable="true" tabindex="0">
        <span class="msc-cell-name">${htmlEscape(name)}</span>
        ${s ? "" : '<span class="msc-cell-warn">offline</span>'}
        <button type="button" class="msc-cell-clear" data-clear="${htmlEscape(path)}" title="Clear this tile" aria-label="Clear tile">✕</button>
      </div>`;
  }
  if (node.recordingId) {
    const r = (recCache || []).find((x) => x.id === node.recordingId);
    const name = r ? (niceTitle(r.stream_title) || r.channel_name || r.id.slice(0, 8)) : node.recordingId.slice(0, 8);
    return `
      <div class="msc-cell is-filled is-rec${sel}" data-path="${htmlEscape(path)}" draggable="true" tabindex="0">
        <span class="msc-cell-name">${htmlEscape(name)}</span>
        <button type="button" class="msc-cell-clear" data-clear="${htmlEscape(path)}" title="Clear this tile" aria-label="Clear tile">✕</button>
      </div>`;
  }
  return `
    <div class="msc-cell${sel}" data-path="${htmlEscape(path)}" tabindex="0">
      <span class="msc-cell-empty">+</span>
    </div>`;
}

/// Path of the first leaf in reading order, empty or not. Used as the
/// fallback destination when a wall is full but the viewer asked for
/// something specific.
function firstLeafPath(layout) {
  let found = null;
  walkLayout(layout, (node, path) => {
    if (found === null && node.kind === "slot") found = path;
  });
  return found;
}

function firstEmptyPath(layout) {
  let found = null;
  walkLayout(layout, (node, path) => {
    if (found === null && node.kind === "slot" && !node.streamId && !node.recordingId) found = path;
  });
  return found;
}

function openComposer(watch, streams) {
  const existing = document.getElementById("ms-composer");
  if (existing) existing.remove();
  composerSelectedPath = null;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "ms-composer";
  document.body.appendChild(overlay);

  const repaintStage = () => {
    savePlayerLayout();
    playerState.lastPaintedLayout = null;
    paintPlayerStage(watch, streams);
  };

  const draw = () => {
    const presets = Object.entries(PLAYER_PRESET_LABELS)
      .filter(([k]) => k !== "custom")
      .map(([k, v]) => `<button type="button" class="sm msc-preset${k === playerState.preset ? " active" : ""}" data-preset="${k}">${htmlEscape(v)}</button>`)
      .join("");
    overlay.innerHTML = `
      <div class="modal-card msc-card" role="dialog" aria-modal="true" aria-label="Multi-view composer">
        <div class="modal-head">
          <h2 class="msc-title">Multi-view composer</h2>
          <button class="modal-close" data-action="modal-close" aria-label="Close">✕</button>
        </div>
        <div class="msc-body">
          <aside class="msc-sources">${composerSourceChips(streams)}</aside>
          <section class="msc-plane">
            <div class="msc-presets">${presets}</div>
            <div class="msc-map" id="msc-map">${composerMapHtml(playerState.layout, "", streams)}</div>
            <div class="msc-hint pg-cap-hint">
              Drag a source onto a tile, or click a tile then a source. Drag tile-to-tile to swap.
            </div>
          </section>
        </div>
        <div class="msc-foot">
          <label class="msc-toggle">
            <input type="checkbox" id="msc-paused" ${playerState.autoplay ? "" : "checked"}>
            <span>Open paused</span>
          </label>
          <span class="pg-cap-hint">${countLeaves(playerState.layout)}/${PLAYER_LEAF_CAP} tiles</span>
          <span class="msc-foot-spacer"></span>
          <button type="button" class="sm" id="msc-clear-all">Clear all</button>
          <button type="button" class="sm primary" id="msc-playall">${playerState.autoplay ? "⏸ Pause all" : "▶ Play all"}</button>
        </div>
      </div>`;
    wire();
  };

  const assign = (path, kind, id) => {
    // The root tile's path is "", which is falsy — never test these paths
    // for truthiness or a single-tile layout looks like "no tile at all".
    if (path === null || path === undefined) return;
    playerState.layout = setNodeAt(
      playerState.layout,
      path,
      kind === "rec" ? _slot(null, id) : _slot(id, null),
    );
    repaintStage();
    draw();
  };

  const wire = () => {
    overlay.querySelector('[data-action="modal-close"]')?.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll(".msc-preset").forEach((b) => {
      b.addEventListener("click", () => {
        const k = b.dataset.preset;
        if (!PLAYER_PRESETS[k]) return;
        playerState.preset = k;
        playerState.layout = PLAYER_PRESETS[k]();
        playerState.playing = [];
        composerSelectedPath = null;
        repaintStage();
        draw();
      });
    });

    // Sources: draggable, and click-to-assign into the selected (or first
    // empty) cell so the whole flow works without a drag if you prefer.
    overlay.querySelectorAll(".msc-src").forEach((chip) => {
      chip.addEventListener("dragstart", (e) => {
        const kind = chip.dataset.srcKind === "rec" ? "strivo-rec:" : "strivo-stream:";
        e.dataTransfer.setData("text/plain", kind + chip.dataset.srcId);
        e.dataTransfer.effectAllowed = "copy";
      });
      chip.addEventListener("click", () => {
        const target =
          composerSelectedPath !== null ? composerSelectedPath : firstEmptyPath(playerState.layout);
        if (target === null || target === undefined) {
          Toast.error("No empty tile — pick a bigger layout or clear one.");
          return;
        }
        assign(target, chip.dataset.srcKind, chip.dataset.srcId);
      });
    });

    overlay.querySelectorAll(".msc-cell").forEach((cell) => {
      const path = cell.dataset.path || "";
      cell.addEventListener("click", (e) => {
        if (e.target.closest(".msc-cell-clear")) return;
        composerSelectedPath = composerSelectedPath === path ? null : path;
        draw();
      });
      cell.addEventListener("dragover", (e) => {
        e.preventDefault();
        cell.classList.add("is-drop-target");
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("is-drop-target"));
      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        cell.classList.remove("is-drop-target");
        const raw = e.dataTransfer.getData("text/plain") || "";
        if (raw.startsWith("strivo-rec:")) return assign(path, "rec", raw.slice("strivo-rec:".length));
        const parsed = parsePlayerDragPayload(raw);
        if (!parsed) return;
        if (parsed.type === "stream") return assign(path, "stream", parsed.id);
        if (parsed.type === "tile" && parsed.path !== path) {
          const from = getNodeAt(playerState.layout, parsed.path);
          const to = getNodeAt(playerState.layout, path);
          let next = setNodeAt(playerState.layout, parsed.path, _slot(to.streamId || null, to.recordingId || null));
          next = setNodeAt(next, path, _slot(from.streamId || null, from.recordingId || null));
          playerState.layout = next;
          repaintStage();
          draw();
        }
      });
      if (cell.classList.contains("is-filled")) {
        cell.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", `strivo-tile:${path}`);
          e.dataTransfer.effectAllowed = "move";
        });
      }
    });

    overlay.querySelectorAll(".msc-cell-clear").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        playerState.layout = setNodeAt(playerState.layout, btn.dataset.clear || "", _slot());
        repaintStage();
        draw();
      });
    });

    overlay.querySelector("#msc-clear-all")?.addEventListener("click", () => {
      walkLayout(playerState.layout, (node, path) => {
        if (node.kind === "slot") {
          playerState.layout = setNodeAt(playerState.layout, path, _slot());
        }
      });
      repaintStage();
      draw();
    });

    overlay.querySelector("#msc-paused")?.addEventListener("change", (e) => {
      playerState.autoplay = !e.currentTarget.checked;
      if (!playerState.autoplay) playerState.playing = [];
      savePlayerAutoplay();
      repaintStage();
      draw();
    });

    overlay.querySelector("#msc-playall")?.addEventListener("click", () => {
      playerState.autoplay = !playerState.autoplay;
      if (!playerState.autoplay) playerState.playing = [];
      savePlayerAutoplay();
      repaintStage();
      draw();
    });
  };

  draw();
  const onEsc = (e) => {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onEsc); }
  };
  document.addEventListener("keydown", onEsc);
}

/// Poster frame for a paused live tile.
///
/// A paused tile deliberately renders NO iframe: a Twitch/YouTube embed
/// downloads and boots an entire player application even when it is not
/// going to play, which on a 9-tile wall is nine player apps for a grid
/// nobody has pressed play on yet. A still frame costs one image.
function tilePosterUrl(s) {
  if (!s) return null;
  const c = (channelCache || []).find((x) => `${x.platform}:${x.id}` === s.stream_id);
  return c ? liveThumbUrl(c) : null;
}

function renderSlot(slot, path, streams) {
  // Populated tiles (recording or live stream) render in 019a-pvr.js so the
  // player chrome can evolve without touching the layout code here.
  if (slot.recordingId || slot.streamId) return renderPopulatedSlotHtml(slot, path, streams);
  // ─ Empty slot — pickable from live channels + recent recordings ─
  const liveOpts = (streams || []).map((s) =>
    `<option value="live:${htmlEscape(s.stream_id)}">▶ LIVE · ${htmlEscape(s.channel_name)} · ${htmlEscape(s.platform)}</option>`
  ).join("");
  const recOpts = (recCache || [])
    .filter((r) => r.state === "Finished" && r.file_exists !== false)
    .slice(0, 24)
    .map((r) => `<option value="rec:${htmlEscape(r.id)}">📁 REC · ${htmlEscape(niceTitle(r.stream_title) || r.channel_name || r.id.slice(0, 8))}</option>`)
    .join("");
  return `
    <div class="ms-leaf ms-empty" data-path="${htmlEscape(path)}">
      <div class="ms-empty-pill">
        <span>Select stream</span>
        <select class="ms-slot-pick" data-path="${htmlEscape(path)}" aria-label="Pick a stream or recording for this tile">
          <option value="">— pick a live channel or recording —</option>
          ${liveOpts ? `<optgroup label="Live channels">${liveOpts}</optgroup>` : ""}
          ${recOpts ? `<optgroup label="Recent recordings">${recOpts}</optgroup>` : ""}
        </select>
      </div>
      <div class="ms-empty-hint pg-cap-hint">…or drag a channel from the rail.</div>
    </div>`;
}

