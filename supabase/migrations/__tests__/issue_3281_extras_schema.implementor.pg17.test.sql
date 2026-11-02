-- #3281 Extras, slice 1: extras leave the order only with its last paid tickets.
-- MINGLA-INVARIANT: I-3281-EXTRAS-REFUND-WITH-THE-ORDER | issue #3281 | The refund that returns an order's last paid tickets also returns and records its extras. A partial refund never touches them, and an order without extras refunds exactly as before.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_line uuid := gen_random_uuid();
  v_extra uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_plain_order uuid := gen_random_uuid();
  v_plain_line uuid := gen_random_uuid();
  v_free_order uuid := gen_random_uuid();
  v_free_line uuid := gen_random_uuid();
  v_mixed_order uuid := gen_random_uuid();
  v_mixed_line uuid := gen_random_uuid();
  v_one jsonb;
  v_preview jsonb;
  v_result jsonb;
  v_refund uuid;
  v_raised text;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id,email) VALUES (v_owner,'extras@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,payment_provider,pricing_region,pricing_currency,default_currency
  ) VALUES (v_brand,v_owner,'Extras','extras-'||v_brand,'paystack','NG','NGN','NGN');
  INSERT INTO public.events(id,brand_id,title,slug,status,currency)
    VALUES (v_event,v_brand,'Extras','extras-'||v_event,'ended','NGN');
  INSERT INTO public.ticket_types(id,event_id,name,price_cents)
    VALUES (v_tier,v_event,'Friday VIP',1000);
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES
    (v_order,v_event,5500,'NGN','paid','pi-extras','ch-extras','legacy'),
    (v_plain_order,v_event,1000,'NGN','paid','pi-plain','ch-plain','legacy'),
    (v_free_order,v_event,2000,'NGN','paid','pi-free','ch-free','legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES
      (v_line,v_order,v_tier,2,1000,2000),
      (v_plain_line,v_plain_order,v_tier,1,1000,1000),
      (v_free_line,v_free_order,v_tier,2,1000,2000);
  INSERT INTO public.ticket_add_ons(id,ticket_type_id,name,price_cents,quantity_total)
    VALUES (v_extra,v_tier,'Friday dinner',3500,40);
  INSERT INTO public.order_add_on_line_items(
    id,order_id,ticket_add_on_id,ticket_type_id,add_on_name_at_order,
    ticket_type_name_at_order,quantity,unit_price_cents,total_cents
  ) VALUES (v_item,v_order,v_extra,v_tier,'Friday dinner','Friday VIP',1,3500,3500);
  INSERT INTO public.order_add_on_line_items(
    order_id,ticket_type_id,add_on_name_at_order,ticket_type_name_at_order,
    quantity,unit_price_cents,total_cents
  ) VALUES (v_free_order,v_tier,'Welcome drink','Friday VIP',1,0,0);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);

  -- An order with no extras refunds exactly as before.
  v_result := public.biz_refund_order(v_plain_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_plain_line,'quantity',1)),
    'Guest cannot make the date','plain-1');
  IF (SELECT amount_cents FROM public.refunds WHERE order_id=v_plain_order) <> 1000 THEN
    RAISE EXCEPTION 'a plain refund must not change, got %',v_result;
  END IF;

  -- A free extra is recorded as returned, so it waits like a paid one.
  v_one := jsonb_build_array(jsonb_build_object('order_line_item_id',v_free_line,'quantity',1));
  PERFORM public.biz_refund_order(v_free_order,v_one,'First of two tickets back','free-1');
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_refund_order(v_free_order,v_one,'Second ticket while pending','free-2');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'refund_pending_on_order' THEN
    RAISE EXCEPTION 'a free extra must wait for a pending refund, got %',v_raised;
  END IF;

  -- Limited capacity needs a number, and two refunds wait on the order row.
  v_raised := NULL;
  BEGIN
    INSERT INTO public.ticket_add_ons(ticket_type_id,name) VALUES (v_tier,'No capacity');
  EXCEPTION WHEN check_violation THEN v_raised := 'refused'; END;
  IF v_raised IS NULL THEN RAISE EXCEPTION 'a limited extra needs a capacity'; END IF;
  IF position('FROM public.orders WHERE id = p_order_id FOR UPDATE' IN pg_get_functiondef('public.biz_refund_order(uuid,jsonb,text,text)'::regprocedure)) = 0
     OR position('FROM public.orders WHERE id = p_order_id FOR UPDATE' IN pg_get_functiondef('public.admin_refund_order(uuid,jsonb,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'manual refunds must lock the order';
  END IF;
  -- Settlement locks a refund before its order, so holding the order a retry
  -- must not wait on the refund.
  IF pg_get_functiondef('public.biz_refund_order(uuid,jsonb,text,text)'::regprocedure) ~ 'LIMIT 1\s+FOR UPDATE'
     OR pg_get_functiondef('public.admin_refund_order(uuid,jsonb,text,text)'::regprocedure) ~ 'LIMIT 1\s+FOR UPDATE'
     OR pg_get_functiondef('public.issue_3872_cancel_refund_order(uuid,jsonb,text,text)'::regprocedure) ~ 'LIMIT 1\s+FOR UPDATE' THEN
    RAISE EXCEPTION 'a retry must only read the refund';
  END IF;

  -- The first ticket back keeps the dinner.
  v_one := jsonb_build_array(jsonb_build_object('order_line_item_id',v_line,'quantity',1));
  v_preview := public.refund_preview(v_order,v_one);
  IF (v_preview->>'amount_cents')::integer <> 1000 THEN
    RAISE EXCEPTION 'a partial preview must not include extras, got %',v_preview;
  END IF;
  PERFORM public.biz_refund_order(v_order,v_one,'First of two tickets back','extras-1');
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_order;
  -- While that refund can still fail, the last ticket can't take the dinner.
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_refund_order(v_order,v_one,'Second ticket while pending','extras-early');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'refund_pending_on_order' THEN
    RAISE EXCEPTION 'extras must wait for a pending refund, got %',v_raised;
  END IF;
  UPDATE public.refunds SET status='succeeded' WHERE id=v_refund;
  IF (SELECT amount_cents FROM public.refunds WHERE id=v_refund) <> 1000
     OR EXISTS (SELECT 1 FROM public.refund_add_on_line_items) THEN
    RAISE EXCEPTION 'a partial refund must leave extras alone';
  END IF;

  -- The last ticket brings the dinner with it, in preview and in the refund.
  v_preview := public.refund_preview(v_order,v_one);
  IF (v_preview->>'amount_cents')::integer <> 4500 THEN
    RAISE EXCEPTION 'the last ticket must include extras, got %',v_preview;
  END IF;
  PERFORM public.biz_refund_order(v_order,v_one,'Second of two tickets back','extras-2');
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_order AND id<>v_refund;
  IF (SELECT amount_cents FROM public.refunds WHERE id=v_refund) <> 4500 THEN
    RAISE EXCEPTION 'the last refund must return the dinner';
  END IF;
  SELECT count(*) INTO v_count FROM public.refund_add_on_line_items
   WHERE refund_id=v_refund AND order_add_on_line_item_id=v_item AND amount_cents=3500;
  IF v_count <> 1 THEN RAISE EXCEPTION 'the dinner must be recorded once'; END IF;

  -- Nothing is left to return a second time.
  IF public.issue_3281_extras_refund_cents(v_order,'[]'::jsonb,NULL) <> 0 THEN
    RAISE EXCEPTION 'a refunded extra must not refund twice';
  END IF;

  -- A failed refund gives the extra back to the next attempt.
  UPDATE public.refunds SET status='failed' WHERE id=v_refund;
  IF public.issue_3281_extras_refund_cents(v_order,v_one,NULL) <> 3500 THEN
    RAISE EXCEPTION 'a failed refund must not count';
  END IF;

  -- A free ticket can't be refunded, so it doesn't hold the extras back.
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_mixed_order,v_event,4500,'NGN','paid','pi-mixed','ch-mixed','legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_mixed_line,v_mixed_order,v_tier,1,1000,1000);
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_mixed_order,v_tier,1,0,0);
  INSERT INTO public.order_add_on_line_items(
    order_id,ticket_type_id,add_on_name_at_order,ticket_type_name_at_order,
    quantity,unit_price_cents,total_cents
  ) VALUES (v_mixed_order,v_tier,'Dinner','Friday VIP',1,3500,3500);
  PERFORM public.biz_refund_order(v_mixed_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_mixed_line,'quantity',1)),
    'Last paid ticket back','mixed-1');
  IF (SELECT amount_cents FROM public.refunds WHERE order_id=v_mixed_order) <> 4500 THEN
    RAISE EXCEPTION 'a free ticket must not hold the extras back';
  END IF;

  -- The rules live in the database.
  v_raised := NULL;
  BEGIN
    UPDATE public.ticket_add_ons SET price_cents=-1 WHERE id=v_extra;
  EXCEPTION WHEN check_violation THEN v_raised := 'refused'; END;
  IF v_raised IS NULL THEN RAISE EXCEPTION 'a negative price must be refused'; END IF;
  v_raised := NULL;
  BEGIN
    UPDATE public.order_add_on_line_items SET total_cents=1 WHERE id=v_item;
  EXCEPTION WHEN check_violation THEN v_raised := 'refused'; END;
  IF v_raised IS NULL THEN RAISE EXCEPTION 'line arithmetic must hold'; END IF;
  IF has_table_privilege('anon','public.ticket_add_ons','SELECT')
     OR has_table_privilege('authenticated','public.refund_add_on_line_items','SELECT') THEN
    RAISE EXCEPTION 'extras tables must stay closed to clients';
  END IF;
END;
$test$;

-- The cancel path already refunds the charged total, so it only records extras.
DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_line uuid := gen_random_uuid();
  v_mixed_order uuid := gen_random_uuid();
  v_mixed_line uuid := gen_random_uuid();
  v_refund uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id,email) VALUES (v_owner,'cancel-extras@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,payment_provider,pricing_region,pricing_currency,default_currency
  ) VALUES (v_brand,v_owner,'Cancel','cancel-'||v_brand,'paystack','NG','NGN','NGN');
  INSERT INTO public.events(id,brand_id,title,slug,status,currency)
    VALUES (v_event,v_brand,'Cancel','cancel-'||v_event,'ended','NGN');
  INSERT INTO public.ticket_types(id,event_id,name,price_cents)
    VALUES (v_tier,v_event,'VIP',1000);
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_order,v_event,4600,'NGN','paid','pi-cancel','ch-cancel','legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_line,v_order,v_tier,1,1000,1000);
  INSERT INTO public.order_add_on_line_items(
    order_id,ticket_type_id,add_on_name_at_order,ticket_type_name_at_order,
    quantity,unit_price_cents,total_cents
  ) VALUES (v_order,v_tier,'Dinner','VIP',1,3500,3500);
  -- A cancellation does not wait for another refund to settle.
  INSERT INTO public.refunds(order_id,amount_cents,currency,reason,status)
    VALUES (v_order,100,'NGN','Earlier refund still pending','pending');
  PERFORM public.issue_3872_cancel_refund_order(v_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_line,'quantity',1)),
    'The organiser cancelled this event','cancel-extras-1');
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_order AND amount_cents<>100;
  IF (SELECT amount_cents FROM public.refunds WHERE id=v_refund) <> 4500 THEN
    RAISE EXCEPTION 'cancel must return the whole order';
  END IF;
  IF (SELECT SUM(amount_cents) FROM public.refund_line_items WHERE refund_id=v_refund) <> 1000 THEN
    RAISE EXCEPTION 'tickets must share only what extras do not use';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.refund_add_on_line_items WHERE refund_id=v_refund) THEN
    RAISE EXCEPTION 'cancel must record the extra';
  END IF;

  -- The cancel manifest omits a free ticket, and the extras still go back.
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_mixed_order,v_event,4500,'NGN','paid','pi-cancel-mixed','ch-cancel-mixed','legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_mixed_line,v_mixed_order,v_tier,1,1000,1000);
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_mixed_order,v_tier,1,0,0);
  INSERT INTO public.order_add_on_line_items(
    order_id,ticket_type_id,add_on_name_at_order,ticket_type_name_at_order,
    quantity,unit_price_cents,total_cents
  ) VALUES (v_mixed_order,v_tier,'Dinner','VIP',1,3500,3500);
  PERFORM public.issue_3872_cancel_refund_order(v_mixed_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_mixed_line,'quantity',1)),
    'The organiser cancelled this event','cancel-mixed-1');
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_mixed_order;
  IF (SELECT amount_cents FROM public.refunds WHERE id=v_refund) <> 4500
     OR (SELECT SUM(amount_cents) FROM public.refund_line_items WHERE refund_id=v_refund) <> 1000
     OR NOT EXISTS (SELECT 1 FROM public.refund_add_on_line_items WHERE refund_id=v_refund) THEN
    RAISE EXCEPTION 'cancel must return the extras past a free ticket';
  END IF;
END;
$test$;

ROLLBACK;
