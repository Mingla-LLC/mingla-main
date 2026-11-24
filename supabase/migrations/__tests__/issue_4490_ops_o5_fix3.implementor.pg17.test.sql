-- #4490 spec 08 O5 fix round 3: executable PostgreSQL 17 proof for migration
-- 20281203754490 (step-up approvals bound to a purpose and a target and used
-- once, in the database; money-returning swaps are refunds; a close request
-- from before a reopen is stale; a sold-out key reused for other lines is
-- refused; a payment replay after a refund changes nothing; the guest refund
-- decision from a Till device login needs a fresh PIN).
-- The suite owns its fixture and rolls back.
-- Fix 4 adds: F1d-pdf (the day-close PDF source, issue_4490_day_close_pdf, consumes
-- its export step-up so the PDF's PIN cannot also export the CSV) and F2-7 (a
-- sold-out request retried with no fresh PIN answers its stored result and spends
-- no approval: the replay is checked before the step-up is taken).
-- FAILS-ON-REVERT (fix 4, 24 Nov): day_close_pdf without its step-up take -> F1d-pdf-1
-- (no error); sold_out_resolve taking the step-up before the replay check (as at
-- 435a9edd8c) -> F2-7a (pin_step_up_required).
--
-- MINGLA-INVARIANT: I-4490-STEP-UP-BOUND-SINGLE-USE | issue #4490 | a money write recorded for a Till device (device_user_id <> actor) needs a fresh step-up approval for that purpose and that target on the device's live PIN session, taken and marked consumed in the write's own transaction (issue_4490_pin_step_up_take): every Till refund row (even by the switched-in member), a sent void, a day reopen, a day export, a sold-out refund, a money-returning sold-out swap and a guest refund approved from a Till device login; one approval authorises one request.
-- MINGLA-INVARIANT: I-4490-SWAP-MONEY-IS-A-REFUND | issue #4490 | a sold-out swap that gives any money back needs the refund rights (issue_4490_can_manage_money, the Till refund rule, since 08-O5 fix 4) and, on a Till device, a swap_refund step-up; a swap that gives nothing back keeps the swap rules.
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
-- F1. Till refunds: an approval for this purpose and this target, used once,
--     needed even from the switched-in member.
-- ===========================================================================
DO $refunds$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  v jsonb;
  v_sale uuid;
  v_pay uuid;
  v_req uuid;
BEGIN
  v := public.issue_4490_pin_unlock(a, public.t3f_u(5), public.t3f_m(2), '2580', NULL);
  INSERT INTO t3f_ids VALUES ('tokS', v->>'token');
  v := public.issue_4490_till_open(a, public.t3f_u(2), NULL, 'F1', NULL, 't3f-open-f1');
  v_sale := (v->>'id')::uuid;
  PERFORM public.t3f_round(v_sale, public.t3f_u(2), public.t3f_id('x')::uuid, 2);
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 1000000, 0, 1000000, public.t3f_u(2), public.t3f_u(5),
    gen_random_uuid(), public.t3f_ver(v_sale));
  v_pay := (v->>'paymentId')::uuid;
  INSERT INTO t3f_ids VALUES ('pay', v_pay), ('sale', v_sale);

  -- The manager approves an EXPORT on the seller's session: it never refunds.
  v := public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokS')), public.t3f_u(5), a, NULL,
    public.t3f_m(3), '4826', 'export', a::text || ':2026-01-01');
  PERFORM public.t3f_ok((v->>'ok')::boolean, 'F1-0 the manager''s export approval is given');
END
$refunds$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'export ok?', false,
  public.t3f_u(3), public.t3f_u(5), gen_random_uuid())$q$, 'P0001', 'pin_step_up_required',
  'F1-1 an approval given for "export" does not authorise a refund (P1)');
DO $wrongtarget$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  v := public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokS')), public.t3f_u(5), a, NULL,
    public.t3f_m(3), '4826', 'refund', gen_random_uuid()::text);
  PERFORM public.t3f_ok((v->>'ok')::boolean, 'F1-2a the manager approves a refund of ANOTHER payment');
END
$wrongtarget$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'other target', false,
  public.t3f_u(3), public.t3f_u(5), gen_random_uuid())$q$, 'P0001', 'pin_step_up_required',
  'F1-2 a refund approval for another payment does not refund this one');
DO $once$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  v jsonb;
  v_req uuid := gen_random_uuid();
  v_appr uuid;
BEGIN
  v := public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokS')), public.t3f_u(5), a, NULL,
    public.t3f_m(3), '4826', 'refund', upper(public.t3f_id('pay')));
  v_appr := (v->>'approvalId')::uuid;
  v := public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'one', false,
    public.t3f_u(3), public.t3f_u(5), v_req);
  PERFORM public.t3f_ok(NOT (v->>'replayed')::boolean
      AND (SELECT consumed_at IS NOT NULL AND consumed_ref = 'refund:' || v_req::text AND consumed_txid = txid_current()
           FROM public.venue_pin_approvals WHERE id = v_appr)
      AND (SELECT by_user_id = public.t3f_u(3) AND device_user_id = public.t3f_u(5)
           FROM public.venue_till_refunds WHERE client_request_id = v_req),
    'F1-3 the manager''s refund approval for this payment refunds 100.00 once (recorded under the manager, on the device) and is marked used by that request');
  v := public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'one', false,
    public.t3f_u(3), public.t3f_u(5), v_req);
  PERFORM public.t3f_ok((v->>'replayed')::boolean,
    'F1-4 the same refund request again is a replay (no approval needed, nothing moves)');
END
$once$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'two', false,
  public.t3f_u(3), public.t3f_u(5), gen_random_uuid())$q$, 'P0001', 'pin_step_up_required',
  'F1-5 a second refund needs a second PIN: the used approval authorises nothing more (P2)');
-- The manager switches in on the device: the session member still needs a fresh PIN to refund.
DO $member$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  v := public.issue_4490_pin_unlock(a, public.t3f_u(5), public.t3f_m(3), '4826', NULL);
  INSERT INTO t3f_ids VALUES ('tokM', v->>'token');
  PERFORM public.t3f_ok(v ? 'token', 'F1-6a the manager switches in on device 05');
END
$member$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'member', false,
  public.t3f_u(3), public.t3f_u(5), gen_random_uuid())$q$, 'P0001', 'pin_step_up_required',
  'F1-6 the switched-in member with money rights cannot refund without a fresh PIN (P3)');
DO $memberok$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  v jsonb;
  n bigint;
BEGIN
  v := public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokM')), public.t3f_u(5), a, NULL,
    NULL, '4826', 'refund', public.t3f_id('pay'));
  PERFORM public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'member', false,
    public.t3f_u(3), public.t3f_u(5), gen_random_uuid());
  SELECT sum(amount_minor) INTO n FROM public.venue_till_refunds WHERE payment_id = public.t3f_id('pay')::uuid;
  PERFORM public.t3f_ok(n = 20000, 'F1-7 with their own fresh PIN the member refunds (200.00 back in all, never more)');
END
$memberok$;
-- The take itself: one request may write several rows on one approval; another request may not.
DO $take$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  v jsonb;
  r1 uuid;
  r2 uuid;
  v_err text;
BEGIN
  v := public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokM')), public.t3f_u(5), a, NULL,
    NULL, '4826', 'refund', 'line-target');
  r1 := public.issue_4490_pin_step_up_take(a, public.t3f_u(3), public.t3f_u(5), 'refund', 'LINE-TARGET', 'refund:req-1', true);
  r2 := public.issue_4490_pin_step_up_take(a, public.t3f_u(3), public.t3f_u(5), 'refund', 'line-target', 'refund:req-1', true);
  BEGIN
    PERFORM public.issue_4490_pin_step_up_take(a, public.t3f_u(3), public.t3f_u(5), 'refund', 'line-target', 'refund:req-2', true);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM public.t3f_ok(r1 = public.t3f_u(3) AND r2 = public.t3f_u(3) AND v_err = 'pin_step_up_required'
      AND public.issue_4490_pin_step_up_take(a, public.t3f_u(1), public.t3f_u(1), 'refund', 'x', 'refund:own', true) IS NULL,
    'F1-8 one approval serves every row of ONE request (a refund over two payments) and nothing else; an account acting as itself takes nothing');
END
$take$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_pin_step_up_take('44906180-0000-4000-9000-0000000000a1', public.t3f_u(5),
  public.t3f_u(5), 'refund', 'x', 'refund:dev', true)$q$, '28000', 'pin_session_required',
  'F1-9 a Till device acting as itself never takes an approval');
-- The owner on their own account refunds as before (no device, no PIN).
DO $own$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_till_refund(public.t3f_id('pay')::uuid, 10000, 0, 'owner', false,
    public.t3f_u(1), NULL, gen_random_uuid());
  PERFORM public.t3f_ok(NOT (v->>'replayed')::boolean, 'F1-10 an account that is not a Till device refunds as before (no PIN)');
END
$own$;

-- ===========================================================================
-- F1v. A sent void needs a void_sent approval for that item, used once; the
--      caller's p_stepped_up flag alone authorises nothing.
-- ===========================================================================
DO $void$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  v jsonb;
  v_sale uuid;
  v_order uuid;
  v_item uuid;
BEGIN
  v := public.issue_4490_till_open(a, public.t3f_u(3), NULL, 'F1v', NULL, 't3f-open-f1v');
  v_sale := (v->>'id')::uuid;
  v_order := public.t3f_round(v_sale, public.t3f_u(3), public.t3f_id('y')::uuid, 1);
  PERFORM public.issue_4490_till_send(v_sale, public.t3f_u(3));
  SELECT id INTO v_item FROM public.venue_order_items WHERE venue_order_id = v_order;
  INSERT INTO t3f_ids VALUES ('vsale', v_sale), ('vitem', v_item);
END
$void$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_void_on_device(public.t3f_id('vsale')::uuid, NULL, public.t3f_id('vitem')::uuid,
  public.t3f_u(3), public.t3f_u(5), 'burnt', false, public.t3f_ver(public.t3f_id('vsale')::uuid), true)$q$,
  'P0001', 'pin_step_up_required', 'F1v-1 "stepped up" with no approval does not void a sent item');
DO $voidwrong$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokM')), public.t3f_u(5), a, NULL,
    NULL, '4826', 'refund', public.t3f_id('vitem'));
END
$voidwrong$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_till_void_on_device(public.t3f_id('vsale')::uuid, NULL, public.t3f_id('vitem')::uuid,
  public.t3f_u(3), public.t3f_u(5), 'burnt', false, public.t3f_ver(public.t3f_id('vsale')::uuid), false)$q$,
  'P0001', 'pin_step_up_required', 'F1v-2 a refund approval for the item does not void it (purpose bound)');
DO $voidok$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokM')), public.t3f_u(5), a, NULL,
    NULL, '4826', 'void_sent', public.t3f_id('vitem'));
  PERFORM public.issue_4490_till_void_on_device(public.t3f_id('vsale')::uuid, NULL, public.t3f_id('vitem')::uuid,
    public.t3f_u(3), public.t3f_u(5), 'burnt', false, public.t3f_ver(public.t3f_id('vsale')::uuid), true);
  PERFORM public.t3f_ok((SELECT voided_at IS NOT NULL FROM public.venue_order_items WHERE id = public.t3f_id('vitem')::uuid),
    'F1v-3 with a void_sent approval for this item the sent item is voided');
END
$voidok$;

-- ===========================================================================
-- F1d + F3. Reopen and export on a Till device; a stale close request.
-- ===========================================================================
DO $close$
DECLARE
  b uuid := '44906180-0000-4000-9000-0000000000b1';
  d date := public.issue_4490_venue_service_date('44906180-0000-4000-9000-0000000000b1', now());
  r1 uuid := gen_random_uuid();
  v jsonb;
BEGIN
  INSERT INTO t3f_ids VALUES ('dayB', d), ('closeR1', r1);
  v := public.issue_4490_day_close(b, d, 0, public.t3f_u(1), NULL, r1);
  PERFORM public.t3f_ok(v->>'state' = 'closed', 'F3-0 the owner closes day B (request R1)');
  v := public.issue_4490_pin_unlock(b, public.t3f_u(5), public.t3f_m(1), '9157', NULL);
  INSERT INTO t3f_ids VALUES ('tokB', v->>'token');
END
$close$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_reopen('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  'recount', public.t3f_u(1), public.t3f_u(5))$q$, 'P0001', 'pin_step_up_required',
  'F1d-1 the switched-in owner cannot reopen on the Till device without a fresh PIN (P5)');
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_export('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  public.t3f_u(1), public.t3f_u(5))$q$, 'P0001', 'pin_step_up_required',
  'F1d-2 nor export the day');
DO $exportok$
DECLARE
  b uuid := '44906180-0000-4000-9000-0000000000b1';
  v jsonb;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokB')), public.t3f_u(5), b, NULL,
    NULL, '9157', 'export', b::text || ':' || public.t3f_id('dayB'));
  v := public.issue_4490_day_export(b, public.t3f_id('dayB')::date, public.t3f_u(1), public.t3f_u(5));
  PERFORM public.t3f_ok(v ? 'rows', 'F1d-3 with an export approval for this day the export runs');
END
$exportok$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_export('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  public.t3f_u(1), public.t3f_u(5))$q$, 'P0001', 'pin_step_up_required',
  'F1d-4 a second export needs a second PIN');
-- F1d-pdf (fix 4, P3-1): the day-close PDF consumes its export approval in the
-- database (issue_4490_day_close_pdf), so the PIN typed for the PDF cannot also
-- authorise a CSV export of the same day.
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_close_pdf('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  public.t3f_u(1), public.t3f_u(5))$q$, 'P0001', 'pin_step_up_required',
  'F1d-pdf-1 the day-close PDF on the Till device needs a fresh PIN');
DO $pdfok$
DECLARE
  b uuid := '44906180-0000-4000-9000-0000000000b1';
  v jsonb;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokB')), public.t3f_u(5), b, NULL,
    NULL, '9157', 'export', b::text || ':' || public.t3f_id('dayB'));
  v := public.issue_4490_day_close_pdf(b, public.t3f_id('dayB')::date, public.t3f_u(1), public.t3f_u(5));
  PERFORM public.t3f_ok(v->>'state' = 'closed', 'F1d-pdf-2 with an export approval for this day the PDF source answers the day');
  PERFORM public.t3f_ok(NOT EXISTS (SELECT 1 FROM public.venue_pin_approvals
                                    WHERE venue_id = b AND purpose = 'export' AND consumed_at IS NULL),
    'F1d-pdf-3 the PDF consumed its approval (none left unused)');
END
$pdfok$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_export('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  public.t3f_u(1), public.t3f_u(5))$q$, 'P0001', 'pin_step_up_required',
  'F1d-pdf-4 the PIN typed for the PDF does not also export the CSV of that day');
SELECT public.t3f_ok((public.issue_4490_day_close_pdf('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
    public.t3f_u(1), NULL))->>'state' = 'closed',
  'F1d-pdf-5 the owner on their own account prints the day-close PDF with no PIN');
SELECT public.t3f_ok(NOT has_function_privilege('authenticated', 'public.issue_4490_day_close_pdf(uuid,date,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_day_close_pdf(uuid,date,uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4490_day_close_pdf(uuid,date,uuid,uuid)', 'EXECUTE'),
  'F1d-pdf-6 the PDF source is internal (service role only)');
DO $exportnoreopen$
DECLARE
  b uuid := '44906180-0000-4000-9000-0000000000b1';
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokB')), public.t3f_u(5), b, NULL,
    NULL, '9157', 'export', b::text || ':' || public.t3f_id('dayB'));
END
$exportnoreopen$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_reopen('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  'recount', public.t3f_u(1), public.t3f_u(5))$q$, 'P0001', 'pin_step_up_required',
  'F1d-5 an export approval does not reopen the day');
DO $reopenok$
DECLARE
  b uuid := '44906180-0000-4000-9000-0000000000b1';
  v jsonb;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokB')), public.t3f_u(5), b, NULL,
    NULL, '9157', 'reopen', b::text || ':' || public.t3f_id('dayB'));
  v := public.issue_4490_day_reopen(b, public.t3f_id('dayB')::date, 'recount', public.t3f_u(1), public.t3f_u(5));
  PERFORM public.t3f_ok((SELECT state = 'reopened' AND history->0->>'closeRequestId' = public.t3f_id('closeR1')
                         FROM public.venue_day_closes WHERE venue_id = b),
    'F1d-6 with a reopen approval for this day it reopens; history keeps the close''s request id');
END
$reopenok$;
SELECT public.t3f_expect($q$SELECT public.issue_4490_day_close('44906180-0000-4000-9000-0000000000b1', public.t3f_id('dayB')::date,
  0, public.t3f_u(1), NULL, public.t3f_id('closeR1')::uuid)$q$, 'PT409', 'day_close_request_stale',
  'F3-1 the close request from before the reopen, retried, does not close the day again (P6)');
DO $reclose$
DECLARE
  b uuid := '44906180-0000-4000-9000-0000000000b1';
  r2 uuid := gen_random_uuid();
  v jsonb;
BEGIN
  v := public.issue_4490_day_close(b, public.t3f_id('dayB')::date, 0, public.t3f_u(1), NULL, r2);
  PERFORM public.t3f_ok(v->>'state' = 'closed' AND NOT (v->>'replayed')::boolean, 'F3-2 a new count closes the day');
  v := public.issue_4490_day_close(b, public.t3f_id('dayB')::date, 0, public.t3f_u(1), NULL, r2);
  PERFORM public.t3f_ok((v->>'replayed')::boolean, 'F3-3 that close retried is still a replay');
END
$reclose$;

-- ===========================================================================
-- F2 + F4. Sold out after payment.
-- ===========================================================================
DO $stock0$
BEGIN
  PERFORM public.issue_4490_stock_set(public.t3f_id('x')::uuid, 0, NULL, public.t3f_u(1), NULL);
  PERFORM public.issue_4490_stock_set(public.t3f_id('w')::uuid, 0, NULL, public.t3f_u(1), NULL);
  INSERT INTO t3f_ids VALUES
    ('o1', public.t3f_guest('o1', jsonb_build_array(jsonb_build_array(public.t3f_id('x'), 1)))),
    ('o2', public.t3f_guest('o2', jsonb_build_array(jsonb_build_array(public.t3f_id('x'), 1)))),
    ('o3', public.t3f_guest('o3', jsonb_build_array(jsonb_build_array(public.t3f_id('x'), 1)))),
    ('o4', public.t3f_guest('o4', jsonb_build_array(jsonb_build_array(public.t3f_id('x'), 1),
                                                    jsonb_build_array(public.t3f_id('w'), 1)))),
    ('o5', public.t3f_guest('o5', jsonb_build_array(jsonb_build_array(public.t3f_id('y'), 1)))),
    ('o6', public.t3f_guest('o6', jsonb_build_array(jsonb_build_array(public.t3f_id('y'), 1)))),
    ('o7', public.t3f_guest('o7', jsonb_build_array(jsonb_build_array(public.t3f_id('y'), 1))));
  PERFORM public.t3f_pay(public.t3f_id(k)::uuid) FROM unnest(ARRAY['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']) k;
  PERFORM public.t3f_ok((SELECT count(*) FROM public.venue_order_items i
                         WHERE i.venue_order_id = ANY (ARRAY[public.t3f_id('o1'), public.t3f_id('o2'), public.t3f_id('o3'),
                                                             public.t3f_id('o4')]::uuid[])
                           AND i.sold_out_at IS NOT NULL) = 5,
    'F2-0 five paid guest lines sold out after payment');
END
$stock0$;
SELECT public.t3f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t3f_u(6), NULL,
  'f3-kitchen-money')$q$, public.t3f_id('o1'), public.t3f_line(public.t3f_id('o1')::uuid, public.t3f_id('x')::uuid), public.t3f_id('y')),
  '42501', 'not_authorized', 'F2-1 the kitchen cannot swap 5,000.00 for 1,000.00 (it gives money back: refund rights needed) (P8)');
DO $evenswap$
DECLARE
  r jsonb;
BEGIN
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('o1')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('o1')::uuid, public.t3f_id('x')::uuid)], 'swap', public.t3f_id('z')::uuid,
    public.t3f_u(6), NULL, 'f3-kitchen-even');
  PERFORM public.t3f_ok((r->>'refundMinor')::bigint = 0
      AND NOT EXISTS (SELECT 1 FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = public.t3f_id('o1')::uuid),
    'F2-2 a swap that gives nothing back (X for Z, same price) keeps the swap rules: the kitchen makes it');
END
$evenswap$;
-- On the Till device: the switched-in owner (refund rights) swaps with money back only with a fresh PIN.
DO $devunlock$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_pin_unlock('44906180-0000-4000-9000-0000000000a1', public.t3f_u(5), public.t3f_m(1), '9157', NULL);
  INSERT INTO t3f_ids VALUES ('tokO', v->>'token');
END
$devunlock$;
SELECT public.t3f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'swap', %L, public.t3f_u(1),
  public.t3f_u(5), 'f3-dev-swap')$q$, public.t3f_id('o2'), public.t3f_line(public.t3f_id('o2')::uuid, public.t3f_id('x')::uuid), public.t3f_id('y')),
  'P0001', 'pin_step_up_required', 'F2-3 on a Till device a money-returning swap needs a fresh PIN, even from the owner');
DO $devswapok$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  r jsonb;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokO')), public.t3f_u(5), a, NULL,
    NULL, '9157', 'swap_refund', public.t3f_id('o2'));
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('o2')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('o2')::uuid, public.t3f_id('x')::uuid)], 'swap', public.t3f_id('y')::uuid,
    public.t3f_u(1), public.t3f_u(5), 'f3-dev-swap');
  PERFORM public.t3f_ok((r->>'refundMinor')::bigint = 400000,
    'F2-4 with a swap_refund approval for this order the swap gives 4,000.00 back');
END
$devswapok$;
SELECT public.t3f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL, public.t3f_u(1),
  public.t3f_u(5), 'f3-dev-refund')$q$, public.t3f_id('o3'), public.t3f_line(public.t3f_id('o3')::uuid, public.t3f_id('x')::uuid)),
  'P0001', 'pin_step_up_required', 'F2-5 on a Till device a sold-out refund needs a fresh PIN');
DO $devrefundok$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  r jsonb;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokO')), public.t3f_u(5), a, NULL,
    NULL, '9157', 'refund', public.t3f_id('o3'));
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('o3')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('o3')::uuid, public.t3f_id('x')::uuid)], 'refund', NULL,
    public.t3f_u(1), public.t3f_u(5), 'f3-dev-refund');
  PERFORM public.t3f_ok((r->>'refundMinor')::bigint = 500000, 'F2-6 with a refund approval for this order it refunds 5,000.00');
END
$devrefundok$;
-- F2-7 (fix 4, P3-2): the same request retried with no fresh PIN answers what it
-- did (the replay is checked before any step-up is taken), moves no money and
-- spends no approval.
DO $devrefundreplay$
DECLARE
  a uuid := '44906180-0000-4000-9000-0000000000a1';
  r jsonb;
  v_refunds integer;
  v_spare uuid;
BEGIN
  SELECT count(*) INTO v_refunds FROM public.source_refunds
   WHERE source_type = 'venue_menu_order' AND source_id = public.t3f_id('o3')::uuid;
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('o3')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('o3')::uuid, public.t3f_id('x')::uuid)], 'refund', NULL,
    public.t3f_u(1), public.t3f_u(5), 'f3-dev-refund');
  PERFORM public.t3f_ok((r->>'replayed')::boolean AND (r->>'refundMinor')::bigint = 500000
      AND (SELECT count(*) FROM public.source_refunds
            WHERE source_type = 'venue_menu_order' AND source_id = public.t3f_id('o3')::uuid) = v_refunds,
    'F2-7a the device refund retried without a fresh PIN answers the stored refund, nothing more');
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tokO')), public.t3f_u(5), a, NULL,
    NULL, '9157', 'refund', public.t3f_id('o3'));
  SELECT id INTO v_spare FROM public.venue_pin_approvals
   WHERE venue_id = a AND purpose = 'refund' AND lower(target) = lower(public.t3f_id('o3')) AND consumed_at IS NULL;
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('o3')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('o3')::uuid, public.t3f_id('x')::uuid)], 'refund', NULL,
    public.t3f_u(1), public.t3f_u(5), 'f3-dev-refund');
  PERFORM public.t3f_ok((r->>'replayed')::boolean
      AND (SELECT consumed_at IS NULL FROM public.venue_pin_approvals WHERE id = v_spare),
    'F2-7b a replay spends no approval');
  -- Leave nothing unused for the cases below.
  UPDATE public.venue_pin_approvals SET consumed_at = now(), consumed_txid = txid_current(), consumed_ref = 't3f:spent'
   WHERE id = v_spare;
END
$devrefundreplay$;
-- F4: one key, two different line sets.
DO $key1$
DECLARE
  r jsonb;
BEGIN
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('o4')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('o4')::uuid, public.t3f_id('x')::uuid)], 'refund', NULL, public.t3f_u(1), NULL, 'f3-same-key');
  PERFORM public.t3f_ok((r->>'refundMinor')::bigint = 500000, 'F4-0 line X is refunded under key K');
END
$key1$;
SELECT public.t3f_expect(format($q$SELECT public.issue_4490_order_sold_out_resolve(%L, ARRAY[%L::uuid], 'refund', NULL, public.t3f_u(1),
  NULL, 'f3-same-key')$q$, public.t3f_id('o4'), public.t3f_line(public.t3f_id('o4')::uuid, public.t3f_id('w')::uuid)),
  'PT409', 'sold_out_key_reused', 'F4-1 key K reused for line W is refused, not resolved (P7)');
DO $key2$
DECLARE
  r jsonb;
BEGIN
  r := public.issue_4490_order_sold_out_resolve(public.t3f_id('o4')::uuid,
    ARRAY[public.t3f_line(public.t3f_id('o4')::uuid, public.t3f_id('x')::uuid)], 'refund', NULL, public.t3f_u(1), NULL, 'f3-same-key');
  PERFORM public.t3f_ok((r->>'replayed')::boolean
      AND r->'orderItemIds' = to_jsonb(ARRAY[public.t3f_line(public.t3f_id('o4')::uuid, public.t3f_id('x')::uuid)])
      AND (r->>'refundMinor')::bigint = 500000
      AND (SELECT sold_out_resolution IS NULL FROM public.venue_order_items
           WHERE id = public.t3f_line(public.t3f_id('o4')::uuid, public.t3f_id('w')::uuid)),
    'F4-2 key K for line X again answers what K did (line X, 5,000.00); line W is still waiting');
END
$key2$;

-- ===========================================================================
-- F5. A payment confirmation after a refund changes nothing.
-- ===========================================================================
DO $replay$
DECLARE
  r jsonb;
BEGIN
  RESET ROLE;
  UPDATE public.venue_orders SET payment_status = 'partial_refund', refunded_amount_cents = 50000 WHERE id = public.t3f_id('o5')::uuid;
  UPDATE public.venue_orders SET payment_status = 'refunded', refunded_amount_cents = total_cents WHERE id = public.t3f_id('o6')::uuid;
  PERFORM public.t3f_service();
  r := public.t3f_pay(public.t3f_id('o5')::uuid);
  PERFORM public.t3f_ok(r->>'status' = 'replayed'
      AND (SELECT payment_status FROM public.venue_orders WHERE id = public.t3f_id('o5')::uuid) = 'partial_refund',
    'F5-1 a payment replay after a partial refund is a replay; the order stays partly refunded (P9)');
  r := public.t3f_pay(public.t3f_id('o6')::uuid);
  PERFORM public.t3f_ok(r->>'status' = 'replayed'
      AND (SELECT payment_status FROM public.venue_orders WHERE id = public.t3f_id('o6')::uuid) = 'refunded',
    'F5-2 and after a full refund it stays refunded');
END
$replay$;

-- ===========================================================================
-- F7. The guest refund decision from a Till device login that holds refund
--     rank (the brand's account holder signed in on the Till as a device): a
--     PIN session and a fresh refund approval for the order.
-- ===========================================================================
DO $decision$
DECLARE
  v jsonb;
BEGIN
  RESET ROLE;
  UPDATE public.venue_orders SET refund_requested_at = now() WHERE id = public.t3f_id('o7')::uuid;
  -- Fixture only: the team guards are skipped for this one shape change.
  SET LOCAL session_replication_role = replica;
  UPDATE public.brand_team_members SET role = 'venue_staff' WHERE id = public.t3f_m(1);
  INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
    (public.t3f_m(1), '44906180-0000-4000-9000-0000000000a1', 'till_device',
     ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']);
  SET LOCAL session_replication_role = origin;
  PERFORM public.t3f_service();
  PERFORM public.t3f_ok(public.issue_4490_pin_gate('44906180-0000-4000-9000-0000000000a1', public.t3f_u(1))
      AND public.biz_brand_effective_rank('44906180-0000-4000-9000-000000000010', public.t3f_u(1)) >= public.biz_role_rank('event_manager'),
    'F7-0 the account holder''s login is now a Till device at A (and keeps the refund rank)');
  v := public.issue_4490_pin_unlock('44906180-0000-4000-9000-0000000000a1', public.t3f_u(1), public.t3f_m(3), '4826', NULL);
  INSERT INTO t3f_ids VALUES ('tok1', v->>'token');
END
$decision$;
SELECT public.t3f_as(public.t3f_u(1));
SELECT public.t3f_expect(format($q$SELECT public.biz_venue_order_refund_decision(%L, 'approved', 'cold food')$q$, public.t3f_id('o7')),
  'P0001', 'pin_step_up_required', 'F7-1 a Till device login cannot approve a guest refund without a fresh PIN');
SELECT public.t3f_service();
DO $decisionok$
DECLARE
  v jsonb;
BEGIN
  PERFORM public.issue_4490_pin_approve(public.t3f_hash(public.t3f_id('tok1')), public.t3f_u(1),
    '44906180-0000-4000-9000-0000000000a1', NULL, NULL, '4826', 'refund', public.t3f_id('o7'));
  PERFORM public.t3f_as(public.t3f_u(1));
  v := public.biz_venue_order_refund_decision(public.t3f_id('o7')::uuid, 'approved', 'cold food');
  PERFORM public.t3f_service();
  PERFORM public.t3f_ok(v->>'decision' = 'approved' AND v->'refund' IS NOT NULL
      AND (SELECT refund_decided_by_user_id = public.t3f_u(3) FROM public.venue_orders WHERE id = public.t3f_id('o7')::uuid),
    'F7-2 with the manager''s fresh PIN the refund is approved, recorded under the manager');
END
$decisionok$;
SELECT public.t3f_reset();

DO $done$ BEGIN RAISE NOTICE '==== T3F all checks passed ===='; END $done$;
ROLLBACK;
