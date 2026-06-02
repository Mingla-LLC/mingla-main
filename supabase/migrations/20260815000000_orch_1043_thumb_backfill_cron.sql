-- ORCH-1033 [Photo-thumbnail pipeline: server-driven + parallel + scoped + collage fallback]
-- Layer D — auto-pickup: a 10-min pg_cron sweep that self-drains the servable
-- thumbnail backlog by driving the server-driven backfill-place-photo-thumbs
-- edge function (process_chunk / ensure_auto_run actions).
--
-- Mirrors the canonical async-run pattern from
--   supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql
-- (tg_kick_pending_trial_runs + cron.schedule + vault service_role_key + pg_net).
--
-- External-API / infra docs cited inline per COMMS-0003:
--   pg_cron + pg_net:                https://supabase.com/docs/guides/cron
--   EdgeRuntime.waitUntil (bg tasks): https://supabase.com/docs/guides/functions/background-tasks
--   Supabase Vault (secrets):        https://supabase.com/docs/guides/database/vault
--
-- APPLY: via the Supabase Management API SQL endpoint at close
--   (POST /v1/projects/gqnoajqerqhnvulmnyvv/database/query), NOT `db push` —
--   this worktree is behind remote and `db push` hits pre-existing ledger drift.
--   Verify with list_migrations showing 20260815000000 before the close banner.

BEGIN;

-- ─── 1. Pre-flight extension + infra guards ──────────────────────────────
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'ORCH-1033: pg_cron extension is required but not installed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'ORCH-1033: pg_net not installed — the kicker cannot HTTP-POST; install pg_net before the cron can drive runs';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key'
  ) THEN
    RAISE NOTICE 'ORCH-1033: vault secret service_role_key absent — kicker will skip silently until it is set';
  END IF;
END;
$preflight$;

-- ─── 2. last_heartbeat_at column (staleness-based recovery) ───────────────
-- photo_backfill_runs lacks a heartbeat today. The worker stamps it once per
-- process_chunk invocation (at start); the kicker re-kicks a 'running' run
-- whose heartbeat is older than the staleness window.
ALTER TABLE public.photo_backfill_runs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

COMMENT ON COLUMN public.photo_backfill_runs.last_heartbeat_at IS
  'ORCH-1033: server-driven thumbs runs stamp this at the start of each process_chunk invocation. The kick_pending_thumb_backfill cron re-kicks a running run whose heartbeat is stale (>5 min). NULL for legacy/browser-era rows.';

-- ─── 3. Kicker function ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_kick_pending_thumb_backfill()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  worker_url  text := 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photo-thumbs';
  service_key text;
  r           record;
BEGIN
  -- Fetch the service_role_key from vault. Operator sets it pre-deploy:
  --   SELECT vault.create_secret('eyJ...', 'service_role_key');
  -- If absent, skip silently so the next tick retries (no error spam) —
  -- verbatim behavior from tg_kick_pending_trial_runs.
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  IF service_key IS NULL THEN
    RAISE NOTICE 'tg_kick_pending_thumb_backfill: service_role_key not in vault, skipping tick';
    RETURN;
  END IF;

  -- (a) Ensure-and-kick: ask the edge fn to create a global servable thumbs run
  -- if none is active and there is a backlog, and to kick whatever active run
  -- exists. ensure_auto_run is idempotent (no-op if an active run exists and is
  -- already advancing); the backlog count (servable + has-photos + no-thumb) is
  -- computed in-function so the array_length(text[]) semantics live in one place.
  PERFORM net.http_post(
    url := worker_url,
    body := jsonb_build_object('action', 'ensure_auto_run'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    )
  );

  -- (b) Stale-heartbeat recovery: re-kick any 'running' thumbs run whose
  -- heartbeat is stale or absent (the worker that owned it likely died).
  FOR r IN
    SELECT id FROM public.photo_backfill_runs
    WHERE city = 'ORCH-0957 place-photo thumbs'
      AND country = 'GLOBAL'
      AND status = 'running'
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '5 minutes')
    ORDER BY created_at ASC
    LIMIT 5
  LOOP
    PERFORM net.http_post(
      url := worker_url,
      body := jsonb_build_object('action', 'process_chunk', 'runId', r.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      )
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tg_kick_pending_thumb_backfill IS
  'ORCH-1033: pg_cron-driven thumbnail-backfill kicker (every 10 min). (a) HTTP-POSTs ensure_auto_run to create+drive a global servable thumbs run when a backlog exists; (b) re-kicks any running thumbs run with a stale (>5 min) or absent heartbeat. Service role key from vault; skips silently with RAISE NOTICE when absent. Mirrors tg_kick_pending_trial_runs.';

-- ─── 4. Schedule the cron job (every 10 minutes) ──────────────────────────
-- Unschedule-if-exists guard (verbatim pattern from 20260506000001).
DO $cron_setup$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'kick_pending_thumb_backfill';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'kick_pending_thumb_backfill',
    '*/10 * * * *',                                                -- every 10 minutes
    $job$ SELECT public.tg_kick_pending_thumb_backfill(); $job$
  );
END;
$cron_setup$;

-- ─── 5. ONE-TIME cleanup: supersede stale browser-era thumbs runs ─────────
-- Investigation Discovery 2: a stale browser-era thumbs run sits paused/ready
-- (0 progress). The server-driven cutover cancels pre-existing paused/ready
-- thumbs runs so the new kicker does not double-drive a half-dead run. Idempotent
-- (only touches the synthetic thumbs discriminator + non-terminal states).
UPDATE public.photo_backfill_runs
SET status = 'cancelled',
    completed_at = now()
WHERE city = 'ORCH-0957 place-photo thumbs'
  AND country = 'GLOBAL'
  AND status IN ('paused', 'ready')
  AND created_at < now();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference (operator runs if needed):
--   BEGIN;
--     SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='kick_pending_thumb_backfill';
--     DROP FUNCTION IF EXISTS public.tg_kick_pending_thumb_backfill();
--     ALTER TABLE public.photo_backfill_runs DROP COLUMN IF EXISTS last_heartbeat_at;
--   COMMIT;
-- (The one-time run cleanup is NOT reversed; those rows were already stale.)
-- ─────────────────────────────────────────────────────────────────────────
