-- #3281 Extras, slice 4 part 3: the door sees the extras each order still owes.
-- MINGLA-INVARIANT: I-3281-DOOR-SEES-ORDER-EXTRAS | issue #3281 | The door reads, for orders it already found, each extra still owed (bought less refunded or pending refund) on live orders, with the dates it is for; only the door's own authority can read it.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_other_event uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_fri uuid := gen_random_uuid();
  v_sat uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_unpaid uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_dinner_item uuid := gen_random_uuid();
  v_refund uuid := gen_random_uuid();
  v_out jsonb;
  v_raised text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_stranger);
  INSERT INTO public.creator_accounts(id,email) VALUES
    (v_owner,'door-extras@example.test'), (v_stranger,'stranger@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,payment_provider,pricing_region,pricing_currency,default_currency
  ) VALUES (v_brand,v_owner,'Door extras','door-extras-'||v_brand,'paystack','NG','NGN','NGN');
  INSERT INTO public.events(id,brand_id,title,slug,status,currency) VALUES
    (v_event,v_brand,'Door extras','door-extras-'||v_event,'scheduled','NGN'),
    (v_other_event,v_brand,'Other','door-other-'||v_other_event,'scheduled','NGN');
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
    (v_fri,v_event,now()+interval '1 day',now()+interval '1 day 3 hours','UTC',true,'fri'),
    (v_sat,v_event,now()+interval '2 days',now()+interval '2 days 3 hours','UTC',false,'sat');
  INSERT INTO public.ticket_types(id,event_id,name,price_cents) VALUES (v_tier,v_event,'Weekend',10000);
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES
    (v_order,v_event,26000,'NGN','paid','pi-door','ch-door','legacy'),
    (v_unpaid,v_event,13500,'NGN','pending','pi-door-u','ch-door-u','legacy'),
    (v_plain,v_event,10000,'NGN','paid','pi-door-p','ch-door-p','legacy');
  INSERT INTO public.order_add_on_line_items(
    id,order_id,ticket_type_id,add_on_name_at_order,ticket_type_name_at_order,
    day_scope_at_order,quantity,unit_price_cents,total_cents
  ) VALUES
    (v_dinner_item,v_order,v_tier,'Friday dinner','Weekend',ARRAY['fri'],3,3500,10500),
    (gen_random_uuid(),v_order,v_tier,'Tote bag','Weekend',NULL,1,0,0),
    (gen_random_uuid(),v_unpaid,v_tier,'Friday dinner','Weekend',ARRAY['fri'],1,3500,3500);

  -- One dinner refunded: the door owes two.
  INSERT INTO public.refunds(id,order_id,amount_cents,currency,reason,status)
    VALUES (v_refund,v_order,3500,'NGN','One dinner refunded to the guest','succeeded');
  INSERT INTO public.refund_add_on_line_items(refund_id,order_add_on_line_item_id,quantity,amount_cents)
    VALUES (v_refund,v_dinner_item,1,3500);

  v_out := public.issue_3281_door_order_extras(v_owner, v_event, ARRAY[v_order, v_unpaid, v_plain]);
  IF jsonb_array_length(COALESCE(v_out->v_order::text,'[]')) <> 2 THEN
    RAISE EXCEPTION 'a paid order must list its two extras, got %', v_out;
  END IF;
  IF v_out->v_order::text->0 <> jsonb_build_object(
       'name','Friday dinner','quantity',2,'eventDateIds',jsonb_build_array(v_fri))
     OR v_out->v_order::text->1 <> jsonb_build_object(
       'name','Tote bag','quantity',1,'eventDateIds','null'::jsonb) THEN
    RAISE EXCEPTION 'the door must see what is still owed and its dates, got %', v_out->v_order::text;
  END IF;
  -- An unpaid order and an order without extras gain no key.
  IF v_out ? v_unpaid::text OR v_out ? v_plain::text THEN
    RAISE EXCEPTION 'only live orders with extras are listed, got %', v_out;
  END IF;

  -- A pending refund already takes the extra off the door; a fully refunded
  -- extra is left out.
  INSERT INTO public.refunds(id,order_id,amount_cents,currency,reason,status)
    VALUES (gen_random_uuid(),v_order,7000,'NGN','Two more dinners refunded to the guest','pending')
    RETURNING id INTO v_refund;
  INSERT INTO public.refund_add_on_line_items(refund_id,order_add_on_line_item_id,quantity,amount_cents)
    VALUES (v_refund,v_dinner_item,2,7000);
  v_out := public.issue_3281_door_order_extras(v_owner, v_event, ARRAY[v_order]);
  IF jsonb_array_length(v_out->v_order::text) <> 1 OR v_out->v_order::text->0->>'name' <> 'Tote bag' THEN
    RAISE EXCEPTION 'a refunded extra leaves the door, got %', v_out;
  END IF;

  -- Another event's door reads nothing of this order.
  IF public.issue_3281_door_order_extras(v_owner, v_other_event, ARRAY[v_order]) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'another event must not read this order';
  END IF;

  -- Only the door's own authority reads it, for at most 20 orders.
  BEGIN
    PERFORM public.issue_3281_door_order_extras(v_stranger, v_event, ARRAY[v_order]);
    v_raised := NULL;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'a stranger must be refused, got %', COALESCE(v_raised,'no error');
  END IF;
  BEGIN
    PERFORM public.issue_3281_door_order_extras(v_owner, v_event,
      ARRAY(SELECT gen_random_uuid() FROM generate_series(1,21)));
    v_raised := NULL;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS DISTINCT FROM 'too_many_orders' THEN
    RAISE EXCEPTION 'more than 20 orders must be refused, got %', COALESCE(v_raised,'no error');
  END IF;

  IF has_function_privilege('anon','public.issue_3281_door_order_extras(uuid,uuid,uuid[])','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3281_door_order_extras(uuid,uuid,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'the door reader stays server-only';
  END IF;
END;
$test$;

ROLLBACK;
