import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { PublicVenueFeaturesView } from "@mingla/brand-rendering/venueFeaturePage";

import { supabase } from "../services/supabase";
import { fetchPublicVenueFeatures } from "./usePublicVenueFeatures";

/**
 * useVenueFeaturesForPlace — #4490 (the app twin of the buyer web's
 * `usePublicVenueFeatures`).
 * ---------------------------------------------------------------------------
 * A deck place card is a `place_pool.id`. When a verified host venue stands on
 * that place, what the venue SELLS (its features) decides the card's main
 * button, not its venue type:
 *
 *   place id --venue_public_view--> {brand slug, venue slug}
 *            --pg_public_venue_page--> features
 *
 * Both reads are anon-safe (verified venues only). An unclaimed place, a
 * non-uuid card id (Ticketmaster, curated, stroll, picnic) or any failure
 * resolves to NULL, and the deck then keeps today's button (Reserve a table
 * when the venue takes reservations, else Directions): the card is never worse
 * than before.
 */
export interface PlaceVenueFeatures {
  readonly brandSlug: string;
  readonly venueSlug: string;
  readonly features: PublicVenueFeaturesView;
  /**
   * #4490 Explorer W3 — who and where, for the card sheet's "Message {venue}"
   * and its "What's on" times (venue zone, day-first, 24-hour). Public facts
   * from `venue_public_view` (verified venues only).
   */
  readonly venueId: string | null;
  readonly venueName: string;
  readonly brandId: string | null;
  readonly brandName: string;
  readonly timezone: string | null;
  /** The venue type (only the page's "tables lead a bar or a restaurant" rule reads it). */
  readonly venueType: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const venueFeaturesForPlaceKeys = {
  all: ["venueFeaturesForPlace"] as const,
  byPlace: (placePoolId: string) =>
    [...venueFeaturesForPlaceKeys.all, placePoolId] as const,
};

interface VenueSlugRow {
  id: string | null;
  name: string | null;
  slug: string | null;
  brand_id: string | null;
  brand_slug: string | null;
  brand_name: string | null;
  iana_timezone: string | null;
  venue_category: string | null;
}

const trimmedOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

async function fetchVenueFeaturesForPlace(
  placePoolId: string,
): Promise<PlaceVenueFeatures | null> {
  const { data: rows, error: slugError } = await supabase
    .from("venue_public_view")
    .select("id, name, slug, brand_id, brand_slug, brand_name, iana_timezone, venue_category")
    .eq("place_pool_id", placePoolId)
    .limit(1);
  if (slugError !== null) throw slugError;
  const row = ((rows ?? []) as VenueSlugRow[])[0];
  const venueSlug = typeof row?.slug === "string" ? row.slug.trim() : "";
  const brandSlug =
    typeof row?.brand_slug === "string" ? row.brand_slug.trim() : "";
  if (venueSlug.length === 0 || brandSlug.length === 0) return null;
  // One owner of the page read (usePublicVenueFeatures).
  const features = await fetchPublicVenueFeatures(brandSlug, venueSlug);
  return features === null
    ? null
    : {
        brandSlug,
        venueSlug,
        features,
        venueId: typeof row?.id === "string" ? row.id : null,
        venueName: trimmedOr(row?.name, ""),
        brandId: typeof row?.brand_id === "string" ? row.brand_id : null,
        brandName: trimmedOr(row?.brand_name, brandSlug),
        timezone: typeof row?.iana_timezone === "string" && row.iana_timezone.trim().length > 0 ? row.iana_timezone.trim() : null,
        venueType: typeof row?.venue_category === "string" ? row.venue_category : null,
      };
}

export function useVenueFeaturesForPlace(
  placePoolId: string | null | undefined,
): UseQueryResult<PlaceVenueFeatures | null> {
  const enabled =
    typeof placePoolId === "string" && UUID_RE.test(placePoolId);
  return useQuery({
    queryKey: venueFeaturesForPlaceKeys.byPlace(placePoolId ?? "none"),
    queryFn: () => fetchVenueFeaturesForPlace(placePoolId as string),
    enabled,
    // A venue switches features on and off; a minute is fresh enough for a
    // button label and short enough that a host's change shows on the next open.
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}
