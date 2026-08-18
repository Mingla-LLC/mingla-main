-- #1930 deterministic two-connection transition races. No sleeps: each
-- ordering is established by a held row lock plus dblink async completion.
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

DELETE FROM public.checkout_sale_revocation_outbox
WHERE event_id IN ('19300000-0000-0000-0000-000000000711','19300000-0000-0000-0000-000000000721',
  '19300000-0000-0000-0000-000000000731','19300000-0000-0000-0000-000000000751',
  '19300000-0000-0000-0000-000000000761');
UPDATE public.ticket_checkout_sessions SET provider_attempt_id=NULL
WHERE event_id IN ('19300000-0000-0000-0000-000000000711','19300000-0000-0000-0000-000000000731');
DELETE FROM public.ticket_checkout_provider_attempts
WHERE event_id IN ('19300000-0000-0000-0000-000000000711','19300000-0000-0000-0000-000000000731');
DELETE FROM public.ticket_checkout_sessions
WHERE event_id IN ('19300000-0000-0000-0000-000000000711','19300000-0000-0000-0000-000000000731');
DELETE FROM public.event_rsvp_contributions
WHERE event_id='19300000-0000-0000-0000-000000000721';
DELETE FROM public.ticket_types
WHERE id IN ('19300000-0000-0000-0000-000000000712','19300000-0000-0000-0000-000000000732',
  '19300000-0000-0000-0000-000000000752','19300000-0000-0000-0000-000000000762');
DELETE FROM public.events
WHERE id IN ('19300000-0000-0000-0000-000000000711','19300000-0000-0000-0000-000000000721',
  '19300000-0000-0000-0000-000000000731','19300000-0000-0000-0000-000000000751',
  '19300000-0000-0000-0000-000000000761');
DELETE FROM public.brands WHERE id='19300000-0000-0000-0000-000000000710';
DELETE FROM public.creator_accounts WHERE id='19300000-0000-0000-0000-000000000701';
DELETE FROM auth.users WHERE id='19300000-0000-0000-0000-000000000701';

INSERT INTO auth.users(id) VALUES('19300000-0000-0000-0000-000000000701');
INSERT INTO public.creator_accounts(id) VALUES('19300000-0000-0000-0000-000000000701');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,pricing_currency,payment_provider)
VALUES('19300000-0000-0000-0000-000000000710','19300000-0000-0000-0000-000000000701',
  'Issue 1930 races','issue-1930-races','NGN','NGN','paystack');
INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency,
  rsvp_contribution_enabled)
VALUES
('19300000-0000-0000-0000-000000000711','19300000-0000-0000-0000-000000000710',
  'Ticket race','issue-1930-ticket-race','event','scheduled','public','UTC','NGN',false),
('19300000-0000-0000-0000-000000000721','19300000-0000-0000-0000-000000000710',
  'RSVP race','issue-1930-rsvp-race','rsvp','scheduled','public','UTC','NGN',true),
('19300000-0000-0000-0000-000000000731','19300000-0000-0000-0000-000000000710',
  'Capacity race','issue-1930-capacity-race','event','scheduled','public','UTC','NGN',false),
('19300000-0000-0000-0000-000000000751','19300000-0000-0000-0000-000000000710',
  'Move race A','issue-1930-move-a','event','scheduled','public','UTC','NGN',false),
('19300000-0000-0000-0000-000000000761','19300000-0000-0000-0000-000000000710',
  'Move race B','issue-1930-move-b','event','scheduled','public','UTC','NGN',false);
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,
  min_purchase_qty,available_online,available_in_person,display_order)
VALUES('19300000-0000-0000-0000-000000000712','19300000-0000-0000-0000-000000000711',
  'Race',1000,'NGN',false,10,1,true,false,0),
('19300000-0000-0000-0000-000000000732','19300000-0000-0000-0000-000000000731',
  'Capacity',1000,'NGN',false,10,1,true,false,0),
('19300000-0000-0000-0000-000000000752','19300000-0000-0000-0000-000000000751',
  'Move A',1000,'NGN',false,10,1,true,false,0),
('19300000-0000-0000-0000-000000000762','19300000-0000-0000-0000-000000000761',
  'Move B',1000,'NGN',false,10,1,true,false,0);

SELECT public.biz_ticket_checkout_create_session(
  '19300000-0000-0000-0000-000000000711',NULL,'Race','race@example.com',
  '+2348012345678',false,jsonb_build_array(jsonb_build_object(
    'ticketTypeId','19300000-0000-0000-0000-000000000712','quantity',1)),
  'issue-1930-race-session',now()+interval '15 minutes',0,'auto'
);
SELECT public.biz_ticket_checkout_create_session(
  '19300000-0000-0000-0000-000000000731',NULL,'Capacity','capacity@example.com',
  '+2348012345678',false,jsonb_build_array(jsonb_build_object(
    'ticketTypeId','19300000-0000-0000-0000-000000000732','quantity',2)),
  'issue-1930-capacity-session',now()+interval '15 minutes',0,'auto'
);
INSERT INTO public.event_rsvp_contributions(id,event_id,brand_id,provider,currency,
  amount_cents,buyer_total_cents,pricing_breakdown,status,caller_idempotency_key)
VALUES('19300000-0000-0000-0000-000000000722','19300000-0000-0000-0000-000000000721',
  '19300000-0000-0000-0000-000000000710','paystack','NGN',1000,1000,'{}','pending',
  'issue-1930-rsvp-race');

DO $test$
DECLARE
  v_conn text := format(
    'dbname=%L user=%L host=%L port=%L password=%L',
    current_database(), current_user,
    current_setting('unix_socket_directories'), current_setting('port'),
    current_setting('issue_1930.test_db_password')
  );
  v_session uuid;
  v_capacity_session uuid;
  v_capacity_token text;
  v_claim jsonb;
  v_rsvp_claim jsonb;
  v_commit jsonb;
  v_finalize jsonb;
BEGIN
  SELECT id INTO v_session FROM public.ticket_checkout_sessions
  WHERE idempotency_key='issue-1930-race-session';
  SELECT id,buyer_status_token_hash INTO v_capacity_session,v_capacity_token
  FROM public.ticket_checkout_sessions
  WHERE idempotency_key='issue-1930-capacity-session';

  PERFORM dblink_connect('issue1930_a', v_conn);
  PERFORM dblink_connect('issue1930_b', v_conn);

  -- Claim owns the event lock. The transition queues behind it, then revokes
  -- the committed attempt immediately after the claim transaction releases.
  --
  -- [TEST-MOD-APPROVED #2009] the racing transition targets `draft` instead of
  -- `private`: #2009 makes Private unreachable by UPDATE for a standard
  -- ticketed event, for every writer. `draft` is the same visibility axis, the
  -- same `event_visibility` sale reason, and a real Admin-reachable state
  -- (`admin_set_offering_visibility` accepts it). Race, assertions and
  -- ordering are unchanged.
  PERFORM dblink_exec('issue1930_a','BEGIN');
  PERFORM * FROM dblink('issue1930_a',
    'SELECT id FROM public.events WHERE id=''19300000-0000-0000-0000-000000000711'' FOR UPDATE')
    AS locked(id uuid);
  IF dblink_send_query('issue1930_b',
    'UPDATE public.events SET visibility=''draft'' WHERE id=''19300000-0000-0000-0000-000000000711''')<>1
  THEN RAISE EXCEPTION 'ticket transition async dispatch failed'; END IF;
  SELECT result INTO v_claim FROM dblink('issue1930_a',format(
    'SELECT public.issue_1930_claim_ticket_provider_attempt(%L,%L,%L,%L,%L)',
    v_session,'19300000-0000-0000-0000-000000000711','paystack','paystack_redirect',
    'issue-1930-ticket-race-fingerprint')) AS claimed(result jsonb);
  PERFORM dblink_exec('issue1930_a','COMMIT');
  PERFORM * FROM dblink_get_result('issue1930_b') AS transitioned(status text);
  IF v_claim->>'outcome'<>'fresh_claim'
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions
       WHERE id=v_session AND revoked_at IS NOT NULL)
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_provider_attempts
       WHERE checkout_session_id=v_session AND state='neutralization_pending')
     OR (SELECT count(*) FROM public.checkout_sale_revocation_outbox
       WHERE subject_type='ticket_checkout_session' AND subject_id=v_session)<>1 THEN
    RAISE EXCEPTION 'transition-vs-claim did not converge safely';
  END IF;
  PERFORM dblink_disconnect('issue1930_b');
  PERFORM dblink_connect('issue1930_b', v_conn);

  -- Claim RSVP first. Then hold its disabling transition open while the
  -- simulated provider response commit waits. Once closure commits, the
  -- response CAS must return revoked and enqueue exactly one neutralization.
  SELECT result INTO v_rsvp_claim FROM dblink('issue1930_a',
    'SELECT public.issue_1930_claim_rsvp_provider_attempt(''19300000-0000-0000-0000-000000000722'',
      ''19300000-0000-0000-0000-000000000721'',''paystack_redirect'',
      ''issue-1930-rsvp-race-fingerprint'')') AS claimed(result jsonb);
  IF v_rsvp_claim->>'outcome'<>'fresh_claim' THEN RAISE EXCEPTION 'RSVP claim failed'; END IF;
  PERFORM dblink_exec('issue1930_b','BEGIN');
  PERFORM dblink_exec('issue1930_b',
    'UPDATE public.events SET rsvp_contribution_enabled=false
      WHERE id=''19300000-0000-0000-0000-000000000721''');
  IF dblink_send_query('issue1930_a',format(
    'SELECT public.issue_1930_commit_rsvp_provider_attempt(%L,%s,NULL,NULL,%L,%L)',
    '19300000-0000-0000-0000-000000000722',(v_rsvp_claim->>'epoch')::bigint,
    'issue-1930-paystack-reference','issue-1930-continuation-fingerprint'))<>1
  THEN RAISE EXCEPTION 'RSVP response async dispatch failed'; END IF;
  PERFORM dblink_exec('issue1930_b','COMMIT');
  SELECT result INTO v_commit FROM dblink_get_result('issue1930_a') AS committed(result jsonb);
  PERFORM dblink_disconnect('issue1930_a');
  PERFORM dblink_connect('issue1930_a', v_conn);
  IF v_commit->>'outcome'<>'revoked'
     OR (SELECT count(*) FROM public.checkout_sale_revocation_outbox
       WHERE subject_type='rsvp_contribution'
         AND subject_id='19300000-0000-0000-0000-000000000722')<>1 THEN
    RAISE EXCEPTION 'transition-vs-provider-response did not converge safely: %',v_commit;
  END IF;

  -- Capacity shrink vs preflight/finalize: preflight holding event authority
  -- serializes the shrink; after the shrink commits, the session is revoked
  -- and both replay/preflight and old-client finalize fail closed.
  PERFORM dblink_exec('issue1930_a','BEGIN');
  PERFORM * FROM dblink('issue1930_a',
    format('SELECT public.issue_1930_ticket_checkout_preflight(%L,%L)',
      v_capacity_session,v_capacity_token)) AS preflight(result text);
  IF dblink_send_query('issue1930_b',
    'UPDATE public.ticket_types SET quantity_total=1
      WHERE id=''19300000-0000-0000-0000-000000000732''')<>1
  THEN RAISE EXCEPTION 'capacity shrink async dispatch failed'; END IF;
  PERFORM dblink_exec('issue1930_a','COMMIT');
  PERFORM * FROM dblink_get_result('issue1930_b') AS shrunk(status text);
  PERFORM dblink_disconnect('issue1930_b');
  PERFORM dblink_connect('issue1930_b', v_conn);
  PERFORM dblink_exec('issue1930_a','BEGIN');
  SELECT result INTO v_finalize FROM dblink('issue1930_a',format(
    'SELECT public.biz_ticket_checkout_finalize(%L,%L,%L,%L,%L)',
    v_capacity_session,'pi-capacity','ch-capacity','card','issue-1930-pepper'))
    AS finalized(result jsonb);
  PERFORM dblink_exec('issue1930_a','ROLLBACK');
  IF public.issue_1930_ticket_checkout_preflight(v_capacity_session,v_capacity_token)<>'unavailable'
     OR v_finalize->>'outcome'<>'paid_reversal_pending' THEN
    RAISE EXCEPTION 'capacity shrink did not close replay/finalize: preflight=%, finalize=%',
      public.issue_1930_ticket_checkout_preflight(v_capacity_session,v_capacity_token),
      v_finalize;
  END IF;

  -- Canonical reassignment A-to-B/B-to-A: both trigger sessions acquire old
  -- and new event authority in UUID order, so opposite moves complete without
  -- deadlock and both admissions advance.
  IF dblink_send_query('issue1930_a',
    'UPDATE public.ticket_types SET event_id=''19300000-0000-0000-0000-000000000761''
      WHERE id=''19300000-0000-0000-0000-000000000752''')<>1
  THEN RAISE EXCEPTION 'reassignment A-to-B dispatch failed'; END IF;
  IF dblink_send_query('issue1930_b',
    'UPDATE public.ticket_types SET event_id=''19300000-0000-0000-0000-000000000751''
      WHERE id=''19300000-0000-0000-0000-000000000762''')<>1
  THEN RAISE EXCEPTION 'reassignment B-to-A dispatch failed'; END IF;
  PERFORM * FROM dblink_get_result('issue1930_a') AS moved_a(status text);
  PERFORM * FROM dblink_get_result('issue1930_b') AS moved_b(status text);
  IF NOT EXISTS(SELECT 1 FROM public.event_checkout_admission_state
       WHERE event_id='19300000-0000-0000-0000-000000000751' AND epoch>=2)
     OR NOT EXISTS(SELECT 1 FROM public.event_checkout_admission_state
       WHERE event_id='19300000-0000-0000-0000-000000000761' AND epoch>=2) THEN
    RAISE EXCEPTION 'opposite reassignment did not revoke both event authorities';
  END IF;
  PERFORM dblink_disconnect('issue1930_a');
  PERFORM dblink_disconnect('issue1930_b');
END $test$;

DELETE FROM public.checkout_sale_revocation_outbox
WHERE event_id IN ('19300000-0000-0000-0000-000000000711','19300000-0000-0000-0000-000000000721',
  '19300000-0000-0000-0000-000000000731','19300000-0000-0000-0000-000000000751',
  '19300000-0000-0000-0000-000000000761');
UPDATE public.ticket_checkout_sessions SET provider_attempt_id=NULL
WHERE event_id='19300000-0000-0000-0000-000000000711';
DELETE FROM public.ticket_checkout_provider_attempts
WHERE event_id='19300000-0000-0000-0000-000000000711';
DELETE FROM public.ticket_checkout_sessions
WHERE event_id IN ('19300000-0000-0000-0000-000000000711','19300000-0000-0000-0000-000000000731');
DELETE FROM public.event_rsvp_contributions
WHERE event_id='19300000-0000-0000-0000-000000000721';
DELETE FROM public.ticket_types
WHERE id IN ('19300000-0000-0000-0000-000000000712','19300000-0000-0000-0000-000000000732',
  '19300000-0000-0000-0000-000000000752','19300000-0000-0000-0000-000000000762');
DELETE FROM public.events
WHERE id IN ('19300000-0000-0000-0000-000000000711','19300000-0000-0000-0000-000000000721',
  '19300000-0000-0000-0000-000000000731','19300000-0000-0000-0000-000000000751',
  '19300000-0000-0000-0000-000000000761');
DELETE FROM public.brands WHERE id='19300000-0000-0000-0000-000000000710';
DELETE FROM public.creator_accounts WHERE id='19300000-0000-0000-0000-000000000701';
DELETE FROM auth.users WHERE id='19300000-0000-0000-0000-000000000701';
