# Troubleshoot: Only 3 Cards on Initial App Landing

## Executive Summary

On initial app load, the user sees **3 cards instead of ~20**. The 3 cards are composed of **2 curated priority cards + 1 regular recommendation card** (or 0 regular + the visual count appearing as 3 due to interleaving). The remaining ~17 curated cards from the background batch **never arrive in the UI** — either because the background edge-function call is failing/timing out, or due to a one-render premature-settlement window that can silently swallow the update. Below is a full technical breakdown.

---

## 1. Architecture Overview: The Two-Query Split

`useCuratedExperiences.ts` splits what was originally a single 20-card fetch into two parallel edge-function calls:

| Query | Limit | `skipDescriptions` | Purpose |
|-------|-------|--------------------|---------|
| **Priority** | `PRIORITY_LIMIT = 2` | `true` (no OpenAI) | Fast ~1-2s return, unblocks spinner |
| **Background** | `BACKGROUND_LIMIT = 18` | `false` (calls OpenAI per card) | Silent load, cards should appear as user swipes |

Both hit `generate-curated-experiences` edge function independently. Both pull from the same **`curated_places_cache`** table (24h TTL, keyed on lat/lng bucket + radius).

---

## 2. Render-by-Render Timeline of Initial Load

### Render 1-3: Bootstrapping
- Location loads → preferences load → queries become enabled.
- `recommendations = []`, `loading = true` → user sees spinner.

### Render 4: Priority Batch Arrives (~1-2s)
- `priorityQuery.data = [Card1, Card2]` (2 curated cards)
- `priorityQuery.isLoading = false` → **background query becomes enabled** (`enabled` depends on `!priorityQuery.isLoading`)
- `isLoadingCuratedSolo = false`

**Critical: In THIS same render:**
- Background query is now enabled but TanStack Query hasn't started the HTTP request yet.
- `backgroundQuery.isFetching = false` (hasn't started)
- `backgroundQuery.isError = false`
- Therefore: `backgroundSettled = !false || false = true`
- Therefore: `prioritySettled = !false || false = true`
- **`isFullBatchLoaded = true`** ← PREMATURE!
- Other 4 hooks are disabled → their `isFullBatchLoaded = true`
- **`allCuratedBatchesLoaded = true`** ← PREMATURE!

### Render 5: Regular Recommendations Arrive
- `recommendationsData = [RegCard1]` (or `[]` if user has no non-intent categories)
- `loading = false` → spinner clears
- Sync effect fires:
  - `curatedRecommendations` = 2 shuffled curated cards (from priority)
  - `regularCards` = [0-1 regular cards]
  - `merged = interleaveCards(regularCards, curatedRecommendations)` → curated first, then regular = **3 total cards**
  - `setRecommendations(merged)` → **UI shows 3 cards, no spinner**
  - `isBatchTransitioning` is `false` on initial load, so the premature `allCuratedBatchesLoaded = true` doesn't cause direct harm HERE — but see Section 4.

### Render 6: Background Fetch Starts (next tick)
- TanStack Query starts the HTTP request → `backgroundQuery.isFetching = true`
- `isFullBatchLoaded = false` (corrected)
- `allCuratedBatchesLoaded = false`
- No new data → sync effect: `hasChanged = false` → skipped
- User still sees 3 cards

### Render 7+ (if background succeeds, ~10-30s later):
- `backgroundQuery.data = [Bg1..Bg18]`
- Client-side dedup filters places overlapping with priority → ~16 unique background cards
- `cards` useMemo → `[Card1, Card2, Bg1..Bg16]` = ~18 cards
- `bestCardsRef.current` updated to 18
- `allCuratedCards` grows 2→18 → `curatedRecommendations` memo dependency changes → recalculates (shuffled 18)
- Sync effect fires → `curatedChanged = true` → `setRecommendations(merged)` → **~19 cards**

### Render 7+ (if background FAILS after all retries):
- `backgroundQuery.data = undefined` (no previous data on initial load)
- `backgroundQuery.isError = true`
- `background = backgroundQuery.data ?? [] = []`
- `merged = priority = [Card1, Card2]`
- `bestCardsRef.current` stays at `[Card1, Card2]` (2 ≥ 2)
- `cards` unchanged → `curatedRecommendations` unchanged → sync effect: `hasChanged = false`
- **User permanently stuck at 3 cards**

---

## 3. Root Cause #1 — Background Query Failure (Most Likely)

### Why the Background Query Fails

The background batch asks the edge function to generate **18 cards with AI descriptions** (`skipDescriptions = false`). Each card's `resolvePairingFromCategories` call invokes `generateStopDescriptions()`, which makes a call to **OpenAI `gpt-4o-mini`** (400 max tokens, temperature 0.8).

The card-building loop processes in batches of `PARALLEL_BATCH = Math.min(limit + 2, 6) = 6`:

```
While cards.length < 18:
  Pick next 6 category combinations
  Call resolvePairingFromCategories × 6 in parallel
    → Each: pick 3 places, validate budget/travel, OpenAI description call
  Push successes to cards array
```

**Estimated time for 18 cards:**
- Places fetch: ~0s (cached) to ~5-10s (cold cache, 9 categories × 5 place-type queries each = 45 Google API calls)
- Per batch of 6: ~2-4s (OpenAI gpt-4o-mini latency)
- Need ~3-6 batches (some combos fail budget/travel validation) = **~6-24s for OpenAI alone**
- Total: **~10-30s** on a good run

**Failure modes:**
1. **Supabase Edge Function timeout** — Default 60s (free tier), but Deno Deploy cold starts can eat 5-10s
2. **OpenAI rate limiting/throttling** — 18 parallel-ish calls to gpt-4o-mini
3. **Google Places API quota exhaustion** — If cache is cold, 45 API calls
4. **Network timeout on the React Native client** — `supabase.functions.invoke()` uses `fetch()` with no explicit timeout; React Native's default is platform-dependent (~60s iOS, ~30s Android)
5. **Many combinations fail validation** — If most 3-category combos exceed budget or travel constraints, the loop exhausts all 84 combinations before reaching 18 cards. The function returns fewer cards (maybe 5-10), and those DO arrive. If it returns 0, background merges to 0 and anti-regression keeps priority's 2.

**The killer detail:** Priority uses `skipDescriptions: true`, which replaces OpenAI with a template string (`"${placeName} — a great ${placeType} spot..."`). This is ~100ms vs ~2-4s per card. Background doesn't skip descriptions. **The previous code (before the priority/background split) may have been using `skipDescriptions: true` for ALL cards, making 20 cards fast. The split introduced AI descriptions only for background, making it dramatically slower.**

### Evidence
- Priority (2 cards, no AI) → succeeds consistently in ~1-2s
- Background (18 cards, WITH AI) → unreliable, times out or takes >30s
- With `retry: 2`, TanStack tries 3 times total. Each attempt = full edge function execution. 3 × 30s = 90s of retrying before giving up.

---

## 4. Root Cause #2 — `isFullBatchLoaded` Premature True Window

**Location:** `useCuratedExperiences.ts` lines 155-160

```typescript
const backgroundSettled = !backgroundQuery.isFetching || backgroundQuery.isError;
const prioritySettled = !priorityQuery.isFetching || priorityQuery.isError;
const isFullBatchLoaded = prioritySettled && backgroundSettled;
```

When priority succeeds and background is newly enabled but hasn't started fetching:
- `backgroundQuery.isFetching = false` → `backgroundSettled = true`
- `prioritySettled = true`
- **`isFullBatchLoaded = true` for one render frame**

This feeds into `allCuratedBatchesLoaded` in RecommendationsContext:
```typescript
const allCuratedBatchesLoaded =
    isSoloBatchLoaded && isDateBatchLoaded && isRomBatchLoaded &&
    isFriendBatchLoaded && isGroupBatchLoaded;
```

On initial load, `isBatchTransitioning = false`, so the premature `allCuratedBatchesLoaded = true` doesn't cause visible harm. **But during "Generate Another 20"** (where `isBatchTransitioning = true`), this premature `true` clears `isBatchTransitioning` before background has even started, dropping the spinner while only 2 priority cards are visible.

---

## 5. Root Cause #3 — Regular Recommendations Return 0-1 Cards

**Location:** `experienceGenerationService.ts` lines 90-102

```typescript
const experienceTypeIds = new Set([
    "solo-adventure", "first-dates", "romantic", "friendly", "group-fun", "business"
]);
const filteredCategories = request.preferences.categories
    ? request.preferences.categories.filter(category => !experienceTypeIds.has(category))
    : request.preferences.categories;
```

User's `categories` array stores **both** intent IDs and regular categories. E.g.:
- `["solo-adventure", "Nature"]` → filtered to `["Nature"]` → 1 category sent to `new-generate-experience-`
- `["solo-adventure"]` → filtered to `[]` → 0 categories → **0 regular cards**

**In `new-generate-experience-/index.ts` line 2325:**
```typescript
for (const category of preferences.categories || []) {
    // fetch places for this category
}
```

Empty array = zero iterations = zero places = **zero regular cards**.

If the user has exactly 1 non-intent category → regular query returns 1 card.
**Total = 2 curated (priority) + 1 regular = 3 cards.**

---

## 6. Root Cause #4 — Client-Side Dedup Can Eliminate Background Cards

**Location:** `useCuratedExperiences.ts` lines 128-142

```typescript
const usedPlaceIds = new Set<string>();
for (const card of priority) {
    for (const stop of card.stops ?? []) {
        if (stop.placeId) usedPlaceIds.add(stop.placeId);
    }
}
const uniqueBackground = background.filter(
    (card) => !(card.stops ?? []).some((s) => usedPlaceIds.has(s.placeId))
);
merged = [...priority, ...uniqueBackground];
```

Priority and background are **independent edge function invocations** — each with its own `usedPlaceIds` Set. They both pull from the same cached places pool (9 categories × 20 places = ~180 places). Priority uses 6 places (2 cards × 3 stops). Background also generates from the same pool.

**Overlap probability per background card:** `1 - (174/180 × 173/179 × 172/178) ≈ 9.8%`

For 18 background cards: ~1-2 get filtered out. This is NOT the primary cause (reduces 18 to ~16, not to 0), but it compounds the issue if background only partially succeeds (e.g., returns 5 cards instead of 18, and 1 gets deduped → 4 extra cards).

---

## 7. The Full Picture

```
Initial load timeline:
───────────────────────────────────────────────────
T=0s     Location + preferences loaded
T=0.1s   Priority query fires (solo-adventure, limit=2, skipDescriptions=true)
         Regular recommendations query fires
T=1-2s   Priority returns [Card1, Card2]          ← 2 curated cards
         Background query ENABLED (but hasn't started yet)
         isFullBatchLoaded = TRUE (premature!)
T=2-4s   Regular recommendations return [RegCard1] ← 1 regular card
         Sync effect: setRecommendations([Card1, Card2, RegCard1])
         ════════════════════════════════════════════
         USER SEES 3 CARDS — spinner gone, no loading indicator
         ════════════════════════════════════════════
T=2.1s   Background query starts fetching (18 cards WITH OpenAI)
         isFullBatchLoaded = FALSE (corrected)
T=10-30s Background query either:
         ✅ SUCCEEDS → cards grow from 3 to ~19  (user may not notice if already swiped)
         ❌ FAILS    → cards stay at 3 forever (silent failure, no UI feedback)
T=30-90s If failed, retries (retry:2) → adds more wait time
         All retries fail → PERMANENTLY stuck at 3 cards
```

---

## 8. Why This Worked Before the Previous Fix

The previous fix session didn't introduce the priority/background split — that already existed. But the previous changes to `RecommendationsContext.tsx` added `allCuratedBatchesLoaded` to the sync effect's dependency array:

```tsx
}, [
    recommendationsData,
    curatedRecommendations,
    ...
    allCuratedBatchesLoaded,  // ← ADDED in previous fix
]);
```

This causes the sync effect to re-fire when `allCuratedBatchesLoaded` flips `true → false → true`. While this shouldn't block data flow (the effect early-returns on `!hasChanged`), it introduces an extra re-execution window. Combined with the premature `isFullBatchLoaded = true` window, it can cause the effect to "see" and lock in the 3-card state right at the moment where priority is done but background hasn't started.

The more likely explanation is simple: **the background query was ALREADY failing intermittently before**, but the user didn't report it as clearly because other factors masked it (e.g., cached stale data from previous sessions, or the user just waited longer). The previous fix didn't make the background fail — it just made the consequence more visible by:
1. Properly clearing the spinner only when all batches are loaded
2. Not showing stale placeholder data during initial load

---

## 9. Verification Steps

To confirm the diagnosis:

1. **Check edge-function logs** (Supabase Dashboard → Edge Functions → `generate-curated-experiences` → Logs):
   - Look for background calls (limit=18, skipDescriptions=false)
   - Check if they complete or timeout
   - Look for `[solo-adventure] Generated X unique cards out of Y attempted combinations`

2. **Add console.log to `useCuratedExperiences.ts`** (temporarily):
   ```typescript
   console.log('[curated-bg] isFetching:', backgroundQuery.isFetching,
     'isError:', backgroundQuery.isError,
     'data length:', backgroundQuery.data?.length,
     'status:', backgroundQuery.status);
   ```

3. **Check React Native network tab** (Flipper/React Native Debugger):
   - Verify two calls to `generate-curated-experiences` are made
   - Check response status and timing for the second (background) call

4. **Check user's categories** (Supabase → `user_preferences` table):
   - If `categories = ["solo-adventure"]` → 0 regular cards (confirms the "1" is from something else)
   - If `categories = ["solo-adventure", "Nature"]` → 1 regular card → total 3

---

## 10. Summary of All Contributing Factors

| # | Factor | Severity | Impact |
|---|--------|----------|--------|
| 1 | Background query fails/times out (18 cards + OpenAI) | **HIGH** | Permanently stuck at 2-3 curated cards |
| 2 | Regular recommendations return 0-1 cards (intent-only categories) | **MEDIUM** | Only 0-1 non-curated cards available |
| 3 | `isFullBatchLoaded` premature true window | **LOW** | Cosmetic on initial load; harmful during batch transitions |
| 4 | Client-side dedup removes some background cards | **LOW** | Reduces ~18 to ~16, not a showstopper |
| 5 | No loading indicator for background batch | **MEDIUM** | User has no feedback that more cards are coming |
| 6 | `allCuratedBatchesLoaded` in sync effect deps | **LOW** | Extra re-executions, but data flow is correct |

**Primary diagnosis: The background edge-function call is either timing out or erroring, leaving the user with only the 2-card priority batch plus 0-1 regular recommendation cards = 3 total.**
