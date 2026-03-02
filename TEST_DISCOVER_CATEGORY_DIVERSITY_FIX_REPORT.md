# Test Report: Discover Category Diversity Fix
**Date:** 2026-03-02
**Spec:** FEATURE_DISCOVER_CATEGORY_DIVERSITY_FIX_SPEC.md
**Implementation:** IMPLEMENTATION_DISCOVER_CATEGORY_DIVERSITY_FIX_REPORT.md (Remediation Pass)
**Tester:** Brutal Tester Skill
**Verdict:** CONDITIONAL PASS — code is correct, deployment required

---

## Executive Summary

**Re-test after remediation pass.** The implementor addressed all 4 mandatory findings from the initial test report. The duplicate React key error is fixed (`` key={`${card.id}-${index}`} `` at line 3400). The client cache version is bumped (v3->v4, daily v2->v3) to invalidate stale pre-fix data. The edge function diversity algorithm and all 4 original client-side spec changes were verified correct and unchanged from the initial review. **All code is now correct.** The remaining blocker is operational: the edge function must be committed, deployed to Supabase, and the server-side daily cache must be cleared. Until that happens, the fix is not live.

---

## Remediation Verification

### CRIT-001 (Edge function not deployed) — ADDRESSED
**Status:** Code confirmed correct. Ready for commit + deploy.

The 3-pass diversity algorithm at lines 367-469 of `discover-experiences/index.ts` is verified:
- PASS 1 (lines 377-391): Extracts Fine Dining + Play hero cards via `HERO_CATEGORIES` filter, tracks in `usedIds` + `usedCategories`
- PASS 2 (lines 393-408): Round-robins one card per non-hero category from `categoriesToFetch`, skips heroes and already-used categories
- PASS 3 (lines 410-418): Fills remaining grid slots from unused pool cards
- Response (lines 450-469): Returns `heroCards`, `cards`, `featuredCard`, and full `meta` with category tracking
- Daily cache write (lines 423-448): Persists `heroCards` in `generated_location` for server-side cache hits

**Remaining action:** `git add` + `git commit` + `supabase functions deploy discover-experiences` + `DELETE FROM discover_daily_cache WHERE us_date_key = '2026-03-02'`

---

### CRIT-002 (Stale caches prevent fix visibility) — FIXED

**Verified at:**
- Line 45: `const DISCOVER_CACHE_KEY = "mingla_discover_cache_v4";` (was v3)
- Line 46: `const DISCOVER_DAILY_CACHE_KEY = "mingla_discover_cache_daily_v3";` (was v2)

**Why this works:** `getDiscoverExactCacheKey` (line 151) and `getDiscoverDailyCacheKey` (line 157) both compose keys from these constants. Bumping the version creates entirely new key names. All existing AsyncStorage entries under v3/daily_v2 are orphaned and never looked up. On next app load:
1. `getDiscoverCacheFromMemory()` returns null (Map is empty on fresh load)
2. `loadDiscoverCache()` reads AsyncStorage with new key -> returns null
3. Cache miss triggers fresh `discoverExperiences()` call to edge function
4. Edge function runs diversity algorithm -> returns diverse cards + heroCards

The in-memory `discoverSessionCache` (Map at line 149) is module-scoped and re-created empty on app restart. Hot reload also resets it. No stale data can persist.

**Server-side cache** still needs manual clearing: `DELETE FROM discover_daily_cache WHERE us_date_key = '2026-03-02'`. This is a one-time operation after deployment.

---

### HIGH-001 (Duplicate React keys) — FIXED

**Verified at line 3400:**
```typescript
key={`${card.id}-${index}`}
```
Was: `key={card.id}` which caused duplicate keys when `card_pool` had multiple rows with the same `google_place_id`.

This fix is defense-in-depth. The diversity algorithm's `usedIds` tracking (lines 375, 385, 405, 416) also prevents duplicate `id` values in the output. But the index-appended key ensures React never gets a key collision regardless of data quality.

**Root cause (tech debt, not blocking):** `card_pool` has no UNIQUE constraint on `(google_place_id, category)`. `insertCardToPool` uses plain INSERT. Multiple rows for the same place accumulate. This should be fixed separately.

---

### HIGH-002 (Code-trace-only verification) — ACKNOWLEDGED

The implementor's remediation report (§5) explicitly states: "Deployment Verification (REQUIRED -- Not Yet Done)" with a 6-step checklist. This is the correct approach. Verification will happen after deployment, not before.

---

## Full Code Verification Matrix

### Edge Function (`discover-experiences/index.ts`)

| Check | Line(s) | Result | Evidence |
|-------|---------|--------|----------|
| PASS 1: Hero extraction (Fine Dining + Play) | 371-391 | PASS | Filters by `HERO_CATEGORIES`, tracks in `usedIds` + `usedCategories` |
| PASS 2: Round-robin one per category | 393-408 | PASS | Iterates `categoriesToFetch`, skips heroes + used categories, caps at 10 |
| PASS 3: Fill remaining from pool | 410-418 | PASS | Filters by `!usedIds.has(c.id)`, fills up to 10 |
| `heroCards` in response JSON | 453 | PASS | `heroCards: poolHeroCards` |
| `heroCards` in daily cache write | 443 | PASS | `heroCards: poolHeroCards` inside `generated_location` |
| `featuredCard` backward compat | 421 | PASS | `poolHeroCards[0] \|\| poolGridCards[0] \|\| null` |
| Server cache hit returns `heroCards` | 297 | PASS | `matchingRow.generated_location?.heroCards \|\| []` |
| Google API fallback path untouched | 477+ | PASS | Lines 477-728 unchanged, verified no edits |

### Client (`DiscoverScreen.tsx`)

| Check | Line(s) | Result | Evidence |
|-------|---------|--------|----------|
| `DiscoverCache.heroCards` field | 146 | PASS | `heroCards: FeaturedCardData[]` |
| `saveDiscoverCache` 4th param | 1215 | PASS | `heroCards: FeaturedCardData[] = []` |
| `saveDiscoverCache` call site | 1601 | PASS | `saveDiscoverCache(transformed, finalFeatured, gridCards, transformedHeroes)` |
| `applyCachedDiscoverData` restores heroes | 1377-1381 | PASS | `cachedData.heroCards \|\| []` -> `setSelectedHeroCards()` |
| `useEffect` guard | 1691 | PASS | `selectedHeroCards.length > 0` returns early |
| `useEffect` dependency array | 1801 | PASS | `[recommendations]` only -- no `selectedHeroCards` |
| Cache key bumped (exact) | 45 | PASS | `mingla_discover_cache_v4` |
| Cache key bumped (daily) | 46 | PASS | `mingla_discover_cache_daily_v3` |
| Duplicate key fix | 3400 | PASS | `` key={`${card.id}-${index}`} `` |
| Hero cards rendering key | 3360 | PASS | `key={heroCard.id}` (heroes are deduplicated by `usedIds`) |

### Service Layer (`experienceGenerationService.ts`)

| Check | Line(s) | Result | Evidence |
|-------|---------|--------|----------|
| `heroCards` parsed from response | 209 | PASS | `(data.heroCards \|\| []).map(transformToGeneratedExperience)` |
| `featuredCard` fallback chain | 214-216 | PASS | `heroCards[0] \|\| data.featuredCard` |
| Return shape includes `heroCards` | 218 | PASS | `{ cards, heroCards, featuredCard }` |

---

## Spec Compliance Matrix

| # | Success Criterion | Code Correct? | Needs Deploy? | Evidence |
|---|-------------------|--------------|---------------|----------|
| 1 | Pool >= 12: 2 heroes + 10 diverse grid | YES | YES | 3-pass algorithm at lines 367-469 |
| 2 | Missing categories: graceful degradation | YES | YES | PASS 3 fill logic handles gaps |
| 3 | Pool-first returns `heroCards` | YES | YES | Line 453 |
| 4 | Client cache persists `heroCards` | YES | NO (client-side, hot reloads) | Lines 1215, 1226, 1377-1381 |
| 5 | useEffect guard | YES | NO | Line 1691 |
| 6 | Google API path untouched | YES | N/A | Lines 477+ verified unchanged |
| 7 | No new functions/tables/columns | YES | N/A | Zero new files |

All 7 criteria are code-correct. 3 require edge function deployment to be verifiable at runtime.

---

## Remaining Issues

### MED-001: `any` types in diversity algorithm (NOT FIXED — acceptable)
Lines 372, 380, 399, 412 use `any`. Matches existing file-wide pattern. Spec provided `any` explicitly. Not blocking.

### MED-002: `adminClient!` non-null assertion (NOT FIXED — acceptable)
Line 431. Safe due to outer guard. Low priority.

### TECH DEBT: `card_pool` deduplication
No UNIQUE constraint on `(google_place_id, category)`. `insertCardToPool` uses plain INSERT. Duplicate rows accumulate. The diversity algorithm and `key={...index}` fix mask this, but other pool consumers remain vulnerable. Track for future fix.

---

## What Was Done Right

1. **Remediation was surgical.** Only 2 lines changed (key fix + cache bump). No scope creep, no unnecessary refactoring.
2. **Cache version bump is self-healing.** No user action needed. Old caches are silently orphaned on next app load.
3. **Implementor explicitly documented deployment is required.** The remediation report (§5) lists deployment verification as "REQUIRED -- Not Yet Done" with a 6-step checklist. This is honest and actionable.
4. **All original spec changes remain correct.** The 4 client-side changes and edge function algorithm were verified untouched and correct.

---

## Deployment Checklist (Required Before Final PASS)

| Step | Command / Action | Purpose |
|------|-----------------|---------|
| 1 | `git add supabase/functions/discover-experiences/index.ts app-mobile/src/components/DiscoverScreen.tsx` | Stage all changes |
| 2 | `git commit` | Commit the fix |
| 3 | `supabase functions deploy discover-experiences` | Deploy edge function to live |
| 4 | `DELETE FROM discover_daily_cache WHERE us_date_key = '2026-03-02'` | Clear stale server cache |
| 5 | Open Discover -> For You in app | Verify 2 hero cards + 10 diverse grid |
| 6 | Check console for no `Encountered two children with the same key` error | Verify duplicate key fix |
| 7 | Kill app, reopen -> verify cached data loads with heroes | Verify cache persistence |

---

## Verdict Justification

**CONDITIONAL PASS** -- All code changes are correct and verified. No critical or high-severity code defects remain. The duplicate React key error is fixed. The stale cache problem is fixed via version bump. The diversity algorithm is sound.

**Condition:** The edge function MUST be deployed to Supabase and the server-side daily cache MUST be cleared before this can be considered fully passing. These are operational steps, not code defects. Once the 7-step deployment checklist above is completed and visually confirmed, this is a full PASS.

If the user still sees all-Nature cards after completing all 7 steps, re-open as a new investigation -- the issue would then be in `serveCardsFromPipeline`'s pool query or the `card_pool` data itself, not in this fix.
