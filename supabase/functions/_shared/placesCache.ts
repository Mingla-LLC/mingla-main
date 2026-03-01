import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Centralized Google Places API cache utility.
 * Used by ALL edge functions to avoid duplicate API calls.
 * 
 * Cache key: (place_type, location_key, radius_bucket, search_strategy, text_query)
 * location_key = lat.toFixed(2),lng.toFixed(2) (~1.1km grid)
 * radius_bucket = Math.round(radiusMeters / 1000) * 1000
 * TTL: 24h default
 */

const DEFAULT_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,' +
  'places.rating,places.userRatingCount,places.priceLevel,' +
  'places.types,places.primaryType,' +
  'places.regularOpeningHours,places.photos';

interface SearchParams {
  supabaseAdmin: SupabaseClient;
  apiKey: string;
  placeType: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  maxResults?: number;
  strategy?: 'nearby' | 'text';
  textQuery?: string;
  fieldMask?: string;
  ttlHours?: number;
  rankPreference?: string;
  excludedTypes?: string[];
}

interface CacheResult {
  places: any[];
  cacheHit: boolean;
}

function locationKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

function radiusBucket(radiusMeters: number): number {
  return Math.round(radiusMeters / 1000) * 1000;
}

export async function searchPlacesWithCache(params: SearchParams): Promise<CacheResult> {
  const {
    supabaseAdmin,
    apiKey,
    placeType,
    lat,
    lng,
    radiusMeters,
    maxResults = 10,
    strategy = 'nearby',
    textQuery = null,
    fieldMask = DEFAULT_FIELD_MASK,
    ttlHours = 24,
    rankPreference,
    excludedTypes,
  } = params;

  const locKey = locationKey(lat, lng);
  const radBucket = radiusBucket(radiusMeters);

  // ── 1. CHECK CACHE ──────────────────────────────────────────────────
  try {
    const query = supabaseAdmin
      .from('google_places_cache')
      .select('id, places, result_count, hit_count')
      .eq('place_type', placeType)
      .eq('location_key', locKey)
      .eq('radius_bucket', radBucket)
      .eq('search_strategy', strategy)
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    // For text searches, also match the query string
    if (strategy === 'text' && textQuery) {
      query.eq('text_query', textQuery);
    }

    const { data: cached, error: cacheErr } = await query.maybeSingle();

    if (!cacheErr && cached?.places) {
      console.log(`[places-cache] HIT: ${placeType} @ ${locKey} r=${radBucket}`);

      // Increment hit count (fire-and-forget)
      supabaseAdmin
        .from('google_places_cache')
        .update({ hit_count: (cached.hit_count || 0) + 1 })
        .eq('id', cached.id)
        .then(() => {})
        .catch(() => {});

      return { places: cached.places as any[], cacheHit: true };
    }
  } catch (err) {
    console.warn('[places-cache] Read error, falling through to API:', err);
  }

  // ── 2. CACHE MISS → CALL GOOGLE PLACES API ─────────────────────────
  console.log(`[places-cache] MISS: ${placeType} @ ${locKey} r=${radBucket}`);

  let places: any[] = [];

  try {
    if (strategy === 'text' && textQuery) {
      // Text Search
      const body: any = {
        textQuery,
        maxResultCount: maxResults,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters,
          },
        },
      };

      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        places = data.places ?? [];
      } else {
        console.error(`[places-cache] Text Search API error: ${res.status}`);
      }
    } else {
      // Nearby Search
      const body: any = {
        includedTypes: [placeType],
        maxResultCount: maxResults,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters,
          },
        },
      };

      if (rankPreference) body.rankPreference = rankPreference;
      if (excludedTypes && excludedTypes.length > 0) body.excludedTypes = excludedTypes;

      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        places = data.places ?? [];
      } else {
        console.error(`[places-cache] Nearby Search API error: ${res.status}`);
      }
    }
  } catch (err) {
    console.error('[places-cache] Google API call threw:', err);
    return { places: [], cacheHit: false };
  }

  // ── 3. WRITE TO CACHE (fire-and-forget) ─────────────────────────────
  if (places.length > 0) {
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    supabaseAdmin
      .from('google_places_cache')
      .upsert({
        place_type: placeType,
        location_key: locKey,
        radius_bucket: radBucket,
        search_strategy: strategy,
        text_query: textQuery,
        places: places,
        result_count: places.length,
        expires_at: expiresAt,
        hit_count: 0,
      }, { onConflict: 'place_type,location_key,radius_bucket,search_strategy,text_query' })
      .then(() => console.log(`[places-cache] Written: ${placeType} @ ${locKey}`))
      .catch((err: any) => console.warn('[places-cache] Write failed:', err));
  }

  return { places, cacheHit: false };
}

/**
 * Batch search: search for multiple place types at once, using cache for each.
 * Returns a map of placeType → places[].
 * This replaces the common `for type of types { searchNearby() }` loop pattern.
 */
export async function batchSearchPlaces(
  supabaseAdmin: SupabaseClient,
  apiKey: string,
  placeTypes: string[],
  lat: number,
  lng: number,
  radiusMeters: number,
  options?: {
    maxResultsPerType?: number;
    rankPreference?: string;
    excludedTypes?: string[];
    ttlHours?: number;
    fieldMask?: string;
    strategy?: 'nearby' | 'text';
    textQueries?: Record<string, string>; // placeType -> textQuery
  }
): Promise<{ results: Record<string, any[]>; apiCallsMade: number; cacheHits: number }> {
  const results: Record<string, any[]> = {};
  let apiCallsMade = 0;
  let cacheHits = 0;

  // Run all lookups in parallel for speed
  const promises = placeTypes.map(async (placeType) => {
    const textQuery = options?.textQueries?.[placeType];
    const strategy = textQuery ? 'text' : (options?.strategy ?? 'nearby');

    const { places, cacheHit } = await searchPlacesWithCache({
      supabaseAdmin,
      apiKey,
      placeType,
      lat,
      lng,
      radiusMeters,
      maxResults: options?.maxResultsPerType ?? 10,
      strategy,
      textQuery: textQuery ?? undefined,
      rankPreference: options?.rankPreference,
      excludedTypes: options?.excludedTypes,
      ttlHours: options?.ttlHours,
      fieldMask: options?.fieldMask,
    });

    results[placeType] = places;
    if (cacheHit) cacheHits++;
    else apiCallsMade++;
  });

  await Promise.all(promises);

  console.log(`[places-cache] Batch: ${placeTypes.length} types, ${cacheHits} hits, ${apiCallsMade} API calls`);
  return { results, apiCallsMade, cacheHits };
}
