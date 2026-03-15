# Test Report: Four Fixes (Instant Prefs, Pool Fallback, DateTime Filter, Exact Time)
**Date:** 2026-03-15
**Tester:** Brutal Tester Skill
**Verdict:** CONDITIONAL PASS

---

## Executive Summary

Four fixes spanning 4 files were reviewed: instant preference save (PreferencesSheet, AppHandlers, preferencesService), place_pool fallback, date/time filtering for pool cards, and exact_time wiring. The preference save refactor is clean and well-motivated. The edge function changes introduce a valuable place_pool fallback but have **two confirmed filter-consistency gaps** (two code paths skip the new time filter entirely) and a **confirmed overnight-hours bug** that will silently drop all late-night venues crossing midnight. No critical security issues found.

---

## Test Manifest

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| TypeScript Compliance | 4 files | 4 | 0 | 1 |
| Pattern Compliance | 4 files | 3 | 0 | 1 |
| Security | 4 files | 4 | 0 | 0 |
| React Query & State | 3 files | 1 | 1 | 1 |
| Edge Function Logic | 1 file | 3 | 3 | 1 |
| **TOTAL** | **16** | **15** | **4** | **4** |

---

## CRIT-001: Two Pipeline Paths Skip `filterByDateTime` Entirely

**Files:** `supabase/functions/discover-cards/index.ts` (lines 577-601 and 607-632)
**Category:** Logic Consistency / Incomplete Fix
**Severity:** HIGH (promoted from medium due to user-facing impact)

**What's Wrong:**

Fix 3 correctly added `filterByDateTime` to the main pool-serve path (line 504) and the place_pool fallback (line 747). However, **two other return paths** still serve cards WITHOUT any date/time filtering:

1. **Expanded pool path** (lines 577-601): When pool is exhausted at an offset, the code fetches next-page tokens and retries. The retry result at line 582 returns `retryResult.cards` directly — no `filterByDateTime` call.

2. **Pipeline-mixed path** (lines 607-632): When `poolResult.fromApi > 0`, it scores and returns cards — no `filterByDateTime` call.

Both paths return cards that may be closed at the user's requested time.

**Evidence:**
```typescript
// Line 577-582 — expanded pool path: NO filterByDateTime
if (retryResult.cards.length > 0) {
  return new Response(JSON.stringify({
    cards: retryResult.cards, // ← unfiltered
    ...
  }));
}

// Line 607-609 — mixed path: NO filterByDateTime
const scoredMixedCards = scorePoolCards(poolResult.cards); // ← unfiltered
return new Response(JSON.stringify({
  cards: scoredMixedCards,
  ...
}));
```

**Required Fix:**
Add `filterByDateTime` before `scorePoolCards` on both paths:
- Line 577: `const timeFiltered = filterByDateTime(retryResult.cards, datetimePref, dateOption, timeSlot, _exactTime);` then return `timeFiltered`
- Line 609: `const timeFilteredMixed = filterByDateTime(poolResult.cards, datetimePref, dateOption, timeSlot, _exactTime);` then pass to `scorePoolCards`

**Why This Matters:**
Users selecting "Dinner" or a specific time will see closed venues when cards come through these two paths. This undermines the entire purpose of Fix 3.

---

## CRIT-002: Overnight Hours Bug — Places Open Past Midnight Always Filtered Out

**File:** `supabase/functions/discover-cards/index.ts` (lines 162-241)
**Category:** Logic Error
**Severity:** HIGH

**What's Wrong:**

Both `parseHoursText` (Path B) and the existing periods logic (Path A) fail when a venue's hours cross midnight (e.g., bar open 5 PM - 2 AM).

**Path B (new code):** `parseHoursText("5:00 PM - 2:00 AM")` returns `{ open: 17, close: 2 }`. The filter check at line 236 is `targetHourStart >= 17 && targetHourStart < 2`, which is **mathematically impossible** — always false.

**Path A (pre-existing, same bug):** When Google periods has `open.hour = 17, close.hour = 2`, `effectiveClose = 2` (not 0, so no adjustment), and the check at line 224 is `targetHourStart >= 17 && targetHourStart < 2` — also always false.

**Impact:** The `lateNight` time slot (21-24) is explicitly supported. Users choosing it will see NO bars, clubs, or late-night restaurants whose stated closing time is after midnight (1 AM, 2 AM, 3 AM, etc.). These are exactly the most relevant venues for that slot.

**Evidence:**
```typescript
// parseHoursText("5:00 PM - 2:00 AM")
// → { open: 17, close: 2 }
//
// filterByDateTime with lateNight slot → targetHourStart = 21
// Check: 21 >= 17 && 21 < 2  →  true && false  →  FALSE
// Venue is incorrectly excluded
```

**Required Fix:**
Handle wraparound in both paths. When `close <= open`, the venue spans midnight:
```typescript
// In the filter check:
if (effectiveClose <= openHour) {
  // Spans midnight: open at 17, close at 2 means open 17-24 OR 0-2
  return targetHourStart >= openHour || targetHourStart < effectiveClose;
} else {
  return targetHourStart >= openHour && targetHourStart < effectiveClose;
}
```
Apply the same logic in both Path A (line 224) and Path B (line 236).

**Why This Matters:**
Late-night venues are a core use case for Mingla's discovery. This bug silently empties the results for exactly the users who need them most — nightlife seekers.

---

## HIGH-001: Race Condition — Optimistic Cache Overwritten by Stale Server Fetch

**Files:** `PreferencesSheet.tsx` (lines 751-757), `AppHandlers.tsx` (lines 633-650)
**Category:** Race Condition / State Consistency
**Severity:** HIGH (suspected, timing-dependent)

**What's Wrong:**

The execution order is:
1. PreferencesSheet calls `onClose()` (line 751)
2. PreferencesSheet calls `invalidateQueries(["userPreferences"])` (line 756) — triggers background refetch from DB
3. PreferencesSheet starts async IIFE, which calls `onSave(preferences)` (line 792)
4. `handleSavePreferences` calls `setQueryData(["userPreferences", user.id], newData)` (line 633) — optimistic update
5. Background refetch from step 2 resolves with OLD DB data → **overwrites** the optimistic update from step 4
6. DB write (fire-and-forget) eventually completes — but cache already has stale data

React Query's `invalidateQueries` with fuzzy matching will match `["userPreferences", user.id]`. The background refetch will race against the `setQueryData` call. Since the DB write is fire-and-forget and the refetch goes directly to Supabase, the refetch will almost certainly resolve with stale data.

**Impact:** Any component reading from `usePreferencesData` (React Query) may briefly show stale preferences after saving. The deck reads preferences from the edge function call params (built from local state), so the immediate deck behavior is likely fine. But any UI showing current preferences could flicker.

**Required Fix:**
Either:
- (A) Remove `invalidateQueries(["userPreferences"])` from PreferencesSheet — the `setQueryData` in AppHandlers is the source of truth, and a server refetch should only happen after the DB write completes.
- (B) Move the `setQueryData` call BEFORE the invalidation by having AppHandlers' `handleSavePreferences` be called synchronously before the cache invalidation in PreferencesSheet.
- (C) Use React Query's `cancelQueries` before `setQueryData` to prevent in-flight refetches from overwriting the optimistic data.

**Why This Matters:**
Preferences that appear to revert momentarily after saving is a confusing UX. Users may think their save didn't work and re-open the preferences sheet.

---

## HIGH-002: Place Pool Fallback Missing User Price Tier Filter

**File:** `supabase/functions/discover-cards/index.ts` (lines 640-771)
**Category:** Missing Filter
**Severity:** HIGH

**What's Wrong:**

The place_pool fallback queries places by geographic bounding box and type overlap, but does NOT filter by the user's selected `priceTiers`. The Google API path (lines 926-933) applies price tier filtering. The `scorePoolCards` function filters by CATEGORY minimum price floor (`CATEGORY_MIN_PRICE_TIER`), but this is a per-category minimum — not the user's selected tiers.

A user who selected only "chill" (budget) tier will receive "lavish" (expensive) places from the place_pool fallback.

**Evidence:**
```typescript
// Google API path (line 928) — filters by user priceTiers:
if (priceTiers && priceTiers.length > 0 && priceTiers.length < 4) {
  allPlaces = allPlaces.filter(p => { ... });
}

// Place pool fallback (line 654) — NO priceTier filter:
const { data: places } = await supabaseAdmin
  .from('place_pool')
  .select(...)
  .overlaps('types', placeTypes)
  // ← no .in('price_tier', priceTiers)
```

**Required Fix:**
Add price tier filtering to the place_pool query:
```typescript
let query = supabaseAdmin.from('place_pool').select(...)...;
if (priceTiers && priceTiers.length > 0 && priceTiers.length < 4) {
  query = query.in('price_tier', priceTiers);
}
```
Or filter in-memory after building `placePoolCards`, before `filterByDateTime`.

---

## MED-001: Offline Cache Fetches From DB Before Write Completes

**File:** `PreferencesSheet.tsx` (lines 800-806)
**Category:** Timing / Data Freshness
**Severity:** MEDIUM

**What's Wrong:**

After the fire-and-forget DB write, the offline cache update calls `PreferencesService.getUserPreferences(user.id)` to fetch preferences from the database. But since the DB write is fire-and-forget and hasn't completed yet, this fetch will return the OLD preferences, caching stale data for offline use.

**Required Fix:**
Instead of fetching from DB, cache the local preferences object directly:
```typescript
offlineService.cacheUserPreferences({
  profile_id: user.id,
  ...dbPreferences,
});
```
(AppHandlers already does this at line 672 — PreferencesSheet should do the same instead of fetching.)

---

## MED-002: `updateUserPreferences` Return Value Is Now Meaningless

**File:** `preferencesService.ts` (lines 82-97)
**Category:** API Contract / Semantic Integrity
**Severity:** MEDIUM (low functional impact)

**What's Wrong:**

`updateUserPreferences` now returns `true` on BOTH success AND failure. The `catch` block at line 96 returns `true` — the same as the success path. The return type `Promise<boolean>` is now effectively `Promise<true>`, making the boolean meaningless.

No caller currently checks the return value to branch behavior (AppHandlers line 668 ignores it), so this has zero functional impact today. But it's a semantic lie that could mislead future developers.

**Required Fix:**
Either:
- Change return type to `Promise<void>` since the value is meaningless
- Or return `false` on failure and let callers decide whether to care

---

## MED-003: `any` Types in Changed Code

**Files:** `AppHandlers.tsx` (lines 566, 591, 669, 675), `PreferencesSheet.tsx` (line 765)
**Category:** TypeScript Compliance
**Severity:** MEDIUM (pre-existing pattern)

**Evidence:**
```typescript
// AppHandlers.tsx:566
const handleSavePreferences = async (preferences: any): Promise<boolean> => {

// AppHandlers.tsx:591
const dbPreferences: any = { ... };

// PreferencesSheet.tsx:765
const rawDbPrefs: any = { ... };
```

These are pre-existing `any` types that were not introduced by this change. Noting for completeness — not blocking.

---

## What Passed

### Things Done Right

1. **Preference save architecture is sound.** The separation of concerns — close sheet immediately, optimistic cache update, fire-and-forget DB write — is the correct pattern for mobile UX. Users should never wait for network I/O on a preference save.

2. **`preferencesService.ts` simplification is clean.** Removing the timeout/retry wrapper and replacing it with a simple upsert + background retry is a major reduction in complexity with no functional loss. The 3-second background retry is sensible.

3. **`filterByDateTime` is well-structured.** The two-path design (Google periods format vs pool text format) with a graceful fallback (include when no data) is correct. The `parseHoursText` regex handles both "9 AM - 5 PM" and "9:00 AM - 5:00 PM" formats.

4. **`exactTime` input sanitization is proper.** The regex `EXACT_TIME_RE` at line 368 validates format before use, and the fallback to `targetDate.getHours()` when the regex doesn't match is safe.

5. **Place pool fallback deduplication via `servedPlaceIds` Set** — prevents the same place appearing in multiple categories. Good defensive coding.

6. **Fire-and-forget `insertCardToPool` in the place_pool fallback** — ensures future requests benefit from the place_pool lookup without slowing the current response.

7. **`isSavingRef` guard + immediate sheet close** — eliminates double-tap risk since the button becomes inaccessible after `onClose()`.

---

## Spec Compliance Matrix

| Success Criterion | Tested? | Passed? | Evidence |
|-------------------|---------|---------|----------|
| Preference save is instant (no timeout wait) | Yes | Yes | Sheet closes at line 751, before any async work |
| DB write happens in background | Yes | Yes | Fire-and-forget at AppHandlers:668 and PreferencesService:83 |
| Pool cards get date/time filtered | Yes | PARTIAL | Main pool path and place_pool path filtered; expanded and mixed paths NOT filtered (CRIT-001) |
| exact_time wired through to filterByDateTime | Yes | Yes | Parsed at line 198-208, used at lines 504, 747, 936 |
| Place pool fallback avoids Google API calls | Yes | Yes | Zero Google calls confirmed; only Supabase queries |
| Place pool cards inserted into card_pool | Yes | Yes | insertCardToPool fire-and-forget at line 720 |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "Removed 25-second timeout from PreferencesSheet" | Yes | Yes | Timeout + Promise.race fully removed |
| "Sheet closes immediately" | Yes | Yes | onClose() at line 751, before async IIFE |
| "Optimistic cache update BEFORE DB write" | Yes | PARTIAL | setQueryData runs before DB write, but AFTER invalidateQueries in PreferencesSheet — creates race (HIGH-001) |
| "Removed 20-second timeout + retry from preferencesService" | Yes | Yes | Clean removal, simple upsert + background retry |
| "Always returns true" | Yes | Yes | Both paths return true — noted as MED-002 |
| "Place pool fallback queries place_pool by types overlap" | Yes | Yes | `.overlaps('types', placeTypes)` at line 662 |
| "filterByDateTime on pool-served and place-pool fallback" | Yes | PARTIAL | Applied on 2 of 4 paths — 2 paths missed (CRIT-001) |
| "parseHoursText handles pool format hours" | Yes | Yes | Regex parses "9 AM - 5 PM" and "9:00 AM - 5:00 PM" correctly |
| "exactTime extracts hour for filtering" | Yes | Yes | AM/PM parsing and 12h→24h conversion correct |

---

## Recommendations

### Mandatory (block merge until done)
1. **CRIT-001**: Add `filterByDateTime` to expanded-pool path (line ~577) and pipeline-mixed path (line ~609)
2. **CRIT-002**: Handle midnight-crossing hours in both Path A and Path B of `filterByDateTime` — use `open > close` check with `||` logic

### Strongly Recommended (merge at your own risk)
3. **HIGH-001**: Remove `invalidateQueries(["userPreferences"])` from PreferencesSheet (the setQueryData in AppHandlers is the source of truth) — or reorder to call onSave synchronously before invalidation
4. **HIGH-002**: Add price tier filter to place_pool fallback query

### Should Fix Soon
5. **MED-001**: Cache local preferences directly for offline, don't refetch from DB

---

## Verdict Justification

**CONDITIONAL PASS** — The preference save refactor is solid and the place_pool fallback is a valuable addition. However, CRIT-001 (two unfiltered paths) and CRIT-002 (overnight hours) are real functional bugs that will produce incorrect results for users. HIGH-001 (race condition) is timing-dependent and may not manifest visibly if the deck reads from Zustand rather than React Query, but it's still architecturally wrong.

Fix CRIT-001 and CRIT-002 before merge. HIGH-001 and HIGH-002 can be addressed in a fast follow-up if needed but should not be deferred long.
