# Implementation Report: ORCH-0481 Rework Cycle 2 — Cron Refresh Fix

**Status:** implemented, unverified (self-verified preconditions; runtime verification depends on user `supabase db push`)
**Date:** 2026-04-17
**Files changed:** 1 new migration file, 0 code changes
**Rework prompt:** `Mingla_Artifacts/prompts/IMPL_ORCH-0481_REWORK_V3.md`
**Cycle 1 retest report:** `Mingla_Artifacts/reports/QA_ORCH-0481_ADMIN_MV_LAYER_REPORT_RETEST_1.md`

---

## Layman Summary

- **One ~40-line SQL migration (with comments).** Creates a plpgsql function that wraps `REFRESH MATERIALIZED VIEW CONCURRENTLY` + `ANALYZE` with its own 15-min statement_timeout. Re-schedules pg_cron to call the function instead of running the raw REFRESH. Also includes a one-shot call at migration end that validates the function + brings the currently-stale MV up to date.
- **Addresses cycle 1's P0-1** (cron failing 6/6 runs at 2-min timeout — now 8/8 as of this writing) **and P1-2** (category_breakdown regression fixable via fresh ANALYZE).
- **Zero risk to cycle 1's wins.** MV definition, 5 MV indexes, 20 rewritten admin RPCs, and the user-triggered `admin_refresh_place_pool_mv()` RPC are all untouched. If the new function fails at migration time, the migration rolls back and the DB is no worse than it is now.

---

## Files Changed

### `supabase/migrations/20260418000003_orch0481_cron_fix.sql` (NEW)

**What it did before:** N/A — new file.

**What it does now:** Four steps in a single migration:
1. `CREATE OR REPLACE FUNCTION public.cron_refresh_admin_place_pool_mv()` — plpgsql function with `SET statement_timeout TO '15min'` attribute, body is `REFRESH MATERIALIZED VIEW CONCURRENTLY + ANALYZE`.
2. `DO $$ PERFORM cron.unschedule(...); EXCEPTION WHEN OTHERS THEN NULL; END $$;` — idempotent removal of the broken cron schedule.
3. `SELECT cron.schedule(...)` — re-schedules cron with `'*/10 * * * *'` frequency, calling `SELECT public.cron_refresh_admin_place_pool_mv()`.
4. `SELECT public.cron_refresh_admin_place_pool_mv();` — one-shot execution that (a) validates the function body at deploy time and (b) refreshes the currently-stale MV so admin stats match reality immediately.

**Why:** P0-1 fix per cycle 1 retest report. Secondary: P1-2 regression fix via ANALYZE.

**Lines:** 128 total (~60 SQL lines + ~68 comment lines documenting rationale, verification, rollback).

---

## Spec Traceability

| SC (from rework prompt) | Target | How implemented | Status |
|-------------------------|--------|-----------------|--------|
| SC-1 | `cron_refresh_admin_place_pool_mv()` function exists + correct body | `CREATE OR REPLACE FUNCTION` with `LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '15min'` attributes; body is `REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv; ANALYZE public.admin_place_pool_mv;` | **PASS by inspection** (function body is in the migration; will be verified by `pg_get_functiondef` post-deploy) |
| SC-2 | Cron re-scheduled to call the function | `cron.schedule('refresh_admin_place_pool_mv', '*/10 * * * *', 'SELECT public.cron_refresh_admin_place_pool_mv()')` | **PASS by inspection** |
| SC-3 | One-shot execution at migration end succeeds | `SELECT public.cron_refresh_admin_place_pool_mv();` as the last statement in the migration. If it times out or errors, the whole migration rolls back. | **UNVERIFIED** — will be proven by user's `supabase db push` either succeeding or rolling back |
| SC-4 | After 11-min wait: next cron tick succeeds | Depends on the live DB + cron scheduler | **UNVERIFIED** — tester responsibility |
| SC-5 | MV row count updates when new place_pool row appears | Depends on SC-4 succeeding; cron runs every 10 min | **UNVERIFIED** — tester end-to-end test |
| SC-6 | category_breakdown stabilizes | ANALYZE runs after each REFRESH → keeps planner stats fresh. Not a hard guarantee (plan choice under load is probabilistic), but the most common cause of the regression is addressed. | **UNVERIFIED** — tester should re-time |
| SC-7 | SCs 1-20 from cycle 1 retest still pass | This migration does not touch any function body or index or MV definition | **PASS by construction** |
| SC-8 | `admin_refresh_place_pool_mv()` (user-triggered) still works | Function body not modified | **PASS by construction** |

---

## Key Decisions

### 1. `SET statement_timeout TO '15min'` on the function, not `SET LOCAL` inside the body

The rework prompt noted `SET LOCAL` requires an explicit transaction block and may not survive cron's statement framing. The function-attribute `SET` (second-level, applied by postgres when the function is called) persists for the function's execution context regardless of transaction state. This is the more reliable pattern.

### 2. `SECURITY DEFINER` + no auth check

The cron role runs as postgres (or the postgres role's delegate) with no `auth.email()`. The auth check in the user-facing `admin_refresh_place_pool_mv()` would always fail for cron. Splitting into two functions (cron-facing with no auth check, user-facing with auth check) is the conventional Supabase pattern and matches the principle of least surprise.

### 3. `ANALYZE` after REFRESH, not before

ANALYZE only makes sense on data that exists. Running before REFRESH would analyze the pre-refresh MV (useless for the just-refreshed state). Running after means admin RPCs in the next 10 minutes see fresh stats.

### 4. One-shot call at migration end

Two benefits:
- Immediate validation: if the function is broken, `supabase db push` fails and rolls back the migration. No silent deploy.
- Catch-up refresh: the MV has been stale since 2026-04-17 18:45 UTC (first failed cron was at 23:10). The one-shot brings it back to current before the next cron tick.

### 5. Idempotent unschedule with exception handling

`DO $$ PERFORM cron.unschedule(...); EXCEPTION WHEN OTHERS THEN NULL; END $$;` — if someone re-runs the migration (or the cron job was already deleted by a rollback script), this doesn't error. Safe for re-run.

### 6. Did NOT modify `admin_refresh_place_pool_mv()`

The user-triggered on-demand refresh function (created in cycle 0) has its own auth check + its own REFRESH call. It's used when admin clicks "Refresh now" in some future UI. Leaving it alone keeps the separation of concerns clean. If users want a bigger timeout on the admin-triggered refresh too, that's a separate dispatch — not in cycle 2 scope.

---

## Preconditions Self-Verified

Queried via MCP before writing migration:

| Precondition | Expected | Observed |
|--------------|----------|----------|
| `admin_place_pool_mv` exists | yes | **yes** |
| Current cron command is raw REFRESH (the broken version) | yes | **`REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv`** |
| Cron job `refresh_admin_place_pool_mv` is active | yes | **active=true** |
| `pg_cron` extension installed | yes | **yes** |
| `cron` schema accessible | yes | **yes** |
| Failed cron runs so far | ≥6 (from cycle 1 tester) | **8** (2 more ticks failed since tester's measurement) |
| Pre-migration MV row count | matches place_pool | **63,273** (matches `place_pool.COUNT(*)` exactly) |

Preconditions are exactly what the rework prompt assumed. Migration is safe to apply.

---

## Invariant Preservation Check

| Invariant | Preserved? | Notes |
|-----------|-----------|-------|
| Constitutional #3 (no silent failures) | **YES — RESTORED** | The broken cron's silent failure mode is replaced by a function that either succeeds (surfaces via `cron.job_run_details.status='succeeded'`) or fails with a clear error (surfaces via status='failed' + return_message). The 15-min timeout is an order of magnitude higher than expected runtime so failures should now be real problems, not plumbing artifacts. |
| Function signature stability | YES | `admin_refresh_place_pool_mv()` (user-triggered) not touched. The new `cron_refresh_admin_place_pool_mv()` is additive. No existing signatures changed. |
| RLS policies | YES | No RLS changes. |
| `admin_place_pool_mv` structure + indexes | YES | Not touched. |
| 20 rewritten admin_* RPCs | YES | Not touched. |
| Cron schedule frequency | YES | Still `'*/10 * * * *'` — same 10-minute staleness window the spec promised. |

---

## Parity Check

**Not applicable.** Backend-only SQL migration. No mobile code, no solo/collab distinction.

---

## Cache Safety Check

**Not applicable.** Admin dashboard reads are stateless PostgREST calls each page load — no client-side cache to invalidate. The MV itself is the cache and this migration makes it actually refresh.

---

## Regression Surface (what the tester should check)

1. **Cron succeeds on the next scheduled tick** (SC-4). Primary verification.
2. **Migration applied cleanly** — the one-shot call at migration end either succeeds (proving the function works) or rolls back the migration (surfacing the problem immediately).
3. **`admin_place_pool_mv` row count ≥ `place_pool` row count** post-deploy (the one-shot REFRESH picks up any writes that happened while cron was silently failing).
4. **Other admin_* RPCs from cycles 0/1 behave identically** — no body changes in this migration.
5. **Freshness end-to-end** — insert a test place_pool row, wait 11 min, verify in MV (SC-5).
6. **`admin_place_category_breakdown` stabilizes** — ANALYZE after refresh should restore good plan choice (SC-6).

---

## Constitutional Compliance

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | N/A (backend) |
| 2 | One owner per truth | PASS — cron refresh is the single writer to the MV; on-demand `admin_refresh_place_pool_mv()` is the only other writer (user-initiated) |
| 3 | No silent failures | **PASS — RESTORED** from cycle 1 FAIL. Cron failures are surfaced via `cron.job_run_details` with a >15-min timeout budget. |
| 4 | One query key per entity | N/A |
| 5 | Server state server-side | PASS |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary fixes | N/A — no `[TRANSITIONAL]` markers |
| 8 | Subtract before adding | PASS — `DO $$ PERFORM cron.unschedule(...); END $$;` removes the broken schedule before adding the new one |
| 9 | No fabricated data | PASS |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | PASS — cron runs as postgres role; user-triggered refresh has admin_users check |
| 12 | Validate at right time | PASS — one-shot call at migration end validates function body at deploy time, not runtime-only |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | N/A |

---

## Transition Items

**None.** No `[TRANSITIONAL]` markers. This is the permanent fix.

---

## Discoveries for Orchestrator

**D-NEW-9 (cycle 2):** Since cycle 1 tester measured 6 failures, 2 more cron ticks have failed (current count: 8/8 since migration apply). This is consistent with the 10-minute cadence and confirms the cron scheduler is firing reliably — the problem is purely the statement_timeout on the REFRESH step. Once cycle 2 deploys, the next tick after deploy is the real-world verification.

**D-NEW-10 (observation, not a bug):** The pre-migration MV row count (63,273) matches place_pool's row count exactly. No writes to place_pool have happened since the MV's initial one-shot populate at migration apply. So even though cron has been broken for hours, the MV is accidentally still fresh for this specific snapshot. This is luck, not design — any incremental place_pool activity would have surfaced the staleness faster.

**D-NEW-11 (methodology suggestion for ORCH-0483 perf gate):** The failure mode in cycle 1 was NOT observable via function-body inspection, query timing, or MV row count — only via `cron.job_run_details.status`. Orchestrator should add to ORCH-0483 (admin RPC perf gate) the rule: "Any migration that creates a pg_cron job must include a post-deploy verification step that confirms `status='succeeded'` for at least one scheduled tick, not just `active=true`."

**D-3, D-4, D-7 (carried from prior cycles):** Unchanged. Orchestrator's decisions stand (Option X on D-3 sentinel; D-4 irrelevant post-cycle-2; D-7 uncategorized handling already implemented correctly).

---

## Deploy Sequence (user action)

1. Review the migration: `supabase/migrations/20260418000003_orch0481_cron_fix.sql`.
2. `supabase db push --dry-run` — expect exactly 1 pending migration.
3. `supabase db push` — apply. If it succeeds, the one-shot call worked (proof-of-life for the function).
4. Immediately after deploy: confirm the cron schedule updated:
   ```sql
   SELECT command FROM cron.job WHERE jobname='refresh_admin_place_pool_mv';
   ```
   Expect: `SELECT public.cron_refresh_admin_place_pool_mv()`.
5. Wait ~10-11 minutes for the next cron tick.
6. Confirm `cron.job_run_details` shows a successful run:
   ```sql
   SELECT start_time, status FROM cron.job_run_details
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='refresh_admin_place_pool_mv')
   ORDER BY start_time DESC LIMIT 1;
   ```
   Expect: most recent row has `status='succeeded'`.
7. Dispatch tester cycle 2 retest. On PASS → Post-PASS protocol → apply to production.

---

## Rollback

If needed: copy the ROLLBACK block at the bottom of the migration file into a new migration. Drops the new function + cron job, restores the broken-but-not-harmful cycle-0 cron schedule. The MV itself, its indexes, and all 20 rewritten RPCs are unchanged by this migration so rollback is clean.

---

## Summary

Migration `20260418000003_orch0481_cron_fix.sql` contains:

- 1 new plpgsql function (`cron_refresh_admin_place_pool_mv()`)
- Idempotent unschedule of the broken cron job
- New cron schedule calling the function
- One-shot execution at migration end for immediate validation + stale-MV catch-up

0 schema changes, 0 new indexes, 0 MV changes, 0 RPC changes, 0 RLS changes.

**Implemented, unverified.** Awaiting user to run `supabase db push` (proves function body + refreshes stale MV) and wait 11 min for next cron tick (proves cron succeeds). Ready for orchestrator REVIEW.
