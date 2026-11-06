-- Issue #4276: the place list refresh's slot is read from its cron job, not assumed.
--
-- city_pipeline_mv_refresh_health reported interval_seconds as a fixed 600, but #4275
-- (20280406014275_issue_4275_cron_stagger.sql) moved refresh_admin_place_pool_mv from
-- every 10 to every 30 minutes, so "over half its slot" fired too early. The slot now
-- comes from the job's schedule: the minute form '*/N * * * *' (N from 1 to 59) gives
-- N * 60 seconds. Any other schedule, or no job, gives null, and the admin screen and
-- api-health-probe then show no "over half its slot" warning rather than a wrong one.
--
-- Rollback: restore city_pipeline_mv_refresh_health from
-- 20280410034276_issue_4276_city_pipeline_conductor.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.city_pipeline_mv_refresh_health(p_window_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  WITH job AS (
    SELECT j.jobid,
           regexp_match(regexp_replace(btrim(j.schedule), '\s+', ' ', 'g'), '^\*/([0-9]{1,2}) \* \* \* \*$') AS m
    FROM cron.job j
    WHERE j.jobname = 'refresh_admin_place_pool_mv'
  )
  SELECT jsonb_build_object(
    'jobname', 'refresh_admin_place_pool_mv',
    'runs', count(d.*),
    'max_seconds', round(max(EXTRACT(EPOCH FROM (d.end_time - d.start_time)))::numeric, 1),
    'interval_seconds', CASE WHEN (min(job.m[1]))::integer BETWEEN 1 AND 59 THEN (min(job.m[1]))::integer * 60 END
  )
  FROM job
  LEFT JOIN cron.job_run_details d
    ON d.jobid = job.jobid
   AND d.status = 'succeeded'
   AND d.start_time > now() - make_interval(hours => GREATEST(p_window_hours, 1));
$function$;

REVOKE ALL ON FUNCTION public.city_pipeline_mv_refresh_health(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.city_pipeline_mv_refresh_health(integer) TO service_role;

COMMIT;
