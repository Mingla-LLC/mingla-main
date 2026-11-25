/**
 * #4490 07-A — is this event at one of the brand's venues?
 *
 * Reads the server venue link through the same query the Where step's
 * EventVenueSpacePicker runs (venueFeatureKeys.eventVenue), so a pick there
 * refreshes this too. Before the link is known (a local draft, or the first
 * load), the venue intent the creator was opened with stands in. Never stored
 * in the persisted draft store (rule 5). The server is the authority at publish.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchEventVenueLink } from "../services/venueFeaturesService";
import { readEventVenueIntent, resolveEventAtVenue } from "../utils/eventVenueIntent";
import { venueFeatureKeys } from "./venueFeatureKeys";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useEventAtVenue(
  eventId: string | null,
  brandId: string | null,
  noun: "event" | "experience" = "event",
): boolean {
  const { isAuthReady } = useAuth();
  const validEventId = eventId !== null && UUID.test(eventId) ? eventId : null;
  const [intent] = useState(() => readEventVenueIntent(brandId, noun));
  const linkQuery = useQuery({
    queryKey:
      validEventId !== null ? venueFeatureKeys.eventVenue(validEventId) : ["eventVenueLink", "disabled"],
    enabled: isAuthReady && validEventId !== null,
    staleTime: 30_000,
    queryFn: () => fetchEventVenueLink(validEventId as string, noun),
  });
  const linkVenueId = linkQuery.data === undefined ? undefined : linkQuery.data.venueId;
  return resolveEventAtVenue(linkVenueId, intent !== null);
}
