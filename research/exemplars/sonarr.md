# Sonarr — Exemplar Research

Source: https://wiki.servarr.com/sonarr (primary wiki, accessed 2026-06-25)
GitHub: https://github.com/Sonarr/Sonarr (14k stars, C#/TypeScript, GPL-3)

## What It Is

Sonarr is a PVR (Personal Video Recorder) for Usenet and BitTorrent users. It monitors RSS
feeds for new TV episodes, grabs/sorts/renames them, and upgrades quality automatically. The
closest architectural analogy to StriVo: both are PVRs that monitor sources, record/grab on
detection, manage a file library, and expose a web UI.

Tech stack: C# backend, TypeScript + React frontend, SQLite (or PostgreSQL) database.

---

## Information Architecture (top-level nav)

Left sidebar navigation items (in order):
1. **Series** (Library) — full grid/list of monitored shows
2. **Calendar** — grid view of upcoming/recent episode airings
3. **Activity** — queue (active downloads) + history + blocklist
4. **Wanted** — Missing + Cutoff Unmet
5. **Settings** — Media Management, Profiles, Quality, Indexers, Download Clients,
   Import Lists, Connect, Metadata, Tags, General, UI
6. **System** — Status/Health, Tasks, Logs, Updates, Backups

---

## Key UX Patterns

### Library / Series View
- Card grid with artwork; each card shows series title, episode counts, quality info
- **Filters bar**: filter by status, monitored/unmonitored, custom filters
- **Mass Editor**: multi-select + bulk-apply root folder, quality profile, monitor state
- **Season Pass**: per-series season listing, episode counts, missing counts
- **Add New**: search TVDB, pick Root Folder, Quality Profile, Monitor mode, Series Type, Season Folder toggle, Tags; optional "Start search for missing episodes" on add
- Monitor modes: All Episodes / Future Only / Missing / Existing / First Season / Latest Season / None

### Calendar View
- Time-range widget (week view, scrollable)
- Shows recently aired and upcoming episodes
- Color-coded by download status (missing, grabbed, downloaded)
- iCal export feed (past 7 days + next 28 days)

### Activity / Queue
- Queue shows actively downloading items from configured download clients; polled via download client API
- Status icons: grey clock (pending/delay profile), yellow warning (import failed), purple (importing)
- Per-item actions: remove from queue, remove from download client, blocklist release, manual import, re-grab
- **Important**: queue depth limited to 60 items deep for import detection
- History tab: all completed/failed/deleted events; filterable; per-entry details (indexer, URL, age)
- Blocklist: permanently blocked releases; manual entry or auto-added on failure

### Wanted
- **Missing**: monitored episodes not yet on disk; "Search All" / "Search Selected" / "Unmonitor Selected"
- **Cutoff Unmet**: episodes that exist but haven't reached quality cutoff; same bulk actions
- Manual Import: drag any file into Sonarr from arbitrary path, interactive or auto-match

### Settings Organization (menu items)
1. Media Management: naming templates, folder creation, file management, permissions, root folders
2. Profiles: Quality Profiles (ordered quality tiers + upgrade cutoff), Custom Formats (regex/condition scoring), Delay Profiles (per-tag wait timers), Release Profiles
3. Quality: define min/max MB/min per quality tier
4. Indexers: Usenet (Newznab) + Torrent (Torznab/Jackett/Prowlarr); per-indexer RSS/auto/interactive toggles, categories, tags
5. Download Clients: Usenet + Torrent; category assignment, priority, completed DL handling
6. Import Lists: follow external curated lists; clean library level control
7. Connect: notification triggers (On Grab / On Import / On Upgrade / On Rename / On Delete / On Health Issue / On Update) to 20+ services (Discord, Slack, webhook, email, Pushover, etc.)
8. Metadata: Kodi/Plex NFO generation
9. Tags: cross-cutting tag system linking series, indexers, release profiles, delay profiles
10. General: host/port, auth (None/Basic/Forms), API key, proxy, SSL, logging level, analytics, update branch/channel
11. UI: calendar first day, date format, color-impaired mode

### Health Checks / System Status
- Active health check list surfaced in System > Status with colored severity
- Categories: system warnings (runtime, .NET), download clients, indexers, media/lists, disk space
- Scheduled tasks list: RSS Sync, Refresh Series, Check Health, Housekeeping, Import List Sync, etc.
- Task queue with run history and duration
- Log viewer with file download; rolling 1MB log files (up to 51); Info/Debug/Trace levels
- Backup: scheduled + on-demand; restore from backup file

---

## Backend / Architecture Patterns

### Scheduler / Task Model
- All background work runs as named scheduled tasks (RSS Sync, Refresh, Health Check, etc.)
- Tasks have configurable intervals visible to the user in System > Tasks
- Task queue shows running/pending/recently-completed tasks with durations
- Source: https://wiki.servarr.com/sonarr/system#tasks

### Indexer Abstraction
- Indexers are configured by protocol (Newznab for Usenet, Torznab for torrent)
- Per-indexer flags: RSS feed, automatic search, interactive search
- Prowlarr acts as a single proxy/aggregator for all indexers; each app talks to Prowlarr instead of individual indexers
- Source: https://wiki.servarr.com/prowlarr

### Download Client Abstraction
- Download clients configured by type (SABnzbd, NZBGet, qBittorrent, Deluge, etc.)
- Sonarr associates downloads with a category label; polls client API to track progress
- Completed Download Handling: Sonarr auto-imports when client reports completion
- Hard-link-first import: atomically moves file if same filesystem, falls back to copy
- Remote Path Mappings: dumb find+replace for Docker/cross-host path mismatches

### Quality Profiles / Custom Formats
- Quality profiles: ordered list of acceptable quality tiers; "cutoff" = stop upgrading above this
- Custom Formats: on-the-fly regex/condition scoring system; scores attached to Quality Profiles
- Scoring: positive scores = preferred, negative = rejected; minimum score threshold per profile
- Delay Profiles: wait N minutes after first grab before committing, allowing better releases to appear

### Tags System
- Tags are strings attached to Series, Indexers, Release Profiles, Delay Profiles
- A series only uses indexers/profiles that share its tags (or have no tags)
- Enables per-show overrides without separate profiles

### Notification / Connect System
- Event-driven webhook/notification system
- Triggers: Grab, Import, Upgrade, Rename, Delete, Health Issue, App Update
- 20+ integrations: Discord webhook, Slack, Telegram, email, Pushbullet, Pushover, custom script, Gotify, ntfy, etc.

### Database (SQLite / PostgreSQL)
- Default: SQLite; optional PostgreSQL for multi-instance/HA setups
- App data stored in AppData directory; separate config from media

### Import Pipeline
- Source: download client finished folder
- Step 1: parse file name to match series/episode
- Step 2: check quality against profile
- Step 3: hard-link (preferred) or copy to library folder
- Step 4: rename per configured naming template
- Step 5: notify (metadata, Kodi/Plex refresh, Connect triggers)
- Failed: add to blocklist, optionally search again

### API
- REST v3 API documented at https://wiki.servarr.com/sonarr/api (v4 beta API docs linked from wiki)
- All UI interactions go through the API; third-party tools (Overseerr, Tautulli) use it
- API key auth; configurable in General settings

---

## Naming / Renaming Scheme (notable design)

Token-based templates: `{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} [{Quality Full}]{[MediaInfo VideoDynamicRangeType]}`

Tokens cover: series name/year/IDs, season/episode numbers, episode title, quality, media info (codec, channels, HDR type, bit depth), release group, custom formats.

Community-recommended presets from TRaSH Guides are documented in the official wiki.

---

## Standout UX Observations for StriVo

1. **Filtering everywhere**: series list, history, wanted — all have custom filter builders
2. **Bulk actions** are first-class: Mass Editor lets you change quality profiles on 100 series at once
3. **Health check dashboard**: proactive system warnings surfaced in a dedicated tab, not buried in logs
4. **Show/Hide Advanced**: settings pages hide advanced options behind a toggle, reducing initial complexity
5. **Tags as cross-cutting glue**: a single tag links a show to specific indexers, delay profiles, release profiles — very low-friction specialization
6. **Delay Profiles**: introduce wait time before grabbing to let better releases appear — relevant analogy to StriVo's "wait for stream to finish before finalizing"
7. **Connect system**: 20+ notification integrations via a uniform trigger/event model
