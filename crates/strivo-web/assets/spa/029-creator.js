  overlay.querySelector("[data-action=rec-info-cuepoints]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, "Detecting…", async () => {
      const resp = await API.cuepointsGenerate(jobId);
      const host = document.getElementById("rec-cuepoints");
      if (!host) return;
      // Compute duration as a max-time + 5% pad so the timeline isn't
      // clipped if the last cuepoint is near the end of the file.
      const points = resp.points || [];
      const maxTime = points.length ? Math.max(...points.map((p) => p.time_sec)) : 0;
      const duration = Math.max(maxTime * 1.05, 60);
      if (!points.length) {
        host.innerHTML = `<div class="empty sm">No scene changes detected at threshold ${resp.threshold}.</div>`;
        host.hidden = false;
        return;
      }
      host.innerHTML = `
        <h4 class="rec-cp-title">${points.length} scene change${points.length === 1 ? "" : "s"} <span class="pg-cap-hint">${resp.cached ? "(cached)" : "(fresh extraction)"}</span></h4>
        <div class="rec-cp-strip" style="--rec-cp-dur:${duration}">
          ${points
            .map(
              (p) =>
                `<a class="rec-cp-tick" style="--rec-cp-pct:${((p.time_sec / duration) * 100).toFixed(2)}%" data-seek="${p.time_sec}" title="${fmtClock(p.time_sec)}" href="#"></a>`,
            )
            .join("")}
        </div>
        <div class="rec-cp-axis">
          <span>0:00</span>
          <span>${fmtClock(duration)}</span>
        </div>`;
      host.hidden = false;
      host.querySelectorAll(".rec-cp-tick").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          closeRecordingModals();
          openRecordingPlayer(jobId, { seekTo: parseFloat(el.dataset.seek || "0") });
        });
      });
      Toast.success(`Detected ${points.length} scene change(s)`);
    }).catch((err) => Toast.error(`Cuepoints failed: ${err.message}`));
  });
  overlay.querySelector("[data-action=rec-info-clipper]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, "Mining…", async () => {
      const [analysis, existing] = await Promise.all([
        API.clipperAnalyze(jobId),
        API.clipperListClips(jobId).catch(() => ({ clips: [] })),
      ]);
      const host = document.getElementById("rec-clipper");
      if (!host) return;
      host.hidden = false;
      const highlights = analysis.highlights || [];
      const cutByStart = new Map(
        (existing.clips || []).map((c) => [Math.round(c.start_sec), c]),
      );
      if (!highlights.length) {
        host.innerHTML = `<div class="empty sm">No highlight candidates found (transcript or cuepoints empty?).</div>`;
        return;
      }
      host.innerHTML = `
        <h4 class="rec-cp-title">${highlights.length} highlight candidate${highlights.length === 1 ? "" : "s"} <span class="pg-cap-hint">window ${analysis.window_secs}s</span></h4>
        <div class="rec-hl-list">
          ${highlights
            .map((h, i) => {
              const cut = cutByStart.get(Math.round(h.time_sec));
              return `<div class="rec-hl-row" data-i="${i}">
                <button class="rec-hl-jump" data-seek="${h.time_sec}" title="Jump to ${fmtClock(h.time_sec)}">${fmtClock(h.time_sec)}</button>
                <span class="rec-hl-score" title="Score ${h.score.toFixed(2)} · density ${h.density}">
                  <span class="rec-hl-bar" style="--rec-hl-pct:${(h.score * 100).toFixed(0)}%"></span>
                  <span>${Math.round(h.score * 100)}%</span>
                </span>
                <span class="rec-hl-meta">${h.density} cuepoint${h.density === 1 ? "" : "s"} · ${h.suggested_duration}s</span>
                ${cut
                  ? `<span class="cfg-badge ok" title="${htmlEscape(cut.clip_path)}">✓ cut · ${formatBytes(cut.bytes)}</span>`
                  : `<button class="sm rec-hl-cut" data-start="${h.time_sec}" data-dur="${h.suggested_duration}">Cut clip</button>`}
              </div>`;
            })
            .join("")}
        </div>`;
      host.querySelectorAll(".rec-hl-jump").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          closeRecordingModals();
          openRecordingPlayer(jobId, { seekTo: parseFloat(el.dataset.seek || "0") });
        });
      });
      host.querySelectorAll(".rec-hl-cut").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const cb = e.currentTarget;
          await withBusy(cb, "Cutting…", async () => {
            const res = await API.clipperExtract(jobId, {
              start_sec: parseFloat(cb.dataset.start),
              duration_sec: parseFloat(cb.dataset.dur),
              stem: `${niceTitle(rec.stream_title).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60)}_${Math.round(parseFloat(cb.dataset.start))}`,
            });
            Toast.success(`Cut ${formatBytes(res.bytes)} → ${res.clip_path}`);
            cb.outerHTML = `<span class="cfg-badge ok" title="${htmlEscape(res.clip_path)}">✓ cut · ${formatBytes(res.bytes)}</span>`;
          }).catch((err) => Toast.error(`Cut failed: ${err.message}`));
        });
      });
      Toast.success(`Found ${highlights.length} highlight candidate(s)`);
    }).catch((err) => Toast.error(`Highlights failed: ${err.message}`));
  });

  overlay.querySelector("[data-action=rec-info-thumbs]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, "Sampling…", async () => {
      const resp = await API.thumbnailsGenerate(jobId, {
        source: "cuepoints",
        facecam: "top_right",
      });
      const host = document.getElementById("rec-thumbs");
      if (!host) return;
      host.hidden = false;
      const candidates = resp.candidates || [];
      if (!candidates.length) {
        host.innerHTML = '<div class="empty sm">No thumbnail candidates generated.</div>';
        return;
      }
      host.innerHTML = `
        <h4 class="rec-cp-title">${candidates.length} thumbnail candidate${candidates.length === 1 ? "" : "s"} <span class="pg-cap-hint">ranked by saliency</span></h4>
        <div class="rec-thumbs-grid">
          ${candidates
            .map(
              (c, i) =>
                `<figure class="rec-thumb-card" data-i="${i}">
                  <a class="rec-thumb-img" href="${htmlEscape(API.thumbnailFileUrl(c.path))}" target="_blank" rel="noopener">
                    <img loading="lazy" alt="" src="${htmlEscape(API.thumbnailFileUrl(c.path))}" />
                    <span class="rec-thumb-time">${fmtClock(c.time_sec)}</span>
                  </a>
                  <figcaption>
                    <span class="rec-thumb-score" title="Score ${c.score.toFixed(2)} · ${formatBytes(c.bytes)}">
                      <span class="rec-hl-bar" style="--rec-hl-pct:${(c.score * 100).toFixed(0)}%"></span>
                      <span>${Math.round(c.score * 100)}%</span>
                    </span>
                    ${c.crop_path ? `<a class="pg-linkbtn" href="${htmlEscape(API.thumbnailFileUrl(c.crop_path))}" target="_blank" rel="noopener" title="9:16 facecam crop">9:16 crop</a>` : ""}
                  </figcaption>
                </figure>`,
            )
            .join("")}
        </div>`;
      Toast.success(`Generated ${candidates.length} thumbnail candidate(s)`);
    }).catch((err) => Toast.error(`Thumbnails failed: ${err.message}`));
  });

  // R02 — B-roll finder. The backend takes the streamer's tagged asset
  // library inline on every request (it stays stateless); there's no
  // library-management page in StriVo yet, so the library is the same
  // hand-curated JSON the crate's own docs describe, edited in a textarea
  // and persisted to localStorage so it survives reloads.
  overlay.querySelector("[data-action=rec-info-broll]")?.addEventListener("click", (e) => {
    const host = document.getElementById("rec-broll");
    if (!host) return;
    host.hidden = false;
    const stored = localStorage.getItem("strivo-broll-library") || "";
    host.innerHTML = `
      <h4 class="rec-cp-title">B-roll library <span class="pg-cap-hint">JSON — {"assets":[{"id","path","duration_sec","tags":[]}]}</span></h4>
      <textarea id="rec-broll-lib" rows="4"
        placeholder='{"assets":[{"id":"a1","path":"/media/broll/city.mp4","duration_sec":8,"tags":["city","night"]}]}'
      >${htmlEscape(stored)}</textarea>
      <button class="sm" id="rec-broll-run" type="button">Suggest B-roll</button>
      <div id="rec-broll-results"></div>
    `;
    document.getElementById("rec-broll-run")?.addEventListener("click", async (ev) => {
      const runBtn = ev.currentTarget;
      const raw = document.getElementById("rec-broll-lib")?.value.trim() || "";
      let library;
      try {
        library = raw ? JSON.parse(raw) : { assets: [] };
      } catch (err) {
        Toast.error(`Library JSON invalid: ${err.message}`);
        return;
      }
      localStorage.setItem("strivo-broll-library", raw);
      await withBusy(runBtn, "Matching…", async () => {
        const resp = await API.brollSuggest(jobId, { library, top_k: 12 });
        const results = document.getElementById("rec-broll-results");
        if (!results) return;
        const suggestions = resp.suggestions || [];
        if (!suggestions.length) {
          results.innerHTML = '<div class="empty sm">No B-roll matches above the score threshold.</div>';
          return;
        }
        results.innerHTML = `
          <div class="rec-hl-list">
            ${suggestions
              .map(
                (s) => `<div class="rec-hl-row">
                  <button class="rec-hl-jump" data-seek="${s.time_sec}" title="Jump to ${fmtClock(s.time_sec)}">${fmtClock(s.time_sec)}</button>
                  <span class="rec-hl-score" title="Score ${s.score.toFixed(2)}">
                    <span class="rec-hl-bar" style="--rec-hl-pct:${(s.score * 100).toFixed(0)}%"></span>
                    <span>${Math.round(s.score * 100)}%</span>
                  </span>
                  <span class="rec-hl-meta" title="${htmlEscape(s.asset_path)}">${htmlEscape(s.asset_id)} · ${htmlEscape((s.matched_tags || []).join(", "))}</span>
                </div>`,
              )
              .join("")}
          </div>`;
        results.querySelectorAll(".rec-hl-jump").forEach((el) => {
          el.addEventListener("click", (e2) => {
            e2.preventDefault();
            closeRecordingModals();
            openRecordingPlayer(jobId, { seekTo: parseFloat(el.dataset.seek || "0") });
          });
        });
        Toast.success(`Found ${suggestions.length} B-roll suggestion(s)`);
      }).catch((err) => Toast.error(`B-roll suggest failed: ${err.message}`));
    });
  });

  overlay.querySelector("[data-action=rec-info-editor]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, "Loading EDL…", async () => {
      const host = document.getElementById("rec-editor");
      if (!host) return;
      let { edl, total_duration } = await API.editorLoad(jobId);
      host.hidden = false;
      // Beat-grid state lives outside paint() so it survives EDL
      // re-renders. When loaded, the strip is painted into the
      // .rec-beatgrid placeholder and Split at time… snaps to the
      // nearest beat within ±60 ms.
      let beatGridState = null; // { tempo_bpm, beats: number[], window_sec }
      // Loudness gauge per-session cache, keyed by job. The full
      // Loudness panel writes here on measure too so the topbar pill
      // and the panel stay in sync without a refetch.
      const loudnessGauge = (window.__strivoLoudnessGauge ||= new Map());
      // CE-Fusion F5: an Archive deep link's target time, consumed once —
      // the first "Split at time…" prompt pre-fills with it, then it's
      // cleared so later splits don't keep jumping back to it.
      let pendingSeekSec = opts.seekSec ?? null;

      const paint = () => {
        const dur = edl.cuts.reduce((a, c) => a + Math.max(0, c.end_sec - c.start_sec), 0);
        const sourceDur = total_duration || dur || 1;
        host.innerHTML = `
          <h4 class="rec-cp-title">EDL editor <span class="pg-cap-hint">${edl.cuts.length} cut${edl.cuts.length === 1 ? "" : "s"} · output ${fmtClock(dur)}</span></h4>
          <div class="rec-ed-actions">
            <button class="sm rec-ed-add-split" type="button">Split at time…</button>
            <button class="sm rec-ed-delete" type="button">Ripple-delete range…</button>
            <button class="sm rec-ed-deadair" type="button" title="Detect dead air (silencedetect) and trim spans longer than 6s">▢ Trim dead air…</button>
            <button class="sm rec-ed-vad" type="button" title="DAW-style voice gate — hysteresis VAD finds speech runs and ripple-deletes the natural breath gaps">▢ Voice gate…</button>
            <button class="sm rec-ed-sidechain" type="button" title="DAW sidechain — VAD voice intervals → ducking automation curve baked at render. Composes VAD + sidechain + automation in one click.">🦆 Sidechain duck…</button>
            <button class="sm rec-ed-insertfx" type="button" title="DAW insert chain — ordered HP/NR/de-esser/comp/limiter etc. Voice + game bus presets, edits persist as a single ffmpeg -af baked at render.">🎛 Insert FX…</button>
            <button class="sm rec-ed-pitch" type="button" title="Pitch / time-stretch — fit the recording to a target slot length without changing voices' pitch, or transpose a stinger without changing tempo. Wraps ffmpeg rubberband.">🎚 Pitch/time…</button>
            <button class="sm rec-ed-branding" type="button" title="Watermark + intro/outro banner overlay applied at render">★ Branding…</button>
            <button class="sm rec-ed-loudness" type="button" title="EBU R128 loudness check + per-platform normalisation target">♪ Loudness…</button>
            <button class="sm rec-ed-beatgrid" type="button" title="Beat grid — onset-detect a tempo, paint vertical guides on the EDL strip. While the grid is loaded, Split at time… snaps to the nearest beat.">🎼 Beat grid…</button>
            <button class="sm rec-ed-history" type="button" title="Revision history — revert across saves (DAW-style undo)">↺ History…</button>
            <button class="sm rec-ed-scenes" type="button" title="Scenes — Ableton-style session save/recall bundling EDL + branding + automation + loudness + captions style">🎬 Scenes…</button>
            <button class="sm rec-ed-autosnap" type="button" title="Auto-snapshot before every save — stashes a scene named 'auto-pre-save · <timestamp>' before each persist, giving you a one-click pre-edit recovery point. Setting persists across reloads.">📸 Auto-snap: <span class="rec-ed-as-state">off</span></button>
            <button class="sm rec-ed-loudgauge" type="button" title="Loudness gauge — measure EBU R128 I / TP / LRA against the YouTube target. Click to measure or refresh; reads from a per-session cache otherwise.">♪ <span class="rec-ed-lg-val">Measure</span></button>
            <button class="btn-primary rec-ed-render" type="button">⚡ Render to MKV</button>
          </div>
          <div class="rec-beatgrid" hidden></div>
          <div class="rec-branding" hidden></div>
          <div class="rec-loudness" hidden></div>
          <div class="rec-history" hidden></div>
          <div class="rec-scenes" hidden></div>
          <div class="rec-ed-list">
            ${edl.cuts
              .map(
                (c, i) => `
              <div class="rec-ed-row" data-i="${i}">
                <span class="rec-ed-idx">${i + 1}</span>
                <span class="rec-ed-kind ${htmlEscape(c.kind.kind || "source")}">${htmlEscape(c.kind.kind || "source")}</span>
                <span class="rec-ed-src">${htmlEscape((c.kind.source_path || c.kind.broll_path || "").split("/").slice(-1)[0])}</span>
                <span class="rec-ed-time">${fmtClock(c.start_sec)} → ${fmtClock(c.end_sec)} · ${fmtClock(c.end_sec - c.start_sec)}</span>
                <button class="sm rec-ed-trim" data-i="${i}" type="button" title="Trim this cut">trim</button>
                <button class="sm danger rec-ed-rm" data-i="${i}" type="button" title="Remove this cut">✕</button>
              </div>`,
              )
              .join("")}
          </div>
          <p class="pg-cap-hint">All edits are non-destructive — original recording stays intact. Render writes &lt;recording_parent&gt;/edl/&lt;id&gt;.mkv.</p>`;

        // 'Capture before' — opt-in scene auto-snapshot on every save.
        // When enabled, persist() stashes the *current* edl as a scene
        // tagged "auto-pre-save · <ISO>" before applying the new edit,
        // giving the user a one-click pre-edit recovery point.
        // Preference lives in localStorage so it survives reloads.
        const autoSnapKey = "strivo-editor-auto-snap";
        const isAutoSnapOn = () => localStorage.getItem(autoSnapKey) === "1";
        const persist = async (label) => {
          try {
            if (isAutoSnapOn()) {
              // Fire-and-forget; scene capture failure shouldn't block
              // the save the user actually asked for.
              const stamp = new Date().toISOString().replace(/[:.]/g, "-");
              API.scenesCapture(jobId, `auto-pre-save · ${stamp}`, null).catch(() => {});
            }
            await API.editorSave(jobId, edl, label);
          } catch (err) {
            Toast.error(`Save failed: ${err.message}`);
          }
        };

        // ── Beat-grid strip ───────────────────────────────────────
        // Snaps an output-timeline time to the nearest beat within
        // ±60ms. Returns the same time when no grid is loaded so
        // every caller can opt in unconditionally.
        const snapToBeat = (t) => {
          if (!beatGridState || !beatGridState.beats || !beatGridState.beats.length) return t;
          const beats = beatGridState.beats;
          // Binary search for nearest.
          let lo = 0, hi = beats.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (beats[mid] < t) lo = mid + 1; else hi = mid;
          }
          const candidates = [beats[lo]];
          if (lo > 0) candidates.push(beats[lo - 1]);
          let best = t, bestDelta = Infinity;
          for (const b of candidates) {
            const d = Math.abs(b - t);
            if (d < bestDelta) { bestDelta = d; best = b; }
          }
          return bestDelta < 0.06 ? best : t;
        };

        const paintBeatStrip = () => {
          const strip = host.querySelector(".rec-beatgrid");
          if (!strip) return;
          if (!beatGridState) { strip.hidden = true; strip.innerHTML = ""; return; }
          const { tempo_bpm, beats } = beatGridState;
          // Limit visible ticks to keep DOM cheap; thin to ~400 evenly.
          const stride = Math.max(1, Math.ceil(beats.length / 400));
          const sampled = beats.filter((_, i) => i % stride === 0);
          strip.hidden = false;
          strip.innerHTML = `
            <div class="rec-bg-head">
              <span>🎼 Tempo grid</span>
              <span class="pg-cap-hint">${tempo_bpm.toFixed(1)} BPM · ${beats.length} beat(s) over ${fmtClock(sourceDur)} · Split snaps within ±60 ms</span>
              <button class="sm rec-bg-clear" type="button" title="Hide the grid and disable snap">✕</button>
            </div>
            <div class="rec-bg-strip">${sampled.map((t) => {
              const pct = sourceDur > 0 ? (t / sourceDur) * 100 : 0;
              return `<span class="rec-bg-tick" style="left:${pct.toFixed(3)}%" title="${fmtClock(t)}"></span>`;
            }).join("")}</div>`;
          strip.querySelector(".rec-bg-clear")?.addEventListener("click", () => {
            beatGridState = null;
            paintBeatStrip();
          });
        };
        paintBeatStrip();

        // ── Loudness gauge ────────────────────────────────────────
        // Inline I / TP / LRA pill next to ⚡ Render. Reads cached
        // measurement when present; click re-measures.
        const paintLoudGauge = () => {
          const val = host.querySelector(".rec-ed-lg-val");
          const btn = host.querySelector(".rec-ed-loudgauge");
          if (!val || !btn) return;
          const c = loudnessGauge.get(jobId);
          if (!c) { val.textContent = "Measure"; btn.classList.remove("ok", "over", "under"); return; }
          val.innerHTML = `I ${c.i.toFixed(1)} <span class="pg-cap-hint">LUFS</span> · TP ${c.tp.toFixed(1)} · LRA ${c.lra.toFixed(1)}`;
          // Colour by integrated delta vs YouTube target (-14 LUFS).
          // ±1 LUFS = ok, > +1 LUFS over = clipping risk, < -1 under = quiet.
          btn.classList.remove("ok", "over", "under");
          const d = c.i_delta;
          if (Math.abs(d) <= 1.0) btn.classList.add("ok");
          else if (d > 0) btn.classList.add("over");
          else btn.classList.add("under");
          btn.title = `EBU R128 vs ${c.platform || "youtube"} target · I Δ ${d >= 0 ? "+" : ""}${d.toFixed(2)} LUFS. Click to re-measure.`;
        };
        paintLoudGauge();

        // Wire the auto-snap toggle (declared above the persist hook).
        const paintAutoSnap = () => {
          const stateEl = host.querySelector(".rec-ed-as-state");
          const btn = host.querySelector(".rec-ed-autosnap");
          if (!stateEl || !btn) return;
          const on = isAutoSnapOn();
          stateEl.textContent = on ? "on" : "off";
          btn.classList.toggle("active", on);
        };
        paintAutoSnap();
        host.querySelector(".rec-ed-autosnap")?.addEventListener("click", () => {
          const next = isAutoSnapOn() ? "0" : "1";
          localStorage.setItem(autoSnapKey, next);
          paintAutoSnap();
          Toast.success(next === "1"
            ? "Auto-snap on · next save will stash a pre-edit scene first"
            : "Auto-snap off");
        });

        host.querySelector(".rec-ed-loudgauge")?.addEventListener("click", async (e2) => {
          const gbtn = e2.currentTarget;
          await withBusy(gbtn, "Measuring…", async () => {
            const platform = "youtube";
            const r = await API.loudnessMeasure(jobId, platform);
            loudnessGauge.set(jobId, {
              i: r.measurement.input_i,
              tp: r.measurement.input_tp,
              lra: r.measurement.input_lra,
              i_delta: r.delta.i_delta,
              tp_delta: r.delta.tp_delta,
              lra_delta: r.delta.lra_delta,
              platform: r.platform,
              measured_at: Date.now(),
            });
            paintLoudGauge();
            Toast.success(`Loudness · I ${r.measurement.input_i.toFixed(2)} LUFS (Δ ${r.delta.i_delta >= 0 ? "+" : ""}${r.delta.i_delta.toFixed(2)})`);
          }).catch((err) => Toast.error(`Loudness failed: ${err.message}`));
        });

        host.querySelector(".rec-ed-beatgrid")?.addEventListener("click", async (e2) => {
          const bbtn = e2.currentTarget;
          await withBusy(bbtn, "Detecting…", async () => {
            const window_sec = Math.max(60, Math.min(3600, Math.round(sourceDur || 600)));
            const r = await API.beatDetectRun(jobId, { window_sec });
            const top = (r.tempo_candidates || [])[0];
            const beats = r.tempo_grid_secs || [];
            if (!top || !beats.length) {
              Toast.error("Beat detect returned no tempo — try a longer window or a different recording");
              return;
            }
            beatGridState = { tempo_bpm: top.bpm, beats, window_sec };
            paintBeatStrip();
            Toast.success(`Tempo locked · ${top.bpm.toFixed(1)} BPM · ${beats.length} beats. Split at time… now snaps.`);
          }).catch((err) => Toast.error(`Beat grid failed: ${err.message}`));
        });

        host.querySelector(".rec-ed-add-split")?.addEventListener("click", async () => {
          const snapHint = beatGridState ? "\n(Beat grid loaded — input will snap to the nearest beat within ±60ms.)" : "";
          const s = prompt(
            `Split at output time (HH:MM:SS or seconds):${snapHint}`,
            pendingSeekSec != null ? fmtClock(pendingSeekSec) : undefined,
          );
          pendingSeekSec = null; // consumed — later splits get a blank prompt
          if (!s) return;
          let t = parseTimeInput(s, sourceDur);
          if (!isFinite(t)) {
            Toast.error("Could not parse time");
            return;
          }
          // Beat-grid snap. No-op when the grid hasn't been detected.
          const snapped = snapToBeat(t);
          if (Math.abs(snapped - t) > 1e-6) {
            Toast.success(`Snapped to beat at ${fmtClock(snapped)}`);
            t = snapped;
          }
          // Local split — same algorithm as server. Walk and split.
          let elapsed = 0;
          for (let i = 0; i < edl.cuts.length; i++) {
            const c = edl.cuts[i];
            const cd = c.end_sec - c.start_sec;
            const out_hi = elapsed + cd;
            if (t > elapsed + 0.001 && t < out_hi - 0.001) {
              const offset = t - elapsed;
              const right = structuredClone(c);
              const newSplit = c.start_sec + offset;
              right.start_sec = newSplit;
              c.end_sec = newSplit;
              edl.cuts.splice(i + 1, 0, right);
              break;
            }
            elapsed = out_hi;
          }
          await persist("split");
          paint();
          Toast.success("Split");
        });
        host.querySelector(".rec-ed-delete")?.addEventListener("click", async () => {
          const range = prompt("Range to delete (e.g. 1:30-2:45 or 90-165):");
          if (!range) return;
          const m = range.match(/(.+?)\s*[-–]\s*(.+)/);
          if (!m) { Toast.error("Use lo-hi format"); return; }
          const lo = parseTimeInput(m[1], sourceDur);
          const hi = parseTimeInput(m[2], sourceDur);
          if (!isFinite(lo) || !isFinite(hi) || hi <= lo) {
            Toast.error("Invalid range");
            return;
          }
          // Mirror server-side delete_range — walk and trim.
          let elapsed = 0;
          const next = [];
          for (const cut of edl.cuts) {
            const cd = cut.end_sec - cut.start_sec;
            const out_lo = elapsed;
            const out_hi = elapsed + cd;
            elapsed = out_hi;
            if (out_hi <= lo || out_lo >= hi) { next.push(cut); continue; }
            if (out_lo >= lo && out_hi <= hi) { continue; }
            if (out_lo < lo && out_hi <= hi) {
              const trim = structuredClone(cut);
              trim.end_sec = cut.start_sec + (lo - out_lo);
              next.push(trim);
              continue;
            }
            if (out_lo >= lo && out_hi > hi) {
              const trim = structuredClone(cut);
              trim.start_sec = cut.start_sec + (hi - out_lo);
              next.push(trim);
              continue;
            }
            const left = structuredClone(cut);
            left.end_sec = cut.start_sec + (lo - out_lo);
            const right = structuredClone(cut);
            right.start_sec = cut.start_sec + (hi - out_lo);
            next.push(left, right);
          }
          edl.cuts = next.filter((c) => c.end_sec - c.start_sec > 0.001);
          await persist("ripple-delete");
          paint();
          Toast.success("Range deleted");
        });
        host.querySelectorAll(".rec-ed-rm").forEach((b) => {
          b.addEventListener("click", async () => {
            const i = +b.dataset.i;
            edl.cuts.splice(i, 1);
            await persist("remove cut");
            paint();
          });
        });
        host.querySelectorAll(".rec-ed-trim").forEach((b) => {
          b.addEventListener("click", async () => {
            const i = +b.dataset.i;
            const c = edl.cuts[i];
            const s = prompt(`Trim cut ${i + 1} — start..end (seconds or HH:MM:SS), e.g. "10-60"`, `${c.start_sec}-${c.end_sec}`);
            if (!s) return;
            const m = s.match(/(.+?)\s*[-–]\s*(.+)/);
            if (!m) { Toast.error("Use start-end format"); return; }
            const lo = parseTimeInput(m[1], sourceDur);
            const hi = parseTimeInput(m[2], sourceDur);
            if (!isFinite(lo) || !isFinite(hi) || hi <= lo) { Toast.error("Invalid"); return; }
            c.start_sec = lo;
            c.end_sec = hi;
            await persist("trim cut");
            paint();
          });
        });
        host.querySelector(".rec-ed-deadair")?.addEventListener("click", async (e2) => {
          const dabtn = e2.currentTarget;
          await withBusy(dabtn, "Scanning silence…", async () => {
            const r = await API.deadairDetect(jobId);
            const cuts = (r.result && r.result.recommended_cuts) || [];
            const totalTrim = (r.result && r.result.total_trim_secs) || 0;
            if (!cuts.length) {
              Toast.success(`No dead-air spans above the trim threshold detected.`);
              return;
            }
            if (!confirm(`Found ${cuts.length} dead-air span(s) totalling ${fmtClock(totalTrim)}.\n\nApply all as ripple-deletes? Edits are non-destructive — only the EDL changes.`)) return;
            // Apply each cut in DESCENDING order so prior deletes
            // don't shift later coordinates. The cut times are in
            // source-file coordinates, but our EDL initially mirrors
            // the source 1:1, so for the first apply they're
            // equivalent. After the first cut everything shifts; we
            // re-fetch the EDL before each subsequent cut to stay
            // honest about output-time coords.
            const sorted = [...cuts].sort((a, b) => b.start_sec - a.start_sec);
            for (const cut of sorted) {
              const lo = cut.start_sec;
              const hi = cut.end_sec;
              let elapsed = 0;
              const next = [];
              for (const c of edl.cuts) {
                const cd = c.end_sec - c.start_sec;
                const out_lo = elapsed;
                const out_hi = elapsed + cd;
                elapsed = out_hi;
                if (out_hi <= lo || out_lo >= hi) { next.push(c); continue; }
                if (out_lo >= lo && out_hi <= hi) { continue; }
                if (out_lo < lo && out_hi <= hi) {
                  const trim = structuredClone(c);
                  trim.end_sec = c.start_sec + (lo - out_lo);
                  next.push(trim);
                  continue;
                }
                if (out_lo >= lo && out_hi > hi) {
                  const trim = structuredClone(c);
                  trim.start_sec = c.start_sec + (hi - out_lo);
                  next.push(trim);
                  continue;
                }
                const left = structuredClone(c);
                left.end_sec = c.start_sec + (lo - out_lo);
                const right = structuredClone(c);
                right.start_sec = c.start_sec + (hi - out_lo);
                next.push(left, right);
              }
              edl.cuts = next.filter((c) => c.end_sec - c.start_sec > 0.001);
            }
            await persist("trim dead air");
            paint();
            Toast.success(`Trimmed ${cuts.length} dead-air span(s) · saved ${fmtClock(totalTrim)}.`);
          }).catch((err) => Toast.error(`Dead-air scan failed: ${err.message}`));
        });
        host.querySelector(".rec-ed-vad")?.addEventListener("click", async (e2) => {
          const vbtn = e2.currentTarget;
          const promptMin = prompt(
            "Minimum pause to KEEP between speech (sec) — gaps below this become ripple-deletes.\n" +
              "Default 1.0; lower = tighter; try 0.3 for podcast pacing.",
            "1.0",
          );
          if (promptMin == null) return;
          const minKeep = parseFloat(promptMin);
          if (!isFinite(minKeep) || minKeep < 0) { Toast.error("Invalid min_keep value"); return; }
          await withBusy(vbtn, "Scanning voice…", async () => {
            // Cap the window at 1h so a 4h archive doesn't melt the
            // host; the editor only cares about the section the user is
            // currently working on.
            const r = await API.vadAnalyze(jobId, { min_keep_sec: minKeep, window_sec: 3600 });
            const gaps = r.recommended_gaps || [];
            const savings = r.total_savings_sec || 0;
            const intervalCount = (r.voice_intervals || []).length;
            if (!gaps.length) {
              Toast.success(`Found ${intervalCount} voice run(s); no gaps above the ${minKeep}s keep threshold to tighten.`);
              return;
            }
            if (!confirm(
              `Voice gate found ${intervalCount} voice run(s) and ${gaps.length} ripple-delete candidate(s) ` +
                `(${fmtClock(savings)} of natural silence to remove).\n\n` +
                `Apply all? Edits are non-destructive — only the EDL changes.`,
            )) return;
            // Same descending-order ripple-delete loop the dead-air
            // path uses — keeps coordinate drift honest.
            const sorted = [...gaps].sort((a, b) => b.start_sec - a.start_sec);
            for (const gap of sorted) {
              const lo = gap.start_sec;
              const hi = gap.end_sec;
              let elapsed = 0;
              const next = [];
              for (const c of edl.cuts) {
                const cd = c.end_sec - c.start_sec;
                const out_lo = elapsed;
                const out_hi = elapsed + cd;
                elapsed = out_hi;
                if (out_hi <= lo || out_lo >= hi) { next.push(c); continue; }
                if (out_lo >= lo && out_hi <= hi) { continue; }
                if (out_lo < lo && out_hi <= hi) {
                  const trim = structuredClone(c);
                  trim.end_sec = c.start_sec + (lo - out_lo);
                  next.push(trim);
                  continue;
                }
                if (out_lo >= lo && out_hi > hi) {
                  const trim = structuredClone(c);
                  trim.start_sec = c.start_sec + (hi - out_lo);
                  next.push(trim);
                  continue;
                }
                const left = structuredClone(c);
                left.end_sec = c.start_sec + (lo - out_lo);
                const right = structuredClone(c);
                right.start_sec = c.start_sec + (hi - out_lo);
                next.push(left, right);
              }
              edl.cuts = next.filter((c) => c.end_sec - c.start_sec > 0.001);
            }
            await persist("voice gate");
            paint();
            Toast.success(`Voice gate · trimmed ${gaps.length} gap(s) · saved ${fmtClock(savings)}.`);
          }).catch((err) => Toast.error(`Voice-gate scan failed: ${err.message}`));
        });
        host.querySelector(".rec-ed-sidechain")?.addEventListener("click", async (e2) => {
          // One-click sidechain compressor: VAD → sidechain → automation.
          // Demonstrates the iter-46 + iter-50 + iter-41 plugin chain
          // composing in a single user gesture. The result is persisted
          // to the volume-automation store so the next ⚡ Render bakes
          // the ducking curve via the existing asendcmd pipeline.
          const sbtn = e2.currentTarget;
          const promptDuck = prompt(
            "Sidechain ducking — how many dB to drop the audio bus while voice is active?\n" +
              "Default -12 dB (podcast-natural). Try -6 dB for a gentler duck or -20 dB for voice-over.",
            "-12",
          );
          if (promptDuck == null) return;
          const duckDb = parseFloat(promptDuck);
          if (!isFinite(duckDb) || duckDb >= 0) { Toast.error("Duck depth must be < 0 dB"); return; }
          await withBusy(sbtn, "Building VAD…", async () => {
            const vad = await API.vadAnalyze(jobId, { window_sec: 3600 });
            const intervals = vad.voice_intervals || [];
            const envelopeDur = (vad.voice_intervals?.length
              ? Math.max(vad.envelope_frames * 0.05, intervals[intervals.length - 1].end_sec + 1)
              : (total_duration || dur || 0));
            if (!intervals.length) {
              Toast.success("VAD found no voice activity — nothing to duck. Try lowering open_db or raising window_sec.");
              return;
            }
            sbtn.textContent = "Sidechain…";
            const sc = await API.sidechainBuild(jobId, {
              voice_intervals: intervals,
              total_duration_sec: envelopeDur,
              knobs: { duck_db: duckDb, attack_sec: 0.05, release_sec: 0.3, hold_sec: 0.1, step_sec: 0.05 },
              persist: true,
            });
            if (!sc.persisted_to_automation_store) {
              Toast.error("Sidechain built but persistence failed — check daemon logs");
              return;
            }
            Toast.success(
              `Sidechain ready · ${intervals.length} voice run(s) → ${sc.point_count} automation point(s) ducking to ${duckDb} dB. Hit ⚡ Render to bake.`,
            );
          }).catch((err) => Toast.error(`Sidechain failed: ${err.message}`));
        });
        host.querySelector(".rec-ed-insertfx")?.addEventListener("click", async (e2) => {
          // DAW insert chain panel. Shows current stages, lets the user
          // install a voice/game preset in one click, drop individual
          // stages, then save. Each stage is one named effect mapping to
          // a single ffmpeg filter; chain composes left-to-right and
          // bakes at render via the existing -af path.
          const ibtn = e2.currentTarget;
          await withBusy(ibtn, "Loading FX…", async () => {
            const r = await API.insertFxLoad(jobId);
            const panel = host.querySelector(".rec-insertfx") || (() => {
              const d = document.createElement("div");
              d.className = "rec-insertfx";
              host.appendChild(d);
              return d;
            })();
            let chain = r.chain || { effects: [] };
            const renderStages = () => (chain.effects || []).map((eff, i) => {
              const params = Object.entries(eff)
                .filter(([k]) => k !== "kind")
                .map(([k, v]) => `${k}=${typeof v === "number" ? v : htmlEscape(String(v))}`)
                .join(" · ");
              return `<div class="rec-ifx-stage" data-i="${i}">
                <span class="rec-ifx-num">${i + 1}</span>
                <span class="rec-ifx-kind">${htmlEscape(eff.kind || "?")}</span>
                <span class="rec-ifx-params pg-cap-hint">${params}</span>
                <button class="sm danger rec-ifx-rm" type="button" title="Remove stage">✕</button>
              </div>`;
            }).join("");
            const paintFx = () => {
              panel.hidden = false;
              panel.innerHTML = `
                <h5>Insert FX chain <span class="pg-cap-hint">${(chain.effects||[]).length} stage(s)</span></h5>
                <div class="rec-ifx-presets">
                  <button class="sm rec-ifx-voice" type="button" title="HP@80 → NR → de-esser → 3:1 comp → limiter — single-mic talk-stream voice bus">🎤 Voice preset</button>
                  <button class="sm rec-ifx-game" type="button" title="HP@40 → 2:1 comp → limiter — game/music bus that won't squash dialogue">🎮 Game preset</button>
                  <button class="sm danger rec-ifx-clear" type="button" title="Empty the chain">Clear</button>
                </div>
                <div class="rec-ifx-stages">${renderStages() || '<div class="pg-cap-hint">No stages — pick a preset above or wire stages via API.</div>'}</div>
                <div class="rec-ifx-actions">
                  <button class="btn-primary rec-ifx-save" type="button">Save chain</button>
                  <span class="pg-cap-hint">Saved chains bake into one ffmpeg <code>-af</code> at render.</span>
                </div>
                <pre class="rec-ifx-filter" title="ffmpeg -af value this chain produces">${htmlEscape(r.audio_filter || chain_to_filter_preview(chain))}</pre>
              `;
              panel.querySelector(".rec-ifx-voice").addEventListener("click", async (ev) => {
                await withBusy(ev.currentTarget, "Installing voice…", async () => {
                  const res = await API.insertFxPreset(jobId, "voice");
                  chain = res.chain;
                  r.audio_filter = res.audio_filter;
                  paintFx();
                  Toast.success(`Voice bus preset installed · ${chain.effects.length} stages`);
                });
              });
              panel.querySelector(".rec-ifx-game").addEventListener("click", async (ev) => {
                await withBusy(ev.currentTarget, "Installing game…", async () => {
                  const res = await API.insertFxPreset(jobId, "game");
                  chain = res.chain;
                  r.audio_filter = res.audio_filter;
                  paintFx();
                  Toast.success(`Game bus preset installed · ${chain.effects.length} stages`);
                });
              });
              panel.querySelector(".rec-ifx-clear").addEventListener("click", () => {
                chain = { effects: [] };
                paintFx();
              });
              panel.querySelectorAll(".rec-ifx-rm").forEach((b) => {
                b.addEventListener("click", () => {
                  const idx = parseInt(b.closest(".rec-ifx-stage").dataset.i, 10);
                  chain.effects.splice(idx, 1);
                  paintFx();
                });
              });
              panel.querySelector(".rec-ifx-save").addEventListener("click", async (ev) => {
                await withBusy(ev.currentTarget, "Saving…", async () => {
                  const saved = await API.insertFxSave(jobId, chain);
                  r.audio_filter = saved.audio_filter;
                  panel.querySelector(".rec-ifx-filter").textContent = saved.audio_filter || "";
                  Toast.success(`Insert FX saved · ${saved.stage_count} stage(s) · baked at next render`);
                });
              });
            };
            // Best-effort client-side preview so the empty/cleared state
            // still shows something sensible without an extra round-trip.
            function chain_to_filter_preview(c) {
              return (c.effects || []).map((e) => `[${e.kind}]`).join(",");
            }
            paintFx();
          }).catch((err) => Toast.error(`Insert FX failed: ${err.message}`));
        });
        host.querySelector(".rec-ed-pitch")?.addEventListener("click", async (e2) => {
          // Pitch / time-stretch panel. Two independent sliders +
          // one-click 'fit to duration' that computes the tempo factor
          // to land the recording on a target publish-slot length. The
          // result composes into a rubberband= filter baked at render.
          const pbtn = e2.currentTarget;
          await withBusy(pbtn, "Loading…", async () => {
            const r = await API.pitchLoad(jobId);
            const panel = host.querySelector(".rec-pitch") || (() => {
              const d = document.createElement("div");
              d.className = "rec-pitch";
              host.appendChild(d);
              return d;
            })();
            const sourceDur = total_duration || dur || 0;
            let pt = r.pitch_time || { tempo: 1, pitch: 1, formant_preserve: true };
            const paint = () => {
              const semis = 12 * Math.log2(Math.max(pt.pitch, 1e-9));
              const projDur = pt.tempo > 0 ? sourceDur / pt.tempo : sourceDur;
              const filter = pt.tempo === 1 && pt.pitch === 1
                ? "(identity — no filter)"
                : `rubberband=tempo=${pt.tempo.toFixed(3)}:pitch=${pt.pitch.toFixed(3)}:formants=${pt.formant_preserve ? "preserved" : "shifted"}`;
              panel.hidden = false;
              panel.innerHTML = `
                <h5>Pitch / time-stretch</h5>
                <div class="rec-pt-row">
                  <label>Tempo <input class="rec-pt-tempo" type="number" step="0.01" min="0.25" max="4" value="${pt.tempo.toFixed(3)}"/>×</label>
                  <span class="pg-cap-hint">Output: ${fmtClock(projDur)} (source ${fmtClock(sourceDur)})</span>
                </div>
                <div class="rec-pt-row">
                  <label>Pitch <input class="rec-pt-semis" type="number" step="0.5" min="-24" max="24" value="${semis.toFixed(2)}"/> semitones</label>
                  <label><input type="checkbox" class="rec-pt-formants" ${pt.formant_preserve ? "checked" : ""}/> Preserve formants (voice)</label>
                </div>
                <div class="rec-pt-row">
                  <button class="sm rec-pt-fit" type="button" title="Compute the tempo factor that lands the source duration on the target. Pitch stays unchanged.">⇥ Fit to duration…</button>
                  <button class="sm rec-pt-reset" type="button" title="Reset to identity">Reset</button>
                  <button class="btn-primary rec-pt-save" type="button">Save</button>
                </div>
                <pre class="rec-pt-filter" title="ffmpeg -af value this setting bakes at render">${filter}</pre>
              `;
              const collect = () => {
                const tempo = parseFloat(panel.querySelector(".rec-pt-tempo").value) || 1;
                const semisVal = parseFloat(panel.querySelector(".rec-pt-semis").value) || 0;
                const formants = panel.querySelector(".rec-pt-formants").checked;
                return { tempo, pitch: Math.pow(2, semisVal / 12), formant_preserve: formants };
              };
              panel.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", () => {
                pt = collect();
                paint();
              }));
              panel.querySelector(".rec-pt-fit").addEventListener("click", async (ev) => {
                const targetStr = prompt(
                  `Fit to duration — target output length, in seconds.\nSource: ${fmtClock(sourceDur)} (${Math.round(sourceDur)}s).\nExample: 3600 for 1h00.`,
                  String(Math.round(sourceDur / 1.1) || 3600),
                );
                if (targetStr == null) return;
                const target = parseFloat(targetStr);
                if (!isFinite(target) || target <= 0) { Toast.error("Target must be > 0"); return; }
                await withBusy(ev.currentTarget, "Computing…", async () => {
                  const res = await API.pitchFit(jobId, sourceDur, target);
                  pt = res.pitch_time;
                  paint();
                  Toast.success(`Fit · tempo ×${pt.tempo.toFixed(3)} → output ${fmtClock(res.projected_output_duration_sec)}`);
                });
              });
              panel.querySelector(".rec-pt-reset").addEventListener("click", () => {
                pt = { tempo: 1, pitch: 1, formant_preserve: true };
                paint();
              });
              panel.querySelector(".rec-pt-save").addEventListener("click", async (ev) => {
                await withBusy(ev.currentTarget, "Saving…", async () => {
                  const res = await API.pitchSave(jobId, { pitch_time: pt, source_duration_sec: sourceDur });
                  Toast.success(res.audio_filter
                    ? `Pitch/time saved · output ≈ ${fmtClock(res.projected_output_duration_sec || projDur)}`
                    : "Pitch/time reset to identity (filter skipped at render)");
                });
              });
            };
            paint();
          }).catch((err) => Toast.error(`Pitch failed: ${err.message}`));
        });
        host.querySelector(".rec-ed-branding")?.addEventListener("click", async (e2) => {
          const bbtn = e2.currentTarget;
          await withBusy(bbtn, "Loading…", async () => {
            const r = await API.brandingLoad(jobId);
            const panel = host.querySelector(".rec-branding");
            if (!panel) return;
            const spec = r.spec || { watermark: null, banners: [] };
            const wm = spec.watermark || { source: { kind: "text", text: "", font_size: 32, color_rgba: "white" }, anchor: "bottom_right", inset_px: 24, opacity: 0.7 };
            const ANCHORS = [
              "top_left","top_center","top_right",
              "middle_left","middle_center","middle_right",
              "bottom_left","bottom_center","bottom_right",
            ];
            const anchorOpts = (sel) => ANCHORS.map((a) => `<option value="${a}"${a === sel ? " selected" : ""}>${a.replace(/_/g, " ")}</option>`).join("");
            const renderBanners = () => (spec.banners || []).map((b, i) => `
              <div class="rec-br-banner" data-i="${i}">
                <select class="rec-br-slot"><option value="intro"${b.slot==="intro"?" selected":""}>intro</option><option value="outro"${b.slot==="outro"?" selected":""}>outro</option></select>
                <input class="rec-br-text" type="text" value="${htmlEscape(b.text||"")}" placeholder="Banner text"/>
                <select class="rec-br-anchor">${anchorOpts(b.anchor)}</select>
                <input class="rec-br-dur" type="number" step="0.5" min="0.5" max="60" value="${b.duration_secs||3}" title="Visible duration (sec)"/>
                <button class="sm danger rec-br-rmb" type="button" title="Remove banner">✕</button>
              </div>`).join("");
            panel.hidden = false;
            panel.innerHTML = `
              <h5>Branding overlay</h5>
              <div class="rec-br-wm">
                <label class="rec-br-on"><input type="checkbox" class="rec-br-enabled" ${spec.watermark ? "checked" : ""}/> Watermark</label>
                <input class="rec-br-wtext" type="text" value="${htmlEscape(wm.source?.text||"@channel")}" placeholder="Watermark text"/>
                <select class="rec-br-wanchor">${anchorOpts(wm.anchor)}</select>
                <input class="rec-br-wop" type="number" step="0.05" min="0" max="1" value="${wm.opacity ?? 0.7}" title="Opacity (0–1)"/>
              </div>
              <div class="rec-br-banners">${renderBanners()}</div>
              <div class="rec-br-actions">
                <button class="sm rec-br-addb" type="button">+ Banner</button>
                <button class="btn-primary rec-br-save" type="button">Save</button>
                <span class="rec-br-preview pg-cap-hint"></span>
              </div>
              <pre class="rec-br-filter" title="filter_complex this spec produces">${htmlEscape(r.filter_complex||"")}</pre>
            `;
            const collect = () => {
              const enabled = panel.querySelector(".rec-br-enabled").checked;
              const newSpec = {
                watermark: enabled ? {
                  source: { kind: "text", text: panel.querySelector(".rec-br-wtext").value || "@channel", font_size: 32, color_rgba: "white" },
                  anchor: panel.querySelector(".rec-br-wanchor").value,
                  inset_px: 24,
                  opacity: parseFloat(panel.querySelector(".rec-br-wop").value) || 0.7,
                } : null,
                banners: Array.from(panel.querySelectorAll(".rec-br-banner")).map((row) => ({
                  slot: row.querySelector(".rec-br-slot").value,
                  text: row.querySelector(".rec-br-text").value || "",
                  font_size: 48,
                  color_rgba: "white",
                  anchor: row.querySelector(".rec-br-anchor").value,
                  inset_px: 40,
                  duration_secs: parseFloat(row.querySelector(".rec-br-dur").value) || 3,
                })),
              };
              return newSpec;
            };
            panel.querySelector(".rec-br-addb").addEventListener("click", () => {
              spec.banners = collect().banners;
              spec.banners.push({ slot: "intro", text: "Welcome", font_size: 48, color_rgba: "white", anchor: "top_center", inset_px: 40, duration_secs: 3.0 });
              panel.querySelector(".rec-br-banners").innerHTML = renderBanners();
            });
            panel.addEventListener("click", (ev) => {
              const t = ev.target;
              if (t && t.classList && t.classList.contains("rec-br-rmb")) {
                const idx = parseInt(t.closest(".rec-br-banner").dataset.i, 10);
                const next = collect();
                next.banners.splice(idx, 1);
                spec.banners = next.banners;
                spec.watermark = next.watermark;
                panel.querySelector(".rec-br-banners").innerHTML = renderBanners();
              }
            });
            panel.querySelector(".rec-br-save").addEventListener("click", async (ev) => {
              const sb = ev.currentTarget;
              const newSpec = collect();
              await withBusy(sb, "Saving…", async () => {
                const saved = await API.brandingSave(jobId, newSpec);
                panel.querySelector(".rec-br-filter").textContent = saved.filter_complex || "";
                Toast.success("Branding saved · applied at next render");
              }).catch((err) => Toast.error(`Save failed: ${err.message}`));
            });
          }).catch((err) => Toast.error(`Branding failed: ${err.message}`));
        });
        host.querySelector(".rec-ed-loudness")?.addEventListener("click", async (_e2) => {
          const panel = host.querySelector(".rec-loudness");
          if (!panel) return;
          panel.hidden = false;
          panel.innerHTML = `
            <h5>EBU R128 loudness</h5>
            <div class="rec-loud-bar">
              <label>
                <span>Target platform</span>
                <select class="rec-loud-platform">
                  <option value="youtube">YouTube · -14 LUFS</option>
                  <option value="spotify">Spotify · -14 LUFS / 7 LU</option>
                  <option value="apple_music">Apple Music · -16 LUFS</option>
                  <option value="ebu_r128">EBU R128 · -23 LUFS</option>
                  <option value="twitch">Twitch · -14 LUFS</option>
                </select>
              </label>
              <button class="btn-primary sm rec-loud-measure">▶ Measure now</button>
            </div>
            <div class="rec-loud-result"></div>
          `;
          panel.querySelector(".rec-loud-measure").addEventListener("click", async (ev) => {
            const mb = ev.currentTarget;
            const platform = panel.querySelector(".rec-loud-platform").value;
            const out = panel.querySelector(".rec-loud-result");
            out.innerHTML = `<div class="empty sm">Running ffmpeg pass-1 — this can take a minute on long captures…</div>`;
            await withBusy(mb, "Measuring…", async () => {
              try {
                const r = await API.loudnessMeasure(jobId, platform);
                const m = r.measurement;
                const d = r.delta;
                // Mirror into the topbar gauge cache.
                loudnessGauge.set(jobId, {
                  i: m.input_i, tp: m.input_tp, lra: m.input_lra,
                  i_delta: d.i_delta, tp_delta: d.tp_delta, lra_delta: d.lra_delta,
                  platform: r.platform, measured_at: Date.now(),
                });
                paintLoudGauge();
                const dRow = (label, value, target, delta, unit) => `
                  <div class="rec-loud-row">
                    <span class="rec-loud-label">${htmlEscape(label)}</span>
                    <span class="rec-loud-meas">${value.toFixed(2)} ${unit}</span>
                    <span class="rec-loud-target">target ${target.toFixed(2)} ${unit}</span>
                    <span class="rec-loud-delta ${delta >= 0 ? "over" : "under"}">${delta >= 0 ? "+" : ""}${delta.toFixed(2)} ${unit}</span>
                  </div>`;
                out.innerHTML = `
                  <p class="pg-cap-hint">Pass-1 measurement complete. Toggle 'Apply normalisation' on the next render to bake the pass-2 filter into the EDL output.</p>
                  ${dRow("Integrated (I)",       m.input_i,    r.target.i,   d.i_delta,   "LUFS")}
                  ${dRow("True peak (TP)",      m.input_tp,   r.target.tp,  d.tp_delta,  "dBTP")}
                  ${dRow("Loudness range (LRA)", m.input_lra,  r.target.lra, d.lra_delta, "LU")}
                  <details class="rec-loud-filter">
                    <summary>Pass-2 ffmpeg filter</summary>
                    <pre>${htmlEscape(r.pass2_filter)}</pre>
                  </details>`;
                Toast.success(`Measured · I=${m.input_i.toFixed(2)} LUFS (Δ ${d.i_delta >= 0 ? "+" : ""}${d.i_delta.toFixed(2)})`);
              } catch (err) {
                out.innerHTML = `<div class="empty sm">⚠ ${htmlEscape(err.message)}</div>`;
              }
            });
          });
        });
        host.querySelector(".rec-ed-history")?.addEventListener("click", async (e2) => {
          const hbtn = e2.currentTarget;
          await withBusy(hbtn, "Loading…", async () => {
            const r = await API.editorRevisions(jobId);
            const panel = host.querySelector(".rec-history");
            if (!panel) return;
            const revs = r.revisions || [];
            panel.hidden = false;
            if (!revs.length) {
              panel.innerHTML = `<p class="pg-cap-hint">No revisions yet. Edits get logged here as you go.</p>`;
              return;
            }
            panel.innerHTML = `
              <h5>Revision history <span class="pg-cap-hint">${revs.length} saved</span></h5>
              <div class="rec-hist-list">
                ${revs.map((v, i) => `
                  <div class="rec-hist-row" data-rev="${v.revision_id}">
                    <span class="rec-hist-idx">v${revs.length - i}</span>
                    <span class="rec-hist-label">${htmlEscape(v.label)}</span>
                    <span class="rec-hist-meta pg-cap-hint">${v.cut_count} cut${v.cut_count===1?"":"s"} · ${fmtClock(v.total_duration_sec)} · ${htmlEscape(v.created_at.replace("T"," ").split(".")[0])}</span>
                    <button class="sm rec-hist-restore" type="button" title="Restore this revision as the current EDL">Restore</button>
                  </div>`).join("")}
              </div>
              <p class="pg-cap-hint">Restoring appends a new revision tagged "revert to vN" so restores are themselves undoable.</p>`;
            panel.querySelectorAll(".rec-hist-restore").forEach((rb) => {
              rb.addEventListener("click", async () => {
                const revId = rb.closest(".rec-hist-row").dataset.rev;
                if (!confirm(`Restore revision v${revId}? Current EDL will become the prior state; a new revision will be appended so this restore is itself undoable.`)) return;
                await withBusy(rb, "Restoring…", async () => {
                  const res = await API.editorRevisionRestore(jobId, revId);
                  edl = res.edl;
                  paint();
                  Toast.success(`Restored · ${res.label}`);
                  // refresh the panel
                  host.querySelector(".rec-ed-history")?.click();
                }).catch((err) => Toast.error(`Restore failed: ${err.message}`));
              });
            });
          }).catch((err) => Toast.error(`History failed: ${err.message}`));
        });
        host.querySelector(".rec-ed-scenes")?.addEventListener("click", async (e2) => {
          const sbtn = e2.currentTarget;
          await withBusy(sbtn, "Loading…", async () => {
            const r = await API.scenesList(jobId);
            const panel = host.querySelector(".rec-scenes");
            if (!panel) return;
            const scenes = r.scenes || [];
            panel.hidden = false;
            const sceneRows = scenes.map((s) => `
              <div class="rec-scene-row" data-scene-id="${htmlEscape(s.id)}">
                <div class="rec-scene-head">
                  <span class="rec-scene-name">${htmlEscape(s.name)}</span>
                  <span class="rec-scene-meta pg-cap-hint">${(s.component_keys || []).length} component${(s.component_keys||[]).length===1?"":"s"} · ${formatBytes(s.size_bytes || 0)} · ${htmlEscape(s.created_at.replace("T"," ").split(".")[0])}</span>
                </div>
                <div class="rec-scene-tags">
                  ${(s.component_keys || []).map(k => `<span class="rec-scene-tag">${htmlEscape(k)}</span>`).join("")}
                </div>
                <div class="rec-scene-actions">
                  <button class="sm rec-scene-restore" type="button" title="Restore this scene as the current state">Restore</button>
                  <button class="sm danger rec-scene-delete" type="button" title="Delete this scene (irreversible)">✕</button>
                </div>
              </div>`).join("");
            panel.innerHTML = `
              <h5>Scene snapshots <span class="pg-cap-hint">${scenes.length} saved</span></h5>
              <form class="rec-scene-capture" onsubmit="return false;">
                <input class="rec-scene-name-input" type="text" placeholder="Scene name (e.g. 'v1 — main mix')" required />
                <button class="btn-primary sm rec-scene-capture-btn" type="submit">+ Capture current state</button>
              </form>
              ${sceneRows ? `<div class="rec-scene-list">${sceneRows}</div>`
                          : `<p class="pg-cap-hint">No scenes yet. Capture the current state to save EDL + branding + automation + loudness + captions style as a named bundle.</p>`}
              <p class="pg-cap-hint">Restoring writes every captured component back to its plugin's store; the EDL restore goes through the editor's revision history so it's itself undoable.</p>`;
            // Wire capture form
            const form = panel.querySelector(".rec-scene-capture");
            form.addEventListener("submit", async (ev) => {
              ev.preventDefault();
              const input = panel.querySelector(".rec-scene-name-input");
              const name = input.value.trim();
              if (!name) { Toast.error("Scene name required"); return; }
              const captureBtn = panel.querySelector(".rec-scene-capture-btn");
              await withBusy(captureBtn, "Capturing…", async () => {
                const res = await API.scenesCapture(jobId, name);
                Toast.success(`Captured · ${res.component_keys.length} component(s) · ${formatBytes(res.size_bytes || 0)}`);
                // Re-open to refresh
                host.querySelector(".rec-ed-scenes")?.click();
              }).catch((err) => Toast.error(`Capture failed: ${err.message}`));
            });
            // Wire restore per row
            panel.querySelectorAll(".rec-scene-restore").forEach((rb) => {
              rb.addEventListener("click", async () => {
                const id = rb.closest(".rec-scene-row").dataset.sceneId;
                if (!confirm("Restore this scene? Every component (EDL, branding, automation, loudness, captions style) will be overwritten with the captured state. The EDL restore is itself undoable via the History panel.")) return;
                await withBusy(rb, "Restoring…", async () => {
                  const res = await API.scenesRestore(jobId, id);
                  // Re-fetch the EDL since the restore touched the
                  // editor store; rebuild the in-memory copy so the
                  // toolbar reflects the new cut list.
                  const reloaded = await API.editorLoad(jobId);
                  edl = reloaded.edl;
                  paint();
                  Toast.success(`Restored · ${res.restored.length} component(s)${res.skipped.length ? ` · ${res.skipped.length} skipped` : ""}.`);
                }).catch((err) => Toast.error(`Restore failed: ${err.message}`));
              });
            });
            // Wire delete per row
            panel.querySelectorAll(".rec-scene-delete").forEach((db) => {
              db.addEventListener("click", async () => {
                const row = db.closest(".rec-scene-row");
                const id = row.dataset.sceneId;
                if (!confirm("Delete this scene? Irreversible.")) return;
                await withBusy(db, "Deleting…", async () => {
                  await API.scenesDelete(jobId, id);
                  row.remove();
                  Toast.success("Scene deleted");
                }).catch((err) => Toast.error(`Delete failed: ${err.message}`));
              });
            });
          }).catch((err) => Toast.error(`Scenes failed: ${err.message}`));
        });
        host.querySelector(".rec-ed-render")?.addEventListener("click", async (e2) => {
          const btnR = e2.currentTarget;
          if (!confirm(`Render EDL to MKV? ${edl.cuts.length} cut(s), total ${fmtClock(dur)}. ffmpeg pass per cut + concat.`)) return;
          await withBusy(btnR, "Rendering…", async () => {
            const res = await API.editorRender(jobId);
            Toast.success(`Rendered ${formatBytes(res.bytes)} → ${res.output_path}`);
          }).catch((err) => Toast.error(`Render failed: ${err.message}`));
        });
      };
      paint();
      Toast.success("EDL loaded");
    }).catch((err) => Toast.error(`Editor failed: ${err.message}`));
  });

  overlay.querySelector("[data-action=rec-info-casebook]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, "Composing…", async () => {
      const resp = await API.casebookFetch(jobId);
      const host = document.getElementById("rec-casebook");
      if (!host) return;
      const report = resp.report;
      const md = resp.markdown || "";
      host.hidden = false;
      const sectionHtml = (report.sections || [])
        .map(
          (s) => `<details class="rec-cb-section" open>
            <summary><span class="rec-cb-h">${htmlEscape(s.heading)}</span></summary>
            <div class="rec-cb-body">${md_to_html(s.body)}</div>
          </details>`,
        )
        .join("");
      const titlesHtml = (report.suggested_titles || [])
        .map((t) => `<li>${htmlEscape(t)}</li>`)
        .join("");
      host.innerHTML = `
        <h4 class="rec-cp-title">Casebook · ${htmlEscape(report.title || "")} <span class="pg-cap-hint">${report.sections.length} sections · ${report.suggested_titles.length} title ideas</span></h4>
        <div class="rec-cb-actions">
          <a class="pg-linkbtn" href="${htmlEscape(API.casebookMarkdownUrl(jobId))}" download>Download .md</a>
          <button class="sm rec-cb-copy" type="button">Copy markdown</button>
        </div>
        ${titlesHtml ? `<details class="rec-cb-section"><summary><span class="rec-cb-h">Suggested titles</span></summary><ul class="rec-cb-titles">${titlesHtml}</ul></details>` : ""}
        ${sectionHtml}`;
      host.querySelector(".rec-cb-copy")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(md);
          Toast.success("Markdown copied");
        } catch (_) {
          Toast.error("Couldn't copy");
        }
      });
      Toast.success(`Casebook composed (${report.sections.length} sections)`);
    }).catch((err) => Toast.error(`Casebook failed: ${err.message}`));
  });

  overlay.querySelector("[data-action=rec-info-reuse]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, "Drafting…", async () => {
      const resp = await API.reuseGenerate(jobId);
      const host = document.getElementById("rec-reuse");
      if (!host) return;
      host.hidden = false;
      const drafts = resp.drafts || [];
      if (!drafts.length) {
        host.innerHTML = '<div class="empty sm">No drafts generated.</div>';
        return;
      }
      const fmtColour = {
        youtube_long: "hsl(0, 70%, 55%)",
        youtube_short: "hsl(15, 80%, 60%)",
        tiktok: "hsl(0, 0%, 90%)",
        patreon: "hsl(20, 70%, 60%)",
        podcast: "hsl(265, 60%, 70%)",
        blog: "hsl(170, 50%, 55%)",
      };
      const fmtLabel = {
        youtube_long: "YouTube (long)",
        youtube_short: "YouTube Shorts",
        tiktok: "TikTok",
        patreon: "Patreon",
        podcast: "Podcast",
        blog: "Blog draft",
      };
      host.innerHTML = `
        <h4 class="rec-cp-title">${drafts.length} publish drafts <span class="pg-cap-hint">queued · re-run regenerates</span></h4>
        <div class="rec-ru-grid">
          ${drafts
            .map(
              (d, i) => `
            <details class="rec-ru-card" style="--ru-c:${fmtColour[d.format] || fmtColour.blog}" data-i="${i}">
              <summary>
                <span class="rec-ru-fmt">${htmlEscape(fmtLabel[d.format] || d.format)}</span>
                <span class="rec-ru-meta">${htmlEscape(d.aspect)} · ${d.duration_sec > 0 ? fmtClock(d.duration_sec) : "—"}${d.clip_starts.length ? ` · ${d.clip_starts.length} clips` : ""}</span>
              </summary>
              <div class="rec-ru-body">
                <h5>Title</h5>
                <div class="rec-ru-title">${htmlEscape(d.title)}</div>
                <h5>Description</h5>
                <pre class="rec-ru-desc">${htmlEscape(d.description)}</pre>
                ${d.hashtags.length ? `<h5>Hashtags</h5><div class="rec-ru-tags">${d.hashtags.map((t) => `<span class="cfg-badge">${htmlEscape(t)}</span>`).join("")}</div>` : ""}
                <div class="rec-ru-actions">
                  <button class="sm rec-ru-copy-title" data-i="${i}">Copy title</button>
                  <button class="sm rec-ru-copy-desc" data-i="${i}">Copy description</button>
                  ${d.hashtags.length ? `<button class="sm rec-ru-copy-tags" data-i="${i}">Copy hashtags</button>` : ""}
                </div>
              </div>
            </details>`,
            )
            .join("")}
        </div>`;
      const cp = async (text) => {
        try {
          await navigator.clipboard.writeText(text || "");
          Toast.success("Copied");
        } catch (_) {
          Toast.error("Couldn't copy");
        }
      };
      host.querySelectorAll(".rec-ru-copy-title").forEach((b) =>
        b.addEventListener("click", () => cp(drafts[+b.dataset.i].title)));
      host.querySelectorAll(".rec-ru-copy-desc").forEach((b) =>
        b.addEventListener("click", () => cp(drafts[+b.dataset.i].description)));
      host.querySelectorAll(".rec-ru-copy-tags").forEach((b) =>
        b.addEventListener("click", () => cp(drafts[+b.dataset.i].hashtags.join(" "))));
      Toast.success(`Generated ${drafts.length} draft(s)`);
    }).catch((err) => Toast.error(`Draft failed: ${err.message}`));
  });

  overlay.querySelector("[data-action=rec-info-tracks]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, "Probing…", async () => {
      const resp = await API.multitrackList(jobId);
      const host = document.getElementById("rec-tracks");
      if (!host) return;
      const tracks = resp.tracks || [];
      host.hidden = false;
      if (!tracks.length) {
        host.innerHTML = '<div class="empty sm">No audio tracks detected.</div>';
        return;
      }
      const KIND_COLOUR = {
        mic: "hsl(140, 60%, 60%)",
        game: "hsl(210, 70%, 60%)",
        discord: "hsl(265, 60%, 65%)",
        music: "hsl(35, 80%, 60%)",
        browser: "hsl(195, 60%, 60%)",
        other: "hsl(0, 0%, 65%)",
      };
      host.innerHTML = `
        <h4 class="rec-cp-title">${tracks.length} audio track${tracks.length === 1 ? "" : "s"} <span class="pg-cap-hint">${tracks.length > 1 ? "OBS-style multi-track capture" : "single mixed track"}</span></h4>
        <div class="rec-tk-list">
          ${tracks
            .map(
              (t) => `
            <div class="rec-tk-row" data-idx="${t.index}">
              <span class="rec-tk-kind" style="--rec-tk-c:${KIND_COLOUR[t.inferred_kind] || KIND_COLOUR.other}">${htmlEscape(t.inferred_kind)}</span>
              <span class="rec-tk-label">${htmlEscape(t.title || `track ${t.index}`)}</span>
              <span class="rec-tk-meta">${t.codec} · ${t.channels}ch · ${t.sample_rate ? t.sample_rate + " Hz" : "?"}</span>
              <button class="sm rec-tk-extract" data-idx="${t.index}" data-stem="${htmlEscape((t.title || `track_${t.index}`).replace(/[^A-Za-z0-9_-]+/g, "_"))}">Extract</button>
            </div>`,
            )
            .join("")}
        </div>`;
      host.querySelectorAll(".rec-tk-extract").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const b = e.currentTarget;
          await withBusy(b, "Cutting…", async () => {
            const res = await API.multitrackExtract(jobId, {
              track_index: parseInt(b.dataset.idx, 10),
              stem: b.dataset.stem,
            });
            Toast.success(`Cut ${formatBytes(res.bytes)} → ${res.output_path}`);
            b.outerHTML = `<span class="cfg-badge ok" title="${htmlEscape(res.output_path)}">✓ ${formatBytes(res.bytes)}</span>`;
          }).catch((err) => Toast.error(`Extract failed: ${err.message}`));
        });
      });
      Toast.success(`Probed ${tracks.length} track(s)`);
    }).catch((err) => Toast.error(`Probe failed: ${err.message}`));
  });
