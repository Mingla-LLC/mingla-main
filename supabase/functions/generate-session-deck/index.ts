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

// ORCH-0434: Removed priceTiers, budgetMin, budgetMax, timeSlots. Added selectedDates.
interface AggregatedPrefs {
  categories: string[];
  intents: string[];
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref: string | null;
  location: { lat: number; lng: number } | null;
  dateOption: string;
  selectedDates: string[];
}

// UNION AGGREGATION (DEC-008 through DEC-011): All strategies use union/max/most-permissive.
// Never use median, min, or majority-vote for collab aggregation.
function aggregateAllPrefs(rows: any[]): AggregatedPrefs {
  if (rows.length === 0) {
    return {
      categories: [],
      intents: [],
      travelMode: 'walking',
      travelConstraintType: 'time',
      travelConstraintValue: 30,
      datetimePref: null,
      location: null,
      dateOption: 'today',
      selectedDates: [],
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

  // ORCH-0434: Price tiers, budget removed from aggregation.

  // Selected dates: union of all participants' dates (deduplicated)
  const dateSet = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row.selected_dates)) {
      for (const d of row.selected_dates) dateSet.add(d);
    }
  }

  // Travel mode: most permissive for widest card search radius (DEC-009)
  const MODE_RANK: Record<string, number> = { walking: 1, biking: 2, transit: 3, driving: 4 };
  const travelMode = rows
    .map((r: any) => r.travel_mode || 'walking')
    .sort((a: string, b: string) => (MODE_RANK[b] ?? 0) - (MODE_RANK[a] ?? 0))[0] || 'walking';

  // Travel constraint: widest radius (DEC-008 — UNION = Math.max)
  const travelConstraintValue = Math.max(
    ...rows.map((r: any) => r.travel_constraint_value ?? 30)
  );

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

  // Date option: most permissive window (DEC-011 — UNION)
  const DATE_RANK: Record<string, number> = {
    'now': 1, 'today': 2, 'this-weekend': 3, 'this weekend': 3, 'pick-a-date': 4,
  };
  const dateOption = rows
    .map((r: any) => r.date_option || 'now')
    .sort((a: string, b: string) => (DATE_RANK[b] ?? 0) - (DATE_RANK[a] ?? 0))[0] || 'now';

  // ORCH-0434: Time slots removed from aggregation.

  return {
    categories: Array.from(categorySet),
    intents: Array.from(intentSet),
    travelMode,
    travelConstraintType: 'time',
    travelConstraintValue,
    datetimePref: datetimes.length > 0 ? datetimes[0] : null,
    location,
    dateOption,
    selectedDates: Array.from(dateSet),
  };
}

// ── Stable hash of aggregated preferences ──

async function computePreferencesHash(prefs: AggregatedPrefs): Promise<string> {
  // ORCH-0434: Removed priceTiers, budgetMin, budgetMax, timeSlots. Added selectedDates.
  const sorted = JSON.stringify({
    categories: [...prefs.categories].sort(),
    intents: [...prefs.intents].sort(),
    travelMode: prefs.travelMode,
    travelConstraintValue: prefs.travelConstraintValue,
    datetimePref: prefs.datetimePref,
    location: prefs.location,
    dateOption: prefs.dateOption,
    selectedDates: [...prefs.selectedDates].sort(),
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
    const body = await req.json();

    // ── Keep-warm ping: boot the isolate without running business logic ──
    if (body.warmPing) {
      return new Response(JSON.stringify({ status: 'warm' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { sessionId, batchSeed = 0, excludeCardIds: rawExcludeCardIds = [] } = body;

    // Accept all string IDs — can be Google Place IDs or card_pool UUIDs
    const excludeCardIds: string[] = Array.isArray(rawExcludeCardIds)
      ? rawExcludeCardIds.filter((id: unknown) => typeof id === 'string' && (id as string).length > 0)
      : [];

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
          .select('use_gps_location, custom_location, custom_lat, custom_lng')
          .eq('profile_id', sessionData.created_by)
          .single();

        if (creatorPrefs) {
          // Priority 1: Direct coordinates from solo prefs (works for both GPS and manual users)
          if (creatorPrefs.custom_lat != null && creatorPrefs.custom_lng != null) {
            location = { lat: creatorPrefs.custom_lat, lng: creatorPrefs.custom_lng };
          }
          // Priority 2: GPS user's last known location from history
          else if (creatorPrefs.use_gps_location) {
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
    }

    if (!location) {
      return new Response(
        JSON.stringify({ error: 'No location available for deck generation' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Build parallel fetch promises (mirrors solo deckService dual pipeline) ──
    console.log(`[generate-session-deck] Generating deck for session ${sessionId}, batch ${batchSeed}, categories=[${aggregated.categories}], intents=[${aggregated.intents}]`);

    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const commonHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': anonKey,
    };

    // Pipeline 1: Category cards via discover-cards
    // Phase 5: limit raised to 10000 (effectively unlimited). Return all matching cards.
    // The RPC returns cards from the pool; a JS post-filter inside
    // serveCardsFromPipeline strips cards beyond the travel time radius.
    const categoryPromise: Promise<{ cards: any[]; hasMore: boolean }> = (async () => {
      if (aggregated.categories.length === 0) return { cards: [], hasMore: false };
      try {
        const discoverUrl = `${SUPABASE_URL}/functions/v1/discover-cards`;
        const resp = await fetch(discoverUrl, {
          method: 'POST',
          headers: commonHeaders,
          body: JSON.stringify({
            categories: aggregated.categories,
            location,
            travelMode: aggregated.travelMode,
            travelConstraintValue: aggregated.travelConstraintValue,
            datetimePref: aggregated.datetimePref,
            dateOption: aggregated.dateOption,
            selectedDates: aggregated.selectedDates,
            batchSeed,
            limit: 10000, // Phase 5: return all matching cards, no artificial cap
            excludeCardIds,
          }),
        });
        if (!resp.ok) {
          console.error(`[generate-session-deck] discover-cards failed:`, await resp.text());
          return { cards: [], hasMore: false };
        }
        const data = await resp.json();
        return {
          cards: data.cards || [],
          hasMore: data.metadata?.hasMore ?? false,
        };
      } catch (err) {
        console.error(`[generate-session-deck] discover-cards error:`, err);
        return { cards: [], hasMore: false };
      }
    })();

    // Pipeline 2: Curated experience cards via generate-curated-experiences (one call per intent)
    const curatedPromise: Promise<any[][]> = (async () => {
      if (aggregated.intents.length === 0) return [];
      const curatedUrl = `${SUPABASE_URL}/functions/v1/generate-curated-experiences`;
      const curatedLimit = Math.ceil(20 / (aggregated.categories.length + aggregated.intents.length) || 5);
      return Promise.all(
        aggregated.intents.map(async (intent: string): Promise<any[]> => {
          try {
            const resp = await fetch(curatedUrl, {
              method: 'POST',
              headers: commonHeaders,
              body: JSON.stringify({
                experienceType: intent,
                location,
                travelMode: aggregated.travelMode,
                travelConstraintType: 'time',
                travelConstraintValue: aggregated.travelConstraintValue,
                datetimePref: aggregated.datetimePref,
                batchSeed,
                selectedCategories: aggregated.categories.length > 0 ? aggregated.categories : undefined,
                limit: curatedLimit,
                skipDescriptions: true,
              }),
            });
            if (!resp.ok) {
              console.warn(`[generate-session-deck] curated "${intent}" failed:`, await resp.text());
              return [];
            }
            const data = await resp.json();
            return data.cards || [];
          } catch (err) {
            console.warn(`[generate-session-deck] curated "${intent}" error:`, err);
            return [];
          }
        })
      );
    })();

    // Run both pipelines in parallel
    const [categoryResult, curatedResult] = await Promise.allSettled([
      categoryPromise,
      curatedPromise,
    ]);

    const categoryPayload = categoryResult.status === 'fulfilled' ? categoryResult.value : { cards: [], hasMore: false };
    const categoryCards = categoryPayload.cards;
    const categoryHasMore = categoryPayload.hasMore;
    const curatedArrays = curatedResult.status === 'fulfilled' ? curatedResult.value : [];

    // Flatten curated arrays into a single stream
    const curatedCards: any[] = [];
    for (const arr of curatedArrays) {
      curatedCards.push(...arr);
    }

    // 1:1 interleave: alternate category and curated cards (mirrors solo deckService)
    const cards: any[] = [];
    const maxLen = Math.max(categoryCards.length, curatedCards.length);
    const seen = new Set<string>();
    for (let i = 0; i < maxLen && cards.length < 20; i++) {
      if (i < categoryCards.length) {
        const id = categoryCards[i].placeId || categoryCards[i].id || `cat_${i}`;
        if (!seen.has(id)) {
          seen.add(id);
          cards.push(categoryCards[i]);
        }
      }
      if (i < curatedCards.length && cards.length < 20) {
        const id = curatedCards[i].id || `cur_${i}`;
        if (!seen.has(id)) {
          seen.add(id);
          cards.push(curatedCards[i]);
        }
      }
    }

    if (categoryCards.length === 0 && curatedCards.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No cards generated from either pipeline' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const totalCards = cards.length;
    // ORCH-0404: hasMore now uses the pool-level signal from discover-cards
    // instead of the batch-size heuristic (categoryCards.length >= 20).
    // The old heuristic reported false when the post-filter reduced a large
    // pool to <20 cards, causing the client to declare "entire deck seen."
    const hasMore = categoryHasMore || curatedCards.length > 0;

    // ── Determine new deck version (single query, fixes MED-001) ──
    const { data: latestForSession } = await supabaseAdmin
      .from('session_decks')
      .select('deck_version, preferences_hash')
      .eq('session_id', sessionId)
      .order('deck_version', { ascending: false })
      .limit(1)
      .single();

    const baseVersion = latestForSession?.deck_version ?? 1;
    const newVersion = latestForSession && latestForSession.preferences_hash !== preferencesHash
      ? baseVersion + 1
      : baseVersion;

    // ── Store deck — INSERT with ignoreDuplicates (ON CONFLICT DO NOTHING) ──
    // This ensures the first writer wins and Realtime INSERT fires exactly once.
    const { data: insertedDeck, error: insertError } = await supabaseAdmin
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
        ignoreDuplicates: true,
      })
      .select()
      .single();

    // If insert was ignored (conflict / no rows returned), fetch the existing row
    if (!insertedDeck || insertError) {
      if (insertError) {
        console.warn(`[generate-session-deck] Insert conflict or error:`, insertError.message);
      }
      const { data: existingDeck } = await supabaseAdmin
        .from('session_decks')
        .select('*')
        .eq('session_id', sessionId)
        .eq('deck_version', newVersion)
        .eq('batch_seed', batchSeed)
        .single();

      if (existingDeck) {
        console.log(`[generate-session-deck] Returning existing deck (conflict): version=${newVersion}, batch=${batchSeed}`);
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

    console.log(`[generate-session-deck] Stored deck: version=${newVersion}, batch=${batchSeed}, cards=${cards.length}, curated=${curatedCards.length}`);

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
