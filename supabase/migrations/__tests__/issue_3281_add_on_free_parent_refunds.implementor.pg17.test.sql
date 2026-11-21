-- #3281 S4: a free ticket may carry paid add-ons, and add-ons refund on their own, bounded.
-- MINGLA-INVARIANT: I-ADDON-REFUND-BOUNDED | issue #3281 | Refunds of an add-on line never add up to more than its quantity or its total, and no refund returns the same add-on unit twice.
-- MINGLA-INVARIANT: I-ADDON-FREE-PARENT-REFUNDABLE | issue #3281 | A free-ticket order with paid add-ons is refundable per add-on line and in full, and settles to refunded only when every ticket and add-on is back.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '32814000-0000-4000-8400-000000000001';
  v_brand uuid := '32814000-0000-4000-8400-000000000002';
  v_event uuid := '32814000-0000-4000-8400-000000000003';
  v_free uuid := '32814000-0000-4000-8400-000000000004';
  v_paid uuid := '32814000-0000-4000-8400-000000000005';
  v_day uuid := '32814000-0000-4000-8400-000000000006';
  v_drink uuid := '32814000-0000-4000-8400-000000000021';
  v_badge uuid := '32814000-0000-4000-8400-000000000022';
  v_dinner uuid := '32814000-0000-4000-8400-000000000023';
  v_attempt uuid := '32814000-0000-4000-8400-000000000031';
  v_wh_order uuid := '32814000-0000-4000-8400-000000000041';
  v_wh_line uuid := '32814000-0000-4000-8400-000000000042';
  v_wh_item uuid := '32814000-0000-4000-8400-000000000043';
  v_po uuid := '32814000-0000-4000-8400-000000000051';
  v_po_line uuid := '32814000-0000-4000-8400-000000000052';
  v_po_item uuid := '32814000-0000-4000-8400-000000000053';
  v_lines jsonb;
  v_quote jsonb;
  v_created jsonb;
  v_result jsonb;
  v_session uuid;
  v_order uuid;
  v_ticket_line uuid;
  v_item uuid;
  v_raised text;
  v_one_addon jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'s4-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'s4-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'S4 brand','s4-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_s4',true,true,'US','usd');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES(v_event,v_brand,v_owner,'S4 event','s4-event','event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
    (v_day,v_event,date_trunc('minute',now())+interval '1 day',now()+interval '1 day 2 hours','UTC',true,'d1');
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person
  ) VALUES
    (v_free,v_event,'Free entry',0,NULL,true,100,false,1,10,true,false),
    (v_paid,v_event,'Paid entry',1000,'USD',false,100,false,1,10,true,false);
  INSERT INTO public.ticket_add_ons(
    id,ticket_type_id,name,price_cents,quantity_total,is_unlimited,max_per_ticket
  ) VALUES
    (v_drink,v_free,'Paid drink',800,NULL,true,2),
    (v_badge,v_free,'Free badge',0,NULL,true,1),
    (v_dinner,v_paid,'Dinner',500,NULL,true,1);
  v_lines := jsonb_build_array(jsonb_build_object('ticketTypeId',v_free,'quantity',2,
    'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_drink,'quantity',2))));

  -- ---- Switch off: today's refusals, unchanged. -------------------------------
  IF public.issue_3281_add_on_switch('free_parent_enabled') THEN
    RAISE EXCEPTION 'free_parent_enabled must start off';
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(v_event,v_lines,ARRAY[v_day],NULL,NULL,NULL,'full',
      NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extras_need_paid_ticket' THEN
    RAISE EXCEPTION 'switch off: the quote must refuse paid add-ons on a free ticket, got %',v_raised;
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      v_event,NULL,'Buyer','buyer@example.test','+15555550901',false,v_lines,
      'ticket_checkout:v2:'||v_event::text||':'||v_attempt::text,
      now()+interval '15 minutes',0,'full',ARRAY[v_day],NULL,NULL,NULL,NULL,NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extras_need_paid_ticket' THEN
    RAISE EXCEPTION 'switch off: the session must refuse paid add-ons on a free ticket, got %',v_raised;
  END IF;

  -- A paid-ticket order to prove add-on-only refunds stay off with the switch.
  INSERT INTO public.orders(id,event_id,total_cents,currency,payment_status,
    stripe_payment_intent_id,stripe_charge_id,source)
    VALUES (v_po,v_event,1500,'USD','paid','pi-s4-po','ch-s4-po','legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_po_line,v_po,v_paid,1,1000,1000);
  INSERT INTO public.order_add_on_line_items(id,order_id,ticket_add_on_id,ticket_type_id,
    add_on_name_at_order,ticket_type_name_at_order,quantity,unit_price_cents,total_cents)
    VALUES (v_po_item,v_po,v_dinner,v_paid,'Dinner','Paid entry',1,500,500);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_refund_order(v_po,
      jsonb_build_array(jsonb_build_object('order_add_on_line_item_id',v_po_item,'quantity',1)),
      'Dinner cancelled by the venue','s4-off');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_on_refunds_off' THEN
    RAISE EXCEPTION 'switch off: an add-on-only refund must be refused, got %',v_raised;
  END IF;

  -- ---- Switch on (rolled back with the suite). --------------------------------
  UPDATE public.add_on_rollout SET free_parent_enabled = true;

  -- Free tickets + paid add-ons quote as a paid cart in the event's currency.
  v_quote := public.issue_3872_ticket_quote(v_event,v_lines,ARRAY[v_day],NULL,NULL,NULL,'full',
    NULL,'buyer@example.test','+15555550901',NULL,NULL,false);
  IF (v_quote->>'netSubtotalCents')::bigint <> 1600
     OR (v_quote->>'dueTodayNetCents')::bigint <> 1600
     OR (v_quote->>'extrasTotalCents')::bigint <> 1600
     OR v_quote->>'currency' IS DISTINCT FROM 'USD'
     OR (v_quote->'lines'->0->>'lineNetCents')::bigint <> 0 THEN
    RAISE EXCEPTION 'switch on: free tickets + add-ons must quote 1600 USD with a $0 ticket, got %',v_quote;
  END IF;

  -- The session takes the paid path, never pending_free; the edge's all-in fee
  -- engine prices exactly this total, so the fee is on the add-ons alone.
  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550901',false,v_lines,
    'ticket_checkout:v2:'||v_event::text||':'||v_attempt::text,
    now()+interval '15 minutes',0,'full',ARRAY[v_day],NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');
  v_session := (v_created->>'checkoutSessionId')::uuid;
  IF (v_created->>'totalCents')::integer <> 1600
     OR (SELECT status FROM public.ticket_checkout_sessions WHERE id=v_session) <> 'requires_payment'
     OR (SELECT trim(currency) FROM public.ticket_checkout_sessions WHERE id=v_session) <> 'USD'
     OR (SELECT stripe_account_id FROM public.ticket_checkout_sessions WHERE id=v_session) IS DISTINCT FROM 'acct_s4' THEN
    RAISE EXCEPTION 'switch on: the session must be a paid USD session of 1600, got %',v_created;
  END IF;

  PERFORM public.issue_1930_ticket_checkout_finalize_base(
    v_session,'pi_s4','ch_s4','card','s4-test-pepper-0123456789abcdef0123456789abcd');
  SELECT order_id INTO v_order FROM public.ticket_checkout_sessions WHERE id=v_session;
  SELECT id INTO v_ticket_line FROM public.order_line_items WHERE order_id=v_order;
  SELECT id INTO v_item FROM public.order_add_on_line_items WHERE order_id=v_order;
  IF v_order IS NULL
     OR (SELECT payment_status FROM public.orders WHERE id=v_order) <> 'paid'
     OR (SELECT total_cents FROM public.orders WHERE id=v_order) <> 1600
     OR (SELECT quantity FROM public.order_line_items WHERE id=v_ticket_line) <> 2
     OR (SELECT unit_price_cents FROM public.order_line_items WHERE id=v_ticket_line) <> 0
     OR (SELECT total_cents FROM public.order_add_on_line_items WHERE id=v_item) <> 1600 THEN
    RAISE EXCEPTION 'switch on: finalize must record a paid 1600 order with a $0 ticket line';
  END IF;

  -- Event and ticket currencies are kept filled by their triggers, so the
  -- cart's currency is the event's (USD above); the event fallback in the
  -- quote and session is defensive only.
  UPDATE public.events SET currency = NULL WHERE id = v_event;
  IF (SELECT currency FROM public.events WHERE id = v_event) IS NULL THEN
    RAISE EXCEPTION 'the currency trigger changed: cover event_currency_required here';
  END IF;

  -- One of two free tickets back returns nothing: the add-ons stay with the
  -- ticket still held (the V-6 bug refunded every add-on here).
  v_result := public.refund_preview(v_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_ticket_line,'quantity',1)));
  IF (v_result->>'amount_cents')::bigint <> 0 THEN
    RAISE EXCEPTION 'one of two free tickets must not return the add-ons, got %',v_result;
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_refund_order(v_order,
      jsonb_build_array(jsonb_build_object('order_line_item_id',v_ticket_line,'quantity',1)),
      'One free ticket handed back','s4-one-free');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'refund_amount_zero' THEN
    RAISE EXCEPTION 'one of two free tickets must refund nothing, got %',v_raised;
  END IF;

  -- One add-on unit refunded alone; the buyer keeps both tickets.
  v_one_addon := jsonb_build_array(jsonb_build_object('order_add_on_line_item_id',v_item,'quantity',1));
  IF (public.refund_preview(v_order,v_one_addon)->>'amount_cents')::bigint <> 800 THEN
    RAISE EXCEPTION 'the preview of one add-on must be 800';
  END IF;
  v_result := public.biz_refund_order(v_order,v_one_addon,'Drink not served at the bar','s4-addon-1');
  IF (v_result->>'amount_cents')::integer <> 800
     OR v_result->>'proposed_new_payment_status' <> 'partial_refund'
     OR (SELECT count(*) FROM public.refund_line_items rli JOIN public.refunds r ON r.id=rli.refund_id
          WHERE r.order_id=v_order) <> 0
     OR (SELECT quantity FROM public.refund_add_on_line_items WHERE order_add_on_line_item_id=v_item) <> 1 THEN
    RAISE EXCEPTION 'one add-on unit must refund 800 and leave the tickets, got %',v_result;
  END IF;
  -- The same key and body replays; a different add-on body under that key does not.
  IF (public.biz_refund_order(v_order,v_one_addon,'Drink not served at the bar','s4-addon-1')->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'an add-on refund must replay under its key';
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_refund_order(v_order,
      jsonb_build_array(jsonb_build_object('order_add_on_line_item_id',v_item,'quantity',2)),
      'Drink not served at the bar','s4-addon-1');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'idempotency_request_mismatch' THEN
    RAISE EXCEPTION 'a changed add-on body must not replay, got %',v_raised;
  END IF;
  UPDATE public.refunds SET status='succeeded' WHERE order_id=v_order;
  UPDATE public.orders SET refunded_amount_cents=800, payment_status='partial_refund' WHERE id=v_order;
  IF public.issue_3281_settled_payment_status(v_order) <> 'partial_refund' THEN
    RAISE EXCEPTION 'an order with add-ons still held must settle partial';
  END IF;

  -- Never more than the line has left (two asked, one left). Admin calls run
  -- as the service role (no signed-in user).
  PERFORM set_config('request.jwt.claim.sub','',true);
  v_raised := NULL;
  BEGIN
    PERFORM public.admin_refund_order(v_order,
      jsonb_build_array(jsonb_build_object('order_add_on_line_item_id',v_item,'quantity',2)),
      'Admin refunds both drinks','s4-over');
  EXCEPTION WHEN OTHERS THEN v_raised := split_part(SQLERRM,':',1); END;
  IF v_raised IS DISTINCT FROM 'add_on_line_overrefund' THEN
    RAISE EXCEPTION 'an add-on over-refund must be refused, got %',v_raised;
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_refund_order(v_order,
      jsonb_build_array(jsonb_build_object('order_add_on_line_item_id',v_po_item,'quantity',1)),
      'Another order''s add-on line','s4-foreign');
  -- P0004 (as line_item_not_found) is assert_failure, which OTHERS skips.
  EXCEPTION WHEN assert_failure OR OTHERS THEN v_raised := split_part(SQLERRM,':',1); END;
  IF v_raised IS DISTINCT FROM 'add_on_line_not_found' THEN
    RAISE EXCEPTION 'an add-on line from another order must be refused, got %',v_raised;
  END IF;

  -- Returning every free ticket returns only what the add-ons have left (800,
  -- never the unit already refunded), then the order settles refunded.
  v_result := public.biz_refund_order(v_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_ticket_line,'quantity',2)),
    'Both free tickets handed back','s4-all-free');
  IF (v_result->>'amount_cents')::integer <> 800
     OR (v_result->>'is_full_refund')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'every ticket back must return the last 800 and be full, got %',v_result;
  END IF;
  IF (SELECT sum(quantity) FROM public.refund_add_on_line_items WHERE order_add_on_line_item_id=v_item) <> 2
     OR (SELECT sum(amount_cents) FROM public.refund_add_on_line_items WHERE order_add_on_line_item_id=v_item) <> 1600 THEN
    RAISE EXCEPTION 'I-ADDON-REFUND-BOUNDED: the line must be refunded exactly once in full';
  END IF;
  UPDATE public.refunds SET status='succeeded' WHERE order_id=v_order;
  IF public.issue_3281_settled_payment_status(v_order) <> 'refunded' THEN
    RAISE EXCEPTION 'every ticket and add-on back must settle refunded';
  END IF;

  -- Paid ticket + add-on: the add-on alone, then the ticket brings nothing twice.
  PERFORM set_config('request.jwt.claim.sub','',true);
  v_result := public.admin_refund_order(v_po,
    jsonb_build_array(jsonb_build_object('order_add_on_line_item_id',v_po_item,'quantity',1)),
    'Dinner cancelled by the venue','s4-po-addon');
  IF (v_result->>'amount_cents')::integer <> 500
     OR v_result->>'proposed_new_payment_status' <> 'partial_refund' THEN
    RAISE EXCEPTION 'the admin must refund the add-on alone, got %',v_result;
  END IF;
  UPDATE public.refunds SET status='succeeded' WHERE order_id=v_po;
  UPDATE public.orders SET refunded_amount_cents=500, payment_status='partial_refund' WHERE id=v_po;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_result := public.biz_refund_order(v_po,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_po_line,'quantity',1)),
    'Guest cannot make the date','s4-po-ticket');
  IF (v_result->>'amount_cents')::integer <> 1000
     OR v_result->>'proposed_new_payment_status' <> 'refunded' THEN
    RAISE EXCEPTION 'the ticket must not refund the add-on twice, got %',v_result;
  END IF;

  -- A dashboard refund of a free-ticket order puts the whole amount on the add-ons.
  INSERT INTO public.orders(id,event_id,total_cents,currency,payment_status,
    stripe_payment_intent_id,stripe_charge_id,source)
    VALUES (v_wh_order,v_event,1600,'USD','paid','pi-s4-wh','ch-s4-wh','legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_wh_line,v_wh_order,v_free,2,0,0);
  INSERT INTO public.order_add_on_line_items(id,order_id,ticket_add_on_id,ticket_type_id,
    add_on_name_at_order,ticket_type_name_at_order,quantity,unit_price_cents,total_cents)
    VALUES (v_wh_item,v_wh_order,v_drink,v_free,'Paid drink','Free entry',2,800,1600);
  PERFORM public.biz_refund_order_commit_from_webhook(v_wh_order,'re-s4-wh',1600,'USD',NULL,NULL);
  IF (SELECT COALESCE(sum(amount_cents),0) FROM public.refund_add_on_line_items WHERE order_add_on_line_item_id=v_wh_item) <> 1600
     OR EXISTS (SELECT 1 FROM public.refund_line_items rli JOIN public.refunds r ON r.id=rli.refund_id
                 WHERE r.order_id=v_wh_order AND rli.amount_cents > 0) THEN
    RAISE EXCEPTION 'a dashboard refund of a free-ticket order must go to the add-ons';
  END IF;

  -- The admin order view reads add-on lines for admins only.
  v_raised := NULL;
  BEGIN
    PERFORM public.admin_order_add_on_lines(v_order);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'not_authorized' THEN
    RAISE EXCEPTION 'a host must not read the admin add-on view, got %',v_raised;
  END IF;
  IF has_function_privilege('anon','public.admin_order_add_on_lines(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3281_add_on_refund_lines(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'new helpers must not be callable by anon or signed-in users';
  END IF;
END;
$test$;

ROLLBACK;
