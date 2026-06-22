/**
 * ORCH-1197 [venue action sheets bleed below the visible viewport on iOS Safari]
 * — REAL-Chromium measurement (Playwright). NO jsdom.
 *
 * THE BUG (Seth, business web on iPhone Safari): the venue action sheets (Add
 * category, Add to waitlist, New reservation, Add blackout, Add table) open as a
 * bottom sheet whose PANEL extends BELOW the visible viewport — the title shows
 * near the bottom and the form fields + primary CTA are cut off behind Safari's
 * bottom toolbar. The panel itself bleeds off-screen (NOT the inner scroll, which
 * ORCH-1193 already bounded).
 *
 * MECHANISM (measured here): SheetWeb sizes its panel from
 * `Dimensions.get("window").height` (== the LAYOUT viewport / `window.innerHeight`)
 * and the dock is `position:absolute; bottom:0` inside a `100%`-height absoluteFill.
 * On iOS Safari the LAYOUT viewport is TALLER than the VISIBLE (visual) viewport by
 * the height of the dynamic bottom toolbar, so `bottom:0` and the panel land partly
 * below the visible area. We reproduce that by setting the Chromium viewport to the
 * full LAYOUT height and overriding `window.visualViewport` to a SHORTER visible
 * height (the toolbar reduction). The proof = the panel's bottom Y and the primary
 * CTA's bottom Y vs the VISIBLE bottom (`visualViewport.height`).
 *
 * The fix (SheetMobile.tsx SheetWeb) sizes/anchors the panel to the VISUAL viewport
 * (`window.visualViewport.height`, with `100dvh`/`-webkit-fill-available` + a
 * `safe-area-inset-bottom` pad) instead of the layout `Dimensions` height. After
 * the fix the panel bottom + CTA sit within `visualViewport.height`.
 *
 * Fidelity: HIGH — real Chromium, real react-native-web compiled DOM + CSS for the
 * REAL SheetWeb (metro-bundled, native-only deps mapped to the SAME web shims the
 * deployed bundle uses), real layout. Not shipped; lives under playwright/.
 *
 * Run:
 *   cd mingla-business && node playwright/orch1197/bundle.mjs \
 *     && npx playwright test -c playwright.orch1197.config.ts
 */
import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const HARNESS = pathToFileURL(path.join(__dirname, "index.html")).href;

// iPhone 12/13/14 logical layout size.
const LAYOUT_W = 390;
const LAYOUT_H = 844;
// Safari's dynamic bottom toolbar steals ~114px of VISIBLE height while the
// LAYOUT viewport stays the full 844. So the visible bottom is at 730.
const VISIBLE_H = 730;

async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="orch1197-sheet"] [role], [data-testid="orch1197-sheet"]');
    // The panel is the dock's child that carries a height + rounded top corners.
    // Find the deepest element under the sheet root whose computed height is a
    // large fraction of the viewport (the panel), then the CTA by test id.
    const root = document.querySelector('[data-testid="orch1197-sheet"]') as HTMLElement | null;
    const ctaEl = document.querySelector('[data-testid="orch1197-cta"]') as HTMLElement | null;
    let panelEl: HTMLElement | null = null;
    if (root) {
      const candidates = Array.from(root.querySelectorAll<HTMLElement>("*"));
      // panel = element with borderTopLeftRadius set (rounded top) and the tallest box
      let best = 0;
      for (const el of candidates) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const rounded = parseFloat(cs.borderTopLeftRadius) > 0;
        if (rounded && r.height > best) {
          best = r.height;
          panelEl = el;
        }
      }
    }
    const panelRect = panelEl?.getBoundingClientRect() ?? null;
    const ctaRect = ctaEl?.getBoundingClientRect() ?? null;
    const vv = (window as unknown as { visualViewport?: { height: number } }).visualViewport;
    return {
      visibleHeight: vv ? vv.height : window.innerHeight,
      innerHeight: window.innerHeight,
      panelBottom: panelRect ? panelRect.bottom : null,
      panelTop: panelRect ? panelRect.top : null,
      ctaBottom: ctaRect ? ctaRect.bottom : null,
      ctaTop: ctaRect ? ctaRect.top : null,
      found: { panel: !!panelEl, cta: !!ctaEl },
    };
  });
}

test("SheetWeb panel + CTA sit within the VISIBLE (visual) viewport on mobile", async ({ page }) => {
  await page.setViewportSize({ width: LAYOUT_W, height: LAYOUT_H });

  // Override visualViewport.height to the toolbar-reduced VISIBLE height BEFORE
  // any script runs, so SheetWeb's measurement reads the smaller visible value
  // (mirrors iOS Safari where visualViewport.height < layout/innerHeight).
  await page.addInitScript((visibleH) => {
    const vv = {
      height: visibleH,
      width: 390,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
      pageTop: 0,
      pageLeft: 0,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  }, VISIBLE_H);

  await page.goto(HARNESS);
  await page.waitForSelector('[data-testid="orch1197-cta"]', { timeout: 15000 });
  // let the open-animation rAF settle (translateY -> 0)
  await page.waitForTimeout(600);

  const m = await measure(page);
  // eslint-disable-next-line no-console
  console.log("ORCH-1197 MEASUREMENT", JSON.stringify(m, null, 2));

  expect(m.found.panel, "panel element located").toBe(true);
  expect(m.found.cta, "CTA element located").toBe(true);

  // THE ASSERTION: panel bottom and CTA bottom must be within the VISIBLE viewport.
  // 1px tolerance for sub-pixel rounding.
  expect(m.panelBottom!, "panel bottom within visible viewport").toBeLessThanOrEqual(m.visibleHeight + 1);
  expect(m.ctaBottom!, "primary CTA bottom within visible viewport").toBeLessThanOrEqual(m.visibleHeight + 1);
});
