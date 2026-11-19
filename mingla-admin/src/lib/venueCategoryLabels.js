// #4490 — one label map for the nine venue types (`venue_listings.venue_category`).
// Every Admin screen that shows a category reads it from here so a new type never
// shows its raw key ("bar_lounge") again.
export const VENUE_CATEGORY_LABELS = Object.freeze({
  restaurant: "Restaurant",
  play: "Play and games",
  creative_and_arts: "Creative and arts",
  stay: "Stay",
  bar_lounge: "Bar and lounge",
  club: "Club",
  cafe: "Cafe",
  event_space: "Event space",
  coworking: "Coworking",
});

/** Plain label for a category key; unknown keys become readable words, never raw snake_case. */
export function venueCategoryLabel(key) {
  if (key === null || key === undefined || key === "") return "—";
  const known = VENUE_CATEGORY_LABELS[key];
  if (known !== undefined) return known;
  const words = String(key).replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `{ value, label }` options for a filter, in a stable order. */
export const VENUE_CATEGORY_FILTER_OPTIONS = Object.freeze(
  Object.entries(VENUE_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
);
