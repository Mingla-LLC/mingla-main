-- Issue #4490 08-O5 fix 4 retest 2, P3-1 and P3-2, tester adversarial (independent angles).
-- The implementor checks PDF-then-CSV and a plain replay. This attacks the other directions:
-- A1 CSV first, then the PDF with the same PIN: the PDF is refused (single use both ways);
-- A2 an export approval for ANOTHER day does not print this day's PDF;
-- A3 an approval for the right day on ANOTHER venue does not print this venue's PDF;
-- B1 a replay of a stored sold-out refund by a member without refund rights is still refused;
-- B2 the same key with the other resolution is PT409 sold_out_key_reused and spends no approval;
-- B4 a retried money-returning swap answers its stored result and leaves an outstanding swap_refund approval unspent;
-- B3 a NEW sold-out refund on a Till device with no fresh PIN is still refused (replay-first opened no gap).
-- FAILS-ON-REVERT: day_close_pdf without its step-up take -> A1 (no error);
-- sold_out_resolve taking the step-up before the replay check -> B4b (the retry spends the outstanding approval).
-- Fixture copied from the implementor suite.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t3f_ids (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON t3f_ids TO PUBLIC;

CREATE FUNCTION public.t3f_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T3F FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t3f_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF (p_state IS NOT NULL AND SQLSTATE <> p_state) OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T3F FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  % [% %]', p_label, SQLSTATE, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'T3F FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t3f_as(p_user uuid)
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
CREATE FUNCTION public.t3f_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t3f_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
CREATE FUNCTION public.t3f_id(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM t3f_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t3f_u(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('44906180-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $f$;
CREATE FUNCTION public.t3f_m(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('44906180-0000-4000-a000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $f$;
CREATE FUNCTION public.t3f_hash(p_token text) RETURNS bytea LANGUAGE sql AS $f$
  SELECT extensions.digest(decode(p_token, 'hex'), 'sha256') $f$;
GRANT EXECUTE ON FUNCTION public.t3f_ok(boolean, text), public.t3f_expect(text, text, text, text), public.t3f_as(uuid),
  public.t3f_service(), public.t3f_reset(), public.t3f_id(text), public.t3f_u(integer), public.t3f_m(integer),
  public.t3f_hash(text) TO PUBLIC;

\set va '''44906180-0000-4000-9000-0000000000a1'''
\set vb '''44906180-0000-4000-9000-0000000000b1'''

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner; 02 seller at A; 03 restaurant manager at A (money);
-- 05 Till device at A and B; 06 kitchen at A; 07 a second Till device at A.
-- (F7 turns the account holder's own login into a Till device: the one shape
-- where a Till device login has the rank to decide a guest refund.)
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT public.t3f_u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  't3f-' || n || '@example.test', now(), now()
FROM unnest(ARRAY[1, 2, 3, 5, 6, 7]) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES (public.t3f_u(1), now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44906180-0000-4000-9000-000000000010', public.t3f_u(1), 'T3F 4490', 't3f-4490', 'NGN', 'paystack',
   now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  (:va, '44906180-0000-4000-9000-000000000010', 't3fa', 'T3F Grill A', 6.45, 3.40, 'restaurant', 'verified', 'NG'),
  (:vb, '44906180-0000-4000-9000-000000000010', 't3fb', 'T3F Bar B', 6.45, 3.41, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
SELECT '44906180-0000-4000-9000-000000000010', public.t3f_u(1), 'brand_owner', now()
WHERE NOT EXISTS (SELECT 1 FROM public.brand_team_members m WHERE m.brand_id = '44906180-0000-4000-9000-000000000010'
                  AND m.user_id = public.t3f_u(1) AND m.removed_at IS NULL);
UPDATE public.brand_team_members SET id = public.t3f_m(1), accepted_at = COALESCE(accepted_at, now())
WHERE brand_id = '44906180-0000-4000-9000-000000000010' AND user_id = public.t3f_u(1) AND removed_at IS NULL;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  (public.t3f_m(2), '44906180-0000-4000-9000-000000000010', public.t3f_u(2), 'venue_staff', now()),
  (public.t3f_m(3), '44906180-0000-4000-9000-000000000010', public.t3f_u(3), 'venue_staff', now()),
  (public.t3f_m(5), '44906180-0000-4000-9000-000000000010', public.t3f_u(5), 'venue_staff', now()),
  (public.t3f_m(6), '44906180-0000-4000-9000-000000000010', public.t3f_u(6), 'venue_staff', now()),
  (public.t3f_m(7), '44906180-0000-4000-9000-000000000010', public.t3f_u(7), 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  (public.t3f_m(2), :va, 'custom', ARRAY['venue.sell']),
  (public.t3f_m(3), :va, 'restaurant_manager',
   ARRAY['venue.sell', 'venue.kitchen', 'venue.manage_money', 'restaurant.view_orders', 'restaurant.manage_orders']),
  (public.t3f_m(5), :va, 'till_device', ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  (public.t3f_m(5), :vb, 'till_device', ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  (public.t3f_m(6), :va, 'kitchen_bar', ARRAY['venue.kitchen']),
  (public.t3f_m(7), :va, 'till_device', ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44906180-0000-4000-b000-000000000001', '44906180-0000-4000-9000-000000000010', :va, 'Kitchen A', true);
-- X 5,000.00 and W 3,000.00 (tracked, sold out below); Y 1,000.00 and Z 5,000.00 (never tracked).
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available, prep_station, sort_order) VALUES
  ('44906180-0000-4000-b000-000000000011', '44906180-0000-4000-b000-000000000001', '44906180-0000-4000-9000-000000000010', 'X', 500000, 'NGN', true, 'kitchen', 1),
  ('44906180-0000-4000-b000-000000000012', '44906180-0000-4000-b000-000000000001', '44906180-0000-4000-9000-000000000010', 'W', 300000, 'NGN', true, 'kitchen', 2),
  ('44906180-0000-4000-b000-000000000013', '44906180-0000-4000-b000-000000000001', '44906180-0000-4000-9000-000000000010', 'Y', 100000, 'NGN', true, 'kitchen', 3),
  ('44906180-0000-4000-b000-000000000014', '44906180-0000-4000-b000-000000000001', '44906180-0000-4000-9000-000000000010', 'Z', 500000, 'NGN', true, 'kitchen', 4);
INSERT INTO t3f_ids VALUES ('x', '44906180-0000-4000-b000-000000000011'), ('w', '44906180-0000-4000-b000-000000000012'),
  ('y', '44906180-0000-4000-b000-000000000013'), ('z', '44906180-0000-4000-b000-000000000014');

SELECT public.t3f_as(public.t3f_u(1));
DO $feat$
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44906180-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 't3f-menu-a');
  PERFORM public.issue_4490_set_venue_feature('44906180-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 't3f-till-a');
  PERFORM public.issue_4490_set_venue_feature('44906180-0000-4000-9000-0000000000b1', 'till', true, NULL, NULL, NULL, 't3f-till-b');
END
$feat$;
SELECT public.t3f_reset();

-- A held Till round of n x item (as venue-till inserts it).
CREATE FUNCTION public.t3f_round(p_sale uuid, p_actor uuid, p_item uuid, p_qty integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_order uuid := gen_random_uuid();
  v_price integer;
  v_name text;
BEGIN
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale;
  SELECT price_cents, name INTO v_price, v_name FROM public.menu_items WHERE id = p_item;
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, v_sale.session_id, v_sale.brand_id, v_sale.venue_id, 'staff', p_actor,
    lpad((100 + floor(random() * 800))::int::text, 3, '0'),
    'venue_collected', 'NGN', v_price * p_qty, v_price * p_qty, 0, 0, 0, 0, 0, 0, false, false, false,
    v_price * p_qty, v_price * p_qty, 'pending', 'held', 't3f-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true, 'till_sale_id', p_sale));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, p_item, 1, v_name, v_price, 'NGN', p_qty, 0, v_price * p_qty);
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, p_actor, NULL);
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t3f_ver(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale $f$;
-- A pending guest page order (Paystack) at venue A: lines [[item, qty], ...].
CREATE SEQUENCE public.t3f_pickup START 601;
GRANT USAGE ON SEQUENCE public.t3f_pickup TO PUBLIC;
CREATE FUNCTION public.t3f_guest(p_key text, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_list integer := 0;
  v_fee integer;
  r jsonb;
  n integer := 0;
  v_price integer;
  v_name text;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT price_cents INTO v_price FROM public.menu_items WHERE id = (r->>0)::uuid;
    v_list := v_list + v_price * (r->>1)::integer;
  END LOOP;
  v_fee := round(v_list::numeric * 150 / 10000)::integer;
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.venue_order_sessions (id, brand_id, venue_id, currency)
  VALUES (v_session, '44906180-0000-4000-9000-000000000010', '44906180-0000-4000-9000-0000000000a1', 'NGN');
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, payment_status, paystack_reference, pickup_code, idempotency_key, metadata)
  VALUES (v_order, v_session, '44906180-0000-4000-9000-000000000010', '44906180-0000-4000-9000-0000000000a1',
    'guest_page', 'Ada', 'ada@example.com', '+2348030000000',
    'mingla', 'NGN', v_list, v_list, 0, 0, 0, 0,
    150, 0, v_fee, 0, false, false, false, v_list, 0, v_list,
    'paystack', 'pending', 'mingla_vo_t3f_' || p_key, lpad(nextval('public.t3f_pickup')::text, 3, '0'),
    't3f-guest:' || p_key, '{}'::jsonb);
  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    n := n + 1;
    SELECT price_cents, name INTO v_price, v_name FROM public.menu_items WHERE id = (r->>0)::uuid;
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents, station)
    VALUES (v_order, (r->>0)::uuid, n, v_name, v_price, 'NGN', (r->>1)::integer, 0, v_price * (r->>1)::integer,
      public.issue_4490_item_station((r->>0)::uuid, '44906180-0000-4000-9000-0000000000a1'));
  END LOOP;
  SET LOCAL session_replication_role = origin;
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t3f_pay(p_order uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.pg_venue_order_finalize_payment(o.id, 'paystack', o.total_cents, 'NGN', o.paystack_reference, NULL, NULL, NULL)
  FROM public.venue_orders o WHERE o.id = p_order $f$;
CREATE FUNCTION public.t3f_line(p_order uuid, p_item uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_order_items WHERE venue_order_id = p_order AND menu_item_id = p_item ORDER BY line_no LIMIT 1 $f$;
GRANT EXECUTE ON FUNCTION public.t3f_round(uuid, uuid, uuid, integer), public.t3f_ver(uuid),
  public.t3f_guest(text, jsonb), public.t3f_pay(uuid), public.t3f_line(uuid, uuid) TO PUBLIC;

-- ===========================================================================
-- G. Grants: the take is internal.
-- ===========================================================================
SELECT public.t3f_ok(NOT has_function_privilege('anon', 'public.issue_4490_pin_step_up_take(uuid,uuid,uuid,text,text,text,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4490_pin_step_up_take(uuid,uuid,uuid,text,text,text,boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4490_pin_step_up_take(uuid,uuid,uuid,text,text,text,boolean)', 'EXECUTE'),
  'G1 issue_4490_pin_step_up_take: service role only');
SELECT public.t3f_ok((SELECT pg_get_constraintdef(oid) LIKE '%swap_refund%' FROM pg_constraint
                      WHERE conname = 'venue_pin_approvals_purpose_check')
    AND (SELECT pg_get_constraintdef(oid) LIKE '%swap_refund%' FROM pg_constraint
         WHERE conname = 'venue_pin_attempts_purpose_check'),
  'G2 swap_refund is an approval (and attempt) purpose');

-- PINs (set an hour back so the 24-hour count reads only this suite's tries).
SELECT public.t3f_service();
DO $pins$
BEGIN
  PERFORM public.issue_4490_pin_set(public.t3f_m(1), public.t3f_u(1), '9157');
  PERFORM public.issue_4490_pin_set(public.t3f_m(2), public.t3f_u(2), '2580');
  PERFORM public.issue_4490_pin_set(public.t3f_m(3), public.t3f_u(3), '4826');
END
$pins$;
RESET ROLE;
UPDATE public.brand_member_pins SET set_at = now() - interval '1 hour' WHERE brand_id = '44906180-0000-4000-9000-000000000010';
SELECT public.t3f_service();

-- ===========================================================================

DO $aclose$
DECLARE
  b uuid := '44906180-0000-4000-9000-0000000000b1';
  d date := public.issue_4490_venue_service_date('44906180-0000-4000-9000-0000000000b1', now());
  v jsonb;
BEGIN
  INSERT INTO t3f_ids VALUES ('dayB', d);
  v := public.issue_4490_day_close(b, d, 0, public.t3f_u(1), NULL, gen_random_uuid());
  PERFORM public.t3f_ok(v->>'state' = 'closed', 'A0 the owner closes day B');
  v := public.issue_4490_pin_unlock(b, public.t3f_u(5), public.t3f_m(1), '9157', NULL);
  INSERT INTO t3f_ids VALUES ('tokB', v->>'token');
  -- A1: one approval; the CSV spends it.
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokB')), public.t3f_u(5), b, NULL,
    NULL, '9157', 'export', b::text || ':' || d::text);
  v := public.issue_4490_day_export(b, d, public.t3f_u(1), public.t3f_u(5));
  PERFORM public.t3f_ok(v ? 'rows', 'A1-0 the CSV export runs on its approval');
END
$aclose$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_close_pdf('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  public.t3f_u(1), public.t3f_u(5))$q$, 'P0001', 'pin_step_up_required',
  'A1 the PIN spent on the CSV does not also print the day-close PDF');
DO $a2$
DECLARE
  b uuid := '44906180-0000-4000-9000-0000000000b1';
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokB')), public.t3f_u(5), b, NULL,
    NULL, '9157', 'export', b::text || ':' || (public.t3f_id('dayB')::date - 1)::text);
END
$a2$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_close_pdf('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  public.t3f_u(1), public.t3f_u(5))$q$, 'P0001', 'pin_step_up_required',
  'A2 an export approval for the day before does not print this day');
SELECT public.t3f_ok((SELECT count(*) FROM public.venue_pin_approvals
                       WHERE venue_id = '44906180-0000-4000-9000-0000000000b1' AND purpose = 'export' AND consumed_at IS NULL) = 1,
  'A2b the other day''s approval was not spent by the refused PDF');
DO $a3$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  b uuid := '44906180-0000-4000-9000-0000000000b1';
  v jsonb;
BEGIN
  v := public.issue_4490_pin_unlock(a, public.t3f_u(5), public.t3f_m(1), '9157', NULL);
  INSERT INTO t3f_ids VALUES ('tokA', v->>'token');
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokA')), public.t3f_u(5), a, NULL,
    NULL, '9157', 'export', b::text || ':' || public.t3f_id('dayB'));
END
$a3$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_close_pdf('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  public.t3f_u(1), public.t3f_u(5))$q$, 'P0001', 'pin_step_up_required',
  'A3 an approval made on another venue (even naming this venue''s day) does not print this venue''s PDF');

-- P3-2 ----------------------------------------------------------------------
DO $bstock$
BEGIN
  PERFORM public.issue_4490_stock_set(public.t3f_id('x')::uuid, 0, NULL, public.t3f_u(1), NULL);
  INSERT INTO t3f_ids VALUES
    ('p3', public.t3f_guest('p3', jsonb_build_array(jsonb_build_array(public.t3f_id('x'), 1)))),
    ('p4', public.t3f_guest('p4', jsonb_build_array(jsonb_build_array(public.t3f_id('x'), 1))));
  PERFORM public.t3f_pay(public.t3f_id(k)::uuid) FROM unnest(ARRAY['p3', 'p4']) k;
  PERFORM public.t3f_ok((SELECT count(*) FROM public.venue_order_items i
                         WHERE i.venue_order_id = ANY (ARRAY[public.t3f_id('p3'), public.t3f_id('p4')]::uuid[])
                           AND i.sold_out_at IS NOT NULL) = 2, 'B0 two paid lines sold out after payment');
END
$bstock$;
DO $brefund$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  r jsonb;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokA')), public.t3f_u(5), a, NULL,
    NULL, '9157', 'refund', public.t3f_id('p3'));
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('p3')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('p3')::uuid, public.t3f_id('x')::uuid)], 'refund', NULL,
    public.t3f_u(1), public.t3f_u(5), 'adv-refund');
  PERFORM public.t3f_ok((r->>'refundMinor')::bigint > 0, 'B0b the device refund with its approval is made');
END
$brefund$;
SELECT public.t3f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL, public.t3f_u(6), NULL,
  'adv-refund')$q$, public.t3f_id('p3'), public.t3f_line(public.t3f_id('p3')::uuid, public.t3f_id('x')::uuid)),
  '42501', 'not_authorized', 'B1 a member with no refund rights cannot replay a stored refund');
DO $b2spare$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokA')), public.t3f_u(5), a, NULL,
    NULL, '9157', 'swap_refund', public.t3f_id('p3'));
  INSERT INTO t3f_ids SELECT 'spare', id::text FROM public.venue_pin_approvals
   WHERE venue_id = a AND purpose = 'swap_refund' AND lower(target) = lower(public.t3f_id('p3')) AND consumed_at IS NULL;
END
$b2spare$;
SELECT public.t3f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t3f_u(1), public.t3f_u(5),
  'adv-refund')$q$, public.t3f_id('p3'), public.t3f_line(public.t3f_id('p3')::uuid, public.t3f_id('x')::uuid), public.t3f_id('y')),
  'PT409', 'sold_out_key_reused', 'B2 the same key with the other resolution is refused as a reused key');
SELECT public.t3f_ok((SELECT consumed_at IS NULL FROM public.venue_pin_approvals WHERE id = public.t3f_id('spare')::uuid),
  'B2b the refused reuse spent no approval');
SELECT public.t3f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL, public.t3f_u(1),
  public.t3f_u(5), 'adv-new-refund')$q$, public.t3f_id('p4'), public.t3f_line(public.t3f_id('p4')::uuid, public.t3f_id('x')::uuid)),
  'P0001', 'pin_step_up_required', 'B3 a new sold-out refund on the Till device still needs a fresh PIN');
DO $b4$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  r jsonb;
  v_spare uuid;
  v_refunds integer;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokA')), public.t3f_u(5), a, NULL,
    NULL, '9157', 'swap_refund', public.t3f_id('p4'));
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('p4')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('p4')::uuid, public.t3f_id('x')::uuid)], 'swap', public.t3f_id('y')::uuid,
    public.t3f_u(1), public.t3f_u(5), 'adv-swap-money');
  PERFORM public.t3f_ok((r->>'refundMinor')::bigint > 0, 'B4-0 the money-returning swap is made on its swap_refund approval');
  SELECT count(*) INTO v_refunds FROM public.source_refunds
   WHERE source_type = 'venue_menu_order' AND source_id = public.t3f_id('p4')::uuid;
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokA')), public.t3f_u(5), a, NULL,
    NULL, '9157', 'swap_refund', public.t3f_id('p4'));
  SELECT id INTO v_spare FROM public.venue_pin_approvals
   WHERE venue_id = a AND purpose = 'swap_refund' AND lower(target) = lower(public.t3f_id('p4')) AND consumed_at IS NULL;
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('p4')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('p4')::uuid, public.t3f_id('x')::uuid)], 'swap', public.t3f_id('y')::uuid,
    public.t3f_u(1), public.t3f_u(5), 'adv-swap-money');
  PERFORM public.t3f_ok((r->>'replayed')::boolean
      AND (SELECT count(*) FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = public.t3f_id('p4')::uuid) = v_refunds,
    'B4a the swap retried answers its stored result and moves no money');
  PERFORM public.t3f_ok((SELECT consumed_at IS NULL FROM public.venue_pin_approvals WHERE id = v_spare),
    'B4b the swap retry left the next swap_refund approval unspent');
END
$b4$;
SELECT public.t3f_reset();
DO $done$ BEGIN RAISE NOTICE '==== fix 4 tester adversarial: all checks passed ===='; END $done$;
ROLLBACK;
