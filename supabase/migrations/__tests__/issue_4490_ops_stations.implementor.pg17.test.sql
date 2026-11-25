-- #4490 spec 08 O3 part A: executable PostgreSQL 17 proof for kitchen and bar
-- stations and floor PDFs (migration 20281203584490). The suite owns its
-- fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-STATION-ACK-IS-A-PERSON | issue #4490 | the first station accept is the order's acknowledgement and records the accepting person (acknowledged_by_user_id = actor); no station path acknowledges without a person.
-- MINGLA-INVARIANT: I-4490-STATION-NEVER-SEES-UNSENT | issue #4490 | a held Till round, a Till payment carrier, a tab settlement and an unpaid guest checkout never reach a station board, and no station action accepts them.
-- MINGLA-INVARIANT: I-4490-FLOOR-PDF-PRIVATE | issue #4490 | floor PDFs live only in the private venue-floor-pdfs bucket; what a PDF prints is read only after the venue gate and the person's rights at that venue are checked, and every object is listed for deletion after 24 hours.
--
-- FAILS-ON-REVERT: without 20281203584490 the first helper call fails (no issue_4490_station_board).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490o3_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490O3 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490o3_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490O3 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490O3 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490o3_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
    ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;
CREATE FUNCTION public.t4490o3_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490o3_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o3_ok(boolean,text), public.t4490o3_expect(text,text,text,text),
  public.t4490o3_as(uuid), public.t4490o3_service(), public.t4490o3_reset() TO PUBLIC;

-- Pickup codes are unique per live order: hand them out in order, never at random.
CREATE SEQUENCE public.t4490o3_pickup START 701;
GRANT USAGE ON SEQUENCE public.t4490o3_pickup TO PUBLIC;
CREATE TEMP TABLE t4490o3_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490o3_ids TO PUBLIC;
CREATE FUNCTION public.t4490o3_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490o3_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o3_id(text) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'VENUE_TILL';

-- Users: 01 owner, 02 kitchen at A, 03 seller (venue.sell only) at A, 04 check-in
-- only at A, 05 Till device at A, 06 kitchen at B only, 08 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900900-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'st-o3-' || n || '@example.test', now(), now()
FROM generate_series(1, 8) n;
INSERT INTO public.creator_accounts (id, created_at, display_name) VALUES
  ('44900900-0000-4000-8000-000000000001', now(), 'Owner O3'),
  ('44900900-0000-4000-8000-000000000002', now(), 'Ifeanyi'),
  ('44900900-0000-4000-8000-000000000003', now(), 'Ada'),
  ('44900900-0000-4000-8000-000000000008', now(), 'Other Owner');
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000001',
   'Stations O3 4490', 'stations-o3-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900900-0000-4000-9000-000000000020', '44900900-0000-4000-8000-000000000008',
   'Stations O3 Other 4490', 'stations-o3-other-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900900-0000-4000-9000-0000000000a1', '44900900-0000-4000-9000-000000000010', 'sto3a', 'Palm Kitchen',
   6.45, 3.40, 'restaurant', 'verified', 'NG'),
  ('44900900-0000-4000-9000-0000000000b1', '44900900-0000-4000-9000-000000000010', 'sto3b', 'Palm Bar B',
   6.45, 3.41, 'restaurant', 'verified', 'NG'),
  ('44900900-0000-4000-9000-0000000000c1', '44900900-0000-4000-9000-000000000020', 'sto3c', 'Other Kitchen',
   6.46, 3.42, 'restaurant', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900900-0000-4000-a000-000000000002', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900900-0000-4000-a000-000000000003', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44900900-0000-4000-a000-000000000004', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000004', 'venue_staff', now()),
  ('44900900-0000-4000-a000-000000000005', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000005', 'venue_staff', now()),
  ('44900900-0000-4000-a000-000000000006', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000006', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900900-0000-4000-a000-000000000002', '44900900-0000-4000-9000-0000000000a1', 'kitchen_bar', ARRAY['venue.kitchen']),
  ('44900900-0000-4000-a000-000000000003', '44900900-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900900-0000-4000-a000-000000000004', '44900900-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']),
  ('44900900-0000-4000-a000-000000000005', '44900900-0000-4000-9000-0000000000a1', 'till_device',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  ('44900900-0000-4000-a000-000000000006', '44900900-0000-4000-9000-0000000000b1', 'kitchen_bar', ARRAY['venue.kitchen']);

-- Menu: Jollof (kitchen), Chapman (bar), Water (no station -> the venue default).
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900900-0000-4000-b000-000000000001', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-9000-0000000000a1', 'Dinner', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available, prep_station) VALUES
  ('44900900-0000-4000-b000-000000000011', '44900900-0000-4000-b000-000000000001', '44900900-0000-4000-9000-000000000010', 'Jollof', 650000, 'NGN', true, 'kitchen'),
  ('44900900-0000-4000-b000-000000000012', '44900900-0000-4000-b000-000000000001', '44900900-0000-4000-9000-000000000010', 'Chapman', 350000, 'NGN', true, 'bar'),
  ('44900900-0000-4000-b000-000000000013', '44900900-0000-4000-b000-000000000001', '44900900-0000-4000-9000-000000000010', 'Water', 50000, 'NGN', true, NULL);
INSERT INTO public.qr_spots (id, brand_id, venue_id, kind, label, serving_venue_id, code) VALUES
  ('44900900-0000-4000-b000-000000000021', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-9000-0000000000a1',
   'custom', 'Table 6', '44900900-0000-4000-9000-0000000000a1', 't4490o3t6');
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900900-0000-4000-9000-0000000000a1', '44900900-0000-4000-9000-000000000010', 0)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 0;

SELECT public.t4490o3_as('44900900-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900900-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'o3-menu-on-a');
SELECT public.issue_4490_set_venue_feature('44900900-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'o3-till-on-a');
SELECT public.issue_4490_set_venue_feature('44900900-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'o3-ks-on-a1');
SELECT public.issue_4490_set_venue_feature('44900900-0000-4000-9000-0000000000b1', 'menu', true, NULL, NULL, NULL, 'o3-menu-on-b');
SELECT public.issue_4490_set_venue_feature('44900900-0000-4000-9000-0000000000b1', 'kitchen_screens', true, NULL, NULL, NULL, 'o3-ks-on-b1');
SELECT public.t4490o3_reset();

-- A paid guest page order (Mingla money, pickup code) with the given items.
CREATE FUNCTION public.t4490o3_guest(p_venue uuid, p_items uuid[], p_paid boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_session uuid;
  v_order uuid := gen_random_uuid();
  v_item uuid;
  v_n integer := 0;
  v_sub integer := 0;
BEGIN
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
  VALUES ('44900900-0000-4000-9000-000000000010', p_venue, 'NGN') RETURNING id INTO v_session;
  SELECT COALESCE(sum(mi.price_cents), 0) INTO v_sub FROM public.menu_items mi WHERE mi.id = ANY (p_items);
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, pickup_code, buyer_name, buyer_email, buyer_phone_e164,
    money_path, provider, currency, subtotal_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, confirmed_at
  ) VALUES (
    v_order, v_session, '44900900-0000-4000-9000-000000000010', p_venue, 'guest_page',
    (nextval('public.t4490o3_pickup')::int)::text, 'Tolu', 'tolu@example.test', '+2348031234567',
    'mingla', 'paystack', 'NGN', v_sub, 0, 0, 0, 0, 0, false, false, false,
    v_sub, v_sub, CASE WHEN p_paid THEN 'paid' ELSE 'pending' END, 'placed', 'guest-o3:' || v_order,
    CASE WHEN p_paid THEN now() END);
  FOREACH v_item IN ARRAY p_items LOOP
    v_n := v_n + 1;
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents)
    SELECT v_order, mi.id, v_n, mi.name, mi.price_cents, 'NGN', 1, 0, mi.price_cents
    FROM public.menu_items mi WHERE mi.id = v_item;
  END LOOP;
  RETURN v_order;
END
$f$;

-- A Till round exactly as the edge inserts it (held), attached to the sale.
CREATE FUNCTION public.t4490o3_round(p_sale uuid, p_actor uuid, p_items uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_order uuid := gen_random_uuid();
  v_item uuid;
  v_n integer := 0;
  v_sub integer;
BEGIN
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale;
  SELECT COALESCE(sum(mi.price_cents), 0) INTO v_sub FROM public.menu_items mi WHERE mi.id = ANY (p_items);
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, qr_spot_id, spot_label_at_order, source, taken_by_user_id, pickup_code,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, v_sale.session_id, v_sale.brand_id, v_sale.venue_id, v_sale.qr_spot_id,
    CASE WHEN v_sale.qr_spot_id IS NOT NULL THEN 'Table 6' END, 'staff', p_actor,
    CASE WHEN v_sale.qr_spot_id IS NULL THEN (nextval('public.t4490o3_pickup')::int)::text END,
    'venue_collected', 'NGN', v_sub, v_sub, 0, 0, 0, 0, 0, 0, false, false, false,
    v_sub, v_sub, 'pending', 'held', 'till-round-o3:' || v_order,
    jsonb_build_object('unsettled_staff_order', true, 'till_sale_id', p_sale));
  FOREACH v_item IN ARRAY p_items LOOP
    v_n := v_n + 1;
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents)
    SELECT v_order, mi.id, v_n, mi.name, mi.price_cents, 'NGN', 1, 0, mi.price_cents
    FROM public.menu_items mi WHERE mi.id = v_item;
  END LOOP;
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, p_actor,
    (SELECT s.version FROM public.venue_till_sales s WHERE s.id = p_sale));
  RETURN v_order;
END
$f$;

-- Shorthands (service role, as the edge calls them).
CREATE FUNCTION public.t4490o3_board(p_actor uuid, p_station text) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT public.issue_4490_station_board('44900900-0000-4000-9000-0000000000a1', p_station, p_actor)
$f$;
CREATE FUNCTION public.t4490o3_ticket(p_actor uuid, p_station text, p_order uuid) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT t FROM jsonb_array_elements(public.t4490o3_board(p_actor, p_station)->'tickets') t
  WHERE t->>'orderId' = p_order::text AND t->>'station' = CASE WHEN p_station = 'all' THEN t->>'station' ELSE p_station END
  LIMIT 1
$f$;

-- ===========================================================================
-- S-1 the gate: release switch AND kitchen_screens.
-- ===========================================================================
SELECT public.t4490o3_service();
SELECT public.t4490o3_expect(
  $q$SELECT public.issue_4490_station_board('44900900-0000-4000-9000-0000000000a1', 'kitchen', '44900900-0000-4000-8000-000000000002')$q$,
  'P0001', 'stations_not_enabled', 'S-1a with the release switch off the board refuses (stations_not_enabled)');
SELECT public.t4490o3_reset();
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_TILL';
SELECT public.t4490o3_service();
SELECT public.t4490o3_ok(jsonb_typeof(public.t4490o3_board('44900900-0000-4000-8000-000000000002', 'kitchen')->'tickets') = 'array',
  'S-1b with the switch on and kitchen_screens on, the kitchen reads its board');
SELECT public.t4490o3_expect(
  $q$SELECT public.issue_4490_station_board('44900900-0000-4000-9000-0000000000c1', 'kitchen', '44900900-0000-4000-8000-000000000008')$q$,
  'P0001', 'stations_not_enabled', 'S-1c a venue without kitchen_screens refuses even its own owner');
SELECT public.t4490o3_expect(
  $q$SELECT public.issue_4490_station_board('44900900-0000-4000-9000-0000000000a1', 'grill', '44900900-0000-4000-8000-000000000002')$q$,
  '22023', 'station_invalid', 'S-1d an unknown station is refused');

-- ===========================================================================
-- S-2 rights.
-- ===========================================================================
SELECT public.t4490o3_expect(
  $q$SELECT public.t4490o3_board('44900900-0000-4000-8000-000000000004', 'kitchen')$q$,
  '42501', 'not_authorized', 'S-2a check-in-only staff cannot read the board');
SELECT public.t4490o3_expect(
  $q$SELECT public.t4490o3_board('44900900-0000-4000-8000-000000000003', 'kitchen')$q$,
  '42501', 'not_authorized', 'S-2b a seller with only venue.sell cannot read the board');
SELECT public.t4490o3_expect(
  $q$SELECT public.t4490o3_board('44900900-0000-4000-8000-000000000006', 'kitchen')$q$,
  '42501', 'not_authorized', 'S-2c kitchen staff of venue B cannot read venue A');
SELECT public.t4490o3_expect(
  $q$SELECT public.t4490o3_board('44900900-0000-4000-8000-000000000008', 'kitchen')$q$,
  '42501', 'not_authorized', 'S-2d another brand''s owner cannot read venue A');
SELECT public.t4490o3_ok(jsonb_typeof(public.t4490o3_board('44900900-0000-4000-8000-000000000005', 'all')->'tickets') = 'array'
    AND jsonb_typeof(public.t4490o3_board('44900900-0000-4000-8000-000000000001', 'bar')->'tickets') = 'array',
  'S-2e the Till device and the owner read the board');
-- (Refusals for anon / authenticated are read from the catalogue: calling a refused definer
-- function inside an exception block as a client role once crashed a local PostgreSQL 17
-- backend, the reason the #4490 grants suite never does it.)
SELECT public.t4490o3_reset();
SELECT public.t4490o3_ok(NOT has_function_privilege('anon', 'public.issue_4490_station_accept(uuid,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4490_station_accept(uuid,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4490_floor_pdf_source(text,uuid,uuid,text,uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4490_station_accept(uuid,text,uuid)', 'EXECUTE'),
  'S-2f station and PDF RPCs are internal (no anon or authenticated EXECUTE)');

-- ===========================================================================
-- S-3 the station trigger: guest orders and Till rounds route the same way.
-- ===========================================================================
INSERT INTO t4490o3_ids VALUES ('guest_mixed', public.t4490o3_guest('44900900-0000-4000-9000-0000000000a1',
  ARRAY['44900900-0000-4000-b000-000000000011', '44900900-0000-4000-b000-000000000012', '44900900-0000-4000-b000-000000000013']::uuid[], true));
SELECT public.t4490o3_ok((SELECT array_agg(i.station ORDER BY i.line_no) FROM public.venue_order_items i
                           WHERE i.venue_order_id = public.t4490o3_id('guest_mixed')) = ARRAY['kitchen', 'bar', 'kitchen'],
  'S-3a a guest order''s lines get their station from the trigger (Jollof kitchen, Chapman bar, Water -> default kitchen)');
INSERT INTO public.venue_till_settings (venue_id, brand_id, default_station)
VALUES ('44900900-0000-4000-9000-0000000000a1', '44900900-0000-4000-9000-000000000010', 'bar');
SELECT public.t4490o3_service();
INSERT INTO t4490o3_ids
SELECT 'sale', (public.issue_4490_till_open('44900900-0000-4000-9000-0000000000a1',
  '44900900-0000-4000-8000-000000000003', NULL, NULL, '44900900-0000-4000-b000-000000000021', 'o3-sale-table6-0001')->>'id')::uuid;
INSERT INTO t4490o3_ids VALUES ('round1', public.t4490o3_round(public.t4490o3_id('sale'), '44900900-0000-4000-8000-000000000003',
  ARRAY['44900900-0000-4000-b000-000000000011', '44900900-0000-4000-b000-000000000013']::uuid[]));
SELECT public.t4490o3_ok((SELECT array_agg(i.station ORDER BY i.line_no) FROM public.venue_order_items i
                           WHERE i.venue_order_id = public.t4490o3_id('round1')) = ARRAY['kitchen', 'bar'],
  'S-3b a Till round''s lines get their station from the trigger; an item with no station follows the venue default (bar)');

-- ===========================================================================
-- S-4 held rounds are hidden; sent rounds appear; a mixed order is two tickets.
-- ===========================================================================
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'all', public.t4490o3_id('round1')) IS NULL,
  'S-4a a held Till round is on no station board');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_station_accept(%L, 'kitchen', '44900900-0000-4000-8000-000000000002')$q$,
         public.t4490o3_id('round1')),
  'P0002', 'station_ticket_not_found', 'S-4b a held Till round cannot be accepted');
SELECT public.issue_4490_till_send(public.t4490o3_id('sale'), '44900900-0000-4000-8000-000000000003');
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('round1'))->>'state' = 'new'
    AND public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'bar', public.t4490o3_id('round1'))->>'state' = 'new',
  'S-4c once sent, the round is New on the kitchen board and New on the bar board (two tickets)');
SELECT public.t4490o3_ok((SELECT count(*) FROM jsonb_array_elements(public.t4490o3_board('44900900-0000-4000-8000-000000000002', 'all')->'tickets') t
                           WHERE t->>'orderId' = public.t4490o3_id('guest_mixed')::text) = 2
    AND (SELECT count(*) FROM jsonb_array_elements(public.t4490o3_board('44900900-0000-4000-8000-000000000002', 'kitchen')->'tickets') t
         WHERE t->>'orderId' = public.t4490o3_id('guest_mixed')::text) = 1,
  'S-4d a mixed guest order splits into a kitchen ticket and a bar ticket');
SELECT public.t4490o3_ok(
    public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('round1'))->>'destination' = 'Table 6'
    AND public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('round1'))->>'sellerName' = 'Ada'
    AND (public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('guest_mixed'))->>'guestOrder')::boolean
    AND public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('guest_mixed'))->>'destination' LIKE 'Pickup % · Tolu',
  'S-4e tickets show the table or pickup code and who sent it (guest orders say so)');

-- Unpaid guest checkouts, carriers and tab settlements never reach a station.
INSERT INTO t4490o3_ids VALUES ('guest_unpaid', public.t4490o3_guest('44900900-0000-4000-9000-0000000000a1',
  ARRAY['44900900-0000-4000-b000-000000000011']::uuid[], false));
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'all', public.t4490o3_id('guest_unpaid')) IS NULL,
  'S-4f an unpaid guest checkout is on no board');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_station_accept(%L, 'kitchen', '44900900-0000-4000-8000-000000000002')$q$,
         public.t4490o3_id('guest_unpaid')),
  'P0002', 'station_ticket_not_found', 'S-4g an unpaid guest checkout cannot be accepted');
UPDATE public.venue_orders SET metadata = metadata || '{"tab_settlement":"true"}'::jsonb
WHERE id = public.t4490o3_id('guest_unpaid');
UPDATE public.venue_orders SET payment_status = 'paid', confirmed_at = now() WHERE id = public.t4490o3_id('guest_unpaid');
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'all', public.t4490o3_id('guest_unpaid')) IS NULL,
  'S-4h a tab settlement is on no board even once paid');

-- ===========================================================================
-- S-5 accept writes a person; a second accept answers who did.
-- ===========================================================================
SELECT public.issue_4490_station_accept(public.t4490o3_id('round1'), 'kitchen', '44900900-0000-4000-8000-000000000002');
SELECT public.t4490o3_ok((SELECT o.acknowledged_by_user_id = '44900900-0000-4000-8000-000000000002'
                                 AND o.acknowledged_at IS NOT NULL AND o.fulfillment_status = 'in_progress'
                          FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round1')),
  'S-5a the first accept acknowledges the order as the accepting person and starts it');
SELECT public.t4490o3_ok((SELECT bool_and(i.prep_state = 'fired' AND i.fired_at IS NOT NULL) FROM public.venue_order_items i
                          WHERE i.venue_order_id = public.t4490o3_id('round1') AND i.station = 'kitchen')
    AND (SELECT bool_and(i.prep_state = 'pending') FROM public.venue_order_items i
         WHERE i.venue_order_id = public.t4490o3_id('round1') AND i.station = 'bar'),
  'S-5b accept fires only that station''s lines');
SELECT public.t4490o3_ok((public.issue_4490_station_accept(public.t4490o3_id('round1'), 'kitchen', '44900900-0000-4000-8000-000000000005')
                          ->>'alreadyAcceptedBy') = 'Ifeanyi',
  'S-5c a second accept is no error: it says who already accepted (T14)');
SELECT public.t4490o3_ok((SELECT o.station_rev > 0 FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round1')),
  'S-5d every station change bumps station_rev on the order (T6)');
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('round1'))->>'state' = 'cooking'
    AND public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('round1'))->>'acceptedByName' = 'Ifeanyi',
  'S-5e the ticket moves to Cooking with who accepted it');
SELECT public.issue_4490_station_accept(public.t4490o3_id('round1'), 'bar', '44900900-0000-4000-8000-000000000005');
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'bar', public.t4490o3_id('round1'))->>'acceptedByName' = 'Kitchen screen',
  'S-5f a Till device acting as itself shows as "Kitchen screen"');

-- ===========================================================================
-- S-6 the order is ready only when both stations are ready; recall; pick up.
-- ===========================================================================
SELECT public.issue_4490_station_ticket_ready(public.t4490o3_id('round1'), 'kitchen', '44900900-0000-4000-8000-000000000002');
SELECT public.t4490o3_ok((SELECT o.fulfillment_status = 'in_progress' FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round1')),
  'S-6a one station ready: the order is not ready yet');
SELECT public.t4490o3_ok((public.issue_4490_station_ticket_ready(public.t4490o3_id('round1'), 'bar', '44900900-0000-4000-8000-000000000002')
                          ->>'orderReady')::boolean
,
  'S-6b both stations ready: the answer says the order is ready');
SELECT public.t4490o3_ok((SELECT o.fulfillment_status = 'ready' AND o.ready_at IS NOT NULL FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round1')),
  'S-6b2 and the order row is ready');
SELECT public.t4490o3_ok((public.issue_4490_station_ticket_ready(public.t4490o3_id('round1'), 'bar', '44900900-0000-4000-8000-000000000002')
                          ->>'already')::boolean,
  'S-6c ticket ready again is idempotent (T14)');
SELECT public.issue_4490_station_recall(public.t4490o3_id('round1'), 'bar', '44900900-0000-4000-8000-000000000002');
SELECT public.t4490o3_ok((SELECT o.fulfillment_status = 'in_progress' AND o.ready_at IS NULL FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round1'))
    AND public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'bar', public.t4490o3_id('round1'))->>'state' = 'cooking',
  'S-6d recall puts a Ready ticket back to Cooking and the order back in progress');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_station_recall(%L, 'bar', '44900900-0000-4000-8000-000000000002')$q$, public.t4490o3_id('round1')),
  'PT409', 'station_ticket_not_ready', 'S-6e recall is only for Ready tickets');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_order_picked_up(%L, 'bar', '44900900-0000-4000-8000-000000000003')$q$, public.t4490o3_id('round1')),
  'PT409', 'station_ticket_not_ready', 'S-6f a ticket that is not ready cannot be picked up');
SELECT public.issue_4490_station_ticket_ready(public.t4490o3_id('round1'), 'bar', '44900900-0000-4000-8000-000000000002');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_order_picked_up(%L, 'kitchen', '44900900-0000-4000-8000-000000000004')$q$, public.t4490o3_id('round1')),
  '42501', 'not_authorized', 'S-6g check-in-only staff cannot pick up');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_order_picked_up(%L, 'kitchen', '44900900-0000-4000-8000-000000000006')$q$, public.t4490o3_id('round1')),
  '42501', 'not_authorized', 'S-6h kitchen staff of another venue cannot pick up');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_station_accept(%L, 'kitchen', '44900900-0000-4000-8000-000000000003')$q$, public.t4490o3_id('guest_mixed')),
  '42501', 'not_authorized', 'S-6i a seller with only venue.sell cannot accept');
SELECT public.issue_4490_order_picked_up(public.t4490o3_id('round1'), 'kitchen', '44900900-0000-4000-8000-000000000003');
SELECT public.t4490o3_ok((SELECT o.fulfillment_status = 'ready' FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round1')),
  'S-6j a seller (venue.sell only) picks up one station: not delivered while the other is on the pass');
SELECT public.t4490o3_ok((public.issue_4490_order_picked_up(public.t4490o3_id('round1'), 'bar', '44900900-0000-4000-8000-000000000003')->>'delivered')::boolean,
  'S-6k both picked up: the answer says delivered');
SELECT public.t4490o3_ok((SELECT o.fulfillment_status = 'delivered' AND o.delivered_at IS NOT NULL FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round1')),
  'S-6k2 and the order row is delivered');
SELECT public.t4490o3_ok((public.issue_4490_order_picked_up(public.t4490o3_id('round1'), 'bar', '44900900-0000-4000-8000-000000000003')->>'already')::boolean,
  'S-6l picked up again is idempotent');
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'all', public.t4490o3_id('round1')) IS NULL,
  'S-6l2 a delivered order leaves the board');

-- ===========================================================================
-- S-7 one line ready; printed counts.
-- ===========================================================================
SELECT public.issue_4490_station_accept(public.t4490o3_id('guest_mixed'), 'kitchen', '44900900-0000-4000-8000-000000000002');
SELECT public.issue_4490_station_item_ready(
  (SELECT i.id FROM public.venue_order_items i WHERE i.venue_order_id = public.t4490o3_id('guest_mixed') AND i.line_no = 1),
  '44900900-0000-4000-8000-000000000002');
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('guest_mixed'))->>'state' = 'cooking',
  'S-7a one line ready keeps the ticket cooking while another line is not');
SELECT public.issue_4490_station_item_ready(
  (SELECT i.id FROM public.venue_order_items i WHERE i.venue_order_id = public.t4490o3_id('guest_mixed') AND i.line_no = 3),
  '44900900-0000-4000-8000-000000000002');
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('guest_mixed'))->>'state' = 'ready',
  'S-7b the last line ready makes the ticket ready');
SELECT public.issue_4490_station_mark_printed(public.t4490o3_id('guest_mixed'), 'bar', '44900900-0000-4000-8000-000000000002');
SELECT public.issue_4490_station_mark_printed(public.t4490o3_id('guest_mixed'), 'bar', '44900900-0000-4000-8000-000000000002');
SELECT public.t4490o3_ok((public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'bar', public.t4490o3_id('guest_mixed'))->>'printedCount')::int = 2
    AND public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'bar', public.t4490o3_id('guest_mixed'))->>'state' = 'new',
  'S-7c each printed PDF counts once; printing does not accept the ticket');

-- ===========================================================================
-- S-8 a voided item leaves the ticket.
-- ===========================================================================
INSERT INTO t4490o3_ids
SELECT 'sale2', (public.issue_4490_till_open('44900900-0000-4000-9000-0000000000a1',
  '44900900-0000-4000-8000-000000000003', NULL, 'Kemi', NULL, 'o3-sale-kemi-00002')->>'id')::uuid;
INSERT INTO t4490o3_ids VALUES ('round2', public.t4490o3_round(public.t4490o3_id('sale2'), '44900900-0000-4000-8000-000000000003',
  ARRAY['44900900-0000-4000-b000-000000000011', '44900900-0000-4000-b000-000000000011', '44900900-0000-4000-b000-000000000012']::uuid[]));
SELECT public.issue_4490_till_send(public.t4490o3_id('sale2'), '44900900-0000-4000-8000-000000000003');
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('round2'))->>'destination' LIKE 'Pickup % · Kemi',
  'S-8a a counter check shows its pickup code and the check name');
SELECT public.issue_4490_till_void(public.t4490o3_id('sale2'), NULL,
  (SELECT i.id FROM public.venue_order_items i WHERE i.venue_order_id = public.t4490o3_id('round2') AND i.line_no = 2),
  '44900900-0000-4000-8000-000000000001', 'guest_changed_mind', false,
  (SELECT s.version FROM public.venue_till_sales s WHERE s.id = public.t4490o3_id('sale2')));
SELECT public.t4490o3_ok(
    (SELECT (l->>'voided')::boolean AND l->>'voidedByName' = 'Owner O3'
     FROM jsonb_array_elements(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('round2'))->'lines') l
     WHERE (l->>'name') = 'Jollof' AND (l->>'voided')::boolean LIMIT 1)
    AND public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('round2'))->>'state' = 'new',
  'S-8b a voided line stays on the ticket struck through with who voided it; the ticket stays live');
SELECT public.issue_4490_till_void(public.t4490o3_id('sale2'), NULL,
  (SELECT i.id FROM public.venue_order_items i WHERE i.venue_order_id = public.t4490o3_id('round2') AND i.line_no = 3),
  '44900900-0000-4000-8000-000000000001', 'guest_changed_mind', false,
  (SELECT s.version FROM public.venue_till_sales s WHERE s.id = public.t4490o3_id('sale2')));
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'bar', public.t4490o3_id('round2'))->>'state' = 'voided',
  'S-8c a station whose every line is voided shows its ticket as voided');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_station_ticket_ready(%L, 'bar', '44900900-0000-4000-8000-000000000002')$q$, public.t4490o3_id('round2')),
  'PT409', 'station_ticket_closed', 'S-8d a voided ticket cannot be made ready');

-- ===========================================================================
-- S-9 stations with no screen (T8).
-- ===========================================================================
UPDATE public.venue_till_settings SET screen_stations = ARRAY['kitchen']
WHERE venue_id = '44900900-0000-4000-9000-0000000000a1';
INSERT INTO t4490o3_ids
SELECT 'sale3', (public.issue_4490_till_open('44900900-0000-4000-9000-0000000000a1',
  '44900900-0000-4000-8000-000000000003', NULL, 'Bar only', NULL, 'o3-sale-baronly-3')->>'id')::uuid;
INSERT INTO t4490o3_ids VALUES ('round3', public.t4490o3_round(public.t4490o3_id('sale3'), '44900900-0000-4000-8000-000000000003',
  ARRAY['44900900-0000-4000-b000-000000000012']::uuid[]));
INSERT INTO t4490o3_ids VALUES ('round3b', public.t4490o3_round(public.t4490o3_id('sale3'), '44900900-0000-4000-8000-000000000003',
  ARRAY['44900900-0000-4000-b000-000000000011', '44900900-0000-4000-b000-000000000012']::uuid[]));
SELECT public.issue_4490_till_send(public.t4490o3_id('sale3'), '44900900-0000-4000-8000-000000000003');
SELECT public.t4490o3_ok((SELECT o.fulfillment_status = 'delivered' AND o.acknowledged_by_user_id = '44900900-0000-4000-8000-000000000003'
                          FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round3')),
  'S-9a a round for a station with no screen is delivered at send, acknowledged by the sender');
SELECT public.t4490o3_ok(public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'kitchen', public.t4490o3_id('round3b'))->>'state' = 'new'
    AND public.t4490o3_ticket('44900900-0000-4000-8000-000000000002', 'bar', public.t4490o3_id('round3b')) IS NULL
    AND (SELECT o.fulfillment_status = 'placed' FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round3b')),
  'S-9b a mixed round: the screened kitchen gets its ticket, the unscreened bar part is cleared at once');
SELECT public.t4490o3_reset();
SELECT public.t4490o3_as('44900900-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900900-0000-4000-9000-0000000000a1', 'kitchen_screens', false, NULL, NULL, NULL, 'o3-ks-a-off');
SELECT public.t4490o3_reset();
SELECT public.t4490o3_service();
INSERT INTO t4490o3_ids VALUES ('round4', public.t4490o3_round(public.t4490o3_id('sale3'), '44900900-0000-4000-8000-000000000003',
  ARRAY['44900900-0000-4000-b000-000000000011']::uuid[]));
SELECT public.issue_4490_till_send(public.t4490o3_id('sale3'), '44900900-0000-4000-8000-000000000003');
SELECT public.t4490o3_ok((SELECT o.fulfillment_status = 'delivered' FROM public.venue_orders o WHERE o.id = public.t4490o3_id('round4')),
  'S-9c with kitchen_screens off no station has a screen: a sent round is delivered at send');
SELECT public.t4490o3_reset();
SELECT public.t4490o3_as('44900900-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900900-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'o3-ks-a-on2');
SELECT public.t4490o3_reset();
SELECT public.t4490o3_service();
UPDATE public.venue_till_settings SET screen_stations = ARRAY['kitchen', 'bar']
WHERE venue_id = '44900900-0000-4000-9000-0000000000a1';

-- ===========================================================================
-- S-10 RLS on the new tables.
-- ===========================================================================
SELECT public.t4490o3_reset();
SELECT public.t4490o3_as('44900900-0000-4000-8000-000000000002');
SELECT public.t4490o3_ok((SELECT count(*) FROM public.venue_station_tickets t
                          WHERE t.venue_order_id = public.t4490o3_id('guest_mixed')) >= 1,
  'S-10a kitchen staff at the venue read its station tickets');
SELECT public.t4490o3_expect(
  format($q$INSERT INTO public.venue_station_tickets (venue_order_id, station) VALUES (%L, 'bar')$q$, public.t4490o3_id('round2')),
  '42501', NULL, 'S-10b nobody signed in writes a station ticket directly');
SELECT public.t4490o3_expect($q$SELECT count(*) FROM public.venue_floor_pdfs$q$,
  '42501', NULL, 'S-10c the floor PDF ledger is not readable by signed-in users');
SELECT public.t4490o3_reset();
SELECT public.t4490o3_as('44900900-0000-4000-8000-000000000004');
SELECT public.t4490o3_ok((SELECT count(*) FROM public.venue_station_tickets) = 0,
  'S-10d check-in-only staff read no station tickets');
SELECT public.t4490o3_reset();
SELECT public.t4490o3_as('44900900-0000-4000-8000-000000000008');
SELECT public.t4490o3_ok((SELECT count(*) FROM public.venue_station_tickets t
                          WHERE t.venue_order_id = public.t4490o3_id('guest_mixed')) = 0,
  'S-10e another brand''s owner reads none of this venue''s tickets');
SELECT public.t4490o3_reset();
SELECT public.t4490o3_as(NULL);
SELECT public.t4490o3_expect($q$SELECT count(*) FROM public.venue_station_tickets$q$,
  '42501', NULL, 'S-10f signed out reads nothing');
SELECT public.t4490o3_reset();
-- The CI baseline's storage schema may lack buckets.public (the migration's own guard), so
-- the column is read only when it exists.
DO $bucket$
DECLARE
  v_private boolean := true;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public') THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'venue-floor-pdfs' AND NOT b.public)$q$
      INTO v_private;
  END IF;
  PERFORM public.t4490o3_ok(v_private, 'S-10g the venue-floor-pdfs bucket is private (where the storage schema has buckets.public)');
END
$bucket$;

-- ===========================================================================
-- S-11 what a floor PDF prints, and who may make it.
-- ===========================================================================
SELECT public.t4490o3_service();
SELECT public.t4490o3_ok(
    (SELECT x->>'kind' = 'kitchen_ticket' AND x->>'paper' = 'a4' AND x->'ticket'->>'station' = 'kitchen'
            AND x->>'venueName' = 'Palm Kitchen' AND x->>'sentAtLocal' ~ '^[0-2][0-9]:[0-5][0-9]$'
     FROM public.issue_4490_floor_pdf_source('kitchen_ticket', '44900900-0000-4000-9000-0000000000a1',
       public.t4490o3_id('guest_mixed'), 'kitchen', NULL, '44900900-0000-4000-8000-000000000002') x),
  'S-11a a kitchen ticket PDF reads its ticket, the paper size and the time in the venue zone');
UPDATE public.venue_till_settings SET print_paper = 'roll_58' WHERE venue_id = '44900900-0000-4000-9000-0000000000a1';
SELECT public.t4490o3_ok(
    (SELECT x->>'paper' = 'roll_58' AND x->>'station' = 'bar'
     FROM public.issue_4490_floor_pdf_source('test_ticket', '44900900-0000-4000-9000-0000000000a1',
       NULL, 'bar', NULL, '44900900-0000-4000-8000-000000000005') x),
  'S-11b a test ticket follows the venue paper setting (58 mm roll)');
SELECT public.t4490o3_expect(
  $q$SELECT public.issue_4490_floor_pdf_source('day_close', '44900900-0000-4000-9000-0000000000a1', NULL, NULL, NULL, '44900900-0000-4000-8000-000000000001')$q$,
  '22023', 'floor_pdf_kind_not_ready', 'S-11c a day close PDF is refused with its own code until the close ships');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_floor_pdf_source('kitchen_ticket', '44900900-0000-4000-9000-0000000000b1', %L, 'kitchen', NULL, '44900900-0000-4000-8000-000000000006')$q$,
         public.t4490o3_id('guest_mixed')),
  'P0002', 'floor_pdf_not_found', 'S-11d a ticket of another venue is never printed through this venue');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_floor_pdf_source('kitchen_ticket', '44900900-0000-4000-9000-0000000000a1', %L, 'kitchen', NULL, '44900900-0000-4000-8000-000000000008')$q$,
         public.t4490o3_id('guest_mixed')),
  '42501', 'not_authorized', 'S-11e another brand''s owner cannot print this venue''s ticket');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_floor_pdf_source('kitchen_ticket', '44900900-0000-4000-9000-0000000000a1', %L, 'kitchen', NULL, '44900900-0000-4000-8000-000000000003')$q$,
         public.t4490o3_id('guest_mixed')),
  '42501', 'not_authorized', 'S-11f a seller without kitchen rights cannot print a kitchen ticket');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_floor_pdf_source('kitchen_ticket', '44900900-0000-4000-9000-0000000000a1', %L, 'kitchen', NULL, '44900900-0000-4000-8000-000000000002')$q$,
         public.t4490o3_id('guest_unpaid')),
  'P0002', 'floor_pdf_not_found', 'S-11g a ticket no station may see is never printed');

-- A paid cash payment for the receipt.
SELECT public.issue_4490_till_take_payment(public.t4490o3_id('sale2'), 'cash',
  (SELECT s.total_due_minor - s.paid_minor FROM public.venue_till_sales s WHERE s.id = public.t4490o3_id('sale2')),
  0, 5000000, '44900900-0000-4000-8000-000000000003', '44900900-0000-4000-8000-000000000003',
  '44900900-0000-4000-c000-000000000001',
  (SELECT s.version FROM public.venue_till_sales s WHERE s.id = public.t4490o3_id('sale2')));
INSERT INTO t4490o3_ids SELECT 'pay2', p.id FROM public.venue_till_payments p WHERE p.sale_id = public.t4490o3_id('sale2');
SELECT public.t4490o3_ok(
    (SELECT x->>'kind' = 'receipt' AND (x->'receipt'->>'totalMinor')::bigint = 650000
            AND x->'receipt'->'payment'->>'method' = 'cash' AND x->>'paidAtLocal' ~ '^[0-3][0-9]/[01][0-9]/20[0-9]{2} '
     FROM public.issue_4490_floor_pdf_source('receipt', '44900900-0000-4000-9000-0000000000a1',
       NULL, NULL, public.t4490o3_id('pay2'), '44900900-0000-4000-8000-000000000003') x),
  'S-11h a seller prints the receipt of a paid payment at the venue (the receipt snapshot)');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_floor_pdf_source('receipt', '44900900-0000-4000-9000-0000000000a1', NULL, NULL, %L, '44900900-0000-4000-8000-000000000002')$q$,
         public.t4490o3_id('pay2')),
  '42501', 'not_authorized', 'S-11i kitchen staff without selling rights cannot print a receipt');
SELECT public.t4490o3_expect(
  format($q$SELECT public.issue_4490_floor_pdf_source('receipt', '44900900-0000-4000-9000-0000000000b1', NULL, NULL, %L, '44900900-0000-4000-8000-000000000001')$q$,
         public.t4490o3_id('pay2')),
  'P0001', 'till_not_enabled', 'S-11j a receipt through a venue whose Till is off is refused');

-- ===========================================================================
-- S-12 the 24-hour deletion ledger.
-- ===========================================================================
SELECT public.issue_4490_floor_pdf_record('44900900-0000-4000-9000-000000000010', 'kitchen_ticket',
  '44900900-0000-4000-9000-000000000010/44900900-0000-4000-9000-0000000000a1/44900900-0000-4000-d000-000000000001.pdf',
  '44900900-0000-4000-8000-000000000002');
SELECT public.issue_4490_floor_pdf_record('44900900-0000-4000-9000-000000000010', 'receipt',
  '44900900-0000-4000-9000-000000000010/44900900-0000-4000-9000-0000000000a1/44900900-0000-4000-d000-000000000002.pdf',
  '44900900-0000-4000-8000-000000000003');
SELECT public.t4490o3_reset();
UPDATE public.venue_floor_pdfs SET created_at = now() - interval '25 hours'
WHERE object_path LIKE '%44900900-0000-4000-d000-000000000001.pdf';
SELECT public.t4490o3_service();
SELECT public.t4490o3_ok(public.issue_4490_floor_pdf_due(50) =
    ARRAY['44900900-0000-4000-9000-000000000010/44900900-0000-4000-9000-0000000000a1/44900900-0000-4000-d000-000000000001.pdf'],
  'S-12a only objects older than 24 hours are due for deletion');
SELECT public.t4490o3_ok(public.issue_4490_floor_pdf_forget(public.issue_4490_floor_pdf_due(50)) = 1,
  'S-12b the sweep marks the deleted objects');
SELECT public.t4490o3_ok(cardinality(public.issue_4490_floor_pdf_due(50)) = 0,
  'S-12b2 once deleted they are no longer due (idempotent sweep)');
SELECT public.t4490o3_expect(
  $q$SELECT public.issue_4490_floor_pdf_record('44900900-0000-4000-9000-000000000010', 'receipt', '../../etc/x.pdf', '44900900-0000-4000-8000-000000000003')$q$,
  '23514', NULL, 'S-12c an object path outside <brand>/<venue>/<uuid>.pdf is refused');
SELECT public.t4490o3_reset();

ROLLBACK;
