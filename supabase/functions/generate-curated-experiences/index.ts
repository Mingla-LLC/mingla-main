import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { searchPlacesWithCache } from '../_shared/placesCache.ts';
import { serveCuratedCardsFromPool, upsertPlaceToPool, insertCardToPool, recordImpressions } from '../_shared/cardPoolService.ts';
import {
  MINGLA_CATEGORY_PLACE_TYPES,
  resolveCategory,
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

// Outdoor place types that are typically always-open (no regular hours data)
const ALWAYS_OPEN_TYPES = new Set([
  'park', 'national_park', 'state_park', 'hiking_area', 'beach',
  'wildlife_park', 'botanical_garden', 'dog_park', 'city_park',
]);

// ── Curated Type -> Mingla Category Pools ─────────────────────────
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

  const nearbyTypes = allTypes.filter(t => !TEXT_SEARCH_TYPES.has(t));
  const textTypes   = allTypes.filter(t => TEXT_SEARCH_TYPES.has(t));

  const results: any[] = [];

  // 1. Batch Nearby Search — parallel calls for up to 10 random types
  if (nearbyTypes.length > 0) {
    const typesToSearch = shuffle(nearbyTypes).slice(0, 10);
    const nearbyResults = await Promise.allSettled(
      typesToSearch.map(t => searchNearby(t, lat, lng, radiusMeters))
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
      const textResults = await searchByText(query, lat, lng, radiusMeters);
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

  return deduped.sort((a, b) => scorePlace(b) - scorePlace(a));
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

async function generatePicnicCards(
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

  // 1. Find groceries near user
  const groceryPlaces = await fetchPlacesForCategory('Groceries & Flowers', lat, lng, clampedRadius);

  if (groceryPlaces.length === 0) {
    console.warn('[generatePicnicCards] No grocery stores found');
    return [];
  }

  // Sort by distance (nearest first)
  groceryPlaces.sort((a, b) => {
    const distA = haversineKm(lat, lng, a.location?.latitude ?? 0, a.location?.longitude ?? 0);
    const distB = haversineKm(lat, lng, b.location?.latitude ?? 0, b.location?.longitude ?? 0);
    return distA - distB;
  });

  const cards: any[] = [];
  const usedGroceryIds = new Set<string>();
  const parkSearchRadius = 3000; // 3km around the grocery

  for (const grocery of groceryPlaces) {
    if (cards.length >= limit) break;

    const groceryId = grocery.id || grocery.name;
    if (usedGroceryIds.has(groceryId)) continue;
    usedGroceryIds.add(groceryId);

    const groceryLat = grocery.location?.latitude ?? 0;
    const groceryLng = grocery.location?.longitude ?? 0;

    // 2. Find picnic park near this grocery (NOT near user)
    const parkPlaces = await fetchPlacesForCategory(
      'Picnic',
      groceryLat, groceryLng,
      parkSearchRadius,
    );

    if (parkPlaces.length === 0) continue;

    // Sort parks by distance from grocery (nearest first)
    parkPlaces.sort((a, b) => {
      const distA = haversineKm(groceryLat, groceryLng, a.location?.latitude ?? 0, a.location?.longitude ?? 0);
      const distB = haversineKm(groceryLat, groceryLng, b.location?.latitude ?? 0, b.location?.longitude ?? 0);
      return distA - distB;
    });

    const park = parkPlaces[0];

    // Build 2 stops
    const stop1 = buildStopFromPlace(grocery, 1, 2, 'Groceries & Flowers', lat, lng, null, null, travelMode);
    const stop2 = buildStopFromPlace(
      park, 2, 2, 'Picnic',
      lat, lng, groceryLat, groceryLng, travelMode,
    );

    // Budget validation
    const totalMin = stop1.priceMin + stop2.priceMin;
    if (totalMin > budgetMax) continue;

    const card = buildCardFromStops([stop1, stop2], 'picnic-dates', ['Groceries & Flowers', 'Picnic']);

    if (!skipDescriptions) {
      try {
        const descriptions = await generateStopDescriptions([stop1, stop2]);
        if (descriptions[0]) stop1.aiDescription = descriptions[0];
        if (descriptions[1]) stop2.aiDescription = descriptions[1];
      } catch (err) {
        console.warn('[generatePicnicCards] Description failed:', err);
      }
    }

    cards.push(card);
  }

  return cards;
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
        if (!agg.experienceTypes.includes(experienceType)) {
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
      cards = await generatePicnicCards(
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
    return new Response(
      JSON.stringify({
        cards: servedCards,
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
