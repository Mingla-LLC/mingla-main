// ─────────────────────────────────────────────────────────────────────────────
// curatedStopHours.ts — Shared open-during-the-outing cascade for curated cards.
//
// ORCH-1061 PART 2: extracted (single source of truth, Constitution #6) from
// discover-cards/index.ts so BOTH the collab path (discover-cards) and the
// SOLO path (generate-curated-experiences) inherit the SAME open-hours gate.
//
// Before ORCH-1061 the solo curated path (generate-curated-experiences called
// directly by deckService.ts) applied NO open-hours filter — so a solo user
// could be served a curated plan whose stop was closed when they'd arrive.
// Collab cards (via discover-cards) did get filtered, but the reader only ever
// looked at the legacy text-shape hours, so it was largely a no-op (D-1 below).
//
// D-1 FIX (correctness, not just a move): the prior `isStopOpenAtHour` ONLY read
// the text-based lowercase-day shape (`openingHours[dayName]` → parseHoursText).
// place_pool.opening_hours is the UNWRAPPED Google v1 shape
// ({ openNow, periods, weekdayDescriptions, … }) for ~99.9% of rows, so the old
// reader fell through to its "no dayText → assume open" branch for almost every
// row — i.e. the curated hours filter barely filtered anything. This module
// reads `periods` first (canonical Google v1), then legacy `_periods`, then the
// text fallback — mirroring the all-shape-tolerant filterByDateTime.isOpenAtHour
// (discover-cards:285-335). Same bug class ORCH-1019 fixed on the mobile client
// (I-CURATED-HOURS-VIA-CANONICAL-READER).
//
// Honest-unknown rule (Constitution #9, LOCKED): genuinely no hours data
// (no periods, no _periods, no day text) → assume OPEN. Curated cards are
// precious; never fabricate "closed" for a venue we simply lack data on.
//
// ORCH-1068 [business-authored venues render on deck]: business venues persist
// hours as a top-level array [{weekday(0=Mon),isClosed,openTime,closeTime}].
// isStopOpenAtHour gains an array branch (after the honest-unknown check, before
// the `.periods` branch) that converts via businessHoursToGoogleOpeningHours
// (day = (weekday+1)%7) so a curated stop that is a business venue is gated
// correctly — open during its hours, closed on its explicit closed days.
// ─────────────────────────────────────────────────────────────────────────────

import {
  businessHoursToGoogleOpeningHours,
  isBusinessHoursArray,
} from './businessHoursToGoogle.ts';

/** Parse a single time range like "9:00 AM – 5:00 PM" or "5:00 – 9:30 PM" (Google PM-only format).
 *  Returns { open, close } in fractional 24h hours, or null if unparseable.
 *  Handles overnight wraparound: "5 PM - 2 AM" → { open: 17, close: 26 }. */
export function parseSingleRange(range: string): { open: number; close: number } | null {
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
export function parseHoursText(text: string): { open: number; close: number }[] | null {
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
export function hourInRanges(hour: number, ranges: { open: number; close: number }[]): boolean {
  return ranges.some((r) => hour >= r.open && hour < r.close);
}

export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ── Curated stop duration table (minutes), keyed by Google primary type ──────
export const CURATED_STOP_DURATION: Record<string, number> = {
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

export const ALWAYS_OPEN_TYPES: ReadonlySet<string> = new Set([
  'park', 'national_park', 'state_park', 'hiking_area', 'beach',
  'botanical_garden', 'city_park', 'garden', 'nature_preserve',
  'picnic_ground', 'scenic_spot', 'tourist_attraction', 'plaza',
  'lake', 'river', 'woods', 'mountain_peak',
]);

// ── Hours evaluation cascade (ORCH-1061 D-1 FIX) ─────────────────────────────
// Evaluate a periods array (same shape whether `periods` or `_periods`) against
// a target day + fractional hour. Mirrors filterByDateTime.isOpenAtHour's
// evalPeriods (discover-cards:306-315): minute-aware, midnight + overnight safe.
function evalPeriods(
  periodsArr: Array<{ open?: { day?: number; hour?: number; minute?: number }; close?: { hour?: number; minute?: number } }>,
  day: number,
  hourFrac: number,
): boolean {
  return periodsArr.some((period) => {
    if (period.open?.day !== day) return false;
    const openH = (period.open?.hour ?? 0) + (period.open?.minute ?? 0) / 60;
    let closeH = (period.close?.hour ?? 24) + (period.close?.minute ?? 0) / 60;
    if (closeH === 0) closeH = 24;
    if (closeH <= openH) closeH += 24;
    return hourFrac >= openH && hourFrac < closeH;
  });
}

/**
 * Is this curated stop open at `hour` (fractional 24h) on `dayOfWeek` (0=Sun)?
 *
 * ORCH-1061 D-1 cascade (LOCKED), honest-unknown → OPEN:
 *  1. ALWAYS_OPEN_TYPES → true.
 *  2. No openingHours object → true (honest-unknown).
 *  3. Path A — canonical Google v1 `periods` (the ~99.9% shape).  ← D-1 FIX
 *  4. Path B — legacy `_periods`.
 *  5. Path C — text shape (lowercase day key → parseHoursText). Missing day text
 *     → true (honest-unknown); "Closed"/unparseable → false; else hourInRanges.
 */
export function isStopOpenAtHour(stop: any, hour: number, dayOfWeek: number): boolean {
  // 1. Always-open outdoor types.
  const pType = stop.placeType || '';
  if (ALWAYS_OPEN_TYPES.has(pType)) return true;

  // 2. No data → assume open (honest-unknown).
  const oh = stop.openingHours;
  if (!oh || typeof oh !== 'object') return true;

  // 2b. ORCH-1068 — business-authored array shape [{weekday(0=Mon),isClosed,…}].
  // An array with ≥1 explicit row is real data: convert to Google-day periods and
  // evaluate. An array whose only data for `dayOfWeek` is a closed/absent day
  // correctly returns false on that day (not honest-unknown — the closure is
  // explicit). An all-empty/all-unparseable array yields periods:[] → false on
  // every day (the rows existed but carried no usable hours).
  if (isBusinessHoursArray(oh)) {
    return evalPeriods(businessHoursToGoogleOpeningHours(oh).periods, dayOfWeek, hour);
  }

  // 3. Path A — canonical Google v1 `periods` (D-1 FIX: prior reader skipped this).
  if (Array.isArray(oh.periods) && oh.periods.length > 0) {
    return evalPeriods(oh.periods, dayOfWeek, hour);
  }

  // 4. Path B — legacy underscore-prefixed `_periods`.
  if (Array.isArray(oh._periods) && oh._periods.length > 0) {
    return evalPeriods(oh._periods, dayOfWeek, hour);
  }

  // 5. Path C — text shape (legacy lowercase-day rows).
  const dayName = DAY_NAMES[dayOfWeek];
  const dayText = oh[dayName];
  if (!dayText) return true; // No data for this day → honest-unknown → open.

  const parsed = parseHoursText(dayText);
  if (!parsed) return false; // "Closed" or unparseable.
  return hourInRanges(hour, parsed);
}

/**
 * Drop curated cards whose any non-optional stop is CLOSED at the time the user
 * would actually arrive there (start time + cumulative prior-stop duration +
 * travel). Idempotent: re-filtering an already-open card is a no-op.
 *
 * Extracted byte-for-behavior from discover-cards/index.ts:504-532 (it now calls
 * the D-1-fixed isStopOpenAtHour above). utcOffsetMinutes fallback, per-stop
 * duration accumulation, and optional-stop skip are unchanged.
 */
export function filterCuratedByStopHours(cards: any[], utcNow: Date): any[] {
  return cards.filter((card) => {
    if (card.cardType !== 'curated' || !card.stops?.length) return true;

    // Compute place-local start time using card's timezone offset.
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
