/**
 * ISSUE-864 WP4 [Campaign Builder] — SPEC §4.3 destination reader (A4.0(3)
 * destination policy v1): live public pages ONLY. Reads
 * business_public_events_view (public + status ∈ {scheduled, live} + FUTURE
 * master_start_at — the view itself also exposes ended/cancelled, which paid
 * traffic must never point at) and public brand pages.
 *
 * The AD-VISIBLE destination is the canonical https://usemingla.com URL on
 * ALL channels (PROOF D-P1 — the OneLink serves crawlers an app-install
 * interstitial); the OneLink is built server-side and rides ONLY in Google's
 * tracking_url_template. This service only resolves canonical URLs.
 */

import { supabase } from "../lib/supabase";

/** Matches the server's BUSINESS_WEB_ORIGIN default (PRODUCTION_BUSINESS_WEB_ORIGIN). */
export const PUBLIC_WEB_ORIGIN = "https://usemingla.com";

export function eventUrl(brandSlug, slug) {
  return `${PUBLIC_WEB_ORIGIN}/e/${brandSlug}/${slug}`;
}

export function brandUrl(brandSlug) {
  return `${PUBLIC_WEB_ORIGIN}/b/${brandSlug}`;
}

const PAGE_SIZE = 24;

/**
 * List advertisable event pages. Throws on error (house pattern).
 * Returns { rows, total } — rows carry the resolved canonical URL.
 */
export async function listEventDestinations({ search = "", page = 0 } = {}) {
  let query = supabase
    .from("business_public_events_view")
    .select(
      "id, title, slug, brand_slug, brand_name, cover_media_url, city, master_start_at, status, event_type, visibility",
      { count: "exact" },
    )
    .in("status", ["scheduled", "live"]) // never ended/cancelled (§4.4b create gate)
    .gt("master_start_at", new Date().toISOString()) // ads at a past event get rejected as an unavailable offer
    .order("master_start_at", { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (search.trim()) {
    query = query.or(`title.ilike.%${search.trim()}%,brand_name.ilike.%${search.trim()}%`);
  }
  const { data, error, count } = await query;
  if (error) throw new Error(`Destination list failed: ${error.message}`);
  return {
    rows: (data ?? []).map((row) => ({
      ...row,
      page_type: "event",
      dest_url: eventUrl(row.brand_slug, row.slug),
    })),
    total: count ?? 0,
  };
}

/**
 * List public brand pages (create resolves them via
 * business_public_brands_view — mirror that source, not the raw table).
 */
export async function listBrandDestinations({ search = "", page = 0 } = {}) {
  let query = supabase
    .from("business_public_brands_view")
    .select("id, name, slug, profile_photo_url", { count: "exact" })
    .order("name", { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (search.trim()) {
    query = query.ilike("name", `%${search.trim()}%`);
  }
  const { data, error, count } = await query;
  if (error) throw new Error(`Brand list failed: ${error.message}`);
  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      title: row.name,
      slug: row.slug,
      brand_slug: row.slug,
      brand_name: row.name,
      cover_media_url: row.profile_photo_url,
      page_type: "brand",
      dest_url: brandUrl(row.slug),
    })),
    total: count ?? 0,
  };
}
