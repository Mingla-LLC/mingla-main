-- Issue #1647 — make a failing scheduled job VISIBLE, and stop the logs that
-- record the failures from consuming the database.
--
-- THE REAL DEFECT
-- ---------------
-- `refresh_admin_place_pool_mv` failed every ten minutes for sixty-six days —
-- 4,320 of 4,320 runs in the last 30 days — and NOTHING told anyone. The timeout
-- was a bug; the silence was the defect. Nobody reads `cron.job_run_details`, so
-- a job can be 100% dead indefinitely and the only symptom is a screen quietly
-- showing old numbers.
--
-- WHAT THIS ADDS
-- --------------
-- 1. `issue_1647_cron_job_health()` — one row per active pg_cron job with its
--    recent success/failure counts, its trailing consecutive-failure streak, when
--    it last succeeded and the error text of its last failure.
-- 2. A `pg_cron` tile in the EXISTING api-health registry. The hourly
--    `api-health-probe` (cron job 30) reads the RPC, and the alert state machine
--    that already runs there does the rest for free: two consecutive failed ticks
--    send an ops email, a 6-hour cooldown re-alerts, and recovery sends a
--    stand-down. Had this existed on 2026-05-31, Seth would have had an email
--    within two hours instead of sixty-six days of nothing.
--    Both an `api_health_services` row AND an `api_health_alert_state` row are
--    seeded — the probe's state machine does `if (!prev) continue`, so a service
--    with no seeded state row is silently un-alertable. That is the same failure
--    shape this issue exists to close, so the verify block asserts BOTH rows.
-- 3. Bounded retention for the operational logs that had NO policy at all.
--
-- WHY THE PURGES ARE BATCHED
-- --------------------------
-- `cron.job_run_details` holds 475,386 rows / 491 MB, 373,648 of them older than
-- 14 days, and has NEVER been vacuumed (last_vacuum and last_autovacuum are both
-- NULL). A single unbounded `DELETE ... WHERE end_time < now() - 14 days` is
-- exactly the wrong shape: pg_cron jobs inherit the same 2-minute
-- `statement_timeout` that broke job 13, so a purge big enough to matter would
-- time out — and then fail silently, forever, which is the bug we are fixing.
-- Every purge below deletes at most `p_batch_limit` rows per call and returns the
-- count, so the backlog drains over several runs and the steady state finishes in
-- milliseconds. Same shape as the existing `cleanup_venue_organic_engagement`
-- and `cleanup_admin_source_refund_query_snapshots` jobs.
--
-- DELIBERATELY NOT INCLUDED
-- -------------------------
-- * `place_discovery_price_range_revisions` (24 MB, ~1.25 GB/yr) — it carries
--   `actor_id`, `action`, `prior_row` and `current_row`. That is an audit trail of
--   who changed a price, and money/legal/audit data is never pruned on an
--   engineer's own authority. #1644's sweep raised the retention RULE as an open
--   product question for Seth (latest-N-per-place vs time-based) and it is still
--   open. Recommended, not implemented.
-- * `place_intelligence_trial_runs` (165 MB) — the live collage re-encode is
--   writing `collage_url` on this table right now. Nothing here touches it.
-- * `place_external_reviews`, `place_pool` — out of scope by instruction.
-- * The cadence of `kick_pending_trial_runs` (every minute, no work done since
--   2026-06-04) is UNCHANGED. It is the largest single producer of cron-log rows,
--   but retention bounds that, and slowing it to */15 would delay the admin-
--   triggered intelligence run that #1644 is waiting on to close its pre-delete
--   gate. Bounding the log is the fix; changing the schedule is a regression.
--
-- SECURITY: every function here is service_role-only, so none needs an entry in
-- supabase/security/anon_executable_definer_allowlist.txt (ORCH-1392 gate).

-- ── 1. THE HEALTH READ ──────────────────────────────────────────────────────
-- `cron` is not in PostgREST's exposed schemas, so a `public` SECURITY DEFINER
-- wrapper is the only way an edge function can see this. Same pattern as
-- #1644's issue_1644_storage_total_bytes().
CREATE OR REPLACE FUNCTION public.issue_1647_cron_job_health(
  p_window_hours integer DEFAULT 6
)
RETURNS TABLE (
  jobid                bigint,
  jobname              text,
  schedule             text,
  runs                 bigint,
  successes            bigint,
  failures             bigint,
  consecutive_failures integer,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_error           text,
  hours_since_success  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  WITH windowed AS (
    SELECT d.jobid, d.status, d.return_message, d.start_time, d.end_time,
           row_number() OVER (PARTITION BY d.jobid ORDER BY d.start_time DESC) AS rn
    FROM cron.job_run_details d
    WHERE d.start_time > now() - make_interval(hours => GREATEST(p_window_hours, 1))
      AND d.status IN ('succeeded', 'failed')
  ),
  -- The trailing streak: how many of the MOST RECENT runs failed without a
  -- success in between. A lifetime failure percentage is a poor health signal on
  -- a job that has run since March — recency is the signal.
  streak AS (
    SELECT w.jobid,
           COALESCE(MIN(w.rn) FILTER (WHERE w.status = 'succeeded'), MAX(w.rn) + 1) - 1 AS consecutive_failures
    FROM windowed w
    GROUP BY w.jobid
  ),
  agg AS (
    SELECT w.jobid,
           count(*)                                        AS runs,
           count(*) FILTER (WHERE w.status = 'succeeded')   AS successes,
           count(*) FILTER (WHERE w.status <> 'succeeded')  AS failures,
           max(w.end_time) FILTER (WHERE w.status <> 'succeeded') AS last_failure_at,
           (array_agg(w.return_message ORDER BY w.start_time DESC)
              FILTER (WHERE w.status <> 'succeeded'))[1]    AS last_error
    FROM windowed w
    GROUP BY w.jobid
  ),
  -- Deliberately NOT windowed: a job whose last success predates the window is
  -- precisely the case that went unnoticed for 66 days, so the real timestamp
  -- has to be reachable however old it is.
  lifetime_success AS (
    SELECT d.jobid, max(d.end_time) AS last_success_at
    FROM cron.job_run_details d
    WHERE d.status = 'succeeded'
    GROUP BY d.jobid
  )
  SELECT j.jobid,
         j.jobname::text,
         j.schedule::text,
         COALESCE(a.runs, 0)      AS runs,
         COALESCE(a.successes, 0) AS successes,
         COALESCE(a.failures, 0)  AS failures,
         COALESCE(s.consecutive_failures, 0)::integer AS consecutive_failures,
         ls.last_success_at,
         a.last_failure_at,
         a.last_error,
         CASE WHEN ls.last_success_at IS NULL THEN NULL
              ELSE round((EXTRACT(EPOCH FROM (now() - ls.last_success_at)) / 3600.0)::numeric, 1)
         END AS hours_since_success
  FROM cron.job j
  LEFT JOIN agg a              ON a.jobid  = j.jobid
  LEFT JOIN streak s           ON s.jobid  = j.jobid
  LEFT JOIN lifetime_success ls ON ls.jobid = j.jobid
  WHERE j.active
  ORDER BY COALESCE(a.failures, 0) DESC, j.jobid;
$function$;

REVOKE ALL ON FUNCTION public.issue_1647_cron_job_health(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1647_cron_job_health(integer) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1647_cron_job_health(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1647_cron_job_health(integer) TO service_role;

COMMENT ON FUNCTION public.issue_1647_cron_job_health(integer) IS
  'Issue #1647. Per-active-job pg_cron health over a recent window, plus the trailing '
  'consecutive-failure streak and the lifetime last-success timestamp. Read hourly by '
  'the api-health-probe edge function, which raises the `pg_cron` tile and emails ops '
  'after two consecutive failed ticks. Exists because refresh_admin_place_pool_mv failed '
  '4,320 of 4,320 runs over 66 days and nothing surfaced it. service_role only.';

-- ── 2. THE TILE ─────────────────────────────────────────────────────────────
-- Category `platform` is an EXISTING category, so the admin API-Health page picks
-- this up with no front-end change (admin_get_api_health builds itself from this
-- table). Class E matches `supabase`/`vercel`: availability only, no balance or
-- depletion signal.
INSERT INTO public.api_health_services
  (service_key, display_name, category, sort_order, monitoring_class, depletion_signal)
VALUES
  ('pg_cron', 'Scheduled jobs (pg_cron)', 'platform', 74, 'E', '{}'::jsonb)
ON CONFLICT (service_key) DO UPDATE
  SET display_name     = EXCLUDED.display_name,
      category         = EXCLUDED.category,
      monitoring_class = EXCLUDED.monitoring_class;

-- Without this row the probe's state machine hits `if (!prev) continue` and the
-- tile can go red forever without ever sending an email — the exact silence this
-- issue is about.
INSERT INTO public.api_health_alert_state
  (service_key, current_state, consecutive_failures, last_balance_state, updated_at)
VALUES
  ('pg_cron', 'ok', 0, 'unknown', now())
ON CONFLICT (service_key) DO NOTHING;

-- ── 3. RETENTION ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_1647_purge_cron_run_details(
  p_retain_days integer DEFAULT 14,
  p_batch_limit integer DEFAULT 25000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  IF p_retain_days < 1 THEN
    RAISE EXCEPTION 'issue #1647: refusing to purge cron run history with retain_days=%', p_retain_days;
  END IF;
  WITH doomed AS (
    SELECT d.ctid
    FROM cron.job_run_details d
    WHERE d.end_time IS NOT NULL
      AND d.end_time < now() - make_interval(days => p_retain_days)
    LIMIT GREATEST(p_batch_limit, 1)
  )
  DELETE FROM cron.job_run_details d
  USING doomed
  WHERE d.ctid = doomed.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1647_purge_cron_run_details(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1647_purge_cron_run_details(integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1647_purge_cron_run_details(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1647_purge_cron_run_details(integer, integer) TO service_role;

COMMENT ON FUNCTION public.issue_1647_purge_cron_run_details(integer, integer) IS
  'Issue #1647. Bounded retention for cron.job_run_details, which had NO policy and had '
  'never been vacuumed: 475,386 rows / 491 MB, oldest 2026-03-15, growing ~3.4 MB/day. '
  'Deletes at most p_batch_limit rows per call so it can never exceed the 2-minute '
  'statement timeout and fail silently the way job 13 did. Returns the row count.';

CREATE OR REPLACE FUNCTION public.issue_1647_purge_api_health_checks(
  p_retain_days integer DEFAULT 30,
  p_batch_limit integer DEFAULT 10000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  IF p_retain_days < 7 THEN
    RAISE EXCEPTION 'issue #1647: api_health_checks retention below 7 days would blind the incident view (got %)', p_retain_days;
  END IF;
  WITH doomed AS (
    SELECT c.id
    FROM public.api_health_checks c
    WHERE c.checked_at < now() - make_interval(days => p_retain_days)
    ORDER BY c.id
    LIMIT GREATEST(p_batch_limit, 1)
  )
  DELETE FROM public.api_health_checks c
  USING doomed
  WHERE c.id = doomed.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1647_purge_api_health_checks(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1647_purge_api_health_checks(integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1647_purge_api_health_checks(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1647_purge_api_health_checks(integer, integer) TO service_role;

COMMENT ON FUNCTION public.issue_1647_purge_api_health_checks(integer, integer) IS
  'Issue #1647. Bounded 30-day retention for the api_health_checks probe log (~843 rows/day, '
  '~73 MB/yr, no prior policy). api_health_observations and api_health_alert_state are NOT '
  'touched — they are tiny and hold current state.';

CREATE OR REPLACE FUNCTION public.issue_1647_purge_photo_backfill_batches(
  p_completed_days integer DEFAULT 14,
  p_failed_days    integer DEFAULT 60,
  p_batch_limit    integer DEFAULT 20000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  IF p_completed_days < 7 OR p_failed_days < p_completed_days THEN
    RAISE EXCEPTION
      'issue #1647: nonsensical photo_backfill_batches retention (completed=%, failed=%)',
      p_completed_days, p_failed_days;
  END IF;
  WITH doomed AS (
    SELECT b.id
    FROM public.photo_backfill_batches b
    WHERE (b.status = 'completed' AND b.created_at < now() - make_interval(days => p_completed_days))
       OR (b.status <> 'completed' AND b.created_at < now() - make_interval(days => p_failed_days))
    ORDER BY b.created_at
    LIMIT GREATEST(p_batch_limit, 1)
  )
  DELETE FROM public.photo_backfill_batches b
  USING doomed
  WHERE b.id = doomed.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1647_purge_photo_backfill_batches(integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1647_purge_photo_backfill_batches(integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1647_purge_photo_backfill_batches(integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1647_purge_photo_backfill_batches(integer, integer, integer) TO service_role;

COMMENT ON FUNCTION public.issue_1647_purge_photo_backfill_batches(integer, integer, integer) IS
  'Issue #1647. Bounded retention for photo_backfill_batches (101,063 rows / 81 MB, 81,180 of '
  'them already older than 30 days, no prior policy). Failed batches are kept four times '
  'longer than completed ones because they are the diagnostic record. The parent '
  'photo_backfill_runs summary is NEVER pruned — it is small and it is the audit trail.';

-- ── 4. SCHEDULES ────────────────────────────────────────────────────────────
-- cron.schedule(name, schedule, command) upserts by name, so re-applying this
-- migration re-points an existing job rather than creating a duplicate.
SELECT cron.schedule(
  'issue_1647_cron_log_retention', '*/20 * * * *',
  $cron$SELECT public.issue_1647_purge_cron_run_details(14, 25000)$cron$
);

SELECT cron.schedule(
  'issue_1647_api_health_retention', '40 3 * * *',
  $cron$SELECT public.issue_1647_purge_api_health_checks(30, 10000)$cron$
);

SELECT cron.schedule(
  'issue_1647_photo_backfill_batch_retention', '50 3 * * *',
  $cron$SELECT public.issue_1647_purge_photo_backfill_batches(14, 60, 20000)$cron$
);

-- pg_net's own 6-hour TTL already deletes the ROWS; what it cannot do is return
-- the heap to the OS, which is how 1,907 live rows come to occupy 411 MB. A
-- weekly rewrite keeps that bounded. Scheduled at the quietest hour because
-- VACUUM FULL takes an ACCESS EXCLUSIVE lock and pg_net writes here.
-- The one-off 411 MB reclaim is an operator step, not this job — see
-- scripts/issue-1647/RECLAIM_RUNBOOK.sql.
SELECT cron.schedule(
  'issue_1647_net_response_compact', '30 4 * * 0',
  $cron$VACUUM (FULL, ANALYZE) net._http_response$cron$
);

-- ── FAIL-LOUD CONTRACT ──────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_missing text[];
BEGIN
  IF to_regprocedure('public.issue_1647_cron_job_health(integer)') IS NULL THEN
    RAISE EXCEPTION 'issue #1647: issue_1647_cron_job_health() was not created';
  END IF;
  IF has_function_privilege('anon', 'public.issue_1647_cron_job_health(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_1647_cron_job_health(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #1647: cron health RPC is executable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.issue_1647_cron_job_health(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #1647: service_role cannot execute the cron health RPC — the probe would be blind';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.api_health_services WHERE service_key = 'pg_cron') THEN
    RAISE EXCEPTION
      'issue #1647: the pg_cron tile is missing from api_health_services — api_health_checks '
      'is FK-constrained on service_key, so the probe''s whole batch insert would fail';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_health_alert_state WHERE service_key = 'pg_cron') THEN
    RAISE EXCEPTION
      'issue #1647: the pg_cron alert-state row is missing — the probe skips services with no '
      'seeded state row, so the tile could sit red forever without ever emailing anyone';
  END IF;

  SELECT array_agg(n ORDER BY n) INTO v_missing
  FROM unnest(ARRAY[
    'issue_1647_cron_log_retention',
    'issue_1647_api_health_retention',
    'issue_1647_photo_backfill_batch_retention',
    'issue_1647_net_response_compact'
  ]) AS n
  WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = n AND j.active);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'issue #1647: retention job(s) not scheduled or not active: %', v_missing;
  END IF;
END
$verify$;
