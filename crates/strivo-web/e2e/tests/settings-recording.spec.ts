import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
});

test("Recording settings persist restart-required directory and advanced format values across reload", async ({ page }) => {
  await page.goto("/app#/settings/recording");

  const directory = page.locator('[data-stg-path="recording_dir"]');
  const saveDirectory = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    return (await response.request().postDataJSON()).path === "recording_dir";
  });
  await directory.fill("/tmp/strivo-e2e-recordings");
  await directory.press("Tab");
  const directoryResponse = await saveDirectory;
  expect(directoryResponse.status()).toBe(202);
  expect(await directoryResponse.json()).toEqual({ ok: true, path: "recording_dir", restart_required: true });

  const selector = page.locator('[data-stg-path="recording.format.format"]');
  const saveSelector = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording.format.format" && body.value === "bestvideo[height<=720]+bestaudio";
  });
  await selector.fill("bestvideo[height<=720]+bestaudio");
  await selector.press("Tab");
  expect((await saveSelector).status()).toBe(202);

  const bitrate = page.locator('[data-stg-path="recording.format.bitrate_kbps"]');
  const saveBitrate = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording.format.bitrate_kbps" && body.value === 4500;
  });
  await bitrate.fill("4500");
  await bitrate.press("Tab");
  expect((await saveBitrate).status()).toBe(202);

  const videoCodec = page.locator('[data-stg-path="recording.format.video_codec"]');
  const saveVideoCodec = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording.format.video_codec" && body.value === "libx264";
  });
  await videoCodec.fill("libx264");
  await videoCodec.press("Tab");
  expect((await saveVideoCodec).status()).toBe(202);

  const audioCodec = page.locator('[data-stg-path="recording.format.audio_codec"]');
  const saveAudioCodec = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording.format.audio_codec" && body.value === "aac";
  });
  await audioCodec.fill("aac");
  await audioCodec.press("Tab");
  expect((await saveAudioCodec).status()).toBe(202);

  await page.reload();
  await expect(directory).toHaveValue("/tmp/strivo-e2e-recordings");
  await expect(selector).toHaveValue("bestvideo[height<=720]+bestaudio");
  await expect(bitrate).toHaveValue("4500");
  await expect(videoCodec).toHaveValue("libx264");
  await expect(audioCodec).toHaveValue("aac");
  await expect(page.locator(".stg-effect-note")).toContainText("Existing recordings are not moved");
  await expect(page.locator(".stg-effect-note a")).toHaveText("Restart the daemon");
});

test("Recording settings expose backend validation, roll back rejected values, and allow optional resets", async ({ page }) => {
  await page.goto("/app#/settings/recording");

  const directory = page.locator('[data-stg-path="recording_dir"]');
  const savedDirectory = (await directory.inputValue()) === "/tmp/strivo-e2e-recordings"
    ? "/mnt/sda2/strivo"
    : "/tmp/strivo-e2e-recordings";
  const seedDirectory = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording_dir" && body.value === savedDirectory;
  });
  await directory.fill(savedDirectory);
  await directory.press("Tab");
  expect((await seedDirectory).status()).toBe(202);
  const rejectedDirectory = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording_dir" && body.value === "relative-directory";
  });
  await directory.fill("relative-directory");
  await directory.press("Tab");
  expect((await rejectedDirectory).status()).toBe(400);
  await expect(directory).toHaveValue(savedDirectory);
  await expect(directory).toHaveAttribute("aria-invalid", "true");
  await expect(directory.locator("xpath=..").locator(".stg-field-error")).toContainText("absolute path");

  // Browser validation must not presume the daemon host OS: this reaches the
  // API as a Windows-shaped path, then the daemon host rejects it on Linux.
  const windowsDirectory = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording_dir" && body.value === "C:\\strivo-e2e-recordings";
  });
  await directory.fill("C:\\strivo-e2e-recordings");
  await directory.press("Tab");
  expect((await windowsDirectory).status()).toBe(400);
  await expect(directory).toHaveValue(savedDirectory);

  const selector = page.locator('[data-stg-path="recording.format.format"]');
  const resetSelector = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording.format.format" && body.value === null;
  });
  await page.locator('[data-stg-reset="recording.format.format"]').click();
  expect((await resetSelector).status()).toBe(202);
  await expect(selector).toHaveValue("");

  const videoCodec = page.locator('[data-stg-path="recording.format.video_codec"]');
  const resetVideoCodec = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording.format.video_codec" && body.value === null;
  });
  await page.locator('[data-stg-reset="recording.format.video_codec"]').click();
  expect((await resetVideoCodec).status()).toBe(202);
  await expect(videoCodec).toHaveValue("");

  const audioCodec = page.locator('[data-stg-path="recording.format.audio_codec"]');
  const resetAudioCodec = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording.format.audio_codec" && body.value === null;
  });
  await page.locator('[data-stg-reset="recording.format.audio_codec"]').click();
  expect((await resetAudioCodec).status()).toBe(202);
  await expect(audioCodec).toHaveValue("");

  const bitrate = page.locator('[data-stg-path="recording.format.bitrate_kbps"]');
  const clearBitrate = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/settings/update") || response.request().method() !== "POST") return false;
    const body = await response.request().postDataJSON();
    return body.path === "recording.format.bitrate_kbps" && body.value === null;
  });
  await bitrate.fill("");
  await bitrate.press("Tab");
  expect((await clearBitrate).status()).toBe(202);
  await page.reload();
  await expect(page.locator('[data-stg-path="recording.format.format"]')).toHaveValue("");
  await expect(page.locator('[data-stg-path="recording.format.bitrate_kbps"]')).toHaveValue("");

  let fractionalRequest = false;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/settings/update") && request.postData()?.includes("12.5")) fractionalRequest = true;
  });
  const freshBitrate = page.locator('[data-stg-path="recording.format.bitrate_kbps"]');
  await freshBitrate.fill("12.5");
  await freshBitrate.press("Tab");
  await expect(freshBitrate).toHaveAttribute("aria-invalid", "true");
  expect(fractionalRequest).toBe(false);
});
