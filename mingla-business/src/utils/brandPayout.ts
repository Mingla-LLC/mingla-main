/**
 * Provider-neutral payout readiness (META-ORCH-1076 Phase 2 polish).
 *
 * A brand can take payments once its payout rail is connected — Stripe Connect
 * "active", OR a Paystack subaccount linked. The seller-facing "Connect bank to
 * sell tickets" tile / publish gates / to-dos all hide once this is true,
 * regardless of which rail the brand is on.
 */

import type { Brand, BrandStripeStatus } from "../types/brand";

type PayoutBrand = Pick<
  Brand,
  "stripeStatus" | "paymentProvider" | "paystackSubaccountCode"
>;

export function isBrandPayoutReady(
  brand: PayoutBrand | null | undefined,
): boolean {
  if (!brand) return false;
  if (brand.paymentProvider === "paystack") {
    return brand.paystackSubaccountCode != null;
  }
  return brand.stripeStatus === "active";
}

/**
 * Map a brand to the BrandStripeStatus the publish gates expect, treating a
 * connected Paystack brand as "active" so a single readiness check drives both
 * rails without changing each gate's signature.
 */
export function payoutGateStatus(
  brand: PayoutBrand | null | undefined,
): BrandStripeStatus {
  if (isBrandPayoutReady(brand)) return "active";
  return brand?.stripeStatus ?? "not_connected";
}
