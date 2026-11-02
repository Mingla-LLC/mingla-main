-- #3281 Extras, slice 1: extras leave the order only with its last paid tickets.
-- MINGLA-INVARIANT: I-3281-EXTRAS-REFUND-WITH-THE-ORDER | issue #3281 | The refund that returns an order's last paid tickets also returns and records its extras. A partial refund never touches them, and a manual refund of an order without extras is unchanged.
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
  -- #3355 P6: a paid tier is at least the provider minimum (NGN 100); the
  -- order lines below carry the prices these refunds are computed from.
  INSERT INTO public.ticket_types(id,event_id,name,price_cents)
    VALUES (v_tier,v_event,'Friday VIP',10000);
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
  -- Two refunds settling together must each see the other's result.
  IF position('FROM public.orders WHERE id = v_order.id FOR NO KEY UPDATE' IN pg_get_functiondef('public.admin_refund_order_commit(uuid,text,integer,text,text)'::regprocedure)) = 0
     OR position('FROM public.orders WHERE id = v_order.id FOR NO KEY UPDATE' IN pg_get_functiondef('public.biz_refund_order_commit(uuid,text,integer,text,text)'::regprocedure)) = 0
     OR position('FROM public.orders WHERE id = v.order_id FOR NO KEY UPDATE' IN pg_get_functiondef('public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text)'::regprocedure)) = 0
     OR position('FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE' IN pg_get_functiondef('public.biz_refund_order_commit_from_webhook(uuid,text,integer,character,integer,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'settlement must lock the order';
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
  -- A manual refund is still judged on every line.
  UPDATE public.refunds SET status='succeeded' WHERE order_id=v_mixed_order;
  IF public.issue_3281_settled_payment_status(v_mixed_order) <> 'partial_refund' THEN
    RAISE EXCEPTION 'a manual refund must stay judged on every line';
  END IF;

  -- The extras helpers are not client functions.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'issue_3281\_%' AND p.prosecdef
       AND p.proname ~ 'extras|returns_all|settled_payment'
       AND (has_function_privilege('anon',p.oid,'EXECUTE')
         OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'extras helpers must stay closed to clients';
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
  v_plain_order uuid := gen_random_uuid();
  v_plain_line uuid := gen_random_uuid();
  v_discount_order uuid := gen_random_uuid();
  v_discount_line uuid := gen_random_uuid();
  v_attempt uuid := gen_random_uuid();
  v_tiny_order uuid := gen_random_uuid();
  v_deep_order uuid := gen_random_uuid();
  v_race_order uuid;
  v_race_line uuid;
  v_manual uuid;
  v_cancel_first boolean;
  v_refund uuid;
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id,email) VALUES (v_owner,'cancel-extras@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,payment_provider,pricing_region,pricing_currency,default_currency
  ) VALUES (v_brand,v_owner,'Cancel','cancel-'||v_brand,'paystack','NG','NGN','NGN');
  INSERT INTO public.events(id,brand_id,title,slug,status,currency)
    VALUES (v_event,v_brand,'Cancel','cancel-'||v_event,'ended','NGN');
  -- #3355 P6: a paid tier is at least the provider minimum (NGN 100); the
  -- order lines below carry the prices these refunds are computed from.
  INSERT INTO public.ticket_types(id,event_id,name,price_cents)
    VALUES (v_tier,v_event,'VIP',10000);
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
  ) VALUES
    (v_mixed_order,v_event,4700,'NGN','paid','pi-cancel-mixed','ch-cancel-mixed','legacy'),
    (v_plain_order,v_event,1200,'NGN','paid','pi-cancel-plain','ch-cancel-plain','legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_mixed_line,v_mixed_order,v_tier,1,1000,1000),
      (v_plain_line,v_plain_order,v_tier,1,1000,1000);
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_mixed_order,v_tier,1,0,0),(v_plain_order,v_tier,1,0,0);
  INSERT INTO public.order_add_on_line_items(
    order_id,ticket_type_id,add_on_name_at_order,ticket_type_name_at_order,
    quantity,unit_price_cents,total_cents
  ) VALUES (v_mixed_order,v_tier,'Dinner','VIP',1,3500,3500);
  PERFORM public.issue_3872_cancel_refund_order(v_mixed_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_mixed_line,'quantity',1)),
    'The organiser cancelled this event','cancel-mixed-1');
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_mixed_order;
  IF (SELECT amount_cents FROM public.refunds WHERE id=v_refund) <> 4700
     OR (SELECT SUM(amount_cents) FROM public.refund_line_items WHERE refund_id=v_refund) <> 1200
     OR NOT EXISTS (SELECT 1 FROM public.refund_add_on_line_items WHERE refund_id=v_refund) THEN
    RAISE EXCEPTION 'cancel must return the extras and fees past a free ticket';
  END IF;

  -- A discount can leave less than the list prices. Every line still adds up
  -- to the refund, and tickets keep their share.
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_discount_order,v_event,3000,'NGN','paid','pi-discount','ch-discount','legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_discount_line,v_discount_order,v_tier,1,1000,1000);
  INSERT INTO public.order_add_on_line_items(
    order_id,ticket_type_id,add_on_name_at_order,ticket_type_name_at_order,
    quantity,unit_price_cents,total_cents
  ) VALUES (v_discount_order,v_tier,'Dinner','VIP',1,3500,3500);
  PERFORM public.issue_3872_cancel_refund_order(v_discount_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_discount_line,'quantity',1)),
    'The organiser cancelled this event','cancel-discount-1');
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_discount_order;
  IF (SELECT amount_cents FROM public.refunds WHERE id=v_refund) <> 3000
     OR (SELECT SUM(amount_cents) FROM public.refund_add_on_line_items WHERE refund_id=v_refund) <> 2333
     OR (SELECT SUM(amount_cents) FROM public.refund_line_items WHERE refund_id=v_refund) <> 667 THEN
    RAISE EXCEPTION 'allocations must add up to the refund';
  END IF;
  IF public.issue_3281_extras_refund_cents(v_discount_order,'[]'::jsonb,NULL) <> 0 THEN
    RAISE EXCEPTION 'a capped extra must not refund again';
  END IF;

  -- A deep discount across several lines still leaves each ticket line a cent.
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_deep_order,v_event,10,'NGN','paid','pi-deep','ch-deep','legacy');
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_deep_order,v_tier,1,1000,1000),(v_deep_order,v_tier,1,1000,1000),(v_deep_order,v_tier,1,1000,1000);
  INSERT INTO public.order_add_on_line_items(
    order_id,ticket_type_id,add_on_name_at_order,ticket_type_name_at_order,
    quantity,unit_price_cents,total_cents
  ) VALUES (v_deep_order,v_tier,'Dinner','VIP',1,100000,100000);
  PERFORM public.issue_3872_cancel_refund_order(v_deep_order,
    (SELECT jsonb_agg(jsonb_build_object('order_line_item_id',id,'quantity',1))
       FROM public.order_line_items WHERE order_id=v_deep_order),
    'The organiser cancelled this event','cancel-deep-1');
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_deep_order;
  IF (SELECT SUM(amount_cents) FROM public.refund_line_items WHERE refund_id=v_refund)
     + (SELECT SUM(amount_cents) FROM public.refund_add_on_line_items WHERE refund_id=v_refund) <> 10
     OR (SELECT count(*) FROM public.refund_line_items WHERE refund_id=v_refund AND amount_cents>=1) <> 3 THEN
    RAISE EXCEPTION 'a deep discount must leave each ticket line a cent';
  END IF;

  -- A free ticket never keeps a cancelled order's fees, with or without extras.
  v_result := public.issue_3872_cancel_refund_order(v_plain_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_plain_line,'quantity',1)),
    'The organiser cancelled this event','cancel-plain-1');
  IF (SELECT amount_cents FROM public.refunds WHERE order_id=v_plain_order) <> 1200
     OR (v_result->>'is_full_refund')::boolean IS NOT TRUE
     OR v_result->>'proposed_new_payment_status' <> 'refunded' THEN
    RAISE EXCEPTION 'cancel must return the whole charge past a free ticket, got %',v_result;
  END IF;

  -- Settlement stores what the cancellation promised, on both rails.
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_plain_order;
  PERFORM public.issue_2097_finalize_not_applicable(v_refund,'paystack','re-plain');
  PERFORM public.admin_refund_order_commit(v_refund,'re-plain',0,'succeeded');
  IF (SELECT payment_status FROM public.orders WHERE id=v_plain_order) <> 'refunded' THEN
    RAISE EXCEPTION 'a settled cancellation must store refunded';
  END IF;
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_mixed_order;
  INSERT INTO public.ticket_refund_attempts(
    id,refund_id,order_id,request_fingerprint,provider,provider_mode,connected_account_id,currency,
    charge_id,payment_intent_id,application_fee_amount_text,captured_charge_amount_text,
    requested_refund_amount_text,baseline_amount_refunded_text,buyer_refund_id,
    buyer_refund_amount_text,buyer_refunded_at,status,observation_count,lease_owner,lease_epoch,
    lease_expires_at,provider_call_permitted_at
  ) VALUES (v_attempt,v_refund,v_mixed_order,'cancel-mixed','stripe','test','acct_test','NGN',
    'ch-cancel-mixed','pi-cancel-mixed','0','4700','4700','0','re-mixed','4700',now(),
    'pending_visibility',8,v_owner,1,now()+interval '1 minute',now());
  PERFORM public.issue_2097_finalize_refund_attempt(v_attempt,v_owner,1,'not_applicable',NULL,'0','0',NULL);
  IF (SELECT payment_status FROM public.orders WHERE id=v_mixed_order) <> 'refunded' THEN
    RAISE EXCEPTION 'a settled Stripe cancellation must store refunded';
  END IF;

  -- A replayed refund webhook must not undo a settled full cancellation.
  PERFORM public.biz_refund_order_commit_from_webhook(v_plain_order,'re-plain',1200,'NGN',NULL,NULL);
  IF (SELECT payment_status FROM public.orders WHERE id=v_plain_order) <> 'refunded' THEN
    RAISE EXCEPTION 'a webhook replay must keep the order refunded';
  END IF;

  -- A line whose share rounds to nothing still gets a cent, so the cancel runs.
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_tiny_order,v_event,5000,'NGN','paid','pi-tiny','ch-tiny','legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES ('00000000-0000-4000-8000-000000003281',v_tiny_order,v_tier,1,1,1),
      ('ffffffff-ffff-4fff-bfff-ffffffff3281',v_tiny_order,v_tier,1,9999,9999);
  PERFORM public.issue_3872_cancel_refund_order(v_tiny_order,
    jsonb_build_array(
      jsonb_build_object('order_line_item_id','00000000-0000-4000-8000-000000003281','quantity',1),
      jsonb_build_object('order_line_item_id','ffffffff-ffff-4fff-bfff-ffffffff3281','quantity',1)),
    'The organiser cancelled this event','cancel-tiny-1');
  SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_tiny_order;
  IF (SELECT SUM(amount_cents) FROM public.refund_line_items WHERE refund_id=v_refund) <> 5000
     OR (SELECT min(amount_cents) FROM public.refund_line_items WHERE refund_id=v_refund) < 1 THEN
    RAISE EXCEPTION 'rounding must keep every line positive and the sum exact';
  END IF;

  -- Whichever refund settles last, a full cancellation ends as refunded.
  FOREACH v_cancel_first IN ARRAY ARRAY[true,false] LOOP
    v_race_order := gen_random_uuid();
    v_race_line := gen_random_uuid();
    INSERT INTO public.orders(
      id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
    ) VALUES (v_race_order,v_event,2200,'NGN','paid','pi-'||v_race_order,'ch-'||v_race_order,'legacy');
    INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
      VALUES (v_race_line,v_race_order,v_tier,2,1000,2000);
    INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
      VALUES (v_race_order,v_tier,1,0,0);
    PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
    PERFORM public.biz_refund_order(v_race_order,
      jsonb_build_array(jsonb_build_object('order_line_item_id',v_race_line,'quantity',1)),
      'One ticket back first','race-'||v_race_order);
    SELECT id INTO v_manual FROM public.refunds WHERE order_id=v_race_order;
    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM public.issue_3872_cancel_refund_order(v_race_order,
      jsonb_build_array(jsonb_build_object('order_line_item_id',v_race_line,'quantity',1)),
      'The organiser cancelled this event','race-cancel-'||v_race_order);
    SELECT id INTO v_refund FROM public.refunds WHERE order_id=v_race_order AND id<>v_manual;
    PERFORM public.issue_2097_finalize_not_applicable(v_manual,'paystack','re-m-'||v_race_order);
    PERFORM public.issue_2097_finalize_not_applicable(v_refund,'paystack','re-c-'||v_race_order);
    IF v_cancel_first THEN
      PERFORM public.admin_refund_order_commit(v_refund,'re-c-'||v_race_order,0,'succeeded');
    END IF;
    PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
    PERFORM public.biz_refund_order_commit(v_manual,'re-m-'||v_race_order,0,'succeeded');
    PERFORM set_config('request.jwt.claim.sub','',true);
    IF NOT v_cancel_first THEN
      PERFORM public.admin_refund_order_commit(v_refund,'re-c-'||v_race_order,0,'succeeded');
    END IF;
    IF (SELECT payment_status FROM public.orders WHERE id=v_race_order) <> 'refunded' THEN
      RAISE EXCEPTION 'a full cancellation must end refunded (cancel first: %)',v_cancel_first;
    END IF;
  END LOOP;

  -- A Stripe dashboard refund arrives with no fee amount and must still reconcile.
  v_race_order := gen_random_uuid();
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_race_order,v_event,2000,'NGN','paid','pi-'||v_race_order,'ch-'||v_race_order,'legacy');
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_race_order,v_tier,2,1000,2000);
  PERFORM public.biz_refund_order_commit_from_webhook(v_race_order,'re-dash-'||v_race_order,1000,'NGN',NULL,NULL);
  IF (SELECT application_fee_refunded_cents IS NOT NULL
             OR application_fee_refund_status <> 'unknown_legacy' OR status <> 'succeeded'
        FROM public.refunds WHERE stripe_refund_id='re-dash-'||v_race_order)
     OR (SELECT payment_status FROM public.orders WHERE id=v_race_order) <> 'partial_refund' THEN
    RAISE EXCEPTION 'a dashboard refund must reconcile with its fee unknown';
  END IF;

  -- A webhook that settles a pending refund keeps the fee it already has.
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM public.biz_refund_order(v_race_order,
    jsonb_build_array(jsonb_build_object(
      'order_line_item_id',(SELECT id FROM public.order_line_items WHERE order_id=v_race_order),
      'quantity',1)),
    'The second ticket back','dash-hint-'||v_race_order);
  PERFORM set_config('request.jwt.claim.sub','',true);
  SELECT id INTO v_manual FROM public.refunds WHERE order_id=v_race_order AND status='pending';
  PERFORM public.issue_2097_finalize_not_applicable(v_manual,'paystack','re-hint-'||v_race_order);
  UPDATE public.refunds SET status='pending' WHERE id=v_manual;
  PERFORM public.biz_refund_order_commit_from_webhook(v_race_order,'re-hint-'||v_race_order,1000,'NGN',NULL,
    'dash-hint-'||v_race_order);
  IF (SELECT status <> 'succeeded' OR application_fee_refunded_cents IS DISTINCT FROM 0
        FROM public.refunds WHERE id=v_manual)
     OR (SELECT payment_status FROM public.orders WHERE id=v_race_order) <> 'refunded' THEN
    RAISE EXCEPTION 'a matched webhook must keep the stored fee';
  END IF;

  -- A redelivered dashboard refund voids no more tickets than it returned.
  v_race_order := gen_random_uuid();
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_race_order,v_event,2000,'NGN','paid','pi-'||v_race_order,'ch-'||v_race_order,'legacy');
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_race_order,v_tier,2,1000,2000);
  INSERT INTO public.tickets(order_id,ticket_type_id,event_id,qr_code,status,approval_status)
    SELECT v_race_order,v_tier,v_event,'qr-'||v_race_order||'-'||n,'valid','auto'
    FROM generate_series(1,2) AS n;
  PERFORM public.biz_refund_order_commit_from_webhook(v_race_order,'re-again-'||v_race_order,1000,'NGN',NULL,NULL);
  PERFORM public.biz_refund_order_commit_from_webhook(v_race_order,'re-again-'||v_race_order,1000,'NGN',NULL,NULL);
  IF (SELECT count(*) FROM public.tickets WHERE order_id=v_race_order AND status='valid') <> 1
     OR (SELECT count(*) FROM public.refunds WHERE order_id=v_race_order) <> 1 THEN
    RAISE EXCEPTION 'a redelivered refund must leave the unrefunded ticket valid';
  END IF;

  -- Dashboard refunds lock the order before they choose ticket lines.
  IF position('FOR NO KEY UPDATE' IN pg_get_functiondef('public.biz_refund_order_commit_from_webhook(uuid,text,integer,character,integer,text)'::regprocedure))
     > position('INSERT INTO public.refunds' IN pg_get_functiondef('public.biz_refund_order_commit_from_webhook(uuid,text,integer,character,integer,text)'::regprocedure)) THEN
    RAISE EXCEPTION 'a dashboard refund must lock the order before allocating';
  END IF;
  -- It takes the referral share first, as every settlement's share trigger does.
  IF position('FROM public.payee_shares' IN pg_get_functiondef('public.biz_refund_order_commit_from_webhook(uuid,text,integer,character,integer,text)'::regprocedure))
     NOT BETWEEN 1 AND position('FOR NO KEY UPDATE' IN pg_get_functiondef('public.biz_refund_order_commit_from_webhook(uuid,text,integer,character,integer,text)'::regprocedure)) THEN
    RAISE EXCEPTION 'a dashboard refund must lock the referral share before the order';
  END IF;

  -- A dashboard refund leaves lines held by a pending in-app refund alone.
  -- The held line sorts first, so the allocator reaches it before the free one.
  v_race_order := gen_random_uuid();
  v_race_line := '00000000-0000-4000-8000-0000000a3281';
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_race_order,v_event,2000,'NGN','paid','pi-'||v_race_order,'ch-'||v_race_order,'legacy');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_race_line,v_race_order,v_tier,1,1000,1000);
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_race_order,v_tier,1,1000,1000);
  INSERT INTO public.tickets(order_id,ticket_type_id,event_id,qr_code,status,approval_status)
    SELECT v_race_order,v_tier,v_event,'qr-held-'||v_race_order||'-'||n,'valid','auto'
    FROM generate_series(1,2) AS n;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM public.biz_refund_order(v_race_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id',v_race_line,'quantity',1)),
    'The first ticket back','held-'||v_race_order);
  PERFORM set_config('request.jwt.claim.sub','',true);
  SELECT id INTO v_manual FROM public.refunds WHERE order_id=v_race_order AND status='pending';
  PERFORM public.biz_refund_order_commit_from_webhook(v_race_order,'re-other-'||v_race_order,1000,'NGN',NULL,NULL);
  IF EXISTS (
    SELECT 1 FROM public.refund_line_items rli JOIN public.refunds r ON r.id=rli.refund_id
    WHERE r.stripe_refund_id='re-other-'||v_race_order AND rli.order_line_item_id=v_race_line
  ) THEN
    RAISE EXCEPTION 'a dashboard refund must not take a line a pending refund holds';
  END IF;
  PERFORM public.issue_2097_finalize_not_applicable(v_manual,'paystack','re-held-'||v_race_order);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM public.biz_refund_order_commit(v_manual,'re-held-'||v_race_order,0,'succeeded');
  PERFORM set_config('request.jwt.claim.sub','',true);
  IF (SELECT payment_status FROM public.orders WHERE id=v_race_order) <> 'refunded'
     OR EXISTS (SELECT 1 FROM public.tickets WHERE order_id=v_race_order AND status='valid') THEN
    RAISE EXCEPTION 'both refunds together must return the whole order';
  END IF;

  -- Two refunds smaller than the ticket that together return the charge refund it.
  v_race_order := gen_random_uuid();
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_race_order,v_event,1000,'NGN','paid','pi-'||v_race_order,'ch-'||v_race_order,'legacy');
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_race_order,v_tier,1,1000,1000);
  INSERT INTO public.tickets(order_id,ticket_type_id,event_id,qr_code,status,approval_status)
    VALUES (v_race_order,v_tier,v_event,'qr-half-'||v_race_order,'valid','auto');
  PERFORM public.biz_refund_order_commit_from_webhook(v_race_order,'re-half-a-'||v_race_order,500,'NGN',NULL,NULL);
  IF (SELECT status FROM public.tickets WHERE order_id=v_race_order) <> 'valid' THEN
    RAISE EXCEPTION 'half the charge back must keep the ticket';
  END IF;
  PERFORM public.biz_refund_order_commit_from_webhook(v_race_order,'re-half-b-'||v_race_order,500,'NGN',NULL,NULL);
  IF (SELECT status FROM public.tickets WHERE order_id=v_race_order) <> 'refunded'
     OR (SELECT payment_status FROM public.orders WHERE id=v_race_order) <> 'refunded'
     OR EXISTS (
       SELECT 1 FROM public.refunds r
       WHERE r.order_id=v_race_order
         AND (SELECT COALESCE(SUM(amount_cents),0) FROM public.refund_line_items WHERE refund_id=r.id) > r.amount_cents
     ) THEN
    RAISE EXCEPTION 'refunds that return the whole charge must refund the ticket, within their own amounts';
  END IF;

  -- On a two-ticket line, 500 then 1,500 returns both tickets in one row per refund line.
  v_race_order := gen_random_uuid();
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES (v_race_order,v_event,2000,'NGN','paid','pi-'||v_race_order,'ch-'||v_race_order,'legacy');
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES (v_race_order,v_tier,2,1000,2000);
  INSERT INTO public.tickets(order_id,ticket_type_id,event_id,qr_code,status,approval_status)
    SELECT v_race_order,v_tier,v_event,'qr-pair-'||v_race_order||'-'||n,'valid','auto'
    FROM generate_series(1,2) AS n;
  PERFORM public.biz_refund_order_commit_from_webhook(v_race_order,'re-pair-a-'||v_race_order,500,'NGN',NULL,NULL);
  PERFORM public.biz_refund_order_commit_from_webhook(v_race_order,'re-pair-b-'||v_race_order,1500,'NGN',NULL,NULL);
  IF (SELECT rli.quantity <> 2 OR rli.amount_cents <> 1500 FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id=rli.refund_id WHERE r.stripe_refund_id='re-pair-b-'||v_race_order)
     OR EXISTS (SELECT 1 FROM public.tickets WHERE order_id=v_race_order AND status='valid')
     OR (SELECT payment_status FROM public.orders WHERE id=v_race_order) <> 'refunded' THEN
    RAISE EXCEPTION 'the completing refund must merge into its own row for the line';
  END IF;

  -- The Stripe finalizer locks the order before its ticket update fires the counter trigger.
  IF position('FOR NO KEY UPDATE' IN pg_get_functiondef('public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text)'::regprocedure))
     > position('UPDATE public.tickets' IN pg_get_functiondef('public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text)'::regprocedure)) THEN
    RAISE EXCEPTION 'the finalizer must lock the order before updating tickets';
  END IF;
END;
$test$;

ROLLBACK;
