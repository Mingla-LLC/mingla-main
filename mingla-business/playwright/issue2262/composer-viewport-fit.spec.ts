/**
 * #2262 [composer-responsive-layout] — THE GEOMETRY GATE. The load-bearing suite.
 *
 * # REWORKED after the tester's P1-1 and P2-1
 *
 * The first version of this suite reported **64/64 green against a build that
 * pushed the commit bar 3183px off screen** at 320x568 with a 32-paragraph
 * draft. It could not fail for that, for two reasons, and both are fixed:
 *
 *   1. its harness never imported `ComposerCanvas`, the file that on any
 *      browser narrower than 1024px wrapped the whole column — commit bar
 *      included — in a `ScrollView`;
 *   2. it typed a one-line draft and never varied it, and both the defect and
 *      the fix hinge entirely on content height.
 *
 * So the axis that matters is now a parameter (1 / 4 / 8 / 32 paragraphs), the
 * Personalize panel is opened by clicking the REAL pill, the SMS channel runs
 * the REAL `SmsComposeCard`, and the scrim is a real `LinearGradient`.
 *
 * And there is a new assertion that does not depend on any of that being right:
 * **T4-scroll asserts directly, in the DOM, that the commit bar has no
 * scrollable ancestor.** That is DESIGN constraint 10.1 stated as a property
 * rather than as a shape, so it holds however the tree is built.
 *
 * REAL CLICKS ONLY. The investigation confirmed first that a synthetic
 * `MouseEvent` does not move focus, and discarded those results.
 *
 * RESIZE DISCIPLINE. Every viewport is a separate Playwright PROJECT with a
 * fresh page load, never a mid-test resize. CDP
 * `Emulation.setDeviceMetricsOverride` fires NEITHER `window.resize` NOR
 * `visualViewport.resize`, so react-native-web's `Dimensions` does not update
 * and a resized page reports a STALE layout.
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

/** The draft lengths that matter. 1 is the case the old suite typed. */
const DRAFT_LENGTHS = [1, 4, 8, 32] as const;

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
  // Tiptap mounts after the first onLayout; give the editable a beat to exist
  // so a draft's real height is in the tree before anything is measured.
  await page.waitForTimeout(150);
}

async function rectOf(page: Page, testId: string): Promise<Rect> {
  const rect = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.top, bottom: r.bottom, left: r.left,
      right: r.right, height: r.height, width: r.width,
    };
  }, testId);
  // VACUITY GUARD: fail LOUDLY and by name before any measurement claim.
  expect(rect, `#2262 VACUITY: [data-testid="${testId}"] resolved to null`).not.toBeNull();
  return rect as Rect;
}

async function proseMirrorRect(page: Page): Promise<Rect> {
  const rect = await page.evaluate(() => {
    const el = document.querySelector(".ProseMirror");
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.top, bottom: r.bottom, left: r.left,
      right: r.right, height: r.height, width: r.width,
    };
  });
  expect(rect, "#2262 VACUITY: .ProseMirror is not in the document").not.toBeNull();
  return rect as Rect;
}

test.describe("#2262 — the action row is always in view", () => {
  test("T4-g VACUITY: the harness mounted the REAL composer, canvas included", async ({
    page,
  }) => {
    await open(page);
    const bar = await rectOf(page, "composer-commit-bar");
    const body = await rectOf(page, "composer-v2-body-host");
    const region = await rectOf(page, "composer-flex-region");
    const pm = await proseMirrorRect(page);

    expect(bar.height).toBeGreaterThan(40);
    expect(body.height).toBeGreaterThan(40);
    expect(region.height).toBeGreaterThan(40);
    expect(pm.height).toBeGreaterThan(10);

    const topBar = await rectOf(page, "harness-top-bar");
    expect(topBar.height).toBeGreaterThanOrEqual(56);

    // #2262 P2-2 — the scrim is a REAL band with a REAL height. The old stub
    // dropped `style` and measured it at 0, making every number 24px optimistic.
    const scrim = await rectOf(page, "composer-commit-scrim");
    expect(scrim.height).toBeGreaterThanOrEqual(23.5);

    // #2262 P2-1 — the REAL `ComposerCanvas` is mounted. On wide desktop it
    // renders the editor pane; on narrow it takes its narrow branch. Either way
    // one of its own testIDs must be in the document, or this suite is once
    // again measuring a reconstruction.
    const viewport = page.viewportSize() as { width: number };
    if (viewport.width >= 1024) {
      await rectOf(page, "composer-canvas-editor-pane");
    } else {
      const canvasMarkerCount = await page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-testid="composer-canvas-narrow-web-scroll"], [data-testid="composer-canvas-narrow-web-host"]',
          ).length,
      );
      expect(
        canvasMarkerCount,
        "the real ComposerCanvas narrow branch did not render — the harness is a reconstruction again (P2-1)",
      ).toBeGreaterThan(0);
    }
  });

  /**
   * THE ASSERTION THAT WOULD HAVE CAUGHT P1-1 REGARDLESS OF HOW THE TREE IS
   * BUILT. DESIGN constraint 10.1, stated as a property: the commit bar may
   * never be inside a scroll container, on any surface.
   *
   * Walked in the DOM from the bar up to `<html>`, reading COMPUTED overflow —
   * so it cannot be satisfied by a style object that never reaches the browser,
   * and it does not care whether the scroll container is a `ScrollView`, an
   * `overflow:auto` View, or something invented later.
   */
  for (const paras of DRAFT_LENGTHS) {
    test(`T4-scroll: the commit bar has NO scrollable ancestor — ${paras} para(s)`, async ({
      page,
    }) => {
      await open(page, `?paras=${paras}`);
      const offenders = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="composer-commit-bar"]');
        if (bar === null) return ["VACUITY: no commit bar"];
        const out: string[] = [];
        let node: Element | null = bar.parentElement;
        while (node !== null && node !== document.documentElement) {
          const cs = getComputedStyle(node);
          const scrolls = [cs.overflow, cs.overflowY].some(
            (v) => v === "auto" || v === "scroll" || v === "overlay",
          );
          if (scrolls) {
            out.push(
              `${node.tagName.toLowerCase()}[${node.getAttribute("data-testid") ?? "-"}] overflowY=${cs.overflowY}`,
            );
          }
          node = node.parentElement;
        }
        return out;
      });
      expect(
        offenders,
        "the commit bar is inside a scroll container — DESIGN 10.1 (#2262 P1-1)",
      ).toEqual([]);
    });
  }

  for (const paras of DRAFT_LENGTHS) {
    for (const [name, query] of [
      ["email", ""],
      ["email, blocked caption", "&blocked=1"],
      ["email, scheduled", "&mode=scheduled"],
      ["sms", "&channel=sms"],
    ] as const) {
      test(`T4-a: the commit bar is inside the viewport — ${name}, ${paras} para(s)`, async ({
        page,
      }) => {
        await open(page, `?paras=${paras}${query}`);
        const bar = await rectOf(page, "composer-commit-bar");
        const viewport = page.viewportSize() as { height: number };

        // THE PROPERTY. On the pre-rework build this reads +57 at 4 paragraphs
        // and +2335 at 32 on a 390x750 phone browser, and +44 / +3183 at
        // 320x568. The baseline it replaced was a constant 89px — so for a long
        // draft the un-fixed change was WORSE than what it replaced.
        expect(bar.bottom).toBeLessThanOrEqual(viewport.height + 0.5);
        expect(bar.top).toBeGreaterThanOrEqual(0);
        expect(bar.height).toBeGreaterThan(40);
      });
    }
  }

  test("T4-a-panel: the REAL Personalize panel does not displace the bar", async ({
    page,
  }) => {
    await open(page);
    const before = await rectOf(page, "composer-v2-body-host");

    // Clicked, not spacered. The old harness substituted a fixed 212px block
    // mounted as a SIBLING of the sheet, which is not where the panel lives.
    await page.click('[data-testid="composer-v2-pill-personalize"]');
    await page.waitForTimeout(150);

    const panelCount = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="composer-v2-token-"]').length,
    );
    expect(panelCount, "the real Personalize panel did not open").toBeGreaterThan(0);

    const bar = await rectOf(page, "composer-commit-bar");
    const after = await rectOf(page, "composer-v2-body-host");
    const viewport = page.viewportSize() as { height: number };

    // The sheet is what gives; the bar is what holds.
    expect(after.height).toBeLessThan(before.height);
    expect(bar.bottom).toBeLessThanOrEqual(viewport.height + 0.5);
  });

  test("T4-a2: the page itself never scrolls — there is no recovery to fall back on", async ({
    page,
  }) => {
    await open(page, "?paras=32");
    const overflow = await page.evaluate(() => ({
      docScroll:
        document.documentElement.scrollHeight - document.documentElement.clientHeight,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }));
    // `body { overflow: hidden }` is what `ScrollViewStyleReset` emits.
    expect(overflow.bodyOverflow).toBe("hidden");
    expect(overflow.docScroll).toBeLessThanOrEqual(1);
  });

  for (const paras of DRAFT_LENGTHS) {
    test(`T4-b: the commit bar sits BELOW the message box — ${paras} para(s)`, async ({
      page,
    }) => {
      await open(page, `?paras=${paras}`);
      const bar = await rectOf(page, "composer-commit-bar");
      const body = await rectOf(page, "composer-v2-body-host");
      expect(bar.top).toBeGreaterThanOrEqual(body.bottom - 0.5);
    });
  }

  test("T4-c: SMS — no dead gap between the real card and the bar", async ({ page }) => {
    await open(page, "?channel=sms&paras=1");
    const bar = await rectOf(page, "composer-commit-bar");
    const sheet = await rectOf(page, "composer-v2-sheet");
    // RC-3's OPPOSITE failure, same container: 285px of dead gap on the SMS
    // channel at 1440x900, because the footer was pinned while the card was
    // short. Measured against the REAL `SmsComposeCard`, not a two-line fake.
    const gap = bar.top - sheet.bottom;
    expect(gap).toBeGreaterThanOrEqual(-0.5);
    expect(gap).toBeLessThanOrEqual(40);
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
    ["3% down", 0.03],
    ["the vertical CENTRE", 0.5],
    ["90% down", 0.9],
    ["98% down", 0.98],
  ] as const) {
    test(`T4-d: a real click at ${label} of the box lands ON the editable`, async ({
      page,
    }) => {
      await open(page);
      const body = await rectOf(page, "composer-v2-body-host");
      const x = Math.round(body.left + body.width / 2);
      const y = Math.round(body.top + body.height * fraction);

      // TIGHTENED after the tester's caveat. The old form asserted only that
      // focus ended up on `.ProseMirror` — which the wrapper click BACKSTOP
      // satisfies by calling `focus("end")` even when the click landed on an
      // inert wrapper. So at 90% down it passed on a REVERT of the CSS fix, and
      // was not proving what it claimed.
      //
      // Hit-test FIRST: the point must resolve inside `.ProseMirror`. That is
      // the property — the editable owns the box — and no backstop can rescue
      // it. The focus assertion then confirms the click did what it should.
      const hit = await page.evaluate(
        ({ px, py }) => {
          const el = document.elementFromPoint(px, py);
          return el === null
            ? "NULL"
            : el.closest(".ProseMirror") === null
              ? `INERT:${el.tagName.toLowerCase()}`
              : "EDITABLE";
        },
        { px: x, py: y },
      );
      expect(hit, `hit-test at ${label} did not land on the editable`).toBe("EDITABLE");

      // REAL click. A synthetic `MouseEvent` does NOT move focus.
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
          classes: active === null ? [] : Array.from(active.classList),
          editable: (active as HTMLElement | null)?.isContentEditable ?? false,
          selectionInside: anchorEl?.closest(".ProseMirror") !== null && anchorEl !== null,
        };
      });
      expect(focus.classes).toContain("ProseMirror");
      expect(focus.editable).toBe(true);
      expect(focus.selectionInside).toBe(true);
    });
  }

  test("T4-d2: typing after a centre click actually lands in the document", async ({
    page,
  }) => {
    await open(page);
    const body = await rectOf(page, "composer-v2-body-host");
    await page.mouse.click(
      Math.round(body.left + body.width / 2),
      Math.round(body.top + body.height * 0.5),
    );
    await page.keyboard.type("HARNESS_TYPED");
    const text = await page.evaluate(
      () => document.querySelector(".ProseMirror")?.textContent ?? "",
    );
    expect(text).toContain("HARNESS_TYPED");
  });

  test("T4-e2: hit-testing down the middle never lands on an inert wrapper", async ({
    page,
  }) => {
    await open(page);
    const body = await rectOf(page, "composer-v2-body-host");
    const results = await page.evaluate((r) => {
      const out: string[] = [];
      for (const f of [0.03, 0.25, 0.5, 0.75, 0.9, 0.98]) {
        const el = document.elementFromPoint(
          Math.round(r.left + r.width / 2),
          Math.round(r.top + r.height * f),
        );
        out.push(
          el === null ? "NULL" : el.closest(".ProseMirror") === null ? "INERT" : "EDITABLE",
        );
      }
      return out;
    }, body);
    // Measured before the fix: EDITABLE at 3%, INERT everywhere below.
    expect(results).toEqual([
      "EDITABLE", "EDITABLE", "EDITABLE", "EDITABLE", "EDITABLE", "EDITABLE",
    ]);
  });

  test("T4-e3: a long draft scrolls INSIDE the box instead of growing it", async ({
    page,
  }) => {
    await open(page, "?paras=32");
    const metrics = await page.evaluate(() => {
      const el = document.querySelector(".ProseMirror") as HTMLElement | null;
      if (el === null) return null;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    expect(metrics).not.toBeNull();
    const m = metrics as { scrollHeight: number; clientHeight: number };
    // The whole mechanism, in one assertion: 32 paragraphs of content inside a
    // bounded box. If the box grew instead, these would be equal — and the
    // commit bar would have travelled with it.
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);
  });
});

test.describe("#2262 — the mobile-web keyboard", () => {
  const shrinkViewport = async (page: Page, keyboard = 336): Promise<void> => {
    await page.evaluate((kb) => {
      const reduced = window.innerHeight - kb;
      Object.defineProperty(window.visualViewport, "height", {
        configurable: true,
        get: () => reduced,
      });
      window.visualViewport?.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    }, keyboard);
    await page.waitForTimeout(150);
  };

  for (const paras of [1, 8] as const) {
    test(`T4-f: shrinking the VISUAL viewport keeps the bar on screen — ${paras} para(s)`, async ({
      page,
    }) => {
      const viewport = page.viewportSize() as { height: number; width: number };
      test.skip(viewport.width >= 1024, "no soft keyboard on desktop");

      await open(page, `?paras=${paras}`);
      const before = await rectOf(page, "composer-commit-bar");
      expect(before.height).toBeGreaterThan(40); // anchor

      await shrinkViewport(page);

      const after = await rectOf(page, "composer-commit-bar");
      const visibleHeight = await page.evaluate(() => window.visualViewport?.height ?? 0);

      expect(visibleHeight).toBeLessThan(viewport.height);
      // Pre-rework this was +123px at 390x750 and +223px at 320x568 on a
      // ONE-LINE draft.
      expect(after.bottom).toBeLessThanOrEqual(visibleHeight + 0.5);
      expect(after.height).toBeGreaterThan(40);
    });
  }

  test("T4-f2: the sheet is what gives — the body shrinks, the bar does not", async ({
    page,
  }) => {
    const viewport = page.viewportSize() as { height: number; width: number };
    test.skip(viewport.width >= 1024, "no soft keyboard on desktop");

    await open(page);
    const bodyBefore = await rectOf(page, "composer-v2-body-host");
    const barBefore = await rectOf(page, "composer-commit-bar");

    await shrinkViewport(page);

    const bodyAfter = await rectOf(page, "composer-v2-body-host");
    const barAfter = await rectOf(page, "composer-commit-bar");

    // Nothing is hidden. The operator is about to message real people, so the
    // correct sacrifice is writing area and the wrong one is the commit control.
    expect(bodyAfter.height).toBeLessThan(bodyBefore.height);
    expect(Math.abs(barAfter.height - barBefore.height)).toBeLessThanOrEqual(1);
  });
});

/**
 * #2262 — THE SCHEDULE PATH, END TO END.
 *
 * Added after Seth reported on the Vercel preview that "the time picker does not
 * show up" on web. This is severe because #2262 made the mode chip the ONLY
 * route to scheduling — the old peer `Schedule` button is gone — so a picker
 * that does not appear makes scheduling unreachable on that surface.
 *
 * It is also the second time this harness was green against a live defect, and
 * the reason it should have caught this one: it mounts components directly, so
 * it can drive the composer AND the picker at real viewport sizes with NO
 * AUTHENTICATION. The authenticated composer route is unreachable headlessly,
 * which is exactly why the tester could not get here. This harness is the only
 * place this flow can be exercised, so it has to carry it.
 *
 * Every assertion below is about being VISIBLE AND CLICKABLE, never about being
 * mounted. A zero-rect or clipped element that exists in the DOM is precisely
 * the failure mode being chased, and `expect(locator).toBeVisible()` alone would
 * not distinguish it.
 */
test.describe("#2262 — scheduling is reachable from the chip", () => {
  const CONTINUE = '[aria-label="Continue to review"]';
  const TIME_PILL = '[aria-label^="Send time"]';

  async function openPicker(page: Page): Promise<void> {
    await open(page);
    await page.click('[data-testid="composer-commit-bar-mode-chip"]');
    await page.waitForTimeout(450); // the Sheet's open transition
  }

  /** Rect + real hit-test for an arbitrary selector. */
  async function rectAndHit(
    page: Page,
    selector: string,
  ): Promise<{ w: number; h: number; inViewport: boolean; hitTestable: boolean }> {
    const out = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0,
        hitTestable: hit !== null && (hit === el || el.contains(hit) || hit.contains(el)),
      };
    }, selector);
    expect(out, `#2262 VACUITY: "${selector}" is not in the document`).not.toBeNull();
    return out as { w: number; h: number; inViewport: boolean; hitTestable: boolean };
  }

  test("S-1: tapping the chip opens a picker that is VISIBLE and CLICKABLE, not merely mounted", async ({
    page,
  }) => {
    await openPicker(page);

    // A zero-rect element in the DOM is the failure being chased, so size,
    // viewport containment and a real hit-test are all asserted.
    const cont = await rectAndHit(page, CONTINUE);
    expect(cont.w).toBeGreaterThan(20);
    expect(cont.h).toBeGreaterThan(12);
    expect(cont.inViewport).toBe(true);
    expect(cont.hitTestable).toBe(true);

    const pill = await rectAndHit(page, TIME_PILL);
    expect(pill.w).toBeGreaterThan(40);
    expect(pill.inViewport).toBe(true);
    expect(pill.hitTestable).toBe(true);

    // And nothing in the composer's new band chain is clipping it. The bands
    // introduced `overflow:hidden`/`auto` ancestors, so this is the specific
    // regression the layout change could plausibly have caused.
    const clipped = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el === null) return "VACUITY";
      const r = el.getBoundingClientRect();
      let node: Element | null = el.parentElement;
      while (node !== null && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        if (cs.overflow === "hidden" || cs.overflowY === "hidden") {
          const nr = node.getBoundingClientRect();
          if (r.bottom > nr.bottom + 1 || r.top < nr.top - 1) {
            return `clipped by ${node.tagName.toLowerCase()}[${node.getAttribute("data-testid") ?? "-"}]`;
          }
        }
        node = node.parentElement;
      }
      return "";
    }, CONTINUE);
    expect(clipped).toBe("");
  });

  test("S-2: the hidden native date/time inputs are present and reachable by showPicker()", async ({
    page,
  }) => {
    // The picker's web variant drives BROWSER-NATIVE `<input type=date|time>`
    // behind visible pills. If those inputs are missing, or `showPicker()`
    // throws, the pills do nothing and the operator sees "no time picker" even
    // though the sheet itself rendered.
    await open(page);
    await page.evaluate(() => {
      (window as unknown as { __pick: unknown[] }).__pick = [];
      const proto = HTMLInputElement.prototype as unknown as {
        showPicker?: () => void;
      };
      const orig = proto.showPicker;
      if (typeof orig !== "function") return;
      proto.showPicker = function patched(this: HTMLInputElement): void {
        const log = (window as unknown as { __pick: unknown[] }).__pick;
        try {
          orig.call(this);
          log.push({ type: this.type, ok: true });
        } catch (e) {
          log.push({ type: this.type, ok: false, err: String(e) });
          throw e;
        }
      };
    });
    await page.click('[data-testid="composer-commit-bar-mode-chip"]');
    await page.waitForTimeout(450);

    const inputs = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('input[type="date"], input[type="time"]'),
      ).map((i) => {
        const cs = getComputedStyle(i);
        return { type: (i as HTMLInputElement).type, display: cs.display };
      }),
    );
    expect(inputs.map((i) => i.type).sort()).toEqual(["date", "time"]);
    // `display:none` would make showPicker() throw InvalidStateError outright.
    expect(inputs.every((i) => i.display !== "none")).toBe(true);

    await page.click(TIME_PILL);
    await page.waitForTimeout(250);
    const calls = (await page.evaluate(
      () => (window as unknown as { __pick: { ok: boolean }[] }).__pick,
    )) as { ok: boolean; type: string }[];
    expect(calls.length, "tapping the Time pill called no picker at all").toBeGreaterThan(0);
    expect(calls.every((c) => c.ok), `showPicker() threw: ${JSON.stringify(calls)}`).toBe(true);
  });

  test("S-3: choosing a time sets the chip and flips the primary to Schedule", async ({
    page,
  }) => {
    await openPicker(page);

    const textOf = async (id: string): Promise<string> =>
      (await page.evaluate(
        (t) => document.querySelector(`[data-testid="${t}"]`)?.textContent ?? "",
        id,
      )) as string;
    /**
     * The chip's state, as the DESIGN actually specifies it. Below `bpCompact`
     * (360) the chip is icon-only — clock + chevron, no label — and the chosen
     * time is carried by the `accessibilityLabel` and the accent fill, with
     * colour deliberately NOT the only indicator. So the a11y label is the
     * assertion that holds at EVERY width, and it is the stronger one: it is
     * what a screen-reader user actually receives. The text label is asserted
     * only where the design renders one.
     */
    const a11yOf = async (id: string): Promise<string> =>
      (await page.evaluate(
        (t) =>
          document.querySelector(`[data-testid="${t}"]`)?.getAttribute("aria-label") ?? "",
        id,
      )) as string;

    const viewport = page.viewportSize() as { width: number };
    const chipIsLabelled = viewport.width >= 360;

    expect(await a11yOf("composer-commit-bar-mode-chip")).toContain("now");
    if (chipIsLabelled) {
      expect(await textOf("composer-commit-bar-mode-chip")).toContain("Now");
    }
    expect(await textOf("composer-commit-bar-primary")).toContain("Send now");

    await page.click(CONTINUE);
    await page.waitForTimeout(600); // past the 350ms review defer

    // amendment 10.4 — the chip renders the chosen time, and the primary's
    // label reads the same state.
    const chipA11y = await a11yOf("composer-commit-bar-mode-chip");
    expect(chipA11y).toContain("Scheduled for");
    expect(chipA11y).not.toContain("Send timing: now");
    if (chipIsLabelled) {
      const chip = await textOf("composer-commit-bar-mode-chip");
      expect(chip).not.toContain("Now");
      expect(chip.length).toBeGreaterThan(2);
    }
    expect(await textOf("composer-commit-bar-primary")).toContain("Schedule");
  });

  test("S-4: backing out of the review sheet leaves the chip holding the time (10.4)", async ({
    page,
  }) => {
    await openPicker(page);
    await page.click(CONTINUE);
    await page.waitForTimeout(600);

    // The review sheet really opened — anchor, so the back-out below is real.
    await page.waitForSelector('[data-testid="harness-review-sheet"]', { timeout: 5000 });
    const readChip = async (): Promise<string> =>
      (await page.evaluate(() => {
        const el = document.querySelector('[data-testid="composer-commit-bar-mode-chip"]');
        // a11y label at every width — the chip is icon-only below bpCompact.
        return el?.getAttribute("aria-label") ?? "";
      })) as string;
    const before = await readChip();

    await page.click('[data-testid="harness-review-back"]');
    await page.waitForTimeout(300);

    const after = await readChip();

    // This is the one an implementor would naturally get wrong by storing the
    // ISO inside the review sheet: the chosen time is COMPOSER state and must
    // survive the review being dismissed.
    expect(after).toBe(before);
    expect(after).toContain("Scheduled for");
    expect(after).not.toContain("Send timing: now");
    const primary = (await page.evaluate(
      () =>
        document.querySelector('[data-testid="composer-commit-bar-primary"]')
          ?.textContent ?? "",
    )) as string;
    expect(primary).toContain("Schedule");
  });
});
