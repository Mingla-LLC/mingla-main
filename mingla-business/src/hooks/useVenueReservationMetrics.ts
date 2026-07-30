import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchVenueReservationMetrics,
  type VenueReservationMetrics,
} from "../services/reservationMetricsService";

const STALE_TIME_MS = 60_000;

export const venueReservationMetricsKeys = {
  all: ["venue-reservation-metrics"] as const,
  detail: (brandId: string, venueId: string) =>
    ["venue-reservation-metrics", brandId, venueId] as const,
  disabled: ["venue-reservation-metrics", "disabled"] as const,
};

export const useVenueReservationMetrics = (
  brandId: string | null,
  venueId: string | null,
  isAuthReady: boolean,
): UseQueryResult<VenueReservationMetrics, Error> => {
  const enabled = isAuthReady && brandId !== null && venueId !== null;
  return useQuery<VenueReservationMetrics, Error>({
    queryKey:
      enabled && brandId !== null && venueId !== null
        ? venueReservationMetricsKeys.detail(brandId, venueId)
        : venueReservationMetricsKeys.disabled,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<VenueReservationMetrics> => {
      if (brandId === null || venueId === null) {
        throw new Error("venue reservation scope is unavailable");
      }
      return fetchVenueReservationMetrics(brandId, venueId);
    },
  });
};
