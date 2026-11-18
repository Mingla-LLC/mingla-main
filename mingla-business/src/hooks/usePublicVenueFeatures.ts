/**
 * #4490 — React Query reads for the feature-driven venue page. No auth: the
 * public hook serves signed-out guests, the preview hook serves a signed-in
 * brand member who passes the server's own check.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { PublicVenueFeaturesView } from "@mingla/brand-rendering/venueFeaturePage";

import {
  getPublicVenueFeatures,
  getVenuePreviewPage,
  type VenuePreviewPage,
} from "../services/publicVenuePageService";

const STALE_MS = 45 * 1000;
const DISABLED_KEY = ["public-venue-features-disabled"] as const;

export const publicVenueFeatureKeys = {
  all: ["public-venue-features"] as const,
  page: (
    brandSlug: string,
    venueSlug: string,
  ): readonly ["public-venue-features", "page", string, string] =>
    [...publicVenueFeatureKeys.all, "page", brandSlug, venueSlug] as const,
  preview: (
    venueId: string,
  ): readonly ["public-venue-features", "preview", string] =>
    [...publicVenueFeatureKeys.all, "preview", venueId] as const,
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

/** The Host preview of a venue (any claim status). */
export const useVenuePreviewPage = (
  venueId: string | null,
): UseQueryResult<VenuePreviewPage | null> =>
  useQuery<VenuePreviewPage | null>({
    queryKey:
      venueId === null ? DISABLED_KEY : publicVenueFeatureKeys.preview(venueId),
    enabled: venueId !== null,
    staleTime: STALE_MS,
    retry: 1,
    queryFn: async (): Promise<VenuePreviewPage | null> =>
      venueId === null ? null : getVenuePreviewPage(venueId),
  });
