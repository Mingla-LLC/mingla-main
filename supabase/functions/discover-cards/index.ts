import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  serveCardsFromPipeline,
} from '../_shared/cardPoolService.ts';
import {
  resolveCategories,
  CATEGORY_MIN_PRICE_TIER,
} from '../_shared/categoryPlaceTypes.ts';
import { slugMeetsMinimum, PriceTierSlug } from '../_shared/priceTiers.ts';
import { scoreCards } from '../_shared/scoringService.ts';

/* ─────────────────────────────────────────────────────────────────────────────
 * discover-cards  –  Pool-Only Card Serving Edge Function
 *
 * Serves cards exclusively from card_pool. Zero external API calls.
 * Card generation is handled by separate admin-triggered functions:
 *   - generate-single-cards (single place cards from place_pool)
 *   - generate-curated-experiences (multi-stop curated cards)
 *
 * Pipeline:
 *   1. Query card_pool for ALL requested categories at once
 *   2. Filter by datetime, score against user preferences
 *   3. Record user impressions for served cards
 *   4. If pool is empty, return { cards: [], hasMore: false } (HTTP 200)
 *
 * Supports:
 *   - Multi-category in one request (e.g. ["Nature", "Drink", "Casual Eats"])
 *   - Offset pagination via batchSeed * limit
 *   - Travel constraint-based radius calculation
 *   - Budget, datetime, price tier filtering
 *   - 5-factor scoring personalized per user
 * ──────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const poolOffset = (batchSeed || 0) * limit;

    // ── Warm-pool: return immediately (pool is admin-managed) ──
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
          '', // No Google API key needed — pool-only serving
          { travelMode },
        );

        if (poolResult.cards.length > 0) {
          const elapsed = Date.now() - t0;
          // Apply date/time filter to pool-served cards
          const timeFilteredCards = filterByDateTime(poolResult.cards, datetimePref, dateOption, timeSlot, _exactTime);
          const scoredPoolCards = scorePoolCards(timeFilteredCards);
          console.log(`[discover-cards] Served ${scoredPoolCards.length} from pipeline (${poolResult.cards.length} pre-filter, offset=${poolOffset}) in ${elapsed}ms`);

          return new Response(JSON.stringify({
            cards: applyTierGating(scoredPoolCards),
            total: poolResult.totalUnseenCount ?? poolResult.totalPoolSize,
            source: 'pool',
            ...swipeInfoPayload(),
            metadata: {
              hasMore: poolResult.hasMore,
              poolSize: poolResult.totalUnseenCount ?? poolResult.totalPoolSize,
              batchSeed: batchSeed ?? 0,
            },
            sourceBreakdown: {
              fromPool: poolResult.fromPool,
              fromApi: 0,
              totalServed: scoredPoolCards.length,
              apiCallsMade: 0,
              cacheHits: 0,
              gapCategories: poolResult.diagnostics?.gapCategories ?? [],
              reason: poolResult.diagnostics?.reason ?? 'Served from pipeline',
              path: 'pipeline',
            },
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        console.log(`[discover-cards] Pool had ${poolResult.cards.length}/${limit} cards — pool empty`);
      } catch (poolErr) {
        console.warn('[discover-cards] Pool serve failed:', poolErr);
      }
    }

    // ── Pool returned 0 cards — return empty (admin needs to run generate-single-cards) ──
    const elapsed = Date.now() - t0;
    console.log(`[discover-cards] Pool empty for categories=[${categories}] at [${location.lat},${location.lng}] — returning empty (${elapsed}ms)`);

    return new Response(JSON.stringify({
      cards: [],
      total: 0,
      source: 'pool',
      ...swipeInfoPayload(),
      metadata: { hasMore: false, poolSize: 0, batchSeed: batchSeed ?? 0 },
      sourceBreakdown: {
        fromPool: 0,
        fromApi: 0,
        totalServed: 0,
        apiCallsMade: 0,
        cacheHits: 0,
        gapCategories: categories,
        reason: 'Pool empty for this area — run generate-single-cards to populate',
        path: 'pool-empty',
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[discover-cards] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: (err as any)?.message || 'Internal error', cards: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
