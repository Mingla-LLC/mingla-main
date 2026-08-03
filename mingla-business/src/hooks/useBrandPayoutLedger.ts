/**
 * useBrandPayoutLedger — READ-ONLY React Query hook for the #1180 payout UI.
 *
 * Mirrors useBrandStripeBalances (query-key factory, 30s staleTime, auth-ready
 * gate) but with NO refetchInterval — ledger rows change at event-scale, not
 * poll-scale (SPEC §4.1). Server state via React Query only (Constitution #5).
 *
 * enabled ⇔ isAuthReady && brandId !== null. The tables are all RLS
 * auth.uid()-scoped, so firing before the access token is attached returns an
 * empty set that would cache as "no payouts"; isAuthReady ⟹ a usable session
 * (same posture as useCurrentBrandRole).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchBrandPayoutLedger,
} from "../services/brandPayoutLedgerService";
import type { BrandPayoutLedger } from "../utils/payoutBreakdown";

const STALE_TIME_MS = 30 * 1000;

export const brandPayoutLedgerKeys = {
  all: ["brand-payout-ledger"] as const,
  detail: (brandId: string): readonly ["brand-payout-ledger", string] =>
    [...brandPayoutLedgerKeys.all, brandId] as const,
};

const DISABLED_KEY = ["brand-payout-ledger-disabled"] as const;

export function useBrandPayoutLedger(
  brandId: string | null,
): UseQueryResult<BrandPayoutLedger> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null;

  return useQuery<BrandPayoutLedger>({
    queryKey:
      enabled && brandId !== null
        ? brandPayoutLedgerKeys.detail(brandId)
        : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<BrandPayoutLedger> => {
      if (brandId === null) {
        throw new Error("useBrandPayoutLedger: brandId is null but enabled");
      }
      return fetchBrandPayoutLedger(brandId);
    },
  });
}
