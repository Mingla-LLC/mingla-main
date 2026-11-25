-- #4490 spec 08 O3 fix 5 (O3-S3): executable PostgreSQL 17 proof for migration
-- 20281203624490 (a Till request id names one money action on a check).
-- The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-ONE-REQUEST-ONE-ACTION | issue #4490 | a Till client_request_id names one money action on its check: the same id with the same money facts (payment: method, amount, tip, cash given; card start: method, tip; refund: payment, amount, tip; line refund: the line) answers the original action's facts, and the same id with any other facts raises PT409 till_request_reused and moves no money (issue_4490_till_take_payment, issue_4490_till_card_start, issue_4490_till_refund, issue_4490_till_mint_carrier_refund, issue_4490_till_refund_line).
--
-- FAILS-ON-REVERT: without 20281203624490 F5-P1 fails (the answer carries no
-- recorded amount); with only take_payment's refusal removed F5-P2 fails (the
-- 1,750.00 payment sent with the 1,000.00 payment's id is answered as a replay
-- and writes nothing); with till_refund's removed F5-R2; with refund_line's
-- removed F5-L2.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490f5_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490F5 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490f5_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490F5 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490F5 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490f5_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490f5_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490f5_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_ok(boolean,text), public.t4490f5_expect(text,text,text,text),
  public.t4490f5_as(uuid), public.t4490f5_service(), public.t4490f5_reset() TO PUBLIC;
CREATE TEMP TABLE t4490f5_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490f5_ids TO PUBLIC;
CREATE FUNCTION public.t4490f5_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490f5_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490f5_till(p_on boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  UPDATE public.feature_flags SET is_enabled = p_on WHERE flag_key = 'VENUE_TILL'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_till(boolean) TO PUBLIC;
CREATE FUNCTION public.t4490f5_date() RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_venue_local_date('44900605-0000-4000-9000-0000000000a1')
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_date() TO PUBLIC;
CREATE FUNCTION public.t4490f5_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_v(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 03 scanner (rank 10), 04 finance
-- manager, 05 venue staff with check-in only, 06 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900605-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-f5-' || n || '@example.test', now(), now()
FROM generate_series(1, 6) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900605-0000-4000-8000-000000000001', now()), ('44900605-0000-4000-8000-000000000006', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900605-0000-4000-9000-000000000010', '44900605-0000-4000-8000-000000000001',
   'Till Fix Five 4490', 'till-f5-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900605-0000-4000-9000-000000000020', '44900605-0000-4000-8000-000000000006',
   'Till Fix Five Other 4490', 'till-f5-other-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900605-0000-4000-9000-0000000000a1', '44900605-0000-4000-9000-000000000010', 'tillf5a', 'Fix Five Bar',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900605-0000-4000-9000-000000000010', '44900605-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900605-0000-4000-a000-000000000002', '44900605-0000-4000-9000-000000000010', '44900605-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900605-0000-4000-a000-000000000003', '44900605-0000-4000-9000-000000000010', '44900605-0000-4000-8000-000000000003', 'scanner', now()),
  ('44900605-0000-4000-a000-000000000004', '44900605-0000-4000-9000-000000000010', '44900605-0000-4000-8000-000000000004', 'finance_manager', now()),
  ('44900605-0000-4000-a000-000000000005', '44900605-0000-4000-9000-000000000010', '44900605-0000-4000-8000-000000000005', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900605-0000-4000-a000-000000000002', '44900605-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900605-0000-4000-a000-000000000005', '44900605-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900605-0000-4000-b000-000000000001', '44900605-0000-4000-9000-000000000010', '44900605-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900605-0000-4000-b000-000000000011', '44900605-0000-4000-b000-000000000001', '44900605-0000-4000-9000-000000000010', 'Chapman', 250000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900605-0000-4000-9000-0000000000a1', '44900605-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;
SELECT public.t4490f5_as('44900605-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900605-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'f5-till-on');
-- TEST-MOD-APPROVED #4490 (08-O3 part A, T8): the venue has kitchen screens, so a sent round waits for
-- the kitchen (placed) as these assertions expect; without a screen it is delivered at send.
SELECT public.issue_4490_set_venue_feature('44900605-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'f5-menu-on-a');
SELECT public.issue_4490_set_venue_feature('44900605-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'f5-screens-on-a');
SELECT public.issue_4490_set_venue_feature('44900605-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'f5-entry-on');
SELECT public.issue_4490_set_venue_feature('44900605-0000-4000-9000-0000000000a1', 'guest_list', true, NULL, NULL, NULL, 'f5-gl-on');
SELECT public.t4490f5_reset();

-- Pickup codes are unique while live: hand them out in order (never random).
CREATE SEQUENCE public.t4490f5_pickup START 101;
GRANT USAGE ON SEQUENCE public.t4490f5_pickup TO PUBLIC;
-- A staff round exactly as the order pad (status placed) or the Till (held)
-- inserts it: 1 x Chapman 2,500.00 + 10% = 2,750.00.
CREATE FUNCTION public.t4490f5_round(p_session uuid, p_status text, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, p_session, '44900605-0000-4000-9000-000000000010', '44900605-0000-4000-9000-0000000000a1', 'staff',
    p_actor, lpad(nextval('public.t4490f5_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 250000, 250000, 0, 1000, 25000, 0, 0, 0, false, false, false,
    275000, 275000, 'pending', p_status, 'till-f5-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900605-0000-4000-b000-000000000011', 1, 'Chapman', 250000, 'NGN', 1, 0, 250000);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_round(uuid, text, uuid) TO PUBLIC;
-- A sitting the pad starts (no tab yet).
CREATE FUNCTION public.t4490f5_session() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
  VALUES ('44900605-0000-4000-9000-000000000010', '44900605-0000-4000-9000-0000000000a1', 'NGN') RETURNING id
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_session() TO PUBLIC;
CREATE FUNCTION public.t4490f5_sale_of(p_session uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_till_sales WHERE session_id = p_session
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_sale_of(uuid) TO PUBLIC;
-- A Till check with one round attached (held).
CREATE FUNCTION public.t4490f5_check(p_key text, p_label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb; v_sale uuid; v_session uuid;
BEGIN
  v := public.issue_4490_till_open('44900605-0000-4000-9000-0000000000a1',
    '44900605-0000-4000-8000-000000000002', NULL, p_label, NULL, p_key);
  v_sale := (v->>'id')::uuid;
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  PERFORM public.issue_4490_till_attach_round(v_sale,
    public.t4490f5_round(v_session, 'held', '44900605-0000-4000-8000-000000000002'),
    '44900605-0000-4000-8000-000000000002', NULL);
  RETURN v_sale;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_check(text, text) TO PUBLIC;


SELECT public.t4490f5_as('44900605-0000-4000-8000-000000000001');
DO $offer_setup$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_option uuid;
  v_version bigint;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', '44900605-0000-4000-9000-0000000000a1',
    '{"name":"Door","dailyLimit":10,"keptForWalkIns":4}'::jsonb, NULL, 'f5-pool-create');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', '44900605-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Door entry","entryStyle":"walk_in"}'::jsonb, NULL, 'f5-offer-create');
  v_offer := (v->>'id')::uuid; v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_pool', '44900605-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_version, 'f5-pool-set');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '44900605-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Standard', 'unit', 'guest', 'guestMin', 1, 'guestMax', 10,
      'priceMinor', 500000), v_version, 'f5-price-set');
  v_version := (v->>'version')::bigint;
  SELECT (row->>'id')::uuid INTO v_option FROM jsonb_array_elements(v->'options') row WHERE row->>'name' = 'Standard';
  v := public.issue_4490_manage_offer('set_policy', '44900605-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', '[]'::jsonb, 'dateChangeRule', '{}'::jsonb), v_version, 'f5-policy');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', '44900605-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'mode', 'full_day', 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'startTime', '00:00', 'endTime', '23:59'), v_version, 'f5-schedule');
  v_version := (v->>'version')::bigint;
  PERFORM public.issue_4490_manage_offer('publish', '44900605-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer), v_version, 'f5-publish');
  v := public.issue_4490_manage_guest_list('set_terms', '44900605-0000-4000-9000-0000000000a1',
    jsonb_build_object('freeUntil', NULL, 'reducedUntil', '23:59', 'reducedPriceOptionId', v_option,
      'plusOnesMax', 3, 'closesMinutesBefore', 0), NULL, 'f5-gl-terms');
  v := public.issue_4490_manage_guest_list('add_entry', '44900605-0000-4000-9000-0000000000a1',
    jsonb_build_object('localDate', public.t4490f5_date(), 'guestName', 'Bola List', 'plusOnes', 0), NULL, 'f5-gl-add');
  INSERT INTO t4490f5_ids VALUES ('pool', v_pool), ('offer', v_offer), ('option', v_option),
    ('entry', (v#>>'{entry,id}')::uuid);
END
$offer_setup$;
SELECT public.t4490f5_reset();

CREATE FUNCTION public.t4490f5_pays(p_sale uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT count(*) FROM public.venue_till_payments WHERE sale_id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_pays(uuid) TO PUBLIC;
CREATE FUNCTION public.t4490f5_refunds(p_sale uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT count(*) FROM public.venue_till_refunds r JOIN public.venue_till_payments p ON p.id = r.payment_id
  WHERE p.sale_id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_refunds(uuid) TO PUBLIC;
-- The edge's replay of a card start (no prepare, placeholder money, no version).
CREATE FUNCTION public.t4490f5_card_replay(p_sale uuid, p_method text, p_tip bigint, p_req uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_card_start(p_sale, p_method, p_tip, '44900605-0000-4000-8000-000000000002', NULL, p_req,
    NULL, jsonb_build_object('provider', CASE WHEN p_method = 'tap' THEN 'stripe' ELSE 'paystack' END, 'totalCents', 1),
    CASE WHEN p_method = 'scan' THEN 'Q5BBBBBB' END)
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f5_card_replay(uuid, text, bigint, uuid) TO PUBLIC;

-- -------------------------------------------------------------------------
-- 1. The device test's sequence: ₦1,000 cash on a ₦2,750 check, then the rest.
-- -------------------------------------------------------------------------
SELECT public.t4490f5_service();
DO $part$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f5_check('f5-part-check', 'Part');
  v_a uuid := '44900605-0000-4000-c000-00000000000a';
  v_b uuid := '44900605-0000-4000-c000-00000000000b';
  v_v0 integer;
  v_p1 uuid;
  v_other uuid;
BEGIN
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 100000, 0, 100000,
    '44900605-0000-4000-8000-000000000002', NULL, v_a, public.t4490f5_v(v_sale));
  v_p1 := (v->>'paymentId')::uuid;
  v_v0 := public.t4490f5_v(v_sale);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean = false AND (v->>'amountMinor')::bigint = 100000
      AND (v->>'tipMinor')::bigint = 0 AND v->>'method' = 'cash' AND v->>'state' = 'paid'
      AND (v#>>'{sale,remainingMinor}')::bigint = 175000 AND public.t4490f5_pays(v_sale) = 1,
    'F5-P1 a part payment of 1,000.00 answers the amount it recorded; 1,750.00 left');
  -- The bug: the rest sent with the part payment's id.
  PERFORM public.t4490f5_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 175000, 0, 175000,
      '44900605-0000-4000-8000-000000000002', NULL, %L, %s)$q$, v_sale, v_a, v_v0),
    'PT409', 'till_request_reused', 'F5-P2 the same id with another amount (the rest) is refused');
  PERFORM public.t4490f5_ok(public.t4490f5_pays(v_sale) = 1
      AND (SELECT paid_minor FROM public.venue_till_sales WHERE id = v_sale) = 100000
      AND public.t4490f5_v(v_sale) = v_v0,
    'F5-P3 ... and moves no money: one payment row, 1,000.00 paid, version unchanged');
  PERFORM public.t4490f5_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'own_machine', 100000, 0, NULL,
      '44900605-0000-4000-8000-000000000002', NULL, %L, %s)$q$, v_sale, v_a, v_v0),
    'PT409', 'till_request_reused', 'F5-P4 the same id with another method is refused');
  PERFORM public.t4490f5_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 100000, 0, 200000,
      '44900605-0000-4000-8000-000000000002', NULL, %L, %s)$q$, v_sale, v_a, v_v0),
    'PT409', 'till_request_reused', 'F5-P5 the same id with another cash given is refused');
  -- A true retry (the answer was lost): same id, same facts, the version from before.
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 100000, 0, 100000,
    '44900605-0000-4000-8000-000000000002', NULL, v_a, v_v0 - 1);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean AND (v->>'paymentId')::uuid = v_p1
      AND (v->>'amountMinor')::bigint = 100000 AND (v->>'changeMinor')::bigint = 0
      AND public.t4490f5_pays(v_sale) = 1 AND public.t4490f5_v(v_sale) = v_v0,
    'F5-P6 a true retry (same id and facts, the old version) answers the ORIGINAL payment: 1,000.00, nothing new');
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 175000, 0, 175000,
    '44900605-0000-4000-8000-000000000002', NULL, v_b, v_v0);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean = false AND (v->>'amountMinor')::bigint = 175000
      AND (v->>'salePaid')::boolean AND public.t4490f5_pays(v_sale) = 2
      AND (SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paid'
      AND (SELECT paid_minor FROM public.venue_till_sales WHERE id = v_sale) = 275000,
    'F5-P7 the rest with its own id is taken: two rows, the check paid 2,750.00');
  INSERT INTO t4490f5_ids VALUES ('part_sale', v_sale), ('p1', v_p1),
    ('p2', (v->>'paymentId')::uuid), ('req_a', v_a);
  -- A request id names a payment on ITS check only; another check never answers it.
  v_other := public.t4490f5_check('f5-other-check', 'Other');
  v := public.issue_4490_till_take_payment(v_other, 'cash', 275000, 0, 275000,
    '44900605-0000-4000-8000-000000000002', NULL, v_a, public.t4490f5_v(v_other));
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean = false AND (v->>'amountMinor')::bigint = 275000,
    'F5-P8 the same id on another check is that check''s own payment (ids are per check)');
END
$part$;
SELECT public.t4490f5_reset();

-- -------------------------------------------------------------------------
-- 2. Refunds of a payment: a request id is one refund on the check.
-- -------------------------------------------------------------------------
SELECT public.t4490f5_service();
DO $refund$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f5_id('part_sale');
  v_r uuid := '44900605-0000-4000-c000-0000000000a1';
  v_paid_state text;
BEGIN
  v := public.issue_4490_till_refund(public.t4490f5_id('p1'), 50000, 0, 'Guest asked', false,
    '44900605-0000-4000-8000-000000000004', NULL, v_r);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean = false AND (v->>'amountMinor')::bigint = 50000
      AND public.t4490f5_refunds(v_sale) = 1,
    'F5-R1 a refund of 500.00 answers the amount it recorded');
  SELECT state INTO v_paid_state FROM public.venue_till_payments WHERE id = public.t4490f5_id('p1');
  PERFORM public.t4490f5_expect(
    format($q$SELECT public.issue_4490_till_refund(%L, 60000, 0, 'Guest asked', false,
      '44900605-0000-4000-8000-000000000004', NULL, %L)$q$, public.t4490f5_id('p1'), v_r),
    'PT409', 'till_request_reused', 'F5-R2 a second, different refund with the same id is refused, never shown as done');
  PERFORM public.t4490f5_expect(
    format($q$SELECT public.issue_4490_till_refund(%L, 50000, 0, 'Guest asked', false,
      '44900605-0000-4000-8000-000000000004', NULL, %L)$q$, public.t4490f5_id('p2'), v_r),
    'PT409', 'till_request_reused', 'F5-R3 the same id for a refund of ANOTHER payment on the check is refused');
  PERFORM public.t4490f5_ok(public.t4490f5_refunds(v_sale) = 1
      AND (SELECT sum(r.amount_minor) FROM public.venue_till_refunds r JOIN public.venue_till_payments p ON p.id = r.payment_id
           WHERE p.sale_id = v_sale) = 50000
      AND (SELECT state FROM public.venue_till_payments WHERE id = public.t4490f5_id('p1')) = v_paid_state,
    'F5-R4 ... and nothing moved: one refund of 500.00');
  v := public.issue_4490_till_refund(public.t4490f5_id('p1'), 50000, 0, 'Another reason', false,
    '44900605-0000-4000-8000-000000000004', NULL, v_r);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean AND (v->>'amountMinor')::bigint = 50000
      AND public.t4490f5_refunds(v_sale) = 1,
    'F5-R5 a true retry of the refund (same payment and amount) answers the original 500.00 refund');
  -- The payment's id cannot be a refund's either way round.
  v := public.issue_4490_till_refund(public.t4490f5_id('p1'), 10000, 0, 'Guest asked', false,
    '44900605-0000-4000-8000-000000000004', NULL, public.t4490f5_id('req_a'));
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean = false AND public.t4490f5_refunds(v_sale) = 2,
    'F5-R6 payment ids and refund ids are separate: a refund may carry any fresh id');
END
$refund$;
SELECT public.t4490f5_reset();

-- -------------------------------------------------------------------------
-- 3. Line refunds (two entry lines on one check).
-- -------------------------------------------------------------------------
SELECT public.t4490f5_service();
DO $lines$
DECLARE
  v jsonb;
  v_sale uuid;
  v_l1 uuid;
  v_l2 uuid;
  v_pay uuid;
  v_l uuid := '44900605-0000-4000-c000-0000000000b1';
BEGIN
  v := public.issue_4490_till_open('44900605-0000-4000-9000-0000000000a1',
    '44900605-0000-4000-8000-000000000002', NULL, 'Entries', NULL, 'f5-open-entries');
  v_sale := (v->>'id')::uuid;
  v := public.issue_4490_till_add_offer_line(v_sale, public.t4490f5_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f5_id('option'), 'guests', 1)),
    '44900605-0000-4000-8000-000000000002', 'f5-entry-1');
  v := public.issue_4490_till_add_offer_line(v_sale, public.t4490f5_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f5_id('option'), 'guests', 1)),
    '44900605-0000-4000-8000-000000000002', 'f5-entry-2');
  SELECT (array_agg((l->>'id')::uuid ORDER BY l->>'id'))[1], (array_agg((l->>'id')::uuid ORDER BY l->>'id'))[2]
  INTO v_l1, v_l2 FROM jsonb_array_elements(v->'lines') l;
  v := public.issue_4490_till_take_payment(v_sale, 'cash', (v->>'totalDueMinor')::bigint, 0, (v->>'totalDueMinor')::bigint,
    '44900605-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f5_v(v_sale));
  v_pay := (v->>'paymentId')::uuid;
  v := public.issue_4490_till_refund_line(v_l1, '44900605-0000-4000-8000-000000000004', NULL, 'Guest asked', v_l);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean = false AND (v->>'refundedMinor')::bigint = 500000,
    'F5-L1 fixture: the first entry line is refunded in full (5,000.00)');
  PERFORM public.t4490f5_expect(
    format($q$SELECT public.issue_4490_till_refund_line(%L, '44900605-0000-4000-8000-000000000004', NULL, 'Guest asked', %L)$q$,
      v_l2, v_l),
    'PT409', 'till_request_reused', 'F5-L2 the same id for the OTHER line is refused (the second entry is not shown refunded)');
  PERFORM public.t4490f5_ok((SELECT state FROM public.venue_till_lines WHERE id = v_l2) = 'committed'
      AND public.t4490f5_refunds(v_sale) = 1,
    'F5-L3 ... and the second line and its money are untouched');
  PERFORM public.t4490f5_expect(
    format($q$SELECT public.issue_4490_till_refund(%L, 1000, 0, 'Guest asked', false,
      '44900605-0000-4000-8000-000000000004', NULL, %L)$q$, v_pay, v_l),
    'PT409', 'till_request_reused', 'F5-L4 a line refund''s id cannot be reused for an amount refund');
  v := public.issue_4490_till_refund_line(v_l1, '44900605-0000-4000-8000-000000000004', NULL, 'Guest asked', v_l);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean AND (v->>'refundedMinor')::bigint = 500000
      AND public.t4490f5_refunds(v_sale) = 1,
    'F5-L5 a true retry of the line refund answers what it took (5,000.00), nothing new');
END
$lines$;
SELECT public.t4490f5_reset();

-- -------------------------------------------------------------------------
-- 4. Card starts (scan / tap) and a card refund.
-- -------------------------------------------------------------------------
SELECT public.t4490f5_service();
DO $card$
DECLARE
  v jsonb;
  v_prep jsonb;
  v_sale uuid := public.t4490f5_check('f5-card-check', 'Card');
  v_s uuid := '44900605-0000-4000-c000-0000000000c1';
  v_payment uuid;
BEGIN
  v_prep := public.issue_4490_till_card_prepare(v_sale, '44900605-0000-4000-8000-000000000002', public.t4490f5_v(v_sale));
  v := public.issue_4490_till_card_start(v_sale, 'scan', 0, '44900605-0000-4000-8000-000000000002', NULL, v_s,
    (v_prep->>'version')::integer,
    jsonb_build_object('provider', 'paystack', 'currency', 'NGN',
      'subtotalCents', (v_prep->>'amountMinor')::bigint - (v_prep->>'serviceChargeMinor')::bigint,
      'serviceChargeCents', (v_prep->>'serviceChargeMinor')::bigint, 'tipCents', 0,
      'effectiveTakeRateBps', 150, 'serviceFeeBps', 300, 'minglaFeeCents', 4125, 'platformServiceFeeCents', 8250,
      'passMinglaFee', false, 'passServiceFee', false, 'passTax', false,
      'buyerSubtotalCents', (v_prep->>'amountMinor')::bigint, 'taxAmountCents', 0,
      'totalCents', (v_prep->>'amountMinor')::bigint, 'pricingBreakdown', '{}'::jsonb),
    'Q5AAAAAA');
  v_payment := (v->>'paymentId')::uuid;
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean = false AND v->>'state' = 'pending',
    'F5-C0 fixture: a scan code for everything left (2,750.00)');
  v := public.t4490f5_card_replay(v_sale, 'scan', 0, v_s);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean AND (v->>'paymentId')::uuid = v_payment
      AND (v->>'amountMinor')::bigint = 275000 AND v->>'code' = 'Q5AAAAAA',
    'F5-C1 the same scan start again answers the code it made (its own amount, its own code)');
  PERFORM public.t4490f5_expect(format($q$SELECT public.t4490f5_card_replay(%L, 'scan', 27500, %L)$q$, v_sale, v_s),
    'PT409', 'till_request_reused', 'F5-C2 the same id with another tip is refused (was answered as the first code)');
  PERFORM public.t4490f5_expect(format($q$SELECT public.t4490f5_card_replay(%L, 'tap', 0, %L)$q$, v_sale, v_s),
    'PT409', 'till_request_reused', 'F5-C3 the same id with another card method is refused');
  PERFORM public.t4490f5_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 275000, 0, 275000,
      '44900605-0000-4000-8000-000000000002', NULL, %L, %s)$q$, v_sale, v_s, public.t4490f5_v(v_sale)),
    'PT409', 'till_request_reused', 'F5-C4 a scan code''s id sent for cash is refused (never "Payment taken")');
  PERFORM public.t4490f5_ok(public.t4490f5_pays(v_sale) = 1,
    'F5-C5 ... none of them wrote a payment');
  -- The guest pays the code (the carrier lands as the webhook would land it).
  UPDATE public.venue_orders SET payment_status = 'paid', confirmed_at = now()
  WHERE id = (SELECT carrier_order_id FROM public.venue_till_payments WHERE id = v_payment);
  PERFORM public.issue_4490_till_apply_payment(v_payment);
  INSERT INTO t4490f5_ids VALUES ('card_payment', v_payment), ('card_sale', v_sale);
END
$card$;
SELECT public.t4490f5_reset();
SELECT public.t4490f5_service();
DO $card_refund$
DECLARE
  v jsonb;
  v_k uuid := '44900605-0000-4000-c000-0000000000c2';
BEGIN
  v := public.issue_4490_till_mint_carrier_refund(public.t4490f5_id('card_payment'), 100000, 0,
    '44900605-0000-4000-8000-000000000004', NULL, 'Guest asked', v_k);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean = false AND (v->>'amountMinor')::bigint = 100000,
    'F5-K1 a card refund of 1,000.00 is minted');
  PERFORM public.t4490f5_expect(
    format($q$SELECT public.issue_4490_till_mint_carrier_refund(%L, 150000, 0,
      '44900605-0000-4000-8000-000000000004', NULL, 'Guest asked', %L)$q$, public.t4490f5_id('card_payment'), v_k),
    'PT409', 'till_request_reused', 'F5-K2 the same id with another card refund amount is refused');
  v := public.issue_4490_till_mint_carrier_refund(public.t4490f5_id('card_payment'), 100000, 0,
    '44900605-0000-4000-8000-000000000004', NULL, 'Guest asked', v_k);
  PERFORM public.t4490f5_ok((v->>'replayed')::boolean AND (v->>'amountMinor')::bigint = 100000
      AND public.t4490f5_refunds(public.t4490f5_id('card_sale')) = 1
      AND (SELECT count(*) FROM public.source_refunds WHERE source_id =
           (SELECT carrier_order_id FROM public.venue_till_payments WHERE id = public.t4490f5_id('card_payment'))) = 1,
    'F5-K3 a true retry answers the original 1,000.00 card refund; one refund row, one source refund');
END
$card_refund$;
SELECT public.t4490f5_reset();

-- -------------------------------------------------------------------------
-- 5. Privileges and the untouched finalizers.
-- -------------------------------------------------------------------------
SELECT public.t4490f5_ok(
  NOT has_function_privilege('authenticated', 'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_card_start(uuid,text,bigint,uuid,uuid,uuid,integer,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_refund(uuid,bigint,bigint,text,boolean,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_mint_carrier_refund(uuid,bigint,bigint,uuid,uuid,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_refund_line(uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)', 'EXECUTE'),
  'F5-G1 the five patched functions stay service-role only');
SELECT public.t4490f5_ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
   FROM pg_proc p WHERE p.oid = 'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)'::regprocedure),
  'F5-G2 take_payment is still SECURITY DEFINER with an empty search_path');

ROLLBACK;
