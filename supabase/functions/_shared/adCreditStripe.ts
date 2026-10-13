/**
 * toward #3697 Wave 7b — Ads credit platform charge verify helpers.
 *
 * Top-up credit is written only after a real Stripe PaymentIntent succeeds
 * on the Mingla platform account (host → Mingla). Uses the existing
 * TICKET_CHECKOUT RAK for platform PIs (no stripeAccount / no application fee);
 * a dedicated AD_CREDIT role can replace that later without changing verify.
 */

export const AD_CREDIT_TOP_UP_PURPOSE = "ad_credit_top_up" as const;

export type AdCreditTopUpPiLike = {
  id?: string | null;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
};

export type AdCreditTopUpVerifyOk = { ok: true };
export type AdCreditTopUpVerifyErr = {
  ok: false;
  detail:
    | "payment_ref_invalid"
    | "payment_not_found"
    | "payment_not_succeeded"
    | "payment_mismatch"
    | "payment_brand_mismatch"
    | "payment_purpose_mismatch";
};

/**
 * Fail-closed checks before `ad_credit_apply` for a top-up PaymentIntent.
 */
export function verifyAdCreditTopUpPaymentIntent(
  pi: AdCreditTopUpPiLike | null | undefined,
  expected: {
    brandId: string;
    payCents: number;
    currency: string;
  },
): AdCreditTopUpVerifyOk | AdCreditTopUpVerifyErr {
  if (!pi || typeof pi !== "object") {
    return { ok: false, detail: "payment_not_found" };
  }
  if (typeof pi.id !== "string" || !pi.id.startsWith("pi_")) {
    return { ok: false, detail: "payment_ref_invalid" };
  }
  if (pi.status !== "succeeded") {
    return { ok: false, detail: "payment_not_succeeded" };
  }
  const currency = (pi.currency ?? "").toUpperCase();
  const expectedCurrency = expected.currency.trim().toUpperCase();
  if (
    typeof pi.amount !== "number" ||
    pi.amount !== expected.payCents ||
    currency !== expectedCurrency
  ) {
    return { ok: false, detail: "payment_mismatch" };
  }
  const meta = pi.metadata ?? {};
  if (meta.mingla_purpose !== AD_CREDIT_TOP_UP_PURPOSE) {
    return { ok: false, detail: "payment_purpose_mismatch" };
  }
  if (meta.brand_id !== expected.brandId) {
    return { ok: false, detail: "payment_brand_mismatch" };
  }
  return { ok: true };
}

export function adCreditTopUpMetadata(input: {
  brandId: string;
  payCents: number;
  currency: string;
  actorId: string;
}): Record<string, string> {
  return {
    mingla_purpose: AD_CREDIT_TOP_UP_PURPOSE,
    brand_id: input.brandId,
    pay_cents: String(input.payCents),
    currency: input.currency.trim().toUpperCase(),
    actor_id: input.actorId,
  };
}

/** Stripe card top-up: USD/GBP. NGN uses Paystack (`isAdCreditPaystackTopUpCurrency`). */
export function isAdCreditStripeTopUpCurrency(currency: string): boolean {
  const c = currency.trim().toUpperCase();
  return c === "USD" || c === "GBP";
}

/** Wave 7c — Paystack NGN top-up reference prefix (webhook discriminator). */
export const AD_CREDIT_PAYSTACK_REF_PREFIX = "mingla_adc_" as const;

export function isAdCreditPaystackTopUpCurrency(currency: string): boolean {
  return currency.trim().toUpperCase() === "NGN";
}

export function isAdCreditPaystackReference(reference: string): boolean {
  return typeof reference === "string" &&
    reference.startsWith(AD_CREDIT_PAYSTACK_REF_PREFIX);
}

export function buildAdCreditPaystackReference(input: {
  brandId: string;
  clientIdem: string;
}): string {
  const compact = input.clientIdem.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `${AD_CREDIT_PAYSTACK_REF_PREFIX}${input.brandId.replace(/-/g, "").slice(0, 12)}_${compact}`
    .slice(0, 100);
}
