# PVR web settings coverage

Reviewed 2026-09-08 against the SPA modules and Rust configuration/update
handlers in the F-05/F-07 remediation worktree based on `84ba7ca`. “Editable” means
there is a browser control and a corresponding backend mutation. Verification
for F-05/F-07 is recorded in the web-surface manifest; the other inventory rows
remain source-level observations.

The previous M2 TUI audit is retained in
[the historical snapshot](archive/SETTINGS-COVERAGE-M2.md). Its keyboard bindings,
plugin ownership, defaults and field counts do not describe the current product.
Creator plugin settings are outside this PVR review.

| Coverage | Meaning |
| --- | --- |
| Editable | A control exists in the current web UI. |
| Display only | Visible in the web UI, without an editor at that location. |
| TOML only | No matching PVR browser editor was found. |
| Runtime | Internal or generated state, not a settings control. |

## Root configuration

| Configuration | Current surface and limits |
| --- | --- |
| `recording_dir` | Editable in Settings → Recording, linked from General and onboarding. Use an existing absolute directory on the server; the backend checks directory access and writability. Saving does not move existing files. Restart the daemon to use the new destination. |
| `poll_interval_secs` | Editable on System, with a 15-second backend minimum; displayed in Settings → General. |
| `twitch`, `youtube`, `patreon` | Settings → Platforms Configure/Reconfigure wizards accept client ID and secret. Secrets use password inputs; this does not imply a security review of every credential path. |
| `recording` | Settings → Recording exposes the subset listed below. |
| `theme` | Retained config type; no PVR theme editor found. The removed TUI theme picker is not a web feature. |
| `ui` | Settings → Interface has Reduce motion and Verbose status toggles. Reduce motion also updates the root document class; downstream verbose-status behavior was not verified. |
| `auto_record_channels` | Managed through Library channel actions; General displays the count. Per-channel configuration is not automatically derived state. |
| `capture_profiles` | Recording can add a named quality tier and delete profiles. The Rust model also supports format overrides, transcode, audio-only, transcript and episode cutoff; the simple add form does not expose all of them. |
| `auto_pull_creators` | Retained Patreon auto-pull list; no matching PVR browser mutation was found in this review. |
| `schedule` | Monitor (`#/schedule`) displays advanced cron entries; add entries through `[[schedule]]` in TOML. Interface displays their count. |
| `extensions` | Flattened plugin-owned tables preserved on config round trips. Core no longer has typed `crunchr` or `archiver` fields. |
| `web.api_key`, `web.session_secret` | Generated/persisted authentication material; no general settings editor. |
| `notifications` | Settings → Notifications exposes desktop master, go-live, recording-finished, recording-failed and VOD-ready toggles, plus webhook enable and URL. |
| `monitor_limits` | Monitor exposes maximum concurrent recordings and reserved disk GB. Backend ranges are 0–64 and 0–100000 respectively; zero disables the cap. |
| `plugin_toggles` | Retained in config; Settings → Plugins is excluded from PVR navigation. |
| `config_path` | Runtime load/save location, skipped by serialization. |

## Recording and platform details

| Configuration | Coverage |
| --- | --- |
| `recording.filename_template` | Editable text field with token browser. |
| `recording.format.container` | Editable Container select; API path is `recording.container`, accepting `matroska`, `mp4`, `webm`. |
| `recording.transcode` | Editable toggle. |
| `recording.twitch_live_from_start` | Editable Record from start toggle. |
| `recording.auto_vod_backfill`, `recording.auto_trim_ads` | Editable toggles. |
| `recording.ad_min_secs`, `recording.vod_backfill_delay_secs` | TOML only. |
| `recording.format.format`, `bitrate_kbps`, `video_codec`, `audio_codec` | Editable under Settings → Recording → Advanced. Empty/reset removes the global override (`null` in the update API); channel/profile overrides still take precedence. Restart the daemon after saving. Codec names are validated for shape, not availability in the installed FFmpeg build. |
| `youtube.cookies_path`, `youtube.websub_callback_url` | Editable optional fields in the YouTube wizard. |
| `patreon.cookies_path` | Editable optional field in the Patreon wizard. |
| `patreon.poll_interval_secs` | No platform-wizard field found; distinct from the System channel poll interval. |

Interface layout order, grouping preferences and multi-view quality are
browser-local controls. They should not be counted as fields persisted through
the daemon configuration API.

## Evidence and remaining work

The current inventory was traced through:

- [`src/config/mod.rs`](../src/config/mod.rs): configuration types and ownership.
- [`032-pvr.js`](../crates/strivo-web/assets/spa/032-pvr.js): settings navigation and control wiring.
- [`034-pvr.js`](../crates/strivo-web/assets/spa/034-pvr.js): General, Notifications, Recording and Platforms controls.
- [`034b-pvr.js`](../crates/strivo-web/assets/spa/034b-pvr.js): Interface and Advanced controls.
- [`034d-pvr.js`](../crates/strivo-web/assets/spa/034d-pvr.js): platform wizards, System and Monitor editors.
- [`routes/api.rs`](../crates/strivo-web/src/routes/api.rs): setting allowlist and poll-interval persistence.

Recording workers retain their startup configuration. The directory and new
advanced fields return `restart_required: true` when saved; reload the daemon
using [the lifecycle instructions](DAEMON.md#lifecycle), after finishing or
stopping active captures. A browser reload only reads the saved values.

The bitrate is a yt-dlp selection preference and an FFmpeg encoding target for
the supported H.264 paths (`libx264` / `h264_nvenc`), not a promise that every
capture or codec will produce that bitrate. The yt-dlp selector is passed to
yt-dlp; an unavailable format or encoder may still fail when capture starts.

This replaces the obsolete exposure claims in F-08 and records the F-05/F-07
controls. It does not assert exhaustive coverage of nested capture-profile and
plugin fields or validate every platform/encoder combination.
