/**
 * partnerPaystackService — ORCH-1331 frontend wrapper for the partner Paystack
 * payout-onboarding edge function (`partner-paystack-onboard`).
 *
 * The Paystack analog of partnerStripeService, shaped like brandPaystackService
 * (Paystack has no embedded KYC — onboarding is a Mingla-owned bank-details
 * form: List Banks → Resolve Account (verify name) → Create Transfer Recipient).
 *
 * All calls go through the single multiplexed edge function, selected by
 * `action`. Error contract mirrors brandPaystackService: throw on edge-fn
 * error (unwrapError surfaces the {error, detail} body); never null.
 */

import { supabase } from "./supabase";
import type { PaystackBankOption } from "./brandPaystackService";

export interface PartnerPaystackStatusRow {
  connected: boolean;
  bank_name: string | null;
  bank_code: string | null;
  account_number_masked: string | null;
  account_name: string | null;
  detached_at: string | null;
}

export interface PartnerPaystackRecipientResult {
  recipient_code: string;
  account_name: string;
  account_number_masked: string;
  currency: "NGN";
}

export interface PartnerPaystackResolvedAccount {
  account_name: string;
  account_number: string;
}

export const partnerPaystackKeys = {
  all: ["partnerPaystack"] as const,
  status: () => [...partnerPaystackKeys.all, "status"] as const,
  banks: () => [...partnerPaystackKeys.all, "banks"] as const,
};

async function unwrapError(fn: string, error: unknown): Promise<Error> {
  // Supabase FunctionsHttpError carries the JSON body on error.context.
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.detail || body?.error) {
        return new Error(
          `${fn}: ${body.error ?? "error"}${body.detail ? ` (${body.detail})` : ""}`,
        );
      }
    } catch {
      // fall through to generic
    }
  }
  return error instanceof Error ? error : new Error(`${fn}: unknown error`);
}

/** The caller's own Paystack payout status (connected:false when absent/detached). */
export async function getPartnerPaystackStatus(): Promise<PartnerPaystackStatusRow> {
  const { data, error } = await supabase.functions.invoke<PartnerPaystackStatusRow>(
    "partner-paystack-onboard",
    { body: { action: "status" } },
  );
  if (error) throw await unwrapError("getPartnerPaystackStatus", error);
  if (!data) throw new Error("getPartnerPaystackStatus: edge fn returned null");
  return data;
}

/** NG NUBAN settlement banks for the picker. */
export async function listPartnerPaystackBanks(): Promise<PaystackBankOption[]> {
  const { data, error } = await supabase.functions.invoke<{ banks: PaystackBankOption[] }>(
    "partner-paystack-onboard",
    { body: { action: "list_banks" } },
  );
  if (error) throw await unwrapError("listPartnerPaystackBanks", error);
  return data?.banks ?? [];
}

/** Verify an account number against a bank; returns the holder name to confirm. */
export async function resolvePartnerPaystackAccount(
  accountNumber: string,
  bankCode: string,
): Promise<PartnerPaystackResolvedAccount> {
  const { data, error } = await supabase.functions.invoke<PartnerPaystackResolvedAccount>(
    "partner-paystack-onboard",
    {
      body: {
        action: "resolve_account",
        account_number: accountNumber,
        bank_code: bankCode,
      },
    },
  );
  if (error) throw await unwrapError("resolvePartnerPaystackAccount", error);
  if (!data) {
    throw new Error("resolvePartnerPaystackAccount: edge fn returned null");
  }
  return data;
}

/** Create the partner's Transfer Recipient (their payout bank on file). */
export async function createPartnerPaystackRecipient(
  accountNumber: string,
  bankCode: string,
  bankName: string,
): Promise<PartnerPaystackRecipientResult> {
  const { data, error } = await supabase.functions.invoke<PartnerPaystackRecipientResult>(
    "partner-paystack-onboard",
    {
      body: {
        action: "create_recipient",
        account_number: accountNumber,
        bank_code: bankCode,
        bank_name: bankName,
      },
    },
  );
  if (error) throw await unwrapError("createPartnerPaystackRecipient", error);
  if (!data) {
    throw new Error("createPartnerPaystackRecipient: edge fn returned null");
  }
  return data;
}

/** Soft-detach the partner's payout bank (reconnect anytime). */
export async function disconnectPartnerPaystack(): Promise<void> {
  const { error } = await supabase.functions.invoke(
    "partner-paystack-onboard",
    { body: { action: "disconnect" } },
  );
  if (error) throw await unwrapError("disconnectPartnerPaystack", error);
}
