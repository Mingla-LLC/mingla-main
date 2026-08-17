/**
 * #2099 §D6 — the GEOMETRY gate, and SC-10 (Amendment 14 §P8).
 *
 * This is the only #2099 check with a layout engine, and it exists because the
 * independent tester found, at runtime, that the correction dialog rendered a
 * 1646 px card inside an 800 px viewport with no scroll container in sixteen
 * ancestors and `body { overflow: hidden }`. `Review correction` sat at
 * y=1155 — correctly implemented, correctly enabled, and reachable by neither
 * pointer nor keyboard.
 *
 * Check H could not see any of it: `react-test-renderer` has no viewport, no
 * scroll and no bounding boxes, so every prior #2099 assertion about this
 * dialog was about PRESENCE and none about REACHABILITY.
 *
 * SC-10 is what stops THIS gate from going blind in turn. A reachability
 * assertion on content that fits proves nothing, and two routes defeat a naive
 * version of it: reordering the tall block so all three targets land inside a
 * centred card's visible band, and letting one project's precondition be
 * measured against the other project's viewport. §P8's four clauses are
 * implemented literally below — per project, against that project's own host
 * and its own content, with every asserted target proven inside the overflowed
 * region rather than merely on a page that overflows somewhere.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

// Resolved from the config's rootDir rather than `import.meta.url`: an
// `import.meta` reference makes Playwright load this file as ESM, and its own
// transpiled CJS helpers then fail with `require is not defined`.
const BUSINESS_ROOT = process.cwd();
const HERE = join(BUSINESS_ROOT, "playwright/issue2099");
const HARNESS_URL = `file://${join(HERE, "index.html")}`;
const BUNDLE = resolve(
  BUSINESS_ROOT,
  "node_modules/.cache/issue2099-harness/business-entry.js",
);

const PREVIEW = {
  ok: true,
  eligible: true,
  code: null,
  venue_id: "20990000-0000-0000-0000-000000000020",
  brand_id: "20990000-0000-0000-0000-000000000003",
  place_pool_id: "20990000-0000-0000-0000-000000000010",
  current: {
    name: "The Cluster Fuck",
    slug: "theclusterfuck",
    category: "play",
    updated_at: "2026-08-17T00:00:00.000Z",
  },
  schema_fingerprint: "harness-schema-fingerprint",
  state_fingerprint: "harness-state-fingerprint",
  dependency_counts: [
    { safe_label: "required_hours", count: 7, classification: "allowed_baseline" },
    { safe_label: "required_pipeline", count: 1, classification: "allowed_baseline" },
    { safe_label: "required_availability", count: 1, classification: "allowed_baseline" },
    {
      safe_label: "required_reservation_settings",
      count: 1,
      classification: "allowed_baseline",
    },
    ...Array.from({ length: 54 }, () => ({
      safe_label: "dependency",
      count: 0,
      classification: "disallowed",
    })),
  ],
};

/**
 * SC-10 clause 4 — the fixture, unchanged.
 *
 * At least 40 dependency lanes, ALL NON-ZERO, so the P2-1 empty-lane collapse
 * cannot absorb them. This is deliberately a magic number that rots LOUDLY:
 * shrink the content by any route — the collapse, a row-height reduction, a
 * capped or virtualised lane list, a nested scroller inside the dependency
 * block — and clause 1(c) reds by name rather than the gate silently measuring
 * a card that fits.
 */
const TALL_PREVIEW = {
  ...PREVIEW,
  dependency_counts: Array.from({ length: 40 }, (_unused, index) => ({
    safe_label: `checked_area_${index}`,
    count: index + 1,
    classification: "allowed_baseline",
  })),
};

/** §P8's three asserted targets, by the selector each one really renders. */
const TARGET = {
  stay: '[data-testid="issue-2099-category-stay"]',
  review: '[aria-label="Review the proposed venue correction"]',
  confirm: '[aria-label="Correct pending venue"]',
} as const;

interface HostMeasurement {
  hostFound: boolean;
  ancestorsWalked: number;
  overflowY: string;
  overflowX: string;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  innerHeight: number;
  innerWidth: number;
  targetFound: boolean;
  hostContainsTarget: boolean;
  insideViewport: boolean;
  insideHostVisibleBox: boolean;
  targetTop: number;
  targetBottom: number;
  targetLeft: number;
  targetRight: number;
  targetWidth: number;
  targetHeight: number;
  /**
   * Product of every `opacity` AND every `filter: opacity()` from the target up
   * to `<body>`. Both, because they are separate computed properties and either
   * one alone renders the target invisible.
   */
  effectiveOpacity: number;
  /** Every non-`none` ancestor filter, for the failure message. */
  filterChain: string;
  visibility: string;
  display: string;
  /** The target clips its OWN content — this is what renders "Review correctio". */
  selfClipped: boolean;
  text: string;
}

/**
 * One measurement pass. The scroll host is the NEAREST scrollable ancestor of
 * the asserted target, walked to `<body>` exactly as the shipped
 * `nearestScroller()` walks it — starting at the target itself, so the
 * definition is the same one the rest of this gate uses.
 *
 * The host VISIBLE BOX is the intersection of the host's rect with the viewport
 * rect, which is what makes clause 2(a) able to see a bounded scroller that has
 * itself been pushed off screen inside an unbounded card.
 */
async function measure(page: Page, selector: string): Promise<HostMeasurement> {
  return page.evaluate((sel) => {
    const target = document.querySelector<HTMLElement>(sel);
    const innerHeight = globalThis.innerHeight;
    const innerWidth = globalThis.innerWidth;
    const empty: HostMeasurement = {
      hostFound: false,
      ancestorsWalked: 0,
      overflowY: "none",
      overflowX: "none",
      clientHeight: 0,
      scrollHeight: 0,
      scrollTop: 0,
      scrollLeft: 0,
      clientWidth: 0,
      scrollWidth: 0,
      innerHeight,
      innerWidth,
      targetFound: target !== null,
      hostContainsTarget: false,
      insideViewport: false,
      insideHostVisibleBox: false,
      targetTop: 0,
      targetBottom: 0,
      targetLeft: 0,
      targetRight: 0,
      targetWidth: 0,
      targetHeight: 0,
      effectiveOpacity: 0,
      filterChain: "",
      visibility: "hidden",
      display: "none",
      selfClipped: false,
      text: "",
    };
    if (target === null) return empty;

    // VISUAL presence, not layout presence. `opacity: 0` leaves a perfectly
    // sized, perfectly positioned, perfectly "visible"-to-Playwright box that
    // no operator can see — it greened all ten cases of this gate before this
    // was measured. Opacity is multiplicative up the tree, so it must be
    // accumulated rather than read off the target.
    let opacityNode: HTMLElement | null = target;
    let effectiveOpacity = 1;
    let filterChain = "";
    while (opacityNode !== null && opacityNode !== document.documentElement) {
      const os = globalThis.getComputedStyle(opacityNode);
      const parsed = Number.parseFloat(os.opacity);
      effectiveOpacity *= Number.isFinite(parsed) ? parsed : 1;
      // `filter` is a SEPARATE computed property, and `filter: opacity(0)`
      // composites the element AND its whole subtree at alpha 0 — a rendered
      // label inside it is invisible. Reading only `opacity` left that route
      // open: it greened all ten cases with the primary action not on screen at
      // all. Accumulate every `opacity()` function in every ancestor's filter.
      if (os.filter !== "none" && os.filter !== "") {
        filterChain = filterChain === "" ? os.filter : `${filterChain} | ${os.filter}`;
        for (const fn of os.filter.matchAll(/opacity\(\s*([0-9.]+)(%?)\s*\)/g)) {
          const raw = Number.parseFloat(fn[1] ?? "1");
          const value = fn[2] === "%" ? raw / 100 : raw;
          effectiveOpacity *= Number.isFinite(value) ? value : 1;
        }
      }
      if (os.visibility === "hidden" || os.visibility === "collapse") effectiveOpacity = 0;
      if (os.display === "none") effectiveOpacity = 0;
      opacityNode = opacityNode.parentElement;
    }
    const targetStyle = globalThis.getComputedStyle(target);
    // Self-clipping: the node's own content is wider than the box it renders in
    // on an axis it does not let the user scroll. This is the "Review correctio"
    // signature, and it is invisible to any containment check.
    const clipsOwnContent =
      target.scrollWidth > target.clientWidth + 1 &&
      (targetStyle.overflowX === "hidden" || targetStyle.overflowX === "clip");

    let node: HTMLElement | null = target;
    let walked = 0;
    let host: HTMLElement | null = null;
    while (node !== null && node !== document.body) {
      const style = globalThis.getComputedStyle(node);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        host = node;
        break;
      }
      node = node.parentElement;
      walked += 1;
    }

    const rect = target.getBoundingClientRect();
    const insideViewport =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= innerHeight &&
      rect.right <= innerWidth;

    const presence = {
      targetFound: true,
      targetTop: rect.top,
      targetBottom: rect.bottom,
      targetLeft: rect.left,
      targetRight: rect.right,
      targetWidth: rect.width,
      targetHeight: rect.height,
      effectiveOpacity,
      filterChain,
      visibility: targetStyle.visibility,
      display: targetStyle.display,
      selfClipped: clipsOwnContent,
      text: (target.textContent ?? "").trim(),
    };

    if (host === null) {
      return {
        ...empty,
        ...presence,
        ancestorsWalked: walked,
        insideViewport,
      };
    }

    const hostRect = host.getBoundingClientRect();
    // The host's VISIBLE box: its rect intersected with the viewport.
    const visTop = Math.max(hostRect.top, 0);
    const visBottom = Math.min(hostRect.bottom, innerHeight);
    const visLeft = Math.max(hostRect.left, 0);
    const visRight = Math.min(hostRect.right, innerWidth);
    const insideHostVisibleBox =
      visBottom > visTop &&
      visRight > visLeft &&
      rect.top >= visTop - 1 &&
      rect.bottom <= visBottom + 1 &&
      rect.left >= visLeft - 1 &&
      rect.right <= visRight + 1;

    const hostStyle = globalThis.getComputedStyle(host);
    return {
      ...presence,
      hostFound: true,
      ancestorsWalked: walked,
      overflowY: hostStyle.overflowY,
      overflowX: hostStyle.overflowX,
      clientHeight: host.clientHeight,
      scrollHeight: host.scrollHeight,
      scrollTop: host.scrollTop,
      scrollLeft: host.scrollLeft,
      clientWidth: host.clientWidth,
      scrollWidth: host.scrollWidth,
      innerHeight,
      innerWidth,
      hostContainsTarget: host.contains(target),
      insideViewport,
      insideHostVisibleBox,
    };
  }, selector);
}

/** Drive the host of a given target to an absolute scrollTop. */
async function setHostScrollTop(
  page: Page,
  selector: string,
  position: number | "end",
): Promise<void> {
  await page.evaluate(
    ({ sel, pos }) => {
      const target = document.querySelector<HTMLElement>(sel);
      if (target === null) return;
      let node: HTMLElement | null = target;
      while (node !== null && node !== document.body) {
        const style = globalThis.getComputedStyle(node);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          node.scrollTop = pos === "end" ? node.scrollHeight - node.clientHeight : pos;
          return;
        }
        node = node.parentElement;
      }
    },
    { sel: selector, pos: position },
  );
}

/**
 * Undo any scroll on an axis the user cannot scroll.
 *
 * `scrollIntoViewIfNeeded()` will happily set `scrollLeft` on a box whose
 * computed `overflow-x` is `hidden` — the browser permits it programmatically,
 * a wheel or a swipe does not. Measuring after that scroll is measuring a state
 * the operator can never be in: the retest found `scrollLeft` moving 3 -> 18 and
 * turning a clipped button into a passing one, with a real gesture snapping it
 * straight back. So: scroll into view the way the gate always did, then RESET
 * every denied axis before anything is measured. The check must never satisfy a
 * reachability clause with a movement the user is not allowed to make.
 */
async function resetDeniedAxes(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const target = document.querySelector<HTMLElement>(sel);
    if (target === null) return;
    let node: HTMLElement | null = target;
    while (node !== null && node !== document.documentElement) {
      const style = globalThis.getComputedStyle(node);
      const scrollableX = style.overflowX === "auto" || style.overflowX === "scroll";
      const scrollableY = style.overflowY === "auto" || style.overflowY === "scroll";
      if (!scrollableX && node.scrollLeft !== 0) node.scrollLeft = 0;
      if (!scrollableY && node.scrollTop !== 0) node.scrollTop = 0;
      node = node.parentElement;
    }
    if (!globalThis.getComputedStyle(document.body).overflowX.match(/auto|scroll/)) {
      globalThis.scrollTo(0, globalThis.scrollY);
    }
  }, selector);
}

/**
 * VISUAL presence — asserted for every target, in both branches of clause 2.
 * A target that is laid out, sized, positioned and inside every box, but
 * invisible or clipped, is not reachable in any sense an operator recognises.
 */
function assertVisiblyPresent(m: HostMeasurement, where: string): void {
  expect.soft(
    m.effectiveOpacity > 0,
    `${where}: the target is laid out but NOT VISIBLE ` +
      `(effective opacity ${m.effectiveOpacity}, visibility ${m.visibility}, ` +
      `display ${m.display}, filters "${m.filterChain}") — presence in the ` +
      "layout is not reachability",
  ).toBe(true);
  expect.soft(
    m.targetWidth > 0 && m.targetHeight > 0,
    `${where}: the target has a zero-area box (${m.targetWidth}x${m.targetHeight})`,
  ).toBe(true);
  expect.soft(
    !m.selfClipped,
    `${where}: the target CLIPS ITS OWN CONTENT on an axis the user cannot ` +
      "scroll — this is the shape that renders a truncated label, and no " +
      `containment check can see it. Rendered text: "${m.text}"`,
  ).toBe(true);
}

test.beforeAll(() => {
  // The harness cannot pass by measuring nothing: if globalSetup did not
  // produce a bundle, every spec below fails before it renders anything.
  if (!existsSync(BUNDLE)) {
    throw new Error(`issue-2099: harness bundle missing at ${BUNDLE}`);
  }
});

/**
 * P4-1 — wait for the entry animation to SETTLE before anything is measured.
 *
 * The shared `Modal` fades in over 0.16s, and a measurement taken mid-fade reads
 * `effectiveOpacity: 0` on an element that is genuinely on its way to visible.
 * That flake is in the SAFE direction — a false RED, never a false PASS — and
 * the tempting repair is to soften the opacity assertion. That would trade a
 * harmless flake for a real blind spot, which is the trade this whole thread
 * exists to refuse. So the fix is here, in the wait: settle first, assert at
 * full strength afterwards.
 */
async function waitForVisualSettle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const host = document.querySelector<HTMLElement>(
        '[data-testid="issue-2099-correction-dialog"]',
      );
      if (host === null) return false;
      // Every running transition/animation inside the dialog must be finished.
      const getAnimations = (
        host as unknown as { getAnimations?: (o: { subtree: boolean }) => Animation[] }
      ).getAnimations;
      if (typeof getAnimations === "function") {
        const running = getAnimations
          .call(host, { subtree: true })
          .filter((a) => a.playState === "running");
        if (running.length > 0) return false;
      }
      // And the accumulated alpha must have reached full strength.
      let node: HTMLElement | null = host;
      let alpha = 1;
      while (node !== null && node !== document.documentElement) {
        const style = globalThis.getComputedStyle(node);
        const parsed = Number.parseFloat(style.opacity);
        alpha *= Number.isFinite(parsed) ? parsed : 1;
        node = node.parentElement;
      }
      return alpha >= 0.999;
    },
    undefined,
    { timeout: 5000 },
  );
}

async function openDialog(
  page: Page,
  preview: typeof PREVIEW = PREVIEW,
): Promise<void> {
  await page.addInitScript((injected) => {
    (globalThis as unknown as { __issue2099: unknown }).__issue2099 = {
      previewCalls: 0,
      correctCalls: 0,
      preview: injected,
      correctResult: { ok: true, audit_id: "harness-audit" },
    };
  }, preview);
  await page.goto(HARNESS_URL);
  await expect(page.getByTestId("issue-2099-correction-dialog")).toBeVisible();
  await waitForVisualSettle(page);
  // Vacuity guard: the REAL dialog rendered its own content, not an empty shell.
  await expect(page.getByTestId("issue-2099-current-identity")).toContainText(
    "theclusterfuck",
  );
}

/** Fill the form so the primary action is enabled and the card is at full height. */
async function fillProposal(page: Page): Promise<void> {
  // The house `Input` puts its testID on the wrapper; the editable node is the
  // <input> inside it.
  const field = (id: string) => page.getByTestId(id).locator("input");
  await field("issue-2099-name").fill("Ramble Away Resort");
  await field("issue-2099-slug").fill("rambleawayresort");
  await field("issue-2099-reason").fill("Correcting an unused pending identity");
}

/**
 * SC-10 CLAUSE 1 — the overflow precondition, asserted against THIS project's
 * own host and THIS project's own content.
 *
 * SOFT, deliberately. §P8 orders clause 1 "before any reachability assertion"
 * and a failing precondition must fail the project — both hold either way. But
 * a hard `expect` would abort on clause 1 and hide whether clauses 2 and 3 do
 * independent work on the same mutation, which is exactly the question the
 * blinding routes exist to answer. Soft assertions keep the ordering, keep the
 * failure, and report every clause a mutation actually breaks.
 *
 * `390x844` is one of the two cases that must hold, never the measurement
 * condition for the other: every number below comes from the page currently
 * rendered in this project's viewport. If the precondition does not hold, the
 * project FAILS — it may never pass by measuring content that fits.
 */
async function assertClause1(
  page: Page,
  project: string,
  selector: string,
  label: string,
): Promise<HostMeasurement> {
  const m = await measure(page, selector);
  const where = `[${project}] ${label}`;
  expect.soft(m.targetFound, `${where}: the asserted target is not rendered`).toBe(true);
  expect.soft(
    m.hostFound,
    `${where}: clause 1(a) — no scrollable host between the target and <body> ` +
      `(${m.ancestorsWalked} ancestors walked)`,
  ).toBe(true);
  expect.soft(
    m.clientHeight <= m.innerHeight + 1,
    `${where}: clause 1(b) — the host is NOT bounded by this project's viewport ` +
      `(clientHeight=${m.clientHeight}, innerHeight=${m.innerHeight})`,
  ).toBe(true);
  expect.soft(
    m.scrollHeight > m.clientHeight,
    `${where}: clause 1(c) — the host's content does NOT overflow it ` +
      `(scrollHeight=${m.scrollHeight}, clientHeight=${m.clientHeight}, ` +
      `innerHeight=${m.innerHeight}) — this gate would be measuring content that fits`,
  ).toBe(true);
  return m;
}

/**
 * SC-10 CLAUSE 2 — the target must be proven inside the OVERFLOWED REGION, not
 * merely on a page that overflows somewhere.
 *
 * Exactly one of:
 *   (a) descendant of the host AND, after `scrollIntoViewIfNeeded()`, fully
 *       inside BOTH the viewport AND the host's visible box; or
 *   (b) NOT a descendant of the host AND fully inside the viewport at
 *       `scrollTop = 0` AND at `scrollTop = scrollHeight - clientHeight` — a
 *       genuinely pinned affordance no scroll position can hide.
 *
 * Returns whether this target REQUIRED the host to scroll, which clause 3 uses.
 */
async function assertClause2(
  page: Page,
  project: string,
  selector: string,
  label: string,
  locator: Locator,
): Promise<boolean> {
  const where = `[${project}] ${label}`;

  await setHostScrollTop(page, selector, 0);
  const atTop = await measure(page, selector);

  if (atTop.hostFound && atTop.hostContainsTarget) {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 4000 });
    } catch {
      expect
        .soft(false, `${where}: clause 2(a) — the target could not be scrolled into view`)
        .toBe(true);
      return false;
    }
    await resetDeniedAxes(page, selector);
    const after = await measure(page, selector);
    assertVisiblyPresent(after, where);
    expect.soft(
      after.insideViewport,
      `${where}: clause 2(a) — after scrollIntoViewIfNeeded the target is not ` +
        `inside the viewport (top=${after.targetTop}, bottom=${after.targetBottom}, ` +
        `innerHeight=${after.innerHeight})`,
    ).toBe(true);
    expect.soft(
      after.insideHostVisibleBox,
      `${where}: clause 2(a) — the target is not inside the host's VISIBLE box ` +
        `(target ${after.targetLeft}..${after.targetRight} x ` +
        `${after.targetTop}..${after.targetBottom}; host content box ` +
        `${after.clientWidth}x${after.clientHeight}, scroll extent ` +
        `${after.scrollWidth}x${after.scrollHeight}, overflow-x ${after.overflowX}); ` +
        "a bounded scroller that is itself off screen — or one that clips an axis " +
        "the user cannot scroll — hides its contents as completely as no scroller",
    ).toBe(true);
    expect.soft(
      after.scrollWidth <= after.clientWidth + 1 ||
        after.overflowX === "auto" ||
        after.overflowX === "scroll",
      `${where}: the scroll host overflows HORIZONTALLY on an axis it renders ` +
        `\`overflow-x: ${after.overflowX}\` (clientWidth ${after.clientWidth}, ` +
        `scrollWidth ${after.scrollWidth}) — the excess is not scrollable, it is CLIPPED`,
    ).toBe(true);
    return !atTop.insideHostVisibleBox && after.scrollTop > 0;
  }

  // Clause 2(b): pinned outside the scroller. It must be visible at BOTH scroll
  // extremes, which is what distinguishes a real sticky affordance from a
  // target that merely happens to be on screen right now.
  await setHostScrollTop(page, TARGET.stay, 0);
  const pinnedTop = await measure(page, selector);
  await setHostScrollTop(page, TARGET.stay, "end");
  const pinnedEnd = await measure(page, selector);
  assertVisiblyPresent(pinnedEnd, where);
  expect.soft(
    pinnedTop.insideViewport && pinnedEnd.insideViewport,
    `${where}: satisfies NEITHER clause 2(a) (not a descendant of the host) ` +
      `NOR clause 2(b) (not visible at both scroll extremes: top=` +
      `${String(pinnedTop.insideViewport)}, end=${String(pinnedEnd.insideViewport)})`,
  ).toBe(true);
  return false;
}

test.describe("SC-10 — the reachability gate cannot go blind", () => {
  test("clauses 1-4, per project, against this project's own host and content", async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name;
    await openDialog(page, TALL_PREVIEW);
    await fillProposal(page);

    // ---- EDIT step: `stay` and the review action ----------------------------
    await assertClause1(page, project, TARGET.stay, "edit step");

    const requiredScroll: boolean[] = [];
    requiredScroll.push(
      await assertClause2(
        page,
        project,
        TARGET.stay,
        "issue-2099-category-stay",
        page.getByTestId("issue-2099-category-stay"),
      ),
    );
    requiredScroll.push(
      await assertClause2(
        page,
        project,
        TARGET.review,
        "Review the proposed venue correction",
        page.getByRole("button", { name: "Review the proposed venue correction" }),
      ),
    );

    // ---- CLAUSE 3: scrolling must be NECESSARY in the edit step -------------
    expect.soft(
      requiredScroll.some(Boolean),
      `[${project}] clause 3 — no asserted target required the host to scroll: ` +
        "the fixture no longer forces any asserted target out of view and this " +
        "gate is measuring nothing",
    ).toBe(true);

    // ---- REVIEW step: the confirm action ------------------------------------
    const review = page.getByRole("button", {
      name: "Review the proposed venue correction",
    });
    await review.scrollIntoViewIfNeeded();
    await review.click();
    await expect(page.getByTestId("issue-2099-review")).toBeVisible();

    await assertClause1(page, project, TARGET.confirm, "review step");
    const confirmScrolled = await assertClause2(
      page,
      project,
      TARGET.confirm,
      "Correct pending venue",
      page.getByRole("button", { name: "Correct pending venue" }),
    );
    expect.soft(
      confirmScrolled,
      `[${project}] clause 3 (review step) — the confirm action did not require ` +
        "the host to scroll; the review step is no longer overflowing",
    ).toBe(true);
  });

  test("clause 4 — the fixture supplies >= 40 all-non-zero lanes", () => {
    // Stated as an assertion rather than a comment so a future edit that guts
    // the fixture reds here instead of silently weakening every clause above.
    expect(TALL_PREVIEW.dependency_counts.length).toBeGreaterThanOrEqual(40);
    expect(
      TALL_PREVIEW.dependency_counts.every((lane) => lane.count > 0),
      "clause 4 — a zero-count lane would be absorbed by the P2-1 collapse",
    ).toBe(true);
  });
});

test("P1-A: an owner can complete the correction end to end", async ({ page }) => {
  await openDialog(page, TALL_PREVIEW);
  await fillProposal(page);

  const review = page.getByRole("button", { name: "Review the proposed venue correction" });
  await review.scrollIntoViewIfNeeded();
  await review.click();

  const confirm = page.getByRole("button", { name: "Correct pending venue" });
  await confirm.scrollIntoViewIfNeeded();
  const box = await confirm.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

  await confirm.click();
  await expect
    .poll(async () =>
      page.evaluate(
        () => (globalThis as unknown as { __issue2099: { correctCalls: number } }).__issue2099.correctCalls,
      ),
    )
    .toBe(1);
});

test("P2-2: the dialog surface is opaque", async ({ page }) => {
  await openDialog(page);
  const alpha = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(
      '[data-testid="issue-2099-correction-scroll"]',
    );
    if (host === null) return null;
    const bg = globalThis.getComputedStyle(host).backgroundColor;
    const match = /rgba?\(([^)]+)\)/.exec(bg);
    if (match === null) return null;
    const parts = match[1]!.split(",").map((v) => Number(v.trim()));
    return parts.length === 4 ? parts[3]! : 1;
  });
  expect(alpha, "the correction form has no opaque surface of its own").toBe(1);
});

test("P2-1: the dependency review is readable, not 58 identical zero rows", async ({
  page,
}) => {
  await openDialog(page);
  await fillProposal(page);
  const review = page.getByRole("button", { name: "Review the proposed venue correction" });
  await review.scrollIntoViewIfNeeded();
  await review.click();

  const block = page.getByTestId("issue-2099-dependency-counts");
  await expect(block).toBeVisible();
  // The four meaningful lanes are shown; the rest are summarised, never hidden.
  await expect(block).toContainText("required_hours: 7");
  await expect(block).toContainText("required_pipeline: 1");
  await expect(page.getByTestId("issue-2099-dependency-empty")).toContainText(
    "54 other checked areas are empty.",
  );
  const rows = await block.evaluate((node) => node.querySelectorAll("div").length);
  expect(rows, "the dependency review is dumping every zero lane").toBeLessThanOrEqual(12);
});
