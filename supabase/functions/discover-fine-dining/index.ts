import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serveCardsFromPipeline } from '../_shared/cardPoolService.ts';
// CATEGORY_MIN_PRICE_TIER removed — AI validation is the sole quality gate for category membership.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';

const SPEED_KMH: Record<string, number> = {
  walking: 4.5, transit: 25, driving: 40, cycling: 15,
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const t0 = Date.now();
  try {
    const body = await req.json();
    const location = body.location;
    if (!location?.lat || !location?.lng) {
      return new Response(JSON.stringify({ error: 'Location required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const travelMode = body.travelMode || 'walking';
    const travelConstraintValue = body.travelConstraintValue || 30;
    const budgetMax = body.budgetMax ?? 9999;
    const limit = Math.min(body.limit || 10, 50);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const maxDistKm = (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3;
    const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);

    const userId = (await supabaseAdmin.auth.getUser(
      req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    ))?.data?.user?.id;

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const poolResult = await serveCardsFromPipeline(
      {
        supabaseAdmin, userId,
        lat: location.lat, lng: location.lng,
        radiusMeters,
        categories: ['Fine Dining'],
        budgetMin: 0, budgetMax,
        limit, cardType: 'single',
      },
      GOOGLE_PLACES_API_KEY,
    );

    const cards = poolResult.cards;

    const elapsed = Date.now() - t0;
    console.log(`[discover-fine-dining] Served ${cards.length} cards in ${elapsed}ms`);

    return new Response(JSON.stringify({
      cards,
      source: 'pool',
      total: poolResult.totalPoolSize,
      hasMore: poolResult.hasMore,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[discover-fine-dining] Error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
