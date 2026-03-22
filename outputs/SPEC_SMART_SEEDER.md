# SPEC: Smart Seeder — Augmentation-Aware Place Pool Seeding

## Problem Statement (Plain English)

Right now the seeding tool has three problems:

1. **The dropdown only shows cities you've manually added to `seeding_cities`**. If a city already has places in `place_pool` (e.g., imported via ad-hoc search, or manually pushed), it won't appear in the dropdown — you can't manage or augment it.

2. **Re-seeding an existing city can demote it back to "draft"**. Line 829 of `admin-seed-places/index.ts`: if you re-seed and all places are duplicates (0 new inserted), the city status reverts from `seeded` → `draft`. This is wrong — the city is already fully seeded, you were just trying to fill gaps.

3. **No augmentation intelligence**. The tool doesn't know which categories or tiles have already been seeded. It blindly fires Google API calls for all selected categories across all tiles, even if 12 of 13 categories are already fully covered. This wastes API budget and provides no guidance about what's actually missing.

---

## Root Causes (Fact → Inference → Recommendation)

### RC1: Status reversion on re-seed

**Fact:** `admin-seed-places/index.ts:829`:
```typescript
const newStatus = summaryTotals.totalNewInserted > 0 ? "seeded" : "draft";
```
**Inference:** If all places already exist (duplicates), `totalNewInserted === 0`, so status reverts to `draft` even though the city has hundreds of places.
**Recommendation:** Never downgrade a city that's already `seeded`. Only upgrade: `draft` → `seeded` when places exist.

### RC2: Dropdown sourced only from `seeding_cities`

**Fact:** `PlacePoolManagementPage.jsx:1051`:
```javascript
supabase.from("seeding_cities").select("*").order("name")
```
**Inference:** Cities that have places in `place_pool` but no row in `seeding_cities` are invisible. This can happen if places were imported via ad-hoc search, API push, or pre-migration data.
**Recommendation:** Add an "auto-detect" feature that finds cities in `place_pool` that don't have a `seeding_cities` row and offers to register them. OR: show a combined view.

### RC3: No per-category coverage awareness

**Fact:** The seed action fires `tiles.length × categories.length` Google API calls regardless of what's already in `place_pool` for that city+category.
**Inference:** Re-seeding wastes budget. Admin has no way to see "nature_views has 45 places but flowers has 0" before deciding what to seed.
**Recommendation:** Before seeding, query `place_pool` for existing category coverage per city, show it in the UI, and optionally auto-select only categories with gaps.

---

## Implementation Plan

### Change 1: Fix status reversion (Edge Function)

**File:** `supabase/functions/admin-seed-places/index.ts`
**Line:** 829

**Before:**
```typescript
const newStatus = summaryTotals.totalNewInserted > 0 ? "seeded" : "draft";
```

**After:**
```typescript
// Never downgrade — if city was already 'seeded' or 'launched', keep it.
// Only upgrade from 'draft' to 'seeded' when new places were inserted.
const currentStatus = city.status;
let newStatus: string;
if (currentStatus === "launched") {
  newStatus = "launched"; // Never downgrade launched
} else if (currentStatus === "seeded") {
  newStatus = "seeded"; // Never downgrade seeded
} else {
  // Currently draft or seeding
  newStatus = summaryTotals.totalNewInserted > 0 ? "seeded" : "draft";
}
```

**Why:** This preserves the city's earned status. Re-seeding for augmentation (which produces 0 new + many duplicates) no longer damages the city record.

### Change 2: Category coverage preview (Edge Function)

**File:** `supabase/functions/admin-seed-places/index.ts`
**New action:** `coverage_check`

Add a new action that returns per-category place counts for a city, so the UI can show what's missing:

```typescript
async function handleCoverageCheck(body: any, supabase: any) {
  const { cityId } = body;
  if (!cityId) throw new Error("cityId is required");

  // Count places per seeding_category for this city
  const { data: rows, error } = await supabase
    .from("place_pool")
    .select("seeding_category")
    .eq("city_id", cityId)
    .eq("is_active", true);

  if (error) throw new Error(`Coverage check failed: ${error.message}`);

  // Tally per category
  const counts: Record<string, number> = {};
  for (const r of (rows || [])) {
    const cat = r.seeding_category || "unknown";
    counts[cat] = (counts[cat] || 0) + 1;
  }

  // Build coverage report with all 13 categories
  const coverage = ALL_SEEDING_CATEGORY_IDS.map((catId) => {
    const config = SEEDING_CATEGORY_MAP[catId];
    const count = counts[catId] || 0;
    return {
      categoryId: catId,
      label: config?.label ?? catId,
      appCategory: config?.appCategory ?? "",
      placeCount: count,
      hasGap: count < 10, // <10 places = gap
    };
  });

  const totalPlaces = Object.values(counts).reduce((s, n) => s + n, 0);
  const categoriesWithGaps = coverage.filter((c) => c.hasGap).length;

  return { cityId, totalPlaces, categoriesWithGaps, coverage };
}
```

**Add to switch statement:**
```typescript
case "coverage_check":
  return json(await handleCoverageCheck(body, supabase));
```

### Change 3: Show coverage in the Seed Tab UI (Admin Page)

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx`
**Component:** `SeedTab`

After city is selected, call `coverage_check` and display per-category counts next to the category pills. Categories with gaps get a visual indicator (red count badge). Categories already well-covered get a green checkmark.

**New state:**
```javascript
const [coverage, setCoverage] = useState(null);
```

**New effect (after city select):**
```javascript
useEffect(() => {
  if (!city) { setCoverage(null); return; }
  let cancelled = false;
  supabase.functions.invoke("admin-seed-places", {
    body: { action: "coverage_check", cityId: city.id },
  }).then(({ data }) => { if (!cancelled && data) setCoverage(data); });
  return () => { cancelled = true; };
}, [city]);
```

**Category pill enhancement:**
Each pill shows the count and whether it's a gap:
```jsx
{CATEGORY_LABELS[id]} ({coverage?.coverage?.find(c => c.categoryId === id)?.placeCount ?? "?"})
```
If `hasGap`, pill gets a warning ring. If not, a subtle checkmark.

**Auto-select gaps button:**
Add a "Select Only Gaps" button that sets `selectedCats` to only categories where `hasGap === true`.

### Change 4: Detect orphaned cities in place_pool (Admin Page)

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx`

Add an effect that checks for cities in `place_pool` that lack a `seeding_cities` row:

```javascript
// On load, check for orphan cities
useEffect(() => {
  (async () => {
    // Get distinct city names from place_pool that have no city_id
    const { data: orphans } = await supabase
      .from("place_pool")
      .select("city, country, lat, lng")
      .is("city_id", null)
      .not("city", "is", null)
      .limit(100);

    if (!orphans || orphans.length === 0) return;

    // Deduplicate by city+country
    const seen = new Set();
    const unique = orphans.filter((o) => {
      const key = `${o.city}|${o.country}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length > 0) setOrphanCities(unique);
  })();
}, [refreshKey]);
```

Show a banner: "X cities have places in the pool but aren't registered for seeding. Register them to manage coverage."

With a "Register" button per city that:
1. Inserts into `seeding_cities` (using avg lat/lng from their places)
2. Generates tiles
3. Updates all their `place_pool` rows with the new `city_id`

### Change 5: Smart cost preview that excludes already-seeded tile×category pairs

**File:** `supabase/functions/admin-seed-places/index.ts`
**Action:** `preview_cost`

Enhance to subtract tile×category pairs that already have completed operations with >0 places inserted. This gives an accurate "incremental cost" for augmentation runs.

Add optional `skipSeededTileCategories: boolean` param:

```typescript
// If skipSeededTileCategories, subtract completed ops from the cost
if (body.skipSeededTileCategories) {
  const { data: completedOps } = await supabase
    .from("seeding_operations")
    .select("seeding_category")
    .eq("city_id", cityId)
    .eq("status", "completed")
    .gt("places_new_inserted", 0);

  const seededCategorySet = new Set(
    (completedOps || []).map((o) => o.seeding_category)
  );
  // Remove fully-seeded categories from the cost calculation
  // (A category is "fully seeded" if it has at least one completed op with places)
  categoryIds = categoryIds.filter((id) => !seededCategorySet.has(id));
}
```

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `supabase/functions/admin-seed-places/index.ts` | Fix status reversion (line 829), add `coverage_check` action, enhance `preview_cost` with skip flag |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Show per-category coverage on pills, "Select Only Gaps" button, orphan city detection banner |

## Migration

No new migration needed. All changes are to edge function logic and admin UI.

## Verification

1. **Status fix:** Seed a city → status = "seeded". Re-seed same city with same categories → status stays "seeded" (not "draft").
2. **Coverage check:** Select a partially seeded city → pills show counts → gaps highlighted in red.
3. **Select Only Gaps:** Click button → only gap categories selected → cost preview drops.
4. **Orphan detection:** Push ad-hoc places without a city → banner appears → click Register → city appears in dropdown with tiles.

## Risk Assessment

- **Low risk:** Status fix is a straightforward logic guard, no data mutation.
- **Low risk:** `coverage_check` is read-only, no side effects.
- **Medium risk:** Orphan city registration involves writes to `seeding_cities` + bulk update of `place_pool.city_id`. Should be tested with small batches.
- **No API cost:** Coverage check queries Supabase only, zero Google API calls.
