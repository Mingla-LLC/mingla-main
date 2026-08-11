-- ===========================================================================
-- Issue #1791 — the escalation ladder's clock (SPEC #1788 P-55, DESIGN D-7).
--
-- Substrate is the shipped house family: pg_cron + pg_net firing an edge
-- function, exactly as `orch_0788_notification_retry_sweeper` does every 5
-- minutes (20260527000000_orch_0788_notification_retry_cron.sql:104) and
-- `reconcile-stuck-checkouts` does every 15
-- (20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql:1-6).
--
-- WHY EVERY MINUTE AND NOT EVERY FIVE, stated rather than assumed: the ladder's
-- first rung is T+2min. On a 5-minute cron that rung would arrive at T+5 and
-- the T+5 rung at T+10, collapsing a three-step ladder into two late steps —
-- the exact "a guest waits while nobody looks" failure the phase exists to
-- prevent. The work per tick is one indexed partial scan
-- (venue_orders_unacked_idx) that returns zero rows on a quiet venue, so the
-- cost of the extra ticks is a no-op query, and the benefit is a ladder that
-- keeps the timings the design promised.
--
-- WHAT THE SWEEP MAY DO: send pushes and write durable in-app notification
-- rows. That is all. It never refunds (D-7a), never cancels, never pauses a
-- venue's ordering (D-7b), never sends an SMS (D-7c), and never writes
-- venue_ordering_settings. Those prohibitions are enforced in three places:
-- the scan RPC's write surface, the edge function's code, and the strict-grep
-- gate `issue-1791-pause-and-escalation-single-writer.mjs`.
--
-- MONOTONIC VERSION: 20270316001791 > 20270315001791 (this phase's schema).
-- DO NOT run `supabase db push`.
-- ===========================================================================

-- =============================================================
-- §1. Extension pre-flight (the ORCH-0788 shape).
-- pg_cron is a DDL-time requirement (cron.schedule below needs it). pg_net and
-- the vault secrets are RUNTIME requirements only, so they are a NOTICE — this
-- migration must still apply on the CI baseline database, which carries vault
-- but no seeded secrets.
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'Issue #1791: pg_cron extension required but not enabled. Enable it (Database -> Extensions -> pg_cron) before re-running this migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Issue #1791: pg_net is not enabled. The escalation sweep job body will no-op until it is.';
  END IF;
END$$;

-- =============================================================
-- §2. Idempotent re-schedule.
-- =============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'issue_1791_venue_order_escalation_sweep'
  ) THEN
    PERFORM cron.unschedule('issue_1791_venue_order_escalation_sweep');
  END IF;
END$$;

-- =============================================================
-- §3. Every minute.
-- =============================================================
SELECT cron.schedule(
  'issue_1791_venue_order_escalation_sweep',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/venue-order-escalation-sweep',
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
