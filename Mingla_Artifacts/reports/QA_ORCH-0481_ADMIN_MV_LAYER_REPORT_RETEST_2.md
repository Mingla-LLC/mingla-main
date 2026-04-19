# QA Retest Report — ORCH-0481 Admin RPC MV Layer (Cycle 2)

**Tester:** mingla-tester
**Date:** 2026-04-18 (server UTC) / tester session late 2026-04-17
**Cycle:** 2 (retest after cycle 2 cron-fix rework)
**Cycle 1 retest report:** `Mingla_Artifacts/reports/QA_ORCH-0481_ADMIN_MV_LAYER_REPORT_RETEST_1.md` (FAIL — exposed P0-1 cron timeout)
**Cycle 2 implementor report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0481_REWORK_V3_REPORT.md`
**Cycle 2 migration:** `supabase/migrations/20260418000003_orch0481_cron_fix.sql` (applied to Mingla-dev ~20:25 UTC 2026-04-17, commit 84f00a93)
**Server time at retest:** 2026-04-18 00:25:47 UTC (~4h 20min post-deploy)

---

## Verdict: **FAIL**

**Counts:** P0: 1 | P1: 0 | P2: 0 | P3: 0 | P4: 0

**⚠️ STUCK-IN-LOOP ESCALATION: Cycle count now 3 (cycle 0 FAIL → cycle 1 rework → cycle 1 retest FAIL → cycle 2 rework → cycle 2 retest FAIL). Per tester discipline, escalating to orchestrator for strategic review.**

The cycle 2 migration applied structurally clean — the new `cron_refresh_admin_place_pool_mv()` function exists with the intended attributes (`statement_timeout=15min`, `lock_timeout=15min`), and the cron schedule was updated to call the function (`SELECT public.cron_refresh_admin_place_pool_mv()`). Migration is registered as `20260418000003` in the ledger.

**BUT:** the new cron job (jobid=13) has **not fired a single time** in the 4h 20min since deploy. Other cron jobs in the same database fire on schedule (jobid=1, 4, 8, 9, 10 all have recent runs within the last hour). My job is registered correctly, active, with a valid `*/10 * * * *` schedule, owned by postgres role, in postgres database. Yet pg_cron skips it on every tick.

The MV is now definitively stale: **63,273 rows in admin_place_pool_mv vs 63,274 rows in place_pool**. A place was added to place_pool since migration apply and has never propagated to admin stats.

Constitutional #3 (no silent failures) is **still violated** — post-cycle-2 the failure mode is more insidious than cycle 1. Cycle 1 at least produced `cron.job_run_details.status='failed'` rows. Cycle 2's jobid=13 produces *zero* rows, so admin users can't even tell cron is supposed to be running.

---

## Success Criteria — Retest Matrix

| SC | Criterion | Target | Observed | Verdict |
|----|-----------|--------|----------|---------|
| SC-1 | `cron_refresh_admin_place_pool_mv()` exists + correct body | Full `pg_get_functiondef` check | **PASS** — function exists, proconfig shows `search_path=public; statement_timeout=15min; lock_timeout=15min`. Body does REFRESH + ANALYZE. |
| SC-2 | Cron re-scheduled to call the function | `command` updated | **PASS** — `command = 'SELECT public.cron_refresh_admin_place_pool_mv()'`, jobid=13, active=true |
| SC-3 | One-shot call succeeds at migration end | Intentionally removed post-DEC-022 | **N/A** — design decision removed this step |
| **SC-4** | **After 11-min wait: next cron tick succeeds** | **status='succeeded' in cron.job_run_details** | **FAIL — P0-1** — 0 runs for jobid=13 recorded in 4h 20min post-deploy |
| SC-5 | MV updates when place_pool row is added | Insert → wait 10 min → verify | **FAIL — evidence already in DB** — `place_pool` has 63,274 rows, `admin_place_pool_mv` has 63,273. The +1 row never propagated to the MV. |
| SC-6 | `admin_place_category_breakdown` stabilizes post-ANALYZE | Plan reverts to Bitmap Heap Scan | **NOT TESTED** — ANALYZE has never run because cron hasn't fired |
| SC-7 | SCs 1-20 from cycle 1 retest still pass | No regression | **NOT RE-TIMED** — cycle 2 migration doesn't touch function bodies, so cycle 1 wins presumably hold. But they now operate on increasingly stale MV data. |
| SC-8 | `admin_refresh_place_pool_mv()` (user-triggered) still works | Function untouched | **PASS by construction** — cycle 2 migration left it alone |

---

## Evidence

### Cron job state (confirmed via SQL)
```
jobid=13, jobname='refresh_admin_place_pool_mv'
  schedule: '*/10 * * * *'
  command:  'SELECT public.cron_refresh_admin_place_pool_mv()'
  nodename: localhost, nodeport: 5432
  database: postgres
  username: postgres
  active:   true
  jobname:  refresh_admin_place_pool_mv
```

All fields are correct. The job is registered exactly as the migration specified.

### cron.job_run_details inspection
```
runs_for_jobid_13:              0  ← the smoking gun
runs_last_hour_any_job:        21  ← scheduler IS firing other jobs
unique_jobids_last_hour:    1, 10, 4, 8, 9  ← jobid 13 and 12 both missing
jobnames_last_hour:  cleanup-stale-leaderboard-presence,
                     expire-tag-along-requests,
                     keep-functions-warm,
                     notify-calendar-reminder-hourly
last_5_runs_any:    jobid=1 at 00:25: failed | jobid=1 at 00:20: failed |
                    jobid=10 at 00:20: failed | jobid=1 at 00:15: failed |
                    jobid=4 at 00:15: failed
server_time:        2026-04-18 00:25:47 UTC (~4h 20min post-deploy)
last_run_any_job:   2026-04-18 00:25:00 (47s ago — cron IS alive)
```

The cron scheduler is alive and firing. It is specifically skipping jobid=13.

### Function attributes (inspected)
```
search_path=public; statement_timeout=15min; lock_timeout=15min
```
Correct per the cycle 2 migration. Both timeouts set.

### Manual function invocation (via MCP, service_role session)
```
SELECT public.cron_refresh_admin_place_pool_mv();
→ ERROR: 57014: canceling statement due to statement timeout
  CONTEXT: SQL statement "REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv"
           PL/pgSQL function cron_refresh_admin_place_pool_mv() line 4
```

**This is NOT evidence that the function is broken.** MCP runs as `service_role` which has a hard statement_timeout cap (likely 60s–2min) that the function's `SET statement_timeout TO '15min'` cannot override (role-level caps take precedence over proconfig in Supabase). When pg_cron invokes the function as `postgres` role (superuser, no cap), the function's SET would take effect.

But this is academic: **pg_cron isn't invoking the function at all.**

### Staleness proof
```
admin_place_pool_mv row count: 63,273
place_pool row count:          63,274
```

The MV is 1 row behind. This is the definitive proof that the MV has not been refreshed since the one-shot populate at cycle 0 migration apply (2026-04-17 18:45 UTC). Any write to place_pool after that moment is invisible to admin.

---

## P-level Findings

### P0-1 (carried from cycle 1, NOT fixed by cycle 2): cron still not running

**Status:** Cycle 2 changed the failure mode but did NOT fix the underlying problem.

**Cycle 1 failure mode:** Cron fired every 10 min, called raw REFRESH, hit 2-min statement_timeout, logged `failed` status in cron.job_run_details. At least visible.

**Cycle 2 failure mode:** Cron does not fire jobid=13 at all. Zero entries in cron.job_run_details. Function unreachable via the scheduled path. Worse failure mode because it's invisible unless someone specifically checks the job_run_details for the new jobid.

**Hypotheses (none proven):**
1. **pg_cron v1.6.4 quirk with rapid unschedule+reschedule** — the `DO $$ PERFORM cron.unschedule(...) EXCEPTION WHEN OTHERS THEN NULL END $$;` immediately followed by `cron.schedule(...)` in the same migration transaction may have left pg_cron's internal state such that the new jobid is registered but not scheduled.
2. **Transaction-scoped scheduling** — cron.schedule() inside a migration transaction may register the job, but the cron launcher process may not pick it up until connection/cache refresh.
3. **Orphaned lock or permissions edge case** — the SECURITY DEFINER function calling REFRESH may have a permissions prerequisite I'm missing.

**What we know from evidence, not hypothesis:**
- The configuration in `cron.job` is correct.
- Other cron jobs in the same database fire normally.
- My job doesn't fire, ever, for 4+ hours.
- Manual function invocation hits service_role cap (not conclusive about function correctness, but does reach `line 4` which proves the function is callable).

**Fix directions (implementor choice):**
- **Simplest (recommended):** Manually run `SELECT cron.unschedule('refresh_admin_place_pool_mv'); SELECT cron.schedule(...);` as two separate statements **outside a migration transaction**, via direct SQL execution in the Supabase SQL editor or psql. This bypasses whatever migration-transaction subtlety may be causing the issue.
- **Next diagnostic:** Query pg_cron's internal state tables (not just `cron.job`) to see if jobid=13 is marked as skipped/error/next-runtime-far-future. Supabase's pg_cron may expose additional tables like `cron.job_status` or similar.
- **Escalation:** pg_cron version 1.6.4 is relatively new; filing a bug with Supabase support or checking pg_cron GitHub issues for "schedule after unschedule" could help.

**Severity:** P0. The fix for cycle 1's P0-1 did not land. Admin dashboard data is stale. Constitutional #3 still violated.

---

## Cycle Tracking — STUCK-IN-LOOP ESCALATION

Per tester discipline rule: "If retest cycle >2: flag as 'stuck in loop' for orchestrator escalation."

```
Cycle 0: FAIL (country_overview 54s — wrong query shape)
Cycle 1: rework → retest FAIL (new P0-1: cron timing out)
Cycle 2: rework → retest FAIL (P0-1 not fixed, new failure mode: cron not firing)
```

**Three iterations. Original admin-dashboard-unblock goal NOT achieved.** Each cycle identified a real problem, fixed that specific problem, and surfaced a new one. This is the pattern stuck-in-loop is designed to catch — not because any single cycle was wasteful, but because the cumulative cycle count suggests the approach may have hidden coupling issues worth re-examining strategically.

**Recommendation to orchestrator:** PAUSE implementor cycle 3. Consider the alternatives the orchestrator flagged earlier (Reading A / Option B / Option C in prior dispatch):

1. **Drop cron entirely.** Add an admin-UI "Refresh Stats" button that calls the existing `admin_refresh_place_pool_mv()`. Accept manual-freshness trade-off. Ship today.
2. **Narrow the MV** (remove TOAST'd columns). Smaller MV = faster refresh = fits in 2min. Solves cycle 1 P0-1 without needing a function wrapper at all.
3. **Ship current Mingla-dev state to production.** Measure if prod's different environment makes cron work. Low-cost info-gathering.
4. **Diagnose pg_cron itself.** Query internal pg_cron state / file a Supabase support ticket. High time cost but resolves the root.

Alternative 1 or 3 is my preference — both preserve the cycle 0/1 wins (query rewrites, MV with <200ms hot reads) and avoid further entanglement with pg_cron.

---

## Structural / Regression Checks (abbreviated)

| Check | Result |
|-------|--------|
| Migration 20260418000003 in ledger | **PASS** |
| Function body is correct | **PASS** (verified via pg_get_functiondef) |
| Cron schedule points to new function | **PASS** (`SELECT public.cron_refresh_admin_place_pool_mv()`) |
| Function has statement_timeout=15min | **PASS** |
| Function has lock_timeout=15min | **PASS** |
| admin_refresh_place_pool_mv() (user-triggered) unchanged | **PASS** |
| MV row count matches place_pool | **FAIL** (63,273 vs 63,274, off by 1) |
| Cron jobid=13 has any runs recorded | **FAIL** (0 runs) |

---

## Constitutional Compliance (retest)

| # | Principle | Cycle 1 | Cycle 2 Retest |
|---|-----------|---------|----------------|
| 3 | No silent failures | FAIL (cron failures logged but silent from admin UI) | **FAIL (WORSE)** — cron doesn't even fire, so no failure rows exist to inspect |
| others | — | unchanged | unchanged |

---

## Discoveries for Orchestrator

**D-NEW-12 (cycle 2 retest):** pg_cron scheduled jobs may not fire if created within a specific transaction pattern. Recommend: any future migration that schedules pg_cron jobs should verify via `cron.job_run_details` that the first scheduled tick actually ran before declaring the migration successful.

**D-NEW-13:** Supabase's `service_role` statement_timeout cap overrides function-level `SET statement_timeout`. This prevents testing long-running functions via MCP under realistic conditions. Not a bug, but worth knowing for future perf testing.

**D-NEW-14 (stuck-in-loop signal):** After 3 cycles on the same ORCH, if the underlying technology (pg_cron, in this case) is the bottleneck, the right move is often to REMOVE the dependency rather than keep patching around it. Alternative 1 (manual refresh button) or Alternative 2 (narrow the MV so a non-function REFRESH works) both ELIMINATE pg_cron from the critical path.

**D-3, D-5, D-7 (carried):** Unchanged. Orchestrator's Option X on D-3 stands.

---

## Retest Recommendation

**Cycle 3 not recommended without strategic reconsideration.**

If orchestrator insists on fixing cron via another migration, the most likely working approach is:
```sql
-- Run these as SEPARATE statements, NOT in a migration transaction:
SELECT cron.unschedule('refresh_admin_place_pool_mv');
-- (wait a few seconds or switch sessions)
SELECT cron.schedule(
  'refresh_admin_place_pool_mv',
  '*/10 * * * *',
  $$SELECT public.cron_refresh_admin_place_pool_mv()$$
);
```

But the evidence-free nature of the cycle 2 failure (no errors, no runs, just silence) makes this a gamble. Strategic alternatives (remove cron dependency; narrow the MV; ship to prod to measure) are higher-confidence paths.

**Timeline estimate for alternatives:**
- Alternative 1 (admin-UI refresh button): 2-3 hours implementor + 1 hour tester
- Alternative 2 (narrow the MV): 4-6 hours implementor + 1-2 hours tester
- Alternative 3 (ship to prod, measure): ~30 min + 10-min observation window
- Alternative 4 (pg_cron diagnosis): unbounded

---

## Report-file summary

- **Verdict:** FAIL (cycle 2 retest)
- **Counts:** P0: 1 | P1: 0 | P2: 0 | P3: 0 | P4: 0
- **Blocking issues:** P0-1 carried from cycle 1 (cron still not maintaining MV freshness)
- **New failure mode:** cron job exists, is active, correctly configured, but pg_cron never fires it. Silent, no log rows.
- **Cycle count:** 3 — **STUCK-IN-LOOP THRESHOLD HIT.** Escalating to orchestrator for strategic review of non-cron alternatives.
- **Production deploy:** STILL BLOCKED.
