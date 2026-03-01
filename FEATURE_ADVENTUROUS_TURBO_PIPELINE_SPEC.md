# Feature: Adventurous Turbo Pipeline — Optimized 20-Card Curated Delivery
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Optimize pool-miss path for Adventurous curated cards — 20 cards in <3s, cost-efficient, with repeatable fresh batches

## Summary

Replaces the current expensive curated card generation pipeline (45 Google API calls, dual-batch loading, sequential combo validation) with a **4-call super-category architecture** that delivers 20 curated 3-stop itinerary cards in under 3 seconds on a cold miss, and under 500ms from pool. Introduces pool pre-warming on app load, over-population for free subsequent batches, and background enrichment for niche place types. Cost reduction: **91% fewer API calls** ($0.16 vs $1.80 per cold miss).

## User Story

As a Mingla user, I want to tap "Adventurous" and immediately see 20 diverse multi-stop itinerary cards I can swipe through, then generate a fresh batch of 20 different cards — all within 3 seconds, without the app burning through my budget in API costs.

## Problem Analysis: Why The Current Pipeline Is Slow & Expensive

### Current Architecture (generate-curated-experiences, solo-adventure path)

```
fetchPlacesByCategory() — 9 categories, each:
  → shuffle(allTypes).slice(0, 5) → 5 random place types
  → Each place type: 1 API call (searchNearby/searchByText, maxResults: 5)
  → 9 × 5 = 45 API CALLS per cold miss
  → Each at Google Preferred tier = $0.040/call
  → Total: $1.80 per cold miss

Then: 84 category combinations shuffled, tried 6 at a time
  → Sequential combo validation (budget, hours, travel, dedup)
  → Cards built one batch at a time
  → Typical: 60-84 combos attempted to yield 20 cards

Mobile: dual-batch loading
  → Priority batch (limit=2): 1 edge function invocation
  → Background batch (limit=20): 1 edge function invocation
  → 2 invocations = potentially 2× the API cost on cold miss
```

### Bottleneck Breakdown (cold miss timing)

| Step | Current Time | Notes |
|------|-------------|-------|
| Pool check (empty) | 100ms | Fast |
| 45 API calls (parallel-ish) | 1.5-3s | Each returns 5 results, serialized within categories |
| Combo validation (84 combos) | 500ms-1s | Sequential batches of 6 |
| Card building | 200ms | |
| Pool storage (fire-forget) | 0ms | |
| **Total** | **2.3-4.3s** | **Often exceeds 3s target** |

### Cost Per Cold Miss

| Item | Current | Proposed |
|------|---------|----------|
| Google Nearby Search calls | 45 × $0.040 = $1.80 | 4 × $0.040 = $0.16 |
| Google Text Search calls | 0-15 × $0.040 = $0-0.60 | 0 (foreground), 2-3 background |
| Edge function invocations | 2 (priority + background) | 1 (single-shot) |
| **Total API cost** | **$1.80-$2.40** | **$0.16** |
| **Savings** | — | **91-93%** |

---

## Architecture: 5 Innovations

### Innovation 1: Super-Category API Batching (45 → 4 calls)

**Key insight:** Google Nearby Search `includedTypes` accepts an array. Instead of 1 call per individual place type, combine related types into a single call with `maxResultCount: 20`.

```
CURRENT: 45 calls × 5 results each = 225 raw results → filtered to 180
PROPOSED: 4 calls × 20 results each = 80 raw results → all usable
```

**Four super-categories for Adventurous:**

```typescript
const ADVENTURE_SUPER_CATEGORIES = {
  'outdoor-nature': {
    includedTypes: [
      'park', 'botanical_garden', 'hiking_area', 'beach',
      'zoo', 'national_park', 'state_park',
    ],
    maxResultCount: 20,
  },
  'food-dining': {
    includedTypes: [
      'restaurant', 'cafe', 'bakery', 'ice_cream_shop',
      'pizza_restaurant', 'ramen_restaurant', 'seafood_restaurant',
      'brunch_restaurant',
    ],
    maxResultCount: 20,
  },
  'drink-social': {
    includedTypes: [
      'bar', 'wine_bar', 'pub', 'coffee_shop',
      'tea_house', 'night_club',
    ],
    maxResultCount: 20,
  },
  'culture-active': {
    includedTypes: [
      'art_gallery', 'museum', 'movie_theater', 'bowling_alley',
      'amusement_park', 'spa', 'performing_arts_theater',
    ],
    maxResultCount: 20,
  },
};
```

**How it works:**
1. Fire 4 Nearby Search calls in parallel (Promise.all)
2. Each returns up to 20 places matching ANY of the included types
3. Classify each place into its fine-grained sub-category using `primaryType`
4. Total: 80 diverse places across 4 broad categories
5. Latency: ~200-400ms (parallel, single round-trip each)

### Innovation 2: Pool Pre-Warming (0 API calls on user tap)

**Trigger points:**
- App load (when location + preferences available)
- After preference change (impressions reset, pool needs refresh)
- After "Generate Another 20" (pre-warm for the NEXT batch)

**Flow:**
```
App loads → location acquired → preferences loaded
  → Fire background warmPool() call (fire-and-forget)
  → Edge function checks pool size for user's geo+budget
  → If pool < 40 curated cards: run 4-call pipeline, build 40+ triads, store
  → Pool is hot before user taps "Adventurous"
```

**Mobile implementation:**
```typescript
// In RecommendationsContext — fire once on load
useEffect(() => {
  if (location && userPrefs && !warmPoolFired.current) {
    warmPoolFired.current = true;
    curatedExperiencesService.warmPool({
      experienceType: 'solo-adventure',
      location,
      budgetMax: userPrefs.budget_max,
      travelMode: userPrefs.travel_mode,
      travelConstraintType: userPrefs.travel_constraint_type,
      travelConstraintValue: userPrefs.travel_constraint_value,
    }).catch(() => {}); // Fire and forget
  }
}, [location, userPrefs]);
```

**Edge function warm-pool mode:**
- New parameter: `warmPool: boolean` (default false)
- If true: check pool size → if sufficient, return immediately → else run pipeline, store results, return
- Does NOT record impressions (cards are pre-built but not yet "served")
- Response: `{ success: true, poolSize: number }`

### Innovation 3: Single-Shot 20-Card Delivery (eliminate dual-batch)

**Current:** 2 edge function invocations (priority batch limit=2, background batch limit=20)
**Proposed:** 1 invocation (limit=20)

**Why this works:**
- With pre-warming, the pool is hot 90%+ of the time → cards return in <500ms
- On rare cold miss (first-time user, new area): 4 parallel API calls return in 1-2s
- Users see a brief loading animation, then ALL 20 cards appear at once
- No "3-card bug" complexity (no dual-batch merge, no isFullBatchLoaded race conditions)

**UX flow:**
1. User taps "Adventurous"
2. **Pool warm:** Cards appear in <500ms (instant feel)
3. **Pool cold:** Loading animation (1.5-2.5s), then all 20 cards

**Mobile hook simplification:**
```typescript
// BEFORE: 2 React Query hooks (priority + background) with complex merge logic
// AFTER: 1 React Query hook
export function useCuratedExperiences(params) {
  return useQuery({
    queryKey: ['curated-experiences', params.experienceType, ...],
    queryFn: () => curatedExperiencesService.generateCuratedExperiences({
      ...params,
      limit: 20,
      skipDescriptions: true,
    }),
    staleTime: 30 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    enabled: params.enabled && params.location !== null,
  });
}
```

### Innovation 4: Over-Population (free batch 2)

**On first cold miss, build 40+ triads instead of 20.**

With 80 places from 4 super-categories and cross-triad stop reuse allowed:
- C(4,3) = 4 super-category triad patterns
- Each pattern: thousands of valid combinations
- Build 40+ triads, store ALL in card_pool
- Serve top 20 (by popularity_score), record impressions for those 20
- Remaining 20+ sit in pool, unseen

**Batch 2: instant from pool**
```
User taps "Generate Another 20"
  → batchSeed incremented → new query
  → Pool query: 20+ unseen curated cards exist
  → Return instantly (<500ms)
  → 0 API calls
```

**Batch 3+: radius expansion**
```
Pool depleted for original radius
  → Expand search radius by 1.5x
  → Re-run 4-call pipeline with wider radius
  → New places = new triads
  → Or: trigger background warm with expanded radius after batch 2 served
```

### Innovation 5: Background Niche Enrichment

After serving the initial 20 cards, fire background Text Search calls for niche places:
- "escape room near [location]"
- "pottery class near [location]"
- "karaoke bar near [location]"
- "comedy club near [location]"

These add creative/workshop/entertainment places to the pool. Future batches draw from a richer pool with more diverse stop types.

**Cost:** 3-4 Text Search calls × $0.040 = $0.12-0.16 (async, doesn't block user)

---

## Data Flow Diagram

### Pool Warm Path (90%+ of requests)

```
User taps "Adventurous"
  → useCuratedExperiences hook (single query, limit=20)
  → curatedExperiencesService.generateCuratedExperiences()
  → Edge function: generate-curated-experiences
    → serveCuratedCardsFromPool()
      → card_pool query (anti-join with impressions)
      → 20+ unseen cards found
      → Return immediately
    → recordImpressions() [fire-and-forget]
  → Response: 20 cards in <500ms
  → React Query cache (staleTime: 30min)
  → SwipeableCards renders all 20
```

### Pool Cold Path (rare: new area or first user)

```
User taps "Adventurous"
  → useCuratedExperiences hook (single query, limit=20)
  → Edge function: generate-curated-experiences
    → serveCuratedCardsFromPool() → <20 cards
    → TURBO PIPELINE:
      1. Fire 4 Nearby Search calls in parallel [200-400ms]
         → outdoor-nature: 20 places
         → food-dining: 20 places
         → drink-social: 20 places
         → culture-active: 20 places
      2. Classify each place by primaryType [10ms]
      3. Generate 40+ triads with budget/travel validation [100ms]
         → Global dedup within batch
         → Shuffle for variety
      4. Store ALL 40+ triads in card_pool [fire-and-forget]
      5. Record impressions for served 20 [fire-and-forget]
      6. Return top 20 cards
    → BACKGROUND ENRICHMENT [fire-and-forget]:
      → 3-4 Text Search calls for niche types
      → Build additional triads
      → Store in pool
  → Response: 20 cards in 1.5-2.5s
```

### Pre-Warm Path (app load)

```
App loads → location + preferences ready
  → warmPool() [fire-and-forget, no loading state]
  → Edge function (warmPool=true):
    → Count pool cards for user's geo+budget
    → If >= 40: return immediately (pool hot)
    → If < 40: run TURBO PIPELINE, store 40+ triads
  → Pool is hot for when user taps "Adventurous"
```

### Next Batch Path

```
User taps "Generate Another 20"
  → batchSeed++ → new React Query key → refetch
  → Edge function:
    → Pool query with updated impressions
    → 20+ unseen cards in pool (from over-population)
    → Return instantly
  → AFTER SERVE: trigger warmPool for batch 3 [background]
```

---

## Latency Analysis

### Foreground (User-Visible)

| Scenario | Current | Proposed | How |
|----------|---------|----------|-----|
| Pool hit (hot) | ~1s (priority batch) | **<500ms** | Single pool query, no dual-batch |
| Pool cold (first user) | 2.3-4.3s | **1.5-2.5s** | 4 parallel calls vs 45 |
| Batch 2 | ~1s (if pool) / 2-4s (if miss) | **<500ms** | Over-populated pool |
| Batch 3+ | Same as batch 2 | **<500ms / 1.5-2.5s** | Pre-warm triggered after batch 2 |

### Background (Invisible)

| Task | Time | Blocking? |
|------|------|-----------|
| Pool storage (40+ cards) | 500ms-1s | No |
| Impression recording | 100ms | No |
| Niche enrichment (3-4 Text calls) | 1-2s | No |
| Pre-warm for next batch | 2-3s | No |

---

## Edge Function Changes

### File: `supabase/functions/generate-curated-experiences/index.ts`

**New constant: ADVENTURE_SUPER_CATEGORIES** (replaces per-type fetching for solo-adventure)

```typescript
const ADVENTURE_SUPER_CATEGORIES: Record<string, {
  includedTypes: string[];
  label: string; // For sub-category tagging
}> = {
  'outdoor-nature': {
    includedTypes: ['park', 'botanical_garden', 'hiking_area', 'beach', 'zoo', 'national_park', 'state_park'],
    label: 'outdoor-nature',
  },
  'food-dining': {
    includedTypes: ['restaurant', 'cafe', 'bakery', 'ice_cream_shop', 'pizza_restaurant', 'ramen_restaurant', 'seafood_restaurant', 'brunch_restaurant'],
    label: 'food-restaurants',
  },
  'drink-social': {
    includedTypes: ['bar', 'wine_bar', 'pub', 'coffee_shop', 'tea_house', 'night_club'],
    label: 'cafes-bars-casual',
  },
  'culture-active': {
    includedTypes: ['art_gallery', 'museum', 'movie_theater', 'bowling_alley', 'amusement_park', 'spa', 'performing_arts_theater'],
    label: 'arts-culture',
  },
};
```

**New function: `fetchPlacesBySuperCategory()`** (replaces `fetchPlacesByCategory()` for solo-adventure)

```typescript
async function fetchPlacesBySuperCategory(
  lat: number, lng: number, radiusMeters: number
): Promise<Record<string, any[]>> {
  const results: Record<string, any[]> = {};

  await Promise.all(
    Object.entries(ADVENTURE_SUPER_CATEGORIES).map(async ([superCat, config]) => {
      const response = await fetch(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': PLACES_FIELD_MASK,
          },
          body: JSON.stringify({
            includedTypes: config.includedTypes,
            maxResultCount: 20,
            locationRestriction: {
              circle: {
                center: { latitude: lat, longitude: lng },
                radius: Math.min(radiusMeters, 50000),
              },
            },
            rankPreference: 'POPULARITY',
          }),
        }
      );
      const data = await response.json();
      results[superCat] = (data.places || []).map((p: any) => ({
        ...p,
        placeType: p.primaryType || config.includedTypes[0],
        superCategory: superCat,
      }));
    })
  );

  return results;
}
```

**New function: `buildTriadsFromSuperCategories()`**

```typescript
function buildTriadsFromSuperCategories(
  superCategoryPlaces: Record<string, any[]>,
  limit: number,
  budgetMax: number,
  travelMode: string,
  userLat: number,
  userLng: number,
  travelConstraintType: string,
  travelConstraintValue: number,
  targetDatetime: Date,
): any[] {
  const superCatNames = Object.keys(superCategoryPlaces);
  const triads: any[] = [];
  const usedPlaceIds = new Set<string>();

  // Generate all C(n,3) super-category triad patterns
  const patterns: [string, string, string][] = [];
  for (let i = 0; i < superCatNames.length; i++)
    for (let j = i + 1; j < superCatNames.length; j++)
      for (let k = j + 1; k < superCatNames.length; k++)
        patterns.push([superCatNames[i], superCatNames[j], superCatNames[k]]);

  // Shuffle patterns for variety
  const shuffledPatterns = shuffle(patterns);

  // Round-robin through patterns, building triads until we hit limit
  let patternIdx = 0;
  let attempts = 0;
  const MAX_ATTEMPTS = limit * 5;

  while (triads.length < limit && attempts < MAX_ATTEMPTS) {
    const [cat1, cat2, cat3] = shuffledPatterns[patternIdx % shuffledPatterns.length];
    patternIdx++;
    attempts++;

    const perStopBudget = budgetMax > 0 ? Math.ceil(budgetMax / 3) : Infinity;
    const isUsable = (p: any) =>
      !usedPlaceIds.has(p.id) &&
      priceLevelToRange(p.priceLevel).min <= perStopBudget;

    const pool1 = superCategoryPlaces[cat1].filter(isUsable);
    const pool2 = superCategoryPlaces[cat2].filter(isUsable);
    const pool3 = superCategoryPlaces[cat3].filter(isUsable);

    if (!pool1.length || !pool2.length || !pool3.length) continue;

    // Pick random place from each
    const p1 = pool1[Math.floor(Math.random() * pool1.length)];
    const p2 = pool2[Math.floor(Math.random() * pool2.length)];
    const p3 = pool3[Math.floor(Math.random() * pool3.length)];

    // Quick travel constraint check (Haversine, no API call)
    const d1 = haversineKm(userLat, userLng, p1.location.latitude, p1.location.longitude);
    const maxDistKm = travelConstraintType === 'time'
      ? (travelConstraintValue / 60) * TRAVEL_SPEEDS[travelMode]
      : travelConstraintValue;
    if (d1 > maxDistKm) continue;

    // Build card
    usedPlaceIds.add(p1.id);
    usedPlaceIds.add(p2.id);
    usedPlaceIds.add(p3.id);

    triads.push(buildCuratedCard([p1, p2, p3], ...));
  }

  return triads;
}
```

**Modified: solo-adventure main block** — Replace the 84-combo loop with:

```typescript
if (experienceType === 'solo-adventure') {
  // TURBO PIPELINE: 4 super-category calls instead of 45 individual calls
  const superCategoryPlaces = await fetchPlacesBySuperCategory(
    location.lat, location.lng, clampedRadius
  );

  // Build 40+ triads (over-populate for free batch 2)
  const buildLimit = Math.max(limit, 40);
  const allTriads = buildTriadsFromSuperCategories(
    superCategoryPlaces, buildLimit, budgetMax, travelMode,
    location.lat, location.lng,
    travelConstraintType, travelConstraintValue, targetDatetime,
  );

  // Store ALL triads in pool (fire-and-forget)
  storeTriadsInPool(allTriads, ...);

  // Serve requested limit
  const cards = allTriads.slice(0, limit);

  // Background: fire niche enrichment for future batches
  enrichPoolWithNicheTypes(location.lat, location.lng, clampedRadius);

  return cards;
}
```

**New: warmPool parameter support**

```typescript
// At the top of the serve handler, after parsing body:
if (warmPool) {
  const poolCount = await countCuratedPoolCards(
    poolAdmin, poolUserId, experienceType,
    location.lat, location.lng, clampedRadius, budgetMax
  );
  if (poolCount >= 40) {
    return new Response(JSON.stringify({
      success: true, message: 'Pool already warm', poolSize: poolCount
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  // Else: fall through to normal pipeline (which now over-populates)
}
```

---

## Mobile Implementation

### Modified Hook: `useCuratedExperiences.ts`

**Before (complex dual-batch):**
- 2 React Query hooks with priority/background merge
- bestCardsRef regression prevention
- isFullBatchLoaded race condition handling
- ~170 lines

**After (single-shot):**
```typescript
export function useCuratedExperiences(params: UseCuratedExperiencesParams) {
  const query = useQuery<CuratedExperienceCard[]>({
    queryKey: [
      'curated-experiences',
      params.experienceType,
      params.location?.lat,
      params.location?.lng,
      params.budgetMax,
      params.travelMode,
      params.travelConstraintType,
      params.travelConstraintValue,
      params.batchSeed,
    ],
    queryFn: () =>
      curatedExperiencesService.generateCuratedExperiences({
        experienceType: params.experienceType,
        location: params.location!,
        budgetMin: params.budgetMin,
        budgetMax: params.budgetMax,
        travelMode: params.travelMode,
        travelConstraintType: params.travelConstraintType,
        travelConstraintValue: params.travelConstraintValue,
        datetimePref: params.datetimePref,
        limit: 20,
        skipDescriptions: true,
        sessionId: params.sessionId,
      }),
    staleTime: 30 * 60 * 1000,    // 30 minutes
    gcTime: 2 * 60 * 60 * 1000,   // 2 hours
    enabled: params.enabled && params.location !== null,
    retry: 2,
  });

  return {
    cards: query.data ?? [],
    isLoading: query.isLoading,
    isFullBatchLoaded: !query.isLoading && !query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
```

~40 lines. Eliminates dual-batch merge, bestCardsRef, and isFullBatchLoaded race conditions.

### New Service Method: `warmPool()`

```typescript
// In curatedExperiencesService.ts
async warmPool(params: {
  experienceType: string;
  location: { lat: number; lng: number };
  budgetMax: number;
  travelMode: string;
  travelConstraintType: string;
  travelConstraintValue: number;
}): Promise<void> {
  await supabase.functions.invoke('generate-curated-experiences', {
    body: { ...params, warmPool: true, limit: 40 },
  });
}
```

### Modified Context: `RecommendationsContext.tsx`

**Add pre-warming effect:**
```typescript
const warmPoolFired = useRef(false);

useEffect(() => {
  if (userLocation && userPrefs && !warmPoolFired.current) {
    warmPoolFired.current = true;
    curatedExperiencesService.warmPool({
      experienceType: 'solo-adventure',
      location: userLocation,
      budgetMax: userPrefs.budget_max ?? 1000,
      travelMode: userPrefs.travel_mode ?? 'walking',
      travelConstraintType: userPrefs.travel_constraint_type ?? 'time',
      travelConstraintValue: userPrefs.travel_constraint_value ?? 30,
    }).catch(() => {});
  }
}, [userLocation, userPrefs]);
```

**Simplify batch loading states:**
- Remove `isSoloBatchLoaded` complexity
- Single `isLoading` from hook gates spinner
- Remove dual-batch merge timing workarounds

### After-Batch Pre-Warm (for batch 3+)

In `generateNextBatch()`:
```typescript
function generateNextBatch() {
  // Save current batch for review
  previousBatchRef.current = [...recommendations];
  // Increment seed
  setBatchSeed(prev => prev + 1);
  // Pre-warm for the NEXT next batch (fire-and-forget)
  curatedExperiencesService.warmPool({
    experienceType: 'solo-adventure',
    location: userLocation,
    budgetMax: userPrefs.budget_max ?? 1000,
    travelMode: userPrefs.travel_mode ?? 'walking',
    travelConstraintType: userPrefs.travel_constraint_type ?? 'time',
    travelConstraintValue: userPrefs.travel_constraint_value ?? 30,
  }).catch(() => {});
}
```

---

## Database Changes

**No new tables required.** Existing `card_pool`, `place_pool`, and `user_card_impressions` tables are sufficient.

### Optional: Optimized Pool Query RPC Function

The current 2-query approach (fetch pool cards + fetch impressions, then JS filter) works but can be replaced with a single SQL anti-join for better performance at scale:

```sql
-- Optional: RPC function for optimized pool query
CREATE OR REPLACE FUNCTION serve_curated_from_pool(
  p_user_id UUID,
  p_experience_type TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_meters DOUBLE PRECISION,
  p_budget_max INTEGER,
  p_pref_updated_at TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 20
)
RETURNS SETOF card_pool
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_lat_delta DOUBLE PRECISION := p_radius_meters / 111320.0;
  v_lng_delta DOUBLE PRECISION := p_radius_meters / (111320.0 * cos(radians(p_lat)));
BEGIN
  RETURN QUERY
  SELECT cp.*
  FROM card_pool cp
  WHERE cp.is_active = true
    AND cp.card_type = 'curated'
    AND cp.experience_type = p_experience_type
    AND cp.lat BETWEEN p_lat - v_lat_delta AND p_lat + v_lat_delta
    AND cp.lng BETWEEN p_lng - v_lng_delta AND p_lng + v_lng_delta
    AND cp.total_price_max <= p_budget_max
    AND NOT EXISTS (
      SELECT 1 FROM user_card_impressions uci
      WHERE uci.card_pool_id = cp.id
        AND uci.user_id = p_user_id
        AND uci.created_at >= p_pref_updated_at
    )
  ORDER BY cp.popularity_score DESC
  LIMIT p_limit;
END;
$$;
```

### New Index (Recommended)

```sql
-- Composite index for curated pool queries (if not already covered)
CREATE INDEX IF NOT EXISTS idx_card_pool_curated_geo
  ON card_pool (experience_type, is_active, lat, lng, total_price_max)
  WHERE card_type = 'curated';
```

---

## Architecture Impact Summary

### New Files
- None (all changes modify existing files)

### Modified Files
| File | Changes |
|------|---------|
| `supabase/functions/generate-curated-experiences/index.ts` | Add ADVENTURE_SUPER_CATEGORIES, fetchPlacesBySuperCategory(), buildTriadsFromSuperCategories(), warmPool support, over-population logic |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | Replace dual-batch with single-shot query (~170 → ~40 lines) |
| `app-mobile/src/services/curatedExperiencesService.ts` | Add warmPool() method |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Add pre-warming effect, simplify batch loading states |

### No New DB Tables/Columns
Existing schema is sufficient. Optional RPC function and index for performance.

### External APIs
- Google Places Nearby Search (existing, but 91% fewer calls)
- Google Places Text Search (existing, moved to background only)
- OpenAI (unchanged — already skipped via skipDescriptions)

---

## Test Cases

1. **Pool warm, 20+ cards available:** User taps Adventurous → 20 cards appear in <500ms → all swipeable → end-of-deck shows "Generate Another 20"

2. **Pool cold, first user in area:** User taps Adventurous → loading animation → 20 cards appear in <3s → verify exactly 4 Google API calls in edge function logs → 40+ cards stored in pool

3. **Batch 2 from over-populated pool:** After swiping 20 cards → tap "Generate Another 20" → 20 NEW cards appear in <500ms → 0 Google API calls → no cards repeat from batch 1

4. **Pre-warming on app load:** Open app → check edge function logs → warmPool request fired → pool populated → tap Adventurous → instant cards (no loading animation)

5. **Batch 3+ with radius expansion:** Swipe 40 cards (batch 1 + 2) → tap "Generate Another 20" → verify new batch appears (may take 1-2s if pool depleted and new API calls needed with wider radius)

6. **Budget filtering:** Set budget to $25 → cards returned should have totalPriceMax ≤ $25 → no expensive stops leak through

7. **Travel constraint:** Set walking 15 min → first stop of every card within ~1.5km straight-line distance

8. **Sparse area:** Test with rural location → fewer than 80 places returned → gracefully returns fewer triads (e.g., 8-15) → no error

9. **Review previous batch:** Swipe 20 → tap "Generate Another 20" → tap "Review Previous Batch" → original 20 cards reappear

10. **Preference change resets pool:** Change budget from $100 to $25 → impressions reset → new cards generated matching new budget

---

## Success Criteria

- [ ] 20 cards delivered per batch for Adventurous type
- [ ] Cold miss response time under 3 seconds (measured at edge function)
- [ ] Pool warm response time under 500ms
- [ ] Maximum 4 Google Nearby Search API calls on cold miss (down from 45)
- [ ] Batch 2 served from pool with 0 API calls
- [ ] Pre-warming fires on app load without blocking UI
- [ ] No card repetition within a batch (unique stops per triad)
- [ ] No card repetition across batches (impression tracking)
- [ ] "Review Previous Batch" still works
- [ ] "Generate Another 20" still works
- [ ] All existing tests pass
- [ ] Dual-batch complexity removed from useCuratedExperiences hook
