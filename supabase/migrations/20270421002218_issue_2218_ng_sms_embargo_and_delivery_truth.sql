-- ===========================================================================
-- Issue #2218 — a Nigerian ticket buyer's confirmation text never arrived, and
-- the database recorded it as `sent` with no error.
-- ===========================================================================
-- Two facts this migration makes representable, because neither could be
-- written down before:
--
--   1. HELD. Nigerian operators refuse Termii's `generic` route 20:00-08:00 WAT
--      (https://developers.termii.com/campaign). Every NG send rides `generic`
--      because `dnd` returns 400 "Country Inactive" on this account (#1518,
--      pending provider activation in #1480). A confirmation bought at 06:10
--      WAT was handed to a route that cannot carry it; the provider accepted
--      it and the network never moved it. There was no status for "not sent,
--      not failed, not abandoned — waiting for 08:00", so the row said `sent`.
--
--   2. UNCONFIRMED. Nothing ever revisited a `sent` SMS. Of the seven SMS rows
--      in `notification_deliveries`, one had a `delivered_at`. An
--      accepted-then-dropped message and a delivered one were the same
--      database state, which is why a person had to notice.
--
-- NOTHING HERE IS DESTRUCTIVE. One nullable column, two widened CHECK
-- constraints, one index, one cron schedule. No existing row changes meaning:
-- `sent` still means "a provider accepted it", it simply stops being a resting
-- state once sms-delivery-reconcile runs.

-- ---------------------------------------------------------------------------
-- 1. The deferral clock.
-- ---------------------------------------------------------------------------
-- ORCH-0788's retry ladder is 2^attempt x 60s, capped at three attempts — at
-- most ~6 minutes of patience. A message held for up to twelve hours cannot be
-- expressed in it, and left to that ladder would exhaust every attempt before
-- dawn and land on `failed_terminal` having never once been offered to a
-- network. `marketing_messages` already carries exactly this column for exactly
-- this reason (ORCH-1270 quiet hours); the transactional table simply never
-- needed one until `dnd` went away.
alter table public.ticket_order_notifications
  add column if not exists next_attempt_at timestamptz;

comment on column public.ticket_order_notifications.next_attempt_at is
  'Issue #2218 — the instant a `deferred` row becomes attemptable again. Written '
  'only by the deferral path (today: the Nigerian 20:00-08:00 WAT `generic` '
  'operator embargo) and read only by notification-retry-sweeper, which honours '
  'it INSTEAD of the exponential backoff. NULL on every other status. A '
  '`deferred` row with a NULL value here is deliberately NOT swept: it means the '
  'writer failed to record when the hold ends, and re-attempting on an unknown '
  'schedule is guessing.';

-- ---------------------------------------------------------------------------
-- 2. `deferred` becomes a sayable status on both ledgers.
-- ---------------------------------------------------------------------------
-- Widening a CHECK is additive: every value that was legal stays legal, so no
-- existing writer can break. Without this the adapter's honest new outcome
-- would hit a constraint violation at runtime and the send path would throw —
-- which is why the constraint is widened in the SAME migration that ships the
-- code, and why the code must not be deployed ahead of it.
alter table public.ticket_order_notifications
  drop constraint if exists ticket_order_notifications_status_check;
alter table public.ticket_order_notifications
  add constraint ticket_order_notifications_status_check
  check (status = any (array[
    'pending'::text,
    'sending'::text,
    'sent'::text,
    'delivered'::text,
    'deferred'::text,
    'failed_retryable'::text,
    'failed_terminal'::text,
    'skipped'::text
  ]));

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status = any (array[
    'queued'::text,
    'sending'::text,
    'sent'::text,
    'delivered'::text,
    'deferred'::text,
    'undelivered'::text,
    'failed'::text,
    'suppressed'::text,
    'skipped'::text
  ]));

-- ---------------------------------------------------------------------------
-- 2b. `venue_sms_log.status` — FOUND WHILE FIXING #2218, AND ALREADY BROKEN.
-- ---------------------------------------------------------------------------
-- `send-venue-sms` has written `logSend("skipped_market_dark", …)` since #1541.
-- That value is NOT in this CHECK, and PostgREST returns the violation in
-- `{ error }` rather than throwing — and `logSend` discards it. So every
-- dark-market venue SMS since #1541 has silently failed to log: the operator
-- got their 503, and the audit row they would be reconstructed from was never
-- written. This is a PRE-EXISTING defect, not one #2218 introduces; it is fixed
-- here because #2218 adds a second value on the same path
-- (`deferred_operator_window`, the Nigerian operator embargo) and shipping a
-- third silently-dropped status would be knowingly widening a hole.
alter table public.venue_sms_log
  drop constraint if exists venue_sms_log_status_check;
alter table public.venue_sms_log
  add constraint venue_sms_log_status_check
  check (status = any (array[
    'sent'::text,
    'failed'::text,
    'skipped_opt_out'::text,
    'skipped_invalid_phone'::text,
    -- #1541: the per-market kill switch held the send back.
    'skipped_market_dark'::text,
    -- #2218: Nigerian operators are not carrying `generic` traffic right now.
    'deferred_operator_window'::text
  ]));

-- ---------------------------------------------------------------------------
-- 3. Indexes for the two sweeps.
-- ---------------------------------------------------------------------------
-- Partial, so they stay small: the overwhelming majority of rows are terminal
-- and neither sweep ever looks at them.
create index if not exists idx_ticket_notifications_deferred_due
  on public.ticket_order_notifications (next_attempt_at)
  where status = 'deferred';

create index if not exists idx_ticket_notifications_sms_unconfirmed
  on public.ticket_order_notifications (sent_at)
  where channel = 'sms' and status = 'sent' and delivered_at is null;

-- ---------------------------------------------------------------------------
-- 4. The reconciliation sweep.
-- ---------------------------------------------------------------------------
-- Every 15 minutes. Its job is that `sent` stops being somewhere a message can
-- rest forever: it asks Termii's History endpoint what became of each stale
-- send, stamps a real `delivered_at` when the provider confirms one, and
-- otherwise writes a NAMED terminal failure and emails ops. The schedule is
-- deliberately coarser than the 5-minute retry sweeper — this one is a
-- truth-check, not a delivery path, and its deadline is 45 minutes.
-- Invocation copies issue_2168_revocation_cron and issue_1221_source_refund_backstop
-- EXACTLY: net.http_post with the URL and the service-role key read from the
-- vault AT EXECUTION TIME, so this file holds no URL, no key, and cannot drift
-- from the project it is applied to. It satisfies the function's own
-- service-role auth check.
select cron.unschedule('issue_2218_sms_delivery_reconcile')
 where exists (select 1 from cron.job
                where jobname = 'issue_2218_sms_delivery_reconcile');

select cron.schedule(
  'issue_2218_sms_delivery_reconcile',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'supabase_url' limit 1)
           || '/functions/v1/sms-delivery-reconcile',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret
                                      from vault.decrypted_secrets
                                     where name = 'service_role_key' limit 1)),
    body := '{}'::jsonb);
  $cron$);
