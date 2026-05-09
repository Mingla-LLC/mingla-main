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

declare const __DEV__: boolean | undefined;

export type BrandStripeStatus =
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted";

export interface StartOnboardingResult {
  client_secret: string | null;
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

type SupabaseFunctionError = Error & {
  context?: {
    clone?: () => {
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
    };
    status?: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatFunctionErrorPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const error = typeof payload.error === "string" ? payload.error : null;
  const detail = typeof payload.detail === "string" ? payload.detail : null;
  if (error && detail) return `${error}: ${detail}`;
  return detail ?? error;
}

function shouldLogDiagnostics(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

async function unwrapFunctionError(
  functionName: string,
  error: Error,
): Promise<Error> {
  const functionError = error as SupabaseFunctionError;
  const response = functionError.context?.clone?.();
  if (!response) return error;

  try {
    const payload = response.json ? await response.json() : null;
    const formatted = formatFunctionErrorPayload(payload);
    if (shouldLogDiagnostics()) {
      // eslint-disable-next-line no-console
      console.error(`[${functionName}] edge function failed`, {
        status: functionError.context?.status,
        payload,
      });
    }
    if (formatted) return new Error(formatted);
  } catch {
    try {
      const text = response.text ? await response.text() : "";
      if (shouldLogDiagnostics()) {
        // eslint-disable-next-line no-console
        console.error(`[${functionName}] edge function failed`, {
          status: functionError.context?.status,
          body: text,
        });
      }
      if (text.trim().length > 0) return new Error(text.trim());
    } catch {
      // Fall through to the original Supabase error.
    }
  }
  return error;
}

/**
 * Initiates Stripe Connect Express onboarding for a brand.
 *
 * @param brandId — UUID of the brand initiating onboarding
 * @param returnUrl — Deep link or web URL to return to after onboarding
 *   Must start with "mingla-business://" or the configured Mingla Business URL.
 * @throws on edge fn error, validation error, or permission denial
 */
export async function startBrandStripeOnboarding(
  brandId: string,
  returnUrl: string,
  country = "GB",
): Promise<StartOnboardingResult> {
  const { data, error } = await supabase.functions.invoke<StartOnboardingResult>(
    "brand-stripe-onboard",
    { body: { brand_id: brandId, return_url: returnUrl, country } },
  );
  if (error) throw await unwrapFunctionError("brand-stripe-onboard", error);
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
  if (error) {
    throw await unwrapFunctionError("brand-stripe-refresh-status", error);
  }
  if (data === null) {
    throw new Error("refreshBrandStripeStatus: edge fn returned null");
  }
  return data;
}
