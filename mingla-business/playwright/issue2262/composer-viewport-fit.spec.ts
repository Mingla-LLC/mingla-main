/**
 * #2262 [composer-responsive-layout] — THE GEOMETRY GATE. The load-bearing suite.
 *
 * This is the only #2262 check with a layout engine, and it exists because both
 * reported defects were measured at RUNTIME on a commit where 78/78 composer
 * tests were green:
 *
 *   - 1440x900 : the footer overlapped the message box by 9px
 *   - 1024x700 : the footer overlapped the message box by 129px, and 77px of
 *                the composer was unreachable behind `overflow:hidden` with no
 *                scrollbar at all
 *   -  390x750 : the footer sat 89px ENTIRELY BELOW THE FOLD
 *   -  320x568 : 181px below the fold
 *   - every web width: `.ProseMirror` was 23px tall inside a 480px box, so a
 *                real click at the vertical centre left `document.activeElement`
 *                on `<body>` and 95% of the message box was inert
 *
 * `react-test-renderer` has no viewport, no scroll and no bounding boxes, so no
 * amount of thoroughness there could have failed for any of it.
 *
 * REAL CLICKS ONLY. The investigation confirmed first that a synthetic
 * `MouseEvent` does not move focus, and discarded those results. The warning is
 * repeated here so nobody re-derives it: `page.mouse.click` or nothing.
 *
 * RESIZE DISCIPLINE. Every viewport is a separate Playwright PROJECT with a
 * fresh page load, never a mid-test resize. CDP
 * `Emulation.setDeviceMetricsOverride` fires NEITHER `window.resize` NOR
 * `visualViewport.resize` (both listeners were armed and confirmed empty across
 * two resizes), so react-native-web's `Dimensions` does not update and a resized
 * page reports a STALE layout. Recorded so the tester does not rediscover it.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// Resolved from the config's rootDir rather than `import.meta.url`: an
// `import.meta` reference makes Playwright load this file as ESM, and its own
// transpiled CJS helpers then fail with `require is not defined`.
const BUSINESS_ROOT = process.cwd();
const HERE = join(BUSINESS_ROOT, "playwright/issue2262");
const HARNESS_URL = `file://${join(HERE, "index.html")}`;
const BUNDLE = resolve(
  BUSINESS_ROOT,
  "node_modules/.cache/issue2262-harness/composer-entry.js",
);

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
  width: number;
}

async function open(page: Page, query = ""): Promise<void> {
  expect(
    existsSync(BUNDLE),
    "the harness bundle is missing — globalSetup did not run",
  ).toBe(true);
  await page.goto(`${HARNESS_URL}${query}`);
  await page.waitForSelector('[data-testid="composer-commit-bar"]', { timeout: 15000 });
}

async function rectOf(page: Page, testId: string): Promise<Rect> {
  const rect = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      height: r.height,
      width: r.width,
    };
  }, testId);
  // T4-g VACUITY GUARD: fail LOUDLY and by name before any measurement claim.
  // A bundle that silently failed to mount would otherwise pass every
  // "is inside the viewport" assertion trivially.
  expect(rect, `#2262 VACUITY: [data-testid="${testId}"] resolved to null`).not.toBeNull();
  return rect as Rect;
}

async function proseMirrorRect(page: Page): Promise<Rect> {
  const rect = await page.evaluate(() => {
    const el = document.querySelector(".ProseMirror");
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      height: r.height,
      width: r.width,
    };
  });
  expect(rect, "#2262 VACUITY: .ProseMirror is not in the document").not.toBeNull();
  return rect as Rect;
}

test.describe("#2262 — the action row is always in view", () => {
  test("T4-g VACUITY: the harness really mounted the real composer", async ({ page }) => {
    await open(page);
    // Every one of these must resolve BEFORE any assertion below is meaningful.
    const bar = await rectOf(page, "composer-commit-bar");
    const body = await rectOf(page, "composer-v2-body-host");
    const region = await rectOf(page, "composer-flex-region");
    const pm = await proseMirrorRect(page);

    expect(bar.height).toBeGreaterThan(40);
    expect(body.height).toBeGreaterThan(40);
    expect(region.height).toBeGreaterThan(40);
    expect(pm.height).toBeGreaterThan(10);

    // And the TopBar term is really present — it is the single largest miss in
    // RC-1, and a harness without it would flatter the fix by 64pt.
    const topBar = await rectOf(page, "harness-top-bar");
    expect(topBar.height).toBeGreaterThanOrEqual(56);
  });

  for (const [name, query] of [
    ["email, panels closed", ""],
    ["email, Personalize open", "?panel=open"],
    ["email, blocked-reason caption", "?blocked=1"],
    ["email, scheduled mode", "?mode=scheduled"],
    ["sms, panels closed", "?channel=sms"],
    ["sms, Personalize open", "?channel=sms&panel=open"],
  ] as const) {
    test(`T4-a: the commit bar is inside the viewport — ${name}`, async ({ page }) => {
      await open(page, query);
      const bar = await rectOf(page, "composer-commit-bar");
      const viewport = page.viewportSize();
      expect(viewport).not.toBeNull();

      // The property, stated exactly: the action row's bottom edge is inside
      // the visible area. Today this fails at all four viewports (89 / 181 /
      // 129 / 9 px), and it fails WORSE with the Personalize panel open —
      // overflow grew 89 -> 301px because the box was not allowed to know the
      // panel existed.
      expect(bar.bottom).toBeLessThanOrEqual((viewport as { height: number }).height + 0.5);
      expect(bar.top).toBeGreaterThanOrEqual(0);
      // And it is really ON the screen, not collapsed to nothing.
      expect(bar.height).toBeGreaterThan(40);
    });
  }

  test("T4-a2: the page itself never scrolls — there is no recovery to fall back on", async ({
    page,
  }) => {
    await open(page);
    const overflow = await page.evaluate(() => ({
      docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }));
    // `body { overflow: hidden }` is what `ScrollViewStyleReset` emits, so an
    // overflowing column is UNREACHABLE, not merely awkward. This assertion
    // proves the harness reproduces that condition rather than hiding it.
    expect(overflow.bodyOverflow).toBe("hidden");
    expect(overflow.docScroll).toBeLessThanOrEqual(1);
  });

  test("T4-b: the commit bar sits BELOW the message box — no overlap", async ({ page }) => {
    await open(page);
    const bar = await rectOf(page, "composer-commit-bar");
    const body = await rectOf(page, "composer-v2-body-host");
    // RC-3: an absolutely positioned footer overlapped the box by 9px at
    // 1440x900 and by 129px at 1024x700, while the box itself was clipped.
    expect(bar.top).toBeGreaterThanOrEqual(body.bottom - 0.5);
  });

  test("T4-c: SMS — no dead gap between the last control and the bar", async ({ page }) => {
    await open(page, "?channel=sms");
    const bar = await rectOf(page, "composer-commit-bar");
    const sheet = await rectOf(page, "composer-v2-sheet");
    // RC-3's OPPOSITE failure, same container: on the SMS channel the in-flow
    // content ended at y=521 while the pinned footer stayed at y=806 — a 285px
    // dead gap. A fix has to satisfy both directions, which is what a flow
    // sibling does for free.
    const gap = bar.top - sheet.bottom;
    expect(gap).toBeGreaterThanOrEqual(-0.5);
    expect(gap).toBeLessThanOrEqual(40);
  });

  test("T4-a3: the bar survives its TALLEST state — caption present, panel open", async ({
    page,
  }) => {
    await open(page, "?blocked=1&panel=open");
    const bar = await rectOf(page, "composer-commit-bar");
    const caption = await rectOf(page, "composer-commit-bar-caption");
    const viewport = page.viewportSize() as { height: number };
    // The bar's height is NOT constant — 84+inset at rest, +24 with the
    // caption. Any budget that assumed a fixed footer height was wrong; under a
    // flow-sibling architecture the variability is free, and this proves it.
    expect(caption.height).toBeGreaterThan(0);
    expect(bar.bottom).toBeLessThanOrEqual(viewport.height + 0.5);
  });
});

test.describe("#2262 — a click anywhere in the message box types there", () => {
  test("T4-e: the editable fills its box, top to bottom", async ({ page }) => {
    await open(page);
    const body = await rectOf(page, "composer-v2-body-host");
    const pm = await proseMirrorRect(page);
    // The defect, in one number: 23px of editable inside a 480px box.
    expect(pm.height).toBeGreaterThanOrEqual(body.height - 1);
    expect(pm.top).toBeLessThanOrEqual(body.top + 1);
    expect(pm.bottom).toBeGreaterThanOrEqual(body.bottom - 1);
  });

  for (const [label, fraction] of [
    ["the vertical CENTRE", 0.5],
    ["90% DOWN", 0.9],
  ] as const) {
    test(`T4-d: a real click at ${label} of the box focuses the editable`, async ({
      page,
    }) => {
      await open(page);
      const body = await rectOf(page, "composer-v2-body-host");
      const x = Math.round(body.left + body.width / 2);
      const y = Math.round(body.top + body.height * fraction);

      // REAL click. A synthetic `MouseEvent` does NOT move focus — the
      // investigation confirmed that first and discarded those results.
      await page.mouse.click(x, y);

      const focus = await page.evaluate(() => {
        const active = document.activeElement;
        const sel = window.getSelection();
        const anchor = sel?.anchorNode ?? null;
        const anchorEl =
          anchor === null
            ? null
            : anchor.nodeType === 1
              ? (anchor as Element)
              : anchor.parentElement;
        return {
          tag: active?.tagName ?? null,
          classes: active === null ? [] : Array.from(active.classList),
          editable: (active as HTMLElement | null)?.isContentEditable ?? false,
          selectionInside: anchorEl?.closest(".ProseMirror") !== null && anchorEl !== null,
        };
      });

      // Before: `activeElement === BODY`, `editable false`, selection outside.
      expect(focus.classes).toContain("ProseMirror");
      expect(focus.editable).toBe(true);
      expect(focus.selectionInside).toBe(true);
    });
  }

  test("T4-e2: hit-testing down the middle of the box never lands on an inert wrapper", async ({
    page,
  }) => {
    await open(page);
    const body = await rectOf(page, "composer-v2-body-host");
    const results = await page.evaluate((r) => {
      const out: string[] = [];
      for (const f of [0.03, 0.5, 0.9]) {
        const el = document.elementFromPoint(
          Math.round(r.left + r.width / 2),
          Math.round(r.top + r.height * f),
        );
        out.push(el === null ? "NULL" : el.closest(".ProseMirror") === null ? "INERT" : "EDITABLE");
      }
      return out;
    }, body);
    // Measured before: `EDITABLE` at 3%, `INERT` at 50% and 90%.
    expect(results).toEqual(["EDITABLE", "EDITABLE", "EDITABLE"]);
  });
});

test.describe("#2262 — the mobile-web keyboard", () => {
  test("T4-f: shrinking the VISUAL viewport keeps the bar on screen", async ({ page }) => {
    const viewport = page.viewportSize() as { height: number; width: number };
    test.skip(viewport.width >= 1024, "no soft keyboard on desktop");

    await open(page);
    const before = await rectOf(page, "composer-commit-bar");
    expect(before.height).toBeGreaterThan(40); // anchor

    // The keyboard, as the browser actually reports it. No mobile browser has
    // resized the CSS LAYOUT viewport for a soft keyboard since Chrome 108
    // matched Mobile Safari — it shrinks `visualViewport`, which
    // react-native-web's `Dimensions` already reads and subscribes to. This is
    // the signal the composer never consumed: RN-web's `Keyboard` is a no-op
    // stub on web, so `keyboardShrink` was permanently 0 and there was no
    // compensation at all.
    const keyboardHeight = 336;
    await page.evaluate((kb) => {
      const vv = window.visualViewport as unknown as {
        height: number;
        dispatchEvent: (e: Event) => boolean;
      };
      const reduced = window.innerHeight - kb;
      Object.defineProperty(window.visualViewport, "height", {
        configurable: true,
        get: () => reduced,
      });
      vv.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    }, keyboardHeight);

    await page.waitForTimeout(120);

    const after = await rectOf(page, "composer-commit-bar");
    const visibleHeight = await page.evaluate(() => window.visualViewport?.height ?? 0);

    // The signal really arrived (anchor), and the bar really rode it.
    expect(visibleHeight).toBeLessThan(viewport.height);
    expect(after.bottom).toBeLessThanOrEqual(visibleHeight + 0.5);
    // And the sacrifice was the writing area, never the commit control.
    expect(after.height).toBeGreaterThan(40);
  });

  test("T4-f2: the sheet is what gives — the body shrinks, the bar does not", async ({
    page,
  }) => {
    const viewport = page.viewportSize() as { height: number; width: number };
    test.skip(viewport.width >= 1024, "no soft keyboard on desktop");

    await open(page);
    const bodyBefore = await rectOf(page, "composer-v2-body-host");
    const barBefore = await rectOf(page, "composer-commit-bar");

    await page.evaluate(() => {
      const reduced = window.innerHeight - 336;
      Object.defineProperty(window.visualViewport, "height", {
        configurable: true,
        get: () => reduced,
      });
      window.visualViewport?.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(120);

    const bodyAfter = await rectOf(page, "composer-v2-body-host");
    const barAfter = await rectOf(page, "composer-commit-bar");

    // The universal rule: nothing is hidden. The operator is about to message
    // real people, so the correct sacrifice is writing area and the wrong one
    // is the commit control.
    expect(bodyAfter.height).toBeLessThan(bodyBefore.height);
    expect(Math.abs(barAfter.height - barBefore.height)).toBeLessThanOrEqual(1);
  });
});
