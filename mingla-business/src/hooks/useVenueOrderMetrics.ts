import {
  useQueries,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  fetchVenueOrderMetrics,
  type VenueOrderMetrics,
} from "../services/venueOrderMetricsService";

const STALE_TIME_MS = 60_000;

export const venueOrderMetricsKeys = {
  all: ["venue-order-metrics"] as const,
  detail: (brandId: string, venueId: string) =>
    ["venue-order-metrics", brandId, venueId] as const,
};

const DISABLED_KEY = ["venue-order-metrics", "disabled"] as const;

export const useVenueOrderMetrics = (
  brandId: string | null,
  venueId: string | null,
  isAuthReady: boolean,
): UseQueryResult<VenueOrderMetrics, Error> => {
  const enabled = isAuthReady && brandId !== null && venueId !== null;
  return useQuery<VenueOrderMetrics, Error>({
    queryKey:
      enabled && brandId !== null && venueId !== null
        ? venueOrderMetricsKeys.detail(brandId, venueId)
        : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<VenueOrderMetrics> => {
      if (brandId === null || venueId === null) {
        throw new Error("venue order metrics scope is unavailable");
      }
      return fetchVenueOrderMetrics(brandId, venueId);
    },
  });
};

export interface VenueOrderMetricsScope {
  brandId: string;
  venueId: string;
}

export const useVenueOrderMetricsForVenues = (
  scopes: readonly VenueOrderMetricsScope[],
  isAuthReady: boolean,
): readonly UseQueryResult<VenueOrderMetrics, Error>[] =>
  useQueries({
    queries: scopes.map((scope) => ({
      queryKey: venueOrderMetricsKeys.detail(scope.brandId, scope.venueId),
      enabled: isAuthReady,
      staleTime: STALE_TIME_MS,
      queryFn: (): Promise<VenueOrderMetrics> =>
        fetchVenueOrderMetrics(scope.brandId, scope.venueId),
    })),
  });
