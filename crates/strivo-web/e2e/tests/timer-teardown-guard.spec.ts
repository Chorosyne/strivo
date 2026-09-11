import { test, expect } from "@playwright/test";

// Durable gate for teardownAcrossRoutes(): after leaving a route, every
// per-route timer it owns must actually be cleared (id === null), not
// just "probably cleared" by inspection. debugActiveTimers() is a
// mock-lane-only debug hook (window.__strivoTestHooks, opted into via
// localStorage["strivo:e2e"]) exposing the live values of
// cdPosterTimer, playerState.refreshTimer, _watchRefreshTimer, and
// logsFollowTimer — see 008-pvr.js.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("strivo-tour-done", "1");
    localStorage.setItem("strivo:e2e", "1");
  });
});

test("no per-route timer survives teardownAcrossRoutes()", async ({ page }) => {
  await page.goto("/app#/logs");
  // Arm every timer teardownAcrossRoutes() is responsible for:
  //  - logsFollowTimer via the Follow checkbox
  await page.locator("#logs-follow").check();

  const armed = await page.evaluate(() => (window as any).__strivoTestHooks.debugActiveTimers());
  expect(armed.logsFollowTimer).not.toBeNull();

  // Leaving the route runs teardownAcrossRoutes() inside render().
  await page.evaluate(() => { window.location.hash = "#/library"; });
  await expect(page.locator("h1.page-title")).toHaveText("Home");

  const afterTeardown = await page.evaluate(() => (window as any).__strivoTestHooks.debugActiveTimers());
  expect(afterTeardown).toEqual({
    cdPosterTimer: null,
    playerRefreshTimer: null,
    watchRefreshTimer: null,
    logsFollowTimer: null,
  });
});

test("watch-route refresh timers are cleared when leaving #/watch", async ({ page }) => {
  await page.goto("/app#/watch?focus=Twitch%3Atwitch-live-1&fresh=1");
  await expect(page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"]')).toHaveCount(1);

  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await expect(page.locator("h1.page-title")).toHaveText("Settings");

  const afterTeardown = await page.evaluate(() => (window as any).__strivoTestHooks.debugActiveTimers());
  expect(afterTeardown.playerRefreshTimer).toBeNull();
  expect(afterTeardown.watchRefreshTimer).toBeNull();
});
