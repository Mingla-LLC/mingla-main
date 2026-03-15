import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { batchSearchByCategory } from '../_shared/placesCache.ts';
import { upsertPlaceToPool, insertCardToPool } from '../_shared/cardPoolService.ts';
import { priceLevelToRange } from '../_shared/priceTiers.ts';
import {
  ALL_CATEGORY_NAMES,
  getCategoryTypeMap,
  resolveCategories,
} from '../_shared/categoryPlaceTypes.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { location, categories } = await req.json();

    if (!location?.lat || !location?.lng) {
      return new Response(
        JSON.stringify({ error: 'location.lat and location.lng are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Missing required environment variables' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve which categories to warm — all 12 by default, or a user-specified subset
    const categoriesToWarm = categories && Array.isArray(categories) && categories.length > 0
      ? resolveCategories(categories)
      : ALL_CATEGORY_NAMES;

    const categoryTypeMap = getCategoryTypeMap(categoriesToWarm);

    console.log(`[warm-cache] Warming ${Object.keys(categoryTypeMap).length} categories at ${location.lat.toFixed(4)},${location.lng.toFixed(4)}`);

    const startTime = Date.now();

    const { results, apiCallsMade, cacheHits } = await batchSearchByCategory(
      supabaseAdmin,
      GOOGLE_API_KEY,
      categoryTypeMap,
      location.lat,
      location.lng,
      10000, // 10km default radius — covers most urban areas
      {
        maxResultsPerCategory: 20,
        ttlHours: 24,
      },
    );

    // ── Store results directly in place_pool + card_pool ──────────────────
    let totalPlaces = 0;
    for (const [category, places] of Object.entries(results)) {
      for (const place of places) {
        const googlePlaceId = place.id || place.placeId;
        if (!googlePlaceId) continue;

        totalPlaces++;

        // Upsert to place_pool
        const placePoolId = await upsertPlaceToPool(supabaseAdmin, place, GOOGLE_API_KEY, 'warm_cache');

        // Build and insert card to card_pool
        const priceRange = priceLevelToRange(place.priceLevel);
        await insertCardToPool(supabaseAdmin, {
          placePoolId: placePoolId ?? undefined,
          googlePlaceId,
          cardType: 'single',
          title: place.displayName?.text || 'Unknown Place',
          category,
          categories: [category],
          description: null,
          highlights: [],
          imageUrl: null,
          images: [],
          address: place.formattedAddress || '',
          lat: place.location?.latitude ?? 0,
          lng: place.location?.longitude ?? 0,
          rating: place.rating || 0,
          reviewCount: place.userRatingCount || 0,
          priceMin: priceRange.min,
          priceMax: priceRange.max,
          openingHours: place.regularOpeningHours || null,
          website: place.websiteUri || null,
          priceLevel: place.priceLevel,
        });
      }
    }

    const durationMs = Date.now() - startTime;

    console.log(`[warm-cache] Done in ${durationMs}ms: ${cacheHits} cache hits, ${apiCallsMade} API calls, ${totalPlaces} total places stored to pools`);

    return new Response(
      JSON.stringify({
        warmed: true,
        categoriesWarmed: Object.keys(categoryTypeMap).length,
        cacheHits,
        apiCalls: apiCallsMade,
        totalPlaces,
        durationMs,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[warm-cache] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
