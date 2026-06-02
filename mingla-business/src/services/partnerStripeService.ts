/**
 * partnerStripeService — frontend wrapper for ORCH-1052 partner-Stripe edge
 * functions. Mirrors brandStripeService for the partner identity (account-
 * level Stripe Connect).
 *
 * Calls:
 *  - partner-stripe-onboard          (initiates onboarding session)
 *  - partner-stripe-account-session  (mints fresh AccountSession)
 *
 * React Query keys live in partnerStripeKeys. Hook layer lives in
 * useStartPartnerStripeOnboarding / usePartnerStripeStatus.
 */

import { supabase } from "./supabase";
import { businessWebOriginOverrideBody } from "./businessWebOriginOverride";

export type PartnerStripeStatus =
  | "not_a_partner"
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted";

export interface PartnerStripeStatusRow {
  status: PartnerStripeStatus;
  account_id: string | null;
  country: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  external_account_currencies: string[];
  detached_at: string | null;
  partner_enabled: boolean;
  partner_country: string | null;
}

export interface StartPartnerOnboardingInput {
  country: string;
  returnUrl: string;
}

export interface StartPartnerOnboardingResult {
  client_secret: string;
  account_id: string;
  onboarding_url: string;
}

export interface PartnerAccountSessionResult {
  client_secret: string;
  account_id: string;
  target_url: string;
}

export const partnerStripeKeys = {
  all: ["partnerStripe"] as const,
  status: () => [...partnerStripeKeys.all, "status"] as const,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads partner-enabled flag + Stripe mirror row direct from Supabase. The
 * partner_stripe_connect_accounts table is self-readable per ORCH-1052 RLS
 * (account_id = auth.uid()). creator_accounts.partner_enabled is readable
 * by the owning account under existing RLS. */
export async function getPartnerStripeStatus(): Promise<PartnerStripeStatusRow> {
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    throw new Error("not_authenticated");
  }
  const userId = userResult.user.id;

  const { data: account, error: accountErr } = await supabase
    .from("creator_accounts")
    .select("id, partner_enabled, partner_country")
    .eq("id", userId)
    .maybeSingle<{
      id: string;
      partner_enabled: boolean | null;
      partner_country: string | null;
    }>();
  if (accountErr) throw new Error(accountErr.message);

  const partnerEnabled = account?.partner_enabled === true;
  const partnerCountry = account?.partner_country ?? null;

  if (!partnerEnabled) {
    return {
      status: "not_a_partner",
      account_id: null,
      country: null,
      charges_enabled: false,
      payouts_enabled: false,
      external_account_currencies: [],
      detached_at: null,
      partner_enabled: false,
      partner_country: partnerCountry,
    };
  }

  const { data: sca, error: scaErr } = await supabase
    .from("partner_stripe_connect_accounts")
    .select(
      "stripe_account_id, country, charges_enabled, payouts_enabled, external_account_currencies, detached_at",
    )
    .eq("account_id", userId)
    .maybeSingle<{
      stripe_account_id: string | null;
      country: string | null;
      charges_enabled: boolean | null;
      payouts_enabled: boolean | null;
      external_account_currencies: unknown;
      detached_at: string | null;
    }>();
  if (scaErr) throw new Error(scaErr.message);

  if (!sca?.stripe_account_id) {
    return {
      status: "not_connected",
      account_id: null,
      country: null,
      charges_enabled: false,
      payouts_enabled: false,
      external_account_currencies: [],
      detached_at: null,
      partner_enabled: true,
      partner_country: partnerCountry,
    };
  }

  const currencies = Array.isArray(sca.external_account_currencies)
    ? sca.external_account_currencies
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.toLowerCase())
    : [];

  let status: PartnerStripeStatus;
  if (sca.detached_at !== null) {
    status = "not_connected";
  } else if (sca.charges_enabled === true && sca.payouts_enabled === true) {
    status = "active";
  } else if (sca.charges_enabled === true || sca.payouts_enabled === true) {
    status = "restricted";
  } else {
    status = "onboarding";
  }

  return {
    status,
    account_id: sca.stripe_account_id,
    country: sca.country,
    charges_enabled: sca.charges_enabled ?? false,
    payouts_enabled: sca.payouts_enabled ?? false,
    external_account_currencies: currencies,
    detached_at: sca.detached_at,
    partner_enabled: true,
    partner_country: partnerCountry,
  };
}

export async function startPartnerOnboarding(
  input: StartPartnerOnboardingInput,
): Promise<StartPartnerOnboardingResult> {
  const { data, error } = await supabase.functions.invoke<
    StartPartnerOnboardingResult
  >("partner-stripe-onboard", {
    body: {
      country: input.country,
      return_url: input.returnUrl,
      ...businessWebOriginOverrideBody(),
    },
  });
  if (error) {
    throw new Error(error.message ?? "partner_stripe_onboard_failed");
  }
  if (!data || !isRecord(data) || typeof data.client_secret !== "string") {
    throw new Error("partner_stripe_onboard_invalid_response");
  }
  return data;
}

export async function refreshPartnerAccountSession(
  surface: "onboarding" | "account_management",
): Promise<PartnerAccountSessionResult> {
  const { data, error } = await supabase.functions.invoke<
    PartnerAccountSessionResult
  >("partner-stripe-account-session", {
    body: {
      surface,
      ...businessWebOriginOverrideBody(),
    },
  });
  if (error) {
    throw new Error(error.message ?? "partner_stripe_account_session_failed");
  }
  if (!data || !isRecord(data) || typeof data.client_secret !== "string") {
    throw new Error("partner_stripe_account_session_invalid_response");
  }
  return data;
}

export interface PartnerDetachResult {
  ok: boolean;
  status: "detached" | "not_connected";
  stripe_delete_error?: string | null;
}

/**
 * Soft-detaches the caller's partner Stripe Connect account. Calls the
 * partner-stripe-detach edge fn which marks
 * partner_stripe_connect_accounts.detached_at = NOW() and attempts to
 * delete the Stripe account itself. After this resolves, the partner
 * status flips back to "not_connected" and the picker is editable again.
 */
export async function detachPartnerStripe(): Promise<PartnerDetachResult> {
  const { data, error } = await supabase.functions.invoke<PartnerDetachResult>(
    "partner-stripe-detach",
    { body: {} },
  );
  if (error) {
    throw new Error(error.message ?? "partner_stripe_detach_failed");
  }
  if (!data || !isRecord(data)) {
    throw new Error("partner_stripe_detach_invalid_response");
  }
  return data;
}
