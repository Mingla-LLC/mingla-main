/**
 * #2099 §D6 — the GEOMETRY gate.
 *
 * This is the only #2099 check with a layout engine, and it exists because the
 * independent tester found, at runtime, that the correction dialog rendered a
 * 1646 px card inside an 800 px viewport with no scroll container in sixteen
 * ancestors and `body { overflow: hidden }`. `Review correction` sat at
 * y=1155 — correctly implemented, correctly enabled, and reachable by neither
 * pointer nor keyboard. `window.scrollTo`, `scrollIntoView`, `scrollTop` on
 * every ancestor and `focus()` all left it there.
 *
 * Check H could not see any of it: `react-test-renderer` has no viewport, no
 * scroll and no bounding boxes, so every prior #2099 assertion about this
 * dialog was about PRESENCE and none about REACHABILITY. Coverage was
 * exhaustive over one axis and empty over the other, and the empty axis was
 * invisible precisely because the first was so thorough.
 *
 * Every assertion below is therefore a MEASUREMENT — a real box in a real
 * viewport — never a query for a node's existence.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

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
 * A deliberately TALL variant, and it is load-bearing rather than decorative.
 *
 * The realistic fixture above is four meaningful lanes plus 54 empty ones, and
 * P2-1's collapse now renders it in six rows — so the card fits, and a
 * reachability assertion made against it would pass even with the scroll
 * container ripped out. Content that overflows is the only condition under
 * which "can the operator reach the primary action" means anything, so the
 * geometry cases drive a preview whose lanes are all NON-ZERO and therefore
 * survive the collapse.
 */
const TALL_PREVIEW = {
  ...PREVIEW,
  dependency_counts: Array.from({ length: 40 }, (_unused, index) => ({
    safe_label: `checked_area_${index}`,
    count: index + 1,
    classification: "allowed_baseline",
  })),
};

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
 * The measurement the tester made. Returns the nearest ancestor that can
 * actually scroll, walking to <body> exactly as the tester's probe did.
 */
async function nearestScroller(page: Page, testId: string): Promise<{
  found: boolean;
  bounded: boolean;
  ancestorsWalked: number;
  overflowY: string;
  clientHeight: number;
  scrollHeight: number;
}> {
  return page.evaluate((id) => {
    let node: HTMLElement | null = document.querySelector<HTMLElement>(
      `[data-testid="${id}"]`,
    );
    let walked = 0;
    while (node !== null && node !== document.body) {
      const style = globalThis.getComputedStyle(node);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return {
          found: true,
          // BOUNDED is the load-bearing half. `overflow: auto` on a box that
          // grows with its content scrolls nothing; the defect was a card that
          // simply got taller than the viewport.
          bounded: node.clientHeight <= globalThis.innerHeight + 1,
          ancestorsWalked: walked,
          overflowY: style.overflowY,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
        };
      }
      node = node.parentElement;
      walked += 1;
    }
    return {
      found: false,
      bounded: false,
      ancestorsWalked: walked,
      overflowY: "none",
      clientHeight: 0,
      scrollHeight: 0,
    };
  }, testId);
}

test("P1-A: the primary action is REACHABLE, not merely present", async ({ page }, testInfo) => {
  await openDialog(page, TALL_PREVIEW);
  await fillProposal(page);

  const review = page.getByRole("button", { name: "Review the proposed venue correction" });

  // 1 — a real scroll container must exist between the action and <body>.
  const scroller = await nearestScroller(page, "issue-2099-correction-scroll");
  expect(
    scroller.found,
    `no scrollable ancestor found (${scroller.ancestorsWalked} walked to <body>) — ` +
      "the card grows unbounded and the page behind it does not scroll",
  ).toBe(true);
  expect(
    scroller.bounded,
    `the scroll container is ${scroller.clientHeight}px tall in a viewport of ` +
      "its own height — it grows with its content instead of scrolling",
  ).toBe(true);

  // 2 — the action must be brought fully inside the viewport, and STAY there.
  await review.scrollIntoViewIfNeeded();
  const box = await review.boundingBox();
  expect(box, "the review action has no layout box").not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(
    box!.y,
    `top of "Review correction" is above the fold at ${testInfo.project.name}`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    box!.y + box!.height,
    `bottom of "Review correction" is below the fold at ${testInfo.project.name} ` +
      `(viewport ${viewport!.height}px)`,
  ).toBeLessThanOrEqual(viewport!.height);

  // 3 — and it must be genuinely operable, not just visible.
  await expect(review).toBeEnabled();
  await review.click();
  await expect(page.getByTestId("issue-2099-review")).toBeVisible();
});

test("P1-A: the `stay` category is reachable — the binding case of this issue", async ({
  page,
}, testInfo) => {
  await openDialog(page, TALL_PREVIEW);
  await fillProposal(page);

  // The tester measured `stay` at y=-110 (desktop) and y=-45 (mobile web):
  // off the TOP of the viewport, with nothing able to bring it back.
  const stay = page.getByTestId("issue-2099-category-stay");
  await stay.scrollIntoViewIfNeeded();
  const box = await stay.boundingBox();
  expect(box, "the stay option has no layout box").not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.y, `"stay" is off the top at ${testInfo.project.name}`).toBeGreaterThanOrEqual(0);
  expect(
    box!.y + box!.height,
    `"stay" is below the fold at ${testInfo.project.name}`,
  ).toBeLessThanOrEqual(viewport.height);

  await stay.click();
  // RN-web does not project `accessibilityState.checked` onto `aria-checked`
  // for a plain Pressable, so assert the rendered selection cue instead — which
  // is also the cue an operator actually sees (colour is never the only one).
  await expect(stay).toContainText("✓");
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
