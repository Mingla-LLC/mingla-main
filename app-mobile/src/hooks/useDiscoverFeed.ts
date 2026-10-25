import { useInfiniteQuery } from "@tanstack/react-query";
import { discoverKeys } from "./discoverQueryKeys";
import { fetchDiscoverPage } from "../services/discoverFeedService";
import type { DiscoverAnchorV2, DiscoverFiltersV2, DiscoverPageResponse } from "../types/discoverFeed";

export function useDiscoverFeed(
  anchorKey: string,
  anchor: DiscoverAnchorV2 | null,
  filters: DiscoverFiltersV2,
) {
  return useInfiniteQuery<DiscoverPageResponse, Error>({
    queryKey: discoverKeys.feed(anchorKey, filters),
    queryFn: ({ pageParam }) =>
      fetchDiscoverPage(anchor as DiscoverAnchorV2, filters, (pageParam as string | null) ?? null),
    enabled: anchor !== null,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
  });
}
