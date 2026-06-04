import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SEEDING_CATEGORY_MAP } from '../_shared/seedingCategories.ts';
import { googleLevelToTierSlug, slugMeetsMinimum } from '../_shared/priceTiers.ts';
import { timeoutFetch } from '../_shared/timeoutFetch.ts';
import { haversineKm, estimateTravelMinutes, radiusKmForConstraint } from '../_shared/distanceMath.ts';
// ORCH-0707: signal-rank helper + maps moved to _shared/signalRankFetch.ts
// (single source of truth shared with stopAlternatives.ts).
import {
  fetchSinglesForSignalRank,
  COMBO_SLUG_TO_FILTER_SIGNAL,
  COMBO_SLUG_TYPE_FILTER,
  COMBO_SLUG_FILTER_MIN,
  resolvePrimaryTypeGate,
} from '../_shared/signalRankFetch.ts';
// ORCH-0707: duration map centralised in _shared/curatedConstants.ts.
import {
  CATEGORY_DURATION_MINUTES,
  CATEGORY_DEFAULT_DURATION,
} from '../_shared/curatedConstants.ts';
// ORCH-1061 PART 2: shared open-during-the-outing cascade. The SOLO curated path
// (this fn, called directly by deckService.ts) previously applied NO open-hours
// filter — solo users could be served a plan whose stop was closed on arrival.
// Now solo inherits the SAME gate collab already gets via discover-cards.
import { filterCuratedByStopHours } from '../_shared/curatedStopHours.ts';

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

// ─── ORCH-1071 [experiences-on-curated-path] ──────────────────────────────────
// The "See curated experiences" path calls THIS fn per curated pill with
// experienceType = the pill id. ORCH-1065 wired brand experiences into the PLACES
// path (discover-cards) only, so a user who turns on "See curated experiences" and
// picks a vibe (Romantic / First Dates / Group Fun / Adventurous) never saw the
// matching brand experience. ORCH-1071 front-loads eligible brand experiences here
// too — same RPC, same envelope, same client converter as ORCH-1065. NO parallel
// money fn (booking stays via ticket-checkout-create — COMMS-0014/0016).
//
// Bypasses place_pool / ai_signal_scores / run-signal-scorer ENTIRELY (the
// COMMS-0018 signal_id-buggy venue→deck path): reads ONLY events + experience_stops
// via the pg_eligible_experiences_for_deck RPC (service-role, ORCH-1070 strict-gated).
//
// Best-effort: a failure here MUST NOT break AI curated generation. Brand
// experiences front-load ONLY for the 4 brand intents (the AI strolls still run);
// every other experienceType (picnic-dates / take-a-stroll / anything non-brand)
// is skipped.

// The 4 curated pill ids that map to brand experience intents. picnic-dates and
// take-a-stroll have NO brand-experience analog, so they are skipped.
const CURATED_BRAND_EXPERIENCE_INTENTS = new Set([
  'adventurous', 'first-date', 'romantic', 'group-fun',
]);

// Server card envelope pushed at the FRONT of the curated cards[] for each
// eligible experience. IDENTICAL shape to the discover-cards ExperienceDeckCard
// envelope — the client converter (deckService.experienceCardToRecommendation)
// decodes BOTH paths the same way (no parallel system).
interface CuratedExperienceDeckCard {
  cardType: 'experience';
  id: string;
  eventId: string;
  experienceType: string;
  title: string;
  tagline: string;
  // ORCH-1072: IDENTICAL to discover-cards ExperienceDeckCard — real cover +
  // description + upcoming occurrences threaded through the curated path too.
  description: string;
  coverMediaUrl: string | null;
  coverMediaType: 'image' | 'video' | 'gif' | null;
  brandId: string;
  brandName: string;
  brandSlug: string;
  brandLogoUrl: string | null;
  eventSlug: string;
  totalPriceMin: number;
  totalPriceMax: number;
  currency: string;
  masterDateUtc: string | null;
  masterEndAtUtc: string | null;
  timezone: string;
  upcomingOccurrences: Array<{
    eventDateId: string;
    startAt: string;
    endAt: string;
    capacity: number | null;
    sold: number;
    remaining: number | null;
  }>;
  stops: Array<{
    stopNumber: number;
    placeId: string;
    placeName: string;
    address: string;
    imageUrl: string;
    imageUrls: string[];
    aiDescription: string;
    lat: number;
    lng: number;
    priceMin: number;
    priceMax: number;
    rating: number;
    reviewCount: number;
    distanceFromUserKm: number | null;
    travelTimeFromUserMin: number | null;
  }>;
  estimatedDurationMinutes: number;
  matchScore: number;
}

// ORCH-1072: decode upcoming_occurrences jsonb → camelCase envelope shape.
// IDENTICAL to discover-cards.mapExperienceOccurrences (no parallel system —
// both paths decode the SAME RPC output the SAME way).
function mapExperienceOccurrences(raw: unknown): Array<{
  eventDateId: string;
  startAt: string;
  endAt: string;
  capacity: number | null;
  sold: number;
  remaining: number | null;
}> {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((o: any) => {
      const eventDateId = typeof o?.event_date_id === 'string' ? o.event_date_id : '';
      const startAt = o?.start_at ? String(o.start_at) : '';
      if (eventDateId.length === 0 || startAt.length === 0) return null;
      return {
        eventDateId,
        startAt,
        endAt: o?.end_at ? String(o.end_at) : '',
        capacity: typeof o?.capacity === 'number' ? o.capacity : null,
        sold: typeof o?.sold === 'number' ? o.sold : 0,
        remaining: typeof o?.remaining === 'number' ? o.remaining : null,
      };
    })
    .filter((o): o is {
      eventDateId: string;
      startAt: string;
      endAt: string;
      capacity: number | null;
      sold: number;
      remaining: number | null;
    } => o !== null);
}

// Single service-role round-trip to pg_eligible_experiences_for_deck for ONE
// brand intent (the curated pill). Maps each row into the SAME envelope shape
// discover-cards emits. Throws on RPC error (the caller swallows best-effort so
// an experience-source failure never degrades the AI curated generation).
async function fetchEligibleExperiencesForCurated(args: {
  lat: number;
  lng: number;
  radiusMeters: number;
  experienceType: string;
  nowIso: string;
  excludeEventIds: string[];
  limit: number;
}): Promise<CuratedExperienceDeckCard[]> {
  const { data, error } = await (supabaseAdmin as any).rpc(
    'pg_eligible_experiences_for_deck',
    {
      p_lat: args.lat,
      p_lng: args.lng,
      p_radius_m: args.radiusMeters,
      // Filter to exactly the pill's intent (one element). The RPC returns every
      // experience whose experience_intents && p_intents.
      p_intents: [args.experienceType],
      p_now: args.nowIso,
      p_exclude_ids: args.excludeEventIds,
      p_limit: Math.min(Math.max(args.limit, 0), 30),
    },
  );
  if (error) {
    throw new Error(`pg_eligible_experiences_for_deck failed: ${error.message}`);
  }
  const rows = (data as any[]) ?? [];
  return rows.map((row): CuratedExperienceDeckCard => {
    const rawStops = Array.isArray(row.stops) ? row.stops : [];
    const stops = rawStops.map((s: any) => {
      const imageUrls: string[] = Array.isArray(s.image_urls) ? s.image_urls : [];
      const lat = typeof s.lat === 'number' ? s.lat : 0;
      const lng = typeof s.lng === 'number' ? s.lng : 0;
      const distanceKm =
        typeof s.lat === 'number' && typeof s.lng === 'number'
          ? haversineKm(args.lat, args.lng, lat, lng)
          : null;
      const priceMajor = Math.round((Number(s.price_cents) || 0)) / 100;
      return {
        stopNumber: (Number(s.stop_order) || 0) + 1,
        placeId: typeof s.place_id === 'string' ? s.place_id : String(s.place_id ?? ''),
        placeName: typeof s.place_name === 'string' ? s.place_name : '',
        address: typeof s.address === 'string' ? s.address : '',
        imageUrl: imageUrls[0] ?? '',
        imageUrls: imageUrls.slice(0, 5),
        aiDescription: typeof s.ai_description === 'string' ? s.ai_description : '',
        lat,
        lng,
        priceMin: priceMajor,
        priceMax: priceMajor,
        // Experiences carry no Google rating — honest 0, never fabricated.
        rating: 0,
        reviewCount: 0,
        distanceFromUserKm: distanceKm,
        travelTimeFromUserMin: null,
      };
    });
    const totalMajor = Math.round((Number(row.total_price_cents) || 0)) / 100;
    const intentsArr: string[] = Array.isArray(row.experience_intents)
      ? row.experience_intents
      : [];
    return {
      cardType: 'experience',
      id: String(row.event_id),
      eventId: String(row.event_id),
      // Prefer the pill's own intent when the experience carries it, else the
      // experience's first declared intent (mirrors discover-cards).
      experienceType: intentsArr.includes(args.experienceType)
        ? args.experienceType
        : (intentsArr[0] ?? args.experienceType),
      title: typeof row.title === 'string' ? row.title : '',
      tagline: typeof row.tagline === 'string' ? row.tagline : '',
      // ORCH-1072: real description + cover + occurrences (same as discover-cards).
      description: typeof row.description === 'string' ? row.description : '',
      coverMediaUrl:
        typeof row.cover_media_url === 'string' && row.cover_media_url.length > 0
          ? row.cover_media_url
          : null,
      coverMediaType:
        row.cover_media_type === 'image' ||
        row.cover_media_type === 'video' ||
        row.cover_media_type === 'gif'
          ? row.cover_media_type
          : null,
      upcomingOccurrences: mapExperienceOccurrences(row.upcoming_occurrences),
      brandId: String(row.brand_id),
      brandName: typeof row.brand_name === 'string' ? row.brand_name : '',
      brandSlug: typeof row.brand_slug === 'string' ? row.brand_slug : '',
      brandLogoUrl:
        typeof row.brand_logo_url === 'string' && row.brand_logo_url.length > 0
          ? row.brand_logo_url
          : null,
      eventSlug: typeof row.event_slug === 'string' ? row.event_slug : '',
      totalPriceMin: totalMajor,
      totalPriceMax: totalMajor,
      currency:
        typeof row.currency === 'string' && row.currency.trim().length > 0
          ? row.currency.trim()
          : 'USD',
      masterDateUtc: row.master_date_utc ? String(row.master_date_utc) : null,
      masterEndAtUtc: row.master_end_at_utc ? String(row.master_end_at_utc) : null,
      timezone: typeof row.timezone === 'string' ? row.timezone : 'UTC',
      stops,
      estimatedDurationMinutes: 0,
      matchScore: 85,
    };
  });
}

// Front-load the brand experiences at the HEAD of the curated cards array,
// ahead of the AI cardType:'curated' cards, deduped by id. Additive — AI cards
// are never displaced or dropped.
function frontLoadCuratedExperiences(
  aiCards: any[],
  experienceCards: CuratedExperienceDeckCard[],
): any[] {
  if (experienceCards.length === 0) return aiCards;
  const seen = new Set<string>();
  const deduped: CuratedExperienceDeckCard[] = [];
  for (const exp of experienceCards) {
    if (!seen.has(exp.id)) {
      seen.add(exp.id);
      deduped.push(exp);
    }
  }
  return [...deduped, ...aiCards];
}
// ─── end ORCH-1071 ────────────────────────────────────────────────────────────

// ── Session preference aggregation (for collaboration mode) ────────────────

const SESSION_INTENT_IDS = new Set([
  'adventurous', 'first-date', 'romantic', 'group-fun', 'picnic-dates', 'take-a-stroll',
]);

// ORCH-0434: budgetMin/budgetMax removed from return type.
//
// ORCH-0908 hotfix (2026-05-21): rewritten to call the ORCH-0902 SQL helper
// pg_aggregate_collab_prefs instead of the dead table board_session_preferences
// (which never existed in production). The SQL helper reads from
// collaboration_sessions.participant_prefs JSONB + session_participants and
// returns a canonical aggregated jsonb already used by discover-cards/v2.
//
// Return-shape preserved exactly so downstream callers (generateCardsForType,
// keep-warm, get-person-hero-cards) are unaffected.
//
// Mapping from pg_aggregate_collab_prefs JSONB to this function's contract:
//   - categories            ← agg.categories filtered to exclude SESSION_INTENT_IDS
//   - experienceTypes       ← agg.intents (or fallback to categories matching SESSION_INTENT_IDS)
//   - travelMode            ← most common across agg.circles[].travel_mode
//   - travelConstraintValue ← MIN across agg.circles[].time_min (most restrictive wins)
//   - datetimePref          ← agg.datetimePref (earliest among accepted participants)
//   - location              ← centroid of agg.circles[].lat/lng (or null if no circles)
async function aggregateSessionPreferences(sessionId: string): Promise<{
  categories: string[];
  experienceTypes: string[];
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintValue: number;
  datetimePref?: string;
  location: { lat: number; lng: number } | null;
}> {
  const { data: agg, error } = await (supabaseAdmin as any).rpc(
    'pg_aggregate_collab_prefs',
    { p_session_id: sessionId },
  );

  if (error || !agg) {
    throw new Error(
      `pg_aggregate_collab_prefs failed for session ${sessionId}: ${error?.message ?? 'no data'}`,
    );
  }

  // pg_aggregate_collab_prefs returns empty arrays when acceptedCount < 2
  // (CR-8 session-start threshold). Treat as "no preferences" to preserve
  // the original throw-on-empty contract.
  const acceptedCount =
    typeof (agg as Record<string, unknown>).acceptedCount === 'number'
      ? ((agg as Record<string, unknown>).acceptedCount as number)
      : 0;
  if (acceptedCount === 0) {
    throw new Error(
      `No preferences found for session ${sessionId} (acceptedCount=0)`,
    );
  }

  const aggCats = Array.isArray((agg as Record<string, unknown>).categories)
    ? ((agg as Record<string, unknown>).categories as string[])
    : [];
  const aggIntents = Array.isArray((agg as Record<string, unknown>).intents)
    ? ((agg as Record<string, unknown>).intents as string[])
    : [];
  const aggCircles = Array.isArray((agg as Record<string, unknown>).circles)
    ? ((agg as Record<string, unknown>).circles as Array<{
        user_id: string;
        lat: number;
        lng: number;
        travel_mode: string;
        time_min: number;
        radius_m: number;
      }>)
    : [];
  const aggDatetimePref =
    typeof (agg as Record<string, unknown>).datetimePref === 'string'
      ? ((agg as Record<string, unknown>).datetimePref as string)
      : undefined;

  const categories = aggCats.filter((c) => !SESSION_INTENT_IDS.has(c));
  const experienceTypes =
    aggIntents.length > 0
      ? aggIntents
      : aggCats.filter((c) => SESSION_INTENT_IDS.has(c));

  // Most common travel_mode across participant circles (mode aggregation
  // preserved from the original logic).
  const modeCounts: Record<string, number> = {};
  for (const circle of aggCircles) {
    const m = circle.travel_mode || 'walking';
    modeCounts[m] = (modeCounts[m] || 0) + 1;
  }
  const travelMode =
    Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    'walking';

  // MIN of time_min across circles — most restrictive participant wins
  // (matches pre-ORCH-0902 semantics that the old aggregation followed).
  const travelConstraintValue =
    aggCircles.length > 0
      ? Math.min(...aggCircles.map((c) => c.time_min ?? 30))
      : 30;

  const datetimePref = aggDatetimePref;

  // Centroid of participant circles (each circle is one participant's
  // location). Per-participant union vs centroid is a tradeoff: the
  // ORCH-0902 deck-v2 path uses true union via Haversine; curated cards
  // still use a centroid because the curated multi-stop pipeline needs
  // a single anchor point. Acceptable simplification.
  let location: { lat: number; lng: number } | null = null;
  if (aggCircles.length > 0) {
    location = {
      lat: aggCircles.reduce((s, c) => s + c.lat, 0) / aggCircles.length,
      lng: aggCircles.reduce((s, c) => s + c.lng, 0) / aggCircles.length,
    };
  }

  return {
    categories,
    experienceTypes,
    budgetMin: 0,
    budgetMax: 150,
    travelMode,
    travelConstraintValue,
    datetimePref,
    location,
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

// ORCH-0677: CuratedSummary surfaced when cards.length === 0 so mobile can route
// curated-only empty results to the EMPTY UI state instead of stuck-loading.
// `pool_empty` = no anchor candidates; `no_viable_anchor` = anchors existed but
// every reverse-anchor candidate failed; `pipeline_error` = caught exception.
export type CuratedEmptyReason = 'pool_empty' | 'no_viable_anchor' | 'pipeline_error';
export interface CuratedSummary {
  emptyReason: CuratedEmptyReason;
  candidateAnchorCount: number;
  failedAnchorCount: number;
}

export const EXPERIENCE_TYPES: ExperienceTypeDef[] = [
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

export const EXPERIENCE_TYPE_MAP: Record<string, ExperienceTypeDef> = {};
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

// ORCH-0707: fetchSinglesForSignalRank moved to _shared/signalRankFetch.ts
// (single source of truth shared with stopAlternatives.ts). The function
// signature now takes (supabaseAdmin, params) — the caller passes its
// already-in-scope admin client explicitly. See call site in fetchForCombo
// below for the new invocation pattern.
//
// COMBO_SLUG_TO_FILTER_SIGNAL, COMBO_SLUG_TYPE_FILTER, and the [CRITICAL —
// ORCH-0643] warning block also moved to _shared/signalRankFetch.ts.

// ORCH-1062: vibe rank-overrides removed. Every non-nature curated stop now ranks
// by its OWN filter signal (resolveStopRankSignal / fetchForCombo fall back to
// COMBO_SLUG_TO_FILTER_SIGNAL[catId] when no override exists). The two NATURE
// overrides are retained because for an OUTDOOR stop the "vibe" IS the quality
// signal: 'scenic' surfaces trails/greenways/gardens over playgrounds, and
// 'picnic_friendly' surfaces tables/shelters/lawns over hiking-heavy preserves.
// Removing the rest kills crossover leaks (e.g. a brunch café winning a "drinks"
// slot because it scored high on the generic 'lively' vibe). Do NOT re-add a
// non-nature override without an operator directive — the own-category score is
// the honest quality signal for every food/activity/drinks/show slot.
const EXPERIENCE_RANK_SIGNAL_OVERRIDE: Record<string, Record<string, string>> = {
  'take-a-stroll': { 'nature': 'scenic' },
  'picnic-dates': { 'nature': 'picnic_friendly' },
};

// ORCH-0985: resolve the vibe rank signal a stop is selected/ranked by — the
// type's EXPERIENCE_RANK_SIGNAL_OVERRIDE entry if present, else the slug's own
// filter signal. Mirrors the rankSignal computed in fetchForCombo so the value
// stamped on the stop equals the value the stop was actually ranked by.
// ORCH-1062: exported so the override-removal regression test can assert the
// resolved rank signal directly (own-category fallback for non-nature stops,
// nature overrides retained). Pure function — no side effects.
export function resolveStopRankSignal(typeId: string, catId: string): string | undefined {
  return EXPERIENCE_RANK_SIGNAL_OVERRIDE[typeId]?.[catId] ?? COMBO_SLUG_TO_FILTER_SIGNAL[catId];
}

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

// ORCH-0707: COMBO_SLUG_FILTER_MIN moved to _shared/signalRankFetch.ts.
// ORCH-0707: CATEGORY_DURATION_MINUTES + CATEGORY_DEFAULT_DURATION moved to
// _shared/curatedConstants.ts (single source of truth shared with stopAlternatives.ts).

// ── Build stop from place_pool row ─────────────────────────────────────────

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
  // ORCH-0707: comboCategory is REQUIRED. TypeScript fails compilation at any
  // call site that omits it — structural safeguard for I-CURATED-LABEL-SOURCE.
  // ORCH-0985: rankSignal is the vibe signal this stop was selected/ranked by
  // (e.g. 'romantic' for a Romantic dinner). Stamped onto the stop so the
  // Replace flow can order alternatives by the same vibe the plan was built with.
  opts: { optional?: boolean; dismissible?: boolean; comboCategory: string; rankSignal?: string },
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
    // ORCH-0707 / I-CURATED-LABEL-SOURCE: comboCategory is the authority for the
    // stop's category label. NEVER derive from place_pool.ai_categories — that
    // column is deprecated and dropped in the ORCH-0707 follow-up migration.
    placeType: opts.comboCategory,
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
    utcOffsetMinutes: card.utc_offset_minutes ?? null,
    // ORCH-0677 D-3: derive truthfully from openingHours.openNow when present.
    // Never fabricate `true` (Constitution #9). null = honestly unknown.
    isOpenNow: (() => {
      const oh = card.opening_hours;
      if (oh && (oh.openNow === true || oh.openNow === false)) return oh.openNow;
      return null;
    })(),
    website: card.website || null,
    lat,
    lng,
    distanceFromUserKm: Math.round(distFromUser * 100) / 100,
    travelTimeFromUserMin: Math.round(travelFromUser),
    travelTimeFromPreviousStopMin: travelFromPrev !== null ? Math.round(travelFromPrev) : null,
    travelModeFromPreviousStop: stopNumber > 1 ? travelMode : null,
    aiDescription: '',
    // ORCH-0707: keyed by comboCategory (per I-CURATED-LABEL-SOURCE);
    // ?? instead of || so a literal 0 isn't coerced to default (Constitution #9).
    estimatedDurationMinutes: CATEGORY_DURATION_MINUTES[opts.comboCategory] ?? CATEGORY_DEFAULT_DURATION,
    ...(opts.optional ? { optional: true } : {}),
    ...(opts.dismissible ? { dismissible: true } : {}),
    cityId: card.city_id || null,
    city: card.city || null,
    country: card.country || null,
    // ORCH-0707: aiCategories field REMOVED from wire payload (mobile CuratedStop
    // type doesn't declare it; silently dropped today). per OQ-2.
    // ORCH-0707: comboCategory always emitted (no longer conditional spread).
    comboCategory: opts.comboCategory,
    // ORCH-0985: vibe rank signal (for Replace ordering); omitted when absent.
    ...(opts.rankSignal ? { rankSignal: opts.rankSignal } : {}),
    // META-ORCH-1009 Sub-B — per-signal Gemini Q2 reasoning slice (keyed by
    // rankSignal). Omitted when unevaluated or no reasoning string. Mobile
    // ExpandedCardModal renders this in the "Why we picked this for you"
    // section. signalRankFetch.fetchSinglesForSignalRank produced this from
    // place_pool.ai_signal_scores[rankSignal].reasoning.
    ...(card.aiReasoningBySignal ? { aiReasoningBySignal: card.aiReasoningBySignal } : {}),
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

  // ORCH-0707: top-level `category` field removed from wire payload (mobile
  // CuratedExperienceCard type doesn't declare it; silently dropped today). Per OQ-3.
  // categoryLabel below is the consumed field, sourced from experience type
  // (CURATED_TYPE_LABELS) — no ai_categories read remaining anywhere in this file.

  return {
    id: `curated_${experienceType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    cardType: 'curated',
    experienceType,
    pairingKey,
    title,
    tagline,
    categoryLabel: CURATED_TYPE_LABELS[experienceType] || 'Explore',
    imageUrl: mainStops.find(s => s.imageUrl)?.imageUrl ?? null,
    // ORCH-1061 PART 2: expose first-stop timezone + coords at the card level so
    // the shared filterCuratedByStopHours can resolve the arrival timezone for
    // SOLO cards exactly as it does for collab cards (discover-cards card shape
    // already carries these). Additive top-level fields; mobile ignores unknown
    // top-level keys, and stop-level data is unchanged.
    utcOffsetMinutes: mainStops[0]?.utcOffsetMinutes ?? null,
    lat: mainStops[0]?.lat ?? null,
    lng: mainStops[0]?.lng ?? null,
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
  excludePlacePoolIds: string[] = [],
  // ORCH-1061 PART 1B: stable per-batch integer used to seed the deterministic
  // combo rotation. Threaded from the handler (was destructured but never passed
  // before ORCH-1061). Defaults to 0 so collab agg / a bad client value can't
  // break determinism. Collab decks stay reproducible (no Math.random).
  batchSeed = 0,
): Promise<{ cards: any[]; summary?: CuratedSummary }> {
  // ORCH-0903 (2026-05-21): curated path uses unified TRAVEL_CONFIG via
  // radiusKmForConstraint(generosity=1.0). Curated multi-stop trips need
  // tight, honest radius because the user traverses every stop — wider
  // generosity would yield trips with ridiculous total durations.
  const maxDistKm = radiusKmForConstraint(travelConstraintValue, travelMode, 1.0);
  const clampedRadius = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);

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
    // ORCH-0990: composite primary-type gate (flowers → primary_type='florist'
    // OR grocery/supermarket+florist-tag). undefined for every other slug, so the
    // RPC clause is a no-op and behavior is unchanged for hiking/museum/etc.
    const primaryTypeGate = resolvePrimaryTypeGate(catId);
    const filterMin = COMBO_SLUG_FILTER_MIN[catId] ?? 120;
    const rankSignal = rankOverride ?? filterSignal; // no override → rank by filter signal itself
    // ORCH-0707: helper moved to _shared/signalRankFetch.ts; pass supabaseAdmin
    // as first arg + a SignalRankParams object instead of positional arguments.
    return fetchSinglesForSignalRank(supabaseAdmin, {
      filterSignal,
      filterMin,
      rankSignal,
      centerLat: fetchLat,
      centerLng: fetchLng,
      radiusMeters: fetchRadius,
      limit: fetchLimit ?? 50,
      requiredTypes: typeFilter,
      primaryTypeRequired: primaryTypeGate?.primaryTypes,
      groceryFloralTag: primaryTypeGate?.groceryFloralTag,
      excludePlaceIds: excludePlacePoolIds,
    });
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

  // ORCH-1061 PART 1B: deterministic combo ordering that rotates the intent's
  // MAIN ACTIVITY across cards (so the deck shows variety) and descends quality,
  // seeded off batchSeed. Replaces the old Math.random shuffle (which broke
  // collab decks). The anchor PLACE still descends best→2nd→3rd across cards via
  // the existing globalUsedPlaceIds accumulation; PART 1A blends the companions.
  const comboList: string[][] = buildDeterministicComboList(typeDef, batchSeed, limit);

  // Build cards
  const cards: any[] = [];
  const globalUsedPlaceIds = new Set<string>();
  // ORCH-0677 RC-1: dead-anchor cycle prevention. Reverse-anchor types
  // (currently picnic-dates) re-pick anchorPlaces[0] every iteration when
  // the failed-anchor set is empty — leading to infinite retries on the
  // same dead candidate. Tracking failures per-request lets the loop
  // advance to the next anchor on the next iteration. Do not remove
  // without re-running T-04 fixture (see SPEC_ORCH-0677 §6).
  const failedAnchorIds = new Set<string>();
  // Capture the anchor's place_id at the top of each reverse-anchor iteration
  // so post-anchor gates (required_stops_short / travel_constraint / duplicate)
  // can mark it as failed without needing to re-derive `anchor` from scope.
  const mainStopCount = typeDef.stops.filter(s => !s.optional).length;
  // ORCH-0434: Budget filtering removed. perStopBudget set to Infinity to disable.
  const perStopBudget = Infinity;

  // ORCH-0677 §3.2: track candidate anchor count so summary can surface it
  // when cards.length === 0. Only meaningful for reverse-anchor types.
  const initialAnchorCount = hasReverseAnchor
    ? (categoryPlaces[typeDef.combos[0][typeDef.stops.findIndex(s => s.reverseAnchor)]] || []).length
    : 0;

  for (const combo of comboList) {
    // ORCH-0677: per-iteration anchor identity, set once anchor is picked.
    // Used by post-anchor gates to mark the anchor as failed.
    let currentAnchorId: string | null = null;
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
        // ORCH-0677 RC-1: also exclude anchors that have failed in a prior
        // iteration of this request — without this, anchorPlaces[0] keeps
        // re-picking the same dead anchor, producing 0 cards across all
        // limit*2 iterations.
        return !comboUsedIds.has(p.google_place_id)
          && !failedAnchorIds.has(p.google_place_id);
      });
      if (anchorPlaces.length === 0) {
        // No remaining anchor candidates (either none ever existed, or all
        // viable anchors have been marked failed in prior iterations).
        // Loop will exit on the next iteration since cards.length stays 0
        // and the comboList eventually exhausts.
        valid = false;
      }
      else {
        const anchor = anchorPlaces[0];
        currentAnchorId = anchor.google_place_id;   // ORCH-0677: for post-anchor gates
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
              travelMode, { optional: stopDef.optional, dismissible: stopDef.dismissible, comboCategory: catId, rankSignal: resolveStopRankSignal(typeDef.id, catId) },
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
            if (available.length === 0 && !stopDef.optional) {
              // ORCH-0677 RC-1: this anchor cannot complete a valid combo —
              // mark it failed so the next iteration picks a different one.
              failedAnchorIds.add(anchor.google_place_id);
              valid = false; break;
            }
            if (available.length === 0 && stopDef.optional) continue;

            // ORCH-1061 PART 1A: reverse-anchor companions blend quality+proximity.
            // 3000 = the per-card near-fetch radius used at the fetch above.
            const place = selectBlendedStop(available, prevLat, prevLng, 3000);
            if (!place && !stopDef.optional) {
              // ORCH-0677 RC-1: companion selection failed — mark anchor failed.
              failedAnchorIds.add(anchor.google_place_id);
              valid = false; break;
            }
            if (!place) continue;

            comboUsedIds.add(place.google_place_id);
            const stop = buildCardStop(
              place, stops.length + 1, typeDef.stops.length, resolveStopRole(catId, stopDef),
              lat, lng, stops.length > 0 ? prevLat : null, stops.length > 0 ? prevLng : null,
              travelMode, { optional: stopDef.optional, dismissible: stopDef.dismissible, comboCategory: catId, rankSignal: resolveStopRankSignal(typeDef.id, catId) },
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
          // Standard branch — no anchor to mark. Combo-level retry is governed
          // by the round-robin shuffle in comboList; no extra failure tracking
          // needed here since standard types have multi-combo variety.
          valid = false;
          break;
        }

        // Stop 1 (first non-optional): highest quality (UNCHANGED — vibe rank top).
        // Stop 2+: ORCH-1061 PART 1A quality+proximity blend within the fetch radius.
        const isFirstMainStop = stops.filter(s => !s.optional).length === 0;
        const place = isFirstMainStop
          ? available[0]
          : selectBlendedStop(available, prevLat, prevLng, clampedRadius);

        if (!place) {
          if (stopDef.optional) continue;
          valid = false;
          break;
        }

        comboUsedIds.add(place.google_place_id);
        const stop = buildCardStop(
          place, stops.length + 1, typeDef.stops.length, resolveStopRole(catId, stopDef),
          lat, lng, stops.length > 0 ? prevLat : null, stops.length > 0 ? prevLng : null,
          travelMode, { optional: stopDef.optional, dismissible: stopDef.dismissible, comboCategory: catId, rankSignal: resolveStopRankSignal(typeDef.id, catId) },
        );
        stops.push(stop);
        prevLat = place.lat;
        prevLng = place.lng;
      }
    }

    // Validate: must have at least the required (non-optional) stops
    const requiredStops = typeDef.stops.filter(s => !s.optional).length;
    const builtRequired = stops.filter(s => !s.optional).length;
    if (!valid || builtRequired < requiredStops) {
      // ORCH-0677 RC-1: post-validation failure for reverse-anchor types
      // marks the anchor failed so the loop progresses to the next.
      if (hasReverseAnchor && currentAnchorId) failedAnchorIds.add(currentAnchorId);
      continue;
    }

    // Validate budget
    const totalMin = stops.filter(s => !s.optional).reduce((s, st) => s + st.priceMin, 0);
    // ORCH-0434: Budget ceiling check removed — all price levels included.
    // if (totalMin > budgetMax) continue;

    // Validate travel constraint
    const firstStop = stops.find(s => !s.optional);
    if (firstStop && firstStop.travelTimeFromUserMin > travelConstraintValue * 1.5) {
      // ORCH-0677 RC-1: travel-constraint failure for reverse-anchor types
      // marks the anchor failed so the loop tries a different one.
      if (hasReverseAnchor && currentAnchorId) failedAnchorIds.add(currentAnchorId);
      continue;
    }

    // Validate no duplicate places
    const placeIds = stops.map(s => s.placeId).filter(Boolean);
    if (new Set(placeIds).size !== placeIds.length) {
      // ORCH-0677 RC-1: duplicate-place failure for reverse-anchor types
      // marks the anchor failed so the loop tries a different one.
      if (hasReverseAnchor && currentAnchorId) failedAnchorIds.add(currentAnchorId);
      continue;
    }

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

  // ORCH-0677 §3.2: when no cards built, surface an explicit verdict so mobile
  // can route to EMPTY UI state instead of staying on INITIAL_LOADING.
  let summary: CuratedSummary | undefined;
  if (cards.length === 0) {
    if (hasReverseAnchor) {
      summary = {
        emptyReason: initialAnchorCount === 0 ? 'pool_empty' : 'no_viable_anchor',
        candidateAnchorCount: initialAnchorCount,
        failedAnchorCount: failedAnchorIds.size,
      };
    } else {
      // Standard branch: empty means none of the categories had viable picks.
      summary = {
        emptyReason: 'pool_empty',
        candidateAnchorCount: 0,
        failedAnchorCount: 0,
      };
    }
  }

  return { cards, summary };
}

// ── Utility functions ──────────────────────────────────────────────────────

// ORCH-1061 PART 1B: the Math.random shuffle() (used only for combo ordering)
// was DELETED — combo ordering is now deterministic via buildDeterministicComboList
// (seeded off batchSeed) so collab decks are reproducible. The remaining
// Math.random uses in this file (tagline pick in buildCardFromStops, the
// per-card id suffix, the cosmetic matchScore) are display-only / identity-noise
// and do NOT affect deck card ordering or selection — left untouched per spec §5.5.

// ── ORCH-1061 PART 1B: deterministic main-activity rotation ─────────────────

// Resolve the combo slot index whose CATEGORY we rotate across cards (the intent's
// "main activity"). Derived from the typeDef, not hardcoded per-intent magic.
//  - reverse-anchor (picnic): no rotation → -1 sentinel.
//  - else: the first NON-OPTIONAL slot whose slug VARIES across combos
//    (take-a-stroll's nature anchor is constant → rotates the food slot instead).
// Expected mapping (pinned by T-1B-MAP): adventurous→0, first-date→1, romantic→1,
// group-fun→0, take-a-stroll→1, picnic→-1.
export function mainActivitySlotIndex(typeDef: ExperienceTypeDef): number {
  if (typeDef.stops.some((s) => s.reverseAnchor)) return -1;
  const firstNonOptional = typeDef.stops.findIndex((s) => !s.optional);
  if (firstNonOptional < 0) return -1;
  for (let i = firstNonOptional; i < typeDef.stops.length; i++) {
    const slugsAtI = new Set(typeDef.combos.map((c) => c[i]));
    if (slugsAtI.size > 1) return i; // first varying non-optional slot
  }
  return firstNonOptional; // all-constant fallback (not hit by the current table)
}

// Build a deterministic combo ordering (length ≥ limit*2) that rotates the main
// activity across cards and descends quality WITHIN an activity (combos retain
// their authored EXPERIENCE_TYPES order = best-first). PURE: no Math.random.
export function buildDeterministicComboList(
  typeDef: ExperienceTypeDef,
  batchSeed: number,
  limit: number,
): string[][] {
  const seed = Number.isFinite(batchSeed) ? Math.floor(Math.abs(batchSeed)) : 0;
  const combos = typeDef.combos; // FROZEN order from EXPERIENCE_TYPES
  const slotIdx = mainActivitySlotIndex(typeDef);
  const target = Math.max(limit, 1) * 2;

  // Picnic / no-rotation / single combo: deterministic repeat to target length.
  if (slotIdx < 0 || combos.length <= 1) {
    const out: string[][] = [];
    let guard = 0;
    while (out.length < target) {
      out.push(...combos);
      if (++guard > target + combos.length) break; // can't happen with ≥1 combo
    }
    return out;
  }

  // 1. Group combos by main-activity slug, preserving FIRST-appearance order.
  const groupOrder: string[] = [];
  const groups = new Map<string, string[][]>();
  for (const c of combos) {
    const slug = c[slotIdx];
    if (!groups.has(slug)) { groups.set(slug, []); groupOrder.push(slug); }
    groups.get(slug)!.push(c);
  }

  // 2. Deterministic rotation offset from batchSeed (NO Math.random).
  const startOffset = ((seed % groupOrder.length) + groupOrder.length) % groupOrder.length;

  // 3. Round-robin across groups starting at startOffset → MAIN ACTIVITY rotates
  //    card-to-card; descend within each group as passes advance.
  const out: string[][] = [];
  const cursors = new Map<string, number>(groupOrder.map((s) => [s, 0]));
  let exhaustedGuard = 0;
  while (out.length < target) {
    let pushedThisCycle = 0;
    for (let k = 0; k < groupOrder.length; k++) {
      const slug = groupOrder[(startOffset + k) % groupOrder.length];
      const arr = groups.get(slug)!;
      const cur = cursors.get(slug)!;
      if (cur < arr.length) {
        out.push(arr[cur]);
        cursors.set(slug, cur + 1);
        pushedThisCycle++;
      }
      if (out.length >= target) break;
    }
    // Every group exhausted → reset cursors to repeat the full deterministic
    // sequence (mirrors the old "repeat to limit*2"). Still no randomness.
    if (pushedThisCycle === 0) {
      for (const s of groupOrder) cursors.set(s, 0);
      if (++exhaustedGuard > target) break; // hard stop, can't happen with ≥1 combo
    }
  }
  return out;
}

// ORCH-0659/0660: haversineKm + estimateTravelMinutes moved to
// _shared/distanceMath.ts as the canonical owner. Imported above.

// ORCH-1061 PART 1A — QUALITY-AWARE PROXIMITY BLEND for post-anchor stops.
//
// Replaces the old pure-nearest selectClosestHighestRated (which IGNORED quality
// despite its name). Every stop AFTER the first non-optional stop is now picked
// by a 60% quality / 40% proximity blend, so the 2nd/3rd stop is a good place
// that's also reasonably close — not just whatever is physically nearest.
//
// PURE function of `available` + the ref point + radius — NO request-time
// Math.random. `available` order/contents are themselves deterministic given the
// request inputs + the dedup state, so collab decks stay reproducible
// (I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND).
//
// Quality internal split 0.75 vibe-rank / 0.25 rating×reviews (LOCKED, OQ-1).
// Quality-vs-proximity blend 0.60 / 0.40 (operator-approved, LOCKED).
export function selectBlendedStop(
  available: any[],
  refLat: number,
  refLng: number,
  radiusMeters: number,
): any | null {
  // Empty / single guards — match the old helper so the failed-anchor cycle +
  // optional-skip logic at the call sites is preserved exactly.
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];

  // Quality primary axis: vibe rank score normalized within THIS candidate set.
  const rankMax = Math.max(...available.map((p) => p._rankScore ?? 0), 0);
  const radiusKm = Math.max(radiusMeters / 1000, 0.001); // avoid /0

  const BLEND_QUALITY = 0.60;   // operator-approved knob
  const BLEND_PROXIMITY = 0.40;

  const scoreOf = (p: any): number => {
    const rankNorm = rankMax > 0 ? ((p._rankScore ?? 0) / rankMax) : 0; // 0..1

    // Secondary: rating × log-dampened review_count, normalized 0..1.
    const ratingNorm = Math.min(Math.max((p.rating ?? 0) / 5, 0), 1);
    const reviewWeight = Math.min(Math.log10((p.review_count ?? 0) + 1) / 3, 1); // saturates ~1000 reviews
    const ratingScore = ratingNorm * (0.5 + 0.5 * reviewWeight); // ratings with no reviews keep half weight

    const Q = 0.75 * rankNorm + 0.25 * ratingScore; // 0..1

    const distKm = haversineKm(refLat, refLng, p.lat ?? 0, p.lng ?? 0);
    const P = Math.min(Math.max(1 - (distKm / radiusKm), 0), 1); // 1=at ref, 0=at/beyond radius edge

    return BLEND_QUALITY * Q + BLEND_PROXIMITY * P;
  };

  // Deterministic tie-break chain (LOCKED, no Math.random): when blended scores
  // are within 1e-9 → higher _rankScore, then rating, then review_count, then
  // lexicographically smaller google_place_id (pool-independent final arbiter).
  let best = available[0];
  let bestScore = scoreOf(best);
  for (let i = 1; i < available.length; i++) {
    const cand = available[i];
    const candScore = scoreOf(cand);
    if (candScore > bestScore + 1e-9) {
      best = cand;
      bestScore = candScore;
    } else if (Math.abs(candScore - bestScore) <= 1e-9) {
      if (tieBreakWins(cand, best)) {
        best = cand;
        bestScore = candScore;
      }
    }
  }
  return best;
}

// ORCH-1061 PART 1A — deterministic tie-break: does `a` beat `b`? (pure)
export function tieBreakWins(a: any, b: any): boolean {
  const ar = a._rankScore ?? 0, br = b._rankScore ?? 0;
  if (ar !== br) return ar > br;
  const arat = a.rating ?? 0, brat = b.rating ?? 0;
  if (arat !== brat) return arat > brat;
  const arc = a.review_count ?? 0, brc = b.review_count ?? 0;
  if (arc !== brc) return arc > brc;
  const aid = a.google_place_id ?? '', bid = b.google_place_id ?? '';
  return aid < bid; // lexicographically smaller id wins
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

// ORCH-1061: exported as `handler` and guarded by `import.meta.main` so the
// module can be imported by Deno unit tests (which exercise the PART 1A blend +
// PART 1B rotation pure helpers) WITHOUT auto-starting the HTTP server. In the
// deployed edge runtime `import.meta.main` is true (this file is the entry
// module), so production behavior is identical. Mirrors the codebase's
// check-launch-city / places-autocomplete testable-handler pattern.
export const handler = async (req: Request): Promise<Response> => {
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
      excludePlacePoolIds = [],
      // ORCH-1071: ids already in the deck — passed to the experience RPC as
      // p_exclude_ids so a brand experience already shown via the places path
      // is not re-fetched here. Optional; the curated client does not send it
      // today, so it defaults to [] and is a no-op until wired.
      excludeCardIds = [],
    } = body;
    if (!Array.isArray(excludePlacePoolIds)) {
      excludePlacePoolIds = [];
    }
    if (!Array.isArray(excludeCardIds)) {
      excludeCardIds = [];
    }
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
    // ORCH-0903 (2026-05-21): curated path uses unified TRAVEL_CONFIG via
    // radiusKmForConstraint(generosity=1.0). See _shared/distanceMath.ts.
    const maxDistKm = radiusKmForConstraint(travelConstraintValue, travelMode, 1.0);
    const clampedRadius = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);

    // ORCH-0640: Pool-first optimization blocks REMOVED. They read card_pool,
    // which is dropped. All curated generation now flows through
    // generateCardsForType() which composes stops from place_pool via the
    // signal system (ORCH-0634 rewire).

    console.log(`[curated-v2] Generating ${experienceType} cards (limit: ${limit})`);

    const generateLimit = warmPool ? Math.min(limit, 15) : limit;
    // ORCH-0677: generateCardsForType now returns { cards, summary? }; summary
    // is set when cards.length === 0 to make the empty verdict explicit.
    let { cards, summary } = await generateCardsForType(
      typeDef,
      location.lat, location.lng, budgetMax, travelMode,
      travelConstraintValue, generateLimit, skipDescriptions,
      excludePlacePoolIds.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0),
      batchSeed,
    );

    // ORCH-1061 PART 2: open-during-outing filter — solo path inherits the SAME
    // cascade collab gets via discover-cards. Start time mirrors discover-cards
    // (datetimePref ? new Date(datetimePref) : new Date()). filterCuratedByStopHours
    // is idempotent, so the collab path filtering again downstream is a no-op.
    const curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date();
    cards = filterCuratedByStopHours(cards, curatedUtcNow);
    // If hours-filtering emptied the deck, surface the existing empty verdict
    // shape so mobile routes to the EMPTY UI state instead of stuck-loading.
    if (cards.length === 0 && !summary) {
      summary = { emptyReason: 'pool_empty', candidateAnchorCount: 0, failedAnchorCount: 0 };
    }

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
    let normalizedCards = servedCards.map((card: any) => ({
      ...card,
      categoryLabel: card.categoryLabel || card.category || experienceType || 'Experience',
    }));

    // ORCH-1071 [experiences-on-curated-path]: for the 4 brand intents ONLY,
    // front-load eligible brand experiences ahead of the AI curated cards so the
    // "See curated experiences" path surfaces them (the places-path-only ORCH-1065
    // gap). Best-effort — a failure here NEVER breaks the AI curated generation.
    // Skipped on the warm path (servedCards is empty there). Bypasses
    // place_pool/ai_signal_scores/run-signal-scorer (COMMS-0018) — reads only
    // events+experience_stops via the RPC.
    if (!warmPool && CURATED_BRAND_EXPERIENCE_INTENTS.has(experienceType)) {
      try {
        // Radius mirrors discover-cards' experience supply (generosity=1.5 so the
        // candidate radius is wider than the tight curated multi-stop radius —
        // an auto-surface experience is a single bookable card, not a walked route).
        const expMaxDistKm = radiusKmForConstraint(travelConstraintValue, travelMode, 1.5);
        const expRadiusMeters = Math.min(Math.max(Math.round(expMaxDistKm * 1000), 500), 100000);
        const expNowIso = (datetimePref ? new Date(datetimePref) : new Date()).toISOString();
        const experienceCards = await fetchEligibleExperiencesForCurated({
          lat: location.lat,
          lng: location.lng,
          radiusMeters: expRadiusMeters,
          experienceType,
          nowIso: expNowIso,
          excludeEventIds: excludeCardIds.filter(
            (v: unknown): v is string => typeof v === 'string' && v.length > 0,
          ),
          limit: Math.min(limit, 30),
        });
        if (experienceCards.length > 0) {
          normalizedCards = frontLoadCuratedExperiences(normalizedCards, experienceCards);
          console.log(`[curated-v2] front-loaded ${experienceCards.length} brand experiences for intent=${experienceType}`);
        }
      } catch (expErr) {
        // Best-effort: experience supply failure must NOT break AI curated cards.
        console.warn(`[curated-v2] experience front-load failed (tolerating): ${(expErr as Error)?.message}`);
      }
    }
    return new Response(
      JSON.stringify({
        cards: normalizedCards,
        experienceType,
        // ORCH-1071: total reflects front-loaded brand experiences + AI cards.
        total: normalizedCards.length,
        generatedAt: new Date().toISOString(),
        meta: {
          totalResults: normalizedCards.length,
          totalCardsBuilt: cards.length,
          fromPool: 0,
          fromApi: servedCards.length,
          pipeline: 'curated-v2',
        },
        ...(warmPool ? { success: true, poolSize: cards.length } : {}),
        // ORCH-0677 §3.5: include `summary` only when cards is empty AND
        // generateCardsForType produced a verdict. Mobile uses this to route
        // curated-only empty results to EMPTY UI state. Legacy mobile builds
        // ignore unknown fields per JSON forward-compat.
        ...(normalizedCards.length === 0 && summary ? { summary } : {}),
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
};

if (import.meta.main) {
  serve(handler);
}
