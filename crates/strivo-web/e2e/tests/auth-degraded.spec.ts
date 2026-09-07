import { test, expect } from "@playwright/test";

// Tier 1 "detect and tell" for platform auth failures: the header pill and
// the System page both read the same /health/checks Platform Auth domain,
// which now distinguishes a rejected OAuth refresh from a rejected cookie
// session instead of a single "configured but not authenticated" warning.
//
// The mock backend opts into the degraded scenario via an
// x-e2e-scenario: auth-revoked request header (mock-server.mjs) rather
// than a bespoke endpoint, so every other health-checks test keeps using
// the default "ok" response untouched.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
  await page.setExtraHTTPHeaders({ "x-e2e-scenario": "auth-revoked" });
});

test("degraded platform auth surfaces in the header pill and the System page", async ({ page }) => {
  await page.goto("/app#/library");

  const pill = page.locator("#health-pill");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("2 issues");
  await expect(pill).toHaveClass(/error/);

  await pill.click();
  await expect(page).toHaveURL(/#\/system$/);

  const oauthRow = page.locator(".sys-check.error", { hasText: "YouTube: credentials rejected" });
  await expect(oauthRow).toBeVisible();
  await expect(oauthRow).toContainText("Re-authenticate from Settings → Platforms");
  await expect(oauthRow.locator(".sys-reauth")).toBeVisible();
  await expect(oauthRow.locator(".sys-reauth")).toHaveAttribute("href", "#/settings/platforms");

  const cookieRow = page.locator(".sys-check.error", { hasText: "YouTube cookie session rejected" });
  await expect(cookieRow).toBeVisible();
  await expect(cookieRow).toContainText("strivo setup cookies youtube --browser <browser>");
});
