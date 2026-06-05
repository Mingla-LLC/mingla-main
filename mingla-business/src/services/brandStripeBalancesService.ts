/**
 * brandStripeBalancesService — frontend wrapper for `brand-stripe-balances` edge fn.
 *
 * Per B2a Path C V3 SPEC §6 (multi-currency balance display).
 *
 * Returns Stripe-reported available + pending balance amounts for the brand's
 * connected account, filtered to the brand's `default_currency`. Multi-currency
 * brands (rare in V3 — most brands operate in one currency) get the slice that
 * matches their default; the edge fn handles cross-currency filtering server-side.
 *
 * Error contract per Const #3: throws on Postgrest/edge-fn error; never returns null.
 */

import { supabase } from "./supabase";

export interface BrandStripeBalancesResult {
  /** ISO 4217 currency code matching the brand's `default_currency` */
  currency: string;
  /** Available amount in minor units (e.g., pence/cents) */
  availableMinor: number;
  /** Pending amount in minor units (in flight to be available) */
  pendingMinor: number;
  /** Stripe-reported updated-at (ISO timestamp) */
  retrievedAt: string;
}

interface RawBalancesResponse {
  currency?: string;
  available_minor?: number;
  pending_minor?: number;
  retrieved_at?: string;
}

export function parseBrandStripeBalancesResponse(
  data: RawBalancesResponse | null,
): BrandStripeBalancesResult {
  if (data === null) {
    throw new Error("fetchBrandStripeBalances: edge fn returned null");
  }
  if (
    typeof data.currency !== "string" ||
    typeof data.available_minor !== "number" ||
    typeof data.pending_minor !== "number"
  ) {
    throw new Error(
      "fetchBrandStripeBalances: edge fn returned malformed payload",
    );
  }
  return {
    currency: data.currency,
    availableMinor: data.available_minor,
    pendingMinor: data.pending_minor,
    retrievedAt: data.retrieved_at ?? new Date().toISOString(),
  };
}

export async function fetchBrandStripeBalances(
  brandId: string,
): Promise<BrandStripeBalancesResult> {
  // No custom Authorization header: let supabase.functions.invoke use the
  // client's CURRENT (auto-refreshed) session token. META-ORCH-1073 Sub-A5:
  // passing useAuth()'s `session.access_token` sent a STALE token rejected by
  // the edge fn's auth.getUser with 401 (same bug as refreshBrandStripeStatus).
  const { data, error } = await supabase.functions.invoke<RawBalancesResponse>(
    "brand-stripe-balances",
    {
      body: { brand_id: brandId },
    },
  );
  if (error) throw error;
  return parseBrandStripeBalancesResponse(data);
}
