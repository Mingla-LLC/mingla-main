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
  'places.regularOpeningHours,places.photos,places.websiteUri';

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

export function locationKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export function radiusBucket(radiusMeters: number): number {
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
    textQuery = '',
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
  let nextPageToken: string | null = null;

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
        nextPageToken = data.nextPageToken || null;
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
        nextPageToken = data.nextPageToken || null;
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
        next_page_token: nextPageToken,
        pages_fetched: 1,
        expires_at: expiresAt,
        hit_count: 0,
      }, { onConflict: 'place_type,location_key,radius_bucket,search_strategy,text_query' })
      .then(() => console.log(`[places-cache] Written: ${placeType} @ ${locKey}${nextPageToken ? ' (has nextPageToken)' : ''}`))
      .catch((err: any) => console.warn('[places-cache] Write failed:', err));
  }

  return { places, cacheHit: false };
}

/**
 * Fetches the next page of Google Places results using a stored nextPageToken.
 * Appends new results to the existing cache entry.
 * Returns the new places and whether more pages are available.
 *
 * IMPORTANT: When using pageToken, the request body must contain ONLY { pageToken }.
 * Including other search params (includedTypes, locationRestriction, etc.) causes a 400.
 */
export async function fetchNextPage(
  supabaseAdmin: SupabaseClient,
  apiKey: string,
  cacheId: string,
): Promise<{ newPlaces: any[]; hasMore: boolean }> {
  // 1. Read the cache entry to get the stored nextPageToken and search_strategy
  const { data: cacheEntry, error } = await supabaseAdmin
    .from('google_places_cache')
    .select('id, places, next_page_token, pages_fetched, place_type, search_strategy')
    .eq('id', cacheId)
    .single();

  if (error || !cacheEntry || !cacheEntry.next_page_token) {
    return { newPlaces: [], hasMore: false };
  }

  // 2. Call Google Places API with ONLY the pageToken — use the correct endpoint
  //    based on the original search strategy (text vs nearby)
  const endpoint = cacheEntry.search_strategy === 'text'
    ? 'https://places.googleapis.com/v1/places:searchText'
    : 'https://places.googleapis.com/v1/places:searchNearby';
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': DEFAULT_FIELD_MASK,
      },
      body: JSON.stringify({
        pageToken: cacheEntry.next_page_token,
      }),
    });
  } catch (fetchErr) {
    console.error('[placesCache] nextPage fetch threw:', fetchErr);
    return { newPlaces: [], hasMore: false };
  }

  if (!res.ok) {
    console.error(`[placesCache] nextPage fetch failed: ${res.status}`);

    // Handle expired token (Google returns 400 for INVALID_PAGE_TOKEN)
    if (res.status === 400) {
      console.warn('[placesCache] pageToken likely expired — clearing from cache');
      await supabaseAdmin
        .from('google_places_cache')
        .update({ next_page_token: null })
        .eq('id', cacheId);
    }

    return { newPlaces: [], hasMore: false };
  }

  const data = await res.json();
  const newPlaces = data.places ?? [];
  const nextToken = data.nextPageToken || null;

  // 3. Append new places to existing cache entry
  const allPlaces = [...(cacheEntry.places || []), ...newPlaces];
  await supabaseAdmin
    .from('google_places_cache')
    .update({
      places: allPlaces,
      result_count: allPlaces.length,
      next_page_token: nextToken,
      pages_fetched: (cacheEntry.pages_fetched || 1) + 1,
    })
    .eq('id', cacheId);

  console.log(`[placesCache] nextPage: got ${newPlaces.length} new places (total now ${allPlaces.length}), hasMore=${!!nextToken}`);
  return { newPlaces, hasMore: !!nextToken };
}

/**
 * Drains all remaining pages for cache entries that have a nextPageToken.
 * Called after batchSearchPlaces to proactively consume all Google pagination.
 * Stops when: no more tokens, token expired (400), or max 3 pages total reached.
 *
 * RC-004 fix: ensures "exhaust everything Google has" actually works.
 */
export async function drainPaginationTokens(
  supabaseAdmin: SupabaseClient,
  apiKey: string,
  placeTypes: string[],
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<{ totalNewPlaces: number; pagesConsumed: number }> {
  const locKey = locationKey(lat, lng);
  const radBucket = radiusBucket(radiusMeters);

  // Find all cache entries for these place types that have unconsumed tokens
  const { data: entries } = await supabaseAdmin
    .from('google_places_cache')
    .select('id, place_type, next_page_token, pages_fetched')
    .eq('location_key', locKey)
    .eq('radius_bucket', radBucket)
    .in('place_type', placeTypes)
    .not('next_page_token', 'is', null)
    .gt('expires_at', new Date().toISOString());

  if (!entries || entries.length === 0) {
    return { totalNewPlaces: 0, pagesConsumed: 0 };
  }

  let totalNewPlaces = 0;
  let pagesConsumed = 0;
  const MAX_PAGES_PER_TYPE = 3; // Google max is 3 pages (60 results)

  for (const entry of entries) {
    let currentPages = entry.pages_fetched || 1;

    while (currentPages < MAX_PAGES_PER_TYPE) {
      const { newPlaces, hasMore } = await fetchNextPage(
        supabaseAdmin,
        apiKey,
        entry.id,
      );

      totalNewPlaces += newPlaces.length;
      pagesConsumed++;
      currentPages++;

      if (!hasMore || newPlaces.length === 0) break;
    }
  }

  if (totalNewPlaces > 0) {
    console.log(`[places-cache] Drained ${pagesConsumed} pages, got ${totalNewPlaces} new places`);
  }

  return { totalNewPlaces, pagesConsumed };
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
      textQuery: textQuery || '',
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

// ── Category-level search (bundles all types into one API call) ──────────────

interface CategorySearchParams {
  supabaseAdmin: SupabaseClient;
  apiKey: string;
  categoryKey: string;
  includedTypes: string[];
  lat: number;
  lng: number;
  radiusMeters: number;
  maxResults?: number;
  rankPreference?: string;
  excludedTypes?: string[];
  ttlHours?: number;
  fieldMask?: string;
}

/**
 * Search Google Places for a CATEGORY (all types bundled in one API call).
 * Cache key uses categoryKey (e.g. "Casual Eats") in the place_type column.
 * Up to 50 types per call (Google API limit).
 */
export async function searchCategoryPlaces(params: CategorySearchParams): Promise<CacheResult> {
  const {
    supabaseAdmin,
    apiKey,
    categoryKey,
    includedTypes,
    lat,
    lng,
    radiusMeters,
    maxResults = 20,
    rankPreference,
    excludedTypes,
    fieldMask = DEFAULT_FIELD_MASK,
    ttlHours = 24,
  } = params;

  if (!includedTypes.length) return { places: [], cacheHit: false };

  const locKey = locationKey(lat, lng);
  const radBucket = radiusBucket(radiusMeters);
  const cacheKey = `cat:${categoryKey}`;

  // ── 1. CHECK CACHE ────────────────────────────────────────────────────
  try {
    const { data: cached, error: cacheErr } = await supabaseAdmin
      .from('google_places_cache')
      .select('id, places, result_count, hit_count')
      .eq('place_type', cacheKey)
      .eq('location_key', locKey)
      .eq('radius_bucket', radBucket)
      .eq('search_strategy', 'nearby')
      .eq('text_query', '')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (!cacheErr && cached?.places) {
      const newHitCount = (cached.hit_count || 0) + 1;
      console.log(`[places-cache] CAT HIT: ${categoryKey} @ ${locKey} r=${radBucket} (hits: ${newHitCount})`);

      // Fire-and-forget: increment hit count; extend TTL to 72h for popular entries (hit_count > 3)
      const updatePayload: Record<string, unknown> = { hit_count: newHitCount };
      if (newHitCount > 3) {
        updatePayload.expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
      }
      supabaseAdmin
        .from('google_places_cache')
        .update(updatePayload)
        .eq('id', cached.id)
        .then(() => {})
        .catch(() => {});

      return { places: cached.places as any[], cacheHit: true };
    }
  } catch (err) {
    console.warn('[places-cache] Category cache read error, falling through to API:', err);
  }

  // ── 2. CACHE MISS → CALL GOOGLE PLACES API (all types in one call) ────
  console.log(`[places-cache] CAT MISS: ${categoryKey} (${includedTypes.length} types) @ ${locKey} r=${radBucket}`);

  let places: any[] = [];

  try {
    // Google allows max 50 includedTypes per call
    const typeBatches: string[][] = [];
    for (let i = 0; i < includedTypes.length; i += 50) {
      typeBatches.push(includedTypes.slice(i, i + 50));
    }

    for (const batch of typeBatches) {
      const body: any = {
        includedTypes: batch,
        maxResultCount: maxResults,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters,
          },
        },
      };

      if (rankPreference) body.rankPreference = rankPreference;
      // NOTE: excludedTypes is NOT sent to Google when includedTypes has multiple entries
      // (Google silently ignores it). We apply it as a post-fetch filter below instead.

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
        places.push(...(data.places ?? []));
      } else {
        console.error(`[places-cache] Category Nearby Search API error: ${res.status} for ${categoryKey}`);
      }
    }
  } catch (err) {
    console.error('[places-cache] Category Google API call threw:', err);
    return { places: [], cacheHit: false };
  }

  // ── Post-fetch filter: remove excluded types (Google ignores excludedTypes with multiple includedTypes) ──
  if (excludedTypes && excludedTypes.length > 0 && places.length > 0) {
    const excludedSet = new Set(excludedTypes);
    const beforeCount = places.length;
    places = places.filter(p => !(p.types || []).some((t: string) => excludedSet.has(t)));
    if (places.length < beforeCount) {
      console.log(`[places-cache] Post-filter: removed ${beforeCount - places.length} excluded-type places for ${categoryKey}`);
    }
  }

  // ── 3. WRITE TO CACHE (fire-and-forget) ───────────────────────────────
  if (places.length > 0) {
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    supabaseAdmin
      .from('google_places_cache')
      .upsert({
        place_type: cacheKey,
        location_key: locKey,
        radius_bucket: radBucket,
        search_strategy: 'nearby',
        text_query: '',
        places,
        result_count: places.length,
        next_page_token: null,
        pages_fetched: 1,
        expires_at: expiresAt,
        hit_count: 0,
      }, { onConflict: 'place_type,location_key,radius_bucket,search_strategy,text_query' })
      .then(() => console.log(`[places-cache] CAT written: ${categoryKey} (${places.length} places)`))
      .catch((err: any) => console.warn('[places-cache] Category cache write failed:', err));
  }

  return { places, cacheHit: false };
}

/**
 * Batch search by CATEGORY: one Google API call per category (not per type).
 * Drop-in replacement for batchSearchPlaces() where callers group by category.
 *
 * @param categoryTypes - Map of categoryName → placeTypes[] (from getCategoryTypeMap)
 * @returns Map of categoryName → places[]
 */
export async function batchSearchByCategory(
  supabaseAdmin: SupabaseClient,
  apiKey: string,
  categoryTypes: Record<string, string[]>,
  lat: number,
  lng: number,
  radiusMeters: number,
  options?: {
    maxResultsPerCategory?: number;
    rankPreference?: string;
    excludedTypes?: string[];
    ttlHours?: number;
    fieldMask?: string;
  },
): Promise<{ results: Record<string, any[]>; apiCallsMade: number; cacheHits: number }> {
  const results: Record<string, any[]> = {};
  let apiCallsMade = 0;
  let cacheHits = 0;

  const categories = Object.keys(categoryTypes);

  const promises = categories.map(async (category) => {
    const types = categoryTypes[category];
    if (!types || types.length === 0) {
      results[category] = [];
      return;
    }

    const { places, cacheHit } = await searchCategoryPlaces({
      supabaseAdmin,
      apiKey,
      categoryKey: category,
      includedTypes: types,
      lat,
      lng,
      radiusMeters,
      maxResults: options?.maxResultsPerCategory ?? 20,
      rankPreference: options?.rankPreference,
      excludedTypes: options?.excludedTypes,
      ttlHours: options?.ttlHours,
      fieldMask: options?.fieldMask,
    });

    results[category] = places;
    if (cacheHit) cacheHits++;
    else apiCallsMade++;
  });

  await Promise.all(promises);

  console.log(`[places-cache] CategoryBatch: ${categories.length} categories, ${cacheHits} hits, ${apiCallsMade} API calls`);
  return { results, apiCallsMade, cacheHits };
}
