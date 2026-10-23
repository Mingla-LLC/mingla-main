-- #3872 R1 ticket checkout adversarial contract.
-- MINGLA-INVARIANT: I-3872-CHECKOUT-ANON-REVOKED | issue #3872 | Checkout mutation and quote RPCs remain service-role only and legacy identities stay absent.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '38727000-0000-4000-8400-000000000001';
  v_buyer uuid := '38727000-0000-4000-8400-000000000002';
  v_brand uuid := '38727000-0000-4000-8400-000000000003';
  v_event uuid := '38727000-0000-4000-8400-000000000004';
  v_ticket uuid := '38727000-0000-4000-8400-000000000005';
  v_discount uuid := '38727000-0000-4000-8400-000000000006';
  v_limited uuid := '38727000-0000-4000-8400-000000000009';
  v_session uuid;
  v_expired_session uuid;
  v_order uuid := '38727000-0000-4000-8400-000000000007';
  v_comp uuid := '38727000-0000-4000-8400-000000000008';
  v_quote jsonb;
  v_created jsonb;
  v_second jsonb;
  v_four jsonb;
  v_three jsonb;
  v_raised boolean := false;
  v_sig text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_owner,'r1-adversarial-owner@example.test'),
    (v_buyer,'r1-adversarial-buyer@example.test');
  INSERT INTO public.creator_accounts(id,email)
    VALUES(v_owner,'r1-adversarial-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'R1 adversarial brand','r1-adversarial-brand',
    'USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_r1_adversarial',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
    VALUES(v_brand,'discounts','pilot');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES(v_event,v_brand,v_owner,'R1 adversarial event','r1-adversarial-event',
    'event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES(v_event,now()+interval '1 day',now()+interval '1 day 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person
  ) VALUES(v_ticket,v_event,'General',2000,'USD',false,100,false,1,10,true,false);
  INSERT INTO public.brand_discounts(
    id,brand_id,kind,code,name,value_type,value_bps,scope_kind,combines_with,
    max_uses_per_buyer,status,created_by
  ) VALUES(v_discount,v_brand,'code','BUYER10','Buyer ten','percent',1000,
    'brand','automatic_only',1,'active',v_owner);

  FOREACH v_sig IN ARRAY ARRAY[
    'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)',
    'public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)',
    'public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)',
    'public.issue_3872_ticket_quote(uuid,jsonb,uuid[],timestamptz,timestamptz,integer,text,text,text,text,uuid,text,boolean)'
  ] LOOP
    IF has_function_privilege('anon',v_sig,'EXECUTE')
       OR has_function_privilege('authenticated',v_sig,'EXECUTE')
       OR EXISTS(
         SELECT 1
         FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
         WHERE p.oid=to_regprocedure(v_sig) AND a.grantee=0 AND a.privilege_type='EXECUTE'
       ) THEN
      RAISE EXCEPTION 'T7 checkout ACL leak: %',v_sig;
    END IF;
  END LOOP;

  IF to_regprocedure('public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)') IS NOT NULL
     OR to_regprocedure('public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)') IS NOT NULL
     OR to_regprocedure('public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'T7 legacy 15/16-argument checkout identity remains';
  END IF;

  v_quote := public.issue_3872_ticket_quote(
    v_event,jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',1)),
    NULL,NULL,NULL,NULL,'full','BUYER10','first@example.test','+15555550701',
    NULL,NULL,false);
  UPDATE public.brand_discounts SET value_bps=2000 WHERE id=v_discount;
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      v_event,NULL,'First','first@example.test','+15555550701',false,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',1)),
      'r1-t7-stale',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,
      'BUYER10',v_quote->>'quoteDigest');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='checkout_quote_changed' THEN v_raised:=true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'T7 stale digest did not raise checkout_quote_changed'; END IF;

  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'First','first@example.test','+15555550701',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',1)),
    'r1-t7-first',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,
    'BUYER10',NULL);
  v_session := (v_created->>'checkoutSessionId')::uuid;
  UPDATE public.ticket_checkout_sessions SET status='failed' WHERE id=v_session;
  IF (SELECT status FROM public.discount_uses WHERE checkout_ref_id=v_session)<>'released' THEN
    RAISE EXCEPTION 'T7 failed session did not release use';
  END IF;

  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_email,buyer_name,buyer_phone,buyer_phone_e164,
    total_cents,currency,payment_method,payment_status,checkout_session_id,source,
    notification_status
  ) VALUES(v_order,v_event,v_buyer,'first@example.test','First','+15555550701',
    '+15555550701',1600,'USD','online_card','paid',v_session,'online_checkout','pending');
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES(v_order,v_ticket,1,1600,1600);
  UPDATE public.ticket_checkout_sessions SET order_id=v_order,
    list_subtotal_cents=2000,discount_cents=400,net_subtotal_cents=1600,
    buyer_fees_cents=0,tax_cents=0,buyer_total_cents=1600,
    pricing_source='computed_at_checkout' WHERE id=v_session;
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  IF (SELECT status FROM public.discount_uses WHERE checkout_ref_id=v_session)<>'consumed'
     OR (SELECT buyer_user_id FROM public.discount_uses WHERE checkout_ref_id=v_session) IS NOT NULL THEN
    RAISE EXCEPTION 'T7 late finalize or checkout identity snapshot mismatch';
  END IF;

  v_second := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Second','second@example.test','+15555550702',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',1)),
    'r1-t7-second',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,
    'BUYER10',NULL);
  IF (v_second->>'discountCents')::integer<>400 THEN
    RAISE EXCEPTION 'T7 order buyer_user_id leaked into per-buyer limit: %',v_second;
  END IF;

  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Expire','expire@example.test','+15555550703',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',1)),
    'r1-t7-expire',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,
    'BUYER10',NULL);
  v_expired_session := (v_created->>'checkoutSessionId')::uuid;
  UPDATE public.ticket_checkout_sessions SET status='expired' WHERE id=v_expired_session;
  IF (SELECT status FROM public.discount_uses WHERE checkout_ref_id=v_expired_session)<>'released' THEN
    RAISE EXCEPTION 'T7 expired session did not release use';
  END IF;

  INSERT INTO public.brand_discounts(
    id,brand_id,kind,name,value_type,value_bps,scope_kind,combines_with,
    ends_after_count,status,created_by
  ) VALUES(v_limited,v_brand,'automatic','First three units','percent',1000,
    'brand','any',3,'active',v_owner);
  v_four := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Limited Four','four@example.test','+15555550704',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',4)),
    'r1-t7-limited-four',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,
    NULL,NULL);
  v_three := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Limited Three','three@example.test','+15555550705',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',3)),
    'r1-t7-limited-three',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,
    NULL,NULL);
  IF (v_four->>'discountCents')::integer<>0
     OR (v_three->>'discountCents')::integer<>600
     OR (SELECT units FROM public.discount_uses
         WHERE checkout_ref_id=(v_three->>'checkoutSessionId')::uuid
           AND discount_id=v_limited)<>3 THEN
    RAISE EXCEPTION 'T7 D37 whole-line limit mismatch: qty4 %, qty3 %',v_four,v_three;
  END IF;

  INSERT INTO public.orders(
    id,event_id,buyer_email,buyer_name,total_cents,currency,payment_method,
    payment_status,source,notification_status,comp_issued_by,comp_request_key
  ) VALUES(v_comp,v_event,'comp@example.test','Comp',0,'USD','free','paid','comp',
    'pending',v_owner,'r1-t7-comp');
  IF EXISTS(SELECT 1 FROM public.discount_uses WHERE checkout_ref_id=v_comp)
     OR EXISTS(SELECT 1 FROM public.order_discount_lines WHERE order_id=v_comp) THEN
    RAISE EXCEPTION 'T7 comp order reached discount lifecycle';
  END IF;

  RAISE NOTICE 'issue_3872_r1_ticket_checkout adversarial: PASS';
END
$test$;

ROLLBACK;
