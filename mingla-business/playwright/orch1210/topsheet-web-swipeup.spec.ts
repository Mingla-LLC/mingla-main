/**
 * ORCH-1210 [business-web top sheet swipe-UP-to-dismiss] — REAL-Chromium
 * measurement (Playwright). NO jsdom.
 *
 * THE BUG (Seth, business web): the brand-switcher TopSheet (and the "Create"
 * menu) could NOT be dismissed by swiping up — only by tapping outside. The
 * NATIVE variant (TopSheetNative) has a reanimated upward PanGesture; the WEB
 * variant (TopSheetWeb) had ONLY scrim-tap + Escape.
 *
 * THE FIX (TopSheet.tsx TopSheetWeb): a pointer drag-catch band at the BOTTOM of
 * the panel (over the handle) translates the panel UP with the finger and calls
 * onClose() past 25% of panel height / an upward flick velocity, mirroring
 * SheetWeb (ORCH-1207/1208) inverted. The drag-catch carries `touch-action:none`
 * itself (ORCH-1208 lesson) so Android/Samsung don't steal the drag as a page
 * scroll.
 *
 * Fidelity: HIGH — real Chromium, real react-native-web compiled DOM/CSS for the
 * REAL TopSheetWeb (metro-bundled, native deps mapped to the SAME web shims the
 * deployed bundle uses). Not shipped; lives under playwright/.
 *
 * Run:
 *   cd mingla-business && npx playwright test -c playwright.orch1210.config.ts
 */
import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const HARNESS = pathToFileURL(path.join(__dirname, "index.html")).href;

const LAYOUT_W = 390;
const LAYOUT_H = 844;

interface PanelGeo {
  found: boolean;
  top: number | null;
  bottom: number | null;
  height: number | null;
}

async function locatePanel(page: import("@playwright/test").Page): Promise<PanelGeo> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="orch1210-topsheet"]') as HTMLElement | null;
    let panelEl: HTMLElement | null = null;
    if (root) {
      let best = 0;
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        // The panel has a rounded border on all corners (radius.xl).
        if (parseFloat(cs.borderTopLeftRadius) > 0 && r.height > best) {
          best = r.height;
          panelEl = el;
        }
      }
    }
    const r = panelEl?.getBoundingClientRect() ?? null;
    return { found: !!panelEl, top: r ? r.top : null, bottom: r ? r.bottom : null, height: r ? r.height : null };
  });
}

test("touch-action — the drag-catch computes touch-action:none (ORCH-1208 lesson)", async ({ page }) => {
  await page.setViewportSize({ width: LAYOUT_W, height: LAYOUT_H });
  await page.goto(HARNESS);
  await page.waitForSelector('[data-testid="orch1210-row"]', { timeout: 15000 });
  await page.waitForTimeout(600);

  const handle = page.locator('[data-testid="orch1210-topsheet-drag-handle"]');
  await expect(handle, "web drag-catch present").toHaveCount(1);

  const touchAction = await handle.evaluate((el) => getComputedStyle(el as HTMLElement).touchAction);
  // eslint-disable-next-line no-console
  console.log("ORCH-1210 DRAG-CATCH touch-action =", touchAction);
  expect(touchAction, "drag-catch touch-action").toBe("none");
});

test("swipe UP PAST threshold dismisses the top sheet (onClose fires)", async ({ page }) => {
  await page.setViewportSize({ width: LAYOUT_W, height: LAYOUT_H });
  await page.goto(HARNESS);
  await page.waitForSelector('[data-testid="orch1210-row"]', { timeout: 15000 });
  await page.waitForTimeout(600);

  const handle = page.locator('[data-testid="orch1210-topsheet-drag-handle"]');
  const box = await handle.boundingBox();
  expect(box, "drag-catch bounding box").not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  // fixed-70 panel ≈ 0.7 * 844 ≈ 591px; 25% threshold ≈ 148px. Drag UP 360px.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(startX, startY - i * 30);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);

  const closed = await page.locator('[data-testid="closed-count"]').textContent();
  // eslint-disable-next-line no-console
  console.log("ORCH-1210 SWIPE-UP-PAST-THRESHOLD closed-count =", closed);
  expect(closed, "onClose fired once past threshold").toBe("closed:1");
});

test("small UP drag BELOW threshold springs back (no close)", async ({ page }) => {
  await page.setViewportSize({ width: LAYOUT_W, height: LAYOUT_H });
  await page.goto(HARNESS);
  await page.waitForSelector('[data-testid="orch1210-row"]', { timeout: 15000 });
  await page.waitForTimeout(600);

  const before = await locatePanel(page);
  expect(before.found).toBe(true);

  const handle = page.locator('[data-testid="orch1210-topsheet-drag-handle"]');
  const box = await handle.boundingBox();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  // Drag UP only ~40px (< 25% of ~591px ≈ 148px) SLOWLY so velocity stays low.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(startX, startY - i * 10);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);

  const closed = await page.locator('[data-testid="closed-count"]').textContent();
  // eslint-disable-next-line no-console
  console.log("ORCH-1210 SWIPE-UP-BELOW-THRESHOLD closed-count =", closed);
  expect(closed, "sheet stayed open (sprang back) below threshold").toBe("closed:0");

  // And the panel should have returned to its open resting position.
  const after = await locatePanel(page);
  expect(after.found).toBe(true);
  expect(Math.abs((after.top ?? 0) - (before.top ?? 0)), "panel sprang back to open rest").toBeLessThan(4);
});

test("scrim tap still dismisses (regression guard)", async ({ page }) => {
  await page.setViewportSize({ width: LAYOUT_W, height: LAYOUT_H });
  await page.goto(HARNESS);
  await page.waitForSelector('[data-testid="orch1210-row"]', { timeout: 15000 });
  await page.waitForTimeout(600);

  // Tap near the very BOTTOM of the screen (below the 70% top-anchored panel) = the scrim.
  await page.mouse.click(LAYOUT_W / 2, LAYOUT_H - 30);
  await page.waitForTimeout(400);

  const closed = await page.locator('[data-testid="closed-count"]').textContent();
  // eslint-disable-next-line no-console
  console.log("ORCH-1210 SCRIM-TAP closed-count =", closed);
  expect(closed, "scrim tap still closes").toBe("closed:1");
});
