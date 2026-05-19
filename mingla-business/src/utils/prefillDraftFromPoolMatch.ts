/**
 * Ve2 — apply pool match row to venue onboarding draft store fields.
 */

import type { PoolMatch } from "../types/poolMatch";
import type { DraftVenueState } from "../store/draftVenueStore";
import { slugifyBrandSlug } from "./brandSlugify";
import { mapPoolOpeningHoursToBrandHours } from "./mapPoolOpeningHoursToBrandHours";

export function prefillDraftFromPoolMatch(
  match: PoolMatch,
): Partial<DraftVenueState> {
  const name = match.name.trim();
  return {
    placePoolId: match.id,
    workingName: name,
    displayName: name,
    slug: slugifyBrandSlug(name),
    formattedAddress: match.address?.trim() ?? "",
    googlePlaceId: match.googlePlaceId,
    lat: match.lat,
    lng: match.lng,
    city: match.city,
    countryCode: match.country?.slice(0, 2) ?? null,
    venueCategory: match.venueCategory,
    hours: mapPoolOpeningHoursToBrandHours(match.openingHours),
    photoUris: [...match.photoUrls],
  };
}
