// ── Crunchr ──────────────────────────────────────────────────────────
async function renderCrunchr() {
  const resp = await API.crunchrRecordings();
  root.removeAttribute("aria-busy");
  const recs = (resp && resp.recordings) || [];
  const rows = recs
    .map((r) => {
      const an = r.has_analysis
        ? '<span class="cfg-badge ok">analyzed</span>'
        : "";
      return `
        <a class="pg-row" href="#/plugins/crunchr/rec/${encodeURIComponent(r.recording_id)}">
          <span class="pg-row-main">
            <span class="pg-row-title">${htmlEscape(niceTitle(r.title) || "(untitled)")}</span>
            <span class="pg-row-sub">${htmlEscape(r.channel_name)} · ${htmlEscape(r.created_at || "")}</span>
          </span>
          <span class="pg-row-meta">
            <span class="cfg-badge status-${htmlEscape(r.status)}">${htmlEscape(r.status)}</span>
            <span class="pg-row-num">${formatCount(r.segment_count)} segs</span>
            ${an}
          </span>
        </a>`;
    })
    .join("");
  root.innerHTML = chrome(`
    ${pluginHeader("Crunchr", "Transcribed recordings. Click one to read its transcript and analysis.", "#/plugins")}
    <div class="pg-search">
      <input id="crunchr-q" type="search" placeholder="Search transcripts…"
             autocomplete="off" aria-label="Search transcripts" />
    </div>
    <div id="crunchr-search-results"></div>
    <div class="pg-list">${rows || `<div class="empty">Nothing transcribed yet.</div>
      <div class="pg-getstarted"><strong>Get started:</strong> open a finished recording's ⓘ Info on the Recordings page and click <em>Generate subtitles</em>. Transcripts land here after the run completes.</div>`}</div>
  `);
  setupChromeHandlers();

  const q = document.getElementById("crunchr-q");
  const out = document.getElementById("crunchr-search-results");
  let timer = null;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    const term = q.value.trim();
    if (!term) {
      out.innerHTML = "";
      return;
    }
    timer = setTimeout(async () => {
      try {
        const r = await API.crunchrSearch(term);
        const hits = (r && r.results) || [];
        out.innerHTML = hits.length
          ? `<div class="pg-list pg-search-hits">${hits
              .map(
                (h) => `
            <a class="pg-row" href="#/plugins/crunchr/rec/${encodeURIComponent(findRecIdForHit(recs, h))}">
              <span class="pg-row-main">
                <span class="pg-row-title">${htmlEscape(h.snippet)}</span>
                <span class="pg-row-sub">${htmlEscape(h.video_title)} · ${htmlEscape(h.channel_name)} · ${fmtClock(h.start_sec)}</span>
              </span>
            </a>`,
              )
              .join("")}</div>`
          : '<div class="empty sm">No matches.</div>';
      } catch (e) {
        out.innerHTML = `<div class="empty sm">${htmlEscape(e.message)}</div>`;
      }
    }, 220);
  });
}

// FTS rows don't carry a recording_id; match on title+channel against the
// already-loaded list so a hit links to the right transcript.
function findRecIdForHit(recs, hit) {
  const m = recs.find(
    (r) => r.title === hit.video_title && r.channel_name === hit.channel_name,
  );
  return m ? m.recording_id : "";
}

async function renderCrunchrRecording(id) {
  const d = await API.crunchrRecording(id);
  root.removeAttribute("aria-busy");
  const topics = (d.topics || [])
    .map((t) => `<span class="pg-chip">${htmlEscape(t)}</span>`)
    .join("");
  const sentiment = d.sentiment
    ? `<span class="cfg-badge sentiment-${htmlEscape(d.sentiment)}">${htmlEscape(d.sentiment)}</span>`
    : "";
  const analysis = d.summary || topics || sentiment
    ? `<section class="cfg-card">
         <h2 class="cfg-title">Analysis ${sentiment}</h2>
         ${d.summary ? `<p class="pg-summary">${htmlEscape(d.summary)}</p>` : ""}
         ${topics ? `<div class="pg-chips">${topics}</div>` : ""}
       </section>`
    : "";

  const segments = d.segments || [];
  // Build the set of distinct speakers for the filter chip row.
  const speakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))].sort();
  // Group consecutive same-speaker lines into a single block (Descript-
  // style readability). Each block keeps the seek timestamp of its
  // first line; its `lines` keep their own timestamps for line-level
  // click-to-seek inside the block.
  const blocks = [];
  for (const seg of segments) {
    const top = blocks[blocks.length - 1];
    if (top && top.speaker === seg.speaker) {
      top.lines.push(seg);
    } else {
      blocks.push({ speaker: seg.speaker, lines: [seg] });
    }
  }
  // Speaker chip colours — deterministic per speaker name so the same
  // person stays the same colour across reloads / recordings.
  const speakerColour = (name) => {
    if (!name) return "#888";
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return `hsl(${Math.abs(h) % 360}, 55%, 65%)`;
  };

  const chipsRow = speakers.length
    ? `<div class="cr-chips" id="cr-chips">
        <button class="cr-chip is-active" data-spk="" type="button">all</button>
        ${speakers
          .map(
            (s) =>
              `<button class="cr-chip is-active" data-spk="${htmlEscape(s)}" style="--cr-spk:${speakerColour(s)}" type="button"><span class="cr-chip-dot"></span>${htmlEscape(s)}</button>`,
          )
          .join("")}
      </div>`
    : "";

  const blockHtml = blocks
    .map((b) => {
      const colour = speakerColour(b.speaker);
      const firstStart = b.lines[0]?.start_sec ?? 0;
      const linesHtml = b.lines
        .map(
          (line) =>
            `<span class="cr-line" data-seek="${line.start_sec ?? 0}" title="Open player at ${fmtClock(line.start_sec)}">${htmlEscape(line.text)}</span>`,
        )
        .join(" ");
      return `<div class="cr-block" data-spk="${htmlEscape(b.speaker || "")}">
        <div class="cr-block-meta">
          <button class="cr-block-jump" data-seek="${firstStart}" title="Jump to ${fmtClock(firstStart)}">${fmtClock(firstStart)}</button>
          ${b.speaker ? `<span class="cr-block-spk" style="--cr-spk:${colour}"><span class="cr-spk-dot"></span>${htmlEscape(b.speaker)}</span>` : ""}
        </div>
        <div class="cr-block-body">${linesHtml}</div>
      </div>`;
    })
    .join("");

  root.innerHTML = chrome(`
    ${pluginHeader(d.title || "Transcript", `${htmlEscape(d.channel_name)} · ${htmlEscape(d.status)}`, "#/plugins/crunchr")}
    <div class="pg-verbs">
      <button id="retranscribe" data-rec="${htmlEscape(d.recording_id)}">↻ Re-transcribe</button>
      <a class="pg-linkbtn" href="#/plugins/insights/rec/${encodeURIComponent(d.recording_id)}">View insights →</a>
      <button id="cr-export-vtt" class="pg-linkbtn" type="button">Export .vtt</button>
      <button id="cr-export-md" class="pg-linkbtn" type="button">Copy as markdown</button>
      <button id="cr-chapters" class="pg-linkbtn" type="button" title="Generate YouTube/Twitch chapter markers from the transcript">Generate chapters</button>
      <button id="cr-brandsafe" class="pg-linkbtn" type="button" title="Pre-publish brand-safety scan (slurs / profanity / restricted games / music mentions)">⚠ Brand-safety scan</button>
      <div class="cr-caption-export">
        <span class="cr-caption-label">Captions:</span>
        <a class="pg-linkbtn" download="${htmlEscape((d.recording_id || "recording") + ".srt")}" href="${htmlEscape(API.captionsExportUrl(d.recording_id, "srt", "en"))}">.srt</a>
        <a class="pg-linkbtn" download="${htmlEscape((d.recording_id || "recording") + ".vtt")}" href="${htmlEscape(API.captionsExportUrl(d.recording_id, "vtt", "en"))}">.vtt</a>
        <a class="pg-linkbtn" download="${htmlEscape((d.recording_id || "recording") + ".txt")}" href="${htmlEscape(API.captionsExportUrl(d.recording_id, "txt", "en"))}">.txt</a>
        <select id="cr-caption-lang" title="Target language (translation backend ships in a follow-up; today returns identity)">
          <option value="en">en (identity)</option>
          <option value="es">es</option>
          <option value="pt">pt</option>
          <option value="ja">ja</option>
          <option value="de">de</option>
          <option value="fr">fr</option>
        </select>
      </div>
    </div>
    <section class="cfg-card" id="cr-chapters-card" hidden>
      <h2 class="cfg-title">Chapters</h2>
      <p class="pg-cap-hint">Heuristic chapter markers derived from the transcript topic-shift. Paste straight into a YouTube/Twitch description.</p>
      <div class="cr-chapters-list" id="cr-chapters-list"></div>
      <details class="cr-chapters-block"><summary>Description block</summary><pre id="cr-chapters-pre"></pre></details>
      <div class="cr-chapters-actions">
        <button id="cr-chapters-copy" class="pg-linkbtn" type="button">Copy</button>
      </div>
    </section>
    ${analysis}
    <section class="cfg-card" id="cr-heatmap-card" hidden>
      <h2 class="cfg-title">Heatmap <span class="pg-cap-hint">talk · action · highlight · brand-safety (anti-signal)</span></h2>
      <div id="cr-heatmap-strip"></div>
      <div id="cr-heatmap-top"></div>
    </section>
    <section class="cfg-card" id="cr-brandsafe-card" hidden>
      <h2 class="cfg-title">Brand-safety verdicts <span id="cr-brandsafe-count"></span></h2>
      <div id="cr-brandsafe-list"></div>
    </section>
    <section class="cfg-card">
      <h2 class="cfg-title">Transcript <span class="pg-cap-hint">${speakers.length} speaker${speakers.length === 1 ? "" : "s"} · ${blocks.length} block${blocks.length === 1 ? "" : "s"}</span></h2>
      <div class="cr-retention" id="cr-retention" hidden></div>
      ${chipsRow}
      <div class="pg-transcript cr-transcript">${blockHtml || '<div class="empty sm">No segments — transcription may still be running.</div>'}</div>
    </section>
  `);
  // Lazy multi-signal heatmap — surfaces alongside the existing
  // retention curve below. Pulls cuepoints/highlights/brandsafe from
  // their caches; no second ffmpeg pass required.
  if (d.recording_id) {
    API.heatmapCompute(d.recording_id, 30).then((resp) => {
      const card = document.getElementById("cr-heatmap-card");
      const strip = document.getElementById("cr-heatmap-strip");
      const topHost = document.getElementById("cr-heatmap-top");
      if (!card || !strip || !topHost) return;
      const buckets = resp.buckets || [];
      if (!buckets.length) return;
      const dur = resp.duration_sec || 1;
      const bandRow = (key, label, colour) => {
        const bars = buckets
          .map((b) => `<span class="cr-hm-cell" style="--cr-hm-h:${Math.round(b[key] * 100)}%;--cr-hm-c:${colour};" title="${fmtClock(b.bucket_start)} · ${label} ${(b[key] * 100).toFixed(0)}%"></span>`)
          .join("");
        return `<div class="cr-hm-row"><span class="cr-hm-label">${htmlEscape(label)}</span><div class="cr-hm-bars">${bars}</div></div>`;
      };
      const fusedRow = `<div class="cr-hm-row cr-hm-row-fused"><span class="cr-hm-label"><strong>fused</strong></span><div class="cr-hm-bars">${buckets
        .map((b) => `<a class="cr-hm-cell cr-hm-fused-bar" data-seek="${b.bucket_start}" href="#" style="--cr-hm-h:${Math.round(b.fused * 100)}%;--cr-hm-hue:${200 - Math.round((b.highlight - b.brandsafe) * 60)};" title="${fmtClock(b.bucket_start)} · retention ${(b.fused * 100).toFixed(0)}%"></a>`)
        .join("")}</div></div>`;
      strip.innerHTML = `
        ${bandRow("talk", "talk", "hsl(200, 70%, 55%)")}
        ${bandRow("action", "action", "hsl(40, 80%, 60%)")}
        ${bandRow("highlight", "highlight", "hsl(120, 60%, 55%)")}
        ${bandRow("brandsafe", "brandsafe", "hsl(0, 70%, 60%)")}
        ${fusedRow}
        <div class="rec-cp-axis"><span>0:00</span><span>${fmtClock(dur)}</span></div>`;
      const top = (resp.top_k || []).map(
        (b) => `<a class="cr-hm-top" href="#" data-seek="${b.bucket_start}">${fmtClock(b.bucket_start)} <span>${(b.fused * 100).toFixed(0)}%</span></a>`,
      );
      topHost.innerHTML = top.length
        ? `<h5 class="ins-cmp-h">Top moments</h5><div class="cr-hm-top-row">${top.join("")}</div>`
        : "";
      strip.querySelectorAll(".cr-hm-fused-bar, .cr-hm-top").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          seek(parseFloat(el.dataset.seek || "0"));
        });
      });
      // Deep-link action: hand the recording's retention buckets to
      // the schedule-optimizer so the user can ask 'when should I
      // publish a stream that retains people like this one?'.
      const actionRow = document.createElement("div");
      actionRow.className = "cr-hm-actions";
      actionRow.innerHTML = `<button class="sm cr-hm-to-sopt" type="button" title="Map this recording's fused retention buckets to (DoW, hour) engagement samples and open the schedule optimizer pre-loaded with them.">↘ Send to schedule optimizer</button>`;
      topHost.appendChild(actionRow);
      actionRow.querySelector(".cr-hm-to-sopt")?.addEventListener("click", async () => {
        try {
          // Look up the recording's started_at from the global list so
          // the heatmap-bucket → wall-clock mapping is accurate.
          const list = await API.recordings();
          const recs = list.recordings || list.items || [];
          const rec = recs.find((x) => x.id === d.recording_id);
          if (!rec || !rec.started_at) {
            Toast.error("No started_at on this recording — can't map buckets to wall-clock cells");
            return;
          }
          const samples = heatmapBucketsToSamples(buckets, Date.parse(rec.started_at) || 0);
          if (!samples.length) {
            Toast.error("Heatmap buckets produced no engagement samples");
            return;
          }
          stashOptimizerPrefill(samples, `heatmap of ${rec.stream_title || rec.id.slice(0, 8)}`);
          location.hash = "#/plugins/schedule-optimizer";
        } catch (err) {
          Toast.error(`Deep-link failed: ${err.message}`);
        }
      });
      card.hidden = false;
    }).catch(() => {});
  }

  // Lazy retention curve — async so the transcript paints first.
  if (d.recording_id) {
    API.insightsRetention(d.recording_id, 30).then((retention) => {
      const host = document.getElementById("cr-retention");
      if (!host || !retention || !retention.points || !retention.points.length) return;
      const dur = retention.duration_sec || 1;
      // Compose a sparkline-ish strip: each bucket is a vertical bar
      // whose height encodes retention and whose hue carries the
      // talk/action mix (cyan-ish for talk-heavy, magenta-ish for
      // action-heavy). Click any bar → seek the (future) player.
      const bars = retention.points
        .map((p) => {
          const pct = Math.max(0, Math.min(1, p.retention || 0));
          const hue = 200 - Math.round((p.action_density - p.talk_density) * 60);
          return `<a class="cr-ret-bar" href="#" data-seek="${p.bucket_start}" title="${fmtClock(p.bucket_start)} · retention ${(pct * 100).toFixed(0)}%" style="--ret-h:${(pct * 100).toFixed(0)}%; --ret-hue:${hue}"></a>`;
        })
        .join("");
      host.hidden = false;
      host.innerHTML = `
        <div class="cr-ret-head">
          <span>Retention proxy</span>
          <span class="pg-cap-hint">${retention.points.length} buckets · ${retention.bucket_secs}s each · talk + cuepoint density</span>
        </div>
        <div class="cr-ret-strip" role="img" aria-label="Retention curve">${bars}</div>
        <div class="rec-cp-axis"><span>0:00</span><span>${fmtClock(dur)}</span></div>`;
      host.querySelectorAll(".cr-ret-bar").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          seek(parseFloat(el.dataset.seek || "0"));
        });
      });
    }).catch(() => {});
  }
  setupChromeHandlers();

  const btn = document.getElementById("retranscribe");
  if (btn) {
    btn.addEventListener("click", () =>
      dispatchVerb("crunchr", "Re-transcribe", [btn.dataset.rec], btn),
    );
  }

  // Click any line/jump → open the recording player at that timestamp.
  // openRecordingPlayer reads a `seekTo` argument and the player binds
  // it in the next iteration when we extend the player.
  const seek = (sec) => {
    if (!d.recording_id) return;
    openRecordingPlayer(d.recording_id, { seekTo: sec });
  };
  document.querySelectorAll(".cr-line, .cr-block-jump").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      seek(parseFloat(el.dataset.seek || "0"));
    });
  });

  // Speaker filter — toggling a chip hides blocks not matching the
  // active speaker set. "all" is the reset.
  document.getElementById("cr-chips")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".cr-chip");
    if (!btn) return;
    const chips = [...document.querySelectorAll(".cr-chip")];
    if (btn.dataset.spk === "") {
      chips.forEach((c) => c.classList.add("is-active"));
    } else {
      btn.classList.toggle("is-active");
      const allChip = chips.find((c) => c.dataset.spk === "");
      if (allChip) allChip.classList.toggle("is-active", false);
    }
    const active = new Set(
      chips
        .filter((c) => c.classList.contains("is-active") && c.dataset.spk)
        .map((c) => c.dataset.spk),
    );
    const showAll = chips.find((c) => c.dataset.spk === "" && c.classList.contains("is-active"));
    document.querySelectorAll(".cr-block").forEach((blk) => {
      const visible = showAll || active.size === 0 || active.has(blk.dataset.spk);
      blk.classList.toggle("cr-block-hidden", !visible);
    });
  });

  // .vtt export — bake segments into a WebVTT file and trigger download.
  document.getElementById("cr-export-vtt")?.addEventListener("click", () => {
    const lines = ["WEBVTT", ""];
    const fmtVtt = (sec) => {
      const ms = Math.max(0, Math.round((sec ?? 0) * 1000));
      const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
      const m = String(Math.floor((ms / 60_000) % 60)).padStart(2, "0");
      const s = String(Math.floor((ms / 1000) % 60)).padStart(2, "0");
      const f = String(ms % 1000).padStart(3, "0");
      return `${h}:${m}:${s}.${f}`;
    };
    segments.forEach((s, i) => {
      const start = fmtVtt(s.start_sec);
      const end = fmtVtt(s.end_sec ?? (s.start_sec ?? 0) + 5);
      lines.push(String(i + 1), `${start} --> ${end}`);
      lines.push(s.speaker ? `<v ${s.speaker}>${s.text}` : s.text, "");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/vtt" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(d.title || "transcript").replace(/[\\/:*?"<>|]/g, "_")}.vtt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    Toast.success("WebVTT exported");
  });

  // Caption language selector — rewrites the .srt/.vtt/.txt URLs so a
  // change reflects in all three download links. Identity-only today
  // (Pro plugin backend ships in a follow-up).
  document.getElementById("cr-caption-lang")?.addEventListener("change", (e) => {
    const lang = e.target.value;
    document
      .querySelectorAll(".cr-caption-export a[download]")
      .forEach((a) => {
        const fmt = a.textContent.replace(".", "");
        a.href = API.captionsExportUrl(d.recording_id, fmt, lang);
      });
  });

  // Brandsafe scan — runs the scanners, renders verdicts.
  document.getElementById("cr-brandsafe")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, "Scanning…", async () => {
      const resp = await API.brandsafeScan(d.recording_id);
      const verdicts = resp.verdicts || [];
      const card = document.getElementById("cr-brandsafe-card");
      const list = document.getElementById("cr-brandsafe-list");
      const count = document.getElementById("cr-brandsafe-count");
      if (!card || !list || !count) return;
      card.hidden = false;
      count.innerHTML = verdicts.length
        ? `<span class="pg-cap-hint">${verdicts.length} verdict${verdicts.length === 1 ? "" : "s"} · category "${htmlEscape(resp.category)}"</span>`
        : '<span class="cfg-badge ok">all clear</span>';
      if (!verdicts.length) {
        list.innerHTML = '<div class="empty sm">No content-safety risks detected. Scan covers slurs, profanity, restricted game categories, and music mentions.</div>';
        return;
      }
      const sevColour = {
        critical: "hsl(0, 80%, 60%)",
        high: "hsl(20, 80%, 60%)",
        medium: "hsl(40, 80%, 60%)",
        low: "hsl(200, 60%, 60%)",
      };
      list.innerHTML = verdicts
        .map(
          (v) => `
        <div class="cr-bs-row sev-${htmlEscape(v.severity)}" style="--bs-c:${sevColour[v.severity] || sevColour.low}">
          <span class="cr-bs-sev">${htmlEscape(v.severity)}</span>
          <div class="cr-bs-body">
            <div class="cr-bs-head">
              <span class="cr-bs-kind">${htmlEscape(v.kind.replace(/_/g, " "))}</span>
              ${v.platform ? `<span class="mon-plat plat-${htmlEscape(v.platform.toLowerCase())}">${htmlEscape(v.platform)}</span>` : ""}
              ${typeof v.at_sec === "number" ? `<button class="cr-bs-jump" data-seek="${v.at_sec}">${fmtClock(v.at_sec)}</button>` : ""}
            </div>
            <div class="cr-bs-snippet">${htmlEscape(v.snippet)}</div>
            <div class="cr-bs-fix">${htmlEscape(v.fix_hint)}</div>
          </div>
        </div>`,
        )
        .join("");
      list.querySelectorAll(".cr-bs-jump").forEach((el) => {
        el.addEventListener("click", () => seek(parseFloat(el.dataset.seek || "0")));
      });
      Toast.success(`Scan complete: ${verdicts.length} verdict(s)`);
    }).catch((err) => Toast.error(`Brand-safety scan failed: ${err.message}`));
  });

  // Chapters — POST to /api/v1/plugins/chapters/<id>, render the result.
  document.getElementById("cr-chapters")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, "Generating…", async () => {
      const resp = await API.chaptersGenerate(d.recording_id);
      const card = document.getElementById("cr-chapters-card");
      const list = document.getElementById("cr-chapters-list");
      const pre = document.getElementById("cr-chapters-pre");
      if (!card || !list || !pre) return;
      list.innerHTML = (resp.chapters || [])
        .map(
          (c) =>
            `<a class="cr-chapter" href="#" data-seek="${c.start_sec}"><span class="cr-chapter-time">${fmtClock(c.start_sec)}</span><span class="cr-chapter-title">${htmlEscape(c.title)}</span></a>`,
        )
        .join("") || '<div class="empty sm">No chapter boundaries detected.</div>';
      pre.textContent = resp.description || "";
      card.hidden = false;
      list.querySelectorAll(".cr-chapter").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          seek(parseFloat(el.dataset.seek || "0"));
        });
      });
      document.getElementById("cr-chapters-copy")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(resp.description || "");
          Toast.success("Description copied");
        } catch (_) {
          Toast.error("Couldn't copy");
        }
      });
      Toast.success(`Generated ${(resp.chapters || []).length} chapter(s)`);
    }).catch((err) => Toast.error(`Chapters failed: ${err.message}`));
  });

  // Markdown export — copy to clipboard, ready to paste into a notes
  // app / show notes draft / Casebook plugin (iter 12).
  document.getElementById("cr-export-md")?.addEventListener("click", async () => {
    const md = blocks
      .map((b) => {
        const head = `**[${fmtClock(b.lines[0].start_sec)}] ${b.speaker || "—"}**`;
        const body = b.lines.map((l) => l.text).join(" ");
        return `${head}\n\n${body}`;
      })
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(md);
      Toast.success("Markdown copied to clipboard");
    } catch (e) {
      Toast.error("Couldn't copy to clipboard");
    }
  });
}
