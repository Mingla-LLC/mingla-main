# Feature: Card Pool Data Pipeline
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** "efficient data pipeline — query DB first, check if user has seen it, only hit Google Places API when pool is exhausted. Store once, reuse across all users. Daily refresh via free Place Detail by ID."

## Summary

Replace the current "generate everything on demand from Google Places API" architecture with a **shared card pool** model. A centralized Supabase table stores enriched, ready-to-serve experience cards built from Google Places data. When a user requests cards, the system first queries this pool for cards matching their preferences and location, filters out cards the user has already seen in their current preference session, and returns pool hits instantly — with **zero Google API calls**. Only when the pool is exhausted for that user + preference combination does the system fall back to Google Places API. New places fetched from Google are immediately written to the pool for reuse across all users. A daily scheduled job refreshes the pool using **Place Details by ID (Basic) which is free ($0.00)**, keeping opening hours, ratings, and photos current without incurring search costs.

**Two card types are pool-served:**
- **Single cards** — one place per card (from `new-generate-experience-`, `discover-experiences`, `holiday-experiences`, `night-out-experiences`)
- **Curated cards** — three-stop plans (from `generate-curated-experiences`)

## User Story

As a Mingla user, I want to see experience cards instantly when I set my preferences, so that I don't wait 5-10 seconds for Google Places + AI generation every time — and as a developer, I want the system to reuse places across all users so API costs are minimized.

## Architecture Impact

### New files:
- `supabase/migrations/YYYYMMDD_card_pool_pipeline.sql` — pool tables + indexes + RLS
- `supabase/functions/_shared/cardPoolService.ts` — shared query/insert logic for the pool
- `supabase/functions/refresh-place-pool/index.ts` — daily refresh job (free Place Details by ID)

### Modified files:
- `supabase/functions/new-generate-experience-/index.ts` — add pool-first pipeline
- `supabase/functions/discover-experiences/index.ts` — serve from pool + impressions
- `supabase/functions/generate-curated-experiences/index.ts` — serve curated from pool
- `supabase/functions/holiday-experiences/index.ts` — serve from pool
- `supabase/functions/night-out-experiences/index.ts` — serve from pool
- `supabase/functions/generate-session-experiences/index.ts` — serve from pool
- `app-mobile/src/services/experienceGenerationService.ts` — pass user_id consistently
- `app-mobile/src/contexts/RecommendationsContext.tsx` — no structural change (pipeline is server-side)

### New DB tables:
- `place_pool` — shared reservoir of Google Places data
- `card_pool` — pre-built, enriched, ready-to-serve cards (single + curated)
- `user_card_impressions` — tracks which cards each user has been served since last preference change

---

## The Pipeline (Flowchart)

```
User applies preferences + location
            │
            ▼
   ┌─────────────────────┐
   │  Edge Function       │
   │  receives request    │
   └──────────┬──────────┘
              │
              ▼
   ┌─────────────────────────────────────┐
   │ STEP 1: Query card_pool             │
   │  WHERE categories ∩ user.categories │
   │  AND within user's radius           │
   │  AND price fits user's budget       │
   │  AND is_active = true               │
   └──────────┬──────────────────────────┘
              │
              ▼
   ┌─────────────────────────────────────┐
   │ STEP 2: Exclude already-seen cards  │
   │  LEFT JOIN user_card_impressions    │
   │  WHERE user_id = X                 │
   │  AND impression created_at >=       │
   │      user's preferences.updated_at │
   │  → Keep only NULL (unseen) cards    │
   └──────────┬──────────────────────────┘
              │
              ▼
   ┌─────────────────────────────────┐
   │ Enough unseen cards (≥ 20)?     │
   └──────┬──────────────┬──────────┘
          │ YES          │ NO
          ▼              ▼
   ┌───────────┐  ┌──────────────────────────┐
   │ Return    │  │ STEP 3: Identify which    │
   │ pool      │  │ categories need filling   │
   │ cards!    │  │ (gap analysis)            │
   │           │  └──────────┬───────────────┘
   │ 0 API     │             │
   │ calls     │             ▼
   └─────┬─────┘  ┌──────────────────────────┐
         │        │ STEP 4: Call Google       │
         │        │ Places API ONLY for       │
         │        │ missing categories        │
         │        └──────────┬───────────────┘
         │                   │
         │                   ▼
         │        ┌──────────────────────────┐
         │        │ STEP 5: Write new places │
         │        │ to place_pool + build    │
         │        │ cards in card_pool       │
         │        └──────────┬───────────────┘
         │                   │
         ▼                   ▼
   ┌─────────────────────────────────┐
   │ STEP 6: Record impressions       │
   │ in user_card_impressions         │
   │ → Return cards to mobile         │
   └─────────────────────────────────┘
```

## "Seen" Boundary Logic

The user's **preference session** defines the "seen" boundary:

- `preferences.updated_at` is already tracked in the `preferences` table
- A card impression is "stale" (can be re-shown) if `impression.created_at < preferences.updated_at`
- When a user changes ANY preference (categories, budget, travel mode, location), `preferences.updated_at` bumps → all past impressions become stale → full pool is available again
- Within the SAME preference session, "Generate Another 20" keeps excluding previously served cards → user sees unique cards until pool is exhausted

**This means:** If User A and User B are both in NYC with similar preferences, User A's swiping doesn't affect User B's pool. The `user_card_impressions` are per-user. The `place_pool` and `card_pool` are shared.

---

## Database Changes

```sql
-- ============================================================
-- 1. PLACE POOL — Shared reservoir of Google Places data
-- One row per unique Google Place. Shared across ALL users.
-- Refreshed daily via free Place Details by ID (Basic).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.place_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT UNIQUE NOT NULL,
  
  -- Core place data (from Google Places API)
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  types TEXT[] NOT NULL DEFAULT '{}',
  primary_type TEXT,
  rating DOUBLE PRECISION,
  review_count INTEGER DEFAULT 0,
  price_level TEXT,          -- e.g. 'PRICE_LEVEL_MODERATE'
  price_min INTEGER DEFAULT 0,
  price_max INTEGER DEFAULT 0,
  opening_hours JSONB,       -- regularOpeningHours from Google
  photos JSONB DEFAULT '[]', -- array of {name, widthPx, heightPx}
  website TEXT,
  
  -- Raw Google response (for future use / re-processing)
  raw_google_data JSONB,
  
  -- Lifecycle
  fetched_via TEXT DEFAULT 'nearby_search'
    CHECK (fetched_via IN ('nearby_search', 'text_search', 'detail_refresh')),
  first_fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detail_refresh TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_failures INTEGER DEFAULT 0,  -- track consecutive refresh failures
  is_active BOOLEAN DEFAULT true,      -- set false if Google returns NOT_FOUND
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Geo-lookup: bounding box index for radius queries
CREATE INDEX IF NOT EXISTS idx_place_pool_geo
  ON public.place_pool (lat, lng) WHERE is_active = true;

-- Type lookup: find places by category
CREATE INDEX IF NOT EXISTS idx_place_pool_types
  ON public.place_pool USING GIN (types) WHERE is_active = true;

-- Refresh job: find stale places
CREATE INDEX IF NOT EXISTS idx_place_pool_refresh
  ON public.place_pool (last_detail_refresh)
  WHERE is_active = true;

-- google_place_id unique lookup
CREATE INDEX IF NOT EXISTS idx_place_pool_google_id
  ON public.place_pool (google_place_id);

ALTER TABLE public.place_pool ENABLE ROW LEVEL SECURITY;

-- Service role full access (edge functions use service role)
CREATE POLICY "service_role_all_place_pool" ON public.place_pool
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can read (for client-side if needed)
CREATE POLICY "authenticated_read_place_pool" ON public.place_pool
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 2. CARD POOL — Pre-built, enriched, ready-to-serve cards
-- Derived from place_pool. Includes AI descriptions.
-- Two types: 'single' (one place) and 'curated' (three stops).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.card_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_type TEXT NOT NULL DEFAULT 'single'
    CHECK (card_type IN ('single', 'curated')),
  
  -- ── Single card fields ──────────────────────────────────
  place_pool_id UUID REFERENCES public.place_pool(id) ON DELETE CASCADE,
  google_place_id TEXT,       -- denormalized for fast joins
  
  -- ── Curated card fields ─────────────────────────────────
  stop_place_pool_ids UUID[],         -- array of 3 place_pool IDs
  stop_google_place_ids TEXT[],       -- denormalized
  curated_pairing_key TEXT,           -- e.g. 'park+restaurant+bar'
  experience_type TEXT,               -- solo-adventure, first-dates, etc.
  stops JSONB,                        -- full CuratedStop[] data
  tagline TEXT,
  total_price_min INTEGER,
  total_price_max INTEGER,
  estimated_duration_minutes INTEGER,
  
  -- ── Shared card display data (ready to serve) ───────────
  title TEXT NOT NULL,
  category TEXT NOT NULL,             -- primary category for matching
  categories TEXT[] NOT NULL DEFAULT '{}', -- all matching Mingla categories
  description TEXT,                   -- AI-generated
  highlights TEXT[] DEFAULT '{}',     -- AI-generated
  image_url TEXT,
  images TEXT[] DEFAULT '{}',
  address TEXT,
  
  -- ── Matching / filtering criteria ───────────────────────
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  rating DOUBLE PRECISION,
  review_count INTEGER DEFAULT 0,
  price_min INTEGER DEFAULT 0,
  price_max INTEGER DEFAULT 0,
  opening_hours JSONB,
  
  -- ── Scoring ─────────────────────────────────────────────
  base_match_score DOUBLE PRECISION DEFAULT 85,
  popularity_score DOUBLE PRECISION DEFAULT 0, -- rating * log10(review_count)
  
  -- ── Lifecycle ───────────────────────────────────────────
  is_active BOOLEAN DEFAULT true,
  served_count INTEGER DEFAULT 0,     -- how many times served globally
  last_served_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Primary query: find cards by category + location bounding box
CREATE INDEX IF NOT EXISTS idx_card_pool_category_geo
  ON public.card_pool (category, lat, lng)
  WHERE is_active = true;

-- GIN index on categories array for overlap queries
CREATE INDEX IF NOT EXISTS idx_card_pool_categories
  ON public.card_pool USING GIN (categories)
  WHERE is_active = true;

-- Card type filter
CREATE INDEX IF NOT EXISTS idx_card_pool_type
  ON public.card_pool (card_type, experience_type)
  WHERE is_active = true;

-- Popularity sort
CREATE INDEX IF NOT EXISTS idx_card_pool_popularity
  ON public.card_pool (popularity_score DESC)
  WHERE is_active = true;

ALTER TABLE public.card_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_card_pool" ON public.card_pool
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_card_pool" ON public.card_pool
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 3. USER CARD IMPRESSIONS — Tracks which cards a user has seen
-- Keyed per-user. "Seen" resets when preferences.updated_at changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_card_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_pool_id UUID NOT NULL REFERENCES public.card_pool(id) ON DELETE CASCADE,
  impression_type TEXT DEFAULT 'served'
    CHECK (impression_type IN ('served', 'swiped_left', 'swiped_right', 'saved', 'expanded')),
  batch_number INTEGER DEFAULT 0,     -- which "Generate Another 20" batch
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- One impression per user+card per preference session
  -- (duplicate serves in same session are idempotent)
  UNIQUE (user_id, card_pool_id)
);

-- Fast lookup: "which cards has this user seen?"
CREATE INDEX IF NOT EXISTS idx_impressions_user_created
  ON public.user_card_impressions (user_id, created_at DESC);

-- Cleanup: join with preferences.updated_at
CREATE INDEX IF NOT EXISTS idx_impressions_user_card
  ON public.user_card_impressions (user_id, card_pool_id);

ALTER TABLE public.user_card_impressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_impressions" ON public.user_card_impressions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_all_impressions" ON public.user_card_impressions
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- 4. HELPER: Updated_at trigger for new tables
-- ============================================================

CREATE TRIGGER update_place_pool_updated_at
  BEFORE UPDATE ON public.place_pool
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_card_pool_updated_at
  BEFORE UPDATE ON public.card_pool
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5. CLEANUP FUNCTIONS
-- ============================================================

-- Clear stale impressions (older than 30 days — safety net)
CREATE OR REPLACE FUNCTION cleanup_stale_impressions()
RETURNS void AS $$
BEGIN
  DELETE FROM public.user_card_impressions
  WHERE created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deactivate places that haven't been refreshed in 7 days
-- (they likely failed multiple refresh attempts → probably closed)
CREATE OR REPLACE FUNCTION deactivate_stale_places()
RETURNS void AS $$
BEGIN
  UPDATE public.place_pool
  SET is_active = false
  WHERE last_detail_refresh < now() - interval '7 days'
    AND refresh_failures >= 3
    AND is_active = true;
  
  -- Also deactivate cards built from inactive places
  UPDATE public.card_pool
  SET is_active = false
  WHERE place_pool_id IN (
    SELECT id FROM public.place_pool WHERE is_active = false
  ) AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Shared Card Pool Service Spec

**File:** `supabase/functions/_shared/cardPoolService.ts`

This is the core module imported by ALL edge functions. It encapsulates the entire pool-first pipeline.

### Interface

```typescript
interface PoolQueryParams {
  supabaseAdmin: SupabaseClient;
  userId: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  categories: string[];           // Mingla categories (e.g., "Nature", "Casual Eats")
  budgetMin: number;
  budgetMax: number;
  limit: number;                  // how many cards to return (e.g., 20)
  cardType?: 'single' | 'curated';
  experienceType?: string;        // for curated: 'solo-adventure', etc.
  excludeCardIds?: string[];      // additional exclusions
}

interface PoolQueryResult {
  cards: any[];                   // ready-to-serve card objects
  fromPool: number;               // count served from pool
  fromApi: number;                // count freshly generated
  totalPoolSize: number;          // total matching cards in pool (before exclusion)
}

// Main entry point — replaces direct Google API calls
async function serveCardsFromPipeline(
  params: PoolQueryParams,
  googleApiKey: string,
  categoryToPlaceTypes: Record<string, string[]>,
  options?: {
    enrichWithAI?: boolean;       // default true for single, false for curated
    openaiApiKey?: string;
    travelMode?: string;
    travelConstraintType?: string;
    travelConstraintValue?: number;
    datetimePref?: string;
  }
): Promise<PoolQueryResult>;
```

### Logic (Pseudocode)

```
function serveCardsFromPipeline(params, apiKey, categoryMap, options):

  // ── STEP 1: Get user's preference timestamp ──────────────
  prefUpdatedAt = SELECT updated_at FROM preferences WHERE profile_id = userId
  
  // ── STEP 2: Query pool for matching unseen cards ─────────
  latDelta = radiusMeters / 111_320  // ~meters per degree
  lngDelta = radiusMeters / (111_320 * cos(lat * PI / 180))
  
  poolCards = SELECT cp.* FROM card_pool cp
    WHERE cp.is_active = true
    AND cp.card_type = cardType
    AND cp.categories && categories::text[]    // array overlap
    AND cp.lat BETWEEN (lat - latDelta) AND (lat + latDelta)
    AND cp.lng BETWEEN (lng - lngDelta) AND (lng + lngDelta)
    AND cp.price_min >= budgetMin
    AND cp.price_max <= budgetMax
    AND cp.id NOT IN (
      SELECT card_pool_id FROM user_card_impressions
      WHERE user_id = userId
      AND created_at >= prefUpdatedAt           // only exclude post-preference-change
    )
    ORDER BY cp.popularity_score DESC
    LIMIT limit
  
  totalPoolSize = count of matching cards (before impression exclusion)
  
  // ── STEP 3: If pool has enough → serve directly ──────────
  if poolCards.length >= limit:
    recordImpressions(userId, poolCards)
    updateServedCounts(poolCards)
    return { cards: poolCards, fromPool: poolCards.length, fromApi: 0 }
  
  // ── STEP 4: Gap analysis — which categories need filling? ─
  servedCategories = count cards per category in poolCards
  neededCategories = categories where servedCategories[cat] < ceil(limit / categories.length)
  
  // ── STEP 5: Fetch from Google for missing categories ─────
  gapCards = []
  for each category in neededCategories:
    placeTypes = categoryMap[category]
    for representativeType in placeTypes.slice(0, 2):
      // Check if place already in place_pool
      existingPlaces = SELECT * FROM place_pool WHERE primary_type = representativeType
        AND within bounding box AND is_active = true
        AND google_place_id NOT IN (already served place IDs)
      
      if existingPlaces has fresh entries:
        // Build cards from existing pool (no API call)
        gapCards.push(buildCardsFromPlaces(existingPlaces))
        continue
      
      // Actually call Google API
      newPlaces = await callGoogleNearbySearch(representativeType, lat, lng, radius)
      
      // Upsert into place_pool
      for place in newPlaces:
        UPSERT INTO place_pool (google_place_id, name, ...) VALUES (...)
      
      // Build cards with AI enrichment
      enrichedCards = await enrichWithAI(newPlaces)
      
      // Insert into card_pool
      for card in enrichedCards:
        INSERT INTO card_pool (...) VALUES (...)
      
      gapCards.push(enrichedCards)
  
  // ── STEP 6: Combine pool + fresh cards ───────────────────
  allCards = [...poolCards, ...gapCards].slice(0, limit)
  recordImpressions(userId, allCards)
  return { cards: allCards, fromPool: poolCards.length, fromApi: gapCards.length }
```

---

## Daily Refresh Job

**Function:** `supabase/functions/refresh-place-pool/index.ts`  
**Trigger:** pg_cron schedule `0 4 * * *` (4 AM daily) OR invoked manually  

### Logic

```
1. SELECT * FROM place_pool
   WHERE is_active = true
   AND last_detail_refresh < now() - interval '24 hours'
   ORDER BY last_detail_refresh ASC
   LIMIT 500  -- batch to avoid timeout

2. For each place:
   a. Call Google Place Details by ID (Basic):
      GET https://places.googleapis.com/v1/places/{google_place_id}
      X-Goog-FieldMask: id,displayName,formattedAddress,location,types,
                         regularOpeningHours,rating,userRatingCount,
                         priceLevel,photos
      COST: $0.00 (Basic fields are FREE)
   
   b. If response OK:
      UPDATE place_pool SET
        name = response.displayName.text,
        address = response.formattedAddress,
        rating = response.rating,
        review_count = response.userRatingCount,
        opening_hours = response.regularOpeningHours,
        photos = response.photos,
        price_level = response.priceLevel,
        last_detail_refresh = now(),
        refresh_failures = 0
      
      UPDATE card_pool SET
        rating = ..., review_count = ..., opening_hours = ...,
        image_url = (rebuild photo URL), images = (rebuild),
        popularity_score = rating * log(review_count + 1)
      WHERE place_pool_id = place.id
   
   c. If response NOT_FOUND or 404:
      UPDATE place_pool SET
        is_active = false,
        refresh_failures = refresh_failures + 1
      UPDATE card_pool SET is_active = false
        WHERE place_pool_id = place.id
   
   d. If response error (timeout, 500, etc.):
      UPDATE place_pool SET
        refresh_failures = refresh_failures + 1

3. Run deactivate_stale_places() to clean up chronic failures
4. Run cleanup_stale_impressions() to prune old data
```

**Cost impact:** If pool has 5,000 places, daily refresh = 5,000 Place Details (Basic) calls = **$0.00**.

---

## Google Places API (New) — Place Details by ID

The key cost insight:

| API Call | SKU | Cost |
|----------|-----|------|
| Nearby Search (Basic) | `places:searchNearby` | $0.032 per call |
| Text Search (Basic) | `places:searchText` | $0.032 per call |
| **Place Details (Basic)** | `places/{id}` | **$0.000 (FREE)** |
| Place Details (Advanced) | `places/{id}` + advanced fields | $0.025 per call |

**Basic fields (free):** `id`, `displayName`, `formattedAddress`, `location`, `types`, `primaryType`, `regularOpeningHours`, `businessStatus`, `utcOffsetMinutes`

**Essential fields (for Place Details $0.005):** `rating`, `userRatingCount`, `priceLevel`, `photos`, `websiteUri`

So the daily refresh costs **$0.005 per place** at most (if we include rating + photos), or **$0.00** if we only refresh hours/address/types. For 5,000 places: $25/day max for full refresh, $0/day for basic refresh.

**Request format:**
```
GET https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4
Headers:
  X-Goog-Api-Key: YOUR_KEY
  X-Goog-FieldMask: id,displayName,formattedAddress,location,types,
                     regularOpeningHours,rating,userRatingCount,
                     priceLevel,photos
```

---

## Mobile Implementation

### No new mobile components needed!

The pipeline is entirely server-side. The edge function API contract stays the same — it still returns `{ cards: [...], meta: {...} }`. The mobile app doesn't know or care whether cards came from the pool or from Google.

### One minor change: Pass `user_id` consistently

Currently `useRecommendationsQuery` already passes `userId`. Ensure all edge function invocations include it so the impression tracking works.

### React Query — No changes needed

Current settings are already optimal:
- `staleTime: 60 * 60 * 1000` (1 hour) — prevents unnecessary refetches
- `gcTime: 24 * 60 * 60 * 1000` (24 hours) — keeps cache warm
- `refetchOnMount: false` / `refetchOnWindowFocus: false`

The pool-first pipeline makes the edge function **faster** (DB query vs Google API), so perceived performance improves automatically.

---

## Edge Function Changes

### `new-generate-experience-` (Solo cards)

**Before:** `fetchGooglePlaces()` → 15+ API calls → `annotateWithTravel()` → `enrichWithAI()` → return  
**After:** `serveCardsFromPipeline()` → 0-5 API calls (pool-first) → return

### `discover-experiences` (Discover tab)

**Before:** 10 parallel `fetchCandidatesForCategory()` → 10+ API calls → per-user daily cache  
**After:** `serveCardsFromPipeline({ limit: 10, categories: discoverCategories })` → 0 API calls (pool hit) → still writeto `discover_daily_cache` for the per-user card selection

### `generate-curated-experiences` (3-stop plans)

**Before:** `fetchPlacesByCategory()` → 20+ API calls → build pairings → AI descriptions  
**After:**  
1. Query `card_pool WHERE card_type = 'curated' AND experience_type = X` — serve pre-built plans  
2. If not enough: query `place_pool` for the needed place types → build pairings server-side → AI enrichment → store in card_pool  
3. Only call Google if place_pool is empty for needed types

### `holiday-experiences`, `night-out-experiences`

Same pattern: pool-first, fallback to Google, store results.

---

## Impression Recording

When cards are served, the edge function records impressions in a single batch:

```sql
INSERT INTO user_card_impressions (user_id, card_pool_id, batch_number)
SELECT
  $1,              -- user_id
  unnest($2::uuid[]),  -- array of card_pool_ids
  $3               -- current batch number
ON CONFLICT (user_id, card_pool_id) DO NOTHING;
```

This is a single INSERT with array unnest — fast, atomic, O(1) round trips regardless of batch size.

---

## Pool Growth Model

**Initial state:** Pool is empty. First few users in an area trigger Google API calls → pool fills.

**After 1 day in a popular area (e.g., NYC):**
- ~50 categories × 10 places each = ~500 places in pool
- ~500 single cards + ~100 curated cards
- Next user in NYC with ANY preference combo → near-100% pool hit rate

**After 1 week:** Pool covers most major metro areas. Most requests are served with 0 API calls.

**Long tail (rural areas):** First user still triggers API calls, but results are stored for next user. Even 1 prior user pre-fills the pool.

---

## Test Cases

1. **Pool hit (zero API calls):** Seed `place_pool` with 50 places near NYC. Call `new-generate-experience-` for NYC user with matching categories → all cards from pool, 0 Google calls, response < 500ms.

2. **Pool miss → fetch + store:** Call for a location with empty pool → Google API called → places stored → cards stored → second call returns from pool.

3. **Impression exclusion:** Serve 20 cards to user A → call "Generate Another 20" → next 20 cards are different (no overlap). Verify with `SELECT COUNT(*) FROM user_card_impressions WHERE user_id = A`.

4. **Preference change resets impressions:** User A sees 40 cards → changes categories → same pool cards become available again (impressions are stale relative to new `preferences.updated_at`).

5. **Cross-user pool sharing:** User A in Chicago triggers API calls → pool filled. User B in Chicago (different user, similar preferences) → 100% pool hits.

6. **Daily refresh:** Insert place_pool entry with `last_detail_refresh = yesterday`. Run refresh job → verify `last_detail_refresh` updated, rating/hours refreshed, `card_pool` updated.

7. **Deleted place handling:** Mock Google returning NOT_FOUND for a place ID → verify `is_active` set to false on both `place_pool` and `card_pool`, card no longer served.

8. **Curated from pool:** Ensure `card_pool` with `card_type = 'curated'` is served when matching experience type + location exists, without calling Google.

---

## Success Criteria

- [ ] 80%+ of card requests served from pool after first week in production
- [ ] Google Places API Nearby/Text Search calls drop by 70%+ 
- [ ] Average card serving latency drops from ~5s to <1s for pool hits
- [ ] Daily refresh runs successfully using free Place Details by ID
- [ ] Pool size grows organically — new areas fill on first user visit
- [ ] "Generate Another 20" serves unique unseen cards from pool
- [ ] Preference change correctly resets the "seen" boundary
- [ ] No user-visible behavior change (same card quality/variety)
- [ ] `user_card_impressions` table stays clean (<30 day retention)
