/**
 * Unified Mingla Category → Google Places API (New) type mappings.
 *
 * Extracted from: new-generate-experience-, discover-experiences,
 * generate-curated-experiences, holiday-experiences, night-out-experiences,
 * generate-session-experiences.
 *
 * Use this as the SINGLE SOURCE OF TRUTH for category → place type lookups.
 * The first type in each array is the "primary" type used for pool seeding.
 */

// ── Primary mapping: Display Name → Google Place types ──────────────────────
export const MINGLA_CATEGORY_PLACE_TYPES: Record<string, string[]> = {
  'Nature': [
    'park', 'national_park', 'hiking_area', 'botanical_garden',
    'state_park', 'zoo', 'wildlife_park', 'garden',
    'tourist_attraction', 'wildlife_refuge', 'city_park', 'picnic_ground',
  ],
  'First Meet': [
    'cafe', 'coffee_shop', 'tea_house', 'ice_cream_shop',
    'dessert_shop', 'bakery',
  ],
  'Picnic': [
    'park', 'picnic_ground', 'garden', 'botanical_garden',
    'national_park', 'state_park', 'city_park',
  ],
  'Drink': [
    'bar', 'wine_bar', 'cocktail_bar', 'pub',
    'coffee_shop', 'tea_house', 'brewery', 'night_club', 'winery',
  ],
  'Casual Eats': [
    'restaurant', 'fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant',
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
  ],
  'Fine Dining': [
    'fine_dining_restaurant', 'french_restaurant', 'italian_restaurant',
    'steak_house', 'seafood_restaurant', 'mediterranean_restaurant',
    'greek_restaurant', 'spanish_restaurant', 'tapas_restaurant',
    'fondue_restaurant', 'bistro', 'gastropub',
  ],
  'Watch': [
    'movie_theater', 'performing_arts_theater', 'comedy_club',
    'live_music_venue', 'concert_hall', 'amphitheatre', 'opera_house',
  ],
  'Creative & Arts': [
    'art_gallery', 'museum', 'art_studio', 'art_museum',
    'performing_arts_theater', 'cultural_center', 'planetarium',
    'cultural_landmark', 'dance_hall', 'karaoke', 'coffee_roastery',
  ],
  'Play': [
    'bowling_alley', 'amusement_park', 'water_park', 'video_arcade',
    'amusement_center', 'miniature_golf_course', 'go_karting_venue',
    'paintball_center', 'adventure_sports_center', 'indoor_playground',
    'skateboard_park', 'karaoke', 'casino', 'ice_skating_rink',
    'roller_coaster', 'ferris_wheel', 'planetarium',
  ],
  'Wellness': [
    'spa', 'massage', 'sauna', 'wellness_center',
    'yoga_studio', 'massage_spa',
  ],
  'Groceries & Flowers': [
    'grocery_store', 'supermarket', 'farmers_market', 'garden_center',
  ],
  'Work & Business': [
    'cafe', 'coffee_shop', 'tea_house',
  ],
};

// ── Alias mapping: handles all case/format variations ────────────────────────
// Maps every known variation to the canonical display name above.
const CATEGORY_ALIASES: Record<string, string> = {
  // Slug forms
  'nature': 'Nature',
  'first_meet': 'First Meet',
  'first-meet': 'First Meet',
  'firstmeet': 'First Meet',
  'picnic': 'Picnic',
  'drink': 'Drink',
  'casual_eats': 'Casual Eats',
  'casual-eats': 'Casual Eats',
  'casualeats': 'Casual Eats',
  'fine_dining': 'Fine Dining',
  'fine-dining': 'Fine Dining',
  'finedining': 'Fine Dining',
  'watch': 'Watch',
  'creative_arts': 'Creative & Arts',
  'creative-arts': 'Creative & Arts',
  'creativearts': 'Creative & Arts',
  'creative & arts': 'Creative & Arts',
  'play': 'Play',
  'wellness': 'Wellness',
  'groceries_flowers': 'Groceries & Flowers',
  'groceries & flowers': 'Groceries & Flowers',
  'groceries-flowers': 'Groceries & Flowers',
  'groceriesflowers': 'Groceries & Flowers',
  'work_business': 'Work & Business',
  'work-business': 'Work & Business',
  'workbusiness': 'Work & Business',
  'work & business': 'Work & Business',
  'work and business': 'Work & Business',
  'work_and_business': 'Work & Business',

  // Old category system (backwards compat)
  'sip & chill': 'Drink',
  'sip_and_chill': 'Drink',
  'sip-and-chill': 'Drink',
  'sip&chill': 'Drink',
  'sip_&_chill': 'Drink',
  'sip-&-chill': 'Drink',
  'sipchill': 'Drink',
  'stroll': 'Nature',
  'take a stroll': 'Nature',
  'take-a-stroll': 'Nature',
  'take_a_stroll': 'Nature',
  'dining experiences': 'Fine Dining',
  'dining_experiences': 'Fine Dining',
  'dining-experiences': 'Fine Dining',
  'dining': 'Fine Dining',
  'screen & relax': 'Watch',
  'screen_and_relax': 'Watch',
  'screen-and-relax': 'Watch',
  'screen&relax': 'Watch',
  'screenrelax': 'Watch',
  'screen_&_relax': 'Watch',
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
  'casual eats': 'Casual Eats',
  'picnics': 'Picnic',
  'wellness dates': 'Wellness',
  'wellness_dates': 'Wellness',
  'freestyle': 'Nature',
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
  'friendly',
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
