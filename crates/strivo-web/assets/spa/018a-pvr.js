/// Local recording playback. A `<video>` already has a real API, so this
/// never needed the reload workaround — it is a controller purely so the
/// reconciler can treat every tile the same way, and so a repaint stops
/// dropping playback position on the floor.
function makeRecordingController(spec) {
  const el = document.createElement("video");
  el.className = "watch-tile-iframe ms-video";
  el.controls = false;
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
  let watchdog = null;
  let errorNote = null;
  let loadingRequested = false;
  const clearFailure = () => {
    delete el.dataset.failed;
    errorNote?.remove();
    errorNote = null;
  };
  const cancelWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };
  const startWatchdog = () => {
    cancelWatchdog();
    if (!loadingRequested) return;
    watchdog = setTimeout(() => {
      if (loadingRequested && el.isConnected && el.readyState === 0) {
        fail("loading", "it never returned media metadata");
      }
    }, 15000);
  };
  const fail = (kind, why) => {
    if (el.dataset.failed === kind) return;
    cancelWatchdog();
    el.dataset.failed = kind;
    errorNote?.remove();
    const note = document.createElement("div");
    note.className = "ms-media-error";
    note.innerHTML =
      `<strong>Can't play this recording</strong><span>${htmlEscape(why)}</span>` +
      (kind === "decode" ? `<span class="pg-cap-hint">The file may need repair or remuxing.</span>` : "") +
      `<button type="button" class="btn btn-ghost btn-sm">Retry</button>`;
    note.querySelector("button")?.addEventListener("click", () => {
      clearFailure();
      loadingRequested = true;
      el.load();
      startWatchdog();
      el.play().catch(() => {});
    });
    el.parentElement?.appendChild(note);
    errorNote = note;
  };
  el.addEventListener("error", () => {
    const codes = {
      1: ["aborted", "playback was aborted"],
      2: ["network", "a network error interrupted playback"],
      3: ["decode", "the file could not be decoded"],
      4: ["unsupported", "this format is not supported by this browser"],
    };
    const [kind, message] = codes[el.error?.code] || ["media", "the media failed to load"];
    fail(kind, message);
  });
  // `error` never fires for a file that merely never finishes loading its
  // metadata, which is exactly the truncated-MP4 case, so time it out too.
  const seen = () => { cancelWatchdog(); clearFailure(); };
  el.addEventListener("loadedmetadata", seen);
  el.addEventListener("playing", seen);
  if (playing) { loadingRequested = true; startWatchdog(); }

  const subs = new Set();
  let lastEmit = 0;
  const notify = (opts = {}) => {
    const now = Date.now();
    if (opts.throttle && now - lastEmit < 250) return; // ≤4Hz for timeupdate
    lastEmit = now;
    const s = controller.state();
    subs.forEach((fn) => { try { fn(s); } catch (_) { /* advisory */ } });
  };
  el.addEventListener("loadedmetadata", () => {
    const audioOnly = !el.videoWidth && !el.videoHeight;
    controller.capabilities = { ...controller.capabilities, audioOnly };
    notify();
  });
  el.addEventListener("play", () => notify());
  el.addEventListener("pause", () => notify());
  el.addEventListener("ended", () => notify());
  el.addEventListener("playing", () => notify());
  el.addEventListener("waiting", () => notify());
  el.addEventListener("volumechange", () => notify());
  el.addEventListener("ratechange", () => notify());
  el.addEventListener("timeupdate", () => notify({ throttle: true }));
  el.addEventListener("error", () => notify());

  const controller = {
    kind: "recording",
    root: el,
    capabilities: {
      play: true, pause: true, seek: true, duration: true, volume: true,
      mute: true, quality: false, rate: true, pip: true, fullscreen: true,
      live: false, audioOnly: false,
    },
    mount(container) {
      if (el.parentElement !== container) container.appendChild(el);
    },
    destroy() {
      cancelWatchdog();
      loadingRequested = false;
      clearFailure();
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
      if (next && next.src && next.src !== el.getAttribute("src")) {
        cancelWatchdog(); clearFailure();
        loadingRequested = !!next.playing;
        el.src = next.src;
        if (loadingRequested) startWatchdog();
      }
    },
    isReady() {
      return true;
    },
    play() { loadingRequested = true; startWatchdog(); el.play().catch(() => {}); },
    pause() { loadingRequested = false; cancelWatchdog(); el.pause(); },
    togglePlay() { el.paused ? controller.play() : controller.pause(); },
    seek(sec) { try { el.currentTime = Math.max(0, sec); } catch (_) { /* advisory */ } },
    currentTime() { return el.currentTime; },
    duration() { return Number.isFinite(el.duration) ? el.duration : NaN; },
    setRate(r) { try { el.playbackRate = r; } catch (_) { /* advisory */ } },
    state() {
      return {
        ready: el.readyState >= 1,
        playing: !el.paused && !el.ended,
        buffering: el.readyState < 3 && !el.paused && !el.ended,
        ended: el.ended,
        muted: el.muted,
        volume: el.volume,
        currentTime: el.currentTime,
        duration: Number.isFinite(el.duration) ? el.duration : NaN,
        rate: el.playbackRate,
        quality: null,
        qualities: [],
        live: false,
        error: el.dataset.failed || null,
      };
    },
    onState(fn) {
      subs.add(fn);
      try { fn(controller.state()); } catch (_) { /* advisory */ }
      return () => subs.delete(fn);
    },
  };
  return controller;
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

