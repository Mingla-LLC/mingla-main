-- toward #3697: retry pending/failed ad conversions hourly for at most 24h.
BEGIN;

DO $block$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Issue #3697: pg_cron not enabled; conversion retry not scheduled.';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Issue #3697: pg_net not enabled; conversion retry not scheduled.';
    RETURN;
  END IF;

  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'issue_3697_ad_conversion_retry_hourly'
  LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'issue_3697_ad_conversion_retry_hourly',
    '37 * * * *',
    $cron$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'supabase_url'
          LIMIT 1
        ) || '/functions/v1/ad-conversion-retry',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'service_role_key'
            LIMIT 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $cron$
  );

  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'issue_3697_ad_conversion_retry_hourly'
      AND schedule = '37 * * * *'
  ) THEN
    RAISE EXCEPTION '#3697 conversion retry cron registration failed';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Issue #3697: cron.job not visible; conversion retry not scheduled.';
END;
$block$;

COMMIT;
