-- Issue #1389: deadline and ambiguous-payment protection backstop.

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'issue_1389_stay_reservation_sweep'
  ) THEN
    PERFORM cron.unschedule('issue_1389_stay_reservation_sweep');
  END IF;
END;
$block$;

SELECT cron.schedule(
  'issue_1389_stay_reservation_sweep',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'supabase_url'
        LIMIT 1
      ) || '/functions/v1/stay-reservation-sweep',
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
      timeout_milliseconds := 30000
    );
  $cron$
);

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'issue_1389_stay_reservation_sweep'
      AND schedule = '*/5 * * * *'
  ) THEN
    RAISE EXCEPTION '#1389 Stay sweep cron registration failed';
  END IF;
END;
$block$;
