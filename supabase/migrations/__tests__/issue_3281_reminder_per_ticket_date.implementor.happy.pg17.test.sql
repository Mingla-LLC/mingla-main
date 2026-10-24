-- #3281 PR6 — tip reminders enqueue joins ticket_event_dates (structural).
--
-- MINGLA-INVARIANT: I-3281-REMINDER-PER-TICKET-DATE | issue #3281 | Buyer event reminders enqueue one outbox row per admitted ticket date (ticket_event_dates), keyed by order+date+bucket, and never remind a buyer about a date their tickets do not admit.

\set ON_ERROR_STOP on
BEGIN;

DO $body$
DECLARE
  v_src text;
  v_n   int;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE oid = 'public.pg_notify_reminders_enqueue(int, text, int)'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'issue_3281_reminder_enqueue_fn_missing';
  END IF;

  IF v_src !~* 'ticket_event_dates' THEN
    RAISE EXCEPTION 'issue_3281_reminder_missing_ticket_event_dates_join';
  END IF;

  IF v_src !~* 'date_title' THEN
    RAISE EXCEPTION 'issue_3281_reminder_missing_date_title_payload';
  END IF;

  IF v_src !~* 'event_date_id' THEN
    RAISE EXCEPTION 'issue_3281_reminder_missing_event_date_id_in_key';
  END IF;

  -- Empty-data call must still succeed (parity with #1210).
  v_n := public.pg_notify_reminders_enqueue(24, '24h', 30);
  IF v_n IS NULL OR v_n < 0 THEN
    RAISE EXCEPTION 'issue_3281_reminder_24h_enqueue_bad_return_%', v_n;
  END IF;

  RAISE NOTICE 'issue_3281 reminder-per-ticket-date implementor happy PASS';
END
$body$;

ROLLBACK;
