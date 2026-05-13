/**
 * useBrandCustomers — React Query hook for the brand-level Customers tab.
 *
 * Wraps `resolveBrandBuyers(brandId)` from the audience service into a
 * query-key-factory-disciplined hook (Constitution #4 — one query key per
 * entity). Cache stays warm for STALE_TIME_MS so navigating away and back
 * doesn't re-fetch.
 *
 * SPEC reference: SPEC §5.7 (Brand Customers tab data dependency), §11 T-12.
 * Test target: T-01 brand-rollup audience query + T-04 unsubscribe suppression.
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  resolveBrandBuyers,
  type ResolveBuyersResult,
} from "../../services/marketing/marketingAudienceService";

const STALE_TIME_MS = 60 * 1000; // 1 min — audiences "feel live" but server load stays sane

/** Query-key factory — invalidate at `brandCustomersKeys.all` to refresh every brand's tab. */
export const brandCustomersKeys = {
  all: ["marketing", "brand-customers"] as const,
  byBrand: (brandId: string): readonly [string, string, string] =>
    ["marketing", "brand-customers", brandId] as const,
};

export interface UseBrandCustomersState {
  data: ResolveBuyersResult | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: UseQueryResult<ResolveBuyersResult>["refetch"];
}

export function useBrandCustomers(
  brandId: string | null | undefined,
): UseBrandCustomersState {
  const enabled = typeof brandId === "string" && brandId.length > 0;

  const query = useQuery<ResolveBuyersResult>({
    queryKey: enabled
      ? brandCustomersKeys.byBrand(brandId)
      : brandCustomersKeys.all,
    queryFn: async () => {
      // Type assertion safe: enabled gate above guarantees non-empty string.
      return resolveBrandBuyers(brandId as string);
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });

  return useMemo(
    () => ({
      data: query.data,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error,
      refetch: query.refetch,
    }),
    [query.data, query.isLoading, query.isError, query.error, query.refetch],
  );
}
