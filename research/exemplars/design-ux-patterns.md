# Design & UX Patterns for Dense Self-Hosted Admin UIs

Reference apps: Sonarr, Radarr, Tdarr, streamerREC, SABnzbd, Seerr, Tautulli, Jellyfin

---

## Aesthetic / Visual System

### Dark-First Design
All major self-hosted media apps default to dark mode or offer it prominently.
Common palette:
- Background: very dark grey (not pure black) — typically #1a1a1a to #2b2b2b
- Surface/card: slightly lighter — #2c2c2c to #383838
- Accent: vibrant color for live/active states — Sonarr uses cyan/teal; streamerREC uses red for live
- Text: near-white primary, muted grey for secondary/metadata
- Status colors: green (available/live), yellow (warning/partial), red (error/failed), grey (missing/offline)

### Typography
- Monospace for file sizes, durations, IDs, log output
- Sans-serif for UI labels (Inter, system-ui)
- Dense but readable: 14px base, 12px for metadata

---

## Navigation Patterns

### Left Sidebar (dominant pattern)
Used by: Sonarr, Radarr, Jellyfin, SABnzbd, Tdarr, Unmanic
- Fixed width, collapsible on mobile
- Icon + label at desktop; icon-only when collapsed
- Active item highlighted with accent color left border or background
- Section groupings (e.g., Library | Activity | Config | System)
- Bottom of sidebar: system status indicator (disk space, health dot)

### Top Tab Bar (alternative)
Used by: some settings pages within *arr apps
- Within a section, sub-pages use horizontal tabs
- E.g., Settings → [Media Management | Profiles | Quality | Indexers | ...]

---

## Component Patterns

### Status Pills / Badges
Small inline badges communicating state:
- Shape: rounded pill (border-radius: 9999px)
- Colors: see above (green/yellow/red/grey/purple)
- Text: very short ("Live", "Recording", "Missing", "Cutoff", "Grabbed", "Queued")
- Common placements: top-right of card, inline in table cell, next to item title

### Card Grid (Library View)
- Fixed-width cards (200-220px) with poster art
- Status badge overlaid top-right
- Title below image, metadata below title (year, episode count, etc.)
- On hover: reveal quick actions (search, edit, delete)
- Keyboard navigation support

### Data Tables
- Sticky header with sort arrows
- Alternating row backgrounds (subtle)
- Right-aligned numeric columns (file size, count, duration)
- Action buttons in rightmost column (pencil/edit, trash/delete, play/grab)
- Per-row expand to show more details
- Pagination or virtual scroll for large lists
- Column visibility toggle ("Options" button shows/hides columns)

### Progress Bars
- Thin (4-6px height) under table rows or cards
- Color indicates state: blue = downloading, green = complete, yellow = stalled, red = failed
- Show percentage text on hover or inline

### Toasts / Notifications
- Bottom-right corner
- Auto-dismiss after 5-8 seconds
- Types: success (green), warning (yellow), error (red), info (blue)
- Optional "undo" action for destructive operations

### Modal / Drawer Dialogs
- Edit dialogs: modal overlay with form fields
- Large forms: slide-in drawer from right (Seerr pattern)
- "Show Advanced" toggle collapses optional fields

### Search / Filter Bar
- Inline text search above content
- Filter chips for facets (platform, status, quality)
- "Custom Filter" builder for power users (Sonarr pattern)
- Sort dropdown (name/date/size/status)

### Health Check / Warning Banners
- Sonarr pattern: dedicated "Status" page lists all health issues
- Each warning: title + description + recommended fix + direct link to resolve
- Color-coded: yellow = warning, red = error
- Can also appear as a badge/dot on the System nav item

### Log Viewer
- Monospace font, dark background
- Color coding: red/bold for ERROR, yellow for WARN, white for INFO, grey for DEBUG
- Auto-scroll to bottom (with "scroll to top" button)
- Level filter dropdown
- Download raw log button
- Line limit or virtual scroll for performance

### Settings Page Layout
- Vertical sections within a page (not separate pages per setting)
- Section headers with horizontal rules
- "Show Advanced" toggle reveals advanced options (highlighted in orange in Sonarr)
- Save button: top-right, disabled if no changes ("No Changes")
- Inline validation: error text under invalid fields

---

## Key UX Micro-Patterns

### Optimistic UI Updates
- Mark item as "saved/changed" immediately; roll back on API error
- Prevents laggy "waiting for server" feel

### Bulk Actions
- Checkbox column in table → select all → action bar appears above table
- Actions: delete, change quality profile, move folder, unmonitor, etc.
- Confirmation dialog for destructive bulk actions

### Inline Editing
- Click a cell to edit in-place (e.g., quality profile dropdown)
- Common in the Mass Editor

### Empty States
- When a list is empty: icon + helpful text + primary action button
- e.g., "No channels monitored. Add your first channel →"

### Keyboard Shortcuts
- streamerREC: N (add), 1-4 (navigate), R/S/Del (bulk actions)
- Sonarr/Radarr: keyboard navigation within modals
- Good practice: show shortcuts in tooltips on hover

### Responsive Behavior
- Desktop: sidebar + main content area
- Tablet: collapsible sidebar
- Mobile: bottom nav bar replacing sidebar; cards stack vertically

---

## Specific Patterns Relevant to StriVo's Web UI

| StriVo Feature | UX Pattern to Use |
|---------------|-------------------|
| Channel list | Card grid or data table; live status pill; one-click record button |
| Recording in progress | Progress bar + real-time stats (size/speed/duration) inline |
| Recording history | Data table; filterable by date/platform/channel; sort by size/date |
| System health | Dedicated Status page with categorized health checks |
| Settings | Vertical sections; Show Advanced toggle; sticky Save button |
| Notifications config | Trigger × destination matrix (On Record / On Complete × Discord / webhook) |
| Disk usage | Storage bar in sidebar footer or settings page |
| Log viewer | Monospace panel, level filter, auto-scroll |
| Platform/channel add | Modal with URL input → auto-detect platform → configure settings |
| Bulk actions | Table checkboxes → action bar → confirm destructive ops |
