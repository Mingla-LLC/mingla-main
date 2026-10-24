-- Issue #3872 R1 discounts: venue/deposit lifecycle, snapshots and Host controls.
-- MINGLA-INVARIANT: I-3872-VENUE-DEPOSIT-SNAPSHOT | issue #3872 | Venue orders and reservation deposits persist list, discount, and net truth together and atomically expand immutable discount lines.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '38721100-0000-4000-8400-000000000001';
  v_brand uuid := '38721100-0000-4000-8400-000000000002';
  v_venue uuid := '38721100-0000-4000-8400-000000000003';
  v_sitting uuid := '38721100-0000-4000-8400-000000000004';
  v_order uuid := '38721100-0000-4000-8400-000000000005';
  v_deposit uuid := '38721100-0000-4000-8400-000000000006';
  v_sale uuid := '38721100-0000-4000-8400-000000000007';
  v_code uuid := '38721100-0000-4000-8400-000000000008';
  v_per_buyer uuid := '38721100-0000-4000-8400-000000000009';
  v_bad_ref uuid := '38721100-0000-4000-8400-000000000010';
  v_free_discount uuid := '38721100-0000-4000-8400-000000000011';
  v_free_order uuid := '38721100-0000-4000-8400-000000000012';
  v_failed_deposit uuid := '38721100-0000-4000-8400-000000000013';
  v_round_two uuid := '38721100-0000-4000-8400-000000000014';
  v_menu uuid := '38721100-0000-4000-8400-000000000015';
  v_menu_item uuid := '38721100-0000-4000-8400-000000000016';
  v_snapshot jsonb;
  v_lines jsonb;
  v_quote jsonb;
  v_reserved jsonb;
  v_candidates jsonb;
  v_close jsonb;
  v_rejected boolean := false;
  v_changed integer;
BEGIN
  INSERT INTO auth.users(id,email)
    VALUES(v_owner,'r1-venue-owner@example.test');
  INSERT INTO public.creator_accounts(id,email)
    VALUES(v_owner,'r1-venue-owner@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
    VALUES(v_brand,v_owner,'R1 venue brand','r1-venue-brand','USD');
  INSERT INTO public.venue_listings(
    id,brand_id,slug,name,lat,lng,venue_category
  ) VALUES(v_venue,v_brand,'r1venue','R1 Venue',40.7,-74.0,'restaurant');
  INSERT INTO public.venue_reservation_settings(
    brand_id,venue_id,reservations_enabled,fee_enabled,fee_amount_cents,fee_currency
  ) VALUES(v_brand,v_venue,true,true,8000,'USD');
  INSERT INTO public.menus(id,brand_id,venue_id,name)
    VALUES(v_menu,v_brand,v_venue,'Lunch');
  INSERT INTO public.menu_items(
    id,menu_id,brand_id,name,price_cents,currency
  ) VALUES(v_menu_item,v_menu,v_brand,'Weekly lunch',8000,'USD');
  INSERT INTO public.venue_order_sessions(
    id,brand_id,venue_id,currency,tab_state,opened_by_user_id
  ) VALUES(v_sitting,v_brand,v_venue,'USD','open',v_owner);
  INSERT INTO public.brand_discounts(
    id,brand_id,kind,code,name,value_type,value_bps,value_minor,currency,scope_kind,combines_with,
    status,created_by
  ) VALUES
    (v_sale,v_brand,'sale_price',NULL,'Lunch sale','set_price',NULL,6500,'USD',
      'items','any','active',v_owner),
    (v_code,v_brand,'code','SAVE10','Save ten','percent',1000,NULL,NULL,
      'brand','automatic_only','active',v_owner);
  INSERT INTO public.brand_discounts(
    id,brand_id,kind,code,name,value_type,value_bps,scope_kind,combines_with,
    max_uses_per_buyer,status,created_by
  ) VALUES(
    v_per_buyer,v_brand,'automatic',NULL,'One per buyer','percent',500,
    'brand','any',1,'active',v_owner
  );
  INSERT INTO public.brand_discount_targets(discount_id,target_kind,target_id)
    VALUES(v_sale,'menu_item',v_menu_item);
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
    VALUES(v_brand,'discounts','pilot');

  -- Hosts retain an explicit per-venue deposit kill switch. The RPC takes the
  -- venue id, not the brand id, after venue settings became one-row-per-venue.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_changed := public.biz_set_discounts_allowed('venue_deposit',ARRAY[v_venue],false);
  IF v_changed <> 1 OR (SELECT discounts_allowed FROM public.venue_reservation_settings
         WHERE venue_id=v_venue) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T11 Host could not disable deposit discounts for its venue';
  END IF;
  v_changed := public.biz_set_discounts_allowed('venue_deposit',ARRAY[v_venue],true);
  IF v_changed <> 1 OR (SELECT discounts_allowed FROM public.venue_reservation_settings
         WHERE venue_id=v_venue) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T11 Host could not re-enable deposit discounts for its venue';
  END IF;

  v_lines := jsonb_build_array(jsonb_build_object(
    'lineRef','001','itemKind','menu_item','itemId',v_menu_item,
    'listingId',v_venue,'listingKind','venue_order','listUnitMinor',8000,
    'qty',1,'valueScale',1,'countScale',1,'allowed',true,'tz','UTC'
  ));
  v_candidates := public.issue_3872_discount_candidates(
    v_brand,v_lines,NULL,'{}'::jsonb,now()
  );
  IF NOT EXISTS(
       SELECT 1 FROM jsonb_array_elements(v_candidates->'automatics') x
       WHERE x->>'id'=v_sale::text
     ) OR EXISTS(
       SELECT 1 FROM jsonb_array_elements(v_candidates->'automatics') x
       WHERE x->>'id'=v_per_buyer::text
     ) THEN
    RAISE EXCEPTION 'T11 staff loader did not exclude the identity-limited automatic: %',
      v_candidates;
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.issue_3872_discount_candidates(
      v_brand,v_lines,'SAVE10','{}'::jsonb,now()
    );
  EXCEPTION WHEN others THEN
    v_rejected := SQLERRM LIKE '%discount_code_not_accepted%';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'T11 staff loader accepted a non-null code with no buyer';
  END IF;

  v_quote := public.issue_3872_discount_quote_lines(
    v_brand,'USD',v_lines,NULL,'{}'::jsonb,now()
  );
  IF (v_quote->>'listSubtotalMinor')::integer<>8000
     OR (v_quote->>'netSubtotalMinor')::integer<>6500 THEN
    RAISE EXCEPTION 'T11 staff sale quote mismatch: %',v_quote;
  END IF;
  v_reserved := public.issue_3872_reserve_discount_uses(
    'venue_order',v_bad_ref,v_brand,'USD',v_lines,NULL,'{}'::jsonb,
    repeat('0',32),now()+interval '1 hour',true,'staff'
  );
  IF (v_reserved->>'ok')::boolean
     OR EXISTS(SELECT 1 FROM public.discount_uses WHERE checkout_ref_id=v_bad_ref) THEN
    RAISE EXCEPTION 'T11 mismatched staff digest reserved a use: %',v_reserved;
  END IF;
  v_reserved := public.issue_3872_reserve_discount_uses(
    'venue_order',v_order,v_brand,'USD',v_lines,NULL,'{}'::jsonb,
    v_quote->>'digest',now()+interval '1 hour',true,'staff'
  );
  IF NOT (v_reserved->>'ok')::boolean
     OR (SELECT status FROM public.discount_uses
         WHERE checkout_kind='venue_order' AND checkout_ref_id=v_order)<>'consumed'
     OR EXISTS(
       SELECT 1 FROM public.discount_uses
       WHERE checkout_kind='venue_order' AND checkout_ref_id=v_order
         AND (buyer_user_id IS NOT NULL OR buyer_email_norm IS NOT NULL
              OR buyer_phone_e164 IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'T11 staff use was not consumed without buyer identity: %',v_reserved;
  END IF;

  v_snapshot := jsonb_build_object(
    'currency','USD',
    'lines',jsonb_build_array(jsonb_build_object(
      'lineRef','1',
      'applied',jsonb_build_array(jsonb_build_object(
        'discountId',v_sale,'kind','sale_price','code',NULL,
        'name','Lunch sale','valueType','set_price','valueBps',NULL,
        'valueMinor',6500,'units',1,'lineMinor',1500,'seq',1
      ))
    ))
  );

  INSERT INTO public.venue_orders(
    id,session_id,brand_id,venue_id,source,pickup_code,buyer_name,money_path,
    currency,list_subtotal_cents,discount_cents,subtotal_cents,
    effective_take_rate_bps,service_fee_bps,pass_mingla_fee,pass_service_fee,
    pass_tax,buyer_subtotal_cents,total_cents,idempotency_key,discount_snapshot
  ) VALUES(
    v_order,v_sitting,v_brand,v_venue,'guest_page','42','Guest','venue_collected',
    'USD',8000,1500,6500,0,0,false,false,false,6500,6500,
    'r1-t11-venue-order',v_snapshot
  );

  IF (SELECT count(*) FROM public.order_discount_lines
      WHERE order_kind='venue_order' AND order_id=v_order) <> 1
     OR (SELECT line_ref FROM public.order_discount_lines
         WHERE order_kind='venue_order' AND order_id=v_order) IS DISTINCT FROM '1'
     OR (SELECT amount_minor FROM public.order_discount_lines
         WHERE order_kind='venue_order' AND order_id=v_order) <> 1500 THEN
    RAISE EXCEPTION 'T11 venue snapshot did not expand exactly once';
  END IF;
  IF (SELECT order_id FROM public.discount_uses
      WHERE checkout_kind='venue_order' AND checkout_ref_id=v_order)
      IS DISTINCT FROM v_order THEN
    RAISE EXCEPTION 'T11 consumed staff use was not bound to its inserted order';
  END IF;

  INSERT INTO public.brand_discounts(
    id,brand_id,kind,code,name,value_type,value_bps,scope_kind,combines_with,
    status,created_by
  ) VALUES(
    v_free_discount,v_brand,'automatic',NULL,'Free round','percent',10000,
    'brand','any','active',v_owner
  );
  INSERT INTO public.discount_uses(
    discount_id,brand_id,checkout_kind,checkout_ref_id,buyer_email_norm,
    status,units,amount_minor,expires_at,channel
  ) VALUES(
    v_free_discount,v_brand,'venue_order',v_free_order,'free@example.test',
    'reserved',1,8000,now()+interval '1 hour','online'
  );
  v_snapshot := jsonb_build_object(
    'currency','USD','lines',jsonb_build_array(jsonb_build_object(
      'lineRef','1','applied',jsonb_build_array(jsonb_build_object(
        'discountId',v_free_discount,'kind','automatic','code',NULL,
        'name','Free round','valueType','percent','valueBps',10000,
        'valueMinor',NULL,'units',1,'lineMinor',8000,'seq',1
      ))
    ))
  );
  INSERT INTO public.venue_orders(
    id,session_id,brand_id,venue_id,source,pickup_code,buyer_name,money_path,
    currency,list_subtotal_cents,discount_cents,subtotal_cents,
    effective_take_rate_bps,service_fee_bps,pass_mingla_fee,pass_service_fee,
    pass_tax,buyer_subtotal_cents,total_cents,payment_status,idempotency_key,
    discount_snapshot
  ) VALUES(
    v_free_order,v_sitting,v_brand,v_venue,'guest_page','43','Free Guest',
    'venue_collected','USD',8000,8000,0,0,0,false,false,false,0,0,'paid',
    'r1-t11-free-order',v_snapshot
  );
  IF (SELECT status FROM public.discount_uses
      WHERE checkout_kind='venue_order' AND checkout_ref_id=v_free_order)
      IS DISTINCT FROM 'consumed'
     OR (SELECT order_id FROM public.discount_uses
         WHERE checkout_kind='venue_order' AND checkout_ref_id=v_free_order)
        IS DISTINCT FROM v_free_order THEN
    RAISE EXCEPTION 'T11 free paid venue insert did not consume its use';
  END IF;

  v_snapshot := jsonb_build_object(
    'currency','USD',
    'lines',jsonb_build_array(jsonb_build_object(
      'lineRef',NULL,
      'applied',jsonb_build_array(jsonb_build_object(
        'discountId',v_code,'kind','code','code','SAVE10',
        'name','Save ten','valueType','percent','valueBps',1000,
        'valueMinor',NULL,'units',1,'lineMinor',800,'seq',1
      ))
    ))
  );
  INSERT INTO public.discount_uses(
    discount_id,brand_id,checkout_kind,checkout_ref_id,buyer_email_norm,
    status,units,amount_minor,expires_at,channel
  ) VALUES(
    v_code,v_brand,'reservation_deposit',v_deposit,'guest@example.test',
    'reserved',1,800,now()+interval '1 hour','online'
  );
  INSERT INTO public.reservation_checkout_sessions(
    id,brand_id,venue_id,reserved_for,party_size,buyer_name,buyer_email,
    buyer_phone_e164,amount_cents,currency,created_via,deposit_list_cents,
    discount_cents,discount_code,discount_snapshot,status
  ) VALUES(
    v_deposit,v_brand,v_venue,now()+interval '1 day',2,'Guest',
    'guest@example.test','+15555550111',7200,'USD','web',8000,800,
    'SAVE10',v_snapshot,'completed'
  );

  IF (SELECT count(*) FROM public.order_discount_lines
      WHERE order_kind='reservation_deposit' AND order_id=v_deposit) <> 1
     OR (SELECT line_ref FROM public.order_discount_lines
         WHERE order_kind='reservation_deposit' AND order_id=v_deposit) IS NOT NULL
     OR (SELECT code_snapshot FROM public.order_discount_lines
         WHERE order_kind='reservation_deposit' AND order_id=v_deposit)
        IS DISTINCT FROM 'SAVE10' THEN
    RAISE EXCEPTION 'T11 deposit snapshot did not expand exactly once';
  END IF;
  IF (SELECT status FROM public.discount_uses
      WHERE checkout_kind='reservation_deposit' AND checkout_ref_id=v_deposit)
      IS DISTINCT FROM 'consumed' THEN
    RAISE EXCEPTION 'T11 completed deposit did not consume its reserved use';
  END IF;

  INSERT INTO public.discount_uses(
    discount_id,brand_id,checkout_kind,checkout_ref_id,buyer_email_norm,
    status,units,amount_minor,expires_at,channel
  ) VALUES(
    v_code,v_brand,'reservation_deposit',v_failed_deposit,'failed@example.test',
    'reserved',1,800,now()+interval '1 hour','online'
  );
  INSERT INTO public.reservation_checkout_sessions(
    id,brand_id,venue_id,reserved_for,party_size,buyer_name,buyer_email,
    buyer_phone_e164,amount_cents,currency,created_via,deposit_list_cents,
    discount_cents,discount_code,status
  ) VALUES(
    v_failed_deposit,v_brand,v_venue,now()+interval '2 days',2,'Failed Guest',
    'failed@example.test','+15555550112',7200,'USD','web',8000,800,
    'SAVE10','failed'
  );
  IF (SELECT status FROM public.discount_uses
      WHERE checkout_kind='reservation_deposit' AND checkout_ref_id=v_failed_deposit)
      IS DISTINCT FROM 'released' THEN
    RAISE EXCEPTION 'T11 failed deposit did not release its reserved use';
  END IF;

  INSERT INTO public.venue_orders(
    id,session_id,brand_id,venue_id,source,taken_by_user_id,pickup_code,
    buyer_name,money_path,currency,subtotal_cents,effective_take_rate_bps,
    service_fee_bps,pass_mingla_fee,pass_service_fee,pass_tax,
    buyer_subtotal_cents,total_cents,idempotency_key
  ) VALUES(
    v_round_two,v_sitting,v_brand,v_venue,'staff',v_owner,'44','Second round',
    'venue_collected','USD',2000,0,0,false,false,false,2000,2000,
    'r1-t11-round-two'
  );
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_owner,'role','authenticated')::text,
    true
  );
  v_close := public.biz_venue_tab_close(v_sitting,'bill_to_phone');
  IF (v_close->>'outstandingSubtotalCents')::integer<>8500
     OR (v_close->>'outstandingServiceChargeCents')::integer<>0
     OR (v_close->>'outstandingTipCents')::integer<>0 THEN
    RAISE EXCEPTION 'T11 tab close did not sum the rounds net subtotals: %',v_close;
  END IF;

  BEGIN
    v_rejected := false;
    UPDATE public.order_discount_lines SET amount_minor=1
      WHERE order_kind='venue_order' AND order_id=v_order;
  EXCEPTION WHEN others THEN
    v_rejected := SQLERRM LIKE '%order_discount_lines_immutable%';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'T11 immutable venue discount line accepted an update';
  END IF;

  IF (SELECT subtotal_cents + discount_cents = list_subtotal_cents
      FROM public.venue_orders WHERE id=v_order) IS DISTINCT FROM true
     OR (SELECT amount_cents + discount_cents = deposit_list_cents
         FROM public.reservation_checkout_sessions WHERE id=v_deposit)
        IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T11 list - discount = net identity failed';
  END IF;

  RAISE NOTICE 'issue_3872_r1_venue_deposit: PASS';
END
$test$;

ROLLBACK;
