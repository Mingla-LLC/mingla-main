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
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  innerHeight: number;
  innerWidth: number;
  targetFound: boolean;
  hostContainsTarget: boolean;
  insideViewport: boolean;
  insideHostVisibleBox: boolean;
  targetTop: number;
  targetBottom: number;
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
      clientHeight: 0,
      scrollHeight: 0,
      scrollTop: 0,
      innerHeight,
      innerWidth,
      targetFound: target !== null,
      hostContainsTarget: false,
      insideViewport: false,
      insideHostVisibleBox: false,
      targetTop: 0,
      targetBottom: 0,
    };
    if (target === null) return empty;

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

    if (host === null) {
      return {
        ...empty,
        targetFound: true,
        ancestorsWalked: walked,
        insideViewport,
        targetTop: rect.top,
        targetBottom: rect.bottom,
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

    return {
      hostFound: true,
      ancestorsWalked: walked,
      overflowY: globalThis.getComputedStyle(host).overflowY,
      clientHeight: host.clientHeight,
      scrollHeight: host.scrollHeight,
      scrollTop: host.scrollTop,
      innerHeight,
      innerWidth,
      targetFound: true,
      hostContainsTarget: host.contains(target),
      insideViewport,
      insideHostVisibleBox,
      targetTop: rect.top,
      targetBottom: rect.bottom,
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

test.beforeAll(() => {
  // The harness cannot pass by measuring nothing: if globalSetup did not
  // produce a bundle, every spec below fails before it renders anything.
  if (!existsSync(BUNDLE)) {
    throw new Error(`issue-2099: harness bundle missing at ${BUNDLE}`);
  }
});

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
    const after = await measure(page, selector);
    expect.soft(
      after.insideViewport,
      `${where}: clause 2(a) — after scrollIntoViewIfNeeded the target is not ` +
        `inside the viewport (top=${after.targetTop}, bottom=${after.targetBottom}, ` +
        `innerHeight=${after.innerHeight})`,
    ).toBe(true);
    expect.soft(
      after.insideHostVisibleBox,
      `${where}: clause 2(a) — the target is not inside the host's VISIBLE box; ` +
        "a bounded scroller that is itself off screen hides its contents just as " +
        "completely as no scroller at all",
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
