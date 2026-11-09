/**
 * Host places service shim — the implementation lives in
 * @mingla/location-input (Google Maps Platform behind the proxy since #4334).
 * Business-supabase-bound wrappers so importers need no `invoke` argument.
 */

import {
  autocompleteAddress as sharedAutocomplete,
  forwardHierarchy as sharedForwardHierarchy,
  newPlacesSessionToken,
  retrievePlace as sharedRetrieve,
  type AutocompleteResult,
  type HierarchicalForwardResult,
  type PlaceAutocompleteSuggestion,
  type PlaceDetails,
  type SavedLocationContext,
  // #4334 — the service file, not the package index (the index pulls the
  // address field into every importer; on web the field loads lazily).
} from "@mingla/location-input/src/placesService";
import { supabase } from "./supabase";

export type { AutocompleteResult, PlaceAutocompleteSuggestion, PlaceDetails };
export { newPlacesSessionToken };

const invoke = (fn: string, options: { body: Record<string, unknown> }) =>
  supabase.functions.invoke(fn, options);

export function autocompleteAddress(
  query: string,
  sessionToken: string,
): Promise<AutocompleteResult> {
  return sharedAutocomplete(query, sessionToken, { invoke });
}

export function retrievePlace(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetails> {
  return sharedRetrieve(placeId, sessionToken, { invoke });
}

/** Issue #1363 — safe place → city → country resolution. */
export function forwardHierarchy(
  query: string,
  savedContext: SavedLocationContext = {},
): Promise<HierarchicalForwardResult> {
  return sharedForwardHierarchy(query, savedContext, { invoke });
}
