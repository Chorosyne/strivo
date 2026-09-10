import { test, expect } from "@playwright/test";

// Exercise the real PVR source bundle in Chromium. The controller starts
// paused with preload=none, which is the exact state a recording poster sits
// in while the user browses the wall.
test("an idle recording controller does not report corruption", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem("strivo-tour-done", "1");
    localStorage.setItem("strivo:e2e", "1");
  });
  await page.goto("/app#/library");
  await page.evaluate(() => {
    const hook = (window as any).__strivoTestHooks;
    const host = document.createElement("div");
    host.id = "idle-recording-test";
    document.body.appendChild(host);
    const controller = hook.makeRecordingController({
      src: "/api/v1/recordings/00000000-0000-0000-0000-000000000001/download",
      playing: false,
      muted: true,
    });
    controller.mount(host);
    (window as any).__idleRecordingController = controller;
  });
  await page.clock.fastForward(15_500);
  await expect(page.locator("#idle-recording-test .ms-media-error")).toHaveCount(0);
});

test("successful metadata clears a recoverable recording error", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("strivo-tour-done", "1");
    localStorage.setItem("strivo:e2e", "1");
  });
  await page.goto("/app#/library");
  await page.evaluate(() => {
    const hook = (window as any).__strivoTestHooks;
    const host = document.createElement("div");
    host.id = "recovery-recording-test";
    document.body.appendChild(host);
    const controller = hook.makeRecordingController({ playing: false, muted: true });
    controller.mount(host);
    const video = host.querySelector("video")!;
    Object.defineProperty(video, "error", { configurable: true, get: () => ({ code: 3 }) });
    video.dispatchEvent(new Event("error"));
  });
  await expect(page.locator("#recovery-recording-test .ms-media-error")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector("#recovery-recording-test video")!.dispatchEvent(new Event("loadedmetadata"));
  });
  await expect(page.locator("#recovery-recording-test .ms-media-error")).toHaveCount(0);
});
