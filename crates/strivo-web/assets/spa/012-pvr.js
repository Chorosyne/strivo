    case "chat":
      await renderChat(context);
      break;
    case "settings":
      await renderSettings(context);
      break;
    case "system":
      await renderSystem(context);
      break;
    case "logs":
      await renderLogs(context);
      break;
    case "history":
      // History folded into Recordings as a Timeline view (see the
      // Table|Timeline segmented control in renderRecordings, 012-pvr.js).
      // "history" stays a real ROUTES entry (008-pvr.js) purely so old
      // #/history links/bookmarks still land somewhere instead of 404ing.
      location.hash = "#/recordings?view=timeline";
      return;
  }
}

// ── Edition gating ────────────────────────────────────────────────────
// The SPA bundle is shared by both editions. `creator_enabled` from
// /api/v1/settings says whether this server is the Creator Edition; the
// pure-PVR daemon does not mount the plugin/tooling routes, so those nav
// entries + actions would 404. Default false (a missing flag = PVR/older
// daemon) so we fail closed and hide creator surfaces.
let CREATOR_ENABLED = false;
// Routes whose backend lives behind `--features creator`. (Chat is NOT here:
// it speaks Twitch IRC directly from the browser, so it works in the PVR build.)
const CREATOR_ROUTES = new Set([
  "studio", "analytics", "publish", "pipelines", "plugins", "dataviz", "archive",
]);

// Reduced motion (F-18): the `ui.reduce_motion` setting is a manual override
// on top of the OS-level `prefers-reduced-motion` media query — either one
// being "on" should suppress decorative animation. We track the setting
// value ourselves (settings responses aren't otherwise cached globally) and
// recompute the effective state whenever the setting changes or the OS
// preference flips, so no reload is required either way.
let REDUCE_MOTION_SETTING = false;
const REDUCE_MOTION_QUERY = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;
function applyReducedMotion() {
  const osReduced = !!(REDUCE_MOTION_QUERY && REDUCE_MOTION_QUERY.matches);
  document.documentElement.classList.toggle("reduce-motion", REDUCE_MOTION_SETTING || osReduced);
}
if (REDUCE_MOTION_QUERY) {
  if (REDUCE_MOTION_QUERY.addEventListener) {
    REDUCE_MOTION_QUERY.addEventListener("change", applyReducedMotion);
  } else if (REDUCE_MOTION_QUERY.addListener) {
    // Safari < 14 fallback.
    REDUCE_MOTION_QUERY.addListener(applyReducedMotion);
  }
}
// Apply the OS preference immediately, before settings have loaded, so a
// reduced-motion browser never sees an unsuppressed boot-glyph pulse.
applyReducedMotion();

// Set on the first successful authenticated API call (a login, or — on
// reload with a still-valid session cookie — fetchEdition() itself
// succeeding). Boot-time SSE/Patreon-seed calls wait on this so a
// logged-out visitor doesn't trigger a pre-login fetch storm (008-pvr.js's
// SSE reconnect loop gates its retry on the same flag).
let authed = false;

async function fetchEdition() {
  try {
    const st = await API.settings();
    CREATOR_ENABLED = !!st.creator_enabled;
    REDUCE_MOTION_SETTING = !!(st.ui && st.ui.reduce_motion);
    applyReducedMotion();
    authed = true;
  } catch (_) {
    CREATOR_ENABLED = false;
  }
}

// Top-bar route nav (functional pages). The left rail is the channel
// list now; these icon links reach the management pages.
// Tuple: [route, fallbackGlyph, label, key, iconHref?]
// Eight slots ship Eliver Lara's candy-icons (GPL-3.0, vendored under
// /assets/icons/candy/ with the upstream LICENSE + ATTRIBUTION).
// History has no nav slot of its own any more — it's a Timeline view
// inside Recordings (segmented control in renderRecordings). "history"
// stays a ROUTES entry purely so old #/history links redirect there
// instead of 404ing (render(), 012-pvr.js).
const TOPNAV = [
  // Free panes — capture-loop core.
  ["library", "▣", "Home", "l", "/assets/icons/sweet-folders/folder-home.svg"],
  ["recordings", "📁", "Recordings", "r", "/assets/icons/sweet-folders/folder-videos.svg"],
  ["schedule", "📅", "Monitor", "s", "/assets/icons/candy/schedule.svg"],
  ["watch", "▶", "Player", "w", "/assets/icons/candy/watch.svg"],
  // Pro panes — unified app, each pane bundles every contributing
  // plugin's UI under its own tabs. Discrete plugin entries are kept
  // accessible via /plugins → deep-link rows but no longer hold the
  // primary topnav slot.
  ["studio", "🎬", "Studio", "u", "/assets/icons/candy/plugins.svg"],
  ["analytics", "📈", "Analytics", "a", "/assets/icons/sweet-folders/folder-documents.svg"],
  ["publish", "🚀", "Publish", "p", "/assets/icons/candy/pipelines.svg"],
  // No vendored candy icon for Archive yet — falls back to the glyph.
  ["archive", "🗄", "Archive", "v"],
  ["chat", "💬", "Chat", "t", "/assets/icons/candy/chat.svg"],
  ["settings", "⚙", "Settings", "c", "/assets/icons/candy/settings.svg"],
  ["system", "🛠", "System", "y", "/assets/icons/candy/system.svg"],
  ["logs", "📜", "Logs", "o", "/assets/icons/candy/logs.svg"],
];

function chrome(content) {
  const r = currentRoute();
  // Apply the user's Aeon-style top-nav reorder if any. Unknown
  // entries fall through in their default position so new releases
  // can extend TOPNAV without breaking saved order.
  let layoutOrder;
  try { layoutOrder = JSON.parse(localStorage.getItem("strivo-layout-topnav") || ""); }
  catch { layoutOrder = null; }
  const navItems = Array.isArray(layoutOrder)
    ? [
        ...layoutOrder
          .map((name) => TOPNAV.find((e) => e[0] === name))
          .filter(Boolean),
        ...TOPNAV.filter((e) => !layoutOrder.includes(e[0])),
      ]
    : TOPNAV;
  // Hide Creator Edition routes in the pure-PVR build.
  const visibleNav = CREATOR_ENABLED
    ? navItems
    : navItems.filter((e) => !CREATOR_ROUTES.has(e[0]));
  const nav = visibleNav.map(([route, glyph, label, key, iconHref]) => {
    const inner = iconHref
      ? `<img class="topnav-icon" src="${iconHref}" alt="" />`
      : `<span aria-hidden="true">${glyph}</span>`;
    return `<a class="topnav-link ${route === r ? "active" : ""}"
              href="#/${route}" data-route="${route}" data-key="${key}"
              title="${label}" aria-label="${label}">
            ${inner}
          </a>`;
  }).join("");
  return `
    <div class="chrome">
      <a class="skip-link" href="#content">Skip to content</a>
      <header class="topbar" role="banner">
        <a class="brand" href="#/library" id="brand-home" title="Home">StriVo</a>
        <span id="conn-status" class="conn-status" role="status" hidden
              title="Live updates connection">● reconnecting…</span>
        <a id="health-pill" class="health-pill" href="#/system" hidden
           role="status" title="System health — click for details"></a>
        <span id="rec-slot-pill" class="storage-pill" style="display:none"
              title="Active recordings / concurrent cap — click to manage"
              role="status"></span>
        <span id="route-status" class="conn-status" role="status" aria-live="polite" hidden></span>
        <span class="spacer"></span>
        <nav class="topnav" aria-label="Main navigation">${nav}</nav>
        <button id="add-channel" title="Add a channel to monitor"
                aria-label="Add channel">＋ Add</button>
        <button id="poll-now" title="Poke channel monitor (p)"
                aria-label="Trigger immediate channel poll">↻ Poll</button>
        <button id="logout" title="Logout" aria-label="Sign out">
          <img class="topnav-icon" src="/assets/icons/candy/logout.svg" alt="" />
        </button>
      </header>
      <nav class="leftrail" id="channel-list" aria-label="Channels"></nav>
      <main class="content" id="content" tabindex="-1">${content}</main>
    </div>
  `;
}

// Keep the navigation chrome alive between route paints.  Apart from making
// navigation feel immediate, this preserves the rail's scroll position and
// keyboard focus instead of recreating all of its controls after each fetch.
function mountRouteShell(context) {
  if (!isRouteCurrent(context)) return false;
  if (!root.querySelector(":scope > .chrome")) {
    root.innerHTML = chrome('<div class="route-placeholder" role="status">Loading…</div>');
    setupChromeHandlers();
  }
  root.setAttribute("aria-busy", "true");
  const status = document.getElementById("route-status");
  if (status) {
    status.textContent = `Loading ${context.route === "library" ? "Home" : context.route}…`;
    status.hidden = false;
  }
  return true;
}

function mountPage(content, context = captureRouteContext()) {
  if (!isRouteCurrent(context)) return false;
  if (!root.querySelector(":scope > .chrome")) {
    root.innerHTML = chrome(content);
    setupChromeHandlers();
  } else {
    const main = document.getElementById("content");
    if (!main) return false;
    main.innerHTML = content;
    document.querySelectorAll(".topnav-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.route === context.route);
    });
    paintChannelList();
  }
  root.removeAttribute("aria-busy");
  const status = document.getElementById("route-status");
  if (status) {
    status.textContent = "";
    status.hidden = true;
  }
  return true;
}

function setupChromeHandlers() {
  const shell = root.querySelector(":scope > .chrome");
  if (!shell) return;
  if (shell.dataset.chromeWired === "1") {
    paintChannelList();
    return;
  }
  shell.dataset.chromeWired = "1";
  // Brand → home: clear any selected channel and go to the dashboard.
  document.getElementById("brand-home")?.addEventListener("click", (e) => {
    e.preventDefault();
    selectedChannelKey = null;
    if (currentRoute() === "library") render();
    else route("library");
  });
  document.getElementById("poll-now")?.addEventListener("click", async () => {
    try {
      await API.pollNow();
    } catch (e) {
      console.error(e);
    }
  });
  document.getElementById("add-channel")?.addEventListener("click", () => openAddChannelWizard());
  // Slot pill navigates to Monitor page so users can adjust the cap.
  document.getElementById("rec-slot-pill")?.addEventListener("click", () => route("schedule"));
  document.getElementById("logout")?.addEventListener("click", async () => {
    // Quick confirm — one misclick on the topbar shouldn't sign you out.
    if (!(await confirmDialog("Sign out? You'll need to re-enter the API key to come back.", { ok: "Sign out" }))) return;
    API.logout().catch(() => {}).then(() => route("login"));
  });
  // Health pill — amber/red when any check is degraded (roadmap item 13).
  refreshHealthPill();
  // Populate the concurrent-slot pill with the configured cap. Fire-and-forget;
  // failures silently leave maxConcurrentSlots at its current cached value so
  // a transient /settings error doesn't blank the topbar.
  API.settings().then((s) => {
    maxConcurrentSlots = (s && s.monitor_limits && s.monitor_limits.max_concurrent_recordings) || 0;
    updateLiveCount();
  }).catch(() => {});
  // Channel list lives in the left rail on every page.
  paintChannelList();
}

// Topbar health pill: only shown when the worst check is warn/error, so a
// healthy system stays uncluttered. Links to the System page. (Item 13.)
async function refreshHealthPill() {
  const pill = document.getElementById("health-pill");
  if (!pill) return;
  try {
    const h = await API.healthChecks();
    const worst = h.status || "ok";
    if (worst === "ok") {
      pill.hidden = true;
      return;
    }
    const bad = (h.checks || []).filter((c) => c.severity !== "ok");
    pill.className = `health-pill ${worst}`;
    pill.textContent = `${worst === "error" ? "✕" : "▲"} ${bad.length} issue${bad.length === 1 ? "" : "s"}`;
    pill.title = bad.map((c) => `${c.domain}/${c.name}: ${c.message}`).join("\n");
    pill.hidden = false;
  } catch (_) {
    pill.hidden = true;
  }
}

// ── Channel list (left rail) ─────────────────────────────────────────
// Merges /channels (Twitch/YT) with Patreon creators (patreonState),
// live first + bold, then offline. Clicking selects a channel and shows
// its detail in the center (home route only).
// Rail ordering + collapse state. Platform rank keeps Twitch → YouTube →
// Patreon stable regardless of how the daemon happens to return channels.
const RAIL_PLATFORM_ORDER = { Twitch: 0, YouTube: 1, Patreon: 2 };
function byPlatformThenName(a, b) {
  const rank =
    (RAIL_PLATFORM_ORDER[a.platform] ?? 99) - (RAIL_PLATFORM_ORDER[b.platform] ?? 99);
  if (rank !== 0) return rank;
  return (a.display_name || a.name || "").localeCompare(
    b.display_name || b.name || "",
    undefined,
    { sensitivity: "base" },
  );
}

// Rail sort. Alphabetical-within-platform is the default because it makes a
// channel findable by name; the last-live orders answer the other question
// people actually ask of this rail ("who's been on recently / who's gone
// quiet"). Channels StriVo has never seen live sort last in both directions
// rather than pretending to be infinitely old or infinitely recent.
const RAIL_SORT_KEY = "strivo:rail-sort";
const RAIL_SORTS = {
  name: { label: "Name (A–Z)", cmp: byPlatformThenName },
  "live-desc": { label: "Last live (newest)", cmp: (a, b) => byLastLive(a, b, -1) },
  "live-asc": { label: "Last live (oldest)", cmp: (a, b) => byLastLive(a, b, 1) },
};
function byLastLive(a, b, dir) {
  const ta = a.is_live ? Infinity : Date.parse(a.last_live_at || "") || null;
  const tb = b.is_live ? Infinity : Date.parse(b.last_live_at || "") || null;
  if (ta === null && tb === null) return byPlatformThenName(a, b);
  if (ta === null) return 1; // never-seen-live sinks, whichever direction
  if (tb === null) return -1;
  if (ta === tb) return byPlatformThenName(a, b);
  return ta < tb ? dir : -dir;
}
function railSort() {
  try {
    const v = localStorage.getItem(RAIL_SORT_KEY);
    return RAIL_SORTS[v] ? v : "name";
  } catch (_) {
    return "name";
  }
}
function setRailSort(v) {
  try {
    localStorage.setItem(RAIL_SORT_KEY, RAIL_SORTS[v] ? v : "name");
  } catch (_) {
    /* private mode — sort just won't persist */
  }
}

const RAIL_COLLAPSE_KEY = "strivo:rail-collapsed";
function railCollapsedSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(RAIL_COLLAPSE_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch (_) {
    return new Set();
  }
}
function railSectionOpen(id) {
  return !railCollapsedSet().has(id);
}
function setRailSectionOpen(id, open) {
  const set = railCollapsedSet();
  if (open) set.delete(id);
  else set.add(id);
  try {
    localStorage.setItem(RAIL_COLLAPSE_KEY, JSON.stringify([...set]));
  } catch (_) {
    /* private mode — collapse just won't persist */
  }
}

function railSortControlHtml() {
  const current = railSort();
  const opts = Object.entries(RAIL_SORTS)
    .map(
      ([v, { label }]) =>
        `<option value="${v}"${v === current ? " selected" : ""}>${label}</option>`,
    )
    .join("");
  return `<div class="ch-sort">
      <label class="ch-sort-label micro" for="rail-sort">Sort</label>
      <select id="rail-sort" class="ch-sort-select" data-rail-sort>${opts}</select>
    </div>`;
}

function paintChannelList() {
  const rail = document.getElementById("channel-list");
  if (!rail) return;

  const merged = [...channelCache, ...patreonState.creators];
  // De-dupe by platform:id in case a Patreon creator is also in /channels.
  const seen = new Set();
  const channels = merged.filter((c) => {
    const k = `${c.platform}:${c.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // One ordering for both rails: platform groups in a fixed order, then
  // A-Z inside each. Offline used to be split into a header per platform,
  // which cost three headers of vertical space and made a single alphabetical
  // scan impossible. The per-row platform glyph already says which is which.
  const cmp = (RAIL_SORTS[railSort()] || RAIL_SORTS.name).cmp;
  const live = channels.filter((c) => c.is_live).sort(cmp);
  const offline = channels.filter((c) => !c.is_live).sort(cmp);
  updateLiveCount();

  const recordingChannelIds = new Set(
    recCache.filter((r) => isInProgress(r.state)).map((r) => r.channel_id),
  );
  // Route commits call this to make the rail available, but recreating an
  // already-correct rail discards focus and an open section.  Repaint only
  // when its visible model actually changed.
  const railSignature = JSON.stringify({
    selectedChannelKey,
    sort: railSort(),
    channels: channels.map((c) => [c.platform, c.id, c.display_name || c.name, c.is_live, c.viewer_count, c.last_live_at, c.stream_title]),
    recordingChannelIds: [...recordingChannelIds].sort(),
  });
  if (rail.dataset.modelSignature === railSignature) return;

  const row = (c) => {
    const key = `${c.platform}:${c.id}`;
    const sel = key === selectedChannelKey ? "sel" : "";
    const isPatreon = c.platform === "Patreon";
    const rec = recordingChannelIds.has(c.id)
      ? '<span class="ch-rec" title="recording">●</span>'
      : "";
    // Live → viewer count; offline Twitch/YT → "last live: N ago" in the same
    // slot (when StriVo has observed it live at least once).
    let viewers = "";
    if (c.is_live && c.viewer_count) {
      viewers = `<span class="ch-viewers micro">${formatCount(c.viewer_count)}</span>`;
    } else if (!c.is_live && !isPatreon && c.last_live_at) {
      viewers = `<span class="ch-lastlive" title="last live: ${htmlEscape(lastLiveLong(c.last_live_at))}">${htmlEscape(relTime(c.last_live_at))}</span>`;
    }
    // Patreon rows are visually distinct (item 6): a pledged-tier chip
    // (stored in stream_title) and a patreon-accented platform glyph.
    const tier = isPatreon && c.stream_title
      ? `<span class="ch-tier micro" title="pledged tier">${htmlEscape(c.stream_title)}</span>`
      : "";
    // Filter Recordings + History by this channel when clicked. Live
    // channels link to the recording dashboard so you can spot the
    // active capture quickly; offline rows go straight to the filtered
    // Recordings page (audit B7/M2).
    const href = c.is_live
      ? "#/library"
      : `#/recordings?channel=${encodeURIComponent(c.display_name || c.name || "")}`;
    // Live rows expose a drag handle to the player stage. The id shape
    // here must match the backend's stream_id format (`PlatformKind:id`)
    // so dropping onto a tile resolves to a known stream.
    const liveStreamId = c.is_live ? `${c.platform}:${c.id}` : "";
    return `
      <a class="ch-row ${c.is_live ? "live" : ""} ${isPatreon ? "patreon" : ""} ${sel}"
         data-channel-key="${key}" data-channel-id="${c.id}"
         data-platform="${c.platform}" data-live-stream-id="${htmlEscape(liveStreamId)}" href="${href}">
        <span class="ch-plat micro ${c.platform.toLowerCase()}" aria-hidden="true">${platformGlyph(c.platform)}</span>
        <span class="ch-name">${htmlEscape(c.display_name || c.name)}</span>
        ${tier}${viewers}${rec}
      </a>`;
  };

  // Section headers are buttons so they can be collapsed; the open/closed
  // state persists per section so a rail collapsed to just LIVE stays that
  // way across repaints and reloads.
  const section = (id, title, list) =>
    list.length
      ? `<button type="button" class="ch-section-title micro" data-rail-section="${id}"
                 aria-expanded="${railSectionOpen(id)}" aria-controls="rail-sec-${id}">
           <span class="ch-caret" aria-hidden="true">▾</span>
           <span class="ch-section-label">${title}</span>
           <span class="ch-count">${list.length}</span>
         </button>
         <div class="ch-section-body" id="rail-sec-${id}" data-rail-body="${id}"
              ${railSectionOpen(id) ? "" : "hidden"}>${list.map(row).join("")}</div>`
      : "";

  // Preserve scroll position across repaints (the rail is rebuilt
  // wholesale, which would otherwise jump it to the top on every event).
  const prevScroll = rail.scrollTop;
  rail.innerHTML =
    channels.length === 0
      ? `<div class="ch-empty">No channels yet.<br><br>
           Connect Twitch / YouTube / Patreon and follow channels — they
           appear here automatically.<br>
           <a href="#/settings">Check Settings →</a></div>`
      : railSortControlHtml() +
        section("live", `● LIVE`, live) +
        section("offline", "OFFLINE", offline);
  rail.dataset.modelSignature = railSignature;

  rail.querySelectorAll(".ch-row").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      selectChannel(el.dataset.channelKey, e);
    });
  });
  const sortSel = rail.querySelector("[data-rail-sort]");
  if (sortSel) {
    sortSel.addEventListener("change", () => {
      setRailSort(sortSel.value);
      paintChannelList();
    });
  }
  rail.querySelectorAll("[data-rail-section]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.railSection;
      const open = !railSectionOpen(id);
      setRailSectionOpen(id, open);
      el.setAttribute("aria-expanded", String(open));
      const body = rail.querySelector(`[data-rail-body="${id}"]`);
      if (body) body.hidden = !open;
    });
  });
  rail.scrollTop = prevScroll;
}

function platformGlyph(p) {
  return p === "Twitch" ? "🟣" : p === "YouTube" ? "🔴" : "◈";
}

// Seed patreonState from the daemon snapshot (/patreon) so Patreon shows
// immediately on load, instead of only after the next ~5-min poll's
// patreon-state SSE event. Idempotent; refreshed live by SSE thereafter.
async function seedPatreon(context = captureRouteContext()) {
  try {
    const p = await API.patreon();
    if (!isRouteCurrent(context)) return false;
    patreonState.creators = p.creators || [];
    patreonState.posts = {};
    for (const post of p.posts || []) {
      (patreonState.posts[post.campaign_id] ||= []).push(post);
    }
    for (const list of Object.values(patreonState.posts)) {
      list.sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
    }
    return true;
  } catch (_) {
    /* non-fatal — SSE still refreshes it */
    return false;
  }
}

// Per-route rail-click overrides. A route registers `RAIL_CLICK_HANDLERS.<route>
// = (channelKey, event) => handled` to claim rail clicks while it is active
// (e.g. the player loads the channel into a tile instead of leaving the page).
// Returning false falls through to the default: open channel detail.
const RAIL_CLICK_HANDLERS = {};
// Extra e2e hooks contributed by later modules; spread into
// window.__strivoTestHooks when the page opts in (see 036-pvr.js).
const TEST_HOOK_EXTENSIONS = {};

function selectChannel(key, ev) {
  const override = RAIL_CLICK_HANDLERS[currentRoute()];
  if (override && override(key, ev)) return;
  selectedChannelKey = key;
  if (currentRoute() !== "library") {
    route("library"); // hashchange triggers render()
  } else {
    render();
  }
}

// ── Login ────────────────────────────────────────────────────────────
function renderLogin(errorMsg, context = captureRouteContext()) {
  if (!isRouteCurrent(context)) return;
  root.removeAttribute("aria-busy");
  // "Remember me" pre-fills the API key from localStorage on a returning
  // visit. The session cookie itself already persists across reloads via
  // the server; this just spares typing after a browser restart or a
  // dropped cookie (audit M18). Stored under a distinct key per host so
  // sharing a browser across StriVo instances stays clean.
  const remembered = (() => {
    try { return localStorage.getItem("strivo:remembered-api-key") || ""; }
    catch (_) { return ""; }
  })();
  root.innerHTML = `
    <div class="login-screen">
      <form class="login-card" id="login-form">
        <h1>StriVo</h1>
        <p class="subtitle">Sign in to the web console</p>
        <label for="api-key">API Key</label>
        <input type="password" id="api-key" autocomplete="current-password"
               value="${htmlEscape(remembered)}" autofocus />
        <label class="login-remember">
          <input type="checkbox" id="api-remember" ${remembered ? "checked" : ""} />
          <span>Remember on this browser</span>
        </label>
        <button type="submit" class="primary">Sign in</button>
        ${errorMsg ? `<div class="error">${htmlEscape(errorMsg)}</div>` : ""}
        <div class="hint">
          API key lives in <code>~/.config/strivo/config.toml</code> under
          <code>[web]</code>. <br />
          Or run: <code>strivo config get web.api_key</code><br />
          <span class="login-recovery">Lost it? Stop the daemon, edit
          <code>~/.config/strivo/config.toml</code>, replace the
          <code>api_key</code> with anything random, and restart.</span>
        </div>
      </form>
    </div>
  `;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = document.getElementById("api-key").value.trim();
    if (!key) return;
    const remember = document.getElementById("api-remember").checked;
    try {
      await API.login(key);
      try {
        if (remember) localStorage.setItem("strivo:remembered-api-key", key);
        else localStorage.removeItem("strivo:remembered-api-key");
      } catch (_) {}
      // Login succeeded — this is the first authenticated call, so both
      // the SSE stream and the Patreon seed (which were held back at boot,
      // see fetchEdition() below) are cleared to run now.
      authed = true;
      events.start(); // (re)connect the now-authorized SSE stream
      seedPatreon();
      // fetchEdition() only ever ran once at script boot, unauthenticated —
      // /api/v1/settings 401'd and CREATOR_ENABLED stuck false for the rest
      // of the session, hiding every creator route (Archive included) until
      // a manual reload. Re-resolve it now that the session cookie is set.
      await fetchEdition();
      route("library");
      // The first-run tour belongs to the authenticated application
      // chrome. Starting it during the login paint blocks the sign-in
      // form with an overlay and leaves the spotlight without targets.
      setTimeout(startOnboardingTour, 600);
    } catch (err) {
      renderLogin("Invalid API key");
    }
  });
}

// ── Home: channel detail (if selected) + recordings dashboard ─────────
// First-run gate (item 20): a fresh install with no platform connected gets
// a guided setup checklist instead of an empty/half-configured dashboard.
// Platform setup and recording storage are available from the Settings editor,
// so this screen can hand users directly to the relevant controls.
let firstRunDismissed = false;

function renderFirstRun(setup, context = captureRouteContext()) {
  if (!isRouteCurrent(context)) return;
  root.removeAttribute("aria-busy");
  const step = (done, label, detail) => `
    <div class="fr-step ${done ? "done" : "todo"}">
      <span class="fr-mark">${done ? "✓" : "○"}</span>
      <div class="fr-body">
        <div class="fr-label">${htmlEscape(label)}</div>
        <div class="fr-detail">${detail}</div>
      </div>
    </div>`;
  const plat = (name, ok) =>
    `<span class="fr-pill ${ok ? "ok" : ""}">${ok ? "✓" : "○"} ${htmlEscape(name)}</span>`;
  const anyPlatform =
    setup.twitch_configured || setup.youtube_configured || setup.patreon_configured;
  const recDir = setup.recording_dir || "(unset)";
  const chanCount = (setup.auto_record_channels || []).length;

  if (!mountPage(`
    <h1 class="page-title">Welcome to StriVo</h1>
    <p class="page-subtitle">Finish setup before the dashboard fills in.</p>
    <div class="cfg-card fr-card">
      ${step(
        anyPlatform,
        "1 · Connect a platform",
        `Open <a class="stg-linkbtn" href="#/settings/platforms">Settings → Platforms</a>
         to connect Twitch, YouTube, or Patreon. Then re-check below.
         <div class="fr-pills">${plat("Twitch", setup.twitch_configured)}
           ${plat("YouTube", setup.youtube_configured)}
           ${plat("Patreon", setup.patreon_configured)}</div>`,
      )}
      ${step(
        !!setup.recording_dir,
        "2 · Recording directory",
        `Where captures are written: <code>${htmlEscape(recDir)}</code>.
         <a class="stg-linkbtn" href="#/settings/recording">Edit it in Settings → Recording</a> if needed.`,
      )}
      ${step(
        chanCount > 0,
        "3 · Pick channels to record",
        `Use the <b>＋ Add</b> button (top bar) to find a channel and enable
         auto-record. ${chanCount} channel(s) configured so far.`,
      )}
      <div class="fr-actions">
        <button id="fr-recheck">↻ Re-check</button>
        <button id="fr-continue" class="primary">${anyPlatform ? "Continue to dashboard" : "Continue anyway"}</button>
      </div>
    </div>
  `, context)) return;
  setupChromeHandlers();
  document.getElementById("fr-recheck")?.addEventListener("click", () => renderHome(captureRouteContext()));
  document.getElementById("fr-continue")?.addEventListener("click", () => {
    firstRunDismissed = true;
    renderHome(captureRouteContext());
  });
}

async function renderHome(context = captureRouteContext()) {
  if (!mountRouteShell(context)) return;
  let setup = null;
  // These dashboard sources do not depend on one another.  Starting them
  // together removes the settings → channels/recordings → Patreon → schedule
  // waterfall that made a warm Home transition wait several RTTs.
  const patreonTask = typeof seedPatreon === "function" ? seedPatreon(context) : Promise.resolve();
  const scheduleTask = API.schedule();
  // Ancillary sections update after the dashboard is available.  A slow
  // Patreon integration or schedule endpoint must never delay Home.
  patreonTask.then((loaded) => {
    if (!loaded) return;
    hydrationLoaded.patreon = true;
    if (isRouteCurrent(context)) paintChannelList();
  }).catch(() => {});
  scheduleTask.then((result) => {
    if (!isRouteCurrent(context)) return;
    dashSchedule = result.schedule || [];
    hydrationLoaded.schedule = true;
    if (currentRoute() === "library") paintDashboard();
  }).catch(() => {});
  const [setupRes, chRes, recRes] = await Promise.allSettled([
    API.settings(), API.channels(), API.recordings(),
  ]);
  if (!isRouteCurrent(context)) return;
  if (setupRes.status === "fulfilled") setup = setupRes.value;
  else if (setupRes.reason?.message?.includes("unauthorized")) return;
  const anyPlatform =
    setup &&
    (setup.twitch_configured || setup.youtube_configured || setup.patreon_configured);
  if (setup && !anyPlatform && !firstRunDismissed) {
    renderFirstRun(setup, context);
    return;
  }
  // Refresh the channel + recordings caches that feed the left rail and
  // the dashboard. Both are cheap snapshots.
  //
  // Use Promise.allSettled so a transient failure on one side (e.g. the
  // daemon socket bouncing) doesn't drop the OTHER side's data into the
  // empty-rail state. Previously Promise.all rejected atomically and we
  // caught at the outer try/catch, leaving both caches stale — visually
  // that surfaced as "rail vanished" because the unauth check at the top
  // already returned for genuine 401s.
  if (chRes.status === "fulfilled") {
    channelCache = chRes.value.channels || [];
    hydrationLoaded.channels = true;
  } else if (chRes.reason && chRes.reason.message && chRes.reason.message.includes("unauthorized")) {
    return;
  }
  if (recRes.status === "fulfilled") {
    recCache = recRes.value.recordings || [];
    dashRecordings = recCache;
    hydrationLoaded.recordings = true;
    seedVodDownloadStateFromRecCache();
  } else if (recRes.reason && recRes.reason.message && recRes.reason.message.includes("unauthorized")) {
    return;
  }
  // A14: prune bulkStatus entries whose channel is no longer in the
  // current channelCache. Without this the bulkStatus map grew across
  // weeks of uptime as channels were added + removed.
  if (Object.keys(bulkStatus).length) {
    const liveIds = new Set(channelCache.map((c) => c.id));
    for (const id of Object.keys(bulkStatus)) {
      if (!liveIds.has(id)) delete bulkStatus[id];
    }
  }
  root.removeAttribute("aria-busy");

  const selected = selectedChannelKey
    ? [...channelCache, ...patreonState.creators].find(
        (c) => `${c.platform}:${c.id}` === selectedChannelKey,
      )
    : null;

  // The recordings dashboard (In progress / Recent / Upcoming) lives only on
  // the home view; opening a channel shows just its detail.
  const center = selected
    ? channelDetailHtml(selected)
    : `<div id="dash" data-dashboard-signature="${htmlEscape(dashboardSignature(false))}">${recordingsDashboardHtml(false)}</div>`;

  if (!mountPage(center, context)) return;
  setupChromeHandlers();

  if (selected) {
    wireChannelDetail(selected);
    loadChannelDetailData(selected);
  }
  wireDashboard();
}

// Repaint ONLY the recordings dashboard subtree (#dash) — never the chrome,
// left rail, or channel-detail iframe. Driven by high-frequency recording
// events so they don't reload the live preview or reset rail scroll.
function paintDashboard(dirtyIds = null) {
  const el = document.getElementById("dash");
  if (!el) return;
  // Progress events only change a card's live fields.  Do not replace this
  // subtree: it contains focusable play/stop controls and horizontal scroll
  // strips that users may be browsing while a capture is active.
  const signature = dashboardSignature(!!selectedChannelKey);
  if (el.dataset.dashboardSignature !== signature) {
    el.innerHTML = recordingsDashboardHtml(!!selectedChannelKey);
    el.dataset.dashboardSignature = signature;
    wireDashboard();
    return;
  }
  const cards = el.querySelectorAll("[data-dashboard-recording]");
  const wanted = dashboardCardIds(!!selectedChannelKey);
  const structureChanged = cards.length !== wanted.length ||
    Array.from(cards).some((card, index) => card.dataset.dashboardRecording !== wanted[index]);
  if (structureChanged) {
    el.innerHTML = recordingsDashboardHtml(!!selectedChannelKey);
    wireDashboard();
    return;
  }
  let patched = 0;
  for (const card of cards) {
    const recording = dashRecordings.find((r) => r.id === card.dataset.dashboardRecording);
    if (!recording) continue;
    if (!dirtyIds || dirtyIds.has(String(recording.id))) patchDashboardRecording(card, recording);
    patched++;
  }
  // A record absent from the normalized cache means lifecycle structure
  // changed while this paint was queued; the next lifecycle refresh repairs
  // it without disturbing cards that still have stable identities.
}

function dashboardCardIds(compact) {
  return [
    ...dashRecordings.filter((r) => isInProgress(r.state)),
    ...dashRecordings
      .filter((r) => !isInProgress(r.state))
      .sort((a, b) => recordingTime(b) - recordingTime(a))
      .slice(0, compact ? 12 : 24),
  ].map((r) => String(r.id));
}

function dashboardSignature(compact) {
  return JSON.stringify({
    cards: dashboardCardIds(compact),
    live: (channelCache || []).filter((c) => c.is_live).map((c) => `${c.platform}:${c.id}:${c.viewer_count || 0}`),
    upcoming: (dashSchedule || []).filter((s) => s.next_fire).map((s) => `${s.channel}:${s.next_fire}`),
  });
}

function patchDashboardRecording(card, recording) {
  const size = card.querySelector("[data-rec-size]");
  if (size) size.textContent = formatBytes(recording.bytes_written || 0);
  const state = card.querySelector("[data-rec-state]");
  if (state) state.innerHTML = isNoteworthyState(recordingDisplayState(recording))
    ? renderStatePill(recordingDisplayState(recording)) : "";
}

// ── Home dashboard (Jellyfin-style horizontal carousels) ─────────────
//
// Rows: Live Now → In Progress → Recently Finished → Upcoming.
// Each row is a horizontal-scroll strip. Recently Finished pills are
// click-to-play (per user request); Live Now cards deep-link to the
// /watch route focused on that stream.
function recordingsDashboardHtml(compact) {
  const inProgress = dashRecordings.filter((r) => isInProgress(r.state));
  // Sort before slicing. This previously took whatever order the daemon
  // returned, so "Recent" was only accidentally chronological and the slice
  // could drop newer rows in favour of older ones.
  const recent = dashRecordings
    .filter((r) => !isInProgress(r.state))
    .sort((a, b) => recordingTime(b) - recordingTime(a))
    .slice(0, compact ? 12 : 24);
  const upcoming = [...dashSchedule]
    .filter((s) => s.next_fire)
    .sort((a, b) => new Date(a.next_fire) - new Date(b.next_fire));
  const liveChannels = (channelCache || []).filter((c) => c.is_live);

  const schedPillEl = (s) => `
    <div class="media-pill">
      <div class="mp-thumb"></div>
      <div class="mp-info">
        <div class="mp-title">${htmlEscape(s.channel)}</div>
        <div class="mp-sub">${htmlEscape(new Date(s.next_fire).toLocaleString())}${s.duration ? ` · ${htmlEscape(s.duration)}` : ""}</div>
      </div>
      <div class="mp-meta"><span class="mp-badge micro">scheduled</span></div>
    </div>`;

  // Live-now card: thumbnail + channel name + viewer count + LIVE
  // chip. Whole card is a hash link to /watch?focus=<id>.
  const liveCardEl = (c) => {
    const thumb = liveThumbUrl(c);
    const focus = `${c.platform}:${c.id}`;
    const href = `#/watch?mode=focus&focus=${encodeURIComponent(focus)}`;
    const viewers = c.viewer_count != null ? formatCount(c.viewer_count) : "";
    return `
      <a class="live-card" href="${href}" data-live-focus="${htmlEscape(focus)}"
         title="Open ${htmlEscape(c.display_name || c.name)} in the multi-stream viewer">
        <div class="live-card-thumb">${thumb ? `<img loading="lazy" src="${htmlEscape(thumb)}" alt=""/>` : ""}<span class="live-card-badge micro">LIVE</span></div>
        <div class="live-card-meta">
          <span class="live-card-name">${htmlEscape(c.display_name || c.name)}</span>
          <span class="live-card-sub pg-cap-hint">${htmlEscape(c.platform)}${viewers ? ` · ${viewers}` : ""}</span>
        </div>
      </a>`;
  };

  const rowEl = (title, count, html, empty, klass = "") => `
    <section class="dash-row${klass ? " " + klass : ""}">
      <h2 class="dash-row-title">${title}${count != null ? ` <span class="dash-count micro">${count}</span>` : ""}</h2>
      <div class="dash-scroll">${html || `<div class="empty sm">${empty}</div>`}</div>
    </section>`;

  const heading = compact ? "" : `<h1 class="page-title">Home</h1>`;
  // Live Now hidden when zero live (avoids "No channels live" noise on
  // dashboards where the rail's offline-only state already conveys
  // that). Same for Upcoming when no schedule.
  const liveRow = liveChannels.length
    ? rowEl("Live Now", liveChannels.length, liveChannels.map(liveCardEl).join(""), "", "live-now-row")
    : "";
  const upcomingRow = upcoming.length
    ? rowEl("Upcoming", upcoming.length, upcoming.map(schedPillEl).join(""), "", "")
    : "";
  return `${heading}
    ${liveRow}
    ${rowEl("In progress", inProgress.length, inProgress.map((r) => recordingPillHtml(r, true)).join(""), "Nothing recording")}
    ${rowEl("Recent", null, recent.map((r) => recordingPillHtml(r, true)).join(""), "No recordings yet — start one from the rail.")}
    ${upcomingRow}`;
}

// Shared recording media-pill (used by the home dashboard + History): cover
// thumbnail + title + channel·date + state/size, with a Stop on active rows.
function recordingPillHtml(j, dashboard = false) {
  const when = j.started_at ? new Date(j.started_at).toLocaleString() : "—";
  const stop = isInProgress(j.state)
    ? `<button class="danger sm" data-action="stop" data-job-id="${htmlEscape(j.id)}">Stop</button>`
    : "";
  // FILE MISSING overlay on the thumbnail mirrors the Recordings page
  // treatment so the Library dashboard doesn't quietly hide broken
  // rows (audit U2).
  const missingOverlay = j.file_exists === false
    ? '<span class="mp-missing">FILE MISSING</span>'
    : "";
  // Twitch live-pull + auto-VOD-backfill produces two rows per
  // broadcast — surface a small chip when the source is the
  // backfill path so the user can tell them apart at a glance
  // (audit B5). source_url is set when the recording was created
  // via DownloadVod (the backfill path).
  const sourceBadge = j.source_url
    ? '<span class="mp-source" title="From Twitch/YouTube VOD backfill">VOD</span>'
    : "";
  // Finished recordings with a file → click-to-play; in-progress &
  // file-missing rows stay inert (they don't have a playable artefact).
  const playable = !isInProgress(j.state) && j.file_exists !== false;
  const playAttrs = playable
    ? ` data-action="play" data-job-id="${htmlEscape(j.id)}" role="button" tabindex="0"`
    : "";
  // "Finished" is the state of nearly every row here, so rendering a pill
  // for it spends a column of every card restating the default. Only states
  // that actually need attention get a pill; the rest read as unremarkable,
  // which is the point.
  const state = recordingDisplayState(j);
  const statePill = isNoteworthyState(state) ? renderStatePill(state) : "";
  const title = htmlEscape(niceTitle(j.stream_title) || j.channel_name || "(recording)");
  return `
    <div class="media-pill mp-card${j.file_exists === false ? " mp-broken" : ""}${playable ? " mp-clickable" : ""}"${dashboard ? ` data-dashboard-recording="${htmlEscape(j.id)}"` : ""}${playAttrs}>
      <div class="mp-title" title="${title}">${title} ${sourceBadge}</div>
      <div class="mp-thumb">${missingOverlay}<img class="mp-thumb-img" loading="lazy" alt=""
        src="/api/v1/recordings/${encodeURIComponent(j.id)}/thumb" onerror="this.remove()"></div>
      <div class="mp-foot">
        <span class="mp-channel">${htmlEscape(j.channel_name || "")}</span>
        <span class="mp-when" title="${htmlEscape(when)}">${htmlEscape(shortWhen(j.started_at))}</span>
        <span class="mp-spacer"></span>
        <span data-rec-state>${statePill}</span>
        <span class="mp-size" data-rec-size>${formatBytes(j.bytes_written || 0)}</span>
        ${stop}
      </div>
    </div>`;
}

/// Timestamp a recording sorts by. started_at is the only time the API
/// exposes for every row, so it is the sort key; guard against nulls so a
/// malformed row sinks rather than poisoning the comparator with NaN.
function recordingTime(r) {
  const t = r && r.started_at ? Date.parse(r.started_at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/// States worth spending pixels on. "Finished" is the expected outcome and
/// is conveyed well enough by the row simply being playable, so it earns no
/// pill. Everything else — failures, missing files, in-flight work — does.
/// Note this takes the object recordingDisplayState() returns, not a string.
function isNoteworthyState(state) {
  return (state && state.className) !== "finished";
}

/// Compact timestamp for dense rows: a time for today, "Wed 14:05" within
/// the week, "30 Jul" beyond it. The full locale string stays in the
/// tooltip. Seconds are never useful here and cost ~4 characters a row.
function shortWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hhmm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return hhmm;
  const days = (now - d) / 86400000;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${hhmm}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function wireDashboard() {
  // Click-to-play on finished recording pills. Routes to the Player
  // tab with this recording loaded as the single tile — no inline
  // modal. fresh=1 forces a single-slot reset so a stale multi-tile
  // layout doesn't eat the click.
  document.querySelectorAll('.media-pill[data-action="play"]').forEach((pill) => {
    const open = () => {
      const id = pill.dataset.jobId;
      if (!id) return;
      window.location.hash = `#/watch?recording=${encodeURIComponent(id)}&fresh=1`;
    };
    pill.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input")) return;
      open();
    });
    pill.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
  document.querySelectorAll('[data-action="stop"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!(await confirmDialog("Stop this recording?", { ok: "Stop", danger: true })))
        return;
      await withBusy(btn, "Stopping…", async () => {
        await API.stopRecording(btn.dataset.jobId);
        Toast.success("Recording stopped");
        setTimeout(() => render().catch(() => {}), 500);
      }).catch((e) => Toast.error(`Stop failed: ${e.message}`));
    });
  });
}

// ── Channel detail (center) ──────────────────────────────────────────
function channelDetailHtml(c) {
  const key = `${c.platform}:${c.id}`;
  const isPatreon = c.platform === "Patreon";
  const liveBadge = c.is_live
    ? '<span class="status live">LIVE</span>'
    : '<span class="status">offline</span>';
  const actions = `
    <div class="actions">
      ${c.is_live ? `
        <button class="primary" data-action="record" data-channel-id="${c.id}"
                data-channel-name="${htmlEscape(c.name)}"
                data-display-name="${htmlEscape(c.display_name || c.name)}"
                data-platform="${c.platform}"
                data-thumbnail="${htmlEscape(c.thumbnail_url || "")}"
                data-stream-title="${htmlEscape(c.stream_title || "")}">● Record</button>
        <button data-action="record" data-from-start="true" data-channel-id="${c.id}"
                data-channel-name="${htmlEscape(c.name)}"
                data-display-name="${htmlEscape(c.display_name || c.name)}"
                data-platform="${c.platform}"
                data-thumbnail="${htmlEscape(c.thumbnail_url || "")}"
                data-stream-title="${htmlEscape(c.stream_title || "")}">● From start</button>
      ` : ""}
      ${!isPatreon ? `
        <button data-action="auto-record" data-channel-key="${key}"
                data-enabled="${!c.auto_record}">
          ${c.auto_record ? "Disable auto" : "Enable auto"}
        </button>
        ${bulkButton(c)}
        ${c.platform === "YouTube" ? `
          <button data-action="bulk-playlist" data-channel-id="${c.id}"
                  data-channel-name="${htmlEscape(c.display_name || c.name)}">⛁ Playlist…</button>` : ""}
        <button data-action="block-channel" data-channel-id="${c.id}"
                data-platform="${c.platform}"
                data-channel-name="${htmlEscape(c.display_name || c.name)}"
                title="Stop auto-grabbing this channel">⊘ Block</button>
      ` : ""}
    </div>`;

  // Section placeholders filled by loadChannelDetailData (async).
  let sections;
  if (isPatreon) {
    sections = `<div id="cd-posts" class="cd-section"></div>`;
  } else if (c.platform === "YouTube") {
    sections = `
      <div id="cd-playlists" class="cd-section"></div>
      <div id="cd-streams" class="cd-section"></div>
      <div id="cd-uploads" class="cd-section"></div>`;
  } else {
    sections = `<div id="cd-streams" class="cd-section"></div>`;
  }

  return `
    <div class="channel-detail">
      <div class="cd-header">
        <span class="platform-icon ${c.platform.toLowerCase()}">${c.platform}</span>
        <h1 class="cd-name">${htmlEscape(c.display_name || c.name)}</h1>
        ${liveBadge}
        ${c.viewer_count ? `<span class="cd-viewers">${formatCount(c.viewer_count)} viewers</span>` : ""}
        <button class="cd-close" data-action="cd-close" title="Close">×</button>
      </div>
      ${c.stream_title ? `<div class="stream-title">${htmlEscape(c.stream_title)}</div>` : ""}
      ${livePreviewHtml(c)}
      ${actions}
      ${sections}
    </div>`;
}

// Live preview when a live channel is opened (items 4 + 23). Progressive
// model: show a refreshing thumbnail poster first, upgrade to the platform's
// embed player on click (tap-to-play — avoids auto-spinning a player for every
// open and works on mobile). Patreon has no live concept (thumbnail-only).
/// Derive Twitch's `parent=` value from a host string.
///
/// Twitch accepts a HOSTNAME ONLY — a scheme or port produces "embed
/// misconfigured" / "refused to connect". It also rejects bare IPv4, so a
/// LAN address is rewritten to the matching `<ip-dashed>.nip.io`, which
/// resolves to the same IP through wildcard DNS.
///
/// This mirrors `strivo_multistream::embed_url`'s host handling
/// (crates/multistream/src/lib.rs) so every embed surface derives the same
/// parent. Three call sites used to do this independently and disagree:
/// the wall went through the Rust builder, while the channel-detail preview
/// used a bare `location.hostname` (no port stripping, no nip.io) and would
/// break for anyone reaching strivo over a LAN IP.
function embedParentHost(host) {
  const raw = host || location.host || "127.0.0.1";
  const bare = raw
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
  return /^\d+\.\d+\.\d+\.\d+$/.test(bare)
    ? `${bare.replace(/\./g, "-")}.nip.io`
    : bare;
}

/// Single builder for live embed URLs. `muted`/`autoplay` are omitted from
/// the URL entirely when left undefined, so callers that manage playback
/// through a player API do not bake a conflicting state into the src.
function buildEmbedUrl(platform, embedKey, opts = {}) {
  const { host, muted, autoplay } = opts;
  const key = encodeURIComponent(embedKey || "");
  if (platform === "Twitch") {
    let u = `https://player.twitch.tv/?channel=${key}` +
      `&parent=${encodeURIComponent(embedParentHost(host))}`;
    if (muted != null) u += `&muted=${!!muted}`;
    if (autoplay != null) u += `&autoplay=${!!autoplay}`;
    return u;
  }
  if (platform === "YouTube") {
    let u = `https://www.youtube.com/embed/live_stream?channel=${key}`;
    if (muted != null) u += `&mute=${muted ? 1 : 0}`;
    if (autoplay != null) u += `&autoplay=${autoplay ? 1 : 0}`;
    return u + "&playsinline=1";
  }
  return null;
}

function liveEmbedSrc(c) {
  const key = isYouTubePlatform(c.platform) ? c.id : c.name;
  return buildEmbedUrl(c.platform, key, { muted: true, autoplay: true });
}

// Substitute Twitch's {width}x{height} placeholders and cache-bust so the
// poster refreshes to a near-live frame.
function liveThumbUrl(c) {
  if (!c.thumbnail_url) return null;
  const sized = c.thumbnail_url
    .replace("{width}", "440")
    .replace("{height}", "248");
  return `${sized}${sized.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

/// The channel-detail preview owns ONE player at a time, tracked here
/// rather than in playerState.controllers. That registry is pruned against
/// the multi-view layout, so a preview registered in it would be destroyed
/// the moment the wall reconciled — and vice versa.
let _cdPreviewController = null;
function destroyChannelDetailPreview() {
  if (_cdPreviewController) {
    try {
      _cdPreviewController.destroy();
    } catch (_) {
      /* best effort */
    }
    _cdPreviewController = null;
  }
}
/// Mount (or replace) the preview player for the currently-open channel.
function mountChannelDetailPreview(root) {
  destroyChannelDetailPreview();
  const mount = (root || document).querySelector(".cd-preview .cd-mount");
  if (!mount) return;
  try {
    _cdPreviewController = _playerControllerFactory(mount.dataset.kind || "twitch", {
      embedUrl: mount.dataset.embedBase || "",
      muted: true, // a preview that starts talking over you is hostile
      playing: true,
      volume: 0,
    });
    _cdPreviewController.mount(mount);
  } catch (_) {
    _cdPreviewController = null;
  }
}

function livePreviewHtml(c) {
  if (!c.is_live) return "";
  const src = liveEmbedSrc(c);
  const thumb = liveThumbUrl(c);
  // Stream id matches the backend's `{Platform:?}:{id}` shape so a
  // ▶ click on this poster routes to the Player and pre-fills the
  // single slot with this channel.
  const focus = `${c.platform}:${c.id}`;
  // No thumbnail but we have an embed → mount the player directly.
  // No `loading="lazy"`: this iframe is the live player. Chromium
  // viewport-throttles lazy iframes during the top-layer transition that
  // fullscreen triggers on cross-origin embeds, which stalls Twitch playback.
  if (!thumb && src) {
    // Mount point rather than a raw iframe, so this preview goes through the
    // same controller as the wall and inherits the vendor JS API (and the
    // iframe fallback when that fails to load).
    return `<div class="cd-preview" data-embed-src="${htmlEscape(src)}" data-focus="${htmlEscape(focus)}">
      <div class="ms-mount cd-mount" data-kind="${isYouTubePlatform(c.platform) ? "youtube" : "twitch"}"
           data-embed-base="${htmlEscape(src)}"></div>
    </div>`;
  }
  if (!thumb) return "";
  // Poster + (if embeddable) a play overlay that routes to the Player
  // tab with this channel pre-loaded — no in-place upgrade. The user
  // already 'hit play' so we don't make them pick the stream again.
  return `<div class="cd-preview poster" ${src ? `data-embed-src="${htmlEscape(src)}" data-focus="${htmlEscape(focus)}"` : ""}>
    <img id="cd-poster-img" src="${htmlEscape(thumb)}" alt="Live thumbnail" />
    ${src ? `<button class="cd-play" id="cd-play" aria-label="Open in Player">▶</button>` : ""}
  </div>`;
}

let cdPosterTimer = null;
function teardownLivePreview() {
  if (cdPosterTimer) {
    clearInterval(cdPosterTimer);
    cdPosterTimer = null;
  }
}

// Bug fix: cross-origin embed iframes (Twitch / YouTube) freeze when
// fullscreened from inside an .cd-preview parent that has
// overflow:hidden + aspect-ratio. The iframe can't match the parent's
// :fullscreen pseudo (different document scope), so we toggle a class
// on the parent via the document's fullscreenchange event and use
// .is-fullscreen + :has(iframe:fullscreen) in CSS to drop the clip.
function attachFullscreenBugfix(previewEl) {
  if (!previewEl || previewEl.dataset.fsBound === "1") return;
  previewEl.dataset.fsBound = "1";
  const onChange = () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const ours = !!fsEl && previewEl.contains(fsEl);
    previewEl.classList.toggle("is-fullscreen", ours);
  };
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  // W6: ESC exits a fullscreened embed cleanly. Browsers handle the
  // native fullscreen ESC themselves, but when the user has NOT
  // fullscreened we let ESC back out of the embed to the channel
  // detail's poster mode (parent toggles handled in wireChannelDetail).
  previewEl.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.fullscreenElement) document.exitFullscreen?.();
  });
}

function wireChannelDetail() {
  // Clear any preview refresh timer from a previously-open detail (item 23).
  teardownLivePreview();
  // Bring up this channel's preview player (no-op unless the poster-less
  // branch rendered a mount point).
  mountChannelDetailPreview(document);
  document.querySelector('[data-action="cd-close"]')?.addEventListener("click", () => {
    destroyChannelDetailPreview();
    teardownLivePreview();
    selectedChannelKey = null;
    render();
  });

  // Live preview: refresh the poster thumbnail every 30s, and upgrade to the
  // embed player on click (tap-to-play). Tears down when detail re-renders.
  // Cover BOTH the poster-mode preview and the always-embedded preview
  // — the freeze bug affects either form once the iframe is mounted.
  document.querySelectorAll(".cd-preview").forEach(attachFullscreenBugfix);
  const poster = document.querySelector(".cd-preview.poster");
  if (poster) {
    const img = poster.querySelector("#cd-poster-img");
    if (img) {
      const base = img.src.split(/[?&]t=/)[0];
      cdPosterTimer = setInterval(() => {
        if (document.hidden) return;
        // Only refresh while still on-screen (cheap visibility guard).
        if (!document.body.contains(img)) {
          teardownLivePreview();
          return;
        }
        img.src = `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
      }, 30000);
    }
    const playBtn = poster.querySelector("#cd-play");
    const focus = poster.dataset.focus;
    if (playBtn && focus) {
      // ▶ on a channel poster routes straight to the Player tab with
      // this channel as the single-slot stream. User already clicked
      // play; don't open the 'pick a stream' picker (audit follow-up).
      playBtn.addEventListener("click", () => {
        teardownLivePreview();
        window.location.hash = `#/watch?focus=${encodeURIComponent(focus)}&fresh=1`;
      });
    }
  }
  document.querySelectorAll("[data-action=record]").forEach((btn) =>
    btn.addEventListener("click", () => startRecordingFromCard(btn.dataset)),
  );
  document.querySelectorAll("[data-action=auto-record]").forEach((btn) =>
    btn.addEventListener("click", () => toggleAutoRecord(btn.dataset)),
  );
  document.querySelectorAll("[data-action=bulk]").forEach((btn) =>
    btn.addEventListener("click", () => toggleBulk(btn.dataset)),
  );
  document.querySelectorAll("[data-action=bulk-playlist]").forEach((btn) =>
    btn.addEventListener("click", () => openPlaylistPicker(btn.dataset)),
  );
  document.querySelectorAll("[data-action=block-channel]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const d = btn.dataset;
      if (
        !(await confirmDialog(
          `Block ${d.channelName}? StriVo will stop auto-grabbing this channel's VODs.`,
          { ok: "Block", danger: true },
        ))
      )
        return;
      try {
        await API.blockAdd({ platform: d.platform, channel_id: d.channelId });
        Toast.success(`Blocked ${d.channelName}`);
      } catch (e) {
        Toast.error(`Block failed: ${e.message}`);
      }
    }),
  );
}

// Fetch + render the per-channel VOD lists. Patreon uses cached posts;
// YouTube/Twitch request VODs over IPC (result arrives via SSE) and also
// request playlists for YouTube.
function loadChannelDetailData(c) {
  if (c.platform === "Patreon") {
    renderPatreonPosts(c);
    return;
  }
  // Render from cache immediately if we have it, then (re)request.
  paintChannelVods(c.id, c.platform);
  API.requestChannelVods(c.id, c.platform).catch(() => {});
  if (c.platform === "YouTube") {
    API.requestPlaylists(c.id).catch(() => {});
  }
  // Don't hang on "Loading…" forever — if the channel-vods SSE answer
  // hasn't arrived in 15s (slow/failed platform fetch), show an error
  // state for whichever sections are still loading.
  const id = c.id;
  setTimeout(() => {
    if (!channelVods[id] && `${c.platform}:${id}` === selectedChannelKey) {
      for (const sid of ["cd-streams", "cd-uploads"]) {
        const el = document.getElementById(sid);
        if (el && el.textContent.includes("Loading")) {
          const title = sid === "cd-streams"
            ? "Past Broadcasts"
            : "Recent uploads";
          el.innerHTML = `<h2 class="cd-section-title">${title}</h2>` +
            `<div class="empty sm">Still loading VODs from the platform — this can take up to 15 seconds the first time. <a href="#" data-action="cd-retry">Retry now</a></div>`;
        }
      }
      document.querySelector('[data-action="cd-retry"]')?.addEventListener("click", (e) => {
        e.preventDefault();
        loadChannelDetailData(c);
      });
    }
  }, 15000);
}

function paintChannelVods(channelId, platform) {
  const vods = channelVods[channelId];
  const streamsEl = document.getElementById("cd-streams");
  const uploadsEl = document.getElementById("cd-uploads");
  // Look up channel context once so each VOD pill can carry the
  // channel_name + platform the download route needs. A9: also
  // search patreonState.creators so Patreon channels' VOD pills
  // resolve their display name + platform tag instead of falling
  // back to "".
  const channel = channelCache.find((c) => c.id === channelId)
    || (patreonState.creators || []).find((c) => c.id === channelId);
  const ctx = {
    channelName: (channel && (channel.display_name || channel.name)) || "",
    platform: platform || (channel && channel.platform) || "",
  };
  if (!vods) {
    if (streamsEl) streamsEl.innerHTML = vodSectionHtml("Past Broadcasts", null, ctx);
    if (uploadsEl) uploadsEl.innerHTML = vodSectionHtml("Recent uploads", null, ctx);
    return;
  }
  const streams = vods.filter((v) => v.kind === "LiveBroadcast");
  const uploads = vods.filter((v) => v.kind !== "LiveBroadcast");
  if (streamsEl) {
    streamsEl.innerHTML = vodSectionHtml("Past Broadcasts", streams, ctx);
  }
  if (uploadsEl) uploadsEl.innerHTML = vodSectionHtml("Recent uploads", uploads, ctx);
  wireVodDownloadButtons();
}

// Click handler for [data-action=vod-download] buttons inside the media-list
// pills. Optimistically flips to "downloading"; the SSE RecordingFinished
// handler flips to "downloaded" when a matching recording completes.
function wireVodDownloadButtons() {
  document.querySelectorAll("[data-action=vod-download]").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = btn.dataset.url;
      const channel_name = btn.dataset.channel;
      const platform = btn.dataset.platform;
      const post_title = btn.dataset.title || null;
      if (!url || vodDownloadState[url] === "downloading" || vodDownloadState[url] === "downloaded") {
        return;
      }
      vodDownloadState[url] = "downloading";
      setVodButtonState(btn, "downloading");
      try {
        // `data-via=patreon` routes through PatreonPull (its IPC arm
        // builds the Patreon-shaped output path + threads the patron
        // cookies); everything else lands on the generic DownloadVod
        // path. Both produce a RecordingJob with `source_url == url`,
        // so the state map + progress bar pipeline are identical.
        if (btn.dataset.via === "patreon") {
          await API.patreonPull({
            embed_url: url,
            creator_name: channel_name,
            post_title: post_title || "",
          });
        } else {
          await API.vodDownload({ url, channel_name, platform, post_title });
        }
        Toast.success(`Downloading: ${post_title || url}`);
        // The RecordingStarted SSE that follows will land in recCache with
        // source_url == this url; seedVodDownloadStateFromRecCache() then
        // confirms our optimistic state. When the recording reaches
        // Finished, the same path flips the pill to Downloaded by exact
        // source_url match — no FIFO guess.
      } catch (err) {
        // Roll back to idle so the user can retry.
        delete vodDownloadState[url];
        setVodButtonState(btn, "idle");
        Toast.error(`Download failed: ${err.message}`);
      }
    });
  });
  // Past Broadcasts: clicking a downloaded entry opens in-app playback
  // instead of the source platform — these are already-recorded VODs,
  // there's no reason to send the click to YouTube.
  document.querySelectorAll('[data-action="open-vod-recording"]').forEach((el) => {
    if (el.dataset.wired === "1") return;
    el.dataset.wired = "1";
    const open = () => {
      const id = el.dataset.jobId;
      if (id) openRecordingPlayer(id);
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
}

// Walk recCache and reflect each recording whose source_url points at a VOD
// into vodDownloadState. Called whenever recCache is refreshed so the
// channel-detail view (and a fresh page reload) shows correct button state
// without any FIFO guess.
function seedVodDownloadStateFromRecCache() {
  for (const r of recCache) {
    if (!r.source_url) continue;
    if (r.state === "Finished") {
      vodDownloadState[r.source_url] = "downloaded";
    } else if (isInProgress(r.state)) {
      // Don't downgrade a "downloaded" entry if a stale in-progress row
      // sneaks in (rare, but be safe).
      if (vodDownloadState[r.source_url] !== "downloaded") {
        vodDownloadState[r.source_url] = "downloading";
      }
    }
  }
}

function setVodButtonState(btn, state) {
  btn.classList.remove("vod-dl-idle", "vod-dl-downloading", "vod-dl-downloaded");
  btn.classList.add(`vod-dl-${state}`);
  btn.disabled = state !== "idle";
  if (state === "downloading") {
    // Try to seed initial bar from any cached progress on the matching job.
    const url = btn.dataset.url;
    const job = recCache.find((r) => r.source_url === url);
    btn.innerHTML = vodProgressHtml(
      job && job.download_pct,
      job && job.download_eta_secs,
      job && job.download_rate_bps,
    );
  } else {
    btn.textContent = state === "downloaded" ? "Downloaded" : "Download";
  }
}

// Inner HTML for the in-flight download widget: gradient-filled bar +
// "NN% · Xm Ys left · R MB/s" label. Bar gradient runs amber → green so the
// rightmost fill colour shifts greener as the pull completes.
function vodProgressHtml(pct, etaSecs, rateBps) {
  // Mirrors renderStatePill's convention (below, ~3149): an unknown
  // percent is omitted from the label rather than shown as a literal
  // "0%" — the bar fill can still default to empty, but the text must
  // not lie about progress it hasn't actually observed yet.
  const hasPct = pct != null && Number.isFinite(pct);
  const p = hasPct ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
  const eta = etaSecs == null ? "" : fmtEta(etaSecs);
  const rate = rateBps == null ? "" : `${formatBytes(rateBps)}/s`;
  const meta = [eta && `${eta} left`, rate].filter(Boolean).join(" · ");
  const label = hasPct ? `${p}%${meta ? " · " + meta : ""}` : (meta || "Downloading…");
  return `
    <span class="vod-dl-bar"><span class="vod-dl-fill" style="width:${p}%"></span></span>
    <span class="vod-dl-label">${label}</span>
  `;
}

function fmtEta(secs) {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

// Surgical DOM patch: find every visible VOD pill bound to this job's
// source_url and refresh its progress widget. Skips pills that have
// transitioned to "downloaded" (which the seed function will finalize).
function updateVodProgressDom(job) {
  if (!job || !job.source_url) return;
  if (vodDownloadState[job.source_url] !== "downloading") return;
  const sel = `[data-action=vod-download][data-url="${CSS.htmlEscape(job.source_url)}"]`;
  document.querySelectorAll(sel).forEach((btn) => {
    btn.innerHTML = vodProgressHtml(
      job.download_pct,
      job.download_eta_secs,
      job.download_rate_bps,
    );
  });
}

// Resolve a VOD/stream thumbnail URL, substituting Twitch's templated
// dimension placeholders ({width}/%{width}). VOD thumbnails are static.
function vodThumb(url) {
  if (!url) return null;
  return url
    .replace(/%?\{width\}/g, "440")
    .replace(/%?\{height\}/g, "248");
}
// Compact duration from a serde std::time::Duration ({secs, nanos}) or number.
function fmtDur(d) {
  const s = typeof d === "number" ? d : d && d.secs;
  if (!s || s <= 0) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function vodSectionHtml(title, vods, ctx) {
  // Past Broadcasts gets the larger, centered treatment. Uploads keep the
  // smaller original style.
  const isPast = title === "Past Broadcasts";
  const titleCls = isPast ? "cd-section-title past-broadcasts" : "cd-section-title";
  if (vods === null) {
    return `<h2 class="${titleCls}">${title}</h2><div class="empty sm">Loading…</div>`;
  }
  if (vods.length === 0) {
    return `<h2 class="${titleCls}">${title}</h2><div class="empty sm">None</div>`;
  }
  const channelName = (ctx && ctx.channelName) || "";
  const platform = (ctx && ctx.platform) || "";
  // Jellyseerr/*arr-style horizontal media pills: thumbnail + rich info block,
  // with a sibling download button. The link wraps thumb+info; the button
  // sits next to it so we don't nest interactive elements.
  const rows = vods
    .map((v) => {
      const thumb = vodThumb(v.thumbnail_url);
      const date = (v.published_at || "").slice(0, 10);
      const dur = fmtDur(v.duration);
      const live = v.kind === "Live" || v.kind === "live";
      const meta = [date, dur].filter(Boolean).map(htmlEscape).join(" · ");
      const downloadable = !!(v.url && channelName && platform);
      // Past Broadcasts are already-recorded livestreams, not arbitrary
      // uploads — once downloaded, the pill should play the local
      // recording, never send the click out to YouTube. A match is a
      // finished recording whose source_url is this exact VOD's URL.
      const matchingJob = isPast
        ? recCache.find((r) => r.source_url === v.url && r.state === "Finished" && r.file_exists !== false)
        : null;
      const linkTag = isPast ? "div" : "a";
      const linkAttrs = isPast
        ? matchingJob
          ? `class="mp-link" data-action="open-vod-recording" data-job-id="${htmlEscape(matchingJob.id)}" role="button" tabindex="0"`
          : `class="mp-link mp-link-inert" style="cursor:default"`
        : (() => {
            const href = /^https?:\/\//i.test(v.url || "") ? htmlEscape(v.url) : "#";
            return `class="mp-link" href="${href}" target="_blank" rel="noopener"`;
          })();
      const state = vodDownloadState[v.url] || "idle";
      // For the downloading state, embed a live progress widget instead of
      // plain text. Seed pct/eta/rate from any matching cached job so a
      // re-render between SSE ticks doesn't reset the bar to 0%.
      let inner;
      if (state === "downloading") {
        const job = recCache.find((r) => r.source_url === v.url);
        inner = vodProgressHtml(
          job && job.download_pct,
          job && job.download_eta_secs,
          job && job.download_rate_bps,
        );
      } else if (state === "downloaded") {
        inner = "Downloaded";
      } else {
        inner = "Download";
      }
      const btn = downloadable
        ? `<button class="vod-dl vod-dl-${state}" data-action="vod-download"
              data-url="${htmlEscape(v.url)}"
              data-channel="${htmlEscape(channelName)}"
              data-platform="${htmlEscape(platform)}"
              data-title="${htmlEscape(v.title || "")}"
              ${state !== "idle" ? "disabled" : ""}>${inner}</button>`
        : "";
      // "Upload" was a confusing label on Past Broadcasts — every entry
      // there is a recorded livestream, not an upload; only flag the
      // ones that were actually captured live.
      const badge = live
        ? '<span class="mp-badge micro live">LIVE VOD</span>'
        : (isPast ? "" : '<span class="mp-badge micro">Upload</span>');
      return `
    <div class="media-pill">
      <${linkTag} ${linkAttrs}>
        <div class="mp-thumb">${thumb ? `<img class="mp-thumb-img" loading="lazy" alt="" src="${htmlEscape(thumb)}" onerror="this.remove()">` : ""}</div>
        <div class="mp-info">
          <div class="mp-title">${htmlEscape(niceTitle(v.title))}</div>
          <div class="mp-sub">${meta}</div>
        </div>
        <div class="mp-meta">${badge}</div>
      </${linkTag}>
      ${btn}
    </div>`;
    })
    .join("");
  return `<h2 class="${titleCls}">${title}</h2>
    <div class="media-list">${rows}</div>`;
}

// Patreon channel detail: render cached posts with a pull action.
function renderPatreonPosts(c) {
  const el = document.getElementById("cd-posts");
  if (!el) return;
  const posts = patreonState.posts[c.id] || [];
  const channelName = c.display_name || c.name;
  // Each post pill carries the same `.vod-dl` button the past-broadcasts
  // list uses; state is keyed by embed_url (== source_url on the resulting
  // RecordingJob), so seedVodDownloadStateFromRecCache surfaces in-flight /
  // completed pulls across navigation just like past broadcasts.
  const rows = posts.length
    ? posts
        .map((p) => {
          const thumb = p.thumbnail_url
            ? `<img class="mp-thumb-img" loading="lazy" alt="" src="${htmlEscape(p.thumbnail_url)}" onerror="this.remove()">`
            : "";
          const url = p.embed_url || "";
          const state = vodDownloadState[url] || "idle";
          const cachedJob = recCache.find((r) => r.source_url === url);
          const inner = state === "downloading"
            ? vodProgressHtml(
                cachedJob && cachedJob.download_pct,
                cachedJob && cachedJob.download_eta_secs,
                cachedJob && cachedJob.download_rate_bps,
              )
            : state === "downloaded" ? "Downloaded" : "Download";
          const btn = url
            ? `<button class="vod-dl vod-dl-${state}" data-action="vod-download"
                  data-via="patreon"
                  data-url="${htmlEscape(url)}"
                  data-channel="${htmlEscape(channelName)}"
                  data-platform="Patreon"
                  data-title="${htmlEscape(p.title)}"
                  ${state !== "idle" ? "disabled" : ""}>${inner}</button>`
            : "";
          return `
      <div class="media-pill">
        <div class="mp-link" style="cursor: default;">
          <div class="mp-thumb">${thumb}</div>
          <div class="mp-info">
            <div class="mp-title">${htmlEscape(p.title)}</div>
            <div class="mp-sub">${htmlEscape((p.published_at || "").slice(0, 10))}</div>
          </div>
          <div class="mp-meta"></div>
        </div>
        ${btn}
      </div>`;
        })
        .join("")
    : '<div class="empty sm">No video posts.</div>';
  el.innerHTML = `<h2 class="cd-section-title">Posts</h2><div class="media-list">${rows}</div>`;
  wireVodDownloadButtons();
}

// #74 — start/stop a per-channel bulk download.
async function toggleBulk(ds) {
  const active = ds.bulkActive === "true";
  try {
    await API.bulkDownload(ds.channelId, {
      channel_name: ds.channelName,
      platform: ds.platform,
      action: active ? "stop" : "start",
    });
    // Optimistic: flip local state; SSE bulk-progress will correct it.
    bulkStatus[ds.channelId] = active
      ? { done: 0, total: 0, active: false }
      : { done: 0, total: 0, active: true };
    Toast.success(
      active
        ? `Stopped bulk download — ${ds.channelName}`
        : `Bulk download started — ${ds.channelName}`,
    );
    if (currentRoute() === "library") render();
  } catch (e) {
    Toast.error(`Bulk download failed: ${e.message}`);
  }
}

// #74 / #73 — request the channel's playlists; the picker modal opens
// when the `playlist-list` SSE event arrives.
let pendingPlaylistChannel = null;
async function openPlaylistPicker(ds) {
  pendingPlaylistChannel = { id: ds.channelId, name: ds.channelName };
  try {
    await API.requestPlaylists(ds.channelId);
    showPlaylistModal({ loading: true, name: ds.channelName, playlists: [] });
  } catch (e) {
    Toast.error(`Couldn't load playlists: ${e.message}`);
  }
}

// ── Add-Channel two-phase wizard (item 19) ───────────────────────────
// Phase 1: pick platform + type a name → resolve (live, via SSE).
// Phase 2: show the resolved channel → confirm → enable auto-record.
// Config is deferred until the entity is confirmed.
let addWizard = null; // { platform, query } while a resolve is in flight

function openAddChannelWizard() {
  let modal = document.getElementById("add-channel-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "add-channel-modal";
    modal.className = "app-modal";
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeAppModal(modal);
    });
  }
  paintAddWizardSearch(modal);
  modal.classList.add("open");
  document.body.classList.add("modal-open");
}

// One owner for the click-outside / ESC / route-change dismissal of all
// .app-modal dialogs. Built so the keyboard-help (kbd-help) overlay
// stays separate — it has its own toggle and shouldn't be auto-closed
// on navigation.
function closeAppModal(modal) {
  if (!modal) return;
  modal.classList.remove("open");
  // B3: decrement the modal-open counter, which auto-clears the body
  // class only when no other open modal remains. The DOM-query check
  // is kept as a defensive belt for callers that bypass bumpModalOpen.
  bumpModalOpen(-1);
  if (_modalOpenCount === 0 && !document.querySelector(".app-modal.open")) {
    document.body.classList.remove("modal-open");
  }
}
function closeAllAppModals() {
  document.querySelectorAll(".app-modal.open").forEach(closeAppModal);
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllAppModals();
});
window.addEventListener("hashchange", closeAllAppModals);

function paintAddWizardSearch(modal, opts = {}) {
  modal = modal || document.getElementById("add-channel-modal");
  if (!modal) return;
  const plat = opts.platform || "Twitch";
  const sel = (p) => (p === plat ? " selected" : "");
  modal.innerHTML = `
    <div class="card">
      <h2>Add channel</h2>
      <p class="wizard-step">Step 1 of 2 — find the channel</p>
      <div class="wizard-row">
        <select id="aw-platform">
          <option value="Twitch"${sel("Twitch")}>Twitch</option>
          <option value="YouTube"${sel("YouTube")}>YouTube</option>
          <option value="Patreon"${sel("Patreon")}>Patreon</option>
        </select>
        <input id="aw-query" type="text" placeholder="Twitch login, or YouTube/Patreon id"
               value="${htmlEscape(opts.query || "")}" autofocus />
        <button id="aw-search" class="primary">Search</button>
      </div>
      <div id="aw-result" class="wizard-result">${htmlEscape(opts.message || "")}</div>
    </div>`;
  const doSearch = async () => {
    const platform = modal.querySelector("#aw-platform").value;
    const query = modal.querySelector("#aw-query").value.trim();
    if (!query) return;
    addWizard = { platform, query };
    modal.querySelector("#aw-result").innerHTML = '<div class="empty sm">Searching…</div>';
    try {
      await API.resolveChannel(platform, query);
    } catch (e) {
      modal.querySelector("#aw-result").innerHTML = `<div class="empty sm">Search failed: ${htmlEscape(e.message)}</div>`;
    }
  };
  modal.querySelector("#aw-search")?.addEventListener("click", doSearch);
  modal.querySelector("#aw-query")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
}

// Phase 2: render the resolved entity for confirmation (called from the
// ChannelResolved SSE handler).
function paintAddWizardConfirm(ev) {
  const modal = document.getElementById("add-channel-modal");
  if (!modal || !modal.classList.contains("open") || !addWizard) return;
  if (ev.platform !== addWizard.platform || ev.query !== addWizard.query) return;
  const result = modal.querySelector("#aw-result");
  if (!result) return;
  if (ev.error || !ev.channel_id) {
    result.innerHTML = `<div class="empty sm">Not found: ${htmlEscape(ev.error || "no match")}</div>`;
    return;
  }
  const name = ev.display_name || ev.channel_id;
  result.innerHTML = `
    <div class="wizard-confirm">
      <p class="wizard-step">Step 2 of 2 — confirm</p>
      <div class="task-row">
        <div class="task-info">
          <span class="task-name">${htmlEscape(name)}</span>
          <span class="task-cadence">${htmlEscape(ev.platform)} · ${htmlEscape(ev.channel_id)}</span>
        </div>
      </div>
      <button id="aw-confirm" class="primary" data-key="${htmlEscape(ev.platform)}:${htmlEscape(ev.channel_id)}">
        Add &amp; enable auto-record
      </button>
    </div>`;
  result.querySelector("#aw-confirm")?.addEventListener("click", async (e) => {
    const key = e.currentTarget.dataset.key;
    try {
      await API.toggleAutoRecord(key, true);
      Toast.success(`Added ${name} — auto-record on`);
      modal.classList.remove("open");
      addWizard = null;
      if (currentRoute() === "library") render();
    } catch (err) {
      Toast.error(`Add failed: ${err.message}`);
    }
  });
}

function showPlaylistModal(opts) {
  let modal = document.getElementById("playlist-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "playlist-modal";
    modal.className = "app-modal";
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("open");
    });
  }
  const rows = opts.loading
    ? "<div>Loading playlists…</div>"
    : [
        `<div class="pl-row" data-pl=""><b>▣ Whole channel</b> (all uploads)</div>`,
        ...opts.playlists.map(
          (p) =>
            `<div class="pl-row" data-pl="${htmlEscape(p.id)}">≡ ${htmlEscape(p.title)}${
              p.item_count != null ? ` (${p.item_count})` : ""
            }</div>`,
        ),
      ].join("");
  modal.innerHTML = `
    <div class="card">
      <h2>Bulk download — ${htmlEscape(opts.name)}</h2>
      <div class="pl-list">${rows}</div>
    </div>`;
  modal.classList.add("open");
  modal.querySelectorAll(".pl-row").forEach((row) => {
    row.addEventListener("click", async () => {
      const ch = pendingPlaylistChannel;
      if (!ch) return;
      const playlist_id = row.dataset.pl || null;
      try {
        await API.bulkDownload(ch.id, {
          channel_name: ch.name,
          platform: "YouTube",
          action: "start",
          playlist_id,
        });
        bulkStatus[ch.id] = { done: 0, total: 0, active: true };
        modal.classList.remove("open");
        Toast.success(`Bulk download started — ${ch.name}`);
        if (currentRoute() === "library") render();
      } catch (e) {
        Toast.error(`Bulk download failed: ${e.message}`);
      }
    });
  });
}

// #74 — bulk-download toggle button reflecting live SSE progress.
function bulkButton(c) {
  const st = bulkStatus[c.id];
  if (st && st.active) {
    const label = st.total > 0 ? `⇩ ${st.done}/${st.total} — Stop` : "⇩ … — Stop";
    return `<button data-action="bulk" data-bulk-active="true"
              data-channel-id="${c.id}"
              data-channel-name="${htmlEscape(c.display_name || c.name)}"
              data-platform="${c.platform}">${label}</button>`;
  }
  return `<button data-action="bulk" data-bulk-active="false"
            data-channel-id="${c.id}"
            data-channel-name="${htmlEscape(c.display_name || c.name)}"
            data-platform="${c.platform}">⇩ Bulk DL</button>`;
}

async function startRecordingFromCard(d) {
  try {
    await API.startRecording({
      channel_id: d.channelId,
      channel_name: d.channelName,
      display_name: d.displayName,
      platform: d.platform,
      from_start: d.fromStart === "true",
      stream_title: d.streamTitle || null,
      thumbnail_url: d.thumbnail || null,
      transcode: false,
    });
    Toast.success(
      `Recording ${d.fromStart === "true" ? "from start " : ""}— ${d.displayName || d.channelName}`,
    );
  } catch (e) {
    Toast.error(`Start failed: ${e.message}`);
  }
}

async function toggleAutoRecord(d) {
  const enabling = d.enabled === "true";
  try {
    await API.toggleAutoRecord(d.channelKey, enabling);
    Toast.success(enabling ? "Auto-record enabled" : "Auto-record disabled");
    await render();
  } catch (e) {
    Toast.error(`Auto-record toggle failed: ${e.message}`);
  }
}

// ── Recordings table ─────────────────────────────────────────────────
// Table | Timeline segmented control shared by both renderRecordings()
// and renderRecordingsTimeline(). Timeline is the old #/history page,
// folded in here (see recView/renderRecordingsTimeline below) — the
// route now redirects (render(), 012-pvr.js) instead of rendering
// standalone.
function recordingsViewToggleHtml(active) {
  return `<div class="rec-view-toggle" role="group" aria-label="View">
    <button type="button" class="rec-view-btn ${active === "table" ? "is-active" : ""}" data-view="table" aria-pressed="${active === "table"}">Table</button>
    <button type="button" class="rec-view-btn ${active === "timeline" ? "is-active" : ""}" data-view="timeline" aria-pressed="${active === "timeline"}">Timeline</button>
  </div>`;
}
function wireRecordingsViewToggle() {
  document.querySelectorAll(".rec-view-toggle [data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = btn.dataset.view === "timeline" ? "#/recordings?view=timeline" : "#/recordings";
    });
  });
}

// The API's first page is a current snapshot, not ownership of the entire
// client library.  Keep rows reached through Load more and overlay the
// refreshed records by ID, so lifecycle events cannot collapse a 502-row
// browse back to its first 500 rows.
function reconcileRecordingSnapshot(records, nextCursor) {
  const incoming = new Map((records || []).map((r) => [String(r.id), r]));
  const seen = new Set();
  const merged = recCache.map((old) => {
    const id = String(old.id);
    seen.add(id);
    return incoming.get(id) || old;
  });
  // New active jobs usually arrive on the first page. Put them first; normal
  // table sorting decides their final visual position.
  const additions = (records || []).filter((record) => !seen.has(String(record.id)));
  recCache = [...additions, ...merged];
  dashRecordings = recCache;
  if (nextCursor !== undefined && !recHasLoadedPages) {
    recNextCursor = nextCursor ?? null;
  }
  seedVodDownloadStateFromRecCache();
}

async function renderRecordings(context = captureRouteContext()) {
  if (!isRouteCurrent(context)) return;
  // Allow sidebar links / external bookmarks to seed the search box
  // via #/recordings?channel=NAME (audit M2), and pick Table vs Timeline
  // via #/recordings?view=timeline (also what #/history now redirects to).
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  let view = "table";
  if (qIdx !== -1) {
    try {
      const params = new URLSearchParams(hash.slice(qIdx + 1));
      const ch = params.get("channel");
      if (ch != null) recFilter = ch;
      if (params.get("view") === "timeline") view = "timeline";
    } catch (_) {}
  }
  if (view === "timeline") {
    await renderRecordingsTimeline(context);
    return;
  }
  let recordings = [];
  try {
    const data = await API.recordings();
    if (!isRouteCurrent(context)) return;
    recordings = data.recordings || [];
    recNextCursor = data.next_cursor ?? null;
  } catch (e) {
    if (e.message.includes("unauthorized")) return;
    mountPage(`<div class="empty"><div class="glyph">⚠</div>${htmlEscape(e.message)}</div>`, context);
    return;
  }
  if (!isRouteCurrent(context)) return;
  root.removeAttribute("aria-busy");
  if (recordings.length === 0) {
    if (!mountPage(`
      <h1 class="page-title">Recordings</h1>
      ${recordingsViewToggleHtml("table")}
      <div class="empty">
        <div class="glyph">📁</div>
        No recordings yet. Start one from the Library tab.
      </div>
    `, context)) return;
    wireRecordingsViewToggle();
    return;
  }
  reconcileRecordingSnapshot(recordings, recNextCursor);
  // W4-alt: sortable + filterable data grid. Column headers toggle sort;
  // the filter box narrows by channel/title live without refetching.
  if (!mountPage(`
    <h1 class="page-title">Recordings</h1>
    ${recordingsViewToggleHtml("table")}
    <div class="rec-toolbar">
      <input id="rec-filter" class="grid-filter" type="search"
             placeholder="Filter by channel or title… (/)"
             aria-label="Filter recordings" value="${htmlEscape(recFilter)}">
      <label class="rec-daterange" title="Filter recordings by started_at; inclusive.">
        from <input id="rec-from" class="rec-date" type="datetime-local" step="60" value="${htmlEscape(recDateFrom || "")}"/>
        to <input id="rec-to" class="rec-date" type="datetime-local" step="60" value="${htmlEscape(recDateTo || "")}"/>
        <button id="rec-clear-range" class="sm" type="button" title="Clear date range">✕</button>
      </label>
      <button id="rec-groupby" class="sm" title="Group rows by channel">
        ${recGroupBy === "channel" ? "▼ Grouped by channel" : "≣ Group by channel"}
      </button>
      <button id="rec-density" class="sm" title="Toggle row density">
        ${recDensity === "compact" ? "≡ Comfortable rows" : "═ Compact rows"}
      </button>
      ${(() => {
        const errored = recCache.filter((r) => stateClassName(r.state) === "failed" || stateLabel(r.state).toLowerCase().includes("interrupt")).length;
        return errored > 0
          ? `<button id="rec-clear-errored" class="danger sm" title="Trash all failed/interrupted recordings">✕ Clear errored (${errored})</button>`
          : "";
      })()}
    </div>
    <div id="rec-state-chips" class="rec-state-chips" role="group" aria-label="Filter by state"></div>
    <p class="page-subtitle" id="rec-count"></p>
    <div id="rec-massbar" class="massbar"></div>
    <table class="recordings-table ${recDensity === "compact" ? "compact" : ""}">
      <thead>
        <tr>
          <th class="rec-check"><input type="checkbox" id="rec-select-all" aria-label="Select all"></th>
          ${recHeader("state", "State")}
          ${recHeader("channel", "Channel")}
          ${recHeader("title", "Title")}
          ${recHeader("started", "Started")}
          ${recHeader("size", "Size")}
          <th></th>
        </tr>
      </thead>
      <tbody id="rec-body"></tbody>
    </table>
    ${recNextCursor != null ? `<button id="rec-load-more" class="button secondary" type="button">Load more recordings</button>` : ""}
  `, context)) return;
  wireRecordingsViewToggle();
  paintRecordings();

  document.getElementById("rec-filter")?.addEventListener("input", (e) => {
    recFilter = e.target.value;
    recWindowOffset = 0;
    paintRecordings();
  });
  document.getElementById("rec-from")?.addEventListener("change", (e) => {
    recDateFrom = e.target.value;
    recWindowOffset = 0;
    paintRecordings();
  });
  document.getElementById("rec-to")?.addEventListener("change", (e) => {
    recDateTo = e.target.value;
    recWindowOffset = 0;
    paintRecordings();
  });
  document.getElementById("rec-clear-range")?.addEventListener("click", () => {
    recDateFrom = ""; recDateTo = "";
    recWindowOffset = 0;
    const f = document.getElementById("rec-from"); const t = document.getElementById("rec-to");
    if (f) f.value = ""; if (t) t.value = "";
    paintRecordings();
  });
  document.getElementById("rec-density")?.addEventListener("click", () => {
    recDensity = recDensity === "compact" ? "comfortable" : "compact";
    localStorage.setItem("strivo-rec-density", recDensity);
    renderRecordings().catch((e) => Toast.error(e.message));
  });
  document.getElementById("rec-groupby")?.addEventListener("click", () => {
    recGroupBy = recGroupBy === "channel" ? "none" : "channel";
    localStorage.setItem("strivo-rec-groupby", recGroupBy);
    renderRecordings().catch((e) => Toast.error(e.message));
  });
  // Build state chips from the unique states currently in the cache, so
  // we don't paint chips for states that have zero rows. Each chip is a
  // toggle that AND-narrows the visible rows (empty filter = show all).
  paintRecStateChips();
  document.getElementById("rec-clear-errored")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const errored = recCache.filter((r) => {
      const c = stateClassName(r.state);
      const l = stateLabel(r.state).toLowerCase();
      return c === "failed" || l.includes("interrupt");
    });
    if (errored.length === 0) return;
    if (!(await confirmDialog(`Trash ${errored.length} errored recording(s)? Files move to the 7-day trash.`, { ok: "Clear", danger: true })))
      return;
    await withBusy(btn, "Clearing…", async () => {
      await API.clearErroredRecordings();
      Toast.success(`Cleared ${errored.length}`);
      // Optimistic prune; SSE refetch confirms.
      const erroredIds = new Set(errored.map((r) => r.id));
      recCache = recCache.filter((r) => !erroredIds.has(r.id));
      renderRecordings().catch(() => {});
    }).catch((err) => Toast.error(`Clear failed: ${err.message}`));
  });
  document.getElementById("rec-select-all")?.addEventListener("change", (e) => {
    const visible = visibleRecordingIds();
    if (e.target.checked) visible.forEach((id) => recSelected.add(id));
    else visible.forEach((id) => recSelected.delete(id));
    paintRecordings();
  });
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    const sortBy = () => {
      const col = th.dataset.sort;
      if (recSort.col === col) {
        recSort.dir = recSort.dir === "asc" ? "desc" : "asc";
      } else {
        recSort = { col, dir: "asc" };
      }
      renderRecordings().catch((e) => Toast.error(e.message)); // re-render header arrows + body
    };
    th.addEventListener("click", sortBy);
    // R04 — Enter/Space activate sort for keyboard users (headers carry
    // tabindex="0" + role="button" from recHeader()).
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        sortBy();
      }
    });
  });
  document.getElementById("rec-load-more")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Loading…";
    try {
      const page = await API.recordings({ cursor: recNextCursor, limit: 500 });
      reconcileRecordingSnapshot(page.recordings || []);
      recNextCursor = page.next_cursor ?? null;
      recHasLoadedPages = true;
      seedVodDownloadStateFromRecCache();
      if (recNextCursor == null) button.remove();
      else {
        button.disabled = false;
        button.textContent = "Load more recordings";
      }
      paintRecStateChips();
      paintRecordings();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Load more recordings";
      Toast.error(`Recordings load failed: ${error.message}`);
    }
  });
}

// ── Recordings → Timeline view (former #/history route) ────────────────
// Durable per-recording journal from the jobs DB, survives daemon
// restarts unlike the in-memory /recordings snapshot. Used to be its own
// #/history page with its own nav slot + a second copy of the Recordings
// table's actions; #/history now redirects to #/recordings?view=timeline
// (render(), above) and this is that view. The paint* functions
// (paintHistHeatmap/paintHistChips/paintHistory/historyPillHtml) stayed
// in 036-pvr.js — they're not route-specific, they just paint into
// whichever DOM currently has the matching #hist-* ids.
let histFilter = "";
let histGroupBy = localStorage.getItem("strivo-hist-groupby") || "none"; // "none" | "channel" | "date"
// Date heatmap click-day filter — "YYYY-MM-DD" or "" for unset.
let histDay = "";
let histStateFilter = new Set(
  (localStorage.getItem("strivo-hist-state-filter") || "")
    .split(",").filter(Boolean),
);
let histCache = [];
let histNextCursor = null;
let histTotal = 0;
let histRenderLimit = 200;

async function renderRecordingsTimeline(context = captureRouteContext()) {
  if (!isRouteCurrent(context)) return;
  // Fetch history alongside the live /recordings snapshot so we can
  // overlay file_exists state (audit B4). Without this, Timeline happily
  // reports 'Finished, 9 GB' for files the Recordings table knows are
  // long gone.
  let [hist, recs] = [[], []];
  try {
    const [h, r] = await Promise.all([
      API.history().catch(() => ({ history: [] })),
      API.recordings().catch(() => ({ recordings: [] })),
    ]);
    if (!isRouteCurrent(context)) return;
    hist = h.history || [];
    histNextCursor = h.next_cursor ?? null;
    histTotal = h.total ?? hist.length;
    recs = r.recordings || [];
  } catch (_) {}
  if (!isRouteCurrent(context)) return;
  const liveById = new Map(recs.map((r) => [r.id, r]));
  histCache = hist.map((row) => {
    const live = liveById.get(row.id);
    if (live && live.file_exists === false) {
      return { ...row, file_exists: false, state: "Failed" };
    }
    // Carry over SSE-only progress fields the /history snapshot never
    // has (it's a point-in-time REST fetch of the durable journal, while
    // RecordingProgress patches only the in-memory recCache array).
    // Without this a Timeline row for an in-progress job is stuck
    // showing whatever /history happened to return, however stale.
    if (live) {
      const merged = { ...row };
      for (const k of ["download_pct", "download_eta_secs", "download_rate_bps", "bytes_written", "duration_secs"]) {
        if (live[k] != null) merged[k] = live[k];
      }
      return merged;
    }
    return row;
  });
  root.removeAttribute("aria-busy");

  if (histCache.length === 0) {
    if (!mountPage(`
      <h1 class="page-title">Recordings</h1>
      ${recordingsViewToggleHtml("timeline")}
      <div class="empty">
        <div class="glyph">🗂</div>
        No recording history yet. Captures land here automatically.
      </div>
    `, context)) return;
    wireRecordingsViewToggle();
    return;
  }

  if (!mountPage(`
    <h1 class="page-title">Recordings</h1>
    ${recordingsViewToggleHtml("timeline")}
    <p class="page-subtitle" id="hist-count"></p>
    <div id="hist-heatmap"></div>
    <div class="rec-toolbar">
      <input id="hist-filter" class="grid-filter" type="search"
             placeholder="Filter by channel or title…"
             aria-label="Filter history" value="${htmlEscape(histFilter)}">
      <button id="hist-groupby" class="sm" title="Group rows">
        ${histGroupBy === "channel" ? "▼ Grouped by channel"
          : histGroupBy === "date" ? "▼ Grouped by month"
          : "≣ Group by…"}
      </button>
      ${histDay ? `<button id="hist-clear-day" class="sm" type="button" title="Clear day filter">✕ ${htmlEscape(histDay)}</button>` : ""}
    </div>
    <div id="hist-state-chips" class="rec-state-chips" role="group" aria-label="Filter by state"></div>
    <div id="hist-list" class="media-list"></div>
    ${histNextCursor != null ? `<button id="hist-load-more" class="button secondary" type="button">Load more history</button>` : ""}
  `, context)) return;
  wireRecordingsViewToggle();
  paintHistHeatmap();
  paintHistChips();
  paintHistory();
  document.getElementById("hist-clear-day")?.addEventListener("click", () => {
    histDay = "";
    renderRecordingsTimeline().catch((e) => Toast.error(e.message));
  });

  document.getElementById("hist-filter")?.addEventListener("input", (e) => {
    histFilter = e.target.value;
    paintHistory();
  });
  document.getElementById("hist-groupby")?.addEventListener("click", () => {
    histGroupBy = histGroupBy === "none"
      ? "channel"
      : histGroupBy === "channel" ? "date" : "none";
    localStorage.setItem("strivo-hist-groupby", histGroupBy);
    renderRecordingsTimeline().catch((e) => Toast.error(e.message));
  });
  document.getElementById("hist-load-more")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Loading…";
    try {
      const page = await API.history({ cursor: histNextCursor, limit: 200 });
      histCache.push(...(page.history || []));
      histNextCursor = page.next_cursor ?? null;
      histTotal = page.total ?? histCache.length;
      if (histNextCursor == null) button.remove();
      else {
        button.disabled = false;
        button.textContent = "Load more history";
      }
      paintHistHeatmap();
      paintHistChips();
      paintHistory();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Load more history";
      Toast.error(`History load failed: ${error.message}`);
    }
  });
}

// Surgical DOM patch for a single Timeline (`.hist-pill`) row's progress
// state pill, mirroring patchRecordingRow's role for the Recordings
// table. Called from the RecordingProgress SSE handler (036-pvr.js) so a
// live download's percent updates without a full
// renderRecordingsTimeline re-fetch/re-paint.
function patchHistPillProgress(job) {
  if (!job || !job.id) return;
  const pill = document.querySelector(`.hist-pill[data-job-id="${CSS.escape(job.id)}"]`);
  if (!pill) return;
  const meta = pill.querySelector(".mp-meta");
  if (!meta) return;
  const existing = meta.querySelector(".state-pill");
  if (existing) existing.outerHTML = renderStatePill(recordingDisplayState(job));
}

function paintRecStateChips() {
  const host = document.getElementById("rec-state-chips");
  if (!host) return;
  const counts = new Map();
  for (const r of recCache) {
    const key = stateClassName(r.state);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size <= 1) {
    // Single state in cache → chips add no value; skip the row entirely.
    host.innerHTML = "";
    return;
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const chips = sorted
    .map(([state, n]) => {
      const active = recStateFilter.size === 0 || recStateFilter.has(state);
      return `<button class="rec-state-chip state-${htmlEscape(state)} ${active ? "active" : ""}"
                data-state="${htmlEscape(state)}" type="button">
        <span class="rec-state-chip-dot"></span>
        ${htmlEscape(stateChipLabel(state))}
        <span class="rec-state-chip-count">${n}</span>
      </button>`;
    })
    .join("");
  const allActive = recStateFilter.size === 0;
  host.innerHTML = `
    <button class="rec-state-chip rec-state-chip-all ${allActive ? "active" : ""}"
            type="button" title="Show every state">
      <span class="rec-state-chip-dot"></span>All <span class="rec-state-chip-count">${recCache.length}</span>
    </button>
    ${chips}`;
  host.querySelector(".rec-state-chip-all")?.addEventListener("click", () => {
    recStateFilter.clear();
    localStorage.setItem("strivo-rec-state-filter", "");
    paintRecStateChips();
    paintRecordings();
  });
  host.querySelectorAll("[data-state]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = btn.dataset.state;
      // Click pattern: starting from "all visible", a click selects ONLY
      // that state. Subsequent clicks toggle additional states (AND-narrow
      // turns into OR-additive — matches gmail's chip behaviour).
      if (recStateFilter.size === 0) {
        recStateFilter = new Set([s]);
      } else if (recStateFilter.has(s)) {
        recStateFilter.delete(s);
      } else {
        recStateFilter.add(s);
      }
      localStorage.setItem(
        "strivo-rec-state-filter",
        Array.from(recStateFilter).join(","),
      );
      paintRecStateChips();
      paintRecordings();
    });
  });
}

// Human-friendly label for a state classname. Falls back to title-case.
function stateChipLabel(cls) {
  switch (cls) {
    case "finished": return "Finished";
    case "recording": return "Recording";
    case "downloading": return "Downloading";
    case "failed": return "Failed";
    case "file-error": return "File missing";
    case "scheduled": return "Scheduled";
    default: return cls.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }
}

function recHeader(key, label) {
  // Active column shows the direction arrow; inactive sortable columns
  // get a faint ↕ so the affordance is discoverable (R6 audit fix).
  const arrow =
    recSort.col === key
      ? (recSort.dir === "asc" ? " ▲" : " ▼")
      : ' <span class="rec-th-sort-hint" aria-hidden="true">↕</span>';
  // R04 — headers are keyboard-operable: tabbable + role="button" so
  // Enter/Space (wired where the click handler is bound) can sort, not
  // just a mouse click.
  const ariaSort = recSort.col === key
    ? (recSort.dir === "asc" ? "ascending" : "descending")
    : "none";
  return `<th data-sort="${key}" class="rec-th-sortable micro" tabindex="0" role="button" aria-sort="${ariaSort}">${label}${arrow}</th>`;
}

// Close every open "⋯" row menu (recordingRow's .rec-row-menu-list). One
// document-level listener (Escape + click-outside) keeps this to O(1)
// bindings regardless of row count.
function closeAllRecRowMenus() {
  document.querySelectorAll(".rec-row-menu-list").forEach((list) => {
    list.hidden = true;
    list.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}
if (!document.body.dataset.recMenuBound) {
  document.body.dataset.recMenuBound = "1";
  document.addEventListener("click", closeAllRecRowMenus);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllRecRowMenus();
  });
}

// Normalize display/search/sort values once per record revision.  Progress
// updates only revise the numeric fields they change, so typing and sorting a
// long library do not repeatedly run title cleanup/regex work in comparators.
const recIndexCache = new WeakMap();
function recordingIndex(r) {
  const revision = [r.state, r.channel_name, r.stream_title, r.started_at, r.bytes_written].join("\u0001");
  const cached = recIndexCache.get(r);
  if (cached && cached.revision === revision) return cached;
  const index = {
    revision,
    state: stateLabel(r.state).toLowerCase(),
    channel: (r.channel_name || "").toLowerCase(),
    title: niceTitle(r.stream_title).toLowerCase(),
    started: recordingTime(r),
    size: r.bytes_written || 0,
  };
  recIndexCache.set(r, index);
  return index;
}

function patchRecordingRow(row, recording) {
  const before = row.dataset.recState;
  const display = recordingDisplayState(recording);
  // State transitions change available actions and may move a row between
  // groups, so use the full keyed reconciliation path for those rare events.
  if (before !== display.className) return false;
  if (row.dataset.recSignature !== recordingRowSignature(recording)) return false;
  row.classList.toggle("rec-sel", recSelected.has(recording.id));
  const stateCell = row.querySelector("td:nth-child(2)");
  const stateHtml = renderStatePill(display);
  if (stateCell.innerHTML !== stateHtml) stateCell.innerHTML = stateHtml;
  const size = row.querySelector("td:nth-child(6)");
  if (size) size.textContent = formatBytes(recording.bytes_written || 0);
  const checkbox = row.querySelector(".rec-row-check");
  if (checkbox) checkbox.checked = recSelected.has(recording.id);
  return true;
}

function updateRecPager(body, totalRows, rendered) {
  let pager = body.querySelector("[data-rec-pager]")?.closest("tr");
  if (totalRows <= recRenderLimit) {
    pager?.remove();
    return;
  }
  if (!pager) {
    body.insertAdjacentHTML("beforeend", '<tr data-rec-pager><td colspan="7" class="empty sm"></td></tr>');
    pager = body.lastElementChild;
  }
  const signature = `${recWindowOffset}:${recRenderLimit}:${totalRows}:${rendered}`;
  if (pager.dataset.pageSignature === signature) return;
  pager.dataset.pageSignature = signature;
  pager.firstElementChild.innerHTML = `
    <button id="rec-page-prev" type="button" ${recWindowOffset === 0 ? "disabled" : ""}>Previous ${recRenderLimit}</button>
    <button id="rec-page-next" type="button" ${recWindowOffset + recRenderLimit >= totalRows ? "disabled" : ""}>Next ${recRenderLimit}</button>
    <span class="pg-cap-hint"> ${recWindowOffset + 1}–${recWindowOffset + rendered} of ${totalRows}</span>`;
  pager.querySelector("#rec-page-prev")?.addEventListener("click", () => {
    recWindowOffset = Math.max(0, recWindowOffset - recRenderLimit);
    paintRecordings();
  });
  pager.querySelector("#rec-page-next")?.addEventListener("click", () => {
    recWindowOffset = Math.min(totalRows - 1, recWindowOffset + recRenderLimit);
    paintRecordings();
  });
}

// Apply the live filter + sort to recCache. Stable rows are patched in place
// so SSE progress preserves focused controls, open row menus, selection, and
// the scroll anchor.
function paintRecordings(dirtyIds = null) {
  const body = document.getElementById("rec-body");
  if (!body) return;
  const focusedElement = document.activeElement;
  const q = recFilter.trim().toLowerCase();
  let rows = recCache.filter((r) => {
    if (recStateFilter.size > 0 && !recStateFilter.has(stateClassName(r.state))) return false;
    // Started-at date-range filter. Empty bound = unbounded.
    if (recDateFrom || recDateTo) {
      const sa = (r.started_at || "").slice(0, 19); // YYYY-MM-DDTHH:MM:SS
      if (!sa) return false;
      if (recDateFrom && sa < recDateFrom) return false;
      if (recDateTo && sa > recDateTo) return false;
    }
    if (!q) return true;
    return (
      recordingIndex(r).channel.includes(q) || recordingIndex(r).title.includes(q)
    );
  });
  const dir = recSort.dir === "asc" ? 1 : -1;
  const key = (r) => recordingIndex(r)[recSort.col] ?? recordingIndex(r).started;
  rows.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka < kb ? -dir : ka > kb ? dir : 0;
  });
  const totalRows = rows.length;
  if (recWindowOffset >= rows.length) recWindowOffset = Math.max(0, rows.length - recRenderLimit);
  const renderRows = rows.slice(recWindowOffset, recWindowOffset + recRenderLimit);
  recVisible = renderRows;
  const existing = Array.from(body.querySelectorAll("tr[data-rec-row]"));
  const stableRows = existing.length === renderRows.length &&
    existing.every((row, i) => row.dataset.recRow === String(renderRows[i].id));
  if (stableRows && existing.every((row, i) => !dirtyIds || dirtyIds.has(String(renderRows[i].id))
    ? patchRecordingRow(row, renderRows[i]) : true)) {
    const count = document.getElementById("rec-count");
    if (count) count.textContent = `${recCache.length} recordings · ${totalRows} match`;
    updateRecPager(body, totalRows, renderRows.length);
    const all = document.getElementById("rec-select-all");
    if (all) all.checked = renderRows.length > 0 && renderRows.every((r) => recSelected.has(r.id));
    updateMassbar();
    return;
  }
  if (recGroupBy === "channel") {
    // Cluster rows by channel_name while preserving the active sort order
    // within each cluster. Each cluster gets a heading row spanning every
    // column — sticky-styled via CSS — so the table reads like a grouped
    // ledger without needing a separate render pass per group.
    const order = [];
    const byChannel = new Map();
    for (const r of renderRows) {
      const k = r.channel_name || "(unknown)";
      if (!byChannel.has(k)) { byChannel.set(k, []); order.push(k); }
      byChannel.get(k).push(r);
    }
    const existingById = new Map(existing.map((row) => [row.dataset.recRow, row]));
    const wanted = new Set(renderRows.map((recording) => String(recording.id)));
    // Group headers are presentation-only. Retire those, then reconcile the
    // keyed data rows in the still-connected tbody.
    body.querySelectorAll("tr.rec-group-head, tr[data-rec-pager]").forEach((row) => row.remove());
    let cursor = body.firstElementChild;
    for (const ch of order) {
      const list = byChannel.get(ch);
      const totalBytes = list.reduce((a, b) => a + (b.bytes_written || 0), 0);
      const template = document.createElement("template");
      template.innerHTML = `<tr class="rec-group-head"><td colspan="7">
        <span class="rec-group-name">${htmlEscape(ch)}</span>
        <span class="rec-group-meta">${list.length} recording${list.length === 1 ? "" : "s"} · ${formatBytes(totalBytes)}</span>
      </td></tr>`;
      const header = template.content.firstElementChild;
      body.insertBefore(header, cursor);
      for (const recording of list) {
        let row = existingById.get(String(recording.id));
        if (!row || !patchRecordingRow(row, recording)) {
          const previous = row;
          const rowTemplate = document.createElement("template");
          rowTemplate.innerHTML = recordingRow(recording).trim();
          row = rowTemplate.content.firstElementChild;
          if (previous) {
            if (cursor === previous) cursor = row;
            previous.replaceWith(row);
          }
        }
        if (row !== cursor) body.insertBefore(row, cursor);
        cursor = row.nextElementSibling;
      }
    }
    for (const row of Array.from(body.querySelectorAll("tr[data-rec-row]"))) {
      if (!wanted.has(row.dataset.recRow)) row.remove();
    }
  } else {
    // Reconcile in the connected tbody. `replaceChildren(fragment)` would
    // briefly disconnect every focused row; insertBefore moves only rows
    // whose position changed and leaves an unrelated open menu in place.
    const existingById = new Map(existing.map((row) => [row.dataset.recRow, row]));
    const wanted = new Set(renderRows.map((recording) => String(recording.id)));
    let cursor = body.firstElementChild;
    for (const recording of renderRows) {
      let row = existingById.get(String(recording.id));
      if (!row || !patchRecordingRow(row, recording)) {
        const previous = row;
        const template = document.createElement("template");
        template.innerHTML = recordingRow(recording).trim();
        row = template.content.firstElementChild;
        if (previous) {
          if (cursor === previous) cursor = row;
          previous.replaceWith(row);
        }
      }
      if (row !== cursor) body.insertBefore(row, cursor);
      cursor = row.nextElementSibling;
    }
    for (const row of Array.from(body.querySelectorAll("tr[data-rec-row]"))) {
      if (!wanted.has(row.dataset.recRow)) row.remove();
    }
    // Footer/group rows are derived presentation and are rebuilt below.
    body.querySelectorAll("tr[data-rec-pager]").forEach((row) => row.remove());
  }
  updateRecPager(body, totalRows, renderRows.length);
  const count = document.getElementById("rec-count");
  if (count) {
    count.textContent = `${recCache.length} recordings · ${totalRows} match`;
  }
  body.querySelectorAll("[data-action=stop]").forEach((btn) => {
    if (btn.dataset.recBound) return;
    btn.dataset.recBound = "1";
    btn.addEventListener("click", async () => {
      if (!(await confirmDialog("Stop this recording?", { ok: "Stop", danger: true })))
        return;
      await withBusy(btn, "Stopping…", async () => {
        await API.stopRecording(btn.dataset.jobId);
        Toast.success("Recording stopped");
        setTimeout(() => render().catch(() => {}), 500);
      }).catch((e) => Toast.error(`Stop failed: ${e.message}`));
    });
  });
  body.querySelectorAll("[data-action=rec-play]").forEach((btn) => {
    if (btn.dataset.recBound) return;
    btn.dataset.recBound = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.jobId;
      if (id) window.location.hash = `#/watch?recording=${encodeURIComponent(id)}&fresh=1`;
    });
  });
  body.querySelectorAll("[data-action=rec-info]").forEach((btn) => {
    if (btn.dataset.recBound) return;
    btn.dataset.recBound = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openRecordingInfo(btn.dataset.jobId);
    });
  });
  body.querySelectorAll("[data-action=rec-rescan]").forEach((btn) => {
    if (btn.dataset.recBound) return;
    btn.dataset.recBound = "1";
    btn.addEventListener("click", (e) => { e.stopPropagation(); reScanRecording(btn); });
  });
  body.querySelectorAll("[data-action=rec-locate]").forEach((btn) => {
    if (btn.dataset.recBound) return;
    btn.dataset.recBound = "1";
    btn.addEventListener("click", (e) => { e.stopPropagation(); showRecordingPath(btn.dataset.path); });
  });
  body.querySelectorAll("[data-action=rec-delete]").forEach((btn) => {
    if (btn.dataset.recBound) return;
    btn.dataset.recBound = "1";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog("Delete this recording? The file moves to the 7-day trash.", { ok: "Delete", danger: true })))
        return;
      await withBusy(btn, "Deleting…", async () => {
        await API.deleteRecordingFile(btn.dataset.jobId);
        Toast.success("Deleted");
        // Optimistic: drop from local cache + repaint; the SSE refetch
        // confirms shortly.
        recCache = recCache.filter((r) => r.id !== btn.dataset.jobId);
        renderRecordings().catch(() => {});
      }).catch((err) => Toast.error(`Delete failed: ${err.message}`));
    });
  });
  body.querySelectorAll("[data-action=rec-rerecord]").forEach((btn) => {
    if (btn.dataset.recBound) return;
    btn.dataset.recBound = "1";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeAllRecRowMenus();
      const r = recCache.find((row) => row.id === btn.dataset.jobId);
      if (!r) return;
      if (!(await confirmDialog(`Re-record '${r.channel_name}' now? This starts a fresh capture and may collide with any active recording on that channel.`, { ok: "Re-record", danger: true })))
        return;
      await withBusy(btn, "Queuing…", async () => {
        await API.startRecording({
          channel_id: r.channel_id,
          channel_name: r.channel_name,
          platform: r.platform,
          from_start: true,
        });
        Toast.success("Re-record queued");
        render().catch(() => {});
      }).catch((err) => Toast.error(`Re-record failed: ${err.message}`));
    });
  });
  body.querySelectorAll("[data-action=rec-remux]").forEach((btn) => {
    if (btn.dataset.recBound) return;
    btn.dataset.recBound = "1";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeAllRecRowMenus();
      if (!(await confirmDialog("Remux this recording for browser playback? The original is kept as <name>.orig until success.", { ok: "Remux" })))
        return;
      await withBusy(btn, "Remuxing…", async () => {
        await API.remuxRecording(btn.dataset.jobId);
        Toast.success("Remuxed");
        render().catch(() => {});
      }).catch((err) => Toast.error(`Remux failed: ${err.message}`));
    });
  });
  // "⋯" row menu — one open at a time; a click anywhere else (or Escape)
  // closes it. Delegated on body rather than per-row so N rows cost one
  // listener, matching the rest of this table's wiring.
  body.querySelectorAll("[data-action=rec-menu-toggle]").forEach((btn) => {
    if (btn.dataset.recBound) return;
    btn.dataset.recBound = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const list = btn.nextElementSibling;
      const willOpen = list.hidden;
      closeAllRecRowMenus();
      if (willOpen) {
        list.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
  // Row click:
  //   plain                           → open Info modal
  //   Shift+click                     → select range (anchor → here)
  //   Ctrl/Cmd+click                  → toggle just this row
  // Buttons/inputs/anchors still get their own handlers (early-return).
  // W4 keyboard nav: rows are tabbable; Enter plays, I opens info, Del
  // confirms delete. Delegated on body so we attach one handler total
  // regardless of N rows (audit P1 perf #4).
  if (!body.dataset.kbBound) {
    body.dataset.kbBound = "1";
    body.tabIndex = -1;
    body.addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr[data-rec-row]");
      if (!tr) return;
      const id = tr.dataset.recRow;
      if (e.key === "Enter") {
        e.preventDefault();
        const playable = tr.querySelector('button[data-action="play-rec"]') ||
                         tr.querySelector('.rec-action-play');
        if (playable) playable.click();
        else if (id) window.location.hash = `#/watch?recording=${encodeURIComponent(id)}&fresh=1`;
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        const info = tr.querySelector('[data-action="info"], .rec-action-info');
        info?.click();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const del = tr.querySelector('[data-action="delete"], .rec-action-del');
        del?.click();
      }
    });
  }
  body.querySelectorAll("tr[data-rec-row]").forEach((tr) => {
    if (tr.dataset.recBound) return;
    tr.dataset.recBound = "1";
    if (!tr.hasAttribute("tabindex")) tr.tabIndex = 0;
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button, input, a")) return;
      const id = tr.dataset.recRow;
      if (e.shiftKey && recAnchorId) {
        e.preventDefault();
        const ids = visibleRecordingIds();
        const i = ids.indexOf(recAnchorId);
        const j = ids.indexOf(id);
        if (i >= 0 && j >= 0) {
          const [lo, hi] = i < j ? [i, j] : [j, i];
          for (let k = lo; k <= hi; k++) recSelected.add(ids[k]);
          paintRecordings();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (recSelected.has(id)) recSelected.delete(id);
        else recSelected.add(id);
        recAnchorId = id;
        paintRecordings();
        return;
      }
      openRecordingInfo(id);
    });
  });
  // Selection model:
  //   Click checkbox            → toggle this row
  //   Shift+click checkbox/row  → select range from anchor to here
  //   Ctrl/Cmd+click row body   → toggle this row (without opening Info)
  //   Plain click row body      → open Info modal (handled below)
  body.querySelectorAll(".rec-row-check").forEach((cb) => {
    if (cb.dataset.recBound) return;
    cb.dataset.recBound = "1";
    // Let the native input commit first, then synchronize our selection on
    // change. This keeps programmatic `.check()` and keyboard Space truthful
    // while retaining the range-selection extension.
    cb.addEventListener("change", (e) => {
      const id = cb.dataset.jobId;
      if (e.shiftKey && recAnchorId) {
        const ids = visibleRecordingIds();
        const i = ids.indexOf(recAnchorId);
        const j = ids.indexOf(id);
        if (i >= 0 && j >= 0) {
          const [lo, hi] = i < j ? [i, j] : [j, i];
          for (let k = lo; k <= hi; k++) recSelected.add(ids[k]);
        }
      } else {
        if (cb.checked) recSelected.add(id);
        else recSelected.delete(id);
        recAnchorId = id;
      }
      paintRecordings();
    });
  });
  const all = document.getElementById("rec-select-all");
  if (all) {
    const vis = visibleRecordingIds();
    all.checked = vis.length > 0 && vis.every((id) => recSelected.has(id));
  }
  updateMassbar();
  if (focusedElement?.isConnected && document.activeElement !== focusedElement) {
    focusedElement.focus({ preventScroll: true });
  }
}

// IDs currently visible after filter/sort (for select-all + mass actions).
let recVisible = [];
let recRenderLimit = 200;
let recWindowOffset = 0;
// `null` cursor means either an initial page has no continuation or every
// page has been loaded. Keep that distinction so an SSE first-page refresh
// cannot reintroduce a Load more control after exhaustive browsing.
let recHasLoadedPages = false;
function visibleRecordingIds() {
  return recVisible.map((r) => r.id);
}

// Show/hide the multi-select mass-action bar (item 22). Acts on the selection
// intersected with currently-visible rows.
function updateMassbar() {
  const bar = document.getElementById("rec-massbar");
  if (!bar) return;
  const visible = new Set(visibleRecordingIds());
  const sel = recVisible.filter((r) => recSelected.has(r.id) && visible.has(r.id));
  if (sel.length === 0) {
    // Reversal of an earlier "audit fix": that version kept this bar
    // permanently visible (disabled buttons) so the bulk affordances were
    // discoverable before any selection. The persistent chrome itself is
    // now the problem the user picked to fix — the bar was one of four
    // always-on rows in the topbar/toolbar area competing for attention.
    // Hide it entirely until a row is actually ticked.
    bar.hidden = true;
    bar.classList.remove("massbar-empty");
    bar.innerHTML = "";
    delete bar.dataset.selectionSignature;
    return;
  }
  bar.classList.remove("massbar-empty");
  const active = sel.filter((r) => stateClassName(r.state) === "recording");
  bar.hidden = false;
  // Pre-compute which selected rows are finished + look browser-broken,
  // so the Remux button is only offered when it could actually help.
  const remuxable = sel.filter((r) => stateClassName(r.state) === "finished" && r.file_exists !== false);
  const deletable = sel.filter((r) => r.file_exists !== false || stateClassName(r.state) !== "recording");
  const selectionSignature = JSON.stringify(sel.map((r) => [r.id, recordingRowSignature(r)]));
  if (bar.dataset.selectionSignature === selectionSignature) return;
  bar.dataset.selectionSignature = selectionSignature;
  bar.innerHTML = `
    <span class="massbar-count">${sel.length} selected</span>
    ${active.length ? `<button id="mass-stop" class="danger sm">Stop ${active.length} active</button>` : ""}
    <button id="mass-rerecord" class="sm">Re-record ${sel.length}</button>
    ${remuxable.length ? `<button id="mass-remux" class="sm" title="Remux for browser playback (matroska + aac_adtstoasc)">Remux ${remuxable.length}</button>` : ""}
    ${deletable.length ? `<button id="mass-delete" class="danger sm">Delete ${deletable.length}</button>` : ""}
    <button id="mass-clear" class="sm">Clear</button>`;
  document.getElementById("mass-clear")?.addEventListener("click", () => {
    recSelected.clear();
    paintRecordings();
  });
  document.getElementById("mass-stop")?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Stop ${active.length} active recording(s)?`, { ok: "Stop", danger: true })))
      return;
    let ok = 0;
    for (const r of active) {
      try {
        await API.stopRecording(r.id);
        ok++;
      } catch (_) {}
    }
    Toast.success(`Stopped ${ok}/${active.length}`);
    recSelected.clear();
    setTimeout(() => render().catch(() => {}), 500);
  });
  document.getElementById("mass-rerecord")?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Re-record ${sel.length} channel(s) now? This starts fresh captures and may collide with any active recording on those channels.`, { ok: "Re-record", danger: true })))
      return;
    let ok = 0;
    for (const r of sel) {
      try {
        await API.startRecording({
          channel_id: r.channel_id,
          channel_name: r.channel_name,
          platform: r.platform,
          from_start: true,
        });
        ok++;
      } catch (_) {}
    }
    Toast.success(`Re-record queued ${ok}/${sel.length}`);
    recSelected.clear();
    setTimeout(() => render().catch(() => {}), 500);
  });
  document.getElementById("mass-remux")?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Remux ${remuxable.length} recording(s) for browser playback? Originals are kept as <name>.orig until success.`, { ok: "Remux" })))
      return;
    let ok = 0;
    for (const r of remuxable) {
      try {
        await API.remuxRecording(r.id);
        ok++;
      } catch (_) {}
    }
    Toast.success(`Remuxed ${ok}/${remuxable.length}`);
    recSelected.clear();
    setTimeout(() => render().catch(() => {}), 500);
  });
  document.getElementById("mass-delete")?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Delete ${deletable.length} recording(s)? Files move to the 7-day trash.`, { ok: "Delete", danger: true })))
      return;
    let ok = 0;
    for (const r of deletable) {
      try {
        await API.deleteRecordingFile(r.id);
        ok++;
      } catch (_) {}
    }
    Toast.success(`Deleted ${ok}/${deletable.length}`);
    recSelected.clear();
    setTimeout(() => render().catch(() => {}), 500);
  });
}

// Cover thumbnail for a recording. The wrapper renders a channel-initials
// tile coloured by a hash of the channel name; the inner <img> sits on top
// and covers it when /thumb returns a real jpg. On 404 the img self-removes
// and the initials show through, so old recordings (made before the source-
// thumbnail snapshot landed, and missed by ffmpeg fallback on the server)
// still look intentional rather than broken.
function recThumb(r) {
  const initials = (r.channel_name || r.stream_title || "?")
    .trim()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
  const hue = thumbHue(r.channel_name || r.id || "");
  // r.file_exists is set by the backend's augment_recording; when false the
  // recording's output_path is gone from disk (moved / deleted / external
  // drive offline) so we surface it as a red-caps overlay over the thumb.
  const missing = r.file_exists === false ? " rec-thumb-missing" : "";
  return `<span class="rec-thumb-wrap${missing}" data-init="${htmlEscape(initials)}"
    style="--ch-hue:${hue}deg">
    <img class="rec-thumb" loading="lazy" alt=""
      src="/api/v1/recordings/${encodeURIComponent(r.id)}/thumb"
      onerror="this.remove()" />
  </span>`;
}

function recordingRowSignature(r) {
  const display = recordingDisplayState(r);
  return [
    display.className, r.channel_name, r.stream_title, r.started_at,
    r.file_exists, r.output_path, r.source_url, r.channel_id, r.platform,
  ].map((value) => String(value ?? "")).join("\u0001");
}

// Stable hash → hue so the same channel always gets the same colour, but
// different channels get different ones across the rail.
function thumbHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function recordingRow(r) {
  const disp = recordingDisplayState(r);
  const stateClass = disp.className;
  // Active includes both live captures (Recording) and VOD pulls (Downloading);
  // both are in-flight and offer Stop.
  const isActive = stateClass === "recording" || stateClass === "downloading";
  const isFinished = stateClass === "finished";
  // Action set per state. Play sits in slot 1 across every row; when the
  // recording isn't playable yet we render a disabled placeholder so the
  // button columns stay vertically aligned (in-flight downloads + failed
  // captures previously dropped slot 1 and the remaining buttons hopped
  // left).
  const playBtn = isFinished
    ? `<button class="primary sm" data-action="rec-play" data-job-id="${r.id}" title="Open player (Enter)">▶ Play</button>`
    : `<button class="primary sm rec-play-disabled" disabled aria-disabled="true" title="${isActive ? "Playable when capture finishes" : "Recording unavailable"}">▶ Play</button>`;
  // Delete/Re-record/Remux live in a "⋯" row menu instead of sitting as
  // inline buttons beside Play — only Stop (while active) and Info stay
  // directly visible. Each item is offered only when it would actually do
  // something for this row's state.
  const canRerecord = !isActive;
  const canRemux = stateClass === "finished" && r.file_exists !== false;
  const canDelete = r.file_exists !== false || stateClass !== "recording";
  const menuItems = [
    canRerecord ? `<button class="rec-row-menu-item" type="button" data-action="rec-rerecord" data-job-id="${r.id}">↺ Re-record</button>` : "",
    canRemux ? `<button class="rec-row-menu-item" type="button" data-action="rec-remux" data-job-id="${r.id}" title="Remux for browser playback">⇄ Remux</button>` : "",
    canDelete ? `<button class="rec-row-menu-item danger" type="button" data-action="rec-delete" data-job-id="${r.id}" title="Delete (Del)">✕ Delete</button>` : "",
  ].join("");
  const rowMenu = menuItems
    ? `<div class="rec-row-menu">
         <button class="sm rec-row-menu-toggle" type="button" data-action="rec-menu-toggle" aria-haspopup="true" aria-expanded="false" title="More actions">⋯</button>
         <div class="rec-row-menu-list" hidden role="menu">${menuItems}</div>
       </div>`
    : "";
  const infoBtn = `<button class="sm" data-action="rec-info" data-job-id="${r.id}" title="Recording details (I)">ⓘ Info</button>`;
  const tailBtns = isActive
    ? `<button class="danger sm" data-action="stop" data-job-id="${r.id}">Stop</button>${infoBtn}${rowMenu}`
    : `${infoBtn}${rowMenu}`;
  // File-error remediation: re-scan (re-check file_exists, in case the
  // user remounted a drive or restored from backup) + locate (show the
  // absolute path with a copy gesture). Distinct from Failed which is
  // a process error — file-error means the journal-vs-disk drifted.
  const fileErrorBtns = stateClass === "file-error"
    ? `<button class="sm" data-action="rec-rescan" data-job-id="${r.id}" title="Re-check whether the file exists">↻ Re-scan</button>
       <button class="sm" data-action="rec-locate" data-job-id="${r.id}" data-path="${htmlEscape(r.output_path || "")}" title="Show the expected file path">📂 Show path</button>`
    : "";
  const actions = `${playBtn}${fileErrorBtns}${tailBtns}`;
  return `
    <tr class="${recSelected.has(r.id) ? "rec-sel" : ""}" data-rec-row="${htmlEscape(r.id)}" data-rec-state="${htmlEscape(stateClass)}" data-rec-signature="${htmlEscape(recordingRowSignature(r))}">
      <td class="rec-check"><input type="checkbox" class="rec-row-check" data-job-id="${htmlEscape(r.id)}" ${recSelected.has(r.id) ? "checked" : ""} aria-label="Select recording"></td>
      <td>${renderStatePill(disp)}</td>
      <td>${htmlEscape(r.channel_name)}</td>
      <td><div class="rec-title-cell">${recThumb(r)}<span>${htmlEscape(niceTitle(r.stream_title) || "(no title)")}</span></div></td>
      <td>${new Date(r.started_at).toLocaleString()}</td>
      <td>${formatBytes(r.bytes_written || 0)}</td>
      <td class="rec-actions"><div class="rec-actions-inner">${actions}</div></td>
    </tr>
  `;
}

// VOD pulls and live captures both ride `RecordingState::Recording`, but
// "Recording" reads wrong for a yt-dlp-backed VOD pull. Distinguish by
// `source_url`: when set, label + colour as a download instead. Other
// states (Finished/Failed/etc) read the same regardless.
// File-error remediation: refetch /recordings so the backend re-runs
// augment_recording's file_exists probe on the current row. When the
// flag flips back to true (file restored / drive remounted) the next
// render shows it as plain Finished again.
async function reScanRecording(btn) {
  const id = btn.dataset.jobId;
  await withBusy(btn, "Scanning…", async () => {
    try {
      const r = await API.recordingOne(id);
      if (r && r.file_exists !== false) {
        Toast.success("File found — refreshing");
      } else {
        Toast.error("Still missing — file not present at the recorded path");
      }
      // Whichever way it went, repaint the current route so the badge updates.
      render().catch(() => {});
    } catch (err) {
      Toast.error(`Re-scan failed: ${err.message}`);
    }
  });
}

// Pop a tiny copy-friendly modal showing the recording's intended file
// path. Doesn't try to open a native file manager (the SPA can't reach
// the desktop) — instead lets the user copy the path with one click so
// they can paste it into their own shell / finder.
function showRecordingPath(path) {
  if (!path) {
    Toast.error("No path recorded for this row");
    return;
  }
  const overlay = ensureModalContainer("rec-locate-modal");
  overlay.innerHTML = `
    <div class="modal-card rec-locate-card">
      <header class="rec-locate-head">
        <h2>Recording file path</h2>
        <button class="modal-close" data-action="modal-close" aria-label="Close">✕</button>
      </header>
      <p class="pg-cap-hint">The recording was written here. The SPA can't open your file manager directly — copy the path and open it yourself.</p>
      <div class="rec-locate-row">
        <code class="rec-locate-path">${htmlEscape(path)}</code>
        <button class="primary sm rec-locate-copy">Copy path</button>
      </div>
    </div>`;
  document.body.classList.add("modal-open");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeRecLocate(); });
  overlay.querySelector("[data-action=modal-close]").addEventListener("click", closeRecLocate);
  overlay.querySelector(".rec-locate-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(path);
      Toast.success("Path copied to clipboard");
      closeRecLocate();
    } catch (err) {
      Toast.error(`Copy failed: ${err.message}`);
    }
  });
}
function closeRecLocate() {
  document.getElementById("rec-locate-modal")?.remove();
  document.body.classList.remove("modal-open");
}

function recordingDisplayState(j) {
  const cls = stateClassName(j.state);
  const lbl = stateLabel(j.state);
  // A row whose file is gone overrides every other state — the journal
  // says "Finished" but the recording has no file behind it, so reading
  // that as a green Finished pill misleads.
  if (j && j.file_exists === false) {
    return { label: "File Error", className: "file-error", pct: null };
  }
  if (j && j.source_url && cls === "recording") {
    return { label: "Downloading", className: "downloading", pct: pctForDownload(j) };
  }
  return { label: lbl, className: cls, pct: null };
}

// Project an in-flight VOD pull's percent complete. yt-dlp publishes an
// authoritative `download_pct` whenever the server-side total size is
// known; for HLS / segment-list captures it isn't, so we fall back to a
// projection from the cached VOD's known duration × detected bitrate.
//
// The blend (avg-so-far weighted 0.7, instantaneous 0.3) keeps a brief
// network stall from collapsing the bar mid-download.
function pctForDownload(j) {
  if (!j) return null;
  if (j.download_pct != null && Number.isFinite(j.download_pct)) {
    const raw = Math.max(0, Math.min(100, Number(j.download_pct)));
    // Cap short of 100 unless the job's own state says it's actually
    // done — mirrors the estimate-fallback branch below, which already
    // reserves 100% for the real Finish transition. Without this, a
    // backend-reported 100% mid-stream could paint a "Finished"-looking
    // bar for a job that is still in the Recording/Downloading state.
    const isActuallyFinished = typeof stateClassName === "function" && stateClassName(j.state) === "finished";
    return isActuallyFinished ? raw : Math.min(99, raw);
  }
  const bw = Number(j.bytes_written) || 0;
  const elapsed = Number(j.duration_secs) || 0;
  if (bw < 1 || elapsed < 1) return null;
  const expected = expectedDurationFromVodCache(j);
  if (!expected || expected <= 0) return null;
  const avgBps = bw / elapsed;
  const instBps = Number(j.download_rate_bps) || 0;
  const blendedBps = instBps > 0 ? avgBps * 0.7 + instBps * 0.3 : avgBps;
  const projectedTotal = blendedBps * expected;
  if (projectedTotal <= 0) return null;
  // Cap at 99 — only the Finish event grants 100.
  return Math.max(0, Math.min(99, (bw / projectedTotal) * 100));
}

// Cross-reference the channel-VOD cache to find the expected total
// duration for a recording's source URL. Returns seconds, or null when
// the SPA hasn't visited the source channel's detail page this session
// (no cache entry to consult).
function expectedDurationFromVodCache(j) {
  if (!j || !j.source_url) return null;
  if (typeof channelVods === "undefined" || !channelVods) return null;
  for (const list of Object.values(channelVods)) {
    if (!Array.isArray(list)) continue;
    for (const v of list) {
      if (v && v.url === j.source_url && v.duration_seconds) {
        return Number(v.duration_seconds);
      }
    }
  }
  return null;
}

// Render the state pill, with a progress fill + percentage label when
// `disp.pct` is known. The fill is driven by the `--state-fill` custom
// property so the CSS doesn't need a class per percentage bucket.
function renderStatePill(disp) {
  if (disp.pct == null) {
    return `<span class="state-pill micro ${disp.className}">${htmlEscape(disp.label)}</span>`;
  }
  const pct = disp.pct;
  const rounded = Math.round(pct);
  return `<span class="state-pill micro ${disp.className} has-fill" style="--state-fill:${pct.toFixed(1)}%">
    <span class="state-pill-fill" aria-hidden="true"></span>
    <span class="state-pill-label">${rounded}%</span>
  </span>`;
}

function stateLabel(s) {
  if (typeof s === "string") return s;
  if (s && typeof s === "object") return Object.keys(s)[0];
  return "?";
}
function stateClassName(s) {
  const label = stateLabel(s).toLowerCase();
  if (label.includes("record")) return "recording";
  if (label.includes("finish")) return "finished";
  if (label.includes("fail")) return "failed";
  return "";
}

// ── Gantt strip (W5 — last 24h of recordings as horizontal bars) ──────
function renderGantt(items) {
  if (items.length === 0) return "";
  // Bucket by channel for the vertical axis; horizontal axis is the
  // last 24 hours.
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const start = now - windowMs;
  const byChannel = new Map();
  for (const it of items) {
    const ch = it.channel_name || "(unknown)";
    if (!byChannel.has(ch)) byChannel.set(ch, []);
    byChannel.get(ch).push(it);
  }
  const channels = [...byChannel.keys()];
  if (channels.length === 0) return "";
  const rowH = 22;
  const totalH = channels.length * rowH + 24;
  // SVG width is responsive via 100%; bars use percentage coordinates.
  const bars = channels
    .map((ch, i) => {
      const y = i * rowH + 20;
      const chBars = byChannel
        .get(ch)
        .map((it) => {
          const s = new Date(it.start_at).getTime();
          const e = new Date(it.end_at).getTime();
          const xPct = Math.max(0, ((s - start) / windowMs) * 100);
          const wPct = Math.max(0.3, Math.min(100 - xPct, ((e - s) / windowMs) * 100));
          const stateColor =
            it.state.toLowerCase().includes("record")
              ? "var(--recording)"
              : it.state.toLowerCase().includes("finish")
              ? "var(--live)"
              : it.state.toLowerCase().includes("fail")
              ? "var(--secondary)"
              : "var(--muted)";
          return `<rect x="${xPct}%" y="${y + 3}" width="${wPct}%" height="14"
                     fill="${stateColor}" rx="2"
                     data-title="${htmlEscape(it.stream_title || ch)} · ${formatBytes(it.bytes_written || 0)}"></rect>`;
        })
        .join("");
      return `
        <text x="0" y="${y + 14}" fill="var(--muted)" font-size="11" font-family="ui-monospace, monospace">
          ${htmlEscape(ch.slice(0, 18))}
        </text>
        ${chBars}
      `;
    })
    .join("");
  // Vertical "now" marker at the right edge (100%).
  const nowMarker = `<line x1="100%" x2="100%" y1="20" y2="${totalH - 4}" stroke="var(--primary)" stroke-width="2" stroke-dasharray="2 2"/>`;
  return `
    <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 2rem;">
      <h2 style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: var(--muted);">
        24h timeline · ${items.length} recording${items.length === 1 ? "" : "s"}
      </h2>
      <svg viewBox="0 0 100 ${totalH}" preserveAspectRatio="none"
           style="width: 100%; height: ${totalH}px; padding-left: 120px; box-sizing: border-box;"
           role="img" aria-label="24-hour recording timeline">
        ${bars}
        ${nowMarker}
      </svg>
      <div style="display: flex; justify-content: space-between; color: var(--dim); font-size: 0.75rem; padding-left: 120px;">
        <span>24h ago</span><span>12h</span><span>now</span>
      </div>
    </div>
  `;
}
