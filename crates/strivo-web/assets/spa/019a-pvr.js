// ── Player tile chrome ──────────────────────────────────────────────
// The populated-tile markup and its control wiring, split out of
// 018-pvr.js so the player frame can be reworked independently of the
// layout tree / drag-and-drop code that stays there. Moved verbatim;
// no behaviour change in this split.

function renderPopulatedSlotHtml(slot, path, streams) {
  const muted = computeMuted(path);
  const playing = tilePlaying(slot);
  // ─ Recording playback path ─
  if (slot.recordingId) {
    const rec = recCache.find((r) => r.id === slot.recordingId);
    const title = rec ? (niceTitle(rec.stream_title) || rec.channel_name || rec.id.slice(0, 8)) : slot.recordingId.slice(0, 8);
    const channel = rec ? rec.channel_name || "" : "";
    const soloBtn = muted
      ? `<button class="watch-tile-btn ms-solo" title="Unmute this clip" data-path="${htmlEscape(path)}">🔇</button>`
      : `<button class="watch-tile-btn ms-unsolo" title="Mute" data-path="${htmlEscape(path)}">🔊</button>`;
    return `
      <div class="ms-leaf ms-leaf-rec" data-path="${htmlEscape(path)}" data-recording-id="${htmlEscape(slot.recordingId)}">
        <div class="watch-tile-head">
          <span class="watch-tile-name">${htmlEscape(title)}</span>
          <span class="watch-tile-meta">
            <span class="watch-tile-plat pg-cap-hint">${htmlEscape(channel)} · recording</span>
            ${soloBtn}
            <button class="watch-tile-btn ms-fs" title="Fullscreen this tile">⛶</button>
            <button class="watch-tile-btn ms-remove" title="Remove from layout" data-path="${htmlEscape(path)}">✕</button>
          </span>
        </div>
        <div class="ms-mount" data-content-key="r:${htmlEscape(slot.recordingId)}"
             data-kind="recording" data-path="${htmlEscape(path)}"
             data-playing="${playing ? "1" : "0"}"
             data-src="/api/v1/recordings/${encodeURIComponent(slot.recordingId)}/download"></div>
      </div>`;
  }
  // ─ Live stream path ─
  if (slot.streamId) {
    const s = streams.find((x) => x.stream_id === slot.streamId);
    if (!s) {
      return `
        <div class="ms-leaf ms-empty" data-path="${htmlEscape(path)}">
          <div class="ms-empty-pill">Stream offline · drag a live channel here</div>
        </div>`;
    }
    const soloBtn = muted
      ? `<button class="watch-tile-btn ms-solo" title="Solo — raise this tile, silence the rest" data-path="${htmlEscape(path)}">🔇</button>`
      : `<button class="watch-tile-btn ms-unsolo" title="Silence every tile" data-path="${htmlEscape(path)}">🔊</button>`;
    // Per-tile level, so two streams can run at different volumes rather
    // than only one-audible or all-silent.
    const volPct = Math.round(tileVolumeAt(path) * 100);
    const volCtl = `<input class="ms-vol" type="range" min="0" max="100" step="1"
             value="${volPct}" data-path="${htmlEscape(path)}"
             aria-label="Volume for ${htmlEscape(s.channel_name)}"
             title="Volume — ${volPct}%">`;
    return `
      <div class="ms-leaf" data-path="${htmlEscape(path)}" data-stream-id="${htmlEscape(s.stream_id)}">
        <div class="watch-tile-head">
          <span class="watch-tile-name">${htmlEscape(s.channel_name)}</span>
          <span class="watch-tile-meta">
            <span class="watch-tile-plat pg-cap-hint" data-watch-meta="plat">${htmlEscape(s.platform)}${s.viewer_count != null ? ` · <span data-watch-meta="viewers">${formatCount(s.viewer_count)}</span>` : ""}</span>
            ${volCtl}
            ${soloBtn}
            <button class="watch-tile-btn ms-fs" title="Fullscreen this tile">⛶</button>
            <button class="watch-tile-btn ms-remove" title="Remove from layout" data-path="${htmlEscape(path)}">✕</button>
          </span>
        </div>
        ${playing
          ? `<div class="ms-mount" data-content-key="s:${htmlEscape(s.stream_id)}"
                  data-kind="${isYouTubePlatform(s.platform) ? "youtube" : "twitch"}"
                  data-path="${htmlEscape(path)}" data-playing="1"
                  ${s.video_id ? `data-video-id="${htmlEscape(s.video_id)}"` : ""}
                  data-embed-base="${htmlEscape(s.embed_url)}"></div>`
          : `<div class="ms-poster" data-embed-base="${htmlEscape(s.embed_url)}">
               ${tilePosterUrl(s) ? `<img class="ms-poster-img" loading="lazy" alt="" src="${htmlEscape(tilePosterUrl(s))}" onerror="this.remove()">` : ""}
               <button class="ms-play" data-path="${htmlEscape(path)}" title="Play ${htmlEscape(s.channel_name)}"
                       aria-label="Play ${htmlEscape(s.channel_name)}">▶</button>
             </div>`}
      </div>`;
  }
  return "";
}

// Per-tile controls: solo/unsolo, volume, fullscreen, press-to-play, remove.
// `ctx` carries the stage + watch root + stream list the handlers repaint with.
function wireTileChrome(tile, ctx) {
  const { stage, watch, streams } = ctx;
  void stage;
  // Solo / unsolo / fs / remove buttons.
  tile.querySelector(".ms-solo")?.addEventListener("click", (e) => {
    e.stopPropagation();
    soloTileAt(tile.dataset.path || "");
    paintPlayerStage(watch, streams);
  });
  tile.querySelector(".ms-unsolo")?.addEventListener("click", (e) => {
    e.stopPropagation();
    muteAllTiles();
    paintPlayerStage(watch, streams);
  });
  // Per-tile level. Applied straight to the controller so dragging the
  // slider is audible immediately rather than after a repaint.
  const vol = tile.querySelector(".ms-vol");
  if (vol) {
    vol.addEventListener("click", (e) => e.stopPropagation());
    vol.addEventListener("input", () => {
      const path = tile.dataset.path || "";
      const v = Number(vol.value) / 100;
      setTileVolumeAt(path, v);
      const key = contentKeyOf(getNodeAt(playerState.layout, path));
      const ctl = key && playerState.controllers.get(key);
      if (ctl) {
        try {
          ctl.setVolume(v);
          ctl.setMuted(v === 0);
        } catch (_) {
          /* advisory */
        }
      }
      // Raising a tile focuses it, so chat and focus-aware quality follow
      // what you are actually listening to.
      if (v > 0) playerState.soloPath = path;
    });
  }
  tile.querySelector(".ms-fs")?.addEventListener("click", (e) => {
    e.stopPropagation();
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else tile.requestFullscreen?.();
    } catch (err) {
      Toast.error(`Fullscreen denied: ${err && err.message || err}`);
    }
  });
  // Press-to-play on a paused tile. Starting one tile does not start the
  // wall — that is the whole point of opening paused.
  tile.querySelector(".ms-play")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const path = e.currentTarget.dataset.path || "";
    setTilePlaying(getNodeAt(playerState.layout, path), true);
    // Playing state is not part of the layout tree, so the shape-diffing
    // patch path cannot see this change — force the full paint. That is
    // cheap now: the repaint re-parents existing players instead of
    // rebuilding them, so starting one tile does not disturb the others.
    playerState.lastPaintedLayout = null;
    paintPlayerStage(watch, streams);
  });
  tile.querySelector(".ms-remove")?.addEventListener("click", (e) => {
    e.stopPropagation();
    playerState.layout = setNodeAt(playerState.layout, tile.dataset.path || "", _slot());
    savePlayerLayout();
    paintPlayerStage(watch, streams);
  });
}
