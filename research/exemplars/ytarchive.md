# ytarchive — YouTube Live Stream Archiver

Source: https://github.com/Kethsar/ytarchive (accessed 2026-06-25)
Stars: 1.7k
License: MIT
Stack: Go, FFmpeg for mux step
No web UI — CLI-only tool

---

## What It Is

ytarchive downloads a YouTube live stream from the very beginning, even if you start it mid-stream.
It handles scheduled streams (waits for them to start), members-only streams (with cookies + potoken),
and continuous channel monitoring (keeps watching a channel and records every stream as it starts).

**Primary differentiation**: downloads video and audio fragments separately (Google's internal
adaptive streaming format), then muxes with FFmpeg. This means it can capture from the stream's
actual beginning, not just from when you started watching.

---

## Key Technical Patterns Relevant to StriVo

### Fragment-Based Download
- YouTube live streams serve video and audio as separate fragment lists
- ytarchive downloads both concurrently, stores in temp files (or RAM with `--no-frag-files`)
- Fragments can accumulate: `--no-frag-files` keeps them in RAM to avoid disk I/O on Windows
- Final step: FFmpeg mux of video + audio fragments → MP4 or MKV

### PO Token Requirement (as of 2024)
- YouTube now requires a PO (Proof of Origin) token for live stream downloads
- `--potoken` flag is required; obtained from browser session
- Relevant: StriVo's YouTube support needs to handle evolving authentication requirements

### Channel Monitoring Mode
- `--monitor-channel` with a `/live` URL: continuously watches the channel
- Waits for stream to start, downloads it, then goes back to waiting
- `--retry-stream SECONDS`: polling interval (minimum 30s, recommended 60s+)
- Auto-retries on disconnect; `--merge` flag handles graceful cancellation

### Resumable Downloads
- Saves state to disk for resumable downloads (can be disabled)
- On interruption, user can resume the same stream download later
- `--save-state` / `--no-save-state` flags

### Format Template Output
- `--output` accepts format template: `%(title)s-%(id)s`
- Available tokens: title, id, channel_id, channel_name, publish_date, start_date

### Members-Only Streams
- `--members-only` flag + `--cookies` + `--potoken` for membership content
- Useful for VTuber/creator communities

### Quality Selection
- Slash-delimited priority list: `1080p60/720p60/best`
- Falls back down the list if preferred quality unavailable
- `audio_only` option

---

## Relevance to StriVo

1. **Fragment-based capture**: StriVo's streamlink approach captures HLS segments; ytarchive's fragment approach is more direct for YouTube's internal format. When StriVo adds native YouTube support, ytarchive's approach is worth studying.
2. **PO token/cookie auth**: StriVo will need to handle evolving YouTube auth requirements.
3. **Monitor-channel loop**: same pattern StriVo uses — poll, detect, record, loop.
4. **Graceful mux on cancellation**: StriVo already does TS→MKV finalize; ytarchive's FFmpeg mux pattern is similar.
5. **Members-only**: a differentiating feature StriVo could add for YouTube.

---

## Limitations (vs StriVo's design)

- No web UI
- No library management
- No scheduling beyond "wait for scheduled stream to start"
- Single-channel at a time (not a multi-channel daemon)
- No notifications
