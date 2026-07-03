-- META-ORCH-1270 (Phase 2) — reaper + Bunny usage alarm.
--
-- 1) reaped_at column on event_cover_video_jobs (idempotent double-delete guard)
--    + a partial index for the reaper's candidate scan.
-- 2) The event-cover-video-reaper cron (every 6h), mirroring the ORCH-1201
--    api-health-probe cron (pg_cron + pg_net, vault supabase_url/service_role_key).
-- 3) The `bunny` usage-alarm registry seed (api_health_services + a monitoring
--    class/depletion_signal + api_health_alert_state row) so probeBunny's
--    bunny_usage_pct balance signal has a registry row AND an alert-state row —
--    without the alert-state row runAlertStateMachine silently skips it (the
--    Vector-D failure #5 that let the Cloudinary alarm stay quiet).
--
-- Prefix 20261205000003 is strictly greater than every local migration
-- (max 20261205000000_meta_orch_1270_bunny_provider) AND every sibling worktree
-- migration (max 20261205000002_orch_1272_admin_get_person). Monotonic-safe.
--
-- Cloudinary behavior is UNCHANGED. No data migration (prod DB wiped 2026-06-22;
-- 0 live cover videos). Do NOT apply to prod from this worktree.

-- ════════════════════════════════════════════════════════════════════════
-- 1. reaped_at column + reaper index
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.event_cover_video_jobs
  ADD COLUMN IF NOT EXISTS reaped_at timestamptz;

COMMENT ON COLUMN public.event_cover_video_jobs.reaped_at IS
  'META-ORCH-1270 (Phase 2): set when the provider asset (Bunny video guid in source_asset_id) was destroyed. Guards the reaper against double-delete; NULL = the asset may still exist.';

-- Partial index so the reaper candidate scan (reaped_at IS NULL AND
-- source_asset_id IS NOT NULL) is a bounded index probe, never a table scan.
CREATE INDEX IF NOT EXISTS idx_event_cover_video_jobs_reaper
  ON public.event_cover_video_jobs (created_at)
  WHERE reaped_at IS NULL AND source_asset_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Bunny usage-alarm registry seed (Class-A)
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.api_health_services (service_key, display_name, category, sort_order) VALUES
  ('bunny', 'Bunny Stream', 'media', 62)
ON CONFLICT (service_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      category     = EXCLUDED.category,
      sort_order   = EXCLUDED.sort_order;

-- Class-A: metered WITH a programmatic usage read. The percent is the HIGHER of
-- the storage/traffic ratios (computed in probeBunny). No Atlassian status feed
-- is wired (status_feed NULL) — Bunny is monitored synthetically. warn 60 / crit
-- 85 (env-overridable via API_HEALTH_BUNNY_WARN_PCT / API_HEALTH_BUNNY_CRIT_PCT).
UPDATE public.api_health_services
   SET monitoring_class = 'A',
       depletion_signal = jsonb_build_object(
         'status_feed', NULL,
         'balance', jsonb_build_object('kind','bunny_usage_pct','warn',60,'crit',85,'unit','pct_used'))
 WHERE service_key = 'bunny';

-- The state-machine row (else runAlertStateMachine skips bunny → one-shot email
-- never sent). last_balance_state defaults 'ok' so the first crossing pages once.
INSERT INTO public.api_health_alert_state (service_key)
  VALUES ('bunny')
ON CONFLICT (service_key) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Reaper cron (every 6h) — pg_cron + pg_net, vault names per ORCH-1201
-- ════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'META-ORCH-1270: pg_cron extension required — operator must enable before apply'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE NOTICE 'META-ORCH-1270: pg_net missing — net.http_post will fail at runtime; enable pg_net'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='meta_orch_1270_cover_video_reaper')
  THEN PERFORM cron.unschedule('meta_orch_1270_cover_video_reaper'); END IF;
END $$;

SELECT cron.schedule(
  'meta_orch_1270_cover_video_reaper',
  '0 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/event-cover-video-reaper',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  $cron$
);

-- ════════════════════════════════════════════════════════════════════════
-- 4. SELF-VERIFICATION
-- ════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='meta_orch_1270_cover_video_reaper' AND schedule='0 */6 * * *') THEN
    RAISE EXCEPTION 'META-ORCH-1270 verify: reaper cron not scheduled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='event_cover_video_jobs' AND column_name='reaped_at'
  ) THEN
    RAISE EXCEPTION 'META-ORCH-1270 verify: reaped_at column missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_health_services WHERE service_key='bunny') THEN
    RAISE EXCEPTION 'META-ORCH-1270 verify: bunny api_health_services row missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_health_alert_state WHERE service_key='bunny') THEN
    RAISE EXCEPTION 'META-ORCH-1270 verify: bunny api_health_alert_state row missing';
  END IF;
END $$;
