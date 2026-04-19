/**
 * Seeding Category Configs — Google Nearby Search Type Definitions
 *
 * 14 category configs with includedTypes and excludedPrimaryTypes.
 * ORCH-0434: Wellness removed. Slugs updated to match new category names.
 * ORCH-0460: casual_eats split into 3 configs (casual_eats + casual_eats_world +
 * casual_eats_extended) to work around Google's 50-type limit; fine_dining expanded
 * from 8 to 32 cuisine types; play tightened with 18 new exclusions + golf added.
 * Used by admin-seed-places to populate place_pool via Google Nearby Search.
 *
 * NOT the category classification system — AI validation (ai-verify-pipeline)
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
 *
 * Updated 2026-04-18: Invariant validator added (runs at module load). Removed
 * invalid `tobacco_shop` type; trimmed BRUNCH and play exclusion lists to fit
 * Google's 50-item cap; removed drink self-contradiction (karaoke +
 * live_music_venue appearing in both includedTypes and excludedPrimaryTypes).
 */

import {
  GOOGLE_PLACE_TYPES_TABLE_A,
  GOOGLE_TYPE_RESTRICTION_MAX,
} from './googlePlaceTypes.ts';

// ── Interface ─────────────────────────────────────────────────────────────────

export interface SeedingCategoryConfig {
  id: string;                    // Unique slug (e.g., 'nature_views')
  label: string;                 // Human-readable name
  appCategory: string;           // Maps to Mingla app category display name
  appCategorySlug: string;       // Slug version of app category
  includedTypes: string[];       // Google Places types to search for
  excludedPrimaryTypes: string[]; // Primary types to reject post-fetch
}

// ── Shared Exclusion Lists ────────────────────────────────────────────────────

// ORCH-0460: Brunch, Lunch & Casual is split across 3 configs (casual_eats +
// casual_eats_world + casual_eats_extended) to fit Google's 50-type limit per
// Nearby Search request. All 3 share this exclusion list verbatim to prevent drift.
//
// Google caps excludedPrimaryTypes at 50 items (same cap as includedTypes). This
// list must stay ≤50. Removed from prior revision: `tobacco_shop` (not a valid
// Google type), `paintball_center`, `sports_complex`, `sports_club`,
// `athletic_field`, `stadium`, `arena`, `swimming_pool` — sports/arena types
// that Google does not return as the primary type of any venue a restaurant-
// includedTypes search would surface. Current length: 49.
const BRUNCH_LUNCH_CASUAL_EXCLUDED: string[] = [
   // Drink-primary (not food-focused)
  'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'night_club',
  'sports_bar', 'hookah_bar', 'brewery', 'brewpub', 'beer_garden', 'pub',
  'bar_and_grill',
  // Fast food (not date-worthy)
  'fast_food_restaurant',
  // Non-restaurant food (ORCH-0460)
  'food_court', 'cafeteria', 'snack_bar',
  // Entertainment / play (ORCH-0460: play venues must not leak in)
  'movie_theater', 'bowling_alley', 'karaoke', 'concert_hall',
  'live_music_venue', 'amusement_center', 'amusement_park',
  'video_arcade', 'casino', 'adventure_sports_center',
  'go_karting_venue', 'miniature_golf_course',
  // Outdoors (ORCH-0460: farms, ranches, campgrounds must not leak in)
  'campground', 'farm', 'ranch',
  // Fitness / corporate / civic
  'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
  'coworking_space', 'convention_center', 'wedding_venue', 'banquet_hall',
  'community_center',
  // Retail / services (misclassified by Google)
  'gas_station', 'convenience_store', 'grocery_store', 'supermarket',
  'department_store', 'clothing_store', 'hotel', 'motel',
];

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
      'bar', 'restaurant', 'fast_food_restaurant', 'cafe',
    ],
  },
  {
    id: 'first_meet',
    label: 'Icebreakers',
    appCategory: 'Icebreakers',
    appCategorySlug: 'icebreakers',
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
    label: 'Nature & Views (Picnic)',
    appCategory: 'Nature & Views',
    appCategorySlug: 'nature',
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
    label: 'Drinks & Music',
    appCategory: 'Drinks & Music',
    appCategorySlug: 'drinks_and_music',
    includedTypes: [
      // Existing
      'bar', 'cocktail_bar', 'lounge_bar', 'wine_bar', 'pub', 'brewery',
      'beer_garden', 'brewpub',
      // New
      'bar_and_grill', 'hookah_bar', 'irish_pub', 'night_club', 'winery', 'sports_bar',
      // ORCH-0434: Added for Drinks & Music
      'live_music_venue', 'karaoke'
    ],
    excludedPrimaryTypes: [
      // Food-primary (not drink-focused)
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop',
      'juice_shop', 'gastropub', 'buffet_restaurant', 'food_court', 'snack_bar',
      'deli', 'ice_cream_shop',
      // Entertainment NOT in Drinks & Music (karaoke + live_music_venue are
      // intentionally included above per ORCH-0434 and must NOT appear here —
      // excludedPrimaryTypes would cancel the inclusion)
      'movie_theater', 'bowling_alley', 'concert_hall',
      'amusement_center', 'video_arcade', 'casino',
      // Fitness / corporate / civic
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space', 'convention_center', 'wedding_venue', 'banquet_hall',
    ],
  },
  {
    id: 'casual_eats',
    label: 'Brunch, Lunch & Casual',
    appCategory: 'Brunch, Lunch & Casual',
    appCategorySlug: 'brunch_lunch_casual',
    includedTypes: [
      // ORCH-0460: removed cafe, coffee_shop (belong in icebreakers), food_court (not a real
      // restaurant), deli (counter service). Category is strictly sit-down restaurants.
      // Core types (generic restaurant catches most casual dining)
      'restaurant', 'bistro', 'brunch_restaurant', 'breakfast_restaurant', 'diner',
      'sandwich_shop', 'pizza_restaurant',
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
      'buffet_restaurant', 'noodle_shop', 'hot_pot_restaurant',
    ],
    excludedPrimaryTypes: BRUNCH_LUNCH_CASUAL_EXCLUDED,
  },
  // ORCH-0460: Split config #2 — world cuisines not in the core casual_eats list.
  // Google caps includedTypes at 50 per request. Core casual_eats is near that limit.
  // This config adds ~50 world cuisine types (cuban, filipino, soul food, dim sum, etc.)
  // that were previously invisible because Google sometimes only tags a place with its
  // cuisine-specific type, not the generic "restaurant" type.
  {
    id: 'casual_eats_world',
    label: 'Brunch, Lunch & Casual (World Cuisines)',
    appCategory: 'Brunch, Lunch & Casual',
    appCategorySlug: 'brunch_lunch_casual',
    includedTypes: [
      'afghani_restaurant', 'african_restaurant', 'argentinian_restaurant',
      'asian_fusion_restaurant', 'australian_restaurant', 'austrian_restaurant',
      'bangladeshi_restaurant', 'basque_restaurant', 'bavarian_restaurant',
      'belgian_restaurant', 'british_restaurant', 'burmese_restaurant',
      'cajun_restaurant', 'californian_restaurant', 'cambodian_restaurant',
      'cantonese_restaurant', 'chilean_restaurant', 'chinese_noodle_restaurant',
      'colombian_restaurant', 'croatian_restaurant', 'cuban_restaurant',
      'czech_restaurant', 'danish_restaurant', 'dim_sum_restaurant',
      'dumpling_restaurant', 'dutch_restaurant', 'eastern_european_restaurant',
      'european_restaurant', 'family_restaurant', 'filipino_restaurant',
      'fish_and_chips_restaurant', 'halal_restaurant', 'hawaiian_restaurant',
      'hungarian_restaurant', 'irish_restaurant', 'israeli_restaurant',
      'japanese_curry_restaurant', 'latin_american_restaurant',
      'malaysian_restaurant', 'mongolian_barbecue_restaurant',
      'north_indian_restaurant', 'pakistani_restaurant', 'persian_restaurant',
      'polish_restaurant', 'portuguese_restaurant', 'romanian_restaurant',
      'russian_restaurant', 'scandinavian_restaurant', 'soul_food_restaurant',
      'south_american_restaurant',
    ],
    excludedPrimaryTypes: BRUNCH_LUNCH_CASUAL_EXCLUDED,
  },
  // ORCH-0460: Split config #3 — remaining cuisine types. Same exclusion list.
  {
    id: 'casual_eats_extended',
    label: 'Brunch, Lunch & Casual (Extended)',
    appCategory: 'Brunch, Lunch & Casual',
    appCategorySlug: 'brunch_lunch_casual',
    includedTypes: [
      'south_indian_restaurant', 'southwestern_us_restaurant',
      'sri_lankan_restaurant', 'swiss_restaurant', 'taiwanese_restaurant',
      'tex_mex_restaurant', 'tibetan_restaurant', 'tonkatsu_restaurant',
      'ukrainian_restaurant', 'western_restaurant', 'yakiniku_restaurant',
      'yakitori_restaurant', 'burrito_restaurant', 'chicken_wings_restaurant',
      'taco_restaurant',
    ],
    excludedPrimaryTypes: BRUNCH_LUNCH_CASUAL_EXCLUDED,
  },
  {
    id: 'fine_dining',
    label: 'Upscale & Fine Dining',
    appCategory: 'Upscale & Fine Dining',
    appCategorySlug: 'upscale_fine_dining',
    includedTypes: [
      // Existing
      'fine_dining_restaurant', 'french_restaurant', 'italian_restaurant',
      'steak_house', 'seafood_restaurant', 'wine_bar',
      'fondue_restaurant', 'oyster_bar_restaurant',
      // ORCH-0460: expanded cuisine coverage — many upscale restaurants are tagged
      // by Google with cuisine-specific types, not fine_dining_restaurant. AI decides
      // which specific places qualify as upscale via web evidence + auto-promotion.
      'japanese_restaurant', 'persian_restaurant', 'scandinavian_restaurant',
      'argentinian_restaurant', 'basque_restaurant', 'swiss_restaurant',
      'european_restaurant', 'australian_restaurant', 'british_restaurant',
      'greek_restaurant', 'indian_restaurant', 'korean_restaurant',
      'thai_restaurant', 'turkish_restaurant', 'vietnamese_restaurant',
      'spanish_restaurant', 'tapas_restaurant', 'mediterranean_restaurant',
      'brazilian_restaurant', 'peruvian_restaurant', 'moroccan_restaurant',
      'fusion_restaurant', 'gastropub', 'bistro',
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
    label: 'Movies & Theatre',
    appCategory: 'Movies & Theatre',
    appCategorySlug: 'movies_theatre',
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
    label: 'Movies & Theatre',
    appCategory: 'Movies & Theatre',
    appCategorySlug: 'movies_theatre',
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
      // ORCH-0460: golf added — indoor golf simulators (TopGolf-style) and golf courses
      // are date-worthy per category-mapping.md definition of play.
      'golf_course', 'indoor_golf_course',
    ],
    // Google caps excludedPrimaryTypes at 50 items. This list must stay ≤50.
    // Removed from prior revision: `wine_bar` (covered by bar/cocktail_bar/lounge_bar),
    // `art_museum` (covered by museum+art_gallery), `park`/`beach`/`scenic_spot`/
    // `hiking_area`/`national_park` (not in this config's includedTypes so a place
    // primarily typed as one will only match if it also hits an includedType —
    // acceptable), `arena` (play venues are not returned as arena-primary).
    // Current length: 49.
    excludedPrimaryTypes: [
      // Performance (different category)
      'movie_theater', 'performing_arts_theater', 'concert_hall', 'opera_house',
      'philharmonic_hall', 'comedy_club', 'live_music_venue', 'dance_hall',
      // Drink / food
      'bar', 'cocktail_bar', 'lounge_bar', 'night_club',
      'restaurant', 'fine_dining_restaurant', 'fast_food_restaurant',
      'cafe', 'coffee_shop',
      // Arts / museums
      'museum', 'art_gallery',
      // Fitness / corporate / civic
      'gym', 'fitness_center', 'shopping_mall', 'corporate_office',
      'coworking_space', 'convention_center', 'wedding_venue', 'banquet_hall',
      'community_center',
      // Retail / services
      'hotel', 'motel', 'store', 'department_store',
      // ORCH-0460: Sports/recreation (not adult date activities — Bethesda Park type)
      'sports_club', 'sports_activity_location', 'sports_complex',
      'athletic_field', 'swimming_pool', 'tennis_court', 'playground',
      'sports_coaching', 'sports_school', 'stadium', 'race_course',
      // ORCH-0460: Farms/seasonal (Phillips Farms type) + kids venues
      'farm', 'ranch', 'childrens_camp', 'indoor_playground', 'dog_park',
      'campground',
    ],
  },
  // ORCH-0434: Wellness config REMOVED — category no longer exists.
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

/** All category IDs (14 after ORCH-0460 casual_eats split) */
export const ALL_SEEDING_CATEGORY_IDS = SEEDING_CATEGORIES.map(c => c.id);

/** Reverse lookup: appCategorySlug → SeedingCategoryConfig[] (multiple configs can share one app slug) */
export const SEEDING_CATEGORY_MAP_BY_APP_SLUG: Record<string, SeedingCategoryConfig[]> = {};
for (const cat of SEEDING_CATEGORIES) {
  if (!SEEDING_CATEGORY_MAP_BY_APP_SLUG[cat.appCategorySlug]) {
    SEEDING_CATEGORY_MAP_BY_APP_SLUG[cat.appCategorySlug] = [];
  }
  SEEDING_CATEGORY_MAP_BY_APP_SLUG[cat.appCategorySlug].push(cat);
}

/**
 * Resolve category identifiers (old seeding IDs or new app slugs) to configs.
 * Accepts both `nature_views` (old) and `nature` (new) and returns the matching configs.
 * ORCH-0434: Needed because admin sends new app slugs but SEEDING_CATEGORIES uses old IDs.
 */
export function resolveCategoriesToConfigs(ids: string[]): SeedingCategoryConfig[] {
  const configs: SeedingCategoryConfig[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    // Try old seeding ID first
    const direct = SEEDING_CATEGORY_MAP[id];
    if (direct && !seen.has(direct.id)) {
      seen.add(direct.id);
      configs.push(direct);
      continue;
    }
    // Try new app slug (may resolve to multiple seeding configs, e.g. nature → nature_views + picnic_park)
    const byApp = SEEDING_CATEGORY_MAP_BY_APP_SLUG[id];
    if (byApp) {
      for (const c of byApp) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          configs.push(c);
        }
      }
    }
  }
  return configs;
}

/**
 * Resolve a single seeding_category value (from DB) to a config.
 * Handles both old IDs (from legacy batch rows) and new app slugs (from post-migration rows).
 */
export function resolveSeedingCategory(categoryValue: string): SeedingCategoryConfig | undefined {
  return SEEDING_CATEGORY_MAP[categoryValue]
    ?? SEEDING_CATEGORY_MAP_BY_APP_SLUG[categoryValue]?.[0];
}

// ── Invariant validator (runs at module load) ─────────────────────────────────

/**
 * Fail-fast validator. Enforces INV-1..INV-4 at module load so any violation
 * throws before a single seeding batch runs — turning a silent Google 400 or
 * truncation or self-contradiction into a visible deploy-time error.
 *
 *   INV-1: every type ∈ GOOGLE_PLACE_TYPES_TABLE_A
 *   INV-2: array length ≤ GOOGLE_TYPE_RESTRICTION_MAX (50)
 *   INV-3: includedTypes ∩ excludedPrimaryTypes = ∅
 *   INV-4: no duplicate entries within any array
 */
function validateSeedingCategories(configs: readonly SeedingCategoryConfig[]): void {
  const errors: string[] = [];
  for (const c of configs) {
    for (const [field, arr] of [
      ['includedTypes', c.includedTypes] as const,
      ['excludedPrimaryTypes', c.excludedPrimaryTypes] as const,
    ]) {
      if (arr.length > GOOGLE_TYPE_RESTRICTION_MAX) {
        errors.push(
          `[${c.id}] ${field} has ${arr.length} items (max ${GOOGLE_TYPE_RESTRICTION_MAX})`
        );
      }
      const seen = new Set<string>();
      for (const t of arr) {
        if (seen.has(t)) {
          errors.push(`[${c.id}] ${field} contains duplicate: "${t}"`);
        }
        seen.add(t);
        if (!GOOGLE_PLACE_TYPES_TABLE_A.has(t)) {
          errors.push(`[${c.id}] ${field} contains invalid Google type: "${t}"`);
        }
      }
    }
    const includedSet = new Set(c.includedTypes);
    for (const t of c.excludedPrimaryTypes) {
      if (includedSet.has(t)) {
        errors.push(
          `[${c.id}] "${t}" appears in BOTH includedTypes and excludedPrimaryTypes`
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `SEEDING_CATEGORIES invariant violation(s):\n  - ${errors.join('\n  - ')}`
    );
  }
}

validateSeedingCategories(SEEDING_CATEGORIES);
