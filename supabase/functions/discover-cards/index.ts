import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  resolveCategories,
  HIDDEN_CATEGORIES,
} from '../_shared/categoryPlaceTypes.ts';
// ORCH-0634: scoreCards / scorePoolCards / stableHash removed — signal_score
// IS the match score now (no chip-match heuristic re-ranking on top).
import { isInCohort } from '../_shared/signalScorer.ts';
import { googleLevelToTierSlug } from '../_shared/priceTiers.ts';
// ORCH-0634: multi-chip signal fan-out helper. Replaces the deprecated
// card_pool pipeline as the singles serving source. See
// Mingla_Artifacts/outputs/SPEC_ORCH-0634_SIGNAL_ONLY_SERVING_AND_INTERLEAVE.md.
import { roundRobinByChip } from '../_shared/deckInterleave.ts';
// ORCH-0659/0660: honest distance + per-mode travel-time computation.
// Single owner: _shared/distanceMath.ts. See
// Mingla_Artifacts/specs/SPEC_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md.
import { haversineKm, estimateTravelMinutes, type TravelMode } from '../_shared/distanceMath.ts';

// ─── ORCH-0588 Slice 1: cohort cache for signal-serving rollout ───────────────
// Module-scoped 60s cache for the admin-config cohort pct. 60s = balance between
// admin slider responsiveness and DB load. Do NOT lower without measuring impact
// under high QPS. Invariant I-COHORT-REVERSIBLE: flag=0 → all users on control.
const SIGNAL_PCT_CACHE = new Map<string, { value: number; expiresAt: number }>();
const COHORT_CACHE_TTL_MS = 60_000;

async function getSignalServingPct(supabase: any, signalId: string): Promise<number> {
  const key = `signal_serving_${signalId}_pct`;
  const cached = SIGNAL_PCT_CACHE.get(key);
  const now = Date.now();
  if (cached && now < cached.expiresAt) return cached.value;
  const { data } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  const raw = data?.value;
  const pct = raw != null ? Math.max(0, Math.min(100, Number(raw))) : 0;
  SIGNAL_PCT_CACHE.set(key, { value: pct, expiresAt: now + COHORT_CACHE_TTL_MS });
  return pct;
}

// ─── ORCH-0590 Slice 2 / ORCH-0596 Slice 4: generalized multi-signal cohort routing ─
// Maps mobile chip label (display name or slug) → signal config for cohort serving.
// Invariant I-CATEGORY-SIGNAL-ALIAS-COMPLETE: every cohort-eligible chip must have
// BOTH its display name AND slug keyed here so pre-OTA + post-OTA clients both hit.
// Invariant I-SIGNALIDS-ALWAYS-ARRAY: value.signalIds is ALWAYS an array (length ≥ 1).
//   Length 1 = single-signal chip. Length > 1 = union chip served via parallel-RPC merge.
// Add a new entry per slice. Remove old display-name aliases only after 14d soak @100%.
//
// [TRANSITIONAL] 'Upscale & Fine Dining' alias — remove after 2026-05-05 (14d post Slice 2 OTA @ 100%).
// Exit condition: mobile OTA for Slice 2 has been at 100% adoption for ≥14 days.
const CATEGORY_TO_SIGNAL: Record<
  string,
  { signalIds: string[]; filterMin: number; displayCategory: string }
> = {
  // Slice 1 (fine_dining) — OLD display name kept as alias for pre-Slice-2-OTA clients
  'Upscale & Fine Dining': { signalIds: ['fine_dining'], filterMin: 120, displayCategory: 'Fine Dining' },
  'Fine Dining':           { signalIds: ['fine_dining'], filterMin: 120, displayCategory: 'Fine Dining' },
  'upscale_fine_dining':   { signalIds: ['fine_dining'], filterMin: 120, displayCategory: 'Fine Dining' },
  // Slice 2 (drinks)
  'Drinks & Music':        { signalIds: ['drinks'], filterMin: 120, displayCategory: 'Drinks & Music' },
  'drinks_and_music':      { signalIds: ['drinks'], filterMin: 120, displayCategory: 'Drinks & Music' },
  // Slice 5 / ORCH-0597 — brunch + casual_food chips split into TWO separate chips.
  // Single-signal routing per chip; union retained only for pre-OTA clients (below).
  'Brunch':      { signalIds: ['brunch'],      filterMin: 120, displayCategory: 'Brunch' },
  'brunch':      { signalIds: ['brunch'],      filterMin: 120, displayCategory: 'Brunch' },
  'Casual':      { signalIds: ['casual_food'], filterMin: 120, displayCategory: 'Casual' },
  'casual_food': { signalIds: ['casual_food'], filterMin: 120, displayCategory: 'Casual' },
  // Slice 6 / ORCH-0598 — 5 new type-grounded signals: nature, play, creative_arts,
  // movies, theatre. Single-signal routing per chip. Movies uses relaxed filterMin=80
  // per OPEN-10 (tiny universe — only 7 cinemas in Raleigh).
  'Nature & Views':  { signalIds: ['nature'],        filterMin: 120, displayCategory: 'Nature & Views' },
  'nature':          { signalIds: ['nature'],        filterMin: 120, displayCategory: 'Nature & Views' },
  'Play':            { signalIds: ['play'],          filterMin: 120, displayCategory: 'Play' },
  'play':            { signalIds: ['play'],          filterMin: 120, displayCategory: 'Play' },
  'Creative & Arts': { signalIds: ['creative_arts'], filterMin: 120, displayCategory: 'Creative & Arts' },
  'creative_arts':   { signalIds: ['creative_arts'], filterMin: 120, displayCategory: 'Creative & Arts' },
  'Movies':  { signalIds: ['movies'],  filterMin: 80,  displayCategory: 'Movies' },
  'movies':  { signalIds: ['movies'],  filterMin: 80,  displayCategory: 'Movies' },
  'Theatre': { signalIds: ['theatre'], filterMin: 120, displayCategory: 'Theatre' },
  'theatre': { signalIds: ['theatre'], filterMin: 120, displayCategory: 'Theatre' },
  // Slice 7 / ORCH-0599 — Icebreakers chip routed via first-date-friendly `icebreakers`
  // signal. Completes the "every visible chip uses signal serving" invariant.
  'Icebreakers': { signalIds: ['icebreakers'], filterMin: 120, displayCategory: 'Icebreakers' },
  'icebreakers': { signalIds: ['icebreakers'], filterMin: 120, displayCategory: 'Icebreakers' },
  // [TRANSITIONAL] ORCH-0597 pre-OTA clients still send the old union chip label/slug.
  // Serve the union (brunch + casual_food) via parallel-RPC merge, same as Slice 4 did.
  // Exit condition: 2026-05-12 (14d post ORCH-0597 100% OTA adoption).
  'Brunch, Lunch & Casual': { signalIds: ['brunch', 'casual_food'], filterMin: 120, displayCategory: 'Brunch' },
  'brunch_lunch_casual':    { signalIds: ['brunch', 'casual_food'], filterMin: 120, displayCategory: 'Brunch' },
  // [TRANSITIONAL] ORCH-0598 pre-OTA clients still send the old Movies & Theatre union.
  // Serve the union (movies + theatre) via parallel-RPC merge.
  // Exit condition: 2026-05-13 (coordinated with ORCH-0597 2026-05-12 for single cleanup).
  'Movies & Theatre': { signalIds: ['movies', 'theatre'], filterMin: 100, displayCategory: 'Movies' },
  'movies_theatre':   { signalIds: ['movies', 'theatre'], filterMin: 100, displayCategory: 'Movies' },
};

/* ─────────────────────────────────────────────────────────────────────────────
 * discover-cards  –  Pool-Only Card Serving Edge Function
 *
 * Serves cards exclusively from card_pool. Zero external API calls.
 *
 * INV-043 (ORCH-0474): Every response path returns explicitly. There is NO
 * unconditional fall-through. If you add a new exit condition, add an explicit
 * return with a unique sourceBreakdown.path value. The four non-populated paths
 * are mutually exclusive:
 *   - path:'pool-empty'     — RPC succeeded, zero rows (seeding gap)
 *   - path:'auth-required'  — JWT sub unreadable (platform misconfiguration)
 *   - path:'pipeline-error' — serveCardsFromPipeline threw (runtime failure)
 *   - source:'disabled'     — body.warmPool legacy path
 *
 * INV-042 (ORCH-0474): Runtime failures and data-absence signals MUST use
 * distinct paths. A client cannot diagnose "server crashed" from "no data"
 * if they share a response shape.
 *
 * ORCH-0434: Removed time-slot filtering, budget filtering, price tier filtering.
 *            filterByDateTime simplified to 3 date modes only.
 *            Cards without opening hours excluded (except ALWAYS_OPEN_TYPES).
 * ──────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const SPEED_KMH: Record<string, number> = {
  walking: 4.5,
  driving: 100,
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

/**
 * ORCH-0446: AND date filtering for collab sessions.
 * Card must be open during ALL provided date windows (INTERSECTION).
 * If AND produces zero results, falls back to UNION (OR) — card passes if open during ANY window.
 * Solo mode never calls this — it uses filterByDateTime directly.
 */
function filterByDateWindows(
  places: any[],
  dateWindows: string[],
  datetimePref: string | undefined,
  selectedDates?: string[] | null,
): any[] {
  if (!dateWindows || dateWindows.length === 0) {
    return places;
  }

  // AND pass: card must pass ALL windows
  const andResult = places.filter(place => {
    return dateWindows.every(window => {
      const windowFiltered = filterByDateTime([place], datetimePref, window, selectedDates);
      return windowFiltered.length > 0;
    });
  });

  if (andResult.length > 0) {
    return andResult;
  }

  // UNION fallback: card passes if it matches ANY window
  return places.filter(place => {
    return dateWindows.some(window => {
      const windowFiltered = filterByDateTime([place], datetimePref, window, selectedDates);
      return windowFiltered.length > 0;
    });
  });
}

// ORCH-0434: Simplified filterByDateTime — 3 date modes only, no time slots.
// Cards without opening hours are EXCLUDED (except ALWAYS_OPEN_TYPES).
//
// [CRITICAL — ORCH-0641] place_pool.opening_hours is the unwrapped Google Places v1
// regularOpeningHours shape written by admin-seed-places:314. Top-level keys are
// { openNow, periods, weekdayDescriptions, nextOpenTime }. The primary filter key
// is `periods` (no underscore). The 3 helpers below (isOpenAtHour Path B,
// hasOpeningData, isOpenAnyTimeOnDay Path B) MUST check `oh.periods` before any
// fallback. ~99.9% of rows match this shape; ~37 legacy rows have lowercase day
// keys and fall through to parseHoursText. If you edit this, grep every edge
// function that reads `opening_hours` for parity.
//
// Pre-ORCH-0641 bug: checked `oh._periods` (with underscore) + lowercase day keys
// only. Those keys don't exist in schema → filter returned false → every place
// excluded unless primary_type in ALWAYS_OPEN_TYPES. 7 of 10 chips returned 0
// cards for every user from 2026-04-15 through 2026-04-23. Fixed by reading
// `oh.periods` as the primary Path B.1a shape.
function filterByDateTime(
  places: any[],
  datetimePref: string | undefined,
  dateOption: string,
  selectedDates?: string[] | null,
): any[] {

  // Helper: check if a place is open at a specific hour on a given day
  function isOpenAtHour(place: any, day: number, hourFrac: number): boolean {
    const pType = place.placeType || '';
    if (ALWAYS_OPEN_TYPES.has(pType)) return true;

    // Path A: Google API format — regularOpeningHours.periods
    const periods = place.regularOpeningHours?.periods;
    if (periods && periods.length > 0) {
      return periods.some((period: any) => {
        if (period.open?.day !== day) return false;
        const openHour = period.open?.hour ?? 0;
        let closeHour = period.close?.hour ?? 24;
        if (closeHour === 0) closeHour = 24;
        if (closeHour <= openHour) closeHour += 24;
        return hourFrac >= openHour && hourFrac < closeHour;
      });
    }

    // Path B: Pool format — openingHours is the unwrapped Google v1 shape.
    const oh = place.openingHours;
    if (oh && typeof oh === 'object') {
      // Local helper: evaluate a periods array (same shape whether `periods` or `_periods`).
      const evalPeriods = (periodsArr: any[]): boolean => {
        return periodsArr.some((period: any) => {
          if (period.open?.day !== day) return false;
          const openH = (period.open?.hour ?? 0) + (period.open?.minute ?? 0) / 60;
          let closeH = (period.close?.hour ?? 24) + (period.close?.minute ?? 0) / 60;
          if (closeH === 0) closeH = 24;
          if (closeH <= openH) closeH += 24;
          return hourFrac >= openH && hourFrac < closeH;
        });
      };
      // Path B.1a: Primary shape — `periods` array (place_pool canonical, Google v1).
      if (Array.isArray(oh.periods) && oh.periods.length > 0) {
        return evalPeriods(oh.periods);
      }
      // Path B.1b: Legacy underscore-prefixed `_periods` — safety fallback.
      if (Array.isArray(oh._periods) && oh._periods.length > 0) {
        return evalPeriods(oh._periods);
      }
      // Path B.2: Text-based hours (legacy rows with lowercase day keys — ~37 rows).
      const dayName = DAY_NAMES[day];
      const dayText = oh[dayName];
      if (!dayText) return false; // No data for this day → exclude
      const parsed = parseHoursText(dayText);
      if (!parsed) return false; // "Closed" or unparseable
      return hourInRanges(hourFrac, parsed);
    }

    // No opening hours data → EXCLUDE (ORCH-0434 hard rule)
    return false;
  }

  // Helper: check if a place has ANY opening hours data or is always-open type
  function hasOpeningData(place: any): boolean {
    if (ALWAYS_OPEN_TYPES.has(place.placeType || '')) return true;
    // Google API raw shape (rare — admin-seed-places unwraps this into `openingHours`).
    if (place.regularOpeningHours?.periods?.length > 0) return true;
    const oh = place.openingHours;
    if (oh && typeof oh === 'object') {
      // Path B.1a: Primary shape — `periods` (no underscore) per admin-seed-places:314.
      if (Array.isArray(oh.periods) && oh.periods.length > 0) return true;
      // Path B.1b: Legacy underscore-prefixed fallback.
      if (Array.isArray(oh._periods) && oh._periods.length > 0) return true;
      // Path B.2: Text-based hours — ~37 legacy rows with lowercase day keys.
      return DAY_NAMES.some(d => oh[d]);
    }
    return false;
  }

  // Helper: check if place is open at ANY hour from startHour to midnight on given day
  function isOpenFromHourOnwards(place: any, day: number, startHour: number): boolean {
    // Check every hour from startHour to 23 — if open at any, include
    for (let h = Math.floor(startHour); h < 24; h++) {
      if (isOpenAtHour(place, day, h)) return true;
    }
    return false;
  }

  // Helper: check if place is open at ANY point on the given day.
  // Used by "this_weekend" and "pick_dates" modes so dinner-only venues
  // (fine dining, bars, evening theater) aren't dropped by a noon probe.
  function isOpenAnyTimeOnDay(place: any, day: number): boolean {
    const pType = place.placeType || '';
    if (ALWAYS_OPEN_TYPES.has(pType)) return true;

    // Path A: Google API format — regularOpeningHours.periods
    const periods = place.regularOpeningHours?.periods;
    if (periods && periods.length > 0) {
      return periods.some((period: any) => period.open?.day === day);
    }

    // Path B: Pool format — openingHours is the unwrapped Google v1 shape.
    const oh = place.openingHours;
    if (oh && typeof oh === 'object') {
      // Path B.1a: Primary shape — `periods` array (canonical, no underscore).
      if (Array.isArray(oh.periods) && oh.periods.length > 0) {
        return oh.periods.some((period: any) => period.open?.day === day);
      }
      // Path B.1b: Legacy underscore-prefixed fallback.
      if (Array.isArray(oh._periods) && oh._periods.length > 0) {
        return oh._periods.some((period: any) => period.open?.day === day);
      }
      // Path B.2: Text-based hours — parseable non-"Closed" text means open.
      const dayName = DAY_NAMES[day];
      const dayText = oh[dayName];
      if (!dayText) return false;
      const parsed = parseHoursText(dayText);
      return parsed !== null && parsed.length > 0;
    }

    return false;
  }

  // Normalize dateOption for backward compat
  const dOpt = (dateOption || '').toLowerCase().replace(/-/g, '_').replace(/ /g, '_');

  // ── Mode 1: TODAY ──
  // Show cards open from user's current time onwards (not just "right now").
  // Backward compat: 'now' treated as 'today'.
  if (dOpt === 'today' || dOpt === 'now' || !dateOption) {
    const utcNow = new Date();

    return places.filter(place => {
      if (!hasOpeningData(place)) return false; // ORCH-0434: no hours = exclude

      const offsetMin = place.utcOffsetMinutes ?? (place.lng != null ? Math.round(place.lng / 15) * 60 : 0);
      const localMs = utcNow.getTime() + offsetMin * 60 * 1000;
      const localDate = new Date(localMs);
      const targetDay = localDate.getUTCDay();
      const currentHour = localDate.getUTCHours() + localDate.getUTCMinutes() / 60;

      // Include if open at current time OR opening later today
      return isOpenFromHourOnwards(place, targetDay, currentHour);
    });
  }

  // ── Mode 2: THIS WEEKEND ──
  // Show cards open at ANY point on Saturday OR Sunday.
  // Backward compat: 'weekend' treated as 'this_weekend'.
  if (dOpt === 'this_weekend' || dOpt === 'weekend') {
    return places.filter(place => {
      if (!hasOpeningData(place)) return false;
      return isOpenAnyTimeOnDay(place, 6) || isOpenAnyTimeOnDay(place, 0);
    });
  }

  // ── Mode 3: PICK DATES ──
  // Show cards open on ANY of the selected dates.
  // Backward compat: 'custom' treated as 'pick_dates'.
  if (dOpt === 'pick_dates' || dOpt === 'custom') {
    const dates = selectedDates && selectedDates.length > 0
      ? selectedDates
      : (datetimePref ? [datetimePref] : []);

    if (dates.length === 0) {
      // No dates specified — show all that have opening data
      return places.filter(place => hasOpeningData(place));
    }

    return places.filter(place => {
      if (!hasOpeningData(place)) return false;
      // Card passes if open at ANY point on any selected date
      return dates.some(dateStr => {
        const d = new Date(dateStr);
        const noonUtc = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
        const dayOfWeek = noonUtc.getDay();
        return isOpenAnyTimeOnDay(place, dayOfWeek);
      });
    });
  }

  // Unknown dateOption — filter by opening data only
  return places.filter(place => hasOpeningData(place));
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

// ─── ORCH-0588 Slice 1: signal-serving response shape ────────────────────────
// Maps the new query_servable_places_by_signal RPC row → the same card shape
// mobile already expects (mirrors unifiedCardToRecommendation in deckService.ts).
// Adds two underscore-prefixed debug fields (_signal_score, _signal_contributions)
// the mobile parser ignores. ZERO mobile changes required.
//
// ─── ORCH-0659 + ORCH-0660 ──────────────────────────────────────────────────
// [CRITICAL] This transformer enforces I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME.
// Pre-fix (2026-04-22 → 2026-04-25), this function hardcoded distanceKm=0 and
// travelTimeMin=0, causing every category card to display "nearby" placeholder
// + missing travel-time pill on mobile. The fix: compute haversine distance
// against the user's resolved location + per-mode estimate via shared helpers.
// If you need to "skip" distance/time computation, set both fields to null —
// NEVER 0. The mobile UI hides the badges on null but fabricates "nearby" and
// "0 min" on 0. See:
//   - reports/INVESTIGATION_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md
//   - specs/SPEC_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md
//   - INVARIANT_REGISTRY.md → I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME
// ────────────────────────────────────────────────────────────────────────────
function transformServablePlaceToCard(
  row: any,
  categoryLabel: string,
  userLat: number,
  userLng: number,
  travelMode: TravelMode,
): any {
  const storedPhotos = Array.isArray(row.stored_photo_urls) ? row.stored_photo_urls : [];
  const tier = googleLevelToTierSlug(row.price_level);

  // ORCH-0659/0660: honest distance + per-mode travel-time computation.
  // I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME — never 0-sentinel; if either
  // place lat/lng is null, both fields drop to null so mobile hides the
  // badge instead of fabricating a misleading value.
  const placeLat = typeof row.lat === 'number' ? row.lat : null;
  const placeLng = typeof row.lng === 'number' ? row.lng : null;
  const distanceKm: number | null = (placeLat !== null && placeLng !== null)
    ? Math.round(haversineKm(userLat, userLng, placeLat, placeLng) * 100) / 100
    : null;
  const travelTimeMin: number | null = distanceKm !== null
    ? Math.round(estimateTravelMinutes(distanceKm, travelMode))
    : null;

  return {
    id: row.place_id,
    placeId: row.google_place_id,
    title: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    rating: row.rating,
    reviewCount: row.review_count,
    priceLevel: row.price_level,
    priceTier: tier,
    image: storedPhotos[0] ?? null,
    images: storedPhotos,
    openingHours: row.opening_hours ?? null,
    isOpenNow: null, // computed downstream — mirrors today's behavior
    website: row.website,
    placeType: row.primary_type,
    placeTypeLabel: row.primary_type,
    category: categoryLabel,
    matchScore: Math.round(Number(row.signal_score ?? 0)),
    description: '',
    distanceKm,
    travelTimeMin,
    travelMode,  // Mobile uses this to render the matching mode-icon
    oneLiner: null,
    tip: null,
    // Debug-only fields — mobile parser ignores extra keys
    _signal_score: row.signal_score,
    _signal_contributions: row.signal_contributions,
  };
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
      travelMode = 'walking',
      travelConstraintValue = 30,
      datetimePref,
      dateOption = 'today',
      selectedDates,
      batchSeed = 0,
      limit = 200,
      excludeCardIds: rawExcludeCardIds = [],
      dateWindows,  // ORCH-0446: array of date windows for AND intersection (collab only)
      sessionId,    // ORCH-0446: optional, for analytics logging (collab only)
    } = body;

    // Accept all string IDs — can be Google Place IDs or card_pool UUIDs
    const excludeCardIds: string[] = Array.isArray(rawExcludeCardIds)
      ? rawExcludeCardIds.filter((id: unknown) => typeof id === 'string' && (id as string).length > 0)
      : [];

    // ORCH-0434: Time slot validation removed. Date filtering uses dateOption only.

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

    console.log(`[discover-cards] Request: categories=[${categories}], batchSeed=${batchSeed}, limit=${limit}, mode=${travelMode}${sessionId ? `, session=${sessionId}` : ''}${dateWindows ? `, dateWindows=[${dateWindows}]` : ''}`);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Extract userId from JWT sub claim ──────────────────────────────────
    // ORCH-0474: verify_jwt:true at the platform gate already validated signature,
    // expiry, and issuer. Decoding sub locally avoids a redundant GoTrue round-trip
    // that was a known flake surface — its failure silently produced a misleading
    // "pool empty" response. See SPEC_ORCH-0474 §7.3.
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') ?? '';
    let userId: string | undefined;
    let authErrorClass: string | undefined;

    if (!token) {
      authErrorClass = 'MissingAuthorizationHeader';
    } else {
      try {
        const parts = token.split('.');
        if (parts.length !== 3) {
          authErrorClass = 'MalformedJWT';
        } else {
          // Base64URL → UTF-8 JSON. Handle URL-safe chars and padding.
          const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
          const json = atob(b64 + pad);
          const payload = JSON.parse(json);
          const sub = typeof payload?.sub === 'string' ? payload.sub : undefined;
          if (!sub) {
            authErrorClass = 'JWTMissingSub';
          } else {
            userId = sub;
          }
        }
      } catch (err) {
        authErrorClass = `JWTDecodeFailed:${(err as Error).name || 'Error'}`;
      }
    }

    // ── TIER GATING (tolerant) ─────────────────────────────────────────────
    // ORCH-0474: Tier failure MUST NEVER degrade to path:'pool-empty' or
    // path:'pipeline-error'. Fall back to 'free' on any failure. Tier gating
    // is a UX enhancement, not a correctness gate for the pool serve.
    let effectiveTier: string = 'free';
    if (userId) {
      try {
        const { data: tierData, error: tierError } = await supabaseAdmin.rpc('get_effective_tier', { p_user_id: userId });
        if (tierError) {
          console.warn(`[discover-cards] get_effective_tier error (tolerating as 'free'): ${tierError.message}`);
        } else if (typeof tierData === 'string') {
          effectiveTier = tierData;
        }
      } catch (err) {
        console.warn(`[discover-cards] get_effective_tier threw (tolerating as 'free'): ${(err as Error).message}`);
      }
    }

    // Note: curated cards are now fully visible to all tiers.
    // Save-gating is handled client-side (free users can view but not save).

    // ── Calculate search radius from travel constraint ────────────────────
    const maxDistKm = (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3;
    const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);

    // ORCH-0634: scorePoolCards removed. The new signal-serving path uses
    // signal_score as matchScore directly — re-scoring with chip-match heuristics
    // would discard the signal ranking. Solo deck order = signal_score DESC
    // (per-chip) → round-robin interleave. Collab deck order = deterministic
    // place_id sort with matchScore=0 (collab parity preserved).

    // ── Response helper for the three non-populated paths ────────────────
    // ORCH-0474: Single builder avoids drift between pool-empty / auth-required /
    // pipeline-error. Keeps sourceBreakdown shape consistent. Closes over
    // batchSeed, categories, corsHeaders — must stay inside the serve() handler.
    function buildEmptyResponse(args: {
      path: 'pool-empty' | 'auth-required' | 'pipeline-error';
      reason: string;
      errorClass?: string;
      errorKey?: string;
      httpStatus: number;
    }): Response {
      const body: Record<string, any> = {
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
          reason: args.reason,
          path: args.path,
        },
      };
      if (args.errorClass) body.sourceBreakdown.errorClass = args.errorClass;
      if (args.errorKey) body.error = args.errorKey;
      return new Response(JSON.stringify(body), {
        status: args.httpStatus,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Warm-pool short-circuit (unchanged) ──────────────────────────────
    if (userId && body.warmPool) {
      return new Response(
        JSON.stringify({ cards: [], total: 0, source: 'disabled', message: 'Warm pool is disabled. Pool is admin-managed.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── AUTH-REQUIRED exit ─────────────────────────────────────────────────
    // ORCH-0474 / INV-042: Never degrade auth failure to 'pool-empty'. With
    // verify_jwt:true this should not happen in production — its occurrence
    // indicates platform-level misconfiguration or JWT tampering. HTTP 401
    // surfaces that to the client honestly so it can trigger a retry.
    if (!userId) {
      const elapsed = Date.now() - t0;
      console.warn(`[discover-cards] exit path=auth-required userId=absent elapsed_ms=${elapsed} errorClass=${authErrorClass ?? 'Unknown'}`);
      return buildEmptyResponse({
        path: 'auth-required',
        reason: 'Authentication required — token missing, malformed, or sub claim absent',
        errorClass: authErrorClass,
        errorKey: 'auth_required',
        httpStatus: 401,
      });
    }

    // ─── ORCH-0634: Signal-only multi-chip fan-out (replaces card_pool fallback) ──
    //
    // For EVERY chip the user selected, fire its signal RPC(s) in parallel, group
    // results per-chip (max signal_score dedupe), then round-robin one-card-per-chip
    // across buckets for the final deck order. Date/time + curated-hours filters
    // still apply. Collab mode still uses deterministic sort (zero matchScore).
    //
    // After this block there is NO card_pool fallback. Card_pool is deprecated;
    // see ORCH-0640 cleanup.
    //
    // INV-042 / INV-043 preserved:
    //   - pool-empty: all RPCs succeeded, total result set is empty
    //   - pipeline-error: every RPC errored (total failure)
    //   - partial failure: some RPCs errored, others succeeded → proceed with
    //     what we have + warn log (Constitution #3 — no silent failures)

    // Step 1: resolve chips → signal targets. Drop chips without signal mapping
    // (defensive — log but don't explode).
    type ChipTarget = {
      chip: string;            // canonical chip display (e.g. 'Brunch')
      displayCategory: string; // label to attach to cards (from CATEGORY_TO_SIGNAL)
      signalIds: string[];     // 1 or more signal IDs to union within this chip
      filterMin: number;
    };
    const chipTargets: ChipTarget[] = [];
    for (const chip of categories) {
      const mapping = CATEGORY_TO_SIGNAL[chip];
      if (!mapping) {
        console.warn(`[discover-cards] chip="${chip}" has no CATEGORY_TO_SIGNAL entry — skipping (not falling back to card_pool)`);
        continue;
      }
      chipTargets.push({
        chip,
        displayCategory: mapping.displayCategory,
        signalIds: [...mapping.signalIds],
        filterMin: mapping.filterMin,
      });
    }

    if (chipTargets.length === 0) {
      const elapsed = Date.now() - t0;
      console.log(`[discover-cards] exit path=pool-empty reason=no_mapped_chips chips=[${categories.join(',')}] elapsed_ms=${elapsed}`);
      return buildEmptyResponse({
        path: 'pool-empty',
        reason: 'No selected chips have signal mappings — verify CATEGORY_TO_SIGNAL coverage',
        httpStatus: 200,
      });
    }

    // Step 2: cohort-check each unique signalId once (cached 60s, cheap).
    // "Any signal in-cohort" fires the new path for that chip; if a chip's
    // signals are all flagged to 0 the chip returns empty (caller falls back to
    // the interleave serving zero results for that chip — other chips continue).
    const uniqueSignalIds = [...new Set(chipTargets.flatMap((t) => t.signalIds))];
    const cohortByPct = new Map<string, { pct: number; inCohort: boolean }>();
    await Promise.all(
      uniqueSignalIds.map(async (sig) => {
        const pct = await getSignalServingPct(supabaseAdmin, sig);
        cohortByPct.set(sig, { pct, inCohort: isInCohort(userId, pct) });
      }),
    );

    // Step 3: build flat list of RPC tasks (one per chip × signalId where in-cohort).
    type RpcTask = { chip: string; signalId: string; filterMin: number; displayCategory: string };
    const rpcTasks: RpcTask[] = [];
    for (const t of chipTargets) {
      for (const sig of t.signalIds) {
        if (cohortByPct.get(sig)?.inCohort) {
          rpcTasks.push({
            chip: t.chip,
            signalId: sig,
            filterMin: t.filterMin,
            displayCategory: t.displayCategory,
          });
        }
      }
    }

    if (rpcTasks.length === 0) {
      const elapsed = Date.now() - t0;
      console.log(`[discover-cards] exit path=pool-empty reason=no_signals_in_cohort chips=[${categories.join(',')}] elapsed_ms=${elapsed}`);
      return buildEmptyResponse({
        path: 'pool-empty',
        reason: 'No selected chips have a signal in cohort — flip signal_serving_*_pct=100 in admin_config',
        httpStatus: 200,
      });
    }

    // Step 4: fire all RPCs in parallel. Over-fetch per chip (limit × 2) so
    // round-robin has depth; final cap is `limit`.
    const perChipRpcLimit = Math.max(20, Math.min(100, limit * 2));
    const rpcResults = await Promise.all(
      rpcTasks.map((task) =>
        supabaseAdmin.rpc('query_servable_places_by_signal', {
          p_signal_id: task.signalId,
          p_filter_min: task.filterMin,
          p_lat: location.lat,
          p_lng: location.lng,
          p_radius_m: radiusMeters,
          p_exclude_place_ids: excludeCardIds,
          p_limit: perChipRpcLimit,
        }).then((res) => ({ task, res })),
      ),
    );

    // Step 5: bucket results by chip, merging within a chip by place_id max-score.
    // Skip failed RPCs but keep going (partial failure tolerance).
    const perChipBuckets = new Map<string, Map<string, any>>(); // chip → place_id → row
    const failedTasks: string[] = [];
    for (const { task, res } of rpcResults) {
      if (res.error) {
        failedTasks.push(`${task.chip}/${task.signalId}: ${res.error.message}`);
        continue;
      }
      let bucket = perChipBuckets.get(task.chip);
      if (!bucket) {
        bucket = new Map<string, any>();
        perChipBuckets.set(task.chip, bucket);
      }
      for (const row of (res.data as any[]) ?? []) {
        const existing = bucket.get(row.place_id);
        if (!existing || Number(row.signal_score) > Number(existing.signal_score)) {
          // Attach displayCategory from the winning chip (preserved through interleave)
          bucket.set(row.place_id, { ...row, __displayCategory: task.displayCategory });
        }
      }
    }

    // Step 6: total-failure guard — every RPC errored → pipeline-error.
    if (failedTasks.length === rpcTasks.length) {
      const elapsed = Date.now() - t0;
      const truncated = failedTasks.slice(0, 3).join(' | ').slice(0, 200);
      console.error(`[discover-cards] exit path=pipeline-error reason=all_rpcs_failed failed=${failedTasks.length} elapsed_ms=${elapsed} sample="${truncated}"`);
      return buildEmptyResponse({
        path: 'pipeline-error',
        reason: `All ${rpcTasks.length} signal RPCs failed: ${truncated}`,
        errorClass: 'SignalRpcError',
        errorKey: 'pipeline_error',
        httpStatus: 500,
      });
    }
    if (failedTasks.length > 0) {
      console.warn(`[discover-cards] partial signal-RPC failure ok=${rpcTasks.length - failedTasks.length}/${rpcTasks.length} sample="${failedTasks.slice(0, 2).join(' | ').slice(0, 200)}"`);
    }

    // Step 7: within each chip, sort by signal_score DESC (caller pre-sort so
    // round-robin is deterministic). Preserve the user's chip-selection order
    // from `categories` by reinserting in a fresh Map in that order.
    const perChipSorted = new Map<string, any[]>();
    for (const chip of categories) {
      const bucket = perChipBuckets.get(chip);
      if (!bucket || bucket.size === 0) continue;
      const arr = [...bucket.values()].sort(
        (a, b) => Number(b.signal_score ?? 0) - Number(a.signal_score ?? 0),
      );
      perChipSorted.set(chip, arr);
    }

    // Step 8: round-robin one-card-per-chip, cap at `limit`.
    const interleavedRows = roundRobinByChip({ perChip: perChipSorted, totalLimit: limit });

    if (interleavedRows.length === 0) {
      const elapsed = Date.now() - t0;
      console.log(`[discover-cards] exit path=pool-empty reason=zero_rows_post_filter chips=[${categories.join(',')}] elapsed_ms=${elapsed}`);
      return buildEmptyResponse({
        path: 'pool-empty',
        reason: 'Signal RPCs succeeded but returned zero rows — try widening radius or adding chips',
        httpStatus: 200,
      });
    }

    // Step 9: transform to card shape (carries winning displayCategory).
    // ORCH-0659/0660: pass user location + travel mode so transformer computes
    // honest haversine distance + per-mode travel-time. Track null-coord rows
    // for one aggregated warning per request.
    let _placesMissingCoords = 0;
    const rawCards = interleavedRows.map((row: any) => {
      const card = transformServablePlaceToCard(
        row,
        row.__displayCategory ?? categories[0],
        location.lat,
        location.lng,
        travelMode as TravelMode,
      );
      if (card.distanceKm === null) _placesMissingCoords++;
      return card;
    });
    if (_placesMissingCoords > 0) {
      console.warn(`[discover-cards] ${_placesMissingCoords}/${rawCards.length} places had null lat/lng — distance/travelTime set to null`);
    }

    // Step 10: date/time + curated-hours filter (preserved from legacy path).
    const timeFilteredCards = dateWindows && dateWindows.length > 0
      ? filterByDateWindows(rawCards, dateWindows, datetimePref, selectedDates)
      : filterByDateTime(rawCards, datetimePref, dateOption, selectedDates);
    const curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date();
    const hoursFilteredCards = filterCuratedByStopHours(timeFilteredCards, curatedUtcNow);

    // Step 11: preserve collab deterministic order (zero out matchScore) OR
    // keep signal-score ranked order for solo. We DO NOT call scorePoolCards
    // here because the signal_score IS the match score — re-scoring would
    // throw away the signal ranking in favor of chip-match heuristics.
    const finalCards = sessionId
      ? hoursFilteredCards
          .sort((a: any, b: any) => (a.id ?? '').localeCompare(b.id ?? ''))
          .map((card: any) => ({ ...card, matchScore: 0 }))
      : hoursFilteredCards;

    const elapsed = Date.now() - t0;
    const perChipBreakdown: Record<string, number> = {};
    for (const [chip, arr] of perChipSorted) perChipBreakdown[chip] = arr.length;
    const filterMins: Record<string, number> = {};
    for (const t of chipTargets) filterMins[t.chip] = t.filterMin;
    console.log(`[discover-cards] exit path=pipeline source=signal-serving-v2-multi-chip chips=${categories.length} rpcs=${rpcTasks.length} failed=${failedTasks.length} pre=${rawCards.length} post=${finalCards.length} elapsed_ms=${elapsed} mode=${sessionId ? 'collab' : 'solo'}`);

    return new Response(JSON.stringify({
      success: true,
      cards: finalCards,
      total: finalCards.length,
      source: 'signal-serving-v2-multi-chip',
      metadata: {
        hasMore: finalCards.length === limit,
        poolSize: finalCards.length,
        batchSeed: batchSeed ?? 0,
        perChipBreakdown,
      },
      sourceBreakdown: {
        fromPool: finalCards.length,
        fromApi: 0,
        totalServed: finalCards.length,
        apiCallsMade: 0,
        cacheHits: 0,
        gapCategories: [],
        reason: `Signal-served v2 multi-chip: ${categories.length} chips, ${rpcTasks.length} RPCs (${failedTasks.length} failed)`,
        path: 'pipeline',
        signalIds: uniqueSignalIds,
        cohort: 'NEW',
        filterMins,
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
