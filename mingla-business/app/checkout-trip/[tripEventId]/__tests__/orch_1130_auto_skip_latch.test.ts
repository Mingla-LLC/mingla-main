/**
 * ORCH-1130 Fix #2 [trip-pay-structure] — single-tier auto-skip latch + gate.
 *
 * Root cause (INVESTIGATE_ORCH-1130 Issue #2): the auto-skip effect dispatched
 * setLineQuantity AND router.replace('/buyer') in the SAME synchronous body. On
 * a warm-cache 2nd entry the navigation raced the cart write; /buyer read an
 * empty cart, its pre-existing empty-cart guard bounced back to index, and the
 * auto-skip re-fired → "Maximum update depth exceeded" ping-pong.
 *
 * The fix moves the decision into `decideAutoSkip`, which (a) NEVER returns
 * "navigate" until the sole tier's line is actually present (qty>=1) — closing
 * the empty-cart window the buyer guard ping-ponged against — and (b) returns
 * "noop" once `alreadyNavigated` (the component's useRef latch) is set, so it
 * fires its navigation at most once per mount.
 *
 * These tests drive the decision through the exact warm-cache sequence and
 * assert: navigation is gated on the line landing, and the latch caps it at one.
 *
 * Fails-on-revert: delete the latch short-circuit (`if (input.alreadyNavigated)
 * return "noop";`) → after the latch is set the decision keeps returning
 * "navigate" → the "fires at most once" assertion sees 2+ navigations and fails.
 * Delete the gate (`return soleLine === undefined ? "addLine" : "navigate";`
 * → unconditional "navigate") → the empty-cart step returns "navigate" and the
 * "no navigation while empty" assertion fails.
 */

import { describe, expect, test } from "@jest/globals";

import {
  decideAutoSkip,
  type AutoSkipCartLine,
  type AutoSkipOutcome,
} from "../autoSkipDecision";

const SOLE_TIER = { id: "tier-1", isUnlimited: false, capacity: 10 };

/**
 * Simulate the full mount lifecycle the component drives: each effect run calls
 * decideAutoSkip; on "addLine" the cart write lands (line appears on the NEXT
 * commit); on "navigate" the latch flips. Returns the ordered outcome trace.
 */
function simulateMountLifecycle(maxCommits = 8): {
  outcomes: AutoSkipOutcome[];
  navigations: number;
  navigatedWhileEmpty: boolean;
} {
  let alreadyNavigated = false;
  let lines: AutoSkipCartLine[] = [];
  const outcomes: AutoSkipOutcome[] = [];
  let navigations = 0;
  let navigatedWhileEmpty = false;

  for (let commit = 0; commit < maxCommits; commit += 1) {
    const linesAtDecision = lines;
    const outcome = decideAutoSkip({
      alreadyNavigated,
      tripPresent: true,
      bookingsClosed: false,
      isPast: false,
      tiers: [SOLE_TIER],
      lines: linesAtDecision,
    });
    outcomes.push(outcome);

    if (outcome === "addLine") {
      // The dispatch lands on the next commit (mirrors the reducer update).
      lines = [{ ticketTypeId: SOLE_TIER.id, quantity: 1 }];
    } else if (outcome === "navigate") {
      navigations += 1;
      if (linesAtDecision.length === 0) navigatedWhileEmpty = true;
      // Component latch flips after it fires the replace.
      alreadyNavigated = true;
    }
    // "noop" — steady state; loop continues to prove no re-fire.
  }

  return { outcomes, navigations, navigatedWhileEmpty };
}

describe("ORCH-1130 Fix #2 — auto-skip latch + line-present gate", () => {
  test("navigation fires exactly once across the full mount lifecycle", () => {
    const { navigations } = simulateMountLifecycle();
    expect(navigations).toBe(1);
  });

  test("never navigates while the cart is still empty (gate)", () => {
    const { navigatedWhileEmpty } = simulateMountLifecycle();
    expect(navigatedWhileEmpty).toBe(false);
  });

  test("ordered outcomes: add the line first, then navigate, then steady noop", () => {
    const { outcomes } = simulateMountLifecycle();
    // First commit: empty cart → addLine (NOT navigate).
    expect(outcomes[0]).toBe("addLine");
    // Second commit: line landed → navigate exactly once.
    expect(outcomes[1]).toBe("navigate");
    // Every subsequent commit: latched → noop (no re-fire = no ping-pong).
    for (const o of outcomes.slice(2)) {
      expect(o).toBe("noop");
    }
  });

  test("warm-cache re-entry simulation: empty cart never yields navigate", () => {
    // Directly exercise the gate: trip present, single bookable tier, EMPTY cart,
    // not yet navigated — the old code navigated here (the bug). The gate must
    // return addLine, never navigate.
    const outcome = decideAutoSkip({
      alreadyNavigated: false,
      tripPresent: true,
      bookingsClosed: false,
      isPast: false,
      tiers: [SOLE_TIER],
      lines: [],
    });
    expect(outcome).toBe("addLine");
    expect(outcome).not.toBe("navigate");
  });

  test("latch short-circuits to noop even when the line is present", () => {
    const outcome = decideAutoSkip({
      alreadyNavigated: true,
      tripPresent: true,
      bookingsClosed: false,
      isPast: false,
      tiers: [SOLE_TIER],
      lines: [{ ticketTypeId: SOLE_TIER.id, quantity: 1 }],
    });
    expect(outcome).toBe("noop");
  });

  test("bookability guards still short-circuit before any nav (sold-out / past / closed / multi-tier)", () => {
    const base = {
      alreadyNavigated: false,
      tripPresent: true,
      bookingsClosed: false,
      isPast: false,
      tiers: [SOLE_TIER],
      lines: [] as AutoSkipCartLine[],
    };
    expect(decideAutoSkip({ ...base, bookingsClosed: true })).toBe("noop");
    expect(decideAutoSkip({ ...base, isPast: true })).toBe("noop");
    expect(
      decideAutoSkip({
        ...base,
        tiers: [{ id: "t", isUnlimited: false, capacity: 0 }],
      }),
    ).toBe("noop");
    expect(
      decideAutoSkip({
        ...base,
        tiers: [SOLE_TIER, { id: "t2", isUnlimited: false, capacity: 5 }],
      }),
    ).toBe("noop");
  });
});
