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
import type { PublicBrandUpcoming } from "@mingla/brand-rendering";
import {
  mergeBrandSectionPages,
  type BrandSectionCursor,
  type BrandSectionPage,
} from "@mingla/brand-rendering/brandSectionFeed";

import {
  fetchPublicBrandHappeningNow,
  fetchPublicBrandOfferingSection,
} from "../services/publicBrandSectionsService";

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
): UseQueryResult<PublicBrandUpcoming[]> => {
  const enabled = brandSlug !== null;
  return useQuery<PublicBrandUpcoming[]>({
    queryKey: enabled
      ? publicBrandSectionKeys.happeningNow(brandSlug)
      : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_SECTION_STALE_TIME_MS,
    queryFn: async (): Promise<PublicBrandUpcoming[]> => {
      if (!enabled || brandSlug === null) return [];
      return fetchPublicBrandHappeningNow(brandSlug);
    },
  });
};

export interface PublicBrandPastFeed {
  /** undefined until the first page settles, so the page never flashes "no Past". */
  rows: PublicBrandUpcoming[] | undefined;
  hasMore: boolean;
  loadState: "ready" | "loading_more" | "error";
  loadMore: () => void;
}

export const usePublicBrandPast = (
  brandSlug: string | null,
): PublicBrandPastFeed => {
  const enabled = brandSlug !== null;
  const query = useInfiniteQuery<
    BrandSectionPage,
    Error,
    InfiniteData<BrandSectionPage, BrandSectionCursor | null>,
    readonly unknown[],
    BrandSectionCursor | null
  >({
    queryKey: enabled ? publicBrandSectionKeys.past(brandSlug) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_SECTION_STALE_TIME_MS,
    initialPageParam: null,
    queryFn: async ({ pageParam }): Promise<BrandSectionPage> => {
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

  const rows = useMemo<PublicBrandUpcoming[] | undefined>(() => {
    if (query.data === undefined) {
      // First page failed: no Past tab rather than an error for the whole page.
      return query.isError ? [] : undefined;
    }
    return mergeBrandSectionPages(query.data.pages);
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
