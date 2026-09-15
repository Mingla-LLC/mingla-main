/**
 * #3426 — Host web / Business reads for the public brand page's date-decided
 * sections.
 *
 * `pg_public_brand_offering_section` (anon, SECURITY DEFINER; migration
 * 20270707003426) returns ONE section of one brand page — `happening_now`,
 * `upcoming` or `past` — for all four offering kinds, decided by each
 * offering's `event_dates` and never by `events.status`. Mapping, paging and
 * de-duplication live in `@mingla/brand-rendering/brandSectionFeed`, the same
 * module Explorer uses, so the two surfaces cannot drift. This file only makes
 * the call. The route does no date arithmetic (the #1902 wrapper gate forbids
 * it, and the server already decided).
 *
 * The Upcoming tab keeps reading `pg_public_brand_upcoming` through
 * `getPublicBrandBySlug`; that reader was re-emitted onto the same classifier,
 * so the two cannot disagree about what is upcoming.
 */

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
  type BrandSectionCursor,
  type BrandSectionPage,
  type BrandSectionRowRaw,
} from "@mingla/brand-rendering/brandSectionFeed";

import { supabase } from "./supabase";

export const fetchPublicBrandOfferingSection = async (
  brandSlug: string,
  section: PublicBrandOfferingSection,
  cursor: BrandSectionCursor | null = null,
  limit: number = BRAND_SECTION_PAGE_SIZE,
): Promise<BrandSectionPage> => {
  const { data, error } = await supabase.rpc(
    BRAND_SECTION_RPC,
    brandSectionRpcArgs(brandSlug, section, cursor, limit),
  );
  if (error !== null) throw error;
  return brandSectionPageFromRows(
    section,
    data as BrandSectionRowRaw[] | null,
    limit,
  );
};

export const fetchPublicBrandHappeningNow = (
  brandSlug: string,
): Promise<PublicBrandUpcoming[]> =>
  collectBrandHappeningNow((cursor) =>
    fetchPublicBrandOfferingSection(
      brandSlug,
      "happening_now",
      cursor,
      BRAND_HAPPENING_NOW_PAGE_SIZE,
    ),
  );
