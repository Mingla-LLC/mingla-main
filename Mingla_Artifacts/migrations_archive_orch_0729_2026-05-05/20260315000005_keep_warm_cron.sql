-- Enable required extensions for cron + HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Idempotent: remove existing schedule before re-creating
-- (cron.unschedule errors if job doesn't exist, so wrap in exception handler)
DO $$
BEGIN
  PERFORM cron.unschedule('keep-functions-warm');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist yet — nothing to unschedule
  NULL;
END;
$$;

-- Schedule keep-warm pings every 5 minutes
SELECT cron.schedule(
  'keep-functions-warm',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/keep-warm',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_anon_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
