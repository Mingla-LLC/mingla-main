/**
 * ORCH-1335 — provider-aware chip-in payout readiness.
 * TS mirror of pg_brand_can_collect (Stripe active OR Paystack subaccount).
 * Positive readiness NEVER derives from the stale brands.stripe_* cache: the
 * Stripe rail requires the FRESH `useBrandStripeStatus` hook status === "active".
 * Undefined/loading status → NOT ready (no false-positive).
 */
import type { Brand, BrandStripeStatus } from "../types/brand";

export function isChipInPayoutReady(
  brand: Pick<Brand, "paymentProvider" | "paystackSubaccountCode"> | null | undefined,
  freshStripeStatus: BrandStripeStatus | null | undefined,
): boolean {
  if (brand == null) return false;
  // Paystack (NGN) rail: mirror `paystack_subaccount_code IS NOT NULL`.
  if (brand.paymentProvider === "paystack") {
    return (
      typeof brand.paystackSubaccountCode === "string" &&
      brand.paystackSubaccountCode.trim().length > 0
    );
  }
  // Stripe rail (default provider): require FRESH confirmed active.
  return freshStripeStatus === "active";
}
