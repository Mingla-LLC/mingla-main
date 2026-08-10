/**
 * Issue #1790 — pure Paystack split-field decision for a NG venue order.
 *
 * Co-located sibling module so the rule is unit-testable WITHOUT importing the
 * serve()-on-load index.ts entry (the venue-reservation-create/ngPaystackSplit.ts
 * pattern, itself the rsvp-contribution-create/returnUrls.ts pattern).
 *
 * A Nigerian brand STAMPED for the event-anchored payout hold
 * (brands.payout_hold_cutover_at IS NOT NULL) must NOT split at charge time — it
 * settles 100% to Mingla's main Paystack balance for later anchored release.
 * An UNSTAMPED brand splits to its subaccount with the flat Mingla
 * transaction_charge, exactly as today. The buyer `amount` is unchanged either
 * way.
 *
 * P-50 — NG PARTNER SHARE IS ZERO AT LAUNCH. `partner_splits.order_id` is
 * `NOT NULL REFERENCES public.orders(id)`, so the table is structurally
 * ticket-order-only and a venue order cannot have a split row. Nothing
 * partner-shaped appears here, and extending it later is
 * `payout_partner_attributions` work — never a loosening of that FK.
 */
export interface VenueOrderPaystackSplitFields {
  subaccount: string;
  transactionChargeSubunits: number;
}

export function venueOrderSplitFields(
  isCutover: boolean,
  subaccountCode: string | null | undefined,
  transactionChargeSubunits: number,
): VenueOrderPaystackSplitFields | Record<never, never> {
  if (isCutover || !subaccountCode) return {};
  return { subaccount: subaccountCode, transactionChargeSubunits };
}
