import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { discoverKeys } from "./discoverQueryKeys";
import { discoverVenueRetry, fetchDiscoverFacets } from "../services/discoverFeedService";
import type { DiscoverAnchorV2, DiscoverFiltersV2 } from "../types/discoverFeed";

/** The one definition of the Discover facets query (#4265: shared with the reconcile prefetch). */
export function discoverFacetsQueryOptions(
  anchorKey: string,
  anchor: DiscoverAnchorV2 | null,
  filters: DiscoverFiltersV2,
) {
  return queryOptions({
    queryKey: discoverKeys.facets(anchorKey, filters),
    queryFn: () => fetchDiscoverFacets(anchor as DiscoverAnchorV2, filters),
    enabled: anchor !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    // #4490 W6 fix 2 (W6-D3): a Venues read is not retried after its 10 s budget.
    ...(filters.kind === "venues" ? { retry: discoverVenueRetry } : {}),
  });
}

export function useDiscoverFacets(
  anchorKey: string,
  anchor: DiscoverAnchorV2 | null,
  filters: DiscoverFiltersV2,
) {
  return useQuery(discoverFacetsQueryOptions(anchorKey, anchor, filters));
}
