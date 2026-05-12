-- ORCH-0788 — pg_cron schedule for buyer notification retry sweeper.
--
-- Substrate Option A from SPEC §8.2: pg_cron + pg_net schedule the
-- `notification-retry-sweeper` edge function every 5 minutes. Verified
-- 2026-05-11 via `mcp__supabase__list_extensions`: pg_cron 1.6.4 (in
-- pg_catalog) and pg_net 0.19.5 (in public) are both installed on the
-- linked Supabase project.
--
-- The sweeper picks up `ticket_order_notifications` rows in
-- status='failed_retryable' that have exceeded their backoff window
-- (2^attempt_count × 60s since updated_at) and re-dispatches their
-- orders via the dispatcher. Bounded batch size 50.
--
-- Cross-references:
--   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md §4.2 + §8
--   - Edge fn: supabase/functions/notification-retry-sweeper/index.ts
--   - Invariant promoted on close: I-PROPOSED-BA NOTIFICATION_TEMPLATE_KEY_DISPATCHED

-- =============================================================
-- §1. Extension pre-flight probes
-- =============================================================
-- Loud failure if either extension is missing — operator must enable via
-- Supabase dashboard before this migration applies.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE EXCEPTION 'ORCH-0788: pg_cron extension required but not enabled. Operator must enable via Supabase dashboard (Database → Extensions → pg_cron) before re-running this migration.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) THEN
    RAISE EXCEPTION 'ORCH-0788: pg_net extension required but not enabled. Operator must enable via Supabase dashboard (Database → Extensions → pg_net) before re-running this migration.';
  END IF;
  -- Vault secret pre-flight: the cron job body reads these by name. If
  -- absent, http_post fails silently at every tick and rows stay stuck.
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_url') THEN
    RAISE EXCEPTION 'ORCH-0788: vault.secrets row "supabase_url" missing. Run: INSERT INTO vault.secrets (name, secret) VALUES (''supabase_url'', ''https://gqnoajqerqhnvulmnyvv.supabase.co'') ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret; then re-push.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    RAISE EXCEPTION 'ORCH-0788: vault.secrets row "service_role_key" missing. Already-existing secret expected per prior pg_cron setup (created 2026-05-06).';
  END IF;
END$$;

-- =============================================================
-- §2. Vault secret references (Supabase pattern)
-- =============================================================
-- pg_cron jobs cannot read arbitrary env vars. The Supabase pattern is to
-- read URL + service-role key from `vault.secrets` (managed via Supabase
-- dashboard or direct INSERT).
--
-- This migration uses TWO vault secrets:
--   - 'supabase_url'      — project URL (no trailing slash)
--   - 'service_role_key'  — service-role JWT
--
-- Pre-flight on 2026-05-11 confirmed `service_role_key` already exists in
-- vault.secrets (created 2026-05-06 — reused from prior pg_cron work, no
-- need to insert again). Operator must insert `supabase_url` ONCE before
-- the cron job becomes useful:
--
--   INSERT INTO vault.secrets (name, secret)
--   VALUES ('supabase_url', 'https://gqnoajqerqhnvulmnyvv.supabase.co')
--   ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;
--
-- If `supabase_url` is missing, the cron job runs but every http_post
-- attempt fails because the URL substring is NULL. Probe §6 below checks
-- for this and surfaces the issue at migration time.

-- =============================================================
-- §3. Idempotent unschedule of any prior job with the same name
-- =============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_0788_notification_retry_sweeper'
  ) THEN
    PERFORM cron.unschedule('orch_0788_notification_retry_sweeper');
  END IF;
END$$;

-- =============================================================
-- §4. Schedule the sweeper every 5 minutes
-- =============================================================
-- Standard 5-field cron expression: `*/5 * * * *` = at minute 0, 5, 10,
-- 15, 20, 25, 30, 35, 40, 45, 50, 55 of every hour.
--
-- The job body looks up the URL + service-role key from vault.secrets and
-- fires net.http_post with a 30-second timeout. Failures within the job
-- body are recorded in cron.job_run_details (visible via SQL).

SELECT cron.schedule(
  'orch_0788_notification_retry_sweeper',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/notification-retry-sweeper',
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
-- §5. Verification probes
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_0788_notification_retry_sweeper'
  ) THEN
    RAISE EXCEPTION 'ORCH-0788 probe failed: cron job not registered after schedule call';
  END IF;
END$$;

DO $$
DECLARE
  v_schedule text;
BEGIN
  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'orch_0788_notification_retry_sweeper'
   LIMIT 1;
  IF v_schedule IS DISTINCT FROM '*/5 * * * *' THEN
    RAISE EXCEPTION 'ORCH-0788 probe failed: cron job schedule is % but expected */5 * * * *', v_schedule;
  END IF;
END$$;

COMMENT ON EXTENSION pg_cron IS
  'pg_cron schedules the orch_0788_notification_retry_sweeper job that retries failed_retryable rows in ticket_order_notifications. See supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql and Mingla_Artifacts/specs/SPEC_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md §4.2.';
