/**
 * ISSUE-864 WP4 + toward #3697 Wave 1 A4 — advertisable destination reader.
 * Lists via SQL `ad_advertisable_pages` so Admin, Ari, and the server gate share
 * one availability authority. Canonical host matches PRODUCTION_BUSINESS_WEB_ORIGIN.
 */

import { supabase } from "../lib/supabase";

/**
 * The public-web origin the DEPLOYED create endpoint resolves and persists
 * (QA P1-1 rework): mirror of `PRODUCTION_BUSINESS_WEB_ORIGIN` in
 * `supabase/functions/_shared/businessWebOrigin.ts` — the server of record
 * for every `dest_url` (admin-ad-create-campaign builds finalUrls from it;
 * live-proven: usemingla.com/e/* 404s while host.usemingla.com/e/* 200s).
 * This MUST stay a literal equal to the server constant: the tester's
 * host-parity pin (issue864_campaign_builder_tester_adversarial.test.js) and
 * the happy-suite parity guard both read the two source literals and fail the
 * build on drift. Never invent a third host here.
 */
export const PUBLIC_WEB_ORIGIN = "https://host.usemingla.com";

export function eventUrl(brandSlug, slug) {
  return `${PUBLIC_WEB_ORIGIN}/e/${brandSlug}/${slug}`;
}

export function tripUrl(brandSlug, slug) {
  return `${PUBLIC_WEB_ORIGIN}/t/${brandSlug}/${slug}`;
}

export function experienceUrl(brandSlug, slug) {
  return `${PUBLIC_WEB_ORIGIN}/exp/${brandSlug}/${slug}`;
}

export function brandUrl(brandSlug) {
  return `${PUBLIC_WEB_ORIGIN}/b/${brandSlug}`;
}

export function stayUrl(brandSlug, slug) {
  return `${PUBLIC_WEB_ORIGIN}/b/${brandSlug}/v/${slug}`;
}

const PAGE_SIZE = 24;

/**
 * Unified list (toward #3697 A4-1…A4-5). Prefer this over the typed wrappers.
 * @param {{ search?: string, page?: number, types?: string[]|null, includeUnavailable?: boolean, brandId?: string|null }} opts
 */
export async function listAdvertisablePages({
  search = "",
  page = 0,
  types = null,
  includeUnavailable = false,
  brandId = null,
} = {}) {
  const { data, error } = await supabase.rpc("ad_advertisable_pages", {
    p_query: search.trim() || null,
    p_types: types && types.length > 0 ? types : null,
    p_include_unavailable: !!includeUnavailable,
    p_brand_id: brandId,
    p_page: page,
  });
  if (error) throw new Error(`Destination list failed: ${error.message}`);
  const raw = data ?? [];
  const rows = raw.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.entity_slug ?? row.brand_slug,
    brand_slug: row.brand_slug,
    brand_name: row.title,
    cover_media_url: row.cover_url,
    city: row.city,
    master_start_at: row.starts_at,
    page_type: row.page_type,
    dest_url: row.canonical_url,
    availability: row.availability,
    availability_reason: row.availability_reason,
    result_kind: row.result_kind,
  }));
  return {
    rows,
    total: raw[0]?.total_count != null ? Number(raw[0].total_count) : rows.length,
    pageSize: PAGE_SIZE,
  };
}

/** @deprecated prefer listAdvertisablePages({ types: ['event'] }) */
export async function listEventDestinations({ search = "", page = 0 } = {}) {
  return listAdvertisablePages({ search, page, types: ["event"] });
}

/** @deprecated prefer listAdvertisablePages({ types: ['brand'] }) */
export async function listBrandDestinations({ search = "", page = 0 } = {}) {
  return listAdvertisablePages({ search, page, types: ["brand"] });
}

/** @deprecated prefer listAdvertisablePages({ types: ['venue'] }) */
export async function listStayDestinations({ search = "", page = 0 } = {}) {
  return listAdvertisablePages({ search, page, types: ["venue"] });
}
