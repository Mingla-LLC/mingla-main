-- ORCH-0815-B — pg_cron schedule for marketing-send dispatcher.
--
-- Mirrors `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql`
-- verbatim with: (1) jobname swapped to `orch_0815_b_marketing_send`,
-- (2) schedule tightened to `* * * * *` (every minute — SPEC §8 + Open
-- Question 4), (3) endpoint swapped to `/functions/v1/marketing-send`,
-- (4) body still `'{}'::jsonb` so the function self-discovers eligible
-- campaigns (status='scheduled' AND scheduled_for <= now()).
--
-- Live-broadcast gate: the function itself reads
-- `MARKETING_SEND_LIVE_ENABLED` env-flag and short-circuits to
-- `status='preview_skipped'` writes if false. Cron is harmless until
-- operator flips the flag post-ORCH-0777.
--
-- Cross-references:
--   - SPEC:      Mingla_Artifacts/specs/SPEC_ORCH-0815_B_COMPOSER_AND_SEND.md §8
--   - Precedent: supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql
--   - Edge fn:   supabase/functions/marketing-send/index.ts
--   - Phase A:   supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql

-- =============================================================
-- §0. Atomic-claim helper for marketing-send
-- =============================================================
-- The marketing-send edge function needs `FOR UPDATE SKIP LOCKED`
-- semantics to prevent two overlapping invocations from double-processing
-- the same campaign (SPEC §7.1 + §15). PostgREST cannot express this
-- locking clause, so we expose a tiny plpgsql wrapper that performs the
-- atomic claim in one round trip.
--
-- SECURITY INVOKER (default) — never reads auth.uid(); only called by
-- service-role from marketing-send. The marketing SECURITY DEFINER ban
-- in Hard Guard §13 targets RLS-helper SECURITY DEFINER functions, not
-- this service-role-only claim helper.

CREATE OR REPLACE FUNCTION public.mkt_claim_campaigns(
  p_limit integer DEFAULT 10,
  p_campaign_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  account_id uuid,
  brand_id uuid,
  audience_id uuid,
  channel text,
  channel_payload jsonb,
  name text,
  scheduled_for timestamptz
)
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.marketing_campaigns mc
     SET status = 'sending',
         updated_at = now()
   WHERE mc.id IN (
     SELECT inner_mc.id
       FROM public.marketing_campaigns inner_mc
      WHERE inner_mc.status = 'scheduled'
        AND inner_mc.scheduled_for <= now()
        AND (p_campaign_id IS NULL OR inner_mc.id = p_campaign_id)
      ORDER BY inner_mc.scheduled_for ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING
     mc.id,
     mc.account_id,
     mc.brand_id,
     mc.audience_id,
     mc.channel,
     mc.channel_payload,
     mc.name,
     mc.scheduled_for;
END;
$$;

REVOKE ALL ON FUNCTION public.mkt_claim_campaigns(integer, uuid) FROM PUBLIC;
-- Only service-role (edge function) and superuser may execute. No GRANT
-- to authenticated — caller-facing code must never flip campaign status
-- directly.
GRANT EXECUTE ON FUNCTION public.mkt_claim_campaigns(integer, uuid)
  TO service_role;

-- =============================================================
-- §1. Extension + vault pre-flight (DDL needs pg_cron; pg_net +
--     vault are runtime requirements — surfaced as NOTICE so CI
--     baseline-apply against vanilla Postgres still passes).
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE EXCEPTION 'ORCH-0815-B: pg_cron extension required but not enabled. Operator must enable via Supabase dashboard (Database -> Extensions -> pg_cron) before re-running this migration.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) THEN
    RAISE NOTICE 'ORCH-0815-B advisory: pg_net extension not enabled. Cron job will register but http_post calls will fail at runtime until pg_net is enabled.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'ORCH-0815-B advisory: vault schema not present. Cron job will register but http_post calls will fail at runtime until Supabase vault is configured.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'ORCH-0815-B advisory: vault.secrets row "supabase_url" missing. Cron job will register but http_post calls will fail at runtime. Insert with: INSERT INTO vault.secrets (name, secret) VALUES (''supabase_url'', ''<your-project-url>'') ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'ORCH-0815-B advisory: vault.secrets row "service_role_key" missing. Cron job will register but http_post calls will fail at runtime.';
  END IF;
END$$;

-- =============================================================
-- §2. Idempotent unschedule of any prior job with the same name
-- =============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_0815_b_marketing_send'
  ) THEN
    PERFORM cron.unschedule('orch_0815_b_marketing_send');
  END IF;
END$$;

-- =============================================================
-- §3. Schedule marketing-send every minute
-- =============================================================
-- `* * * * *` = every minute. SPEC §8 + Open-Question 4 recommend
-- 1 min for Phase B; revisit if Supabase Postgres pricing flags it.
SELECT cron.schedule(
  'orch_0815_b_marketing_send',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/marketing-send',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
            FROM vault.decrypted_secrets
           WHERE name = 'service_role_key'
           LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

-- =============================================================
-- §4. Verification probes
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_0815_b_marketing_send'
  ) THEN
    RAISE EXCEPTION 'ORCH-0815-B probe failed: cron job not registered after schedule call';
  END IF;
END$$;

DO $$
DECLARE
  v_schedule text;
BEGIN
  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'orch_0815_b_marketing_send'
   LIMIT 1;
  IF v_schedule IS DISTINCT FROM '* * * * *' THEN
    RAISE EXCEPTION 'ORCH-0815-B probe failed: cron job schedule is % but expected * * * * *', v_schedule;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc
     WHERE proname = 'mkt_claim_campaigns'
       AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'ORCH-0815-B probe failed: mkt_claim_campaigns(integer, uuid) helper missing';
  END IF;
END$$;

COMMENT ON EXTENSION pg_cron IS
  'pg_cron schedules orch_0788_notification_retry_sweeper (retry sweeper, every 5 min) AND orch_0815_b_marketing_send (marketing dispatcher, every 1 min). See supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql and supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql.';
