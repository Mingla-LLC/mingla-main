/**
 * ORCH-1176 [trip-multipkg-checkout-wizard] — pure helper counting a trip's
 * BOOKABLE pricing tiers, extracted so the multi-tier gate is unit-testable
 * without rendering the expo-router screens.
 *
 * Background (INVESTIGATE_ORCH-1176): the trip checkout index unconditionally
 * `router.replace`'d to /buyer after seeding the cart — even for genuine
 * multi-package trips — skipping the cart/quantity review step. The auto-skip
 * is only correct when the trip is effectively SINGLE-tier; a multi-package
 * trip must stay on index so the buyer can review/edit quantities.
 *
 * "Bookable" mirrors the capacity logic already used across the checkout files:
 * a tier is bookable when it is unlimited OR has remaining capacity > 0. A
 * sold-out tier (capacity 0) does NOT count — so a 3-tier trip with 2 tiers
 * sold out is effectively single-tier and STILL streamlines (no regression to
 * the ORCH-1130 single-tier auto-skip). The count keys off BOOKABLE tiers, not
 * the raw tier count.
 */

export interface BookableTierLike {
  /** True when the tier sells without a capacity cap. */
  isUnlimited: boolean;
  /**
   * Remaining bookable capacity. Null → unlimited/unknown (treated as bookable,
   * mirroring `tierToTicketStub` / the QuantityRow "+" cap logic).
   */
  capacity: number | null;
}

/** Is this tier still bookable (unlimited or has remaining capacity)? */
export function isTierBookable(tier: BookableTierLike): boolean {
  return tier.isUnlimited || (tier.capacity ?? 0) > 0;
}

/**
 * Count the trip's bookable tiers. The checkout wizard shows the cart/quantity
 * step (totalSteps 3, stay on index) when this is > 1, and auto-skips straight
 * to /buyer (totalSteps 2) when it is <= 1.
 */
export function bookableTierCount(tiers: ReadonlyArray<BookableTierLike>): number {
  return tiers.reduce((n, t) => (isTierBookable(t) ? n + 1 : n), 0);
}
