/**
 * Idempotency-Key generator for Stripe API calls.
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.2.1 + D-B2-22.
 *
 * Format: `${brand_id}:${operation}:${epoch_ns}`
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
  | "onboard_reactivate_session" // AccountSession.create after local reactivation
  | "refresh_status" // accounts.retrieve refetch
  | "webhook_account_retrieve" // webhook remediation refresh
  | "detach_account" // accounts.del best-effort detach
  | "balance_retrieve" // connected account balance retrieve
  | "kyc_account_retrieve" // KYC reminder cron account refresh
  | "kyc_account_link"; // KYC reminder resume link

export function generateIdempotencyKey(
  brandId: string,
  operation: StripeOperation,
): string {
  if (!brandId || brandId.trim().length === 0) {
    throw new Error("generateIdempotencyKey: brandId required");
  }
  const epochNs = BigInt(Date.now()) * 1_000_000n +
    BigInt(Math.floor(performance.now() * 1_000_000) % 1_000_000);
  return `${brandId}:${operation}:${epochNs.toString()}`;
}
