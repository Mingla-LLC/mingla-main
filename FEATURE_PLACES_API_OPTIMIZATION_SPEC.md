# Feature: Google Places API Cost Optimization
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** "i checked my google place api new and saw 9473 requests. could we optimize this with better handling, caching etc."

## Summary

The Mingla platform currently makes an excessive number of Google Places API (New) calls due to: (1) per-category loop multiplication across 7+ edge functions that each independently search Google Places, (2) no shared server-side place cache aside from `curated_places_cache` (24h, curated only) and `discover_daily_cache` (per-user, per-day), (3) in-memory caches in edge functions that are useless because Deno edge functions cold-start on each invocation, (4) backfill logic that makes extra API calls when initial results are insufficient, and (5) two mobile services calling Google APIs directly without caching.

This spec introduces a **centralized Supabase-persisted place cache** shared across all edge functions, reduces per-invocation API calls through smarter batching, and proxies mobile-side direct calls through edge functions with caching.

**Estimated reduction: 60-75% of current API calls.**

## User Story

As a developer, I want to dramatically reduce Google Places API usage so that operating costs stay low and API quota isn't exhausted, while keeping the user experience identical.

## Root Cause Analysis

### Current API Call Sources (per single user interaction)

| Edge Function | Calls Per Invocation | Caching | Notes |
|---|---|---|---|
| `new-generate-experience-` | **3 × N categories** (e.g., 5 cats = 15 calls) + Distance Matrix | ❌ None | Loops `placeTypes.slice(0,3)` per category |
| `discover-experiences` | **10 categories** parallel + backfill | ✅ `discover_daily_cache` (per-user/day) | Location-specific but user-scoped cache |
| `generate-curated-experiences` | **All 9 category groups** (~20+ types) | ✅ `curated_places_cache` (24h, location-key) | Best existing cache – location-shared |
| `holiday-experiences` | **N categories** + backfill | ❌ None | Extra calls when < maxResults |
| `night-out-experiences` | **N venue types** (4-8 searches) | ❌ None | |
| `generate-session-experiences` | **3 × N categories** (mirrors new-generate) | ❌ None | |
| `get-companion-stops` | 1-3 Nearby Searches | ❌ None | On-demand per stroll card |
| `get-picnic-grocery` | 1-2 Nearby Searches | ❌ None | On-demand per picnic card |
| `places` | N type searches (LEGACY old API) | ❌ In-memory (useless) | Uses **old** Places API |
| `recommendations` | N type searches (LEGACY old API) | ❌ In-memory (useless) | Uses **old** Places API |
| `geocodingService.ts` (mobile) | Autocomplete keystrokes | ❌ None | Direct from mobile |
| `busynessService.ts` (mobile) | Routes + Timezone | ❌ None | Direct from mobile |

### Key Problems

1. **Loop multiplication**: `new-generate-experience-` does `for category → for placeType of placeTypes.slice(0,3)`. With 5 categories, that's 15 Nearby Search API calls per generation.
2. **No shared cache**: Each function fetches from Google independently. If a user generates experiences, then checks Discover, then generates curated — the same places near the same location are fetched 3 separate times.
3. **Ephemeral in-memory cache**: The `places` function has `const cache = new Map()` but edge functions cold-start, so this cache is always empty.
4. **Per-user Discover cache**: `discover_daily_cache` is keyed per user. 100 users in the same city = 100× the same API calls.
5. **Backfill logic**: `holiday-experiences` iterates through ALL `DISCOVER_CATEGORIES` making extra calls when initial results are sparse.
6. **Mobile direct calls**: Autocomplete and Routes calls go directly to Google from the phone.

## Architecture Impact

### Modified files:
- `supabase/functions/new-generate-experience-/index.ts` — use shared cache
- `supabase/functions/discover-experiences/index.ts` — use shared cache + location-based cache
- `supabase/functions/generate-curated-experiences/index.ts` — extend existing cache to shared table
- `supabase/functions/holiday-experiences/index.ts` — use shared cache, remove backfill
- `supabase/functions/night-out-experiences/index.ts` — use shared cache
- `supabase/functions/generate-session-experiences/index.ts` — use shared cache
- `supabase/functions/get-companion-stops/index.ts` — use shared cache
- `supabase/functions/get-picnic-grocery/index.ts` — use shared cache
- `supabase/functions/places/index.ts` — migrate to Places API (New) + shared cache
- `app-mobile/src/services/geocodingService.ts` — add client-side debounce + result cache, increase debounce to 500ms
- `app-mobile/src/services/busynessService.ts` — add result cache for Routes API
- `app-mobile/src/hooks/useDiscoverQuery.ts` — no change needed (already has good staleTime)

### New files:
- `supabase/functions/_shared/placesCache.ts` — shared cache utility used by all edge functions
- `supabase/migrations/YYYYMMDD_google_places_cache.sql` — centralized cache table

### New DB tables:
- `google_places_cache` — centralized place search result cache

## Database Changes

```sql
-- ============================================================
-- Centralized Google Places API response cache
-- Shared across ALL edge functions
-- Key: (place_type, location_key, radius_bucket)
-- TTL: 24 hours (configurable per query)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.google_places_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Cache key components
  place_type TEXT NOT NULL,           -- e.g. "restaurant", "park", "bar"
  location_key TEXT NOT NULL,         -- lat,lng rounded to 2 decimals: "37.77,-122.42"
  radius_bucket INTEGER NOT NULL,     -- radius rounded to nearest 1000m
  search_strategy TEXT NOT NULL DEFAULT 'nearby',  -- 'nearby' | 'text'
  text_query TEXT,                    -- only for text search strategy
  
  -- Cached response
  places JSONB NOT NULL DEFAULT '[]', -- array of place objects from Google
  result_count INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  hit_count INTEGER NOT NULL DEFAULT 0,
  
  -- Composite unique constraint for upsert
  CONSTRAINT uq_places_cache_key UNIQUE (place_type, location_key, radius_bucket, search_strategy, text_query)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_places_cache_lookup 
  ON public.google_places_cache (place_type, location_key, radius_bucket, search_strategy)
  WHERE expires_at > now();

-- Index for TTL cleanup
CREATE INDEX IF NOT EXISTS idx_places_cache_expiry 
  ON public.google_places_cache (expires_at);

-- Enable RLS (service role only — edge functions use service role key)
ALTER TABLE public.google_places_cache ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write (edge functions use SUPABASE_SERVICE_ROLE_KEY)
CREATE POLICY "service_role_all" ON public.google_places_cache
  FOR ALL USING (auth.role() = 'service_role');

-- Auto-cleanup: delete expired entries (run via pg_cron or manual trigger)
CREATE OR REPLACE FUNCTION cleanup_expired_places_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM public.google_places_cache WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule cleanup every 6 hours (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-places-cache', '0 */6 * * *', 'SELECT cleanup_expired_places_cache()');
```

## Shared Cache Utility Spec

**File:** `supabase/functions/_shared/placesCache.ts`

**Purpose:** Single module imported by all edge functions that wraps Google Places API calls with Supabase-persisted caching.

```typescript
interface CachedSearchParams {
  supabaseAdmin: SupabaseClient;
  apiKey: string;
  placeType: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  maxResults?: number;         // default 10
  strategy?: 'nearby' | 'text'; // default 'nearby'
  textQuery?: string;          // required if strategy === 'text'
  fieldMask?: string;          // override default field mask
  ttlHours?: number;           // default 24
  rankPreference?: string;     // 'POPULARITY' | 'DISTANCE'
  excludedTypes?: string[];
}

interface CacheResult {
  places: any[];
  cacheHit: boolean;
}

async function searchPlacesWithCache(params: CachedSearchParams): Promise<CacheResult>;
```

**Logic:**
1. Compute `location_key` = `lat.toFixed(2),lng.toFixed(2)` (rounds to ~1.1km grid)
2. Compute `radius_bucket` = `Math.round(radiusMeters / 1000) * 1000`
3. Query `google_places_cache` for matching row where `expires_at > now()`
4. If HIT: increment `hit_count`, return places
5. If MISS: call Google Places API, store result, return places
6. On API error: return empty array (don't cache errors)

## Per-Function Optimization Changes

### 1. `new-generate-experience-` — **Biggest win**
**Current:** `for category → for placeType of placeTypes.slice(0,3)` = 3 API calls per category
**Change:** Reduce to **1 call per category** using the most representative type. Use shared cache.
**Impact:** 15 calls → 5 calls → (with cache hits) 0-2 calls

### 2. `discover-experiences` — **Make cache location-based, not user-based**
**Current:** `discover_daily_cache` is per-user. 100 users in same area = 100× API calls.
**Change:** Use `google_places_cache` as first layer (location-based, shared). Keep `discover_daily_cache` as second layer for per-user card selection/ordering only.
**Impact:** After first user in an area, all subsequent users get cache hits.

### 3. `holiday-experiences` — **Remove backfill, use cache**
**Current:** Backfill logic makes additional API calls when results are sparse.
**Change:** Use shared cache. Remove backfill — if a category returns few results, that's fine.
**Impact:** Remove ~3-5 extra API calls per invocation.

### 4. `night-out-experiences` — **Use shared cache**
**Current:** No caching at all.
**Change:** Use `searchPlacesWithCache()` for every venue type search.
**Impact:** After first search in an area, all repeated calls are cache hits.

### 5. `generate-session-experiences` — **Use shared cache**
**Current:** Mirrors `new-generate-experience-` with same loop multiplication, no caching.
**Change:** Same treatment as #1.

### 6. `get-companion-stops` + `get-picnic-grocery` — **Use shared cache**
**Current:** On-demand, no caching.
**Change:** These fetch common types (coffee_shop, restaurant, grocery_store) near popular places — high cache hit rate.

### 7. `places` function — **Migrate to New API + shared cache**
**Current:** Uses LEGACY API (`maps.googleapis.com/maps/api/place/nearbysearch`). In-memory cache.
**Change:** Migrate to Places API (New) + use shared cache.

### 8. Mobile: `geocodingService.ts` — **Increase debounce, cache results**
**Current:** Autocomplete fires per keystroke after current debounce.
**Change:** Increase debounce to 500ms. Cache last N autocomplete results in memory. MinQueryLength = 3.

### 9. Mobile: `busynessService.ts` — **Cache Routes API results**
**Current:** Routes API called every time, no caching.
**Change:** Cache route results in AsyncStorage for 30 min (traffic changes, but not per-second).

## React Query Optimization

Current settings are already reasonable:
- `useDiscoverQuery`: 1h staleTime, 24h gcTime ✅
- `useCuratedExperiences`: 30min staleTime, 2h gcTime ✅

**One change:** Add `structuralSharing: true` (default) and ensure `queryKey` includes location rounded to 2 decimals so nearby locations share cache.

## Estimated Impact

| Optimization | Estimated Reduction |
|---|---|
| Shared `google_places_cache` table (24h TTL) | **40-50%** — eliminates repeated searches for same location+type |
| Reduce loop multiplication (3→1 type per category) | **10-15%** — fewer calls per generation |
| Location-based discover cache (shared across users) | **5-10%** — depends on user density |
| Remove backfill logic | **3-5%** — fewer wasted calls |
| Mobile-side autocomplete optimization | **5-8%** — depends on typing patterns |
| **Total estimated reduction** | **60-75%** |

## Test Cases

1. **Cache hit on repeated search**: Call `discover-experiences` for NYC twice → second call should return 0 Google API calls (all from `google_places_cache`).
2. **Cross-function cache sharing**: Generate curated experiences for location X, then generate regular experiences for same location → shared place types should be cache hits.
3. **Cache expiry**: Insert a cache row with `expires_at` = 1 hour ago → verify it's not returned and a fresh API call is made.
4. **Different locations**: Search for "park" at lat=37.77 and lat=37.78 (rounds to same key) → cache hit. Search at lat=37.70 → cache miss.
5. **Fallback on cache write failure**: If Supabase insert fails, API call still returns results (don't block on cache write).

## Success Criteria

- [ ] Google Places API requests drop by 50%+ within one week of deployment
- [ ] No user-visible behavior change (same places, same quality)
- [ ] All edge functions use the shared `searchPlacesWithCache()` utility
- [ ] `google_places_cache` table shows >60% hit rate after warmup period
- [ ] Mobile autocomplete fires fewer than 3 API calls per search session
- [ ] No new latency added (cache reads from Supabase < 50ms)
