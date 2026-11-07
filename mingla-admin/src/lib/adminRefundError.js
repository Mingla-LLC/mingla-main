// What the Admin refund window says when admin-refund-order refuses a refund,
// and whether the refund's idempotency key is spent.
//
// Issue #4271: the server commits a refund 'failed' only when the provider
// provably never saw it (refund_outcome "failed"), and replays of that row
// answer 409 refund_failed. Its key is spent, so the next Refund in the same
// window starts a new refund under a new key, as the Business app does. When
// the outcome is "unknown" money may have moved: the row stays pending and is
// retried under the same key, and the copy never says nothing moved.

/** Map admin-refund-order error codes to user-facing copy (null = unknown code). */
export function adminRefundErrorCopy(code, refundOutcome = null) {
  switch (code) {
    case "refund_exceeds_remaining": return "Amount exceeds what's left to refund.";
    case "line_overrefund": return "One or more items are already fully refunded.";
    // #3281: the last tickets' refund also returns extras, so it waits for any other refund to settle.
    case "refund_pending_on_order": return "Another refund on this order is still going through. Try again once it finishes.";
    case "refund_failed": return "The refund didn't go through, so nothing was refunded. Try again.";
    case "stripe_declined":
      return refundOutcome === "unknown"
        ? "Stripe didn't confirm the refund, so it may still go through. Check Refund operations before trying again."
        : "Stripe declined — no money moved.";
    // #4130: Paystack refunds (admin-refund-order maps these for Paystack brands).
    case "paystack_refund_failed": return "Paystack refused the refund — no money moved.";
    case "paystack_refund_retryable": return "Paystack is busy — nothing was refunded yet. Try again in a few minutes.";
    case "paystack_refund_below_minimum": return "The amount is below Paystack's smallest refund. Refund a larger amount or the full order.";
    case "paystack_refund_duplicate_ambiguous": return "Paystack may already have a refund for this order. Check Refund operations before trying again.";
    case "paystack_refund_transaction_state_ambiguous": return "Paystack could not confirm the payment's state. Check Refund operations before trying again.";
    case "order_not_refundable": return "This order can't be refunded.";
    case "missing_connected_account": return "This brand has no Stripe account to refund from.";
    case "missing_payment_intent": return "This order has no payment reference to refund.";
    case "reason_invalid_length": return "Reason must be 10–200 characters.";
    case "forbidden": return "Admin access required.";
    case "unauthorized": return "Your session expired — sign in again.";
    case "idempotency_key_required": return "Couldn't start the refund. Please retry.";
    default: return null;
  }
}

/**
 * Read an admin-refund-order error body.
 * @returns {{ code: string|null, message: string|null, keySpent: boolean }}
 */
export function describeAdminRefundError(body) {
  const outcome = typeof body?.refund_outcome === "string" ? body.refund_outcome : null;
  const code = outcome === "failed" ? "refund_failed" : (typeof body?.error === "string" ? body.error : null);
  return {
    code,
    message: adminRefundErrorCopy(code, outcome),
    keySpent: code === "refund_failed",
  };
}
