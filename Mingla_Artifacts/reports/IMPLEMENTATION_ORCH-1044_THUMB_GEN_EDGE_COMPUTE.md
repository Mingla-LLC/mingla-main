# IMPLEMENTATION — ORCH-1044 [Thumbnail generation must fit the edge compute budget + reliably drain]

- **Date:** 2026-06-02
- **Author:** mingla-implementor (Claude)
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1044_THUMB_GEN_EDGE_COMPUTE.md` (Approach A — FREE)
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1044_THUMB_GEN_EDGE_COMPUTE.md`
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1044-[thumb-gen-fits-edge-compute]/` on branch `ORCH-1044-thumb-gen-fits-edge-compute`
- **Status:** implemented and verified (unit + type + gates + remote data probe). Live drain watch (SC-1..SC-5) is post-deploy / orchestrator-watched.

---

## 0. Comms ledger acks

- **COMMS-0002** (WARN, ALL) — ORCH-0863 C7 blocks new files under `supabase/`. **Handled:** the new migration + new migration test are appended to a new `ORCH_1044_BACKEND_ALLOWLIST` block in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, spread into the C7 `ALLOWLIST`, in the SAME commit. `index.ts` + `index.test.ts` were already allowlisted under `ORCH_0957_BACKEND_ALLOWLIST` (modifies). C7 gate runs green locally.
- **COMMS-0003** (WARN, ALL) — external-API params docs-cited. **Handled:** the 2 s CPU cap + 546 semantics + cron/pg_net docs URLs are cited inline in `index.ts` and the migration. No NEW external API is introduced (A uses no render endpoint).
- **COMMS-0015** (WARN, ALL) — CLOSE must merge-to-main before edge deploy. **Factored:** this is the orchestrator's lane at close; deploy command provided below (deploy FROM main after PR merge, not from this worktree).
- No `BLOCK` entry addressed to this skill or ORCH-1044.

---

## 1. Step 0 — rebase (LOCKED, done first)

`git fetch origin main && git rebase origin/main`. The worktree's single commit (`1c3be1806`, the META-ORCH-1046 registration in WORLD_MAP/OPEN_INVESTIGATIONS/MASTER_BUG_LIST) conflicted with main's updated index blocks. Resolved by KEEPING BOTH SIDES (additive registration blocks). Resulting rebased HEAD before my work: `283b01860`. Confirmed v34/ORCH-1043 source is present after rebase: `grep -c process_chunk index.ts` = 5, `PARALLEL_N` present, 1006 lines. Editing the rebased file does NOT revert ORCH-1043.

---

## 2. Old → New Receipts

### `supabase/functions/backfill-place-photo-thumbs/index.ts`
**What it did before (ORCH-1043 v34):** `PARALLEL_N=6`, `DEFAULT_BATCH_SIZE=25`, a `BUDGET_MS=110_000` multi-batch loop (`SAFETY_MAX_ITERATIONS=20`) inside `handleProcessChunk` that kept claiming + draining batches for ~110 s; `processBatch` flattened ~125 photos/batch and drained them through `runWithConcurrency(allJobs, 6)`. → CPU-bound imagescript decode/resize/encode crossed the 2 s isolate CPU hard cap within seconds → HTTP 546 (WORKER_LIMIT) at ~5–6 s wall, batch never finished.
**What it does now (ORCH-1044):**
- `PARALLEL_N = 1` (serial — concurrency only front-loads CPU on a 1-thread isolate).
- `DEFAULT_BATCH_SIZE = 4`; `PER_INVOCATION_BATCHES = 1`; new `CPU_WALL_GUARD_MS = 1_200`. Deleted `BUDGET_MS` + the 110 s multi-batch loop entirely.
- `processBatch` now drains photo jobs **serially**, checking the wall guard BEFORE each job. The moment `nowMs() - batchStartMs >= 1200` it stops starting new jobs and sets `BatchResult.partial = true`. Places whose jobs were not fully drained get NO terminal tally + NO `thumbs_backfilled_at` (per-place all-or-nothing preserved). A `nowMs` injection point was added for deterministic testing.
- `claimAndProcessNextBatch` honors `partial`: a guard-tripped batch is written back to `status='pending', started_at=NULL` (NOT terminal), counters NOT rolled (no double-count) — so the batch is re-claimed + resumed (HEAD-skips already-written thumbs).
- `handleProcessChunk` processes **one** batch then self-invokes (`EdgeRuntime.waitUntil`) when the run is still running and pending work remains (a guard-tripped batch counts as remaining work). No loop.
- Protective comments cite the 2 s CPU cap + 546 docs and forbid re-introducing a multi-batch loop.
**Why:** Root Cause 1 (CPU-time blowout) + Contributing Factors 1 + 2. SC-2, SC-3, I-THUMB-INVOCATION-CPU-BUDGET-BOUNDED.
**Lines changed:** ~120 (constants + `processBatch` drain rewrite + `claimAndProcessNextBatch` partial-honor + `handleProcessChunk` single-unit).

### `supabase/migrations/20260818000000_orch_1044_thumb_orphaned_batch_reclaim.sql` (NEW)
**What it did before:** N/A.
**What it does now:** `CREATE OR REPLACE FUNCTION public.tg_kick_pending_thumb_backfill()` extending the ORCH-1043 kicker with a NEW **step (c)** that runs BEFORE the existing (a) ensure_auto_run + (b) stale-heartbeat re-kick: a single `UPDATE public.photo_backfill_batches SET status='pending', started_at=NULL` for batches on an active servable thumbs run whose `status='running'` and `started_at` is NULL or older than `interval '3 minutes'`. Counters untouched; SECURITY DEFINER preserved; idempotent. Pre-flight `RAISE EXCEPTION` only if the ORCH-1043 function is absent.
**Why:** Root Cause 2 (orphaned `running` batches never reclaimed → run can never complete). SC-1, SC-5, I-THUMB-ORPHANED-RUNNING-BATCH-RECLAIMED.
**Lines changed:** new file (~140 lines).

### `supabase/functions/backfill-place-photo-thumbs/index.test.ts`
**What it did before:** 8 tests; `T-03b` asserted `exitReason === 'safety_max_iterations'` (the ORCH-1043 multi-batch loop exit).
**What it does now:** 10 tests. `T-03b` updated under `[TEST-MOD-APPROVED ORCH-1044]` to assert `exitReason === 'unit_done'` + `batchesProcessed === 1` (the self-invoke INVARIANT is unchanged; only the exit-reason string changed because the loop was replaced). Added **T-01** (CPU wall guard stops mid-batch → `partial=true`, only the fully-drained place is updated, already-written thumb HEAD-skipped, no original refetched, the guard stops before the 2nd place's HEAD fires) and a no-guard happy-path completion test.
**Why:** ORCH-0840 regression-test gate; the loop→single-unit behavior change.
**Lines changed:** ~145 added; ~6 modified (TEST-MOD-APPROVED).

### `supabase/migrations/__tests__/orch_1044_thumb_orphaned_batch_reclaim.test.ts` (NEW)
**What it does now:** 7 read-only SQL-shape assertions locking the reclaim contract: CREATE OR REPLACE + SECURITY DEFINER; `SET status='pending', started_at=NULL` on `status='running'`; 3-minute stale bound (+ NULL tolerance); discriminator + run-status='running' scoping; NO counter columns in the reclaim SET (no double-count); reclaim ordered BEFORE (a)/(b); additive-only (single allowed RAISE EXCEPTION = the ORCH-1043 prereq guard).
**Why:** T-02 required regression (DB layer).
**Lines changed:** new file (~140 lines).

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
**What it did before:** C7 allowlist had no ORCH-1044 entry.
**What it does now:** new `ORCH_1044_BACKEND_ALLOWLIST` (the new migration + new migration test) spread into the C7 `ALLOWLIST`.
**Why:** COMMS-0002 — same-commit allowlist for new backend files.
**Lines changed:** ~14.

---

## 3. Tuning constants (exact)

| Constant | Before (ORCH-1043 v34) | After (ORCH-1044) |
|---|---|---|
| `PARALLEL_N` | `6` | **`1`** |
| `DEFAULT_BATCH_SIZE` | `25` | **`4`** |
| `PER_INVOCATION_BATCHES` | (implicit ∞ via loop) | **`1`** |
| `CPU_WALL_GUARD_MS` | (none) | **`1_200`** |
| `BUDGET_MS` | `110_000` | **DELETED** |
| `SAFETY_MAX_ITERATIONS` | `20` | **DELETED** (single-unit shape structurally caps work) |
| `MAX_BATCH_SIZE` / `THUMB_SIZE` / `THUMB_JPEG_QUALITY` | 100 / 384 / 80 | unchanged |

---

## 4. Migration filename + ready-to-run Management-API SQL

- **Filename:** `supabase/migrations/20260818000000_orch_1044_thumb_orphaned_batch_reclaim.sql`
- **Why 20260818000000:** remote head is `20260817000000_orch_1045_beta_access_leads` (confirmed via `mcp__supabase__list_migrations`); the spec's proposed `20260817000000` collided. `20260818000000` is strictly greater than the max prefix across remote + repo + sibling worktrees. Monotonic, per parity rule 10.
- **APPLY via Supabase Management API** (`POST /v1/projects/gqnoajqerqhnvulmnyvv/database/query`) — db push is drift-blocked (COMMS-0012). Do NOT run `db push`. The orchestrator applies the file's full SQL body verbatim at close, then verifies `list_migrations` shows `20260818000000` and records the version row.
- The migration body is idempotent (`CREATE OR REPLACE FUNCTION`) — safe to re-apply.

---

## 5. Regression tests (paths + runs + fails-on-revert)

| Test | Path | Run | Fails-on-revert |
|---|---|---|---|
| **T-01** wall guard stops + self-invoke + HEAD-skip | `supabase/functions/backfill-place-photo-thumbs/index.test.ts` | 10/10 PASS | ✅ disabled the `CPU_WALL_GUARD_MS` guard → T-01 FAILED (`partial` expected true, got false) @ `283b01860`; restored → PASS |
| **T-02** orphaned-batch reclaim contract | `supabase/migrations/__tests__/orch_1044_thumb_orphaned_batch_reclaim.test.ts` | 7/7 PASS | ✅ removed `SET status='pending'` from the reclaim → T-02b FAILED @ `283b01860`; restored → PASS |

Both happy-path tests proven to fail on revert at the pre-fix commit `283b01860`. Adversarial second tests (T-03 happy completion, T-02g additive-only, T-02f ordering, T-02e no-counter-write) are bundled. The tester writes the further adversarial pass.

---

## 6. Gate results (local)

- **ORCH-0863 C7 backend** (`orch-0863-marketing-hub-phase-b.mjs`): **PASS** (after commit; allowlist covers the 2 new backend files; modifies already allowlisted).
- **ORCH-0957 no-metered-render** (`orch-0957-no-metered-place-photo-reads.mjs`): **PASS** — `index.ts` contains zero `/storage/v1/render/image/` references; A never calls the render endpoint.
- `deno check supabase/functions/backfill-place-photo-thumbs/index.ts`: **clean**.

---

## 7. Remote data probe (Prime Directive 9b)

Read-only `mcp__supabase__execute_sql` against prod confirmed the reclaim predicate is correct + well-targeted:
- `tg_kick_pending_thumb_backfill` exists (kicker_exists=1).
- 1 active running thumb run; **15** batches stuck in `running` on it; **13 reclaimable now** (started_at NULL or > 3 min). The migration's step (c) will heal exactly these 13 on the next cron tick after apply, while leaving the 2 genuinely-in-flight batches untouched. No mutation performed by the probe.

---

## 8. Spec traceability

| SC | Status |
|---|---|
| SC-1 run reaches completed, 0 running | Implemented (reclaim + single-unit) — live-verify post-deploy |
| SC-2 zero 546 | Implemented (CPU_WALL_GUARD_MS=1200 « 2 s CPU cap) — live-verify post-deploy |
| SC-3 counters climb monotonically | Implemented (self-invoke chain + cron) — live-verify post-deploy |
| SC-4 thumb URL 200 | Unchanged bytes (still `encodeJPEG`) — live-verify post-deploy |
| SC-5 orphaned running reclaimed within bound | Implemented + unit-tested (T-02) + remote-probe-confirmed |
| SC-6 both gates green | **PASS** (C7 + 0957 local) |
| SC-7 triggered_by NULL for cron | Preserved (`AUTO_RUN_TRIGGERED_BY=null` untouched) |

## 9. Invariants

- **Preserved:** server-driven self-invoke + cron; `triggered_by=NULL`; ORCH-0957 no-metered gate (untouched, green); ORCH-1024 discriminator (`city=RUN_CITY`, `country=RUN_COUNTRY`); per-place all-or-nothing.
- **New (now satisfied):** I-THUMB-INVOCATION-CPU-BUDGET-BOUNDED; I-THUMB-ORPHANED-RUNNING-BATCH-RECLAIMED.

## 10. Cross-surface impact

Backend-only. No consumer/business/buyer-web/admin UI change (admin Photos panel polls `run_status`; counters keep meaning, now actually climb). Surfaces 1–7 all UNAFFECTED per spec §3.

## 11. Deploy (orchestrator, at close — after PR merge to main)

```bash
# 1) Apply the migration via Management API (NOT db push), record the version.
# 2) Deploy the edge fn FROM main (per COMMS-0015 — verify origin/main has the squash commit first):
supabase functions deploy backfill-place-photo-thumbs --project-ref gqnoajqerqhnvulmnyvv
```
Then verify-first-call (non-404) + live drain watch (SC-1..SC-5) + `get_logs(edge-function)` for zero 546.

## 12. Discoveries for orchestrator

1. **Shared CPU ceiling on `run-place-intelligence-trial`** (collage/intel prep) — same imagescript-CPU-over-2s mechanism in the same live logs. Out of ORCH-1044 scope; recommend a sibling ORCH applying the same per-invocation CPU-budget discipline. (Carried from investigation §9.1.)
2. **Pre-existing stale migration-test filename:** `supabase/migrations/__tests__/orch_1043_thumb_backfill_cron.test.ts` reads `../20260815000000_orch_1033_thumb_backfill_cron.sql` but the repo file is `..._orch_1043_...`. That test would fail to read its target (unrelated to ORCH-1044; not touched). Flagging for hygiene.
3. **Migration-history drift (COMMS-0012)** persists — `db push` remains unsafe; Management-API apply is the path. No action here beyond using the API path.
