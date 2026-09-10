import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("strivo-tour-done", "1");
  });
});

test("a late recordings response cannot replace a newer Settings route", async ({ page }) => {
  await page.route("**/api/v1/recordings**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });

  await page.goto("/app#/recordings");
  await expect(page.locator("#route-status")).toContainText(/Loading recordings/i);
  await page.locator('a[href="#/settings"]').click();

  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.locator("h1.page-title")).toHaveText("Settings");
  // Allow the abandoned request to finish.  Its renderer must not reclaim
  // the shared content node after the Settings route owns it.
  await page.waitForTimeout(450);
  await expect(page.locator("h1.page-title")).toHaveText("Settings");
  await expect(page.locator(".recordings-table")).toHaveCount(0);
});

test("Home paints while health, Patreon, and schedule are still loading", async ({ page }) => {
  let releaseAncillary!: () => void;
  const ancillaryHeld = new Promise<void>((resolve) => { releaseAncillary = resolve; });
  for (const path of ["**/api/v1/patreon", "**/api/v1/schedule", "**/api/v1/health"]) {
    await page.route(path, async (route) => {
      await ancillaryHeld;
      await route.continue();
    });
  }

  await page.goto("/app#/library");
  // Channels and recordings are the dashboard core.  Ancillary calls remain
  // held, so this proves the visible destination has no dependency waterfall.
  await expect(page.locator("h1.page-title")).toHaveText("Home");
  await expect(page.locator("#route-status")).toBeHidden();

  releaseAncillary();
});

test("navigation keeps the chrome node and direct recordings entry hydrates its rail", async ({ page }) => {
  await page.goto("/app#/recordings");
  await expect(page.locator(".recordings-table")).toBeVisible();
  await expect(page.locator("#channel-list")).toContainText("Live Channel");
  const shell = await page.locator(".chrome").elementHandle();

  await page.locator('a[href="#/settings"]').click();
  await expect(page.locator("h1.page-title")).toHaveText("Settings");
  expect(await page.evaluate((node) => document.querySelector(".chrome") === node, shell)).toBe(true);
});
