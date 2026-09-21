// A paid ticket checkout that was held ONLY because our first signal lacked a
// piece of evidence (no charge id, no Paystack transaction id, the provider
// attempt not yet persisted) completes the sale once complete evidence arrives.
//
// The decision lives in one database owner,
// `release_ticket_checkout_evidence_hold`: it re-proves identity, the
// provider's amount and currency, that no refund has started and that the sale
// is still open, all under the same locks finalize takes. When it answers
// `released`, the session is back to `processing_payment` and the caller's
// ordinary verify + finalize issues the tickets. Every other answer leaves the
// hold and its refund exactly as they were, and the caller's ordinary path
// continues to the refund.
//
// Callers: ticket-checkout-confirm (the buyer's return), the Stripe webhook
// (including Stripe's own retries), the Paystack charge handler (webhook and
// return verify) and reconcile-stuck-checkouts. Each calls this BEFORE verify,
// and only for a session whose reversal_state is `paid_reversal_pending`.

// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => any };

export type EvidenceHoldOutcome =
  | { outcome: "released"; refundsReleased: number }
  | { outcome: "not_held" }
  | {
    outcome: "refund_kept";
    reason:
      | "identity_unverified"
      | "identity_conflict"
      | "amount_mismatch"
      | "refund_in_progress"
      | "sale_unavailable";
  };

export interface EvidenceHoldInput {
  checkoutSessionId: string;
  provider: "stripe" | "paystack";
  paymentReference: string;
  paystackTransactionId: string | null;
  stripeChargeId: string | null;
  observedAccountReference: string | null;
  amountCents: number;
  currency: string;
}

/** True for a session the release owner could act on. Saves an RPC per sale. */
export function isEvidenceHoldCandidate(
  session: Record<string, unknown> | null | undefined,
): boolean {
  return !!session && session.order_id == null &&
    session.reversal_state === "paid_reversal_pending";
}

/**
 * The provider's own amount (smallest unit) and currency for a Stripe
 * PaymentIntent. `amount_received` is what actually moved; `amount` is only a
 * fallback for payloads that omit it. Null when either figure is unusable, so
 * the caller never releases a hold on a guess.
 */
export function stripePaymentIntentAmount(
  paymentIntent: Record<string, unknown>,
): { amountCents: number; currency: string } | null {
  const received = paymentIntent.amount_received;
  const amount = typeof received === "number"
    ? received
    : paymentIntent.amount;
  const currency = paymentIntent.currency;
  if (
    typeof amount !== "number" || !Number.isSafeInteger(amount) ||
    amount < 0 || typeof currency !== "string" ||
    !/^[A-Za-z]{3}$/.test(currency)
  ) {
    return null;
  }
  return { amountCents: amount, currency: currency.toUpperCase() };
}

export async function releaseTicketEvidenceHold(
  client: RpcClient,
  input: EvidenceHoldInput,
): Promise<EvidenceHoldOutcome> {
  const { data, error } = await client.rpc(
    "release_ticket_checkout_evidence_hold",
    {
      p_checkout_session_id: input.checkoutSessionId,
      p_provider: input.provider,
      p_payment_reference: input.paymentReference,
      p_paystack_transaction_id: input.paystackTransactionId,
      p_stripe_charge_id: input.stripeChargeId,
      p_observed_account_reference: input.observedAccountReference,
      p_amount_cents: input.amountCents,
      p_currency: input.currency,
    },
  );
  if (error) {
    throw new Error(
      `ticket evidence hold release failed: ${error.message ?? "unknown"}`,
    );
  }
  const outcome = (data as Record<string, unknown> | null)?.outcome;
  if (outcome === "released") {
    return {
      outcome: "released",
      refundsReleased: Number(
        (data as Record<string, unknown>).refundsReleased ?? 0,
      ),
    };
  }
  if (outcome === "refund_kept") {
    return {
      outcome: "refund_kept",
      reason: String((data as Record<string, unknown>).reason) as Extract<
        EvidenceHoldOutcome,
        { outcome: "refund_kept" }
      >["reason"],
    };
  }
  return { outcome: "not_held" };
}
