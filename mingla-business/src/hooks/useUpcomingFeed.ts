import { useInfiniteQuery } from "@tanstack/react-query";

import {
  fetchPublicBrandUpcoming,
  type PublicUpcomingFeedPage,
} from "../services/publicEventsService";
import { publicEventKeys } from "./usePublicEvents";

const DISABLED_KEY = ["public-events", "brand", "disabled", "upcoming"] as const;
const STALE_TIME_MS = 60_000;

export function useUpcomingFeed(
  brandSlug: string | null,
) {
  const enabled = brandSlug !== null && brandSlug.length > 0;

  return useInfiniteQuery<PublicUpcomingFeedPage, Error>({
    queryKey: enabled ? publicEventKeys.brandUpcoming(brandSlug) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage): string | null =>
      lastPage.hasMore ? lastPage.nextCursor : null,
    queryFn: async ({ pageParam }): Promise<PublicUpcomingFeedPage> => {
      if (!enabled || brandSlug === null) {
        return { rows: [], nextCursor: null, hasMore: false };
      }
      return fetchPublicBrandUpcoming(
        brandSlug,
        typeof pageParam === "string"
          ? { startsAt: pageParam }
          : undefined,
      );
    },
  });
}
