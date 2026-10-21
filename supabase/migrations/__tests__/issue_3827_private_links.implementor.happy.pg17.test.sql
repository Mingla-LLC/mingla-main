-- issue #3827 — private ticket links, implementor happy path (pg17 post-replay).
-- MINGLA-INVARIANT: I-3827-LINK-TOKEN-OPAQUE | issue #3827 | only a domain-separated token hash is persisted; reset replaces it and the old hash no longer resolves.
-- MINGLA-INVARIANT: I-3827-LINK-GROUP-ONE-PERSON-ONE-ORDER | issue #3827 | each accepted person gets one comp order and one ticket; one group's emails are unique and duplicate event attendees are skipped.
-- MINGLA-INVARIANT: I-3827-LINK-GROUP-ATOMIC | issue #3827 | each guest-list submission commits every newly issuable person or commits none of them.
-- MINGLA-INVARIANT: I-3827-LINK-PENDING-HOLDS-NOTHING | issue #3827 | a host-approval request changes neither sold_count nor link uses before approval.
-- MINGLA-INVARIANT: I-3827-HIDDEN-TIER-REQUIRES-LINK | issue #3827 | direct checkout cannot buy a hidden tier; the matching usable private link wrapper can and binds attribution.
-- MINGLA-INVARIANT: I-3827-PASSWORDS-RETIRED | issue #3827 | published event and ticket password protection cannot be enabled.
-- MINGLA-INVARIANT: I-3827-GUIDE-MATCHES-PRIVATE-LINKS | issue #3827 | the Feature Guide describes revocable links, pending capacity and Via link attribution.

\set ON_ERROR_STOP on

-- The earlier issue-3827-21-guide-live-entries suite re-applies 20271128053827
-- and commits its older events-guest-list wording. The replay's real end state
-- is this PR's guide migration, so restore it before asserting the guide.
\ir ../20271209013827_issue_3827_private_ticket_links_guide.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3827l_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #3827 links FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3827l_err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3827l_fixture(
  p_tag text,
  OUT o_event uuid, OUT o_free uuid, OUT o_paid uuid, OUT o_owner uuid, OUT o_brand uuid
) LANGUAGE plpgsql AS $$
BEGIN
  o_owner := gen_random_uuid(); o_brand := gen_random_uuid(); o_event := gen_random_uuid();
  INSERT INTO auth.users(id,email) VALUES (o_owner, 'i3827l-' || o_owner || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(id,account_id,name,slug,payment_provider)
    VALUES (o_brand,o_owner,'Link ' || p_tag,'i3827l-' || p_tag || '-' || o_brand,'stripe');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES (
    o_brand,'acct_i3827_' || replace(o_brand::text,'-',''),true,true,'GB','gbp'
  );
  INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency)
    VALUES (o_event,o_brand,'Link event ' || p_tag,'i3827l-' || p_tag || '-' || o_event,'event','draft','draft','UTC','GBP');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES (o_event,now()-interval '1 hour',now()+interval '5 hours','UTC',true);
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,is_hidden)
    VALUES (o_event,'Guest list',0,'GBP',true,10,false,1,10,true,true,0,false)
    RETURNING id INTO o_free;
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,is_hidden)
    VALUES (o_event,'Secret paid',1000,'GBP',false,10,false,1,4,true,true,1,true)
    RETURNING id INTO o_paid;
  PERFORM set_config('mingla.publish_free_only','on',true);
  UPDATE public.events SET status='scheduled',visibility='public',published_at=now() WHERE id=o_event;
  PERFORM set_config('mingla.publish_free_only','',true);
END $$;

DO $auto$
DECLARE
  f record; v_link uuid := gen_random_uuid(); v_signup uuid := gen_random_uuid();
  v_hash text := repeat('a',64); v_new_hash text := repeat('b',64); v_result jsonb; v_replay jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827l_fixture('auto');
  v_result := public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'DJ invites',3,3,'auto',NULL,
    v_link,decode('00112233445566778899aabbccddeeff','hex'),v_hash);
  PERFORM pg_temp.i3827l_assert(v_result->>'kind'='guest_list','free tier creates a guest-list link');
  PERFORM pg_temp.i3827l_assert(
    (public.pg_ticket_link_resolve(v_hash)->>'state')='active'
    AND (public.pg_ticket_link_resolve(v_hash)->>'guestsMax')::int=2,
    'hash resolves active with a two-guest allowance');

  v_result := public.pg_ticket_link_signup(v_hash,jsonb_build_array(
      jsonb_build_object('name','Lead One','email','lead@example.test','phoneE164','+15550000001'),
      jsonb_build_object('name','Guest Two','email','guest@example.test','phoneE164','+15550000001')),
    NULL,v_signup,repeat('c',64),'i3827-private-links-test-qr-pepper-secret');
  PERFORM pg_temp.i3827l_assert(v_result->>'status'='issued' AND (v_result->>'issuedCount')::int=2,
    'auto link issues both people');
  PERFORM pg_temp.i3827l_assert(
    (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=2,
    'one comp order per person');
  PERFORM pg_temp.i3827l_assert(
    (SELECT count(*) FROM public.tickets t JOIN public.orders o ON o.id=t.order_id WHERE o.ticket_link_id=v_link)=2,
    'one ticket per linked order');
  PERFORM pg_temp.i3827l_assert(
    NOT EXISTS (SELECT 1 FROM public.orders WHERE ticket_link_id=v_link AND (source<>'comp' OR total_cents<>0)),
    'link orders are zero-value comps');
  PERFORM pg_temp.i3827l_assert(
    NOT EXISTS (SELECT 1 FROM public.orders WHERE ticket_link_id=v_link AND metadata->>'marketing_opt_in'<>'true'),
    'link orders are marketing-visible');
  PERFORM pg_temp.i3827l_assert(
    NOT EXISTS (SELECT 1 FROM public.orders WHERE ticket_link_id=v_link AND ticket_link_signup_id IS DISTINCT FROM
      (SELECT id FROM public.ticket_link_signups WHERE link_id=v_link AND client_request_id=v_signup)),
    'link orders retain signup attribution');
  PERFORM pg_temp.i3827l_assert(
    (SELECT metadata->>'party_lead_name' FROM public.orders WHERE ticket_link_id=v_link AND buyer_email='guest@example.test')='Lead One'
    AND (SELECT metadata->>'party_origin' FROM public.orders WHERE ticket_link_id=v_link AND buyer_email='guest@example.test')='link',
    'guest order carries the lead party line');

  v_replay := public.pg_ticket_link_signup(v_hash,jsonb_build_array(
      jsonb_build_object('name','Lead One','email','lead@example.test','phoneE164','+15550000001'),
      jsonb_build_object('name','Guest Two','email','guest@example.test','phoneE164','+15550000001')),
    NULL,v_signup,repeat('c',64),'i3827-private-links-test-qr-pepper-secret');
  PERFORM pg_temp.i3827l_assert((v_replay->>'alreadyPending') IS NULL
    AND (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=2,
    'same request id replays without new orders');

  PERFORM public.biz_ticket_link_reset(f.o_owner,v_link,decode('ffeeddccbbaa99887766554433221100','hex'),v_new_hash);
  PERFORM pg_temp.i3827l_assert(public.pg_ticket_link_resolve(v_hash)->>'state'='not_found'
    AND public.pg_ticket_link_resolve(v_new_hash)->>'state'='active',
    'reset invalidates the old hash and activates the new hash');
END $auto$;

DO $approval$
DECLARE
  f record; v_link uuid := gen_random_uuid(); v_signup uuid := gen_random_uuid();
  v_hash text := repeat('d',64); v_result jsonb; v_before int;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827l_fixture('approval');
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Press approval',4,2,'host',NULL,
    v_link,decode('10112233445566778899aabbccddeeff','hex'),v_hash);
  SELECT sold_count INTO v_before FROM public.ticket_types WHERE id=f.o_free;
  v_result := public.pg_ticket_link_signup(v_hash,jsonb_build_array(
      jsonb_build_object('name','Pending Lead','email','pending@example.test','phoneE164','+15550000002'),
      jsonb_build_object('name','Pending Guest','email','pending.guest@example.test','phoneE164','+15550000003')),
    NULL,v_signup,repeat('e',64),'i3827-private-links-test-qr-pepper-secret');
  PERFORM pg_temp.i3827l_assert(v_result->>'status'='pending'
    AND (SELECT sold_count FROM public.ticket_types WHERE id=f.o_free)=v_before
    AND public.issue_3827_link_uses_taken(v_link)=0,
    'pending request holds no capacity and consumes no link uses');
  SELECT id INTO v_signup FROM public.ticket_link_signups
   WHERE link_id=v_link AND client_request_id=v_signup;
  v_result := public.biz_ticket_link_decide(f.o_owner,v_signup,'approve',gen_random_uuid(),'i3827-private-links-test-qr-pepper-secret');
  PERFORM pg_temp.i3827l_assert(v_result->>'status'='issued'
    AND (SELECT sold_count FROM public.ticket_types WHERE id=f.o_free)=v_before+2
    AND public.issue_3827_link_uses_taken(v_link)=2,
    'approval atomically issues two places');
END $approval$;

DO $paid$
DECLARE
  f record; v_link uuid := gen_random_uuid(); v_hash text := repeat('f',64);
  v_error text; v_session jsonb; v_session_id uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827l_fixture('paid');
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_paid,NULL,'Secret buyers',5,1,'auto',NULL,
    v_link,decode('20112233445566778899aabbccddeeff','hex'),v_hash);
  v_error := pg_temp.i3827l_err(format(
    'SELECT public.biz_ticket_checkout_create_session(%L,NULL,%L,%L,%L,false,%L::jsonb,%L,now()+interval ''15 minutes'',0,''auto'',NULL)',
    f.o_event,'Direct Buyer','direct@example.test','+15550000004',
    jsonb_build_array(jsonb_build_object('ticketTypeId',f.o_paid,'quantity',1)),'i3827-direct-'||f.o_event));
  PERFORM pg_temp.i3827l_assert(v_error='ticket_type_unavailable','direct checkout refuses the hidden paid tier');

  v_session := public.biz_ticket_link_checkout_create_session(v_hash,f.o_event,NULL,'Linked Buyer',
    'linked@example.test','+15550000005',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',f.o_paid,'quantity',1)),
    'i3827-linked-'||f.o_event,now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL);
  v_session_id := (v_session->>'checkoutSessionId')::uuid;
  PERFORM pg_temp.i3827l_assert(
    (SELECT ticket_link_id=v_link AND ticket_link_units=1 FROM public.ticket_checkout_sessions WHERE id=v_session_id),
    'matching private link unlocks the hidden tier and binds one unit');
END $paid$;

DO $door_labels$
DECLARE
  f record; v_link uuid := gen_random_uuid(); v_signup uuid := gen_random_uuid();
  v_hash text := repeat('9',64); v_order uuid; v_labels jsonb; v_error text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827l_fixture('door-labels');
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Door invites',2,1,'auto',NULL,
    v_link,decode('30112233445566778899aabbccddeeff','hex'),v_hash);
  PERFORM public.pg_ticket_link_signup(v_hash,jsonb_build_array(
      jsonb_build_object('name','Door Guest','email','door@example.test','phoneE164','+15550000006')),
    NULL,v_signup,repeat('8',64),'i3827-private-links-test-qr-pepper-secret');
  SELECT id INTO v_order FROM public.orders WHERE ticket_link_id=v_link;

  v_labels := public.biz_ticket_link_order_labels(f.o_owner,f.o_event,ARRAY[v_order]);
  PERFORM pg_temp.i3827l_assert(v_labels->>v_order::text='Door invites'
    AND (SELECT count(*) FROM jsonb_object_keys(v_labels))=1,
    'door attribution resolves in a separate permission-checked label map');

  v_error := pg_temp.i3827l_err(format(
    'SELECT public.biz_ticket_link_order_labels(%L,%L,ARRAY[%L]::uuid[])',
    gen_random_uuid(),f.o_event,v_order));
  PERFORM pg_temp.i3827l_assert(v_error='forbidden','door attribution refuses an unauthorised actor');
END $door_labels$;

DO $password_and_guide$
DECLARE f record; v_error text; v_text text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827l_fixture('password');
  v_error := pg_temp.i3827l_err(format(
    'UPDATE public.events SET theme=jsonb_set(COALESCE(theme,''{}''::jsonb),''{business_event}'',jsonb_build_object(''settings'',jsonb_build_object(''passwordProtected'',true)),true) WHERE id=%L',
    f.o_event));
  PERFORM pg_temp.i3827l_assert(v_error='password_protection_retired','published event password is refused');
  v_error := pg_temp.i3827l_err(format('UPDATE public.ticket_types SET password_protected=true WHERE id=%L',f.o_free));
  PERFORM pg_temp.i3827l_assert(v_error='password_protection_retired','published ticket password is refused');
  SELECT concat_ws(' ',title,outcome_summary,how_to,limitations,support_wording) INTO v_text
    FROM public.product_capabilities WHERE capability_key='events-guest-list';
  PERFORM pg_temp.i3827l_assert(v_text ILIKE '%Reset link%'
    AND v_text ILIKE '%Pending requests do not hold capacity%'
    AND v_text ILIKE '%Via link%',
    'Feature Guide names reset, pending capacity and attribution');
END $password_and_guide$;

ROLLBACK;
