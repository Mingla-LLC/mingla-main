/**
 * #4334 — the event pin rules, in a leaf module with no store imports so
 * liveEventAdapter and serverDraftEventMapper can share them without a
 * require cycle (draftEventStore → liveEventStore → liveEventAdapter).
 */

export type LatLng = { lat: number; lng: number };

export type LocationPin = {
  locationGeo?: LatLng | null;
  locationProviderPlaceId?: string | null;
  coordinatePrecision?: unknown;
};

/** "exact" | "approximate", or null for anything else. */
export const asCoordinatePrecision = (
  value: unknown,
): "exact" | "approximate" | null =>
  value === "exact" || value === "approximate" ? value : null;

/**
 * The Google place id that belongs to the pin: null when there is no pin (an
 * id never outlives its coordinate) or nothing was picked.
 */
export const draftLocationPlaceId = (draft: {
  locationGeo: LatLng | null;
  locationProviderPlaceId?: string | null;
}): string | null =>
  draft.locationGeo === null ||
  typeof draft.locationProviderPlaceId !== "string" ||
  draft.locationProviderPlaceId.trim().length === 0
    ? null
    : draft.locationProviderPlaceId.trim();

/**
 * Did the host change the event's pin? A pin is its coordinates AND the place
 * they belong to: re-picking a suggestion whose text and coordinates match the
 * saved ones can still bring a new Google place id or a new precision (a typed
 * "approximate" address corrected to the exact place). Comparing the
 * coordinates alone treated that re-pick as "no change", so Save stayed
 * disabled and the place id never reached the server.
 *
 * The loaded event may not carry its place id or precision (undefined reads
 * as "none"); the editor seeds the same `null`, so an untouched pin is never a
 * change, and a pick, which always brings a place id, always is.
 */
export const locationPinChanged = (
  original: LocationPin,
  edited: LocationPin,
): boolean => {
  const before = original.locationGeo ?? null;
  const after = edited.locationGeo ?? null;
  if (before === null || after === null) return before !== after;
  if (before.lat !== after.lat || before.lng !== after.lng) return true;
  return (
    draftLocationPlaceId({
      locationGeo: before,
      locationProviderPlaceId: original.locationProviderPlaceId,
    }) !==
      draftLocationPlaceId({
        locationGeo: after,
        locationProviderPlaceId: edited.locationProviderPlaceId,
      }) ||
    asCoordinatePrecision(original.coordinatePrecision) !==
      asCoordinatePrecision(edited.coordinatePrecision)
  );
};
