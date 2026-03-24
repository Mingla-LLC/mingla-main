# Test Report: Sequential Batch Seeding

**Date:** 2026-03-24
**Spec:** `outputs/FEATURE_SEQUENTIAL_BATCH_SEEDING_SPEC.md`
**Implementation:** `outputs/IMPLEMENTATION_SEQUENTIAL_BATCH_SEEDING_REPORT.md`
**Tester:** Brutal Tester Skill
**Verdict:** 🟡 CONDITIONAL PASS

---

## Executive Summary

Solid implementation. The core batch-by-batch seeding flow, migration, RLS, and UI are well-built and match the spec. Found 1 high-severity data integrity bug (`cancel_run` doesn't update `skipped_batches` counter), 1 spec deviation not flagged by implementor (missing StatsTab batch filters), and a few medium/low items. No security issues. No critical findings.

---

## Test Manifest

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| Security | 8 | 8 | 0 | 0 |
| Database & RLS | 9 | 9 | 0 | 0 |
| Edge Functions | 22 | 20 | 1 | 1 |
| Google Places API | 6 | 6 | 0 | 0 |
| Admin UI (Pattern) | 12 | 11 | 0 | 1 |
| Spec Criteria | 14 | 13 | 1 | 0 |
| Cross-Domain | 4 | 4 | 0 | 0 |
| **TOTAL** | **75** | **71** | **2** | **2** |

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: `cancel_run` Does Not Update `skipped_batches` Counter

**File:** `supabase/functions/admin-seed-places/index.ts` (lines 1478-1493)
**Category:** Data Integrity

**What's Wrong:**
`handleCancelRun` marks all pending batches as `skipped` in `seeding_batches`, then marks the run as `cancelled` — but never counts the skipped batches or updates `seeding_runs.skipped_batches`. The counter stays at whatever it was before cancellation.

**Evidence:**
```typescript
// Line 1478-1493 — marks batches skipped, updates run status, but:
// NEVER touches run.skipped_batches
await supabase
  .from("seeding_runs")
  .update({
    status: "cancelled",
    current_batch_index: null,
    completed_at: new Date().toISOString(),
    // ← missing: skipped_batches: run.total_batches - run.completed_batches - run.failed_batches
  })
  .eq("id", runId);
```

Compare with `handleSkipBatch` (line 1451) which correctly increments `skipped_batches: (run.skipped_batches || 0) + 1`.

**Required Fix:**
Before the run update, count remaining pending batches. Add to the update:
```typescript
const pendingCount = run.total_batches - run.completed_batches - run.failed_batches - (run.skipped_batches || 0);
// In the update object:
skipped_batches: (run.skipped_batches || 0) + pendingCount,
```

**Why This Matters:**
StatsTab displays `run.skipped_batches` for historical runs. Cancelled runs will show `0` (or whatever partial skip count existed) instead of the actual number of skipped batches. Misleading operational data.

---

### HIGH-002: Stale File Header Comment

**File:** `supabase/functions/admin-seed-places/index.ts` (lines 12-17)
**Category:** Documentation / Maintenance

**What's Wrong:**
File header still says "Four actions" but there are now 9 (generate_tiles, preview_cost, seed, coverage_check, create_run, run_next_batch, skip_batch, cancel_run, run_status).

**Evidence:**
```typescript
// Line 12-17:
// ── Admin Seed Places Edge Function ──────────────────────────────────────────
// Four actions:
//   1. generate_tiles  — compute tile grid from city center + radius
//   2. preview_cost    — calculate cost estimate, enforce $70 hard cap
//   3. seed            — execute seeding per tile × category via Nearby Search
//   4. coverage_check  — per-category place counts for augmentation intelligence
```

**Required Fix:**
Update to list all 9 actions.

**Why This Matters:**
Next developer reading this file will assume 4 actions and miss the new 5. Misleading header in a 1600-line file is a maintenance hazard.

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: `run_next_batch` Upsert Not Batched

**File:** `supabase/functions/admin-seed-places/index.ts` (lines 1269-1290)
**Category:** Performance

**What's Wrong:**
Step 2 of the upsert in `handleRunNextBatch` updates existing places one-at-a-time (`for (const row of existingRows)`), while the original `seedCategory` (line 587) batches updates in groups of 10 with `Promise.all`.

**Evidence:**
```typescript
// Line 1269-1290 (run_next_batch) — individual updates:
for (const row of existingRows) {
  await supabase.from("place_pool").update({...}).eq("google_place_id", row.google_place_id);
}

// Line 587-615 (original seedCategory) — batched updates:
const BATCH_SIZE = 10;
for (let i = 0; i < existingRows.length; i += BATCH_SIZE) {
  const batch = existingRows.slice(i, i + BATCH_SIZE);
  const results = await Promise.all(batch.map(row => ...));
}
```

**Required Fix:**
Apply the same batch-of-10 pattern from `seedCategory` to `handleRunNextBatch`. Since each batch is a single tile (max ~20 places from Google), the impact is small, but consistency matters.

**Why This Matters:**
A tile returning 15 existing places = 15 sequential DB calls instead of 2 batched calls. Minor perf regression per batch but compounds over hundreds of batches.

---

### MED-002: StatsTab Missing Batch Filters (Unflagged Spec Deviation)

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (StatsTab, lines 1389-1434)
**Category:** Spec Compliance

**What's Wrong:**
Spec §4.3 says: "Expand → full batch log with per-(tile, category) results. **Filter by: status (completed/failed), category, tile index**." The implementation has the expandable batch log but no filtering. The implementor noted this under "Known Limitations" but did NOT list it as a deviation from spec (only 3 deviations listed, this isn't one of them).

**Required Fix:**
Either: (a) add the filters, or (b) formally acknowledge this as deviation #4 in the implementation report. Given this is a nice-to-have for admin UX, option (b) is fine for now.

---

### MED-003: Unused Import

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (line 8)
**Category:** Code Quality

**What's Wrong:**
`Pause` icon imported from lucide-react but never used.

**Evidence:**
```jsx
// Line 8:
Square, SkipForward, XCircle, Loader, Pause,
//                                       ^^^^^ unused
```

**Required Fix:**
Remove `Pause` from the import list.

---

## 🔵 Low Findings (Nice to Fix)

### LOW-001: Migration Not Idempotent

**File:** `supabase/migrations/20260324000001_sequential_batch_seeding.sql`

Uses `CREATE TABLE` / `CREATE INDEX` without `IF NOT EXISTS`. Standard for Supabase managed migrations (they run once), but worth noting. No action needed unless the migration might be replayed manually.

### LOW-002: Theoretical Race on Concurrent `run_next_batch`

**File:** `supabase/functions/admin-seed-places/index.ts` (lines 1063-1094)

If two tabs call `run_next_batch` simultaneously, both could grab the same pending batch (read-then-write without row locking). Low risk since this is single-admin, manual-approval flow. Could be hardened with `SELECT ... FOR UPDATE SKIP LOCKED` if needed later.

---

## ✅ What Passed

### Things Done Right

1. **Existing code untouched.** All 4 original actions (`generate_tiles`, `preview_cost`, `seed`, `coverage_check`) are completely unmodified. Zero regression risk.

2. **Upsert logic reused correctly.** `run_next_batch` uses the exact same 2-step upsert (insert new + update existing) and the same `applyPostFetchFilters` + `transformGooglePlaceForSeed` functions. No logic divergence.

3. **Hydration pattern is rock solid.** SeedTab checks for active runs on city change, loads batches from DB, and restores the exact UI state. Refresh-safe by design.

4. **`mountedRef` on all async ops.** Both SeedTab and the main page guard state updates with `mountedRef.current`. Matches admin dashboard conventions.

5. **Duplicate active run guard.** `create_run` checks for existing `pending/running/paused` runs before creating a new one. Prevents orphaned runs — a real edge case the spec didn't explicitly require.

6. **Error handling is thorough.** Every edge function action validates inputs, checks preconditions, and returns structured errors. The UI catches errors and shows toast notifications for every failure path.

7. **RLS policies correct.** `service_role ALL` for edge functions, `authenticated SELECT` for dashboard reads. Matches existing `seeding_cities` / `seeding_tiles` patterns.

8. **Cost cap enforced server-side.** Even if UI is bypassed, `create_run` blocks if estimated cost exceeds $70. Defense in depth.

9. **Admin auth check on all actions.** Every action goes through the same JWT verification + `admin_users` check in the main handler.

10. **CSS variables throughout.** All new UI uses `var(--color-*)` tokens, no hardcoded colors. Dark mode compatible.

---

## Spec Compliance Matrix

| Success Criterion (from Spec) | Tested? | Passed? | Evidence |
|-------------------------------|---------|---------|----------|
| §2.1 seeding_batches schema | ✅ | ✅ | Migration matches spec exactly |
| §2.2 seeding_runs schema | ✅ | ✅ | Match + justified `skipped_batches` addition |
| §2.3 Existing tables unchanged | ✅ | ✅ | No modifications to seeding_cities/tiles/operations |
| §3.1 create_run logic | ✅ | ✅ | Queue built correctly, cost cap enforced |
| §3.1 run_next_batch — one API call | ✅ | ✅ | Single Nearby Search per invocation |
| §3.1 skip_batch | ✅ | ✅ | Validates pending status, updates counters |
| §3.1 cancel_run | ✅ | 🟡 | Works but `skipped_batches` not updated (HIGH-001) |
| §3.1 run_status | ✅ | ✅ | Returns run + batches + city metadata |
| §3.2 Existing actions untouched | ✅ | ✅ | Verified all 4 unchanged |
| §4.1 SeedTab phases 1-4 | ✅ | ✅ | Setup → batch-by-batch → progress → completion |
| §4.2 Page load hydration | ✅ | ✅ | useEffect on city change checks for active run |
| §4.3 StatsTab batch filters | ✅ | ❌ | Expandable log present, filters missing (MED-002) |
| §6 All 6 invariants | ✅ | ✅ | Every invariant verified in code |
| RLS on new tables | ✅ | ✅ | Both tables have RLS + policies |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "New migration creates seeding_runs + seeding_batches" | ✅ | ✅ | File exists, schema correct |
| "5 new action handlers added" | ✅ | ✅ | All 5 present and wired in switch statement |
| "Old actions untouched" | ✅ | ✅ | Diff shows no changes to lines 1-914 |
| "RLS: service_role ALL, authenticated SELECT" | ✅ | ✅ | 4 policies match claim |
| "Existing upsert logic reused" | ✅ | ✅ | Same functions called, same pattern |
| "SeedTab rewritten with DB hydration" | ✅ | ✅ | useEffect hydrates from seeding_runs |
| "StatsTab enhanced with Seeding Runs section" | ✅ | ✅ | Section present above legacy history |
| "Duplicate active run guard" | ✅ | ✅ | Checked in create_run |
| "3 deviations documented" | ✅ | 🟡 | 3 listed, but batch filtering omission should be 4th |
| "Batch insert chunking at 500" | ✅ | ✅ | CHUNK_SIZE = 500, loop present |

---

## Recommendations for Orchestrator

### Mandatory (block merge until done)
1. **HIGH-001**: Add `skipped_batches` counter update to `handleCancelRun` — 3-line fix

### Strongly Recommended (merge at your own risk)
2. **HIGH-002**: Update file header to list all 9 actions — 10-second fix
3. **MED-001**: Batch the Step 2 updates in `run_next_batch` to match `seedCategory` pattern
4. **MED-003**: Remove unused `Pause` import

### Acknowledged (no action needed)
5. **MED-002**: StatsTab batch filtering — acknowledge as deviation, add later if needed

---

## Verdict Justification

**🟡 CONDITIONAL PASS** — No critical findings. One high-severity data integrity bug (`cancel_run` not updating `skipped_batches`) is a straightforward 3-line fix. The remaining highs and mediums are minor. The core architecture is sound, spec compliance is strong, security is clean, and the implementation follows existing patterns faithfully.

**Fix HIGH-001, then this is a clean merge.** No re-test needed after the fix — it's mechanical.
