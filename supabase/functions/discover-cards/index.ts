import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { batchSearchByCategory, fetchNextPage } from '../_shared/placesCache.ts';
import {
  serveCardsFromPipeline,
  upsertPlaceToPool,
  insertCardToPool,
  recordImpressions,
} from '../_shared/cardPoolService.ts';
import {
  resolveCategories,
  getCategoryTypeMap,
  getExcludedTypesForCategory,
} from '../_shared/categoryPlaceTypes.ts';
import { priceLevelToLabel, priceLevelToRange, googleLevelToTierSlug, PriceTierSlug } from '../_shared/priceTiers.ts';
import { timeoutFetch } from '../_shared/timeoutFetch.ts';
import { scoreCards } from '../_shared/scoringService.ts';
import { enrichCardsWithCopy } from '../_shared/copyEnrichmentService.ts';

/* ─────────────────────────────────────────────────────────────────────────────
 * discover-cards  –  Unified Card Discovery Edge Function
 *
 * Replaces 11 separate discover-{category} edge functions with a single
 * endpoint that handles ALL categories in one request.
 *
 * Pipeline:
 *   1. Pool-first: query card_pool for ALL requested categories at once
 *   2. Gap fill: if pool < 80% of limit, fetch missing from Google API
 *   3. AI descriptions OFF critical path: return immediately with fallbacks,
 *      then fire-and-forget OpenAI enrichment to card_pool
 *   4. Batch upsert results to place_pool + card_pool
 *   5. Record user impressions for served cards
 *
 * Supports:
 *   - Multi-category in one request (e.g. ["Nature", "Drink", "Casual Eats"])
 *   - Offset pagination via batchSeed * limit
 *   - warmPool mode: fetch + store, return empty
 *   - Travel constraint-based radius calculation
 *   - Budget, datetime, distance filtering
 * ──────────────────────────────────────────────────────────────────────────── */

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';
if (!GOOGLE_PLACES_API_KEY) {
  console.error('[discover-cards] FATAL: GOOGLE_MAPS_API_KEY is not set in Supabase secrets');
}
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Category Fallback Descriptions ──────────────────────────────────────────
const CATEGORY_FALLBACK_DESCRIPTIONS: Record<string, string> = {
  'Nature': 'A beautiful [placeType] perfect for outdoor exploration.',
  'Drink': 'A popular [placeType] spot with great ambiance for drinks.',
  'Casual Eats': 'A well-loved [placeType] serving delicious casual fare.',
  'Fine Dining': 'An upscale [placeType] offering a refined dining experience.',
  'First Meet': 'A welcoming [placeType] ideal for a first meeting.',
  'Picnic': 'A lovely [placeType] perfect for a relaxing picnic outing.',
  'Watch': 'An exciting [placeType] for a fun entertainment experience.',
  'Creative & Arts': 'An inspiring [placeType] for creative exploration.',
  'Play': 'A thrilling [placeType] for fun and adventure.',
  'Wellness': 'A serene [placeType] for relaxation and wellness.',
  'Groceries & Flowers': 'A convenient [placeType] for all your essentials.',
  'Work & Business': 'A professional [placeType] for productive meetings.',
};

function getFallbackDescription(category: string, placeType: string): string {
  const template = CATEGORY_FALLBACK_DESCRIPTIONS[category]
    ?? 'A great [placeType] worth exploring.';
  return template.replace('[placeType]', formatPlaceType(placeType).toLowerCase());
}

// ── Types that are typically free / always open (skip hours filter) ──────────
const ALWAYS_OPEN_TYPES = new Set([
  'park', 'hiking_area', 'national_park', 'state_park', 'beach',
  'garden', 'botanical_garden',
  'lake', 'river', 'woods', 'mountain_peak', 'island',
  'campground', 'scenic_spot', 'nature_preserve', 'picnic_ground',
  'wildlife_park', 'wildlife_refuge',
  'plaza', 'tourist_attraction',
]);

// ── Time Slot Ranges ────────────────────────────────────────────────────────
const TIME_SLOT_RANGES: Record<string, { start: number; end: number }> = {
  brunch:    { start: 9,  end: 13 },
  afternoon: { start: 12, end: 17 },
  dinner:    { start: 17, end: 21 },
  lateNight: { start: 21, end: 24 },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const SPEED_KMH: Record<string, number> = {
  walking: 4.5,
  driving: 35,
  transit: 20,
  bicycling: 14,
  biking: 14,
};

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateTravelMin(distKm: number, mode: string): number {
  const speed = SPEED_KMH[mode] || 4.5;
  return Math.max(1, Math.round((distKm / speed) * 60 * 1.3));
}

function getPhotoUrl(place: any): string {
  const photo = place.photos?.[0];
  if (!photo?.name) return '';
  return `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=800&maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}`;
}

function getAllPhotoUrls(place: any, max = 5): string[] {
  return (place.photos || [])
    .slice(0, max)
    .map((p: any) =>
      p.name
        ? `https://places.googleapis.com/v1/${p.name}/media?maxHeightPx=800&maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}`
        : null
    )
    .filter(Boolean);
}

function parseOpeningHours(place: any): { hours: Record<string, string>; isOpenNow: boolean | null } {
  const roh = place.regularOpeningHours;
  if (!roh) return { hours: {}, isOpenNow: null };
  const hours: Record<string, string> = {};
  for (const desc of roh.weekdayDescriptions ?? []) {
    const [day, ...rest] = desc.split(': ');
    if (day) hours[day.toLowerCase()] = rest.join(': ');
  }
  return { hours, isOpenNow: roh.openNow ?? null };
}

function formatPlaceType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// ── DateTime Filter ─────────────────────────────────────────────────────────
function filterByDateTime(
  places: any[],
  datetimePref: string | undefined,
  dateOption: string,
  timeSlot: string | null
): any[] {
  if (dateOption === 'now' || !datetimePref) {
    return places.filter(p => p.isOpenNow !== false);
  }

  const targetDate = new Date(datetimePref);
  const targetDay = targetDate.getDay();

  let targetHourStart: number;
  if (timeSlot && TIME_SLOT_RANGES[timeSlot]) {
    targetHourStart = TIME_SLOT_RANGES[timeSlot].start;
  } else {
    targetHourStart = targetDate.getHours();
  }

  return places.filter(place => {
    const periods = place.regularOpeningHours?.periods;
    if (!periods || periods.length === 0) return true;

    return periods.some((period: any) => {
      if (period.open?.day !== targetDay) return false;
      const openHour = period.open?.hour ?? 0;
      const closeHour = period.close?.hour ?? 24;
      const effectiveClose = closeHour === 0 ? 24 : closeHour;
      return targetHourStart >= openHour && targetHourStart < effectiveClose;
    });
  });
}

/** Simple deterministic shuffle using seed for stable batch ordering */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Calculate match score: closeness + rating + popularity */
function calculateMatchScore(
  place: any,
  userLat: number,
  userLng: number,
  maxDistKm: number
): number {
  const lat = place.location?.latitude ?? 0;
  const lng = place.location?.longitude ?? 0;
  const dist = haversine(userLat, userLng, lat, lng);

  const distScore = Math.max(0, 40 * (1 - dist / maxDistKm));
  const rating = place.rating ?? 0;
  const ratingScore = (rating / 5) * 35;
  const reviews = place.userRatingCount ?? 0;
  const popScore = Math.min(25, (reviews / 1000) * 25);

  return Math.round(distScore + ratingScore + popScore);
}

// ── Helper: Get cache entries that have a nextPageToken for expansion ────────
async function getCacheEntriesWithTokens(
  supabaseAdmin: any,
  location: { lat: number; lng: number },
  categories: string[],
  radiusMeters: number,
): Promise<Array<{ id: string; place_type: string; next_page_token: string | null }>> {
  const locKey = `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`;
  const radBucket = Math.round(radiusMeters / 1000) * 1000;

  // Look for category-level cache entries (new: "cat:CategoryName")
  const catKeys = categories.map(c => `cat:${c}`);

  const { data } = await supabaseAdmin
    .from('google_places_cache')
    .select('id, place_type, next_page_token')
    .eq('location_key', locKey)
    .eq('radius_bucket', radBucket)
    .in('place_type', catKeys)
    .not('next_page_token', 'is', null)
    .gt('expires_at', new Date().toISOString());

  return data || [];
}

// ── Helper: Insert new Google Places into place_pool + card_pool ─────────────
async function expandPoolWithNewPlaces(
  supabaseAdmin: any,
  newPlaces: any[],
  category: string,
): Promise<void> {
  if (!category) return;

  for (const place of newPlaces) {
    const googlePlaceId = place.id;
    if (!googlePlaceId) continue;

    const placePoolId = await upsertPlaceToPool(supabaseAdmin, place, GOOGLE_PLACES_API_KEY);
    const priceRange = priceLevelToRange(place.priceLevel);

    await insertCardToPool(supabaseAdmin, {
      placePoolId: placePoolId || undefined,
      googlePlaceId,
      cardType: 'single',
      title: place.displayName?.text || 'Unknown Place',
      category,
      categories: [category],
      description: getFallbackDescription(category, place.primaryType || place.types?.[0] || 'place'),
      highlights: [],
      imageUrl: getPhotoUrl(place),
      images: getAllPhotoUrls(place),
      address: place.formattedAddress || '',
      lat: place.location?.latitude || 0,
      lng: place.location?.longitude || 0,
      rating: place.rating || 0,
      reviewCount: place.userRatingCount || 0,
      priceMin: priceRange.min,
      priceMax: priceRange.max,
      priceTier: googleLevelToTierSlug(place.priceLevel),
      website: place.websiteUri || null,
    });
  }

  console.log(`[discover-cards] Expanded pool with ${newPlaces.length} places for category: ${category}`);
}

// ── Main Handler ────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const body = await req.json();
    const {
      categories: rawCategories = [],
      location,
      budgetMax = 200,
      travelMode = 'walking',
      travelConstraintValue = 30,
      datetimePref,
      dateOption = 'now',
      timeSlot: rawTimeSlot = null,
      exactTime: rawExactTime = null,
      batchSeed = 0,
      limit = 20,
      priceTiers,
    } = body;

    // Sanitize time inputs
    const EXACT_TIME_RE = /^(1[0-2]|0?[1-9]):[0-5][0-9]\s?(AM|PM)$/i;
    const timeSlot = rawTimeSlot && ['brunch', 'afternoon', 'dinner', 'lateNight'].includes(rawTimeSlot)
      ? rawTimeSlot
      : null;
    const _exactTime = rawExactTime && EXACT_TIME_RE.test(rawExactTime) ? rawExactTime : null;

    // ── Validate ──────────────────────────────────────────────────────────
    if (!location?.lat || !location?.lng) {
      return new Response(
        JSON.stringify({ error: 'Location required', cards: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!rawCategories || rawCategories.length === 0) {
      return new Response(
        JSON.stringify({ error: 'At least one category is required', cards: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Resolve categories to canonical names ─────────────────────────────
    const categories = resolveCategories(rawCategories);
    if (categories.length === 0) {
      return new Response(
        JSON.stringify({ error: `No recognized categories in: ${rawCategories.join(', ')}`, cards: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[discover-cards] Request: categories=[${categories}], batchSeed=${batchSeed}, limit=${limit}, mode=${travelMode}`);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Extract userId from auth header ───────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') ?? '';
    let userId: string | undefined;

    if (!token) {
      console.warn('[discover-cards] No Authorization header — pool path will be skipped');
    } else {
      const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError) {
        console.warn('[discover-cards] Auth failed:', authError.message, '— pool path will be skipped');
      } else {
        userId = userData?.user?.id;
      }
    }

    // ── Calculate search radius from travel constraint ────────────────────
    const maxDistKm = (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3;
    const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);

    // ── Build category → types map (one API call per category, not per type) ──
    const categoryTypeMap = getCategoryTypeMap(categories);

    // ── Helper: re-score pool-served cards against CURRENT user's preferences ─
    function scorePoolCards(cards: any[]): any[] {
      if (!cards.length) return cards;
      const scored = scoreCards(cards, { categories, priceTiers: priceTiers || [] });
      scored.sort((a, b) => b.matchScore - a.matchScore);
      return scored.map(s => ({
        ...s.card,
        matchScore: s.matchScore,
        scoringFactors: s.factors,
      }));
    }

    // ── Pool-first serving (ALL categories in ONE query) ──────────────────
    // No batchSeed === 0 restriction; serve from pool for ANY batchSeed.
    // Offset pagination: batchSeed * limit skips previous batches in pool.
    // Threshold raised to 80% of limit to ensure full batches after dedup.
    const poolOffset = (batchSeed || 0) * limit;

    if (userId && !body.warmPool) {
      try {
        const poolParams = {
          supabaseAdmin,
          userId,
          lat: location.lat,
          lng: location.lng,
          radiusMeters,
          categories,
          budgetMin: 0,
          budgetMax,
          limit,
          cardType: 'single' as const,
          offset: poolOffset,
          priceTiers: priceTiers as PriceTierSlug[] | undefined,
        };

        const poolResult = await serveCardsFromPipeline(
          poolParams,
          GOOGLE_PLACES_API_KEY,
          { travelMode },
        );

        // CF-003 fix: serve any pool result > 0, not just >= 80%
        // serveCardsFromPipeline already gap-fills from Google when pool is short
        if (poolResult.cards.length > 0) {
          const elapsed = Date.now() - t0;
          const scoredPoolCards = scorePoolCards(poolResult.cards);
          console.log(`[discover-cards] Served ${scoredPoolCards.length} from pipeline (offset=${poolOffset}) in ${elapsed}ms`);

          // RC-003 fix: use the pipeline's hasMore (based on unseen count), not raw totalPoolSize
          return new Response(JSON.stringify({
            cards: scoredPoolCards,
            total: poolResult.totalUnseenCount ?? poolResult.totalPoolSize,
            source: poolResult.fromApi > 0 ? 'mixed' : 'pool',
            metadata: {
              hasMore: poolResult.hasMore,
              poolSize: poolResult.totalUnseenCount ?? poolResult.totalPoolSize,
              batchSeed: batchSeed ?? 0,
            },
            sourceBreakdown: {
              fromPool: poolResult.fromPool,
              fromApi: poolResult.fromApi,
              totalServed: scoredPoolCards.length,
              apiCallsMade: poolResult.diagnostics?.apiCallsMade ?? 0,
              cacheHits: 0,
              gapCategories: poolResult.diagnostics?.gapCategories ?? [],
              reason: poolResult.diagnostics?.reason ?? 'Served from pipeline',
              path: 'pipeline',
            },
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // ── Pool exhausted at this offset — try expanding via nextPageToken ──
        if (poolResult.cards.length === 0 && poolOffset > 0) {
          console.log(`[discover-cards] Pool exhausted at offset ${poolOffset}, attempting nextPage expansion`);

          const cacheEntries = await getCacheEntriesWithTokens(supabaseAdmin, location, categories, radiusMeters);

          let expanded = false;
          for (const entry of cacheEntries) {
            if (entry.next_page_token) {
              const { newPlaces } = await fetchNextPage(supabaseAdmin, GOOGLE_PLACES_API_KEY, entry.id);
              if (newPlaces.length > 0) {
                // Insert new places into place_pool + card_pool
                // entry.place_type may be "cat:CategoryName" (new) or a raw type (legacy)
                const entryCat = entry.place_type.startsWith('cat:')
                  ? entry.place_type.slice(4)
                  : categories[0] || 'Unknown';
                await expandPoolWithNewPlaces(supabaseAdmin, newPlaces, entryCat);
                expanded = true;
              }
            }
          }

          if (expanded) {
            // Retry pool query with expanded pool
            const retryResult = await serveCardsFromPipeline(
              poolParams,
              GOOGLE_PLACES_API_KEY,
              { travelMode },
            );
            if (retryResult.cards.length > 0) {
              const elapsed = Date.now() - t0;
              console.log(`[discover-cards] Served ${retryResult.cards.length} from expanded pool in ${elapsed}ms`);

              return new Response(JSON.stringify({
                cards: retryResult.cards,
                total: retryResult.totalUnseenCount ?? retryResult.totalPoolSize,
                source: 'pool',
                metadata: {
                  hasMore: retryResult.hasMore,
                  poolSize: retryResult.totalUnseenCount ?? retryResult.totalPoolSize,
                  batchSeed: batchSeed ?? 0,
                },
                sourceBreakdown: {
                  fromPool: retryResult.cards.length,
                  fromApi: 0,
                  totalServed: retryResult.cards.length,
                  apiCallsMade: 0,
                  cacheHits: 0,
                  gapCategories: [],
                  reason: `Pool exhausted at offset ${poolOffset}, expanded via nextPageToken, then re-served from pool`,
                  path: 'pipeline-expanded',
                },
              }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
          }
        }

        // If serveCardsFromPipeline already fetched from Google (fromApi > 0),
        // return what we have — falling through would duplicate the Google search.
        if (poolResult.fromApi > 0 && poolResult.cards.length > 0) {
          const elapsed = Date.now() - t0;
          const scoredMixedCards = scorePoolCards(poolResult.cards);
          console.log(`[discover-cards] Pipeline returned ${scoredMixedCards.length} (${poolResult.fromPool} pool + ${poolResult.fromApi} API) in ${elapsed}ms — serving partial`);

          return new Response(JSON.stringify({
            cards: scoredMixedCards,
            total: poolResult.totalUnseenCount ?? poolResult.totalPoolSize,
            source: 'mixed',
            metadata: {
              hasMore: poolResult.hasMore,
              poolSize: poolResult.totalUnseenCount ?? poolResult.totalPoolSize,
              batchSeed: batchSeed ?? 0,
            },
            sourceBreakdown: {
              fromPool: poolResult.fromPool,
              fromApi: poolResult.fromApi,
              totalServed: scoredMixedCards.length,
              apiCallsMade: poolResult.diagnostics?.apiCallsMade ?? 0,
              cacheHits: 0,
              gapCategories: poolResult.diagnostics?.gapCategories ?? [],
              reason: poolResult.diagnostics?.reason ?? `Pipeline mixed: ${poolResult.fromPool} pool + ${poolResult.fromApi} API`,
              path: 'pipeline-mixed',
            },
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        console.log(`[discover-cards] Pool had ${poolResult.cards.length}/${limit} (pool-only, below 80%), falling through to API`);
      } catch (poolErr) {
        console.warn('[discover-cards] Pool serve failed, falling back to API:', poolErr);
      }
    }

    // ── Handle warmPool request ───────────────────────────────────────────
    const isWarmPool = !!body.warmPool;

    // categoryTypeMap already built above (before pool-first path)
    const totalTypes = Object.values(categoryTypeMap).reduce((sum, t) => sum + t.length, 0);
    console.log(`[discover-cards] Searching ${totalTypes} place types across ${categories.length} categories (bundled: ${categories.length} API calls)`);

    // ── Guard: cannot fall back to Google API if key is missing ───────────
    if (!GOOGLE_PLACES_API_KEY) {
      console.error('[discover-cards] Cannot fall back to Google API — GOOGLE_MAPS_API_KEY not set');
      return new Response(
        JSON.stringify({
          error: 'Places API key not configured. Pool had insufficient cards.',
          cards: [],
          source: 'error'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Batch search by CATEGORY (one API call per category, not per type) ──
    const { results, apiCallsMade, cacheHits } = await batchSearchByCategory(
      supabaseAdmin,
      GOOGLE_PLACES_API_KEY,
      categoryTypeMap,
      location.lat,
      location.lng,
      radiusMeters,
      {
        maxResultsPerCategory: 20,
        rankPreference: 'POPULARITY',
      }
    );

    console.log(`[discover-cards] Places search: ${cacheHits} cache hits, ${apiCallsMade} API calls`);

    // ── Merge & deduplicate across all categories, track category per place ──
    const seen = new Set<string>();
    let allPlaces: Array<any & { _matchedType: string; _category: string }> = [];

    for (const [category, places] of Object.entries(results)) {
      for (const p of places) {
        if (p.id && !seen.has(p.id)) {
          seen.add(p.id);
          allPlaces.push({ ...p, _matchedType: p.primaryType || p.types?.[0] || 'place', _category: category });
        }
      }
    }

    console.log(`[discover-cards] ${allPlaces.length} unique places across ${Object.keys(results).length} categories`);

    // ── Filter out excluded place types (per-category) ───────────────────
    allPlaces = allPlaces.filter(p => {
      const excluded = getExcludedTypesForCategory(p._category);
      const excludedSet = new Set(excluded);
      if (!p.types) return true;
      return !p.types.some((t: string) => excludedSet.has(t));
    });
    console.log(`[discover-cards] ${allPlaces.length} places after exclusion filter`);

    // ── Filter by distance ────────────────────────────────────────────────
    allPlaces = allPlaces.filter(p => {
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (lat == null || lng == null) return false;
      return haversine(location.lat, location.lng, lat, lng) <= maxDistKm;
    });

    // ── Filter by price tiers ─────────────────────────────────────────
    // Use priceTiers exclusively. If all 4 tiers selected or none provided, skip filter (show all).
    if (priceTiers && priceTiers.length > 0 && priceTiers.length < 4) {
      allPlaces = allPlaces.filter(p => {
        const tier = googleLevelToTierSlug(p.priceLevel);
        return priceTiers.includes(tier);
      });
    }

    // ── Filter by datetime preference ─────────────────────────────────────
    allPlaces = filterByDateTime(allPlaces, datetimePref, dateOption, timeSlot);

    console.log(`[discover-cards] ${allPlaces.length} places after all filters`);

    // ── Sort by quality: rating desc, then review count desc ──────────────
    allPlaces.sort((a, b) => {
      const rA = a.rating ?? 0;
      const rB = b.rating ?? 0;
      if (rB !== rA) return rB - rA;
      return (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
    });

    // ── Offset-based pagination ───────────────────────────────────────────
    const totalAvailable = allPlaces.length;
    const offset = batchSeed * limit;
    const batch = allPlaces.slice(offset, offset + limit);

    console.log(`[discover-cards] Batch ${batchSeed}: offset=${offset}, returning ${batch.length}/${totalAvailable}`);

    // hasMore is false when there are no more batches beyond the current one
    const hasMore = (offset + limit) < totalAvailable;

    if (batch.length === 0 && !isWarmPool) {
      return new Response(
        JSON.stringify({
          cards: [], total: totalAvailable, source: 'api',
          metadata: { hasMore: false, poolSize: totalAvailable, batchSeed },
          sourceBreakdown: {
            fromPool: 0, fromApi: 0, totalServed: 0,
            apiCallsMade, cacheHits,
            gapCategories: categories,
            reason: `Pool skipped (no userId or pool empty), Google returned ${totalAvailable} total but batch offset ${offset} is beyond range`,
            path: 'api-direct-empty',
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Build response cards with fallback descriptions (NO OpenAI wait) ──
    const cards = batch.map((p, _i) => {
      const lat = p.location?.latitude ?? 0;
      const lng = p.location?.longitude ?? 0;
      const dist = haversine(location.lat, location.lng, lat, lng);
      const travelMin = estimateTravelMin(dist, travelMode);
      const { hours, isOpenNow } = parseOpeningHours(p);
      const priceRange = priceLevelToRange(p.priceLevel);
      const primaryType = p.primaryType || p._matchedType || 'place';
      const category = p._category;

      return {
        id: p.id,
        placeId: p.id,
        title: p.displayName?.text || 'Unknown Place',
        description: getFallbackDescription(category, primaryType),
        image: getPhotoUrl(p),
        images: getAllPhotoUrls(p),
        rating: p.rating ?? 0,
        reviewCount: p.userRatingCount ?? 0,
        priceLevelLabel: priceLevelToLabel(p.priceLevel),
        priceMin: priceRange.min,
        priceMax: priceRange.max,
        priceTier: googleLevelToTierSlug(p.priceLevel),
        address: p.formattedAddress || '',
        openingHours: hours,
        isOpenNow,
        website: p.websiteUri || null,
        lat,
        lng,
        placeType: primaryType,
        placeTypeLabel: formatPlaceType(primaryType),
        distanceKm: Math.round(dist * 100) / 100,
        travelTimeMin: travelMin,
        matchScore: calculateMatchScore(p, location.lat, location.lng, maxDistKm),
        category,
      };
    });

    // ── Score cards using 5-factor algorithm ────────────────────────────
    const scored = scoreCards(cards, {
      categories,
      priceTiers: priceTiers || [],
    });
    scored.sort((a, b) => b.matchScore - a.matchScore);
    const scoredCards = scored.map(s => ({
      ...s.card,
      matchScore: s.matchScore,
      scoringFactors: s.factors,
    }));

    const elapsed = Date.now() - t0;
    const source: string = apiCallsMade > 0 ? (cacheHits > 0 ? 'mixed' : 'api') : 'cache';
    console.log(`[discover-cards] Done in ${elapsed}ms: ${scoredCards.length} cards, ${apiCallsMade} API calls`);

    // ── warmPool: return empty response after storing ─────────────────────
    if (isWarmPool) {
      // Store to pool in background then return empty
      storeResultsInPoolBatched(supabaseAdmin, batch, scoredCards, categories, userId, true);

      return new Response(
        JSON.stringify({ cards: [], total: totalAvailable, source: 'warm' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Fire-and-forget: store results + enrich with AI descriptions ──────
    storeResultsInPoolBatched(supabaseAdmin, batch, scoredCards, categories, userId);

    return new Response(
      JSON.stringify({
        cards: scoredCards, total: totalAvailable, source,
        metadata: { hasMore, poolSize: totalAvailable, batchSeed },
        sourceBreakdown: {
          fromPool: 0,
          fromApi: scoredCards.length,
          totalServed: scoredCards.length,
          apiCallsMade,
          cacheHits,
          gapCategories: categories,
          reason: `Pool skipped or empty — all ${scoredCards.length} cards from Google API (${apiCallsMade} API calls, ${cacheHits} cache hits)`,
          path: 'api-direct',
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[discover-cards] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: (err as any)?.message || 'Internal error', cards: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ── Batched Pool Storage (fire-and-forget) ──────────────────────────────────
function storeResultsInPoolBatched(
  supabaseAdmin: any,
  rawPlaces: any[],
  cards: any[],
  categories: string[],
  userId: string | undefined,
  isWarmPool: boolean = false,
): void {
  // Execute async work without awaiting (fire-and-forget)
  (async () => {
    try {
      const t0 = Date.now();

      // ── Step 1: Batch upsert to place_pool ────────────────────────────
      // Build all place rows at once for a single upsert call
      const placeRows = rawPlaces.map(p => {
        const priceRange = priceLevelToRange(p.priceLevel);
        const photos = (p.photos || []).map((ph: any) => ({
          name: ph.name,
          widthPx: ph.widthPx,
          heightPx: ph.heightPx,
        }));

        return {
          google_place_id: p.id,
          name: p.displayName?.text || 'Unknown Place',
          address: p.formattedAddress || '',
          lat: p.location?.latitude ?? 0,
          lng: p.location?.longitude ?? 0,
          types: p.types || [],
          primary_type: p.primaryType || p._matchedType || null,
          rating: p.rating || 0,
          review_count: p.userRatingCount || 0,
          price_level: typeof p.priceLevel === 'string' ? p.priceLevel : null,
          price_min: priceRange.min,
          price_max: priceRange.max,
          price_tier: googleLevelToTierSlug(p.priceLevel),
          opening_hours: p.regularOpeningHours || null,
          photos,
          website: p.websiteUri || null,
          raw_google_data: p,
          fetched_via: 'nearby_search',
          last_detail_refresh: new Date().toISOString(),
          refresh_failures: 0,
          is_active: true,
        };
      });

      // Single batched upsert for all places
      const { data: upsertedPlaces, error: placeError } = await supabaseAdmin
        .from('place_pool')
        .upsert(placeRows, { onConflict: 'google_place_id' })
        .select('id, google_place_id');

      if (placeError) {
        console.warn('[discover-cards] Batch place upsert error:', placeError.message);
      }

      // Build a lookup from google_place_id -> place_pool.id
      const placePoolIdMap: Record<string, string> = {};
      if (upsertedPlaces) {
        for (const row of upsertedPlaces) {
          placePoolIdMap[row.google_place_id] = row.id;
        }
      }

      // ── Step 2: Batch insert to card_pool ─────────────────────────────
      const cardRows = cards.map(card => {
        const popularityScore = (card.rating || 0) * Math.log10((card.reviewCount || 0) + 1);

        return {
          card_type: 'single' as const,
          place_pool_id: placePoolIdMap[card.placeId] || null,
          google_place_id: card.placeId,
          title: card.title,
          category: card.category,
          categories: [card.category],
          description: card.description,
          highlights: [],
          image_url: card.image,
          images: card.images,
          address: card.address,
          lat: card.lat,
          lng: card.lng,
          rating: card.rating,
          review_count: card.reviewCount,
          price_min: card.priceMin,
          price_max: card.priceMax,
          price_tier: card.priceTier ?? googleLevelToTierSlug(card.priceLevel),
          opening_hours: card.openingHours
            ? { ...card.openingHours, _isOpenNow: card.isOpenNow ?? null }
            : null,
          website: card.website || null,
          popularity_score: popularityScore,
          is_active: true,
          match_score: card.matchScore ?? null,
          scoring_factors: card.scoringFactors ?? {},
        };
      });

      // Single batched insert for all cards
      const { data: insertedCards, error: cardError } = await supabaseAdmin
        .from('card_pool')
        .upsert(cardRows, { onConflict: 'google_place_id', ignoreDuplicates: true })
        .select('id, google_place_id');

      if (cardError) {
        // Duplicate constraint errors are expected and non-critical
        console.warn('[discover-cards] Batch card insert error (may be duplicates):', cardError.message);
      }

      // ── Step 3: Record impressions for served cards (SKIP for warmPool — RC-005 fix)
      if (!isWarmPool && userId && insertedCards && insertedCards.length > 0) {
        const cardPoolIds = insertedCards.map((c: any) => c.id);
        await recordImpressions(supabaseAdmin, userId, cardPoolIds);
      }

      // ── Step 4: Build cardPoolIdMap for subsequent enrichments ─────────
      // (enrichDescriptionsInBackground removed — Step 6 backfill handles
      //  description generation for cards with generic fallbacks, eliminating
      //  the duplicate OpenAI call that was doubling API cost)
      const cardPoolIdMap: Record<string, string> = {};
      if (insertedCards) {
        for (const row of insertedCards) {
          cardPoolIdMap[row.google_place_id] = row.id;
        }
      }

      // ── Step 5: Copy enrichment (oneLiner + tip) ──────────────────────
      if (OPENAI_API_KEY && insertedCards?.length) {
        try {
          const cardsNeedingCopy = insertedCards
            .filter((c: any) => !c.one_liner)
            .map((c: any) => ({
              id: c.id,
              title: cards.find((card: any) => card.placeId === c.google_place_id)?.title || c.google_place_id,
              category: cards.find((card: any) => card.placeId === c.google_place_id)?.category || '',
              address: cards.find((card: any) => card.placeId === c.google_place_id)?.address,
              rating: cards.find((card: any) => card.placeId === c.google_place_id)?.rating,
              priceTier: cards.find((card: any) => card.placeId === c.google_place_id)?.priceTier,
            }));

          if (cardsNeedingCopy.length > 0) {
            const copyResults = await enrichCardsWithCopy(cardsNeedingCopy, OPENAI_API_KEY, {
              timeoutMs: 10000,
              maxCards: 10,
            });

            // Batch update all copy results in parallel (not sequential)
            if (copyResults.size > 0) {
              const now = new Date().toISOString();
              const copyUpdatePromises = Array.from(copyResults.entries()).map(
                ([cardId, copy]) =>
                  supabaseAdmin
                    .from('card_pool')
                    .update({
                      one_liner: copy.oneLiner,
                      tip: copy.tip,
                      copy_generated_at: now,
                    })
                    .eq('id', cardId)
                    .then(() => {})
                    .catch(() => {})
              );
              await Promise.all(copyUpdatePromises);
              console.log(`[discover-cards] Copy enrichment: updated ${copyResults.size} cards`);
            }
          }
        } catch (copyErr) {
          console.warn('[discover-cards] Copy enrichment failed:', (copyErr as any)?.message || copyErr);
        }
      }

      // ── Step 6: Description backfill for cards with NULL description ───
      if (OPENAI_API_KEY && insertedCards?.length) {
        try {
          const cardsNeedingDescription = insertedCards
            .filter((c: any) => {
              const matchingCard = cards.find((card: any) => card.placeId === c.google_place_id);
              // Only backfill cards whose description is a generic fallback
              return matchingCard && (
                !matchingCard.description ||
                matchingCard.description.startsWith('A great ') ||
                matchingCard.description.startsWith('A beautiful ') ||
                matchingCard.description.startsWith('A popular ') ||
                matchingCard.description.startsWith('A well-loved ') ||
                matchingCard.description.startsWith('A welcoming ') ||
                matchingCard.description.startsWith('A lovely ') ||
                matchingCard.description.startsWith('An upscale ') ||
                matchingCard.description.startsWith('An exciting ') ||
                matchingCard.description.startsWith('An inspiring ') ||
                matchingCard.description.startsWith('A thrilling ') ||
                matchingCard.description.startsWith('A serene ') ||
                matchingCard.description.startsWith('A convenient ') ||
                matchingCard.description.startsWith('A professional ')
              );
            })
            .slice(0, 10);

          if (cardsNeedingDescription.length > 0) {
            const descPrompt = `Write a 1-2 sentence description for each place. Be specific and vivid.\n\n${
              cardsNeedingDescription.map((c: any, i: number) => {
                const matchingCard = cards.find((card: any) => card.placeId === c.google_place_id);
                return `${i + 1}. ${matchingCard?.title || 'Unknown'} (${matchingCard?.category || 'Unknown'}) at ${matchingCard?.address || 'unknown location'}`;
              }).join('\n')
            }\n\nRespond with JSON: { "descriptions": ["...", "..."] }`;

            const descResponse = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: descPrompt }],
                max_tokens: cardsNeedingDescription.length * 60,
                temperature: 0.7,
                response_format: { type: 'json_object' },
              }),
              timeoutMs: 10000,
            });

            if (descResponse.ok) {
              const descData = await descResponse.json();
              const descriptions = JSON.parse(descData.choices[0].message.content).descriptions;

              // Batch update all descriptions in parallel (not sequential)
              const descUpdatePromises: Promise<void>[] = [];
              for (let i = 0; i < Math.min(descriptions.length, cardsNeedingDescription.length); i++) {
                if (descriptions[i]) {
                  descUpdatePromises.push(
                    supabaseAdmin
                      .from('card_pool')
                      .update({ description: descriptions[i] })
                      .eq('id', cardsNeedingDescription[i].id)
                      .then(() => {})
                      .catch(() => {})
                  );
                }
              }
              await Promise.all(descUpdatePromises);
              console.log(`[discover-cards] Description backfill: updated ${descUpdatePromises.length} cards`);
            }
          }
        } catch (descErr) {
          console.warn('[discover-cards] Description backfill failed:', (descErr as any)?.message || descErr);
        }
      }

      console.log(`[discover-cards] Pool storage completed in ${Date.now() - t0}ms: ${placeRows.length} places, ${cardRows.length} cards`);
    } catch (e) {
      console.warn('[discover-cards] Pool store failed (non-critical):', e);
    }
  })();
}
