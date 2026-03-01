import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '';

const SOLO_ADVENTURE_PAIRINGS: [string, string, string][] = [
  ["park", "coffee_shop", "movie_theater"],
  ["botanical_garden", "brunch_restaurant", "art_gallery"],
  ["hiking_area", "diner", "bowling_alley"],
  ["beach", "seafood_restaurant", "sip_and_paint"],
  ["zoo", "food_court", "escape_room"],
  ["national_park", "sandwich_shop", "planetarium"],
  ["state_park", "vietnamese_restaurant", "museum"],
  ["park", "tea_house", "pottery"],
  ["botanical_garden", "vegan_restaurant", "cooking_classes"],
  ["beach", "bar", "comedy_club"],
  ["hiking_area", "thai_restaurant", "board_game_cafe"],
  ["zoo", "pizza_restaurant", "mini_golf_course"],
  ["park", "wine_bar", "karaoke"],
  ["national_park", "mexican_restaurant", "rock_climbing_gym"],
  ["botanical_garden", "japanese_restaurant", "virtual_reality_center"],
  ["beach", "ramen_restaurant", "video_arcade"],
  ["state_park", "korean_restaurant", "ice_skating_rink"],
  ["park", "pub", "billiards_hall"],
  ["zoo", "american_restaurant", "trampoline_park"],
  ["hiking_area", "mediterranean_restaurant", "flower_arranging_studio"],
  ["beach", "turkish_restaurant", "glass_blowing_studio"],
  ["botanical_garden", "indian_restaurant", "perfume_lab"],
  ["park", "chinese_restaurant", "laser_tag_center"],
  ["national_park", "african_restaurant", "photography_walk"],
  ["state_park", "sushi_restaurant", "sauna"],
  ["zoo", "barbecue_restaurant", "dart_bar"],
  ["beach", "wine_bar", "comedy_club"],
  ["hiking_area", "breakfast_restaurant", "jewelry_making_studio"],
  ["botanical_garden", "french_restaurant", "planetarium"],
  ["park", "hamburger_restaurant", "go_kart_track"],
  ["state_park", "lebanese_restaurant", "float_tank_center"],
  ["beach", "buffet_restaurant", "adventure_park"],
  ["zoo", "vegetarian_restaurant", "sewing_class"],
  ["national_park", "spanish_restaurant", "hot_spring"],
  ["botanical_garden", "coffee_shop", "bakery_workshop"],
  ["park", "middle_eastern_restaurant", "escape_room"],
  ["hiking_area", "indonesian_restaurant", "woodworking_class"],
  ["beach", "pub", "karaoke"],
  ["zoo", "brazilian_restaurant", "paintball_center"],
  ["state_park", "afghani_restaurant", "cold_plunge_facility"],
  ["botanical_garden", "greek_restaurant", "cooking_classes"],
  ["park", "asian_restaurant", "ice_skating_rink"],
  ["national_park", "diner", "stargazing_spot"],
  ["beach", "fast_food_restaurant", "skate_park"],
  ["zoo", "ramen_restaurant", "pottery"],
  ["hiking_area", "coffee_shop", "museum"],
  ["botanical_garden", "wine_bar", "sip_and_paint"],
  ["park", "tea_house", "board_game_cafe"],
  ["beach", "korean_restaurant", "virtual_reality_center"],
  ["state_park", "italian_restaurant", "spa"],
];

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
  'solo-adventure': SOLO_ADVENTURE_PAIRINGS,
  'first-dates':    FIRST_DATES_PAIRINGS,
  'romantic':       ROMANTIC_PAIRINGS,
  'friendly':       FRIENDLY_PAIRINGS,
  'group-fun':      GROUP_FUN_PAIRINGS,
};

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
      const travelTimeFromUser = await getTravelTime(userLat, userLng, lat, lng, travelMode);
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
    const travelMin = await getTravelTime(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng, travelMode);
    stops[i].travelTimeFromPreviousStopMin = travelMin;
    stops[i].travelModeFromPreviousStop = travelMode;
  }
  const totalPriceMax = stops.reduce((sum: number, s: any) => sum + s.priceMax, 0);
  if (budgetMax > 0 && totalPriceMax > budgetMax * 1.2) return null;
  const totalPriceMin = stops.reduce((sum: number, s: any) => sum + s.priceMin, 0);
  const avgRating = stops.reduce((sum: number, s: any) => sum + s.rating, 0) / stops.length;
  const pairingKey = pairing.join('+');
  const travelTotal = stops.slice(1).reduce((s: number, st: any) => s + (st.travelTimeFromPreviousStopMin ?? 15), 0);
  const shortNames = stops.map((s: any) => s.placeName.split(' ').slice(0, 2).join(' '));
  const taglines = ['A full solo day out', 'Three stops, zero plans needed', 'Discover your city, one stop at a time', 'The perfect day for one'];
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
    estimatedDurationMinutes: travelTotal + 210,
    matchScore: Math.round(avgRating * 18 + 10),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const { experienceType = 'solo_adventure', location, budgetMin = 0, budgetMax = 200, travelMode = 'walking', travelConstraintType = 'time', travelConstraintValue = 30, limit = 15 } = body;
    if (!location?.lat || !location?.lng) {
      return new Response(JSON.stringify({ error: 'location.lat and location.lng are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const radiusMeters = travelConstraintType === 'time' ? travelConstraintValue * 80 : travelConstraintValue;
    const clampedRadius = Math.min(Math.max(radiusMeters, 1000), 50000);
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
