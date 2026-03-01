import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { searchPlacesWithCache } from '../_shared/placesCache.ts';
import { serveCuratedCardsFromPool, upsertPlaceToPool, insertCardToPool, recordImpressions } from '../_shared/cardPoolService.ts';


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---- Session preference aggregation (for collaboration mode) ----
const SESSION_INTENT_IDS = new Set([
  'solo-adventure', 'first-dates', 'romantic', 'friendly', 'group-fun', 'business',
]);

async function aggregateSessionPreferences(sessionId: string): Promise<{
  budgetMin: number;
  budgetMax: number;
  categories: string[];
  experienceTypes: string[];
  travelMode: string;
  travelConstraintType: string;
  travelConstraintValue: number;
  datetimePref?: string;
  location: { lat: number; lng: number } | null;
}> {
  const { data: allPrefs, error } = await supabaseAdmin
    .from('board_session_preferences')
    .select('*')
    .eq('session_id', sessionId);

  if (error || !allPrefs || allPrefs.length === 0) {
    throw new Error(`No preferences found for session ${sessionId}`);
  }

  // Budget: widest range
  const budgetMin = Math.min(...allPrefs.map(p => p.budget_min ?? 0));
  const budgetMax = Math.max(...allPrefs.map(p => p.budget_max ?? 1000));

  // Categories + experience types: union, then split
  const allCats = new Set<string>();
  allPrefs.forEach(p => {
    if (Array.isArray(p.categories)) p.categories.forEach((c: string) => allCats.add(c));
  });
  const categories = [...allCats].filter(c => !SESSION_INTENT_IDS.has(c));
  const experienceTypes = [...allCats].filter(c => SESSION_INTENT_IDS.has(c));

  // Travel mode: majority vote
  const modeCounts: Record<string, number> = {};
  allPrefs.forEach(p => {
    const m = p.travel_mode || 'walking';
    modeCounts[m] = (modeCounts[m] || 0) + 1;
  });
  const travelMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'walking';

  // Travel constraint: most restrictive
  const constraintTypes: Record<string, number> = {};
  allPrefs.forEach(p => {
    const t = p.travel_constraint_type || 'time';
    constraintTypes[t] = (constraintTypes[t] || 0) + 1;
  });
  const travelConstraintType = Object.entries(constraintTypes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'time';
  const travelConstraintValue = Math.min(
    ...allPrefs.map(p => p.travel_constraint_value ?? 30)
  );

  // Datetime: earliest
  const datetimes = allPrefs.map(p => p.datetime_pref).filter(Boolean).sort();
  const datetimePref = datetimes[0] || undefined;

  // Central location: centroid of all participant locations
  const locations: { lat: number; lng: number }[] = [];
  for (const pref of allPrefs) {
    if (!pref.location) continue;
    const coordMatch = pref.location.trim().match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (!isNaN(lat) && !isNaN(lng)) locations.push({ lat, lng });
    }
  }
  let location: { lat: number; lng: number } | null = null;
  if (locations.length > 0) {
    location = {
      lat: locations.reduce((s, l) => s + l.lat, 0) / locations.length,
      lng: locations.reduce((s, l) => s + l.lng, 0) / locations.length,
    };
  }

  return {
    budgetMin, budgetMax, categories, experienceTypes,
    travelMode, travelConstraintType, travelConstraintValue,
    datetimePref, location,
  };
}

const STOP_DURATION_MINUTES: Record<string, number> = {
  park: 60, botanical_garden: 60, hiking_area: 90, beach: 90,
  zoo: 120, national_park: 90, state_park: 90,
  coffee_shop: 30, tea_house: 30, brunch_restaurant: 60, diner: 45,
  bar: 60, pub: 60, wine_bar: 60, food_court: 30, sandwich_shop: 30,
  seafood_restaurant: 60, vegan_restaurant: 60, pizza_restaurant: 45,
  thai_restaurant: 60, japanese_restaurant: 60, ramen_restaurant: 45,
  korean_restaurant: 60, vietnamese_restaurant: 60, mexican_restaurant: 60,
  american_restaurant: 60, mediterranean_restaurant: 60, italian_restaurant: 75,
  french_restaurant: 90, greek_restaurant: 75, steak_house: 90,
  fine_dining_restaurant: 90, upscale_restaurant: 90, chef_led_restaurant: 90,
  movie_theater: 150, art_gallery: 60, museum: 90, planetarium: 60,
  escape_room: 75, bowling_alley: 60, mini_golf_course: 45, karaoke: 90,
  comedy_club: 90, board_game_cafe: 90, video_arcade: 60,
  rock_climbing_gym: 90, trampoline_park: 60, ice_skating_rink: 60,
  virtual_reality_center: 60, billiards_hall: 60,
  sip_and_paint: 120, pottery: 90, cooking_classes: 120,
  flower_arranging_studio: 60,
};
const DEFAULT_STOP_DURATION = 45;

// Category-based place groupings for dynamic pairing
const PLACE_CATEGORIES: Record<string, string[]> = {
  'outdoor-nature': ['park', 'botanical_garden', 'hiking_area', 'beach', 'zoo', 'national_park', 'state_park', 'pier', 'marina', 'sculpture_garden', 'historic_site'],
  'food-restaurants': ['brunch_restaurant', 'diner', 'seafood_restaurant', 'sandwich_shop', 'vietnamese_restaurant', 'vegan_restaurant', 'thai_restaurant', 'pizza_restaurant', 'mexican_restaurant', 'japanese_restaurant', 'ramen_restaurant', 'korean_restaurant', 'american_restaurant', 'mediterranean_restaurant', 'turkish_restaurant', 'indian_restaurant', 'chinese_restaurant', 'african_restaurant', 'sushi_restaurant', 'barbecue_restaurant', 'breakfast_restaurant', 'french_restaurant', 'hamburger_restaurant', 'lebanese_restaurant', 'buffet_restaurant', 'vegetarian_restaurant', 'spanish_restaurant', 'middle_eastern_restaurant', 'indonesian_restaurant', 'brazilian_restaurant', 'afghani_restaurant', 'greek_restaurant', 'asian_restaurant', 'fast_food_restaurant', 'italian_restaurant', 'fine_dining_restaurant', 'steak_house'],
  'cafes-bars-casual': ['coffee_shop', 'tea_house', 'bar', 'wine_bar', 'pub', 'rooftop_bar', 'whiskey_bar', 'cat_cafe', 'bubble_tea_shop', 'ice_cream_shop', 'dessert_shop', 'food_court', 'food_truck', 'craft_brewery', 'distillery', 'winery'],
  'shopping-markets': ['bookstore', 'thrift_store', 'record_store', 'farmers_market', 'flea_market'],
  'arts-culture': ['art_gallery', 'museum', 'planetarium', 'aquarium', 'library', 'observation_deck'],
  'entertainment-nightlife': ['movie_theater', 'comedy_club', 'karaoke', 'night_club', 'jazz_club', 'live_music_venue', 'casino', 'video_arcade', 'virtual_reality_center', 'board_game_cafe'],
  'active-sports': ['rock_climbing_gym', 'climbing_gym', 'bowling_alley', 'mini_golf_course', 'ice_skating_rink', 'trampoline_park', 'go_kart_track', 'laser_tag_center', 'paintball_center', 'skate_park', 'batting_cage', 'driving_range', 'amusement_park', 'theme_park', 'waterpark', 'axe_throwing', 'swimming_pool', 'ferris_wheel'],
  'wellness-relaxation': ['spa', 'massage', 'sauna', 'hot_spring', 'yoga_studio'],
  'creative-workshops': ['sip_and_paint', 'pottery_studio', 'cooking_class', 'glass_blowing_studio', 'escape_room'],
};

// ── Turbo Pipeline: 4 super-categories for solo-adventure (replaces 45-call approach) ──
const ADVENTURE_SUPER_CATEGORIES: Record<string, {
  includedTypes: string[];
  label: string;
}> = {
  'outdoor-nature': {
    includedTypes: ['park', 'botanical_garden', 'hiking_area', 'beach', 'national_park', 'state_park', 'wildlife_park'],
    label: 'outdoor-nature',
  },
  'active-recreation': {
    includedTypes: ['zoo', 'amusement_park', 'bowling_alley', 'spa', 'gym', 'swimming_pool'],
    label: 'active-recreation',
  },
  'food-dining': {
    includedTypes: ['restaurant', 'cafe', 'bakery', 'ice_cream_shop', 'pizza_restaurant', 'ramen_restaurant', 'seafood_restaurant'],
    label: 'food-restaurants',
  },
  'drink-social': {
    includedTypes: ['bar', 'wine_bar', 'pub', 'coffee_shop', 'tea_house', 'night_club'],
    label: 'cafes-bars-casual',
  },
  'culture-arts': {
    includedTypes: ['art_gallery', 'museum', 'performing_arts_theater', 'library'],
    label: 'culture-arts',
  },
  'entertainment': {
    includedTypes: ['movie_theater', 'shopping_mall', 'book_store', 'tourist_attraction'],
    label: 'entertainment',
  },
};

const CATEGORY_NAMES = Object.keys(PLACE_CATEGORIES);

// ── Mapping from user-preference category IDs to allowed Google Place types ──
// When users select categories in Preferences (e.g. nature, drink, play), this
// map translates those IDs into the concrete Place types we should search for.
const USER_CATEGORY_TO_PLACE_TYPES: Record<string, string[]> = {
  'nature':       ['park', 'botanical_garden', 'hiking_area', 'national_park', 'state_park', 'beach', 'zoo', 'wildlife_park'],
  'first_meet':   ['coffee_shop', 'tea_house', 'bar', 'wine_bar', 'ice_cream_shop', 'bakery_workshop'],
  'picnic':       ['park', 'botanical_garden', 'beach', 'national_park', 'state_park'],
  'drink':        ['bar', 'wine_bar', 'pub', 'coffee_shop', 'tea_house', 'night_club', 'rooftop_bar', 'whiskey_bar', 'craft_brewery', 'distillery', 'winery'],
  'casual_eats':  ['restaurant', 'pizza_restaurant', 'ramen_restaurant', 'fast_food_restaurant', 'hamburger_restaurant', 'diner', 'food_court', 'sandwich_shop', 'food_truck', 'brunch_restaurant', 'breakfast_restaurant', 'mexican_restaurant', 'chinese_restaurant', 'thai_restaurant', 'vietnamese_restaurant', 'korean_restaurant', 'japanese_restaurant', 'indian_restaurant', 'mediterranean_restaurant', 'american_restaurant', 'italian_restaurant', 'asian_restaurant', 'buffet_restaurant', 'barbecue_restaurant', 'seafood_restaurant', 'vegan_restaurant', 'vegetarian_restaurant', 'sushi_restaurant', 'greek_restaurant', 'turkish_restaurant', 'lebanese_restaurant', 'middle_eastern_restaurant', 'indonesian_restaurant', 'brazilian_restaurant', 'african_restaurant', 'afghani_restaurant', 'spanish_restaurant', 'french_restaurant', 'steak_house', 'cafe', 'bakery'],
  'fine_dining':  ['fine_dining_restaurant', 'steak_house', 'french_restaurant', 'seafood_restaurant'],
  'watch':        ['movie_theater', 'comedy_club', 'live_music_venue', 'jazz_club', 'performing_arts_theater'],
  'creative_arts':['art_gallery', 'museum', 'sip_and_paint', 'pottery_studio', 'cooking_class', 'glass_blowing_studio', 'planetarium', 'library'],
  'play':         ['bowling_alley', 'mini_golf_course', 'video_arcade', 'escape_room', 'trampoline_park', 'laser_tag_center', 'go_kart_track', 'amusement_park', 'theme_park', 'axe_throwing', 'rock_climbing_gym', 'ice_skating_rink', 'karaoke', 'board_game_cafe', 'paintball_center', 'virtual_reality_center', 'swimming_pool', 'skate_park', 'batting_cage', 'driving_range'],
  'wellness':     ['spa', 'massage', 'sauna', 'hot_spring', 'yoga_studio'],
};

/** Build a Set of allowed Place types from user-selected categories. Returns null if no filtering needed. */
function buildAllowedPlaceTypes(selectedCategories?: string[]): Set<string> | null {
  if (!selectedCategories || selectedCategories.length === 0) return null;
  const allowed = new Set<string>();
  for (const cat of selectedCategories) {
    const types = USER_CATEGORY_TO_PLACE_TYPES[cat];
    if (types) types.forEach(t => allowed.add(t));
  }
  return allowed.size > 0 ? allowed : null;
}

// Generate all 3-category combinations (C(9,3) = 84 combinations)
function generateCategoryCombinations(): string[][] {
  const combinations: string[][] = [];
  for (let i = 0; i < CATEGORY_NAMES.length; i++) {
    for (let j = i + 1; j < CATEGORY_NAMES.length; j++) {
      for (let k = j + 1; k < CATEGORY_NAMES.length; k++) {
        combinations.push([CATEGORY_NAMES[i], CATEGORY_NAMES[j], CATEGORY_NAMES[k]]);
      }
    }
  }
  return combinations;
}

// Kept for backwards compatibility with other experience types
const SOLO_ADVENTURE_PAIRINGS: [string, string, string][] = [];

const FIRST_DATES_PAIRINGS: [string, string, string][] = [
  ["botanical_garden", "wine_bar", "sip_and_paint"],
  ["art_gallery", "french_restaurant", "comedy_club"],
  ["museum", "coffee_shop", "sip_and_paint"],
  ["botanical_garden", "brunch_restaurant", "pottery"],
  ["tea_house", "japanese_restaurant", "board_game_cafe"],
  ["park", "wine_bar", "pottery"],
  ["art_gallery", "brunch_restaurant", "comedy_club"],
  ["botanical_garden", "italian_restaurant", "sip_and_paint"],
  ["museum", "wine_bar", "comedy_club"],
  ["park", "coffee_shop", "board_game_cafe"],
  ["botanical_garden", "french_restaurant", "comedy_club"],
  ["art_gallery", "tea_house", "pottery"],
  ["museum", "brunch_restaurant", "sip_and_paint"],
  ["park", "japanese_restaurant", "comedy_club"],
  ["botanical_garden", "coffee_shop", "pottery"],
];

const ROMANTIC_PAIRINGS: [string, string, string][] = [
  ["botanical_garden", "fine_dining_restaurant", "stargazing_spot"],
  ["beach", "wine_bar", "spa"],
  ["park", "french_restaurant", "sip_and_paint"],
  ["botanical_garden", "italian_restaurant", "hot_spring"],
  ["beach", "fine_dining_restaurant", "stargazing_spot"],
  ["botanical_garden", "wine_bar", "spa"],
  ["park", "fine_dining_restaurant", "sip_and_paint"],
  ["beach", "italian_restaurant", "stargazing_spot"],
  ["botanical_garden", "french_restaurant", "hot_spring"],
  ["park", "wine_bar", "pottery"],
  ["botanical_garden", "steak_house", "stargazing_spot"],
  ["beach", "wine_bar", "sip_and_paint"],
  ["park", "italian_restaurant", "spa"],
  ["botanical_garden", "seafood_restaurant", "stargazing_spot"],
  ["beach", "french_restaurant", "hot_spring"],
];

const FRIENDLY_PAIRINGS: [string, string, string][] = [
  ["bowling_alley", "pizza_restaurant", "bar"],
  ["escape_room", "american_restaurant", "comedy_club"],
  ["hiking_area", "sandwich_shop", "bar"],
  ["mini_golf_course", "hamburger_restaurant", "bar"],
  ["bowling_alley", "american_restaurant", "karaoke"],
  ["escape_room", "pizza_restaurant", "bar"],
  ["hiking_area", "diner", "comedy_club"],
  ["mini_golf_course", "pizza_restaurant", "karaoke"],
  ["bowling_alley", "hamburger_restaurant", "comedy_club"],
  ["escape_room", "sandwich_shop", "karaoke"],
  ["hiking_area", "american_restaurant", "bar"],
  ["mini_golf_course", "diner", "bar"],
  ["bowling_alley", "fast_food_restaurant", "karaoke"],
  ["escape_room", "hamburger_restaurant", "comedy_club"],
  ["hiking_area", "pizza_restaurant", "karaoke"],
];

const GROUP_FUN_PAIRINGS: [string, string, string][] = [
  ["bowling_alley", "fast_food_restaurant", "karaoke"],
  ["video_arcade", "pizza_restaurant", "bar"],
  ["trampoline_park", "buffet_restaurant", "comedy_club"],
  ["laser_tag_center", "food_court", "karaoke"],
  ["bowling_alley", "pizza_restaurant", "comedy_club"],
  ["video_arcade", "hamburger_restaurant", "karaoke"],
  ["trampoline_park", "fast_food_restaurant", "bar"],
  ["laser_tag_center", "pizza_restaurant", "bar"],
  ["bowling_alley", "food_court", "comedy_club"],
  ["video_arcade", "buffet_restaurant", "karaoke"],
  ["trampoline_park", "pizza_restaurant", "comedy_club"],
  ["laser_tag_center", "hamburger_restaurant", "bar"],
  ["bowling_alley", "buffet_restaurant", "karaoke"],
  ["video_arcade", "food_court", "comedy_club"],
  ["trampoline_park", "hamburger_restaurant", "karaoke"],
];

const PAIRINGS_BY_TYPE: Record<string, [string, string, string][]> = {
  'solo-adventure': SOLO_ADVENTURE_PAIRINGS, // Will be generated dynamically
  'first-dates':    FIRST_DATES_PAIRINGS,
  'romantic':       ROMANTIC_PAIRINGS,
  'friendly':       FRIENDLY_PAIRINGS,
  'group-fun':      GROUP_FUN_PAIRINGS,
};

const TAGLINES_BY_TYPE: Record<string, string[]> = {
  'solo-adventure': [
    'Explore the unexpected — your next discovery awaits',
    'Three stops, endless possibilities',
    'Chart your own path through the city',
    'For the curious soul who loves to wander',
  ],
  'first-dates': [
    'A thoughtful route for a great first impression',
    'Three stops to break the ice',
    'An effortless plan for getting to know someone',
    'Low pressure, high adventure',
  ],
  'romantic': [
    'A curated route for two',
    'Three stops to make the night unforgettable',
    'Romance awaits around every corner',
    'Set the mood with a plan worth sharing',
  ],
  'friendly': [
    'A day out worth catching up over',
    'Three stops, good company, great vibes',
    'The kind of plan friends remember',
    'Explore together, no planning needed',
  ],
  'group-fun': [
    'Rally the crew — adventure is calling',
    'Three stops of pure group energy',
    'Good times are better together',
    'A plan the whole squad will love',
  ],
  'business': [
    'A polished route for professional connections',
    'Three stops to impress and connect',
    'Networking meets exploration',
    'A curated outing for business minds',
  ],
};

const DEFAULT_TAGLINES = TAGLINES_BY_TYPE['solo-adventure'];

type PlaceSearchConfig =
  | { strategy: 'nearby'; includedType: string }
  | { strategy: 'text'; textQuery: string };

const PLACE_TYPE_SEARCH_CONFIG: Record<string, PlaceSearchConfig> = {
  park:                      { strategy: 'nearby', includedType: 'park' },
  coffee_shop:               { strategy: 'nearby', includedType: 'coffee_shop' },
  movie_theater:             { strategy: 'nearby', includedType: 'movie_theater' },
  botanical_garden:          { strategy: 'nearby', includedType: 'botanical_garden' },
  art_gallery:               { strategy: 'nearby', includedType: 'art_gallery' },
  hiking_area:               { strategy: 'nearby', includedType: 'hiking_area' },
  diner:                     { strategy: 'nearby', includedType: 'diner' },
  bowling_alley:             { strategy: 'nearby', includedType: 'bowling_alley' },
  beach:                     { strategy: 'nearby', includedType: 'beach' },
  seafood_restaurant:        { strategy: 'nearby', includedType: 'seafood_restaurant' },
  zoo:                       { strategy: 'nearby', includedType: 'zoo' },
  food_court:                { strategy: 'nearby', includedType: 'food_court' },
  national_park:             { strategy: 'nearby', includedType: 'national_park' },
  sandwich_shop:             { strategy: 'nearby', includedType: 'sandwich_shop' },
  planetarium:               { strategy: 'nearby', includedType: 'planetarium' },
  state_park:                { strategy: 'nearby', includedType: 'state_park' },
  vietnamese_restaurant:     { strategy: 'nearby', includedType: 'vietnamese_restaurant' },
  museum:                    { strategy: 'nearby', includedType: 'museum' },
  vegan_restaurant:          { strategy: 'nearby', includedType: 'vegan_restaurant' },
  bar:                       { strategy: 'nearby', includedType: 'bar' },
  comedy_club:               { strategy: 'nearby', includedType: 'comedy_club' },
  thai_restaurant:           { strategy: 'nearby', includedType: 'thai_restaurant' },
  pizza_restaurant:          { strategy: 'nearby', includedType: 'pizza_restaurant' },
  wine_bar:                  { strategy: 'nearby', includedType: 'wine_bar' },
  mexican_restaurant:        { strategy: 'nearby', includedType: 'mexican_restaurant' },
  japanese_restaurant:       { strategy: 'nearby', includedType: 'japanese_restaurant' },
  ramen_restaurant:          { strategy: 'nearby', includedType: 'ramen_restaurant' },
  korean_restaurant:         { strategy: 'nearby', includedType: 'korean_restaurant' },
  ice_skating_rink:          { strategy: 'nearby', includedType: 'ice_skating_rink' },
  pub:                       { strategy: 'nearby', includedType: 'pub' },
  american_restaurant:       { strategy: 'nearby', includedType: 'american_restaurant' },
  trampoline_park:           { strategy: 'nearby', includedType: 'trampoline_park' },
  mediterranean_restaurant:  { strategy: 'nearby', includedType: 'mediterranean_restaurant' },
  turkish_restaurant:        { strategy: 'nearby', includedType: 'turkish_restaurant' },
  indian_restaurant:         { strategy: 'nearby', includedType: 'indian_restaurant' },
  chinese_restaurant:        { strategy: 'nearby', includedType: 'chinese_restaurant' },
  sushi_restaurant:          { strategy: 'nearby', includedType: 'sushi_restaurant' },
  sauna:                     { strategy: 'nearby', includedType: 'sauna' },
  barbecue_restaurant:       { strategy: 'nearby', includedType: 'barbecue_restaurant' },
  breakfast_restaurant:      { strategy: 'nearby', includedType: 'breakfast_restaurant' },
  french_restaurant:         { strategy: 'nearby', includedType: 'french_restaurant' },
  hamburger_restaurant:      { strategy: 'nearby', includedType: 'hamburger_restaurant' },
  vegetarian_restaurant:     { strategy: 'nearby', includedType: 'vegetarian_restaurant' },
  hot_spring:                { strategy: 'nearby', includedType: 'hot_spring' },
  middle_eastern_restaurant: { strategy: 'nearby', includedType: 'middle_eastern_restaurant' },
  indonesian_restaurant:     { strategy: 'nearby', includedType: 'indonesian_restaurant' },
  brazilian_restaurant:      { strategy: 'nearby', includedType: 'brazilian_restaurant' },
  greek_restaurant:          { strategy: 'nearby', includedType: 'greek_restaurant' },
  fast_food_restaurant:      { strategy: 'nearby', includedType: 'fast_food_restaurant' },
  skate_park:                { strategy: 'nearby', includedType: 'skate_park' },
  italian_restaurant:        { strategy: 'nearby', includedType: 'italian_restaurant' },
  spa:                       { strategy: 'nearby', includedType: 'spa' },
  spanish_restaurant:        { strategy: 'nearby', includedType: 'spanish_restaurant' },
  brunch_restaurant:         { strategy: 'text', textQuery: 'brunch restaurant' },
  sip_and_paint:             { strategy: 'text', textQuery: 'sip and paint studio' },
  escape_room:               { strategy: 'text', textQuery: 'escape room' },
  tea_house:                 { strategy: 'text', textQuery: 'tea house' },
  pottery:                   { strategy: 'text', textQuery: 'pottery class studio' },
  cooking_classes:           { strategy: 'text', textQuery: 'cooking class' },
  board_game_cafe:           { strategy: 'text', textQuery: 'board game cafe' },
  karaoke:                   { strategy: 'text', textQuery: 'karaoke bar' },
  rock_climbing_gym:         { strategy: 'text', textQuery: 'rock climbing gym' },
  virtual_reality_center:    { strategy: 'text', textQuery: 'virtual reality arcade' },
  video_arcade:              { strategy: 'text', textQuery: 'video arcade' },
  billiards_hall:            { strategy: 'text', textQuery: 'billiards pool hall' },
  flower_arranging_studio:   { strategy: 'text', textQuery: 'flower arranging workshop' },
  glass_blowing_studio:      { strategy: 'text', textQuery: 'glass blowing studio' },
  perfume_lab:               { strategy: 'text', textQuery: 'perfume making workshop' },
  laser_tag_center:          { strategy: 'text', textQuery: 'laser tag' },
  african_restaurant:        { strategy: 'text', textQuery: 'african restaurant' },
  photography_walk:          { strategy: 'text', textQuery: 'photography tour' },
  dart_bar:                  { strategy: 'text', textQuery: 'darts bar' },
  jewelry_making_studio:     { strategy: 'text', textQuery: 'jewelry making class' },
  go_kart_track:             { strategy: 'text', textQuery: 'go kart track' },
  lebanese_restaurant:       { strategy: 'text', textQuery: 'lebanese restaurant' },
  float_tank_center:         { strategy: 'text', textQuery: 'float tank sensory deprivation' },
  adventure_park:            { strategy: 'text', textQuery: 'adventure park' },
  sewing_class:              { strategy: 'text', textQuery: 'sewing class' },
  bakery_workshop:           { strategy: 'text', textQuery: 'baking workshop' },
  woodworking_class:         { strategy: 'text', textQuery: 'woodworking class' },
  paintball_center:          { strategy: 'text', textQuery: 'paintball' },
  afghani_restaurant:        { strategy: 'text', textQuery: 'afghan restaurant' },
  cold_plunge_facility:      { strategy: 'text', textQuery: 'cold plunge ice bath' },
  stargazing_spot:           { strategy: 'text', textQuery: 'observatory stargazing' },
  fine_dining_restaurant:    { strategy: 'nearby', includedType: 'fine_dining_restaurant' },
  steak_house:               { strategy: 'text', textQuery: 'steakhouse' },
  mini_golf_course:          { strategy: 'text', textQuery: 'mini golf' },
  asian_restaurant:          { strategy: 'text', textQuery: 'asian restaurant' },
  buffet_restaurant:         { strategy: 'text', textQuery: 'buffet restaurant' },
};

const PRICE_LEVEL_RANGES: Record<string, { min: number; max: number }> = {
  PRICE_LEVEL_FREE:           { min: 0,  max: 0  },
  PRICE_LEVEL_INEXPENSIVE:    { min: 5,  max: 15 },
  PRICE_LEVEL_MODERATE:       { min: 15, max: 35 },
  PRICE_LEVEL_EXPENSIVE:      { min: 35, max: 75 },
  PRICE_LEVEL_VERY_EXPENSIVE: { min: 75, max: 150 },
};

function priceLevelToRange(level: string | undefined): { min: number; max: number } {
  return PRICE_LEVEL_RANGES[level ?? ''] ?? { min: 0, max: 20 };
}

function priceLevelToLabel(level: string | undefined): string {
  const map: Record<string, string> = {
    PRICE_LEVEL_FREE:           'Free',
    PRICE_LEVEL_INEXPENSIVE:    '$',
    PRICE_LEVEL_MODERATE:       '$$',
    PRICE_LEVEL_EXPENSIVE:      '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  };
  return map[level ?? ''] ?? '$$';
}

function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const PLACES_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,' +
  'places.rating,places.userRatingCount,places.priceLevel,' +
  'places.types,places.primaryType,' +
  'places.regularOpeningHours,places.websiteUri,places.photos';

async function searchNearby(includedType: string, lat: number, lng: number, radiusMeters: number): Promise<any[]> {
  const { places } = await searchPlacesWithCache({
    supabaseAdmin,
    apiKey: GOOGLE_PLACES_API_KEY,
    placeType: includedType,
    lat,
    lng,
    radiusMeters,
    maxResults: 5,
    strategy: 'nearby',
    ttlHours: 24,
  });
  return places;
}

async function searchByText(textQuery: string, lat: number, lng: number, radiusMeters: number): Promise<any[]> {
  const { places } = await searchPlacesWithCache({
    supabaseAdmin,
    apiKey: GOOGLE_PLACES_API_KEY,
    placeType: textQuery.replace(/\s+/g, '_').toLowerCase(),
    lat,
    lng,
    radiusMeters,
    maxResults: 5,
    strategy: 'text',
    textQuery,
    ttlHours: 24,
  });
  return places;
}

// ── Turbo Pipeline: Fetch places via 4 super-category Nearby Search calls ──
async function fetchPlacesBySuperCategory(
  lat: number, lng: number, radiusMeters: number
): Promise<Record<string, any[]>> {
  const results: Record<string, any[]> = {};

  // Check curated_places_cache first (reuse existing cache mechanism)
  const locationKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const radiusBucket = Math.round(radiusMeters / 1000) * 1000;
  const cacheKey = `turbo_${locationKey}_${radiusBucket}`;

  try {
    const { data: cached } = await supabaseAdmin
      .from('curated_places_cache')
      .select('category_places')
      .eq('location_key', cacheKey)
      .eq('radius_m', radiusBucket)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .maybeSingle();

    if (cached?.category_places) {
      console.log('[turbo] Cache HIT for', cacheKey);
      return cached.category_places as Record<string, any[]>;
    }
  } catch (err) {
    console.warn('[turbo] Cache read failed:', err);
  }

  console.log('[turbo] Cache MISS — firing 4 super-category API calls');

  // Fire 4 parallel Nearby Search calls with combined includedTypes
  await Promise.all(
    Object.entries(ADVENTURE_SUPER_CATEGORIES).map(async ([superCat, config]) => {
      try {
        const response = await fetch(
          'https://places.googleapis.com/v1/places:searchNearby',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
              'X-Goog-FieldMask': PLACES_FIELD_MASK,
            },
            body: JSON.stringify({
              includedTypes: config.includedTypes,
              maxResultCount: 20,
              locationRestriction: {
                circle: {
                  center: { latitude: lat, longitude: lng },
                  radius: Math.min(radiusMeters, 50000),
                },
              },
              rankPreference: 'POPULARITY',
            }),
          }
        );
        const data = await response.json();
        results[superCat] = (data.places || [])
          .filter((p: any) => {
            // Filter out gyms/fitness from results
            const name = p.displayName?.text || '';
            const primary = p.primaryType || '';
            const excluded = /\b(gym|fitness|crossfit)\b/i;
            return !excluded.test(name) && !excluded.test(primary);
          })
          .map((p: any) => ({
            ...p,
            placeType: p.primaryType || config.includedTypes[0],
            superCategory: superCat,
          }));
      } catch (err) {
        console.warn(`[turbo] Failed to fetch ${superCat}:`, err);
        results[superCat] = [];
      }
    })
  );

  const summary = Object.entries(results)
    .map(([cat, places]) => `${cat}: ${places.length}`)
    .join(', ');
  console.log(`[turbo] Fetched: ${summary}`);

  // Cache results (fire-and-forget)
  supabaseAdmin
    .from('curated_places_cache')
    .upsert({
      location_key: cacheKey,
      radius_m: radiusBucket,
      category_places: results,
      created_at: new Date().toISOString(),
    })
    .then(() => console.log('[turbo] Cached for', cacheKey))
    .catch((err: any) => console.warn('[turbo] Cache write failed:', err));

  return results;
}

// ── Turbo Pipeline: Build triads from super-category place pools ──
function buildTriadsFromSuperCategories(
  superCatPlaces: Record<string, any[]>,
  limit: number,
  budgetMax: number,
  travelMode: string,
  userLat: number,
  userLng: number,
  travelConstraintType: string,
  travelConstraintValue: number,
  targetDatetime: Date,
  experienceType: string,
  skipDescriptions: boolean,
  batchSeed: number = 0,
): any[] {
  const superCatNames = Object.keys(superCatPlaces).filter(
    k => superCatPlaces[k].length > 0
  );
  if (superCatNames.length < 3) {
    console.warn('[turbo] Only', superCatNames.length, 'super-categories have results');
    return [];
  }

  // Generate all C(n,3) triad patterns
  const patterns: [string, string, string][] = [];
  for (let i = 0; i < superCatNames.length; i++)
    for (let j = i + 1; j < superCatNames.length; j++)
      for (let k = j + 1; k < superCatNames.length; k++)
        patterns.push([superCatNames[i], superCatNames[j], superCatNames[k]]);

  const shuffledPatterns = shuffle(patterns);
  const triads: any[] = [];
  const usedTriadKeys = new Set<string>();     // dedup on full 3-place combo, not individual places
  const placeUsageCount = new Map<string, number>(); // cap per-place reuse for variety
  const MAX_PLACE_REUSE = 4;
  const perStopBudget = budgetMax > 0 ? Math.ceil(budgetMax / 3) : Infinity;

  // Speed config for travel constraint
  const speedKmh: Record<string, number> = {
    walking: 4.5, driving: 35, transit: 20, biking: 14, bicycling: 14,
  };
  const maxDistKm = travelConstraintType === 'time'
    ? (travelConstraintValue / 60) * (speedKmh[travelMode] || 4.5) * 1.3
    : travelConstraintValue;

  let patternIdx = 0;
  let totalAttempts = 0;
  const MAX_ATTEMPTS = limit * 20;

  while (triads.length < limit && totalAttempts < MAX_ATTEMPTS) {
    const pattern = shuffledPatterns[patternIdx % shuffledPatterns.length];
    patternIdx++;
    totalAttempts++;

    const [cat1, cat2, cat3] = pattern;

    // Filter available places (reuse-capped, affordable, open)
    const isUsable = (p: any) =>
      p.id &&
      (placeUsageCount.get(p.id) ?? 0) < MAX_PLACE_REUSE &&
      priceLevelToRange(p.priceLevel).min <= perStopBudget &&
      isPlaceOpenAt(p, targetDatetime);

    const pool1 = superCatPlaces[cat1].filter(isUsable);
    const pool2 = superCatPlaces[cat2].filter(isUsable);
    const pool3 = superCatPlaces[cat3].filter(isUsable);

    if (!pool1.length || !pool2.length || !pool3.length) continue;

    // Pick from pool using seeded randomness for batch diversity
    // Each batchSeed produces a completely different selection pattern
    const pick = (pool: any[], salt: number) => {
      // Seeded hash: combine batchSeed, salt, and attempt counter for deterministic-yet-varied picks
      const hash = ((batchSeed * 2654435761 + salt * 40503 + totalAttempts * 12979) >>> 0);
      const idx = hash % pool.length;
      return pool[idx];
    };
    const p1 = pick(pool1, 1);
    const p2 = pick(pool2, 2);
    const p3 = pick(pool3, 3);
    // Travel constraint: first stop must be reachable
    const p1Lat = p1.location?.latitude ?? userLat;
    const p1Lng = p1.location?.longitude ?? userLng;
    const distToFirst = haversineKm(userLat, userLng, p1Lat, p1Lng);
    if (distToFirst > maxDistKm) continue;

    // Dedup on the full triad combination (not individual places)
    const triadKey = [p1.id, p2.id, p3.id].sort().join('|');
    if (usedTriadKeys.has(triadKey)) continue;
    usedTriadKeys.add(triadKey);
    placeUsageCount.set(p1.id, (placeUsageCount.get(p1.id) ?? 0) + 1);
    placeUsageCount.set(p2.id, (placeUsageCount.get(p2.id) ?? 0) + 1);
    placeUsageCount.set(p3.id, (placeUsageCount.get(p3.id) ?? 0) + 1);

    // Build stops (same structure as resolvePairingFromCategories)
    const selectedPlaces = [p1, p2, p3];
    const stops = selectedPlaces.map((place, idx) => {
      const placeType = place.placeType || place.primaryType || '';
      const priceRange = priceLevelToRange(place.priceLevel);
      const { hours, isOpenNow } = parseOpeningHours(place);
      const lat = place.location?.latitude ?? userLat;
      const lng = place.location?.longitude ?? userLng;
      const distKm = haversineKm(userLat, userLng, lat, lng);
      const travelTimeFromUser = estimateTravelMinutes(distKm, travelMode);
      const stopLabels = ['Start Here', 'Then', 'End With'] as const;
      const prevLat = idx > 0 ? (selectedPlaces[idx - 1].location?.latitude ?? userLat) : null;
      const prevLng = idx > 0 ? (selectedPlaces[idx - 1].location?.longitude ?? userLng) : null;
      const interStopDist = prevLat !== null
        ? haversineKm(prevLat!, prevLng!, lat, lng)
        : null;
      const interStopTime = interStopDist !== null
        ? estimateTravelMinutes(interStopDist, travelMode)
        : null;

      return {
        stopNumber: idx + 1,
        stopLabel: stopLabels[idx],
        placeId: place.id ?? '',
        placeName: place.displayName?.text ?? '',
        placeType,
        address: place.formattedAddress ?? '',
        rating: place.rating ?? 0,
        reviewCount: place.userRatingCount ?? 0,
        imageUrl: getPhotoUrl(place),
        priceLevelLabel: priceLevelToLabel(place.priceLevel),
        priceMin: priceRange.min,
        priceMax: priceRange.max,
        openingHours: hours,
        isOpenNow,
        website: place.websiteUri ?? null,
        lat,
        lng,
        distanceFromUserKm: Math.round(distKm * 10) / 10,
        travelTimeFromUserMin: travelTimeFromUser,
        travelTimeFromPreviousStopMin: interStopTime,
        travelModeFromPreviousStop: idx > 0 ? travelMode : null,
        aiDescription: `A great ${placeType.replace(/_/g, ' ')} spot for your adventure.`,
        estimatedDurationMinutes: STOP_DURATION_MINUTES[placeType] || DEFAULT_STOP_DURATION,
      };
    });

    // Budget enforcement
    const totalPriceMin = stops.reduce((s, st) => s + st.priceMin, 0);
    if (budgetMax > 0 && totalPriceMin > budgetMax) continue;

    const totalPriceMax = stops.reduce((s, st) => s + st.priceMax, 0);
    const totalDuration = stops.reduce((s, st) => s + st.estimatedDurationMinutes, 0)
      + (stops[1]?.travelTimeFromPreviousStopMin ?? 0)
      + (stops[2]?.travelTimeFromPreviousStopMin ?? 0);
    const avgRating = stops.reduce((s, st) => s + st.rating, 0) / 3;

    const pairingKey = [cat1, cat2, cat3].sort().join('+');
    const taglines = TAGLINES_BY_TYPE[experienceType] || DEFAULT_TAGLINES;
    const shortNames = stops.map(s => s.placeName.split(' ').slice(0, 2).join(' '));

    triads.push({
      id: `curated-${Date.now()}-${triads.length}-${Math.random().toString(36).slice(2, 8)}`,
      cardType: 'curated',
      experienceType,
      pairingKey,
      title: shortNames.join(' \u2192 '),
      tagline: taglines[Math.floor(Math.random() * taglines.length)],
      stops,
      totalPriceMin,
      totalPriceMax,
      estimatedDurationMinutes: totalDuration,
      matchScore: Math.round(avgRating * 20),
    });
  }

  const uniquePlaces = new Set<string>();
  for (const t of triads) for (const s of t.stops) uniquePlaces.add(s.placeId);
  console.log(`[turbo] Built ${triads.length} triads from ${uniquePlaces.size} unique places (${totalAttempts} attempts, ${usedTriadKeys.size} unique combos)`);
  return triads;
}

// ── Single-stop cards: For category-filtered queries with < 3 super-categories ──
// When a user selects a specific category (e.g. Nature), filtered places may only
// land in 1-2 super-categories, which is too few for 3-stop triads.  Instead we
// build one card per place — still using `cardType: 'curated'` so the front-end
// renders them with the same design (image, description, policies & reservations).
function buildSingleStopCards(
  superCatPlaces: Record<string, any[]>,
  limit: number,
  budgetMax: number,
  travelMode: string,
  userLat: number,
  userLng: number,
  travelConstraintType: string,
  travelConstraintValue: number,
  targetDatetime: Date,
  experienceType: string,
  categoryLabel: string,
  batchSeed: number = 0,
): any[] {
  // Flatten and dedup all places across super-categories
  const seen = new Set<string>();
  const allPlaces: any[] = [];
  for (const places of Object.values(superCatPlaces)) {
    for (const p of places) {
      if (p.id && !seen.has(p.id)) {
        seen.add(p.id);
        allPlaces.push(p);
      }
    }
  }

  // Speed config for travel constraint
  const speedKmh: Record<string, number> = {
    walking: 4.5, driving: 35, transit: 20, biking: 14, bicycling: 14,
  };
  const maxDistKm = travelConstraintType === 'time'
    ? (travelConstraintValue / 60) * (speedKmh[travelMode] || 4.5) * 1.3
    : travelConstraintValue;

  // Filter: budget, open-at-time, travel constraint
  const filtered = allPlaces.filter(p => {
    const priceRange = priceLevelToRange(p.priceLevel);
    if (budgetMax > 0 && priceRange.min > budgetMax) return false;
    if (!isPlaceOpenAt(p, targetDatetime)) return false;
    const lat = p.location?.latitude ?? userLat;
    const lng = p.location?.longitude ?? userLng;
    if (haversineKm(userLat, userLng, lat, lng) > maxDistKm) return false;
    return true;
  });

  // Seeded shuffle so each batchSeed produces a different ordering
  const seededShuffle = <T,>(arr: T[]): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const hash = ((batchSeed * 2654435761 + i * 40503) >>> 0);
      const j = hash % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const shuffled = seededShuffle(filtered);
  const selected = shuffled.slice(0, limit);

  const taglines = TAGLINES_BY_TYPE[experienceType] || DEFAULT_TAGLINES;

  const cards = selected.map((place, idx) => {
    const placeType = place.placeType || place.primaryType || '';
    const priceRange = priceLevelToRange(place.priceLevel);
    const { hours, isOpenNow } = parseOpeningHours(place);
    const lat = place.location?.latitude ?? userLat;
    const lng = place.location?.longitude ?? userLng;
    const distKm = haversineKm(userLat, userLng, lat, lng);
    const travelTime = estimateTravelMinutes(distKm, travelMode);

    const stop = {
      stopNumber: 1,
      stopLabel: 'Explore' as const,
      placeId: place.id ?? '',
      placeName: place.displayName?.text ?? '',
      placeType,
      address: place.formattedAddress ?? '',
      rating: place.rating ?? 0,
      reviewCount: place.userRatingCount ?? 0,
      imageUrl: getPhotoUrl(place),
      priceLevelLabel: priceLevelToLabel(place.priceLevel),
      priceMin: priceRange.min,
      priceMax: priceRange.max,
      openingHours: hours,
      isOpenNow,
      website: place.websiteUri ?? null,
      lat,
      lng,
      distanceFromUserKm: Math.round(distKm * 10) / 10,
      travelTimeFromUserMin: travelTime,
      travelTimeFromPreviousStopMin: null,
      travelModeFromPreviousStop: null,
      aiDescription: `A great ${placeType.replace(/_/g, ' ')} spot to explore.`,
      estimatedDurationMinutes: STOP_DURATION_MINUTES[placeType] || DEFAULT_STOP_DURATION,
    };

    return {
      id: `curated-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
      cardType: 'curated',
      experienceType,
      pairingKey: placeType,
      title: place.displayName?.text ?? 'Nature Spot',
      tagline: taglines[Math.floor(Math.random() * taglines.length)],
      categoryLabel,
      stops: [stop],
      totalPriceMin: priceRange.min,
      totalPriceMax: priceRange.max,
      estimatedDurationMinutes: stop.estimatedDurationMinutes,
      matchScore: Math.round((place.rating ?? 3.5) * 20),
    };
  });

  console.log(`[turbo-single] Built ${cards.length} single-stop cards from ${filtered.length} filtered places (${allPlaces.length} total, batchSeed=${batchSeed})`);
  return cards;
}

// ── Turbo Pipeline: Background niche enrichment for richer future batches ──
async function enrichPoolWithNicheTypes(
  lat: number, lng: number, radiusMeters: number
) {
  const nicheQueries = [
    'escape room',
    'pottery class studio',
    'karaoke bar',
    'comedy club',
    'rock climbing',
  ];

  try {
    const nicheResults = await Promise.allSettled(
      nicheQueries.slice(0, 3).map(query =>
        searchByText(query, lat, lng, radiusMeters)
      )
    );

    const allNiche: any[] = [];
    for (const result of nicheResults) {
      if (result.status === 'fulfilled') {
        allNiche.push(...result.value);
      }
    }

    // Store in place_pool for future use
    for (const place of allNiche) {
      await upsertPlaceToPool(supabaseAdmin, place, GOOGLE_PLACES_API_KEY, 'text_search');
    }

    console.log(`[turbo-niche] Stored ${allNiche.length} niche places in pool`);
  } catch (err) {
    console.warn('[turbo-niche] Niche enrichment failed:', err);
  }
}

function scorePlace(place: any): number {
  return (place.rating ?? 0) * Math.log10(Math.max(1, place.userRatingCount ?? 1));
}

function topPlace(places: any[]): any | null {
  if (!places.length) return null;
  return [...places].sort((a, b) => scorePlace(b) - scorePlace(a))[0];
}

function getPhotoUrl(place: any): string {
  const photo = place.photos?.[0];
  if (!photo?.name) return '';
  return `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=800&maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}`;
}

function parseOpeningHours(place: any): { hours: Record<string, string>; isOpenNow: boolean } {
  const roh = place.regularOpeningHours;
  if (!roh) return { hours: {}, isOpenNow: true };
  const hours: Record<string, string> = {};
  for (const desc of roh.weekdayDescriptions ?? []) {
    const [day, ...rest] = desc.split(': ');
    if (day) hours[day.toLowerCase()] = rest.join(': ');
  }
  return { hours, isOpenNow: roh.openNow ?? true };
}

async function getTravelTime(originLat: number, originLng: number, destLat: number, destLng: number, travelMode: string): Promise<number> {
  const mode = travelMode === 'driving' ? 'driving' : travelMode === 'transit' ? 'transit' : travelMode === 'biking' ? 'bicycling' : 'walking';
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&mode=${mode}&key=${GOOGLE_PLACES_API_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const el = data.rows?.[0]?.elements?.[0];
    if (el?.status === 'OK') return Math.round(el.duration.value / 60);
  } catch { /* ignore */ }
  return 15;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPlaceOpenAt(place: any, target: Date): boolean {
  const periods = place.regularOpeningHours?.periods;
  if (!periods || periods.length === 0) return true; // No data → assume open

  const dayOfWeek = target.getDay(); // 0=Sunday
  const timeMinutes = target.getHours() * 60 + target.getMinutes();

  for (const period of periods) {
    if (period.open?.day === dayOfWeek) {
      const openMin = (period.open.hour ?? 0) * 60 + (period.open.minute ?? 0);
      let closeMin: number;
      if (period.close) {
        closeMin = (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0);
        // Handle overnight (close < open means closes next day)
        if (closeMin <= openMin) closeMin = 24 * 60;
      } else {
        closeMin = 24 * 60; // No close = open 24h
      }

      if (timeMinutes >= openMin && timeMinutes < closeMin) {
        return true;
      }
    }
  }
  return false;
}

function estimateTravelMinutes(distKm: number, travelMode: string): number {
  const config: Record<string, { speed: number; factor: number }> = {
    walking:   { speed: 4.5, factor: 1.3 },
    driving:   { speed: 35,  factor: 1.4 },
    transit:   { speed: 20,  factor: 1.3 },
    biking:    { speed: 14,  factor: 1.3 },
    bicycling: { speed: 14,  factor: 1.3 },
  };
  const { speed, factor } = config[travelMode] ?? config.walking;
  return Math.max(3, Math.round((distKm * factor / speed) * 60));
}

async function generateStopDescriptions(
  stops: any[],
): Promise<string[]> {
  if (!OPENAI_API_KEY) {
    return stops.map(s => `A wonderful stop at ${s.placeName} — high in adventure and full of discovery.`);
  }
  try {
    const stopList = stops
      .map((s, i) => `Stop ${i + 1}: ${s.placeName} (${s.placeType.replace(/_/g, ' ')}), rated ${s.rating.toFixed(1)}/5`)
      .join('\n');
    const prompt = `You are a travel writer creating short descriptions for an adventurous day out.
Write exactly 3 short paragraphs (one per stop, 2-3 sentences each), telling the visitor what to do and the vibe.
Emphasize the sense of adventure, discovery, and excitement. Never describe it as a solo or single-person activity — write for anyone (friends, couples, groups, or solo).
Be specific, warm, and fun. Address the reader directly as "you".
Output ONLY a JSON array of 3 strings with no markdown and no extra keys.

Stops:
${stopList}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.8,
      }),
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content?.trim() ?? '[]';
    const parsed: string[] = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length === stops.length) return parsed;
    throw new Error('Unexpected shape');
  } catch (_) {
    return stops.map(s => `${s.placeName} is a great ${s.placeType.replace(/_/g, ' ')} worth visiting on your day out.`);
  }
}

// Fetch multiple places from each category in parallel (increased from 10 to 20 for better diversity)
// Optionally filters out already-used places for global deduplication
async function fetchPlacesByCategory(
  userLat: number,
  userLng: number,
  radiusMeters: number,
  excludedPlaceIds?: Set<string>
): Promise<Record<string, any[]>> {
  const categoryPlaces: Record<string, any[]> = {};
  const excluded = excludedPlaceIds || new Set();

  await Promise.all(
    CATEGORY_NAMES.map(async (categoryName) => {
      const allTypes = PLACE_CATEGORIES[categoryName] || [];
      const placeTypes = shuffle(allTypes).slice(0, 5);
      const allPlaces: any[] = [];

      // Fetch from all place types in this category
      const placesFetched = await Promise.all(
        placeTypes.map(async (placeType) => {
          const config = PLACE_TYPE_SEARCH_CONFIG[placeType];
          if (!config) return [];
          
          try {
            const places = config.strategy === 'nearby'
              ? await searchNearby(config.includedType, userLat, userLng, radiusMeters)
              : await searchByText(config.textQuery, userLat, userLng, radiusMeters);
            return places.map(p => ({ ...p, placeType })); // Tag with place type
          } catch {
            return [];
          }
        })
      );

      // Combine all places from this category
      placesFetched.forEach(places => allPlaces.push(...places));

      // Sort by rating and take top 20 (increased from 10 for better diversity)
      // Filter out already-used places for deduplication
      const topPlaces = allPlaces
        .sort((a, b) => scorePlace(b) - scorePlace(a))
        .filter(p => !excluded.has(p.id ?? ''))
        .slice(0, 20);

      categoryPlaces[categoryName] = topPlaces;
    })
  );

  return categoryPlaces;
}

async function fetchPlacesByCategoryWithCache(
  userLat: number,
  userLng: number,
  radiusMeters: number,
  excludedPlaceIds?: Set<string>
): Promise<Record<string, any[]>> {
  const locationKey = `${userLat.toFixed(2)},${userLng.toFixed(2)}`;
  const radiusBucket = Math.round(radiusMeters / 1000) * 1000;

  try {
    const { data: cached } = await supabaseAdmin
      .from('curated_places_cache')
      .select('category_places')
      .eq('location_key', locationKey)
      .eq('radius_m', radiusBucket)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .maybeSingle();

    if (cached?.category_places) {
      console.log('[cache] HIT for', locationKey, radiusBucket);
      const categoryPlaces = cached.category_places as Record<string, any[]>;
      if (excludedPlaceIds && excludedPlaceIds.size > 0) {
        for (const cat of Object.keys(categoryPlaces)) {
          categoryPlaces[cat] = categoryPlaces[cat].filter(
            (p: any) => !excludedPlaceIds.has(p.id ?? '')
          );
        }
      }
      return categoryPlaces;
    }
  } catch (err) {
    console.warn('[cache] Read failed, falling through to API:', err);
  }

  console.log('[cache] MISS for', locationKey, radiusBucket);
  const categoryPlaces = await fetchPlacesByCategory(
    userLat, userLng, radiusMeters, excludedPlaceIds
  );

  // Write to cache (fire-and-forget — don't block response)
  supabaseAdmin
    .from('curated_places_cache')
    .upsert({
      location_key: locationKey,
      radius_m: radiusBucket,
      category_places: categoryPlaces,
      created_at: new Date().toISOString(),
    })
    .then(() => console.log('[cache] Written for', locationKey))
    .catch((err: any) => console.warn('[cache] Write failed:', err));

  return categoryPlaces;
}

// Build a card from 3 categories by picking one place from each
// Implements: global deduplication (tracks usedPlaceIds), smarter budget matching, retry logic
async function resolvePairingFromCategories(
  categoryNames: [string, string, string],
  categoryPlaces: Record<string, any[]>,
  userLat: number,
  userLng: number,
  travelMode: string,
  budgetMax: number,
  usedPlaceIds: Set<string>,
  experienceType: string = 'solo-adventure',
  targetDatetime: Date = new Date(),
  travelConstraintType: string = 'time',
  travelConstraintValue: number = 30,
  skipDescriptions: boolean = false,
): Promise<any | null> {
  const [cat1, cat2, cat3] = categoryNames;

  // Get places, filtering out already-used ones (GLOBAL DEDUPLICATION)
  // Also pre-filter by per-stop budget affordability
  const perStopBudget = budgetMax > 0 ? Math.ceil(budgetMax / 3) : Infinity;
  const isAffordable = (p: any) => priceLevelToRange(p.priceLevel).min <= perStopBudget;
  const isAvailable = (p: any) => !usedPlaceIds.has(p.id ?? '') && isAffordable(p) && isPlaceOpenAt(p, targetDatetime);
  const places1 = (categoryPlaces[cat1] || []).filter(isAvailable);
  const places2 = (categoryPlaces[cat2] || []).filter(isAvailable);
  const places3 = (categoryPlaces[cat3] || []).filter(isAvailable);

  // If any category has no available places, this pairing can't be made
  if (places1.length === 0 || places2.length === 0 || places3.length === 0) {
    return null;
  }

  // Randomly pick one place from each category
  const place1 = places1[Math.floor(Math.random() * places1.length)];
  const place2 = places2[Math.floor(Math.random() * places2.length)];
  const place3 = places3[Math.floor(Math.random() * places3.length)];

  const stops: any[] = [];

  // Build stop info
  for (let idx = 0; idx < 3; idx++) {
    const place = [place1, place2, place3][idx];
    const placeType = place.placeType || '';
    const priceRange = priceLevelToRange(place.priceLevel);
    const { hours, isOpenNow } = parseOpeningHours(place);
    const placeLocation = place.location ?? {};
    const lat = placeLocation.latitude ?? userLat;
    const lng = placeLocation.longitude ?? userLng;
    const distKm = haversineKm(userLat, userLng, lat, lng);
    const travelTimeFromUser = estimateTravelMinutes(distKm, travelMode);
    const stopLabels: Array<'Start Here' | 'Then' | 'End With'> = ['Start Here', 'Then', 'End With'];

    stops.push({
      stopNumber: idx + 1,
      stopLabel: stopLabels[idx],
      placeId: place.id ?? '',
      placeName: place.displayName?.text ?? place.displayName ?? '',
      placeType,
      address: place.formattedAddress ?? '',
      rating: place.rating ?? 0,
      reviewCount: place.userRatingCount ?? 0,
      imageUrl: getPhotoUrl(place),
      priceLevelLabel: priceLevelToLabel(place.priceLevel),
      priceMin: priceRange.min,
      priceMax: priceRange.max,
      openingHours: hours,
      isOpenNow,
      website: place.websiteUri ?? null,
      lat,
      lng,
      distanceFromUserKm: Math.round(distKm * 10) / 10,
      travelTimeFromUserMin: travelTimeFromUser,
      travelTimeFromPreviousStopMin: null,
      travelModeFromPreviousStop: null,
    });
  }

  // STRICT BUDGET ENFORCEMENT: Hard reject if minimum total price exceeds budget
  const totalPriceMin = stops.reduce((sum: number, s: any) => sum + s.priceMin, 0);

  if (budgetMax > 0 && totalPriceMin > budgetMax) {
    return null; // Hard reject — never show cards above budget
  }

  // Estimate inter-stop travel using Haversine (no API call)
  for (let i = 1; i < stops.length; i++) {
    const interStopDist = haversineKm(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
    stops[i].travelTimeFromPreviousStopMin = estimateTravelMinutes(interStopDist, travelMode);
    stops[i].travelModeFromPreviousStop = travelMode;
  }

  // TRAVEL CONSTRAINT VALIDATION: reject if total travel exceeds 1.5× user's limit
  const totalTravelMinutes = stops.reduce((sum: number, s: any) => {
    return sum + (s.travelTimeFromPreviousStopMin ?? s.travelTimeFromUserMin);
  }, 0);

  if (travelConstraintType === 'time' && totalTravelMinutes > travelConstraintValue * 1.5) {
    return null;
  }
  if (travelConstraintType === 'distance') {
    const totalDistanceKm = stops.reduce((sum: number, s: any) => sum + s.distanceFromUserKm, 0);
    if (totalDistanceKm > travelConstraintValue * 1.5) {
      return null;
    }
  }

  // Generate AI descriptions (skip for priority batch to cut ~2-3s)
  if (skipDescriptions) {
    for (let i = 0; i < stops.length; i++) {
      stops[i].aiDescription = `${stops[i].placeName} — a great ${stops[i].placeType.replace(/_/g, ' ')} spot, high in adventure and full of discovery.`;
      stops[i].estimatedDurationMinutes = STOP_DURATION_MINUTES[stops[i].placeType] ?? DEFAULT_STOP_DURATION;
    }
  } else {
    const descriptions = await generateStopDescriptions(stops);
    for (let i = 0; i < stops.length; i++) {
      stops[i].aiDescription = descriptions[i];
      stops[i].estimatedDurationMinutes = STOP_DURATION_MINUTES[stops[i].placeType] ?? DEFAULT_STOP_DURATION;
    }
  }

  // totalPriceMin already calculated above for budget check — reuse it
  const totalPriceMax = stops.reduce((sum: number, s: any) => sum + s.priceMax, 0);
  const avgRating = stops.reduce((sum: number, s: any) => sum + s.rating, 0) / stops.length;
  const pairingKey = categoryNames.join('+');
  const travelTotal = stops.slice(1).reduce((s: number, st: any) => s + (st.travelTimeFromPreviousStopMin ?? 15), 0);
  const shortNames = stops.map((s: any) => s.placeName.split(' ').slice(0, 2).join(' '));
  const taglines = TAGLINES_BY_TYPE[experienceType] ?? DEFAULT_TAGLINES;

  return {
    id: `curated_${pairingKey}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    cardType: 'curated',
    experienceType,
    pairingKey,
    title: shortNames.join(' \u2192 '),
    tagline: taglines[Math.floor(Math.random() * taglines.length)],
    stops,
    totalPriceMin,
    totalPriceMax,
    estimatedDurationMinutes: travelTotal + stops.reduce((s: number, st: any) => s + st.estimatedDurationMinutes, 0),
    matchScore: Math.round(avgRating * 18 + 10),
  };
}

async function resolvePairing(pairing: [string, string, string], userLat: number, userLng: number, radiusMeters: number, travelMode: string, budgetMax: number, experienceType: string = 'solo-adventure'): Promise<any | null> {
  const stopResults = await Promise.all(
    pairing.map(async (type, index) => {
      const config = PLACE_TYPE_SEARCH_CONFIG[type];
      if (!config) return null;
      const places = config.strategy === 'nearby'
        ? await searchNearby(config.includedType, userLat, userLng, radiusMeters)
        : await searchByText(config.textQuery, userLat, userLng, radiusMeters);
      const place = topPlace(places);
      if (!place) return null;
      const priceRange = priceLevelToRange(place.priceLevel);
      const { hours, isOpenNow } = parseOpeningHours(place);
      const placeLocation = place.location ?? {};
      const lat = placeLocation.latitude ?? userLat;
      const lng = placeLocation.longitude ?? userLng;
      const distKm = haversineKm(userLat, userLng, lat, lng);
      const travelTimeFromUser = estimateTravelMinutes(distKm, travelMode);
      const stopLabels: Array<'Start Here' | 'Then' | 'End With'> = ['Start Here', 'Then', 'End With'];
      return {
        stopNumber: index + 1,
        stopLabel: stopLabels[index],
        placeId: place.id ?? '',
        placeName: place.displayName?.text ?? place.displayName ?? '',
        placeType: type,
        address: place.formattedAddress ?? '',
        rating: place.rating ?? 0,
        reviewCount: place.userRatingCount ?? 0,
        imageUrl: getPhotoUrl(place),
        priceLevelLabel: priceLevelToLabel(place.priceLevel),
        priceMin: priceRange.min,
        priceMax: priceRange.max,
        openingHours: hours,
        isOpenNow,
        website: place.websiteUri ?? null,
        lat, lng,
        distanceFromUserKm: Math.round(distKm * 10) / 10,
        travelTimeFromUserMin: travelTimeFromUser,
        travelTimeFromPreviousStopMin: null,
        travelModeFromPreviousStop: null,
      };
    })
  );
  if (stopResults.some(s => s === null)) return null;
  const stops = stopResults as any[];
  for (let i = 1; i < stops.length; i++) {
    const interStopDist = haversineKm(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
    stops[i].travelTimeFromPreviousStopMin = estimateTravelMinutes(interStopDist, travelMode);
    stops[i].travelModeFromPreviousStop = travelMode;
  }
  // Generate AI descriptions for all stops in one OpenAI call
  const descriptions = await generateStopDescriptions(stops);
  for (let i = 0; i < stops.length; i++) {
    stops[i].aiDescription = descriptions[i];
    stops[i].estimatedDurationMinutes = STOP_DURATION_MINUTES[stops[i].placeType] ?? DEFAULT_STOP_DURATION;
  }
  const totalPriceMax = stops.reduce((sum: number, s: any) => sum + s.priceMax, 0);
  if (budgetMax > 0 && totalPriceMax > budgetMax * 1.2) return null;
  const totalPriceMin = stops.reduce((sum: number, s: any) => sum + s.priceMin, 0);
  const avgRating = stops.reduce((sum: number, s: any) => sum + s.rating, 0) / stops.length;
  const pairingKey = pairing.join('+');
  const travelTotal = stops.slice(1).reduce((s: number, st: any) => s + (st.travelTimeFromPreviousStopMin ?? 15), 0);
  const shortNames = stops.map((s: any) => s.placeName.split(' ').slice(0, 2).join(' '));
  const taglines = TAGLINES_BY_TYPE[experienceType] ?? DEFAULT_TAGLINES;
  return {
    id: `curated_${pairingKey}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    cardType: 'curated',
    experienceType,
    pairingKey,
    title: shortNames.join(' \u2192 '),
    tagline: taglines[Math.floor(Math.random() * taglines.length)],
    stops,
    totalPriceMin,
    totalPriceMax,
    estimatedDurationMinutes: travelTotal + stops.reduce((s: number, st: any) => s + st.estimatedDurationMinutes, 0),
    matchScore: Math.round(avgRating * 18 + 10),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    let { experienceType = 'solo-adventure', location, budgetMin = 0, budgetMax = 200, travelMode = 'walking', travelConstraintType = 'time', travelConstraintValue = 30, datetimePref, skipDescriptions = false, limit = 20, session_id, batchSeed = 0 } = body;
    const selectedCategories: string[] | undefined = body.selectedCategories;
    const allowedPlaceTypes = buildAllowedPlaceTypes(selectedCategories);

    // If session_id is provided, aggregate preferences from all participants
    if (session_id) {
      try {
        const agg = await aggregateSessionPreferences(session_id);
        budgetMin = agg.budgetMin;
        budgetMax = agg.budgetMax;
        travelMode = agg.travelMode;
        travelConstraintType = agg.travelConstraintType;
        travelConstraintValue = agg.travelConstraintValue;
        if (agg.datetimePref) datetimePref = agg.datetimePref;
        if (agg.location) location = agg.location;
        // If this experience type wasn't selected by any participant, return empty
        if (!agg.experienceTypes.includes(experienceType)) {
          return new Response(
            JSON.stringify({ cards: [], meta: { totalResults: 0, reason: 'experience_type_not_selected' } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (err) {
        console.error('[curated] Session aggregation failed:', err);
        return new Response(
          JSON.stringify({ error: 'Failed to aggregate session preferences', cards: [] }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const targetDatetime = datetimePref ? new Date(datetimePref) : new Date();
    if (!location?.lat || !location?.lng) {
      return new Response(JSON.stringify({ error: 'location.lat and location.lng are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const TRAVEL_SPEEDS_KMH: Record<string, number> = {
      walking: 4.5,
      biking: 14,
      transit: 20,
      driving: 35,
    };
    const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
    const radiusMeters = travelConstraintType === 'time'
      ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
      : travelConstraintValue * 1000;
    const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

    // ── Pool-first pipeline for curated cards ───────────────────────
    const poolSupabaseUrl = Deno.env.get('SUPABASE_URL');
    const poolServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const poolAdmin = (poolSupabaseUrl && poolServiceRoleKey)
      ? createClient(poolSupabaseUrl, poolServiceRoleKey)
      : null;

    // Extract userId from auth if available
    const authHeader = req.headers.get('Authorization');
    let poolUserId = 'anonymous';
    if (poolAdmin && authHeader) {
      try {
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
        const authClient = createClient(poolSupabaseUrl!, anonKey);
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await authClient.auth.getUser(token);
        if (user?.id) poolUserId = user.id;
      } catch {}
    }

    // ── Turbo Pipeline: warmPool support ──────────────────────────
    const warmPool = body.warmPool ?? false;

    if (warmPool && poolAdmin) {
      try {
        const poolResult = await serveCuratedCardsFromPool({
          supabaseAdmin: poolAdmin,
          userId: poolUserId,
          lat: location.lat,
          lng: location.lng,
          radiusMeters: clampedRadius,
          categories: [],
          budgetMin: 0,
          budgetMax: budgetMax,
          limit: 40,
          cardType: 'curated',
          experienceType,
        }, GOOGLE_PLACES_API_KEY!);

        if (poolResult.totalPoolSize >= 40) {
          console.log('[warm-pool] Pool already warm:', poolResult.totalPoolSize, 'cards');
          return new Response(JSON.stringify({
            success: true, message: 'Pool already warm',
            poolSize: poolResult.totalPoolSize,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        console.log('[warm-pool] Pool has', poolResult.totalPoolSize, 'cards, needs warming');
      } catch (err) {
        console.warn('[warm-pool] Pool check failed, proceeding to warm:', err);
      }
      // Fall through to the normal pipeline (which will over-populate)
    }
    // ── End warmPool support ────────────────────────────────────────

    // Pool-first: only for batch 0 (first load) WITHOUT category filters.
    // Subsequent batches (batchSeed > 0) or category-filtered requests
    // must always generate fresh cards via Turbo/Fallback pipeline.
    if (poolAdmin && poolUserId !== 'anonymous' && batchSeed === 0 && !allowedPlaceTypes) {
      try {
        const poolResult = await serveCuratedCardsFromPool({
          supabaseAdmin: poolAdmin,
          userId: poolUserId,
          lat: location.lat,
          lng: location.lng,
          radiusMeters: clampedRadius,
          categories: [],  // Intentionally empty — curated cards span multiple categories
          budgetMin: budgetMin || 0,
          budgetMax: budgetMax || 1000,
          limit: limit || 20,
          cardType: 'curated',
          experienceType: experienceType,
        }, GOOGLE_PLACES_API_KEY!);

        if (poolResult.cards.length >= Math.ceil(limit * 0.75)) {
          console.log(`[pool-first-curated] Served ${poolResult.cards.length} curated cards from pool`);
          return new Response(
            JSON.stringify({
              success: true,
              cards: poolResult.cards,
              meta: {
                totalResults: poolResult.cards.length,
                fromPool: poolResult.fromPool,
                fromApi: poolResult.fromApi,
                poolSize: poolResult.totalPoolSize,
              },
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        console.log(`[pool-first-curated] Pool had only ${poolResult.cards.length} curated cards, falling back`);
      } catch (poolError) {
        console.warn('[pool-first-curated] Pool query failed, falling back:', poolError);
      }
    } else if (batchSeed > 0) {
      console.log(`[pool-skip] batchSeed=${batchSeed}, skipping pool-first to generate fresh cards`);
    } else if (allowedPlaceTypes) {
      console.log(`[pool-skip] selectedCategories provided, skipping pool-first to respect category filter`);
    }
    // ── End pool-first pipeline ─────────────────────────────────────

    // ── TURBO PIPELINE: 4 super-category calls instead of 45 individual calls ──
    if (experienceType === 'solo-adventure') {
      console.log('[turbo] Starting Adventurous Turbo Pipeline...', allowedPlaceTypes ? `filtering to ${allowedPlaceTypes.size} place types from ${selectedCategories?.join(',')}` : 'no category filter');

      // TURBO: 4 super-category calls instead of 45 individual calls
      const superCatPlaces = await fetchPlacesBySuperCategory(
        location.lat, location.lng, clampedRadius
      );

      // Filter places by user-selected categories if provided
      if (allowedPlaceTypes) {
        for (const key of Object.keys(superCatPlaces)) {
          superCatPlaces[key] = superCatPlaces[key].filter((p: any) => {
            const type = p.placeType || p.primaryType || '';
            return allowedPlaceTypes.has(type);
          });
        }
        const remaining = Object.values(superCatPlaces).reduce((s, arr) => s + arr.length, 0);
        console.log(`[turbo] After category filter: ${remaining} places remain`);
      }

      // Check how many super-categories have results after filtering
      const nonEmptySuperCats = Object.keys(superCatPlaces).filter(
        k => superCatPlaces[k].length > 0
      ).length;

      let allCards: any[];

      if (nonEmptySuperCats < 3 && allowedPlaceTypes) {
        // Too few super-categories for 3-stop triads (e.g. nature-only).
        // Build single-stop cards instead — same curated card format.
        const categoryLabel = selectedCategories?.[0]
          ? selectedCategories[0].replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
          : 'Explore';
        const buildLimit = warmPool ? 50 : Math.max(limit, 40);
        allCards = buildSingleStopCards(
          superCatPlaces, buildLimit, budgetMax, travelMode,
          location.lat, location.lng,
          travelConstraintType, travelConstraintValue,
          targetDatetime, experienceType, categoryLabel,
          batchSeed,
        );
        console.log(`[turbo] Category-filtered → ${nonEmptySuperCats} super-cats → built ${allCards.length} single-stop cards`);
      } else {
        // Normal path: enough super-categories for 3-stop triads
        const buildLimit = warmPool ? 50 : Math.max(limit, 40);
        allCards = buildTriadsFromSuperCategories(
          superCatPlaces, buildLimit, budgetMax, travelMode,
          location.lat, location.lng,
          travelConstraintType, travelConstraintValue,
          targetDatetime, experienceType, skipDescriptions,
          batchSeed,
        );
      }

      console.log(`[turbo] Built ${allCards.length} cards, serving ${Math.min(allCards.length, limit)}`);

      // Store ALL cards in pool (fire-and-forget)
      if (poolAdmin && allCards.length > 0) {
        (async () => {
          try {
            const poolIds: string[] = [];
            for (const card of allCards) {
              const stopPlacePoolIds: string[] = [];
              const stopGooglePlaceIds: string[] = [];
              for (const stop of card.stops || []) {
                if (stop.placeId) {
                  const ppId = await upsertPlaceToPool(poolAdmin, {
                    id: stop.placeId,
                    displayName: { text: stop.placeName || '' },
                    formattedAddress: stop.address || '',
                    location: { latitude: stop.lat || 0, longitude: stop.lng || 0 },
                    rating: stop.rating || 0,
                    userRatingCount: stop.reviewCount || 0,
                    types: [],
                    photos: [],
                  }, GOOGLE_PLACES_API_KEY!);
                  if (ppId) stopPlacePoolIds.push(ppId);
                  stopGooglePlaceIds.push(stop.placeId);
                }
              }

              const cardId = await insertCardToPool(poolAdmin, {
                cardType: 'curated',
                title: card.title || `${experienceType} Experience`,
                category: card.stops?.[0]?.placeType || 'Nature',
                categories: (card.stops || []).map((s: any) => s.placeType).filter(Boolean),
                description: card.tagline || '',
                highlights: [],
                imageUrl: card.stops?.[0]?.imageUrl || null,
                images: (card.stops || []).map((s: any) => s.imageUrl).filter(Boolean),
                address: card.stops?.[0]?.address || '',
                lat: card.stops?.[0]?.lat || location.lat,
                lng: card.stops?.[0]?.lng || location.lng,
                rating: Math.min(5, (card.matchScore || 85) / 20),
                reviewCount: 0,
                stopPlacePoolIds,
                stopGooglePlaceIds,
                experienceType,
                stops: card.stops,
                tagline: card.tagline || '',
                totalPriceMin: card.totalPriceMin || 0,
                totalPriceMax: card.totalPriceMax || 0,
                estimatedDurationMinutes: card.estimatedDurationMinutes || 0,
              });
              if (cardId) poolIds.push(cardId);
            }
            // Only record impressions for SERVED cards (not pre-warmed)
            if (!warmPool && poolUserId !== 'anonymous' && poolIds.length > 0) {
              const servedIds = poolIds.slice(0, limit);
              await recordImpressions(poolAdmin, poolUserId, servedIds);
            }
            console.log(`[turbo] Stored ${poolIds.length} triads in pool`);
          } catch (storeError) {
            console.warn('[turbo] Pool store error:', storeError);
          }
        })();
      }

      // Background niche enrichment (fire-and-forget, doesn't block)
      if (!warmPool) {
        enrichPoolWithNicheTypes(location.lat, location.lng, clampedRadius);
      }

      const cards = allCards.slice(0, warmPool ? allCards.length : limit);
      return new Response(
        JSON.stringify({
          cards: warmPool ? [] : cards,  // warmPool returns empty (just populates)
          meta: {
            totalResults: cards.length,
            fromPool: 0,
            fromApi: cards.length,
            pipeline: nonEmptySuperCats < 3 && allowedPlaceTypes ? 'turbo-single' : 'turbo',
            superCategoriesFetched: Object.keys(superCatPlaces).length,
            totalCardsBuilt: allCards.length,
          },
          ...(warmPool ? { success: true, poolSize: allCards.length } : {}),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ── End Turbo Pipeline ──────────────────────────────────────────

    // FALLBACK: Original pairing-based generation for other experience types
    const pairingSet = PAIRINGS_BY_TYPE[experienceType] ?? SOLO_ADVENTURE_PAIRINGS;
    // Filter pairings by user-selected categories if provided
    let filteredPairings = pairingSet;
    if (allowedPlaceTypes) {
      filteredPairings = pairingSet.filter((pairing: [string, string, string]) =>
        pairing.some(placeType => allowedPlaceTypes.has(placeType))
      );
      console.log(`[fallback] Filtered pairings: ${filteredPairings.length}/${pairingSet.length} match selected categories`);
      // If no pairings match, fall back to all pairings to avoid empty results
      if (filteredPairings.length === 0) filteredPairings = pairingSet;
    }
    const pairings = shuffle(filteredPairings).slice(0, Math.min(limit, 50));
    const results = await Promise.allSettled(pairings.map(pairing => resolvePairing(pairing as [string, string, string], location.lat, location.lng, clampedRadius, travelMode, budgetMax, experienceType)));
    const cards = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null).map(r => r.value);

    // ── Store curated cards in pool for future reuse ────────────────
    if (poolAdmin && cards.length > 0) {
      (async () => {
        try {
          const poolIds: string[] = [];
          for (const card of cards) {
            const stopPlacePoolIds: string[] = [];
            const stopGooglePlaceIds: string[] = [];
            for (const stop of card.stops || []) {
              if (stop.placeId) {
                const ppId = await upsertPlaceToPool(poolAdmin, {
                  id: stop.placeId,
                  displayName: { text: stop.placeName || '' },
                  formattedAddress: stop.address || '',
                  location: { latitude: stop.lat || 0, longitude: stop.lng || 0 },
                  rating: stop.rating || 0,
                  userRatingCount: stop.reviewCount || 0,
                  types: [],
                  photos: [],
                }, GOOGLE_PLACES_API_KEY!);
                if (ppId) stopPlacePoolIds.push(ppId);
                stopGooglePlaceIds.push(stop.placeId);
              }
            }

            const cardId = await insertCardToPool(poolAdmin, {
              cardType: 'curated',
              title: card.title || `${experienceType} Experience`,
              category: card.stops?.[0]?.placeType || 'Nature',
              categories: (card.stops || []).map((s: any) => s.placeType).filter(Boolean),
              description: card.tagline || '',
              highlights: [],
              imageUrl: card.stops?.[0]?.imageUrl || null,
              images: (card.stops || []).map((s: any) => s.imageUrl).filter(Boolean),
              address: card.stops?.[0]?.address || '',
              lat: card.stops?.[0]?.lat || location.lat,
              lng: card.stops?.[0]?.lng || location.lng,
              rating: Math.min(5, (card.matchScore || 85) / 20),
              reviewCount: 0,
              stopPlacePoolIds,
              stopGooglePlaceIds,
              experienceType,
              stops: card.stops,
              tagline: card.tagline || '',
              totalPriceMin: card.totalPriceMin || 0,
              totalPriceMax: card.totalPriceMax || 0,
              estimatedDurationMinutes: card.estimatedDurationMinutes || 0,
            });
            if (cardId) poolIds.push(cardId);
          }
          if (poolUserId !== 'anonymous' && poolIds.length > 0) {
            await recordImpressions(poolAdmin, poolUserId, poolIds);
          }
          console.log(`[pool-store-curated] Stored ${poolIds.length} curated cards in pool`);
        } catch (storeError) {
          console.warn('[pool-store-curated] Error storing curated cards:', storeError);
        }
      })();
    }
    // ── End store curated cards ─────────────────────────────────────

    return new Response(JSON.stringify({ cards, pairingsAttempted: pairings.length, pairingsResolved: cards.length }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('generate-curated-experiences error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
