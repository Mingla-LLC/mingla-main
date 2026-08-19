-- #2290 — schedule `brand-person-ingest-worker`. It has never had a caller.
--
-- WHAT WAS WRONG. Migration 20270305001770 (#1770, Ring 1 of #876) shipped the
-- whole ingest half in one file: `brand_person_ingest_outbox`, the four enqueue
-- triggers (`issue_1770_order_ingest`, `issue_1770_ticket_ingest`, and the RSVP
-- and reservation pairs), `biz_claim_brand_person_ingest`,
-- `biz_finish_brand_person_ingest`, and the edge function that drives them. It
-- then scheduled only the EXPORT worker
-- (`issue_1770_brand_people_export_worker`, `* * * * *`). The ingest worker was
-- deployed and ACTIVE on production at version 71 and `cron.job` held no row
-- that ever invoked it. A switch with no caller.
--
-- The production signature, read read-only on 2026-08-19: 33 rows at
-- status='pending' spanning 2026-08-17 -> 2026-08-19 (21 ticket_holder, 11
-- order, 1 event_rsvp retire), EVERY one with attempt_count = 0, locked_at IS
-- NULL and last_safe_error_code IS NULL. A worker that fails leaves attempts
-- and error codes behind; a worker that is never called leaves a pristine
-- queue. `brand_people` held 0 rows for Mingla Nigeria
-- (75e52881-c03e-41f9-9c50-1702c47dbd7c) despite 10 paid orders, every one of
-- which had its outbox row enqueued correctly.
--
-- Nothing in the ingest path branches on country, currency or payment rail, so
-- this was never Nigeria-specific: every brand on every rail has had a silently
-- empty contact book since #1770 merged.
--
-- WHY */5 AND NOT * * * * *. The sibling export worker runs every minute
-- because a human clicked "Export" and is waiting on a download; latency is the
-- product. Ingest has no such reader — the Book is a CRM surface read later, so
-- the honest requirement is "reliably drained", not "instantly drained". The
-- repo already has a tier for exactly that: `issue_1221_source_refund_backstop`
-- and `issue_2168_checkout_revocation_sweep` both run */5. Throughput is not
-- the constraint either — `biz_claim_brand_person_ingest` claims up to 100 rows
-- per invocation, so the entire 33-row backlog drains on the FIRST tick.
-- Per-row pacing already belongs to `biz_finish_brand_person_ingest` (15s
-- doubling to a 6-hour ceiling, dead at 12 attempts); cron only offers
-- opportunities, and a shorter interval would buy nothing but extra invocations
-- against an empty queue. Worst-case purchase-to-Book latency: 5 minutes.
--
-- INVOCATION. Copies `issue_1770_brand_people_export_worker` verbatim in shape
-- — net.http_post with the URL and the service-role key read from the vault. No
-- new secret and no new mechanism. The worker accepts
-- `Bearer <SUPABASE_SERVICE_ROLE_KEY>` or `Bearer <CRON_SECRET>`; the vault
-- `service_role_key` path satisfies the first.
--
-- IDEMPOTENT. Unschedule-if-exists then schedule, matching
-- 20270419002169 (#2168). #1770's bare `cron.schedule` was not re-appliable;
-- this one is.
--
-- NO BACKFILL SHIPS HERE, DELIBERATELY. Verified read-only against production:
-- 0 paid orders lack an outbox row, and all 33 pending rows already satisfy
-- next_attempt_at <= now(). The backlog is due the moment a caller exists and
-- drains itself. A backfill script would be a second writer for a queue that
-- has no gap.

BEGIN;

DO $block$
BEGIN
  IF to_regnamespace('cron') IS NULL
     OR to_regnamespace('net') IS NULL
     OR to_regnamespace('vault') IS NULL THEN
    RAISE EXCEPTION 'issue_2290_ingest_worker_dependencies_missing';
  END IF;
  -- Advisory only, never fatal: the job must register even on an environment
  -- whose vault is not seeded, exactly as #1770 treated the export worker.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'issue-2290 advisory: vault.decrypted_secrets row "supabase_url" missing. The Brand People ingest cron will register but its http_post calls will fail until the operator creates it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'issue-2290 advisory: vault.decrypted_secrets row "service_role_key" missing. The Brand People ingest cron will register but its http_post calls will fail until the operator creates it.';
  END IF;
END;
$block$;

SELECT cron.unschedule('issue_2290_brand_person_ingest_worker')
 WHERE EXISTS (SELECT 1 FROM cron.job
                WHERE jobname = 'issue_2290_brand_person_ingest_worker');

SELECT cron.schedule(
  'issue_2290_brand_person_ingest_worker',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)
        || '/functions/v1/brand-person-ingest-worker',
      headers := jsonb_build_object(
        'authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1),
        'content-type','application/json'
      ),
      body := '{}'::jsonb
    );
  $cron$
);

COMMIT;
