import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { slugMeetsMinimum } from './priceTiers.ts';

// ── Geo Utilities ──────────────────────────────────────────────────────────
// ORCH-0659/0660: Re-export from the canonical owner. I-DECK-CARD-CONTRACT-
// DISTANCE-AND-TIME enforces a single source of truth for distance +
// travel-time math across all edge functions.
export { haversineKm, estimateTravelMinutes } from './distanceMath.ts';

const TRAVEL_SPEEDS_KMH: Record<string, number> = {
  walking: 4.5, biking: 14, transit: 20, driving: 35,
};

// ── Duration Map ───────────────────────────────────────────────────────────

// ORCH-0434: Updated to new canonical slugs matching Phase 1 migrated database.
export const CATEGORY_DURATION_MINUTES: Record<string, number> = {
  brunch_lunch_casual: 60, upscale_fine_dining: 90, drinks_and_music: 60,
  icebreakers: 45, nature: 60, movies_theatre: 120,
  creative_arts: 90, play: 90, flowers: 15, groceries: 20,
};
export const CATEGORY_DEFAULT_DURATION = 60;

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
 * ORCH-0640: Rewritten to read `place_pool` directly (card_pool is dropped).
 * Enforces the 3-gate signal path:
 *   G1 is_servable = true      (Bouncer quality gate)
 *   G2 stored_photo_urls NOT NULL AND length > 0 AND NOT containing '__backfill_failed__'
 *   (G3 signal scoring happens on the serving path via query_servable_places_by_signal —
 *    this helper picks candidate alternatives and sorts by rating, which is the
 *    replace-curated-stop contract. It does NOT apply signal scoring.)
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
  const latDelta = clampedRadius / 111320;
  const lngDelta = clampedRadius / (111320 * Math.cos(refLat * Math.PI / 180));

  const { data, error } = await supabaseAdmin
    .from('place_pool')
    .select('id, google_place_id, name, address, lat, lng, rating, review_count, price_min, price_max, price_tier, price_tiers, opening_hours, website, stored_photo_urls, city_id, city, country, utc_offset_minutes, ai_categories, generative_summary, editorial_summary')
    .eq('is_servable', true)
    .contains('ai_categories', [categoryId])
    .gte('lat', refLat - latDelta)
    .lte('lat', refLat + latDelta)
    .gte('lng', refLng - lngDelta)
    .lte('lng', refLng + lngDelta)
    .not('stored_photo_urls', 'is', null)
    .order('rating', { ascending: false })
    .limit(100); // Fetch more than needed to filter

  if (error || !data) return { alternatives: [], totalAvailable: 0 };

  // Filter: must have real stored photos, not in exclude list, within budget
  const excludeSet = new Set(excludePlaceIds);
  const filtered = data.filter((place: any) => {
    // G3: stored photos must be real (non-empty array, no backfill-failed sentinel)
    const photos: unknown[] = Array.isArray(place.stored_photo_urls) ? place.stored_photo_urls : [];
    if (photos.length === 0) return false;
    if (photos.includes('__backfill_failed__')) return false;

    if (excludeSet.has(place.google_place_id)) return false;
    if ((place.price_min ?? 0) > budgetMax) return false;

    // Fine dining price floor
    if (categoryId === 'upscale_fine_dining') {
      const tiers: string[] = Array.isArray(place.price_tiers) ? place.price_tiers : [];
      const bestTier = tiers.length ? tiers[tiers.length - 1] : place.price_tier;
      if (bestTier && !slugMeetsMinimum(bestTier, 'bougie')) return false;
    }
    return true;
  });

  const totalAvailable = filtered.length;

  // Sort by distance from reference point (closest first)
  filtered.sort((a: any, b: any) => {
    const distA = haversineKm(refLat, refLng, a.lat ?? 0, a.lng ?? 0);
    const distB = haversineKm(refLat, refLng, b.lat ?? 0, b.lng ?? 0);
    return distA - distB;
  });

  // Take requested limit
  const selected = filtered.slice(0, limit);

  // Map to response format (shape preserved for mobile compatibility)
  const alternatives: StopAlternativeResult[] = selected.map((place: any) => {
    const dist = haversineKm(refLat, refLng, place.lat ?? 0, place.lng ?? 0);
    const photos: string[] = Array.isArray(place.stored_photo_urls) ? place.stored_photo_urls : [];
    const firstCategory: string =
      Array.isArray(place.ai_categories) && place.ai_categories.length > 0
        ? place.ai_categories[0]
        : 'place';
    const description: string =
      place.generative_summary ||
      place.editorial_summary ||
      `A great ${firstCategory.replace(/_/g, ' ')} worth visiting.`;
    return {
      placeId: place.google_place_id || '',
      placePoolId: place.id,
      placeName: place.name || 'Unknown Place',
      placeType: firstCategory,
      address: place.address || '',
      rating: place.rating ?? 0,
      reviewCount: place.review_count ?? 0,
      imageUrl: photos[0] || '',
      imageUrls: photos,
      priceLevelLabel: place.price_tiers?.[0] || place.price_tier || 'chill',
      priceTier: place.price_tiers?.[0] || place.price_tier || 'chill',
      priceTiers: place.price_tiers?.length ? place.price_tiers : (place.price_tier ? [place.price_tier] : ['chill']),
      priceMin: place.price_min ?? 0,
      priceMax: place.price_max ?? 0,
      openingHours: place.opening_hours || {},
      website: place.website || null,
      lat: place.lat ?? 0,
      lng: place.lng ?? 0,
      distanceFromRefKm: Math.round(dist * 100) / 100,
      aiDescription: description,
      estimatedDurationMinutes: CATEGORY_DURATION_MINUTES[firstCategory] || CATEGORY_DEFAULT_DURATION,
      city: place.city || null,
      country: place.country || null,
    };
  });

  return { alternatives, totalAvailable };
}
