-- #3872 R1 side-effect-free quote and create parity.
-- MINGLA-INVARIANT: I-3872-ENGINE-PARITY | issue #3872 | Quote and checkout creation return the same net lines, totals, and digest for identical inputs.
-- MINGLA-INVARIANT: I-3872-QUOTE-NO-SIDE-EFFECTS | issue #3872 | Quoting writes no checkout session, item, use, order, or day-hold row.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '38728000-0000-4000-8400-000000000001';
  v_brand uuid := '38728000-0000-4000-8400-000000000002';
  v_event uuid := '38728000-0000-4000-8400-000000000003';
  v_ticket_a uuid := '38728000-0000-4000-8400-000000000004';
  v_ticket_b uuid := '38728000-0000-4000-8400-000000000005';
  v_sale uuid := '38728000-0000-4000-8400-000000000006';
  v_code uuid := '38728000-0000-4000-8400-000000000007';
  v_i integer;
  v_qty integer;
  v_ticket uuid;
  v_code_text text;
  v_lines jsonb;
  v_quote jsonb;
  v_created jsonb;
  v_before bigint[];
  v_after bigint[];
  v_quote_line jsonb;
  v_created_line jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'r1-parity-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'r1-parity-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'R1 parity brand','r1-parity-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_r1_parity',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
    VALUES(v_brand,'discounts','pilot');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES(v_event,v_brand,v_owner,'R1 parity event','r1-parity-event','event',
    'scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES(v_event,now()+interval '1 day',now()+interval '1 day 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person
  ) VALUES
    (v_ticket_a,v_event,'General',2500,'USD',false,100,false,1,10,true,false),
    (v_ticket_b,v_event,'Premium',4000,'USD',false,100,false,1,10,true,false);
  INSERT INTO public.brand_discounts(
    id,brand_id,kind,code,name,value_type,value_bps,scope_kind,combines_with,
    status,created_by
  ) VALUES
    (v_sale,v_brand,'sale_price',NULL,'Public sale','percent',1000,'items','any','active',v_owner),
    (v_code,v_brand,'code','EXTRA5','Extra five','percent',500,'brand','automatic_only','active',v_owner);
  INSERT INTO public.brand_discount_targets(discount_id,target_kind,target_id)
    VALUES(v_sale,'ticket_type',v_ticket_a);

  FOR v_i IN 1..12 LOOP
    v_qty := 1+((v_i-1)%3);
    v_ticket := CASE WHEN ((v_i-1)/3)%2=0 THEN v_ticket_a ELSE v_ticket_b END;
    v_code_text := CASE WHEN v_i>6 THEN 'EXTRA-5' ELSE NULL END;
    v_lines := jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket,'quantity',v_qty));

    SELECT ARRAY[
      (SELECT count(*) FROM public.ticket_checkout_sessions),
      (SELECT count(*) FROM public.ticket_checkout_session_items),
      (SELECT count(*) FROM public.discount_uses),
      (SELECT count(*) FROM public.orders),
      (SELECT count(*) FROM public.ticket_checkout_session_event_dates)
    ] INTO v_before;
    v_quote := public.issue_3872_ticket_quote(
      v_event,v_lines,NULL,NULL,NULL,NULL,'full',v_code_text,
      format('buyer-%s@example.test',v_i),'+15555558'||lpad(v_i::text,3,'0'),NULL,NULL,false);
    SELECT ARRAY[
      (SELECT count(*) FROM public.ticket_checkout_sessions),
      (SELECT count(*) FROM public.ticket_checkout_session_items),
      (SELECT count(*) FROM public.discount_uses),
      (SELECT count(*) FROM public.orders),
      (SELECT count(*) FROM public.ticket_checkout_session_event_dates)
    ] INTO v_after;
    IF v_before IS DISTINCT FROM v_after THEN
      RAISE EXCEPTION 'T8 quote % wrote rows: before %, after %',v_i,v_before,v_after;
    END IF;

    v_created := public.biz_ticket_checkout_create_session(
      v_event,NULL,format('Buyer %s',v_i),format('buyer-%s@example.test',v_i),
      '+15555558'||lpad(v_i::text,3,'0'),false,v_lines,format('r1-t8-%s',v_i),
      now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,v_code_text,
      v_quote->>'quoteDigest');
    v_quote_line := v_quote->'lines'->0;
    v_created_line := v_created->'items'->0;
    IF v_created->>'quoteDigest' IS DISTINCT FROM v_quote->>'quoteDigest'
       OR (v_created->>'fullNetCents')::bigint<>(v_quote->>'netSubtotalCents')::bigint
       OR (v_created->>'fullListCents')::bigint<>(v_quote->>'listSubtotalCents')::bigint
       OR (v_created_line->>'ticketTypeId') IS DISTINCT FROM (v_quote_line->>'ticketTypeId')
       OR (v_created_line->>'quantity')::integer<>(v_quote_line->>'quantity')::integer
       OR (v_created_line->>'listUnitPriceCents')::integer<>(v_quote_line->>'listUnitCents')::integer
       OR (v_created_line->>'unitPriceCents')::integer<>(v_quote_line->>'netUnitCents')::integer
       OR (v_created_line->>'totalCents')::integer<>(v_quote_line->>'lineNetCents')::integer
       OR (v_created_line->>'discountCents')::integer<>(v_quote_line->>'discountCents')::integer
       OR v_created_line->'applied' IS DISTINCT FROM v_quote_line->'discounts' THEN
      RAISE EXCEPTION 'T8 quote/create parity failed for cart %: quote %, create %',
        v_i,v_quote,v_created;
    END IF;
  END LOOP;

  v_quote := public.issue_3872_ticket_quote(
    v_event,jsonb_build_array(jsonb_build_object('ticketTypeId',v_ticket_a,'quantity',1)),
    NULL,NULL,NULL,NULL,'full',NULL,'sale@example.test','+15555558999',NULL,NULL,false);
  IF (v_quote#>>'{lines,0,listUnitCents}')::integer<>2500
     OR (v_quote#>>'{lines,0,netUnitCents}')::integer<>2250
     OR (v_quote->>'netSubtotalCents')::integer<>2250 THEN
    RAISE EXCEPTION 'T8 one-unit sale all-in mismatch: %',v_quote;
  END IF;

  RAISE NOTICE 'issue_3872_r1_quote_parity: PASS (12 fixture carts)';
END
$test$;

ROLLBACK;
