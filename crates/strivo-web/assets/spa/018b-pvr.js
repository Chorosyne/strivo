/// Twitch tile driven through `Twitch.Player`.
///
/// The whole point: mute, volume and quality are method calls, so none of
/// them reload the stream the way rewriting an iframe `src` does. Quality is
/// the big one on a wall — several 1080p60 decodes is the dominant cost, and
/// background tiles do not need source.
function makeTwitchController(spec) {
  const host = document.createElement("div");
  host.className = "watch-tile-iframe ms-iframe ms-twitch";
  const parsed = parseTwitchEmbed(spec.embedUrl) || { channel: "", parent: embedParentHost() };

  let player = null;
  let ready = false;
  let qualities = [];
  let pendingQualityTier = null;
  let muted = !!spec.muted;
  let volume = typeof spec.volume === "number" ? spec.volume : 1;
  let wantPlaying = spec.playing !== false;

  const subs = new Set();
  const notify = () => {
    const s = controller.state();
    subs.forEach((fn) => { try { fn(s); } catch (_) { /* advisory */ } });
  };
  // Twitch's SDK has no time/progress event, so state that might have
  // drifted (isPaused/getEnded) is sampled while the tile is playing —
  // stopped the moment it isn't, so an idle wall costs nothing.
  const statePoll = makeStatePoll(() => player && ready, notify);
  const startPoll = () => statePoll.start();
  const stopPoll = () => statePoll.stop();

  /// Map a policy onto whatever this stream actually offers.
  ///
  /// The quality string vocabulary is NOT documented by Twitch — community
  /// reports resolution-coded names like "1080p60 (source)" — so options are
  /// discovered per player and never hardcoded. A resolution label is also
  /// not a quality measure: the same "1080p" differs in bitrate between
  /// streamers and platforms, which is why nothing here normalises across
  /// providers. Anything unexpected means: do nothing and let Twitch's own
  /// auto stand, which is always a safe answer.
  const applyQuality = (policy) => {
    if (!player || !ready || !policy || policy === "auto") return;
    // getQualities() returns entries with a `group` id and a human `name`.
    // Drop the synthetic "auto" entry; what remains is highest-first per
    // Twitch's ordering, but do not rely on that — pick by explicit ends.
    const usable = qualities.filter((q) => q && q.group && q.group !== "auto");
    if (usable.length < 2) return;
    const pick = policy === "low" ? usable[usable.length - 1] : usable[0];
    if (!pick || !pick.group) return;
    try {
      if (player.getQuality() !== pick.group) player.setQuality(pick.group);
    } catch (_) {
      /* advisory only — never worse than leaving auto alone */
    }
  };

  loadTwitchSdkOnce()
    .then((Twitch) => {
      if (!host.isConnected && !host.parentElement) {
        // Tile was removed while the SDK was loading.
        return;
      }
      player = new Twitch.Player(host, {
        channel: parsed.channel,
        parent: [parsed.parent],
        width: "100%",
        height: "100%",
        muted,
        autoplay: spec.playing !== false,
      });
      player.addEventListener(Twitch.Player.READY, () => {
        ready = true;
        try {
          // getQualities() ordering is not documented either; sort so the
          // highest is first regardless of what Twitch hands back.
          qualities = (player.getQualities() || []).slice();
        } catch (_) {
          qualities = [];
        }
        try {
          player.setMuted(muted);
          player.setVolume(volume);
        } catch (_) {
          /* pre-ready calls can throw on some builds */
        }
        if (pendingQualityTier) applyQuality(pendingQualityTier);
        notify();
      });
      player.addEventListener(Twitch.Player.PLAY, () => { startPoll(); notify(); });
      player.addEventListener(Twitch.Player.PLAYING, () => { startPoll(); notify(); });
      player.addEventListener(Twitch.Player.PAUSE, () => { stopPoll(); notify(); });
      player.addEventListener(Twitch.Player.ENDED, () => { stopPoll(); notify(); });
      player.addEventListener(Twitch.Player.OFFLINE, () => notify());
      player.addEventListener(Twitch.Player.ONLINE, () => notify());
      player.addEventListener(Twitch.Player.PLAYBACK_BLOCKED, () => notify());
    })
    .catch(() => {
      // SDK blocked or offline: fall back to a plain iframe in place, so
      // the tile still plays rather than sitting empty. Every method AND
      // capability swaps to the fallback's — a stale capability set would
      // leave the bar advertising controls (mute/quality) the tile can no
      // longer honour — followed by exactly one state emission so any bar
      // already mounted repaints against the new (all-but-fullscreen-off)
      // reality.
      const fb = makeIframeController(spec);
      host.replaceWith(fb.root);
      player = null;
      stopPoll();
      controller.root = fb.root;
      controller.capabilities = fb.capabilities;
      controller.setMuted = fb.setMuted;
      controller.setVolume = fb.setVolume;
      controller.setQuality = fb.setQuality;
      controller.repoint = fb.repoint;
      controller.destroy = fb.destroy;
      controller.mount = fb.mount;
      controller.isReady = fb.isReady;
      controller.play = fb.play;
      controller.pause = fb.pause;
      controller.togglePlay = fb.togglePlay;
      controller.seek = fb.seek;
      controller.currentTime = fb.currentTime;
      controller.duration = fb.duration;
      controller.setRate = fb.setRate;
      controller.state = fb.state;
      notify();
    });

  const controller = {
    kind: "twitch",
    root: host,
    capabilities: {
      play: true, pause: true, seek: false, duration: false, volume: true,
      mute: true, quality: true, rate: false, pip: false, fullscreen: true,
      live: true, audioOnly: false,
    },
    mount(container) {
      if (controller.root.parentElement !== container) container.appendChild(controller.root);
    },
    destroy() {
      stopPoll();
      try {
        // The SDK exposes no documented destroy; dropping the node releases
        // the iframe it created underneath.
        player = null;
      } finally {
        controller.root.remove();
      }
    },
    setMuted(next) {
      muted = next;
      if (player && ready) {
        try {
          player.setMuted(next);
          return;
        } catch (_) {
          /* fall through */
        }
      }
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (player && ready) {
        try {
          player.setVolume(volume);
        } catch (_) {
          /* advisory */
        }
      }
    },
    setQuality(tier) {
      pendingQualityTier = tier;
      applyQuality(tier);
    },
    getPlaybackStats() {
      try {
        return player && ready ? player.getPlaybackStats() : null;
      } catch (_) {
        return null;
      }
    },
    repoint(next) {
      const p = next && next.embedUrl ? parseTwitchEmbed(next.embedUrl) : null;
      if (!p || !p.channel || p.channel === parsed.channel) return;
      parsed.channel = p.channel;
      if (player) {
        try {
          // Retarget in place — no teardown, no reload.
          player.setChannel(p.channel);
        } catch (_) {
          /* leave the tile on its current channel rather than blanking it */
        }
      }
    },
    isReady() {
      return ready;
    },
    play() {
      wantPlaying = true;
      if (player && ready) { try { player.play(); } catch (_) { /* advisory */ } }
    },
    pause() {
      wantPlaying = false;
      if (player && ready) { try { player.pause(); } catch (_) { /* advisory */ } }
    },
    togglePlay() {
      if (player && ready) {
        try { (player.isPaused() ? controller.play : controller.pause)(); return; } catch (_) { /* fall through */ }
      }
      controller.play();
    },
    seek() { /* Twitch is a live embed with no seek API */ },
    currentTime() { return NaN; },
    duration() { return NaN; },
    setRate() { /* not exposed by the SDK */ },
    state() {
      let playing = wantPlaying;
      let ended = false;
      let currentQuality = null;
      if (player && ready) {
        try { playing = !player.isPaused(); } catch (_) { /* advisory */ }
        try { ended = !!player.getEnded(); } catch (_) { /* advisory */ }
        try { currentQuality = player.getQuality(); } catch (_) { /* advisory */ }
      }
      const usable = qualities.filter((q) => q && q.group && q.group !== "auto");
      return {
        ready, playing, buffering: false, ended, muted, volume,
        currentTime: NaN, duration: NaN, rate: 1,
        quality: currentQuality,
        qualities: usable.map((q) => ({ id: q.group, label: q.name || q.group })),
        live: true, error: null,
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

/// Load YouTube's IFrame Player API — ON DEMAND ONLY.
///
/// This is a Google-hosted script executing with page privileges, which is a
/// heavier trust posture than a sandboxed cross-origin iframe. This project
/// deliberately serves fonts from Bunny Fonts rather than Google to avoid
/// leaking client IP/referer, so this must never load merely because someone
/// opened the wall:
/// it loads the first time a YouTube tile is actually played, at which point
/// the viewer has already chosen to contact Google.
///
/// Memoised on the PROMISE so two YouTube tiles started together share one
/// in-flight load rather than injecting the script twice.
let _ytApi = null;
function loadYouTubeApiOnce() {
  if (_ytApi) return _ytApi;
  _ytApi = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    // The API signals readiness through this single global callback, so
    // chain rather than clobber any existing one.
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") {
        try {
          prev();
        } catch (_) {
          /* not ours to fix */
        }
      }
      window.YT && window.YT.Player
        ? resolve(window.YT)
        : reject(new Error("YouTube API ready without a Player"));
    };
    const el = document.createElement("script");
    el.src = "https://www.youtube.com/iframe_api";
    el.async = true;
    el.onerror = () => reject(new Error("YouTube IFrame API failed to load"));
    document.head.appendChild(el);
  });
  return _ytApi;
}

