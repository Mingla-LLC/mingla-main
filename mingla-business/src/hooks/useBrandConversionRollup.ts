/**
 * ISSUE-865 PR1 WP-4 — "Customers your ads drove" hook.
 *
 * React Query wrapper over fetchBrandConversionRollup, mirroring
 * useVenueIntelligence: a distinct entity key (`brand-conversion-rollup`) so it
 * never shares/thrashes the venue-intelligence cache, gated on auth session + a
 * non-null brandId, 60s staleTime (this is not real-time). The RPC self-authorizes
 * (owner reads only their brand), so a non-owner simply gets an honest-empty rollup.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  type BrandConversionRollup,
  fetchBrandConversionRollup,
} from "../services/brandConversionRollupService";

export const brandConversionRollupKeys = {
  all: ["brand-conversion-rollup"] as const,
  detail: (brandId: string): readonly ["brand-conversion-rollup", string] =>
    ["brand-conversion-rollup", brandId] as const,
};

const DISABLED_KEY = ["brand-conversion-rollup-disabled"] as const;

export function useBrandConversionRollup(
  brandId: string | null,
): UseQueryResult<BrandConversionRollup> {
  const { loading, session } = useAuth();
  const enabled = !loading && session !== null && brandId !== null;

  return useQuery<BrandConversionRollup>({
    queryKey: enabled && brandId !== null
      ? brandConversionRollupKeys.detail(brandId)
      : DISABLED_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (brandId === null) throw new Error("brandId missing");
      return fetchBrandConversionRollup(brandId);
    },
  });
}
