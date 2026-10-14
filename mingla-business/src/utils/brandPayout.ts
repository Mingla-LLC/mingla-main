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

/**
 * #3645 — true for a brand on the Nigerian rail that can already take paid
 * sales but has no bank yet: it sells now and its money waits. Used to pick
 * truthful copy; a card-rail brand, and a Nigerian brand that already has a
 * bank, are both false.
 */
export function brandSellsBeforeBank(
  brand: PayoutBrand | null | undefined,
): boolean {
  if (!brand || brand.paymentProvider !== "paystack") return false;
  return isBrandChargeReady(brand) && !isBrandPayoutReady(brand);
}

/**
 * #3645 — the same question for the brand-creation Payouts step, answered from
 * the payout country the organiser has JUST picked there.
 *
 * Picking Nigeria is confirmed by the server before the step is told about it,
 * and from that moment the brand sells before it has a bank. The brand object
 * the step holds does not carry the server's stamp yet, so asking
 * `brandSellsBeforeBank(brand)` alone kept showing "connect a bank before
 * collecting money" to a host who could already sell (seen live, 2026-10-14).
 * The country just picked therefore decides:
 *  - Nigeria picked: sells before bank, unless a bank is already connected;
 *  - any other country picked: does not, even if the brand object still reads
 *    as Nigerian for a moment;
 *  - nothing picked in this session: the saved brand decides, as before.
 */
export function payoutStepSellsBeforeBank(
  pickedRail: { provider: string } | null | undefined,
  brand: PayoutBrand | null | undefined,
): boolean {
  if (pickedRail == null) return brandSellsBeforeBank(brand);
  if (pickedRail.provider !== "paystack") return false;
  return !isBrandPayoutReady({ ...(brand ?? {}), paymentProvider: "paystack" });
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
