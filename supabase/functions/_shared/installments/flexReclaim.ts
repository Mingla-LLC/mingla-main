/**
 * issue #4522 (rework F2) — abandoned flexible payments.
 *
 * A buyer who opens "Pay {amount}" and closes the payment sheet leaves an
 * unconfirmed PaymentIntent and an open flexible row. After the reclaim
 * window the database stops treating it as in flight
 * (`issue_4522_flex_reclaim_window()`), and the next begin or the scheduled
 * sweep releases the row. The edge then cancels each released Stripe
 * PaymentIntent, best-effort: if the buyer confirms it before the cancel
 * lands, the late success still settles exactly once
 * (`issue_4522_record_late_collection`), so a failed cancel never loses money.
 */

/** Mirror of issue_4522_flex_reclaim_window(): the instalment reconcile's 15 minutes. */
export const FLEX_RECLAIM_WINDOW_MS = 15 * 60 * 1000;

export interface ReleasedFlexPayment {
  installmentId: string;
  provider: string | null;
  stripePaymentIntentId: string | null;
  orderId?: string;
}

export interface PaymentIntentCanceller {
  paymentIntents: {
    cancel(
      id: string,
      params: Record<string, unknown>,
      options: { idempotencyKey: string; stripeAccount: string },
    ): Promise<unknown>;
  };
}

/** Released rows from an RPC answer (anything malformed is skipped). */
export function releasedFlexPayments(value: unknown): ReleasedFlexPayment[] {
  if (!Array.isArray(value)) return [];
  const out: ReleasedFlexPayment[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.installmentId !== "string") continue;
    out.push({
      installmentId: row.installmentId,
      provider: typeof row.provider === "string" ? row.provider : null,
      stripePaymentIntentId: typeof row.stripePaymentIntentId === "string"
        ? row.stripePaymentIntentId
        : null,
      ...(typeof row.orderId === "string" ? { orderId: row.orderId } : {}),
    });
  }
  return out;
}

/**
 * Cancel each released Stripe PaymentIntent on its connected account. Never
 * throws: a cancel that fails (already confirmed, already cancelled, network)
 * is logged and left to the late-success path. Returns how many were sent.
 */
export async function cancelReleasedFlexIntents(
  stripe: PaymentIntentCanceller,
  released: readonly ReleasedFlexPayment[],
  stripeAccountFor: (payment: ReleasedFlexPayment) => Promise<string | null>,
): Promise<number> {
  let sent = 0;
  for (const payment of released) {
    if (payment.provider !== "stripe" || payment.stripePaymentIntentId === null) continue;
    try {
      const stripeAccount = await stripeAccountFor(payment);
      if (stripeAccount === null) continue;
      await stripe.paymentIntents.cancel(payment.stripePaymentIntentId, {}, {
        idempotencyKey: `flex-release-cancel:${payment.installmentId}:${payment.stripePaymentIntentId}`,
        stripeAccount,
      });
      sent += 1;
    } catch (error) {
      console.warn(JSON.stringify({
        event: "flex_release_cancel_failed",
        installmentId: payment.installmentId,
        reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }));
    }
  }
  return sent;
}
