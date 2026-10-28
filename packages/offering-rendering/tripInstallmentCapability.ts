/**
 * Provider-capability semantics for trip installment plans.
 *
 * Product-facing callers consume only the boolean capability and the bounded
 * refusal code. Provider names must never leak into Host or buyer copy.
 * Unknown values fail closed; persisted brand rows are normalized to their
 * effective provider before they reach this helper.
 */

export const TRIP_INSTALLMENT_CAPABILITY_UNAVAILABLE =
  "installment_capability_unavailable" as const;

export type TripPaymentPlanChoice = "auto" | "full" | "installments";

export interface TripTierMetadataRow {
  tier_metadata?: unknown;
}

/**
 * Stripe-only static hint retained for backward compatibility. New authoring
 * code must use the server capability RPC because readiness is rollout-gated.
 */
export function tripInstallmentsSupported(effectiveProvider: unknown): boolean {
  return (
    typeof effectiveProvider === "string" &&
    effectiveProvider.trim().toLowerCase() === "stripe"
  );
}

/**
 * Public-reader capability decoder. Only an explicit server `true` may expose a
 * saved schedule. Missing fields from an older server, malformed values, and an
 * explicit refusal all fail closed without revealing the provider identity.
 */
export function publicTripInstallmentsAvailable(capability: unknown): boolean {
  return capability === true;
}

/**
 * Remove a stale public schedule unless the canonical reader explicitly enabled
 * it. This is generic so both native and web adapters retain their local schedule
 * types while sharing the rolling-deploy rule.
 */
export function publicTripInstallmentSchedule<T>(
  capability: unknown,
  schedule: T | null | undefined,
): T | null {
  return publicTripInstallmentsAvailable(capability) && schedule !== undefined
    ? schedule
    : null;
}

/** True only for a structurally present installment template. */
export function hasTripInstallmentTemplate(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== "object") return false;
  const installments = (metadata as { installments?: unknown }).installments;
  return (
    installments !== null &&
    typeof installments === "object" &&
    !Array.isArray(installments)
  );
}

/**
 * Whether the selected checkout would use a saved installment schedule.
 * `full` is always safe. `auto` remains supported for old clients but is
 * capability-gated whenever one of the selected tiers carries a plan.
 */
export function checkoutSelectionUsesTripInstallments(
  choice: TripPaymentPlanChoice,
  rows: readonly TripTierMetadataRow[],
): boolean {
  return (
    choice !== "full" &&
    rows.some((row) => hasTripInstallmentTemplate(row.tier_metadata))
  );
}
