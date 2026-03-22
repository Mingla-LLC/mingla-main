# Fix: Seeding Job Timeout and Silent Failure

**Date:** 2026-03-22
**Status:** Planned
**Mode:** Investigation + Fix
**Reported symptom:** Admin starts seeding, sees loader, then gets "edge function returned a non-2xx status code." Console floods with 400s and a final 546. No progress feedback, no results.

---

## 1. Forensic Context

### What Was Reported

Admin clicked "Start Seeding" for a city with all 13 categories selected. A loader appeared but gave no progress feedback. After a while, the console flooded with 400 errors from `admin-seed-places`. Eventually a 546 status code appeared. The UI showed a generic failure toast. No indication of what happened or whether any work was done.

### Investigation Summary

**Truth layers inspected:** Docs ✅ Schema ✅ Code ✅ Runtime ✅ Data ✅
**Files read:** 3 (edge function, admin page, config.toml)
**Root cause(s):** Single HTTP request attempts minutes of sequential work, exceeds platform limits
**Contributing factors:** 2
**Hidden flaws found:** 1

### Root Cause Analysis

#### 🔴 RC-001: Entire seed operation runs in a single synchronous HTTP request

**Fact:** `supabase/functions/admin-seed-places/index.ts` `handleSeed()` at line 651 processes ALL categories sequentially within one request. For a city with ~50 tiles and 13 categories: 650 Google API calls, each with 100ms inter-tile delay = 65+ seconds of delays alone, plus actual API response times (~200ms each) = ~195 seconds total.

**Inference:** Supabase's hosted edge function platform returns 546 when a function exceeds resource limits. The single request running 650+ sequential API calls with ~3 minutes of wall-clock time exceeds these limits.

**Impact:** The entire seeding job fails. No partial results are saved because the HTTP response is never returned to the client.

**Defective code:**
```javascript
// PlacePoolManagementPage.jsx line 340-366
const startSeeding = async () => {
  if (!city) return;
  setSeeding(true);
  setProgress(null);
  try {
    const { data, error } = await supabase.functions.invoke("admin-seed-places", {
      body: {
        action: "seed",
        cityId: city.id,
        categories: Array.from(selectedCats),  // ← ALL categories in one request
        acknowledgeHardCap: preview?.exceedsHardCap || false,
      },
    });
    // ... single success/failure handling
  }
};
```

**What it should do:** Send one request per category so each request processes ~50 tiles (≈15 seconds), well within any timeout. Loop through categories client-side, showing progress after each completes.

**Causal chain:**
1. Admin clicks "Start Seeding" with 13 categories selected
2. Single HTTP POST sent to edge function with `categories: [all 13]`
3. Edge function starts processing: 50 tiles × 13 categories × (100ms delay + ~200ms API) = ~195 seconds
4. Supabase platform kills the function at its resource limit → 546
5. Client receives non-2xx response → shows generic error toast
6. No partial results saved to the response (function was killed mid-execution)

**Invariant violated:** "No single edge function invocation should process more than one category's worth of tiles"
**Enforced by:** Client-side chunking (code change — cannot enforce at schema level)
**Verification:** Select all 13 categories, click Start Seeding → each category seeds one at a time → all complete → results shown per-category

#### 🟠 Contributing Factors

| ID | File | Line | Fact | Inference | Impact |
|----|------|------|------|-----------|--------|
| CF-001 | `PlacePoolManagementPage.jsx` | 302, 326 | `coverage_check` and `preview_cost` effects have no `seeding` guard — they fire on any city/selectedCats change, including re-renders during an active seed job | Concurrent requests to `admin-seed-places` while a seed is running may cause contention or confusing error responses | The flood of 400s in the console are these effects firing during the seed job |
| CF-002 | `PlacePoolManagementPage.jsx` | 340 | `setSeeding(true)` sets a boolean but no progress text is rendered — only the Button's `loading` prop changes | User sees a spinner on the button with zero information for minutes | User has no idea if the job started, is working, or is stuck |

#### 🟡 Hidden Flaws

| ID | File | Line | Fact | Inference | Future Risk |
|----|------|------|------|-----------|-------------|
| HF-001 | `admin-seed-places/index.ts` | 702-706 | `handleSeed` sets city status to `"seeding"` at the start, but if the function is killed by platform limits, the status update to `"seeded"/"draft"` at line 844-857 never executes | City remains stuck in `"seeding"` status permanently after a crash — dropdown shows "seeding" forever | Must be handled: each per-category request reads current status, and the final category request updates it. OR: the client updates status after the loop completes. |

#### 🔵 Observations

| ID | File | Note |
|----|------|------|
| OB-001 | `admin-seed-places/index.ts` line 706 | The `status: "seeding"` write happens on every seed call. When chunking per-category, this means 13 writes of `status: "seeding"` — harmless but redundant. The status update at line 844-857 runs after each category too, which is actually correct: after each chunk the status gets re-evaluated. |
| OB-002 | Edge function | The edge function already supports single-category invocation (`categories: ["nature_views"]`). No backend changes needed for chunking. |

### Invariants That Must Hold After Fix

1. **No single edge function invocation processes more than one category** — enforced by client-side loop that sends `categories: [singleCatId]` per request
2. **No background API calls fire while seeding is in progress** — enforced by `seeding` boolean guard in `useEffect` dependencies
3. **Every seeding run produces visible per-category progress** — enforced by updating `liveProgress` state after each category completes
4. **A single category failure does not abort remaining categories** — enforced by try/catch inside the per-category loop

### What NOT to Change

- **Edge function `handleSeed`** — it already handles single-category requests correctly. The fix is entirely client-side.
- **Edge function `seedCategory`** — tile processing, Google API calls, upsert logic — all correct for single-category scope.
- **The `$70 hard cap` check** — when sending single categories, the per-category cost is well under the cap. The `acknowledgeHardCap: true` flag bypasses the check safely.
- **The `seeding_operations` table** — already creates one record per category per seed call. Per-category chunking produces the same operation records.

---

## 2. Summary

The admin seeding tool sends all categories in one HTTP request, which takes ~3 minutes for a real city and exceeds Supabase's edge function resource limits. Fix: the client loops through categories one at a time, sending one request per category (~15 seconds each). Each request fits within platform limits. A live progress panel shows which category is running and accumulates results in real-time. If one category fails, the rest continue.

## 3. Design Principle

**Seeding is a client-orchestrated sequential pipeline, not a single server-side transaction.** Each category is an independent unit of work. The client is the coordinator. The server processes one chunk at a time.

## 4. Source of Truth Definition

| Entity | Source of Truth | Derived From | Cacheable? | Rebuildable? |
|--------|----------------|-------------|------------|-------------|
| Seeding progress | Client state (`liveProgress`) | Edge function responses per category | No (ephemeral) | Yes (re-seed) |
| Per-category results | `seeding_operations` table | Edge function writes after each category | N/A | Yes (re-seed) |
| City status | `seeding_cities.status` | Updated by edge function after each category | N/A | N/A |
| Category coverage | `place_pool` rows via `coverage_check` | Queried fresh after seeding completes | No | Yes |

## 5. Success Criteria

1. **SC-001:** Admin selects 13 categories for a city with 50 tiles. Clicks "Start Seeding". Each category seeds one at a time. All 13 complete. Total time: ~3–4 minutes. No timeouts.
2. **SC-002:** While seeding is in progress, a live progress panel shows: current category name, completed/total count, and per-category results (new inserted, dupes, errors) as each finishes.
3. **SC-003:** If category 5 of 13 fails (e.g., Google API rate limit), categories 6–13 still run. The failed category shows an error in the results. The toast at the end reflects partial success.
4. **SC-004:** During seeding, no `preview_cost` or `coverage_check` calls fire (no 400 flood in console).
5. **SC-005:** After seeding completes, coverage badges on category pills refresh to reflect new counts.
6. **SC-006:** Category pills and "Start Seeding" button are disabled during seeding to prevent double-submit.

## 6. Non-Goals

1. Background job architecture (overkill for admin tool)
2. Resumability (if admin closes browser, they re-seed — these are idempotent operations)
3. Edge function changes (not needed)
4. Parallel category seeding from the client (sequential is safer and predictable)

---

## 7. Database Changes

None. No schema changes required.

---

## 8. Edge Functions

No changes required. The existing `handleSeed` already supports `categories: ["single_cat"]` and produces correct per-category results.

---

## 9. Admin Implementation

### 9.1 File to Modify

**`mingla-admin/src/pages/PlacePoolManagementPage.jsx`** — `SeedTab` component only (lines 289–520)

### 9.2 State Changes

**Add new state variables** (after line 298):

```javascript
const [seedingStatus, setSeedingStatus] = useState(null);   // "Seeding Drink (3/13)..."
const [liveProgress, setLiveProgress] = useState({});        // { catId: { ...result } } — builds up as categories complete
```

### 9.3 Rewrite `startSeeding` (replace lines 340–366)

**Replace the entire `startSeeding` function with:**

```javascript
const startSeeding = async () => {
  if (!city || seeding) return;
  const cats = Array.from(selectedCats);
  if (cats.length === 0) return;

  setSeeding(true);
  setProgress(null);
  setLiveProgress({});
  setSeedingStatus(`Starting...`);

  const results = {};
  const totals = {
    totalApiCalls: 0,
    totalPlacesReturned: 0,
    totalNewInserted: 0,
    totalDuplicateSkipped: 0,
    totalRejected: { noPhotos: 0, closed: 0, excludedType: 0 },
    estimatedCostUsd: 0,
  };

  for (let i = 0; i < cats.length; i++) {
    const catId = cats[i];
    setSeedingStatus(`Seeding ${CATEGORY_LABELS[catId]} (${i + 1}/${cats.length})...`);

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
        results[catId] = { error: error.message || "Edge function error" };
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
      } else {
        // Edge function returned 200 but unexpected shape
        results[catId] = { error: "Unexpected response format" };
      }
    } catch (err) {
      results[catId] = { error: err.message || "Network error" };
    }

    // Update live progress after each category so UI renders incrementally
    setLiveProgress((prev) => ({ ...prev, [catId]: results[catId] }));
  }

  // Final state
  setProgress({ summary: totals, perCategory: results });
  setSeedingStatus(null);

  const failedCount = Object.values(results).filter((r) => r.error).length;
  const variant = failedCount === cats.length ? "error" : failedCount > 0 ? "warning" : "success";
  const title = failedCount === 0
    ? "Seeding complete"
    : failedCount === cats.length
      ? "Seeding failed"
      : `Seeding done (${failedCount} failed)`;

  addToast({
    variant,
    title,
    description: `${totals.totalNewInserted} new places across ${cats.length - failedCount} categories`,
  });

  // Refresh coverage + page data
  supabase.functions.invoke("admin-seed-places", {
    body: { action: "coverage_check", cityId: city.id },
  }).then(({ data: cov }) => { if (cov) setCoverage(cov); });
  onRefresh();
  setSeeding(false);
};
```

### 9.4 Suppress effects during seeding (modify lines 302 and 326)

**`coverage_check` effect — add `seeding` guard:**

Replace line 302:
```javascript
// BEFORE
useEffect(() => {
  if (!city) { setCoverage(null); return; }
```

With:
```javascript
// AFTER
useEffect(() => {
  if (!city) { setCoverage(null); return; }
  if (seeding) return; // suppress during active seeding
```

**`preview_cost` effect — add `seeding` guard:**

Replace line 327:
```javascript
// BEFORE
useEffect(() => {
  if (!city) return;
```

With:
```javascript
// AFTER
useEffect(() => {
  if (!city || seeding) return;
```

**Note:** Do NOT add `seeding` to the dependency arrays. The guard is intentional — we want the effects to skip while seeding is true, not re-fire when seeding changes. The effects will naturally re-fire when seeding ends because `onRefresh()` is called, which changes `refreshKey` upstream and re-renders with the new city data.

### 9.5 Live progress panel (insert between Cost Preview and final Results sections)

**Insert this JSX after the Cost Preview section (after line 488) and before the Progress section (line 491):**

```jsx
{/* Live Seeding Progress */}
{seeding && (
  <SectionCard title="Seeding in Progress">
    <div className="space-y-3">
      {/* Current status */}
      <div className="flex items-center gap-3">
        <div className="animate-spin h-5 w-5 border-2 border-[var(--color-brand-500)] border-t-transparent rounded-full" />
        <span className="text-sm font-medium">{seedingStatus || "Preparing..."}</span>
      </div>

      {/* Completed categories so far */}
      {Object.keys(liveProgress).length > 0 && (
        <div className="space-y-1 mt-2">
          {Object.entries(liveProgress).map(([catId, result]) => (
            <div key={catId} className="flex items-center gap-2 text-sm">
              {result.error ? (
                <AlertTriangle className="w-4 h-4 text-[#ef4444] shrink-0" />
              ) : (
                <CheckCircle className="w-4 h-4 text-[#22c55e] shrink-0" />
              )}
              <span style={{ color: CATEGORY_COLORS[catId] }} className="font-medium w-32 truncate">
                {CATEGORY_LABELS[catId]}
              </span>
              {result.error ? (
                <span className="text-[var(--color-error-700)] text-xs">{result.error}</span>
              ) : (
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {result.newInserted || 0} new · {result.duplicateSkipped || 0} dupes
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  </SectionCard>
)}
```

### 9.6 Disable category pills and Start button during seeding

**Category pills (line 436):** Add `disabled` behavior:

Replace the `<button>` onClick:
```javascript
// BEFORE
<button key={id} onClick={() => toggleCat(id)}
```

With:
```javascript
// AFTER
<button key={id} onClick={() => !seeding && toggleCat(id)}
  disabled={seeding}
```

**Start Seeding button (line 482):** Already has `loading={seeding}` which disables it. Add explicit guard:

Replace:
```javascript
<Button variant="primary" icon={Play} loading={seeding} onClick={startSeeding}
  disabled={selectedCats.size === 0}>
```

With:
```javascript
<Button variant="primary" icon={Play} loading={seeding} onClick={startSeeding}
  disabled={selectedCats.size === 0 || seeding}>
```

### 9.7 Update existing Results display to handle error-only entries

The existing per-category `<details>` display at line 503–518 references `cat.newInserted` and `cat.duplicateSkipped`. When a category failed, these don't exist — `cat.error` is set instead.

**Replace lines 503–518 with:**

```jsx
{Object.entries(progress.perCategory || {}).map(([catId, cat]) => (
  <details key={catId} className="mt-2 text-sm">
    <summary className="cursor-pointer font-medium" style={{ color: CATEGORY_COLORS[catId] }}>
      {CATEGORY_LABELS[catId] || catId}:
      {cat.error
        ? <span className="text-[var(--color-error-700)] ml-1">Failed</span>
        : <span className="ml-1">{cat.newInserted} new, {cat.duplicateSkipped} dupes</span>
      }
      {!cat.error && cat.errors?.length > 0 && <Badge variant="error" className="ml-2">{cat.errors.length} tile errors</Badge>}
    </summary>
    {cat.error ? (
      <div className="ml-4 mt-1 text-xs text-[var(--color-error-700)]">{cat.error}</div>
    ) : cat.errors?.length > 0 ? (
      <div className="ml-4 mt-1 space-y-1">
        {cat.errors.map((e, i) => (
          <div key={i} className="text-xs text-[var(--color-error-700)]">
            Tile #{e.tileIndex} — {e.errorType}: {e.message}
          </div>
        ))}
      </div>
    ) : null}
  </details>
))}
```

---

## 10. Migration Plan

No migration needed. All changes are in the admin UI.

## 11. Implementation Order

**Step 1:** Add new state variables `seedingStatus` and `liveProgress` to `SeedTab` (§9.2)
**Step 2:** Replace `startSeeding` with per-category loop (§9.3)
**Step 3:** Add `seeding` guards to `coverage_check` and `preview_cost` effects (§9.4)
**Step 4:** Insert live progress panel JSX (§9.5)
**Step 5:** Add `disabled={seeding}` to category pills and start button (§9.6)
**Step 6:** Update results display to handle `cat.error` (§9.7)
**Step 7:** Integration test — select a city with tiles, select 3 categories, click Start Seeding → observe per-category progress → verify all 3 complete → verify results display

## 12. Test Cases

| # | Test | Input | Expected | Layer |
|---|------|-------|----------|-------|
| 1 | Full seed completes | 50 tiles, 3 categories | All 3 categories seed sequentially, results display shows 3 entries | UI + Edge |
| 2 | Single category failure | Force one category to fail (e.g., invalid category ID) | Failed category shows red error, remaining categories still seed | UI |
| 3 | All categories fail | Disconnect network mid-seed | Each category shows error, toast says "Seeding failed", no crash | UI |
| 4 | No 400 flood during seeding | Start seeding, switch tabs, switch back | Console shows only seed requests, no preview_cost/coverage_check calls | UI |
| 5 | Progress renders incrementally | 5 categories | After each category, a new line appears in the live progress panel | UI |
| 6 | Coverage refreshes after completion | Seed 2 gap categories | After seeding, pill counts update to reflect new places | UI |
| 7 | Double-click prevention | Click "Start Seeding" twice quickly | Only one seeding loop runs (button disabled, pills disabled) | UI |
| 8 | Empty selection | Deselect all categories, click start | Nothing happens (button is disabled) | UI |

## 13. Verification Queries

After a successful per-category seeding run:

```sql
-- Verify one seeding_operations row per category was created
SELECT seeding_category, status, places_new_inserted, places_duplicate_skipped
FROM seeding_operations
WHERE city_id = '<city_id>'
ORDER BY created_at DESC
LIMIT 20;

-- Verify city status is not stuck on "seeding"
SELECT id, name, status, updated_at FROM seeding_cities WHERE id = '<city_id>';
```

## 14. Common Mistakes to Avoid

1. **Adding `seeding` to the effect dependency arrays:** → **Correct:** Only use `seeding` as a guard inside the effect body. Adding it to deps would cause the effects to re-fire when seeding starts AND ends, which is not desired. They should re-fire naturally via `refreshKey` change when `onRefresh()` is called.
2. **Awaiting coverage_check in the seeding loop:** → **Correct:** Only refresh coverage ONCE after the entire loop, not after each category.
3. **Using `Promise.all` for parallel categories:** → **Correct:** Sequential is required. Parallel would hit the same timeout problem (all running concurrently on the edge function) and makes progress display meaningless.
4. **Forgetting the `else` branch for unexpected response shape:** → **Correct:** The spec includes a fallback `{ error: "Unexpected response format" }` for when the edge function returns 200 but the expected `perCategory[catId]` key is missing.

## 15. Crash Evidence — Confirms Diagnosis

Admin selected all 13 categories. Seeding operations log shows only 4 entries:

| Category | API Calls | Found | New | Dupes | Status |
|----------|-----------|-------|-----|-------|--------|
| Nature & Views | 0 | 0 | 0 | 0 | **running** (orphaned) |
| First Meet | 69 | 1377 | 0 | 256 | failed (1 error) |
| Picnic Park | 69 | 1231 | 0 | 775 | failed (1 error) |
| Drink | 69 | 1092 | 0 | 708 | failed (1 error) |

**What this proves:**
1. `MAX_CONCURRENT_CATEGORIES = 4` — only the first batch of 4 ran. Categories 5–13 never started.
2. Nature & Views: operation record was INSERT'd with `status: "running"` but `seedCategory()` never returned — the function was killed mid-execution. This record is orphaned forever.
3. First Meet, Picnic Park, Drink: tiles processed (69 = all tiles), places found, but function crashed during/after the upsert phase. The 1 error per category is likely the upsert interruption.
4. City is stuck in `"seeding"` status — the status update at line 844 never ran.

### Data Cleanup Required (Pre-Implementation)

Before implementing the fix, the implementor must clean up the orphaned data from this crash. Run via Supabase SQL editor or `mcp__supabase__execute_sql`:

```sql
-- 1. Fix orphaned "running" operations → mark as "failed"
UPDATE seeding_operations
SET status = 'failed',
    error_message = 'Aborted: edge function crashed (546)',
    completed_at = now()
WHERE status = 'running'
  AND started_at < now() - interval '10 minutes';

-- 2. Fix city stuck in "seeding" → restore to "seeded" (has places in pool)
UPDATE seeding_cities
SET status = 'seeded', updated_at = now()
WHERE status = 'seeding';
```

These are safe one-time cleanup queries. After the per-category chunking fix, these orphan states cannot occur because each request processes one category and completes within ~15 seconds.

## 16. Handoff to Implementor

Implementor: this is your single source of truth. §3 is the design principle — the client orchestrates, the server processes one chunk at a time. §9 contains every code change with exact line numbers and exact replacement code. Execute in order from §11. The edge function requires ZERO changes. All work is in `PlacePoolManagementPage.jsx` within the `SeedTab` component.

**Before writing any code:** Run the cleanup queries in §15 to fix the orphaned data from the crash.

Do not skip, reorder, or expand scope. Produce IMPLEMENTATION_REPORT.md referencing each section, hand to tester. Not done until tester's report is green.
