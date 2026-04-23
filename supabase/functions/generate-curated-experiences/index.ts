import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serveCuratedCardsFromPool } from '../_shared/cardPoolService.ts';
import { SEEDING_CATEGORY_MAP } from '../_shared/seedingCategories.ts';
import { googleLevelToTierSlug, slugMeetsMinimum } from '../_shared/priceTiers.ts';
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

// (Type exclusion code removed — AI validation is the sole quality gate.
//  Single cards are already filtered at generation time.)

// ── Session preference aggregation (for collaboration mode) ────────────────

const SESSION_INTENT_IDS = new Set([
  'adventurous', 'first-date', 'romantic', 'group-fun', 'picnic-dates', 'take-a-stroll',
]);

// ORCH-0434: budgetMin/budgetMax removed from return type.
async function aggregateSessionPreferences(sessionId: string): Promise<{
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

  // ORCH-0434: budgetMin/budgetMax removed from aggregation.

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
    categories, experienceTypes,
    travelMode, travelConstraintValue,
    datetimePref, location,
  };
}

// (Old STOP_DURATION_MINUTES by Google type removed — replaced by
//  CATEGORY_DURATION_MINUTES in buildCardStop, keyed by Mingla category)

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
    // ORCH-0601 — 2-stop structure, 6 combos mixing cultural + physical activities.
    // Slugs `hiking` (nature subset) and `museum` (creative_arts subset) route via
    // COMBO_SLUG_TYPE_FILTER to narrow the filter signal to specific types.
    // Food stops (casual_food, upscale_fine_dining) rank by `lively` for post-
    // adventure energetic dining.
    id: 'adventurous',
    label: 'Adventurous',
    stops: [
      { role: 'auto' },  // slug-derived
      { role: 'auto' },
    ],
    combos: [
      ['play',          'casual_food'],
      ['theatre',       'casual_food'],
      ['hiking',        'casual_food'],
      ['theatre',       'upscale_fine_dining'],
      ['creative_arts', 'upscale_fine_dining'],
      ['museum',        'upscale_fine_dining'],
    ],
    taglines: [
      'Explore the unexpected — your next discovery awaits',
      'Chart your own path through the city',
      'For the curious soul who loves to wander',
      'Adventure is calling — pick your path',
    ],
    descriptionTone: 'adventure',
  },
  {
    // ORCH-0599.4: First Date shrunk from 4 stops to 3; drops standalone Drinks stop
    // (drinks is now one option at Stop 3). Replaces legacy movies_theatre + brunch_lunch_casual
    // slugs with their split successors (movies, theatre, brunch, casual_food). All non-Flowers
    // stops signal-ranked by `icebreakers` so conversation-friendly, low-pressure venues
    // surface over high-intensity ones (eg. casual upscale bistros over Angus Barn).
    id: 'first-date',
    label: 'First Date',
    stops: [
      { role: 'Flowers', optional: true, dismissible: true },
      { role: 'Activity' },
      { role: 'Wind Down' },
    ],
    combos: [
      ['flowers', 'brunch',         'creative_arts'],
      ['flowers', 'theatre',        'upscale_fine_dining'],
      ['flowers', 'movies',         'upscale_fine_dining'],
      ['flowers', 'play',           'drinks_and_music'],
      ['flowers', 'play',           'upscale_fine_dining'],
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
    // ORCH-0599.3: Romantic shrunk from 4 stops to 3; drops Drinks (user directive 2026-04-21).
    // Stops now signal-powered: Flowers ranked by `flowers` signal (filters out balloon/plant/
    // non-bouquet false positives); Experience/Dinner ranked by `romantic` signal over the
    // chip-filter signal (fine_dining/creative_arts/theatre ≥120) so intimate/candlelit
    // date-night venues surface over group steakhouses and chain restaurants.
    id: 'romantic',
    label: 'Romantic',
    stops: [
      { role: 'Flowers', optional: true, dismissible: true },
      { role: 'Experience' },
      { role: 'Dinner' },
    ],
    combos: [
      ['flowers', 'creative_arts', 'upscale_fine_dining'],
      ['flowers', 'theatre', 'upscale_fine_dining'],
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
    // ORCH-0628 — 2-stop structure, 5 combos mixing Activity-first and Food-first.
    // Stop roles are slug-derived at build time (see SLUG_TO_STOP_ROLE) since position 0
    // is sometimes Activity (play/movies/theatre) and sometimes Food (brunch).
    label: 'Group Fun',
    stops: [
      { role: 'auto' },  // slug-derived via SLUG_TO_STOP_ROLE (Group Fun only — mixed orderings)
      { role: 'auto' },
    ],
    combos: [
      ['play', 'upscale_fine_dining'],
      ['play', 'casual_food'],
      ['theatre', 'upscale_fine_dining'],
      ['brunch', 'creative_arts'],
      ['movies', 'upscale_fine_dining'],
    ],
    taglines: [
      'Rally the crew — adventure is calling',
      'Good times are better together',
      'A plan the whole squad will love',
      'Group energy, start to finish',
    ],
    descriptionTone: 'group',
  },
  {
    id: 'picnic-dates',
    label: 'Picnic Dates',
    stops: [
      { role: 'Groceries' },
      { role: 'Flowers', optional: true, dismissible: true },
      { role: 'Picnic Spot', reverseAnchor: true },
    ],
    combos: [
      ['groceries', 'flowers', 'nature'],
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
    // ORCH-0601 — split stale brunch_lunch_casual into brunch + casual_food.
    // Nature stop ranks by `scenic`, Food stops rank by `icebreakers`.
    id: 'take-a-stroll',
    label: 'Take a Stroll',
    stops: [
      { role: 'Nature' },
      { role: 'Food' },
    ],
    combos: [
      ['nature', 'brunch'],
      ['nature', 'casual_food'],
      ['nature', 'upscale_fine_dining'],
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

// ── Single Card Query (curated cards built from singles) ──────────────────

// ORCH-0634: fetchSinglesForCategory DELETED. The function read from
// card_pool.contains('categories', [catId]) which silently returned zero rows
// for the new split chip slugs (brunch, casual_food, movies, theatre) because
// card_pool.categories stored old bundled slugs only. Replacement: every caller
// now uses fetchSinglesForSignalRank via fetchForCombo (which always resolves
// a signal via COMBO_SLUG_TO_FILTER_SIGNAL — no card_pool fallback).
//
// If you find yourself wanting to re-add this for any reason, stop. card_pool
// is deprecated and ORCH-0640 will DROP the table. Use signal scores instead.

// ── ORCH-0599.3: Signal-aware picker for Romantic experience stops ────────
// Queries card_pool JOINed with place_scores to:
//   1. Filter places that score >= filterMin on filterSignal (e.g., fine_dining >= 120)
//   2. Rank results by rankSignal score DESC (e.g., romantic score)
// This replaces rating-based shuffle ordering for Romantic-experience stops,
// surfacing the most date-night-appropriate fine-dining/creative-arts/theatre
// venues instead of a random upscale_fine_dining place.
async function fetchSinglesForSignalRank(
  filterSignal: string,
  filterMin: number,
  rankSignal: string,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  limit: number = 50,
  requiredTypes?: string[],  // ORCH-0601: optional sub-filter — places must have at least one of these types (e.g., 'hiking_area','museum')
): Promise<any[]> {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(centerLat * Math.PI / 180));

  // Step 1: find place_ids that pass the filter signal threshold
  const { data: filterRows, error: filterErr } = await supabaseAdmin
    .from('place_scores')
    .select('place_id')
    .eq('signal_id', filterSignal)
    .gte('score', filterMin);

  if (filterErr || !filterRows || filterRows.length === 0) return [];
  let eligibleIds = filterRows.map((r: any) => r.place_id);

  // ORCH-0601 Step 1b: optional type-restriction (e.g. 'hiking' subset of nature,
  // 'museum' subset of creative_arts). Keeps only place_ids whose place_pool.types
  // overlaps with requiredTypes.
  if (requiredTypes && requiredTypes.length > 0) {
    const { data: typedRows, error: typedErr } = await supabaseAdmin
      .from('place_pool')
      .select('id')
      .in('id', eligibleIds)
      .overlaps('types', requiredTypes);
    if (typedErr || !typedRows) return [];
    const typedSet = new Set<string>(typedRows.map((r: any) => r.id));
    eligibleIds = eligibleIds.filter((id: string) => typedSet.has(id));
    if (eligibleIds.length === 0) return [];
  }

  // Step 2: find their rank signal scores, ordered DESC
  const { data: rankRows, error: rankErr } = await supabaseAdmin
    .from('place_scores')
    .select('place_id, score')
    .eq('signal_id', rankSignal)
    .in('place_id', eligibleIds)
    .order('score', { ascending: false })
    .limit(limit * 3); // over-fetch for lat/lng filter + card_pool join losses

  if (rankErr || !rankRows || rankRows.length === 0) return [];
  const rankedIds = rankRows.map((r: any) => r.place_id);
  const rankScoreById = new Map<string, number>();
  for (const r of rankRows) rankScoreById.set(r.place_id, Number(r.score));

  // ORCH-0634: Step 3 rewritten to read place_pool DIRECTLY (was: card_pool join).
  // Eliminates the 44-row card_pool gap AND the split-slug filter bug. Output
  // shape mimics the old card_pool row so downstream assembly is unchanged.
  //
  // Three-gate serving enforced here:
  //   G1: pp.is_servable = true
  //   G2: signal_score >= filter_min (enforced upstream via place_scores filter)
  //   G3: real stored_photo_urls (no NULL, no empty, no __backfill_failed__ sentinel)
  const { data: places, error: placeErr } = await supabaseAdmin
    .from('place_pool')
    .select('id, google_place_id, name, address, lat, lng, rating, review_count, price_level, price_range_start_cents, price_range_end_cents, opening_hours, website, stored_photo_urls, photos, types, primary_type, utc_offset_minutes, ai_categories, city_id, city, country')
    .eq('is_active', true)
    .eq('is_servable', true)
    .in('id', rankedIds)
    .gte('lat', centerLat - latDelta)
    .lte('lat', centerLat + latDelta)
    .gte('lng', centerLng - lngDelta)
    .lte('lng', centerLng + lngDelta)
    .limit(limit * 2);

  if (placeErr || !places) {
    console.warn(`[fetchSinglesForSignalRank] place_pool fetch error for ${filterSignal}/${rankSignal}: ${placeErr?.message ?? 'no data'}`);
    return [];
  }

  // Step 4: apply G3 photo gate + shape each row as the assembler expects.
  // Historical card_pool schema fields (title, images, image_url, etc.) are
  // mapped from place_pool equivalents so generateCardsForType stays unchanged.
  const withScore = places
    .filter((pp: any) => {
      const urls = pp.stored_photo_urls;
      if (!Array.isArray(urls) || urls.length === 0) return false;
      if (urls.length === 1 && urls[0] === '__backfill_failed__') return false;
      return true;
    })
    .map((pp: any) => ({
      // Identity — use place_pool_id for both id + place_pool_id so consumers
      // that key on either work. card_pool.id is gone; downstream code that
      // references card.id will get the place_pool UUID, which is unique.
      id: pp.id,
      place_pool_id: pp.id,
      google_place_id: pp.google_place_id,
      // Presentation (card_pool.title was a copy of place_pool.name)
      title: pp.name,
      address: pp.address,
      lat: pp.lat,
      lng: pp.lng,
      rating: pp.rating,
      review_count: pp.review_count,
      // Price — derive legacy min/max/tier from place_pool columns
      price_level: pp.price_level,
      price_min: pp.price_range_start_cents != null ? Math.floor(pp.price_range_start_cents / 100) : null,
      price_max: pp.price_range_end_cents != null ? Math.floor(pp.price_range_end_cents / 100) : null,
      price_tier: null,      // card_pool had this; assembler tolerates null
      price_tiers: null,
      // Hours + meta
      opening_hours: pp.opening_hours,
      website: pp.website,
      images: pp.stored_photo_urls,
      image_url: pp.stored_photo_urls?.[0] ?? null,
      city_id: pp.city_id,
      city: pp.city,
      country: pp.country,
      utc_offset_minutes: pp.utc_offset_minutes,
      // Categories — still passed through from place_pool.ai_categories.
      // card_pool.categories is deprecated and not read anywhere post-ORCH-0634.
      ai_categories: pp.ai_categories,
      category: (pp.ai_categories?.[0] ?? null),
      categories: pp.ai_categories,
      // Types + signal rank score
      types: pp.types,
      primary_type: pp.primary_type,
      _rankScore: rankScoreById.get(pp.id) ?? 0,
    }))
    .sort((a: any, b: any) => b._rankScore - a._rankScore)
    .slice(0, limit);

  return withScore;
}

// Mapping from combo category slug → filter signal. Chip slugs sometimes differ
// from signal ids (e.g., chip 'upscale_fine_dining' uses signal 'fine_dining').
const COMBO_SLUG_TO_FILTER_SIGNAL: Record<string, string> = {
  'upscale_fine_dining': 'fine_dining',
  'drinks_and_music': 'drinks',
  'brunch_lunch_casual': 'brunch',
  'casual_food': 'casual_food',
  'brunch': 'brunch',
  'movies': 'movies',
  'theatre': 'theatre',
  'movies_theatre': 'movies', // legacy TRANSITIONAL — movies union handled upstream
  'creative_arts': 'creative_arts',
  'nature': 'nature',
  'play': 'play',
  'icebreakers': 'icebreakers',
  'flowers': 'flowers',
  'groceries': 'groceries',
  // ORCH-0601 — sub-category slugs. These reuse an existing signal but add a
  // required-types filter (see COMBO_SLUG_TYPE_FILTER below). Used by Adventurous
  // to distinguish "hiking trails" (nature subset) vs generic nature parks, and
  // "museum" (creative_arts subset) vs generic galleries/art classes.
  'hiking': 'nature',
  'museum': 'creative_arts',
};

// ORCH-0601 — Slugs that narrow a filter signal to a sub-category via types.
// A place passes the filter iff it scores >= filter_min on the filter signal
// AND its place_pool.types overlaps with this list.
const COMBO_SLUG_TYPE_FILTER: Record<string, string[]> = {
  hiking: ['hiking_area', 'state_park', 'nature_preserve', 'national_park', 'wildlife_refuge', 'scenic_spot'],
  museum: ['museum', 'art_museum'],
};

// Mapping from experience type id → (combo slug → rank signal). When an experience
// type wants to rank a stop by a "vibe" signal instead of the chip's own signal,
// declare it here. E.g., Romantic ranks non-flowers stops by the `romantic` signal.
const EXPERIENCE_RANK_SIGNAL_OVERRIDE: Record<string, Record<string, string>> = {
  'romantic': {
    // NOTE: Flowers stop intentionally NOT signal-overridden. card_pool.categories=[flowers]
    // was manually curated to the correct set of "big-store bouquet sources" (Trader Joe's,
    // Wegmans, Whole Foods, Harris Teeter) which Google's raw florist type tag misses. The
    // signal-aware picker would be stricter than needed. Legacy fetchSinglesForCategory
    // returns the 5 curated big stores — matches user directive "only at the big stores".
    // Non-Flowers romantic stops get signal-aware ranking by romantic vibe.
    'creative_arts': 'romantic',
    'theatre': 'romantic',
    'upscale_fine_dining': 'romantic',
  },
  'first-date': {
    // All non-Flowers stops rank by `icebreakers` vibe signal — conversation-friendly,
    // low-pressure, casual. Surfaces bistros/cafés/accessible upscale over intense
    // candlelit venues. Flowers stop inherits legacy card_pool curated big-store list.
    'brunch': 'icebreakers',
    'theatre': 'icebreakers',
    'movies': 'icebreakers',
    'play': 'icebreakers',
    'creative_arts': 'icebreakers',
    'upscale_fine_dining': 'icebreakers',
    'drinks_and_music': 'icebreakers',
  },
  'group-fun': {
    // ORCH-0628 — all stops rank by `lively` vibe signal. Surfaces bowling/arcade/
    // sports-bar energy on Activity stop, group-friendly bistros over candlelit spots
    // on Food stop, and lively upscale venues (Capital Grille, Sullivan's) over
    // intimate ones (Second Empire) on Dinner stop.
    'play': 'lively',
    'theatre': 'lively',
    'movies': 'lively',
    'brunch': 'lively',
    'creative_arts': 'lively',
    'casual_food': 'lively',
    'upscale_fine_dining': 'lively',
  },
  'adventurous': {
    // ORCH-0601 — Activity stops (play, hiking, theatre, creative_arts, museum)
    // rank by their own chip signal (no override). Food stops rank by `lively` —
    // after an adventurous outing, surface energetic restaurants over intimate ones.
    'casual_food': 'lively',
    'upscale_fine_dining': 'lively',
  },
  'take-a-stroll': {
    // ORCH-0601 — Nature stop ranks by `scenic` (trails/greenways/gardens over
    // playgrounds). Food stops rank by `icebreakers` — casual conversation-friendly
    // spots for post-walk dining, not intense candlelit venues.
    'nature': 'scenic',
    'brunch': 'icebreakers',
    'casual_food': 'icebreakers',
    'upscale_fine_dining': 'icebreakers',
  },
  'picnic-dates': {
    // ORCH-0601 — Picnic Spot ranks by `picnic_friendly` (tables/shelters/lawns
    // over hiking-heavy preserves). Pullen/Lake Johnson/Shelley > Williamson Preserve.
    'nature': 'picnic_friendly',
  },
};

// Per-slug stop role label for dynamic role assignment (ORCH-0628). When a typeDef's
// stop roles are generic placeholders and combos mix orderings (Activity-first vs
// Food-first), the display label should reflect the actual slug. Falls back to
// stopDef.role if slug not in map.
const SLUG_TO_STOP_ROLE: Record<string, string> = {
  play: 'Activity',
  movies: 'Movie',
  theatre: 'Show',
  creative_arts: 'Experience',
  nature: 'Nature',
  brunch: 'Brunch',
  brunch_lunch_casual: 'Brunch',
  casual_food: 'Food',
  upscale_fine_dining: 'Dinner',
  drinks_and_music: 'Drinks',
  flowers: 'Flowers',
  groceries: 'Groceries',
  icebreakers: 'Icebreaker',
  hiking: 'Hike',       // ORCH-0601
  museum: 'Museum',     // ORCH-0601
};

// Resolves stop role label. Opt-in: only typeDefs with role='auto' get slug-derived
// labels. Existing typeDefs (Romantic, First Date, Picnic Dates, etc.) keep their
// curated role strings unchanged to preserve thematic copy ("Wind Down", "Experience").
function resolveStopRole(slug: string, stopDef: StopDef): string {
  if (stopDef.role === 'auto') {
    return SLUG_TO_STOP_ROLE[slug] ?? 'Stop';
  }
  return stopDef.role;
}

// Per-stop filter_min override. Most signals use 120; movies is 80 (tiny universe);
// flowers is 80 — keeps 2 boutique florists (Mio Kreations 155, Petal & Oak 102) + 12 Harris
// Teeter locations with florist tag (97-136) while filtering out noise leaks: Fresh Market
// (69, no florist tag), candy/chocolate/catering/bakery false positives scoring 50-66.
const COMBO_SLUG_FILTER_MIN: Record<string, number> = {
  'movies': 80,
  'flowers': 80,
};

// ── Build stop from place_pool row ─────────────────────────────────────────

// Duration map by Mingla category (replaces STOP_DURATION_MINUTES keyed by Google type)
// ORCH-0434: Updated to new canonical slugs.
const CATEGORY_DURATION_MINUTES: Record<string, number> = {
  brunch_lunch_casual: 60, upscale_fine_dining: 90, drinks_and_music: 60,
  icebreakers: 45, nature: 60, movies_theatre: 120,
  creative_arts: 90, play: 90, flowers: 15, groceries: 20,
};
const CATEGORY_DEFAULT_DURATION = 60;

function buildCardStop(
  card: any,
  stopNumber: number,
  totalStops: number,
  role: string,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
  opts?: { optional?: boolean; dismissible?: boolean; comboCategory?: string },
): any {
  const lat = card.lat ?? 0;
  const lng = card.lng ?? 0;

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

  return {
    stopNumber,
    stopLabel,
    role,
    placeId: card.google_place_id || '',
    placePoolId: card.place_pool_id || '',
    cardPoolId: card.id,
    placeName: card.title || 'Unknown Place',
    placeType: card.category || 'place',
    address: card.address || '',
    rating: card.rating ?? 0,
    reviewCount: card.review_count ?? 0,
    imageUrl: card.image_url || card.images?.[0] || null,
    imageUrls: card.images || (card.image_url ? [card.image_url] : []),
    priceLevelLabel: card.price_tiers?.[0] || card.price_tier || 'chill',
    priceMin: card.price_min ?? 0,
    priceMax: card.price_max ?? 0,
    priceTier: card.price_tiers?.[0] || card.price_tier || 'chill',
    priceTiers: card.price_tiers?.length ? card.price_tiers : (card.price_tier ? [card.price_tier] : ['chill']),
    openingHours: card.opening_hours || {},
    isOpenNow: true,
    website: card.website || null,
    lat,
    lng,
    distanceFromUserKm: Math.round(distFromUser * 100) / 100,
    travelTimeFromUserMin: Math.round(travelFromUser),
    travelTimeFromPreviousStopMin: travelFromPrev !== null ? Math.round(travelFromPrev) : null,
    travelModeFromPreviousStop: stopNumber > 1 ? travelMode : null,
    aiDescription: '',
    estimatedDurationMinutes: CATEGORY_DURATION_MINUTES[card.category] || CATEGORY_DEFAULT_DURATION,
    ...(opts?.optional ? { optional: true } : {}),
    ...(opts?.dismissible ? { dismissible: true } : {}),
    cityId: card.city_id || null,
    city: card.city || null,
    country: card.country || null,
    aiCategories: card.ai_categories || card.categories || [],
    ...(opts?.comboCategory ? { comboCategory: opts.comboCategory } : {}),
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

  // Derive category from first main stop's AI categories
  const category = mainStops[0]?.aiCategories?.[0] || mainStops[0]?.placeType || 'brunch_lunch_casual';

  return {
    id: `curated_${experienceType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    cardType: 'curated',
    experienceType,
    pairingKey,
    title,
    tagline,
    category,
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

  // ORCH-0634: EVERY curated stop goes through the signal system. No card_pool
  // fallback. Rank signal = experience override (e.g. Romantic ranks by 'romantic'
  // vibe) if present, else the filter signal itself. Type filter (hiking/museum
  // sub-cats) applies when set. Flowers is signal-routed at filter_min=60
  // (see COMBO_SLUG_FILTER_MIN below) — the legacy curated-big-store-list
  // exception is gone; the v1.3.0 flowers signal is the sole gate.
  const signalOverride = EXPERIENCE_RANK_SIGNAL_OVERRIDE[typeDef.id];
  const fetchForCombo = async (catId: string, fetchLat: number, fetchLng: number, fetchRadius: number, fetchLimit?: number): Promise<any[]> => {
    const filterSignal = COMBO_SLUG_TO_FILTER_SIGNAL[catId];
    if (!filterSignal) {
      console.warn(`[generate-curated] Unknown combo slug "${catId}" — no COMBO_SLUG_TO_FILTER_SIGNAL entry. Returning [] (no card_pool fallback).`);
      return [];
    }
    const rankOverride = signalOverride?.[catId];
    const typeFilter = COMBO_SLUG_TYPE_FILTER[catId];
    const filterMin = COMBO_SLUG_FILTER_MIN[catId] ?? 120;
    const rankSignal = rankOverride ?? filterSignal; // no override → rank by filter signal itself
    return fetchSinglesForSignalRank(filterSignal, filterMin, rankSignal, fetchLat, fetchLng, fetchRadius, fetchLimit ?? 50, typeFilter);
  };

  if (hasReverseAnchor) {
    // For reverse-anchor types: find anchor category first, then query others near it
    const anchorStopIdx = typeDef.stops.findIndex(s => s.reverseAnchor);
    const anchorCategoryId = typeDef.combos[0][anchorStopIdx];

    // Fetch anchor places near user
    categoryPlaces[anchorCategoryId] = await fetchForCombo(anchorCategoryId, lat, lng, clampedRadius);
    console.log(`[generateCardsForType:${typeDef.id}] anchor(${anchorCategoryId}): ${categoryPlaces[anchorCategoryId].length} places`);

    // Other categories will be fetched per-card near the anchor
  } else {
    // Standard: fetch all categories near user in parallel
    await Promise.all(
      [...allCategoryIds].map(async (catId) => {
        categoryPlaces[catId] = await fetchForCombo(catId, lat, lng, clampedRadius);
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
  // ORCH-0434: Budget filtering removed. perStopBudget set to Infinity to disable.
  const perStopBudget = Infinity;

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
            categoryPlaces[`${catId}_near_${anchor.google_place_id}`] = await fetchForCombo(catId, anchorLat, anchorLng, 3000, 20);
          }
        }

        // Now build stops in order
        for (let i = 0; i < typeDef.stops.length; i++) {
          const stopDef = typeDef.stops[i];
          const catId = combo[i];

          if (i === anchorStopIdx) {
            const stop = buildCardStop(
              anchor, stops.length + 1, typeDef.stops.length, resolveStopRole(catId, stopDef),
              lat, lng, stops.length > 0 ? prevLat : null, stops.length > 0 ? prevLng : null,
              travelMode, { optional: stopDef.optional, dismissible: stopDef.dismissible, comboCategory: catId },
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
            const stop = buildCardStop(
              place, stops.length + 1, typeDef.stops.length, resolveStopRole(catId, stopDef),
              lat, lng, stops.length > 0 ? prevLat : null, stops.length > 0 ? prevLng : null,
              travelMode, { optional: stopDef.optional, dismissible: stopDef.dismissible, comboCategory: catId },
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
          // Fine Dining price floor — check highest tier in array meets minimum
          const bestTier = p.price_tiers?.length ? p.price_tiers[p.price_tiers.length - 1] : p.price_tier;
          if (catId === 'upscale_fine_dining' && bestTier && !slugMeetsMinimum(bestTier, 'bougie')) {
            return false;
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
        const stop = buildCardStop(
          place, stops.length + 1, typeDef.stops.length, resolveStopRole(catId, stopDef),
          lat, lng, stops.length > 0 ? prevLat : null, stops.length > 0 ? prevLng : null,
          travelMode, { optional: stopDef.optional, dismissible: stopDef.dismissible, comboCategory: catId },
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
    // ORCH-0434: Budget ceiling check removed — all price levels included.
    // if (totalMin > budgetMax) continue;

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
      .map((s, i) => `Stop ${i + 1}: ${s.placeName} (${(s.placeType || '').replace(/_/g, ' ')}), rated ${(s.rating || 0).toFixed(1)}/5${s.optional ? ' — OPTIONAL side-stop, can be skipped' : ''}`)
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
      .map((s, i) => `Stop ${i + 1}: ${s.placeName} (${(s.placeType || '').replace(/_/g, ' ')}), rated ${(s.rating || 0).toFixed(1)}/5${s.optional ? ' — OPTIONAL side-stop, can be skipped' : ''}`)
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
      .map((s, i) => `Stop ${i + 1}: ${s.placeName} (${(s.placeType || '').replace(/_/g, ' ')}), rated ${(s.rating || 0).toFixed(1)}/5${s.optional ? ' — OPTIONAL side-stop, can be skipped' : ''}`)
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

    // ORCH-0634: card_pool + card_pool_stops writeback REMOVED.
    //
    // Curated cards are no longer persisted anywhere (I-NO-CURATED-PERSISTENCE).
    // Every request assembles fresh. Only the GPT teaser is cached, keyed by
    // (experience_type + sorted stop place_pool_ids) via the curated_teaser_cache
    // table. Cache key formula is LOCKED per ORCH-0640 coordination — do not
    // change post-cutover (engagement_metrics.container_key reuses this formula).
    //
    // Fire-and-forget: compute cache keys, fetch any existing teasers, call GPT
    // only for the subset that missed, upsert misses back. Served cards are
    // decorated with their teaser in-place so the first-return response includes
    // fresh text; on cache-miss we still return the card without blocking.
    if (poolAdmin && cards.length > 0) {
      (async () => {
        try {
          // Compute cache_key for each card. Stops may lack placePoolId for
          // outlier shapes; those cards are left uncached (GPT would have had
          // to generate anyway — harmless).
          const cardsWithKeys = cards.map((card: any, idx: number) => {
            const stops = (card.stops || []).filter((s: any) => !s.optional);
            const stopIds = stops.map((s: any) => s.placePoolId).filter(Boolean).slice();
            if (stopIds.length === 0) return { card, idx, key: null };
            stopIds.sort(); // LOCKED: ascending string compare on canonical UUID
            const input = `${experienceType}:${stopIds.join(',')}`;
            // deno-lint-ignore no-explicit-any
            return { card, idx, key: null as string | null, stopIds, input };
          });

          // Hash the inputs via Web Crypto (Deno built-in).
          for (const entry of cardsWithKeys) {
            // deno-lint-ignore no-explicit-any
            const e = entry as any;
            if (!e.input) continue;
            const bytes = new TextEncoder().encode(e.input);
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            e.key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
          }

          // Batch lookup — who's already cached?
          // deno-lint-ignore no-explicit-any
          const keys = (cardsWithKeys as any[]).map((e) => e.key).filter(Boolean) as string[];
          if (keys.length === 0) return;
          const { data: cachedRows, error: readErr } = await poolAdmin
            .from('curated_teaser_cache')
            .select('cache_key, one_liner, tip, shopping_list')
            .in('cache_key', keys);
          if (readErr) {
            console.warn(`[curated-teaser-cache] read error: ${readErr.message}`);
            return;
          }
          const cached = new Map<string, { one_liner: string; tip: string | null; shopping_list: string | null }>();
          for (const row of cachedRows ?? []) {
            cached.set(row.cache_key, {
              one_liner: row.one_liner,
              tip: row.tip,
              shopping_list: row.shopping_list,
            });
          }

          // For cache hits: bump last_served_at + serve_count (best-effort).
          if (cached.size > 0) {
            const hitKeys = [...cached.keys()];
            await poolAdmin
              .from('curated_teaser_cache')
              // deno-lint-ignore no-explicit-any
              .update({ last_served_at: new Date().toISOString() } as any)
              .in('cache_key', hitKeys);
          }

          // For cache misses: batch-GPT only the missed subset.
          // deno-lint-ignore no-explicit-any
          const missEntries = (cardsWithKeys as any[]).filter((e) => e.key && !cached.has(e.key));
          if (OPENAI_API_KEY && missEntries.length > 0) {
            try {
              const batchPrompt = `Generate ${missEntries.length} unique teaser sentences for curated experiences. Each must be max 20 words, intriguing, and must NOT reveal place names or addresses. Focus on vibe/emotion/activity.\n\nGenerate exactly ${missEntries.length} teasers for "${experienceType}" experiences. Output ONLY a JSON array of ${missEntries.length} strings.`;
              const teaserRes = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: [{ role: 'user', content: batchPrompt }],
                  max_tokens: 50 * missEntries.length,
                  temperature: 0.8,
                }),
                timeoutMs: 10000,
              });
              const teaserJson = await teaserRes.json();
              const teaserContent = teaserJson.choices?.[0]?.message?.content?.trim() ?? '[]';
              const cleanContent = teaserContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
              const parsed = JSON.parse(cleanContent);
              if (Array.isArray(parsed)) {
                const rowsToInsert: Array<{
                  cache_key: string;
                  experience_type: string;
                  stop_place_pool_ids: string[];
                  one_liner: string;
                  tip: string | null;
                  shopping_list: string | null;
                }> = [];
                for (let i = 0; i < missEntries.length; i++) {
                  const entry = missEntries[i];
                  const teaserText = typeof parsed[i] === 'string' ? parsed[i] : null;
                  if (!teaserText || !entry.key || !entry.stopIds) continue;
                  rowsToInsert.push({
                    cache_key: entry.key,
                    experience_type: experienceType,
                    stop_place_pool_ids: entry.stopIds,
                    one_liner: teaserText,
                    tip: null,
                    shopping_list: entry.card.shoppingList ?? null,
                  });
                }
                if (rowsToInsert.length > 0) {
                  const { error: upsertErr } = await poolAdmin
                    .from('curated_teaser_cache')
                    .upsert(rowsToInsert, { onConflict: 'cache_key', ignoreDuplicates: true });
                  if (upsertErr) {
                    console.warn(`[curated-teaser-cache] upsert error: ${upsertErr.message}`);
                  } else {
                    console.log(`[curated-teaser-cache] inserted ${rowsToInsert.length} new teasers (hits=${cached.size}/${keys.length})`);
                  }
                }
              }
            } catch (teaserErr) {
              console.warn(`[curated-teaser-cache] GPT teaser generation failed: ${(teaserErr as Error)?.message}`);
            }
          } else if (cached.size > 0) {
            console.log(`[curated-teaser-cache] all ${cached.size}/${keys.length} teasers from cache, zero GPT calls`);
          }
        } catch (cacheErr) {
          // Constitution #3: surface, do not swallow.
          console.warn(`[curated-teaser-cache] unexpected error: ${(cacheErr as Error)?.message}`);
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
