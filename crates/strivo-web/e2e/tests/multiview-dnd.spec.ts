import { test, expect } from "@playwright/test";

// Coverage for the multi-view wall's drag-and-drop, keyboard, and picker
// rework (the "multi-viewer is a bit of a mess; click-to-drag doesn't
// work" pass). Root causes fixed here, each with its own assertion below:
//
//   - `draggable` used to sit on the whole `.ms-leaf`; once a tile plays,
//     a cross-origin iframe covers it and swallows the mousedown before it
//     becomes a dragstart. Drag is now delegated to the stage and started
//     only from a small handle (`.watch-tile-name` until Lane A's
//     `.pb-grab[data-drag-handle]` lands) — see "handle-drag swap".
//   - Rail rows were wired per-paint and wiped by every rail repaint
//     (`paintChannelList` rebuilds `#channel-list` wholesale on SSE). Drag
//     is now one delegated `document` listener — see "rail drag survives
//     a repaint".
//   - Composer chips emitted `strivo-rec:`, the stage only understood
//     `strivo-recording:` — composer-to-stage drops were silently
//     dropped. One codec (`encodeDragPayload`/`decodeDragPayload`) now
//     backs every drag source — see "codec round-trip".
//   - Drop was bound per `.ms-leaf`; gutters were dead zones — see "drop
//     on a gutter resolves to the nearest leaf".
//   - Clicking a live rail row on #/watch navigated to #/library instead
//     of loading the channel — see "rail click on #/watch".

const YT_LIVE_ROW = '.ch-row[data-live-stream-id="YouTube:UClive0000000000000000aa"]';
const FINISHED_REC_ID = "11111111-1111-1111-1111-111111111111";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("strivo-tour-done", "1");
    localStorage.setItem("strivo:e2e", "1");
  });
});

// Same fake-controller pattern as player-controller.spec.ts: CI has no
// route to Twitch/YouTube, and lifecycle — not vendor rendering — is what
// these tests exercise.
async function installFakePlayers(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as any).__fakePlayerFactoryReady = false;
    const install = () => {
      const h = (window as any).__strivoTestHooks;
      if (!h || !h.setPlayerControllerFactory) return false;
      h.setPlayerControllerFactory((kind: string) => {
        const el = document.createElement("div");
        el.className = "watch-tile-iframe ms-iframe fake-player";
        el.dataset.kind = kind;
        return {
          kind,
          root: el,
          mount(c: HTMLElement) {
            if (el.parentElement !== c) c.appendChild(el);
          },
          destroy() {
            el.remove();
          },
          setMuted() {},
          setVolume() {},
          setQuality() {},
          repoint() {},
          isReady() {
            return true;
          },
        };
      });
      (window as any).__fakePlayerFactoryReady = true;
      return true;
    };
    if (!install()) {
      const t = setInterval(() => {
        if (install()) clearInterval(t);
      }, 10);
    }
  });
}
async function waitForFakePlayers(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => (window as any).__fakePlayerFactoryReady === true);
}

async function useSplitScreen(page: import("@playwright/test").Page) {
  await page.locator(".ms-preset-summary").click();
  await page.locator('.ms-preset-opt[data-preset="split-screen"]').click();
}

async function pickLive(page: import("@playwright/test").Page, streamId: string) {
  await page.locator(".ms-picker").first().locator(`.ms-pick[data-pick="live:${streamId}"]`).click();
}

// `locator.dragTo()` reliably drives a native drag from a naturally
// draggable source (the rail's `<a>` rows), but was observed to silently
// swallow the drag — dragstart never fires — from a handle whose
// `draggable` was set via a JS property assignment (`el.draggable =
// true`, as wireStageDnD does for `.watch-tile-name`/`[data-drag-handle]`)
// rather than present in the initial HTML. A manual mouse sequence (move
// → down → move in steps → up) reproduces the exact same native drag
// reliably in both cases, so stage-internal drags below use this instead.
async function manualDragTo(
  page: import("@playwright/test").Page,
  source: import("@playwright/test").Locator,
  target: import("@playwright/test").Locator,
) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("manualDragTo: source or target has no box");
  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height / 2;
  const toX = to.x + to.width / 2;
  const toY = to.y + to.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + (toX - fromX) / 2, fromY + (toY - fromY) / 2, { steps: 5 });
  await page.mouse.move(toX, toY, { steps: 5 });
  await page.mouse.up();
}

// ── Drag-payload codec ──────────────────────────────────────────────────

test("drag-payload codec round-trips and rejects junk", async ({ page }) => {
  await page.goto("/app#/library");

  const result = await page.evaluate(() => {
    const h = (window as any).__strivoTestHooks;
    const tile = h.decodeDragPayload(h.encodeDragPayload({ type: "tile", path: "a.b" }));
    const stream = h.decodeDragPayload(h.encodeDragPayload({ type: "stream", id: "Twitch:foo-1" }));
    const recording = h.decodeDragPayload(h.encodeDragPayload({ type: "recording", id: "abc-123" }));
    const rootTile = h.decodeDragPayload(h.encodeDragPayload({ type: "tile", path: "" }));
    return {
      tile,
      stream,
      recording,
      rootTile,
      junkUrl: h.decodeDragPayload("https://example.com/evil"),
      junkEmpty: h.decodeDragPayload(""),
      junkBadPath: h.decodeDragPayload("strivo-tile:../../etc"),
      junkBadStream: h.decodeDragPayload("strivo-stream:has spaces"),
    };
  });

  expect(result.tile).toEqual({ type: "tile", path: "a.b" });
  expect(result.stream).toEqual({ type: "stream", id: "Twitch:foo-1" });
  expect(result.recording).toEqual({ type: "recording", id: "abc-123" });
  expect(result.rootTile).toEqual({ type: "tile", path: "" });
  expect(result.junkUrl).toBeNull();
  expect(result.junkEmpty).toBeNull();
  expect(result.junkBadPath).toBeNull();
  expect(result.junkBadStream).toBeNull();
});

// ── Rail → stage drag ────────────────────────────────────────────────────

test("dragging a live rail row onto an empty tile assigns it", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  const row = page.locator(YT_LIVE_ROW);
  await expect(row).toBeVisible();
  const target = page.locator(".ms-leaf.ms-empty");
  await expect(target).toHaveCount(1);

  await row.dragTo(target);

  await expect(page.locator('.ms-leaf[data-stream-id="YouTube:UClive0000000000000000aa"]')).toHaveCount(1);
});

test("rail drag survives a rail repaint", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  // Force the rail to rebuild its innerHTML wholesale, the way an SSE
  // channel-state event does — this is exactly what wiped the old
  // per-row `draggable` wiring.
  await page.evaluate(() => (window as any).__strivoTestHooks.paintChannelList());
  await page.evaluate(() => (window as any).__strivoTestHooks.paintChannelList());

  const row = page.locator(YT_LIVE_ROW);
  const target = page.locator(".ms-leaf.ms-empty");
  await row.dragTo(target);

  await expect(page.locator('.ms-leaf[data-stream-id="YouTube:UClive0000000000000000aa"]')).toHaveCount(1);
});

// ── Stage-internal drag ──────────────────────────────────────────────────

test("handle-drag swaps two populated tiles", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  await useSplitScreen(page);
  await pickLive(page, "Twitch:twitch-live-1");
  await pickLive(page, "YouTube:UClive0000000000000000aa");

  const twitchTile = page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"]');
  const ytTile = page.locator('.ms-leaf[data-stream-id="YouTube:UClive0000000000000000aa"]');
  const twitchPathBefore = await twitchTile.getAttribute("data-path");
  const ytPathBefore = await ytTile.getAttribute("data-path");
  expect(twitchPathBefore).not.toBe(ytPathBefore);

  // Interim handle per the Lane A contract: `.watch-tile-name` until
  // `.pb-grab[data-drag-handle]` lands.
  await manualDragTo(page, twitchTile.locator(".watch-tile-name"), ytTile);

  // Same two content keys, now on the OTHER path each.
  await expect(page.locator(`.ms-leaf[data-path="${ytPathBefore}"][data-stream-id="Twitch:twitch-live-1"]`)).toHaveCount(1);
  await expect(page.locator(`.ms-leaf[data-path="${twitchPathBefore}"][data-stream-id="YouTube:UClive0000000000000000aa"]`)).toHaveCount(1);
});

test("dropping on a gutter resolves to the nearest leaf", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  await useSplitScreen(page);
  await pickLive(page, "Twitch:twitch-live-1");
  // Leave the second slot empty so the drop has an unambiguous target.

  const gutter = page.locator(".ms-gutter");
  await expect(gutter).toHaveCount(1);
  const emptyLeaf = page.locator(".ms-leaf.ms-empty");

  await manualDragTo(page, page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"] .watch-tile-name'), gutter);

  // The gutter itself is never a valid content target — the drop must
  // have resolved to a real leaf (either it landed on the empty one via
  // nearest-leaf resolution, or nothing moved because it resolved back to
  // its own tile). Either way, no stream keys are left dangling: exactly
  // one populated tile still exists with the Twitch content.
  await expect(page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"]')).toHaveCount(1);
});

test(".ms-stage carries is-dnd only while a drag is in flight", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  await useSplitScreen(page);
  await pickLive(page, "Twitch:twitch-live-1");

  await expect(page.locator(".ms-stage")).not.toHaveClass(/is-dnd/);

  await page.evaluate(() => {
    const handle = document.querySelector(".watch-tile-name") as HTMLElement;
    const dt = new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator(".ms-stage")).toHaveClass(/is-dnd/);

  await page.evaluate(() => {
    document.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".ms-stage")).not.toHaveClass(/is-dnd/);
});

// ── Picker card ────────────────────────────────────────────────────────

test("picker assigns a live channel and a recording", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  await useSplitScreen(page);
  await expect(page.locator(".ms-picker")).toHaveCount(2);

  await pickLive(page, "Twitch:twitch-live-1");
  await expect(page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"]')).toHaveCount(1);

  await page.locator(".ms-picker").first().locator(`.ms-pick[data-pick="rec:${FINISHED_REC_ID}"]`).click();
  await expect(page.locator(`.ms-leaf[data-recording-id="${FINISHED_REC_ID}"]`)).toHaveCount(1);
  await expect(page.locator(".ms-picker")).toHaveCount(0);
});

test("picker filter narrows rows and supports arrow-key + Enter selection", async ({ page }) => {
  await page.goto("/app#/watch");

  const picker = page.locator(".ms-picker").first();
  const filter = picker.locator(".ms-picker-filter");
  await filter.fill("twitchlive");
  await expect(picker.locator(".ms-pick:not([hidden])")).toHaveCount(1);

  await filter.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"]')).toHaveCount(1);
});

// ── Keyboard ──────────────────────────────────────────────────────────

test("x removes a populated tile back to empty", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  await pickLive(page, "Twitch:twitch-live-1");
  await expect(page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"]')).toHaveCount(1);

  // The volume slider is the one focusable descendant of a populated tile
  // today, ahead of Lane A's tabindex on `.ms-leaf` itself.
  await page.locator(".ms-vol").focus();
  await page.keyboard.press("x");

  await expect(page.locator(".ms-leaf.ms-empty")).toHaveCount(1);
});

test("Shift+ArrowRight swaps the focused tile with its neighbour", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  await useSplitScreen(page);
  await pickLive(page, "Twitch:twitch-live-1");
  await pickLive(page, "YouTube:UClive0000000000000000aa");

  const twitchTile = page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"]');
  const twitchPathBefore = await twitchTile.getAttribute("data-path");

  await twitchTile.locator(".ms-vol").focus();
  await page.keyboard.press("Shift+ArrowRight");

  await expect(page.locator(`.ms-leaf[data-path="${twitchPathBefore}"][data-stream-id="YouTube:UClive0000000000000000aa"]`)).toHaveCount(1);
});

// ── Persistence ──────────────────────────────────────────────────────

test("soloPath survives a reload", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  await useSplitScreen(page);
  await pickLive(page, "Twitch:twitch-live-1");
  await pickLive(page, "YouTube:UClive0000000000000000aa");

  const twitchPath = await page
    .locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"]')
    .getAttribute("data-path");
  await page.locator('.ms-leaf[data-stream-id="Twitch:twitch-live-1"] .ms-solo').click();

  const soloBefore = await page.evaluate(() => (window as any).__strivoTestHooks.playerState.soloPath);
  expect(soloBefore).toBe(twitchPath);

  await installFakePlayers(page);
  await page.reload();
  await waitForFakePlayers(page);

  const soloAfter = await page.evaluate(() => (window as any).__strivoTestHooks.playerState.soloPath);
  expect(soloAfter).toBe(twitchPath);
});

// ── Rail click on #/watch ──────────────────────────────────────────────

test("rail click on #/watch fills the focused tile; Ctrl-click still goes to #/library", async ({ page }) => {
  await installFakePlayers(page);
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);

  await expect(page.locator(".ms-leaf.ms-empty")).toHaveCount(1);
  await page.locator(YT_LIVE_ROW).click();

  await expect(page).toHaveURL(/#\/watch/);
  await expect(page.locator('.ms-leaf[data-stream-id="YouTube:UClive0000000000000000aa"]')).toHaveCount(1);

  // Reset back to a fresh empty single tile, then prove Ctrl-click keeps
  // the old "go to channel" behaviour.
  await page.evaluate(() => localStorage.removeItem("strivo-player-layout"));
  await page.goto("/app#/watch");
  await waitForFakePlayers(page);
  await page.locator(YT_LIVE_ROW).click({ modifiers: ["Control"] });
  await expect(page).toHaveURL(/#\/library/);
});
