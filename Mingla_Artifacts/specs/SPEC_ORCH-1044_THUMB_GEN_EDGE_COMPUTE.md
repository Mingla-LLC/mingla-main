# SPEC — ORCH-1044 [Thumbnail generation must fit the edge compute budget + reliably drain]

- **Date:** 2026-06-02
- **Author:** mingla-forensics (Claude)
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1044_THUMB_GEN_EDGE_COMPUTE.md`
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1044-[thumb-gen-fits-edge-compute]/` on branch `ORCH-1044-thumb-gen-fits-edge-compute`
- **Approach chosen:** **A (FREE)** — cut per-invocation work to a single small unit + an explicit CPU/wall budget guard that self-invokes EARLY, plus an orphaned-`running`-batch reclaim. **B (paid render endpoint) is NOT implemented** (documented fallback only).

---

## 1. Goal (operator-stated)

Thumbnail generation runs **reliably without 546** and actually drains the ~17k-place / ~84k-photo backlog. **Speed is secondary (overnight run). Correctness > throughput.**

---

## 2. Scope / Non-goals / Assumptions

**Scope (backend only):**
- `supabase/functions/backfill-place-photo-thumbs/index.ts` — rework `handleProcessChunk` to a bounded single-unit-per-invocation worker with a CPU/wall budget guard; set `PARALLEL_N=1`; shrink the per-invocation batch claim to ONE small batch; add an in-loop CPU guard.
- ONE new migration (applied via Management API; db push drift-blocked) — add a `running → pending` orphaned-batch reclaim to the cron driver `tg_kick_pending_thumb_backfill()` (or a sibling function it calls).
- Strict-grep: add the new migration filename to a backend allowlist in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` SAME COMMIT (COMMS-0002). Optionally add a new ORCH-1044 invariant gate.
- Two Deno regression tests (§7).

**Non-goals:**
- Approach B (render endpoint). Documented fallback in the investigation; NOT built. The ORCH-0957 no-metered gate stays green and untouched.
- `run-place-intelligence-trial` / collage CPU ceiling (registered as a discovery for a sibling ORCH).
- Any client/admin/business/web UI change. The admin Photos panel only polls `run_status`; its behavior is unchanged.
- Changing thumbnail dimensions/quality (`THUMB_SIZE=384`, `THUMB_JPEG_QUALITY=80`) or `MAX_PHOTOS`.

**Assumptions (proven in investigation):**
- 546 is **CPU-time** (2 s hard cap), not memory (256 MB; peak in-flight ≈ 38 MB). Proven by benchmark + docs + wall-time signature.
- The deployed function is ORCH-1043 v34; the worktree is STALE (pre-1043) → **rebase first**.

---

## 3. Cross-Surface Impact (MANDATORY)

| Surface | Covered? | Behavior / why-not |
|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | NO | No client code touched. Thumbnails are read indirectly via the collage/intel pipeline; image bytes are identical (still `encodeJPEG`). |
| Consumer Android | NO | Same as iOS. |
| Buyer/anon Web | NO | No buyer route reads this. |
| Business iOS | NO | No business analog. |
| Business Android | NO | No business analog. |
| Admin Web (`mingla-admin/`) | NO (behavior unchanged) | The Photos panel polls `run_status` and renders run/batch counters. Those columns keep their meaning; the panel needs no edit. The only visible difference operator will see is that counters now ACTUALLY climb. |
| Business Web preview | NO | N/A. |

No manual cross-surface parity needed — this is a single backend edge function + one DB function.

---

## 4. Database layer

### 4.1 New migration — orphaned-`running`-batch reclaim
**File:** `supabase/migrations/20260817000000_orch_1044_thumb_orphaned_batch_reclaim.sql` (timestamp must sort AFTER `20260816000000`; verify the latest applied migration before finalizing the timestamp). **Apply via Supabase Management API** (`POST /v1/projects/gqnoajqerqhnvulmnyvv/database/query`) — db push is drift-blocked. Idempotent (`CREATE OR REPLACE`).

**Contract — extend `tg_kick_pending_thumb_backfill()`** (keep its existing (a) ensure_auto_run kick + (b) stale-heartbeat run re-kick) by ADDING a step (c) that, for the active servable thumbs run(s), resets stale `running` batches to `pending`:

```sql
-- (c) ORCH-1044: reclaim orphaned 'running' batches.
-- A 546-killed process_chunk leaves a claimed batch in 'running' with no
-- terminal write. Reset any 'running' batch whose started_at is older than the
-- stale bound back to 'pending' so a future invocation can re-claim it.
UPDATE public.photo_backfill_batches b
   SET status = 'pending',
       started_at = NULL
  FROM public.photo_backfill_runs r
 WHERE b.run_id = r.id
   AND r.city = 'ORCH-0957 place-photo thumbs'
   AND r.country = 'GLOBAL'
   AND r.status = 'running'
   AND b.status = 'running'
   AND (b.started_at IS NULL OR b.started_at < now() - interval '3 minutes');
```

- **Ordering within the function:** run (c) BEFORE (a)/(b) so that re-kicks see freshly-reclaimed `pending` batches. 🔒 LOCKED.
- **Stale bound = 3 minutes.** 🔒 LOCKED floor (must exceed the worst realistic single-invocation wall, ~6 s, by a wide margin so an in-flight legitimate batch is never reclaimed mid-flight). 🎨 OPEN: the implementor may make the interval a named constant or pull it from a settings row if preferred.
- **Counters:** do NOT touch run counters on reclaim (the batch never wrote terminal counters, so resetting status alone is correct — no double-count risk). 🔒 LOCKED.
- **SECURITY DEFINER** preserved (matches existing function). 🔒 LOCKED.

### 4.2 No schema changes
No new tables/columns/RLS. `photo_backfill_batches.status` already supports `pending`/`running`. No advisor impact.

---

## 5. Edge function layer — `backfill-place-photo-thumbs/index.ts`

> **STEP 0 (LOCKED): rebase the worktree onto current `origin/main` BEFORE editing.** The worktree copy is pre-ORCH-1043. Edit the ORCH-1043 v34 source (server-driven loop + PARALLEL_N + budget loop), NOT the stale serial file. Confirm `grep -c "process_chunk" index.ts` > 0 after rebase.

### 5.1 Constants (🔒 LOCKED values)
```ts
export const PARALLEL_N = 1;            // was 6. Serial: concurrency buys nothing for CPU-bound decode; it only accelerates the 2s CPU soft limit.
const PER_INVOCATION_BATCHES = 1;       // process AT MOST one batch per process_chunk invocation, then self-invoke.
const CPU_WALL_GUARD_MS = 1_200;        // stop starting new photo jobs once wall ≥ 1.2s. Wall ≥ CPU, so this guarantees < 2s CPU for the CPU-bound portion, with headroom.
```
- `DEFAULT_BATCH_SIZE`: change to **4** (was 25) so a freshly-created run's batches are small (≤ ~20 photos worst-case, typically far fewer after `thumbExists` HEAD skips). 🔒 LOCKED. (Existing in-flight run `7b782c45` has batch_size 25 batches already created — the CPU guard below makes even a 25-place batch safe by stopping mid-batch and self-invoking; the smaller default just reduces self-invoke chatter for NEW runs.)
- Keep `THUMB_SIZE=384`, `THUMB_JPEG_QUALITY=80`, `MAX_BATCH_SIZE=100`. 🔒 LOCKED.
- DELETE `BUDGET_MS = 110_000` and the 110 s multi-batch budget loop (replaced by the single-unit + guard design). 🔒 LOCKED. Keep `SAFETY_MAX_ITERATIONS` as a belt-and-suspenders cap but it becomes near-irrelevant.

### 5.2 `processBatch` — add an in-loop CPU/wall guard (🔒 LOCKED contract)
The function flattens a batch's photos into `allJobs` and drains them. Change the drain so it:
1. Records `const batchStartMs = Date.now()` at entry.
2. Processes photo jobs **serially** (PARALLEL_N=1) — replace `runWithConcurrency(allJobs, PARALLEL_N)` with a serial loop OR keep `runWithConcurrency` with `limit=1`.
3. **Before starting each photo job**, check `if (Date.now() - batchStartMs >= CPU_WALL_GUARD_MS) { /* stop; leave remaining jobs undone */ break; }`.
4. Photos NOT processed this round are simply left undone — their place will NOT get `thumbs_backfilled_at` set (all-or-nothing per place is preserved), and the batch stays claimable on the next invocation **only if** the batch did not reach a terminal state. **Therefore:** when the guard trips mid-batch, the batch MUST be returned to `pending` (not marked `completed`/`failed`), and `started_at` cleared, so the same batch is re-claimed and continues. Add a `BatchResult.partial: boolean` (or an explicit `guardTripped` signal) so `claimAndProcessNextBatch` can write `pending` instead of a terminal status.

> Rationale: a place is all-or-nothing (`thumbs_backfilled_at` set only when ALL its photos succeed). `thumbExists` HEAD-skips already-written thumbs, so re-claiming a partially-processed batch resumes cheaply (written thumbs are skipped). 🔒 LOCKED.

### 5.3 `claimAndProcessNextBatch` — honor the guard-trip (🔒 LOCKED)
After `processBatch` returns:
- If `result.partial === true` (guard tripped, batch not finished): set the batch back to `status='pending', started_at=NULL` (so it is re-claimed), DO NOT roll terminal counters for it, and signal the caller that work remains.
- Else (batch fully processed): existing terminal write (`completed`/`failed`) + counter roll-up. 🔒 LOCKED (unchanged).

### 5.4 `handleProcessChunk` — single-unit + self-invoke (🔒 LOCKED)
Replace the `while (Date.now() - startedAtMs < BUDGET_MS …)` loop with:
1. Flip `ready→running` + heartbeat (unchanged).
2. Re-check status (paused/cancelled/vanished) — unchanged.
3. Call `claimAndProcessNextBatch` **once** (PER_INVOCATION_BATCHES=1).
4. If nothing was claimable → set run `completed` (unchanged).
5. If a batch was claimed (whether finished or guard-tripped-back-to-pending): **self-invoke `kickProcessChunk(runId)` immediately** (`EdgeRuntime.waitUntil`) provided the run is still `running` and pending work remains, then RETURN. 🔒 LOCKED.
6. The single invocation now does ≤ ~1.2 s wall of CPU-bound work → never approaches the 2 s CPU cap → no 546. 🔒 LOCKED.

> The chain is: each invocation does one small unit → self-invokes → next invocation does the next unit. The cron (`*/10`) is the backstop that re-kicks a stalled run AND (new) reclaims orphaned `running` batches. 🔒 LOCKED.

### 5.5 Preserve (🔒 LOCKED)
- `ensure_auto_run` + `process_chunk` service-role-only auth gate (unchanged).
- `triggered_by = NULL` for auto/cron runs (`AUTO_RUN_TRIGGERED_BY = null`).
- ORCH-1024 discriminator (`city=RUN_CITY`, `country=RUN_COUNTRY`).
- `kickProcessChunk` via `EdgeRuntime.waitUntil`.
- **No `/storage/v1/render/image/` call anywhere** — A does NOT use the render endpoint; the ORCH-0957 gate stays green with zero edits. 🔒 LOCKED.

### 5.6 OPEN (🎨 — implementor's craft)
- Whether to implement the serial drain as a `for` loop or `runWithConcurrency(limit:1)`.
- Exact shape of the `partial`/`guardTripped` signal (a boolean field on `BatchResult` vs a returned tuple).
- Logging verbosity on guard-trip / self-invoke (a single `console.log` with `runId`, `batchId`, `photosThisRound`, `elapsedMs` is encouraged for live-watch).
- Whether to also lower `DEFAULT_BATCH_SIZE` further (4 is the floor; smaller is fine).

---

## 6. Strict-grep / CI (COMMS-0002 — 🔒 LOCKED)

In `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, add the new migration to a backend allowlist in the SAME COMMIT:
```js
const ORCH_1044_BACKEND_ALLOWLIST = [
  "supabase/migrations/20260817000000_orch_1044_thumb_orphaned_batch_reclaim.sql",
];
// …and spread it into the C7 allowlist set alongside ...ORCH_1043_BACKEND_ALLOWLIST
```
`backfill-place-photo-thumbs/index.ts` + `index.test.ts` are ALREADY allowlisted (`ORCH_0957_BACKEND_ALLOWLIST`) — no new entry for editing them. The ORCH-0957 no-metered gate needs NO change (A adds no render-endpoint reference). 🔒 LOCKED.

**Optional new invariant gate** (🎨 OPEN, recommended): `i-orch-1044-thumb-cpu-budget-bounded.mjs` asserting `index.ts` contains the `CPU_WALL_GUARD_MS` guard and does NOT contain a `BUDGET_MS`-style multi-batch loop, and that `PARALLEL_N === 1`. If added, register it in the workflow + allowlist same-commit.

---

## 7. Test cases (🔒 LOCKED — two required regressions)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-01** (REQUIRED) `index.test.ts` — *per-invocation CPU/wall guard stops a big batch and self-invokes; batch returns to pending* | A batch of N places whose photos exceed `CPU_WALL_GUARD_MS` of fake work (inject a `processPlaceThumbs`/`runPhotoJob` stub that advances a mock clock past 1.2 s after the 2nd photo) | `processBatch` STOPS starting new jobs after the guard trips; the batch is written back to `status='pending'`/`started_at=NULL` (NOT `completed`/`failed`); `handleProcessChunk` issues a self-invoke; already-written photos are not re-encoded (HEAD-skip honored) | Edge fn (Deno) |
| **T-02** (REQUIRED) migration test `supabase/migrations/__tests__/orch_1044_thumb_orphaned_batch_reclaim.test.ts` — *orphaned running-batch reclaim* | Seed a `running` run with a batch in `status='running'`, `started_at = now() - 4 min`, plus a fresh `running` batch `started_at = now()` | After invoking the reclaim step, the stale batch is reset to `pending` (`started_at` NULL); the fresh batch is UNTOUCHED; run counters unchanged | DB (pg) |
| **T-03** (edge, recommended) | A 1-place batch with 1 small photo, guard NOT tripped | Batch reaches `completed`, place gets `thumbs_backfilled_at`, counters roll up, no self-invoke loop beyond normal chain | Edge fn |
| **T-04** (regression, recommended) | `index.ts` contains NO `/storage/v1/render/image/` reference and `PARALLEL_N===1` | Static assert (or the optional new gate) passes; ORCH-0957 gate stays green | CI |

Tests must use the provider-shaped contracts (COMMS-0003): the DB test asserts on real `photo_backfill_batches` row state; the edge test mocks the Supabase client with the documented `.update().eq().eq().select()` chain shape.

---

## 8. Success criteria (observable, testable)

1. **SC-1:** A run created over the global servable backlog reaches `status='completed'` with `completed_batches + failed_batches + skipped_batches == total_batches` and **0 batches left in `running`**. (Verify: `mcp__supabase__execute_sql` on `photo_backfill_runs`/`photo_backfill_batches`.)
2. **SC-2:** During the run, **zero `POST … /backfill-place-photo-thumbs … 546`** entries appear in `mcp__supabase__get_logs(edge-function)`. Every `process_chunk` returns 200. 🔒
3. **SC-3:** `total_succeeded` climbs monotonically across cron ticks / self-invoke chain; `completed_batches` climbs. 🔒
4. **SC-4:** For a processed place, `HEAD`/`GET` on its `…_thumb.jpg` public URL returns **200**. 🔒
5. **SC-5:** A batch claimed by an interrupted invocation does NOT remain `running` indefinitely — the cron reclaim returns it to `pending` within the stale bound and it is re-processed. 🔒
6. **SC-6:** The ORCH-0957 no-metered strict-grep gate and the ORCH-0863 C7 gate both pass on the PR. 🔒
7. **SC-7:** `triggered_by` is `NULL` for cron/auto-created runs (FK satisfied, no 500). 🔒

---

## 9. Invariants

- **Preserved:** server-driven self-invoke + cron (ORCH-1043); `triggered_by=NULL` for auto runs; ORCH-0957 no-metered-render gate (untouched — A never calls render); ORCH-1024 run discriminator; per-place all-or-nothing `thumbs_backfilled_at`.
- **New:** `I-THUMB-INVOCATION-CPU-BUDGET-BOUNDED` (a `process_chunk` invocation stops + self-invokes on a wall guard well under the 2 s CPU cap; no unbounded multi-batch loop). `I-THUMB-ORPHANED-RUNNING-BATCH-RECLAIMED` (a stale `running` batch is reset to `pending` by the cron).

---

## 10. Implementation order

1. **Rebase worktree onto `origin/main`** (Step 0). Confirm v34/ORCH-1043 source is present.
2. **Migration** `20260817000000_orch_1044_thumb_orphaned_batch_reclaim.sql` — extend `tg_kick_pending_thumb_backfill()` with step (c). Apply via Management API.
3. **Edge fn** `index.ts` — constants (5.1), `processBatch` guard (5.2), `claimAndProcessNextBatch` guard-honor (5.3), `handleProcessChunk` single-unit + self-invoke (5.4).
4. **Strict-grep** allowlist (§6) + optional new gate.
5. **Tests** T-01..T-04 (§7).
6. **Deploy** edge fn from main after merge (orchestrator carve-out; per COMMS-0015 verify origin/main contains the squash commit BEFORE deploy/reap).
7. **Live drain watch** (SC-1..SC-7).

---

## 11. Regression prevention

- The `CPU_WALL_GUARD_MS` guard + single-unit-per-invocation shape STRUCTURALLY prevents re-introducing an unbounded CPU loop. The optional `i-orch-1044-thumb-cpu-budget-bounded.mjs` gate fails CI if `PARALLEL_N` is bumped or a `BUDGET_MS`-style loop returns.
- The orphaned-batch reclaim makes the pipeline self-heal from ANY future mid-batch worker death (546, timeout, deploy clobber), not just this one.
- Protective comment in `handleProcessChunk` must state: "Edge isolates enforce a 2 s CPU hard cap (https://supabase.com/docs/guides/functions/limits). imagescript decode/resize/encode is CPU-bound; do ONE small unit per invocation under CPU_WALL_GUARD_MS, then self-invoke. Never reintroduce a multi-batch wall-budget loop — it 546s."
