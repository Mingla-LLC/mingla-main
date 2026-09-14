/**
 * Issue #3291 — rank-only proximity for a Host address field.
 *
 * Thin React seam over `resolveAddressSearchProximity` (brand point → draft
 * point → time-zone point → none). One behaviour the pure resolver cannot
 * give: every keystroke in the field clears the draft's picked coordinates, so
 * the "draft point" would vanish on the first letter and ranking would jump to
 * the time-zone point mid-typing. The last usable draft point is therefore
 * remembered for the life of the field.
 *
 * No React Query, auth or store reads here — hosts pass what they already hold,
 * so mounting this hook adds no provider requirement to any screen or test.
 */

import { useRef } from "react";

import {
  deviceTimeZone,
  geoPointFrom,
  isUsableGeoPoint,
  resolveAddressSearchProximity,
  type GeoPoint,
} from "../utils/addressSearchProximity";

export interface AddressSearchProximitySources {
  brandPoint?: GeoPoint | null;
  draftPoint?: GeoPoint | null;
  /** The draft's IANA zone. Absent/blank → the device's zone. */
  timeZone?: string | null;
}

export const useAddressSearchProximity = (
  sources: AddressSearchProximitySources,
): string | undefined => {
  const lastDraftPoint = useRef<GeoPoint | null>(null);
  if (isUsableGeoPoint(sources.draftPoint)) {
    lastDraftPoint.current = geoPointFrom(
      sources.draftPoint.lat,
      sources.draftPoint.lng,
    );
  }
  const zone =
    typeof sources.timeZone === "string" && sources.timeZone.trim().length > 0
      ? sources.timeZone
      : deviceTimeZone();
  return resolveAddressSearchProximity({
    brandPoint: sources.brandPoint,
    draftPoint: lastDraftPoint.current,
    timeZone: zone,
  });
};
