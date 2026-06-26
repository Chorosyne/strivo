# Unmanic — Library Optimiser

Source: https://docs.unmanic.app/ (accessed 2026-06-25)
GitHub: https://github.com/Unmanic/unmanic
License: GPL v3 (open source)
Stack: Python backend, web UI, plugin system

---

## What It Is

Unmanic automates file library management: convert, organize, manage files according to user-defined
rules. Primary use: video library optimization (codec conversion, audio normalization, stream removal),
but plugin-extensible to any file type (documents, images, etc.).

"Set and forget" design philosophy: configure once, runs in background continuously.

---

## Architecture

- Single installation = Server + Worker(s)
- **Linked Installations**: multiple Unmanic instances share workers across PCs
- Primary installation coordinates; linked instances receive tasks for matching library names
- Each installation can have its own plugin stack for the same library name
- **Unmanic Central**: SaaS dashboard unifying multiple installations (supporter-only)

---

## Key UX Patterns

### Plugin/Workflow System
- Workflows are plugin chains: each plugin tests a condition, runs a task
- Plugins are independent and composable
- Popular plugins: Video Transcoder, Audio Transcoder, File Size Metrics, Comskip, Notify Plex/Jellyfin,
  AI Video Upscaler, Rename File, Remove Audio/Subtitle by Language
- Writing a plugin is documented; community claims "even an AI can write a functional plugin in under 10 mins"

### Scheduling
- Per-library scheduling; configurable worker count during scheduled windows
- Pause and resume processing

### Library Setup
- Define root folder(s) to monitor
- Folder watcher triggers processing on new files
- File testing threads for validation

### Supporter-Only Features
- Maximum 2 libraries (free) vs unlimited (supporter)
- Maximum 3 linked installations (free) vs unlimited
- Unmanic Central dashboard

### Unmanic Central (dashboard for fleet)
- Custom dashboards made of widgets:
  - Worker status and activity per installation
  - Resource usage (CPU/RAM)
  - Uptime, library size, scan history
  - Recent events timeline
  - Log aggregation with installation filter
  - File-size metrics: total savings, sliceable by time range and outcome
- Kiosk mode with auto-refresh (for wall displays)

---

## Backend Patterns

### Linked Installations
- Primary = coordinator; tasks flow to linked installations with matching library names
- Linked installations are stateless relative to coordination
- Worker count balanced via "distributed worker target" setting

### Plugin Execution
- Plugins receive file metadata, return FFmpeg/processing instructions
- Sandboxed: can use external scripts (Python, Node, Bash)
- Sequential pipeline: each plugin's output is the next plugin's input

---

## Key Takeaways for StriVo

1. **"Set and forget"**: marketing message that resonates; StriVo should emphasize the same
2. **Linked installations / distributed workers**: post-recording processing (transcription, transcode)
   could benefit from this pattern as StriVo scales
3. **Per-library scheduling**: time-based worker windows are useful for StriVo's recording schedules
4. **Plugin chain as post-processing pipeline**: StriVo's post-recording steps (remux, transcribe,
   notify, tag) map naturally to a plugin chain
5. **File-size metrics dashboard**: users want to see "how much space did automation save me?"
6. **External script plugin**: escape hatch for arbitrary post-processing without core code changes
