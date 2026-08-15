-- Issue #1795 implementor-owned happy-path and exact-once regression proof.
-- Apply the full migration chain first. This transaction leaves no fixtures.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t1795_fx (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE
  v_user uuid := '00000000-1795-4000-8000-000000000001';
  v_brand uuid := '00000000-1795-4000-8000-000000000002';
  v_venue uuid := '00000000-1795-4000-8000-000000000003';
  v_other uuid := '00000000-1795-4000-8000-000000000004';
  v_place uuid := '00000000-1795-4000-8000-000000000005';
  v_table uuid := '00000000-1795-4000-8000-000000000006';
  v_spot uuid;
  v_menu uuid;
  v_item uuid;
  v_res uuid;
  v_conflict_res uuid;
BEGIN
  INSERT INTO auth.users (id,instance_id,aud,role,email,created_at,updated_at)
  VALUES (v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-1795@example.test',now(),now());
  INSERT INTO public.creator_accounts(id,created_at) VALUES(v_user,now());
  INSERT INTO public.place_pool(id,name,lat,lng,utc_offset_minutes,created_at)
  VALUES(v_place,'Issue 1795 place',51.5,-0.1,60,now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
  VALUES(v_brand,v_user,'Issue 1795 Brand','issue1795brand','GBP',now(),now());
  INSERT INTO public.venue_listings(id,brand_id,place_pool_id,slug,name,lat,lng,venue_category,claim_status)
  VALUES
    (v_venue,v_brand,v_place,'issue1795venue','Issue 1795 Venue',51.5,-0.1,'restaurant','verified'),
    (v_other,v_brand,NULL,'issue1795other','Issue 1795 Other',51.5,-0.1,'restaurant','verified');
  UPDATE public.brand_team_members SET accepted_at=coalesce(accepted_at,now()),role='brand_owner'
   WHERE brand_id=v_brand AND user_id=v_user AND removed_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.brand_team_members(brand_id,user_id,role,invited_at,accepted_at)
    VALUES(v_brand,v_user,'brand_owner',now(),now());
  END IF;
  INSERT INTO public.venue_availability_config(brand_id,venue_id,place_pool_id,iana_timezone)
  VALUES(v_brand,v_venue,v_place,'Europe/London'),(v_brand,v_other,NULL,'Europe/London');
  INSERT INTO public.venue_reservation_settings(brand_id,venue_id,reservations_enabled)
  VALUES(v_brand,v_venue,true),(v_brand,v_other,true);
  INSERT INTO public.venue_tables(id,brand_id,venue_id,name,capacity,zone,is_active)
  VALUES(v_table,v_brand,v_venue,'Table 12',4,NULL,true);
  SELECT id INTO v_spot FROM public.qr_spots WHERE venue_table_id=v_table;
  INSERT INTO public.menus(brand_id,venue_id,name,is_active)
  VALUES(v_brand,v_venue,'Dinner',true) RETURNING id INTO v_menu;
  INSERT INTO public.menu_items(menu_id,brand_id,name,price_cents,currency,is_available,cost_cents)
  VALUES(v_menu,v_brand,'Old name',1200,'GBP',true,NULL) RETURNING id INTO v_item;
  INSERT INTO public.reservations(id,brand_id,venue_id,reserved_for,party_size,status,source)
  VALUES
    (gen_random_uuid(),v_brand,v_venue,now(),4,'seated','mingla'),
    (gen_random_uuid(),v_brand,v_venue,now(),3,'completed','phone');
  SELECT id INTO v_res FROM public.reservations WHERE brand_id=v_brand AND party_size=4;
  SELECT id INTO v_conflict_res FROM public.reservations WHERE brand_id=v_brand AND party_size=3;
  INSERT INTO t1795_fx VALUES
    ('user',v_user),('brand',v_brand),('venue',v_venue),('other',v_other),
    ('place',v_place),('table',v_table),('spot',v_spot),('menu',v_menu),
    ('item',v_item),('reservation',v_res),('conflict_reservation',v_conflict_res);
END $seed$;

CREATE OR REPLACE FUNCTION pg_temp.fx(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t1795_fx WHERE k=p_k $$;

CREATE OR REPLACE FUNCTION pg_temp.mint_session(
  p_currency text,
  p_reservation uuid DEFAULT NULL,
  p_claimed int DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.venue_order_sessions(
    brand_id,venue_id,qr_spot_id,reservation_id,party_size_claimed,currency
  ) VALUES(
    pg_temp.fx('brand'),pg_temp.fx('venue'),pg_temp.fx('spot'),p_reservation,p_claimed,p_currency
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mint_order(
  p_session uuid,
  p_currency text,
  p_source text,
  p_subtotal int,
  p_tip int,
  p_created timestamptz,
  p_reservation uuid DEFAULT NULL,
  p_settlement boolean DEFAULT false,
  p_money_path text DEFAULT 'mingla'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_take int := CASE WHEN p_money_path='mingla' THEN 1000 ELSE 0 END;
  v_svc int := CASE WHEN p_money_path='mingla' THEN 300 ELSE 0 END;
  v_fee int := round(p_subtotal::numeric*v_take/10000);
  v_platform int := round(p_subtotal::numeric*v_svc/10000);
  v_buyer int := p_subtotal+v_fee+v_platform;
BEGIN
  INSERT INTO public.venue_orders(
    session_id,brand_id,venue_id,qr_spot_id,spot_label_at_order,
    venue_table_id,zone_at_order,reservation_id,source,taken_by_user_id,
    buyer_name,buyer_email,buyer_phone_e164,money_path,currency,
    subtotal_cents,service_charge_bps,service_charge_cents,tip_cents,
    effective_take_rate_bps,service_fee_bps,mingla_fee_cents,
    platform_service_fee_cents,pass_mingla_fee,pass_service_fee,pass_tax,
    buyer_subtotal_cents,tax_amount_cents,total_cents,provider,
    payment_status,confirmed_at,idempotency_key,metadata,created_at
  ) VALUES(
    p_session,pg_temp.fx('brand'),pg_temp.fx('venue'),pg_temp.fx('spot'),'Table 12 snapshot',
    pg_temp.fx('table'),'indoor',p_reservation,p_source,
    CASE WHEN p_source='staff' THEN pg_temp.fx('user') ELSE NULL END,
    'Ada','ada@example.test','+12015550199',p_money_path,p_currency,
    p_subtotal,0,0,p_tip,v_take,v_svc,v_fee,v_platform,
    p_money_path='mingla',p_money_path='mingla',false,v_buyer,0,v_buyer+p_tip,
    CASE WHEN p_money_path='mingla' THEN 'stripe' ELSE NULL END,
    'paid',p_created,'issue1795:'||gen_random_uuid(),
    CASE WHEN p_settlement THEN jsonb_build_object('tab_settlement',true,'settles_session_id',p_session) ELSE '{}'::jsonb END,
    p_created
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

DO $fixtures$
DECLARE
  v_session uuid;
  v_session_two uuid;
  v_partial_session uuid;
  v_conflict_gbp uuid;
  v_conflict_usd uuid;
  v_child_one uuid;
  v_child_two uuid;
  v_partial uuid;
  v_settlement uuid;
BEGIN
  v_session := pg_temp.mint_session('GBP',pg_temp.fx('reservation'),6);
  v_session_two := pg_temp.mint_session('GBP',pg_temp.fx('reservation'),99);
  v_child_one := pg_temp.mint_order(v_session,'GBP','guest_qr',1200,100,now()-interval '2 days',pg_temp.fx('reservation'));
  v_child_two := pg_temp.mint_order(v_session_two,'GBP','staff',800,0,now()-interval '1 day',pg_temp.fx('reservation'),false,'venue_collected');
  v_settlement := pg_temp.mint_order(v_session,'GBP','guest_page',2000,100,now()-interval '1 hour',pg_temp.fx('reservation'),true);
  INSERT INTO public.venue_order_items(
    venue_order_id,menu_item_id,line_no,item_name_at_order,unit_price_cents,currency,quantity,modifiers_total_cents,line_total_cents
  ) VALUES
    (v_child_one,pg_temp.fx('item'),1,'Burger snapshot',600,'GBP',2,0,1200),
    (v_child_two,pg_temp.fx('item'),1,'Renamed snapshot',800,'GBP',1,0,800),
    -- A settlement instrument with plausible line metadata must still count zero.
    (v_settlement,pg_temp.fx('item'),1,'Settlement bait',2000,'GBP',1,0,2000);

  v_partial_session := pg_temp.mint_session('USD',NULL,5);
  v_partial := pg_temp.mint_order(v_partial_session,'USD','guest_page',1500,200,now()-interval '3 days');
  UPDATE public.venue_orders SET payment_status='partial_refund',refunded_amount_cents=500 WHERE id=v_partial;
  INSERT INTO public.venue_order_items(
    venue_order_id,menu_item_id,line_no,item_name_at_order,unit_price_cents,currency,quantity,modifiers_total_cents,line_total_cents
  ) VALUES(v_partial,pg_temp.fx('item'),1,'USD snapshot',1500,'USD',1,0,1500);

  -- One reservation spanning two currencies is excluded from Tier A covers.
  v_conflict_gbp := pg_temp.mint_session('GBP',pg_temp.fx('conflict_reservation'));
  v_conflict_usd := pg_temp.mint_session('USD',pg_temp.fx('conflict_reservation'));
  PERFORM pg_temp.mint_order(v_conflict_gbp,'GBP','guest_qr',500,0,now()-interval '4 days',pg_temp.fx('conflict_reservation'));
  PERFORM pg_temp.mint_order(v_conflict_usd,'USD','guest_qr',700,0,now()-interval '4 days',pg_temp.fx('conflict_reservation'));

  -- Sibling venue noise must not enter any output.
  INSERT INTO public.venue_order_sessions(id,brand_id,venue_id,currency)
  VALUES('00000000-1795-4000-8000-000000000099',pg_temp.fx('brand'),pg_temp.fx('other'),'GBP');
END $fixtures$;

DO $contract$
DECLARE
  v jsonb;
  v_outsider jsonb;
  v_def text;
BEGIN
  PERFORM set_config('request.jwt.claims',json_build_object('sub',pg_temp.fx('user'),'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',pg_temp.fx('user')::text,true);
  v := public.venue_order_metrics_rollup(pg_temp.fx('brand'),pg_temp.fx('venue'));

  IF v->>'schema_version' <> '1' OR (v->>'authorized')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'issue_1795 C-1 envelope failed: %',v;
  END IF;
  IF (v->>'orders_30d')::int <> 5 THEN
    RAISE EXCEPTION 'issue_1795 C-2 settlement exact-once/demand failed: %',v->>'orders_30d';
  END IF;
  IF (v->'sales_cents_30d'->>'GBP')::int <> 2500
     OR v->'sales_cents_30d' ? 'USD'
     OR (v->'tips_cents_30d'->>'GBP')::int <> 100 THEN
    RAISE EXCEPTION 'issue_1795 C-3 complete money/partial withholding failed: %',v;
  END IF;
  IF v->'money_state_by_currency'->>'USD' <> 'partial_refund_unallocated'
     OR (v->'unallocated_refunds_by_currency'->'USD'->>'orders')::int <> 1
     OR (v->'unallocated_refunds_by_currency'->'USD'->>'cents')::int <> 500 THEN
    RAISE EXCEPTION 'issue_1795 C-4 raw partial refund truth failed: %',v;
  END IF;
  IF jsonb_array_length(v->'daily_30d') <> 30
     OR jsonb_array_length(v->'placed_at_by_iso_weekday') <> 7
     OR jsonb_array_length(v->'placed_at_by_daypart') <> 4 THEN
    RAISE EXCEPTION 'issue_1795 C-5 zero-filled time series failed';
  END IF;
  IF (v->'spend_per_cover_tier_a'->'GBP'->>'covers')::int <> 4
     OR (v->>'tier_a_currency_conflict_reservations')::int <> 1
     OR v::text LIKE '%party_size_claimed%' THEN
    RAISE EXCEPTION 'issue_1795 C-6 distinct-reservation covers failed: %',v;
  END IF;
  IF (v->'data_completeness'->>'active_tables_missing_zone')::int <> 1
     OR (v->'data_completeness'->>'sold_items_missing_cost')::int <> 1 THEN
    RAISE EXCEPTION 'issue_1795 C-7 completeness counts failed: %',v->'data_completeness';
  END IF;
  IF v::text ~ '(buyer_email|buyer_phone|pickup_code|order_id|session_id|reservation_id|stripe_|paystack_|taken_by_user_id|notes)' THEN
    RAISE EXCEPTION 'issue_1795 C-8 forbidden privacy key leaked: %',v;
  END IF;
  IF v->'items_by_velocity'->0->>'item_name_snapshot' <> 'Renamed snapshot'
     OR v->'items_by_velocity'->0->>'item_name_snapshot' = 'Old name'
     OR v ? 'menu_engineering' OR v ? 'thresholds' OR v ? 'pricing_seed' THEN
    RAISE EXCEPTION 'issue_1795 C-9 immutable item/no-expansion failed: %',v->'items_by_velocity';
  END IF;

  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  v_outsider := public.venue_order_metrics_rollup(pg_temp.fx('brand'),pg_temp.fx('venue'));
  IF (v_outsider->>'authorized')::boolean IS DISTINCT FROM false
     OR (v_outsider->>'orders_30d')::int <> 0
     OR v_outsider->>'resolved_timezone' IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1795 C-10 outsider shape failed: %',v_outsider;
  END IF;

  SELECT pg_get_functiondef('public.venue_order_metrics_rollup(uuid,uuid)'::regprocedure) INTO v_def;
  IF position('coalesce(o.metadata->>''tab_settlement'','''') <> ''true''' in v_def)=0 THEN
    RAISE EXCEPTION 'issue_1795 C-11 settlement exclusion absent';
  END IF;
END $contract$;

DO $catalog$
BEGIN
  IF public.venue_order_metrics_rollup(NULL,gen_random_uuid()) IS NOT NULL
     OR public.venue_order_metrics_rollup(gen_random_uuid(),NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1795 C-12 null args must return null';
  END IF;
  IF has_function_privilege('anon','public.venue_order_metrics_rollup(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.venue_order_metrics_rollup(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.venue_order_metrics_rollup(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'issue_1795 C-13 ACL failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid='public.venue_order_metrics_rollup(uuid,uuid)'::regprocedure
      AND provolatile='s' AND prosecdef AND proconfig @> ARRAY['search_path=public']
  ) THEN
    RAISE EXCEPTION 'issue_1795 C-14 volatility/security/search path failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='venue_orders_metrics_idx'
  ) THEN
    RAISE EXCEPTION 'issue_1795 C-15 metrics index missing';
  END IF;
END $catalog$;

ROLLBACK;
