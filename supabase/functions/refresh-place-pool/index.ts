import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Fetch stale places (not refreshed in 24h)
    const { data: stalePlaces, error: fetchError } = await supabaseAdmin
      .from('place_pool')
      .select('id, google_place_id, name')
      .eq('is_active', true)
      .lt('last_detail_refresh', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('last_detail_refresh', { ascending: true })
      .limit(500);

    if (fetchError) throw new Error(`Fetch stale places error: ${fetchError.message}`);

    if (!stalePlaces || stalePlaces.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No stale places to refresh',
        refreshed: 0,
        deactivated: 0,
        errors: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[refresh] Found ${stalePlaces.length} stale places to refresh`);

    let refreshed = 0;
    let deactivated = 0;
    let errors = 0;

    // Step 2: Refresh each place via Place Details by ID (Basic = FREE)
    for (const place of stalePlaces) {
      try {
        // Basic fields are FREE ($0.00):
        // id, displayName, formattedAddress, location, types, primaryType, regularOpeningHours, businessStatus
        // Essential fields cost $0.005 per call:
        // rating, userRatingCount, priceLevel, photos, websiteUri
        const fieldMask = 'id,displayName,formattedAddress,location,types,primaryType,' +
          'regularOpeningHours,rating,userRatingCount,priceLevel,photos,websiteUri';

        const url = `https://places.googleapis.com/v1/places/${place.google_place_id}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': fieldMask,
          },
        });

        if (response.status === 404 || response.status === 410) {
          // Place no longer exists
          await supabaseAdmin
            .from('place_pool')
            .update({ is_active: false, refresh_failures: 999 })
            .eq('id', place.id);

          await supabaseAdmin
            .from('card_pool')
            .update({ is_active: false })
            .eq('place_pool_id', place.id);

          deactivated++;
          console.log(`[refresh] Deactivated: ${place.name} (${place.google_place_id})`);
          continue;
        }

        if (!response.ok) {
          // Temporary error — increment failure count
          await supabaseAdmin
            .from('place_pool')
            .update({ refresh_failures: (place as any).refresh_failures + 1 })
            .eq('id', place.id);
          errors++;
          console.warn(`[refresh] Error ${response.status} for ${place.google_place_id}`);
          continue;
        }

        const data = await response.json();

        // Update place_pool
        const priceLevel = data.priceLevel || null;
        const rating = data.rating || 0;
        const reviewCount = data.userRatingCount || 0;
        const photos = (data.photos || []).map((p: any) => ({
          name: p.name,
          widthPx: p.widthPx,
          heightPx: p.heightPx,
        }));

        await supabaseAdmin
          .from('place_pool')
          .update({
            name: data.displayName?.text || place.name,
            address: data.formattedAddress || null,
            lat: data.location?.latitude,
            lng: data.location?.longitude,
            types: data.types || [],
            primary_type: data.primaryType || null,
            rating,
            review_count: reviewCount,
            price_level: typeof priceLevel === 'string' ? priceLevel : null,
            opening_hours: data.regularOpeningHours || null,
            photos,
            website: data.websiteUri || null,
            last_detail_refresh: new Date().toISOString(),
            refresh_failures: 0,
            is_active: true,
          })
          .eq('id', place.id);

        // Update associated card_pool entries
        const popularityScore = rating * Math.log10(reviewCount + 1);
        const primaryPhoto = photos[0];
        const imageUrl = primaryPhoto?.name
          ? `https://places.googleapis.com/v1/${primaryPhoto.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
          : null;
        const imageUrls = photos
          .slice(0, 5)
          .map((p: any) => p.name ? `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}` : null)
          .filter(Boolean);

        await supabaseAdmin
          .from('card_pool')
          .update({
            rating,
            review_count: reviewCount,
            opening_hours: data.regularOpeningHours || null,
            image_url: imageUrl,
            images: imageUrls,
            popularity_score: popularityScore,
            website: data.websiteUri || null,
          })
          .eq('place_pool_id', place.id)
          .eq('is_active', true);

        refreshed++;

        // Small delay between calls to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (placeError) {
        errors++;
        console.error(`[refresh] Error refreshing ${place.google_place_id}:`, placeError);
      }
    }

    // Step 3: Run cleanup functions
    try {
      await supabaseAdmin.rpc('deactivate_stale_places');
    } catch (e) {
      console.warn('[refresh] deactivate_stale_places failed:', e);
    }

    try {
      await supabaseAdmin.rpc('cleanup_stale_impressions');
    } catch (e) {
      console.warn('[refresh] cleanup_stale_impressions failed:', e);
    }

    // Step 4: Clean up impressions for users whose preferences changed
    try {
      await supabaseAdmin.rpc('cleanup_stale_impressions');
    } catch (e) {
      // Already ran above, this is a safety net
    }

    const summary = {
      success: true,
      refreshed,
      deactivated,
      errors,
      totalProcessed: stalePlaces.length,
    };

    console.log('[refresh] Complete:', JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[refresh] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
