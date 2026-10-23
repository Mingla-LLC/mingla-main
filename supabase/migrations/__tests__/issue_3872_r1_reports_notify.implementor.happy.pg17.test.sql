-- Issue #3872 T13 — reports, lifecycle notices, payout visibility and margin.
-- MINGLA-INVARIANT: I-3872-REPORT-NO-PII | issue #3872 | Aggregate discount reports exclude comps and buyer contacts remain separately finance-gated.
-- MINGLA-INVARIANT: I-3872-DISCOUNT-NOTIFY-ONCE | issue #3872 | Maintenance emits each lifecycle notice until successful delivery marks that exact type.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '38721300-0000-4000-8400-000000000001';
  v_stranger uuid := '38721300-0000-4000-8400-000000000002';
  v_brand uuid := '38721300-0000-4000-8400-000000000003';
  v_event uuid := '38721300-0000-4000-8400-000000000004';
  v_ticket uuid := '38721300-0000-4000-8400-000000000005';
  v_order uuid := '38721300-0000-4000-8400-000000000006';
  v_comp uuid := '38721300-0000-4000-8400-000000000007';
  v_report_discount uuid := '38721300-0000-4000-8400-000000000008';
  v_window uuid := '38721300-0000-4000-8400-000000000009';
  v_count uuid := '38721300-0000-4000-8400-000000000010';
  v_uses uuid := '38721300-0000-4000-8400-000000000011';
  v_limit uuid := '38721300-0000-4000-8400-000000000012';
  v_release uuid := '38721300-0000-4000-8400-000000000013';
  v_report jsonb;
  v_sweep jsonb;
  v_payout jsonb;
  v_notice jsonb;
  v_denied boolean := false;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_owner,'r1-reports-owner@example.test'),(v_stranger,'r1-reports-stranger@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'r1-reports-owner@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,payment_provider,pricing_region,pricing_currency)
  VALUES(v_brand,v_owner,'R1 report brand','r1-report-brand','USD','stripe','US','USD');
  INSERT INTO public.events(id,brand_id,title,slug,status,currency,event_type)
  VALUES(v_event,v_brand,'R1 report event','r1-report-event','ended','USD','event');
  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free)
  VALUES(v_ticket,v_event,'General',2500,'USD',false);
  INSERT INTO public.brand_discounts(
    id,brand_id,kind,code,name,value_type,value_bps,scope_kind,combines_with,
    starts_at,ends_at,ends_after_count,max_total_uses,status,created_by
  ) VALUES
    (v_report_discount,v_brand,'code','REPORT10','Report ten','percent',1000,'brand','automatic_only',now()-interval '2 days',NULL,NULL,NULL,'active',v_owner),
    (v_window,v_brand,'automatic',NULL,'Window deal','percent',500,'brand','any',now()-interval '2 days',now()-interval '1 hour',NULL,NULL,'active',v_owner),
    (v_count,v_brand,'automatic',NULL,'Count deal','percent',500,'brand','any',now()-interval '2 days',NULL,2,NULL,'active',v_owner),
    (v_uses,v_brand,'automatic',NULL,'Uses deal','percent',500,'brand','any',now()-interval '2 days',NULL,NULL,1,'active',v_owner),
    (v_limit,v_brand,'automatic',NULL,'Almost gone','percent',500,'brand','any',now()-interval '2 days',NULL,NULL,10,'active',v_owner);

  INSERT INTO public.orders(
    id,event_id,buyer_email,buyer_name,buyer_phone_e164,total_cents,list_subtotal_cents,discount_cents,
    net_subtotal_cents,buyer_fees_cents,tax_cents,buyer_total_cents,currency,payment_status,
    payment_method,stripe_application_fee_amount_cents,source,comp_request_key,pricing_source,created_at
  ) VALUES
    (v_order,v_event,'new@example.test','New buyer','+15553872131',4500,5000,500,4500,0,0,4500,'USD','paid','online_card',200,'legacy',NULL,'computed_at_checkout',now()-interval '1 hour'),
    (v_comp,v_event,'comp@example.test','Comp buyer',NULL,0,5000,5000,0,0,0,0,'USD','paid','free',0,'comp','r1-t13-comp','computed_at_checkout',now()-interval '1 hour');
  INSERT INTO public.order_discount_lines(
    order_kind,order_id,line_ref,discount_id,brand_id,kind,code_snapshot,name_snapshot,
    value_type,value_bps,units,amount_minor,applied_seq,currency
  ) VALUES
    ('ticket',v_order,'line-1',v_report_discount,v_brand,'code','REPORT10','Report ten','percent',1000,2,500,1,'USD'),
    ('ticket',v_comp,'line-1',v_report_discount,v_brand,'code','REPORT10','Report ten','percent',1000,2,5000,1,'USD');
  INSERT INTO public.payout_source_fee_snapshots(source_type,source_id,provider_fee_cents)
  VALUES('order',v_order,100);

  INSERT INTO public.discount_uses(
    discount_id,brand_id,checkout_kind,checkout_ref_id,buyer_email_norm,status,units,
    amount_minor,expires_at,consumed_at
  ) VALUES
    (v_count,v_brand,'ticket',gen_random_uuid(),'count@example.test','consumed',2,100,now()+interval '1 day',now()),
    (v_uses,v_brand,'ticket',gen_random_uuid(),'uses@example.test','consumed',1,100,now()+interval '1 day',now());
  INSERT INTO public.discount_uses(
    discount_id,brand_id,checkout_kind,checkout_ref_id,buyer_email_norm,status,units,
    amount_minor,expires_at,consumed_at
  )
  SELECT v_limit,v_brand,'ticket',gen_random_uuid(),'limit'||n||'@example.test','consumed',1,100,now()+interval '1 day',now()
  FROM generate_series(1,8) n;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_report := public.brand_discount_report(v_brand,now()-interval '1 day',now()+interval '1 day');
  IF (v_report->>'orders')::integer<>1
     OR (v_report->>'revenueCents')::integer<>4500
     OR (v_report->>'amountGivenAwayCents')::integer<>500
     OR jsonb_array_length(v_report->'discounts')<>1 THEN
    RAISE EXCEPTION 'T13 aggregate report included a comp or lost money truth: %',v_report;
  END IF;
  IF (SELECT count(*) FROM public.brand_discount_report_buyers(
      v_brand,now()-interval '1 day',now()+interval '1 day'))<>1 THEN
    RAISE EXCEPTION 'T13 owner could not export the one non-comp buyer';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_stranger::text,true);
  BEGIN
    PERFORM public.brand_discount_report_buyers(v_brand,now()-interval '1 day',now()+interval '1 day');
  EXCEPTION WHEN others THEN v_denied := SQLERRM LIKE '%insufficient_permission%';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'T13 buyer contact export was not rank-gated'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_sweep := public.issue_3872_discount_maintenance(now());
  IF jsonb_array_length(v_sweep->'notify')<>4
     OR (SELECT status FROM public.brand_discounts WHERE id=v_window)<>'ended'
     OR (SELECT ended_reason FROM public.brand_discounts WHERE id=v_window)<>'window'
     OR (SELECT ended_reason FROM public.brand_discounts WHERE id=v_count)<>'count'
     OR (SELECT ended_reason FROM public.brand_discounts WHERE id=v_uses)<>'uses'
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_sweep->'notify') n
       WHERE n->>'discountId'=v_limit::text AND n->>'type'='business.discount_limit_80' AND (n->>'left')::integer=2) THEN
    RAISE EXCEPTION 'T13 maintenance lifecycle mismatch: %',v_sweep;
  END IF;
  FOR v_notice IN SELECT value FROM jsonb_array_elements(v_sweep->'notify') LOOP
    PERFORM public.issue_3872_mark_discount_notified(
      (v_notice->>'discountId')::uuid,v_notice->>'type'
    );
  END LOOP;
  IF jsonb_array_length((public.issue_3872_discount_maintenance(now()))->'notify')<>0 THEN
    RAISE EXCEPTION 'T13 a delivered lifecycle notice was emitted twice';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.issue_3872_order_margin m
    WHERE m.order_id=v_order AND m.list_subtotal_cents=5000
      AND m.discount_cents=500 AND m.buyer_total_cents=4500
      AND m.application_fee_cents=200 AND m.provider_fee_cents=100
      AND m.mingla_margin_cents=100 AND m.discounted) THEN
    RAISE EXCEPTION 'T13 margin view lost the legacy-source paid order';
  END IF;

  INSERT INTO public.brand_payout_releases(
    id,brand_id,event_id,occurrence_key,surface,provider,currency,anchor_end_at,
    releasable_at,gross_cents,mingla_fee_cents,net_release_cents,status
  ) VALUES(v_release,v_brand,v_event,'r1-t13','order','stripe','usd',
    now()-interval '2 days',now()-interval '1 day',4500,200,4300,'pending');
  INSERT INTO public.payout_release_items(
    release_id,source_type,source_id,gross_cents,mingla_fee_cents,provider_fee_cents,
    net_cents,source_finalized_at
  ) VALUES(v_release,'order',v_order,4500,200,100,4300,now()-interval '1 hour');
  v_payout := public.brand_get_payout_screen(v_brand);
  IF (v_payout#>>'{releases,0,discount_cents}')::integer<>500
     OR (v_payout#>>'{releases,0,items,0,discount_cents}')::integer<>500 THEN
    RAISE EXCEPTION 'T13 payout screen did not disclose Host-given discounts: %',v_payout;
  END IF;
END
$test$;

ROLLBACK;
