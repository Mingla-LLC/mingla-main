/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 4
 *
 * mapboxGeocodeService — Mapbox Search Box autocomplete + retrieve for the
 * experience stops builder's address field. Mirrors googlePlacesService.ts
 * (events keep Google; experiences use Mapbox per operator lock).
 *
 * All calls proxy through the `mapbox-geocode` Supabase edge fn so the
 * MAPBOX_ACCESS_TOKEN stays server-side (never shipped in the client bundle).
 *
 * Edge fn contract (single endpoint, action discriminator):
 *   supabase.functions.invoke("mapbox-geocode", {
 *     body: { action: "suggest",  query, session_token }
 *   }) → { suggestions: PlaceAutocompleteSuggestion[] } | { error }
 *   supabase.functions.invoke("mapbox-geocode", {
 *     body: { action: "retrieve", mapbox_id, session_token }
 *   }) → { details: PlaceDetails } | { error }
 *
 * Session token: one client-generated UUID per autocomplete session, reused
 * across the suggest→retrieve pair (Mapbox bills the pair as ONE session —
 * https://docs.mapbox.com/api/search/search-box/#session-billing).
 *
 * Error contract (mirrors googlePlacesService):
 *   - autocompleteMapbox() returns [] on failure (silent type-ahead fallback).
 *   - retrieveMapboxPlace() THROWS on failure, preserving the edge fn's error
 *     code (mapbox_access_token_missing | no_locality | no_location |
 *     mapbox_<status>) so MapboxAddressInput can map to user-friendly copy.
 *
 * The PlaceAutocompleteSuggestion + PlaceDetails shapes are STRUCTURALLY
 * IDENTICAL to googlePlacesService's, so MapboxAddressInput is a drop-in for
 * the AddressAutocompleteInput onPick(details: PlaceDetails) contract.
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
  /** Locality (city) — required; the edge fn 500s if not derivable. */
  city: string;
  /** Region (e.g. "England", "CA") — nullable. */
  region: string | null;
  /** ISO 3166-1 alpha-2 (e.g. "GB", "US") — nullable. */
  countryCode: string | null;
  location: { lat: number; lng: number };
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
 * failure or when query.length < 3 (signal to UI: don't show dropdown).
 * Silent fallback — type-ahead failures during keystrokes are not
 * user-actionable. retrieveMapboxPlace() throws loudly when the user picks.
 */
export async function autocompleteMapbox(
  query: string,
  sessionToken: string,
): Promise<PlaceAutocompleteSuggestion[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  try {
    const { data, error } = await supabase.functions.invoke("mapbox-geocode", {
      body: { action: "suggest", query: q, session_token: sessionToken },
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
 * structured city + region + countryCode + lat/lng. THROWS on any failure
 * (callers must surface the error to the user, per Constitution #3).
 */
export async function retrieveMapboxPlace(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetails> {
  if (!placeId) throw new Error("MAPBOX_ID_REQUIRED");

  const { data, error } = await supabase.functions.invoke("mapbox-geocode", {
    body: { action: "retrieve", mapbox_id: placeId, session_token: sessionToken },
  });

  if (error) {
    // Preserve the upstream error code so the picker maps to the right copy:
    //   mapbox_access_token_missing | no_locality | no_location | mapbox_<status>
    throw new Error(error.message ?? "mapbox_proxy_failed");
  }
  if (!data || !data.details) {
    throw new Error("mapbox_proxy_empty_response");
  }
  return data.details as PlaceDetails;
}
