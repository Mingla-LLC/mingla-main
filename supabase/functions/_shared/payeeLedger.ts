// #3872 R2 B3 — referral-payee provider lifecycle adapters.
//
// PostgreSQL owns the ledger and every refund commits before these helpers run.
// Provider reversal failures are intentionally surfaced to logs/retry callers but
// must never roll back or block the buyer/host refund.
// @ts-ignore Deno ESM
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { StripeClient } from "./stripe.ts";

type StripeObject = Record<string, unknown>;

function stringField(value: StripeObject, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function numberField(value: StripeObject, key: string): number | null {
  const field = value[key];
  return typeof field === "number" && Number.isSafeInteger(field) && field >= 0
    ? field
    : null;
}

function metadata(value: StripeObject): Record<string, unknown> {
  const field = value.metadata;
  return field && typeof field === "object"
    ? field as Record<string, unknown>
    : {};
}

async function orderIdForStripeObject(
  supabase: SupabaseClient,
  value: StripeObject,
): Promise<string | null> {
  const meta = metadata(value);
  if (typeof meta.mingla_order_id === "string") return meta.mingla_order_id;
  const paymentIntentId = stringField(value, "payment_intent");
  const chargeId = stringField(value, "charge");
  let query = supabase.from("orders").select("id");
  if (paymentIntentId) {
    query = query.eq("stripe_payment_intent_id", paymentIntentId);
  } else if (chargeId) query = query.eq("stripe_charge_id", chargeId);
  else return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`payee_order_lookup_failed:${error.message}`);
  return typeof data?.id === "string" ? data.id : null;
}

export async function reversePayeeShareAfterStripeMoneyLoss(
  supabase: SupabaseClient,
  stripe: StripeClient,
  input: {
    orderId: string;
    reference: string;
    eligibleMinor: number;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("payee_share_reverse", {
    p_order_kind: "ticket",
    p_order_id: input.orderId,
    p_refund_ref: input.reference,
    p_refunded_eligible_minor: input.eligibleMinor,
  });
  if (error) throw new Error(`payee_share_reverse_failed:${error.message}`);
  const result = (data ?? {}) as Record<string, unknown>;
  const amount = Number(result.providerReversalMinor ?? 0);
  const transferId = typeof result.providerTransferId === "string"
    ? result.providerTransferId
    : null;
  const shareId = typeof result.shareId === "string" ? result.shareId : null;
  if (!transferId || !shareId || !Number.isSafeInteger(amount) || amount <= 0) {
    return result;
  }
  // @ts-ignore Stripe runtime namespace.
  const reversal = await stripe.transfers.createReversal(
    transferId,
    {
      amount,
      metadata: {
        mingla_payee_share_id: shareId,
        mingla_loss_reference: input.reference,
        mingla_issue: "3872",
      },
    },
    { idempotencyKey: `payee_reversal:${shareId}:${input.reference}` },
  ) as { id: string };
  const { error: recordError } = await supabase.rpc(
    "payee_record_stripe_transfer_reversal",
    {
      p_share_id: shareId,
      p_provider_reversal_id: reversal.id,
      p_amount_minor: amount,
    },
  );
  if (recordError) {
    throw new Error(
      `payee_provider_reversal_record_failed:${recordError.message}`,
    );
  }
  return { ...result, providerReversalId: reversal.id };
}

export async function handlePayeeStripeRefund(
  supabase: SupabaseClient,
  stripe: StripeClient,
  value: StripeObject,
): Promise<void> {
  if ((stringField(value, "status") ?? "succeeded") !== "succeeded") return;
  const refundId = stringField(value, "id");
  const amount = numberField(value, "amount");
  if (!refundId || amount === null || amount <= 0) return;
  const orderId = await orderIdForStripeObject(supabase, value);
  if (!orderId) return;
  await reversePayeeShareAfterStripeMoneyLoss(supabase, stripe, {
    orderId,
    reference: `refund:${refundId}`,
    eligibleMinor: amount,
  });
}

export async function handlePayeeStripeDisputeLoss(
  supabase: SupabaseClient,
  stripe: StripeClient,
  value: StripeObject,
): Promise<void> {
  if (stringField(value, "status") !== "lost") return;
  const disputeId = stringField(value, "id");
  const amount = numberField(value, "amount");
  if (!disputeId || amount === null || amount <= 0) return;
  const orderId = await orderIdForStripeObject(supabase, value);
  if (!orderId) return;
  await reversePayeeShareAfterStripeMoneyLoss(supabase, stripe, {
    orderId,
    reference: `dispute:${disputeId}`,
    eligibleMinor: amount,
  });
}

export async function handlePayeeStripeTransferReversed(
  supabase: SupabaseClient,
  value: StripeObject,
): Promise<void> {
  const transferId = stringField(value, "id");
  const amountReversed = numberField(value, "amount_reversed");
  const reversals = value.reversals as
    | { data?: Array<Record<string, unknown>> }
    | undefined;
  // Stripe list collections are newest-first. Use the leading reversal when
  // expanded; the database still interprets amount_reversed as cumulative.
  const latest = reversals?.data?.[0];
  if (!transferId || !amountReversed || amountReversed <= 0) return;
  // Stripe can omit the nested reversal list unless it was expanded. The
  // cumulative reversed amount remains a stable replay key for that transfer.
  const reversalId = (latest ? stringField(latest, "id") : null) ??
    `stripe:${transferId}:${amountReversed}`;
  const { error } = await supabase.rpc(
    "payee_record_stripe_transfer_reversed",
    {
      p_transfer_id: transferId,
      p_reversal_id: reversalId,
      p_amount_minor: amountReversed,
    },
  );
  if (error) {
    throw new Error(`payee_transfer_reversed_record_failed:${error.message}`);
  }
}

export async function syncPayeeStripeAccount(
  supabase: SupabaseClient,
  value: StripeObject,
): Promise<void> {
  const accountId = stringField(value, "id");
  if (!accountId) return;
  const requirements = value.requirements as
    | Record<string, unknown>
    | undefined;
  const currentlyDue = Array.isArray(requirements?.currently_due)
    ? requirements.currently_due
    : [];
  const pastDue = Array.isArray(requirements?.past_due)
    ? requirements.past_due
    : [];
  const active = value.charges_enabled === true &&
    value.payouts_enabled === true &&
    currentlyDue.length === 0 && pastDue.length === 0;
  const { error } = await supabase.from("payee_accounts").update({
    stripe_status: active ? "active" : "restricted",
    stripe_country: typeof value.country === "string"
      ? value.country.toUpperCase()
      : null,
    updated_at: new Date().toISOString(),
  }).eq("stripe_account_id", accountId);
  if (error) throw new Error(`payee_account_sync_failed:${error.message}`);
}

export async function handlePayeePaystackTransferEvent(
  supabase: SupabaseClient,
  eventName: string,
  value: StripeObject,
): Promise<void> {
  const reference = stringField(value, "reference");
  if (!reference?.startsWith("mpay_")) return;
  const transferCode = stringField(value, "transfer_code");
  const failureCode = stringField(value, "failure_code") ??
    stringField(value, "status");
  const { error } = await supabase.rpc("payee_record_paystack_transfer_event", {
    p_reference: reference,
    p_event: eventName,
    p_transfer_code: transferCode,
    p_failure_code: failureCode,
  });
  if (error) {
    throw new Error(`payee_paystack_transfer_record_failed:${error.message}`);
  }
}
