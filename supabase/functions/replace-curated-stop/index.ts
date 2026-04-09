import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchStopAlternatives, haversineKm } from '../_shared/stopAlternatives.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_CATEGORIES = new Set([
  'nature_views', 'first_meet', 'picnic_park', 'drink', 'casual_eats',
  'fine_dining', 'watch', 'live_performance', 'creative_arts', 'play',
  'wellness', 'flowers', 'groceries',
]);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    // Auth: require authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required', alternatives: [] }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const authClient = createClient(supabaseUrl, anonKey);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token', alternatives: [] }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json();
    const {
      categoryId,
      location,
      travelMode = 'walking',
      budgetMax = 1000,
      excludePlaceIds = [],
      siblingStops = [],
      limit: rawLimit = 10,
    } = body;

    // Validate inputs
    if (!categoryId || !VALID_CATEGORIES.has(categoryId)) {
      return new Response(
        JSON.stringify({ error: `Invalid categoryId: ${categoryId}`, alternatives: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (location?.lat == null || location?.lng == null) {
      return new Response(
        JSON.stringify({ error: 'location.lat and location.lng are required', alternatives: [] }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const limit = Math.min(Math.max(rawLimit, 1), 20);

    // Compute reference point: centroid of sibling stops if provided, else user location
    let refLat = location.lat;
    let refLng = location.lng;

    if (Array.isArray(siblingStops) && siblingStops.length > 0) {
      const validSiblings = siblingStops.filter(
        (s: any) => typeof s.lat === 'number' && typeof s.lng === 'number',
      );
      if (validSiblings.length > 0) {
        refLat = validSiblings.reduce((sum: number, s: any) => sum + s.lat, 0) / validSiblings.length;
        refLng = validSiblings.reduce((sum: number, s: any) => sum + s.lng, 0) / validSiblings.length;
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { alternatives, totalAvailable } = await fetchStopAlternatives(supabaseAdmin, {
      categoryId,
      refLat,
      refLng,
      travelMode,
      budgetMax,
      excludePlaceIds: Array.isArray(excludePlaceIds) ? excludePlaceIds : [],
      limit,
    });

    console.log(`[replace-curated-stop] ${categoryId}: ${alternatives.length}/${totalAvailable} alternatives for user ${user.id}`);

    return new Response(
      JSON.stringify({
        alternatives,
        meta: { totalAvailable, categoryId },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[replace-curated-stop] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, alternatives: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
