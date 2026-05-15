/**
 * ORCH-0824 — Google Places autocomplete + place-details for the business
 * event creator's address field (Step 3 — Where).
 *
 * As of ORCH-0824 hotfix-4 (2026-05-13), this module proxies all Google
 * Places calls through the `places-autocomplete` Supabase edge function
 * rather than calling Google directly. Reasons:
 *
 *   1. The `GOOGLE_MAPS_API_KEY` is already provisioned as a Supabase
 *      secret used by 6+ edge functions (admin-seed-places,
 *      backfill-place-photos, etc.). Reusing it avoids duplicating the
 *      key into client-side env vars and reduces blast radius if it
 *      needs rotation.
 *   2. Keys shipped in the React Native bundle (via `EXPO_PUBLIC_*` env
 *      vars) end up readable inside the JS bundle on the device. The
 *      proxy keeps the key strictly server-side.
 *   3. We can add server-side caching, rate limiting, or abuse detection
 *      in one place if needed.
 *
 * Edge function contract (single endpoint, action discriminator):
 *
 *   supabase.functions.invoke("places-autocomplete", {
 *     body: { action: "autocomplete", query: string }
 *   })
 *     → { suggestions: PlaceAutocompleteSuggestion[] } | { error: string }
 *
 *   supabase.functions.invoke("places-autocomplete", {
 *     body: { action: "details", placeId: string }
 *   })
 *     → { details: PlaceDetails } | { error: string }
 *
 * Auth: verify_jwt = true on the edge function. Caller must be
 * authenticated (the wizard flow is always auth-gated).
 *
 * Error contract (unchanged from hotfix-1):
 *   - autocompletePlaces() returns [] on failure (silent fallback OK for
 *     type-ahead UX; the user can keep typing).
 *   - fetchPlaceDetails() THROWS on failure. Error message preserves the
 *     edge function's `error` code (`google_maps_api_key_missing`,
 *     `no_locality`, `google_places_<status>`, etc.) so AddressAutocomplete
 *     can map to user-friendly toasts.
 */

import { supabase } from "./supabase";

export interface PlaceAutocompleteSuggestion {
  placeId: string;
  displayName: string;
  fullAddress: string;
}

export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  /** Locality (city) — required; throws if not derivable. */
  city: string;
  /** administrative_area_level_1 short name (e.g., "CA", "NY"). */
  region: string | null;
  /** ISO 3166-1 alpha-2 (e.g., "US", "GB"). */
  countryCode: string | null;
  location: { lat: number; lng: number };
}

/**
 * Type-ahead autocomplete. Returns up to 5 suggestions. Empty array on any
 * failure or when query.length < 3 (signal to UI: don't show dropdown).
 *
 * Silent fallback on failure — type-ahead failures during keystrokes are
 * not user-actionable, and the user can keep typing. The pick-time
 * fetchPlaceDetails() will throw if the API is actually broken when they
 * attempt to use the field.
 */
export async function autocompletePlaces(
  query: string,
): Promise<PlaceAutocompleteSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  try {
    const { data, error } = await supabase.functions.invoke(
      "places-autocomplete",
      { body: { action: "autocomplete", query: q } },
    );

    if (error) {
      console.warn("[googlePlacesService] autocomplete error:", error.message);
      return [];
    }
    if (!data || !Array.isArray(data.suggestions)) {
      return [];
    }
    return data.suggestions as PlaceAutocompleteSuggestion[];
  } catch (e) {
    console.warn("[googlePlacesService] autocomplete throw:", e);
    return [];
  }
}

/**
 * Place-details fetch — used after the user picks a suggestion. Extracts
 * structured city + lat/lng. Throws on any failure (callers must surface
 * the error to the user, per Constitution #3).
 */
export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails> {
  if (!placeId) throw new Error("PLACE_ID_REQUIRED");

  const { data, error } = await supabase.functions.invoke(
    "places-autocomplete",
    { body: { action: "details", placeId } },
  );

  if (error) {
    // Edge function returned non-2xx OR network error. Preserve the
    // upstream error code in the thrown Error so AddressAutocomplete
    // can map to the right toast. Common codes:
    //   - google_maps_api_key_missing (server misconfig)
    //   - no_locality (Google returned no city for this place)
    //   - no_location (Google returned no lat/lng)
    //   - google_places_<status> (upstream Google error)
    //   - method_not_allowed / invalid_action (client bug — shouldn't happen)
    throw new Error(error.message ?? "places_proxy_failed");
  }

  if (!data || !data.details) {
    throw new Error("places_proxy_empty_response");
  }

  return data.details as PlaceDetails;
}
