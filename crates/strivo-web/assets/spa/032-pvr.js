
  // CE-Fusion F5: an Archive deep link opens straight into the EDL editor
  // rather than making the user find + click the button themselves.
  if (opts.seekSec != null) {
    if (isFinished) {
      overlay.querySelector("[data-action=rec-info-editor]")?.click();
    } else {
      Toast.info(`Target moment ${fmtClock(opts.seekSec)} — the EDL editor unlocks once this recording finishes.`);
    }
  }
}

// ── In-app player ────────────────────────────────────────────────────
// Custom controls — power-user keyboard maps mirror mpv where the HTML5
// video API allows. State is owned by the modal; no globals (except the
// modal-open class) leak out.

async function openRecordingPlayer(jobId, _opts = {}) {
  // The inline modal player has been retired — every recording-open
  // path now navigates to the Player tab so there's a single source of
  // truth for playback. The seek parameter is preserved as a URL param
  // so in-context tools (Crunchr transcript click, cuepoints tick,
  // EDL editor jumps) still land at the right timecode.
  if (!jobId) return;
  // Defensive: dismiss any stray keymap/modal state before the route
  // change so the new Player surface isn't covered by leftover chrome.
  closeRecordingModals();
  document.getElementById("kbd-help")?.classList.remove("open");
  document.body.classList.remove("modal-open");
  const seek = _opts && _opts.seekTo ? `&t=${encodeURIComponent(_opts.seekTo)}` : "";
  window.location.hash = `#/watch?recording=${encodeURIComponent(jobId)}&fresh=1${seek}`;
}

// Legacy modal-player implementation removed. The shim above redirects
// every call site to the Player route. If a future iter needs an
// inline mini-player (e.g. preview-in-context inside an Analytics
// pane), build it as a separate, narrower function rather than
// resurrecting the modal.

// (Legacy modal-player implementation deleted — ~100 lines of
// unreachable code after openRecordingPlayer's return.)

function wirePlayer(overlay, v) {
  const playBtn = overlay.querySelector("#rec-pc-play");
  const seek = overlay.querySelector("#rec-pc-seek");
  const cur = overlay.querySelector("#rec-pc-cur");
  const dur = overlay.querySelector("#rec-pc-dur");
  const speedSel = overlay.querySelector("#rec-pc-speed-sel");
  const muteBtn = overlay.querySelector("#rec-pc-mute");
  const vol = overlay.querySelector("#rec-pc-vol");
  const ccBtn = overlay.querySelector("#rec-pc-cc");
  const pipBtn = overlay.querySelector("#rec-pc-pip");
  const fsBtn = overlay.querySelector("#rec-pc-fs");
  const helpBtn = overlay.querySelector("#rec-pc-help");
  const helpEl = overlay.querySelector("#rec-player-help");
  const abEl = overlay.querySelector("#rec-pc-ab");
  const overlayMsgEl = overlay.querySelector("#rec-player-overlay");
  const overlayMsgText = overlay.querySelector("#rec-player-overlay-msg");
  const state = { a: null, b: null, lastFlash: 0 };

  function flash(msg) {
    overlayMsgText.textContent = msg;
    overlayMsgEl.hidden = false;
    state.lastFlash = Date.now();
    setTimeout(() => {
      if (Date.now() - state.lastFlash >= 700) overlayMsgEl.hidden = true;
    }, 750);
  }
  function paintAb() {
    if (state.a == null && state.b == null) { abEl.textContent = ""; return; }
    const fmt = (s) => s == null ? "—" : fmtClock(s);
    abEl.textContent = `A ${fmt(state.a)} ↔ B ${fmt(state.b)}`;
  }

  v.addEventListener("loadedmetadata", () => {
    dur.textContent = fmtClock(v.duration || 0);
    seek.max = Math.max(1, Math.floor(v.duration * 10));
    // Audio-only files have 0×0 video boxes — collapse the 16:9 stage so
    // the player isn't a giant black rectangle, and hide PiP + fullscreen
    // (PiP throws on a no-video-track stream; fullscreen is pointless).
    const audioOnly = !v.videoWidth && !v.videoHeight;
    overlay.classList.toggle("audio-only", audioOnly);
    // Honour opts.seekTo from openRecordingPlayer callers — e.g. the
    // Crunchr transcript line-click. Once metadata loads we know the
    // duration is valid, so clamping is safe. Auto-play makes the
    // jump feel snappy without the user pressing space.
    if (typeof opts.seekTo === "number" && opts.seekTo >= 0) {
      v.currentTime = Math.min(opts.seekTo, v.duration || opts.seekTo);
      v.play().catch(() => {});
    }
  });
  v.addEventListener("timeupdate", () => {
    cur.textContent = fmtClock(v.currentTime || 0);
    seek.value = Math.floor((v.currentTime || 0) * 10);
    if (state.a != null && state.b != null && v.currentTime >= state.b) {
      v.currentTime = state.a;
    }
  });
  v.addEventListener("play", () => playBtn.textContent = "❚❚");
  v.addEventListener("pause", () => playBtn.textContent = "▶");
  v.addEventListener("error", () => {
    flash("Playback failed — your browser may not support this codec. Try Download from the row menu.");
    overlayMsgEl.hidden = false;
  });

  playBtn.addEventListener("click", () => { v.paused ? v.play() : v.pause(); });
  seek.addEventListener("input", () => { v.currentTime = Number(seek.value) / 10; });
  speedSel.addEventListener("change", () => { v.playbackRate = Number(speedSel.value); flash(`${v.playbackRate}×`); });
  muteBtn.addEventListener("click", () => { v.muted = !v.muted; muteBtn.textContent = v.muted ? "🔇" : "🔊"; });
  vol.addEventListener("input", () => { v.volume = Number(vol.value); v.muted = v.volume === 0; muteBtn.textContent = v.muted ? "🔇" : "🔊"; });
  ccBtn.addEventListener("click", () => {
    const tracks = v.textTracks;
    if (!tracks.length) return;
    const cur = tracks[0];
    cur.mode = cur.mode === "showing" ? "hidden" : "showing";
    ccBtn.classList.toggle("on", cur.mode === "showing");
  });
  pipBtn.addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement === v) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch (e) { flash(e.message); }
  });
  fsBtn.addEventListener("click", () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else overlay.querySelector(".rec-player-stage").requestFullscreen?.();
    } catch (err) {
      // Safari/iOS reject fullscreen outside user-gesture context.
      Toast.error?.(`Fullscreen denied: ${err && err.message || err}`);
    }
  });
  helpBtn.addEventListener("click", () => { helpEl.hidden = !helpEl.hidden; });

  // Keyboard map.
  function onKey(e) {
    // Don't grab keystrokes inside the speed dropdown / sliders.
    if (e.target.closest("select, input")) return;
    const k = e.key;
    if (k === "?") { helpEl.hidden = !helpEl.hidden; e.preventDefault(); return; }
    if (k === " ") { v.paused ? v.play() : v.pause(); e.preventDefault(); return; }
    if (k === "ArrowLeft") { v.currentTime = Math.max(0, v.currentTime - 5); e.preventDefault(); return; }
    if (k === "ArrowRight") { v.currentTime = Math.min((v.duration || 0), v.currentTime + 5); e.preventDefault(); return; }
    if (k === "j" || k === "J") { v.currentTime = Math.max(0, v.currentTime - 10); e.preventDefault(); return; }
    if (k === "l" || k === "L") { v.currentTime = Math.min((v.duration || 0), v.currentTime + 10); e.preventDefault(); return; }
    if (k === "k" || k === "K") { v.paused ? v.play() : v.pause(); e.preventDefault(); return; }
    if (k === ",") { v.pause(); v.currentTime = Math.max(0, v.currentTime - 1/30); e.preventDefault(); return; }
    if (k === ".") { v.pause(); v.currentTime = Math.min((v.duration || 0), v.currentTime + 1/30); e.preventDefault(); return; }
    if (k === "<") { speedSel.selectedIndex = Math.max(0, speedSel.selectedIndex - 1); speedSel.dispatchEvent(new Event("change")); e.preventDefault(); return; }
    if (k === ">") { speedSel.selectedIndex = Math.min(speedSel.options.length - 1, speedSel.selectedIndex + 1); speedSel.dispatchEvent(new Event("change")); e.preventDefault(); return; }
    if (k === "ArrowUp") { vol.value = Math.min(1, Number(vol.value) + 0.05); vol.dispatchEvent(new Event("input")); e.preventDefault(); return; }
    if (k === "ArrowDown") { vol.value = Math.max(0, Number(vol.value) - 0.05); vol.dispatchEvent(new Event("input")); e.preventDefault(); return; }
    if (k === "m" || k === "M") { muteBtn.click(); e.preventDefault(); return; }
    if (k === "i" || k === "I") { state.a = v.currentTime; paintAb(); flash(`A = ${fmtClock(state.a)}`); e.preventDefault(); return; }
    if (k === "o" || k === "O") { state.b = v.currentTime; paintAb(); flash(`B = ${fmtClock(state.b)}`); e.preventDefault(); return; }
    if (k === "c" || k === "C") { state.a = null; state.b = null; paintAb(); flash("A-B cleared"); e.preventDefault(); return; }
    if (k === "f" || k === "F") { fsBtn.click(); e.preventDefault(); return; }
    if (k === "p" || k === "P") { pipBtn.click(); e.preventDefault(); return; }
    if (k === "t" || k === "T") { ccBtn.click(); e.preventDefault(); return; }
    if (/^[0-9]$/.test(k)) {
      const frac = Number(k) / 10;
      if (v.duration) v.currentTime = v.duration * frac;
      e.preventDefault(); return;
    }
  }
  overlay.addEventListener("keydown", onKey);
  // Tear the global keydown when modal closes — done implicitly because
  // the overlay is removed from the DOM in closeRecordingModals.
}

// ── Stub routes ──────────────────────────────────────────────────────
function renderStub(title, msg) {
  root.removeAttribute("aria-busy");
  root.innerHTML = chrome(`
    <h1 class="page-title">${htmlEscape(title)}</h1>
    <div class="empty">
      <div class="glyph">🚧</div>
      ${htmlEscape(msg)}
    </div>
  `);
  setupChromeHandlers();
}

// ── Settings (Jellyfin-style two-pane shell) ────────────────────────
// Left rail = section nav (sub-route via #/settings/<section>).
// Right pane = section content. All knobs the daemon exposes get a
// visible row — read-only for now (Phase 2a). Phase 2b wires writes;
// Phase 2c adds the platforms wizard + keyring. Tooltip hints (the
// `title` attribute on .stg-hint) explain non-obvious knobs without
// cluttering the layout.
const SETTINGS_SECTIONS = [
  { slug: "general", label: "General", icon: "⚙" },
  { slug: "recording", label: "Recording", icon: "⏺" },
  { slug: "notifications", label: "Notifications", icon: "🔔" },
  { slug: "platforms", label: "Platforms", icon: "🔌" },
  { slug: "plugins", label: "Plugins", icon: "🧩" },
  { slug: "interface", label: "Interface", icon: "🎨" },
  { slug: "multiview", label: "Multi-view", icon: "▦" },
  { slug: "advanced", label: "Advanced", icon: "🛠" },
  { slug: "about", label: "About", icon: "ℹ" },
];

async function renderSettings() {
  const parts = routeParts(); // ["settings", <slug?>]
  const slug = parts[1] || "general";
  let known = SETTINGS_SECTIONS.find((s) => s.slug === slug)
    ? slug
    : "general";
  // The Plugins pane is Creator Edition only.
  if (known === "plugins" && !CREATOR_ENABLED) known = "general";

  let s = {};
  try {
    s = await API.settings();
  } catch (e) {
    if (e.message && e.message.includes("unauthorized")) return;
  }
  root.removeAttribute("aria-busy");

  const rail = SETTINGS_SECTIONS
    .filter((sec) => CREATOR_ENABLED || sec.slug !== "plugins")
    .map((sec) => `
    <a class="stg-rail-item ${sec.slug === known ? "is-active" : ""}"
       href="#/settings/${sec.slug}">
      <span class="stg-rail-icon" aria-hidden="true">${sec.icon}</span>
      <span class="stg-rail-label">${htmlEscape(sec.label)}</span>
    </a>`).join("");

  const pane = renderSettingsPane(known, s);

  root.innerHTML = chrome(`
    <h1 class="page-title">Settings</h1>
    <p class="page-subtitle">Live daemon configuration. Toggles and numeric knobs persist to <code>~/.config/strivo/config.toml</code> on change.</p>
    <div class="stg-shell">
      <nav class="stg-rail" aria-label="Settings sections">
        <div class="stg-search-wrap">
          <input id="stg-search" class="stg-search" type="search"
                 placeholder="Filter settings…" aria-label="Filter settings" />
        </div>
        ${rail}
      </nav>
      <div class="stg-pane" id="stg-pane">${pane}</div>
    </div>
  `);
  setupChromeHandlers();
  wireSettingsControls();
  wireSettingsSearch();
}

// Filter rows in the right pane and rail items by typed query (audit M10).
function wireSettingsSearch() {
  const input = document.getElementById("stg-search");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll(".stg-row").forEach((r) => {
      const txt = r.textContent.toLowerCase();
      r.classList.toggle("stg-row-hidden", q.length > 0 && !txt.includes(q));
    });
    // Hide group headings whose rows all collapsed.
    document.querySelectorAll(".stg-group").forEach((g) => {
      const anyVisible = g.querySelector(".stg-row:not(.stg-row-hidden)");
      g.style.display = q && !anyVisible ? "none" : "";
    });
  });
}

// Wire every editable control on the right pane. Each control declares
// its dotted config path via `data-stg-path` and its type via the input
// itself (checkbox / number). On change we POST to /settings/update;
// failure rolls the control back to its previous value and toasts.
function wireSettingsControls() {
  const pane = document.getElementById("stg-pane");
  if (!pane) return;
  // Multi-view quality selects are browser-local, so they persist straight
  // to localStorage rather than through the daemon config endpoint. Applying
  // takes effect on the next reconcile — no reload, that being the point.
  pane.querySelectorAll("[data-mv-quality]").forEach((sel) => {
    sel.addEventListener("change", () => {
      setMultiviewQuality(sel.dataset.mvQuality, sel.value);
      Toast.info("Multi-view quality updated — applies to open tiles immediately.");
      for (const [, ctl] of playerState.controllers) {
        try {
          ctl.setQuality(qualityPolicyFor(ctl.kind, ""));
        } catch (_) {
          /* advisory */
        }
      }
    });
  });

  // Configure / Reconfigure buttons on the Platforms section open a
  // wizard modal per platform.
  pane.querySelectorAll(".stg-cfg-btn").forEach((btn) => {
    btn.addEventListener("click", () => openPlatformWizard(btn.dataset.platform));
  });
  // Master toggles dim their dependent conditional subgroup when off — the
  // Notifications master switch dims Events, the Webhook enable toggle dims
  // the Webhook URL field. We do this in JS rather than re-rendering so
  // users see immediate visual feedback during the save round-trip. Each
  // `.stg-subgroup-conditional` names its master via `data-conditional-master`
  // so any number of these pairs can coexist.
  pane.querySelectorAll(".stg-subgroup-conditional[data-conditional-master]").forEach((condEl) => {
    const masterEl = pane.querySelector(`[data-stg-path="${condEl.getAttribute("data-conditional-master")}"]`);
    if (!masterEl) return;
    const syncMaster = () => {
      if (masterEl.checked) {
        condEl.style.opacity = "";
        condEl.style.pointerEvents = "";
      } else {
        condEl.style.opacity = "0.55";
        condEl.style.pointerEvents = "none";
      }
    };
    masterEl.addEventListener("change", syncMaster);
  });
  // Onboarding controls — replay the welcome tour / reset per-page hints.
  pane.querySelector("#stg-replay-tour")?.addEventListener("click", () => {
    localStorage.removeItem("strivo-tour-done");
    startOnboardingTour();
  });
  pane.querySelector("#stg-reset-hints")?.addEventListener("click", () => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("strivo-hint-")) localStorage.removeItem(k);
    }
    Toast.success("Per-page hints reset · will reappear next visit");
    render().catch(() => {});
  });
  // Layout reorder widgets — Kodi/Aeon-style up/down lists.
  // Each .stg-reorder reads its current order from localStorage
  // (falling back to data-default), renders one row per entry with
  // ▲ / ▼ buttons, and persists on any movement.
  pane.querySelectorAll(".stg-reorder").forEach((box) => {
    const key = box.dataset.reorderKey;
    const def = JSON.parse(box.dataset.default || "[]");
    let order;
    try { order = JSON.parse(localStorage.getItem(key) || ""); if (!Array.isArray(order)) order = def; }
    catch { order = def; }
    // Repair: keep only known entries, append any default entries that
    // got added in a later release so the list never goes stale.
    order = order.filter((x) => def.includes(x));
    for (const d of def) if (!order.includes(d)) order.push(d);
    const list = box.querySelector(".stg-reorder-list");
    const render = () => {
      list.innerHTML = order.map((name, i) => `
        <div class="stg-reorder-item">
          <span class="stg-reorder-label">${htmlEscape(name)}</span>
          <button class="sm stg-reorder-up" data-i="${i}" type="button" ${i === 0 ? "disabled" : ""}>▲</button>
          <button class="sm stg-reorder-down" data-i="${i}" type="button" ${i === order.length - 1 ? "disabled" : ""}>▼</button>
        </div>`).join("");
      list.querySelectorAll(".stg-reorder-up").forEach((btn) => btn.addEventListener("click", () => {
        const i = +btn.dataset.i;
        if (i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; persist(); render(); }
      }));
      list.querySelectorAll(".stg-reorder-down").forEach((btn) => btn.addEventListener("click", () => {
        const i = +btn.dataset.i;
        if (i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; persist(); render(); }
      }));
    };
    const persist = () => localStorage.setItem(key, JSON.stringify(order));
    render();
    box.querySelector(".stg-reorder-reset")?.addEventListener("click", () => {
      order = def.slice();
      persist(); render();
      Toast.success("Reset to default order");
    });
  });
  pane.querySelectorAll(".stg-layout-select").forEach((sel) => {
    const key = sel.dataset.layoutKey;
    const stored = localStorage.getItem(key);
    if (stored) sel.value = stored;
    sel.addEventListener("change", () => {
      localStorage.setItem(key, sel.value);
      Toast.success("Layout preference saved");
    });
  });
