/**
 * Provider-neutral charge vs payout readiness (#3645).
 *
 * Charge-ready: brand can publish/sell paid supply (Stripe charges_enabled, or
 * Paystack hold cutover / subaccount). Money may wait until a bank exists.
 * Payout-ready: brand can receive releases (Stripe payouts_enabled, or Paystack
 * subaccount / recipient).
 */

import type { Brand, BrandStripeStatus } from "../types/brand";

type PayoutBrand = {
  stripeStatus?: Brand["stripeStatus"] | null;
  paymentProvider?: Brand["paymentProvider"];
  paystackSubaccountCode?: Brand["paystackSubaccountCode"] | null;
  /** Optional: brands.payout_hold_cutover_at (NG hold rail). */
  payoutHoldCutoverAt?: string | null;
  /** Optional: active brand_paystack_recipients row exists. */
  hasPaystackRecipient?: boolean | null;
  /**
   * Optional Stripe live/cache flags. When present, payout readiness uses
   * payoutsEnabled (charge readiness still uses active / chargesEnabled).
   * Absent → fall back to stripeStatus alone.
   */
  chargesEnabled?: boolean | null;
  payoutsEnabled?: boolean | null;
};

/** Can publish and take paid sales (bank may still be missing). */
export function isBrandChargeReady(
  brand: PayoutBrand | null | undefined,
): boolean {
  if (!brand) return false;
  if (brand.paymentProvider === "paystack") {
    if (
      typeof brand.paystackSubaccountCode === "string" &&
      brand.paystackSubaccountCode.trim().length > 0
    ) {
      return true;
    }
    if (brand.payoutHoldCutoverAt != null && brand.payoutHoldCutoverAt !== "") {
      return true;
    }
    return false;
  }
  if (brand.chargesEnabled === true) return true;
  if (brand.chargesEnabled === false) return false;
  return brand.stripeStatus === "active";
}

/** Can receive organiser payouts (bank / recipient connected). */
export function isBrandPayoutReady(
  brand: PayoutBrand | null | undefined,
): boolean {
  if (!brand) return false;
  if (brand.paymentProvider === "paystack") {
    if (brand.hasPaystackRecipient === true) return true;
    return (
      typeof brand.paystackSubaccountCode === "string" &&
      brand.paystackSubaccountCode.trim().length > 0
    );
  }
  if (brand.payoutsEnabled === true) return true;
  if (brand.payoutsEnabled === false) return false;
  // Without a live payouts_enabled flag, active is the best available proxy
  // (deriveBrandStripeStatus already treats charges-only as active).
  return brand.stripeStatus === "active";
}

/**
 * Map a brand to the BrandStripeStatus publish gates expect for *selling*.
 * Paystack hold-without-subaccount is treated as "active" for charge gates.
 */
export function payoutGateStatus(
  brand: PayoutBrand | null | undefined,
): BrandStripeStatus {
  if (isBrandChargeReady(brand)) return "active";
  return brand?.stripeStatus ?? "not_connected";
}
