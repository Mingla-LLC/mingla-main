-- ORCH-1187 — reconcile-stuck-checkouts safety-net cron (belt-and-suspenders).
--
-- The P0 (paid ticket_checkout_sessions left at `processing_payment`, never
-- finalized) was ROOT-fixed by re-subscribing the Connect webhook to
-- payment_intent.succeeded. This cron is the defense-in-depth net: it runs the
-- existing `reconcile-stuck-checkouts` edge function every 15 minutes so ANY
-- future stuck session auto-recovers within minutes rather than waiting on a
-- manual re-run. The edge function is idempotent (biz_ticket_checkout_finalize
-- skips already-completed sessions), so repeated runs are safe.
--
-- Auth — the service-role bearer is sourced SECURELY from Supabase Vault
-- (vault.decrypted_secrets), the established pattern in THIS repo:
--   • supabase/migrations/20260610000001_tr3_cron_use_vault_secrets.sql
--   • supabase/migrations/20261112000001_orch_1161_subc_reminders_cron.sql
-- It reads the secrets named `supabase_url` and `service_role_key`. The
-- service-role key is NEVER hardcoded in this migration. The reconcile edge
-- function authorizes on `auth.includes(SERVICE_ROLE_KEY)`, so the bearer must
-- be the project service-role key (which is what vault `service_role_key` holds).
--
-- OPERATOR PRE-FLIGHT (apply-time): the production Supabase project MUST already
-- have these two Vault secrets (Dashboard → Project Settings → Vault):
--   • `supabase_url`      = https://gqnoajqerqhnvulmnyvv.supabase.co
--   • `service_role_key`  = the project service-role key
-- These already back the existing reminder/installment crons, so they should be
-- present. The pre-flight below emits a NOTICE (not an EXCEPTION) when missing so
-- the migration still applies cleanly on a fresh CI Postgres (no Vault) AND on
-- prod — a missing secret surfaces as a clear log entry at the next cron run.
--
-- Idempotent — safe to re-run (unschedule-if-present, then schedule).

-- =============================================================
-- §1. Extension + Vault pre-flight (advisory NOTICEs only — CI-safe).
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'ORCH-1187 advisory: vault schema not present. The reconcile cron will register but its http_post calls will fail at runtime until Supabase Vault is configured.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'ORCH-1187 advisory: vault.decrypted_secrets row "supabase_url" missing. The reconcile cron will register but http_post calls will fail at runtime until the operator creates it.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'ORCH-1187 advisory: vault.decrypted_secrets row "service_role_key" missing. The reconcile cron will register but http_post calls will fail at runtime until the operator creates it.';
  END IF;
END$$;

-- =============================================================
-- §2. Idempotent re-schedule (unschedule if present, then schedule).
-- =============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1187_reconcile_stuck_checkouts'
  ) THEN
    PERFORM cron.unschedule('orch_1187_reconcile_stuck_checkouts');
  END IF;
END$$;

-- =============================================================
-- §3. Schedule reconcile-stuck-checkouts every 15 minutes.
--     The url is built from vault `supabase_url`; the project host is
--     gqnoajqerqhnvulmnyvv.supabase.co (the secret holds the full base URL).
-- =============================================================
SELECT cron.schedule(
  'orch_1187_reconcile_stuck_checkouts',
  '*/15 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/reconcile-stuck-checkouts',
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
-- §4. Verification probes (the cron job presence + cadence are this migration's
--     own output → hard EXCEPTION; the Vault secrets are an operator dependency
--     → NOTICE only, see §1).
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1187_reconcile_stuck_checkouts'
  ) THEN
    RAISE EXCEPTION 'ORCH-1187 probe failed: reconcile cron job not registered after schedule call';
  END IF;
END$$;

DO $$
DECLARE
  v_schedule text;
BEGIN
  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'orch_1187_reconcile_stuck_checkouts'
   LIMIT 1;
  IF v_schedule IS DISTINCT FROM '*/15 * * * *' THEN
    RAISE EXCEPTION 'ORCH-1187 probe failed: reconcile cron schedule is % but expected */15 * * * *', v_schedule;
  END IF;
END$$;
