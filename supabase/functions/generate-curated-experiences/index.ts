import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const CATEGORY_NAMES = Object.keys(PLACE_CATEGORIES);

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
  return PRICE_LEVEL_RANGES[level ?? ''] ?? { min: 10, max: 30 };
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
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: [includedType],
      maxResultCount: 5,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
    }),
  });
  const data = await res.json();
  return data.places ?? [];
}

async function searchByText(textQuery: string, lat: number, lng: number, radiusMeters: number): Promise<any[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: 5,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
    }),
  });
  const data = await res.json();
  return data.places ?? [];
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
    let { experienceType = 'solo-adventure', location, budgetMin = 0, budgetMax = 200, travelMode = 'walking', travelConstraintType = 'time', travelConstraintValue = 30, datetimePref, skipDescriptions = false, limit = 20, session_id } = body;

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

    // NEW: Category-based generation for solo adventures with GLOBAL DEDUPLICATION
    if (experienceType === 'solo-adventure') {
      console.log('[solo-adventure] Fetching 20 places from each of 9 categories...');
      
      // Fetch 20 places from all 9 categories in parallel
      let categoryPlaces = await fetchPlacesByCategoryWithCache(location.lat, location.lng, clampedRadius);
      
      // Log what we got
      let categorySummary = Object.entries(categoryPlaces)
        .map(([cat, places]) => `${cat}: ${places.length} places`)
        .join('; ');
      console.log(`[solo-adventure] Fetched places: ${categorySummary}`);

      // Filter out gyms/fitness centers from solo adventure results
      const SOLO_EXCLUDED_TYPES = new Set([
        'gym',
        'fitness_center',
        'athletic_field',
        'sports_club',
        'health_club',
      ]);
      const SOLO_EXCLUDED_NAME_PATTERN = /\b(gym|fitness|planet fitness|crossfit|anytime fitness|gold'?s gym|24 hour fitness|la fitness|orangetheory|equinox)\b/i;
      for (const [catKey, places] of Object.entries(categoryPlaces)) {
        categoryPlaces[catKey] = places.filter((p: any) => {
          const primaryType = p.primaryType || p.placeType || '';
          const allTypes = p.types || [];
          const name = p.displayName?.text || p.placeName || '';
          const typeExcluded = SOLO_EXCLUDED_TYPES.has(primaryType) ||
                 allTypes.some((t: string) => SOLO_EXCLUDED_TYPES.has(t));
          const nameExcluded = SOLO_EXCLUDED_NAME_PATTERN.test(name);
          return !typeExcluded && !nameExcluded;
        });
      }

      // Generate all 84 category combinations
      const categoryCombinations = generateCategoryCombinations();
      console.log(`[solo-adventure] Generated ${categoryCombinations.length} category combinations`);
      
      // GLOBAL DEDUPLICATION: Track all used place IDs across the entire batch
      const usedPlaceIds = new Set<string>();
      const cards = [];
      
      // Shuffle combinations for variety
      const shuffledCombos = shuffle(categoryCombinations);
      
      // Build cards in parallel batches for speed, then dedup post-hoc
      const PARALLEL_BATCH = Math.min(limit + 2, 6);
      let comboIdx = 0;

      while (cards.length < limit && comboIdx < shuffledCombos.length) {
        const batch = shuffledCombos.slice(comboIdx, comboIdx + PARALLEL_BATCH);
        comboIdx += PARALLEL_BATCH;

        const results = await Promise.allSettled(
          batch.map(combo =>
            resolvePairingFromCategories(
              combo as [string, string, string],
              categoryPlaces,
              location.lat,
              location.lng,
              travelMode,
              budgetMax,
              usedPlaceIds,
              experienceType,
              targetDatetime,
              travelConstraintType,
              travelConstraintValue,
              skipDescriptions,
            )
          )
        );

        for (const result of results) {
          if (cards.length >= limit) break;
          if (result.status === 'fulfilled' && result.value) {
            const card = result.value;
            // Post-hoc dedup: reject cards sharing stops with already-accepted cards
            const hasOverlap = card.stops.some(
              (stop: any) => usedPlaceIds.has(stop.placeId)
            );
            if (!hasOverlap) {
              card.stops.forEach((stop: any) => usedPlaceIds.add(stop.placeId));
              cards.push(card);
            }
          }
        }
      }
      
      console.log(`[solo-adventure] Generated ${cards.length} unique cards out of ${shuffledCombos.length} attempted combinations`);
      return new Response(
        JSON.stringify({ 
          cards,
          pairingsAttempted: shuffledCombos.length,
          pairingsResolved: cards.length,
          uniquePlacesUsed: usedPlaceIds.size 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // FALLBACK: Original pairing-based generation for other experience types
    const pairingSet = PAIRINGS_BY_TYPE[experienceType] ?? SOLO_ADVENTURE_PAIRINGS;
    const pairings = shuffle(pairingSet).slice(0, Math.min(limit, 50));
    const results = await Promise.allSettled(pairings.map(pairing => resolvePairing(pairing as [string, string, string], location.lat, location.lng, clampedRadius, travelMode, budgetMax, experienceType)));
    const cards = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null).map(r => r.value);
    return new Response(JSON.stringify({ cards, pairingsAttempted: pairings.length, pairingsResolved: cards.length }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('generate-curated-experiences error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
