// ── Player tile chrome ──────────────────────────────────────────────
// The populated-tile markup and its control wiring, split out of
// 018-pvr.js so the player frame can be reworked independently of the
// layout tree / drag-and-drop code that stays there.
//
// A single `.player-bar` now sits over the media box and drives whatever
// the controller for that tile can drive, hiding what it cannot. Vendor
// controls that render INSIDE a cross-origin iframe (Twitch/YouTube's own
// chrome) cannot be touched from here — that duplication is inherent to
// an embed and is not something this bar can fix.

/// Capabilities to paint from, tolerant of the legacy e2e fake controller
/// (`player-controller.spec.ts`) which predates the capability contract
/// entirely. `ctl === null` means "not yet playing" (a poster tile) —
/// volume/mute still apply (they're stored independently of any player),
/// everything else is unavailable until something is actually mounted.
function effectiveCapabilities(ctl) {
  if (!ctl) {
    return {
      play: false, pause: false, seek: false, duration: false,
      volume: true, mute: true, quality: false, rate: false,
      pip: false, fullscreen: true, live: false, audioOnly: false,
    };
  }
  if (ctl.capabilities) return ctl.capabilities;
  // Legacy fake: infer from which methods it bothered to implement.
  return {
    play: false, pause: false, seek: false, duration: false,
    volume: typeof ctl.setVolume === "function",
    mute: typeof ctl.setMuted === "function",
    quality: false, rate: false, pip: false, fullscreen: true,
    live: true, audioOnly: false,
  };
}

function renderPopulatedSlotHtml(slot, path, streams) {
  const playing = tilePlaying(slot);
  // ─ Recording playback path ─
  if (slot.recordingId) {
    const rec = recCache.find((r) => r.id === slot.recordingId);
    const title = rec ? (niceTitle(rec.stream_title) || rec.channel_name || rec.id.slice(0, 8)) : slot.recordingId.slice(0, 8);
    const channel = rec ? rec.channel_name || "" : "";
    return `
      <div class="ms-leaf ms-leaf-rec" data-path="${htmlEscape(path)}" data-recording-id="${htmlEscape(slot.recordingId)}"
           tabindex="0" data-title="${htmlEscape(title)}" data-platform="recording">
        <div class="ms-media">
          <div class="ms-mount" data-content-key="r:${htmlEscape(slot.recordingId)}"
               data-kind="recording" data-path="${htmlEscape(path)}"
               data-playing="${playing ? "1" : "0"}"
               data-src="/api/v1/recordings/${encodeURIComponent(slot.recordingId)}/download"></div>
        </div>
        <div class="player-bar" data-recording-channel="${htmlEscape(channel)}"></div>
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
    return `
      <div class="ms-leaf" data-path="${htmlEscape(path)}" data-stream-id="${htmlEscape(s.stream_id)}"
           tabindex="0" data-title="${htmlEscape(s.channel_name)}" data-platform="${htmlEscape(s.platform)}">
        <div class="ms-media">
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
        </div>
        <div class="player-bar"></div>
      </div>`;
  }
  return "";
}

// ── Player bar ────────────────────────────────────────────────────────
//
// One control surface per leaf, painted from `ctl.capabilities` (or the
// no-controller default above) EVERY time this is called — a vendor
// controller can swap its own capabilities out from under us (the
// Twitch/YouTube SDK failure fallback), so re-painting on every call
// rather than once at mount time is what keeps the bar honest.

const _playerBarUnsub = new WeakMap(); // leaf -> onState unsubscribe
const _playerBarAB = new WeakMap();    // leaf -> {a, b} loop points

function repaintPlayerStageGlobal() {
  const watch = document.getElementById("watch");
  const content = watch && watch.querySelector(".watch-content");
  if (content) paintPlayerStage(content, playerState.chatRailLastStreams || []);
}

function mountPlayerBar(leaf, ctl, { path }) {
  const bar = leaf.querySelector(".player-bar");
  if (!bar) return;

  const prevUnsub = _playerBarUnsub.get(leaf);
  if (prevUnsub) {
    try { prevUnsub(); } catch (_) { /* advisory */ }
    _playerBarUnsub.delete(leaf);
  }

  const caps = effectiveCapabilities(ctl);
  const muted = computeMuted(path);
  const volPct = Math.round(tileVolumeAt(path) * 100);
  const title = leaf.dataset.title || "";
  const platform = leaf.dataset.platform || "";
  const st = ctl && typeof ctl.state === "function" ? ctl.state() : null;

  const left = `
    <span class="pb-left">
      <span class="pb-grab icon-btn" draggable="true" data-drag-handle title="Drag to move" aria-label="Drag to move">⠿</span>
      <span class="pb-title">${htmlEscape(title)}</span>
      <span class="pb-platform pg-cap-hint">${htmlEscape(platform)}</span>
      ${leaf.dataset.streamId ? `<span class="pb-viewers pg-cap-hint" data-watch-meta="viewers"></span>` : ""}
    </span>`;

  const centerParts = [];
  if (caps.play || caps.pause) {
    centerParts.push(`<button class="icon-btn pb-play" type="button" title="Play/Pause (space)">${st && st.playing ? "❚❚" : "▶"}</button>`);
  }
  if (caps.seek && caps.duration) {
    const pct = st && Number.isFinite(st.duration) && st.duration > 0
      ? Math.round((st.currentTime / st.duration) * 1000) : 0;
    centerParts.push(`<input class="pb-seek" type="range" min="0" max="1000" step="1" value="${pct}" aria-label="Seek">`);
    centerParts.push(`<span class="pb-time pg-cap-hint">${fmtClock((st && st.currentTime) || 0)} / ${fmtClock((st && st.duration) || 0)}</span>`);
  }
  if (caps.live) centerParts.push(`<span class="pb-live-pill">● LIVE</span>`);
  const center = `<span class="pb-center">${centerParts.join("")}</span>`;

  const rightParts = [];
  if (caps.volume) {
    rightParts.push(`<input class="ms-vol" type="range" min="0" max="100" step="1"
             value="${volPct}" data-path="${htmlEscape(path)}"
             aria-label="Volume for ${htmlEscape(title)}" title="Volume — ${volPct}%">`);
  }
  if (caps.mute) {
    rightParts.push(muted
      ? `<button class="icon-btn ms-solo" title="Unmute — solo this tile" data-path="${htmlEscape(path)}">🔇</button>`
      : `<button class="icon-btn ms-unsolo" title="Mute this tile" data-path="${htmlEscape(path)}">🔊</button>`);
  }
  if (caps.quality && st) {
    const opts = (st.qualities || []).map((q) =>
      `<option value="${htmlEscape(q.id)}" ${q.id === st.quality ? "selected" : ""}>${htmlEscape(q.label)}</option>`).join("");
    if (opts) {
      rightParts.push(`<select class="pb-quality" title="Quality"><option value="auto">Auto</option>${opts}</select>`);
    }
  }
  if (caps.rate) {
    const curRate = (st && st.rate) || 1;
    rightParts.push(`<select class="pb-rate" title="Playback speed">
      ${[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => `<option value="${r}" ${r === curRate ? "selected" : ""}>${r}×</option>`).join("")}
    </select>`);
  }
  if (caps.pip) rightParts.push(`<button class="icon-btn pb-pip" type="button" title="Picture-in-picture (p)">⧉</button>`);
  rightParts.push(`<button class="icon-btn ms-fs" type="button" title="Fullscreen this tile (f)">⛶</button>`);
  rightParts.push(`<button class="icon-btn ms-remove" type="button" title="Remove from layout" data-path="${htmlEscape(path)}">✕</button>`);
  const right = `<span class="pb-right">${rightParts.join("")}</span>`;

  bar.innerHTML = left + center + right;
  bar.classList.toggle("is-live", !!caps.live);

  // ── wiring ──
  bar.querySelectorAll("input, select").forEach((el) => el.addEventListener("click", (e) => e.stopPropagation()));

  bar.querySelector(".pb-play")?.addEventListener("click", (e) => {
    e.stopPropagation();
    try { ctl && ctl.togglePlay && ctl.togglePlay(); } catch (_) { /* advisory */ }
  });

  const seekEl = bar.querySelector(".pb-seek");
  if (seekEl && ctl) {
    seekEl.addEventListener("input", (e) => {
      e.stopPropagation();
      try {
        const dur = ctl.duration();
        if (Number.isFinite(dur) && dur > 0) ctl.seek((Number(seekEl.value) / 1000) * dur);
      } catch (_) { /* advisory */ }
    });
  }

  const rateEl = bar.querySelector(".pb-rate");
  rateEl?.addEventListener("change", () => {
    try { ctl && ctl.setRate && ctl.setRate(Number(rateEl.value)); } catch (_) { /* advisory */ }
  });

  const qualityEl = bar.querySelector(".pb-quality");
  qualityEl?.addEventListener("change", () => {
    try { ctl && ctl.setQuality && ctl.setQuality(qualityEl.value); } catch (_) { /* advisory */ }
  });

  const vol = bar.querySelector(".ms-vol");
  if (vol) {
    vol.addEventListener("input", () => {
      const v = Number(vol.value) / 100;
      setTileVolumeAt(path, v);
      if (ctl) {
        try {
          ctl.setVolume(v);
          ctl.setMuted(v === 0);
        } catch (_) { /* advisory */ }
      }
      // Raising a tile focuses it, so chat and focus-aware quality follow
      // what you are actually listening to.
      if (v > 0) {
        playerState.soloPath = path;
        savePlayerLayout();
      }
    });
  }

  bar.querySelector(".ms-solo")?.addEventListener("click", (e) => {
    e.stopPropagation();
    soloTileAt(path);
    repaintPlayerStageGlobal();
  });
  bar.querySelector(".ms-unsolo")?.addEventListener("click", (e) => {
    e.stopPropagation();
    muteAllTiles();
    repaintPlayerStageGlobal();
  });

  bar.querySelector(".pb-pip")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const video = ctl && ctl.root && ctl.root.tagName === "VIDEO" ? ctl.root : null;
      if (!video) return;
      if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (err) {
      Toast.error(`Picture-in-picture failed: ${err && err.message || err}`);
    }
  });

  bar.querySelector(".ms-fs")?.addEventListener("click", (e) => {
    e.stopPropagation();
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else leaf.requestFullscreen?.();
    } catch (err) {
      Toast.error(`Fullscreen denied: ${err && err.message || err}`);
    }
  });

  bar.querySelector(".ms-remove")?.addEventListener("click", (e) => {
    e.stopPropagation();
    playerState.layout = setNodeAt(playerState.layout, path, _slot());
    savePlayerLayout();
    repaintPlayerStageGlobal();
  });

  // Live state → partial DOM updates only, so a mid-drag slider or an
  // open <select> is never clobbered by a repaint.
  if (ctl && typeof ctl.onState === "function") {
    const unsub = ctl.onState((s) => {
      const playBtn = bar.querySelector(".pb-play");
      if (playBtn) playBtn.textContent = s.playing ? "❚❚" : "▶";
      const seek = bar.querySelector(".pb-seek");
      const timeEl = bar.querySelector(".pb-time");
      if (seek && Number.isFinite(s.duration) && s.duration > 0 && document.activeElement !== seek) {
        seek.value = String(Math.round((s.currentTime / s.duration) * 1000));
      }
      if (timeEl) timeEl.textContent = `${fmtClock(s.currentTime || 0)} / ${fmtClock(s.duration || 0)}`;
    });
    _playerBarUnsub.set(leaf, unsub);
  }
}

/// Unmount a leaf's bar — drop its onState subscription. Called from the
/// controller-destroy loop so an orphaned tile doesn't leak a listener.
function unmountPlayerBar(leaf) {
  const unsub = _playerBarUnsub.get(leaf);
  if (unsub) {
    try { unsub(); } catch (_) { /* advisory */ }
    _playerBarUnsub.delete(leaf);
  }
  _playerBarAB.delete(leaf);
}

// ── Per-tile keyboard map ────────────────────────────────────────────
// Ported from the dead `wirePlayer` mpv-style keymap (032-pvr.js), now
// driven through the controller interface instead of a raw <video>.
// Every handled key stops propagation so the wall-level handler in
// 036-pvr.js (`p`, `g` prefix, `/`) never fires from a focused tile.
function wireTileKeys(leaf, getCtl) {
  leaf.addEventListener("keydown", (e) => {
    if (e.target && e.target.closest && e.target.closest("select, input")) return;
    const ctl = getCtl();
    const caps = effectiveCapabilities(ctl);
    const path = leaf.dataset.path || "";
    const k = e.key;

    const nudgeVolume = (delta) => {
      const v = Math.max(0, Math.min(1, tileVolumeAt(path) + delta));
      setTileVolumeAt(path, v);
      if (ctl) {
        try { ctl.setVolume(v); ctl.setMuted(v === 0); } catch (_) { /* advisory */ }
      }
      mountPlayerBar(leaf, ctl, { path });
    };
    const seekBy = (delta) => {
      if (!ctl || !caps.seek) return;
      try { ctl.seek(Math.max(0, (ctl.currentTime() || 0) + delta)); } catch (_) { /* advisory */ }
    };

    if (k === " " || k === "k" || k === "K") {
      try { ctl && ctl.togglePlay && ctl.togglePlay(); } catch (_) { /* advisory */ }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if ((k === "j" || k === "J") && caps.seek) { seekBy(-10); e.preventDefault(); e.stopPropagation(); return; }
    if ((k === "l" || k === "L") && caps.seek) { seekBy(10); e.preventDefault(); e.stopPropagation(); return; }
    if (k === "ArrowLeft" && caps.seek) { seekBy(-5); e.preventDefault(); e.stopPropagation(); return; }
    if (k === "ArrowRight" && caps.seek) { seekBy(5); e.preventDefault(); e.stopPropagation(); return; }
    if (k === "ArrowUp") { nudgeVolume(0.05); e.preventDefault(); e.stopPropagation(); return; }
    if (k === "ArrowDown") { nudgeVolume(-0.05); e.preventDefault(); e.stopPropagation(); return; }
    if (k === "m" || k === "M") {
      setTileVolumeAt(path, 0);
      if (ctl) { try { ctl.setVolume(0); ctl.setMuted(true); } catch (_) { /* advisory */ } }
      mountPlayerBar(leaf, ctl, { path });
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (k === "s" || k === "S") {
      soloTileAt(path);
      repaintPlayerStageGlobal();
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (k === "f" || k === "F") {
      try {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else leaf.requestFullscreen?.();
      } catch (_) { /* advisory */ }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if ((k === "p" || k === "P") && caps.pip) {
      const video = ctl && ctl.root && ctl.root.tagName === "VIDEO" ? ctl.root : null;
      if (video) {
        (document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture())
          .catch(() => {});
      }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if ((k === "i" || k === "I") && caps.seek) {
      const ab = _playerBarAB.get(leaf) || {};
      ab.a = ctl.currentTime();
      _playerBarAB.set(leaf, ab);
      e.preventDefault(); e.stopPropagation(); return;
    }
    if ((k === "o" || k === "O") && caps.seek) {
      const ab = _playerBarAB.get(leaf) || {};
      ab.b = ctl.currentTime();
      _playerBarAB.set(leaf, ab);
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (k === "c" || k === "C") {
      _playerBarAB.delete(leaf);
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (k === "," && caps.seek) {
      try { ctl.pause(); ctl.seek(Math.max(0, (ctl.currentTime() || 0) - 1 / 30)); } catch (_) { /* advisory */ }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (k === "." && caps.seek) {
      try { ctl.seek((ctl.currentTime() || 0) + 1 / 30); } catch (_) { /* advisory */ }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if ((k === "<" || k === ">") && caps.rate) {
      const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
      const st = ctl.state();
      const idx = rates.indexOf(st.rate || 1);
      const next = k === "<" ? rates[Math.max(0, idx - 1)] : rates[Math.min(rates.length - 1, idx + 1)];
      try { ctl.setRate(next); } catch (_) { /* advisory */ }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (/^[0-9]$/.test(k) && caps.seek && caps.duration) {
      try {
        const dur = ctl.duration();
        if (Number.isFinite(dur)) ctl.seek(dur * (Number(k) / 10));
      } catch (_) { /* advisory */ }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (k === "t" || k === "T") {
      // Captions: no cross-controller API exists yet (only a <video>'s
      // native textTracks would apply, and recordings rarely carry them).
      // Reserved so a future caption source has a key that already works.
      e.preventDefault(); e.stopPropagation(); return;
    }
  });
}

// A tile's PlayerController for keyboard/PiP handlers that need the
// live instance rather than a snapshot taken at wire time.
function _controllerForLeaf(leaf) {
  const node = getNodeAt(playerState.layout, leaf.dataset.path || "");
  const key = contentKeyOf(node);
  return key ? playerState.controllers.get(key) || null : null;
}

// Per-tile controls: solo/unsolo, volume, fullscreen, press-to-play,
// remove — all now painted and wired by mountPlayerBar; this wires
// what mountPlayerBar cannot (the drag-source rule, the press-to-play
// poster button, and the per-tile keymap).
function wireTileChrome(tile, ctx) {
  const { stage, watch, streams } = ctx;
  void stage;

  // Poster tiles have no controller yet — paint the bar in its
  // no-controller (volume/mute only) state.
  if (!tile.querySelector(".ms-mount")) {
    mountPlayerBar(tile, null, { path: tile.dataset.path || "" });
  }

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

  wireTileKeys(tile, () => _controllerForLeaf(tile));
}

Object.assign(TEST_HOOK_EXTENSIONS, { mountPlayerBar, effectiveCapabilities });
