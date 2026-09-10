**Performance and UX audit — 2026-09-08**

The largest obstacles to a smooth media-library experience are unstable view ownership, destructive live updates, sequential navigation requests, and a mismatch between durable library records and playback lookup. These affect responsiveness and trust even when individual endpoints are fast. Fixing them should precede additional visual effects.

Audited the current working tree based on commit `84ba7cac901dfc8cc5ca17a40ef8e088246c61c2`, including pre-existing uncommitted changes. Scope: released PVR web application, its Axum endpoints, daemon snapshots, and recording persistence. The root Next.js marketing site and experimental Creator functionality were not audited in depth. No application code was changed.

Browser experiments used Chromium, actual PVR JS/CSS source modules, and the deterministic mock backend. The harness overrides the mock's Creator setting and SVG MIME type to match PVR presentation. It adds test hooks only to intercepted browser responses. This is not a release-binary benchmark, a live platform playback test, or a measured comparison against Jellyfin. Backend findings below are source-traced; actual disk, network, codec, and GPU performance remain to be measured with representative media.

**Evidence**

| Experiment | Result |
| --- | --- |
| Delayed Recordings request, navigate to Settings, release old request | URL remains `#/settings`; visible title becomes `Recordings` |
| Open recording menu, focus its button, repaint | Original row removed, menu closes, focus becomes `BODY` |
| Repaint 200 rows, 10 repetitions | 9.8–15.7 ms synchronous JS, excluding deferred layout/paint |
| Repaint with forced layout at 4× CPU slowdown, 5 repetitions | 140–176 ms; synthetic stress check, not a hardware prediction |
| Home navigation, warm data arrays but expired request cache; inject 150 ms per API request | Dashboard appears after 800 ms; five sequential request stages |
| Load 502 mock recordings, emit RecordingFinished after invalidating request cache | Loaded collection shrinks back to 500 |
| Mount paused recording controller with `preload=none`, wait 15.5 seconds | Reports unreadable/corrupt recording without playback being requested |
| Existing player/controller/remediation tests | 35 passed |
| Existing UX-budget tests, default enforcement | 29 passed; tiny-text and letterbox checks remain report-only |

Raw results: [browser-results.json](browser-results.json). Reproduction: [browser-audit.mjs](browser-audit.mjs). Mock screenshots: [Home](library.png), [Recordings](recordings.png). The mock does not provide representative artwork or playable archived media; blank thumbnails in these screenshots are not evidence of a production asset defect. No page JavaScript errors occurred during the custom audit.

**1. P1 — Archived recordings outlive the lookup required to play them.**

[Playback lookup](../../../crates/strivo-web/src/routes/recordings.rs#L29) resolves an ID exclusively from the current daemon snapshot. [Recording completion](../../../src/daemon.rs#L162) evicts older terminal jobs, retaining only [200 terminal entries](../../../src/daemon.rs#L21). Startup restores at most [500 journal jobs](../../../src/recording/persist.rs#L472). Meanwhile [Timeline's history endpoint](../../../crates/strivo-web/src/routes/api.rs#L2116) pages through the durable journal. An older recording can therefore remain in Timeline and on disk while its download/playback endpoint returns “recording not found.” The regular Recordings table also represents this limited snapshot rather than the complete archive. Source-traced, not exercised against a live daemon here.

Resolve library metadata and media paths from the durable catalog, overlaying active job state. Keep path-containment and authentication checks. Reuse this resolution for download, probe, thumbnail, and recording-detail endpoints, which currently depend on snapshots. Verify an old recording still lists, seeks, and plays after newer completions evict it from memory and after daemon restart.

**2. P1 — Late route responses can overwrite newer navigation.**

The [router](../../../crates/strivo-web/assets/spa/008-pvr.js#L472) captures a route and awaits hydration/health without a navigation generation or cancellation check. Route renderers then write directly to the shared root after their own awaits, including [Recordings](../../../crates/strivo-web/assets/spa/012-pvr.js#L1806). Browser reproduction left the Settings URL displaying Recordings. Apart from confusing users, this can restore handlers and resources belonging to an abandoned view.

Give each navigation a generation and route-scoped cleanup context. Before every asynchronous DOM commit, require that the generation is still current. Guard individual renderer awaits too: checking only the router is insufficient. Cancel requests where ownership permits; shared request coalescing needs explicit handling. Test slow A → fast B navigation, redirects to login, and delayed channel-detail updates.

**3. P1 — Routine progress destroys interactive DOM and consumes the frame budget.**

[RecordingProgress](../../../crates/strivo-web/assets/spa/036-pvr.js#L1206) schedules [paintRecordings](../../../crates/strivo-web/assets/spa/012-pvr.js#L2241), which filters/sorts and replaces the entire table body at lines 2298–2300, then reattaches row handlers. The dashboard similarly replaces its subtree through [paintDashboard](../../../crates/strivo-web/assets/spa/012-pvr.js#L692). Coalescing into requestAnimationFrame reduces duplicate work within a frame but does not reduce the work itself or preserve element identity.

The browser confirmed loss of an open menu and keyboard focus. At 200 visible rows, synchronous repaint alone approached a 16.7 ms frame budget; forced layout under CPU slowdown exceeded 100 ms. Search invokes the same full repaint on [every input event](../../../crates/strivo-web/assets/spa/012-pvr.js#L1904). Title sorting repeatedly calls `niceTitle`, which constructs regular expressions, inside the comparator. “Show more” raises `recRenderLimit` without a ceiling, so the initial 200-row limit is not a sustained DOM bound.

Patch progress text, size, status, and fill on keyed rows; reorder only when the active sort requires it. Use delegated row actions and retain menu/focus state. Normalize search/sort keys once per record revision. For large browsing collections, use bounded pagination or a virtualized window. Verify a focused button, open menu, selection, and scroll position survive real progress events, and measure typing/scrolling while recordings are active.

**4. P1 — Navigation serializes unrelated requests before showing the destination.**

[render](../../../crates/strivo-web/assets/spa/008-pvr.js#L505) blocks on hydration and then health. [renderHome](../../../crates/strivo-web/assets/spa/012-pvr.js#L616) awaits settings, then channels/recordings together, then Patreon, then schedule, before replacing the root. Even with populated route caches, expiring the two-second request cache restores this waterfall. In the controlled browser run, requests began around 5, 159, 316, 473, and 627 ms; the dashboard appeared at 800 ms with only 150 ms added to each request.

Mount the application chrome once, acknowledge destination navigation immediately, and display cached content or dimensionally stable placeholders. Fetch independent sections together and hydrate each section as it becomes available. Health status should update asynchronously. Keep the sidebar and its scroll/focus intact across content navigation. Verify failure of Patreon or health does not block the rest of Home.

**5. P2 — SSE “refreshes” can read stale data and leave completed jobs looking active.**

The [API cache](../../../crates/strivo-web/assets/spa/002-pvr.js#L6) returns GET results for two seconds. Only successful non-GET requests invalidate it. [Recording lifecycle and channel state handlers](../../../crates/strivo-web/assets/spa/036-pvr.js#L1173) call cached GET methods without invalidating the affected resource. If a finish event follows a recent GET, both the lifecycle handler and its renderer can consume the old snapshot. Cache expiry does not itself trigger a refetch, so the stale display may last beyond two seconds. Separately, invalidation removes cache entries but leaves in-flight reads able to repopulate them with pre-mutation results.

Invalidate or patch affected resources on authoritative events. Give request-cache writes a resource generation so reads started before invalidation cannot repopulate current state. Coalesce refreshes without discarding events. Verify a finish event arriving immediately after a GET updates the status even when no later events occur.

**6. P2 — Lifecycle refresh discards loaded pages and rebuilds the screen.**

The [lifecycle handler](../../../crates/strivo-web/assets/spa/036-pvr.js#L1214) replaces `recCache` with the first page and invokes `renderRecordings()`. In contrast, [Load more](../../../crates/strivo-web/assets/spa/012-pvr.js#L1981) appends to that cache. The browser reproduced a collection shrinking from 502 to 500 on a finish event, even with request-cache invalidation, so this is independent of finding 5. A user browsing older results loses them when background work finishes. Full-root replacement also discards current DOM interaction state.

Keep normalized records and loaded page membership separately. Apply the changed job by ID, preserving loaded results and viewport position. If pagination must be refreshed, reconcile it in the background. Verify completion during scrolling, filtering, and an open row menu does not reset browsing.

**7. P2 — An idle player is diagnosed as corrupt after 15 seconds.**

[makeRecordingController](../../../crates/strivo-web/assets/spa/018-pvr.js#L297) deliberately sets `preload=none` for an unstarted tile, but its unconditional [15-second timeout](../../../crates/strivo-web/assets/spa/018-pvr.js#L339) treats absence of metadata as failure. This was reproduced with a paused controller. The error overlay is not cleared by subsequent `loadedmetadata` or `playing` events. The shared error message also claims container corruption for network failures and unsupported formats.

Start the watchdog only when loading/playback is requested, cancel it on destroy/source change, and clear recoverable errors on success. Represent idle, loading, buffering, unsupported media, network failure, and decoding failure separately. Offer a retry or applicable repair action. Test a poster left untouched for a minute, slow metadata, successful recovery, and an actually unsupported file.

**8. P2 — Cold thumbnail browsing bypasses media concurrency controls.**

[recording_thumb](../../../crates/strivo-web/src/routes/api.rs#L1044) launches [ffmpeg extraction](../../../crates/strivo-web/src/routes/api.rs#L1105) on a disk-cache miss without acquiring the probe/remux semaphore. Each cold thumbnail can start a process and a full IPC snapshot. There is no per-recording in-flight deduplication or process deadline on this path. Concurrent requests for the same ID also share the same `.tmp.jpg` filename, so the documented atomic final rename does not protect concurrent writers to the temporary file. Existing cached thumbnails avoid this work; the concern is cold archives and multiple clients.

Use a bounded thumbnail queue with per-ID coalescing and a unique temporary file per job. Prioritize interactive playback over background extraction, add deadlines with child-process cleanup, and cache failures briefly to avoid repeated work for broken media. Verify cold browsing bounds active ffmpeg count and concurrent requests for one ID produce one valid cached image. Probe/remux jobs also await child completion without explicit deadlines; a wedged pair can occupy both interactive slots indefinitely.

**9. P2 — Some direct-entry routes omit the channels needed for their sidebar.**

The [hydration table](../../../crates/strivo-web/assets/spa/008-pvr.js#L385) declares only recordings for Recordings and Schedule, although `setupChromeHandlers()` calls [paintChannelList](../../../crates/strivo-web/assets/spa/012-pvr.js#L318), which requires channels. In the direct Recordings-entry browser experiment, only one Patreon rail row appeared; after visiting Home, all four mock channels were available. Depending on future SSE events to fill the rail makes bookmarks and reloads behave differently from in-app navigation.

Hydrate shell dependencies at shell ownership level, independently of route data. Distinguish “loaded empty” from “not loaded” rather than using array length as the readiness signal. Verify direct entry to each PVR route with an already-running daemon and no subsequent channel events.

**Visual and playback priorities after these fixes**

The screenshots show a strongly operational interface: icon-only top navigation and a recordings ledger share space with media cards. For the requested media-library feel, make browsing the durable archive a first-class view with consistent artwork dimensions, clear titles, a primary Play action, and visible navigation labels. Retain dense operational details in the management view. Treat this as design judgment rather than a measured performance defect.

Playback currently sends the original recording download directly to a browser video element. The inspected path has no automatic browser-capability negotiation or transcode fallback, and no durable playback-position storage. Preserving controllers during player-layout edits is already implemented and covered by tests; preserving a watch position across navigation/reload is a separate product requirement. Define the intended codec/browser matrix and resume behavior before choosing a playback pipeline. Measure click-to-first-frame and seek-to-resume using actual supported and unsupported media.

Several foundations are sound: range-based streaming uses 256 KiB chunks, JS GETs are coalesced, probe results are fingerprint-cached, probe/remux concurrency is bounded, chat appends keyed messages, and player reconciliation preserves untouched tiles. Extend these ownership and bounded-work patterns to navigation and library rendering. A framework rewrite is not required to implement the fixes above.

**Recommended implementation order and acceptance criteria**

1. Repair durable recording lookup and stale navigation commits. Old archived files must play; abandoned requests must never replace the current route.
2. Introduce persistent chrome and keyed list updates; correct event/cache/page reconciliation. Progress must preserve focus, menus, loaded results, and scroll.
3. Remove navigation waterfalls, correct player loading/error state, and bound cold-thumbnail work.
4. Add library browsing and resume behavior, then tune visual transitions against traces on target devices.

Add automated delayed-response and SSE-continuity tests using the reproductions here. Add release-bundle browser measurements for long tasks, layout shifts, navigation feedback, and CPU-throttled search/scroll. Proposed targets: navigation feedback within 100 ms, no repeated main-thread tasks over 50 ms during ordinary browsing, and total frame work within the target display's frame budget. These are proposed acceptance criteria, not current measured guarantees. Establish first-frame and seek budgets separately for direct playback, remux, and transcode cases with representative media and networks.

The current UX-budget tests cover dimensions and overlays, not temporal smoothness. Their passing result therefore does not contradict these findings. Keep the existing checks, enforce the currently advisory visual checks once corrected, and add tests for continuity under concurrent background updates.

To rerun the custom audit, start `PORT=8299 node mock-server.mjs` from `crates/strivo-web/e2e`, then run `node docs/audits/2026-09-08-performance-ux/browser-audit.mjs > docs/audits/2026-09-08-performance-ux/browser-results.json` from the repository root. Existing checks run: `npx playwright test tests/spa-ux-remediation.spec.ts tests/player-controller.spec.ts tests/player-bar.spec.ts --workers=2 --reporter=line` and `npx playwright test tests/ux-budget.spec.ts --workers=2 --reporter=line` from the e2e directory. These checks use the mock suite's default combined source bundle; the custom audit explicitly uses PVR modules.
