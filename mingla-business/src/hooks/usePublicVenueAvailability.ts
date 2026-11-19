import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { fetchPublicVenueSlots } from "../services/venueGuestReservationService";
import type { AvailableSlot } from "../types/venueReservation";

// Anon-safe: reads public reservation availability through the canonical
// self-authorizing venue availability edge function on public venue pages.
export const publicVenueAvailabilityKeys = {
  all: ["publicVenueAvailability"] as const,
  slots: (venueId: string, date: string, partySize: number, spaceId: string | null = null) =>
    spaceId === null
      ? ([...publicVenueAvailabilityKeys.all, venueId, date, partySize] as const)
      : ([...publicVenueAvailabilityKeys.all, venueId, date, partySize, spaceId] as const),
};

export function usePublicVenueAvailability(
  venueId: string | null,
  date: string | null,
  partySize: number,
  spaceId: string | null = null,
): UseQueryResult<AvailableSlot[]> {
  const enabled = venueId !== null && date !== null && partySize >= 1;
  return useQuery({
    queryKey: publicVenueAvailabilityKeys.slots(
      venueId ?? "none",
      date ?? "none",
      partySize,
      spaceId,
    ),
    enabled,
    staleTime: 15_000,
    queryFn: () =>
      enabled
        ? fetchPublicVenueSlots(venueId, date, partySize, spaceId)
        : Promise.resolve([]),
  });
}
