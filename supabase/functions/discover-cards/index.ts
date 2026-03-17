import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { batchSearchByCategory, searchPlacesWithCache } from '../_shared/placesCache.ts';
import {
  serveCardsFromPipeline,
  upsertPlaceToPool,
  insertCardToPool,
  recordImpressions,
  checkPoolMaturity,
} from '../_shared/cardPoolService.ts';
import {
  resolveCategories,
  getCategoryTypeMap,
  getPlaceTypesForCategory,
  getExcludedTypesForCategory,
  CATEGORY_MIN_PRICE_TIER,
  CATEGORY_TEXT_KEYWORDS,
} from '../_shared/categoryPlaceTypes.ts';
import { priceLevelToLabel, priceLevelToRange, googleLevelToTierSlug, tierMeetsMinimum, slugMeetsMinimum, PriceTierSlug } from '../_shared/priceTiers.ts';
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
 *   2. Serve from pool (pool is admin-managed, no runtime Google API calls)
 *   3. Record user impressions for served cards
 *
 * Supports:
 *   - Multi-category in one request (e.g. ["Nature", "Drink", "Casual Eats"])
 *   - Offset pagination via batchSeed * limit
 *   - warmPool mode: disabled (returns empty immediately)
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

// Return response by 12s, leaving 3s buffer before the client's 15s timeout
const RESPONSE_DEADLINE_MS = 12000;

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
  public_transit: 20,
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

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

function getPhotoUrl(place: any): string {
  const photo = place.photos?.[0];
  if (!photo?.name) return FALLBACK_IMAGE;
  return FALLBACK_IMAGE;
}

function getAllPhotoUrls(place: any, max = 5): string[] {
  return [];
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

/** Parse "9:00 AM - 5:00 PM" or "9 AM - 5 PM" into { open: number, close: number } hours.
 *  Handles overnight wraparound: "5 PM - 2 AM" → { open: 17, close: 26 } (close > 24 = next day). */
function parseHoursText(text: string): { open: number; close: number } | null {
  if (!text || text.toLowerCase().includes('closed')) return null;
  if (text.toLowerCase().includes('open 24') || text.toLowerCase().includes('24 hours')) return { open: 0, close: 24 };
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–\-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return null;
  let openH = parseInt(match[1]);
  const openAmPm = match[3].toUpperCase();
  let closeH = parseInt(match[4]);
  const closeAmPm = match[6].toUpperCase();
  if (openAmPm === 'PM' && openH !== 12) openH += 12;
  if (openAmPm === 'AM' && openH === 12) openH = 0;
  if (closeAmPm === 'PM' && closeH !== 12) closeH += 12;
  if (closeAmPm === 'AM' && closeH === 12) closeH = 0;
  // Overnight wraparound: "5 PM - 2 AM" → close extends past midnight
  if (closeH <= openH) closeH += 24;
  return { open: openH, close: closeH };
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function filterByDateTime(
  places: any[],
  datetimePref: string | undefined,
  dateOption: string,
  timeSlot: string | null,
  exactTime?: string | null
): any[] {
  if (dateOption === 'now' || (!datetimePref && !timeSlot && !exactTime)) {
    return places.filter(p => p.isOpenNow !== false);
  }

  // Determine target day and hour
  const targetDate = datetimePref ? new Date(datetimePref) : new Date();
  const targetDay = targetDate.getDay();

  let targetHourStart: number;
  // Fix 4: exact_time takes priority (e.g., "4:00 PM" → hour 16)
  if (exactTime) {
    const etMatch = exactTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (etMatch) {
      let h = parseInt(etMatch[1]);
      const ampm = etMatch[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      targetHourStart = h;
    } else {
      targetHourStart = targetDate.getHours();
    }
  } else if (timeSlot && TIME_SLOT_RANGES[timeSlot]) {
    targetHourStart = TIME_SLOT_RANGES[timeSlot].start;
  } else {
    targetHourStart = targetDate.getHours();
  }

  return places.filter(place => {
    // Path A: Google API format — regularOpeningHours.periods
    const periods = place.regularOpeningHours?.periods;
    if (periods && periods.length > 0) {
      return periods.some((period: any) => {
        if (period.open?.day !== targetDay) return false;
        const openHour = period.open?.hour ?? 0;
        let closeHour = period.close?.hour ?? 24;
        if (closeHour === 0) closeHour = 24;
        // Overnight wraparound: bar open 17-02 → effectiveClose = 26
        if (closeHour <= openHour) closeHour += 24;
        return targetHourStart >= openHour && targetHourStart < closeHour;
      });
    }

    // Path B: Pool format — openingHours as Record<string, string> (e.g., { "monday": "9 AM - 5 PM" })
    const oh = place.openingHours;
    if (oh && typeof oh === 'object') {
      const dayName = DAY_NAMES[targetDay];
      const dayText = oh[dayName];
      if (!dayText) return true; // No data for this day — include
      const parsed = parseHoursText(dayText);
      if (!parsed) return false; // "Closed" or unparseable
      return targetHourStart >= parsed.open && targetHourStart < parsed.close;
    }

    // No opening hours data at all — include (don't penalize missing data)
    return true;
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

    // ── Keep-warm ping: boot the isolate without running business logic ──
    if (body.warmPing) {
      return new Response(JSON.stringify({ status: 'warm' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // --- TIER GATING: Swipe limit check + effective tier ---
    let swipeData: { remaining: number; daily_limit: number; used: number; resets_at: string } | null = null;
    let effectiveTier = 'free';
    if (userId) {
      // Fetch swipe data and effective tier in parallel
      const [swipeResult, tierResult] = await Promise.all([
        supabaseAdmin.rpc('get_remaining_swipes', { p_user_id: userId }),
        supabaseAdmin.rpc('get_effective_tier', { p_user_id: userId }),
      ]);

      if (swipeResult.data?.[0]) {
        swipeData = swipeResult.data[0];
      }
      effectiveTier = tierResult.data ?? 'free';

      if (swipeData && swipeData.remaining === 0) {
        return new Response(
          JSON.stringify({
            limited: true,
            remaining: 0,
            dailyLimit: swipeData.daily_limit,
            resetsAt: swipeData.resets_at,
            cards: [],
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // --- TIER GATING: Helper to strip curated card details for free users ---
    function applyTierGating(cards: any[]): any[] {
      return cards.map(card => {
        if (card.cardType === 'curated' && effectiveTier === 'free') {
          return {
            ...card,
            stops: card.stops?.map((_stop: any, i: number) => ({
              stopNumber: i + 1,
            })),
            title: card.teaserText || 'A curated experience awaits...',
            tagline: card.tagline,
            stopPlacePoolIds: [],
            stopGooglePlaceIds: [],
            _locked: true,
          };
        }
        return card;
      });
    }

    // --- TIER GATING: Helper to add swipe info to response for free users ---
    function swipeInfoPayload(): Record<string, unknown> {
      if (effectiveTier === 'free' && swipeData) {
        return {
          remainingSwipes: swipeData.remaining,
          dailyLimit: swipeData.daily_limit,
          resetsAt: swipeData.resets_at,
        };
      }
      return {};
    }

    // ── Calculate search radius from travel constraint ────────────────────
    const maxDistKm = (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3;
    const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);

    // ── Build category → types map (one API call per category, not per type) ──
    const categoryTypeMap = getCategoryTypeMap(categories);

    // ── Helper: re-score pool-served cards against CURRENT user's preferences ─
    function scorePoolCards(cards: any[]): any[] {
      if (!cards.length) return cards;
      // Filter out stale pool cards that don't meet their category's price floor
      const qualified = cards.filter(c => {
        const minTier = CATEGORY_MIN_PRICE_TIER[c.category];
        if (!minTier) return true;
        return slugMeetsMinimum(c.priceTier, minTier);
      });
      const scored = scoreCards(qualified, { categories, priceTiers: priceTiers || [] });
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

    // ── Warm-pool: return immediately (pool is admin-managed, no Google searches) ──
    if (userId && body.warmPool) {
      return new Response(
        JSON.stringify({ cards: [], total: 0, source: 'disabled', message: 'Warm pool is disabled. Pool is admin-managed.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
        if (poolResult.cards.length > 0) {
          const elapsed = Date.now() - t0;
          // Apply date/time filter to pool-served cards (Fix 3)
          const timeFilteredCards = filterByDateTime(poolResult.cards, datetimePref, dateOption, timeSlot, _exactTime);
          const scoredPoolCards = scorePoolCards(timeFilteredCards);
          console.log(`[discover-cards] Served ${scoredPoolCards.length} from pipeline (${poolResult.cards.length} pre-filter, offset=${poolOffset}) in ${elapsed}ms`);

          // RC-003 fix: use the pipeline's hasMore (based on unseen count), not raw totalPoolSize
          return new Response(JSON.stringify({
            cards: applyTierGating(scoredPoolCards),
            total: poolResult.totalUnseenCount ?? poolResult.totalPoolSize,
            source: poolResult.fromApi > 0 ? 'mixed' : 'pool',
            ...swipeInfoPayload(),
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

        // If serveCardsFromPipeline already fetched from Google (fromApi > 0),
        // return what we have — falling through would duplicate the Google search.
        if (poolResult.fromApi > 0 && poolResult.cards.length > 0) {
          const elapsed = Date.now() - t0;
          const timeFilteredMixed = filterByDateTime(poolResult.cards, datetimePref, dateOption, timeSlot, _exactTime);
          const scoredMixedCards = scorePoolCards(timeFilteredMixed);
          console.log(`[discover-cards] Pipeline returned ${scoredMixedCards.length} (${poolResult.fromPool} pool + ${poolResult.fromApi} API) in ${elapsed}ms — serving partial`);

          return new Response(JSON.stringify({
            cards: applyTierGating(scoredMixedCards),
            total: poolResult.totalUnseenCount ?? poolResult.totalPoolSize,
            source: 'mixed',
            ...swipeInfoPayload(),
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

        console.log(`[discover-cards] Pool had ${poolResult.cards.length}/${limit} cards, trying place_pool fallback`);
      } catch (poolErr) {
        console.warn('[discover-cards] Pool serve failed, falling back:', poolErr);
      }
    }

    // ── Place pool fallback — build cards from existing places, no Google ──
    if (userId) {
      try {
        const ppLatDelta = radiusMeters / 111320;
        const ppLngDelta = radiusMeters / (111320 * Math.cos(location.lat * Math.PI / 180));

        // Fetch user's recent impressions to exclude already-served cards
        const prefUpdatedAt = await supabaseAdmin
          .from('preferences')
          .select('updated_at')
          .eq('profile_id', userId)
          .maybeSingle()
          .then(r => r.data?.updated_at || new Date(0).toISOString());

        const { data: recentImpressions } = await supabaseAdmin
          .from('user_card_impressions')
          .select('card_pool_id')
          .eq('user_id', userId)
          .gte('created_at', prefUpdatedAt);

        const seenCardPoolIds = new Set((recentImpressions || []).map((i: any) => i.card_pool_id));

        // Look up which google_place_ids are already seen (via card_pool join)
        let seenGooglePlaceIds = new Set<string>();
        if (seenCardPoolIds.size > 0) {
          const { data: seenCards } = await supabaseAdmin
            .from('card_pool')
            .select('google_place_id')
            .in('id', Array.from(seenCardPoolIds).slice(0, 1000));
          seenGooglePlaceIds = new Set((seenCards || []).map((c: any) => c.google_place_id).filter(Boolean));
        }

        // For each requested category, get its Google place types and query place_pool
        const placePoolCards: any[] = [];
        const servedPlaceIds = new Set<string>();
        const newCardPoolIds: string[] = []; // Track for impression recording

        await Promise.all(categories.map(async (category) => {
          const placeTypes = getPlaceTypesForCategory(category);
          if (placeTypes.length === 0) return;

          const { data: places } = await supabaseAdmin
            .from('place_pool')
            .select('id, google_place_id, name, address, lat, lng, types, primary_type, rating, review_count, price_level, price_min, price_max, price_tier, opening_hours, photos, website, stored_photo_urls')
            .eq('is_active', true)
            .gte('lat', location.lat - ppLatDelta)
            .lte('lat', location.lat + ppLatDelta)
            .gte('lng', location.lng - ppLngDelta)
            .lte('lng', location.lng + ppLngDelta)
            .overlaps('types', placeTypes)
            .order('rating', { ascending: false })
            .limit(10);

          if (!places || places.length === 0) return;

          // Collect insert promises to batch-await (avoid sequential awaits per place)
          const insertPromises: Promise<string | null>[] = [];

          for (const place of places) {
            const gpid = place.google_place_id;
            if (!gpid || servedPlaceIds.has(gpid)) continue;
            // Skip places already served in previous batches (impression dedup)
            if (seenGooglePlaceIds.has(gpid)) continue;

            // Price tier filter — respect user's selected tiers
            if (priceTiers && priceTiers.length > 0 && priceTiers.length < 4) {
              const placeTier = place.price_tier || googleLevelToTierSlug(place.price_level);
              if (placeTier && !priceTiers.includes(placeTier)) continue;
            }

            servedPlaceIds.add(gpid);

            // Build card — prefer stored Supabase photos over Google references
            const storedUrls = place.stored_photo_urls;
            const imageUrl = (storedUrls && storedUrls.length > 0)
              ? storedUrls[0]
              : FALLBACK_IMAGE;
            const images = (storedUrls && storedUrls.length > 0)
              ? storedUrls.slice(0, 5)
              : [];

            const distKm = haversine(location.lat, location.lng, place.lat, place.lng);
            const travelMin = estimateTravelMin(distKm, travelMode);

            const parsedOH = place.opening_hours || null;
            const isOpenNow = parsedOH?._isOpenNow ?? null;
            const hours = parsedOH ? { ...parsedOH } : null;
            if (hours) delete hours._isOpenNow;

            placePoolCards.push({
              id: gpid,
              placeId: gpid,
              title: place.name,
              category,
              matchScore: 85,
              image: imageUrl || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
              images: images.length > 0 ? images : [imageUrl].filter(Boolean),
              rating: place.rating || 0,
              reviewCount: place.review_count || 0,
              priceMin: place.price_min ?? 0,
              priceMax: place.price_max ?? 0,
              distanceKm: Math.round(distKm * 100) / 100,
              travelTimeMin: travelMin,
              isOpenNow,
              openingHours: hours,
              description: getFallbackDescription(category, place.primary_type || 'place'),
              highlights: ['Highly Rated', 'Popular Choice'],
              address: place.address || '',
              lat: place.lat,
              lng: place.lng,
              placeType: place.primary_type || 'place',
              placeTypeLabel: formatPlaceType(place.primary_type || 'place'),
              website: place.website || null,
              priceTier: place.price_tier || googleLevelToTierSlug(place.price_level),
              matchFactors: {},
            });

            // Insert into card_pool in parallel (collected, batch-awaited below)
            insertPromises.push(
              insertCardToPool(supabaseAdmin, {
                placePoolId: place.id,
                googlePlaceId: gpid,
                cardType: 'single',
                title: place.name,
                category,
                categories: [category],
                description: getFallbackDescription(category, place.primary_type || 'place'),
                imageUrl: imageUrl || undefined,
                images: images as string[],
                address: place.address || '',
                lat: place.lat,
                lng: place.lng,
                rating: place.rating || 0,
                reviewCount: place.review_count || 0,
                priceMin: place.price_min ?? 0,
                priceMax: place.price_max ?? 0,
                openingHours: place.opening_hours,
                website: place.website,
                priceTier: place.price_tier || googleLevelToTierSlug(place.price_level),
                priceLevel: place.price_level,
              }).catch(() => null)
            );
          }

          // Batch-await all inserts for this category (parallel, not sequential)
          const ids = await Promise.all(insertPromises);
          for (const id of ids) {
            if (id) newCardPoolIds.push(id);
          }
        }));

        if (placePoolCards.length > 0) {
          // Apply date/time filter
          const timeFiltered = filterByDateTime(placePoolCards, datetimePref, dateOption, timeSlot, _exactTime);
          const scored = scorePoolCards(timeFiltered);

          if (scored.length > 0) {
            // Record impressions so next batch excludes these cards
            if (newCardPoolIds.length > 0 && !body.warmPool) {
              await recordImpressions(supabaseAdmin, userId, newCardPoolIds);
            }

            const elapsed = Date.now() - t0;
            console.log(`[discover-cards] Place pool fallback: ${scored.length} cards from place_pool (0 Google calls) in ${elapsed}ms`);

            return new Response(JSON.stringify({
              cards: applyTierGating(scored.slice(0, limit)),
              total: scored.length,
              source: 'place_pool',
              ...swipeInfoPayload(),
              metadata: { hasMore: placePoolCards.length > limit, poolSize: placePoolCards.length, batchSeed },
              sourceBreakdown: {
                fromPool: scored.length,
                fromApi: 0,
                totalServed: Math.min(scored.length, limit),
                apiCallsMade: 0,
                cacheHits: 0,
                gapCategories: [],
                reason: `Served from place_pool fallback (${placePoolCards.length} places found, ${scored.length} after filters)`,
                path: 'place-pool-fallback',
              },
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }

        console.log(`[discover-cards] Place pool fallback: 0 matching places in area`);
      } catch (ppErr) {
        console.warn('[discover-cards] Place pool fallback failed:', ppErr);
      }
    }

    // ── Deadline guard: return empty rather than risk client timeout ──────
    const elapsedBeforeApi = Date.now() - t0;
    if (elapsedBeforeApi > RESPONSE_DEADLINE_MS) {
      console.warn(`[discover-cards] ${elapsedBeforeApi}ms elapsed before API fallback — returning empty to avoid client timeout`);
      return new Response(JSON.stringify({
        cards: [],
        total: 0,
        source: 'deadline',
        metadata: { hasMore: false, poolSize: 0, batchSeed },
        sourceBreakdown: {
          fromPool: 0, fromApi: 0, totalServed: 0,
          apiCallsMade: 0, cacheHits: 0,
          gapCategories: categories,
          reason: `Response deadline exceeded (${elapsedBeforeApi}ms) — pool empty, skipped API to avoid client timeout`,
          path: 'deadline-exceeded',
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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

    // ── Split categories: text search vs nearby search ─────────────────
    const nearbyTypeMap: Record<string, string[]> = {};
    const textSearchCats: string[] = [];

    for (const [cat, types] of Object.entries(categoryTypeMap)) {
      if (CATEGORY_TEXT_KEYWORDS[cat]) {
        textSearchCats.push(cat);
      } else {
        nearbyTypeMap[cat] = types;
      }
    }

    // ── Nearby Search for standard categories ────────────────────────────
    let apiCallsMade = 0;
    let cacheHits = 0;
    const results: Record<string, any[]> = {};

    if (Object.keys(nearbyTypeMap).length > 0) {
      const nearbyResult = await batchSearchByCategory(
        supabaseAdmin,
        GOOGLE_PLACES_API_KEY,
        nearbyTypeMap,
        location.lat,
        location.lng,
        radiusMeters,
        { maxResultsPerCategory: 20, rankPreference: 'POPULARITY' }
      );
      apiCallsMade += nearbyResult.apiCallsMade;
      cacheHits += nearbyResult.cacheHits;
      Object.assign(results, nearbyResult.results);
    }

    // ── Text Search for keyword-based categories (e.g. Fine Dining) ─────
    for (const cat of textSearchCats) {
      const keywords = CATEGORY_TEXT_KEYWORDS[cat]!;
      const keywordResults = await Promise.all(
        keywords.map(keyword =>
          searchPlacesWithCache({
            supabaseAdmin,
            apiKey: GOOGLE_PLACES_API_KEY,
            placeType: `text:${cat.toLowerCase().replace(/\s+/g, '_')}:${keyword.replace(/\s+/g, '_')}`,
            lat: location.lat,
            lng: location.lng,
            radiusMeters,
            maxResults: 20,
            strategy: 'text',
            textQuery: keyword,
          })
        )
      );

      const catPlaces: any[] = [];
      const catSeen = new Set<string>();
      for (const r of keywordResults) {
        if (r.cacheHit) cacheHits++;
        else apiCallsMade++;
        for (const p of r.places) {
          if (p.id && !catSeen.has(p.id)) {
            catSeen.add(p.id);
            catPlaces.push(p);
          }
        }
      }
      results[cat] = catPlaces;
      console.log(`[discover-cards] Text search "${cat}": ${keywords.length} keywords → ${catPlaces.length} unique places`);
    }

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

    // ── Filter by per-category price floor (e.g. Fine Dining = bougie+) ──
    allPlaces = allPlaces.filter(p => {
      const minTier = CATEGORY_MIN_PRICE_TIER[p._category];
      if (!minTier) return true;
      return tierMeetsMinimum(p.priceLevel, minTier);
    });

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
    // Capture pre-filter count for hasMore — time filtering determines what the user
    // SEES now, but the pool has more cards that may be open at a different time.
    const totalBeforeTimeFilter = allPlaces.length;
    allPlaces = filterByDateTime(allPlaces, datetimePref, dateOption, timeSlot, _exactTime);

    console.log(`[discover-cards] ${allPlaces.length} places after all filters (${totalBeforeTimeFilter} before time filter)`);

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

    // hasMore uses PRE-filter count — time filtering determines what the user sees NOW,
    // but the pool may have cards open at different times (e.g., user browses at 2 AM,
    // batch 2 at 6 PM would have more open places). This keeps batch generation alive.
    const hasMore = (offset + limit) < totalBeforeTimeFilter;

    if (batch.length === 0) {
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

    // ── Fire-and-forget: store results + enrich with AI descriptions ──────
    storeResultsInPoolBatched(supabaseAdmin, batch, scoredCards, categories, userId);

    return new Response(
      JSON.stringify({
        cards: applyTierGating(scoredCards), total: totalAvailable, source,
        ...swipeInfoPayload(),
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

      // ── Step 3: Record impressions for ALL served cards (SKIP for warmPool — RC-005 fix)
      // insertedCards only contains newly inserted rows (ignoreDuplicates skips existing).
      // For complete impression coverage, also look up existing card_pool IDs.
      if (!isWarmPool && userId) {
        const servedGpids = cards.map((c: any) => c.placeId).filter(Boolean);
        let allCardPoolIds: string[] = insertedCards
          ? insertedCards.map((c: any) => c.id)
          : [];

        // Find card_pool IDs for cards that already existed (not in insertedCards)
        const insertedGpids = new Set(insertedCards?.map((c: any) => c.google_place_id) || []);
        const missingGpids = servedGpids.filter((gpid: string) => !insertedGpids.has(gpid));
        if (missingGpids.length > 0) {
          const { data: existingCards } = await supabaseAdmin
            .from('card_pool')
            .select('id')
            .in('google_place_id', missingGpids);
          if (existingCards) {
            allCardPoolIds = [...allCardPoolIds, ...existingCards.map((c: any) => c.id)];
          }
        }

        if (allCardPoolIds.length > 0) {
          await recordImpressions(supabaseAdmin, userId, allCardPoolIds);
        }
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

