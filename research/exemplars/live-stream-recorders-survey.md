# Live Stream Recorder Tools — Survey

This file catalogs the prior art for self-hosted live stream recorders. Most are scripts; few
have web UIs. The field is underdeveloped relative to *arr apps for TV/movies.

Sources:
- https://github.com/topics/twitch-recorder (accessed 2026-06-25)
- https://github.com/topics/stream-recorder (accessed 2026-06-25)
- https://github.com/topics/live-stream-recorder (accessed 2026-06-25)

---

## Tools With Web UIs (direct competitors)

### streamerREC
- GitHub: https://github.com/orhogi/streamerREC
- Stars: 4 (new, active)
- Stack: Python (FastAPI), yt-dlp, HTML/CSS/JS
- Platforms: 30+ via yt-dlp
- Features: channel dashboard, recordings page, settings page, webhooks, optional auth
- Status: actively developed (May 2026)
- Full analysis: see `streamrec.md`

### Stream-Catcher-Pro
- GitHub: https://github.com/HandiSetiawanHamdani/Stream-Catcher-Pro
- Stars: 1
- Stack: Python (Streamlit), Streamlink, FFmpeg
- Platforms: Bigo Live, TikTok, YouTube
- Features: CRUD host database, recording controls, low-spec optimized
- Standout: "Brake System" — safe termination protocol to halt FFmpeg without corrupting files
- Standout: Brave Browser bookmark sync to auto-populate host database
- Status: initial release (March 2026)

---

## Notable CLI-Only Tools

### Avnsx/twitch-stream (twitch-stream-recorder)
- GitHub: https://github.com/Avnsx/twitch-stream
- Stars: 54 (most starred twitch-recorder topic)
- Stack: Python, Streamlink, FFmpeg
- Features: monitors single channel, saves as MP4 with timestamp filename, config.ini for settings
- No web UI; no multi-channel support
- Status: active (June 2025)

### Kethsar/ytarchive
- GitHub: https://github.com/Kethsar/ytarchive
- Stars: 1.7k
- Stack: Go, FFmpeg
- YouTube-specific: fragment-based download, from-start capture
- `--monitor-channel` for continuous monitoring
- PO Token required (2024+)
- Full analysis: see `ytarchive.md`

### antiops/twitch-stream-recorder
- GitHub: https://github.com/antiops/twitch-stream-recorder
- Stars: 7
- Stack: Python
- Features: records live streams, uploads to Google Drive/SFTP/etc. via rclone
- Notable: rclone integration for offsite backup

### fvckgrimm/twitch-recorder-rs (and cats-rs/twitch-scrapurr)
- GitHub: https://github.com/fvckgrimm/twitch-recorder-rs
- Stars: 1-2
- Stack: Rust, Streamlink
- No Twitch API needed — uses Streamlink directly
- Simple daemon, no web UI
- Note: StriVo is in the same Rust space but far more ambitious

### wploits/Oshi-tracker
- GitHub: https://github.com/wploits/Oshi-tracker
- Stars: 0
- Stack: Python, yt-dlp
- Platforms: YouTube, Twitch, Twitter/X, TikTok
- Features: Discord webhook notifications, RSS monitoring, auto-recording
- Niche: designed for VTuber/streamer fan tracking ("oshi-katsu")
- Notable: RSS-based detection alongside API polling

---

## Key Patterns Across All Tools

### Detection Method
Most tools use one of:
1. **Platform API polling**: call Twitch API / YouTube Data API every N seconds; check `is_live`
2. **yt-dlp detection**: run `yt-dlp --wait-for-video` which blocks until live
3. **Streamlink detection**: attempt to open stream; failure = offline, success = live
4. **RSS feeds**: some platforms expose RSS for upcoming/live events

### Recording Method
- **streamlink pipe → FFmpeg**: HLS segments → container
- **yt-dlp direct**: handles its own fragment download + mux
- **FFmpeg direct**: for known HLS URLs (less reliable for auth)

### Post-Processing
- **None**: most CLI tools just save the raw file
- **FFmpeg remux**: fix container after interrupted recording (TS → MP4/MKV)
- **rclone upload**: offsite backup
- **Discord webhook**: notification on start/end

### State Management
- **None**: daemon just runs, no persistent state
- **config.ini**: single channel + settings
- **JSON file**: channel list + recording state (streamerREC pattern)
- **SQLite**: not used by any discovered tool (potential StriVo differentiator)

### Notable Gap: No Full PVR
None of the discovered tools implement:
- Quality profiles
- Scheduling (time-based recording windows)
- Library organization beyond flat file storage
- Transcription/search
- Multi-user auth
- Health checks

**StriVo's ambition to be "Sonarr/Radarr for live streams" has no direct competitor.** The gap
between streamerREC (channel list + simple recording) and what an *arr-style PVR offers is large.

---

## Common UX Patterns from Tools with UIs

1. **Channel list** as primary view: each entry shows platform icon, live status badge, recording status
2. **Live status**: colored dot (green = live, grey = offline, red = recording)
3. **One-click record/stop** per channel
4. **Recording log/history**: what was recorded, when, file size
5. **Settings page**: global defaults for quality, format, retry behavior
6. **Storage indicator**: disk usage / available space
7. **Dark theme**: all self-hosted tools default dark or offer dark mode

---

## Market Landscape Assessment

| Tier | Tools |
|------|-------|
| Direct competitor (web UI + multi-platform) | streamerREC (Python/yt-dlp) |
| Partial competitor (CLI + single-platform) | Avnsx/twitch-stream, ytarchive, twitch-recorder-rs |
| Adjacent (framework/library) | Streamlink |
| Notification-focused | Oshi-tracker |
| Browser extension | Several cam-site extensions (not relevant) |

**StriVo's moat**: TUI + web UI + library management + transcription/diarization + *arr-style
quality profiles/scheduling. No existing tool combines all of these.
