# QA Report: ORCH-0394 — Collaboration Preferences Location Pipeline Fix

**Tester:** QA Agent
**Date:** 2026-04-11
**Mode:** TARGETED (orchestrator-dispatched)
**Verdict:** **PASS**

---

## Test Results

### Category 1: Location Seeding (ORCH-0395)

**T-01: buildSeedFromSoloPrefs reads custom_lat/custom_lng** — PASS
- `useSessionManagement.ts:122-126` — `typeof soloAny.custom_lat === 'number'` guard present, sets `raw.custom_lat`
- Same pattern for `custom_lng` at lines 125-126
- Defaults at lines 89-90 are `null as number | null` — correct fallback
- Pattern matches sibling guards for `use_gps_location` (line 116) and `custom_location` (line 119)

**T-02: collaborationInviteService.ts includes lat/lng in SELECT and upsert** — PASS
- Line 320: SELECT string ends with `..., custom_lat, custom_lng'`
- Lines 345-346: Upsert includes `custom_lat: soloPrefs?.custom_lat ?? null` and `custom_lng: soloPrefs?.custom_lng ?? null`
- Null-safe: uses `??` operator, not `||` — correct for numeric 0 edge case

**T-03: OnboardingFlow.tsx backfill includes lat/lng** — PASS
- Line 1605: SELECT string ends with `..., custom_lat, custom_lng"`
- Lines 1626-1627: Update includes `custom_lat: soloPrefs.custom_lat ?? null` and `custom_lng: soloPrefs.custom_lng ?? null`
- Placed after `custom_location` (line 1625) — consistent field ordering

### Category 2: Lock-In Button (ORCH-0396)

**T-04: hasChanges returns true when initialPreferences is null** — PASS
- `PreferencesSheet.tsx:636`: `if (!initialPreferences) return true;`
- Verified: was `return false` per investigation report

**T-05: countChanges returns 1 when initialPreferences is null** — PASS
- `PreferencesSheet.tsx:712`: `if (!initialPreferences) return 1;`
- Verified: was `return 0` per investigation report

**T-06: Scenario trace — user opens collab prefs with empty row, fills categories** — PASS

**Path A (row exists, empty fields):**
1. `useBoardSession.loadSession` → `.single()` on `board_session_preferences` → row returned with null fields
2. `prefsResult.data` is object → `setPreferences(prefsResult.data)` at line 158
3. `usePreferencesData` returns `boardPreferences` → `loadedPreferences` is object
4. `PreferencesSheet` useEffect (line 273): `!loadedPreferences` is false → proceeds
5. `isCollaborationMode` branch (line 278): sets state from null/empty fields with defaults
6. `setInitialPreferences(...)` at line 345: set with defaults like `selectedCategories: []`
7. User fills categories → `selectedCategories !== initialPreferences.selectedCategories` → `hasChanges = true`
8. Button enabled. **Correct.**

**Path B (row doesn't exist):**
1. `useBoardSession.loadSession` → `.single()` on `board_session_preferences` → PGRST116
2. PGRST116 suppressed at line 141 (code !== "PGRST116" guard)
3. `preferences` remains `null` → `loadedPreferences` is `null`
4. `PreferencesSheet` useEffect (line 274): `!loadedPreferences` is true → returns early
5. `initialPreferences` stays `null`
6. `hasChanges`: `!initialPreferences` → `return true`
7. Button enabled. **Correct.**

### Category 3: Edge Function Location Fallback (ORCH-0397 + ORCH-0399)

**T-07: Edge function selects custom_lat/custom_lng from solo prefs** — PASS
- `generate-session-deck/index.ts:322`: `.select('use_gps_location, custom_location, custom_lat, custom_lng')`

**T-08: Edge function handles GPS users with direct coordinates** — PASS
- Lines 327-329: `if (creatorPrefs.custom_lat != null && creatorPrefs.custom_lng != null)` → sets location
- Uses `!= null` (not `!== null`) — correctly catches both null and undefined

**T-09: Edge function handles GPS users without coordinates (location history fallback)** — PASS
- Lines 331-343: `else if (creatorPrefs.use_gps_location)` → queries `user_location_history`
- Orders by `created_at DESC`, limits 1, uses `.single()`
- Correctly checks `if (locationData)` before setting location

**T-10: Edge function handles manual-location users** — PASS
- Trace: Manual user has `use_gps_location = false` and `custom_lat = 35.79, custom_lng = -78.74`
- Enters `if (creatorPrefs)` at line 326 — yes
- Enters `if (creatorPrefs.custom_lat != null && creatorPrefs.custom_lng != null)` at line 328 — yes (coordinates exist)
- Location resolved. **GPS flag is irrelevant when direct coordinates exist.** Correct.
- Previously: code only checked `if (creatorPrefs?.use_gps_location)` — manual users had no path at all

**T-11: Edge function aggregation still picks up collab prefs coordinates** — PASS
- `aggregateAllPrefs` lines 111-113: filters rows where `r.custom_lat != null && r.custom_lng != null`
- Computes midpoint of all valid coordinates
- Now that seeding writes lat/lng (Fixes 1A-1C), this PRIMARY aggregation path will resolve location before any fallback is needed
- Fallback chain (lines 303-347) is defense-in-depth for edge cases where collab prefs somehow lack coords

### Category 4: Session Load Hardening (ORCH-0398)

**T-12: loadSession uses .maybeSingle()** — PASS
- `useBoardSession.ts:100`: `.maybeSingle()` confirmed
- Note: the user prefs query at line 106 still uses `.single()` — correct, PGRST116 for prefs is suppressed at line 141

**T-13: Null session result handled gracefully** — PASS
- Lines 133-139: `if (!sessionResult.data)` → sets error, sessionValid=false, hasPermission=false, loading=false → returns
- Runs AFTER `sessionResult.error` check (line 131) and BEFORE prefs error checks (line 141)
- Error message: "This session is no longer available." — clear, actionable, user-friendly

### Category 5: Regression Checks

**T-14: Solo deck generation is untouched** — PASS
- `git diff --stat` confirms zero changes to:
  - `app-mobile/src/services/deckService.ts`
  - `supabase/functions/discover-cards/index.ts`
  - `app-mobile/src/contexts/RecommendationsContext.tsx`
  - `app-mobile/src/services/preferencesService.ts`

**T-15: PreferencesSheet solo mode unaffected** — PASS
- In solo mode: `loadedPreferences` comes from React Query cache via `PreferencesService.getUserPreferences` (which uses `select("*")` and `.maybeSingle()`)
- When user has completed onboarding: `loadedPreferences` is always a populated object (never null)
- useEffect runs → enters solo branch (line 370+) → `setInitialPreferences(...)` at line 429
- `initialPreferences` is non-null → `hasChanges` runs normal field-by-field comparison
- The new `return true` on null path is NEVER reached in solo mode for onboarded users

**T-16: Collab prefs save handler still writes lat/lng** — PASS
- `PreferencesSheet.tsx:847-848`: `custom_lat: selectedCoords?.lat ?? null` and `custom_lng: selectedCoords?.lng ?? null`
- These lines were NOT modified in this implementation — confirmed by reading the code
- Collab save path (lines 826-857) is intact

**T-17: board_session_preferences prefs query for current user still works** — PASS
- `useBoardSession.ts:106`: user prefs query still uses `.single()` — only session query was changed
- Line 141: PGRST116 suppression still active for prefs query
- No behavioral change to prefs loading

---

## Constitutional Compliance

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| 1 | No dead taps | N/A | No UI elements added |
| 2 | One owner per truth | PASS | Solo prefs → collab prefs is a copy, not a second authority |
| 3 | No silent failures | PASS | Backfill catch logs warning (line 1632); session null shows error message |
| 4 | One key per entity | N/A | No query key changes |
| 5 | Server state server-side | N/A | No Zustand changes |
| 6 | Logout clears everything | N/A | No new persisted data |
| 7 | Label temporary | PASS | No transitional code added |
| 8 | Subtract before adding | PASS | Old fallback logic replaced, not layered |
| 9 | No fabricated data | N/A | No display changes |
| 10 | Currency-aware | N/A | No currency changes |
| 11 | One auth instance | N/A | No auth changes |
| 12 | Validate at right time | N/A | No validation changes |
| 13 | Exclusion consistency | N/A | No exclusion changes |
| 14 | Persisted-state startup | N/A | No startup changes |

---

## Summary

| Category | Tests | Passed | Failed |
|----------|-------|--------|--------|
| Location Seeding | 3 | 3 | 0 |
| Lock-In Button | 3 | 3 | 0 |
| Edge Function Fallback | 5 | 5 | 0 |
| Session Load | 2 | 2 | 0 |
| Regression | 4 | 4 | 0 |
| **Total** | **17** | **17** | **0** |

**P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 1**

**P4 (praise):** The edge function fallback restructure (Fix 3) is well-designed — checking direct coordinates first regardless of GPS flag means the code works correctly for BOTH user types with a single `if` check, rather than branching on location mode. Clean pattern.

---

## Discoveries for Orchestrator

None. All changes are within spec scope. No new issues found.
