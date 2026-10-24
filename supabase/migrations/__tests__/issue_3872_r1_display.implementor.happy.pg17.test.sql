-- #3872 R1 public display pricing happy path.
-- MINGLA-INVARIANT: I-3872-PUBLIC-SALE-SERVER-OWNED | issue #3872 | Public ticket, experience and menu sale prices are produced by the database discount engine and preserve the legacy four-column tier reader.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '38720900-0000-4000-8400-000000000001';
  v_brand uuid := '38720900-0000-4000-8400-000000000002';
  v_event uuid := '38720900-0000-4000-8400-000000000003';
  v_ticket uuid := '38720900-0000-4000-8400-000000000004';
  v_experience uuid := '38720900-0000-4000-8400-000000000005';
  v_block_ticket uuid := '38720900-0000-4000-8400-000000000006';
  v_venue uuid := '38720900-0000-4000-8400-000000000007';
  v_menu uuid := '38720900-0000-4000-8400-000000000008';
  v_menu_item uuid := '38720900-0000-4000-8400-000000000009';
  v_ticket_sale uuid := '38720900-0000-4000-8400-000000000010';
  v_block_sale uuid := '38720900-0000-4000-8400-000000000011';
  v_menu_sale uuid := '38720900-0000-4000-8400-000000000012';
  v_cart_only uuid := '38720900-0000-4000-8400-000000000013';
  v_identity_only uuid := '38720900-0000-4000-8400-000000000014';
  v_event_json jsonb;
  v_bundle jsonb;
  v_experience_json jsonb;
  v_quote jsonb;
  v_legacy jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'r1-display-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'r1-display-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency,default_pass_mingla_fee,default_pass_service_fee
  ) VALUES(
    v_brand,v_owner,'R1 display brand','r1-display-brand','USD','stripe','US',
    'US','USD',false,false
  );
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_r1_display',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
    VALUES(v_brand,'discounts','pilot');

  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
    pass_mingla_fee,pass_service_fee
  ) VALUES
    (v_event,v_brand,v_owner,'R1 display event','r1-display-event','event',
      'scheduled','public','UTC','USD',false,false),
    (v_experience,v_brand,v_owner,'R1 display experience','r1-display-experience','experience',
      'scheduled','public','UTC','USD',false,false);
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master) VALUES
    (v_event,now()+interval '1 day',now()+interval '1 day 2 hours','UTC',true),
    (v_experience,now()+interval '2 days',now()+interval '2 days 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order
  ) VALUES(
    v_ticket,v_event,'General',2000,'USD',false,100,false,1,10,true,false,0
  );
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,
    price_basis,block_minutes,min_blocks,max_blocks
  ) VALUES(
    v_block_ticket,v_experience,'One hour',1000,'USD',false,100,false,1,4,true,false,0,
    'block',60,1,4
  );

  INSERT INTO public.venue_listings(id,brand_id,slug,name,lat,lng,venue_category)
    VALUES(v_venue,v_brand,'r1displayvenue','R1 Display Venue',40.7,-74.0,'restaurant');
  INSERT INTO public.menus(id,brand_id,venue_id,name,is_active)
    VALUES(v_menu,v_brand,v_venue,'R1 Display Menu',true);
  INSERT INTO public.menu_items(id,menu_id,brand_id,name,price_cents,currency,is_available)
    VALUES(v_menu_item,v_menu,v_brand,'R1 Lunch',900,'USD',true);

  INSERT INTO public.brand_discounts(
    id,brand_id,kind,name,value_type,value_bps,value_minor,currency,scope_kind,combines_with,
    min_subtotal_minor,max_uses_per_buyer,status,created_by
  ) VALUES
    (v_ticket_sale,v_brand,'sale_price','Event sale','set_price',NULL,1500,'USD','items','any',NULL,NULL,'active',v_owner),
    (v_block_sale,v_brand,'sale_price','Block sale','set_price',NULL,800,'USD','items','any',NULL,NULL,'active',v_owner),
    (v_menu_sale,v_brand,'sale_price','Lunch sale','set_price',NULL,600,'USD','items','any',NULL,NULL,'active',v_owner),
    (v_cart_only,v_brand,'automatic','Cart only','percent',5000,NULL,NULL,'brand','any',5000,NULL,'active',v_owner),
    (v_identity_only,v_brand,'automatic','Identity only','percent',5000,NULL,NULL,'brand','any',NULL,1,'active',v_owner);
  INSERT INTO public.brand_discount_targets(discount_id,target_kind,target_id) VALUES
    (v_ticket_sale,'ticket_type',v_ticket),
    (v_block_sale,'ticket_type',v_block_ticket),
    (v_menu_sale,'menu_item',v_menu_item);

  IF NOT EXISTS(
       SELECT 1 FROM public.pg_public_event_tier_pricing(v_event) p
       WHERE p.ticket_type_id=v_ticket AND p.base_cents=2000 AND p.all_in_cents=2000
         AND p.sale_base_cents=1500 AND p.sale_all_in_cents=1500
         AND p.sale_name='Event sale'
     ) THEN
    RAISE EXCEPTION 'T9 sale-aware tier pricing did not return server-owned list and sale prices';
  END IF;

  SELECT to_jsonb(p) INTO v_legacy FROM public.pg_public_event_tier_allin(v_event) p;
  IF (SELECT count(*) FROM jsonb_object_keys(v_legacy))<>4
     OR (v_legacy->>'ticket_type_id')::uuid<>v_ticket
     OR (v_legacy->>'base_cents')::integer<>2000
     OR v_legacy ? 'sale_base_cents' THEN
    RAISE EXCEPTION 'T9 legacy tier reader did not preserve its exact four-column shape: %',v_legacy;
  END IF;

  v_event_json:=public.pg_public_event_by_slug('r1-display-brand','r1-display-event')::jsonb;
  v_bundle:=public.pg_direct_event_checkout_bundle(v_event,NULL,NULL)::jsonb;
  IF (v_event_json#>>'{tickets,0,saleBaseCents}')::integer<>1500
     OR (v_event_json#>>'{tickets,0,saleAllInCents}')::integer<>1500
     OR v_event_json#>>'{tickets,0,saleName}'<>'Event sale'
     OR NOT ((v_event_json#>'{tickets,0}') ?& ARRAY['saleEndsAt','saleRemaining'])
     OR (v_bundle#>>'{tickets,0,saleBaseCents}')::integer<>1500
     OR NOT ((v_bundle#>'{tickets,0}') ?& ARRAY['saleAllInCents','saleEndsAt','saleName','saleRemaining']) THEN
    RAISE EXCEPTION 'T9 event JSON readers did not expose the five sale keys: event %, bundle %',v_event_json,v_bundle;
  END IF;

  v_experience_json:=public.pg_public_experience_by_slug('r1-display-brand','r1-display-experience')::jsonb;
  IF (v_experience_json#>>'{ticket,saleBaseCents}')::integer<>800
     OR (v_experience_json#>>'{options,0,saleBaseCents}')::integer<>800
     OR NOT ((v_experience_json->'ticket') ?& ARRAY['saleAllInCents','saleEndsAt','saleName','saleRemaining']) THEN
    RAISE EXCEPTION 'T9 experience headline and options did not expose sale keys: %',v_experience_json;
  END IF;
  v_quote:=public.pg_experience_booking_quote(v_experience,v_block_ticket,1,3);
  IF (v_quote->>'unitPriceCents')::integer<>3000
     OR (v_quote->>'saleUnitPriceCents')::integer<>2400
     OR (v_quote->>'saleUnitAllInCents')::integer<>2400
     OR NOT (v_quote ? 'saleEndsAt') THEN
    RAISE EXCEPTION 'T9 block-basis sale was not multiplied by requested blocks: %',v_quote;
  END IF;

  IF NOT EXISTS(
       SELECT 1 FROM public.pg_public_event_display_prices(ARRAY[v_event]) d
       WHERE d.event_id=v_event AND d.display_price_cents=2000
         AND d.display_sale_price_cents=1500
     ) THEN
    RAISE EXCEPTION 'T9 event display batch did not expose the sale from price';
  END IF;
  IF NOT EXISTS(
       SELECT 1 FROM public.pg_public_menu_item_sales(v_venue) s
       WHERE s.menu_item_id=v_menu_item AND s.sale_price_cents=600
         AND s.sale_name='Lunch sale'
     ) THEN
    RAISE EXCEPTION 'T9 menu sale overlay did not expose the server-owned sale';
  END IF;

  BEGIN
    PERFORM * FROM public.pg_public_event_display_prices(
      ARRAY(SELECT gen_random_uuid() FROM generate_series(1,101))
    );
    RAISE EXCEPTION 'T9 batch reader accepted more than 100 ids';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%too_many_ids%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'issue_3872_r1_display: PASS';
END
$test$;

ROLLBACK;
