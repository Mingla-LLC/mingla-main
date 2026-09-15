/**
 * #3426 — the public brand page's date-decided sections.
 *
 * `pg_public_brand_offering_section` (anon, SECURITY DEFINER; migration
 * 20270707003426) returns ONE section of one brand page — `happening_now`,
 * `upcoming` or `past` — for all four offering kinds, decided by each
 * offering's `event_dates` and never by `events.status`. This module owns the
 * wire mapping and the keyset cursor so the route never does date arithmetic
 * (the #1902 wrapper gate forbids it there, and the server already decided).
 *
 * The Upcoming tab keeps reading `pg_public_brand_upcoming` through
 * `getPublicBrandBySlug`; that reader was re-emitted onto the same classifier,
 * so the two can never disagree about what is upcoming.
 */

import { supabase } from "./supabase";
import type { PublicUpcomingRow } from "./publicEventsService";

export type PublicBrandOfferingSection = "happening_now" | "upcoming" | "past";

export interface PublicBrandSectionRowRaw {
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
  starts_at: string;
  ends_at: string | null;
  price_from_cents: number | null;
  currency: string | null;
  is_free: boolean;
  published_at: string;
}

/** The keyset position of the last row on a page, in the section's own order. */
export interface PublicBrandSectionCursor {
  at: string;
  id: string;
}

export interface PublicBrandSectionPage {
  rows: PublicUpcomingRow[];
  hasMore: boolean;
  nextCursor: PublicBrandSectionCursor | null;
}

export const PUBLIC_BRAND_SECTION_PAGE_SIZE = 20;
/** Happening now is read to the end, in pages of this size, up to the cap. */
export const PUBLIC_BRAND_HAPPENING_NOW_PAGE_SIZE = 100;
export const PUBLIC_BRAND_HAPPENING_NOW_MAX_PAGES = 10;

export const sectionRowToCard = (
  row: PublicBrandSectionRowRaw,
): PublicUpcomingRow => ({
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
  // The section reader projects no theme at all (nothing to strip); the card
  // shape's theme is an empty record, never a fabricated one.
  theme: {},
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  priceFromMinorUnits: row.price_from_cents,
  currency: row.currency ?? "USD",
  isFree: row.is_free,
  publishedAt: row.published_at,
});

/**
 * The cursor field is the one the section is ORDERED by: `starts_at` for
 * upcoming, `ends_at` for happening_now and past. Paging on any other field
 * would skip or repeat rows.
 */
export const sectionCursorFor = (
  section: PublicBrandOfferingSection,
  row: PublicUpcomingRow,
): PublicBrandSectionCursor | null => {
  const at = section === "upcoming" ? row.startsAt : (row.endsAt ?? null);
  return typeof at === "string" && at.length > 0
    ? { at, id: row.offeringId }
    : null;
};

export const fetchPublicBrandOfferingSection = async (
  brandSlug: string,
  section: PublicBrandOfferingSection,
  cursor: PublicBrandSectionCursor | null = null,
  limit: number = PUBLIC_BRAND_SECTION_PAGE_SIZE,
): Promise<PublicBrandSectionPage> => {
  const { data, error } = await supabase.rpc(
    "pg_public_brand_offering_section",
    {
      p_brand_slug: brandSlug,
      p_section: section,
      p_cursor_at: cursor?.at ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_limit: limit,
    },
  );
  if (error !== null) throw error;
  const all = ((data ?? []) as PublicBrandSectionRowRaw[])
    // Defence in depth: a row that is not the section asked for is dropped,
    // never shown in the wrong place.
    .filter((row) => row.section === section)
    .map(sectionRowToCard);
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;
  const last = rows[rows.length - 1];
  return {
    rows,
    hasMore,
    nextCursor:
      hasMore && last !== undefined ? sectionCursorFor(section, last) : null,
  };
};

/** Every offering in progress right now, read page by page to the end (capped). */
export const fetchPublicBrandHappeningNow = async (
  brandSlug: string,
): Promise<PublicUpcomingRow[]> => {
  const rows: PublicUpcomingRow[] = [];
  let cursor: PublicBrandSectionCursor | null = null;
  for (let page = 0; page < PUBLIC_BRAND_HAPPENING_NOW_MAX_PAGES; page += 1) {
    const result: PublicBrandSectionPage = await fetchPublicBrandOfferingSection(
      brandSlug,
      "happening_now",
      cursor,
      PUBLIC_BRAND_HAPPENING_NOW_PAGE_SIZE,
    );
    rows.push(...result.rows);
    if (!result.hasMore || result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return rows;
};
