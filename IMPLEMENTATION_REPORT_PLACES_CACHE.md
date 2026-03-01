# Implementation Report: Google Places API Cost Optimization

## Summary (Plain English)

We added a centralized caching layer that sits between every Mingla edge function and the Google Places API. Instead of each function making fresh API calls every time a user opens the app, they now check a shared PostgreSQL cache table first. Nearby searches within ~1.1 km of each other and for the same place type share cached results for 24 hours. This eliminates the vast majority of redundant API calls, targeting a 60–75% reduction in Google Places billing.

On the mobile side, we added in-memory caches for autocomplete suggestions (5-minute TTL) and Google Routes traffic data (30-minute TTL) to cut down on repeated identical requests during a single user session.

---

## What Was There Before

### Edge Functions (Backend)
- **9 edge functions** each made direct Google Places API calls with no shared caching layer.
- `new-generate-experience-` looped over `categories × placeTypes.slice(0,3)`, generating up to 15+ API calls per invocation.
- `holiday-experiences` contained ~140 lines of dead code (`fetchExperiencesForCategories`) that was never called.
- `generate-curated-experiences` had its own isolated `curated_places_cache` table but still made uncached calls to `searchNearby` and `searchByText` for cache misses.
- `places/index.ts` was still using the **Legacy Places API** (old `nearbySearch` format), not the Places API (New).
- `places/index.ts` had an in-memory `Map` cache that was useless in a serverless deployment (cold starts discard state).
- `night-out-experiences`, `get-companion-stops`, `get-picnic-grocery`, `generate-session-experiences`, and `discover-experiences` all made direct API calls with no caching.

### Mobile Services
- `geocodingService.ts` fired a new autocomplete API request on every keystroke beyond 3 characters, even for identical queries.
- `busynessService.ts` called the Google Routes API for every route calculation with no result caching.

---

## What Changed

### New Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260301000001_google_places_cache.sql` | Creates `google_places_cache` table with composite unique key, indexes, RLS, and auto-cleanup function |
| `supabase/functions/_shared/placesCache.ts` | Shared cache utility exporting `searchPlacesWithCache()` and `batchSearchPlaces()` |

### Modified Edge Functions (9 total)

| Function | Key Changes |
|----------|-------------|
| `discover-experiences/index.ts` | Imports `batchSearchPlaces`; `fetchCandidatesForCategory` now uses cached batch search with fallback to direct API |
| `new-generate-experience-/index.ts` | Reduced from `categories × 3 types` loop to `1 primary type per category` via `batchSearchPlaces`; added Supabase admin client |
| `holiday-experiences/index.ts` | Added `createClient` + `batchSearchPlaces`; deleted ~140 lines of dead `fetchExperiencesForCategories` function |
| `night-out-experiences/index.ts` | Module-level `supabaseAdmin`; `fetchVenuesForType` uses `batchSearchPlaces` |
| `generate-session-experiences/index.ts` | Module-level `supabaseAdmin`; `fetchGooglePlaces` uses `batchSearchPlaces` per unique type |
| `generate-curated-experiences/index.ts` | `searchNearby` and `searchByText` function bodies replaced to route through `searchPlacesWithCache`; higher-level `curated_places_cache` preserved |
| `get-companion-stops/index.ts` | Module-level `supabaseAdmin`; uses `batchSearchPlaces` with 9 companion types |
| `get-picnic-grocery/index.ts` | Module-level `supabaseAdmin`; uses `batchSearchPlaces`; existing grocery filtering preserved |
| `places/index.ts` | **Full migration from Legacy API → Places API (New)**; deleted useless in-memory `Map` cache; uses `batchSearchPlaces`; field mappings updated (`place_id` → `place.id`, `place.name` → `place.displayName.text`, etc.) |

### Modified Mobile Services (2 total)

| File | Key Changes |
|------|-------------|
| `app-mobile/src/services/geocodingService.ts` | Added `autocompleteCache` Map (5-min TTL, max 50 entries, LRU eviction); cache check before API call and cache write on result |
| `app-mobile/src/services/busynessService.ts` | Added `routeCache` Map (30-min TTL, max 30 entries, LRU eviction); coordinates rounded to 2 decimals for cache key |

---

## Implementation Details

### Database: `google_places_cache` Table

```sql
CREATE TABLE google_places_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_type TEXT NOT NULL,
  location_key TEXT NOT NULL,        -- "lat.toFixed(2),lng.toFixed(2)"
  radius_bucket INT NOT NULL,        -- Math.round(m / 1000) * 1000
  search_strategy TEXT NOT NULL DEFAULT 'nearby',
  text_query TEXT DEFAULT NULL,
  results JSONB NOT NULL DEFAULT '[]',
  result_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  hit_count INT NOT NULL DEFAULT 0,
  UNIQUE(place_type, location_key, radius_bucket, search_strategy, text_query)
);
```

- **Partial index** on `(place_type, location_key)` where `expires_at > NOW()` for fast lookups.
- **B-tree index** on `expires_at` for efficient cleanup.
- **RLS**: Enabled, with `service_role` granted full access. No user-facing access.
- **Cleanup**: `cleanup_expired_places_cache()` function deletes rows past `expires_at`.

### Shared Cache Utility: `_shared/placesCache.ts`

Two main exports:

1. **`searchPlacesWithCache(params)`** — Single place type search:
   - Checks cache → if HIT: increments `hit_count` (fire-and-forget), returns cached results
   - If MISS: calls Google Places API (New) → writes to cache via upsert (fire-and-forget) → returns fresh results
   - Supports both `nearby` and `text` search strategies

2. **`batchSearchPlaces(supabaseAdmin, apiKey, placeTypes, lat, lng, radiusMeters, options)`** — Multi-type batch search:
   - Runs all place types in parallel via `Promise.allSettled`
   - Returns `{ results: Record<string, any[]>, apiCallsMade: number, cacheHits: number }`
   - Logs cache efficiency stats

### Architecture Decisions

1. **Location grid at 2 decimal places (~1.1 km)**: Users within the same neighborhood share cache hits. This is a deliberate tradeoff — slightly less precise positioning in exchange for dramatically higher cache hit rates.

2. **Radius bucketing at 1000m increments**: A 1500m search and a 1200m search both map to bucket 1000 or 2000. Prevents cache fragmentation from minor radius differences.

3. **Fire-and-forget cache writes**: Cache reads are in the critical path; writes are not. We upsert results without awaiting, so the user response is never delayed by cache storage.

4. **Fallback to direct API**: If the Supabase admin client is unavailable (e.g., missing environment variables), functions fall back to direct Google API calls. The cache is an optimization, not a hard dependency.

5. **`places/index.ts` migrated to Places API (New)**: The old Legacy format (`nearbySearch`, `place_id`, `geometry.location.lat`) was fully replaced with the New API format (`searchNearby`, `place.id`, `place.location.latitude`).

6. **Preserved `generate-curated-experiences` dual cache**: The existing `curated_places_cache` table (higher-level curated route cache) was kept. Only the underlying `searchNearby`/`searchByText` functions now route through the shared cache — an additive improvement with no disruption to existing curated logic.

7. **`new-generate-experience-` loop reduction**: Changed from iterating `categories × placeTypes.slice(0,3)` (potentially 15 API calls) to collecting just the primary type (`placeTypes[0]`) per category (~5 unique types), then calling `batchSearchPlaces` once. With cache hits, this drops to 0–2 actual API calls.

### Mobile Caching Strategy

- **Autocomplete cache**: Keys are lowercase query strings. Results stored with timestamp. Before making an API call, we check if a cached result exists and is under 5 minutes old. LRU eviction kicks in at 50 entries (oldest entry deleted).

- **Route cache**: Keys are `"origin_lat,origin_lng→dest_lat,dest_lng"` with coordinates rounded to 2 decimal places. 30-minute TTL reflects that traffic conditions change slowly enough to reuse within that window. Max 30 entries with LRU eviction.

---

## Expected Results

### Cost Reduction Estimates

| Scenario | Before (API calls) | After (API calls) | Reduction |
|----------|--------------------|--------------------|-----------|
| Single user opens app (discover) | 8–12 | 0–3 (cache warm) | ~75% |
| `new-generate-experience-` invocation | 10–15 | 0–5 | ~60–75% |
| Holiday experiences (10 categories) | 10 | 0–3 | ~70–80% |
| Night-out search | 3–5 | 0–1 | ~80% |
| Session experiences (collab) | 5–10 | 0–3 | ~70% |
| Curated route generation | 6–12 | 0–4 | ~65% |
| Places endpoint | 2–3 | 0–1 | ~75% |
| Mobile autocomplete (per session) | 20–50 keystrokes | 5–15 unique | ~60–70% |
| Mobile route calculations | Every tap | Cached for 30min | ~50% |

**Overall projected reduction: 60–75% of Google Places API calls.**

### Success Criteria Verification

| Criterion | Status |
|-----------|--------|
| All 9 edge functions use shared cache | Done |
| Cache TTL is 24 hours | Done |
| Location grid reduces cache fragmentation | Done |
| Radius bucketing prevents near-duplicate entries | Done |
| RLS restricts access to `service_role` | Done |
| Mobile autocomplete cached | Done |
| Mobile routes cached | Done |
| Dead code removed | Done |
| Legacy API migrated | Done |
| No breaking changes to function signatures | Done |
| Fallback to direct API if cache unavailable | Done |

---

## Files Changed (Complete List)

### New Files
- `supabase/migrations/20260301000001_google_places_cache.sql`
- `supabase/functions/_shared/placesCache.ts`

### Modified Files
- `supabase/functions/discover-experiences/index.ts`
- `supabase/functions/new-generate-experience-/index.ts`
- `supabase/functions/holiday-experiences/index.ts`
- `supabase/functions/night-out-experiences/index.ts`
- `supabase/functions/generate-session-experiences/index.ts`
- `supabase/functions/generate-curated-experiences/index.ts`
- `supabase/functions/get-companion-stops/index.ts`
- `supabase/functions/get-picnic-grocery/index.ts`
- `supabase/functions/places/index.ts`
- `app-mobile/src/services/geocodingService.ts`
- `app-mobile/src/services/busynessService.ts`

### Deleted Code
- `holiday-experiences/index.ts`: Removed dead `fetchExperiencesForCategories` function (~140 lines)
- `places/index.ts`: Removed useless in-memory `Map` cache (`placesCache`, `CACHE_TTL_MS`)

---

## Deployment Notes

1. **Run the migration first**: `supabase db push` or apply `20260301000001_google_places_cache.sql` to create the cache table before deploying edge functions.
2. **Environment variables**: All edge functions that use the cache need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set (these are automatically available in Supabase-hosted edge functions).
3. **Monitoring**: Check `google_places_cache` table's `hit_count` column and `result_count` to verify cache effectiveness. Run `SELECT place_type, SUM(hit_count) as total_hits, COUNT(*) as entries FROM google_places_cache GROUP BY place_type ORDER BY total_hits DESC;` to see which place types benefit most.
4. **Cleanup**: Call `SELECT cleanup_expired_places_cache();` periodically (e.g., via pg_cron) or let the expiry index handle it naturally. Expired rows are automatically excluded from reads by the `WHERE expires_at > NOW()` clause.
