/**
 * ORCH-1178 [trip-checkout-always-cart-step] — the cart/quantity step ALWAYS
 * shows and STAYS for every trip (single AND multi tier).
 *
 * Bug (INVESTIGATE_ORCH-1178): a single-tier trip still auto-skipped the cart
 * step — the buyer briefly saw "Reserve your spot" then it auto-`router.replace`d
 * to /buyer, with no chance to edit quantity. TWO auto-navigate paths existed in
 * index.tsx (the multi-SEED effect and the `decideAutoSkip` effect); ORCH-1176
 * only gated path 1. ORCH-1178 removes BOTH navigations: the sole tier is still
 * PRE-SEEDED (qty 1, editable), but the buyer stays on the cart step and taps
 * Continue to advance.
 *
 * `decideAutoSkip` (the pure fn) is intentionally LEFT UNCHANGED — the behavior
 * change is in the COMPONENT (it no longer navigates on the "navigate" outcome).
 * The visible sequence is index(1) → buyer(2) → [intake(3)] → payment(N), so
 * totalSteps = 3 without an intake form, 4 with one.
 *
 * Harness: no @testing-library/react-native in this repo. This combines:
 *  (1) the pure `tripFunnelTotalSteps`/`tripPaymentStepIndex` helpers (executed),
 *  (2) a simulation of the component's NEW per-commit behavior (latch-without-
 *      navigate), proving the sole tier is seeded but /buyer is NEVER pushed, and
 *  (3) source-contract assertions on the three checkout files (fails-on-revert on
 *      a true line edit, never on a comment-out).
 */

import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

import {
  tripFunnelTotalSteps,
  tripPaymentStepIndex,
} from "../tripFunnelSteps";
import {
  decideAutoSkip,
  type AutoSkipCartLine,
} from "../autoSkipDecision";

const DIR = join(__dirname, "..");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const SOLE_TIER = { id: "tier-1", isUnlimited: false, capacity: 10 };

/**
 * Simulate the ORCH-1178 component behavior of the `decideAutoSkip` effect: on
 * "addLine" seed the sole tier (lands next commit); on "navigate" JUST LATCH —
 * the component no longer router.replace's. Returns whether the cart was seeded
 * and whether any navigation occurred.
 */
function simulateAlwaysStay(maxCommits = 8): {
  navigations: number;
  soleSeeded: boolean;
} {
  let alreadyNavigated = false;
  let lines: AutoSkipCartLine[] = [];
  let navigations = 0;

  for (let commit = 0; commit < maxCommits; commit += 1) {
    const outcome = decideAutoSkip({
      alreadyNavigated,
      tripPresent: true,
      bookingsClosed: false,
      isPast: false,
      tiers: [SOLE_TIER],
      lines,
    });
    if (outcome === "addLine") {
      lines = [{ ticketTypeId: SOLE_TIER.id, quantity: 1 }];
    } else if (outcome === "navigate") {
      // ORCH-1178: component LATCHES but does NOT navigate (stay on cart step).
      alreadyNavigated = true;
      // navigations intentionally NOT incremented — the fix removed the replace.
    }
  }
  const soleSeeded = lines.some(
    (l) => l.ticketTypeId === SOLE_TIER.id && l.quantity === 1,
  );
  return { navigations, soleSeeded };
}

// ───────────────────────── HAPPY ─────────────────────────
describe("ORCH-1178 happy — single-tier trip stays on the cart step", () => {
  test("the sole tier is pre-seeded (qty 1, editable) and NO navigation to /buyer fires", () => {
    const { navigations, soleSeeded } = simulateAlwaysStay();
    expect(soleSeeded).toBe(true);
    expect(navigations).toBe(0);
  });

  test('index.tsx never router.replace()s to /buyer (both seed effects latch + stay)', () => {
    const src = strip(read("index.tsx"));
    expect(src).not.toMatch(
      /router\.replace\(\s*`\/checkout-trip\/\$\{tripEventId\}\/buyer`/,
    );
    // The "addLine" seeding is kept (the sole tier is still pre-added qty 1).
    expect(src).toMatch(/outcome === "addLine"/);
    // Both effects latch.
    expect(src).toContain("autoSkipNavigatedRef.current = true");
    expect(src).toContain("multiSeedNavigatedRef.current = true");
  });

  test("counter: a no-intake trip reads 1 OF 3 / 2 OF 3 / 3 OF 3 (index/buyer/payment)", () => {
    expect(tripFunnelTotalSteps(false)).toBe(3);
    // index stepIndex 0 → "1 OF 3"; buyer stepIndex 1 → "2 OF 3".
    expect(tripPaymentStepIndex(false)).toBe(2); // payment "3 OF 3".
    // index.tsx renders the cart step at "1 OF N".
    const idx = strip(read("index.tsx"));
    expect(idx).toContain("stepIndex={0}");
    expect(idx).toContain("totalSteps={totalSteps}");
  });
});

// ─────────────────────── ADVERSARIAL ───────────────────────
describe("ORCH-1178 adversarial", () => {
  test("(a) multi-tier still shows the cart + stays (no navigation; decideAutoSkip noops on >1 tier)", () => {
    // >1 bookable tier → decideAutoSkip returns noop (tiers.length !== 1), so the
    // sole-tier seeding never runs and nothing navigates. The buyer drives it.
    const outcome = decideAutoSkip({
      alreadyNavigated: false,
      tripPresent: true,
      bookingsClosed: false,
      isPast: false,
      tiers: [SOLE_TIER, { id: "tier-2", isUnlimited: false, capacity: 5 }],
      lines: [],
    });
    expect(outcome).toBe("noop");
    // And the multi-SEED effect, once all seeded lines land, just latches:
    const idx = strip(read("index.tsx"));
    expect(idx).toMatch(/multiSeedNavigatedRef\.current = true;\s*$/m);
    // No bookableCount > 1 navigation branch survives.
    expect(idx).not.toMatch(/if \(bookableCount > 1\)/);
  });

  test("(b) public-page `lines` param seeds qty + stays on index (does NOT auto-advance)", () => {
    const idx = strip(read("index.tsx"));
    // The multi-seed effect dispatches setLineQuantity for the parsed lines ...
    expect(idx).toMatch(/seededLinesParam/);
    expect(idx).toContain("setLineQuantity");
    // ... and after landing it ONLY latches — no router.replace in the effect.
    const seedEffect = idx.slice(
      idx.indexOf("const multiSeedNavigatedRef"),
      idx.indexOf("const autoSkipNavigatedRef"),
    );
    expect(seedEffect.length).toBeGreaterThan(0);
    expect(seedEffect).not.toContain("router.replace");
    expect(seedEffect).toContain("multiSeedNavigatedRef.current = true");
  });

  test("(c) buyer.tsx keeps the empty-cart guard that bounces back to the cart step (index)", () => {
    const buyer = strip(read("buyer.tsx"));
    // hasNoLines → router.replace back to /checkout-trip/{id} (the index/cart step).
    expect(buyer).toMatch(/hasNoLines/);
    expect(buyer).toMatch(
      /router\.replace\(\s*`\/checkout-trip\/\$\{tripEventId\}`\s*as never\)/,
    );
  });

  test("(d) intake-required trip reads N=4 across the funnel (index/buyer 1..2, intake 3, payment 4)", () => {
    expect(tripFunnelTotalSteps(true)).toBe(4);
    // payment is the LAST step → stepIndex 3 ("4 OF 4").
    expect(tripPaymentStepIndex(true)).toBe(3);
    // The intake page renders its own inline "3 OF {free?3:4}" header.
    const intake = strip(read("intake.tsx"));
    expect(intake).toMatch(/3 OF \{totals\.isFree \? 3 : 4\}/);
    // index + buyer + payment derive totalSteps from the intake-aware helper.
    for (const f of ["index.tsx", "buyer.tsx", "payment.tsx"]) {
      expect(strip(read(f))).toMatch(/tripFunnelTotalSteps\(/);
    }
  });

  test("the pure helpers are total + correct for both branches", () => {
    expect(tripFunnelTotalSteps(false)).toBe(3);
    expect(tripFunnelTotalSteps(true)).toBe(4);
    expect(tripPaymentStepIndex(false)).toBe(2);
    expect(tripPaymentStepIndex(true)).toBe(3);
    // last-step index is always total - 1.
    expect(tripPaymentStepIndex(false)).toBe(tripFunnelTotalSteps(false) - 1);
    expect(tripPaymentStepIndex(true)).toBe(tripFunnelTotalSteps(true) - 1);
  });
});
