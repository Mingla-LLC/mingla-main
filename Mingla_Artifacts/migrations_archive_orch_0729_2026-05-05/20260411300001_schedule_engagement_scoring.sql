-- Schedule weekly engagement scoring computation.
-- Runs every Monday at 6 AM UTC. Computes a 0-100 engagement score
-- for each user and pushes it to Mixpanel user profiles via HTTP API.
--
-- The edge function handles batching and error recovery internally.

SELECT cron.schedule(
  'compute-engagement-scores-weekly',
  '0 6 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/compute-engagement-scores',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"source": "pg_cron"}'::jsonb
  );
  $$
);
