# StriVo PVR Backend — Architecture Analysis

_Read-only comparative analysis. No code was modified._

---

## 1. StriVo PVR Backend As-Is

### 1.1 Daemon Model

`src/daemon.rs:184–751` is a single Tokio `select!` loop that:
- Owns the Unix socket listener (`strivo.sock`) and multiplexes up to 64 concurrent IPC clients via a `tokio::sync::Semaphore` (line 629).
- Maintains an in-memory `DaemonState` struct (lines 30–149) holding `Vec<ChannelEntry>`, `HashMap<Uuid, RecordingJob>`, platform-auth flags, a Patreon snapshot cache, and an auth-queue.
- Fans out all `DaemonEvent` values from an `mpsc::UnboundedSender` to all clients via a `broadcast::channel<DaemonEvent>(256)` (line 301).
- Handles a lifecycle journal by spawning a `persist_event` async closure on each `RecordingStarted`/`RecordingFinished` (lines 729–739).

The daemon evicts completed recordings beyond `MAX_TERMINAL_RECORDINGS = 200` on each `RecordingFinished`, keeping the in-memory map bounded (lines 59–77).

Graceful shutdown responds to both SIGINT and SIGTERM via `CancellationToken::cancel()` (lines 604–624). On shutdown the recording manager (`run_manager`) sends `.stop()` to every active `RecorderProcess` (lines 700–711). No explicit timeout is enforced on that stop sequence, so a hanging ffmpeg/yt-dlp process can block daemon exit indefinitely.

### 1.2 Live Detection

Three complementary mechanisms:

**A. Polling monitor** (`src/monitor/mod.rs:136–491`)
- A single `ChannelMonitor::run()` loop over all configured `Platform` impls in series. Each tick calls `fetch_followed_channels` then `check_live_status` for all channels on a platform, then merges state and emits `ChannelsUpdated` (lines 238–383).
- Default interval: 60 s, configurable to a 15-second floor (`poll_interval_secs`). Interval is live-updateable via an `AtomicU64` + `Notify` pair (lines 35–37, 83–85, 186–191) without a restart.
- On-demand re-poll via `ClientMessage::PollNow` / `poll_notify` (lines 199–206).
- Transient-failure isolation: per-platform channel-list failures fall back to `last_channels` cache (lines 344–358). A single platform API outage does not blank all channels.
- **All platforms share one monitor loop** — not per-channel, per-process supervision. A slow YouTube API call blocks Twitch live detection for the same tick.

**B. Twitch EventSub WebSocket** (`src/platform/twitch_eventsub.rs`)
- After Twitch auth succeeds, subscribes up to 10 channels (prioritising `auto_record_channels`) to `stream.online`.
- On notification, fires `poll_notify` to trigger an immediate poll, reusing the proven detection path (no parallel recording logic).
- Exponential backoff reconnect (2s → 60s ceiling) on socket errors.
- Hard limit: 10 WebSocket EventSub subscriptions per session (Twitch cap). The remainder are backstopped by polling.

**C. YouTube WebSub (PubSubHubbub)** (`src/platform/youtube_websub.rs`)
- Only active when `youtube.websub_callback_url` is set in config.
- Google's hub pushes new-video/live notifications to `strivo serve`'s `/yt-websub` endpoint, which fires `PollNow` over IPC.

### 1.3 Recording Lifecycle / State Machine

`RecordingState` (`src/recording/job.rs:6–13`):

```
ResolvingUrl → Recording → Stopping → Finished
                         → Failed
```

The recording manager (`src/recording/mod.rs:275–834`) uses a `HashMap<Uuid, ActiveRecording>` polled every 2 s. The state machine is not a formal type-state enum — transitions are string assignments that the persisted journal stores as lowercase strings (`"running"`, `"finished"`, `"interrupted"`).

**Start path**: `RecordingCommand::Start` spawns a URL-resolve task on a separate channel (`resolve_tx`). The job enters `ResolvingUrl` while resolve is in-flight. Once resolved, a `RecorderProcess` (either `FfmpegProcess` or `YtDlpProcess`) is placed in `ActiveRecording::process`. Two distinct start paths exist:
- YouTube + `from_start`: spawns `YtDlpProcess::with_options` with `--live-from-start`, resolving the `/live` alias to a `/watch?v=<id>` URL first (YT-2, YT-5).
- All other platforms: calls `stream::resolver::resolve_stream_url` (streamlink), then `FfmpegBuilder`. For Twitch + `from_start` + config opt-in: attempts the Twitch rewind path (Helix→GQL→Usher `/vod/v2`) before falling back to streamlink (lines 487–586).

**Retry on crash**: ffmpeg exits non-zero → up to 3 retries with exponential backoff (`2^retry_count` seconds, 1→2→4s). Each retry appends a `_partN.mkv` segment file (M5.5 gap-resume). On `Finished`, all segments merge via mkvmerge.

**Finalize pipeline** (`src/recording/mod.rs:143–273`, `finalize_completion`):
1. (if multi-segment) merge via `mkvmerge`
2. (if Twitch + `auto_trim_ads`) `adtrim::trim_in_place` — ffmpeg `blackdetect` + concat-copy
3. (always on `Finished`) `remux::normalise_container` — sniff first 12 bytes, losslessly remux MPEG-TS→MKV via `ffmpeg -c copy`

This pipeline runs in a `tokio::spawn` to avoid blocking the manager loop.

**Auto VOD backfill** (`src/recording/vod_backfill.rs`): On `RecordingFinished` for a Twitch job, waits `vod_backfill_delay_secs` (default 300 s) then queries Helix `/videos?type=archive` and queues a `DownloadVod` for the matching archive.

### 1.4 Finalize / Remux Pipeline

`src/recording/remux.rs`: Header sniff (12 bytes). EBML/MP4 → `AlreadyOk`. `0x47` (MPEG-TS sync) → remux using:
```
ffmpeg -y -c copy -bsf:a aac_adtstoasc -f matroska
```
Atomic swap: `original → .orig.mkv`, `tmp → original` (lines 81–89). Pre-remux bytes survive as `.orig.mkv` — a safety copy the user must manually delete. This is never cleaned up automatically.

`src/recording/adtrim.rs`: ffmpeg `blackdetect` → parse ranges from stderr → concat filter with keyframe-snap trim. No re-encode; the cut lands on the nearest GOP boundary.

`src/recording/segments.rs`: `mkvmerge --append` to merge gap-resume segments.

### 1.5 Jobs Persistence Schema

`src/recording/persist.rs:16–64` defines four tables in `{data_dir}/jobs.db`:

```sql
jobs(id PK, kind, payload TEXT, state, created_at, updated_at, attempts, last_error, episode_dir)
catalog(platform, channel_id, vod_id PK, title, published_at, episode_dir, recorded_at, transcribed_at)
crunchr_queue(job_id PK, episode_dir, backend, diarize, state, created_at, updated_at, attempts, last_error)
blocklist(platform, channel_id, vod_id PK, reason, created_at)
```

`PersistDb` wraps a single `tokio::sync::Mutex<rusqlite::Connection>` with WAL mode + NORMAL sync. Every operation acquires the lock; there is no connection pool or read/write split. This is adequate for single-instance use but creates lock contention if many persist calls pile up during rapid recording starts.

`jobs.payload` stores the full `RecordingJob` as a JSON blob. State is stored separately in `jobs.state` and overrides the payload's embedded state on load (`map_journal_state`, lines 515–527). This split means `payload` can drift from `state` — the journal wins on conflict.

Orphan recovery at startup: any `running/queued` jobs are marked `interrupted` in a single UPDATE (lines 486–500).

### 1.6 IPC Design

Unix socket (`strivo.sock`) with newline-delimited JSON framing (`ipc::encode_message`, line 169). Two message types:

- `ClientMessage` (client→daemon): 18 variants covering Hello, recording commands, PollNow, Shutdown, PluginRpc, BulkDownload, Patreon/VOD pulls, delete operations, channel resolution, and SetPollInterval.
- `ServerMessage` (daemon→client): `StateSnapshot` (sent on Hello) and `Event(DaemonEvent)` (incremental broadcast).

The IPC is **not versioned**. New variants are additive/forward-compatible only if all callers understand all existing variants. A TUI built against an older daemon or vice versa can silently lose messages on unknown variant deserialization.

The TUI `Recording(RecordingCommand)` envelope and the webui's thin `Start {…}` envelope both live on the wire simultaneously (comment at `ipc.rs:84`). The old fat envelope is flagged for removal when the TUI is deleted (task #13).

There is no REST/HTTP API on the daemon itself — the web API lives in `crates/strivo-web` (axum), which speaks to the daemon over the same Unix socket.

### 1.7 Scheduling

`src/recording/schedule.rs`: A single `tokio::time::interval(30s)` loop that evaluates cron expressions. Uses the `cron` crate. State (last-triggered timestamps) persisted to `state_dir/schedule-state.json` (plain JSON, atomic-write only via `serde_json::to_string_pretty` + `fs::write` — NOT tmp+rename, so it can corrupt on crash).

Schedule entries are channel + cron + duration. Schedules are checked with a ±60 s window; a 120 s dedup guard prevents double-firing. Known limitation (flagged in `config_warnings`): a channel in both `auto_record_channels` and `schedule` will perpetually double-capture.

**There are no user-visible "named scheduled tasks" like Sonarr's System > Tasks** — no task list, no last-run time, no manual-trigger UI. The schedule manager is configuration-only.

### 1.8 Config Model

`src/config/mod.rs`: TOML file at `{config_dir}/config.toml`. Config is loaded at daemon startup and **not hot-reloaded** — a running daemon's `self.config` snapshot is updated only when the webui's settings API saves and the daemon is restarted, or (for poll interval) via the `SetPollInterval` IPC message. The comment at `monitor/mod.rs:470` acknowledges this: "refreshed by the daemon's config-reload path" — but no config-reload path is actually wired to SIGHUP or a FileWatcher.

Config save uses a backup+overwrite pattern (copy old → `.backup`, write new) but does NOT use tmp+rename (line 966–969). The write is not atomic on POSIX — a crash during `std::fs::write` can corrupt `config.toml`. The `.backup` file is the safety net but requires manual recovery.

Capture profiles (`[[capture_profiles]]`) are a named, reusable recording-settings object assignable to auto-record channels. They support format/codec/transcode/audio-only/transcript/cutoff-episodes overrides. This is the closest analogue to Sonarr's Quality Profiles.

---

## 2. Gap Analysis vs Exemplars

| Pattern | Sonarr / *arr | streamerREC | StriVo | Evidence |
|---|---|---|---|---|
| **Named scheduled tasks with visible intervals** | Full (System > Tasks, configurable intervals, manual trigger, run history) | No | Partial (cron schedule config works, but no task list/UI/history) | `src/recording/schedule.rs`; no UI surface for task durations |
| **Supervised per-channel monitor loop with crash isolation** | N/A (RSS-based) | Yes (one coroutine per channel) | No — single loop over all platforms in series | `src/monitor/mod.rs:238–383` — one `poll_all()` iterates all platforms sequentially; a blocking platform call delays all channels |
| **Stall / liveness detection on in-flight recordings** | Via download-client polling | Yes (data-rate watchdog, auto-stop) | No | `src/recording/mod.rs:716–725` — `file_size()` is polled every 2 s but no "bytes unchanged for N seconds → mark stalled/restart" check exists |
| **Concurrency caps / semaphore for recordings** | Via download-client categories | Yes (global slot counter) | Partial (db-backed gate via `max_concurrent_recordings`, disabled by default) | `src/monitor/mod.rs:420–436` — only gated at auto-record trigger time, not at `RecordingCommand::Start` dispatch |
| **Quality-profile abstraction** | Full (ordered tiers, cutoff, upgrades, Custom Formats scoring) | Simple per-channel dropdown | Partial (CaptureProfile: format/codec/transcode/audio-only, no quality tiers or scoring) | `src/config/mod.rs:529–556` |
| **Delay-profile "wait before commit"** | Yes (per-tag timer before grabbing) | No | No | Not present anywhere |
| **Import / post-processing pipeline** | Full (parse, quality check, hardlink/copy, rename, notify) | Optional lossless remux | Partial (merge segments → ad-trim → remux → ScheduledEvent; no rename templating post-import) | `src/recording/mod.rs:143–273` |
| **Atomic state writes** | SQLite WAL | tmp+rename JSON | Partial — remux uses rename (remux.rs:81–89), EDL uses rename (edl/mod.rs:36–46), but `config.toml` save and `schedule-state.json` do NOT use tmp+rename | `src/config/mod.rs:966`, `src/recording/schedule.rs:37–41` |
| **Health / readiness checks** | Full page (system, indexers, download clients, disk) | None | None — `check_external_tools()` at startup only (not runtime-surfaced) | `src/daemon.rs:233`; no health endpoint in the web API |
| **REST API completeness / versioning** | v3/v4 with OpenAPI, all UI via API | FastAPI with docs | Partial — `/api/v1/…` in strivo-web, no versioning contract, IPC has no version field | `src/ipc.rs` (no version), `crates/strivo-web/src/routes/api.rs` |
| **Notification / webhook system** | 20+ integrations, uniform trigger model | Webhook JSON POST on 2 events | Partial — `DaemonEvent::Notification` exists as internal event; `notify-rust` dependency present in Cargo.toml but not actually called in daemon or web crate; desktop notification config fields are wired in web API but nothing dispatches them | `src/config/mod.rs:647–683`, grep confirms no `notify_rust::` callsite |
| **Retry / backoff** | Download-client polling cycle | Configurable auto-retry count | Partial — 3 retries with exponential backoff for live captures; VOD backfill is fire-and-forget with no retry | `src/recording/mod.rs:740–818` |
| **Hardlink-or-copy import** | Preferred: hardlink, fallback copy | No | No — files are written directly to final path; no import step from a staging area | N/A |
| **Remote-path mapping** | Yes (Docker cross-host path rewrite) | No | No | N/A |
| **Backup / restore** | Scheduled + on-demand in System > Backups | Import/export JSON | None — config has `.backup` copy but no archive/restore UI | `src/config/mod.rs:960–970` |

---

## 3. Top Backend Gaps, Risks, and Opportunities

### HIGH Priority

**H1. Stall detection is absent — silent recording death**
The recording manager polls `file_size()` every 2 s but never checks whether it grew. A recording where ffmpeg freezes (network stall, Twitch reconnect hang, yt-dlp spinner) remains in `RecordingState::Recording` indefinitely with a frozen byte counter. The file on disk never finishes; no alert fires. Fix: track `prev_bytes_written` per `ActiveRecording`; if `file_size()` has not grown for N seconds (e.g. 120 s configurable), emit a warning `Notification` and optionally stop + retry. Analogous to streamerREC's stall watchdog.
_Location_: `src/recording/mod.rs`, within the `poll_interval.tick()` branch, lines 714–831.

**H2. Desktop notifications are configured but never dispatched**
`notify-rust = "4"` is in Cargo.toml. `NotificationsConfig` has per-event flags (`on_go_live`, `on_recording_finished`, `on_recording_failed`). The web API accepts and saves these flags. But no code in the daemon, web crate, or TUI crate ever calls `notify_rust::Notification::new().show()`. The `DaemonEvent::Notification` variant exists and is propagated on the broadcast channel, but no subscriber routes it to the OS notification subsystem. Fix: a small subscriber in the daemon's event loop that checks `config.notifications.desktop_enabled` and the per-event flags, then calls `notify_rust`. This is ~15 lines.
_Location_: `src/daemon.rs:689` (event_rx recv arm), `src/config/mod.rs:647–683`.

**H3. Config save is not atomic — potential config corruption**
`AppConfig::save()` uses `std::fs::write(&path, contents)` directly (line 969). On Linux, `write(2)` is not atomic; a SIGKILL mid-write leaves a partial TOML file. The `.backup` copy (line 963) provides recovery, but only if the user notices and manually applies it. Fix: write to `config.toml.tmp` then `rename()`; this is the same pattern already used in `remux.rs:81–89` and `edl/mod.rs:36–46`.
_Location_: `src/config/mod.rs:948–970`.

**H4. No webhook/outbound notification — critical missing feature vs competitor**
streamerREC ships a two-event webhook (stream_live, recording_complete). Sonarr has 20+ integrations. StriVo has no outbound HTTP notification on any event. The internal `DaemonEvent::Notification` is the right abstraction — a webhook dispatcher subscribed to it (like the desktop notification subscriber in H2) would be a 50-line addition. This is the single most-requested feature class for self-hosted PVRs (n8n/Zapier/Gotify/ntfy integration).
_Location_: new feature; wire through `AppConfig::notifications` and a new `webhook_url` field.

### MEDIUM Priority

**M1. Single-loop monitor does not isolate slow/broken platforms**
`poll_all()` iterates platforms in sequence (`src/monitor/mod.rs:241–358`). A YouTube quota error that takes 10–20 s to time out delays Twitch live detection for the same tick. For two platforms this is tolerable; for three or more it compounds. Fix: run per-platform polls as concurrent `tokio::spawn` tasks, collecting results. The `last_channels` fallback cache is already wired for this; only the loop structure needs changing.
_Location_: `src/monitor/mod.rs:238–383`.

**M2. Concurrency cap is porous — only gated at auto-record trigger**
`max_concurrent_recordings` is checked in `ChannelMonitor::max_concurrent_reached()` (line 420), which fires only at auto-record trigger time. A manually-issued `ClientMessage::Start` bypasses this gate entirely (`src/daemon.rs:905–933`). The IPC `Recording(RecordingCommand::Start)` envelope also bypasses it (line 845). Fix: move the concurrency check into `run_manager`'s `RecordingCommand::Start` handler (line 308) with a consistent gate.

**M3. `count_finished_recordings` is O(N) full table scan**
`src/recording/persist.rs:365–374` implements cutoff-episode counting by loading all `RecordingJob` rows and filtering in Rust. As the journal grows, this becomes increasingly expensive. Fix: add a `WHERE channel_id=? AND state='finished'` SQL query instead.

**M4. Schedule state JSON not written atomically**
`ScheduleState::save()` (`src/recording/schedule.rs:37–41`) calls `fs::write` directly — same risk as config.toml (H3). A crash during a scheduled recording's trigger can corrupt the dedup state, causing the next daemon start to fire the schedule again for a window that was already started.
_Location_: `src/recording/schedule.rs:37–41`.

**M5. IPC protocol has no version field — silent incompatibility**
Adding a new `ClientMessage` variant is backward-compatible only if callers gracefully ignore unknown variants on deserialization. `serde_json` does not do this for tagged enums by default — an old client receiving a new `ServerMessage::Event(DaemonEvent::SomeNewVariant)` variant will fail to deserialize and log a warning, but a new client sending a command to an old daemon will silently drop it (the daemon prints "Invalid client message"). Fix: add a `version: u32` field to `Hello`/`StateSnapshot`, or adopt a `#[serde(other)]` catch-all variant.
_Location_: `src/ipc.rs`.

**M6. Retry gap-resume only works for FFmpeg paths, not yt-dlp**
The M5.5 retry logic (`src/recording/mod.rs:740–789`) checks exit status and re-resolves via `resolver::resolve_stream_url` + `FfmpegBuilder`. A YouTube `from_start` recording (yt-dlp path) that exits non-zero hits the same retry branch but calls the ffmpeg fallback path instead of re-spawning yt-dlp with `--live-from-start`. Line 771 calls `resolver::resolve_stream_url` unconditionally, so a yt-dlp live capture that drops reconnects as an FFmpeg stream — wrong tool, likely to fail differently.
_Location_: `src/recording/mod.rs:763–789`.

### LOW Priority

**L1. `.orig.mkv` safety copies accumulate indefinitely**
`remux::normalise_container` keeps the pre-remux bytes as `<stem>.orig.<ext>` (line 57). Over time, every TS-detected file doubles disk usage. No cleanup job exists. Fix: auto-delete the `.orig` file after verifying the remuxed file is readable (or make it a config option).

**L2. `jobs.payload` / `jobs.state` drift is a latent correctness hazard**
The persisted `payload` is the `RecordingJob` JSON snapshot at job-creation time. The `state` column is updated later. `load_recording_jobs` overrides `job.state` from the column (line 346–353), which is correct, but `job.bytes_written` and `job.duration_secs` in the payload are frozen at creation (0). The journal therefore never reflects final file size or duration for a crashed job. Not blocking, but confusing in the history view.

**L3. TaskRegistry (`src/tasks/mod.rs`) is wired for TUI only, disconnected from daemon**
A well-structured `TaskRegistry` with `TaskKind` (Record, Transcode, ArchiverPull, CrunchrAnalyze, ThemeImport) exists. It is not connected to the daemon event loop or broadcast channel — it is only used within TUI `AppState`. The Sonarr-style "System > Tasks" visibility (user sees what's running and can manually trigger) cannot be built until this registry is accessible to the IPC layer. Low effort to expose; high UX value.

---

## 4. Logic-Error / Wiring Smells

**4.1 Desktop notification config is a dead letter**
`NotificationsConfig` fields (`on_go_live`, `on_recording_finished`, etc.) are defined (`src/config/mod.rs:649–683`), persisted to config.toml, settable via the web API (`crates/strivo-web/src/routes/api.rs:1096–1100`), and documented in inline comments as "notify-rust integration." But no `notify_rust::` call exists anywhere in the codebase. The feature was designed and plumbed but never implemented. This is the most significant "documented but not wired" gap in the codebase.

**4.2 `PluginRpc` dispatch stubs out TUI-only actions silently**
`process_daemon_plugin_actions` (`src/daemon.rs:1137–1176`) has a catch-all `_ => {}` arm for TUI-only actions (pane activation, mpv playback, config persistence). These actions are legal plugin responses but silently dropped in daemon context. If a plugin fires `ActivatePane` from a daemon-dispatched verb, there is no error, no log, and no indication to the plugin that the action was ignored. Fix: log at debug level when a TUI-only action is received in daemon context.

**4.3 Creator-feature vestiges in PVR-default code paths**
`DaemonState` includes `patreon_creators` and `patreon_posts` fields (lines 36–41 of daemon.rs). `DaemonEvent::PatreonState` is in the core event enum (events.rs:73–79). These are Patreon monitoring features, not creator-feature-gated (they exist in the default build). The Patreon platform/monitor is similarly outside `#[cfg(feature = "creator")]`. This is arguably intentional (Patreon is a content-consumer feature), but it means the "pure PVR" default binary includes Patreon polling machinery unconditionally.

**4.4 `RecordingCommand::Recording(…)` and `ClientMessage::Start {…}` coexist on the wire**
The comment at `ipc.rs:84` explicitly acknowledges this: "The fat `Recording(RecordingCommand::Start …)` envelope stays on the wire for the legacy TUI; it goes away with TUI deletion (task #13)." Until that task lands, two code paths exist for starting a recording — one that bypasses the `intents::start_recording` cookie/transcode resolution (the fat envelope, line 845) and one that uses it (the `Start` message, line 905). A caller using the fat envelope with `cookies_path: None` for a gated YouTube stream silently fails.

**4.5 `#[allow(dead_code)]` on many platform struct fields**
Multiple fields in `src/platform/twitch.rs` (lines 23, 32, 39, 70, 103, 375), `src/platform/youtube.rs` (lines 24, 67, 76, 110, 129, 675, 680), `src/platform/patreon.rs` (lines 15, 23, 34), and `src/plugin/mod.rs` (lines 47, 80, 125) are dead. These may be forward-looking scaffolding (e.g. fields planned for notifications or quality selection) or vestigial from the creator/TUI split. They should be audited and removed or made visible so they don't create confusion about the contract.

**4.6 VOD backfill has no cancellation token**
`vod_backfill::spawn` (`src/recording/vod_backfill.rs:47–52`) starts a `tokio::spawn` with a `tokio::time::sleep(delay_secs)` — typically 300 s. If the daemon is shutdown during that sleep, the spawned task will keep the runtime alive for the sleep duration before self-canceling. It does not participate in the daemon's `CancellationToken`. For a 5-minute delay this is a minor annoyance; it makes shutdown feel hung.

**4.7 `persist::count_finished_recordings` is O(N) via Rust-side filter**
As noted in M3: `src/recording/persist.rs:365–374` loads all 500 Recording jobs (`LIMIT 500`) and filters by `channel_id + state` in Rust. The SQL index (`idx_jobs_state`) is on `state` alone, so a channel with many recordings in a multi-channel deployment will always scan the full 500-row result. This is a correctness hazard if any channel has more than 500 historical records (the cutoff check would undercount, never reaching the threshold).

---

## Summary

The StriVo PVR backend is a well-structured Rust daemon with solid async foundations: two-path live detection (polling + EventSub/WebSub), a clean event-broadcast IPC model, SQLite-backed jobs journal with crash recovery, a three-stage finalize pipeline (merge → ad-trim → remux), and a thoughtful quality/format abstraction that mirrors Sonarr's Quality Profiles in miniature.

The primary gaps versus the exemplars are:

1. **No stall detection** — a frozen recording is invisible (H1, high risk)
2. **Desktop notifications designed but never wired** — notify-rust is in Cargo.toml but never called (H2 + 4.1)
3. **No webhook outbound** — the most obvious missing self-hosted PVR feature (H4)
4. **Config save not atomic** — crash-corruptible config.toml (H3)
5. **Single-loop monitor** — a slow platform blocks all live detection (M1)
6. **Concurrency gate is porous** — manual starts bypass `max_concurrent_recordings` (M2)
7. **IPC has no version** — silent incompatibility on schema changes (M5)
8. **yt-dlp retry falls back to FFmpeg** — wrong reconnect path for YouTube live-from-start (M6)
9. **`.orig.mkv` accumulates** — disk leak after every MPEG-TS remux (L1)
10. **TaskRegistry disconnected from daemon** — Sonarr-style task visibility not buildable yet (L3)
