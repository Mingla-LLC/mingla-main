-- #4490 spec 08 O5 fix round 5: executable PostgreSQL 17 proof for migration
-- 20281203784490 (a cheaper sold-out swap gives money back, so it follows the
-- one refund rule, issue_4490_can_manage_money, server and Host flag alike; a
-- same-price swap keeps the kitchen or seller rule).
-- The suite owns its fixture and rolls back.
-- FAILS-ON-REVERT (24 Nov): without 20281203784490 the brand finance manager
-- reads canSwap false and no canSwapEven -> S1, and the server refuses their
-- cheaper swap (not_authorized) -> S3.
--
-- MINGLA-INVARIANT: I-4490-CHEAPER-SWAP-IS-A-REFUND | issue #4490 | a sold-out swap that gives money back may be made by whoever may refund (issue_4490_can_manage_money) and the staff read's canSwap says so; a swap that gives nothing back needs the kitchen or seller grant (canSwapEven).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t5f_ids (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON t5f_ids TO PUBLIC;

CREATE FUNCTION public.t5f_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T5F FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t5f_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF (p_state IS NOT NULL AND SQLSTATE <> p_state) OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T5F FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  % [% %]', p_label, SQLSTATE, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'T5F FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t5f_as(p_user uuid)
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
CREATE FUNCTION public.t5f_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t5f_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
CREATE FUNCTION public.t5f_id(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM t5f_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t5f_u(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('44906191-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $f$;
CREATE FUNCTION public.t5f_m(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('44906191-0000-4000-a000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $f$;
CREATE FUNCTION public.t5f_hash(p_token text) RETURNS bytea LANGUAGE sql AS $f$
  SELECT extensions.digest(decode(p_token, 'hex'), 'sha256') $f$;
GRANT EXECUTE ON FUNCTION public.t5f_ok(boolean, text), public.t5f_expect(text, text, text, text), public.t5f_as(uuid),
  public.t5f_service(), public.t5f_reset(), public.t5f_id(text), public.t5f_u(integer), public.t5f_m(integer),
  public.t5f_hash(text) TO PUBLIC;

\set va '''44906191-0000-4000-9000-0000000000a1'''
\set vb '''44906191-0000-4000-9000-0000000000b1'''

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner; 02 seller at A; 06 kitchen at A; 07 brand finance manager
-- (money rights through brand rank, no venue grant).
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT public.t5f_u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  't5f-' || n || '@example.test', now(), now()
FROM unnest(ARRAY[1, 2, 6, 7]) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES (public.t5f_u(1), now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44906191-0000-4000-9000-000000000010', public.t5f_u(1), 'T5F 4490', 't5f-4490', 'NGN', 'paystack',
   now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  (:va, '44906191-0000-4000-9000-000000000010', 't5fa', 'T5F Grill A', 6.45, 3.40, 'restaurant', 'verified', 'NG'),
  (:vb, '44906191-0000-4000-9000-000000000010', 't5fb', 'T5F Bar B', 6.45, 3.41, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
SELECT '44906191-0000-4000-9000-000000000010', public.t5f_u(1), 'brand_owner', now()
WHERE NOT EXISTS (SELECT 1 FROM public.brand_team_members m WHERE m.brand_id = '44906191-0000-4000-9000-000000000010'
                  AND m.user_id = public.t5f_u(1) AND m.removed_at IS NULL);
UPDATE public.brand_team_members SET id = public.t5f_m(1), accepted_at = COALESCE(accepted_at, now())
WHERE brand_id = '44906191-0000-4000-9000-000000000010' AND user_id = public.t5f_u(1) AND removed_at IS NULL;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  (public.t5f_m(2), '44906191-0000-4000-9000-000000000010', public.t5f_u(2), 'venue_staff', now()),
  (public.t5f_m(6), '44906191-0000-4000-9000-000000000010', public.t5f_u(6), 'venue_staff', now()),
  (public.t5f_m(7), '44906191-0000-4000-9000-000000000010', public.t5f_u(7), 'finance_manager', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  (public.t5f_m(2), :va, 'custom', ARRAY['venue.sell']),
  (public.t5f_m(6), :va, 'kitchen_bar', ARRAY['venue.kitchen']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44906191-0000-4000-b000-000000000001', '44906191-0000-4000-9000-000000000010', :va, 'Kitchen A', true);
-- X 5,000.00 and W 3,000.00 (tracked, sold out below); Y 1,000.00 and Z 5,000.00 (never tracked).
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available, prep_station, sort_order) VALUES
  ('44906191-0000-4000-b000-000000000011', '44906191-0000-4000-b000-000000000001', '44906191-0000-4000-9000-000000000010', 'X', 500000, 'NGN', true, 'kitchen', 1),
  ('44906191-0000-4000-b000-000000000012', '44906191-0000-4000-b000-000000000001', '44906191-0000-4000-9000-000000000010', 'W', 300000, 'NGN', true, 'kitchen', 2),
  ('44906191-0000-4000-b000-000000000013', '44906191-0000-4000-b000-000000000001', '44906191-0000-4000-9000-000000000010', 'Y', 100000, 'NGN', true, 'kitchen', 3),
  ('44906191-0000-4000-b000-000000000014', '44906191-0000-4000-b000-000000000001', '44906191-0000-4000-9000-000000000010', 'Z', 500000, 'NGN', true, 'kitchen', 4);
INSERT INTO t5f_ids VALUES ('x', '44906191-0000-4000-b000-000000000011'), ('w', '44906191-0000-4000-b000-000000000012'),
  ('y', '44906191-0000-4000-b000-000000000013'), ('z', '44906191-0000-4000-b000-000000000014');

SELECT public.t5f_as(public.t5f_u(1));
DO $feat$
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44906191-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 't5f-menu-a');
  PERFORM public.issue_4490_set_venue_feature('44906191-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 't5f-till-a');
  PERFORM public.issue_4490_set_venue_feature('44906191-0000-4000-9000-0000000000b1', 'till', true, NULL, NULL, NULL, 't5f-till-b');
END
$feat$;
SELECT public.t5f_reset();

CREATE FUNCTION public.t5f_ver(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale $f$;
-- A pending guest page order (Paystack) at venue A: lines [[item, qty], ...].
CREATE SEQUENCE public.t5f_pickup START 601;
GRANT USAGE ON SEQUENCE public.t5f_pickup TO PUBLIC;
CREATE FUNCTION public.t5f_guest(p_key text, p_lines jsonb)
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
  VALUES (v_session, '44906191-0000-4000-9000-000000000010', '44906191-0000-4000-9000-0000000000a1', 'NGN');
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, payment_status, paystack_reference, pickup_code, idempotency_key, metadata)
  VALUES (v_order, v_session, '44906191-0000-4000-9000-000000000010', '44906191-0000-4000-9000-0000000000a1',
    'guest_page', 'Ada', 'ada@example.com', '+2348030000000',
    'mingla', 'NGN', v_list, v_list, 0, 0, 0, 0,
    150, 0, v_fee, 0, false, false, false, v_list, 0, v_list,
    'paystack', 'pending', 'mingla_vo_t5f_' || p_key, lpad(nextval('public.t5f_pickup')::text, 3, '0'),
    't5f-guest:' || p_key, '{}'::jsonb);
  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    n := n + 1;
    SELECT price_cents, name INTO v_price, v_name FROM public.menu_items WHERE id = (r->>0)::uuid;
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents, station)
    VALUES (v_order, (r->>0)::uuid, n, v_name, v_price, 'NGN', (r->>1)::integer, 0, v_price * (r->>1)::integer,
      public.issue_4490_item_station((r->>0)::uuid, '44906191-0000-4000-9000-0000000000a1'));
  END LOOP;
  SET LOCAL session_replication_role = origin;
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t5f_pay(p_order uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.pg_venue_order_finalize_payment(o.id, 'paystack', o.total_cents, 'NGN', o.paystack_reference, NULL, NULL, NULL)
  FROM public.venue_orders o WHERE o.id = p_order $f$;
CREATE FUNCTION public.t5f_line(p_order uuid, p_item uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_order_items WHERE venue_order_id = p_order AND menu_item_id = p_item ORDER BY line_no LIMIT 1 $f$;
GRANT EXECUTE ON FUNCTION public.t5f_ver(uuid),
  public.t5f_guest(text, jsonb), public.t5f_pay(uuid), public.t5f_line(uuid, uuid) TO PUBLIC;

-- Paid guest orders whose X (5,000.00) sold out after payment.
SELECT public.t5f_service();
DO $stock0$
BEGIN
  PERFORM public.issue_4490_stock_set(public.t5f_id('x')::uuid, 0, NULL, public.t5f_u(1), NULL);
  INSERT INTO t5f_ids VALUES
    ('o1', public.t5f_guest('o1', jsonb_build_array(jsonb_build_array(public.t5f_id('x'), 1)))),
    ('o2', public.t5f_guest('o2', jsonb_build_array(jsonb_build_array(public.t5f_id('x'), 1)))),
    ('o3', public.t5f_guest('o3', jsonb_build_array(jsonb_build_array(public.t5f_id('x'), 1))));
  PERFORM public.t5f_pay(public.t5f_id(k)::uuid) FROM unnest(ARRAY['o1', 'o2', 'o3']) k;
  PERFORM public.t5f_ok((SELECT count(*) FROM public.venue_order_items i
                         WHERE i.venue_order_id = ANY (ARRAY[public.t5f_id('o1'), public.t5f_id('o2'), public.t5f_id('o3')]::uuid[])
                           AND i.sold_out_at IS NOT NULL) = 3,
    'S0 three paid guest lines sold out after payment');
  PERFORM public.t5f_ok(public.issue_4490_can_manage_money('44906191-0000-4000-9000-0000000000a1', public.t5f_u(7))
      AND NOT public.issue_4490_can_sell('44906191-0000-4000-9000-0000000000a1', public.t5f_u(7))
      AND NOT public.issue_4490_can_kitchen('44906191-0000-4000-9000-0000000000a1', public.t5f_u(7)),
    'S0b the finance manager may refund at the venue but neither sells nor works the kitchen');
END
$stock0$;

-- ===========================================================================
-- S1-S2. The staff read: canSwap follows the refund rule for a cheaper swap;
--        canSwapEven (same price) keeps the kitchen or seller rule.
-- ===========================================================================
SELECT public.t5f_ok((SELECT (v->>'canRefund')::boolean AND (v->>'canSwap')::boolean
                             AND (v->>'canSwapEven') = 'false'
  FROM public.issue_4490_order_sold_out(public.t5f_id('o1')::uuid, public.t5f_u(7)) v),
  'S1 the finance manager reads canRefund true, canSwap true (a cheaper swap) and canSwapEven false');
SELECT public.t5f_ok((SELECT NOT (v->>'canRefund')::boolean AND (v->>'canSwap')::boolean AND (v->>'canSwapEven')::boolean
  FROM public.issue_4490_order_sold_out(public.t5f_id('o1')::uuid, public.t5f_u(2)) v)
  AND (SELECT NOT (v->>'canRefund')::boolean AND (v->>'canSwap')::boolean AND (v->>'canSwapEven')::boolean
  FROM public.issue_4490_order_sold_out(public.t5f_id('o1')::uuid, public.t5f_u(6)) v),
  'S2 the seller and the kitchen read canSwap and canSwapEven true, canRefund false (unchanged)');

-- ===========================================================================
-- S3-S4. The finance manager: the cheaper swap goes through; the same-price
--        swap is refused and changes nothing.
-- ===========================================================================
DO $fmswap$
DECLARE
  r jsonb;
BEGIN
  r := public.issue_4490_order_sold_out_resolve(public.t5f_id('o1')::uuid,
    ARRAY[public.t5f_line(public.t5f_id('o1')::uuid, public.t5f_id('x')::uuid)], 'swap', public.t5f_id('y')::uuid,
    public.t5f_u(7), NULL, 'f5-fm-cheaper');
  PERFORM public.t5f_ok((r->>'refundMinor')::bigint = 400000
      AND EXISTS (SELECT 1 FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = public.t5f_id('o1')::uuid),
    'S3 the finance manager swaps X for the cheaper Y and 4,000.00 goes back');
END
$fmswap$;
SELECT public.t5f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t5f_u(7), NULL,
  'f5-fm-same')$q$, public.t5f_id('o2'), public.t5f_line(public.t5f_id('o2')::uuid, public.t5f_id('x')::uuid), public.t5f_id('z')),
  '42501', 'not_authorized', 'S4a the finance manager cannot make a same-price swap (no money moves: kitchen or seller rule)');
SELECT public.t5f_ok((SELECT i.sold_out_resolution IS NULL AND i.voided_at IS NULL
  FROM public.venue_order_items i WHERE i.id = public.t5f_line(public.t5f_id('o2')::uuid, public.t5f_id('x')::uuid))
  AND (SELECT count(*) FROM public.venue_order_items i WHERE i.venue_order_id = public.t5f_id('o2')::uuid) = 1,
  'S4b the refused same-price swap left the line waiting and added no line');

-- ===========================================================================
-- S5-S6. The kitchen: the same-price swap still goes through; the cheaper
--        swap is still refused (it gives money back).
-- ===========================================================================
DO $kswap$
DECLARE
  r jsonb;
BEGIN
  r := public.issue_4490_order_sold_out_resolve(public.t5f_id('o2')::uuid,
    ARRAY[public.t5f_line(public.t5f_id('o2')::uuid, public.t5f_id('x')::uuid)], 'swap', public.t5f_id('z')::uuid,
    public.t5f_u(6), NULL, 'f5-kitchen-same');
  PERFORM public.t5f_ok((r->>'refundMinor')::bigint = 0 AND r->>'swapName' = 'Z',
    'S5 the kitchen swaps X for Z at the same price; nothing goes back');
END
$kswap$;
SELECT public.t5f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t5f_u(6), NULL,
  'f5-kitchen-cheaper')$q$, public.t5f_id('o3'), public.t5f_line(public.t5f_id('o3')::uuid, public.t5f_id('x')::uuid), public.t5f_id('y')),
  '42501', 'not_authorized', 'S6 the kitchen still cannot make a cheaper swap');
SELECT public.t5f_reset();

DO $done$ BEGIN RAISE NOTICE '==== T5F all checks passed ===='; END $done$;
ROLLBACK;
