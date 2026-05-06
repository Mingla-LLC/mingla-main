# IMPLEMENTATION REPORT — ORCH-0737 v3 PATCH (cron filter cancelling)

**ORCH-ID:** ORCH-0737 v3 patch (post-deploy fix; not re-implementation)
**Dispatch:** [`prompts/IMPLEMENTOR_ORCH-0737_PATCH_V3_CONFIG_AND_CRON_FILTER.md`](../prompts/IMPLEMENTOR_ORCH-0737_PATCH_V3_CONFIG_AND_CRON_FILTER.md) (scope-locked to Fix 2 only; Fix 1 done in parallel chat)
**Predecessor:** [`reports/IMPLEMENTATION_ORCH-0737_PATCH_V2_REPORT.md`](IMPLEMENTATION_ORCH-0737_PATCH_V2_REPORT.md) (v2 patch report)
**Status:** **implemented, unverified** — code written + grep-verified; runtime cancel test pending operator
**Effort:** ~3 min wallclock (vs ~3 min estimate)

---

## 1. Layman Summary

One-fix patch: pg_cron's worker-kicker function now ALSO kicks runs in `cancelling` state (was only kicking `running`). This unblocks the cancel-finalization path — when operator clicks Cancel, parent goes `cancelling`, next cron tick (within 60s) kicks the worker, worker observes cancelling + flips parent to `cancelled` + cleans pending/running children. UI flips terminal within 60-90s.

`supabase/config.toml` NOT touched per dispatch scope (operator removed the invalid `max_request_duration_seconds = 200` key in a parallel chat).

---

## 2. Pre-Flight Probes

| Probe | Result |
|-------|--------|
| Existing v1 migration (`20260506000001_orch_0737_async_trial_runs.sql`) trigger function definition | ✅ Read lines 171-225; current WHERE filter is `status = 'running'` (the bug) |
| `supabase/config.toml` state per dispatch scope | ✅ Already modified by parallel chat (10 insertions / 1 deletion); `max_request_duration_seconds` removed; deferral comment added. **NOT TOUCHED by this dispatch.** |
| Migration timestamp `20260506000002_*` collision | ✅ No existing file at that timestamp |

---

## 3. Old → New Receipts

### File 1 — `supabase/migrations/20260506000002_orch_0737_v3_cron_filter_cancelling.sql` (NEW, 90 LOC)

**What it did before:** N/A (new file)

**What it does now:**
- `CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs()` with v1's body verbatim EXCEPT the `WHERE status = 'running'` clause changed to `WHERE status IN ('running', 'cancelling')`
- `COMMENT ON FUNCTION` updated to document the v3 widening
- BEGIN/COMMIT transaction-wrapped (atomic replacement; in-flight cron tick uses old definition until commit, next tick uses new)
- Rollback reference SQL in trailing comment

**Why:** Dispatch §"Fix 2" — when admin clicks Cancel, `cancel_trial` action sets `parent.status = 'cancelling'`. The next pg_cron tick should kick the worker so it observes the cancel signal (v2-patch cleanup branch executes). Pre-v3 filter `WHERE status = 'running'` excluded `cancelling`, so the worker never got kicked, never observed, never finalized — UI stuck at "cancelling" forever.

**Lines changed:** +90 / -0 (new file; CREATE OR REPLACE replaces in-DB function on apply)

---

## 4. Files NOT Touched (per dispatch scope)

### `supabase/config.toml`
- Operator's parallel chat already removed the invalid `max_request_duration_seconds = 200` line and added a deferral comment explaining the CLI-version mismatch
- Dispatch v3 explicitly said "DO NOT TOUCH" with a STOP instruction
- Verified via `git diff --stat`: shows 10 insertions / 1 deletion from parallel chat work; my dispatch added zero lines
- Default 150s edge fn timeout applies; chunk size 6 (from v2 patch) gives 30-50s wallclock — comfortably under

### `supabase/functions/run-place-intelligence-trial/index.ts`
- v2-patch fixes (chunk=6, cancel-cleanup pending+running) PRESERVED unchanged
- Worker code already correctly handles `cancelling` state when observed; v3 is purely the filter-fix to make worker actually get kicked to OBSERVE

### `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql`
- Already applied to DB; modifying in place would cause `supabase db push` to drift
- v3 supersedes via `CREATE OR REPLACE FUNCTION` in new migration (atomic; cron schedule untouched)

---

## 5. Verification

### Grep checks (static-trace)

| Check | Result |
|-------|--------|
| v3 migration WHERE filter widened | ✅ `status IN ('running', 'cancelling')` at line 56 |
| v3 migration uses `CREATE OR REPLACE` (not DROP + CREATE) | ✅ Atomic replacement; cron schedule (jobid=15) untouched |
| `COMMENT ON FUNCTION` updated | ✅ At line 78 with v3 patch context |
| `supabase/config.toml` not touched by this dispatch | ✅ git diff shows parallel-chat changes only |
| No new edge fn changes | ✅ `index.ts` not modified by this dispatch |

### Runtime verification (UNVERIFIED — operator-side)

After operator runs `supabase db push`:
- `SELECT pg_get_functiondef('public.tg_kick_pending_trial_runs'::regproc);` — should show `WHERE status IN ('running', 'cancelling')`
- Stuck cancel test: start a Cary full-city run → click Cancel within 5 min → expect parent.status flips `cancelling` → within 60-90s flips to `cancelled` (next pg_cron tick kicks worker; worker observes; finalizes via v2-patch cleanup branch)

---

## 6. Spec Traceability

This is a tuning patch — no SC additions. The fix indirectly enables SC-08 (cancel signal observed within ≤90s) and SC-13 (UI flips cancelling → cancelled). Pre-v3 these SCs would have failed runtime smoke; post-v3 they should PASS.

---

## 7. Invariant Verification

All 7 ORCH-0737 invariants from SPEC v2 §11: **PRESERVED.** Patch only widens a filter clause; no architectural change. No new invariants introduced.

---

## 8. Cache Safety

N/A — no admin/mobile cache layer touched. The function replacement is server-side only.

---

## 9. Regression Surface (operator post-deploy spot-check)

1. **Sample mode** — completely separate code path; unaffected by trigger function change. Quick Cary 50 sample as regression check optional.
2. **Pre-existing legacy runs without parent_run_id** — also unaffected; trigger function only kicks runs that DO exist in `place_intelligence_runs` (the new parent table).
3. **Service-role key vault** — unchanged; function still skips silently if vault key missing.
4. **Cron schedule** — atomic CREATE OR REPLACE preserves the cron job (jobid=15); next tick uses new function body.
5. **In-flight cancellation** — operator's stuck cancel from pre-v3 still requires the manual force-cleanup SQL the orchestrator provided. Post-v3 cancel flow self-heals.

---

## 10. Constitutional Compliance

- ✅ #2 One owner per truth — function ownership unchanged
- ✅ #3 No silent failures — RAISE NOTICE preserved when vault key missing
- ✅ #8 Subtract before adding — new migration supersedes old function via atomic CREATE OR REPLACE; old WHERE clause replaced not layered
- ✅ #13 Exclusion consistency — filter now consistent with worker's cancel-observe expectation

No violations.

---

## 11. Discoveries for Orchestrator

### D-1 (light, future hardening): trigger function body now lives in 2 migrations

The full function body is defined in `20260506000001_*.sql` (v1 with `status = 'running'`) and superseded in `20260506000002_*.sql` (v3 with `status IN ('running', 'cancelling')`). For a fresh DB rebuild, both apply in order, ending at v3 — correct. But future readers tracing "where is this function defined?" might miss the v3 supersession and reason from stale v1.

**Mitigation:** the v3 migration's COMMENT ON FUNCTION clearly states "v3 patch 2026-05-06: filter widened" and the file's header explains the supersession. Future investigations should follow the migration-chain rule (read latest definition; the latest CREATE OR REPLACE is authoritative).

**Recommendation:** when ORCH-0737 fully closes, consider a follow-up "consolidation" migration that re-defines the function body cleanly in one place with a clean header citing all the patches that landed (v2, v3). This is purely cosmetic — function behavior is identical. Defer to ORCH-0737-followup-2.

### D-2 (none other): scope held tight; no other discoveries

---

## 12. Operator Post-Deploy Sequence

1. **MANDATORY first** — operator runs force-cleanup SQL in Supabase SQL Editor to unstick the current cancelled-but-frozen Cary run (orchestrator already provided this SQL):
   ```sql
   UPDATE place_intelligence_runs
   SET status = 'cancelled', completed_at = now(),
       error_reason = 'force-cancelled — pre-v3-patch cron-filter-excluded-cancelling bug'
   WHERE status = 'cancelling';
   UPDATE place_intelligence_trial_runs
   SET status = 'cancelled', completed_at = now(),
       error_message = 'force-cancelled with parent — pre-v3-patch'
   WHERE parent_run_id IN (SELECT id FROM place_intelligence_runs WHERE status = 'cancelled')
     AND status IN ('pending', 'running');
   ```
2. `supabase db push` — applies v3 migration; trigger function gets new WHERE filter
3. Verify: `SELECT pg_get_functiondef('public.tg_kick_pending_trial_runs'::regproc);` → confirm shows `status IN ('running', 'cancelling')`
4. `supabase functions deploy run-place-intelligence-trial` — now succeeds (config.toml fixed in parallel chat)
5. Hard-refresh admin → restart Cary full-city smoke
6. Smoke A — observe ~6 rows/min steady throughput (v2-patch effect)
7. Smoke B — within first 5 min, click Cancel → parent flips `cancelling` → within 60-90s auto-flips to `cancelled` (v3-patch effect; first proper end-to-end Cancel test)
8. Wait Cary 761 to complete (~2 hours) for full smoke

---

## 13. Sign-Off

**Status:** implemented, unverified
**Verification method available:** static-trace + grep
**Verification method NOT available:** runtime apply + cancel test (operator-side)

**Code is complete + ready for operator deploy.** Single new migration. No edge function changes. No config.toml changes. v2-patch fixes (chunk=6, cancel-cleanup pending+running) all PRESERVED.

**Confirms scope discipline:** dispatch said "DO NOT TOUCH config.toml" — verified via git diff. Dispatch said "DO NOT touch index.ts" — verified by absence of changes there. Dispatch said write only the migration — done.
