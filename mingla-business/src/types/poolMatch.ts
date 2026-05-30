/**
 * Ve2 — public-safe pool match contract (claim-search-pool edge function).
 */

import type { VenueCategory } from "./brand";

/** Single row returned by `claim-search-pool` (whitelist fields only). */
export interface PoolMatch {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  googlePlaceId: string;
  primaryPhotoUrl: string | null;
  primaryType: string | null;
  types: string[];
  venueCategory: VenueCategory;
  openingHours: unknown | null;
  photoUrls: string[];
}

export interface PoolSearchResponse {
  matches: PoolMatch[];
}

export const POOL_SEARCH_MIN_QUERY_LENGTH = 3;
export const POOL_SEARCH_DEBOUNCE_MS = 300;
export const POOL_SEARCH_DEFAULT_LIMIT = 1;
