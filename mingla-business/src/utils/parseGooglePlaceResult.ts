/**
 * Ve1 — normalizes Google Places details for venue onboarding + unit tests.
 *
 * Prefer `PlaceDetails` from `googlePlacesService` (edge proxy shape); this
 * helper keeps field names stable for persistence layers.
 */

import type { PlaceDetails } from "../services/googlePlacesService";

export interface ParsedVenuePlace {
  googlePlaceId: string;
  formattedAddress: string;
  city: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
}

export function parseGooglePlaceResult(
  details: PlaceDetails,
): ParsedVenuePlace {
  return {
    googlePlaceId: details.placeId,
    formattedAddress: details.formattedAddress,
    city: details.city,
    countryCode: details.countryCode,
    lat: details.location.lat,
    lng: details.location.lng,
  };
}
