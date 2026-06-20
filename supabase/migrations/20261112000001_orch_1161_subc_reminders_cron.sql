-- META-ORCH-1161 Sub-C "b" — pg_cron schedule for notify-reminders (~every 15 min).
--
-- Mirrors supabase/migrations/20261110000003_orch_1161_outbox_drain_cron.sql with:
--   (1) jobname `orch_1161_notify_reminders`,
--   (2) endpoint `/functions/v1/notify-reminders`,
--   (3) `*/15 * * * *` (every 15 minutes, SPEC §7.3).
--
-- notify-reminders calls pg_notify_reminders_enqueue() per lead bucket; the rows it
-- enqueues are drained by the existing 1-min orch_1161_notify_outbox_drain cron, so
-- reminders ride the proven simultaneous-send + SMS kill-switch path.
--
-- Cross-refs:
--   SPEC:      Mingla_Artifacts/specs/SPEC_META-ORCH-1161 §7.3 / §11
--   Precedent: supabase/migrations/20261110000003_orch_1161_outbox_drain_cron.sql
--   Edge fn:   supabase/functions/notify-reminders/index.ts

-- =============================================================
-- §1. Extension + vault pre-flight (advisory NOTICEs only — CI-safe).
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'ORCH-1161 advisory: vault schema not present. Reminder cron will register but http_post calls will fail at runtime until Supabase vault is configured.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'ORCH-1161 advisory: vault.secrets row "supabase_url" missing. Reminder cron will register but http_post calls will fail at runtime.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'ORCH-1161 advisory: vault.secrets row "service_role_key" missing. Reminder cron will register but http_post calls will fail at runtime.';
  END IF;
END$$;

-- =============================================================
-- §2. Idempotent re-schedule (unschedule if present, then schedule).
-- =============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1161_notify_reminders'
  ) THEN
    PERFORM cron.unschedule('orch_1161_notify_reminders');
  END IF;
END$$;

-- =============================================================
-- §3. Schedule notify-reminders every 15 minutes.
-- =============================================================
SELECT cron.schedule(
  'orch_1161_notify_reminders',
  '*/15 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/notify-reminders',
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
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1161_notify_reminders'
  ) THEN
    RAISE EXCEPTION 'ORCH-1161 probe failed: reminder cron job not registered after schedule call';
  END IF;
END$$;

DO $$
DECLARE
  v_schedule text;
BEGIN
  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'orch_1161_notify_reminders'
   LIMIT 1;
  IF v_schedule IS DISTINCT FROM '*/15 * * * *' THEN
    RAISE EXCEPTION 'ORCH-1161 probe failed: reminder cron schedule is % but expected */15 * * * *', v_schedule;
  END IF;
END$$;
