/**
 * useBrandStripeBalances — reads available + pending balance from Stripe via edge fn.
 *
 * Per B2a Path C V3 SPEC §6 + Const #4 (query keys from factory) + Const #5 (server state via React Query).
 *
 * Cache strategy:
 *  - staleTime 30s — balances change slowly relative to UI render frequency
 *  - refetchInterval 60s — periodic refresh while the dashboard is open
 *  - enabled gated on brandId !== null AND stripe-status is "active" (caller passes)
 *
 * Mutation invalidations elsewhere (detach, payout webhook) should
 * invalidate `brandStripeBalancesKeys.detail(brandId)` to keep this fresh.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchBrandStripeBalances,
  type BrandStripeBalancesResult,
} from "../services/brandStripeBalancesService";

const STALE_TIME_MS = 30 * 1000;
const REFETCH_INTERVAL_MS = 60 * 1000;

export const brandStripeBalancesKeys = {
  all: ["brand-stripe-balances"] as const,
  detail: (brandId: string): readonly ["brand-stripe-balances", string] =>
    [...brandStripeBalancesKeys.all, brandId] as const,
};

const DISABLED_KEY = ["brand-stripe-balances-disabled"] as const;

export interface UseBrandStripeBalancesOptions {
  /** Caller passes the brand's stripe status; we only fetch when "active" */
  stripeStatus: string | null;
}

export function useBrandStripeBalances(
  brandId: string | null,
  options: UseBrandStripeBalancesOptions,
): UseQueryResult<BrandStripeBalancesResult> {
  const enabled = brandId !== null && options.stripeStatus === "active";

  return useQuery<BrandStripeBalancesResult>({
    queryKey: enabled
      ? brandStripeBalancesKeys.detail(brandId)
      : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    refetchInterval: enabled ? REFETCH_INTERVAL_MS : false,
    queryFn: async (): Promise<BrandStripeBalancesResult> => {
      if (brandId === null) {
        throw new Error("useBrandStripeBalances: brandId is null but enabled");
      }
      return fetchBrandStripeBalances(brandId);
    },
  });
}
