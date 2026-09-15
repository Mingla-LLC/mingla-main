/**
 * #3426 — Explorer reads for the brand page's Happening now block and Past tab.
 *
 * `pg_public_brand_offering_section` (anon, SECURITY DEFINER; migration
 * 20270707003426) returns one date-decided section of a brand page — all four
 * offering kinds, decided by `event_dates`, never by `events.status`. This is
 * the consumer twin of mingla-business `publicBrandSectionsService` +
 * `usePublicBrandSections`: the same RPC, the same cursor rule, the same shapes,
 * so Explorer and Host web render the same sections (parity, #3426).
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

import { supabase } from "../services/supabase";

export interface BrandSectionRowRaw {
  offering_id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  offering_type: "event" | "rsvp" | "trip" | "experience";
  offering_slug: string;
  title: string;
  description: string | null;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  section: PublicBrandOfferingSection;
  starts_at: string | null;
  ends_at: string | null;
  price_from_cents: number | null;
  currency: string | null;
  is_free: boolean;
  published_at: string;
}

export interface BrandSectionCursor {
  at: string;
  id: string;
}

export interface BrandSectionPage {
  rows: PublicBrandUpcoming[];
  hasMore: boolean;
  nextCursor: BrandSectionCursor | null;
}

export const BRAND_SECTION_PAGE_SIZE = 20;
export const BRAND_HAPPENING_NOW_PAGE_SIZE = 100;
export const BRAND_HAPPENING_NOW_MAX_PAGES = 10;

export const consumerBrandSectionKeys = {
  happeningNow: (slug: string) =>
    ["consumerBrand", "section", slug, "happening-now"] as const,
  past: (slug: string) => ["consumerBrand", "section", slug, "past"] as const,
};

export const mapBrandSectionRow = (
  row: BrandSectionRowRaw,
): PublicBrandUpcoming => ({
  offeringId: row.offering_id,
  brandId: row.brand_id,
  brandSlug: row.brand_slug,
  brandName: row.brand_name,
  offeringType: row.offering_type,
  offeringSlug: row.offering_slug,
  name: row.title,
  bio: row.description,
  coverMediaUrl: row.cover_media_url,
  coverMediaType: row.cover_media_type,
  // The section reader projects no theme (nothing to strip).
  theme: null,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  priceFromMinorUnits: row.price_from_cents,
  currency: row.currency ?? "USD",
  isFree: row.is_free,
  publishedAt: row.published_at,
});

/** The cursor is the field the section is ORDERED by. */
export const brandSectionCursorFor = (
  section: PublicBrandOfferingSection,
  row: PublicBrandUpcoming,
): BrandSectionCursor | null => {
  const at = section === "upcoming" ? row.startsAt : (row.endsAt ?? null);
  return typeof at === "string" && at.length > 0
    ? { at, id: row.offeringId }
    : null;
};

export const fetchBrandOfferingSection = async (
  slug: string,
  section: PublicBrandOfferingSection,
  cursor: BrandSectionCursor | null = null,
  limit: number = BRAND_SECTION_PAGE_SIZE,
): Promise<BrandSectionPage> => {
  const { data, error } = await supabase.rpc(
    "pg_public_brand_offering_section",
    {
      p_brand_slug: slug,
      p_section: section,
      p_cursor_at: cursor?.at ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_limit: limit,
    },
  );
  if (error !== null) throw error;
  const all = ((data ?? []) as BrandSectionRowRaw[])
    .filter((row) => row.section === section)
    .map(mapBrandSectionRow);
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;
  const last = rows[rows.length - 1];
  return {
    rows,
    hasMore,
    nextCursor:
      hasMore && last !== undefined ? brandSectionCursorFor(section, last) : null,
  };
};

export const fetchBrandHappeningNow = async (
  slug: string,
): Promise<PublicBrandUpcoming[]> => {
  const rows: PublicBrandUpcoming[] = [];
  let cursor: BrandSectionCursor | null = null;
  for (let page = 0; page < BRAND_HAPPENING_NOW_MAX_PAGES; page += 1) {
    const result: BrandSectionPage = await fetchBrandOfferingSection(
      slug,
      "happening_now",
      cursor,
      BRAND_HAPPENING_NOW_PAGE_SIZE,
    );
    rows.push(...result.rows);
    if (!result.hasMore || result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return rows;
};

export const useBrandHappeningNow = (
  slug: string | null,
): UseQueryResult<PublicBrandUpcoming[]> => {
  const enabled = slug !== null && slug.trim().length > 0;
  return useQuery<PublicBrandUpcoming[]>({
    queryKey: enabled
      ? consumerBrandSectionKeys.happeningNow(slug)
      : ["consumerBrand", "section", "disabled"],
    enabled,
    // Shorter than the brand detail's 5 minutes: this block goes stale the
    // moment something starts or ends.
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!enabled || slug === null) return [];
      return fetchBrandHappeningNow(slug);
    },
  });
};

export interface BrandPastFeed {
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
    const seen = new Set<string>();
    const out: PublicBrandUpcoming[] = [];
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
