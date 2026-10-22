-- #3872 R1 ticket checkout: quote/create/finalize happy path.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '38726000-0000-4000-8400-000000000001';
  v_brand uuid := '38726000-0000-4000-8400-000000000002';
  v_event uuid := '38726000-0000-4000-8400-000000000003';
  v_ticket uuid := '38726000-0000-4000-8400-000000000004';
  v_hidden_ticket uuid := '38726000-0000-4000-8400-000000000011';
  v_zero_ticket uuid := '38726000-0000-4000-8400-000000000012';
  v_link uuid := '38726000-0000-4000-8400-000000000013';
  v_discount uuid := '38726000-0000-4000-8400-000000000005';
  v_free_discount uuid := '38726000-0000-4000-8400-000000000006';
  v_queue_discount uuid := '38726000-0000-4000-8400-000000000007';
  v_order uuid := '38726000-0000-4000-8400-000000000008';
  v_trip uuid := '38726000-0000-4000-8400-000000000009';
  v_trip_ticket uuid := '38726000-0000-4000-8400-000000000010';
  v_quote jsonb; v_created jsonb; v_replay jsonb; v_free jsonb; v_queued jsonb;
  v_plan jsonb; v_linked jsonb; v_zero jsonb;
  v_session uuid;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'r1-ticket-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'r1-ticket-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'R1 ticket brand','r1-ticket-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_r1_ticket',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
    VALUES(v_brand,'discounts','pilot');

  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES(v_event,v_brand,v_owner,'R1 ticket event','r1-ticket-event','event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES(v_event,now()+interval '1 day',now()+interval '1 day 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person
  ) VALUES(v_ticket,v_event,'General',2500,'USD',false,100,false,1,10,true,false);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,is_hidden
  ) VALUES
    (v_hidden_ticket,v_event,'Hidden',3000,'USD',false,100,false,1,10,true,false,true),
    (v_zero_ticket,v_event,'Free line',0,'USD',true,100,false,1,10,true,false,false);

  INSERT INTO public.brand_discounts(
    id,brand_id,kind,code,name,value_type,value_bps,scope_kind,combines_with,
    status,created_by
  ) VALUES
    (v_discount,v_brand,'code','SAVE10','Save ten','percent',1000,'brand','automatic_only','active',v_owner),
    (v_free_discount,v_brand,'code','FREE100','Free','percent',10000,'brand','automatic_only','active',v_owner),
    (v_queue_discount,v_brand,'code','QUEUE10','Queued limited','percent',1000,'brand','automatic_only','active',v_owner);
  UPDATE public.brand_discounts SET max_total_uses=1 WHERE id=v_queue_discount;

  v_quote := public.issue_3872_ticket_quote(
    v_event,jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',2)),
    NULL,NULL,NULL,NULL,'auto','SAVE-10','buyer@example.test','+15555550101',NULL,NULL,false);
  IF (v_quote->>'listSubtotalCents')::int<>5000
     OR (v_quote->>'netSubtotalCents')::int<>4500
     OR (v_quote->>'dueTodayNetCents')::int<>4500
     OR v_quote#>>'{codeOutcome,status}'<>'applied'
     OR v_quote->>'quoteDigest' !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'T6 quote mismatch: %',v_quote;
  END IF;

  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550101',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',2)),
    'r1-ticket-create',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,
    'SAVE10',v_quote->>'quoteDigest');
  v_session := (v_created->>'checkoutSessionId')::uuid;
  IF v_created->>'status'<>'requires_payment'
     OR (v_created->>'listSubtotalCents')::int<>5000
     OR (v_created->>'discountCents')::int<>500
     OR (v_created->>'totalCents')::int<>4500
     OR v_created->>'quoteDigest'<>v_quote->>'quoteDigest'
     OR (SELECT count(*) FROM public.discount_uses
         WHERE checkout_ref_id=v_session AND status='reserved')<>1
     OR (SELECT list_unit_price_cents FROM public.ticket_checkout_session_items
         WHERE checkout_session_id=v_session)<>2500
     OR (SELECT unit_price_cents FROM public.ticket_checkout_session_items
         WHERE checkout_session_id=v_session)<>2250 THEN
    RAISE EXCEPTION 'T6 create mismatch: %',v_created;
  END IF;

  v_replay := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550101',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',2)),
    'r1-ticket-create',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,
    'SAVE10',v_quote->>'quoteDigest');
  IF v_replay->>'checkoutSessionId'<>v_session::text
     OR (v_replay->>'listSubtotalCents')::int<>5000
     OR (SELECT count(*) FROM public.ticket_checkout_sessions WHERE id=v_session)<>1 THEN
    RAISE EXCEPTION 'T6 replay mismatch: %',v_replay;
  END IF;

  INSERT INTO public.orders(
    id,event_id,buyer_email,buyer_name,buyer_phone,buyer_phone_e164,total_cents,
    currency,payment_method,payment_status,checkout_session_id,source,notification_status
  ) VALUES(v_order,v_event,'buyer@example.test','Buyer','+15555550101','+15555550101',
    4500,'USD','online_card','paid',v_session,'online_checkout','pending');
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES(v_order,v_ticket,2,2250,4500);
  UPDATE public.ticket_checkout_sessions SET order_id=v_order,
    list_subtotal_cents=5000,discount_cents=500,net_subtotal_cents=4500,
    buyer_fees_cents=0,tax_cents=0,buyer_total_cents=4500,
    pricing_source='computed_at_checkout'
    WHERE id=v_session;
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  IF (SELECT checkout_session_item_id IS NULL FROM public.order_line_items WHERE order_id=v_order)
     OR (SELECT list_unit_price_cents FROM public.order_line_items WHERE order_id=v_order)<>2500
     OR (SELECT discount_cents FROM public.order_line_items WHERE order_id=v_order)<>500
     OR (SELECT count(*) FROM public.order_discount_lines WHERE order_id=v_order)<>1
     OR (SELECT status FROM public.discount_uses WHERE checkout_ref_id=v_session)<>'consumed'
     OR NOT (SELECT metadata ? 'discount_ids' FROM public.orders WHERE id=v_order) THEN
    RAISE EXCEPTION 'T6 finalize snapshot mismatch';
  END IF;

  v_free := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Free Buyer','free@example.test','+15555550102',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',1)),
    'r1-ticket-free',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,
    'FREE100',NULL);
  IF v_free->>'status'<>'pending_free' OR (v_free->>'totalCents')::int<>0
     OR (v_free->>'listSubtotalCents')::int<>2500
     OR (v_free->>'discountCents')::int<>2500 THEN
    RAISE EXCEPTION 'T6 100 percent free path mismatch: %',v_free;
  END IF;

  v_zero := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Zero Buyer','zero@example.test','+15555550104',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_zero_ticket,'quantity',1)),
    'r1-ticket-zero-line',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,
    NULL,NULL);
  IF v_zero->>'status'<>'pending_free'
     OR (v_zero#>>'{items,0,listUnitPriceCents}')::int<>0
     OR (v_zero#>>'{items,0,unitPriceCents}')::int<>0
     OR (v_zero#>>'{items,0,discountCents}')::int<>0 THEN
    RAISE EXCEPTION 'T6 EN-14 zero line mismatch: %',v_zero;
  END IF;

  PERFORM public.biz_ticket_link_create(
    v_owner,v_event,v_hidden_ticket,NULL,'R1 hidden buyers',5,1,'auto',NULL,
    v_link,decode('38726000000040008400000000000013','hex'),repeat('a',64));
  v_linked := public.biz_ticket_link_checkout_create_session(
    repeat('a',64),v_event,NULL,'Linked Buyer','linked@example.test','+15555550105',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_hidden_ticket,'quantity',1)),
    'r1-ticket-hidden-link',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,
    'SAVE10',NULL);
  IF (v_linked#>>'{items,0,listUnitPriceCents}')::int<>3000
     OR (v_linked#>>'{items,0,unitPriceCents}')::int<>2700
     OR (SELECT ticket_link_id FROM public.ticket_checkout_sessions
         WHERE id=(v_linked->>'checkoutSessionId')::uuid)<>v_link THEN
    RAISE EXCEPTION 'T6 hidden link discount mismatch: %',v_linked;
  END IF;

  v_queued := public.issue_3872_ticket_quote(
    v_event,jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',1)),
    NULL,NULL,NULL,NULL,'full','QUEUE10','queue@example.test','+15555550103',NULL,NULL,true);
  IF v_queued#>>'{codeOutcome,status}'<>'rejected'
     OR v_queued#>>'{codeOutcome,reason}'<>'queue'
     OR EXISTS(SELECT 1 FROM public.discount_uses WHERE discount_id=v_queue_discount) THEN
    RAISE EXCEPTION 'T6 queued limited code mismatch: %',v_queued;
  END IF;

  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES(v_trip,v_brand,v_owner,'R1 plan trip','r1-plan-trip','trip','scheduled','public','UTC','USD');
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,available_online,available_in_person
  ) VALUES(v_trip_ticket,v_trip,'Plan tier',5000,'USD',false,100,false,1,true,false);
  INSERT INTO public.trip_pricing_tiers(event_id,ticket_type_id,tier_name,tier_metadata)
  VALUES(v_trip,v_trip_ticket,'Plan tier',jsonb_build_object('installments',jsonb_build_object(
    'deposit_pct',25,'installments',jsonb_build_array(jsonb_build_object(
      'ordinal',1,'pct',75,'days_after_booking',30)))));
  v_plan := public.issue_3872_plan_due_today(v_trip,jsonb_build_array(jsonb_build_object(
    'ticketTypeId',v_trip_ticket,'quantity',1,'totalCents',4500,'listUnitPriceCents',5000
  )),'installments');
  IF (v_plan->>'dueTodayNetCents')::int<>1125
     OR (v_plan->>'dueTodayListCents')::int<>1250
     OR v_plan#>>'{installmentSchedule,depositCents}'<>'1125' THEN
    RAISE EXCEPTION 'T6 discounted plan mismatch: %',v_plan;
  END IF;

  RAISE NOTICE 'issue_3872_r1_ticket_checkout happy: PASS';
END
$test$;

ROLLBACK;
