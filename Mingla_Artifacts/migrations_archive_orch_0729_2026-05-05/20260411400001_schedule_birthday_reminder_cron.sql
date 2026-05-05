-- ==========================================================================
-- BIRTHDAY REMINDER CRON (ORCH-0402)
--
-- Schedules daily cron for notify-birthday-reminder at 9 AM UTC.
-- Scans pairings + profiles for upcoming birthdays and sends push
-- notifications at 5 milestones: 3 months, 1 month, 1 week, 1 day, day-of.
--
-- Uses the same pg_cron + pg_net + vault pattern as notify-holiday-reminder.
-- ==========================================================================

SELECT cron.schedule(
  'notify-birthday-reminder-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/notify-birthday-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
