-- ===========================================
-- ORCH-0437: Near You Leaderboard — Phase 1
-- Migration 6: Scheduled cleanup jobs (pg_cron)
-- ===========================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Hourly: delete leaderboard presence rows older than 24 hours
SELECT cron.schedule(
  'cleanup-stale-leaderboard-presence',
  '0 * * * *',
  $$DELETE FROM public.leaderboard_presence WHERE last_swipe_at < now() - interval '24 hours'$$
);

-- Hourly: expire pending tag-along requests past their expiry time
SELECT cron.schedule(
  'expire-tag-along-requests',
  '0 * * * *',
  $$UPDATE public.tag_along_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < now()$$
);
