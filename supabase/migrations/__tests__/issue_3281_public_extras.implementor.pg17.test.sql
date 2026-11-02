-- #3281 Extras, slice 4 (server): buyers read each ticket's extras from the event's reader.
-- MINGLA-INVARIANT: I-3281-EXTRAS-RIDE-THE-EVENT-READER | issue #3281 | A buyer reads a ticket's extras, their all-in price and their remaining places from the same reader that serves the event; a payload with no extra on sale is byte-identical.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '3281a000-0000-4000-8400-000000000001';
  v_brand uuid := '3281a000-0000-4000-8400-000000000002';
  v_event uuid := '3281a000-0000-4000-8400-000000000003';
  v_tier uuid := '3281a000-0000-4000-8400-000000000004';
  v_fri uuid := '3281a000-0000-4000-8400-000000000011';
  v_sat uuid := '3281a000-0000-4000-8400-000000000012';
  v_dinner uuid := '3281a000-0000-4000-8400-000000000021';
  v_tote uuid := '3281a000-0000-4000-8400-000000000022';
  v_before text;
  v_slug_before text;
  v_after jsonb;
  v_extras jsonb;
  v_dinner_json jsonb;
  v_expected integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'public-extras@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'public-extras@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Public extras','public-extras','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_public_extras',true,true,'US','usd');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
    is_multi_date,multi_date_pricing_mode
  ) VALUES(v_event,v_brand,v_owner,'Public extras','public-extras-event',
    'event','scheduled','public','UTC','USD',true,'per_day');
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
    (v_fri,v_event,date_trunc('minute',now())+interval '1 day',now()+interval '1 day 2 hours','UTC',true,'fri'),
    (v_sat,v_event,date_trunc('minute',now())+interval '2 days',now()+interval '2 days 2 hours','UTC',false,'sat');
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person
  ) VALUES (v_tier,v_event,'All dates',1000,'USD',false,100,false,1,10,true,false),
    ('3281a000-0000-4000-8400-000000000005',v_event,'Plain',2000,'USD',false,50,false,1,10,true,false);
  -- Fees passed on, so an all-in price differs from its base.
  UPDATE public.events SET pass_mingla_fee=true, pass_service_fee=true WHERE id=v_event;

  -- No extras: both readers return exactly what they returned before.
  v_before := public.pg_direct_event_checkout_bundle(v_event,NULL,NULL)::text;
  v_slug_before := public.pg_public_event_by_slug('public-extras','public-extras-event')::text;
  IF v_before IS NULL OR v_slug_before IS NULL OR position('"extras"' IN v_before) > 0 THEN
    RAISE EXCEPTION 'the readers must serve the event without extras, got %', left(v_before,200);
  END IF;

  INSERT INTO public.ticket_add_ons(
    id,ticket_type_id,name,price_cents,quantity_total,is_unlimited,max_per_ticket,valid_occurrence_keys,sort_order
  ) VALUES
    (v_dinner,v_tier,'Friday dinner',1500,3,false,2,ARRAY['fri'],0),
    (v_tote,v_tier,'Tote bag',0,NULL,true,1,NULL,1);
  -- An inactive extra never shows.
  INSERT INTO public.ticket_add_ons(ticket_type_id,name,price_cents,quantity_total,is_unlimited,is_active)
    VALUES (v_tier,'Retired',500,NULL,true,false);

  v_after := public.pg_direct_event_checkout_bundle(v_event,NULL,NULL)::jsonb;
  SELECT t->'extras' INTO v_extras FROM jsonb_array_elements(v_after->'tickets') t WHERE t->>'id' = v_tier::text;
  IF COALESCE(jsonb_array_length(v_extras),0) <> 2 THEN
    RAISE EXCEPTION 'the ticket must carry its two active extras, got %', v_extras;
  END IF;
  v_dinner_json := v_extras->0;
  SELECT public.compute_all_in_cents(1500,
      COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),
      COALESCE(e.pass_service_fee,b.default_pass_service_fee),
      (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r))
    INTO v_expected FROM public.events e JOIN public.brands b ON b.id=e.brand_id WHERE e.id=v_event;
  IF v_dinner_json->>'name' <> 'Friday dinner'
     OR (v_dinner_json->>'priceCents')::integer <> 1500
     OR (v_dinner_json->>'priceAllInCents')::integer <> v_expected
     OR v_dinner_json->'validOccurrenceIds' <> jsonb_build_array(v_fri)
     OR v_dinner_json->'remaining' <> jsonb_build_object(v_fri::text, 3)
     OR (v_dinner_json->>'maxPerTicket')::integer <> 2
     OR v_expected <= 1500 THEN
    RAISE EXCEPTION 'the dinner must carry server prices, dates and places, got %', v_dinner_json;
  END IF;
  -- A ticket with no extra gains no key at all.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_after->'tickets') t
              WHERE t->>'name' = 'Plain' AND t ? 'extras') THEN
    RAISE EXCEPTION 'a ticket without extras must not gain the key';
  END IF;
  IF (v_extras->1->>'priceAllInCents')::integer <> 0
     OR v_extras->1->'remaining' <> 'null'::jsonb
     OR v_extras->1->'validOccurrenceIds' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'a free unlimited extra on every date reads as such, got %', v_extras->1;
  END IF;

  -- A held place shows on that date only.
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,buyer_phone_e164,
      status,expires_at,idempotency_key,currency,subtotal_cents,total_cents)
    VALUES ('3281a000-0000-4000-8400-000000000031',v_event,v_brand,'Held','held@example.test','+15555550999',
      'requires_payment',now()+interval '10 minutes','public-extras-hold','USD',0,0);
  INSERT INTO public.ticket_checkout_session_add_on_items(checkout_session_id,ticket_add_on_id,ticket_type_id,
      add_on_name_at_purchase,ticket_type_name_at_purchase,day_scope,quantity,unit_price_cents,total_cents)
    VALUES ('3281a000-0000-4000-8400-000000000031',v_dinner,v_tier,'Friday dinner','All dates',ARRAY['fri'],1,1500,1500);
  SELECT t->'extras'->0->'remaining' INTO v_extras
    FROM jsonb_array_elements(public.pg_direct_event_checkout_bundle(v_event,NULL,NULL)::jsonb->'tickets') t
   WHERE t->>'id' = v_tier::text;
  IF v_extras IS DISTINCT FROM jsonb_build_object(v_fri::text, 2) THEN
    RAISE EXCEPTION 'a held dinner must leave two on Friday, got %', v_extras;
  END IF;

  -- Anything that isn't an object comes back untouched; refundPolicy stays last.
  IF public.issue_3281_attach_public_extras(NULL) IS NOT NULL
     OR public.issue_3281_attach_public_extras('[1,2]'::json)::text <> '[1,2]'
     OR public.issue_3281_attach_public_extras('"x"'::json)::text <> '"x"' THEN
    RAISE EXCEPTION 'a non-object payload must pass through';
  END IF;
  -- Key order is the reader's own: the bundle's last key (refundPolicy) stays last.
  IF (SELECT string_agg(k, ',' ORDER BY n) FROM json_object_keys(
        public.pg_direct_event_checkout_bundle(v_event,NULL,NULL)) WITH ORDINALITY o(k,n))
     IS DISTINCT FROM (SELECT string_agg(k, ',' ORDER BY n) FROM json_object_keys(v_before::json) WITH ORDINALITY o(k,n))
     OR position('"refundPolicy"' IN v_before) = 0 THEN
    RAISE EXCEPTION 'extras must keep the reader''s key order, refundPolicy last';
  END IF;

  -- The slug reader carries the same extras.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      public.pg_public_event_by_slug('public-extras','public-extras-event')::jsonb->'tickets') t
     WHERE jsonb_array_length(t->'extras') = 2) THEN
    RAISE EXCEPTION 'the slug reader must carry the extras';
  END IF;

  -- With every extra stopped, the payloads are byte-identical again.
  UPDATE public.ticket_add_ons SET is_active=false WHERE ticket_type_id=v_tier;
  IF public.pg_direct_event_checkout_bundle(v_event,NULL,NULL)::text <> v_before
     OR public.pg_public_event_by_slug('public-extras','public-extras-event')::text <> v_slug_before THEN
    RAISE EXCEPTION 'a payload with no active extra must be byte-identical';
  END IF;

  -- Buyers keep reading the event; the helpers stay server-only.
  IF NOT has_function_privilege('anon','public.pg_direct_event_checkout_bundle(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('anon','public.pg_public_event_by_slug(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'buyers must still read the event';
  END IF;
  IF has_function_privilege('anon','public.issue_3281_public_ticket_extras(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.issue_3281_attach_public_extras(json)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3281_public_ticket_extras(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'the extras helpers must stay server-only';
  END IF;
END;
$test$;

ROLLBACK;
