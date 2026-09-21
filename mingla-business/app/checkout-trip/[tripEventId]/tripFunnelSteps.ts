/**
 * ORCH-1178 [trip-checkout-always-cart-step] — pure helper for the trip
 * checkout funnel length, extracted so the step-counter wiring is unit-testable
 * without rendering the expo-router screens.
 *
 * Background (INVESTIGATE_ORCH-1178): the trip checkout ALWAYS shows the
 * cart/quantity step now (single AND multi tier — the ORCH-1130/1176 single-tier
 * auto-skip is removed). The visible sequence is therefore:
 *
 *   index (cart) → buyer (details) → [intake, only if the trip requires it] → [payment, only if the cart costs money]
 *
 * issue #3351 [free trip intake loop] — this arithmetic used to be `isFree`-blind
 * while the intake screen's own pill was `isFree`-aware, so a free trip with
 * questions told the buyer "2 OF 4" on the details step and "3 OF 3" on the very
 * next screen. A FREE cart never reaches the payment step, so the payment step is
 * not part of its funnel. The honest totals are:
 *
 *   | isFree | hasIntake | total | visible sequence              |
 *   |--------|-----------|-------|-------------------------------|
 *   | true   | false     |   2   | cart, details                 |
 *   | true   | true      |   3   | cart, details, intake         |
 *   | false  | false     |   3   | cart, details, payment        |
 *   | false  | true      |   4   | cart, details, intake, payment|
 *
 * i.e. `(isFree ? 2 : 3) + (hasIntake ? 1 : 0)`. The total is a function of
 * `{isFree, hasIntake}` ONLY — never of whether the questions are answered yet,
 * because a denominator that changes mid-flow is the confusion #3351 fixes, not
 * a feature. The shape is an OBJECT and not two positional booleans on purpose:
 * two same-typed booleans in one signature is exactly the call site that
 * silently returns the wrong count when an argument order slips, and there are
 * four call sites.
 *
 * The intake step renders its own inline "3 OF N" header (CheckoutHeader is
 * visually locked and cannot carry the subtitle that screen needs); index /
 * buyer / payment use CheckoutHeader and derive `totalSteps` from this helper
 * (NEVER a literal — not 2, not 3, not 4).
 *
 * `stepIndex` is the 0-indexed position in that sequence:
 *   index = 0 ("1 OF N"), buyer = 1 ("2 OF N"),
 *   payment = N-1 (last; "3 OF 3" no-intake / "4 OF 4" with intake).
 */

/** The two facts the visible step total depends on. */
export interface TripFunnelShape {
  isFree: boolean;
  hasIntake: boolean;
}

/** Total visible steps: `(isFree ? 2 : 3) + (hasIntake ? 1 : 0)`. */
export function tripFunnelTotalSteps(shape: TripFunnelShape): 2 | 3 | 4 {
  if (shape.isFree) return shape.hasIntake ? 3 : 2;
  return shape.hasIntake ? 4 : 3;
}

/**
 * 0-indexed payment step (the last step of a PAID funnel): N-1. A free cart
 * never reaches the payment step, so the free column exists only to keep this
 * helper total — it is the last index of the free funnel.
 */
export function tripPaymentStepIndex(shape: TripFunnelShape): 1 | 2 | 3 {
  if (shape.isFree) return shape.hasIntake ? 2 : 1;
  return shape.hasIntake ? 3 : 2;
}
