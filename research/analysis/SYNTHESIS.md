# StriVo PVR — Synthesis (split outcome + audit)

Date: 2026-06-25. Synthesises the two analysis passes
([ui-ux.md](ui-ux.md), [backend.md](backend.md)) against exemplar research
([../exemplars/](../exemplars/)) with a first-hand code audit done during the
PVR / Creator-Edition split. Verified claims are marked ✔; everything actioned
this session is marked **[fixed]**.

---

## 1. The split (done)

The default `cargo build` is now a **pure Live Stream PVR**; the Crunchr
transcriber, Archiver, and the ~33 analysis/audio/editor tool crates compile
only under `--features creator` ("strivo-creator-edition"). Mechanism: a
`creator` Cargo feature on `strivo-core` (gates the crunchr/archiver config +
`crunchr_auto` handshake), `strivo-web` (all 34 tool deps optional; plugin
routes mounted only under the feature), and `strivo-bin` (plugin registration
gated, fans out to the web/core feature). Workspace `default-members` = PVR
crates. Verified: both builds compile + pass tests (191 PVR tests); a
`compile_error!` probe confirmed the gate fires in creator and is absent in
PVR; legacy `[crunchr]`/`[archiver]` config sections still load (ignored).

The one thing the split does **not** reach is the **embedded SPA** (`spa.js`,
564 KB hand-written, not feature-gated). See §3.

---

## 2. Fixed this session (sweep)

| # | Issue | Where | Status |
|---|-------|-------|--------|
| 1 | notify-rust dep was dead — config flags + `DaemonEvent::Notification` plumbed, never dispatched | `src/daemon.rs` | **[fixed]** desktop banners now dispatched per-flag on a blocking task |
| 2 | `config.toml` save non-atomic (direct `fs::write`, crash-corruptible) | `src/config/mod.rs` | **[fixed]** tmp+rename |
| 3 | `schedule-state.json` save non-atomic (could re-fire schedule windows) | `src/recording/schedule.rs` | **[fixed]** tmp+rename |
| 4 | SPA can't tell editions apart → no way to hide creator UI | `strivo-web` settings API | **[fixed]** `creator_enabled` now in `/api/v1/settings` |
| 5 | redundant `Some(detect_mime(..)?)` | `recordings.rs` | **[fixed]** clippy |

PVR clippy is otherwise clean; the 44 remaining clippy warnings are all inside
creator-only crates (out of scope this session).

---

## 3. Creator-bleed in the SPA — the top remaining PVR gap ✔

The SPA is one embedded static asset, so backend feature-gating leaves creator
UI visible and **broken** in the PVR build. The `creator_enabled` flag (fix #4)
is the enabler; the SPA must now consume it. Verified sites:

- **TOPNAV** `spa.js:887-892` — Studio / Analytics / Publish / Pipelines always
  render; navigate to Pro-upsell cards or `GET /api/v1/pipelines/dag` → 404.
- **Recording Info modal** `spa.js:8050-8056` — 7 creator buttons (transcript,
  scene-detect, highlights, thumbnail, publish drafts, casebook, EDL editor)
  always shown for finished recordings; each fires a 404 toast in PVR.
- **Settings → Plugins** `spa.js:9960` — full Pro plugin catalog; "Open" → 404.
- **Monitor "Tandem downloads"** — permanently empty in PVR with no label.
- **dataviz** route + 30+ creator methods in the `API` object — dead weight.

**Recommended:** read `creator_enabled` once at boot, gate TOPNAV (filter in
`chrome()`), the modal buttons, the Plugins tab (→ upgrade CTA), and the Monitor
section. Larger follow-up: a build-time SPA split to drop the dead creator JS.

---

## 4. Backend gaps & risks (tracked → ROADMAP) ✔

| Pri | Item | Evidence |
|-----|------|----------|
| HIGH | **Stall detection absent** — `file_size()` polled every 2 s but never compared; a frozen ffmpeg/yt-dlp stays `Recording` forever, silently | `src/recording/mod.rs:714-831` |
| HIGH | **No outbound webhook** — `DaemonEvent::Notification` is the right seam; ~50-line dispatcher unlocks n8n/ntfy/Gotify/Discord. Most-requested self-hosted PVR feature | new |
| MED | **Single-loop monitor** — platforms polled in series; a slow YouTube call delays Twitch detection that tick | `src/monitor/mod.rs:238-383` |
| MED | **Concurrency cap porous** — `max_concurrent_recordings` only enforced at auto-record trigger; manual `Start` paths bypass it | `src/daemon.rs:845,905`; `src/monitor/mod.rs:420` |
| MED | **IPC unversioned** — new variant → silent drop/deser failure across peer versions | `src/ipc.rs` |
| MED | **yt-dlp retry falls back to FFmpeg** — YouTube live-from-start reconnect uses the wrong process | `src/recording/mod.rs:763-789` |
| MED | **`count_finished_recordings` O(N)** — loads ≤500 rows, filters in Rust; >500/channel undercounts the cutoff | `src/recording/persist.rs:365-374` |
| LOW | **`.orig.mkv` accumulates** — every MPEG-TS remux leaves a safety copy, never cleaned | `src/recording/remux.rs:57` |
| LOW | **VOD backfill ignores CancellationToken** — 300 s sleep makes shutdown feel hung | `src/recording/vod_backfill.rs:47` |
| LOW | **TaskRegistry TUI-only** — blocks a Sonarr-style System→Tasks view until exposed over IPC | `src/tasks/mod.rs` |
| LOW | dead `#[allow(dead_code)]` platform fields — audit/remove vestiges | `src/platform/{twitch,youtube,patreon}.rs` |

---

## 5. PVR feature gaps vs *arr / streamerREC (tracked → ROADMAP) ✔

- **Calendar / upcoming-streams grid** — Schedule is a cron table only; Sonarr
  calendar + Jellyfin EPG are the bar. 7-day strip off existing `next_fire`.
- **Per-channel quality/format overrides in the UI** — `AutoRecordEntry` already
  has `format`/`profile`; the Settings/Monitor UI never writes them. streamerREC has it.
- **Quality profiles (tiered)** — only boolean transcode + container today;
  `CaptureProfile` is the nearest analogue and could grow tiers.
- **Storage gauge** — `/api/v1/storage` returns the data; no visual bar.
- **Concurrent-slot indicator** ("N / M rec"), filename-template token browser,
  JSON channel import/export — all small, all expected by competitors.

---

## 6. DESIGN.md deviations — RESOLVED (JellySkin is canonical)

Decision (owner, 2026-06-25): **JellySkin is the current SPA design trajectory.**
DESIGN.md was the stale side and has been corrected to match `spa.css`:

- **Theme**: DESIGN.md §"Web UI Theme" rewritten ElegantFin → **JellySkin**
  (navy `hsl(208,89%,5%)`, 25px frosted glass, 45° gradient, 130° purple→cyan
  accent), tokens mirrored from `spa.css :root`.
- **Font**: SPA typeface is **Montserrat** (JellySkin). DESIGN.md typography now
  scopes Montserrat to the SPA and Satoshi/Instrument Sans to marketing/docs.
- **CDN**: switched `spa.css` `@import` from Google Fonts → **Bunny Fonts**
  (same Montserrat, no IP/referer leak) — the one substantive code change.
- **Accent**: the SPA intentionally uses JellySkin purple/cyan; brand cyan
  `#00E5FF` stays the TUI/marketing accent. Both DESIGN.md and `spa.css` now
  state this explicitly, so there is no remaining internal conflict.
