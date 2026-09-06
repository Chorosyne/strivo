import { test, expect } from "@playwright/test";

// Coverage for the 2026-09-06 SPA UX remediation pass (R01/R02/R03/R04).
// Each test exercises the real browser surface (keyboard focus, real
// network round trips) rather than grepping for markup.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("strivo-tour-done", "1"));
});

// R01 — recordings library pagination. The mock backend seeds 502 total
// recordings (3 named + 499 filler), so the default 500-row page always
// leaves 2 rows unreached until "Load more recordings" is used.
test("R01: recordings Load more reaches a second page beyond the first 500", async ({ page }) => {
  await page.goto("/app#/recordings");
  await expect(page.locator(".recordings-table")).toBeVisible();

  const count = page.locator("#rec-count");
  await expect(count).toContainText("500 total");

  const loadMore = page.locator("#rec-load-more");
  await expect(loadMore).toBeVisible();
  await expect(loadMore).toHaveText("Load more recordings");

  await loadMore.click();

  // The 2 remaining rows are now in the client cache, and the button
  // retires because the server reports no further cursor.
  await expect(count).toContainText("502 total");
  await expect(loadMore).toHaveCount(0);
});

// R04 — sortable recordings headers are keyboard-operable, not just
// clickable. Verifies both Enter and Space actually re-sort the table.
test("R04: focusing a sortable header and pressing Enter/Space re-sorts the table", async ({ page }) => {
  await page.goto("/app#/recordings");
  await expect(page.locator(".recordings-table")).toBeVisible();

  const firstRowChannel = () =>
    page.locator("tbody#rec-body tr[data-rec-row]").first().locator("td").nth(2);

  // Default sort is "started desc" — the most recently started fixture
  // (Bravo, 2026-05-26) leads.
  await expect(firstRowChannel()).toHaveText("Bravo");

  const channelHeader = () => page.locator('th[data-sort="channel"]');
  await expect(channelHeader()).toHaveAttribute("tabindex", "0");
  await expect(channelHeader()).toHaveAttribute("role", "button");

  await channelHeader().focus();
  await expect(channelHeader()).toBeFocused();
  await page.keyboard.press("Enter");
  // Ascending by channel name: Alpha sorts first.
  await expect(firstRowChannel()).toHaveText("Alpha");

  // Header re-renders on each sort; re-locate and press Space this time.
  const header2 = channelHeader();
  await header2.focus();
  await expect(header2).toBeFocused();
  await page.keyboard.press(" ");
  // Toggled back to descending: the filler channel (alphabetically last)
  // now leads, so the row is no longer Alpha.
  await expect(firstRowChannel()).not.toHaveText("Alpha");
});
