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
  /** #4490 N20: switches the add-venue Features step asked for that the server refused. */
  startRefused: (venueId: string): readonly string[] => ["venueStartRefused", venueId] as const,
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
  guestListsAll: (brandId: string, venueId: string): readonly string[] =>
    ["venueGuestLists", brandId, venueId] as const,
  guestList: (brandId: string, venueId: string, localDate: string): readonly string[] =>
    ["venueGuestLists", brandId, venueId, localDate] as const,
  // #4490 P3 — one booking with its money, and what closing a day touches.
  booking: (brandId: string, venueId: string, groupId: string): readonly string[] =>
    ["venueBooking", brandId, venueId, groupId] as const,
  dayClosureAll: (brandId: string, venueId: string): readonly string[] =>
    ["venueDayClosure", brandId, venueId] as const,
  dayClosure: (brandId: string, venueId: string, localDate: string): readonly string[] =>
    ["venueDayClosure", brandId, venueId, localDate] as const,
  // #4490 P4 — requests, the calendar and next free dates (private hire).
  requestsAll: (brandId: string, venueId: string): readonly string[] =>
    ["venueRequests", brandId, venueId] as const,
  requests: (brandId: string, venueId: string, filter: string): readonly string[] =>
    ["venueRequests", brandId, venueId, filter] as const,
  calendarAll: (brandId: string, venueId: string): readonly string[] =>
    ["venueCalendar", brandId, venueId] as const,
  calendar: (brandId: string, venueId: string, from: string, to: string): readonly string[] =>
    ["venueCalendar", brandId, venueId, from, to] as const,
  nextFreeDates: (brandId: string, venueId: string, optionId: string, from: string): readonly string[] =>
    ["venueNextFreeDates", brandId, venueId, optionId, from] as const,
  // #4490 P5 — tables in spaces and the floor plan (`at` = the floor's moment, "" = now).
  floorAll: (brandId: string, venueId: string): readonly string[] => ["venueFloor", brandId, venueId] as const,
  floor: (brandId: string, venueId: string, at: string): readonly string[] =>
    ["venueFloor", brandId, venueId, at] as const,
  tableSuggestions: (brandId: string, venueId: string, reservationId: string): readonly string[] =>
    ["venueTableSuggestions", brandId, venueId, reservationId] as const,
  // #4490 P6 — memberships: plans, the members list (by server filter) and one member.
  membershipPlans: (brandId: string, venueId: string): readonly string[] =>
    ["venueMembershipPlans", brandId, venueId] as const,
  membersAll: (brandId: string, venueId: string): readonly string[] => ["venueMembers", brandId, venueId] as const,
  members: (brandId: string, venueId: string, filter: string): readonly string[] =>
    ["venueMembers", brandId, venueId, filter] as const,
  memberAll: (brandId: string, venueId: string): readonly string[] => ["venueMember", brandId, venueId] as const,
  member: (brandId: string, venueId: string, subscriptionId: string): readonly string[] =>
    ["venueMember", brandId, venueId, subscriptionId] as const,
};
