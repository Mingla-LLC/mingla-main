/**
 * Ve2 — debounced place_pool search via claim-search-pool edge function.
 */

import type { PoolMatch, PoolSearchResponse } from "../types/poolMatch";
import { POOL_SEARCH_DEFAULT_LIMIT, POOL_SEARCH_MIN_QUERY_LENGTH } from "../types/poolMatch";
import { supabase } from "./supabase";

function mapMatchRow(raw: Record<string, unknown>): PoolMatch {
  return {
    id: String(raw.id),
    name: String(raw.name),
    address: raw.address === null || raw.address === undefined
      ? null
      : String(raw.address),
    city: raw.city === null || raw.city === undefined ? null : String(raw.city),
    country: raw.country === null || raw.country === undefined
      ? null
      : String(raw.country),
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    googlePlaceId: raw.googlePlaceId === null || raw.googlePlaceId === undefined
      ? null
      : String(raw.googlePlaceId),
    primaryPhotoUrl: raw.primaryPhotoUrl === null ||
        raw.primaryPhotoUrl === undefined
      ? null
      : String(raw.primaryPhotoUrl),
    primaryType: raw.primaryType === null || raw.primaryType === undefined
      ? null
      : String(raw.primaryType),
    types: Array.isArray(raw.types) ? raw.types.map(String) : [],
    venueCategory: raw.venueCategory as PoolMatch["venueCategory"],
    openingHours: raw.openingHours ?? null,
    photoUrls: Array.isArray(raw.photoUrls)
      ? raw.photoUrls.map(String)
      : [],
  };
}

/**
 * Search place_pool by name (authenticated). Returns [] when query too short.
 */
export async function searchPoolMatches(
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<PoolMatch[]> {
  const q = query.trim();
  if (q.length < POOL_SEARCH_MIN_QUERY_LENGTH) {
    return [];
  }

  const { data, error } = await supabase.functions.invoke("claim-search-pool", {
    body: {
      query: q,
      limit: POOL_SEARCH_DEFAULT_LIMIT,
      fetch_all: true,
    },
  });

  if (error !== null) {
    throw error;
  }

  const body = data as PoolSearchResponse | { error?: string };
  if (body !== null && typeof body === "object" && "error" in body) {
    const code = String((body as { error: string }).error);
    if (code === "rate_limited") {
      throw new Error("rate_limited");
    }
    throw new Error(code);
  }

  const matches = (body as PoolSearchResponse)?.matches ?? [];
  return matches.map((m) =>
    mapMatchRow(m as unknown as Record<string, unknown>),
  );
}
