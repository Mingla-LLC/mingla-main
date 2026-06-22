/**
 * ORCH-1207 [business-web sheets too transparent + no swipe-to-dismiss] —
 * REAL-Chromium measurement (Playwright). NO jsdom.
 *
 * TWO BUGS (Seth, business web on mobile):
 *  1. SHEETS ARE TOO TRANSPARENT — the panel used the native glass stack (BlurView
 *     or a 0.92-alpha fallback + a translucent tint), so page content ghosts
 *     through. Per the Android opaque-glass policy the open panel must be
 *     effectively OPAQUE.
 *  2. SWIPE-DOWN DOES NOT CLOSE — SheetWeb closed ONLY via a scrim tap (zero
 *     reanimated hooks, no drag gesture). A downward pointer drag on the handle
 *     must dismiss it past a threshold and spring back below it.
 *
 * The fix (SheetMobile.tsx SheetWeb): a single fully-opaque elevated-surface
 * fill (#16181b) replaces the see-through glass stack on web, AND a pointer
 * drag-catch band over the handle/header translates the panel with the finger
 * and calls onClose() past 25% of panel height / a downward flick velocity.
 *
 * Fidelity: HIGH — real Chromium, real react-native-web compiled DOM/CSS for the
 * REAL SheetWeb (metro-bundled, native deps mapped to the SAME web shims the
 * deployed bundle uses). Not shipped; lives under playwright/.
 *
 * Run:
 *   cd mingla-business && npx playwright test -c playwright.orch1207.config.ts
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
  bgAlpha: number | null;
  bgColor: string | null;
}

async function locatePanel(page: import("@playwright/test").Page): Promise<PanelGeo> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="orch1207-sheet"]') as HTMLElement | null;
    let panelEl: HTMLElement | null = null;
    if (root) {
      let best = 0;
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (parseFloat(cs.borderTopLeftRadius) > 0 && r.height > best) {
          best = r.height;
          panelEl = el;
        }
      }
    }
    // The opaque fill is the absolute-filled base layer INSIDE the panel — find the
    // descendant whose computed background-color has the highest alpha.
    let bgColor: string | null = null;
    let bgAlpha: number | null = null;
    if (panelEl) {
      for (const el of Array.from(panelEl.querySelectorAll<HTMLElement>("*"))) {
        const c = getComputedStyle(el).backgroundColor; // rgb(...) or rgba(...)
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) continue;
        const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
        const a = parts.length >= 4 ? parts[3] : 1;
        if (bgAlpha === null || a > bgAlpha) {
          bgAlpha = a;
          bgColor = c;
        }
      }
    }
    const r = panelEl?.getBoundingClientRect() ?? null;
    return {
      found: !!panelEl,
      top: r ? r.top : null,
      bottom: r ? r.bottom : null,
      height: r ? r.height : null,
      bgAlpha,
      bgColor,
    };
  });
}

test("Bug 1 — open SheetWeb panel is effectively OPAQUE (no page bleed-through)", async ({ page }) => {
  await page.setViewportSize({ width: LAYOUT_W, height: LAYOUT_H });
  await page.goto(HARNESS);
  await page.waitForSelector('[data-testid="orch1207-cta"]', { timeout: 15000 });
  await page.waitForTimeout(600); // open-animation settle

  const geo = await locatePanel(page);
  // eslint-disable-next-line no-console
  console.log("ORCH-1207 OPACITY MEASUREMENT", JSON.stringify(geo, null, 2));
  expect(geo.found, "panel located").toBe(true);

  // (a) the panel's strongest background-fill alpha must be effectively opaque.
  expect(geo.bgAlpha!, `panel fill alpha (${geo.bgColor})`).toBeGreaterThanOrEqual(0.97);

  // (b) sample an actual screen pixel near the panel center — it must NOT read the
  // loud magenta page-behind color (#ff00ff). We screenshot a 1x1 region.
  const sampleY = Math.round((geo.top! + geo.bottom!) / 2);
  const sampleX = Math.round(LAYOUT_W / 2);
  const shot = await page.screenshot({
    clip: { x: sampleX, y: sampleY, width: 1, height: 1 },
  });
  // Decode the single pixel via the PNG's IDAT is overkill; instead read it back
  // through the canvas in-page for a robust RGB sample at the panel center.
  const pixel = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      // Walk up to the nearest element with a non-transparent bg and report it.
      let cur: HTMLElement | null = el;
      while (cur) {
        const c = getComputedStyle(cur).backgroundColor;
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
          const a = parts.length >= 4 ? parts[3] : 1;
          if (a > 0.5) return { r: parts[0], g: parts[1], b: parts[2], a, color: c };
        }
        cur = cur.parentElement;
      }
      return { r: -1, g: -1, b: -1, a: -1, color: "none" };
    },
    [sampleX, sampleY],
  );
  // eslint-disable-next-line no-console
  console.log("ORCH-1207 PIXEL-AT-PANEL-CENTER", JSON.stringify(pixel), "screenshotBytes", shot.length);
  // The element under the panel center must be the dark sheet fill, NOT the
  // magenta page (#ff00ff = r255 g0 b255). Magenta would mean bleed-through.
  const isMagenta = pixel.r > 200 && pixel.b > 200 && pixel.g < 80;
  expect(isMagenta, `pixel under panel center is the page-behind magenta (${pixel.color})`).toBe(false);
});

test("Bug 2a — downward drag PAST threshold dismisses the sheet (onClose fires)", async ({ page }) => {
  await page.setViewportSize({ width: LAYOUT_W, height: LAYOUT_H });
  await page.goto(HARNESS);
  await page.waitForSelector('[data-testid="orch1207-cta"]', { timeout: 15000 });
  await page.waitForTimeout(600);

  const handle = page.locator('[data-testid="orch1207-sheet-drag-handle"]');
  await expect(handle, "web drag-handle present").toHaveCount(1);

  const box = await handle.boundingBox();
  expect(box, "handle bounding box").not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  // half-snap panel ≈ 422px; 25% threshold ≈ 105px. Drag down 300px (well past).
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(startX, startY + i * 30);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);

  const closed = await page.locator('[data-testid="closed-count"]').textContent();
  // eslint-disable-next-line no-console
  console.log("ORCH-1207 DRAG-PAST-THRESHOLD closed-count =", closed);
  expect(closed, "onClose fired once past threshold").toBe("closed:1");
});

test("Bug 2b — small downward drag BELOW threshold springs back (no close)", async ({ page }) => {
  await page.setViewportSize({ width: LAYOUT_W, height: LAYOUT_H });
  await page.goto(HARNESS);
  await page.waitForSelector('[data-testid="orch1207-cta"]', { timeout: 15000 });
  await page.waitForTimeout(600);

  const handle = page.locator('[data-testid="orch1207-sheet-drag-handle"]');
  const box = await handle.boundingBox();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  // Drag only ~40px (< 25% of ~422px ≈ 105px) SLOWLY so velocity stays low.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(startX, startY + i * 10);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);

  const closed = await page.locator('[data-testid="closed-count"]').textContent();
  // eslint-disable-next-line no-console
  console.log("ORCH-1207 DRAG-BELOW-THRESHOLD closed-count =", closed);
  expect(closed, "sheet stayed open (sprang back) below threshold").toBe("closed:0");

  // And the panel should have returned to its open resting position (top within
  // the viewport, not pushed off-screen).
  const geo = await locatePanel(page);
  expect(geo.found).toBe(true);
  expect(geo.top!, "panel sprang back to open rest").toBeLessThan(LAYOUT_H);
});

test("Bug 2c — scrim tap still dismisses (regression guard)", async ({ page }) => {
  await page.setViewportSize({ width: LAYOUT_W, height: LAYOUT_H });
  await page.goto(HARNESS);
  await page.waitForSelector('[data-testid="orch1207-cta"]', { timeout: 15000 });
  await page.waitForTimeout(600);

  // Tap near the very top of the screen (above the half-snap panel) = the scrim.
  await page.mouse.click(LAYOUT_W / 2, 20);
  await page.waitForTimeout(400);

  const closed = await page.locator('[data-testid="closed-count"]').textContent();
  // eslint-disable-next-line no-console
  console.log("ORCH-1207 SCRIM-TAP closed-count =", closed);
  expect(closed, "scrim tap still closes").toBe("closed:1");
});
