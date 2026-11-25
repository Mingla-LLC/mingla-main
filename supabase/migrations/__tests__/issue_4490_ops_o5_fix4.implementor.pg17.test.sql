-- #4490 spec 08 O5 fix round 4: executable PostgreSQL 17 proof for migration
-- 20281203764490 ("can refund" has one rule: the sold-out refund, the
-- money-returning sold-out swap and the canRefund flag of the staff read ask
-- issue_4490_can_manage_money, the rule every Till refund already uses).
-- The suite owns its fixture and rolls back.
-- FAILS-ON-REVERT (24 Nov): without 20281203764490 the venue Manager (money
-- rights through the venue grant, no brand rank) reads canRefund false -> R1, and
-- is refused the sold-out refund and the cheaper swap -> R3 / R5 (not_authorized).
--
-- MINGLA-INVARIANT: I-4490-ONE-REFUND-RULE | issue #4490 | who may refund money at a venue is issue_4490_can_manage_money (venue.manage_money there, or brand rank >= finance_manager) for every Till refund, the sold-out refund, the money-returning sold-out swap and the canRefund flag the Host app reads; on a Till device each still needs a fresh PIN step-up.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4f_ids (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON t4f_ids TO PUBLIC;

CREATE FUNCTION public.t4f_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4F FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4f_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF (p_state IS NOT NULL AND SQLSTATE <> p_state) OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4F FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  % [% %]', p_label, SQLSTATE, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'T4F FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4f_as(p_user uuid)
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
CREATE FUNCTION public.t4f_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4f_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
CREATE FUNCTION public.t4f_id(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM t4f_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4f_u(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('44906190-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $f$;
CREATE FUNCTION public.t4f_m(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('44906190-0000-4000-a000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $f$;
CREATE FUNCTION public.t4f_hash(p_token text) RETURNS bytea LANGUAGE sql AS $f$
  SELECT extensions.digest(decode(p_token, 'hex'), 'sha256') $f$;
GRANT EXECUTE ON FUNCTION public.t4f_ok(boolean, text), public.t4f_expect(text, text, text, text), public.t4f_as(uuid),
  public.t4f_service(), public.t4f_reset(), public.t4f_id(text), public.t4f_u(integer), public.t4f_m(integer),
  public.t4f_hash(text) TO PUBLIC;

\set va '''44906190-0000-4000-9000-0000000000a1'''
\set vb '''44906190-0000-4000-9000-0000000000b1'''

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner; 02 seller at A; 03 restaurant manager at A (money);
-- 05 Till device at A and B; 06 kitchen at A.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT public.t4f_u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  't4f-' || n || '@example.test', now(), now()
FROM unnest(ARRAY[1, 2, 3, 5, 6]) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES (public.t4f_u(1), now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44906190-0000-4000-9000-000000000010', public.t4f_u(1), 'T4F 4490', 't4f-4490', 'NGN', 'paystack',
   now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  (:va, '44906190-0000-4000-9000-000000000010', 't4fa', 'T4F Grill A', 6.45, 3.40, 'restaurant', 'verified', 'NG'),
  (:vb, '44906190-0000-4000-9000-000000000010', 't4fb', 'T4F Bar B', 6.45, 3.41, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
SELECT '44906190-0000-4000-9000-000000000010', public.t4f_u(1), 'brand_owner', now()
WHERE NOT EXISTS (SELECT 1 FROM public.brand_team_members m WHERE m.brand_id = '44906190-0000-4000-9000-000000000010'
                  AND m.user_id = public.t4f_u(1) AND m.removed_at IS NULL);
UPDATE public.brand_team_members SET id = public.t4f_m(1), accepted_at = COALESCE(accepted_at, now())
WHERE brand_id = '44906190-0000-4000-9000-000000000010' AND user_id = public.t4f_u(1) AND removed_at IS NULL;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  (public.t4f_m(2), '44906190-0000-4000-9000-000000000010', public.t4f_u(2), 'venue_staff', now()),
  (public.t4f_m(3), '44906190-0000-4000-9000-000000000010', public.t4f_u(3), 'venue_staff', now()),
  (public.t4f_m(5), '44906190-0000-4000-9000-000000000010', public.t4f_u(5), 'venue_staff', now()),
  (public.t4f_m(6), '44906190-0000-4000-9000-000000000010', public.t4f_u(6), 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  (public.t4f_m(2), :va, 'custom', ARRAY['venue.sell']),
  (public.t4f_m(3), :va, 'restaurant_manager',
   ARRAY['venue.sell', 'venue.kitchen', 'venue.manage_money', 'restaurant.view_orders', 'restaurant.manage_orders']),
  (public.t4f_m(5), :va, 'till_device', ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  (public.t4f_m(5), :vb, 'till_device', ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  (public.t4f_m(6), :va, 'kitchen_bar', ARRAY['venue.kitchen']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44906190-0000-4000-b000-000000000001', '44906190-0000-4000-9000-000000000010', :va, 'Kitchen A', true);
-- X 5,000.00 and W 3,000.00 (tracked, sold out below); Y 1,000.00 and Z 5,000.00 (never tracked).
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available, prep_station, sort_order) VALUES
  ('44906190-0000-4000-b000-000000000011', '44906190-0000-4000-b000-000000000001', '44906190-0000-4000-9000-000000000010', 'X', 500000, 'NGN', true, 'kitchen', 1),
  ('44906190-0000-4000-b000-000000000012', '44906190-0000-4000-b000-000000000001', '44906190-0000-4000-9000-000000000010', 'W', 300000, 'NGN', true, 'kitchen', 2),
  ('44906190-0000-4000-b000-000000000013', '44906190-0000-4000-b000-000000000001', '44906190-0000-4000-9000-000000000010', 'Y', 100000, 'NGN', true, 'kitchen', 3),
  ('44906190-0000-4000-b000-000000000014', '44906190-0000-4000-b000-000000000001', '44906190-0000-4000-9000-000000000010', 'Z', 500000, 'NGN', true, 'kitchen', 4);
INSERT INTO t4f_ids VALUES ('x', '44906190-0000-4000-b000-000000000011'), ('w', '44906190-0000-4000-b000-000000000012'),
  ('y', '44906190-0000-4000-b000-000000000013'), ('z', '44906190-0000-4000-b000-000000000014');

SELECT public.t4f_as(public.t4f_u(1));
DO $feat$
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44906190-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 't4f-menu-a');
  PERFORM public.issue_4490_set_venue_feature('44906190-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 't4f-till-a');
  PERFORM public.issue_4490_set_venue_feature('44906190-0000-4000-9000-0000000000b1', 'till', true, NULL, NULL, NULL, 't4f-till-b');
END
$feat$;
SELECT public.t4f_reset();

-- A held Till round of n x item (as venue-till inserts it).
CREATE FUNCTION public.t4f_round(p_sale uuid, p_actor uuid, p_item uuid, p_qty integer)
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
    v_price * p_qty, v_price * p_qty, 'pending', 'held', 't4f-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true, 'till_sale_id', p_sale));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, p_item, 1, v_name, v_price, 'NGN', p_qty, 0, v_price * p_qty);
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, p_actor, NULL);
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t4f_ver(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale $f$;
-- A pending guest page order (Paystack) at venue A: lines [[item, qty], ...].
CREATE SEQUENCE public.t4f_pickup START 601;
GRANT USAGE ON SEQUENCE public.t4f_pickup TO PUBLIC;
CREATE FUNCTION public.t4f_guest(p_key text, p_lines jsonb)
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
  VALUES (v_session, '44906190-0000-4000-9000-000000000010', '44906190-0000-4000-9000-0000000000a1', 'NGN');
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, payment_status, paystack_reference, pickup_code, idempotency_key, metadata)
  VALUES (v_order, v_session, '44906190-0000-4000-9000-000000000010', '44906190-0000-4000-9000-0000000000a1',
    'guest_page', 'Ada', 'ada@example.com', '+2348030000000',
    'mingla', 'NGN', v_list, v_list, 0, 0, 0, 0,
    150, 0, v_fee, 0, false, false, false, v_list, 0, v_list,
    'paystack', 'pending', 'mingla_vo_t4f_' || p_key, lpad(nextval('public.t4f_pickup')::text, 3, '0'),
    't4f-guest:' || p_key, '{}'::jsonb);
  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    n := n + 1;
    SELECT price_cents, name INTO v_price, v_name FROM public.menu_items WHERE id = (r->>0)::uuid;
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents, station)
    VALUES (v_order, (r->>0)::uuid, n, v_name, v_price, 'NGN', (r->>1)::integer, 0, v_price * (r->>1)::integer,
      public.issue_4490_item_station((r->>0)::uuid, '44906190-0000-4000-9000-0000000000a1'));
  END LOOP;
  SET LOCAL session_replication_role = origin;
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t4f_pay(p_order uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.pg_venue_order_finalize_payment(o.id, 'paystack', o.total_cents, 'NGN', o.paystack_reference, NULL, NULL, NULL)
  FROM public.venue_orders o WHERE o.id = p_order $f$;
CREATE FUNCTION public.t4f_line(p_order uuid, p_item uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_order_items WHERE venue_order_id = p_order AND menu_item_id = p_item ORDER BY line_no LIMIT 1 $f$;
GRANT EXECUTE ON FUNCTION public.t4f_round(uuid, uuid, uuid, integer), public.t4f_ver(uuid),
  public.t4f_guest(text, jsonb), public.t4f_pay(uuid), public.t4f_line(uuid, uuid) TO PUBLIC;

-- PINs (set an hour back so the 24-hour count reads only this suite's tries).
SELECT public.t4f_service();
DO $pins$
BEGIN
  PERFORM public.issue_4490_pin_set(public.t4f_m(2), public.t4f_u(2), '2580');
  PERFORM public.issue_4490_pin_set(public.t4f_m(3), public.t4f_u(3), '4826');
  PERFORM public.issue_4490_pin_set(public.t4f_m(6), public.t4f_u(6), '7391');
END
$pins$;
RESET ROLE;
UPDATE public.brand_member_pins SET set_at = now() - interval '1 hour' WHERE brand_id = '44906190-0000-4000-9000-000000000010';
SELECT public.t4f_service();

-- Paid guest orders whose X (5,000.00) sold out after payment.
DO $stock0$
BEGIN
  PERFORM public.issue_4490_stock_set(public.t4f_id('x')::uuid, 0, NULL, public.t4f_u(1), NULL);
  INSERT INTO t4f_ids VALUES
    ('o1', public.t4f_guest('o1', jsonb_build_array(jsonb_build_array(public.t4f_id('x'), 1)))),
    ('o2', public.t4f_guest('o2', jsonb_build_array(jsonb_build_array(public.t4f_id('x'), 1)))),
    ('o3', public.t4f_guest('o3', jsonb_build_array(jsonb_build_array(public.t4f_id('x'), 1))));
  PERFORM public.t4f_pay(public.t4f_id(k)::uuid) FROM unnest(ARRAY['o1', 'o2', 'o3']) k;
  PERFORM public.t4f_ok((SELECT count(*) FROM public.venue_order_items i
                         WHERE i.venue_order_id = ANY (ARRAY[public.t4f_id('o1'), public.t4f_id('o2'), public.t4f_id('o3')]::uuid[])
                           AND i.sold_out_at IS NOT NULL) = 3,
    'R0 three paid guest lines sold out after payment');
END
$stock0$;

-- ===========================================================================
-- R1-R2. The staff read: canRefund is the Till refund rule.
-- ===========================================================================
SELECT public.t4f_ok((SELECT (v->>'canRefund')::boolean
                        AND (v->>'canRefund')::boolean = public.issue_4490_can_manage_money(:va, public.t4f_u(3))
  FROM public.issue_4490_order_sold_out(public.t4f_id('o1')::uuid, public.t4f_u(3)) v),
  'R1 the venue Manager (venue money rights, no brand rank) reads canRefund true: the same answer as a Till refund');
SELECT public.t4f_ok((SELECT NOT (v->>'canRefund')::boolean AND (v->>'canSwap')::boolean
  FROM public.issue_4490_order_sold_out(public.t4f_id('o1')::uuid, public.t4f_u(2)) v)
  AND (SELECT NOT (v->>'canRefund')::boolean AND (v->>'canSwap')::boolean
  FROM public.issue_4490_order_sold_out(public.t4f_id('o1')::uuid, public.t4f_u(6)) v)
  AND NOT public.issue_4490_can_manage_money(:va, public.t4f_u(2))
  AND NOT public.issue_4490_can_manage_money(:va, public.t4f_u(6)),
  'R2 a seller-only and a kitchen-only member read canRefund false (they cannot Till-refund either)');

-- ===========================================================================
-- R3-R6. On the Till device: the Manager switched in.
-- ===========================================================================
DO $unlock$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_pin_unlock('44906190-0000-4000-9000-0000000000a1', public.t4f_u(5), public.t4f_m(3), '4826', NULL);
  INSERT INTO t4f_ids VALUES ('tokM', v->>'token');
  PERFORM public.t4f_ok(v ? 'token', 'R3-0 the Manager switches in on device 05');
END
$unlock$;
SELECT public.t4f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL, public.t4f_u(3),
  public.t4f_u(5), 'f4-mgr-refund')$q$, public.t4f_id('o1'), public.t4f_line(public.t4f_id('o1')::uuid, public.t4f_id('x')::uuid)),
  'P0001', 'pin_step_up_required', 'R3a the Manager''s sold-out refund on a Till device still needs a fresh PIN');
DO $mgrrefund$
DECLARE
  r jsonb;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t4f_hash(public.t4f_id('tokM')), public.t4f_u(5),
    '44906190-0000-4000-9000-0000000000a1', NULL, NULL, '4826', 'refund', public.t4f_id('o1'));
  r := public.issue_4490_order_sold_out_resolve(public.t4f_id('o1')::uuid,
    ARRAY[public.t4f_line(public.t4f_id('o1')::uuid, public.t4f_id('x')::uuid)], 'refund', NULL,
    public.t4f_u(3), public.t4f_u(5), 'f4-mgr-refund');
  PERFORM public.t4f_ok((r->>'refundMinor')::bigint = 500000
      AND EXISTS (SELECT 1 FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = public.t4f_id('o1')::uuid),
    'R3 with their fresh PIN the venue Manager refunds the sold-out line (5,000.00)');
END
$mgrrefund$;
SELECT public.t4f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t4f_u(3),
  public.t4f_u(5), 'f4-mgr-swap')$q$, public.t4f_id('o2'), public.t4f_line(public.t4f_id('o2')::uuid, public.t4f_id('x')::uuid), public.t4f_id('y')),
  'P0001', 'pin_step_up_required', 'R4 the Manager''s cheaper swap on a Till device still needs a fresh PIN');
DO $mgrswap$
DECLARE
  r jsonb;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t4f_hash(public.t4f_id('tokM')), public.t4f_u(5),
    '44906190-0000-4000-9000-0000000000a1', NULL, NULL, '4826', 'swap_refund', public.t4f_id('o2'));
  r := public.issue_4490_order_sold_out_resolve(public.t4f_id('o2')::uuid,
    ARRAY[public.t4f_line(public.t4f_id('o2')::uuid, public.t4f_id('x')::uuid)], 'swap', public.t4f_id('y')::uuid,
    public.t4f_u(3), public.t4f_u(5), 'f4-mgr-swap');
  PERFORM public.t4f_ok((r->>'refundMinor')::bigint = 400000,
    'R5 with their fresh PIN the venue Manager swaps X for the cheaper Y and 4,000.00 goes back');
END
$mgrswap$;

-- ===========================================================================
-- R6-R7. Kitchen-only and seller-only are still refused (no PIN makes them
--        someone who can refund).
-- ===========================================================================
SELECT public.t4f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL, public.t4f_u(6), NULL,
  'f4-kitchen-refund')$q$, public.t4f_id('o3'), public.t4f_line(public.t4f_id('o3')::uuid, public.t4f_id('x')::uuid)),
  '42501', 'not_authorized', 'R6a the kitchen cannot refund the sold-out line');
SELECT public.t4f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t4f_u(6), NULL,
  'f4-kitchen-swap')$q$, public.t4f_id('o3'), public.t4f_line(public.t4f_id('o3')::uuid, public.t4f_id('x')::uuid), public.t4f_id('y')),
  '42501', 'not_authorized', 'R6b the kitchen cannot make a cheaper swap (it gives money back)');
SELECT public.t4f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL, public.t4f_u(2), NULL,
  'f4-seller-refund')$q$, public.t4f_id('o3'), public.t4f_line(public.t4f_id('o3')::uuid, public.t4f_id('x')::uuid)),
  '42501', 'not_authorized', 'R7a the seller cannot refund the sold-out line');
SELECT public.t4f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t4f_u(2), NULL,
  'f4-seller-swap')$q$, public.t4f_id('o3'), public.t4f_line(public.t4f_id('o3')::uuid, public.t4f_id('x')::uuid), public.t4f_id('y')),
  '42501', 'not_authorized', 'R7b the seller cannot make a cheaper swap');
-- On the device, the seller switched in with their own fresh PIN is still refused.
DO $sellerdev$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_pin_unlock('44906190-0000-4000-9000-0000000000a1', public.t4f_u(5), public.t4f_m(2), '2580', NULL);
  INSERT INTO t4f_ids VALUES ('tokS', v->>'token');
  v := public.issue_4490_pin_approve(public.t4f_hash(public.t4f_id('tokS')), public.t4f_u(5),
    '44906190-0000-4000-9000-0000000000a1', NULL, NULL, '2580', 'refund', public.t4f_id('o3'));
  PERFORM public.t4f_ok(NOT COALESCE((v->>'ok')::boolean, false),
    'R7c the seller''s own PIN gives no refund approval (no money rights)');
END
$sellerdev$;
SELECT public.t4f_reset();

DO $done$ BEGIN RAISE NOTICE '==== T4F all checks passed ===='; END $done$;
ROLLBACK;
