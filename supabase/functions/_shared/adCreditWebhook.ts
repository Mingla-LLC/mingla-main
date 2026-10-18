/**
 * toward #3697 Wave 7c — Ads credit webhook apply (Stripe + Paystack).
 * Client apply remains the fast path; ledger idempotency `top_up:{ref}` collapses doubles.
 * Withdraw refunds: Stripe/Paystack lifecycle events mark `ad_credit_provider_refunds`.
 */

import {
  AD_CREDIT_TOP_UP_PURPOSE,
  isAdCreditPaystackReference,
  verifyAdCreditTopUpPaymentIntent,
} from "./adCreditStripe.ts";
import { quoteTopUp } from "./adMoney.ts";
import { resolveAdBrandCurrency } from "./adCurrencyAuthority.ts";

export const AD_CREDIT_WITHDRAW_PURPOSE = "ad_credit_withdraw";
export const AD_CREDIT_WD_MERCHANT_PREFIX = "ad_credit_wd:";

/** Loose admin client — stripe/paystack routers pass the service-role Supabase client.
 * `rpc` / `from` are typed loosely because supabase-js Thenables are not Promise<T>. */
// deno-lint-ignore no-explicit-any
type AdminClient = {
  // deno-lint-ignore no-explicit-any
  rpc: (...args: any[]) => any;
  // deno-lint-ignore no-explicit-any
  from: (...args: any[]) => any;
};

export function isAdCreditTopUpStripeObject(
  obj: { metadata?: Record<string, string> | null } | null | undefined,
): boolean {
  return obj?.metadata?.mingla_purpose === AD_CREDIT_TOP_UP_PURPOSE;
}

/** Apply credit from a succeeded platform PaymentIntent (webhook or client). */
export async function applyAdCreditTopUpFromPaymentIntent(
  supabase: AdminClient,
  pi: {
    id?: string | null;
    status?: string | null;
    amount?: number | null;
    currency?: string | null;
    metadata?: Record<string, string> | null;
  },
): Promise<{ brandId: string | null; applied: boolean; detail?: string }> {
  if (!isAdCreditTopUpStripeObject(pi)) {
    return { brandId: null, applied: false, detail: "not_ad_credit" };
  }
  const brandId = pi.metadata?.brand_id ?? null;
  const payCents = typeof pi.amount === "number" ? pi.amount : NaN;
  const currency = (pi.currency ?? "").toUpperCase();
  if (!brandId || !pi.id) {
    return { brandId, applied: false, detail: "missing_fields" };
  }
  const authority = await resolveAdBrandCurrency(supabase, brandId);
  if (!authority.ok) {
    return { brandId, applied: false, detail: authority.detail };
  }
  if (
    authority.authority.provider !== "stripe" ||
    currency !== authority.currency
  ) {
    return {
      brandId,
      applied: false,
      detail: "payment_currency_authority_mismatch",
    };
  }
  const quoted = quoteTopUp(payCents, currency);
  if (!quoted.ok) {
    return { brandId, applied: false, detail: quoted.detail };
  }
  const verified = verifyAdCreditTopUpPaymentIntent(pi, {
    brandId,
    payCents: quoted.pay_cents,
    currency: quoted.currency,
  });
  if (!verified.ok) {
    return { brandId, applied: false, detail: verified.detail };
  }
  const { error } = await supabase.rpc("ad_credit_apply", {
    p_brand_id: brandId,
    p_entry_kind: "top_up",
    p_amount_cents: quoted.credit_cents,
    p_currency: quoted.currency,
    p_idempotency_key: `top_up:${pi.id}`,
    p_fee_cents: quoted.fee_cents,
    p_pay_cents: quoted.pay_cents,
    p_refund_cents: null,
    p_campaign_id: null,
    p_external_ref: pi.id,
    p_actor_id: pi.metadata?.actor_id ?? null,
    p_metadata: { source: "stripe_webhook", purpose: AD_CREDIT_TOP_UP_PURPOSE },
  });
  if (error) {
    return { brandId, applied: false, detail: error.message };
  }
  return { brandId, applied: true };
}

export async function applyAdCreditTopUpFromPaystackCharge(
  supabase: AdminClient,
  data: Record<string, unknown>,
): Promise<{ brandId: string | null; applied: boolean; detail?: string }> {
  const reference = String(data.reference ?? "");
  if (!isAdCreditPaystackReference(reference)) {
    return { brandId: null, applied: false, detail: "not_ad_credit" };
  }
  const status = String(data.status ?? "");
  if (status !== "success") {
    return { brandId: null, applied: false, detail: "payment_not_succeeded" };
  }
  const metaRaw = data.metadata;
  const meta = metaRaw && typeof metaRaw === "object"
    ? metaRaw as Record<string, unknown>
    : {};
  const brandId = typeof meta.brand_id === "string" ? meta.brand_id : null;
  const payCents = typeof data.amount === "number" ? data.amount : NaN;
  const currency = typeof data.currency === "string"
    ? data.currency.toUpperCase()
    : "NGN";
  if (!brandId) {
    return { brandId: null, applied: false, detail: "missing_brand" };
  }
  if (String(meta.mingla_purpose ?? "") !== AD_CREDIT_TOP_UP_PURPOSE) {
    return { brandId, applied: false, detail: "payment_purpose_mismatch" };
  }
  const authority = await resolveAdBrandCurrency(supabase, brandId);
  if (!authority.ok) {
    return { brandId, applied: false, detail: authority.detail };
  }
  if (
    authority.authority.provider !== "paystack" ||
    currency !== authority.currency
  ) {
    return {
      brandId,
      applied: false,
      detail: "payment_currency_authority_mismatch",
    };
  }
  const quoted = quoteTopUp(payCents, currency);
  if (!quoted.ok) {
    return { brandId, applied: false, detail: quoted.detail };
  }
  const { error } = await supabase.rpc("ad_credit_apply", {
    p_brand_id: brandId,
    p_entry_kind: "top_up",
    p_amount_cents: quoted.credit_cents,
    p_currency: quoted.currency,
    p_idempotency_key: `top_up:${reference}`,
    p_fee_cents: quoted.fee_cents,
    p_pay_cents: quoted.pay_cents,
    p_refund_cents: null,
    p_campaign_id: null,
    p_external_ref: reference,
    p_actor_id: typeof meta.actor_id === "string" ? meta.actor_id : null,
    p_metadata: {
      source: "paystack_webhook",
      purpose: AD_CREDIT_TOP_UP_PURPOSE,
    },
  });
  if (error) {
    return { brandId, applied: false, detail: error.message };
  }
  return { brandId, applied: true };
}

function withdrawRefundStatusFromStripe(
  refundStatus: string,
): "succeeded" | "pending" | "failed" {
  const s = refundStatus.toLowerCase();
  if (s === "succeeded") return "succeeded";
  if (s === "failed" || s === "canceled") return "failed";
  return "pending";
}

function withdrawRefundStatusFromPaystack(
  eventName: string,
): "succeeded" | "pending" | "failed" {
  if (eventName === "refund.processed") return "succeeded";
  if (eventName === "refund.failed") return "failed";
  return "pending";
}

async function markProviderRefundRow(
  supabase: AdminClient,
  rowId: string,
  status: "succeeded" | "pending" | "failed",
  providerRefundId: string | null,
  errorDetail: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("ad_credit_mark_provider_refund", {
    p_id: rowId,
    p_status: status,
    p_provider_refund_id: providerRefundId,
    p_error_detail: errorDetail,
  });
  if (error) {
    throw new Error(`ad_credit_mark_provider_refund_failed:${error.message}`);
  }
}

/**
 * Stripe refund.* for platform Ads-credit withdraw.
 * Returns brand_id when handled; null when this event is not an Ads withdraw.
 */
export async function applyAdCreditWithdrawFromStripeRefund(
  supabase: AdminClient,
  refund: {
    id?: string | null;
    status?: string | null;
    amount?: number | null;
    payment_intent?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<{ handled: boolean; brandId: string | null }> {
  const meta = refund.metadata ?? {};
  if (String(meta.mingla_purpose ?? "") !== AD_CREDIT_WITHDRAW_PURPOSE) {
    return { handled: false, brandId: null };
  }
  const refundId = typeof refund.id === "string" ? refund.id : "";
  const brandHint = typeof meta.brand_id === "string" ? meta.brand_id : null;
  const paymentRef = typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : "";
  const amount = typeof refund.amount === "number" ? refund.amount : NaN;
  const status = withdrawRefundStatusFromStripe(String(refund.status ?? ""));

  let row: { id: string; brand_id: string } | null = null;
  if (refundId) {
    const { data, error } = await supabase
      .from("ad_credit_provider_refunds")
      .select("id, brand_id")
      .eq("provider", "stripe")
      .eq("provider_refund_id", refundId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `ad_credit_withdraw_refund_lookup_failed:${error.message}`,
      );
    }
    row = data ?? null;
  }
  if (
    !row && paymentRef && brandHint && Number.isFinite(amount) && amount > 0
  ) {
    const { data, error } = await supabase
      .from("ad_credit_provider_refunds")
      .select("id, brand_id")
      .eq("provider", "stripe")
      .eq("brand_id", brandHint)
      .eq("payment_ref", paymentRef)
      .eq("pay_take_cents", amount)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(
        `ad_credit_withdraw_refund_fallback_lookup_failed:${error.message}`,
      );
    }
    row = data ?? null;
  }
  if (!row) {
    throw new Error("ad_credit_withdraw_refund_row_missing");
  }
  await markProviderRefundRow(
    supabase,
    row.id,
    status,
    refundId || null,
    status === "failed" ? `stripe_refund_${refund.status ?? "unknown"}` : null,
  );
  return { handled: true, brandId: row.brand_id };
}

/**
 * Paystack refund.* for Ads-credit withdraw (merchant_note `ad_credit_wd:*`).
 */
export async function applyAdCreditWithdrawFromPaystackRefund(
  supabase: AdminClient,
  eventName:
    | "refund.pending"
    | "refund.processing"
    | "refund.needs-attention"
    | "refund.processed"
    | "refund.failed",
  data: {
    id?: unknown;
    merchant_note?: unknown;
  },
): Promise<boolean> {
  const merchantNote = typeof data.merchant_note === "string"
    ? data.merchant_note
    : "";
  if (!merchantNote.startsWith(AD_CREDIT_WD_MERCHANT_PREFIX)) {
    return false;
  }
  const providerRefundId =
    typeof data.id === "string" || typeof data.id === "number"
      ? String(data.id)
      : "";
  const status = withdrawRefundStatusFromPaystack(eventName);

  let row: { id: string } | null = null;
  // Prefer provider id (always set once the create call returns).
  if (providerRefundId) {
    const { data: byProvider, error: provErr } = await supabase
      .from("ad_credit_provider_refunds")
      .select("id")
      .eq("provider", "paystack")
      .eq("provider_refund_id", providerRefundId)
      .maybeSingle();
    if (provErr) {
      throw new Error(
        `ad_credit_wd_paystack_provider_lookup_failed:${provErr.message}`,
      );
    }
    row = byProvider ?? null;
  }
  // merchant_note may be truncated to Paystack's 100-char limit — prefix match.
  if (!row && merchantNote) {
    const { data: byKey, error: keyErr } = await supabase
      .from("ad_credit_provider_refunds")
      .select("id")
      .eq("provider", "paystack")
      .like("idempotency_key", `${merchantNote}%`)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (keyErr) {
      throw new Error(`ad_credit_wd_paystack_lookup_failed:${keyErr.message}`);
    }
    row = byKey ?? null;
  }
  if (!row) {
    throw new Error("ad_credit_wd_paystack_row_missing");
  }
  await markProviderRefundRow(
    supabase,
    row.id,
    status,
    providerRefundId || null,
    status === "failed" ? "paystack_refund_failed" : null,
  );
  return true;
}
