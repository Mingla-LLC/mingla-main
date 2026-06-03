-- ORCH-1044 [Thumbnail generation must fit the edge compute budget + reliably drain]
-- Root Cause 2 — orphaned 'running' batch reclaim.
--
-- When a process_chunk invocation is killed mid-batch (HTTP 546 WORKER_LIMIT, an
-- edge timeout, or a deploy clobber), the batch it claimed is left in 'running'
-- with no terminal write. The ORCH-1043 cron driver only re-kicks RUNS with a
-- stale heartbeat and only ever claims 'pending' BATCHES — there was no
-- batch-level reclaim, so those orphaned 'running' batches were invisible to
-- every future claim forever (live DB showed 11 such batches on run 7b782c45,
-- freezing the run at 1/691 completed).
--
-- This migration EXTENDS public.tg_kick_pending_thumb_backfill() (the existing
-- pg_cron-driven kicker, every 10 min) by ADDING a step (c) that resets stale
-- 'running' thumb batches back to 'pending' so a future invocation re-claims +
-- resumes them. The ORCH-1044 edge fn re-run is cheap: thumbExists HEAD-skips
-- already-written thumbs and the per-place all-or-nothing semantics hold.
--
-- Idempotent (CREATE OR REPLACE FUNCTION). No schema/column/RLS changes.
-- SECURITY DEFINER preserved (matches the existing function).
--
-- Infra docs cited inline per COMMS-0003:
--   pg_cron + pg_net:                https://supabase.com/docs/guides/cron
--   Supabase Edge Function 2 s CPU:  https://supabase.com/docs/guides/functions/limits
--   546 WORKER_LIMIT semantics:      https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response
--
-- APPLY: via the Supabase Management API SQL endpoint
--   (POST /v1/projects/gqnoajqerqhnvulmnyvv/database/query), NOT `db push` —
--   the linked remote carries pre-existing ledger drift (COMMS-0012), so
--   `db push` is unsafe here. Verify with list_migrations showing
--   20260818000000 before the close banner.

BEGIN;

-- ─── Pre-flight: the function we extend must already exist (ORCH-1043) ─────
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tg_kick_pending_thumb_backfill'
  ) THEN
    RAISE EXCEPTION 'ORCH-1044: public.tg_kick_pending_thumb_backfill() not found — apply 20260815000000_orch_1043_thumb_backfill_cron.sql first';
  END IF;
END;
$preflight$;

-- ─── Orphaned-running-batch stale bound ───────────────────────────────────
-- 3 minutes is a hard floor: it must exceed the worst realistic single
-- invocation wall (~6 s at the OLD CPU-blowing shape; ~1.2 s + I/O under
-- ORCH-1044's wall guard) by a wide margin so a legitimately in-flight batch
-- is NEVER reclaimed mid-flight. The reclaim resets status alone — it does NOT
-- touch run counters (the orphaned batch never wrote terminal counters, so
-- there is no double-count risk).
CREATE OR REPLACE FUNCTION public.tg_kick_pending_thumb_backfill()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  worker_url  text := 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photo-thumbs';
  service_key text;
  r           record;
  reclaimed   integer;
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

  -- (c) ORCH-1044: reclaim orphaned 'running' batches. Runs BEFORE (a)/(b) so
  -- the ensure/re-kick below see freshly-reclaimed 'pending' batches this tick.
  -- A 546-killed process_chunk leaves a claimed batch in 'running' with no
  -- terminal write. Reset any 'running' batch (on an active servable thumbs run)
  -- whose started_at is older than the stale bound back to 'pending' so a future
  -- invocation can re-claim it. Counters untouched (no terminal write happened).
  UPDATE public.photo_backfill_batches b
     SET status = 'pending',
         started_at = NULL
    FROM public.photo_backfill_runs run
   WHERE b.run_id = run.id
     AND run.city = 'ORCH-0957 place-photo thumbs'
     AND run.country = 'GLOBAL'
     AND run.status = 'running'
     AND b.status = 'running'
     AND (b.started_at IS NULL OR b.started_at < now() - interval '3 minutes');
  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  IF reclaimed > 0 THEN
    RAISE NOTICE 'tg_kick_pending_thumb_backfill: reclaimed % orphaned running batch(es) → pending', reclaimed;
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
  'ORCH-1043 + ORCH-1044: pg_cron-driven thumbnail-backfill kicker (every 10 min). (c) ORCH-1044 reclaims orphaned ''running'' batches (started_at > 3 min old, no terminal write) back to ''pending'' so a 546/timeout/clobber mid-batch self-heals — runs BEFORE (a)/(b); (a) HTTP-POSTs ensure_auto_run to create+drive a global servable thumbs run when a backlog exists; (b) re-kicks any running thumbs run with a stale (>5 min) or absent heartbeat. Service role key from vault; skips silently with RAISE NOTICE when absent. Mirrors tg_kick_pending_trial_runs.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference (operator runs if needed) — restores the ORCH-1043 body
-- WITHOUT step (c). The cron schedule + last_heartbeat_at column are owned by
-- 20260815000000 and are NOT touched here.
--   (re-apply 20260815000000_orch_1043_thumb_backfill_cron.sql section 3 only)
-- ─────────────────────────────────────────────────────────────────────────
