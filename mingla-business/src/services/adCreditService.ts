/**
 * toward #3697 Wave 7 — Host Ads credit client (Wave 6 `ad-credit` edge).
 *
 * Mirrors growthToolsService: `supabase.functions.invoke` + typed errors.
 * Mutating apply_* stays for the charge/refund adapter follow-up; this
 * surface reads the wallet and quotes top-up / withdraw fee splits.
 */

import { supabase } from "./supabase";

export type AdCreditAppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "validation_error"
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
  wallet: {
    brand_id: string;
    currency: string;
    balance_cents: number;
    updated_at: string | null;
  };
  history: AdCreditLedgerRow[];
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
  payCents: number,
  currency: string,
): Promise<AdCreditTopUpQuote> {
  return invokeAdCredit<AdCreditTopUpQuote>({
    action: "quote_top_up",
    pay_cents: payCents,
    currency,
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
