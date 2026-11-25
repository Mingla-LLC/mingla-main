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
  if (venueId === null || venue === null) return null;
  // N133: offer the button only for a cover the edge will copy.
  if (!venueCoverIsCopyable({
    brandId: venue.brandId,
    url: venue.coverMediaUrl,
    posterUrl: venue.coverMediaPosterUrl ?? null,
    type: venue.coverMediaType,
  })) return null;
  return { venueId, venueName: venue.name };
}

const PUBLIC_MARK = "/storage/v1/object/public/";

function ownBrandCover(url: string | null, brandId: string): boolean {
  if (url === null) return false;
  const at = url.indexOf(PUBLIC_MARK);
  if (at < 0) return false;
  const rest = decodeURIComponent(url.slice(at + PUBLIC_MARK.length).split("?")[0] ?? "");
  return rest.startsWith(`brand_covers/${brandId}/`) && !rest.includes("..");
}

/**
 * N133 (#4490) — the same rule the edge applies (N122): an image or GIF is
 * copyable only when it is the brand's own uploaded venue cover
 * (brand_covers/<brand>/, and a GIF's poster too). GIPHY and Pexels covers are
 * not copied, so the button is not offered for them; the host picks those
 * again from the cover picker. A video cover is offered (returned as is and
 * checked against a ready venue video job by the server).
 */
export function venueCoverIsCopyable(input: {
  brandId: string;
  url: string | null;
  posterUrl: string | null;
  type: "image" | "gif" | "video" | null;
}): boolean {
  if (input.url === null || input.type === null) return false;
  if (input.type === "video") return true;
  if (!ownBrandCover(input.url, input.brandId)) return false;
  return input.type !== "gif" || ownBrandCover(input.posterUrl, input.brandId);
}
