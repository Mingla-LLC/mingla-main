/**
 * issue #4522 (rework N3) — open flexible payments are settled or released
 * only on the provider's answer, never on time alone.
 *
 * A buyer who opens "Pay {amount}" and closes the payment sheet leaves an
 * open flexible row. It blocks the cron, rollover and a new payment until
 * the edge asks the provider what happened to it:
 *   Stripe   — retrieve the PaymentIntent:
 *              succeeded        → settle it now through the webhook's own
 *                                 success handler (idempotent);
 *              canceled         → release (provider_canceled);
 *              requires_payment_method / requires_confirmation
 *                               → cancel, read back canceled, then release;
 *              requires_action  → kept (the buyer may be in a bank check)
 *                                 until FLEX_IN_FLIGHT_CEILING_MS, then
 *                                 cancelled and released the same way;
 *              processing / anything else / no answer
 *                               → kept in flight; past the ceiling it is
 *                                 flagged for ops once (never released).
 *              No PaymentIntent id on the row → nothing was ever presented
 *              to pay (the edge stores the id before it hands the sheet out):
 *              release (no_provider_charge).
 *   Paystack — verify the latest attempt's transaction:
 *              success → settle through the Paystack charge handler;
 *              failed / abandoned / reversed → release (provider_failed);
 *              anything else → kept, flagged past the ceiling.
 *              No attempt at all → release (no_provider_charge).
 * The SQL side (issue_4522_release_flex_verified) refuses any other reason
 * and checks the provider reference against the row.
 */

/** Mirror of issue_4522_flex_reclaim_window(): the instalment reconcile's 15 minutes. */
export const FLEX_RECLAIM_WINDOW_MS = 15 * 60 * 1000;
/** Mirror of issue_4522_flex_in_flight_ceiling(): 24 hours. */
export const FLEX_IN_FLIGHT_CEILING_MS = 24 * 60 * 60 * 1000;

export interface FlexToVerify {
  installmentId: string;
  orderId: string;
  provider: "stripe" | "paystack";
  stripePaymentIntentId: string | null;
  attemptReference: string | null;
  attemptCount: number;
  pastCeiling: boolean;
}

export type FlexVerifyOutcome =
  | "settled"
  | "released"
  | "in_flight"
  | "flagged"
  | "error";

interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

export interface FlexStripe {
  paymentIntents: {
    retrieve(
      id: string,
      params: Record<string, unknown>,
      options: { stripeAccount: string },
    ): Promise<Record<string, unknown>>;
    cancel(
      id: string,
      params: Record<string, unknown>,
      options: { idempotencyKey: string; stripeAccount: string },
    ): Promise<Record<string, unknown>>;
  };
}

export interface FlexVerifyDeps {
  supabase: RpcClient;
  stripe: () => FlexStripe;
  stripeAccountFor: (payment: FlexToVerify) => Promise<string | null>;
  /** The webhook's success path for a Stripe instalment PaymentIntent. */
  settleStripe: (paymentIntent: Record<string, unknown>) => Promise<void>;
  paystackVerify: (reference: string) => Promise<Record<string, unknown>>;
  /** The Paystack instalment charge handler (success path). */
  settlePaystack: (reference: string, txn: Record<string, unknown>) => Promise<void>;
  alertOps: (subject: string, paragraphs: string[]) => Promise<void>;
}

/** The rows from issue_4522_flex_payments_to_verify (malformed ones skipped). */
export function flexPaymentsToVerify(value: unknown): FlexToVerify[] {
  if (!Array.isArray(value)) return [];
  const out: FlexToVerify[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.installmentId !== "string" || typeof row.orderId !== "string") continue;
    if (row.provider !== "stripe" && row.provider !== "paystack") continue;
    out.push({
      installmentId: row.installmentId,
      orderId: row.orderId,
      provider: row.provider,
      stripePaymentIntentId: typeof row.stripePaymentIntentId === "string"
        ? row.stripePaymentIntentId
        : null,
      attemptReference: typeof row.attemptReference === "string" ? row.attemptReference : null,
      attemptCount: Number.isSafeInteger(row.attemptCount) ? Number(row.attemptCount) : 0,
      pastCeiling: row.pastCeiling === true,
    });
  }
  return out;
}

async function release(
  deps: FlexVerifyDeps,
  payment: FlexToVerify,
  verified: "provider_canceled" | "provider_failed" | "no_provider_charge",
  providerRef: string | null,
): Promise<FlexVerifyOutcome> {
  const { data, error } = await deps.supabase.rpc("issue_4522_release_flex_verified", {
    p_installment_id: payment.installmentId,
    p_verified: verified,
    p_provider_ref: providerRef,
  });
  const result = (data ?? null) as { ok?: boolean; released?: boolean; reason?: string } | null;
  if (error !== null || result?.ok !== true) {
    console.warn(JSON.stringify({
      event: "flex_release_refused",
      installmentId: payment.installmentId,
      verified,
      reason: error?.message ?? result?.reason ?? "unknown",
    }));
    return "error";
  }
  return result.released === true ? "released" : "settled";
}

async function keepOrFlag(
  deps: FlexVerifyDeps,
  payment: FlexToVerify,
  providerStatus: string,
): Promise<FlexVerifyOutcome> {
  if (!payment.pastCeiling) return "in_flight";
  const { data, error } = await deps.supabase.rpc("issue_4522_flag_stuck_flex", {
    p_installment_id: payment.installmentId,
    p_provider_status: providerStatus,
  });
  if (error === null && data === true) {
    await deps.alertOps("Trip balance payment still in flight after 24 hours", [
      "A traveler's flexible trip payment has been in flight for more than 24 hours.",
      `Instalment: ${payment.installmentId}`,
      `Order: ${payment.orderId}`,
      `Provider status: ${providerStatus}`,
      "It still blocks the booking's other payments. Check it in the provider dashboard; it is released only when the provider confirms it was cancelled or failed.",
    ]);
  }
  return "flagged";
}

async function verifyStripe(deps: FlexVerifyDeps, payment: FlexToVerify): Promise<FlexVerifyOutcome> {
  const piId = payment.stripePaymentIntentId;
  if (piId === null) return await release(deps, payment, "no_provider_charge", null);
  const account = await deps.stripeAccountFor(payment);
  if (account === null) return await keepOrFlag(deps, payment, "no_connected_account");
  const stripe = deps.stripe();
  let pi: Record<string, unknown>;
  try {
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
    pi = await stripe.paymentIntents.retrieve(piId, {}, { stripeAccount: account });
  } catch {
    return await keepOrFlag(deps, payment, "retrieve_failed");
  }
  let status = String(pi.status ?? "");
  if (status === "succeeded") {
    await deps.settleStripe(pi);
    return "settled";
  }
  if (status === "canceled") return await release(deps, payment, "provider_canceled", piId);
  const cancelable = status === "requires_payment_method" || status === "requires_confirmation" ||
    (status === "requires_action" && payment.pastCeiling);
  if (!cancelable) return await keepOrFlag(deps, payment, status || "unknown");
  try {
    const cancelled = await stripe.paymentIntents.cancel(piId, {}, {
      idempotencyKey: `flex-release-cancel:${payment.installmentId}:${piId}`,
      stripeAccount: account,
    });
    status = String(cancelled.status ?? "");
  } catch {
    // The cancel lost to a confirmation (or the provider did not answer):
    // read it back; only a canceled answer releases.
    try {
      // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
      pi = await stripe.paymentIntents.retrieve(piId, {}, { stripeAccount: account });
      status = String(pi.status ?? "");
      if (status === "succeeded") {
        await deps.settleStripe(pi);
        return "settled";
      }
    } catch {
      return await keepOrFlag(deps, payment, "cancel_unconfirmed");
    }
  }
  if (status === "canceled") return await release(deps, payment, "provider_canceled", piId);
  return await keepOrFlag(deps, payment, status || "cancel_unconfirmed");
}

async function verifyPaystack(deps: FlexVerifyDeps, payment: FlexToVerify): Promise<FlexVerifyOutcome> {
  if (payment.attemptCount === 0 || payment.attemptReference === null) {
    return payment.attemptCount === 0
      ? await release(deps, payment, "no_provider_charge", null)
      : await keepOrFlag(deps, payment, "attempt_reference_missing");
  }
  let txn: Record<string, unknown>;
  try {
    txn = await deps.paystackVerify(payment.attemptReference);
  } catch {
    return await keepOrFlag(deps, payment, "verify_failed");
  }
  const status = String(txn.status ?? "").toLowerCase();
  if (status === "success") {
    await deps.settlePaystack(payment.attemptReference, txn);
    return "settled";
  }
  if (status === "failed" || status === "abandoned" || status === "reversed") {
    return await release(deps, payment, "provider_failed", payment.attemptReference);
  }
  return await keepOrFlag(deps, payment, status || "unknown");
}

/** Ask the provider about each payment and settle or release it on the answer. */
export async function verifyOpenFlexPayments(
  deps: FlexVerifyDeps,
  payments: readonly FlexToVerify[],
): Promise<Record<FlexVerifyOutcome, number>> {
  const counts: Record<FlexVerifyOutcome, number> = {
    settled: 0,
    released: 0,
    in_flight: 0,
    flagged: 0,
    error: 0,
  };
  for (const payment of payments) {
    let outcome: FlexVerifyOutcome;
    try {
      outcome = payment.provider === "stripe"
        ? await verifyStripe(deps, payment)
        : await verifyPaystack(deps, payment);
    } catch (error) {
      console.error(JSON.stringify({
        event: "flex_verify_failed",
        installmentId: payment.installmentId,
        reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }));
      outcome = "error";
    }
    counts[outcome] += 1;
  }
  return counts;
}

/** The open payments of one order (begin) or of every order (the sweep). */
export async function loadFlexPaymentsToVerify(
  supabase: RpcClient,
  orderId: string | null,
  limit = 100,
): Promise<FlexToVerify[]> {
  const { data, error } = await supabase.rpc("issue_4522_flex_payments_to_verify", {
    p_order_id: orderId,
    p_limit: limit,
  });
  if (error !== null) throw new Error(`flex_verify_list_failed:${error.message ?? "unknown"}`);
  return flexPaymentsToVerify(data);
}
