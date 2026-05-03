// ORCH-0700 Phase 3B (2026-05-03) — TS twin of pg_map_primary_type_to_mingla_category.
//
// Aligned with the canonical 10-slug taxonomy in DISPLAY_TO_SLUG
// (supabase/functions/_shared/categoryPlaceTypes.ts:473-484), NOT with any
// helper-only invented taxonomy. The SQL helper at
// supabase/migrations/20260503000007_orch_0700_helper_canonical_taxonomy_fix.sql
// mirrors this same canonical taxonomy.
//
// Returns the Mingla canonical category slug for a Google primary_type + types[]
// array, or null when no match (Constitution #9 — never fabricate).
//
// "First-write-wins": a type is claimed by the first category whose place-type
// list contains it (matching SQL CASE chain order).
//
// Used by admin edge functions to derive category client-side.
//
// WARNING: keep this file in sync with the SQL helper AND DISPLAY_TO_SLUG.
// Three layers must agree. Backed by:
//   - SQL self-verify probes in the helper migration
//   - TS unit test in __tests__/derivePoolCategory_canonical.test.ts (enforces
//     I-CATEGORY-SLUG-CANONICAL: every output ∈ Object.values(DISPLAY_TO_SLUG))
//   - Matview post-refresh probe

const NATURE = new Set<string>([
  "beach", "botanical_garden", "garden", "hiking_area", "national_park",
  "nature_preserve", "park", "scenic_spot", "state_park", "observation_deck",
  "tourist_attraction", "picnic_ground", "vineyard", "wildlife_park", "wildlife_refuge",
  "woods", "mountain_peak", "river", "island", "city_park", "fountain", "lake", "marina",
]);

const ICEBREAKERS = new Set<string>([
  "cafe", "bowling_alley", "coffee_shop", "miniature_golf_course", "art_gallery",
  "tea_house", "video_arcade", "museum", "book_store", "amusement_center",
  "bakery", "go_karting_venue", "cultural_center", "dessert_shop", "karaoke",
  "plaza", "ice_cream_shop", "comedy_club", "art_museum", "juice_shop",
  "paintball_center", "donut_shop", "dance_hall", "breakfast_restaurant", "brunch_restaurant",
]);

const DRINKS_AND_MUSIC = new Set<string>([
  "bar", "cocktail_bar", "wine_bar", "brewery", "pub", "beer_garden", "brewpub",
  "lounge_bar", "night_club", "live_music_venue", "coffee_roastery", "coffee_stand",
]);

// Movies & Theatre (combined canonical slug — was split as 'movies' + 'theatre' in helper-only taxonomy)
const MOVIES_THEATRE = new Set<string>([
  "movie_theater", "drive_in",
  "performing_arts_theater", "opera_house", "auditorium", "amphitheatre", "concert_hall",
]);

// Brunch, Lunch & Casual (combined canonical slug — was split as 'brunch' + 'casual_food' in helper-only taxonomy)
const BRUNCH_LUNCH_CASUAL = new Set<string>([
  "american_restaurant", "bistro", "gastropub", "diner",
  "mexican_restaurant", "thai_restaurant", "pizza_restaurant", "sandwich_shop",
  "mediterranean_restaurant", "indian_restaurant", "chinese_restaurant",
  "vietnamese_restaurant", "korean_restaurant", "japanese_restaurant",
  "lebanese_restaurant", "greek_restaurant", "italian_restaurant",
  "ramen_restaurant", "noodle_shop", "hamburger_restaurant", "deli",
  "barbecue_restaurant", "seafood_restaurant", "vegan_restaurant",
  "vegetarian_restaurant", "turkish_restaurant", "spanish_restaurant",
  "french_restaurant", "sushi_restaurant", "buffet_restaurant", "food_court",
  "afghani_restaurant", "african_restaurant", "asian_restaurant",
  "brazilian_restaurant", "indonesian_restaurant", "middle_eastern_restaurant",
  "hot_pot_restaurant", "dim_sum_restaurant", "argentinian_restaurant",
  "basque_restaurant", "persian_restaurant", "scandinavian_restaurant",
  "filipino_restaurant", "soul_food_restaurant", "cuban_restaurant",
  "hawaiian_restaurant", "ethiopian_restaurant", "moroccan_restaurant",
  "peruvian_restaurant", "cajun_restaurant", "fusion_restaurant",
  "korean_barbecue_restaurant", "tapas_restaurant",
]);

const UPSCALE_FINE_DINING = new Set<string>([
  "fine_dining_restaurant", "steak_house", "oyster_bar_restaurant",
  "fondue_restaurant", "swiss_restaurant", "european_restaurant",
  "australian_restaurant", "british_restaurant",
]);

const CREATIVE_ARTS = new Set<string>([
  "art_studio", "history_museum", "sculpture", "cultural_landmark",
]);

const PLAY = new Set<string>([
  "amusement_park", "roller_coaster", "water_park", "ferris_wheel",
  "casino", "planetarium", "golf_course", "indoor_golf_course",
  "adventure_sports_center", "ice_skating_rink",
]);

// Groceries (separate canonical slug — was absorbed into 'flowers' in helper-only taxonomy)
const GROCERIES = new Set<string>(["grocery_store", "supermarket"]);

// Flowers (florist ONLY — grocery types now route to GROCERIES)
const FLOWERS = new Set<string>(["florist"]);

// Iteration order MUST match the SQL CASE chain — first-match-wins.
// CRITICAL: GROCERIES must come BEFORE FLOWERS so grocery_store/supermarket
// route to 'groceries', not 'flowers'.
const ORDERED_BUCKETS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["nature", NATURE],
  ["icebreakers", ICEBREAKERS],
  ["drinks_and_music", DRINKS_AND_MUSIC],
  ["movies_theatre", MOVIES_THEATRE],
  ["brunch_lunch_casual", BRUNCH_LUNCH_CASUAL],
  ["upscale_fine_dining", UPSCALE_FINE_DINING],
  ["creative_arts", CREATIVE_ARTS],
  ["play", PLAY],
  ["groceries", GROCERIES],
  ["flowers", FLOWERS],
];

function lookupOne(t: string): string | null {
  for (const [slug, bucket] of ORDERED_BUCKETS) {
    if (bucket.has(t)) return slug;
  }
  return null;
}

/**
 * Returns the Mingla canonical category slug for a place's primary_type + types[].
 * Mirrors public.pg_map_primary_type_to_mingla_category(text, text[]).
 * Output is always within the canonical 10-slug set defined by DISPLAY_TO_SLUG
 * in categoryPlaceTypes.ts, or null.
 *
 * @param primaryType Google's primary_type (may be null)
 * @param types       Google's full types[] array (may be null/empty)
 * @returns slug like "nature" / "brunch_lunch_casual" / "movies_theatre", or null when no match
 */
export function derivePoolCategory(
  primaryType: string | null | undefined,
  types: ReadonlyArray<string> | null | undefined,
): string | null {
  if (primaryType) {
    const fromPrimary = lookupOne(primaryType);
    if (fromPrimary !== null) return fromPrimary;
  }
  if (types && types.length > 0) {
    for (const t of types) {
      const fromType = lookupOne(t);
      if (fromType !== null) return fromType;
    }
  }
  return null;
}

/**
 * Inverse lookup: given a Mingla canonical category slug, return the Google
 * place_types that derive to that slug. Used by admin-refresh-places to filter
 * place_pool rows by category.
 *
 * Returns empty array for unknown slugs.
 */
export function googleTypesForCategory(categorySlug: string): string[] {
  for (const [slug, bucket] of ORDERED_BUCKETS) {
    if (slug === categorySlug) return Array.from(bucket);
  }
  return [];
}

/** All Mingla canonical category slugs the helper can return (excluding null). */
export const ALL_DERIVED_CATEGORY_SLUGS: ReadonlyArray<string> =
  ORDERED_BUCKETS.map(([slug]) => slug);
