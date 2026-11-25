/**
 * #4490 — the React Query read for the feature-driven public venue page. No
 * auth anywhere: it serves signed-out guests (the Host preview, which does need
 * a session, lives in `useVenuePreviewPage.ts`).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { PublicVenueFeaturesView } from "@mingla/brand-rendering/venueFeaturePage";

import { getPublicVenueFeatures } from "../services/publicVenuePageService";

const STALE_MS = 45 * 1000;
const DISABLED_KEY = ["public-venue-features-disabled"] as const;

export const publicVenueFeatureKeys = {
  all: ["public-venue-features"] as const,
  page: (
    brandSlug: string,
    venueSlug: string,
  ): readonly ["public-venue-features", "page", string, string] =>
    [...publicVenueFeatureKeys.all, "page", brandSlug, venueSlug] as const,
};

/**
 * The venue's features for `/b/{brand}/v/{venue}`. One retry only: if the read
 * keeps failing the page falls back to today's tabs, and that must not wait
 * behind a long backoff.
 */
export const usePublicVenueFeatures = (
  brandSlug: string | null,
  venueSlug: string | null,
): UseQueryResult<PublicVenueFeaturesView | null> => {
  const enabled = brandSlug !== null && venueSlug !== null;
  return useQuery<PublicVenueFeaturesView | null>({
    queryKey: enabled
      ? publicVenueFeatureKeys.page(brandSlug, venueSlug)
      : DISABLED_KEY,
    enabled,
    staleTime: STALE_MS,
    retry: 1,
    queryFn: async (): Promise<PublicVenueFeaturesView | null> => {
      if (!enabled || brandSlug === null || venueSlug === null) return null;
      return getPublicVenueFeatures(brandSlug, venueSlug);
    },
  });
};
