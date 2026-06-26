# Streamlink — Stream Extraction Library & CLI

Source: https://github.com/streamlink/streamlink (accessed 2026-06-25)
Stars: 11.6k
License: BSD-2-Clause
Stack: Python library + CLI
Docs: https://streamlink.github.io/

Related: Streamlink Twitch GUI (https://github.com/streamlink/streamlink-twitch-gui, 2.9k stars, NW.js/EmberJS)

---

## What It Is

Streamlink is a Python library and CLI that pipes live streams from 80+ services into a video player
(default VLC) or file. It's the extraction layer that many stream recorders (including StriVo) use.

Core concept: given a stream URL, resolve to the actual HLS/DASH/RTMP segments, apply auth, and
pipe the bitstream to stdout or a file.

---

## Key Design Patterns

### Plugin System
- Each platform (Twitch, YouTube, etc.) is a separate plugin Python file in `src/plugins/`
- Plugins implement stream URL resolution; new platforms added without touching core
- 80+ plugins included; community can add more

### Output Flexibility
- Default: pipe to VLC
- `--output FILE`: write to file
- `--stdout`: raw bytes to stdout (pipe to FFmpeg, etc.)
- Recording: `streamlink URL best --output recording.ts`

### Quality Selection
- Slash-delimited priority list: `best`, `1080p`, `720p`, `worst`, `audio_only`
- `best` = highest available quality

### Authentication
- Per-plugin auth: cookies, OAuth tokens, API keys
- Twitch: uses Twitch auth token or HLS direct
- YouTube: cookies for members content

### Stream Metadata
- Can read stream metadata (title, description, thumbnail) without downloading
- Used by tools like streamerREC to fetch stream titles

### Retry and Reconnect
- Built-in retry logic on segment fetch failure
- Configurable retry count and timeout

---

## Streamlink Twitch GUI

A cross-platform Twitch browser and launcher built on top of Streamlink. NW.js + EmberJS.

### Key UX Patterns
- **Browse streams by**: popularity, game, channel, team — full Twitch browsing experience
- **Watch multiple streams**: open multiple streams simultaneously
- **Followed streams**: shows streams the user follows, sorted by viewer count
- **Desktop notifications**: when followed channels go live
- **Individual channel settings**: per-channel quality preferences, player, chat app
- **Hotkey support**: keyboard shortcuts for common actions
- **Dark/light theme**: automatic or manual
- **CLI parameters**: for automation/scripting
- Electron-style app (NW.js = Chromium + Node.js)

**Note**: Project is in low-maintenance mode as of 2024 (see issue #1045). The maintainer's bandwidth
is limited. This is a market opportunity gap for StriVo's TUI approach.

### IA
- Main view: followed streams (live indicator, viewer count, game, preview)
- Games browser: browse streams by game category
- Search: find channels
- Settings: stream quality, player, chat, themes, hotkeys, auth

---

## Relevance to StriVo

1. **Streamlink is StriVo's extraction layer** for Twitch; understanding its plugin model matters
2. **Quality selection syntax**: StriVo's quality config should be compatible with or map to streamlink quality strings
3. **Output piping**: `--stdout` → FFmpeg → MKV is the exact pipeline StriVo uses
4. **Plugin auth**: Twitch auth token management in streamlink is critical path for StriVo's Twitch support
5. **Streamlink Twitch GUI's maintenance gap**: the GUI TUI for Twitch browsing is underserved; StriVo's TUI fills this gap
