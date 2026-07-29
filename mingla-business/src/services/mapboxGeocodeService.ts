/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 4
 * META-ORCH-1060 [Mapbox consumer migration] · §3.2 — EXTRACTED to the shared
 * @mingla/location-input package.
 *
 * This file is now a THIN business-bound shim. The implementation lives in
 * @mingla/location-input; here we re-export the types and provide business-
 * supabase-bound convenience wrappers so existing importers keep their exact
 * signatures (no `invoke` arg). New code should import from
 * @mingla/location-input directly.
 */

import {
  autocompleteMapbox as sharedAutocomplete,
  retrieveMapboxPlace as sharedRetrieve,
  forwardGeocodeMapbox as sharedForward,
  reverseGeocodeMapbox as sharedReverse,
  newMapboxSessionToken,
  type PlaceAutocompleteSuggestion,
  type PlaceDetails,
} from "@mingla/location-input";
import { supabase } from "./supabase";

export type { PlaceAutocompleteSuggestion, PlaceDetails };
export { newMapboxSessionToken };

const invoke = (fn: string, options: { body: Record<string, unknown> }) =>
  supabase.functions.invoke(fn, options);

export function autocompleteMapbox(
  query: string,
  sessionToken: string,
): Promise<PlaceAutocompleteSuggestion[]> {
  return sharedAutocomplete(query, sessionToken, { invoke });
}

export function retrieveMapboxPlace(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetails> {
  return sharedRetrieve(placeId, sessionToken, { invoke });
}

/**
 * Issue #1363 — Tier-2 free-text → coords. Business-bound wrapper over the
 * shared `forwardGeocodeMapbox`; THROWS on failure (empty/unindexed query)
 * exactly like the shared primitive, so callers can distinguish "no match"
 * (→ leave lat/lng null + surface "drop a pin", rule 3) from a real coordinate.
 */
export function forwardGeocodeMapbox(query: string): Promise<PlaceDetails> {
  return sharedForward(query, { invoke });
}

/**
 * Issue #1363 — Tier-3 pin → address. Business-bound wrapper over the shared
 * `reverseGeocodeMapbox`; THROWS on failure. Used to fill city/region/country
 * from a dropped pin's coordinate (the coordinate itself is authoritative).
 */
export function reverseGeocodeMapbox(
  latitude: number,
  longitude: number,
): Promise<PlaceDetails> {
  return sharedReverse(latitude, longitude, { invoke });
}
