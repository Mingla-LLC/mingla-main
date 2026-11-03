-- #3281 Explorer lists a ticketed event only on a date a guest can buy.
-- MINGLA-INVARIANT: I-3281-EXPLORER-LISTS-ONLY-BUYABLE-DATES | issue #3281 | An event with a guest-purchasable tier (not deleted, hidden or disabled, sold online) appears on Explorer only for a date where issue_3281_ticket_buyable_on_date holds for some tier (sale not closed, valid on the date, places left); discover_v2_event_base, discover_v2_items and discover_v2_nearest_city all apply issue_3281_explorer_date_listable, and events with no such tier are unchanged.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t3281x_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#3281 explorer buyable FAIL: %', p_message; END IF;
END
$$;

-- The card the feed shows for an event in a city: NULL when the event is not listed.
CREATE FUNCTION pg_temp.t3281x_base_start(p_city text, p_event uuid)
RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (r->>'next_start_at')::timestamptz
    FROM public.discover_v2_event_base(ARRAY[p_city], now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL) AS b(r)
   WHERE r->>'id' = p_event::text
$$;

CREATE FUNCTION pg_temp.t3281x_item_start(p_city text, p_event uuid)
RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (i->>'startsAtUtc')::timestamptz
    FROM jsonb_array_elements(
      public.discover_v2_items('events', ARRAY[p_city], 0, 0, 1, 'UTC', '{}'::jsonb, 0, 50)->'items') AS x(i)
   WHERE i->>'id' = p_event::text
$$;

CREATE FUNCTION pg_temp.t3281x_item_total(p_city text)
RETURNS bigint LANGUAGE sql AS $$
  SELECT (public.discover_v2_items('events', ARRAY[p_city], 0, 0, 1, 'UTC', '{}'::jsonb, 0, 50)->>'total')::bigint
$$;

DO $test$
DECLARE
  v_owner uuid := '32819000-0000-4000-8500-000000000001';
  v_brand uuid := '32819000-0000-4000-8500-000000000002';
  -- events
  v_closed uuid := '32819000-0000-4000-8500-000000000010';   -- (a) series-wide sale closed
  v_open uuid := '32819000-0000-4000-8500-000000000011';     -- (b) same series, sale open
  v_soldout uuid := '32819000-0000-4000-8500-000000000012';  -- (c) Dec sold out, Jan buyable
  v_keyed uuid := '32819000-0000-4000-8500-000000000013';    -- (c) tier not valid for Dec
  v_presale uuid := '32819000-0000-4000-8500-000000000014';  -- (d) sales open later
  v_rsvp uuid := '32819000-0000-4000-8500-000000000015';     -- (e) RSVP, no tiers
  v_tierless uuid := '32819000-0000-4000-8500-000000000016'; -- (e) ticketed type, no tiers
  v_rescue uuid := '32819000-0000-4000-8500-000000000017';   -- (f) only hidden/disabled/door tiers open
  v_events uuid[];
  v_session uuid := '32819000-0000-4000-8500-000000000090';
  v_dec timestamptz := date_trunc('minute', now()) + interval '10 days';
  v_jan timestamptz := date_trunc('minute', now()) + interval '40 days';
  v_feb timestamptz := date_trunc('minute', now()) + interval '70 days';
  v_mar timestamptz := date_trunc('minute', now()) + interval '100 days';
  v_event uuid;
  v_i integer := 0;
  v_tt uuid;
  v_dec_id uuid;
  v_near jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'explorer-buyable-owner@example.test');
  INSERT INTO public.profiles(id,email) VALUES(v_owner,'explorer-buyable-owner@example.test');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES(v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_owner,'Explorer buyable brand','explorer-buyable-brand','USD',now(),now());
  -- The fixture owner uses a reserved address; mark the brand as public supply
  -- through the canonical override (same as the #4073 / #4174 suites).
  INSERT INTO public.admin_internal_brands(brand_id,is_internal,reason,marked_by)
    VALUES(v_brand,false,'#3281 explorer buyable fixture','pg17');

  v_events := ARRAY[v_closed,v_open,v_soldout,v_keyed,v_presale,v_rsvp,v_tierless,v_rescue];
  FOREACH v_event IN ARRAY v_events LOOP
    v_i := v_i + 1;
    -- One city per scenario; locations 20 degrees of longitude apart so the
    -- nearest-city suggestion (500 km) only ever sees one fixture.
    INSERT INTO public.events(
      id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
      city,location_geo,published_at,rsvp_discoverable,created_at,updated_at
    ) VALUES(
      v_event,v_brand,v_owner,'Explorer buyable '||v_i,'explorer-buyable-'||v_i,
      CASE WHEN v_event = v_rsvp THEN 'rsvp' ELSE 'event' END,
      'scheduled','public','UTC','USD','#3281 City '||v_i,
      point(-170 + v_i * 20, 10),now(),v_event = v_rsvp,now(),now()
    );
    -- SSNS shape: a recurring series, four upcoming dates, no occurrence keys.
    UPDATE public.events SET is_recurring = true, is_multi_date = false
     WHERE id = v_event AND v_event IN (v_closed,v_open,v_soldout);
    INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master) VALUES
      (v_event,v_dec,v_dec + interval '4 hours','UTC',true),
      (v_event,v_jan,v_jan + interval '4 hours','UTC',false),
      (v_event,v_feb,v_feb + interval '4 hours','UTC',false),
      (v_event,v_mar,v_mar + interval '4 hours','UTC',false);
  END LOOP;

  -- Free tiers only, so the paid-collection gate is not what decides anything.
  -- (a) two free tiers, sale closed for the whole series (SSNS: BRUNCH EDITION).
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sale_start_at,sale_end_at)
    VALUES
      (v_closed,'Ready player one',0,'USD',true,70,false,1,4,true,false,0,now()-interval '20 days',now()-interval '2 days'),
      (v_closed,'Player 1 + Player 2',0,'USD',true,70,false,1,4,true,false,1,now()-interval '20 days',now()-interval '2 days');
  -- (b) the same series with sales open.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sale_start_at,sale_end_at)
    VALUES (v_open,'Ready player one',0,'USD',true,70,false,1,4,true,false,0,now()-interval '20 days',NULL);
  -- (c1) capacity per night on a recurring event: 2 places, all of Dec held.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order)
    VALUES (v_soldout,'Two seats',0,'USD',true,2,false,1,2,true,false,0)
    RETURNING id INTO v_tt;
  SELECT id INTO v_dec_id FROM public.event_dates WHERE event_id = v_soldout AND start_at = v_dec;
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,buyer_phone_e164,
      status,idempotency_key,expires_at)
    VALUES (v_session,v_soldout,v_brand,'Holder','holder@example.test','+15555550199',
      'pending_free','ticket_checkout:v2:'||v_soldout::text||':hold',now()+interval '15 minutes');
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,ticket_name_at_purchase,quantity)
    VALUES (v_session,v_tt,'Two seats',2);
  INSERT INTO public.ticket_checkout_session_event_dates(checkout_session_id,event_date_id)
    VALUES (v_session,v_dec_id);
  PERFORM pg_temp.t3281x_assert(
    public.issue_3313_ticket_type_occurrence_taken(v_tt,v_dec_id) = 2,
    'fixture: Dec is full on the one per-night counter');
  -- (c2) a day-limited tier that is not valid for Dec.
  UPDATE public.event_dates SET occurrence_key = CASE start_at
      WHEN v_dec THEN 'dec' WHEN v_jan THEN 'jan' WHEN v_feb THEN 'feb' ELSE 'mar' END
   WHERE event_id = v_keyed;
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,valid_occurrence_keys)
    VALUES (v_keyed,'January only',0,'USD',true,50,false,1,4,true,false,0,ARRAY['jan']);
  -- (d) a pre-sale: opens in five days, never closed.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sale_start_at,sale_end_at)
    VALUES (v_presale,'Early bird',0,'USD',true,50,false,1,4,true,false,0,now()+interval '5 days',now()+interval '9 days');
  -- (f) the only visible online tier is closed; the hidden, disabled and
  -- door-only tiers are open, and none of them is a guest buying on Explorer.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sale_end_at,is_hidden,is_disabled)
    VALUES
      (v_rescue,'Public, closed',0,'USD',true,50,false,1,4,true,false,0,now()-interval '1 day',false,false),
      (v_rescue,'Secret link',0,'USD',true,50,false,1,4,true,false,1,NULL,true,false),
      (v_rescue,'Paused',0,'USD',true,50,false,1,4,true,false,2,NULL,false,true),
      (v_rescue,'Door only',0,'USD',true,50,false,1,4,false,true,3,NULL,false,false);

  -- (a) closed series: off the feed, the card list, the counts and the city suggestion.
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_base_start('#3281 City 1',v_closed) IS NULL,
    '(a) a series whose every tier has stopped selling is not in the Discover base');
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_item_total('#3281 City 1') = 0
      AND pg_temp.t3281x_item_start('#3281 City 1',v_closed) IS NULL,
    '(a) the feed page and its count agree: nothing to show');
  v_near := public.discover_v2_nearest_city(10, -150);
  PERFORM pg_temp.t3281x_assert(v_near IS NULL OR v_near->>'label' NOT LIKE '#3281 City 1%',
    '(a) the empty-state city suggestion never points at a city of unbuyable events');

  -- (b) the same series with sales open lists at its next date.
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_base_start('#3281 City 2',v_open) = v_dec,
    '(b) an open series lists at its next date');
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_item_start('#3281 City 2',v_open) = v_dec
      AND pg_temp.t3281x_item_total('#3281 City 2') = 1,
    '(b) the card shows the next date and the count is one');
  v_near := public.discover_v2_nearest_city(10, -130);
  PERFORM pg_temp.t3281x_assert(v_near->>'label' LIKE '#3281 City 2%',
    '(b) an open series still drives the city suggestion');

  -- (c) Dec full or not valid for Dec: the card moves to Jan, not off the feed.
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_base_start('#3281 City 3',v_soldout) = v_jan,
    '(c) Dec sold out on a per-night recurring tier: the base picks Jan');
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_item_start('#3281 City 3',v_soldout) = v_jan,
    '(c) Dec sold out: the card shows Jan');
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_base_start('#3281 City 4',v_keyed) = v_jan
      AND pg_temp.t3281x_item_start('#3281 City 4',v_keyed) = v_jan,
    '(c) a tier valid only for Jan: the card shows Jan');
  PERFORM pg_temp.t3281x_assert(
    public.issue_3281_ticket_buyable_on_date(v_tt,v_dec_id) IS FALSE
      AND public.issue_3281_ticket_buyable_on_date(v_tt,
        (SELECT id FROM public.event_dates WHERE event_id = v_soldout AND start_at = v_jan)) IS TRUE,
    '(c) the helper answers per date');

  -- (d) a pre-sale is listable.
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_base_start('#3281 City 5',v_presale) = v_dec
      AND pg_temp.t3281x_item_start('#3281 City 5',v_presale) = v_dec,
    '(d) a tier whose sale opens later still lists the event');

  -- (e) no guest-purchasable tier: unchanged.
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_base_start('#3281 City 6',v_rsvp) = v_dec
      AND pg_temp.t3281x_item_start('#3281 City 6',v_rsvp) = v_dec,
    '(e) a discoverable RSVP with no tiers lists at its next date as before');
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_base_start('#3281 City 7',v_tierless) = v_dec
      AND pg_temp.t3281x_item_start('#3281 City 7',v_tierless) = v_dec,
    '(e) a tier-less event lists at its next date as before');

  -- (f) hidden, disabled and door-only tiers do not make an event buyable.
  PERFORM pg_temp.t3281x_assert(pg_temp.t3281x_base_start('#3281 City 8',v_rescue) IS NULL
      AND pg_temp.t3281x_item_total('#3281 City 8') = 0,
    '(f) hidden, disabled or door-only tiers do not rescue a closed event');
END;
$test$;

ROLLBACK;
