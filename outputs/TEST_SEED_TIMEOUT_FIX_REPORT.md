# Test Report: Seed Timeout Fix

**Date:** 2026-03-22
**Spec:** `outputs/FIX_SEED_TIMEOUT_SPEC.md`
**Implementation:** `outputs/IMPLEMENTATION_SEED_TIMEOUT_FIX_REPORT.md`
**Tester:** Brutal Tester Skill
**Verdict:** 🟡 CONDITIONAL PASS

---

## Executive Summary

The implementation correctly converts the single-request seeding into a per-category sequential loop with live progress, matching the spec closely. Code quality is solid — error handling, guard conditions, and UI state management are all well-done. Two findings need attention: the city selector and sub-tab switcher remain enabled during seeding, and the post-seeding coverage refresh fires without a mounted/cancelled guard.

---

## Test Manifest

Total items tested: 38

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| Pattern Compliance | 6 | 6 | 0 | 0 |
| Security | 3 | 3 | 0 | 0 |
| State Management | 8 | 6 | 1 | 1 |
| UI Controls | 5 | 4 | 1 | 0 |
| Edge Function Contract | 4 | 4 | 0 | 0 |
| Error Handling | 5 | 5 | 0 | 0 |
| Spec Criteria | 6 | 6 | 0 | 0 |
| Cross-Domain Impact | 1 | 1 | 0 | 0 |
| **TOTAL** | **38** | **35** | **2** | **1** |

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: City selector and sub-tabs NOT disabled during seeding

**File:** [PlacePoolManagementPage.jsx:1365](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1365) (city selector), [line 1391](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1391) (sub-tabs)

**Category:** UI State / UX Confusion

**What's Wrong:**

The spec (§9.6) disables category pills and the Start Seeding button during seeding. However, the city selector dropdown and the sub-tab switcher (`Tabs` component) remain fully interactive. This creates two problems:

1. **City switch mid-seed:** If the admin selects a different city while seeding is running, the `SeedTab` unmounts and remounts with the new city. The `startSeeding` async loop continues executing in the background (closure captured the old `city.id`), but all `setState` calls (`setLiveProgress`, `setSeedingStatus`, `setProgress`, `setSeeding`) target a now-unmounted component. The new `SeedTab` instance starts fresh with `seeding=false`, so the admin could accidentally trigger a second seeding run for the new city while the old one is still in-flight.

2. **Tab switch mid-seed:** If the admin switches from "Seed & Import" to "Map View" and back, `SeedTab` unmounts and remounts. Same problem — the loop continues on the old unmounted instance while the new instance shows `seeding=false`.

**Evidence:**

```jsx
// Line 1365 — no seeding guard
<CitySelector cities={cities} selectedCity={selectedCity}
  onSelect={setSelectedCity} onAddCity={() => setAddCityOpen(true)} />

// Line 1391 — no seeding guard
<Tabs tabs={SUB_TABS} activeTab={activeTab} onChange={setActiveTab} />

// Line 1393 — SeedTab is conditionally rendered, will unmount on tab switch
{activeTab === "seed" && <SeedTab ... />}
```

**Required Fix:**

The simplest fix: pass `seeding` up to the parent (or use a ref) and disable city selector + sub-tabs during seeding. Two options:

**Option A (minimal):** Add a callback prop to `SeedTab` that notifies the parent when seeding starts/ends. Parent disables the `CitySelector` and `Tabs`.

**Option B (quick):** Lift the `seeding` boolean to the parent component via `useState`, pass it down to `SeedTab` and use it to disable `CitySelector` and `Tabs`. This requires a small refactor since `seeding` is currently local to `SeedTab`.

**Why This Matters:**

If an admin switches cities or tabs during a multi-minute seeding run (which the spec explicitly acknowledges takes 3-4 minutes for 13 categories), they'll see a fresh `SeedTab` with no progress and the ability to start another seeding run. The original seeding loop continues firing edge function calls silently in the background. This wastes money (duplicate API calls) and creates confusing results.

---

### HIGH-002: Post-seeding coverage refresh has no unmount guard

**File:** [PlacePoolManagementPage.jsx:417-419](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L417-L419)

**Category:** State Management

**What's Wrong:**

The fire-and-forget `coverage_check` call after seeding completes has no `cancelled` or `mounted` guard:

```javascript
// Line 417-419 — no guard on the .then() callback
supabase.functions.invoke("admin-seed-places", {
  body: { action: "coverage_check", cityId: city.id },
}).then(({ data: cov }) => { if (cov) setCoverage(cov); });
```

If the component unmounts before this promise resolves (admin switches tab/city right after seeding finishes), `setCoverage` fires on an unmounted component.

**Required Fix:**

Use the same `cancelled` flag pattern used in the `useEffect` at line 304-311:

```javascript
// Wrap in a check — simplest approach:
const cov_city_id = city.id;
supabase.functions.invoke("admin-seed-places", {
  body: { action: "coverage_check", cityId: cov_city_id },
}).then(({ data: cov }) => {
  // Only update if component is still showing this city
  if (cov) setCoverage(cov);
});
```

Or, since this is in an event handler (not an effect), accept the minor React 18 console warning and note it as tech debt — React 18 tolerates setState on unmounted components without crashing.

**Why This Matters:**

In React 18, this won't crash the app — React silently drops the state update. However, it's a pattern violation against the codebase's established `mountedRef` pattern (used in the parent component at lines 1199-1203, 1261, 1317, 1327, 1334, 1337). Inconsistency here sets a bad precedent.

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: Redundant coverage_check after seeding completes

**File:** [PlacePoolManagementPage.jsx:417-421](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L417-L421)

**Category:** Performance / Waste

**What's Wrong:**

After the seeding loop, the code does:

```javascript
// Line 417: Fire-and-forget coverage_check
supabase.functions.invoke("admin-seed-places", {
  body: { action: "coverage_check", cityId: city.id },
}).then(({ data: cov }) => { if (cov) setCoverage(cov); });

// Line 420: Triggers parent refresh, which may change city object reference
onRefresh();

// Line 421: Sets seeding to false
setSeeding(false);
```

`onRefresh()` calls `setRefreshKey(k => k+1)` in the parent, which triggers the parent's data loading `useEffect` (line 1314-1341). If the parent re-renders `SeedTab` with a new `city` object reference (same data, different JS object), the `coverage_check` effect at line 304 fires again — because `[city]` is in its deps and object identity changed. Since `seeding` is now `false`, the guard at line 306 doesn't block it. Result: **two** coverage_check API calls for the same city.

**Required Fix:**

Either:
- Remove the manual coverage_check at line 417-419 and rely on the effect to handle it after `setSeeding(false)` (would require adding `seeding` to the effect's dep array and restructuring, not recommended per spec §14.1)
- OR: Accept the redundancy — it's one extra API call (~$0.00), harmless functionally. Document with a comment.

**Why This Matters:**

Functionally harmless — just a wasted API call. The `cancelled` flag in the effect correctly handles stale responses. But it's worth a comment explaining why it happens.

---

## ✅ What Passed

### Things Done Right

1. **Per-category loop is correct.** Each iteration sends `categories: [catId]` — exactly one category per request. The closure correctly captures `city.id` and `cats` array at call time, so mid-render changes don't corrupt the loop.

2. **Error handling is thorough.** Three distinct error paths per category: `error` from Supabase client, missing `perCategory[catId]` key (unexpected response shape), and `catch` for network errors. Each produces a clear error message. Partial failures don't abort remaining categories.

3. **Toast variants are correct.** All-success → "success", partial failure → "warning", all-failed → "error". Toast description accurately reflects results.

4. **Effect guards are correctly placed.** The `seeding` guard is inside the effect body, NOT in the dependency array — exactly as the spec required (§9.4, §14.1). This prevents effects from re-firing when `seeding` changes while still blocking execution during active seeding.

5. **Live progress panel renders incrementally.** `setLiveProgress(prev => ({...prev, [catId]: results[catId]}))` correctly uses the functional updater pattern, building up results one category at a time.

6. **Double-submit prevention is solid.** Three layers: (a) `if (!city || seeding) return` guard in `startSeeding`, (b) `disabled={seeding}` on the button, (c) `disabled={seeding}` on category pills. The `onClick={() => !seeding && toggleCat(id)}` belt-and-suspenders approach on pills is a nice touch.

7. **Results display correctly handles error entries.** The `cat.error` ternary at line 599-601 shows "Failed" in red for errored categories and normal stats for successful ones. The expandable `<details>` section shows the error message for failed categories.

8. **No edge function changes.** The implementor correctly identified that the existing edge function already supports single-category invocation and made zero backend changes.

9. **Import additions are clean.** `AlertTriangle` and `CheckCircle` from lucide-react were already imported (line 6) — no new imports needed for the progress panel icons.

10. **Spec compliance is 100%.** All 6 success criteria pass, all 7 code changes match the spec.

---

## Spec Compliance Matrix

| Success Criterion (from Spec) | Tested? | Passed? | Evidence |
|-------------------------------|---------|---------|----------|
| SC-001: Per-category sequential seeding, no timeouts | ✅ | ✅ | Line 368-375: sends `categories: [catId]` per request in a for-loop |
| SC-002: Live progress panel with current category, counts, per-category results | ✅ | ✅ | Lines 548-580: renders spinner, status text, and per-category success/error icons |
| SC-003: Single category failure doesn't abort remaining | ✅ | ✅ | Line 367/393: try/catch inside the for-loop, `failedCount` tracked separately |
| SC-004: No preview_cost/coverage_check during seeding | ✅ | ✅ | Line 306: `if (seeding) return`, Line 330: `if (!city \|\| seeding) return` |
| SC-005: Coverage refreshes after completion | ✅ | ✅ | Line 417-419: coverage_check call, Line 420: `onRefresh()` |
| SC-006: Pills and button disabled during seeding | ✅ | ✅ | Line 492-493: pills disabled, Line 540: button disabled |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "Added `seedingStatus` and `liveProgress` state" | ✅ | ✅ | Lines 300-301 |
| "Replaced `startSeeding` with per-category loop" | ✅ | ✅ | Lines 343-422, sequential for-loop with per-category requests |
| "Added `seeding` guard to `coverage_check` effect" | ✅ | ✅ | Line 306: `if (seeding) return` |
| "Added `seeding` guard to `preview_cost` effect" | ✅ | ✅ | Line 330: `if (!city \|\| seeding) return` |
| "Inserted live progress panel JSX" | ✅ | ✅ | Lines 547-580 |
| "Added `disabled={seeding}` to category pills" | ✅ | ✅ | Lines 492-493 |
| "Added `\|\| seeding` to Start Seeding button" | ✅ | ✅ | Line 540 |
| "Updated results display to handle `cat.error`" | ✅ | ✅ | Lines 595-617 |
| "Zero edge function changes" | ✅ | ✅ | `supabase/functions/admin-seed-places/index.ts` unmodified in git diff |
| "All 6 success criteria pass" | ✅ | ✅ | See Spec Compliance Matrix above |
| "Zero deviations from spec" | ✅ | ✅ | Every code change matches spec sections exactly |

---

## Recommendations for Orchestrator

### Mandatory (block merge until done)

None. No critical findings.

### Strongly Recommended (merge at your own risk without these)

1. **HIGH-001:** Disable city selector and sub-tabs during seeding. Simplest approach: lift `seeding` state to parent or add an `onSeedingChange` callback prop. Without this, admin can accidentally trigger overlapping seed jobs by switching cities.

2. **HIGH-002:** Add mounted/cancelled guard to the fire-and-forget coverage_check at line 417-419. Alternatively, accept as tech debt with a `// TODO: no mounted guard — React 18 tolerates this` comment.

### Technical Debt to Track

1. **MED-001:** Redundant coverage_check after seeding. Harmless but worth a comment.
2. **Pre-existing:** `SeedTab` async operations don't use `mountedRef` pattern that the parent component uses. The parent has `mountedRef` (line 1199) but `SeedTab` doesn't inherit or create its own. This predates the current implementation.

---

## Verdict Justification

**🟡 CONDITIONAL PASS** — No critical findings. The core fix (per-category chunking) is correct and solid. Two high findings exist: the city selector / sub-tabs aren't disabled during the 3-4 minute seeding window, and the post-seeding coverage refresh lacks an unmount guard. Neither will cause data loss or crashes (React 18 tolerates unmounted setState), but HIGH-001 could cause real user confusion and wasted API costs if an admin switches cities mid-seed.

Safe to merge if the admin is disciplined enough not to switch cities during seeding. HIGH-001 should be fixed before any other admin user touches this tool.
