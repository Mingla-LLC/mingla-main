/**
 * brandStripeAccountSessionService — frontend wrapper for embedded Stripe
 * Connect Account Sessions.
 */

import { supabase } from "./supabase";
import { businessWebOriginOverrideBody } from "./businessWebOriginOverride";

export type BrandStripeAccountSessionSurface =
  | "account_management"
  | "onboarding";

export interface BrandStripeAccountSessionResult {
  clientSecret: string;
  accountId: string;
  targetUrl: string;
}

interface RawResponse {
  client_secret?: string;
  account_id?: string;
  target_url?: string;
}

export async function fetchBrandStripeAccountSession(
  brandId: string,
  surface: BrandStripeAccountSessionSurface,
  /**
   * #3645 — Host web passes an HTTPS Payments return URL so Done can land
   * back in the same tab. Native omits this; the edge defaults to the deep link.
   */
  returnUrl?: string,
): Promise<BrandStripeAccountSessionResult> {
  const { data, error } = await supabase.functions.invoke<RawResponse>(
    "brand-stripe-account-session",
    {
      body: {
        brand_id: brandId,
        surface,
        ...(typeof returnUrl === "string" && returnUrl.length > 0
          ? { return_url: returnUrl }
          : {}),
        ...businessWebOriginOverrideBody(),
      },
    },
  );
  if (error) throw error;
  if (data === null) {
    throw new Error("fetchBrandStripeAccountSession: edge fn returned null");
  }
  if (
    typeof data.client_secret !== "string" || data.client_secret.length === 0
  ) {
    throw new Error(
      "fetchBrandStripeAccountSession: missing client_secret in response",
    );
  }
  if (typeof data.account_id !== "string" || data.account_id.length === 0) {
    throw new Error(
      "fetchBrandStripeAccountSession: missing account_id in response",
    );
  }
  if (typeof data.target_url !== "string" || data.target_url.length === 0) {
    throw new Error(
      "fetchBrandStripeAccountSession: missing target_url in response",
    );
  }
  return {
    clientSecret: data.client_secret,
    accountId: data.account_id,
    targetUrl: data.target_url,
  };
}
