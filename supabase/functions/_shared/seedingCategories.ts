/**
 * Seeding Category Configs — Google Nearby Search Type Definitions
 *
 * 13 category configs with includedTypes and excludedPrimaryTypes.
 * Used by admin-seed-places to populate place_pool via Google Nearby Search.
 *
 * NOT the category classification system — AI validation (ai-validate-places)
 * independently classifies each place into Mingla categories using natural
 * language criteria, regardless of these type lists.
 *
 * Other consumers:
 *   - generate-single-cards: borrows label→slug mapping only
 *   - generate-curated-experiences: borrows labels for display only
 *
 * For category name resolution, slug mapping, and on-demand experience
 * type lists, see categoryPlaceTypes.ts (separate system, separate purpose).
 *
 * Updated 2026-04-08: Major keyword expansion — added cuisine-specific
 * restaurant types, nature landmarks, performance venues, and improved
 * exclusion lists for cleaner results.
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
      // Existing
      'beach', 'botanical_garden', 'garden', 'hiking_area', 'national_park',
      'nature_preserve', 'park', 'scenic_spot', 'state_park', 'observation_deck',
      'tourist_attraction',
      // New
      'city_park', 'fountain', 'island', 'lake', 'marina', 'mountain_peak',
      'river', 'vineyard', 'woods', 'wildlife_park', 'wildlife_refuge',
      'zoo', 'aquarium',
    ],
    excludedPrimaryTypes: [
      // Sports / fitness / recreation (not scenic)
      'dog_park', 'fitness_center', 'gym', 'sports_complex', 'sports_club',
      'playground', 'athletic_field', 'skateboard_park', 'swimming_pool',
      'tennis_court', 'cycling_park', 'off_roading_area', 'adventure_sports_center',
      // Camping / utility
      'campground', 'rv_park', 'public_bath', 'public_bathroom', 'stable',
      'fishing_pond', 'fishing_pier',
      // Entertainment / nightlife (not nature)
      'amusement_center', 'amusement_park', 'casino', 'dance_hall',
      'event_venue', 'indoor_playground', 'internet_cafe', 'night_club',
      'roller_coaster', 'video_arcade', 'water_park',
      // Civic / corporate
      'banquet_hall', 'community_center', 'convention_center', 'wedding_venue',
      // Food / drink (not nature)
      'bar', 'restaurant', 'fast_food_restaurant', 'cafe', 'night_club',
    ],
  },
  {
    id: 'first_meet',
    label: 'First Meet',
    appCategory: 'First Meet',
    appCategorySlug: 'first_meet',
    includedTypes: [
      // Existing
      'book_store', 'cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop',
      'juice_shop', 'bistro', 'wine_bar', 'lounge_bar',
      // New — sweet / light bite / cozy spots
      'acai_shop', 'bagel_shop', 'cake_shop', 'cat_cafe', 'chocolate_shop',
      'chocolate_factory', 'coffee_roastery', 'coffee_stand', 'confectionery',
      'dessert_restaurant', 'ice_cream_shop',
    ],
    excludedPrimaryTypes: [
      // Loud / party venues
      'night_club', 'sports_bar', 'bar', 'bar_and_grill', 'pub',
      'hookah_bar', 'brewery', 'brewpub', 'beer_garden', 'cocktail_bar',
      'gastropub',
      // Full restaurants (too heavy for first meet)
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'buffet_restaurant', 'food_court', 'deli', 'snack_bar',
      // Entertainment
      'movie_theater', 'bowling_alley', 'karaoke', 'concert_hall',
      'live_music_venue', 'amusement_center', 'video_arcade', 'casino',
      // Fitness / corporate
      'gym', 'fitness_center', 'coworking_space', 'corporate_office',
      'shopping_mall', 'convention_center',
    ],
  },
  {
    id: 'picnic_park',
    label: 'Picnic Park',
    appCategory: 'Picnic Park',
    appCategorySlug: 'picnic_park',
    includedTypes: [
      'picnic_ground', 'park', 'city_park',
    ],
    excludedPrimaryTypes: [
      // Sports / active recreation (not picnic vibes)
      'dog_park', 'playground', 'athletic_field', 'sports_complex', 'sports_club',
      'fitness_center', 'gym', 'skateboard_park', 'swimming_pool', 'tennis_court',
      'cycling_park', 'off_roading_area', 'adventure_sports_center',
      // Camping / utility
      'campground', 'rv_park', 'public_bath', 'public_bathroom', 'stable',
      'fishing_pond', 'fishing_pier', 'barbecue_area',
      // Community / civic
      'community_center', 'convention_center', 'event_venue', 'wedding_venue',
      // Entertainment (not a park)
      'amusement_center', 'amusement_park', 'casino', 'indoor_playground',
      'night_club', 'roller_coaster', 'video_arcade', 'water_park',
      // Food / drink
      'bar', 'restaurant', 'fast_food_restaurant', 'cafe',
    ],
  },
  {
    id: 'drink',
    label: 'Drink',
    appCategory: 'Drink',
    appCategorySlug: 'drink',
    includedTypes: [
      // Existing
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'pub', 'brewery',
      'beer_garden', 'brewpub',
      // New
      'bar_and_grill', 'hookah_bar', 'irish_pub', 'night_club', 'winery', 'sports_bar'
    ],
    excludedPrimaryTypes: [
      // Food-primary (not drink-focused)
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop',
      'juice_shop', 'gastropub', 'buffet_restaurant', 'food_court', 'snack_bar',
      'deli', 'ice_cream_shop',
      // Entertainment (not drink)
      'movie_theater', 'bowling_alley', 'karaoke', 'concert_hall',
      'live_music_venue', 'amusement_center', 'video_arcade', 'casino',
      // Fitness / corporate / civic
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space', 'convention_center', 'wedding_venue', 'banquet_hall',
    ],
  },
  {
    id: 'casual_eats',
    label: 'Casual Eats',
    appCategory: 'Casual Eats',
    appCategorySlug: 'casual_eats',
    includedTypes: [
      // Core types (generic restaurant catches most casual dining)
      'restaurant', 'bistro', 'brunch_restaurant', 'breakfast_restaurant', 'diner',
      'cafe', 'coffee_shop', 'sandwich_shop', 'pizza_restaurant',
      'hamburger_restaurant', 'mexican_restaurant', 'mediterranean_restaurant',
      'thai_restaurant', 'vegetarian_restaurant',
      // Upscale / notable cuisines that Google surfaces separately
      'american_restaurant', 'asian_restaurant', 'barbecue_restaurant',
      'brazilian_restaurant', 'caribbean_restaurant', 'chinese_restaurant',
      'ethiopian_restaurant', 'french_restaurant', 'fusion_restaurant',
      'gastropub', 'german_restaurant', 'greek_restaurant',
      'indian_restaurant', 'indonesian_restaurant', 'italian_restaurant',
      'japanese_restaurant', 'korean_restaurant', 'korean_barbecue_restaurant',
      'lebanese_restaurant', 'middle_eastern_restaurant', 'moroccan_restaurant',
      'peruvian_restaurant', 'ramen_restaurant', 'seafood_restaurant',
      'spanish_restaurant', 'sushi_restaurant', 'tapas_restaurant',
      'turkish_restaurant', 'vegan_restaurant', 'vietnamese_restaurant',
      // Casual formats
      'buffet_restaurant', 'deli', 'food_court', 'noodle_shop',
      'hot_pot_restaurant',
    ],
    excludedPrimaryTypes: [
      // Fine dining (separate category)
      'fine_dining_restaurant',
      // Drink-primary (not food-focused)
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club',
      'sports_bar', 'hookah_bar', 'brewery', 'brewpub', 'beer_garden', 'pub',
      // Fast food (not date-worthy)
      'fast_food_restaurant',
      // Entertainment
      'movie_theater', 'bowling_alley', 'karaoke', 'concert_hall',
      'live_music_venue', 'amusement_center', 'video_arcade', 'casino',
      // Fitness / corporate / civic
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space', 'convention_center', 'wedding_venue', 'banquet_hall',
      // Retail / services (misclassified by Google)
      'gas_station', 'convenience_store', 'grocery_store', 'supermarket',
      'department_store', 'clothing_store', 'hotel', 'motel',
    ],
  },
  {
    id: 'fine_dining',
    label: 'Fine Dining',
    appCategory: 'Fine Dining',
    appCategorySlug: 'fine_dining',
    includedTypes: [
      // Existing
      'fine_dining_restaurant', 'french_restaurant', 'italian_restaurant',
      'steak_house', 'seafood_restaurant', 'wine_bar',
      // New
      'fondue_restaurant', 'oyster_bar_restaurant',
    ],
    excludedPrimaryTypes: [
      // Casual food (wrong tier)
      'fast_food_restaurant', 'cafe', 'coffee_shop', 'tea_house', 'bakery',
      'dessert_shop', 'juice_shop', 'buffet_restaurant', 'food_court',
      'snack_bar', 'deli', 'hot_dog_restaurant', 'hot_dog_stand',
      'hamburger_restaurant', 'pizza_restaurant', 'sandwich_shop',
      // Drink-primary
      'bar', 'sports_bar', 'pub', 'night_club', 'hookah_bar',
      'brewery', 'brewpub', 'beer_garden',
      // Entertainment
      'movie_theater', 'bowling_alley', 'karaoke', 'amusement_center',
      'video_arcade', 'casino',
      // Corporate / civic
      'shopping_mall', 'corporate_office', 'coworking_space',
      'convention_center', 'wedding_venue', 'banquet_hall',
      // Retail / services (misclassified)
      'gas_station', 'convenience_store', 'grocery_store', 'hotel', 'motel',
    ],
  },
  {
    id: 'watch',
    label: 'Watch',
    appCategory: 'Watch',
    appCategorySlug: 'watch',
    includedTypes: ['movie_theater'],
    excludedPrimaryTypes: [
      // Arts / museums (different category)
      'museum', 'art_gallery', 'art_museum',
      // Live performance (different category)
      'concert_hall', 'performing_arts_theater', 'opera_house',
      // Drink / food
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club',
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      // Play / recreation
      'bowling_alley', 'karaoke', 'amusement_center', 'video_arcade', 'casino',
      // Fitness / corporate / civic
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space', 'convention_center', 'event_venue',
    ],
  },
  {
    id: 'live_performance',
    label: 'Live Performance',
    appCategory: 'Live Performance',
    appCategorySlug: 'live_performance',
    includedTypes: [
      // Existing
      'performing_arts_theater', 'concert_hall', 'opera_house',
      'philharmonic_hall', 'amphitheatre',
      // New
      'auditorium', 'comedy_club', 'event_venue', 'live_music_venue',
      'dance_hall',
    ],
    excludedPrimaryTypes: [
      // Arts / museums (different category)
      'museum', 'art_gallery', 'art_museum',
      // Watch (different category)
      'movie_theater',
      // Drink / food
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club',
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      // Play / recreation
      'bowling_alley', 'karaoke', 'amusement_center', 'video_arcade', 'casino',
      // Fitness / corporate / civic
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space', 'convention_center', 'wedding_venue', 'banquet_hall',
      // Nature (misclassified amphitheatres)
      'park', 'beach', 'scenic_spot',
    ],
  },
  {
    id: 'creative_arts',
    label: 'Creative & Arts',
    appCategory: 'Creative & Arts',
    appCategorySlug: 'creative_arts',
    includedTypes: [
      // Existing
      'art_gallery', 'art_museum', 'art_studio', 'museum', 'history_museum',
      'performing_arts_theater', 'cultural_center', 'cultural_landmark',
      'sculpture',
      // New
      'aquarium', 'castle', 'historical_place', 'historical_landmark',
      'monument', 'planetarium',
    ],
    excludedPrimaryTypes: [
      // Live performance (different category)
      'concert_hall', 'opera_house', 'philharmonic_hall', 'comedy_club',
      'live_music_venue', 'dance_hall', 'amphitheatre',
      // Watch (different category)
      'movie_theater',
      // Drink / food
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club',
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'cafe', 'coffee_shop',
      // Play / recreation
      'bowling_alley', 'karaoke', 'amusement_center', 'video_arcade', 'casino',
      // Fitness / corporate / civic
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space', 'convention_center', 'wedding_venue', 'banquet_hall',
      'community_center', 'event_venue',
      // Nature (different category)
      'park', 'beach', 'scenic_spot', 'hiking_area', 'national_park',
      // Retail / services
      'hotel', 'motel', 'store', 'department_store',
    ],
  },
  {
    id: 'play',
    label: 'Play',
    appCategory: 'Play',
    appCategorySlug: 'play',
    includedTypes: [
      // Existing
      'amusement_center', 'bowling_alley', 'miniature_golf_course',
      'go_karting_venue', 'paintball_center', 'video_arcade', 'karaoke',
      'amusement_park',
      // New
      'adventure_sports_center', 'casino', 'ferris_wheel',
      'roller_coaster', 'water_park', 'ice_skating_rink',
    ],
    excludedPrimaryTypes: [
      // Performance (different category)
      'movie_theater', 'performing_arts_theater', 'concert_hall', 'opera_house',
      'philharmonic_hall', 'comedy_club', 'live_music_venue', 'dance_hall',
      // Drink / food
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club',
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'cafe', 'coffee_shop',
      // Arts / museums
      'museum', 'art_gallery', 'art_museum',
      // Fitness / corporate / civic
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space', 'convention_center', 'wedding_venue', 'banquet_hall',
      'community_center',
      // Nature (different category)
      'park', 'beach', 'scenic_spot', 'hiking_area', 'national_park',
      // Retail / services
      'hotel', 'motel', 'store', 'department_store',
    ],
  },
  {
    id: 'wellness',
    label: 'Wellness',
    appCategory: 'Wellness',
    appCategorySlug: 'wellness',
    includedTypes: ['spa', 'massage_spa', 'sauna', 'wellness_center', 'yoga_studio', 'resort_hotel'],
    excludedPrimaryTypes: [
      // Fitness (not wellness/relaxation)
      'gym', 'fitness_center', 'sports_club', 'swimming_pool',
      'adventure_sports_center',
      // Food / drink
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club',
      'cafe', 'coffee_shop',
      // Entertainment
      'movie_theater', 'bowling_alley', 'karaoke', 'amusement_center',
      'video_arcade', 'casino',
      // Arts
      'museum', 'art_gallery',
      // Corporate / civic
      'shopping_mall', 'corporate_office', 'coworking_space',
      'convention_center', 'wedding_venue', 'banquet_hall', 'community_center',
      // Nature (different category)
      'park', 'beach', 'hiking_area',
      // Medical (not relaxation)
      'doctor', 'hospital', 'dentist', 'physiotherapist',
      // Beauty (not wellness experience)
      'beauty_salon', 'hair_salon', 'nail_salon',
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
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club',
      'movie_theater', 'museum', 'art_gallery', 'gym', 'fitness_center',
      'corporate_office', 'coworking_space',
      // Medical / services
      'doctor', 'hospital', 'gas_station', 'hotel',
    ],
  },
  {
    id: 'groceries',
    label: 'Groceries',
    appCategory: 'Groceries',
    appCategorySlug: 'groceries',
    includedTypes: ['grocery_store', 'supermarket'],
    excludedPrimaryTypes: [
      // Wrong grocery type
      'florist', 'garden_center', 'market', 'food_store', 'farmers_market',
      'health_food_store', 'asian_grocery_store', 'liquor_store',
      'convenience_store', 'discount_store',
      // Food service (not grocery)
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop',
      'juice_shop',
      // General retail
      'shopping_mall', 'store', 'department_store',
      // Corporate / civic
      'corporate_office', 'coworking_space',
      // Medical / services
      'doctor', 'hospital', 'gas_station', 'hotel',
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
