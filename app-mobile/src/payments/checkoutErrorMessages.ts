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
 * True when the server refused because this buyer already has a live checkout
 * for the order. Both the bounded token and a bare 409 count — the flow uses
 * this to decide whether it can offer the buyer their held payment page back.
 */
export const isCheckoutInProgress = (
  token: string | null,
  status: number | null,
): boolean => token === "checkout_in_progress" || status === 409;

/**
 * True when the organiser's date/occurrence moved. The Experience screen
 * branches on this to re-open its picker (ORCH-1187 FIX-4b) — it used to
 * string-sniff the raw token out of the message, which the mapper removes.
 */
export const isStaleOccurrenceToken = (token: string | null): boolean =>
  token !== null &&
  (token === "occurrence_not_available" || token === "occurrence_not_found");
