/**
 * ORCH-1199 [venue action sheets STILL bleed below the visible viewport on
 * Android Chrome / Samsung Internet — after ORCH-1197 fixed iOS Safari]
 * — REAL-Chromium measurement (Playwright). NO jsdom.
 *
 * THE BUG (Seth, business web on a SAMSUNG/Android phone): the venue action sheets
 * (Add table, New reservation, Add category, Add blackout, Add to waitlist) open as
 * a bottom sheet whose PANEL extends BELOW the visible viewport — the primary CTA is
 * off-screen. ORCH-1197 fixed this for iOS Safari but the fix does NOT hold on
 * Android Chrome / Samsung Internet.
 *
 * WHY 1197's MODEL IS iOS-SAFARI-SHAPED (and wrong on Android):
 *   1197 anchors the dock at `bottom:0` of the LAYOUT viewport and LIFTS the panel
 *   up by `toolbarOffset = innerHeight - visualViewport.height` via a transform, on
 *   the theory that the only difference between layout-bottom and visible-bottom is a
 *   dynamic BOTTOM toolbar. That theory holds on iOS Safari but is wrong on Android:
 *
 *   (A) `visualViewport.offsetTop` IS IGNORED. On Android, when the on-screen
 *       keyboard opens the page scrolls to keep the focused field visible, so the
 *       visual viewport shifts DOWN (`offsetTop > 0`). The true visible band in
 *       getBoundingClientRect coordinates is `[offsetTop, offsetTop + vvHeight]`, NOT
 *       `[0, vvHeight]`. With Chrome's resizes-content behaviour `innerHeight`
 *       shrinks to equal `vvHeight`, so `toolbarOffset == 0` → NO lift → the panel
 *       anchors at the layout bottom (`innerHeight`), which sits BELOW the true
 *       visible bottom (`offsetTop + vvHeight`). The panel + CTA bleed off-screen.
 *
 *   (B) POST-OPEN keyboard shrink. The sheet opens first, THEN the user taps a
 *       field → `visualViewport.height` shrinks AFTER mount. The panel's JS-measured
 *       transform lift must re-track that resize; if anchoring is brittle the panel
 *       bottom stays at the old (taller) anchor and bleeds below the new visible
 *       bottom.
 *
 * The robust fix sizes + anchors the panel against the VISUAL viewport using
 * `offsetTop + height` for the true visible bottom and re-tracks the
 * `visualViewport` `resize`/`scroll` events — cross-browser (iOS Safari AND Android
 * Chrome AND Samsung Internet). PROOF = panel bottom Y and CTA bottom Y vs the TRUE
 * visible bottom (`visualViewport.offsetTop + visualViewport.height`) in both
 * conditions.
 *
 * Run:
 *   cd mingla-business && node playwright/orch1199/bundle.mjs \
 *     && npx playwright test -c playwright.orch1199.config.ts
 */
import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const HARNESS = pathToFileURL(path.join(__dirname, "index.html")).href;

const LAYOUT_W = 360;

/**
 * Install a controllable `window.visualViewport` whose listeners ACTUALLY fire on
 * mutation (the deployed SheetWeb hook attaches a `resize` listener — a no-op stub
 * would hide the re-track path). Exposes `__setVV` on window to mutate height /
 * offsetTop and dispatch `resize` at runtime, mirroring a keyboard opening after
 * the sheet is already on screen.
 */
async function installVisualViewport(
  page: import("@playwright/test").Page,
  init: { height: number; offsetTop: number; width: number },
) {
  await page.addInitScript((cfg) => {
    const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };
    const vv = {
      height: cfg.height,
      width: cfg.width,
      offsetTop: cfg.offsetTop,
      offsetLeft: 0,
      scale: 1,
      pageTop: cfg.offsetTop,
      pageLeft: 0,
      addEventListener: (t: string, l: () => void) => {
        (listeners[t] ||= []).push(l);
      },
      removeEventListener: (t: string, l: () => void) => {
        listeners[t] = (listeners[t] || []).filter((x) => x !== l);
      },
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    (window as unknown as { __setVV: (h: number, ot: number) => void }).__setVV = (h, ot) => {
      vv.height = h;
      vv.offsetTop = ot;
      vv.pageTop = ot;
      for (const l of listeners.resize) l();
      for (const l of listeners.scroll) l();
    };
  }, init);
}

async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="orch1199-sheet"]') as HTMLElement | null;
    const ctaEl = document.querySelector('[data-testid="orch1199-cta"]') as HTMLElement | null;
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
    const panelRect = panelEl?.getBoundingClientRect() ?? null;
    const ctaRect = ctaEl?.getBoundingClientRect() ?? null;
    const vv = (window as unknown as { visualViewport?: { height: number; offsetTop: number } })
      .visualViewport;
    const visibleTop = vv ? vv.offsetTop : 0;
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    return {
      innerHeight: window.innerHeight,
      vvHeight: vv ? vv.height : window.innerHeight,
      vvOffsetTop: vv ? vv.offsetTop : 0,
      visibleTop,
      visibleBottom,
      panelTop: panelRect ? panelRect.top : null,
      panelBottom: panelRect ? panelRect.bottom : null,
      panelHeight: panelRect ? panelRect.height : null,
      ctaBottom: ctaRect ? ctaRect.bottom : null,
      found: { panel: !!panelEl, cta: !!ctaEl },
    };
  });
}

test.describe("ORCH-1199 — SheetWeb on Android Chrome / Samsung", () => {
  test("Condition A — keyboard open + page scrolled (visualViewport.offsetTop > 0): panel + CTA within the true visible band", async ({
    page,
  }) => {
    // Android Chrome (resizes-visual, the keyboard default): the layout viewport
    // stays at the full address-bar-collapsed height (innerHeight = 800); the keyboard
    // (~340px) shrinks the visual viewport to 460; and the page scrolls UP by 120px to
    // reveal the focused field, so the visual viewport shifts down (offsetTop = 120).
    // The true visible band is [120, 580], well inside the 800 layout viewport — and
    // 1197's `innerHeight − height` lift (340) OVER-lifts past the visible bottom while
    // ignoring offsetTop entirely.
    const innerH = 800;
    await installVisualViewport(page, { height: 460, offsetTop: 120, width: LAYOUT_W });
    await page.setViewportSize({ width: LAYOUT_W, height: innerH });

    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="orch1199-cta"]', { timeout: 15000 });
    await page.waitForTimeout(600);

    const m = await measure(page);
    // eslint-disable-next-line no-console
    console.log("ORCH-1199 MEASUREMENT [A offsetTop]", JSON.stringify(m, null, 2));

    expect(m.found.panel, "panel located").toBe(true);
    expect(m.found.cta, "CTA located").toBe(true);
    // Panel must sit WITHIN the true visible band [visibleTop, visibleBottom].
    expect(m.panelTop!, "panel top at/below visible top (A)").toBeGreaterThanOrEqual(m.visibleTop - 1);
    expect(m.panelBottom!, "panel bottom at/above visible bottom (A)").toBeLessThanOrEqual(
      m.visibleBottom + 1,
    );
    expect(m.ctaBottom!, "CTA bottom within visible band (A)").toBeLessThanOrEqual(m.visibleBottom + 1);
  });

  test("Condition B — keyboard opens AFTER the sheet (visualViewport shrinks post-mount): panel re-anchors within visible viewport", async ({
    page,
  }) => {
    // Sheet opens at full visible height, THEN the keyboard appears and shrinks the
    // visual viewport (a real Android sequence: open sheet → tap a field).
    const innerH = 800;
    await installVisualViewport(page, { height: 800, offsetTop: 0, width: LAYOUT_W });
    await page.setViewportSize({ width: LAYOUT_W, height: innerH });

    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="orch1199-cta"]', { timeout: 15000 });
    await page.waitForTimeout(400);

    // Keyboard appears after open: visual viewport shrinks 800 → 360 (no innerHeight
    // change, resizes-visual), and fires the visualViewport `resize` the hook tracks.
    await page.evaluate(() => {
      (window as unknown as { __setVV: (h: number, ot: number) => void }).__setVV(360, 0);
    });
    await page.waitForTimeout(400);

    const m = await measure(page);
    // eslint-disable-next-line no-console
    console.log("ORCH-1199 MEASUREMENT [B post-open keyboard]", JSON.stringify(m, null, 2));

    expect(m.found.panel, "panel located").toBe(true);
    expect(m.found.cta, "CTA located").toBe(true);
    expect(m.panelBottom!, "panel bottom within visible viewport (B)").toBeLessThanOrEqual(
      m.visibleBottom + 1,
    );
    expect(m.ctaBottom!, "CTA bottom within visible viewport (B)").toBeLessThanOrEqual(m.visibleBottom + 1);
  });
});
