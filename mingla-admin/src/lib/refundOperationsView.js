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
