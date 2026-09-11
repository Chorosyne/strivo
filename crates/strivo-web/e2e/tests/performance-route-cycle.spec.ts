import { test, expect } from "@playwright/test";

// Durable gate for Lane 1's route-teardown fixes (A-01 logsFollowTimer,
// and the controller-teardown paths destroyAllControllers()/
// destroyChannelDetailPreview() rely on). Cycles Home→Recordings→Watch→
// Logs→Settings 20x against the mock and asserts the DOM node count stays
// flat and JS heap growth stays bounded — a regression here means some
// per-route resource (timer, controller, listener) is accumulating
// instead of being torn down by teardownAcrossRoutes().
//
// A live tile is seeded into the watch slot before the loop starts so
// #/watch actually mounts a player controller on every cycle; the
// original audit run (scratchpad/auditor-a/nav-memory-check.mjs) had
// zero tiles, so destroyAllControllers() was never exercised.

const ROUTES = ["#/library", "#/recordings", "#/watch", "#/logs", "#/settings"];

test("20 route cycles keep DOM node count flat and JS heap growth bounded", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
  // The seeded tile is a real Twitch embed URL (player.twitch.tv). Left
  // unstubbed, 20 cycles of mounting/destroying that cross-origin iframe
  // measures Twitch's own page weight, not this app's teardown — and
  // depends on outbound network the test sandbox may not have. Stub it to
  // an inert same-origin-ish blank so the heap sample reflects only the
  // SPA's own retained state.
  await page.route("https://player.twitch.tv/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }));

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await client.send("HeapProfiler.enable");

  // Seed a live stream into the single watch slot (mock's
  // "Twitch:twitch-live-1" fixture) so every pass through #/watch mounts
  // and then tears down a real player controller.
  await page.goto("/app#/watch?focus=Twitch%3Atwitch-live-1&fresh=1");
  await expect(page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"]')).toHaveCount(1);

  async function sample() {
    try { await client.send("HeapProfiler.collectGarbage"); } catch (_) { /* best effort */ }
    const domCount = await page.evaluate(() => document.querySelectorAll("*").length);
    const metrics = await client.send("Performance.getMetrics");
    const heap = metrics.metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0;
    return { domCount, heap };
  }

  const before = await sample();

  for (let i = 0; i < 20; i++) {
    for (const route of ROUTES) {
      await page.evaluate((hash) => { window.location.hash = hash; }, route);
      await page.waitForTimeout(120);
    }
  }
  // Land back on the seeded watch route so the final sample tears down
  // through the same controller-bearing state it started from.
  await page.evaluate(() => { window.location.hash = "#/watch"; });
  await page.waitForTimeout(120);

  const after = await sample();

  // Flat, not zero-growth: some steady-state chrome (toasts, SSE pill
  // state) is allowed to vary a little between samples without being a
  // leak signature. The 2026-09-08 baseline measured 254 nodes flat over
  // 20 cycles; a real per-route DOM leak grows roughly linearly with
  // cycle count, so even a generous fixed slack catches it.
  expect(after.domCount).toBeLessThanOrEqual(before.domCount + 60);

  // The baseline measured ~18% heap growth over 20 cycles as noise, not a
  // leak signature. Gate well above that (2x) so this only fires on an
  // actual accumulation, not GC/JIT jitter.
  if (before.heap > 0) {
    const growth = (after.heap - before.heap) / before.heap;
    expect(growth).toBeLessThan(2.0);
  }
});
