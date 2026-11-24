-- #4490 spec 08 O5 part C: executable PostgreSQL 17 proof for migration
-- 20281203724490 (stock counts, the one orderable rule, stock taken on send
-- and on paid, sold out after payment and its way out, kitchen sold out).
-- The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-STOCK-NEVER-NEGATIVE | issue #4490 | menu_items.stock_count is never below zero: every decrement is one guarded statement (stock_count >= quantity) inside the caller's transaction; a Till send that finds too little raises PT409 item_sold_out and sends nothing; a paid guest order takes only what is left and is flagged sold_out_after_payment.
-- MINGLA-INVARIANT: I-4490-STOCK-ONE-ORDERABLE-RULE | issue #4490 | an item is orderable when is_available AND (stock_count IS NULL OR stock_count > 0) (issue_4490_menu_item_orderable); public_menus_view lists exactly the orderable items, public_menu_sold_out_view exactly the switched-on sold-out ones, and a NULL count changes nothing; sold out never flips is_available.
-- MINGLA-INVARIANT: I-4490-STOCK-ONLY-THE-STOCK-FUNCTIONS | issue #4490 | the stock columns of menu_items change only inside the #4490 stock functions (transaction-local mingla.issue_4490_stock naming the row, never as anon or authenticated); a direct write by a client role or the service role is refused stock_write_refused.
-- MINGLA-INVARIANT: I-4490-SOLD-OUT-NEVER-DROPPED | issue #4490 | a paid guest line the count could not cover is never refused and never dropped: it is flagged, then swapped (same station, same price or less, the difference refunded) or refunded, each exactly once; every money resolution is its own line refund on the order (08-O5 fix 1: never "one per order"), and together they never return more than the guest paid for those lines.
--
-- TEST-MOD-APPROVED #4490 (08-O5 fix 1): the SOLD-OUT-NEVER-DROPPED invariant no longer says "at most one
-- line refund per order" (the O5-T3 defect); K-8q/K-8r prove two refunds on one order (below).
-- FAILS-ON-REVERT (verified on a fresh replay): drop the guard trigger and
-- K-2a fails (a direct write changes the count); take the guard off the
-- send (stock_count >= quantity) and K-6b fails (the count goes below 0);
-- make finalize refuse a short paid order and K-9b fails; let a second
-- resolution through and K-10e fails.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t5c_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490K FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t5c_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490K FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490K FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
-- The error's DETAIL (item_sold_out carries the item and what is left).
CREATE FUNCTION public.t5c_detail(p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_detail text;
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN jsonb_build_object('state', SQLSTATE, 'message', SQLERRM) || COALESCE(NULLIF(v_detail, '')::jsonb, '{}'::jsonb);
  END;
  RETURN jsonb_build_object('state', 'none');
END
$f$;
CREATE FUNCTION public.t5c_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t5c_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t5c_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t5c_ok(boolean,text), public.t5c_expect(text,text,text,text),
  public.t5c_detail(text), public.t5c_as(uuid), public.t5c_service(), public.t5c_reset() TO PUBLIC;
CREATE TEMP TABLE t5c_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t5c_ids TO PUBLIC;
-- A write's answer, kept for the NEXT statement: a STABLE read in the same
-- statement as the write would see the statement's snapshot, not the write.
CREATE TEMP TABLE t5c_r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t5c_r TO PUBLIC;
CREATE FUNCTION public.t5c_rv(p_k text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT v FROM t5c_r WHERE k = p_k $f$;
GRANT EXECUTE ON FUNCTION public.t5c_rv(text) TO PUBLIC;
CREATE FUNCTION public.t5c_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t5c_ids WHERE k = p_k $f$;
GRANT EXECUTE ON FUNCTION public.t5c_id(text) TO PUBLIC;
CREATE FUNCTION public.t5c_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
CREATE FUNCTION public.t5c_stock(p_item uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT stock_count FROM public.menu_items WHERE id = p_item
$f$;
GRANT EXECUTE ON FUNCTION public.t5c_v(uuid), public.t5c_stock(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 03 menu manager (restaurant.manage_menu),
-- 04 kitchen (venue.kitchen), 05 a Till device login, 06 another brand's owner,
-- 07 an event manager, 08 door staff (venue.check_in only).
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900615-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-stock-' || n || '@example.test', now(), now()
FROM generate_series(1, 8) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900615-0000-4000-8000-000000000001', now()), ('44900615-0000-4000-8000-000000000006', now());
INSERT INTO public.profiles (id, display_name) VALUES
  ('44900615-0000-4000-8000-000000000004', 'Ifeanyi Kitchen')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900615-0000-4000-9000-000000000010', '44900615-0000-4000-8000-000000000001',
   'Till Stock 4490', 'till-stock-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900615-0000-4000-9000-000000000020', '44900615-0000-4000-8000-000000000006',
   'Other Stock 4490', 'other-stock-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900615-0000-4000-9000-0000000000a1', '44900615-0000-4000-9000-000000000010', 'tillstocka', 'Stock Kitchen',
   6.45, 3.40, 'restaurant', 'verified', 'NG'),
  ('44900615-0000-4000-9000-0000000000b1', '44900615-0000-4000-9000-000000000020', 'tillstockb', 'Other Kitchen',
   6.45, 3.40, 'restaurant', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900615-0000-4000-a000-000000000002', '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900615-0000-4000-a000-000000000003', '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44900615-0000-4000-a000-000000000004', '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-8000-000000000004', 'venue_staff', now()),
  ('44900615-0000-4000-a000-000000000005', '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-8000-000000000005', 'venue_staff', now()),
  ('44900615-0000-4000-a000-000000000007', '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-8000-000000000007', 'event_manager', now()),
  ('44900615-0000-4000-a000-000000000008', '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-8000-000000000008', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900615-0000-4000-a000-000000000002', '44900615-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900615-0000-4000-a000-000000000003', '44900615-0000-4000-9000-0000000000a1', 'custom', ARRAY['restaurant.manage_menu']),
  ('44900615-0000-4000-a000-000000000004', '44900615-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.kitchen']),
  ('44900615-0000-4000-a000-000000000005', '44900615-0000-4000-9000-0000000000a1', 'custom',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  ('44900615-0000-4000-a000-000000000008', '44900615-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900615-0000-4000-b000-000000000001', '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-9000-0000000000a1', 'Dinner', true),
  ('44900615-0000-4000-b000-000000000002', '44900615-0000-4000-9000-000000000020', '44900615-0000-4000-9000-0000000000b1', 'Other', true);
-- Jollof 5,000.00 kitchen · Soup 5,500.00 kitchen · Asun 4,000.00 kitchen ·
-- Croaker 18,500.00 kitchen · Chapman 3,000.00 bar · Rice 2,000.00 (never tracked).
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available, prep_station, sort_order) VALUES
  ('44900615-0000-4000-b000-000000000011', '44900615-0000-4000-b000-000000000001', '44900615-0000-4000-9000-000000000010', 'Jollof', 500000, 'NGN', true, 'kitchen', 1),
  ('44900615-0000-4000-b000-000000000012', '44900615-0000-4000-b000-000000000001', '44900615-0000-4000-9000-000000000010', 'Soup', 550000, 'NGN', true, 'kitchen', 2),
  ('44900615-0000-4000-b000-000000000013', '44900615-0000-4000-b000-000000000001', '44900615-0000-4000-9000-000000000010', 'Asun', 400000, 'NGN', true, 'kitchen', 3),
  ('44900615-0000-4000-b000-000000000014', '44900615-0000-4000-b000-000000000001', '44900615-0000-4000-9000-000000000010', 'Croaker', 1850000, 'NGN', true, 'kitchen', 4),
  ('44900615-0000-4000-b000-000000000015', '44900615-0000-4000-b000-000000000001', '44900615-0000-4000-9000-000000000010', 'Chapman', 300000, 'NGN', true, 'bar', 5),
  ('44900615-0000-4000-b000-000000000016', '44900615-0000-4000-b000-000000000001', '44900615-0000-4000-9000-000000000010', 'Rice', 200000, 'NGN', true, 'kitchen', 6),
  ('44900615-0000-4000-b000-000000000021', '44900615-0000-4000-b000-000000000002', '44900615-0000-4000-9000-000000000020', 'Other dish', 100000, 'NGN', true, 'kitchen', 1);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900615-0000-4000-9000-0000000000a1', '44900615-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;
INSERT INTO t5c_ids VALUES
  ('jollof', '44900615-0000-4000-b000-000000000011'), ('soup', '44900615-0000-4000-b000-000000000012'),
  ('asun', '44900615-0000-4000-b000-000000000013'), ('croaker', '44900615-0000-4000-b000-000000000014'),
  ('chapman', '44900615-0000-4000-b000-000000000015'), ('rice', '44900615-0000-4000-b000-000000000016'),
  ('other', '44900615-0000-4000-b000-000000000021');

SELECT public.t5c_as('44900615-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900615-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'k5c-menu-on', true);
SELECT public.issue_4490_set_venue_feature('44900615-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'k5c-till-on', true);
SELECT public.issue_4490_set_venue_feature('44900615-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'k5c-ks-on', true);
SELECT public.t5c_reset();

-- Builders, as the edge calls them.
CREATE SEQUENCE public.t5c_pickup START 401;
GRANT USAGE ON SEQUENCE public.t5c_pickup TO PUBLIC;
CREATE FUNCTION public.t5c_open(p_key text, p_actor uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_till_open('44900615-0000-4000-9000-0000000000a1', p_actor,
    NULL, initcap(p_key), NULL, 'k5c-open:' || p_key)->>'id')::uuid
$f$;
-- A held round of one line: p_qty x the item, 10% service charge.
CREATE FUNCTION public.t5c_round(p_sale uuid, p_item uuid, p_qty integer, p_actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
  v_session uuid;
  v_price integer;
  v_name text;
BEGIN
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = p_sale;
  SELECT price_cents, name INTO v_price, v_name FROM public.menu_items WHERE id = p_item;
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, v_session, '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-9000-0000000000a1', 'staff',
    p_actor, lpad(nextval('public.t5c_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', v_price * p_qty, v_price * p_qty, 0, 1000, (v_price * p_qty) / 10, 0, 0, 0, false, false, false,
    v_price * p_qty + (v_price * p_qty) / 10, v_price * p_qty + (v_price * p_qty) / 10, 'pending', 'held',
    'till-k5c-round:' || v_order, jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, p_item, 1, v_name, v_price, 'NGN', p_qty, 0, v_price * p_qty);
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, p_actor, NULL);
  RETURN v_order;
END
$f$;
-- A pending guest page order (Paystack): lines = [[item, qty], ...], 10% service charge.
CREATE FUNCTION public.t5c_guest(p_key text, p_lines jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_sub integer := 0;
  r jsonb;
  n integer := 0;
  v_price integer;
  v_name text;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT price_cents INTO v_price FROM public.menu_items WHERE id = (r->>0)::uuid;
    v_sub := v_sub + v_price * (r->>1)::integer;
  END LOOP;
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.venue_order_sessions (id, brand_id, venue_id, currency)
  VALUES (v_session, '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-9000-0000000000a1', 'NGN');
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, list_subtotal_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, payment_status, paystack_reference, pickup_code, idempotency_key, metadata)
  VALUES (v_order, v_session, '44900615-0000-4000-9000-000000000010', '44900615-0000-4000-9000-0000000000a1',
    'guest_page', 'Ada', 'ada@example.com', '+2348030000000',
    'mingla', 'NGN', v_sub, v_sub, 1000, v_sub / 10, 0, 150, 0, (v_sub + v_sub / 10) * 150 / 10000, 0,
    false, false, false, v_sub + v_sub / 10, 0, v_sub + v_sub / 10,
    'paystack', 'pending', 'mingla_vo_k5c_' || p_key, lpad(nextval('public.t5c_pickup')::text, 3, '0'),
    'k5c-guest:' || p_key, '{}'::jsonb);
  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    n := n + 1;
    SELECT price_cents, name INTO v_price, v_name FROM public.menu_items WHERE id = (r->>0)::uuid;
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents, station)
    VALUES (v_order, (r->>0)::uuid, n, v_name, v_price, 'NGN', (r->>1)::integer, 0, v_price * (r->>1)::integer,
      public.issue_4490_item_station((r->>0)::uuid, '44900615-0000-4000-9000-0000000000a1'));
  END LOOP;
  SET LOCAL session_replication_role = origin;
  INSERT INTO t5c_ids VALUES ('guest_' || p_key, v_order);
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t5c_pay(p_order uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.pg_venue_order_finalize_payment(o.id, 'paystack', o.total_cents, 'NGN', o.paystack_reference, NULL, NULL, NULL)
  FROM public.venue_orders o WHERE o.id = p_order
$f$;
CREATE FUNCTION public.t5c_line(p_order uuid, p_item uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_order_items WHERE venue_order_id = p_order AND menu_item_id = p_item ORDER BY line_no LIMIT 1
$f$;
CREATE FUNCTION public.t5c_set(p_item uuid, p_count integer, p_actor uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_stock_set(p_item, p_count, NULL, p_actor, NULL)
$f$;
GRANT EXECUTE ON FUNCTION public.t5c_open(text, uuid), public.t5c_round(uuid, uuid, integer, uuid),
  public.t5c_guest(text, jsonb), public.t5c_pay(uuid), public.t5c_line(uuid, uuid), public.t5c_set(uuid, integer, uuid) TO PUBLIC;

-- ===========================================================================
-- K-1 The one orderable rule.
-- ===========================================================================
SELECT public.t5c_ok(
  public.issue_4490_menu_item_orderable(true, NULL) AND NOT public.issue_4490_menu_item_orderable(true, 0)
  AND public.issue_4490_menu_item_orderable(true, 1) AND NOT public.issue_4490_menu_item_orderable(false, NULL)
  AND NOT public.issue_4490_menu_item_orderable(false, 5) AND NOT public.issue_4490_menu_item_orderable(NULL, NULL),
  'K-1a the orderable rule: on and not sold out (a NULL count is not tracked)');
SELECT public.t5c_ok(
  pg_get_viewdef('public.public_menus_view'::regclass) LIKE '%issue_4490_menu_item_orderable(mi.is_available, mi.stock_count)%'
  AND pg_get_viewdef('public.public_menu_sold_out_view'::regclass) LIKE '%NOT issue_4490_menu_item_orderable(mi.is_available, mi.stock_count)%',
  'K-1b both guest menu views apply the one rule');
SELECT public.t5c_ok(
  (SELECT count(*) FROM public.public_menus_view WHERE venue_id = '44900615-0000-4000-9000-0000000000a1') = 6
  AND (SELECT count(*) FROM public.public_menus_view WHERE venue_id = '44900615-0000-4000-9000-0000000000a1' AND stock_left IS NOT NULL) = 0
  AND (SELECT count(*) FROM public.public_menu_sold_out_view WHERE venue_id = '44900615-0000-4000-9000-0000000000a1') = 0,
  'K-1c nothing tracked: all six items on the guest menu, stock_left NULL, nothing sold out');

-- ===========================================================================
-- K-2 Only the stock functions change a count.
-- ===========================================================================
SELECT public.t5c_as('44900615-0000-4000-8000-000000000001');
SELECT public.t5c_expect($$UPDATE public.menu_items SET stock_count = 5 WHERE id = '44900615-0000-4000-b000-000000000011'$$,
  '42501', 'stock_write_refused', 'K-2a the owner''s direct menu_items write of stock_count is refused');
SELECT public.t5c_expect($$SELECT set_config('mingla.issue_4490_stock', '44900615-0000-4000-b000-000000000011', true);
  UPDATE public.menu_items SET stock_count = 5 WHERE id = '44900615-0000-4000-b000-000000000011'$$,
  '42501', 'stock_write_refused', 'K-2b a client role that sets the stock setting itself is still refused');
SELECT public.t5c_expect($$INSERT INTO public.menu_items (menu_id, brand_id, name, price_cents, currency, stock_count)
  VALUES ('44900615-0000-4000-b000-000000000001', '44900615-0000-4000-9000-000000000010', 'Sneaky', 100, 'NGN', 9)$$,
  '42501', 'stock_write_refused', 'K-2c a direct insert with a count is refused');
UPDATE public.menu_items SET name = 'Jollof' WHERE id = '44900615-0000-4000-b000-000000000011';
SELECT public.t5c_ok(true, 'K-2d the owner''s ordinary menu write (name) still works');
SELECT public.t5c_expect($$SELECT public.issue_4490_stock_set('44900615-0000-4000-b000-000000000011', 5, NULL,
  '44900615-0000-4000-8000-000000000001', NULL)$$, '42501', NULL, 'K-2e authenticated cannot call the stock functions');
SELECT public.t5c_service();
SELECT public.t5c_expect($$UPDATE public.menu_items SET stock_count = 5 WHERE id = '44900615-0000-4000-b000-000000000011'$$,
  '42501', 'stock_write_refused', 'K-2f a direct service-role write of stock_count is refused');
SELECT public.t5c_reset();
SELECT public.t5c_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_stock_take(uuid[], text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_stock_take(uuid[], text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_order_sold_out_resolve(uuid, uuid[], text, uuid, uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_stock_give_back(uuid)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.issue_4490_menu_item_orderable(boolean, integer)', 'EXECUTE')
  AND has_table_privilege('anon', 'public.public_menu_sold_out_view', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.public_menu_sold_out_view', 'UPDATE'),
  'K-2g privileges: stock functions service-only; the rule and the sold-out view readable by guests');
SELECT public.t5c_ok(t5c_stock(public.t5c_id('jollof')) IS NULL, 'K-2h after every refused write Jollof is still untracked');

-- ===========================================================================
-- K-3 Menu counts: menu manage rights.
-- ===========================================================================
SELECT public.t5c_service();
SELECT public.t5c_expect($$SELECT public.t5c_set(public.t5c_id('jollof'), 2, '44900615-0000-4000-8000-000000000002')$$,
  '42501', 'not_authorized', 'K-3a a seller cannot set a count');
SELECT public.t5c_expect($$SELECT public.t5c_set(public.t5c_id('jollof'), 2, '44900615-0000-4000-8000-000000000006')$$,
  '42501', 'not_authorized', 'K-3b another brand''s owner cannot set a count');
SELECT public.t5c_expect($$SELECT public.t5c_set(public.t5c_id('jollof'), 2, '44900615-0000-4000-8000-000000000004')$$,
  '42501', 'not_authorized', 'K-3c the kitchen cannot set a count from Menu');
SELECT public.t5c_expect($$SELECT public.issue_4490_stock_set(public.t5c_id('jollof'), -1, NULL, '44900615-0000-4000-8000-000000000001', NULL)$$,
  '22023', 'stock_invalid', 'K-3d a negative count is refused');
SELECT public.t5c_ok((public.issue_4490_stock_set(public.t5c_id('jollof'), 2, 1, '44900615-0000-4000-8000-000000000003', NULL)->>'stockLeft')::int = 2,
  'K-3e the menu manager (restaurant.manage_menu) sets Jollof to 2, warn at 1');
SELECT public.t5c_ok((public.t5c_set(public.t5c_id('soup'), 1, '44900615-0000-4000-8000-000000000001')->>'stockLeft')::int = 1,
  'K-3f the owner sets Soup to 1');
SELECT public.t5c_ok(EXISTS (SELECT 1 FROM public.audit_log a WHERE a.action = 'stock.set' AND a.target_id = public.t5c_id('jollof')::text
    AND a.user_id = '44900615-0000-4000-8000-000000000003' AND (a.after->>'after')::int = 2 AND a.after->>'via' = 'menu'),
  'K-3g the change is audited as stock.set by the person who made it');
SELECT public.t5c_ok(
  (SELECT stock_left FROM public.public_menus_view WHERE id = public.t5c_id('jollof')) = 2
  AND (SELECT is_available FROM public.menu_items WHERE id = public.t5c_id('jollof')),
  'K-3h the guest menu shows 2 left; the item is still on');
SELECT public.t5c_reset();

-- ===========================================================================
-- K-4 Till send takes stock; too little sends nothing.
-- ===========================================================================
SELECT public.t5c_service();
INSERT INTO t5c_ids VALUES ('sale_a', public.t5c_open('stock-a', '44900615-0000-4000-8000-000000000002'));
INSERT INTO t5c_ids VALUES ('round_a', public.t5c_round(public.t5c_id('sale_a'), public.t5c_id('jollof'), 2, '44900615-0000-4000-8000-000000000002'));
SELECT public.t5c_ok(t5c_stock(public.t5c_id('jollof')) = 2, 'K-4a a held round takes no stock');
SELECT public.issue_4490_till_send(public.t5c_id('sale_a'), '44900615-0000-4000-8000-000000000002');
SELECT public.t5c_ok(t5c_stock(public.t5c_id('jollof')) = 0
  AND (SELECT fulfillment_status FROM public.venue_orders WHERE id = public.t5c_id('round_a')) = 'placed'
  AND (SELECT stock_taken FROM public.venue_order_items WHERE venue_order_id = public.t5c_id('round_a')) = 2
  AND (SELECT stock_out_at IS NOT NULL FROM public.menu_items WHERE id = public.t5c_id('jollof')),
  'K-4b sending 2 Jollof takes both: 0 left, the round is placed, the line took 2');
SELECT public.t5c_ok(NOT EXISTS (SELECT 1 FROM public.public_menus_view WHERE id = public.t5c_id('jollof'))
  AND EXISTS (SELECT 1 FROM public.public_menu_sold_out_view WHERE id = public.t5c_id('jollof') AND stock_left = 0)
  AND (SELECT is_available FROM public.menu_items WHERE id = public.t5c_id('jollof')),
  'K-4c sold out: off the orderable view, on the sold-out view, still switched on');
INSERT INTO t5c_ids VALUES ('sale_b', public.t5c_open('stock-b', '44900615-0000-4000-8000-000000000002'));
INSERT INTO t5c_ids VALUES ('round_b', public.t5c_round(public.t5c_id('sale_b'), public.t5c_id('jollof'), 1, '44900615-0000-4000-8000-000000000002'));
SELECT public.t5c_ok((SELECT d->>'state' = 'PT409' AND d->>'message' = 'item_sold_out' AND d->>'itemName' = 'Jollof'
    AND (d->>'left')::int = 0
  FROM public.t5c_detail(format('SELECT public.issue_4490_till_send(%L, %L)', public.t5c_id('sale_b'),
    '44900615-0000-4000-8000-000000000002')) d),
  'K-4d a third send of Jollof is refused item_sold_out (Jollof, 0 left)');
SELECT public.t5c_ok((SELECT fulfillment_status FROM public.venue_orders WHERE id = public.t5c_id('round_b')) = 'held'
  AND NOT EXISTS (SELECT 1 FROM public.venue_station_tickets t WHERE t.venue_order_id = public.t5c_id('round_b'))
  AND t5c_stock(public.t5c_id('jollof')) = 0,
  'K-4e nothing of that send happened: still held, no ticket, count 0 (never negative)');
-- Two rounds on one check, one short: nothing of either is sent.
SELECT public.t5c_set(public.t5c_id('asun'), 3, '44900615-0000-4000-8000-000000000001');
INSERT INTO t5c_ids VALUES ('sale_c', public.t5c_open('stock-c', '44900615-0000-4000-8000-000000000002'));
INSERT INTO t5c_ids VALUES ('round_c1', public.t5c_round(public.t5c_id('sale_c'), public.t5c_id('asun'), 1, '44900615-0000-4000-8000-000000000002'));
INSERT INTO t5c_ids VALUES ('round_c2', public.t5c_round(public.t5c_id('sale_c'), public.t5c_id('asun'), 5, '44900615-0000-4000-8000-000000000002'));
SELECT public.t5c_ok((SELECT d->>'message' = 'item_sold_out' AND (d->>'left')::int IN (2, 3)
  FROM public.t5c_detail(format('SELECT public.issue_4490_till_send(%L, %L)', public.t5c_id('sale_c'),
    '44900615-0000-4000-8000-000000000002')) d)
  AND t5c_stock(public.t5c_id('asun')) = 3
  AND (SELECT count(*) FROM public.venue_orders WHERE id IN (public.t5c_id('round_c1'), public.t5c_id('round_c2'))
       AND fulfillment_status = 'held') = 2,
  'K-4f 1 + 5 Asun with 3 left: refused, both rounds still held, the count back to 3');
SELECT public.t5c_reset();

-- ===========================================================================
-- K-5 Paying sends held rounds first (T8); a sold-out held round refuses the
--     payment and moves no money.
-- ===========================================================================
SELECT public.t5c_service();
SELECT public.t5c_ok((SELECT d->>'message' = 'item_sold_out'
  FROM public.t5c_detail(format('SELECT public.issue_4490_till_take_payment(%L, ''cash'', 550000, 0, 550000, %L, NULL, gen_random_uuid(), %s)',
    public.t5c_id('sale_b'), '44900615-0000-4000-8000-000000000002', public.t5c_v(public.t5c_id('sale_b')))) d)
  AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = public.t5c_id('sale_b'))
  AND (SELECT paid_minor FROM public.venue_till_sales WHERE id = public.t5c_id('sale_b')) = 0,
  'K-5a cash for a check whose held Jollof is sold out: refused, no payment row, nothing paid');
SELECT public.t5c_set(public.t5c_id('chapman'), 4, '44900615-0000-4000-8000-000000000001');
INSERT INTO t5c_ids VALUES ('sale_d', public.t5c_open('stock-d', '44900615-0000-4000-8000-000000000002'));
INSERT INTO t5c_ids VALUES ('round_d', public.t5c_round(public.t5c_id('sale_d'), public.t5c_id('chapman'), 1, '44900615-0000-4000-8000-000000000002'));
SELECT public.issue_4490_till_take_payment(public.t5c_id('sale_d'), 'cash', 330000, 0, 330000,
  '44900615-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t5c_v(public.t5c_id('sale_d')));
SELECT public.t5c_ok(t5c_stock(public.t5c_id('chapman')) = 3
  AND (SELECT fulfillment_status FROM public.venue_orders WHERE id = public.t5c_id('round_d')) <> 'held'
  AND (SELECT state FROM public.venue_till_sales WHERE id = public.t5c_id('sale_d')) = 'paid',
  'K-5b a counter sale paid without Send: sent first, stock taken (3 left), paid');
SELECT public.t5c_reset();

-- ===========================================================================
-- K-6 Void of an unprepared sent line gives stock back (when asked).
-- ===========================================================================
SELECT public.t5c_service();
INSERT INTO t5c_ids VALUES ('sale_e', public.t5c_open('stock-e', '44900615-0000-4000-8000-000000000002'));
INSERT INTO t5c_ids VALUES ('round_e', public.t5c_round(public.t5c_id('sale_e'), public.t5c_id('chapman'), 2, '44900615-0000-4000-8000-000000000002'));
SELECT public.issue_4490_till_send(public.t5c_id('sale_e'), '44900615-0000-4000-8000-000000000002');
SELECT public.t5c_ok(t5c_stock(public.t5c_id('chapman')) = 1, 'K-6a 2 Chapman sent: 1 left');
SELECT public.issue_4490_till_void(public.t5c_id('sale_e'), NULL,
  (SELECT id FROM public.venue_order_items WHERE venue_order_id = public.t5c_id('round_e')),
  '44900615-0000-4000-8000-000000000001', 'Changed their mind', true, public.t5c_v(public.t5c_id('sale_e')));
SELECT public.t5c_ok(t5c_stock(public.t5c_id('chapman')) = 3
  AND (SELECT stock_taken FROM public.venue_order_items WHERE venue_order_id = public.t5c_id('round_e')) = 0,
  'K-6b voiding the unprepared sent line with restock gives both back (3 left), once');
INSERT INTO t5c_ids VALUES ('round_e2', public.t5c_round(public.t5c_id('sale_e'), public.t5c_id('chapman'), 1, '44900615-0000-4000-8000-000000000002'));
SELECT public.issue_4490_till_send(public.t5c_id('sale_e'), '44900615-0000-4000-8000-000000000002');
SELECT public.issue_4490_till_void(public.t5c_id('sale_e'), NULL,
  (SELECT id FROM public.venue_order_items WHERE venue_order_id = public.t5c_id('round_e2')),
  '44900615-0000-4000-8000-000000000001', 'Made wrong', false, public.t5c_v(public.t5c_id('sale_e')));
SELECT public.t5c_ok(t5c_stock(public.t5c_id('chapman')) = 2, 'K-6c a void with restock off gives nothing back (2 left)');
INSERT INTO t5c_ids VALUES ('round_e3', public.t5c_round(public.t5c_id('sale_e'), public.t5c_id('chapman'), 1, '44900615-0000-4000-8000-000000000002'));
SELECT public.issue_4490_till_send(public.t5c_id('sale_e'), '44900615-0000-4000-8000-000000000002');
SELECT public.issue_4490_station_accept(public.t5c_id('round_e3'), 'bar', '44900615-0000-4000-8000-000000000004');
SELECT public.issue_4490_till_void(public.t5c_id('sale_e'), NULL,
  (SELECT id FROM public.venue_order_items WHERE venue_order_id = public.t5c_id('round_e3')),
  '44900615-0000-4000-8000-000000000001', 'Made wrong', true, public.t5c_v(public.t5c_id('sale_e')));
SELECT public.t5c_ok(t5c_stock(public.t5c_id('chapman')) = 1, 'K-6d a line the bar already started is never given back (1 left)');
INSERT INTO t5c_ids VALUES ('round_e4', public.t5c_round(public.t5c_id('sale_e'), public.t5c_id('chapman'), 1, '44900615-0000-4000-8000-000000000002'));
SELECT public.issue_4490_till_void(public.t5c_id('sale_e'), NULL,
  (SELECT id FROM public.venue_order_items WHERE venue_order_id = public.t5c_id('round_e4')),
  '44900615-0000-4000-8000-000000000002', 'Changed their mind', true, public.t5c_v(public.t5c_id('sale_e')));
SELECT public.t5c_ok(t5c_stock(public.t5c_id('chapman')) = 1, 'K-6e a held line took nothing, so its void gives nothing (1 left)');
SELECT public.t5c_reset();

-- ===========================================================================
-- K-7 A guest order takes stock when PAID (never at checkout start); a short
--     paid order is flagged, never refused.
-- ===========================================================================
SELECT public.t5c_service();
SELECT public.t5c_guest('g1', jsonb_build_array(jsonb_build_array(public.t5c_id('soup'), 1)));
SELECT public.t5c_ok(t5c_stock(public.t5c_id('soup')) = 1, 'K-7a a guest checkout that has not paid takes no stock');
INSERT INTO t5c_r VALUES ('g1_pay', public.t5c_pay(public.t5c_id('guest_g1')));
SELECT public.t5c_ok(public.t5c_rv('g1_pay')->>'status' = 'finalized' AND NOT (public.t5c_rv('g1_pay') ? 'soldOutAfterPayment')
  AND t5c_stock(public.t5c_id('soup')) = 0,
  'K-7b paid: Soup taken (0 left), nothing flagged');
INSERT INTO t5c_r VALUES ('g1_replay', public.t5c_pay(public.t5c_id('guest_g1')));
SELECT public.t5c_ok(public.t5c_rv('g1_replay')->>'status' = 'replayed'
  AND t5c_stock(public.t5c_id('soup')) = 0, 'K-7c a webhook replay takes nothing twice');
-- Soup is sold out; a guest who started checkout while it was on pays now.
SELECT public.t5c_set(public.t5c_id('croaker'), 5, '44900615-0000-4000-8000-000000000001');
SELECT public.t5c_guest('g2', jsonb_build_array(jsonb_build_array(public.t5c_id('soup'), 1), jsonb_build_array(public.t5c_id('rice'), 1)));
SELECT public.t5c_ok((SELECT (r->>'status') = 'finalized' AND (r->>'soldOutAfterPayment')::boolean FROM public.t5c_pay(public.t5c_id('guest_g2')) r),
  'K-7d the guest pays for a Soup that sold out meanwhile: finalized, flagged soldOutAfterPayment');
SELECT public.t5c_ok((SELECT payment_status FROM public.venue_orders WHERE id = public.t5c_id('guest_g2')) = 'paid'
  AND (SELECT metadata->>'sold_out_after_payment' FROM public.venue_orders WHERE id = public.t5c_id('guest_g2')) = 'true'
  AND (SELECT sold_out_at IS NOT NULL AND stock_taken = 0 FROM public.venue_order_items WHERE id = public.t5c_line(public.t5c_id('guest_g2'), public.t5c_id('soup')))
  AND (SELECT sold_out_at IS NULL FROM public.venue_order_items WHERE id = public.t5c_line(public.t5c_id('guest_g2'), public.t5c_id('rice')))
  AND t5c_stock(public.t5c_id('soup')) = 0 AND t5c_stock(public.t5c_id('rice')) IS NULL,
  'K-7e the order is paid (never refused), the Soup line flagged, the untracked Rice untouched, the count stays 0');
-- 1 Croaker short of 6: what is left is taken, the line is flagged.
SELECT public.t5c_guest('g3', jsonb_build_array(jsonb_build_array(public.t5c_id('croaker'), 6)));
SELECT public.t5c_pay(public.t5c_id('guest_g3'));
SELECT public.t5c_ok(t5c_stock(public.t5c_id('croaker')) = 0
  AND (SELECT stock_taken FROM public.venue_order_items WHERE venue_order_id = public.t5c_id('guest_g3')) = 5
  AND (SELECT metadata->>'sold_out_after_payment' FROM public.venue_orders WHERE id = public.t5c_id('guest_g3')) = 'true',
  'K-7f 6 Croaker paid with 5 left: the 5 are taken (0 left, never negative), the line is flagged');
SELECT public.t5c_reset();

-- ===========================================================================
-- K-8 T16: swap (same station, same price or less) or refund, exactly once.
-- ===========================================================================
SELECT public.t5c_service();
INSERT INTO t5c_ids VALUES ('g2_soup', public.t5c_line(public.t5c_id('guest_g2'), public.t5c_id('soup')));
SELECT public.t5c_expect(format($$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L]::uuid[], 'swap', %L, %L, NULL, 'k5c-swap-dear')$$,
  public.t5c_id('guest_g2'), public.t5c_id('g2_soup'), public.t5c_id('croaker'), '44900615-0000-4000-8000-000000000004'),
  'PT409', 'sold_out_swap_not_orderable', 'K-8a a sold-out swap item (Croaker, 0 left) is refused by the one rule');
SELECT public.t5c_set(public.t5c_id('croaker'), 5, '44900615-0000-4000-8000-000000000001');
SELECT public.t5c_expect(format($$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L]::uuid[], 'swap', %L, %L, NULL, 'k5c-swap-dear2')$$,
  public.t5c_id('guest_g2'), public.t5c_id('g2_soup'), public.t5c_id('croaker'), '44900615-0000-4000-8000-000000000004'),
  'PT409', 'sold_out_swap_dearer', 'K-8b a dearer swap (Croaker 18,500 for Soup 5,500) is refused');
SELECT public.t5c_expect(format($$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L]::uuid[], 'swap', %L, %L, NULL, 'k5c-swap-bar')$$,
  public.t5c_id('guest_g2'), public.t5c_id('g2_soup'), public.t5c_id('chapman'), '44900615-0000-4000-8000-000000000004'),
  'PT409', 'sold_out_swap_other_station', 'K-8c a swap to another station (Chapman, bar) is refused');
SELECT public.t5c_expect(format($$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L]::uuid[], 'swap', %L, %L, NULL, 'k5c-swap-door')$$,
  public.t5c_id('guest_g2'), public.t5c_id('g2_soup'), public.t5c_id('asun'), '44900615-0000-4000-8000-000000000008'),
  '42501', 'not_authorized', 'K-8d door staff cannot swap');
SELECT public.t5c_expect(format($$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L]::uuid[], 'refund', NULL, %L, NULL, 'k5c-refund-seller')$$,
  public.t5c_id('guest_g2'), public.t5c_id('g2_soup'), '44900615-0000-4000-8000-000000000002'),
  '42501', 'not_authorized', 'K-8e a seller cannot refund (the staff refund floor is event manager)');
SELECT public.t5c_expect(format($$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L]::uuid[], 'swap', %L, %L, NULL, 'k5c-swap-device')$$,
  public.t5c_id('guest_g2'), public.t5c_id('g2_soup'), public.t5c_id('asun'), '44900615-0000-4000-8000-000000000005'),
  '28000', 'pin_session_required', 'K-8f a Till device acting as itself needs a PIN session');
-- Swap Soup 5,500 for Asun 4,000: 1,500 + 10% service charge = 1,650 back.
-- [TEST-MOD-APPROVED #4490] 08-O5 fix 3 (P8): a swap that gives money back is a refund, so the kitchen
-- (no refund rights) is refused and the owner makes it.
SELECT public.t5c_expect(format($$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L]::uuid[], 'swap', %L, %L, NULL, 'k5c-swap-kitchen-money')$$,
  public.t5c_id('guest_g2'), public.t5c_id('g2_soup'), public.t5c_id('asun'), '44900615-0000-4000-8000-000000000004'),
  '42501', 'not_authorized', 'K-8g0 the kitchen cannot make a swap that gives money back (refund rights needed)');
SELECT public.t5c_ok((SELECT (r->>'refundMinor')::bigint = 165000 AND r->>'swapName' = 'Asun' AND (r->>'unresolved')::int = 0
  FROM public.issue_4490_order_sold_out_resolve(public.t5c_id('guest_g2'), ARRAY[public.t5c_id('g2_soup')], 'swap',
    public.t5c_id('asun'), '44900615-0000-4000-8000-000000000001', NULL, 'k5c-swap-ok') r),
  'K-8g the owner swaps Soup for Asun: 1,650.00 back (difference + its service charge share)');
SELECT public.t5c_ok(
  (SELECT prep_state = 'voided' AND void_reason = 'sold_out_after_payment' AND sold_out_resolution = 'swap'
     AND swapped_to_item_id IS NOT NULL FROM public.venue_order_items WHERE id = public.t5c_id('g2_soup'))
  AND (SELECT item_name_at_order = 'Asun' AND unit_price_cents = 400000 AND station = 'kitchen' AND swapped_from_item_id = public.t5c_id('g2_soup')
     FROM public.venue_order_items WHERE id = (SELECT swapped_to_item_id FROM public.venue_order_items WHERE id = public.t5c_id('g2_soup')))
  AND (SELECT count(*) FROM public.source_refunds sr WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = public.t5c_id('guest_g2')) = 1
  AND (SELECT buyer_refund_requested_cents = 165000 AND refund_kind = 'venue_order_line_refund'
       AND idempotency_key = 'venue_order_line_refund:' || public.t5c_id('guest_g2')
       AND fee_reversal_required_cents = floor(o.mingla_fee_cents * 165000.0 / o.total_cents + 0.5)
     FROM public.source_refunds sr,
          LATERAL (SELECT mingla_fee_cents, total_cents FROM public.venue_orders WHERE id = public.t5c_id('guest_g2')) o
     WHERE sr.source_id = public.t5c_id('guest_g2')),
  'K-8h the old line is voided (swap), the new Asun line is at its own price on the same station, one line refund with pro rata fee reversal');
SELECT public.t5c_ok(t5c_stock(public.t5c_id('asun')) = 2
  AND (SELECT stock_taken FROM public.venue_order_items WHERE swapped_from_item_id = public.t5c_id('g2_soup')) = 1
  AND t5c_stock(public.t5c_id('soup')) = 0,
  'K-8i the swap line took 1 Asun (3 -> 2); Soup stays sold out (its line took nothing)');
SELECT public.t5c_ok((SELECT (r->>'replayed')::boolean FROM public.issue_4490_order_sold_out_resolve(public.t5c_id('guest_g2'),
    ARRAY[public.t5c_id('g2_soup')], 'swap', public.t5c_id('asun'), '44900615-0000-4000-8000-000000000001', NULL, 'k5c-swap-ok') r)
  AND (SELECT count(*) FROM public.source_refunds sr WHERE sr.source_id = public.t5c_id('guest_g2')) = 1,
  'K-8k the same request again answers what it did (replayed), still one refund');
SELECT public.t5c_expect(format($$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L]::uuid[], 'refund', NULL, %L, NULL, 'k5c-refund-again')$$,
  public.t5c_id('guest_g2'), public.t5c_id('g2_soup'), '44900615-0000-4000-8000-000000000001'),
  'PT409', 'sold_out_already_resolved', 'K-8l a second resolution of the same line is refused');
SELECT public.t5c_ok((SELECT count(*) FROM public.notification_outbox n WHERE n.category_key = 'buyer_venue_order_sold_out'
    AND n.payload->>'venue_order_id' = public.t5c_id('guest_g2')::text) = 2
  AND EXISTS (SELECT 1 FROM public.notification_outbox n WHERE n.idempotency_key = 'buyer_venue_order_sold_out:' || public.t5c_id('guest_g2') || ':1:sms'
    AND n.payload->>'outcome' = 'swap' AND n.payload->>'swap_name' = 'Asun' AND (n.payload->>'refund_minor')::bigint = 165000),
  'K-8m the guest is told once by text and once by email (swapped for Asun, 1,650.00 back)');
SELECT public.t5c_ok(EXISTS (SELECT 1 FROM public.audit_log a WHERE a.action = 'order.sold_out_resolve'
    AND a.target_id = public.t5c_id('guest_g2')::text AND a.after->>'resolution' = 'swap'),
  'K-8n the resolution is audited');
-- Refund: the 6 Croaker line (5 were taken and never made, so they come back).
INSERT INTO t5c_r VALUES ('g3_refund', public.issue_4490_order_sold_out_resolve(public.t5c_id('guest_g3'),
    ARRAY[public.t5c_line(public.t5c_id('guest_g3'), public.t5c_id('croaker'))], 'refund', NULL,
    '44900615-0000-4000-8000-000000000007', NULL, 'k5c-refund-ok'));
SELECT public.t5c_ok((public.t5c_rv('g3_refund')->>'refundMinor')::bigint = 6 * 1850000 + 6 * 185000
  AND t5c_stock(public.t5c_id('croaker')) = 5 + 5,
  'K-8o the event manager refunds the 6 Croaker: 122,100.00 (lines + service charge share); the 5 never made come back');
SELECT public.t5c_ok((SELECT sold_out_refund_minor = 12210000 AND sold_out_resolution = 'refund' AND prep_state = 'voided'
    FROM public.venue_order_items WHERE venue_order_id = public.t5c_id('guest_g3')),
  'K-8p the line records the refund');
-- A second sold-out line on an order that already had its line refund.
SELECT public.t5c_set(public.t5c_id('rice'), 0, '44900615-0000-4000-8000-000000000001');
SELECT public.t5c_set(public.t5c_id('jollof'), 0, '44900615-0000-4000-8000-000000000001');
SELECT public.t5c_guest('g4', jsonb_build_array(jsonb_build_array(public.t5c_id('rice'), 1), jsonb_build_array(public.t5c_id('jollof'), 1)));
SELECT public.t5c_pay(public.t5c_id('guest_g4'));
SELECT public.issue_4490_order_sold_out_resolve(public.t5c_id('guest_g4'),
  ARRAY[public.t5c_line(public.t5c_id('guest_g4'), public.t5c_id('rice'))], 'refund', NULL,
  '44900615-0000-4000-8000-000000000001', NULL, 'k5c-g4-first');
-- TEST-MOD-APPROVED #4490 (08-O5 fix 1, O5-T3): "one line refund per order" was the P1 defect: a
-- guest who paid for two sold-out lines could only ever get one back. K-8q/K-8r now prove the fixed
-- rule on a fresh order (g5) with two sold-out lines, each refunded on its own; g4 keeps one line
-- waiting for K-9d and the escalation scan below.
SELECT public.t5c_guest('g5', jsonb_build_array(jsonb_build_array(public.t5c_id('rice'), 1), jsonb_build_array(public.t5c_id('jollof'), 1)));
SELECT public.t5c_pay(public.t5c_id('guest_g5'));
SELECT public.issue_4490_order_sold_out_resolve(public.t5c_id('guest_g5'),
  ARRAY[public.t5c_line(public.t5c_id('guest_g5'), public.t5c_id('rice'))], 'refund', NULL,
  '44900615-0000-4000-8000-000000000001', NULL, 'k5c-g5-first');
SELECT public.t5c_ok((SELECT (r->>'refundMinor')::bigint > 0 AND NOT (r->>'replayed')::boolean
    FROM public.issue_4490_order_sold_out_resolve(public.t5c_id('guest_g5'),
      ARRAY[public.t5c_line(public.t5c_id('guest_g5'), public.t5c_id('jollof'))], 'refund', NULL,
      '44900615-0000-4000-8000-000000000001', NULL, 'k5c-g5-second') r),
  'K-8q a second sold-out line on the same order is refunded too (its own refund)');
SELECT public.t5c_ok((SELECT count(*) FROM public.source_refunds sr WHERE sr.source_id = public.t5c_id('guest_g5')) = 2
  AND (SELECT array_agg(sr.refund_kind ORDER BY sr.refund_kind) FROM public.source_refunds sr WHERE sr.source_id = public.t5c_id('guest_g5'))
      = ARRAY['venue_order_line_refund', 'venue_order_line_refund_2']
  AND (SELECT count(*) FROM public.venue_order_items WHERE venue_order_id = public.t5c_id('guest_g5')
         AND sold_out_at IS NOT NULL AND sold_out_resolution IS NULL) = 0,
  'K-8r two refund rows on the order (line refund 1 and 2); no line left waiting');
SELECT public.t5c_reset();

-- ===========================================================================
-- K-9 The staff view and Close the day.
-- ===========================================================================
SELECT public.t5c_service();
SELECT public.t5c_ok((SELECT (v->>'canRefund')::boolean AND (v->>'canSwap')::boolean AND (v->>'refundUsed')::boolean
    AND jsonb_array_length(v->'lines') = 2
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'swapOptions') o WHERE (o->>'menuItemId')::uuid IN (public.t5c_id('rice'), public.t5c_id('jollof'), public.t5c_id('soup')))
  FROM public.issue_4490_order_sold_out(public.t5c_id('guest_g4'), '44900615-0000-4000-8000-000000000001') v),
  'K-9a the owner sees both lines, may swap and refund, the refund is used, swap options are only orderable items');
SELECT public.t5c_ok((SELECT NOT (v->>'canRefund')::boolean AND (v->>'canSwap')::boolean
  FROM public.issue_4490_order_sold_out(public.t5c_id('guest_g4'), '44900615-0000-4000-8000-000000000002') v),
  'K-9b a seller may swap, not refund');
SELECT public.t5c_expect(format($$SELECT public.issue_4490_order_sold_out(%L, %L)$$, public.t5c_id('guest_g4'), '44900615-0000-4000-8000-000000000006'),
  '42501', 'not_authorized', 'K-9c another brand''s owner reads nothing');
SELECT public.t5c_ok((SELECT jsonb_array_length(s->'soldOutAfterPayment') = 1
    AND (s->'soldOutAfterPayment'->0->>'orderId')::uuid = public.t5c_id('guest_g4')
  FROM public.issue_4490_day_summary('44900615-0000-4000-9000-0000000000a1', NULL, '44900615-0000-4000-8000-000000000001', NULL) s),
  'K-9d Close the day lists the one order still waiting (it never blocks the close)');
SELECT public.t5c_reset();

-- ===========================================================================
-- K-10 T15: "Sold out" from the board, and "Back on".
-- ===========================================================================
SELECT public.t5c_service();
SELECT public.t5c_set(public.t5c_id('rice'), NULL, '44900615-0000-4000-8000-000000000001');
SELECT public.t5c_expect($$SELECT public.issue_4490_station_sold_out('44900615-0000-4000-b000-000000000016', true, '44900615-0000-4000-8000-000000000002')$$,
  '42501', 'not_authorized', 'K-10a a seller cannot mark sold out from the board');
INSERT INTO t5c_r VALUES ('rice_mark', public.issue_4490_station_sold_out(public.t5c_id('rice'), true, '44900615-0000-4000-8000-000000000004'));
SELECT public.t5c_ok((public.t5c_rv('rice_mark')->>'stockLeft')::int = 0 AND public.t5c_rv('rice_mark')->>'markedBy' = 'Ifeanyi Kitchen'
  AND (SELECT is_available FROM public.menu_items WHERE id = public.t5c_id('rice'))
  AND NOT EXISTS (SELECT 1 FROM public.public_menus_view WHERE id = public.t5c_id('rice')),
  'K-10b the kitchen marks untracked Rice sold out: 0 left, still switched on, off the guest menu');
SELECT public.t5c_ok((SELECT (r->>'already')::boolean FROM public.issue_4490_station_sold_out(public.t5c_id('rice'), true, '44900615-0000-4000-8000-000000000005') r),
  'K-10c a second mark (the Till device at the station) is a no-op');
SELECT public.t5c_ok((SELECT (x->>'canUndo')::boolean AND x->>'station' = 'kitchen'
  FROM jsonb_array_elements(public.issue_4490_station_stock('44900615-0000-4000-9000-0000000000a1', 'kitchen', '44900615-0000-4000-8000-000000000004')) x
  WHERE (x->>'menuItemId')::uuid = public.t5c_id('rice'))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.issue_4490_station_stock('44900615-0000-4000-9000-0000000000a1', 'kitchen', '44900615-0000-4000-8000-000000000004')) x
    WHERE (x->>'menuItemId')::uuid = public.t5c_id('chapman')),
  'K-10d the kitchen''s list has Rice (Back on offered) and not the bar''s Chapman');
INSERT INTO t5c_r VALUES ('rice_back', public.issue_4490_station_sold_out(public.t5c_id('rice'), false, '44900615-0000-4000-8000-000000000004'));
SELECT public.t5c_ok((public.t5c_rv('rice_back')->>'tracked')::boolean = false
  AND t5c_stock(public.t5c_id('rice')) IS NULL
  AND EXISTS (SELECT 1 FROM public.public_menus_view WHERE id = public.t5c_id('rice')),
  'K-10e Back on restores the earlier state (untracked) and the guest menu');
SELECT public.t5c_expect(format($$SELECT public.issue_4490_station_sold_out(%L, false, %L)$$, public.t5c_id('soup'), '44900615-0000-4000-8000-000000000004'),
  'PT409', 'stock_not_kitchen_mark', 'K-10f Back on refuses a count that sales took to 0 (not a kitchen mark)');
SELECT public.t5c_ok(EXISTS (SELECT 1 FROM public.audit_log a WHERE a.action = 'stock.set' AND a.target_id = public.t5c_id('rice')::text
  AND a.after->>'via' = 'station'), 'K-10g the kitchen mark is audited (via station)');
SELECT public.t5c_reset();
SELECT public.t5c_as('44900615-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900615-0000-4000-9000-0000000000a1', 'kitchen_screens', false, NULL, NULL, NULL, 'k5c-ks-off', true);
SELECT public.t5c_reset();
SELECT public.t5c_service();
SELECT public.t5c_expect(format($$SELECT public.issue_4490_station_sold_out(%L, true, %L)$$, public.t5c_id('rice'), '44900615-0000-4000-8000-000000000004'),
  'P0001', 'stations_not_enabled', 'K-10h without station screens the board control is off');
SELECT public.t5c_reset();

-- ===========================================================================
-- K-11 Not resolved after 10 minutes: rung 1 once.
-- ===========================================================================
UPDATE public.venue_orders SET metadata = metadata || jsonb_build_object('sold_out_at', now() - interval '11 minutes')
WHERE id = public.t5c_id('guest_g4');
SELECT public.t5c_service();
INSERT INTO t5c_r SELECT 'scan1', COALESCE(jsonb_agg(s.order_id), '[]'::jsonb) FROM public.issue_4490_sold_out_escalation_scan(now(), 50) s;
INSERT INTO t5c_r SELECT 'scan2', COALESCE(jsonb_agg(s.order_id), '[]'::jsonb) FROM public.issue_4490_sold_out_escalation_scan(now(), 50) s;
SELECT public.t5c_ok(public.t5c_rv('scan1') @> to_jsonb(ARRAY[public.t5c_id('guest_g4')])
  AND NOT (public.t5c_rv('scan1') @> to_jsonb(ARRAY[public.t5c_id('guest_g2')]))
  AND NOT (public.t5c_rv('scan2') @> to_jsonb(ARRAY[public.t5c_id('guest_g4')])),
  'K-11a an unresolved order 11 minutes old reaches rung 1 once; a resolved one never');
SELECT public.t5c_reset();

-- ===========================================================================
-- K-12 Stopping tracking is always allowed; a count needs the Till on.
-- ===========================================================================
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'VENUE_TILL';
SELECT public.t5c_service();
SELECT public.t5c_expect(format($$SELECT public.t5c_set(%L, 4, %L)$$, public.t5c_id('chapman'), '44900615-0000-4000-8000-000000000001'),
  'P0001', 'till_not_enabled', 'K-12a with the Till off a count cannot be set');
SELECT public.t5c_ok((public.t5c_set(public.t5c_id('chapman'), NULL, '44900615-0000-4000-8000-000000000001')->>'tracked')::boolean = false,
  'K-12b with the Till off a count can still be cleared (stop tracking)');
SELECT public.t5c_reset();

ROLLBACK;
\echo 'issue #4490 08-O5C ops_stock: all cases passed'
