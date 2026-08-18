/**
 * issue #2229 [raw checkout error tokens] — implementor happy-path regression.
 *
 * SPEC #2227 §7: T-3 (totality), T-4 (money clause), T-5 (in-progress mapping),
 * T-6 (status precedence).
 *
 * Fails on revert: return the raw token from `nativeCheckoutErrorMessage` (or
 * delete the mapper's routing) and T-3 goes red because the mapper returns its
 * input.
 */

import {
  CHECKOUT_ALREADY_RESERVED_MESSAGE,
  CHECKOUT_BOOKINGS_CLOSED_MESSAGE,
  CHECKOUT_DATE_UNAVAILABLE_MESSAGE,
  CHECKOUT_DETAILS_INCOMPLETE_MESSAGE,
  CHECKOUT_FAILED_MESSAGE,
  CHECKOUT_IN_PROGRESS_MESSAGE,
  CHECKOUT_INTAKE_REQUIRED_MESSAGE,
  CHECKOUT_INTAKE_STALE_MESSAGE,
  CHECKOUT_RESTRICTED_MESSAGE,
  CHECKOUT_SIGN_IN_MESSAGE,
  CHECKOUT_UNAVAILABLE_MESSAGE,
  CHECKOUT_UPDATE_APP_MESSAGE,
  NATIVE_CHECKOUT_MESSAGES,
  isCheckoutInProgress,
  isStaleOccurrenceToken,
  nativeCheckoutErrorMessage,
} from "../checkoutErrorMessages";

/**
 * Every bounded token `ticket-checkout-create` can emit, enumerated in SPEC
 * #2227 §4.1 (the SPEC says "37"; the enumeration it prints holds 38 — the
 * count is off by one, the SET is what binds). `checkout_unavailable` is
 * appended: it is mapped by rule 5 and reaches native from the same rail.
 */
const SERVER_TOKENS: readonly string[] = [
  "bookings_closed",
  "buyer_email_invalid",
  "buyer_name_required",
  "buyer_phone_required",
  "checkout_finalize_failed",
  "checkout_in_progress",
  "checkout_restricted",
  "checkout_session_create_failed",
  "checkout_session_failed",
  "checkout_session_persist_failed",
  "checkout_session_url_missing",
  "event_date_lookup_failed",
  "event_id_required",
  "event_lookup_failed",
  "event_no_active_dates",
  "free_reservation_already_exists",
  "installment_customer_provisioning_failed",
  "intake_form_required",
  "intake_schema_lookup_failed",
  "intake_schema_stale",
  "internal_error",
  "invalid_json",
  "method_not_allowed",
  "occurrence_lookup_failed",
  "occurrence_not_available",
  "occurrence_not_found",
  "payment_intent_create_failed",
  "payment_plan_choice_invalid",
  "payment_session_persist_failed",
  "paystack_initialize_failed",
  "pricing_config_unavailable",
  "qr_token_pepper_missing",
  "stripe_account_not_ready",
  "tax_calculation_failed",
  "tax_country_unsupported",
  "ticket_lines_required",
  "upgrade_required",
  "web_base_url_missing",
  "checkout_unavailable",
];

describe("#2229 T-3 — the native checkout error mapper is TOTAL", () => {
  it("returns one of the owned constants for every server token, at every status", () => {
    const owned = new Set(NATIVE_CHECKOUT_MESSAGES);
    for (const token of SERVER_TOKENS) {
      for (const status of [null, 400, 401, 403, 409, 422, 426, 500, 503]) {
        const message = nativeCheckoutErrorMessage(token, status);
        expect(owned.has(message)).toBe(true);
      }
    }
  });

  it("NEVER returns its input — a machine token can never reach a buyer", () => {
    for (const token of SERVER_TOKENS) {
      for (const status of [null, 400, 401, 403, 409, 422, 426, 500]) {
        expect(nativeCheckoutErrorMessage(token, status)).not.toBe(token);
      }
    }
  });

  it("maps the unmapped: null, empty, garbage and unlisted 5xx tokens", () => {
    const owned = new Set(NATIVE_CHECKOUT_MESSAGES);
    for (const token of [null, "", "garbage", "some_token_invented_tomorrow"]) {
      expect(nativeCheckoutErrorMessage(token, null)).toBe(
        CHECKOUT_FAILED_MESSAGE,
      );
      expect(owned.has(nativeCheckoutErrorMessage(token, 500))).toBe(true);
    }
    expect(nativeCheckoutErrorMessage("internal_error", 500)).toBe(
      CHECKOUT_FAILED_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("paystack_initialize_failed", 502)).toBe(
      CHECKOUT_FAILED_MESSAGE,
    );
  });

  it("routes each specified token class to its specified constant", () => {
    expect(nativeCheckoutErrorMessage("checkout_restricted", null)).toBe(
      CHECKOUT_RESTRICTED_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("upgrade_required", null)).toBe(
      CHECKOUT_UPDATE_APP_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("checkout_unavailable", null)).toBe(
      CHECKOUT_UNAVAILABLE_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("bookings_closed", null)).toBe(
      CHECKOUT_BOOKINGS_CLOSED_MESSAGE,
    );
    for (const token of [
      "event_no_active_dates",
      "occurrence_not_found",
      "occurrence_not_available",
      "occurrence_lookup_failed",
      "event_date_lookup_failed",
    ]) {
      expect(nativeCheckoutErrorMessage(token, 422)).toBe(
        CHECKOUT_DATE_UNAVAILABLE_MESSAGE,
      );
    }
    for (const token of [
      "buyer_name_required",
      "buyer_email_invalid",
      "buyer_phone_required",
      "ticket_lines_required",
      "event_id_required",
      "invalid_json",
      "payment_plan_choice_invalid",
      "method_not_allowed",
    ]) {
      expect(nativeCheckoutErrorMessage(token, 400)).toBe(
        CHECKOUT_DETAILS_INCOMPLETE_MESSAGE,
      );
    }
    expect(nativeCheckoutErrorMessage("intake_form_required", 422)).toBe(
      CHECKOUT_INTAKE_REQUIRED_MESSAGE,
    );
    for (const token of ["intake_schema_stale", "intake_schema_lookup_failed"]) {
      expect(nativeCheckoutErrorMessage(token, 422)).toBe(
        CHECKOUT_INTAKE_STALE_MESSAGE,
      );
    }
    expect(
      nativeCheckoutErrorMessage("free_reservation_already_exists", 409),
    ).toBe(CHECKOUT_ALREADY_RESERVED_MESSAGE);
  });
});

describe("#2229 T-4 — every buyer string says whether money moved", () => {
  it("each owned constant carries a charged / not-charged clause", () => {
    expect(NATIVE_CHECKOUT_MESSAGES).toHaveLength(13);
    for (const message of NATIVE_CHECKOUT_MESSAGES) {
      expect(message.toLowerCase()).toContain("charged");
    }
  });
});

describe("#2229 T-5 — the in-progress refusal reads as a sentence", () => {
  it("maps the bounded token AND a bare 409 to the same recoverable copy", () => {
    expect(nativeCheckoutErrorMessage("checkout_in_progress", 409)).toBe(
      CHECKOUT_IN_PROGRESS_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage(null, 409)).toBe(
      CHECKOUT_IN_PROGRESS_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("checkout_in_progress", null)).toBe(
      CHECKOUT_IN_PROGRESS_MESSAGE,
    );
  });

  it("never renders the literal token the buyer was shown in #2229", () => {
    expect(nativeCheckoutErrorMessage("checkout_in_progress", 409)).not.toBe(
      "checkout_in_progress",
    );
    expect(
      nativeCheckoutErrorMessage("checkout_in_progress", 409),
    ).not.toContain("checkout_in_progress");
  });

  it("recognises the in-progress refusal from token OR bare status", () => {
    expect(isCheckoutInProgress("checkout_in_progress", null)).toBe(true);
    expect(isCheckoutInProgress(null, 409)).toBe(true);
    expect(isCheckoutInProgress("checkout_unavailable", 422)).toBe(false);
    expect(isCheckoutInProgress(null, null)).toBe(false);
  });
});

describe("#2229 T-6 — status precedence", () => {
  it("401 wins over a checkout_in_progress body", () => {
    expect(nativeCheckoutErrorMessage("checkout_in_progress", 401)).toBe(
      CHECKOUT_SIGN_IN_MESSAGE,
    );
  });

  it("403 and 426 win over an unrelated token", () => {
    expect(nativeCheckoutErrorMessage("checkout_in_progress", 403)).toBe(
      CHECKOUT_RESTRICTED_MESSAGE,
    );
    expect(nativeCheckoutErrorMessage("checkout_in_progress", 426)).toBe(
      CHECKOUT_UPDATE_APP_MESSAGE,
    );
  });

  it("a bounded token still wins over the bare-409 fallback", () => {
    expect(nativeCheckoutErrorMessage("bookings_closed", 409)).toBe(
      CHECKOUT_BOOKINGS_CLOSED_MESSAGE,
    );
  });
});

describe("#2229 — the ORCH-1187 stale-occurrence branch survives the mapper", () => {
  it("exposes the token predicate the Experience screen must branch on", () => {
    expect(isStaleOccurrenceToken("occurrence_not_available")).toBe(true);
    expect(isStaleOccurrenceToken("occurrence_not_found")).toBe(true);
    expect(isStaleOccurrenceToken("bookings_closed")).toBe(false);
    expect(isStaleOccurrenceToken(null)).toBe(false);
  });

  it("the mapped copy no longer carries the token a string-sniff needed", () => {
    expect(
      nativeCheckoutErrorMessage("occurrence_not_available", 422),
    ).not.toContain("occurrence_not_available");
  });
});
