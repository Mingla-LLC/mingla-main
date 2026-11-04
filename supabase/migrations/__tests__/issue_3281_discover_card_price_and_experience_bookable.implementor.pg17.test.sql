-- #3281 Discover cards price only the tickets a guest can buy on the card's date,
-- and an experience is listed only on a date it can be booked.
-- MINGLA-INVARIANT: I-3281-DISCOVER-CARD-PRICE-ON-DATE | issue #3281 | Card price, sale, free flag and price filter in discover_v2_event_base and discover_v2_items come from issue_3281_discover_card_prices on the card's date. Events: tiers buyable that date (all visible tiers if none sell online). Experiences: listed on the first window date with a tier bookable by capacity_scope.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t3281c_check(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    PERFORM set_config('t3281c.failures',
      COALESCE(NULLIF(current_setting('t3281c.failures', true), ''), '') || E'\n  - ' || p_message, true);
  END IF;
END
$$;

CREATE FUNCTION pg_temp.t3281c_base(p_city text, p_event uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT r FROM public.discover_v2_event_base(ARRAY[p_city], now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL) AS b(r)
   WHERE r->>'id' = p_event::text
$$;

CREATE FUNCTION pg_temp.t3281c_item(p_kind text, p_city text, p_event uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT i FROM jsonb_array_elements(
      public.discover_v2_items(p_kind, ARRAY[p_city], 0, 0, 1, 'UTC', p_filters, 0, 50)->'items') AS x(i)
   WHERE i->>'id' = p_event::text
$$;

-- The all-in price of a base amount for this event, by the formula
-- discover_v2_from_price_minor uses.
CREATE FUNCTION pg_temp.t3281c_all_in(p_event uuid, p_base integer)
RETURNS integer LANGUAGE sql AS $$
  SELECT public.compute_all_in_cents(p_base,
    COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
    COALESCE(e.pass_service_fee, b.default_pass_service_fee),
    (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r))
    FROM public.events e JOIN public.brands b ON b.id = e.brand_id WHERE e.id = p_event
$$;

DO $test$
DECLARE
  v_owner uuid := '32819500-0000-4000-8500-000000000001';
  v_brand uuid := '32819500-0000-4000-8500-000000000002';
  -- Events
  v_ended uuid := '32819500-0000-4000-8500-000000000010';     -- cheap tier's sale ended
  v_soldout uuid := '32819500-0000-4000-8500-000000000011';   -- cheap tier sold out
  v_freeclosed uuid := '32819500-0000-4000-8500-000000000012';-- free tier's sale ended
  v_pernight uuid := '32819500-0000-4000-8500-000000000013';  -- cheap tier full on the card's night
  v_door uuid := '32819500-0000-4000-8500-000000000014';      -- sells no tier online
  v_open uuid := '32819500-0000-4000-8500-000000000015';      -- every tier buyable
  -- Experiences
  x_ended uuid := '32819500-0000-4000-8500-000000000020';     -- only tier's sale ended
  x_full uuid := '32819500-0000-4000-8500-000000000021';      -- one start time, full
  x_later uuid := '32819500-0000-4000-8500-000000000022';     -- first date's start full, second open
  x_perday uuid := '32819500-0000-4000-8500-000000000023';    -- per-day cap full on first date
  x_cancel uuid := '32819500-0000-4000-8500-000000000024';    -- first date cancelled
  x_freeclosed uuid := '32819500-0000-4000-8500-000000000025';-- free tier closed, paid tier open
  v_d1 timestamptz := date_trunc('hour', now()) + interval '10 days';
  v_d2 timestamptz := date_trunc('hour', now()) + interval '12 days';
  v_i integer := 0;
  v_event uuid;
  v_tt uuid;
  v_date uuid;
  v_session uuid;
  v_row jsonb;
  v_item jsonb;
  v_n integer;
BEGIN
  PERFORM set_config('t3281c.failures', '', true);
  INSERT INTO auth.users(id,email) VALUES(v_owner,'discover-card-price-owner@example.test');
  INSERT INTO public.profiles(id,email) VALUES(v_owner,'discover-card-price-owner@example.test');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES(v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,paystack_subaccount_code,created_at,updated_at)
    VALUES(v_brand,v_owner,'Discover card price brand','discover-card-price-brand','USD','ACCT_t3281c',now(),now());
  INSERT INTO public.admin_internal_brands(brand_id,is_internal,reason,marked_by)
    VALUES(v_brand,false,'#3281 discover card price fixture','pg17');

  -- ---------------------------------------------------------------------------
  -- Events: two dates each, one city each.
  FOREACH v_event IN ARRAY ARRAY[v_ended,v_soldout,v_freeclosed,v_pernight,v_door,v_open] LOOP
    v_i := v_i + 1;
    INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
        city,location_geo,published_at,is_recurring,is_multi_date,created_at,updated_at)
      VALUES(v_event,v_brand,v_owner,'Card price '||v_i,'card-price-'||v_i,'event','scheduled','public','UTC','USD',
        '#3281C City '||v_i,point(-170 + v_i * 20, -20),now(),v_event = v_pernight,false,now(),now());
    INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
      (v_event,v_d1,v_d1 + interval '4 hours','UTC',true,'d1'),
      (v_event,v_d2,v_d2 + interval '4 hours','UTC',false,'d2');
  END LOOP;
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sale_end_at,sold_count)
    VALUES
      (v_ended,'Early bird',1000,'USD',false,50,false,1,4,true,false,0,now() - interval '1 day',0),
      (v_ended,'General',3000,'USD',false,50,false,1,4,true,false,1,NULL,0),
      (v_soldout,'Cheap',1000,'USD',false,10,false,1,4,true,false,0,NULL,10),
      (v_soldout,'General',2500,'USD',false,50,false,1,4,true,false,1,NULL,0),
      (v_freeclosed,'Free list',0,'USD',true,50,false,1,4,true,false,0,now() - interval '1 day',0),
      (v_freeclosed,'General',2000,'USD',false,50,false,1,4,true,false,1,NULL,0),
      (v_pernight,'VIP',4000,'USD',false,NULL,true,1,4,true,false,1,NULL,0),
      -- No tier sells online: today's price over every visible tier stays.
      (v_door,'Door',1500,'USD',false,50,false,1,4,false,true,0,NULL,0),
      (v_door,'Door early',800,'USD',false,50,false,1,4,false,true,1,now() - interval '1 day',0),
      (v_open,'Free RSVP',0,'USD',true,50,false,1,4,true,false,0,NULL,0),
      (v_open,'General',1200,'USD',false,50,false,1,4,true,false,1,NULL,0),
      (v_open,'VIP',5000,'USD',false,NULL,true,1,4,true,false,2,NULL,0);
  -- Per-night: two seats a night at 500, both held on d1 (the card's night).
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order)
    VALUES (v_pernight,'Two seats',500,'USD',false,2,false,1,2,true,false,0) RETURNING id INTO v_tt;
  SELECT id INTO v_date FROM public.event_dates WHERE event_id = v_pernight AND occurrence_key = 'd1';
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,buyer_phone_e164,
      status,idempotency_key,expires_at)
    VALUES (v_session,v_pernight,v_brand,'Holder','holder-card@example.test','+15555550191',
      'pending_free','t3281c:'||v_pernight::text,now()+interval '15 minutes');
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,ticket_name_at_purchase,quantity)
    VALUES (v_session,v_tt,'Two seats',2);
  INSERT INTO public.ticket_checkout_session_event_dates(checkout_session_id,event_date_id) VALUES (v_session,v_date);

  -- (a) a tier whose sale ended is not the from-price, min or max.
  v_row := pg_temp.t3281c_base('#3281C City 1', v_ended);
  v_item := pg_temp.t3281c_item('events', '#3281C City 1', v_ended);
  PERFORM pg_temp.t3281c_check((v_row->>'price_min_cents')::int = 3000 AND (v_row->>'price_max_cents')::int = 3000
      AND (v_row->>'display_price_cents')::int = pg_temp.t3281c_all_in(v_ended, 3000)
      AND (v_item->'price'->>'listMinor')::int = pg_temp.t3281c_all_in(v_ended, 3000),
    format('(a) ended sale: card priced from the open tier only (base %s, item %s)', v_row, v_item->'price'));
  -- (b) a sold-out tier is not the from-price.
  v_row := pg_temp.t3281c_base('#3281C City 2', v_soldout);
  v_item := pg_temp.t3281c_item('events', '#3281C City 2', v_soldout);
  PERFORM pg_temp.t3281c_check((v_row->>'price_min_cents')::int = 2500
      AND (v_item->'price'->>'listMinor')::int = pg_temp.t3281c_all_in(v_soldout, 2500),
    format('(b) sold out: card priced from the tier with places left (base %s, item %s)', v_row->>'price_min_cents', v_item->'price'));
  -- (c) a free tier whose sale closed does not make the card free.
  v_row := pg_temp.t3281c_base('#3281C City 3', v_freeclosed);
  v_item := pg_temp.t3281c_item('events', '#3281C City 3', v_freeclosed);
  PERFORM pg_temp.t3281c_check((v_row->>'price_min_cents')::int = 2000
      AND (v_item->'price'->>'isFree')::boolean IS FALSE
      AND (v_item->'price'->>'listMinor')::int = pg_temp.t3281c_all_in(v_freeclosed, 2000)
      AND pg_temp.t3281c_item('events', '#3281C City 3', v_freeclosed,
            '{"price":["free_ticket"]}'::jsonb) IS NULL,
    format('(c) closed free tier: card is not free and the Free filter skips it (base %s, item %s)',
      v_row->>'price_min_cents', v_item->'price'));
  -- (d) per-night: the cheap tier is full on the card's night, so it is not the price.
  v_row := pg_temp.t3281c_base('#3281C City 4', v_pernight);
  v_item := pg_temp.t3281c_item('events', '#3281C City 4', v_pernight);
  PERFORM pg_temp.t3281c_check((v_row->>'next_start_at')::timestamptz = v_d1
      AND (v_row->>'price_min_cents')::int = 4000
      AND (v_item->>'startsAtUtc')::timestamptz = v_d1
      AND (v_item->'price'->>'listMinor')::int = pg_temp.t3281c_all_in(v_pernight, 4000),
    format('(d) per-night: a tier full on the card''s night is not its price (base %s, item %s)',
      v_row->>'price_min_cents', v_item->'price'));
  -- (e) an event that sells no tier online keeps today's price over every visible tier.
  v_row := pg_temp.t3281c_base('#3281C City 5', v_door);
  v_item := pg_temp.t3281c_item('events', '#3281C City 5', v_door);
  PERFORM pg_temp.t3281c_check((v_row->>'price_min_cents')::int = 800 AND (v_row->>'price_max_cents')::int = 1500
      AND (v_row->>'display_price_cents')::int = public.discover_v2_from_price_minor(v_door)
      AND (v_item->'price'->>'listMinor')::int = public.discover_v2_from_price_minor(v_door)
      AND (v_item->'price'->>'isFree')::boolean IS FALSE,
    format('(e) no online tier: today''s price stays (base %s, item %s)', v_row, v_item->'price'));
  -- (f) every tier buyable: the same answer as the per-event owners.
  v_row := pg_temp.t3281c_base('#3281C City 6', v_open);
  v_item := pg_temp.t3281c_item('events', '#3281C City 6', v_open);
  PERFORM pg_temp.t3281c_check((v_row->>'price_min_cents')::int = 0 AND (v_row->>'price_max_cents')::int = 5000
      AND (v_row->>'display_price_cents')::int = public.discover_v2_from_price_minor(v_open)
      AND (v_item->'price'->>'listMinor')::int = (SELECT d.display_price_cents FROM public.issue_3872_event_display_prices(v_open) d)
      AND (v_item->'price'->>'saleMinor') IS NULL
      AND (v_item->'price'->>'isFree')::boolean IS TRUE,
    format('(f) all tiers buyable: price unchanged (base %s, item %s)', v_row, v_item->'price'));

  -- ---------------------------------------------------------------------------
  -- Experiences: one hour windows on two dates, start every 60 minutes (one
  -- start time a date), one city each (the first stop's city).
  v_i := 0;
  FOREACH v_event IN ARRAY ARRAY[x_ended,x_full,x_later,x_perday,x_cancel,x_freeclosed] LOOP
    v_i := v_i + 1;
    INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
        city,published_at,experience_intents,capacity_scope,booking_spacing_minutes,min_notice_minutes,
        created_at,updated_at)
      VALUES(v_event,v_brand,v_owner,'Card experience '||v_i,'card-experience-'||v_i,'experience','scheduled','public',
        'UTC','USD','#3281C Exp '||v_i,now(),ARRAY['group-fun'],
        CASE WHEN v_event = x_perday THEN 'per_day' WHEN v_event IN (x_full,x_later) THEN 'per_start' ELSE 'total' END,
        60,120,now(),now());
    INSERT INTO public.experience_stops(event_id,stop_order,place_name,address,city,country_code,lat,lng)
      VALUES(v_event,0,'Stop '||v_i,'Somewhere','#3281C Exp '||v_i,'US',-40 - v_i,100 + v_i);
    INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
      (v_event,v_d1,v_d1 + interval '1 hour','UTC',true,'d1'),
      (v_event,v_d2,v_d2 + interval '1 hour','UTC',false,'d2');
  END LOOP;
  UPDATE public.event_dates SET cancelled_at = now() WHERE event_id = x_cancel AND occurrence_key = 'd1';
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sale_end_at)
    VALUES
      (x_ended,'Place',1500,'USD',false,10,false,1,4,true,false,0,now() - interval '1 day'),
      (x_cancel,'Place',1500,'USD',false,10,false,1,4,true,false,0,NULL),
      (x_freeclosed,'Free taster',0,'USD',true,10,false,1,4,true,false,0,now() - interval '1 day'),
      (x_freeclosed,'Place',2000,'USD',false,10,false,1,4,true,false,1,NULL);
  -- Per start time: two places, held on every start time of x_full and on d1 of x_later.
  FOREACH v_event IN ARRAY ARRAY[x_full,x_later] LOOP
    INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
        min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order)
      VALUES (v_event,'Place',1500,'USD',false,2,false,1,2,true,false,0) RETURNING id INTO v_tt;
    FOR v_date IN SELECT id FROM public.event_dates WHERE event_id = v_event
                   AND (v_event = x_full OR occurrence_key = 'd1') LOOP
      v_session := gen_random_uuid();
      INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,buyer_phone_e164,
          status,idempotency_key,expires_at,booked_start_at,booked_end_at)
        SELECT v_session,v_event,v_brand,'Holder','holder-slot@example.test','+15555550192',
          'pending_free','t3281c:'||v_session::text,now()+interval '15 minutes',d.start_at,d.start_at + interval '1 hour'
          FROM public.event_dates d WHERE d.id = v_date;
      INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,ticket_name_at_purchase,quantity)
        VALUES (v_session,v_tt,'Place',2);
      INSERT INTO public.ticket_checkout_session_event_dates(checkout_session_id,event_date_id) VALUES (v_session,v_date);
    END LOOP;
  END LOOP;
  -- Per day: one place a day, held on d1. Lifetime sold_count stays 0.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order)
    VALUES (x_perday,'Place',1500,'USD',false,1,false,1,1,true,false,0) RETURNING id INTO v_tt;
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,buyer_phone_e164,
      status,idempotency_key,expires_at)
    VALUES (v_session,x_perday,v_brand,'Holder','holder-day@example.test','+15555550193',
      'pending_free','t3281c:'||v_session::text,now()+interval '15 minutes');
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,ticket_name_at_purchase,quantity)
    VALUES (v_session,v_tt,'Place',1);
  INSERT INTO public.ticket_checkout_session_event_dates(checkout_session_id,event_date_id)
    SELECT v_session, d.id FROM public.event_dates d WHERE d.event_id = x_perday AND d.occurrence_key = 'd1';

  -- (g) an experience whose only tier's sale ended is not listed.
  PERFORM pg_temp.t3281c_check(pg_temp.t3281c_item('experiences', '#3281C Exp 1', x_ended) IS NULL,
    '(g) experience with only a past-sale-end tier is listed');
  -- (h) an experience whose every start time is full is not listed.
  PERFORM pg_temp.t3281c_check(pg_temp.t3281c_item('experiences', '#3281C Exp 2', x_full) IS NULL,
    '(h) experience whose only start times are full (per start time) is listed');
  -- (i) the first date's start time is full: listed on the second date, at its price.
  v_item := pg_temp.t3281c_item('experiences', '#3281C Exp 3', x_later);
  PERFORM pg_temp.t3281c_check((v_item->>'startsAtUtc')::timestamptz = v_d2
      AND (v_item->'price'->>'listMinor')::int = pg_temp.t3281c_all_in(x_later, 1500),
    format('(i) open start time: card shows the date that can be booked (%s)', v_item));
  -- (j) per day: the first date is full, the card shows the second.
  v_item := pg_temp.t3281c_item('experiences', '#3281C Exp 4', x_perday);
  PERFORM pg_temp.t3281c_check((v_item->>'startsAtUtc')::timestamptz = v_d2,
    format('(j) per-day capacity: card shows the date with a place left (%s)', v_item->>'startsAtUtc'));
  -- (k) a cancelled first date is skipped.
  v_item := pg_temp.t3281c_item('experiences', '#3281C Exp 5', x_cancel);
  PERFORM pg_temp.t3281c_check((v_item->>'startsAtUtc')::timestamptz = v_d2,
    format('(k) cancelled date: card shows the next date (%s)', v_item->>'startsAtUtc'));
  -- (l) a closed free tier does not make the experience free.
  v_item := pg_temp.t3281c_item('experiences', '#3281C Exp 6', x_freeclosed);
  PERFORM pg_temp.t3281c_check((v_item->'price'->>'isFree')::boolean IS FALSE
      AND (v_item->'price'->>'listMinor')::int = pg_temp.t3281c_all_in(x_freeclosed, 2000)
      AND pg_temp.t3281c_item('experiences', '#3281C Exp 6', x_freeclosed, '{"price":["free"]}'::jsonb) IS NULL,
    format('(l) closed free tier: experience is not free (%s)', v_item->'price'));
  -- (m) counts follow: the experience total counts only bookable experiences.
  SELECT count(*) INTO v_n FROM unnest(ARRAY['#3281C Exp 1','#3281C Exp 2','#3281C Exp 3','#3281C Exp 4',
      '#3281C Exp 5','#3281C Exp 6']) c
   WHERE (public.discover_v2_items('experiences', ARRAY[c], 0, 0, 1, 'UTC', '{}'::jsonb, 0, 50)->>'total')::int = 1;
  PERFORM pg_temp.t3281c_check(v_n = 4, format('(m) %s of 6 experience cities count one listing; expected 4', v_n));

  -- ---------------------------------------------------------------------------
  -- (n) Shape: the new functions are plain inlinable SQL, private, inlined into
  -- the readers' plans.
  PERFORM pg_temp.t3281c_check((
    SELECT count(*) FROM pg_catalog.pg_proc p
     WHERE p.oid IN (to_regprocedure('public.issue_3281_discover_card_prices(uuid,uuid,boolean,boolean)'),
                     to_regprocedure('public.issue_3281_experience_date_bookable_ticket_types(uuid,uuid)'))
       AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql')
       AND p.proretset AND p.provolatile = 's'
       AND NOT p.prosecdef AND NOT p.proisstrict AND p.proconfig IS NULL) = 2,
    '(n) the card price and bookable functions exist as plain inlinable SQL');
  IF to_regprocedure('public.issue_3281_discover_card_prices(uuid,uuid,boolean,boolean)') IS NOT NULL THEN
    PERFORM pg_temp.t3281c_check(
      NOT has_function_privilege('anon','public.issue_3281_discover_card_prices(uuid,uuid,boolean,boolean)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.issue_3281_discover_card_prices(uuid,uuid,boolean,boolean)','EXECUTE')
        AND NOT has_function_privilege('anon','public.issue_3281_experience_date_bookable_ticket_types(uuid,uuid)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.issue_3281_experience_date_bookable_ticket_types(uuid,uuid)','EXECUTE')
        AND has_function_privilege('service_role','public.issue_3281_discover_card_prices(uuid,uuid,boolean,boolean)','EXECUTE')
        AND has_function_privilege('service_role','public.issue_3281_experience_date_bookable_ticket_types(uuid,uuid)','EXECUTE'),
      '(n) only service_role (and the owner) may execute the new functions');
  END IF;
  -- The readers keep their ACL.
  PERFORM pg_temp.t3281c_check(
    NOT has_function_privilege('anon','public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8)','EXECUTE')
      AND has_function_privilege('service_role','public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)','EXECUTE'),
    '(n) the readers stay service_role only');

  IF COALESCE(current_setting('t3281c.failures', true), '') <> '' THEN
    RAISE EXCEPTION '#3281 discover card price FAIL:%', current_setting('t3281c.failures', true);
  END IF;
END;
$test$;

-- (o) Plan: the card price and bookable rule inline into a reader-shaped query
-- (no Function Scan of either), so the planner sees the tier scans.
DO $plan$
DECLARE
  v_plan jsonb;
  v_scans text;
BEGIN
  EXECUTE $q$EXPLAIN (FORMAT JSON)
    SELECT e.id, p.*
      FROM public.events e
      JOIN public.event_dates d ON d.event_id = e.id
      CROSS JOIN LATERAL public.issue_3281_discover_card_prices(e.id, d.id, e.event_type = 'experience', true) p
     WHERE e.slug LIKE 'card-%'
       AND EXISTS (SELECT 1 FROM public.issue_3281_experience_date_bookable_ticket_types(e.id, d.id))$q$ INTO v_plan;
  SELECT string_agg(n->>'Function Name', ',') INTO v_scans
    FROM jsonb_path_query(v_plan, 'strict $.**') AS x(n)
   WHERE jsonb_typeof(n) = 'object' AND n->>'Node Type' = 'Function Scan'
     AND n->>'Function Name' IN ('issue_3281_discover_card_prices', 'issue_3281_experience_date_bookable_ticket_types',
                                 'issue_3281_date_buyable_ticket_types');
  IF v_scans IS NOT NULL THEN
    RAISE EXCEPTION '#3281 discover card price FAIL: (o) not inlined: %', v_scans;
  END IF;
END;
$plan$;

ROLLBACK;
