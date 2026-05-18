-- ORCH-0869 [Tr3 Installment Payments] — Stage 1 patch.
--
-- The Stage 1 migration (20260610000000_tr3_installments.sql) scheduled
-- the cron job using `current_setting('app.settings.supabase_url')` +
-- `current_setting('app.settings.supabase_service_role_key')`. Those
-- GUCs are NOT set on this Supabase project — the standard pattern here
-- is `vault.decrypted_secrets` (verified 2026-05-17: vault.decrypted_secrets
-- contains entries named 'supabase_url' and 'service_role_key').
--
-- This patch: unschedule the broken cron job and re-schedule with a
-- command that reads from vault.decrypted_secrets. Same 6-hour cadence.
-- Same target edge function.
--
-- Idempotent — safe to re-run.

BEGIN;

-- Unschedule the broken cron job (silently no-ops if not present).
SELECT cron.unschedule('orch-0869-process-scheduled-installments')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'orch-0869-process-scheduled-installments'
);

-- Re-schedule with vault-backed secrets.
SELECT cron.schedule(
  'orch-0869-process-scheduled-installments',
  '0 */6 * * *',  -- every 6 hours at minute 0
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/process-scheduled-installments',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- Self-verification probe. Vault-secret presence checks emit NOTICE rather
-- than EXCEPTION so the migration applies cleanly on a fresh CI Postgres
-- (no vault entries) AND on the production Supabase project (where the
-- secrets are present). Cron job presence MUST exist (hard EXCEPTION) since
-- that's the migration's actual output, not an operator-provided dependency.
-- If secrets are missing in production, the cron job will fail on its next
-- execution with a clear log entry — caught at runtime rather than at
-- migration-apply time.
DO $$
DECLARE
  v_job_count int;
  v_url_present boolean;
  v_key_present boolean;
BEGIN
  SELECT count(*) INTO v_job_count FROM cron.job WHERE jobname = 'orch-0869-process-scheduled-installments';
  IF v_job_count <> 1 THEN
    RAISE EXCEPTION 'ORCH-0869 cron-vault patch: expected 1 cron job, got %', v_job_count;
  END IF;

  SELECT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') INTO v_url_present;
  IF NOT v_url_present THEN
    RAISE NOTICE 'ORCH-0869 cron-vault patch: vault.decrypted_secrets missing supabase_url secret. Operator must create it (Supabase Dashboard > Project Settings > Vault > New Secret named supabase_url with the project URL value) before the next cron run, or the scheduled HTTP POST will fail.';
  END IF;

  SELECT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') INTO v_key_present;
  IF NOT v_key_present THEN
    RAISE NOTICE 'ORCH-0869 cron-vault patch: vault.decrypted_secrets missing service_role_key secret. Operator must create it before the next cron run.';
  END IF;

  IF v_url_present AND v_key_present THEN
    RAISE NOTICE 'ORCH-0869 cron-vault patch complete: cron job re-scheduled with vault.decrypted_secrets (supabase_url + service_role_key both present).';
  ELSE
    RAISE NOTICE 'ORCH-0869 cron-vault patch complete: cron job re-scheduled. WARNING — required vault secrets not present in this database. Cron will fail at next execution until operator creates them.';
  END IF;
END $$;

COMMIT;
