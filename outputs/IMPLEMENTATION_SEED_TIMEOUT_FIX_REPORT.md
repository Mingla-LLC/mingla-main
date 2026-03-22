# Implementation Report: Seed Timeout Fix

**Date:** 2026-03-22
**Spec:** `outputs/FIX_SEED_TIMEOUT_SPEC.md`
**Status:** Implemented, ready for testing

---

## 1. What Was There Before

**File modified:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx` — `SeedTab` component (lines 289–520)

**Pre-existing behavior:** `startSeeding()` sent ALL selected categories (up to 13) in a single HTTP request to `admin-seed-places`. For a city with ~50 tiles and 13 categories, this meant ~650 sequential Google API calls taking ~3 minutes — exceeding Supabase's edge function resource limits (546 error). No progress feedback was shown. The `coverage_check` and `preview_cost` effects fired during seeding, flooding the console with 400s. If the function crashed mid-seed, city status got stuck on "seeding" permanently.

---

## 2. What Changed

All changes in `PlacePoolManagementPage.jsx`, `SeedTab` component only. Zero edge function changes.

| Change | Spec Section | Lines |
|--------|-------------|-------|
| Added `seedingStatus` and `liveProgress` state variables | §9.2 | 300–301 |
| Replaced `startSeeding` with per-category sequential loop | §9.3 | 342–432 |
| Added `seeding` guard to `coverage_check` effect | §9.4 | 306 |
| Added `seeding` guard to `preview_cost` effect | §9.4 | 330 |
| Inserted live progress panel JSX | §9.5 | 492–525 |
| Added `disabled={seeding}` to category pills | §9.6 | 452–453 |
| Added `|| seeding` to Start Seeding button disabled prop | §9.6 | 500 |
| Updated results display to handle `cat.error` entries | §9.7 | 538–557 |

---

## 3. Spec Compliance

| Section | Requirement | Status |
|---------|------------|--------|
| §9.2 | New state: `seedingStatus`, `liveProgress` | ✅ |
| §9.3 | Per-category loop with totals accumulation, partial failure handling, toast variants | ✅ |
| §9.4 | `seeding` guard in effects (NOT in dependency arrays) | ✅ |
| §9.5 | Live progress panel with spinner, category results, error/success icons | ✅ |
| §9.6 | Pills and button disabled during seeding | ✅ |
| §9.7 | Results display handles `cat.error` with "Failed" label | ✅ |

---

## 4. Success Criteria Verification

| SC | Description | Verdict |
|----|------------|---------|
| SC-001 | Per-category sequential seeding, no timeouts | ✅ Code sends `categories: [singleCatId]` per request |
| SC-002 | Live progress panel with current category, completed count, per-category results | ✅ Panel renders incrementally via `setLiveProgress` |
| SC-003 | Single category failure doesn't abort remaining | ✅ try/catch inside loop, `failedCount` tracked |
| SC-004 | No preview_cost/coverage_check during seeding | ✅ `if (seeding) return` guards added |
| SC-005 | Coverage refreshes after completion | ✅ `coverage_check` called after loop, `onRefresh()` triggers re-render |
| SC-006 | Pills and button disabled during seeding | ✅ `disabled={seeding}` on both |

---

## 5. Deviations from Spec

None. All 7 changes implemented exactly as specified.

---

## 6. Tester Findings — Fixed

### HIGH-001: City selector and sub-tabs not disabled during seeding
**Fix:** Added `seedingActive` state to parent `PlacePoolManagementPage`. `SeedTab` calls `onSeedingChange(true/false)` at seeding start/end. Parent uses `seedingActive` to disable `CitySelector` (via `disabled` prop) and `Tabs` (via no-op `onChange`). Prevents city/tab switching during the 3-4 minute seeding window.

### HIGH-002: Post-seeding coverage refresh has no unmount guard
**Fix:** Added `mountedRef` to `SeedTab` (matching codebase pattern from parent component). Coverage refresh `.then()` checks `mountedRef.current` before calling `setCoverage`.

### MED-001: Redundant coverage_check after seeding
**Accepted as-is.** The manual coverage_check at the end of seeding provides immediate feedback. The effect may fire again after `onRefresh()` — harmless (one extra API call, ~$0.00). The `cancelled` flag in the effect handles stale responses correctly.

---

## 7. Known Limitations

- **HF-001 (city stuck in "seeding"):** The per-category chunking mitigates this — each request is short enough to complete, so the status update at line 844 of the edge function executes. However, if a network failure kills the last request mid-flight, the city could still get stuck. A future improvement could add a client-side status reset after the loop.
- **OB-001 (redundant status writes):** Each per-category request writes `status: "seeding"` — harmless but redundant. Not worth fixing.

---

## 8. Files Modified

| File | Type |
|------|------|
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Modified |

---

## 8. Handoff to Tester

All 8 test cases from spec §12 are ready for manual verification. Key areas to break:
- Select all 13 categories on a real city → watch sequential progress
- Kill network mid-seed → verify partial results show and remaining categories error gracefully
- Click "Start Seeding" rapidly → verify only one loop runs
- Watch console for 400s during seeding → should see none
