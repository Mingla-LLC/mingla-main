-- #4490 spec 08 O1 part 2: executable PostgreSQL 17 proof for migration
-- 20281203534490 (the held-round sweep, the reprice no longer adopting a held
-- round, and one card refund per card payment on its carrier).
-- The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-HELD-ROUND-SWEEP | issue #4490 | a Till round inserted held that never joined a check (no venue_till_lines row) is cancelled by issue_4490_till_sweep_held_rounds after 10 minutes; a paid, sent, attached or carrier row is never touched, and a held round joins a check only through issue_4490_till_attach_round.
-- MINGLA-INVARIANT: I-4490-TILL-ONE-CARD-REFUND | issue #4490 | a tap or scan Till payment takes at most one card refund (refund kind venue_till_refund on its carrier, fee reversed pro rata); anything further is paid back in cash and recorded.
--
-- FAILS-ON-REVERT: without 20281203534490 the first assertion fails (no
-- issue_4490_till_sweep_held_rounds).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490p2_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490P2 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490p2_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490P2 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490P2 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490p2_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490p2_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490p2_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490p2_ok(boolean,text), public.t4490p2_expect(text,text,text,text),
  public.t4490p2_as(uuid), public.t4490p2_service(), public.t4490p2_reset() TO PUBLIC;
CREATE TEMP TABLE t4490p2_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490p2_ids TO PUBLIC;
CREATE FUNCTION public.t4490p2_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490p2_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490p2_id(text) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 03 finance manager.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900300-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-p2-' || n || '@example.test', now(), now()
FROM generate_series(1, 3) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44900300-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900300-0000-4000-9000-000000000010', '44900300-0000-4000-8000-000000000001',
   'Till Part 2 4490', 'till-p2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900300-0000-4000-9000-0000000000a1', '44900300-0000-4000-9000-000000000010', 'tillp2a', 'Part Two Bar',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900300-0000-4000-a000-000000000002', '44900300-0000-4000-9000-000000000010', '44900300-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900300-0000-4000-a000-000000000003', '44900300-0000-4000-9000-000000000010', '44900300-0000-4000-8000-000000000003', 'finance_manager', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900300-0000-4000-a000-000000000002', '44900300-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900300-0000-4000-b000-000000000001', '44900300-0000-4000-9000-000000000010', '44900300-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900300-0000-4000-b000-000000000011', '44900300-0000-4000-b000-000000000001', '44900300-0000-4000-9000-000000000010', 'Chapman', 250000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900300-0000-4000-9000-0000000000a1', '44900300-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;
SELECT public.t4490p2_as('44900300-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900300-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'p2-till-on');
SELECT public.t4490p2_reset();

-- A staff round on a session, as the edge inserts it (held unless told).
-- TEST-MOD-APPROVED #4490 (flake fix): allocate repeatable codes from a
-- fixture-owned sequence. random() could reuse a live code and trip
-- venue_orders_live_pickup_code_uniq before the assertions ran.
CREATE SEQUENCE public.t4490p2_pickup START 101 MAXVALUE 899 NO CYCLE;
GRANT USAGE ON SEQUENCE public.t4490p2_pickup TO PUBLIC;
CREATE FUNCTION public.t4490p2_round(p_session uuid, p_status text, p_age interval)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata, created_at
  ) VALUES (
    v_order, p_session, '44900300-0000-4000-9000-000000000010', '44900300-0000-4000-9000-0000000000a1', 'staff',
    '44900300-0000-4000-8000-000000000002', lpad(nextval('public.t4490p2_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 250000, 250000, 0, 1000, 25000, 0, 0, 0, false, false, false,
    275000, 275000, 'pending', p_status, 'till-p2-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true), now() - p_age);
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900300-0000-4000-b000-000000000011', 1, 'Chapman', 250000, 'NGN', 1, 0, 250000);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490p2_round(uuid, text, interval) TO PUBLIC;

-- -------------------------------------------------------------------------
-- 1. The held-round sweep.
-- -------------------------------------------------------------------------
SELECT public.t4490p2_service();
DO $sweep$
DECLARE
  v jsonb;
  v_sale uuid;
  v_session uuid;
  v_orphan_old uuid;
  v_orphan_young uuid;
  v_attached_old uuid;
  v_sent_old uuid;
  v_orphan_two uuid;
BEGIN
  v := public.issue_4490_till_open('44900300-0000-4000-9000-0000000000a1',
    '44900300-0000-4000-8000-000000000002', NULL, 'Sweep', NULL, 'p2-open-sweep');
  v_sale := (v->>'id')::uuid;
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  v_attached_old := public.t4490p2_round(v_session, 'held', interval '30 minutes');
  PERFORM public.issue_4490_till_attach_round(v_sale, v_attached_old, '44900300-0000-4000-8000-000000000002', NULL);
  v_orphan_old := public.t4490p2_round(v_session, 'held', interval '11 minutes');
  v_orphan_two := public.t4490p2_round(v_session, 'held', interval '12 minutes');
  v_orphan_young := public.t4490p2_round(v_session, 'held', interval '9 minutes');
  -- A later attach on the same check reprices it: a held round is no longer adopted.
  PERFORM public.issue_4490_till_attach_round(v_sale,
    public.t4490p2_round(v_session, 'held', interval '0 minutes'), '44900300-0000-4000-8000-000000000002', NULL);
  PERFORM public.t4490p2_ok(NOT EXISTS (SELECT 1 FROM public.venue_till_lines
        WHERE venue_order_id IN (v_orphan_old, v_orphan_two, v_orphan_young)),
    'P2-SW1 the reprice never adopts a held round; only attach_round adds one');
  v_sent_old := public.t4490p2_round(v_session, 'placed', interval '40 minutes');
  PERFORM public.issue_4490_till_reprice(v_sale);
  PERFORM public.t4490p2_ok(EXISTS (SELECT 1 FROM public.venue_till_lines WHERE venue_order_id = v_sent_old),
    'P2-SW2 a sent (placed) round an older app added to the tab is still adopted (T18 unchanged)');
  INSERT INTO t4490p2_ids VALUES ('sweep_sale', v_sale);

  v := public.issue_4490_till_sweep_held_rounds(1);
  PERFORM public.t4490p2_ok((v->>'cancelled')::int = 1
      AND (SELECT fulfillment_status FROM public.venue_orders WHERE id = v_orphan_two) = 'cancelled'
      AND (SELECT fulfillment_status FROM public.venue_orders WHERE id = v_orphan_old) = 'held',
    'P2-SW3 the sweep is bounded (limit 1 takes the oldest stale round only)');
  v := public.issue_4490_till_sweep_held_rounds(200);
  PERFORM public.t4490p2_ok((v->>'cancelled')::int = 1
      AND (SELECT fulfillment_status = 'cancelled' AND payment_status = 'cancelled' AND cancelled_at IS NOT NULL
             AND (metadata->>'till_held_swept')::boolean
           FROM public.venue_orders WHERE id = v_orphan_old),
    'P2-SW4 a held round that never joined a check within 10 minutes is cancelled');
  PERFORM public.t4490p2_ok(
    (SELECT fulfillment_status FROM public.venue_orders WHERE id = v_orphan_young) = 'held'
    AND (SELECT fulfillment_status FROM public.venue_orders WHERE id = v_attached_old) = 'held'
    AND (SELECT fulfillment_status FROM public.venue_orders WHERE id = v_sent_old) = 'placed',
    'P2-SW5 a younger orphan, an attached held round and a sent round are untouched');
  v := public.issue_4490_till_sweep_held_rounds(200);
  PERFORM public.t4490p2_ok((v->>'cancelled')::int = 0, 'P2-SW6 a second run changes nothing (idempotent)');
END
$sweep$;
SELECT public.t4490p2_reset();
SELECT public.t4490p2_ok(
  NOT has_function_privilege('authenticated', 'public.issue_4490_till_sweep_held_rounds(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_sweep_held_rounds(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_mint_carrier_refund(uuid,bigint,bigint,uuid,uuid,text,uuid)', 'EXECUTE'),
  'P2-G1 the sweep and the card refund mint are service-role only');

-- -------------------------------------------------------------------------
-- 2. One card refund per card payment.
-- -------------------------------------------------------------------------
-- A card payment as tap / scan will record it (O2): a carrier venue order on
-- the Mingla rail, paid, and the Till payment that rides on it.
SELECT public.t4490p2_service();
DO $card$
DECLARE
  v jsonb;
  v_sale uuid;
  v_session uuid;
  v_round uuid;
  v_carrier uuid := gen_random_uuid();
  v_payment uuid := gen_random_uuid();
  v_cash_sale uuid;
  v_cash_payment uuid;
BEGIN
  v := public.issue_4490_till_open('44900300-0000-4000-9000-0000000000a1',
    '44900300-0000-4000-8000-000000000002', NULL, 'Card', NULL, 'p2-open-card');
  v_sale := (v->>'id')::uuid;
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  v_round := public.t4490p2_round(v_session, 'held', interval '0 minutes');
  PERFORM public.issue_4490_till_attach_round(v_sale, v_round, '44900300-0000-4000-8000-000000000002', NULL);
  PERFORM public.issue_4490_till_send(v_sale, '44900300-0000-4000-8000-000000000002');
  -- 2,500.00 + 250.00 service; Mingla fee 5% of 2,750.00 = 137.50. The two
  -- foreign keys between a payment and its carrier are not deferrable, so the
  -- carrier is written first (pending, payment_only), then the payment, then
  -- the link; the reprice never adopts the carrier as a round.
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code, buyer_name,
    money_path, provider, paystack_reference, currency, subtotal_cents, discount_cents, service_charge_bps,
    service_charge_cents, tip_cents, effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents,
    tax_amount_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_carrier, v_session, '44900300-0000-4000-9000-000000000010', '44900300-0000-4000-9000-0000000000a1', 'staff',
    '44900300-0000-4000-8000-000000000002', '901', 'Card', 'mingla', 'paystack', 'mingla_vo_' || v_carrier,
    'NGN', 250000, 0, 0, 25000, 0, 500, 0, 13750, 0, false, false, false, 275000, 0, 275000,
    'pending', 'payment_only', 'till-p2-carrier:' || v_carrier, '{}'::jsonb);
  PERFORM public.t4490p2_ok(NOT EXISTS (SELECT 1 FROM public.venue_till_lines WHERE venue_order_id = v_carrier),
    'P2-CR00 a carrier written before its payment link is never adopted as a round');
  INSERT INTO public.venue_till_payments (id, sale_id, method, amount_minor, service_charge_minor, tip_minor,
    charged_minor, state, carrier_order_id, taken_by_user_id, device_user_id, server_user_id, client_request_id)
  VALUES (v_payment, v_sale, 'tap', 275000, 25000, 0, 275000, 'pending', v_carrier,
    '44900300-0000-4000-8000-000000000002', '44900300-0000-4000-8000-000000000002',
    '44900300-0000-4000-8000-000000000002', gen_random_uuid());
  UPDATE public.venue_orders SET till_payment_id = v_payment, payment_status = 'paid', confirmed_at = now()
  WHERE id = v_carrier;
  PERFORM public.issue_4490_till_apply_payment(v_payment);
  INSERT INTO t4490p2_ids VALUES ('card_sale', v_sale), ('carrier', v_carrier), ('card_payment', v_payment);
  PERFORM public.t4490p2_ok((SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paid',
    'P2-CR0 fixture: the card check is paid by its tap payment');

  -- A cash sale, to prove the mint refuses non-card payments.
  v := public.issue_4490_till_open('44900300-0000-4000-9000-0000000000a1',
    '44900300-0000-4000-8000-000000000002', NULL, 'Cash', NULL, 'p2-open-cash');
  v_cash_sale := (v->>'id')::uuid;
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_cash_sale;
  PERFORM public.issue_4490_till_attach_round(v_cash_sale, public.t4490p2_round(v_session, 'held', interval '0 minutes'),
    '44900300-0000-4000-8000-000000000002', NULL);
  v := public.issue_4490_till_take_payment(v_cash_sale, 'cash', 275000, 0, 275000,
    '44900300-0000-4000-8000-000000000002', '44900300-0000-4000-8000-000000000002', gen_random_uuid(),
    (SELECT version FROM public.venue_till_sales WHERE id = v_cash_sale));
  INSERT INTO t4490p2_ids VALUES ('cash_payment', (v->>'paymentId')::uuid);
END
$card$;
SELECT public.t4490p2_expect(
  format($q$SELECT public.issue_4490_till_mint_carrier_refund(%L, 100000, 0, '44900300-0000-4000-8000-000000000002',
    NULL, 'Guest asked', gen_random_uuid())$q$, public.t4490p2_id('card_payment')),
  '42501', 'not_authorized', 'P2-CR1 a seller without money rights cannot refund a card payment');
SELECT public.t4490p2_expect(
  format($q$SELECT public.issue_4490_till_mint_carrier_refund(%L, 300000, 0, '44900300-0000-4000-8000-000000000001',
    NULL, 'Guest asked', gen_random_uuid())$q$, public.t4490p2_id('card_payment')),
  '22023', 'till_refund_over_paid', 'P2-CR2 a refund above the payment is refused and mints nothing');
SELECT public.t4490p2_expect(
  format($q$SELECT public.issue_4490_till_mint_carrier_refund(%L, 1000, 0, '44900300-0000-4000-8000-000000000001',
    NULL, 'Guest asked', gen_random_uuid())$q$, public.t4490p2_id('cash_payment')),
  'PT409', 'till_refund_method_unavailable', 'P2-CR3 a cash payment is not refunded to a card');
SELECT public.t4490p2_expect(
  format($q$SELECT public.issue_4490_till_refund(%L, 1000, 0, 'Guest asked', false, '44900300-0000-4000-8000-000000000001',
    NULL, gen_random_uuid())$q$, public.t4490p2_id('card_payment')),
  'PT409', 'till_refund_method_unavailable', 'P2-CR4 the cash refund path refuses a card payment');
DO $mint$
DECLARE
  v jsonb;
  v2 jsonb;
  v_req uuid := '44900300-0000-4000-c000-000000000001';
  r public.source_refunds%ROWTYPE;
BEGIN
  -- A finance manager (money rights, no sell rights) refunds part of it.
  v := public.issue_4490_till_mint_carrier_refund(public.t4490p2_id('card_payment'), 100000, 0,
    '44900300-0000-4000-8000-000000000003', NULL, 'Guest asked', v_req);
  SELECT * INTO r FROM public.source_refunds WHERE id = (v->>'sourceRefundId')::uuid;
  -- Fee back pro rata: 137.50 x 1,000.00 / 2,750.00 = 50.00.
  PERFORM public.t4490p2_ok(r.refund_kind = 'venue_till_refund' AND r.source_type = 'venue_menu_order'
      AND r.source_id = public.t4490p2_id('carrier') AND r.buyer_refund_requested_cents = 100000
      AND r.original_charge_cents = 275000 AND r.fee_reversal_required_cents = 5000
      AND r.platform_fee_absorption_cents = 5000 AND r.organizer_refund_liability_cents = 95000
      AND r.provider = 'paystack' AND r.fee_leg_kind = 'paystack_ledger_allocation'
      AND (SELECT count(*) FROM public.source_refund_ledger_allocations a WHERE a.refund_id = r.id) = 3,
    'P2-CR5 a money-rights member mints one amount-aware card refund, fee reversed pro rata');
  PERFORM public.t4490p2_ok(
    (SELECT source_refund_id = r.id AND amount_minor = 100000 AND method = 'tap'
     FROM public.venue_till_refunds WHERE id = (v->>'refundId')::uuid)
    AND (SELECT state FROM public.venue_till_payments WHERE id = public.t4490p2_id('card_payment')) = 'partially_refunded'
    AND (SELECT state FROM public.venue_till_sales WHERE id = public.t4490p2_id('card_sale')) = 'partially_refunded',
    'P2-CR6 the Till records the refund against the payment and the check');
  v2 := public.issue_4490_till_mint_carrier_refund(public.t4490p2_id('card_payment'), 100000, 0,
    '44900300-0000-4000-8000-000000000003', NULL, 'Guest asked', v_req);
  PERFORM public.t4490p2_ok((v2->>'replayed')::boolean AND v2->>'sourceRefundId' = v->>'sourceRefundId'
      AND (SELECT count(*) FROM public.source_refunds WHERE source_id = public.t4490p2_id('carrier')) = 1,
    'P2-CR7 a retried tap returns the same refund and mints nothing new');
END
$mint$;
SELECT public.t4490p2_expect(
  format($q$SELECT public.issue_4490_till_mint_carrier_refund(%L, 50000, 0, '44900300-0000-4000-8000-000000000001',
    NULL, 'Guest asked', gen_random_uuid())$q$, public.t4490p2_id('card_payment')),
  'PT409', 'till_card_refunded_once', 'P2-CR8 a second card refund on the same payment is refused (pay the rest in cash)');
SELECT public.t4490p2_reset();

ROLLBACK;
