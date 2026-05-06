-- ─────────────────────────────────────────────────────────────────────────
-- ORCH-0737 v3 patch (post-smoke 2026-05-06): cron filter cancelling fix
-- ─────────────────────────────────────────────────────────────────────────
-- Surfaced when operator clicked Cancel on stuck Cary run; UI sat at
-- "cancelling" for 5+ min. Root cause: tg_kick_pending_trial_runs filter
-- `WHERE status = 'running'` excludes runs in `cancelling` state. Worker
-- never gets kicked → never observes cancel signal → never finalizes.
--
-- Fix: include 'cancelling' in the WHERE so worker gets one more kick to
-- run the v2-patch cancellation cleanup branch (which marks parent
-- 'cancelled' + children pending+running 'cancelled') and finalize.
--
-- Note: once parent flips to 'cancelled' (terminal), this filter excludes
-- the run permanently. So 'cancelling' is a transitional state visited at
-- most once per run.
--
-- This migration only CREATE OR REPLACE's the function. Cron schedule
-- (jobid 15, every 1 min) is untouched. Function replacement is atomic;
-- in-flight cron tick uses old definition until commit, next tick uses new.
--
-- Spec: SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md §3.1 step 2 (cancel
-- branch already correct; just needs to be reachable).
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  worker_url text;
  service_key text;
BEGIN
  worker_url := 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-place-intelligence-trial';

  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  IF service_key IS NULL THEN
    RAISE NOTICE 'tg_kick_pending_trial_runs: service_role_key not in vault, skipping tick';
    RETURN;
  END IF;

  -- v3 patch: WHERE widened from `status = 'running'` to include 'cancelling'.
  -- Without this, runs that flip to 'cancelling' never get kicked again →
  -- worker never executes the cancel-cleanup branch → UI stuck forever.
  -- 'cancelling' is transitional (worker finalizes to 'cancelled' on first
  -- kick after observe), so this only fires at most once per run.
  FOR r IN
    SELECT id FROM public.place_intelligence_runs
    WHERE status IN ('running', 'cancelling')
      AND processed_count < total_count
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds')
    ORDER BY created_at ASC                                         -- oldest first
    LIMIT 5
  LOOP
    PERFORM net.http_post(
      url := worker_url,
      body := jsonb_build_object(
        'action', 'process_chunk',
        'run_id', r.id
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      )
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tg_kick_pending_trial_runs IS
  'ORCH-0737 (DEC-111 reserved): pg_cron-driven kicker. v3 patch 2026-05-06: filter widened from status=''running'' to status IN (''running'',''cancelling'') so worker can observe cancel signal and finalize the transition. Every 1 min: picks up to 5 active runs (running OR cancelling) with stale heartbeat (>90s) and HTTP-POSTs the worker edge fn via pg_net. Service role key fetched from vault.decrypted_secrets; if missing, function skips silently (RAISE NOTICE only).';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference (if v3 needs to be reverted):
--   BEGIN;
--   <re-apply the v1 function definition from
--    20260506000001_orch_0737_async_trial_runs.sql lines 171-225 verbatim
--    — same body but WHERE status = 'running'>
--   COMMIT;
-- (Cron schedule untouched; rollback only restores the older function body.)
-- ─────────────────────────────────────────────────────────────────────────
