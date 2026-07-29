import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { fetchPublicVenueSlots } from "../services/venueGuestReservationService";
import type { AvailableSlot } from "../types/venueReservation";

export const publicVenueAvailabilityKeys = {
  all: ["publicVenueAvailability"] as const,
  slots: (venueId: string, date: string, partySize: number) =>
    [...publicVenueAvailabilityKeys.all, venueId, date, partySize] as const,
};

export function usePublicVenueAvailability(
  venueId: string | null,
  date: string | null,
  partySize: number,
): UseQueryResult<AvailableSlot[]> {
  const enabled = venueId !== null && date !== null && partySize >= 1;
  return useQuery({
    queryKey: publicVenueAvailabilityKeys.slots(
      venueId ?? "none",
      date ?? "none",
      partySize,
    ),
    enabled,
    staleTime: 15_000,
    queryFn: () =>
      enabled
        ? fetchPublicVenueSlots(venueId, date, partySize)
        : Promise.resolve([]),
  });
}
