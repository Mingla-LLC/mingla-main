-- #4490 spec 08 O5 (O5A PINs, O5B close and drawer, O5C stock, 08-O5 fix 1
-- and fix 2): the INDEPENDENT tester's adversarial PostgreSQL 17 suite.
-- Different angles from the implementor suites: brute force spread over two
-- devices and every step-up purpose, cross-brand / cross-venue / cross-device
-- PIN use, the scope of a step-up approval inside the money-row backstop,
-- drawer arithmetic with a replaced float, snapshot tampering by the service
-- role, a stale close retried after a reopen, and a randomised money property
-- over sold-out-after-payment resolutions followed by the whole-order refund
-- (every order gives back exactly what was paid, never more; Mingla's fee is
-- reversed exactly once).
--
-- Two kinds of check:
--   t9_ok / t9_expect  STRICT: the money rules the issue states. A failure
--                      aborts the suite (ON_ERROR_STOP) and is a defect.
--   t9_probe           a SUSPECTED defect found by reading. It never aborts;
--                      it prints "PROBE-HOLDS" (the rule held, the suspicion
--                      is cleared) or "PROBE-FINDING" (the defect is real) and
--                      the summary at the end lists every finding.
-- The suite owns its fixture and rolls back.
--
-- 08-O5 fix 3: every probe (P1-P9) is now a STRICT check (t9_ok): the fix
-- round made each one hold, so a regression aborts the suite.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t9_findings (n serial, label text) ON COMMIT DROP;
GRANT ALL ON t9_findings TO PUBLIC;
GRANT USAGE ON SEQUENCE t9_findings_n_seq TO PUBLIC;
CREATE TEMP TABLE t9_ids (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON t9_ids TO PUBLIC;

CREATE FUNCTION public.t9_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T9 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t9_probe(p_holds boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF COALESCE(p_holds, false) THEN
    RAISE NOTICE 'PROBE-HOLDS    %', p_label;
  ELSE
    INSERT INTO t9_findings (label) VALUES (p_label);
    RAISE NOTICE 'PROBE-FINDING  %', p_label;
  END IF;
END
$f$;
CREATE FUNCTION public.t9_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF (p_state IS NOT NULL AND SQLSTATE <> p_state) OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T9 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  % [% %]', p_label, SQLSTATE, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'T9 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
-- Runs p_sql; true when it raised (any error), false when it succeeded.
CREATE FUNCTION public.t9_raises(p_sql text)
RETURNS boolean LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '        (raised % %)', SQLSTATE, SQLERRM;
    RETURN true;
  END;
  RETURN false;
END
$f$;
CREATE FUNCTION public.t9_as(p_user uuid)
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
CREATE FUNCTION public.t9_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t9_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
CREATE FUNCTION public.t9_id(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM t9_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t9_u(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('44909990-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $f$;
CREATE FUNCTION public.t9_m(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('44909990-0000-4000-a000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $f$;
CREATE FUNCTION public.t9_hash(p_token text) RETURNS bytea LANGUAGE sql AS $f$
  SELECT extensions.digest(decode(p_token, 'hex'), 'sha256') $f$;
GRANT EXECUTE ON FUNCTION public.t9_ok(boolean, text), public.t9_probe(boolean, text),
  public.t9_expect(text, text, text, text), public.t9_raises(text), public.t9_as(uuid), public.t9_service(),
  public.t9_reset(), public.t9_id(text), public.t9_u(integer), public.t9_m(integer), public.t9_hash(text) TO PUBLIC;

-- Venues: A and B (brand 10, the Till on at both), C (brand 20, another owner).
\set va '''44909990-0000-4000-9000-0000000000a1'''
\set vb '''44909990-0000-4000-9000-0000000000b1'''
\set vc '''44909990-0000-4000-9000-0000000000c1'''

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner (10); 02 seller at A; 03 restaurant manager at A (money);
-- 04 brand finance manager; 05 Till device at A and B; 06 kitchen at A;
-- 08 owner of brand 20; 09 a second Till device at A; 11 brand event manager.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT public.t9_u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  't9-o5-' || n || '@example.test', now(), now()
FROM unnest(ARRAY[1, 2, 3, 4, 5, 6, 8, 9, 11]) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES (public.t9_u(1), now()), (public.t9_u(8), now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44909990-0000-4000-9000-000000000010', public.t9_u(1), 'T9 O5 4490', 't9-o5-4490', 'NGN', 'paystack',
   now() - interval '1 day', now(), now()),
  ('44909990-0000-4000-9000-000000000020', public.t9_u(8), 'T9 O5 Other', 't9-o5-other-4490', 'NGN', 'paystack',
   now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  (:va, '44909990-0000-4000-9000-000000000010', 't9o5a', 'T9 Bar A', 6.45, 3.40, 'restaurant', 'verified', 'NG'),
  (:vb, '44909990-0000-4000-9000-000000000010', 't9o5b', 'T9 Bar B', 6.45, 3.41, 'bar_lounge', 'verified', 'NG'),
  (:vc, '44909990-0000-4000-9000-000000000020', 't9o5c', 'T9 Other', 6.46, 3.42, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
SELECT b, u, 'brand_owner', now() FROM (VALUES
  ('44909990-0000-4000-9000-000000000010'::uuid, public.t9_u(1)),
  ('44909990-0000-4000-9000-000000000020'::uuid, public.t9_u(8))) x(b, u)
WHERE NOT EXISTS (SELECT 1 FROM public.brand_team_members m WHERE m.brand_id = x.b AND m.user_id = x.u AND m.removed_at IS NULL);
UPDATE public.brand_team_members SET id = public.t9_m(1), accepted_at = COALESCE(accepted_at, now())
WHERE brand_id = '44909990-0000-4000-9000-000000000010' AND user_id = public.t9_u(1) AND removed_at IS NULL;
UPDATE public.brand_team_members SET id = public.t9_m(8), accepted_at = COALESCE(accepted_at, now())
WHERE brand_id = '44909990-0000-4000-9000-000000000020' AND user_id = public.t9_u(8) AND removed_at IS NULL;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  (public.t9_m(2), '44909990-0000-4000-9000-000000000010', public.t9_u(2), 'venue_staff', now()),
  (public.t9_m(3), '44909990-0000-4000-9000-000000000010', public.t9_u(3), 'venue_staff', now()),
  (public.t9_m(4), '44909990-0000-4000-9000-000000000010', public.t9_u(4), 'finance_manager', now()),
  (public.t9_m(5), '44909990-0000-4000-9000-000000000010', public.t9_u(5), 'venue_staff', now()),
  (public.t9_m(6), '44909990-0000-4000-9000-000000000010', public.t9_u(6), 'venue_staff', now()),
  (public.t9_m(9), '44909990-0000-4000-9000-000000000010', public.t9_u(9), 'venue_staff', now()),
  (public.t9_m(11), '44909990-0000-4000-9000-000000000010', public.t9_u(11), 'event_manager', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  (public.t9_m(2), :va, 'custom', ARRAY['venue.sell']),
  (public.t9_m(3), :va, 'restaurant_manager',
   ARRAY['venue.sell', 'venue.kitchen', 'venue.manage_money', 'restaurant.view_orders', 'restaurant.manage_orders']),
  (public.t9_m(5), :va, 'till_device', ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  (public.t9_m(5), :vb, 'till_device', ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  (public.t9_m(6), :va, 'kitchen_bar', ARRAY['venue.kitchen']),
  (public.t9_m(9), :va, 'till_device', ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44909990-0000-4000-b000-000000000001', '44909990-0000-4000-9000-000000000010', :va, 'Kitchen A', true),
  ('44909990-0000-4000-b000-000000000002', '44909990-0000-4000-9000-000000000010', :vb, 'Bar B', true);
-- A: X1 333.33, X2 123.45, X3 99.99 (odd prices, rounding), S 1.00 (the swap,
-- never tracked), all kitchen. B: Zobo 2,500.00.
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available, prep_station, sort_order) VALUES
  ('44909990-0000-4000-b000-000000000011', '44909990-0000-4000-b000-000000000001', '44909990-0000-4000-9000-000000000010', 'X1', 33333, 'NGN', true, 'kitchen', 1),
  ('44909990-0000-4000-b000-000000000012', '44909990-0000-4000-b000-000000000001', '44909990-0000-4000-9000-000000000010', 'X2', 12345, 'NGN', true, 'kitchen', 2),
  ('44909990-0000-4000-b000-000000000013', '44909990-0000-4000-b000-000000000001', '44909990-0000-4000-9000-000000000010', 'X3', 9999, 'NGN', true, 'kitchen', 3),
  ('44909990-0000-4000-b000-000000000014', '44909990-0000-4000-b000-000000000001', '44909990-0000-4000-9000-000000000010', 'S', 100, 'NGN', true, 'kitchen', 4),
  ('44909990-0000-4000-b000-000000000021', '44909990-0000-4000-b000-000000000002', '44909990-0000-4000-9000-000000000010', 'Zobo', 250000, 'NGN', true, 'bar', 1);
INSERT INTO t9_ids VALUES ('x1', '44909990-0000-4000-b000-000000000011'), ('x2', '44909990-0000-4000-b000-000000000012'),
  ('x3', '44909990-0000-4000-b000-000000000013'), ('s', '44909990-0000-4000-b000-000000000014'),
  ('zobo', '44909990-0000-4000-b000-000000000021');

SELECT public.t9_as(public.t9_u(1));
DO $feat$
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44909990-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 't9-menu-a');
  PERFORM public.issue_4490_set_venue_feature('44909990-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 't9-till-a');
  PERFORM public.issue_4490_set_venue_feature('44909990-0000-4000-9000-0000000000b1', 'menu', true, NULL, NULL, NULL, 't9-menu-b');
  PERFORM public.issue_4490_set_venue_feature('44909990-0000-4000-9000-0000000000b1', 'till', true, NULL, NULL, NULL, 't9-till-b');
END
$feat$;
SELECT public.t9_reset();

-- A held Till round of n x item, as venue-till inserts it (no service charge).
-- TEST-MOD-APPROVED #4490 (flake fix): a round's pickup code came from random() in
-- 100..899 and once hit another live order's code at the venue
-- (venue_orders_live_pickup_code_uniq). Rounds now take 101..499 from their own
-- sequence, disjoint from the guest orders' 501.. (t9_pickup): every code is
-- unique and the run is repeatable. No assertion changes.
CREATE SEQUENCE public.t9_round_pickup START 101 MAXVALUE 499 NO CYCLE;
GRANT USAGE ON SEQUENCE public.t9_round_pickup TO PUBLIC;
CREATE FUNCTION public.t9_round(p_sale uuid, p_actor uuid, p_item uuid, p_qty integer)
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
    lpad(nextval('public.t9_round_pickup')::text, 3, '0'),
    'venue_collected', 'NGN', v_price * p_qty, v_price * p_qty, 0, 0, 0, 0, 0, 0, false, false, false,
    v_price * p_qty, v_price * p_qty, 'pending', 'held', 't9-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true, 'till_sale_id', p_sale));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, p_item, 1, v_name, v_price, 'NGN', p_qty, 0, v_price * p_qty);
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, p_actor, NULL);
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t9_ver(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale $f$;
-- A pending guest page order (Paystack) at venue A: lines [[item, qty], ...],
-- a discount in bps of the list subtotal, a service charge in bps, a tip.
CREATE SEQUENCE public.t9_pickup START 501;
GRANT USAGE ON SEQUENCE public.t9_pickup TO PUBLIC;
CREATE FUNCTION public.t9_guest(p_key text, p_lines jsonb, p_disc_bps integer, p_sc_bps integer, p_tip integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_list integer := 0;
  v_sub integer;
  v_sc integer;
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
  v_sub := v_list - (v_list * p_disc_bps / 10000);
  v_sc := v_sub * p_sc_bps / 10000;
  v_fee := round((v_sub + v_sc)::numeric * 150 / 10000)::integer;
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.venue_order_sessions (id, brand_id, venue_id, currency)
  VALUES (v_session, '44909990-0000-4000-9000-000000000010', '44909990-0000-4000-9000-0000000000a1', 'NGN');
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, payment_status, paystack_reference, pickup_code, idempotency_key, metadata)
  VALUES (v_order, v_session, '44909990-0000-4000-9000-000000000010', '44909990-0000-4000-9000-0000000000a1',
    'guest_page', 'Ada', 'ada@example.com', '+2348030000000',
    'mingla', 'NGN', v_sub, v_list, v_list - v_sub, p_sc_bps, v_sc, p_tip,
    150, 0, v_fee, 0, false, false, false, v_sub + v_sc, 0, v_sub + v_sc + p_tip,
    'paystack', 'pending', 'mingla_vo_t9_' || p_key, lpad(nextval('public.t9_pickup')::text, 3, '0'),
    't9-guest:' || p_key, '{}'::jsonb);
  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    n := n + 1;
    SELECT price_cents, name INTO v_price, v_name FROM public.menu_items WHERE id = (r->>0)::uuid;
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents, station)
    VALUES (v_order, (r->>0)::uuid, n, v_name, v_price, 'NGN', (r->>1)::integer, 0, v_price * (r->>1)::integer,
      public.issue_4490_item_station((r->>0)::uuid, '44909990-0000-4000-9000-0000000000a1'));
  END LOOP;
  SET LOCAL session_replication_role = origin;
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t9_pay(p_order uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.pg_venue_order_finalize_payment(o.id, 'paystack', o.total_cents, 'NGN', o.paystack_reference, NULL, NULL, NULL)
  FROM public.venue_orders o WHERE o.id = p_order $f$;
GRANT EXECUTE ON FUNCTION public.t9_round(uuid, uuid, uuid, integer), public.t9_ver(uuid),
  public.t9_guest(text, jsonb, integer, integer, integer), public.t9_pay(uuid) TO PUBLIC;

-- ===========================================================================
-- A. Nothing O5 is reachable by a signed-out stranger or a signed-in client.
-- ===========================================================================
SELECT public.t9_reset();
SELECT public.t9_ok(NOT EXISTS (
    SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public'
      AND pr.proname ~ '^issue_4490_(pin_|day_|cash_|stock_|station_s|station_has_screen|order_sold_out|sold_out_(open|basis|escalation)|till_carry_over|till_void_on_device|till_settings_read|floor_audit|venue_order_mint_partial|venue_hours_|close_|venue_service_date|till_business_date|can_manage_menu|till_send)'
      AND (has_function_privilege('anon', pr.oid, 'EXECUTE') OR has_function_privilege('authenticated', pr.oid, 'EXECUTE'))),
  'A1 no O5 PIN, close, drawer, stock, sold-out, hours or audit function is executable by anon or authenticated');
SELECT public.t9_ok(NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['public.brand_member_pins', 'public.venue_staff_switch_sessions', 'public.venue_pin_attempts',
                               'public.venue_pin_approvals', 'public.venue_day_closes', 'public.venue_cash_movements',
                               'public.venue_hours_history']) t,
                  unnest(ARRAY['anon', 'authenticated']) r,
                  unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    WHERE has_table_privilege(r, t, p))
  AND (SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.oid IN ('public.venue_day_closes'::regclass,
       'public.venue_cash_movements'::regclass, 'public.venue_hours_history'::regclass)),
  'A2 the PIN, close, drawer and hours-history tables: RLS on, no anon/authenticated privilege');
SELECT public.t9_as(public.t9_u(8));
SELECT public.t9_expect($q$SELECT public.issue_4490_day_summary('44909990-0000-4000-9000-0000000000b1', NULL,
  public.t9_u(8), NULL)$q$, '42501', NULL, 'A3 another brand''s owner, signed in, cannot call the close summary');
SELECT public.t9_expect($q$SELECT count(*) FROM public.venue_day_closes$q$, '42501', NULL,
  'A4 a signed-in client cannot read venue_day_closes');
SELECT public.t9_as(NULL);
SELECT public.t9_expect($q$SELECT public.issue_4490_order_sold_out_resolve(gen_random_uuid(), ARRAY[gen_random_uuid()],
  'refund', NULL, NULL, NULL, 'stranger-key-1')$q$, '42501', NULL, 'A5 a signed-out stranger cannot resolve a sold-out line');
SELECT public.t9_reset();

-- ===========================================================================
-- B. PIN brute force: limits hold across devices and every step-up purpose.
-- ===========================================================================
SELECT public.t9_service();
DO $pins$
BEGIN
  PERFORM public.issue_4490_pin_set(public.t9_m(1), public.t9_u(1), '9157');
  PERFORM public.issue_4490_pin_set(public.t9_m(2), public.t9_u(2), '2580');
  PERFORM public.issue_4490_pin_set(public.t9_m(3), public.t9_u(3), '4826');
  PERFORM public.issue_4490_pin_set(public.t9_m(4), public.t9_u(4), '3691');
  PERFORM public.issue_4490_pin_set(public.t9_m(6), public.t9_u(6), '7413');
  PERFORM public.issue_4490_pin_set(public.t9_m(8), public.t9_u(8), '5937');
  PERFORM public.issue_4490_pin_set(public.t9_m(11), public.t9_u(11), '6284');
END
$pins$;
-- The suite runs in one transaction, so now() is one instant; the 24-hour
-- count reads tries made AFTER set_at. Put the PINs an hour in the past.
RESET ROLE;
UPDATE public.brand_member_pins SET set_at = now() - interval '1 hour'
WHERE brand_id IN ('44909990-0000-4000-9000-000000000010', '44909990-0000-4000-9000-000000000020');
SELECT public.t9_service();
DO $brute$
DECLARE
  v jsonb;
  i integer;
  a uuid := '44909990-0000-4000-9000-0000000000a1';
BEGIN
  -- 4 wrong on device 05, the 5th on device 09: the member's 5-minute lock is per member, not per device.
  FOR i IN 1..4 LOOP
    v := public.issue_4490_pin_unlock(a, public.t9_u(5), public.t9_m(2), '0001', NULL);
  END LOOP;
  v := public.issue_4490_pin_unlock(a, public.t9_u(9), public.t9_m(2), '0001', NULL);
  PERFORM public.t9_ok(v->>'reason' = 'locked',
    'B1 five wrong PINs for one member split over two devices lock the member (5 minutes)');
  v := public.issue_4490_pin_unlock(a, public.t9_u(9), public.t9_m(2), '2580', NULL);
  PERFORM public.t9_ok(v->>'reason' = 'locked' AND NOT (v ? 'token'),
    'B2 while locked even the right PIN switches nobody in (no token)');
  -- The lock runs out (moved into the past by the test).
  RESET ROLE;
  UPDATE public.brand_member_pins SET locked_until = now() - interval '1 second' WHERE member_id = public.t9_m(2);
  PERFORM public.t9_service();
  -- 4 more wrong, through the step-up doors: a sign-out approval (no session needed).
  FOR i IN 1..4 LOOP
    v := public.issue_4490_pin_approve(NULL, public.t9_u(9), a, NULL, public.t9_m(2), '0002', 'sign_out', NULL);
  END LOOP;
  PERFORM public.t9_ok(v->>'reason' = 'wrong' AND (v->>'triesLeft')::int = 1,
    'B3 wrong PINs entered as a sign-out approval count against the same member');
  v := public.issue_4490_pin_unlock(a, public.t9_u(5), public.t9_m(2), '0003', NULL);
  PERFORM public.t9_ok(v->>'reason' = 'hard_locked'
      AND (SELECT hard_locked FROM public.brand_member_pins WHERE member_id = public.t9_m(2)),
    'B4 the 10th wrong PIN in 24 hours (across devices and purposes) hard-locks the member');
  v := public.issue_4490_pin_unlock(a, public.t9_u(5), public.t9_m(2), '2580', NULL);
  PERFORM public.t9_ok(v->>'reason' = 'hard_locked' AND NOT (v ? 'token'),
    'B5 a hard-locked member cannot switch in with the right PIN');
END
$brute$;
SELECT public.t9_expect($q$SELECT public.issue_4490_pin_set(public.t9_m(2), public.t9_u(2), '1470')$q$,
  'P0001', 'pin_hard_locked', 'B6 the member cannot clear a hard lock by setting a new PIN themselves');
SELECT public.t9_expect($q$SELECT public.issue_4490_pin_reset(public.t9_u(2), public.t9_m(2))$q$,
  '42501', 'not_authorized', 'B7 the member cannot reset their own PIN (a manager must)');
SELECT public.t9_expect($q$SELECT public.issue_4490_pin_reset(public.t9_u(8), public.t9_m(2))$q$,
  '42501', 'not_authorized', 'B8 another brand''s owner cannot reset this brand''s PIN');
DO $unlockreset$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_pin_reset(public.t9_u(1), public.t9_m(2));
  PERFORM public.issue_4490_pin_set(public.t9_m(2), public.t9_u(2), '2580');
  RESET ROLE;
  UPDATE public.brand_member_pins SET set_at = now() - interval '1 hour' WHERE member_id = public.t9_m(2);
  PERFORM public.t9_service();
  PERFORM public.t9_ok((v->>'hadPin')::boolean
      AND NOT (SELECT hard_locked FROM public.brand_member_pins WHERE member_id = public.t9_m(2)),
    'B9 the owner''s reset lifts the hard lock; the member sets a PIN again');
END
$unlockreset$;
-- No oracle: unknown member, member of another brand (right PIN), member not
-- allowed to sell (right PIN) all answer exactly like a wrong PIN, no count.
DO $oracle$
DECLARE
  a uuid := '44909990-0000-4000-9000-0000000000a1';
  w jsonb := '{"ok": false, "reason": "wrong", "triesLeft": null}'::jsonb;
BEGIN
  PERFORM public.t9_ok(public.issue_4490_pin_unlock(a, public.t9_u(9), gen_random_uuid(), '5937', NULL) = w
      AND public.issue_4490_pin_unlock(a, public.t9_u(9), public.t9_m(8), '5937', NULL) = w
      AND public.issue_4490_pin_unlock(a, public.t9_u(9), public.t9_m(6), '7413', NULL) = w
      AND (SELECT failed_count FROM public.brand_member_pins WHERE member_id = public.t9_m(8)) = 0
      AND (SELECT failed_count FROM public.brand_member_pins WHERE member_id = public.t9_m(6)) = 0,
    'B10 an unknown member, another brand''s owner with their right PIN, and a kitchen-only member with their right PIN all answer "wrong" with no tries count, and nobody is switched in');
END
$oracle$;
-- The per-device limit: 20 tries in 10 minutes, then nothing is checked,
-- not even another member's right PIN, and that member is not charged a try.
DO $device$
DECLARE
  a uuid := '44909990-0000-4000-9000-0000000000a1';
  v jsonb;
  n integer;
  i integer := 0;
BEGIN
  LOOP
    SELECT count(*) INTO n FROM public.venue_pin_attempts WHERE device_user_id = public.t9_u(9) AND at > now() - interval '10 minutes';
    EXIT WHEN n >= 20 OR i > 40;
    v := public.issue_4490_pin_unlock(a, public.t9_u(9), gen_random_uuid(), '1357', NULL);
    i := i + 1;
  END LOOP;
  v := public.issue_4490_pin_unlock(a, public.t9_u(9), public.t9_m(3), '4826', NULL);
  PERFORM public.t9_ok(v->>'reason' = 'device_limited' AND NOT (v ? 'token')
      AND (SELECT failed_count FROM public.brand_member_pins WHERE member_id = public.t9_m(3)) = 0,
    'B11 after 20 tries in 10 minutes the device is limited: even a manager''s right PIN is not checked, and the manager is not charged');
  v := public.issue_4490_pin_approve(NULL, public.t9_u(9), a, NULL, public.t9_m(3), '4826', 'sign_out', NULL);
  PERFORM public.t9_ok(v->>'reason' = 'device_limited', 'B12 the limit also covers the step-up / sign-out door');
END
$device$;

-- ===========================================================================
-- C. Session scope and the money-row backstop (in the write's transaction).
-- ===========================================================================
DO $sessions$
DECLARE
  a uuid := '44909990-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  -- The test clears device 09's tries so it can switch in again.
  RESET ROLE;
  DELETE FROM public.venue_pin_attempts WHERE device_user_id = public.t9_u(9);
  PERFORM public.t9_service();
  v := public.issue_4490_pin_unlock(a, public.t9_u(5), public.t9_m(2), '2580', NULL);
  INSERT INTO t9_ids VALUES ('tokS', v->>'token'), ('sesS', v->>'sessionId');
  v := public.issue_4490_pin_unlock(a, public.t9_u(9), public.t9_m(3), '4826', NULL);
  INSERT INTO t9_ids VALUES ('tokM', v->>'token'), ('sesM', v->>'sessionId');
  PERFORM public.t9_ok(public.t9_id('tokS') IS NOT NULL AND public.t9_id('tokM') IS NOT NULL,
    'C0 the seller is switched in on device 05 and the manager on device 09 (venue A)');
  -- A paid cash check at A by the seller on device 05.
  v := public.issue_4490_till_open(a, public.t9_u(2), NULL, 'C-check', NULL, 't9-open-c1');
  INSERT INTO t9_ids VALUES ('saleC', v->>'id');
  PERFORM public.t9_round((v->>'id')::uuid, public.t9_u(2), public.t9_id('x1')::uuid, 3);
  v := public.issue_4490_till_take_payment((v->>'id')::uuid, 'cash', 99999, 0, 100000, public.t9_u(2), public.t9_u(5),
    gen_random_uuid(), public.t9_ver(public.t9_id('saleC')::uuid));
  INSERT INTO t9_ids VALUES ('payC', v->>'paymentId');
  PERFORM public.t9_ok((SELECT state = 'paid' AND taken_by_user_id = public.t9_u(2) AND device_user_id = public.t9_u(5)
      FROM public.venue_till_payments WHERE id = public.t9_id('payC')::uuid),
    'C1 in the session the seller takes cash on device 05 (seller recorded, device recorded)');
END
$sessions$;
-- A session at venue A never moves money at venue B (the device is a Till at both).
DO $crossvenue$
DECLARE
  b uuid := '44909990-0000-4000-9000-0000000000b1';
  v jsonb;
  v_sale uuid;
BEGIN
  v := public.issue_4490_till_open(b, public.t9_u(1), NULL, 'B-x', NULL, 't9-open-bx');
  v_sale := (v->>'id')::uuid;
  INSERT INTO t9_ids VALUES ('saleBx', v_sale);
  PERFORM public.t9_round(v_sale, public.t9_u(1), public.t9_id('zobo')::uuid, 1);
  PERFORM public.t9_ok(public.t9_raises(format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 250000, 0, 250000,
      public.t9_u(1), public.t9_u(5), gen_random_uuid(), public.t9_ver(%L))$q$, v_sale, v_sale))
    AND public.t9_raises(format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 250000, 0, 250000,
      public.t9_u(2), public.t9_u(5), gen_random_uuid(), public.t9_ver(%L))$q$, v_sale, v_sale))
    AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments WHERE sale_id = v_sale),
    'C2 device 05''s session at A records no payment at B, whether as the owner or as the A session''s seller');
END
$crossvenue$;
-- An approval made on one device never lets the approver act on another device.
DO $crossdevice$
DECLARE
  a uuid := '44909990-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  v := public.issue_4490_pin_approve(public.t9_hash(public.t9_id('tokS')), public.t9_u(5), a, NULL,
    public.t9_m(4), '3691', 'refund', public.t9_id('payC'));
  PERFORM public.t9_ok((v->>'ok')::boolean, 'C3a the finance manager approves a refund on device 05');
  PERFORM public.t9_ok(public.t9_raises(format($q$SELECT public.issue_4490_till_refund(%L, 1000, 0, 'x', false,
      public.t9_u(4), public.t9_u(9), gen_random_uuid())$q$, public.t9_id('payC')))
    AND NOT EXISTS (SELECT 1 FROM public.venue_till_refunds WHERE payment_id = public.t9_id('payC')::uuid),
    'C3b that approval does not let the finance manager refund through device 09 (no refund row)');
END
$crossdevice$;
-- PROBES on the scope of a step-up approval inside the database backstop.
-- (The edge asks for a fresh PIN per refund; these check whether the
-- database would hold the same line if a request reached it another way.)
DO $scope$
DECLARE
  a uuid := '44909990-0000-4000-9000-0000000000a1';
  v jsonb;
  v_ok boolean;
  n integer;
BEGIN
  -- P1: an approval given for an EXPORT lets the approver be the actor of a refund row.
  v := public.issue_4490_pin_approve(public.t9_hash(public.t9_id('tokS')), public.t9_u(5), a, NULL,
    public.t9_m(3), '4826', 'export', 'export-target');
  v_ok := NOT public.t9_raises(format($q$SELECT public.issue_4490_till_refund(%L, 1000, 0, 'probe export approval', false,
      public.t9_u(3), public.t9_u(5), gen_random_uuid())$q$, public.t9_id('payC')));
  PERFORM public.t9_ok(NOT v_ok,
    'P1 an approval given for "export" must not authorise a refund row (approvals are not purpose-bound in issue_4490_pin_actor_assert)');
  -- P2: one refund approval, two refunds.
  SELECT count(*) INTO n FROM public.venue_till_refunds WHERE payment_id = public.t9_id('payC')::uuid;
  v := public.issue_4490_pin_approve(public.t9_hash(public.t9_id('tokS')), public.t9_u(5), a, NULL,
    public.t9_m(3), '4826', 'refund', public.t9_id('payC'));
  PERFORM public.issue_4490_till_refund(public.t9_id('payC')::uuid, 1000, 0, 'probe reuse 1', false,
    public.t9_u(3), public.t9_u(5), gen_random_uuid());
  v_ok := NOT public.t9_raises(format($q$SELECT public.issue_4490_till_refund(%L, 1000, 0, 'probe reuse 2', false,
      public.t9_u(3), public.t9_u(5), gen_random_uuid())$q$, public.t9_id('payC')));
  PERFORM public.t9_ok(NOT v_ok,
    'P2 one step-up approval must authorise one refund, not every refund for 2 minutes (approvals are never consumed)');
  -- P3: the switched-in member with money rights refunds with no fresh PIN at all.
  v_ok := NOT public.t9_raises(format($q$SELECT public.issue_4490_till_refund(%L, 1000, 0, 'probe no step-up', false,
      public.t9_u(3), public.t9_u(9), gen_random_uuid())$q$, public.t9_id('payC')));
  PERFORM public.t9_ok(NOT v_ok,
    'P3 a refund recorded for a Till device must need a fresh PIN in the database too (the session member refunds with no approval row)');
END
$scope$;
-- A member removed from the team mid-session.
DO $removed$
DECLARE
  a uuid := '44909990-0000-4000-9000-0000000000a1';
  v jsonb;
  v_ok boolean;
BEGIN
  RESET ROLE;
  UPDATE public.brand_team_members SET removed_at = now() WHERE id = public.t9_m(2);
  PERFORM public.t9_service();
  PERFORM public.t9_ok(public.t9_raises(format($q$SELECT public.issue_4490_pin_session_resolve(%L::bytea, public.t9_u(5),
      '44909990-0000-4000-9000-0000000000a1', NULL)$q$, public.t9_hash(public.t9_id('tokS')))),
    'C4 a removed member''s live token no longer resolves');
  v := public.issue_4490_till_open(a, public.t9_u(1), NULL, 'C-removed', NULL, 't9-open-c4');
  PERFORM public.t9_round((v->>'id')::uuid, public.t9_u(1), public.t9_id('x2')::uuid, 1);
  v_ok := NOT public.t9_raises(format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 12345, 0, 12345,
      public.t9_u(2), public.t9_u(5), gen_random_uuid(), public.t9_ver(%L))$q$, v->>'id', v->>'id'));
  PERFORM public.t9_ok(NOT v_ok,
    'P4 removing a member must end their PIN sessions (the database backstop still accepts a payment recorded as the removed member)');
  RESET ROLE;
  UPDATE public.brand_team_members SET removed_at = NULL WHERE id = public.t9_m(2);
  PERFORM public.t9_service();
END
$removed$;
-- A PIN reset ends the member's session everywhere, at the write.
DO $reset$
DECLARE
  a uuid := '44909990-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  PERFORM public.issue_4490_pin_reset(public.t9_u(1), public.t9_m(2));
  v := public.issue_4490_till_open(a, public.t9_u(1), NULL, 'C-reset', NULL, 't9-open-c5');
  PERFORM public.t9_round((v->>'id')::uuid, public.t9_u(1), public.t9_id('x3')::uuid, 1);
  PERFORM public.t9_ok(public.t9_raises(format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 9999, 0, 9999,
      public.t9_u(2), public.t9_u(5), gen_random_uuid(), public.t9_ver(%L))$q$, v->>'id', v->>'id'))
    AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments WHERE sale_id = (v->>'id')::uuid),
    'C5 after a PIN reset the member''s session moves no money (refused at the write)');
  PERFORM public.issue_4490_pin_set(public.t9_m(2), public.t9_u(2), '2580');
END
$reset$;
-- The device acting as itself never touches the drawer or the close.
SELECT public.t9_expect($q$SELECT public.issue_4490_cash_movement('44909990-0000-4000-9000-0000000000a1', NULL, 'float', 1000,
  NULL, public.t9_u(5), public.t9_u(5), gen_random_uuid())$q$, '28000', 'pin_session_required',
  'C6 a Till device as itself cannot record a float');
SELECT public.t9_expect($q$SELECT public.issue_4490_day_close('44909990-0000-4000-9000-0000000000a1',
  public.issue_4490_venue_service_date('44909990-0000-4000-9000-0000000000a1', now()), 0, public.t9_u(5), NULL, gen_random_uuid())$q$,
  '28000', 'pin_session_required', 'C7 a Till device as itself cannot close the day');

-- ===========================================================================
-- D. The drawer and the close at venue B (the owner, signed in as themselves).
-- ===========================================================================
DO $drawer$
DECLARE
  b uuid := '44909990-0000-4000-9000-0000000000b1';
  v jsonb;
  r1 uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  r3 uuid := gen_random_uuid();
  v_sale uuid;
  v_pay uuid;
  s jsonb;
BEGIN
  PERFORM public.issue_4490_cash_movement(b, NULL, 'float', 10000, NULL, public.t9_u(1), NULL, r1);
  PERFORM public.issue_4490_cash_movement(b, NULL, 'float', 20000, NULL, public.t9_u(1), NULL, r2);
  PERFORM public.issue_4490_cash_movement(b, NULL, 'paid_out', 3000, 'ice', public.t9_u(1), NULL, r3);
  v := public.issue_4490_cash_movement(b, NULL, 'paid_out', 3000, 'ice', public.t9_u(1), NULL, r3);
  PERFORM public.t9_ok((v->>'replayed')::boolean
      AND (SELECT count(*) FROM public.venue_cash_movements WHERE venue_id = b) = 3,
    'D1 the same paid-out request again is a replay (3 rows, not 4)');
  INSERT INTO t9_ids VALUES ('r3', r3);
  v := public.issue_4490_till_open(b, public.t9_u(1), NULL, 'D-1', NULL, 't9-open-d1');
  v_sale := (v->>'id')::uuid;
  PERFORM public.t9_round(v_sale, public.t9_u(1), public.t9_id('zobo')::uuid, 2);
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 500000, 50000, 600000, public.t9_u(1), public.t9_u(1),
    gen_random_uuid(), public.t9_ver(v_sale));
  v_pay := (v->>'paymentId')::uuid;
  INSERT INTO t9_ids VALUES ('payD1', v_pay);
  PERFORM public.issue_4490_till_refund(v_pay, 70000, 0, 'one flat', false, public.t9_u(1), public.t9_u(1), gen_random_uuid());
  s := public.issue_4490_day_summary(b, NULL, public.t9_u(1), NULL);
  PERFORM public.t9_ok((s->'totals'->'cash'->>'floatMinor')::bigint = 20000
      AND (s->'totals'->'cash'->>'expectedMinor')::bigint = 497000
      AND (s->'totals'->'takings'->>'amountMinor')::bigint = 500000
      AND (s->'totals'->'net'->>'takingsMinor')::bigint = 430000
      AND (s->'totals'->'reconcile'->>'byMethodMatches')::boolean
      AND (s->'totals'->'reconcile'->>'byPersonMatches')::boolean
      AND (s->'totals'->'reconcile'->>'tipsMatch')::boolean,
    'D2 expected in the drawer = newest float 200 + cash 5,000 + cash tip 500 - cash refund 700 - paid out 30 = 4,970.00; the breakdowns add up');
END
$drawer$;
SELECT public.t9_expect($q$SELECT public.issue_4490_cash_movement('44909990-0000-4000-9000-0000000000b1', NULL, 'paid_out', 4000,
  'ice', public.t9_u(1), NULL, public.t9_id('r3')::uuid)$q$, 'PT409', 'till_request_reused',
  'D3 a request id reused for a different amount is refused, not recorded');
DO $close$
DECLARE
  b uuid := '44909990-0000-4000-9000-0000000000b1';
  v jsonb;
  r uuid := gen_random_uuid();
  d date := public.issue_4490_venue_service_date('44909990-0000-4000-9000-0000000000b1', now());
BEGIN
  INSERT INTO t9_ids VALUES ('closeR1', r), ('dayB', d);
  -- The unpaid check from C2 blocks the close until it is moved to tomorrow.
  PERFORM public.t9_ok(public.t9_raises(format('SELECT public.issue_4490_day_close(%L, %L, 496000, public.t9_u(1), NULL, gen_random_uuid())', b, d)),
    'D4a an unpaid check blocks the close');
  PERFORM public.issue_4490_till_carry_over(public.t9_id('saleBx')::uuid, d, public.t9_u(1), NULL);
  v := public.issue_4490_day_close(b, d, 496000, public.t9_u(1), NULL, r);
  PERFORM public.t9_ok(v->>'state' = 'closed' AND (v->'close'->>'differenceMinor')::bigint = -1000
      AND (v->'close'->>'cashExpectedMinor')::bigint = 497000,
    'D4 counted 4,960.00 against 4,970.00 expected: closed, 10.00 short');
  v := public.issue_4490_day_close(b, d, 496000, public.t9_u(1), NULL, r);
  PERFORM public.t9_ok((v->>'replayed')::boolean, 'D5 the same close request again is a replay');
END
$close$;
SELECT public.t9_expect($q$SELECT public.issue_4490_day_close('44909990-0000-4000-9000-0000000000b1', public.t9_id('dayB')::date,
  1, public.t9_u(1), NULL, gen_random_uuid())$q$, 'PT409', 'day_already_closed', 'D6 a second close of a closed day is refused');
SELECT public.t9_expect($q$SELECT public.issue_4490_cash_movement('44909990-0000-4000-9000-0000000000b1', NULL, 'paid_out', 100,
  'late ice', public.t9_u(1), NULL, gen_random_uuid())$q$, 'PT409', 'day_already_closed',
  'D7 no paid out on a closed day');
-- Tampering with the snapshot, even as the service role.
SELECT public.t9_expect($q$UPDATE public.venue_day_closes SET cash_counted_minor = 497000, difference_minor = 0
  WHERE venue_id = '44909990-0000-4000-9000-0000000000b1'$q$, '42501', 'day_close_immutable',
  'D8 the service role cannot rewrite a closed day''s count');
SELECT public.t9_expect($q$DELETE FROM public.venue_day_closes WHERE venue_id = '44909990-0000-4000-9000-0000000000b1'$q$,
  '42501', 'day_close_immutable', 'D9 the service role cannot delete a close');
DO $tamper$
DECLARE
  v_id uuid;
  v_ok boolean;
BEGIN
  SELECT id INTO v_id FROM public.venue_day_closes WHERE venue_id = '44909990-0000-4000-9000-0000000000b1';
  -- Another row's marker.
  PERFORM set_config('mingla.issue_4490_day_close_write', 'write:' || gen_random_uuid(), true);
  v_ok := public.t9_raises(format('UPDATE public.venue_day_closes SET totals = %L::jsonb WHERE id = %L', '{"forged":true}', v_id));
  -- This row's marker, but staying closed with new totals.
  PERFORM set_config('mingla.issue_4490_day_close_write', 'write:' || v_id, true);
  v_ok := v_ok AND public.t9_raises(format('UPDATE public.venue_day_closes SET totals = %L::jsonb WHERE id = %L', '{"forged":true}', v_id));
  PERFORM set_config('mingla.issue_4490_day_close_write', '', true);
  PERFORM public.t9_ok(v_ok AND (SELECT (totals->'takings'->>'amountMinor')::bigint = 500000 FROM public.venue_day_closes WHERE id = v_id),
    'D10 a forged marker for another row, or this row''s marker without a reopen, cannot change a closed snapshot');
END
$tamper$;
-- Money after the close lands as late; the snapshot never moves.
DO $late$
DECLARE
  b uuid := '44909990-0000-4000-9000-0000000000b1';
  v jsonb;
  v_sale uuid;
  s jsonb;
BEGIN
  v := public.issue_4490_till_open(b, public.t9_u(1), NULL, 'D-late', NULL, 't9-open-dlate');
  v_sale := (v->>'id')::uuid;
  PERFORM public.t9_round(v_sale, public.t9_u(1), public.t9_id('zobo')::uuid, 1);
  PERFORM public.issue_4490_till_take_payment(v_sale, 'cash', 250000, 0, 250000, public.t9_u(1), public.t9_u(1),
    gen_random_uuid(), public.t9_ver(v_sale));
  s := public.issue_4490_day_summary(b, public.t9_id('dayB')::date, public.t9_u(1), NULL);
  PERFORM public.t9_ok(s->>'state' = 'closed'
      AND (s->'totals'->'takings'->>'amountMinor')::bigint = 500000
      AND (s->'late'->>'count')::int = 1 AND (s->'late'->>'amountMinor')::bigint = 250000
      AND (s->'close'->>'cashExpectedMinor')::bigint = 497000,
    'D11 a cash sale after the close is listed late (2,500.00); the closed totals and expected cash do not move');
END
$late$;
-- Rights: another brand, a seller, the kitchen, nobody: refused; finance: allowed.
DO $rights$
DECLARE
  b uuid := '44909990-0000-4000-9000-0000000000b1';
  a uuid := '44909990-0000-4000-9000-0000000000a1';
BEGIN
  PERFORM public.t9_ok(public.t9_raises(format('SELECT public.issue_4490_day_summary(%L, NULL, public.t9_u(8), NULL)', b))
      AND public.t9_raises(format('SELECT public.issue_4490_day_summary(%L, NULL, public.t9_u(2), NULL)', a))
      AND public.t9_raises(format('SELECT public.issue_4490_day_summary(%L, NULL, public.t9_u(6), NULL)', a))
      AND public.t9_raises(format('SELECT public.issue_4490_day_summary(%L, NULL, NULL, NULL)', a))
      AND public.t9_raises(format('SELECT public.issue_4490_day_export(%L, %L, public.t9_u(8), NULL)', b, public.t9_id('dayB')))
      AND public.t9_raises(format('SELECT public.issue_4490_cash_movements_list(%L, NULL, public.t9_u(8), NULL)', b))
      AND NOT public.t9_raises(format('SELECT public.issue_4490_day_summary(%L, NULL, public.t9_u(4), NULL)', b)),
    'D12 close, export and drawer: refused for another brand''s owner, a seller, the kitchen and nobody; the finance manager reads');
END
$rights$;
-- PROBE: reopen by a Till device session with no fresh PIN (database level).
DO $reopen$
DECLARE
  b uuid := '44909990-0000-4000-9000-0000000000b1';
  v jsonb;
  v_ok boolean;
BEGIN
  v := public.issue_4490_pin_unlock(b, public.t9_u(5), public.t9_m(1), '9157', NULL);
  INSERT INTO t9_ids VALUES ('tokOwnerB', v->>'token');
  v_ok := NOT public.t9_raises(format($q$SELECT public.issue_4490_day_reopen(%L, %L, 'recount', public.t9_u(1), public.t9_u(5))$q$,
    b, public.t9_id('dayB')));
  PERFORM public.t9_ok(NOT v_ok,
    'P5 a reopen recorded for a Till device must need a fresh PIN in the database too (the session member reopens with no approval row)');
  IF NOT v_ok THEN
    -- The probe held: reopen it as the owner on their own account instead.
    PERFORM public.issue_4490_day_reopen(b, public.t9_id('dayB')::date, 'recount', public.t9_u(1), NULL);
  END IF;
  PERFORM public.t9_ok((SELECT state = 'reopened' AND reopen_count = 1 AND jsonb_array_length(history) = 1
      AND (history->0->'totals'->'takings'->>'amountMinor')::bigint = 500000
      FROM public.venue_day_closes WHERE venue_id = b),
    'D13 the reopen keeps the old snapshot in history (5,000.00) and counts the reopen');
END
$reopen$;
-- PROBE: the earlier close request retried after the reopen.
DO $stale$
DECLARE
  b uuid := '44909990-0000-4000-9000-0000000000b1';
  v jsonb;
  v_reclosed boolean;
BEGIN
  BEGIN
    v := public.issue_4490_day_close(b, public.t9_id('dayB')::date, 496000, public.t9_u(1), NULL, public.t9_id('closeR1')::uuid);
    v_reclosed := COALESCE((v->>'replayed')::boolean, false) = false AND v->>'state' = 'closed';
  EXCEPTION WHEN OTHERS THEN
    v_reclosed := false;
  END;
  PERFORM public.t9_ok(NOT v_reclosed,
    'P6 a close request already used before a reopen, retried after it, must not close the day again with the old count (it re-closes with 4,960.00 counted although nobody counted after the reopen)');
  IF NOT v_reclosed THEN
    v := public.issue_4490_day_close(b, public.t9_id('dayB')::date, 746000, public.t9_u(1), NULL, gen_random_uuid());
  END IF;
  PERFORM public.t9_ok((SELECT state = 'closed' AND (totals->'takings'->>'amountMinor')::bigint = 750000
      AND jsonb_array_length(history) = 1 FROM public.venue_day_closes WHERE venue_id = b),
    'D14 closed again: the new snapshot holds the late sale (7,500.00); history still holds the first close');
END
$stale$;

-- ===========================================================================
-- E. Sold out after payment: a randomised money property, then the edges.
-- ===========================================================================
DO $stock0$
BEGIN
  PERFORM public.issue_4490_stock_set(public.t9_id('x1')::uuid, 0, NULL, public.t9_u(1), NULL);
  PERFORM public.issue_4490_stock_set(public.t9_id('x2')::uuid, 0, NULL, public.t9_u(1), NULL);
  PERFORM public.issue_4490_stock_set(public.t9_id('x3')::uuid, 0, NULL, public.t9_u(1), NULL);
END
$stock0$;
SELECT setseed(0.4490);
DO $property$
DECLARE
  v_order uuid;
  v_lines jsonb;
  v_ids uuid[];
  v_id uuid;
  i integer;
  k integer;
  v_items uuid[] := ARRAY[public.t9_id('x1')::uuid, public.t9_id('x2')::uuid, public.t9_id('x3')::uuid];
  v_ord public.venue_orders%ROWTYPE;
  v_req bigint;
  v_fee bigint;
  v_line_sum bigint;
  v_bad integer := 0;
  v_resolved integer := 0;
  v_r jsonb;
  v_batch uuid[];
BEGIN
  FOR i IN 1..40 LOOP
    v_lines := jsonb_build_array(
      jsonb_build_array(v_items[1], 1 + floor(random() * 3)::int),
      jsonb_build_array(v_items[2], 1 + floor(random() * 4)::int),
      jsonb_build_array(v_items[3], 1 + floor(random() * 5)::int));
    v_order := public.t9_guest('prop' || i, v_lines, (floor(random() * 3) * 375)::int, (500 + floor(random() * 3) * 375)::int,
      floor(random() * 5000)::int);
    PERFORM public.t9_pay(v_order);
    SELECT array_agg(id ORDER BY random()) INTO v_ids FROM public.venue_order_items
    WHERE venue_order_id = v_order AND sold_out_at IS NOT NULL;
    IF cardinality(v_ids) <> 3 THEN
      RAISE EXCEPTION 'T9 FAIL: E-prop order % expected 3 sold-out lines, got %', i, cardinality(v_ids);
    END IF;
    -- Resolve 1, 2 or 3 lines, one at a time or in one call, swap or refund.
    k := 1 + floor(random() * 3)::int;
    IF random() < 0.3 THEN
      v_batch := v_ids[1:k];
      v_r := public.issue_4490_order_sold_out_resolve(v_order, v_batch, 'refund', NULL, public.t9_u(1), NULL,
        'prop-' || i || '-all');
    ELSE
      FOR j IN 1..k LOOP
        IF random() < 0.5 THEN
          v_r := public.issue_4490_order_sold_out_resolve(v_order, ARRAY[v_ids[j]], 'swap', public.t9_id('s')::uuid,
            public.t9_u(1), NULL, 'prop-' || i || '-' || j);
        ELSE
          v_r := public.issue_4490_order_sold_out_resolve(v_order, ARRAY[v_ids[j]], 'refund', NULL,
            public.t9_u(1), NULL, 'prop-' || i || '-' || j);
        END IF;
      END LOOP;
    END IF;
    v_resolved := v_resolved + k;
    -- Then the whole-order staff refund for what is left.
    PERFORM public.pg_venue_order_mint_refund(v_order, 'venue_order_venue_approved', 'brand_staff', public.t9_u(1), 'rest');
    SELECT * INTO v_ord FROM public.venue_orders WHERE id = v_order;
    SELECT COALESCE(sum(buyer_refund_requested_cents), 0), COALESCE(sum(fee_reversal_required_cents), 0),
           COALESCE(sum(buyer_refund_requested_cents) FILTER (WHERE public.issue_4490_is_line_refund_kind(refund_kind)), 0)
      INTO v_req, v_fee, v_line_sum
    FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = v_order;
    IF v_req <> v_ord.total_cents OR v_fee <> v_ord.mingla_fee_cents
       OR v_line_sum > v_ord.subtotal_cents + v_ord.service_charge_cents
       OR v_line_sum <> (SELECT sum(sold_out_refund_minor) FROM public.venue_order_items
                         WHERE venue_order_id = v_order AND sold_out_resolution IS NOT NULL) THEN
      v_bad := v_bad + 1;
      RAISE NOTICE 'E-prop order %: total % refunded % (lines %), fee % reversed %', i, v_ord.total_cents, v_req,
        v_line_sum, v_ord.mingla_fee_cents, v_fee;
    END IF;
  END LOOP;
  PERFORM public.t9_ok(v_bad = 0 AND v_resolved >= 40,
    format('E1 40 random discounted, service-charged, tipped orders (%s lines swapped or refunded in random order, then the whole-order refund): every order gives back exactly its total and reverses Mingla''s fee exactly once', v_resolved));
END
$property$;
-- E2: a whole-order refund in flight first; a line refund after it moves nothing.
DO $wholefirst$
DECLARE
  v_order uuid;
  v_line uuid;
  v_ok boolean;
BEGIN
  v_order := public.t9_guest('whole-first', jsonb_build_array(jsonb_build_array(public.t9_id('x1'), 2),
    jsonb_build_array(public.t9_id('x2'), 1)), 0, 1000, 500);
  PERFORM public.t9_pay(v_order);
  PERFORM public.pg_venue_order_mint_refund(v_order, 'venue_order_venue_approved', 'brand_staff', public.t9_u(1), 'all');
  SELECT id INTO v_line FROM public.venue_order_items WHERE venue_order_id = v_order AND menu_item_id = public.t9_id('x1')::uuid;
  v_ok := public.t9_raises(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL,
    public.t9_u(1), NULL, 'whole-first-line')$q$, v_order, v_line));
  PERFORM public.t9_ok(v_ok
      AND (SELECT count(*) FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = v_order) = 1
      AND (SELECT sum(buyer_refund_requested_cents) FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = v_order)
          = (SELECT total_cents FROM public.venue_orders WHERE id = v_order)
      AND (SELECT sold_out_resolution IS NULL FROM public.venue_order_items WHERE id = v_line),
    'E2 with the whole order already on its way back, a line refund is refused and leaves no half-resolved line');
END
$wholefirst$;
-- E3 PROBE: one request key reused for a different line.
DO $keyreuse$
DECLARE
  v_order uuid;
  v_a uuid;
  v_b uuid;
  r jsonb;
BEGIN
  v_order := public.t9_guest('key-reuse', jsonb_build_array(jsonb_build_array(public.t9_id('x1'), 1),
    jsonb_build_array(public.t9_id('x2'), 1)), 0, 0, 0);
  PERFORM public.t9_pay(v_order);
  SELECT id INTO v_a FROM public.venue_order_items WHERE venue_order_id = v_order AND menu_item_id = public.t9_id('x1')::uuid;
  SELECT id INTO v_b FROM public.venue_order_items WHERE venue_order_id = v_order AND menu_item_id = public.t9_id('x2')::uuid;
  PERFORM public.issue_4490_order_sold_out_resolve(v_order, ARRAY[v_a], 'refund', NULL, public.t9_u(1), NULL, 'same-key-1');
  BEGIN
    PERFORM public.issue_4490_order_sold_out_resolve(v_order, ARRAY[v_b], 'refund', NULL, public.t9_u(1), NULL, 'same-key-1');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  r := public.issue_4490_order_sold_out_resolve(v_order, ARRAY[v_a], 'refund', NULL, public.t9_u(1), NULL, 'same-key-1');
  PERFORM public.t9_ok((r->'orderItemIds') = to_jsonb(ARRAY[v_a]) AND (r->>'refundMinor')::bigint = 33333,
    'P7 a replay of a request must answer what THAT request did (a key reused for another line overwrites the stored answer, so the replay of line A reports line B)');
END
$keyreuse$;
-- E4: concurrency stand-in: two different keys for one line never refund twice.
DO $twice$
DECLARE
  v_order uuid;
  v_a uuid;
BEGIN
  v_order := public.t9_guest('twice', jsonb_build_array(jsonb_build_array(public.t9_id('x3'), 2)), 0, 1250, 0);
  PERFORM public.t9_pay(v_order);
  SELECT id INTO v_a FROM public.venue_order_items WHERE venue_order_id = v_order;
  PERFORM public.issue_4490_order_sold_out_resolve(v_order, ARRAY[v_a], 'swap', public.t9_id('s')::uuid, public.t9_u(1), NULL, 'twice-key-1');
  PERFORM public.t9_ok(public.t9_raises(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL,
      public.t9_u(1), NULL, 'twice-key-2')$q$, v_order, v_a))
    AND (SELECT count(*) FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = v_order) = 1,
    'E4 a swapped line refunded again under another key is refused: one refund row');
END
$twice$;
-- E5 OBSERVATION: the kitchen (below the refund floor) returns money by a swap.
DO $kitchenswap$
DECLARE
  v_order uuid;
  v_a uuid;
  r jsonb;
BEGIN
  v_order := public.t9_guest('kitchen-swap', jsonb_build_array(jsonb_build_array(public.t9_id('x1'), 3)), 0, 0, 0);
  PERFORM public.t9_pay(v_order);
  SELECT id INTO v_a FROM public.venue_order_items WHERE venue_order_id = v_order;
  PERFORM public.t9_ok(public.t9_raises(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL,
      public.t9_u(6), NULL, 'kitchen-refund')$q$, v_order, v_a)), 'E5a the kitchen cannot refund a sold-out line');
  PERFORM public.t9_ok(public.t9_raises(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap',
      public.t9_id('s')::uuid, public.t9_u(6), NULL, 'kitchen-swap')$q$, v_order, v_a))
    AND (SELECT sold_out_resolution IS NULL FROM public.venue_order_items WHERE id = v_a)
    AND NOT EXISTS (SELECT 1 FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = v_order),
    'P8 the kitchen (no refund rights) cannot return money by swapping a 999.99 line for a 1.00 item: refused, nothing resolved, no refund');
END
$kitchenswap$;
-- E6 PROBE: a payment webhook replayed after a partial refund.
DO $replay$
DECLARE
  v_order uuid;
  v_a uuid;
BEGIN
  v_order := public.t9_guest('replay', jsonb_build_array(jsonb_build_array(public.t9_id('x2'), 1),
    jsonb_build_array(public.t9_id('s'), 1)), 0, 0, 0);
  PERFORM public.t9_pay(v_order);
  SELECT id INTO v_a FROM public.venue_order_items WHERE venue_order_id = v_order AND menu_item_id = public.t9_id('x2')::uuid;
  PERFORM public.issue_4490_order_sold_out_resolve(v_order, ARRAY[v_a], 'refund', NULL, public.t9_u(1), NULL, 'replay-1');
  -- The refund settles (the processor's write-back, done by the test).
  RESET ROLE;
  UPDATE public.venue_orders SET payment_status = 'partial_refund', refunded_amount_cents = 12345 WHERE id = v_order;
  PERFORM public.t9_service();
  PERFORM public.t9_pay(v_order);
  PERFORM public.t9_ok((SELECT payment_status FROM public.venue_orders WHERE id = v_order) = 'partial_refund',
    'P9 a payment confirmation replayed after a partial refund must not flip the order back to "paid" (pg_venue_order_finalize_payment only treats "paid" as a replay; pre-existing, re-emitted by O5)');
  PERFORM public.t9_ok((SELECT stock_count FROM public.menu_items WHERE id = public.t9_id('x2')::uuid) = 0
      AND (SELECT count(*) FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = v_order) = 1,
    'E6 the replay takes no stock twice and mints no refund');
END
$replay$;

-- ===========================================================================
-- Summary.
-- ===========================================================================
DO $summary$
DECLARE
  r record;
  n integer;
BEGIN
  SELECT count(*) INTO n FROM t9_findings;
  RAISE NOTICE '==== T9 strict checks all passed; % probe finding(s) ====', n;
  FOR r IN SELECT * FROM t9_findings ORDER BY n LOOP
    RAISE NOTICE 'FINDING %: %', r.n, r.label;
  END LOOP;
END
$summary$;

ROLLBACK;
