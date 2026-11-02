/**
 * #3355 P5 — React Query hooks over the canonical brand readiness read.
 *
 * One read per (brand, action), cached under `brandReadinessKeys` (nested in
 * the brand detail key, so brand writes refresh it). Home calls it with no
 * action (the whole list).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import type {
  BrandReadiness,
  BrandReadinessAction,
} from "../services/brandReadinessService";
import { brandReadinessKeys } from "./brandReadinessKeys";

/** Spec 10.2: readiness is cheap but composite; 30 s keeps Home snappy. */
export const BRAND_READINESS_STALE_TIME_MS = 30 * 1000;

const DISABLED_KEY = ["brand-readiness-disabled"] as const;

export function useBrandReadiness(
  brandId: string | null,
  action: BrandReadinessAction | null = null,
): UseQueryResult<BrandReadiness, Error> {
  const { isAuthReady, user } = useAuth();
  const enabled = isAuthReady && user !== null && brandId !== null;
  return useQuery<BrandReadiness, Error>({
    queryKey:
      enabled && brandId !== null
        ? brandReadinessKeys.detail(brandId, action)
        : DISABLED_KEY,
    enabled,
    staleTime: BRAND_READINESS_STALE_TIME_MS,
    queryFn: async (): Promise<BrandReadiness> => {
      if (brandId === null) {
        throw new Error("useBrandReadiness: brandId is null but enabled");
      }
      // #3355 — the read and its shape check load with the first read, not
      // on every visitor's boot path (#3493): Home is in the eager chunk.
      const { fetchBrandReadiness } = await import(
        "../services/brandReadinessService"
      );
      return fetchBrandReadiness(brandId, action);
    },
  });
}
