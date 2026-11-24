-- #4490 spec 08 O4: executable PostgreSQL 17 proof for migration 20281203634490
-- (split bill: by item and evenly; every share paid through the existing paths).
-- The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-SPLIT-SUM-EQUALS-REMAINING | issue #4490 | the unpaid and paying shares of a Till check always add up to what is left on the check to the minor unit (issue_4490_till_set_split computes every share on the server, by item or evenly, remainder minor units to the first shares; issue_4490_till_shares_follow_sale drops the unpaid shares whenever what is left changes for any other reason), and a share is paid with exactly its amount and service charge through the share wrappers of take_payment and card_start.
--
-- FAILS-ON-REVERT: without 20281203634490 every block fails at once
-- (issue_4490_till_set_split does not exist). With the even remainder rule
-- reverted to plain floor division, S-1 fails (the shares add up to less
-- than what is left); with the by-item service charge remainder removed,
-- S-3 fails; with issue_4490_till_shares_follow_sale dropped, S-8 fails (a
-- stale share is still payable after an item is added); with the share
-- version rule reverted to the exact check version, S-5 fails (the second
-- device's share is refused); with take_payment's split guard removed, S-6
-- fails; with keep_late's share check removed, S-11d fails.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490s_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490S FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490s_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490S FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490S FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490s_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490s_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490s_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490s_ok(boolean,text), public.t4490s_expect(text,text,text,text),
  public.t4490s_as(uuid), public.t4490s_service(), public.t4490s_reset() TO PUBLIC;
CREATE TEMP TABLE t4490s_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490s_ids TO PUBLIC;
CREATE FUNCTION public.t4490s_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490s_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490s_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490s_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490s_v(uuid) TO PUBLIC;
-- What is left on a check, and what its unpaid + paying shares add up to.
CREATE FUNCTION public.t4490s_left(p_sale uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT GREATEST(total_due_minor - paid_minor, 0) FROM public.venue_till_sales WHERE id = p_sale
$f$;
CREATE FUNCTION public.t4490s_open_shares(p_sale uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT COALESCE(sum(amount_minor), 0) FROM public.venue_till_shares WHERE sale_id = p_sale AND state IN ('unpaid', 'paying')
$f$;
CREATE FUNCTION public.t4490s_share(p_sale uuid, p_no integer) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_till_shares WHERE sale_id = p_sale AND share_no = p_no
$f$;
CREATE FUNCTION public.t4490s_share_row(p_share uuid) RETURNS public.venue_till_shares LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.venue_till_shares WHERE id = p_share
$f$;
GRANT EXECUTE ON FUNCTION public.t4490s_left(uuid), public.t4490s_open_shares(uuid), public.t4490s_share(uuid, integer),
  public.t4490s_share_row(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 05 venue staff with check-in only, 06 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900606-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-split-' || n || '@example.test', now(), now()
FROM generate_series(1, 6) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900606-0000-4000-8000-000000000001', now()), ('44900606-0000-4000-8000-000000000006', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900606-0000-4000-9000-000000000010', '44900606-0000-4000-8000-000000000001',
   'Till Split 4490', 'till-split-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900606-0000-4000-9000-000000000020', '44900606-0000-4000-8000-000000000006',
   'Till Split Other 4490', 'till-split-other-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900606-0000-4000-9000-0000000000a1', '44900606-0000-4000-9000-000000000010', 'tillsplita', 'Split Bar',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900606-0000-4000-9000-000000000010', '44900606-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900606-0000-4000-a000-000000000002', '44900606-0000-4000-9000-000000000010', '44900606-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900606-0000-4000-a000-000000000005', '44900606-0000-4000-9000-000000000010', '44900606-0000-4000-8000-000000000005', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900606-0000-4000-a000-000000000002', '44900606-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900606-0000-4000-a000-000000000005', '44900606-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900606-0000-4000-b000-000000000001', '44900606-0000-4000-9000-000000000010', '44900606-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900606-0000-4000-b000-000000000011', '44900606-0000-4000-b000-000000000001', '44900606-0000-4000-9000-000000000010', 'Chapman', 100000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900606-0000-4000-9000-0000000000a1', '44900606-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;
SELECT public.t4490s_as('44900606-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900606-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 's-till-on');
SELECT public.issue_4490_set_venue_feature('44900606-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 's-menu-on');
SELECT public.t4490s_reset();

CREATE SEQUENCE public.t4490s_pickup START 101;
GRANT USAGE ON SEQUENCE public.t4490s_pickup TO PUBLIC;
-- A held Till round with the given lines [{qty, unit}] and service charge bps.
CREATE FUNCTION public.t4490s_round(p_session uuid, p_lines jsonb, p_bps integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
  v_sub bigint;
  v_sc bigint;
  r record;
  n integer := 0;
BEGIN
  SELECT COALESCE(sum((e->>'qty')::bigint * (e->>'unit')::bigint), 0) INTO v_sub FROM jsonb_array_elements(p_lines) e;
  v_sc := round(v_sub::numeric * p_bps / 10000);
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, p_session, '44900606-0000-4000-9000-000000000010', '44900606-0000-4000-9000-0000000000a1', 'staff',
    '44900606-0000-4000-8000-000000000002', lpad(nextval('public.t4490s_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', v_sub, v_sub, 0, p_bps, v_sc, 0, 0, 0, false, false, false,
    v_sub + v_sc, v_sub + v_sc, 'pending', 'held', 'till-s-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  FOR r IN SELECT e FROM jsonb_array_elements(p_lines) e LOOP
    n := n + 1;
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents)
    VALUES (v_order, '44900606-0000-4000-b000-000000000011', n, 'Item ' || n, (r.e->>'unit')::integer, 'NGN',
      (r.e->>'qty')::integer, 0, (r.e->>'qty')::integer * (r.e->>'unit')::integer);
  END LOOP;
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490s_round(uuid, jsonb, integer) TO PUBLIC;
-- A Till check with one held round of the given lines.
CREATE FUNCTION public.t4490s_check(p_key text, p_lines jsonb, p_bps integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb; v_sale uuid; v_session uuid;
BEGIN
  v := public.issue_4490_till_open('44900606-0000-4000-9000-0000000000a1',
    '44900606-0000-4000-8000-000000000002', NULL, left(p_key, 40), NULL, 'o4-split-key:' || p_key);
  v_sale := (v->>'id')::uuid;
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  PERFORM public.issue_4490_till_attach_round(v_sale, public.t4490s_round(v_session, p_lines, p_bps),
    '44900606-0000-4000-8000-000000000002', NULL);
  RETURN v_sale;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490s_check(text, jsonb, integer) TO PUBLIC;
-- The items of a check, in line order (for by-item splits).
CREATE FUNCTION public.t4490s_items(p_sale uuid) RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT array_agg(i.id ORDER BY l.created_at, i.line_no)
  FROM public.venue_till_lines l JOIN public.venue_order_items i ON i.venue_order_id = l.venue_order_id
  WHERE l.sale_id = p_sale AND l.kind = 'menu_round' AND i.prep_state <> 'voided'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490s_items(uuid) TO PUBLIC;
-- Pay a share in cash (exact).
CREATE FUNCTION public.t4490s_pay(p_sale uuid, p_share uuid, p_version integer, p_req uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_pay_share(p_sale, p_share, 'cash',
    (SELECT amount_minor FROM public.venue_till_shares WHERE id = p_share), 0,
    (SELECT amount_minor FROM public.venue_till_shares WHERE id = p_share),
    '44900606-0000-4000-8000-000000000002', NULL, COALESCE(p_req, gen_random_uuid()), p_version)
$f$;
GRANT EXECUTE ON FUNCTION public.t4490s_pay(uuid, uuid, integer, uuid) TO PUBLIC;

-- -------------------------------------------------------------------------
-- 1. Evenly: for n = 2..20 the shares add up to what is left, to the minor
--    unit, on odd totals, with and without service charge.
-- -------------------------------------------------------------------------
SELECT public.t4490s_service();
DO $even$
DECLARE
  v jsonb;
  v_sale uuid;
  v_n integer;
  v_bps integer;
  v_bad text := '';
  v_cases integer := 0;
  v_amounts bigint[];
  v_scs bigint[];
BEGIN
  FOREACH v_bps IN ARRAY ARRAY[0, 1000, 1250] LOOP
    -- 3 x 333.37 + 1 x 0.07: odd totals that do not divide.
    v_sale := public.t4490s_check('s-even-' || v_bps, '[{"qty":3,"unit":33337},{"qty":1,"unit":7}]'::jsonb, v_bps);
    FOR v_n IN 2 .. 20 LOOP
      v := public.issue_4490_till_set_split(v_sale, 'even', jsonb_build_object('count', v_n),
        '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
      v_cases := v_cases + 1;
      SELECT array_agg(amount_minor ORDER BY share_no), array_agg(service_charge_minor ORDER BY share_no)
      INTO v_amounts, v_scs FROM public.venue_till_shares WHERE sale_id = v_sale AND state = 'unpaid';
      IF cardinality(v_amounts) <> v_n
         OR public.t4490s_open_shares(v_sale) <> public.t4490s_left(v_sale)
         OR (SELECT sum(x) FROM unnest(v_scs) x) <> (SELECT service_charge_minor FROM public.venue_till_sales WHERE id = v_sale)
         OR (SELECT max(x) - min(x) FROM unnest(v_amounts) x) > 2
         OR v_amounts[1] < v_amounts[v_n] THEN
        v_bad := v_bad || format(' [bps %s n %s: %s left %s]', v_bps, v_n, v_amounts, public.t4490s_left(v_sale));
      END IF;
    END LOOP;
    INSERT INTO t4490s_ids VALUES ('even_' || v_bps, v_sale);
  END LOOP;
  PERFORM public.t4490s_ok(v_bad = '' AND v_cases = 57,
    'S-1 evenly, n = 2..20 on odd totals (100,018 and +10% / +12.5% service charge): 57 splits, every one adds up to what is left to the minor unit, service charge in full, remainders on the first shares' || v_bad);
  -- 100,018 + 10% = 110,020 in 3: base 33,340/33,339/33,339, service 3,334/3,334/3,334.
  v_sale := public.t4490s_id('even_1000');
  v := public.issue_4490_till_set_split(v_sale, 'even', '{"count":3}'::jsonb,
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  SELECT array_agg(amount_minor ORDER BY share_no), array_agg(service_charge_minor ORDER BY share_no)
  INTO v_amounts, v_scs FROM public.venue_till_shares WHERE sale_id = v_sale AND state = 'unpaid';
  PERFORM public.t4490s_ok(v_amounts = ARRAY[36674, 36673, 36673]::bigint[]
      AND v_scs = ARRAY[3334, 3334, 3334]::bigint[] AND jsonb_array_length(v->'shares') = 3,
    'S-2 1,100.20 evenly in 3: 366.74 / 366.73 / 366.73 (base and service charge each floor + remainder to share 1); the projection lists the shares');
  PERFORM public.t4490s_expect(
    format($q$SELECT public.issue_4490_till_set_split(%L, 'even', '{"count":21}'::jsonb, '44900606-0000-4000-8000-000000000002', %s)$q$,
      v_sale, public.t4490s_v(v_sale)), '22023', 'till_split_invalid', 'S-2b more than 20 people is refused');
END
$even$;
SELECT public.t4490s_reset();

-- -------------------------------------------------------------------------
-- 2. By item, for 3, with service charge: every unit once; service charge
--    pro rata with the remainder minor units to share 1.
-- -------------------------------------------------------------------------
SELECT public.t4490s_service();
DO $byitem$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490s_check('s-item', '[{"qty":3,"unit":100000},{"qty":1,"unit":50001},{"qty":2,"unit":33333}]'::jsonb, 1000);
  v_it uuid[];
  v_amounts bigint[];
  v_scs bigint[];
BEGIN
  v_it := public.t4490s_items(v_sale);
  -- 3 x 1,000.00 split 1/1/1; the 500.01 to share 2; the 2 x 333.33 to share 3.
  -- Subtotal 4,166.67; service 416.67 (10%, rounded).
  v := public.issue_4490_till_set_split(v_sale, 'by_item', jsonb_build_array(
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1))),
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1),
                                                    jsonb_build_object('orderItemId', v_it[2], 'units', 1))),
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1),
                                                    jsonb_build_object('orderItemId', v_it[3], 'units', 2)))),
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  SELECT array_agg(amount_minor ORDER BY share_no), array_agg(service_charge_minor ORDER BY share_no)
  INTO v_amounts, v_scs FROM public.venue_till_shares WHERE sale_id = v_sale;
  -- Menu bases 100,000 / 150,001 / 166,666 (of 416,667); service 41,667:
  -- floor(41667*100000/416667)=10000, floor(41667*150001/416667)=15000,
  -- floor(41667*166666/416667)=16666; remainder 1 to share 1.
  PERFORM public.t4490s_ok(
      (SELECT service_charge_minor FROM public.venue_till_sales WHERE id = v_sale) = 41667
      AND v_scs = ARRAY[10001, 15000, 16666]::bigint[]
      AND v_amounts = ARRAY[110001, 165001, 183332]::bigint[]
      AND public.t4490s_open_shares(v_sale) = public.t4490s_left(v_sale),
    'S-3 by item for 3 with 10% service charge: 1,100.01 / 1,650.01 / 1,833.32; service charge pro rata to food and drink, the 0.01 remainder on share 1; the shares add up to the 4,583.34 left');
  PERFORM public.t4490s_ok((SELECT count(*) FROM public.venue_till_share_items si
                            JOIN public.venue_till_shares sh ON sh.id = si.share_id WHERE sh.sale_id = v_sale) = 5
      AND (SELECT sum(si.units) FROM public.venue_till_share_items si
           JOIN public.venue_till_shares sh ON sh.id = si.share_id WHERE sh.sale_id = v_sale AND si.venue_order_item_id = v_it[1]) = 3,
    'S-3b the 3 Chapmans are one unit in each share; five share items in all');
  -- A unit twice, a unit missing, an item from another check: refused.
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'by_item', %L::jsonb,
      '44900606-0000-4000-8000-000000000002', %s)$q$, v_sale, jsonb_build_array(
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 3),
                                                      jsonb_build_object('orderItemId', v_it[2], 'units', 1))),
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1),
                                                      jsonb_build_object('orderItemId', v_it[3], 'units', 2)))),
      public.t4490s_v(v_sale)), '22023', 'till_split_invalid', 'S-4a a unit given twice (4 of 3) is refused');
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'by_item', %L::jsonb,
      '44900606-0000-4000-8000-000000000002', %s)$q$, v_sale, jsonb_build_array(
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 3))),
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[2], 'units', 1)))),
      public.t4490s_v(v_sale)), '22023', 'till_split_invalid', 'S-4b a unit left out (the 2 x 333.33) is refused');
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'by_item', %L::jsonb,
      '44900606-0000-4000-8000-000000000002', %s)$q$, v_sale, jsonb_build_array(
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', gen_random_uuid(), 'units', 1))),
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[2], 'units', 1)))),
      public.t4490s_v(v_sale)), '22023', 'till_split_invalid', 'S-4c an item that is not on this check is refused');
  PERFORM public.t4490s_ok(public.t4490s_open_shares(v_sale) = public.t4490s_left(v_sale)
      AND (SELECT count(*) FROM public.venue_till_shares WHERE sale_id = v_sale) = 3,
    'S-4d ... and a refused split leaves the shares as they were');
  -- A stale version: the split another device set first wins.
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'even', '{"count":2}'::jsonb,
      '44900606-0000-4000-8000-000000000002', %s)$q$, v_sale, public.t4490s_v(v_sale) - 1),
    'PT409', 'till_check_changed', 'S-4e a split sent with an old check version is refused (two devices splitting at once: one PT409)');
  INSERT INTO t4490s_ids VALUES ('item_sale', v_sale);
END
$byitem$;
SELECT public.t4490s_reset();

-- -------------------------------------------------------------------------
-- 3. Paying shares: exactly the share; two devices on two shares both land;
--    the same share twice lands once; a whole-check payment waits for the split.
-- -------------------------------------------------------------------------
SELECT public.t4490s_service();
DO $pay$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490s_id('item_sale');
  v_seen integer := public.t4490s_v(v_sale);
  v_s1 uuid := public.t4490s_share(v_sale, 1);
  v_s2 uuid := public.t4490s_share(v_sale, 2);
  v_s3 uuid := public.t4490s_share(v_sale, 3);
  v_req uuid := '44900606-0000-4000-c000-000000000001';
BEGIN
  -- Both devices saw version v_seen. Device A pays share 1, device B share 2.
  v := public.t4490s_pay(v_sale, v_s1, v_seen, v_req);
  PERFORM public.t4490s_ok((v->>'amountMinor')::bigint = 110001 AND v->>'state' = 'paid'
      AND (v->>'shareId')::uuid = v_s1
      AND (SELECT service_charge_minor FROM public.venue_till_payments WHERE id = (v->>'paymentId')::uuid) = 10001
      AND (public.t4490s_share_row(v_s1)).state = 'paid',
    'S-5a share 1 paid in cash: exactly 1,100.01 with its 100.01 service charge; the share is paid');
  v := public.t4490s_pay(v_sale, v_s2, v_seen, NULL);
  PERFORM public.t4490s_ok(v->>'state' = 'paid' AND (public.t4490s_share_row(v_s2)).state = 'paid'
      AND (SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'open'
      AND public.t4490s_open_shares(v_sale) = public.t4490s_left(v_sale)
      AND public.t4490s_left(v_sale) = 183332,
    'S-5 the second device pays share 2 with the version it saw before share 1 was paid: it lands; 1,833.32 left = share 3');
  PERFORM public.t4490s_expect(format('SELECT public.t4490s_pay(%L, %L, %s, NULL)', v_sale, v_s2, v_seen),
    'PT409', 'till_share_paid', 'S-5b the same share paid again (a second device) is refused; it lands once');
  PERFORM public.t4490s_ok((SELECT count(*) FROM public.venue_till_payments WHERE share_id = v_s2) = 1,
    'S-5c ... one payment for share 2');
  -- A retry of share 1's payment (same id, same facts) answers the original.
  v := public.t4490s_pay(v_sale, v_s1, v_seen, v_req);
  PERFORM public.t4490s_ok((v->>'replayed')::boolean AND (SELECT count(*) FROM public.venue_till_payments WHERE share_id = v_s1) = 1,
    'S-5d a true retry of share 1 (same request id) answers the original payment, nothing new');
  -- The amount must be the share's.
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_pay_share(%L, %L, 'cash', 100000, 0, 100000,
      '44900606-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, v_sale, v_s3, v_seen),
    'PT409', 'till_check_changed', 'S-5e a share payment for another amount is refused');
  -- Whole-check payments wait while a share is unpaid.
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 183332, 0, 183332,
      '44900606-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, v_sale, public.t4490s_v(v_sale)),
    'PT409', 'till_split_active', 'S-6 paying the whole check while it is split is refused (pay a share or Pay in full)');
  -- A version older than the split itself is stale.
  PERFORM public.t4490s_expect(format('SELECT public.t4490s_pay(%L, %L, %s, NULL)', v_sale, v_s3,
      (public.t4490s_share_row(v_s3)).set_version - 1),
    'PT409', 'till_check_changed', 'S-6b a share payment that never saw the split is refused');
  -- Room is not a tender yet (D13).
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_pay_share(%L, %L, 'room', 183332, 0, NULL,
      '44900606-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, v_sale, v_s3, v_seen),
    'PT409', 'till_room_not_ready', 'S-6c charge to room is refused (till_room_not_ready) until stays ship a folio');
  v := public.t4490s_pay(v_sale, v_s3, v_seen, NULL);
  PERFORM public.t4490s_ok((v->>'salePaid')::boolean
      AND (SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paid'
      AND (SELECT paid_minor FROM public.venue_till_sales WHERE id = v_sale) = 458334
      AND (SELECT sum(service_charge_minor) FROM public.venue_till_payments WHERE sale_id = v_sale) = 41667,
    'S-7 the check is paid when every share is paid: 4,583.34 in three payments carrying the full 416.67 service charge');
END
$pay$;
SELECT public.t4490s_reset();

-- -------------------------------------------------------------------------
-- 4. Re-splitting: after one share is paid the paid share stays; a change to
--    the check drops the unpaid shares; never while a share is paying.
-- -------------------------------------------------------------------------
SELECT public.t4490s_service();
DO $resplit$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490s_check('s-resplit', '[{"qty":4,"unit":25001}]'::jsonb, 1000);
  v_session uuid;
  v_s1 uuid;
  v_s uuid;
  v_it uuid[];
BEGIN
  v_it := public.t4490s_items(v_sale);
  PERFORM public.issue_4490_till_set_split(v_sale, 'by_item', jsonb_build_array(
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1))),
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 3)))),
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  v_s1 := public.t4490s_share(v_sale, 1);
  PERFORM public.t4490s_pay(v_sale, v_s1, public.t4490s_v(v_sale), NULL);
  -- Re-split the 3 units left by item into 3.
  v := public.issue_4490_till_set_split(v_sale, 'by_item', jsonb_build_array(
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1))),
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1))),
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1)))),
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  PERFORM public.t4490s_ok((public.t4490s_share_row(v_s1)).state = 'paid'
      AND (SELECT count(*) FROM public.venue_till_shares WHERE sale_id = v_sale) = 4
      AND (SELECT array_agg(share_no ORDER BY share_no) FROM public.venue_till_shares WHERE sale_id = v_sale AND state = 'unpaid') = ARRAY[2,3,4]::smallint[]
      AND public.t4490s_open_shares(v_sale) = public.t4490s_left(v_sale),
    'S-7b re-split after share 1 was paid: share 1 stays paid, the 3 units left become shares 2-4 and add up to what is left');
  -- A change to the check (another round) drops the unpaid shares.
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  v_s := public.t4490s_share(v_sale, 3);
  PERFORM public.issue_4490_till_attach_round(v_sale, public.t4490s_round(v_session, '[{"qty":1,"unit":20000}]'::jsonb, 1000),
    '44900606-0000-4000-8000-000000000002', NULL);
  PERFORM public.t4490s_ok((SELECT count(*) FROM public.venue_till_shares WHERE sale_id = v_sale AND state = 'unpaid') = 0
      AND (public.t4490s_share_row(v_s1)).state = 'paid',
    'S-8 an item added after the split drops the unpaid shares (the paid share stays)');
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_pay_share(%L, %L, 'cash', 27500, 0, 27500,
      '44900606-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, v_sale, v_s, public.t4490s_v(v_sale)),
    'PT409', 'till_check_changed', 'S-8b a share that was dropped cannot be paid (the device refreshes)');
  -- Re-split evenly; start a scan payment for one share; re-split is refused while it is paying.
  PERFORM public.issue_4490_till_set_split(v_sale, 'even', '{"count":2}'::jsonb,
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  v_s := public.t4490s_share(v_sale, 2);
  v := public.issue_4490_till_card_prepare_share(v_sale, v_s, '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  PERFORM public.t4490s_ok((v->>'amountMinor')::bigint = (public.t4490s_share_row(v_s)).amount_minor
      AND (v->>'serviceChargeMinor')::bigint = (public.t4490s_share_row(v_s)).service_charge_minor,
    'S-9a card prepare for a share prices exactly the share');
  v := public.issue_4490_till_card_start_share(v_sale, v_s, 'scan', 0, '44900606-0000-4000-8000-000000000002', NULL,
    '44900606-0000-4000-c000-000000000009', (v->>'version')::integer,
    jsonb_build_object('provider', 'paystack', 'totalCents', (v->>'amountMinor')::bigint,
      'subtotalCents', (v->>'amountMinor')::bigint - (v->>'serviceChargeMinor')::bigint,
      'serviceChargeCents', (v->>'serviceChargeMinor')::bigint, 'tipCents', 0, 'currency', 'NGN',
      'effectiveTakeRateBps', 0, 'serviceFeeBps', 0, 'minglaFeeCents', 0, 'platformServiceFeeCents', 0,
      'buyerSubtotalCents', (v->>'amountMinor')::bigint, 'taxAmountCents', 0),
    'S6AAAAAA');
  INSERT INTO t4490s_ids VALUES ('scan_payment', (v->>'paymentId')::uuid), ('resplit_sale', v_sale);
  PERFORM public.t4490s_ok((public.t4490s_share_row(v_s)).state = 'paying'
      AND (SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paying',
    'S-9b a scan payment for share 2 makes that share paying (one carrier for the share)');
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'even', '{"count":3}'::jsonb,
      '44900606-0000-4000-8000-000000000002', %s)$q$, v_sale, public.t4490s_v(v_sale)),
    'PT409', 'till_share_paying', 'S-9 re-split while a share is paying is refused');
  -- The other share can be paid in cash meanwhile; the check stays paying.
  PERFORM public.t4490s_pay(v_sale, public.t4490s_share(v_sale, 3), public.t4490s_v(v_sale), NULL);
  PERFORM public.t4490s_ok((public.t4490s_share_row(public.t4490s_share(v_sale, 3))).state = 'paid'
      AND (SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paying',
    'S-9c another share is paid in cash while share 2 is being scanned; the check is still paying');
  PERFORM public.t4490s_expect(format('SELECT public.t4490s_pay(%L, %L, %s, NULL)', v_sale, v_s, public.t4490s_v(v_sale)),
    'PT409', 'till_share_paying', 'S-9d the share being scanned cannot be paid in cash at the same time');
END
$resplit$;
SELECT public.t4490s_reset();

-- -------------------------------------------------------------------------
-- 5. Late money on a share's cancelled code, and refunds of share payments.
-- -------------------------------------------------------------------------
SELECT public.t4490s_service();
DO $late$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490s_id('resplit_sale');
  v_scan uuid := public.t4490s_id('scan_payment');
  v_s6 uuid := public.t4490s_share(v_sale, 2);
  v_cash uuid;
BEGIN
  -- The code is cancelled: the share is unpaid again; it is paid in cash.
  PERFORM public.issue_4490_till_card_close(v_scan);
  PERFORM public.t4490s_ok((public.t4490s_share_row(v_s6)).state = 'unpaid'
      AND (SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'open',
    'S-10 a cancelled code: its share is unpaid again and the check is open');
  v := public.t4490s_pay(v_sale, v_s6, public.t4490s_v(v_sale), NULL);
  v_cash := (v->>'paymentId')::uuid;
  PERFORM public.t4490s_ok((SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paid',
    'S-11 the share is paid in cash; every share paid, the check is paid');
  -- The guest's transfer on the cancelled code lands anyway: late money, kept apart.
  v := public.issue_4490_till_apply_payment(v_scan);
  PERFORM public.t4490s_ok((v->>'paidLate')::boolean
      AND (SELECT paid_late FROM public.venue_till_payments WHERE id = v_scan)
      AND (SELECT overpaid_minor FROM public.venue_till_sales WHERE id = v_sale) = (public.t4490s_share_row(v_s6)).amount_minor
      AND (SELECT paid_minor FROM public.venue_till_sales WHERE id = v_sale) = (SELECT total_due_minor FROM public.venue_till_sales WHERE id = v_sale),
    'S-11b late money on that share''s cancelled code is recorded once, as overpaid (never counted as the share)');
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_keep_late_payment(%L,
      '44900606-0000-4000-8000-000000000002', %s)$q$, v_scan, public.t4490s_v(v_sale)),
    'PT409', 'till_late_nothing_to_keep', 'S-11c "Keep it as payment" is refused: the share was paid in cash (refund the late money)');
END
$late$;
SELECT public.t4490s_reset();

SELECT public.t4490s_service();
DO $late2$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490s_check('s-late-keep', '[{"qty":2,"unit":50000}]'::jsonb, 0);
  v_s1 uuid;
  v_s2 uuid;
  v_scan uuid;
  v_seen integer;
BEGIN
  PERFORM public.issue_4490_till_set_split(v_sale, 'even', '{"count":2}'::jsonb,
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  v_s1 := public.t4490s_share(v_sale, 1); v_s2 := public.t4490s_share(v_sale, 2);
  v := public.issue_4490_till_card_prepare_share(v_sale, v_s1, '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  v := public.issue_4490_till_card_start_share(v_sale, v_s1, 'scan', 0, '44900606-0000-4000-8000-000000000002', NULL,
    gen_random_uuid(), (v->>'version')::integer,
    jsonb_build_object('provider', 'paystack', 'totalCents', 50000, 'subtotalCents', 50000, 'serviceChargeCents', 0,
      'tipCents', 0, 'currency', 'NGN', 'effectiveTakeRateBps', 0, 'serviceFeeBps', 0, 'minglaFeeCents', 0,
      'platformServiceFeeCents', 0, 'buyerSubtotalCents', 50000, 'taxAmountCents', 0), 'S6BBBBBB');
  v_scan := (v->>'paymentId')::uuid;
  PERFORM public.issue_4490_till_card_close(v_scan);
  -- The late money lands while share 1 is still unpaid: keep it, the share is paid.
  PERFORM public.issue_4490_till_apply_payment(v_scan);
  v_seen := public.t4490s_v(v_sale);
  v := public.issue_4490_till_keep_late_payment(v_scan, '44900606-0000-4000-8000-000000000002', v_seen);
  PERFORM public.t4490s_ok((v->>'keptMinor')::bigint = 50000 AND (public.t4490s_share_row(v_s1)).state = 'paid'
      AND (public.t4490s_share_row(v_s2)).state = 'unpaid'
      AND public.t4490s_open_shares(v_sale) = public.t4490s_left(v_sale) AND public.t4490s_left(v_sale) = 50000,
    'S-12 late money for a share that is still unpaid can be kept: the share becomes paid, the other share is still what is left');
END
$late2$;
SELECT public.t4490s_reset();

-- Late money for a share someone paid in cash meanwhile, on a check still
-- being paid: refunded, never kept (the share would count twice).
SELECT public.t4490s_service();
DO $late3$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490s_check('s-late-paid-open', '[{"qty":2,"unit":50000}]'::jsonb, 0);
  v_s1 uuid;
  v_scan uuid;
BEGIN
  PERFORM public.issue_4490_till_set_split(v_sale, 'even', '{"count":2}'::jsonb,
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  v_s1 := public.t4490s_share(v_sale, 1);
  v := public.issue_4490_till_card_prepare_share(v_sale, v_s1, '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  v := public.issue_4490_till_card_start_share(v_sale, v_s1, 'scan', 0, '44900606-0000-4000-8000-000000000002', NULL,
    gen_random_uuid(), (v->>'version')::integer,
    jsonb_build_object('provider', 'paystack', 'totalCents', 50000, 'subtotalCents', 50000, 'serviceChargeCents', 0,
      'tipCents', 0, 'currency', 'NGN', 'effectiveTakeRateBps', 0, 'serviceFeeBps', 0, 'minglaFeeCents', 0,
      'platformServiceFeeCents', 0, 'buyerSubtotalCents', 50000, 'taxAmountCents', 0), 'S6CCCCCC');
  v_scan := (v->>'paymentId')::uuid;
  PERFORM public.issue_4490_till_card_close(v_scan);
  PERFORM public.t4490s_pay(v_sale, v_s1, public.t4490s_v(v_sale), NULL);
  PERFORM public.issue_4490_till_apply_payment(v_scan);
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_keep_late_payment(%L,
      '44900606-0000-4000-8000-000000000002', %s)$q$, v_scan, public.t4490s_v(v_sale)),
    'PT409', 'till_late_nothing_to_keep',
    'S-11d late money for a share paid in cash meanwhile, while the other share is still to pay: "Keep it" is refused (refund it)');
  PERFORM public.t4490s_ok((SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'open'
      AND public.t4490s_open_shares(v_sale) = public.t4490s_left(v_sale) AND public.t4490s_left(v_sale) = 50000,
    'S-11e ... and the check still owes exactly share 2');
END
$late3$;
SELECT public.t4490s_reset();

-- -------------------------------------------------------------------------
-- 6. A refund of a share payment while the check is still being paid makes
--    that money due again: the unpaid shares go and only an even split of
--    the rest is accepted (T11); a paid share's item is refunded, not voided.
-- -------------------------------------------------------------------------
SELECT public.t4490s_service();
DO $refund$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490s_check('s-refund', '[{"qty":3,"unit":30000}]'::jsonb, 1000);
  v_it uuid[];
  v_s1 uuid;
  v_pay uuid;
BEGIN
  v_it := public.t4490s_items(v_sale);
  PERFORM public.issue_4490_till_set_split(v_sale, 'by_item', jsonb_build_array(
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1))),
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 2)))),
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  v_s1 := public.t4490s_share(v_sale, 1);
  v := public.t4490s_pay(v_sale, v_s1, public.t4490s_v(v_sale), NULL);
  v_pay := (v->>'paymentId')::uuid;
  -- Voiding the round now would void a paid share's item: refused.
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_void(%L, NULL, %L,
      '44900606-0000-4000-8000-000000000001', 'Made wrong', false, %s)$q$, v_sale, v_it[1], public.t4490s_v(v_sale)),
    'PT409', 'till_line_paid', 'S-13 an item a paid share covers is refunded, never voided');
  -- Refund 100.00 of share 1's cash payment (owner: money rights).
  v := public.issue_4490_till_refund(v_pay, 10000, 0, 'Guest asked', false,
    '44900606-0000-4000-8000-000000000001', NULL, gen_random_uuid());
  PERFORM public.t4490s_ok((SELECT count(*) FROM public.venue_till_shares WHERE sale_id = v_sale AND state = 'unpaid') = 0
      AND (public.t4490s_share_row(v_s1)).state = 'paid'
      AND public.t4490s_left(v_sale) = 99000 - 33000 + 10000,
    'S-14 a refund of a share payment on an open check: the 100.00 is due again and the unpaid share goes (760.00 left)');
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'by_item', %L::jsonb,
      '44900606-0000-4000-8000-000000000002', %s)$q$, v_sale, jsonb_build_array(
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1))),
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1)))),
      public.t4490s_v(v_sale)), 'PT409', 'till_split_after_part_payment',
    'S-14b by item is refused once a refund is on the check (till_split_after_part_payment)');
  v := public.issue_4490_till_set_split(v_sale, 'even', '{"count":2}'::jsonb,
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  PERFORM public.t4490s_ok(public.t4490s_open_shares(v_sale) = public.t4490s_left(v_sale)
      AND (v#>>'{split,evenOnly}')::boolean,
    'S-14c evenly over what is left is accepted and adds up; the check says even only');
END
$refund$;
SELECT public.t4490s_reset();

-- -------------------------------------------------------------------------
-- 7. T11: after an unshared part payment only an even split of the rest.
-- -------------------------------------------------------------------------
SELECT public.t4490s_service();
DO $part$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490s_check('s-part', '[{"qty":2,"unit":45000}]'::jsonb, 1000);
  v_it uuid[];
BEGIN
  v_it := public.t4490s_items(v_sale);
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 30000, 0, 30000,
    '44900606-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490s_v(v_sale));
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'by_item', %L::jsonb,
      '44900606-0000-4000-8000-000000000002', %s)$q$, v_sale, jsonb_build_array(
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1))),
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_it[1], 'units', 1)))),
      public.t4490s_v(v_sale)), 'PT409', 'till_split_after_part_payment',
    'S-15 by item after an unshared part payment is refused (till_split_after_part_payment)');
  v := public.issue_4490_till_set_split(v_sale, 'even', '{"count":3}'::jsonb,
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  PERFORM public.t4490s_ok(public.t4490s_open_shares(v_sale) = public.t4490s_left(v_sale)
      AND public.t4490s_left(v_sale) = 99000 - 30000 AND (v#>>'{split,evenOnly}')::boolean
      AND (SELECT sum(service_charge_minor) FROM public.venue_till_shares WHERE sale_id = v_sale)
          + (SELECT sum(service_charge_minor) FROM public.venue_till_payments WHERE sale_id = v_sale) = 9000,
    'S-15b evenly over the 690.00 left: the shares add up; with the part payment they carry the whole 90.00 service charge');
  -- "Pay in full": the unpaid shares go and the rest is one payment.
  v := public.issue_4490_till_set_split(v_sale, 'none', '{}'::jsonb,
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 69000, 0, 69000,
    '44900606-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490s_v(v_sale));
  PERFORM public.t4490s_ok((v->>'salePaid')::boolean
      AND (SELECT count(*) FROM public.venue_till_shares WHERE sale_id = v_sale) = 0,
    'S-16 Pay in full drops the split; the rest is taken in one payment and the check is paid');
END
$part$;
SELECT public.t4490s_reset();

-- -------------------------------------------------------------------------
-- 8. Who may split, what they may read, and the grants.
-- -------------------------------------------------------------------------
SELECT public.t4490s_service();
DO $rights$
DECLARE
  v_sale uuid := public.t4490s_check('s-rights', '[{"qty":2,"unit":10000}]'::jsonb, 0);
BEGIN
  INSERT INTO t4490s_ids VALUES ('rights_sale', v_sale);
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'even', '{"count":2}'::jsonb,
      '44900606-0000-4000-8000-000000000005', %s)$q$, v_sale, public.t4490s_v(v_sale)),
    '42501', 'not_authorized', 'S-17 staff who may not sell cannot split');
  PERFORM public.t4490s_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'even', '{"count":2}'::jsonb,
      '44900606-0000-4000-8000-000000000006', %s)$q$, v_sale, public.t4490s_v(v_sale)),
    '42501', 'not_authorized', 'S-17b another brand''s owner cannot split');
  PERFORM public.issue_4490_till_set_split(v_sale, 'even', '{"count":2}'::jsonb,
    '44900606-0000-4000-8000-000000000002', public.t4490s_v(v_sale));
END
$rights$;
SELECT public.t4490s_reset();

SELECT public.t4490s_as('44900606-0000-4000-8000-000000000002');
SELECT public.t4490s_ok((SELECT count(*) FROM public.venue_till_shares WHERE sale_id = public.t4490s_id('rights_sale')) = 2,
  'S-18 a seller at the venue reads the check''s shares (RLS)');
SELECT public.t4490s_reset();
SELECT public.t4490s_as('44900606-0000-4000-8000-000000000006');
SELECT public.t4490s_ok((SELECT count(*) FROM public.venue_till_shares) = 0
    AND (SELECT count(*) FROM public.venue_till_share_items) = 0,
  'S-18b another brand''s owner reads no shares');
SELECT public.t4490s_expect(format($q$INSERT INTO public.venue_till_shares (sale_id, share_no, mode, amount_minor, set_version, created_by_user_id)
    VALUES (%L, 9, 'even', 1, 1, '44900606-0000-4000-8000-000000000006')$q$, public.t4490s_id('rights_sale')),
  '42501', NULL, 'S-18c nobody signed in writes a share directly');
SELECT public.t4490s_reset();
SELECT public.t4490s_ok(
  NOT has_function_privilege('authenticated', 'public.issue_4490_till_set_split(uuid,text,jsonb,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_set_split(uuid,text,jsonb,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_pay_share(uuid,uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_card_start_share(uuid,uuid,text,bigint,uuid,uuid,uuid,integer,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_till_set_split(uuid,text,jsonb,uuid,integer)', 'EXECUTE')
  AND (SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p
       WHERE p.proname IN ('issue_4490_till_set_split', 'issue_4490_till_pay_share', 'issue_4490_till_card_prepare_share',
                           'issue_4490_till_card_start_share', 'issue_4490_till_sc_left', 'issue_4490_till_sale_extras')),
  'S-19 the split functions are internal (service role only), SECURITY DEFINER with an empty search_path');

ROLLBACK;
