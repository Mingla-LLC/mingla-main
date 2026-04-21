/**
 * Category Name Registry + On-Demand Experience Type Mappings
 *
 * Two responsibilities:
 *   1. CATEGORY NAMES: resolveCategory(), toSlug(), ALL_CATEGORY_NAMES, etc.
 *      Used by most edge functions for category string normalization.
 *   2. ON-DEMAND TYPE LISTS: MINGLA_CATEGORY_PLACE_TYPES, used by
 *      holiday-experiences, new-generate-experience-, warm-cache for
 *      Google Places API fallback when pool coverage is thin.
 *      Both are pool-first — they only hit Google as a fallback.
 *
 * 10 categories: 8 visible + 2 hidden (Groceries, Flowers).
 *
 * NOTE: The type lists here are for on-demand experience generation.
 * For admin seeding type lists (Google → place_pool), see seedingCategories.ts.
 * These are separate systems that serve different pipeline steps.
 *
 * ORCH-0434: Restructured from 13 to 10 categories.
 *   Merged: nature + picnic_park → Nature & Views
 *   Merged: watch + live_performance → Movies & Theatre
 *   Renamed: First Meet → Icebreakers, Drink → Drinks & Music,
 *            Casual Eats → Brunch Lunch & Casual, Fine Dining → Upscale & Fine Dining
 *   Removed: Wellness
 *   Hidden: Flowers (was visible, now backend-only like Groceries)
 */

// ── Primary mapping: Display Name → Google Place types ──────────────────────
export const MINGLA_CATEGORY_PLACE_TYPES: Record<string, string[]> = {
  'Nature & Views': [
    'beach', 'botanical_garden', 'garden', 'hiking_area', 'national_park',
    'nature_preserve', 'park', 'scenic_spot', 'state_park', 'observation_deck',
    'tourist_attraction',
    'picnic_ground', // absorbed from former Picnic Park category
    // ORCH-0460: sync with seedingCategories.ts — these are seeded but were missing
    // from on-demand search, making them invisible to experience generation.
    'vineyard', 'wildlife_park', 'wildlife_refuge', 'woods', 'mountain_peak',
    'river', 'island', 'city_park', 'fountain', 'lake', 'marina',
  ],
  'Icebreakers': [
    // Interleaved: Group1 (café), Group2 (activity), Group3 (culture/outdoor)
    'cafe', 'bowling_alley', 'park',
    'coffee_shop', 'miniature_golf_course', 'art_gallery',
    'tea_house', 'video_arcade', 'museum',
    'book_store', 'amusement_center', 'botanical_garden',
    'bakery', 'go_karting_venue', 'cultural_center',
    'dessert_shop', 'karaoke', 'plaza',
    'ice_cream_shop', 'comedy_club', 'tourist_attraction',
    'juice_shop', 'paintball_center', 'art_museum',
    'donut_shop', 'dance_hall', 'garden',
    'breakfast_restaurant', 'brunch_restaurant',
  ],
  'Drinks & Music': [
    // Interleaved: Group1 (alcohol), Group2 (non-alcohol)
    'bar',             'coffee_shop',
    'cocktail_bar',    'coffee_roastery',
    'wine_bar',        'coffee_stand',
    'brewery',         'tea_house',
    'pub',             'juice_shop',
    'beer_garden',
    'brewpub',
    'lounge_bar',
    'night_club',
    'live_music_venue', // ORCH-0434: added for Drinks & Music
    'karaoke',          // ORCH-0434: added for Drinks & Music
  ],
  // ORCH-0597 (Slice 5): split "Brunch, Lunch & Casual" into two separate canonical
  // categories. Old display name retained as [TRANSITIONAL] alias (below) for pre-OTA
  // clients during the 14-day soak window ending 2026-05-12.
  'Brunch': [
    'brunch_restaurant', 'breakfast_restaurant', 'cafe',
    'american_restaurant', 'bistro', 'gastropub',
    'bakery', 'diner',
  ],
  'Casual': [
    'mexican_restaurant', 'thai_restaurant', 'pizza_restaurant', 'sandwich_shop',
    'mediterranean_restaurant', 'indian_restaurant', 'chinese_restaurant',
    'vietnamese_restaurant', 'korean_restaurant', 'japanese_restaurant',
    'lebanese_restaurant', 'greek_restaurant', 'italian_restaurant',
    'ramen_restaurant', 'noodle_shop', 'hamburger_restaurant',
    'deli', 'bakery', 'cafe', 'diner', 'american_restaurant', 'barbecue_restaurant',
    'seafood_restaurant', 'vegan_restaurant', 'vegetarian_restaurant',
    'turkish_restaurant', 'spanish_restaurant', 'french_restaurant',
    'sushi_restaurant', 'buffet_restaurant', 'food_court',
    'afghani_restaurant', 'african_restaurant', 'asian_restaurant',
    'barbecue_restaurant', 'brazilian_restaurant', 'indonesian_restaurant',
    'middle_eastern_restaurant', 'hot_pot_restaurant', 'dim_sum_restaurant',
    'argentinian_restaurant', 'basque_restaurant', 'persian_restaurant',
    'scandinavian_restaurant', 'filipino_restaurant', 'soul_food_restaurant',
    'cuban_restaurant', 'hawaiian_restaurant', 'ethiopian_restaurant',
    'moroccan_restaurant', 'peruvian_restaurant', 'cajun_restaurant',
    'fusion_restaurant', 'korean_barbecue_restaurant', 'tapas_restaurant',
  ],
  // [TRANSITIONAL] — pre-ORCH-0597 clients still send this bundled display name.
  // Union of Brunch + Casual types. Remove after 2026-05-12.
  'Brunch, Lunch & Casual': [
    'restaurant', 'hamburger_restaurant', 'pizza_restaurant',
    'ramen_restaurant', 'sandwich_shop', 'sushi_restaurant', 'diner',
    'brunch_restaurant', 'buffet_restaurant', 'breakfast_restaurant',
    'american_restaurant', 'asian_restaurant', 'barbecue_restaurant',
    'brazilian_restaurant', 'chinese_restaurant', 'indian_restaurant',
    'indonesian_restaurant', 'japanese_restaurant', 'korean_restaurant',
    'lebanese_restaurant', 'mediterranean_restaurant', 'mexican_restaurant',
    'middle_eastern_restaurant', 'seafood_restaurant', 'spanish_restaurant',
    'thai_restaurant', 'turkish_restaurant', 'vegan_restaurant',
    'vegetarian_restaurant', 'vietnamese_restaurant', 'italian_restaurant',
    'steak_house', 'french_restaurant', 'greek_restaurant',
    'afghani_restaurant', 'african_restaurant',
    // ORCH-0460: real restaurants only — removed 'fast_food_restaurant'. Added
    // world cuisines + core casual types that were previously missing from on-demand.
    'bistro', 'gastropub', 'noodle_shop', 'hot_pot_restaurant', 'dim_sum_restaurant',
    'argentinian_restaurant', 'basque_restaurant', 'persian_restaurant',
    'scandinavian_restaurant', 'filipino_restaurant', 'soul_food_restaurant',
    'cuban_restaurant', 'hawaiian_restaurant', 'ethiopian_restaurant',
    'moroccan_restaurant', 'peruvian_restaurant', 'cajun_restaurant',
    'fusion_restaurant', 'korean_barbecue_restaurant', 'tapas_restaurant',
  ],
  'Upscale & Fine Dining': [
    'fine_dining_restaurant', 'french_restaurant', 'steak_house',
    'seafood_restaurant', 'mediterranean_restaurant', 'spanish_restaurant',
    'tapas_restaurant', 'oyster_bar_restaurant', 'italian_restaurant',
    'japanese_restaurant', 'greek_restaurant',
    // ORCH-0460: sync with expanded fine_dining seeding. High-end versions of
    // these cuisines exist and should be surfaceable in on-demand experiences.
    'fondue_restaurant', 'persian_restaurant', 'scandinavian_restaurant',
    'basque_restaurant', 'argentinian_restaurant', 'swiss_restaurant',
    'european_restaurant', 'australian_restaurant', 'british_restaurant',
    'indian_restaurant', 'korean_restaurant', 'thai_restaurant',
    'turkish_restaurant', 'vietnamese_restaurant', 'brazilian_restaurant',
    'peruvian_restaurant', 'moroccan_restaurant', 'fusion_restaurant',
    'gastropub', 'bistro',
  ],
  'Movies & Theatre': [
    // Merged: Watch + Live Performance
    'movie_theater',
    'performing_arts_theater', 'concert_hall', 'opera_house',
    'philharmonic_hall', 'amphitheatre',
  ],
  'Creative & Arts': [
    'art_gallery', 'art_museum', 'art_studio', 'museum', 'history_museum',
    'sculpture', 'cultural_center', 'cultural_landmark',
    'performing_arts_theater', 'opera_house', 'auditorium',
    'amphitheatre', 'comedy_club', 'live_music_venue',
  ],
  'Play': [
    'amusement_center', 'amusement_park', 'bowling_alley', 'miniature_golf_course',
    'go_karting_venue', 'paintball_center', 'video_arcade',
    'karaoke', 'dance_hall', 'ice_skating_rink',
    'roller_coaster', 'water_park', 'ferris_wheel',
    'casino', 'planetarium',
    // ORCH-0460: removed indoor_playground (almost always kids), skateboard_park
    // and cycling_park (sports/fitness, not adult date activities). Added golf.
    'golf_course', 'indoor_golf_course', 'adventure_sports_center',
  ],
  'Flowers': [
    'florist', 'grocery_store', 'supermarket',
  ],
  'Groceries': [
    'grocery_store', 'supermarket',
  ],
};

/**
 * Place types that must NEVER appear in any card, stop, or recommendation.
 * Applied as `excludedTypes` in every Google Places API call AND as a
 * post-fetch filter on results.
 */
export const GLOBAL_EXCLUDED_PLACE_TYPES: string[] = [
  'gym',
  'fitness_center',
  'dog_park',
  // Schools/educational — never appropriate for dating/experiences
  'school',
  'primary_school',
  'secondary_school',
  'university',
  'preschool',
];

// Per-intent exclusion lists REMOVED — all exclusions are now global-only.
// Category-specific exclusions live in seedingCategories.ts (excludedPrimaryTypes).

// ── Alias mapping: handles all case/format variations ────────────────────────
// Maps every known variation to the canonical display name above.
// ORCH-0434: Old slugs kept as backward-compat aliases resolving to new display names.
const CATEGORY_ALIASES: Record<string, string> = {
  // ── New canonical slugs → display names ───────────────────────
  'nature': 'Nature & Views',
  'nature_views': 'Nature & Views',       // backward compat
  'nature-views': 'Nature & Views',
  'nature & views': 'Nature & Views',
  'nature_and_views': 'Nature & Views',
  'icebreakers': 'Icebreakers',
  'first_meet': 'Icebreakers',            // backward compat
  'first-meet': 'Icebreakers',
  'firstmeet': 'Icebreakers',
  'picnic_park': 'Nature & Views',        // merged into Nature
  'picnic-park': 'Nature & Views',
  'picnic park': 'Nature & Views',
  'picnic': 'Nature & Views',
  'drinks_and_music': 'Drinks & Music',
  'drinks-and-music': 'Drinks & Music',
  'drink': 'Drinks & Music',              // backward compat
  // ORCH-0597 (Slice 5): split chips — NEW canonical routing.
  'brunch': 'Brunch',
  'Brunch': 'Brunch',
  'casual_food': 'Casual',
  'casual-food': 'Casual',
  'casualfood': 'Casual',
  'casual food': 'Casual',
  'casual': 'Casual',
  'Casual': 'Casual',
  'casual_eats': 'Casual',   // ORCH-0597: legacy alias redirected to new Casual chip
  'casual-eats': 'Casual',
  'casualeats': 'Casual',
  'casual eats': 'Casual',
  // [TRANSITIONAL] legacy bundled chip slug + display name — resolves to
  // the old bundled canonical entry so that CATEGORY_TO_SIGNAL routes to the
  // backward-compat UNION (brunch + casual_food). Pre-OTA clients still send
  // these. Remove after 2026-05-12.
  'brunch_lunch_casual': 'Brunch, Lunch & Casual',
  'brunch-lunch-casual': 'Brunch, Lunch & Casual',
  'brunch, lunch & casual': 'Brunch, Lunch & Casual',
  'upscale_fine_dining': 'Upscale & Fine Dining',
  'upscale-fine-dining': 'Upscale & Fine Dining',
  'fine_dining': 'Upscale & Fine Dining',  // backward compat
  'fine-dining': 'Upscale & Fine Dining',
  'finedining': 'Upscale & Fine Dining',
  'fine dining': 'Upscale & Fine Dining',
  'movies_theatre': 'Movies & Theatre',
  'movies-theatre': 'Movies & Theatre',
  'watch': 'Movies & Theatre',             // backward compat
  'live_performance': 'Movies & Theatre',   // backward compat
  'live-performance': 'Movies & Theatre',
  'live performance': 'Movies & Theatre',
  'liveperformance': 'Movies & Theatre',
  'creative_arts': 'Creative & Arts',
  'creative-arts': 'Creative & Arts',
  'creativearts': 'Creative & Arts',
  'creative & arts': 'Creative & Arts',
  'play': 'Play',
  'wellness': 'Brunch, Lunch & Casual',    // removed → orphan fallback
  'flowers': 'Flowers',
  'groceries': 'Groceries',

  // ── Backward compat: old combined category ─────────────────────
  'groceries_flowers': 'Flowers',
  'groceries & flowers': 'Flowers',
  'groceries-flowers': 'Flowers',
  'groceriesflowers': 'Flowers',

  // ── Removed categories → best match ────────────────────────────
  'work_business': 'Icebreakers',
  'work-business': 'Icebreakers',
  'workbusiness': 'Icebreakers',
  'work & business': 'Icebreakers',
  'work and business': 'Icebreakers',
  'work_and_business': 'Icebreakers',

  // ── Old display names → new display names ─────────────────────
  'Nature': 'Nature & Views',
  'Picnic': 'Nature & Views',
  'Groceries & Flowers': 'Flowers',
  'Work & Business': 'Icebreakers',

  // ── Old category system (backwards compat) ─────────────────────
  'sip & chill': 'Drinks & Music',
  'sip_and_chill': 'Drinks & Music',
  'sip-and-chill': 'Drinks & Music',
  'sip&chill': 'Drinks & Music',
  'sip_&_chill': 'Drinks & Music',
  'sip-&-chill': 'Drinks & Music',
  'sipchill': 'Drinks & Music',
  'stroll': 'Nature & Views',
  'take a stroll': 'Nature & Views',
  'take-a-stroll': 'Nature & Views',
  'take_a_stroll': 'Nature & Views',
  'dining experiences': 'Upscale & Fine Dining',
  'dining_experiences': 'Upscale & Fine Dining',
  'dining-experiences': 'Upscale & Fine Dining',
  'dining': 'Upscale & Fine Dining',
  'screen & relax': 'Movies & Theatre',
  'screen_and_relax': 'Movies & Theatre',
  'screen-and-relax': 'Movies & Theatre',
  'screen&relax': 'Movies & Theatre',
  'screenrelax': 'Movies & Theatre',
  'screen_&_relax': 'Movies & Theatre',
  'creative & hands-on': 'Creative & Arts',
  'creative_and_hands_on': 'Creative & Arts',
  'creative-and-hands-on': 'Creative & Arts',
  'creative&hands-on': 'Creative & Arts',
  'creativehandson': 'Creative & Arts',
  'play & move': 'Play',
  'play_and_move': 'Play',
  'play-and-move': 'Play',
  'play&move': 'Play',
  'playmove': 'Play',
  'play_&_move': 'Play',
  'picnics': 'Nature & Views',
  'wellness dates': 'Brunch, Lunch & Casual',
  'wellness_dates': 'Brunch, Lunch & Casual',
  'freestyle': 'Nature & Views',

  // Short forms used by legacy recommendation endpoints
  'sip': 'Drinks & Music',
  'play_move': 'Play',
  'screen_relax': 'Movies & Theatre',
  'creative': 'Creative & Arts',
};

/**
 * Resolve any category string (display name, slug, old name, any case)
 * to the canonical display name. Returns null if unrecognized.
 */
export function resolveCategory(input: string): string | null {
  // Direct match on display name
  if (MINGLA_CATEGORY_PLACE_TYPES[input]) return input;
  // Alias lookup (lowercase)
  const alias = CATEGORY_ALIASES[input.toLowerCase()];
  if (alias) return alias;
  // Also check exact-case aliases (for "Nature", "Picnic" etc.)
  const exactAlias = CATEGORY_ALIASES[input];
  if (exactAlias) return exactAlias;
  return null;
}

/**
 * Get Google Place types for a category string (any format).
 * Returns empty array if category is unrecognized.
 */
export function getPlaceTypesForCategory(category: string): string[] {
  const canonical = resolveCategory(category);
  if (!canonical) return [];
  return MINGLA_CATEGORY_PLACE_TYPES[canonical] || [];
}

/**
 * Resolve an array of user categories (mixed formats) to canonical display names.
 * Deduplicates and filters out unrecognized categories.
 */
export function resolveCategories(categories: string[]): string[] {
  const resolved = new Set<string>();
  for (const cat of categories) {
    const canonical = resolveCategory(cat);
    if (canonical) resolved.add(canonical);
  }
  return Array.from(resolved);
}

/**
 * Get all unique Google Place types for a set of categories.
 */
export function getAllPlaceTypes(categories: string[]): string[] {
  const types = new Set<string>();
  for (const cat of resolveCategories(categories)) {
    for (const type of MINGLA_CATEGORY_PLACE_TYPES[cat] || []) {
      types.add(type);
    }
  }
  return Array.from(types);
}

/**
 * Intent IDs — these are NOT place categories, they're experience types.
 * They should be filtered out before passing categories to place search.
 */
export const INTENT_IDS = new Set([
  'adventurous',
  'first-date',
  'romantic',
  'group-fun',
  'picnic-dates',
  'take-a-stroll',
]);

/**
 * Filter out intent IDs from a categories array, leaving only place categories.
 */
export function filterOutIntents(categories: string[]): string[] {
  return categories.filter(c => !INTENT_IDS.has(c));
}

// ── All canonical category display names ──────────────────────────────────────
export const ALL_CATEGORY_NAMES = Object.keys(MINGLA_CATEGORY_PLACE_TYPES);

// ── Display name ↔ DB slug mapping ────────────────────────────────────────
// card_pool.category stores slugs; edge functions use display names from
// MINGLA_CATEGORY_PLACE_TYPES keys. These maps bridge the gap.
// ORCH-0434: Rewritten — all slugs now match Phase 1 migrated database.
export const DISPLAY_TO_SLUG: Record<string, string> = {
  'Nature & Views': 'nature',
  'Icebreakers': 'icebreakers',
  'Drinks & Music': 'drinks_and_music',
  'Brunch, Lunch & Casual': 'brunch_lunch_casual',
  'Upscale & Fine Dining': 'upscale_fine_dining',
  'Movies & Theatre': 'movies_theatre',
  'Creative & Arts': 'creative_arts',
  'Play': 'play',
  'Flowers': 'flowers',
  'Groceries': 'groceries',
};

export const SLUG_TO_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.entries(DISPLAY_TO_SLUG).map(([display, slug]) => [slug, display])
);

/** Convert a display name to its DB slug. Falls back to input if unknown. */
export function toSlug(displayName: string): string {
  return DISPLAY_TO_SLUG[displayName] || displayName;
}

/** Convert a DB slug to its display name. Falls back to input if unknown. */
export function toDisplay(slug: string): string {
  return SLUG_TO_DISPLAY[slug] || slug;
}

/** Categories that exist in the system but are never shown to users */
export const HIDDEN_CATEGORIES: Set<string> = new Set(['Groceries', 'Flowers']);

/** Visible categories only — use for user-facing lists */
export const VISIBLE_CATEGORY_NAMES = ALL_CATEGORY_NAMES.filter(
  c => !HIDDEN_CATEGORIES.has(c)
);

// ── Per-category search strategy override ─────────────────────────────────────
// Categories listed here use Text Search instead of Nearby Search.
export const CATEGORY_TEXT_KEYWORDS: Partial<Record<string, string[]>> = {
  'Upscale & Fine Dining': [
    'fine dining restaurant',
    'upscale restaurant',
    'tasting menu restaurant',
  ],
};

/**
 * Returns text search keywords for a category, or null if it uses Nearby Search.
 */
export function getTextKeywords(category: string): string[] | null {
  const canonical = resolveCategory(category);
  if (!canonical) return null;
  return CATEGORY_TEXT_KEYWORDS[canonical] ?? null;
}

// ── Per-category excluded types ───────────────────────────────────────────────

// Common retail/store exclusion list shared across categories
const RETAIL_EXCLUSIONS = [
  'asian_grocery_store', 'auto_parts_store', 'bicycle_store',
  'building_materials_store', 'butcher_shop', 'cell_phone_store',
  'clothing_store', 'convenience_store', 'cosmetics_store',
  'department_store', 'discount_store', 'discount_supermarket',
  'electronics_store', 'farmers_market', 'flea_market',
  'food_store', 'furniture_store', 'garden_center',
  'general_store', 'gift_shop', 'hardware_store',
  'health_food_store', 'home_goods_store', 'home_improvement_store',
  'hypermarket', 'jewelry_store', 'liquor_store',
  'market', 'pet_store', 'shoe_store',
  'shopping_mall', 'sporting_goods_store', 'sportswear_store',
  'tea_store', 'thrift_store', 'toy_store',
  'warehouse_store', 'wholesaler', 'womens_clothing_store',
];

/**
 * Per-category excluded types — venues that are inappropriate
 * for a specific category context even if Google returns them.
 * Applied as post-fetch filter alongside GLOBAL_EXCLUDED_PLACE_TYPES.
 *
 * ORCH-0434: Merged Picnic Park into Nature & Views, Watch + Live Performance
 * into Movies & Theatre, removed Wellness.
 */
export const CATEGORY_EXCLUDED_PLACE_TYPES: Record<string, string[]> = {
  'Nature & Views': [
    // Original Nature exclusions
    'movie_theater', 'video_arcade', 'bowling_alley', 'casino',
    'night_club', 'karaoke', 'amusement_center', 'amusement_park',
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
    'store',
    // Merged from Picnic Park exclusions
    'dog_park', 'water_park',
    'bar',
    ...RETAIL_EXCLUSIONS,
  ],
  'Icebreakers': [
    'night_club', 'bar', 'cocktail_bar', 'lounge_bar', 'brewery', 'brewpub',
    'fine_dining_restaurant', 'french_restaurant', 'steak_house',
    'indoor_playground', 'water_park',
    ...RETAIL_EXCLUSIONS,
  ],
  'Drinks & Music': [
    'fine_dining_restaurant', 'spa', 'sauna', 'amusement_park', 'water_park',
    ...RETAIL_EXCLUSIONS,
  ],
  'Brunch, Lunch & Casual': [
    'fine_dining_restaurant', 'bar', 'night_club', 'spa',
    'grocery_store', 'supermarket',
    // ORCH-0460: restaurants only — exclude bars, play, sports, tobacco, farms
    'hookah_bar', 'sports_bar', 'irish_pub', 'brewery', 'brewpub', 'beer_garden',
    'pub', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'winery', 'bar_and_grill',
    'amusement_center', 'amusement_park', 'bowling_alley', 'video_arcade',
    'go_karting_venue', 'paintball_center', 'miniature_golf_course', 'karaoke',
    'casino', 'adventure_sports_center',
    'community_center', 'sports_complex', 'sports_club', 'athletic_field',
    'stadium', 'arena', 'swimming_pool',
    'food_court', 'cafeteria', 'tobacco_shop',
    'farm', 'ranch', 'campground',
    ...RETAIL_EXCLUSIONS,
  ],
  'Upscale & Fine Dining': [
    'fast_food_restaurant', 'food_court', 'bar', 'bowling_alley',
    'amusement_park', 'water_park', 'video_arcade', 'night_club',
    'hamburger_restaurant', 'pizza_restaurant', 'ramen_restaurant',
    'sandwich_shop', 'diner', 'buffet_restaurant', 'breakfast_restaurant',
    'brunch_restaurant', 'donut_shop', 'ice_cream_shop',
    'bistro', 'gastropub', 'pub', 'brewpub', 'beer_garden',
    'indoor_playground', 'amusement_center', 'playground',
    'children_store', 'child_care_agency', 'preschool',
    ...RETAIL_EXCLUSIONS,
  ],
  'Movies & Theatre': [
    // Merged: Watch + Live Performance exclusions (deduplicated)
    'store',
    'sports_complex', 'sports_club', 'stadium', 'race_course',
    'tennis_court', 'swimming_pool', 'skateboard_park',
    'grocery_store', 'supermarket',
    'gas_station', 'car_repair', 'car_wash',
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
    // ORCH-0460: dedicated performance venues only — no cafes/bars/restaurants
    'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
    'cafe', 'coffee_shop', 'tea_house', 'bakery',
    'bar', 'cocktail_bar', 'wine_bar', 'lounge_bar', 'pub', 'brewery', 'brewpub',
    'beer_garden', 'sports_bar', 'hookah_bar', 'irish_pub', 'night_club',
    'gastropub', 'bistro', 'diner',
    'convenience_store', 'hotel', 'motel', 'gym', 'fitness_center',
    // ORCH-0460 v2 (rework): sync on-demand exclusion list to pipeline
    // MOVIES_THEATRE_BLOCKED_TYPES set per invariant #13 (exclusion consistency).
    'brunch_restaurant', 'breakfast_restaurant', 'ice_cream_shop',
    'winery', 'bar_and_grill', 'amusement_center', 'bowling_alley', 'video_arcade',
    ...RETAIL_EXCLUSIONS,
  ],
  'Creative & Arts': [
    'fast_food_restaurant', 'food_court', 'bar', 'bowling_alley',
    'amusement_park', 'water_park', 'spa', 'sauna', 'night_club',
    'store',
    'sports_complex', 'sports_club',
    'stadium', 'race_course', 'tennis_court', 'swimming_pool',
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
    // ORCH-0460: a restaurant/bar/cafe in a historic building is NOT creative_arts
    'restaurant', 'fine_dining_restaurant', 'wine_bar', 'cafe', 'coffee_shop',
    'cocktail_bar', 'lounge_bar', 'pub', 'brewery', 'brewpub', 'beer_garden',
    'sports_bar', 'hookah_bar', 'irish_pub', 'convenience_store', 'grocery_store',
    'supermarket', 'hotel', 'motel', 'gas_station', 'bistro', 'diner',
    'brunch_restaurant', 'breakfast_restaurant',
    // ORCH-0460 v2 (rework): sync on-demand exclusion list to pipeline
    // CREATIVE_ARTS_BLOCKED_TYPES set per invariant #13 (exclusion consistency).
    'american_restaurant', 'asian_restaurant', 'barbecue_restaurant',
    'brazilian_restaurant', 'chinese_restaurant', 'french_restaurant',
    'german_restaurant', 'greek_restaurant', 'indian_restaurant',
    'italian_restaurant', 'japanese_restaurant', 'korean_restaurant',
    'mexican_restaurant', 'seafood_restaurant', 'spanish_restaurant',
    'thai_restaurant', 'turkish_restaurant', 'vietnamese_restaurant',
    'hamburger_restaurant', 'pizza_restaurant', 'ramen_restaurant',
    'sushi_restaurant', 'steak_house', 'buffet_restaurant', 'gastropub',
    'winery', 'bar_and_grill', 'tea_house', 'bakery', 'ice_cream_shop',
    'gym', 'fitness_center',
    ...RETAIL_EXCLUSIONS,
  ],
  'Play': [
    'store',
    'art_gallery', 'museum', 'cultural_center', 'art_museum', 'history_museum',
    'fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant',
    'sandwich_shop', 'food_court', 'buffet_restaurant',
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
    // ORCH-0460: no kids venues, sports complexes, farms, community centers
    'indoor_playground', 'playground', 'childrens_camp', 'sports_complex',
    'sports_club', 'athletic_field', 'swimming_pool', 'tennis_court',
    'sports_coaching', 'sports_school', 'farm', 'ranch', 'community_center',
    'dog_park', 'campground',
    ...RETAIL_EXCLUSIONS,
  ],
  'Flowers': [
    'fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant',
    'sandwich_shop', 'buffet_restaurant', 'food_court', 'diner', 'restaurant',
    'amusement_park', 'amusement_center', 'video_arcade', 'bowling_alley',
    'paintball_center', 'go_karting_venue', 'miniature_golf_course', 'skateboard_park',
    'movie_theater',
    'spa', 'massage_spa', 'massage', 'sauna', 'wellness_center',
    'hair_salon', 'beauty_salon',
    'gym', 'fitness_center', 'sports_complex', 'sports_club', 'stadium',
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
    'convenience_store', 'general_store',
  ],
  'Groceries': [
    'fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant',
    'sandwich_shop', 'buffet_restaurant', 'food_court', 'diner', 'restaurant',
    'amusement_park', 'amusement_center', 'video_arcade', 'bowling_alley',
    'paintball_center', 'go_karting_venue', 'miniature_golf_course', 'skateboard_park',
    'movie_theater',
    'spa', 'massage_spa', 'massage', 'sauna', 'wellness_center',
    'hair_salon', 'beauty_salon',
    'gym', 'fitness_center', 'sports_complex', 'sports_club', 'stadium',
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
    'convenience_store', 'general_store',
  ],
};

/**
 * Get the full exclusion set for a category: global + category-specific.
 * Use this in post-fetch filtering.
 */
export function getExcludedTypesForCategory(category: string): string[] {
  const canonical = resolveCategory(category);
  const categoryExcluded = canonical ? (CATEGORY_EXCLUDED_PLACE_TYPES[canonical] || []) : [];
  return [...GLOBAL_EXCLUDED_PLACE_TYPES, ...categoryExcluded];
}

/**
 * Extended exclusion set for discovery/browse contexts where
 * utility businesses should never appear.
 * NOTE: Does NOT include grocery_store or supermarket — those are valid
 * for the Flowers and Groceries categories.
 */
export const DISCOVER_EXCLUDED_PLACE_TYPES: string[] = [
  ...GLOBAL_EXCLUDED_PLACE_TYPES,
  'gas_station', 'atm', 'bank', 'hospital', 'pharmacy', 'dentist', 'doctor',
  'funeral_home', 'cemetery', 'car_repair', 'car_wash', 'car_dealer',
  'convenience_store', 'laundry', 'locksmith', 'post_office', 'storage',
  'moving_company', 'insurance_agency', 'real_estate_agency', 'travel_agency',
  'parking', 'government_office', 'police', 'fire_station', 'courthouse',
  'city_hall', 'apartment_building', 'plumber', 'electrician', 'roofing_contractor',
];

/**
 * Build a category → place types map for a set of categories.
 * Used by batchSearchByCategory() to send one Google API call per category
 * instead of one per type.
 */
export function getCategoryTypeMap(categories: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const cat of resolveCategories(categories)) {
    result[cat] = MINGLA_CATEGORY_PLACE_TYPES[cat] || [];
  }
  return result;
}

// ── Excluded venue name-based heuristic ────────────────────────────────────
// These keywords in a place name indicate a venue inappropriate for Mingla.
// Two groups: children's venues + educational institutions.
// Applied as a post-fetch filter in card generators.
export const EXCLUDED_VENUE_NAME_KEYWORDS: string[] = [
  // Children's venues
  'kids', 'kidz', 'kiddo', 'kiddos',
  'children', 'child',
  'toddler', 'toddlers',
  'baby', 'babies',
  'bounce', 'bouncy',
  'trampoline',
  'play space', 'playspace',
  'little ones',
  'mommy', 'mommy and me',
  'tot ', ' tots',      // space-delimited to avoid "total", "tottori"
  'preschool', 'pre-school',
  'daycare', 'day care',
  'jungle gym',
  'fun zone', 'funzone',
  'kidzone', 'kid zone',
  // ORCH-0460: sync with ai-verify-pipeline EXCLUSION_KEYWORDS.kids list —
  // these patterns were only caught by AI validation, not by the on-demand filter.
  'indoor playground', 'chuck e. cheese', 'enfants', 'kinder',
  'bambini', 'infantil', 'splash pad', 'soft play',
  // Educational institutions
  'school', 'academy', 'institute',
  'training center', 'learning center',
  'university', 'college', 'seminary',
];

// Backward-compatible alias
export const CHILD_VENUE_NAME_KEYWORDS = EXCLUDED_VENUE_NAME_KEYWORDS;

/**
 * Returns true if the place name contains excluded keywords
 * (children's venues, schools, educational institutions).
 * Case-insensitive.
 */
export function isExcludedVenueName(placeName: string): boolean {
  const lower = ` ${placeName.toLowerCase()} `; // pad with spaces for word-boundary keywords
  return EXCLUDED_VENUE_NAME_KEYWORDS.some(kw => lower.includes(kw));
}

// RELIABILITY: isChildVenueName() checks venue names against keyword patterns
// (kids, children, bounce, playground, etc.). This is the ONLY filter that catches
// kids venues with adult Google place types. All 3 card-serving functions must
// apply this filter. See also: generate-curated-experiences checks stop names.
// Backward-compatible alias
export const isChildVenueName = isExcludedVenueName;
