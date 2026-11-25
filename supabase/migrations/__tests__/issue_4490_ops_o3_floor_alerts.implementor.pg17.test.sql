-- #4490 spec 08 O3 part A2: executable PostgreSQL 17 proof for floor alerts
-- (migration 20281203604490): T4 floor staff at one venue, the Till's round state
-- (sent, accepted, station tickets), T7 escalation of a sent Till round nobody
-- accepted (the Mingla-money arm returns exactly the rows it returned before),
-- and a seller printing a Till round's ticket. The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-ROUND-ESCALATES-ONLY-WHEN-SENT | issue #4490 | pg_venue_order_escalation_scan pages about a venue-collected staff round only once it was sent from the Till and nobody accepted it; a held round, a delivered (no-screen) round and an order-pad round (no sent_at) never escalate, and the Mingla-money arm is unchanged.
--
-- FAILS-ON-REVERT: without 20281203604490 the first call fails (no issue_4490_venue_floor_user_ids).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490a2_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490A2 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490a2_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490A2 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490A2 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490a2_as(p_user uuid)
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
CREATE FUNCTION public.t4490a2_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490a2_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490a2_ok(boolean,text), public.t4490a2_expect(text,text,text,text),
  public.t4490a2_as(uuid), public.t4490a2_service(), public.t4490a2_reset() TO PUBLIC;

-- Pickup codes are unique per live order: hand them out in order, never at random.
CREATE SEQUENCE public.t4490a2_pickup START 701;
GRANT USAGE ON SEQUENCE public.t4490a2_pickup TO PUBLIC;
CREATE TEMP TABLE t4490a2_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490a2_ids TO PUBLIC;
CREATE FUNCTION public.t4490a2_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490a2_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490a2_id(text) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'VENUE_TILL';

-- Users: 01 owner, 02 kitchen at A, 03 seller (venue.sell only) at A, 04 check-in
-- only at A, 05 Till device at A, 06 kitchen at B only, 08 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900a00-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'al-a2-' || n || '@example.test', now(), now()
FROM generate_series(1, 8) n;
INSERT INTO public.creator_accounts (id, created_at, display_name) VALUES
  ('44900a00-0000-4000-8000-000000000001', now(), 'Owner O3'),
  ('44900a00-0000-4000-8000-000000000002', now(), 'Ifeanyi'),
  ('44900a00-0000-4000-8000-000000000003', now(), 'Ada'),
  ('44900a00-0000-4000-8000-000000000008', now(), 'Other Owner');
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900a00-0000-4000-9000-000000000010', '44900a00-0000-4000-8000-000000000001',
   'Alerts A2 4490', 'alerts-a2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900a00-0000-4000-9000-000000000020', '44900a00-0000-4000-8000-000000000008',
   'Alerts A2 Other 4490', 'alerts-a2-other-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900a00-0000-4000-9000-0000000000a1', '44900a00-0000-4000-9000-000000000010', 'sta2a', 'Palm Kitchen',
   6.45, 3.40, 'restaurant', 'verified', 'NG'),
  ('44900a00-0000-4000-9000-0000000000b1', '44900a00-0000-4000-9000-000000000010', 'sta2b', 'Palm Bar B',
   6.45, 3.41, 'restaurant', 'verified', 'NG'),
  ('44900a00-0000-4000-9000-0000000000c1', '44900a00-0000-4000-9000-000000000020', 'sta2c', 'Other Kitchen',
   6.46, 3.42, 'restaurant', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900a00-0000-4000-a000-000000000002', '44900a00-0000-4000-9000-000000000010', '44900a00-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900a00-0000-4000-a000-000000000003', '44900a00-0000-4000-9000-000000000010', '44900a00-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44900a00-0000-4000-a000-000000000004', '44900a00-0000-4000-9000-000000000010', '44900a00-0000-4000-8000-000000000004', 'venue_staff', now()),
  ('44900a00-0000-4000-a000-000000000005', '44900a00-0000-4000-9000-000000000010', '44900a00-0000-4000-8000-000000000005', 'venue_staff', now()),
  ('44900a00-0000-4000-a000-000000000006', '44900a00-0000-4000-9000-000000000010', '44900a00-0000-4000-8000-000000000006', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900a00-0000-4000-a000-000000000002', '44900a00-0000-4000-9000-0000000000a1', 'kitchen_bar', ARRAY['venue.kitchen']),
  ('44900a00-0000-4000-a000-000000000003', '44900a00-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900a00-0000-4000-a000-000000000004', '44900a00-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']),
  ('44900a00-0000-4000-a000-000000000005', '44900a00-0000-4000-9000-0000000000a1', 'till_device',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  ('44900a00-0000-4000-a000-000000000006', '44900a00-0000-4000-9000-0000000000b1', 'kitchen_bar', ARRAY['venue.kitchen']);

-- Menu: Jollof (kitchen), Chapman (bar), Water (no station -> the venue default).
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900a00-0000-4000-b000-000000000001', '44900a00-0000-4000-9000-000000000010', '44900a00-0000-4000-9000-0000000000a1', 'Dinner', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available, prep_station) VALUES
  ('44900a00-0000-4000-b000-000000000011', '44900a00-0000-4000-b000-000000000001', '44900a00-0000-4000-9000-000000000010', 'Jollof', 650000, 'NGN', true, 'kitchen'),
  ('44900a00-0000-4000-b000-000000000012', '44900a00-0000-4000-b000-000000000001', '44900a00-0000-4000-9000-000000000010', 'Chapman', 350000, 'NGN', true, 'bar'),
  ('44900a00-0000-4000-b000-000000000013', '44900a00-0000-4000-b000-000000000001', '44900a00-0000-4000-9000-000000000010', 'Water', 50000, 'NGN', true, NULL);
INSERT INTO public.qr_spots (id, brand_id, venue_id, kind, label, serving_venue_id, code) VALUES
  ('44900a00-0000-4000-b000-000000000021', '44900a00-0000-4000-9000-000000000010', '44900a00-0000-4000-9000-0000000000a1',
   'custom', 'Table 6', '44900a00-0000-4000-9000-0000000000a1', 't4490a2t6');
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900a00-0000-4000-9000-0000000000a1', '44900a00-0000-4000-9000-000000000010', 0)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 0;

SELECT public.t4490a2_as('44900a00-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900a00-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'a2-menu-on-a');
SELECT public.issue_4490_set_venue_feature('44900a00-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'a2-till-on-a');
SELECT public.issue_4490_set_venue_feature('44900a00-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'a2-ks-on-a1');
SELECT public.issue_4490_set_venue_feature('44900a00-0000-4000-9000-0000000000b1', 'menu', true, NULL, NULL, NULL, 'a2-menu-on-b');
SELECT public.issue_4490_set_venue_feature('44900a00-0000-4000-9000-0000000000b1', 'kitchen_screens', true, NULL, NULL, NULL, 'a2-ks-on-b1');
SELECT public.t4490a2_reset();

-- A paid guest page order (Mingla money, pickup code) with the given items.
CREATE FUNCTION public.t4490a2_guest(p_venue uuid, p_items uuid[], p_paid boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_session uuid;
  v_order uuid := gen_random_uuid();
  v_item uuid;
  v_n integer := 0;
  v_sub integer := 0;
BEGIN
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
  VALUES ('44900a00-0000-4000-9000-000000000010', p_venue, 'NGN') RETURNING id INTO v_session;
  SELECT COALESCE(sum(mi.price_cents), 0) INTO v_sub FROM public.menu_items mi WHERE mi.id = ANY (p_items);
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, pickup_code, buyer_name, buyer_email, buyer_phone_e164,
    money_path, provider, currency, subtotal_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, confirmed_at
  ) VALUES (
    v_order, v_session, '44900a00-0000-4000-9000-000000000010', p_venue, 'guest_page',
    (nextval('public.t4490a2_pickup')::int)::text, 'Tolu', 'tolu@example.test', '+2348031234567',
    'mingla', 'paystack', 'NGN', v_sub, 0, 0, 0, 0, 0, false, false, false,
    v_sub, v_sub, CASE WHEN p_paid THEN 'paid' ELSE 'pending' END, 'placed', 'guest-a2:' || v_order,
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
CREATE FUNCTION public.t4490a2_round(p_sale uuid, p_actor uuid, p_items uuid[])
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
    CASE WHEN v_sale.qr_spot_id IS NULL THEN (nextval('public.t4490a2_pickup')::int)::text END,
    'venue_collected', 'NGN', v_sub, v_sub, 0, 0, 0, 0, 0, 0, false, false, false,
    v_sub, v_sub, 'pending', 'held', 'till-round-a2:' || v_order,
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


-- Users from the stations fixture: 01 owner, 02 kitchen at A, 03 seller at A,
-- 04 check-in at A, 05 Till device at A, 06 kitchen at B, 08 other brand owner.
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_TILL';
-- A removed kitchen member at A never hears.
UPDATE public.brand_team_members SET removed_at = now() WHERE id = '44900a00-0000-4000-a000-000000000006';
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44900a00-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'al-a2-9@example.test', now(), now());
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900a00-0000-4000-a000-000000000009', '44900a00-0000-4000-9000-000000000010', '44900a00-0000-4000-8000-000000000009', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900a00-0000-4000-a000-000000000009', '44900a00-0000-4000-9000-0000000000b1', 'kitchen_bar', ARRAY['venue.kitchen']);

-- ===========================================================================
-- FA-1 T4: floor staff at one venue.
-- ===========================================================================
SELECT public.t4490a2_service();
SELECT public.t4490a2_ok(public.issue_4490_venue_floor_user_ids('44900a00-0000-4000-9000-000000000010',
    '44900a00-0000-4000-9000-0000000000a1', ARRAY['venue.kitchen', 'restaurant.manage_orders'])
  = ARRAY['44900a00-0000-4000-8000-000000000002', '44900a00-0000-4000-8000-000000000005']::uuid[],
  'FA-1a venue A: the Kitchen / bar login and the Till device (never the seller, check-in staff or brand roles)');
SELECT public.t4490a2_ok(public.issue_4490_venue_floor_user_ids('44900a00-0000-4000-9000-000000000010',
    '44900a00-0000-4000-9000-0000000000b1', ARRAY['venue.kitchen', 'restaurant.manage_orders'])
  = ARRAY['44900a00-0000-4000-8000-000000000009']::uuid[],
  'FA-1b venue B: only B''s kitchen login (the same profile at A is not B''s; a removed member is gone)');
SELECT public.t4490a2_ok(cardinality(public.issue_4490_venue_floor_user_ids('44900a00-0000-4000-9000-000000000020',
    '44900a00-0000-4000-9000-0000000000a1', ARRAY['venue.kitchen'])) = 0,
  'FA-1c another brand id never lists this brand''s venue staff');
SELECT public.t4490a2_ok(NOT has_function_privilege('authenticated', 'public.issue_4490_venue_floor_user_ids(uuid,uuid,text[])', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_venue_floor_user_ids(uuid,uuid,text[])', 'EXECUTE'),
  'FA-1d the floor list is internal');
SELECT public.t4490a2_ok(EXISTS (SELECT 1 FROM public.notification_categories c WHERE c.key = 'business.venue_order_ready'
    AND c.default_channels = ARRAY['inapp', 'push'] AND c.is_transactional AND c.active),
  'FA-2 business.venue_order_ready is registered like business.venue_order_placed');

-- ===========================================================================
-- FA-3 the Till's check carries each round's sent / accepted / ready state.
-- ===========================================================================
INSERT INTO t4490a2_ids
SELECT 'sale', (public.issue_4490_till_open('44900a00-0000-4000-9000-0000000000a1',
  '44900a00-0000-4000-8000-000000000003', NULL, 'Kemi', NULL, 'a2-sale-kemi-0001')->>'id')::uuid;
INSERT INTO t4490a2_ids VALUES ('round', public.t4490a2_round(public.t4490a2_id('sale'), '44900a00-0000-4000-8000-000000000003',
  ARRAY['44900a00-0000-4000-b000-000000000011', '44900a00-0000-4000-b000-000000000012']::uuid[]));
SELECT public.t4490a2_ok((SELECT (l->>'sentAt') IS NULL FROM jsonb_array_elements(public.issue_4490_till_sale_projection(public.t4490a2_id('sale'))->'lines') l),
  'FA-3a a held round has no sent time');
SELECT public.issue_4490_till_send(public.t4490a2_id('sale'), '44900a00-0000-4000-8000-000000000003');
SELECT public.t4490a2_ok((SELECT (l->>'sentAt') IS NOT NULL AND (l->>'acknowledgedAt') IS NULL
                                 AND jsonb_array_length(l->'stationTickets') = 2
                          FROM jsonb_array_elements(public.issue_4490_till_sale_projection(public.t4490a2_id('sale'))->'lines') l),
  'FA-3b once sent: sent time, not accepted, one entry per station with lines');
SELECT public.issue_4490_station_ticket_ready(public.t4490a2_id('round'), 'kitchen', '44900a00-0000-4000-8000-000000000002');
SELECT public.t4490a2_ok((SELECT (t->>'readyAt') IS NOT NULL AND (t->>'pickedUpAt') IS NULL
                          FROM jsonb_array_elements(public.issue_4490_till_sale_projection(public.t4490a2_id('sale'))->'lines') l,
                               jsonb_array_elements(l->'stationTickets') t WHERE t->>'station' = 'kitchen'),
  'FA-3c the kitchen ticket reads ready (and not picked up) on the Till');

-- ===========================================================================
-- FA-4 T7: escalation of sent Till rounds; the Mingla arm unchanged.
-- ===========================================================================
-- Rounds: sent unaccepted (S), held (H), accepted (A), a no-screen delivered one
-- (D), an order-pad round with no sent_at (P); a paid guest order (G) and an
-- unpaid one (U).
INSERT INTO t4490a2_ids
SELECT 'sale2', (public.issue_4490_till_open('44900a00-0000-4000-9000-0000000000a1',
  '44900a00-0000-4000-8000-000000000003', NULL, 'Ola', NULL, 'a2-sale-ola-00002')->>'id')::uuid;
INSERT INTO t4490a2_ids VALUES ('S', public.t4490a2_round(public.t4490a2_id('sale2'), '44900a00-0000-4000-8000-000000000003',
  ARRAY['44900a00-0000-4000-b000-000000000011']::uuid[]));
SELECT public.issue_4490_till_send(public.t4490a2_id('sale2'), '44900a00-0000-4000-8000-000000000003');
INSERT INTO t4490a2_ids VALUES ('H', public.t4490a2_round(public.t4490a2_id('sale2'), '44900a00-0000-4000-8000-000000000003',
  ARRAY['44900a00-0000-4000-b000-000000000011']::uuid[]));
INSERT INTO t4490a2_ids VALUES ('G', public.t4490a2_guest('44900a00-0000-4000-9000-0000000000a1',
  ARRAY['44900a00-0000-4000-b000-000000000011']::uuid[], true));
INSERT INTO t4490a2_ids VALUES ('U', public.t4490a2_guest('44900a00-0000-4000-9000-0000000000a1',
  ARRAY['44900a00-0000-4000-b000-000000000011']::uuid[], false));
SELECT public.t4490a2_reset();
-- An order-pad round (the legacy pad writes staff + venue_collected + placed, no sent_at).
INSERT INTO t4490a2_ids
SELECT 'P', o.id FROM public.venue_orders o WHERE o.id = public.t4490a2_id('H');
UPDATE public.venue_orders SET fulfillment_status = 'placed', sent_at = NULL WHERE id = public.t4490a2_id('H');
INSERT INTO t4490a2_ids VALUES ('H2', public.t4490a2_round(public.t4490a2_id('sale2'), '44900a00-0000-4000-8000-000000000003',
  ARRAY['44900a00-0000-4000-b000-000000000011']::uuid[]));
UPDATE public.venue_orders SET created_at = now() - interval '30 minutes', sent_at = now() - interval '3 minutes'
WHERE id = public.t4490a2_id('S');
UPDATE public.venue_orders SET created_at = now() - interval '30 minutes'
WHERE id IN (public.t4490a2_id('H2'), public.t4490a2_id('P'));
UPDATE public.venue_orders SET created_at = now() - interval '30 minutes', confirmed_at = now() - interval '3 minutes'
WHERE id IN (public.t4490a2_id('G'), public.t4490a2_id('U'));

-- The 1846 body as it was (the old arm), to compare rows on the same data.
CREATE FUNCTION public.t4490a2_old_scan(p_now timestamptz, p_limit int)
RETURNS TABLE (order_id uuid, rung smallint, placed_at timestamptz)
LANGUAGE sql AS $f$
  SELECT o.id,
         (CASE WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '10 minutes' THEN 3
               WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '5 minutes' THEN 2
               ELSE 1 END)::smallint,
         coalesce(o.confirmed_at, o.created_at)
  FROM public.venue_orders o
  WHERE o.acknowledged_at IS NULL AND o.fulfillment_status = 'placed' AND o.payment_status = 'paid'
    AND o.money_path = 'mingla'
    AND p_now - coalesce(o.confirmed_at, o.created_at) >= interval '2 minutes'
    AND o.escalation_level < CASE
          WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '10 minutes' THEN 3
          WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '5 minutes' THEN 2
          ELSE 1 END
  ORDER BY coalesce(o.confirmed_at, o.created_at)
  LIMIT greatest(1, coalesce(p_limit, 50))
$f$;
CREATE TEMP TABLE t4490a2_old ON COMMIT DROP AS SELECT * FROM public.t4490a2_old_scan(now(), 1000);
CREATE TEMP TABLE t4490a2_new ON COMMIT DROP AS
  SELECT s.order_id, s.rung, s.placed_at FROM public.pg_venue_order_escalation_scan(now(), 1000) s;
SELECT public.t4490a2_ok(NOT EXISTS (
    SELECT order_id, rung, placed_at FROM t4490a2_old
    EXCEPT SELECT n.order_id, n.rung, n.placed_at FROM t4490a2_new n
      JOIN public.venue_orders o ON o.id = n.order_id WHERE o.money_path = 'mingla')
  AND NOT EXISTS (
    SELECT n.order_id, n.rung, n.placed_at FROM t4490a2_new n
      JOIN public.venue_orders o ON o.id = n.order_id WHERE o.money_path = 'mingla'
    EXCEPT SELECT order_id, rung, placed_at FROM t4490a2_old)
  AND EXISTS (SELECT 1 FROM t4490a2_old WHERE order_id = public.t4490a2_id('G')),
  'FA-4a the Mingla-money arm returns exactly the rows the 1846 body returns (same rung and clock), incl. the paid guest order');
SELECT public.t4490a2_ok(EXISTS (SELECT 1 FROM t4490a2_new WHERE order_id = public.t4490a2_id('S') AND rung = 1),
  'FA-4b a sent Till round nobody accepted reaches rung 1 at 2 minutes (clock = sent)');
SELECT public.t4490a2_ok(NOT EXISTS (SELECT 1 FROM t4490a2_new WHERE order_id IN
    (public.t4490a2_id('H2'), public.t4490a2_id('P'), public.t4490a2_id('U'))),
  'FA-4c a held round, an order-pad round (no sent_at) and an unpaid guest checkout never escalate');
SELECT public.t4490a2_ok((SELECT escalation_level FROM public.venue_orders WHERE id = public.t4490a2_id('S')) = 1
    AND cardinality(ARRAY(SELECT order_id FROM public.pg_venue_order_escalation_scan(now(), 1000)
                          WHERE order_id = public.t4490a2_id('S'))) = 0,
  'FA-4d a rung is claimed once (a second scan in the same minute returns nothing for it)');
SELECT public.t4490a2_ok((SELECT rung FROM public.pg_venue_order_escalation_scan(now() + interval '3 minutes', 1000)
                          WHERE order_id = public.t4490a2_id('S')) = 2,
  'FA-4e the same rungs and timings: rung 2 from 5 minutes after it was sent');
-- Accepted / delivered rounds never escalate.
INSERT INTO t4490a2_ids VALUES ('A', public.t4490a2_round(public.t4490a2_id('sale2'), '44900a00-0000-4000-8000-000000000003',
  ARRAY['44900a00-0000-4000-b000-000000000011']::uuid[]));
SELECT public.t4490a2_service();
SELECT public.issue_4490_till_send(public.t4490a2_id('sale2'), '44900a00-0000-4000-8000-000000000003');
SELECT public.issue_4490_station_accept(public.t4490a2_id('A'), 'kitchen', '44900a00-0000-4000-8000-000000000002');
SELECT public.t4490a2_reset();
UPDATE public.venue_orders SET sent_at = now() - interval '4 minutes' WHERE id IN (public.t4490a2_id('A'), public.t4490a2_id('H2'));
CREATE TEMP TABLE t4490a2_scan2 ON COMMIT DROP AS
  SELECT s.order_id, s.rung FROM public.pg_venue_order_escalation_scan(now(), 1000) s;
SELECT public.t4490a2_ok(NOT EXISTS (SELECT 1 FROM t4490a2_scan2 WHERE order_id = public.t4490a2_id('A'))
    AND EXISTS (SELECT 1 FROM t4490a2_scan2 WHERE order_id = public.t4490a2_id('H2') AND rung = 1),
  'FA-4f an accepted round never escalates; a round sent later escalates from its own send');
-- A round for a station without a screen is delivered at send, so never escalates.
INSERT INTO public.venue_till_settings (venue_id, brand_id, screen_stations)
VALUES ('44900a00-0000-4000-9000-0000000000a1', '44900a00-0000-4000-9000-000000000010', ARRAY['bar'])
ON CONFLICT (venue_id) DO UPDATE SET screen_stations = ARRAY['bar'];
INSERT INTO t4490a2_ids VALUES ('D', public.t4490a2_round(public.t4490a2_id('sale2'), '44900a00-0000-4000-8000-000000000003',
  ARRAY['44900a00-0000-4000-b000-000000000011']::uuid[]));
SELECT public.t4490a2_service();
SELECT public.issue_4490_till_send(public.t4490a2_id('sale2'), '44900a00-0000-4000-8000-000000000003');
SELECT public.t4490a2_reset();
UPDATE public.venue_orders SET sent_at = now() - interval '4 minutes' WHERE id = public.t4490a2_id('D');
SELECT public.t4490a2_ok((SELECT fulfillment_status FROM public.venue_orders WHERE id = public.t4490a2_id('D')) = 'delivered'
    AND NOT EXISTS (SELECT 1 FROM public.pg_venue_order_escalation_scan(now(), 1000) s WHERE s.order_id = public.t4490a2_id('D')),
  'FA-4g a round for a station without a screen is delivered at send and never escalates');
SELECT public.t4490a2_ok(NOT has_function_privilege('authenticated', 'public.pg_venue_order_escalation_scan(timestamptz,integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.pg_venue_order_escalation_scan(timestamptz,integer)', 'EXECUTE'),
  'FA-4h the scan keeps its service-role-only grant');

-- ===========================================================================
-- FA-5 T7: a seller prints a Till round's ticket; not a guest order's.
-- ===========================================================================
SELECT public.t4490a2_service();
SELECT public.t4490a2_ok((public.issue_4490_floor_pdf_source('kitchen_ticket', '44900a00-0000-4000-9000-0000000000a1',
    public.t4490a2_id('S'), 'kitchen', NULL, '44900a00-0000-4000-8000-000000000003')->'ticket'->>'orderId')::uuid = public.t4490a2_id('S'),
  'FA-5a a seller prints the ticket of a Till round');
SELECT public.issue_4490_station_mark_printed(public.t4490a2_id('S'), 'kitchen', '44900a00-0000-4000-8000-000000000003');
SELECT public.t4490a2_ok((SELECT printed_count FROM public.venue_station_tickets WHERE venue_order_id = public.t4490a2_id('S') AND station = 'kitchen') = 1,
  'FA-5b and the print counts');
SELECT public.t4490a2_expect(
  format($q$SELECT public.issue_4490_floor_pdf_source('kitchen_ticket', '44900a00-0000-4000-9000-0000000000a1', %L, 'kitchen', NULL, '44900a00-0000-4000-8000-000000000003')$q$,
         public.t4490a2_id('G')),
  '42501', 'not_authorized', 'FA-5c a seller without kitchen rights still cannot print a guest order''s ticket');
SELECT public.t4490a2_expect(
  format($q$SELECT public.issue_4490_floor_pdf_source('kitchen_ticket', '44900a00-0000-4000-9000-0000000000a1', %L, 'kitchen', NULL, '44900a00-0000-4000-8000-000000000004')$q$,
         public.t4490a2_id('S')),
  '42501', 'not_authorized', 'FA-5d check-in-only staff cannot print a Till round');
SELECT public.t4490a2_reset();

ROLLBACK;
