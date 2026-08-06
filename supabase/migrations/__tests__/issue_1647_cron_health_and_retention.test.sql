-- Issue #1647 — contract for the cron-failure watchdog and the retention jobs.
--
-- NON-VACUITY: CI runs this against a database with every migration applied
-- EXCEPT 20270222001648. Section 1 raises immediately because
-- issue_1647_cron_job_health() does not exist.
--
-- The point of this file is that the WATCHDOG ITSELF must not be able to fail
-- silently. It is asserted by seeding a job whose recent runs all failed and
-- reading back what the probe will read, not by grepping the definition.

\set ON_ERROR_STOP on

-- ── 1. THE PIECES EXIST AND ARE service_role-ONLY ───────────────────────────
DO $$
DECLARE
  v_fn text;
  v_fns text[] := ARRAY[
    'public.issue_1647_cron_job_health(integer)',
    'public.issue_1647_purge_cron_run_details(integer,integer)',
    'public.issue_1647_purge_api_health_checks(integer,integer)',
    'public.issue_1647_purge_photo_backfill_batches(integer,integer,integer)'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '% does not exist', v_fn;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(v_fn)) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER (it reads the cron schema)', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by anon/authenticated', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute % — the hourly probe would be blind', v_fn;
    END IF;
  END LOOP;
END $$;

-- ── 2. THE TILE AND ITS ALERT STATE ─────────────────────────────────────────
-- The probe's state machine does `if (!prev) continue`, so a tile with no
-- api_health_alert_state row can go red forever and never email anyone. That is
-- the same silence #1647 is about, so it is asserted explicitly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.api_health_services WHERE service_key='pg_cron') THEN
    RAISE EXCEPTION
      'no pg_cron row in api_health_services — api_health_checks.service_key is FK-constrained, '
      'so the probe''s entire batch insert would fail, taking every other tile with it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_health_alert_state WHERE service_key='pg_cron') THEN
    RAISE EXCEPTION
      'no pg_cron row in api_health_alert_state — the tile could sit red forever without ever '
      'sending an alert email';
  END IF;
  -- The tile must reuse an EXISTING category, or the admin API-Health page has
  -- to change to render it.
  IF (SELECT category FROM public.api_health_services WHERE service_key='pg_cron')
     NOT IN (SELECT DISTINCT category FROM public.api_health_services WHERE service_key <> 'pg_cron') THEN
    RAISE EXCEPTION 'the pg_cron tile uses a category no other service uses';
  END IF;
END $$;

-- ── 3. THE RETENTION JOBS ARE SCHEDULED AND ACTIVE ──────────────────────────
DO $$
DECLARE v_missing text[];
BEGIN
  SELECT array_agg(n ORDER BY n) INTO v_missing
  FROM unnest(ARRAY[
    'issue_1647_cron_log_retention',
    'issue_1647_api_health_retention',
    'issue_1647_photo_backfill_batch_retention',
    'issue_1647_net_response_compact'
  ]) AS n
  WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = n AND j.active);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'retention job(s) missing or inactive: %', v_missing;
  END IF;
END $$;

-- ── 4. THE WATCHDOG REPORTS A 100%-FAILING JOB, WITH ITS REAL LAST SUCCESS ──
DO $$
DECLARE
  v_jobid bigint;
  v_row   record;
BEGIN
  -- 1 January midnight: the job stays ACTIVE (so the watchdog reports it) but
  -- pg_cron will not actually fire it during the test and pollute the counts.
  v_jobid := cron.schedule('issue_1647_selftest_job', '0 0 1 1 *', 'SELECT 1');

  DELETE FROM cron.job_run_details WHERE jobid = v_jobid;
  -- runid is supplied explicitly: it defaults to nextval('cron.runid_seq'), and
  -- `postgres` has INSERT on cron.job_run_details but NOT USAGE on that sequence
  -- (it belongs to supabase_admin). Worth knowing generally — the platform lets
  -- us read and prune this table but not forge rows through the default path.
  INSERT INTO cron.job_run_details (runid, jobid, database, username, command, status, return_message, start_time, end_time)
  VALUES
    -- the last success, deliberately OUTSIDE the 6-hour window: the 66-day-stale
    -- case is exactly the one a windowed max() would report as NULL.
    (916470001, v_jobid, current_database(), current_user, 'SELECT 1', 'succeeded', NULL,
     now() - interval '40 days', now() - interval '40 days' + interval '1 s'),
    (916470002, v_jobid, current_database(), current_user, 'SELECT 1', 'failed',
     'ERROR: canceling statement due to statement timeout', now() - interval '30 min', now() - interval '28 min'),
    (916470003, v_jobid, current_database(), current_user, 'SELECT 1', 'failed',
     'ERROR: canceling statement due to statement timeout', now() - interval '20 min', now() - interval '18 min'),
    (916470004, v_jobid, current_database(), current_user, 'SELECT 1', 'failed',
     'ERROR: canceling statement due to statement timeout', now() - interval '10 min', now() - interval '8 min');

  SELECT * INTO v_row FROM public.issue_1647_cron_job_health(6) WHERE jobid = v_jobid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the watchdog did not report an active job at all';
  END IF;
  IF v_row.failures <> 3 OR v_row.successes <> 0 THEN
    RAISE EXCEPTION 'expected 3 failures / 0 successes in the window, got % / %',
      v_row.failures, v_row.successes;
  END IF;
  IF v_row.consecutive_failures <> 3 THEN
    RAISE EXCEPTION 'expected a trailing streak of 3, got %', v_row.consecutive_failures;
  END IF;
  IF v_row.last_success_at IS NULL THEN
    RAISE EXCEPTION
      'last_success_at came back NULL for a job that DID succeed 40 days ago — the "66 days '
      'stale" case must be reportable, not invisible';
  END IF;
  IF v_row.hours_since_success < 900 THEN
    RAISE EXCEPTION 'hours_since_success should be ~960 for a 40-day-old success, got %',
      v_row.hours_since_success;
  END IF;
  IF v_row.last_error IS NULL OR v_row.last_error NOT LIKE '%statement timeout%' THEN
    RAISE EXCEPTION 'the failure reason must reach the operator, got %', v_row.last_error;
  END IF;

  -- A healthy job must NOT be reported as failing.
  UPDATE cron.job_run_details SET status='succeeded', return_message=NULL WHERE jobid=v_jobid;
  SELECT * INTO v_row FROM public.issue_1647_cron_job_health(6) WHERE jobid = v_jobid;
  IF v_row.consecutive_failures <> 0 OR v_row.failures <> 0 THEN
    RAISE EXCEPTION 'a fully-succeeding job was reported as failing (streak=%, failures=%)',
      v_row.consecutive_failures, v_row.failures;
  END IF;

  DELETE FROM cron.job_run_details WHERE jobid = v_jobid;
  PERFORM cron.unschedule('issue_1647_selftest_job');
END $$;

-- ── 5. THE PURGE IS BOUNDED ─────────────────────────────────────────────────
-- An unbounded purge is how the retention job would itself become the next
-- silent 100%-failure job: pg_cron inherits the same 2-minute statement timeout
-- that killed job 13, so a delete big enough to matter must be batched.
DO $$
DECLARE
  v_jobid       bigint;
  v_deleted     bigint;
  v_left        bigint;
  v_guard_fired boolean := false;
BEGIN
  -- The real retention job runs every 20 minutes and would delete the same
  -- 90-day-old fixtures mid-test. Park it for the duration; the container is
  -- disposable, and section 3 has already asserted it is scheduled and active.
  PERFORM cron.alter_job(
    (SELECT j.jobid FROM cron.job j WHERE j.jobname = 'issue_1647_cron_log_retention'),
    active := false);

  v_jobid := cron.schedule('issue_1647_selftest_purge', '0 0 1 1 *', 'SELECT 1');
  DELETE FROM cron.job_run_details WHERE jobid = v_jobid;

  INSERT INTO cron.job_run_details (runid, jobid, database, username, command, status, start_time, end_time)
  SELECT 916471000 + g, v_jobid, current_database(), current_user, 'SELECT 1', 'succeeded',
         now() - interval '90 days', now() - interval '90 days'
  FROM generate_series(1, 10) AS g;
  -- one recent row that must SURVIVE
  INSERT INTO cron.job_run_details (runid, jobid, database, username, command, status, start_time, end_time)
  VALUES (916471999, v_jobid, current_database(), current_user, 'SELECT 1', 'succeeded', now(), now());

  v_deleted := public.issue_1647_purge_cron_run_details(14, 4);
  IF v_deleted <> 4 THEN
    RAISE EXCEPTION 'the purge is NOT bounded by its batch limit: asked for 4, deleted %', v_deleted;
  END IF;

  SELECT count(*) INTO v_left FROM cron.job_run_details WHERE jobid = v_jobid;
  IF v_left <> 7 THEN
    RAISE EXCEPTION 'expected 7 rows left (10 old - 4 + 1 recent), got %', v_left;
  END IF;

  -- Drain, then prove the retention BOUNDARY: the recent row is never touched.
  PERFORM public.issue_1647_purge_cron_run_details(14, 1000);
  SELECT count(*) INTO v_left FROM cron.job_run_details WHERE jobid = v_jobid;
  IF v_left <> 1 THEN
    RAISE EXCEPTION 'expected only the in-window row to survive, got % rows', v_left;
  END IF;

  -- And it must refuse a retention window that would delete everything.
  BEGIN
    PERFORM public.issue_1647_purge_cron_run_details(0, 10);
  EXCEPTION WHEN raise_exception THEN
    v_guard_fired := true;
  END;
  IF NOT v_guard_fired THEN
    RAISE EXCEPTION 'the purge accepted retain_days=0 — a retention guard that does not guard';
  END IF;

  DELETE FROM cron.job_run_details WHERE jobid = v_jobid;
  PERFORM cron.unschedule('issue_1647_selftest_purge');
  PERFORM cron.alter_job(
    (SELECT j.jobid FROM cron.job j WHERE j.jobname = 'issue_1647_cron_log_retention'),
    active := true);
END $$;

SELECT 'issue #1647 cron watchdog + retention contract: PASS' AS result;
