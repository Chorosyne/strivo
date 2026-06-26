# StriVo Research Exemplars — INDEX

Gathered: 2026-06-25
Purpose: Reference material for StriVo's web UI design and architecture decisions.
StriVo is a TUI + web UI Live Stream PVR (Sonarr/Radarr for live streams), written in Rust.

---

## Files in This Directory

| File | Topic | Primary Source URL |
|------|-------|-------------------|
| `sonarr.md` | Sonarr — deep dive on IA, settings, backend | https://wiki.servarr.com/sonarr |
| `arr-suite-overview.md` | Full *arr ecosystem overview (Sonarr/Radarr/Prowlarr/etc.) | https://wiki.servarr.com |
| `streamrec.md` | streamerREC — direct competitor analysis | https://github.com/orhogi/streamerREC |
| `ytarchive.md` | ytarchive — YouTube live stream archiver | https://github.com/Kethsar/ytarchive |
| `tdarr.md` | Tdarr — distributed transcoding system | https://tdarr.io |
| `unmanic.md` | Unmanic — library optimiser, plugin system | https://docs.unmanic.app |
| `streamlink.md` | Streamlink library + Twitch GUI | https://github.com/streamlink/streamlink |
| `adjacent-media-apps.md` | Jellyfin, Tautulli, Seerr, SABnzbd | Multiple (see file) |
| `live-stream-recorders-survey.md` | Survey of all discovered live stream recorder tools | https://github.com/topics/twitch-recorder |
| `design-ux-patterns.md` | Common component patterns for dense admin UIs | Multiple (see file) |

---

## Key Findings Summary

### Direct Competitors (live stream recorders with web UIs)

1. **streamerREC** (`https://github.com/orhogi/streamerREC`, 4 stars, active) — Python/FastAPI +
   yt-dlp, Docker-first, 30+ platforms, channel dashboard + recordings page + settings + webhooks.
   **The most feature-complete direct competitor found.** Still far simpler than an *arr-style PVR.

2. **Stream-Catcher-Pro** (`https://github.com/HandiSetiawanHamdani/Stream-Catcher-Pro`, 1 star) —
   Python/Streamlit, Bigo/TikTok/YouTube. Notable: "Brake System" for safe FFmpeg termination.

3. **Twitch/YouTube CLI recorders** (Avnsx/twitch-stream 54 stars, ytarchive 1.7k stars, 
   twitch-recorder-rs) — CLI-only, no web UI, single-channel focus.

### Most Relevant Architecture Exemplars

1. **Sonarr** — the gold standard for *arr-style PVR web UI; exhaustive reference for every
   settings section, queue UI, library view, health checks, notifications.

2. **streamerREC** — shows what the MVP web UI for a stream recorder looks like; study its
   channel dashboard and recordings page for immediate design reference.

3. **Tdarr** — Server+Node distributed architecture; 7-day scheduler grid; plugin system for
   post-processing pipeline.

4. **Unmanic** — Plugin chain as post-processing; linked installations; fleet dashboard.

### Gap Analysis (StriVo's Opportunity)

No existing tool combines:
- TUI + web UI
- Multi-platform (Twitch + YouTube)
- *arr-style quality profiles + scheduling
- Library organization beyond flat file storage
- Transcription / speaker diarization / search
- Health check dashboard
- Multi-user auth + granular permissions

**The gap between streamerREC (simple channel list) and Sonarr (full PVR with profiles/indexers/etc.)
is entirely unoccupied in the live stream recording space. StriVo's north star is to fill it.**

---

## Sources NOT Accessible

- Tdarr's internal UI docs (no public docs for the actual web UI component library)
- Prowlarr detailed UI screenshots (wiki was text-only, no screenshots captured)
- Sonarr v4 beta API docs (linked from wiki but behind authentication at https://sonarr.tv/docs/api/)
- Streamlink Twitch GUI wiki (links from GitHub pointed to now-redirected pages)

---

## Notable Secondary Sources (not given full files)

| Tool | URL | Stars | Notes |
|------|-----|-------|-------|
| Seerr (Overseerr/Jellyseerr merge) | https://seerr.dev | 10.3k | Request management UI; TypeScript/Next.js |
| Tautulli | https://tautulli.com | - | Plex analytics; history + graphs patterns |
| SABnzbd | https://sabnzbd.org | - | Queue UX reference |
| Sonarr GitHub | https://github.com/Sonarr/Sonarr | 14k | C#/TypeScript; v5-develop branch active |
| Jellyfin | https://jellyfin.org | 38k+ | Live TV / DVR; EPG guide grid pattern |
| Prowlarr | https://wiki.servarr.com/prowlarr | - | Indexer aggregator pattern |
