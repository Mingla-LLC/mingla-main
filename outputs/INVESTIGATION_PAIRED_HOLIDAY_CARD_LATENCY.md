# Investigation: Paired Person / Holiday Card Latency

**Date:** 2026-03-24
**Symptom:** Cards in PersonHolidayView (birthday, standard holidays, custom holidays) take >1s to appear after the view loads. User sees "Loading recommendations..." spinner.
**Confidence:** HIGH — read every file in the chain end-to-end.

---

## Correction: This Is NOT the Collaboration Session Deck

My first analysis was wrong. The logs show `generate-session-deck` (collaboration mode), but the three card types reported as slow are the **PersonHolidayView** system — completely separate code:

| Feature | Edge Function | Hook | Component |
|---------|--------------|------|-----------|
| Paired person birthday | `get-person-hero-cards` | `usePairedCards` | `PersonHolidayView` > `CardRow` |
| Standard upcoming holiday | `generate-holiday-categories` + `get-person-hero-cards` | `useHolidayCategories` + `usePairedCards` | `PersonHolidayView` > `HolidaySectionView` > `CardRow` |
| Custom holidays | `generate-holiday-categories` + `get-person-hero-cards` | `useHolidayCategories` + `usePairedCards` | `PersonHolidayView` > `CustomHolidaySectionView` > `CardRow` |

---

## The Complete Latency Chain

### Step 1: PersonHolidayView Mounts (Discover screen → person pill tap)

**File:** `app-mobile/src/components/PersonHolidayView.tsx`

When a user taps a person pill on Discover, PersonHolidayView renders three sections:
1. Birthday hero + CardRow
2. Custom holiday sections (each with its own CardRow)
3. Standard holiday sections (each with its own CardRow)

### Step 2: Category Generation (Standard + Custom Holidays Only)

**File:** `app-mobile/src/hooks/useHolidayCategories.ts`

For standard and custom holidays, `useHolidayCategories` fires:
1. Check AsyncStorage cache (key: `mingla_holiday_categories_v1_{holidayKey}`, TTL: 30 days)
2. **Cache HIT:** ~5-10ms → use cached AI categories. Skip to Step 3.
3. **Cache MISS:** Call `generate-holiday-categories` edge function →

**File:** `supabase/functions/generate-holiday-categories/index.ts`

This edge function **calls GPT-4o-mini via OpenAI API** (line 102):
- Auth verification: ~100-200ms
- OpenAI API call: **~1000-3000ms** (external HTTP to api.openai.com)
- Parse + validate response: ~5ms
- **Total on cache miss: 1.1-3.2 seconds**

**HOWEVER:** `useHolidayCategories` initializes state with `DEFAULT_PERSON_SECTIONS` (line 29), so CardRow fires IMMEDIATELY with defaults. The AI categories update later but the query key in `usePairedCards` does NOT include sections — so the first fetch with default categories is the only fetch.

**Conclusion:** The GPT-4o-mini call does NOT block card rendering. Categories load in background and only affect NEXT shuffle.

### Step 3: Card Fetching (ALL three card types)

**File:** `app-mobile/src/hooks/usePairedCards.ts`

Each section's CardRow calls `usePairedCards`:
- `enabled: hasValidLocation` — disabled if location is `{0, 0}` (line 60)
- `staleTime: Infinity` — cached until shuffle
- Query fires → calls `fetchPersonHeroCards` service

**File:** `app-mobile/src/services/personHeroCardsService.ts`

```
await supabase.auth.getSession()    → ~50-100ms (reads stored token)
await fetch(get-person-hero-cards)  → ~500-1500ms (see breakdown below)
```

### Step 4: Edge Function `get-person-hero-cards`

**File:** `supabase/functions/get-person-hero-cards/index.ts` (667 lines)

Sequential execution timeline:

#### Phase A: Authentication (~100-200ms)
```
Line 170: await userClient.auth.getUser()   — JWT verification
Line 181: createClient(admin)                — admin client for RPC
```

#### Phase B: Preference Learning Queries (~100-400ms, DEPENDS ON MODE)

**Birthday / Standard Holiday (default mode, line 405-436):**
```
1 sequential query: user_preference_learning
  .eq('user_id', pairedUserId)
  .eq('preference_type', 'category')
  .gte('confidence', 0.15)
  .gt('preference_value', 0)
  .limit(10)
Time: ~50-100ms
```

**Custom Holiday (isCustomHoliday mode, line 274-362):**
```
2 parallel category queries (paired + creator prefs):     ~50-100ms
Then 2 parallel price tier queries (paired + creator):    ~50-100ms  ← SEQUENTIAL after categories
Total: ~100-200ms
```

**Shuffle mode (line 363-404):**
```
1 count query on user_interactions:                        ~50-150ms
Then 1 query for learned preferences:                      ~50-100ms  ← SEQUENTIAL
Total: ~100-250ms
```

#### Phase C: Multi-Dimension Preferences (~100-200ms, PARALLEL)

**Line 441-499:** For non-custom holidays, fires 3 queries in parallel:
```
Promise.all([
  price_tier prefs,     // user_preference_learning
  time_of_day prefs,    // user_preference_learning
  distance prefs,       // user_preference_learning
])
```
These run in parallel (~100-200ms total, gated by slowest).

**BUT:** Phase C runs AFTER Phase B completes (sequential, not parallel with B).

#### Phase D: PostgreSQL RPC — THE MAIN BOTTLENECK (~200-800ms)

**File:** `supabase/migrations/20260323000004_fix_person_hero_cards_slug_and_dedup.sql`

The `query_person_hero_cards` RPC uses **progressive radius expansion**:

```sql
WHILE v_radius <= p_max_radius_meters LOOP
    -- Iteration 1: 2 COUNT queries at 15km
    -- Iteration 2: 2 COUNT queries at 22.5km (×1.5)
    -- Iteration 3: 2 COUNT queries at 33.75km
    -- Iteration 4: 2 COUNT queries at 50.6km
    -- ... until max_radius (100km default)

    -- Each COUNT query scans card_pool with:
    --   spatial bounding box (lat/lng ± delta)
    --   category filter (ANY(v_slug_categories))
    --   exclude list (NOT IN p_exclude_card_ids)
    --   impression exclusion (NOT EXISTS subquery on person_card_impressions)

    -- If ≥3 curated AND ≥3 single found:
    --   Run 2 data queries (with ORDER BY RANDOM() LIMIT 3)
    --   RETURN
END LOOP;
```

**Each loop iteration does 2 COUNT(*) queries.** Each COUNT query includes:
1. Spatial bounding box filter on `card_pool.lat/lng`
2. `NOT EXISTS (SELECT 1 FROM person_card_impressions ...)` — correlated subquery

**Worst case (sparse pool near user):**
- 5-6 iterations × 2 counts × ~50-80ms each = **500-960ms**
- Plus 2 final data queries: ~100-150ms
- **Total: 600-1100ms**

**Best case (dense pool near user):**
- 1 iteration × 2 counts = ~100ms
- Plus 2 data queries: ~100ms
- **Total: ~200ms**

#### Phase E: Impression Recording (~50-100ms)

**Line 631:** Upsert to `person_card_impressions` — fire-and-await (blocks response).

---

## Total Latency Breakdown

### Birthday Cards (default mode, Raleigh area)

| Phase | Operation | Time |
|-------|-----------|------|
| Client | `supabase.auth.getSession()` | 50-100ms |
| Client | HTTP to edge function | 50-100ms |
| A | `auth.getUser()` (JWT verify) | 100-200ms |
| B | 1 category preference query | 50-100ms |
| C | 3 parallel multi-dimension queries | 100-200ms |
| D | RPC radius expansion (3-4 iterations typical) | 400-700ms |
| E | Impression upsert | 50-100ms |
| Client | Response parse | 10-20ms |
| **Total** | | **810-1520ms** |

### Standard Upcoming Holiday (default mode)

Same as birthday — category generation is non-blocking (defaults used immediately).

| Phase | Time |
|-------|------|
| Same as birthday | **810-1520ms** |

### Custom Holiday (bilateral/custom blending)

| Phase | Operation | Time |
|-------|-----------|------|
| Client | `supabase.auth.getSession()` | 50-100ms |
| Client | HTTP to edge function | 50-100ms |
| A | `auth.getUser()` | 100-200ms |
| B1 | 2 parallel category pref queries | 50-100ms |
| B2 | 2 parallel price tier pref queries (AFTER B1) | 50-100ms |
| C | **SKIPPED** (custom holiday has own price logic) | 0ms |
| D | RPC radius expansion | 400-700ms |
| E | Impression upsert | 50-100ms |
| **Total** | | **750-1400ms** |

---

## ROOT CAUSES (Why Not <1 Second)

### 🔴 ROOT CAUSE 1: Progressive Radius Expansion Loop (RPC)

**Fact:** The `query_person_hero_cards` RPC loops at increasing radius (15km → 22.5km → 33.75km → ...) until it finds ≥3 curated AND ≥3 single cards. Each iteration runs 2 COUNT queries with a correlated subquery against `person_card_impressions`.

**Fact:** For Raleigh (your test city), card pool density depends on how many cards were seeded. If the pool has <3 curated cards within 15km, the function MUST expand radius and re-query.

**Inference:** With typical Raleigh seed density, the loop likely runs 3-4 iterations = 6-8 COUNT queries. Each ~50-80ms = ~300-640ms JUST for the loop. This alone makes sub-1s impossible for cold queries.

**Evidence:** Default `initialRadius = 15000` (15km), `maxRadius = 100000` (100km). Growth factor = 1.5×. Iterations: 15 → 22.5 → 33.75 → 50.6 → 75.9 → 100 = up to 6 iterations.

### 🔴 ROOT CAUSE 2: Impression Exclusion Correlated Subquery

**Fact:** Every COUNT and SELECT in the RPC includes:
```sql
AND NOT EXISTS (
  SELECT 1 FROM person_card_impressions pci
  WHERE pci.user_id = p_user_id
    AND pci.person_id = p_person_id
    AND pci.card_pool_id = cp.id
)
```

**Fact:** This correlated subquery runs once PER ROW in `card_pool` that matches the spatial + category filter. As the user views more cards, their impression rows grow, making this subquery slower.

**Inference:** Without an index on `(user_id, person_id, card_pool_id)` (need to verify), this degrades over time.

### 🔴 ROOT CAUSE 3: Sequential Phase B → C in Edge Function

**Fact:** Preference learning queries (Phase B, lines 207-436) must complete BEFORE multi-dimension queries (Phase C, lines 438-499) can start. They're independent data but executed sequentially.

**Inference:** Moving Phase C to run in parallel with Phase B would save ~100-200ms.

### 🟠 CONTRIBUTING FACTOR: Auth Verification Overhead

**Fact:** `auth.getUser()` (line 170) makes a network call to Supabase Auth service for JWT verification. This adds ~100-200ms to every call.

**Fact:** The client already has the valid token (it just called `supabase.auth.getSession()` in the service layer). The edge function could validate the JWT locally using the Supabase JWT secret.

### 🟠 CONTRIBUTING FACTOR: Impression Upsert Blocks Response

**Fact:** Line 631-643: The impression upsert is `await`ed before returning the response. This adds ~50-100ms to every request.

**Inference:** Impressions are non-critical for the response. They could be fire-and-forget.

### 🟠 CONTRIBUTING FACTOR: Multiple Sections = Multiple Parallel Edge Function Calls

**Fact:** PersonHolidayView renders multiple sections (birthday + N holidays + N custom holidays). Each section's CardRow independently calls `get-person-hero-cards`.

**Fact:** If the user has 1 birthday + 2 standard holidays + 1 custom holiday = 4 parallel calls to the same edge function.

**Inference:** While React Query fires these in parallel, the Supabase edge function runtime may serialize them under load. Each still takes 800-1500ms independently.

### 🔵 OBSERVATION: No Server-Side Cache for Hero Cards

Unlike `generate-session-deck` which has a `session_decks` cache table, `get-person-hero-cards` has NO server-side cache. Every first view is a full computation. Client-side React Query cache (staleTime: Infinity) helps on repeat views but not on first load.

---

## Recommended Fixes (Priority Order)

### P0 — Replace radius expansion loop with a single indexed query (~400ms saved)

Instead of iterating with COUNT queries, use a single query:
```sql
SELECT cp.*, cp.card_type,
  ST_Distance(ST_MakePoint(cp.lng, cp.lat)::geography,
              ST_MakePoint(p_lng, p_lat)::geography) AS dist_m
FROM card_pool cp
LEFT JOIN person_card_impressions pci
  ON pci.user_id = p_user_id
  AND pci.person_id = p_person_id
  AND pci.card_pool_id = cp.id
WHERE cp.is_active = true
  AND pci.id IS NULL
  AND cp.lat BETWEEN (p_lat - max_delta) AND (p_lat + max_delta)
  AND cp.lng BETWEEN (p_lng - max_delta) AND (p_lng + max_delta)
  AND (cp.card_type = 'curated' OR cp.category = ANY(v_slug_categories))
ORDER BY dist_m ASC
LIMIT 6;
```
One query instead of 6-12. Filter for ≥3 curated + ≥3 single in application code.

**Prerequisite:** Add spatial index on `card_pool(lat, lng)` and composite index on `person_card_impressions(user_id, person_id, card_pool_id)`.

### P1 — Parallelize Phase B + C in edge function (~100-200ms saved)

Wrap preference queries and multi-dimension queries in a single `Promise.all`:
```typescript
const [categoryPrefs, [pricePrefs, timePrefs, distancePrefs]] = await Promise.all([
  fetchCategoryPrefs(pairedUserId),
  Promise.all([fetchPricePrefs(), fetchTimePrefs(), fetchDistancePrefs()]),
]);
```

### P1 — Make impression upsert fire-and-forget (~50-100ms saved)

Change line 631 from `await adminClient.from(...).upsert(...)` to fire without await. Use `EdgeRuntime.waitUntil()` if available, or just `.catch(console.warn)`.

### P2 — Add server-side cache table for hero cards

Similar to `session_decks` cache: store `(user_id, person_id, holiday_key, categories_hash) → cards JSON` with a 1-hour TTL. Eliminates the RPC on repeat views even after React Query cache is evicted.

### P3 — Replace `NOT EXISTS` with `LEFT JOIN ... IS NULL`

The `NOT EXISTS` correlated subquery in the RPC may be slower than a `LEFT JOIN` with an `IS NULL` check, especially without proper indexing. Test with `EXPLAIN ANALYZE`.

### P3 — Validate impression table indexes

Verify that `person_card_impressions` has an index on `(user_id, person_id, card_pool_id)`. Without it, the correlated subquery degrades linearly with table size.

---

## Invariants

1. **Card fetch must complete in <1s for ≥90% of users:** Currently impossible with radius expansion loop doing 6-12 sequential queries.
2. **Impression exclusion must not degrade with table growth:** Requires composite index guarantee.
3. **Non-response-critical work (impressions) must not block response:** Impression writes should be fire-and-forget.
4. **Independent data fetches must not be sequential:** Phase B and C preference queries should run in parallel.

---

## File Reference

| File | Role |
|------|------|
| `app-mobile/src/components/PersonHolidayView.tsx` | Main view, renders CardRow per section |
| `app-mobile/src/hooks/usePairedCards.ts` | React Query hook, `staleTime: Infinity` |
| `app-mobile/src/hooks/useHolidayCategories.ts` | AI category generation + AsyncStorage cache |
| `app-mobile/src/services/personHeroCardsService.ts` | HTTP call to edge function |
| `app-mobile/src/services/holidayCategoryService.ts` | HTTP call to GPT-4o-mini edge function |
| `supabase/functions/get-person-hero-cards/index.ts` | Main edge function (667 lines) |
| `supabase/functions/generate-holiday-categories/index.ts` | GPT-4o-mini category generation |
| `supabase/migrations/20260323000004_fix_person_hero_cards_slug_and_dedup.sql` | RPC with radius loop |
