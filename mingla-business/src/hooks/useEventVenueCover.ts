/**
 * #4490 07-L — the venue an event is at, when that venue has a cover to copy.
 * Reads the same venue-link query as the Where step (venueFeatureKeys.eventVenue)
 * and the venue listing; null until both are known or when there is no cover.
 */
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchEventVenueLink } from "../services/venueFeaturesService";
import { useVenueListing } from "./useVenueListings";
import { venueFeatureKeys } from "./venueFeatureKeys";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventVenueCover {
  venueId: string;
  venueName: string;
}

export function useEventVenueCover(
  eventId: string | null,
  noun: "event" | "experience" = "event",
): EventVenueCover | null {
  const { isAuthReady } = useAuth();
  const validEventId = eventId !== null && UUID.test(eventId) ? eventId : null;
  const linkQuery = useQuery({
    queryKey: validEventId !== null ? venueFeatureKeys.eventVenue(validEventId) : ["eventVenueLink", "disabled"],
    enabled: isAuthReady && validEventId !== null,
    staleTime: 30_000,
    queryFn: () => fetchEventVenueLink(validEventId as string, noun),
  });
  const venueId = linkQuery.data?.venueId ?? null;
  const venueQuery = useVenueListing(venueId);
  const venue = venueQuery.data ?? null;
  if (venueId === null || venue === null || venue.coverMediaUrl === null || venue.coverMediaType === null) return null;
  return { venueId, venueName: venue.name };
}
