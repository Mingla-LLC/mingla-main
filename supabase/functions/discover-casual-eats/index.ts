import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { batchSearchPlaces } from '../_shared/placesCache.ts';
import {
  serveCardsFromPipeline,
  upsertPlaceToPool,
  insertCardToPool,
  recordImpressions,
} from '../_shared/cardPoolService.ts';
import { filterExcludedPlaces, getExcludedTypesForCategory } from '../_shared/categoryPlaceTypes.ts';
import { priceLevelToLabel, priceLevelToRange, googleLevelToTierSlug } from '../_shared/priceTiers.ts';

/* ─────────────────────────────────────────────────────────────────────────────
 * discover-casual-eats  –  Standalone Casual Eats Card System
 *
 * A dedicated, self-contained edge function for Casual Eats venue discovery.
 * Modeled identically on discover-first-meet.
 *
 * • Searches 37 restaurant Google Place types via shared cache.
 * • Uses CHUNKING: primary types first, secondary only if primary < 75%.
 * • Deduplicates, filters by travel constraint, sorts by quality.
 * • Offset-based batching for "Generate Another 20".
 * • Single batch OpenAI call for AI-generated descriptions (~$0.001/batch).
 * • Returns flat single-place card objects ready for Recommendation mapping.
 * ──────────────────────────────────────────────────────────────────────────── */

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Casual Eats Place Types (Primary — 10 most common) ─────────────────────
const CASUAL_EATS_PRIMARY_TYPES = [
  'fast_food_restaurant',
  'pizza_restaurant',
  'hamburger_restaurant',
  'american_restaurant',
  'mexican_restaurant',
  'chinese_restaurant',
  'italian_restaurant',
  'japanese_restaurant',
  'indian_restaurant',
  'sushi_restaurant',
];

// ── Casual Eats Place Types (Secondary — remaining 27) ──────────────────────
const CASUAL_EATS_SECONDARY_TYPES = [
  'buffet_restaurant',
  'brunch_restaurant',
  'diner',
  'food_court',
  'ramen_restaurant',
  'sandwich_shop',
  'afghani_restaurant',
  'african_restaurant',
  'asian_restaurant',
  'barbecue_restaurant',
  'brazilian_restaurant',
  'breakfast_restaurant',
  'indonesian_restaurant',
  'korean_restaurant',
  'lebanese_restaurant',
  'mediterranean_restaurant',
  'middle_eastern_restaurant',
  'seafood_restaurant',
  'spanish_restaurant',
  'thai_restaurant',
  'turkish_restaurant',
  'vegan_restaurant',
  'vegetarian_restaurant',
  'vietnamese_restaurant',
  'steak_house',
  'french_restaurant',
  'greek_restaurant',
];

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

function getPhotoUrl(place: any): string {
  return 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';
}

function getAllPhotoUrls(place: any, max = 5): string[] {
  return [];
}

function parseOpeningHours(place: any): { hours: Record<string, string>; isOpenNow: boolean } {
  const roh = place.regularOpeningHours;
  if (!roh) return { hours: {}, isOpenNow: true };
  const hours: Record<string, string> = {};
  for (const desc of roh.weekdayDescriptions ?? []) {
    const [day, ...rest] = desc.split(': ');
    if (day) hours[day.toLowerCase()] = rest.join(': ');
  }
  return { hours, isOpenNow: roh.openNow ?? true };
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

// ── AI Description Generator ────────────────────────────────────────────────
async function generateDescriptions(places: any[]): Promise<string[]> {
  if (!OPENAI_API_KEY || places.length === 0) {
    return places.map(p =>
      `A popular spot for casual, affordable dining — great for a quick bite or a relaxed meal out.`
    );
  }

  try {
    const placeList = places
      .map((p, i) => {
        const name = p.displayName?.text || 'Unknown';
        const type = formatPlaceType(p.primaryType || 'venue');
        const rating = p.rating ? `${p.rating}/5` : 'unrated';
        const reviews = p.userRatingCount ?? 0;
        return `${i + 1}. "${name}" (${type}, ${rating}, ${reviews} reviews)`;
      })
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
              'Generate a short, appealing 1-2 sentence description for each venue. ' +
              'Focus on the food, vibe, and value. Highlight what makes it a great casual dining spot. ' +
              'Be warm and inviting but concise. ' +
              'Return a JSON object with key "descriptions" containing an array of strings, one per venue, in the same order.',
          },
          {
            role: 'user',
            content: `Write descriptions for these ${places.length} venues:\n${placeList}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });

    if (!resp.ok) {
      console.warn(`[discover-casual-eats] OpenAI error: ${resp.status}`);
      return places.map(p =>
        `A popular spot for casual, affordable dining — great for a quick bite or a relaxed meal out.`
      );
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in OpenAI response');

    const parsed = JSON.parse(content);
    const descriptions: string[] = parsed.descriptions || [];

    while (descriptions.length < places.length) {
      descriptions.push(
        `A popular spot for casual, affordable dining — great for a quick bite or a relaxed meal out.`
      );
    }

    return descriptions;
  } catch (err) {
    console.warn('[discover-casual-eats] AI description generation failed:', err);
    return places.map(p =>
      `A popular spot for casual, affordable dining — great for a quick bite or a relaxed meal out.`
    );
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
      location,
      budgetMax = 200,
      travelMode = 'walking',
      travelConstraintValue = 30,
      datetimePref,
      dateOption = 'now',
      timeSlot = null,
      batchSeed = 0,
      limit = 20,
    } = body;

    if (!location?.lat || !location?.lng) {
      return new Response(
        JSON.stringify({ error: 'Location required', cards: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[discover-casual-eats] Request: batchSeed=${batchSeed}, limit=${limit}, mode=${travelMode}`);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Calculate search radius from travel constraint ──────────────────
    const maxDistKm = (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3;
    const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);

    // ── Pool-first serving ──────────────────────────────────────────────
    const userId = (await supabaseAdmin.auth.getUser(
      req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    ))?.data?.user?.id;

    if (userId && batchSeed === 0 && !body.warmPool) {
      try {
        const poolResult = await serveCardsFromPipeline(
          {
            supabaseAdmin,
            userId,
            lat: location.lat,
            lng: location.lng,
            radiusMeters,
            categories: ['Casual Eats'],
            budgetMin: 0,
            budgetMax,
            limit,
            cardType: 'single',
          },
          GOOGLE_PLACES_API_KEY,
        );

        if (poolResult.cards.length >= Math.ceil(limit * 0.75)) {
          console.log(`[discover-casual-eats] Served ${poolResult.cards.length} from pool (0 API calls)`);
          return new Response(JSON.stringify({
            cards: poolResult.cards,
            source: 'pool',
            total: poolResult.totalPoolSize,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      } catch (poolErr) {
        console.warn('[discover-casual-eats] Pool serve failed, falling back to API:', poolErr);
      }
    }

    // ── Handle warmPool request ─────────────────────────────────────────
    const isWarmPool = !!body.warmPool;

    // ── Search primary types first (10 most common) ─────────────────────
    const { results: primaryResults, apiCallsMade: primaryApiCalls, cacheHits: primaryCacheHits } = await batchSearchPlaces(
      supabaseAdmin,
      GOOGLE_PLACES_API_KEY,
      CASUAL_EATS_PRIMARY_TYPES,
      location.lat,
      location.lng,
      radiusMeters,
      { maxResultsPerType: 20, rankPreference: 'POPULARITY' }
    );

    let totalApiCalls = primaryApiCalls;
    let totalCacheHits = primaryCacheHits;
    let results = { ...primaryResults };

    // Count primary results
    const primaryCount = Object.values(primaryResults).reduce((s, a) => s + a.length, 0);
    console.log(`[discover-casual-eats] Primary search: ${primaryCount} places (${primaryCacheHits} cache, ${primaryApiCalls} API)`);

    // ── Search secondary types only if primary returned < 75% of limit ──
    if (primaryCount < Math.ceil(limit * 0.75)) {
      const { results: secondaryResults, apiCallsMade: secApiCalls, cacheHits: secCacheHits } = await batchSearchPlaces(
        supabaseAdmin,
        GOOGLE_PLACES_API_KEY,
        CASUAL_EATS_SECONDARY_TYPES,
        location.lat,
        location.lng,
        radiusMeters,
        { maxResultsPerType: 20, rankPreference: 'POPULARITY' }
      );
      totalApiCalls += secApiCalls;
      totalCacheHits += secCacheHits;
      results = { ...results, ...secondaryResults };
      const secCount = Object.values(secondaryResults).reduce((s, a) => s + a.length, 0);
      console.log(`[discover-casual-eats] Secondary search: ${secCount} additional places (${secCacheHits} cache, ${secApiCalls} API)`);
    } else {
      // Background-warm secondary types (fire-and-forget)
      (async () => {
        try {
          await batchSearchPlaces(supabaseAdmin, GOOGLE_PLACES_API_KEY, CASUAL_EATS_SECONDARY_TYPES, location.lat, location.lng, radiusMeters, { maxResultsPerType: 20, rankPreference: 'POPULARITY' });
        } catch { /* silent */ }
      })();
    }

    console.log(`[discover-casual-eats] Total: ${totalCacheHits} cache hits, ${totalApiCalls} API calls`);

    // ── Merge & deduplicate across all types ─────────────────────────────
    const seen = new Set<string>();
    let allPlaces: any[] = [];

    for (const [type, places] of Object.entries(results)) {
      for (const p of places) {
        if (p.id && !seen.has(p.id)) {
          seen.add(p.id);
          allPlaces.push({ ...p, _matchedType: type });
        }
      }
    }

    console.log(`[discover-casual-eats] ${allPlaces.length} unique places across ${Object.keys(results).length} types`);

    // ── Filter out excluded place types ──────────────────────────────────
    const casualEatsExcluded = getExcludedTypesForCategory('Casual Eats');
    allPlaces = filterExcludedPlaces(allPlaces, casualEatsExcluded) as typeof allPlaces;
    console.log(`[discover-casual-eats] ${allPlaces.length} places after exclusion filter`);

    // ── Filter by distance ──────────────────────────────────────────────
    allPlaces = allPlaces.filter(p => {
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (lat == null || lng == null) return false;
      return haversine(location.lat, location.lng, lat, lng) <= maxDistKm;
    });

    // ── Filter by budget ────────────────────────────────────────────────
    allPlaces = allPlaces.filter(p => {
      const range = priceLevelToRange(p.priceLevel);
      return range.min <= budgetMax;
    });

    // ── Filter by datetime preference ───────────────────────────────────
    allPlaces = filterByDateTime(allPlaces, datetimePref, dateOption, timeSlot);

    console.log(`[discover-casual-eats] ${allPlaces.length} places after datetime filter (dateOption=${dateOption}, timeSlot=${timeSlot})`);

    // ── Stable sort: rating desc, then review count desc ────────────────
    allPlaces.sort((a, b) => {
      const rA = a.rating ?? 0;
      const rB = b.rating ?? 0;
      if (rB !== rA) return rB - rA;
      return (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
    });

    // ── Offset-based pagination ─────────────────────────────────────────
    const totalAvailable = allPlaces.length;
    const offset = batchSeed * limit;
    const batch = allPlaces.slice(offset, offset + limit);

    console.log(`[discover-casual-eats] Batch ${batchSeed}: offset=${offset}, returning ${batch.length}/${totalAvailable}`);

    if (batch.length === 0) {
      return new Response(
        JSON.stringify({ cards: [], total: totalAvailable }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Generate AI descriptions (single batch call) ────────────────────
    const descriptions = await generateDescriptions(batch);

    // ── Build response cards ────────────────────────────────────────────
    const cards = batch.map((p, i) => {
      const lat = p.location?.latitude ?? 0;
      const lng = p.location?.longitude ?? 0;
      const dist = haversine(location.lat, location.lng, lat, lng);
      const travelMin = estimateTravelMin(dist, travelMode);
      const { hours, isOpenNow } = parseOpeningHours(p);
      const priceRange = priceLevelToRange(p.priceLevel);
      const primaryType = p.primaryType || p._matchedType || 'restaurant';

      return {
        id: `casual-eats-${p.id}`,
        placeId: p.id,
        title: p.displayName?.text || 'Venue',
        description: descriptions[i],
        image: getPhotoUrl(p),
        images: getAllPhotoUrls(p),
        rating: p.rating ?? 0,
        reviewCount: p.userRatingCount ?? 0,
        priceLevelLabel: priceLevelToLabel(p.priceLevel),
        priceMin: priceRange.min,
        priceMax: priceRange.max,
        priceTier: googleLevelToTierSlug(p.priceLevel),
        address: p.formattedAddress || '',
        openingHours: hours,
        isOpenNow,
        website: p.websiteUri || null,
        lat,
        lng,
        placeType: primaryType,
        placeTypeLabel: formatPlaceType(primaryType),
        distanceKm: Math.round(dist * 100) / 100,
        travelTimeMin: travelMin,
        matchScore: calculateMatchScore(p, location.lat, location.lng, maxDistKm),
      };
    });

    // ── Store results in card pool (fire-and-forget) ───────────────────
    if (userId) {
      (async () => {
        try {
          for (const card of cards) {
            const placePoolId = await upsertPlaceToPool(
              supabaseAdmin,
              batch.find((p: any) => p.id === card.placeId) || { id: card.placeId, displayName: { text: card.title } },
              GOOGLE_PLACES_API_KEY,
              'casual_eats_discover'
            );
            await insertCardToPool(supabaseAdmin, {
              placePoolId: placePoolId || undefined,
              googlePlaceId: card.placeId,
              cardType: 'single',
              title: card.title,
              category: 'Casual Eats',
              categories: ['Casual Eats'],
              description: card.description,
              imageUrl: card.image,
              images: card.images,
              address: card.address,
              lat: card.lat,
              lng: card.lng,
              rating: card.rating,
              reviewCount: card.reviewCount,
              priceMin: card.priceMin,
              priceMax: card.priceMax,
              priceTier: card.priceTier,
              openingHours: card.openingHours,
            });
          }
          await recordImpressions(supabaseAdmin, userId, cards.map((c: any) => c.id));
        } catch (e) {
          console.warn('[discover-casual-eats] Pool store failed (non-critical):', e);
        }
      })();
    }

    const elapsed = Date.now() - t0;
    console.log(`[discover-casual-eats] Done in ${elapsed}ms: ${cards.length} cards, ${totalApiCalls} API calls`);

    if (isWarmPool) {
      return new Response(
        JSON.stringify({ cards: [], total: totalAvailable, source: 'warm' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ cards, total: totalAvailable }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[discover-casual-eats] Error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', cards: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
