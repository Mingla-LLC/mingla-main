/**
 * issue #2229 [raw checkout error tokens] — the ONE place native buyer-facing
 * checkout copy is decided.
 *
 * Native mirror of the web mapper `paidCheckoutErrorMessage`
 * (`mingla-business/src/services/ticketCheckoutService.ts`), established by
 * #2188. It exists because `extractFunctionError` returns the server's machine
 * token verbatim (`edgeFunctionError.ts` → `body.error`) and the consumer
 * screens rendered that straight into a toast — which is how a buyer was shown
 * the literal string `checkout_in_progress`.
 *
 * TWO PROPERTIES ARE LOAD-BEARING:
 *
 *  1. TOTAL. `nativeCheckoutErrorMessage` returns one of the constants below
 *     for EVERY input — every one of the 37 tokens `ticket-checkout-create` can
 *     emit, every unlisted token, every status, `null` and `""`. It can never
 *     return its input, so an unrecognised token can never reach a buyer.
 *
 *  2. EVERY STRING SAYS WHETHER MONEY MOVED (#2188's rule). A buyer must never
 *     be left wondering whether they have been charged. Do not add a constant
 *     here without a charged / not-charged clause.
 *
 * Invariant: I-PROPOSED-NATIVE-CHECKOUT-ERRORS-TOTAL-MAPPER.
 */

export const CHECKOUT_IN_PROGRESS_MESSAGE =
  "You already have a payment open for this order. Reopen it to finish, or try again shortly — you have not been charged twice.";

export const CHECKOUT_UNAVAILABLE_MESSAGE =
  "This sale is no longer available — the organiser may have paused or changed this event. You have not been charged.";

export const CHECKOUT_SIGN_IN_MESSAGE =
  "This sale is restricted. Sign in with an approved Mingla account to complete this purchase. You have not been charged.";

export const CHECKOUT_RESTRICTED_MESSAGE =
  "The organiser has limited this sale to specific Mingla accounts, so this purchase can't be completed here. You have not been charged.";

export const CHECKOUT_UPDATE_APP_MESSAGE =
  "Update the Mingla app to complete this payment. You have not been charged.";

export const CHECKOUT_BOOKINGS_CLOSED_MESSAGE =
  "Bookings for this event are closed. You have not been charged.";

export const CHECKOUT_DATE_UNAVAILABLE_MESSAGE =
  "That date is no longer available — pick another. You have not been charged.";

export const CHECKOUT_DETAILS_INCOMPLETE_MESSAGE =
  "Some of your details are missing or invalid. Check them and try again — you have not been charged.";

export const CHECKOUT_INTAKE_REQUIRED_MESSAGE =
  "This ticket needs a few questions answered before you can pay. You have not been charged.";

export const CHECKOUT_INTAKE_STALE_MESSAGE =
  "The organiser updated this event's questions. Reopen the tickets and answer them again — you have not been charged.";

export const CHECKOUT_ALREADY_RESERVED_MESSAGE =
  "You already have a reservation for this event. Check your tickets — you have not been charged again.";

export const CHECKOUT_NO_HANDOFF_MESSAGE =
  "We couldn't open the secure payment page. You have not been charged — please try again.";

export const CHECKOUT_FAILED_MESSAGE =
  "We couldn't start your payment. You have not been charged — please try again.";

// ---------------------------------------------------------------------------
// issue #2264 — the RETURN LEG. Everything above answers "the server refused to
// CREATE the checkout"; everything below answers "the buyer came back from
// Paystack and the server has told us what happened to the charge".
//
// These are the copy for `ticket-checkout-status`'s terminal verdict, which
// #2198 has been sending since 2026-08-18 and the native poll discarded. They
// are a SEPARATE codomain from `nativeCheckoutErrorMessage`'s, because two of
// them deliberately do NOT carry a "you have not been charged" clause:
//
//   • the mismatch string must never claim the buyer was not charged — money
//     provably moved, it just moved for the wrong amount or currency, and the
//     #2188 rule is *state whether money moved*, not *always say it didn't*;
//   • the awaiting string is the honest "we don't know yet" — inventing
//     certainty there is the exact defect #2264 was filed about.
//
// That is why they live in NATIVE_PAYSTACK_RETURN_MESSAGES below rather than in
// NATIVE_CHECKOUT_MESSAGES: the existing walkers over that array assert
// `/not been charged/i` on EVERY member, which is right for create-refusals
// (nothing was ever charged) and wrong for a return-leg verdict.
// ---------------------------------------------------------------------------

/** Paystack said `abandoned`: the page was opened and left without paying. */
export const CHECKOUT_ABANDONED_MESSAGE =
  "You closed the payment page before paying, so no tickets were issued. You have not been charged — reopen the payment page to finish, or start again.";

/** Paystack said `failed` / `reversed`: the charge was attempted and refused. */
export const CHECKOUT_PAYMENT_FAILED_MESSAGE =
  "Your payment didn't go through, so no tickets were issued. You have not been charged — please try again.";

/**
 * The charge succeeded for an amount or currency that is not this order's. The
 * server has already failed the session CLOSED and written the audit row. Money
 * moved — this string must never say otherwise.
 */
export const CHECKOUT_PAYMENT_MISMATCH_MESSAGE =
  "Your payment came back with a different amount or currency than this order, so no tickets were issued. If money left your account, contact support@usemingla.com before paying again.";

/**
 * The ONLY "we don't know yet" case. The poll spent its whole budget without a
 * terminal answer, so the buyer may well have paid and the webhook is simply
 * slow. Replaces the inline string that used to stand in for all three of
 * abandoned / failed / genuinely-pending at once (issue #2264, F-2).
 */
export const CHECKOUT_AWAITING_CONFIRMATION_MESSAGE =
  "Paystack hasn't confirmed this payment yet. If you completed it, your tickets will arrive here and by email within a few minutes — don't pay again. If nothing arrives, contact support@usemingla.com.";

/** Every constant this module owns, in one place, so a test can walk them. */
export const NATIVE_CHECKOUT_MESSAGES: readonly string[] = [
  CHECKOUT_IN_PROGRESS_MESSAGE,
  CHECKOUT_UNAVAILABLE_MESSAGE,
  CHECKOUT_SIGN_IN_MESSAGE,
  CHECKOUT_RESTRICTED_MESSAGE,
  CHECKOUT_UPDATE_APP_MESSAGE,
  CHECKOUT_BOOKINGS_CLOSED_MESSAGE,
  CHECKOUT_DATE_UNAVAILABLE_MESSAGE,
  CHECKOUT_DETAILS_INCOMPLETE_MESSAGE,
  CHECKOUT_INTAKE_REQUIRED_MESSAGE,
  CHECKOUT_INTAKE_STALE_MESSAGE,
  CHECKOUT_ALREADY_RESERVED_MESSAGE,
  CHECKOUT_NO_HANDOFF_MESSAGE,
  CHECKOUT_FAILED_MESSAGE,
];

/**
 * issue #2264 — the complete codomain of `nativePaystackReturnMessage`, so a
 * test can walk it the way #2229's tests walk NATIVE_CHECKOUT_MESSAGES.
 *
 * CHECKOUT_UNAVAILABLE_MESSAGE appears in BOTH arrays on purpose: it is the
 * `paid_reversal_pending` arm's copy here (#1930 — the sale moved under the
 * charge) and the `checkout_unavailable` create-refusal there. Same sentence,
 * two rails.
 */
export const NATIVE_PAYSTACK_RETURN_MESSAGES: readonly string[] = [
  CHECKOUT_ABANDONED_MESSAGE,
  CHECKOUT_PAYMENT_FAILED_MESSAGE,
  CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
  CHECKOUT_UNAVAILABLE_MESSAGE,
  CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
];

/**
 * The organiser changed the date/occurrence out from under the buyer. The
 * Experience screen re-opens its picker on these (ORCH-1187 FIX-4b) and must
 * branch on the TOKEN — the mapped copy no longer carries it.
 */
const DATE_UNAVAILABLE_TOKENS: ReadonlySet<string> = new Set([
  "event_no_active_dates",
  "occurrence_not_found",
  "occurrence_not_available",
  "occurrence_lookup_failed",
  "event_date_lookup_failed",
]);

/** The buyer (or the request built from their input) is malformed. */
const DETAILS_INCOMPLETE_TOKENS: ReadonlySet<string> = new Set([
  "buyer_name_required",
  "buyer_email_invalid",
  "buyer_phone_required",
  "ticket_lines_required",
  "event_id_required",
  "invalid_json",
  "payment_plan_choice_invalid",
  "method_not_allowed",
]);

/** The intake schema moved under the buyer's answers. */
const INTAKE_STALE_TOKENS: ReadonlySet<string> = new Set([
  "intake_schema_stale",
  "intake_schema_lookup_failed",
]);

/**
 * Map a bounded server token + HTTP status to buyer copy.
 *
 * TOTAL by construction: the final `return` is unconditional, so every
 * unlisted token — and every 5xx, whose tokens are all internal plumbing
 * (`payment_intent_create_failed`, `qr_token_pepper_missing`, …) — lands on
 * CHECKOUT_FAILED_MESSAGE rather than reaching a buyer's screen.
 *
 * Status wins over token where the status is the stronger fact (401/403/426):
 * an auth refusal is an auth refusal whatever the body said.
 */
export const nativeCheckoutErrorMessage = (
  token: string | null,
  status: number | null,
): string => {
  if (status === 401) return CHECKOUT_SIGN_IN_MESSAGE;
  if (token === "checkout_restricted" || status === 403) {
    return CHECKOUT_RESTRICTED_MESSAGE;
  }
  if (token === "upgrade_required" || status === 426) {
    return CHECKOUT_UPDATE_APP_MESSAGE;
  }
  if (token === "checkout_in_progress") return CHECKOUT_IN_PROGRESS_MESSAGE;
  if (token === "checkout_unavailable") return CHECKOUT_UNAVAILABLE_MESSAGE;
  if (token === "bookings_closed") return CHECKOUT_BOOKINGS_CLOSED_MESSAGE;
  if (token !== null && DATE_UNAVAILABLE_TOKENS.has(token)) {
    return CHECKOUT_DATE_UNAVAILABLE_MESSAGE;
  }
  if (token !== null && DETAILS_INCOMPLETE_TOKENS.has(token)) {
    return CHECKOUT_DETAILS_INCOMPLETE_MESSAGE;
  }
  if (token === "intake_form_required") return CHECKOUT_INTAKE_REQUIRED_MESSAGE;
  if (token !== null && INTAKE_STALE_TOKENS.has(token)) {
    return CHECKOUT_INTAKE_STALE_MESSAGE;
  }
  if (token === "free_reservation_already_exists") {
    return CHECKOUT_ALREADY_RESERVED_MESSAGE;
  }
  // A 409 whose body we could not read still means "the server refused because
  // of the state of this sale", which is the recoverable in-progress case far
  // more often than not. Mirrors the web comment at ticketCheckoutService.ts.
  if (status === 409) return CHECKOUT_IN_PROGRESS_MESSAGE;
  return CHECKOUT_FAILED_MESSAGE;
};

/**
 * issue #2264 — map `ticket-checkout-status`'s TERMINAL token to buyer copy.
 *
 * The native mirror of the web rail's #2198 arm in `paidCheckoutErrorMessage`
 * (`mingla-business/src/services/ticketCheckoutService.ts`). The four codes are
 * the complete terminal set `resolvePaystackTicketReturn` can emit
 * (`supabase/functions/_shared/paystackTicketReturnVerify.ts` — the `abandoned`
 * / `failed` arm and the `amount_mismatch` / `currency_mismatch` /
 * `paid_reversal_pending` arms).
 *
 * TOTAL by the same construction as `nativeCheckoutErrorMessage`: the final
 * return is unconditional. Rule 5 — an unrecognised code, and `null`, degrade
 * to CHECKOUT_AWAITING_CONFIRMATION_MESSAGE, i.e. "we don't know yet". That is
 * the SAFE direction on a money path: a terminal code invented by a future
 * server version must never become a false certainty about the buyer's money.
 *
 * A LOOKUP TABLE rather than an if-chain, deliberately. #2229's adversarial
 * reverse-drift guard reads every double-quoted `[a-z_]` literal in this file
 * and requires it to be a token `ticket-checkout-create` can still emit. These
 * four are emitted by `ticket-checkout-status` instead, so that guard cannot
 * cover them — and must not be made to think it does. The equivalent
 * reverse-drift property for THESE codes is asserted in
 * `__tests__/issue_2264_checkout_outcome_honesty.test.ts` T-2, which derives
 * them from `paystackTicketReturnVerify.ts` — the file that actually mints
 * them — and fails if the server ever drops one of the arms.
 *
 * Invariant: I-PROPOSED-NATIVE-CHECKOUT-ERRORS-TOTAL-MAPPER (extended, not
 * weakened) + I-PROPOSED-CHECKOUT-STATUS-ANSWER-NOT-DISCARDED.
 */
const PAYSTACK_RETURN_MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  paystack_charge_abandoned: CHECKOUT_ABANDONED_MESSAGE,
  paystack_charge_failed: CHECKOUT_PAYMENT_FAILED_MESSAGE,
  paystack_payment_mismatch: CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
  // #1930 — `paid_reversal_pending`: current-sale truth moved under the charge.
  checkout_unavailable: CHECKOUT_UNAVAILABLE_MESSAGE,
};

export const nativePaystackReturnMessage = (code: string | null): string =>
  (code === null ? undefined : PAYSTACK_RETURN_MESSAGE_BY_CODE[code]) ??
  CHECKOUT_AWAITING_CONFIRMATION_MESSAGE;
