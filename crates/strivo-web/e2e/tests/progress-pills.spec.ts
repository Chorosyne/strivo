import { test, expect } from "@playwright/test";

// Regression coverage for progress pills stuck at 0%: download_pct /
// download_eta_secs / download_rate_bps / bytes_written arrive ONLY via
// SSE RecordingProgress ticks, patched in place onto the in-memory
// recCache array (036-pvr.js). Several surfaces never saw those ticks:
// the Recordings Timeline (built from a separate REST /history
// snapshot) and the Recording Info modal (a point-in-time
// API.recordingOne() fetch with no SSE subscription of its own).
//
// mock-server.mjs has no built-in RecordingProgress simulation and is
// out of this lane's ownership, so this spec drives its own network
// mocks via page.route — entirely self-contained, no shared-server
// changes required.

const JOB_ID = "44444444-4444-4444-4444-444444444444";

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    channel_name: "Delta",
    stream_title: "Progress test",
    state: "Recording",
    source_url: "https://twitch.tv/videos/999",
    started_at: new Date().toISOString(),
    bytes_written: 0,
    download_pct: null,
    ...overrides,
  };
}

// SSE frame in the exact shape events.source.onmessage expects
// (JSON.parse(e.data)), matching mock-server.mjs's own `broadcast()`
// framing (`data: <json>\n\n`).
function sseFrame(eventObj: unknown) {
  return `data: ${JSON.stringify(eventObj)}\n\n`;
}

async function installProgressJob(
  page: import("@playwright/test").Page,
  { ticks }: { ticks: Record<string, unknown>[] },
) {
  // Full recordings list: add the in-progress job alongside the mock's
  // three fixtures.
  await page.route("**/api/v1/recordings*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.recordings = [...body.recordings, jobFixture()];
    if (typeof body.total === "number") body.total += 1;
    await route.fulfill({ response, json: body });
  });

  // Single-job fetch, used by the Recording Info modal.
  await page.route(`**/api/v1/recordings/${JOB_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        jobFixture({
          channel_id: "twitch:delta",
          platform: "Twitch",
          transcode: false,
          duration_secs: 0,
          output_path: `/mnt/sda2/strivo/Delta/${JOB_ID}.mkv`,
          error: null,
        }),
      ),
    });
  });

  // History snapshot: add a matching row so the Timeline view shows it.
  await page.route("**/api/v1/history*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.history = [
      ...body.history,
      {
        id: JOB_ID,
        channel_name: "Delta",
        stream_title: "Progress test",
        platform: "Twitch",
        state: "Recording",
        source_url: "https://twitch.tv/videos/999",
        started_at: jobFixture().started_at,
        bytes_written: 0,
      },
    ];
    await route.fulfill({ response, json: body });
  });

  // Replace the SSE stream outright with one or more canned
  // RecordingProgress ticks, delivered immediately on connect. This
  // spec doesn't depend on any other live event.
  await page.route("**/events", async (route) => {
    const body = ticks
      .map((t) =>
        sseFrame({
          RecordingProgress: {
            job_id: JOB_ID,
            bytes_written: 0,
            duration_secs: 0,
            ...t,
          },
        }),
      )
      .join("");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
});

test("Timeline row's percent updates from a live SSE tick, never stuck", async ({ page }) => {
  await installProgressJob(page, {
    ticks: [{ bytes_written: 5_000_000, duration_secs: 10, download_pct: 37, download_eta_secs: 120, download_rate_bps: 500_000 }],
  });
  await page.goto("/app#/recordings?view=timeline");
  await expect(page.getByRole("heading", { name: "Recordings" })).toBeVisible();

  const pill = page.locator(`.hist-pill[data-job-id="${JOB_ID}"]`);
  await expect(pill).toBeVisible();
  await expect(pill.locator(".state-pill-label")).toHaveText("37%");
});

test("Recording Info modal shows a live percent while open and updates on a later tick", async ({ page }) => {
  await installProgressJob(page, {
    ticks: [
      { bytes_written: 3_000_000, duration_secs: 6, download_pct: 25, download_eta_secs: 200, download_rate_bps: 400_000 },
      { bytes_written: 8_000_000, duration_secs: 16, download_pct: 62, download_eta_secs: 90, download_rate_bps: 550_000 },
    ],
  });
  await page.goto("/app#/recordings?view=timeline");
  const pill = page.locator(`.hist-pill[data-job-id="${JOB_ID}"]`);
  await expect(pill).toBeVisible();

  await pill.locator("[data-action=rec-info]").click();
  const modal = page.locator("#rec-info-modal");
  await expect(modal).toBeVisible();
  // Both mocked ticks are delivered on connect (Playwright serves the
  // whole SSE body at once); the modal's live-patch handler
  // (updateRecInfoModalProgress, 028-pvr.js) applies each as it's
  // parsed, so the DOM settles on the last one.
  await expect(modal.locator(".rec-info-head .state-pill-label")).toHaveText("62%");
});

test("vod-dl-label never shows a literal 0% when download_pct is null", async ({ page }) => {
  await page.goto("/app#/library");
  await page.locator(".ch-row", { hasText: "Live Channel" }).click();
  await expect(page.getByText("Yesterday's livestream")).toBeVisible();
  const dlBtn = page
    .locator(".media-pill", { hasText: "Yesterday's livestream" })
    .locator(".vod-dl");
  await dlBtn.click();
  await expect(dlBtn).toHaveClass(/vod-dl-downloading/);
  const label = dlBtn.locator(".vod-dl-label");
  await expect(label).toBeVisible();
  // download_pct is null for this job (no SSE tick ever arrives in this
  // flow) — the label must never render the literal string "0%".
  await expect(label).not.toHaveText("0%");
  await expect(label).not.toContainText("0%");
});
