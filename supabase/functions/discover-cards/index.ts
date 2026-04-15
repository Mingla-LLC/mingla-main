import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  serveCardsFromPipeline,
} from '../_shared/cardPoolService.ts';
import {
  resolveCategories,
  HIDDEN_CATEGORIES,
} from '../_shared/categoryPlaceTypes.ts';
import { PriceTierSlug } from '../_shared/priceTiers.ts';
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

/** Parse a single time range like "9:00 AM – 5:00 PM" or "5:00 – 9:30 PM" (Google PM-only format).
 *  Returns { open, close } in fractional 24h hours, or null if unparseable.
 *  Handles overnight wraparound: "5 PM - 2 AM" → { open: 17, close: 26 }. */
function parseSingleRange(range: string): { open: number; close: number } | null {
  // Pattern 1: AM/PM on BOTH sides — "9:00 AM – 5:00 PM"
  const fullMatch = range.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–\-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (fullMatch) {
    let openH = parseInt(fullMatch[1]);
    const openMin = parseInt(fullMatch[2] || '0');
    const openAmPm = fullMatch[3].toUpperCase();
    let closeH = parseInt(fullMatch[4]);
    const closeMin = parseInt(fullMatch[5] || '0');
    const closeAmPm = fullMatch[6].toUpperCase();
    if (openAmPm === 'PM' && openH !== 12) openH += 12;
    if (openAmPm === 'AM' && openH === 12) openH = 0;
    if (closeAmPm === 'PM' && closeH !== 12) closeH += 12;
    if (closeAmPm === 'AM' && closeH === 12) closeH = 0;
    const open = openH + openMin / 60;
    let close = closeH + closeMin / 60;
    if (close <= open) close += 24;
    return { open, close };
  }

  // Pattern 2: AM/PM only on closing — "5:00 – 9:30 PM" (Google PM-only format)
  const partialMatch = range.match(/(\d{1,2})(?::(\d{2}))?\s*[–\-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (partialMatch) {
    let openH = parseInt(partialMatch[1]);
    const openMin = parseInt(partialMatch[2] || '0');
    let closeH = parseInt(partialMatch[3]);
    const closeMin = parseInt(partialMatch[4] || '0');
    const closeAmPm = partialMatch[5].toUpperCase();
    if (closeAmPm === 'PM' && closeH !== 12) closeH += 12;
    if (closeAmPm === 'AM' && closeH === 12) closeH = 0;
    // Infer opening AM/PM: if close is PM and open <= close (in 12h), open is PM too
    // If close is AM (late night), open is PM (crossed midnight)
    if (closeAmPm === 'PM') {
      if (openH !== 12 && openH < 12) openH += 12; // Infer PM
    } else {
      // Close is AM (e.g., "10:00 – 1:00 AM") → open is PM
      if (openH !== 12 && openH < 12) openH += 12;
    }
    const open = openH + openMin / 60;
    let close = closeH + closeMin / 60;
    if (close <= open) close += 24;
    return { open, close };
  }

  return null;
}

/** Parse hours text into an array of time ranges.
 *  Handles split hours: "11:00 AM – 2:30 PM, 5:00 – 10:00 PM" → two ranges.
 *  Returns null if closed or empty. */
function parseHoursText(text: string): { open: number; close: number }[] | null {
  if (!text || text.toLowerCase().includes('closed')) return null;
  if (text.toLowerCase().includes('open 24') || text.toLowerCase().includes('24 hours')) {
    return [{ open: 0, close: 24 }];
  }

  // Split on comma for multi-range hours
  const parts = text.split(/,\s*/);
  const ranges: { open: number; close: number }[] = [];
  for (const part of parts) {
    const parsed = parseSingleRange(part.trim());
    if (parsed) ranges.push(parsed);
  }
  return ranges.length > 0 ? ranges : null;
}

/** Check if a target hour falls within any of the parsed ranges. */
function hourInRanges(hour: number, ranges: { open: number; close: number }[]): boolean {
  return ranges.some(r => hour >= r.open && hour < r.close);
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function filterByDateTime(
  places: any[],
  datetimePref: string | undefined,
  dateOption: string,
  timeSlot: string | null,
  timeSlots?: string[] | null,
): any[] {
  // Multi-slot UNION: if any slot is 'anytime', skip all time filtering
  if (timeSlots?.includes('anytime')) return places;
  // 'anytime' means no time-of-day filtering — return all places as-is
  if (timeSlot === 'anytime') return places;

  // LIVE OPENING HOURS CHECK (Block 6 — hardened 2026-03-22, timezone-aware 2026-03-28)
  // Uses place-local time via utcOffsetMinutes for correct timezone handling.
  // Always-open types (parks, beaches, etc.) bypass hours check.
  // Cards with no hours AND not always-open are EXCLUDED.
  if (dateOption === 'now' || (!datetimePref && !timeSlot)) {
    const utcNow = new Date();

    return places.filter(place => {
      // Compute place-local day and hour using its UTC offset
      const offsetMin = place.utcOffsetMinutes ?? (place.lng != null ? Math.round(place.lng / 15) * 60 : 0);
      const localMs = utcNow.getTime() + offsetMin * 60 * 1000;
      const localDate = new Date(localMs);
      const targetDay = localDate.getUTCDay();
      const targetHourFrac = localDate.getUTCHours() + localDate.getUTCMinutes() / 60;

      // Always-open place types: no hours check needed
      const pType = place.placeType || '';
      if (ALWAYS_OPEN_TYPES.has(pType)) return true;

      // Path A: Google API format — regularOpeningHours.periods
      const periods = place.regularOpeningHours?.periods;
      if (periods && periods.length > 0) {
        return periods.some((period: any) => {
          if (period.open?.day !== targetDay) return false;
          const openHour = period.open?.hour ?? 0;
          let closeHour = period.close?.hour ?? 24;
          if (closeHour === 0) closeHour = 24;
          if (closeHour <= openHour) closeHour += 24;
          return targetHourFrac >= openHour && targetHourFrac < closeHour;
        });
      }

      // Path B: Pool format — openingHours as Record<string, string>
      const oh = place.openingHours;
      if (oh && typeof oh === 'object') {
        // Path B.1: Structured periods (preserved from Google API — most reliable)
        if (oh._periods && Array.isArray(oh._periods) && oh._periods.length > 0) {
          return oh._periods.some((period: any) => {
            if (period.open?.day !== targetDay) return false;
            const openH = (period.open?.hour ?? 0) + (period.open?.minute ?? 0) / 60;
            let closeH = (period.close?.hour ?? 24) + (period.close?.minute ?? 0) / 60;
            if (closeH === 0) closeH = 24;
            if (closeH <= openH) closeH += 24;
            return targetHourFrac >= openH && targetHourFrac < closeH;
          });
        }
        // Path B.2: Text-based hours (fallback — uses regex parser)
        const dayName = DAY_NAMES[targetDay];
        const dayText = oh[dayName];
        if (!dayText) return true; // No data for this specific day — include
        const parsed = parseHoursText(dayText);
        if (!parsed) return false; // "Closed" or unparseable
        return hourInRanges(targetHourFrac, parsed);
      }

      // No opening hours data AND not an always-open type → INCLUDE (assumed possibly open).
      // Including these places increases evening card counts by 30-50%. The user accepts
      // the risk of traveling to a potentially closed place for a larger, more varied deck.
      return true;
    });
  }

  // Helper: check if a place is open during a specific hour range on a given day
  function isOpenDuringHour(place: any, day: number, hourStart: number): boolean {
    const pType = place.placeType || '';
    if (ALWAYS_OPEN_TYPES.has(pType)) return true;

    const periods = place.regularOpeningHours?.periods;
    if (periods && periods.length > 0) {
      return periods.some((period: any) => {
        if (period.open?.day !== day) return false;
        const openHour = period.open?.hour ?? 0;
        let closeHour = period.close?.hour ?? 24;
        if (closeHour === 0) closeHour = 24;
        if (closeHour <= openHour) closeHour += 24;
        return hourStart >= openHour && hourStart < closeHour;
      });
    }

    const oh = place.openingHours;
    if (oh && typeof oh === 'object') {
      if (oh._periods && Array.isArray(oh._periods) && oh._periods.length > 0) {
        return oh._periods.some((period: any) => {
          if (period.open?.day !== day) return false;
          const openH = (period.open?.hour ?? 0) + (period.open?.minute ?? 0) / 60;
          let closeH = (period.close?.hour ?? 24) + (period.close?.minute ?? 0) / 60;
          if (closeH === 0) closeH = 24;
          if (closeH <= openH) closeH += 24;
          return hourStart >= openH && hourStart < closeH;
        });
      }
      const dayName = DAY_NAMES[day];
      const dayText = oh[dayName];
      if (!dayText) return true;
      const parsed = parseHoursText(dayText);
      if (!parsed) return false;
      return hourInRanges(hourStart, parsed);
    }

    return true; // No hours data — assume open
  }

  // Weekend filtering — check Saturday (6) and Sunday (0) instead of today (ORCH-0431)
  // dateOption values: "weekend", "this-weekend", "this weekend" (all accepted)
  const dOpt = dateOption.toLowerCase().replace(/-/g, ' ');
  if (dOpt === 'weekend' || dOpt === 'this weekend') {
    const hourStart = (timeSlot && TIME_SLOT_RANGES[timeSlot])
      ? TIME_SLOT_RANGES[timeSlot].start
      : 12; // noon default if no slot specified
    return places.filter(place =>
      isOpenDuringHour(place, 6, hourStart) || isOpenDuringHour(place, 0, hourStart),
    );
  }

  // Multi-slot UNION filtering (collab mode — DEC-010)
  // Place passes if open during ANY of the selected time slots.
  if (timeSlots && timeSlots.length > 1) {
    return places.filter(place => {
      let targetDay: number;
      if (datetimePref) {
        const prefDate = new Date(datetimePref);
        const noonUtc = new Date(prefDate.getUTCFullYear(), prefDate.getUTCMonth(), prefDate.getUTCDate(), 12, 0, 0);
        targetDay = noonUtc.getDay();
      } else {
        const offsetMin = place.utcOffsetMinutes ?? (place.lng != null ? Math.round(place.lng / 15) * 60 : 0);
        const localMs = Date.now() + offsetMin * 60 * 1000;
        targetDay = new Date(localMs).getUTCDay();
      }
      return timeSlots.some(slot => {
        const range = TIME_SLOT_RANGES[slot];
        if (!range) return false;
        return isOpenDuringHour(place, targetDay, range.start);
      });
    });
  }

  return places.filter(place => {
    // Compute the target day and hour for hours filtering.
    // When datetimePref is provided, the client already encoded local midnight as UTC
    // (e.g., Monday midnight EDT → "2026-04-06T04:00:00.000Z"). Applying a longitude-based
    // offset on top of that double-converts and pushes midnight back to the previous day.
    // Fix: extract day directly from datetimePref (represents the user's chosen date).
    // For "today"/"now" without datetimePref, use place-local time from server UTC.
    let targetDay: number;
    let targetHourStart: number;

    if (datetimePref) {
      // Client sent a specific date — trust it. Extract day from the UTC representation.
      // The date in UTC is the user's intended date (off by a few hours at most, but
      // the day-of-week is correct for the user's timezone when sent near midnight).
      const prefDate = new Date(datetimePref);
      // Use the date portion at noon UTC to avoid midnight boundary issues
      const noonUtc = new Date(prefDate.getUTCFullYear(), prefDate.getUTCMonth(), prefDate.getUTCDate(), 12, 0, 0);
      targetDay = noonUtc.getDay();
    } else {
      // No specific date — use current time in place's local timezone
      const offsetMin = place.utcOffsetMinutes ?? (place.lng != null ? Math.round(place.lng / 15) * 60 : 0);
      const localMs = Date.now() + offsetMin * 60 * 1000;
      const localDate = new Date(localMs);
      targetDay = localDate.getUTCDay();
    }

    if (timeSlot && TIME_SLOT_RANGES[timeSlot]) {
      targetHourStart = TIME_SLOT_RANGES[timeSlot].start;
    } else if (datetimePref) {
      targetHourStart = new Date(datetimePref).getUTCHours();
    } else {
      const offsetMin = place.utcOffsetMinutes ?? (place.lng != null ? Math.round(place.lng / 15) * 60 : 0);
      const localMs = Date.now() + offsetMin * 60 * 1000;
      targetHourStart = new Date(localMs).getUTCHours();
    }

    // Always-open place types
    const pType = place.placeType || '';
    if (ALWAYS_OPEN_TYPES.has(pType)) return true;

    // Path A: periods
    const periods = place.regularOpeningHours?.periods;
    if (periods && periods.length > 0) {
      return periods.some((period: any) => {
        if (period.open?.day !== targetDay) return false;
        const openHour = period.open?.hour ?? 0;
        let closeHour = period.close?.hour ?? 24;
        if (closeHour === 0) closeHour = 24;
        if (closeHour <= openHour) closeHour += 24;
        return targetHourStart >= openHour && targetHourStart < closeHour;
      });
    }

    // Path B: Record<string, string>
    const oh = place.openingHours;
    if (oh && typeof oh === 'object') {
      // Path B.1: Structured periods (preserved from Google API)
      if (oh._periods && Array.isArray(oh._periods) && oh._periods.length > 0) {
        return oh._periods.some((period: any) => {
          if (period.open?.day !== targetDay) return false;
          const openH = (period.open?.hour ?? 0) + (period.open?.minute ?? 0) / 60;
          let closeH = (period.close?.hour ?? 24) + (period.close?.minute ?? 0) / 60;
          if (closeH === 0) closeH = 24;
          if (closeH <= openH) closeH += 24;
          return targetHourStart >= openH && targetHourStart < closeH;
        });
      }
      // Path B.2: Text-based hours (fallback)
      const dayName = DAY_NAMES[targetDay];
      const dayText = oh[dayName];
      if (!dayText) return true;
      const parsed = parseHoursText(dayText);
      if (!parsed) return false;
      return hourInRanges(targetHourStart, parsed);
    }

    // No opening hours data AND not an always-open type → INCLUDE (assumed possibly open).
    // Consistent with the "now" path — same policy for all date options.
    return true;
  });
}

// ── Cascading Hours Filter for Curated Cards ───────────────────────────────
// Before serving curated cards, check that each stop is open when the user
// would actually arrive there (accounting for previous stop duration + travel).

const CURATED_STOP_DURATION: Record<string, number> = {
  park: 60, botanical_garden: 60, hiking_area: 90, beach: 90,
  national_park: 90, state_park: 90, garden: 45,
  bar: 60, pub: 60, wine_bar: 60, cocktail_bar: 60, brewery: 60,
  restaurant: 60, fine_dining_restaurant: 90, french_restaurant: 90,
  steak_house: 90, italian_restaurant: 75, seafood_restaurant: 60,
  movie_theater: 150, art_gallery: 60, museum: 90,
  performing_arts_theater: 120, concert_hall: 120, opera_house: 150,
  bowling_alley: 60, karaoke: 90, video_arcade: 60,
  amusement_center: 60, amusement_park: 180,
  spa: 90, massage_spa: 90,
  cafe: 30, coffee_shop: 30, bakery: 20,
  grocery_store: 30, supermarket: 30, florist: 15,
  picnic_ground: 120,
};

const ALWAYS_OPEN_TYPES = new Set([
  'park', 'national_park', 'state_park', 'hiking_area', 'beach',
  'botanical_garden', 'city_park', 'garden', 'nature_preserve',
  'picnic_ground', 'scenic_spot', 'tourist_attraction', 'plaza',
  'lake', 'river', 'woods', 'mountain_peak',
]);

function isStopOpenAtHour(stop: any, hour: number, dayOfWeek: number): boolean {
  // Always-open outdoor types
  const pType = stop.placeType || '';
  if (ALWAYS_OPEN_TYPES.has(pType)) return true;

  const oh = stop.openingHours;
  if (!oh || typeof oh !== 'object') return true; // No data → assume open

  const dayName = DAY_NAMES[dayOfWeek];
  const dayText = oh[dayName];
  if (!dayText) return true;

  const parsed = parseHoursText(dayText);
  if (!parsed) return false; // "Closed" or unparseable
  return hourInRanges(hour, parsed);
}

function filterCuratedByStopHours(
  cards: any[],
  utcNow: Date,
): any[] {
  return cards.filter(card => {
    if (card.cardType !== 'curated' || !card.stops?.length) return true;

    // Compute place-local start time using card's timezone offset
    const offsetMin = card.utcOffsetMinutes ?? (card.lng != null ? Math.round(card.lng / 15) * 60 : 0);
    const localMs = utcNow.getTime() + offsetMin * 60 * 1000;
    const localDate = new Date(localMs);
    let currentHour = localDate.getUTCHours() + localDate.getUTCMinutes() / 60;
    const localDay = localDate.getUTCDay();

    for (let i = 0; i < card.stops.length; i++) {
      const stop = card.stops[i];
      if (stop.optional) continue;

      if (!isStopOpenAtHour(stop, currentHour, localDay)) return false;

      const duration = CURATED_STOP_DURATION[stop.placeType] || 45;
      const travelToNext = (i < card.stops.length - 1)
        ? (card.stops[i + 1]?.travelTimeFromPreviousStopMin || 15)
        : 0;
      currentHour += (duration + travelToNext) / 60;
    }
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
      timeSlots: rawTimeSlots,
      batchSeed = 0,
      limit = 200,
      priceTiers,
      excludeCardIds: rawExcludeCardIds = [],
    } = body;

    // Accept all string IDs — can be Google Place IDs or card_pool UUIDs
    const excludeCardIds: string[] = Array.isArray(rawExcludeCardIds)
      ? rawExcludeCardIds.filter((id: unknown) => typeof id === 'string' && (id as string).length > 0)
      : [];

    // Support both single timeSlot (solo) and timeSlots array (collab UNION — DEC-010)
    const VALID_SLOTS = ['brunch', 'afternoon', 'dinner', 'lateNight', 'anytime'];
    let resolvedTimeSlots: string[] | null = null;
    if (Array.isArray(rawTimeSlots) && rawTimeSlots.length > 0) {
      resolvedTimeSlots = rawTimeSlots.filter((s: string) => VALID_SLOTS.includes(s));
      if (resolvedTimeSlots.length === 0) resolvedTimeSlots = null;
    } else if (rawTimeSlot && VALID_SLOTS.includes(rawTimeSlot)) {
      resolvedTimeSlots = [rawTimeSlot];
    }
    // Single slot for backward compat with existing filterByDateTime path
    const timeSlot = resolvedTimeSlots && resolvedTimeSlots.length === 1
      ? resolvedTimeSlots[0]
      : null;

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

    // ── Resolve categories to canonical names, filter out hidden ──────────
    const categories = resolveCategories(rawCategories)
      .filter(c => !HIDDEN_CATEGORIES.has(c));
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

    // --- TIER GATING: Effective tier ---
    let effectiveTier = 'free';
    if (userId) {
      const { data: tierData } = await supabaseAdmin.rpc('get_effective_tier', { p_user_id: userId });
      effectiveTier = tierData ?? 'free';
    }

    // Note: curated cards are now fully visible to all tiers.
    // Save-gating is handled client-side (free users can view but not save).

    // ── Calculate search radius from travel constraint ────────────────────
    const maxDistKm = (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3;
    const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);

    // ── Helper: re-score pool-served cards against CURRENT user's preferences ─
    function scorePoolCards(cards: any[]): any[] {
      if (!cards.length) return cards;
      // AI validation is the sole quality gate for category membership.
      // No per-category price floor — if AI approved a place as fine_dining,
      // trust the AI regardless of price tier. User's price tier selection
      // (via preferences) is the only price filter that applies.
      const scored = scoreCards(cards, { categories, priceTiers: priceTiers || [] });
      scored.sort((a, b) => b.matchScore - a.matchScore);
      return scored.map(s => ({
        ...s.card,
        matchScore: s.matchScore,
        scoringFactors: s.factors,
      }));
    }

    // ── Pool-first serving (ALL categories in ONE query) ──────────────────

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
          priceTiers: priceTiers as PriceTierSlug[] | undefined,
          excludePlaceIds: excludeCardIds,
        };

        const poolResult = await serveCardsFromPipeline(
          poolParams,
          '', // No Google API key needed — pool-only serving
          { travelMode, travelConstraintValue },
        );

        if (poolResult.cards.length > 0) {
          const elapsed = Date.now() - t0;
          // Apply date/time filter to pool-served cards
          const timeFilteredCards = filterByDateTime(poolResult.cards, datetimePref, dateOption, timeSlot, resolvedTimeSlots);

          // Apply cascading hours filter to curated cards (timezone-aware via utcNow + card offset)
          const curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date();
          const hoursFilteredCards = filterCuratedByStopHours(timeFilteredCards, curatedUtcNow);

          const scoredPoolCards = scorePoolCards(hoursFilteredCards);
          console.log(`[discover-cards] Served ${scoredPoolCards.length} from pipeline (${poolResult.cards.length} pre-filter, batch=${batchSeed}) in ${elapsed}ms`);

          return new Response(JSON.stringify({
            cards: scoredPoolCards,
            total: poolResult.totalUnseenCount ?? poolResult.totalPoolSize,
            source: 'pool',
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
