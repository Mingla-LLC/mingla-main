import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { timeoutFetch } from './timeoutFetch.ts';

/**
 * Google Places API utility.
 * Calls Google Places API directly — results are stored in place_pool + card_pool
 * by downstream callers (e.g., storeResultsInPoolBatched in discover-cards).
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

/**
 * Search Google Places API directly. No cache layer.
 * Returns { places, cacheHit: false } for backward compatibility.
 */
export async function searchPlaces(params: SearchParams): Promise<CacheResult> {
  const {
    apiKey,
    placeType,
    lat,
    lng,
    radiusMeters,
    maxResults = 10,
    strategy = 'nearby',
    textQuery = '',
    fieldMask = DEFAULT_FIELD_MASK,
    rankPreference,
    excludedTypes,
  } = params;

  const locKey = locationKey(lat, lng);
  const radBucket = radiusBucket(radiusMeters);

  console.log(`[places] Calling Google API: ${placeType} @ ${locKey} r=${radBucket}`);

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

      const res = await timeoutFetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
        timeoutMs: 8000,
      });

      if (res.ok) {
        const data = await res.json();
        places = data.places ?? [];
      } else {
        console.error(`[places] Text Search API error: ${res.status}`);
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

      const res = await timeoutFetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
        timeoutMs: 8000,
      });

      if (res.ok) {
        const data = await res.json();
        places = data.places ?? [];
      } else {
        console.error(`[places] Nearby Search API error: ${res.status}`);
      }
    }
  } catch (err) {
    if ((err as any)?.name === 'AbortError') {
      console.warn(`[places] Google API timed out after 8s for ${placeType} @ ${locKey}`);
    } else {
      console.error('[places] Google API call threw:', err);
    }
    return { places: [], cacheHit: false };
  }

  return { places, cacheHit: false };
}

/**
 * Backward-compatible alias for searchPlaces().
 * Legacy edge functions import this name — kept to avoid breaking them.
 */
export const searchPlacesWithCache = searchPlaces;

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
 * Up to 50 types per call (Google API limit).
 */
export async function searchCategoryPlaces(params: CategorySearchParams): Promise<CacheResult> {
  const {
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
  } = params;

  if (!includedTypes.length) return { places: [], cacheHit: false };

  const locKey = locationKey(lat, lng);
  const radBucket = radiusBucket(radiusMeters);

  console.log(`[places] CAT API call: ${categoryKey} (${includedTypes.length} types) @ ${locKey} r=${radBucket}`);

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

      const res = await timeoutFetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
        timeoutMs: 8000,
      });

      if (res.ok) {
        const data = await res.json();
        places.push(...(data.places ?? []));
      } else {
        console.error(`[places] Category Nearby Search API error: ${res.status} for ${categoryKey}`);
      }
    }
  } catch (err) {
    if ((err as any)?.name === 'AbortError') {
      console.warn(`[places] Category Google API timed out after 8s for ${categoryKey}`);
    } else {
      console.error('[places] Category Google API call threw:', err);
    }
    return { places: [], cacheHit: false };
  }

  // ── Post-fetch filter: remove excluded types (Google ignores excludedTypes with multiple includedTypes) ──
  if (excludedTypes && excludedTypes.length > 0 && places.length > 0) {
    const excludedSet = new Set(excludedTypes);
    const beforeCount = places.length;
    places = places.filter(p => !(p.types || []).some((t: string) => excludedSet.has(t)));
    if (places.length < beforeCount) {
      console.log(`[places] Post-filter: removed ${beforeCount - places.length} excluded-type places for ${categoryKey}`);
    }
  }

  return { places, cacheHit: false };
}

/**
 * Batch search by CATEGORY: one Google API call per category (not per type).
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
  const cacheHits = 0;

  const categories = Object.keys(categoryTypes);

  const promises = categories.map(async (category) => {
    const types = categoryTypes[category];
    if (!types || types.length === 0) {
      results[category] = [];
      return;
    }

    const { places } = await searchCategoryPlaces({
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
    apiCallsMade++;
  });

  await Promise.all(promises);

  console.log(`[places] CategoryBatch: ${categories.length} categories, ${cacheHits} hits, ${apiCallsMade} API calls`);
  return { results, apiCallsMade, cacheHits };
}

/**
 * Batch search: search for multiple place types at once.
 * Returns a map of placeType → places[].
 *
 * Kept for backward compatibility with legacy discover-{category} edge functions.
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
    textQueries?: Record<string, string>;
  }
): Promise<{ results: Record<string, any[]>; apiCallsMade: number; cacheHits: number }> {
  const results: Record<string, any[]> = {};
  let apiCallsMade = 0;
  const cacheHits = 0;

  // Run all lookups in parallel for speed
  const promises = placeTypes.map(async (placeType) => {
    const textQuery = options?.textQueries?.[placeType];
    const strategy = textQuery ? 'text' : (options?.strategy ?? 'nearby');

    const { places } = await searchPlaces({
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
    apiCallsMade++;
  });

  await Promise.all(promises);

  console.log(`[places] Batch: ${placeTypes.length} types, ${cacheHits} hits, ${apiCallsMade} API calls`);
  return { results, apiCallsMade, cacheHits };
}
