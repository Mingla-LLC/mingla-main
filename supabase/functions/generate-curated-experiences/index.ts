import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serveCuratedCardsFromPool, recordImpressions } from '../_shared/cardPoolService.ts';
import { GLOBAL_EXCLUDED_PLACE_TYPES, isChildVenueName } from '../_shared/categoryPlaceTypes.ts';
import { getIncludedTypes, getExcludedPrimaryTypes, SEEDING_CATEGORY_MAP } from '../_shared/seedingCategories.ts';
import { googleLevelToTierSlug, tierMeetsMinimum } from '../_shared/priceTiers.ts';
import { timeoutFetch } from '../_shared/timeoutFetch.ts';

/* ─────────────────────────────────────────────────────────────────────────────
 * generate-curated-experiences  –  Pool-Only Curated Card Generator
 *
 * ZERO Google API calls. All places come from place_pool.
 * One generic generateCardsForType() replaces 7 per-type generators.
 * 6 experience types. Category configs from seedingCategories.ts.
 * ──────────────────────────────────────────────────────────────────────────── */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
let supabaseAdmin: ReturnType<typeof createClient>;

const GLOBAL_EXCLUDED = new Set(GLOBAL_EXCLUDED_PLACE_TYPES);

// DB-DRIVEN EXCLUSION CHECK (Block 6 — hardened 2026-03-22)
// Reads category_type_exclusions table instead of hardcoded lists.
// Prevents stops with excluded types from entering curated cards.
// Cache is per-invocation only (Deno isolate lifetime). Each edge function call starts fresh.
const _categoryExclusionCache: Map<string, Set<string>> = new Map();

async function getCategoryExcludedTypes(categorySlug: string): Promise<Set<string>> {
  if (_categoryExclusionCache.has(categorySlug)) {
    return _categoryExclusionCache.get(categorySlug)!;
  }
  const { data } = await supabaseAdmin
    .from('category_type_exclusions')
    .select('excluded_type')
    .eq('category_slug', categorySlug);
  const types = new Set((data ?? []).map((r: any) => r.excluded_type));
  _categoryExclusionCache.set(categorySlug, types);
  return types;
}

// Build Google type → slug lookup from seedingCategories
const GOOGLE_TYPE_TO_SLUG: Record<string, string> = {};
for (const cat of Object.values(SEEDING_CATEGORY_MAP)) {
  for (const type of cat.includedTypes) {
    // First category to claim a type wins (order matters for overlapping types)
    if (!GOOGLE_TYPE_TO_SLUG[type]) {
      GOOGLE_TYPE_TO_SLUG[type] = cat.id;
    }
  }
}
// Override overlapping types to match backfill logic
// These types appear in multiple categories — assign to their primary category
GOOGLE_TYPE_TO_SLUG['grocery_store'] = 'groceries';
GOOGLE_TYPE_TO_SLUG['supermarket'] = 'groceries';
GOOGLE_TYPE_TO_SLUG['wine_bar'] = 'drink';
GOOGLE_TYPE_TO_SLUG['lounge_bar'] = 'drink';
GOOGLE_TYPE_TO_SLUG['bistro'] = 'casual_eats';
GOOGLE_TYPE_TO_SLUG['italian_restaurant'] = 'casual_eats';
GOOGLE_TYPE_TO_SLUG['seafood_restaurant'] = 'casual_eats';

function googleTypeToSlug(googleType: string): string {
  return GOOGLE_TYPE_TO_SLUG[googleType] || 'casual_eats'; // safe fallback
}

// ── Session preference aggregation (for collaboration mode) ────────────────

const SESSION_INTENT_IDS = new Set([
  'adventurous', 'first-date', 'romantic', 'group-fun', 'picnic-dates', 'take-a-stroll',
]);

async function aggregateSessionPreferences(sessionId: string): Promise<{
  budgetMin: number;
  budgetMax: number;
  categories: string[];
  experienceTypes: string[];
  travelMode: string;
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

  const budgetMin = Math.min(...allPrefs.map(p => p.budget_min ?? 0));
  const budgetMax = Math.max(...allPrefs.map(p => p.budget_max ?? 1000));

  const allCats = new Set<string>();
  const allIntents = new Set<string>();
  allPrefs.forEach(p => {
    if (Array.isArray(p.categories)) p.categories.forEach((c: string) => allCats.add(c));
    if (Array.isArray(p.intents)) p.intents.forEach((i: string) => allIntents.add(i));
  });
  const categories = [...allCats].filter(c => !SESSION_INTENT_IDS.has(c));
  const experienceTypes = allIntents.size > 0
    ? [...allIntents]
    : [...allCats].filter(c => SESSION_INTENT_IDS.has(c));

  const modeCounts: Record<string, number> = {};
  allPrefs.forEach(p => {
    const m = p.travel_mode || 'walking';
    modeCounts[m] = (modeCounts[m] || 0) + 1;
  });
  const travelMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'walking';

  const travelConstraintValue = Math.min(
    ...allPrefs.map(p => p.travel_constraint_value ?? 30)
  );

  const datetimes = allPrefs.map(p => p.datetime_pref).filter(Boolean).sort();
  const datetimePref = datetimes[0] || undefined;

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
    travelMode, travelConstraintValue,
    datetimePref, location,
  };
}

// ── Stop duration estimates ────────────────────────────────────────────────

const STOP_DURATION_MINUTES: Record<string, number> = {
  park: 60, botanical_garden: 60, hiking_area: 90, beach: 90,
  zoo: 120, national_park: 90, state_park: 90, garden: 45,
  coffee_shop: 30, tea_house: 30, brunch_restaurant: 60, diner: 45,
  bar: 60, pub: 60, wine_bar: 60, cocktail_bar: 60,
  beer_garden: 75, brewery: 60, brewpub: 60, lounge_bar: 60,
  restaurant: 60, seafood_restaurant: 60, pizza_restaurant: 45,
  thai_restaurant: 60, japanese_restaurant: 60, ramen_restaurant: 45,
  korean_restaurant: 60, vietnamese_restaurant: 60, mexican_restaurant: 60,
  american_restaurant: 60, mediterranean_restaurant: 60, italian_restaurant: 75,
  french_restaurant: 90, greek_restaurant: 75, steak_house: 90,
  fine_dining_restaurant: 90,
  movie_theater: 150, art_gallery: 60, museum: 90, art_museum: 90,
  performing_arts_theater: 120, concert_hall: 120, opera_house: 150,
  philharmonic_hall: 120, amphitheatre: 120, comedy_club: 90,
  bowling_alley: 60, miniature_golf_course: 45, karaoke: 90,
  video_arcade: 60, amusement_center: 60, amusement_park: 180,
  go_karting_venue: 60, paintball_center: 90,
  cultural_center: 60, history_museum: 90, cultural_landmark: 45,
  sculpture: 30, art_studio: 60,
  spa: 90, massage_spa: 90, sauna: 60, yoga_studio: 60,
  cafe: 30, bakery: 20, book_store: 30, dessert_shop: 25,
  ice_cream_shop: 20, juice_shop: 15, donut_shop: 15,
  breakfast_restaurant: 45, bistro: 75,
  grocery_store: 30, supermarket: 30, florist: 15,
  picnic_ground: 120, city_park: 60,
  scenic_spot: 45, nature_preserve: 90, observation_deck: 30,
  tourist_attraction: 60,
};
const DEFAULT_STOP_DURATION = 45;

// ── Declarative Experience Type Definitions ────────────────────────────────

interface StopDef {
  role: string;           // Human label (e.g., 'Activity', 'Dinner', 'Flowers')
  optional?: boolean;     // If true, card is valid without this stop
  dismissible?: boolean;  // If true, user can hide this stop in mobile UI
  reverseAnchor?: boolean; // If true, find this stop first, then query others near it
}

interface ExperienceTypeDef {
  id: string;
  label: string;
  stops: StopDef[];
  // Each combo is an array of category IDs (from seedingCategories.ts), one per stop.
  // For stops with optional=true (Flowers), the combo entry is the category for that optional stop.
  combos: string[][];
  taglines: string[];
  descriptionTone: 'adventure' | 'romantic' | 'stroll' | 'group' | 'picnic' | 'firstdate';
}

const EXPERIENCE_TYPES: ExperienceTypeDef[] = [
  {
    id: 'adventurous',
    label: 'Adventurous',
    stops: [
      { role: 'Activity' },
      { role: 'Drinks' },
      { role: 'Dinner' },
    ],
    combos: [
      ['nature_views', 'drink', 'casual_eats'],
      ['nature_views', 'drink', 'fine_dining'],
      ['play', 'drink', 'casual_eats'],
      ['play', 'drink', 'fine_dining'],
    ],
    taglines: [
      'Explore the unexpected — your next discovery awaits',
      'Three stops, endless possibilities',
      'Chart your own path through the city',
      'For the curious soul who loves to wander',
    ],
    descriptionTone: 'adventure',
  },
  {
    id: 'first-date',
    label: 'First Date',
    stops: [
      { role: 'Flowers', optional: true, dismissible: true },
      { role: 'Activity' },
      { role: 'Dinner' },
      { role: 'Drinks' },
    ],
    combos: [
      ['flowers', 'watch', 'fine_dining', 'drink'],
      ['flowers', 'watch', 'casual_eats', 'drink'],
      ['flowers', 'creative_arts', 'fine_dining', 'drink'],
      ['flowers', 'creative_arts', 'casual_eats', 'drink'],
      ['flowers', 'live_performance', 'fine_dining', 'drink'],
      ['flowers', 'live_performance', 'casual_eats', 'drink'],
      ['flowers', 'first_meet', 'fine_dining', 'drink'],
      ['flowers', 'first_meet', 'casual_eats', 'drink'],
    ],
    taglines: [
      'A thoughtful route for a great first impression',
      'Three stops to break the ice',
      'An effortless plan for getting to know someone',
      'Low pressure, high adventure',
    ],
    descriptionTone: 'firstdate',
  },
  {
    id: 'romantic',
    label: 'Romantic',
    stops: [
      { role: 'Flowers', optional: true, dismissible: true },
      { role: 'Experience' },
      { role: 'Dinner' },
      { role: 'Drinks' },
    ],
    combos: [
      ['flowers', 'creative_arts', 'fine_dining', 'drink'],
      ['flowers', 'live_performance', 'fine_dining', 'drink'],
    ],
    taglines: [
      'A curated route for two',
      'Culture and cuisine, perfectly paired',
      'An evening worth dressing up for',
      'Set the mood with a plan worth sharing',
    ],
    descriptionTone: 'romantic',
  },
  {
    id: 'group-fun',
    label: 'Group Fun',
    stops: [
      { role: 'Activity' },
      { role: 'Food' },
      { role: 'Drinks' },
    ],
    combos: [
      ['play', 'casual_eats', 'drink'],
      ['play', 'fine_dining', 'drink'],
      ['watch', 'casual_eats', 'drink'],
      ['watch', 'fine_dining', 'drink'],
    ],
    taglines: [
      'Rally the crew — adventure is calling',
      'Three stops of pure group energy',
      'Good times are better together',
      'A plan the whole squad will love',
    ],
    descriptionTone: 'group',
  },
  {
    id: 'picnic-dates',
    label: 'Picnic Dates',
    stops: [
      { role: 'Groceries' },
      { role: 'Flowers' },
      { role: 'Picnic Spot', reverseAnchor: true },
    ],
    combos: [
      ['groceries', 'flowers', 'picnic_park'],
    ],
    taglines: [
      'Grab supplies, find the perfect spot',
      'A picnic plan from store to park',
      'Simple pleasures, perfect together',
      'Your curated picnic, start to finish',
    ],
    descriptionTone: 'picnic',
  },
  {
    id: 'take-a-stroll',
    label: 'Take a Stroll',
    stops: [
      { role: 'Nature' },
      { role: 'Food' },
    ],
    combos: [
      ['nature_views', 'casual_eats'],
      ['nature_views', 'fine_dining'],
    ],
    taglines: [
      'Nature and a great meal — the perfect pair',
      'A scenic stroll capped with great eats',
      'Nature and bites, perfectly paired',
      'Walk it off, then feast',
    ],
    descriptionTone: 'stroll',
  },
];

// ── Derived constants ──────────────────────────────────────────────────────

const EXPERIENCE_TYPE_MAP: Record<string, ExperienceTypeDef> = {};
for (const et of EXPERIENCE_TYPES) {
  EXPERIENCE_TYPE_MAP[et.id] = et;
}

const CURATED_TYPE_LABELS: Record<string, string> = {};
const TAGLINES_BY_TYPE: Record<string, string[]> = {};
for (const et of EXPERIENCE_TYPES) {
  CURATED_TYPE_LABELS[et.id] = et.label;
  TAGLINES_BY_TYPE[et.id] = et.taglines;
}

// ── Place Pool Query ───────────────────────────────────────────────────────

async function queryPlacePool(
  categoryId: string,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  limit: number = 50,
): Promise<any[]> {
  const includedTypes = getIncludedTypes(categoryId);
  if (includedTypes.length === 0) return [];
  const excludedPrimary = getExcludedPrimaryTypes(categoryId);

  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(centerLat * Math.PI / 180));

  const { data, error } = await supabaseAdmin
    .from('place_pool')
    .select('id, google_place_id, name, address, lat, lng, types, primary_type, rating, review_count, price_level, price_min, price_max, price_tier, opening_hours, website, stored_photo_urls, city_id, city, country')
    .eq('is_active', true)
    .gte('lat', centerLat - latDelta)
    .lte('lat', centerLat + latDelta)
    .gte('lng', centerLng - lngDelta)
    .lte('lng', centerLng + lngDelta)
    .overlaps('types', includedTypes)
    .order('rating', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  // Fetch DB-driven exclusions for this category
  const dbExcludedTypes = await getCategoryExcludedTypes(categoryId);

  return data.filter((p: any) => {
    if (!p.stored_photo_urls?.length) return false;
    // Hardcoded exclusions (legacy — kept for defense in depth)
    if (p.primary_type && excludedPrimary.includes(p.primary_type)) return false;
    if (p.primary_type && GLOBAL_EXCLUDED.has(p.primary_type)) return false;
    // DB-driven exclusions: check full types array, not just primary_type
    if (p.types?.some((t: string) => dbExcludedTypes.has(t))) return false;
    if (isChildVenueName(p.name || '')) return false;
    return true;
  });
}

// ── Build stop from place_pool row ─────────────────────────────────────────

function buildPoolStop(
  place: any,
  stopNumber: number,
  totalStops: number,
  role: string,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
  opts?: { optional?: boolean; dismissible?: boolean },
): any {
  const lat = place.lat ?? 0;
  const lng = place.lng ?? 0;
  const placeType = place.primary_type || 'place';

  const distFromUser = haversineKm(userLat, userLng, lat, lng);
  const travelFromUser = estimateTravelMinutes(distFromUser, travelMode);

  let travelFromPrev: number | null = null;
  if (prevLat !== null && prevLng !== null && stopNumber > 1) {
    const distFromPrev = haversineKm(prevLat, prevLng, lat, lng);
    travelFromPrev = estimateTravelMinutes(distFromPrev, travelMode);
  }

  const stopLabels = totalStops === 2
    ? ['Start Here', 'End With']
    : totalStops === 3
      ? ['Start Here', 'Then', 'End With']
      : ['Start Here', 'Then', 'Then', 'End With'];
  const stopLabel = stopLabels[Math.min(stopNumber - 1, stopLabels.length - 1)] || 'Explore';

  const priceTier = place.price_tier || googleLevelToTierSlug(place.price_level);

  return {
    stopNumber,
    stopLabel,
    role,
    placeId: place.google_place_id || '',
    placePoolId: place.id || '',
    placeName: place.name || 'Unknown Place',
    placeType,
    address: place.address || '',
    rating: place.rating ?? 0,
    reviewCount: place.review_count ?? 0,
    imageUrl: place.stored_photo_urls?.[0] || null,
    imageUrls: (place.stored_photo_urls || []).slice(0, 5),
    priceLevelLabel: priceTier,
    priceMin: place.price_min ?? 0,
    priceMax: place.price_max ?? 0,
    priceTier,
    openingHours: place.opening_hours || {},
    isOpenNow: true,
    website: place.website || null,
    lat,
    lng,
    distanceFromUserKm: Math.round(distFromUser * 100) / 100,
    travelTimeFromUserMin: Math.round(travelFromUser),
    travelTimeFromPreviousStopMin: travelFromPrev !== null ? Math.round(travelFromPrev) : null,
    travelModeFromPreviousStop: stopNumber > 1 ? travelMode : null,
    aiDescription: '',
    estimatedDurationMinutes: STOP_DURATION_MINUTES[placeType] || DEFAULT_STOP_DURATION,
    ...(opts?.optional ? { optional: true } : {}),
    ...(opts?.dismissible ? { dismissible: true } : {}),
    cityId: place.city_id || null,
    city: place.city || null,
    country: place.country || null,
  };
}

// ── Card builder ───────────────────────────────────────────────────────────

function buildCardFromStops(
  stops: any[],
  experienceType: string,
  comboLabels: string[],
  shoppingList?: string[],
): any {
  const taglines = TAGLINES_BY_TYPE[experienceType] || ['A curated experience awaits'];
  const tagline = taglines[Math.floor(Math.random() * taglines.length)];
  const mainStops = stops.filter(s => !s.optional);
  const title = mainStops.map(s => s.placeName).join(' → ');
  const pairingKey = comboLabels.join('|');

  const totalPriceMin = mainStops.reduce((sum, s) => sum + s.priceMin, 0);
  const totalPriceMax = mainStops.reduce((sum, s) => sum + s.priceMax, 0);
  const totalDuration = mainStops.reduce((sum, s) => sum + s.estimatedDurationMinutes, 0)
    + mainStops.slice(1).reduce((sum, s) => sum + (s.travelTimeFromPreviousStopMin || 0), 0);

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
    ...(shoppingList ? { shoppingList } : {}),
  };
}

// ── Generic card generator ─────────────────────────────────────────────────

async function generateCardsForType(
  typeDef: ExperienceTypeDef,
  lat: number,
  lng: number,
  budgetMax: number,
  travelMode: string,
  travelConstraintValue: number,
  limit: number,
  skipDescriptions: boolean,
): Promise<any[]> {
  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = Math.round((speedKmh * 1000 / 60) * travelConstraintValue);
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // Determine if this type uses reverse-anchor (Picnic: find park first)
  const hasReverseAnchor = typeDef.stops.some(s => s.reverseAnchor);

  // Collect all unique category IDs across all combos
  const allCategoryIds = new Set<string>();
  for (const combo of typeDef.combos) {
    for (const catId of combo) {
      allCategoryIds.add(catId);
    }
  }

  // Pre-fetch places from place_pool for all categories in parallel
  const categoryPlaces: Record<string, any[]> = {};

  if (hasReverseAnchor) {
    // For reverse-anchor types: find anchor category first, then query others near it
    const anchorStopIdx = typeDef.stops.findIndex(s => s.reverseAnchor);
    const anchorCategoryId = typeDef.combos[0][anchorStopIdx];

    // Fetch anchor places near user
    categoryPlaces[anchorCategoryId] = await queryPlacePool(anchorCategoryId, lat, lng, clampedRadius);
    console.log(`[generateCardsForType:${typeDef.id}] anchor(${anchorCategoryId}): ${categoryPlaces[anchorCategoryId].length} places`);

    // Other categories will be fetched per-card near the anchor
  } else {
    // Standard: fetch all categories near user in parallel
    await Promise.all(
      [...allCategoryIds].map(async (catId) => {
        categoryPlaces[catId] = await queryPlacePool(catId, lat, lng, clampedRadius);
        console.log(`[generateCardsForType:${typeDef.id}] ${catId}: ${categoryPlaces[catId].length} places`);
      })
    );
  }

  // Build round-robin combo list
  const comboList: string[][] = [];
  const shuffled = shuffle([...typeDef.combos]);
  while (comboList.length < limit * 2) {
    comboList.push(...shuffle([...typeDef.combos]));
  }

  // Build cards
  const cards: any[] = [];
  const globalUsedPlaceIds = new Set<string>();
  const mainStopCount = typeDef.stops.filter(s => !s.optional).length;
  const perStopBudget = budgetMax / mainStopCount;

  for (const combo of comboList) {
    if (cards.length >= limit) break;

    const stops: any[] = [];
    const comboUsedIds = new Set(globalUsedPlaceIds);
    let valid = true;
    let prevLat = lat;
    let prevLng = lng;

    // For reverse-anchor: find anchor stop first
    if (hasReverseAnchor) {
      const anchorStopIdx = typeDef.stops.findIndex(s => s.reverseAnchor);
      const anchorCatId = combo[anchorStopIdx];
      const anchorPlaces = (categoryPlaces[anchorCatId] || []).filter(p => {
        return !comboUsedIds.has(p.google_place_id);
      });
      if (anchorPlaces.length === 0) { valid = false; }
      else {
        const anchor = anchorPlaces[0];
        comboUsedIds.add(anchor.google_place_id);

        // Fetch non-anchor categories near anchor (3km radius)
        const anchorLat = anchor.lat ?? 0;
        const anchorLng = anchor.lng ?? 0;
        for (let i = 0; i < combo.length; i++) {
          if (i === anchorStopIdx) continue;
          const catId = combo[i];
          if (!categoryPlaces[`${catId}_near_${anchor.google_place_id}`]) {
            categoryPlaces[`${catId}_near_${anchor.google_place_id}`] = await queryPlacePool(catId, anchorLat, anchorLng, 3000, 20);
          }
        }

        // Now build stops in order
        for (let i = 0; i < typeDef.stops.length; i++) {
          const stopDef = typeDef.stops[i];
          const catId = combo[i];

          if (i === anchorStopIdx) {
            const stop = buildPoolStop(
              anchor, stops.length + 1, typeDef.stops.length, stopDef.role,
              lat, lng, stops.length > 0 ? prevLat : null, stops.length > 0 ? prevLng : null,
              travelMode, { optional: stopDef.optional, dismissible: stopDef.dismissible },
            );
            stops.push(stop);
            prevLat = anchor.lat;
            prevLng = anchor.lng;
          } else {
            const nearKey = `${catId}_near_${anchor.google_place_id}`;
            const available = (categoryPlaces[nearKey] || []).filter(p => {
              if (comboUsedIds.has(p.google_place_id)) return false;
              if (!stopDef.optional && p.price_min > perStopBudget) return false;
              return true;
            });
            if (available.length === 0 && !stopDef.optional) { valid = false; break; }
            if (available.length === 0 && stopDef.optional) continue;

            const place = selectClosestHighestRated(available, prevLat, prevLng);
            if (!place && !stopDef.optional) { valid = false; break; }
            if (!place) continue;

            comboUsedIds.add(place.google_place_id);
            const stop = buildPoolStop(
              place, stops.length + 1, typeDef.stops.length, stopDef.role,
              lat, lng, stops.length > 0 ? prevLat : null, stops.length > 0 ? prevLng : null,
              travelMode, { optional: stopDef.optional, dismissible: stopDef.dismissible },
            );
            stops.push(stop);
            prevLat = place.lat;
            prevLng = place.lng;
          }
        }
      }
    } else {
      // Standard: build stops in order with proximity chaining
      for (let i = 0; i < typeDef.stops.length; i++) {
        const stopDef = typeDef.stops[i];
        const catId = combo[i];

        const available = (categoryPlaces[catId] || []).filter(p => {
          if (comboUsedIds.has(p.google_place_id)) return false;
          if (!stopDef.optional && p.price_min > perStopBudget) return false;
          // Fine Dining price floor
          if (catId === 'fine_dining' && !tierMeetsMinimum(googleLevelToTierSlug(p.price_level), 'bougie') && p.price_tier !== 'bougie' && p.price_tier !== 'baller') {
            // Allow if price_tier is already set correctly, otherwise check price_level
          }
          return true;
        });

        if (available.length === 0) {
          if (stopDef.optional) continue; // Skip optional stops gracefully
          valid = false;
          break;
        }

        // Stop 1 (first non-optional): highest quality. Stop 2+: proximity-chained.
        const isFirstMainStop = stops.filter(s => !s.optional).length === 0;
        const place = isFirstMainStop
          ? available[0]
          : selectClosestHighestRated(available, prevLat, prevLng);

        if (!place) {
          if (stopDef.optional) continue;
          valid = false;
          break;
        }

        comboUsedIds.add(place.google_place_id);
        const stop = buildPoolStop(
          place, stops.length + 1, typeDef.stops.length, stopDef.role,
          lat, lng, stops.length > 0 ? prevLat : null, stops.length > 0 ? prevLng : null,
          travelMode, { optional: stopDef.optional, dismissible: stopDef.dismissible },
        );
        stops.push(stop);
        prevLat = place.lat;
        prevLng = place.lng;
      }
    }

    // Validate: must have at least the required (non-optional) stops
    const requiredStops = typeDef.stops.filter(s => !s.optional).length;
    const builtRequired = stops.filter(s => !s.optional).length;
    if (!valid || builtRequired < requiredStops) continue;

    // Validate budget
    const totalMin = stops.filter(s => !s.optional).reduce((s, st) => s + st.priceMin, 0);
    if (totalMin > budgetMax) continue;

    // Validate travel constraint
    const firstStop = stops.find(s => !s.optional);
    if (firstStop && firstStop.travelTimeFromUserMin > travelConstraintValue * 1.5) continue;

    // Validate no duplicate places
    const placeIds = stops.map(s => s.placeId).filter(Boolean);
    if (new Set(placeIds).size !== placeIds.length) continue;

    const comboLabels = combo.map(catId => SEEDING_CATEGORY_MAP[catId]?.label || catId);

    // For picnic: generate shopping list
    let shoppingList: string[] | undefined;
    if (typeDef.descriptionTone === 'picnic') {
      const groceryStop = stops.find(s => s.role === 'Groceries');
      const parkStop = stops.find(s => s.role === 'Picnic Spot');
      if (groceryStop && parkStop && !skipDescriptions) {
        shoppingList = await generatePicnicShoppingList(groceryStop.placeName, parkStop.placeName, parkStop.placeType);
      } else {
        shoppingList = [...PICNIC_STATIC_SHOPPING_LIST];
      }
    }

    const card = buildCardFromStops(stops, typeDef.id, comboLabels, shoppingList);

    // AI descriptions
    if (!skipDescriptions) {
      try {
        const descFn = typeDef.descriptionTone === 'romantic'
          ? generateRomanticStopDescriptions
          : typeDef.descriptionTone === 'stroll'
            ? generateStrollStopDescriptions
            : generateStopDescriptions;
        const descriptions = await descFn(stops);
        for (let i = 0; i < stops.length; i++) {
          if (descriptions[i]) card.stops[i].aiDescription = descriptions[i];
        }
      } catch (err) {
        console.warn(`[generateCardsForType:${typeDef.id}] AI description failed:`, err);
      }
    }

    // Track used place IDs globally
    for (const stop of stops) {
      if (stop.placeId) globalUsedPlaceIds.add(stop.placeId);
    }

    cards.push(card);
  }

  return cards;
}

// ── Utility functions ──────────────────────────────────────────────────────

function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

// NEAREST-PLACE SELECTION (Block 8 — hardened 2026-03-22)
// Picks the closest candidate by haversine distance. Pre-sorted array
// means equidistant ties break to highest-rated. Replaces tiered 3km/5km logic.
/**
 * Select the nearest place to a reference point by haversine distance.
 * Pure proximity — no tier thresholds. Quality is handled upstream:
 * first stop picks highest-rated; subsequent stops pick nearest.
 */
function selectClosestHighestRated(
  available: any[],
  refLat: number,
  refLng: number,
): any | null {
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];

  let closest = available[0];
  let closestDist = haversineKm(refLat, refLng, available[0].lat ?? 0, available[0].lng ?? 0);
  for (let i = 1; i < available.length; i++) {
    const dist = haversineKm(refLat, refLng, available[i].lat ?? 0, available[i].lng ?? 0);
    if (dist < closestDist) {
      closestDist = dist;
      closest = available[i];
    }
  }
  return closest;
}

// ── Picnic shopping list ───────────────────────────────────────────────────

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

async function generatePicnicShoppingList(
  groceryName: string,
  picnicSpotName: string,
  picnicSpotType: string,
): Promise<string[]> {
  if (!OPENAI_API_KEY) return [...PICNIC_STATIC_SHOPPING_LIST];

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

    const res = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
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
      timeoutMs: 10000,
    });
    const json = await res.json();
    let content = json.choices?.[0]?.message?.content?.trim() ?? '[]';
    content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed: string[] = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length >= 8 && parsed.length <= 12) return parsed;
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

// ── AI Description Generators ──────────────────────────────────────────────

async function generateStopDescriptions(stops: any[]): Promise<string[]> {
  if (!OPENAI_API_KEY) {
    return stops.map(s => `A wonderful stop at ${s.placeName} — high in adventure and full of discovery.`);
  }
  try {
    const stopList = stops
      .map((s, i) => `Stop ${i + 1}: ${s.placeName} (${(s.placeType || '').replace(/_/g, ' ')}), rated ${(s.rating || 0).toFixed(1)}/5`)
      .join('\n');
    const prompt = `You are a travel writer creating short descriptions for a curated day out.
Write exactly ${stops.length} short paragraphs (one per stop, 2-3 sentences each), telling the visitor what to do and the vibe.
Emphasize the sense of adventure, discovery, and excitement. Never describe it as a solo or single-person activity — write for anyone.
Be specific, warm, and fun. Address the reader directly as "you".
Output ONLY a JSON array of ${stops.length} strings with no markdown and no extra keys.

Stops:
${stopList}`;

    const res = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.8 }),
      timeoutMs: 10000,
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content?.trim() ?? '[]';
    const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed: string[] = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length === stops.length) return parsed;
    throw new Error('Unexpected shape');
  } catch (_) {
    return stops.map(s => `${s.placeName} is a great ${(s.placeType || '').replace(/_/g, ' ')} worth visiting on your day out.`);
  }
}

async function generateRomanticStopDescriptions(stops: any[]): Promise<string[]> {
  if (!OPENAI_API_KEY) {
    return stops.map(s => `${s.placeName} is a lovely ${(s.placeType || '').replace(/_/g, ' ')} perfect for a romantic outing.`);
  }
  try {
    const stopList = stops
      .map((s, i) => `Stop ${i + 1}: ${s.placeName} (${(s.placeType || '').replace(/_/g, ' ')}), rated ${(s.rating || 0).toFixed(1)}/5`)
      .join('\n');
    const prompt = `You are a travel writer creating short descriptions for a romantic date.
Write exactly ${stops.length} short paragraphs (one per stop, 2-3 sentences each), telling the couple what to experience.
Emphasize romance, intimacy, and elegance. Write for a couple on a date.
Be specific, warm, and evocative. Address the reader directly as "you".
Output ONLY a JSON array of ${stops.length} strings with no markdown and no extra keys.

Stops:
${stopList}`;

    const res = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.8 }),
      timeoutMs: 10000,
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content?.trim() ?? '[]';
    const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed: string[] = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length === stops.length) return parsed;
    throw new Error('Unexpected shape');
  } catch (_) {
    return stops.map(s => `${s.placeName} is a lovely ${(s.placeType || '').replace(/_/g, ' ')} perfect for a romantic outing.`);
  }
}

async function generateStrollStopDescriptions(stops: any[]): Promise<string[]> {
  if (!OPENAI_API_KEY) {
    return stops.map(s => `${s.placeName} is a wonderful ${(s.placeType || '').replace(/_/g, ' ')} for your stroll day.`);
  }
  try {
    const stopList = stops
      .map((s, i) => `Stop ${i + 1}: ${s.placeName} (${(s.placeType || '').replace(/_/g, ' ')}), rated ${(s.rating || 0).toFixed(1)}/5`)
      .join('\n');
    const prompt = `You are a travel writer creating short descriptions for a leisurely day out — a walk in nature and a nice meal.
Write exactly ${stops.length} short paragraphs (one per stop, 2-3 sentences each).
Emphasize the relaxed, leisurely vibe. Be specific, warm, and inviting. Address the reader as "you".
Output ONLY a JSON array of ${stops.length} strings with no markdown and no extra keys.

Stops:
${stopList}`;

    const res = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.8 }),
      timeoutMs: 10000,
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content?.trim() ?? '[]';
    const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed: string[] = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length === stops.length) return parsed;
    throw new Error('Unexpected shape');
  } catch (_) {
    return stops.map(s => `${s.placeName} is a wonderful ${(s.placeType || '').replace(/_/g, ' ')} for your stroll day.`);
  }
}

// ── Main serve() handler ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  try {
    const body = await req.json();

    if (body.warmPing) {
      return new Response(JSON.stringify({ status: 'warm' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let {
      experienceType = 'adventurous',
      location,
      budgetMin = 0,
      budgetMax = 150,
      travelMode = 'walking',
      travelConstraintValue = 30,
      datetimePref,
      skipDescriptions = false,
      limit = 20,
      session_id,
      batchSeed = 0,
    } = body;
    const warmPool = body.warmPool ?? false;

    if (warmPool && !body.skipDescriptions) {
      skipDescriptions = true;
    }

    // Validate experience type
    const typeDef = EXPERIENCE_TYPE_MAP[experienceType];
    if (!typeDef) {
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

    // Compute radius
    const TRAVEL_SPEEDS_KMH: Record<string, number> = {
      walking: 4.5, biking: 14, transit: 20, driving: 35,
    };
    const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
    const radiusMeters = Math.round((speedKmh * 1000 / 60) * travelConstraintValue);
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
        }, '');

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
        }, '');

        if (poolResult.cards.length >= Math.ceil(limit * 0.75)) {
          console.log(`[pool-first-curated] Served ${poolResult.cards.length} curated cards from pool`);
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

    const generateLimit = warmPool ? Math.min(limit, 15) : limit;
    const cards = await generateCardsForType(
      typeDef,
      location.lat, location.lng, budgetMax, travelMode,
      travelConstraintValue, generateLimit, skipDescriptions,
    );

    console.log(`[curated-v2] Generated ${cards.length} ${experienceType} cards`);

    // Fire-and-forget: Batch store in pool
    if (poolAdmin && cards.length > 0) {
      (async () => {
        try {
          // 1. Collect card rows for insertion
          // Teaser text generation
          const teaserTexts: string[] = [];
          if (OPENAI_API_KEY) {
            try {
              const batchPrompt = `Generate ${cards.length} unique teaser sentences for curated experiences. Each must be max 20 words, intriguing, and must NOT reveal place names or addresses. Focus on vibe/emotion/activity.\n\nGenerate exactly ${cards.length} teasers for "${experienceType}" experiences. Output ONLY a JSON array of ${cards.length} strings.`;
              const teaserRes = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: batchPrompt }], max_tokens: 50 * cards.length, temperature: 0.8 }),
                timeoutMs: 10000,
              });
              const teaserJson = await teaserRes.json();
              const teaserContent = teaserJson.choices?.[0]?.message?.content?.trim() ?? '[]';
              const cleanContent = teaserContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
              const parsed = JSON.parse(cleanContent);
              if (Array.isArray(parsed)) teaserTexts.push(...parsed);
            } catch (teaserErr) {
              console.warn('[curated-v2] Teaser generation failed:', teaserErr);
            }
          }

          // Build card rows
          const cardEntries = cards.map((card: any, cardIndex: number) => {
            const stops = card.stops || [];
            const mainStops = stops.filter((s: any) => !s.optional);
            const stopGooglePlaceIds = stops.map((s: any) => s.placeId).filter(Boolean);
            const stopPlacePoolIds = stops.map((s: any) => s.placePoolId).filter(Boolean);
            const popularityScore = Math.min(5, (card.matchScore || 85) / 20) * Math.log10(2);

            // Resolve category slug and city_id from first main stop
            const stopCategorySlug = mainStops[0]?.placeType
              ? googleTypeToSlug(mainStops[0].placeType)
              : 'casual_eats';
            const stopCityId = mainStops[0]?.cityId || null;

            return {
              row: {
                card_type: 'curated' as const,
                place_pool_id: null,
                google_place_id: mainStops[0]?.placeId || card.id || `curated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: card.title || `${experienceType} Experience`,
                category: stopCategorySlug,
                categories: mainStops.map((s: any) => googleTypeToSlug(s.placeType || 'restaurant')),
                description: card.tagline || '',
                highlights: [],
                image_url: mainStops[0]?.imageUrl || null,
                images: mainStops.map((s: any) => s.imageUrl).filter(Boolean),
                address: mainStops[0]?.address || '',
                lat: mainStops[0]?.lat || location.lat,
                lng: mainStops[0]?.lng || location.lng,
                rating: Math.min(5, (card.matchScore || 85) / 20),
                review_count: 0,
                price_min: card.totalPriceMin || 0,
                price_max: card.totalPriceMax || 0,
                price_tier: mainStops[0]?.priceTier || 'comfy',
                opening_hours: null,
                website: null,
                popularity_score: popularityScore,
                is_active: true,
                curated_pairing_key: card.pairingKey || null,
                experience_type: experienceType,
                stops: card.stops,
                tagline: card.tagline || '',
                total_price_min: card.totalPriceMin || 0,
                total_price_max: card.totalPriceMax || 0,
                estimated_duration_minutes: card.estimatedDurationMinutes || 0,
                shopping_list: card.shoppingList || null,
                teaser_text: teaserTexts[cardIndex] || `A ${experienceType} experience with ${mainStops.length} curated stops`,
                city_id: stopCityId,
                city: mainStops[0]?.city || null,
                country: mainStops[0]?.country || null,
              },
              stopPlacePoolIds,
              stopGooglePlaceIds,
            };
          });

          // Insert cards + normalized stops
          const cardRows = cardEntries.map((e: any) => e.row);
          if (cardRows.length > 0) {
            const { data: insertedCards, error: cardError } = await poolAdmin
              .from('card_pool')
              .upsert(cardRows, { onConflict: 'google_place_id' })
              .select('id, google_place_id');

            if (cardError) {
              console.warn('[curated-v2] Batch card insert error:', cardError.message);
            }

            if (insertedCards?.length) {
              const stopRows: any[] = [];
              for (const inserted of insertedCards) {
                const entry = cardEntries.find((e: any) => e.row.google_place_id === inserted.google_place_id);
                if (!entry) continue;
                for (let i = 0; i < entry.stopPlacePoolIds.length; i++) {
                  stopRows.push({
                    card_pool_id: inserted.id,
                    place_pool_id: entry.stopPlacePoolIds[i],
                    google_place_id: entry.stopGooglePlaceIds[i] || '',
                    stop_order: i,
                  });
                }
              }
              if (stopRows.length > 0) {
                const { error: stopsError } = await poolAdmin
                  .from('card_pool_stops')
                  .upsert(stopRows, { onConflict: 'card_pool_id,place_pool_id' });
                if (stopsError) {
                  console.warn('[curated-v2] Batch stops insert error:', stopsError.message);
                }
              }

              // CRIT-001: Cleanup cards with missing stops
              const insertedIds = insertedCards.map((c: any) => c.id);
              const { data: stopCounts } = await poolAdmin
                .from('card_pool_stops')
                .select('card_pool_id')
                .in('card_pool_id', insertedIds);

              const actualStopCounts: Record<string, number> = {};
              for (const row of (stopCounts || [])) {
                actualStopCounts[row.card_pool_id] = (actualStopCounts[row.card_pool_id] || 0) + 1;
              }

              const expectedStopCounts: Record<string, number> = {};
              for (const inserted of insertedCards) {
                const entry = cardEntries.find((e: any) => e.row.google_place_id === inserted.google_place_id);
                expectedStopCounts[inserted.id] = entry?.stopPlacePoolIds?.length || 0;
              }

              const invalidIds = insertedIds.filter((id: string) =>
                (actualStopCounts[id] || 0) < (expectedStopCounts[id] || 1)
              );
              if (invalidIds.length > 0) {
                await poolAdmin.from('card_pool').delete().in('id', invalidIds);
                console.warn(`[curated-v2] CRIT-001: Deleted ${invalidIds.length} curated cards with missing/partial stops`);
              }

              // Record impressions
              if (!warmPool && poolUserId !== 'anonymous') {
                const { data: survivingCards } = await poolAdmin
                  .from('card_pool')
                  .select('id')
                  .in('id', insertedIds);
                const servedIds = (survivingCards || []).slice(0, limit).map((c: any) => c.id);
                if (servedIds.length > 0) {
                  await recordImpressions(poolAdmin, poolUserId, servedIds);
                }
              }

              console.log(`[curated-v2] Batch stored ${cardRows.length} cards in pool`);
            }
          }
        } catch (storeError) {
          console.warn('[curated-v2] Pool batch store error:', storeError);
        }
      })();
    }

    const servedCards = warmPool ? [] : cards.slice(0, limit);
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
