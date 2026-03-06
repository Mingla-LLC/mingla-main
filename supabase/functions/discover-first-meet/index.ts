import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { batchSearchPlaces } from '../_shared/placesCache.ts';
import {
  serveCardsFromPipeline,
  upsertPlaceToPool,
  insertCardToPool,
  recordImpressions,
} from '../_shared/cardPoolService.ts';
import { priceLevelToLabel, priceLevelToRange, googleLevelToTierSlug } from '../_shared/priceTiers.ts';

/* ─────────────────────────────────────────────────────────────────────────────
 * discover-first-meet  –  Standalone First Meet Card System
 *
 * A dedicated, self-contained edge function for First Meet venue discovery.
 * Modeled identically on discover-nature.
 *
 * • Searches 7 social-venue Google Place types via shared cache.
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

// ── First Meet Place Types ──────────────────────────────────────────────────
const FIRST_MEET_TYPES = [
  'book_store',
  'bar',
  'pub',
  'wine_bar',
  'tea_house',
  'coffee_shop',
  'planetarium',
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
/** Filter places by datetime preference: opening hours + day-of-week + time slot */
function filterByDateTime(
  places: any[],
  datetimePref: string | undefined,
  dateOption: string,
  timeSlot: string | null
): any[] {
  // "Now" → use isOpenNow from Google response
  if (dateOption === 'now' || !datetimePref) {
    return places.filter(p => p.isOpenNow !== false);
  }

  const targetDate = new Date(datetimePref);
  const targetDay = targetDate.getDay(); // 0=Sun, 6=Sat

  let targetHourStart: number;

  if (timeSlot && TIME_SLOT_RANGES[timeSlot]) {
    targetHourStart = TIME_SLOT_RANGES[timeSlot].start;
  } else {
    targetHourStart = targetDate.getHours();
  }

  return places.filter(place => {
    const periods = place.regularOpeningHours?.periods;

    // No opening hours data → assume open
    if (!periods || periods.length === 0) return true;

    // Check if any period covers the target day + hour
    return periods.some((period: any) => {
      if (period.open?.day !== targetDay) return false;
      const openHour = period.open?.hour ?? 0;
      const closeHour = period.close?.hour ?? 24;

      // Handle close=0 meaning midnight (end of day)
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

  // Distance score: closer = higher (0-40 points)
  const distScore = Math.max(0, 40 * (1 - dist / maxDistKm));

  // Rating score: 0-35 points
  const rating = place.rating ?? 0;
  const ratingScore = (rating / 5) * 35;

  // Popularity score: based on review count (0-25 points)
  const reviews = place.userRatingCount ?? 0;
  const popScore = Math.min(25, (reviews / 1000) * 25);

  return Math.round(distScore + ratingScore + popScore);
}

// ── AI Description Generator ────────────────────────────────────────────────
async function generateDescriptions(places: any[]): Promise<string[]> {
  if (!OPENAI_API_KEY || places.length === 0) {
    return places.map(p =>
      `A welcoming ${formatPlaceType(p.primaryType || 'venue').toLowerCase()} perfect for relaxed conversation and meeting someone new.`
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
              'Focus on the atmosphere and why it is a great spot to meet someone new or have a relaxed conversation. ' +
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
      console.warn(`[discover-first-meet] OpenAI error: ${resp.status}`);
      return places.map(p =>
        `A welcoming ${formatPlaceType(p.primaryType || 'venue').toLowerCase()} ideal for a casual get-together.`
      );
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in OpenAI response');

    const parsed = JSON.parse(content);
    const descriptions: string[] = parsed.descriptions || [];

    // Pad with fallback if OpenAI returned fewer descriptions
    while (descriptions.length < places.length) {
      const p = places[descriptions.length];
      descriptions.push(
        `A welcoming ${formatPlaceType(p.primaryType || 'venue').toLowerCase()} ideal for a casual get-together.`
      );
    }

    return descriptions;
  } catch (err) {
    console.warn('[discover-first-meet] AI description generation failed:', err);
    return places.map(p =>
      `A welcoming ${formatPlaceType(p.primaryType || 'venue').toLowerCase()} ideal for a casual get-together.`
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

    console.log(`[discover-first-meet] Request: batchSeed=${batchSeed}, limit=${limit}, mode=${travelMode}`);

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
            categories: ['First Meet'],
            budgetMin: 0,
            budgetMax,
            limit,
            cardType: 'single',
          },
          GOOGLE_PLACES_API_KEY,
        );

        if (poolResult.cards.length >= Math.ceil(limit * 0.75)) {
          console.log(`[discover-first-meet] Served ${poolResult.cards.length} from pool (0 API calls)`);
          return new Response(JSON.stringify({
            cards: poolResult.cards,
            source: 'pool',
            total: poolResult.totalPoolSize,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      } catch (poolErr) {
        console.warn('[discover-first-meet] Pool serve failed, falling back to API:', poolErr);
      }
    }

    // ── Handle warmPool request ─────────────────────────────────────────
    const isWarmPool = !!body.warmPool;

    // ── Search all 7 First Meet types using shared cache ────────────────
    const { results, apiCallsMade, cacheHits } = await batchSearchPlaces(
      supabaseAdmin,
      GOOGLE_PLACES_API_KEY,
      FIRST_MEET_TYPES,
      location.lat,
      location.lng,
      radiusMeters,
      {
        maxResultsPerType: 20,
        rankPreference: 'POPULARITY',
      }
    );

    console.log(`[discover-first-meet] Places search: ${cacheHits} cache hits, ${apiCallsMade} API calls`);

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

    console.log(`[discover-first-meet] ${allPlaces.length} unique places across ${Object.keys(results).length} types`);

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

    console.log(`[discover-first-meet] ${allPlaces.length} places after datetime filter (dateOption=${dateOption}, timeSlot=${timeSlot})`);

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

    console.log(`[discover-first-meet] Batch ${batchSeed}: offset=${offset}, returning ${batch.length}/${totalAvailable}`);

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
      const primaryType = p.primaryType || p._matchedType || 'coffee_shop';

      return {
        id: `first-meet-${p.id}`,
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
              'first_meet_discover'
            );
            await insertCardToPool(supabaseAdmin, {
              placePoolId: placePoolId || undefined,
              googlePlaceId: card.placeId,
              cardType: 'single',
              title: card.title,
              category: 'First Meet',
              categories: ['First Meet'],
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
          console.warn('[discover-first-meet] Pool store failed (non-critical):', e);
        }
      })();
    }

    const elapsed = Date.now() - t0;
    console.log(`[discover-first-meet] Done in ${elapsed}ms: ${cards.length} cards, ${apiCallsMade} API calls`);

    // ── warmPool: return empty response after storing ────────────────────
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
    console.error('[discover-first-meet] Error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', cards: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
