-- issue #3827 — private link page: several dates per sign-up, adversarial
-- contract (pg17 post-replay). Hostile dates, all-days passes, per-night
-- capacity, pending per date, revocation and the service-role boundary.

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3827x_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #3827 link dates adversarial FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3827x_err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

-- p_shape: 'single' | 'multi' | 'recurring'
CREATE OR REPLACE FUNCTION pg_temp.i3827x_fixture(
  p_tag text, p_shape text, p_mode text, p_capacity integer,
  OUT o_event uuid, OUT o_free uuid, OUT o_owner uuid, OUT o_day1 uuid, OUT o_day2 uuid
) LANGUAGE plpgsql AS $$
DECLARE v_brand uuid := gen_random_uuid();
BEGIN
  o_owner := gen_random_uuid(); o_event := gen_random_uuid();
  INSERT INTO auth.users(id,email) VALUES (o_owner, 'i3827x-' || o_owner || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(id,account_id,name,slug,payment_provider)
    VALUES (v_brand,o_owner,'Adv ' || p_tag,'i3827x-' || p_tag || '-' || v_brand,'stripe');
  INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency)
    VALUES (o_event,v_brand,'Adv ' || p_tag,'i3827x-' || p_tag || '-' || o_event,'event','draft','draft','UTC','GBP');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES (o_event,now()+interval '1 day',now()+interval '1 day 5 hours','UTC',true)
    RETURNING id INTO o_day1;
  IF p_shape <> 'single' THEN
    INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
      VALUES (o_event,now()+interval '8 days',now()+interval '8 days 5 hours','UTC',false)
      RETURNING id INTO o_day2;
  END IF;
  IF p_shape = 'multi' THEN
    UPDATE public.events SET is_multi_date = true, multi_date_pricing_mode = p_mode WHERE id = o_event;
  ELSIF p_shape = 'recurring' THEN
    UPDATE public.events SET is_recurring = true WHERE id = o_event;
  END IF;
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,is_hidden)
    VALUES (o_event,'Guest list',0,'GBP',true,p_capacity,false,1,10,true,true,0,false)
    RETURNING id INTO o_free;
  PERFORM set_config('mingla.publish_free_only','on',true);
  UPDATE public.events SET status='scheduled',visibility='public',published_at=now() WHERE id=o_event;
  PERFORM set_config('mingla.publish_free_only','',true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3827x_person(p_email text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('name','Guest ' || p_email,'email',p_email,'phoneE164','+15550001234'));
$$;

DO $acl$
DECLARE v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.pg_ticket_link_signup_days(text,jsonb,uuid[],uuid,text,text)',
    'public.issue_3827_issue_link_signup_days(uuid,uuid,text)',
    'public.issue_3827_comp_order_on_date(uuid,text,uuid)',
    'public.issue_3827_link_pending_on_date(uuid,text,uuid,uuid)',
    'public.pg_ticket_link_signup(text,jsonb,uuid,uuid,text,text)'
  ] LOOP
    PERFORM pg_temp.i3827x_assert(
      NOT has_function_privilege('anon',v_sig,'EXECUTE')
      AND NOT has_function_privilege('authenticated',v_sig,'EXECUTE')
      AND has_function_privilege('service_role',v_sig,'EXECUTE'),
      'service-role-only function: '||v_sig);
  END LOOP;
  PERFORM pg_temp.i3827x_assert(
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.ticket_link_member_passes'::regclass)
    AND NOT has_table_privilege('anon','public.ticket_link_member_passes','SELECT')
    AND NOT has_table_privilege('authenticated','public.ticket_link_member_passes','SELECT'),
    'per-date pass rows are invisible to clients');
END $acl$;

DO $hostile_dates$
DECLARE f record; g record; v_hash text := repeat('c',64); v_link uuid := gen_random_uuid(); v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827x_fixture('hostile', 'multi', 'per_day', 10);
  SELECT * INTO g FROM pg_temp.i3827x_fixture('other', 'multi', 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Hostile',NULL,1,'auto',NULL,
    v_link,decode('b0112233445566778899aabbccddeeff','hex'),v_hash);
  v_err := pg_temp.i3827x_err(format('SELECT public.pg_ticket_link_signup_days(%L,%L::jsonb,ARRAY[%L,%L]::uuid[],%L,NULL,%L)',
    v_hash, pg_temp.i3827x_person('h1@example.test'), f.o_day1, g.o_day1, gen_random_uuid(), 'i3827-adv-qr-pepper-secret-value'));
  PERFORM pg_temp.i3827x_assert(v_err='occurrence_not_available', 'another event''s date is refused');
  v_err := pg_temp.i3827x_err(format('SELECT public.pg_ticket_link_signup_days(%L,%L::jsonb,ARRAY[]::uuid[],%L,NULL,%L)',
    v_hash, pg_temp.i3827x_person('h2@example.test'), gen_random_uuid(), 'i3827-adv-qr-pepper-secret-value'));
  PERFORM pg_temp.i3827x_assert(v_err='event_date_choice_required', 'no date on a multi-date link is refused');
  v_err := pg_temp.i3827x_err(format('SELECT public.pg_ticket_link_signup_days(%L,%L::jsonb,ARRAY[%L,NULL]::uuid[],%L,NULL,%L)',
    v_hash, pg_temp.i3827x_person('h3@example.test'), f.o_day1, gen_random_uuid(), 'i3827-adv-qr-pepper-secret-value'));
  PERFORM pg_temp.i3827x_assert(v_err='invalid_request', 'a null date in the set is refused');
  v_err := pg_temp.i3827x_err(format('SELECT public.pg_ticket_link_signup_days(%L,%L::jsonb,%L::uuid[],%L,NULL,%L)',
    v_hash, pg_temp.i3827x_person('h4@example.test'),
    (SELECT array_agg(gen_random_uuid()) FROM generate_series(1,61)), gen_random_uuid(), 'i3827-adv-qr-pepper-secret-value'));
  PERFORM pg_temp.i3827x_assert(v_err='invalid_request', 'more than sixty dates is refused');
  PERFORM pg_temp.i3827x_assert(NOT EXISTS (SELECT 1 FROM public.ticket_link_signups WHERE link_id=v_link),
    'refused requests leave no sign-up behind');
  PERFORM public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827x_person('h5@example.test'),
    ARRAY[f.o_day1,f.o_day1], gen_random_uuid(), NULL, 'i3827-adv-qr-pepper-secret-value');
  PERFORM pg_temp.i3827x_assert((SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=1,
    'a repeated date in the set issues one pass');
END $hostile_dates$;

DO $single_refuses_set$
DECLARE f record; v_hash text := repeat('d',64); v_link uuid := gen_random_uuid(); v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827x_fixture('single', 'single', 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Single',NULL,1,'auto',NULL,
    v_link,decode('c0112233445566778899aabbccddeeff','hex'),v_hash);
  v_err := pg_temp.i3827x_err(format('SELECT public.pg_ticket_link_signup_days(%L,%L::jsonb,ARRAY[%L,%L]::uuid[],%L,NULL,%L)',
    v_hash, pg_temp.i3827x_person('s1@example.test'), f.o_day1, gen_random_uuid(), gen_random_uuid(), 'i3827-adv-qr-pepper-secret-value'));
  PERFORM pg_temp.i3827x_assert(v_err='invalid_request', 'a single-date event refuses a set of dates');
END $single_refuses_set$;

DO $all_days$
DECLARE f record; v_hash text := repeat('e',64); v_link uuid := gen_random_uuid(); v_r jsonb; v_order uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827x_fixture('alldays', 'multi', 'all_days', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'All days',NULL,1,'auto',NULL,
    v_link,decode('d0112233445566778899aabbccddeeff','hex'),v_hash);
  PERFORM pg_temp.i3827x_assert((public.pg_ticket_link_resolve(v_hash)->>'allDaysPass')::boolean,
    'the resolver says an all-days pass');
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827x_person('a1@example.test'),
    ARRAY[f.o_day1], gen_random_uuid(), NULL, 'i3827-adv-qr-pepper-secret-value');
  SELECT id INTO v_order FROM public.orders WHERE ticket_link_id=v_link;
  PERFORM pg_temp.i3827x_assert(
    (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=1
    AND (SELECT count(*) FROM public.tickets WHERE order_id=v_order)=1
    AND (SELECT count(*) FROM public.ticket_event_dates ted JOIN public.tickets t ON t.id=ted.ticket_id WHERE t.order_id=v_order)=2
    AND (SELECT event_date_id FROM public.orders WHERE id=v_order)=f.o_day2
    AND (SELECT sold_count FROM public.ticket_types WHERE id=f.o_free)=1,
    'an all-days pass is one pass valid on every date, anchored on the last date, using one place');
END $all_days$;

DO $recurring_night$
DECLARE f record; v_hash text := repeat('f',64); v_link uuid := gen_random_uuid(); v_err text; v_r jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827x_fixture('night', 'recurring', 'per_day', 1);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Nights',NULL,1,'auto',NULL,
    v_link,decode('e0112233445566778899aabbccddeeff','hex'),v_hash);
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827x_person('n1@example.test'),
    ARRAY[f.o_day1], gen_random_uuid(), NULL, 'i3827-adv-qr-pepper-secret-value');
  PERFORM pg_temp.i3827x_assert(v_r->>'status'='issued', 'night one takes its one place');
  v_err := pg_temp.i3827x_err(format('SELECT public.pg_ticket_link_signup_days(%L,%L::jsonb,ARRAY[%L,%L]::uuid[],%L,NULL,%L)',
    v_hash, pg_temp.i3827x_person('n2@example.test'), f.o_day1, f.o_day2, gen_random_uuid(), 'i3827-adv-qr-pepper-secret-value'));
  PERFORM pg_temp.i3827x_assert(v_err='ticket_capacity_exceeded'
    AND NOT EXISTS (SELECT 1 FROM public.orders WHERE ticket_link_id=v_link AND buyer_email='n2@example.test'),
    'a full night refuses the whole group, including the open night');
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827x_person('n2@example.test'),
    ARRAY[f.o_day2], gen_random_uuid(), NULL, 'i3827-adv-qr-pepper-secret-value');
  PERFORM pg_temp.i3827x_assert(v_r->>'status'='issued', 'the open night alone still has its place');
END $recurring_night$;

DO $pending_per_date$
DECLARE f record; v_hash text := repeat('0',64); v_link uuid := gen_random_uuid(); v_r jsonb; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827x_fixture('pend', 'multi', 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Pending',1,1,'host',NULL,
    v_link,decode('f0112233445566778899aabbccddeeff','hex'),v_hash);
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827x_person('p1@example.test'),
    ARRAY[f.o_day1], gen_random_uuid(), NULL, 'i3827-adv-qr-pepper-secret-value');
  PERFORM pg_temp.i3827x_assert(v_r->>'status'='pending', 'day one waits for approval');
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827x_person('p1@example.test'),
    ARRAY[f.o_day1], gen_random_uuid(), NULL, 'i3827-adv-qr-pepper-secret-value');
  PERFORM pg_temp.i3827x_assert((v_r->>'alreadyPending')::boolean
    AND (SELECT count(*) FROM public.ticket_link_signups WHERE link_id=v_link)=1,
    'the same date while waiting returns the waiting request');
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827x_person('p1@example.test'),
    ARRAY[f.o_day2], gen_random_uuid(), NULL, 'i3827-adv-qr-pepper-secret-value');
  PERFORM pg_temp.i3827x_assert(v_r->>'status'='pending'
    AND (SELECT count(*) FROM public.ticket_link_signups WHERE link_id=v_link)=2,
    'a new date while the first waits is its own request');
  PERFORM public.biz_ticket_link_revoke(f.o_owner,v_link);
  PERFORM pg_temp.i3827x_assert(
    NOT EXISTS (SELECT 1 FROM public.ticket_link_member_passes p JOIN public.ticket_link_signups s ON s.id=p.signup_id
      WHERE s.link_id=v_link AND p.status='pending'),
    'revoking the link declines every waiting date');
  v_err := pg_temp.i3827x_err(format('SELECT public.biz_ticket_link_decide(%L,%L,''approve'',%L,%L)',
    f.o_owner, (SELECT id FROM public.ticket_link_signups WHERE link_id=v_link ORDER BY created_at LIMIT 1),
    gen_random_uuid(), 'i3827-adv-qr-pepper-secret-value'));
  PERFORM pg_temp.i3827x_assert(NOT EXISTS (SELECT 1 FROM public.orders WHERE ticket_link_id=v_link),
    'a declined request issues nothing on a late approve');
END $pending_per_date$;

DO $people_limit$
DECLARE f record; v_hash text := repeat('9',64); v_link uuid := gen_random_uuid(); v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827x_fixture('limit', 'multi', 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Limit',1,1,'auto',NULL,
    v_link,decode('01112233445566778899aabbccddeeff','hex'),v_hash);
  PERFORM public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827x_person('l1@example.test'),
    ARRAY[f.o_day1,f.o_day2], gen_random_uuid(), NULL, 'i3827-adv-qr-pepper-secret-value');
  v_err := pg_temp.i3827x_err(format('SELECT public.pg_ticket_link_signup_days(%L,%L::jsonb,ARRAY[%L]::uuid[],%L,NULL,%L)',
    v_hash, pg_temp.i3827x_person('l2@example.test'), f.o_day1, gen_random_uuid(), 'i3827-adv-qr-pepper-secret-value'));
  PERFORM pg_temp.i3827x_assert(v_err='link_full'
    AND (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=2,
    'a second person is refused by a one-person link that holds two passes');
END $people_limit$;

ROLLBACK;
