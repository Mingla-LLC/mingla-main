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
  // #4490 P2 — offers, day limits, the venue's day and the door list.
  offers: (brandId: string, venueId: string): readonly string[] =>
    ["venueOffers", brandId, venueId] as const,
  capacityOverrides: (brandId: string, venueId: string): readonly string[] =>
    ["venueCapacityOverrides", brandId, venueId] as const,
  /** Prefix for every day of a venue (invalidate after a sale or a check-in). */
  dayAll: (brandId: string, venueId: string): readonly string[] => ["venueDay", brandId, venueId] as const,
  day: (brandId: string, venueId: string, localDate: string): readonly string[] =>
    ["venueDay", brandId, venueId, localDate] as const,
  checkInsAll: (brandId: string, venueId: string): readonly string[] =>
    ["venueCheckIns", brandId, venueId] as const,
  checkIns: (brandId: string, venueId: string, localDate: string): readonly string[] =>
    ["venueCheckIns", brandId, venueId, localDate] as const,
  // #4490 P3 — one booking with its money, and what closing a day touches.
  booking: (brandId: string, venueId: string, groupId: string): readonly string[] =>
    ["venueBooking", brandId, venueId, groupId] as const,
  dayClosureAll: (brandId: string, venueId: string): readonly string[] =>
    ["venueDayClosure", brandId, venueId] as const,
  dayClosure: (brandId: string, venueId: string, localDate: string): readonly string[] =>
    ["venueDayClosure", brandId, venueId, localDate] as const,
};
