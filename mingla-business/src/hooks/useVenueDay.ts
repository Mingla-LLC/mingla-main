/**
 * #4490 P2 — the venue's day (`issue_4490_venue_day`): Today, the Overview
 * tiles and the Hub card. `localDate` null = the venue's own today (its
 * timezone decides, not the phone's).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchVenueDay } from "../services/venueDayService";
import type { VenueDay } from "../types/venueOffers";
import { venueFeatureKeys } from "./venueFeatureKeys";

export function useVenueDay(
  brandId: string | null,
  venueId: string | null,
  localDate: string | null = null,
  options: { enabled?: boolean; live?: boolean } = {},
): UseQueryResult<VenueDay> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady &&
    options.enabled !== false &&
    brandId !== null &&
    brandId.length > 0 &&
    venueId !== null &&
    venueId.length > 0;
  return useQuery<VenueDay>({
    queryKey: enabled
      ? venueFeatureKeys.day(brandId as string, venueId as string, localDate ?? "today")
      : (["venueDay", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    // The door changes the day all day: keep Today and Check-in current.
    refetchInterval: options.live === true ? 30_000 : false,
    queryFn: () => fetchVenueDay(venueId as string, localDate),
  });
}
