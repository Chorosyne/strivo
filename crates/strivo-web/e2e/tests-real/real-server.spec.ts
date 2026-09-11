import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// S04 — drives the REAL compiled strivo-web server (see real-server.sh +
// playwright.real.config.ts), not the Node mock in ../tests. There is no
// live daemon behind it beyond the one this lane boots for itself, and no
// seeded channels/recordings, so assertions are about auth + navigation
// actually working over a real HTTP socket, not fixture content.
const API_KEY = "strivo-e2e-real-server-test-key";

test("recording settings persist and reset through the real PVR server", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "strivo-settings-real-"));
  try {
    await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
    await page.goto("/app#/login");
    await page.locator("#api-key").fill(API_KEY);
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator("#channel-list")).toBeVisible();
    await page.goto("/app#/settings/recording");

    const changes = [
      ["recording_dir", directory],
      ["recording.format.format", "bestvideo[height<=720]+bestaudio/best"],
      ["recording.format.bitrate_kbps", "4500"],
      ["recording.format.video_codec", "libx264"],
      ["recording.format.audio_codec", "aac"],
    ];
    for (const [path, value] of changes) {
      const saved = page.waitForResponse(response =>
        response.url().endsWith("/api/v1/settings/update") &&
        response.request().postDataJSON()?.path === path);
      const field = page.locator(`[data-stg-path="${path}"]`);
      await field.fill(value);
      await field.press("Tab");
      const response = await saved;
      expect(response.status(), path).toBe(202);
      expect((await response.json()).restart_required, path).toBe(true);
      await expect(field).toBeEnabled();
    }
    await page.reload();
    for (const [path, value] of changes) {
      await expect(page.locator(`[data-stg-path="${path}"]`)).toHaveValue(value);
    }
    await expect(page.locator(".stg-effect-note")).toContainText("Restart the daemon");

    for (const [path] of changes.slice(1)) {
      const saved = page.waitForResponse(response =>
        response.url().endsWith("/api/v1/settings/update") &&
        response.request().postDataJSON()?.path === path);
      await page.locator(`[data-stg-reset="${path}"]`).click();
      expect((await saved).status(), path).toBe(202);
      await expect(page.locator(`[data-stg-path="${path}"]`)).toBeEnabled();
    }
    await page.reload();
    for (const [path] of changes.slice(1)) {
      await expect(page.locator(`[data-stg-path="${path}"]`)).toHaveValue("");
    }
  } finally {
    // This directory belongs only to this test; no capture is started.
    await rm(directory, { recursive: true, force: true });
  }
});

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

// The settings endpoint deliberately reports creator_enabled: false while
// Creator Edition remains unreleased, so a route bounce alone cannot tell us
// which binary this lane started. Inspect the bundle the real HTTP server
// actually serves instead. `renderProApp` is defined solely in
// assets/spa/021-creator.js and the PVR build never includes that module;
// identifier names are retained by both debug and release asset generation.
// Pointing STRIVO_BIN at a Creator binary makes this assertion fail, which
// keeps the lane from silently validating the wrong edition.
test("real server serves a PVR bundle with no Creator application entry point", async ({ request }) => {
  const res = await request.get("/assets/spa.js");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/javascript/);
  const bundle = await res.text();
  // A known PVR declaration confirms this is the actual SPA script, rather
  // than an empty response or an HTML fallback that happens to omit the
  // Creator entry point.
  expect(bundle).toContain("function chrome(");
  expect(bundle).not.toContain("renderProApp");
});

test("login then recordings list round-trips through the real daemon", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
  await page.goto("/app#/login");
  await expect(page.locator("#login-form")).toBeVisible();
  await page.locator("#api-key").fill(API_KEY);
  await page.locator("#login-form button[type=submit]").click();

  // Successful login leaves the login screen for the app chrome.
  await expect(page.locator("#channel-list")).toBeVisible();

  // Navigate to Recordings — real-server.sh seeds one Finished recording
  // (see its ffmpeg step) that scan_existing_recordings journals at daemon
  // startup, so the table renders that row rather than the empty state.
  // This is still real GET /api/v1/recordings output (cookie auth -> daemon
  // IPC/journal -> JSON -> SPA render), which is what this test is proving.
  await page.locator('.topnav-link[data-route="recordings"]').click();
  await expect(page).toHaveURL(/#\/recordings/);
  await expect(page.getByRole("heading", { name: "Recordings" })).toBeVisible();
  await expect(page.getByText("No recordings yet")).not.toBeVisible();
  await expect(page.locator(".recordings-table")).toBeVisible();
});

// B-04/B-08 — RAN, not TRACED: the mock lane's routes use synthetic
// responses, so a real Range request against real bytes on disk only ever
// ran in the audit's absence-of-coverage note. real-server.sh's ffmpeg
// step seeds exactly one Finished recording for this.
test("download serves a real finished recording with Range + cache validators", async ({ request }) => {
  const list = await request.get("/api/v1/recordings", {
    headers: { "x-api-key": API_KEY },
  });
  expect(list.status()).toBe(200);
  const { recordings } = await list.json();
  const seeded = recordings.find((r: { channel_name: string }) =>
    r.channel_name === "e2eseed");
  expect(seeded, `seeded recording not found in ${JSON.stringify(recordings)}`).toBeTruthy();
  expect(seeded.state).toBe("Finished");

  const full = await request.get(`/api/v1/recordings/${seeded.id}/download`, {
    headers: { "x-api-key": API_KEY },
  });
  expect(full.status()).toBe(200);
  expect(full.headers()["accept-ranges"]).toBe("bytes");
  expect(full.headers()["last-modified"]).toBeTruthy();
  expect(full.headers()["cache-control"]).toContain("private");

  const ranged = await request.get(`/api/v1/recordings/${seeded.id}/download`, {
    headers: { "x-api-key": API_KEY, range: "bytes=0-99" },
  });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-99\//);
  expect((await ranged.body()).length).toBe(100);
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
