-- Issue #4276 (fix c): the place list refresh's slot reads a comma list of minutes.
--
-- Production schedules refresh_admin_place_pool_mv as '3,33 * * * *' (#4275 staggered
-- it), and 20280418004276 only read '*/N * * * *', so the Pipeline health line said the
-- slot was unknown. The minute field is now read in two forms, every other field must
-- be '*':
--   * '*/N'          N from 1 to 59 gives N * 60 seconds (unchanged);
--   * 'a,b,c'        two or more distinct minutes from 0 to 59 that are evenly spaced
--                    round the hour, counting the wrap from the last back to the first,
--                    give that spacing * 60 seconds ('3,33' gives 1800, '0,15,30,45'
--                    gives 900).
-- Anything else (a single minute, uneven spacing, ranges, other fields set) gives
-- null, and the screen then says it couldn't read the slot rather than guessing one.
--
-- Static SQL. Rollback: restore city_pipeline_mv_refresh_health from
-- 20280418004276_issue_4276_mv_refresh_slot_from_cron.sql and drop
-- city_pipeline_cron_slot_seconds(text).

BEGIN;

CREATE OR REPLACE FUNCTION public.city_pipeline_cron_slot_seconds(p_schedule text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
  WITH field AS (
    SELECT (regexp_match(regexp_replace(btrim(coalesce(p_schedule, '')), '\s+', ' ', 'g'),
                         '^([0-9*/,]+) \* \* \* \*$'))[1] AS minute
  )
  SELECT CASE
    WHEN field.minute ~ '^\*/[0-9]{1,2}$' THEN
      CASE WHEN substr(field.minute, 3)::integer BETWEEN 1 AND 59
           THEN substr(field.minute, 3)::integer * 60 END
    WHEN field.minute ~ '^[0-9]{1,2}(,[0-9]{1,2})+$' THEN (
      SELECT CASE
        WHEN bool_and(g.minute BETWEEN 0 AND 59)
         AND min(g.gap) > 0
         AND count(DISTINCT g.gap) = 1
        THEN min(g.gap) * 60
      END
      FROM (
        SELECT m.minute,
               coalesce(lead(m.minute) OVER (ORDER BY m.minute),
                        first_value(m.minute) OVER (ORDER BY m.minute) + 60) - m.minute AS gap
        FROM unnest(string_to_array(field.minute, ',')::integer[]) AS m(minute)
      ) g
    )
  END
  FROM field;
$function$;

REVOKE ALL ON FUNCTION public.city_pipeline_cron_slot_seconds(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.city_pipeline_cron_slot_seconds(text) TO service_role;

COMMENT ON FUNCTION public.city_pipeline_cron_slot_seconds(text) IS
  'Issue #4276: seconds between runs for a minute-only cron schedule (*/N, or evenly '
  'spaced minutes such as 3,33), else null.';

CREATE OR REPLACE FUNCTION public.city_pipeline_mv_refresh_health(p_window_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  WITH job AS (
    SELECT j.jobid, public.city_pipeline_cron_slot_seconds(j.schedule) AS slot
    FROM cron.job j
    WHERE j.jobname = 'refresh_admin_place_pool_mv'
  )
  SELECT jsonb_build_object(
    'jobname', 'refresh_admin_place_pool_mv',
    'runs', count(d.*),
    'max_seconds', round(max(EXTRACT(EPOCH FROM (d.end_time - d.start_time)))::numeric, 1),
    'interval_seconds', min(job.slot)
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
