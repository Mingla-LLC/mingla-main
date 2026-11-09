/**
 * Ve1 — normalizes a picked `PlaceDetails` for venue/brand/trip onboarding +
 * unit tests. Keeps field names stable for persistence layers.
 *
 * #4334: `placeId` is the picked GOOGLE place id. It is stored in its own
 * column (`location_provider_place_id`) and NEVER written into a
 * `google_place_id` column, which keeps its meaning: the pool/claim identity
 * (ORCH-1079 lock; VenueStep1Address / BrandCreationFlow guards).
 */

import type { PlaceDetails } from "../services/placesService";

export interface ParsedVenuePlace {
  /** The picked Google place id (not the pool identity). */
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
