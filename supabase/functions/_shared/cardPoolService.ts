/**
 * Card Pool Service — Pool-first pipeline for serving experience cards.
 *
 * Flow: query card_pool → exclude user impressions → serve instantly
 *       → only fetch from Google when pool is exhausted.
 *
 * Used by ALL edge functions that serve cards.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  getPlaceTypesForCategory,
  resolveCategories,
  GLOBAL_EXCLUDED_PLACE_TYPES,
} from './categoryPlaceTypes.ts';
import { priceLevelToRange, googleLevelToTierSlug, PriceTierSlug } from './priceTiers.ts';
import { downloadAndStorePhotos, resolvePhotoUrl, resolveAllPhotoUrls } from './photoStorageService.ts';

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
  offset?: number;                 // skip this many unique cards before returning (for batch pagination)
  priceTiers?: PriceTierSlug[];    // price tier filter (e.g., ['chill', 'comfy'])
}

export interface PoolQueryResult {
  cards: any[];                    // ready-to-serve card objects
  fromPool: number;                // count served from pool
  fromApi: number;                 // count freshly generated
  totalPoolSize: number;           // DEPRECATED — kept for backward compat; equals totalUnseenCount now
  totalUnseenCount: number;        // total UNSEEN cards remaining in pool after this batch
  hasMore: boolean;                // true if more unseen cards exist beyond this batch
  diagnostics?: {                  // pipeline diagnostics for client-side logging
    reason: string;                // why the pool was sufficient or short
    gapCategories: string[];       // categories that were short (informational only)
    apiCallsMade: number;          // always 0 (Google calls are admin-managed now)
    poolQueried: number;           // how many came from pool before gap analysis
    limitRequested: number;        // the limit that was requested
  };
}

// ── Pool Maturity Check ─────────────────────────────────────────────────────

export interface PoolMaturityResult {
  isMature: boolean;
  totalCards: number;
  categoryCoverage: number;
  totalCategories: number;
  categoryBreakdown: Record<string, number>;
}

export async function checkPoolMaturity(
  supabaseAdmin: SupabaseClient,
  params: {
    lat: number;
    lng: number;
    radiusMeters: number;
    categories: string[];
    cardType?: 'single' | 'curated';
    minCardsPerCategory?: number;
    minTotalCards?: number;
  }
): Promise<PoolMaturityResult> {
  const { lat, lng, radiusMeters, categories, cardType = 'single' } = params;
  const minCardsPerCategory = params.minCardsPerCategory ?? 3;
  const minTotalCards = params.minTotalCards ?? 50;

  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

  const { data, error } = await supabaseAdmin
    .from('card_pool')
    .select('category')
    .eq('is_active', true)
    .eq('card_type', cardType)
    .gte('lat', lat - latDelta)
    .lte('lat', lat + latDelta)
    .gte('lng', lng - lngDelta)
    .lte('lng', lng + lngDelta)
    .in('category', categories);

  if (error || !data) {
    console.warn('[checkPoolMaturity] Query error:', error?.message);
    return {
      isMature: false,
      totalCards: 0,
      categoryCoverage: 0,
      totalCategories: categories.length,
      categoryBreakdown: {},
    };
  }

  // Build category breakdown
  const categoryBreakdown: Record<string, number> = {};
  for (const row of data) {
    categoryBreakdown[row.category] = (categoryBreakdown[row.category] || 0) + 1;
  }

  const totalCards = data.length;
  const categoryCoverage = categories.filter(
    cat => (categoryBreakdown[cat] || 0) >= minCardsPerCategory
  ).length;

  return {
    isMature: categoryCoverage >= categories.length && totalCards >= minTotalCards,
    totalCards,
    categoryCoverage,
    totalCategories: categories.length,
    categoryBreakdown,
  };
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

// ── Step 2: Query card_pool via SQL function (RC-002 fix) ──────────────────

async function queryPoolCards(
  params: PoolQueryParams,
  prefUpdatedAt: string
): Promise<{ poolCards: any[]; totalUnseenCount: number }> {
  const {
    supabaseAdmin, userId, lat, lng, radiusMeters,
    categories, budgetMin, budgetMax, limit,
    cardType = 'single', experienceType, excludeCardIds,
  } = params;

  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

  const resolvedCats = resolveCategories(categories);
  if (resolvedCats.length === 0 && cardType !== 'curated') {
    return { poolCards: [], totalUnseenCount: 0 };
  }

  const offset = params.offset || 0;

  const { data, error } = await supabaseAdmin.rpc('query_pool_cards', {
    p_user_id: userId,
    p_categories: resolvedCats.length > 0 ? resolvedCats : [],
    p_lat_min: lat - latDelta,
    p_lat_max: lat + latDelta,
    p_lng_min: lng - lngDelta,
    p_lng_max: lng + lngDelta,
    p_budget_max: budgetMax,
    p_card_type: cardType,
    p_experience_type: experienceType || null,
    p_pref_updated_at: prefUpdatedAt,
    p_exclude_card_ids: excludeCardIds || [],
    p_price_tiers: params.priceTiers && params.priceTiers.length > 0 ? params.priceTiers : [],
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error('[card-pool] SQL query error:', error);
    return { poolCards: [], totalUnseenCount: 0 };
  }

  if (!data || data.length === 0) {
    return { poolCards: [], totalUnseenCount: 0 };
  }

  // Each row has { card: JSONB, total_unseen: bigint }
  const poolCards = data.map((row: any) => row.card);
  const totalUnseenCount = Number(data[0]?.total_unseen ?? 0);

  return { poolCards, totalUnseenCount };
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

  const parsedOH = parseGoogleOpeningHours(place.regularOpeningHours || place.openingHours);

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
    opening_hours: parsedOH.hours ? { ...parsedOH.hours, _isOpenNow: parsedOH.isOpenNow } : null,
    photos: photos,
    website: place.websiteUri || place.website || null,
    raw_google_data: place,
    fetched_via: fetchedVia,
    price_tier: googleLevelToTierSlug(place.priceLevel),
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

  // Fire-and-forget: download photos to Supabase Storage (never blocks card serving)
  if (photos.length > 0 && apiKey) {
    downloadAndStorePhotos(supabaseAdmin, googlePlaceId, photos, apiKey).catch(() => {});
  }

  return data?.id || null;
}

// ── Step 3: Insert a card into card_pool ────────────────────────────────────

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
    shoppingList?: string[] | null;
    website?: string | null;
    priceTier?: PriceTierSlug;
    priceLevel?: string;
  }
): Promise<string | null> {
  // CRIT-001: Curated cards with no stops are invalid — reject before insert
  if (cardData.cardType === 'curated' && (!cardData.stopPlacePoolIds || cardData.stopPlacePoolIds.length === 0)) {
    console.warn('[card-pool] Rejected curated card with zero stopPlacePoolIds');
    return null;
  }

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
    website: cardData.website || null,
    price_tier: cardData.priceTier ?? googleLevelToTierSlug(cardData.priceLevel),
    popularity_score: popularityScore,
    is_active: true,
  };

  // Curated-specific fields (stop references now live in card_pool_stops)
  if (cardData.cardType === 'curated') {
    row.curated_pairing_key = cardData.curatedPairingKey || null;
    row.experience_type = cardData.experienceType || null;
    row.stops = cardData.stops || null;
    row.tagline = cardData.tagline || null;
    row.total_price_min = cardData.totalPriceMin ?? 0;
    row.total_price_max = cardData.totalPriceMax ?? 0;
    row.estimated_duration_minutes = cardData.estimatedDurationMinutes ?? 0;
    row.shopping_list = cardData.shoppingList || null;
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

  const cardId = data?.id || null;

  // Insert normalized stop references for curated cards
  if (cardId && cardData.cardType === 'curated' && cardData.stopPlacePoolIds?.length) {
    const stopRows = cardData.stopPlacePoolIds.map((placePoolId: string, i: number) => ({
      card_pool_id: cardId,
      place_pool_id: placePoolId,
      google_place_id: cardData.stopGooglePlaceIds?.[i] || '',
      stop_order: i,
    }));

    const { error: stopsError } = await supabaseAdmin
      .from('card_pool_stops')
      .insert(stopRows);

    if (stopsError) {
      console.error('[card-pool] Insert stops error:', stopsError.message);
      // Card without stops is invalid — delete it
      await supabaseAdmin.from('card_pool').delete().eq('id', cardId);
      return null;
    }
  }

  return cardId;
}

// ── Step 4: Record impressions ──────────────────────────────────────────────

export async function recordImpressions(
  supabaseAdmin: SupabaseClient,
  userId: string,
  cardPoolIds: string[],
  batchNumber: number = 0
): Promise<void> {
  if (!userId || cardPoolIds.length === 0) return;

  const { error } = await supabaseAdmin.rpc('record_card_impressions', {
    p_user_id: userId,
    p_card_pool_ids: cardPoolIds,
    p_batch_number: batchNumber,
  });

  if (error) {
    console.warn('[card-pool] Record impressions error:', error.message);
  }
}

// ── Step 5: Update served counts ────────────────────────────────────────────

async function updateServedCounts(
  supabaseAdmin: SupabaseClient,
  cardPoolIds: string[]
): Promise<void> {
  if (cardPoolIds.length === 0) return;
  supabaseAdmin
    .from('card_pool')
    .update({ last_served_at: new Date().toISOString() })
    .in('id', cardPoolIds)
    .then(() => {}, () => {});
}

// ── Step 6: Build a single card from a place_pool entry ─────────────────────

function buildSingleCardFromPlace(
  place: any,
  category: string,
  apiKey: string,
  description?: string,
  highlights?: string[],
  userLat?: number,
  userLng?: number,
  travelMode?: string,
): any {
  // Prefer stored Supabase URLs over Google photo references
  const imageUrl = resolvePhotoUrl(
    place.stored_photo_urls,
    place.photos?.[0]?.name,
    apiKey,
  );

  const images = resolveAllPhotoUrls(
    place.stored_photo_urls,
    place.photos,
    apiKey,
  );

  const { hours: parsedHours, isOpenNow } = resolveOpeningHours(place.opening_hours);

  let distanceKm = 0;
  let travelTimeMin = 0;
  if (userLat != null && userLng != null && place.lat != null && place.lng != null) {
    distanceKm = Math.round(haversine(userLat, userLng, place.lat, place.lng) * 100) / 100;
    travelTimeMin = estimateTravelMin(distanceKm, travelMode);
  }

  return {
    id: place.google_place_id || place.id,
    placeId: place.google_place_id,
    title: place.name,
    category,
    matchScore: 85,
    image: imageUrl || null,
    images: images.length > 0 ? images : [imageUrl].filter(Boolean),
    rating: place.rating || 0,
    reviewCount: place.review_count || 0,
    priceMin: place.price_min ?? 0,
    priceMax: place.price_max ?? 0,
    distanceKm,
    travelTimeMin,
    travelMode: travelMode || 'walking',
    isOpenNow,
    openingHours: parsedHours,
    description: description || `A great ${category} spot to explore.`,
    highlights: highlights || ['Highly Rated', 'Popular Choice'],
    address: place.address || '',
    lat: place.lat,
    lng: place.lng,
    placeType: place.primary_type || 'place',
    placeTypeLabel: (place.primary_type || '').replace(/_/g, ' '),
    website: place.website || null,
    priceTier: place.price_tier ?? googleLevelToTierSlug(place.price_level),
    matchFactors: {},
  };
}

function formatPriceRange(min: number, max: number): string {
  if (min === 0 && max === 0) return 'Free';
  if (min === max) return `$${min}`;
  return `$${min}-$${max}`;
}

// ── Haversine distance (km) ─────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Travel time estimate (minutes) ──────────────────────────────────────────

const SPEED_KMH: Record<string, number> = {
  walking: 4.5,
  driving: 35,
  transit: 20,
  bicycling: 14,
  biking: 14,
};

function estimateTravelMin(distKm: number, mode: string = 'walking'): number {
  const speed = SPEED_KMH[mode] || 4.5;
  return Math.max(1, Math.round((distKm / speed) * 60 * 1.3));
}

// ── Parse raw Google regularOpeningHours into Record<string, string> ────────

function parseGoogleOpeningHours(
  roh: any
): { hours: Record<string, string> | null; isOpenNow: boolean | null } {
  if (!roh) return { hours: null, isOpenNow: null };
  if (!roh.weekdayDescriptions && roh.openNow == null) return { hours: null, isOpenNow: null };

  const hours: Record<string, string> = {};
  for (const desc of roh.weekdayDescriptions ?? []) {
    const [day, ...rest] = desc.split(': ');
    if (day) hours[day.toLowerCase()] = rest.join(': ');
  }

  return {
    hours: Object.keys(hours).length > 0 ? hours : null,
    isOpenNow: roh.openNow ?? null,
  };
}

/**
 * Resolves opening hours from either raw Google format or already-parsed pool format.
 * Pool storage uses Record<string, string> with optional _isOpenNow sentinel.
 * Raw Google uses { weekdayDescriptions: string[], openNow?: boolean }.
 */
function resolveOpeningHours(openingHours: any): { hours: Record<string, string> | null; isOpenNow: boolean | null } {
  if (!openingHours) return { hours: null, isOpenNow: null };

  // Raw Google format — has weekdayDescriptions key
  if (openingHours.weekdayDescriptions) {
    return parseGoogleOpeningHours(openingHours);
  }

  // Already parsed Record<string, string> from pool storage
  if (typeof openingHours === 'object') {
    const { _isOpenNow, ...hourEntries } = openingHours;
    return {
      hours: Object.keys(hourEntries).length > 0 ? hourEntries : null,
      isOpenNow: _isOpenNow ?? null,
    };
  }

  return { hours: null, isOpenNow: null };
}

// ── Step 7: Convert a card_pool row to the API response format ──────────────

function poolCardToApiCard(
  card: any,
  userLat?: number,
  userLng?: number,
  travelMode?: string,
): any {
  if (card.card_type === 'curated') {
    return {
      id: card.id,
      cardType: 'curated',
      title: card.title,
      tagline: card.tagline || '',
      category: card.category,
      matchScore: card.match_score ?? card.base_match_score ?? 85,
      image: resolvePhotoUrl(card.stored_photo_urls, card.photos?.[0]?.name, '') || card.stops?.[0]?.imageUrl || null,
      images: resolveAllPhotoUrls(card.stored_photo_urls, card.photos, ''),
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
      shoppingList: card.shopping_list || null,
      experienceType: card.experience_type || '',
      openingHours: resolveOpeningHours(card.opening_hours).hours,
      website: card.website || null,
      priceTier: card.price_tier ?? 'chill',
      oneLiner: card.one_liner || null,
      tip: card.tip || null,
      scoringFactors: card.scoring_factors || null,
      teaserText: card.teaser_text || null,
      _poolCardId: card.id,
    };
  }

  // Single card — output must match discover-cards API format
  const { hours: parsedHours, isOpenNow } = resolveOpeningHours(card.opening_hours);

  // Compute real distance if user location is available
  // Use explicit null checks (not truthy) so lat/lng of exactly 0 still works
  let distanceKm = 0;
  let travelTimeMin = 0;
  if (userLat != null && userLng != null && card.lat != null && card.lng != null) {
    distanceKm = Math.round(haversine(userLat, userLng, card.lat, card.lng) * 100) / 100;
    travelTimeMin = estimateTravelMin(distanceKm, travelMode);
  }

  return {
    id: card.google_place_id || card.id,
    placeId: card.google_place_id || null,
    title: card.title,
    category: card.category,
    matchScore: card.match_score ?? card.base_match_score ?? 85,
    image: resolvePhotoUrl(card.stored_photo_urls, card.photos?.[0]?.name, '') || null,
    images: resolveAllPhotoUrls(card.stored_photo_urls, card.photos, ''),
    rating: card.rating || 0,
    reviewCount: card.review_count || 0,
    priceMin: card.price_min ?? 0,
    priceMax: card.price_max ?? 0,
    distanceKm,
    travelTimeMin,
    travelMode: travelMode || 'walking',
    isOpenNow,
    openingHours: parsedHours,
    description: card.description || '',
    highlights: card.highlights || [],
    address: card.address || '',
    lat: card.lat,
    lng: card.lng,
    placeType: card.primary_type || 'place',
    placeTypeLabel: card.primary_type ? card.primary_type.replace(/_/g, ' ') : '',
    website: card.website || null,
    priceTier: card.price_tier ?? 'chill',
    oneLiner: card.one_liner || null,
    tip: card.tip || null,
    scoringFactors: card.scoring_factors || null,
    matchFactors: {},
    _poolCardId: card.id,
  };
}

// ── Helper: Increment place impressions in batch ──────────────────────────

async function incrementPlaceImpressions(
  supabaseAdmin: SupabaseClient,
  cardPoolIds: string[]
): Promise<void> {
  if (cardPoolIds.length === 0) return;

  try {
    // Get google_place_ids for these cards
    const { data: cards } = await supabaseAdmin
      .from('card_pool')
      .select('google_place_id')
      .in('id', cardPoolIds);

    if (!cards || cards.length === 0) return;

    // Deduplicate place IDs (one place may have multiple cards)
    const placeIds = [...new Set(
      cards
        .map((c: any) => c.google_place_id)
        .filter((id: string | null | undefined): id is string => Boolean(id))
    )];

    // Increment each place's total_impressions (fire-and-forget per place)
    for (const gpid of placeIds) {
      supabaseAdmin.rpc('increment_place_engagement', {
        p_google_place_id: gpid,
        p_field: 'total_impressions',
        p_amount: 1,
      }).then(() => {}, () => {});
    }
  } catch {
    // Entire helper is fire-and-forget; never propagate errors
  }
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

  // ── STEP 2: Query pool (SQL-level pagination + impression exclusion) ──
  let { poolCards, totalUnseenCount } = await queryPoolCards(params, prefUpdatedAt);
  const totalPoolSize = totalUnseenCount; // backward compat alias

  console.log(`[card-pool] Pool query: ${poolCards.length} cards returned, ${totalUnseenCount} total unseen`);

  // Filter excluded place types from pool results.
  // Belt-and-suspenders: the SQL query_pool_cards already excludes globally
  // banned types, but pool cards lack a full `types` array — only `primary_type`
  // is available. This filter catches any card whose primary_type is banned
  // (e.g. gym, fitness_center, dog_park) even if the SQL-level filter was bypassed.
  const globalSet = new Set(GLOBAL_EXCLUDED_PLACE_TYPES);

  poolCards = poolCards.filter((card: any) => {
    // Check primary_type against global exclusions (works on pool cards)
    if (card.primary_type && globalSet.has(card.primary_type)) return false;

    if (card.card_type === 'curated' && card.stops) {
      return !card.stops.some((stop: any) => {
        const stopTypes = stop.placeType ? [stop.placeType] : (stop.types ?? []);
        return stopTypes.some((t: string) => globalSet.has(t));
      });
    }
    const types = card.types ?? card.place_types ?? [];
    return !types.some((t: string) => globalSet.has(t));
  });

  // ── STEP 3: If pool has enough → serve directly ───────────────────────
  if (poolCards.length >= limit) {
    const served = poolCards.slice(0, limit);
    const servedIds = served.map((c: any) => c.id);
    const apiCards = served.map(c => poolCardToApiCard(c, lat, lng, options?.travelMode));

    // Record impressions SYNCHRONOUSLY to prevent cross-batch duplicates (CF-002 fix)
    await recordImpressions(supabaseAdmin, userId, servedIds);
    updateServedCounts(supabaseAdmin, servedIds).catch(() => {});
    supabaseAdmin.rpc('increment_user_engagement', {
      p_user_id: userId,
      p_field: 'total_cards_seen',
      p_amount: servedIds.length,
    }).then(() => {}, () => {});
    incrementPlaceImpressions(supabaseAdmin, servedIds).catch(() => {});

    // hasMore based on UNSEEN count, not raw pool size (RC-003 fix)
    const remainingUnseen = totalUnseenCount - served.length;

    console.log(`[card-pool] Served ${apiCards.length} from pool (0 API calls) in ${Date.now() - startTime}ms`);
    return {
      cards: apiCards,
      fromPool: apiCards.length,
      fromApi: 0,
      totalPoolSize,
      totalUnseenCount: remainingUnseen,
      hasMore: remainingUnseen > 0,
      diagnostics: {
        reason: `Pool had ${poolCards.length} unseen cards (needed ${limit}) — sufficient, no Google query`,
        gapCategories: [],
        apiCallsMade: 0,
        poolQueried: poolCards.length,
        limitRequested: limit,
      },
    };
  }

  // ── Pool insufficient: serve what we have ───────────────────────────
  const served = poolCards.slice(0, limit);
  const servedIds = served.map((c: any) => c.id);
  const apiCards = served.map(c => poolCardToApiCard(c, lat, lng, options?.travelMode));

  // Record impressions for pool cards we're serving
  if (servedIds.length > 0) {
    await recordImpressions(supabaseAdmin, userId, servedIds);
    updateServedCounts(supabaseAdmin, servedIds).catch(() => {});
    supabaseAdmin.rpc('increment_user_engagement', {
      p_user_id: userId,
      p_field: 'total_cards_seen',
      p_amount: servedIds.length,
    }).then(() => {}, () => {});
    incrementPlaceImpressions(supabaseAdmin, servedIds).catch(() => {});
  }

  const remainingUnseen = Math.max(0, totalUnseenCount - served.length);

  console.log(`[card-pool] Pool-only: served ${apiCards.length} from pool (0 API calls) in ${Date.now() - startTime}ms`);
  return {
    cards: apiCards,
    fromPool: apiCards.length,
    fromApi: 0,
    totalPoolSize,
    totalUnseenCount: remainingUnseen,
    hasMore: remainingUnseen > 0,
    diagnostics: {
      reason: `Pool had ${poolCards.length}/${limit} cards — served pool-only`,
      gapCategories: [],
      apiCallsMade: 0,
      poolQueried: poolCards.length,
      limitRequested: limit,
    },
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
