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
    'national_park', 'state_park', 'nature_preserve', 'wildlife_refuge',
    'wildlife_park', 'scenic_spot', 'garden', 'botanical_garden',
    'park', 'lake', 'river', 'island', 'mountain_peak',
    'woods', 'hiking_area', 'campground', 'picnic_ground',
  ],
  'First Meet': [
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
  'Picnic': [
    'park', 'city_park', 'picnic_ground', 'state_park',
    'botanical_garden', 'garden', 'nature_preserve',
  ],
  'Drink': [
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
    'fine_dining_restaurant', 'french_restaurant', 'steak_house',
    'seafood_restaurant', 'mediterranean_restaurant', 'spanish_restaurant',
    'tapas_restaurant', 'oyster_bar_restaurant', 'bistro',
    'gastropub', 'wine_bar',
  ],
  'Watch': [
    'movie_theater', 'performing_arts_theater', 'concert_hall',
    'opera_house', 'philharmonic_hall', 'amphitheatre',
    'comedy_club', 'live_music_venue', 'karaoke',
  ],
  'Creative & Arts': [
    'art_gallery', 'art_museum', 'art_studio', 'museum', 'history_museum',
    'sculpture', 'cultural_center', 'cultural_landmark',
    'performing_arts_theater', 'opera_house', 'auditorium',
    'amphitheatre', 'comedy_club', 'live_music_venue',
  ],
  'Play': [
    'amusement_center', 'amusement_park', 'bowling_alley', 'miniature_golf_course',
    'go_karting_venue', 'paintball_center', 'video_arcade', 'skateboard_park',
    'indoor_playground', 'karaoke', 'dance_hall', 'ice_skating_rink',
    'cycling_park', 'roller_coaster', 'water_park', 'ferris_wheel',
    'casino', 'planetarium',
  ],
  'Wellness': [
    'spa', 'massage_spa', 'massage', 'sauna', 'resort_hotel',
  ],
  'Groceries & Flowers': [
    'grocery_store', 'supermarket', 'food_store', 'market',
    'asian_grocery_store', 'farmers_market', 'hypermarket', 'discount_supermarket',
  ],
  'Work & Business': [
    'coworking_space', 'business_center', 'library',
    'cafe', 'coffee_shop', 'tea_house', 'hotel',
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
];

/**
 * Additional place types excluded specifically for the Romantic intent.
 * These are kid/family-oriented venues inappropriate for intimate dates.
 * Applied on top of GLOBAL_EXCLUDED_PLACE_TYPES.
 */
export const ROMANTIC_EXCLUDED_PLACE_TYPES: string[] = [
  ...GLOBAL_EXCLUDED_PLACE_TYPES,
  'indoor_playground',
  'amusement_park',
  'water_park',
  'amusement_center',
  'playground',
  'children_store',
  'child_care_agency',
  'preschool',
];

/**
 * Filters out places whose `types` array contains any globally or
 * intent-specifically excluded type. Call this on EVERY batch of
 * Google Places results before scoring, caching, or returning.
 */
export function filterExcludedPlaces(
  places: Array<{ types?: string[] }>,
  intentExcluded?: string[],
): Array<{ types?: string[] }> {
  const excluded = new Set(intentExcluded ?? GLOBAL_EXCLUDED_PLACE_TYPES);
  return places.filter((place) => {
    if (!place.types) return true;
    return !place.types.some((t) => excluded.has(t));
  });
}

// ── Alias mapping: handles all case/format variations ────────────────────────
// Maps every known variation to the canonical display name above.
const CATEGORY_ALIASES: Record<string, string> = {
  // Slug forms
  'nature': 'Nature',
  'first_meet': 'First Meet',
  'first-meet': 'First Meet',
  'firstmeet': 'First Meet',
  'picnic': 'Picnic',
  'picnic_park': 'Picnic',
  'picnic-park': 'Picnic',
  'picnic park': 'Picnic',
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

  // Short forms used by legacy recommendation endpoints
  'sip': 'Drink',
  'play_move': 'Play',
  'screen_relax': 'Watch',
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

// ── All canonical category display names ──────────────────────────────────────
export const ALL_CATEGORY_NAMES = Object.keys(MINGLA_CATEGORY_PLACE_TYPES);

// ── Per-category excluded types ───────────────────────────────────────────────

/**
 * Per-category excluded types — venues that are inappropriate
 * for a specific category context even if Google returns them.
 * Applied as post-fetch filter alongside GLOBAL_EXCLUDED_PLACE_TYPES.
 */
export const CATEGORY_EXCLUDED_PLACE_TYPES: Record<string, string[]> = {
  'Nature': [
    'shopping_mall', 'department_store', 'electronics_store',
    'furniture_store', 'store', 'warehouse_store',
    'movie_theater', 'video_arcade', 'bowling_alley', 'casino',
    'night_club', 'karaoke', 'amusement_center', 'amusement_park',
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
  ],
  'First Meet': [
    'night_club', 'bar', 'cocktail_bar', 'lounge_bar', 'brewery', 'brewpub',
    'fine_dining_restaurant', 'french_restaurant', 'steak_house',
    'indoor_playground', 'water_park',
  ],
  'Picnic': [
    'dog_park', 'amusement_park', 'water_park',
    'bar', 'night_club', 'casino', 'movie_theater', 'video_arcade',
  ],
  'Drink': [
    'fine_dining_restaurant', 'spa', 'sauna', 'amusement_park', 'water_park',
  ],
  'Casual Eats': [
    'fine_dining_restaurant', 'bar', 'night_club', 'spa',
    'grocery_store', 'supermarket', 'food_store', 'market',
    'asian_grocery_store', 'farmers_market', 'hypermarket', 'discount_supermarket',
  ],
  'Fine Dining': [
    'fast_food_restaurant', 'food_court', 'bar', 'bowling_alley',
    'amusement_park', 'water_park', 'video_arcade', 'night_club',
    // Romantic exclusions (fine dining is often romantic context)
    'indoor_playground', 'amusement_center', 'playground',
    'children_store', 'child_care_agency', 'preschool',
  ],
  'Creative & Arts': [
    'fast_food_restaurant', 'food_court', 'bar', 'bowling_alley',
    'amusement_park', 'water_park', 'spa', 'sauna', 'night_club',
    'shopping_mall', 'department_store', 'electronics_store',
    'furniture_store', 'warehouse_store', 'store',
    'sports_complex', 'sports_club',
    'stadium', 'race_course', 'tennis_court', 'swimming_pool',
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
  ],
  'Watch': [
    // Retail / commercial — irrelevant to entertainment venues
    'shopping_mall', 'department_store', 'electronics_store',
    'furniture_store', 'store', 'warehouse_store',
    // Sports / active — wrong context for seated entertainment
    'sports_complex', 'sports_club', 'stadium', 'race_course',
    'tennis_court', 'swimming_pool', 'skateboard_park',
    // Grocery / utility
    'grocery_store', 'supermarket', 'convenience_store',
    'gas_station', 'car_repair', 'car_wash',
    // Transit / infrastructure
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
  ],
  'Play': [
    // Retail
    'shopping_mall', 'department_store', 'electronics_store',
    'furniture_store', 'warehouse_store', 'store', 'market',
    'food_store', 'supermarket',
    // Culture venues (belong in Creative & Arts)
    'art_gallery', 'museum', 'cultural_center', 'art_museum', 'history_museum',
    // Low-end food
    'fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant',
    'sandwich_shop', 'food_court', 'buffet_restaurant',
    // Transport
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
  ],
  'Wellness': [
    // Sports/fitness
    'gym', 'fitness_center', 'sports_complex', 'sports_club',
    'stadium', 'tennis_court', 'swimming_pool', 'race_course',
    // Play venues
    'amusement_park', 'amusement_center', 'video_arcade', 'bowling_alley',
    'paintball_center', 'go_karting_venue', 'miniature_golf_course', 'skateboard_park',
    // Nightlife
    'night_club', 'karaoke',
    // Retail
    'shopping_mall', 'department_store', 'electronics_store',
    'furniture_store', 'warehouse_store', 'store', 'market',
    'food_store', 'supermarket', 'grocery_store',
    // Transport
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
    // Medical
    'doctor', 'dentist', 'medical_clinic', 'medical_center',
    'medical_lab', 'hospital', 'general_hospital',
  ],
  'Groceries & Flowers': [
    // Low-end food / restaurants
    'fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant',
    'sandwich_shop', 'buffet_restaurant', 'food_court', 'diner', 'restaurant',
    // Play venues
    'amusement_park', 'amusement_center', 'video_arcade', 'bowling_alley',
    'paintball_center', 'go_karting_venue', 'miniature_golf_course', 'skateboard_park',
    // Entertainment
    'movie_theater',
    // Wellness
    'spa', 'massage_spa', 'massage', 'sauna', 'wellness_center',
    // Personal care
    'hair_salon', 'beauty_salon',
    // Sports/fitness
    'gym', 'fitness_center', 'sports_complex', 'sports_club', 'stadium',
    // Transport
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
    // Convenience/general (not focused grocery destinations)
    'convenience_store', 'general_store',
  ],
  'Work & Business': [
    // Play venues
    'amusement_park', 'amusement_center', 'video_arcade', 'bowling_alley',
    'paintball_center', 'go_karting_venue', 'miniature_golf_course', 'skateboard_park',
    // Nightlife
    'night_club', 'karaoke',
    // Sports/fitness
    'gym', 'fitness_center', 'sports_complex', 'sports_club',
    'stadium', 'tennis_court', 'swimming_pool', 'race_course',
    // Kids/water
    'indoor_playground', 'childrens_camp', 'water_park',
    // Retail
    'shopping_mall', 'department_store', 'electronics_store',
    'furniture_store', 'warehouse_store', 'store', 'market',
    'food_store', 'supermarket', 'grocery_store',
    // Transport
    'parking', 'parking_lot', 'parking_garage',
    'bus_station', 'train_station', 'transit_station', 'airport',
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
 * for the Groceries & Flowers category.
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
