/**
 * Ve2 — map place_pool DB row → claim-search-pool response (whitelist only).
 */

import { mapPoolTypesToVenueCategory } from "./mapMinglaSlugToVenueCategory.ts";

export type VenueCategorySlug = "restaurant" | "play" | "creative_and_arts";

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

export function rowToPoolMatch(row: PoolMatchRow): PoolMatchResult {
  const photoUrls = photoUrlsFromRow(row);
  return {
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
  };
}

export function assertNoForbiddenKeys(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_RESPONSE_KEYS.has(key)) {
      throw new Error(`forbidden_field_leaked:${key}`);
    }
  }
}
