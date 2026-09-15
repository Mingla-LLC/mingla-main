/**
 * #3426 — Explorer reads for the brand page's Happening now block and Past tab.
 *
 * `pg_public_brand_offering_section` (anon, SECURITY DEFINER; migration
 * 20270707003426) returns one date-decided section of a brand page — all four
 * offering kinds, decided by `event_dates`, never by `events.status`. Mapping,
 * paging and de-duplication come from `@mingla/brand-rendering/brandSectionFeed`,
 * the SAME module Host web and Business use, so Explorer renders the same
 * sections by construction (parity, #3426). This file only makes the calls.
 *
 * A separate module from `useBrandBySlug` on purpose: that hook's fetcher is
 * pinned by the #1902 suites, and a slow Past page must never hold back the
 * brand page itself.
 */

import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type {
  PublicBrandOfferingSection,
  PublicBrandUpcoming,
} from "@mingla/brand-rendering";
import {
  BRAND_HAPPENING_NOW_PAGE_SIZE,
  BRAND_SECTION_PAGE_SIZE,
  BRAND_SECTION_RPC,
  brandSectionPageFromRows,
  brandSectionRpcArgs,
  collectBrandHappeningNow,
  mergeBrandSectionPages,
  type BrandSectionCursor,
  type BrandSectionPage,
  type BrandSectionRowRaw,
} from "@mingla/brand-rendering/brandSectionFeed";

import { supabase } from "../services/supabase";

export const consumerBrandSectionKeys = {
  happeningNow: (slug: string) =>
    ["consumerBrand", "section", slug, "happening-now"] as const,
  past: (slug: string) => ["consumerBrand", "section", slug, "past"] as const,
};

export const fetchBrandOfferingSection = async (
  slug: string,
  section: PublicBrandOfferingSection,
  cursor: BrandSectionCursor | null = null,
  limit: number = BRAND_SECTION_PAGE_SIZE,
): Promise<BrandSectionPage> => {
  const { data, error } = await supabase.rpc(
    BRAND_SECTION_RPC,
    brandSectionRpcArgs(slug, section, cursor, limit),
  );
  if (error !== null) throw error;
  return brandSectionPageFromRows(
    section,
    data as BrandSectionRowRaw[] | null,
    limit,
  );
};

export const useBrandHappeningNow = (
  slug: string | null,
): UseQueryResult<PublicBrandUpcoming[]> => {
  const enabled = slug !== null && slug.trim().length > 0;
  return useQuery<PublicBrandUpcoming[]>({
    queryKey: enabled
      ? consumerBrandSectionKeys.happeningNow(slug)
      : ["consumerBrand", "section", "disabled-happening-now"],
    enabled,
    // Shorter than the brand detail's 5 minutes: this block goes stale the
    // moment something starts or ends.
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!enabled || slug === null) return [];
      return collectBrandHappeningNow((cursor) =>
        fetchBrandOfferingSection(
          slug,
          "happening_now",
          cursor,
          BRAND_HAPPENING_NOW_PAGE_SIZE,
        ),
      );
    },
  });
};

export interface BrandPastFeed {
  /** undefined until the first page settles; [] if it failed (no Past tab). */
  rows: PublicBrandUpcoming[] | undefined;
  hasMore: boolean;
  loadState: "ready" | "loading_more" | "error";
  loadMore: () => void;
}

export const useBrandPast = (slug: string | null): BrandPastFeed => {
  const enabled = slug !== null && slug.trim().length > 0;
  const query = useInfiniteQuery<
    BrandSectionPage,
    Error,
    InfiniteData<BrandSectionPage, BrandSectionCursor | null>,
    readonly unknown[],
    BrandSectionCursor | null
  >({
    queryKey: enabled
      ? consumerBrandSectionKeys.past(slug)
      : ["consumerBrand", "section", "disabled-past"],
    enabled,
    staleTime: 5 * 60 * 1000,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      if (!enabled || slug === null) {
        return { rows: [], hasMore: false, nextCursor: null };
      }
      return fetchBrandOfferingSection(slug, "past", pageParam);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.nextCursor !== null
        ? lastPage.nextCursor
        : undefined,
  });

  const rows = useMemo<PublicBrandUpcoming[] | undefined>(() => {
    if (query.data === undefined) return query.isError ? [] : undefined;
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
