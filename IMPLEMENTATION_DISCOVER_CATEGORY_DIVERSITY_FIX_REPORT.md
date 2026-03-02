# Implementation Report: Discover Category Diversity Fix (Tester Remediation)
**Date:** 2026-03-02
**Spec:** FEATURE_DISCOVER_CATEGORY_DIVERSITY_FIX_SPEC.md
**Tester Report:** TEST_DISCOVER_CATEGORY_DIVERSITY_FIX_REPORT.md
**Status:** Complete — ready for deployment and re-testing

---

## 0. Context

The tester's report identified 2 critical findings, 2 high-severity issues, and 2 medium issues. This implementation addresses ALL mandatory items from the tester's recommendations. The original spec's 4 client-side changes and the edge function diversity algorithm were already correctly implemented in the working tree — they just hadn't been committed, deployed, or validated with real requests.

### Tester Findings Addressed

| Finding | Severity | Action Taken |
|---------|----------|-------------|
| CRIT-001: Edge function not deployed | Critical | Code verified correct. Ready for `supabase functions deploy discover-experiences` after commit. |
| CRIT-002: Stale caches prevent fix visibility | Critical | Client cache version bumped (v3→v4, daily v2→v3). Server cache must be cleared after deploy. |
| HIGH-001: Duplicate React keys | High | `key={card.id}` → `` key={`${card.id}-${index}`} `` at line 3400 |
| HIGH-002: Code-trace-only verification | High | Acknowledged. Deployment + real integration test required before re-testing. |
| MED-001: `any` types in diversity algorithm | Medium | Not addressed — matches existing file-wide pattern, spec provided `any` explicitly. |
| MED-002: `adminClient!` non-null assertion | Medium | Not addressed — safe due to outer guard, low priority. |

---

## 1. What Was There Before

### Existing Files (State Before This Fix)

The previous implementor had already applied all spec changes to the working tree:
- Edge function diversity algorithm (lines 367-469) — correct but unstaged
- 4 client-side DiscoverScreen.tsx changes — correct but unstaged
- README.md updated with initial Recent Changes entry — committed

### Pre-existing Bugs Not Addressed by Original Implementation
1. **Duplicate React key error** — `card_pool` has no unique constraint on `google_place_id`, causing duplicate `card.id` values in grid rendering
2. **Stale client cache** — Old AsyncStorage cache (v3) would bypass the edge function entirely on returning users

---

## 2. What Changed (This Remediation Pass)

### Files Modified

| File | What Changed |
|------|-------------|
| `app-mobile/src/components/DiscoverScreen.tsx` | (1) `key={card.id}` → `` key={`${card.id}-${index}`} `` at line 3400 (duplicate key fix). (2) `DISCOVER_CACHE_KEY` v3→v4, `DISCOVER_DAILY_CACHE_KEY` v2→v3 at lines 45-46 (cache invalidation). |
| `README.md` | Added 2 bullet points to Recent Changes section documenting the duplicate key fix and cache version bump. |

### Files Verified Unchanged (Already Correct from Prior Implementation)

| File | Verified Correct |
|------|-----------------|
| `supabase/functions/discover-experiences/index.ts` | Lines 367-469: 3-pass diversity algorithm matches spec §5.1 exactly. Lines 287-312: server cache hit returns `heroCards` via `generated_location.heroCards`. |
| `app-mobile/src/components/DiscoverScreen.tsx` | Line 146: `heroCards: FeaturedCardData[]` in `DiscoverCache`. Line 1215: `heroCards` param with `= []` default. Line 1601: call site passes `transformedHeroes`. Lines 1377-1381: `applyCachedDiscoverData` restores heroCards with `|| []` backward compat. Lines 1689-1695: `selectedHeroCards.length > 0` guard in useEffect. |

### Database Changes Applied
None. No new tables, columns, or migrations.

### State Changes
- **AsyncStorage keys invalidated:** All keys using `mingla_discover_cache_v3` and `mingla_discover_cache_daily_v2` are now orphaned. New keys use `v4` and `v3` respectively.
- **React Query keys:** No changes.
- **Zustand:** No changes.

---

## 3. Spec Compliance — Section by Section

| Spec Section | Requirement | Implemented? | Notes |
|-------------|-------------|-------------|-------|
| §3.1 | Pool >= 12 cards: 2 heroes + 10 diverse grid | ✅ | Code verified at lines 367-469. Needs deploy to be live. |
| §3.2 | Missing categories: graceful degradation | ✅ | PASS 3 fill logic at lines 410-418. |
| §3.3 | Pool-first returns `heroCards` in JSON | ✅ | Line 453: `heroCards: poolHeroCards` |
| §3.4 | Client cache persists `heroCards` | ✅ | Line 1226 saves, line 1378 restores with `|| []` |
| §3.5 | useEffect guard prevents overwrite | ✅ | Lines 1689-1695 |
| §3.6 | Google API path untouched | ✅ | Lines 477+ unchanged |
| §3.7 | No new functions/tables/columns | ✅ | Zero new files |
| (Tester) HIGH-001 | Duplicate React key fix | ✅ | `` key={`${card.id}-${index}`} `` at line 3400 |
| (Tester) CRIT-002 | Cache invalidation | ✅ | Cache keys bumped v3→v4, daily v2→v3 |

---

## 4. Implementation Details

### Duplicate Key Fix (HIGH-001)

The `card_pool` table has no unique constraint on `google_place_id`. Multiple edge functions (`discover-experiences`, `generate-experiences`, etc.) insert cards for the same Google Place under different categories. `poolCardToApiCard` maps `id: card.google_place_id || card.id`, so two pool rows for the same park produce cards with identical `id` values. The diversity algorithm's `usedIds` tracking prevents this in the new code path, but as a defense-in-depth measure — and to fix the error in ALL code paths including non-pool — the React key now includes the array index: `` key={`${card.id}-${index}`} ``.

**Root cause fix (not in scope):** A proper fix would add a UNIQUE constraint on `card_pool(google_place_id, category)` and use UPSERT in `insertCardToPool`. This is tracked as tech debt.

### Cache Version Bump (CRIT-002)

Two independent cache layers prevented the fix from being visible:
1. **Client AsyncStorage** — keyed by `DISCOVER_CACHE_KEY` (was v3). If a user opened Discover before deployment, their cache has today's date with all-Nature cards and no `heroCards` field. The cache hit returns early and never calls the edge function.
2. **Server `discover_daily_cache`** — keyed by user_id + us_date_key. May have stale rows from before the fix.

The client cache version bump (v3→v4, daily v2→v3) creates new key names, making all pre-fix cached data inaccessible. On next app load, the cache lookup finds nothing, triggers a fresh edge function call, and the diversity algorithm runs.

The server cache still needs manual clearing after deployment: `DELETE FROM discover_daily_cache WHERE us_date_key = '2026-03-02'`.

---

## 5. Verification Results

### Code-Level Verification

All changes verified by reading the actual file contents after edits:

| Check | Result | Evidence |
|-------|--------|----------|
| Edge function 3-pass algorithm | ✅ | Lines 367-469 match spec §5.1 verbatim |
| `heroCards` in pool-first response | ✅ | Line 453 |
| `heroCards` in daily cache write | ✅ | Line 443 |
| `DiscoverCache.heroCards` field | ✅ | Line 146 |
| `saveDiscoverCache` 4th param | ✅ | Line 1215 with `= []` default |
| Call site passes `transformedHeroes` | ✅ | Line 1601 |
| `applyCachedDiscoverData` restores heroCards | ✅ | Lines 1377-1381 |
| Backward compat `|| []` default | ✅ | Line 1378 |
| useEffect guard `selectedHeroCards.length > 0` | ✅ | Line 1691 |
| useEffect dependency array unchanged | ✅ | `[recommendations]` only |
| Duplicate key fix | ✅ | Line 3400: `` key={`${card.id}-${index}`} `` |
| Cache version v3→v4 | ✅ | Line 45 |
| Daily cache version v2→v3 | ✅ | Line 46 |

### Deployment Verification (REQUIRED — Not Yet Done)

The tester explicitly flagged that the original implementation was verified by code trace only. The following steps MUST be performed after committing:

1. `supabase functions deploy discover-experiences`
2. `DELETE FROM discover_daily_cache WHERE us_date_key = '2026-03-02'`
3. Open the Discover tab → For You
4. Verify: 2 hero cards render (Fine Dining + Play), 10 grid cards with diverse categories
5. Kill and reopen app — verify cached data loads with hero cards intact
6. Change preferences → re-open For You → verify new diverse cards appear

---

## 6. Deviations from Spec

| Spec Reference | What Spec Said | What I Did Instead | Why |
|---------------|---------------|-------------------|-----|
| (none) | Spec did not address duplicate key error | Added `` key={`${card.id}-${index}`} `` | Tester identified HIGH-001: live bug causing React reconciliation errors |
| (none) | Spec did not address cache invalidation | Bumped cache key versions | Tester identified CRIT-002: stale caches would bypass the fix entirely |

Both deviations are additions that fix bugs identified during testing. No spec requirements were modified or skipped.

---

## 7. Known Limitations & Future Considerations

1. **`card_pool` has no UNIQUE constraint on `(google_place_id, category)`** — allows unlimited duplicate rows. The `usedIds` tracking in the diversity algorithm masks this for the pool-first path, and the `` key={`${card.id}-${index}`} `` fix masks it in React, but other consumers of `serveCardsFromPipeline` remain vulnerable. Should add constraint + UPSERT.
2. **`any` types in diversity algorithm** — matches the rest of the edge function file but violates strict TypeScript. Low priority since the file is consistently untyped.
3. **`adminClient!` non-null assertion** — safe due to outer guard but poor pattern. Could extract to local const.
4. **No CI/CD for edge function deployment** — local code can silently diverge from deployed code. This is how the original implementation went undeployed.

---

## 8. Files Inventory

### Modified (This Remediation Pass)
- `app-mobile/src/components/DiscoverScreen.tsx` — Duplicate key fix (line 3400), cache version bump (lines 45-46)
- `README.md` — Added 2 entries to Recent Changes section

### Verified Correct (No Changes Needed — Already Applied by Prior Implementation)
- `supabase/functions/discover-experiences/index.ts` — 3-pass diversity algorithm (lines 367-469)
- `app-mobile/src/components/DiscoverScreen.tsx` — All 4 spec changes (heroCards interface, save, restore, useEffect guard)

---

## 9. README Update

| README Section | What Changed |
|---------------|-------------|
| Recent Changes | Added 2 bullet points: duplicate React key fix, client cache version bump |
| All other sections | No changes needed — the diversity fix is an internal algorithm change with no new features, tables, or edge functions |

---

## 10. Handoff to Tester

Tester: this remediation pass addresses all 4 mandatory findings from your report (CRIT-001, CRIT-002, HIGH-001, HIGH-002). The code changes are minimal — 2 lines in DiscoverScreen.tsx. The edge function and original 4 client-side changes were already correct and are unchanged.

**Before re-testing, the following deployment steps are required:**

1. Commit all changes (both files modified in this pass + the already-correct edge function and DiscoverScreen changes)
2. `supabase functions deploy discover-experiences`
3. `DELETE FROM discover_daily_cache WHERE us_date_key = '2026-03-02'`
4. Run the 6-step integration test from spec §7 with REAL requests — not code trace

The cache version bump (CRIT-002) is self-healing: any user who opens the app after the commit will automatically get fresh cache keys and bypass stale data. The server cache clear (step 3) ensures the first request after deploy doesn't hit a stale server-side cache row.

Re-run all 11 test cases from spec §8 plus the duplicate key regression: confirm no `Encountered two children with the same key` error appears in the console. Hold nothing back.
