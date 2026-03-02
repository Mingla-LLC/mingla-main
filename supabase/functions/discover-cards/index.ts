import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { batchSearchPlaces } from '../_shared/placesCache.ts';
import {
  serveCardsFromPipeline,
  upsertPlaceToPool,
  insertCardToPool,
  recordImpressions,
} from '../_shared/cardPoolService.ts';
import {
  resolveCategories,
  getPlaceTypesForCategory,
} from '../_shared/categoryPlaceTypes.ts';

/* ─────────────────────────────────────────────────────────────────────────────
 * discover-cards  –  Unified Card Discovery Edge Function
 *
 * Replaces 11 separate discover-{category} edge functions with a single
 * endpoint that handles ALL categories in one request.
 *
 * Pipeline:
 *   1. Pool-first: query card_pool for ALL requested categories at once
 *   2. Gap fill: if pool < 50% of limit, fetch missing from Google API
 *   3. AI descriptions OFF critical path: return immediately with fallbacks,
 *      then fire-and-forget OpenAI enrichment to card_pool
 *   4. Batch upsert results to place_pool + card_pool
 *   5. Record user impressions for served cards
 *
 * Supports:
 *   - Multi-category in one request (e.g. ["Nature", "Drink", "Casual Eats"])
 *   - Offset pagination via batchSeed * limit
 *   - warmPool mode: fetch + store, return empty
 *   - Travel constraint-based radius calculation
 *   - Budget, datetime, distance filtering
 * ──────────────────────────────────────────────────────────────────────────── */

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Category Fallback Descriptions ──────────────────────────────────────────
const CATEGORY_FALLBACK_DESCRIPTIONS: Record<string, string> = {
  'Nature': 'A beautiful [placeType] perfect for outdoor exploration.',
  'Drink': 'A popular [placeType] spot with great ambiance for drinks.',
  'Casual Eats': 'A well-loved [placeType] serving delicious casual fare.',
  'Fine Dining': 'An upscale [placeType] offering a refined dining experience.',
  'First Meet': 'A welcoming [placeType] ideal for a first meeting.',
  'Picnic': 'A lovely [placeType] perfect for a relaxing picnic outing.',
  'Watch': 'An exciting [placeType] for a fun entertainment experience.',
  'Creative & Arts': 'An inspiring [placeType] for creative exploration.',
  'Play': 'A thrilling [placeType] for fun and adventure.',
  'Wellness': 'A serene [placeType] for relaxation and wellness.',
  'Groceries & Flowers': 'A convenient [placeType] for all your essentials.',
  'Work & Business': 'A professional [placeType] for productive meetings.',
};

function getFallbackDescription(category: string, placeType: string): string {
  const template = CATEGORY_FALLBACK_DESCRIPTIONS[category]
    ?? 'A great [placeType] worth exploring.';
  return template.replace('[placeType]', formatPlaceType(placeType).toLowerCase());
}

// ── Types that are typically free / always open (skip hours filter) ──────────
const ALWAYS_OPEN_TYPES = new Set([
  'park', 'hiking_area', 'national_park', 'state_park', 'beach',
  'garden', 'botanical_garden',
]);

// ── Time Slot Ranges ────────────────────────────────────────────────────────
const TIME_SLOT_RANGES: Record<string, { start: number; end: number }> = {
  brunch:    { start: 9,  end: 13 },
  afternoon: { start: 12, end: 17 },
  dinner:    { start: 17, end: 21 },
  lateNight: { start: 21, end: 24 },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const SPEED_KMH: Record<string, number> = {
  walking: 4.5,
  driving: 35,
  transit: 20,
  bicycling: 14,
  biking: 14,
};

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

function estimateTravelMin(distKm: number, mode: string): number {
  const speed = SPEED_KMH[mode] || 4.5;
  return Math.max(1, Math.round((distKm / speed) * 60 * 1.3));
}

function priceLevelToLabel(level: string | undefined): string {
  const map: Record<string, string> = {
    PRICE_LEVEL_FREE: 'Free',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  };
  return map[level ?? ''] ?? 'Free';
}

function priceLevelToRange(level: string | undefined): { min: number; max: number } {
  const ranges: Record<string, { min: number; max: number }> = {
    PRICE_LEVEL_FREE: { min: 0, max: 0 },
    PRICE_LEVEL_INEXPENSIVE: { min: 5, max: 15 },
    PRICE_LEVEL_MODERATE: { min: 15, max: 35 },
    PRICE_LEVEL_EXPENSIVE: { min: 35, max: 75 },
    PRICE_LEVEL_VERY_EXPENSIVE: { min: 75, max: 150 },
  };
  return ranges[level ?? ''] ?? { min: 0, max: 0 };
}

function getPhotoUrl(place: any): string {
  const photo = place.photos?.[0];
  if (!photo?.name) return '';
  return `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=800&maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}`;
}

function getAllPhotoUrls(place: any, max = 5): string[] {
  return (place.photos || [])
    .slice(0, max)
    .map((p: any) =>
      p.name
        ? `https://places.googleapis.com/v1/${p.name}/media?maxHeightPx=800&maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}`
        : null
    )
    .filter(Boolean);
}

function parseOpeningHours(place: any): { hours: Record<string, string>; isOpenNow: boolean | null } {
  const roh = place.regularOpeningHours;
  if (!roh) return { hours: {}, isOpenNow: null };
  const hours: Record<string, string> = {};
  for (const desc of roh.weekdayDescriptions ?? []) {
    const [day, ...rest] = desc.split(': ');
    if (day) hours[day.toLowerCase()] = rest.join(': ');
  }
  return { hours, isOpenNow: roh.openNow ?? null };
}

function formatPlaceType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// ── DateTime Filter ─────────────────────────────────────────────────────────
function filterByDateTime(
  places: any[],
  datetimePref: string | undefined,
  dateOption: string,
  timeSlot: string | null
): any[] {
  if (dateOption === 'now' || !datetimePref) {
    return places.filter(p => p.isOpenNow !== false);
  }

  const targetDate = new Date(datetimePref);
  const targetDay = targetDate.getDay();

  let targetHourStart: number;
  if (timeSlot && TIME_SLOT_RANGES[timeSlot]) {
    targetHourStart = TIME_SLOT_RANGES[timeSlot].start;
  } else {
    targetHourStart = targetDate.getHours();
  }

  return places.filter(place => {
    const periods = place.regularOpeningHours?.periods;
    if (!periods || periods.length === 0) return true;

    return periods.some((period: any) => {
      if (period.open?.day !== targetDay) return false;
      const openHour = period.open?.hour ?? 0;
      const closeHour = period.close?.hour ?? 24;
      const effectiveClose = closeHour === 0 ? 24 : closeHour;
      return targetHourStart >= openHour && targetHourStart < effectiveClose;
    });
  });
}

/** Simple deterministic shuffle using seed for stable batch ordering */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Calculate match score: closeness + rating + popularity */
function calculateMatchScore(
  place: any,
  userLat: number,
  userLng: number,
  maxDistKm: number
): number {
  const lat = place.location?.latitude ?? 0;
  const lng = place.location?.longitude ?? 0;
  const dist = haversine(userLat, userLng, lat, lng);

  const distScore = Math.max(0, 40 * (1 - dist / maxDistKm));
  const rating = place.rating ?? 0;
  const ratingScore = (rating / 5) * 35;
  const reviews = place.userRatingCount ?? 0;
  const popScore = Math.min(25, (reviews / 1000) * 25);

  return Math.round(distScore + ratingScore + popScore);
}

// ── Fire-and-forget AI Description Enrichment ───────────────────────────────
async function enrichDescriptionsInBackground(
  supabaseAdmin: any,
  cards: Array<{ placeId: string; title: string; placeType: string; category: string; _cardPoolId?: string }>,
): Promise<void> {
  if (!OPENAI_API_KEY || cards.length === 0) return;

  try {
    // Build prompt with all cards grouped by category
    const placeList = cards
      .map((c, i) => `${i + 1}. "${c.title}" (${formatPlaceType(c.placeType)}, category: ${c.category})`)
      .join('\n');

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Generate a short, appealing 1-2 sentence description for each place. ' +
              'Focus on what makes each place special for visitors. Be vivid but concise. ' +
              'Tailor the tone to the category (e.g., romantic for Fine Dining, adventurous for Nature). ' +
              'Return a JSON object with key "descriptions" containing an array of strings, one per place, in the same order.',
          },
          {
            role: 'user',
            content: `Write descriptions for these ${cards.length} places:\n${placeList}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: Math.min(4000, cards.length * 100),
      }),
    });

    if (!resp.ok) {
      console.warn(`[discover-cards] OpenAI enrichment failed: ${resp.status}`);
      return;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return;

    const parsed = JSON.parse(content);
    const descriptions: string[] = parsed.descriptions || [];

    // Update card_pool entries with AI descriptions
    const updatePromises: Promise<void>[] = [];
    for (let i = 0; i < Math.min(descriptions.length, cards.length); i++) {
      const card = cards[i];
      if (!card._cardPoolId || !descriptions[i]) continue;

      updatePromises.push(
        supabaseAdmin
          .from('card_pool')
          .update({ description: descriptions[i] })
          .eq('id', card._cardPoolId)
          .then(() => {})
          .catch(() => {})
      );
    }

    await Promise.all(updatePromises);
    console.log(`[discover-cards] AI enrichment: updated ${updatePromises.length} descriptions`);
  } catch (err) {
    console.warn('[discover-cards] AI enrichment error (non-critical):', err);
  }
}

// ── Main Handler ────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const body = await req.json();
    const {
      categories: rawCategories = [],
      location,
      budgetMax = 200,
      travelMode = 'walking',
      travelConstraintType = 'time',
      travelConstraintValue = 30,
      datetimePref,
      dateOption = 'now',
      timeSlot = null,
      batchSeed = 0,
      limit = 20,
    } = body;

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

    // ── Resolve categories to canonical names ─────────────────────────────
    const categories = resolveCategories(rawCategories);
    if (categories.length === 0) {
      return new Response(
        JSON.stringify({ error: `No recognized categories in: ${rawCategories.join(', ')}`, cards: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[discover-cards] Request: categories=[${categories}], batchSeed=${batchSeed}, limit=${limit}, mode=${travelMode}`);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Extract userId from auth header ───────────────────────────────────
    const userId = (await supabaseAdmin.auth.getUser(
      req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    ))?.data?.user?.id;

    // ── Calculate search radius from travel constraint ────────────────────
    const maxDistKm =
      travelConstraintType === 'time'
        ? (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3
        : travelConstraintValue;
    const radiusMeters = Math.min(Math.round(maxDistKm * 1000), 50000);

    // ── Pool-first serving (ALL categories in ONE query) ──────────────────
    // No batchSeed === 0 restriction; serve from pool for ANY batchSeed.
    // Threshold lowered to 50% of limit.
    if (userId && !body.warmPool) {
      try {
        const poolResult = await serveCardsFromPipeline(
          {
            supabaseAdmin,
            userId,
            lat: location.lat,
            lng: location.lng,
            radiusMeters,
            categories,
            budgetMin: 0,
            budgetMax,
            limit,
            cardType: 'single',
          },
          GOOGLE_PLACES_API_KEY,
        );

        // Lowered threshold: serve if pool has >= 50% of limit
        if (poolResult.cards.length >= Math.ceil(limit * 0.5)) {
          const elapsed = Date.now() - t0;
          console.log(`[discover-cards] Served ${poolResult.cards.length} from pool in ${elapsed}ms (0 API calls)`);

          // If pool returned enough but less than limit, we could gap-fill,
          // but if >= 50% we serve what we have for speed.
          return new Response(JSON.stringify({
            cards: poolResult.cards,
            total: poolResult.totalPoolSize,
            source: poolResult.fromApi > 0 ? 'mixed' : 'pool',
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        console.log(`[discover-cards] Pool had ${poolResult.cards.length}/${limit} (below 50%), falling through to API`);
      } catch (poolErr) {
        console.warn('[discover-cards] Pool serve failed, falling back to API:', poolErr);
      }
    }

    // ── Handle warmPool request ───────────────────────────────────────────
    const isWarmPool = !!body.warmPool;

    // ── Collect place types from ALL categories ───────────────────────────
    // Use first 2 place types per category for diversity
    const typeToCategory: Record<string, string> = {};
    const allPlaceTypes: string[] = [];

    for (const cat of categories) {
      const types = getPlaceTypesForCategory(cat);
      const selected = types.slice(0, 4);
      for (const type of selected) {
        if (!typeToCategory[type]) {
          typeToCategory[type] = cat;
          allPlaceTypes.push(type);
        }
      }
    }

    console.log(`[discover-cards] Searching ${allPlaceTypes.length} place types across ${categories.length} categories`);

    // ── Batch search all place types using shared cache ───────────────────
    const { results, apiCallsMade, cacheHits } = await batchSearchPlaces(
      supabaseAdmin,
      GOOGLE_PLACES_API_KEY,
      allPlaceTypes,
      location.lat,
      location.lng,
      radiusMeters,
      {
        maxResultsPerType: 20,
        rankPreference: 'POPULARITY',
      }
    );

    console.log(`[discover-cards] Places search: ${cacheHits} cache hits, ${apiCallsMade} API calls`);

    // ── Merge & deduplicate across all types, track category per place ────
    const seen = new Set<string>();
    let allPlaces: Array<any & { _matchedType: string; _category: string }> = [];

    for (const [type, places] of Object.entries(results)) {
      const category = typeToCategory[type];
      if (!category) continue;
      for (const p of places) {
        if (p.id && !seen.has(p.id)) {
          seen.add(p.id);
          allPlaces.push({ ...p, _matchedType: type, _category: category });
        }
      }
    }

    console.log(`[discover-cards] ${allPlaces.length} unique places across ${Object.keys(results).length} types`);

    // ── Filter by distance ────────────────────────────────────────────────
    allPlaces = allPlaces.filter(p => {
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (lat == null || lng == null) return false;
      return haversine(location.lat, location.lng, lat, lng) <= maxDistKm;
    });

    // ── Filter by budget ──────────────────────────────────────────────────
    allPlaces = allPlaces.filter(p => {
      const range = priceLevelToRange(p.priceLevel);
      return range.min <= budgetMax;
    });

    // ── Filter by datetime preference ─────────────────────────────────────
    allPlaces = filterByDateTime(allPlaces, datetimePref, dateOption, timeSlot);

    console.log(`[discover-cards] ${allPlaces.length} places after all filters`);

    // ── Sort by quality: rating desc, then review count desc ──────────────
    allPlaces.sort((a, b) => {
      const rA = a.rating ?? 0;
      const rB = b.rating ?? 0;
      if (rB !== rA) return rB - rA;
      return (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
    });

    // ── Offset-based pagination ───────────────────────────────────────────
    const totalAvailable = allPlaces.length;
    const offset = batchSeed * limit;
    const batch = allPlaces.slice(offset, offset + limit);

    console.log(`[discover-cards] Batch ${batchSeed}: offset=${offset}, returning ${batch.length}/${totalAvailable}`);

    if (batch.length === 0 && !isWarmPool) {
      return new Response(
        JSON.stringify({ cards: [], total: totalAvailable, source: 'api' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Build response cards with fallback descriptions (NO OpenAI wait) ──
    const cards = batch.map((p, _i) => {
      const lat = p.location?.latitude ?? 0;
      const lng = p.location?.longitude ?? 0;
      const dist = haversine(location.lat, location.lng, lat, lng);
      const travelMin = estimateTravelMin(dist, travelMode);
      const { hours, isOpenNow } = parseOpeningHours(p);
      const priceRange = priceLevelToRange(p.priceLevel);
      const primaryType = p.primaryType || p._matchedType || 'place';
      const category = p._category;

      return {
        id: `${category.toLowerCase().replace(/[^a-z0-9]/g, '_')}-${p.id}`,
        placeId: p.id,
        title: p.displayName?.text || 'Unknown Place',
        description: getFallbackDescription(category, primaryType),
        image: getPhotoUrl(p),
        images: getAllPhotoUrls(p),
        rating: p.rating ?? 0,
        reviewCount: p.userRatingCount ?? 0,
        priceLevelLabel: priceLevelToLabel(p.priceLevel),
        priceMin: priceRange.min,
        priceMax: priceRange.max,
        address: p.formattedAddress || '',
        openingHours: hours,
        isOpenNow,
        website: p.websiteUri || null,
        lat,
        lng,
        placeType: primaryType,
        placeTypeLabel: formatPlaceType(primaryType),
        distanceKm: Math.round(dist * 10) / 10,
        travelTimeMin: travelMin,
        matchScore: calculateMatchScore(p, location.lat, location.lng, maxDistKm),
        category,
      };
    });

    const elapsed = Date.now() - t0;
    const source: string = apiCallsMade > 0 ? (cacheHits > 0 ? 'mixed' : 'api') : 'cache';
    console.log(`[discover-cards] Done in ${elapsed}ms: ${cards.length} cards, ${apiCallsMade} API calls`);

    // ── warmPool: return empty response after storing ─────────────────────
    if (isWarmPool) {
      // Store to pool in background then return empty
      storeResultsInPoolBatched(supabaseAdmin, batch, cards, categories, userId);

      return new Response(
        JSON.stringify({ cards: [], total: totalAvailable, source: 'warm' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Fire-and-forget: store results + enrich with AI descriptions ──────
    storeResultsInPoolBatched(supabaseAdmin, batch, cards, categories, userId);

    return new Response(
      JSON.stringify({ cards, total: totalAvailable, source }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[discover-cards] Error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', cards: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ── Batched Pool Storage (fire-and-forget) ──────────────────────────────────
function storeResultsInPoolBatched(
  supabaseAdmin: any,
  rawPlaces: any[],
  cards: any[],
  categories: string[],
  userId: string | undefined,
): void {
  // Execute async work without awaiting (fire-and-forget)
  (async () => {
    try {
      const t0 = Date.now();

      // ── Step 1: Batch upsert to place_pool ────────────────────────────
      // Build all place rows at once for a single upsert call
      const placeRows = rawPlaces.map(p => {
        const priceRange = priceLevelToRange(p.priceLevel);
        const photos = (p.photos || []).map((ph: any) => ({
          name: ph.name,
          widthPx: ph.widthPx,
          heightPx: ph.heightPx,
        }));

        return {
          google_place_id: p.id,
          name: p.displayName?.text || 'Unknown Place',
          address: p.formattedAddress || '',
          lat: p.location?.latitude ?? 0,
          lng: p.location?.longitude ?? 0,
          types: p.types || [],
          primary_type: p.primaryType || p._matchedType || null,
          rating: p.rating || 0,
          review_count: p.userRatingCount || 0,
          price_level: typeof p.priceLevel === 'string' ? p.priceLevel : null,
          price_min: priceRange.min,
          price_max: priceRange.max,
          opening_hours: p.regularOpeningHours || null,
          photos,
          website: p.websiteUri || null,
          raw_google_data: p,
          fetched_via: 'nearby_search',
          last_detail_refresh: new Date().toISOString(),
          refresh_failures: 0,
          is_active: true,
        };
      });

      // Single batched upsert for all places
      const { data: upsertedPlaces, error: placeError } = await supabaseAdmin
        .from('place_pool')
        .upsert(placeRows, { onConflict: 'google_place_id' })
        .select('id, google_place_id');

      if (placeError) {
        console.warn('[discover-cards] Batch place upsert error:', placeError.message);
      }

      // Build a lookup from google_place_id -> place_pool.id
      const placePoolIdMap: Record<string, string> = {};
      if (upsertedPlaces) {
        for (const row of upsertedPlaces) {
          placePoolIdMap[row.google_place_id] = row.id;
        }
      }

      // ── Step 2: Batch insert to card_pool ─────────────────────────────
      const cardRows = cards.map(card => {
        const popularityScore = (card.rating || 0) * Math.log10((card.reviewCount || 0) + 1);

        return {
          card_type: 'single' as const,
          place_pool_id: placePoolIdMap[card.placeId] || null,
          google_place_id: card.placeId,
          title: card.title,
          category: card.category,
          categories: [card.category],
          description: card.description,
          highlights: [],
          image_url: card.image,
          images: card.images,
          address: card.address,
          lat: card.lat,
          lng: card.lng,
          rating: card.rating,
          review_count: card.reviewCount,
          price_min: card.priceMin,
          price_max: card.priceMax,
          opening_hours: card.openingHours,
          popularity_score: popularityScore,
          is_active: true,
        };
      });

      // Single batched insert for all cards
      const { data: insertedCards, error: cardError } = await supabaseAdmin
        .from('card_pool')
        .upsert(cardRows, { ignoreDuplicates: true })
        .select('id, google_place_id');

      if (cardError) {
        // Duplicate constraint errors are expected and non-critical
        console.warn('[discover-cards] Batch card insert error (may be duplicates):', cardError.message);
      }

      // ── Step 3: Record impressions for served cards ───────────────────
      if (userId && insertedCards && insertedCards.length > 0) {
        const cardPoolIds = insertedCards.map((c: any) => c.id);
        await recordImpressions(supabaseAdmin, userId, cardPoolIds);
      }

      // ── Step 4: Fire-and-forget AI description enrichment ─────────────
      // Build a map from placeId to card_pool id for updating
      const cardPoolIdMap: Record<string, string> = {};
      if (insertedCards) {
        for (const row of insertedCards) {
          cardPoolIdMap[row.google_place_id] = row.id;
        }
      }

      const enrichmentInput = cards.map(c => ({
        placeId: c.placeId,
        title: c.title,
        placeType: c.placeType,
        category: c.category,
        _cardPoolId: cardPoolIdMap[c.placeId],
      }));

      // Do not await - true fire-and-forget
      enrichDescriptionsInBackground(supabaseAdmin, enrichmentInput)
        .catch(err => console.warn('[discover-cards] Background enrichment failed:', err));

      console.log(`[discover-cards] Pool storage completed in ${Date.now() - t0}ms: ${placeRows.length} places, ${cardRows.length} cards`);
    } catch (e) {
      console.warn('[discover-cards] Pool store failed (non-critical):', e);
    }
  })();
}
