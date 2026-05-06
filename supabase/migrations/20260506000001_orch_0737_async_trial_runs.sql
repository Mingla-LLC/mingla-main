-- ─────────────────────────────────────────────────────────────────────────
-- ORCH-0737: Full-city async trial mode (v2 — RLS policy fixed via email join)
-- ─────────────────────────────────────────────────────────────────────────
-- Per DEC-111 (logged at ORCH-0737 CLOSE):
--   * NEW table place_intelligence_runs (run-level parent)
--   * FK on place_intelligence_trial_runs.parent_run_id → place_intelligence_runs(id)
--   * pg_cron job kick_pending_trial_runs (* * * * *)
--   * tg_kick_pending_trial_runs() trigger fn invoking edge fn via pg_net
--   * lock_run_for_chunk() + increment_run_counters() RPCs for worker
--   * Unique partial index: one running/cancelling run per city
--   * RLS policy joining auth.users → admin_users by email (v2 fix per orchestrator
--     REVIEW 2026-05-06; v1 incorrectly assumed admin_users.id = auth.uid(), but
--     they are different UUIDs — verified live SQL probe)
--   * One-time orphan cleanup: 79 stranded pending rows from pre-async era
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md §2
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. NEW TABLE place_intelligence_runs (run-level parent) ──────────────

CREATE TABLE IF NOT EXISTS public.place_intelligence_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id         uuid NOT NULL REFERENCES public.seeding_cities(id) ON DELETE RESTRICT,
  city_name       text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('sample','full_city')),
  sample_size     integer,
  total_count     integer NOT NULL,
  processed_count integer NOT NULL DEFAULT 0,
  succeeded_count integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','cancelling','cancelled','complete','failed')),
  cost_so_far_usd numeric(10,4) NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10,4) NOT NULL,
  estimated_minutes integer NOT NULL,
  prompt_version  text NOT NULL,
  model           text NOT NULL,
  started_by      uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  cancelled_by    uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  error_reason    text,
  last_heartbeat_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,

  CONSTRAINT chk_sample_size_consistency CHECK (
    (mode = 'sample' AND sample_size IS NOT NULL)
    OR (mode = 'full_city' AND sample_size IS NULL)
  )
);

COMMENT ON TABLE public.place_intelligence_runs IS
  'ORCH-0737 (DEC-111): run-level parent. Children are place_intelligence_trial_runs rows linked via parent_run_id FK. Status state machine: pending -> running -> (cancelling -> cancelled) | (complete) | (failed). last_heartbeat_at is updated by worker chunks; pg_cron job re-kicks workers when heartbeat is stale (>90s).';

-- ─── 2. UNIQUE PARTIAL INDEX: one running/cancelling run per city ────────

CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_running_run_per_city
  ON public.place_intelligence_runs (city_id)
  WHERE status IN ('pending','running','cancelling');

-- ─── 3. INDEX for pg_cron pickup (status + stale heartbeat) ──────────────

CREATE INDEX IF NOT EXISTS idx_runs_active_for_cron
  ON public.place_intelligence_runs (status, last_heartbeat_at)
  WHERE status = 'running';

-- ─── 4. RLS: only active admin_users (v2 PATCHED — joins through email) ──

ALTER TABLE public.place_intelligence_runs ENABLE ROW LEVEL SECURITY;

-- v2 fix: admin_users.id ≠ auth.users.id in this database (verified via live
-- SQL probe 2026-05-06). admin_users is keyed by email per established
-- convention. Policy must join through auth.users to resolve the email-to-uid
-- mapping. Service-role writes bypass RLS automatically (standard PostgreSQL
-- behavior); applies to worker edge fn calls.
CREATE POLICY admin_full_access ON public.place_intelligence_runs
  USING (
    EXISTS (
      SELECT 1
      FROM auth.users u
      JOIN public.admin_users au ON au.email = u.email
      WHERE u.id = auth.uid()
        AND au.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM auth.users u
      JOIN public.admin_users au ON au.email = u.email
      WHERE u.id = auth.uid()
        AND au.status = 'active'
    )
  );

-- ─── 5. ADD parent_run_id FK to existing per-place table ──────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES public.place_intelligence_runs(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.place_intelligence_trial_runs.parent_run_id IS
  'ORCH-0737: FK to place_intelligence_runs(id). Pre-ORCH-0737 rows have NULL (no parent row exists for those — historical audit). Post-ORCH-0737 new rows MUST have parent_run_id set; child rows cascade-delete with parent.';

-- ─── 6. RPC: lock_run_for_chunk(p_run_id) — exclusive worker pickup ──────

CREATE OR REPLACE FUNCTION public.lock_run_for_chunk(p_run_id uuid)
RETURNS public.place_intelligence_runs
LANGUAGE plpgsql
AS $$
DECLARE
  r public.place_intelligence_runs;
BEGIN
  SELECT * INTO r FROM public.place_intelligence_runs
    WHERE id = p_run_id
    FOR UPDATE NOWAIT;
  RETURN r;
END;
$$;

COMMENT ON FUNCTION public.lock_run_for_chunk IS
  'ORCH-0737: worker exclusive-lock helper. Returns the run row holding a row-level lock until end-of-transaction. NOWAIT means a concurrent worker hits 23P01/55P03 → returns "concurrent_worker" instead of waiting.';

-- ─── 7. RPC: increment_run_counters(...) — atomic counter bump ───────────

CREATE OR REPLACE FUNCTION public.increment_run_counters(
  p_run_id uuid,
  p_processed int,
  p_succeeded int,
  p_failed int,
  p_cost numeric
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.place_intelligence_runs
  SET processed_count = processed_count + p_processed,
      succeeded_count = succeeded_count + p_succeeded,
      failed_count    = failed_count + p_failed,
      cost_so_far_usd = cost_so_far_usd + p_cost
  WHERE id = p_run_id;
END;
$$;

COMMENT ON FUNCTION public.increment_run_counters IS
  'ORCH-0737: atomic counter bump for worker chunks. Avoids read-modify-write race in worker code path.';

-- ─── 8. pg_cron job: kick_pending_trial_runs ─────────────────────────────

DO $cron_setup$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'kick_pending_trial_runs';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'kick_pending_trial_runs',
    '* * * * *',                                                   -- every 1 minute
    $job$ SELECT public.tg_kick_pending_trial_runs(); $job$
  );
END;
$cron_setup$;

-- ─── 9. Trigger function: tg_kick_pending_trial_runs() ───────────────────

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

  -- Fetch service_role_key from vault. Operator must set this secret pre-deploy:
  --   SELECT vault.create_secret('eyJ...', 'service_role_key');
  -- If not set, function silently skips (next cron tick retries; no error spam).
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  IF service_key IS NULL THEN
    RAISE NOTICE 'tg_kick_pending_trial_runs: service_role_key not in vault, skipping tick';
    RETURN;
  END IF;

  -- Pick up to 5 runs needing a kick (max 5 concurrent runs)
  FOR r IN
    SELECT id FROM public.place_intelligence_runs
    WHERE status = 'running'
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
  'ORCH-0737 (DEC-111): pg_cron-driven kicker. Every 1 min: picks up to 5 active runs with stale heartbeat (>90s) and HTTP-POSTs the worker edge fn via pg_net. Service role key is fetched from vault. If vault key missing, function skips silently (RAISE NOTICE only).';

-- ─── 10. ONE-TIME DATA CLEANUP: orphaned pending rows from pre-ORCH-0737 ─
-- Per Investigation D-1: ~79 rows with status=pending + started_at IS NULL +
-- created_at < ORCH-0737 deploy. These have no parent_run_id and no client
-- driver. Mark them cancelled with a clear audit reason. Idempotent via
-- 1-minute creation-time guard against in-flight inserts.

UPDATE public.place_intelligence_trial_runs
SET status = 'cancelled',
    error_message = 'ORCH-0737 cleanup: orphaned pending row from pre-async era',
    completed_at = now()
WHERE status = 'pending'
  AND started_at IS NULL
  AND parent_run_id IS NULL
  AND created_at < now() - interval '1 minute';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference (operator runs if needed):
--   BEGIN;
--     SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='kick_pending_trial_runs';
--     DROP FUNCTION IF EXISTS public.tg_kick_pending_trial_runs();
--     DROP FUNCTION IF EXISTS public.increment_run_counters(uuid, int, int, int, numeric);
--     DROP FUNCTION IF EXISTS public.lock_run_for_chunk(uuid);
--     ALTER TABLE public.place_intelligence_trial_runs DROP COLUMN IF EXISTS parent_run_id;
--     DROP TABLE IF EXISTS public.place_intelligence_runs CASCADE;
--   COMMIT;
-- (Orphaned-row cleanup is NOT reversed; those rows stay 'cancelled' as they were
--  already broken pre-ORCH-0737.)
-- ─────────────────────────────────────────────────────────────────────────
