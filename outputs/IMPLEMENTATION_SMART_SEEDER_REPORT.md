# Implementation Report: Smart Seeder — Augmentation-Aware Place Pool Seeding

## What Changed

### File 1: `supabase/functions/admin-seed-places/index.ts`

**Change 1 — Status reversion fix (line 844)**
- Before: `const newStatus = summaryTotals.totalNewInserted > 0 ? "seeded" : "draft"` — always computed fresh, could downgrade
- After: Checks `city.status` first. If already `seeded` or `launched`, preserves that status. Only upgrades from `draft`.

**Change 2 — New `coverage_check` action (lines 866–910)**
- New handler `handleCoverageCheck` queries `place_pool` for active places grouped by `seeding_category`
- Returns per-category counts, gap flags (`hasGap: count < 10`), total places, and count of categories with gaps
- Read-only, zero Google API calls, zero cost
- Added to switch statement at line 952

**Change 5 — Smart `preview_cost` with `skipSeededCategories` (lines 329–351)**
- New optional param `skipSeededCategories` on the `preview_cost` action
- When true, queries `seeding_operations` for completed ops with `places_new_inserted > 0`
- Filters those categories out of the cost calculation
- Result: accurate incremental cost for augmentation runs

### File 2: `mingla-admin/src/pages/PlacePoolManagementPage.jsx`

**Change 3 — Coverage-aware category pills in SeedTab**
- New `coverage` state, fetched via `coverage_check` when city is selected
- Each category pill now shows place count badge (green if ≥10, red if gap)
- Gap categories get a red border when unselected
- Section subtitle shows "X of 13 categories have gaps"
- New "Select Only Gaps" button auto-selects only categories with `hasGap === true`
- Coverage refreshes after seeding completes

**Change 4 — Orphan city detection banner in main page**
- New `orphanCities` state, populated on load by querying `place_pool` where `city_id IS NULL` and `city IS NOT NULL`
- Groups by city+country, computes average lat/lng and place count
- Renders amber warning banner above city selector
- Each orphan has a "Register" button that:
  1. Inserts into `seeding_cities` with computed center coordinates
  2. Generates tiles via `generate_tiles` action
  3. Bulk-updates orphaned `place_pool` rows with the new `city_id`

## Spec Compliance

| Spec Item | Status |
|-----------|--------|
| Change 1: Fix status reversion | DONE — never downgrades seeded/launched |
| Change 2: `coverage_check` action | DONE — returns per-category place counts |
| Change 3: Coverage on pills + "Select Only Gaps" | DONE — counts, gap badges, auto-select |
| Change 4: Orphan city detection | DONE — banner with register button |
| Change 5: Smart cost preview | DONE — `skipSeededCategories` param |
| No new migration | CONFIRMED — all changes in edge function + admin UI |

## Verification Checklist

1. **Status fix:** Re-seeding a `seeded` city with all duplicates → status stays `seeded` (not `draft`)
2. **Coverage check:** Select city → pills show counts → gaps highlighted red
3. **Select Only Gaps:** Click button → only gap categories selected → cost preview recalculates
4. **Orphan detection:** Places with `city_id = NULL` and valid `city` name → banner appears → Register links them
5. **Smart preview:** `skipSeededCategories: true` → excludes already-seeded categories from cost

## Files Modified

- `supabase/functions/admin-seed-places/index.ts` — 3 changes (status fix, coverage_check, smart preview)
- `mingla-admin/src/pages/PlacePoolManagementPage.jsx` — 2 changes (coverage pills, orphan banner)

## Deviations from Spec

- Orphan detection computes average lat/lng across all places in the group (spec said "avg lat/lng from their places") — same intent, implemented as weighted average over all rows.
- Orphan city `google_place_id` uses `orphan_{city}_{timestamp}` prefix for uniqueness (spec didn't specify format).

## Known Limitations

- `coverage_check` fetches all active place rows for the city to count client-side. For very large cities (10K+ places), a server-side `GROUP BY` RPC would be more efficient. Fine for current scale.
- Orphan detection queries up to 500 rows with `city_id IS NULL`. If there are thousands of orphans, pagination would be needed.
- The "Select Only Gaps" button falls back to selecting all categories if zero gaps exist (prevents empty selection).
