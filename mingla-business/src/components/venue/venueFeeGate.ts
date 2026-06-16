/**
 * META-ORCH-1148 sub-ORCH 2.0 — paid-fee readiness gate (UI-level fail-close).
 *
 * The ORCH-1073/1075 publish-time integrity rule, mirrored at the venue
 * reservation-fee toggle: a brand may NOT enable a PAID reservation fee unless
 * its payout rail is ready (Stripe charges enabled OR a Paystack subaccount is
 * connected). Pure function so it is fails-on-revert testable
 * (I-PROPOSED-1148-PAID-FEE-REQUIRES-CHARGES-ENABLED).
 *
 * 2.0 enforces this in the UI ONLY — there is no charge path in 2.0, and the
 * genuine server-side `stripe_account_not_ready` fail-close RPC is 2.1/2.2. When
 * the fee toggle is blocked, the Settings UI shows the SAME "finish your payout
 * setup" copy + route as the checkout 409 (reusing `paidPublishGuards`).
 */

export interface BrandPayoutReadiness {
  /** From brand.stripeStatus === "active" (charges enabled). */
  stripeChargesEnabled: boolean;
  /** From a non-null brand.paystackSubaccountCode (Nigeria rail). */
  hasPaystackSubaccount: boolean;
}

/**
 * True iff the brand can settle money on SOME rail → a paid fee may be enabled.
 * FREE fees are always allowed (this gate only governs the PAID path).
 */
export function canEnablePaidReservationFee(
  readiness: BrandPayoutReadiness,
): boolean {
  return readiness.stripeChargesEnabled || readiness.hasPaystackSubaccount;
}

/**
 * Resolve readiness from the (camelCased) brand shape this app already carries.
 * `stripeStatus === "active"` is the canonical "charges enabled" signal.
 */
export function brandPayoutReadiness(brand: {
  stripeStatus?: string;
  paystackSubaccountCode?: string | null;
}): BrandPayoutReadiness {
  return {
    stripeChargesEnabled: brand.stripeStatus === "active",
    hasPaystackSubaccount:
      typeof brand.paystackSubaccountCode === "string" &&
      brand.paystackSubaccountCode.length > 0,
  };
}
