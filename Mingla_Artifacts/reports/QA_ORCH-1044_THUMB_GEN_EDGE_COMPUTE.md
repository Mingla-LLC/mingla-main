# QA — ORCH-1044 [Thumbnail generation must fit the edge compute budget + reliably drain]

- **Date:** 2026-06-02
- **Tester:** mingla-tester (Claude)
- **Mode:** TARGETED + SPEC-COMPLIANCE
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1044-[thumb-gen-fits-edge-compute]/` on branch `ORCH-1044-thumb-gen-fits-edge-compute`
- **Commit under test (pre-QA):** `d1e619b3a`
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1044_THUMB_GEN_EDGE_COMPUTE.md` (Approach A — FREE)
- **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1044_THUMB_GEN_EDGE_COMPUTE.md`

## Verdict: **PASS** (live-drain verified-by-mechanism; orchestrator confirms post-deploy)

- P0: 0 | P1: 0 | P2: 0 | P3: 1 (pre-existing, out of scope) | P4: 2
- **Sim evidence:** EXEMPT — backend-only (one Deno edge function + one SQL migration + CI gate + tests). No mobile/admin/business/web UI or runtime surface touched. Phase 0.A live-fire sim gate does not apply (stated exemption + reason).
- **Regression tests:** implementor = `supabase/functions/backfill-place-photo-thumbs/index.test.ts` (T-01, 13 in suite) + `supabase/migrations/__tests__/orch_1044_thumb_orphaned_batch_reclaim.test.ts` (T-02, 7 tests) — both `fails-on-revert` independently reproduced @ pre-fix revert (below). tester = `supabase/functions/backfill-place-photo-thumbs/index.adversarial.test.ts` (TA-01/02/03, 3 tests, adversarial — different angle: mid-place trip + clean resume + boundary).

---

## 1. Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK` entry open to `mingla-tester`, ORCH-1044, or `ALL`. Relevant WARN-to-ALL factored: **COMMS-0002** + **COMMS-0004** (ORCH-0863 C7 backend allowlist must carry new `supabase/**` files in the same commit) — verified satisfied (§5). **COMMS-0003** (external-API docs cited) — N/A, no new external API; the 2 s CPU cap + 546 + cron docs URLs are cited inline. **COMMS-0015** (CLOSE merges PR to main before edge deploy) — orchestrator's lane at close, noted. No new cross-ORCH discovery requiring a ledger write.

---

## 2. Spec-compliance matrix (independently verified by reading the code)

| # | Spec requirement | Status | Evidence (file:line) |
|---|---|---|---|
| 1 | `PARALLEL_N === 1` | IMPLEMENTED | `index.ts:36` `export const PARALLEL_N = 1;` |
| 2 | `DEFAULT_BATCH_SIZE = 4` | IMPLEMENTED | `index.ts:11` |
| 3 | `PER_INVOCATION_BATCHES = 1` | IMPLEMENTED | `index.ts:44` |
| 4 | `CPU_WALL_GUARD_MS = 1200` | IMPLEMENTED | `index.ts:45` |
| 5 | `BUDGET_MS` 110s multi-batch loop DELETED | IMPLEMENTED | No `BUDGET_MS` / `SAFETY_MAX_ITERATIONS` anywhere; `handleProcessChunk` (`index.ts:740-850`) does ONE `claimAndProcessNextBatch` then self-invokes — no loop |
| 6 | In-loop wall guard stops before each job, sets `partial` | IMPLEMENTED | `index.ts:651-674` — `if (nowMs() - batchStartMs >= CPU_WALL_GUARD_MS) { guardTripped=true; break; }` checked BEFORE each `runPhotoJob`; `result.partial=true` on trip |
| 7 | Guard-tripped batch returned to `pending`/`started_at=NULL`, NO terminal status, NO counter roll | IMPLEMENTED | `claimAndProcessNextBatch` `index.ts:539-545` |
| 8 | Self-invoke only when run still `running` AND pending work remains | IMPLEMENTED | `index.ts:818-834` — re-reads run status + a pending batch before `kickProcessChunk` |
| 9 | Per-place all-or-nothing preserved (mid-place trip leaves place un-finalized) | IMPLEMENTED | `processBatch` `index.ts:693-700` — `fullyDrained` gate; un-drained place gets neither tally nor `thumbs_backfilled_at` |
| 10 | Migration extends `tg_kick_pending_thumb_backfill()` with step (c) `running→pending` reclaim, >3min stale, additive | IMPLEMENTED | `20260818000000_...sql:79-98`; (a)/(b) reproduced verbatim from ORCH-1043 (lines 100-133); reclaim runs BEFORE (a)/(b) |
| 11 | Reclaim counters untouched + SECURITY DEFINER preserved | IMPLEMENTED | `...sql:57` `SECURITY DEFINER`; reclaim SET is `status` + `started_at` only |
| 12 | NO `/storage/v1/render/image/` reference (ORCH-0957 gate) | IMPLEMENTED | grep across the fn dir = 0 matches; ORCH-0957 gate green |
| 13 | `triggered_by=NULL` for auto/cron runs preserved | IMPLEMENTED | `index.ts:856` `AUTO_RUN_TRIGGERED_BY: string | null = null` |
| 14 | ORCH-1024 Photos discriminator preserved (`city=RUN_CITY`, `country=RUN_COUNTRY`) | IMPLEMENTED | `index.ts:19-20`, used at create/ensure/active-run; reclaim scoped to same discriminator |
| 15 | Same-commit ORCH-0863 backend allowlist (COMMS-0002) | IMPLEMENTED | gate §6 allowlist `ORCH_1044_BACKEND_ALLOWLIST` |

**Scope-creep / gap scan:** none. No file outside spec scope changed. Edge fn keeps every ORCH-1043 affordance (service-role auth gate, manual single-step, pause/resume/cancel/retry/skip, conditional claim).

---

## 3. Single-invocation cannot approach the 2 s CPU cap (mechanism)

`handleProcessChunk` performs exactly ONE `claimAndProcessNextBatch` per invocation (no loop). Inside `processBatch`, photo jobs drain **serially** (PARALLEL_N=1) and the wall guard is checked **before starting each job**; the moment wall ≥ 1200 ms the loop `break`s and flags `partial`. Wall time ≥ CPU time for any workload (CPU time excludes async I/O — the HEAD/GET/upload network waits), so a 1.2 s wall ceiling on the CPU-bound decode/resize/encode portion guarantees the CPU-bound work stays well under the 2 s hard cap with ~800 ms headroom. The boundary uses `>=`, so a job that would start exactly at 1200 ms does NOT start (proven by tester TA-03). **Conclusion: a single invocation structurally cannot reach the 2 s CPU cap → no 546.** Verified-by-mechanism; live zero-546 confirmed by orchestrator post-deploy (SC-2).

---

## 4. Independent test runs (captured output)

### 4.1 Implementor suites — all green
- Edge fn `index.test.ts`: **10/10 PASS** (424ms). Includes T-01 (wall-guard trip → partial), T-03 no-guard completion, T-03b self-invoke (`exitReason='unit_done'`, `batchesProcessed=1`, `waitUntilCalled`), T-03c auth 403.
- Migration `__tests__/orch_1044_thumb_orphaned_batch_reclaim.test.ts`: **7/7 PASS** (277ms) — T-02a..T-02g.
- Full `backfill-place-photo-thumbs/` dir (incl. tester adversarial): **13/13 PASS** (765ms).
- `deno check supabase/functions/backfill-place-photo-thumbs/index.ts`: **clean**.

### 4.2 Tester adversarial suite — `index.adversarial.test.ts` — 3/3 PASS (68ms)
Different angle than T-01 (which trips the guard BETWEEN places). TA exercises:
- **TA-01** guard trips MID-PLACE (a 3-photo place): place left un-finalized (`updatedPlaceIds=[]`, `succeeded=0`, `failed=0`), only photo 0 uploaded, guard stopped before photo 1's HEAD, `partial=true`.
- **TA-02** RESUME leg: round 2 HEAD-skips photo 0 (`thumbsAlreadyPresent=1`, NOT re-uploaded), writes photos 1 & 2, place finalized exactly once; **no double-upload** (`uploadedPaths = [pb/0,pb/1,pb/2]` across both rounds), `partial=false`.
- **TA-03** boundary: a job whose wall lands EXACTLY on `CPU_WALL_GUARD_MS` does NOT start (`>=` guard) — `uploadedPaths=[]`, no HEAD fires.

### 4.3 Fails-on-revert (independently reproduced by the tester)
- **T-01:** disabled the `CPU_WALL_GUARD_MS` guard (`if (false && …)`) → **T-01 FAILED** (`partial` expected true, got false), 9 passed / 1 failed. Restored → 10/10 PASS. Confirms the implementor's claim.
- **T-02:** removed `SET status='pending', started_at=NULL` from the reclaim → **T-02b FAILED**, 6 passed / 1 failed. Restored → 7/7 PASS. Confirms the implementor's claim.
- Working tree confirmed clean (`git diff HEAD` empty for both files) after the revert experiments.

---

## 5. Strict-grep gates

- **ORCH-0863 C7 (`orch-0863-marketing-hub-phase-b.mjs`):** **PASS.** New `ORCH_1044_BACKEND_ALLOWLIST` covers the new migration, the new migration test, AND the tester adversarial test, spread into the C7 `ALLOWLIST`. The edge fn `index.ts` + `index.test.ts` were already allowlisted under `ORCH_0957_BACKEND_ALLOWLIST`. Re-run post-commit (this branch) → all C1–C7 OK.
- **ORCH-0957 no-metered (`orch-0957-no-metered-place-photo-reads.mjs`):** **PASS** — zero `/storage/v1/render/image/` references; Approach A never calls the render endpoint.

---

## 6. Live-DB verification of the reclaim predicate (read-only, no mutation)

Against prod (`mcp__supabase__execute_sql`, project `gqnoajqerqhnvulmnyvv`):

- `tg_kick_pending_thumb_backfill` exists live (`kicker_exists=1`).
- **1 running thumbs run; 15 batches stuck in `running`; 15 reclaimable now** (all aged past the 3-min bound; implementor saw 13 at their earlier probe — the other 2 have since crossed 3 min, expected); **0 fresh-running batches** that the predicate would wrongly touch; **675 pending** batches waiting. The reclaim matches the current stuck state exactly.
- **Discriminator protection proven:** there is 1 OTHER running run (a non-thumb ORCH-1024 Photos run) with 2 running batches — the predicate's `city='ORCH-0957 place-photo thumbs' AND country='GLOBAL'` scope EXCLUDES it, so those 2 Photos batches are never touched.
- **Fresh-batch protection proven (synthetic CTE, read-only):** evaluating the exact WHERE predicate over synthetic rows: `stale_4min running`→reclaim YES; `fresh_30s running`→NO; `fresh_now running`→NO; `null_started running`→YES (a claim that never stamped started_at); `stale_but_completed`→NO (status guard). The predicate touches only stale/null-started running thumb batches.

---

## 7. Constitution (relevant rules)

| Rule | Verdict | Note |
|---|---|---|
| 2 One owner per truth | PASS | `thumbs_backfilled_at` written only by `processBatch`/`processPlaceThumbs`; batch status owned by the claim/finalize path |
| 3 No silent failures | PASS | guard-trip logs a `console.log` with elapsed; reclaim `RAISE NOTICE`s count; photo failures recorded in `failed_places` |
| 8 Subtract before adding | PASS | removed `BUDGET_MS` loop + `SAFETY_MAX_ITERATIONS` rather than layering on |
| 9 No fabricated data | PASS | counters only roll on real terminal writes; partial batch rolls nothing |
| 13 Exclusion consistency | PASS | same `is_servable + has-photos + no-thumb` scope at generation + claim; reclaim uses the same run discriminator as create/ensure |
| 1,4,5,6,7,10,11,12,14 | N/A | no client/auth/currency/persisted-state surface touched |

---

## 8. Findings

- **P4-1 (praise):** the guard-trip → return-to-pending → HEAD-skip-on-resume design makes the pipeline self-heal from ANY mid-batch worker death (546, timeout, deploy clobber), not just this bug. The reclaim's `BEFORE (a)/(b)` ordering means a stale batch is reclaimed and re-driven in the same cron tick.
- **P4-2 (praise):** `nowMs` injection point is a clean, side-effect-free seam for deterministic guard testing.
- **P3-1 (PRE-EXISTING, OUT OF SCOPE — discovery for orchestrator):** `supabase/migrations/__tests__/orch_1043_thumb_backfill_cron.test.ts:22` reads `../20260815000000_orch_1033_thumb_backfill_cron.sql` but the repo file is `..._orch_1043_...` → that ORCH-1043 test throws `NotFound` and fails the migration suite when run alongside others. NOT introduced by ORCH-1044 (the file is not in `origin/main...HEAD`); flagged by the implementor (Discovery #2). One-char filename fix; recommend a hygiene sub-ORCH. ORCH-1044's OWN migration test passes 7/7 in isolation and alongside the rename target would be unaffected.

---

## 9. Success criteria

| SC | Status |
|---|---|
| SC-1 run completes, 0 batches left running | verified-by-mechanism (reclaim heals 15 stuck + single-unit drains) — orchestrator confirms post-deploy |
| SC-2 zero 546 | **verified-by-mechanism** (1.2 s wall guard « 2 s CPU cap, single unit/invocation) — orchestrator confirms post-deploy via `get_logs` |
| SC-3 counters climb monotonically | verified-by-mechanism (self-invoke chain + cron) — orchestrator confirms post-deploy |
| SC-4 thumb URL 200 | unchanged bytes (`encodeJPEG`) — orchestrator confirms post-deploy |
| SC-5 orphaned running reclaimed in bound | **verified** — unit (T-02) + live predicate match (15 reclaimable, 0 fresh touched) |
| SC-6 both gates green | **PASS** (C7 + ORCH-0957) |
| SC-7 triggered_by NULL for cron | **verified** (`AUTO_RUN_TRIGGERED_BY=null` preserved) |

**Live-drain (a run actually completing batches with zero 546) is verified-by-mechanism here; the orchestrator confirms it post-deploy** (migration applied via Management API + edge fn deployed from main), per the deploy carve-out.

---

## 10. Discoveries for orchestrator

1. Apply the migration via Management API (NOT `db push`, COMMS-0012) and verify `list_migrations` shows `20260818000000` before the close banner. Deploy the edge fn FROM main after the PR merges (COMMS-0015), then watch `get_logs(edge-function)` for zero 546 across the drain.
2. **P3-1** pre-existing broken ORCH-1043 migration-test filename (`orch_1033` vs `orch_1043`) — recommend a one-line hygiene sub-ORCH.
3. Carried from investigation: `run-place-intelligence-trial` (collage/intel prep) has the same imagescript-CPU-over-2s mechanism — recommend a sibling ORCH applying the same per-invocation CPU-budget discipline.
