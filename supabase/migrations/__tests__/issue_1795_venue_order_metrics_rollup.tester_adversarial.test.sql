-- Issue #1795 tester-owned adversarial proof.
--
-- Different angle from the implementor suite: a room-origin settlement row is
-- deliberately made to look like a real round across every grouping dimension,
-- while a large unrelated reservation occupies the same venue and time window.
-- Neither the copied settlement instrument nor proximity/claimed party size may
-- enter order, money, item, room, zone, channel, time, attach, or cover truth.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t1795_tester_fx (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE
  v_user uuid := '00000000-1795-5000-8000-000000000001';
  v_brand uuid := '00000000-1795-5000-8000-000000000002';
  v_serving_venue uuid := '00000000-1795-5000-8000-000000000003';
  v_stay_venue uuid := '00000000-1795-5000-8000-000000000004';
  v_place uuid := '00000000-1795-5000-8000-000000000005';
  v_offering uuid := '00000000-1795-5000-8000-000000000006';
  v_unit uuid := '00000000-1795-5000-8000-000000000007';
  v_spot uuid;
  v_menu uuid := '00000000-1795-5000-8000-000000000009';
  v_item uuid := '00000000-1795-5000-8000-000000000010';
  v_linked_reservation uuid := '00000000-1795-5000-8000-000000000011';
  v_nearby_reservation uuid := '00000000-1795-5000-8000-000000000012';
BEGIN
  INSERT INTO auth.users (id,instance_id,aud,role,email,created_at,updated_at)
  VALUES (v_user,'00000000-0000-0000-0000-000000000000','authenticated',
          'authenticated','tester-1795@example.test',now(),now());
  INSERT INTO public.creator_accounts(id,created_at) VALUES(v_user,now());
  INSERT INTO public.place_pool(id,name,lat,lng,utc_offset_minutes,created_at)
  VALUES(v_place,'Issue 1795 tester place',51.5,-0.1,0,now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
  VALUES(v_brand,v_user,'Issue 1795 Tester Brand','issue1795tester','GBP',now(),now());
  INSERT INTO public.venue_listings(
    id,brand_id,place_pool_id,slug,name,lat,lng,venue_category,claim_status
  ) VALUES
    (v_serving_venue,v_brand,v_place,'issue1795testerserving','Tester Serving Venue',
     51.5,-0.1,'restaurant','verified'),
    (v_stay_venue,v_brand,NULL,'issue1795testerstay','Tester Stay Venue',
     51.5,-0.1,'stay','verified');
  UPDATE public.brand_team_members
     SET accepted_at=coalesce(accepted_at,now()),role='brand_owner'
   WHERE brand_id=v_brand AND user_id=v_user AND removed_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.brand_team_members(brand_id,user_id,role,invited_at,accepted_at)
    VALUES(v_brand,v_user,'brand_owner',now(),now());
  END IF;
  INSERT INTO public.venue_availability_config(
    brand_id,venue_id,place_pool_id,iana_timezone
  ) VALUES(v_brand,v_serving_venue,v_place,'UTC');
  INSERT INTO public.venue_reservation_settings(
    brand_id,venue_id,reservations_enabled
  ) VALUES(v_brand,v_serving_venue,true);

  INSERT INTO public.stay_offerings(
    id,venue_id,brand_id,kind,name,status,inventory_basis,unit_naming_mode,
    quantity,min_guests,max_guests,max_adults,max_children
  ) VALUES(
    v_offering,v_stay_venue,v_brand,'room','Tester rooms','live',
    'exclusive_units','named',1,1,4,4,0
  );
  INSERT INTO public.stay_units(id,offering_id,brand_id,venue_id,name,status)
  VALUES(v_unit,v_offering,v_brand,v_stay_venue,'Current Room Name','active');
  SELECT id INTO v_spot FROM public.qr_spots WHERE stay_unit_id=v_unit;
  UPDATE public.qr_spots
     SET label='Room 204',serving_venue_id=v_serving_venue,is_active=true
   WHERE id=v_spot;
  INSERT INTO public.menus(id,brand_id,venue_id,name,is_active)
  VALUES(v_menu,v_brand,v_serving_venue,'Room service',true);
  INSERT INTO public.menu_items(
    id,menu_id,brand_id,name,price_cents,currency,is_available,cost_cents
  ) VALUES(v_item,v_menu,v_brand,'Current item name',1000,'GBP',true,400);

  INSERT INTO public.reservations(
    id,brand_id,venue_id,reserved_for,party_size,status,source
  ) VALUES
    (v_linked_reservation,v_brand,v_serving_venue,now(),4,'seated','mingla'),
    -- Same venue, same moment, huge party: proximity must never make this Tier A.
    (v_nearby_reservation,v_brand,v_serving_venue,now(),50,'completed','phone');

  INSERT INTO t1795_tester_fx VALUES
    ('user',v_user),('brand',v_brand),('venue',v_serving_venue),
    ('stay_venue',v_stay_venue),('unit',v_unit),('spot',v_spot),
    ('menu',v_menu),('item',v_item),('linked_reservation',v_linked_reservation),
    ('nearby_reservation',v_nearby_reservation);
END $seed$;

CREATE OR REPLACE FUNCTION pg_temp.fx1795(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t1795_tester_fx WHERE k=p_k $$;

CREATE OR REPLACE FUNCTION pg_temp.session1795(
  p_reservation uuid DEFAULT NULL,
  p_claimed integer DEFAULT NULL,
  p_currency text DEFAULT 'GBP'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.venue_order_sessions(
    brand_id,venue_id,qr_spot_id,reservation_id,party_size_claimed,currency
  ) VALUES(
    pg_temp.fx1795('brand'),pg_temp.fx1795('venue'),pg_temp.fx1795('spot'),
    p_reservation,p_claimed,p_currency
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.order1795(
  p_session uuid,
  p_subtotal integer,
  p_source text,
  p_reservation uuid DEFAULT NULL,
  p_settlement boolean DEFAULT false,
  p_created timestamptz DEFAULT now(),
  p_money_path text DEFAULT 'venue_collected',
  p_currency text DEFAULT 'GBP'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.venue_orders(
    session_id,brand_id,venue_id,qr_spot_id,spot_label_at_order,stay_unit_id,
    zone_at_order,reservation_id,source,taken_by_user_id,money_path,currency,
    buyer_name,buyer_email,buyer_phone_e164,
    subtotal_cents,service_charge_bps,service_charge_cents,tip_cents,
    effective_take_rate_bps,service_fee_bps,mingla_fee_cents,
    platform_service_fee_cents,pass_mingla_fee,pass_service_fee,pass_tax,
    buyer_subtotal_cents,tax_amount_cents,total_cents,provider,payment_status,
    confirmed_at,idempotency_key,metadata,created_at
  ) VALUES(
    p_session,pg_temp.fx1795('brand'),pg_temp.fx1795('venue'),
    pg_temp.fx1795('spot'),
    CASE WHEN p_settlement THEN 'Settlement bait room' ELSE 'Room 204 at order' END,
    pg_temp.fx1795('unit'),
    CASE WHEN p_settlement THEN 'settlement_bait_zone' ELSE 'room_service' END,
    p_reservation,p_source,CASE WHEN p_source='staff' THEN pg_temp.fx1795('user') ELSE NULL END,
    p_money_path,p_currency,
    CASE WHEN p_money_path='mingla' THEN 'Tester' ELSE NULL END,
    CASE WHEN p_money_path='mingla' THEN 'tester@example.test' ELSE NULL END,
    CASE WHEN p_money_path='mingla' THEN '+12015550199' ELSE NULL END,
    p_subtotal,0,0,
    CASE WHEN p_settlement THEN 900 ELSE 0 END,
    0,0,0,0,false,false,false,p_subtotal,0,
    p_subtotal + CASE WHEN p_settlement THEN 900 ELSE 0 END,
    CASE WHEN p_money_path='mingla' THEN 'stripe' ELSE NULL END,
    'paid',p_created,'issue1795-tester:'||gen_random_uuid(),
    CASE WHEN p_settlement
      THEN jsonb_build_object(
        'tab_settlement',true,'settles_session_id',p_session,
        'source','guest_qr','zone','settlement_bait_zone','room','Settlement bait room'
      )
      ELSE '{}'::jsonb END,
    p_created
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

DO $fixtures$
DECLARE
  v_unlinked_session uuid;
  v_linked_session_one uuid;
  v_linked_session_two uuid;
  v_child uuid;
  v_linked_one uuid;
  v_linked_two uuid;
  v_settlement uuid;
  v_partial_session uuid;
  v_partial_child uuid;
  v_partial_settlement uuid;
BEGIN
  -- Claimed 77 and a nearby party of 50 are both tempting but forbidden cover inputs.
  v_unlinked_session := pg_temp.session1795(NULL,77);
  v_linked_session_one := pg_temp.session1795(pg_temp.fx1795('linked_reservation'),99);
  v_linked_session_two := pg_temp.session1795(pg_temp.fx1795('linked_reservation'),88);

  v_child := pg_temp.order1795(v_unlinked_session,1000,'guest_qr',NULL,false,now()-interval '2 hours');
  v_settlement := pg_temp.order1795(v_unlinked_session,9900,'staff',NULL,true,now()-interval '1 hour');
  v_linked_one := pg_temp.order1795(
    v_linked_session_one,600,'staff',pg_temp.fx1795('linked_reservation'),false,
    now()-interval '3 hours'
  );
  v_linked_two := pg_temp.order1795(
    v_linked_session_two,400,'guest_page',pg_temp.fx1795('linked_reservation'),false,
    now()-interval '4 hours'
  );
  v_partial_session := pg_temp.session1795(NULL,66,'USD');
  v_partial_child := pg_temp.order1795(
    v_partial_session,700,'guest_qr',NULL,false,now()-interval '5 hours',
    'venue_collected','USD'
  );
  v_partial_settlement := pg_temp.order1795(
    v_partial_session,700,'staff',NULL,true,now()-interval '30 minutes','mingla','USD'
  );
  UPDATE public.venue_orders
     SET payment_status='partial_refund',refunded_amount_cents=300
   WHERE id=v_partial_settlement;

  INSERT INTO public.venue_order_items(
    venue_order_id,menu_item_id,line_no,item_name_at_order,unit_price_cents,
    currency,quantity,modifiers_total_cents,line_total_cents
  ) VALUES
    (v_child,pg_temp.fx1795('item'),1,'Immutable Soup',1000,'GBP',1,0,1000),
    (v_linked_one,pg_temp.fx1795('item'),1,'Immutable Soup',600,'GBP',1,0,600),
    (v_linked_two,pg_temp.fx1795('item'),1,'Immutable Soup',400,'GBP',1,0,400),
    (v_partial_child,pg_temp.fx1795('item'),1,'Immutable Soup',700,'USD',1,0,700),
    -- Plausible item provenance on the bill copy: must still count nowhere.
    (v_settlement,pg_temp.fx1795('item'),1,'Settlement Bait Item',9900,'GBP',1,0,9900),
    (v_partial_settlement,pg_temp.fx1795('item'),1,'Partial Settlement Bait',700,'USD',1,0,700);
END $fixtures$;

DO $assertions$
DECLARE
  v jsonb;
  v_total_dayparts integer;
  v_total_weekdays integer;
  v_total_daily integer;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub',pg_temp.fx1795('user'),'role','authenticated')::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub',pg_temp.fx1795('user')::text,true);
  v := public.venue_order_metrics_rollup(pg_temp.fx1795('brand'),pg_temp.fx1795('venue'));

  IF (v->>'authorized')::boolean IS DISTINCT FROM true
     OR (v->>'orders_30d')::int <> 4
     OR (v->'sales_cents_30d'->>'GBP')::int <> 2000
     OR (v->'tips_cents_30d'->>'GBP')::int <> 0
     OR v->'sales_cents_30d' ? 'USD'
     OR v->'tips_cents_30d' ? 'USD'
     OR v->'spend_per_order' ? 'USD'
     OR v->'spend_per_cover_tier_a' ? 'USD'
     OR v->'money_state_by_currency'->>'USD' <> 'partial_refund_unallocated'
     OR (v->'unallocated_refunds_by_currency'->'USD'->>'orders')::int <> 1
     OR (v->'unallocated_refunds_by_currency'->'USD'->>'cents')::int <> 300 THEN
    RAISE EXCEPTION 'issue_1795 tester A-1 settlement leaked into top-level demand/money: %',v;
  END IF;

  IF (v->'channel_split'->>'qr')::int <> 2
     OR (v->'channel_split'->>'page')::int <> 1
     OR (v->'channel_split'->>'staff')::int <> 1
     OR (v->'channel_split'->>'counter_pickup')::int <> 0 THEN
    RAISE EXCEPTION 'issue_1795 tester A-2 settlement leaked into channel split: %',v->'channel_split';
  END IF;

  SELECT coalesce(sum((row->>'orders')::int),0) INTO v_total_dayparts
    FROM jsonb_array_elements(v->'placed_at_by_daypart') row;
  SELECT coalesce(sum((row->>'orders')::int),0) INTO v_total_weekdays
    FROM jsonb_array_elements(v->'placed_at_by_iso_weekday') row;
  SELECT coalesce(sum((row->>'orders')::int),0) INTO v_total_daily
    FROM jsonb_array_elements(v->'daily_30d') row;
  IF v_total_dayparts <> 4 OR v_total_weekdays <> 4 OR v_total_daily <> 4 THEN
    RAISE EXCEPTION 'issue_1795 tester A-3 settlement leaked into time series: dayparts %, weekdays %, daily %',
      v_total_dayparts,v_total_weekdays,v_total_daily;
  END IF;

  IF jsonb_array_length(v->'items_by_velocity') <> 1
     OR (v->'items_by_velocity'->0->>'quantity')::int <> 4
     OR (v->'items_by_velocity'->0->'sales_cents'->>'GBP')::int <> 2000
     OR v->'items_by_velocity'->0->'sales_cents' ? 'USD'
     OR v::text LIKE '%Settlement Bait Item%'
     OR v::text LIKE '%Partial Settlement Bait%' THEN
    RAISE EXCEPTION 'issue_1795 tester A-4 settlement leaked into item velocity: %',v->'items_by_velocity';
  END IF;

  IF jsonb_array_length(v->'revenue_by_zone') <> 1
     OR v->'revenue_by_zone'->0->>'zone' <> 'room_service'
     OR (v->'revenue_by_zone'->0->>'orders')::int <> 4
     OR (v->'revenue_by_zone'->0->'sales_cents'->>'GBP')::int <> 2000
     OR v->'revenue_by_zone'->0->'sales_cents' ? 'USD'
     OR v::text LIKE '%settlement_bait_zone%' THEN
    RAISE EXCEPTION 'issue_1795 tester A-5 settlement leaked into zones: %',v->'revenue_by_zone';
  END IF;

  IF jsonb_array_length(v->'revenue_by_room') <> 1
     OR v->'revenue_by_room'->0->>'spot_label_snapshot' <> 'Room 204 at order'
     OR (v->'revenue_by_room'->0->>'orders')::int <> 4
     OR (v->'revenue_by_room'->0->'sales_cents'->>'GBP')::int <> 2000
     OR v->'revenue_by_room'->0->'sales_cents' ? 'USD'
     OR v::text LIKE '%Settlement bait room%'
     OR v::text LIKE '%Current Room Name%' THEN
    RAISE EXCEPTION 'issue_1795 tester A-6 settlement/current-name leaked into rooms: %',v->'revenue_by_room';
  END IF;

  IF (v->'spend_per_cover_tier_a'->'GBP'->>'reservations')::int <> 1
     OR (v->'spend_per_cover_tier_a'->'GBP'->>'sessions')::int <> 2
     OR (v->'spend_per_cover_tier_a'->'GBP'->>'covers')::int <> 4
     OR (v->'spend_per_cover_tier_a'->'GBP'->>'sales_cents')::int <> 1000
     OR (v->'spend_per_cover_tier_a'->'GBP'->>'average_cents')::int <> 250
     OR v::text LIKE '%Measured on 50 covers%'
     OR v::text LIKE '%Measured on 77 covers%'
     OR v::text LIKE '%Measured on 88 covers%'
     OR v::text LIKE '%Measured on 99 covers%' THEN
    RAISE EXCEPTION 'issue_1795 tester A-7 inferred/session-grain covers leaked: %',v->'spend_per_cover_tier_a';
  END IF;

  IF (v->'attach_counts'->>'ordered_reservations')::int <> 1
     OR (v->'attach_counts'->>'seated_reservations')::int <> 2 THEN
    RAISE EXCEPTION 'issue_1795 tester A-8 proximity/settlement polluted attach: %',v->'attach_counts';
  END IF;

  IF v::text ~ '(buyer_email|buyer_phone|buyer_user_id|taken_by_user_id|pickup_code|order_id|session_id|reservation_id|provider_reference|stripe_|paystack_)' THEN
    RAISE EXCEPTION 'issue_1795 tester A-9 private identity/reference key leaked: %',v;
  END IF;
END $assertions$;

ROLLBACK;
