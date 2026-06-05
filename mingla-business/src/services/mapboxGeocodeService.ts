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
