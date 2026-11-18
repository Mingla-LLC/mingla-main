import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  parsePublicVenueFeatures,
  type PublicVenueFeaturesView,
} from "@mingla/brand-rendering/venueFeaturePage";

import { supabase } from "../services/supabase";

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
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const venueFeaturesForPlaceKeys = {
  all: ["venueFeaturesForPlace"] as const,
  byPlace: (placePoolId: string) =>
    [...venueFeaturesForPlaceKeys.all, placePoolId] as const,
};

interface VenueSlugRow {
  slug: string | null;
  brand_slug: string | null;
}

async function fetchVenueFeaturesForPlace(
  placePoolId: string,
): Promise<PlaceVenueFeatures | null> {
  const { data: rows, error: slugError } = await supabase
    .from("venue_public_view")
    .select("slug, brand_slug")
    .eq("place_pool_id", placePoolId)
    .limit(1);
  if (slugError !== null) throw slugError;
  const row = ((rows ?? []) as VenueSlugRow[])[0];
  const venueSlug = typeof row?.slug === "string" ? row.slug.trim() : "";
  const brandSlug =
    typeof row?.brand_slug === "string" ? row.brand_slug.trim() : "";
  if (venueSlug.length === 0 || brandSlug.length === 0) return null;
  const { data, error } = await supabase.rpc("pg_public_venue_page", {
    p_brand_slug: brandSlug,
    p_venue_slug: venueSlug,
  });
  if (error !== null) throw error;
  const features = parsePublicVenueFeatures(data);
  return features === null ? null : { brandSlug, venueSlug, features };
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
