/**
 * #4490 — React Query keys for venue features, spaces and special days.
 *
 * Keyless module (the `venueReservationSettingsKeys.ts` pattern): a lazy chunk
 * that only needs a key must not pull in the hooks' fetchers, or Metro hoists
 * the hook module into the eager `__common` bundle. brandId-first, so a brand
 * prefix invalidation reaches every venue of the brand.
 */

export const venueFeatureKeys = {
  all: (brandId: string): readonly string[] => ["venueFeatures", brandId] as const,
  features: (brandId: string, venueId: string): readonly string[] =>
    ["venueFeatures", brandId, venueId] as const,
  spaces: (brandId: string, venueId: string): readonly string[] =>
    ["venueSpaces", brandId, venueId] as const,
  spaceCombinations: (brandId: string, venueId: string): readonly string[] =>
    ["venueSpaceCombinations", brandId, venueId] as const,
  specialDays: (brandId: string, venueId: string): readonly string[] =>
    ["venueSpecialDays", brandId, venueId] as const,
  eventVenue: (eventId: string): readonly string[] => ["eventVenueLink", eventId] as const,
};
