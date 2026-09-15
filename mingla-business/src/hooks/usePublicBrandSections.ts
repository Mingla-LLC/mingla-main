/**
 * #3426 — buyer-web / Business preview reads for the brand page's Happening now
 * block and Past tab. Separate queries from `usePublicBrandBySlug` on purpose:
 * each section has its own loading and paging, and a slow Past page must never
 * hold back the brand page itself.
 */

import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";

import {
  fetchPublicBrandHappeningNow,
  fetchPublicBrandOfferingSection,
  type PublicBrandSectionCursor,
  type PublicBrandSectionPage,
} from "../services/publicBrandSectionsService";
import type { PublicUpcomingRow } from "../services/publicEventsService";

const PUBLIC_SECTION_STALE_TIME_MS = 45 * 1000;
const DISABLED_KEY = ["public-events-disabled"] as const;

export const publicBrandSectionKeys = {
  happeningNow: (
    brandSlug: string,
  ): readonly ["public-events", "brand", string, "happening-now"] =>
    ["public-events", "brand", brandSlug, "happening-now"] as const,
  past: (
    brandSlug: string,
  ): readonly ["public-events", "brand", string, "past"] =>
    ["public-events", "brand", brandSlug, "past"] as const,
};

export const usePublicBrandHappeningNow = (
  brandSlug: string | null,
): UseQueryResult<PublicUpcomingRow[]> => {
  const enabled = brandSlug !== null;
  return useQuery<PublicUpcomingRow[]>({
    queryKey: enabled
      ? publicBrandSectionKeys.happeningNow(brandSlug)
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_SECTION_STALE_TIME_MS,
    queryFn: async (): Promise<PublicUpcomingRow[]> => {
      if (!enabled || brandSlug === null) return [];
      return fetchPublicBrandHappeningNow(brandSlug);
    },
  });
};

export interface PublicBrandPastFeed {
  /** undefined until the first page settles, so the page never flashes "no Past". */
  rows: PublicUpcomingRow[] | undefined;
  hasMore: boolean;
  loadState: "ready" | "loading_more" | "error";
  loadMore: () => void;
}

export const usePublicBrandPast = (
  brandSlug: string | null,
): PublicBrandPastFeed => {
  const enabled = brandSlug !== null;
  const query = useInfiniteQuery<
    PublicBrandSectionPage,
    Error,
    InfiniteData<PublicBrandSectionPage, PublicBrandSectionCursor | null>,
    readonly unknown[],
    PublicBrandSectionCursor | null
  >({
    queryKey: enabled ? publicBrandSectionKeys.past(brandSlug) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_SECTION_STALE_TIME_MS,
    initialPageParam: null,
    queryFn: async ({ pageParam }): Promise<PublicBrandSectionPage> => {
      if (!enabled || brandSlug === null) {
        return { rows: [], hasMore: false, nextCursor: null };
      }
      return fetchPublicBrandOfferingSection(brandSlug, "past", pageParam);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.nextCursor !== null
        ? lastPage.nextCursor
        : undefined,
  });

  const rows = useMemo<PublicUpcomingRow[] | undefined>(() => {
    if (query.data === undefined) {
      // First page failed: no Past tab rather than an error for the whole page.
      return query.isError ? [] : undefined;
    }
    const seen = new Set<string>();
    const out: PublicUpcomingRow[] = [];
    for (const page of query.data.pages) {
      for (const row of page.rows) {
        const key = `${row.offeringType}:${row.offeringId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
    }
    return out;
  }, [query.data, query.isError]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  return {
    rows,
    hasMore: hasNextPage === true,
    loadState: isFetchingNextPage
      ? "loading_more"
      : query.isFetchNextPageError
        ? "error"
        : "ready",
    loadMore: () => {
      if (hasNextPage === true && !isFetchingNextPage) void fetchNextPage();
    },
  };
};
