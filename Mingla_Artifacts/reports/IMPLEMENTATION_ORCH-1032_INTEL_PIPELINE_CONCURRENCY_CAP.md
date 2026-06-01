# IMPLEMENTATION — ORCH-1032 [Intelligence pipeline concurrency cap + chunked enqueue]

**Skill:** mingla-implementor (Claude parity mirror)
**Date:** 2026-06-01
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1032-[intel-pipeline-concurrency-cap]/` on branch `ORCH-1032-intel-pipeline-concurrency-cap`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1032_INTEL_PIPELINE_CONCURRENCY_CAP.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1032_INTEL_PIPELINE_CONCURRENCY_546.md`
**Status:** implemented and verified (tests green + fails-on-revert proven + type-check + gate green). Migration NOT applied (operator runs `db push` at CLOSE).
**Fix commit:** `65caaa9b8d82133624597ba1f4107b7aaba6e8ef`
**Pre-fix (fails-on-revert) commit:** `e944b0b202e08145bac81ca125b60d45ad8cf915`

---

## 0. Pre-flight probes (read-only, live remote — 2026-06-01)

- **Status constraint name:** `place_intelligence_runs_status_check` (matches spec literal; the `DROP CONSTRAINT IF EXISTS` uses this exact name). Live def: `CHECK (status = ANY (ARRAY['pending','running','cancelling','cancelled','complete','failed']))`.
- **Unique active index:** `uniq_one_running_run_per_city` WHERE `status = ANY (ARRAY['pending','running','cancelling'])` (migration adds `'queued'`).
- **Migration head / monotonicity:** `mcp__supabase__list_migrations` shows remote head includes `20260810000000_orch_1027_launch_cities`, plus `20260809000000_meta_orch_1009_sub_e` + `20260809000300`. Sibling worktrees also carry `20260809000000`/`20260809000300`. **Spec's proposed `20260809000000` was taken → bumped to `20260811000000`** (strictly greater than max local + linked-remote head + sibling prefixes).
- **5 in-flight runs (NOT written to):** Washington / Lagos / Durham / Brussels / Fort Lauderdale, all `status='running'` with live `processed_count` < `total_count`. Only read-only `SELECT`s were issued against `place_intelligence_runs`. No writes. No `mcp__supabase__apply_migration`.

---

## 1. Old → New Receipts

### supabase/migrations/20260811000000_orch_1032_queued_status_and_cap.sql (NEW)
**Before:** did not exist.
**Now:** additive migration. (S-1a) `DROP CONSTRAINT IF EXISTS place_intelligence_runs_status_check` + `ADD CONSTRAINT … CHECK (status IN ('pending','queued','running','cancelling','cancelled','complete','failed'))` — strict 6→7-value superset (validation cannot fail on existing rows). (S-1b) `DROP INDEX` + `CREATE UNIQUE INDEX uniq_one_running_run_per_city … WHERE status IN ('pending','queued','running','cancelling')`. (S-1c) updated `COMMENT ON TABLE`. (S-4) `CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs()` built on the v3 body: adds a promotion block (`free_slots := 4 - running_count; IF free_slots > 0 THEN FOR q IN SELECT … WHERE status='queued' ORDER BY created_at ASC LIMIT free_slots FOR UPDATE SKIP LOCKED LOOP UPDATE … SET status='running', started_at=now(); PERFORM net.http_post(...) END LOOP`), then the v3 stale-heartbeat re-kick verbatim except `LIMIT 5→4`. SECURITY DEFINER + `vault.decrypted_secrets` read preserved; no key literal.
**Why:** S-1 (queued status) + S-4 (cron promotion) in one atomic apply (HG-2 additive-only).
**Lines:** ~190 (incl. safety + rollback comments).

### supabase/functions/run-place-intelligence-trial/index.ts (MODIFY)
**Before:** `handleStartRun` always inserted `status:'running'` + `started_at` with no count gate (RC-1); single `.upsert(pendingRows)` of up to 10,706 rows (RC-2); first-chunk kick gated only on mode; `handleListActiveRuns` `.in("status", ["pending","running","cancelling"])`.
**Now:** (S-2) `MAX_CONCURRENT_RUNS = 4` + `BATCH_INSERT_SIZE = 1000` constants with cross-ref comment to the migration. (S-3) before the parent insert, count `status='running'` (`head:true`); `atCapacity = runningCount >= MAX`; parent insert branches `status: atCapacity ? "queued":"running"` + `started_at: atCapacity ? null : now`; first-chunk kick gated on `!atCapacity && …`; response payload adds `status`, `queued`, `aheadCount` (best-effort = running count when at capacity), `maxConcurrentRuns`. (S-5) single upsert replaced with a `for (i += BATCH_INSERT_SIZE)` loop of `slice(i, i+BATCH_INSERT_SIZE)` upserts preserving `onConflict:"run_id,place_pool_id"` + the identical parent-rollback-on-failure. (S-6 data) `handleListActiveRuns` adds `"queued"` to the `.in(...)`.
**Why:** RC-1 (S-3+gate) + RC-2 (S-5 chunking) + S-6 control-tower visibility.
**Lines:** ~70 changed/added.

### mingla-admin/src/components/placeIntelligenceTrial/ActiveRunCard.jsx (MODIFY)
**Before:** no `queued` handling (fell through to `--color-text-tertiary` pill + raw status label, no waiting affordance).
**Now:** `statusPillClasses` queued branch → `bg-[var(--gray-100)] text-[var(--color-text-secondary)]` (neutral, never error/warning); `statusLabel` → "Queued"; `isQueued` const; action row renders a calm `Clock`-icon row "Queued — waiting for a free slot" (no spinner). `Clock` already imported.
**Why:** SC-9 — queued is a calm waiting state.
**Lines:** ~15 added.

### mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx (MODIFY)
**Before:** success branch always showed `variant:"info"` "Remainder run started" toast.
**Now:** branches on `data.queued`: queued → `variant:"info"` "Queued — waiting for a free slot" + "(N ahead)" when `aheadCount>0`; else the existing started toast. The `concurrent_run` 409 path is unchanged.
**Why:** SC-10 — queued success is calm info, never error/warning.
**Lines:** ~15 changed.

### .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs (MODIFY)
**Before:** C7 `no-new-backend-files` allowlist had no ORCH-1032 entry.
**Now:** added `ORCH_1032_BACKEND_ALLOWLIST` (new migration + 2 edge tests + 1 migration test) and spread it into `ALLOWLIST`. Edge `index.ts` is a MODIFY already allowlisted under `META_ORCH_1009_SUB_D`.
**Why:** COMMS-0002 — same-commit allowlist or C7 fails. Self-test PASSED; full gate exit 0.
**Lines:** ~12 added.

### Test files (NEW)
- `supabase/functions/run-place-intelligence-trial/__tests__/concurrencyCap.test.ts` — §7.1 implementor happy-path (T-01…T-07).
- `supabase/functions/run-place-intelligence-trial/__tests__/concurrencyCap_adversarial.test.ts` — §7.2 adversarial edge side (T-08/T-08b/T-08c/T-14).
- `supabase/migrations/__tests__/orch_1032_cron_promotion.test.ts` — §7.2 cron-promotion arithmetic + SQL shape (T-09…T-13).

---

## 2. Spec Traceability (Success Criteria)

| SC | Verdict | Evidence |
|----|---------|----------|
| SC-1 | PASS (migration shape) / live by db push | Migration widens CHECK to 7 values; T-12 asserts additive shape. 5 in-flight runs untouched (read-only probes only). |
| SC-2 | PASS | T-14 asserts `MAX_CONCURRENT_RUNS=4` (index.ts) == `free_slots := 4 - running_count` == re-kick `LIMIT 4`. |
| SC-3 | PASS | T-01 (below cap → running + kick); T-05 source-inspect of branch. |
| SC-4 | PASS | T-02/T-08 (at cap → queued, no kick, HTTP 200, `queued:true`/`maxConcurrentRuns` in payload); T-05 payload source-inspect. |
| SC-5 | PASS (by construction) | Index WHERE now covers `queued`; the existing 23505→409 `concurrent_run` guard is unchanged. T-12 asserts the widened WHERE. |
| SC-6 | PASS | T-04 (10706 → 11 batches, last 706, none > 1000); T-06 source-inspect of loop + `onConflict`. |
| SC-7 | PASS | Rollback-on-batch-failure preserved (`status:'failed'` + `error_reason` + 500); source unchanged in shape. |
| SC-8 | PASS | T-09/T-11 (promote exactly free-slot count, oldest-first); T-11 source-inspect ORDER BY ASC + LIMIT free_slots. |
| SC-9 | PASS | ActiveRunCard queued pill neutral + "Queued — waiting for a free slot", no spinner, no Cancel/View. ESLint clean. |
| SC-10 | PASS | RunRemainderConfirmModal queued → `variant:"info"` "Queued — waiting for a free slot". |
| SC-11 | PASS | `config.toml` line 60-61 `verify_jwt = true` untouched. |

---

## 3. Regression Test (mandatory gate)

**Runner:** `/Users/sethogieva/.deno/bin/deno test --allow-read` (3 files).
**Passing run (fix in place):** `ok | 18 passed | 0 failed (79ms)` — T-01…T-14 all green.
**Fails-on-revert proof:** at parent commit `e944b0b202e08145bac81ca125b60d45ad8cf915` (index.ts reverted to pre-fix + migration file removed, test files kept), the run was `FAILED | 7 passed | 5 failed`: source-inspect T-05/T-06/T-07/T-14 FAIL (gate/chunk/queued/cap-match strings absent) and `orch_1032_cron_promotion.test.ts` errors (migration file gone). The pure-logic mirrors (T-01..T-04, T-08..T-11) intentionally pass standalone — the source-inspect half is the revert detector, per the established two-key `runRemainder.test.ts` pattern. Fix restored → 18 pass again; working tree clean.

**Append-only:** all three test files are NEW; no existing test modified.

---

## 4. Other gates

- `deno check supabase/functions/run-place-intelligence-trial/index.ts` → exit 0 (type-clean).
- ESLint `ActiveRunCard.jsx` + `RunRemainderConfirmModal.jsx` → exit 0.
- Strict-grep `--self-test` → "Self-test PASSED"; full gate → exit 0, `C7: no-new-backend-files` OK (new files allowlisted).
- Existing admin regression: `orch1013_active_runs_control_tower.test.js` 8/8 pass.

---

## 5. Invariant Verification

| INV | Preserved? | Note |
|-----|------------|------|
| INV-P1 one active commitment per city | Y | Index recreated strictly tighter (adds `queued`). |
| INV-P2 chk_sample_size_consistency | Y | Not touched. |
| INV-P3 worker/budget/heartbeat unchanged | Y | No `process_chunk` diff. |
| INV-P4 v3 cancelling re-kick | Y | `status IN ('running','cancelling')` + 90s window preserved verbatim (T-13). |
| INV-P5 5 in-flight runs never mutated | Y | Read-only probes only; gate affects new inserts; promotion touches only `queued` rows. |
| INV-P6 verify_jwt=true on redeploy | Y | config.toml unchanged (SC-11). |

New invariants I-PROPOSED-INTEL-CONCURRENCY-CAP-ENFORCED / -CAP-SINGLE-SOURCE / -ENQUEUE-CHUNKED: established, DRAFT → ACTIVE on CLOSE.

---

## 6. Cross-surface impact

Only **Admin Web** (`mingla-admin/`) renders queued (single React codebase, parity automatic). Backend (`supabase/`) is the primary changed layer. Consumer iOS/Android, Buyer-anon web, Business iOS/Android, Business-web preview: NOT affected (admin-only pipeline; no analog). `useActiveRunsPoller.js` confirmed at IMPLEMENT to bucket by presence in the `list_active_runs` response (no client-side status allowlist) → queued cards appear automatically; no poller change.

---

## 7. Hard guards

HG-1 (5 runs untouched) ✓ · HG-2 (additive-only) ✓ · HG-3 (v3 re-kick verbatim) ✓ · HG-4 (no worker/scorer/sampler refactor) ✓ · HG-5 (verify_jwt) ✓ · HG-6 (no secrets in code; vault read preserved) ✓.

---

## 8. Migrations awaiting `supabase db push` — operator command (CLOSE-time)

Per COMMS-0015: merge PR to main FIRST, confirm origin/main has the squash commit + content probe, THEN apply the migration, THEN redeploy the edge fn from main with `verify_jwt` preserved, THEN verify the new version on remote (`mcp__supabase__list_migrations`) BEFORE the close banner.

Migration apply (operator):
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1032-[intel-pipeline-concurrency-cap]" && /Users/sethogieva/bin/supabase db push --linked
```
(Pre-flight: from the worktree run `/Users/sethogieva/bin/supabase migration list --linked` and confirm no remote-only version above `20260810000000` before pushing. No `--include-all` needed — `20260811000000` is strictly greater than the remote head.)

Edge-fn redeploy (orchestrator, post-merge from main):
```bash
supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

**Deno test/check gates were run in this Claude session (deno available at `/Users/sethogieva/.deno/bin/deno`).**

---

## 9. Discoveries for Orchestrator

- **Pre-existing admin test failure (NOT ORCH-1032):** `mingla-admin/src/__tests__/orch1013_adversarial_modal_and_tower.test.js` subtest "candidateCities is memoized" FAILS (1/25) — it asserts `IntelligenceOverviewTab.jsx` `useMemo`s `candidateCities`. My commit's diff for that file is empty; the failure is independent of ORCH-1032 (the file is untouched). Recommend registering a small follow-up to memoize `candidateCities` or update the test. Not fixed here (scope discipline).
- **`aheadCount` simplification:** per spec §4.3 🎨 OPEN, `aheadCount` is reported as the running count when at capacity (best-effort, never throws/blocks). The LOCKED contract (`queued:true` + `status:'queued'` + `maxConcurrentRuns`) is satisfied exactly.
