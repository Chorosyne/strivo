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
