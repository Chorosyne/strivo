# Adjacent Self-Hosted Media Apps

## Jellyfin

Source: https://jellyfin.org (accessed 2026-06-25)
Docs: https://jellyfin.org/docs/general/server/live-tv/
GitHub: https://github.com/jellyfin/jellyfin
License: GPL-2.0
Stars: 38k+

### What It Is
Free/open-source media server. Replaces Plex/Emby. Manages movies, shows, music, photos, live TV, books.

### Relevant UX Patterns for StriVo

**Library views**: poster-grid with status overlays; list view with sortable columns; detail pages
with cast/crew, ratings, streaming availability.

**Live TV & DVR**:
- Supports HDHomeRun tuners and M3U playlists (IPTV)
- EPG (Electronic Program Guide) from Schedules Direct or XMLTV
- Recording: set recordings from the guide; scheduled recordings stored as files
- DVR UI: guide grid (time × channel), record button per program, recording history

**Key UX insights from Jellyfin's Live TV**:
- Guide grid = time on X axis, channels on Y axis; navigate like a TV guide
- Record button on any guide entry → scheduled → confirmation
- StriVo could use a similar "upcoming streams grid" for scheduled Twitch/YT streams

**Web client architecture**: React SPA talking to a REST API; same pattern as *arr apps.

### Backend Patterns
- Library scanner runs on schedule; also manually triggerable
- Metadata providers (TMDB, MusicBrainz, etc.) are plugins
- Hardware transcoding via FFmpeg with HW acceleration flags
- Plugin system for extensions (e.g., Unmanic integration plugin)

---

## Tautulli

Source: https://tautulli.com (accessed 2026-06-25)
GitHub: https://github.com/Tautulli/Tautulli
License: GPL-3.0

### What It Is
Monitoring and analytics dashboard for Plex Media Server. Not a PVR — a statistics/history tracker.

### Relevant UX Patterns

**Dashboard**: current activity (who's watching what, right now); statistics cards (plays today, streams,
transcodes); graphs (plays over time, play duration by time of day).

**History page**: tabular log of every play with: user, media, player, device, date/time, play
duration, completion %, transcoding info.

**Statistics**: per-user stats, per-library stats, most popular media, most active users. All
presented as ranked lists + time-series graphs.

**Notifications**: event-driven (on play start/stop/pause, on stream/transcode, on new content);
20+ agents (Discord, Slack, email, etc.); custom notification scripts.

**Newsletter**: scheduled digest of recently added media — email blast to configured recipients.

### Key Takeaways for StriVo
1. **History is a first-class view**: not buried in logs; tabular, filterable, rich metadata per entry
2. **Graphs for trends**: play counts over time, peak hours — users want to understand their usage
3. **Per-user activity monitoring**: relevant for StriVo's multi-channel monitoring stats
4. **Notification on specific events**: start/stop/pause granularity; StriVo should consider equivalent (stream_start, recording_end, etc.)

---

## Seerr (formerly Overseerr/Jellyseerr)

Source: https://seerr.dev (accessed 2026-06-25)
GitHub: https://github.com/seerr-app/seerr
Stars: 10,300+
License: MIT
Stack: TypeScript (Next.js), PostgreSQL/SQLite

### What It Is
Media request management: users request movies/TV shows; admins approve; Seerr auto-sends approved
requests to Radarr/Sonarr; tracks availability in Plex/Jellyfin/Emby.

### Relevant UX Patterns

**Discover page**: trending movies/TV, search, inline recommendations, ratings + cast + streaming availability.
Beautiful card grid with status badges (available/requested/pending).

**Request flow**:
1. User clicks "Request" on media card
2. Selects specific seasons/episodes (for TV)
3. Advanced users can pick destination folder + quality profile
4. Admin approves → auto-sent to Sonarr/Radarr → tracks download → marks available

**Request Management**:
- Approval queue with approve/decline buttons
- Status pipeline: Requested → Approved → Processing → Available

**Permissions**:
- Granular per-user permissions (request, auto-approve, manage requests, etc.)
- Request limits (N movies or TV seasons per time period)

**Notifications**:
- Email, Discord, Pushbullet, Pushover, Slack, Telegram
- Per-user notification preferences

**Library Scanning**: periodic scans of Plex/Jellyfin/Emby to know what's already available.

**4K support**: separate Radarr/Sonarr instances for 4K vs 1080p content.

### Key Takeaways for StriVo
1. **Request/approval workflow**: if StriVo supports multi-user, a request pipeline for "add this channel" makes sense
2. **Status pipeline badges**: Requested → Processing → Available is a clean pattern for recording lifecycle
3. **Granular permissions**: important for shared self-hosted instances
4. **Beautiful discover UI**: StriVo's channel browsing could be similarly polished (browse Twitch channels, click to monitor)

---

## SABnzbd / NZBGet — Queue-Centric UI Patterns

Source: https://sabnzbd.org/wiki/configuration/4.5/switches (accessed 2026-06-25)

SABnzbd is a Usenet downloader with one of the most mature queue management UIs in the self-hosted space.

### Queue UX Patterns
- Priority queue: items can be reordered by drag, sorted by age/name/size/% downloaded
- Per-item actions: pause, resume, force, move to top
- Status column: downloading, verifying, repairing, unpacking, completed, failed
- Speed limiter: global throttle, per-item priority (Force/High/Normal/Low)
- Pause/resume entire queue with one click
- "Downloading into Root Folder" health warning — same category of warning as *arr's health checks

### Post-Processing Configuration
- Pre-queue scripts: run before download starts
- Post-processing scripts: run after completion; non-zero exit = mark failed
- Cleanup list: file extensions to delete after unpack
- History retention: N days, N jobs, archive vs delete

### Key Takeaways for StriVo
1. **Priority queue with drag reorder**: relevant if StriVo schedules multiple recordings
2. **Pre/post-processing scripts**: hook points for custom workflows
3. **Speed limit**: throttle recording bandwidth during peak hours
4. **History retention policy**: auto-cleanup is important; users shouldn't have to manage manually
