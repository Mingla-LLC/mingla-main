/**
 * toward #3697 Wave 7 / 7b — Host Ads credit client (`ad-credit` edge).
 *
 * Wave 7: wallet + quotes. Wave 7b: Stripe platform top-up start/apply
 * (USD/GBP). Withdraw refund + Paystack stay deferred.
 */

import { edgeErrorCode } from "./edgeErrorCode";
import { supabase } from "./supabase";
import type { HostAdCapabilities } from "./hostAdPlanService";

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

export type AdCreditTopUpLimits = { min_pay_cents: number; max_pay_cents: number };

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
  /** #4238: least and most one top-up can pay, in pay cents (null or absent before this shipped). */
  top_up_limits?: AdCreditTopUpLimits | null;
  /**
   * #4238 ads roles: what this teammate may do with Ads credit (top_up,
   * withdraw, ...), with who to ask. Absent on older servers.
   */
  capabilities?: HostAdCapabilities;
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
      payload?.detail ?? payload?.error ?? "ad_credit_failed",
      payload?.detail ?? null,
    );
  }
  // #4238: an edge envelope carries `error: null` on success. Fail only on a
  // real error code string, never on the key or an error object.
  if (edgeErrorCode(data) !== null) {
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

/** #4238 ads roles: the quote is checked for this brand (owner or Finance). */
export async function quoteAdCreditWithdraw(
  brandId: string,
  creditCents: number,
): Promise<AdCreditWithdrawQuote> {
  return invokeAdCredit<AdCreditWithdrawQuote>({
    action: "quote_withdraw",
    brand_id: brandId,
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

/** #4238 W6b: one receipt, read from the ledger (no VAT line until decided). */
export type AdCreditReceipt = {
  ledger_id: string;
  kind: string;
  date: string;
  reference: string;
  currency: string;
  you_paid_cents: number | null;
  mingla_fee_cents: number | null;
  mingla_fee_rate: number | null;
  ad_credit_cents: number;
  /** #4238 W6c: the ad this row belongs to, by name (null when none/unknown). */
  ad_name?: string | null;
  refunded_cents: number | null;
  balance_after_cents: number;
};

/** #4238 W6b: a month of Ads credit, per ad, from the ledger. */
export type AdCreditStatement = {
  month: string;
  currency: string | null;
  opening_balance_cents: number;
  top_ups_cents: number;
  fees_cents: number;
  spend_by_ad: {
    ad_key: string;
    /** #4238 W6c: the ad's name; null/absent when it cannot be found. */
    ad_name?: string | null;
    held_cents: number;
    returned_cents: number;
    net_cents: number;
  }[];
  returns_cents: number;
  withdrawals_cents: number;
  closing_balance_cents: number;
  lines: AdCreditReceipt[];
};

export async function getAdCreditReceipt(
  brandId: string,
  ledgerId: string,
): Promise<AdCreditReceipt> {
  const res = await invokeAdCredit<{ receipt: AdCreditReceipt }>({
    action: "get_receipt",
    brand_id: brandId,
    ledger_id: ledgerId,
  });
  return res.receipt;
}

/** `month` is "YYYY-MM" in the brand's records. */
export async function getAdCreditStatement(
  brandId: string,
  month: string,
): Promise<AdCreditStatement> {
  const res = await invokeAdCredit<{ statement: AdCreditStatement }>({
    action: "get_statement",
    brand_id: brandId,
    month,
  });
  return res.statement;
}
