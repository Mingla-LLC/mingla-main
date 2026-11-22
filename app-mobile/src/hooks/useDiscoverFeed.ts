import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import { discoverKeys } from "./discoverQueryKeys";
import { discoverVenueRetry, fetchDiscoverPage } from "../services/discoverFeedService";
import type { DiscoverAnchorV2, DiscoverFiltersV2, DiscoverPageResponse } from "../types/discoverFeed";

/**
 * The one definition of the Discover feed query. #4265: shared by the hook and
 * by DiscoverScreen's prefetch of a reconciled city, so both always build the
 * same key, request and freshness.
 */
export function discoverFeedQueryOptions(
  anchorKey: string,
  anchor: DiscoverAnchorV2 | null,
  filters: DiscoverFiltersV2,
) {
  return infiniteQueryOptions<DiscoverPageResponse, Error>({
    queryKey: discoverKeys.feed(anchorKey, filters),
    queryFn: ({ pageParam }) =>
      fetchDiscoverPage(anchor as DiscoverAnchorV2, filters, (pageParam as string | null) ?? null),
    enabled: anchor !== null,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    // #4490 W6 fix 2 (W6-D3): a Venues read is not retried after its 10 s budget.
    ...(filters.kind === "venues" ? { retry: discoverVenueRetry } : {}),
  });
}

export function useDiscoverFeed(
  anchorKey: string,
  anchor: DiscoverAnchorV2 | null,
  filters: DiscoverFiltersV2,
) {
  return useInfiniteQuery(discoverFeedQueryOptions(anchorKey, anchor, filters));
}
