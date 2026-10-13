/**
 * toward #3697 Wave 7c — Ads credit webhook apply (Stripe + Paystack).
 * Client apply remains the fast path; ledger idempotency `top_up:{ref}` collapses doubles.
 */

import {
  AD_CREDIT_TOP_UP_PURPOSE,
  isAdCreditPaystackReference,
  verifyAdCreditTopUpPaymentIntent,
} from "./adCreditStripe.ts";
import { quoteTopUp } from "./adMoney.ts";

type AdminClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
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
    p_metadata: { source: "paystack_webhook", purpose: AD_CREDIT_TOP_UP_PURPOSE },
  });
  if (error) {
    return { brandId, applied: false, detail: error.message };
  }
  return { brandId, applied: true };
}
