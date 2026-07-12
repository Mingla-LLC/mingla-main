/**
 * @mingla/location-input · mapboxGeocodeService
 *
 * Shared Mapbox Search Box autocomplete + retrieve (+ reverse/forward) for the
 * address/city picker, consumed by BOTH mingla-business (experience stops) and
 * app-mobile (consumer discover/preferences/onboarding). Extracted from
 * mingla-business/src/services/mapboxGeocodeService.ts per META-ORCH-1060 §3.2.
 *
 * All calls proxy through the `mapbox-geocode` Supabase edge fn so the
 * MAPBOX_ACCESS_TOKEN stays server-side. Each app has its OWN supabase
 * singleton, so the caller INJECTS `invoke` (its `supabase.functions.invoke`).
 *
 * Edge fn contract (single endpoint, action discriminator):
 *   invoke("mapbox-geocode", { body: { action: "suggest",  query, session_token } })
 *     → { suggestions: PlaceAutocompleteSuggestion[] } | { error }
 *   invoke("mapbox-geocode", { body: { action: "retrieve", mapbox_id, session_token } })
 *     → { details: PlaceDetails } | { error }
 *   invoke("mapbox-geocode", { body: { action: "reverse",  latitude, longitude } })
 *     → { details: PlaceDetails } | { error }
 *   invoke("mapbox-geocode", { body: { action: "forward",  query } })
 *     → { details: PlaceDetails } | { error }
 *
 * Session token: one client-generated UUID per autocomplete session, reused
 * across the suggest→retrieve pair (Mapbox bills the pair as ONE session —
 * https://docs.mapbox.com/api/search/search-box/#session-billing). reverse +
 * forward are per-request (no session token).
 *
 * Error contract:
 *   - autocompleteMapbox() returns [] on failure (silent type-ahead fallback).
 *   - retrieveMapboxPlace() / reverse / forward THROW on failure, preserving the
 *     edge fn's error code (mapbox_access_token_missing | no_locality |
 *     no_location | coordinates_required | mapbox_<status>) so callers can map
 *     to user-friendly copy.
 */

export interface PlaceAutocompleteSuggestion {
  placeId: string;
  displayName: string;
  fullAddress: string;
}

export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  /** Locality (city) — required; the edge fn 500s if not derivable. */
  city: string;
  /** Region display name (e.g. "England", "North Carolina") — nullable. */
  region: string | null;
  /**
   * META-ORCH-1060: ISO 3166-2 subdivision code (e.g. "NC") — STRUCTURED from
   * Mapbox context.region.region_code, NEVER parsed from a display string.
   * https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
   */
  regionCode: string | null;
  /** META-ORCH-1060: prefixed subdivision (e.g. "US-NC") — STRUCTURED. */
  regionCodeFull: string | null;
  /** ISO 3166-1 alpha-2 (e.g. "GB", "US") — nullable. */
  countryCode: string | null;
  location: { lat: number; lng: number };
}

/** The injected edge-fn invoker — each app passes its own supabase.functions.invoke. */
export type InvokeFn = (
  fn: string,
  options: { body: Record<string, unknown> },
) => Promise<{ data: any; error: { message?: string } | null }>;

/**
 * ORCH-1361 [location-suggestions] — OPTIONAL Mapbox Search Box bias, threaded
 * from the consumer host's device location. ADDITIVE: every field is optional
 * and each is forwarded to the edge fn ONLY when present, so a caller that omits
 * `bias` (business pickers, consumer geocodingService adapter) produces a
 * BYTE-IDENTICAL request to the pre-1361 behavior. Without proximity, Mapbox
 * defaults to IP proximity (the edge datacenter) and mis-ranks results.
 * Doc-verified formats (https://docs.mapbox.com/api/search/search-box/):
 *   proximity "longitude,latitude"; country ISO-3166-1 alpha-2 CSV; types CSV;
 *   limit ≤ 10 (suggest only — forward stays single-result).
 */
export interface LocationBias {
  proximity?: string;
  country?: string;
  types?: string;
  limit?: number;
}

const MIN_QUERY_LENGTH = 3;

/** Generate one Mapbox session token (UUID) per autocomplete session. Reuse
 *  the SAME token across the suggest→retrieve pair for correct session billing. */
export function newMapboxSessionToken(): string {
  // RN runtimes lack crypto.randomUUID; build a v4-shaped UUID from Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Type-ahead autocomplete. Returns up to 5 suggestions. Empty array on any
 * failure or when query.length < 3. Silent fallback — type-ahead failures
 * during keystrokes are not user-actionable.
 * https://docs.mapbox.com/api/search/search-box/#get-suggestions
 */
export async function autocompleteMapbox(
  query: string,
  sessionToken: string,
  deps: { invoke: InvokeFn },
  bias?: LocationBias,
): Promise<PlaceAutocompleteSuggestion[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  try {
    const { data, error } = await deps.invoke("mapbox-geocode", {
      // ORCH-1361 — bias fields merged ONLY when present; omitted → byte-identical.
      body: {
        action: "suggest",
        query: q,
        session_token: sessionToken,
        ...(bias?.proximity ? { proximity: bias.proximity } : {}),
        ...(bias?.country ? { country: bias.country } : {}),
        ...(bias?.types ? { types: bias.types } : {}),
        ...(bias?.limit ? { limit: bias.limit } : {}),
      },
    });
    if (error) {
      console.warn("[mapboxGeocodeService] suggest error:", error.message);
      return [];
    }
    if (!data || !Array.isArray(data.suggestions)) return [];
    return data.suggestions as PlaceAutocompleteSuggestion[];
  } catch (e) {
    console.warn("[mapboxGeocodeService] suggest throw:", e);
    return [];
  }
}

/**
 * Retrieve full place details after the user picks a suggestion. Extracts
 * structured city + region + regionCode + countryCode + lat/lng. THROWS on any
 * failure (callers must surface the error to the user).
 * https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
 */
export async function retrieveMapboxPlace(
  placeId: string,
  sessionToken: string,
  deps: { invoke: InvokeFn },
): Promise<PlaceDetails> {
  if (!placeId) throw new Error("MAPBOX_ID_REQUIRED");

  const { data, error } = await deps.invoke("mapbox-geocode", {
    body: { action: "retrieve", mapbox_id: placeId, session_token: sessionToken },
  });

  if (error) {
    throw new Error(error.message ?? "mapbox_proxy_failed");
  }
  if (!data || !data.details) {
    throw new Error("mapbox_proxy_empty_response");
  }
  return data.details as PlaceDetails;
}

/**
 * Reverse-geocode coordinates → PlaceDetails (city/region/regionCode/country).
 * Per-request (no session token). THROWS on failure.
 * https://docs.mapbox.com/api/search/search-box/ (reverse) ·
 * https://docs.mapbox.com/api/search/geocoding/ (v6 fallback)
 */
export async function reverseGeocodeMapbox(
  latitude: number,
  longitude: number,
  deps: { invoke: InvokeFn },
): Promise<PlaceDetails> {
  const { data, error } = await deps.invoke("mapbox-geocode", {
    body: { action: "reverse", latitude, longitude },
  });
  if (error) {
    throw new Error(error.message ?? "mapbox_reverse_failed");
  }
  if (!data || !data.details) {
    throw new Error("mapbox_reverse_empty_response");
  }
  return data.details as PlaceDetails;
}

/**
 * Forward-geocode free text → PlaceDetails. Single-call (no session token).
 * THROWS on failure.
 * https://docs.mapbox.com/api/search/search-box/ (forward) ·
 * https://docs.mapbox.com/api/search/geocoding/ (v6 fallback)
 */
export async function forwardGeocodeMapbox(
  query: string,
  deps: { invoke: InvokeFn },
  bias?: LocationBias,
): Promise<PlaceDetails> {
  const q = query.trim();
  if (q.length === 0) throw new Error("query_required");

  const { data, error } = await deps.invoke("mapbox-geocode", {
    // ORCH-1361 — forward is single-result (no `limit`); proximity/country/types
    // merged ONLY when present so an unbiased caller is byte-identical.
    body: {
      action: "forward",
      query: q,
      ...(bias?.proximity ? { proximity: bias.proximity } : {}),
      ...(bias?.country ? { country: bias.country } : {}),
      ...(bias?.types ? { types: bias.types } : {}),
    },
  });
  if (error) {
    throw new Error(error.message ?? "mapbox_forward_failed");
  }
  if (!data || !data.details) {
    throw new Error("mapbox_forward_empty_response");
  }
  return data.details as PlaceDetails;
}
