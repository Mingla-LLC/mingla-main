-- ============================================================================
-- ORCH-0481 Rework Cycle 2: Fix pg_cron refresh for admin_place_pool_mv
-- ============================================================================
-- Supersedes parts of: 20260418000001_orch0481_admin_mv_layer.sql
--   - The cron.schedule() call at Wave 2 that ran raw REFRESH MV CONCURRENTLY
--
-- Tester cycle 1 retest report: Mingla_Artifacts/reports/QA_ORCH-0481_ADMIN_MV_LAYER_REPORT_RETEST_1.md
-- Rework prompt: Mingla_Artifacts/prompts/IMPL_ORCH-0481_REWORK_V3.md
--
-- PROBLEM:
--   The cycle 0 migration scheduled pg_cron with raw SQL:
--     SELECT cron.schedule('refresh_admin_place_pool_mv', '*/10 * * * *',
--       $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv$$);
--   This passes the raw REFRESH statement to cron, which runs with the default
--   statement_timeout (2 min). On Mingla-dev, REFRESH CONCURRENTLY on a 63k-row
--   27-col MV consistently exceeds 2 min → every cron tick fails with
--   "canceling statement due to statement timeout". Verified: 6/6 runs failed.
--   Constitutional #3 violation (silent failure; MV frozen since migration apply).
--
-- FIX:
--   Create a plpgsql function that sets its own 15-min statement_timeout, runs
--   REFRESH CONCURRENTLY, then runs ANALYZE (keeps planner stats fresh — also
--   addresses the P1-2 regression on admin_place_category_breakdown). Re-schedule
--   cron to call this function instead of the raw SQL.
--
-- SEMANTIC NOTES:
--   - SET statement_timeout TO '15min' in the function attributes persists for
--     the function's execution context regardless of transaction state. (SET LOCAL
--     would require an explicit transaction block and might not survive cron's
--     statement framing.)
--   - SECURITY DEFINER lets the function REFRESH + ANALYZE without the admin_users
--     auth check. No auth check needed: cron runs as the postgres role with no
--     auth.email() — a user-facing RAISE EXCEPTION check would always fail for
--     cron. User-triggered refreshes still go through admin_refresh_place_pool_mv()
--     (cycle 0) which DOES have the admin auth check.
--   - ANALYZE is cheap (~seconds on the MV) and critical for planner stats. Without
--     it, running queries against an un-analyzed MV picks bad plans (see P1-2).
--
-- SCOPE DISCIPLINE:
--   - MV definition, 5 MV indexes, 20 rewritten admin RPCs: UNTOUCHED
--   - admin_refresh_place_pool_mv() (user-triggered on-demand refresh): UNTOUCHED
--   - The only ORCH-0481 artifact changed is the cron schedule
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Create the cron refresh function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_refresh_admin_place_pool_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '15min'
SET lock_timeout TO '15min'
AS $function$
BEGIN
  -- Refresh the MV concurrently (reads not blocked during refresh)
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv;

  -- Update planner statistics so aggregate RPCs pick good plans.
  -- Without this, admin_place_category_breakdown and similar drift to slow plans
  -- over time as underlying place_pool churn makes the planner's cached stats stale.
  ANALYZE public.admin_place_pool_mv;
END;
$function$;

COMMENT ON FUNCTION public.cron_refresh_admin_place_pool_mv() IS
  'ORCH-0481 cycle 2 fix. Runs via pg_cron every 10 minutes. SET statement_timeout TO 15min '
  'overrides the default 2-min cron timeout that made the raw REFRESH call fail every run. '
  'ANALYZE step keeps planner stats fresh (prevents admin_place_category_breakdown regression). '
  'SECURITY DEFINER + no auth check because cron runs as postgres role with no auth.email(). '
  'User-triggered refreshes go through admin_refresh_place_pool_mv() which has the admin check.';


-- ----------------------------------------------------------------------------
-- 2. Unschedule the broken cron job (safe if it exists or not)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('refresh_admin_place_pool_mv');
EXCEPTION WHEN OTHERS THEN NULL;  -- silent if not scheduled
END $$;


-- ----------------------------------------------------------------------------
-- 3. Re-schedule cron to call the new function
-- ----------------------------------------------------------------------------
SELECT cron.schedule(
  'refresh_admin_place_pool_mv',
  '*/10 * * * *',
  $$SELECT public.cron_refresh_admin_place_pool_mv()$$
);


-- ----------------------------------------------------------------------------
-- 4. NOTE: no one-shot validation call here
-- ----------------------------------------------------------------------------
-- Original design had a one-shot `SELECT public.cron_refresh_admin_place_pool_mv();`
-- at migration end to validate the function + catch up the stale MV immediately.
-- Removed because Supabase's migration runner has a session-level lock_timeout
-- that's tighter than the function's 15-min setting. If cron happens to have an
-- active REFRESH attempt when this migration runs, the one-shot call blocks on
-- the lock + gets killed by the migration's lock_timeout before the function's
-- own SET lock_timeout can help.
--
-- Consequence: we lose immediate validation at deploy time. Validation now
-- happens at the next cron tick (within 10 minutes). If the function is broken,
-- cron.job_run_details.status will show 'failed' with a return_message for the
-- next run, same visibility as any other cron failure.
--
-- Trade-off accepted by orchestrator (DEC-022): simpler deploy > faster validation.


-- ============================================================================
-- Verification (run manually AFTER `supabase db push`)
-- ============================================================================
-- 1. Function body is correct:
--    SELECT pg_get_functiondef(p.oid)
--    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'cron_refresh_admin_place_pool_mv';
--    Expect: SET statement_timeout TO '15min', REFRESH MV CONCURRENTLY, ANALYZE.
--
-- 2. Cron schedule updated to call the function (not raw SQL):
--    SELECT jobname, schedule, command, active
--    FROM cron.job WHERE jobname = 'refresh_admin_place_pool_mv';
--    Expect: command = 'SELECT public.cron_refresh_admin_place_pool_mv()', active=t.
--
-- 3. After 10-11 min wait, confirm cron fires successfully:
--    SELECT start_time, end_time, status, return_message
--    FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='refresh_admin_place_pool_mv')
--    ORDER BY start_time DESC LIMIT 3;
--    Expect: most recent row has status='succeeded', return_message is empty/null.
--    (The 6 pre-deploy failures from cycle 0-1 will still be visible as historical rows.)
--
-- 4. Freshness end-to-end: insert a test row, wait 10 min, verify it appears.
--    (Recommend tester execute this test.)
--
-- 5. Regression check: admin_place_category_breakdown plan stability.
--    EXPLAIN (ANALYZE, BUFFERS)
--    SELECT mv.primary_category, COUNT(*), ...
--    FROM admin_place_pool_mv mv
--    WHERE mv.is_active AND mv.ai_approved = true AND mv.primary_category <> 'uncategorized'
--    GROUP BY mv.primary_category ORDER BY COUNT(*) DESC;
--    Expect: Bitmap Index Scan or Bitmap Heap Scan path (not degraded Index Scan).
--    Target: <500ms warm.
-- ============================================================================


-- ============================================================================
-- ROLLBACK (if needed, copy into a new migration)
-- ============================================================================
-- DO $$
-- BEGIN
--   PERFORM cron.unschedule('refresh_admin_place_pool_mv');
-- EXCEPTION WHEN OTHERS THEN NULL;
-- END $$;
-- DROP FUNCTION IF EXISTS public.cron_refresh_admin_place_pool_mv();
-- -- Then restore the broken-but-not-harmful cycle-0 cron schedule:
-- SELECT cron.schedule(
--   'refresh_admin_place_pool_mv',
--   '*/10 * * * *',
--   $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv$$
-- );
-- ============================================================================
