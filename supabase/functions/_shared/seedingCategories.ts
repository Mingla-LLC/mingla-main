/**
 * Seeding Category Configs — Single Source of Truth
 *
 * 13 category configs with includedTypes and excludedPrimaryTypes.
 * Shared by both admin seeding (place_pool population) and curated
 * experience generation (place_pool queries).
 *
 * Maps 1:1 to Mingla's 13 app categories (12 visible + 1 hidden).
 * Each seeding category maps to exactly one app category.
 */

// ── Interface ─────────────────────────────────────────────────────────────────

export interface SeedingCategoryConfig {
  id: string;                    // Unique slug (e.g., 'nature_views')
  label: string;                 // Human-readable name
  appCategory: string;           // Maps to Mingla app category display name
  appCategorySlug: string;       // Slug version of app category
  includedTypes: string[];       // Google Places types to search for
  excludedPrimaryTypes: string[]; // Primary types to reject post-fetch
}

// ── 13 Category Configs ───────────────────────────────────────────────────────

export const SEEDING_CATEGORIES: SeedingCategoryConfig[] = [
  {
    id: 'nature_views',
    label: 'Nature & Views',
    appCategory: 'Nature & Views',
    appCategorySlug: 'nature',
    includedTypes: [
      'beach', 'botanical_garden', 'garden', 'hiking_area', 'national_park',
      'nature_preserve', 'park', 'scenic_spot', 'state_park', 'observation_deck',
      'tourist_attraction',
    ],
    excludedPrimaryTypes: [
      'dog_park', 'fitness_center', 'gym', 'community_center', 'sports_complex',
      'sports_club', 'playground', 'athletic_field', 'skateboard_park',
      'swimming_pool', 'tennis_court', 'cycling_park', 'off_roading_area',
      'campground', 'rv_park', 'barbecue_area', 'public_bath', 'public_bathroom',
      'stable', 'fishing_pond', 'fishing_pier',
    ],
  },
  {
    id: 'first_meet',
    label: 'First Meet',
    appCategory: 'First Meet',
    appCategorySlug: 'first_meet',
    includedTypes: [
      'book_store', 'cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop',
      'juice_shop', 'bistro', 'wine_bar', 'lounge_bar',
    ],
    excludedPrimaryTypes: [
      'night_club', 'sports_bar', 'bar', 'bar_and_grill', 'pub', 'restaurant',
      'fine_dining_restaurant', 'fast_food_restaurant', 'movie_theater',
      'bowling_alley', 'karaoke', 'concert_hall', 'live_music_venue',
      'amusement_center', 'video_arcade', 'gym', 'fitness_center',
      'coworking_space', 'corporate_office', 'shopping_mall',
    ],
  },
  {
    id: 'picnic_park',
    label: 'Picnic Park',
    appCategory: 'Picnic Park',
    appCategorySlug: 'picnic_park',
    includedTypes: ['picnic_ground', 'park'],
    excludedPrimaryTypes: [
      'dog_park', 'playground', 'athletic_field', 'sports_complex', 'sports_club',
      'fitness_center', 'gym', 'skateboard_park', 'swimming_pool', 'tennis_court',
      'cycling_park', 'off_roading_area', 'campground', 'rv_park', 'barbecue_area',
      'community_center', 'public_bath', 'public_bathroom', 'stable',
      'fishing_pond', 'fishing_pier',
    ],
  },
  {
    id: 'drink',
    label: 'Drink',
    appCategory: 'Drink',
    appCategorySlug: 'drink',
    includedTypes: [
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'pub', 'brewery',
      'beer_garden', 'brewpub',
    ],
    excludedPrimaryTypes: [
      'night_club', 'sports_bar', 'restaurant', 'fine_dining_restaurant',
      'fast_food_restaurant', 'cafe', 'coffee_shop', 'tea_house', 'bakery',
      'dessert_shop', 'juice_shop', 'movie_theater', 'bowling_alley', 'karaoke',
      'concert_hall', 'live_music_venue', 'amusement_center', 'video_arcade',
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space',
    ],
  },
  {
    id: 'casual_eats',
    label: 'Casual Eats',
    appCategory: 'Casual Eats',
    appCategorySlug: 'casual_eats',
    includedTypes: [
      'restaurant', 'bistro', 'brunch_restaurant', 'breakfast_restaurant', 'diner',
      'cafe', 'coffee_shop', 'sandwich_shop', 'pizza_restaurant',
      'hamburger_restaurant', 'mexican_restaurant', 'mediterranean_restaurant',
      'thai_restaurant', 'vegetarian_restaurant',
    ],
    excludedPrimaryTypes: [
      'fine_dining_restaurant', 'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar',
      'night_club', 'sports_bar', 'fast_food_restaurant', 'movie_theater',
      'bowling_alley', 'karaoke', 'concert_hall', 'live_music_venue',
      'amusement_center', 'video_arcade', 'gym', 'fitness_center',
      'shopping_mall', 'corporate_office', 'coworking_space',
    ],
  },
  {
    id: 'fine_dining',
    label: 'Fine Dining',
    appCategory: 'Fine Dining',
    appCategorySlug: 'fine_dining',
    includedTypes: [
      'fine_dining_restaurant', 'french_restaurant', 'italian_restaurant',
      'steak_house', 'seafood_restaurant', 'wine_bar',
    ],
    excludedPrimaryTypes: [
      'fast_food_restaurant', 'cafe', 'coffee_shop', 'tea_house', 'bakery',
      'dessert_shop', 'juice_shop', 'bar', 'sports_bar', 'pub', 'night_club',
      'movie_theater', 'bowling_alley', 'karaoke', 'amusement_center',
      'video_arcade', 'shopping_mall', 'corporate_office', 'coworking_space',
    ],
  },
  {
    id: 'watch',
    label: 'Watch',
    appCategory: 'Watch',
    appCategorySlug: 'watch',
    includedTypes: ['movie_theater'],
    excludedPrimaryTypes: [
      'museum', 'art_gallery', 'art_museum', 'bar', 'cocktail_bar', 'lounge_bar',
      'wine_bar', 'night_club', 'restaurant', 'fine_dining_restaurant',
      'fast_food_restaurant', 'bowling_alley', 'karaoke', 'amusement_center',
      'video_arcade', 'gym', 'fitness_center', 'shopping_mall',
      'corporate_office', 'coworking_space',
    ],
  },
  {
    id: 'live_performance',
    label: 'Live Performance',
    appCategory: 'Live Performance',
    appCategorySlug: 'live_performance',
    includedTypes: [
      'performing_arts_theater', 'concert_hall', 'opera_house',
      'philharmonic_hall', 'amphitheatre',
    ],
    excludedPrimaryTypes: [
      'museum', 'art_gallery', 'art_museum', 'bar', 'cocktail_bar', 'lounge_bar',
      'wine_bar', 'video_arcade', 'gym', 'fitness_center', 'shopping_mall',
      'corporate_office', 'coworking_space',
    ],
  },
  {
    id: 'creative_arts',
    label: 'Creative & Arts',
    appCategory: 'Creative & Arts',
    appCategorySlug: 'creative_arts',
    includedTypes: [
      'art_gallery', 'art_museum', 'art_studio', 'museum', 'history_museum',
      'performing_arts_theater', 'cultural_center', 'cultural_landmark',
      'sculpture',
    ],
    excludedPrimaryTypes: [
      'movie_theater', 'concert_hall', 'opera_house', 'philharmonic_hall', 'bar',
      'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club', 'restaurant',
      'fine_dining_restaurant', 'fast_food_restaurant', 'gym', 'fitness_center',
      'shopping_mall', 'corporate_office', 'coworking_space', 'park', 'beach',
      'scenic_spot',
    ],
  },
  {
    id: 'play',
    label: 'Play',
    appCategory: 'Play',
    appCategorySlug: 'play',
    includedTypes: [
      'amusement_center', 'bowling_alley', 'miniature_golf_course',
      'go_karting_venue', 'paintball_center', 'video_arcade', 'karaoke',
      'amusement_park',
    ],
    excludedPrimaryTypes: [
      'movie_theater', 'performing_arts_theater', 'concert_hall', 'opera_house',
      'philharmonic_hall', 'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar',
      'night_club', 'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space', 'park', 'beach', 'scenic_spot',
    ],
  },
  {
    id: 'wellness',
    label: 'Wellness',
    appCategory: 'Wellness',
    appCategorySlug: 'wellness',
    includedTypes: ['spa', 'massage_spa', 'sauna', 'wellness_center', 'yoga_studio', 'resort_hotel'],
    excludedPrimaryTypes: [
      'gym', 'fitness_center', 'sports_club', 'swimming_pool', 'restaurant',
      'fine_dining_restaurant', 'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar',
      'night_club', 'movie_theater', 'museum', 'art_gallery', 'shopping_mall',
      'corporate_office', 'coworking_space', 'park', 'beach',
    ],
  },
  {
    id: 'flowers',
    label: 'Flowers',
    appCategory: 'Flowers',
    appCategorySlug: 'flowers',
    includedTypes: ['florist', 'grocery_store', 'supermarket'],
    excludedPrimaryTypes: [
      // Niche/specialty groceries (no floral section)
      'asian_grocery_store', 'health_food_store', 'food_store',
      'farmers_market', 'market', 'convenience_store',
      'discount_store', 'discount_supermarket', 'general_store',
      // Wholesale/warehouse (bulk clubs, not retail floral)
      'wholesaler', 'warehouse_store', 'hypermarket',
      // Specialty food retail
      'butcher_shop', 'liquor_store',
      // General retail
      'department_store', 'garden_center', 'home_improvement_store',
      'shopping_mall', 'store',
      // Non-grocery
      'restaurant', 'fine_dining_restaurant',
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club',
      'movie_theater', 'museum', 'art_gallery', 'gym', 'fitness_center',
      'corporate_office', 'coworking_space',
    ],
  },
  {
    id: 'groceries',
    label: 'Groceries',
    appCategory: 'Groceries',
    appCategorySlug: 'groceries',
    includedTypes: ['grocery_store', 'supermarket'],
    excludedPrimaryTypes: [
      'florist', 'garden_center', 'restaurant', 'fine_dining_restaurant',
      'fast_food_restaurant', 'cafe', 'coffee_shop', 'tea_house', 'bakery',
      'market', 'food_store', 'farmers_market', 'health_food_store',
      'asian_grocery_store', 'dessert_shop', 'juice_shop', 'liquor_store',
      'shopping_mall', 'store', 'department_store', 'discount_store',
      'convenience_store', 'corporate_office', 'coworking_space',
    ],
  },
];

// ── Lookup Maps ───────────────────────────────────────────────────────────────

/** Map from category ID → config for O(1) lookup */
export const SEEDING_CATEGORY_MAP: Record<string, SeedingCategoryConfig> = {};
for (const cat of SEEDING_CATEGORIES) {
  SEEDING_CATEGORY_MAP[cat.id] = cat;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get includedTypes for a category ID. Returns [] if unknown. */
export function getIncludedTypes(categoryId: string): string[] {
  return SEEDING_CATEGORY_MAP[categoryId]?.includedTypes ?? [];
}

/** Get excludedPrimaryTypes for a category ID. Returns [] if unknown. */
export function getExcludedPrimaryTypes(categoryId: string): string[] {
  return SEEDING_CATEGORY_MAP[categoryId]?.excludedPrimaryTypes ?? [];
}

/** All 13 category IDs */
export const ALL_SEEDING_CATEGORY_IDS = SEEDING_CATEGORIES.map(c => c.id);
