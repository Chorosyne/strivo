// StriVo SPA — vanilla JS, hash routing, *arr-inspired chrome. (W4 MVP.)
//
// This is the minimum-viable shippable webui that uses the W1+W2+W3
// backend. SvelteKit conversion is the W4 phase 2 follow-up; this
// file deliberately stays small + dependency-free.

const API = {
  async _fetch(path, opts = {}) {
    const headers = { Accept: "application/json", ...(opts.headers || {}) };
    if (opts.body && typeof opts.body !== "string") {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`/api/v1${path}`, {
      credentials: "same-origin",
      ...opts,
      headers,
    });
    if (res.status === 401) {
      route("login");
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.headers.get("content-type")?.includes("json")
      ? res.json()
      : res.text();
  },
  channels: () => API._fetch("/channels"),
  recordings: () => API._fetch("/recordings"),
  startRecording: (body) =>
    API._fetch("/recordings", { method: "POST", body }),
  stopRecording: (id) =>
    API._fetch(`/recordings/${id}`, { method: "DELETE" }),
  toggleAutoRecord: (channelKey, enabled) =>
    API._fetch(`/channels/${encodeURIComponent(channelKey)}/auto_record`, {
      method: "PUT",
      body: { enabled },
    }),
  pollNow: () => API._fetch("/poll_now", { method: "POST" }),
  health: () => API._fetch("/health"),
  login: (apiKey) =>
    API._fetch("/auth/login", { method: "POST", body: { api_key: apiKey } }),
  logout: () => API._fetch("/auth/logout", { method: "POST" }),
};

// ── SSE event stream ─────────────────────────────────────────────────
const events = {
  source: null,
  listeners: new Set(),
  start() {
    if (this.source) return;
    this.source = new EventSource("/events", { withCredentials: true });
    this.source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this.listeners.forEach((fn) => fn(data));
      } catch (_) {}
    };
    this.source.onerror = () => {
      // Auto-reconnect via the browser; if we're 401-ing the user is
      // probably logged out and a route('login') will reset us.
    };
  },
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

// Activity event ring (most-recent-first, capped at 50).
const activityLog = [];
function pushActivity(event) {
  const kind = Object.keys(event)[0] || "event";
  const summary = summarizeEvent(event);
  activityLog.unshift({
    kind,
    summary,
    at: new Date(),
  });
  if (activityLog.length > 50) activityLog.pop();
  renderActivityRail();
}
function summarizeEvent(event) {
  if (event.ChannelWentLive)
    return `${event.ChannelWentLive.display_name || event.ChannelWentLive.name} went LIVE`;
  if (event.ChannelWentOffline)
    return `${event.ChannelWentOffline.display_name || event.ChannelWentOffline.name} went offline`;
  if (event.RecordingStarted)
    return `Started: ${event.RecordingStarted.job.channel_name}`;
  if (event.RecordingFinished)
    return `Finished: ${event.RecordingFinished.final_state}`;
  if (event.RecordingProgress)
    return `Progress: ${(event.RecordingProgress.bytes_written / 1e6).toFixed(1)} MB`;
  if (event.ScheduleFired)
    return `Schedule fired: ${event.ScheduleFired.channel}`;
  if (event.Notification)
    return `${event.Notification.title}: ${event.Notification.body}`;
  if (event.PlatformAuthenticated)
    return `Authenticated: ${event.PlatformAuthenticated.kind}`;
  if (event.DeviceCodeRequired) return `Device-code prompt`;
  return JSON.stringify(event).slice(0, 80);
}

// ── Hash router ──────────────────────────────────────────────────────
const ROUTES = ["library", "recordings", "schedule", "settings", "system", "login"];

function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "") || "library";
  return ROUTES.includes(hash) ? hash : "library";
}

function route(name) {
  window.location.hash = `#/${name}`;
}

window.addEventListener("hashchange", render);

// ── Render ───────────────────────────────────────────────────────────
const root = document.getElementById("app");

async function render() {
  const r = currentRoute();
  // Probe auth — if /health returns 401-ish, we land on login.
  if (r !== "login") {
    try {
      await API.health();
    } catch (e) {
      // health is unauthenticated; this catch means real network/server
      // issue. Surface and continue.
      console.warn(e);
    }
    // The first real call that hits an auth check will redirect to
    // /login on 401 via the API._fetch path.
  }
  switch (r) {
    case "login":
      renderLogin();
      break;
    case "library":
      await renderLibrary();
      break;
    case "recordings":
      await renderRecordings();
      break;
    case "schedule":
      renderStub("Schedule", "Calendar view — webui parity follow-up.");
      break;
    case "settings":
      renderStub("Settings", "Settings page — webui parity follow-up.");
      break;
    case "system":
      renderStub("System", "Health checks + log files — webui parity follow-up.");
      break;
  }
}

function chrome(content) {
  return `
    <div class="chrome">
      <header class="topbar">
        <span class="brand">StriVo</span>
        <span id="live-pill" class="live-pill" style="display: none"></span>
        <span class="spacer"></span>
        <button id="activity-toggle" title="Activity feed">⌘ Activity</button>
        <button id="poll-now" title="Poke channel monitor">↻ Poll</button>
        <button id="logout" title="Logout">⏻</button>
      </header>
      <nav class="leftrail">
        <a href="#/library" data-route="library">
          <span class="glyph">▣</span> Library
        </a>
        <a href="#/recordings" data-route="recordings">
          <span class="glyph">📁</span> Recordings
        </a>
        <a href="#/schedule" data-route="schedule">
          <span class="glyph">📅</span> Schedule
        </a>
        <a href="#/settings" data-route="settings">
          <span class="glyph">⚙</span> Settings
        </a>
        <a href="#/system" data-route="system">
          <span class="glyph">🛠</span> System
        </a>
      </nav>
      <main class="content" id="content">${content}</main>
      <aside class="activity-rail" id="activity-rail">
        <h3>
          Activity
          <button class="close-btn" id="activity-close">×</button>
        </h3>
        <div id="activity-list"></div>
      </aside>
    </div>
  `;
}

function setupChromeHandlers() {
  const r = currentRoute();
  document.querySelectorAll(".leftrail a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === r);
  });
  document.getElementById("poll-now")?.addEventListener("click", async () => {
    try {
      await API.pollNow();
    } catch (e) {
      console.error(e);
    }
  });
  document.getElementById("logout")?.addEventListener("click", async () => {
    await API.logout().catch(() => {});
    route("login");
  });
  document
    .getElementById("activity-toggle")
    ?.addEventListener("click", () => {
      document.getElementById("activity-rail")?.classList.toggle("open");
      renderActivityRail();
    });
  document.getElementById("activity-close")?.addEventListener("click", () => {
    document.getElementById("activity-rail")?.classList.remove("open");
  });
}

function renderActivityRail() {
  const list = document.getElementById("activity-list");
  if (!list) return;
  list.innerHTML = activityLog
    .map(
      (e) => `
    <div class="activity-event">
      <span class="kind">${escape(e.kind)}</span>
      <span class="timestamp">${e.at.toLocaleTimeString()}</span>
      <div class="summary">${escape(e.summary)}</div>
    </div>
  `,
    )
    .join("");
}

// ── Login ────────────────────────────────────────────────────────────
function renderLogin(errorMsg) {
  root.removeAttribute("aria-busy");
  root.innerHTML = `
    <div class="login-screen">
      <form class="login-card" id="login-form">
        <h1>StriVo</h1>
        <p class="subtitle">Sign in to the web console</p>
        <label for="api-key">API Key</label>
        <input type="password" id="api-key" autocomplete="current-password" autofocus />
        <button type="submit" class="primary">Sign in</button>
        ${errorMsg ? `<div class="error">${escape(errorMsg)}</div>` : ""}
        <div class="hint">
          API key lives in <code>~/.config/strivo/config.toml</code> under
          <code>[web]</code>. <br />
          Or run: <code>strivo config get web.api_key</code>
        </div>
      </form>
    </div>
  `;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = document.getElementById("api-key").value.trim();
    if (!key) return;
    try {
      await API.login(key);
      route("library");
    } catch (err) {
      renderLogin("Invalid API key");
    }
  });
}

// ── Library (channels grid + LIVE NOW strip) ──────────────────────────
async function renderLibrary() {
  let channels = [];
  try {
    const data = await API.channels();
    channels = data.channels || [];
  } catch (e) {
    if (e.message.includes("unauthorized")) return;
    root.innerHTML = chrome(
      `<div class="empty"><div class="glyph">⚠</div>${escape(e.message)}</div>`,
    );
    setupChromeHandlers();
    return;
  }
  root.removeAttribute("aria-busy");

  const live = channels.filter((c) => c.is_live);
  const offline = channels.filter((c) => !c.is_live);
  updateLiveCount(live.length);

  const liveStrip = live.length
    ? `
    <div class="live-now">
      <h2><span class="rec-dot">●</span> LIVE NOW (${live.length})</h2>
      <div class="live-now-grid">
        ${live.map(channelCard).join("")}
      </div>
    </div>
  `
    : "";

  root.innerHTML = chrome(`
    <h1 class="page-title">Library</h1>
    <p class="page-subtitle">${channels.length} channels monitored</p>
    ${liveStrip}
    <div class="channel-grid">
      ${offline.map(channelCard).join("") ||
        '<div class="empty">No offline channels yet</div>'}
    </div>
  `);
  setupChromeHandlers();
  document.querySelectorAll("[data-action=record]").forEach((btn) => {
    btn.addEventListener("click", () => startRecordingFromCard(btn.dataset));
  });
  document.querySelectorAll("[data-action=auto-record]").forEach((btn) => {
    btn.addEventListener("click", () => toggleAutoRecord(btn.dataset));
  });
}

function channelCard(c) {
  const platformClass = c.platform.toLowerCase();
  const liveClass = c.is_live ? "live" : "";
  const channelKey = `${c.platform}:${c.id}`;
  return `
    <div class="channel-card ${liveClass}">
      <div class="row">
        <span class="platform-icon ${platformClass}">${c.platform}</span>
        <span class="name">${escape(c.display_name || c.name)}</span>
        ${c.is_live ? '<span class="status live">LIVE</span>' : '<span class="status">offline</span>'}
      </div>
      ${c.stream_title ? `<div class="stream-title">${escape(c.stream_title)}</div>` : ""}
      <div class="meta">
        ${c.viewer_count ? `<span>${formatCount(c.viewer_count)} viewers</span>` : ""}
        ${c.game_or_category ? `<span>${escape(c.game_or_category)}</span>` : ""}
        ${c.auto_record ? '<span style="color: var(--secondary)">★ auto</span>' : ""}
      </div>
      <div class="actions">
        ${c.is_live ? `
          <button class="primary" data-action="record" data-channel-id="${c.id}"
                  data-channel-name="${escape(c.name)}"
                  data-display-name="${escape(c.display_name || c.name)}"
                  data-platform="${c.platform}"
                  data-stream-title="${escape(c.stream_title || '')}">
            ● Record
          </button>
          <button data-action="record" data-from-start="true"
                  data-channel-id="${c.id}"
                  data-channel-name="${escape(c.name)}"
                  data-display-name="${escape(c.display_name || c.name)}"
                  data-platform="${c.platform}"
                  data-stream-title="${escape(c.stream_title || '')}">
            ● From start
          </button>
        ` : ""}
        <button data-action="auto-record"
                data-channel-key="${channelKey}"
                data-enabled="${!c.auto_record}">
          ${c.auto_record ? "Disable auto" : "Enable auto"}
        </button>
      </div>
    </div>
  `;
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
      transcode: false,
    });
  } catch (e) {
    alert(`Start failed: ${e.message}`);
  }
}

async function toggleAutoRecord(d) {
  try {
    await API.toggleAutoRecord(d.channelKey, d.enabled === "true");
    await render();
  } catch (e) {
    alert(`Auto-record toggle failed: ${e.message}`);
  }
}

// ── Recordings table ─────────────────────────────────────────────────
async function renderRecordings() {
  let recordings = [];
  try {
    const data = await API.recordings();
    recordings = data.recordings || [];
  } catch (e) {
    if (e.message.includes("unauthorized")) return;
    root.innerHTML = chrome(
      `<div class="empty"><div class="glyph">⚠</div>${escape(e.message)}</div>`,
    );
    setupChromeHandlers();
    return;
  }
  root.removeAttribute("aria-busy");
  if (recordings.length === 0) {
    root.innerHTML = chrome(`
      <h1 class="page-title">Recordings</h1>
      <div class="empty">
        <div class="glyph">📁</div>
        No recordings yet. Start one from the Library tab.
      </div>
    `);
    setupChromeHandlers();
    return;
  }
  root.innerHTML = chrome(`
    <h1 class="page-title">Recordings</h1>
    <p class="page-subtitle">${recordings.length} total</p>
    <table class="recordings-table">
      <thead>
        <tr>
          <th>State</th>
          <th>Channel</th>
          <th>Title</th>
          <th>Started</th>
          <th>Size</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${recordings.map(recordingRow).join("")}
      </tbody>
    </table>
  `);
  setupChromeHandlers();
  document.querySelectorAll("[data-action=stop]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await API.stopRecording(btn.dataset.jobId);
        setTimeout(render, 500);
      } catch (e) {
        alert(`Stop failed: ${e.message}`);
      }
    });
  });
}

function recordingRow(r) {
  const state = stateLabel(r.state);
  const stateClass = stateClassName(r.state);
  const isActive = stateClass === "recording";
  return `
    <tr>
      <td><span class="state-pill ${stateClass}">${state}</span></td>
      <td>${escape(r.channel_name)}</td>
      <td>${escape(r.stream_title || "(no title)")}</td>
      <td>${new Date(r.started_at).toLocaleString()}</td>
      <td>${formatBytes(r.bytes_written || 0)}</td>
      <td>
        ${isActive
          ? `<button class="danger" data-action="stop" data-job-id="${r.id}">Stop</button>`
          : ""}
      </td>
    </tr>
  `;
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

// ── Stub routes ──────────────────────────────────────────────────────
function renderStub(title, msg) {
  root.removeAttribute("aria-busy");
  root.innerHTML = chrome(`
    <h1 class="page-title">${escape(title)}</h1>
    <div class="empty">
      <div class="glyph">🚧</div>
      ${escape(msg)}
    </div>
  `);
  setupChromeHandlers();
}

// ── Live-count ticker ────────────────────────────────────────────────
function updateLiveCount(n) {
  const pill = document.getElementById("live-pill");
  if (!pill) return;
  if (n > 0) {
    pill.textContent = `● LIVE NOW: ${n}`;
    pill.style.display = "";
  } else {
    pill.style.display = "none";
  }
}

// ── Utilities ────────────────────────────────────────────────────────
function escape(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function formatCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}
function formatBytes(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + " KB";
  return n + " B";
}

// ── Boot ─────────────────────────────────────────────────────────────
events.on(pushActivity);
events.on((event) => {
  // Cheap re-render gate: refresh the visible page on relevant events.
  if (
    currentRoute() === "library" &&
    (event.ChannelWentLive ||
      event.ChannelWentOffline ||
      event.ChannelsUpdated)
  ) {
    renderLibrary().catch(console.error);
  }
  if (
    currentRoute() === "recordings" &&
    (event.RecordingStarted ||
      event.RecordingFinished ||
      event.RecordingProgress)
  ) {
    renderRecordings().catch(console.error);
  }
});
events.start();
render();
