import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchVenueOrganicInsights,
  type VenueOrganicInsights,
} from "../services/venueOrganicInsightsService";

const STALE_TIME_MS = 60_000;

export const venueOrganicInsightsKeys = {
  all: ["venue-organic-insights"] as const,
  detail: (brandId: string, venueId: string) =>
    ["venue-organic-insights", brandId, venueId] as const,
  disabled: ["venue-organic-insights", "disabled"] as const,
};

export function useVenueOrganicInsights(
  brandId: string | null,
  venueId: string | null,
  isAuthReady: boolean,
): UseQueryResult<VenueOrganicInsights, Error> {
  const enabled = isAuthReady && brandId !== null && venueId !== null;
  return useQuery<VenueOrganicInsights, Error>({
    queryKey:
      enabled && brandId !== null && venueId !== null
        ? venueOrganicInsightsKeys.detail(brandId, venueId)
        : venueOrganicInsightsKeys.disabled,
    enabled,
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: true,
    placeholderData: (previous) =>
      enabled &&
        previous?.brandId === brandId &&
        previous.venueId === venueId
        ? previous
        : undefined,
    queryFn: async (): Promise<VenueOrganicInsights> => {
      if (brandId === null || venueId === null) {
        throw new Error("venue organic insight scope is unavailable");
      }
      return fetchVenueOrganicInsights(brandId, venueId);
    },
  });
}
