import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ── Aggregation helpers (server-side equivalent of mobile sessionPrefsUtils) ──

function majorityVote(values: string[], fallback: string): string {
  const counts: Record<string, number> = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  let best = fallback;
  let bestCount = 0;
  for (const [val, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

interface AggregatedPrefs {
  categories: string[];
  intents: string[];
  priceTiers: string[];
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref: string | null;
  location: { lat: number; lng: number } | null;
}

function aggregateAllPrefs(rows: any[]): AggregatedPrefs {
  if (rows.length === 0) {
    return {
      categories: [],
      intents: [],
      priceTiers: ['chill', 'comfy', 'bougie', 'lavish'],
      budgetMin: 0,
      budgetMax: 1000,
      travelMode: 'walking',
      travelConstraintType: 'time',
      travelConstraintValue: 30,
      datetimePref: null,
      location: null,
    };
  }

  // Categories: union
  const categorySet = new Set<string>();
  for (const row of rows) {
    for (const cat of (row.categories || [])) {
      categorySet.add(cat);
    }
  }

  // Intents: union
  const intentSet = new Set<string>();
  for (const row of rows) {
    for (const intent of (row.intents || [])) {
      intentSet.add(intent);
    }
  }

  // Price tiers: union
  const tierSet = new Set<string>();
  for (const row of rows) {
    for (const tier of (row.price_tiers || [])) {
      tierSet.add(tier);
    }
  }

  // Budget: widest range
  const budgetMin = Math.min(...rows.map((r: any) => r.budget_min ?? 0));
  const budgetMax = Math.max(...rows.map((r: any) => r.budget_max ?? 1000));

  // Travel mode: majority vote
  const travelMode = majorityVote(
    rows.map((r: any) => r.travel_mode || 'walking'),
    'walking'
  );

  // Travel constraint value: median
  const constraintValues = rows
    .map((r: any) => r.travel_constraint_value ?? 30)
    .sort((a: number, b: number) => a - b);
  const mid = Math.floor(constraintValues.length / 2);
  const travelConstraintValue = constraintValues.length % 2 === 0
    ? Math.round((constraintValues[mid - 1] + constraintValues[mid]) / 2)
    : constraintValues[mid];

  // Datetime: earliest
  const datetimes = rows
    .map((r: any) => r.datetime_pref)
    .filter((d: any): d is string => d !== null && d !== undefined)
    .sort();

  // Location: midpoint
  const coords = rows
    .filter((r: any) => r.custom_lat != null && r.custom_lng != null)
    .map((r: any) => ({ lat: r.custom_lat, lng: r.custom_lng }));

  let location: { lat: number; lng: number } | null = null;
  if (coords.length > 0) {
    const avgLat = coords.reduce((s: number, c: any) => s + c.lat, 0) / coords.length;
    const avgLng = coords.reduce((s: number, c: any) => s + c.lng, 0) / coords.length;
    location = { lat: avgLat, lng: avgLng };
  }

  return {
    categories: Array.from(categorySet),
    intents: Array.from(intentSet),
    priceTiers: tierSet.size > 0 ? Array.from(tierSet) : ['chill', 'comfy', 'bougie', 'lavish'],
    budgetMin,
    budgetMax,
    travelMode,
    travelConstraintType: 'time',
    travelConstraintValue,
    datetimePref: datetimes.length > 0 ? datetimes[0] : null,
    location,
  };
}

// ── Stable hash of aggregated preferences ──

async function computePreferencesHash(prefs: AggregatedPrefs): Promise<string> {
  const sorted = JSON.stringify({
    categories: [...prefs.categories].sort(),
    intents: [...prefs.intents].sort(),
    priceTiers: [...prefs.priceTiers].sort(),
    budgetMin: prefs.budgetMin,
    budgetMax: prefs.budgetMax,
    travelMode: prefs.travelMode,
    travelConstraintValue: prefs.travelConstraintValue,
    datetimePref: prefs.datetimePref,
    location: prefs.location,
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(sorted);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Main Handler ──

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { sessionId, batchSeed = 0 } = await req.json();

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'sessionId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Authenticate ──
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') ?? '';

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let userId: string | undefined;
    if (token) {
      const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError) {
        return new Response(
          JSON.stringify({ error: 'Authentication failed' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      userId = userData?.user?.id;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Verify user is a participant ──
    const { data: participation, error: partError } = await supabaseAdmin
      .from('session_participants')
      .select('id')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .single();

    if (partError || !participation) {
      return new Response(
        JSON.stringify({ error: 'Not a participant of this session' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Load all participants' preferences ──
    const { data: allPrefs, error: prefsError } = await supabaseAdmin
      .from('board_session_preferences')
      .select('*')
      .eq('session_id', sessionId);

    if (prefsError) {
      return new Response(
        JSON.stringify({ error: 'Failed to load preferences' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Aggregate preferences ──
    const aggregated = aggregateAllPrefs(allPrefs || []);

    if (aggregated.categories.length === 0 && aggregated.intents.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No participants have set preferences yet' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Compute preferences hash ──
    const preferencesHash = await computePreferencesHash(aggregated);

    // ── Get current deck version ──
    const { data: latestDeck } = await supabaseAdmin
      .from('session_decks')
      .select('deck_version')
      .eq('session_id', sessionId)
      .order('deck_version', { ascending: false })
      .limit(1)
      .single();

    const currentVersion = latestDeck?.deck_version ?? 1;

    // ── Check cache: same hash + batch_seed and not expired ──
    const { data: cachedDeck } = await supabaseAdmin
      .from('session_decks')
      .select('*')
      .eq('session_id', sessionId)
      .eq('preferences_hash', preferencesHash)
      .eq('batch_seed', batchSeed)
      .gt('expires_at', new Date().toISOString())
      .order('generated_at', { ascending: false })
      .limit(1)
      .single();

    if (cachedDeck) {
      console.log(`[generate-session-deck] Cache hit for session ${sessionId}, batch ${batchSeed}`);
      return new Response(
        JSON.stringify({
          deckVersion: cachedDeck.deck_version,
          batchSeed: cachedDeck.batch_seed,
          cards: cachedDeck.cards,
          totalCards: cachedDeck.total_cards,
          hasMore: cachedDeck.has_more,
          preferencesHash: cachedDeck.preferences_hash,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── No cache hit — resolve location ──
    // Use aggregated location if available, otherwise fall back to first participant with GPS
    let location = aggregated.location;
    if (!location) {
      // Try to get location from preferences with GPS enabled
      const gpsPrefs = (allPrefs || []).find((p: any) => p.use_gps_location === true);
      if (gpsPrefs?.custom_lat && gpsPrefs?.custom_lng) {
        location = { lat: gpsPrefs.custom_lat, lng: gpsPrefs.custom_lng };
      }
    }

    // If still no location, try the session creator's solo preferences
    if (!location) {
      const { data: sessionData } = await supabaseAdmin
        .from('collaboration_sessions')
        .select('created_by')
        .eq('id', sessionId)
        .single();

      if (sessionData?.created_by) {
        const { data: creatorPrefs } = await supabaseAdmin
          .from('preferences')
          .select('use_gps_location, custom_location')
          .eq('profile_id', sessionData.created_by)
          .single();

        // For GPS users, we need the last known location from user_location_history
        if (creatorPrefs?.use_gps_location) {
          const { data: locationData } = await supabaseAdmin
            .from('user_location_history')
            .select('latitude, longitude')
            .eq('user_id', sessionData.created_by)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (locationData) {
            location = { lat: locationData.latitude, lng: locationData.longitude };
          }
        }
      }
    }

    if (!location) {
      return new Response(
        JSON.stringify({ error: 'No location available for deck generation' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Call discover-cards internally via HTTP ──
    console.log(`[generate-session-deck] Generating deck for session ${sessionId}, batch ${batchSeed}, categories=[${aggregated.categories}]`);

    const discoverUrl = `${SUPABASE_URL}/functions/v1/discover-cards`;
    const discoverResponse = await fetch(discoverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      },
      body: JSON.stringify({
        categories: aggregated.categories,
        location,
        budgetMax: aggregated.budgetMax,
        travelMode: aggregated.travelMode,
        travelConstraintValue: aggregated.travelConstraintValue,
        datetimePref: aggregated.datetimePref,
        dateOption: aggregated.datetimePref ? 'specific' : 'now',
        batchSeed,
        limit: 20,
        priceTiers: aggregated.priceTiers,
      }),
    });

    if (!discoverResponse.ok) {
      const errorText = await discoverResponse.text();
      console.error(`[generate-session-deck] discover-cards failed:`, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to generate deck from discover-cards' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const discoverData = await discoverResponse.json();
    const cards = discoverData.cards || [];
    const totalCards = discoverData.total || cards.length;
    const hasMore = discoverData.metadata?.hasMore ?? false;

    // ── Determine new deck version ──
    // If hash differs from latest deck's hash, increment version
    const { data: latestForSession } = await supabaseAdmin
      .from('session_decks')
      .select('deck_version, preferences_hash')
      .eq('session_id', sessionId)
      .order('deck_version', { ascending: false })
      .limit(1)
      .single();

    const newVersion = latestForSession && latestForSession.preferences_hash !== preferencesHash
      ? (latestForSession.deck_version ?? 0) + 1
      : currentVersion;

    // ── Store deck — ON CONFLICT DO NOTHING to handle race conditions ──
    const { error: insertError } = await supabaseAdmin
      .from('session_decks')
      .upsert({
        session_id: sessionId,
        deck_version: newVersion,
        batch_seed: batchSeed,
        cards,
        preferences_hash: preferencesHash,
        total_cards: totalCards,
        has_more: hasMore,
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }, {
        onConflict: 'session_id,deck_version,batch_seed',
      });

    if (insertError) {
      console.warn(`[generate-session-deck] Upsert warning:`, insertError.message);
      // If upsert failed due to conflict, fetch the existing row
      const { data: existingDeck } = await supabaseAdmin
        .from('session_decks')
        .select('*')
        .eq('session_id', sessionId)
        .eq('deck_version', newVersion)
        .eq('batch_seed', batchSeed)
        .single();

      if (existingDeck) {
        return new Response(
          JSON.stringify({
            deckVersion: existingDeck.deck_version,
            batchSeed: existingDeck.batch_seed,
            cards: existingDeck.cards,
            totalCards: existingDeck.total_cards,
            hasMore: existingDeck.has_more,
            preferencesHash: existingDeck.preferences_hash,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[generate-session-deck] Stored deck: version=${newVersion}, batch=${batchSeed}, cards=${cards.length}`);

    return new Response(
      JSON.stringify({
        deckVersion: newVersion,
        batchSeed,
        cards,
        totalCards,
        hasMore,
        preferencesHash,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[generate-session-deck] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as any)?.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
