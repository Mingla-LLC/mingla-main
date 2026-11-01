/**
 * #3355 P5 (C3) — pure helpers for Brand Edit's structured address search
 * (BrandEditAddressField). A placed address writes the address, its point,
 * and the city and country it carries, together.
 */
import type { PlaceDetails } from "../services/mapboxGeocodeService";
import type { Brand } from "../types/brand";
import { parseVenuePlaceResult } from "./parseVenuePlaceResult";

/** The brand fields this field owns. A key left out is left as it is. */
export type BrandAddressPatch = Partial<
  Pick<Brand, "address" | "city" | "countryCode" | "lat" | "lng">
>;

/**
 * Pure: the patch a placed address writes — address, coordinates, and the
 * city and country the place carries (a place without one leaves that field
 * as it was). ORCH-1079 LOCKED: the Mapbox id is never written into
 * brands.google_place_id, so it is not part of the patch at all.
 */
export function brandAddressPatchFromLocation(
  label: string,
  location: { lat: number; lng: number; city: string | null; countryCode: string | null },
): BrandAddressPatch {
  return {
    address: label,
    lat: location.lat,
    lng: location.lng,
    ...(location.city !== null ? { city: location.city } : {}),
    ...(location.countryCode !== null
      ? { countryCode: location.countryCode.toUpperCase() }
      : {}),
  };
}

/** Pure: the patch a picked search suggestion writes. */
export function brandAddressPatchFromPlace(
  details: PlaceDetails,
  selectedLabel?: string,
): BrandAddressPatch {
  const place = parseVenuePlaceResult(details);
  return brandAddressPatchFromLocation(
    selectedLabel ?? place.formattedAddress,
    place,
  );
}

/** Pure: the "City · Country" line under the field. */
export function brandCityCountryLine(
  city: string | undefined,
  countryCode: string | undefined,
): string {
  const parts = [city?.trim(), countryCode?.trim().toUpperCase()].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length > 0
    ? `City and country: ${parts.join(", ")}`
    : "No city or country yet. Pick your address to set them.";
}
