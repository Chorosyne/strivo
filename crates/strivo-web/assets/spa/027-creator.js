// ── Archiver ─────────────────────────────────────────────────────────
async function renderArchiver() {
  const resp = await API.archiverChannels();
  root.removeAttribute("aria-busy");
  const chans = (resp && resp.channels) || [];
  const rows = chans
    .map((c) => {
      const pct = c.video_count
        ? Math.round((c.downloaded_count / c.video_count) * 100)
        : 0;
      return `
        <a class="pg-row" href="#/plugins/archiver/${encodeURIComponent(c.id)}">
          <span class="pg-row-main">
            <span class="pg-row-title">${htmlEscape(c.name)}</span>
            <span class="pg-row-sub plat-${htmlEscape((c.platform || "").toLowerCase())}">${htmlEscape(c.platform)} · ${htmlEscape(c.last_scan || "never scanned")}</span>
          </span>
          <span class="pg-row-meta">
            <span class="pg-row-num">${formatCount(c.downloaded_count)} / ${formatCount(c.video_count)}</span>
            <span class="pg-mini-gauge"><span style="width:${pct}%"></span></span>
          </span>
        </a>`;
    })
    .join("");
  root.innerHTML = chrome(`
    ${pluginHeader("Archiver", "Tracked channels and their back-catalog download status.", "#/plugins")}
    <div class="pg-list">${rows || `<div class="empty">No channels archived yet.</div>
      <div class="pg-getstarted"><strong>Get started:</strong> add a channel and enable Archiver tandem from its row — Archiver back-fills the channel's existing VODs in priority order.</div>`}</div>
  `);
  setupChromeHandlers();
}

async function renderArchiverVideos(channelId) {
  const resp = await API.archiverVideos(channelId);
  root.removeAttribute("aria-busy");
  const vids = (resp && resp.videos) || [];
  const rows = vids
    .map(
      (v) => `
      <div class="pg-row pg-row-static">
        <span class="pg-row-main">
          <span class="pg-row-title">${htmlEscape(niceTitle(v.title))}</span>
          <span class="pg-row-sub">${htmlEscape(v.upload_date || "")}${v.playlist ? " · " + htmlEscape(v.playlist) : ""}${v.duration ? " · " + fmtClock(v.duration) : ""}</span>
        </span>
        <span class="pg-row-meta">
          ${v.downloaded ? '<span class="cfg-badge ok">downloaded</span>' : '<span class="cfg-badge">pending</span>'}
        </span>
      </div>`,
    )
    .join("");
  root.innerHTML = chrome(`
    ${pluginHeader("Catalog", `${vids.length} videos`, "#/plugins/archiver")}
    <div class="pg-list">${rows || '<div class="empty">No catalog entries.</div>'}</div>
  `);
  setupChromeHandlers();
}

// ── Viewguard ────────────────────────────────────────────────────────
async function renderViewguard() {
  const resp = await API.viewguardVerdicts();
  root.removeAttribute("aria-busy");
  const verdicts = (resp && resp.verdicts) || [];
  const cards = verdicts
    .map((v) => {
      const pct = Math.round((v.final_score || 0) * 100);
      const contributors = Array.isArray(v.contributors)
        ? v.contributors
        : v.contributors && v.contributors.contributors
          ? v.contributors.contributors
          : [];
      const bars = contributors
        .map((c) => {
          const name = c.kind || c.detector || c.name || "signal";
          const score = c.score != null ? c.score : c.weight != null ? c.weight : 0;
          return `<div class="vg-contrib">
              <span class="vg-contrib-name">${htmlEscape(String(name))}</span>
              <span class="vg-bar"><span style="width:${Math.round(score * 100)}%"></span></span>
            </div>`;
        })
        .join("");
      return `
        <section class="cfg-card vg-card">
          <div class="vg-head">
            <span class="vg-channel">${htmlEscape(v.channel_id)}</span>
            <span class="cfg-badge vg-band vg-band-${htmlEscape((v.band || "").toLowerCase())}">${htmlEscape(v.band)}</span>
          </div>
          <div class="vg-score">
            <span class="vg-score-num">${pct}%</span>
            <span class="vg-score-label">suspicion</span>
          </div>
          ${bars ? `<div class="vg-contribs">${bars}</div>` : ""}
          <div class="vg-when">${htmlEscape(v.stream_started_at || "")}</div>
        </section>`;
    })
    .join("");
  root.innerHTML = chrome(`
    ${pluginHeader("Viewguard", "Latest viewbot-fraud verdict per channel. Higher = more suspicious.", "#/plugins")}
    <div id="vg-trend-summary"></div>
    <div class="cfg-grid">${cards || `<div class="empty">No verdicts yet — viewers are sampled while channels are live.</div>
      <div class="pg-getstarted"><strong>Get started:</strong> Viewguard runs automatically during live Twitch captures. Verdicts appear here after a stream ends and samples are scored.</div>`}</div>
  `);
  setupChromeHandlers();
  // Lazy-load the trend dashboard so the per-channel cards paint
  // first. Pure render; the summary inserts above the grid when ready.
  API.viewguardTrend().then(renderViewguardTrend).catch(() => {});
}

// Render the cross-stream trend dashboard above the per-channel grid.
// Shows banded watchlists (Critical / Warning / Watch) — Clear is
// hidden by default since there's nothing actionable there.
function renderViewguardTrend(resp) {
  const host = document.getElementById("vg-trend-summary");
  if (!host || !resp || !resp.watchlist) return;
  const wl = resp.watchlist;
  const bandSpec = [
    ["critical", "Critical", "hsl(0, 80%, 60%)"],
    ["warning", "Warning", "hsl(20, 80%, 60%)"],
    ["watch", "Multi-stream", "hsl(40, 80%, 60%)"],
  ];
  const actionLabel = {
    no_action: "No action",
    keep_monitoring: "Keep monitoring",
    manual_review: "Manual review",
    escalate_and_report: "Escalate + report",
  };
  const directionGlyph = {
    improving: "↓",
    stable: "→",
    worsening: "↑",
  };
  const bands = bandSpec
    .map(([key, label, colour]) => {
      const list = wl[key] || [];
      if (!list.length) return "";
      const rows = list
        .map(
          (t) => `
        <div class="vg-trend-row" style="--vg-c:${colour}">
          <span class="vg-trend-name">${htmlEscape(t.channel_name)}</span>
          <span class="vg-trend-score">${(t.latest_score * 100).toFixed(0)}%</span>
          <span class="vg-trend-dir" title="latest ${t.latest_score.toFixed(2)} vs rolling mean ${t.rolling_mean.toFixed(2)} (Δ ${t.delta >= 0 ? "+" : ""}${(t.delta * 100).toFixed(0)}pp)">
            ${htmlEscape(directionGlyph[t.direction] || "→")} ${htmlEscape(t.direction)}
          </span>
          ${t.anomaly ? '<span class="vg-trend-anomaly" title="latest deviates from rolling mean by >20pp">anomaly</span>' : ""}
          <span class="vg-trend-samples">${t.samples} sample${t.samples === 1 ? "" : "s"}</span>
          <span class="vg-trend-action">${htmlEscape(actionLabel[t.suggested_action] || t.suggested_action)}</span>
        </div>`,
        )
        .join("");
      return `<details class="vg-trend-band" open data-band="${htmlEscape(key)}" style="--vg-c:${colour}">
        <summary><strong>${htmlEscape(label)}</strong> <span class="pg-cap-hint">${list.length} channel${list.length === 1 ? "" : "s"}</span></summary>
        <div class="vg-trend-list">${rows}</div>
      </details>`;
    })
    .filter(Boolean)
    .join("");
  const clearCount = (wl.clear || []).length;
  host.innerHTML = `
    <section class="cfg-card vg-trend-card">
      <h2 class="cfg-title">Cross-stream trend <span class="pg-cap-hint">${resp.samples} verdict sample${resp.samples === 1 ? "" : "s"} · ${clearCount} clear channel${clearCount === 1 ? "" : "s"} hidden</span></h2>
      ${bands || '<div class="empty sm">No actionable trends right now — every channel is in the Clear band.</div>'}
    </section>`;
}

// ── Insights ─────────────────────────────────────────────────────────
let insightsState = { stopwords: false };
async function renderInsights() {
  const parts = routeParts();
  const recId = parts[2] === "rec" ? parts[3] : null;
  const [wordsResp, topicsResp, crunchrResp] = await Promise.all([
    API.insightsWords({ stopwords: insightsState.stopwords, limit: 40 }),
    API.insightsTopics(),
    // Pull the list of transcribed recordings so the comparison
    // picker has options. Failure is fine — the picker just stays
    // empty.
    API.crunchrRecordings().catch(() => ({ recordings: [] })),
  ]);
  root.removeAttribute("aria-busy");
  const words = (wordsResp && wordsResp.words) || [];
  const max = words.reduce((m, w) => Math.max(m, w.count), 0) || 1;
  const wordRows = words
    .map(
      (w) => `
      <div class="wf-row">
        <span class="wf-word">${htmlEscape(w.word)}</span>
        <span class="wf-bar"><span style="width:${Math.round((w.count / max) * 100)}%"></span></span>
        <span class="wf-count">${formatCount(w.count)}</span>
      </div>`,
    )
    .join("");
  const topics = (topicsResp && topicsResp.topics) || [];
  const topicChips = topics
    .slice(0, 60)
    .map(
      (t) =>
        `<span class="pg-chip" title="${htmlEscape(t.first_seen)} → ${htmlEscape(t.last_seen)}">${htmlEscape(t.topic)} <em>${t.count}</em></span>`,
    )
    .join("");

  // Comparison picker: pick any two transcribed recordings.
  const allRecs = (crunchrResp && crunchrResp.recordings) || [];
  const recOptions = allRecs
    .map(
      (r) =>
        `<option value="${htmlEscape(r.recording_id)}">${htmlEscape(niceTitle(r.title) || r.recording_id)} · ${htmlEscape(r.channel_name)}</option>`,
    )
    .join("");

  root.innerHTML = chrome(`
    ${pluginHeader("Insights", "Aggregate signals across every transcribed recording.", "#/plugins")}
    <div class="cfg-grid">
      <section class="cfg-card">
        <h2 class="cfg-title">Top words</h2>
        <div class="pg-toolbar">
          <label class="pg-toggle"><input type="checkbox" id="ins-stopwords" ${insightsState.stopwords ? "checked" : ""}/> include stopwords</label>
          <a class="pg-linkbtn" href="/api/v1/plugins/insights/export?fmt=csv${insightsState.stopwords ? "&stopwords=true" : ""}">Export CSV</a>
          <a class="pg-linkbtn" href="/api/v1/plugins/insights/export?fmt=json${insightsState.stopwords ? "&stopwords=true" : ""}">JSON</a>
        </div>
        <div class="wf-list">${wordRows || '<div class="empty sm">No word data yet.</div>'}</div>
      </section>
      <section class="cfg-card">
        <h2 class="cfg-title">Topics</h2>
        <div class="pg-chips">${topicChips || '<div class="empty sm">No analyzed recordings yet.</div>'}</div>
      </section>
      <section class="cfg-card" id="ins-speakers-card">
        <h2 class="cfg-title">Speaker airtime</h2>
        <div id="ins-speakers"><div class="empty sm">Open a transcript and choose “View insights” to load speaker airtime.</div></div>
      </section>
      <section class="cfg-card" id="ins-compare-card">
        <h2 class="cfg-title">Compare two streams <span class="pg-cap-hint">word overlap · Jaccard · what's new vs gone</span></h2>
        <form id="ins-compare-form" class="mon-add">
          <select id="ins-compare-a">${recOptions}</select>
          <select id="ins-compare-b">${recOptions}</select>
          <button class="btn-primary" type="submit">Compare</button>
        </form>
        <div id="ins-compare-result"></div>
      </section>
    </div>
  `);
  setupChromeHandlers();
  const cb = document.getElementById("ins-stopwords");
  if (cb) {
    cb.addEventListener("change", () => {
      insightsState.stopwords = cb.checked;
      renderInsights();
    });
  }
  if (recId) await loadInsightsSpeakers(recId);

  // Comparison submit — POSTs nothing (idempotent GET).
  document.getElementById("ins-compare-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = document.getElementById("ins-compare-a").value;
    const b = document.getElementById("ins-compare-b").value;
    if (!a || !b || a === b) {
      Toast.error("Pick two different recordings");
      return;
    }
    const host = document.getElementById("ins-compare-result");
    host.innerHTML = '<div class="empty sm">Comparing…</div>';
    try {
      const r = await API.insightsCompare(a, b);
      const c = r.comparison;
      const sharedRows = (c.shared || [])
        .slice(0, 30)
        .map(
          (s) =>
            `<tr><td>${htmlEscape(s.word)}</td><td>${s.count_a}</td><td>${s.count_b}</td><td>${isFinite(s.a_over_b) ? s.a_over_b.toFixed(2) : "∞"}</td></tr>`,
        )
        .join("");
      const onlyA = (c.only_a || []).slice(0, 20).map((w) => `<li>${htmlEscape(w.word)} <em>${w.count}</em></li>`).join("");
      const onlyB = (c.only_b || []).slice(0, 20).map((w) => `<li>${htmlEscape(w.word)} <em>${w.count}</em></li>`).join("");
      host.innerHTML = `
        <div class="ins-cmp-summary">
          <span class="cfg-badge">Jaccard ${(c.jaccard * 100).toFixed(0)}%</span>
          <span class="pg-cap-hint">${c.shared.length} shared · ${c.only_a.length} only-A · ${c.only_b.length} only-B</span>
        </div>
        <div class="ins-cmp-grid">
          <div class="ins-cmp-table-wrap">
            <h3 class="ins-cmp-h">Shared words</h3>
            <table class="ins-cmp-table">
              <thead><tr><th>word</th><th>A</th><th>B</th><th>A÷B</th></tr></thead>
              <tbody>${sharedRows || '<tr><td colspan="4" class="empty sm">No shared words</td></tr>'}</tbody>
            </table>
          </div>
          <div>
            <h3 class="ins-cmp-h">Only in A</h3>
            <ul class="ins-cmp-list">${onlyA || '<li class="empty sm">None</li>'}</ul>
          </div>
          <div>
            <h3 class="ins-cmp-h">Only in B</h3>
            <ul class="ins-cmp-list">${onlyB || '<li class="empty sm">None</li>'}</ul>
          </div>
        </div>`;
    } catch (err) {
      host.innerHTML = `<div class="empty sm">Compare failed: ${htmlEscape(err.message)}</div>`;
    }
  });
}

async function loadInsightsSpeakers(recId) {
  const host = document.getElementById("ins-speakers");
  if (!host) return;
  try {
    const r = await API.insightsSpeakers(recId);
    const speakers = (r && r.speakers) || [];
    const max = speakers.reduce((m, s) => Math.max(m, s.seconds), 0) || 1;
    host.innerHTML = speakers.length
      ? `${r.sentiment ? `<p class="page-subtitle">sentiment: <span class="cfg-badge sentiment-${htmlEscape(r.sentiment)}">${htmlEscape(r.sentiment)}</span></p>` : ""}
         ${speakers
           .map(
             (s) => `
        <div class="wf-row">
          <span class="wf-word">${htmlEscape(s.speaker)}</span>
          <span class="wf-bar"><span style="width:${Math.round((s.seconds / max) * 100)}%"></span></span>
          <span class="wf-count">${fmtClock(s.seconds)}</span>
        </div>`,
           )
           .join("")}`
      : '<div class="empty sm">No diarized speakers for this recording.</div>';
  } catch (e) {
    host.innerHTML = `<div class="empty sm">${htmlEscape(e.message)}</div>`;
  }
}

// ── Verb dispatch (actions over IPC) ─────────────────────────────────
async function dispatchVerb(plugin, verb, selection, btn) {
  if (btn) {
    btn.disabled = true;
    btn.dataset.prevLabel = btn.textContent;
    btn.textContent = "…";
  }
  try {
    await API.pluginRpc(plugin, verb, { selection });
    Toast.success(`${verb} queued in the daemon`);
  } catch (e) {
    Toast.error(`${verb} failed: ${e.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      if (btn.dataset.prevLabel) btn.textContent = btn.dataset.prevLabel;
    }
  }
}
