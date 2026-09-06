import { test, expect } from "@playwright/test";

// S10 — the PVR (non-creator) build must never dispatch into Creator UI
// whose backing definitions build.rs strips out of the shipped bundle.
//
// IMPORTANT SCOPE NOTE: this suite runs against the mock server, which
// serves `assets/` directly — the *source* spa.js, not the stripped
// artifact `cargo build -p strivo-web` (no --features creator) actually
// emits. These tests therefore verify the SOURCE's runtime edition gate
// (CREATOR_ROUTES / CREATOR_ENABLED in render()) behaves correctly when a
// PVR-shaped `/api/v1/settings` response is seen — they do NOT exercise
// the stripped bundle, so they cannot by themselves prove S10 is fixed.
// The complementary proof that the *stripped* bundle has no dangling call
// sites lives in `check-pvr-bundle.mjs` (wired as this package's `pretest`
// script), which builds the real PVR artifact and inspects it directly.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
  // Simulate a PVR daemon's /api/v1/settings response (creator_enabled:
  // false) without touching the shared mock-server.mjs default, which
  // other specs rely on staying Creator-enabled.
  await page.route("**/api/v1/settings", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, creator_enabled: false } });
  });
});

const creatorRoutes = ["studio", "analytics", "publish", "pipelines", "plugins", "dataviz", "archive"];

for (const route of creatorRoutes) {
  test(`PVR edition: #/${route} bounces to Home with no uncaught error`, async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto(`/app#/${route}`);
    // render() redirects Creator-only routes to #/library once
    // CREATOR_ENABLED resolves to false — wait for that redirect rather
    // than a fixed timeout.
    await expect(page).toHaveURL(/#\/library/);
    await expect(page.locator("#channel-list")).toBeVisible();

    expect(pageErrors, `uncaught error navigating to #/${route} in PVR mode`).toEqual([]);
  });
}

test("PVR edition: top nav hides every Creator-only route", async ({ page }) => {
  await page.goto("/app#/library");
  await expect(page.locator("#channel-list")).toBeVisible();
  for (const route of creatorRoutes) {
    await expect(page.locator(`.topnav-link[data-route="${route}"]`)).toHaveCount(0);
  }
  // Free routes stay.
  await expect(page.locator('.topnav-link[data-route="recordings"]')).toBeVisible();
  await expect(page.locator('.topnav-link[data-route="chat"]')).toBeVisible();
});

test("PVR edition: recording Info modal shows no Plugin actions section", async ({ page }) => {
  await page.goto("/app#/recordings");
  const row = page.locator("tr[data-rec-row]", { hasText: "Zebra stream" });
  await row.locator("[data-action=rec-info]").click();
  const modal = page.locator("#rec-info-modal");
  await expect(modal).toBeVisible();
  // The Plugin actions section is CREATOR_ENABLED-only (see spa.js
  // creatorActionsHtml); in PVR mode it must not render at all, and there
  // must be nothing to wire pluginRpc calls to.
  await expect(modal.locator(".rec-info-actions")).toHaveCount(0);
});
