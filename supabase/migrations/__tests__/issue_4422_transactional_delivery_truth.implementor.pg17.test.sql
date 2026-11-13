-- #4422 — held Nigerian RSVP texts and bounced transactional emails.
--
-- MINGLA-INVARIANT: I-4422-EMBARGO-HOLD-NOT-A-TRY | issue #4422 | An operator-embargo deferral of an RSVP delivery never consumes an attempt and never ends terminal before its 36-hour hold expiry; the held row is claimed again only once its window reopens.
-- MINGLA-INVARIANT: I-4422-PROVIDER-BOUNCE-NOT-SENT | issue #4422 | An RSVP or ticket email with a stored provider bounce or complaint is never left `sent` (or `delivered`), whether the event arrives after the provider id (ingest), before it (late link) or before this migration (backfill); replays change nothing and a failure in this branch never fails ingest.
--
--   SC-1/2  defer refunds the try; the held row is not due before its open
--           and is due after it; the next claim is attempt 1 again
--   SC-2    eight real retryable finishes still end failed_terminal
--   SC-3    a hold older than 36 h ends failed_terminal ng_embargo_hold_expired
--   SC-4    RSVP email: Permanent / transient / complaint codes, parent rolls
--           up to failed_terminal, replay is a no-op
--   SC-5    ticket email: sent or delivered -> failed_terminal, last_error
--   SC-6    an event stored before the delivery's provider id is applied
--           when the id lands (RSVP and ticket)
--   SC-7    Admin deliveries still answer 'admin_delivery'; an unknown id
--           keeps #2714's answer; a raising transactional branch never fails
--           ingest
--   SC-8    the unreached-guest claim returns ids and codes once
--   SC-9    the backfill function moves history out of sent
--   grants  service_role only
--
-- The migration is re-applied first so this suite always runs the current
-- bodies, whatever an earlier suite in the shared lane database left behind.
\set ON_ERROR_STOP on
\ir ../20280705004422_issue_4422_transactional_delivery_truth.sql

BEGIN;

CREATE FUNCTION pg_temp.ev(p_type text, p_email_id text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object('type', p_type, 'created_at', '2026-11-13T09:01:00.000Z',
    'data', jsonb_build_object('email_id', p_email_id, 'from', 'Mingla <tickets@usemingla.com>') || p_extra);
$fn$;

-- Fixtures: FK-safe synthetic parents. Triggers and FKs are bypassed only
-- while the rows are created; every function under test runs normally.
SET LOCAL session_replication_role = replica;
INSERT INTO public.events(id, brand_id, title, slug) VALUES
  ('44220000-0000-4000-8000-00000000e001','44220000-0000-4000-8000-00000000b001','Issue 4422 RSVP','issue-4422-rsvp'),
  ('44220000-0000-4000-8000-00000000e002','44220000-0000-4000-8000-00000000b001','Issue 4422 tickets','issue-4422-tickets');
INSERT INTO public.orders(id, event_id, buyer_phone_e164)
SELECT ('44220000-0000-4000-8000-00000000a00' || n)::uuid, '44220000-0000-4000-8000-00000000e002', '+2348000000000'
  FROM generate_series(1, 6) AS n;
INSERT INTO public.rsvp_notifications(id, event_id, status, template_key, payload, idempotency_key)
VALUES
  ('44220000-0000-4000-8000-000000000001','44220000-0000-4000-8000-00000000e001','pending','rsvp_pass','{}','i4422-hold'),
  ('44220000-0000-4000-8000-000000000002','44220000-0000-4000-8000-00000000e001','pending','rsvp_pass','{}','i4422-cap'),
  ('44220000-0000-4000-8000-000000000003','44220000-0000-4000-8000-00000000e001','pending','rsvp_pass','{}','i4422-expiry'),
  ('44220000-0000-4000-8000-000000000004','44220000-0000-4000-8000-00000000e001','sending','rsvp_pass','{}','i4422-bounce'),
  ('44220000-0000-4000-8000-000000000005','44220000-0000-4000-8000-00000000e001','sending','rsvp_pass','{}','i4422-late'),
  ('44220000-0000-4000-8000-000000000006','44220000-0000-4000-8000-00000000e001','sending','rsvp_pass','{}','i4422-backfill'),
  ('44220000-0000-4000-8000-000000000007','44220000-0000-4000-8000-00000000e001','failed_terminal','rsvp_pass','{}','i4422-unreached'),
  ('44220000-0000-4000-8000-000000000008','44220000-0000-4000-8000-00000000e001','sending','rsvp_pass','{}','i4422-owed');
INSERT INTO public.rsvp_notification_deliveries(id, notification_id, channel, is_required, status, next_attempt_at, provider_message_id, sent_at, safe_error_code)
VALUES
  ('44220000-0000-4000-8000-000000000101','44220000-0000-4000-8000-000000000001','sms',true,'pending',now()-interval '1 minute',NULL,NULL,NULL),
  ('44220000-0000-4000-8000-000000000102','44220000-0000-4000-8000-000000000001','email',true,'pending',now()+interval '1 day',NULL,NULL,NULL),
  ('44220000-0000-4000-8000-000000000201','44220000-0000-4000-8000-000000000002','sms',true,'pending',now()-interval '1 minute',NULL,NULL,NULL),
  ('44220000-0000-4000-8000-000000000301','44220000-0000-4000-8000-000000000003','sms',true,'pending',now()-interval '1 minute',NULL,NULL,NULL),
  ('44220000-0000-4000-8000-000000000401','44220000-0000-4000-8000-000000000004','email',true,'sent',now(),'re_4422_perm',now(),NULL),
  ('44220000-0000-4000-8000-000000000402','44220000-0000-4000-8000-000000000004','sms',true,'sent',now(),'tm_4422',now(),NULL),
  ('44220000-0000-4000-8000-000000000501','44220000-0000-4000-8000-000000000005','email',true,'processing',now(),NULL,NULL,NULL),
  ('44220000-0000-4000-8000-000000000601','44220000-0000-4000-8000-000000000006','email',true,'sent',now(),'re_4422_hist',now(),NULL),
  ('44220000-0000-4000-8000-000000000701','44220000-0000-4000-8000-000000000007','email',true,'failed_terminal',now(),'re_4422_x',now(),'email_bounced_permanent'),
  ('44220000-0000-4000-8000-000000000702','44220000-0000-4000-8000-000000000007','sms',true,'failed_terminal',now(),NULL,NULL,'ng_operator_embargo'),
  ('44220000-0000-4000-8000-000000000801','44220000-0000-4000-8000-000000000008','email',true,'failed_terminal',now(),NULL,NULL,'email_bounced_permanent'),
  ('44220000-0000-4000-8000-000000000802','44220000-0000-4000-8000-000000000008','sms',true,'deferred',now()+interval '9 hours',NULL,NULL,'ng_operator_embargo');
UPDATE public.rsvp_notification_deliveries SET created_at = now() - interval '37 hours'
 WHERE id = '44220000-0000-4000-8000-000000000301';
INSERT INTO public.ticket_order_notifications(id, order_id, event_id, channel, recipient, status, provider_message_id, idempotency_key, last_error)
VALUES
  ('44220000-0000-4000-8000-000000000901','44220000-0000-4000-8000-00000000a001','44220000-0000-4000-8000-00000000e002','email','t1@x.test','sent','re_4422_t_sent','i4422-t1',NULL),
  ('44220000-0000-4000-8000-000000000902','44220000-0000-4000-8000-00000000a002','44220000-0000-4000-8000-00000000e002','email','t2@x.test','delivered','re_4422_t_deliv','i4422-t2',NULL),
  ('44220000-0000-4000-8000-000000000903','44220000-0000-4000-8000-00000000a003','44220000-0000-4000-8000-00000000e002','email','t3@x.test','sending',NULL,'i4422-t3',NULL),
  ('44220000-0000-4000-8000-000000000904','44220000-0000-4000-8000-00000000a004','44220000-0000-4000-8000-00000000e002','email','t4@x.test','failed_terminal',NULL,'i4422-t4','email_bounced_permanent'),
  ('44220000-0000-4000-8000-000000000905','44220000-0000-4000-8000-00000000a004','44220000-0000-4000-8000-00000000e002','sms','+2348000000000','failed_terminal',NULL,'i4422-t5','provider_unavailable'),
  ('44220000-0000-4000-8000-000000000906','44220000-0000-4000-8000-00000000a005','44220000-0000-4000-8000-00000000e002','email','t6@x.test','failed_terminal',NULL,'i4422-t6','email_bounced_permanent'),
  ('44220000-0000-4000-8000-000000000907','44220000-0000-4000-8000-00000000a005','44220000-0000-4000-8000-00000000e002','sms','+2348000000001','sent','tm_4422_t','i4422-t7',NULL),
  ('44220000-0000-4000-8000-000000000908','44220000-0000-4000-8000-00000000a006','44220000-0000-4000-8000-00000000e002','email','t8@x.test','failed_terminal',NULL,'i4422-t8','email_bounced_permanent'),
  ('44220000-0000-4000-8000-000000000909','44220000-0000-4000-8000-00000000a006','44220000-0000-4000-8000-00000000e002','sms','+2348000000002','deferred',NULL,'i4422-t9','ng_operator_embargo');
SET LOCAL session_replication_role = origin;

-- Grants: nothing here is callable by a client.
DO $$ BEGIN
  IF has_function_privilege('authenticated','public.defer_rsvp_notification_delivery(uuid,uuid,text,timestamptz)','EXECUTE')
     OR has_function_privilege('anon','public.defer_rsvp_notification_delivery(uuid,uuid,text,timestamptz)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_4422_apply_transactional_email_event(text)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_4422_claim_unreached_guest_alerts(text,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_4422_rollup_rsvp_notification(uuid,boolean,text,integer)','EXECUTE')
     OR has_table_privilege('authenticated','public.issue_4422_unreached_guest_alerts','SELECT')
     OR has_table_privilege('anon','public.issue_4422_unreached_guest_alerts','SELECT') THEN
    RAISE EXCEPTION '4422.grants: a client role can reach a #4422 object';
  END IF;
  IF NOT has_function_privilege('service_role','public.defer_rsvp_notification_delivery(uuid,uuid,text,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION '4422.grants: service_role must be able to defer';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.issue_4422_unreached_guest_alerts'::regclass) THEN
    RAISE EXCEPTION '4422.grants: the alert ledger must have RLS on';
  END IF;
  IF pg_get_function_result('public.issue_4422_claim_unreached_guest_alerts(text,integer)'::regprocedure)
     <> 'TABLE(subject_id uuid, event_id uuid, codes text)' THEN
    RAISE EXCEPTION '4422.grants: the alert claim must return ids and codes only';
  END IF;
END $$;

-- SC-1/2: a held text is parked without spending a try.
DO $$ DECLARE c record; v_ok boolean; d record; n record; BEGIN
  SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44220000-0000-4000-8000-000000000001', 8);
  IF c.delivery_id <> '44220000-0000-4000-8000-000000000101' OR c.attempt_count <> 1 THEN
    RAISE EXCEPTION '4422.hold: expected the SMS row on attempt 1, got % / %', c.delivery_id, c.attempt_count;
  END IF;
  IF public.defer_rsvp_notification_delivery(c.delivery_id, gen_random_uuid(), 'ng_operator_embargo', now() + interval '9 hours') THEN
    RAISE EXCEPTION '4422.hold: a wrong lease must not defer';
  END IF;
  v_ok := public.defer_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'ng_operator_embargo', now() + interval '9 hours');
  IF NOT v_ok THEN RAISE EXCEPTION '4422.hold: defer refused its own lease'; END IF;
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = c.delivery_id;
  IF d.status <> 'deferred' OR d.attempt_count <> 0 OR d.safe_error_code <> 'ng_operator_embargo'
     OR d.lease_id IS NOT NULL OR d.processing_started_at IS NOT NULL OR d.provider_io_started_at IS NOT NULL THEN
    RAISE EXCEPTION '4422.hold: deferred row malformed: % attempts=% code=%', d.status, d.attempt_count, d.safe_error_code;
  END IF;
  IF d.next_attempt_at < now() + interval '9 hours' OR d.next_attempt_at > now() + interval '9 hours 121 seconds' THEN
    RAISE EXCEPTION '4422.hold: next_attempt_at must be the window open plus 0..120 s jitter, got %', d.next_attempt_at;
  END IF;
  SELECT * INTO n FROM public.rsvp_notifications WHERE id = '44220000-0000-4000-8000-000000000001';
  IF n.status <> 'sending' OR n.last_error <> 'ng_operator_embargo' THEN
    RAISE EXCEPTION '4422.hold: a held child is still owed, parent must be sending, got % %', n.status, n.last_error;
  END IF;
  -- Before the window reopens: nothing is due.
  IF EXISTS (SELECT 1 FROM public.claim_rsvp_notification_deliveries('44220000-0000-4000-8000-000000000001', 8)) THEN
    RAISE EXCEPTION '4422.hold: a held row was claimed before its window reopened';
  END IF;
  -- The window reopens (08:00 WAT): the row is due and is attempt 1 again.
  UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = c.delivery_id;
  SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44220000-0000-4000-8000-000000000001', 8);
  IF c.delivery_id IS DISTINCT FROM '44220000-0000-4000-8000-000000000101'::uuid OR c.attempt_count <> 1 THEN
    RAISE EXCEPTION '4422.hold: after the open the held row must be claimed on attempt 1, got % / %', c.delivery_id, c.attempt_count;
  END IF;
  PERFORM public.finish_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'sent', 'tm_ok', NULL);
  IF (SELECT status FROM public.rsvp_notification_deliveries WHERE id = c.delivery_id) <> 'sent' THEN
    RAISE EXCEPTION '4422.hold: the held text must end sent';
  END IF;
  -- An absent instant still parks (15 min), never in the past, never past 13 h.
  UPDATE public.rsvp_notification_deliveries SET status = 'pending', next_attempt_at = now() - interval '1 second'
   WHERE id = '44220000-0000-4000-8000-000000000102';
  SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44220000-0000-4000-8000-000000000001', 8);
  PERFORM public.defer_rsvp_notification_delivery(c.delivery_id, c.lease_id, NULL, now() + interval '3 days');
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = c.delivery_id;
  IF d.next_attempt_at > now() + interval '13 hours 121 seconds' OR d.safe_error_code <> 'ng_operator_embargo' THEN
    RAISE EXCEPTION '4422.hold: the hold must be capped at 13 h with the default code, got % %', d.next_attempt_at, d.safe_error_code;
  END IF;
END $$;

-- SC-2: the cap of 8 still ends real failures.
DO $$ DECLARE c record; i integer; d record; BEGIN
  FOR i IN 1..8 LOOP
    UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now() - interval '1 second'
     WHERE id = '44220000-0000-4000-8000-000000000201';
    SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44220000-0000-4000-8000-000000000002', 8);
    IF c.attempt_count <> i THEN RAISE EXCEPTION '4422.cap: claim % returned attempt %', i, c.attempt_count; END IF;
    PERFORM public.finish_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'failed_retryable', NULL, 'provider_unavailable');
  END LOOP;
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = '44220000-0000-4000-8000-000000000201';
  IF d.status <> 'failed_terminal' THEN RAISE EXCEPTION '4422.cap: 8 real failures must be terminal, got %', d.status; END IF;
  IF (SELECT status FROM public.rsvp_notifications WHERE id = '44220000-0000-4000-8000-000000000002') <> 'failed_terminal' THEN
    RAISE EXCEPTION '4422.cap: parent must roll up to failed_terminal';
  END IF;
END $$;

-- SC-3: a hold cannot outlive one window plus slack.
DO $$ DECLARE c record; d record; BEGIN
  SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44220000-0000-4000-8000-000000000003', 8);
  PERFORM public.defer_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'ng_operator_embargo', now() + interval '9 hours');
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = c.delivery_id;
  IF d.status <> 'failed_terminal' OR d.safe_error_code <> 'ng_embargo_hold_expired' THEN
    RAISE EXCEPTION '4422.expiry: expected failed_terminal ng_embargo_hold_expired, got % %', d.status, d.safe_error_code;
  END IF;
END $$;

-- SC-4 / SC-5 / SC-7: bounces and complaints through the real ingest.
DO $$ DECLARE r text; d record; BEGIN
  -- Transient first: the code says so, the row leaves sent.
  r := public.mkt_ingest_email_event('i4422_b1','email.bounced','re_4422_perm',
         pg_temp.ev('email.bounced','re_4422_perm','{"bounce":{"type":"Transient"}}'));
  IF r <> 'transactional_delivery' THEN RAISE EXCEPTION '4422.bounce: expected transactional_delivery, got %', r; END IF;
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = '44220000-0000-4000-8000-000000000401';
  IF d.status <> 'failed_terminal' OR d.safe_error_code <> 'email_bounced_transient' OR d.sent_at IS NULL THEN
    RAISE EXCEPTION '4422.bounce: RSVP email must be failed_terminal email_bounced_transient with sent_at kept, got % % %', d.status, d.safe_error_code, d.sent_at;
  END IF;
  IF (SELECT status FROM public.rsvp_notifications WHERE id = '44220000-0000-4000-8000-000000000004') <> 'failed_terminal' THEN
    RAISE EXCEPTION '4422.bounce: the parent must roll up to failed_terminal';
  END IF;
  -- Replay: nothing changes, no error.
  r := public.mkt_ingest_email_event('i4422_b1','email.bounced','re_4422_perm',
         pg_temp.ev('email.bounced','re_4422_perm','{"bounce":{"type":"Transient"}}'));
  IF (SELECT safe_error_code FROM public.rsvp_notification_deliveries WHERE id = '44220000-0000-4000-8000-000000000401') <> 'email_bounced_transient' THEN
    RAISE EXCEPTION '4422.bounce: replay changed the row';
  END IF;

  -- Ticket: Permanent on a sent email, complaint on a delivered one.
  r := public.mkt_ingest_email_event('i4422_t1','email.bounced','re_4422_t_sent',
         pg_temp.ev('email.bounced','re_4422_t_sent','{"bounce":{"type":"Permanent"}}'));
  IF r <> 'transactional_delivery' THEN RAISE EXCEPTION '4422.ticket: expected transactional_delivery, got %', r; END IF;
  IF (SELECT status || '/' || last_error FROM public.ticket_order_notifications WHERE id = '44220000-0000-4000-8000-000000000901')
     <> 'failed_terminal/email_bounced_permanent' THEN
    RAISE EXCEPTION '4422.ticket: sent ticket email must be failed_terminal email_bounced_permanent';
  END IF;
  r := public.mkt_ingest_email_event('i4422_t2','email.complained','re_4422_t_deliv',
         pg_temp.ev('email.complained','re_4422_t_deliv'));
  IF (SELECT status || '/' || last_error FROM public.ticket_order_notifications WHERE id = '44220000-0000-4000-8000-000000000902')
     <> 'failed_terminal/email_complained' THEN
    RAISE EXCEPTION '4422.ticket: delivered ticket email must be failed_terminal email_complained';
  END IF;

  -- A non-bounce event for a transactional email changes nothing.
  r := public.mkt_ingest_email_event('i4422_o1','email.opened','re_4422_hist',
         pg_temp.ev('email.opened','re_4422_hist'));
  IF r <> 'unmatched' THEN RAISE EXCEPTION '4422.open: expected #2714''s unmatched, got %', r; END IF;
  IF (SELECT status FROM public.rsvp_notification_deliveries WHERE id = '44220000-0000-4000-8000-000000000601') <> 'sent' THEN
    RAISE EXCEPTION '4422.open: an open must not move a delivery';
  END IF;

  -- Unknown id: #2714's own answer is kept.
  r := public.mkt_ingest_email_event('i4422_u1','email.bounced','re_4422_nobody',
         pg_temp.ev('email.bounced','re_4422_nobody','{"bounce":{"type":"Permanent"}}'));
  IF r <> 'unmatched' THEN RAISE EXCEPTION '4422.unknown: expected unmatched, got %', r; END IF;
END $$;

-- SC-7: an Admin delivery still answers 'admin_delivery' and is not touched
-- by the transactional branch.
SET LOCAL session_replication_role = replica;
INSERT INTO public.admin_email_log(id, subject, body, recipient_type, status, recipient_count)
VALUES ('44220000-0000-4000-8000-00000000c001','4422','b','bulk','completed',1);
INSERT INTO public.admin_email_recipient_deliveries(id, campaign_id, recipient_email, status, provider_message_id)
VALUES ('44220000-0000-4000-8000-00000000c101','44220000-0000-4000-8000-00000000c001','a@x.test','accepted','re_4422_admin');
SET LOCAL session_replication_role = origin;
DO $$ DECLARE r text; BEGIN
  r := public.mkt_ingest_email_event('i4422_a1','email.bounced','re_4422_admin',
         pg_temp.ev('email.bounced','re_4422_admin','{"bounce":{"type":"Permanent"}}'));
  IF r <> 'admin_delivery' THEN RAISE EXCEPTION '4422.admin: expected admin_delivery, got %', r; END IF;
END $$;

-- SC-7: a transactional branch that raises never fails ingest.
SAVEPOINT broken_branch;
CREATE OR REPLACE FUNCTION public.issue_4422_apply_transactional_email_event(p_svix_id text)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'simulated_failure'; END;
$fn$;
DO $$ DECLARE r text; BEGIN
  r := public.mkt_ingest_email_event('i4422_x1','email.bounced','re_4422_hist',
         pg_temp.ev('email.bounced','re_4422_hist','{"bounce":{"type":"Permanent"}}'));
  IF r <> 'unmatched' THEN RAISE EXCEPTION '4422.isolation: ingest must still answer unmatched, got %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.marketing_email_events WHERE svix_id = 'i4422_x1') THEN
    RAISE EXCEPTION '4422.isolation: the event must still be stored';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT broken_branch;

-- SC-6: late link. The bounce is stored first; the provider id lands later.
DO $$ DECLARE r text; c record; d record; BEGIN
  r := public.mkt_ingest_email_event('i4422_l1','email.bounced','re_4422_late',
         pg_temp.ev('email.bounced','re_4422_late','{"bounce":{"type":"Permanent"}}'));
  IF r <> 'unmatched' THEN RAISE EXCEPTION '4422.late: nothing holds the id yet, expected unmatched, got %', r; END IF;
  -- rsvp-notify finishes the row with the provider id (the real finish).
  UPDATE public.rsvp_notification_deliveries SET lease_id = '44220000-0000-4000-8000-0000000000aa'
   WHERE id = '44220000-0000-4000-8000-000000000501';
  PERFORM public.finish_rsvp_notification_delivery('44220000-0000-4000-8000-000000000501',
    '44220000-0000-4000-8000-0000000000aa', 'sent', 're_4422_late', NULL);
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = '44220000-0000-4000-8000-000000000501';
  IF d.status <> 'failed_terminal' OR d.safe_error_code <> 'email_bounced_permanent' THEN
    RAISE EXCEPTION '4422.late: the early bounce must apply when the id lands, got % %', d.status, d.safe_error_code;
  END IF;
  IF (SELECT status FROM public.rsvp_notifications WHERE id = '44220000-0000-4000-8000-000000000005') <> 'failed_terminal' THEN
    RAISE EXCEPTION '4422.late: the parent must end failed_terminal, not sent';
  END IF;
  -- Ticket: the same, through the dispatcher's own UPDATE.
  r := public.mkt_ingest_email_event('i4422_l2','email.complained','re_4422_t_late',
         pg_temp.ev('email.complained','re_4422_t_late'));
  UPDATE public.ticket_order_notifications
     SET status = 'sent', provider_message_id = 're_4422_t_late', sent_at = now()
   WHERE id = '44220000-0000-4000-8000-000000000903';
  IF (SELECT status || '/' || last_error FROM public.ticket_order_notifications WHERE id = '44220000-0000-4000-8000-000000000903')
     <> 'failed_terminal/email_complained' THEN
    RAISE EXCEPTION '4422.late: the ticket complaint must apply when the id lands';
  END IF;
END $$;

-- SC-9: history. An event stored before this migration (no ingest call).
INSERT INTO public.marketing_email_events(svix_id, event_type, provider_message_id, payload, is_campaign_event)
VALUES ('i4422_h1','email.bounced','re_4422_hist',
        pg_temp.ev('email.bounced','re_4422_hist','{"bounce":{"type":"Permanent"}}'), false);
DO $$ DECLARE v jsonb; BEGIN
  v := public.issue_4422_backfill_transactional_email_events();
  IF (v->>'rsvp')::int < 1 THEN RAISE EXCEPTION '4422.backfill: expected at least one RSVP row, got %', v; END IF;
  IF (SELECT status || '/' || safe_error_code FROM public.rsvp_notification_deliveries WHERE id = '44220000-0000-4000-8000-000000000601')
     <> 'failed_terminal/email_bounced_permanent' THEN
    RAISE EXCEPTION '4422.backfill: the historic bounce must move the RSVP email out of sent';
  END IF;
  v := public.issue_4422_backfill_transactional_email_events();
  IF EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries WHERE id = '44220000-0000-4000-8000-000000000601' AND status = 'sent') THEN
    RAISE EXCEPTION '4422.backfill: a second run must change nothing';
  END IF;
END $$;

-- SC-8: an unreached guest is claimed for one alert, once; a guest still
-- owed a held text is not.
DO $$ DECLARE v_rows integer; v_codes text; BEGIN
  SELECT count(*), max(codes) INTO v_rows, v_codes
    FROM public.issue_4422_claim_unreached_guest_alerts('rsvp', 200)
   WHERE subject_id = '44220000-0000-4000-8000-000000000007';
  IF v_rows <> 1 OR v_codes <> 'email_bounced_permanent,ng_operator_embargo' THEN
    RAISE EXCEPTION '4422.alert: expected one row with sorted codes, got % %', v_rows, v_codes;
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_4422_unreached_guest_alerts
              WHERE source = 'rsvp' AND subject_id = '44220000-0000-4000-8000-000000000008') THEN
    RAISE EXCEPTION '4422.alert: a guest still owed a held text must not be alerted';
  END IF;
  SELECT count(*) INTO v_rows FROM public.issue_4422_claim_unreached_guest_alerts('rsvp', 200)
   WHERE subject_id = '44220000-0000-4000-8000-000000000007';
  IF v_rows <> 0 THEN RAISE EXCEPTION '4422.alert: a second tick must not alert again'; END IF;

  SELECT count(*), max(codes) INTO v_rows, v_codes
    FROM public.issue_4422_claim_unreached_guest_alerts('ticket', 200)
   WHERE subject_id = '44220000-0000-4000-8000-00000000a004';
  IF v_rows <> 1 OR v_codes <> 'email_bounced_permanent,provider_unavailable' THEN
    RAISE EXCEPTION '4422.alert: expected one ticket order row with sorted codes, got % %', v_rows, v_codes;
  END IF;
  -- An order with a sent channel, or a held text still owed, is never claimed.
  IF EXISTS (SELECT 1 FROM public.issue_4422_unreached_guest_alerts
              WHERE source = 'ticket' AND subject_id IN ('44220000-0000-4000-8000-00000000a005',
                                                         '44220000-0000-4000-8000-00000000a006')) THEN
    RAISE EXCEPTION '4422.alert: an order that reached the buyer or still owes a text must not be alerted';
  END IF;
  SELECT count(*) INTO v_rows FROM public.issue_4422_claim_unreached_guest_alerts('ticket', 200)
   WHERE subject_id = '44220000-0000-4000-8000-00000000a004';
  IF v_rows <> 0 THEN RAISE EXCEPTION '4422.alert: a second ticket tick must not alert again'; END IF;
  BEGIN
    PERFORM public.issue_4422_claim_unreached_guest_alerts('venue', 10);
    RAISE EXCEPTION '4422.alert: an unknown source must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

ROLLBACK;
