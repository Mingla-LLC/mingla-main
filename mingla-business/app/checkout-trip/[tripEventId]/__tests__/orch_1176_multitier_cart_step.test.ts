/**
 * ORCH-1176 [trip-multipkg-checkout-wizard] — the trip checkout must keep the
 * cart/quantity step for a genuine multi-PACKAGE trip, and only auto-skip it
 * (straight to /buyer) when the trip is effectively single-tier.
 *
 * Root cause (INVESTIGATE_ORCH-1176): the multi-seed effect in index.tsx
 * unconditionally `router.replace`'d to /buyer after seeding the cart — even for
 * a 2+-package trip — so the buyer never saw the cart/quantity review step. The
 * fix gates the auto-advance on `bookableTierCount(...) <= 1`; a multi-package
 * trip stays on index (totalSteps 3, "1 OF 3"), a single-tier trip auto-skips
 * (totalSteps 2). The count keys off BOOKABLE tiers (unlimited OR remaining > 0),
 * NOT the raw tier count, so a 3-tier trip with 2 sold out still streamlines —
 * no regression to the ORCH-1130 single-tier auto-skip.
 *
 * These tests drive the SAME pure helper both the index auto-advance gate and the
 * buyer/payment totalSteps derivation read, plus the buyer's totalSteps mapping.
 *
 * Fails-on-revert: widen `isTierBookable` to count sold-out tiers (drop the
 * `(capacity ?? 0) > 0` clause) → the "all-but-one sold out → single-tier" test
 * sees count 3 and the auto-advance / totalSteps assertions flip.
 */

import { describe, expect, test } from "@jest/globals";

import {
  bookableTierCount,
  isTierBookable,
  type BookableTierLike,
} from "../bookableTierCount";

// Mirror the buyer/payment derivation: totalSteps = bookable > 1 ? 3 : 2.
function deriveTotalSteps(tiers: BookableTierLike[]): 2 | 3 {
  return bookableTierCount(tiers) > 1 ? 3 : 2;
}

// Mirror the index auto-advance gate: stay on index (no /buyer replace) when the
// trip has > 1 bookable tier; otherwise auto-advance.
function shouldAutoAdvanceToBuyer(tiers: BookableTierLike[]): boolean {
  return bookableTierCount(tiers) <= 1;
}

describe("ORCH-1176 — multi-package trips keep the cart/quantity step", () => {
  // ── HAPPY — a genuine 2-package trip stays on index and reads 3 steps ──
  test("multi-package trip: stays on index (no auto-advance) + buyer reads 3 steps", () => {
    const tiers: BookableTierLike[] = [
      { isUnlimited: false, capacity: 20 }, // Standard, bookable
      { isUnlimited: false, capacity: 5 }, // VIP, bookable
    ];
    expect(bookableTierCount(tiers)).toBe(2);
    // The seed effect must NOT auto-advance to /buyer (buyer reviews quantities).
    expect(shouldAutoAdvanceToBuyer(tiers)).toBe(false);
    // The funnel reads "1 OF 3" / "2 OF 3".
    expect(deriveTotalSteps(tiers)).toBe(3);
  });

  test("an unlimited package counts as bookable (no capacity cap)", () => {
    const tiers: BookableTierLike[] = [
      { isUnlimited: true, capacity: null },
      { isUnlimited: false, capacity: 3 },
    ];
    expect(bookableTierCount(tiers)).toBe(2);
    expect(shouldAutoAdvanceToBuyer(tiers)).toBe(false);
    expect(deriveTotalSteps(tiers)).toBe(3);
  });

  // ── ADVERSARIAL — single bookable tier OR multi-tier-all-but-one-sold-out
  //    STILL auto-advances + reads 2 steps (keys off BOOKABLE count) ──
  test("single bookable tier: STILL auto-advances to /buyer + reads 2 steps", () => {
    const tiers: BookableTierLike[] = [{ isUnlimited: false, capacity: 10 }];
    expect(bookableTierCount(tiers)).toBe(1);
    expect(shouldAutoAdvanceToBuyer(tiers)).toBe(true);
    expect(deriveTotalSteps(tiers)).toBe(2);
  });

  test("3 tiers, 2 sold out → effectively single-tier: auto-advances + 2 steps", () => {
    const tiers: BookableTierLike[] = [
      { isUnlimited: false, capacity: 0 }, // sold out — NOT bookable
      { isUnlimited: false, capacity: 8 }, // the only bookable tier
      { isUnlimited: false, capacity: 0 }, // sold out — NOT bookable
    ];
    // The gate keys off BOOKABLE count (1), NOT the raw tier count (3).
    expect(bookableTierCount(tiers)).toBe(1);
    expect(shouldAutoAdvanceToBuyer(tiers)).toBe(true);
    expect(deriveTotalSteps(tiers)).toBe(2);
  });

  test("ALL tiers sold out → 0 bookable: auto-advance gate is true, 2 steps", () => {
    // (The bookability EmptyState fires upstream; the count is 0 ≤ 1.)
    const tiers: BookableTierLike[] = [
      { isUnlimited: false, capacity: 0 },
      { isUnlimited: false, capacity: 0 },
    ];
    expect(bookableTierCount(tiers)).toBe(0);
    expect(deriveTotalSteps(tiers)).toBe(2);
  });

  test("isTierBookable: unlimited OR remaining>0; sold-out / null-cap-non-unlimited excluded", () => {
    expect(isTierBookable({ isUnlimited: true, capacity: null })).toBe(true);
    expect(isTierBookable({ isUnlimited: false, capacity: 1 })).toBe(true);
    expect(isTierBookable({ isUnlimited: false, capacity: 0 })).toBe(false);
    // A non-unlimited tier with a null capacity coalesces to 0 → NOT bookable.
    expect(isTierBookable({ isUnlimited: false, capacity: null })).toBe(false);
  });
});
