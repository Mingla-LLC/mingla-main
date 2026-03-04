import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { searchPlacesWithCache } from '../_shared/placesCache.ts';
import { serveCuratedCardsFromPool, upsertPlaceToPool, insertCardToPool, recordImpressions } from '../_shared/cardPoolService.ts';
import {
  MINGLA_CATEGORY_PLACE_TYPES,
  resolveCategory,
  GLOBAL_EXCLUDED_PLACE_TYPES,
  filterExcludedPlaces,
} from '../_shared/categoryPlaceTypes.ts';


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
  'adventurous', 'first-date', 'romantic', 'friendly', 'group-fun', 'picnic-dates', 'take-a-stroll',
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
  const allIntents = new Set<string>();
  allPrefs.forEach(p => {
    if (Array.isArray(p.categories)) p.categories.forEach((c: string) => allCats.add(c));
    // Read intents from dedicated column (post-migration)
    if (Array.isArray(p.intents)) p.intents.forEach((i: string) => allIntents.add(i));
  });
  const categories = [...allCats].filter(c => !SESSION_INTENT_IDS.has(c));
  // Prefer dedicated intents column; fall back to parsing from categories (pre-migration compat)
  const experienceTypes = allIntents.size > 0
    ? [...allIntents]
    : [...allCats].filter(c => SESSION_INTENT_IDS.has(c));

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
  // Adventure-related types (added for Adventure Intent feature)
  off_roading_area: 90, campground: 120, mountain_peak: 120,
  nature_preserve: 90, wildlife_refuge: 90, scenic_spot: 45, island: 120,
  korean_barbecue_restaurant: 90, hot_pot_restaurant: 90,
  go_karting_venue: 60, paintball_center: 90,
  art_museum: 90, concert_hall: 120, auditorium: 90,
  cultural_center: 60, dance_hall: 90, sculpture: 30,
  // First Date-related types (added for First Date Intent feature)
  miniature_golf_course: 45, amusement_center: 60, skateboard_park: 45,
  plaza: 30, tourist_attraction: 60, garden: 45,
  spanish_restaurant: 75, tapas_restaurant: 75, oyster_bar_restaurant: 75,
  bistro: 75, gastropub: 60,
  // Romantic-related types (added for Romantic Intent feature)
  history_museum: 90, historical_place: 60, cultural_landmark: 45,
  monument: 30, opera_house: 150,
  // Belt-and-suspenders: types used by dedicated generators but missing from global map
  performing_arts_theater: 120, sushi_restaurant: 60,
  // Friendly-related types (added for Friendly Intent feature)
  amusement_park: 180, hamburger_restaurant: 30, barbecue_restaurant: 75,
  fast_food_restaurant: 20, buffet_restaurant: 60, asian_restaurant: 60,
  chinese_restaurant: 60, art_studio: 60,
  // Picnic-related types (added for Picnic Dates Intent feature)
  grocery_store: 30, supermarket: 30,
};
const DEFAULT_STOP_DURATION = 45;

// Outdoor place types that are typically always-open (no regular hours data)
const ALWAYS_OPEN_TYPES = new Set([
  'park', 'national_park', 'state_park', 'hiking_area', 'beach',
  'wildlife_park', 'botanical_garden', 'dog_park', 'city_park',
]);

// ── Adventure Intent — Dedicated Place Type Groups ───────────────────────
// Bypasses CURATED_TYPE_CATEGORIES + MINGLA_CATEGORY_PLACE_TYPES for 'adventurous'.
// Each group is a thematic collection of hand-picked Google Place types.

interface AdventureGroup {
  id: string;
  label: string;
  types: string[];
}

const ADVENTURE_GROUPS: AdventureGroup[] = [
  {
    id: 'outdoor',
    label: 'Outdoor',
    types: [
      'national_park', 'hiking_area', 'off_roading_area', 'mountain_peak',
      'nature_preserve', 'wildlife_refuge', 'scenic_spot', 'state_park',
      'campground', 'island', 'zoo', 'park',
    ],
  },
  {
    id: 'exotic_eats',
    label: 'Exotic Eats',
    types: [
      'sushi_restaurant', 'ramen_restaurant', 'korean_barbecue_restaurant',
      'hot_pot_restaurant', 'brazilian_restaurant', 'thai_restaurant',
      'mexican_restaurant', 'indian_restaurant', 'italian_restaurant',
      'mediterranean_restaurant',
    ],
  },
  {
    id: 'adrenaline',
    label: 'Adrenaline',
    types: [
      'amusement_center', 'amusement_park', 'bowling_alley', 'casino',
      'go_karting_venue', 'miniature_golf_course', 'paintball_center',
      'video_arcade', 'skateboard_park', 'indoor_playground',
    ],
  },
  {
    id: 'culture',
    label: 'Culture',
    types: [
      'art_gallery', 'art_studio', 'art_museum', 'performing_arts_theater',
      'sculpture', 'auditorium', 'concert_hall', 'cultural_center',
      'dance_hall', 'comedy_club',
    ],
  },
];

const ADVENTURE_EXCLUDED_PLACE_TYPES: string[] = [
  'gym', 'fitness_center',
  'grocery_store', 'supermarket', 'food_store', 'asian_grocery_store',
];

// All 4 possible 3-of-4 group combos. Rotated round-robin.
const ADVENTURE_COMBOS: number[][] = [
  [0, 1, 2], // Outdoor + Exotic Eats + Adrenaline
  [0, 1, 3], // Outdoor + Exotic Eats + Culture
  [0, 2, 3], // Outdoor + Adrenaline + Culture
  [1, 2, 3], // Exotic Eats + Adrenaline + Culture
];

// Stop durations specific to adventure groups (overrides for types not in STOP_DURATION_MINUTES)
const ADVENTURE_STOP_DURATIONS: Record<string, number> = {
  national_park: 120,
  hiking_area: 120,
  off_roading_area: 90,
  mountain_peak: 120,
  nature_preserve: 90,
  wildlife_refuge: 90,
  scenic_spot: 45,
  state_park: 120,
  campground: 120,
  island: 120,
  zoo: 150,
  park: 60,
  // Exotic eats — default 60 is fine for most restaurants
  korean_barbecue_restaurant: 90,
  hot_pot_restaurant: 90,
  // Adrenaline
  amusement_park: 180,
  casino: 120,
  paintball_center: 90,
  go_karting_venue: 60,
  // Culture
  art_museum: 90,
  performing_arts_theater: 120,
  concert_hall: 120,
  auditorium: 90,
  comedy_club: 90,
};

// ── First Date Intent — Dedicated Place Type Groups ──────────────────────
// Bypasses CURATED_TYPE_CATEGORIES + MINGLA_CATEGORY_PLACE_TYPES for 'first-date'.
// 2-stop itinerary: Starting group → Finish group.

interface FirstDateGroup {
  id: string;
  label: string;
  types: string[];
}

const FIRST_DATE_STARTING_1: FirstDateGroup = {
  id: 'fun_activity',
  label: 'Fun Activity',
  types: [
    'bowling_alley', 'miniature_golf_course', 'amusement_center',
    'video_arcade', 'karaoke', 'paintball_center',
    'go_karting_venue', 'skateboard_park', 'dance_hall', 'comedy_club',
  ],
};

const FIRST_DATE_STARTING_2: FirstDateGroup = {
  id: 'cultural',
  label: 'Cultural',
  types: [
    'art_gallery', 'art_museum', 'art_studio', 'botanical_garden',
    'garden', 'park', 'plaza', 'tourist_attraction',
    'cultural_center', 'museum',
  ],
};

const FIRST_DATE_FINISH: FirstDateGroup = {
  id: 'fine_dining',
  label: 'Fine Dining',
  types: [
    'italian_restaurant', 'fine_dining_restaurant', 'french_restaurant',
    'steak_house', 'seafood_restaurant', 'spanish_restaurant',
    'tapas_restaurant', 'oyster_bar_restaurant', 'wine_bar',
    'bistro', 'gastropub',
  ],
};

const FIRST_DATE_EXCLUDED_PLACE_TYPES: string[] = [
  'gym', 'fitness_center',
  'grocery_store', 'supermarket', 'food_store', 'asian_grocery_store',
];

// Strict alternation: [Starting 1, Starting 2, Starting 1, Starting 2, ...]
const FIRST_DATE_STARTING_GROUPS: FirstDateGroup[] = [
  FIRST_DATE_STARTING_1,
  FIRST_DATE_STARTING_2,
];

// Stop durations specific to first-date groups
const FIRST_DATE_STOP_DURATIONS: Record<string, number> = {
  // Starting 1 — activities
  bowling_alley: 60,
  miniature_golf_course: 45,
  amusement_center: 60,
  video_arcade: 60,
  karaoke: 90,
  paintball_center: 90,
  go_karting_venue: 60,
  skateboard_park: 45,
  dance_hall: 90,
  comedy_club: 90,
  // Starting 2 — cultural
  art_gallery: 60,
  art_museum: 90,
  art_studio: 60,
  botanical_garden: 60,
  garden: 45,
  park: 60,
  plaza: 30,
  tourist_attraction: 60,
  cultural_center: 60,
  museum: 90,
  // Finish — dining
  italian_restaurant: 75,
  fine_dining_restaurant: 90,
  french_restaurant: 90,
  steak_house: 90,
  seafood_restaurant: 75,
  spanish_restaurant: 75,
  tapas_restaurant: 75,
  oyster_bar_restaurant: 75,
  wine_bar: 60,
  bistro: 75,
  gastropub: 60,
};

// ── Romantic Intent — Dedicated Place Type Groups ─────────────────────────
// Bypasses CURATED_TYPE_CATEGORIES + MINGLA_CATEGORY_PLACE_TYPES for 'romantic'.
// 2-stop itinerary: Romance Start (cultural/artistic) → Romance Finish (upscale dining).

interface RomanticGroup {
  id: string;
  label: string;
  types: string[];
}

const ROMANTIC_START: RomanticGroup = {
  id: 'romance_start',
  label: 'Romance Start',
  types: [
    'art_gallery', 'art_museum', 'museum', 'history_museum',
    'historical_place', 'cultural_landmark', 'monument',
    'performing_arts_theater', 'opera_house',
  ],
};

const ROMANTIC_FINISH: RomanticGroup = {
  id: 'romance_finish',
  label: 'Romance Finish',
  types: [
    'italian_restaurant', 'french_restaurant', 'mediterranean_restaurant',
    'spanish_restaurant', 'tapas_restaurant', 'greek_restaurant',
    'seafood_restaurant', 'sushi_restaurant', 'wine_bar', 'bistro',
  ],
};

const ROMANTIC_INTENT_EXCLUDED_PLACE_TYPES: string[] = [
  // Global excludes
  'gym', 'fitness_center',
  // Fast food / casual chains
  'fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant',
  'sandwich_shop', 'food_court', 'buffet_restaurant', 'diner',
  // Kid / family venues
  'indoor_playground', 'childrens_camp', 'water_park',
  'amusement_park', 'amusement_center', 'zoo', 'aquarium',
  // Defense-in-depth: catches multi-type places (e.g., museum with attached playground)
  'playground', 'children_store', 'child_care_agency', 'preschool',
  // Adrenaline / noisy
  'video_arcade', 'bowling_alley', 'paintball_center',
  'go_karting_venue', 'miniature_golf_course', 'skateboard_park',
  // Casual / inappropriate
  'coffee_stand', 'convenience_store', 'market',
];

// Stop durations specific to romantic groups
const ROMANTIC_STOP_DURATIONS: Record<string, number> = {
  // Romance Start — cultural/artistic
  art_gallery: 60,
  art_museum: 90,
  museum: 90,
  history_museum: 90,
  historical_place: 60,
  cultural_landmark: 45,
  monument: 30,
  performing_arts_theater: 120,
  opera_house: 150,
  // Romance Finish — dining
  italian_restaurant: 75,
  french_restaurant: 90,
  mediterranean_restaurant: 75,
  spanish_restaurant: 75,
  tapas_restaurant: 75,
  greek_restaurant: 75,
  seafood_restaurant: 75,
  sushi_restaurant: 60,
  wine_bar: 60,
  bistro: 75,
};

// ── Friendly Intent — Dedicated Place Type Groups ─────────────────────────
// Bypasses CURATED_TYPE_CATEGORIES + MINGLA_CATEGORY_PLACE_TYPES for 'friendly'.
// 2-stop itinerary: one of 4 starting groups → Friendly Finish (casual dining).
// Starting groups rotate 0→1→2→3→0→... for diversity.

interface FriendlyGroup {
  id: string;
  label: string;
  types: string[];
}

const FRIENDLY_STARTING_1: FriendlyGroup = {
  id: 'adrenaline',
  label: 'Adrenaline',
  types: [
    'amusement_park', 'bowling_alley', 'video_arcade',
    'go_karting_venue', 'miniature_golf_course', 'paintball_center',
    'ice_skating_rink', 'karaoke',
  ],
};

const FRIENDLY_STARTING_2: FriendlyGroup = {
  id: 'entertainment',
  label: 'Entertainment',
  types: [
    'movie_theater', 'concert_hall', 'performing_arts_theater',
    'opera_house', 'comedy_club',
  ],
};

const FRIENDLY_STARTING_3: FriendlyGroup = {
  id: 'outdoor',
  label: 'Outdoor',
  types: [
    'national_park', 'hiking_area', 'off_roading_area',
    'state_park', 'campground',
  ],
};

const FRIENDLY_STARTING_4: FriendlyGroup = {
  id: 'cultural',
  label: 'Cultural',
  types: [
    'art_gallery', 'art_museum', 'art_studio',
    'cultural_center', 'museum',
  ],
};

const FRIENDLY_FINISH: FriendlyGroup = {
  id: 'casual_dining',
  label: 'Casual Dining',
  types: [
    'italian_restaurant', 'sushi_restaurant', 'mexican_restaurant',
    'thai_restaurant', 'mediterranean_restaurant', 'pizza_restaurant',
    'american_restaurant', 'hamburger_restaurant', 'diner',
    'barbecue_restaurant', 'fast_food_restaurant', 'ramen_restaurant',
    'korean_restaurant', 'buffet_restaurant', 'asian_restaurant',
    'sandwich_shop', 'vietnamese_restaurant', 'chinese_restaurant',
    'food_court',
  ],
};

const FRIENDLY_INTENT_EXCLUDED_PLACE_TYPES: string[] = [
  'indoor_playground',
  'childrens_camp',
];

// Strict rotation: [Starting 1, Starting 2, Starting 3, Starting 4, ...]
const FRIENDLY_STARTING_GROUPS: FriendlyGroup[] = [
  FRIENDLY_STARTING_1,
  FRIENDLY_STARTING_2,
  FRIENDLY_STARTING_3,
  FRIENDLY_STARTING_4,
];

// Stop durations specific to friendly groups
const FRIENDLY_STOP_DURATIONS: Record<string, number> = {
  // Starting 1 — Adrenaline
  amusement_park: 180,
  bowling_alley: 60,
  video_arcade: 60,
  go_karting_venue: 60,
  miniature_golf_course: 45,
  paintball_center: 90,
  ice_skating_rink: 60,
  karaoke: 90,
  // Starting 2 — Entertainment
  movie_theater: 150,
  concert_hall: 120,
  performing_arts_theater: 120,
  opera_house: 150,
  comedy_club: 90,
  // Starting 3 — Outdoor
  national_park: 120,
  hiking_area: 120,
  off_roading_area: 90,
  state_park: 120,
  campground: 120,
  // Starting 4 — Cultural
  art_gallery: 60,
  art_museum: 90,
  art_studio: 60,
  cultural_center: 60,
  museum: 90,
  // Finish — Casual Dining
  italian_restaurant: 60,
  sushi_restaurant: 60,
  mexican_restaurant: 60,
  thai_restaurant: 60,
  mediterranean_restaurant: 60,
  pizza_restaurant: 45,
  american_restaurant: 60,
  hamburger_restaurant: 30,
  diner: 45,
  barbecue_restaurant: 75,
  fast_food_restaurant: 20,
  ramen_restaurant: 45,
  korean_restaurant: 60,
  buffet_restaurant: 60,
  asian_restaurant: 60,
  sandwich_shop: 30,
  vietnamese_restaurant: 60,
  chinese_restaurant: 60,
  food_court: 30,
};

// ── Group Fun Intent — Dedicated Place Type Groups ─────────────────────────
// Bypasses CURATED_TYPE_CATEGORIES + MINGLA_CATEGORY_PLACE_TYPES for 'group-fun'.
// 2-stop itinerary: one of 2 starting groups → Group Fun Finish (casual dining).
// Starting groups alternate 0→1→0→1→... for diversity.
// NOTE: Types overlap with Friendly groups but are deliberately separate constants
// for zero-coupling between intents.

interface GroupFunGroup {
  id: string;
  label: string;
  types: string[];
}

const GROUP_FUN_STARTING_1: GroupFunGroup = {
  id: 'activity',
  label: 'Activity',
  types: [
    'amusement_park', 'bowling_alley', 'video_arcade',
    'go_karting_venue', 'miniature_golf_course', 'paintball_center',
    'ice_skating_rink', 'karaoke',
  ],
};

const GROUP_FUN_STARTING_2: GroupFunGroup = {
  id: 'entertainment',
  label: 'Entertainment',
  types: [
    'movie_theater', 'concert_hall', 'performing_arts_theater',
    'opera_house', 'comedy_club',
  ],
};

const GROUP_FUN_FINISH: GroupFunGroup = {
  id: 'casual_dining',
  label: 'Casual Dining',
  types: [
    'italian_restaurant', 'sushi_restaurant', 'mexican_restaurant',
    'thai_restaurant', 'mediterranean_restaurant', 'pizza_restaurant',
    'american_restaurant', 'hamburger_restaurant', 'diner',
    'barbecue_restaurant', 'fast_food_restaurant', 'ramen_restaurant',
    'korean_restaurant', 'buffet_restaurant', 'asian_restaurant',
    'sandwich_shop', 'vietnamese_restaurant', 'chinese_restaurant',
    'food_court',
  ],
};

const GROUP_FUN_EXCLUDED_PLACE_TYPES: string[] = [
  'water_park',
  'library',
  'coworking_space',
  'business_center',
];

// Strict alternation: [Starting 1, Starting 2, Starting 1, Starting 2, ...]
const GROUP_FUN_STARTING_GROUPS: GroupFunGroup[] = [
  GROUP_FUN_STARTING_1,
  GROUP_FUN_STARTING_2,
];

// Stop durations specific to group fun groups
const GROUP_FUN_STOP_DURATIONS: Record<string, number> = {
  // Starting 1 — Activity
  amusement_park: 180,
  bowling_alley: 60,
  video_arcade: 60,
  go_karting_venue: 60,
  miniature_golf_course: 45,
  paintball_center: 90,
  ice_skating_rink: 60,
  karaoke: 90,
  // Starting 2 — Entertainment
  movie_theater: 150,
  concert_hall: 120,
  performing_arts_theater: 120,
  opera_house: 150,
  comedy_club: 90,
  // Finish — Casual Dining
  italian_restaurant: 60,
  sushi_restaurant: 60,
  mexican_restaurant: 60,
  thai_restaurant: 60,
  mediterranean_restaurant: 60,
  pizza_restaurant: 45,
  american_restaurant: 60,
  hamburger_restaurant: 30,
  diner: 45,
  barbecue_restaurant: 75,
  fast_food_restaurant: 20,
  ramen_restaurant: 45,
  korean_restaurant: 60,
  buffet_restaurant: 60,
  asian_restaurant: 60,
  sandwich_shop: 30,
  vietnamese_restaurant: 60,
  chinese_restaurant: 60,
  food_court: 30,
};

// ── Picnic Dates Intent — Dedicated Place Type Groups ─────────────────────
// Replaces the old generatePicnicCards() which used broad 'Groceries & Flowers' + 'Picnic'
// category pools. Now uses narrower, hand-picked types for more precise results.
// 2-stop itinerary: Grocery → Park/Picnic Spot.
// No alternation — single starting group, single finish group.

interface PicnicGroup {
  id: string;
  label: string;
  types: string[];
}

const PICNIC_START: PicnicGroup = {
  id: 'grocery',
  label: 'Grocery',
  types: [
    'grocery_store',
    'supermarket',
  ],
};

const PICNIC_FINISH: PicnicGroup = {
  id: 'picnic_spot',
  label: 'Picnic Spot',
  types: [
    'park',
    'picnic_ground',
    'beach',
  ],
};

const PICNIC_EXCLUDED_PLACE_TYPES: string[] = [
  'department_store',
  'electronics_store',
  'furniture_store',
  'warehouse_store',
];

// Static shopping list fallback — single source of truth for all picnic code paths
const PICNIC_STATIC_SHOPPING_LIST: string[] = [
  '🥖 Fresh baguette or ciabatta',
  '🧀 Soft cheese (brie or camembert)',
  '🍇 Seasonal fruit (grapes, strawberries)',
  '🥗 Pre-made salad or hummus & crackers',
  '🍫 Dark chocolate or brownies',
  '💧 Sparkling water',
  '🍷 Bottle of wine or lemonade',
  '🧃 Juice boxes or iced tea',
  '💐 Small bouquet of wildflowers',
  '🧻 Napkins and a picnic blanket',
];

// Stop durations specific to picnic dates
const PICNIC_STOP_DURATIONS: Record<string, number> = {
  // Start — Grocery
  grocery_store: 30,
  supermarket: 30,
  // Finish — Picnic Spot
  park: 120,
  picnic_ground: 120,
  beach: 150,
};

// ── Curated Type -> Mingla Category Pools ─────────────────────────
// NOTE: 'adventurous' entry is required for the validation gate in serve()
// (line ~1264: `if (!CURATED_TYPE_CATEGORIES[experienceType])`).
// The adventure pipeline itself bypasses this pool via generateAdventureCards().
// Do NOT remove the 'adventurous' key — requests will 400.
const CURATED_TYPE_CATEGORIES: Record<string, string[]> = {
  'adventurous':   ['Nature', 'First Meet', 'Casual Eats', 'Fine Dining', 'Creative & Arts', 'Play'],
  'first-date':    ['Fine Dining', 'Watch', 'Nature', 'First Meet', 'Creative & Arts', 'Play'],
  'romantic':      ['Fine Dining', 'Creative & Arts', 'Wellness'],
  'friendly':      ['Play', 'Creative & Arts', 'Watch', 'Fine Dining', 'Casual Eats', 'Nature'],
  'group-fun':     ['Play', 'Watch', 'Casual Eats'],
  'picnic-dates':  ['Groceries & Flowers', 'Picnic'],
  'take-a-stroll': ['Casual Eats', 'Nature'],
};

const CURATED_TYPE_LABELS: Record<string, string> = {
  'adventurous': 'Adventurous',
  'first-date': 'First Date',
  'romantic': 'Romantic',
  'friendly': 'Friendly',
  'group-fun': 'Group Fun',
  'picnic-dates': 'Picnic Dates',
  'take-a-stroll': 'Take a Stroll',
};

const TAGLINES_BY_TYPE: Record<string, string[]> = {
  'adventurous': [
    'Explore the unexpected — your next discovery awaits',
    'Three stops, endless possibilities',
    'Chart your own path through the city',
    'For the curious soul who loves to wander',
  ],
  'first-date': [
    'A thoughtful route for a great first impression',
    'Two stops to break the ice',
    'An effortless plan for getting to know someone',
    'Low pressure, high adventure',
  ],
  'romantic': [
    'A curated route for two',
    'Culture and cuisine, perfectly paired',
    'An evening worth dressing up for',
    'Set the mood with a plan worth sharing',
  ],
  'friendly': [
    'A day out worth catching up over',
    'Two stops, good company, great vibes',
    'The kind of plan friends remember',
    'Explore together, no planning needed',
  ],
  'group-fun': [
    'Rally the crew — adventure is calling',
    'Two stops of pure group energy',
    'Good times are better together',
    'A plan the whole squad will love',
  ],
  'picnic-dates': [
    'Grab supplies, find the perfect spot',
    'A picnic plan from store to park',
    'Simple pleasures, perfect together',
    'Your curated picnic, start to finish',
  ],
  'take-a-stroll': [
    'Eat, walk, eat — the perfect loop',
    'A scenic stroll bookended by great food',
    'Nature and bites, perfectly paired',
    'The casual combo that never gets old',
  ],
};

// Types that need text search instead of Nearby Search
const TEXT_SEARCH_TYPES = new Set([
  'sip_and_paint', 'pottery', 'cooking_classes', 'woodworking_class',
  'jewelry_making_studio', 'sewing_class', 'glass_blowing_studio',
  'diy_workshop', 'perfume_lab', 'flower_arranging_studio',
  'bakery_workshop', 'coffee_roastery', 'comedy_club',
  'chef_led_restaurant', 'upscale_restaurant',
  'float_tank_center', 'cold_plunge_facility',
  'adventure_park', 'roller_coaster', 'ferris_wheel',
  'rock_climbing_gym', 'batting_cages', 'laser_tag',
  'paintball', 'billiards_hall', 'dart_bar',
  'board_game_cafe', 'virtual_reality_center', 'go_kart_track',
]);

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

async function searchNearby(includedType: string, lat: number, lng: number, radiusMeters: number, excludedTypes?: string[]): Promise<any[]> {
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
    excludedTypes,
  });
  return places;
}

async function searchByText(textQuery: string, lat: number, lng: number, radiusMeters: number, excludedTypes?: string[]): Promise<any[]> {
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
    excludedTypes,
  });
  return places;
}

// ── Place fetching, card building, and generators ─────────────────

/**
 * Fetch places for a single Mingla category.
 * Uses multiple parallel searchNearby calls (one per type, max 10 types) since
 * the existing helper accepts a single type.
 * Falls back to text search for niche types if needed.
 */
async function fetchPlacesForCategory(
  categoryName: string,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<any[]> {
  const allTypes = MINGLA_CATEGORY_PLACE_TYPES[categoryName] || [];
  if (allTypes.length === 0) return [];

  const excludedTypes = GLOBAL_EXCLUDED_PLACE_TYPES;

  const nearbyTypes = allTypes.filter(t => !TEXT_SEARCH_TYPES.has(t));
  const textTypes   = allTypes.filter(t => TEXT_SEARCH_TYPES.has(t));

  const results: any[] = [];

  // 1. Batch Nearby Search — parallel calls for up to 10 random types
  if (nearbyTypes.length > 0) {
    const typesToSearch = shuffle(nearbyTypes).slice(0, 10);
    const nearbyResults = await Promise.allSettled(
      typesToSearch.map(t => searchNearby(t, lat, lng, radiusMeters, excludedTypes))
    );
    for (const r of nearbyResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(...r.value);
      }
    }
  }

  // 2. Text search fallback for niche types (only if nearby gave < 5 results)
  if (results.length < 5 && textTypes.length > 0) {
    const nicheType = textTypes[Math.floor(Math.random() * textTypes.length)];
    const query = nicheType.replace(/_/g, ' ');
    try {
      const textResults = await searchByText(query, lat, lng, radiusMeters, excludedTypes);
      results.push(...textResults);
    } catch (err) {
      console.warn(`[fetchPlacesForCategory] Text search failed for ${nicheType}:`, err);
    }
  }

  // Dedupe by place ID, sort by score
  const seen = new Set<string>();
  const deduped = results.filter(p => {
    const id = p.id || p.name;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Post-fetch filter: remove any places with excluded types
  const filtered = filterExcludedPlaces(deduped);

  return filtered.sort((a: any, b: any) => scorePlace(b) - scorePlace(a));
}

/**
 * Fetch places for a single Adventure Group.
 * Similar to fetchPlacesForCategory but uses ADVENTURE_GROUPS types
 * and ADVENTURE_EXCLUDED_PLACE_TYPES instead of Mingla category mappings.
 */
async function fetchPlacesForAdventureGroup(
  group: AdventureGroup,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<any[]> {
  const excludedTypes = ADVENTURE_EXCLUDED_PLACE_TYPES;

  // Separate types into nearby-searchable and text-search-only
  const nearbyTypes = group.types.filter(t => !TEXT_SEARCH_TYPES.has(t));
  const textTypes = group.types.filter(t => TEXT_SEARCH_TYPES.has(t));

  const results: any[] = [];

  // 1. Nearby Search — parallel calls, shuffle and pick up to 10
  if (nearbyTypes.length > 0) {
    const typesToSearch = shuffle(nearbyTypes).slice(0, 10);
    const nearbyResults = await Promise.allSettled(
      typesToSearch.map(t => searchNearby(t, lat, lng, radiusMeters, excludedTypes))
    );
    for (const r of nearbyResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(...r.value);
      }
    }
  }

  // 2. Text search fallback for niche types if nearby gave < 5 results
  if (results.length < 5 && textTypes.length > 0) {
    const nicheType = textTypes[Math.floor(Math.random() * textTypes.length)];
    const query = nicheType.replace(/_/g, ' ');
    try {
      const textResults = await searchByText(query, lat, lng, radiusMeters, excludedTypes);
      results.push(...textResults);
    } catch (err) {
      console.warn(`[fetchPlacesForAdventureGroup] Text search failed for ${nicheType}:`, err);
    }
  }

  // Dedupe by place ID, sort by score
  const seen = new Set<string>();
  const deduped = results.filter(p => {
    const id = p.id || p.name;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Post-fetch filter: remove places with adventure-excluded types
  const filtered = filterExcludedPlaces(deduped, ADVENTURE_EXCLUDED_PLACE_TYPES);

  return filtered.sort((a: any, b: any) => scorePlace(b) - scorePlace(a));
}

/**
 * Fetch places for a single First Date Group.
 * Uses FIRST_DATE_EXCLUDED_PLACE_TYPES for filtering.
 */
async function fetchPlacesForFirstDateGroup(
  group: FirstDateGroup,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<any[]> {
  const excludedTypes = FIRST_DATE_EXCLUDED_PLACE_TYPES;

  const nearbyTypes = group.types.filter(t => !TEXT_SEARCH_TYPES.has(t));
  const textTypes = group.types.filter(t => TEXT_SEARCH_TYPES.has(t));

  const results: any[] = [];

  if (nearbyTypes.length > 0) {
    const typesToSearch = shuffle(nearbyTypes).slice(0, 10);
    const nearbyResults = await Promise.allSettled(
      typesToSearch.map(t => searchNearby(t, lat, lng, radiusMeters, excludedTypes))
    );
    for (const r of nearbyResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(...r.value);
      }
    }
  }

  if (results.length < 5 && textTypes.length > 0) {
    const nicheType = textTypes[Math.floor(Math.random() * textTypes.length)];
    const query = nicheType.replace(/_/g, ' ');
    try {
      const textResults = await searchByText(query, lat, lng, radiusMeters, excludedTypes);
      results.push(...textResults);
    } catch (err) {
      console.warn(`[fetchPlacesForFirstDateGroup] Text search failed for ${nicheType}:`, err);
    }
  }

  const seen = new Set<string>();
  const deduped = results.filter(p => {
    const id = p.id || p.name;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const filtered = filterExcludedPlaces(deduped, FIRST_DATE_EXCLUDED_PLACE_TYPES);

  return filtered.sort((a: any, b: any) => scorePlace(b) - scorePlace(a));
}

/**
 * Fetch places for a single Romantic Group.
 * Uses ROMANTIC_INTENT_EXCLUDED_PLACE_TYPES for filtering.
 */
async function fetchPlacesForRomanticGroup(
  group: RomanticGroup,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<any[]> {
  const excludedTypes = ROMANTIC_INTENT_EXCLUDED_PLACE_TYPES;

  const nearbyTypes = group.types.filter(t => !TEXT_SEARCH_TYPES.has(t));
  const textTypes = group.types.filter(t => TEXT_SEARCH_TYPES.has(t));

  const results: any[] = [];

  if (nearbyTypes.length > 0) {
    const typesToSearch = shuffle(nearbyTypes).slice(0, 10);
    const nearbyResults = await Promise.allSettled(
      typesToSearch.map(t => searchNearby(t, lat, lng, radiusMeters, excludedTypes))
    );
    for (const r of nearbyResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(...r.value);
      }
    }
  }

  if (results.length < 5 && textTypes.length > 0) {
    const nicheType = textTypes[Math.floor(Math.random() * textTypes.length)];
    const query = nicheType.replace(/_/g, ' ');
    try {
      const textResults = await searchByText(query, lat, lng, radiusMeters, excludedTypes);
      results.push(...textResults);
    } catch (err) {
      console.warn(`[fetchPlacesForRomanticGroup] Text search failed for ${nicheType}:`, err);
    }
  }

  const seen = new Set<string>();
  const deduped = results.filter(p => {
    const id = p.id || p.name;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const filtered = filterExcludedPlaces(deduped, ROMANTIC_INTENT_EXCLUDED_PLACE_TYPES);

  return filtered.sort((a: any, b: any) => scorePlace(b) - scorePlace(a));
}

/**
 * Fetch places for a single Friendly Group.
 * Uses FRIENDLY_INTENT_EXCLUDED_PLACE_TYPES for filtering.
 */
async function fetchPlacesForFriendlyGroup(
  group: FriendlyGroup,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<any[]> {
  const excludedTypes = FRIENDLY_INTENT_EXCLUDED_PLACE_TYPES;

  const nearbyTypes = group.types.filter(t => !TEXT_SEARCH_TYPES.has(t));
  const textTypes = group.types.filter(t => TEXT_SEARCH_TYPES.has(t));

  const results: any[] = [];

  if (nearbyTypes.length > 0) {
    const typesToSearch = shuffle(nearbyTypes).slice(0, 10);
    const nearbyResults = await Promise.allSettled(
      typesToSearch.map(t => searchNearby(t, lat, lng, radiusMeters, excludedTypes))
    );
    for (const r of nearbyResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(...r.value);
      }
    }
  }

  if (results.length < 5 && textTypes.length > 0) {
    const nicheType = textTypes[Math.floor(Math.random() * textTypes.length)];
    const query = nicheType.replace(/_/g, ' ');
    try {
      const textResults = await searchByText(query, lat, lng, radiusMeters, excludedTypes);
      results.push(...textResults);
    } catch (err) {
      console.warn(`[fetchPlacesForFriendlyGroup] Text search failed for ${nicheType}:`, err);
    }
  }

  const seen = new Set<string>();
  const deduped = results.filter(p => {
    const id = p.id || p.name;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const filtered = filterExcludedPlaces(deduped, FRIENDLY_INTENT_EXCLUDED_PLACE_TYPES);

  return filtered.sort((a: any, b: any) => scorePlace(b) - scorePlace(a));
}

/**
 * Fetch places for a single Group Fun Group.
 * Uses GROUP_FUN_EXCLUDED_PLACE_TYPES for filtering.
 */
async function fetchPlacesForGroupFunGroup(
  group: GroupFunGroup,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<any[]> {
  const excludedTypes = GROUP_FUN_EXCLUDED_PLACE_TYPES;

  const nearbyTypes = group.types.filter(t => !TEXT_SEARCH_TYPES.has(t));
  const textTypes = group.types.filter(t => TEXT_SEARCH_TYPES.has(t));

  const results: any[] = [];

  if (nearbyTypes.length > 0) {
    const typesToSearch = shuffle(nearbyTypes).slice(0, 10);
    const nearbyResults = await Promise.allSettled(
      typesToSearch.map(t => searchNearby(t, lat, lng, radiusMeters, excludedTypes))
    );
    for (const r of nearbyResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(...r.value);
      }
    }
  }

  if (results.length < 5 && textTypes.length > 0) {
    const nicheType = textTypes[Math.floor(Math.random() * textTypes.length)];
    const query = nicheType.replace(/_/g, ' ');
    try {
      const textResults = await searchByText(query, lat, lng, radiusMeters, excludedTypes);
      results.push(...textResults);
    } catch (err) {
      console.warn(`[fetchPlacesForGroupFunGroup] Text search failed for ${nicheType}:`, err);
    }
  }

  const seen = new Set<string>();
  const deduped = results.filter(p => {
    const id = p.id || p.name;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const filtered = filterExcludedPlaces(deduped, GROUP_FUN_EXCLUDED_PLACE_TYPES);

  return filtered.sort((a: any, b: any) => scorePlace(b) - scorePlace(a));
}

/**
 * Fetch places for a single Picnic Group.
 * Uses PICNIC_EXCLUDED_PLACE_TYPES for filtering.
 */
async function fetchPlacesForPicnicGroup(
  group: PicnicGroup,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<any[]> {
  const excludedTypes = PICNIC_EXCLUDED_PLACE_TYPES;

  const nearbyTypes = group.types.filter(t => !TEXT_SEARCH_TYPES.has(t));
  const textTypes = group.types.filter(t => TEXT_SEARCH_TYPES.has(t));

  const results: any[] = [];

  if (nearbyTypes.length > 0) {
    const typesToSearch = shuffle(nearbyTypes).slice(0, 10);
    const nearbyResults = await Promise.allSettled(
      typesToSearch.map(t => searchNearby(t, lat, lng, radiusMeters, excludedTypes))
    );
    for (const r of nearbyResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(...r.value);
      }
    }
  }

  if (results.length < 5 && textTypes.length > 0) {
    const nicheType = textTypes[Math.floor(Math.random() * textTypes.length)];
    const query = nicheType.replace(/_/g, ' ');
    try {
      const textResults = await searchByText(query, lat, lng, radiusMeters, excludedTypes);
      results.push(...textResults);
    } catch (err) {
      console.warn(`[fetchPlacesForPicnicGroup] Text search failed for ${nicheType}:`, err);
    }
  }

  const seen = new Set<string>();
  const deduped = results.filter(p => {
    const id = p.id || p.name;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const filtered = filterExcludedPlaces(deduped, PICNIC_EXCLUDED_PLACE_TYPES);

  return filtered.sort((a: any, b: any) => scorePlace(b) - scorePlace(a));
}

/**
 * Generate an AI picnic shopping list using OpenAI.
 * Returns 8-12 items across food, drinks, and flowers categories.
 * Falls back to a static list if OpenAI is unavailable.
 */
async function generatePicnicShoppingList(
  groceryName: string,
  picnicSpotName: string,
  picnicSpotType: string,
): Promise<string[]> {
  if (!OPENAI_API_KEY) {
    return [...PICNIC_STATIC_SHOPPING_LIST];
  }

  try {
    const spotContext = picnicSpotType === 'beach' ? 'at the beach' : 'in the park';
    const prompt = `You are a picnic planner. Generate a shopping list for a spontaneous picnic ${spotContext} at "${picnicSpotName}". The shopper is at "${groceryName}".

Return exactly 10 items as a JSON array of strings. Each item should be:
- A specific, actionable shopping item (not a category)
- Prefixed with one relevant emoji
- Mix of: 5-6 food items, 2-3 drink items, 1 flowers item, 1 practical item (napkins/blanket/utensils)
- Assume 2 people, casual and fun
- Items should be easy to find at any grocery store

Output ONLY a JSON array of 10 strings. No markdown, no keys, no explanation.

Example format: ["🥖 Sourdough baguette", "🧀 Brie and crackers", ...]`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.9,
      }),
    });
    const json = await res.json();
    let content = json.choices?.[0]?.message?.content?.trim() ?? '[]';
    // Strip markdown code fences if OpenAI wraps the response (e.g. ```json\n[...]\n```)
    content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed: string[] = JSON.parse(content);

    if (Array.isArray(parsed) && parsed.length >= 8 && parsed.length <= 12) {
      return parsed;
    }
    // If the model returns a valid array but short, pad with fallback items to reach 10
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (parsed.length > 12) return parsed.slice(0, 12);
      if (parsed.length < 8) {
        const existingSet = new Set(parsed.map(s => s.toLowerCase()));
        for (const fallbackItem of PICNIC_STATIC_SHOPPING_LIST) {
          if (parsed.length >= 10) break;
          if (!existingSet.has(fallbackItem.toLowerCase())) {
            parsed.push(fallbackItem);
            existingSet.add(fallbackItem.toLowerCase());
          }
        }
      }
      return parsed;
    }
    throw new Error('Unexpected shape');
  } catch (err) {
    console.warn('[generatePicnicShoppingList] AI generation failed, using fallback:', err);
    return [...PICNIC_STATIC_SHOPPING_LIST];
  }
}

/**
 * Generate curated adventure cards using dedicated Adventure Groups.
 * Picks 3 of 4 groups per card, rotating all 4 combos round-robin.
 */
async function generateAdventureCards(
  lat: number,
  lng: number,
  budgetMax: number,
  travelMode: string,
  travelConstraintType: string,
  travelConstraintValue: number,
  limit: number,
  skipDescriptions: boolean,
): Promise<any[]> {
  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = travelConstraintType === 'time'
    ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
    : travelConstraintValue * 1000;
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // 1. Fetch places for ALL 4 adventure groups in parallel
  const groupPlaces: Record<string, any[]> = {};
  await Promise.all(
    ADVENTURE_GROUPS.map(async (group) => {
      const places = await fetchPlacesForAdventureGroup(group, lat, lng, clampedRadius);
      groupPlaces[group.id] = places;
    })
  );

  for (const [groupId, places] of Object.entries(groupPlaces)) {
    console.log(`[generateAdventureCards] ${groupId}: ${places.length} places`);
  }

  // 2. Build round-robin combo list: rotate all 4 combos until we have enough
  const comboList: number[][] = [];
  while (comboList.length < limit * 2) {
    comboList.push(...shuffle([...ADVENTURE_COMBOS]));
  }

  // 3. Build cards
  const cards: any[] = [];
  const globalUsedPlaceIds = new Set<string>();
  const perStopBudget = budgetMax / 3;

  for (const comboIndices of comboList) {
    if (cards.length >= limit) break;

    const comboGroups = comboIndices.map(i => ADVENTURE_GROUPS[i]);
    const stops: any[] = [];
    const comboUsedIds = new Set(globalUsedPlaceIds);
    let valid = true;
    let prevLat = lat;
    let prevLng = lng;

    for (let i = 0; i < comboGroups.length; i++) {
      const group = comboGroups[i];
      const available = (groupPlaces[group.id] || []).filter(p => {
        const id = p.id || p.name;
        if (comboUsedIds.has(id)) return false;
        const price = priceLevelToRange(p.priceLevel);
        if (price.min > perStopBudget) return false;
        return true;
      });

      if (available.length === 0) {
        valid = false;
        break;
      }

      const place = available[0]; // already sorted by score
      const placeId = place.id || place.name;
      comboUsedIds.add(placeId);

      // Resolve place type: prefer primaryType, then match place.types against group, then fallback
      const groupTypeSet = new Set(group.types);
      const matchedGroupType = (place.types || []).find((t: string) => groupTypeSet.has(t));
      const placeType = place.primaryType || matchedGroupType || group.types[0];
      const originalDuration = STOP_DURATION_MINUTES[placeType] || DEFAULT_STOP_DURATION;
      const adventureDuration = ADVENTURE_STOP_DURATIONS[placeType] || originalDuration;

      const stop = buildStopFromPlace(
        place, i + 1, comboGroups.length, group.label,
        lat, lng,
        i > 0 ? prevLat : null,
        i > 0 ? prevLng : null,
        travelMode,
      );

      // Override duration with adventure-specific value
      stop.estimatedDurationMinutes = adventureDuration;

      stops.push(stop);
      prevLat = stop.lat;
      prevLng = stop.lng;
    }

    if (!valid || stops.length !== comboGroups.length) continue;

    // Validate total budget
    const totalMin = stops.reduce((s, st) => s + st.priceMin, 0);
    if (totalMin > budgetMax) continue;

    // Validate travel constraint
    if (travelConstraintType === 'time' && stops[0].travelTimeFromUserMin > travelConstraintValue * 1.5) {
      continue;
    }

    const comboLabels = comboGroups.map(g => g.label);
    const card = buildCardFromStops(stops, 'adventurous', comboLabels);

    if (!skipDescriptions) {
      try {
        const descriptions = await generateStopDescriptions(stops);
        for (let i = 0; i < stops.length; i++) {
          if (descriptions[i]) card.stops[i].aiDescription = descriptions[i];
        }
      } catch (err) {
        console.warn('[generateAdventureCards] AI description failed:', err);
      }
    }

    // Track used place IDs globally to maximize variety
    for (const stop of stops) {
      globalUsedPlaceIds.add(stop.placeId);
    }

    cards.push(card);
  }

  return cards;
}

/**
 * Generate curated first-date cards using dedicated First Date Groups.
 * 2-stop itineraries: Starting group → Finish.
 * Strict alternation between Starting 1 and Starting 2.
 */
async function generateFirstDateCards(
  lat: number,
  lng: number,
  budgetMax: number,
  travelMode: string,
  travelConstraintType: string,
  travelConstraintValue: number,
  limit: number,
  skipDescriptions: boolean,
): Promise<any[]> {
  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = travelConstraintType === 'time'
    ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
    : travelConstraintValue * 1000;
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // 1. Fetch places for all 3 groups in parallel
  const groupPlaces: Record<string, any[]> = {};
  await Promise.all([
    (async () => {
      groupPlaces[FIRST_DATE_STARTING_1.id] =
        await fetchPlacesForFirstDateGroup(FIRST_DATE_STARTING_1, lat, lng, clampedRadius);
    })(),
    (async () => {
      groupPlaces[FIRST_DATE_STARTING_2.id] =
        await fetchPlacesForFirstDateGroup(FIRST_DATE_STARTING_2, lat, lng, clampedRadius);
    })(),
    (async () => {
      groupPlaces[FIRST_DATE_FINISH.id] =
        await fetchPlacesForFirstDateGroup(FIRST_DATE_FINISH, lat, lng, clampedRadius);
    })(),
  ]);

  for (const [groupId, places] of Object.entries(groupPlaces)) {
    console.log(`[generateFirstDateCards] ${groupId}: ${places.length} places`);
  }

  // 2. Check we have finish places (required for every card)
  if ((groupPlaces[FIRST_DATE_FINISH.id] || []).length === 0) {
    console.warn('[generateFirstDateCards] No finish (dining) places found');
    return [];
  }

  // 3. Build cards with strict alternation
  const cards: any[] = [];
  const globalUsedPlaceIds = new Set<string>();
  const perStopBudget = budgetMax / 2; // 2 stops, not 3

  // nextGroupIndex tracks which starting group the NEXT built card should use.
  // Only flips on successful card build — skipped cards don't shift alternation.
  let nextGroupIndex = 0;

  for (let cardIndex = 0; cards.length < limit; cardIndex++) {
    const startingGroup = FIRST_DATE_STARTING_GROUPS[nextGroupIndex];
    const finishGroup = FIRST_DATE_FINISH;

    // Select starting place
    const availableStarts = (groupPlaces[startingGroup.id] || []).filter(p => {
      const id = p.id || p.name;
      if (globalUsedPlaceIds.has(id)) return false;
      const price = priceLevelToRange(p.priceLevel);
      if (price.min > perStopBudget) return false;
      return true;
    });

    // Select finish place
    const availableFinish = (groupPlaces[finishGroup.id] || []).filter(p => {
      const id = p.id || p.name;
      if (globalUsedPlaceIds.has(id)) return false;
      const price = priceLevelToRange(p.priceLevel);
      if (price.min > perStopBudget) return false;
      return true;
    });

    // If either group is exhausted for THIS starting type, try the other
    if (availableStarts.length === 0 || availableFinish.length === 0) {
      // Try the other starting group as fallback
      const fallbackGroup = FIRST_DATE_STARTING_GROUPS[(nextGroupIndex + 1) % 2];
      const fallbackStarts = (groupPlaces[fallbackGroup.id] || []).filter(p => {
        const id = p.id || p.name;
        if (globalUsedPlaceIds.has(id)) return false;
        const price = priceLevelToRange(p.priceLevel);
        if (price.min > perStopBudget) return false;
        return true;
      });

      if (fallbackStarts.length === 0 || availableFinish.length === 0) {
        break; // Both starting groups and/or finish exhausted
      }

      // Use fallback — still need a valid finish
      const startPlace = fallbackStarts[0];
      const finishPlace = availableFinish[0];
      const startId = startPlace.id || startPlace.name;
      const finishId = finishPlace.id || finishPlace.name;

      const stop1 = buildFirstDateStop(startPlace, 1, fallbackGroup, lat, lng, null, null, travelMode);
      const stop2 = buildFirstDateStop(finishPlace, 2, finishGroup, lat, lng, stop1.lat, stop1.lng, travelMode);

      const totalMin = stop1.priceMin + stop2.priceMin;
      if (totalMin > budgetMax) {
        globalUsedPlaceIds.add(startId);
        continue;
      }

      if (travelConstraintType === 'time' && stop1.travelTimeFromUserMin > travelConstraintValue * 1.5) {
        globalUsedPlaceIds.add(startId);
        continue;
      }

      const card = buildCardFromStops([stop1, stop2], 'first-date', [fallbackGroup.label, finishGroup.label]);

      if (!skipDescriptions) {
        try {
          const descriptions = await generateStopDescriptions([stop1, stop2]);
          for (let i = 0; i < 2 && i < descriptions.length; i++) {
            card.stops[i].aiDescription = descriptions[i];
          }
        } catch (err) {
          console.warn('[generateFirstDateCards] AI description failed:', err);
        }
      }

      globalUsedPlaceIds.add(startId);
      globalUsedPlaceIds.add(finishId);
      cards.push(card);
      nextGroupIndex = (nextGroupIndex + 1) % 2; // Flip on successful build
      continue;
    }

    // Normal path: use the alternating starting group
    const startPlace = availableStarts[0];
    const finishPlace = availableFinish[0];
    const startId = startPlace.id || startPlace.name;
    const finishId = finishPlace.id || finishPlace.name;

    const stop1 = buildFirstDateStop(startPlace, 1, startingGroup, lat, lng, null, null, travelMode);
    const stop2 = buildFirstDateStop(finishPlace, 2, finishGroup, lat, lng, stop1.lat, stop1.lng, travelMode);

    // Validate total budget
    const totalMin = stop1.priceMin + stop2.priceMin;
    if (totalMin > budgetMax) {
      globalUsedPlaceIds.add(startId); // Skip this start, try next — DON'T flip alternation
      continue;
    }

    // Validate travel constraint
    if (travelConstraintType === 'time' && stop1.travelTimeFromUserMin > travelConstraintValue * 1.5) {
      globalUsedPlaceIds.add(startId); // Skip — DON'T flip alternation
      continue;
    }

    const card = buildCardFromStops([stop1, stop2], 'first-date', [startingGroup.label, finishGroup.label]);

    if (!skipDescriptions) {
      try {
        const descriptions = await generateStopDescriptions([stop1, stop2]);
        for (let i = 0; i < 2 && i < descriptions.length; i++) {
          card.stops[i].aiDescription = descriptions[i];
        }
      } catch (err) {
        console.warn('[generateFirstDateCards] AI description failed:', err);
      }
    }

    globalUsedPlaceIds.add(startId);
    globalUsedPlaceIds.add(finishId);
    cards.push(card);
    nextGroupIndex = (nextGroupIndex + 1) % 2; // Flip on successful build

    // Safety: if we've iterated way past the limit without filling, break
    if (cardIndex > limit * 4) break;
  }

  return cards;
}

/**
 * Build a stop for a first-date card with first-date-specific duration.
 */
function buildFirstDateStop(
  place: any,
  stopNumber: number,
  group: FirstDateGroup,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
): any {
  const stop = buildStopFromPlace(
    place, stopNumber, 2, group.label,
    userLat, userLng, prevLat, prevLng, travelMode,
  );

  // Override duration with first-date-specific value
  const placeType = place.primaryType || group.types[0];
  const firstDateDuration = FIRST_DATE_STOP_DURATIONS[placeType];
  if (firstDateDuration) {
    stop.estimatedDurationMinutes = firstDateDuration;
  }

  return stop;
}

/**
 * Generate curated romantic cards using dedicated Romantic Groups.
 * 2-stop itineraries: Romance Start → Romance Finish.
 * No alternation needed — there's only one starting group.
 */
async function generateRomanticCards(
  lat: number,
  lng: number,
  budgetMax: number,
  travelMode: string,
  travelConstraintType: string,
  travelConstraintValue: number,
  limit: number,
  skipDescriptions: boolean,
): Promise<any[]> {
  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = travelConstraintType === 'time'
    ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
    : travelConstraintValue * 1000;
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // 1. Fetch places for both groups in parallel
  const groupPlaces: Record<string, any[]> = {};
  await Promise.all([
    (async () => {
      groupPlaces[ROMANTIC_START.id] =
        await fetchPlacesForRomanticGroup(ROMANTIC_START, lat, lng, clampedRadius);
    })(),
    (async () => {
      groupPlaces[ROMANTIC_FINISH.id] =
        await fetchPlacesForRomanticGroup(ROMANTIC_FINISH, lat, lng, clampedRadius);
    })(),
  ]);

  for (const [groupId, places] of Object.entries(groupPlaces)) {
    console.log(`[generateRomanticCards] ${groupId}: ${places.length} places`);
  }

  // 2. Check we have finish places (required for every card)
  if ((groupPlaces[ROMANTIC_FINISH.id] || []).length === 0) {
    console.warn('[generateRomanticCards] No finish (dining) places found');
    return [];
  }

  // 3. Check we have start places
  if ((groupPlaces[ROMANTIC_START.id] || []).length === 0) {
    console.warn('[generateRomanticCards] No start (cultural) places found');
    return [];
  }

  // 4. Build cards
  const cards: any[] = [];
  const globalUsedPlaceIds = new Set<string>();
  const perStopBudget = budgetMax / 2; // 2 stops

  for (let cardIndex = 0; cards.length < limit; cardIndex++) {
    // Select start place
    const availableStarts = (groupPlaces[ROMANTIC_START.id] || []).filter(p => {
      const id = p.id || p.name;
      if (globalUsedPlaceIds.has(id)) return false;
      const price = priceLevelToRange(p.priceLevel);
      if (price.min > perStopBudget) return false;
      return true;
    });

    // Select finish place
    const availableFinish = (groupPlaces[ROMANTIC_FINISH.id] || []).filter(p => {
      const id = p.id || p.name;
      if (globalUsedPlaceIds.has(id)) return false;
      const price = priceLevelToRange(p.priceLevel);
      if (price.min > perStopBudget) return false;
      return true;
    });

    // If either group is exhausted, stop
    if (availableStarts.length === 0 || availableFinish.length === 0) {
      break;
    }

    const startPlace = availableStarts[0]; // already sorted by score
    const finishPlace = availableFinish[0];
    const startId = startPlace.id || startPlace.name;
    const finishId = finishPlace.id || finishPlace.name;

    const stop1 = buildRomanticStop(startPlace, 1, ROMANTIC_START, lat, lng, null, null, travelMode);
    const stop2 = buildRomanticStop(finishPlace, 2, ROMANTIC_FINISH, lat, lng, stop1.lat, stop1.lng, travelMode);

    // Validate total budget
    const totalMin = stop1.priceMin + stop2.priceMin;
    if (totalMin > budgetMax) {
      globalUsedPlaceIds.add(startId); // Skip this start, try next
      continue;
    }

    // Validate travel constraint
    if (travelConstraintType === 'time' && stop1.travelTimeFromUserMin > travelConstraintValue * 1.5) {
      globalUsedPlaceIds.add(startId); // Skip — too far
      continue;
    }

    const card = buildCardFromStops([stop1, stop2], 'romantic', [ROMANTIC_START.label, ROMANTIC_FINISH.label]);

    if (!skipDescriptions) {
      try {
        const descriptions = await generateRomanticStopDescriptions([stop1, stop2]);
        for (let i = 0; i < 2 && i < descriptions.length; i++) {
          card.stops[i].aiDescription = descriptions[i];
        }
      } catch (err) {
        console.warn('[generateRomanticCards] AI description failed:', err);
      }
    }

    globalUsedPlaceIds.add(startId);
    globalUsedPlaceIds.add(finishId);
    cards.push(card);

    // Safety: if we've iterated way past the limit without filling, break
    if (cardIndex > limit * 4) break;
  }

  return cards;
}

/**
 * Build a stop for a romantic card with romantic-specific duration.
 * Also overrides placeType to actual Google type (not group label fallback).
 */
function buildRomanticStop(
  place: any,
  stopNumber: number,
  group: RomanticGroup,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
): any {
  const stop = buildStopFromPlace(
    place, stopNumber, 2, group.label,
    userLat, userLng, prevLat, prevLng, travelMode,
  );

  // Override placeType to actual Google type (not group label fallback like 'romance_start')
  const resolvedType = place.primaryType || group.types[0];
  stop.placeType = resolvedType;

  // Override duration with romantic-specific value
  const romanticDuration = ROMANTIC_STOP_DURATIONS[resolvedType];
  if (romanticDuration) {
    stop.estimatedDurationMinutes = romanticDuration;
  }

  return stop;
}

/**
 * Generate AI descriptions specifically toned for romantic outings.
 * Uses a romantic prompt instead of the adventure-oriented generic one.
 */
async function generateRomanticStopDescriptions(
  stops: any[],
): Promise<string[]> {
  if (!OPENAI_API_KEY) {
    return stops.map(s => `${s.placeName} is a lovely ${s.placeType.replace(/_/g, ' ')} perfect for a romantic outing.`);
  }
  try {
    const stopList = stops
      .map((s, i) => `Stop ${i + 1}: ${s.placeName} (${s.placeType.replace(/_/g, ' ')}), rated ${s.rating.toFixed(1)}/5`)
      .join('\n');
    const prompt = `You are a travel writer creating short descriptions for a romantic date.
Write exactly ${stops.length} short paragraphs (one per stop, 2-3 sentences each), telling the couple what to experience and the atmosphere.
Emphasize romance, intimacy, and elegance. Write for a couple on a date — not friends, not a group.
Be specific, warm, and evocative. Address the reader directly as "you".
Output ONLY a JSON array of ${stops.length} strings with no markdown and no extra keys.

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
    return stops.map(s => `${s.placeName} is a lovely ${s.placeType.replace(/_/g, ' ')} perfect for a romantic outing.`);
  }
}

/**
 * Generate curated friendly cards using dedicated Friendly Groups.
 * 2-stop itineraries: one of 4 Starting groups → Finish.
 * Strict 4-way rotation through starting groups.
 */
async function generateFriendlyCards(
  lat: number,
  lng: number,
  budgetMax: number,
  travelMode: string,
  travelConstraintType: string,
  travelConstraintValue: number,
  limit: number,
  skipDescriptions: boolean,
): Promise<any[]> {
  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = travelConstraintType === 'time'
    ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
    : travelConstraintValue * 1000;
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // 1. Fetch places for ALL 5 groups in parallel
  const groupPlaces: Record<string, any[]> = {};
  await Promise.all([
    ...FRIENDLY_STARTING_GROUPS.map(async (group) => {
      groupPlaces[group.id] =
        await fetchPlacesForFriendlyGroup(group, lat, lng, clampedRadius);
    }),
    (async () => {
      groupPlaces[FRIENDLY_FINISH.id] =
        await fetchPlacesForFriendlyGroup(FRIENDLY_FINISH, lat, lng, clampedRadius);
    })(),
  ]);

  for (const [groupId, places] of Object.entries(groupPlaces)) {
    console.log(`[generateFriendlyCards] ${groupId}: ${places.length} places`);
  }

  // 2. Check we have finish places (required for every card)
  if ((groupPlaces[FRIENDLY_FINISH.id] || []).length === 0) {
    console.warn('[generateFriendlyCards] No finish (dining) places found');
    return [];
  }

  // 3. Build cards with strict 4-way rotation
  const cards: any[] = [];
  const globalUsedPlaceIds = new Set<string>();
  const perStopBudget = budgetMax / 2; // 2 stops

  // nextGroupIndex tracks which starting group the NEXT card should TRY FIRST.
  // Advances on every successful card build, regardless of fallback usage.
  let nextGroupIndex = 0;

  for (let cardIndex = 0; cards.length < limit; cardIndex++) {
    // Check finish places first — if exhausted, no card possible regardless of starting group
    const availableFinish = (groupPlaces[FRIENDLY_FINISH.id] || []).filter(p => {
      const id = p.id || p.name;
      if (globalUsedPlaceIds.has(id)) return false;
      const price = priceLevelToRange(p.priceLevel);
      if (price.min > perStopBudget) return false;
      return true;
    });

    if (availableFinish.length === 0) {
      break; // Finish exhausted — no more cards possible
    }

    // Try starting groups in rotation order, with cascading fallback
    let startingGroup: FriendlyGroup | null = null;
    let availableStarts: any[] = [];
    let usedGroupIdx = nextGroupIndex;

    for (let offset = 0; offset < FRIENDLY_STARTING_GROUPS.length; offset++) {
      const candidateIdx = (nextGroupIndex + offset) % FRIENDLY_STARTING_GROUPS.length;
      const candidateGroup = FRIENDLY_STARTING_GROUPS[candidateIdx];
      const candidateStarts = (groupPlaces[candidateGroup.id] || []).filter(p => {
        const id = p.id || p.name;
        if (globalUsedPlaceIds.has(id)) return false;
        const price = priceLevelToRange(p.priceLevel);
        if (price.min > perStopBudget) return false;
        return true;
      });

      if (candidateStarts.length > 0) {
        startingGroup = candidateGroup;
        availableStarts = candidateStarts;
        usedGroupIdx = candidateIdx;
        break;
      }
    }

    // All 4 starting groups exhausted
    if (!startingGroup || availableStarts.length === 0) {
      break;
    }

    const startPlace = availableStarts[0]; // already sorted by score
    const finishPlace = availableFinish[0];
    const startId = startPlace.id || startPlace.name;
    const finishId = finishPlace.id || finishPlace.name;

    const stop1 = buildFriendlyStop(startPlace, 1, startingGroup, lat, lng, null, null, travelMode);
    const stop2 = buildFriendlyStop(finishPlace, 2, FRIENDLY_FINISH, lat, lng, stop1.lat, stop1.lng, travelMode);

    // Validate total budget
    const totalMin = stop1.priceMin + stop2.priceMin;
    if (totalMin > budgetMax) {
      globalUsedPlaceIds.add(startId); // Skip this start, try next — DON'T advance rotation
      continue;
    }

    // Validate travel constraint
    if (travelConstraintType === 'time' && stop1.travelTimeFromUserMin > travelConstraintValue * 1.5) {
      globalUsedPlaceIds.add(startId); // Skip — DON'T advance rotation
      continue;
    }

    const card = buildCardFromStops([stop1, stop2], 'friendly', [startingGroup.label, FRIENDLY_FINISH.label]);

    if (!skipDescriptions) {
      try {
        const descriptions = await generateStopDescriptions([stop1, stop2]);
        for (let i = 0; i < 2 && i < descriptions.length; i++) {
          card.stops[i].aiDescription = descriptions[i];
        }
      } catch (err) {
        console.warn('[generateFriendlyCards] AI description failed:', err);
      }
    }

    globalUsedPlaceIds.add(startId);
    globalUsedPlaceIds.add(finishId);
    cards.push(card);
    nextGroupIndex = (usedGroupIdx + 1) % FRIENDLY_STARTING_GROUPS.length; // Advance from the group actually used, not the original target

    // Safety: if we've iterated way past the limit without filling, break
    if (cardIndex > limit * 4) break;
  }

  return cards;
}

/**
 * Build a stop for a friendly card with friendly-specific duration.
 */
function buildFriendlyStop(
  place: any,
  stopNumber: number,
  group: FriendlyGroup,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
): any {
  const stop = buildStopFromPlace(
    place, stopNumber, 2, group.label,
    userLat, userLng, prevLat, prevLng, travelMode,
  );

  // Override duration with friendly-specific value
  const placeType = place.primaryType || group.types[0];
  const friendlyDuration = FRIENDLY_STOP_DURATIONS[placeType];
  if (friendlyDuration) {
    stop.estimatedDurationMinutes = friendlyDuration;
  }

  return stop;
}

/**
 * Generate curated group-fun cards using dedicated Group Fun Groups.
 * 2-stop itineraries: one of 2 Starting groups → Finish.
 * Strict 2-way alternation through starting groups.
 */
async function generateGroupFunCards(
  lat: number,
  lng: number,
  budgetMax: number,
  travelMode: string,
  travelConstraintType: string,
  travelConstraintValue: number,
  limit: number,
  skipDescriptions: boolean,
): Promise<any[]> {
  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = travelConstraintType === 'time'
    ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
    : travelConstraintValue * 1000;
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // 1. Fetch places for ALL 3 groups in parallel
  const groupPlaces: Record<string, any[]> = {};
  await Promise.all([
    ...GROUP_FUN_STARTING_GROUPS.map(async (group) => {
      groupPlaces[group.id] =
        await fetchPlacesForGroupFunGroup(group, lat, lng, clampedRadius);
    }),
    (async () => {
      groupPlaces[GROUP_FUN_FINISH.id] =
        await fetchPlacesForGroupFunGroup(GROUP_FUN_FINISH, lat, lng, clampedRadius);
    })(),
  ]);

  for (const [groupId, places] of Object.entries(groupPlaces)) {
    console.log(`[generateGroupFunCards] ${groupId}: ${places.length} places`);
  }

  // 2. Check we have finish places (required for every card)
  if ((groupPlaces[GROUP_FUN_FINISH.id] || []).length === 0) {
    console.warn('[generateGroupFunCards] No finish (dining) places found');
    return [];
  }

  // 3. Build cards with strict 2-way alternation
  const cards: any[] = [];
  const globalUsedPlaceIds = new Set<string>();
  const perStopBudget = budgetMax / 2; // 2 stops

  // nextGroupIndex tracks which starting group the NEXT card should TRY FIRST.
  // Advances on every successful card build, regardless of fallback usage.
  let nextGroupIndex = 0;

  for (let cardIndex = 0; cards.length < limit; cardIndex++) {
    // Check finish places first — if exhausted, no card possible regardless of starting group
    const availableFinish = (groupPlaces[GROUP_FUN_FINISH.id] || []).filter(p => {
      const id = p.id || p.name;
      if (globalUsedPlaceIds.has(id)) return false;
      const price = priceLevelToRange(p.priceLevel);
      if (price.min > perStopBudget) return false;
      return true;
    });

    if (availableFinish.length === 0) {
      break; // Finish exhausted — no more cards possible
    }

    // Try starting groups in alternation order, with fallback to the other group
    let startingGroup: GroupFunGroup | null = null;
    let availableStarts: any[] = [];
    let usedGroupIdx = nextGroupIndex;

    for (let offset = 0; offset < GROUP_FUN_STARTING_GROUPS.length; offset++) {
      const candidateIdx = (nextGroupIndex + offset) % GROUP_FUN_STARTING_GROUPS.length;
      const candidateGroup = GROUP_FUN_STARTING_GROUPS[candidateIdx];
      const candidateStarts = (groupPlaces[candidateGroup.id] || []).filter(p => {
        const id = p.id || p.name;
        if (globalUsedPlaceIds.has(id)) return false;
        const price = priceLevelToRange(p.priceLevel);
        if (price.min > perStopBudget) return false;
        return true;
      });

      if (candidateStarts.length > 0) {
        startingGroup = candidateGroup;
        availableStarts = candidateStarts;
        usedGroupIdx = candidateIdx;
        break;
      }
    }

    // Both starting groups exhausted
    if (!startingGroup || availableStarts.length === 0) {
      break;
    }

    const startPlace = availableStarts[0]; // already sorted by score
    const finishPlace = availableFinish[0];
    const startId = startPlace.id || startPlace.name;
    const finishId = finishPlace.id || finishPlace.name;

    const stop1 = buildGroupFunStop(startPlace, 1, startingGroup, lat, lng, null, null, travelMode);
    const stop2 = buildGroupFunStop(finishPlace, 2, GROUP_FUN_FINISH, lat, lng, stop1.lat, stop1.lng, travelMode);

    // Validate total budget
    const totalMin = stop1.priceMin + stop2.priceMin;
    if (totalMin > budgetMax) {
      globalUsedPlaceIds.add(startId); // Skip this start, try next — DON'T advance alternation
      continue;
    }

    // Validate travel constraint
    if (travelConstraintType === 'time' && stop1.travelTimeFromUserMin > travelConstraintValue * 1.5) {
      globalUsedPlaceIds.add(startId); // Skip — DON'T advance alternation
      continue;
    }

    const card = buildCardFromStops([stop1, stop2], 'group-fun', [startingGroup.label, GROUP_FUN_FINISH.label]);

    if (!skipDescriptions) {
      try {
        const descriptions = await generateStopDescriptions([stop1, stop2]);
        for (let i = 0; i < 2 && i < descriptions.length; i++) {
          card.stops[i].aiDescription = descriptions[i];
        }
      } catch (err) {
        console.warn('[generateGroupFunCards] AI description failed:', err);
      }
    }

    globalUsedPlaceIds.add(startId);
    globalUsedPlaceIds.add(finishId);
    cards.push(card);
    nextGroupIndex = (usedGroupIdx + 1) % GROUP_FUN_STARTING_GROUPS.length; // Advance from the group actually used, not the original target

    // Safety: if we've iterated way past the limit without filling, break
    if (cardIndex > limit * 4) break;
  }

  return cards;
}

/**
 * Build a stop for a group-fun card with group-fun-specific duration.
 */
function buildGroupFunStop(
  place: any,
  stopNumber: number,
  group: GroupFunGroup,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
): any {
  const stop = buildStopFromPlace(
    place, stopNumber, 2, group.label,
    userLat, userLng, prevLat, prevLng, travelMode,
  );

  // Override duration with group-fun-specific value
  const placeType = place.primaryType || group.types[0];
  const groupFunDuration = GROUP_FUN_STOP_DURATIONS[placeType];
  if (groupFunDuration) {
    stop.estimatedDurationMinutes = groupFunDuration;
  }

  return stop;
}

function generateCategoryCombos(pool: string[], count: number): string[][] {
  if (pool.length === 3) {
    return Array.from({ length: count }, () => [...pool]);
  }

  const combos: string[][] = [];
  for (let i = 0; i < pool.length - 2; i++) {
    for (let j = i + 1; j < pool.length - 1; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        combos.push([pool[i], pool[j], pool[k]]);
      }
    }
  }

  const shuffled = shuffle(combos);
  const result = [...shuffled];
  while (result.length < count) {
    result.push(...shuffle([...combos]));
  }

  return result.slice(0, count);
}

function buildStopFromPlace(
  place: any,
  stopNumber: number,
  totalStops: number,
  categoryName: string,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
): any {
  const lat = place.location?.latitude ?? 0;
  const lng = place.location?.longitude ?? 0;
  const placeType = place.primaryType || categoryName.toLowerCase().replace(/[& ]/g, '_');

  const distFromUser = haversineKm(userLat, userLng, lat, lng);
  const travelFromUser = estimateTravelMinutes(distFromUser, travelMode);

  let travelFromPrev: number | null = null;
  if (prevLat !== null && prevLng !== null && stopNumber > 1) {
    const distFromPrev = haversineKm(prevLat, prevLng, lat, lng);
    travelFromPrev = estimateTravelMinutes(distFromPrev, travelMode);
  }

  const stopLabels = totalStops === 2
    ? ['Start Here', 'End With']
    : ['Start Here', 'Then', 'End With'];
  const stopLabel = stopLabels[stopNumber - 1] || 'Explore';

  const { hours, isOpenNow: openNow } = parseOpeningHours(place);
  const priceRange = priceLevelToRange(place.priceLevel);
  const priceLabel = priceLevelToLabel(place.priceLevel);

  return {
    stopNumber,
    stopLabel,
    placeId: place.id || '',
    placeName: place.displayName?.text || 'Unknown Place',
    placeType,
    address: place.formattedAddress || '',
    rating: place.rating ?? 0,
    reviewCount: place.userRatingCount ?? 0,
    imageUrl: getPhotoUrl(place),
    priceLevelLabel: priceLabel,
    priceMin: priceRange.min,
    priceMax: priceRange.max,
    openingHours: hours,
    isOpenNow: openNow,
    website: place.websiteUri || null,
    lat,
    lng,
    distanceFromUserKm: Math.round(distFromUser * 10) / 10,
    travelTimeFromUserMin: Math.round(travelFromUser),
    travelTimeFromPreviousStopMin: travelFromPrev !== null ? Math.round(travelFromPrev) : null,
    travelModeFromPreviousStop: stopNumber > 1 ? travelMode : null,
    aiDescription: '',
    estimatedDurationMinutes: STOP_DURATION_MINUTES[placeType] || DEFAULT_STOP_DURATION,
  };
}

function buildCardFromStops(
  stops: any[],
  experienceType: string,
  categories: string[],
): any {
  const taglines = TAGLINES_BY_TYPE[experienceType] || ['A curated experience awaits'];
  const tagline = taglines[Math.floor(Math.random() * taglines.length)];
  const title = stops.map(s => s.placeName).join(' \u2192 ');
  const pairingKey = categories.join('|');

  const totalPriceMin = stops.reduce((sum, s) => sum + s.priceMin, 0);
  const totalPriceMax = stops.reduce((sum, s) => sum + s.priceMax, 0);
  const totalDuration = stops.reduce((sum, s) => sum + s.estimatedDurationMinutes, 0)
    + stops.slice(1).reduce((sum, s) => sum + (s.travelTimeFromPreviousStopMin || 0), 0);

  return {
    id: `curated_${experienceType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    cardType: 'curated',
    experienceType,
    pairingKey,
    title,
    tagline,
    categoryLabel: CURATED_TYPE_LABELS[experienceType] || 'Explore',
    stops,
    totalPriceMin,
    totalPriceMax,
    estimatedDurationMinutes: totalDuration,
    matchScore: 75 + Math.floor(Math.random() * 20),
  };
}

async function generateStandardCards(
  experienceType: string,
  lat: number,
  lng: number,
  budgetMax: number,
  travelMode: string,
  travelConstraintType: string,
  travelConstraintValue: number,
  limit: number,
  skipDescriptions: boolean,
): Promise<any[]> {
  // ── Adventure intent: use dedicated groups instead of category pool ──
  if (experienceType === 'adventurous') {
    return generateAdventureCards(
      lat, lng, budgetMax, travelMode,
      travelConstraintType, travelConstraintValue,
      limit, skipDescriptions,
    );
  }

  // ── First Date intent: use dedicated groups (2-stop: start → finish) ──
  if (experienceType === 'first-date') {
    return generateFirstDateCards(
      lat, lng, budgetMax, travelMode,
      travelConstraintType, travelConstraintValue,
      limit, skipDescriptions,
    );
  }

  // ── Romantic intent: use dedicated groups (2-stop: start → finish) ──
  if (experienceType === 'romantic') {
    return generateRomanticCards(
      lat, lng, budgetMax, travelMode,
      travelConstraintType, travelConstraintValue,
      limit, skipDescriptions,
    );
  }

  // ── Friendly intent: use dedicated groups (2-stop: start → finish, 4-way rotation) ──
  if (experienceType === 'friendly') {
    return generateFriendlyCards(
      lat, lng, budgetMax, travelMode,
      travelConstraintType, travelConstraintValue,
      limit, skipDescriptions,
    );
  }

  // ── Group Fun intent: use dedicated groups (2-stop: start → finish, 2-way alternation) ──
  if (experienceType === 'group-fun') {
    return generateGroupFunCards(
      lat, lng, budgetMax, travelMode,
      travelConstraintType, travelConstraintValue,
      limit, skipDescriptions,
    );
  }

  // ── All other intents: existing category pool pipeline (unchanged) ──
  const pool = CURATED_TYPE_CATEGORIES[experienceType];
  if (!pool) return [];

  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = travelConstraintType === 'time'
    ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
    : travelConstraintValue * 1000;
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // 1. Fetch places for ALL categories in parallel
  const categoryPlaces: Record<string, any[]> = {};
  await Promise.all(
    pool.map(async (category) => {
      const places = await fetchPlacesForCategory(category, lat, lng, clampedRadius);
      categoryPlaces[category] = places;
    })
  );

  for (const [cat, places] of Object.entries(categoryPlaces)) {
    console.log(`[generateStandardCards] ${cat}: ${places.length} places`);
  }

  // 2. Generate category combos
  const combos = generateCategoryCombos(pool, limit * 2);

  // 3. Build cards
  const cards: any[] = [];
  const globalUsedPlaceIds = new Set<string>();
  const perStopBudget = budgetMax / 3;

  for (const combo of combos) {
    if (cards.length >= limit) break;

    const stops: any[] = [];
    const comboUsedIds = new Set(globalUsedPlaceIds);
    let valid = true;
    let prevLat = lat;
    let prevLng = lng;

    for (let i = 0; i < combo.length; i++) {
      const category = combo[i];
      const available = (categoryPlaces[category] || []).filter(p => {
        const id = p.id || p.name;
        if (comboUsedIds.has(id)) return false;
        const price = priceLevelToRange(p.priceLevel);
        if (price.min > perStopBudget) return false;
        return true;
      });

      if (available.length === 0) {
        valid = false;
        break;
      }

      const place = available[0]; // already sorted by score
      const placeId = place.id || place.name;
      comboUsedIds.add(placeId);

      const stop = buildStopFromPlace(
        place, i + 1, combo.length, category,
        lat, lng,
        i > 0 ? prevLat : null,
        i > 0 ? prevLng : null,
        travelMode,
      );
      stops.push(stop);

      prevLat = stop.lat;
      prevLng = stop.lng;
    }

    if (!valid || stops.length !== combo.length) continue;

    // Validate total budget
    const totalMin = stops.reduce((s, st) => s + st.priceMin, 0);
    if (totalMin > budgetMax) continue;

    // Validate travel constraint
    if (travelConstraintType === 'time' && stops[0].travelTimeFromUserMin > travelConstraintValue * 1.5) {
      continue;
    }

    const card = buildCardFromStops(stops, experienceType, combo);

    if (!skipDescriptions) {
      try {
        const descriptions = await generateStopDescriptions(stops);
        for (let i = 0; i < stops.length && i < descriptions.length; i++) {
          stops[i].aiDescription = descriptions[i];
        }
      } catch (err) {
        console.warn('[generateStandardCards] Description generation failed:', err);
      }
    }

    cards.push(card);

    for (const s of stops) {
      globalUsedPlaceIds.add(s.placeId);
    }
  }

  return cards;
}

/**
 * Generate curated picnic-dates cards using dedicated Picnic Groups.
 * 2-stop itineraries: Grocery → Picnic Spot.
 * No alternation — single starting group, single finish group.
 * Includes AI-generated shopping list on each card.
 *
 * Key architectural difference from other intents:
 * Finish (park) is searched NEAR THE GROCERY, not near the user.
 * This ensures the grocery and park are walkable from each other.
 */
async function generatePicnicDatesCards(
  lat: number,
  lng: number,
  budgetMax: number,
  travelMode: string,
  travelConstraintType: string,
  travelConstraintValue: number,
  limit: number,
  skipDescriptions: boolean,
): Promise<any[]> {
  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = travelConstraintType === 'time'
    ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
    : travelConstraintValue * 1000;
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // 1. Fetch grocery stores near user
  const groceryPlaces = await fetchPlacesForPicnicGroup(PICNIC_START, lat, lng, clampedRadius);

  if (groceryPlaces.length === 0) {
    console.warn('[generatePicnicDatesCards] No grocery stores found');
    return [];
  }

  // Sort by distance from user (nearest first) — users want the closest grocery
  groceryPlaces.sort((a: any, b: any) => {
    const distA = haversineKm(lat, lng, a.location?.latitude ?? 0, a.location?.longitude ?? 0);
    const distB = haversineKm(lat, lng, b.location?.latitude ?? 0, b.location?.longitude ?? 0);
    return distA - distB;
  });

  const cards: any[] = [];
  const usedGroceryIds = new Set<string>();
  const parkSearchRadius = 3000; // 3km around the grocery — preserved from original implementation

  for (const grocery of groceryPlaces) {
    if (cards.length >= limit) break;

    const groceryId = grocery.id || grocery.name;
    if (usedGroceryIds.has(groceryId)) continue;
    usedGroceryIds.add(groceryId);

    const groceryLat = grocery.location?.latitude ?? 0;
    const groceryLng = grocery.location?.longitude ?? 0;

    // 2. Find picnic spot near this grocery (NOT near user)
    const picnicPlaces = await fetchPlacesForPicnicGroup(
      PICNIC_FINISH,
      groceryLat, groceryLng,
      parkSearchRadius,
    );

    if (picnicPlaces.length === 0) continue;

    // Sort parks by distance from grocery (nearest first)
    picnicPlaces.sort((a: any, b: any) => {
      const distA = haversineKm(groceryLat, groceryLng, a.location?.latitude ?? 0, a.location?.longitude ?? 0);
      const distB = haversineKm(groceryLat, groceryLng, b.location?.latitude ?? 0, b.location?.longitude ?? 0);
      return distA - distB;
    });

    const picnicSpot = picnicPlaces[0];

    // Build 2 stops
    const stop1 = buildPicnicStop(grocery, 1, PICNIC_START, lat, lng, null, null, travelMode);
    const stop2 = buildPicnicStop(picnicSpot, 2, PICNIC_FINISH, lat, lng, groceryLat, groceryLng, travelMode);

    // Budget validation
    const totalMin = stop1.priceMin + stop2.priceMin;
    if (totalMin > budgetMax) continue;

    // Travel constraint validation
    if (travelConstraintType === 'time' && stop1.travelTimeFromUserMin > travelConstraintValue * 1.5) {
      continue;
    }

    const card = buildCardFromStops([stop1, stop2], 'picnic-dates', [PICNIC_START.label, PICNIC_FINISH.label]);

    // Generate AI descriptions and shopping list
    if (!skipDescriptions) {
      // Run descriptions and shopping list in parallel
      const [descriptions, shoppingList] = await Promise.all([
        generateStopDescriptions([stop1, stop2]).catch((err) => {
          console.warn('[generatePicnicDatesCards] Description failed:', err);
          return [] as string[];
        }),
        generatePicnicShoppingList(
          stop1.placeName,
          stop2.placeName,
          stop2.placeType,
        ).catch((err) => {
          console.warn('[generatePicnicDatesCards] Shopping list failed:', err);
          return [...PICNIC_STATIC_SHOPPING_LIST];
        }),
      ]);

      if (descriptions[0]) stop1.aiDescription = descriptions[0];
      if (descriptions[1]) stop2.aiDescription = descriptions[1];
      card.shoppingList = shoppingList;
    } else {
      // skipDescriptions mode — still provide static shopping list
      card.shoppingList = [...PICNIC_STATIC_SHOPPING_LIST];
    }

    cards.push(card);
  }

  return cards;
}

/**
 * Build a stop for a picnic card with picnic-specific duration.
 */
function buildPicnicStop(
  place: any,
  stopNumber: number,
  group: PicnicGroup,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
): any {
  const stop = buildStopFromPlace(
    place, stopNumber, 2, group.label,
    userLat, userLng, prevLat, prevLng, travelMode,
  );

  // Override duration with picnic-specific value
  const placeType = place.primaryType || group.types[0];
  const picnicDuration = PICNIC_STOP_DURATIONS[placeType];
  if (picnicDuration) {
    stop.estimatedDurationMinutes = picnicDuration;
  }

  return stop;
}

async function generateStrollCards(
  lat: number,
  lng: number,
  budgetMax: number,
  travelMode: string,
  travelConstraintType: string,
  travelConstraintValue: number,
  limit: number,
  skipDescriptions: boolean,
): Promise<any[]> {
  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = travelConstraintType === 'time'
    ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
    : travelConstraintValue * 1000;
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // 1. Find nature spots near user
  const naturePlaces = await fetchPlacesForCategory('Nature', lat, lng, clampedRadius);

  if (naturePlaces.length === 0) {
    console.warn('[generateStrollCards] No nature spots found');
    return [];
  }

  // Sort by distance (nearest first)
  naturePlaces.sort((a, b) => {
    const distA = haversineKm(lat, lng, a.location?.latitude ?? 0, a.location?.longitude ?? 0);
    const distB = haversineKm(lat, lng, b.location?.latitude ?? 0, b.location?.longitude ?? 0);
    return distA - distB;
  });

  const cards: any[] = [];
  const usedNatureIds = new Set<string>();
  const eatsSearchRadius = 2000; // 2km around nature spot

  for (const nature of naturePlaces) {
    if (cards.length >= limit) break;

    const natureId = nature.id || nature.name;
    if (usedNatureIds.has(natureId)) continue;
    usedNatureIds.add(natureId);

    const natureLat = nature.location?.latitude ?? 0;
    const natureLng = nature.location?.longitude ?? 0;

    // 2. Find casual eats near this nature spot
    const eatsPlaces = await fetchPlacesForCategory(
      'Casual Eats',
      natureLat, natureLng,
      eatsSearchRadius,
    );

    if (eatsPlaces.length === 0) continue;

    // Sort eats by distance from nature (nearest first)
    eatsPlaces.sort((a, b) => {
      const distA = haversineKm(natureLat, natureLng, a.location?.latitude ?? 0, a.location?.longitude ?? 0);
      const distB = haversineKm(natureLat, natureLng, b.location?.latitude ?? 0, b.location?.longitude ?? 0);
      return distA - distB;
    });

    const eats = eatsPlaces[0];
    const eatsLat = eats.location?.latitude ?? 0;
    const eatsLng = eats.location?.longitude ?? 0;

    // Build 3 stops: Casual Eats -> Nature -> Casual Eats (same place)
    const stop1 = buildStopFromPlace(eats, 1, 3, 'Casual Eats', lat, lng, null, null, travelMode);
    const stop2 = buildStopFromPlace(
      nature, 2, 3, 'Nature',
      lat, lng, eatsLat, eatsLng, travelMode,
    );

    // Stop 3 is a CLONE of stop 1 with updated stopNumber and stopLabel
    const stop3 = {
      ...stop1,
      stopNumber: 3,
      stopLabel: 'End With',
      travelTimeFromPreviousStopMin: stop2.travelTimeFromPreviousStopMin, // same distance back
      travelModeFromPreviousStop: travelMode,
    };

    // Budget validation (stop 1 and 3 are same place, count price twice)
    const totalMin = stop1.priceMin + stop2.priceMin + stop3.priceMin;
    if (totalMin > budgetMax) continue;

    const card = buildCardFromStops(
      [stop1, stop2, stop3],
      'take-a-stroll',
      ['Casual Eats', 'Nature', 'Casual Eats'],
    );

    if (!skipDescriptions) {
      try {
        const descriptions = await generateStopDescriptions([stop1, stop2, stop3]);
        if (descriptions[0]) stop1.aiDescription = descriptions[0];
        if (descriptions[1]) stop2.aiDescription = descriptions[1];
        if (descriptions[2]) stop3.aiDescription = descriptions[2];
      } catch (err) {
        console.warn('[generateStrollCards] Description failed:', err);
      }
    }

    cards.push(card);
  }

  return cards;
}

// ── Utility functions ─────────────────────────────────────────────

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
    const prompt = `You are a travel writer creating short descriptions for a curated day out.
Write exactly ${stops.length} short paragraphs (one per stop, 2-3 sentences each), telling the visitor what to do and the vibe.
Emphasize the sense of adventure, discovery, and excitement. Never describe it as a solo or single-person activity — write for anyone (friends, couples, groups, or solo).
Be specific, warm, and fun. Address the reader directly as "you".
Output ONLY a JSON array of ${stops.length} strings with no markdown and no extra keys.

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

// ── Main serve() handler ──────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    let {
      experienceType = 'adventurous',
      location,
      budgetMin = 0,
      budgetMax = 150,
      travelMode = 'walking',
      travelConstraintType = 'time',
      travelConstraintValue = 30,
      datetimePref,
      skipDescriptions = false,
      limit = 20,
      session_id,
      batchSeed = 0,
    } = body;
    const warmPool = body.warmPool ?? false;

    // Validate experience type
    if (!CURATED_TYPE_CATEGORIES[experienceType]) {
      return new Response(
        JSON.stringify({ error: `Unknown experienceType: ${experienceType}`, cards: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Session aggregation for collaboration mode
    if (session_id && typeof session_id === 'string' && session_id.length > 0) {
      try {
        const agg = await aggregateSessionPreferences(session_id);
        budgetMin = agg.budgetMin;
        budgetMax = agg.budgetMax;
        travelMode = agg.travelMode;
        travelConstraintType = agg.travelConstraintType;
        travelConstraintValue = agg.travelConstraintValue;
        if (agg.datetimePref) datetimePref = agg.datetimePref;
        if (agg.location) location = agg.location;
        if (!agg.experienceTypes || !agg.experienceTypes.includes(experienceType)) {
          return new Response(
            JSON.stringify({ cards: [], meta: { totalResults: 0, reason: 'experience_type_not_selected' } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (err) {
        console.error('[curated-v2] Session aggregation failed:', err);
        return new Response(
          JSON.stringify({ error: 'Failed to aggregate session preferences', cards: [] }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!location?.lat || !location?.lng) {
      return new Response(
        JSON.stringify({ error: 'location.lat and location.lng are required', cards: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Pool setup
    const poolSupabaseUrl = Deno.env.get('SUPABASE_URL');
    const poolServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const poolAdmin = (poolSupabaseUrl && poolServiceRoleKey)
      ? createClient(poolSupabaseUrl, poolServiceRoleKey)
      : null;

    let poolUserId = 'anonymous';
    if (poolAdmin) {
      const authHeader = req.headers.get('Authorization');
      if (authHeader) {
        try {
          const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
          const authClient = createClient(poolSupabaseUrl!, anonKey);
          const token = authHeader.replace('Bearer ', '');
          const { data: { user } } = await authClient.auth.getUser(token);
          if (user?.id) poolUserId = user.id;
        } catch {}
      }
    }

    // Compute radius for pool queries
    const TRAVEL_SPEEDS_KMH: Record<string, number> = {
      walking: 4.5, biking: 14, transit: 20, driving: 35,
    };
    const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
    const radiusMeters = travelConstraintType === 'time'
      ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)
      : travelConstraintValue * 1000;
    const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

    // warmPool support
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
      } catch (err) {
        console.warn('[warm-pool] Pool check failed, proceeding to warm:', err);
      }
    }

    // Pool-first: try serving from pool for batch 0
    if (poolAdmin && poolUserId !== 'anonymous' && batchSeed === 0) {
      try {
        const poolResult = await serveCuratedCardsFromPool({
          supabaseAdmin: poolAdmin,
          userId: poolUserId,
          lat: location.lat,
          lng: location.lng,
          radiusMeters: clampedRadius,
          categories: [],
          budgetMin: budgetMin || 0,
          budgetMax: budgetMax || 1000,
          limit: limit || 20,
          cardType: 'curated',
          experienceType,
        }, GOOGLE_PLACES_API_KEY!);

        if (poolResult.cards.length >= Math.ceil(limit * 0.75)) {
          console.log(`[pool-first-curated] Served ${poolResult.cards.length} curated cards from pool`);
          // Normalize categoryLabel — pool cards may not have it set
          const normalizedPoolCards = poolResult.cards.map((card: any) => ({
            ...card,
            categoryLabel: card.categoryLabel || card.category || experienceType || 'Experience',
          }));
          return new Response(
            JSON.stringify({
              success: true,
              cards: normalizedPoolCards,
              meta: {
                totalResults: poolResult.cards.length,
                fromPool: poolResult.fromPool,
                fromApi: poolResult.fromApi,
                poolSize: poolResult.totalPoolSize,
              },
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.log(`[pool-first-curated] Pool had only ${poolResult.cards.length} curated cards, falling back`);
      } catch (poolError) {
        console.warn('[pool-first-curated] Pool query failed, falling back:', poolError);
      }
    }

    console.log(`[curated-v2] Generating ${experienceType} cards (limit: ${limit})`);

    // Route to the appropriate generator
    let cards: any[];
    const generateLimit = warmPool ? 50 : limit;

    if (experienceType === 'picnic-dates') {
      cards = await generatePicnicDatesCards(
        location.lat, location.lng, budgetMax, travelMode,
        travelConstraintType, travelConstraintValue,
        generateLimit, skipDescriptions,
      );
    } else if (experienceType === 'take-a-stroll') {
      cards = await generateStrollCards(
        location.lat, location.lng, budgetMax, travelMode,
        travelConstraintType, travelConstraintValue,
        generateLimit, skipDescriptions,
      );
    } else {
      cards = await generateStandardCards(
        experienceType,
        location.lat, location.lng, budgetMax, travelMode,
        travelConstraintType, travelConstraintValue,
        generateLimit, skipDescriptions,
      );
    }

    console.log(`[curated-v2] Generated ${cards.length} ${experienceType} cards`);

    // Fire-and-forget: Store in pool
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
              shoppingList: card.shoppingList || null,
            });
            if (cardId) poolIds.push(cardId);
          }
          if (!warmPool && poolUserId !== 'anonymous' && poolIds.length > 0) {
            const servedIds = poolIds.slice(0, limit);
            await recordImpressions(poolAdmin, poolUserId, servedIds);
          }
          console.log(`[curated-v2] Stored ${poolIds.length} cards in pool`);
        } catch (storeError) {
          console.warn('[curated-v2] Pool store error:', storeError);
        }
      })();
    }

    const servedCards = warmPool ? [] : cards.slice(0, limit);
    // Normalize categoryLabel on all served cards
    const normalizedCards = servedCards.map((card: any) => ({
      ...card,
      categoryLabel: card.categoryLabel || card.category || experienceType || 'Experience',
    }));
    return new Response(
      JSON.stringify({
        cards: normalizedCards,
        experienceType,
        total: servedCards.length,
        generatedAt: new Date().toISOString(),
        meta: {
          totalResults: servedCards.length,
          totalCardsBuilt: cards.length,
          fromPool: 0,
          fromApi: servedCards.length,
          pipeline: 'curated-v2',
        },
        ...(warmPool ? { success: true, poolSize: cards.length } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('[curated-v2] Error:', err);
    return new Response(
      JSON.stringify({ error: (err as any)?.message || String(err), cards: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
