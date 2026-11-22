// #4490 Explorer W6b: venue-type chips on the deck ("Places on Mingla").
//
// A chip named `venue_type:<key>` serves only bookable hosted venues of that type
// (issue_4490_hosted_places_by_venue_type*). These chips are split out of the raw
// category list BEFORE resolveCategories runs, which would otherwise drop them
// (spec 06 F18). With VENUE_DISCOVER off the split returns nothing, so the strings
// fall into resolveCategories and are dropped exactly like any unknown chip.
//
// The labels mirror packages/brand-rendering/venueTypeLabels.ts (the edge cannot
// import the app packages); _shared/__tests__/issue_4490_venue_type_parity.test.ts
// pins both lists to the SQL CHECK.

export const VENUE_TYPE_CHIP_PREFIX = 'venue_type:';
export const VENUE_DISCOVER = 'VENUE_DISCOVER';

export const VENUE_TYPE_CHIPS: Readonly<Record<string, { venueType: string; displayCategory: string }>> = {
  'venue_type:restaurant': { venueType: 'restaurant', displayCategory: 'Restaurant' },
  'venue_type:bar_lounge': { venueType: 'bar_lounge', displayCategory: 'Bar and lounge' },
  'venue_type:club': { venueType: 'club', displayCategory: 'Club' },
  'venue_type:cafe': { venueType: 'cafe', displayCategory: 'Cafe' },
  'venue_type:play': { venueType: 'play', displayCategory: 'Play and games' },
  'venue_type:coworking': { venueType: 'coworking', displayCategory: 'Coworking' },
  'venue_type:event_space': { venueType: 'event_space', displayCategory: 'Event space' },
  'venue_type:creative_and_arts': { venueType: 'creative_and_arts', displayCategory: 'Creative and arts' },
};

export function isVenueTypeChip(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VENUE_TYPE_CHIPS, value);
}

/** Any string shaped like a venue-type chip (known or not): only these trigger a switch read. */
export function looksLikeVenueTypeChip(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(VENUE_TYPE_CHIP_PREFIX);
}

/**
 * Splits known venue-type chips (deduped, in the order given) from the rest.
 * Disabled: nothing is split and the raw list is returned untouched.
 */
export function splitVenueTypeChips<T>(raw: readonly T[], enabled: boolean): { venueChips: string[]; rest: T[] } {
  if (!enabled) return { venueChips: [], rest: raw as T[] };
  const venueChips: string[] = [];
  const rest: T[] = [];
  for (const item of raw) {
    if (isVenueTypeChip(item)) {
      if (!venueChips.includes(item)) venueChips.push(item);
    } else {
      rest.push(item);
    }
  }
  return { venueChips, rest };
}

/** The deck radius in metres for a travel limit (one owner: the solo deck and the chip source). */
export function deckRadiusMeters(maxDistKm: number): number {
  return Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 100000);
}
