-- Issue #3872 T12 — discounted refunds use the immutable paid net unit.
-- MINGLA-INVARIANT: I-3872-REFUND-NET | issue #3872 | A partial refund returns quantity times the net unit stored at purchase and never restores discount uses.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '38721200-0000-4000-8400-000000000001';
  v_brand uuid := '38721200-0000-4000-8400-000000000002';
  v_event uuid := '38721200-0000-4000-8400-000000000003';
  v_ticket uuid := '38721200-0000-4000-8400-000000000004';
  v_order uuid := '38721200-0000-4000-8400-000000000005';
  v_line uuid := '38721200-0000-4000-8400-000000000006';
  v_discount uuid := '38721200-0000-4000-8400-000000000007';
  v_preview jsonb;
  v_refund jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'r1-refund-net@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'r1-refund-net@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,payment_provider,pricing_region,pricing_currency)
  VALUES(v_brand,v_owner,'R1 refund net','r1-refund-net','USD','stripe','US','USD');
  INSERT INTO public.events(id,brand_id,title,slug,status,currency)
  VALUES(v_event,v_brand,'R1 refund event','r1-refund-event','ended','USD');
  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free)
  VALUES(v_ticket,v_event,'Discounted ticket',2500,'USD',false);
  INSERT INTO public.brand_discounts(
    id,brand_id,kind,code,name,value_type,value_bps,scope_kind,combines_with,status,created_by
  ) VALUES(v_discount,v_brand,'code','NET10','Ten off','percent',1000,'brand','automatic_only','active',v_owner);
  INSERT INTO public.orders(
    id,event_id,buyer_email,buyer_name,buyer_phone_e164,total_cents,list_subtotal_cents,discount_cents,
    net_subtotal_cents,buyer_fees_cents,tax_cents,buyer_total_cents,pricing_source,currency,payment_status,
    stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES(
    v_order,v_event,'buyer@example.test','Buyer','+15553872012',4500,5000,500,4500,0,0,4500,
    'computed_at_checkout','USD','paid','pi_3872_t12','ch_3872_t12','online_checkout'
  );
  INSERT INTO public.order_line_items(
    id,order_id,ticket_type_id,quantity,unit_price_cents,list_unit_price_cents,discount_cents,total_cents
  ) VALUES(v_line,v_order,v_ticket,2,2250,2500,500,4500);
  INSERT INTO public.order_discount_lines(
    order_kind,order_id,line_ref,discount_id,brand_id,kind,code_snapshot,name_snapshot,
    value_type,value_bps,units,amount_minor,applied_seq,currency
  ) VALUES('ticket',v_order,v_line::text,v_discount,v_brand,'code','NET10','Ten off',
    'percent',1000,2,500,1,'USD');
  INSERT INTO public.discount_uses(
    discount_id,brand_id,checkout_kind,checkout_ref_id,order_id,buyer_email_norm,
    status,units,amount_minor,expires_at,consumed_at
  ) VALUES(v_discount,v_brand,'ticket',v_order,v_order,'buyer@example.test',
    'consumed',2,500,now()+interval '1 hour',now());

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_preview := public.refund_preview(v_order,jsonb_build_array(jsonb_build_object(
    'order_line_item_id',v_line,'quantity',1,'amount_cents',2500
  )));
  IF (v_preview->>'amount_cents')::integer<>2250
     OR (v_preview#>>'{lines,0,amount_cents}')::integer<>2250
     OR EXISTS(SELECT 1 FROM public.refunds WHERE order_id=v_order) THEN
    RAISE EXCEPTION 'T12 preview did not preserve net-unit truth: %',v_preview;
  END IF;

  v_refund := public.biz_refund_order(v_order,jsonb_build_array(jsonb_build_object(
    'order_line_item_id',v_line,'quantity',1,'amount_cents',2500
  )),'Partial discounted refund','r1-t12-refund');
  IF (v_refund->>'amount_cents')::integer<>2250
     OR (SELECT amount_cents FROM public.refund_line_items
         WHERE refund_id=(v_refund->>'refund_id')::uuid)<>2250
     OR (SELECT status FROM public.discount_uses WHERE discount_id=v_discount)<>'consumed'
     OR (SELECT units FROM public.discount_uses WHERE discount_id=v_discount)<>2 THEN
    RAISE EXCEPTION 'T12 refund changed discount history or used list price: %',v_refund;
  END IF;
END
$test$;

ROLLBACK;
