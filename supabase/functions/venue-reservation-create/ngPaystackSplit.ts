/**
 * #1178 [ng-split-removal] — pure Paystack split-field decision for the venue
 * reservation deposit initialize call.
 *
 * Co-located sibling module so the gate is unit-testable WITHOUT importing the
 * serve()-on-load index.ts entry (the same pattern as
 * rsvp-contribution-create/returnUrls.ts and payout-release-sweep/engine.ts).
 *
 * A Nigerian brand that has been STAMPED for the event-anchored payout hold
 * (brands.payout_hold_cutover_at IS NOT NULL, read in index.ts as `isCutover`)
 * must NOT split the deposit to the organiser subaccount at charge time — it
 * settles 100% to Mingla's main Paystack balance for later event-anchored
 * release (#1177). An UNSTAMPED brand is byte-identical to today: split to the
 * subaccount with the flat Mingla transaction_charge. The buyer `amount` is
 * unchanged either way.
 */
export interface PaystackReservationSplitFields {
  subaccount: string;
  transactionChargeSubunits: number;
}

/**
 * The subaccount split fields to spread into paystackInitializeTransaction, or an
 * empty object (full settle to Mingla main) when the brand is cut over OR has no
 * subaccount. For an unstamped brand the output is byte-identical to the pre-#1178
 * unconditional `{ subaccount, transactionChargeSubunits }` spread (the readiness
 * gate guarantees a subaccount for unstamped brands).
 */
export function paystackReservationSplitFields(
  isCutover: boolean,
  subaccountCode: string | null | undefined,
  transactionChargeSubunits: number,
): PaystackReservationSplitFields | Record<never, never> {
  if (isCutover || !subaccountCode) return {};
  return { subaccount: subaccountCode, transactionChargeSubunits };
}
