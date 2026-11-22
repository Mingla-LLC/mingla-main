import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  parsePublicVenueFeatures,
  type PublicVenueFeaturesView,
} from "@mingla/brand-rendering/venueFeaturePage";

import { supabase } from "../services/supabase";

/**
 * usePublicVenueFeatures — #4490 Explorer W3 (the app twin of buyer web's
 * hook of the same name).
 * ---------------------------------------------------------------------------
 * What a venue SELLS (its features, live offers, plans, upcoming events and
 * hours windows) for `/b/{brand}/v/{venue}`, from `pg_public_venue_page`
 * (SECURITY DEFINER, granted to anon, verified venues of live brands only, no
 * auth.uid() read), parsed by the shared `parsePublicVenueFeatures`. The venue
 * page derives its tabs, lead and booking bar from it; a failed read falls
 * back to today's page (never worse). `useVenueFeaturesForPlace` reuses the
 * same fetch. Not persisted (queryPersistence NEVER_PERSIST_ROOT_KEYS).
 */
export const publicVenueFeaturesKeys = {
  all: ["publicVenueFeatures"] as const,
  page: (brandSlug: string, venueSlug: string) =>
    [...publicVenueFeaturesKeys.all, brandSlug, venueSlug] as const,
};

const DISABLED_KEY = [...publicVenueFeaturesKeys.all, "disabled"] as const;

/** The one fetch: the page RPC, parsed (null when the payload is not the documented shape). */
export async function fetchPublicVenueFeatures(
  brandSlug: string,
  venueSlug: string,
): Promise<PublicVenueFeaturesView | null> {
  const { data, error } = await supabase.rpc("pg_public_venue_page", {
    p_brand_slug: brandSlug,
    p_venue_slug: venueSlug,
  });
  if (error !== null) throw error;
  return parsePublicVenueFeatures(data);
}

export function usePublicVenueFeatures(
  brandSlug: string | null,
  venueSlug: string | null,
): UseQueryResult<PublicVenueFeaturesView | null> {
  const enabled =
    typeof brandSlug === "string" && brandSlug.length > 0 &&
    typeof venueSlug === "string" && venueSlug.length > 0;
  return useQuery<PublicVenueFeaturesView | null>({
    queryKey: enabled ? publicVenueFeaturesKeys.page(brandSlug, venueSlug) : DISABLED_KEY,
    enabled,
    // A venue switches features and offers on and off; under a minute is fresh
    // enough for tabs and prices, and a host's change shows on the next open.
    staleTime: 45 * 1000,
    retry: 1,
    queryFn: () =>
      enabled ? fetchPublicVenueFeatures(brandSlug, venueSlug) : Promise.resolve(null),
  });
}
