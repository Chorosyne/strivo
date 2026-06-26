# Tdarr — Distributed Transcoding System

Source: https://tdarr.io (accessed 2026-06-25)
Docs: https://docs.tdarr.io
Downloads: 55 million+; Reddit: 9400+ members; Discord: 4900+
License: Proprietary (free tier + paid supporter features)

---

## What It Is

Tdarr is a conditional-based transcoding application for automating media library
transcode/remux management. Common uses:
- Convert h264 → h265 (50% file size reduction)
- Remove unwanted audio/subtitle streams
- Health-check media files for corruption
- Hardware-accelerated transcoding (GPU + CPU workers)

**Architectural relevance**: Tdarr is a multi-process, distributed media processing pipeline
with a web UI — a parallel to StriVo's daemon + web UI architecture.

---

## Architecture (Server + Node model)

| Module | Role |
|--------|------|
| Updater | Standalone updater binary |
| Server | Core: stores state, coordinates, does NOT encode. Has both Server + Node in default Docker image |
| Node | Encoding worker. Can run on multiple machines. Separate `tdarr_node` Docker image |

- Server exposes the web UI and REST API
- Nodes connect to Server over network; work is distributed
- Multiple nodes = horizontal scaling; GPU nodes for hardware acceleration
- Folder structure: `/app/configs/`, `/app/logs/`, `/app/server/`, `/app/Tdarr_Node/`

---

## Key Features

- **Conditional flow**: plugin-based processing — each plugin tests a condition, runs if true
- **50+ community plugins**: community-contributed processing plugins
- **Library stats**: file count, codec distribution, size savings
- **Folder watcher**: monitors libraries for new files
- **Worker stall detector**: kills stuck workers automatically
- **Load balancing** between libraries/drives
- **7-day × 24-hour scheduler**: time-block scheduling grid per library
- **Job report system**: detailed logs + file history
- **Hardware transcoding**: Nvidia GPU, Intel QSV, AMD AMF
- **Search files**: query library by hundreds of file properties

---

## UX Patterns Relevant to StriVo

### Library Dashboard
- Per-library stats card: file count, total size, savings achieved
- Codec distribution charts
- Worker status (how many workers active per node)

### Plugin/Flow System
- Plugins are conditional: "if file is h264, transcode to h265"
- Flow editor: chain plugins in sequence; each has a test + action
- Community plugin repository with ratings/download counts

### Scheduler Grid
- 7-day × 24-hour time grid; each cell = on/off toggle
- Per-library scheduling; different libraries can have different windows
- Prevents processing during peak hours

### Worker/Queue UI
- Shows active workers per node with file being processed
- Queue depth indicator
- Stall detection with auto-kill

### Job History / Log Panel
- Per-file processing history: before/after size, plugins run, result
- Searchable history

---

## Backend Patterns

### Node Architecture
- Server handles state, UI, API
- Nodes are stateless workers: fetch work from server, process, report back
- Crash-resilient: if a node dies, work returns to queue

### Plugin System
- Plugins as JavaScript functions; sandboxed execution
- Input: file metadata; output: processing instructions for FFmpeg/HandBrake
- Community plugins distributed as JSON configs

### Persistent State
- Server stores all state (library config, history, stats)
- Nodes are replaceable

---

## Key Takeaways for StriVo

1. **Server + worker architecture**: StriVo's daemon is both server and worker; Tdarr's separation
   enables distributed processing. As StriVo scales, this split may become relevant.
2. **7-day scheduler grid**: visual time-block scheduler is excellent UX for "when should this run"
3. **Per-library stats**: aggregate metrics (total size, codec breakdown) are immediately useful
4. **Worker stall detection**: critical reliability pattern for long-running processes
5. **Plugin/flow system**: composable post-processing pipeline — analogous to StriVo's
   potential post-recording steps (transcribe, remux, notify)
6. **Community plugin ecosystem**: once a user base forms, open extension points multiply value
