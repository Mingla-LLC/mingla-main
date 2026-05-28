import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchStopAlternatives, haversineKm } from '../_shared/stopAlternatives.ts';
import { isValidComboSlug, isKnownRankSignal } from '../_shared/signalRankFetch.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ORCH-0985: the stale local VALID_CATEGORIES whitelist (last touched ORCH-0434)
// is gone. Slug validity is resolved against the SINGLE authority —
// COMBO_SLUG_TO_FILTER_SIGNAL via isValidComboSlug — the same map the curated
// generator uses. This is what fixes "Replace does nothing": the old whitelist
// never learned about the brunch_lunch_casual→brunch+casual_food /
// movies_theatre→movies+theatre split or the hiking/museum slots, so it
// 400-rejected those stops. See I-CURATED-LABEL-SOURCE + Constitution #6.

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
      rankSignal: rawRankSignal,
      limit: rawLimit = 10,
    } = body;

    // ORCH-0985: accept the vibe rank signal stamped on the stop. Ignore unknown
    // values (Constitution #3 — never rank by a non-existent signal); fetchStop-
    // Alternatives then falls back to the category filter signal.
    const rankSignal =
      typeof rawRankSignal === 'string' && isKnownRankSignal(rawRankSignal)
        ? rawRankSignal
        : undefined;

    // Validate inputs against the single slug authority (ORCH-0985).
    if (!categoryId || !isValidComboSlug(categoryId)) {
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

    // ORCH-0985: search around the STOP BEING REPLACED. The client sends that
    // stop's own coordinates as `location`. The previous "centroid of sibling
    // stops" logic was the root cause of the Burning Coal bug: with one stop
    // downtown and one stop 7km away, the midpoint landed in a theatre-desert,
    // so the real downtown theatres were out of range and only mis-scored junk
    // qualified. `siblingStops` is intentionally no longer used for centering.
    const refLat = location.lat;
    const refLng = location.lng;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { alternatives, totalAvailable } = await fetchStopAlternatives(supabaseAdmin, {
      categoryId,
      refLat,
      refLng,
      travelMode,
      budgetMax,
      excludePlaceIds: Array.isArray(excludePlaceIds) ? excludePlaceIds : [],
      limit,
      rankSignal,
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
