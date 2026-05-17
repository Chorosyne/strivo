# Settings Coverage Audit (M2 Phase 1)

Walks every field in `src/config/`. Tags follow the ROADMAP M2 audit
convention:

| Tag | Meaning |
|---|---|
| `exposed` | Reachable from the TUI settings tab today |
| `hidden` | Settable in `config.toml` only; not in the TUI |
| `derived` | Computed from another field (not user-authored) |
| `secret` | Credential — never displayed; masked everywhere |

The "Target group" column is where the field lands in the M2.2 redesign
(Recording / Archiver / Crunchr / Notifications / Output / Theme /
Keymap).

---

## `AppConfig` (root)

| Field | Type | Default | Today | Target group | Notes |
|---|---|---|---|---|---|
| `recording_dir` | `PathBuf` | `~/Videos/StriVo` | hidden | Recording | Used by FFmpeg output and recording scanner. Path editor needed. |
| `poll_interval_secs` | `u64` | `60` | hidden | Output | Min clamped to 15s by monitor. Int editor. |
| `twitch` | `Option<TwitchConfig>` | absent | secret | — | Wizard owns; never shown in settings. |
| `youtube` | `Option<YouTubeConfig>` | absent | secret | — | Same. |
| `patreon` | `Option<PatreonConfig>` | absent | secret | — | Same. |
| `recording` | `RecordingConfig` | default | partial | Recording | `transcode` exposed via row + `t`. Codec/bitrate/container hidden. |
| `theme` | `ThemeRef` | `Named("neon")` | exposed | Theme | Ctrl+T picker exists. Settings row also cycles. |
| `ui` | `UiConfig` | default | hidden | Output | `reduce_motion` + `verbose_status`. Bool toggles needed. |
| `auto_record_channels` | `Vec<AutoRecordEntry>` | empty | derived | — | Maintained via Sidebar `a`. Not user-authored in the TUI. |
| `schedule` | `Vec<ScheduleEntry>` | empty | exposed | — | Schedule pane (M1.3.a) renders / edits this. |
| `crunchr` | `CrunchrConfig` | default | partial | Crunchr | Plugin config modal owns most fields. Settings tab will surface read-only summary. |
| `archiver` | `ArchiverConfig` | default | hidden | Archiver | All fields hidden today. |
| `config_path` | `Option<PathBuf>` | runtime | derived | — | `#[serde(skip)]` — not a user field. |

## `RecordingConfig`

| Field | Type | Default | Today | Target group | Notes |
|---|---|---|---|---|---|
| `transcode` | `bool` | `false` | exposed | Recording | Settings row 3 + `t` hotkey. |
| `filename_template` | `String` | `{channel}_{date}_{title}.mkv` | hidden | Recording | String editor needed. |
| `format` | `RecordingFormat` | default | hidden | Recording | Nested — see below. |

### `RecordingFormat` (nested under `[recording.format]`)

| Field | Type | Default | Today | Target group | Notes |
|---|---|---|---|---|---|
| `format` | `Option<String>` | `"best"` | hidden | Recording | yt-dlp `-f` selector. String editor. |
| `bitrate_kbps` | `Option<u32>` | none | hidden | Recording | Int editor; only meaningful for transcode paths. |
| `container` | `Option<String>` | `"mkv"` | hidden | Recording | Enum picker (mkv / mp4). |
| `video_codec` | `Option<String>` | `"copy"` | hidden | Recording | Enum picker (copy / h264_nvenc / libx264 / …). |
| `audio_codec` | `Option<String>` | `"copy"` | hidden | Recording | Enum picker (copy / aac / …). |

## `CrunchrConfig`

| Field | Type | Default | Today | Target group | Notes |
|---|---|---|---|---|---|
| `enabled` | `bool` | `false` | exposed | Crunchr | Plugin config modal. |
| `configured` | `bool` | `false` | derived | — | Set by the first-run modal — not user-authored. |
| `backend` | `String` | `"whisper-cli"` | exposed | Crunchr | Enum picker in plugin config modal. |
| `api_key_env` | `Option<String>` | none | exposed | Crunchr | String in plugin config modal. |
| `endpoint` | `Option<String>` | none | exposed | Crunchr | Same. |
| `whisper_model` | `Option<String>` | none | hidden | Crunchr | String editor. |
| `whisper_timeout_secs` | `u64` | `7200` | hidden | Crunchr | Int editor. |
| `analysis` | `CrunchrAnalysisConfig` | default | partial | Crunchr | Sub-table — see below. |
| `tandem_channels` | `Vec<String>` | empty | exposed | Crunchr | Plugin config modal — multi-select. |
| `tandem_playlists` | `Vec<String>` | empty | exposed | Crunchr | Same. |

### `CrunchrAnalysisConfig` (nested under `[crunchr.analysis]`)

| Field | Type | Default | Today | Target group | Notes |
|---|---|---|---|---|---|
| `enabled` | `bool` | `false` | hidden | Crunchr | Bool toggle. |
| `openrouter_api_key_env` | `Option<String>` | none | hidden | Crunchr | String editor. |
| `model` | `String` | `mistralai/mistral-7b-instruct` | hidden | Crunchr | String editor. |

## `ArchiverConfig`

| Field | Type | Default | Today | Target group | Notes |
|---|---|---|---|---|---|
| `enabled` | `bool` | `false` | hidden | Archiver | Bool toggle. |
| `configured` | `bool` | `false` | derived | — | Same as Crunchr. |
| `archive_dir` | `PathBuf` | `~/Videos/StriVo/Archives` | hidden | Archiver | Path editor. |
| `format` | `String` | `"best"` | hidden | Archiver | yt-dlp selector. String editor. |
| `concurrent_fragments` | `u32` | `4` | hidden | Archiver | Int editor; clamp 1..=16. |
| `rate_limit` | `String` | `""` | hidden | Archiver | yt-dlp rate-limit (`"5M"`); string editor. |
| `tandem_channels` | `Vec<String>` | empty | hidden | Archiver | Multi-select. |
| `tandem_playlists` | `Vec<String>` | empty | hidden | Archiver | Same. |

## `UiConfig`

| Field | Type | Default | Today | Target group | Notes |
|---|---|---|---|---|---|
| `reduce_motion` | `bool` | `false` | exposed | Output | Settings row 5. Also `STRIVO_REDUCE_MOTION` env. |
| `verbose_status` | `bool` | `false` | hidden | Output | Bool toggle. |

## `TwitchConfig` / `YouTubeConfig` / `PatreonConfig` (secret)

All credential structs (`client_id`, `client_secret`, `cookies_path`,
`poll_interval_secs`) are managed by the wizard or via env-var fallback.
The settings tab will show a per-platform connection-state row with a
"reconnect" action that re-runs device-code, but never displays the
secret values.

---

## Decisions falling out of the audit

1. **State vs config split** (M2.1.b) — `auto_record_channels` is
   derived (user toggles via Sidebar `a`), so it stays in `config.toml`
   but its mutation site has to keep the file in sync. Watch flags +
   last-used theme + recording-list cursor are TUI-managed; move them
   to `state.json`.
2. **Plugin sub-configs stay in plugin modals.** Settings tab gets a
   read-only summary row per plugin (`Crunchr: voxtral-api, analysis
   on`) that opens the plugin config modal on Enter.
3. **`configured: bool` fields** are derived and never user-edited.
   Hide them from the TUI but keep them in TOML.
4. **`config_path`** is `#[serde(skip)]` — a runtime placeholder.

## Counts

- `AppConfig`: 13 fields (3 secret, 1 derived skip-field, 9 candidates for the tab)
- `RecordingConfig` + `RecordingFormat`: 8 fields
- `CrunchrConfig` + `analysis`: 13 fields
- `ArchiverConfig`: 8 fields
- `UiConfig`: 2 fields
- Credential structs: 7 fields (all secret)

**Total ~51 user-authored fields.** TUI surfaces ~5 today; M2 closes
the gap by category, not by row count — the Crunchr modal already does
most of its 13 fields via a dedicated modal, for instance.
