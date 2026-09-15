// #3426 — the ONE client-side contract for the brand page's date-decided
// sections, shared by Host web / Business (mingla-business) and Explorer
// (app-mobile) so both surfaces map, page and dedupe `pg_public_brand_offering_section`
// identically. Parity by construction rather than by two copies kept in step.
//
// PURE and import-free at runtime (type-only imports, erased): no React, no
// react-native, no supabase client. Each app owns its own RPC call and hands the
// raw rows here. That is also what lets the contract be pinned in the ALWAYS-RUN
// `mingla-business jest (full suite)` lane (a node/ts-jest runner) — the #3188
// socialRowSizing precedent.
//
// DEEP-import only (`@mingla/brand-rendering/brandSectionFeed`); deliberately NOT
// re-exported from index.ts, for the partial-mock reason documented at the top of
// PublicBrandPage.tsx.
//
// WHAT IS NOT HERE: deciding which section anything belongs to. The server
// decides by dates (migration 20270707003426); a client that re-derived it would
// be a second source of truth that drifts. This module only trusts, maps and pages.

import type { PublicBrandOfferingSection, PublicBrandUpcoming } from "./types";

export const BRAND_SECTION_RPC = "pg_public_brand_offering_section";
export const BRAND_SECTION_PAGE_SIZE = 20;
/** Happening now is read to the end in pages of this size, up to the page cap. */
export const BRAND_HAPPENING_NOW_PAGE_SIZE = 100;
export const BRAND_HAPPENING_NOW_MAX_PAGES = 10;

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

/** The keyset position of a row, in the field its section is ORDERED by. */
export interface BrandSectionCursor {
  at: string;
  id: string;
}

export interface BrandSectionPage {
  rows: PublicBrandUpcoming[];
  hasMore: boolean;
  nextCursor: BrandSectionCursor | null;
}

export interface BrandSectionRpcArgs {
  p_brand_slug: string;
  p_section: PublicBrandOfferingSection;
  p_cursor_at: string | null;
  p_cursor_id: string | null;
  p_limit: number;
}

export const brandSectionRpcArgs = (
  brandSlug: string,
  section: PublicBrandOfferingSection,
  cursor: BrandSectionCursor | null,
  limit: number,
): BrandSectionRpcArgs => ({
  p_brand_slug: brandSlug,
  p_section: section,
  p_cursor_at: cursor?.at ?? null,
  p_cursor_id: cursor?.id ?? null,
  p_limit: limit,
});

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
  // The section reader projects no theme at all — nothing to strip, nothing to
  // fabricate.
  theme: null,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  priceFromMinorUnits: row.price_from_cents,
  currency: row.currency ?? "USD",
  isFree: row.is_free,
  publishedAt: row.published_at,
});

/**
 * `starts_at` for upcoming, `ends_at` for happening_now and past — the field the
 * server orders that section by. Paging on any other field skips or repeats rows.
 */
export const brandSectionCursorFor = (
  section: PublicBrandOfferingSection,
  row: Pick<PublicBrandUpcoming, "offeringId" | "startsAt" | "endsAt">,
): BrandSectionCursor | null => {
  const at = section === "upcoming" ? row.startsAt : (row.endsAt ?? null);
  return typeof at === "string" && at.length > 0
    ? { at, id: row.offeringId }
    : null;
};

/**
 * One RPC response -> one page. The reader returns up to limit + 1 rows; the
 * extra row only signals that another page exists and is never shown. A row for
 * a DIFFERENT section is dropped (never shown in the wrong place).
 */
export const brandSectionPageFromRows = (
  section: PublicBrandOfferingSection,
  rawRows: readonly BrandSectionRowRaw[] | null | undefined,
  limit: number,
): BrandSectionPage => {
  const all = (rawRows ?? [])
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

/** Pages already loaded -> one list, first occurrence wins, order kept. */
export const mergeBrandSectionPages = (
  pages: readonly BrandSectionPage[],
): PublicBrandUpcoming[] => {
  const seen = new Set<string>();
  const out: PublicBrandUpcoming[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      const key = `${row.offeringType}:${row.offeringId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
};

/**
 * Every offering in progress, read page by page until the server says there is
 * no more — capped, so a misbehaving cursor can never loop forever.
 */
export const collectBrandHappeningNow = async (
  fetchPage: (cursor: BrandSectionCursor | null) => Promise<BrandSectionPage>,
  maxPages: number = BRAND_HAPPENING_NOW_MAX_PAGES,
): Promise<PublicBrandUpcoming[]> => {
  const pages: BrandSectionPage[] = [];
  let cursor: BrandSectionCursor | null = null;
  for (let index = 0; index < maxPages; index += 1) {
    const page = await fetchPage(cursor);
    pages.push(page);
    if (!page.hasMore || page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return mergeBrandSectionPages(pages);
};
