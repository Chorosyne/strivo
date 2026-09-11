
// Viewer route — RETIRED. #/watch's single-tile theater view now covers
// everything this bare cross-origin-iframe surface did (single-stream
// embed + chat), plus a real player bar instead of vendor-only chrome —
// so this route just resolves the requested room and redirects rather
// than maintaining a second, thinner watch surface.
async function renderViewer(ctx) {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const room = params.get("room") || "";
  if (!channelCache.length) {
    try {
      const response = await API.channels();
      if (typeof isRouteCurrent === "function" && !isRouteCurrent(ctx)) return;
      channelCache = response.channels || [];
    } catch (_) {
      if (typeof isRouteCurrent === "function" && !isRouteCurrent(ctx)) return;
    }
  }
  const c = channelCache.find((x) =>
    x.platform === "Twitch" && (x.name || x.display_name || "").toLowerCase() === room.toLowerCase());
  if (c) {
    location.replace(`#/watch?focus=${encodeURIComponent(`${c.platform}:${c.id}`)}&fresh=1`);
  } else {
    location.replace("#/watch");
  }
}

// Multi-stream viewer route. Server returns tiles already laid out for
// the requested container size + mode, plus each stream's ready-to-mount
// embed URL. Mode is kept in URL params so refresh / share preserves the
// view.
// Background poll handle so route switches can cancel the previous
// timer before mounting a new one.
// A12: deprecated. playerState.refreshTimer is the canonical handle;
// this dual reference is retained so teardownAcrossRoutes() can keep
// clearing both during a transitional release. New code MUST use
// playerState.refreshTimer.
let _watchRefreshTimer = null;

// Append the muted-state parameter Twitch / YouTube embeds use.
// ── Tile audio ───────────────────────────────────────────────────────
//
// Volume per tile is the source of truth; muted simply means zero. That
// split matters because "which tile is focused" and "which tile is audible"
// were the same flag before, so you could not run a main stream loud with a
// second quietly underneath — the only reachable states were one-audible or
// all-silent.
//
// `playerState.soloPath` survives as the FOCUS marker (it steers the chat
// rail and the focus-aware quality policy); it no longer decides audio.
const PLAYER_VOLUME_KEY = "strivo:tile-volumes";
function loadTileVolumes() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYER_VOLUME_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch (_) {
    return {};
  }
}
function saveTileVolumes() {
  try {
    localStorage.setItem(PLAYER_VOLUME_KEY, JSON.stringify(playerState.volumes || {}));
  } catch (_) {
    /* private mode */
  }
}
/// Everything starts silent: a wall that begins making noise on open is
/// hostile, and it matches the previous mute-all default.
function tileVolumeForKey(key) {
  if (!key) return 0;
  const v = (playerState.volumes || {})[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
function tileVolumeAt(path) {
  return tileVolumeForKey(contentKeyOf(getNodeAt(playerState.layout, path)));
}
function setTileVolumeAt(path, vol) {
  const key = contentKeyOf(getNodeAt(playerState.layout, path));
  if (!key) return;
  playerState.volumes = { ...(playerState.volumes || {}), [key]: Math.max(0, Math.min(1, vol)) };
  saveTileVolumes();
}
/// Solo is a preset, not a mode: raise this tile, silence the rest. The
/// viewer is free to nudge any of them afterwards.
function soloTileAt(path) {
  const next = {};
  walkLayout(playerState.layout, (node, p) => {
    const key = contentKeyOf(node);
    if (key) next[key] = p === path ? 1 : 0;
  });
  playerState.volumes = next;
  playerState.soloPath = path;
  saveTileVolumes();
}
function muteAllTiles() {
  const next = {};
  walkLayout(playerState.layout, (node) => {
    const key = contentKeyOf(node);
    if (key) next[key] = 0;
  });
  playerState.volumes = next;
  playerState.soloPath = "";
  saveTileVolumes();
}

/// Muted is derived, never stored: a tile is muted exactly when silent.
function computeMuted(path) {
  return tileVolumeAt(path) === 0;
}

// Single source of truth for a live tile's iframe src.
//
// Autoplay has to be stated explicitly because the two providers disagree
// out of the box: Twitch's player autoplays unless told not to, YouTube's
// embed does the opposite. Leaving it implicit is why opening a 3x3 wall
// used to start nine Twitch streams at once.
//
// The base URL is kept on the element in `data-embed-base` so repaints
// rebuild from it rather than regex-stripping params off a previous src.
function tileSrc(embedUrl, { muted, playing }) {
  if (!embedUrl) return embedUrl;
  const yt = embedUrl.includes("youtube.com");
  const params = [
    yt ? `mute=${muted ? 1 : 0}` : `muted=${muted}`,
    yt ? `autoplay=${playing ? 1 : 0}` : `autoplay=${playing}`,
  ];
  return embedUrl + (embedUrl.includes("?") ? "&" : "?") + params.join("&");
}

// Multi-view quality defaults, per provider.
//
// Deliberately NOT normalised into one cross-platform scale: the same
// "1080p" is a different bitrate on Twitch than on YouTube, and differs
// between streamers on the same platform. The UI therefore offers what each
// provider actually exposes, and says plainly where a provider exposes
// nothing.
const MULTIVIEW_QUALITY_KEY = "strivo:multiview-quality";
const MULTIVIEW_QUALITY_DEFAULTS = { twitch: "best", youtube: "auto" };
const MULTIVIEW_QUALITY_CHOICES = [
  ["best", "Best available"],
  ["auto", "Let the platform decide"],
  ["low", "Lowest (save bandwidth/CPU)"],
  ["focus", "Best on the focused tile, lowest on the rest"],
];
function multiviewQuality() {
  try {
    const raw = JSON.parse(localStorage.getItem(MULTIVIEW_QUALITY_KEY) || "{}");
    return { ...MULTIVIEW_QUALITY_DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  } catch (_) {
    return { ...MULTIVIEW_QUALITY_DEFAULTS };
  }
}
function setMultiviewQuality(provider, value) {
  const next = { ...multiviewQuality(), [provider]: value };
  try {
    localStorage.setItem(MULTIVIEW_QUALITY_KEY, JSON.stringify(next));
  } catch (_) {
    /* private mode */
  }
}
/// Resolve the effective policy for one tile. "focus" is the only setting
/// that varies per tile; everything else applies uniformly.
function qualityPolicyFor(kind, path) {
  const provider = kind === "youtube" ? "youtube" : "twitch";
  const setting = multiviewQuality()[provider] || "auto";
  if (setting !== "focus") return setting;
  const focused = playerState.soloPath || "";
  return path === focused ? "best" : "low";
}

// ── Player controllers ───────────────────────────────────────────────
//
// A tile's vendor player is owned by a controller keyed on CONTENT
// (`s:<streamId>` / `r:<recordingId>`), held in `playerState.controllers`
// for the whole watch session — deliberately NOT keyed on layout path and
// NOT owned by the DOM.
//
// That distinction is the entire point. Stage HTML is rebuilt wholesale on
// preset switches, composer edits, and Play-all; when the player lived in
// that HTML, every rebuild tore it down and Twitch/YouTube restarted the
// stream. Because the registry outlives any single paint, a rebuild now
// just re-parents the existing element into its new mount point, and a
// stream the user never touched keeps playing.
//
// Every controller is created through a swappable factory so e2e can inject
// a fake and assert on lifecycle without loading a real vendor player.

/// Is this platform YouTube, whichever way the API spelled it?
///
/// `/channels` serialises PlatformKind as "YouTube" while
/// `/multistream/tiles` serialises multistream::Platform as "you_tube".
/// Comparing against a single spelling sent YouTube streams to the Twitch
/// controller, which handed a YouTube channel id to player.twitch.tv and
/// produced "Failed to determine content classification" — a Twitch error,
/// for a Twitch player, about a channel that was never Twitch's.
function isYouTubePlatform(p) {
  return String(p || "").toLowerCase().replace(/[_\s-]/g, "") === "youtube";
}

/// Stable identity for whatever a slot holds. Returns null for empty slots.
function contentKeyOf(node) {
  if (!node) return null;
  if (node.streamId) return `s:${node.streamId}`;
  if (node.recordingId) return `r:${node.recordingId}`;
  return null;
}

/// Today's behaviour, wrapped: a plain cross-origin iframe whose only
/// control surface is its `src`. Mute and playback still cost a reload
/// here — that is inherent to a bare iframe, and is what the vendor-SDK
/// controllers in later phases exist to avoid. This stays as the permanent
/// fallback for when a vendor script is blocked or fails to load, so a
/// missing SDK degrades to exactly the old experience rather than a blank
/// tile.
function makeIframeController(spec) {
  const el = document.createElement("iframe");
  el.className = "watch-tile-iframe ms-iframe";
  el.setAttribute(
    "allow",
    "autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write",
  );
  el.setAttribute("allowfullscreen", "");
  el.setAttribute("frameborder", "0");
  let base = spec.embedUrl || "";
  let muted = !!spec.muted;
  let playing = spec.playing !== false;
  el.setAttribute("data-embed-base", base);
  const sync = () => {
    if (!base) return;
    const next = tileSrc(base, { muted, playing });
    // Assigning src reloads the player, so only write on a real change.
    if (el.getAttribute("src") !== next) el.setAttribute("src", next);
  };
  sync();
  const subs = new Set();
  const notify = () => {
    const s = controller.state();
    subs.forEach((fn) => { try { fn(s); } catch (_) { /* advisory */ } });
  };
  const controller = {
    kind: "iframe-fallback",
    root: el,
    // A bare iframe has no control surface beyond its `src` — mute still
    // reloads the player, so it is NOT advertised as a real capability.
    capabilities: {
      play: false, pause: false, seek: false, duration: false,
      volume: false, mute: false, quality: false, rate: false,
      pip: false, fullscreen: true, live: true, audioOnly: false,
    },
    mount(container) {
      if (el.parentElement !== container) container.appendChild(el);
    },
    destroy() {
      el.remove();
    },
    setMuted(next) {
      if (next !== muted) {
        muted = next;
        sync();
      }
    },
    setVolume() {
      /* not addressable without a player API — see the Twitch controller */
    },
    setQuality() {
      /* ditto */
    },
    repoint(next) {
      const url = next && next.embedUrl;
      if (url && url !== base) {
        base = url;
        el.setAttribute("data-embed-base", base);
        sync();
      }
    },
    isReady() {
      return true;
    },
    play() { playing = true; sync(); notify(); },
    pause() { playing = false; sync(); notify(); },
    togglePlay() { playing ? controller.pause() : controller.play(); },
    seek() { /* not addressable */ },
    currentTime() { return NaN; },
    duration() { return NaN; },
    setRate() { /* not addressable */ },
    state() {
      return {
        ready: true, playing, buffering: false, ended: false, muted,
        volume: NaN, currentTime: NaN, duration: NaN, rate: 1,
        quality: null, qualities: [], live: true, error: null,
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

