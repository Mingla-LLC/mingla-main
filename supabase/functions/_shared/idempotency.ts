/**
 * Idempotency-Key generator for Stripe API calls.
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.2.1 + D-B2-22.
 *
 * Format: `${brand_id}:${operation}:${epoch_ms}`
 *
 * Stripe uses Idempotency-Key for safe retry: identical key on a logically-
 * identical retry of the same call returns the cached response instead of
 * creating a duplicate (e.g., second call to accounts.create for the same
 * brand returns the existing account, not a new one).
 *
 * Epoch is included to scope idempotency to the calling request (avoids
 * accidental dedup of a legitimate second call days later for the same
 * operation).
 */

export type StripeOperation =
  | "onboard_create" // First-time stripe_connect_accounts.create
  | "onboard_session" // AccountSession.create for embedded onboarding
  | "refresh_status"; // accounts.retrieve refetch

export function generateIdempotencyKey(
  brandId: string,
  operation: StripeOperation,
): string {
  if (!brandId || brandId.trim().length === 0) {
    throw new Error("generateIdempotencyKey: brandId required");
  }
  const epochMs = Math.floor(Date.now());
  return `${brandId}:${operation}:${epochMs}`;
}
