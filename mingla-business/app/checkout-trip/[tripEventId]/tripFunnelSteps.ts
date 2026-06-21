/**
 * ORCH-1178 [trip-checkout-always-cart-step] — pure helper for the trip
 * checkout funnel length, extracted so the step-counter wiring is unit-testable
 * without rendering the expo-router screens.
 *
 * Background (INVESTIGATE_ORCH-1178): the trip checkout ALWAYS shows the
 * cart/quantity step now (single AND multi tier — the ORCH-1130/1176 single-tier
 * auto-skip is removed). The visible sequence is therefore:
 *
 *   index (cart) → buyer (details) → [intake, only if the trip requires it] → payment
 *
 * so the funnel is 4 steps when an intake form is present, else 3. The intake
 * step itself renders its own inline "3 OF N" header; index/buyer/payment use
 * CheckoutHeader and derive their `totalSteps` from this helper (NEVER a literal
 * 2 — that was the ORCH-1176 collapse the always-cart-step supersedes).
 *
 * `stepIndex` is the 0-indexed position in that sequence:
 *   index = 0 ("1 OF N"), buyer = 1 ("2 OF N"),
 *   payment = N-1 (last; "3 OF 3" no-intake / "4 OF 4" with intake).
 */

/** Total visible steps: 4 with an intake form, 3 without. */
export function tripFunnelTotalSteps(hasIntake: boolean): 3 | 4 {
  return hasIntake ? 4 : 3;
}

/** 0-indexed payment step (the last step): N-1. */
export function tripPaymentStepIndex(hasIntake: boolean): 2 | 3 {
  return hasIntake ? 3 : 2;
}
