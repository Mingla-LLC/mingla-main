-- #4490 spec 08 O3 fix round 1: executable PostgreSQL 17 proof for migration
-- 20281203614490 (the independent test's O3-T1..T5).
--   T2  the floor-staff list behind "New order" / escalation rung 1 is empty
--       unless the venue's stations are on (VENUE_TILL AND kitchen_screens).
--   T1  the escalation scan's Mingla-money arm returns exactly the rows the
--       20270319001846 body returns (adversarial fixture, limit 50 and
--       unlimited) even with 200 due Till rounds waiting; the Till arm has its
--       own limit, a 6-hour age cap, one rung per scan, and returns nothing
--       with the switch or the venue's kitchen screens off.
--   T3  voiding a station's last live line finishes the order.
--   T4  a print counts only under the PDF's rights.
--   T5  a guest order's lines for a station with no screen never wait on a
--       station; nothing is silently delivered.
-- The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-ESCALATION-NEVER-TAKES-GUEST-SLOTS | issue #4490 | pg_venue_order_escalation_scan gives the Mingla-money (guest) arm its full 1846 limit, order and rows whatever the Till backlog; the Till arm has its own limit, never pages a round sent more than 6 hours ago, starts at rung 1, and is empty unless the venue's stations are on.
-- MINGLA-INVARIANT: I-4490-FLOOR-PUSHES-BEHIND-RELEASE | issue #4490 | issue_4490_venue_floor_user_ids lists nobody unless VENUE_TILL is on and the venue's kitchen_screens feature is on, so guest orders notify exactly the brand roles until the release.
--
-- FAILS-ON-REVERT: without 20281203614490 F1-T2a fails (the floor list ignores the switch).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490o3f_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490O3F1 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490o3f_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490O3F1 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490O3F1 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490o3f_as(p_user uuid)
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
CREATE FUNCTION public.t4490o3f_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490o3f_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o3f_ok(boolean,text), public.t4490o3f_expect(text,text,text,text),
  public.t4490o3f_as(uuid), public.t4490o3f_service(), public.t4490o3f_reset() TO PUBLIC;

-- Pickup codes are unique per live order: hand them out in order, never at random.
CREATE SEQUENCE public.t4490o3f_pickup START 101;
GRANT USAGE ON SEQUENCE public.t4490o3f_pickup TO PUBLIC;
CREATE TEMP TABLE t4490o3f_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490o3f_ids TO PUBLIC;
CREATE FUNCTION public.t4490o3f_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490o3f_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o3f_id(text) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
INSERT INTO public.feature_flags (flag_key, is_enabled) VALUES ('VENUE_TILL', false)
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = false;

-- Users: 01 owner, 02 kitchen at A, 03 seller (venue.sell only) at A, 05 Till
-- device at A, 06 kitchen at B, 07 restaurant.manage_orders at A.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900f31-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'o3f1-' || n || '@example.test', now(), now()
FROM generate_series(1, 8) n;
INSERT INTO public.creator_accounts (id, created_at, display_name) VALUES
  ('44900f31-0000-4000-8000-000000000001', now(), 'Owner F1'),
  ('44900f31-0000-4000-8000-000000000002', now(), 'Ifeanyi'),
  ('44900f31-0000-4000-8000-000000000003', now(), 'Ada');
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-8000-000000000001',
   'O3 Fix One 4490', 'o3-fix-one-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900f31-0000-4000-9000-0000000000a1', '44900f31-0000-4000-9000-000000000010', 'o3f1a', 'Palm Kitchen F1',
   6.45, 3.40, 'restaurant', 'verified', 'NG'),
  ('44900f31-0000-4000-9000-0000000000b1', '44900f31-0000-4000-9000-000000000010', 'o3f1b', 'Palm Bar F1',
   6.45, 3.41, 'restaurant', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900f31-0000-4000-a000-000000000002', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900f31-0000-4000-a000-000000000003', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44900f31-0000-4000-a000-000000000005', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-8000-000000000005', 'venue_staff', now()),
  ('44900f31-0000-4000-a000-000000000006', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-8000-000000000006', 'venue_staff', now()),
  ('44900f31-0000-4000-a000-000000000007', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-8000-000000000007', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900f31-0000-4000-a000-000000000002', '44900f31-0000-4000-9000-0000000000a1', 'kitchen_bar', ARRAY['venue.kitchen']),
  ('44900f31-0000-4000-a000-000000000003', '44900f31-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900f31-0000-4000-a000-000000000005', '44900f31-0000-4000-9000-0000000000a1', 'till_device',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  ('44900f31-0000-4000-a000-000000000006', '44900f31-0000-4000-9000-0000000000b1', 'kitchen_bar', ARRAY['venue.kitchen']),
  ('44900f31-0000-4000-a000-000000000007', '44900f31-0000-4000-9000-0000000000a1', 'custom', ARRAY['restaurant.manage_orders']);

-- Menu at A: Jollof (kitchen), Chapman (bar).
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900f31-0000-4000-b000-000000000001', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-9000-0000000000a1', 'Dinner', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available, prep_station) VALUES
  ('44900f31-0000-4000-b000-000000000011', '44900f31-0000-4000-b000-000000000001', '44900f31-0000-4000-9000-000000000010', 'Jollof', 650000, 'NGN', true, 'kitchen'),
  ('44900f31-0000-4000-b000-000000000012', '44900f31-0000-4000-b000-000000000001', '44900f31-0000-4000-9000-000000000010', 'Chapman', 350000, 'NGN', true, 'bar');
INSERT INTO public.qr_spots (id, brand_id, venue_id, kind, label, serving_venue_id, code) VALUES
  ('44900f31-0000-4000-b000-000000000021', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-9000-0000000000a1',
   'custom', 'Table 6', '44900f31-0000-4000-9000-0000000000a1', 't4490f1t6'),
  ('44900f31-0000-4000-b000-000000000022', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-9000-0000000000b1',
   'custom', 'Bar 2', '44900f31-0000-4000-9000-0000000000b1', 't4490f1b2');
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900f31-0000-4000-9000-0000000000a1', '44900f31-0000-4000-9000-000000000010', 0)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 0;

SELECT public.t4490o3f_as('44900f31-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900f31-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'o3f1-menu-on-a1');
SELECT public.issue_4490_set_venue_feature('44900f31-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'o3f1-till-on-a1');
SELECT public.issue_4490_set_venue_feature('44900f31-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'o3f1-ks-on-a01');
SELECT public.issue_4490_set_venue_feature('44900f31-0000-4000-9000-0000000000b1', 'menu', true, NULL, NULL, NULL, 'o3f1-menu-on-b1');
SELECT public.issue_4490_set_venue_feature('44900f31-0000-4000-9000-0000000000b1', 'till', true, NULL, NULL, NULL, 'o3f1-till-on-b1');
SELECT public.t4490o3f_reset();

-- One session per venue carries the generated rows.
INSERT INTO public.venue_order_sessions (id, brand_id, venue_id, currency) VALUES
  ('44900f31-0000-4000-c000-0000000000a1', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-9000-0000000000a1', 'NGN'),
  ('44900f31-0000-4000-c000-0000000000b1', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-9000-0000000000b1', 'NGN');

-- A guest QR order at a table, Mingla money, with the given items.
CREATE FUNCTION public.t4490o3f_guest(p_venue uuid, p_items uuid[], p_paid boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_session uuid;
  v_order uuid := gen_random_uuid();
  v_item uuid;
  v_n integer := 0;
  v_sub integer := 0;
BEGIN
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
  VALUES ('44900f31-0000-4000-9000-000000000010', p_venue, 'NGN') RETURNING id INTO v_session;
  SELECT COALESCE(sum(mi.price_cents), 0) INTO v_sub FROM public.menu_items mi WHERE mi.id = ANY (p_items);
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, pickup_code, buyer_name, buyer_email, buyer_phone_e164,
    money_path, provider, currency, subtotal_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, confirmed_at
  ) VALUES (
    v_order, v_session, '44900f31-0000-4000-9000-000000000010', p_venue, 'guest_page',
    (nextval('public.t4490o3f_pickup')::int)::text, 'Tolu', 'tolu@example.test', '+2348031234567',
    'mingla', 'paystack', 'NGN', v_sub, 0, 0, 0, 0, 0, false, false, false,
    v_sub, v_sub, CASE WHEN p_paid THEN 'paid' ELSE 'pending' END, 'placed', 'guest-f1:' || v_order,
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
CREATE FUNCTION public.t4490o3f_round(p_sale uuid, p_actor uuid, p_items uuid[])
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
    CASE WHEN v_sale.qr_spot_id IS NULL THEN (nextval('public.t4490o3f_pickup')::int)::text END,
    'venue_collected', 'NGN', v_sub, v_sub, 0, 0, 0, 0, 0, 0, false, false, false,
    v_sub, v_sub, 'pending', 'held', 'till-round-f1:' || v_order,
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

-- The 20270319001846 scan body as it was (read-only, the reference), and the
-- rows of a sent, unaccepted Till round in the shape the Till leaves them.
CREATE FUNCTION public.t4490o3f_old_scan(p_now timestamptz, p_limit int)
RETURNS TABLE (order_id uuid, rung smallint, placed_at timestamptz, unacked_seconds int)
LANGUAGE sql AS $f$
  SELECT o.id,
         (CASE WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '10 minutes' THEN 3
               WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '5 minutes' THEN 2
               ELSE 1 END)::smallint,
         coalesce(o.confirmed_at, o.created_at),
         extract(epoch FROM (p_now - coalesce(o.confirmed_at, o.created_at)))::int
  FROM public.venue_orders o
  WHERE o.acknowledged_at IS NULL AND o.fulfillment_status = 'placed' AND o.payment_status = 'paid'
    AND o.money_path = 'mingla'
    AND p_now - coalesce(o.confirmed_at, o.created_at) >= interval '2 minutes'
    AND o.escalation_level < CASE
          WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '10 minutes' THEN 3
          WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '5 minutes' THEN 2
          ELSE 1 END
  ORDER BY coalesce(o.confirmed_at, o.created_at), o.id
  LIMIT greatest(1, coalesce(p_limit, 50))
$f$;
CREATE FUNCTION public.t4490o3f_till_rows(p_venue uuid, p_session uuid, p_n int, p_sent_from timestamptz, p_tag text, p_code_from int)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, source, taken_by_user_id, money_path, currency,
    subtotal_cents, service_charge_bps, service_charge_cents, tip_cents, effective_take_rate_bps, service_fee_bps,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, total_cents, payment_status,
    fulfillment_status, idempotency_key, created_at, sent_at, pickup_code, metadata)
  SELECT p_session, '44900f31-0000-4000-9000-000000000010', p_venue, 'staff', '44900f31-0000-4000-8000-000000000003',
    'venue_collected', 'NGN', 1000, 0, 0, 0, 0, 0, false, false, false, 1000, 1000, 'pending',
    'placed', 'f1-till-' || p_tag || '-' || g, p_sent_from - g * interval '1 second', p_sent_from - g * interval '1 second',
    (p_code_from + g)::text, jsonb_build_object('unsettled_staff_order', true, 'till_sale_id', gen_random_uuid())
  FROM generate_series(1, p_n) g;
$f$;

-- ===========================================================================
-- F1-T2 the floor list is behind the release switch AND the venue's screens.
-- ===========================================================================
SELECT public.t4490o3f_service();
SELECT public.t4490o3f_ok(public.issue_4490_venue_floor_user_ids('44900f31-0000-4000-9000-000000000010',
    '44900f31-0000-4000-9000-0000000000a1', ARRAY['venue.kitchen', 'restaurant.manage_orders']) = '{}'::uuid[],
  'F1-T2a VENUE_TILL off: nobody extra is told at A (kitchen screens on there), so a guest order tells the brand roles only');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_TILL';
SELECT public.t4490o3f_ok(public.issue_4490_venue_floor_user_ids('44900f31-0000-4000-9000-000000000010',
    '44900f31-0000-4000-9000-0000000000b1', ARRAY['venue.kitchen', 'restaurant.manage_orders']) = '{}'::uuid[],
  'F1-T2b VENUE_TILL on but kitchen screens off at B: B''s kitchen login is not told');
SELECT public.t4490o3f_ok(public.issue_4490_venue_floor_user_ids('44900f31-0000-4000-9000-000000000010',
    '44900f31-0000-4000-9000-0000000000a1', ARRAY['venue.kitchen', 'restaurant.manage_orders'])
  = ARRAY['44900f31-0000-4000-8000-000000000002', '44900f31-0000-4000-8000-000000000005',
          '44900f31-0000-4000-8000-000000000007']::uuid[],
  'F1-T2c VENUE_TILL on and kitchen screens on at A: the kitchen login, the Till device and the orders manager');
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'VENUE_TILL';
SELECT public.t4490o3f_ok(cardinality(public.issue_4490_venue_floor_user_ids('44900f31-0000-4000-9000-000000000010',
    '44900f31-0000-4000-9000-0000000000a1', ARRAY['venue.kitchen', 'restaurant.manage_orders'])) = 0,
  'F1-T2d switched off again: empty again');
SELECT public.t4490o3f_ok(NOT has_function_privilege('authenticated', 'public.issue_4490_venue_floor_user_ids(uuid,uuid,text[])', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_venue_floor_user_ids(uuid,uuid,text[])', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4490_station_screened(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_station_screened(uuid,text)', 'EXECUTE'),
  'F1-T2e the floor list and the screen check stay internal');
SELECT public.t4490o3f_reset();

-- ===========================================================================
-- F1-T1 the escalation scan: guest slots are never taken by Till rounds.
-- ===========================================================================
-- Adversarial guest-side fixture at A (and B): every combination of money path,
-- payment, fulfilment, age, confirmed_at and escalation level that the Mingla
-- arm reads. Rows that are due are much younger than the Till backlog below.
INSERT INTO public.venue_orders (
  session_id, brand_id, venue_id, source, qr_spot_id, money_path, provider, currency,
  subtotal_cents, service_charge_bps, service_charge_cents, tip_cents, effective_take_rate_bps, service_fee_bps,
  pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, total_cents, buyer_name, buyer_email,
  buyer_phone_e164, payment_status, fulfillment_status, acknowledged_at, acknowledged_by_user_id,
  escalation_level, idempotency_key, created_at, confirmed_at)
SELECT CASE WHEN x.n = 1 THEN '44900f31-0000-4000-c000-0000000000a1'::uuid ELSE '44900f31-0000-4000-c000-0000000000b1'::uuid END,
  '44900f31-0000-4000-9000-000000000010',
  CASE WHEN x.n = 1 THEN '44900f31-0000-4000-9000-0000000000a1'::uuid ELSE '44900f31-0000-4000-9000-0000000000b1'::uuid END,
  'guest_qr',
  CASE WHEN x.n = 1 THEN '44900f31-0000-4000-b000-000000000021'::uuid ELSE '44900f31-0000-4000-b000-000000000022'::uuid END,
  x.p, CASE WHEN x.p = 'mingla' THEN 'paystack' END, 'NGN', 1000, 0, 0, 0, 0, 0, false, false, false, 1000, 1000,
  'Guest', 'guest@example.test', '+2348031234567', x.ps, x.fs,
  CASE WHEN x.fs IN ('acknowledged', 'in_progress') THEN now() - interval '1 minute' END,
  CASE WHEN x.fs IN ('acknowledged', 'in_progress') THEN '44900f31-0000-4000-8000-000000000001'::uuid END,
  x.l, 'f1-guest-' || x.rn,
  -- Every clock distinct (a microsecond apart) so a limit never cuts a tie;
  -- the boundary ages (119/120, 299/300, 599/600 s) keep their side.
  now() - x.a * interval '1 second' - x.rn * interval '1 microsecond'
    - CASE WHEN x.c = 'early' THEN interval '30 minutes' ELSE interval '0' END,
  CASE x.c WHEN 'null' THEN NULL ELSE now() - x.a * interval '1 second' - x.rn * interval '1 microsecond' END
FROM (
  SELECT v.n, mp.p, ps.s AS ps, fs.s AS fs, ag.a, cf.c, lv.l, row_number() OVER () AS rn
  FROM (VALUES (1), (2)) v(n)
  CROSS JOIN (VALUES ('mingla'), ('venue_collected')) mp(p)
  CROSS JOIN (VALUES ('paid'), ('pending'), ('refunded')) ps(s)
  CROSS JOIN (VALUES ('placed'), ('acknowledged'), ('in_progress'), ('cancelled')) fs(s)
  CROSS JOIN (VALUES (30), (119), (120), (299), (300), (599), (600), (10800), (259200)) ag(a)
  CROSS JOIN (VALUES ('same'), ('early'), ('null')) cf(c)
  CROSS JOIN (VALUES (0), (1), (2), (3)) lv(l)
) x;
-- 60 more due guest orders (Mingla money, paid, 3 to 4 minutes old) so the
-- default limit of 50 is contended.
INSERT INTO public.venue_orders (
  session_id, brand_id, venue_id, source, qr_spot_id, money_path, provider, currency,
  subtotal_cents, service_charge_bps, service_charge_cents, tip_cents, effective_take_rate_bps, service_fee_bps,
  pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, total_cents, buyer_name, buyer_email,
  buyer_phone_e164, payment_status, fulfillment_status, idempotency_key, created_at, confirmed_at)
SELECT '44900f31-0000-4000-c000-0000000000a1', '44900f31-0000-4000-9000-000000000010', '44900f31-0000-4000-9000-0000000000a1',
  'guest_qr', '44900f31-0000-4000-b000-000000000021', 'mingla', 'paystack', 'NGN', 1000, 0, 0, 0, 0, 0, false, false, false,
  1000, 1000, 'Guest', 'guest@example.test', '+2348031234567', 'paid', 'placed', 'f1-due-' || g,
  now() - interval '1 hour', now() - interval '3 minutes' - g * interval '1 second'
FROM generate_series(1, 60) g;
-- 200 due Till rounds at A, sent 3 to 4 hours ago (older than every guest order).
SELECT public.t4490o3f_till_rows('44900f31-0000-4000-9000-0000000000a1', '44900f31-0000-4000-c000-0000000000a1',
  200, now() - interval '3 hours', 'backlog', 300);
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_TILL';

SAVEPOINT f1_scan;
CREATE TEMP TABLE t4490o3f_old50 ON COMMIT DROP AS SELECT * FROM public.t4490o3f_old_scan(now(), 50);
CREATE TEMP TABLE t4490o3f_new50 ON COMMIT DROP AS
  SELECT s.*, o.money_path, x.ord FROM public.pg_venue_order_escalation_scan(now(), 50) WITH ORDINALITY x(
    order_id, brand_id, venue_id, venue_name, rung, spot_label, pickup_code, buyer_name, currency, total_cents,
    placed_at, unacked_seconds, ord)
  CROSS JOIN LATERAL (SELECT x.order_id, x.rung, x.placed_at, x.unacked_seconds) s
  JOIN public.venue_orders o ON o.id = x.order_id;
SELECT public.t4490o3f_ok((SELECT count(*) FROM t4490o3f_old50) = 50
    AND (SELECT count(*) FROM t4490o3f_new50 WHERE money_path = 'mingla') = 50
    AND NOT EXISTS (SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_old50
                    EXCEPT SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_new50 WHERE money_path = 'mingla')
    AND NOT EXISTS (SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_new50 WHERE money_path = 'mingla'
                    EXCEPT SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_old50),
  'F1-T1a with 200 due Till rounds waiting, the default limit still gives all 50 guest slots to the same 50 rows the 1846 body returns (id, rung, clock, seconds)');
SELECT public.t4490o3f_ok((SELECT count(*) FROM t4490o3f_new50 WHERE money_path = 'venue_collected') = 50
    AND (SELECT max(ord) FROM t4490o3f_new50 WHERE money_path = 'mingla')
        < (SELECT min(ord) FROM t4490o3f_new50 WHERE money_path = 'venue_collected'),
  'F1-T1b the Till arm has its own 50 (same size) and its rows come after every guest row');
SELECT public.t4490o3f_ok(NOT EXISTS (SELECT 1 FROM t4490o3f_new50 WHERE money_path = 'venue_collected' AND rung <> 1),
  'F1-T1c Till rounds 3 hours old that first become due start at rung 1, never the last rung');
ROLLBACK TO SAVEPOINT f1_scan;

-- The same comparison unlimited, on the whole adversarial fixture.
SAVEPOINT f1_scan_all;
CREATE TEMP TABLE t4490o3f_oldall ON COMMIT DROP AS SELECT * FROM public.t4490o3f_old_scan(now(), 100000);
CREATE TEMP TABLE t4490o3f_newall ON COMMIT DROP AS
  SELECT s.order_id, s.rung, s.placed_at, s.unacked_seconds, o.money_path
  FROM public.pg_venue_order_escalation_scan(now(), 100000) s JOIN public.venue_orders o ON o.id = s.order_id;
SELECT public.t4490o3f_ok((SELECT count(*) FROM t4490o3f_oldall) > 60
    AND NOT EXISTS (SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_oldall
                    EXCEPT SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_newall WHERE money_path = 'mingla')
    AND NOT EXISTS (SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_newall WHERE money_path = 'mingla'
                    EXCEPT SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_oldall)
    AND (SELECT count(*) FROM t4490o3f_newall WHERE money_path = 'venue_collected') = 200,
  'F1-T1d unlimited: every guest row identical to the 1846 body on the adversarial fixture; no venue-collected guest row; the 200 Till rounds');
ROLLBACK TO SAVEPOINT f1_scan_all;

-- Switch off: no Till rows, guest rows unchanged.
SAVEPOINT f1_scan_off;
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'VENUE_TILL';
CREATE TEMP TABLE t4490o3f_oldoff ON COMMIT DROP AS SELECT * FROM public.t4490o3f_old_scan(now(), 50);
CREATE TEMP TABLE t4490o3f_newoff ON COMMIT DROP AS
  SELECT s.order_id, s.rung, s.placed_at, s.unacked_seconds, o.money_path
  FROM public.pg_venue_order_escalation_scan(now(), 50) s JOIN public.venue_orders o ON o.id = s.order_id;
SELECT public.t4490o3f_ok(NOT EXISTS (SELECT 1 FROM t4490o3f_newoff WHERE money_path = 'venue_collected')
    AND NOT EXISTS (SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_oldoff
                    EXCEPT SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_newoff)
    AND NOT EXISTS (SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_newoff
                    EXCEPT SELECT order_id, rung, placed_at, unacked_seconds FROM t4490o3f_oldoff),
  'F1-T1e VENUE_TILL off: the Till arm returns nothing; the scan is the 1846 scan');
ROLLBACK TO SAVEPOINT f1_scan_off;

-- Age cap and one rung per scan, on two rounds of their own (F1-T1f's scan
-- is the one that first claims the young round).
DELETE FROM public.venue_orders WHERE idempotency_key LIKE 'f1-till-backlog-%';
SELECT public.t4490o3f_till_rows('44900f31-0000-4000-9000-0000000000a1', '44900f31-0000-4000-c000-0000000000a1',
  1, now() - interval '6 hours', 'old', 600);
SELECT public.t4490o3f_till_rows('44900f31-0000-4000-9000-0000000000a1', '44900f31-0000-4000-c000-0000000000a1',
  1, now() - interval '5 hours 58 minutes', 'young', 610);
INSERT INTO t4490o3f_ids SELECT 'old', id FROM public.venue_orders WHERE idempotency_key = 'f1-till-old-1';
INSERT INTO t4490o3f_ids SELECT 'young', id FROM public.venue_orders WHERE idempotency_key = 'f1-till-young-1';
SELECT public.t4490o3f_ok(NOT EXISTS (SELECT 1 FROM public.pg_venue_order_escalation_scan(now(), 1000) s
                                      WHERE s.order_id = public.t4490o3f_id('old'))
    AND (SELECT escalation_level FROM public.venue_orders WHERE id = public.t4490o3f_id('old')) = 0,
  'F1-T1f a Till round sent more than 6 hours ago never escalates');
SELECT public.t4490o3f_ok((SELECT escalation_level FROM public.venue_orders WHERE id = public.t4490o3f_id('young')) = 1
    AND NOT EXISTS (SELECT 1 FROM public.pg_venue_order_escalation_scan(now(), 1000) s
                    WHERE s.order_id = public.t4490o3f_id('young')),
  'F1-T1g a round 5 h 58 min old went to rung 1 in that scan (not 3), and the same minute pages it once');
SELECT public.t4490o3f_ok((SELECT s.rung FROM public.pg_venue_order_escalation_scan(now() + interval '1 second', 1000) s
                           WHERE s.order_id = public.t4490o3f_id('young')) = 2
    AND (SELECT s.rung FROM public.pg_venue_order_escalation_scan(now() + interval '2 seconds', 1000) s
         WHERE s.order_id = public.t4490o3f_id('young')) = 3
    AND NOT EXISTS (SELECT 1 FROM public.pg_venue_order_escalation_scan(now() + interval '3 seconds', 1000) s
                    WHERE s.order_id = public.t4490o3f_id('young')),
  'F1-T1h then one rung per scan: 2, then 3, then the ladder stops');
-- Kitchen screens off at a venue: its rounds never escalate.
SELECT public.t4490o3f_till_rows('44900f31-0000-4000-9000-0000000000b1', '44900f31-0000-4000-c000-0000000000b1',
  3, now() - interval '3 minutes', 'atb', 700);
SELECT public.t4490o3f_ok(NOT EXISTS (SELECT 1 FROM public.pg_venue_order_escalation_scan(now(), 1000) s
                                      JOIN public.venue_orders o ON o.id = s.order_id
                                      WHERE o.idempotency_key LIKE 'f1-till-atb-%'),
  'F1-T1i kitchen screens off at B: B''s sent rounds never escalate (VENUE_TILL on)');
SELECT public.t4490o3f_ok(NOT has_function_privilege('authenticated', 'public.pg_venue_order_escalation_scan(timestamptz,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.pg_venue_order_escalation_scan(timestamptz,integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.pg_venue_order_escalation_scan(timestamptz,integer)', 'EXECUTE'),
  'F1-T1j the scan keeps its service-role-only grant');
-- Out of every later scan and board (and their pickup codes free again).
UPDATE public.venue_orders SET fulfillment_status = 'cancelled', cancelled_at = now() - interval '1 hour'
WHERE idempotency_key LIKE 'f1-%' AND fulfillment_status NOT IN ('cancelled', 'delivered');

-- ===========================================================================
-- F1-T3 voiding a station's last live line finishes the order.
-- ===========================================================================
SELECT public.t4490o3f_service();
INSERT INTO t4490o3f_ids
SELECT 'sale', (public.issue_4490_till_open('44900f31-0000-4000-9000-0000000000a1',
  '44900f31-0000-4000-8000-000000000003', NULL, 'Kemi', NULL, 'f1-sale-kemi-00001')->>'id')::uuid;
INSERT INTO t4490o3f_ids VALUES ('r1', public.t4490o3f_round(public.t4490o3f_id('sale'), '44900f31-0000-4000-8000-000000000003',
  ARRAY['44900f31-0000-4000-b000-000000000011', '44900f31-0000-4000-b000-000000000012']::uuid[]));
SELECT public.issue_4490_till_send(public.t4490o3f_id('sale'), '44900f31-0000-4000-8000-000000000003');
SELECT public.issue_4490_station_ticket_ready(public.t4490o3f_id('r1'), 'kitchen', '44900f31-0000-4000-8000-000000000002');
SELECT public.issue_4490_order_picked_up(public.t4490o3f_id('r1'), 'kitchen', '44900f31-0000-4000-8000-000000000003');
SELECT public.t4490o3f_ok((SELECT fulfillment_status FROM public.venue_orders WHERE id = public.t4490o3f_id('r1')) = 'in_progress',
  'F1-T3a before: the kitchen part was picked up, the bar part waits, the order is in progress');
SELECT public.issue_4490_till_void(public.t4490o3f_id('sale'), NULL,
  (SELECT i.id FROM public.venue_order_items i WHERE i.venue_order_id = public.t4490o3f_id('r1') AND i.station = 'bar'),
  '44900f31-0000-4000-8000-000000000001', 'guest_changed_mind', false, NULL);
SELECT public.t4490o3f_ok((SELECT fulfillment_status = 'delivered' AND delivered_at IS NOT NULL AND ready_at IS NOT NULL
                           FROM public.venue_orders WHERE id = public.t4490o3f_id('r1')),
  'F1-T3b voiding the bar''s last line delivers the order (every station left was picked up)');
INSERT INTO t4490o3f_ids VALUES ('r2', public.t4490o3f_round(public.t4490o3f_id('sale'), '44900f31-0000-4000-8000-000000000003',
  ARRAY['44900f31-0000-4000-b000-000000000011', '44900f31-0000-4000-b000-000000000012']::uuid[]));
SELECT public.issue_4490_till_send(public.t4490o3f_id('sale'), '44900f31-0000-4000-8000-000000000003');
SELECT public.issue_4490_station_ticket_ready(public.t4490o3f_id('r2'), 'kitchen', '44900f31-0000-4000-8000-000000000002');
SELECT public.issue_4490_till_void(public.t4490o3f_id('sale'), NULL,
  (SELECT i.id FROM public.venue_order_items i WHERE i.venue_order_id = public.t4490o3f_id('r2') AND i.station = 'bar'),
  '44900f31-0000-4000-8000-000000000001', 'guest_changed_mind', false, NULL);
SELECT public.t4490o3f_ok((SELECT fulfillment_status FROM public.venue_orders WHERE id = public.t4490o3f_id('r2')) = 'ready',
  'F1-T3c kitchen ready but not picked up: voiding the bar''s last line makes the order ready (not delivered)');
SELECT public.issue_4490_order_picked_up(public.t4490o3f_id('r2'), 'kitchen', '44900f31-0000-4000-8000-000000000003');
SELECT public.t4490o3f_ok((SELECT fulfillment_status FROM public.venue_orders WHERE id = public.t4490o3f_id('r2')) = 'delivered',
  'F1-T3d and Picked up then delivers it');
INSERT INTO t4490o3f_ids VALUES ('r3', public.t4490o3f_round(public.t4490o3f_id('sale'), '44900f31-0000-4000-8000-000000000003',
  ARRAY['44900f31-0000-4000-b000-000000000011', '44900f31-0000-4000-b000-000000000012']::uuid[]));
SELECT public.issue_4490_till_send(public.t4490o3f_id('sale'), '44900f31-0000-4000-8000-000000000003');
SELECT public.issue_4490_till_void(public.t4490o3f_id('sale'), NULL,
  (SELECT i.id FROM public.venue_order_items i WHERE i.venue_order_id = public.t4490o3f_id('r3') AND i.station = 'bar'),
  '44900f31-0000-4000-8000-000000000001', 'guest_changed_mind', false, NULL);
SELECT public.t4490o3f_ok((SELECT fulfillment_status = 'placed' AND acknowledged_at IS NULL
                           FROM public.venue_orders WHERE id = public.t4490o3f_id('r3')),
  'F1-T3e a void on a round nobody accepted leaves it placed (nothing is acknowledged by a void)');

-- ===========================================================================
-- F1-T4 a print counts only under the PDF's rights.
-- ===========================================================================
INSERT INTO t4490o3f_ids VALUES ('G', public.t4490o3f_guest('44900f31-0000-4000-9000-0000000000a1',
  ARRAY['44900f31-0000-4000-b000-000000000011']::uuid[], true));
SELECT public.t4490o3f_expect(
  format($q$SELECT public.issue_4490_station_mark_printed(%L, 'kitchen', '44900f31-0000-4000-8000-000000000003')$q$,
         public.t4490o3f_id('G')),
  '42501', 'not_authorized', 'F1-T4a a seller cannot count a print on a guest order''s ticket (the PDF refuses them too)');
SELECT public.t4490o3f_expect(
  format($q$SELECT public.issue_4490_floor_pdf_source('kitchen_ticket', '44900f31-0000-4000-9000-0000000000a1', %L, 'kitchen', NULL, '44900f31-0000-4000-8000-000000000003')$q$,
         public.t4490o3f_id('G')),
  '42501', 'not_authorized', 'F1-T4b (the same seller is refused that guest ticket''s PDF)');
SELECT public.t4490o3f_ok(COALESCE((SELECT printed_count FROM public.venue_station_tickets
                                     WHERE venue_order_id = public.t4490o3f_id('G') AND station = 'kitchen'), 0) = 0,
  'F1-T4c the guest ticket''s count did not move');
SELECT public.issue_4490_station_mark_printed(public.t4490o3f_id('G'), 'kitchen', '44900f31-0000-4000-8000-000000000002');
SELECT public.issue_4490_station_mark_printed(public.t4490o3f_id('r3'), 'kitchen', '44900f31-0000-4000-8000-000000000003');
SELECT public.t4490o3f_ok((SELECT printed_count FROM public.venue_station_tickets
                           WHERE venue_order_id = public.t4490o3f_id('G') AND station = 'kitchen') = 1
    AND (SELECT printed_count FROM public.venue_station_tickets
         WHERE venue_order_id = public.t4490o3f_id('r3') AND station = 'kitchen') = 1,
  'F1-T4d the kitchen counts a guest ticket print; a seller counts a Till round print (T7 Print ticket)');

-- ===========================================================================
-- F1-T5 a guest order's part for a station with no screen never waits.
-- ===========================================================================
INSERT INTO t4490o3f_ids VALUES ('both', public.t4490o3f_guest('44900f31-0000-4000-9000-0000000000a1',
  ARRAY['44900f31-0000-4000-b000-000000000011', '44900f31-0000-4000-b000-000000000012']::uuid[], true));
SELECT public.issue_4490_station_ticket_ready(public.t4490o3f_id('both'), 'kitchen', '44900f31-0000-4000-8000-000000000002');
SELECT public.t4490o3f_ok((SELECT fulfillment_status FROM public.venue_orders WHERE id = public.t4490o3f_id('both')) = 'in_progress',
  'F1-T5a both stations screened (the default): kitchen ready alone leaves the guest order in progress (unchanged)');
SELECT public.t4490o3f_reset();
INSERT INTO public.venue_till_settings (venue_id, brand_id, screen_stations)
VALUES ('44900f31-0000-4000-9000-0000000000a1', '44900f31-0000-4000-9000-000000000010', ARRAY['kitchen'])
ON CONFLICT (venue_id) DO UPDATE SET screen_stations = ARRAY['kitchen'];
SELECT public.t4490o3f_service();
INSERT INTO t4490o3f_ids VALUES ('M', public.t4490o3f_guest('44900f31-0000-4000-9000-0000000000a1',
  ARRAY['44900f31-0000-4000-b000-000000000011', '44900f31-0000-4000-b000-000000000012']::uuid[], true));
INSERT INTO t4490o3f_ids VALUES ('N', public.t4490o3f_guest('44900f31-0000-4000-9000-0000000000a1',
  ARRAY['44900f31-0000-4000-b000-000000000012']::uuid[], true));
SELECT public.t4490o3f_ok(NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.issue_4490_station_board('44900f31-0000-4000-9000-0000000000a1', 'bar',
      '44900f31-0000-4000-8000-000000000002')->'tickets') t
    WHERE (t->>'orderId')::uuid IN (public.t4490o3f_id('M'), public.t4490o3f_id('N'))),
  'F1-T5b screens = Kitchen only: neither guest order''s drinks are on the bar board');
SELECT public.t4490o3f_ok(EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.issue_4490_station_board('44900f31-0000-4000-9000-0000000000a1', 'all',
      '44900f31-0000-4000-8000-000000000002')->'tickets') t
    WHERE (t->>'orderId')::uuid = public.t4490o3f_id('M') AND t->>'station' = 'kitchen')
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.issue_4490_station_board('44900f31-0000-4000-9000-0000000000a1', 'all',
      '44900f31-0000-4000-8000-000000000002')->'tickets') t
    WHERE (t->>'orderId')::uuid = public.t4490o3f_id('N') OR t->>'station' = 'bar' AND (t->>'orderId')::uuid = public.t4490o3f_id('M')),
  'F1-T5c the Everything board shows the food part only');
SELECT public.t4490o3f_expect(
  format($q$SELECT public.issue_4490_station_accept(%L, 'bar', '44900f31-0000-4000-8000-000000000002')$q$, public.t4490o3f_id('M')),
  'P0002', 'station_ticket_not_found', 'F1-T5d no station can act on the unscreened part');
SELECT public.issue_4490_station_ticket_ready(public.t4490o3f_id('M'), 'kitchen', '44900f31-0000-4000-8000-000000000002');
SELECT public.t4490o3f_ok((SELECT fulfillment_status = 'ready' AND ready_at IS NOT NULL
                           FROM public.venue_orders WHERE id = public.t4490o3f_id('M')),
  'F1-T5e kitchen ready: the guest order is Ready (every station with a screen is ready)');
SELECT public.issue_4490_order_picked_up(public.t4490o3f_id('M'), 'kitchen', '44900f31-0000-4000-8000-000000000003');
SELECT public.t4490o3f_ok((SELECT fulfillment_status = 'ready' AND delivered_at IS NULL
                           FROM public.venue_orders WHERE id = public.t4490o3f_id('M'))
    AND (SELECT prep_state FROM public.venue_order_items WHERE venue_order_id = public.t4490o3f_id('M') AND station = 'bar') = 'pending',
  'F1-T5f Picked up of the food never delivers the order and never marks the drinks served (nothing silently delivered)');
SELECT public.t4490o3f_expect(
  format($q$SELECT public.issue_4490_station_accept(%L, 'bar', '44900f31-0000-4000-8000-000000000002')$q$, public.t4490o3f_id('N')),
  'P0002', 'station_ticket_not_found', 'F1-T5g a guest order with no screened station is on no station');
SELECT public.t4490o3f_ok((SELECT fulfillment_status = 'placed' AND acknowledged_at IS NULL AND station_rev = 0
                           FROM public.venue_orders WHERE id = public.t4490o3f_id('N'))
    AND NOT EXISTS (SELECT 1 FROM public.venue_station_tickets WHERE venue_order_id = public.t4490o3f_id('N')),
  'F1-T5h and it stays exactly as today''s flow leaves it (placed, no ticket rows, no station change)');
-- Till rounds keep T8 as built: the bar part is cleared at send.
INSERT INTO t4490o3f_ids VALUES ('r4', public.t4490o3f_round(public.t4490o3f_id('sale'), '44900f31-0000-4000-8000-000000000003',
  ARRAY['44900f31-0000-4000-b000-000000000011', '44900f31-0000-4000-b000-000000000012']::uuid[]));
SELECT public.issue_4490_till_send(public.t4490o3f_id('sale'), '44900f31-0000-4000-8000-000000000003');
SELECT public.issue_4490_station_ticket_ready(public.t4490o3f_id('r4'), 'kitchen', '44900f31-0000-4000-8000-000000000002');
SELECT public.t4490o3f_ok((SELECT fulfillment_status FROM public.venue_orders WHERE id = public.t4490o3f_id('r4')) = 'ready'
    AND (SELECT prep_state FROM public.venue_order_items WHERE venue_order_id = public.t4490o3f_id('r4') AND station = 'bar') = 'served',
  'F1-T5i a Till round at the same venue is unchanged (bar cleared at send; kitchen ready makes it ready)');
SELECT public.t4490o3f_reset();

ROLLBACK;
