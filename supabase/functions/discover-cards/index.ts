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
import { decideTypeAndPill } from '../_shared/mixedTypeInterleave.ts';
// ORCH-0659/0660: honest distance + per-mode travel-time computation.
// Single owner: _shared/distanceMath.ts. See
// Mingla_Artifacts/specs/SPEC_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md.
import { haversineKm, estimateTravelMinutes, radiusKmForConstraint, type TravelMode } from '../_shared/distanceMath.ts';
// ORCH-1061 PART 2: single source of truth for the curated open-hours cascade +
// the shared hours-text parsers. filterByDateTime AND the curated path both read
// these — there is now exactly ONE parser (no duplicate defs). The shared
// isStopOpenAtHour also carries the D-1 periods-shape fix.
import {
  parseSingleRange,
  parseHoursText,
  hourInRanges,
  DAY_NAMES,
  CURATED_STOP_DURATION,
  ALWAYS_OPEN_TYPES,
  isStopOpenAtHour,
  filterCuratedByStopHours,
  resolveCuratedHoursPolicy,
} from '../_shared/curatedStopHours.ts';
// ORCH-1068 [business-authored venues render on deck]: business venues persist
// hours as a top-level array [{weekday(0=Mon),isClosed,openTime,closeTime}], not
// the Google {periods} object. Normalize-at-write + the backfill migration fix
// new/existing rows, but the readers below ALSO accept the array shape defensively
// so a stray un-normalized array never silently excludes a servable venue.
import {
  businessHoursToGoogleOpeningHours,
  isBusinessHoursArray,
} from '../_shared/businessHoursToGoogle.ts';

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
  // ORCH-1062 Part 2 — three quality-grounded "vibe" signals promoted to user-pickable
  // categories. Rank-style: filterMin floors out noise, signal_score DESC orders.
  // romantic/scenic use filterMin=60 (thin-city coverage; the score ORDERS quality);
  // lively uses 120 (rich coverage everywhere). place_scores coverage + serving-pct=100
  // verified live 2026-06-02 (see SPEC §1). No requiredTypes / primary-type gate.
  'Romantic': { signalIds: ['romantic'], filterMin: 60,  displayCategory: 'Romantic' },
  'romantic': { signalIds: ['romantic'], filterMin: 60,  displayCategory: 'Romantic' },
  'Lively':   { signalIds: ['lively'],   filterMin: 120, displayCategory: 'Lively' },
  'lively':   { signalIds: ['lively'],   filterMin: 120, displayCategory: 'Lively' },
  'Scenic':   { signalIds: ['scenic'],   filterMin: 60,  displayCategory: 'Scenic' },
  'scenic':   { signalIds: ['scenic'],   filterMin: 60,  displayCategory: 'Scenic' },
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

// ─── ORCH-1065 [consumer-experience-deck-card] ────────────────────────────────
// Brand-authored experiences surface on the SOLO swipe deck via a dedicated
// `events` source that bypasses place_pool / ai_signal_scores / run-signal-scorer
// ENTIRELY (the COMMS-0018 signal_id-buggy venue→deck path) — this reads the
// pg_eligible_experiences_for_deck RPC (events + experience_stops) directly.
// Experiences book through the EXISTING ticket-checkout-create path (NO parallel
// money fn — COMMS-0014/0016); only the deck FACE + supply are new here.

// Server card envelope pushed into cards[] for each eligible experience. The
// client converter (deckService.experienceCardToRecommendation) decodes it.
interface ExperienceDeckCard {
  cardType: 'experience';
  id: string;
  eventId: string;
  experienceType: string;
  // ORCH-1138 rework (§4.B) — the FULL curated-vibe array (the 4 canonical ids:
  // adventurous|first-date|romantic|group-fun) so the consumer renders MULTIPLE
  // vibe chips, not just the single experienceType. Empty array when absent
  // (rule 9 — never fabricated).
  experienceIntents: string[];
  // ORCH-1138 rework (§4.B) — the anon-safe resolved brand theme (from the deck
  // RPC's brand_theme, sourced via business_public_events_view — COMMS-0009).
  // null when the brand carries no theme. The seed mapper feeds it to
  // resolveTheme as a SYNCHRONOUS fallback so the detail never flashes default.
  brandTheme: {
    color: string | null;
    font: string | null;
    animation: string | null;
    color_override: string | null;
    font_override: string | null;
    animation_override: string | null;
  } | null;
  // ORCH-1138 rework (§4.B) — first-stop city → the consumer City,Country meta
  // chip (rule 9: null when no stop has a city).
  city: string | null;
  title: string;
  tagline: string;
  // ORCH-1072: the experience's REAL description + cover (events.description /
  // cover_media_url / cover_media_type) so the detail sheet renders the actual
  // story + cover image/video, not the fabricated first-stop image + tagline.
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
  // ORCH-1072: upcoming occurrences for the Book sheet date picker. One-off
  // experiences carry a single element (auto-selected); sold-out occurrences
  // (remaining === 0) render disabled. remaining === null ⇒ unlimited.
  upcomingOccurrences: Array<{
    eventDateId: string;
    startAt: string;
    endAt: string;
    capacity: number | null;
    sold: number;
    remaining: number | null;
  }>;
  // ORCH-1153 WS2: recurrence fields → the consumer rule-based open-daily
  // detector (isOpenDailyExperience). From pg_eligible_experiences_for_deck's
  // is_recurring / recurrence_rules columns (added in 20261009000003).
  isRecurring: boolean;
  recurrenceRule: {
    preset?: string;
    byDay?: string;
    byMonthDay?: number;
    bySetPos?: number;
    termination?: { kind?: string; count?: number; until?: string };
  } | null;
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
    // ORCH-1138 rework (§4.B) — per-stop authored start time (HH:MM:SS) → the
    // consumer per-stop time pill. null when unauthored (rule 9).
    startTime: string | null;
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

// ORCH-1065 Decision D4 — map an active deck signal / pill to the 4 brand
// experience-intent ids. Any signal not present here contributes no intent.
const EXPERIENCE_INTENT_BY_SIGNAL: Record<string, string> = {
  adventurous: 'adventurous',
  romantic: 'romantic',
  'group-fun': 'group-fun',
  lively: 'group-fun',
  icebreakers: 'first-date',
};

// Resolve the request's active deck signals → the DISTINCT set of experience
// intent ids. Empty result ⇒ permissive (RPC applies no intent filter so every
// geo-eligible published experience surfaces — auto-surface is never starved).
function resolveExperienceIntents(signalIds: string[]): string[] {
  const out = new Set<string>();
  for (const sig of signalIds) {
    const intent = EXPERIENCE_INTENT_BY_SIGNAL[sig];
    if (intent) out.add(intent);
  }
  return [...out];
}

// ORCH-1072: decode the RPC's upcoming_occurrences jsonb into the camelCase
// envelope shape. Drops malformed rows (no event_date_id / no start_at) so the
// client never renders an unbookable occurrence. Honest passthrough — no
// fabricated capacity (remaining stays null when the RPC said unlimited).
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

// Single service-role round-trip to the deck-eligibility RPC. Throws on error
// (the caller swallows best-effort so an experience-source failure never
// degrades the place deck — INV-042).
async function fetchEligibleExperiences(args: {
  supabaseAdmin: any;
  lat: number;
  lng: number;
  radiusMeters: number;
  signalIds: string[];
  nowIso: string;
  excludeEventIds: string[];
  limit: number;
}): Promise<ExperienceDeckCard[]> {
  const intents = resolveExperienceIntents(args.signalIds);
  const { data, error } = await args.supabaseAdmin.rpc(
    'pg_eligible_experiences_for_deck',
    {
      p_lat: args.lat,
      p_lng: args.lng,
      p_radius_m: args.radiusMeters,
      p_intents: intents,
      p_now: args.nowIso,
      p_exclude_ids: args.excludeEventIds,
      p_limit: Math.min(Math.max(args.limit, 0), 30),
    },
  );
  if (error) {
    throw new Error(`pg_eligible_experiences_for_deck failed: ${error.message}`);
  }
  const rows = (data as any[]) ?? [];
  return rows.map((row): ExperienceDeckCard => {
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
        // ORCH-1138 rework (§4.B) — per-stop authored start time (honest null).
        startTime:
          typeof s.start_time === 'string' && s.start_time.length > 0
            ? s.start_time
            : null,
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
      experienceType: intentsArr[0] ?? 'adventurous',
      // ORCH-1138 rework (§4.B) — carry the FULL canonical-vibe array (not just
      // the single first intent) so the consumer renders multiple vibe chips.
      experienceIntents: intentsArr.filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      ),
      // ORCH-1138 rework (§4.B) — anon-safe resolved brand theme passthrough
      // (COMMS-0009: from the RPC's brand_theme, never a client brands read).
      brandTheme:
        row.brand_theme !== null && typeof row.brand_theme === 'object'
          ? {
              color:
                typeof row.brand_theme.color === 'string'
                  ? row.brand_theme.color
                  : null,
              font:
                typeof row.brand_theme.font === 'string'
                  ? row.brand_theme.font
                  : null,
              animation:
                typeof row.brand_theme.animation === 'string'
                  ? row.brand_theme.animation
                  : null,
              color_override:
                typeof row.brand_theme.color_override === 'string'
                  ? row.brand_theme.color_override
                  : null,
              font_override:
                typeof row.brand_theme.font_override === 'string'
                  ? row.brand_theme.font_override
                  : null,
              animation_override:
                typeof row.brand_theme.animation_override === 'string'
                  ? row.brand_theme.animation_override
                  : null,
            }
          : null,
      // ORCH-1138 rework (§4.B) — first-stop city for the City,Country chip.
      city:
        typeof row.city === 'string' && row.city.trim().length > 0
          ? row.city.trim()
          : null,
      title: typeof row.title === 'string' ? row.title : '',
      tagline: typeof row.tagline === 'string' ? row.tagline : '',
      // ORCH-1072: carry the real description + cover (honest defaults — '' /
      // null when absent; the client shows an empty-state, never the tagline).
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
      // ORCH-1153 WS2: recurrence fields for the consumer open-daily detector.
      // Honest passthrough — null when the RPC row lacks them (rule 9).
      isRecurring: row.is_recurring === true,
      recurrenceRule:
        row.recurrence_rules !== null &&
        row.recurrence_rules !== undefined &&
        typeof row.recurrence_rules === 'object'
          ? (row.recurrence_rules as ExperienceDeckCard['recurrenceRule'])
          : null,
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

// FRONT-LOAD (operator-approved 2026-06-03, Seth): eligible brand experiences
// LEAD the deck — every experience is placed at the FRONT (index 0..n-1), ahead
// of the AI curated cards and singles, so the feature is easy to spot and test.
// Order is deterministic and stable: experiences keep the RPC's existing order
// (soonest upcoming date first, then most-recently published —
// `ORDER BY next_start_at ASC NULLS LAST, published_at DESC` in
// pg_eligible_experiences_for_deck), and the normal place deck follows them
// unchanged. Preserves every prior guard: dedupes by id; excludes any experience
// whose id collides with a place id (exclude-self / no double-render); additive
// (experiences NEVER displace or drop place cards). If placeCards is empty but
// experiences exist, returns the experiences alone (experiences-only deck).
function interleaveExperiencesIntoDeck(
  placeCards: any[],
  experienceCards: ExperienceDeckCard[],
): any[] {
  if (experienceCards.length === 0) return placeCards;
  const seen = new Set<string>();
  const dedupedExp: ExperienceDeckCard[] = [];
  for (const exp of experienceCards) {
    if (!seen.has(exp.id)) {
      seen.add(exp.id);
      dedupedExp.push(exp);
    }
  }
  if (placeCards.length === 0) return [...dedupedExp];
  const placeIds = new Set<string>();
  for (const c of placeCards) {
    if (c && typeof c.id === 'string') placeIds.add(c.id);
  }
  const expToPlace = dedupedExp.filter((e) => !placeIds.has(e.id));
  if (expToPlace.length === 0) return placeCards;
  // Experiences first (stable RPC order), then the full place deck unchanged.
  return [...expToPlace, ...placeCards];
}
// ─── end ORCH-1065 ────────────────────────────────────────────────────────────

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

const SESSION_INTENT_IDS = new Set([
  'adventurous',
  'first-date',
  'romantic',
  'group-fun',
  'picnic-dates',
  'take-a-stroll',
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Helpers ─────────────────────────────────────────────────────────────────
// ORCH-0903 (2026-05-21): local SPEED_KMH deleted; radius math now uses
// the unified TRAVEL_CONFIG via radiusKmForConstraint() from
// _shared/distanceMath.ts. See ORCH-0903 close banner in WORLD_MAP.md.

// ── DateTime Filter ─────────────────────────────────────────────────────────
// ORCH-1061 PART 2: parseSingleRange / parseHoursText / hourInRanges / DAY_NAMES
// were moved to _shared/curatedStopHours.ts (single source of truth) and are
// imported at the top of this file. filterByDateTime below uses the imported
// versions. Do NOT re-declare them here.

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
      // ORCH-1068: business-authored array shape [{weekday(0=Mon),isClosed,…}].
      // Convert to Google-day periods (day = (weekday+1)%7) then eval normally.
      // `day` here is the JS/Google 0=Sunday index, and the converter emits
      // Google-day periods, so the comparison is correct (no double-shift).
      if (isBusinessHoursArray(oh)) {
        return evalPeriods(businessHoursToGoogleOpeningHours(oh).periods);
      }
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
      // ORCH-1068: business-authored array shape → has data iff ≥1 open period.
      if (isBusinessHoursArray(oh)) {
        return businessHoursToGoogleOpeningHours(oh).periods.length > 0;
      }
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
      // ORCH-1068: business-authored array shape → open on any day with a period.
      if (isBusinessHoursArray(oh)) {
        return businessHoursToGoogleOpeningHours(oh).periods.some(
          (period) => period.open.day === day,
        );
      }
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
// ORCH-1061 PART 2: CURATED_STOP_DURATION / ALWAYS_OPEN_TYPES / isStopOpenAtHour /
// filterCuratedByStopHours were moved to _shared/curatedStopHours.ts (single
// source of truth, shared with the SOLO generate-curated-experiences path) and
// are imported at the top of this file. The extracted isStopOpenAtHour also
// carries the D-1 periods-shape fix (it now actually filters the ~99.9% of
// canonical Google v1 periods-shape rows the old text-only reader skipped).
// Do NOT re-declare them here.

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
// META-ORCH-1009 Sub-B — extract the per-signal AI reasoning slice from the new
// RPC `ai_reasoning` column. Returns `{ [signalId]: reasoning }` when the row
// has a non-empty reasoning string, or `undefined` otherwise (mobile-side
// renderer hides the section when the field is absent — never an empty state).
// The signalId is passed in because a single card can surface under multiple
// signals (multi-chip), and ExpandedCardModal's dominant-signal resolver picks
// whichever key matches the card's tag/category. Per SPEC §3.3 D-2.
function extractAiReasoningBySignal(
  row: any,
  signalId: string | undefined,
): Record<string, string> | undefined {
  if (!signalId) return undefined;
  const slice = row?.ai_reasoning;
  if (!slice || typeof slice !== 'object') return undefined;
  const reasoning = slice.reasoning;
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) return undefined;
  return { [signalId]: reasoning };
}

function transformServablePlaceToCard(
  row: any,
  categoryLabel: string,
  userLat: number,
  userLng: number,
  travelMode: TravelMode,
  // META-ORCH-1009 Sub-B — signalId for the per-signal reasoning lookup.
  // Optional to keep the curated/hydrate call site (line ~883) compatible
  // since it doesn't have a single source signal.
  signalId?: string,
): any {
  const storedPhotos = Array.isArray(row.stored_photo_urls) ? row.stored_photo_urls : [];
  const tier = googleLevelToTierSlug(row.price_level);

  // ORCH-1068 (F-5): a business-authored venue's stored_photo_urls[0] can be a
  // Cloudinary cover VIDEO (.mp4) that the deck's still-image hero (ExpoImage)
  // can't decode → it falls back to a generic stock photo. Pick the first IMAGE
  // url for the hero (`image`); keep the FULL ordered list in `images` so a
  // future cover-video player can still reach the video. Image URLs win over
  // video — never show a stock fallback for a venue we have a real photo for.
  const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;
  const isVideoUrl = (u: string): boolean => VIDEO_EXT.test(u) || /\/video\/upload\//.test(u);
  const heroImage: string | null =
    storedPhotos.find((u: unknown) => typeof u === 'string' && !isVideoUrl(u)) ?? null;

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
    image: heroImage, // ORCH-1068: first non-video url (real photo, not stock fallback)
    images: storedPhotos, // full ordered list unchanged (cover-video stays available)
    openingHours: row.opening_hours ?? null,
    utcOffsetMinutes: row.utc_offset_minutes ?? null,
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
    // META-ORCH-1009 Sub-B — per-signal Gemini Q2 reasoning slice for the
    // "Why we picked this for you" expand-modal section. undefined when AI
    // hasn't evaluated this place for this signal (degrades cleanly — modal
    // hides the section). Mobile-side type: Record<string, string>.
    ai_reasoning_by_signal: extractAiReasoningBySignal(row, signalId),
    // Debug-only fields — mobile parser ignores extra keys
    _signal_score: row.signal_score,
    _signal_contributions: row.signal_contributions,
    _ai_score_raw: row.ai_score_raw,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCH-0902 [Collab session deck deterministic rewrite] — DETERMINISTIC-V2 PATH
// ─────────────────────────────────────────────────────────────────────────────
// ORCH-0909 — COLLAB POSITIONAL SHARED-DECK PATH
// ─────────────────────────────────────────────────────────────────────────────
// Collab decks are now positional. session_deck_cards(session_id, position) is
// the immutable source of truth, and session_participants.current_position
// tracks each participant cursor. This branch returns one card: the card at
// server_current_position + 1. The serve() router rejects old version-pinned
// payloads with HTTP 410.
// ─────────────────────────────────────────────────────────────────────────────

interface AggregatedCollabPrefs {
  categories: string[];
  intents: string[];
  dateWindows: string[];
  selectedDates: string[];
  datetimePref: string | null;
  circles: Array<{
    user_id: string;
    lat: number;
    lng: number;
    travel_mode: string;
    time_min: number;
    radius_m: number;
  }>;
  acceptedCount: number;
  pending_gps_user_ids?: string[];
  intersection_empty?: boolean;
}

type PositionalDeadEndReason =
  | 'intersection_empty'
  | 'no_matching_candidates'
  | 'no_unswiped_candidates'
  | 'quorum_not_met'
  | 'all_pools_exhausted';

type SessionDeckCardRow = {
  card_id: string | null;
  card_type?: 'single' | 'curated' | string | null;
  curated_payload?: any | null;
  generated_at_version: number;
  degraded_from?: string | null;
  pill_label?: string | null;
};

function curatedStopPlacePoolIds(card: any): string[] {
  const stops = Array.isArray(card?.stops) ? card.stops : [];
  return stops
    .map((stop: any) => stop?.placePoolId)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
}

async function fetchCuratedBatchInternal(args: {
  sessionId: string;
  experienceType: string;
  limit: number;
  excludePlacePoolIds: string[];
  callerJwt: string;
}): Promise<{ cards: any[]; summary?: { emptyReason: string; candidateAnchorCount: number; failedAnchorCount: number } }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/generate-curated-experiences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.callerJwt}`,
    },
    body: JSON.stringify({
      experienceType: args.experienceType,
      session_id: args.sessionId,
      limit: args.limit,
      skipDescriptions: true,
      excludePlacePoolIds: args.excludePlacePoolIds,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`generate-curated-experiences returned ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  return { cards: Array.isArray(json?.cards) ? json.cards : [], summary: json?.summary };
}

async function handleDeterministicV2(args: {
  supabaseAdmin: any;
  sessionId: string;
  currentPosition: number;
  req: Request;
  t0: number;
}): Promise<Response> {
  const { supabaseAdmin, sessionId, currentPosition, req, t0 } = args;

  const json = (payload: Record<string, unknown>, status = 200): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

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
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
        const payload = JSON.parse(atob(b64 + pad));
        const sub = typeof payload?.sub === 'string' ? payload.sub : undefined;
        if (sub) userId = sub;
        else authErrorClass = 'JWTMissingSub';
      }
    } catch (err) {
      authErrorClass = `JWTDecodeFailed:${(err as Error).name || 'Error'}`;
    }
  }

  if (!userId) {
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'auth_required',
      http_status: 401,
      sourceBreakdown: { path: 'auth-required', errorClass: authErrorClass },
    }, 401);
  }

  const deadEnd = (params: {
    position: number;
    reason: PositionalDeadEndReason;
    acceptedCount: number;
    pendingGpsUserIds: string[];
    detail?: string;
  }): Response => json({
    success: false,
    card: null,
    cards: [],
    total: 0,
    position: params.position,
    current_position: params.position - 1,
    dead_end: true,
    reason: params.reason,
    acceptedCount: params.acceptedCount,
    pending_gps_user_ids: params.pendingGpsUserIds,
    source: 'orch-0909-positional-shared-deck',
    metadata: { hasMore: false, poolSize: 0, batchSeed: 0, perChipBreakdown: {} },
    sourceBreakdown: {
      fromPool: 0,
      fromApi: 0,
      totalServed: 0,
      apiCallsMade: 0,
      cacheHits: 0,
      gapCategories: [],
      reason: params.detail ?? params.reason,
      path: 'pool-empty',
      signalIds: [],
      cohort: 'NEW',
      filterMins: {},
      deadEndReason: params.reason,
    },
  });

  const sessionRes = await supabaseAdmin
    .from('collaboration_sessions')
    .select('id, deck_version, deck_params_hash')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionRes.error) {
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'pipeline_error',
      http_status: 500,
      sourceBreakdown: { path: 'pipeline-error', reason: sessionRes.error.message },
    }, 500);
  }
  if (!sessionRes.data) {
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'session_not_found',
      http_status: 404,
      sourceBreakdown: { path: 'session-not-found' },
    }, 404);
  }
  const sessionRow = sessionRes.data as {
    id: string;
    deck_version: number;
    deck_params_hash: string | null;
  };

  const partRes = await supabaseAdmin
    .from('session_participants')
    .select('user_id, current_position')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('has_accepted', true)
    .maybeSingle();
  if (partRes.error || !partRes.data) {
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'forbidden_not_accepted_participant',
      http_status: 403,
      deck_version: sessionRow.deck_version,
      deck_params_hash: sessionRow.deck_params_hash,
      sourceBreakdown: { path: 'pipeline-error', reason: 'forbidden_not_accepted_participant' },
    }, 403);
  }

  const serverCurrentPosition = Number(partRes.data.current_position ?? 0);
  if (serverCurrentPosition !== currentPosition) {
    console.warn(
      `[discover-cards/positional] position divergence session=${sessionId} user=${userId} client=${currentPosition} server=${serverCurrentPosition}; server wins`,
    );
  }
  const targetPosition = serverCurrentPosition + 1;

  const aggRes = await supabaseAdmin.rpc('pg_aggregate_collab_prefs', {
    p_session_id: sessionId,
  });
  if (aggRes.error) {
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'pipeline_error',
      http_status: 500,
      deck_version: sessionRow.deck_version,
      deck_params_hash: sessionRow.deck_params_hash,
      sourceBreakdown: { path: 'pipeline-error', reason: aggRes.error.message },
    }, 500);
  }
  const agg = aggRes.data as AggregatedCollabPrefs;
  const pendingGpsUserIds = Array.isArray(agg.pending_gps_user_ids)
    ? agg.pending_gps_user_ids
    : [];

  const hydrateSingleFromPlacePool = async (cardId: string): Promise<any | null> => {
    const { data, error } = await supabaseAdmin
      .from('place_pool')
      .select(`
        id,
        google_place_id,
        name,
        address,
        lat,
        lng,
        rating,
        review_count,
        price_level,
        price_range_start_cents,
        price_range_end_cents,
        opening_hours,
        utc_offset_minutes,
        website,
        photos,
        stored_photo_urls,
        types,
        primary_type
      `)
      .eq('id', cardId)
      .maybeSingle();
    if (error || !data) return null;
    const circle = Array.isArray(agg.circles) && agg.circles.length > 0
      ? agg.circles[0]
      : { lat: data.lat ?? 0, lng: data.lng ?? 0, travel_mode: 'walking' };
    return transformServablePlaceToCard(
      { ...data, place_id: data.id, signal_score: 0, signal_contributions: {} },
      resolveCategories(agg.categories ?? [])[0] ?? 'Group pick',
      circle.lat,
      circle.lng,
      circle.travel_mode as TravelMode,
    );
  };

  const hydrateCardFromRow = async (row: SessionDeckCardRow): Promise<any | null> => {
    if (row.card_type === 'curated' && row.curated_payload) {
      return row.curated_payload;
    }
    if ((row.card_type === 'single' || !row.card_type) && row.card_id) {
      return await hydrateSingleFromPlacePool(row.card_id);
    }
    return null;
  };

  const successResponse = async (params: {
    row: SessionDeckCardRow;
    position: number;
  }): Promise<Response> => {
    const card = await hydrateCardFromRow(params.row);
    if (!card) {
      return json({
        success: false,
        card: null,
        cards: [],
        error_class: 'pipeline_error',
        http_status: 500,
        sourceBreakdown: { path: 'pipeline-error', reason: 'hydrate_card_failed' },
      }, 500);
    }

    const updateRes = await supabaseAdmin
      .from('session_participants')
      .update({ current_position: params.position })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .lt('current_position', params.position);
    if (updateRes.error) {
      return json({
        success: false,
        card: null,
        cards: [],
        error_class: 'pipeline_error',
        http_status: 500,
        sourceBreakdown: { path: 'pipeline-error', reason: updateRes.error.message },
      }, 500);
    }

    console.log(
      `[discover-cards/positional] session=${sessionId} user=${userId} position=${params.position} type=${params.row.card_type ?? 'single'} card=${params.row.card_id ?? card?.id ?? 'curated'} generated_at_version=${params.row.generated_at_version} elapsed_ms=${Date.now() - t0}`,
    );

    return json({
      success: true,
      card,
      cards: [card],
      total: 1,
      position: params.position,
      current_position: params.position,
      generated_at_version: params.row.generated_at_version,
      dead_end: false,
      card_type: params.row.card_type ?? 'single',
      pill_label: params.row.pill_label ?? null,
      degraded_from: params.row.degraded_from ?? null,
      degraded_from_intent: params.row.card_type === 'single' && Boolean(params.row.degraded_from),
      degraded_from_single: params.row.card_type === 'curated' && Boolean(params.row.degraded_from),
      exhausted_intent: params.row.card_type === 'single' ? params.row.degraded_from ?? null : null,
      exhausted_category: params.row.card_type === 'curated' ? params.row.degraded_from ?? null : null,
      acceptedCount: agg.acceptedCount,
      pending_gps_user_ids: pendingGpsUserIds,
      source: 'orch-0909-positional-shared-deck',
      metadata: { hasMore: false, poolSize: 1, batchSeed: 0, perChipBreakdown: {} },
      sourceBreakdown: {
        fromPool: 1,
        fromApi: 0,
        totalServed: 1,
        apiCallsMade: 0,
        cacheHits: 0,
        gapCategories: [],
        reason: params.row.degraded_from
          ? 'ORCH-0906 graceful-degrade positional shared-deck card'
          : 'ORCH-0909 positional shared-deck card',
        path: 'pipeline',
        signalIds: [],
        cohort: 'NEW',
        filterMins: {},
      },
    });
  };

  if (agg.acceptedCount < 2) {
    return deadEnd({
      position: targetPosition,
      reason: 'quorum_not_met',
      acceptedCount: agg.acceptedCount,
      pendingGpsUserIds,
      detail: `Session has ${agg.acceptedCount} accepted participant(s); minimum 2 required`,
    });
  }

  const existingCardRes = await supabaseAdmin
    .from('session_deck_cards')
    .select('card_id, card_type, curated_payload, generated_at_version, degraded_from, pill_label')
    .eq('session_id', sessionId)
    .eq('position', targetPosition)
    .maybeSingle();
  if (existingCardRes.error) {
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'pipeline_error',
      http_status: 500,
      sourceBreakdown: { path: 'pipeline-error', reason: existingCardRes.error.message },
    }, 500);
  }
  if (existingCardRes.data) {
    return await successResponse({
      row: existingCardRes.data as SessionDeckCardRow,
      position: targetPosition,
    });
  }

  if (!Array.isArray(agg.circles) || agg.circles.length === 0) {
    return deadEnd({
      position: targetPosition,
      reason: 'no_matching_candidates',
      acceptedCount: agg.acceptedCount,
      pendingGpsUserIds,
      detail: 'No GPS-bearing participants yet; waiting for location.',
    });
  }
  if (agg.intersection_empty === true) {
    return deadEnd({
      position: targetPosition,
      reason: 'intersection_empty',
      acceptedCount: agg.acceptedCount,
      pendingGpsUserIds,
      detail: 'Participant travel circles have no shared reachable places.',
    });
  }
  const collabCategories = Array.isArray(agg.categories)
    ? resolveCategories(agg.categories).filter((c) => !HIDDEN_CATEGORIES.has(c))
    : [];
  const collabIntents = Array.isArray(agg.intents)
    ? agg.intents.filter((intent) => SESSION_INTENT_IDS.has(intent))
    : [];

  if (collabCategories.length === 0 && collabIntents.length === 0) {
    return deadEnd({
      position: targetPosition,
      reason: 'no_matching_candidates',
      acceptedCount: agg.acceptedCount,
      pendingGpsUserIds,
      detail: 'No participant has any category or intent selected.',
    });
  }

  const countServedRowsByType = async (cardType: 'single' | 'curated'): Promise<number> => {
    const { data, error } = await supabaseAdmin
      .from('session_deck_cards')
      .select('position')
      .eq('session_id', sessionId)
      .eq('card_type', cardType);
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data.length : 0;
  };

  const pickNextSinglePill = async (): Promise<string | null> => {
    if (collabCategories.length === 0) return null;
    const count = await countServedRowsByType('single');
    return collabCategories[count % collabCategories.length];
  };

  const pickNextCuratedPill = async (): Promise<string | null> => {
    if (collabIntents.length === 0) return null;
    const count = await countServedRowsByType('curated');
    return collabIntents[count % collabIntents.length];
  };

  let handleCuratedPosition: (params: {
    position: number;
    experienceType: string;
    degradedFrom?: string | null;
  }) => Promise<Response>;

  const handleSinglePosition = async (params: {
    position: number;
    pill: string;
    degradedFrom?: string | null;
  }): Promise<Response> => {
  const fallbackToCuratedAfterSingleExhaustion = async (
    detail: string,
    reason: PositionalDeadEndReason,
  ): Promise<Response> => {
    const fallbackIntent = await pickNextCuratedPill();
    if (fallbackIntent && !params.degradedFrom) {
      return await handleCuratedPosition({
        position: params.position,
        experienceType: fallbackIntent,
        degradedFrom: params.pill,
      });
    }
    if (reason === 'no_unswiped_candidates') {
      return deadEnd({
        position: params.position,
        reason: 'no_unswiped_candidates',
        acceptedCount: agg.acceptedCount,
        pendingGpsUserIds,
        detail,
      });
    }
    return deadEnd({
      position: params.position,
      reason,
      acceptedCount: agg.acceptedCount,
      pendingGpsUserIds,
      detail,
    });
  };
  const canonicalCategories = resolveCategories([params.pill]).filter(
    (c) => !HIDDEN_CATEGORIES.has(c),
  );
  type ChipTarget = {
    chip: string;
    displayCategory: string;
    signalIds: string[];
    filterMin: number;
  };
  const chipTargets: ChipTarget[] = [];
  for (const chip of canonicalCategories) {
    const mapping = CATEGORY_TO_SIGNAL[chip];
    if (!mapping) {
      console.warn(`[discover-cards/positional] chip="${chip}" missing CATEGORY_TO_SIGNAL mapping — skipping`);
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
    return await fallbackToCuratedAfterSingleExhaustion(
      'No selected chips have signal mappings.',
      'no_matching_candidates',
    );
  }

  const uniqueSignalIds = [...new Set(chipTargets.flatMap((t) => t.signalIds))];
  const cohortByPct = new Map<string, { pct: number; inCohort: boolean }>();
  await Promise.all(
    uniqueSignalIds.map(async (sig) => {
      const pct = await getSignalServingPct(supabaseAdmin, sig);
      cohortByPct.set(sig, { pct, inCohort: isInCohort(userId!, pct) });
    }),
  );

  type RpcTask = {
    chip: string;
    signalId: string;
    filterMin: number;
    displayCategory: string;
  };
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
    return await fallbackToCuratedAfterSingleExhaustion(
      'No selected chips have any signal in cohort.',
      'no_matching_candidates',
    );
  }

  let excludePlaceIds: string[] = [];
  {
    const { data: deckVersionRow } = await supabaseAdmin
      .from('session_deck_versions')
      .select('aggregated_params')
      .eq('session_id', sessionId)
      .eq('deck_version', sessionRow.deck_version)
      .maybeSingle();
    const rawExcludes = (deckVersionRow as any)?.aggregated_params?.exclude_place_ids;
    if (Array.isArray(rawExcludes)) {
      excludePlaceIds = rawExcludes.filter((v): v is string => typeof v === 'string');
    }
  }

  const servedRes = await supabaseAdmin
    .from('session_deck_cards')
    .select('card_id, curated_payload')
    .eq('session_id', sessionId);
  if (servedRes.error) {
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'pipeline_error',
      http_status: 500,
      sourceBreakdown: { path: 'pipeline-error', reason: servedRes.error.message },
    }, 500);
  }
  const sessionServedIds = new Set<string>(
    ((servedRes.data as Array<{ card_id: string | null; curated_payload?: any | null }> | null) ?? [])
      .map((r) => r.card_id)
      .filter((id): id is string => typeof id === 'string'),
  );
  for (const row of (servedRes.data as Array<{ curated_payload?: any | null }> | null) ?? []) {
    for (const id of curatedStopPlacePoolIds(row.curated_payload)) {
      sessionServedIds.add(id);
    }
  }
  excludePlaceIds = [...new Set([...excludePlaceIds, ...sessionServedIds])];

  const PER_CHIP_LIMIT = 50;
  const rpcResults = await Promise.all(
    rpcTasks.map((task) =>
      supabaseAdmin
        .rpc('query_servable_places_by_signal_intersection', {
          p_signal_id: task.signalId,
          p_filter_min: task.filterMin,
          p_circles: agg.circles,
          p_exclude_place_ids: excludePlaceIds,
          p_limit: PER_CHIP_LIMIT,
        })
        .then((res: any) => ({ task, res })),
    ),
  );

  const perChipBuckets = new Map<string, Map<string, any>>();
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
        // META-ORCH-1009 Sub-B — stamp the winning signalId on the row so the
        // downstream transformer can attach the per-signal reasoning slice.
        bucket.set(row.place_id, { ...row, __displayCategory: task.displayCategory, __signalId: task.signalId });
      }
    }
  }

  if (failedTasks.length === rpcTasks.length) {
    const truncated = failedTasks.slice(0, 3).join(' | ').slice(0, 200);
    console.error(`[discover-cards/positional] all intersection RPCs failed sample="${truncated}"`);
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'pipeline_error',
      http_status: 500,
      sourceBreakdown: { path: 'pipeline-error', reason: truncated, errorClass: 'SignalIntersectionRpcError' },
    }, 500);
  }
  if (failedTasks.length > 0) {
    console.warn(
      `[discover-cards/positional] partial intersection RPC failure ok=${rpcTasks.length - failedTasks.length}/${rpcTasks.length} sample="${failedTasks.slice(0, 2).join(' | ').slice(0, 200)}"`,
    );
  }

  const perChipSorted = new Map<string, any[]>();
  for (const chip of canonicalCategories) {
    const bucket = perChipBuckets.get(chip);
    if (!bucket || bucket.size === 0) continue;
    const arr = [...bucket.values()].sort(
      (a, b) => Number(b.signal_score ?? 0) - Number(a.signal_score ?? 0),
    );
    perChipSorted.set(chip, arr);
  }
  const interleavedRows = roundRobinByChip({ perChip: perChipSorted, totalLimit: 200 });
  if (interleavedRows.length === 0) {
    return await fallbackToCuratedAfterSingleExhaustion(
      'Signal RPCs returned zero rows for the intersection.',
      'no_matching_candidates',
    );
  }

  const unseenRows = interleavedRows.filter((row: any) => !sessionServedIds.has(row.place_id));
  if (unseenRows.length === 0) {
    return await fallbackToCuratedAfterSingleExhaustion(
      'All candidates are already present in session_deck_cards.',
      'no_unswiped_candidates',
    );
  }

  const candidateCards = unseenRows.map((row: any) => {
    let closest = agg.circles[0];
    let closestKm = haversineKm(closest.lat, closest.lng, row.lat ?? 0, row.lng ?? 0);
    for (let i = 1; i < agg.circles.length; i++) {
      const c = agg.circles[i];
      const d = haversineKm(c.lat, c.lng, row.lat ?? 0, row.lng ?? 0);
      if (d < closestKm) {
        closestKm = d;
        closest = c;
      }
    }
    return {
      row,
      card: transformServablePlaceToCard(
        row,
        row.__displayCategory ?? canonicalCategories[0],
        closest.lat,
        closest.lng,
        closest.travel_mode as TravelMode,
        row.__signalId, // META-ORCH-1009 Sub-B: per-signal reasoning lookup
      ),
    };
  });

  const rawCards = candidateCards.map((item) => item.card);
  const timeFilteredCards =
    agg.dateWindows && agg.dateWindows.length > 0
      ? filterByDateWindows(
          rawCards,
          agg.dateWindows,
          agg.datetimePref ?? undefined,
          agg.selectedDates ?? undefined,
        )
      : filterByDateTime(
          rawCards,
          agg.datetimePref ?? undefined,
          'today',
          agg.selectedDates ?? undefined,
        );
  // ORCH-1113: route the curated cascade through the date-option policy so it no
  // longer evaluates against the stale stored datetime_pref for 'today'. The
  // collab aggregate (pg_aggregate_collab_prefs) does not expose a date option,
  // so this aggregate path uses 'today' (live clock) — matching the 'today' that
  // filterByDateTime is already called with at line 1554.
  const curatedHoursPolicy = resolveCuratedHoursPolicy({
    dateOption: 'today',
    datetimePref: agg.datetimePref ?? undefined,
    selectedDates: agg.selectedDates ?? undefined,
  });
  const hoursFilteredCards = filterCuratedByStopHours(timeFilteredCards, curatedHoursPolicy);
  const picked = candidateCards.find((item) =>
    hoursFilteredCards.some((card: any) => card.id === item.card.id),
  );

  if (!picked) {
    return await fallbackToCuratedAfterSingleExhaustion(
      'Date/time filters removed every candidate for this position.',
      'no_matching_candidates',
    );
  }

  const insertRes = await supabaseAdmin
    .from('session_deck_cards')
    .insert({
      session_id: sessionId,
      position: params.position,
      card_id: picked.row.place_id,
      card_type: 'single',
      pill_label: params.pill,
      degraded_from: params.degradedFrom ?? null,
      generated_at_version: sessionRow.deck_version,
    });
  if (insertRes.error && insertRes.error.code !== '23505') {
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'pipeline_error',
      http_status: 500,
      sourceBreakdown: { path: 'pipeline-error', reason: insertRes.error.message },
    }, 500);
  }

  const rowRes = await supabaseAdmin
    .from('session_deck_cards')
    .select('card_id, card_type, curated_payload, generated_at_version, degraded_from, pill_label')
    .eq('session_id', sessionId)
    .eq('position', params.position)
    .maybeSingle();
  if (rowRes.error || !rowRes.data) {
    return json({
      success: false,
      card: null,
      cards: [],
      error_class: 'pipeline_error',
      http_status: 500,
      sourceBreakdown: { path: 'pipeline-error', reason: rowRes.error?.message ?? 'missing_positional_row_after_insert' },
    }, 500);
  }

  return await successResponse({
    row: rowRes.data as SessionDeckCardRow,
    position: params.position,
  });
  };

  handleCuratedPosition = async (params: {
    position: number;
    experienceType: string;
    degradedFrom?: string | null;
  }): Promise<Response> => {
    const cacheRes = await supabaseAdmin
      .from('session_curated_cache')
      .select('batch_index, cards, served_card_ids')
      .eq('session_id', sessionId)
      .eq('experience_type', params.experienceType)
      .order('batch_index', { ascending: false })
      .limit(1);
    if (cacheRes.error) {
      return json({
        success: false,
        card: null,
        cards: [],
        error_class: 'pipeline_error',
        http_status: 500,
        sourceBreakdown: { path: 'pipeline-error', reason: cacheRes.error.message },
      }, 500);
    }

    const latest = Array.isArray(cacheRes.data) ? cacheRes.data[0] : null;
    const latestCards = Array.isArray(latest?.cards) ? latest.cards : [];
    const latestServed = Array.isArray(latest?.served_card_ids) ? latest.served_card_ids : [];
    let pickedCard = latestCards.find((card: any) => !latestServed.includes(card?.id));
    let pickedBatchIndex = typeof latest?.batch_index === 'number' ? latest.batch_index : null;

    if (pickedCard && pickedBatchIndex !== null) {
      const updateCacheRes = await supabaseAdmin
        .from('session_curated_cache')
        .update({ served_card_ids: [...latestServed, pickedCard.id] })
        .eq('session_id', sessionId)
        .eq('experience_type', params.experienceType)
        .eq('batch_index', pickedBatchIndex);
      if (updateCacheRes.error) {
        return json({
          success: false,
          card: null,
          cards: [],
          error_class: 'pipeline_error',
          http_status: 500,
          sourceBreakdown: { path: 'pipeline-error', reason: updateCacheRes.error.message },
        }, 500);
      }
    } else {
      const priorCacheRes = await supabaseAdmin
        .from('session_curated_cache')
        .select('batch_index, cards')
        .eq('session_id', sessionId)
        .eq('experience_type', params.experienceType);
      if (priorCacheRes.error) {
        return json({
          success: false,
          card: null,
          cards: [],
          error_class: 'pipeline_error',
          http_status: 500,
          sourceBreakdown: { path: 'pipeline-error', reason: priorCacheRes.error.message },
        }, 500);
      }

      const excludeSet = new Set<string>();
      for (const row of (priorCacheRes.data as Array<{ cards: any[] }> | null) ?? []) {
        for (const card of Array.isArray(row.cards) ? row.cards : []) {
          for (const id of curatedStopPlacePoolIds(card)) excludeSet.add(id);
        }
      }
      const singleServedRes = await supabaseAdmin
        .from('session_deck_cards')
        .select('card_id')
        .eq('session_id', sessionId)
        .eq('card_type', 'single');
      if (singleServedRes.error) {
        return json({
          success: false,
          card: null,
          cards: [],
          error_class: 'pipeline_error',
          http_status: 500,
          sourceBreakdown: { path: 'pipeline-error', reason: singleServedRes.error.message },
        }, 500);
      }
      for (const row of (singleServedRes.data as Array<{ card_id: string | null }> | null) ?? []) {
        if (row.card_id) excludeSet.add(row.card_id);
      }

      let batch;
      try {
        batch = await fetchCuratedBatchInternal({
          sessionId,
          experienceType: params.experienceType,
          limit: 10,
          excludePlacePoolIds: [...excludeSet],
          callerJwt: token,
        });
      } catch (err) {
        return json({
          success: false,
          card: null,
          cards: [],
          error_class: 'pipeline_error',
          http_status: 500,
          sourceBreakdown: {
            path: 'pipeline-error',
            reason: (err as Error)?.message ?? 'generate-curated-experiences failed',
            errorClass: 'CuratedInternalInvocationError',
          },
        }, 500);
      }

      if (batch.cards.length === 0) {
        const fallbackPill = await pickNextSinglePill();
        if (fallbackPill) {
          return await handleSinglePosition({
            position: params.position,
            pill: fallbackPill,
            degradedFrom: params.experienceType,
          });
        }
        return deadEnd({
          position: params.position,
          reason: 'all_pools_exhausted',
          acceptedCount: agg.acceptedCount,
          pendingGpsUserIds,
          detail: `Curated intent ${params.experienceType} exhausted and no single category can fill the position.`,
        });
      }

      pickedBatchIndex = Math.max(
        -1,
        ...(((priorCacheRes.data as Array<{ batch_index: number }> | null) ?? [])
          .map((row) => Number(row.batch_index))
          .filter((n) => Number.isFinite(n))),
      ) + 1;
      pickedCard = batch.cards[0];
      const insertCacheRes = await supabaseAdmin
        .from('session_curated_cache')
        .insert({
          session_id: sessionId,
          experience_type: params.experienceType,
          batch_index: pickedBatchIndex,
          cards: batch.cards,
          served_card_ids: pickedCard?.id ? [pickedCard.id] : [],
          generated_at_version: sessionRow.deck_version,
        });
      if (insertCacheRes.error && insertCacheRes.error.code !== '23505') {
        return json({
          success: false,
          card: null,
          cards: [],
          error_class: 'pipeline_error',
          http_status: 500,
          sourceBreakdown: { path: 'pipeline-error', reason: insertCacheRes.error.message },
        }, 500);
      }
    }

    if (!pickedCard) {
      return deadEnd({
        position: params.position,
        reason: 'no_matching_candidates',
        acceptedCount: agg.acceptedCount,
        pendingGpsUserIds,
        detail: `No curated card available for ${params.experienceType}.`,
      });
    }

    const insertRes = await supabaseAdmin
      .from('session_deck_cards')
      .insert({
        session_id: sessionId,
        position: params.position,
        card_id: null,
        card_type: 'curated',
        curated_payload: pickedCard,
        pill_label: params.experienceType,
        degraded_from: params.degradedFrom ?? null,
        generated_at_version: sessionRow.deck_version,
      });
    if (insertRes.error && insertRes.error.code !== '23505') {
      return json({
        success: false,
        card: null,
        cards: [],
        error_class: 'pipeline_error',
        http_status: 500,
        sourceBreakdown: { path: 'pipeline-error', reason: insertRes.error.message },
      }, 500);
    }

    const rowRes = await supabaseAdmin
      .from('session_deck_cards')
      .select('card_id, card_type, curated_payload, generated_at_version, degraded_from, pill_label')
      .eq('session_id', sessionId)
      .eq('position', params.position)
      .maybeSingle();
    if (rowRes.error || !rowRes.data) {
      return json({
        success: false,
        card: null,
        cards: [],
        error_class: 'pipeline_error',
        http_status: 500,
        sourceBreakdown: { path: 'pipeline-error', reason: rowRes.error?.message ?? 'missing_positional_row_after_insert' },
      }, 500);
    }

    return await successResponse({
      row: rowRes.data as SessionDeckCardRow,
      position: params.position,
    });
  };

  const decision = decideTypeAndPill({
    position: targetPosition,
    categories: collabCategories,
    intents: collabIntents,
  });

  if (!decision) {
    if (targetPosition % 2 === 0 && collabCategories.length > 0) {
      const fallbackPill = await pickNextSinglePill();
      if (fallbackPill) {
        return await handleSinglePosition({
          position: targetPosition,
          pill: fallbackPill,
          degradedFrom: collabIntents[0] ?? 'curated',
        });
      }
    }
    if (targetPosition % 2 === 1 && collabIntents.length > 0) {
      const fallbackIntent = await pickNextCuratedPill();
      if (fallbackIntent) {
        return await handleCuratedPosition({
          position: targetPosition,
          experienceType: fallbackIntent,
          degradedFrom: collabCategories[0] ?? 'single',
        });
      }
    }
    return deadEnd({
      position: targetPosition,
      reason: 'all_pools_exhausted',
      acceptedCount: agg.acceptedCount,
      pendingGpsUserIds,
      detail: 'Both single and curated rotations are empty.',
    });
  }

  if (decision.type === 'curated') {
    return await handleCuratedPosition({
      position: targetPosition,
      experienceType: decision.pill,
    });
  }

  return await handleSinglePosition({
    position: targetPosition,
    pill: decision.pill,
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

    // ORCH-0909: collab routing (single-shot positional cutover, no dual path).
    // • body.session_id + numeric current_position → positional shared deck
    // • old collab request shapes → HTTP 410, "Please update the app"
    // • neither → solo path unchanged
    const newCollabSessionId: string | undefined =
      typeof body.session_id === 'string' && body.session_id.length > 0
        ? body.session_id
        : undefined;
    const legacyCollabSessionId: string | undefined =
      typeof body.sessionId === 'string' && body.sessionId.length > 0
        ? body.sessionId
        : undefined;

    const hasOldCollabVersionParam =
      Object.prototype.hasOwnProperty.call(body, 'expected' + '_deck_version');

    if (newCollabSessionId && typeof body.current_position === 'number') {
      const supabaseAdminForCollab = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      return await handleDeterministicV2({
        supabaseAdmin: supabaseAdminForCollab,
        sessionId: newCollabSessionId,
        currentPosition: body.current_position,
        req,
        t0,
      });
    }

    if ((newCollabSessionId && hasOldCollabVersionParam) || legacyCollabSessionId) {
      console.warn(
        `[discover-cards] rejecting legacy collab client — ORCH-0909 positional shared-deck cutover`,
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: 'collab_legacy_client_unsupported',
          message: 'Please update the app to continue using collab sessions.',
          cards: [],
        }),
        {
          status: 410,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // ── Solo path: existing code unchanged ─────────────────────────────────
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
      dateWindows,  // ORCH-0446: array of date windows (legacy; unused in solo)
      sessionId,    // legacy field; always undefined here post-ORCH-0902 routing
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

    console.log(`[discover-cards] solo request: categories=[${categories}], batchSeed=${batchSeed}, limit=${limit}, mode=${travelMode}${dateWindows ? `, dateWindows=[${dateWindows}]` : ''}`);

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
    // ORCH-0903 (2026-05-21): radius computed from the unified TRAVEL_CONFIG
    // via radiusKmForConstraint(). Singles passes generosity=1.5 (50% wider
    // candidate pool than honest user cap — post-filter at line ~985 trims
    // back to user's stated constraint). Clamp ceiling bumped 50→100 km so
    // 45-60 min driving constraints can serve genuinely-long-range cards
    // when they exist; post-filter still enforces honest cap. Curated uses
    // generosity=1.0 (see generate-curated-experiences/index.ts).
    const maxDistKm = radiusKmForConstraint(travelConstraintValue, travelMode, 1.5);
    const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 100000);

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
          // META-ORCH-1009 Sub-B — also stamp signalId so the transformer can attach
          // the per-signal Gemini Q2 reasoning slice for the "Why we picked" section.
          bucket.set(row.place_id, { ...row, __displayCategory: task.displayCategory, __signalId: task.signalId });
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

    // ORCH-1065: fetch deck-eligible brand experiences ONCE (best-effort). Hoisted
    // ABOVE the zero-row branch so "auto-surface every published experience" holds
    // even when the place pool is empty (empty-pool early-return hazard, SPEC §3.1.4).
    // Bypasses place_pool/ai_signal_scores/run-signal-scorer entirely (COMMS-0018).
    const curatedUtcNowForExp = datetimePref ? new Date(datetimePref) : new Date();
    let experienceCards: ExperienceDeckCard[] = [];
    try {
      experienceCards = await fetchEligibleExperiences({
        supabaseAdmin,
        lat: location.lat,
        lng: location.lng,
        radiusMeters,
        signalIds: uniqueSignalIds,
        nowIso: curatedUtcNowForExp.toISOString(),
        excludeEventIds: excludeCardIds,
        limit: Math.min(limit, 30),
      });
    } catch (err) {
      // Best-effort: an experience-source failure MUST NOT degrade the place deck
      // and MUST NOT be converted to pool-empty/pipeline-error (INV-042).
      console.warn(`[discover-cards] experience source failed (tolerating): ${(err as Error).message}`);
    }

    if (interleavedRows.length === 0) {
      const elapsed = Date.now() - t0;
      // ORCH-1065: if the place pool is empty but experiences exist, return a
      // POPULATED path:'pipeline' deck built from experiences alone (NOT
      // pool-empty) — INV-043 explicit return.
      if (experienceCards.length > 0) {
        const expOnly = interleaveExperiencesIntoDeck([], experienceCards);
        console.log(`[discover-cards] exit path=pipeline source=experiences-only experiences=${experienceCards.length} elapsed_ms=${elapsed} mode=solo`);
        return new Response(JSON.stringify({
          success: true,
          cards: expOnly,
          total: expOnly.length,
          source: 'experiences-only',
          metadata: {
            hasMore: false,
            poolSize: expOnly.length,
            batchSeed: batchSeed ?? 0,
          },
          sourceBreakdown: {
            fromPool: expOnly.length,
            fromApi: 0,
            totalServed: expOnly.length,
            apiCallsMade: 0,
            cacheHits: 0,
            gapCategories: [],
            reason: `Place pool empty; ${experienceCards.length} brand experiences surfaced`,
            path: 'pipeline',
            experienceCount: experienceCards.length,
          },
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
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
        row.__signalId, // META-ORCH-1009 Sub-B: per-signal reasoning lookup
      );
      if (card.distanceKm === null) _placesMissingCoords++;
      return card;
    });
    if (_placesMissingCoords > 0) {
      console.warn(`[discover-cards] ${_placesMissingCoords}/${rawCards.length} places had null lat/lng — distance/travelTime set to null`);
    }

    // ORCH-0903 (2026-05-21): post-radius display-aware filter. The
    // user's travelConstraintValue is the binding ceiling on displayed
    // travel-time. The candidate radius above is intentionally wider
    // (generosity=1.5×) than the honest user cap so round-robin
    // interleave has depth — this filter trims any candidate whose
    // computed display value exceeds the cap. Null-coord cards (travelTimeMin
    // === null) PASS because I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME hides
    // the badge on mobile and the user has no displayed value to compare
    // against. Filter and display cannot disagree because both read from
    // TRAVEL_CONFIG in _shared/distanceMath.ts.
    const constraintFilteredCards = rawCards.filter(
      (card: any) =>
        card.travelTimeMin === null || card.travelTimeMin <= travelConstraintValue,
    );
    const _droppedByTravelTimeFilter = rawCards.length - constraintFilteredCards.length;
    if (_droppedByTravelTimeFilter > 0) {
      console.log(`[discover-cards] travel-time post-filter dropped ${_droppedByTravelTimeFilter}/${rawCards.length} cards exceeding ${travelConstraintValue}-min ${travelMode} cap`);
    }

    // Step 10: date/time + curated-hours filter (preserved from legacy path).
    const timeFilteredCards = dateWindows && dateWindows.length > 0
      ? filterByDateWindows(constraintFilteredCards, dateWindows, datetimePref, selectedDates)
      : filterByDateTime(constraintFilteredCards, datetimePref, dateOption, selectedDates);
    // ORCH-1113: honor the date option in the curated cascade (live clock for
    // 'today'; open-at-any-hour for weekend/pick-dates) instead of evaluating
    // against the stale stored datetime_pref. dateOption + selectedDates are in
    // scope here (passed to filterByDateTime above), so reuse them.
    const curatedHoursPolicy = resolveCuratedHoursPolicy({ dateOption, datetimePref, selectedDates });
    const hoursFilteredCards = filterCuratedByStopHours(timeFilteredCards, curatedHoursPolicy);

    // Step 11: keep signal-score ranked order. ORCH-0902 CR-9: legacy collab
    // branch (place_id sort + zero matchScore for sessionId presence) was
    // DELETED — collab traffic exits at the top of the handler via
    // handleDeterministicV2 before this code runs. We do NOT call scorePoolCards
    // because the signal_score IS the match score; re-scoring would throw
    // away signal ranking in favor of chip-match heuristics.
    const finalCards = hoursFilteredCards;

    // ORCH-1065: front-load brand-authored experiences onto the deck — they LEAD
    // the deck (index 0..n-1, ahead of curated/singles) in stable RPC order
    // (operator-approved 2026-06-03). Additive — experiences never displace place
    // cards. Bypasses place_pool/ai_signal_scores/run-signal-scorer (COMMS-0018).
    const mergedCards = interleaveExperiencesIntoDeck(finalCards, experienceCards);

    const elapsed = Date.now() - t0;
    const perChipBreakdown: Record<string, number> = {};
    for (const [chip, arr] of perChipSorted) perChipBreakdown[chip] = arr.length;
    const filterMins: Record<string, number> = {};
    for (const t of chipTargets) filterMins[t.chip] = t.filterMin;
    console.log(`[discover-cards] exit path=pipeline source=signal-serving-v2-multi-chip chips=${categories.length} rpcs=${rpcTasks.length} failed=${failedTasks.length} pre=${rawCards.length} post=${finalCards.length} experiences=${experienceCards.length} merged=${mergedCards.length} elapsed_ms=${elapsed} mode=solo`);

    return new Response(JSON.stringify({
      success: true,
      cards: mergedCards,
      total: mergedCards.length,
      source: 'signal-serving-v2-multi-chip',
      metadata: {
        hasMore: finalCards.length === limit,
        poolSize: mergedCards.length,
        batchSeed: batchSeed ?? 0,
        perChipBreakdown,
      },
      sourceBreakdown: {
        fromPool: mergedCards.length,
        fromApi: 0,
        totalServed: mergedCards.length,
        apiCallsMade: 0,
        cacheHits: 0,
        gapCategories: [],
        reason: `Signal-served v2 multi-chip: ${categories.length} chips, ${rpcTasks.length} RPCs (${failedTasks.length} failed)`,
        path: 'pipeline',
        signalIds: uniqueSignalIds,
        cohort: 'NEW',
        filterMins,
        droppedByTravelTimeFilter: _droppedByTravelTimeFilter,  // ORCH-0903 telemetry
        experienceCount: experienceCards.length,  // ORCH-1065 telemetry
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
