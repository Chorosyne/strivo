# The *arr Suite — Ecosystem Overview

Sources:
- https://wiki.servarr.com/sonarr (primary, most detailed)
- https://wiki.servarr.com/radarr
- https://wiki.servarr.com/prowlarr
- https://github.com/Sonarr/Sonarr (14k stars)

## The Suite Members

| App | Purpose | What it monitors/grabs |
|-----|---------|------------------------|
| Sonarr | TV series PVR | Episodes from Usenet/torrent |
| Radarr | Movie collection manager | Movies from Usenet/torrent |
| Lidarr | Music collection manager | Albums/tracks |
| Readarr | Book/audiobook manager | Books |
| Whisparr | Adult video manager | Adult content |
| Prowlarr | Indexer manager/proxy | Aggregates indexers for all *arr apps |

All share the same base stack: .NET backend, TypeScript/React frontend, SQLite/PostgreSQL, identical settings sections, same IPC patterns.

---

## Shared Information Architecture (all *arr apps)

Every *arr app follows the same top-level nav shape:

```
Library (Cards/List)
Calendar
Activity (Queue / History / Blocklist)
Wanted (Missing / Cutoff Unmet)
Settings
  ├── Media Management
  ├── Profiles (Quality Profiles, Custom Formats, Delay Profiles)
  ├── Quality
  ├── Indexers
  ├── Download Clients
  ├── Import Lists
  ├── Connect (Notifications)
  ├── Metadata
  ├── Tags
  ├── General
  └── UI
System
  ├── Status / Health Checks
  ├── Tasks (Scheduled + Queue)
  ├── Logs
  ├── Backups
  └── Updates
```

This consistent IA across apps is itself a design pattern: users who know Sonarr can immediately navigate Radarr.

---

## Prowlarr (Indexer Manager)

Prowlarr replaces per-app indexer config by acting as a central proxy. Features:
- Single place to add/manage indexers (Usenet + torrent)
- Syncs indexer list to all connected *arr apps via API
- Search interface to test indexers directly
- History + stats per indexer
- Supports 500+ indexers via Cardigann YAML definition format
- Source: https://wiki.servarr.com/prowlarr

**Relevance for StriVo**: Prowlarr's "source abstraction" pattern (one indexer proxy, not per-app config) maps well to StriVo's "platform abstraction" (one place to configure Twitch/YouTube credentials, not per-channel config).

---

## Key Shared Backend Patterns

### The *arr API Design (v3/v4)
- REST API; all UI interactions go through it; third-party apps use the same API
- API key auth (shown in General settings)
- Resource-based endpoints: `/api/v3/series`, `/api/v3/queue`, `/api/v3/history`, `/api/v3/wanted/missing`, etc.
- Swagger/OpenAPI docs generated from codebase
- Source: https://github.com/Sonarr/Sonarr (wiki link from README)

### Background Task Scheduler
- Named tasks with configurable intervals
- User-visible in System > Tasks (Scheduled tab shows next run, interval)
- Tasks can be triggered manually (play icon)
- Task run queue/history with duration tracking
- All state derived from SQLite; no external job queue dependency

### RSS Sync Cycle
- Core detection mechanism: poll indexer RSS feeds on a timer (default interval, min 10 min)
- On new release found: evaluate against monitored items + quality profiles
- If matched: send to download client
- Delay profile timer: start countdown if applicable, grab when timer expires

### Download Client Polling
- Polls download client API on 1-minute cycle
- Tracks category-labeled downloads
- On completion: trigger import pipeline
- Import: parse filename, match to library item, hard-link/copy, rename, notify

### SQLite Schema Patterns
- One SQLite file per *arr app (default)
- Tables: Series/Episodes, QualityProfiles, CustomFormats, DownloadClients, Indexers, History, Blocklist, Tags, Config
- PostgreSQL supported for multi-instance setups

---

## Notable UX Patterns (all *arr)

1. **Card library view**: poster art grid with status overlay badges (missing count, quality)
2. **Interactive search**: manually trigger an indexer search, see all available releases with scores, grab any manually
3. **Activity queue with live polling**: shows download progress pulled from download client
4. **Health check page**: categorized warnings (system, indexers, download clients, media/lists); each with explanation and fix steps
5. **Advanced settings toggle**: "Show Advanced" reveals extra options (orange-labeled in UI), keeps onboarding clean
6. **Bulk actions via Mass Editor**: filter + multi-select + apply settings to all selected
7. **Custom Formats scoring**: positive/negative integer scores assigned to regex conditions; profiles define minimum score and upgrade-until score
8. **Tags as first-class cross-cutting concern**: not just labels, but a mechanism to scope rules to specific items
9. **Calendar with iCal export**: upcoming content visible in a time-grid view, exportable to Google Calendar etc.
10. **Notification system with 20+ integrations**: uniform trigger model (On Grab/Import/Upgrade/etc.) regardless of destination service

---

## First-Run / Onboarding Pattern

Sonarr's Quick Start guide recommends this sequence:
1. Set root folder (where media will be stored)
2. Configure quality profile
3. Add an indexer
4. Add a download client
5. Add first series

No wizard UI per se, but the Health Check page surfaces each missing step as a warning with a direct link to fix it. This "health check as onboarding guide" pattern is effective: users see exactly what's missing without a prescriptive wizard.
