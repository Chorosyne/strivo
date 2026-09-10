import { test, expect } from "@playwright/test";

// Exercise the source PVR modules and expose the internal SSE dispatcher in
// this focused lane. The release bundle has the same ordered modules; the
// hook is test-only and never changes an application response outside this
// route interception.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
  await page.route("**/assets/spa.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: `${body}\nwindow.__performanceContinuity = { events, API };`,
      contentType: "application/javascript",
    });
  });
});

test("recording progress keeps an open row menu and its focused control", async ({ page }) => {
  await page.goto("/app#/recordings");
  const row = page.locator("tr[data-rec-row]").first();
  const menu = row.locator("[data-action=rec-menu-toggle]");
  await menu.focus();
  await menu.click();
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const id = await row.getAttribute("data-rec-row");

  await page.evaluate((jobId) => {
    for (const listener of (window as any).__performanceContinuity.events.listeners) {
      listener({ RecordingProgress: { job_id: jobId, bytes_written: 123456, duration_secs: 42 } });
    }
  }, id);

  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(row.locator("td").nth(5)).toContainText("123 KB");
});

test("lifecycle reconciliation retains records loaded from the next page", async ({ page }) => {
  await page.goto("/app#/recordings");
  await page.locator("#rec-load-more").click();
  await expect(page.locator("#rec-count")).toContainText("502 recordings");
  await page.route("**/api/v1/recordings?limit=500", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.recordings.unshift({
      id: "lifecycle-new-recording", state: "Finished", channel_name: "Lifecycle",
      stream_title: "newly completed", started_at: new Date().toISOString(), bytes_written: 1,
    });
    await route.fulfill({ json: body });
  });

  const refreshed = page.waitForResponse((response) =>
    response.url().includes("/api/v1/recordings?limit=500") && response.status() === 200,
  );
  await page.evaluate(() => {
    for (const listener of (window as any).__performanceContinuity.events.listeners) {
      listener({ RecordingFinished: { job_id: "audit-finished" } });
    }
  });
  await refreshed;

  await expect(page.locator("#rec-count")).toContainText("503 recordings");
});

test("a lifecycle invalidation prevents an older recording read from refilling cache", async ({ page }) => {
  await page.goto("/app#/recordings");
  let calls = 0;
  await page.route("**/api/v1/recordings?limit=500", async (route) => {
    const call = ++calls;
    if (call === 1) await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ json: {
      recordings: [{ id: call === 1 ? "stale" : "fresh", state: "Finished", channel_name: "Alpha" }],
      next_cursor: null,
    } });
  });

  const cachedId = await page.evaluate(async () => {
    const api = (window as any).__performanceContinuity.API;
    api.invalidate("/recordings");
    const stale = api.recordings();
    api.invalidate("/recordings");
    const fresh = api.recordings();
    await Promise.all([stale, fresh]);
    return api._cache.get("/recordings?limit=500")?.value.recordings[0]?.id;
  });
  expect(cachedId).toBe("fresh");
});

test("progress ticks do not retire a pending recording read", async ({ page }) => {
  await page.goto("/app#/recordings");
  await expect(page.locator("#rec-count")).toContainText("500 recordings");
  const id = await page.locator("tr[data-rec-row]").first().getAttribute("data-rec-row");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const requestStarted = new Promise<void>((resolve) => { entered = resolve; });
  let calls = 0;
  await page.route("**/api/v1/recordings?limit=500", async (route) => {
    calls++;
    entered();
    await held;
    await route.continue();
  });
  await page.evaluate(() => {
    const api = (window as any).__performanceContinuity.API;
    api.invalidate("/recordings");
    (window as any).__pendingProgressRead = api.recordings();
  });
  await requestStarted;
  await page.evaluate((jobId) => {
    const events = (window as any).__performanceContinuity.events;
    for (let i = 0; i < 20; i++) {
      events.listeners.forEach((listener: any) => listener({
        RecordingProgress: { job_id: jobId, bytes_written: 1000 + i, duration_secs: i },
      }));
    }
  }, id);
  release();
  await page.evaluate(() => (window as any).__pendingProgressRead);
  expect(calls).toBe(1);
});

for (const grouped of [false, true]) {
test(`${grouped ? "grouped" : "ungrouped"} lifecycle replacement keeps exactly one row per ID and one menu handler`, async ({ page }) => {
  await page.goto("/app#/recordings");
  if (grouped) await page.locator("#rec-groupby").click();
  const protectedRow = page.locator("tr[data-rec-row]").nth(1);
  const protectedId = await protectedRow.getAttribute("data-rec-row");
  const menu = protectedRow.locator("[data-action=rec-menu-toggle]");
  await menu.focus();
  await menu.click();
  let changedId = "";
  let changedClass = "";
  await page.route("**/api/v1/recordings?limit=500", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const changed = body.recordings.find((record: any) => record.id !== protectedId);
    changedId = changed.id;
    changed.state = changed.state === "Recording" ? "Finished" : "Recording";
    changedClass = changed.state.toLowerCase();
    await route.fulfill({ json: body });
  });
  const refreshed = page.waitForResponse((response) =>
    response.url().includes("/api/v1/recordings?limit=500") && response.status() === 200,
  );
  await page.evaluate(() => {
    for (const listener of (window as any).__performanceContinuity.events.listeners) {
      listener({ RecordingFinished: { job_id: "audit-finished" } });
    }
  });
  await refreshed;
  await expect(page.locator(`tr[data-rec-row="${changedId}"]`)).toHaveCount(1);
  await expect(page.locator(`tr[data-rec-row="${changedId}"]`)).toHaveAttribute("data-rec-state", changedClass);
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
});
}
