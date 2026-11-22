// issue #4522 (N5) — money a trip order collected beyond what it owed, as
// Admin's order view shows it: each overpayment, its amount going back to the
// traveler and where its refund stands. Pure: the page passes the balance it
// read (admin_trip_order_balance), or null when the order has no v2 balance.

export const OVERPAYMENT_STATE_LABEL = {
  held: "Held — refund starting",
  refund_pending: "Refunding",
  refund_failed: "Refund failed — retrying",
  refunded: "Refunded",
  applied: "Applied to the balance",
};

const REASON_LABEL = {
  flex_exceeds_balance: "Paid more than the balance",
  superseded_row_collected: "A cancelled payment was charged",
  late_amount_mismatch: "Late payment for an unexpected amount",
  collected_above_row: "Charged above the payment due",
};

/** The rows of the Overpayments section; [] when there are none. */
export function overpaymentRows(balance) {
  const list = Array.isArray(balance?.overpayments) ? balance.overpayments : [];
  return list
    .filter((op) => op && Number.isSafeInteger(op.refundMinor) && op.refundMinor > 0)
    .map((op) => ({
      id: String(op.overpaymentId ?? ""),
      amountMinor: op.refundMinor,
      currency: String(op.currency ?? balance?.currency ?? ""),
      state: String(op.state ?? ""),
      stateLabel: OVERPAYMENT_STATE_LABEL[op.state] ?? String(op.state ?? "—"),
      reasonLabel: REASON_LABEL[op.reason] ?? String(op.reason ?? "—"),
      createdAt: op.createdAt ?? null,
      resolvedAt: op.resolvedAt ?? null,
      attempts: Number.isSafeInteger(op.attempts) ? op.attempts : 0,
      needsAttention: op.state === "refund_failed",
    }));
}
