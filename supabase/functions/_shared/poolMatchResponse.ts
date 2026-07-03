/**
 * Ve2 — map place_pool DB row → claim-search-pool response (whitelist only).
 *
 * ORCH-1263 §A2 growth (I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED):
 *  - search rows gain presence facts (booleans/counts ONLY — scrape-safe) +
 *    claim_state + the server-computed venueCategoryConfident flag;
 *  - NEW adoption-detail mapper (rowToAdoptionDetail) for the single-place
 *    payload fetched on explicit claim intent ("Yes, this is me").
 * FORBIDDEN_RESPONSE_KEYS is UNCHANGED — rating/review_count VALUES stay
 * banned (deliberate Ve2 ruling, commit c07de2a49); has_rating/hasRating is
 * the allowed presence-boolean ceiling. Both mappers self-assert their output
 * through assertNoForbiddenKeys (defense-in-depth: a future edit that leaks a
 * banned column throws at runtime, not silently).
 */

import {
  isConfidentVenueCategory,
  mapPoolTypesToVenueCategory,
} from "./mapMinglaSlugToVenueCategory.ts";
import { FACET_COLUMNS } from "./authoredApply.ts";

export type VenueCategorySlug = "restaurant" | "play" | "creative_and_arts";

export type ClaimState = "available" | "pending" | "claimed";

export interface PoolMatchRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  google_place_id: string | null;
  primary_type: string | null;
  types: string[] | null;
  opening_hours: unknown | null;
  stored_photo_urls: string[] | null;
  // ORCH-1263 A1.1 additions (optional: tolerate the pre-1263 RPC shape).
  has_hours?: boolean | null;
  has_phone?: boolean | null;
  has_website?: boolean | null;
  has_rating?: boolean | null;
  photo_count?: number | null;
  claim_state?: string | null;
}

export interface PoolMatchResult {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  googlePlaceId: string | null;
  primaryPhotoUrl: string | null;
  primaryType: string | null;
  types: string[];
  venueCategory: VenueCategorySlug;
  openingHours: unknown | null;
  photoUrls: string[];
  // ORCH-1263 §A2: presence facts + claim state + category confidence.
  hasHours: boolean;
  hasPhone: boolean;
  hasWebsite: boolean;
  hasRating: boolean;
  photoCount: number;
  claimState: ClaimState;
  venueCategoryConfident: boolean;
}

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "bouncer_reason",
  "is_servable",
  "photo_aesthetic_data",
  "raw_google_data",
  "ai_categories",
  "seeding_category",
  "ai_reason",
  "ai_primary_identity",
  "ai_confidence",
  "ai_web_evidence",
  "rating",
  "review_count",
]);

export function photoUrlsFromRow(row: PoolMatchRow, max = 6): string[] {
  const stored = (row.stored_photo_urls ?? []).filter(
    (u) => typeof u === "string" && u.length > 0,
  );
  return stored.slice(0, max);
}

function normalizeClaimState(raw: string | null | undefined): ClaimState {
  // Old-RPC tolerance: absent/unknown → "available" (pre-1263 behavior — the
  // 23505 submit backstop still guards the race).
  return raw === "claimed" || raw === "pending" ? raw : "available";
}

export function rowToPoolMatch(row: PoolMatchRow): PoolMatchResult {
  const photoUrls = photoUrlsFromRow(row);
  const result: PoolMatchResult = {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    googlePlaceId: row.google_place_id,
    primaryPhotoUrl: photoUrls[0] ?? null,
    primaryType: row.primary_type,
    types: row.types ?? [],
    venueCategory: mapPoolTypesToVenueCategory(row.primary_type, row.types),
    openingHours: row.opening_hours,
    photoUrls,
    hasHours: row.has_hours === true,
    hasPhone: row.has_phone === true,
    hasWebsite: row.has_website === true,
    hasRating: row.has_rating === true,
    photoCount: typeof row.photo_count === "number" && row.photo_count > 0
      ? row.photo_count
      : 0,
    claimState: normalizeClaimState(row.claim_state),
    venueCategoryConfident: isConfidentVenueCategory(row.primary_type, row.types),
  };
  assertNoForbiddenKeys(result as unknown as Record<string, unknown>);
  return result;
}

// ── ORCH-1263 §A2 — adoption detail (single place, fetched on YES) ──────────

/** Row shape of public.biz_get_place_adoption_detail (A1.2). Facet columns
 *  arrive as flat booleans and are folded into `facets` by the mapper. */
export interface PoolAdoptionDetailRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  google_place_id: string | null;
  primary_type: string | null;
  types: string[] | null;
  opening_hours: unknown | null;
  stored_photo_urls: string[] | null;
  national_phone_number: string | null;
  website: string | null;
  price_tiers: string[] | null;
  price_level: string | null;
  generative_summary: string | null;
  editorial_summary: string | null;
  reservable: boolean | null;
  [facetColumn: string]: unknown;
}

export interface PoolAdoptionDetail {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  googlePlaceId: string | null;
  primaryType: string | null;
  types: string[];
  openingHours: unknown | null;
  /** FULL stored gallery — http(s)-filtered, UNCAPPED (search stays capped 6). */
  photoUrls: string[];
  nationalPhoneNumber: string | null;
  website: string | null;
  priceTiers: string[];
  priceLevel: string | null;
  generativeSummary: string | null;
  editorialSummary: string | null;
  reservable: boolean;
  /** The 23 FACET_COLUMNS folded to a record (boolean | null per facet id). */
  facets: Record<string, boolean | null>;
  venueCategory: VenueCategorySlug;
  venueCategoryConfident: boolean;
}

export function rowToAdoptionDetail(row: PoolAdoptionDetailRow): PoolAdoptionDetail {
  const photoUrls = (row.stored_photo_urls ?? []).filter(
    (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u),
  );
  const facets: Record<string, boolean | null> = {};
  for (const facetId of FACET_COLUMNS) {
    const v = row[facetId];
    facets[facetId] = typeof v === "boolean" ? v : null;
  }
  const detail: PoolAdoptionDetail = {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    googlePlaceId: row.google_place_id,
    primaryType: row.primary_type,
    types: row.types ?? [],
    openingHours: row.opening_hours,
    photoUrls,
    nationalPhoneNumber: row.national_phone_number,
    website: row.website,
    priceTiers: (row.price_tiers ?? []).filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    ),
    priceLevel: row.price_level,
    generativeSummary: row.generative_summary,
    editorialSummary: row.editorial_summary,
    reservable: row.reservable === true,
    facets,
    venueCategory: mapPoolTypesToVenueCategory(row.primary_type, row.types),
    venueCategoryConfident: isConfidentVenueCategory(row.primary_type, row.types),
  };
  assertNoForbiddenKeys(detail as unknown as Record<string, unknown>);
  assertNoForbiddenKeys(detail.facets as Record<string, unknown>);
  return detail;
}

export function assertNoForbiddenKeys(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_RESPONSE_KEYS.has(key)) {
      throw new Error(`forbidden_field_leaked:${key}`);
    }
  }
}
