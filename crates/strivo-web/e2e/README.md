# StriVo Web UI — E2E tests (W7)

Headless Playwright suite covering the critical webui journeys: login,
library (live/offline channels), bulk-download trigger, ⌘K command
palette navigation, recordings grid filter/sort, and the Patreon route.

The tests run against the **real SPA assets** (`../assets`) served by a
small Node mock backend (`mock-server.mjs`) that stubs `/api/v1` and
`/events`. No daemon, no platform auth, fully deterministic.

## Run

```sh
cd crates/strivo-web/e2e
npm install
npm run install-browser   # one-time: downloads Chromium (skip if already cached)
npm test
```

Playwright's `webServer` config starts the mock server automatically on
port 8199 and tears it down after the run.

## Files

- `mock-server.mjs` — static asset server + API/SSE stubs + fixtures.
- `playwright.config.ts` — chromium project, `webServer`, `baseURL`.
- `tests/smoke.spec.ts` — the journeys.

`node_modules/` and reports are gitignored; only the source is checked in.

The performance regression lane runs the three `performance-*.spec.ts`
files against a separate PVR-only mock on port 8299:

```sh
npm run test:performance
```

It checks delayed navigation, live-update continuity, archive pagination,
cache invalidation, and player loading/error state. It uses one worker to
avoid competing browser tests distorting timing-sensitive interactions.
The ordinary mock suite still uses the combined Creator/PVR source bundle.

To validate minification and build-time module selection too, set
`STRIVO_E2E_ASSETS_DIR` to the `out/assets` directory reported by the PVR
release build's `build-script-executed` Cargo JSON message. CI preserves
that exact directory as `target/pvr-release/assets` and runs this lane
against it. A source-bundle pass alone does not validate the release bundle.
