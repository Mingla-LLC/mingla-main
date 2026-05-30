// ORCH-0707: signal-driven rewrite. Selection no longer reads
// place_pool.ai_categories — uses fetchSinglesForSignalRank (the same RPC the
// curated pipeline uses for selection) so curated and replace-stop flows agree.
// categoryId IS the authoritative label for every alternative (the user is
// replacing a slot of category X — every alternative is by definition X).
//
// See I-CURATED-LABEL-SOURCE in INVARIANT_REGISTRY.md.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { slugMeetsMinimum } from './priceTiers.ts';
import {
  fetchSinglesForSignalRank,
  resolveFilterSignal,
  resolveFilterMin,
  resolveTypeFilter,
  resolvePrimaryTypeGate,
} from './signalRankFetch.ts';
import {
  CATEGORY_DURATION_MINUTES,
  CATEGORY_DEFAULT_DURATION,
} from './curatedConstants.ts';

// ── Geo Utilities ──────────────────────────────────────────────────────────
// ORCH-0659/0660: Re-export from the canonical owner. I-DECK-CARD-CONTRACT-
// DISTANCE-AND-TIME enforces a single source of truth for distance + travel-
// time math across all edge functions.
import { haversineKm, estimateTravelMinutes } from './distanceMath.ts';
export { haversineKm, estimateTravelMinutes };

// ORCH-0985: fixed metro-scale search radius for stop replacement (decoupled
// from travel mode — see fetchStopAlternatives for why). 25km comfortably covers
// a metropolitan area around the stop being replaced.
const REPLACE_SEARCH_RADIUS_METERS = 25000;

// ORCH-0985: score-band size for ordering. Alternatives are ordered best-score-
// first; places whose rank-signal scores fall in the same band are treated as
// comparable and ordered by distance (closest first). 5 points ≈ "comparable".
const SCORE_BAND = 5;

// ── Fetch Alternatives ─────────────────────────────────────────────────────

export interface StopAlternativeResult {
  placeId: string;
  placePoolId: string;
  placeName: string;
  placeType: string;
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string;
  imageUrls: string[];
  priceLevelLabel: string;
  priceTier: string;
  priceTiers: string[];
  priceMin: number;
  priceMax: number;
  openingHours: Record<string, unknown>;
  website: string | null;
  lat: number;
  lng: number;
  distanceFromRefKm: number;
  aiDescription: string;
  estimatedDurationMinutes: number;
  city: string | null;
  country: string | null;
}

/**
 * ORCH-0707: Rewritten to use signal-driven selection (place_scores) instead of
 * place_pool.ai_categories. Mirrors the curated pipeline's selection contract —
 * any candidate that scores ≥ filter_min on the slot's filter signal is
 * eligible. categoryId IS the authoritative label for every alternative
 * (the user is replacing a slot of category X — every alternative is by
 * definition category X).
 *
 * Three-gate serving still enforced:
 *   G1: pp.is_servable = true (RPC WHERE)
 *   G2: ps_filter.score >= filter_min (RPC INNER JOIN ON)
 *   G3: real stored_photo_urls (post-block .filter, unchanged)
 *
 * Throws on unknown categoryId via resolveFilterSignal (Constitution #3).
 */
export async function fetchStopAlternatives(
  supabaseAdmin: ReturnType<typeof createClient>,
  params: {
    categoryId: string;
    refLat: number;
    refLng: number;
    travelMode: string;
    budgetMax: number;
    excludePlaceIds: string[];
    limit: number;
    rankSignal?: string; // ORCH-0985: vibe rank signal stamped on the stop by the generator
  },
): Promise<{ alternatives: StopAlternativeResult[]; totalAvailable: number }> {
  const { categoryId, refLat, refLng, budgetMax, excludePlaceIds, limit, rankSignal } = params;

  // ORCH-0985: replace uses a fixed, generous search radius around the stop being
  // replaced — NOT a travel-mode-derived one. The travel-mode radius exists to
  // chain stops within ~30 min when BUILDING a route; for swapping a single stop
  // it just starves the result (a walking 2.25km radius hid every downtown
  // theatre in the Burning Coal case). A metro-scale radius returns the same
  // candidate set the deck would for this stop, ranked best-first below.
  const clampedRadius = REPLACE_SEARCH_RADIUS_METERS;

  // ORCH-0707: Resolve combo slug → filter signal. Throws on unknown slug
  // (Constitution #3: never silently fall back). Same map the curated pipeline
  // uses; replaces the prior `.contains('ai_categories', [categoryId])` filter
  // that could silently return empty results.
  const filterSignal = resolveFilterSignal(categoryId);
  const filterMin = resolveFilterMin(categoryId);

  // ORCH-0985: pass the slug's required-types narrowing through (hiking→trails,
  // museum→museums) so replace matches the curated generator instead of
  // returning a generic park / art class for those slots.
  const requiredTypes = resolveTypeFilter(categoryId);

  // ORCH-0990: pass the composite primary-type gate through so swapping a
  // "flowers" stop returns ONLY verified bouquet sources (primary_type='florist'
  // OR grocery/supermarket+florist-tag), matching the curated generator.
  // Constitution #13: generation and serving use the same gate. undefined for
  // every non-flowers slug → no-op in the RPC, behavior unchanged.
  const primaryTypeGate = resolvePrimaryTypeGate(categoryId);

  // ORCH-0985: rank by the vibe signal the generator stamped on the stop
  // (romantic/icebreakers/lively/scenic/picnic_friendly) so alternatives are
  // ordered by the SAME vibe the plan was built with. Filtering is always by the
  // category filter signal — only the ORDER changes. Older cards without a
  // stamped rankSignal fall back to the filter signal (documented compatibility
  // path, validated upstream in the edge function — Constitution #3).
  const effectiveRankSignal = rankSignal || filterSignal;

  const candidates = await fetchSinglesForSignalRank(supabaseAdmin, {
    filterSignal,
    filterMin,
    rankSignal: effectiveRankSignal,
    centerLat: refLat,
    centerLng: refLng,
    radiusMeters: clampedRadius,
    limit: 100,
    requiredTypes,
    primaryTypeRequired: primaryTypeGate?.primaryTypes,
    groceryFloralTag: primaryTypeGate?.groceryFloralTag,
  });

  // Filter: not in exclude list, within budget, fine-dining tier floor.
  // (G1 is_servable + G2 signal score gate + G3 photo gate are all enforced
  // upstream by fetchSinglesForSignalRank.)
  const excludeSet = new Set(excludePlaceIds);
  const filtered = candidates.filter((c) => {
    if (excludeSet.has(c.google_place_id)) return false;
    if ((c.price_min ?? 0) > budgetMax) return false;

    // Fine dining price floor — match curated-pipeline gate
    if (categoryId === 'upscale_fine_dining') {
      const tiers: string[] = Array.isArray(c.price_tiers) ? c.price_tiers : [];
      const bestTier = tiers.length ? tiers[tiers.length - 1] : c.price_tier;
      if (bestTier && !slugMeetsMinimum(bestTier, 'bougie')) return false;
    }
    return true;
  });

  const totalAvailable = filtered.length;

  // ORCH-0985: order best-score-first, distance as the tiebreaker among
  // comparable places. `_rankScore` is the slot's rank-signal score (the vibe
  // signal for curated cards). Places whose scores fall in the same SCORE_BAND
  // are treated as comparable and ordered closest-first. This is deterministic
  // and predictable — the best venues always lead — unlike the prior normalized
  // blend. (Bucketing keeps the comparator transitive.)
  const distByPlace = new Map<string, number>();
  for (const c of filtered) {
    distByPlace.set(c.id, haversineKm(refLat, refLng, c.lat ?? 0, c.lng ?? 0));
  }
  const band = (score: number): number => Math.floor((score ?? 0) / SCORE_BAND);
  filtered.sort((a, b) => {
    const bandDiff = band(b._rankScore ?? 0) - band(a._rankScore ?? 0); // higher score band first
    if (bandDiff !== 0) return bandDiff;
    return (distByPlace.get(a.id) ?? 0) - (distByPlace.get(b.id) ?? 0);  // then closest first
  });

  const selected = filtered.slice(0, limit);

  // Map to response format. categoryId IS the authoritative label —
  // every alternative is, by selection contract, of category=categoryId.
  // ORCH-0707 / I-CURATED-LABEL-SOURCE: NEVER derive label from ai_categories.
  const alternatives: StopAlternativeResult[] = selected.map((c) => {
    const dist = haversineKm(refLat, refLng, c.lat ?? 0, c.lng ?? 0);
    const photos: string[] = Array.isArray(c.images) ? c.images : [];
    const description: string =
      `A great ${categoryId.replace(/_/g, ' ')} worth visiting.`;
    return {
      placeId: c.google_place_id || '',
      placePoolId: c.id,
      placeName: c.title || 'Unknown Place',
      placeType: categoryId,
      address: c.address || '',
      rating: c.rating ?? 0,
      reviewCount: c.review_count ?? 0,
      imageUrl: photos[0] || '',
      imageUrls: photos,
      priceLevelLabel: c.price_tiers?.[0] || c.price_tier || 'chill',
      priceTier: c.price_tiers?.[0] || c.price_tier || 'chill',
      priceTiers: c.price_tiers?.length ? c.price_tiers : (c.price_tier ? [c.price_tier] : ['chill']),
      priceMin: c.price_min ?? 0,
      priceMax: c.price_max ?? 0,
      openingHours: (c.opening_hours as Record<string, unknown>) || {},
      website: c.website || null,
      lat: c.lat ?? 0,
      lng: c.lng ?? 0,
      distanceFromRefKm: Math.round(dist * 100) / 100,
      aiDescription: description,
      estimatedDurationMinutes: CATEGORY_DURATION_MINUTES[categoryId] ?? CATEGORY_DEFAULT_DURATION,
      city: c.city || null,
      country: c.country || null,
    };
  });

  return { alternatives, totalAvailable };
}
