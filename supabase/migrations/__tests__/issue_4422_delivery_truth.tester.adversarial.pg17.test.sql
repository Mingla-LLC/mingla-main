-- #4422 — independent tester adversarial proof (delivery truth + short links).
--
-- A different angle from the implementor's suite:
--   T-A1  a whole night: the worker wakes and re-defers the same text 20 times
--         (20:05 -> 08:00 WAT); the text never ends terminal and never spends
--         a try; real failures still count, a hold in between never resets them
--   T-A2  the defer clamp: a past, a missing and a three-day reopen instant
--   T-A3  bounce shapes: no bounce.type and 'Undetermined' are transient, a
--         delivery_delayed (soft) event and a delivered event change nothing,
--         an SMS row that shares the provider id is never touched
--   T-A4  the race the spec names: the bounce lands while the email row is
--         still 'processing' (no provider id yet); the REAL finish then writes
--         'sent' + id and the row and its parent still end failed_terminal
--   T-A5  production-shaped backfill: exactly the expected rows move (1 RSVP,
--         5 ticket), decoys stay, a second run moves nothing
--   T-A6  unreached alert: in-app reached is reached, older than 14 days is
--         out, a skipped + bounced order is in, each subject once
--   T-A7  the event short link cannot become an open redirect (constraint and
--         mint), has a bounded expiry, and nothing new is client-callable
--   T-A8  the RSVP switch is scoped: no ticket, reservation or food-order
--         function reads rsvp_messages_v2
--
-- Both #4422 migrations are re-applied first so this suite runs the current
-- bodies whatever an earlier suite in the shared lane database re-applied.
\set ON_ERROR_STOP on
\ir ../20280705004422_issue_4422_transactional_delivery_truth.sql
\ir ../20280705104422_issue_4422_rsvp_message_links.sql

BEGIN;

CREATE FUNCTION pg_temp.ev(p_svix text, p_type text, p_email_id text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS text LANGUAGE sql AS $fn$
  SELECT public.mkt_ingest_email_event(p_svix, p_type, p_email_id,
    jsonb_build_object('type', p_type, 'created_at', '2026-11-13T09:01:00.000Z',
      'data', jsonb_build_object('email_id', p_email_id, 'from', 'Mingla <tickets@usemingla.com>') || p_extra));
$fn$;
CREATE FUNCTION pg_temp.ok(p boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN IF p IS NOT TRUE THEN RAISE EXCEPTION '4422.tester: %', p_msg; END IF; END $fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO public.brands(id, account_id, name, slug) VALUES
  ('44229000-0000-4000-8000-00000000b001', gen_random_uuid(), 'Tester 4422', 'tester-4422');
INSERT INTO public.events(id, brand_id, title, slug, deleted_at) VALUES
  ('44229000-0000-4000-8000-00000000e001','44229000-0000-4000-8000-00000000b001','T4422','t4422', NULL),
  ('44229000-0000-4000-8000-00000000e002','44229000-0000-4000-8000-00000000b001','T4422 gone','t4422-gone', now());
INSERT INTO public.orders(id, event_id, buyer_phone_e164)
SELECT ('44229000-0000-4000-8000-0000000a000' || n)::uuid, '44229000-0000-4000-8000-00000000e001', '+2348000000000'
  FROM generate_series(1, 9) AS n;
INSERT INTO public.rsvp_notifications(id, event_id, status, template_key, payload, idempotency_key, created_at)
VALUES
  ('44229000-0000-4000-8000-000000000001','44229000-0000-4000-8000-00000000e001','pending','rsvp_pass','{}','t4422-night', now()),
  ('44229000-0000-4000-8000-000000000002','44229000-0000-4000-8000-00000000e001','pending','rsvp_pass','{}','t4422-clamp', now()),
  ('44229000-0000-4000-8000-000000000003','44229000-0000-4000-8000-00000000e001','sending','rsvp_pass','{}','t4422-shapes', now()),
  ('44229000-0000-4000-8000-000000000004','44229000-0000-4000-8000-00000000e001','sending','rsvp_pass','{}','t4422-race', now()),
  ('44229000-0000-4000-8000-000000000005','44229000-0000-4000-8000-00000000e001','sent','rsvp_pass','{}','t4422-hist', now()),
  ('44229000-0000-4000-8000-000000000006','44229000-0000-4000-8000-00000000e001','sent','rsvp_acknowledgement','{}','t4422-inapp', now()),
  ('44229000-0000-4000-8000-000000000007','44229000-0000-4000-8000-00000000e001','failed_terminal','rsvp_pass','{}','t4422-old', now() - interval '15 days'),
  ('44229000-0000-4000-8000-000000000008','44229000-0000-4000-8000-00000000e001','failed_terminal','rsvp_pass','{}','t4422-none', now()),
  ('44229000-0000-4000-8000-000000000009','44229000-0000-4000-8000-00000000e001','failed_retryable','rsvp_pass','{}','t4422-retry', now()),
  ('44229000-0000-4000-8000-00000000000a','44229000-0000-4000-8000-00000000e001','sending','rsvp_pass','{}','t4422-undet', now()),
  ('44229000-0000-4000-8000-00000000000b','44229000-0000-4000-8000-00000000e001','sending','rsvp_pass','{}','t4422-soft', now()),
  ('44229000-0000-4000-8000-00000000000c','44229000-0000-4000-8000-00000000e001','failed_retryable','rsvp_pass','{}','t4422-hretry', now());
INSERT INTO public.rsvp_notification_deliveries(id, notification_id, channel, is_required, status, next_attempt_at, provider_message_id, sent_at, safe_error_code)
VALUES
  ('44229000-0000-4000-8000-000000000101','44229000-0000-4000-8000-000000000001','sms',true,'pending',now()-interval '1 minute',NULL,NULL,NULL),
  ('44229000-0000-4000-8000-000000000201','44229000-0000-4000-8000-000000000002','sms',true,'pending',now()-interval '1 minute',NULL,NULL,NULL),
  ('44229000-0000-4000-8000-000000000301','44229000-0000-4000-8000-000000000003','email',true,'sent',now(),'re_t4422_notype',now(),NULL),
  ('44229000-0000-4000-8000-000000000302','44229000-0000-4000-8000-00000000000a','email',true,'sent',now(),'re_t4422_undet',now(),NULL),
  ('44229000-0000-4000-8000-000000000303','44229000-0000-4000-8000-00000000000b','email',true,'sent',now(),'re_t4422_soft',now(),NULL),
  ('44229000-0000-4000-8000-000000000304','44229000-0000-4000-8000-000000000003','sms',true,'sent',now(),'re_t4422_notype',now(),NULL),
  ('44229000-0000-4000-8000-000000000401','44229000-0000-4000-8000-000000000004','email',true,'pending',now()-interval '1 minute',NULL,NULL,NULL),
  ('44229000-0000-4000-8000-000000000501','44229000-0000-4000-8000-000000000005','email',true,'sent',now(),'re_t4422_h_rsvp',now(),NULL),
  ('44229000-0000-4000-8000-000000000502','44229000-0000-4000-8000-00000000000c','email',true,'failed_retryable',now(),'re_t4422_h_retry',NULL,NULL),
  ('44229000-0000-4000-8000-000000000601','44229000-0000-4000-8000-000000000006','in_app',false,'sent',now(),NULL,now(),NULL),
  ('44229000-0000-4000-8000-000000000602','44229000-0000-4000-8000-000000000006','email',true,'failed_terminal',now(),NULL,NULL,'email_bounced_permanent'),
  ('44229000-0000-4000-8000-000000000701','44229000-0000-4000-8000-000000000007','email',true,'failed_terminal',now(),NULL,NULL,'email_bounced_permanent'),
  ('44229000-0000-4000-8000-000000000801','44229000-0000-4000-8000-000000000008','email',true,'failed_terminal',now(),NULL,NULL,'email_bounced_permanent'),
  ('44229000-0000-4000-8000-000000000802','44229000-0000-4000-8000-000000000008','push',true,'ambiguous',now(),NULL,NULL,'provider_acceptance_unknown'),
  ('44229000-0000-4000-8000-000000000901','44229000-0000-4000-8000-000000000009','sms',true,'failed_retryable',now()+interval '1 minute',NULL,NULL,'provider_unavailable');
INSERT INTO public.ticket_order_notifications(id, order_id, event_id, channel, recipient, status, provider_message_id, idempotency_key, last_error, created_at)
VALUES
  -- backfill: 3 Permanent + 2 Transient that must move, one decoy that must not
  ('44229000-0000-4000-8000-000000000a01','44229000-0000-4000-8000-0000000a0001','44229000-0000-4000-8000-00000000e001','email','a@x.test','sent','re_t4422_h_t1','t4422-t1',NULL, now()),
  ('44229000-0000-4000-8000-000000000a02','44229000-0000-4000-8000-0000000a0002','44229000-0000-4000-8000-00000000e001','email','b@x.test','delivered','re_t4422_h_t2','t4422-t2',NULL, now()),
  ('44229000-0000-4000-8000-000000000a03','44229000-0000-4000-8000-0000000a0003','44229000-0000-4000-8000-00000000e001','email','c@x.test','sent','re_t4422_h_t3','t4422-t3',NULL, now()),
  ('44229000-0000-4000-8000-000000000a04','44229000-0000-4000-8000-0000000a0004','44229000-0000-4000-8000-00000000e001','email','d@x.test','delivered','re_t4422_h_t4','t4422-t4',NULL, now()),
  ('44229000-0000-4000-8000-000000000a05','44229000-0000-4000-8000-0000000a0005','44229000-0000-4000-8000-00000000e001','email','e@x.test','sent','re_t4422_h_t5','t4422-t5',NULL, now()),
  ('44229000-0000-4000-8000-000000000a06','44229000-0000-4000-8000-0000000a0006','44229000-0000-4000-8000-00000000e001','email','f@x.test','sent','re_t4422_h_ok','t4422-t6',NULL, now()),
  -- unreached: a skipped SMS (market dark) + a bounced email is unreached
  ('44229000-0000-4000-8000-000000000a07','44229000-0000-4000-8000-0000000a0007','44229000-0000-4000-8000-00000000e001','email','g@x.test','failed_terminal',NULL,'t4422-t7','email_bounced_permanent', now()),
  ('44229000-0000-4000-8000-000000000a08','44229000-0000-4000-8000-0000000a0007','44229000-0000-4000-8000-00000000e001','sms','+2348000000009','skipped',NULL,'t4422-t8','sms_market_dark:NG', now());
SET LOCAL session_replication_role = origin;

-- History for the backfill (stored before the migration would run).
INSERT INTO public.marketing_email_events(svix_id, event_type, provider_message_id, payload, is_campaign_event) VALUES
  ('t4422-h-1','email.bounced','re_t4422_h_rsvp','{"data":{"bounce":{"type":"Permanent"}}}',false),
  ('t4422-h-1d','email.delivered','re_t4422_h_rsvp','{"data":{}}',false),
  ('t4422-h-2','email.bounced','re_t4422_h_retry','{"data":{"bounce":{"type":"Permanent"}}}',false),
  ('t4422-h-3','email.bounced','re_t4422_h_t1','{"data":{"bounce":{"type":"Permanent"}}}',false),
  ('t4422-h-4','email.bounced','re_t4422_h_t2','{"data":{"bounce":{"type":"Permanent"}}}',false),
  ('t4422-h-5','email.bounced','re_t4422_h_t3','{"data":{"bounce":{"type":"Permanent"}}}',false),
  ('t4422-h-6','email.bounced','re_t4422_h_t4','{"data":{"bounce":{"type":"Transient"}}}',false),
  ('t4422-h-7','email.bounced','re_t4422_h_t5','{"data":{"bounce":{"type":"Transient"}}}',false),
  ('t4422-h-7b','email.bounced','re_t4422_h_t5','{"data":{"bounce":{"type":"Transient"}}}',false),
  ('t4422-h-8','email.delivery_delayed','re_t4422_h_ok','{"data":{}}',false),
  ('t4422-h-9','email.opened','re_t4422_h_ok','{"data":{}}',false);

-- T-A5 production-shaped backfill: exactly 1 RSVP and 5 ticket rows move.
DO $$ DECLARE v jsonb; v2 jsonb; BEGIN
  -- the rows outside this fixture must not change the count we assert on
  v := public.issue_4422_backfill_transactional_email_events();
  PERFORM pg_temp.ok((SELECT status FROM public.rsvp_notification_deliveries WHERE id='44229000-0000-4000-8000-000000000501') = 'failed_terminal', 'T-A5 RSVP history row must move');
  PERFORM pg_temp.ok((SELECT status FROM public.rsvp_notification_deliveries WHERE id='44229000-0000-4000-8000-000000000502') = 'failed_retryable', 'T-A5 a failed_retryable email is not "sent" and must not move');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.ticket_order_notifications WHERE id IN (
    '44229000-0000-4000-8000-000000000a01','44229000-0000-4000-8000-000000000a02','44229000-0000-4000-8000-000000000a03',
    '44229000-0000-4000-8000-000000000a04','44229000-0000-4000-8000-000000000a05') AND status='failed_terminal') = 5, 'T-A5 five ticket rows must move');
  PERFORM pg_temp.ok((SELECT string_agg(last_error, ',' ORDER BY id) FROM public.ticket_order_notifications WHERE id IN (
    '44229000-0000-4000-8000-000000000a01','44229000-0000-4000-8000-000000000a02','44229000-0000-4000-8000-000000000a03',
    '44229000-0000-4000-8000-000000000a04','44229000-0000-4000-8000-000000000a05'))
    = 'email_bounced_permanent,email_bounced_permanent,email_bounced_permanent,email_bounced_transient,email_bounced_transient', 'T-A5 codes');
  PERFORM pg_temp.ok((SELECT status FROM public.ticket_order_notifications WHERE id='44229000-0000-4000-8000-000000000a06') = 'sent', 'T-A5 delayed/opened events must not move a sent row');
  PERFORM pg_temp.ok((SELECT status FROM public.rsvp_notifications WHERE id='44229000-0000-4000-8000-000000000005') = 'failed_terminal', 'T-A5 RSVP parent rolls up');
  v2 := public.issue_4422_backfill_transactional_email_events();
  PERFORM pg_temp.ok(v2 = '{"rsvp":0,"ticket":0}'::jsonb, 'T-A5 a second backfill moves nothing, got ' || v2::text);
  PERFORM pg_temp.ok((SELECT count(*) FROM public.marketing_email_events WHERE svix_id LIKE 't4422-h-%' AND reconciled_at IS NOT NULL) = 0, 'T-A5 #2714 reconcile columns are never written');
END $$;

-- T-A1 a whole night of wake-ups, then real failures.
DO $$ DECLARE c record; i int; d record; BEGIN
  FOR i IN 1..20 LOOP
    SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44229000-0000-4000-8000-000000000001', 8);
    PERFORM pg_temp.ok(c.attempt_count = 1, format('T-A1 wake %s must be attempt 1, got %s', i, c.attempt_count));
    PERFORM pg_temp.ok(public.defer_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'ng_operator_embargo', now() + interval '11 hours 55 minutes'), 'T-A1 defer');
    UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = c.delivery_id;
  END LOOP;
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = '44229000-0000-4000-8000-000000000101';
  PERFORM pg_temp.ok(d.status = 'deferred' AND d.attempt_count = 0, format('T-A1 after 20 holds: %s / %s', d.status, d.attempt_count));
  -- three real failures, a hold, then five more: the hold never resets them and the 8th real one is terminal
  FOR i IN 1..8 LOOP
    SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44229000-0000-4000-8000-000000000001', 8);
    PERFORM pg_temp.ok(c.attempt_count = i, format('T-A1 real try %s numbered %s', i, c.attempt_count));
    IF i = 4 THEN
      PERFORM public.defer_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'ng_operator_embargo', now() + interval '1 hour');
      UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = c.delivery_id;
      SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44229000-0000-4000-8000-000000000001', 8);
      PERFORM pg_temp.ok(c.attempt_count = 4, format('T-A1 after a hold the 4th real try is still 4, got %s', c.attempt_count));
    END IF;
    PERFORM public.finish_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'failed_retryable', NULL, 'provider_unavailable');
    UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now() - interval '1 second'
     WHERE id = c.delivery_id AND status = 'failed_retryable';
  END LOOP;
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = '44229000-0000-4000-8000-000000000101';
  PERFORM pg_temp.ok(d.status = 'failed_terminal' AND d.attempt_count = 8 AND d.safe_error_code = 'provider_unavailable',
    format('T-A1 the cap still kills real failures: %s %s %s', d.status, d.attempt_count, d.safe_error_code));
END $$;

-- T-A2 the clamp.
DO $$ DECLARE c record; d record; BEGIN
  SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44229000-0000-4000-8000-000000000002', 8);
  PERFORM public.defer_rsvp_notification_delivery(c.delivery_id, c.lease_id, NULL, now() - interval '1 day');
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = c.delivery_id;
  PERFORM pg_temp.ok(d.next_attempt_at >= now() + interval '30 seconds' AND d.next_attempt_at <= now() + interval '151 seconds' AND d.safe_error_code = 'ng_operator_embargo',
    'T-A2 a past instant is clamped to >= 30 s; a NULL code defaults, got ' || d.next_attempt_at::text || ' ' || coalesce(d.safe_error_code,'null'));
  UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = c.delivery_id;
  SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44229000-0000-4000-8000-000000000002', 8);
  PERFORM public.defer_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'ng_operator_embargo', NULL);
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = c.delivery_id;
  PERFORM pg_temp.ok(d.next_attempt_at BETWEEN now() + interval '15 minutes' AND now() + interval '17 minutes', 'T-A2 a missing instant is 15 min');
  UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = c.delivery_id;
  SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44229000-0000-4000-8000-000000000002', 8);
  PERFORM public.defer_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'ng_operator_embargo', now() + interval '3 days');
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = c.delivery_id;
  PERFORM pg_temp.ok(d.next_attempt_at <= now() + interval '13 hours 121 seconds', 'T-A2 a far instant is capped at 13 h');
  PERFORM pg_temp.ok(d.attempt_count = 0, 'T-A2 no try spent');
END $$;

-- T-A3 bounce shapes.
DO $$ BEGIN
  PERFORM pg_temp.ok(pg_temp.ev('t4422-s-1','email.bounced','re_t4422_notype') = 'transactional_delivery', 'T-A3 no bounce.type applies');
  PERFORM pg_temp.ok(pg_temp.ev('t4422-s-2','email.bounced','re_t4422_undet','{"bounce":{"type":"Undetermined"}}') = 'transactional_delivery', 'T-A3 Undetermined applies');
  PERFORM pg_temp.ok(pg_temp.ev('t4422-s-3','email.delivery_delayed','re_t4422_soft') <> 'transactional_delivery', 'T-A3 a delayed (soft) event is not a bounce');
  PERFORM pg_temp.ok(pg_temp.ev('t4422-s-4','email.delivered','re_t4422_soft') <> 'transactional_delivery', 'T-A3 a delivered event is not a bounce');
  PERFORM pg_temp.ok((SELECT safe_error_code FROM public.rsvp_notification_deliveries WHERE id='44229000-0000-4000-8000-000000000301') = 'email_bounced_transient', 'T-A3 no type -> transient');
  PERFORM pg_temp.ok((SELECT safe_error_code FROM public.rsvp_notification_deliveries WHERE id='44229000-0000-4000-8000-000000000302') = 'email_bounced_transient', 'T-A3 Undetermined -> transient');
  PERFORM pg_temp.ok((SELECT status FROM public.rsvp_notification_deliveries WHERE id='44229000-0000-4000-8000-000000000303') = 'sent', 'T-A3 soft delay leaves sent');
  PERFORM pg_temp.ok((SELECT status FROM public.rsvp_notification_deliveries WHERE id='44229000-0000-4000-8000-000000000304') = 'sent', 'T-A3 an SMS row sharing the id is untouched');
  -- a replay of the same svix id is a no-op and still answers 200-class
  PERFORM pg_temp.ok(pg_temp.ev('t4422-s-1','email.bounced','re_t4422_notype') IN ('unmatched','campaign_unmatched','campaign_unmatched_stale','transactional_delivery'), 'T-A3 replay');
END $$;

-- T-A4 the bounce lands while the email is still being sent.
DO $$ DECLARE c record; n record; d record; BEGIN
  SELECT * INTO c FROM public.claim_rsvp_notification_deliveries('44229000-0000-4000-8000-000000000004', 8);
  PERFORM pg_temp.ok(c.channel = 'email', 'T-A4 claimed the email');
  PERFORM pg_temp.ok(pg_temp.ev('t4422-r-1','email.complained','re_t4422_race') <> 'transactional_delivery', 'T-A4 nothing to match yet');
  PERFORM pg_temp.ok(public.finish_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'sent', 're_t4422_race', NULL), 'T-A4 the real finish');
  SELECT * INTO d FROM public.rsvp_notification_deliveries WHERE id = c.delivery_id;
  SELECT * INTO n FROM public.rsvp_notifications WHERE id = '44229000-0000-4000-8000-000000000004';
  PERFORM pg_temp.ok(d.status = 'failed_terminal' AND d.safe_error_code = 'email_complained' AND d.sent_at IS NOT NULL,
    format('T-A4 row after finish: %s %s', d.status, d.safe_error_code));
  PERFORM pg_temp.ok(n.status = 'failed_terminal', 'T-A4 the parent is not left sent, got ' || n.status);
END $$;

-- T-A6 unreached guests, once each.
DO $$ DECLARE r text; t text; BEGIN
  SELECT string_agg(subject_id::text, ',' ORDER BY subject_id) INTO r FROM public.issue_4422_claim_unreached_guest_alerts('rsvp', 200)
   WHERE subject_id::text LIKE '44229000-%';
  PERFORM pg_temp.ok(r IS NOT NULL AND position('44229000-0000-4000-8000-000000000008' IN r) > 0, 'T-A6 the ambiguous+bounced RSVP is alerted: ' || coalesce(r,'none'));
  PERFORM pg_temp.ok(position('44229000-0000-4000-8000-000000000006' IN r) = 0, 'T-A6 an in-app sent RSVP was reached');
  PERFORM pg_temp.ok(position('44229000-0000-4000-8000-000000000007' IN r) = 0, 'T-A6 older than 14 days is out');
  PERFORM pg_temp.ok(position('44229000-0000-4000-8000-000000000009' IN r) = 0, 'T-A6 a retry still owed is out');
  SELECT string_agg(subject_id::text, ',') INTO t FROM public.issue_4422_claim_unreached_guest_alerts('ticket', 200)
   WHERE subject_id::text LIKE '44229000-%';
  PERFORM pg_temp.ok(position('44229000-0000-4000-8000-0000000a0007' IN coalesce(t,'')) > 0, 'T-A6 a skipped SMS + bounced email order is unreached: ' || coalesce(t,'none'));
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.issue_4422_claim_unreached_guest_alerts('rsvp', 200) WHERE subject_id::text LIKE '44229000-%'), 'T-A6 a second tick returns nothing (rsvp)');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.issue_4422_claim_unreached_guest_alerts('ticket', 200) WHERE subject_id::text LIKE '44229000-%'), 'T-A6 a second tick returns nothing (ticket)');
  BEGIN
    PERFORM public.issue_4422_claim_unreached_guest_alerts('venue', 1);
    RAISE EXCEPTION '4422.tester: T-A6 an unknown source must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

-- T-A7 no open redirect, bounded expiry, nothing client-callable.
DO $$ DECLARE bad text; v jsonb; BEGIN
  FOREACH bad IN ARRAY ARRAY[
    'https://host.usemingla.com.evil.example/e/a/b',
    'https://host.usemingla.com@evil.example/e/a/b',
    'https://evil.example/e/a/b?u=https://host.usemingla.com/e/a/b',
    'https://host.usemingla.com/e/a/b?next=https://evil.example',
    'https://host.usemingla.com/e/a/b#https://evil.example',
    'https://host.usemingla.com/e/a/b/../../x',
    'http://host.usemingla.com/e/a/b',
    'https://HOST.usemingla.com/e/a/b',
    'https://host.usemingla.com/e/a/b' || chr(10) || 'https://evil.example',
    'https://host.usemingla.com/e/a b/c',
    'https://host.usemingla.com//evil.example/a/b',
    'https://host.usemingla.com/x/a/b',
    'javascript:alert(1)//host.usemingla.com/e/a/b',
    'https://usemingla.com/e/a/b'
  ] LOOP
    BEGIN
      v := public.mint_redirect_link('event_page','44229000-0000-4000-8000-00000000e001', bad, now() + interval '30 days');
      RAISE EXCEPTION '4422.tester: T-A7 accepted a hostile target %', bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  v := public.mint_redirect_link('event_page','44229000-0000-4000-8000-00000000e001','https://host.usemingla.com/e/tester-4422/t4422', now() + interval '30 days');
  PERFORM pg_temp.ok((public.resolve_claim_link(v->>'code'))->>'url' = 'https://host.usemingla.com/e/tester-4422/t4422', 'T-A7 a good target resolves');
  BEGIN
    PERFORM public.mint_redirect_link('event_page','44229000-0000-4000-8000-00000000e002','https://host.usemingla.com/e/tester-4422/t4422-gone', now() + interval '30 days');
    RAISE EXCEPTION '4422.tester: T-A7 a deleted event must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.mint_redirect_link('event_page','44229000-0000-4000-8000-00000000e001','https://host.usemingla.com/e/tester-4422/t4422', now() + interval '401 days');
    RAISE EXCEPTION '4422.tester: T-A7 an expiry past 400 days must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- an event_page code can never be re-pointed off-host through the waitlist branch
  BEGIN
    PERFORM public.mint_redirect_link('waitlist_offer','44229000-0000-4000-8000-00000000e001','https://host.usemingla.com/e/tester-4422/t4422', now() + interval '1 day');
    RAISE EXCEPTION '4422.tester: T-A7 an event id is not a waitlist offer';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  -- direct writes are held to the same allow-list
  BEGIN
    UPDATE public.claim_links SET target_url = 'https://evil.example/e/a/b' WHERE code = v->>'code';
    RAISE EXCEPTION '4422.tester: T-A7 the table accepted an off-host target';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated','public.mint_redirect_link(text,uuid,text,timestamptz)','EXECUTE')
    AND NOT has_function_privilege('anon','public.mint_redirect_link(text,uuid,text,timestamptz)','EXECUTE'), 'T-A7 mint is service_role only');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated','public.enqueue_rsvp_pass(uuid,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.enqueue_rsvp_pass(uuid,text)','EXECUTE'), 'T-A7 enqueue_rsvp_pass is service_role only');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated','public.issue_4422_backfill_transactional_email_events()','EXECUTE')
    AND NOT has_function_privilege('anon','public.issue_4422_backfill_transactional_email_events()','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.mkt_ingest_email_event(text,text,text,jsonb)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.finish_rsvp_notification_delivery(uuid,uuid,text,text,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.claim_rsvp_notification_deliveries(uuid,integer)','EXECUTE'), 'T-A7 backfill/ingest/claim/finish are service_role only');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated','public.claim_links','SELECT') OR
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.claim_links'::regclass), 'T-A7 claim_links is not client-readable');
END $$;

-- T-A8 the RSVP switch reaches only the RSVP functions.
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['issue_2947_waitlist_drain_for_ticket_type','event_edit_notice_fanout',
                           'orch_1161_reservation_notify_outbox','tg_venue_orders_a4063_receipt'] LOOP
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
       WHERE s.nspname='public' AND p.proname=f AND p.prosrc LIKE '%rsvp_messages_v2%'), 'T-A8 ' || f || ' must not read rsvp_messages_v2');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
       WHERE s.nspname='public' AND p.proname=f), 'T-A8 ' || f || ' exists');
  END LOOP;
  PERFORM pg_temp.ok((SELECT enabled FROM public.issue_4063_switches WHERE name='rsvp_messages_v2') IS FALSE, 'T-A8 the RSVP switch ships off');
END $$;

DO $$ BEGIN RAISE NOTICE 'PASS issue_4422 tester adversarial: T-A1..T-A8'; END $$;
ROLLBACK;
