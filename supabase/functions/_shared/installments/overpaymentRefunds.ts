/**
 * issue #4522 (rework N2) — money a trip order collected beyond what it owed
 * goes back to the traveler automatically, against the charge that carried it.
 *
 * The database owns the state (issue_4522_begin_overpayment_refund /
 * issue_4522_finish_overpayment_refund; the policy lives in
 * issue_4522_overpayment_policy). This module only talks to the provider:
 *   Stripe   — a partial refund of the PaymentIntent on the brand's connected
 *              account (refund_application_fee, as every Mingla ticket
 *              refund), with the attempt's idempotency key;
 *   Paystack — a partial refund of the transaction (createPaystackRefund,
 *              merchant note = the same key, so a retry finds the same refund).
 * A timeout or provider outage is "unknown": the attempt stays pending and the
 * sweep repeats it with the SAME key, so it can never become a second refund.
 * Only a definitive refusal is "failed": retried later with the next attempt
 * key; from the third failure ops is alerted (existing ops-alert path).
 * Callers: the success webhooks right after a settle that held money, the
 * cancel path, and the scheduled sweep (process-scheduled-installments).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createPaystackRefund,
  isRetryablePaystackRefundError,
  paystackRefundOutcomeStatus,
  paystackRefundTransaction,
} from "../paystackRefunds.ts";

interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

export interface OverpaymentStripe {
  refunds: {
    create(
      params: Record<string, unknown>,
      options: { idempotencyKey: string; stripeAccount: string },
    ): Promise<{ id?: string; status?: string | null }>;
  };
}

export interface OverpaymentRefundDeps {
  supabase: RpcClient;
  stripe: () => OverpaymentStripe;
  stripeAccountForBrand: (brandId: string) => Promise<string | null>;
  createPaystackRefund: typeof createPaystackRefund;
  alertOps: (subject: string, paragraphs: string[]) => Promise<void>;
}

export type OverpaymentOutcome = "succeeded" | "pending" | "unknown" | "failed" | "done" | "skipped";

interface Begun {
  ok?: boolean;
  done?: boolean;
  reason?: string;
  overpaymentId?: string;
  orderId?: string;
  installmentId?: string;
  brandId?: string;
  provider?: string;
  providerRef?: string;
  refundMinor?: number;
  currency?: string;
  refundId?: string;
  attemptNo?: number;
  idempotencyKey?: string;
}

/** Stripe answered for good (a 4xx refusal other than a conflict or rate limit). */
export function isDefinitiveStripeRefusal(error: unknown): boolean {
  const e = error as { statusCode?: unknown; type?: unknown } | null;
  const status = typeof e?.statusCode === "number" ? e.statusCode : null;
  if (status === null) return false;
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}

function stripeOutcome(status: string | null | undefined): "succeeded" | "pending" | "failed" {
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "canceled") return "failed";
  return "pending";
}

async function finish(
  deps: OverpaymentRefundDeps,
  begun: Begun,
  outcome: "succeeded" | "pending" | "unknown" | "failed",
  providerRefundId: string | null,
  errorText: string | null,
): Promise<OverpaymentOutcome> {
  const { data, error } = await deps.supabase.rpc("issue_4522_finish_overpayment_refund", {
    p_overpayment_id: begun.overpaymentId,
    p_attempt_no: begun.attemptNo,
    p_outcome: outcome,
    p_provider_refund_id: providerRefundId,
    p_error: errorText,
  });
  if (error !== null) throw new Error(`overpayment_finish_failed:${error.message ?? "unknown"}`);
  const result = (data ?? {}) as { alertOps?: boolean; attemptNo?: number };
  if (result.alertOps === true) {
    await deps.alertOps("Trip overpayment refund keeps failing", [
      "Mingla could not return a traveler's overpayment automatically after several tries.",
      `Order: ${begun.orderId ?? "?"}`,
      `Amount: ${begun.refundMinor ?? "?"} (${begun.currency ?? "?"} minor units)`,
      `Last error: ${errorText ?? "unknown"}`,
      "It is retried automatically. Refund it by hand in the provider dashboard if it keeps failing.",
    ]);
  }
  return outcome;
}

/** Return one overpayment (begin → provider → finish). Never throws on a provider error. */
export async function returnOverpayment(
  deps: OverpaymentRefundDeps,
  overpaymentId: string,
): Promise<OverpaymentOutcome> {
  const { data, error } = await deps.supabase.rpc("issue_4522_begin_overpayment_refund", {
    p_overpayment_id: overpaymentId,
  });
  if (error !== null) throw new Error(`overpayment_begin_failed:${error.message ?? "unknown"}`);
  const begun = (data ?? {}) as Begun;
  if (begun.ok === true && begun.done === true) return "done";
  if (begun.ok !== true) return "skipped";
  const amount = Number(begun.refundMinor);
  const key = String(begun.idempotencyKey ?? "");
  const ref = String(begun.providerRef ?? "");
  if (!Number.isSafeInteger(amount) || amount <= 0 || key === "" || ref === "") {
    return await finish(deps, begun, "failed", null, "overpayment_attempt_invalid");
  }

  if (begun.provider === "stripe") {
    const account = await deps.stripeAccountForBrand(String(begun.brandId ?? ""));
    if (account === null) return await finish(deps, begun, "failed", null, "no_connected_account");
    try {
      const refund = await deps.stripe().refunds.create(
        {
          payment_intent: ref,
          amount,
          reason: "requested_by_customer",
          refund_application_fee: true,
          metadata: {
            mingla_overpayment_id: String(begun.overpaymentId),
            mingla_order_id: String(begun.orderId ?? ""),
            mingla_refund_id: String(begun.refundId ?? ""),
            mingla_installment_id: String(begun.installmentId ?? ""),
          },
        },
        { idempotencyKey: key, stripeAccount: account },
      );
      return await finish(deps, begun, stripeOutcome(refund.status), refund.id ?? null, null);
    } catch (err) {
      const text = err instanceof Error ? err.message.slice(0, 280) : "stripe_refund_error";
      return await finish(deps, begun, isDefinitiveStripeRefusal(err) ? "failed" : "unknown", null, text);
    }
  }

  if (begun.provider === "paystack") {
    const transaction = paystackRefundTransaction(ref, null);
    if (transaction === null) return await finish(deps, begun, "failed", null, "no_transaction");
    try {
      const refund = await deps.createPaystackRefund({
        transaction,
        merchantNote: key,
        amountSubunits: amount,
        currency: String(begun.currency ?? "NGN").toUpperCase(),
      });
      const status = paystackRefundOutcomeStatus(refund.status ?? null);
      return await finish(
        deps,
        begun,
        status === "processed" ? "succeeded" : status === "failed" ? "failed" : "pending",
        refund.id ?? null,
        null,
      );
    } catch (err) {
      const text = err instanceof Error ? err.message.slice(0, 280) : "paystack_refund_error";
      return await finish(deps, begun, isRetryablePaystackRefundError(err) ? "unknown" : "failed", null, text);
    }
  }
  return await finish(deps, begun, "failed", null, "unknown_provider");
}

/** Return every overpayment the database says is due (one order, or all). */
export async function returnDueOverpayments(
  deps: OverpaymentRefundDeps,
  orderId: string | null,
  limit = 100,
): Promise<Record<OverpaymentOutcome, number>> {
  const counts: Record<OverpaymentOutcome, number> = {
    succeeded: 0,
    pending: 0,
    unknown: 0,
    failed: 0,
    done: 0,
    skipped: 0,
  };
  const { data, error } = await deps.supabase.rpc("issue_4522_overpayments_due", {
    p_order_id: orderId,
    p_limit: limit,
  });
  if (error !== null) throw new Error(`overpayments_due_failed:${error.message ?? "unknown"}`);
  for (const row of Array.isArray(data) ? data : []) {
    const id = (row as { overpaymentId?: unknown } | null)?.overpaymentId;
    if (typeof id !== "string") continue;
    try {
      counts[await returnOverpayment(deps, id)] += 1;
    } catch (err) {
      console.error(JSON.stringify({
        event: "overpayment_return_failed",
        overpaymentId: id,
        reason: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      }));
      counts.unknown += 1;
    }
  }
  return counts;
}

/** The brand's connected Stripe account (null when none is attached). */
export async function stripeAccountForBrandFrom(
  supabase: SupabaseClient,
  brandId: string,
): Promise<string | null> {
  if (brandId === "") return null;
  const { data } = await supabase.from("stripe_connect_accounts").select("stripe_account_id")
    .eq("brand_id", brandId).is("detached_at", null).maybeSingle();
  const id = (data as { stripe_account_id?: unknown } | null)?.stripe_account_id;
  return typeof id === "string" ? id : null;
}
