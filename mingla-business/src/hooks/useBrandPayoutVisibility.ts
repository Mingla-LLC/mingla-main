/**
 * useBrandPayoutVisibility — #3645 PR10. React Query read of
 * `brand_get_payout_visibility` for the Payments status card + Paystack balance
 * tiles. Same posture as useBrandPayoutLedger: auth-ready gate, 30s stale time,
 * no polling (payout facts change at payment/sweep scale, not poll scale).
 *
 * `enabled` is caller-supplied so a screen the caller may not read (below
 * finance_manager) never fires a request that can only 42501.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchBrandPayoutVisibility } from "../services/brandPayoutLedgerService";
import type { BrandPayoutVisibilityDTO } from "../utils/brandPayoutVisibilityData";

const STALE_TIME_MS = 30 * 1000;

export const brandPayoutVisibilityKeys = {
  all: ["brand-payout-visibility"] as const,
  detail: (brandId: string): readonly ["brand-payout-visibility", string] =>
    [...brandPayoutVisibilityKeys.all, brandId] as const,
};

const DISABLED_KEY = ["brand-payout-visibility-disabled"] as const;

export function useBrandPayoutVisibility(
  brandId: string | null,
  options: { enabled?: boolean } = {},
): UseQueryResult<BrandPayoutVisibilityDTO | null> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && options.enabled !== false;

  return useQuery<BrandPayoutVisibilityDTO | null>({
    queryKey: enabled && brandId !== null
      ? brandPayoutVisibilityKeys.detail(brandId)
      : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    retry: 1,
    queryFn: async (): Promise<BrandPayoutVisibilityDTO | null> => {
      if (brandId === null) {
        throw new Error("useBrandPayoutVisibility: brandId is null but enabled");
      }
      return fetchBrandPayoutVisibility(brandId);
    },
  });
}
