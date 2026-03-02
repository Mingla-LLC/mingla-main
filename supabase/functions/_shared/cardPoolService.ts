/**
 * Card Pool Service — Pool-first pipeline for serving experience cards.
 *
 * Flow: query card_pool → exclude user impressions → serve instantly
 *       → only fetch from Google when pool is exhausted.
 *
 * Used by ALL edge functions that serve cards.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { batchSearchPlaces } from './placesCache.ts';
import { getPlaceTypesForCategory, resolveCategories } from './categoryPlaceTypes.ts';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface PoolQueryParams {
  supabaseAdmin: SupabaseClient;
  userId: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  categories: string[];            // Mingla categories (e.g., "Nature", "Casual Eats")
  budgetMin: number;
  budgetMax: number;
  limit: number;                   // how many cards to return (e.g., 20)
  cardType?: 'single' | 'curated';
  experienceType?: string;         // for curated: 'adventurous', 'romantic', etc.
  excludeCardIds?: string[];       // additional exclusions
}

export interface PoolQueryResult {
  cards: any[];                    // ready-to-serve card objects
  fromPool: number;                // count served from pool
  fromApi: number;                 // count freshly generated
  totalPoolSize: number;           // total matching cards in pool (before exclusion)
}

// ── Price mapping (matches new-generate-experience- pattern) ────────────────

const PRICE_LEVEL_TO_RANGE: Record<string, { min: number; max: number }> = {
  'PRICE_LEVEL_FREE':            { min: 0,   max: 0 },
  'PRICE_LEVEL_INEXPENSIVE':     { min: 0,   max: 25 },
  'PRICE_LEVEL_MODERATE':        { min: 15,  max: 75 },
  'PRICE_LEVEL_EXPENSIVE':       { min: 50,  max: 150 },
  'PRICE_LEVEL_VERY_EXPENSIVE':  { min: 100, max: 500 },
};

function priceLevelToRange(priceLevel: string | number | null | undefined): { min: number; max: number } {
  if (!priceLevel) return { min: 0, max: 0 };
  // Handle numeric levels (0-4)
  if (typeof priceLevel === 'number') {
    const levels = ['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'];
    return PRICE_LEVEL_TO_RANGE[levels[priceLevel] || 'PRICE_LEVEL_FREE'] || { min: 0, max: 0 };
  }
  return PRICE_LEVEL_TO_RANGE[priceLevel] || { min: 0, max: 0 };
}

// ── Helper: Google Places photo URL ─────────────────────────────────────────

function buildPhotoUrl(photoName: string, apiKey: string): string {
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${apiKey}`;
}

// ── Step 1: Get user's preference timestamp ─────────────────────────────────

async function getPreferencesUpdatedAt(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('preferences')
      .select('updated_at')
      .eq('profile_id', userId)
      .maybeSingle();
    return data?.updated_at || new Date(0).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

// ── Step 2: Query card_pool for matching unseen cards ───────────────────────

async function queryPoolCards(
  params: PoolQueryParams,
  prefUpdatedAt: string
): Promise<{ poolCards: any[]; totalPoolSize: number }> {
  const {
    supabaseAdmin, userId, lat, lng, radiusMeters,
    categories, budgetMin, budgetMax, limit,
    cardType = 'single', experienceType, excludeCardIds,
  } = params;

  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

  const resolvedCats = resolveCategories(categories);
  // For curated cards, categories span multiple types — skip category filter
  // (experienceType filter on line ~118-120 is sufficient)
  if (resolvedCats.length === 0 && cardType !== 'curated') {
    return { poolCards: [], totalPoolSize: 0 };
  }

  // Build the query using Supabase JS client
  let query = supabaseAdmin
    .from('card_pool')
    .select('*')
    .eq('is_active', true)
    .eq('card_type', cardType);

  // Only apply category filter if we have categories
  // (curated cards span multiple categories, so skip when empty)
  if (resolvedCats.length > 0) {
    query = query.overlaps('categories', resolvedCats);
  }

  query = query
    .gte('lat', lat - latDelta)
    .lte('lat', lat + latDelta)
    .gte('lng', lng - lngDelta)
    .lte('lng', lng + lngDelta)
    .lte('price_max', budgetMax)
    .gte('price_min', budgetMin)
    .order('popularity_score', { ascending: false })
    .limit(limit + 20); // fetch extra to account for impression filtering

  if (experienceType) {
    query = query.eq('experience_type', experienceType);
  }

  const { data: allMatching, error } = await query;

  if (error) {
    console.error('[card-pool] Query error:', error);
    return { poolCards: [], totalPoolSize: 0 };
  }

  const totalPoolSize = allMatching?.length || 0;

  if (!allMatching || allMatching.length === 0) {
    return { poolCards: [], totalPoolSize: 0 };
  }

  // Get user's impressions since last preference change
  const { data: impressions } = await supabaseAdmin
    .from('user_card_impressions')
    .select('card_pool_id')
    .eq('user_id', userId)
    .gte('created_at', prefUpdatedAt);

  const seenIds = new Set(
    (impressions || []).map((imp: any) => imp.card_pool_id)
  );

  // Also exclude explicitly passed card IDs
  if (excludeCardIds) {
    for (const id of excludeCardIds) seenIds.add(id);
  }

  // Filter out seen cards
  const unseen = allMatching.filter((card: any) => !seenIds.has(card.id));

  return {
    poolCards: unseen.slice(0, limit),
    totalPoolSize,
  };
}

// ── Step 3: Upsert a Google Place into place_pool ───────────────────────────

export async function upsertPlaceToPool(
  supabaseAdmin: SupabaseClient,
  place: any,
  apiKey: string,
  fetchedVia: string = 'nearby_search'
): Promise<string | null> {
  const googlePlaceId = place.id || place.placeId;
  if (!googlePlaceId) return null;

  const priceRange = priceLevelToRange(place.priceLevel);
  const photos = (place.photos || []).map((p: any) => ({
    name: p.name,
    widthPx: p.widthPx,
    heightPx: p.heightPx,
  }));

  const row = {
    google_place_id: googlePlaceId,
    name: place.displayName?.text || place.name || 'Unknown Place',
    address: place.formattedAddress || place.address || '',
    lat: place.location?.latitude ?? place.location?.lat ?? 0,
    lng: place.location?.longitude ?? place.location?.lng ?? 0,
    types: place.types || [],
    primary_type: place.primaryType || place.types?.[0] || null,
    rating: place.rating || place.userRating || 0,
    review_count: place.userRatingCount || place.reviewCount || 0,
    price_level: typeof place.priceLevel === 'string' ? place.priceLevel : null,
    price_min: priceRange.min,
    price_max: priceRange.max,
    opening_hours: place.regularOpeningHours || place.openingHours || null,
    photos: photos,
    website: place.websiteUri || place.website || null,
    raw_google_data: place,
    fetched_via: fetchedVia,
    last_detail_refresh: new Date().toISOString(),
    refresh_failures: 0,
    is_active: true,
  };

  const { data, error } = await supabaseAdmin
    .from('place_pool')
    .upsert(row, { onConflict: 'google_place_id' })
    .select('id')
    .single();

  if (error) {
    console.warn('[card-pool] Upsert place error:', error.message);
    // Try to fetch existing
    const { data: existing } = await supabaseAdmin
      .from('place_pool')
      .select('id')
      .eq('google_place_id', googlePlaceId)
      .maybeSingle();
    return existing?.id || null;
  }

  return data?.id || null;
}

// ── Step 4: Insert a card into card_pool ────────────────────────────────────

export async function insertCardToPool(
  supabaseAdmin: SupabaseClient,
  cardData: {
    placePoolId?: string;
    googlePlaceId?: string;
    cardType: 'single' | 'curated';
    title: string;
    category: string;
    categories: string[];
    description?: string;
    highlights?: string[];
    imageUrl?: string;
    images?: string[];
    address?: string;
    lat: number;
    lng: number;
    rating?: number;
    reviewCount?: number;
    priceMin?: number;
    priceMax?: number;
    openingHours?: any;
    // Curated-specific
    stopPlacePoolIds?: string[];
    stopGooglePlaceIds?: string[];
    curatedPairingKey?: string;
    experienceType?: string;
    stops?: any;
    tagline?: string;
    totalPriceMin?: number;
    totalPriceMax?: number;
    estimatedDurationMinutes?: number;
  }
): Promise<string | null> {
  const popularityScore = (cardData.rating || 0) * Math.log10((cardData.reviewCount || 0) + 1);

  const row: any = {
    card_type: cardData.cardType,
    place_pool_id: cardData.placePoolId || null,
    google_place_id: cardData.googlePlaceId || null,
    title: cardData.title,
    category: cardData.category,
    categories: cardData.categories,
    description: cardData.description || null,
    highlights: cardData.highlights || [],
    image_url: cardData.imageUrl || null,
    images: cardData.images || [],
    address: cardData.address || null,
    lat: cardData.lat,
    lng: cardData.lng,
    rating: cardData.rating || 0,
    review_count: cardData.reviewCount || 0,
    price_min: cardData.priceMin ?? 0,
    price_max: cardData.priceMax ?? 0,
    opening_hours: cardData.openingHours || null,
    popularity_score: popularityScore,
    is_active: true,
  };

  // Curated-specific fields
  if (cardData.cardType === 'curated') {
    row.stop_place_pool_ids = cardData.stopPlacePoolIds || [];
    row.stop_google_place_ids = cardData.stopGooglePlaceIds || [];
    row.curated_pairing_key = cardData.curatedPairingKey || null;
    row.experience_type = cardData.experienceType || null;
    row.stops = cardData.stops || null;
    row.tagline = cardData.tagline || null;
    row.total_price_min = cardData.totalPriceMin ?? 0;
    row.total_price_max = cardData.totalPriceMax ?? 0;
    row.estimated_duration_minutes = cardData.estimatedDurationMinutes ?? 0;
  }

  const { data, error } = await supabaseAdmin
    .from('card_pool')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    console.warn('[card-pool] Insert card error:', error.message);
    return null;
  }

  return data?.id || null;
}

// ── Step 5: Record impressions ──────────────────────────────────────────────

export async function recordImpressions(
  supabaseAdmin: SupabaseClient,
  userId: string,
  cardPoolIds: string[],
  batchNumber: number = 0
): Promise<void> {
  if (!userId || cardPoolIds.length === 0) return;

  const rows = cardPoolIds.map(id => ({
    user_id: userId,
    card_pool_id: id,
    batch_number: batchNumber,
  }));

  const { error } = await supabaseAdmin
    .from('user_card_impressions')
    .upsert(rows, { onConflict: 'user_id,card_pool_id', ignoreDuplicates: true });

  if (error) {
    console.warn('[card-pool] Record impressions error:', error.message);
  }
}

// ── Step 6: Update served counts ────────────────────────────────────────────

async function updateServedCounts(
  supabaseAdmin: SupabaseClient,
  cardPoolIds: string[]
): Promise<void> {
  if (cardPoolIds.length === 0) return;

  // Fire-and-forget update
  supabaseAdmin.rpc('', {}).then(() => {}).catch(() => {});

  // Use individual updates since we can't do served_count + 1 in bulk easily
  for (const id of cardPoolIds) {
    supabaseAdmin
      .from('card_pool')
      .update({ last_served_at: new Date().toISOString() })
      .eq('id', id)
      .then(() => {})
      .catch(() => {});
  }
}

// ── Step 7: Build a single card from a place_pool entry ─────────────────────

function buildSingleCardFromPlace(
  place: any,
  category: string,
  apiKey: string,
  description?: string,
  highlights?: string[]
): any {
  const primaryPhoto = place.photos?.[0];
  const imageUrl = primaryPhoto?.name
    ? buildPhotoUrl(primaryPhoto.name, apiKey)
    : null;

  const images = (place.photos || [])
    .slice(0, 5)
    .map((p: any) => p.name ? buildPhotoUrl(p.name, apiKey) : null)
    .filter((img: string | null) => img !== null);

  return {
    id: place.google_place_id || place.id,
    title: place.name,
    category,
    matchScore: 85,
    image: imageUrl || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
    images: images.length > 0 ? images : [imageUrl].filter(Boolean),
    rating: place.rating || 0,
    reviewCount: place.review_count || 0,
    travelTime: '15 min',
    distance: '3 km',
    priceRange: formatPriceRange(place.price_min, place.price_max),
    description: description || `A great ${category} spot to explore.`,
    highlights: highlights || ['Highly Rated', 'Popular Choice'],
    address: place.address || '',
    lat: place.lat,
    lng: place.lng,
    placeId: place.google_place_id,
    matchFactors: {},
    openingHours: place.opening_hours || null,
  };
}

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return 'Free';
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}

// ── Step 8: Convert a card_pool row to the API response format ──────────────

function poolCardToApiCard(card: any): any {
  if (card.card_type === 'curated') {
    return {
      id: card.id,
      cardType: 'curated',
      title: card.title,
      tagline: card.tagline || '',
      category: card.category,
      matchScore: card.base_match_score || 85,
      image: card.image_url || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
      images: card.images || [],
      rating: card.rating || 0,
      reviewCount: card.review_count || 0,
      priceRange: formatPriceRange(card.price_min, card.price_max),
      totalPriceMin: card.total_price_min || 0,
      totalPriceMax: card.total_price_max || 0,
      estimatedDurationMinutes: card.estimated_duration_minutes || 0,
      description: card.description || '',
      highlights: card.highlights || [],
      address: card.address || '',
      lat: card.lat,
      lng: card.lng,
      stops: card.stops || [],
      experienceType: card.experience_type || '',
      openingHours: card.opening_hours || null,
      _poolCardId: card.id,
    };
  }

  // Single card
  return {
    id: card.google_place_id || card.id,
    title: card.title,
    category: card.category,
    matchScore: card.base_match_score || 85,
    image: card.image_url || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
    images: card.images || [],
    rating: card.rating || 0,
    reviewCount: card.review_count || 0,
    travelTime: '15 min',
    distance: '3 km',
    priceRange: formatPriceRange(card.price_min, card.price_max),
    description: card.description || '',
    highlights: card.highlights || [],
    address: card.address || '',
    lat: card.lat,
    lng: card.lng,
    placeId: card.google_place_id,
    matchFactors: {},
    openingHours: card.opening_hours || null,
    _poolCardId: card.id,
  };
}

// ── MAIN ENTRY POINT ────────────────────────────────────────────────────────

export async function serveCardsFromPipeline(
  params: PoolQueryParams,
  googleApiKey: string,
  options?: {
    enrichWithAI?: boolean;
    openaiApiKey?: string;
    enrichFn?: (places: any[], categories: string[]) => Promise<any[]>;
    travelMode?: string;
    travelConstraintType?: string;
    travelConstraintValue?: number;
    datetimePref?: string;
  }
): Promise<PoolQueryResult> {
  const {
    supabaseAdmin, userId, lat, lng, radiusMeters,
    categories, budgetMin, budgetMax, limit,
    cardType = 'single', experienceType,
  } = params;

  const startTime = Date.now();
  const resolvedCats = resolveCategories(categories);

  console.log(`[card-pool] Pipeline start: userId=${userId}, categories=[${resolvedCats}], limit=${limit}, cardType=${cardType}`);

  // ── STEP 1: Get preference timestamp ──────────────────────────────────
  const prefUpdatedAt = await getPreferencesUpdatedAt(supabaseAdmin, userId);

  // ── STEP 2: Query pool ────────────────────────────────────────────────
  const { poolCards, totalPoolSize } = await queryPoolCards(params, prefUpdatedAt);

  console.log(`[card-pool] Pool query: ${poolCards.length} unseen of ${totalPoolSize} total matching`);

  // ── STEP 3: If pool has enough → serve directly ───────────────────────
  if (poolCards.length >= limit) {
    const served = poolCards.slice(0, limit);
    const servedIds = served.map((c: any) => c.id);
    const apiCards = served.map(poolCardToApiCard);

    // Record impressions + update counts (fire-and-forget)
    recordImpressions(supabaseAdmin, userId, servedIds).catch(() => {});
    updateServedCounts(supabaseAdmin, servedIds).catch(() => {});

    console.log(`[card-pool] Served ${apiCards.length} from pool (0 API calls) in ${Date.now() - startTime}ms`);
    return {
      cards: apiCards,
      fromPool: apiCards.length,
      fromApi: 0,
      totalPoolSize,
    };
  }

  // ── STEP 4: Gap analysis ──────────────────────────────────────────────
  const categoryCount: Record<string, number> = {};
  for (const card of poolCards) {
    categoryCount[card.category] = (categoryCount[card.category] || 0) + 1;
  }

  const cardsPerCategory = Math.max(2, Math.ceil(limit / Math.max(resolvedCats.length, 1)));
  const neededCategories: string[] = [];
  for (const cat of resolvedCats) {
    if ((categoryCount[cat] || 0) < cardsPerCategory) {
      neededCategories.push(cat);
    }
  }

  console.log(`[card-pool] Gap: need more cards for [${neededCategories}]`);

  // ── STEP 5: Fetch from Google for missing categories ──────────────────
  const gapCards: any[] = [];
  let apiCallCount = 0;

  if (neededCategories.length > 0 && googleApiKey) {
    // Collect all needed place types
    const typeMap: Record<string, string> = {}; // placeType → category
    const allTypes: string[] = [];

    for (const cat of neededCategories) {
      const types = getPlaceTypesForCategory(cat);
      // Use first 2 types per category for diversity
      for (const type of types.slice(0, 2)) {
        if (!typeMap[type]) {
          typeMap[type] = cat;
          allTypes.push(type);
        }
      }
    }

    // Batch search through the existing cache layer
    const { results: typeResults, apiCallsMade } = await batchSearchPlaces(
      supabaseAdmin,
      googleApiKey,
      allTypes,
      lat,
      lng,
      radiusMeters,
      { maxResultsPerType: 10, ttlHours: 24 }
    );
    apiCallCount = apiCallsMade;

    // Track google_place_ids already in pool cards to avoid duplicates
    const servedPlaceIds = new Set(poolCards.map((c: any) => c.google_place_id).filter(Boolean));

    // Process each type's results
    for (const [placeType, places] of Object.entries(typeResults)) {
      const category = typeMap[placeType];
      if (!category || !places || places.length === 0) continue;

      for (const place of places) {
        const googlePlaceId = place.id;
        if (!googlePlaceId || servedPlaceIds.has(googlePlaceId)) continue;
        servedPlaceIds.add(googlePlaceId);

        // Upsert to place_pool (fire-and-forget for speed, but await the first few for data)
        const placePoolId = await upsertPlaceToPool(supabaseAdmin, place, googleApiKey);

        // Build card display data
        const priceRange = priceLevelToRange(place.priceLevel);
        const primaryPhoto = place.photos?.[0];
        const imageUrl = primaryPhoto?.name
          ? buildPhotoUrl(primaryPhoto.name, googleApiKey)
          : null;

        const images = (place.photos || [])
          .slice(0, 5)
          .map((p: any) => p.name ? buildPhotoUrl(p.name, googleApiKey) : null)
          .filter((img: string | null) => img !== null);

        const title = place.displayName?.text || 'Unknown Place';
        const rating = place.rating || 0;
        const reviewCount = place.userRatingCount || 0;

        // Insert to card_pool
        const cardPoolId = await insertCardToPool(supabaseAdmin, {
          placePoolId: placePoolId || undefined,
          googlePlaceId,
          cardType: 'single',
          title,
          category,
          categories: [category],
          description: `A great ${category} spot to explore.`,
          highlights: ['Highly Rated', 'Popular Choice'],
          imageUrl,
          images: images as string[],
          address: place.formattedAddress || '',
          lat: place.location?.latitude || lat,
          lng: place.location?.longitude || lng,
          rating,
          reviewCount,
          priceMin: priceRange.min,
          priceMax: priceRange.max,
          openingHours: place.regularOpeningHours || null,
        });

        // Build API-format card
        gapCards.push({
          id: googlePlaceId,
          title,
          category,
          matchScore: 85,
          image: imageUrl || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
          images: images.length > 0 ? images : [imageUrl].filter(Boolean),
          rating,
          reviewCount,
          travelTime: '15 min',
          distance: '3 km',
          priceRange: formatPriceRange(priceRange.min, priceRange.max),
          description: `A great ${category} spot to explore.`,
          highlights: ['Highly Rated', 'Popular Choice'],
          address: place.formattedAddress || '',
          lat: place.location?.latitude || lat,
          lng: place.location?.longitude || lng,
          placeId: googlePlaceId,
          matchFactors: {},
          openingHours: place.regularOpeningHours || null,
          _poolCardId: cardPoolId,
        });
      }
    }
  }

  // ── STEP 6: Combine pool + fresh cards ────────────────────────────────
  const poolApiCards = poolCards.map(poolCardToApiCard);
  const allCards = [...poolApiCards, ...gapCards].slice(0, limit);

  // Record impressions for all served cards
  const allPoolIds = allCards
    .map((c: any) => c._poolCardId)
    .filter((id: string | undefined) => id);
  if (allPoolIds.length > 0) {
    recordImpressions(supabaseAdmin, userId, allPoolIds).catch(() => {});
    updateServedCounts(supabaseAdmin, allPoolIds).catch(() => {});
  }

  console.log(`[card-pool] Pipeline done: ${poolApiCards.length} from pool + ${gapCards.length} from API (${apiCallCount} API calls) in ${Date.now() - startTime}ms`);

  return {
    cards: allCards,
    fromPool: poolApiCards.length,
    fromApi: gapCards.length,
    totalPoolSize,
  };
}

// ── Serve curated cards from pool ───────────────────────────────────────────

export async function serveCuratedCardsFromPool(
  params: PoolQueryParams,
  googleApiKey: string,
): Promise<PoolQueryResult> {
  // For curated cards, query with card_type = 'curated'
  return serveCardsFromPipeline(
    { ...params, cardType: 'curated' },
    googleApiKey,
  );
}
