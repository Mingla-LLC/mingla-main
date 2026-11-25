-- #4490 spec 08 O1: executable PostgreSQL 17 proof for the Till core
-- (migration 20281203504490). The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-ONE-PRICE | issue #4490 | a Till check's subtotal, service charge and total are written only by issue_4490_till_reprice from its children (menu rounds and offer/balance lines); no client number is ever stored.
-- MINGLA-INVARIANT: I-4490-TILL-TIP-NOT-FEED | issue #4490 | a Till tip lives on venue_till_payments.tip_minor and never enters venue_orders.fee_basis_cents.
-- MINGLA-INVARIANT: I-4490-TILL-CARRIER-NOT-SALES | issue #4490 | a venue_orders row with till_payment_id set is a payment instrument: the #1795 rollup excludes it and issue_3872_order_margin counts a Till sale's money once.
-- MINGLA-INVARIANT: I-4490-TILL-CASH-NOT-MINGLA-MONEY | issue #4490 | cash and own-machine Till payments never touch a provider and their menu rounds stay venue_collected with zero Mingla fees.
-- MINGLA-INVARIANT: I-4490-TILL-LATE-MONEY-NEVER-DROPPED | issue #4490 | money applied to a cancelled or failed Till payment is marked paid_late and lands in overpaid_minor, never dropped.
--
-- Readers of venue_orders (spec 08 §3 O1 "list every reader") recorded here:
--   counts SALES (must exclude carriers): venue_order_metrics_rollup (#1795; patched),
--     issue_4490 Close the day (O5, not yet built).
--   counts MINGLA MONEY (count carriers, exclude Till children): issue_3872_order_margin (re-emitted),
--     payout sweep / pg_venue_order_finalize_payment (money_path = 'mingla' only; children are venue_collected).
--   fulfillment_status readers that ignore 'held'/'payment_only': escalation scan (placed only),
--     biz_venue_order_transition (no legal exit from either), Host queue filter (T2, client).
--
-- FAILS-ON-REVERT: without 20281203504490 the first helper call fails (no issue_4490_till_open).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490o1_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490O1 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490o1_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490O1 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490O1 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490o1_as(p_user uuid)
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
CREATE FUNCTION public.t4490o1_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490o1_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o1_ok(boolean,text), public.t4490o1_expect(text,text,text,text),
  public.t4490o1_as(uuid), public.t4490o1_service(), public.t4490o1_reset() TO PUBLIC;

CREATE TEMP TABLE t4490o1_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490o1_ids TO PUBLIC;
CREATE FUNCTION public.t4490o1_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490o1_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o1_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490o1_date() RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_venue_local_date('44900100-0000-4000-9000-0000000000a1')
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o1_date() TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
-- VENUE_TILL stays as the migration left it (off) until O1-DB1 proves the gate.

-- Users: 01 owner, 02 seller (venue.sell at A), 03 scanner (rank 10), 04 finance
-- manager, 05 Till device at A, 06 kitchen/bar at A, 07 check-in only at A,
-- 08 another brand's owner, 09 seller at venue B only.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900100-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-o1-' || n || '@example.test', now(), now()
FROM generate_series(1, 9) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900100-0000-4000-8000-000000000001', now()), ('44900100-0000-4000-8000-000000000008', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900100-0000-4000-9000-000000000010', '44900100-0000-4000-8000-000000000001',
   'Till O1 4490', 'till-o1-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900100-0000-4000-9000-000000000020', '44900100-0000-4000-8000-000000000008',
   'Till O1 Other 4490', 'till-o1-other-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900100-0000-4000-9000-0000000000a1', '44900100-0000-4000-9000-000000000010', 'tillo1a', 'Till Bar A',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG'),
  ('44900100-0000-4000-9000-0000000000b1', '44900100-0000-4000-9000-000000000010', 'tillo1b', 'Till Bar B',
   6.45, 3.41, 'bar_lounge', 'verified', 'NG'),
  ('44900100-0000-4000-9000-0000000000c1', '44900100-0000-4000-9000-000000000020', 'tillo1c', 'Other Bar',
   6.46, 3.42, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900100-0000-4000-a000-000000000002', '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900100-0000-4000-a000-000000000003', '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-8000-000000000003', 'scanner', now()),
  ('44900100-0000-4000-a000-000000000004', '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-8000-000000000004', 'finance_manager', now()),
  ('44900100-0000-4000-a000-000000000005', '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-8000-000000000005', 'venue_staff', now()),
  ('44900100-0000-4000-a000-000000000006', '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-8000-000000000006', 'venue_staff', now()),
  ('44900100-0000-4000-a000-000000000007', '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-8000-000000000007', 'venue_staff', now()),
  ('44900100-0000-4000-a000-000000000009', '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-8000-000000000009', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900100-0000-4000-a000-000000000002', '44900100-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900100-0000-4000-a000-000000000005', '44900100-0000-4000-9000-0000000000a1', 'till_device',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  ('44900100-0000-4000-a000-000000000006', '44900100-0000-4000-9000-0000000000a1', 'kitchen_bar', ARRAY['venue.kitchen']),
  ('44900100-0000-4000-a000-000000000007', '44900100-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']),
  ('44900100-0000-4000-a000-000000000009', '44900100-0000-4000-9000-0000000000b1', 'custom', ARRAY['venue.sell']);

-- Menu, a table spot, the Till feature on (owner).
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900100-0000-4000-b000-000000000001', '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900100-0000-4000-b000-000000000011', '44900100-0000-4000-b000-000000000001', '44900100-0000-4000-9000-000000000010', 'Chapman', 250000, 'NGN', true),
  ('44900100-0000-4000-b000-000000000012', '44900100-0000-4000-b000-000000000001', '44900100-0000-4000-9000-000000000010', 'Suya', 400000, 'NGN', true);
INSERT INTO public.qr_spots (id, brand_id, venue_id, kind, label, serving_venue_id, code) VALUES
  ('44900100-0000-4000-b000-000000000021', '44900100-0000-4000-9000-000000000010', '44900100-0000-4000-9000-0000000000a1',
   'custom', 'Table 7', '44900100-0000-4000-9000-0000000000a1', 't4490o1t7');
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900100-0000-4000-9000-0000000000a1', '44900100-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;

SELECT public.t4490o1_as('44900100-0000-4000-8000-000000000001');
DO $feat$
BEGIN
  PERFORM public.t4490o1_ok('till' = ANY(public.issue_4490_built_features())
      AND 'kitchen_screens' = ANY(public.issue_4490_feature_keys())
      AND public.issue_4490_feature_parents('kitchen_screens') = ARRAY['menu'],
    'O1-F1 till and kitchen_screens are built features; kitchen_screens needs menu');
  PERFORM public.t4490o1_ok('till' = ANY(public.issue_4490_feature_preset('restaurant'))
      AND 'kitchen_screens' = ANY(public.issue_4490_feature_preset('cafe'))
      AND NOT ('till' = ANY(public.issue_4490_feature_preset('event_space'))),
    'O1-F2 starting presets carry the Till per spec');
  PERFORM public.issue_4490_set_venue_feature('44900100-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'o1-till-on');
  -- TEST-MOD-APPROVED #4490 (08-O3 part A, T8): venue A has kitchen screens, so a sent round waits
  -- for the kitchen (placed) as these assertions expect; without a screen it is delivered at send.
  PERFORM public.issue_4490_set_venue_feature('44900100-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'o1-menu-on-a');
  PERFORM public.issue_4490_set_venue_feature('44900100-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'o1-screens-on-a');
  PERFORM public.issue_4490_set_venue_feature('44900100-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'o1-entry-on');
  PERFORM public.issue_4490_set_venue_feature('44900100-0000-4000-9000-0000000000b1', 'till', true, NULL, NULL, NULL, 'o1-till-on-b');
END
$feat$;
SELECT public.t4490o1_reset();

-- A menu round exactly as the edge inserts it (priced by priceCart; held).
CREATE FUNCTION public.t4490o1_round(p_sale uuid, p_actor uuid, p_qty1 integer, p_qty2 integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_order uuid := gen_random_uuid();
  v_sub integer := 250000 * p_qty1 + 400000 * p_qty2;
  v_sc integer := round(v_sub * 1000 / 10000.0);
BEGIN
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale;
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, qr_spot_id, spot_label_at_order, source, taken_by_user_id, pickup_code,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, v_sale.session_id, v_sale.brand_id, v_sale.venue_id, v_sale.qr_spot_id,
    CASE WHEN v_sale.qr_spot_id IS NOT NULL THEN 'Table 7' END, 'staff', p_actor,
    CASE WHEN v_sale.qr_spot_id IS NULL THEN lpad((100 + floor(random() * 800))::int::text, 3, '0') END,
    'venue_collected', 'NGN', v_sub, v_sub, 0, 1000, v_sc, 0, 0, 0, false, false, false,
    v_sub + v_sc, v_sub + v_sc, 'pending', 'held', 'till-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true, 'till_sale_id', p_sale));
  IF p_qty1 > 0 THEN
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents)
    VALUES (v_order, '44900100-0000-4000-b000-000000000011', 1, 'Chapman', 250000, 'NGN', p_qty1, 0, 250000 * p_qty1);
  END IF;
  IF p_qty2 > 0 THEN
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents)
    VALUES (v_order, '44900100-0000-4000-b000-000000000012', 2, 'Suya', 400000, 'NGN', p_qty2, 0, 400000 * p_qty2);
  END IF;
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o1_round(uuid, uuid, integer, integer) TO PUBLIC;

-- -------------------------------------------------------------------------
-- Rollout gate and who may sell.
-- -------------------------------------------------------------------------
SELECT public.t4490o1_service();
SELECT public.t4490o1_expect(
  $q$SELECT public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
    '44900100-0000-4000-8000-000000000001', NULL, 'Ada', NULL, 'o1-open-flag-off')$q$,
  'P0001', 'till_not_enabled', 'O1-DB1 the Till is refused while VENUE_TILL is off (default)');
SELECT public.t4490o1_reset();
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_TILL';
SELECT public.t4490o1_service();
SELECT public.t4490o1_expect(
  $q$SELECT public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
    '44900100-0000-4000-8000-000000000003', NULL, 'Scan', NULL, 'o1-open-scanner')$q$,
  '42501', 'not_authorized', 'O1-DB2 a scanner without venue.sell cannot open a check');
SELECT public.t4490o1_expect(
  $q$SELECT public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
    '44900100-0000-4000-8000-000000000004', NULL, 'Fin', NULL, 'o1-open-finance')$q$,
  '42501', 'not_authorized', 'O1-DB3 a finance manager may not sell');
SELECT public.t4490o1_expect(
  $q$SELECT public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
    '44900100-0000-4000-8000-000000000009', NULL, 'B', NULL, 'o1-open-seller-b')$q$,
  '42501', 'not_authorized', 'O1-DB4 a seller granted at venue B cannot sell at venue A');
SELECT public.t4490o1_expect(
  $q$SELECT public.issue_4490_till_open('44900100-0000-4000-9000-0000000000c1',
    '44900100-0000-4000-8000-000000000001', NULL, 'X', NULL, 'o1-open-other-brand')$q$,
  'P0001', 'till_not_enabled', 'O1-DB5 another brand''s venue (Till off) refuses');
SELECT public.t4490o1_expect(
  $q$SELECT public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
    '44900100-0000-4000-8000-000000000008', NULL, 'X', NULL, 'o1-open-outsider')$q$,
  '42501', 'not_authorized', 'O1-DB6 another brand''s owner cannot sell here');
SELECT public.t4490o1_reset();
-- Read from the catalogue, never by calling a refused definer function as a
-- client (that once crashed a local PostgreSQL 17 backend; see the #4490 grants suite).
SELECT public.t4490o1_ok(NOT has_function_privilege('authenticated',
    'public.issue_4490_till_open(uuid,uuid,uuid,text,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)', 'EXECUTE'),
  'O1-DB7 a signed-in or anonymous caller cannot call the Till RPCs directly');
SELECT public.t4490o1_reset();

-- -------------------------------------------------------------------------
-- Open, add two rounds, totals equal children, replay, void before send.
-- -------------------------------------------------------------------------
SELECT public.t4490o1_service();
DO $sale$
DECLARE
  v jsonb;
  v2 jsonb;
  v_sale uuid;
  v_r1 uuid;
  v_r2 uuid;
BEGIN
  v := public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
    '44900100-0000-4000-8000-000000000002', NULL, NULL, '44900100-0000-4000-b000-000000000021', 'o1-open-t7');
  v_sale := (v->>'id')::uuid;
  INSERT INTO t4490o1_ids VALUES ('sale1', v_sale);
  PERFORM public.t4490o1_ok(v->>'state' = 'open' AND v->>'spotLabel' = 'Table 7'
      AND (v->>'serverUserId')::uuid = '44900100-0000-4000-8000-000000000002' AND (v->>'totalDueMinor')::bigint = 0,
    'O1-DB8 a seller with only venue.sell opens a check on a table; the server is the seller');
  v2 := public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
    '44900100-0000-4000-8000-000000000002', NULL, NULL, '44900100-0000-4000-b000-000000000021', 'o1-open-t7');
  PERFORM public.t4490o1_ok((v2->>'id')::uuid = v_sale AND (v2->>'replayed')::boolean,
    'O1-DB9 replaying open returns the same check');
  PERFORM public.t4490o1_expect(
    $q$SELECT public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
      '44900100-0000-4000-8000-000000000002', NULL, NULL, '44900100-0000-4000-b000-000000000021', 'o1-open-t7-again')$q$,
    'PT409', 'till_spot_has_check', 'O1-DB10 a table with an open check refuses a second check');

  v_r1 := public.t4490o1_round(v_sale, '44900100-0000-4000-8000-000000000002', 2, 0);
  v := public.issue_4490_till_attach_round(v_sale, v_r1, '44900100-0000-4000-8000-000000000002', NULL);
  v_r2 := public.t4490o1_round(v_sale, '44900100-0000-4000-8000-000000000002', 0, 1);
  v := public.issue_4490_till_attach_round(v_sale, v_r2, '44900100-0000-4000-8000-000000000002', (v->>'version')::integer);
  INSERT INTO t4490o1_ids VALUES ('r1', v_r1), ('r2', v_r2);
  -- 2 x 2,500.00 + 1 x 4,000.00 = 9,000.00; 10% service charge = 900.00.
  PERFORM public.t4490o1_ok((v->>'subtotalMinor')::bigint = 900000 AND (v->>'serviceChargeMinor')::bigint = 90000
      AND (v->>'totalDueMinor')::bigint = 990000
      AND (v->>'totalDueMinor')::bigint = (SELECT sum(total_cents) FROM public.venue_orders WHERE id IN (v_r1, v_r2)),
    'O1-DB11 the check total equals its children (I-4490-TILL-ONE-PRICE)');
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_attach_round(%L, %L, '44900100-0000-4000-8000-000000000002', 1)$q$,
      v_sale, v_r1),
    'PT409', 'till_check_changed', 'O1-DB12 a stale version is refused (T10)');
  PERFORM public.t4490o1_ok((SELECT bool_and(fulfillment_status = 'held') FROM public.venue_orders WHERE id IN (v_r1, v_r2)),
    'O1-DB13 unsent rounds are held, never placed (T1)');

  -- Void one unit-line of an unsent round as a plain seller.
  v := public.issue_4490_till_void(v_sale, NULL,
    (SELECT id FROM public.venue_order_items WHERE venue_order_id = v_r2), '44900100-0000-4000-8000-000000000002',
    'mistake', true, NULL);
  PERFORM public.t4490o1_ok((v->>'totalDueMinor')::bigint = 550000
      AND (SELECT fulfillment_status FROM public.venue_orders WHERE id = v_r2) = 'cancelled'
      AND (SELECT voided_by_user_id FROM public.venue_order_items WHERE venue_order_id = v_r2)
          = '44900100-0000-4000-8000-000000000002',
    'O1-DB14 voiding the only item of an unsent round cancels it and restores the total');
END
$sale$;

-- Send, then a sent item needs money rights; a per-item void reprices.
DO $send$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490o1_id('sale1');
  v_r3 uuid;
  v_item uuid;
BEGIN
  v_r3 := public.t4490o1_round(v_sale, '44900100-0000-4000-8000-000000000002', 1, 1);
  v := public.issue_4490_till_attach_round(v_sale, v_r3, '44900100-0000-4000-8000-000000000002', NULL);
  v := public.issue_4490_till_send(v_sale, '44900100-0000-4000-8000-000000000002');
  PERFORM public.t4490o1_ok(jsonb_array_length(v->'sentOrderIds') = 2
      AND (SELECT bool_and(fulfillment_status = 'placed' AND sent_at IS NOT NULL) FROM public.venue_orders
           WHERE id IN (v_r3, public.t4490o1_id('r1'))),
    'O1-DB15 send moves held rounds to placed with sent_at');
  SELECT id INTO v_item FROM public.venue_order_items WHERE venue_order_id = v_r3 AND item_name_at_order = 'Suya';
  INSERT INTO t4490o1_ids VALUES ('r3', v_r3), ('r3suya', v_item);
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_void(%L, NULL, %L, '44900100-0000-4000-8000-000000000002', 'mistake', false, NULL)$q$,
      v_sale, v_item),
    '42501', 'till_void_needs_money_rights', 'O1-DB16 a seller without money rights cannot void a sent item');
  v := public.issue_4490_till_void(v_sale, NULL, v_item, '44900100-0000-4000-8000-000000000001', 'guest_changed_mind', false, NULL);
  -- Round 3 is now one Chapman: 2,500.00 + 250.00.
  PERFORM public.t4490o1_ok((SELECT total_cents FROM public.venue_orders WHERE id = v_r3) = 275000
      AND (SELECT list_subtotal_cents - discount_cents = subtotal_cents FROM public.venue_orders WHERE id = v_r3)
      AND (v->>'totalDueMinor')::bigint = 550000 + 275000,
    'O1-DB17 a per-item void reprices its round and the check (owner has money rights)');
END
$send$;
SELECT public.t4490o1_reset();

-- -------------------------------------------------------------------------
-- Pay: version, cap, tips, change, part payment, then full; idempotent.
-- -------------------------------------------------------------------------
SELECT public.t4490o1_service();
DO $pay$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490o1_id('sale1');
  v_version integer;
  v_req uuid := gen_random_uuid();
  v_pay uuid;
BEGIN
  SELECT version INTO v_version FROM public.venue_till_sales WHERE id = v_sale;
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 100000, 0, 100000,
      '44900100-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, v_sale, v_version - 1),
    'PT409', 'till_check_changed', 'O1-DB18 a payment on a stale check moves no money (T10)');
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 900000, 0, 900000,
      '44900100-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, v_sale, v_version),
    '22023', 'till_amount_over_due', 'O1-DB19 more than is due is refused');
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 100000, 0, 50000,
      '44900100-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, v_sale, v_version),
    '22023', 'till_invalid_payload', 'O1-DB20 cash given below the amount is refused');
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'transfer', 100000, 0, NULL,
      '44900100-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, v_sale, v_version),
    '22023', 'till_invalid_payload', 'O1-DB21 hand-recorded transfer is not a Till method (spec 08 §9.3)');

  -- Part payment by the venue's own card machine, with a tip.
  v := public.issue_4490_till_take_payment(v_sale, 'own_machine', 300000, 30000, NULL,
    '44900100-0000-4000-8000-000000000002', NULL, gen_random_uuid(), v_version);
  PERFORM public.t4490o1_ok((v->>'salePaid')::boolean = false AND (v#>>'{sale,paidMinor}')::bigint = 300000
      AND (v#>>'{sale,state}') = 'open',
    'O1-DB22 a part payment leaves the check open with the rest due');
  PERFORM public.t4490o1_ok((SELECT service_charge_minor FROM public.venue_till_payments WHERE id = (v->>'paymentId')::uuid)
      = floor(75000::numeric * 300000 / 825000 + 0.5),
    'O1-DB23 a part payment carries its pro-rata share of the service charge');

  -- The rest in cash with change.
  SELECT version INTO v_version FROM public.venue_till_sales WHERE id = v_sale;
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 525000, 0, 600000,
    '44900100-0000-4000-8000-000000000002', NULL, v_req, v_version);
  v_pay := (v->>'paymentId')::uuid;
  INSERT INTO t4490o1_ids VALUES ('cashpay', v_pay);
  PERFORM public.t4490o1_ok((v->>'salePaid')::boolean AND (v->>'changeMinor')::bigint = 75000
      AND (v#>>'{sale,state}') = 'paid' AND (v#>>'{sale,businessDate}') IS NOT NULL,
    'O1-DB24 cash with change pays the check in full');
  PERFORM public.t4490o1_ok(
    (SELECT sum(service_charge_minor) FROM public.venue_till_payments WHERE sale_id = v_sale) = 75000,
    'O1-DB25 the payments'' service charge shares sum to the check''s service charge');
  PERFORM public.t4490o1_ok(
    (SELECT bool_and(payment_status = 'paid' AND money_path = 'venue_collected' AND mingla_fee_cents = 0
                     AND platform_service_fee_cents = 0 AND tip_cents = 0 AND fee_basis_cents = subtotal_cents + service_charge_cents)
     FROM public.venue_orders WHERE session_id = (SELECT session_id FROM public.venue_till_sales WHERE id = v_sale)
       AND fulfillment_status <> 'cancelled')
    AND (SELECT settlement_method FROM public.venue_order_sessions s JOIN public.venue_till_sales t ON t.session_id = s.id
         WHERE t.id = v_sale) = 'till',
    'O1-DB26 paid rounds stay venue_collected with no fee and no tip (I-4490-TILL-TIP-NOT-FEED, CASH-NOT-MINGLA-MONEY)');

  -- Replays: the same client request returns the same payment; apply is idempotent.
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 525000, 0, 600000,
    '44900100-0000-4000-8000-000000000002', NULL, v_req, NULL);
  PERFORM public.t4490o1_ok((v->>'paymentId')::uuid = v_pay AND (v->>'replayed')::boolean,
    'O1-DB27 a retried cash tap returns the payment it made');
  v := public.issue_4490_till_apply_payment(v_pay);
  PERFORM public.t4490o1_ok((v->>'replayed')::boolean
      AND (SELECT paid_minor FROM public.venue_till_sales WHERE id = v_sale) = 825000,
    'O1-DB28 apply_payment twice confirms once');
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_void(%L, %L, NULL, '44900100-0000-4000-8000-000000000001', 'x', false, NULL)$q$,
      v_sale, (SELECT id FROM public.venue_till_lines WHERE venue_order_id = public.t4490o1_id('r1'))),
    'PT409', 'till_line_paid', 'O1-DB29 a paid line cannot be voided (refund instead)');
END
$pay$;

-- Refunds: money rights; tip last; finance manager may refund.
DO $refund$
DECLARE
  v jsonb;
  v_pay uuid := public.t4490o1_id('cashpay');
  v_machine uuid;
BEGIN
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_refund(%L, 1000, 0, 'wrong_item', false,
      '44900100-0000-4000-8000-000000000002', NULL, gen_random_uuid())$q$, v_pay),
    '42501', 'not_authorized', 'O1-DB30 a seller without money rights cannot refund');
  v := public.issue_4490_till_refund(v_pay, 100000, 0, 'wrong_item', false,
    '44900100-0000-4000-8000-000000000004', NULL, gen_random_uuid());
  PERFORM public.t4490o1_ok((SELECT state FROM public.venue_till_payments WHERE id = v_pay) = 'partially_refunded'
      AND (v#>>'{sale,state}') = 'partially_refunded',
    'O1-DB31 a finance manager refunds part of a cash payment');
  SELECT id INTO v_machine FROM public.venue_till_payments
  WHERE sale_id = public.t4490o1_id('sale1') AND method = 'own_machine';
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_refund(%L, 0, 30000, 'tip', false,
      '44900100-0000-4000-8000-000000000004', NULL, gen_random_uuid())$q$, v_machine),
    '22023', 'till_refund_tip_last', 'O1-DB32 the tip is refunded last');
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_refund(%L, 300001, 0, 'x', false,
      '44900100-0000-4000-8000-000000000004', NULL, gen_random_uuid())$q$, v_machine),
    '22023', 'till_refund_over_paid', 'O1-DB33 a refund above what was paid is refused');
  v := public.issue_4490_till_refund(v_machine, 300000, 30000, 'all', false,
    '44900100-0000-4000-8000-000000000004', NULL, gen_random_uuid());
  PERFORM public.t4490o1_ok((SELECT state FROM public.venue_till_payments WHERE id = v_machine) = 'refunded',
    'O1-DB34 amount and tip together refund the whole payment');
END
$refund$;

-- Late money: a payment cancelled before it lands goes to overpaid.
DO $late$
DECLARE
  v jsonb;
  v_sale uuid;
  v_r uuid;
  v_pay uuid;
BEGIN
  v := public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
    '44900100-0000-4000-8000-000000000005', NULL, 'Counter', NULL, 'o1-open-counter');
  v_sale := (v->>'id')::uuid;
  INSERT INTO t4490o1_ids VALUES ('sale2', v_sale);
  v_r := public.t4490o1_round(v_sale, '44900100-0000-4000-8000-000000000005', 1, 0);
  v := public.issue_4490_till_attach_round(v_sale, v_r, '44900100-0000-4000-8000-000000000005', NULL);
  PERFORM public.t4490o1_ok((SELECT pickup_code IS NOT NULL AND buyer_name IS NULL FROM public.venue_orders WHERE id = v_r),
    'O1-DB35 a counter round with no name is allowed for a Till check');
  -- TEST-MOD-APPROVED #4490 (08-O5 part A): a Till device login is never the actor of a payment row
  -- (I-4490-TILL-DEVICE-NEVER-ACTS-ALONE, 20281203684490), so this hand-written cancelled payment is
  -- taken by the seller (02); the late-money rule it proves is unchanged.
  INSERT INTO public.venue_till_payments (sale_id, method, amount_minor, tip_minor, state, taken_by_user_id,
    device_user_id, server_user_id, client_request_id, cash_given_minor)
  VALUES (v_sale, 'own_machine', 275000, 0, 'cancelled', '44900100-0000-4000-8000-000000000002',
    '44900100-0000-4000-8000-000000000002', '44900100-0000-4000-8000-000000000005', gen_random_uuid(), NULL)
  RETURNING id INTO v_pay;
  v := public.issue_4490_till_apply_payment(v_pay);
  PERFORM public.t4490o1_ok((v->>'paidLate')::boolean
      AND (SELECT overpaid_minor FROM public.venue_till_sales WHERE id = v_sale) = 275000
      AND (SELECT paid_minor FROM public.venue_till_sales WHERE id = v_sale) = 0,
    'O1-DB36 money on a cancelled payment is kept in overpaid_minor (I-4490-TILL-LATE-MONEY-NEVER-DROPPED)');
  -- The carrier shape (O2) passes both relaxed CHECKs with no name or contact.
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, source, taken_by_user_id, money_path, currency, subtotal_cents,
    service_charge_bps, service_charge_cents, tip_cents, effective_take_rate_bps, service_fee_bps,
    mingla_fee_cents, platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, provider, payment_status, fulfillment_status, idempotency_key, till_payment_id
  ) SELECT session_id, brand_id, venue_id, 'staff', '44900100-0000-4000-8000-000000000005', 'mingla', 'NGN', 250000,
    0, 25000, 0, 500, 0, 13750, 0, false, false, false, 275000, 275000, 'paystack', 'paid', 'payment_only',
    'till-carrier:' || v_pay, v_pay
  FROM public.venue_till_sales WHERE id = v_sale;
  PERFORM public.t4490o1_ok(true, 'O1-DB37 a carrier with no name or contact passes destination_shape and paid_needs_contact');
  PERFORM public.t4490o1_ok(NOT EXISTS (
      SELECT 1 FROM public.issue_3872_order_margin m WHERE m.order_id = v_r),
    'O1-DB38 issue_3872_order_margin skips a Till child (its carrier is the money)');
  PERFORM public.t4490o1_ok(EXISTS (
      SELECT 1 FROM public.issue_3872_order_margin m
      WHERE m.order_id = (SELECT id FROM public.venue_orders WHERE till_payment_id = v_pay)),
    'O1-DB39 issue_3872_order_margin counts the card carrier once');
END
$late$;
SELECT public.t4490o1_reset();

-- #1795 rollup never counts a carrier as a sale.
SELECT public.t4490o1_as('44900100-0000-4000-8000-000000000001');
DO $rollup$
DECLARE v jsonb;
BEGIN
  v := public.venue_order_metrics_rollup('44900100-0000-4000-9000-000000000010', '44900100-0000-4000-9000-0000000000a1');
  PERFORM public.t4490o1_ok(position('till_payment_id IS NULL' IN pg_get_functiondef(
      'public.venue_order_metrics_rollup(uuid,uuid)'::regprocedure)) > 0,
    'O1-DB40 the #1795 rollup excludes Till carriers wherever it excludes tab settlements');
END
$rollup$;
-- T1: the queue's transition RPC has no exit from held.
SELECT public.t4490o1_expect(
  format($q$SELECT public.biz_venue_order_transition(%L, 'acknowledged')$q$,
    (SELECT o.id FROM public.venue_orders o JOIN public.venue_till_sales s ON s.session_id = o.session_id
     WHERE s.id = public.t4490o1_id('sale2') AND o.fulfillment_status = 'held' LIMIT 1)),
  'P0001', 'transition_not_allowed', 'O1-DB41 a held Till round cannot be moved by the Orders queue (T1)');
SELECT public.t4490o1_reset();

-- -------------------------------------------------------------------------
-- RLS: who reads what (T3 and the new tables).
-- -------------------------------------------------------------------------
SELECT public.t4490o1_as('44900100-0000-4000-8000-000000000005');
SELECT public.t4490o1_ok(
  (SELECT count(*) FROM public.venue_orders WHERE venue_id = '44900100-0000-4000-9000-0000000000a1') > 0
  AND (SELECT count(*) FROM public.venue_order_items i JOIN public.venue_orders o ON o.id = i.venue_order_id
       WHERE o.venue_id = '44900100-0000-4000-9000-0000000000a1') > 0
  AND (SELECT count(*) FROM public.venue_till_sales) = 2,
  'O1-RLS1 a Till device login reads its venue''s orders, items and checks (T3)');
SELECT public.t4490o1_reset();
SELECT public.t4490o1_as('44900100-0000-4000-8000-000000000006');
SELECT public.t4490o1_ok(
  (SELECT count(*) FROM public.venue_orders WHERE venue_id = '44900100-0000-4000-9000-0000000000a1') > 0,
  'O1-RLS2 a kitchen login reads its venue''s orders (T3)');
SELECT public.t4490o1_reset();
SELECT public.t4490o1_as('44900100-0000-4000-8000-000000000007');
SELECT public.t4490o1_ok(
  (SELECT count(*) FROM public.venue_orders WHERE venue_id = '44900100-0000-4000-9000-0000000000a1') = 0,
  'O1-RLS3 a check-in-only member reads no orders');
SELECT public.t4490o1_reset();
SELECT public.t4490o1_as('44900100-0000-4000-8000-000000000009');
SELECT public.t4490o1_ok(
  (SELECT count(*) FROM public.venue_orders WHERE venue_id = '44900100-0000-4000-9000-0000000000a1') = 0
  AND (SELECT count(*) FROM public.venue_till_sales) = 0,
  'O1-RLS4 a seller at venue B reads none of venue A''s orders or checks');
SELECT public.t4490o1_reset();
SELECT public.t4490o1_as('44900100-0000-4000-8000-000000000008');
SELECT public.t4490o1_ok((SELECT count(*) FROM public.venue_till_sales) = 0
    AND (SELECT count(*) FROM public.venue_till_payments) = 0
    AND (SELECT count(*) FROM public.venue_till_lines) = 0,
  'O1-RLS5 another brand''s owner reads no checks, lines or payments');
SELECT public.t4490o1_expect('SELECT receipt_email FROM public.venue_till_payments', '42501', NULL,
  'O1-RLS6 receipt contact columns are not readable by a signed-in client');
SELECT public.t4490o1_expect($q$UPDATE public.venue_till_sales SET total_due_minor = 1$q$, '42501', NULL,
  'O1-RLS7 no client writes a check');
SELECT public.t4490o1_reset();
SELECT public.t4490o1_as(NULL);
SELECT public.t4490o1_expect('SELECT count(*) FROM public.venue_till_sales', '42501', NULL,
  'O1-RLS8 an anonymous caller reads nothing');
SELECT public.t4490o1_reset();
SELECT public.t4490o1_as('44900100-0000-4000-8000-000000000001');
SELECT public.t4490o1_ok((SELECT count(*) FROM public.venue_till_payments) = 3,
  'O1-RLS9 the owner reads the venue''s payments');
SELECT public.t4490o1_reset();

-- -------------------------------------------------------------------------
-- Entry sold at the Till: held places, void releases them, payment admits.
-- Spec 07 §11 B3: a reduced-window guest-list arrival is marked once.
-- -------------------------------------------------------------------------
SELECT public.t4490o1_as('44900100-0000-4000-8000-000000000001');
DO $offer_setup$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_option uuid;
  v_version bigint;
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44900100-0000-4000-9000-0000000000a1', 'guest_list', true, NULL, NULL, NULL, 'o1-gl-on');
  v := public.issue_4490_manage_capacity_pool('create', '44900100-0000-4000-9000-0000000000a1',
    '{"name":"Door","dailyLimit":10,"keptForWalkIns":4}'::jsonb, NULL, 'o1-pool-create');
  v_pool := (v->>'id')::uuid;
  INSERT INTO t4490o1_ids VALUES ('pool', v_pool);
  v := public.issue_4490_manage_offer('create_draft', '44900100-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Door entry","entryStyle":"walk_in"}'::jsonb, NULL, 'o1-offer-create');
  v_offer := (v->>'id')::uuid; v_version := (v->>'version')::bigint;
  INSERT INTO t4490o1_ids VALUES ('offer', v_offer);
  v := public.issue_4490_manage_offer('set_pool', '44900100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_version, 'o1-pool-set');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '44900100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Standard', 'unit', 'guest', 'guestMin', 1, 'guestMax', 10,
      'priceMinor', 500000), v_version, 'o1-price-set');
  v_version := (v->>'version')::bigint;
  SELECT (row->>'id')::uuid INTO v_option FROM jsonb_array_elements(v->'options') row WHERE row->>'name' = 'Standard';
  INSERT INTO t4490o1_ids VALUES ('option', v_option);
  v := public.issue_4490_manage_offer('set_policy', '44900100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', '[]'::jsonb, 'dateChangeRule', '{}'::jsonb), v_version, 'o1-policy');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', '44900100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'mode', 'full_day', 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'startTime', '00:00', 'endTime', '23:59'), v_version, 'o1-schedule');
  v_version := (v->>'version')::bigint;
  PERFORM public.issue_4490_manage_offer('publish', '44900100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer), v_version, 'o1-publish');
  v := public.issue_4490_manage_guest_list('set_terms', '44900100-0000-4000-9000-0000000000a1',
    jsonb_build_object('freeUntil', NULL, 'reducedUntil', '23:59', 'reducedPriceOptionId', v_option,
      'plusOnesMax', 3, 'closesMinutesBefore', 0), NULL, 'o1-gl-terms');
  v := public.issue_4490_manage_guest_list('add_entry', '44900100-0000-4000-9000-0000000000a1',
    jsonb_build_object('localDate', public.t4490o1_date(),
      'guestName', 'Tunde List', 'plusOnes', 1), NULL, 'o1-gl-add');
  INSERT INTO t4490o1_ids VALUES ('entry', (v#>>'{entry,id}')::uuid);
END
$offer_setup$;
SELECT public.t4490o1_reset();

SELECT public.t4490o1_service();
DO $offer$
DECLARE
  v jsonb;
  v_sale uuid;
  v_line uuid;
  v_group uuid;
  v_used_before integer;
  v_used_held integer;
BEGIN
  v := public.issue_4490_admit_guest_list('44900100-0000-4000-9000-0000000000a1', public.t4490o1_id('entry'), 2,
    '44900100-0000-4000-8000-000000000001');
  PERFORM public.t4490o1_ok(v->>'result' = 'sell_in_till' AND (v->>'priceOptionId')::uuid = public.t4490o1_id('option')
      AND (v->>'guestListEntryId')::uuid = public.t4490o1_id('entry'),
    'O1-GL1 a reduced-window arrival is sent to the Till when the Till is on (spec 07 B3)');
  v := public.issue_4490_till_open('44900100-0000-4000-9000-0000000000a1',
    '44900100-0000-4000-8000-000000000002', NULL, 'Door', NULL, 'o1-open-door');
  v_sale := (v->>'id')::uuid;
  INSERT INTO t4490o1_ids VALUES ('sale3', v_sale);
  SELECT gate_left INTO v_used_before FROM public.issue_4490_pool_day_usage(public.t4490o1_id('pool'),
    public.t4490o1_date());
  -- A plain entry line, then void it: places come back.
  v := public.issue_4490_till_add_offer_line(v_sale, public.t4490o1_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490o1_id('option'), 'guests', 2)),
    '44900100-0000-4000-8000-000000000002', 'o1-entry-line-1');
  SELECT (l->>'id')::uuid, (l->>'groupId')::uuid INTO v_line, v_group
  FROM jsonb_array_elements(v->'lines') l WHERE l->>'kind' = 'entry';
  SELECT gate_left INTO v_used_held FROM public.issue_4490_pool_day_usage(public.t4490o1_id('pool'),
    public.t4490o1_date());
  PERFORM public.t4490o1_ok((v->>'totalDueMinor')::bigint = 1000000 AND v_used_held = v_used_before - 2
      AND (SELECT payment_collection FROM public.stay_reservation_groups WHERE id = v_group) = 'till'
      AND (SELECT till_sale_id FROM public.stay_reservation_groups WHERE id = v_group) = v_sale,
    'O1-OF1 an entry line holds two places, priced by the server, collected by the Till');
  v := public.issue_4490_till_void(v_sale, v_line, NULL, '44900100-0000-4000-8000-000000000002', 'mistake', true, NULL);
  PERFORM public.t4490o1_ok((v->>'totalDueMinor')::bigint = 0
      AND (SELECT gate_left FROM public.issue_4490_pool_day_usage(public.t4490o1_id('pool'),
            public.t4490o1_date())) = v_used_before
      AND (SELECT state FROM public.stay_reservation_groups WHERE id = v_group) = 'cancelled',
    'O1-OF2 voiding an unpaid entry line frees its places at once');

  -- The guest-list line at the reduced price: paid in cash, admitted once.
  PERFORM public.t4490o1_expect(
    format($q$SELECT public.issue_4490_till_add_offer_line(%L, %L, NULL,
      jsonb_build_array(jsonb_build_object('priceOptionId', %L, 'guests', 3)),
      '44900100-0000-4000-8000-000000000002', 'o1-gl-line-too-many', %L)$q$,
      v_sale, public.t4490o1_id('offer'), public.t4490o1_id('option'), public.t4490o1_id('entry')),
    '22023', 'admit_count_invalid', 'O1-GL2 a guest-list line cannot admit more than the name plus its plus-ones');
  v := public.issue_4490_till_add_offer_line(v_sale, public.t4490o1_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490o1_id('option'), 'guests', 2)),
    '44900100-0000-4000-8000-000000000002', 'o1-gl-line', public.t4490o1_id('entry'));
  SELECT (l->>'groupId')::uuid INTO v_group FROM jsonb_array_elements(v->'lines') l
  WHERE l->>'kind' = 'entry' AND l->>'state' = 'held';
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 1000000, 0, 1000000,
    '44900100-0000-4000-8000-000000000002', NULL, gen_random_uuid(), (v->>'version')::integer);
  PERFORM public.t4490o1_ok((v->>'salePaid')::boolean
      AND (SELECT state FROM public.stay_reservation_groups WHERE id = v_group) = 'confirmed'
      AND (SELECT admitted_count FROM public.venue_passes WHERE group_id = v_group) = 2
      AND (SELECT arrived FROM public.venue_guest_list_entries WHERE id = public.t4490o1_id('entry')) = 2,
    'O1-GL3 paying confirms the booking, admits both guests and marks the list name arrived');
  PERFORM public.t4490o1_ok(
    (SELECT count(*) FROM public.venue_offline_payments WHERE group_id = v_group AND method = 'till') = 1
    AND (SELECT balance FROM public.issue_4490_booking_money(v_group)) = 0,
    'O1-OF3 the Till payment pays the booking through one offline payment row (balance 0)');
  v := public.issue_4490_till_apply_payment((SELECT id FROM public.venue_till_payments WHERE sale_id = v_sale));
  PERFORM public.t4490o1_ok((SELECT arrived FROM public.venue_guest_list_entries WHERE id = public.t4490o1_id('entry')) = 2,
    'O1-GL4 applying the same payment again marks the arrival exactly once');
END
$offer$;
SELECT public.t4490o1_reset();

-- -------------------------------------------------------------------------
-- T18 + cutover: a legacy tab (an older Host app) appears in Open checks.
-- -------------------------------------------------------------------------
SELECT public.t4490o1_service();
DO $tab$
DECLARE
  v jsonb;
  v_session uuid;
BEGIN
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
  VALUES ('44900100-0000-4000-9000-000000000010', '44900100-0000-4000-9000-0000000000a1', 'NGN')
  RETURNING id INTO v_session;
  UPDATE public.venue_order_sessions SET tab_state = 'open', opened_by_user_id = '44900100-0000-4000-8000-000000000001'
  WHERE id = v_session;
  v := public.issue_4490_till_checks('44900100-0000-4000-9000-0000000000a1', '44900100-0000-4000-8000-000000000002');
  PERFORM public.t4490o1_ok(EXISTS (
      SELECT 1 FROM jsonb_array_elements(v->'open') c
      WHERE (c->>'id')::uuid = (SELECT id FROM public.venue_till_sales WHERE session_id = v_session)),
    'O1-T18 a tab opened by an older Host app appears in Open checks');
  PERFORM public.t4490o1_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'paid') c
      WHERE (c->>'id')::uuid = public.t4490o1_id('sale3')),
    'O1-CK1 checks lists today''s paid checks too (A1)');
  PERFORM public.t4490o1_expect(
    $q$SELECT public.issue_4490_till_checks('44900100-0000-4000-9000-0000000000a1', '44900100-0000-4000-8000-000000000007')$q$,
    '42501', 'not_authorized', 'O1-CK2 a check-in-only member cannot list checks');
END
$tab$;

-- Settings: brand_admin+ only; values validated.
SELECT public.t4490o1_expect(
  $q$SELECT public.issue_4490_till_settings_set('44900100-0000-4000-9000-0000000000a1', '{"tipsEnabled":false}'::jsonb,
    '44900100-0000-4000-8000-000000000002', NULL)$q$,
  '42501', 'not_authorized', 'O1-S1 a seller cannot change Till settings');
DO $settings$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_settings_set('44900100-0000-4000-9000-0000000000a1',
    '{"tipsEnabled":false,"dayStartsAt":"04:30"}'::jsonb, '44900100-0000-4000-8000-000000000001', NULL);
  PERFORM public.t4490o1_ok(v->>'dayStartsAt' = '04:30' AND (v->>'tipsEnabled')::boolean = false,
    'O1-S2 the owner sets tips off and the day start');
  PERFORM public.t4490o1_expect(
    $q$SELECT public.issue_4490_till_settings_set('44900100-0000-4000-9000-0000000000a1',
      '{"autoLockMinutes":99}'::jsonb, '44900100-0000-4000-8000-000000000001', NULL)$q$,
    '22023', 'till_settings_invalid', 'O1-S3 an out-of-range setting is refused in words');
END
$settings$;
SELECT public.t4490o1_reset();

-- Catalog: what the Till sells and what the caller may do.
SELECT public.t4490o1_service();
DO $catalog$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_catalog('44900100-0000-4000-9000-0000000000a1', '44900100-0000-4000-8000-000000000002');
  PERFORM public.t4490o1_ok(jsonb_array_length(v#>'{menus,0,items}') = 2 AND (v->>'serviceChargeBps')::int = 1000
      AND (v->>'canManageMoney')::boolean = false
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'spots') sp WHERE sp->>'label' = 'Table 7'),
    'O1-CAT1 the catalog lists the menu, tables and the service charge; a seller has no money rights');
  PERFORM public.t4490o1_expect(
    $q$SELECT public.issue_4490_till_catalog('44900100-0000-4000-9000-0000000000a1', '44900100-0000-4000-8000-000000000006')$q$,
    '42501', 'not_authorized', 'O1-CAT2 a kitchen-only login cannot open the Till');
END
$catalog$;
SELECT public.t4490o1_reset();

ROLLBACK;
