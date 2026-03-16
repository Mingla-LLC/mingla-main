-- ==========================================================================
-- SCHEDULE pg_cron JOBS FOR NOTIFICATION EDGE FUNCTIONS
-- Fixes: Root Cause 2 (notify-lifecycle never called) and
--        Root Cause 3 (notify-calendar-reminder never called).
--
-- Both edge functions are fully implemented but had zero callers.
-- These cron jobs invoke them on a regular schedule via pg_net HTTP calls.
-- ==========================================================================

-- Ensure pg_cron and pg_net extensions are available
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── 1. notify-lifecycle: Daily at 10:00 AM UTC ────────────────────────────
-- Scans for: welcome (new signups), trial_ending (3 days before expiry),
-- re_engagement_3d, re_engagement_7d, and weekly_digest notifications.
-- Runs once daily — the edge function handles per-user idempotency keys
-- so duplicate notifications are impossible even if the cron fires twice.
SELECT cron.schedule(
  'notify-lifecycle-daily',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/notify-lifecycle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"source": "pg_cron"}'::jsonb
  );
  $$
);

-- ── 2. notify-calendar-reminder: Hourly at minute 15 ─────────────────────
-- Scans for calendar entries scheduled for tomorrow and today, sends
-- reminder notifications. Hourly gives good coverage without spamming.
-- The edge function uses per-user per-entry idempotency keys to prevent
-- sending the same reminder twice even if the cron overlaps.
SELECT cron.schedule(
  'notify-calendar-reminder-hourly',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/notify-calendar-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"source": "pg_cron"}'::jsonb
  );
  $$
);
