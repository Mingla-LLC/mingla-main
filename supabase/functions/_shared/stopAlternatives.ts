import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { slugMeetsMinimum } from './priceTiers.ts';

// ── Geo Utilities ──────────────────────────────────────────────────────────

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateTravelMinutes(distKm: number, travelMode: string): number {
  const config: Record<string, { speed: number; factor: number }> = {
    walking:   { speed: 4.5, factor: 1.3 },
    driving:   { speed: 35,  factor: 1.4 },
    transit:   { speed: 20,  factor: 1.3 },
    biking:    { speed: 14,  factor: 1.3 },
    bicycling: { speed: 14,  factor: 1.3 },
  };
  const { speed, factor } = config[travelMode] ?? config.walking;
  return Math.max(3, Math.round((distKm * factor / speed) * 60));
}

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
  cardPoolId: string;
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
    .from('card_pool')
    .select('id, place_pool_id, google_place_id, title, address, lat, lng, rating, review_count, price_min, price_max, price_tier, price_tiers, opening_hours, website, images, image_url, city_id, city, country, utc_offset_minutes, ai_categories, category, categories, description')
    .eq('is_active', true)
    .eq('card_type', 'single')
    .contains('categories', [categoryId])
    .gte('lat', refLat - latDelta)
    .lte('lat', refLat + latDelta)
    .gte('lng', refLng - lngDelta)
    .lte('lng', refLng + lngDelta)
    .order('rating', { ascending: false })
    .limit(100); // Fetch more than needed to filter

  if (error || !data) return { alternatives: [], totalAvailable: 0 };

  // Filter: must have images, not in exclude list, within budget
  const excludeSet = new Set(excludePlaceIds);
  let filtered = data.filter((card: any) => {
    if (!(card.images?.length > 0 || card.image_url)) return false;
    if (excludeSet.has(card.google_place_id)) return false;
    if (card.price_min > budgetMax) return false;
    // Fine dining price floor
    if (categoryId === 'upscale_fine_dining') {
      const bestTier = card.price_tiers?.length ? card.price_tiers[card.price_tiers.length - 1] : card.price_tier;
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

  // Map to response format
  const alternatives: StopAlternativeResult[] = selected.map((card: any) => {
    const dist = haversineKm(refLat, refLng, card.lat ?? 0, card.lng ?? 0);
    return {
      placeId: card.google_place_id || '',
      placePoolId: card.place_pool_id || '',
      cardPoolId: card.id,
      placeName: card.title || 'Unknown Place',
      placeType: card.category || 'place',
      address: card.address || '',
      rating: card.rating ?? 0,
      reviewCount: card.review_count ?? 0,
      imageUrl: card.image_url || card.images?.[0] || '',
      imageUrls: card.images || (card.image_url ? [card.image_url] : []),
      priceLevelLabel: card.price_tiers?.[0] || card.price_tier || 'chill',
      priceTier: card.price_tiers?.[0] || card.price_tier || 'chill',
      priceTiers: card.price_tiers?.length ? card.price_tiers : (card.price_tier ? [card.price_tier] : ['chill']),
      priceMin: card.price_min ?? 0,
      priceMax: card.price_max ?? 0,
      openingHours: card.opening_hours || {},
      website: card.website || null,
      lat: card.lat ?? 0,
      lng: card.lng ?? 0,
      distanceFromRefKm: Math.round(dist * 100) / 100,
      aiDescription: card.description || `A great ${(card.category || 'place').replace(/_/g, ' ')} worth visiting.`,
      estimatedDurationMinutes: CATEGORY_DURATION_MINUTES[card.category] || CATEGORY_DEFAULT_DURATION,
      city: card.city || null,
      country: card.country || null,
    };
  });

  return { alternatives, totalAvailable };
}
