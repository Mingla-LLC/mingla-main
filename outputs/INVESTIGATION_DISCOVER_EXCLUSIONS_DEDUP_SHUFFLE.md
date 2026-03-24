# Investigation: Discover Exclusions, Card Deduplication, and Shuffle Performance

**Date:** 2026-03-24
**Confidence:** High (all code paths traced end-to-end)

---

## Issue 1: Do Discover Experiences Apply the Same Exclusions as Discover Cards?

### Plain English

When you open the "For You" tab (discover experiences), you might see gyms, kids' bounce houses, farmers markets, or schools that would NEVER appear in the regular category swipe cards (discover cards). The two paths serve cards from the same pool but enforce different exclusion rules at serve time.

### What's Happening

**Discover Cards** (`discover-cards/index.ts`) calls `serveCardsFromPipeline()` → `query_pool_cards` RPC. This RPC checks the `category_type_exclusions` table at query time:

```sql
AND NOT EXISTS (
  SELECT 1 FROM category_type_exclusions cte
  WHERE cte.category_slug = ANY(v_slug_categories)
    AND cte.excluded_type = ANY(t.types)
)
```

**Discover Experiences** (`discover-experiences/index.ts`) queries `card_pool` directly (lines 327-338) with a simple Supabase `.eq('category', toSlug(cat))` filter. It does NOT check `category_type_exclusions` at serve time.

### The Gap

| Check | discover-cards | discover-experiences |
|-------|:-:|:-:|
| `GLOBAL_EXCLUDED_PLACE_TYPES` (gym, school, etc.) | At generation time only | At generation time only |
| `category_type_exclusions` table (per-category) | **At serve time via RPC** | **NOT checked** |
| `isChildVenueName()` heuristic (kids, bounce, etc.) | At generation time only | At generation time only |
| `CATEGORY_MIN_PRICE_TIER` floor | **At serve time** | **At serve time** (line 381) |

**Fact:** Both paths rely on cards being clean at generation time. But `discover-cards` has a serve-time safety net (the `category_type_exclusions` check in the RPC), while `discover-experiences` does not.

**Inference:** If a card was generated BEFORE an exclusion rule was added to `category_type_exclusions` (e.g., the recent school/gym exclusions added in migration `20260322500000`), that card could still be served by `discover-experiences` but would be blocked by `discover-cards`.

**Recommendation:** Add the same `category_type_exclusions` check to `discover-experiences`. Either:
- (A) Switch `discover-experiences` to use the `query_pool_cards` RPC (same as `discover-cards`)
- (B) Add a post-fetch filter that checks `category_type_exclusions` before serving

### Evidence Files
- `discover-experiences/index.ts:327-338` — Direct card_pool query, no exclusion check
- `discover-cards/index.ts:452` — Uses `serveCardsFromPipeline` which calls `query_pool_cards` RPC
- `_shared/cardPoolService.ts` — Pipeline wrapper
- `migrations/20260321110000_per_category_exclusion_enforcement.sql` — `query_pool_cards` RPC with exclusion check
- `migrations/20260322500000_school_exclusions_and_flowers_fix.sql` — Added school exclusions to global list + RPC

### Additional Note: generate-single-cards

`generate-single-cards/index.ts` applies `isChildVenueName()` heuristic (line 199) and skips venues with no photos. But it does NOT check `category_type_exclusions` during generation — it relies on the place_pool already being filtered at seeding time. If a venue's type was added to the exclusion table AFTER it was seeded and card-generated, only `discover-cards`'s serve-time RPC catches it.

`generate-curated-experiences/index.ts` is better: it reads `category_type_exclusions` via `getCategoryExcludedTypes()` (line 35-46) AND applies `isChildVenueName()` AND checks `GLOBAL_EXCLUDED_PLACE_TYPES`. But this only covers curated cards, not single cards.

---

## Issue 2: Why Do Cards Repeat Across Hero, Custom Holidays, and Upcoming Holidays?

### Plain English

When you open a paired person's view, you see the same date idea cards appearing in multiple sections — birthday, custom holidays, and upcoming holidays all show overlapping cards. This happens because all three sections fetch cards at the same time with no coordination, and the client-side dedup mechanism has subtle flaws.

### The Full Chain

**Rendering order** (PersonHolidayView.tsx:786-912):
1. Birthday hero section (line 817-823) — CardRow with `holidayKey="birthday"`
2. Custom holidays (line 839-851) — CardRow per custom holiday
3. Upcoming holidays (line 872-885) — CardRow per upcoming holiday

**Dedup mechanism:**
- A shared `seenCardIds = useRef<Set<string>>(new Set())` is created once (line 662)
- Reset when `pairedUserId` changes (line 665-667)
- Passed to every CardRow as a prop

**CardRow's dedup logic** (lines 363-368):
```typescript
const pairedCards = useMemo(() => {
  if (!seenCardIds?.current) return allCards;
  const filtered = allCards.filter(c => !seenCardIds.current.has(c.id));
  for (const c of filtered) seenCardIds.current.add(c.id);
  return filtered;
}, [allCards, seenCardIds]);
```

### Root Causes (Three Layers)

#### Root Cause A: Race Condition — All Sections Fetch Simultaneously with Empty Excludes

Each CardRow creates its own `usePairedCards` query (line 352-354):
```typescript
const excludeIds = seenCardIds?.current ? Array.from(seenCardIds.current) : undefined;
const { data } = usePairedCards(
  hasLoc ? { pairedUserId, holidayKey, location, sections, excludeCardIds: excludeIds } : null
);
```

On initial mount, `seenCardIds.current` is empty. All three sections compute `excludeIds = []`. All three React Query calls fire simultaneously with empty exclude lists. The backend RPC (`query_person_hero_cards`) has no cross-section awareness — it returns whatever cards are available, potentially the same cards for all three sections.

**Fact:** The RPC's `p_exclude_card_ids` parameter (added in migration `20260323000004`) works correctly, but receives an empty array on initial mount from all three sections.

**Fact:** `excludeCardIds` is NOT part of the React Query key (see `usePairedCards.ts:64-65`). The key is `personCardKeys.paired(pairedUserId, holidayKey, locKey)`. So even if `excludeIds` changes on re-render, React Query won't refetch — it uses the cached result from the initial (empty-excludes) fetch.

#### Root Cause B: Client-Side useMemo Dedup Is Fragile

The `useMemo` pattern does work on initial render (React renders children top-to-bottom, synchronously, so birthday's mutation is visible to custom holiday's filter). BUT it breaks in these scenarios:

1. **Shuffle** — `useShufflePairedCards` (line 92-124) fetches new cards with `mode: "shuffle"` but does NOT pass `excludeCardIds`. It replaces ONE section's React Query cache. That section's `useMemo` re-runs, but `seenCardIds` still has stale entries from ALL sections. The other sections' `useMemo`s don't re-run because their `allCards` didn't change.

2. **Component remount** — If the user navigates away and back, a new ref is created (`new Set()`). React Query returns cached (unfiltered) data. All three `useMemo`s re-run with fresh empty set — this SHOULD re-dedup correctly. But if the cached data was from requests with empty excludes, the same cards may appear in multiple caches.

3. **Side effect in useMemo** — Mutating `seenCardIds.current` inside `useMemo` is a React anti-pattern. `useMemo` can run multiple times (React Compiler, StrictMode, concurrent features), causing the ref to accumulate unexpected entries.

#### Root Cause C: Backend Dedup Only Works After First Impression

The RPC checks `person_card_impressions`:
```sql
AND NOT EXISTS (
  SELECT 1 FROM person_card_impressions pci
  WHERE pci.user_id = p_user_id
    AND pci.person_id = p_person_id
    AND pci.card_pool_id = cp.id
)
```

Impressions are recorded AFTER the response (edge function lines 619-644). On first load, all three sections query before any impressions exist. All three can get the same cards. Impressions are then recorded per `holidayKey`, but the dedup check is NOT per holiday — it checks `(user_id, person_id, card_pool_id)` regardless of holiday. So AFTER the first load, subsequent loads correctly exclude previously shown cards. But the initial load has the duplicate problem.

### Why the User Sees Repeats

**Most likely scenario:** Small card pool in the current geo area. Birthday, custom holiday, and upcoming holiday all hit the same 15-20 cards. All three queries fire simultaneously with empty excludes. Backend returns overlapping sets. Client-side `useMemo` dedup is the only defense and works on initial render. But after shuffle or re-render, the dedup breaks because:
- `seenCardIds` is stale
- `excludeCardIds` in the query is permanently empty (not in query key, so never refetched)
- `useMemo` side effects don't reliably propagate across sections

### Recommendation

The proper fix is **backend-level cross-section dedup**:
1. Fetch ALL sections' cards in a SINGLE edge function call, with dedup built into the query
2. OR: fetch sections sequentially (birthday first, then pass its card IDs as excludes to custom, etc.)

The current architecture of 3+ independent parallel fetches with client-side dedup via mutable ref is fundamentally fragile.

### Evidence Files
- `PersonHolidayView.tsx:662-667` — seenCardIds ref creation and reset
- `PersonHolidayView.tsx:350-354` — excludeIds computation and usePairedCards call
- `PersonHolidayView.tsx:363-368` — useMemo dedup filter (side effect)
- `usePairedCards.ts:64-66` — Query key does NOT include excludeCardIds
- `usePairedCards.ts:75` — excludeCardIds passed to fetch but not to key
- `usePairedCards.ts:105-112` — Shuffle does NOT pass excludeCardIds
- `get-person-hero-cards/index.ts:570` — Edge function passes excludeCardIds to RPC
- `20260323000004_fix_person_hero_cards_slug_and_dedup.sql:76,91,108,126,156` — RPC uses p_exclude_card_ids
- `get-person-hero-cards/index.ts:619-644` — Impression recording (after response)

---

## Issue 3: Why Is the Shuffle Button Slow?

### Plain English

When you hit shuffle, the app shows "Finding..." for 1-3 seconds before new cards appear. This is because shuffle triggers a chain of 7+ sequential database queries, each waiting for the previous one to finish, followed by a progressive radius expansion loop that can run the same expensive query 3-4 times.

### The Full Chain (Button Press → New Cards)

1. **ShuffleButton.tsx** — `onShuffle()` call → shows "Finding..." loading state
2. **PersonHolidayView.tsx:357-359** — `shufflePairedCards(pairedUserId, holidayKey, sections, location)`
3. **usePairedCards.ts:105-112** — `fetchPersonHeroCards({ mode: "shuffle" })`
4. **personHeroCardsService.ts:17-35** — HTTP POST to edge function
5. **get-person-hero-cards/index.ts** — Edge function processes shuffle

### Backend Bottlenecks (in sequence)

#### Bottleneck 1: Pre-RPC Preference Queries (lines 363-404)

Before the main RPC call, the shuffle path runs these queries **sequentially**:

| Query | What | Est. Latency |
|-------|------|-------------|
| 1 | Count total swipes from `user_interactions` | 20-50ms |
| 2 | Fetch top-6 category preferences from `user_preference_learning` | 20-50ms |
| 3-4 | Fetch paired + creator price tier preferences | 20-50ms each |
| 5-6 | Fetch time-of-day preferences | 20-50ms each |
| 7 | Fetch distance preferences | 20-50ms |

**Total pre-RPC:** ~140-350ms

Some of these are parallelized (lines 441-469 use `Promise.all`), but the swipe count + category preferences are sequential (lines 366-400).

#### Bottleneck 2: Progressive Radius Expansion Loop (RPC)

The `query_person_hero_cards` RPC (migration `20260323000004`) runs a `WHILE` loop:

```
radius = 15km → 22.5km → 33.75km → 50.6km → 75.9km → 100km (max)
```

**Each iteration runs 4 queries:**
1. COUNT curated cards in radius (with geo filter + NOT EXISTS impression check)
2. COUNT single cards in radius (with geo filter + NOT EXISTS impression check + category filter)
3. If counts ≥ 3 each: SELECT 3 curated + SELECT 3 single (ORDER BY RANDOM())
4. If not: expand radius by 50%, repeat

**Worst case:** Pool is sparse → 5 iterations × 4 queries = 20 SQL queries within the RPC.

#### Bottleneck 3: ORDER BY RANDOM() on Large Sets

Every data query uses `ORDER BY RANDOM()` (lines 115, 133, 163 of the RPC). PostgreSQL's `ORDER BY RANDOM()`:
- Generates a random value for EVERY qualifying row
- Sorts the entire result set
- Returns only LIMIT 3

With a card_pool of thousands of rows in a wide radius, this is O(n log n) per query.

#### Bottleneck 4: NOT EXISTS Subquery per Row

Each candidate card is checked against `person_card_impressions`:
```sql
AND NOT EXISTS (
  SELECT 1 FROM person_card_impressions pci
  WHERE pci.user_id = p_user_id
    AND pci.person_id = p_person_id
    AND pci.card_pool_id = cp.id
)
```

Without a covering index on `(user_id, person_id, card_pool_id)`, this is a sequential scan per candidate.

#### Bottleneck 5: Post-RPC Processing (lines 582-656)

- Map JSONB rows to Card objects
- Apply price tier filter
- Dedup safety check
- Record impressions (upsert to `person_card_impressions`)

### Total Estimated Latency

| Phase | Best Case | Worst Case |
|-------|-----------|------------|
| Network round trip | 100ms | 200ms |
| Pre-RPC preference queries | 100ms | 350ms |
| RPC (1 iteration) | 150ms | — |
| RPC (5 iterations) | — | 1000ms |
| ORDER BY RANDOM() (×2-3) | 50ms | 300ms |
| NOT EXISTS per row | 30ms | 200ms |
| Post-RPC + impression write | 50ms | 100ms |
| **TOTAL** | **480ms** | **2150ms** |

### Recommendations

1. **Parallelize pre-RPC queries** — Swipe count, category prefs, price prefs, time prefs should ALL run in a single `Promise.all`
2. **Replace progressive radius loop** — Use a single query with `ORDER BY distance` and `LIMIT 6`, avoiding the loop entirely. Or use PostGIS `ST_DWithin` with a spatial index.
3. **Replace ORDER BY RANDOM()** — Use `TABLESAMPLE` or `ORDER BY md5(id || session_seed)` for deterministic-but-varied ordering that uses indexes.
4. **Add covering index** — `CREATE INDEX ON person_card_impressions (user_id, person_id, card_pool_id)` to make NOT EXISTS an index-only scan.
5. **Cache preference results** — Category and price preferences change rarely. Cache for 5-10 minutes on the client and pass as request params instead of re-querying each shuffle.

### Evidence Files
- `ShuffleButton.tsx` — UI component, loading state
- `PersonHolidayView.tsx:356-360` — Shuffle handler
- `usePairedCards.ts:92-124` — useShufflePairedCards hook
- `personHeroCardsService.ts:17-35` — Network call
- `get-person-hero-cards/index.ts:363-404` — Shuffle mode preference queries
- `get-person-hero-cards/index.ts:441-469` — Multi-dimension preference queries
- `get-person-hero-cards/index.ts:559-572` — RPC call
- `20260323000004_fix_person_hero_cards_slug_and_dedup.sql:64-166` — Full RPC with radius loop

---

## Invariants That Should Hold But Don't

| # | Invariant | Current Enforcement | Strength |
|---|-----------|-------------------|----------|
| 1 | No excluded-type venue appears in any card surface | Generation-time filter (code). Serve-time check only in `discover-cards` RPC, NOT in `discover-experiences`. | **Weak** — gap in experiences path |
| 2 | No card appears in more than one holiday section for the same person | Client-side `seenCardIds` ref + useMemo side effect. `excludeCardIds` param exists but empty on first mount. | **Weak** — fragile, race-prone |
| 3 | Shuffle completes within 500ms | No enforcement. No timeout. No performance budget. | **None** |
| 4 | Impressions prevent re-showing cards | `person_card_impressions` check in RPC. But impressions recorded AFTER response, creating a window for duplicates on first load. | **Medium** — works after first cycle |

---

## Summary of Findings

### 🔴 ROOT CAUSE — Discover Experiences Missing Serve-Time Exclusions
- **File:** `discover-experiences/index.ts:327-338`
- **Defect:** Direct `card_pool` query without `category_type_exclusions` check
- **Should:** Apply same exclusion check as `query_pool_cards` RPC
- **Causal chain:** Admin adds exclusion → card stays in pool → `discover-cards` blocks it → `discover-experiences` serves it
- **Verification:** Add a gym to card_pool, verify it appears in For You tab but not in category swipe

### 🔴 ROOT CAUSE — Cross-Section Card Dedup Is Client-Side Only
- **File:** `PersonHolidayView.tsx:350-368`, `usePairedCards.ts:64-66`
- **Defect:** `excludeCardIds` not in query key + empty on first mount + not passed on shuffle
- **Should:** Backend should enforce cross-section dedup, or sections should fetch sequentially
- **Causal chain:** All sections mount → all query with empty excludes → backend returns overlapping cards → useMemo dedup works on first render but breaks on shuffle/refetch
- **Verification:** Open a paired person with limited card pool; observe same cards across sections after shuffle

### 🟠 CONTRIBUTING FACTOR — Shuffle Performance (7+ Sequential Queries + Radius Loop)
- **Files:** `get-person-hero-cards/index.ts:363-572`, RPC migration
- **Impact:** 500ms-2s+ latency per shuffle
- **Should:** Parallelize preference queries, eliminate radius loop, use indexed random selection

### 🟡 HIDDEN FLAW — useMemo Side Effect (Anti-Pattern)
- **File:** `PersonHolidayView.tsx:367`
- **Defect:** Mutating `seenCardIds.current` inside `useMemo` is a side effect in render
- **Risk:** React StrictMode, Concurrent features, or React Compiler could cause double-execution, corrupting the set
