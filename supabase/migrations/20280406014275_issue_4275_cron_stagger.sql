-- ---------------------------------------------------------------------------
-- Issue #4275 — move the seven every-10-minute jobs off the shared minute.
--
-- pg_cron starts jobs by the minute (cron.max_running_jobs = 32,
-- use_background_workers = off, max_connections = 90). Read from cron.job:
--   any minute            13 starts
--   :x5 off the quarter   25
--   :x0                   32  (exactly the cap)
--   :20                   33
-- Seven `*/10` jobs caused the :x0 and :20 peaks. Each now has its own minute,
-- none on a :x0 or :x5 minute, so at most one of the seven starts per minute.
-- This does not change the :15 peak (37 starts, no `*/10` job among them).
--
-- refresh_admin_place_pool_mv is a production job no migration creates, so a
-- clean replay takes the "not found" notice for it; the SQL suite seeds it.
--
-- refresh_admin_place_pool_mv also drops from every 10 to every 30 minutes (it
-- runs 10 s on average, 99 s at worst). Every reader of that view is an admin
-- page; `admin_refresh_place_pool_mv` still forces a refresh from the page's own
-- button. To revert just this one job's cadence, run:
--   SELECT cron.alter_job(job_id := <jobid>, schedule := '3,13,23,33,43,53 * * * *');
--
-- Static on purpose (RLS gate C7 refuses dynamic SQL): no dynamic statements,
-- by job name, a notice when a job is missing, commands unchanged.
-- ---------------------------------------------------------------------------

BEGIN;

DO $issue_4275_stagger$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'kick_pending_thumb_backfill';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: kick_pending_thumb_backfill not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '1,11,21,31,41,51 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_1179_cancel_refund_fanout_backstop';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_1179_cancel_refund_fanout_backstop not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '2,12,22,32,42,52 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'refresh_admin_place_pool_mv';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: refresh_admin_place_pool_mv not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '3,33 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_3197_public_search_converged';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_3197_public_search_converged not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '4,14,24,34,44,54 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'crm_reconcile_live';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: crm_reconcile_live not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '6,16,26,36,46,56 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'ops_reconcile';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: ops_reconcile not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '7,17,27,37,47,57 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_4073_city_watch_scan';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_4073_city_watch_scan not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '8,18,28,38,48,58 * * * *');
  END IF;
END;
$issue_4275_stagger$;

COMMIT;
