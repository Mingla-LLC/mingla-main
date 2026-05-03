// ORCH-0707 — Signal-driven place selection helper.
// Single source of truth for "fetch and rank places by signal scores."
// Imported by generate-curated-experiences/index.ts AND _shared/stopAlternatives.ts.
//
// Extracted verbatim from generate-curated-experiences/index.ts:323-446 with two
// surgical edits per spec §3.A:
//   1. SELECT no longer pulls ai_categories
//   2. Row mapping no longer emits ai_categories/category/categories triple
//      (comboCategory is the canonical authority post-ORCH-0707;
//       see I-CURATED-LABEL-SOURCE in INVARIANT_REGISTRY.md)
//
// Function signature changed: supabaseAdmin is now an explicit first parameter
// (was closure-captured in the original generate-curated-experiences module).
// This makes the helper portable across edge functions.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SignalRankParams {
  filterSignal: string;
  filterMin: number;
  rankSignal: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  limit: number;
  requiredTypes?: string[]; // ORCH-0601: optional sub-filter (e.g., 'hiking_area','museum')
}

// Shape preserved verbatim from the original row-mapping output, MINUS the
// dropped ai_categories/category/categories triple.
export interface SignalRankResult {
  id: string;
  place_pool_id: string;
  google_place_id: string;
  title: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  review_count: number;
  price_level: number | null;
  price_min: number | null;
  price_max: number | null;
  price_tier: string | null;
  price_tiers: string[] | null;
  opening_hours: Record<string, unknown> | null;
  website: string | null;
  images: string[] | null;
  image_url: string | null;
  city_id: string | null;
  city: string | null;
  country: string | null;
  utc_offset_minutes: number | null;
  types: string[] | null;
  primary_type: string | null;
  _rankScore: number;
}

// ── Combo-slug → signal-id mapping tables (moved from generate-curated-experiences) ──
//
// [CRITICAL — ORCH-0643] Every signal named in this map MUST have:
//   (1) a row in signal_definitions with is_active=true and current_version_id set
//   (2) at least one row in place_scores (via run-signal-scorer)
// Before adding a new combo slug, verify both conditions via:
//   SELECT sd.id, COUNT(ps.place_id)
//   FROM signal_definitions sd
//   LEFT JOIN place_scores ps ON ps.signal_id = sd.id
//   WHERE sd.id = '<new_signal>'
//   GROUP BY sd.id;
// The `groceries` entry broke picnic-dates silently for weeks because
// the signal was never registered (ORCH-0643 v1 BLOCKED, v2.1 fixed).
// Do NOT add an entry here without confirming the signal scores exist.
//
// Mapping from combo category slug → filter signal. Chip slugs sometimes differ
// from signal ids (e.g., chip 'upscale_fine_dining' uses signal 'fine_dining').
export const COMBO_SLUG_TO_FILTER_SIGNAL: Record<string, string> = {
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
export const COMBO_SLUG_TYPE_FILTER: Record<string, string[]> = {
  hiking: ['hiking_area', 'state_park', 'nature_preserve', 'national_park', 'wildlife_refuge', 'scenic_spot'],
  museum: ['museum', 'art_museum'],
};

// Per-stop filter_min override. Most signals use 120; movies is 80 (tiny universe);
// flowers is 80 — keeps 2 boutique florists (Mio Kreations 155, Petal & Oak 102) + 12 Harris
// Teeter locations with florist tag (97-136) while filtering out noise leaks: Fresh Market
// (69, no florist tag), candy/chocolate/catering/bakery false positives scoring 50-66.
export const COMBO_SLUG_FILTER_MIN: Record<string, number> = {
  'movies': 80,
  'flowers': 80,
};

// ── Resolvers ────────────────────────────────────────────────────────────────

/**
 * Resolve a combo slug to its underlying signal_id. Throws on unknown slug
 * (Constitution #3: never silently fall back). Used by stopAlternatives.
 */
export function resolveFilterSignal(comboSlug: string): string {
  const sig = COMBO_SLUG_TO_FILTER_SIGNAL[comboSlug];
  if (!sig) {
    throw new Error(
      `[signalRankFetch] Unknown combo slug '${comboSlug}' — no entry in COMBO_SLUG_TO_FILTER_SIGNAL. ` +
      `Add it (with verified place_scores rows) before using.`,
    );
  }
  return sig;
}

/**
 * Resolve the per-slug filter_min override (default 120; movies/flowers = 80).
 */
export function resolveFilterMin(comboSlug: string): number {
  return COMBO_SLUG_FILTER_MIN[comboSlug] ?? 120;
}

// ── fetchSinglesForSignalRank ────────────────────────────────────────────────

/**
 * ORCH-0653 v3.2: single RPC call replaces v3/v3.1 multi-step PostgREST
 * pipeline. The RPC pushes the bbox + filter signal + rank signal query
 * into Postgres so we never pass thousands of IDs through .in() over
 * HTTP. Supabase edge proxy URL cap (~10-12KB) was rejecting v3.1's
 * 500-ID chunks (~20KB URL); chunking smaller (200 IDs) would have cost
 * ~25 sequential roundtrips per intent. The RPC = 2 roundtrips total
 * (RPC + small hydrate), no URL constraint, server-side composite index
 * on (signal_id, score) does the heavy lifting.
 *
 * Three-gate serving still enforced:
 *   G1: pp.is_servable = true (RPC WHERE)
 *   G2: ps_filter.score >= filter_min (RPC INNER JOIN ON)
 *   G3: real stored_photo_urls (post-block .filter, unchanged)
 */
export async function fetchSinglesForSignalRank(
  supabaseAdmin: SupabaseClient,
  params: SignalRankParams,
): Promise<SignalRankResult[]> {
  const {
    filterSignal,
    filterMin,
    rankSignal,
    centerLat,
    centerLng,
    radiusMeters,
    limit,
    requiredTypes,
  } = params;

  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(centerLat * Math.PI / 180));

  const { data: rankedPairs, error: rpcErr } = await supabaseAdmin.rpc(
    'fetch_local_signal_ranked',
    {
      p_filter_signal: filterSignal,
      p_filter_min: filterMin,
      p_rank_signal: rankSignal,
      p_lat_min: centerLat - latDelta,
      p_lat_max: centerLat + latDelta,
      p_lng_min: centerLng - lngDelta,
      p_lng_max: centerLng + lngDelta,
      p_required_types: requiredTypes ?? null,
      p_limit: limit * 2,
    },
  );

  // ORCH-0653: throw on error (Constitution #3); empty result still legitimate.
  if (rpcErr) {
    throw new Error(`[fetchSinglesForSignalRank] RPC fetch_local_signal_ranked (filter=${filterSignal}>=${filterMin} rank=${rankSignal} bbox=(${centerLat.toFixed(4)},${centerLng.toFixed(4)})±${Math.round(latDelta * 111320)}m types=${requiredTypes?.join('|') ?? 'any'}) failed: ${rpcErr.message}`);
  }
  if (!rankedPairs || rankedPairs.length === 0) return [];

  const rankedIds = (rankedPairs as Array<{ place_id: string; rank_score: number }>).map((p) => p.place_id);
  const rankScoreById = new Map<string, number>();
  for (const p of (rankedPairs as Array<{ place_id: string; rank_score: number }>)) {
    rankScoreById.set(p.place_id, Number(p.rank_score));
  }

  // Hydrate the small ranked set. rankedIds is bounded by limit*2 ≤ ~100,
  // well under any URL cap. No chunking needed.
  // ORCH-0707: ai_categories REMOVED from SELECT (deprecated; comboCategory is authority).
  const { data: places, error: placeErr } = await supabaseAdmin
    .from('place_pool')
    .select('id, google_place_id, name, address, lat, lng, rating, review_count, price_level, price_range_start_cents, price_range_end_cents, opening_hours, website, stored_photo_urls, photos, types, primary_type, utc_offset_minutes, city_id, city, country')
    .in('id', rankedIds);

  // ORCH-0653: throw on error (Constitution #3); empty result still legitimate.
  if (placeErr) {
    throw new Error(`[fetchSinglesForSignalRank] hydrate (place_pool .in over ${rankedIds.length} ranked IDs) failed: ${placeErr.message}`);
  }
  if (!places || places.length === 0) return [];

  // Reorder hydrated rows to match RPC's score-DESC order.
  const placeById = new Map<string, Record<string, unknown>>();
  for (const pp of (places as Array<Record<string, unknown>>)) {
    placeById.set(pp.id as string, pp);
  }
  const orderedPlaces = rankedIds
    .map((id) => placeById.get(id))
    .filter((pp): pp is Record<string, unknown> => Boolean(pp));

  // Apply G3 photo gate + shape each row as the assembler expects.
  // Historical card_pool schema fields (title, images, image_url, etc.) are
  // mapped from place_pool equivalents so generateCardsForType stays unchanged.
  const withScore: SignalRankResult[] = orderedPlaces
    .filter((pp) => {
      const urls = pp.stored_photo_urls as string[] | null;
      if (!Array.isArray(urls) || urls.length === 0) return false;
      if (urls.length === 1 && urls[0] === '__backfill_failed__') return false;
      return true;
    })
    .map((pp): SignalRankResult => ({
      // Identity — use place_pool_id for both id + place_pool_id so consumers
      // that key on either work. card_pool.id is gone; downstream code that
      // references card.id will get the place_pool UUID, which is unique.
      id: pp.id as string,
      place_pool_id: pp.id as string,
      google_place_id: pp.google_place_id as string,
      // Presentation (card_pool.title was a copy of place_pool.name)
      title: pp.name as string,
      address: pp.address as string,
      lat: pp.lat as number,
      lng: pp.lng as number,
      rating: pp.rating as number,
      review_count: pp.review_count as number,
      // Price — derive legacy min/max/tier from place_pool columns
      price_level: (pp.price_level as number | null) ?? null,
      price_min: pp.price_range_start_cents != null
        ? Math.floor((pp.price_range_start_cents as number) / 100)
        : null,
      price_max: pp.price_range_end_cents != null
        ? Math.floor((pp.price_range_end_cents as number) / 100)
        : null,
      price_tier: null,      // card_pool had this; assembler tolerates null
      price_tiers: null,
      // Hours + meta
      opening_hours: (pp.opening_hours as Record<string, unknown> | null) ?? null,
      website: (pp.website as string | null) ?? null,
      images: (pp.stored_photo_urls as string[] | null) ?? null,
      image_url: (pp.stored_photo_urls as string[] | null)?.[0] ?? null,
      city_id: (pp.city_id as string | null) ?? null,
      city: (pp.city as string | null) ?? null,
      country: (pp.country as string | null) ?? null,
      utc_offset_minutes: (pp.utc_offset_minutes as number | null) ?? null,
      // ai_categories deprecated post-ORCH-0707 — comboCategory is the authority.
      // Types + signal rank score
      types: (pp.types as string[] | null) ?? null,
      primary_type: (pp.primary_type as string | null) ?? null,
      _rankScore: rankScoreById.get(pp.id as string) ?? 0,
    }))
    .sort((a, b) => b._rankScore - a._rankScore)
    .slice(0, limit);

  return withScore;
}
