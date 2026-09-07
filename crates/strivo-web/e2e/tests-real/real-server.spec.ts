import { test, expect } from "@playwright/test";

// S04 — drives the REAL compiled strivo-web server (see real-server.sh +
// playwright.real.config.ts), not the Node mock in ../tests. There is no
// live daemon behind it beyond the one this lane boots for itself, and no
// seeded channels/recordings, so assertions are about auth + navigation
// actually working over a real HTTP socket, not fixture content.
const API_KEY = "strivo-e2e-real-server-test-key";

test("an unauthenticated request is rejected by the real server", async ({ request }) => {
  const res = await request.get("/api/v1/recordings", {
    headers: { "x-api-key": "definitely-not-the-key" },
  });
  expect(res.status()).toBe(401);
});

test("health is reachable with no credential at all", async ({ request }) => {
  const res = await request.get("/api/v1/health");
  expect(res.status()).not.toBe(401);
});

test("login then recordings list round-trips through the real daemon", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
  await page.goto("/app#/login");
  await expect(page.locator("#login-form")).toBeVisible();
  await page.locator("#api-key").fill(API_KEY);
  await page.locator("#login-form button[type=submit]").click();

  // Successful login leaves the login screen for the app chrome.
  await expect(page.locator("#channel-list")).toBeVisible();

  // Navigate to Recordings — a fresh daemon has no recordings, so the
  // page renders its empty state rather than `.recordings-table` (that
  // only mounts once there's a row to show). The empty state itself is
  // still real GET /api/v1/recordings output (cookie auth -> daemon IPC
  // -> JSON -> SPA render), which is what this test is proving.
  await page.locator('.topnav-link[data-route="recordings"]').click();
  await expect(page).toHaveURL(/#\/recordings/);
  await expect(page.getByRole("heading", { name: "Recordings" })).toBeVisible();
  await expect(page.getByText("No recordings yet")).toBeVisible();
});

// CE03 — this lane runs against the REAL `cargo build -p strivo-web`
// artifact (no --features creator, via real-server.sh), unlike
// tests/pvr-edition-gating.spec.ts which exercises the source SPA through
// the mock server. This is the decisive check that S10's defect (a PVR
// bundle dispatching into Creator UI whose definitions the build never
// shipped) stays fixed against the actual emitted bundle, not just the
// runtime gate logic over unstripped source.
test("PVR build: #/studio bounces to Home with no uncaught error", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.goto("/app#/login");
  await page.locator("#api-key").fill(API_KEY);
  await page.locator("#login-form button[type=submit]").click();
  await expect(page.locator("#channel-list")).toBeVisible();

  await page.goto("/app#/studio");
  await expect(page).toHaveURL(/#\/library/);
  await expect(page.locator("#channel-list")).toBeVisible();

  expect(pageErrors, "uncaught error navigating to #/studio against the real PVR build").toEqual([]);
});
