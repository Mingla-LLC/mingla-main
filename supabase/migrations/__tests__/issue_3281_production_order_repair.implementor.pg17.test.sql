-- #3281 uneven per-date carts: quote, session and minted tickets must agree.
-- MINGLA-INVARIANT: I-3281-BY-DATE-QUOTE-MATCHES-MINT | issue #3281 | An uneven per-date cart quotes, reserves and mints each date's own quantity, never quantity times days.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '32817000-0000-4000-8400-000000000001';
  v_brand uuid := '32817000-0000-4000-8400-000000000002';
  v_event uuid := '32817000-0000-4000-8400-000000000003';
  v_ticket uuid := '32817000-0000-4000-8400-000000000004';
  v_day_one uuid := '32817000-0000-4000-8400-000000000005';
  v_day_two uuid := '32817000-0000-4000-8400-000000000006';
  v_day_three uuid := '32817000-0000-4000-8400-000000000007';
  v_days uuid[];
  v_line jsonb;
  v_quote jsonb;
  v_uniform jsonb;
  v_created jsonb;
  v_session uuid;
  v_item record;
  v_count integer;
  v_raised boolean;
BEGIN
  v_days := ARRAY[v_day_one,v_day_two,v_day_three];
  INSERT INTO auth.users(id,email) VALUES(v_owner,'by-date-owner@example.test');
  INSERT INTO public.creator_accounts(id,email)
    VALUES(v_owner,'by-date-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'By date brand','by-date-brand',
    'USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_by_date',true,true,'US','usd');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
    is_multi_date,multi_date_pricing_mode
  ) VALUES(v_event,v_brand,v_owner,'By date event','by-date-event',
    'event','scheduled','public','UTC','USD',true,'per_day');
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master) VALUES
    (v_day_one,v_event,now()+interval '1 day',now()+interval '1 day 2 hours','UTC',true),
    (v_day_two,v_event,now()+interval '2 days',now()+interval '2 days 2 hours','UTC',false),
    (v_day_three,v_event,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',false);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person
  ) VALUES(v_ticket,v_event,'General',2000,'USD',false,100,false,1,10,true,false);

  v_line := jsonb_build_object('ticketTypeId',v_ticket,'quantity',3,'byDate',
    jsonb_build_object(v_day_one::text,2,v_day_two::text,1));

  -- Without the repair this cart quotes 3 x 3 days = 9 tickets for 18000.
  v_quote := public.issue_3872_ticket_quote(
    v_event,jsonb_build_array(v_line),v_days,NULL,NULL,NULL,
    'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  IF (v_quote->>'netSubtotalCents')::bigint <> 6000
     OR (v_quote->'lines'->0->>'quantity')::integer <> 3 THEN
    RAISE EXCEPTION 'uneven quote must be 3 tickets for 6000, got %',v_quote;
  END IF;

  v_uniform := public.issue_3872_ticket_quote(
    v_event,jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',1)),
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  IF (v_uniform->>'netSubtotalCents')::bigint <> 6000 THEN
    RAISE EXCEPTION 'uniform carts must keep quantity times days, got %',v_uniform;
  END IF;

  v_raised := false;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(
      v_event,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',1,'byDate',
        jsonb_build_object(gen_random_uuid()::text,1))),
      v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='ticket_quantity_invalid' THEN v_raised:=true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'a date outside the cart must be refused'; END IF;

  UPDATE public.events SET multi_date_pricing_mode='all_days' WHERE id=v_event;
  v_raised := false;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(
      v_event,jsonb_build_array(v_line),v_days,NULL,NULL,NULL,'full',NULL,
      'buyer@example.test','+15555550801',NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='by_date_not_supported_for_all_days' THEN v_raised:=true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'all-days passes must refuse byDate'; END IF;
  UPDATE public.events SET multi_date_pricing_mode='per_day' WHERE id=v_event;

  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550801',false,
    jsonb_build_array(v_line),'by-date-repair',now()+interval '15 minutes',0,'full',
    v_days,NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');
  v_session := COALESCE(v_created->>'sessionId',v_created->>'checkoutSessionId')::uuid;
  SELECT quantity,total_cents,by_date INTO v_item
    FROM public.ticket_checkout_session_items WHERE checkout_session_id=v_session;
  IF v_item.quantity <> 3 OR v_item.total_cents <> 6000
     OR (v_item.by_date->>v_day_one::text)::integer <> 2 THEN
    RAISE EXCEPTION 'session must match the quote, got % %',v_item.quantity,v_item.total_cents;
  END IF;

  -- The base owns minting; the wrapper's provider evidence is proven elsewhere.
  PERFORM public.issue_1930_ticket_checkout_finalize_base(
    v_session,'pi_by_date_repair','ch_by_date_repair','card','by-date-test-pepper-0123456789abcdef0123456789');
  SELECT count(*) INTO v_count
    FROM public.ticket_event_dates d JOIN public.tickets t ON t.id=d.ticket_id
   WHERE t.ticket_type_id=v_ticket AND d.event_date_id=v_day_one;
  IF v_count <> 2 THEN RAISE EXCEPTION 'first date must mint 2, got %',v_count; END IF;
  SELECT count(*) INTO v_count
    FROM public.ticket_event_dates d JOIN public.tickets t ON t.id=d.ticket_id
   WHERE t.ticket_type_id=v_ticket AND d.event_date_id=v_day_two;
  IF v_count <> 1 THEN RAISE EXCEPTION 'second date must mint 1, got %',v_count; END IF;
  SELECT count(*) INTO v_count
    FROM public.ticket_event_dates d JOIN public.tickets t ON t.id=d.ticket_id
   WHERE t.ticket_type_id=v_ticket AND d.event_date_id=v_day_three;
  IF v_count <> 0 THEN RAISE EXCEPTION 'third date must mint 0, got %',v_count; END IF;

END;
$test$;

ROLLBACK;
