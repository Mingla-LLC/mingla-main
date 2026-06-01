# QA — ORCH-1032 [Intelligence pipeline concurrency cap + chunked enqueue]

**Skill:** mingla-tester (Claude)
**Date:** 2026-06-01
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1032-[intel-pipeline-concurrency-cap]/` on branch `ORCH-1032-intel-pipeline-concurrency-cap`
**Mode:** TARGETED + SPEC-COMPLIANCE
**Fix commit under test:** `65caaa9b8` (+ `bd897ee3d` impl report)
**Inputs:** SPEC `SPEC_ORCH-1032_INTEL_PIPELINE_CONCURRENCY_CAP.md`; IMPL `IMPLEMENTATION_ORCH-1032_INTEL_PIPELINE_CONCURRENCY_CAP.md`; INVESTIGATION `INVESTIGATION_ORCH-1032_INTEL_PIPELINE_CONCURRENCY_546.md`.

## Verdict: **PASS**

- P0: 0 | P1: 0 | P2: 0 | P3: 1 (note) | P4: 2 (praise)

---

## 0. Comms ledger

Read on entry. No Active row targets ORCH-1032, this skill, or `ALL` requiring action this turn (COMMS-0002/0003/0004 are backend/strict-grep/intake WARNs already broadly acked; COMMS-0002 factored — the new backend test file is allowlisted, see §6). No new cross-ORCH discovery this turn.

## 1. Sim-gate disposition

**Exempt from the live-fire sim leg for the backend layers** (SQL migration + Deno edge function + cron PL/pgSQL) per Phase 0.A backend-only exemption — these are not UI/runtime surfaces.

The only UI surface is **admin-web** (`mingla-admin/`, one React codebase, web-only — no iOS/Android/business legs apply). The admin change is two pure render/branch additions (a status pill + label + a static waiting row in `ActiveRunCard.jsx`; a toast-branch in `RunRemainderConfirmModal.jsx`). They are gated entirely on a `data.queued === true` / `run.status === "queued"` boolean and add no new control flow, network call, or interaction. The `queued` runtime state cannot be produced on the admin without 4 concurrent live `running` runs against the production pipeline (the gate is server-side), so a live admin repro would require driving the production intelligence pipeline to capacity — out of proportion and not safely reproducible in QA. I verified the admin behavior by source + data-flow inspection and rate it `proven` for the render contract (the branch is deterministic on a boolean) and explicitly note the deferral of an end-to-end at-capacity admin screenshot as an accepted backend-driven limitation. No P0/P1 hinges on it.

## 2. Independent code verification (read the actual changed code — did not trust the report)

### 2.1 Migration `supabase/migrations/20260811000000_orch_1032_queued_status_and_cap.sql`

- **Status CHECK widened to the 7 values** — `DROP CONSTRAINT IF EXISTS place_intelligence_runs_status_check` then `ADD CONSTRAINT … CHECK (status IN ('pending','queued','running','cancelling','cancelled','complete','failed'))`. Confirmed verbatim. **PASS.**
- **Unique index widened to include `queued`** — `DROP INDEX IF EXISTS uniq_one_running_run_per_city` then `CREATE UNIQUE INDEX … (city_id) WHERE status IN ('pending','queued','running','cancelling')`. Confirmed. **PASS.**
- **Cron promotion** — `tg_kick_pending_trial_runs()` `CREATE OR REPLACE`: `running_count := count(status='running')`; `free_slots := 4 - running_count`; `IF free_slots > 0 THEN FOR q IN SELECT id … WHERE status='queued' ORDER BY created_at ASC LIMIT free_slots FOR UPDATE SKIP LOCKED LOOP UPDATE … SET status='running', started_at=now(); PERFORM net.http_post(...) END LOOP`. Confirmed. **PASS.**
- **v3 stale-heartbeat re-kick preserved** — the `FOR r IN … WHERE status IN ('running','cancelling') AND processed_count < total_count AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds') ORDER BY created_at ASC LIMIT 4` loop is the v3 body verbatim, only `LIMIT 5→4`. Diffed against `20260506000002_orch_0737_v3_cron_filter_cancelling.sql` (v3 had `LIMIT 5`, same `status IN ('running','cancelling')`, same 90s window). **PASS — INV-P4 / HG-3 preserved.**
- **Additive-only / safe-with-active-rows** — file contains NO `DROP TABLE`, NO `ALTER COLUMN … TYPE`, NO `SET NOT NULL`, NO data migration. CHECK widen is a strict 6→7 superset; index recreate is sub-second on a low-hundred-row table; `CREATE OR REPLACE FUNCTION` is atomic. **PASS — HG-2.**
- **Live-data proof the apply is safe (independent, read-only):** I queried the production DB. Current status distribution = `running:5, complete:5, cancelled:5`. Zero rows fall outside the new 7-value set (`rows_violating_new_check = 0`) → the `ADD CONSTRAINT` validation pass cannot fail; the migration applies cleanly while the 5 runs are live with no rewrite. **SC-1 verified against live data.**
- **Cron LIMIT/free-slot math = cap (4):** `free_slots := 4 - running_count`, promotion `LIMIT free_slots`, re-kick `LIMIT 4`, all == `MAX_CONCURRENT_RUNS=4`. **PASS.**
- **No secrets in code** — `service_role_key` read from `vault.decrypted_secrets`; no JWT literal. **PASS — HG-6.**

### 2.2 Edge fn `run-place-intelligence-trial/index.ts`

- **Gate counts `status='running'` only** — `.select("id",{count:"exact",head:true}).eq("status","running")`; `atCapacity = (runningCount ?? 0) >= MAX_CONCURRENT_RUNS`. cancelling/queued correctly excluded. **PASS.**
- **At-capacity inserts `queued`** — parent insert branches `status: atCapacity ? "queued" : "running"`, `started_at: atCapacity ? null : now`. No first-chunk kick when at capacity (`if (!atCapacity && (mode === "full_city" || mode === "remainder") && serviceKey)`). Returns HTTP 200 with `status:'queued'`, `queued:true`, `aheadCount`, `maxConcurrentRuns:4`. **PASS — SC-4.**
- **Below capacity = unchanged** — identical insert/kick/payload as before, `queued:false`. **PASS — SC-3.**
- **Per-city 23505 guard intact** — the existing `parentInsertErr` 23505→`concurrent_run` 409 path is untouched; the widened index now also covers `queued`. **PASS — SC-5.**
- **Chunked enqueue** — single `.upsert(pendingRows)` replaced with `for (i += BATCH_INSERT_SIZE=1000) { upsert(slice(i, i+1000), { onConflict:"run_id,place_pool_id" }) }`; on any batch error, parent rolled back to `status:'failed'` + `error_reason` + return 500. `onConflict` preserved; rollback contract identical. The chunk loop runs for BOTH branches (queued runs need child rows pre-inserted). **PASS — SC-6 / SC-7.**
- **`list_active_runs` includes queued** — `.in("status",["pending","queued","running","cancelling"])`. **PASS.**
- **`deno check` on index.ts → exit 0** (type-clean, re-run independently).

### 2.3 Cap single-source-of-truth

`MAX_CONCURRENT_RUNS = 4` (index.ts) with a cross-ref comment block pointing at the migration; the migration mirrors `free_slots := 4 - running_count` + `LIMIT 4` with a comment pointing back. Drift is caught by T-14 (cross-file source-inspect, runs green; fails-on-revert proven). **PASS — SC-2 / I-PROPOSED-INTEL-CAP-SINGLE-SOURCE.**

### 2.4 Admin UI

- `ActiveRunCard.jsx`: `statusPillClasses` queued branch → `bg-[var(--gray-100)] text-[var(--color-text-secondary)]` (neutral, NOT `--color-error-*`/`--color-warning-*`); `statusLabel` → "Queued"; action row renders a calm `Clock`-icon row "Queued — waiting for a free slot", NO spinner, no Cancel/View. **PASS — SC-9.**
- `RunRemainderConfirmModal.jsx`: success branches on `data.queued` → `variant:"info"` toast "Queued — waiting for a free slot" + "(N ahead)" when `aheadCount>0`; never error/warning; existing `concurrent_run` 409 path unchanged. **PASS — SC-10.**
- `useActiveRunsPoller.js` (independently inspected): `activeRuns` is populated by mapping `data.runs` from the `list_active_runs` response with NO client-side status allowlist (keys off response presence). Since the edge fn now returns `queued` rows, queued cards surface automatically. Implementor claim verified. **PASS.**

### 2.5 Hard guards (grep-proven)

- **HG-1 (5 in-flight runs never written):** the only writes in `handleStartRun` target the NEW `runId` (parent insert + rollback `.eq("id", runId)`) and the new child rows; the cron promotion `UPDATE` is scoped `WHERE status='queued'` (the 5 runs are `running`, never matched). No code path writes the in-flight runs. Live probe confirms 5 `running` rows present and outside every mutation predicate. **PASS.**
- **HG-4 (no scope creep):** diff touches exactly 8 files = 1 migration + edge fn + 2 admin components + 1 strict-grep allowlist + 3 test files. No worker/scorer/sampler/budget-loop/`process_chunk` diff. **PASS.**
- **HG-5 (verify_jwt):** `supabase/config.toml` line 60-61 `[functions.run-place-intelligence-trial] verify_jwt = true` untouched. **PASS — SC-11.**

## 3. Spec success-criteria matrix

| SC | Verdict | Basis |
|----|---------|-------|
| SC-1 | PASS | Migration 7-value CHECK; live data shows 0 violating rows → validation cannot fail; 5 running runs untouched |
| SC-2 | PASS | T-14 green + fails-on-revert; cross-ref comments present |
| SC-3 | PASS | Below-cap branch unchanged (source) + T-01/T-08c |
| SC-4 | PASS | At-cap queued, no kick, HTTP 200, payload fields (source) + T-02/T-08/T-08b |
| SC-5 | PASS | Index WHERE covers queued + 23505 guard intact + my A2 collision tests |
| SC-6 | PASS | Chunk loop + onConflict (source) + T-04 (10706→11 batches) |
| SC-7 | PASS | Parent rollback-to-failed + 500 preserved (source) |
| SC-8 | PASS | Promotion oldest-first, LIMIT free_slots, IF free_slots>0 (source) + T-09/T-10/T-11 |
| SC-9 | PASS | ActiveRunCard neutral pill + label + calm row, no spinner |
| SC-10 | PASS | Modal info toast, never error/warning |
| SC-11 | PASS | config.toml verify_jwt=true unchanged |

All 11 met.

## 4. Regression-test gate

**Implementor tests (3 files, 18 tests) — re-run independently:** `ok | 18 passed | 0 failed`.

**Fails-on-revert — independently re-verified** (NOT trusting the report). Scratch dir `/tmp/orch1032_revert`: fixed test files + pre-fix `index.ts` (from parent `e944b0b20`) + migration absent → `FAILED | 7 passed | 5 failed`. T-05/T-06/T-07 (gate/chunk/queued source-inspect) FAIL, T-14 (cap-match) FAILS, cron-promotion test errors (migration gone). Matches the implementor's claimed `7 passed | 5 failed`. The pure-logic mirrors (T-01..T-04, T-08..T-11) pass standalone by design — the source-inspect half is the revert detector, per the established two-key `runRemainder.test.ts` pattern.

**Tester adversarial test (NEW, CLOSE Step 0.5 gate):**
`supabase/migrations/__tests__/orch_1032_additive_safety_adversarial.test.ts` — **7 tests, green.**

Attacks a DIFFERENT angle than the implementor's `concurrencyCap_adversarial.test.ts` (which attacks the cap+1 short-circuit + cross-file cap-literal match) and `orch_1032_cron_promotion.test.ts` (promotion arithmetic). Mine evaluates, as predicate LOGIC parsed from the real artifacts:
- **(A1)** the widened CHECK admits exactly the 7 values AND rejects an 8th (`paused`, `QUEUED`, empty, etc.) — the implementor only grep'd the literal `'queued'`, never proved the predicate's membership semantics.
- **(A2)** the widened per-city unique partial index: a `queued`+`running` pair for the SAME city is REJECTED; two queued for one city REJECTED; a `queued` for one city + `running` for another city COEXIST; terminal rows (complete/cancelled/failed) NEVER block a new active row for the same city.
- **(B)** the gate count-query counts `status='running'` ONLY (re-derived from `index.ts` source) — a mixed population of 3 running + 2 queued + 1 cancelling + terminals yields `runningCount=3`, `atCapacity=false` — the symmetric *over-parking* failure the implementor never covered (a widened `.in([...])` count would push the gate to capacity prematurely).

**Genuinely adversarial — independently proven to fail on revert TWO ways:** (1) migration absent → uncaught-error FAIL; (2) migration file PRESENT but `'queued'` surgically removed from the CHECK + index WHERE (semantic degradation, not file deletion) → `4 passed | 3 failed` (A1 + both A2 set/collision tests fire). This proves it tests behavior, not just file presence.

**PR-diff presence:** both regression tests appear in `git diff origin/main...HEAD --name-only` (implementor's `concurrencyCap*.test.ts` + `orch_1032_cron_promotion.test.ts` + my `orch_1032_additive_safety_adversarial.test.ts`). They ship with the fix.

**Full 4-file suite (18 + 7): `ok | 25 passed | 0 failed`.**

## 5. Pre-existing admin failure — confirmed UNRELATED, not a regression

`mingla-admin/src/__tests__/orch1013_adversarial_modal_and_tower.test.js` subtest **"candidateCities is memoized"** source-inspects `IntelligenceOverviewTab.jsx` for `const candidateCities = useMemo(`. Independently verified:
- `IntelligenceOverviewTab.jsx` is **NOT** in the ORCH-1032 diff (`git diff origin/main...HEAD --name-only` — only `ActiveRunCard.jsx` + `RunRemainderConfirmModal.jsx` under `mingla-admin/`).
- The `useMemo` is absent on `origin/main` too (`git show origin/main:…IntelligenceOverviewTab.jsx | grep -c "const candidateCities = useMemo"` → 0), and the worktree file equals main for that path.

The assertion fails on `main` independently of this work. **Pre-existing, fully unrelated to ORCH-1032, not introduced here.** P3 note → recommend a small follow-up ORCH to memoize `candidateCities` or update the test. The implementor's flag (IMPL §9) is accurate.

## 6. Strict-grep (COMMS-0002)

Added `orch_1032_additive_safety_adversarial.test.ts` to the `ORCH_1032_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (same place the implementor allowlisted the other ORCH-1032 backend files). Re-ran: `--self-test` → **Self-test PASSED**; full gate → **exit 0**, C7 `no-new-backend-files` OK (9 files changed, all allowlisted).

## 7. Constitution (relevant rules)

- R2 one-owner-per-truth: cap is a single named constant per side, cross-referenced, drift-asserted. **PASS.**
- R3 no-silent-failures: count error → 500; batch error → parent failed + 500; queued surfaced as visible state. **PASS.**
- R9 no-fabricated-data: `aheadCount` is best-effort UI sugar (running count when at capacity), never throws/blocks the 200; LOCKED contract (`queued`/`status`/`maxConcurrentRuns`) exact. **PASS.**
- R7 label-temporary: N/A (no transitional code). Others N/A (backend/admin-only).

## 8. Findings

- **P4 (praise):** Migration additive-safety is exemplary — strict-superset CHECK, sub-second index rebuild, atomic `CREATE OR REPLACE`, inline rollback reference, live-probe-confirmed-name `DROP CONSTRAINT`. Live data independently confirms zero-rewrite-risk apply.
- **P4 (praise):** v3 cancelling re-kick preserved verbatim with an explanatory comment so a future editor sees the constraint before touching it (HG-3 / INV-P4).
- **P3 (note, pre-existing, NOT this ORCH):** `candidateCities is memoized` admin test fails on main (see §5). Recommend a follow-up ORCH.
- **P3 (note, informational):** The implementor's happy-path pure-logic mirrors (T-01..T-04, T-08..T-11) re-declare the constants inside the test, so they pass standalone even on revert; the revert detection rests entirely on the source-inspect half (T-05/06/07/14) + the migration-test file presence. This is the documented two-key pattern and is sufficient (revert proven), but worth noting the behavioral mirrors alone are not revert-sensitive.

## 9. Completion-condition checklist (machine-verified)

1. Every independent test green — 25/0 captured (§4). ✔
2. `deno check` index.ts clean (§2.2); strict-grep self-test + gate exit 0 (§6). ✔ (admin ESLint/tsc not re-run by me — admin change is 2 deterministic branch additions, no new imports; implementor cited ESLint exit 0.)
3. Both regression tests in `git diff origin/main...HEAD --name-only`; adversarial attacks a different angle (predicate logic vs source-grep); implementor fails-on-revert independently re-verified at parent `e944b0b20`. ✔
4. UI/runtime: only admin-web, deterministic boolean branch; backend-driven at-capacity state not safely reproducible in QA — render contract `proven` by source, end-to-end screenshot deferred (no P0/P1 hinges). ✔ (documented §1)
5. Zero open P0, zero open P1. ✔

PASS conditions hold.
