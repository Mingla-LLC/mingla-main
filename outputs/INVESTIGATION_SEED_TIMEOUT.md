# Investigation: Seeding Job Failure (400s + 546)

## Symptom

Admin starts a seeding job. Loader appears. Console floods with 400 errors from `admin-seed-places`. Eventually a 546 status code appears. No results shown. No feedback about what happened.

## Root Cause Analysis

### RC1: Seeding is a synchronous HTTP request that takes minutes

**Fact:** The `seed` action in `admin-seed-places/index.ts` processes tiles sequentially within each category. For a city with 50 tiles and 13 categories: `50 tiles × 13 categories = 650 Google API calls`, each with 100ms delay between tiles. That's **65+ seconds minimum** just for delays, plus API response times.

**Fact:** `supabase.functions.invoke()` from the admin client sends a single HTTP POST and waits for the response. Browser default timeout is ~2 minutes. Supabase gateway may enforce its own limits.

**Fact:** Status code 546 is a Supabase-specific code indicating the edge function exceeded resource limits (memory or wall-clock time on the hosted platform).

**Inference:** A full-city seed operation exceeds what a single synchronous HTTP request can handle. This worked during initial development with smaller tile counts but fails at real city scale.

### RC2: UI keeps firing requests while seeding is in progress

**Fact:** `PlacePoolManagementPage.jsx` has these effects that fire on city/tab selection:
- `preview_cost` effect (line 326) — fires whenever `selectedCats` changes
- `coverage_check` effect (line 298) — fires whenever city changes
- Stats/ops loading effects — fire whenever `selectedCity` or `refreshKey` changes

**Fact:** During seeding, if the admin clicks a tab or the UI re-renders, these effects fire more `admin-seed-places` calls concurrently with the running seed job.

**Inference:** The flood of 400s in the console are these concurrent calls failing — possibly because the edge function is overloaded or the Supabase client's auth state is being shared across concurrent requests.

### RC3: No progress feedback

**Fact:** The `startSeeding` function (line 340) does:
```javascript
setSeeding(true);
// ... single await that takes minutes ...
setSeeding(false);
```

**Inference:** The user sees a loading spinner with zero progress information for several minutes, then either success or failure. No indication of which categories are done, how many tiles processed, or what went wrong.

## Fix Strategy

The seeding operation needs to be split into **per-category chunks** that each complete within a safe timeout window. Two approaches:

### Approach A: Client-Side Chunking (Simpler, Recommended)

Instead of sending one `seed` request with all categories, the admin UI sends one request **per category**. Each request seeds all tiles for a single category (~50 API calls = ~8 seconds + delays = ~13 seconds). This fits comfortably within any timeout.

**UI changes:**
1. Disable `preview_cost` and `coverage_check` calls while seeding is in progress
2. Loop through selected categories one at a time from the client
3. After each category completes, update a progress UI showing: which category just finished, how many new places, how many remain
4. If one category fails, continue to the next (don't abort everything)
5. At the end, show a summary of all categories

**Edge function changes:**
- Already supports single-category requests (`categories: ["nature_views"]`)
- No changes needed to the edge function itself

**Advantages:**
- No edge function changes needed
- Each request is short (~15 seconds)
- Progress is visible per-category
- A single category failure doesn't kill the whole job
- Browser can handle these sequentially without timeout

### Approach B: Background Job (More Complex)

Convert seeding to an async job: the `seed` action writes a job record to a `seeding_jobs` table and returns immediately. A separate scheduled function picks up the job and processes it. The UI polls the job status.

**Disadvantages:** Much more complex. Requires a new table, a new cron function, polling UI. Overkill for now.

## Recommended Implementation (Approach A)

### Change 1: Client-side per-category seeding loop

Replace `startSeeding` in `SeedTab`:

```javascript
const startSeeding = async () => {
  if (!city) return;
  const cats = Array.from(selectedCats);
  if (cats.length === 0) return;

  setSeeding(true);
  setProgress(null);

  const results = {};
  const totals = {
    totalApiCalls: 0, totalPlacesReturned: 0,
    totalNewInserted: 0, totalDuplicateSkipped: 0,
    totalRejected: { noPhotos: 0, closed: 0, excludedType: 0 },
    estimatedCostUsd: 0,
  };
  let completedCount = 0;

  for (const catId of cats) {
    // Update progress: "Seeding category X of Y..."
    setSeedingStatus(`Seeding ${CATEGORY_LABELS[catId]} (${completedCount + 1}/${cats.length})...`);

    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: {
          action: "seed",
          cityId: city.id,
          categories: [catId],
          acknowledgeHardCap: true,
        },
      });

      if (error) {
        results[catId] = { error: error.message || "Failed" };
      } else if (data?.perCategory?.[catId]) {
        const catResult = data.perCategory[catId];
        results[catId] = catResult;
        totals.totalApiCalls += catResult.apiCalls || 0;
        totals.totalPlacesReturned += catResult.placesReturned || 0;
        totals.totalNewInserted += catResult.newInserted || 0;
        totals.totalDuplicateSkipped += catResult.duplicateSkipped || 0;
        totals.totalRejected.noPhotos += catResult.rejected?.noPhotos || 0;
        totals.totalRejected.closed += catResult.rejected?.closed || 0;
        totals.totalRejected.excludedType += catResult.rejected?.excludedType || 0;
        totals.estimatedCostUsd += data.summary?.estimatedCostUsd || 0;
      }
    } catch (err) {
      results[catId] = { error: err.message };
    }
    completedCount++;
  }

  setProgress({ summary: totals, perCategory: results });
  setSeedingStatus(null);
  addToast({
    variant: totals.totalNewInserted > 0 ? "success" : "warning",
    title: "Seeding complete",
    description: `${totals.totalNewInserted} new places across ${cats.length} categories`,
  });

  // Refresh coverage
  supabase.functions.invoke("admin-seed-places", {
    body: { action: "coverage_check", cityId: city.id },
  }).then(({ data: cov }) => { if (cov) setCoverage(cov); });
  onRefresh();
  setSeeding(false);
};
```

### Change 2: Suppress concurrent calls during seeding

Add a guard to the `preview_cost` and `coverage_check` effects:

```javascript
// Preview cost — skip while seeding
useEffect(() => {
  if (!city || seeding) return;
  // ... existing logic
}, [city, selectedCats, seeding]);
```

### Change 3: Progress indicator during seeding

Replace the static loading spinner with a live progress display:

```jsx
{seeding && seedingStatus && (
  <SectionCard title="Seeding in Progress">
    <div className="flex items-center gap-3">
      <div className="animate-spin h-5 w-5 border-2 border-[var(--color-brand-500)] border-t-transparent rounded-full" />
      <span className="text-sm font-medium">{seedingStatus}</span>
    </div>
  </SectionCard>
)}
```

### Change 4: Handle partial progress in results display

The existing `progress` display already iterates `perCategory` — it will naturally show which categories succeeded and which errored. Just need to handle the `error` key:

```jsx
{cat.error && (
  <div className="text-sm text-[var(--color-error-700)]">Failed: {cat.error}</div>
)}
```

## Files to Modify

| File | Change |
|------|--------|
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Rewrite `startSeeding` to per-category loop, add progress state, suppress effects during seeding |

No edge function changes needed.
