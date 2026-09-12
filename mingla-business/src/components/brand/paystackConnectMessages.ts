/**
 * Paystack payout-connect failure copy — pure, dependency-free.
 *
 * #3192 introduced `describePaystackConnectError` inside
 * BrandPaystackOnboardView. #3260 moved it here: the view's import chain reaches
 * react-native-reanimated and react-native-svg, so nothing could assert on this
 * copy without mounting the whole native tree. Payout-failure wording is exactly
 * the kind of thing that must be cheap to test, because getting it wrong is how
 * a successful connect ends up reported as a failure.
 *
 * BrandPaystackOnboardView is the only caller.
 */

/**
 * #3260 [paystack-connect-false-negative] — the ONE reachable half-state.
 *
 * `handleConnect` awaits the recipient write before the subaccount write, so
 * the reverse order cannot occur: if the RCP_ throws, the brand row is never
 * touched. That leaves exactly one partial outcome — bank details stored, brand
 * not yet flipped onto the Paystack rail — and it must be named, not folded
 * into a blanket "we couldn't connect this bank account".
 *
 * Retrying IS the recovery and it is safe: `create_recipient` upserts on
 * brand_id (so no duplicate RCP_), and because the subaccount step is the step
 * that failed, no ACCT_ exists yet — finishing mints exactly one. That matters
 * on this rail specifically: Paystack dedupes recipients by code but does NOT
 * dedupe subaccounts, so a retry offered in the WRONG state would mint a second
 * live ACCT_.
 */
export const PARTIAL_CONNECT_MESSAGE =
  "We saved your bank details but couldn't finish connecting payouts. Your details are safe and nothing was charged — tap Connect again to finish.";

/**
 * #3192 — turn a payout-connect failure into copy the organiser can act on.
 *
 * The edge function already returns a specific `error` code and `detail`, and
 * `brandPaystackService.unwrapError` folds both into the thrown message. Only
 * the view was discarding it. Unknown causes still fall back to the generic
 * line, but they no longer erase what actually happened — the caller logs the
 * bound error alongside this.
 */
export function describePaystackConnectError(
  err: unknown,
  isUpdate: boolean,
  // #3260 — true when the RCP_ write already committed and the failure was the
  // brand-row flip. See PARTIAL_CONNECT_MESSAGE.
  bankDetailsSaved = false,
): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");

  if (raw.includes("account_unresolved") || raw.includes("resolved_account_mismatch")) {
    return "That account number doesn't match the bank you picked. Check both, then verify again.";
  }
  // #3260 — these two are terminal for this operator/brand: tapping again
  // cannot finish the connect, so the actionable cause outranks the half-state
  // note even when the bank details did land.
  if (raw.includes("provider_already_set")) {
    return "This brand is already connected to a different payment provider. Disconnect it first, then add this bank.";
  }
  if (raw.includes("forbidden") || raw.includes("unauthenticated")) {
    return "You don't have permission to change payouts for this brand. Ask a brand owner to do it.";
  }
  // #3260 — the RCP_ committed and the brand row did not. Saying "we couldn't
  // connect this bank account" would be a blanket failure over a real partial
  // write, and would leave the saved details unexplained. Name the half-state
  // and name the recovery instead.
  if (bankDetailsSaved) return PARTIAL_CONNECT_MESSAGE;
  if (raw.includes("recipient_create_failed") || raw.includes("subaccount_create_failed")) {
    return "Paystack couldn't accept this account right now. Wait a moment and try again — if it keeps failing, contact support.";
  }
  if (raw.includes("recipient_store_failed") || raw.includes("recipient_read_failed")) {
    return "We reached Paystack but couldn't save the result on our side. Nothing was charged or changed. Try again, and contact support if it persists.";
  }
  return isUpdate
    ? "We couldn't update this bank account. Please try again in a moment."
    : "We couldn't connect this bank account. Please try again in a moment.";
}
