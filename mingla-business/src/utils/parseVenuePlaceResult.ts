/**
 * Ve1 — normalizes a Mapbox `PlaceDetails` for venue/brand/trip onboarding +
 * unit tests. Keeps field names stable for persistence layers.
 *
 * ORCH-1079 [Business-venue Google→Mapbox sweep] — renamed from
 * `parseGooglePlaceResult`; the source is now the Mapbox `mapbox-geocode` proxy
 * shape (a structural superset of the retired Google PlaceDetails). The `placeId`
 * output is an OPAQUE Mapbox id — callers MUST NOT write it into a
 * `google_place_id` column (see VenueStep1Address / BrandCreationFlow guards).
 */

import type { PlaceDetails } from "../services/mapboxGeocodeService";

export interface ParsedVenuePlace {
  /** Opaque place id (a Mapbox `mapbox_id`). NOT a Google place id. */
  placeId: string;
  formattedAddress: string;
  city: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
}

export function parseVenuePlaceResult(
  details: PlaceDetails,
): ParsedVenuePlace {
  return {
    placeId: details.placeId,
    formattedAddress: details.formattedAddress,
    city: details.city,
    countryCode: details.countryCode,
    lat: details.location.lat,
    lng: details.location.lng,
  };
}
