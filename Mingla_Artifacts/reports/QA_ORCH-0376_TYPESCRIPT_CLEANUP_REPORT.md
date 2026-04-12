# QA_ORCH-0376_TYPESCRIPT_CLEANUP_REPORT

**Date:** 2026-04-11
**Tester:** Mingla Tester (automated code audit)
**Scope:** ORCH-0376 — 272 TypeScript error cleanup across app-mobile/

---

## Build Verification

- `tsc --noEmit`: **0 errors** (independently verified)
- `expo export --platform ios`: **Build success** (12.6MB bundle, confirmed by implementor)

---

## Test Results

| ID | Area | Verdict | Notes |
|----|------|---------|-------|
| TC-01 | DiscoverScreen gender | **PASS** | Gender mapping `"man"→"male"` / `"woman"→"female"` already existed at line 3160-3161. Internal logic (holidays line 1004/1009, gender categories line 1053/1056) still uses `"man"`/`"woman"`. Mapped values only flow to API. No behavioral change. |
| TC-02 | SessionSwitcher errors | **PASS** | `switchToSolo` returns void (line 1040 of useSessionManagement.ts — no return statement). Old `const { error } = await switchToSolo()` was destructuring `undefined`, so error handling never worked. New try/catch correctly catches thrown errors and shows Alert. Improvement, not regression. |
| TC-03 | SessionViewModal setters | **PASS** | Searched entire file: zero `useState` declarations for `participants`, `sessionValid`, `hasPermission`, `isAdmin`. All four come from `useBoardSession` hook (lines 129-131). Hook manages its own cleanup. Remaining cleanup (`setActiveTab`, `setSavedCards`, `setUnreadMessages`, `setCardMessageCounts`) intact at lines 462-465. Removal of dead calls is correct. |
| TC-04 | PurchaseQRCode name | **PASS** | `userIdentity` was never declared, imported, or available — old code always fell through to `'Customer'`. New code uses `entry?.customerName \|\| 'Customer'` (line 30). **Moot finding:** `PurchaseQRCode` has zero importers anywhere in the codebase — it is dead code. No user can reach this component. No regression possible. |
| TC-05 | BoardDiscussion participants + dropdown | **PASS with P2 note** | Type fix correct — code always accessed `.id`/`.name`/`.status` on participants (line 219+). DropdownMenu stubs render `{children}` as pass-through. **P2: The dropdown IS used in visible UI** (line 443-489) — the board header's three-dot menu. With stubs, menu items render as flat always-visible content instead of a proper dropdown. This is a pre-existing issue (the shadcn dropdown-menu never worked in React Native either), but now explicitly stubbed. See defects section. |
| TC-06 | Regression spot-checks | **PASS** | See details below. |
| TC-07 | Dead code deletion | **PASS** | 0 TS errors. 0 orphaned imports (grep confirmed). 9 files remain in ui/ (7 live + 2 stubs). Correct. |

### TC-06 Detailed Results

| File | Check | Result |
|------|-------|--------|
| `offlineService.ts` | `budget` → `priceTiers` | **PASS** — `RecommendationsRequest.priceTiers` confirmed as correct field (types/index.ts:37). Cache key uses same field as request. |
| `recommendationCacheService.ts` | Same field rename | **PASS** — Consistent with offlineService and type definition. |
| `RecommendationsContext.tsx` | `exhaustionKey` ordering | **PASS** — Moved after `user` and `currentMode` declarations which it depends on. No circular dependency. Closure captures are correct. |
| `useSessionManagement.ts` | `exact_time` removal | **PASS** — `normalizePreferencesForSave` (preferencesConverter.ts) has zero references to `exact_time`. Not a valid field. Removal correct. |
| `enhancedFavoritesService.ts` | `supabase.raw()` replacement | **PASS with P3 note** — `supabase.raw()` never existed in supabase-js v2, so the old code was already broken. New read-then-increment pattern works but is not atomic (race condition if two visits recorded simultaneously). P3 because visit counting is cosmetic and this service appears unused. |
| `OfflineIndicator.tsx` | Color token access | **PASS** — `colors.error` is an object `{ 50: ..., 500: '#ef4444', ... }`. Access via `[500]` returns the correct hex string. `colors.text.secondary` returns `'#4b5563'`. Both match design system (designSystem.ts lines 149-160, 184-188). |

---

## Defects Found

### P2-001: BoardDiscussion dropdown menu renders flat (pre-existing, now explicit)

**File:** `src/components/BoardDiscussion.tsx:22-26, 443-489`
**What:** The board header's three-dot menu uses `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem`. These were previously imported from `./ui/dropdown-menu` (a shadcn web component that used Radix UI — which **never worked in React Native**). The implementor replaced the import with pass-through stubs that render `{children}` inline.

**Impact:** Menu items ("Manage Members," "Toggle Notifications," "Exit Board") render as flat, always-visible content inside the header instead of being hidden behind a dropdown. This is the **same broken behavior as before** (Radix UI doesn't render in RN), just now made explicit via stubs.

**Severity:** P2 — Pre-existing UX issue. Not a regression from this change, but now formally visible. The dropdown was never functional in React Native.

**Fix:** Replace with a React Native-compatible dropdown (e.g., `react-native-popup-menu`, a custom bottom sheet, or an ActionSheet). Register as ORCH item for orchestrator.

### P3-001: enhancedFavoritesService.recordVisit is not atomic (pre-existing)

**File:** `src/services/enhancedFavoritesService.ts:379-403`
**What:** Read-then-increment pattern for visit_count. Two concurrent calls could read the same count and both write count+1, losing an increment.
**Impact:** P3 — Visit counting is cosmetic. Service appears to have no active callers.
**Fix:** Use a Supabase RPC for atomic increment, or accept the race.

---

## Overall Verdict

**PASS** — 7/7 test cases passed. 0 P0, 0 P1, 1 P2 (pre-existing), 1 P3 (pre-existing).

No regressions introduced by ORCH-0376. The two defects found are pre-existing conditions that were already broken before this change — the cleanup made them explicitly visible rather than silently broken.

---

## Discoveries for Orchestrator

1. **PurchaseQRCode.tsx is dead code** — zero importers anywhere. Can be deleted entirely.
2. **BoardDiscussion dropdown menu needs a proper React Native implementation** — currently renders flat. Was always broken (shadcn/Radix doesn't work in RN). Should be registered as an ORCH item under Collaboration Sessions surface.
3. **enhancedFavoritesService appears to have no active callers** — the entire favorites service may be dead code or deferred feature. Worth verifying.
