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

const TRAVEL_SPEEDS_KMH: Record<string, number> = {
  walking: 4.5, biking: 14, transit: 20, driving: 35,
};

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
  },
): Promise<{ alternatives: StopAlternativeResult[]; totalAvailable: number }> {
  const { categoryId, refLat, refLng, travelMode, budgetMax, excludePlaceIds, limit } = params;

  // Compute search radius (same formula as curated generator)
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = Math.round((speedKmh * 1000 / 60) * 30); // 30min constraint
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // ORCH-0707: Resolve combo slug → filter signal. Throws on unknown slug
  // (Constitution #3: never silently fall back). Same map the curated pipeline
  // uses; replaces the prior `.contains('ai_categories', [categoryId])` filter
  // that could silently return empty results.
  const filterSignal = resolveFilterSignal(categoryId);
  const filterMin = resolveFilterMin(categoryId);

  // Use the same RPC the curated pipeline uses for selection. rankSignal =
  // filterSignal preserves the legacy "rating-then-distance" approximation
  // (no vibe override for replace flow — user is replacing within a slot,
  // not picking a new vibe).
  const candidates = await fetchSinglesForSignalRank(supabaseAdmin, {
    filterSignal,
    filterMin,
    rankSignal: filterSignal,
    centerLat: refLat,
    centerLng: refLng,
    radiusMeters: clampedRadius,
    limit: 100,
    requiredTypes: undefined,
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

  // Sort by distance from reference point (closest first) — same UX contract
  // as the prior implementation.
  filtered.sort((a, b) => {
    const distA = haversineKm(refLat, refLng, a.lat ?? 0, a.lng ?? 0);
    const distB = haversineKm(refLat, refLng, b.lat ?? 0, b.lng ?? 0);
    return distA - distB;
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
