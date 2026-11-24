// Issue #4130 (Wave 2b) — Refund operations page: rows, exception details and
// error words.
//
// Pure: no React, no Supabase. The queue holds two kinds of item: refund
// operations (opened live from the server) and provider event exceptions
// (a webhook that matched no refund, shown from the captured queue row; the
// server has no detail call for them, and they need no action here).

/** One table row for either kind of queue item. */
export function queueRowModel(item) {
  const row = item?.safeSummary ?? {};
  if (item?.itemKind === "trip_cancel_refund") {
    const hours = waitingHours(row.waiting_since);
    return {
      key: `${item.itemKind}:${item.itemId}`,
      kind: "trip_cancel",
      id: row.refund_id ?? item.itemId,
      source: "Trip cancel, part unconfirmed",
      amountCents: row.unconfirmed_amount_cents ?? null,
      currency: typeof row.currency === "string" ? row.currency.toUpperCase() : null,
      provider: providerName(row.provider),
      buyer: null,
      fee: null,
      financial: null,
      ops: row.escalated
        ? "Escalated"
        : hours === null ? "Needs review" : `Waiting ${hours} h`,
    };
  }
  if (item?.itemKind === "refund_operation") {
    return {
      key: `${item.itemKind}:${item.itemId}`,
      kind: "refund",
      id: row.operationId ?? item.itemId,
      source: row.sourceType ?? "Refund",
      amountCents: row.amountCents ?? null,
      currency: row.currency ?? null,
      provider: row.provider ?? null,
      buyer: row.buyerState ?? null,
      fee: row.feeState ?? null,
      financial: row.financialState ?? null,
      ops: row.opsStatus ?? "Needs review",
    };
  }
  return {
    key: `${item?.itemKind}:${item?.itemId}`,
    kind: "exception",
    id: row.exceptionId ?? item?.itemId,
    source: "Provider event exception",
    amountCents: null,
    currency: null,
    provider: row.provider ?? null,
    buyer: row.matchStatus ?? null,
    fee: null,
    financial: null,
    ops: "Needs review",
  };
}

const MATCH_WORDS = {
  unmatched: "The provider sent an event that matches no refund on Mingla.",
  mismatched: "The provider sent an event that disagrees with the refund on Mingla.",
};

/** The fields shown when an exception row is opened. */
export function exceptionDetail(item) {
  const row = item?.safeSummary ?? {};
  return {
    title: "Provider event exception",
    explanation: MATCH_WORDS[row.matchStatus] ?? "The provider sent an event Mingla could not match.",
    fields: [
      ["Exception", row.exceptionId ?? item?.itemId],
      ["Provider", row.provider],
      ["Event", row.providerEventType],
      ["Match", row.matchStatus],
      ["Reason code", row.safeReasonCode],
      ["Received", row.createdAt],
      ["Respond by", row.firstResponseDueAt],
    ],
    nextStep: "Check this event in the provider's dashboard. There is nothing to change here: it leaves the queue once the provider event is matched.",
  };
}

/** Plain words for a failed queue load, page load, open or action. */
export function refundQueueErrorMessage(error, context = "load") {
  const message = error instanceof Error ? error.message : String(error?.message ?? error ?? "");
  if (message.includes("snapshot_expired") || message.includes("snapshot_mismatch") || message.includes("snapshot_page_discontinuity")) {
    return "This queue view expired. Refresh to load the latest refund operations.";
  }
  if (message.includes("not_authorized")) return "Your account can't open refund operations.";
  if (context === "more") return "Couldn't load more refund operations. Refresh the queue and try again.";
  if (context === "open") return "Couldn't open this refund. It may have changed; refresh the queue and try again.";
  if (context === "action") return "That refund action could not be applied. Refresh the queue and try again.";
  return "Couldn’t load refund operations. Try again.";
}

/** A reason is required for every action: trimmed, 3–500 characters. */
export function validateActionReason(raw) {
  const text = String(raw ?? "").trim();
  if (text.length < 3) return "Write why you are doing this (at least 3 characters). It is saved on the refund.";
  if (text.length > 500) return "Keep the reason under 500 characters.";
  return null;
}

// ---------------------------------------------------------------------------
// Issue #4522 (H-2) — a second-provider trip cancel refund that was sent and
// never answered. Staff either record it (the provider shows it refunded) or
// escalate it (the provider shows none). Nothing is ever re-sent from here.

/** Whole hours since an ISO time, or null when unknown. */
export function waitingHours(since, now = Date.now()) {
  const at = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / 3_600_000));
}

function providerName(provider) {
  return provider === "paystack" ? "Paystack" : provider ?? null;
}

/** Queue items for the stuck trip cancels (listed after the captured queue). */
export function tripCancelQueueItems(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row.refund_id === "string")
    .map((row) => ({
      itemKind: "trip_cancel_refund",
      itemId: row.refund_id,
      safeSummary: row,
    }));
}

const CHARGE_STATE_WORDS = {
  recorded: "Refunded, recorded",
  unanswered: "Sent, no answer",
  accepted: "Accepted by Paystack, not yet confirmed",
  refused: "Refused by Paystack",
  not_sent: "Not sent yet",
};

/** One line per charge of the cancel: deposit, then Payment N. */
export function tripCancelChargeRows(detail) {
  return (detail?.charges ?? []).map((charge) => ({
    key: charge.attempt_id,
    attemptId: charge.attempt_id,
    label: charge.part === "deposit"
      ? "Deposit"
      : Number.isInteger(charge.ordinal) ? `Payment ${charge.ordinal}` : "Payment",
    amountCents: charge.amount_cents,
    currency: charge.currency ?? detail?.currency ?? null,
    state: charge.state,
    stateLabel: CHARGE_STATE_WORDS[charge.state] ?? "Not finished",
    actionable: charge.actionable === true,
    escalated: charge.ops_resolution?.outcome === "escalate",
    // Pass 8 (P8-2): what staff may do with this part (unanswered: record or
    // escalate; refused: say what Paystack already shows refunded, or escalate).
    outcomes: Array.isArray(charge.outcomes) ? charge.outcomes : ["refunded_at_provider", "escalate"],
    chargeCents: Number.isInteger(charge.charge_cents) ? charge.charge_cents : null,
  }));
}

export const TRIP_CANCEL_OUTCOMES = [
  { value: "refunded_at_provider", label: "Paystack shows it refunded: record it" },
  { value: "refunded_elsewhere", label: "Paystack shows it partly refunded already: ask only for what is left" },
  { value: "escalate", label: "Paystack shows no refund: escalate (nothing is re-sent from here)" },
];

/** Pass 8 (P8-2): a typed amount in major units (e.g. "500000.00") as minor units, or null. */
export function majorToMinor(text) {
  const value = String(text ?? "").trim().replace(/,/g, "");
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * Field errors for the trip cancel form, or null when it can be sent.
 * The provider refund reference is required to record; the reason always.
 */
export function validateTripCancelResolution({ outcome, reference, reason, refundedElsewhere, chargeCents }) {
  const errors = {};
  if (outcome !== "refunded_at_provider" && outcome !== "refunded_elsewhere" && outcome !== "escalate") {
    errors.outcome = "Choose what Paystack shows for this refund.";
  }
  const ref = String(reference ?? "").trim();
  if (outcome === "refunded_elsewhere") {
    const minor = majorToMinor(refundedElsewhere);
    if (minor === null || minor <= 0) {
      errors.refundedElsewhere = "Enter the amount Paystack shows already refunded on this payment.";
    } else if (Number.isInteger(chargeCents) && minor >= chargeCents) {
      errors.refundedElsewhere = "That is the whole payment or more. Check it in Paystack, or escalate.";
    }
    if (ref.length === 0) errors.reference = "Enter the reference of that other Paystack refund.";
    else if (ref.length > 200) errors.reference = "The refund reference is too long. Check it in Paystack.";
  }
  if (outcome === "refunded_at_provider") {
    if (ref.length === 0) errors.reference = "Enter the Paystack refund reference to record it.";
    else if (ref.length > 200) errors.reference = "The refund reference is too long. Check it in Paystack.";
  }
  const reasonProblem = validateActionReason(reason);
  if (reasonProblem) errors.reason = reasonProblem;
  return Object.keys(errors).length > 0 ? errors : null;
}

const TRIP_CANCEL_ERROR_WORDS = {
  provider_refund_reference_already_used: "That refund reference is already recorded on another refund. Check it in Paystack.",
  provider_refund_reference_required: "Enter the Paystack refund reference to record it.",
  trip_cancel_refund_already_confirmed: "Paystack has already confirmed this refund. Refresh the queue.",
  trip_cancel_refund_already_resolved: "This refund was already recorded. Refresh the queue.",
  trip_cancel_refund_not_unanswered: "This refund is no longer waiting on Paystack. Refresh the queue.",
  trip_cancel_refund_not_refused: "Paystack has not refused this refund. Refresh the queue.",
  refunded_elsewhere_required: "Enter the amount Paystack shows already refunded on this payment.",
  trip_cancel_nothing_left: "Nothing is left to refund on this payment after that amount. Escalate it instead.",
  trip_cancel_not_in_progress: "This cancel is already finished. Refresh the queue.",
  trip_cancel_refund_too_recent: "This refund was sent in the last 15 minutes. Wait for Paystack to answer, then try again.",
  trip_cancel_refund_amount_or_currency_mismatch: "This refund changed since you opened it. Refresh the queue and try again.",
  trip_cancel_refund_not_recorded: "The refund could not be recorded, so nothing was saved. Try again or ask engineering.",
  reason_invalid_length: "Write why you are doing this (3 to 500 characters).",
};

/** Plain words for a failed trip cancel action (falls back to the page's). */
export function tripCancelErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error?.message ?? error ?? "");
  const known = Object.keys(TRIP_CANCEL_ERROR_WORDS).find((code) => message.includes(code));
  return known ? TRIP_CANCEL_ERROR_WORDS[known] : refundQueueErrorMessage(error, "action");
}
