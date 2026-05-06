/**
 * brandStripeService — frontend wrapper for B2a Stripe Connect edge functions.
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.3.1.
 *
 * Calls:
 *  - brand-stripe-onboard (initiates onboarding session)
 *  - brand-stripe-refresh-status (refresh from Stripe API; safety-net poll)
 *
 * Error contract per Const #3: throws on Postgrest/edge-fn error; never returns null.
 * Hook layer (useStartBrandStripeOnboarding + useBrandStripeStatus) maps to UI.
 */

import { supabase } from "./supabase";

export type BrandStripeStatus =
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted";

export interface StartOnboardingResult {
  client_secret: string;
  account_id: string;
  onboarding_url: string;
}

export interface RefreshStatusResult {
  status: BrandStripeStatus;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements: Record<string, unknown>;
  detached_at: string | null;
}

/**
 * Initiates Stripe Connect Express onboarding for a brand.
 *
 * @param brandId — UUID of the brand initiating onboarding
 * @param returnUrl — Deep link or web URL to return to after onboarding
 *   Must start with "mingla-business://" or "https://business.mingla.com/"
 * @throws on edge fn error, validation error, or permission denial
 */
export async function startBrandStripeOnboarding(
  brandId: string,
  returnUrl: string,
): Promise<StartOnboardingResult> {
  const { data, error } = await supabase.functions.invoke<StartOnboardingResult>(
    "brand-stripe-onboard",
    { body: { brand_id: brandId, return_url: returnUrl } },
  );
  if (error) throw error;
  if (data === null) {
    throw new Error("startBrandStripeOnboarding: edge fn returned null");
  }
  return data;
}

/**
 * Refreshes brand Stripe Connect status from Stripe API.
 * Used as the 30s poll-fallback safety net per D-B2-11.
 *
 * @param brandId — UUID of the brand to refresh
 * @throws on edge fn error or permission denial
 */
export async function refreshBrandStripeStatus(
  brandId: string,
): Promise<RefreshStatusResult> {
  const { data, error } = await supabase.functions.invoke<RefreshStatusResult>(
    "brand-stripe-refresh-status",
    { body: { brand_id: brandId } },
  );
  if (error) throw error;
  if (data === null) {
    throw new Error("refreshBrandStripeStatus: edge fn returned null");
  }
  return data;
}
