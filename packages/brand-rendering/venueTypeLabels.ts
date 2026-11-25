/**
 * #4490 Explorer W6 — the venue type labels, one owner for Host and the Explorer
 * (`venue_listings.venue_category`, CHECK in 20281203004490). Host's
 * `VENUE_TYPES` reads its labels from here, so Discover's "Type of place" chips,
 * the deck's "Places on Mingla" chips and Host say the same words.
 *
 * `VENUE_TYPE_CHIP_KEYS` are the types that are filter chips, in chip order
 * (every type except Stay, which has its own Discover kind). They mirror
 * `public.issue_4490_venue_type_chip_keys()` and the Discover edge's
 * `VENUE_TYPE_CHIP_KEYS`; `_shared/__tests__/issue_4490_venue_type_parity.test.ts`
 * pins all four lists to the SQL CHECK.
 */
export type VenueTypeLabelKey =
  | "restaurant"
  | "play"
  | "creative_and_arts"
  | "stay"
  | "bar_lounge"
  | "club"
  | "cafe"
  | "event_space"
  | "coworking";

export const VENUE_TYPE_LABELS: Readonly<Record<VenueTypeLabelKey, string>> = {
  restaurant: "Restaurant",
  play: "Play and games",
  bar_lounge: "Bar and lounge",
  club: "Club",
  cafe: "Cafe",
  coworking: "Coworking",
  event_space: "Event space",
  creative_and_arts: "Creative and arts",
  stay: "Stay",
};

export type VenueTypeChipKey = Exclude<VenueTypeLabelKey, "stay">;

export const VENUE_TYPE_CHIP_KEYS: readonly VenueTypeChipKey[] = [
  "restaurant",
  "bar_lounge",
  "club",
  "cafe",
  "play",
  "coworking",
  "event_space",
  "creative_and_arts",
];

export function isVenueTypeChipKey(value: unknown): value is VenueTypeChipKey {
  return typeof value === "string" && (VENUE_TYPE_CHIP_KEYS as readonly string[]).includes(value);
}

/** The label for a type key, or null for anything that is not a venue type. */
export function venueTypeLabel(value: unknown): string | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(VENUE_TYPE_LABELS, value)
    ? VENUE_TYPE_LABELS[value as VenueTypeLabelKey]
    : null;
}
