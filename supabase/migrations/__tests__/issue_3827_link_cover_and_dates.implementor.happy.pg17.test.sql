-- issue #3827 — private link page: video cover and several dates per sign-up,
-- implementor happy path (pg17 post-replay).
-- MINGLA-INVARIANT: I-3827-LINK-COVER-ACTIVE-ONLY | issue #3827 | the link resolver names the cover media type and poster only while the link is active.
-- MINGLA-INVARIANT: I-3827-LINK-LIMIT-COUNTS-PEOPLE | issue #3827 | a guest-list link's limit counts people; one guest holding passes for several dates uses one place.
-- MINGLA-INVARIANT: I-3827-LINK-DUPLICATE-PER-DATE | issue #3827 | on an event that asks for a date, a person is skipped only for a date they already hold; a new date is issued.
-- MINGLA-INVARIANT: I-3827-LINK-ONE-PASS-PER-DATE | issue #3827 | a per-day guest-list sign-up issues one pass per chosen date for every named person.

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3827d_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #3827 link dates FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3827d_err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

-- p_dates = 1 makes an ordinary single-date event; 2 makes a multi-date event.
CREATE OR REPLACE FUNCTION pg_temp.i3827d_fixture(
  p_tag text, p_dates integer, p_mode text, p_capacity integer,
  OUT o_event uuid, OUT o_free uuid, OUT o_paid uuid, OUT o_owner uuid,
  OUT o_day1 uuid, OUT o_day2 uuid
) LANGUAGE plpgsql AS $$
DECLARE v_brand uuid := gen_random_uuid();
BEGIN
  o_owner := gen_random_uuid(); o_event := gen_random_uuid();
  INSERT INTO auth.users(id,email) VALUES (o_owner, 'i3827d-' || o_owner || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(id,account_id,name,slug,payment_provider)
    VALUES (v_brand,o_owner,'Dates ' || p_tag,'i3827d-' || p_tag || '-' || v_brand,'stripe');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES (v_brand,'acct_i3827d_' || replace(v_brand::text,'-',''),true,true,'GB','gbp');
  INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency,
      cover_media_url,cover_media_type,cover_media_poster_url)
    VALUES (o_event,v_brand,'Dates event ' || p_tag,'i3827d-' || p_tag || '-' || o_event,'event','draft','draft','UTC','GBP',
      'https://vz-test.b-cdn.net/guid/play_720p.mp4','video','https://vz-test.b-cdn.net/guid/thumbnail.jpg');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES (o_event,now()+interval '1 day',now()+interval '1 day 5 hours','UTC',true)
    RETURNING id INTO o_day1;
  IF p_dates > 1 THEN
    INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
      VALUES (o_event,now()+interval '2 days',now()+interval '2 days 5 hours','UTC',false)
      RETURNING id INTO o_day2;
    UPDATE public.events SET is_multi_date = true, multi_date_pricing_mode = p_mode WHERE id = o_event;
  END IF;
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,is_hidden)
    VALUES (o_event,'Guest list',0,'GBP',true,p_capacity,false,1,10,true,true,0,false)
    RETURNING id INTO o_free;
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,is_hidden)
    VALUES (o_event,'Secret paid',1000,'GBP',false,20,false,1,4,true,true,1,true)
    RETURNING id INTO o_paid;
  PERFORM set_config('mingla.publish_free_only','on',true);
  UPDATE public.events SET status='scheduled',visibility='public',published_at=now() WHERE id=o_event;
  PERFORM set_config('mingla.publish_free_only','',true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3827d_people(p_n integer, p_tag text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object(
    'name', 'Person ' || i, 'email', p_tag || '-' || i || '@example.test',
    'phoneE164', '+1555000' || lpad(i::text, 4, '0')) ORDER BY i)
  FROM generate_series(1, p_n) AS i;
$$;

DO $cover$
DECLARE f record; v_hash text := repeat('1',64); v_link uuid := gen_random_uuid(); v_r jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827d_fixture('cover', 1, 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Cover',5,1,'auto',NULL,
    v_link,decode('40112233445566778899aabbccddeeff','hex'),v_hash);
  v_r := public.pg_ticket_link_resolve(v_hash);
  PERFORM pg_temp.i3827d_assert(v_r->>'state'='active'
    AND v_r#>>'{event,coverMediaType}'='video'
    AND v_r#>>'{event,coverPosterUrl}'='https://vz-test.b-cdn.net/guid/thumbnail.jpg'
    AND v_r#>>'{event,coverUrl}'='https://vz-test.b-cdn.net/guid/play_720p.mp4',
    'an active link names the video cover and its poster');
  PERFORM pg_temp.i3827d_assert(v_r->>'multiDatePricingMode'='per_day' AND v_r->>'allDaysPass'='false',
    'an active link names the date-choice settings');
  PERFORM public.biz_ticket_link_revoke(f.o_owner,v_link);
  v_r := public.pg_ticket_link_resolve(v_hash);
  PERFORM pg_temp.i3827d_assert(v_r->>'state'='revoked'
    AND NOT (v_r->'event' ? 'coverMediaType') AND NOT (v_r->'event' ? 'coverPosterUrl')
    AND NOT (v_r ? 'multiDatePricingMode'),
    'a revoked link adds no cover media or date settings');
END $cover$;

DO $two_dates$
DECLARE f record; v_hash text := repeat('2',64); v_link uuid := gen_random_uuid(); v_r jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827d_fixture('two', 2, 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Two days',2,2,'auto',NULL,
    v_link,decode('50112233445566778899aabbccddeeff','hex'),v_hash);
  v_r := public.pg_ticket_link_resolve(v_hash);
  PERFORM pg_temp.i3827d_assert(jsonb_array_length(v_r->'dates')=2, 'a multi-date link lists both dates');

  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827d_people(2,'pair'),
    ARRAY[f.o_day1,f.o_day2], gen_random_uuid(), repeat('a',64), 'i3827-link-dates-test-qr-pepper-secret');
  PERFORM pg_temp.i3827d_assert(v_r->>'status'='issued' AND (v_r->>'issuedCount')::int=2
    AND (v_r->>'issuedPasses')::int=4, 'two people on two dates issue four passes');
  PERFORM pg_temp.i3827d_assert(
    (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=4
    AND (SELECT count(DISTINCT event_date_id) FROM public.orders WHERE ticket_link_id=v_link)=2
    AND (SELECT count(*) FROM public.ticket_event_dates ted JOIN public.tickets t ON t.id=ted.ticket_id
          JOIN public.orders o ON o.id=t.order_id WHERE o.ticket_link_id=v_link)=4,
    'each pass is bound to its own date');
  PERFORM pg_temp.i3827d_assert(public.issue_3827_link_uses_taken(v_link)=2,
    'the link counts two people, not four passes');
  PERFORM pg_temp.i3827d_assert(
    (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link AND comp_party_lead_order_id IS NOT NULL)=2
    AND NOT EXISTS (SELECT 1 FROM public.orders g JOIN public.orders l ON l.id=g.comp_party_lead_order_id
      WHERE g.ticket_link_id=v_link AND l.event_date_id IS DISTINCT FROM g.event_date_id),
    'a guest''s pass on each date points to the lead''s pass on the same date');
  PERFORM pg_temp.i3827d_assert(public.issue_3827_link_state(
      (SELECT l FROM public.ticket_type_links l WHERE l.id=v_link), now())='full',
    'two people fill a two-person link');
END $two_dates$;

DO $per_date_duplicates$
DECLARE f record; v_hash text := repeat('3',64); v_link uuid := gen_random_uuid(); v_r jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827d_fixture('dup', 2, 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Dup',1,1,'auto',NULL,
    v_link,decode('60112233445566778899aabbccddeeff','hex'),v_hash);
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827d_people(1,'solo'),
    ARRAY[f.o_day1], gen_random_uuid(), repeat('b',64), 'i3827-link-dates-test-qr-pepper-secret');
  PERFORM pg_temp.i3827d_assert(v_r->>'status'='issued'
    AND (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=1, 'day one issued');
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827d_people(1,'solo'),
    ARRAY[f.o_day1], gen_random_uuid(), repeat('b',64), 'i3827-link-dates-test-qr-pepper-secret');
  PERFORM pg_temp.i3827d_assert((v_r->>'issuedCount')::int=0
    AND (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=1,
    'signing up again for the same date issues nothing');
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827d_people(1,'solo'),
    ARRAY[f.o_day1,f.o_day2], gen_random_uuid(), repeat('b',64), 'i3827-link-dates-test-qr-pepper-secret');
  PERFORM pg_temp.i3827d_assert((v_r->>'issuedPasses')::int=1
    AND (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=2
    AND (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link AND event_date_id=f.o_day2)=1,
    'adding a new date later issues only that date');
  PERFORM pg_temp.i3827d_assert(public.issue_3827_link_uses_taken(v_link)=1,
    'the second date did not use a second place on a one-person link');
END $per_date_duplicates$;

DO $capacity$
DECLARE f record; v_hash text := repeat('4',64); v_link uuid := gen_random_uuid(); v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827d_fixture('cap', 2, 'per_day', 3);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Cap',NULL,2,'auto',NULL,
    v_link,decode('70112233445566778899aabbccddeeff','hex'),v_hash);
  v_err := pg_temp.i3827d_err(format(
    'SELECT public.pg_ticket_link_signup_days(%L,%L::jsonb,ARRAY[%L,%L]::uuid[],%L,NULL,%L)',
    v_hash, pg_temp.i3827d_people(2,'cap'), f.o_day1, f.o_day2, gen_random_uuid(),
    'i3827-link-dates-test-qr-pepper-secret'));
  PERFORM pg_temp.i3827d_assert(v_err='ticket_capacity_exceeded'
    AND NOT EXISTS (SELECT 1 FROM public.orders WHERE ticket_link_id=v_link),
    'four passes against three places are refused and nothing is issued');
END $capacity$;

DO $approval$
DECLARE f record; v_hash text := repeat('5',64); v_link uuid := gen_random_uuid(); v_r jsonb; v_sold int; v_signup uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827d_fixture('appr', 2, 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Approve',3,1,'host',NULL,
    v_link,decode('80112233445566778899aabbccddeeff','hex'),v_hash);
  SELECT sold_count INTO v_sold FROM public.ticket_types WHERE id=f.o_free;
  v_r := public.pg_ticket_link_signup_days(v_hash, pg_temp.i3827d_people(1,'appr'),
    ARRAY[f.o_day1,f.o_day2], gen_random_uuid(), NULL, 'i3827-link-dates-test-qr-pepper-secret');
  PERFORM pg_temp.i3827d_assert(v_r->>'status'='pending'
    AND (SELECT sold_count FROM public.ticket_types WHERE id=f.o_free)=v_sold,
    'a two-date request waits and holds nothing');
  v_r := public.biz_ticket_link_requests(f.o_owner,f.o_event,NULL);
  PERFORM pg_temp.i3827d_assert(jsonb_array_length(v_r->0->'dates')=2, 'the host sees both dates');
  SELECT id INTO v_signup FROM public.ticket_link_signups WHERE link_id=v_link;
  v_r := public.biz_ticket_link_decide(f.o_owner,v_signup,'approve',gen_random_uuid(),'i3827-link-dates-test-qr-pepper-secret');
  PERFORM pg_temp.i3827d_assert(v_r->>'status'='issued'
    AND (SELECT sold_count FROM public.ticket_types WHERE id=f.o_free)=v_sold+2,
    'approval issues one pass per date');
END $approval$;

DO $single_date$
DECLARE f record; v_hash text := repeat('6',64); v_link uuid := gen_random_uuid(); v_r jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827d_fixture('single', 1, 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_free,NULL,'Single',5,2,'auto',NULL,
    v_link,decode('90112233445566778899aabbccddeeff','hex'),v_hash);
  v_r := public.pg_ticket_link_signup(v_hash, pg_temp.i3827d_people(2,'single'), NULL,
    gen_random_uuid(), NULL, 'i3827-link-dates-test-qr-pepper-secret');
  PERFORM pg_temp.i3827d_assert(v_r->>'status'='issued' AND (v_r->>'issuedCount')::int=2
    AND NOT (v_r ? 'issuedPasses') AND NOT (v_r ? 'eventDateIds'),
    'a single-date sign-up keeps its old answer');
  PERFORM pg_temp.i3827d_assert(
    NOT EXISTS (SELECT 1 FROM public.ticket_link_signups WHERE link_id=v_link AND per_date)
    AND NOT EXISTS (SELECT 1 FROM public.ticket_link_member_passes p JOIN public.ticket_link_signups s ON s.id=p.signup_id WHERE s.link_id=v_link)
    AND (SELECT array_agg(comp_request_key ORDER BY comp_request_key) FROM public.orders WHERE ticket_link_id=v_link)
      = (SELECT array_agg('link:' || s.id || ':' || i ORDER BY 'link:' || s.id || ':' || i)
           FROM public.ticket_link_signups s CROSS JOIN generate_series(0,1) i WHERE s.link_id=v_link),
    'a single-date sign-up writes no per-date rows and keeps its request keys');
  v_r := public.pg_ticket_link_signup(v_hash, pg_temp.i3827d_people(1,'single'), NULL,
    gen_random_uuid(), NULL, 'i3827-link-dates-test-qr-pepper-secret');
  PERFORM pg_temp.i3827d_assert((v_r->>'issuedCount')::int=0
    AND (SELECT count(*) FROM public.orders WHERE ticket_link_id=v_link)=2,
    'a single-date event still skips a person already on the list');
END $single_date$;

DO $paid_days$
DECLARE f record; v_hash text := repeat('7',64); v_link uuid := gen_random_uuid(); v_s jsonb; v_id uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827d_fixture('paid', 2, 'per_day', 10);
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_paid,NULL,'Paid days',5,1,'auto',NULL,
    v_link,decode('a0112233445566778899aabbccddeeff','hex'),v_hash);
  v_s := public.biz_ticket_link_checkout_create_session(v_hash,f.o_event,NULL,'Day Buyer',
    'days@example.test','+15550000099',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',f.o_paid,'quantity',1)),
    'i3827d-paid-'||f.o_event,now()+interval '15 minutes',0,'auto',ARRAY[f.o_day1,f.o_day2],NULL,NULL,NULL);
  v_id := (v_s->>'checkoutSessionId')::uuid;
  PERFORM pg_temp.i3827d_assert(
    (SELECT count(*) FROM public.ticket_checkout_session_event_dates WHERE checkout_session_id=v_id)=2
    AND (SELECT sum(quantity) FROM public.ticket_checkout_session_items WHERE checkout_session_id=v_id)=2
    AND (SELECT ticket_link_units FROM public.ticket_checkout_sessions WHERE id=v_id)=1,
    'paid link checkout carries both days, prices two day passes and uses one link place');
END $paid_days$;

ROLLBACK;
