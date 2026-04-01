import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const HIDDEN_CATEGORIES = new Set(['groceries']);

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get('authorization') ?? '';
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Verify caller is authenticated
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', cards: [], heroCards: [], featuredCard: null }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const lat = body.location?.lat;
    const lng = body.location?.lng;
    if (!lat || !lng) {
      return new Response(
        JSON.stringify({ error: 'location.lat and location.lng required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const radiusMeters = body.radius || 10000;
    const travelMode = body.travelMode || 'driving';
    const latDelta = radiusMeters / 111320;
    const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

    // Query single cards: active, AI-approved parent place, within radius
    const { data: singlesRaw } = await supabaseAdmin
      .from('card_pool')
      .select('*, place_pool!inner(ai_approved)')
      .eq('is_active', true)
      .eq('card_type', 'single')
      .eq('place_pool.ai_approved', true)
      .gte('lat', lat - latDelta)
      .lte('lat', lat + latDelta)
      .gte('lng', lng - lngDelta)
      .lte('lng', lng + lngDelta)
      .order('rating', { ascending: false, nullsFirst: false })
      .limit(200);

    // Strip the nested place_pool from the response (keep flat card shape)
    const singles = (singlesRaw || []).map(({ place_pool: _pp, ...card }: any) => card);

    // Top 1 per visible category
    const seenCategories = new Set<string>();
    const topSingles: any[] = [];
    for (const card of singles) {
      if (!card.category || HIDDEN_CATEGORIES.has(card.category)) continue;
      if (seenCategories.has(card.category)) continue;
      seenCategories.add(card.category);
      topSingles.push(card);
    }

    // Query curated cards: active, within radius
    // AI gate: all stops' places must be approved (checked via subquery)
    const { data: curatedRaw } = await supabaseAdmin
      .from('card_pool')
      .select('*')
      .eq('is_active', true)
      .eq('card_type', 'curated')
      .gte('lat', lat - latDelta)
      .lte('lat', lat + latDelta)
      .gte('lng', lng - lngDelta)
      .lte('lng', lng + lngDelta)
      .order('rating', { ascending: false, nullsFirst: false })
      .limit(100);

    // Post-filter curated: verify all stops' places are AI-approved
    const curatedIds = (curatedRaw || []).map((c: any) => c.id);
    let rejectedCuratedIds = new Set<string>();
    if (curatedIds.length > 0) {
      // Find curated cards that have at least one unapproved stop
      const { data: badStops } = await supabaseAdmin
        .from('card_pool_stops')
        .select('card_pool_id, place_pool!inner(ai_approved)')
        .in('card_pool_id', curatedIds)
        .or('place_pool.ai_approved.is.null,place_pool.ai_approved.eq.false');
      rejectedCuratedIds = new Set((badStops || []).map((s: any) => s.card_pool_id));
    }

    // Top 1 per experience type (AI-gated)
    const seenTypes = new Set<string>();
    const topCurated: any[] = [];
    for (const card of (curatedRaw || [])) {
      if (!card.experience_type) continue;
      if (rejectedCuratedIds.has(card.id)) continue;
      if (seenTypes.has(card.experience_type)) continue;
      seenTypes.add(card.experience_type);
      topCurated.push(card);
    }

    // Combine
    const allCards = [...topSingles, ...topCurated];

    // Format for mobile app (match existing response shape)
    const formatted = allCards.map((card) => {
      const distKm = haversineKm(lat, lng, card.lat, card.lng);
      const travelMin = estimateTravelMin(distKm, travelMode);

      return {
        id: card.id,
        placeId: card.google_place_id || card.id,
        title: card.title,
        category: card.category,
        description: card.description || '',
        heroImage: card.image_url,
        images: card.images || (card.image_url ? [card.image_url] : []),
        priceRange: card.price_min != null && card.price_max != null
          ? `$${card.price_min}\u2013$${card.price_max}`
          : null,
        priceTier: card.price_tiers?.[0] || card.price_tier || 'chill',
        priceTiers: card.price_tiers?.length ? card.price_tiers : [card.price_tier || 'chill'],
        rating: card.rating || 0,
        reviewCount: card.review_count || 0,
        address: card.address || '',
        lat: card.lat,
        lng: card.lng,
        distance: `${distKm.toFixed(1)} km`,
        travelTime: `${Math.round(travelMin)} min`,
        distanceKm: distKm,
        travelTimeMin: travelMin,
        highlights: card.highlights || [],
        openingHours: card.opening_hours || null,
        website: card.website || null,
        cardType: card.card_type,
        experienceType: card.experience_type || null,
        tagline: card.tagline || null,
        teaserText: card.teaser_text || null,
        stops: card.stops || null,
        shoppingList: card.shopping_list || null,
        estimatedDuration: card.estimated_duration_minutes || null,
        matchScore: card.base_match_score || 85,
      };
    });

    // Hero cards: first 2 from singles
    const heroCards = formatted.filter(c => c.cardType === 'single').slice(0, 2);

    return new Response(JSON.stringify({
      cards: formatted,
      heroCards,
      featuredCard: heroCards[0] || null,
      expiresAt: null,
      meta: {
        totalResults: formatted.length,
        categories: [...seenCategories],
        successfulCategories: [...seenCategories],
        failedCategories: [],
        cacheHit: false,
        poolFirst: true,
        fromPool: formatted.length,
        fromApi: 0,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[discover-experiences] Error:', err);
    return new Response(JSON.stringify({
      error: (err as Error).message,
      cards: [],
      heroCards: [],
      featuredCard: null,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Haversine distance in km
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Rough travel time estimate
function estimateTravelMin(distKm: number, mode: string): number {
  const speeds: Record<string, number> = {
    walking: 5, bicycling: 15, transit: 25, driving: 40,
  };
  const speed = speeds[mode] || 40;
  return (distKm / speed) * 60;
}
