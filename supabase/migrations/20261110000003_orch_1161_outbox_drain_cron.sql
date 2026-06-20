-- META-ORCH-1161 Sub-A (thin slice) — pg_cron schedule to drain notification_outbox.
--
-- Mirrors supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql
-- verbatim with: (1) jobname `orch_1161_notify_outbox_drain`, (2) endpoint
-- `/functions/v1/notify-outbox-drain`, (3) `* * * * *` (every minute).
--
-- The notify-outbox-drain edge fn claims pending outbox rows and POSTs each to
-- notify-dispatch v2 with the new {category_key,...} contract. The per-market
-- SMS kill-switch (SMS_LIVE_ENABLED_US, default false) lives in smsAdapter, so
-- the cron is harmless for SMS until the operator flips it.
--
-- Cross-references:
--   - SPEC:      Mingla_Artifacts/specs/SPEC_META-ORCH-1161 §5.4 / §7.2 / §11
--   - Precedent: supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql
--   - Edge fn:   supabase/functions/notify-outbox-drain/index.ts

-- =============================================================
-- §1. Extension + vault pre-flight (advisory NOTICEs only — CI-safe).
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'ORCH-1161 advisory: vault schema not present. Cron job will register but http_post calls will fail at runtime until Supabase vault is configured.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'ORCH-1161 advisory: vault.secrets row "supabase_url" missing. Cron job will register but http_post calls will fail at runtime.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'ORCH-1161 advisory: vault.secrets row "service_role_key" missing. Cron job will register but http_post calls will fail at runtime.';
  END IF;
END$$;

-- =============================================================
-- §2. Idempotent re-schedule (unschedule if present, then schedule).
-- =============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1161_notify_outbox_drain'
  ) THEN
    PERFORM cron.unschedule('orch_1161_notify_outbox_drain');
  END IF;
END$$;

-- =============================================================
-- §3. Schedule notify-outbox-drain every minute.
-- =============================================================
SELECT cron.schedule(
  'orch_1161_notify_outbox_drain',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/notify-outbox-drain',
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
-- §4. Verification probes.
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1161_notify_outbox_drain'
  ) THEN
    RAISE EXCEPTION 'ORCH-1161 probe failed: cron job not registered after schedule call';
  END IF;
END$$;

DO $$
DECLARE
  v_schedule text;
BEGIN
  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'orch_1161_notify_outbox_drain'
   LIMIT 1;
  IF v_schedule IS DISTINCT FROM '* * * * *' THEN
    RAISE EXCEPTION 'ORCH-1161 probe failed: cron job schedule is % but expected * * * * *', v_schedule;
  END IF;
END$$;
