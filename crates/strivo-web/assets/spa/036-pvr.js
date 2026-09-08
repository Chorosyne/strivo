  // Cron entry delete (still works for power users).
  document.querySelectorAll(".sch-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = parseInt(btn.dataset.i, 10);
      if (!(await confirmDialog("Delete this cron entry?", { danger: true, ok: "Delete" }))) return;
      try {
        await API.scheduleDelete(i);
        Toast.success("Removed");
        renderSchedule();
      } catch (err) {
        Toast.error(`Couldn't delete: ${err.message}`);
      }
    });
  });
  // Silence the unused channel-lookup helper warning when no channels
  // happen to be queried — kept for future quick-add by name.
  void resolveChannelKey;
}

// Legacy cron-form renderer retained for ref but unused — kept as a
// no-op to avoid breaking any externally-cached bookmarks of the old
// shape. Power users still add cron entries via config.toml.
// eslint-disable-next-line no-unused-vars
async function _renderSchedule_legacy_cron_unused() {
  let entries = [];
  try {
    const r = await API.schedule();
    entries = r.schedule || [];
  } catch (_) {}
  root.removeAttribute("aria-busy");

  const dated = entries
    .filter((e) => e.next_fire)
    .map((e) => ({ ...e, when: new Date(e.next_fire) }))
    .sort((a, b) => a.when - b.when);
  const undated = entries.filter((e) => !e.next_fire);

  // Group by day bucket, preserving sorted order.
  const groups = [];
  for (const e of dated) {
    const label = dayBucket(e.when);
    let g = groups.find((x) => x.label === label);
    if (!g) {
      g = { label, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }

  const row = (e) => `
    <div class="task-row">
      <div class="task-info">
        <span class="task-name">${htmlEscape(e.channel || "scheduled")}</span>
        <span class="task-cadence">${htmlEscape(e.cron || "")}${e.duration ? ` · ${htmlEscape(e.duration)}` : ""}</span>
      </div>
      <span class="agenda-time">${e.when ? e.when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
    </div>`;

  const groupsHtml = groups
    .map(
      (g) => `
    <section class="cfg-card">
      <h2 class="cfg-title">${htmlEscape(g.label)}</h2>
      ${g.items.map(row).join("")}
    </section>`,
    )
    .join("");

  const undatedHtml = undated.length
    ? `<section class="cfg-card">
         <h2 class="cfg-title">Unscheduled</h2>
         ${undated.map((e) => `<div class="task-row"><div class="task-info"><span class="task-name">${htmlEscape(e.channel || "")}</span><span class="task-cadence">${htmlEscape(e.cron || "")} · unparsed cron</span></div></div>`).join("")}
       </section>`
    : "";

  const empty = !entries.length
    ? '<div class="empty">No scheduled recordings yet. Add one below.</div>'
    : "";

  const listHtml = entries
    .map(
      (e, i) => `
    <div class="task-row">
      <div class="task-info">
        <span class="task-name">${htmlEscape(e.channel || "scheduled")}</span>
        <span class="task-cadence"><code>${htmlEscape(e.cron || "")}</code>${e.duration ? ` · ${htmlEscape(e.duration)}` : ""}${e.next_fire ? ` · next: ${htmlEscape(new Date(e.next_fire).toLocaleString())}` : ""}</span>
      </div>
      <button class="sm sch-del" data-i="${i}" title="Delete this schedule entry">✕</button>
    </div>`,
    )
    .join("");

  root.innerHTML = chrome(`
    <h1 class="page-title">Schedule</h1>
    <p class="page-subtitle">Upcoming scheduled recordings · ${dated.length} upcoming</p>
    ${empty}
    <section class="cfg-card">
      <h2 class="cfg-title">Add scheduled recording</h2>
      <form id="sch-add" class="sch-form">
        <label class="sch-field">
          <span>Channel</span>
          <input name="channel" type="text" placeholder="Platform:channel_id (e.g. Twitch:12345)" required />
        </label>
        <label class="sch-field">
          <span>Cron <span class="stg-hint" title="5-field cron: minute hour day-of-month month day-of-week. Example: 0 9 * * 1-5 = 9am weekdays.">ⓘ</span></span>
          <input name="cron" type="text" placeholder="0 9 * * 1-5" required />
        </label>
        <label class="sch-field">
          <span>Duration</span>
          <input name="duration" type="text" placeholder="4h" />
        </label>
        <button class="btn-primary" type="submit">Add</button>
      </form>
    </section>
    <div class="cfg-grid">${groupsHtml}${undatedHtml}</div>
    ${entries.length ? `<section class="cfg-card"><h2 class="cfg-title">All schedule entries</h2>${listHtml}</section>` : ""}
  `);
  setupChromeHandlers();
  document.getElementById("sch-add")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await API.scheduleAdd({
        channel: fd.get("channel"),
        cron: fd.get("cron"),
        duration: fd.get("duration"),
      });
      Toast.success("Schedule entry added");
      renderSchedule();
    } catch (err) {
      Toast.error(`Add failed: ${err.message}`);
    }
  });
  document.querySelectorAll(".sch-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = parseInt(btn.dataset.i, 10);
      if (!(await confirmDialog("Delete this schedule entry?", { danger: true, ok: "Delete" }))) return;
      try {
        await API.scheduleDelete(i);
        Toast.success("Schedule entry removed");
        renderSchedule();
      } catch (err) {
        Toast.error(`Delete failed: ${err.message}`);
      }
    });
  });
}

// ── Durable History (item 17) — completed/failed audit from the jobs DB,
// survives restarts (unlike the in-memory /recordings snapshot). ──
// History page filter / group state — persisted like the Recordings ones.
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

async function renderHistory() {
  // Fetch history alongside the live /recordings snapshot so we can
  // overlay file_exists state (audit B4). Without this, History happily
  // reports 'Finished, 9 GB' for files the Recordings page knows are
  // long gone.
  let [hist, recs] = [[], []];
  try {
    const [h, r] = await Promise.all([
      API.history().catch(() => ({ history: [] })),
      API.recordings().catch(() => ({ recordings: [] })),
    ]);
    hist = h.history || [];
    histNextCursor = h.next_cursor ?? null;
    histTotal = h.total ?? hist.length;
    recs = r.recordings || [];
  } catch (_) {}
  const liveById = new Map(recs.map((r) => [r.id, r]));
  histCache = hist.map((row) => {
    const live = liveById.get(row.id);
    if (live && live.file_exists === false) {
      return { ...row, file_exists: false, state: "Failed" };
    }
    return row;
  });
  root.removeAttribute("aria-busy");

  if (histCache.length === 0) {
    root.innerHTML = chrome(`
      <h1 class="page-title">History</h1>
      <div class="empty">
        <div class="glyph">🗂</div>
        No recording history yet. Captures land here automatically.
      </div>
    `);
    setupChromeHandlers();
    return;
  }

  root.innerHTML = chrome(`
    <h1 class="page-title">History</h1>
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
  `);
  setupChromeHandlers();
  paintHistHeatmap();
  paintHistChips();
  paintHistory();
  document.getElementById("hist-clear-day")?.addEventListener("click", () => {
    histDay = "";
    renderHistory().catch((e) => Toast.error(e.message));
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
    renderHistory().catch((e) => Toast.error(e.message));
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

function paintHistChips() {
  const host = document.getElementById("hist-state-chips");
  if (!host) return;
  const counts = new Map();
  for (const r of histCache) {
    const key = stateClassName(r.state);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size <= 1) { host.innerHTML = ""; return; }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const allActive = histStateFilter.size === 0;
  host.innerHTML = `
    <button class="rec-state-chip rec-state-chip-all ${allActive ? "active" : ""}" type="button">
      <span class="rec-state-chip-dot"></span>All <span class="rec-state-chip-count">${histCache.length}</span>
    </button>
    ${sorted.map(([state, n]) => {
      const active = histStateFilter.size === 0 || histStateFilter.has(state);
      return `<button class="rec-state-chip state-${htmlEscape(state)} ${active ? "active" : ""}"
                data-state="${htmlEscape(state)}" type="button">
        <span class="rec-state-chip-dot"></span>
        ${htmlEscape(stateChipLabel(state))}
        <span class="rec-state-chip-count">${n}</span>
      </button>`;
    }).join("")}`;
  host.querySelector(".rec-state-chip-all")?.addEventListener("click", () => {
    histStateFilter.clear();
    localStorage.setItem("strivo-hist-state-filter", "");
    paintHistChips();
    paintHistory();
  });
  host.querySelectorAll("[data-state]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = btn.dataset.state;
      if (histStateFilter.size === 0) histStateFilter = new Set([s]);
      else if (histStateFilter.has(s)) histStateFilter.delete(s);
      else histStateFilter.add(s);
      localStorage.setItem("strivo-hist-state-filter",
        Array.from(histStateFilter).join(","));
      paintHistChips();
      paintHistory();
    });
  });
}

// GitHub-style calendar heatmap above the history list: last 12 weeks
// of recording activity. Each day cell is colour-scaled by the
// recording count that day. Click a cell to set histDay and filter.
function paintHistHeatmap() {
  const host = document.getElementById("hist-heatmap");
  if (!host) return;
  const counts = new Map();
  for (const r of histCache) {
    const d = (r.started_at || "").slice(0, 10);
    if (!d) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  // Build a 12-week × 7-day grid ending today. Empty days render as
  // the lowest-tier colour so the grid stays visually anchored.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 7 * 12 + 1);
  const max = Math.max(1, ...counts.values());
  const cells = [];
  for (let i = 0; i < 7 * 12; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const c = counts.get(iso) || 0;
    const tier = c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4));
    cells.push({ iso, count: c, tier });
  }
  // Arrange column-major so each column is a week.
  const weeks = [];
  for (let w = 0; w < 12; w++) {
    weeks.push(cells.slice(w * 7, w * 7 + 7));
  }
  host.innerHTML = `
    <div class="hist-hm-wrap" title="Last 12 weeks of recording activity. Click a day to filter.">
      <div class="hist-hm-grid">
        ${weeks.map((col) => `<div class="hist-hm-col">${col.map((cell) => `
          <button class="hist-hm-cell hist-hm-t${cell.tier} ${histDay === cell.iso ? "active" : ""}"
                  data-day="${cell.iso}" type="button"
                  title="${cell.iso} · ${cell.count} recording${cell.count === 1 ? "" : "s"}"></button>`).join("")}</div>`).join("")}
      </div>
      <div class="hist-hm-legend">
        <span>less</span>
        ${[0,1,2,3,4].map((t) => `<span class="hist-hm-cell hist-hm-t${t}"></span>`).join("")}
        <span>more</span>
      </div>
    </div>`;
  host.querySelectorAll(".hist-hm-cell[data-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.day;
      histDay = histDay === day ? "" : day;
      renderHistory().catch((e) => Toast.error(e.message));
    });
  });
}

function paintHistory() {
  const host = document.getElementById("hist-list");
  if (!host) return;
  const q = histFilter.trim().toLowerCase();
  const rows = histCache.filter((r) => {
    if (histStateFilter.size > 0 && !histStateFilter.has(stateClassName(r.state))) return false;
    if (histDay) {
      const d = (r.started_at || "").slice(0, 10);
      if (d !== histDay) return false;
    }
    if (!q) return true;
    return (r.channel_name || "").toLowerCase().includes(q)
        || niceTitle(r.stream_title).toLowerCase().includes(q);
  });
  // Newest-first inside each cluster + as the default flat order.
  rows.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const visibleRows = rows.slice(0, histRenderLimit);
  const countEl = document.getElementById("hist-count");
  if (countEl) {
    countEl.textContent = (q || histStateFilter.size > 0 || rows.length !== histCache.length)
      ? `${rows.length} matching · ${histCache.length} of ${histTotal} loaded`
      : `${histCache.length} of ${histTotal} entries loaded · durable across restarts`;
  }

  if (rows.length === 0) {
    host.innerHTML = `<div class="empty"><div class="glyph">🗂</div>No history rows match the current filter.</div>`;
    return;
  }
  let html;
  if (histGroupBy === "channel") {
    const order = [];
    const groups = new Map();
    for (const r of visibleRows) {
      const k = r.channel_name || "(unknown)";
      if (!groups.has(k)) { groups.set(k, []); order.push(k); }
      groups.get(k).push(r);
    }
    html = order.map((ch) => {
      const list = groups.get(ch);
      const totalBytes = list.reduce((a, b) => a + (b.bytes_written || 0), 0);
      return `<div class="hist-group">
        <div class="hist-group-head">
          <span class="rec-group-name">${htmlEscape(ch)}</span>
          <span class="rec-group-meta">${list.length} entr${list.length === 1 ? "y" : "ies"} · ${formatBytes(totalBytes)}</span>
        </div>
        ${list.map(historyPillHtml).join("")}
      </div>`;
    }).join("");
  } else if (histGroupBy === "date") {
    const order = [];
    const groups = new Map();
    for (const r of visibleRows) {
      const d = new Date(r.started_at);
      const k = isNaN(d.getTime()) ? "(unknown)"
        : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      if (!groups.has(k)) { groups.set(k, []); order.push(k); }
      groups.get(k).push(r);
    }
    html = order.map((mo) => {
      const list = groups.get(mo);
      const totalBytes = list.reduce((a, b) => a + (b.bytes_written || 0), 0);
      const niceMonth = mo === "(unknown)" ? mo
        : new Date(mo + "-01").toLocaleString(undefined, { year: "numeric", month: "long" });
      return `<div class="hist-group">
        <div class="hist-group-head">
          <span class="rec-group-name">${htmlEscape(niceMonth)}</span>
          <span class="rec-group-meta">${list.length} entr${list.length === 1 ? "y" : "ies"} · ${formatBytes(totalBytes)}</span>
        </div>
        ${list.map(historyPillHtml).join("")}
      </div>`;
    }).join("");
  } else {
    html = visibleRows.map(historyPillHtml).join("");
  }
  if (visibleRows.length < rows.length) {
    html += `<button id="hist-show-more" class="button secondary" type="button">
      Show ${Math.min(200, rows.length - visibleRows.length)} more
    </button>`;
  }
  host.innerHTML = html;
  host.querySelector("#hist-show-more")?.addEventListener("click", () => {
    histRenderLimit += 200;
    paintHistory();
  });

  // Wire per-row buttons. Reuses the same handlers Recordings table
  // mounts so behaviours stay consistent.
  host.querySelectorAll("[data-action=rec-play]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.jobId;
      if (id) window.location.hash = `#/watch?recording=${encodeURIComponent(id)}&fresh=1`;
    });
  });
  host.querySelectorAll("[data-action=rec-info]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openRecordingInfo(btn.dataset.jobId);
    });
  });
  host.querySelectorAll("[data-action=rec-rescan]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); reScanRecording(btn); });
  });
  host.querySelectorAll("[data-action=rec-locate]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); showRecordingPath(btn.dataset.path); });
  });
  host.querySelectorAll("[data-action=rec-delete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog("Delete this recording? The file moves to the 7-day trash.", { ok: "Delete", danger: true })))
        return;
      await withBusy(btn, "Deleting…", async () => {
        await API.deleteRecordingFile(btn.dataset.jobId);
        Toast.success("Deleted");
        histCache = histCache.filter((r) => r.id !== btn.dataset.jobId);
        renderHistory().catch(() => {});
      }).catch((err) => Toast.error(`Delete failed: ${err.message}`));
    });
  });
  // Clicking anywhere on the pill (outside buttons) opens the Info
  // modal — same convention as the Recordings table.
  host.querySelectorAll(".media-pill").forEach((pill) => {
    pill.addEventListener("click", (e) => {
      if (e.target.closest("button, input, a")) return;
      const id = pill.dataset.jobId;
      if (id) openRecordingInfo(id);
    });
  });
}

// Action-rich pill used on the History page. Mirrors recordingPillHtml's
// layout but adds the Recordings-page Play/Info/Delete affordance set.
function historyPillHtml(j) {
  const when = j.started_at ? new Date(j.started_at).toLocaleString() : "—";
  const missingOverlay = j.file_exists === false
    ? '<span class="mp-missing">FILE MISSING</span>' : "";
  const sourceBadge = j.source_url
    ? '<span class="mp-source" title="From Twitch/YouTube VOD backfill">VOD</span>' : "";
  const isFinished = stateClassName(j.state) === "finished" && j.file_exists !== false;
  const isFileError = j.file_exists === false;
  const playBtn = isFinished
    ? `<button class="primary sm" data-action="rec-play" data-job-id="${htmlEscape(j.id)}" title="Open player">▶ Play</button>`
    : `<button class="primary sm rec-play-disabled" disabled aria-disabled="true" title="${isFileError ? "File missing" : "Not finished"}">▶ Play</button>`;
  const fileErrorBtns = isFileError
    ? `<button class="sm" data-action="rec-rescan" data-job-id="${htmlEscape(j.id)}" title="Re-check whether the file exists">↻ Re-scan</button>
       <button class="sm" data-action="rec-locate" data-job-id="${htmlEscape(j.id)}" data-path="${htmlEscape(j.output_path || "")}" title="Show the expected file path">📂 Show path</button>`
    : "";
  return `
    <div class="media-pill hist-pill${j.file_exists === false ? " mp-broken" : ""}"
         data-job-id="${htmlEscape(j.id)}">
      <div class="mp-thumb">${missingOverlay}<img class="mp-thumb-img" loading="lazy" alt=""
        src="/api/v1/recordings/${encodeURIComponent(j.id)}/thumb" onerror="this.remove()"></div>
      <div class="mp-info">
        <div class="mp-title">${htmlEscape(niceTitle(j.stream_title) || j.channel_name || "(recording)")} ${sourceBadge}</div>
        <div class="mp-sub">${htmlEscape(j.channel_name || "")} · ${htmlEscape(when)}</div>
      </div>
      <div class="mp-meta">
        ${renderStatePill(recordingDisplayState(j))}
        <span class="mp-size">${formatBytes(j.bytes_written || 0)}</span>
      </div>
      <div class="hist-actions">
        ${playBtn}
        ${fileErrorBtns}
        <button class="sm" data-action="rec-info" data-job-id="${htmlEscape(j.id)}" title="Recording details">ⓘ Info</button>
        <button class="danger sm" data-action="rec-delete" data-job-id="${htmlEscape(j.id)}" title="Delete (moves file to 7-day trash)">✕</button>
      </div>
    </div>`;
}

// ── 7-day calendar strip (Task 1) ────────────────────────────────────
// Derives a stable hue [0,360) from a channel name by DJB2-style hash.
function channelHue(name) {
  let h = 5381;
  for (let i = 0; i < (name || "").length; i++)
    h = ((h << 5) + h + (name || "").charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// Build a compact 7-day strip of upcoming cron schedule firings.
// `entries` is the /schedule array with next_fire timestamps.
// Returns an HTML string (empty string when there are no upcoming firings).
function buildCalStrip(entries) {
  const upcoming = (entries || []).filter((e) => e.next_fire);
  if (!upcoming.length) return "";
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, d) => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const label =
      d === 0 ? "Today" :
      d === 1 ? "Tomorrow" :
      start.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
    return { start, end, label, firings: [] };
  });
  for (const e of upcoming) {
    const t = new Date(e.next_fire);
    const day = days.find((d) => t >= d.start && t < d.end);
    if (day) day.firings.push(e);
  }
  const dayHtml = days.map(({ label, firings, start }) => {
    const isToday = start.toDateString() === now.toDateString();
    const blocks = firings.map((e) => {
      const hue = channelHue(e.channel || "");
      const time = new Date(e.next_fire).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const tip = `${e.channel || ""}  ·  ${time}${e.duration ? "  ·  " + e.duration : ""}`;
      return `<a class="cal-block" href="#/schedule"
                 style="background:hsl(${hue},45%,32%);border-color:hsl(${hue},50%,48%)"
                 title="${htmlEscape(tip)}">${htmlEscape((e.channel || "").slice(0, 12))}</a>`;
    }).join("");
    return `<div class="cal-day${isToday ? " cal-today" : ""}">
      <div class="cal-day-label">${htmlEscape(label)}</div>
      <div class="cal-day-blocks">${blocks || '<span class="cal-no-fire">—</span>'}</div>
    </div>`;
  }).join("");
  return `<section class="cfg-card cal-section">
    <h2 class="cfg-title">Upcoming cron schedule <span class="cal-subtitle">(next 7 days)</span></h2>
    <div class="cal-strip">${dayHtml}</div>
  </section>`;
}

// ── Live-count ticker + concurrent-slot indicator ────────────────────
// Both pills sit in the topbar. The slot pill shows "N / M rec" where N
// is in-progress count and M is monitor_limits.max_concurrent_recordings.
// maxConcurrentSlots is populated by setupChromeHandlers from /settings.
/// Is this job a VOD/post download rather than a live capture? Downloads
/// carry the source they were pulled from; live captures have none.
function isDownloadJob(r) {
  return !!(r && r.source_url);
}

/// Refresh the top-bar activity pills from the recording cache.
///
/// Takes no argument on purpose: five call sites each recomputed the same
/// `recCache.filter(isInProgress).length`, and passing that single number
/// is what made a Patreon post download announce itself as "● LIVE". A
/// download occupies a capture slot — so it belongs in the slot pill — but
/// nothing about it is live.
// `#live-pill` (captures in progress) and `#rec-slot-pill` (slots used /
// cap) used to be two topbar pills reporting the same underlying fact —
// how many recordings are in flight. Merged into one "● REC n/max" pill
// (still `#rec-slot-pill`; its click → Monitor handler is unchanged).
function updateLiveCount() {
  const inProgress = (recCache || []).filter((r) => isInProgress(r.state));
  const downloads = inProgress.filter(isDownloadJob).length;
  const captures = inProgress.length - downloads;
  const n = inProgress.length; // slots consumed: the daemon caps on all of them

  const slotPill = document.getElementById("rec-slot-pill");
  if (!slotPill) return;
  if (n === 0) {
    slotPill.style.display = "none";
    return;
  }
  slotPill.style.display = "";
  slotPill.textContent = maxConcurrentSlots > 0
    ? `● REC ${n}/${maxConcurrentSlots}`
    : `● REC ${n}`;
  const saturated = maxConcurrentSlots > 0 && n >= maxConcurrentSlots;
  slotPill.className = `storage-pill ${saturated ? "storage-pill-warn" : "storage-pill-rec"}`;
  const activity = captures > 0 && downloads > 0
    ? `${captures} live capture${captures === 1 ? "" : "s"} + ${downloads} download${downloads === 1 ? "" : "s"}`
    : captures > 0
    ? `${captures} live capture${captures === 1 ? "" : "s"} in progress`
    : `${downloads} download${downloads === 1 ? "" : "s"} in progress`;
  slotPill.title = saturated
    ? `⚠ Concurrent cap hit: ${n}/${maxConcurrentSlots} (${activity}) — click to adjust`
    : maxConcurrentSlots > 0
    ? `${activity} — ${n} of ${maxConcurrentSlots} capture slots in use — click to manage`
    : `${activity} — click to manage`;
}

// ── Utilities ────────────────────────────────────────────────────────
function htmlEscape(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// md_to_html — tiny subset of markdown for Casebook section bodies.
// Handles **bold**, `code`, leading-dash unordered lists, and newlines.
// Not a full markdown parser — Casebook only emits a tight subset.
function md_to_html(text) {
  if (!text) return "";
  const escaped = htmlEscape(text);
  // Lists first: turn lines starting with "- " into <ul><li>.
  const lines = escaped.split("\n");
  const out = [];
  let inUl = false;
  for (const raw of lines) {
    if (raw.startsWith("- ")) {
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${raw.slice(2)}</li>`);
    } else {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      out.push(raw + "<br/>");
    }
  }
  if (inUl) out.push("</ul>");
  return out
    .join("")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

// niceTitle — strip filename-derived noise from a recording title so the
// UI shows the semantic title only. The on-disk filename is untouched.
//
// Strips:
//   - leading HHMMSS_ timestamp prefix from ffmpeg filename templates
//   - trailing API/source decorations like "_Video_", "[Video]", "_AUDIO_"
//   - underscores standing in for spaces (filesystem-safe substitution)
//   - editorial appendations Patreon/YouTube auto-tag (BONUS Video, etc.)
//   - bracketed/parens descriptors that are non-semantic
// Then collapses double-spaces and trims.
const TITLE_TRAILING_TAGS = [
  // Order matters: most specific (multi-word) first.
  "BONUS Video", "BONUS Audio", "BONUS [Video]", "BONUS [Audio]",
  "Full Episode", "Patreon Exclusive", "Patreon Only", "Members Only",
  "BONUS", "FREE", "EXCLUSIVE", "VOD",
  "_Video_", "[Video]", "_VIDEO_", "[VIDEO]",
  "_Audio_", "[Audio]", "_AUDIO_", "[AUDIO]",
];
function niceTitle(t) {
  if (t == null) return "";
  let s = String(t);
  // 4-6 digit timestamp prefix produced by {date}/{time} in the template.
  s = s.replace(/^\d{4,6}_+/, "");
  // Underscore → space (filename-safe substitution).
  s = s.replace(/_+/g, " ");
  // Strip each known trailing tag, repeatedly, with surrounding punctuation.
  for (let i = 0; i < 4; i++) {
    let before = s;
    for (const tag of TITLE_TRAILING_TAGS) {
      const re = new RegExp(
        "[\\s\\-\\u2013\\u2014:,\\(\\[]*" +
          tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          "[\\s\\)\\]]*$",
        "i",
      );
      s = s.replace(re, "");
    }
    if (s === before) break;
  }
  // Collapse double-spaces; tidy stray punctuation tails like " - " " — ".
  s = s.replace(/\s+/g, " ")
       .replace(/[\s\-–—:,]+$/g, "")
       .trim();
  return s;
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
// Compact relative age for the rail "last live" slot. Progression:
//   <1h  → "Xm ago"   (sub-hour, kept for usability on a freshly-offline row)
//   <1d  → "Xh ago"
//   <1mo → "Xd ago"
//   <1y  → "Xm ago"   or "Xm Yd ago" when there's a calendar-day remainder
//   ≥1y  → "Xy ago"   or "Xy Ym ago" when there's a calendar-month remainder
// Months and years are calendar-aware so leap years and short months don't lie.
function relTime(iso) {
  const past = new Date(iso);
  const t = past.getTime();
  if (!t) return "";
  const now = new Date();
  const secs = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;

  // Calendar diff (UTC) — match by year / month / day fields so DST and
  // leap years don't shift the answer by a day.
  let years = now.getUTCFullYear() - past.getUTCFullYear();
  let months = now.getUTCMonth() - past.getUTCMonth();
  let days = now.getUTCDate() - past.getUTCDate();
  if (days < 0) {
    months -= 1;
    // Borrow days from the previous calendar month.
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    days += prev.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years >= 1) return months > 0 ? `${years}y ${months}m ago` : `${years}y ago`;
  if (months >= 1) return days > 0 ? `${months}m ${days}d ago` : `${months}m ago`;
  return `${days}d ago`;
}

// Tooltip companion — absolute local timestamp, since the rail label already
// carries the relative form.
function lastLiveLong(iso) {
  const d = new Date(iso);
  if (!d.getTime()) return "unknown";
  return d.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── W6 keyboard shortcuts ────────────────────────────────────────────
// Linear-/GitHub-style: prefix `g` then route letter to jump (gl/gr/gs
// etc.), `?` to open the help overlay, `Esc` to close, `a` to toggle
// the activity rail, `p` to trigger Poll.
let prefixActive = false;
let prefixTimer = null;

// Refetch caches when the tab regains focus and the rail looks emptied
// out (e.g. after the daemon socket bounced while the tab was idle). This
// is belt-and-braces alongside the Promise.allSettled fan-out above: the
// SSE reconnect handles the live-update channel, but a one-shot fetch is
// the cheapest way to reconcile a partial-fetch render that's already on
// screen. Cheap — the route render itself is idempotent.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (channelCache.length === 0 || recCache.length === 0) {
    render();
  }
});

document.addEventListener("keydown", (e) => {
  // ⌘K / Ctrl+K — command palette. Handled before the input guard so it
  // works from anywhere, including while a field is focused. (W4-alt.)
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    toggleCommandPalette();
    return;
  }
  // If the palette is open, it owns the keyboard.
  if (document.getElementById("cmdk")?.classList.contains("open")) {
    handleCmdkKey(e);
    return;
  }

  // Don't intercept while the user is typing. Catches:
  //   - native text fields (input / textarea)
  //   - contenteditable widgets (custom rich-text editors, chat compose
  //     boxes, anything with the global isContentEditable flag)
  //   - select dropdowns mid-keyboard-navigation
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (e.target.isContentEditable) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // `/` focuses the recordings filter when on that route.
  if (e.key === "/" && currentRoute() === "recordings") {
    const f = document.getElementById("rec-filter");
    if (f) {
      e.preventDefault();
      f.focus();
      return;
    }
  }

  // Keyboard help: Shift+I (capital I). The earlier `?` binding was
  // collateral-fired by video-element native shortcuts inside the player
  // modal, leaving the help stuck visible behind it.
  if (e.shiftKey && (e.key === "I" || e.key === "i")) {
    e.preventDefault();
    document.getElementById("kbd-help")?.classList.add("open");
    return;
  }
  if (e.key === "Escape") {
    document.getElementById("kbd-help")?.classList.remove("open");
    if (selectedChannelKey) {
      selectedChannelKey = null;
      render();
    }
    return;
  }
  if (e.key === "p") {
    e.preventDefault();
    API.pollNow().catch(() => {});
    return;
  }
  if (e.key === "g" && !prefixActive) {
    prefixActive = true;
    prefixTimer = setTimeout(() => (prefixActive = false), 1000);
    return;
  }
  if (prefixActive) {
    clearTimeout(prefixTimer);
    prefixActive = false;
    const link = document.querySelector(`.topnav a[data-key="${e.key}"]`);
    if (link) {
      e.preventDefault();
      route(link.dataset.route);
    }
  }
});

// ── ⌘K command palette (W4-alt) ───────────────────────────────────────
let cmdkItems = [];
let cmdkSelected = 0;

function commandList() {
  const nav = [
    ["library", "Go to Home"],
    ["recordings", "Go to Recordings"],
    ["schedule", "Go to Schedule"],
    ["pipelines", "Go to Pipelines"],
    ["plugins", "Go to Plugins"],
    ["settings", "Go to Settings"],
    ["system", "Go to System"],
  ]
    // Creator-only nav slots bounce Home if actually run (CREATOR_ROUTES,
    // see 008-pvr.js) — don't offer them as commands in a PVR build.
    .filter(([r]) => CREATOR_ENABLED || !CREATOR_ROUTES.has(r))
    .map(([r, label]) => ({ label, run: () => route(r) }));
  const actions = [
    { label: "Poll channels now", run: () => API.pollNow().catch(() => {}) },
    {
      label: "Stop all recordings",
      run: () => API._fetch("/recordings/stop_all", { method: "POST" }).catch(() => {}),
    },
    { label: "Logout", run: () => API.logout().then(() => route("login")) },
  ];
  // Recordings + channels are fetched once per palette open (see
  // toggleCommandPalette) and cached here so every keystroke filters
  // in-memory rather than re-hitting the API.
  return [...nav, ...actions, ...cmdkDynamicItems];
}

// Recordings/channels quick-jump results, folded in from the deleted
// #cmd-palette (single-palette consolidation). Repopulated once per
// palette open, not per keystroke.
let cmdkDynamicItems = [];
let cmdkDynamicLoaded = false;

async function loadCmdkDynamicItems() {
  const [recs, chans] = await Promise.all([
    API.recordings().then((r) => r.recordings || []).catch(() => []),
    API.channels().then((r) => r.channels || []).catch(() => []),
  ]);
  cmdkDynamicItems = [
    ...recs.map((r) => ({
      label: `${niceTitle(r.stream_title) || "(no title)"} — ${r.channel_name || ""} · recording`,
      run: () => { location.hash = "#/recordings"; },
    })),
    ...chans.map((c) => ({
      label: `${c.display_name || c.name} — ${c.platform} · channel`,
      run: () => {
        location.hash = c.is_live
          ? "#/library"
          : `#/recordings?channel=${encodeURIComponent(c.display_name || c.name)}`;
      },
    })),
  ];
  cmdkDynamicLoaded = true;
}

function toggleCommandPalette() {
  let el = document.getElementById("cmdk");
  if (!el) {
    el = document.createElement("div");
    el.id = "cmdk";
    el.className = "kbd-help";
    el.innerHTML = `
      <div class="card">
        <input id="cmdk-input" class="grid-filter" type="text"
               placeholder="Type a command, recording, or channel…" autocomplete="off" aria-label="Command palette">
        <div id="cmdk-list" class="pl-list"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (ev) => {
      if (ev.target === el) el.classList.remove("open");
    });
    el.querySelector("#cmdk-input").addEventListener("input", paintCmdk);
  }
  const open = el.classList.toggle("open");
  if (open) {
    cmdkSelected = 0;
    const input = el.querySelector("#cmdk-input");
    input.value = "";
    // Repopulate the recordings/channels cache for this open, then
    // paint (twice — once immediately with whatever's cached, again
    // once the fetch resolves).
    cmdkDynamicLoaded = false;
    paintCmdk();
    loadCmdkDynamicItems().then(() => {
      if (el.classList.contains("open")) paintCmdk();
    });
    input.focus();
  }
}

function paintCmdk() {
  const q = (document.getElementById("cmdk-input")?.value || "")
    .trim()
    .toLowerCase();
  const all = commandList();
  cmdkItems = q
    ? all.filter((c) => c.label.toLowerCase().includes(q))
    : all;
  if (cmdkSelected >= cmdkItems.length) cmdkSelected = 0;
  const list = document.getElementById("cmdk-list");
  if (!list) return;
  list.innerHTML = cmdkItems
    .map(
      (c, i) =>
        `<div class="pl-row ${i === cmdkSelected ? "sel" : ""}" data-i="${i}">${htmlEscape(
          c.label,
        )}</div>`,
    )
    .join("");
  list.querySelectorAll(".pl-row").forEach((row) => {
    row.addEventListener("click", () => runCmdk(parseInt(row.dataset.i, 10)));
  });
}

function handleCmdkKey(e) {
  const el = document.getElementById("cmdk");
  if (e.key === "Escape") {
    e.preventDefault();
    el.classList.remove("open");
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    cmdkSelected = Math.min(cmdkSelected + 1, cmdkItems.length - 1);
    paintCmdk();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    cmdkSelected = Math.max(cmdkSelected - 1, 0);
    paintCmdk();
  } else if (e.key === "Enter") {
    e.preventDefault();
    runCmdk(cmdkSelected);
  }
}

function runCmdk(i) {
  const item = cmdkItems[i];
  document.getElementById("cmdk")?.classList.remove("open");
  if (item) item.run();
}

// ── Onboarding tour ───────────────────────────────────────────────────
// LocalStorage keys:
//   strivo-tour-done                → seen the welcome walkthrough
// The per-page hint banner system (#page-hint / PAGE_HINTS / dismissible
// per-route tips) was removed by user decision — the onboarding tour and
// "Replay tour" are the surviving surface. PAGE_HINTS stays declared as an
// empty, unconsumed object: 037-creator.js:6-7 (outside this lane's
// ownership, which covers only its splice anchors at lines 17-25) still
// assigns `PAGE_HINTS.pipelines`/`.plugins` onto it, so removing the
// binding would break the Creator build. Nothing reads from it anymore.
const PAGE_HINTS = {};

// Top-bar slots the tour walks. Order matches the natural left-to-right
// flow; each step pins to the corresponding .topnav-link by data-route.
const TOUR_STEPS = [
  { route: "library",    title: "Library",    body: "Your home. Live channel rail on the left; current captures + recent recordings in the centre." },
  { route: "recordings", title: "Recordings", body: "Every past + active recording in a sortable / filterable / groupable table. Bulk actions on selection." },
  { route: "schedule",   title: "Monitor",    body: "Tell StriVo which channels to auto-record + auto-download. Capture limits + disk-budget circuit breaker live here." },
  { route: "watch",      title: "Player", body: "Single + multi-stream player. Pick a preset (split-screen, split/quadrant, quadrant) or build a custom split layout. Drag channels from the rail into empty tiles; drag tiles to swap." },
  { route: "chat",       title: "Chat",       body: "Twitch IRC client with filter chips, mention highlighting, BTTV global emotes." },
  { route: "settings",   title: "Settings",   body: "All daemon config: Notifications, Platforms, plugin enable/disable, theme, advanced paths." },
];

function tourDone() { return localStorage.getItem("strivo-tour-done") === "1"; }
function markTourDone() { localStorage.setItem("strivo-tour-done", "1"); }

function startOnboardingTour() {
  if (tourDone()) return;
  let idx = 0;
  const overlay = document.createElement("div");
  overlay.id = "tour-overlay";
  overlay.className = "tour-overlay";
  document.body.appendChild(overlay);

  const paint = () => {
    const step = TOUR_STEPS[idx];
    const target = document.querySelector(`.topnav-link[data-route="${step.route}"]`);
    const rect = target?.getBoundingClientRect();
    const cardLeft = rect ? Math.max(12, Math.min(window.innerWidth - 380, rect.left + rect.width / 2 - 180)) : 24;
    const cardTop = rect ? rect.bottom + 12 : 80;
    overlay.innerHTML = `
      <div class="tour-spotlight" style="${rect ? `left:${rect.left - 6}px;top:${rect.top - 6}px;width:${rect.width + 12}px;height:${rect.height + 12}px;` : "display:none"}"></div>
      <div class="tour-card" style="left:${cardLeft}px;top:${cardTop}px;">
        <div class="tour-step-meta">Step ${idx + 1} of ${TOUR_STEPS.length}</div>
        <h3 class="tour-title">${htmlEscape(step.title)}</h3>
        <p class="tour-body">${htmlEscape(step.body)}</p>
        <div class="tour-actions">
          <button class="sm tour-skip" type="button">Skip tour</button>
          <span class="spacer"></span>
          ${idx > 0 ? `<button class="sm tour-prev" type="button">← Back</button>` : ""}
          <button class="primary sm tour-next" type="button">
            ${idx === TOUR_STEPS.length - 1 ? "Finish" : "Next →"}
          </button>
        </div>
      </div>`;
    overlay.querySelector(".tour-skip").addEventListener("click", finish);
    overlay.querySelector(".tour-prev")?.addEventListener("click", () => { idx = Math.max(0, idx - 1); paint(); });
    overlay.querySelector(".tour-next").addEventListener("click", () => {
      if (idx >= TOUR_STEPS.length - 1) { finish(); return; }
      idx += 1;
      paint();
    });
  };
  const finish = () => {
    markTourDone();
    overlay.remove();
  };
  paint();
}

// Keyboard-shortcuts help overlay rows (Shift+I). Creator-only nav slots
// (Pipelines, Plugins, Archive) are pushed in by 037-creator.js — this list
// must not carry their labels as bytes in a PVR build even though the
// underlying "g d"/"g g"/"g v" bindings just bounce Home there already.
const KBD_HELP_ROWS = [
  ["Shift+I", "This help"],
  ["⌘K", "Command palette"],
  ["/", "Filter recordings"],
  ["g l", "Library"],
  ["g r", "Recordings"],
  ["g s", "Schedule"],
  ["g w", "Player"],
  ["g t", "Chat"],
  ["g o", "Logs"],
  ["g c", "Settings"],
  ["g y", "System"],
  ["p", "Poke channel monitor"],
  ["Esc", "Close overlay"],
];

// Player-tile keys, shown as their own section in the help overlay —
// documents the shortcuts the player module (018/019a-pvr.js) actually
// ships, which weren't listed anywhere before.
const KBD_HELP_PLAYER_ROWS = [
  ["Space / k", "Play / pause"],
  ["j / l", "Seek ±10s"],
  ["← / →", "Seek ±5s"],
  ["↑ / ↓", "Volume"],
  ["m", "Mute"],
  ["s", "Solo tile"],
  ["f", "Fullscreen"],
  ["p", "Picture-in-picture"],
  ["x", "Remove tile"],
  ["Shift+Arrows", "Swap tiles"],
  ["Alt+Arrows", "Move focus"],
  ["Enter", "Play"],
];

function injectKeyboardHelp() {
  if (document.getElementById("kbd-help")) return;
  const div = document.createElement("div");
  div.id = "kbd-help";
  div.className = "kbd-help";
  div.setAttribute("role", "dialog");
  div.setAttribute("aria-label", "Keyboard shortcuts");
  // Multiple dismiss paths: click backdrop, click X, ESC anywhere.
  // The legacy version listened only for ESC; the user reported the
  // overlay was undismissable when stacked behind a modal (the modal
  // ate the ESC). Now ANY click on the backdrop closes it, the X
  // button is always visible, and a delegated capture-phase ESC
  // handler dismisses it before any modal can swallow the event.
  const close = () => div.classList.remove("open");
  div.addEventListener("click", (e) => { if (e.target === div) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && div.classList.contains("open")) { close(); }
  }, true); // capture so we run before any modal handler
  div.innerHTML = `
    <div class="card">
      <button class="kbd-help-close sm" type="button" aria-label="Close help">✕</button>
      <h2>Keyboard shortcuts</h2>
      <dl>
        ${KBD_HELP_ROWS.map(([k, v]) => `<dt>${htmlEscape(k)}</dt><dd>${htmlEscape(v)}</dd>`).join("")}
      </dl>
      <h2>Player</h2>
      <dl>
        ${KBD_HELP_PLAYER_ROWS.map(([k, v]) => `<dt>${htmlEscape(k)}</dt><dd>${htmlEscape(v)}</dd>`).join("")}
      </dl>
    </div>
  `;
  div.querySelector(".kbd-help-close")?.addEventListener("click", close);
  document.body.appendChild(div);
}

// ── Boot ─────────────────────────────────────────────────────────────

// rAF-coalesced paint scheduler — collapses N paint requests within one
// animation frame into a single execution. Used by the SSE
// RecordingProgress handler so a busy session with multiple downloads
// in flight doesn't full-repaint the recordings grid 4×/tick.
let _pendingPaint = null;
function schedulePaint(fn) {
  if (_pendingPaint) {
    _pendingPaint = fn; // overwrite — latest paint wins, prior coalesced.
    return;
  }
  _pendingPaint = fn;
  requestAnimationFrame(() => {
    const f = _pendingPaint;
    _pendingPaint = null;
    if (f) try { f(); } catch (_) {}
  });
}

// A19: debounce paintChannelList — multiple SSE events in the same
// tick should coalesce to one repaint. Without this, ChannelsUpdated
// followed instantly by ChannelWentLive caused two rail repaints +
// brief flicker. rAF-coalesced like schedulePaint.
let _railPaintQueued = false;
function paintChannelListSoon() {
  if (_railPaintQueued) return;
  _railPaintQueued = true;
  requestAnimationFrame(() => {
    _railPaintQueued = false;
    try { paintChannelList(); } catch (_) {}
  });
}

events.on((event) => {
  // A18: every cache read in this handler is now guarded so an event
  // arriving before renderHome hydrates the caches can't crash the
  // page. Each branch checks the relevant array exists + is populated
  // before mutating; ChannelsUpdated is special-cased because it
  // SOURCES the cache.
  const onHome = currentRoute() === "library";

  if (event.ChannelsUpdated) {
    channelCache = event.ChannelsUpdated || [];
    paintChannelListSoon();
  }
  if (event.ChannelWentLive || event.ChannelWentOffline) {
    // Refetch so the new live state (and ordering) is reflected.
    API.channels()
      .then((d) => {
        channelCache = d.channels || [];
        paintChannelListSoon();
      })
      .catch(() => {});
  }

  // High-frequency progress: update the in-memory job + the dashboard
  // subtree in place. No rail/detail rebuild.
  if (event.RecordingProgress && recCache.length) {
    const p = event.RecordingProgress;
    const j = recCache.find((r) => r.id === p.job_id);
    if (j) {
      j.bytes_written = p.bytes_written;
      j.duration_secs = p.duration_secs;
      // VOD downloads carry yt-dlp progress; stash on the cached job so
      // a re-render of the channel detail picks the latest values.
      if (p.download_pct != null) j.download_pct = p.download_pct;
      if (p.download_eta_secs != null) j.download_eta_secs = p.download_eta_secs;
      if (p.download_rate_bps != null) j.download_rate_bps = p.download_rate_bps;
      // Surgical DOM update for the matching VOD pill (avoids repainting
      // the whole channel detail every 2s).
      updateVodProgressDom(j);
    }
    updateLiveCount();
    // Coalesce broader-subtree repaints to one per animation frame.
    // The SSE stream fires RecordingProgress every ~2s per active job;
    // without coalescing, an N-recording session would full-repaint N×
    // per tick. updateVodProgressDom already did the surgical pill
    // update, so this is purely for the wider grid/dashboard refresh.
    schedulePaint(() => {
      if (currentRoute() === "recordings") paintRecordings();
      else paintDashboard();
    });
  }

  // Lifecycle state changes (rare): refetch recordings, refresh the
  // dashboard + rail rec-dots, without rebuilding the detail.
  if (event.RecordingStarted || event.RecordingFinished || event.AllRecordingsStopped) {
    API.recordings()
      .then((d) => {
        recCache = d.recordings || [];
        dashRecordings = recCache;
        seedVodDownloadStateFromRecCache();
        updateLiveCount();
        if (currentRoute() === "recordings") renderRecordings().catch(() => {});
        else {
          paintDashboard();
          paintChannelList();
        }
        // If a channel detail is open, refresh its VOD pills so any
        // newly-Finished source_url flips the button to Downloaded
        // (and any newly-Started one to Downloading).
        if (selectedChannelKey) {
          const [platform, id] = selectedChannelKey.split(":");
          if (id) paintChannelVods(id, platform);
        }
      })
      .catch(() => {});
  }

  // Explicit prune event from delete-recording / clear-errored — the daemon
  // tells us exactly which job_ids it dropped from jobs.db. Surgically
  // remove them from recCache + repaint, without an extra refetch.
  if (event.RecordingsPruned) {
    const ids = new Set(event.RecordingsPruned.job_ids || []);
    if (ids.size) {
      recCache = recCache.filter((r) => !ids.has(r.id));
      dashRecordings = recCache;
      updateLiveCount();
      if (currentRoute() === "recordings") renderRecordings().catch(() => {});
      else { paintDashboard(); paintChannelList(); }
    }
  }

  // #74 — bulk-download progress: update state + the rail bulk badge only.
  if (event.BulkProgress) {
    const p = event.BulkProgress;
    if (p.active) {
      bulkStatus[p.channel_id] = { done: p.done, total: p.total, active: true };
    } else {
      delete bulkStatus[p.channel_id];
    }
    paintChannelList();
  }

  // #75 — Patreon snapshot feeds the channel list + Patreon detail.
  if (event.PatreonState) {
    const ps = event.PatreonState;
    patreonState.creators = ps.creators || [];
    patreonState.posts = {};
    for (const post of ps.posts || []) {
      (patreonState.posts[post.campaign_id] ||= []).push(post);
    }
    for (const list of Object.values(patreonState.posts)) {
      list.sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
    }
    paintChannelList();
    // Refresh an open Patreon detail.
    if (onHome && selectedChannelKey && selectedChannelKey.startsWith("Patreon:")) {
      const id = selectedChannelKey.slice("Patreon:".length);
      const c = patreonState.creators.find((x) => x.id === id);
      if (c) renderPatreonPosts(c);
    }
  }

  // Channel VODs answer the detail-pane request.
  if (event.ChannelVods) {
    const cv = event.ChannelVods;
    channelVods[cv.channel_id] = cv.vods || [];
    if (onHome && selectedChannelKey && selectedChannelKey.endsWith(`:${cv.channel_id}`)) {
      const platform = selectedChannelKey.split(":")[0];
      paintChannelVods(cv.channel_id, platform);
    }
  }

  // #19 — Add-Channel wizard resolve reply.
  if (event.ChannelResolved) {
    paintAddWizardConfirm(event.ChannelResolved);
  }

  // #74 / #73 — playlist list answers the picker request.
  if (event.PlaylistList) {
    const pl = event.PlaylistList;
    if (pendingPlaylistChannel && pl.channel_id === pendingPlaylistChannel.id) {
      showPlaylistModal({
        loading: false,
        name: pendingPlaylistChannel.name,
        playlists: pl.playlists || [],
      });
    }
  }
  // renderPipelines is stripped from the PVR bundle along with the rest of
  // the Pipelines pane (build.rs @creator-start), and the "pipelines" route
  // never actually renders there (render() bounces it to #/library) — but
  // this SSE handler runs regardless of edition, so guard the call the same
  // way teardownDataviz/teardownArchive do above.
  if (event.PipelineUpdated && currentRoute() === "pipelines" && typeof renderPipelines === "function") {
    renderPipelines().catch(() => {});
  }

  // Tier 1 auth signal: any of these change the worst severity
  // `/health/checks` reports, so refresh the topbar pill without waiting
  // for the next render. Cheap (one GET) and debounced by refreshHealthPill
  // itself doing nothing when the pill element isn't mounted (e.g. login).
  if (
    event.PlatformAuthenticationRequired ||
    event.PlatformAuthenticated ||
    event.CookieSessionRejected ||
    event.DeviceCodeRequired
  ) {
    refreshHealthPill();
  }
});
// injectKeyboardHelp() itself is called from 037-creator.js (after that
// file's KBD_HELP_ROWS splice, if any) rather than here — calling it before
// a creator-only splice would bake the shorter PVR row list into the DOM
// permanently, since the overlay is built once and never re-rendered.
// Resolve the edition (creator vs PVR) and seed Patreon from the daemon
// snapshot before first paint, so the nav hides creator routes and the
// Patreon section is populated on load (not after the next poll).
// Neither the SSE stream nor the Patreon seed starts here unless
// fetchEdition() actually succeeded authenticated (sets `authed`, see
// 012-pvr.js) — on a fresh/expired session it 401s and both stay off
// until login (012-pvr.js ~520) flips `authed` and starts them itself.
// This is what stops the pre-login fetch storm: an unauthenticated visitor
// no longer opens an /events stream that just 401s and retries forever.
fetchEdition()
  .then(() => {
    if (authed) {
      events.start();
      seedPatreon();
    }
  })
  .finally(render)
  .finally(() => {
    // Fire the welcome tour once per machine — runs after the first
    // paint settles so the topnav slots have their bounding rects.
    if (currentRoute() !== "login") {
      setTimeout(startOnboardingTour, 600);
    }
  });

// ── Test hooks ───────────────────────────────────────────────────────
//
// spa.js is loaded as a module, so its top-level declarations are
// module-scoped and unreachable from Playwright's page.evaluate. Rather
// than leak the whole module onto window, a narrow surface is exported for
// e2e — and only when the page explicitly opts in, so an ordinary session
// gains no extra globals and no way to swap the player factory.
if (typeof window !== "undefined") {
  try {
    const optedIn =
      localStorage.getItem("strivo:e2e") === "1" ||
      new URLSearchParams(location.search).get("e2e") === "1";
    if (optedIn) {
      window.__strivoTestHooks = {
        ...TEST_HOOK_EXTENSIONS,
        embedParentHost,
        buildEmbedUrl,
        computeMuted,
        playerState,
        setPlayerControllerFactory,
        defaultPlayerControllerFactory,
      };
    }
  } catch (_) {
    /* private mode / blocked storage — hooks simply stay off */
  }
}

