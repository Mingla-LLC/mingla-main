-- #3872 R1 hidden-tier display-price containment.
-- MINGLA-INVARIANT: I-3872-HIDDEN-TIER-PRIVATE | issue #3872 | A hidden or disabled tier never sets a public from price or sale; only a valid private-link holder can read a hidden tier sale.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '38721000-0000-4000-8400-000000000001';
  v_brand uuid := '38721000-0000-4000-8400-000000000002';
  v_event uuid := '38721000-0000-4000-8400-000000000003';
  v_visible uuid := '38721000-0000-4000-8400-000000000004';
  v_hidden uuid := '38721000-0000-4000-8400-000000000005';
  v_disabled uuid := '38721000-0000-4000-8400-000000000006';
  v_hidden_sale uuid := '38721000-0000-4000-8400-000000000007';
  v_link uuid := '38721000-0000-4000-8400-000000000008';
  v_rsvp uuid := '38721000-0000-4000-8400-000000000009';
  v_rsvp_visible uuid := '38721000-0000-4000-8400-000000000010';
  v_rsvp_hidden uuid := '38721000-0000-4000-8400-000000000011';
  v_rsvp_disabled uuid := '38721000-0000-4000-8400-000000000012';
  v_link_json jsonb;
  v_rsvp_json jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'r1-hidden-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'r1-hidden-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency,default_pass_mingla_fee,default_pass_service_fee
  ) VALUES(
    v_brand,v_owner,'R1 hidden brand','r1-hidden-brand','USD','stripe','US',
    'US','USD',false,false
  );
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_r1_hidden',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
    VALUES(v_brand,'discounts','pilot');

  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
    pass_mingla_fee,pass_service_fee
  ) VALUES
    (v_event,v_brand,v_owner,'R1 hidden event','r1-hidden-event','event',
      'scheduled','public','UTC','USD',false,false),
    (v_rsvp,v_brand,v_owner,'R1 hidden RSVP','r1-hidden-rsvp','rsvp',
      'scheduled','public','UTC','USD',false,false);
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master) VALUES
    (v_event,now()+interval '1 day',now()+interval '1 day 2 hours','UTC',true),
    (v_rsvp,now()+interval '2 days',now()+interval '2 days 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,
    is_hidden,is_disabled
  ) VALUES
    (v_visible,v_event,'Visible',2000,'USD',false,100,false,1,10,true,false,0,false,false),
    (v_hidden,v_event,'Hidden sale',500,'USD',false,100,false,1,10,true,false,1,true,false),
    (v_disabled,v_event,'Disabled',300,'USD',false,100,false,1,10,true,false,2,false,true),
    (v_rsvp_visible,v_rsvp,'Visible RSVP',3000,'USD',false,100,false,1,10,true,false,0,false,false),
    (v_rsvp_hidden,v_rsvp,'Hidden RSVP',100,'USD',false,100,false,1,10,true,false,1,true,false),
    (v_rsvp_disabled,v_rsvp,'Disabled RSVP',200,'USD',false,100,false,1,10,true,false,2,false,true);

  INSERT INTO public.brand_discounts(
    id,brand_id,kind,name,value_type,value_minor,currency,scope_kind,combines_with,
    status,created_by
  ) VALUES(
    v_hidden_sale,v_brand,'sale_price','Private-link sale','set_price',100,'USD',
    'items','any','active',v_owner
  );
  INSERT INTO public.brand_discount_targets(discount_id,target_kind,target_id)
    VALUES(v_hidden_sale,'ticket_type',v_hidden);
  PERFORM public.biz_ticket_link_create(
    v_owner,v_event,v_hidden,NULL,'R1 private buyers',5,1,'auto',NULL,
    v_link,decode('38721000000040008400000000000008','hex'),repeat('b',64)
  );

  IF (SELECT display_price_cents FROM public.business_public_events_view WHERE id=v_event)<>2000 THEN
    RAISE EXCEPTION 'T10 hidden or disabled tier set business_public_events_view from price';
  END IF;
  IF NOT EXISTS(
       SELECT 1 FROM public.pg_public_event_display_prices(ARRAY[v_event]) d
       WHERE d.event_id=v_event AND d.display_price_cents=2000
         AND d.display_sale_price_cents IS NULL AND d.display_sale_ends_at IS NULL
     ) THEN
    RAISE EXCEPTION 'T10 hidden sale leaked into event display batch';
  END IF;
  IF EXISTS(
       SELECT 1 FROM public.pg_public_event_tier_pricing(v_event) p
       WHERE p.ticket_type_id=v_hidden
     ) THEN
    RAISE EXCEPTION 'T10 hidden tier leaked through public tier pricing';
  END IF;

  v_rsvp_json:=public.pg_public_rsvp_by_slug('r1-hidden-brand','r1-hidden-rsvp')::jsonb;
  IF (v_rsvp_json#>>'{publicEventRow,display_price_cents}')::integer<>3000 THEN
    RAISE EXCEPTION 'T10 hidden or disabled RSVP tier set public from price: %',v_rsvp_json;
  END IF;

  v_link_json:=public.pg_ticket_link_resolve(repeat('b',64));
  IF v_link_json->>'state'<>'active'
     OR (v_link_json#>>'{tier,id}')::uuid<>v_hidden
     OR (v_link_json#>>'{tier,saleBaseCents}')::integer<>100
     OR (v_link_json#>>'{tier,saleAllInCents}')::integer<>100
     OR v_link_json#>>'{tier,saleName}'<>'Private-link sale' THEN
    RAISE EXCEPTION 'T10 valid private link did not expose its hidden tier sale: %',v_link_json;
  END IF;

  RAISE NOTICE 'issue_3872_r1_hidden_tier_display: PASS';
END
$test$;

ROLLBACK;
