# StriVo Roadmap

## North star

**StriVo is becoming a domain-agnostic stream→clip analytics & content-creation
engine** — it ingests live streams and clips, extracts structured signals from them
*as fast as they are recorded*, and turns those signals into something parsable,
saveable, exportable, and beautiful to look at. The fused reference points are
"creative cloud" creator tooling on one side and TotalSportsPro / Stats-Perform-class
org data crunching (the kind done for leagues like the MLB) on the other.

The capture PVR and the DAW/plugin toolkit are **not the product** — they are the
**substrate** that feeds the engine. Capture lands the media; the plugin swarm
extracts and edits; the engine assembles those signals into analysis and visualisation.

The core is **domain-agnostic**: one extract → parse → analyse → visualise → export
pipeline. Sports analytics and creator content-creation are **templates/configs** on
top of that core, not separate codebases. The shared engine is sequenced first; the
domain templates land on it.

> **Status legend:** ✅ shipped & wired end-to-end · 🟡 built but not wired / shallow ·
> ⬜ not started · ⏸ deferred (with reason).
>
> **Definition of done (non-negotiable):** a milestone is ✅ only when it is wired
> end-to-end — a pure-data crate with tests is necessary but **not sufficient**.
> Stubs, inert modules, hardcoded paths, and "tested but disconnected" code are tracked
> below as 🟡/⬜ blockers, never presented as shipped. Stubbing is not an acceptable
> end-state; it is a tracked debt with an owner phase.

---

## Where StriVo actually is today (v0.5.0)

This is the honest substrate inventory — what is genuinely built and wired, and what
exists but is inert. The engine work below builds on this; it does not replace it.

### Capture & dispatch — solid foundation ✅
- Web-only frontend (the ratatui TUI was removed in `2ab4e6c`); `strivo` launches the SPA.
- Recording pipeline: live + VOD capture, gap-resume segment merge, Twitch ad-trim,
  MPEG-TS→Matroska remux, deterministic UUIDv5 recording ids, HTTP-Range video seeking.
- **Recording dispatch is centralised** through `src/intents/` (`download_vod`,
  `start_recording`, `cookies::resolve`). The old "recording intent rebuilt at every call
  site" wound is **closed** — there is now one canonical translator. *(Closes adversarial
  wound #3.)*
- Daemon ↔ SPA over a Unix-socket IPC; SSE event stream to the browser.

### Extraction & editing crates — built, mostly wired ✅ / 🟡
~34 in-tree crates under `crates/<name>/`, each pure-data with unit tests, most wired to a
Pro-gated HTTP endpoint and surfaced on the SPA. Grouped:

| Group | Crates |
|---|---|
| Capture · transcribe · catalog | `strivo-plugins/{crunchr, archiver, viewguard, insights}` |
| Cut-discovery | `chapters` · `cuepoints` · `clipper` · `thumbnails` · `insights-compare` · `heatmap` · `viewguard-trend` · `chat-density` · `broll` |
| Editor / DAW core | `editor` · `deadair` · `branding` · `automation` · `loudness` · `captions` · `multitrack` · `brandsafe` · `structure` · `beat-detect` · `vad` · `scenes` · `sidechain` · `insert-fx` · `pitch` · `ab-render` · `submix` |
| Publish · view · meta | `reuse` · `casebook` · `multistream` · `chat` · `schedule-optimizer` · `marketplace` |
| Analytics / orchestration substrate | `dataviz` · `pipelines-dag` |

Transcription (`crunchr`), scene/cue detection (`cuepoints`), chat density
(`chat-density`), and cross-recording aggregation (`insights` — topics & frequency across
*every* analysed recording) all work and are wired.

### Analytics & orchestration substrate — built but only partly connected 🟡
This is the engine's spine, and it is the most over-claimed area. The truth:
- **`dataviz`** runs experiments over a `Corpus` via `POST /api/v1/dataviz/run` and returns
  chart-ready series. ✅ The runner works. 🟡 But **the corpus is assembled client-side** and
  passed in — there is no server-side corpus-assembly service over arbitrary scope.
- **`pipelines-dag` + `src/pipeline/`** is a *complete, tested* DAG model and executor:
  `Pipeline`, `Stage`, `StageKind`, `StageState`, topo-sort (`topo_order` / `assert_acyclic`),
  and a `PipelineRegistry` with `submit` / `mark_stage_done` / `retry_stage` (backoff) /
  `skip_stage` / `cancel_pipeline` / `mark_stage_failed` + a `ResourceRegistry` for locks.
  🟡 **But the daemon never drives it.** Nothing in `src/daemon.rs` or `src/recording/mod.rs`
  handles `PluginAction::SubmitPipeline` or advances the registry. The `/pipelines` route
  only renders `default_pipelines()` topo-ordered for *display*. The orchestration brain
  exists and is inert. **This is the single highest-leverage gap.**
- **Per-plugin SQLite is fragmented:** `crunchr.db`, `archiver.db`, `viewguard.db`, … each
  isolated. `insights` reaches into `crunchr.db` by a **hardcoded nested path**
  (`data_dir/plugins/crunchr/crunchr.db`). There is no unified, JOIN-able signal store, so
  cross-signal analytics (transcript × events × chat) cannot be expressed.

---

## The engine — phased milestones

Sequenced so each phase unblocks the next. Every phase lists its concrete blockers; none
is ✅ until wired end-to-end with tests.

### P1 · Unified signal spine ⬜ *(foundation — do first)*
Replace fragmented per-plugin SQLite with one canonical, append-only **signal store**
every extractor writes and every analytic reads:
`(recording_id, t_start, t_end, kind, label, payload JSON, confidence, source_plugin)`.
- **Blockers:** schema + migration; a write API for plugins; a query API for analytics;
  retire `insights`' hardcoded `crunchr.db` reach-in; fix the `viewguard` `data_dir`
  double-nest (web currently probes two paths as a workaround).
- **Unblocks:** cross-signal joins, the sports event spine (P4), real corpus assembly (P2).

### P2 · Corpus-assembly service ⬜
Move corpus assembly server-side: hydrate a `dataviz::Corpus` by
`recording | playlist | channel + date-range` from the P1 signal store, behind an endpoint.
- **Blockers:** scope resolver; signal→Corpus projection; pagination/streaming for large scopes.
- **Today:** `dataviz_run` exists but the SPA hand-assembles the corpus — caps scale and
  forbids cross-corpus analysis.

### P3 · Wire the DAG executor into the daemon 🟡→✅ *(highest leverage)*
Connect the already-built executor to the running daemon so pipelines actually run:
`PluginAction::SubmitPipeline` → `PipelineRegistry::submit` → dispatch ready stages to
plugin verbs → `mark_stage_done`/`mark_stage_failed` → advance → emit live state over SSE.
- **Blockers:** daemon-side registry ownership + tick; stage→verb dispatch bridge;
  surface live `StageState` on `/pipelines` (replace the static display); honour
  `ResourceLock` and `max_attempts`/backoff that the model already encodes.
- **Payoff:** turns the inert model into the real "record → extract → analyse → export"
  chain — the literal mechanism behind "as fast as it is recorded."

### P4 · Extraction adapters — domain-agnostic 🟡→✅
A common `Extractor` contract writing into the P1 signal store. Have today: transcription,
scene/cue, chat density. **Missing and required for the vision:**
- **Entity / event extraction** — timecoded structured events (the sports spine: plays,
  scores, players; for creators: segments, callouts). This is what makes "data crunching
  for orgs like the MLB" possible.
- **Visual / OCR** — scoreboards, lower-thirds, on-screen text → signals.
- **Blockers:** extractor trait + registry; per-extractor confidence + provenance;
  back-pressure so extraction keeps up with capture (feeds P8).

### P5 · Analytics over real corpora ⬜
- Experiment registry over `dataviz`; **cross-signal experiments** (join transcript ×
  events × chat from the P1 store).
- Incremental / streaming aggregation pushed over SSE so views update live.
- **Blockers:** experiment registration API; incremental aggregation engine; result cache.

### P6 · Visualisation & composer UI ⬜
The "beautiful, intuitive" surface: pick a corpus → pick an experiment → render via the
series' `chart_hint` → **export CSV / JSON / PNG**.
- **Have:** `dataviz_run` + the per-plugin insights pages.
- **Blockers:** a general composer (not per-plugin pages); chart-type auto-selection;
  export pipeline; saved views.

### P7 · Clip & export pipeline 🟡→✅
Make extraction land as artifacts: wire `clipper` + `captions` into `finalize_completion`
and the P3 DAG so *extract → select highlights → cut → caption → export* is one chain.
- **Blockers:** clip-selection from signals; export targets (clips, EDL, signal CSV/JSON);
  hook into the finish flow rather than manual invocation.

### P8 · Real-time — "as fast as it is recorded" ⬜ *(the headline promise)*
Streaming incremental extraction *during* capture, not post-hoc: extractors consume the
live segment as it lands, write signals to the P1 store, and analytics/visualisation update
live over SSE.
- **Blockers:** segment-tailing extractor harness; partial/streaming transcription &
  event detection; live signal writes + SSE fan-out; bounded latency targets.

### Capstone · Domain templates ⬜
On top of the domain-agnostic core, ship two configs (not codebases):
- **Sports template** — event taxonomy + stat rollups (MLB-style box-score from signals).
- **Creator template** — highlight/retention rollups + publish-ready clips.
- **Blockers:** template/config layer; taxonomy definitions; per-template composer presets.

---

## Cross-cutting blockers & hardening (tracked, must-fix)

Each is mapped to a phase or stands alone. None may be hidden behind a green checkmark.

| Item | State | Disposition |
|---|---|---|
| Daemon doesn't drive the pipeline executor | 🟡 | **P3** — top priority |
| Per-plugin SQLite fragmentation; `insights` hardcoded `crunchr.db` reach-in | 🟡 | **P1** |
| `viewguard` `data_dir` double-nest (web probes two paths) | 🟡 | **P1** |
| Corpus assembled client-side, not server-side | 🟡 | **P2** |
| Licence JWT ES256 signature **not verified** (`TODO(licence-verify)`, `routes/licence.rs:239`) | 🟡 | Security hardening — verify before any paid launch |
| `crunchr::queue_recording` is a headless stub; auto-transcribe now relies on the webui RPC verb path — confirm the verb actually enqueues end-to-end | 🟡 | **P3/P4** (verb→stage dispatch) |
| ffprobe results uncached — re-analyses on every `/probe` (heavy for long VODs) | ⬜ | Perf; cache keyed by path+mtime |
| Dynamic cdylib plugin loading coded but never triggered; no hot-reload | ⬜ | Deferred until third-party plugins are real |
| `yt-publish` marketplace entry needs YouTube OAuth (device-code + `youtube.upload`) | ⏸ | Deferred — needs Google Cloud creds |

### Adversarial-review wounds (from `ADVERSARIAL-REVIEW.md`, 2026-05-29)
That review's findings are folded in here as tracked status rather than a separate doc:
1. **Identity collapse** — resolved by this roadmap's north star + the README reconcile.
2. **Architectural straddle (TUI + web)** — resolved; the TUI is gone (`2ab4e6c`).
3. **No recording service** — resolved by `src/intents/`.
4. **Doctrine without enforcement** — partially open; the engine DoD above is the enforcement mechanism.
5. **No customer / forcing function** — reframed: the engine pivot (sports/creator data
   crunching) is the commercial thesis; a founder-level call, tracked, not a code task.

---

## What ships today, in detail (substrate record)

Preserved so the foundation is auditable. These are the building blocks the engine assembles.

### Shipped SPA surfaces
Top-bar routes: `/library` · `/recordings` · `/schedule` · `/pipelines` · `/watch` ·
`/chat` · `/plugins` · `/settings` · `/system` · `/logs` · `/history`.
Editor topbar (non-destructive EDL): split · ripple-delete · dead-air · voice-gate ·
sidechain duck · insert-FX · pitch/time · branding · loudness · beat-grid · history ·
scenes · loudness gauge · render-to-MKV.

### Capability matrix
`GET /api/v1/plugins/capabilities` lists every shipped plugin as `available`, with
multi-provider rows (e.g. `audience_retention` → heatmap + chat-density) and the
`x.`-prefixed capabilities (`x.pipelines_dag`, `x.loudness`, `x.scenes`, …).

### Marketplace
`crates/marketplace/src/lib.rs::default_catalog()` — 16 installed Cdylib entries + 1
roadmap entry (`yt-publish`).

### Test inventory
~386 pure-data unit tests across the in-tree crates (plus the daemon/web suites and the
recording/range/remux tests added in the v0.5.0 feature). All green; both `pro` and
`--no-default-features` modes build clean. The IPC handshake test was repointed from the
removed `app` module to `events::DaemonEvent`.

---

## Appendix · shipped history (condensed)

- **0.1.0** (2026-03-14) — initial release: monitoring (Twitch/YouTube/Patreon), ffmpeg
  recording, playback, daemon mode, CLI, TOML config + keyring. *(Originally TUI; since removed.)*
- **0.2.0 – 0.3.0** (2026-04-19) — Tier-1 UX + P0/P1 quality (nav, help overlay, Esc
  precedence, auto-reconnect supervisor, command palette).
- **0.3.0 → 0.4.0** — DAW phase-1 closeout, iters 21–53: branding, EDL revision history,
  multistream viewer, chat client, loudness, structure, automation, styled ASS captions,
  scenes, schedule-optimizer, beat-detect, VAD, sidechain, insert-FX, pitch/time. Plus the
  E2E audit catalogue (iters 25–38) and SPA polish.
- **0.4.0 → 0.5.0** — TUI removed (web-only), `strivo-plugins` folded into the workspace,
  `ab-render` + `submix` landed, backend integration batches (iters 54–84).

---

## Conventions

- Commit prefixes: `feat:` `fix:` `chore:` `refactor:` `ci:` `docs:` `test:` `perf:`.
- **No AI attribution** in commits, PRs, or code comments (per project CLAUDE.md).
- A milestone slice is: signal-store/contract change (where relevant) + pure-data crate +
  tests + **daemon/web wiring** + SPA surface + capability/marketplace registration + E2E
  verify + clean commit. The wiring step is what separates 🟡 from ✅.
