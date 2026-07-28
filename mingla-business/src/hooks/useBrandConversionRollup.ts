/**
 * ISSUE-865 PR1 WP-4 — "Customers your ads drove" hook.
 *
 * React Query wrapper over fetchBrandConversionRollup, mirroring
 * useVenueIntelligence: a distinct entity key (`brand-conversion-rollup`) so it
 * never shares/thrashes the venue-intelligence cache, 60s staleTime (this is not
 * real-time). The RPC self-authorizes (owner reads only their brand), so a
 * non-owner simply gets an honest-empty rollup.
 *
 * ORCH-1004 auth-scoped query readiness: this reads an auth.uid()-scoped RPC, so
 * it folds `isAuthReady` into `enabled` — a pre-auth fire on cold web load can't
 * cache an RLS-empty 200 as success (registered in
 * orch-1004-auth-scoped-query-readiness.mjs AUTH_SCOPED_HOOK_FILES).
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
  const { isAuthReady } = useAuth();
  // ORCH-1004: fold isAuthReady into enabled so the query never fires before the
  // Supabase session is attached (else the RLS-scoped RPC returns an empty 200
  // that React Query caches as success — the "empty pages until refresh" bug).
  const enabled = isAuthReady && brandId !== null;

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
