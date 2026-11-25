-- #4490 spec 08 O2 fix round 1: executable PostgreSQL 17 proof for migration
-- 20281203574490 (the money test's O2-T1, T2, T3, T4). The suite owns its
-- fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-STALE-PAYMENT-LETS-GO | issue #4490 | a pay code past its expires_at, or a pending tap payment with no PaymentIntent older than the 15-minute tap window, never stops cash, own machine, adding to the check or a new card payment (issue_4490_till_release_stale runs first); a live code and a tap with a PaymentIntent are never released; money that lands on a released code is late money, recorded once.
-- MINGLA-INVARIANT: I-4490-TILL-SWITCH-NEVER-STRANDS-MONEY | issue #4490 | with the Till switched off staff cannot read or text a pay code (till_not_enabled for every role), but a live card payment can still be cancelled by anyone who may sell there and money in flight still lands.
-- MINGLA-INVARIANT: I-4490-TILL-TEXT-WINDOWS | issue #4490 | at most issue_4490_till_text_limits() pay-link texts to one number per venue and per seller in any rolling hour (default 6 and 30), on top of three per code; a refusal writes nothing.
-- MINGLA-INVARIANT: I-4490-TILL-GUESS-BUDGET | issue #4490 | unknown pay-code answers share one global per-minute budget keyed on nothing a caller sends.
--
-- FAILS-ON-REVERT: without 20281203574490 the first check fails (cash on a
-- check whose code expired unwatched answers till_payment_in_progress).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490f1_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490F1 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490f1_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490F1 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490F1 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490f1_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490f1_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490f1_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_ok(boolean,text), public.t4490f1_expect(text,text,text,text),
  public.t4490f1_as(uuid), public.t4490f1_service(), public.t4490f1_reset() TO PUBLIC;
-- Test-only writes the suite needs as the superuser (time travel, the switch).
CREATE FUNCTION public.t4490f1_till(p_on boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  UPDATE public.feature_flags SET is_enabled = p_on WHERE flag_key = 'VENUE_TILL'
$f$;
CREATE FUNCTION public.t4490f1_expire(p_code text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  UPDATE public.venue_till_pay_codes SET expires_at = now() - interval '1 minute' WHERE code = p_code
$f$;
CREATE FUNCTION public.t4490f1_age_payment(p_payment uuid, p_age interval) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  UPDATE public.venue_till_payments SET created_at = now() - p_age WHERE id = p_payment
$f$;
CREATE FUNCTION public.t4490f1_age_texts(p_age interval) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  UPDATE public.venue_till_pay_link_texts SET created_at = created_at - p_age
$f$;
CREATE FUNCTION public.t4490f1_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_till(boolean), public.t4490f1_expire(text),
  public.t4490f1_age_payment(uuid, interval), public.t4490f1_age_texts(interval), public.t4490f1_v(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 03 door staff (venue.check_in), 04 a second seller, 05 a stranger.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900900-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-o2f1-' || n || '@example.test', now(), now()
FROM generate_series(1, 5) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44900900-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000001',
   'Till O2 fix 4490', 'till-o2f1-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900900-0000-4000-9000-0000000000a1', '44900900-0000-4000-9000-000000000010', 'tillo2f1a', 'O2 Fix Club',
   6.45, 3.40, 'club', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900900-0000-4000-a000-000000000002', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900900-0000-4000-a000-000000000003', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44900900-0000-4000-a000-000000000004', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-8000-000000000004', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900900-0000-4000-a000-000000000002', '44900900-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900900-0000-4000-a000-000000000003', '44900900-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']),
  ('44900900-0000-4000-a000-000000000004', '44900900-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900900-0000-4000-b000-000000000001', '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900900-0000-4000-b000-000000000011', '44900900-0000-4000-b000-000000000001', '44900900-0000-4000-9000-000000000010', 'Chapman', 250000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900900-0000-4000-9000-0000000000a1', '44900900-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;
SELECT public.t4490f1_as('44900900-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900900-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'o2f1-till-on');
SELECT public.t4490f1_reset();

CREATE SEQUENCE public.t4490f1_pickup START 301;
GRANT USAGE ON SEQUENCE public.t4490f1_pickup TO PUBLIC;
-- A staff round as the Till inserts it (held): 1 x Chapman 2,500.00 + 10% = 2,750.00.
CREATE FUNCTION public.t4490f1_round(p_session uuid, p_actor uuid)
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
    v_order, p_session, '44900900-0000-4000-9000-000000000010', '44900900-0000-4000-9000-0000000000a1', 'staff',
    p_actor, lpad(nextval('public.t4490f1_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 250000, 250000, 0, 1000, 25000, 0, 0, 0, false, false, false,
    275000, 275000, 'pending', 'held', 'till-o2f1-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900900-0000-4000-b000-000000000011', 1, 'Chapman', 250000, 'NGN', 1, 0, 250000);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_round(uuid, uuid) TO PUBLIC;
CREATE FUNCTION public.t4490f1_check(p_key text, p_label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb; v_sale uuid; v_session uuid;
BEGIN
  v := public.issue_4490_till_open('44900900-0000-4000-9000-0000000000a1',
    '44900900-0000-4000-8000-000000000002', NULL, p_label, NULL, p_key);
  v_sale := (v->>'id')::uuid;
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  PERFORM public.issue_4490_till_attach_round(v_sale,
    public.t4490f1_round(v_session, '44900900-0000-4000-8000-000000000002'),
    '44900900-0000-4000-8000-000000000002', NULL);
  RETURN v_sale;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_check(text, text) TO PUBLIC;
CREATE FUNCTION public.t4490f1_session(p_sale uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT session_id FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_session(uuid) TO PUBLIC;
-- The priced carrier the edge sends (computeVenueOrderMoney shape).
CREATE FUNCTION public.t4490f1_money(p_amount bigint, p_sc bigint, p_tip bigint, p_provider text DEFAULT 'paystack')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object('provider', p_provider,
    'stripeAccountId', CASE WHEN p_provider = 'stripe' THEN 'acct_o2f1test' END, 'currency', 'NGN',
    'subtotalCents', p_amount - p_sc, 'serviceChargeCents', p_sc, 'tipCents', p_tip,
    'effectiveTakeRateBps', 150, 'serviceFeeBps', 300,
    'minglaFeeCents', round(p_amount::numeric * 150 / 10000), 'platformServiceFeeCents', round(p_amount::numeric * 300 / 10000),
    'passMinglaFee', false, 'passServiceFee', false, 'passTax', false,
    'buyerSubtotalCents', p_amount, 'taxAmountCents', 0, 'totalCents', p_amount + p_tip,
    'pricingBreakdown', '{}'::jsonb)
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_money(bigint, bigint, bigint, text) TO PUBLIC;
-- prepare + start as the edge does.
CREATE FUNCTION public.t4490f1_start(p_sale uuid, p_method text, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_card_prepare(p_sale, '44900900-0000-4000-8000-000000000002', public.t4490f1_v(p_sale));
  RETURN public.issue_4490_till_card_start(p_sale, p_method, 0, '44900900-0000-4000-8000-000000000002', NULL,
    gen_random_uuid(), (v->>'version')::integer,
    public.t4490f1_money((v->>'amountMinor')::bigint, (v->>'serviceChargeMinor')::bigint, 0,
      CASE WHEN p_method = 'tap' THEN 'stripe' ELSE 'paystack' END),
    p_code);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_start(uuid, text, text) TO PUBLIC;
CREATE FUNCTION public.t4490f1_cash(p_sale uuid, p_method text DEFAULT 'cash') RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_take_payment(p_sale, p_method, 275000, 0,
    CASE WHEN p_method = 'cash' THEN 275000 END,
    '44900900-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(p_sale))
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_cash(uuid, text) TO PUBLIC;
CREATE FUNCTION public.t4490f1_text(p_code text, p_actor text, p_phone text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_pay_code_text(p_code, '44900900-0000-4000-9000-0000000000a1',
    ('44900900-0000-4000-8000-0000000000' || p_actor)::uuid, p_phone, 'https://example.invalid/pay/till/' || p_code)
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_text(text, text, text) TO PUBLIC;

SELECT public.t4490f1_service();

-- -------------------------------------------------------------------------
-- 1. O2-T4: a code past its time that nobody polls lets go of the check.
-- -------------------------------------------------------------------------
DO $stale_code$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f1_check('o2f1-expired-cash', 'Expired cash');
  v_pay uuid;
  v_car uuid;
BEGIN
  v := public.t4490f1_start(v_sale, 'scan', 'FXAAAAAA');
  v_pay := (v->>'paymentId')::uuid;
  SELECT carrier_order_id INTO v_car FROM public.venue_till_payments WHERE id = v_pay;
  -- Nobody polls it (no status call); its time passes.
  PERFORM public.t4490f1_expire('FXAAAAAA');
  PERFORM public.t4490f1_ok((SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paying'
      AND (SELECT status FROM public.venue_till_pay_codes WHERE code = 'FXAAAAAA') = 'open',
    'F1-X0 fixture: the check still says paying and the code still says open past its time');
  v := public.t4490f1_cash(v_sale);
  PERFORM public.t4490f1_ok(v->'sale'->>'state' = 'paid'
      AND (SELECT state FROM public.venue_till_payments WHERE id = v_pay) = 'cancelled'
      AND (SELECT status FROM public.venue_till_pay_codes WHERE code = 'FXAAAAAA') = 'expired'
      AND (SELECT payment_status FROM public.venue_orders WHERE id = v_car) = 'cancelled',
    'F1-X1 cash for the whole bill works once the code is past its time: the scan payment is cancelled and the code expired');
  -- The guest paid on the old code after all: late money, recorded once.
  UPDATE public.venue_orders SET paystack_reference = 'mingla_vo_o2f1late' WHERE id = v_car;
  v := public.pg_venue_order_finalize_payment(v_car, 'paystack', 275000, 'NGN', 'mingla_vo_o2f1late', '3001', NULL, NULL);
  PERFORM public.t4490f1_ok(v->>'status' = 'finalized' AND (v->>'tillPaidLate')::boolean
      AND (SELECT paid_late AND state = 'paid' FROM public.venue_till_payments WHERE id = v_pay)
      AND (SELECT overpaid_minor = 275000 AND paid_minor = 275000 AND state = 'paid' FROM public.venue_till_sales WHERE id = v_sale),
    'F1-X2 money that still lands on that code is late money: recorded once, paid_late, into overpaid_minor');
  v := public.pg_venue_order_finalize_payment(v_car, 'paystack', 275000, 'NGN', 'mingla_vo_o2f1late', '3001', NULL, NULL);
  PERFORM public.t4490f1_ok(v->>'status' = 'replayed'
      AND (SELECT overpaid_minor FROM public.venue_till_sales WHERE id = v_sale) = 275000
      AND (SELECT count(*) FROM public.venue_till_payments WHERE sale_id = v_sale AND state = 'paid') = 2,
    'F1-X2b the late webhook again changes nothing (cash once, the late payment once)');
END
$stale_code$;

DO $stale_code_more$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f1_check('o2f1-expired-machine', 'Expired machine');
  v_sale2 uuid := public.t4490f1_check('o2f1-expired-add', 'Expired add');
  v_sale3 uuid := public.t4490f1_check('o2f1-live', 'Live code');
  v_expires timestamptz;
BEGIN
  PERFORM public.t4490f1_start(v_sale, 'scan', 'FXBBBBBB');
  PERFORM public.t4490f1_expire('FXBBBBBB');
  v := public.t4490f1_cash(v_sale, 'own_machine');
  PERFORM public.t4490f1_ok(v->'sale'->>'state' = 'paid',
    'F1-X3 the own card machine works once the code is past its time');
  PERFORM public.t4490f1_start(v_sale2, 'scan', 'FXCCCCCC');
  PERFORM public.t4490f1_expire('FXCCCCCC');
  v := public.issue_4490_till_attach_round(v_sale2,
    public.t4490f1_round(public.t4490f1_session(v_sale2), '44900900-0000-4000-8000-000000000002'),
    '44900900-0000-4000-8000-000000000002', public.t4490f1_v(v_sale2));
  PERFORM public.t4490f1_ok(v->>'state' = 'open'
      AND (SELECT count(*) FROM public.venue_till_lines WHERE sale_id = v_sale2 AND kind = 'menu_round') = 2
      AND (SELECT status FROM public.venue_till_pay_codes WHERE code = 'FXCCCCCC') = 'expired',
    'F1-X4 adding to the check works once the code is past its time');
  -- A live, unexpired code still holds the check, and is not shortened.
  PERFORM public.t4490f1_start(v_sale3, 'scan', 'FXDDDDDD');
  SELECT expires_at INTO v_expires FROM public.venue_till_pay_codes WHERE code = 'FXDDDDDD';
  PERFORM public.t4490f1_expect(format($q$SELECT public.t4490f1_cash(%L)$q$, v_sale3),
    'PT409', 'till_payment_in_progress', 'F1-X5 cash is still refused while a code is live');
  PERFORM public.t4490f1_expect(format($q$SELECT public.issue_4490_till_attach_round(%L,
      public.t4490f1_round(public.t4490f1_session(%L), '44900900-0000-4000-8000-000000000002'),
      '44900900-0000-4000-8000-000000000002', NULL)$q$, v_sale3, v_sale3),
    'PT409', 'till_check_closed', 'F1-X5b adding to the check is still refused while a code is live');
  PERFORM public.t4490f1_ok((SELECT status = 'open' AND expires_at = v_expires FROM public.venue_till_pay_codes WHERE code = 'FXDDDDDD')
      AND (SELECT state FROM public.venue_till_sales WHERE id = v_sale3) = 'paying',
    'F1-X5c a live code keeps its status and its time');
END
$stale_code_more$;

-- -------------------------------------------------------------------------
-- 2. O2-T4: a tap that never reached the reader lets go after the tap window.
-- -------------------------------------------------------------------------
DO $stale_tap$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f1_check('o2f1-tap-stale', 'Tap stale');
  v_sale2 uuid := public.t4490f1_check('o2f1-tap-young', 'Tap young');
  v_sale3 uuid := public.t4490f1_check('o2f1-tap-intent', 'Tap with intent');
  v_pay uuid;
  v_pay2 uuid;
  v_pay3 uuid;
  v_req uuid := gen_random_uuid();
BEGIN
  v := public.t4490f1_start(v_sale, 'tap', NULL);
  v_pay := (v->>'paymentId')::uuid;
  -- The app was killed after pay_tap_start; an intent row was made but Stripe never answered.
  INSERT INTO public.door_tap_intents (brand_id, till_payment_id, client_request_id, lines, currency, subtotal_cents,
    fee_cents, total_cents, application_fee_cents, stripe_account_id, created_by)
  VALUES ('44900900-0000-4000-9000-000000000010', v_pay, v_req, jsonb_build_array(jsonb_build_object('kind', 'till_payment')),
    'NGN', 262625, 12375, 275000, 12375, 'acct_o2f1test', '44900900-0000-4000-8000-000000000002');
  PERFORM public.t4490f1_age_payment(v_pay, interval '16 minutes');
  v := public.t4490f1_cash(v_sale);
  PERFORM public.t4490f1_ok(v->'sale'->>'state' = 'paid'
      AND (SELECT state FROM public.venue_till_payments WHERE id = v_pay) = 'cancelled'
      AND (SELECT status FROM public.door_tap_intents WHERE till_payment_id = v_pay) = 'cancelled',
    'F1-T1 a tap with no PaymentIntent older than the tap window is cancelled by the next payment (cash works)');
  v := public.t4490f1_start(v_sale2, 'tap', NULL);
  v_pay2 := (v->>'paymentId')::uuid;
  PERFORM public.t4490f1_age_payment(v_pay2, interval '5 minutes');
  PERFORM public.t4490f1_expect(format($q$SELECT public.t4490f1_cash(%L)$q$, v_sale2),
    'PT409', 'till_payment_in_progress', 'F1-T2 a tap inside its window still holds the check');
  v := public.t4490f1_start(v_sale3, 'tap', NULL);
  v_pay3 := (v->>'paymentId')::uuid;
  INSERT INTO public.door_tap_intents (brand_id, till_payment_id, client_request_id, lines, currency, subtotal_cents,
    fee_cents, total_cents, application_fee_cents, stripe_account_id, stripe_payment_intent_id, created_by)
  VALUES ('44900900-0000-4000-9000-000000000010', v_pay3, gen_random_uuid(), jsonb_build_array(jsonb_build_object('kind', 'till_payment')),
    'NGN', 262625, 12375, 275000, 12375, 'acct_o2f1test', 'pi_o2f1live', '44900900-0000-4000-8000-000000000002');
  PERFORM public.t4490f1_age_payment(v_pay3, interval '3 hours');
  PERFORM public.t4490f1_expect(format($q$SELECT public.t4490f1_cash(%L)$q$, v_sale3),
    'PT409', 'till_payment_in_progress', 'F1-T3 a tap with a PaymentIntent is never released here (the sweep asks Stripe)');
  PERFORM public.t4490f1_ok((SELECT state FROM public.venue_till_payments WHERE id = v_pay3) = 'pending',
    'F1-T3b and its payment stays pending');
  -- A new card payment also lets go of a stale tap.
  PERFORM public.t4490f1_age_payment(v_pay2, interval '20 minutes');
  v := public.t4490f1_start(v_sale2, 'scan', 'FXEEEEEE');
  PERFORM public.t4490f1_ok(v->>'code' = 'FXEEEEEE' AND (SELECT state FROM public.venue_till_payments WHERE id = v_pay2) = 'cancelled',
    'F1-T4 a new scan code works once a stale tap is past the window');
END
$stale_tap$;

-- The offer and balance add paths run the same release first (one helper).
SELECT public.t4490f1_ok(
  pg_get_functiondef('public.issue_4490_till_add_offer_line(uuid,uuid,uuid,jsonb,uuid,text,uuid,integer)'::regprocedure)
    LIKE '%issue_4490_till_release_stale(v_sale.id)%'
  AND pg_get_functiondef('public.issue_4490_till_add_balance_line(uuid,uuid,bigint,uuid,text,integer)'::regprocedure)
    LIKE '%issue_4490_till_release_stale(v_sale.id)%'
  AND pg_get_functiondef('public.issue_4490_till_card_prepare(uuid,uuid,integer)'::regprocedure)
    LIKE '%issue_4490_till_release_stale(v_sale.id)%',
  'F1-X6 adding an offer or a balance and starting a card payment release stale payments first');

-- -------------------------------------------------------------------------
-- 3. O2-T1: the switch closes staff code reads and texts, never a cancel.
-- -------------------------------------------------------------------------
DO $switch$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f1_check('o2f1-switch', 'Switch');
  v_pay uuid;
  v_car uuid;
  r record;
BEGIN
  v := public.t4490f1_start(v_sale, 'scan', 'FXFFFFFF');
  v_pay := (v->>'paymentId')::uuid;
  SELECT carrier_order_id INTO v_car FROM public.venue_till_payments WHERE id = v_pay;
  PERFORM public.t4490f1_till(false);
  FOR r IN SELECT * FROM (VALUES ('01'), ('02'), ('03'), ('05')) AS x(u) LOOP
    PERFORM public.t4490f1_expect(format($q$SELECT public.issue_4490_till_pay_code_status('FXFFFFFF',
        '44900900-0000-4000-9000-0000000000a1', '44900900-0000-4000-8000-0000000000%s')$q$, r.u),
      'P0001', 'till_not_enabled', 'F1-S1 with the Till off the staff code read refuses (user ' || r.u || ')');
    PERFORM public.t4490f1_expect(format($q$SELECT public.t4490f1_text('FXFFFFFF', %L, '+2348031230001')$q$, r.u),
      'P0001', 'till_not_enabled', 'F1-S2 with the Till off texting the link refuses (user ' || r.u || ')');
  END LOOP;
  PERFORM public.t4490f1_ok(NOT EXISTS (SELECT 1 FROM public.venue_till_pay_link_texts)
      AND (SELECT text_link_count FROM public.venue_till_pay_codes WHERE code = 'FXFFFFFF') = 0,
    'F1-S2b a refused text writes nothing');
  v := public.issue_4490_till_pay_code_lookup('FXFFFFFF', '44900900-0000-4000-9000-0000000000a1',
    '44900900-0000-4000-8000-000000000002');
  PERFORM public.t4490f1_ok(v->>'paymentState' = 'pending' AND (v->>'paymentId')::uuid = v_pay,
    'F1-S3 the cancel path can still read the live code with the Till off');
  PERFORM public.t4490f1_expect(format($q$SELECT public.issue_4490_till_card_cancel(%L, '44900900-0000-4000-8000-000000000003')$q$, v_pay),
    '42501', 'not_authorized', 'F1-S4 someone who may not sell still cannot cancel it');
  v := public.issue_4490_till_card_cancel(v_pay, '44900900-0000-4000-8000-000000000002');
  PERFORM public.t4490f1_ok(v->>'state' = 'cancelled' AND v->'sale'->>'state' = 'open'
      AND (SELECT status FROM public.venue_till_pay_codes WHERE code = 'FXFFFFFF') = 'cancelled',
    'F1-S5 a live payment is cancelled with the Till off; the check opens again (not stranded)');
  -- The guest paid before the cancel reached Paystack: money in flight still lands.
  UPDATE public.venue_orders SET paystack_reference = 'mingla_vo_o2f1off' WHERE id = v_car;
  v := public.pg_venue_order_finalize_payment(v_car, 'paystack', 275000, 'NGN', 'mingla_vo_o2f1off', '3002', NULL, NULL);
  PERFORM public.t4490f1_ok(v->>'status' = 'finalized'
      AND (SELECT paid_late FROM public.venue_till_payments WHERE id = v_pay)
      AND (SELECT overpaid_minor FROM public.venue_till_sales WHERE id = v_sale) = 275000,
    'F1-S6 money that lands with the Till off is recorded once (late money)');
  PERFORM public.t4490f1_expect(format($q$SELECT public.t4490f1_cash(%L)$q$, v_sale),
    'P0001', 'till_not_enabled', 'F1-S7 new money still needs the Till on');
  PERFORM public.t4490f1_till(true);
END
$switch$;

-- -------------------------------------------------------------------------
-- 4. O2-T3: rolling-hour text windows.
-- -------------------------------------------------------------------------
DO $windows$
DECLARE
  v jsonb;
  v_codes text[] := ARRAY['FXGGGGGG', 'FXHHHHHH', 'FXJJJJJJ'];
  v_sale uuid;
  i integer;
  v_outbox bigint;
BEGIN
  PERFORM public.t4490f1_ok(public.issue_4490_till_text_limits() = '{"perNumberPerVenueHour": 6, "perSellerHour": 30}'::jsonb,
    'F1-W0 the windows are 6 to one number per venue and 30 per seller each hour (one place)');
  FOR i IN 1..3 LOOP
    v_sale := public.t4490f1_check('o2f1-text-' || i, 'Text ' || i);
    PERFORM public.t4490f1_start(v_sale, 'scan', v_codes[i]);
  END LOOP;
  -- Two codes x three texts = six to one number.
  FOR i IN 1..3 LOOP
    PERFORM public.t4490f1_text('FXGGGGGG', '02', '+2348031230002');
    PERFORM public.t4490f1_text('FXHHHHHH', '04', '+2348031230002');
  END LOOP;
  SELECT count(*) INTO v_outbox FROM public.notification_outbox WHERE contact = '+2348031230002';
  PERFORM public.t4490f1_expect($q$SELECT public.t4490f1_text('FXJJJJJJ', '02', '+2348031230002')$q$,
    'PT409', 'pay_code_text_window', 'F1-W1 a seventh pay link to one number within the hour is refused (another code, another seller alike)');
  PERFORM public.t4490f1_ok((SELECT count(*) FROM public.notification_outbox WHERE contact = '+2348031230002') = v_outbox
      AND (SELECT text_link_count FROM public.venue_till_pay_codes WHERE code = 'FXJJJJJJ') = 0
      AND (SELECT count(*) FROM public.venue_till_pay_link_texts WHERE phone_e164 = '+2348031230002') = 6,
    'F1-W2 a refused text writes no SMS and counts nothing');
  v := public.t4490f1_text('FXJJJJJJ', '02', '+2348031230003');
  PERFORM public.t4490f1_ok((v->>'sent')::boolean, 'F1-W3 another number is still fine');
  -- An hour later the window has rolled on.
  PERFORM public.t4490f1_age_texts(interval '61 minutes');
  v := public.t4490f1_text('FXJJJJJJ', '02', '+2348031230002');
  PERFORM public.t4490f1_ok((v->>'sent')::boolean, 'F1-W4 after an hour the same number can be texted again');
  -- Per seller: thirty in the hour across numbers.
  INSERT INTO public.venue_till_pay_link_texts (venue_id, pay_code_id, phone_e164, sent_by)
  SELECT '44900900-0000-4000-9000-0000000000a1', (SELECT id FROM public.venue_till_pay_codes WHERE code = 'FXGGGGGG'),
    '+23480312310' || lpad(n::text, 2, '0'), '44900900-0000-4000-8000-000000000004'
  FROM generate_series(1, 30) n;
  PERFORM public.t4490f1_expect($q$SELECT public.t4490f1_text('FXJJJJJJ', '04', '+2348031239999')$q$,
    'PT409', 'pay_code_text_window', 'F1-W5 a seller''s thirty-first pay link within the hour is refused');
  v := public.t4490f1_text('FXJJJJJJ', '02', '+2348031239999');
  PERFORM public.t4490f1_ok((v->>'sent')::boolean, 'F1-W6 another seller is still fine');
  PERFORM public.t4490f1_expect($q$SELECT public.t4490f1_text('FXJJJJJJ', '02', '+2348031239998')$q$,
    'PT409', 'pay_code_text_limit', 'F1-W7 three per code still holds first');
END
$windows$;

-- -------------------------------------------------------------------------
-- 5. O2-T2: one global unknown-code budget.
-- -------------------------------------------------------------------------
DO $budget$
BEGIN
  PERFORM public.t4490f1_ok(NOT public.issue_4490_till_code_guess_budget(false, 3),
    'F1-G1 a fresh minute has budget');
  PERFORM public.t4490f1_ok(NOT public.issue_4490_till_code_guess_budget(true, 3)
      AND NOT public.issue_4490_till_code_guess_budget(true, 3)
      AND public.issue_4490_till_code_guess_budget(true, 3),
    'F1-G2 the third unknown answer spends a budget of three');
  PERFORM public.t4490f1_ok(public.issue_4490_till_code_guess_budget(false, 3)
      AND NOT public.issue_4490_till_code_guess_budget(false, 4),
    'F1-G3 the read does not count');
  PERFORM public.t4490f1_ok((SELECT count(*) FROM public.venue_order_rate_limits
      WHERE scope_key LIKE 'issue_4490_till_unknown_code%') = 1,
    'F1-G4 one global key (nothing a caller sends is in it)');
END
$budget$;

-- -------------------------------------------------------------------------
-- 6. Who may call the new functions and read the new table.
-- -------------------------------------------------------------------------
SELECT public.t4490f1_reset();
SELECT public.t4490f1_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_till_release_stale(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_release_stale(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_pay_code_lookup(text,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_code_guess_budget(boolean,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_code_guess_budget(boolean,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_text_limits()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_pay_code_text(text,uuid,uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_pay_code_status(text,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_till_release_stale(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_till_code_guess_budget(boolean,integer)', 'EXECUTE'),
  'F1-P1 every new and re-emitted function is service-role only');
SELECT public.t4490f1_ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_till_pay_link_texts'::regclass)
  AND NOT has_table_privilege('anon', 'public.venue_till_pay_link_texts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.venue_till_pay_link_texts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.venue_till_pay_link_texts', 'INSERT'),
  'F1-P2 the text ledger is service-role only, RLS on');

ROLLBACK;
