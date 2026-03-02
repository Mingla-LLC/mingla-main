# Investigation Report: Discover "For You" Tab — All Cards From Same Category (Nature)
**Date:** 2026-03-02
**Reported symptom:** "When I go on the For You tab in the Discover page, I see 1 hero card and 10 other experiences all from one category — Nature. I should see a hero with 2 compact cards from Fine Dining and Play each, and below that 10 cards, 1 from each of the other 10 categories."
**Investigated by:** Brutal Investigator Skill
**Verdict:** The pool-first pipeline in `discover-experiences` returns cards ordered by popularity score with zero category diversity enforcement, so Nature parks (which have the highest review counts and ratings) dominate every slot. The same path also omits the `heroCards` response field entirely, collapsing the 2-hero layout into a single fallback featured card.

---

## 1. Symptom Summary

**What the user expected:**
- 2 hero compact cards: 1 Fine Dining + 1 Play
- 10 grid cards below: 1 from each of the remaining 10 categories (Nature, First Meet, Picnic, Drink, Casual Eats, Watch, Creative & Arts, Wellness, Groceries & Flowers, Work & Business)

**What actually happens:**
- 1 hero card (not 2 compact cards)
- 10 grid cards all from the same category (Nature)

**Reproducible:** Always (once the card pool is populated with enough cards)

---

## 2. Investigation Perimeter

### Files Read (Direct Chain)
| File | Layer | Purpose | Status |
|------|-------|---------|--------|
| `app-mobile/src/components/DiscoverScreen.tsx` | Component | Renders For You tab (hero + grid) | Read |
| `app-mobile/src/hooks/useDiscoverQuery.ts` | Hook | React Query wrapper for discover | Read |
| `app-mobile/src/services/experienceGenerationService.ts` | Service | Calls discover-experiences edge fn | Read |
| `supabase/functions/discover-experiences/index.ts` | Edge Function | Fetches places, builds cards | Read |
| `supabase/functions/_shared/cardPoolService.ts` | Shared Service | Pool-first card serving pipeline | Read |
| `supabase/functions/_shared/categoryPlaceTypes.ts` | Shared Constants | Category → Place type mappings | Read |

### Files Read (Adjacent Suspects)
| File | Why Investigated | Relevant? |
|------|-----------------|-----------|
| `app-mobile/src/constants/categories.ts` | Canonical category definitions | No — not involved in this bug |
| `supabase/functions/_shared/placesCache.ts` | Referenced by pool service | Indirectly (batch search used in gap-fill) |

**Total files read:** 7
**Total lines inspected:** ~2,800

---

## 3. Findings

### ROOT CAUSE 1 (RC-001): Pool-first pipeline has zero category diversity enforcement

**File:** `supabase/functions/_shared/cardPoolService.ts` (lines 84–168) and `supabase/functions/discover-experiences/index.ts` (lines 349–393)

**The defective code (cardPoolService.ts:104–124):**
```typescript
let query = supabaseAdmin
  .from('card_pool')
  .select('*')
  .eq('is_active', true)
  .eq('card_type', cardType);

if (resolvedCats.length > 0) {
  query = query.overlaps('categories', resolvedCats);  // matches ANY card with ANY matching category
}

query = query
  .gte('lat', lat - latDelta)
  .lte('lat', lat + latDelta)
  .gte('lng', lng - lngDelta)
  .lte('lng', lng + lngDelta)
  .lte('price_min', budgetMax)
  .order('popularity_score', { ascending: false })  // ordered by popularity only
  .limit(limit + 20);
```

**What it does:** Queries `card_pool` for ALL cards matching ANY of the 12 categories, ordered by `popularity_score DESC`. Returns the top N cards regardless of category distribution. Parks (Nature) typically have thousands of reviews and high ratings, giving them the highest `popularity_score` values (`rating * log10(reviewCount + 1)`). Result: all 11 cards are Nature.

**What it should do:** Enforce one card per category. Query should select at most 1 card per unique category (round-robin), then fill remaining slots from highest-rated remaining cards. This mirrors the logic already in the non-pool Google API path (lines 407–447 of discover-experiences).

**The defective code (discover-experiences/index.ts:367–388) — pool early return:**
```typescript
if (poolResult.fromPool >= 8) {
  const poolCards = poolResult.cards.slice(0, 10);
  const poolFeaturedCard = poolResult.cards.length > 10 ? poolResult.cards[10] : null;
  return new Response(
    JSON.stringify({
      cards: poolCards,          // no diversity — all same category
      featuredCard: poolFeaturedCard,
      meta: { ... poolFirst: true ... },
    }),
  );
}
```

**Causal chain:**
1. User opens For You tab → edge function called
2. Pool has >= 8 cards matching the location bounding box
3. `queryPoolCards()` returns top cards by `popularity_score DESC` — all Nature (parks with 5000+ reviews)
4. `serveCardsFromPipeline()` returns all-Nature cards
5. Edge function sees `fromPool >= 8` → returns immediately with all-Nature cards
6. Client renders 10 Nature grid cards

**Verification:** Add logging in the pool query to print each card's category. All will be Nature. Then implement per-category round-robin selection and verify each category appears exactly once.

**Fix complexity:** Medium

---

### ROOT CAUSE 2 (RC-002): Pool-first response omits `heroCards` field

**File:** `supabase/functions/discover-experiences/index.ts` (lines 367–388)

**The defective code:**
```typescript
if (poolResult.fromPool >= 8) {
  const poolCards = poolResult.cards.slice(0, 10);
  const poolFeaturedCard = poolResult.cards.length > 10 ? poolResult.cards[10] : null;
  return new Response(
    JSON.stringify({
      cards: poolCards,
      featuredCard: poolFeaturedCard,  // single card — NOT the 2-hero array
      // heroCards IS MISSING
      meta: { ... },
    }),
  );
}
```

**What it does:** Returns `cards` + `featuredCard` only. No `heroCards` array in the response.

**What it should do:** Return `heroCards: [fineDiningCard, playCard]` — 2 separate hero cards pulled from Fine Dining and Play categories, just like the non-pool Google API path does (lines 453–489).

**Causal chain:**
1. Edge function returns response with no `heroCards` field
2. `ExperienceGenerationService.discoverExperiences()` line 209: `const heroCards = (data.heroCards || []).map(...)` → empty array
3. `DiscoverScreen.tsx` line 1538-1555: `transformedHeroes` = `[]`
4. Line 1580: `setSelectedHeroCards([])` — empty hero cards
5. Rendering (line 3339): `selectedHeroCards.length > 0` is false → falls back to single `featuredCard` at line 3359
6. User sees 1 hero card instead of 2 compact hero cards

**Verification:** Add `heroCards: []` to the pool response and confirm the client receives it. Then populate it with actual Fine Dining + Play cards and confirm 2 hero cards render.

**Fix complexity:** Medium (must also select hero cards from pool with category enforcement)

---

### CONTRIBUTING FACTORS

#### CF-001: Client-side `DiscoverCache` interface doesn't include `heroCards`

**File:** `app-mobile/src/components/DiscoverScreen.tsx` (lines 141–146)

**The defective code:**
```typescript
interface DiscoverCache {
  date: string;
  recommendations: Recommendation[];
  featuredCard: FeaturedCardData | null;
  gridCards: GridCardData[];
  // heroCards is missing
}
```

**What's wrong:** When the client saves discover data to AsyncStorage cache (line 1592: `saveDiscoverCache(transformed, finalFeatured, gridCards)`), it never saves `heroCards`. The `applyCachedDiscoverData` function (line 1367–1392) never calls `setSelectedHeroCards()`.

**Why it matters:** Even when a fresh API call correctly returns 2 hero cards, the next time the user opens the app and loads from client cache, the hero cards are lost. `selectedHeroCards` stays as `[]` and the UI degrades to the single featured card fallback.

**Recommended fix:** Add `heroCards: FeaturedCardData[]` to `DiscoverCache`. Save hero cards in `saveDiscoverCache`. Restore them in `applyCachedDiscoverData` via `setSelectedHeroCards(cachedData.heroCards || [])`.

---

#### CF-002: Pool-first early return bypasses hero card selection logic entirely

**File:** `supabase/functions/discover-experiences/index.ts` (lines 349–393)

**What's wrong:** The entire hero card selection algorithm (lines 407–489: skipping hero categories from grid, selecting best-rated Fine Dining + Play) only runs in the Google API fallback path. When the pool serves cards, none of this logic executes.

**Why it matters:** The pool path effectively replaces the entire card-selection strategy with a naive "top by popularity" approach. This is a design-level issue — the pool was grafted onto the edge function as a fast path but didn't replicate the diversity + hero card logic.

**Recommended fix:** Either (a) add category diversity + hero selection logic inside `serveCardsFromPipeline` itself, or (b) post-process the pool results in the discover-experiences handler to enforce diversity and extract hero cards before returning.

---

### HIDDEN FLAWS

#### HF-001: The re-randomization useEffect can overwrite correctly-set cards

**File:** `app-mobile/src/components/DiscoverScreen.tsx` (lines 1664–1784)

**What's wrong:** The `useEffect` at line 1664 watches `recommendations` and re-runs card selection (random hero + 1-per-category grid) whenever `recommendations` changes. It's protected by `loadedFromCacheRef.current`, but this is a fragile ref-based flag that's set to `false` after one skip (line 1676). If `recommendations` changes a second time (e.g., from a background refresh), the useEffect will run and OVERWRITE the correctly-set `selectedHeroCards`, `selectedFeaturedCard`, and `selectedGridCards` with its own randomized selection — which doesn't know about the 2-hero layout at all (it picks 1 random hero from any category).

**What will eventually break:** After RC-001 and RC-002 are fixed, if a stale cache triggers a background refresh that re-sets `recommendations`, this useEffect will obliterate the correct hero card state.

**Recommended fix:** Either remove this useEffect entirely (cards should be set directly from the fetch result, not re-derived from `recommendations`) or gate it more robustly — e.g., only run when `selectedHeroCards.length === 0 && selectedGridCards.length === 0`.

---

#### HF-002: Supabase daily cache returns heroCards but client-side cache path doesn't

**File:** `supabase/functions/discover-experiences/index.ts` (lines 287–312) vs `app-mobile/src/components/DiscoverScreen.tsx` (lines 1422–1451)

**What's wrong:** The edge function's Supabase daily cache correctly stores `heroCards` in `generated_location.heroCards` and returns them on cache hit. But the client-side AsyncStorage cache (which is checked FIRST, before the edge function is even called) doesn't store heroCards at all. This means:
- First load (no cache): edge function runs → if pool path, bad data. If Google path, good data.
- Second load (client cache hit): `applyCachedDiscoverData` runs → no heroCards restored → always 1 hero card

**What will eventually break:** Even after fixing the pool-first path, users will lose their 2-hero layout on every subsequent load within the same day because the client cache doesn't preserve heroCards.

**Recommended fix:** Fix CF-001 (add heroCards to DiscoverCache).

---

### OBSERVATIONS

#### OB-001: The pool-first threshold of 8 cards is too low

**File:** `supabase/functions/discover-experiences/index.ts` (line 367)

**What I noticed:** `if (poolResult.fromPool >= 8)` triggers the pool-early-return. With 12 categories, 8 cards from pool means only 73% coverage at best. Combined with no diversity enforcement, this threshold makes it easy for the pool path to activate with terrible category distribution.

**Why I'm flagging it:** Even after fixing diversity in the pool, a threshold of 8 means up to 4 categories might not be represented in the pool and will be missing from the response entirely (no gap-fill happens in the early return path).

---

## 4. Root Cause Analysis — Full Trace

The issue begins at the **pool-first pipeline** in `discover-experiences/index.ts`. When the user opens the For You tab:

1. The edge function checks `card_pool` for previously-stored cards matching the user's location and categories.
2. `serveCardsFromPipeline()` queries `card_pool` with `.overlaps('categories', resolvedCats).order('popularity_score', { ascending: false })`. This returns the **highest-popularity cards regardless of category**. Nature places (parks, hiking areas, botanical gardens) consistently have the highest `popularity_score` because the formula is `rating * log10(reviewCount + 1)` and parks often have 5,000–50,000 reviews vs. restaurants with 200–2,000.
3. The pool returns 11+ Nature cards. The edge function sees `poolResult.fromPool >= 8` and takes the early return path.
4. This early return path constructs the response with `cards` (first 10 pool cards — all Nature) and `featuredCard` (11th pool card — also Nature). **It does not include a `heroCards` field.**
5. The client receives this response. `heroCardsRaw` is `undefined`, so `transformedHeroes` is `[]`. `selectedHeroCards` is set to `[]`.
6. Grid cards are all Nature because the pool returned all Nature cards.
7. Rendering: `selectedHeroCards.length > 0` is false, so the UI falls to the `featuredCard` fallback — rendering 1 hero card instead of 2.
8. The client caches this bad state (without heroCards) to AsyncStorage, perpetuating the problem on subsequent loads.

The **non-pool path** (Google API fallback, lines 396–647) works correctly: it separates hero categories (`Fine Dining`, `Play`), selects one unique place per category, and returns `heroCards`, `cards`, and `featuredCard` as separate arrays. But this path **never executes** when the pool has >= 8 cards.

---

## 5. Recommended Fix Strategy

### Priority 1 — Fix the root causes

| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|----------------|
| RC-001 | Enforce per-category diversity in pool serving | `_shared/cardPoolService.ts` + `discover-experiences/index.ts` | Medium | After querying pool cards, group by category and pick at most 1 per category (round-robin by popularity). Only after all categories have 1 card, fill remaining slots from highest-rated leftovers. |
| RC-002 | Add heroCards to pool-first response | `discover-experiences/index.ts` | Medium | In the pool-first early return path (line 367), extract Fine Dining + Play cards from pool results as `heroCards`, remove them from the grid `cards`, and include `heroCards` in the response JSON. |

### Priority 2 — Fix contributing factors

| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|----------------|
| CF-001 | Add heroCards to client-side DiscoverCache | `DiscoverScreen.tsx` | Small | Add `heroCards: FeaturedCardData[]` to `DiscoverCache`. Save in `saveDiscoverCache()`. Restore in `applyCachedDiscoverData()` via `setSelectedHeroCards()`. |
| CF-002 | Ensure pool-first path replicates diversity logic | `discover-experiences/index.ts` | N/A | Covered by RC-001 + RC-002 |

### Priority 3 — Fix hidden flaws

| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|----------------|
| HF-001 | Harden or remove re-randomization useEffect | `DiscoverScreen.tsx` | Small | Gate the useEffect at line 1664 so it never overwrites `selectedHeroCards`/`selectedGridCards` when they were set by a fresh fetch. Consider removing it entirely — cards should be set once from the API response, not re-derived. |
| HF-002 | Covered by CF-001 | — | — | — |

### Suggested implementation order:
1. **RC-001** — Add per-category round-robin selection in pool serving (this is the core fix that stops all-Nature results)
2. **RC-002** — Extract Fine Dining + Play as heroCards in pool-first response path (this restores the 2-hero layout)
3. **CF-001** — Add heroCards to DiscoverCache so client cache preserves hero cards
4. **HF-001** — Harden or remove the re-randomization useEffect

### What NOT to change:
- **The Google API fallback path** (lines 396–647 in discover-experiences) — this already works correctly with per-category selection and hero card extraction. Don't touch it.
- **`categoryPlaceTypes.ts`** — the shared mappings are correct and properly used.
- **`experienceGenerationService.ts`** — the service correctly passes through `heroCards` from the edge function response. No changes needed.
- **`useDiscoverQuery.ts`** — this hook is not used by the current For You tab flow (DiscoverScreen uses its own manual fetch). Don't modify it.

---

## 6. Handoff to Orchestrator

Orchestrator: the investigation is complete. The root cause of "all cards from Nature + only 1 hero card" is that the **pool-first pipeline** in `discover-experiences` returns cards ordered by popularity_score with zero category diversity enforcement, and the pool-first response omits the `heroCards` field entirely. The fix strategy in §5 gives you exact file paths, exact defect locations, and exact changes needed. There are 2 root causes, 2 contributing factors, and 2 hidden flaws — all should be addressed in the same pass. The non-pool Google API path already works correctly and should not be modified. Spec the fix, hand it to the implementor, then send the result to the tester. Let's close this.
