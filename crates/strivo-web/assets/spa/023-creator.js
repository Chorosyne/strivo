// ── Schedule optimizer ────────────────────────────────────────────────
// 7×24 heatmap + top-slot recommender driven by the iter-44 backend.
// The iter ships with a synthetic dataset baked in so users can see the
// renderer work without first plumbing chat-density / Insights output;
// the textarea lets them paste real samples too.
const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SAMPLE_DATASET = [
  // Friday afternoon plateau.
  { day_of_week: 4, hour_of_day: 14, score: 70 },
  { day_of_week: 4, hour_of_day: 14, score: 72 },
  { day_of_week: 4, hour_of_day: 14, score: 68 },
  { day_of_week: 4, hour_of_day: 15, score: 75 },
  { day_of_week: 4, hour_of_day: 15, score: 72 },
  { day_of_week: 4, hour_of_day: 16, score: 70 },
  // Tuesday early-hour spike (high score, isolated → low coverage).
  { day_of_week: 1, hour_of_day: 3, score: 80 },
  { day_of_week: 1, hour_of_day: 3, score: 78 },
  // Thursday evening cluster.
  { day_of_week: 3, hour_of_day: 20, score: 65 },
  { day_of_week: 3, hour_of_day: 20, score: 63 },
  { day_of_week: 3, hour_of_day: 21, score: 68 },
  // Sunday singleton.
  { day_of_week: 6, hour_of_day: 18, score: 55 },
];

function heatmapColor(mean, lo, hi) {
  // Cool → warm map. Empty cells stay neutral; we only call this when
  // count > 0 so the gradient endpoints are real numbers.
  if (!isFinite(mean) || hi <= lo) return "rgba(255,255,255,0.04)";
  const t = ((mean - lo) / (hi - lo)).max?.(0)?.min?.(1) ?? Math.max(0, Math.min(1, (mean - lo) / (hi - lo)));
  // Lerp from cyan (low) → amber (mid) → red (high).
  const stops = [
    [0.0, [76, 201, 240]],
    [0.5, [251, 191, 36]],
    [1.0, [239, 68, 68]],
  ];
  let lo_stop = stops[0], hi_stop = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      lo_stop = stops[i]; hi_stop = stops[i + 1];
      break;
    }
  }
  const span = (hi_stop[0] - lo_stop[0]) || 1;
  const u = (t - lo_stop[0]) / span;
  const rgb = lo_stop[1].map((c, i) => Math.round(c + (hi_stop[1][i] - c) * u));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

let schedOptState = {
  samplesText: JSON.stringify(SAMPLE_DATASET, null, 2),
  topN: 3,
  mode: "spread",
  minGap: 4,
  lastResp: null,
};

async function renderScheduleOptimizer() {
  // Consume a deep-link prefill if any other page (heatmap, capability
  // matrix) stashed engagement samples for us. One-shot: clear the key
  // after consuming so a reload doesn't re-apply stale data.
  try {
    const raw = localStorage.getItem("strivo-sopt-prefill");
    if (raw) {
      const prefill = JSON.parse(raw);
      if (prefill && Array.isArray(prefill.samples) && prefill.samples.length) {
        schedOptState.samplesText = JSON.stringify(prefill.samples, null, 2);
        schedOptState.lastResp = null; // force re-run with new samples
        Toast.success(`Loaded ${prefill.samples.length} sample(s) from ${prefill.source || "deep-link"}`);
      }
      localStorage.removeItem("strivo-sopt-prefill");
    }
  } catch {
    localStorage.removeItem("strivo-sopt-prefill");
  }
  root.innerHTML = chrome(`
    ${pluginHeader("Schedule optimizer",
      "DAW launch-quantize for publish slots — engagement samples → 7×24 grid → top weekly publish times."
    )}
    <div class="sopt-grid">
      <section class="cfg-card sopt-input">
        <h2 class="cfg-title">Engagement samples</h2>
        <p class="pg-cap-hint">JSON list of <code>{day_of_week (0–6), hour_of_day (0–23), score}</code>. Seed below shows the canonical plateau-vs-spike scenario; the buttons fill the box from real recordings.</p>
        <div class="sopt-autofeed">
          <button id="sopt-feed-history" class="sm" type="button" title="Build a sample per finished recording from its started_at + duration. Score weighted by hours streamed in that hour slot. Useful baseline of when you've historically been live.">↘ My streaming history</button>
          <button id="sopt-feed-chatdens" class="sm" type="button" title="Paste a chat log for one of your recordings; chat-density runs server-side, density points map to (DoW, hour, score) via the recording's started_at.">↘ Chat density…</button>
          <span class="pg-cap-hint sopt-autofeed-hint">Auto-feed pulls a real signal into the textarea; edit before running if you want.</span>
        </div>
        <textarea id="sopt-samples" class="sopt-samples" spellcheck="false"></textarea>
        <div class="sopt-controls">
          <label><span>Top N</span>
            <input id="sopt-topn" type="number" min="1" max="14" value="${schedOptState.topN}"/>
          </label>
          <label><span>Mode</span>
            <select id="sopt-mode">
              <option value="spread" ${schedOptState.mode === "spread" ? "selected" : ""}>Spread (min-gap)</option>
              <option value="greedy" ${schedOptState.mode === "greedy" ? "selected" : ""}>Greedy</option>
            </select>
          </label>
          <label><span>Min gap (h)</span>
            <input id="sopt-mingap" type="number" min="0" max="23" value="${schedOptState.minGap}"/>
          </label>
          <button id="sopt-run" class="btn-primary sm" type="button">▶ Run optimizer</button>
        </div>
      </section>
      <section class="cfg-card sopt-output" id="sopt-output">
        <h2 class="cfg-title">Recommendations</h2>
        <div class="pg-cap-hint">Run the optimizer to see top publish slots + the weekly heatmap.</div>
      </section>
    </div>
  `);
  setupChromeHandlers();
  document.getElementById("sopt-samples").value = schedOptState.samplesText;
  document.getElementById("sopt-run").addEventListener("click", () => runScheduleOptimizer());
  document.getElementById("sopt-feed-history")?.addEventListener("click", autoFeedFromHistory);
  document.getElementById("sopt-feed-chatdens")?.addEventListener("click", autoFeedFromChatDensity);
  // Auto-run on mount if we never have — gives users an instant view.
  if (!schedOptState.lastResp) {
    runScheduleOptimizer().catch(() => {});
  } else {
    paintScheduleOptimizer();
  }
}

async function runScheduleOptimizer() {
  const samplesText = document.getElementById("sopt-samples").value.trim();
  let samples;
  try { samples = JSON.parse(samplesText); }
  catch (err) { Toast.error(`Samples JSON invalid: ${err.message}`); return; }
  if (!Array.isArray(samples)) { Toast.error("Samples must be a JSON array"); return; }
  const topN = parseInt(document.getElementById("sopt-topn").value, 10) || 3;
  const mode = document.getElementById("sopt-mode").value;
  const minGap = parseInt(document.getElementById("sopt-mingap").value, 10) || 4;
  schedOptState.samplesText = samplesText;
  schedOptState.topN = topN;
  schedOptState.mode = mode;
  schedOptState.minGap = minGap;
  const out = document.getElementById("sopt-output");
  out.innerHTML = `<h2 class="cfg-title">Recommendations</h2><div class="empty sm">Running…</div>`;
  try {
    const resp = await API.scheduleOptimizerRun("interactive", {
      samples,
      top_n: topN,
      mode,
      min_gap_hours: minGap,
    });
    schedOptState.lastResp = resp;
    paintScheduleOptimizer();
  } catch (err) {
    out.innerHTML = `<h2 class="cfg-title">Recommendations</h2><div class="empty"><div class="glyph">⚠</div>${htmlEscape(err.message)}</div>`;
  }
}

// ── Schedule-optimizer auto-feed helpers ──────────────────────────
// Build EngagementSample[] from sources that already exist in the
// app — historical recordings (presence + duration) and a chat log
// pasted through chat-density.

/** Bucket finished recordings into (day_of_week, hour_of_day) cells
 * keyed by their started_at. Score for each cell = sum of recording
 * durations in hours (a longer presence in that slot is a stronger
 * "people watch me here" signal). Clamped 0.1..5.0 per cell so a
 * single 8h marathon doesn't drown the rest of the week. */
function recordingsToEngagementSamples(recordings) {
  const cells = new Map(); // "dow,hour" → score
  for (const r of recordings) {
    if (r.state !== "Finished" || !r.started_at) continue;
    const ts = Date.parse(r.started_at);
    if (!isFinite(ts)) continue;
    const dur = Number(r.duration_secs) || 0;
    // If duration is zero (older rec), treat as one-hour presence.
    const hours = Math.max(dur / 3600, 1.0);
    const d = new Date(ts);
    const dow = d.getDay();
    const hour = d.getHours();
    const key = `${dow},${hour}`;
    cells.set(key, (cells.get(key) || 0) + hours);
  }
  const out = [];
  for (const [k, score] of cells.entries()) {
    const [dow, hour] = k.split(",").map(Number);
    out.push({ day_of_week: dow, hour_of_day: hour, score: Math.min(5.0, Math.max(0.1, score)) });
  }
  // Sort for stable diffs.
  out.sort((a, b) => (a.day_of_week - b.day_of_week) || (a.hour_of_day - b.hour_of_day));
  return out;
}

async function autoFeedFromHistory() {
  const btn = document.getElementById("sopt-feed-history");
  await withBusy(btn, "Loading…", async () => {
    const r = await API.recordings();
    const recs = r.recordings || r.items || (Array.isArray(r) ? r : []);
    const samples = recordingsToEngagementSamples(recs);
    if (!samples.length) {
      Toast.error("No finished recordings with started_at — nothing to feed");
      return;
    }
    schedOptState.samplesText = JSON.stringify(samples, null, 2);
    const ta = document.getElementById("sopt-samples");
    if (ta) ta.value = schedOptState.samplesText;
    Toast.success(`Loaded ${samples.length} slot(s) from ${recs.length} recording(s) — review then ▶ Run`);
  }).catch((err) => Toast.error(`History feed failed: ${err.message}`));
}

/** Density points → samples. Each point's wall-clock time is
 * `started_at + time_sec`; bucket score by (dow, hour). */
function densityToEngagementSamples(densityPoints, startedAtMs) {
  const cells = new Map();
  for (const p of densityPoints) {
    const t = (Number(p.time_sec) || 0) * 1000 + startedAtMs;
    const d = new Date(t);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getDay()},${d.getHours()}`;
    cells.set(key, (cells.get(key) || 0) + (Number(p.score) || Number(p.count) || 0));
  }
  // Normalise to 0..5 so the optimizer's confidence math stays in
  // the same range as the seeded dataset.
  let max = 0;
  for (const v of cells.values()) if (v > max) max = v;
  const out = [];
  for (const [k, v] of cells.entries()) {
    const [dow, hour] = k.split(",").map(Number);
    const score = max > 0 ? (v / max) * 5.0 : v;
    out.push({ day_of_week: dow, hour_of_day: hour, score: Math.max(0.1, score) });
  }
  out.sort((a, b) => (a.day_of_week - b.day_of_week) || (a.hour_of_day - b.hour_of_day));
  return out;
}

/** Map heatmap fused buckets (per-recording) → engagement samples
 * keyed by (day_of_week, hour_of_day). bucket_start is seconds from
 * the recording's start, so wall-clock time = startedAtMs + bucket
 * × 1000. Score = fused retention proxy × bucket coverage. */
function heatmapBucketsToSamples(buckets, startedAtMs) {
  const cells = new Map();
  const weights = new Map();
  for (const b of buckets || []) {
    const t = (Number(b.bucket_start) || 0) * 1000 + startedAtMs;
    const d = new Date(t);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getDay()},${d.getHours()}`;
    const score = Math.max(0, Number(b.fused) || 0);
    cells.set(key, (cells.get(key) || 0) + score);
    weights.set(key, (weights.get(key) || 0) + 1);
  }
  let max = 0;
  for (const v of cells.values()) if (v > max) max = v;
  const out = [];
  for (const [k, v] of cells.entries()) {
    const [dow, hour] = k.split(",").map(Number);
    // Average × 5 keeps the score in the same 0..5 scale as the
    // seeded dataset.
    const w = weights.get(k) || 1;
    const score = max > 0 ? (v / w) * 5.0 : 0.1;
    out.push({ day_of_week: dow, hour_of_day: hour, score: Math.max(0.1, score) });
  }
  out.sort((a, b) => (a.day_of_week - b.day_of_week) || (a.hour_of_day - b.hour_of_day));
  return out;
}

/** Stash a deep-link prefill so the schedule-optimizer page can
 * consume it on next mount. localStorage so it survives the hash
 * change without state plumbing through the router. */
function stashOptimizerPrefill(samples, source) {
  try {
    localStorage.setItem("strivo-sopt-prefill", JSON.stringify({
      samples,
      source,
      stashed_at: Date.now(),
    }));
  } catch {
    // Quota errors are non-fatal — the user can still paste manually.
  }
}

async function autoFeedFromChatDensity() {
  // One-shot prompt-driven mini-flow: pick a recording, paste its
  // chat log, the rest is automatic.
  const r = await API.recordings();
  const recs = (r.recordings || r.items || []).filter((x) => x.state === "Finished" && x.started_at);
  if (!recs.length) {
    Toast.error("No finished recordings with started_at — nothing to map chat density onto");
    return;
  }
  const pickerLines = recs.slice(0, 12).map((x, i) => `${i + 1}. ${(x.stream_title || x.channel_name || x.id).slice(0, 48)} (${x.started_at})`).join("\n");
  const idx = prompt(`Pick the recording the chat log belongs to (enter row number 1..${Math.min(12, recs.length)}):\n\n${pickerLines}`, "1");
  if (idx == null) return;
  const rec = recs[(parseInt(idx, 10) || 1) - 1];
  if (!rec) { Toast.error("No recording at that row"); return; }
  const csvHint = "Paste an IRC dump OR a CSV with header `time_sec,user,message`.";
  const log = prompt(`${csvHint}\nLeave blank to abort.`, "");
  if (!log || !log.trim()) return;
  const looksLikeCsv = /^[\s]*time_sec\s*,/i.test(log) || /^[\s]*\d+\s*,/.test(log);
  const btn = document.getElementById("sopt-feed-chatdens");
  await withBusy(btn, "Running chat-density…", async () => {
    const body = looksLikeCsv
      ? { csv: log, bucket_secs: 30.0 }
      : { log, stream_start_ts_ms: Date.parse(rec.started_at) || 0, bucket_secs: 30.0 };
    const cd = await API.chatDensityCompute(rec.id, body);
    const points = cd.points || [];
    if (!points.length) {
      Toast.error("chat-density returned no points — log may be empty or malformed");
      return;
    }
    const samples = densityToEngagementSamples(points, Date.parse(rec.started_at) || 0);
    schedOptState.samplesText = JSON.stringify(samples, null, 2);
    const ta = document.getElementById("sopt-samples");
    if (ta) ta.value = schedOptState.samplesText;
    Toast.success(`Loaded ${samples.length} slot(s) from ${points.length} density point(s) (${cd.event_count} chat events)`);
  }).catch((err) => Toast.error(`Chat-density feed failed: ${err.message}`));
}

function paintScheduleOptimizer() {
  const out = document.getElementById("sopt-output");
  if (!out) return;
  const resp = schedOptState.lastResp;
  if (!resp) return;
  const picks = resp.recommendations || [];
  // Pull min/max across non-empty cells for the heatmap colour scale.
  let lo = Infinity, hi = -Infinity;
  const buckets = resp.grid?.buckets || [];
  for (const row of buckets) {
    for (const b of row) {
      if (b.count > 0) { lo = Math.min(lo, b.mean); hi = Math.max(hi, b.mean); }
    }
  }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  // Header row + day rows.
  const hourCells = [];
  for (let h = 0; h < 24; h++) hourCells.push(`<div class="sopt-hour-label">${h}</div>`);
  const dayRows = DAYS_OF_WEEK.map((day, dIdx) => {
    const cells = [];
    for (let h = 0; h < 24; h++) {
      const b = buckets[dIdx]?.[h] || { mean: 0, count: 0 };
      if (b.count === 0) {
        cells.push(`<div class="sopt-cell sopt-cell-empty" title="${day} ${h}:00 · no data"></div>`);
      } else {
        const color = heatmapColor(b.mean, lo, hi);
        const isPick = picks.some(p => p.day_of_week === dIdx && p.hour_of_day === h);
        cells.push(`<div class="sopt-cell ${isPick ? "sopt-cell-pick" : ""}"
          title="${day} ${h}:00 · mean ${b.mean.toFixed(1)} · n=${b.count}"
          style="background:${color}"></div>`);
      }
    }
    return `<div class="sopt-day-label">${day}</div>${cells.join("")}`;
  }).join("");
  const picksHtml = picks.map((p, i) => `
    <div class="sopt-pick">
      <div class="sopt-pick-rank">#${i + 1}</div>
      <div class="sopt-pick-when"><strong>${DAYS_OF_WEEK[p.day_of_week]}</strong> ${String(p.hour_of_day).padStart(2, "0")}:00</div>
      <div class="sopt-pick-mean">mean <strong>${p.mean_score.toFixed(1)}</strong></div>
      <div class="sopt-pick-bars">
        <div class="sopt-pick-bar" title="confidence ${(p.confidence*100).toFixed(0)}%"><span style="width:${(p.confidence*100).toFixed(1)}%"></span></div>
        <div class="sopt-pick-bar coverage" title="coverage ${(p.window_coverage*100).toFixed(0)}%"><span style="width:${(p.window_coverage*100).toFixed(1)}%"></span></div>
      </div>
      <div class="sopt-pick-meta pg-cap-hint">n=${p.sample_count} · conf ${(p.confidence*100).toFixed(0)}% · coverage ${(p.window_coverage*100).toFixed(0)}%</div>
    </div>`).join("");
  out.innerHTML = `
    <h2 class="cfg-title">Recommendations <span class="pg-cap-hint">${resp.sample_count} sample${resp.sample_count===1?"":"s"} · ${picks.length} pick${picks.length===1?"":"s"}</span></h2>
    <div class="sopt-picks">${picksHtml || '<div class="empty sm">No picks — try a wider range or check your sample data.</div>'}</div>
    <h3 class="sopt-heatmap-h">Weekly heatmap</h3>
    <div class="sopt-heatmap">
      <div class="sopt-corner"></div>
      ${hourCells.join("")}
      ${dayRows}
    </div>
    <div class="sopt-legend">
      <span>${lo.toFixed(1)}</span>
      <div class="sopt-legend-bar"></div>
      <span>${hi.toFixed(1)}</span>
    </div>
  `;
}
