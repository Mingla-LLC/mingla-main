/**
 * ORCH-1335 / #3645 — provider-aware chip-in charge readiness.
 * TS mirror of pg_brand_can_collect (Stripe charges_enabled / active, Paystack
 * subaccount, or stamped hold-rail). Positive readiness NEVER derives from the
 * stale brands.stripe_* cache alone for Stripe: the rail requires the FRESH
 * `useBrandStripeStatus` hook status === "active". Undefined/loading status →
 * NOT ready (no false-positive).
 */
import type { Brand, BrandStripeStatus } from "../types/brand";
import { isBrandChargeReady } from "./brandPayout";

export function isChipInPayoutReady(
  brand:
    | Pick<
        Brand,
        | "paymentProvider"
        | "paystackSubaccountCode"
        | "payoutHoldCutoverAt"
      >
    | null
    | undefined,
  freshStripeStatus: BrandStripeStatus | null | undefined,
): boolean {
  if (brand == null) return false;
  return isBrandChargeReady({
    paymentProvider: brand.paymentProvider,
    paystackSubaccountCode: brand.paystackSubaccountCode,
    payoutHoldCutoverAt: brand.payoutHoldCutoverAt ?? null,
    stripeStatus: freshStripeStatus,
  });
}
