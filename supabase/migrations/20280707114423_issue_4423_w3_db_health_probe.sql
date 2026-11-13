-- #4423 Wave 3: tell us before users do when the database pool is close to full.
--
-- On 13 Nov the only uptime monitor watched a static page, so nobody was told
-- while public pages waited 30 to 280 s for a connection. Every 5 minutes the
-- existing api-health-probe edge function now runs a database check
-- (body {"mode":"db"}; the hourly vendor tick is unchanged):
--   * issue_4423_db_health_snapshot(): PostgREST connections open and in use
--     (not idle) against the pool of 30, client queries running longer than
--     5 s, and the longest one's age and application name. No query text.
--   * the probe also times one cheap public read through PostgREST with the
--     anon key (GET /rpc/issue_1384_supported_currencies, a STABLE public RPC
--     over a handful of rows), which is exactly the path a public page waits on.
--   * issue_4423_db_health_record(): keeps how many checks in a row had the
--     pool at least 80 % in use, and when the last alert went out (so one
--     incident sends one email per 30 minutes, not one every 5).
-- Alerts go through the existing sendOpsAlertEmail rail to the existing
-- API_HEALTH_ALERT_EMAILS recipients (no new secret).
--
-- Both functions are service_role only. The state table has RLS on and no
-- policies (service_role only).
--
-- Apply order is safe either way. The deployed api-health-probe before this
-- branch ignores the body and would run the full paid vendor tick every 5
-- minutes, so the cron posts only once the state row exists, and only this
-- branch's function writes it (its hourly tick marks the row; a db check
-- updates it). Applied before the deploy, the job runs and posts nothing;
-- the first database check follows the first hourly tick of the new code.
--
-- Rollback: SELECT cron.unschedule('issue_4423_db_health_probe'); run as
--           postgres, the job owner (the functions and the one-row table can
--           stay).

BEGIN;

CREATE TABLE IF NOT EXISTS public.issue_4423_db_health_state (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  high_streak     integer NOT NULL DEFAULT 0 CHECK (high_streak >= 0),
  last_alert_at   timestamptz,
  last_checked_at timestamptz,
  last_snapshot   jsonb
);
ALTER TABLE public.issue_4423_db_health_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_4423_db_health_state FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.issue_4423_db_health_state IS
  '#4423 W3: one row. How many database checks in a row had the PostgREST pool at least 80 % in use, and when the last alert was sent.';

CREATE OR REPLACE FUNCTION public.issue_4423_db_health_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'pool_size', 30,
    'pool_open', count(*) FILTER (WHERE a.application_name ILIKE 'postgrest%'),
    'pool_in_use', count(*) FILTER (WHERE a.application_name ILIKE 'postgrest%' AND a.state IS DISTINCT FROM 'idle'),
    'long_running', count(*) FILTER (WHERE a.state = 'active' AND a.query_start < clock_timestamp() - interval '5 seconds'),
    'longest_ms', COALESCE(round(extract(epoch FROM max(clock_timestamp() - a.query_start) FILTER (WHERE a.state = 'active')) * 1000), 0),
    'longest_app', (SELECT NULLIF(b.application_name, '') FROM pg_catalog.pg_stat_activity b
                     WHERE b.backend_type = 'client backend' AND b.state = 'active' AND b.pid <> pg_catalog.pg_backend_pid()
                     ORDER BY b.query_start LIMIT 1),
    'at', clock_timestamp())
  FROM pg_catalog.pg_stat_activity a
  WHERE a.backend_type = 'client backend' AND a.pid <> pg_catalog.pg_backend_pid()
$function$;
COMMENT ON FUNCTION public.issue_4423_db_health_snapshot() IS
  '#4423 W3: PostgREST pool use and long-running client queries, for the api-health-probe database check. No query text. service_role only.';
REVOKE ALL ON FUNCTION public.issue_4423_db_health_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4423_db_health_snapshot() TO service_role;

-- p_high: this check had the pool at least 80 % in use. p_alerted: an alert
-- was just sent. Returns the streak (checks in a row with p_high) and when
-- the last alert went out, as the probe needs them to decide.
CREATE OR REPLACE FUNCTION public.issue_4423_db_health_record(p_high boolean, p_alerted boolean, p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE r public.issue_4423_db_health_state;
BEGIN
  INSERT INTO public.issue_4423_db_health_state AS s (id, high_streak, last_alert_at, last_checked_at, last_snapshot)
  VALUES (true, CASE WHEN COALESCE(p_high, false) THEN 1 ELSE 0 END,
          CASE WHEN COALESCE(p_alerted, false) THEN clock_timestamp() END, clock_timestamp(), p_snapshot)
  ON CONFLICT (id) DO UPDATE
     SET high_streak = CASE WHEN COALESCE(p_high, false) THEN s.high_streak + 1 ELSE 0 END,
         last_alert_at = CASE WHEN COALESCE(p_alerted, false) THEN clock_timestamp() ELSE s.last_alert_at END,
         last_checked_at = clock_timestamp(),
         last_snapshot = COALESCE(p_snapshot, s.last_snapshot)
  RETURNING * INTO r;
  RETURN jsonb_build_object('high_streak', r.high_streak, 'last_alert_at', r.last_alert_at);
END;
$function$;
COMMENT ON FUNCTION public.issue_4423_db_health_record(boolean, boolean, jsonb) IS
  '#4423 W3: record one database check (pool-high streak, last alert time). service_role only.';
REVOKE ALL ON FUNCTION public.issue_4423_db_health_record(boolean, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4423_db_health_record(boolean, boolean, jsonb) TO service_role;

-- Every 5 minutes, the database check only (minute offset 2 keeps it off the
-- hourly vendor tick at :00).
SELECT cron.schedule(
  'issue_4423_db_health_probe',
  '2-59/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/api-health-probe',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'content-type', 'application/json'
    ),
    body := '{"mode":"db"}'::jsonb,
    timeout_milliseconds := 30000
  )
  WHERE EXISTS (SELECT 1 FROM public.issue_4423_db_health_state)
  $cron$
);

COMMIT;
