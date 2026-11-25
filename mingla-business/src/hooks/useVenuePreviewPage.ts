/**
 * #4490 — the Host's preview of a venue page, for a venue that is not public
 * yet. Auth-scoped: `biz_preview_venue_page` reads `auth.uid()` (a brand member
 * only), so a pre-auth fire would cache a refusal as "nothing to preview".
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  getVenuePreviewPage,
  type VenuePreviewPage,
} from "../services/publicVenuePageService";

export const venuePreviewKeys = {
  all: ["venue-preview-page"] as const,
  page: (venueId: string): readonly ["venue-preview-page", string] =>
    [...venuePreviewKeys.all, venueId] as const,
};

export const useVenuePreviewPage = (
  venueId: string | null,
): UseQueryResult<VenuePreviewPage | null> => {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  return useQuery<VenuePreviewPage | null>({
    queryKey: enabled
      ? venuePreviewKeys.page(venueId)
      : (["venue-preview-page", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<VenuePreviewPage | null> =>
      venueId === null ? null : getVenuePreviewPage(venueId),
  });
};
