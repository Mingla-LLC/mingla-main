/**
 * Ve2 — public-safe pool match contract (claim-search-pool edge function).
 *
 * ORCH-1263 §B1 — the search row grows presence facts (booleans/counts ONLY —
 * scrape-safe), `claimState`, and the server-computed `venueCategoryConfident`
 * flag; NEW `PoolAdoptionDetail` mirrors the edge fn's adoption-detail payload
 * (fetched on explicit "Yes, this is me" — I-PROPOSED-1263-ADOPTION-PAYLOAD-
 * WHITELISTED: rating/review_count VALUES never cross either response).
 */

import type { VenueCategory } from "./brand";

export type ClaimState = "available" | "pending" | "claimed";

/** Single row returned by `claim-search-pool` (whitelist fields only). */
export interface PoolMatch {
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
  venueCategory: VenueCategory;
  openingHours: unknown | null;
  photoUrls: string[];
  // ORCH-1263 §B1 — presence facts + claim state + category confidence.
  // OPTIONAL at the type level ONLY so pinned pre-1263 test literals keep
  // compiling (append-only gate); the service mapper ALWAYS sets them
  // (old-fn-tolerant defaults false/0/"available").
  hasHours?: boolean;
  hasPhone?: boolean;
  hasWebsite?: boolean;
  /** Presence ONLY — the rating VALUE stays banned server-side. */
  hasRating?: boolean;
  /** FULL stored count (search photoUrls stay capped at 6). */
  photoCount?: number;
  claimState?: ClaimState;
  /** True only for confident mapper arms (play/creative/true-restaurant). */
  venueCategoryConfident?: boolean;
}

/**
 * ORCH-1263 §B1 — the full adoption payload for ONE place, returned by
 * `claim-search-pool` detail mode (`{place_id}` body) on explicit claim
 * intent. camelCase mirror of the edge `PoolAdoptionDetail` mapper.
 */
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
  /** FULL stored gallery — http(s)-filtered, UNCAPPED. */
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
  venueCategory: VenueCategory;
  venueCategoryConfident: boolean;
}

export interface PoolSearchResponse {
  matches: PoolMatch[];
  exhausted?: boolean;
}

export const POOL_SEARCH_MIN_QUERY_LENGTH = 3;
export const POOL_SEARCH_DEBOUNCE_MS = 300;
export const POOL_SEARCH_DEFAULT_LIMIT = null;
