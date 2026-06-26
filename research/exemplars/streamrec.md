# streamerREC — Direct Competitor Research

Source: https://github.com/orhogi/streamerREC (accessed 2026-06-25)
Stars: 4 (very new, active dev)
License: MIT
Stack: Python (FastAPI/uvicorn), yt-dlp, FFmpeg, HTML/CSS/JS frontend
Docker-first deployment; state stored in ./recordings/state.json

**This is the closest existing competitor to StriVo: a self-hosted live stream recorder with a web UI.**

---

## What It Is

streamerREC automatically monitors and records live streams from 30+ platforms using yt-dlp.
Single-process server + web dashboard, Docker-compose deployment, recordings stored as flat
files. No TUI, no transcript analysis — pure auto-record PVR.

Platforms supported: YouTube, Twitch, TikTok, Kick, Bilibili, Instagram, Facebook, Twitter/X,
Rumble, Vimeo, Dailymotion, Niconico, Douyin, Huya, Douyu, Afreeca, Sooplive, Naver, Weibo,
Bigo, Twitcasting, Pandalive, and 10+ cam sites via yt-dlp.

---

## Information Architecture (Web UI pages)

1. **Channels** (main dashboard) — list of monitored channels with live status badges, recording controls
2. **Recordings** — browse/preview/download/delete completed recordings
3. **Settings** — global defaults, proxy, cookies, auto-retry behavior, retention, concurrency

There is no calendar, no wanted queue, no quality profiles — simpler than *arr. The channel list
is the core unit.

---

## Standout UX Patterns

### Channel Dashboard (main page)
- Cards or list rows per monitored channel, showing:
  - Channel name + platform icon
  - Live status indicator (live/offline)
  - Stream title (what the streamer is currently broadcasting)
  - Real-time recording stats: file size, download speed, duration
  - One-click Record / Stop button
- **Bulk Actions**: multi-select channels → record all, stop all, delete, edit quality/format
- **Drag-and-drop reordering** of channel list
- **Per-channel notes** field (private annotation)
- **Search & Filter**: by name, platform, notes, stream title
- **Sort**: by name, platform, recently added, last checked, live-first
- **Concurrent slot indicator**: "2/6 recording slots in use"
- **Keyboard shortcuts**: N to add, 1-4 to navigate pages, R/S/Del for bulk actions
- Dark/light theme toggle

### Add Channel Flow
- Paste a URL → platform auto-detected → metadata fetched
- Per-channel overrides: quality (Best/1080p/720p/480p/Lowest), format (MP4/MKV/TS), proxy, cookies, post-processing

### Recordings Page
- Filter by status (completed/failed/in-progress)
- Sort by date, size, name
- In-browser video preview (play completed recordings)
- Disk usage stats / storage indicator
- Live yt-dlp log panel per recording

### Settings Page
- Global quality and format defaults
- VPN/proxy configuration (WireGuard sidecar via wireproxy container)
- Cookie upload for age-restricted streams
- Auto-retry count and delay
- Max recording duration per channel / global
- Recording retention (auto-delete older than N days)
- Stalled detection (warn or auto-stop if stream stops sending data)
- Concurrent recording slots cap
- Import/export channel list + settings as JSON

---

## Feature Coverage vs StriVo

| Feature | streamerREC | StriVo |
|---------|-------------|--------|
| Auto live detection | Yes (polling) | Yes (polling) |
| Multi-platform | 30+ via yt-dlp | Twitch + YouTube (Mistral) |
| Web UI | Yes (Python/HTML) | Yes (axum/askama+SPA) |
| TUI | No | Yes (ratatui) |
| Recording | yt-dlp/FFmpeg | streamlink/ffmpeg |
| Remux/post-process | Optional (lossless MP4 remux) | Yes (TS→MKV, finalize pipeline) |
| Library management | Flat file list | Structured library |
| Quality profiles | Simple per-channel | Not yet |
| Transcription/diarization | No | Yes (Whisper/Mistral) |
| Scheduling | No | Yes |
| Notifications | Webhook (JSON POST) | Not yet |
| Auth | Optional PBKDF2 account | Not yet |
| Tags/organization | Per-channel notes only | Not yet |

---

## Backend / Architecture Patterns

### State Model
- All state in `./recordings/state.json` — channels + settings survive container restarts
- Account stored separately in `./recordings/account.json` (chmod 600, PBKDF2-HMAC-SHA256, 200k iterations)
- Atomic file writes: write to `.tmp` then `rename()` to prevent corruption on crash

### Live Detection
- Supervised per-channel monitor loop running in parallel
- Crash-isolated: one broken channel URL can't stall detection for the rest
- Each channel polled independently; detection via yt-dlp `--wait-for-video` or `--live-from-start`
- Per-channel recording lock prevents double-recording from concurrent calls

### Recording Process
- Each recording is a subprocess (yt-dlp + FFmpeg): tracked by PID
- Real-time progress: file size + bitrate polled from process output
- Stall detection: monitors that stream is still sending data; warns or stops if stalled
- Max duration: recording auto-stops gracefully when time limit reached
- Post-process: optional lossless remux to MP4 after TS completion
- Container fix: auto-remuxes interrupted recordings to fix broken containers (same pattern as StriVo's TS→MKV finalize)

### Concurrency
- Process semaphore caps concurrent yt-dlp and curl subprocesses
- Concurrent slot indicator visible in UI

### Webhook Notifications
- Two events: `stream_live` and `recording_complete`
- JSON POST to any HTTP endpoint
- Payload includes: event type, channel_id, name, url, platform, recording_id, status, filename, bytes, error

### Graceful Shutdown
- In-flight recordings stopped cleanly; state flushed on server exit

---

## Key Takeaways for StriVo

1. **Per-channel override pattern**: quality, format, proxy, cookies per channel (not just global)
2. **Live log panel**: real-time yt-dlp output directly in UI, scoped per recording
3. **Concurrent slot indicator**: simple "N/M slots" count — users understand resource usage instantly
4. **Bulk actions on channel list**: multi-select + R/S/Del shortcuts
5. **Webhook as primary notification**: just POST JSON — simple, composable, works with n8n/Zapier/etc.
6. **Atomic state writes** to JSON; explicit file permissions for account data
7. **Container fix / auto-remux**: same broken-container problem StriVo solves; streamerREC also does it post-recording
8. **Import/export JSON**: backup/restore channel list; portable config
9. **Disk usage stats** on the recordings page — users care about storage
10. **In-browser preview**: play recordings directly without needing a separate media player
