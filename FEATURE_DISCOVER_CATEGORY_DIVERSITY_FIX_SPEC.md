# Feature: Discover "For You" Category Diversity Fix
**Date:** 2026-03-02
**Status:** Planned
**Requested by:** "When I go on the For You tab in the Discover page, I see 1 hero card and 10 other experiences all from one category — Nature. I should see a hero with 2 compact cards from Fine Dining and Play each, and below that 10 cards, 1 from each of the other 10 categories."

---

## 1. Summary

The pool-first pipeline in `discover-experiences` returns cards ordered by `popularity_score DESC` with zero category diversity enforcement. Parks (Nature) have the highest review counts and dominate every slot. The same pool path also omits the `heroCards` response field, collapsing the 2-hero layout into a single featured card fallback. Additionally, the client-side AsyncStorage cache never persists `heroCards`, so even when the API returns correct hero data, subsequent loads from cache lose it.

This spec fixes four defects in one pass: (1) per-category round-robin selection in the pool-first path, (2) hero card extraction from pool results, (3) `heroCards` in the client-side cache, and (4) hardening the re-randomization `useEffect` to never overwrite API-set hero cards.

## 2. User Story

As a Mingla user, I want the Discover "For You" tab to show 2 hero cards (Fine Dining + Play) and 10 grid cards (one from each of the remaining 10 categories) regardless of whether cards are served from the pool or from Google API, so that I always see diverse category coverage.

## 3. Success Criteria

1. When pool has >= 12 cards across all categories: 2 hero cards appear (Fine Dining + Play) and 10 grid cards appear (one from each of the other 10 categories: Nature, First Meet, Picnic, Drink, Casual Eats, Watch, Creative & Arts, Wellness, Groceries & Flowers, Work & Business).
2. When pool has cards but is missing some categories: hero cards are extracted from available Fine Dining and Play pool cards; grid cards enforce one-per-category for available categories; missing categories are logged but do not block the response.
3. The pool-first early return path (line 367) returns `heroCards` in the JSON response with the same shape as the Google API path.
4. Client-side AsyncStorage cache persists `heroCards`. On subsequent loads from cache, `selectedHeroCards` is restored and the 2-hero layout renders correctly.
5. The re-randomization `useEffect` (line 1664) never overwrites `selectedHeroCards` or `selectedGridCards` when they were set by a fresh API fetch.
6. No changes to the Google API fallback path (lines 396–647 of `discover-experiences/index.ts`) — it already works correctly.
7. No new edge functions, tables, or columns. Zero database changes.

---

## 4. Database Changes

None.

---

## 5. Edge Functions

### 5.1 Modify `discover-experiences/index.ts` — Pool-first early return (lines 367–388)

**File path:** `supabase/functions/discover-experiences/index.ts`
**What to change:** Replace the naive pool-first early return with category-diverse selection + hero card extraction.

**Current defective code (lines 367–388):**
```typescript
if (poolResult.fromPool >= 8) {
  const poolCards = poolResult.cards.slice(0, 10);
  const poolFeaturedCard = poolResult.cards.length > 10 ? poolResult.cards[10] : null;
  return new Response(
    JSON.stringify({
      cards: poolCards,
      featuredCard: poolFeaturedCard,
      meta: { ... poolFirst: true ... },
    }),
  );
}
```

**Replace with this exact code:**
```typescript
if (poolResult.fromPool >= 8) {
  console.log(`[pool-first] Serving ${poolResult.cards.length} discover cards from pool (${poolResult.fromPool} pool, ${poolResult.fromApi} API)`);

  // ── Category-diverse selection from pool cards ──
  const HERO_CATEGORIES = ["Fine Dining", "Play"];
  const poolHeroCards: any[] = [];
  const poolGridCards: any[] = [];
  const usedCategories = new Set<string>();
  const usedIds = new Set<string>();

  // PASS 1: Extract hero cards (Fine Dining + Play)
  for (const heroCategory of HERO_CATEGORIES) {
    const heroCandidates = poolResult.cards.filter(
      (c: any) => c.category === heroCategory && !usedIds.has(c.id)
    );
    if (heroCandidates.length > 0) {
      const selected = heroCandidates[0]; // Already sorted by popularity from pool
      poolHeroCards.push(selected);
      usedIds.add(selected.id);
      usedCategories.add(heroCategory);
      console.log(`[pool-first] Hero card for ${heroCategory}: "${selected.title}"`);
    } else {
      console.log(`[pool-first] No pool card for hero category: ${heroCategory}`);
    }
  }

  // PASS 2: One card per non-hero category (round-robin diversity)
  for (const category of categoriesToFetch) {
    if (HERO_CATEGORIES.includes(category)) continue; // Heroes already extracted
    if (usedCategories.has(category)) continue;
    if (poolGridCards.length >= 10) break;

    const candidates = poolResult.cards.filter(
      (c: any) => c.category === category && !usedIds.has(c.id)
    );
    if (candidates.length > 0) {
      const selected = candidates[0];
      poolGridCards.push(selected);
      usedIds.add(selected.id);
      usedCategories.add(category);
    }
  }

  // PASS 3: Fill remaining grid slots (if fewer than 10) from unused pool cards
  if (poolGridCards.length < 10) {
    const remaining = poolResult.cards.filter((c: any) => !usedIds.has(c.id));
    for (const card of remaining) {
      if (poolGridCards.length >= 10) break;
      poolGridCards.push(card);
      usedIds.add(card.id);
    }
  }

  // Backward compat: featuredCard = first hero
  const poolFeaturedCard = poolHeroCards[0] || poolGridCards[0] || null;

  // ── Persist to daily cache (same as Google API path) ──
  if (adminClient && userId) {
    adminClient
      .from("discover_daily_cache")
      .delete()
      .eq("user_id", userId)
      .eq("us_date_key", usDateKey)
      .then(() =>
        adminClient
          .from("discover_daily_cache")
          .insert({
            user_id: userId,
            us_date_key: usDateKey,
            cards: poolGridCards,
            featured_card: poolFeaturedCard,
            generated_location: {
              lat: location.lat,
              lng: location.lng,
              radius,
              categoryHash,
              heroCards: poolHeroCards,
            },
          })
      )
      .catch((e: any) => console.warn("[pool-first] Cache write error:", e));
  }

  return new Response(
    JSON.stringify({
      cards: poolGridCards,
      heroCards: poolHeroCards,
      featuredCard: poolFeaturedCard,
      meta: {
        totalResults: poolGridCards.length,
        heroCount: poolHeroCards.length,
        categories: categoriesToFetch,
        successfulCategories: Array.from(usedCategories),
        failedCategories: categoriesToFetch.filter((c) => !usedCategories.has(c)),
        poolFirst: true,
        fromPool: poolResult.fromPool,
        fromApi: poolResult.fromApi,
      },
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}
```

**Why:** The old code took the first 10 cards by popularity (all Nature) and omitted `heroCards`. The new code: (1) extracts Fine Dining + Play as hero cards first, (2) round-robins one card per remaining category, (3) fills leftover slots from unused pool cards, (4) returns `heroCards` in the response, (5) persists to daily cache including `heroCards` (so the server-side cache hit also works correctly).

---

### 5.2 Modify `_shared/cardPoolService.ts` — Add category field to API card output

**File path:** `supabase/functions/_shared/cardPoolService.ts`
**What to change:** Nothing. The `poolCardToApiCard` function (line 499) already includes `category: card.category` in the output. The `queryPoolCards` function (line 84) already returns the `category` field from `card_pool`. No changes needed to the shared service.

**Verification:** The pool-first path in `discover-experiences` receives cards with `.category` populated. The round-robin logic in §5.1 uses `c.category` to filter. This works with the existing data.

---

## 6. Mobile Implementation

### 6.1 Files to Modify

#### 6.1.1 `app-mobile/src/components/DiscoverScreen.tsx` — Three changes

**Change 1: Add `heroCards` to `DiscoverCache` interface**

**File:** `app-mobile/src/components/DiscoverScreen.tsx`
**Where:** Line 141–146 (the `DiscoverCache` interface)
**Current code:**
```typescript
interface DiscoverCache {
  date: string;
  recommendations: Recommendation[];
  featuredCard: FeaturedCardData | null;
  gridCards: GridCardData[];
}
```
**Replace with:**
```typescript
interface DiscoverCache {
  date: string;
  recommendations: Recommendation[];
  featuredCard: FeaturedCardData | null;
  gridCards: GridCardData[];
  heroCards: FeaturedCardData[];
}
```

---

**Change 2: Save `heroCards` in `saveDiscoverCache` and pass them from the caller**

**File:** `app-mobile/src/components/DiscoverScreen.tsx`
**Where:** Line 1210–1240 (the `saveDiscoverCache` function)
**Current code:**
```typescript
const saveDiscoverCache = async (
  recommendations: Recommendation[],
  featuredCard: FeaturedCardData | null,
  gridCards: GridCardData[]
) => {
  if (!user?.id) {
    return;
  }
  try {
    const cacheData: DiscoverCache = {
      date: getTodayDateString(),
      recommendations,
      featuredCard,
      gridCards,
    };
```
**Replace with:**
```typescript
const saveDiscoverCache = async (
  recommendations: Recommendation[],
  featuredCard: FeaturedCardData | null,
  gridCards: GridCardData[],
  heroCards: FeaturedCardData[] = []
) => {
  if (!user?.id) {
    return;
  }
  try {
    const cacheData: DiscoverCache = {
      date: getTodayDateString(),
      recommendations,
      featuredCard,
      gridCards,
      heroCards,
    };
```

**Then update the call site at line 1592.** Current code:
```typescript
saveDiscoverCache(transformed, finalFeatured, gridCards);
```
**Replace with:**
```typescript
saveDiscoverCache(transformed, finalFeatured, gridCards, transformedHeroes);
```

---

**Change 3: Restore `heroCards` in `applyCachedDiscoverData`**

**File:** `app-mobile/src/components/DiscoverScreen.tsx`
**Where:** Line 1367–1392 (the `applyCachedDiscoverData` function)
**Current code:**
```typescript
const applyCachedDiscoverData = (cachedData: DiscoverCache) => {
  const fallbackFeatured = cachedData.featuredCard || (cachedData.gridCards?.[0] ? featuredFromGridCard(cachedData.gridCards[0]) : null);
  const hasGridCards = (cachedData.gridCards?.length || 0) > 0;
  const hasCompleteCardState = !!fallbackFeatured && hasGridCards;

  loadedFromCacheRef.current = hasCompleteCardState;

  if (hasCompleteCardState) {
    setSelectedFeaturedCard(fallbackFeatured);
    setSelectedGridCards(cachedData.gridCards);
  } else {
```
**Replace with:**
```typescript
const applyCachedDiscoverData = (cachedData: DiscoverCache) => {
  const fallbackFeatured = cachedData.featuredCard || (cachedData.gridCards?.[0] ? featuredFromGridCard(cachedData.gridCards[0]) : null);
  const hasGridCards = (cachedData.gridCards?.length || 0) > 0;
  const hasCompleteCardState = !!fallbackFeatured && hasGridCards;

  loadedFromCacheRef.current = hasCompleteCardState;

  // Restore hero cards from cache (backward compat: default to empty array)
  const cachedHeroCards = cachedData.heroCards || [];
  if (cachedHeroCards.length > 0) {
    setSelectedHeroCards(cachedHeroCards);
  }

  if (hasCompleteCardState) {
    setSelectedFeaturedCard(fallbackFeatured);
    setSelectedGridCards(cachedData.gridCards);
  } else {
```

---

**Change 4: Harden the re-randomization `useEffect` (line 1664–1784)**

**File:** `app-mobile/src/components/DiscoverScreen.tsx`
**Where:** Line 1664–1678 (the early-return guards in the `useEffect`)
**Current code:**
```typescript
useEffect(() => {
  if (!recommendations || recommendations.length === 0) {
    setSelectedFeaturedCard(null);
    setSelectedGridCards([]);
    previousRecommendationsLengthRef.current = 0;
    return;
  }

  // Skip re-randomization if we loaded from cache (cards already restored)
  if (loadedFromCacheRef.current) {
    console.log("Skipping card selection - loaded from cache");
    previousRecommendationsLengthRef.current = recommendations.length;
    loadedFromCacheRef.current = false; // Reset flag for future updates
    return;
  }
```
**Replace with:**
```typescript
useEffect(() => {
  if (!recommendations || recommendations.length === 0) {
    setSelectedFeaturedCard(null);
    setSelectedGridCards([]);
    previousRecommendationsLengthRef.current = 0;
    return;
  }

  // Skip re-randomization if we loaded from cache (cards already restored)
  if (loadedFromCacheRef.current) {
    console.log("Skipping card selection - loaded from cache");
    previousRecommendationsLengthRef.current = recommendations.length;
    loadedFromCacheRef.current = false; // Reset flag for future updates
    return;
  }

  // Skip re-randomization if hero cards were already set by the API fetch path
  // (the fetch path sets selectedHeroCards directly — this useEffect must not overwrite them)
  if (selectedHeroCards.length > 0) {
    console.log("Skipping card selection - hero cards already set by API fetch");
    previousRecommendationsLengthRef.current = recommendations.length;
    return;
  }
```

**Why:** The `useEffect` watches `recommendations` and re-derives hero/grid cards with random selection. After the API fetch path sets correct hero cards at line 1580, a subsequent `recommendations` change (e.g., background refresh) would trigger this `useEffect` and overwrite the correct hero state with random single-hero selection. The new guard prevents this.

**IMPORTANT:** Do NOT add `selectedHeroCards` to the `useEffect` dependency array. The guard reads it but must not re-trigger on its changes. The existing `[recommendations]` dependency is correct.

---

### 6.2 No New Files

No new services, hooks, types, or components are needed. This is a fix to existing code only.

### 6.3 State Changes

**Zustand:** No Zustand changes.
**React Query keys affected:** None. The Discover "For You" tab uses manual `useState` + AsyncStorage caching, not React Query.
**AsyncStorage:** `DiscoverCache` shape gains a `heroCards` field. Old cached data without this field is handled by the `|| []` default.

---

## 7. Implementation Order

**Step 1: Modify the pool-first early return in `discover-experiences/index.ts`.**
Open `supabase/functions/discover-experiences/index.ts`. Replace lines 367–388 with the exact code from §5.1. Do not modify any other code in this file. Verify: deploy locally with `supabase functions serve`, then send a request when the pool has >= 8 cards. Confirm the response contains `heroCards` (array of 0–2 cards), `cards` (array of up to 10 cards with diverse categories), and `featuredCard`. Log each hero category and each grid category to confirm diversity.

**Step 2: Add `heroCards` to `DiscoverCache` interface.**
Open `app-mobile/src/components/DiscoverScreen.tsx`. Modify the `DiscoverCache` interface at line 141 per §6.1.1 Change 1.

**Step 3: Modify `saveDiscoverCache` to accept and persist `heroCards`.**
In the same file, modify the function signature and body at line 1210 per §6.1.1 Change 2. Then update the call site at line 1592 to pass `transformedHeroes`.

**Step 4: Modify `applyCachedDiscoverData` to restore `heroCards`.**
In the same file, modify the function at line 1367 per §6.1.1 Change 3. This ensures cached hero cards are restored on subsequent loads.

**Step 5: Harden the re-randomization `useEffect`.**
In the same file, add the `selectedHeroCards.length > 0` guard at line 1678 per §6.1.1 Change 4. Do NOT modify the dependency array.

**Step 6: Integration test.**
1. Clear the `discover_daily_cache` for your test user (or wait for a new US date).
2. Ensure `card_pool` has >= 12 cards across multiple categories for your test location.
3. Open the Discover tab → For You.
4. Verify: 2 hero cards render (Fine Dining + Play). 10 grid cards render with diverse categories (check the console logs for category assignments).
5. Kill the app and reopen. Verify: cached data loads and hero cards still render as 2 cards (not fallback single card).
6. Change preferences (to reset impression boundary). Re-open For You. Verify: new cards appear, still diverse.

---

## 8. Test Cases

| # | Test | Input | Expected Output | Layer |
|---|------|-------|-----------------|-------|
| 1 | Pool has 20+ cards, all categories represented | Pool populated with 2+ cards per category | `heroCards`: 2 cards (Fine Dining + Play). `cards`: 10 cards, each from a unique non-hero category. | Edge Function |
| 2 | Pool has 20+ cards, Fine Dining missing | Pool populated but no Fine Dining cards | `heroCards`: 1 card (Play only). `cards`: 10 cards from 10 non-hero categories. `featuredCard`: the Play hero card. | Edge Function |
| 3 | Pool has 20+ cards, both hero categories missing | Pool populated but no Fine Dining or Play cards | `heroCards`: empty array. `cards`: 10 cards from 10 categories. `featuredCard`: first grid card. | Edge Function |
| 4 | Pool has 8 cards, only 4 categories | Pool with 2 Nature, 2 Drink, 2 Casual Eats, 2 Wellness | `heroCards`: empty (no Fine Dining/Play). `cards`: 4 cards (one per available category), then 4 more from remaining pool cards. | Edge Function |
| 5 | Pool has < 8 cards | Pool with 5 cards | Pool-first early return does NOT trigger. Falls through to Google API path (which already works correctly). | Edge Function |
| 6 | Client cache round-trip: heroCards persisted | API returns 2 hero cards, client saves to cache | `DiscoverCache` in AsyncStorage contains `heroCards` array with 2 entries. On reload, `selectedHeroCards` is set to those 2 entries. | Client Cache |
| 7 | Client cache backward compat: old cache without heroCards | Cache from before this fix (no `heroCards` field) | `cachedData.heroCards || []` returns `[]`. `selectedHeroCards` stays empty. Falls back to single `featuredCard`. No crash. | Client Cache |
| 8 | Re-randomization useEffect skips when heroes set | API fetch sets `selectedHeroCards` to 2 cards, then `recommendations` changes | `useEffect` detects `selectedHeroCards.length > 0` and returns early. Hero cards remain the API-set values. | Client Component |
| 9 | Re-randomization useEffect runs when heroes empty | No API fetch yet, `recommendations` populated from old code path | `selectedHeroCards.length === 0` — `useEffect` runs its existing random-hero logic. Single hero card selected as before. | Client Component |
| 10 | Server-side daily cache hit returns heroCards | Second request same user same day | Cache hit at line 287–312 returns `heroCards` from `generated_location.heroCards`. Client receives 2 hero cards. | Edge Function + Cache |
| 11 | Full end-to-end: pool path → render → cache → reload | User opens For You (pool path triggers) → sees 2 heroes + 10 diverse grid → kills app → reopens | First load: 2 heroes + 10 diverse grid. Second load from cache: same 2 heroes + same 10 grid cards. | Full Stack |

---

## 9. Common Mistakes to Avoid

1. **Modifying the Google API fallback path (lines 396–647):** This path already works correctly. Do not touch it. The fix is ONLY in the pool-first early return block (lines 367–388). If you modify the Google path, you risk breaking the working code.

2. **Adding `selectedHeroCards` to the `useEffect` dependency array at line 1784:** The guard reads `selectedHeroCards.length` but must NOT be in the dependency array. Adding it would create an infinite loop: useEffect sets cards → state changes → useEffect re-runs → sets cards again.

3. **Forgetting the `|| []` default for `cachedData.heroCards`:** Old cached data (from before this fix) will not have a `heroCards` field. Every access must use `cachedData.heroCards || []` to avoid `undefined` errors. This applies in `applyCachedDiscoverData` and anywhere else `heroCards` is read from cache.

4. **Assuming `poolResult.cards` always has a `.category` field:** The `serveCardsFromPipeline` function returns cards via `poolCardToApiCard()`, which DOES set `category: card.category`. However, the `card_pool` table's `category` field is nullable. If a card was stored without a category, the round-robin will skip it. This is acceptable — such cards will be picked up in the fill pass (PASS 3). Do NOT add a fallback category assignment.

5. **Persisting the pool early-return to `discover_daily_cache` without `heroCards` in `generated_location`:** The new code in §5.1 writes `generated_location.heroCards` to the daily cache. If you forget this, the server-side cache hit (lines 287–312) will return `heroCards: []` on subsequent requests the same day, losing the hero cards even though the first request was correct.

---

## 10. Handoff to Implementor

Implementor: this document is your single source of truth. Execute it top to bottom, in the exact order specified in §7. Do not skip steps. Do not reorder steps. Do not add features, refactor adjacent code, or "improve" anything outside the scope of this spec. Every code replacement in this document is intentional and exact — copy it precisely. The Google API fallback path must not be modified. The only files you touch are:

1. `supabase/functions/discover-experiences/index.ts` (lines 367–388 only)
2. `app-mobile/src/components/DiscoverScreen.tsx` (4 surgical changes at lines 141, 1210, 1367, and 1664)

When you are finished, produce your IMPLEMENTATION_REPORT.md referencing each section of this spec to confirm compliance, then hand the implementation to the tester. Your work is not done until the tester's report comes back green.
