/**
 * brandPaystackService — frontend wrapper for the META-ORCH-1076 Phase 2
 * Paystack payout-onboarding edge function (`brand-paystack-onboard`).
 *
 * The Paystack analog of brandStripeService. Paystack has no embedded KYC
 * component — onboarding is a Mingla-owned bank-details form:
 *   List Banks → Resolve Account (verify name) → Create Subaccount.
 *
 * All calls go through the single multiplexed edge function, selected by `action`.
 * Error contract mirrors brandStripeService: throw on edge-fn error; never null.
 */

import { supabase } from "./supabase";

export interface PaystackBankOption {
  name: string;
  code: string;
}

export interface PaystackResolvedAccount {
  account_name: string;
  account_number: string;
}

export interface PaystackSubaccountResult {
  subaccount_code: string;
  account_name: string;
  account_number_masked: string;
  payment_provider: "paystack";
  payment_country: string;
}

export interface PaystackOnboardStatus {
  connected: boolean;
  is_verified: boolean;
  active?: boolean;
  settlement_bank: string | null;
  account_number_masked: string | null;
}

async function unwrapError(fn: string, error: unknown): Promise<Error> {
  // Supabase FunctionsHttpError carries the JSON body on error.context.
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.detail || body?.error) {
        return new Error(`${fn}: ${body.error ?? "error"}${body.detail ? ` (${body.detail})` : ""}`);
      }
    } catch {
      // fall through to generic
    }
  }
  return error instanceof Error ? error : new Error(`${fn}: unknown error`);
}

/** List NG NUBAN settlement banks for the picker. */
export async function listPaystackBanks(): Promise<PaystackBankOption[]> {
  const { data, error } = await supabase.functions.invoke<{ banks: PaystackBankOption[] }>(
    "brand-paystack-onboard",
    { body: { action: "list_banks" } },
  );
  if (error) throw await unwrapError("listPaystackBanks", error);
  return data?.banks ?? [];
}

/** Verify an account number against a bank; returns the holder name to confirm. */
export async function resolvePaystackAccount(
  brandId: string,
  accountNumber: string,
  bankCode: string,
): Promise<PaystackResolvedAccount> {
  const { data, error } = await supabase.functions.invoke<PaystackResolvedAccount>(
    "brand-paystack-onboard",
    {
      body: {
        action: "resolve_account",
        brand_id: brandId,
        account_number: accountNumber,
        bank_code: bankCode,
      },
    },
  );
  if (error) throw await unwrapError("resolvePaystackAccount", error);
  if (!data) throw new Error("resolvePaystackAccount: edge fn returned null");
  return data;
}

/** Create the brand's subaccount and flip it onto the Paystack rail. */
export async function createPaystackSubaccount(
  brandId: string,
  accountNumber: string,
  bankCode: string,
): Promise<PaystackSubaccountResult> {
  const { data, error } = await supabase.functions.invoke<PaystackSubaccountResult>(
    "brand-paystack-onboard",
    {
      body: {
        action: "create_subaccount",
        brand_id: brandId,
        account_number: accountNumber,
        bank_code: bankCode,
      },
    },
  );
  if (error) throw await unwrapError("createPaystackSubaccount", error);
  if (!data) throw new Error("createPaystackSubaccount: edge fn returned null");
  return data;
}

/** Change the settlement bank on the EXISTING subaccount (same code). */
export async function updatePaystackSubaccount(
  brandId: string,
  accountNumber: string,
  bankCode: string,
): Promise<PaystackSubaccountResult> {
  const { data, error } = await supabase.functions.invoke<PaystackSubaccountResult>(
    "brand-paystack-onboard",
    {
      body: {
        action: "update_subaccount",
        brand_id: brandId,
        account_number: accountNumber,
        bank_code: bankCode,
      },
    },
  );
  if (error) throw await unwrapError("updatePaystackSubaccount", error);
  if (!data) throw new Error("updatePaystackSubaccount: edge fn returned null");
  return data;
}

/**
 * Flip the brand onto the Paystack rail (Nigeria) without a subaccount yet —
 * the entry point from the payout country picker. The Payments tab then shows
 * the bank-details form.
 */
export async function selectPaystackProvider(brandId: string): Promise<void> {
  const { error } = await supabase.functions.invoke(
    "brand-paystack-onboard",
    { body: { action: "select_provider", brand_id: brandId } },
  );
  if (error) throw await unwrapError("selectPaystackProvider", error);
}

/**
 * Reverse of selectPaystackProvider: a brand that picked Nigeria but hasn't
 * connected a bank reverts to the Stripe rail (to choose a different country).
 */
export async function clearPaystackProvider(brandId: string): Promise<void> {
  const { error } = await supabase.functions.invoke(
    "brand-paystack-onboard",
    { body: { action: "clear_provider", brand_id: brandId } },
  );
  if (error) throw await unwrapError("clearPaystackProvider", error);
}

/** Disconnect the brand's payout bank (clears the subaccount link). */
export async function disconnectPaystack(brandId: string): Promise<void> {
  const { error } = await supabase.functions.invoke(
    "brand-paystack-onboard",
    { body: { action: "disconnect", brand_id: brandId } },
  );
  if (error) throw await unwrapError("disconnectPaystack", error);
}

/** Re-poll the subaccount's verification/active state for the readiness card. */
export async function refreshPaystackStatus(
  brandId: string,
): Promise<PaystackOnboardStatus> {
  const { data, error } = await supabase.functions.invoke<PaystackOnboardStatus>(
    "brand-paystack-onboard",
    { body: { action: "refresh_status", brand_id: brandId } },
  );
  if (error) throw await unwrapError("refreshPaystackStatus", error);
  if (!data) throw new Error("refreshPaystackStatus: edge fn returned null");
  return data;
}
