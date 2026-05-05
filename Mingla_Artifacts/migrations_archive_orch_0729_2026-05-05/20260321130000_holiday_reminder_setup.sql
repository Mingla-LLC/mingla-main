-- ==========================================================================
-- HOLIDAY REMINDER SETUP (Block 3 Pass 2 — hardened 2026-03-21)
--
-- 1. Adds `reminders` preference column to notification_preferences.
--    Gates holiday + calendar reminders under a single user toggle.
--    Previously calendar reminders had no preference key (always sent push).
--
-- 2. Schedules daily cron for notify-holiday-reminder at 9 AM UTC.
--    Scans custom_holidays for tomorrow's dates (per-user timezone).
-- ==========================================================================

-- ── 1. Add reminders preference column ────────────────────────────────────
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS reminders BOOLEAN NOT NULL DEFAULT true;

-- ── 2. Schedule holiday reminder cron ─────────────────────────────────────
SELECT cron.schedule(
  'notify-holiday-reminder-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/notify-holiday-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
