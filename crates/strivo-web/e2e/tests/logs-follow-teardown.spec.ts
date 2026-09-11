import { test, expect } from "@playwright/test";

// A-01 — teardownAcrossRoutes() cleared every per-route timer except
// logsFollowTimer, so leaving #/logs with Follow enabled left a 4s
// setInterval polling /api/v1/logs from routes that no longer show it.

test("logs Follow-mode polling stops once the route is left", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));

  let logsRequests = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/logs")) logsRequests++;
  });

  await page.goto("/app#/logs");
  await page.locator("#logs-follow").check();

  // Follow polls every 4s; advance past one tick to prove it's armed.
  await page.clock.fastForward(4500);
  const afterEnable = logsRequests;
  expect(afterEnable).toBeGreaterThan(0);

  // Leave the route — this is the teardownAcrossRoutes() path.
  await page.evaluate(() => { window.location.hash = "#/library"; });
  await expect(page.locator("h1.page-title")).toHaveText("Home");
  const afterNav = logsRequests;

  // Advance past two more follow-poll intervals while parked elsewhere.
  await page.clock.fastForward(9000);
  const afterWait = logsRequests;

  expect(afterWait).toBe(afterNav);
});
