# StriVo PVR Web UI — UX/IA Analysis

Scope: default (non-`creator`) build. Creator-only feature surfaces (`#[cfg(feature = "creator")]`) are
tracked only where they bleed into the PVR SPA, since the SPA is a single embedded static asset with no
Rust compile-time gating.

Evidence notation: `spa.js:L` = `crates/strivo-web/assets/spa.js`, `api.rs:L` = `crates/strivo-web/src/routes/api.rs`.
Exemplar sources: `research/exemplars/sonarr.md`, `arr-suite-overview.md`, `streamrec.md`, `design-ux-patterns.md`, `adjacent-media-apps.md`.

---

## 1. StriVo PVR Web UI — Information Architecture As-Is

### Entry point
`crates/strivo-web/assets/spa.html` — a minimal shell that mounts `spa.js`. No server-rendered HTML;
every page is rendered by vanilla JS hash routing.

### Route table
Defined at `spa.js:615-633`. Canonical hash → render function mapping:

| Hash | Render fn | Core data fetched | PVR or Creator? |
|------|-----------|-------------------|-----------------|
| `#/library` | `renderHome()` | channels, recordings, schedule, patreon | PVR |
| `#/recordings` | `renderRecordings()` | recordings | PVR |
| `#/schedule` | `renderSchedule()` | schedule | PVR |
| `#/watch` | `renderWatch()` | channels, recordings | PVR |
| `#/viewer` | `renderViewer()` | channels, recordings | PVR |
| `#/history` | `renderHistory()` | recordings | PVR |
| `#/settings` | `renderSettings()` | settings | PVR (with creator sections) |
| `#/system` | `renderSystem()` | health/checks | PVR |
| `#/logs` | `renderLogs()` | logs | PVR |
| `#/studio` | `renderProApp("studio")` | channels + plugin capabilities | **Creator** |
| `#/analytics` | `renderProApp("analytics")` | channels + plugin capabilities | **Creator** |
| `#/publish` | `renderProApp("publish")` | channels + plugin capabilities | **Creator** |
| `#/pipelines` | `renderPipelines()` | `/api/v1/pipelines/dag` (404 in PVR) | **Creator** |
| `#/plugins` | `renderPlugins()` | `/api/v1/plugins` (404 in PVR) | **Creator** |
| `#/dataviz` | `renderDataviz()` | recordings + crunchr transcripts (404) | **Creator** |
| `#/chat` | `renderChat()` | channels (Twitch IRC) | Borderline |
| `#/login` | `renderLogin()` | — | Auth |

### Top navigation bar (TOPNAV, `spa.js:877-895`)
The topbar renders every entry unconditionally regardless of build:

```
Library | Recordings | Monitor | Player | Studio | Analytics | Publish | Chat | Settings | System | Logs | History
```

Four of these (`Studio`, `Analytics`, `Publish`, `Pipelines`) are creator-only surfaces. They appear as
icon links in the topbar in every build (`spa.js:887-892`).

### Left rail
A persistent channel list (`spa.js:999-1101`). Sections: ● LIVE, Twitch (offline), YouTube (offline),
Patreon (offline). Shows viewer count (live) or last-live timestamp (offline). Clicking a channel:
- Live channel → `#/library` (dashboard with channel detail center)
- Offline channel → `#/recordings?channel=<name>` (filtered recordings table)

### Page-by-page breakdown

#### Library (`#/library`)
Horizontal "Jellyfin-style carousel" dashboard (`spa.js:1340`). Contains:
- Currently recording row (active captures with thumbnail + state pill)
- Recent recordings carousel
- Upcoming schedule row (next N cron firings)
- Patreon posts row
- Channel detail center (selected channel from left rail): live embed, VOD list, Patreon posts, bulk-download controls

API calls: `GET /api/v1/channels`, `GET /api/v1/recordings`, `GET /api/v1/schedule`, `GET /api/v1/patreon`

#### Recordings (`#/recordings`)
Data table with (`spa.js:2417`):
- Sort columns: channel, title, platform, started, duration, size, state
- Chip-based state filter (finished/recording/downloading/failed)
- Date-range filter (started_at bounds)
- Group-by (channel/platform/date/state/flat)
- Free-text search filter
- Density toggle (comfortable/compact)
- Shift+click range selection
- Per-row: thumbnail, state pill, start/stop, open info modal, delete
- Bulk actions: stop all, clear errored, per-selected delete
- Gantt strip (24-hour timeline bars at bottom)

API calls: `GET /api/v1/recordings`, `GET /api/v1/gantt`

#### Schedule (`#/schedule`)
Cron schedule manager. Lists schedule entries with channel name, cron expression, duration, and computed
next-fire time. Add/delete entries. Calls: `GET /api/v1/schedule`, `POST /api/v1/schedule`,
`DELETE /api/v1/schedule/{index}`.

No visual calendar; purely tabular.

#### Watch (`#/watch`)
Multi-stream player (`spa.js:5309`). Supports live Twitch embed + local recording playback via
`<video>` with HTTP Range. Layout presets (1×1, 2×1, 2×2, custom). Can accept `?recording=<id>` query.

#### Viewer (`#/viewer`)
Single-recording detail player.

#### History (`#/history`)
Table of all completed/failed jobs from the persistent `jobs.db` (survives daemon restarts). Filterable.
Calls `GET /api/v1/history`.

#### System (`#/system`)
Health check page. Grouped checks: Network (daemon IPC), Storage (disk space), Platform Auth (Twitch/YT/Patreon
configured+connected). Per-check severity (ok/warn/error), message, and fix hint. Topbar health pill
mirrors worst severity. Calls `GET /api/v1/health/checks`.

#### Logs (`#/logs`)
Log tail viewer. Level filter dropdown (trace/debug/info/warn/error), line-count limit. Reads from the
newest rolling `.log` file in the state dir. Calls `GET /api/v1/logs`.

#### Settings (`#/settings`)
Multi-section settings page:
- Recording (transcode, live-from-start, VOD backfill, ad trim, container, filename template)
- Notifications (desktop + per-event toggles)
- Monitor (max concurrent recordings, disk budget reserved)
- Platform (Twitch, YouTube, Patreon credentials form)
- Backup/restore
- Plugins (Pro plugin list — see creator-bleed §4)
- Interface (layout preferences)

---

## 2. Gap Analysis — PVR UX Patterns vs Exemplars

| Pattern | StriVo status | Evidence | Exemplar reference |
|---------|--------------|----------|--------------------|
| Library/grid + poster art | **Partial** — carousel dashboard + data table, no poster-art card grid | `spa.js:1340` (carousels), `spa.js:2417` (table) | `sonarr.md` §Library/Series View; `design-ux-patterns.md` §Card Grid |
| Filter bar with facets | **Partial** — state chips, date range, group-by, text search on Recordings | `spa.js:424-448` state/filter vars | `sonarr.md` §Filtering everywhere; `streamrec.md` §Search & Filter |
| Calendar view (upcoming streams) | **Missing** — Schedule page shows a cron table, not a visual time-grid | `spa.js` schedule render | `sonarr.md` §Calendar; `adjacent-media-apps.md` Jellyfin Live TV EPG |
| Activity/queue with live progress | **Partial** — in-progress recordings visible in Library + Recordings table; SSE feeds real-time updates; no dedicated "queue" concept | `spa.js:467` isInProgress; SSE `spa.js:361` | `sonarr.md` §Activity/Queue; `arr-suite-overview.md` §Download Client Polling |
| Wanted/missing list | **Missing** — no concept of "stream happened but wasn't captured"; no gap detection | — | `sonarr.md` §Wanted; `arr-suite-overview.md` §Wanted |
| Manual/interactive channel search | **Partial** — Add-Channel wizard resolves a name/id via `POST /api/v1/channels/resolve` | `spa.js:2081` Add-Channel wizard | `sonarr.md` §Add New; `streamrec.md` §Add Channel Flow |
| Quality profiles (tiered) | **Missing** — only boolean `transcode` + container selector; no 720p/1080p/best tiers | `api.rs:1081-1169` settings allow-list | `sonarr.md` §Quality Profiles; `streamrec.md` §Per-channel overrides |
| Bulk/mass actions | **Partial** — stop-all, clear-errored, multi-select delete on Recordings; no bulk quality/profile/tag change | `spa.js:2417` bulk action bar | `sonarr.md` §Mass Editor; `streamrec.md` §Bulk Actions |
| Tags | **Missing** — no tag system linking channels to behaviors | — | `sonarr.md` §Tags; `arr-suite-overview.md` §Tags |
| Health-check dashboard | **Present** — `/system` page with grouped checks + topbar pill | `api.rs:500-567`, `spa.js:979-997` | `sonarr.md` §Health Checks; `design-ux-patterns.md` §Health Check |
| Notifications / Connect webhooks | **Partial** — desktop notify flags in config; no outbound webhook/Discord/Slack | `api.rs:1096-1109` notification flags | `sonarr.md` §Connect; `streamrec.md` §Webhook Notifications |
| Naming/filename templates | **Partial** — `recording.filename_template` configurable via Settings; no token browser or preview | `api.rs:1165-1167` | `sonarr.md` §Naming/Renaming Scheme |
| Per-channel format overrides | **Partial (API-only)** — `AutoRecordEntry` has `format`/`profile` fields; no Settings UI exposes them | `api.rs:1714-1721` | `streamrec.md` §Per-channel overrides |
| Live log panel | **Partial** — global rolling log; no per-recording live stdout | `api.rs:1349-1383` | `streamrec.md` §Recordings Page live log |
| Concurrent-slot indicator | **Partial** — left rail shows "N in progress" via `updateLiveCount`; no N/M cap display | `spa.js:1023` | `streamrec.md` §Concurrent slot indicator |
| In-browser preview | **Present** — Watch + Viewer pages with HTTP Range + native `<video>` | `routes/recordings.rs`, `spa.js:5309+` | `streamrec.md` §In-browser preview |
| Import/export | **Partial** — config.toml + jobs.db backup download as tarball; no JSON channel-list export | `api.rs:1385-1510` | `streamrec.md` §Import/export JSON |
| First-run onboarding | **Present** — first-run checklist gates the dashboard when no platform is configured | `spa.js:1199-1252` | `arr-suite-overview.md` §First-Run |
| Blocklist | **Present** — manual block by platform+channel_id | `api.rs:1596-1656` | `sonarr.md` §Activity/Blocklist |
| Storage indicators | **Partial** — storage stats available at `/api/v1/storage`; Settings page doesn't surface a visual gauge | `api.rs:574-596` | `streamrec.md` §Disk usage stats; `design-ux-patterns.md` §Storage |
| Backup/restore | **Present** — create, list, download, restore from Settings | `api.rs:1385-1548` | `sonarr.md` §System/Backups |
| VOD/past-broadcast download | **Present** — channel detail "Past Broadcasts" list with per-VOD download + progress | `api.rs:2170-2188` | — |

---

## 3. Top UX/UI Gaps — Prioritized

### HIGH: Creator-bleed in top navigation (`spa.js:887-892`)
**What's missing:** Studio, Analytics, Publish, and Pipelines nav items appear in the topbar for all
builds. In the PVR build Studio/Analytics/Publish render a Pro upsell card (`renderProApp`); Pipelines
calls `GET /api/v1/pipelines/dag` which returns 404 and renders "No pipelines defined." Chat is a
full-build feature but is creator-centric.

**Which exemplar does it well:** Not applicable — this is a bleed-containment issue specific to StriVo's
split build model.

**Suggestion:** Gate TOPNAV entries via a capability flag injected by the server. The simplest fix:
`GET /api/v1/settings` already returns feature flags; add a `build_features: ["pvr"]` or
`build_features: ["pvr", "creator"]` field and filter TOPNAV in `chrome()` at `spa.js:897`. This avoids
a server-side HTML template change and keeps the SPA approach intact. Alternatively, the `/api/v1/health`
or `/api/v1/settings` response could expose a boolean `creator_enabled` that the SPA reads once at boot
and stores in a module-level variable.

### HIGH: Creator-only buttons visible in Recording Info modal (`spa.js:8007-8063`)
**What's missing:** For every finished recording the Info modal unconditionally renders:
"📜 Show transcript" (`#/plugins/crunchr/…`), "★ Find highlights" (calls `/api/v1/plugins/clipper/…`),
"⌶ Detect scene changes" (calls `/api/v1/plugins/cuepoints/…`), "▥ Pick thumbnail" (calls
`/api/v1/plugins/thumbnails/…`), "⇪ Publish drafts" (calls `/api/v1/plugins/reuse/…`),
"📓 Casebook" (calls `/api/v1/plugins/casebook/…`), "✄ EDL editor" (calls
`/api/v1/plugins/editor/…`). In the PVR build `routes/plugins.rs` is not mounted
(`server.rs:85`), so every one of these calls returns 404 and the user sees an error toast.

**Which exemplar does it well:** Sonarr's recording detail shows only available actions for the
current item's state; it doesn't show Radarr-specific actions in Sonarr.

**Suggestion:** Same capability flag approach as above: read `creator_enabled` from the settings
response and conditionally render the `rec-info-cuepoints-btn`, `rec-info-clipper-btn`,
`rec-info-thumbs-btn`, `rec-info-reuse-btn`, `rec-info-casebook-btn`, `rec-info-editor-btn` buttons,
and the "Show transcript" link. The `crunchr.available` check at `spa.js:8011` already gates the
transcript link against plugin availability — extend that pattern to all seven buttons.

### HIGH: Monitor page "Tandem downloads" section always empty in PVR (`api.rs:1879-1880`)
**What's missing:** The Monitor page (`GET /api/v1/monitor`) returns `auto_download: []` in PVR
builds (the `#[cfg(not(feature = "creator"))]` branch). The SPA renders an "Auto-download new
uploads" section that is permanently empty and confusing.

**Suggestion:** Have the SPA hide the Tandem Downloads section when `auto_download` is empty AND
`creator_enabled` is false. One CSS class on the container is sufficient.

### MEDIUM: No calendar / upcoming-streams grid
**What's missing:** The Schedule page shows a table of cron entries with the next fire time. There is
no visual time-grid of upcoming scheduled recordings or of past/future streams. Jellyfin's Live TV
EPG grid (channel × time) and Sonarr's calendar are the gold standard here.

**Which exemplar does it well:** Sonarr (`sonarr.md` §Calendar View); Jellyfin Live TV
(`adjacent-media-apps.md` §Jellyfin Live TV).

**Suggestion:** A 7-day horizontal calendar strip above the cron table, driven by the
`next_fire` timestamps already returned by `GET /api/v1/schedule` (`api.rs:355-358`). Low API
cost, high visual payoff. Each entry is a clickable block; block color = channel. A full EPG view
is a larger lift and likely not worth it until multiple scheduled recordings become common.

### MEDIUM: No per-channel quality/format overrides in Settings UI
**What's missing:** `AutoRecordEntry` at `api.rs:1714-1721` has `format` and `profile` fields, but
`PUT /api/v1/channels/{key}/auto_record` never writes them (only `format: None, profile: None`).
The Settings/Monitor UI has no row for per-channel overrides. streamerREC (`streamrec.md` §Add
Channel Flow) supports quality and container per channel. Sonarr uses quality profiles.

**Suggestion:** Add a "⚙ Override" button per channel row in the Monitor section that opens a small
form: container selector (matroska/mp4/webm) and an optional quality hint (best/1080p/720p/audio-only).
Wire to an extended `PUT /api/v1/channels/{key}/auto_record` payload. This is 2–3 days of work end-to-end.

### MEDIUM: No outbound notification/webhook system
**What's missing:** The config has `notifications.on_go_live`, `on_recording_finished`, etc. as
desktop-notification toggles, but there is no webhook, Discord, Telegram, or email target. Sonarr's
Connect system (`sonarr.md` §Connect) supports 20+ integrations. streamerREC (`streamrec.md`
§Webhook Notifications) uses a simple JSON POST that works with n8n/Zapier.

**Suggestion:** Start with a single generic webhook (HTTP POST JSON) configurable in Settings →
Notifications. The payload shape should mirror streamerREC's: `{event, channel_id, name, platform,
recording_id, status, filename, bytes, error}`. This unblocks integration with n8n/Zapier/Home
Assistant. Discord and ntfy can be added later as first-party connectors once the trigger model is
stable.

### MEDIUM: Missing storage gauge in UI
**What's missing:** `GET /api/v1/storage` (`api.rs:574-596`) returns total/available bytes for the
recording filesystem, but the Settings page does not render a visual gauge. streamerREC
(`streamrec.md` §Disk usage stats) shows this prominently on the Recordings page. Sonarr surfaces
it in System > Status.

**Suggestion:** Render a disk-usage bar in the System page (next to the disk-space health check
row) and as a footer element in the left rail, both fed from the `/api/v1/storage` data already
returned as part of health checks.

### LOW-MEDIUM: No concurrent-slot indicator
**What's missing:** streamerREC (`streamrec.md` §Concurrent slot indicator) shows "N/M slots."
StriVo updates a live count in the left rail but doesn't display `max_concurrent_recordings` from
config alongside it.

**Suggestion:** Add a "N / M rec" badge to the topbar or left-rail header, where M is
`monitor_limits.max_concurrent_recordings` from `GET /api/v1/settings`. One line of template change.

### LOW: Filename template token browser
**What's missing:** `recording.filename_template` can be set in Settings but there is no token-list
dropdown or live preview. Sonarr (`sonarr.md` §Naming Scheme) has a full token browser.

**Suggestion:** Render a collapsible `<details>` below the template input listing available tokens
(channel, platform, date, title, stream_id, etc.). A server-rendered token list endpoint is not
necessary — the set of tokens is static and can be inline JSON in the SPA.

### LOW: No tags / cross-cutting organization
**What's missing:** Sonarr's tag system (`sonarr.md` §Tags) links series to specific profiles and
indexers. StriVo has no equivalent. Currently channels are identified only by platform:id.

**Suggestion:** Defer until there are at least two distinct "behaviors" that need per-channel
scoping (e.g., one quality profile per channel + one notification target per channel). A premature
tag system adds complexity before the features that would consume it exist.

---

## 4. Creator-Bleed Findings

The SPA is a single embedded static asset (`crates/strivo-web/assets/spa.js`). Rust feature gates
apply only to backend routes, not to the JS bundle. The following surfaces are visible and partially
functional (or visibly broken) in the default PVR build:

### 4a. Top navigation — Studio, Analytics, Publish, Pipelines tabs always rendered

`spa.js:887-892` (TOPNAV array):
```js
["studio",    "🎬", "Studio",    "u", ...],
["analytics", "📈", "Analytics", "a", ...],
["publish",   "🚀", "Publish",   "p", ...],
```
These three routes call `renderProApp(paneKey)` at `spa.js:6216`, which fetches
`GET /api/v1/plugins/capabilities` (creator-only, 404 in PVR) and renders Pro upsell cards.
The user sees a marketing page for features they cannot use.

Pipelines (`spa.js:887` TOPNAV includes it via `["schedule",…]` using the Schedule icon; see the
route at `spa.js:822`) calls `GET /api/v1/pipelines/dag` (creator-only) which 404s and the page
shows "No pipelines defined."

**Files to fix:** `spa.js:877-895` (TOPNAV), `spa.js:897-944` (chrome()). Gate these four entries on
a `creatorEnabled` boolean read at boot from `GET /api/v1/settings`.

### 4b. Recording Info modal — 7 creator-only action buttons always rendered for finished recordings

`spa.js:8007-8063`. These buttons are unconditionally injected into the modal HTML for any finished recording:

| Button | API route called | Backend status in PVR |
|--------|-----------------|----------------------|
| 📜 Show transcript | `#/plugins/crunchr/rec/<id>` nav | Route exists but plugin data 404 |
| ⌶ Detect scene changes | `POST /api/v1/plugins/cuepoints/<id>` | 404 (plugins router not mounted) |
| ★ Find highlights | `POST /api/v1/plugins/clipper/<id>/analyze` | 404 |
| ▥ Pick thumbnail | `POST /api/v1/plugins/thumbnails/<id>` | 404 |
| ⇪ Publish drafts | `POST /api/v1/plugins/reuse/<id>/generate` | 404 |
| 📓 Casebook | `GET /api/v1/plugins/casebook/<id>?fmt=json` | 404 |
| ✄ EDL editor | `GET /api/v1/plugins/editor/<id>` | 404 |

Each one fires an error toast on click in the PVR build.

**Fix:** Add `creatorEnabled` guard in `spa.js:8050-8056`. The existing `crunchr.available` check
at `spa.js:8011` already shows the right pattern — extend it.

### 4c. Settings → Plugins tab renders the full Pro plugin catalog

`spa.js:9960-10002`. The Plugins settings tab lists every Pro plugin (crunchr, editor, clipper,
heatmap, insights, brandsafe, reuse, etc.) with enable-toggle, size, clear, and "Open →" links.
The plugin data routes (`/api/v1/plugins/*`) are served by `routes/plugins.rs`, which is only
mounted when `#[cfg(feature = "creator")]` (`server.rs:85`). Clicking "Open →" lands the user on
the plugin hub (`#/plugins`) which in PVR build calls `GET /api/v1/plugins` → 404 and renders
"No plugins." Toggling a plugin calls `POST /api/v1/settings/update` with a `plugins.*.enabled`
path, which does work, but has no effect in PVR.

**Fix:** In Settings → Plugins, hide or replace the Pro plugin list with a single "Upgrade to
Creator Edition to unlock transcription, editing, and analytics plugins" card when `creatorEnabled`
is false.

### 4d. Monitor page — "Tandem downloads" section is permanently empty

`api.rs:1879-1880`:
```rust
#[cfg(not(feature = "creator"))]
let auto_download: Vec<serde_json::Value> = Vec::new();
```

The SPA renders an "Auto-download new uploads" section under Monitor. In PVR it is always empty.
No label indicates this is a Creator Edition feature.

**Fix:** Render the tandem section only when `auto_download.length > 0` OR `creatorEnabled`.
If neither, show nothing or a "Creator Edition only" badge.

### 4e. dataviz route calls Crunchr transcript API

`spa.js:4640,4679-4700`. The Data Viz page (`#/dataviz`) instructs users to "make sure each
recording has been transcribed first" and calls `API.crunchrTranscript(id)` which hits
`GET /api/v1/plugins/crunchr/transcript/<id>` (404 in PVR). The route itself is not in TOPNAV but
is reachable via deep-link or keyboard shortcut `d`.

**Fix:** Remove `dataviz` from the TOPNAV keyboard shortcuts in PVR, or redirect it to a
"Creator Edition" upsell page.

### 4f. API object contains 30+ creator-only method definitions (`spa.js:107-358`)

These are not called from PVR page renderers but are part of the embedded bundle:
`crunchrRecordings`, `clipperAnalyze`, `editorLoad`, `heatmapCompute`, `brandsafeScan`,
`reuseGenerate`, `casebookFetch`, `multitrackList`, `sidechainBuild`, `beatDetectRun`,
`structureClassify`, `loudnessMeasure`, `chatRooms`, `pipelinesDag`, `marketplaceCatalog`, etc.

These are dead code in the PVR build and harmlessly inflate bundle size. Not a functional bug,
but worth noting for a future build-split.

---

## 5. DESIGN.md Deviations

### Critical: Wrong Jellyfin theme in CSS

`DESIGN.md` (Web UI Theme section) says:
> "The StriVo web UI follows the user's Jellyfin theme as literally as possible: the **ElegantFin** theme (lscambo13/ElegantFin)"
> Accent: `rgb(119,91,244)` (purple), background `linear-gradient(180deg,#101010 0%,#050505 100%)`

`crates/strivo-web/assets/spa.css:1-6` says:
```css
/* JellySkin-derived theme (prayag17/JellySkin): deep navy gradient, purple→cyan
   accent gradient, heavy frosted glass, Montserrat. */
```

The CSS implements **JellySkin** (navy gradient `hsl(208,89%,5%)`, `--blur: blur(25px)`) while the
design doc prescribes **ElegantFin** (near-black gradient `#101010→#050505`, lighter glass `blur(2px)`).
These are two distinct community Jellyfin CSS themes by different authors. The background, blur depth,
and card treatment are all different. This is a significant code/doc drift.

### Critical: Wrong font and CDN

`DESIGN.md` (Typography section):
> Display: Satoshi; Body: Instrument Sans; Data: JetBrains Mono
> CDN: `https://fonts.bunny.net` (privacy-friendly Google Fonts alternative)

`spa.css:10`:
```css
@import url("https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap");
```

The SPA loads **Montserrat** from **Google Fonts**. Neither font nor CDN matches DESIGN.md. Montserrat
is not in the DESIGN.md typography system at all. The Google Fonts CDN sends `referer` and IP headers
to Google on page load — a privacy regression from the stated Bunny Fonts goal.

### Moderate: Accent color conflict in design doc itself

`DESIGN.md` §Color Core Accents specifies cyan `#00E5FF` as primary accent.  
`DESIGN.md` §Web UI Theme Tokens specifies purple `rgb(119,91,244)` as the ElegantFin accent.  

These are contradictory within the same document. The CSS resolves the conflict by choosing purple
(`--primary: hsl(285,46%,56%)`), consistent with the ElegantFin/JellySkin Jellyfin themes, but the
Neon-themed TUI section of DESIGN.md points at cyan. The product brand identity in the Decisions Log
explicitly says "Cyan #00E5FF over Dracula purple" to differentiate from Twitch. This tension should
be resolved by deciding whether the SPA follows the Jellyfin aesthetic (purple) or the brand identity
(cyan).

### Minor: Background token wrong in CSS vs DESIGN.md

`DESIGN.md` §Web UI Theme Tokens: background `linear-gradient(180deg,#101010 0%,#050505 100%)`
`spa.css:14-15`:
```css
--bg: hsl(208, 89%, 5%);
--bg-gradient: linear-gradient(45deg, hsl(208, 89%, 5%), hsl(208, 89%, 20%));
```

Angle is `45deg` (JellySkin) vs `180deg` (ElegantFin); color is navy (JellySkin) vs near-black
(ElegantFin). Consistent with the theme-mismatch finding above.

### Minor: DESIGN.md specifies Satoshi for display but no Satoshi is loaded anywhere

`spa.css` loads only Montserrat. No Satoshi, Instrument Sans, or JetBrains Mono is loaded.
The page-title headings use Montserrat at body weight. JetBrains Mono for data/tables falls back to
system monospace fonts via `--mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo…` — this works
but degrades gracefully rather than using the designed font.

---

## Summary

Top 10 findings for the PVR build:

1. **Creator bleed — TOPNAV** (`spa.js:887-892`): Studio, Analytics, Publish are always visible and
   navigate to Pro upsell or 404 pages. Pipelines calls a creator-only endpoint. Fix: gate on
   `creatorEnabled` from `/api/v1/settings`.

2. **Creator bleed — Recording Info modal** (`spa.js:8050-8056`): 7 creator-only buttons
   unconditionally visible for finished recordings; all fire 404 errors in PVR build. Fix: same
   `creatorEnabled` guard.

3. **Creator bleed — Monitor "Tandem downloads"** (`api.rs:1879-1880`): always-empty section
   in PVR with no explanation. Fix: hide when `auto_download.length === 0 && !creatorEnabled`.

4. **Creator bleed — Settings → Plugins tab** (`spa.js:9960`): full Pro plugin catalog shown;
   "Open" links hit 404 backend. Fix: replace with upgrade CTA when `!creatorEnabled`.

5. **Wrong theme in CSS** (`spa.css:1-6`): JellySkin (navy, 25px blur) vs prescribed ElegantFin
   (near-black, 2px blur) from `DESIGN.md`. The visual identity is inconsistent with the spec.

6. **Wrong font + wrong CDN** (`spa.css:10`): Montserrat from Google Fonts vs Satoshi/Instrument
   Sans from Bunny Fonts per `DESIGN.md`. Privacy regression.

7. **No calendar view** for upcoming scheduled streams; the Schedule page is a cron table only.
   Relevant exemplars: `sonarr.md` §Calendar, `adjacent-media-apps.md` §Jellyfin Live TV.

8. **No per-channel format/quality overrides in Settings UI** despite the data model supporting
   `format`/`profile` on `AutoRecordEntry` (`api.rs:1714`). Competitor streamerREC has this
   (`streamrec.md` §Per-channel overrides).

9. **No outbound notifications/webhooks** — only desktop OS notifications. streamerREC's simple
   JSON webhook (`streamrec.md` §Webhook Notifications) would unblock n8n/Zapier/Home Assistant
   integrations with minimal server work.

10. **Missing storage gauge in the UI** despite `GET /api/v1/storage` returning the data. The
    System page health check text says disk free/total; a visual bar is trivial and expected
    (`streamrec.md` §Disk usage stats, `design-ux-patterns.md` §Storage).

Output path: `/home/revelri/Dev/chorosyne/strivo/research/analysis/ui-ux.md`
