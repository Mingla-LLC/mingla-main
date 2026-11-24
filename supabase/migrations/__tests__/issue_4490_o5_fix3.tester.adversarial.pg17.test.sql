-- #4490 08-O5 fix 3: independent tester adversarial suite (L3 retest, 24 Nov). Fixture copied from
-- issue_4490_ops_o5_fix3.implementor.pg17.test.sql; attacks are different angles. BEGIN ... ROLLBACK.
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


-- ---------------------------------------------------------------------------
-- X1 setup: a cash payment of 10,000.00 at A; device 05 session (seller 02);
--    device 07 session (seller 02); device 05 session at B (owner 01).
-- ---------------------------------------------------------------------------
DO $x1$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  b uuid := '44906180-0000-4000-9000-0000000000b1';
  v jsonb; v_sale uuid;
BEGIN
  v := public.issue_4490_pin_unlock(a, public.t3f_u(5), public.t3f_m(2), '2580', NULL);
  INSERT INTO t3f_ids VALUES ('tok5', v->>'token');
  v := public.issue_4490_pin_unlock(a, public.t3f_u(7), public.t3f_m(2), '2580', NULL);
  INSERT INTO t3f_ids VALUES ('tok7', v->>'token');
  v := public.issue_4490_till_open(a, public.t3f_u(2), NULL, 'X1', NULL, 't3f-open-x1');
  v_sale := (v->>'id')::uuid;
  PERFORM public.t3f_round(v_sale, public.t3f_u(2), public.t3f_id('x')::uuid, 2);
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 1000000, 0, 1000000, public.t3f_u(2), public.t3f_u(5),
    gen_random_uuid(), public.t3f_ver(v_sale));
  INSERT INTO t3f_ids VALUES ('pay', v->>'paymentId');
  -- manager 03 approves a refund of this payment on device 05's session
  v := public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tok5')), public.t3f_u(5), a, NULL,
    public.t3f_m(3), '4826', 'refund', public.t3f_id('pay'));
  INSERT INTO t3f_ids VALUES ('appr5', v->>'approvalId');
  PERFORM public.t3f_ok((v->>'ok')::boolean, 'X1-0 manager approval on device 05');
END
$x1$;
-- X1-1 cross-device: device 05's approval cannot be spent on device 07.
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'xdev', false,
  public.t3f_u(3), public.t3f_u(7), gen_random_uuid())$q$, 'P0001', 'pin_step_up_required',
  'X1-1 an approval on device 05 does not refund from device 07');
-- X1-2 cross-approver: the owner (who has money rights) cannot spend the manager's approval.
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'xappr', false,
  public.t3f_u(1), public.t3f_u(5), gen_random_uuid())$q$, NULL, NULL,
  'X1-2 the owner cannot ride the manager''s approval');
-- X1-3 cross-venue: device 05 at B (no session there) / with a session at B.
SELECT public.t3f_expect($q$SELECT public.issue_4490_pin_step_up_take('44906180-0000-4000-9000-0000000000b1', public.t3f_u(3),
  public.t3f_u(5), 'refund', public.t3f_id('pay'), 'refund:xb', true)$q$, '28000', 'pin_session_invalid',
  'X1-3a no PIN session at B: the A approval is useless at B');
DO $x13$ DECLARE v jsonb; BEGIN
  v := public.issue_4490_pin_unlock('44906180-0000-4000-9000-0000000000b1', public.t3f_u(5), public.t3f_m(1), '9157', NULL);
  INSERT INTO t3f_ids VALUES ('tok5b', v->>'token');
END $x13$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_pin_step_up_take('44906180-0000-4000-9000-0000000000b1', public.t3f_u(3),
  public.t3f_u(5), 'refund', public.t3f_id('pay'), 'refund:xb', true)$q$, 'P0001', 'pin_step_up_required',
  'X1-3b a session at B still cannot spend the approval given at A');
-- X1-4 the approval is still unused after all the refused attempts (refusals consume nothing).
SELECT public.t3f_ok((SELECT consumed_at IS NULL FROM public.venue_pin_approvals WHERE id = public.t3f_id('appr5')::uuid),
  'X1-4 refused attempts leave the approval unused');
-- X1-5 expiry: back-date it 121 s -> refused.
RESET ROLE;
UPDATE public.venue_pin_approvals SET created_at = now() - interval '121 seconds' WHERE id = public.t3f_id('appr5')::uuid;
SELECT public.t3f_service();
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'stale', false,
  public.t3f_u(3), public.t3f_u(5), gen_random_uuid())$q$, 'P0001', 'pin_step_up_required',
  'X1-5 an approval older than 2 minutes refunds nothing');
-- X1-6 a seller (no money rights) cannot be the approver.
DO $x16$ DECLARE v jsonb; ok boolean := false; BEGIN
  BEGIN
    v := public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tok5')), public.t3f_u(5),
      '44906180-0000-4000-9000-0000000000a1', NULL, public.t3f_m(2), '2580', 'refund', public.t3f_id('pay'));
    ok := NOT COALESCE((v->>'ok')::boolean, false);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN
    -- even if approved, the take must refuse it
    BEGIN
      PERFORM public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'seller', false,
        public.t3f_u(2), public.t3f_u(5), gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN ok := true;
    END;
  END IF;
  PERFORM public.t3f_ok(ok, 'X1-6 a seller''s own PIN never authorises a refund');
END $x16$;
-- X1-7 a Till device that names no device (acts as itself) is refused, and a
--      non-device account cannot claim to be the device for someone.
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'self', false,
  public.t3f_u(5), NULL, gen_random_uuid())$q$, NULL, NULL, 'X1-7a the device as its own actor refunds nothing');
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'fake device', false,
  public.t3f_u(1), public.t3f_u(3), gen_random_uuid())$q$, NULL, NULL,
  'X1-7b naming a non-device account as the device refunds nothing');
-- X1-8 one approval, two different requests in ONE transaction: second refused.
DO $x18$ DECLARE v jsonb; v_err text; n bigint; BEGIN
  v := public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tok5')), public.t3f_u(5),
    '44906180-0000-4000-9000-0000000000a1', NULL, public.t3f_m(3), '4826', 'refund', public.t3f_id('pay'));
  PERFORM public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'r-a', false,
    public.t3f_u(3), public.t3f_u(5), gen_random_uuid());
  BEGIN
    PERFORM public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'r-b', false,
      public.t3f_u(3), public.t3f_u(5), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  SELECT COALESCE(sum(amount_minor), 0) INTO n FROM public.venue_till_refunds WHERE payment_id = public.t3f_id('pay')::uuid;
  PERFORM public.t3f_ok(v_err = 'pin_step_up_required' AND n = 10000,
    'X1-8 a second request in the same transaction cannot reuse the consumed approval (100.00 out, not 200.00)');
END $x18$;
-- X1-9 same client request id replayed with a DIFFERENT amount: no second movement.
DO $x19$ DECLARE v jsonb; req uuid := gen_random_uuid(); n0 bigint; n1 bigint; v_err text; BEGIN
  v := public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tok5')), public.t3f_u(5),
    '44906180-0000-4000-9000-0000000000a1', NULL, public.t3f_m(3), '4826', 'refund', public.t3f_id('pay'));
  PERFORM public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'r-c', false,
    public.t3f_u(3), public.t3f_u(5), req);
  SELECT sum(amount_minor) INTO n0 FROM public.venue_till_refunds WHERE payment_id = public.t3f_id('pay')::uuid;
  BEGIN
    v := public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 90000, 0, 'r-c bigger', false,
      public.t3f_u(3), public.t3f_u(5), req);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  SELECT sum(amount_minor) INTO n1 FROM public.venue_till_refunds WHERE payment_id = public.t3f_id('pay')::uuid;
  RAISE NOTICE 'X1-9 info: replay-with-other-amount answered % / err %', v, v_err;
  PERFORM public.t3f_ok(n1 = n0, 'X1-9 the same request id with a bigger amount moves nothing more');
END $x19$;

-- ---------------------------------------------------------------------------
-- X2 day close / reopen / close: stale ids, both orders.
-- ---------------------------------------------------------------------------
DO $x2$
DECLARE
  b uuid := '44906180-0000-4000-9000-0000000000b1';
  d date := public.issue_4490_venue_service_date('44906180-0000-4000-9000-0000000000b1', now());
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid();
  v jsonb; e text;
BEGIN
  v := public.issue_4490_day_close(b, d, 0, public.t3f_u(1), NULL, r1);
  v := public.issue_4490_day_reopen(b, d, 'recount 1', public.t3f_u(1), NULL);
  v := public.issue_4490_day_close(b, d, 0, public.t3f_u(1), NULL, r2);
  v := public.issue_4490_day_reopen(b, d, 'recount 2', public.t3f_u(1), NULL);
  BEGIN PERFORM public.issue_4490_day_close(b, d, 0, public.t3f_u(1), NULL, r1); EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  PERFORM public.t3f_ok(e = 'day_close_request_stale', 'X2-1 the first close id is stale after two reopens');
  e := NULL;
  BEGIN PERFORM public.issue_4490_day_close(b, d, 0, public.t3f_u(1), NULL, r2); EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  PERFORM public.t3f_ok(e = 'day_close_request_stale', 'X2-2 the second close id is stale too');
  v := public.issue_4490_day_close(b, d, 0, public.t3f_u(1), NULL, r3);
  PERFORM public.t3f_ok(v->>'state' = 'closed' AND NOT (v->>'replayed')::boolean, 'X2-3 a fresh id closes');
  e := NULL;
  BEGIN PERFORM public.issue_4490_day_close(b, d, 0, public.t3f_u(1), NULL, r1); EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  PERFORM public.t3f_ok(e IN ('day_close_request_stale', 'day_already_closed'), 'X2-4 a stale id against a closed day closes nothing (' || COALESCE(e,'no error') || ')');
  -- reopen approval for day D cannot reopen another date
  e := NULL;
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tok5b')), public.t3f_u(5), b, NULL,
    NULL, '9157', 'reopen', b::text || ':' || (d - 1)::text);
  BEGIN PERFORM public.issue_4490_day_reopen(b, d, 'wrong day', public.t3f_u(1), public.t3f_u(5)); EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  PERFORM public.t3f_ok(e = 'pin_step_up_required', 'X2-5 a reopen approval for yesterday does not reopen today');
END
$x2$;

-- ---------------------------------------------------------------------------
-- X3 sold out: dearer swap refused; permuted line order is the same request;
--    same key other resolution refused; a seller cannot swap money back.
-- ---------------------------------------------------------------------------
DO $x3$
BEGIN
  PERFORM public.issue_4490_stock_set(public.t3f_id('x')::uuid, 0, NULL, public.t3f_u(1), NULL);
  PERFORM public.issue_4490_stock_set(public.t3f_id('w')::uuid, 0, NULL, public.t3f_u(1), NULL);
  INSERT INTO t3f_ids VALUES
    ('q1', public.t3f_guest('q1', jsonb_build_array(jsonb_build_array(public.t3f_id('w'), 1)))),
    ('q2', public.t3f_guest('q2', jsonb_build_array(jsonb_build_array(public.t3f_id('x'), 1), jsonb_build_array(public.t3f_id('w'), 1)))),
    ('q3', public.t3f_guest('q3', jsonb_build_array(jsonb_build_array(public.t3f_id('x'), 1))));
  PERFORM public.t3f_pay(public.t3f_id(k)::uuid) FROM unnest(ARRAY['q1','q2','q3']) k;
END
$x3$;
SELECT public.t3f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t3f_u(1), NULL,
  'x3-dearer')$q$, public.t3f_id('q1'), public.t3f_line(public.t3f_id('q1')::uuid, public.t3f_id('w')::uuid), public.t3f_id('z')),
  'PT409', 'sold_out_swap_dearer', 'X3-1 a swap to a dearer item (3,000 -> 5,000) is refused (no free upgrade)');
SELECT public.t3f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t3f_u(2), NULL,
  'x3-seller-cheaper')$q$, public.t3f_id('q1'), public.t3f_line(public.t3f_id('q1')::uuid, public.t3f_id('w')::uuid), public.t3f_id('y')),
  '42501', 'not_authorized', 'X3-2 a seller cannot swap 3,000 for 1,000 (money back)');
DO $x33$ DECLARE r jsonb; r2 jsonb; l1 uuid; l2 uuid; e text; BEGIN
  l1 := public.t3f_line(public.t3f_id('q2')::uuid, public.t3f_id('x')::uuid);
  l2 := public.t3f_line(public.t3f_id('q2')::uuid, public.t3f_id('w')::uuid);
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('q2')::uuid, ARRAY[l1, l2], 'refund', NULL, public.t3f_u(1), NULL, 'x3-perm-key');
  r2 := public.issue_4490_order_sold_out_resolve(public.t3f_id('q2')::uuid, ARRAY[l2, l1, l2], 'refund', NULL, public.t3f_u(1), NULL, 'x3-perm-key');
  PERFORM public.t3f_ok((r2->>'replayed')::boolean AND r2->>'refundMinor' = r->>'refundMinor',
    'X3-3 the same lines in another order (with a duplicate) are the same request: replayed, nothing more');
  BEGIN
    PERFORM public.issue_4490_order_sold_out_resolve(public.t3f_id('q2')::uuid, ARRAY[l1, l2], 'swap', public.t3f_id('y')::uuid, public.t3f_u(1), NULL, 'x3-perm-key');
  EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  PERFORM public.t3f_ok(e = 'sold_out_key_reused', 'X3-4 the same key with the other resolution is refused');
  PERFORM public.t3f_ok((SELECT refunded_amount_cents FROM public.venue_orders WHERE id = public.t3f_id('q2')::uuid) <= (SELECT total_cents FROM public.venue_orders WHERE id = public.t3f_id('q2')::uuid)
      AND (SELECT count(*) FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = public.t3f_id('q2')::uuid) = 1,
    'X3-5 one refund row for the order, never more than it took');
END $x33$;

-- ---------------------------------------------------------------------------
-- X4 finalize replays.
-- ---------------------------------------------------------------------------
DO $x4$ DECLARE r jsonb; st text; BEGIN
  RESET ROLE;
  UPDATE public.venue_orders SET payment_status = 'cancelled' WHERE id = public.t3f_id('q3')::uuid;  -- confirmed_at set by pay
  PERFORM public.t3f_service();
  r := public.t3f_pay(public.t3f_id('q3')::uuid);
  SELECT payment_status INTO st FROM public.venue_orders WHERE id = public.t3f_id('q3')::uuid;
  PERFORM public.t3f_ok(r->>'status' = 'replayed' AND st = 'cancelled', 'X4-1 cancelled after payment: a replay changes nothing');
  r := public.pg_venue_order_finalize_payment(public.t3f_id('q3')::uuid, 'paystack', 1, 'NGN', 'mingla_vo_t3f_q3', NULL, NULL, NULL);
  SELECT payment_status INTO st FROM public.venue_orders WHERE id = public.t3f_id('q3')::uuid;
  PERFORM public.t3f_ok(st = 'cancelled', 'X4-2 a wrong-amount replay after cancel does not flip it to failed (' || (r->>'status') || ')');
  r := public.pg_venue_order_finalize_payment(public.t3f_id('q3')::uuid, 'paystack', 999999, 'NGN', 'mingla_vo_t3f_OTHER', NULL, NULL, NULL);
  PERFORM public.t3f_ok(r->>'status' = 'reference_mismatch', 'X4-3 a foreign reference is refused');
END $x4$;

-- ---------------------------------------------------------------------------
-- X5 #4420 overlap: the publish gates must keep #4420's caller-scoped event
--    json (main 20280724004420) alongside #4490's venue clause.
-- ---------------------------------------------------------------------------
DO $x5$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.business_publish_event_draft(uuid,jsonb,integer)',
                           'public.business_publish_rsvp_draft(uuid,jsonb,integer)'] LOOP
    PERFORM public.t3f_ok(position('issue_4420_event_json_for_caller(to_jsonb(v_event))' in pg_get_functiondef(f::regprocedure)) > 0
      AND position('AND v_event.venue_id IS NULL' in pg_get_functiondef(f::regprocedure)) > 0,
      'X5 ' || f || ' keeps #4420 event json for caller AND the #4490 venue clause');
  END LOOP;
END $x5$;

SELECT public.t3f_reset();
DO $done$ BEGIN RAISE NOTICE '==== T3F-ADV all checks passed ===='; END $done$;
ROLLBACK;
