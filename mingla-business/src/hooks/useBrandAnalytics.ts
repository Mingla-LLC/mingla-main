import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import {
  fetchBrandCustomerPatternsRollup,
  fetchBrandMinglaDroveRollup,
  fetchBrandRegularsRollup,
  type BrandCustomerPatternsRollup,
  type BrandMinglaDroveRollup,
  type BrandRegularsRollup,
} from "../services/brandAnalyticsService";

const STALE_TIME_MS = 60_000;

export const brandAnalyticsKeys = {
  all: ["brand-analytics"] as const,
  brand: (brandId: string) => ["brand-analytics", brandId] as const,
  minglaDrove: (brandId: string) =>
    [...brandAnalyticsKeys.brand(brandId), "mingla-drove"] as const,
  regulars: (brandId: string) =>
    [...brandAnalyticsKeys.brand(brandId), "regulars"] as const,
  patterns: (brandId: string) =>
    [...brandAnalyticsKeys.brand(brandId), "patterns"] as const,
  disabledMinglaDrove: ["brand-analytics", "disabled", "mingla-drove"] as const,
  disabledRegulars: ["brand-analytics", "disabled", "regulars"] as const,
  disabledPatterns: ["brand-analytics", "disabled", "patterns"] as const,
};

export const useBrandMinglaDroveRollup = (
  brandId: string | null,
  callerEnabled: boolean,
): UseQueryResult<BrandMinglaDroveRollup, Error> => {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && callerEnabled;
  return useQuery({
    queryKey:
      enabled && brandId !== null
        ? brandAnalyticsKeys.minglaDrove(brandId)
        : brandAnalyticsKeys.disabledMinglaDrove,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<BrandMinglaDroveRollup> => {
      if (brandId === null) throw new Error("brand analytics brand is unavailable");
      return fetchBrandMinglaDroveRollup(brandId);
    },
  });
};

export const useBrandRegularsRollup = (
  brandId: string | null,
  callerEnabled: boolean,
): UseQueryResult<BrandRegularsRollup, Error> => {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && callerEnabled;
  return useQuery({
    queryKey:
      enabled && brandId !== null
        ? brandAnalyticsKeys.regulars(brandId)
        : brandAnalyticsKeys.disabledRegulars,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<BrandRegularsRollup> => {
      if (brandId === null) throw new Error("brand analytics brand is unavailable");
      return fetchBrandRegularsRollup(brandId);
    },
  });
};

export const useBrandCustomerPatternsRollup = (
  brandId: string | null,
  callerEnabled: boolean,
): UseQueryResult<BrandCustomerPatternsRollup, Error> => {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && callerEnabled;
  return useQuery({
    queryKey:
      enabled && brandId !== null
        ? brandAnalyticsKeys.patterns(brandId)
        : brandAnalyticsKeys.disabledPatterns,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<BrandCustomerPatternsRollup> => {
      if (brandId === null) throw new Error("brand analytics brand is unavailable");
      return fetchBrandCustomerPatternsRollup(brandId);
    },
  });
};
