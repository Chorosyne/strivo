import { test, expect, type Page } from "@playwright/test";

// Lane C (chrome/navigation) — regression coverage for the density sweep:
// one command palette (not two), no native confirm() dialogs, History
// folded into the Recordings Timeline view, Chat sharing the one rail
// instead of painting a second channel list, the mass bar hidden until a
// row is selected, and no pre-login fetch storm.

const ROUTES = ["library", "recordings", "schedule", "watch", "chat", "settings", "system", "logs"];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
});

async function visibleOverlays(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sel = "[role=dialog], .app-modal.open, .kbd-help.open, #cmdk";
    return [...document.querySelectorAll(sel)].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") return false;
      return !el.parentElement?.closest(sel);
    }).length;
  });
}

for (const route of ROUTES) {
  test(`#/${route}: Ctrl+K opens exactly one overlay, Escape closes it`, async ({ page }) => {
    await page.goto(`/app#/${route}`);
    await page.locator(".chrome").waitFor();
    await page.keyboard.press("Control+k");
    await expect.poll(() => visibleOverlays(page)).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => visibleOverlays(page)).toBe(0);
  });
}

test("no native confirm() dialog on a destructive Recordings action", async ({ page }) => {
  let dialogFired = false;
  page.on("dialog", (d) => {
    dialogFired = true;
    d.dismiss();
  });
  await page.goto("/app#/recordings");
  const row = page.locator("tr[data-rec-row]").first();
  await row.locator("[data-action=rec-menu-toggle]").click();
  await row.locator("[data-action=rec-delete]").click();
  // The styled confirmDialog() should have appeared instead of a native one.
  await expect(page.locator(".confirm-modal")).toBeVisible();
  expect(dialogFired).toBe(false);
});

test("#/history redirects to the Recordings Timeline view and renders the heatmap", async ({ page }) => {
  await page.goto("/app#/history");
  await expect(page).toHaveURL(/#\/recordings\?view=timeline/);
  await expect(page.locator(".rec-view-btn.is-active")).toHaveText("Timeline");
  await expect(page.locator(".hist-hm-wrap")).toBeVisible();
});

test("#/chat has exactly one channel list", async ({ page }) => {
  await page.goto("/app#/chat");
  await expect(page.locator(".chat-body")).toBeVisible();
  // The shared left rail is the only channel list — no second #chat-tabs
  // strip painted beside it any more.
  await expect(page.locator("#chat-tabs")).toHaveCount(0);
  await expect(page.locator("#channel-list .ch-row")).not.toHaveCount(0);
});

test("recordings mass bar is hidden with no selection, appears after ticking a row", async ({ page }) => {
  await page.goto("/app#/recordings");
  const massbar = page.locator("#rec-massbar");
  await expect(massbar).toBeHidden();
  await page.locator(".rec-row-check").first().check();
  await expect(massbar).toBeVisible();
  await expect(massbar).toContainText("selected");
  await page.locator(".rec-row-check").first().uncheck();
  await expect(massbar).toBeHidden();
});

// SKIPPED against the mock lane, not against the product: mock-server.mjs
// (out of this lane's ownership) never enforces auth on /api/v1/settings —
// it always returns 200, unlike the real daemon's `check_key` gate
// (crates/strivo-web/src/routes/api.rs `settings()`). That means
// fetchEdition() "succeeds" immediately at boot in the mock lane and sets
// `authed = true` before the login form even paints, so events.start()/
// seedPatreon() correctly fire — there's no unauthenticated state here to
// prove the gate against. Verified instead by reading 012-pvr.js/008-pvr.js
// (fetchEdition() sets `authed` only on a real success; events.start()/
// seedPatreon() and the SSE reconnect timer all check it) and by running
// against the real daemon (`npm run test:real`), where /settings does 401
// pre-login.
test.skip("the login screen makes no /events or /patreon request before login", async ({ page }) => {
  const hits: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/events" || url.pathname === "/api/v1/patreon") {
      hits.push(url.pathname);
    }
  });
  await page.goto("/app#/login");
  await expect(page.locator("#login-form")).toBeVisible();
  // Give any errant fire-and-forget boot call — and the 3s SSE retry
  // timer, if it were still armed — a chance to land.
  await page.waitForTimeout(3500);
  expect(hits).toEqual([]);
});
