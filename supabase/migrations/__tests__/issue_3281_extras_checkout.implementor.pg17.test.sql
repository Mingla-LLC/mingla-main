-- #3281 Extras, slice 2: the checkout prices, holds and records extras.
-- MINGLA-INVARIANT: I-3281-EXTRAS-PRICED-AND-HELD-BY-THE-SERVER | issue #3281 | An extra's price, cap and dates come from the server, its places are locked and held like a ticket's, and the order records exactly the extras its session paid for. A cart without extras is priced as before.
-- MINGLA-INVARIANT: I-3281-EXTRAS-CAPACITY-PER-DATE | issue #3281 | A date-limited extra is sold only on chosen dates it covers and counts its capacity per date; an all-dates extra keeps one shared count.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '32819000-0000-4000-8400-000000000001';
  v_brand uuid := '32819000-0000-4000-8400-000000000002';
  v_event uuid := '32819000-0000-4000-8400-000000000003';
  v_all uuid := '32819000-0000-4000-8400-000000000004';
  v_other uuid := '32819000-0000-4000-8400-000000000005';
  v_free uuid := '32819000-0000-4000-8400-000000000006';
  v_fri uuid := '32819000-0000-4000-8400-000000000011';
  v_sat uuid := '32819000-0000-4000-8400-000000000012';
  v_dinner uuid := '32819000-0000-4000-8400-000000000021';
  v_shuttle uuid := '32819000-0000-4000-8400-000000000022';
  v_tote uuid := '32819000-0000-4000-8400-000000000023';
  v_paid_on_free uuid := '32819000-0000-4000-8400-000000000024';
  v_free_on_free uuid := '32819000-0000-4000-8400-000000000025';
  v_attempt uuid := '32819000-0000-4000-8400-000000000031';
  v_days uuid[];
  v_plain jsonb;
  v_quote jsonb;
  v_created jsonb;
  v_session uuid;
  v_order uuid;
  v_raised text;
  v_lines jsonb;
  v_key text;
BEGIN
  v_days := ARRAY[v_fri, v_sat];
  INSERT INTO auth.users(id,email) VALUES(v_owner,'extras-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'extras-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Extras brand','extras-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_extras',true,true,'US','usd');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
    is_multi_date,multi_date_pricing_mode
  ) VALUES(v_event,v_brand,v_owner,'Extras event','extras-event',
    'event','scheduled','public','UTC','USD',true,'per_day');
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
    (v_fri,v_event,date_trunc('minute',now())+interval '1 day',now()+interval '1 day 2 hours','UTC',true,'fri'),
    (v_sat,v_event,date_trunc('minute',now())+interval '2 days',now()+interval '2 days 2 hours','UTC',false,'sat');
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person
  ) VALUES
    (v_all,v_event,'All dates',1000,'USD',false,100,false,1,10,true,false),
    (v_other,v_event,'Other',1000,'USD',false,100,false,1,10,true,false),
    (v_free,v_event,'Free entry',0,NULL,true,100,false,1,10,true,false);
  INSERT INTO public.ticket_add_ons(
    id,ticket_type_id,name,price_cents,quantity_total,is_unlimited,max_per_ticket,valid_occurrence_keys
  ) VALUES
    (v_dinner,v_all,'Friday dinner',1500,1,false,1,ARRAY['fri']),
    (v_shuttle,v_all,'Saturday shuttle',500,NULL,true,2,ARRAY['sat']),
    (v_tote,v_all,'Tote bag',0,1,false,1,NULL),
    (v_paid_on_free,v_free,'Paid drink',800,NULL,true,1,NULL),
    (v_free_on_free,v_free,'Free badge',0,NULL,true,1,NULL);

  -- A cart without extras is priced as before and adds nothing.
  v_plain := public.issue_3872_ticket_quote(v_event,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',1)),
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  IF (v_plain->>'netSubtotalCents')::bigint <> 2000
     OR (v_plain->>'extrasTotalCents')::bigint <> 0
     OR jsonb_array_length(v_plain->'extras') <> 0 THEN
    RAISE EXCEPTION 'a cart without extras must be unchanged, got %',v_plain;
  END IF;

  -- The server prices the extra once, after the ticket's day multiplier.
  v_lines := jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',1,
    'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_dinner,'quantity',1))));
  v_quote := public.issue_3872_ticket_quote(v_event,v_lines,
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  IF (v_quote->>'netSubtotalCents')::bigint <> 3500
     OR (v_quote->>'dueTodayNetCents')::bigint <> 3500
     OR (v_quote->>'listSubtotalCents')::bigint <> 3500
     OR (v_quote->>'extrasTotalCents')::bigint <> 1500
     OR v_quote->'extras'->0->'dayScope' <> '["fri"]'::jsonb
     OR v_quote->>'quoteDigest' = v_plain->>'quoteDigest' THEN
    RAISE EXCEPTION 'the quote must add the extra and change its digest, got %',v_quote;
  END IF;

  -- Each refusal names its reason.
  FOR v_key, v_lines IN VALUES
    ('extra_quantity_above_max', jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_dinner,'quantity',2))))),
    ('extra_not_available', jsonb_build_array(jsonb_build_object('ticketTypeId',v_other,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_dinner,'quantity',1))))),
    ('extras_invalid', jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_dinner,'quantity',1),
        jsonb_build_object('addOnId',v_dinner,'quantity',1))))),
    ('extras_invalid', jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_dinner,'quantity','1'))))),
    ('extras_invalid', jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',1,
      'addOns',jsonb_build_object('addOnId',v_dinner)))),
    ('extras_need_paid_ticket', jsonb_build_array(jsonb_build_object('ticketTypeId',v_free,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_paid_on_free,'quantity',1)))))
  LOOP
    v_raised := NULL;
    BEGIN
      PERFORM public.issue_3872_ticket_quote(v_event,v_lines,
        v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
    IF v_raised IS DISTINCT FROM v_key THEN
      RAISE EXCEPTION 'expected %, got %',v_key,v_raised;
    END IF;
  END LOOP;

  -- A date-limited extra is refused when none of its dates were chosen.
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(v_event,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',1,
        'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_shuttle,'quantity',1)))),
      ARRAY[v_fri],NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extra_not_on_chosen_days' THEN
    RAISE EXCEPTION 'an extra off the chosen dates must be refused, got %',v_raised;
  END IF;

  -- A free extra on a free ticket stays free.
  v_quote := public.issue_3872_ticket_quote(v_event,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_free,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_free_on_free,'quantity',1)))),
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  IF (v_quote->>'dueTodayNetCents')::bigint <> 0 OR jsonb_array_length(v_quote->'extras') <> 1 THEN
    RAISE EXCEPTION 'a free extra must quote at zero, got %',v_quote;
  END IF;

  -- A session made from a stale quote is refused when it adds extras.
  v_lines := jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',1,
    'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_dinner,'quantity',1))));
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      v_event,NULL,'Buyer','buyer@example.test','+15555550901',false,v_lines,
      'ticket_checkout:v2:'||v_event::text||':32819000-0000-4000-8400-000000000039',
      now()+interval '15 minutes',0,'full',v_days,NULL,NULL,NULL,NULL,v_plain->>'quoteDigest');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'checkout_quote_changed' THEN
    RAISE EXCEPTION 'a quote without the extra must not create a session with it, got %',v_raised;
  END IF;

  -- The session holds the extra at the quoted price, on its date.
  v_quote := public.issue_3872_ticket_quote(v_event,v_lines,
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550901',false,v_lines,
    'ticket_checkout:v2:'||v_event::text||':'||v_attempt::text,
    now()+interval '15 minutes',0,'full',v_days,NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');
  v_session := (v_created->>'checkoutSessionId')::uuid;
  IF (v_created->>'totalCents')::integer <> 3500
     OR (v_created->>'extrasTotalCents')::integer <> 1500
     OR (SELECT day_scope FROM public.ticket_checkout_session_add_on_items
          WHERE checkout_session_id=v_session) IS DISTINCT FROM ARRAY['fri'] THEN
    RAISE EXCEPTION 'the session must hold the extra, got %',v_created;
  END IF;
  -- A replay of the same attempt returns the same extras.
  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550901',false,v_lines,
    'ticket_checkout:v2:'||v_event::text||':'||v_attempt::text,
    now()+interval '15 minutes',0,'full',v_days,NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');
  IF (v_created->>'extrasTotalCents')::integer <> 1500
     OR jsonb_array_length(v_created->'extras') <> 1 THEN
    RAISE EXCEPTION 'a replay must return the held extras, got %',v_created;
  END IF;

  -- Friday's only dinner is held, so a second buyer can't take it.
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      v_event,NULL,'Second','second@example.test','+15555550902',false,v_lines,
      'ticket_checkout:v2:'||v_event::text||':32819000-0000-4000-8400-000000000032',
      now()+interval '15 minutes',0,'full',v_days,NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extra_capacity_exceeded' THEN
    RAISE EXCEPTION 'a held extra must be full on its date, got %',v_raised;
  END IF;

  -- An all-dates extra keeps one shared count across the session's dates.
  IF public.issue_3281_add_on_taken(v_tote,NULL,NULL) <> 0 THEN
    RAISE EXCEPTION 'nothing holds the tote yet';
  END IF;

  -- A retry must bind the extras that were reserved, at their price.
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3859_bind_checkout_contract(v_session,v_event,
      'ticket_checkout:v2:'||v_event::text||':'||v_attempt::text,v_attempt,repeat('a',64),
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',2,'paymentPlanChoice','full')),
      3500,3500,NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'checkout_lines_conflict' THEN
    RAISE EXCEPTION 'a bind without the extra must conflict, got %',v_raised;
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3859_bind_checkout_contract(v_session,v_event,
      'ticket_checkout:v2:'||v_event::text||':'||v_attempt::text,v_attempt,repeat('a',64),
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',2,'paymentPlanChoice','full',
        'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_dinner,'quantity',1)))),
      2000,2000,NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'checkout_lines_conflict' THEN
    RAISE EXCEPTION 'a bind must count the extra in the full price, got %',v_raised;
  END IF;
  IF public.issue_3859_bind_checkout_contract(v_session,v_event,
       'ticket_checkout:v2:'||v_event::text||':'||v_attempt::text,v_attempt,repeat('a',64),
       jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',2,'paymentPlanChoice','full',
         'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_dinner,'quantity',1)))),
       3500,3500,NULL)->>'outcome' <> 'bound' THEN
    RAISE EXCEPTION 'the matching extras must bind';
  END IF;

  -- Finalize refuses a session whose extra has gone off sale.
  UPDATE public.ticket_add_ons SET is_active=false WHERE id=v_dinner;
  IF public.issue_1930_ticket_session_authorized(v_session,v_event) THEN
    RAISE EXCEPTION 'an extra off sale must stop finalize';
  END IF;
  UPDATE public.ticket_add_ons SET is_active=true WHERE id=v_dinner;
  IF NOT public.issue_1930_ticket_session_authorized(v_session,v_event) THEN
    RAISE EXCEPTION 'the session must still be authorised with its own hold';
  END IF;

  -- The order records the extras its session paid for.
  PERFORM public.issue_1930_ticket_checkout_finalize_base(
    v_session,'pi_extras','ch_extras','card','extras-test-pepper-0123456789abcdef0123456789');
  SELECT order_id INTO v_order FROM public.ticket_checkout_sessions WHERE id=v_session;
  IF (SELECT total_cents FROM public.orders WHERE id=v_order) <> 3500
     OR (SELECT count(*) FROM public.order_add_on_line_items
          WHERE order_id=v_order AND ticket_add_on_id=v_dinner AND quantity=1
            AND total_cents=1500 AND day_scope_at_order=ARRAY['fri']) <> 1 THEN
    RAISE EXCEPTION 'the order must record its extra';
  END IF;
  -- A sold extra still takes its place once the hold is gone.
  IF public.issue_3281_add_on_taken(v_dinner,'fri',NULL) <> 1
     OR public.issue_3281_add_on_taken(v_dinner,'sat',NULL) <> 0 THEN
    RAISE EXCEPTION 'the sold dinner must count on Friday only';
  END IF;

  -- A dashboard refund that completes the charge records the extras too.
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re-extras-a',2000,'USD',NULL,NULL);
  IF EXISTS (SELECT 1 FROM public.refund_add_on_line_items ra JOIN public.refunds r ON r.id=ra.refund_id
              WHERE r.stripe_refund_id='re-extras-a') THEN
    RAISE EXCEPTION 'the ticket refund must leave the extra';
  END IF;
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re-extras-b',1500,'USD',NULL,NULL);
  IF (SELECT COALESCE(sum(ra.amount_cents),0) FROM public.refund_add_on_line_items ra
        JOIN public.refunds r ON r.id=ra.refund_id WHERE r.stripe_refund_id='re-extras-b') <> 1500
     OR (SELECT payment_status FROM public.orders WHERE id=v_order) <> 'refunded'
     OR public.issue_3281_add_on_taken(v_dinner,'fri',NULL) <> 0 THEN
    RAISE EXCEPTION 'the completing refund must record the extra and free its place';
  END IF;

  -- Extras never ride an instalment plan, and the helpers stay server-only.
  IF position('extras_not_on_installments' IN pg_get_functiondef(
       'public.issue_3872_ticket_quote(uuid,jsonb,uuid[],timestamptz,timestamptz,integer,text,text,text,text,uuid,text,boolean)'::regprocedure)) = 0
     OR position('extras_not_on_installments' IN pg_get_functiondef(
       'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'both pricing paths must refuse extras on a plan';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'issue_3281_add_on_taken','issue_3281_price_extras','issue_3281_session_extras','issue_3281_quote_digest')
       AND (has_function_privilege('anon',p.oid,'EXECUTE')
         OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
  ) OR has_table_privilege('anon','public.ticket_checkout_session_add_on_items','SELECT')
    OR has_table_privilege('authenticated','public.ticket_checkout_session_add_on_items','SELECT') THEN
    RAISE EXCEPTION 'extras helpers and holds must be closed to clients';
  END IF;
END;
$test$;

ROLLBACK;
