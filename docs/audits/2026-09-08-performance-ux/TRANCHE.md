**September 8 performance/UX remediation — one tranche, three Terra agents**

Implemented all nine audit concerns in the shared working tree. The supervisor
coordinated renderer contracts and file ownership, reviewed integration, corrected
cross-cutting edge cases, and ran combined checks. Existing unrelated work was
preserved. No commits or service restarts were performed.

| Agent slice | Audit findings | Result |
| --- | --- | --- |
| Navigation | 2, 4, 9 | Route contexts reject abandoned commits; persistent shell and rail; independent hydration; parallel core Home requests; ancillary services do not block Home |
| Live updates | 3, 5, 6 | Keyed row/card updates, normalized sort/search values, 200-row table window, retained loaded pages, resource cache generations and event reconciliation |
| Media | 1, 7, 8 | Durable archive resolution, live-state overlay, bounded thumbnail workers, per-ID coalescing, process deadlines/cleanup, idle-player watchdog and recoverable errors |

Integration fixes include replacing changed rows without duplicate IDs, binding
handlers only once on retained nodes, preserving focus across row moves, keeping
unchanged pagination/selection controls mounted, and preventing progress storms
from indefinitely retiring in-flight reads. Archive pagination advances even when
snapshot-only live jobs fill a page. Thumbnail lock entries remain shared while
waiters exist and are pruned after their owners disappear. Failed queued thumbnail
requests recheck the failure cache before starting another process.

**Measured behavior**

| Controlled experiment | Audit | After remediation |
| --- | --- | --- |
| Home appearance with 150 ms injected per API request | 800 ms | 206 ms |
| Unchanged 200-row repaint, synchronous JS | 9.8–15.7 ms | 0.6–1.7 ms |
| Single progress update, JS plus forced layout | Previously rebuilt the table | Usually about 1.2 ms; observed 0.9–3.7 ms |
| Single progress update at 4× CPU slowdown, JS plus forced layout | Previous full rebuild took 140–176 ms | Observed 3.4–12 ms |

The baseline used PVR source modules; the new measurement used the compiled,
minified PVR release assets. These local synthetic measurements demonstrate the
changed work and request ordering, not universal latency guarantees. The
CPU-throttled before/after workloads differ intentionally: one progress event now
patches one record rather than repainting all rows. No dropped-frame or real
codec/transcode benchmark is claimed.

Raw measurements: [tranche-measurements.json](tranche-measurements.json).
Reproduction: [measure-tranche.mjs](measure-tranche.mjs). The original report and
its evidence remain unchanged as the historical baseline.

**Validation**

- Core and web Rust library/integration tests: **348 passed**. Includes a durable
  archive entry absent from IPC that lists, opens details, and serves an actual
  byte range, plus pagination and thumbnail concurrency regressions.
- Full source browser suite after reconciliation: **158 passed, 1 skipped**.
- New performance regression lane against compiled PVR release assets:
  **11 passed**. Covers route races, ancillary loading, shell identity, cache
  invalidation, progress storms, pagination continuity, grouped/ungrouped state
  transitions, menu-handler duplication, idle player and error recovery.
- Actual PVR daemon/server browser lane: **6 passed**.
- PVR release build, formatting, diff whitespace check, and core/web Clippy
  checks passed; Creator-feature Clippy with all targets also passed.

CI preserves the exact PVR release asset directory before its Creator build,
then runs `npm run test:performance` against those assets. The new lane uses a
separate PVR-only mock on port 8299. The ordinary source suite retains its
combined-edition coverage. Recording-settings tests now dismiss onboarding in
setup, consistently with the other focused UI suites, so the tour cannot race
and intercept settings clicks.

This tranche repairs existing behavior. A media-first redesign, durable resume
positions, automatic codec negotiation/transcoding, and benchmarking on the user's
actual library remain separate work described in the original audit.
