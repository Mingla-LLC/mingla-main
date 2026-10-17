/**
 * toward #3697 Wave 7 / 7b — Host Ads credit client (`ad-credit` edge).
 *
 * Wave 7: wallet + quotes. Wave 7b: Stripe platform top-up start/apply
 * (USD/GBP). Withdraw refund + Paystack stay deferred.
 */

import { supabase } from "./supabase";

export type AdCreditAppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "validation_error"
  | "currency_authority_unresolved"
  | "insufficient_credit"
  | "apply_failed"
  | "network"
  | "unknown";

export class AdCreditAppError extends Error {
  readonly code: AdCreditAppErrorCode;
  readonly detail: string | null;

  constructor(code: AdCreditAppErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.name = "AdCreditAppError";
    this.code = code;
    this.detail = detail;
  }
}

export type AdCreditLedgerRow = {
  id: string;
  entry_kind: string;
  amount_cents: number;
  fee_cents: number;
  pay_cents: number | null;
  refund_cents: number | null;
  balance_after_cents: number;
  currency: string;
  created_at: string;
  external_ref: string | null;
};

export type AdCreditWalletPayload = {
  wallet: null | {
    brand_id: string;
    currency: string;
    authority_currency: string;
    currency_status: string;
    balance_cents: number;
    updated_at: string | null;
  };
  history: AdCreditLedgerRow[];
  currency_authority: {
    resolved: boolean;
    currency: string | null;
    provider: string | null;
    rail_currency?: string | null;
    reason: string | null;
  };
};

export type AdCreditTopUpQuote = {
  ok: true;
  pay_cents: number;
  credit_cents: number;
  fee_cents: number;
  currency: string;
};

export type AdCreditWithdrawQuote = {
  ok: true;
  credit_cents: number;
  refund_cents: number;
  fee_returned_cents: number;
  note?: string;
};

export type AdCreditStartTopUpSheet = {
  ok: true;
  kind: "requires_payment_sheet";
  client_secret: string;
  payment_intent_id: string;
  quote: AdCreditTopUpQuote;
};

export type AdCreditStartTopUpRedirect = {
  ok: true;
  kind: "requires_checkout_redirect";
  url: string;
  checkout_session_id: string;
  payment_intent_id: string | null;
  /** Present for NGN Paystack top-ups (`mingla_adc_…`). */
  paystack_reference?: string;
  quote: AdCreditTopUpQuote;
};

export type AdCreditStartTopUpResult =
  | AdCreditStartTopUpSheet
  | AdCreditStartTopUpRedirect;

export type AdCreditApplyTopUpResult = {
  ok: true;
  quote: AdCreditTopUpQuote;
  result: unknown;
  payment_ref: string;
};

async function invokeAdCredit<T>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ad-credit", { body });
  if (error !== null) {
    let payload: { error?: string; detail?: string } | null = null;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        payload = (await ctx.json()) as { error?: string; detail?: string };
      }
    } catch {
      payload = null;
    }
    const code = (payload?.error ?? "unknown") as AdCreditAppErrorCode;
    const known: AdCreditAppErrorCode[] = [
      "unauthorized",
      "forbidden",
      "validation_error",
      "currency_authority_unresolved",
      "insufficient_credit",
      "apply_failed",
    ];
    throw new AdCreditAppError(
      known.includes(code) ? code : "network",
      payload?.detail ?? error.message ?? "ad_credit_failed",
      payload?.detail ?? null,
    );
  }
  if (data && typeof data === "object" && "error" in data) {
    const errBody = data as { error: string; detail?: string };
    throw new AdCreditAppError(
      (errBody.error as AdCreditAppErrorCode) || "unknown",
      errBody.detail ?? errBody.error,
      errBody.detail ?? null,
    );
  }
  return data as T;
}

export async function getAdCreditWallet(
  brandId: string,
): Promise<AdCreditWalletPayload> {
  return invokeAdCredit<AdCreditWalletPayload>({
    action: "get_wallet",
    brand_id: brandId,
  });
}

export async function quoteAdCreditTopUp(
  brandId: string,
  payCents: number,
): Promise<AdCreditTopUpQuote> {
  return invokeAdCredit<AdCreditTopUpQuote>({
    action: "quote_top_up",
    brand_id: brandId,
    pay_cents: payCents,
  });
}

export async function quoteAdCreditWithdraw(
  creditCents: number,
): Promise<AdCreditWithdrawQuote> {
  return invokeAdCredit<AdCreditWithdrawQuote>({
    action: "quote_withdraw",
    credit_cents: creditCents,
  });
}

export async function startAdCreditTopUp(input: {
  brandId: string;
  payCents: number;
  /** Stable per Confirm attempt; required by edge for Stripe create idempotency. */
  idempotencyKey: string;
  /** Web Checkout return URL; omit on native for PaymentSheet. */
  returnUrl?: string;
}): Promise<AdCreditStartTopUpResult> {
  return invokeAdCredit<AdCreditStartTopUpResult>({
    action: "start_top_up",
    brand_id: input.brandId,
    pay_cents: input.payCents,
    idempotency_key: input.idempotencyKey,
    ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
  });
}

export async function applyAdCreditTopUp(input: {
  brandId: string;
  paymentRef?: string;
  checkoutSessionId?: string;
  paystackReference?: string;
  idempotencyKey?: string;
}): Promise<AdCreditApplyTopUpResult> {
  return invokeAdCredit<AdCreditApplyTopUpResult>({
    action: "apply_top_up",
    brand_id: input.brandId,
    ...(input.paymentRef ? { payment_ref: input.paymentRef } : {}),
    ...(input.checkoutSessionId
      ? { checkout_session_id: input.checkoutSessionId }
      : {}),
    ...(input.paystackReference
      ? { paystack_reference: input.paystackReference }
      : {}),
    ...(input.idempotencyKey
      ? { idempotency_key: input.idempotencyKey }
      : {}),
  });
}

export type AdCreditApplyWithdrawResult = {
  ok: true;
  estimate: AdCreditWithdrawQuote;
  result: unknown;
  provider_refund_cents: number | null;
};

export async function applyAdCreditWithdraw(input: {
  brandId: string;
  creditCents: number;
  idempotencyKey: string;
}): Promise<AdCreditApplyWithdrawResult> {
  return invokeAdCredit<AdCreditApplyWithdrawResult>({
    action: "apply_withdraw",
    brand_id: input.brandId,
    credit_cents: input.creditCents,
    idempotency_key: input.idempotencyKey,
  });
}
