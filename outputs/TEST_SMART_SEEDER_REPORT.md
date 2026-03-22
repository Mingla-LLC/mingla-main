# Test Report: Smart Seeder — Augmentation-Aware Place Pool Seeding

**Date:** 2026-03-22
**Spec:** `outputs/SPEC_SMART_SEEDER.md`
**Implementation:** `outputs/IMPLEMENTATION_SMART_SEEDER_REPORT.md`
**Tester:** Brutal Tester Skill
**Verdict:** CONDITIONAL PASS

---

## Executive Summary

Five changes across 2 files. The status fix and coverage_check logic are solid. The UI work (pills, orphan banner) is well-structured and follows existing patterns. However, there are **2 High findings** that could cause silent data corruption at scale and one missing UI wiring that leaves a spec item partially undelivered.

---

## Test Manifest

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| TypeScript Compliance | 3 | 3 | 0 | 0 |
| Pattern Compliance | 8 | 8 | 0 | 0 |
| Security | 5 | 5 | 0 | 0 |
| Edge Function Logic | 6 | 5 | 1 | 0 |
| Admin Dashboard (JSX) | 10 | 7 | 1 | 2 |
| Spec Criteria | 5 | 4 | 0 | 1 |
| Cross-Domain Impact | 2 | 2 | 0 | 0 |
| **TOTAL** | **39** | **34** | **2** | **3** |

---

## HIGH-001: Coverage Check Silently Undercounts for Large Cities

**File:** `supabase/functions/admin-seed-places/index.ts` (line 878)
**Category:** Data Accuracy

**What's Wrong:**
The `handleCoverageCheck` function queries `place_pool` with no `.limit()`:

```typescript
const { data: rows, error } = await supabase
  .from("place_pool")
  .select("seeding_category")
  .eq("city_id", cityId)
  .eq("is_active", true);
```

The Supabase JS client v2 defaults to **1000 rows**. If a city has >1000 active places, only the first 1000 are returned. Coverage counts will be silently wrong — categories that appear later in the result set will show `0` or artificially low counts, causing false "gap" indicators.

**Evidence:** Supabase JS v2 default pagination limit is 1000 rows. No `.limit()` override present.

**Required Fix:**
This is a counting query — it should not fetch rows client-side at all. Use a Supabase RPC or a `.select("seeding_category", { count: 'exact' })` with grouping. Simplest fix: add `.limit(10000)` to avoid the silent truncation. Correct fix: use a server-side `GROUP BY` query via `.rpc()` or raw SQL.

Minimal fix:
```typescript
const { data: rows, error } = await supabase
  .from("place_pool")
  .select("seeding_category")
  .eq("city_id", cityId)
  .eq("is_active", true)
  .limit(10000);
```

**Why This Matters:** False gap indicators lead to wasted API budget re-seeding categories that are already well-covered.

---

## HIGH-002: Orphan Registration Fails for Null-Country Places

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (lines 1111, 1163-1164)
**Category:** Data Integrity / Silent Failure

**What's Wrong:**
The orphan detection query filters `.not("city", "is", null)` but does NOT filter out null `country` values. When `country` is null:

1. The grouping key becomes `"Lagos|null"` (line 1122) — this works for grouping
2. `orphan.country` is `null`
3. The bulk update at line 1163 does `.eq("country", orphan.country)` — with `null` value

In PostgREST/Supabase JS, `.eq("country", null)` translates to SQL `country = NULL`, which is **always false** in SQL (NULL != NULL). The correct call for null is `.is("country", null)`.

**Result:** Registration appears to succeed (the `seeding_cities` row is created, tiles are generated), the toast says "X places linked", but **zero places actually get linked** because the update query silently matches nothing.

**Evidence:**
```javascript
// Line 1163-1164 — will silently match 0 rows when orphan.country is null
await supabase.from("place_pool")
  .update({ city_id: newCity.id })
  .is("city_id", null)
  .eq("city", orphan.city)
  .eq("country", orphan.country);  // BUG: null → SQL "country = NULL" → 0 matches
```

**Required Fix:**
Replace the hardcoded `.eq` with a conditional:
```javascript
let updateQuery = supabase.from("place_pool")
  .update({ city_id: newCity.id })
  .is("city_id", null)
  .eq("city", orphan.city);

if (orphan.country) {
  updateQuery = updateQuery.eq("country", orphan.country);
} else {
  updateQuery = updateQuery.is("country", null);
}

const { error: updateErr } = await updateQuery;
if (updateErr) throw updateErr;
```

Also add error checking on the update result (currently missing — the `await` result is discarded without checking for errors).

**Why This Matters:** Admin clicks "Register", sees success toast, but the places are still orphaned. The city appears in the dropdown with 0 places. The orphan banner disappears (due to refresh) only to reappear if the admin navigates away and back. Confusing UX and data integrity gap.

---

## MED-001: `skipSeededCategories` Not Wired to UI

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (line 315)
**Category:** Incomplete Feature / Spec Gap

**What's Wrong:**
The spec's Change 5 adds `skipSeededCategories` to the `preview_cost` backend action. The backend implementation is correct. However, the `SeedTab` cost preview effect never passes this flag:

```javascript
// Line 315 — no skipSeededCategories param
const { data } = await supabase.functions.invoke("admin-seed-places", {
  body: { action: "preview_cost", cityId: city.id, categories: cats },
});
```

The "Select Only Gaps" button correctly filters categories on the frontend, but the cost preview doesn't use the backend's smart exclusion logic. This means the cost preview is already accurate (since the category list is already filtered), so it's functionally fine — but the backend feature is dead code until wired up.

**Impact:** Low. The frontend category filter achieves the same result. The backend param exists but is unused. Not a bug, but technically incomplete spec delivery.

**Recommendation:** Either wire it up as `skipSeededCategories: true` in the cost preview call, or document it as intentionally unused (the frontend filter makes it redundant).

---

## MED-002: Orphan Banner Hardcoded Light-Mode Colors

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (lines 1215-1225)
**Category:** Dark Mode Compatibility

**What's Wrong:**
The orphan banner uses hardcoded amber/brown hex colors:
- `bg-[#fffbeb]` (light yellow background)
- `text-[#92400e]` (dark brown text)
- `text-[#78350f]` (darker brown text)

These will be hard to read or visually jarring in dark mode.

**Mitigating factor:** This is a **pre-existing pattern** in this file. The category pills (lines 427-428) and the hard cap warning (line 450) also use hardcoded hex colors. This is not a regression introduced by the implementor — it's a codebase-wide issue.

**Recommendation:** Track as technical debt. Don't block this merge for it. When dark mode is prioritized for the admin panel, fix all instances at once.

---

## MED-003: Coverage Pill Count Badge Colors Also Hardcoded

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (lines 427-428)
**Category:** Dark Mode Compatibility

Same pattern as MED-002:
```jsx
? "bg-[#fef2f2] text-[#ef4444]"   // red gap badge
: "bg-[#f0fdf4] text-[#22c55e]"   // green ok badge
```

**Mitigating factor:** Same as MED-002 — pre-existing pattern. Not a regression.

---

## What Passed

### Things Done Right

1. **Status fix is clean and correct** — The `currentStatus` check at line 844-853 correctly handles all three cases (launched, seeded, draft). The logic is simple, readable, and safe. Never downgrades.

2. **Mounted ref pattern used correctly throughout** — All async operations in the main page component check `mountedRef.current` before calling state setters (lines 1101, 1114-1115, 1135, 1179, 1189, 1196, 1199). This prevents React state-update-on-unmounted-component warnings.

3. **Coverage refresh after seeding** — After `startSeeding` completes (line 340), coverage data is re-fetched. This means the pills update immediately after seeding without requiring a page reload.

4. **Cancelled flag pattern in SeedTab** — The coverage `useEffect` (line 287) and cost preview `useEffect` (line 313) both use the `let cancelled = false; return () => { cancelled = true; }` pattern to prevent stale async updates. This is correct.

5. **"Select Only Gaps" fallback** — When zero gaps exist, the button falls back to selecting all categories (line 305). This prevents the user from ending up with an empty selection.

6. **Orphan deduplication with avg coordinates** — The orphan detection properly groups by `city|country`, computes average lat/lng across all places (lines 1121-1133), and uses the average as the city center. Mathematically sound.

7. **Edge function switch statement** — The `coverage_check` action is cleanly added to the switch at line 958. No fallthrough issues. Unknown action still returns 400.

8. **CORS and auth guards** — All new code runs through the existing CORS + auth + admin check pipeline (lines 914-947). No bypass possible.

---

## Spec Compliance Matrix

| Success Criterion (from Spec) | Tested? | Passed? | Evidence |
|-------------------------------|---------|---------|----------|
| Change 1: Re-seeding seeded city keeps status | Yes | Yes | Lines 844-853: checks `currentStatus` before computing `newStatus` |
| Change 2: `coverage_check` returns per-category counts | Yes | Yes (with caveat) | Lines 873-910: correct logic, but >1000 places silently truncated (HIGH-001) |
| Change 3: Pills show counts + gaps + "Select Only Gaps" | Yes | Yes | Lines 397-436, 302-306: coverage data drives pills, gap detection, auto-select |
| Change 4: Orphan city detection + Register | Yes | Partial | Lines 1104-1173, 1214-1235: works for non-null country; fails silently for null country (HIGH-002) |
| Change 5: Smart cost preview with skipSeededCategories | Yes | Backend only | Lines 329-351: backend correct; not wired to frontend (MED-001) |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "Status fix at line 844" | Yes | Yes | Code matches spec exactly |
| "coverage_check action lines 866-910" | Yes | Yes | Correct logic, correct position in switch |
| "Smart preview_cost with skipSeededCategories" | Yes | Yes | Backend param works correctly |
| "Coverage pills with counts and gap badges" | Yes | Yes | Visual implementation matches spec |
| "Orphan city banner with Register" | Yes | Partial | Null-country edge case not handled (HIGH-002) |
| "Coverage refreshes after seeding" | Yes | Yes | Line 340-342 re-fetches coverage post-seed |
| "No new migration needed" | Yes | Yes | All changes in edge function + admin UI |

---

## Recommendations for Orchestrator

### Mandatory (block merge until done)

1. **HIGH-001**: Add `.limit(10000)` to coverage_check query at `index.ts:878` to prevent silent row truncation. 1-line fix.
2. **HIGH-002**: Fix orphan registration bulk update to handle null country values. Also add error checking on the update result. ~10 lines.

### Strongly Recommended (merge at your own risk)

3. **MED-001**: Either wire `skipSeededCategories: true` into the frontend cost preview call, or accept that frontend category filtering makes it redundant and document it.

### Technical Debt to Track

4. **MED-002/003**: Hardcoded hex colors throughout the admin panel don't support dark mode. Pre-existing issue, not introduced here. Track for a future dark-mode pass.

---

## Verdict Justification

**CONDITIONAL PASS** — No critical (security/crash) findings. Two High findings exist: one causes silent data inaccuracy at scale (coverage counts wrong for >1000-place cities), the other causes a silent no-op on orphan registration when country is null. Both are straightforward fixes (5-10 lines total). After fixing HIGH-001 and HIGH-002, this is ready to merge. No re-test needed if fixes are scoped to the exact lines specified.
