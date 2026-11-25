-- #4490 spec 08 O5 fix round 1: executable PostgreSQL 17 proof for migration
-- 20281203734490 (O5-T3 every sold-out line resolvable once each; O5-T1 a
-- moment's business day never moves when opening hours change; O5-T4 a
-- no-screen void's "Put it back in stock"). The suite owns its fixture and
-- rolls back.
--
-- MINGLA-INVARIANT: I-4490-SOLD-OUT-EVERY-LINE-ONCE | issue #4490 | every guest line that sold out after payment can be resolved (refund, or swap with the difference refunded) exactly once, in any order, mix or number of calls; each money resolution is its own source_refunds row; together they return exactly what the guest paid for those lines (discount, service charge share and rounding included), never more than the order took; the whole-order staff refund then returns only what is left (Mingla's fee netted): nothing refunded twice, nothing stranded.
-- MINGLA-INVARIANT: I-4490-DAY-DECIDED-ONCE | issue #4490 | a recorded payment's or refund's business day never moves: the daily close reads the day the Till stored on the row when the money was recorded, and every day derived from a moment uses the opening hours in force at that moment (venue_hours_history); changing opening hours affects only money recorded afterwards, a closed day's snapshot never changes, and no payment is ever counted on two days.
-- MINGLA-INVARIANT: I-4490-VOID-RESTOCK-NO-SCREEN | issue #4490 | a void of a sent line gives its units back exactly when the void's "Put it back in stock" is on and either the line's station has no kitchen screen or the screen never started it; never more than the line took, never twice; every choice on a counted line is audited (stock.set via void).
--
-- FAILS-ON-REVERT (verified on a fresh replay; outputs in the fix 1 report):
-- put back 20281203724490's one-refund-per-order mint and F3-2 fails
-- (sold_out_refund_once); put back the current-hours service day and F1-3
-- fails; put back only the derived payment / refund days and F1-12 fails;
-- put back the fired_at-only void restock and F4-1 fails.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t5f_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490F FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t5f_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490F FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490F FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t5f_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
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
GRANT EXECUTE ON FUNCTION public.t5f_ok(boolean,text), public.t5f_expect(text,text,text,text),
  public.t5f_as(uuid), public.t5f_service(), public.t5f_reset() TO PUBLIC;
CREATE TEMP TABLE t5f_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t5f_ids TO PUBLIC;
-- A write's answer, kept for the NEXT statement (a STABLE read in the same
-- statement as the write sees the statement's snapshot).
CREATE TEMP TABLE t5f_r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t5f_r TO PUBLIC;
CREATE FUNCTION public.t5f_rv(p_k text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT v FROM t5f_r WHERE k = p_k $f$;
CREATE FUNCTION public.t5f_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t5f_ids WHERE k = p_k $f$;
GRANT EXECUTE ON FUNCTION public.t5f_rv(text), public.t5f_id(text) TO PUBLIC;
CREATE FUNCTION public.t5f_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
CREATE FUNCTION public.t5f_stock(p_item uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT stock_count FROM public.menu_items WHERE id = p_item
$f$;
GRANT EXECUTE ON FUNCTION public.t5f_v(uuid), public.t5f_stock(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 03 kitchen (venue.kitchen), 04 event manager.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900616-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'o5-fix1-' || n || '@example.test', now(), now()
FROM generate_series(1, 4) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44900616-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900616-0000-4000-9000-000000000010', '44900616-0000-4000-8000-000000000001',
   'O5 Fix 4490', 'o5-fix-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
-- V1: guest orders and the Till's voids (T3, T4). V2: the daily close (T1).
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900616-0000-4000-9000-0000000000a1', '44900616-0000-4000-9000-000000000010', 'o5fixa', 'Fix Kitchen',
   6.45, 3.40, 'restaurant', 'verified', 'NG'),
  ('44900616-0000-4000-9000-0000000000a2', '44900616-0000-4000-9000-000000000010', 'o5fixb', 'Fix Grill',
   6.45, 3.40, 'restaurant', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900616-0000-4000-a000-000000000002', '44900616-0000-4000-9000-000000000010', '44900616-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900616-0000-4000-a000-000000000003', '44900616-0000-4000-9000-000000000010', '44900616-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44900616-0000-4000-a000-000000000004', '44900616-0000-4000-9000-000000000010', '44900616-0000-4000-8000-000000000004', 'event_manager', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900616-0000-4000-a000-000000000002', '44900616-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900616-0000-4000-a000-000000000002', '44900616-0000-4000-9000-0000000000a2', 'custom', ARRAY['venue.sell']),
  ('44900616-0000-4000-a000-000000000003', '44900616-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.kitchen']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900616-0000-4000-b000-000000000001', '44900616-0000-4000-9000-000000000010', '44900616-0000-4000-9000-0000000000a1', 'Dinner', true),
  ('44900616-0000-4000-b000-000000000002', '44900616-0000-4000-9000-000000000010', '44900616-0000-4000-9000-0000000000a2', 'Grill', true);
-- V1: Jollof 5,000 kitchen · Chapman 3,000 bar · Zobo 2,000 bar · Water 500 bar · Asun 4,000 kitchen
-- · Rice 3,000 kitchen · Beans 4,000 kitchen. V2: Beer 2,000.
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available, prep_station, sort_order) VALUES
  ('44900616-0000-4000-b000-000000000011', '44900616-0000-4000-b000-000000000001', '44900616-0000-4000-9000-000000000010', 'Jollof', 500000, 'NGN', true, 'kitchen', 1),
  ('44900616-0000-4000-b000-000000000012', '44900616-0000-4000-b000-000000000001', '44900616-0000-4000-9000-000000000010', 'Chapman', 300000, 'NGN', true, 'bar', 2),
  ('44900616-0000-4000-b000-000000000013', '44900616-0000-4000-b000-000000000001', '44900616-0000-4000-9000-000000000010', 'Zobo', 200000, 'NGN', true, 'bar', 3),
  ('44900616-0000-4000-b000-000000000014', '44900616-0000-4000-b000-000000000001', '44900616-0000-4000-9000-000000000010', 'Water', 50000, 'NGN', true, 'bar', 4),
  ('44900616-0000-4000-b000-000000000015', '44900616-0000-4000-b000-000000000001', '44900616-0000-4000-9000-000000000010', 'Asun', 400000, 'NGN', true, 'kitchen', 5),
  ('44900616-0000-4000-b000-000000000016', '44900616-0000-4000-b000-000000000001', '44900616-0000-4000-9000-000000000010', 'Rice', 300000, 'NGN', true, 'kitchen', 6),
  ('44900616-0000-4000-b000-000000000017', '44900616-0000-4000-b000-000000000001', '44900616-0000-4000-9000-000000000010', 'Beans', 400000, 'NGN', true, 'kitchen', 7),
  ('44900616-0000-4000-b000-000000000021', '44900616-0000-4000-b000-000000000002', '44900616-0000-4000-9000-000000000010', 'Beer', 200000, 'NGN', true, NULL, 1);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps) VALUES
  ('44900616-0000-4000-9000-0000000000a1', '44900616-0000-4000-9000-000000000010', 1000),
  ('44900616-0000-4000-9000-0000000000a2', '44900616-0000-4000-9000-000000000010', 0)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = EXCLUDED.service_charge_bps;
INSERT INTO t5f_ids VALUES
  ('v1', '44900616-0000-4000-9000-0000000000a1'), ('v2', '44900616-0000-4000-9000-0000000000a2'),
  ('jollof', '44900616-0000-4000-b000-000000000011'), ('chapman', '44900616-0000-4000-b000-000000000012'),
  ('zobo', '44900616-0000-4000-b000-000000000013'), ('water', '44900616-0000-4000-b000-000000000014'),
  ('asun', '44900616-0000-4000-b000-000000000015'), ('rice', '44900616-0000-4000-b000-000000000016'),
  ('beans', '44900616-0000-4000-b000-000000000017'), ('beer', '44900616-0000-4000-b000-000000000021'),
  ('owner', '44900616-0000-4000-8000-000000000001'), ('seller', '44900616-0000-4000-8000-000000000002'),
  ('kitchen', '44900616-0000-4000-8000-000000000003'), ('evm', '44900616-0000-4000-8000-000000000004');

SELECT public.t5f_as('44900616-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900616-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'f5f-menu-on', true);
SELECT public.issue_4490_set_venue_feature('44900616-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'f5f-till-on', true);
SELECT public.issue_4490_set_venue_feature('44900616-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'f5f-ks-on', true);
SELECT public.issue_4490_set_venue_feature('44900616-0000-4000-9000-0000000000a2', 'menu', true, NULL, NULL, NULL, 'f5f-menu2-on', true);
SELECT public.issue_4490_set_venue_feature('44900616-0000-4000-9000-0000000000a2', 'till', true, NULL, NULL, NULL, 'f5f-till2-on', true);
SELECT public.t5f_reset();

-- Builders, as the edge calls them.
CREATE SEQUENCE public.t5f_pickup START 501;
GRANT USAGE ON SEQUENCE public.t5f_pickup TO PUBLIC;
CREATE FUNCTION public.t5f_open(p_venue uuid, p_key text, p_actor uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_till_open(p_venue, p_actor, NULL, initcap(p_key), NULL, 'f5f-open:' || p_key)->>'id')::uuid
$f$;
-- A held Till round of one line: p_qty x the item (the venue's service charge).
CREATE FUNCTION public.t5f_round(p_sale uuid, p_item uuid, p_qty integer, p_actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
  v_sale public.venue_till_sales%ROWTYPE;
  v_price integer;
  v_name text;
  v_bps integer;
BEGIN
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale;
  SELECT price_cents, name INTO v_price, v_name FROM public.menu_items WHERE id = p_item;
  SELECT service_charge_bps INTO v_bps FROM public.venue_ordering_settings WHERE venue_id = v_sale.venue_id;
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, v_sale.session_id, '44900616-0000-4000-9000-000000000010', v_sale.venue_id, 'staff',
    p_actor, lpad(nextval('public.t5f_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', v_price * p_qty, v_price * p_qty, 0, v_bps, (v_price * p_qty) * v_bps / 10000, 0, 0, 0,
    false, false, false, v_price * p_qty + (v_price * p_qty) * v_bps / 10000, v_price * p_qty + (v_price * p_qty) * v_bps / 10000,
    'pending', 'held', 'till-f5f-round:' || v_order, jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, p_item, 1, v_name, v_price, 'NGN', p_qty, 0, v_price * p_qty);
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, p_actor, NULL);
  RETURN v_order;
END
$f$;
-- A pending guest page order (Paystack) at a venue: lines = [[item, qty], ...];
-- p_discount (minor) off the list, the venue's service charge on the rest.
CREATE FUNCTION public.t5f_guest(p_venue uuid, p_key text, p_lines jsonb, p_discount integer DEFAULT 0) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_list integer := 0;
  v_sub integer;
  v_sc integer;
  v_bps integer;
  r jsonb;
  n integer := 0;
  v_price integer;
  v_name text;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT price_cents INTO v_price FROM public.menu_items WHERE id = (r->>0)::uuid;
    v_list := v_list + v_price * (r->>1)::integer;
  END LOOP;
  SELECT service_charge_bps INTO v_bps FROM public.venue_ordering_settings WHERE venue_id = p_venue;
  v_sub := v_list - p_discount;
  v_sc := v_sub * v_bps / 10000;
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.venue_order_sessions (id, brand_id, venue_id, currency)
  VALUES (v_session, '44900616-0000-4000-9000-000000000010', p_venue, 'NGN');
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, payment_status, paystack_reference, pickup_code, idempotency_key, metadata)
  VALUES (v_order, v_session, '44900616-0000-4000-9000-000000000010', p_venue,
    'guest_page', 'Ada', 'ada@example.com', '+2348030000000',
    'mingla', 'NGN', v_sub, v_list, p_discount, v_bps, v_sc, 0, 150, 0, (v_sub + v_sc) * 150 / 10000, 0,
    false, false, false, v_sub + v_sc, 0, v_sub + v_sc,
    'paystack', 'pending', 'mingla_vo_f5f_' || p_key, lpad(nextval('public.t5f_pickup')::text, 3, '0'),
    'f5f-guest:' || p_key, '{}'::jsonb);
  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    n := n + 1;
    SELECT price_cents, name INTO v_price, v_name FROM public.menu_items WHERE id = (r->>0)::uuid;
    INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
      currency, quantity, modifiers_total_cents, line_total_cents, station)
    VALUES (v_order, (r->>0)::uuid, n, v_name, v_price, 'NGN', (r->>1)::integer, 0, v_price * (r->>1)::integer,
      public.issue_4490_item_station((r->>0)::uuid, p_venue));
  END LOOP;
  SET LOCAL session_replication_role = origin;
  INSERT INTO t5f_ids VALUES ('guest_' || p_key, v_order);
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t5f_pay(p_order uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.pg_venue_order_finalize_payment(o.id, 'paystack', o.total_cents, 'NGN', o.paystack_reference, NULL, NULL, NULL)
  FROM public.venue_orders o WHERE o.id = p_order
$f$;
CREATE FUNCTION public.t5f_line(p_order uuid, p_item uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_order_items WHERE venue_order_id = p_order AND menu_item_id = p_item ORDER BY line_no LIMIT 1
$f$;
CREATE FUNCTION public.t5f_set(p_item uuid, p_count integer) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_stock_set(p_item, p_count, NULL, '44900616-0000-4000-8000-000000000001', NULL)
$f$;
-- One sold-out resolution as the edge calls it.
CREATE FUNCTION public.t5f_resolve(p_order uuid, p_items uuid[], p_resolution text, p_swap uuid, p_actor uuid, p_key text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_order_sold_out_resolve(p_order, p_items, p_resolution, p_swap, p_actor, NULL, p_key)
$f$;
-- The provider settles a refund (the write-back record_source_refund_provider_event
-- does for a processed buyer leg), for the in-flight versus processed cases.
CREATE FUNCTION public.t5f_settle(p_refund uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v public.source_refunds%ROWTYPE;
BEGIN
  UPDATE public.source_refunds SET buyer_state = 'processed', buyer_refund_processed_cents = buyer_refund_requested_cents,
    fee_state = CASE WHEN fee_state = 'not_required' THEN fee_state ELSE 'processed' END,
    fee_reversal_processed_cents = fee_reversal_required_cents, processed_at = now()
  WHERE id = p_refund RETURNING * INTO v;
  UPDATE public.venue_orders
  SET refunded_amount_cents = LEAST(total_cents, refunded_amount_cents + v.buyer_refund_requested_cents),
      payment_status = CASE WHEN refunded_amount_cents + v.buyer_refund_requested_cents >= total_cents
                            THEN 'refunded' ELSE 'partial_refund' END
  WHERE id = v.subject_id;
END
$f$;
CREATE FUNCTION public.t5f_refunds(p_order uuid) RETURNS TABLE (n bigint, requested bigint, fee bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT count(*), COALESCE(sum(buyer_refund_requested_cents), 0)::bigint, COALESCE(sum(fee_reversal_required_cents), 0)::bigint
  FROM public.source_refunds WHERE source_type = 'venue_menu_order' AND source_id = p_order
$f$;
GRANT EXECUTE ON FUNCTION public.t5f_open(uuid, text, uuid), public.t5f_round(uuid, uuid, integer, uuid),
  public.t5f_guest(uuid, text, jsonb, integer), public.t5f_pay(uuid), public.t5f_line(uuid, uuid), public.t5f_set(uuid, integer),
  public.t5f_resolve(uuid, uuid[], text, uuid, uuid, text), public.t5f_settle(uuid), public.t5f_refunds(uuid) TO PUBLIC;

-- ===========================================================================
-- F3 O5-T3: every sold-out line, each exactly once.
-- ===========================================================================
SELECT public.t5f_service();
-- Order A: 2 Jollof + 2 Chapman + 1 Zobo = 18,000.00, service 10% = 1,800.00, total 19,800.00.
-- Jollof 1 left, Chapman 1 left, Zobo none: all three lines sell out after payment.
SELECT public.t5f_set(public.t5f_id('jollof'), 1);
SELECT public.t5f_set(public.t5f_id('chapman'), 1);
SELECT public.t5f_set(public.t5f_id('zobo'), 0);
SELECT public.t5f_set(public.t5f_id('zobo'), 0);
SELECT public.t5f_guest(public.t5f_id('v1'), 'a', jsonb_build_array(
  jsonb_build_array(public.t5f_id('jollof'), 2), jsonb_build_array(public.t5f_id('chapman'), 2),
  jsonb_build_array(public.t5f_id('zobo'), 1)));
INSERT INTO t5f_r VALUES ('a_pay', public.t5f_pay(public.t5f_id('guest_a')));
SELECT public.t5f_ok((public.t5f_rv('a_pay')->>'soldOutAfterPayment')::boolean
  AND (SELECT count(*) FROM public.venue_order_items WHERE venue_order_id = public.t5f_id('guest_a') AND sold_out_at IS NOT NULL) = 3
  AND (SELECT total_cents FROM public.venue_orders WHERE id = public.t5f_id('guest_a')) = 1980000,
  'F3-0 a guest pays 19,800.00 for Jollof x2, Chapman x2, Zobo x1; all three lines sold out after payment');
-- The tester's exact sequence: refund the Jollof line, then the Chapman line.
INSERT INTO t5f_r VALUES ('a_jollof', public.t5f_resolve(public.t5f_id('guest_a'),
  ARRAY[public.t5f_line(public.t5f_id('guest_a'), public.t5f_id('jollof'))], 'refund', NULL, public.t5f_id('owner'), 'f5f-a-jollof'));
SELECT public.t5f_ok((public.t5f_rv('a_jollof')->>'refundMinor')::bigint = 1100000 AND (public.t5f_rv('a_jollof')->>'unresolved')::int = 2,
  'F3-1 refund the Jollof line: 11,000.00 back (10,000.00 + its 1,000.00 service charge); 2 lines still waiting');
INSERT INTO t5f_r VALUES ('a_chapman', public.t5f_resolve(public.t5f_id('guest_a'),
  ARRAY[public.t5f_line(public.t5f_id('guest_a'), public.t5f_id('chapman'))], 'refund', NULL, public.t5f_id('owner'), 'f5f-a-chapman'));
SELECT public.t5f_ok((public.t5f_rv('a_chapman')->>'refundMinor')::bigint = 660000
  AND (SELECT n = 2 AND requested = 1760000 FROM public.t5f_refunds(public.t5f_id('guest_a')))
  AND (SELECT array_agg(refund_kind ORDER BY requested_at, refund_kind) FROM public.source_refunds WHERE source_id = public.t5f_id('guest_a'))
      = ARRAY['venue_order_line_refund', 'venue_order_line_refund_2'],
  'F3-2 then refund the Chapman line: 6,600.00 back, its own refund row (line refund 2); 17,600.00 asked back in all');
INSERT INTO t5f_r VALUES ('a_jollof_again', public.t5f_resolve(public.t5f_id('guest_a'),
  ARRAY[public.t5f_line(public.t5f_id('guest_a'), public.t5f_id('jollof'))], 'refund', NULL, public.t5f_id('owner'), 'f5f-a-jollof'));
SELECT public.t5f_ok((public.t5f_rv('a_jollof_again')->>'replayed')::boolean
  AND public.t5f_rv('a_jollof_again')->>'refundId' = public.t5f_rv('a_jollof')->>'refundId'
  AND (SELECT n FROM public.t5f_refunds(public.t5f_id('guest_a'))) = 2,
  'F3-3 the first request again (same key) answers its first result; no new refund');
SELECT public.t5f_expect(format($$SELECT public.t5f_resolve(%L, ARRAY[%L]::uuid[], 'refund', NULL, %L, 'f5f-a-jollof-2')$$,
  public.t5f_id('guest_a'), public.t5f_line(public.t5f_id('guest_a'), public.t5f_id('jollof')), public.t5f_id('owner')),
  'PT409', 'sold_out_already_resolved', 'F3-4 the Jollof line again with a new key is refused: a line is resolved once');
SELECT public.t5f_expect(format($$SELECT public.t5f_resolve(%L, ARRAY[%L]::uuid[], 'swap', %L, %L, 'f5f-a-chapman-swap')$$,
  public.t5f_id('guest_a'), public.t5f_line(public.t5f_id('guest_a'), public.t5f_id('chapman')), public.t5f_id('water'), public.t5f_id('seller')),
  'PT409', 'sold_out_already_resolved', 'F3-5 a refunded line cannot be swapped afterwards');
-- The third line is swapped for something cheaper: Zobo 2,000 -> Water 500, 1,650.00 back.
-- [TEST-MOD-APPROVED #4490] 08-O5 fix 3 (P8): a swap that gives money back needs the refund rights,
-- so the seller is refused and the owner makes it.
SELECT public.t5f_expect(format($$SELECT public.t5f_resolve(%L, ARRAY[%L]::uuid[], 'swap', %L, %L, 'f5f-a-zobo-seller')$$,
  public.t5f_id('guest_a'), public.t5f_line(public.t5f_id('guest_a'), public.t5f_id('zobo')), public.t5f_id('water'), public.t5f_id('seller')),
  '42501', 'not_authorized', 'F3-5b the seller cannot make a swap that gives money back');
INSERT INTO t5f_r VALUES ('a_zobo', public.t5f_resolve(public.t5f_id('guest_a'),
  ARRAY[public.t5f_line(public.t5f_id('guest_a'), public.t5f_id('zobo'))], 'swap', public.t5f_id('water'), public.t5f_id('owner'), 'f5f-a-zobo'));
SELECT public.t5f_ok((public.t5f_rv('a_zobo')->>'refundMinor')::bigint = 165000 AND (public.t5f_rv('a_zobo')->>'unresolved')::int = 0
  AND (SELECT n = 3 AND requested = 1925000 FROM public.t5f_refunds(public.t5f_id('guest_a'))),
  'F3-6 the owner swaps Zobo for Water: 1,650.00 back (line refund 3); 19,250.00 back in all = what was paid for the three lines');
SELECT public.t5f_ok((SELECT fee = floor(o.mingla_fee_cents * 1925000.0 / o.total_cents + 0.5)
    FROM public.t5f_refunds(public.t5f_id('guest_a')), public.venue_orders o WHERE o.id = public.t5f_id('guest_a')),
  'F3-7 Mingla''s fee comes back once, pro rata on the running total (never more than the three lines'' share)');
-- What is left (the Water the guest still has) can still be refunded by the
-- ordinary whole-order staff refund, netting what the lines gave back.
UPDATE public.venue_orders SET refund_requested_at = now() WHERE id = public.t5f_id('guest_a');
SELECT public.t5f_as(public.t5f_id('owner'));
INSERT INTO t5f_r VALUES ('a_whole', public.biz_venue_order_refund_decision(public.t5f_id('guest_a'), 'approved', 'Sorry about tonight'));
SELECT public.t5f_service();
SELECT public.t5f_ok((public.t5f_rv('a_whole')->'refund'->>'amountCents')::bigint = 55000
  AND (SELECT n = 4 AND requested = 1980000 FROM public.t5f_refunds(public.t5f_id('guest_a')))
  AND (SELECT fee = o.mingla_fee_cents FROM public.t5f_refunds(public.t5f_id('guest_a')), public.venue_orders o
       WHERE o.id = public.t5f_id('guest_a')),
  'F3-8 the whole-order staff refund returns only what is left (550.00): every kobo back exactly once, Mingla''s fee reversed exactly once');
SELECT public.t5f_ok((SELECT (public.pg_venue_order_mint_refund(public.t5f_id('guest_a'), 'venue_order_guest_cancel', 'guest', NULL, 'x'))->>'reason')
    = 'already_requested',
  'F3-9 a second whole-order refund while it is in flight answers the first (no double)');

-- Order B: a whole-order refund already in flight takes everything left; a
-- line refund beside it is refused and changes nothing.
SELECT public.t5f_set(public.t5f_id('asun'), 0);
SELECT public.t5f_guest(public.t5f_id('v1'), 'b', jsonb_build_array(jsonb_build_array(public.t5f_id('asun'), 1),
  jsonb_build_array(public.t5f_id('water'), 1)));
SELECT public.t5f_pay(public.t5f_id('guest_b'));
SELECT public.pg_venue_order_mint_refund(public.t5f_id('guest_b'), 'venue_order_venue_approved', 'brand_staff', public.t5f_id('owner'), 'Closing early');
SELECT public.t5f_expect(format($$SELECT public.t5f_resolve(%L, ARRAY[%L]::uuid[], 'refund', NULL, %L, 'f5f-b-asun')$$,
  public.t5f_id('guest_b'), public.t5f_line(public.t5f_id('guest_b'), public.t5f_id('asun')), public.t5f_id('owner')),
  'PT409', 'already_refunded', 'F3-10 with a whole-order refund in flight, a line refund is refused (the money is already on its way back)');
SELECT public.t5f_ok((SELECT n = 1 AND requested = (SELECT total_cents FROM public.venue_orders WHERE id = public.t5f_id('guest_b'))
    FROM public.t5f_refunds(public.t5f_id('guest_b')))
  AND (SELECT sold_out_resolution IS NULL FROM public.venue_order_items WHERE id = public.t5f_line(public.t5f_id('guest_b'), public.t5f_id('asun'))),
  'F3-11 order B: one refund of the whole order; the line stays as it was');

-- Order C: a discounted order (list 10,000, 1,000 off, service 900; total
-- 9,900) with three sold-out lines refunded one by one. Order D: the same, in ONE call.
SELECT public.t5f_set(public.t5f_id('rice'), 0);
SELECT public.t5f_set(public.t5f_id('beans'), 0);
SELECT public.t5f_set(public.t5f_id('chapman'), 0);
SELECT public.t5f_guest(public.t5f_id('v1'), 'c', jsonb_build_array(jsonb_build_array(public.t5f_id('rice'), 1),
  jsonb_build_array(public.t5f_id('chapman'), 1), jsonb_build_array(public.t5f_id('beans'), 1)), 100000);
SELECT public.t5f_pay(public.t5f_id('guest_c'));
SELECT public.t5f_guest(public.t5f_id('v1'), 'd', jsonb_build_array(jsonb_build_array(public.t5f_id('rice'), 1),
  jsonb_build_array(public.t5f_id('chapman'), 1), jsonb_build_array(public.t5f_id('beans'), 1)), 100000);
SELECT public.t5f_pay(public.t5f_id('guest_d'));
SELECT public.t5f_resolve(public.t5f_id('guest_c'), ARRAY[public.t5f_line(public.t5f_id('guest_c'), public.t5f_id('beans'))],
  'refund', NULL, public.t5f_id('evm'), 'f5f-c-beans');
SELECT public.t5f_resolve(public.t5f_id('guest_c'), ARRAY[public.t5f_line(public.t5f_id('guest_c'), public.t5f_id('rice'))],
  'refund', NULL, public.t5f_id('evm'), 'f5f-c-rice');
SELECT public.t5f_resolve(public.t5f_id('guest_c'), ARRAY[public.t5f_line(public.t5f_id('guest_c'), public.t5f_id('chapman'))],
  'refund', NULL, public.t5f_id('evm'), 'f5f-c-chapman');
SELECT public.t5f_resolve(public.t5f_id('guest_d'), ARRAY[public.t5f_line(public.t5f_id('guest_d'), public.t5f_id('rice')),
  public.t5f_line(public.t5f_id('guest_d'), public.t5f_id('chapman')), public.t5f_line(public.t5f_id('guest_d'), public.t5f_id('beans'))],
  'refund', NULL, public.t5f_id('evm'), 'f5f-d-all');
SELECT public.t5f_ok((SELECT n = 3 AND requested = 990000 FROM public.t5f_refunds(public.t5f_id('guest_c')))
  AND (SELECT n = 1 AND requested = 990000 FROM public.t5f_refunds(public.t5f_id('guest_d')))
  AND (SELECT sum(sold_out_refund_minor) FROM public.venue_order_items WHERE venue_order_id = public.t5f_id('guest_c')) = 990000
  AND (SELECT sum(sold_out_refund_minor) FROM public.venue_order_items WHERE venue_order_id = public.t5f_id('guest_d')) = 990000,
  'F3-12 a discounted order: three lines refunded one by one, or all three in one call, both return exactly 9,900.00 (what was paid), never more');

-- Order E: a line refund that has SETTLED, then the whole-order refund.
SELECT public.t5f_set(public.t5f_id('jollof'), 0);
SELECT public.t5f_guest(public.t5f_id('v1'), 'e', jsonb_build_array(jsonb_build_array(public.t5f_id('jollof'), 1),
  jsonb_build_array(public.t5f_id('water'), 2)));
SELECT public.t5f_pay(public.t5f_id('guest_e'));
INSERT INTO t5f_r VALUES ('e_jollof', public.t5f_resolve(public.t5f_id('guest_e'),
  ARRAY[public.t5f_line(public.t5f_id('guest_e'), public.t5f_id('jollof'))], 'refund', NULL, public.t5f_id('owner'), 'f5f-e-jollof'));
SELECT public.t5f_settle((public.t5f_rv('e_jollof')->>'refundId')::uuid);
INSERT INTO t5f_r VALUES ('e_whole', public.pg_venue_order_mint_refund(public.t5f_id('guest_e'), 'venue_order_venue_approved',
  'brand_staff', public.t5f_id('owner'), 'Rest of it'));
SELECT public.t5f_ok((public.t5f_rv('e_whole')->>'amountCents')::bigint = 110000
  AND (SELECT requested = 660000 AND fee = (SELECT mingla_fee_cents FROM public.venue_orders WHERE id = public.t5f_id('guest_e'))
       FROM public.t5f_refunds(public.t5f_id('guest_e')))
  AND (SELECT payment_status = 'partial_refund' AND refunded_amount_cents = 550000 FROM public.venue_orders WHERE id = public.t5f_id('guest_e')),
  'F3-13 after a settled line refund (5,500.00) the whole-order refund returns the rest (1,100.00); fee reversed once in all');
SELECT public.t5f_reset();

-- ===========================================================================
-- F4 O5-T4: a void's "Put it back in stock" at a station with no screen.
-- ===========================================================================
SELECT public.t5f_service();
-- V1 has kitchen screens on, but no station has a screen tonight.
INSERT INTO public.venue_till_settings (venue_id, brand_id, screen_stations)
VALUES (public.t5f_id('v1'), '44900616-0000-4000-9000-000000000010', '{}'::text[])
ON CONFLICT (venue_id) DO UPDATE SET screen_stations = '{}'::text[];
SELECT public.t5f_set(public.t5f_id('zobo'), 5);
INSERT INTO t5f_ids VALUES ('sale_v', public.t5f_open(public.t5f_id('v1'), 'void-cycles', public.t5f_id('seller')));
DO $cycles$
DECLARE
  i integer;
  v_round uuid;
BEGIN
  FOR i IN 1..3 LOOP
    v_round := public.t5f_round(public.t5f_id('sale_v'), public.t5f_id('zobo'), 1, public.t5f_id('seller'));
    PERFORM public.issue_4490_till_send(public.t5f_id('sale_v'), public.t5f_id('seller'));
    IF public.t5f_stock(public.t5f_id('zobo')) <> 4
       OR (SELECT prep_state FROM public.venue_order_items WHERE venue_order_id = v_round) <> 'served' THEN
      RAISE EXCEPTION 'T4490F FAIL: F4-1 cycle % send did not take one unit at a no-screen station', i;
    END IF;
    PERFORM public.issue_4490_till_void(public.t5f_id('sale_v'), NULL,
      (SELECT id FROM public.venue_order_items WHERE venue_order_id = v_round), public.t5f_id('owner'),
      'Rang the wrong item', true, public.t5f_v(public.t5f_id('sale_v')));
  END LOOP;
END
$cycles$;
SELECT public.t5f_ok(public.t5f_stock(public.t5f_id('zobo')) = 5
  AND (SELECT count(*) FROM public.audit_log a WHERE a.action = 'stock.set' AND a.target_id = public.t5f_id('zobo')::text
         AND a.after->>'via' = 'void' AND a.after->>'reason' = 'void_restock' AND (a.after->>'units_back')::int = 1
         AND (a.after->>'station_screen')::boolean = false) = 3,
  'F4-1 three send-then-void cycles at a no-screen station with "Put it back in stock" on: the count is back at 5, each audited');
INSERT INTO t5f_ids VALUES ('round_off', public.t5f_round(public.t5f_id('sale_v'), public.t5f_id('zobo'), 1, public.t5f_id('seller')));
SELECT public.issue_4490_till_send(public.t5f_id('sale_v'), public.t5f_id('seller'));
SELECT public.issue_4490_till_void(public.t5f_id('sale_v'), NULL,
  (SELECT id FROM public.venue_order_items WHERE venue_order_id = public.t5f_id('round_off')), public.t5f_id('owner'),
  'Made and dropped', false, public.t5f_v(public.t5f_id('sale_v')));
SELECT public.t5f_ok(public.t5f_stock(public.t5f_id('zobo')) = 4
  AND EXISTS (SELECT 1 FROM public.audit_log a WHERE a.action = 'stock.set' AND a.target_id = public.t5f_id('zobo')::text
         AND a.after->>'reason' = 'void_no_restock' AND (a.after->>'restock')::boolean = false AND (a.after->>'units_back')::int = 0),
  'F4-2 with the switch off nothing comes back (4 left), and the choice is audited');
INSERT INTO t5f_ids VALUES ('round_two', public.t5f_round(public.t5f_id('sale_v'), public.t5f_id('zobo'), 2, public.t5f_id('seller')));
SELECT public.issue_4490_till_send(public.t5f_id('sale_v'), public.t5f_id('seller'));
SELECT public.t5f_ok(public.t5f_stock(public.t5f_id('zobo')) = 2, 'F4-3 a line of 2 is sent (2 left)');
SELECT public.issue_4490_till_void(public.t5f_id('sale_v'), NULL,
  (SELECT id FROM public.venue_order_items WHERE venue_order_id = public.t5f_id('round_two')), public.t5f_id('owner'),
  'Rang the wrong item', true, public.t5f_v(public.t5f_id('sale_v')));
-- The same void again (a retry): the round is already cancelled, so it is
-- refused as before this fix and nothing comes back a second time.
SELECT public.t5f_expect(format($$SELECT public.issue_4490_till_void(%L, NULL, %L, %L, 'Rang the wrong item', true, %s)$$,
  public.t5f_id('sale_v'), (SELECT id FROM public.venue_order_items WHERE venue_order_id = public.t5f_id('round_two')),
  public.t5f_id('owner'), public.t5f_v(public.t5f_id('sale_v'))),
  'PT409', 'till_line_paid', 'F4-4a the same void again is refused (the round is already cancelled)');
SELECT public.t5f_ok(public.t5f_stock(public.t5f_id('zobo')) = 4
  AND (SELECT stock_taken FROM public.venue_order_items WHERE venue_order_id = public.t5f_id('round_two')) = 0,
  'F4-4 its void gives back exactly the 2 it took (4, never more), and the same void again gives nothing twice');
-- A station WITH a screen keeps today's rule.
UPDATE public.venue_till_settings SET screen_stations = ARRAY['kitchen', 'bar'] WHERE venue_id = public.t5f_id('v1');
INSERT INTO t5f_ids VALUES ('round_scr', public.t5f_round(public.t5f_id('sale_v'), public.t5f_id('zobo'), 1, public.t5f_id('seller')));
SELECT public.issue_4490_till_send(public.t5f_id('sale_v'), public.t5f_id('seller'));
SELECT public.issue_4490_station_accept(public.t5f_id('round_scr'), 'bar', public.t5f_id('kitchen'));
SELECT public.issue_4490_till_void(public.t5f_id('sale_v'), NULL,
  (SELECT id FROM public.venue_order_items WHERE venue_order_id = public.t5f_id('round_scr')), public.t5f_id('owner'),
  'Made wrong', true, public.t5f_v(public.t5f_id('sale_v')));
SELECT public.t5f_ok(public.t5f_stock(public.t5f_id('zobo')) = 3
  AND EXISTS (SELECT 1 FROM public.audit_log a WHERE a.action = 'stock.set' AND a.target_id = public.t5f_id('zobo')::text
         AND a.after->>'reason' = 'void_no_restock' AND (a.after->>'station_screen')::boolean AND (a.after->>'restock')::boolean),
  'F4-5 at a station with a screen a line the bar already started never comes back, even with the switch on (3 left)');
INSERT INTO t5f_ids VALUES ('round_scr2', public.t5f_round(public.t5f_id('sale_v'), public.t5f_id('zobo'), 1, public.t5f_id('seller')));
SELECT public.issue_4490_till_send(public.t5f_id('sale_v'), public.t5f_id('seller'));
SELECT public.issue_4490_till_void(public.t5f_id('sale_v'), NULL,
  (SELECT id FROM public.venue_order_items WHERE venue_order_id = public.t5f_id('round_scr2')), public.t5f_id('owner'),
  'Changed their mind', true, public.t5f_v(public.t5f_id('sale_v')));
SELECT public.t5f_ok(public.t5f_stock(public.t5f_id('zobo')) = 3,
  'F4-6 and a line still waiting on the screen comes back (3 again), as before this fix');
SELECT public.t5f_reset();

-- ===========================================================================
-- F1 O5-T1: changing opening hours after a close never moves money.
-- ===========================================================================
-- T = the venue's calendar day now.
CREATE FUNCTION public.t5f_t() RETURNS date LANGUAGE sql STABLE AS $f$
  SELECT (now() AT TIME ZONE public.issue_4490_venue_timezone('44900616-0000-4000-9000-0000000000a2'))::date
$f$;
GRANT EXECUTE ON FUNCTION public.t5f_t() TO PUBLIC;
SELECT public.t5f_service();
SELECT public.issue_4490_ensure_booking_settings(public.t5f_id('v2'));
-- It is between 01:00 and 02:00 at the venue, whenever this runs.
UPDATE public.venue_booking_settings
SET timezone = CASE
  WHEN extract(hour FROM now() AT TIME ZONE 'UTC')::integer <= 1 THEN 'Etc/GMT-' || (1 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer)
  WHEN extract(hour FROM now() AT TIME ZONE 'UTC')::integer <= 13 THEN 'Etc/GMT+' || (extract(hour FROM now() AT TIME ZONE 'UTC')::integer - 1)
  ELSE 'Etc/GMT-' || (25 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer) END
WHERE venue_id = public.t5f_id('v2');
-- Opening hours 12:00 to 23:59 every day (a night that never passes midnight),
-- in force since before any money here (no history: the live hours).
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900616-0000-4000-9000-000000000010', public.t5f_id('v2'), d, '12:00', '23:59', false FROM generate_series(0, 6) d;
DELETE FROM public.venue_hours_history WHERE venue_id = public.t5f_id('v2');
SELECT public.t5f_ok(extract(hour FROM now() AT TIME ZONE public.issue_4490_venue_timezone(public.t5f_id('v2'))) = 1
  AND public.issue_4490_venue_service_date(public.t5f_id('v2'), now()) = public.t5f_t(),
  'F1-0 fixture: it is 01:xx at the venue and its service day T is the calendar day (the night closes at 23:59)');
-- Day T's money, recorded 40 minutes ago (00:2x to 01:1x): two cash sales on
-- the Till (one part refunded 10 minutes later) and a guest order paid online.
DO $money$
DECLARE
  v_sale uuid;
  v_pay jsonb;
  i integer;
BEGIN
  FOR i IN 1..2 LOOP
    v_sale := public.t5f_open(public.t5f_id('v2'), 'night-' || i, public.t5f_id('seller'));
    PERFORM public.t5f_round(v_sale, public.t5f_id('beer'), i, public.t5f_id('seller'));
    PERFORM public.issue_4490_till_send(v_sale, public.t5f_id('seller'));
    v_pay := public.issue_4490_till_take_payment(v_sale, 'cash',
      (SELECT total_due_minor - paid_minor FROM public.venue_till_sales WHERE id = v_sale), 0, 1000000,
      public.t5f_id('seller'), NULL, gen_random_uuid(), public.t5f_v(v_sale));
    INSERT INTO t5f_ids VALUES ('night_' || i, v_sale);
  END LOOP;
  PERFORM public.issue_4490_till_refund((SELECT p.id FROM public.venue_till_payments p WHERE p.sale_id = public.t5f_id('night_2')),
    50000, 0, 'Warm beer', false, public.t5f_id('owner'), NULL, gen_random_uuid());
END
$money$;
SELECT public.t5f_guest(public.t5f_id('v2'), 'night', jsonb_build_array(jsonb_build_array(public.t5f_id('beer'), 3)));
SELECT public.t5f_pay(public.t5f_id('guest_night'));
UPDATE public.venue_till_sales SET created_at = created_at - interval '40 minutes', paid_at = paid_at - interval '40 minutes'
WHERE venue_id = public.t5f_id('v2');
UPDATE public.venue_till_payments p SET created_at = p.created_at - interval '40 minutes', paid_at = p.paid_at - interval '40 minutes'
FROM public.venue_till_sales s WHERE s.id = p.sale_id AND s.venue_id = public.t5f_id('v2');
UPDATE public.venue_till_refunds r SET created_at = r.created_at - interval '30 minutes'
FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id
WHERE p.id = r.payment_id AND s.venue_id = public.t5f_id('v2');
UPDATE public.venue_orders SET created_at = created_at - interval '45 minutes', confirmed_at = confirmed_at - interval '40 minutes'
WHERE venue_id = public.t5f_id('v2');
SELECT public.t5f_ok((SELECT bool_and(p.business_date = public.t5f_t()) AND count(*) = 2
    FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id WHERE s.venue_id = public.t5f_id('v2'))
  AND (SELECT bool_and(r.business_date = public.t5f_t()) AND count(*) = 1
    FROM public.venue_till_refunds r JOIN public.venue_till_payments p ON p.id = r.payment_id
    JOIN public.venue_till_sales s ON s.id = p.sale_id WHERE s.venue_id = public.t5f_id('v2')),
  'F1-1 the Till stored day T on both payments and on the refund when the money was recorded');
-- Before anything changes: what T and T-1 show, live.
INSERT INTO t5f_r SELECT 'md_t', public.issue_4490_venue_money_day(public.t5f_id('v2'), public.t5f_t());
INSERT INTO t5f_r SELECT 'md_y', public.issue_4490_venue_money_day(public.t5f_id('v2'), public.t5f_t() - 1);
INSERT INTO t5f_r SELECT 'sum_y', public.issue_4490_day_summary(public.t5f_id('v2'), public.t5f_t() - 1, public.t5f_id('owner'), NULL);
INSERT INTO t5f_r SELECT 'live_t', public.issue_4490_day_totals(public.t5f_id('v2'), public.t5f_t());
SELECT public.t5f_ok((public.t5f_rv('live_t')->'takings'->>'count')::int = 2
  AND (public.t5f_rv('live_t')->'takings'->>'amountMinor')::bigint = 600000
  AND (public.t5f_rv('live_t')->'refunds'->>'amountMinor')::bigint = 50000
  AND (public.t5f_rv('live_t')->'orderedOnline'->>'count')::int = 1
  AND (public.t5f_rv('sum_y')->'totals'->'takings'->>'count')::int = 0,
  'F1-2 day T live: 2 Till payments 6,000.00, a 500.00 refund, 1 guest order online; day T-1 has nothing');
-- Close day T, counted exactly.
INSERT INTO t5f_r SELECT 'close_t', public.issue_4490_day_close(public.t5f_id('v2'), public.t5f_t(),
  (public.t5f_rv('live_t')->'cash'->>'expectedMinor')::bigint, public.t5f_id('owner'), NULL, gen_random_uuid());
INSERT INTO t5f_r SELECT 'snap_t', (SELECT totals FROM public.venue_day_closes WHERE venue_id = public.t5f_id('v2') AND business_date = public.t5f_t());
-- Twenty minutes ago the owner moved closing time to 03:00 (the night now runs
-- past midnight): written the way the Host writes hours, then dated.
UPDATE public.brand_hours SET close_time = '03:00' WHERE venue_id = public.t5f_id('v2');
UPDATE public.venue_hours_history SET valid_from = now() - interval '20 minutes'
WHERE venue_id = public.t5f_id('v2') AND valid_from > '-infinity'::timestamptz;
SELECT public.t5f_ok((SELECT count(*) FROM public.venue_hours_history WHERE venue_id = public.t5f_id('v2')) = 2
  AND public.issue_4490_venue_service_date(public.t5f_id('v2'), now()) = public.t5f_t() - 1
  AND public.issue_4490_venue_service_date(public.t5f_id('v2'), now() - interval '40 minutes') = public.t5f_t(),
  'F1-3 the hours history keeps both versions: NOW belongs to the night before (new hours), the money''s moments still to T (the hours then)');
SELECT public.t5f_ok(
  (public.issue_4490_day_summary(public.t5f_id('v2'), public.t5f_t(), public.t5f_id('owner'), NULL)->>'state') = 'closed'
  AND (public.issue_4490_day_summary(public.t5f_id('v2'), public.t5f_t(), public.t5f_id('owner'), NULL)->'totals')
      = public.t5f_rv('snap_t') - 'paymentIds' - 'refundIds'
  AND (public.issue_4490_day_summary(public.t5f_id('v2'), public.t5f_t(), public.t5f_id('owner'), NULL)->'late'->>'count')::int = 0
  AND (SELECT totals = public.t5f_rv('snap_t') FROM public.venue_day_closes WHERE venue_id = public.t5f_id('v2') AND business_date = public.t5f_t()),
  'F1-4 the closed day T still answers (no day_out_of_range), its stored snapshot is unchanged and nothing is late');
INSERT INTO t5f_r SELECT 'sum_y2', public.issue_4490_day_summary(public.t5f_id('v2'), public.t5f_t() - 1, public.t5f_id('owner'), NULL);
SELECT public.t5f_ok(public.t5f_rv('sum_y2')->'totals' = public.t5f_rv('sum_y')->'totals'
  AND (public.t5f_rv('sum_y2')->'totals'->'takings'->>'count')::int = 0
  AND (public.t5f_rv('sum_y2')->'totals'->'orderedOnline'->>'count')::int = 0
  AND public.issue_4490_day_payment_ids(public.t5f_id('v2'), public.t5f_t() - 1) = '{}'::uuid[]
  AND public.issue_4490_day_refund_ids(public.t5f_id('v2'), public.t5f_t() - 1) = '{}'::uuid[],
  'F1-5 the night before (now "today") is unchanged: none of T''s payments, refunds or online orders moved into it');
SELECT public.t5f_ok(public.issue_4490_venue_money_day(public.t5f_id('v2'), public.t5f_t()) = public.t5f_rv('md_t')
  AND public.issue_4490_venue_money_day(public.t5f_id('v2'), public.t5f_t() - 1) = public.t5f_rv('md_y'),
  'F1-6 "Paid in today" for T and for the night before is unchanged');
SELECT public.t5f_ok(NOT EXISTS (
    SELECT p.id FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id
    WHERE s.venue_id = public.t5f_id('v2')
      AND (SELECT count(*) FROM generate_series(-1, 1) d
           WHERE p.id = ANY (public.issue_4490_day_payment_ids(public.t5f_id('v2'), public.t5f_t() + d))) <> 1)
  AND (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(public.t5f_rv('snap_t')->'paymentIds') x)
      = (SELECT array_agg(x::text ORDER BY x::text) FROM unnest(public.issue_4490_day_payment_ids(public.t5f_id('v2'), public.t5f_t())) x),
  'F1-7 every payment is on exactly one day (T), the one its close holds');
-- A closed day stays reopenable and closable after the change.
SELECT public.issue_4490_day_reopen(public.t5f_id('v2'), public.t5f_t(), 'Recount', public.t5f_id('owner'), NULL);
INSERT INTO t5f_r SELECT 'close_t2', public.issue_4490_day_close(public.t5f_id('v2'), public.t5f_t(),
  (public.t5f_rv('live_t')->'cash'->>'expectedMinor')::bigint, public.t5f_id('owner'), NULL, gen_random_uuid());
SELECT public.t5f_ok((SELECT totals->'paymentIds' = public.t5f_rv('snap_t')->'paymentIds'
       AND totals->'refundIds' = public.t5f_rv('snap_t')->'refundIds'
       AND totals->'takings' = public.t5f_rv('snap_t')->'takings' AND totals->'cash' = public.t5f_rv('snap_t')->'cash'
       AND totals->'orderedOnline' = public.t5f_rv('snap_t')->'orderedOnline' AND reopen_count = 1
    FROM public.venue_day_closes WHERE venue_id = public.t5f_id('v2') AND business_date = public.t5f_t()),
  'F1-8 day T reopens and closes again after the hours change with the same payments, refunds, cash and online orders');
SELECT public.t5f_ok(jsonb_array_length(public.issue_4490_day_export(public.t5f_id('v2'), public.t5f_t(), public.t5f_id('owner'), NULL)->'rows') = 2
  AND jsonb_array_length(public.issue_4490_day_export(public.t5f_id('v2'), public.t5f_t() - 1, public.t5f_id('owner'), NULL)->'rows') = 0,
  'F1-9 the export of T still has its 2 payments; the night before has none');
SELECT public.t5f_expect(format($$SELECT public.issue_4490_day_summary(%L, %L::date, %L, NULL)$$,
  public.t5f_id('v2'), public.t5f_t() + 1, public.t5f_id('owner')),
  '22023', 'day_out_of_range', 'F1-10 a day after "today" with no close and no money is still out of range');
-- Money recorded after the change follows the new hours: a sale now lands on the night before.
DO $after$
DECLARE v_sale uuid;
BEGIN
  v_sale := public.t5f_open(public.t5f_id('v2'), 'after-change', public.t5f_id('seller'));
  PERFORM public.t5f_round(v_sale, public.t5f_id('beer'), 1, public.t5f_id('seller'));
  PERFORM public.issue_4490_till_send(v_sale, public.t5f_id('seller'));
  PERFORM public.issue_4490_till_take_payment(v_sale, 'cash', (SELECT total_due_minor - paid_minor FROM public.venue_till_sales WHERE id = v_sale),
    0, 1000000, public.t5f_id('seller'), NULL, gen_random_uuid(), public.t5f_v(v_sale));
  INSERT INTO t5f_ids VALUES ('after', v_sale);
END
$after$;
SELECT public.t5f_ok((SELECT p.business_date = public.t5f_t() - 1 FROM public.venue_till_payments p WHERE p.sale_id = public.t5f_id('after'))
  AND (SELECT (s->'late'->>'count')::int = 0 FROM public.issue_4490_day_summary(public.t5f_id('v2'), public.t5f_t(), public.t5f_id('owner'), NULL) s),
  'F1-11 a sale recorded after the change is the night before''s (the new hours), never late money of the closed day T');
-- The close reads the day the Till STORED, not a day worked out again from
-- the moment: even a later change of the venue's time zone (twelve hours on)
-- moves no payment or refund of the closed day T.
UPDATE public.venue_booking_settings SET timezone = CASE WHEN timezone LIKE 'Etc/GMT-%'
    THEN 'Etc/GMT+' || GREATEST(12 - substr(timezone, 9)::int, 0) ELSE 'Etc/GMT-' || LEAST(12 - substr(timezone, 9)::int, 14) END
WHERE venue_id = public.t5f_id('v2');
SELECT public.t5f_ok(
  (SELECT array_agg(x::text ORDER BY x::text) FROM unnest(public.issue_4490_day_payment_ids(public.t5f_id('v2'), (public.t5f_rv('snap_t')->>'businessDate')::date)) x)
    = (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(public.t5f_rv('snap_t')->'paymentIds') x)
  AND (SELECT array_agg(x::text ORDER BY x::text) FROM unnest(public.issue_4490_day_refund_ids(public.t5f_id('v2'), (public.t5f_rv('snap_t')->>'businessDate')::date)) x)
    = (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(public.t5f_rv('snap_t')->'refundIds') x),
  'F1-12 after a time zone change the close of T still reads exactly T''s stored payments and refund');
-- A pending (unverified) venue takes no money and keeps no hours history, so
-- its #2099 identity correction never meets these rows.
UPDATE public.venue_listings SET claim_status = 'pending_review' WHERE id = public.t5f_id('v1');
UPDATE public.brand_hours SET close_time = close_time WHERE venue_id = public.t5f_id('v1');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900616-0000-4000-9000-000000000010', public.t5f_id('v1'), d, '09:00', '17:00', false FROM generate_series(0, 6) d;
SELECT public.t5f_ok(NOT EXISTS (SELECT 1 FROM public.venue_hours_history WHERE venue_id = public.t5f_id('v1')),
  'F1-13 a pending venue''s hours change writes no history (nothing for #2099 to block on)');
SELECT public.t5f_reset();

ROLLBACK;
\echo 'issue #4490 08-O5 fix 1: all cases passed'
