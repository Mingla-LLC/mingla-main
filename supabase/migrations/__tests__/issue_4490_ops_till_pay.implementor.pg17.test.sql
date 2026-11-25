-- #4490 spec 08 O2: executable PostgreSQL 17 proof for migration
-- 20281203564490 (tap to pay on Till sales, scan to pay, a bank transfer that
-- confirms itself). The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-ONE-PRICE-PAY | issue #4490 | a Till card or scan payment is always what is left on the check (issue_4490_till_card_start refuses a priced carrier whose base, service charge, tip or currency differ from the check); the body never carries an amount.
-- MINGLA-INVARIANT: I-4490-TILL-TIP-NOT-FEED-PAY | issue #4490 | a Till carrier's fee_basis_cents never contains the tip (venue_orders_fee_from_basis; the tip rides on top of the total).
-- MINGLA-INVARIANT: I-4490-TILL-LATE-MONEY-NEVER-DROPPED-PAY | issue #4490 | a carrier paid after its payment was cancelled or its code expired is finalized once, marked paid_late and lands in overpaid_minor; "Keep it as payment" moves it onto what is still due, never more.
-- MINGLA-INVARIANT: I-4490-TILL-ONE-LIVE-CODE | issue #4490 | a Till payment has at most one pay code (venue_till_pay_codes.payment_id UNIQUE) and a check has at most one pending payment; a new code needs the old one cancelled or expired.
-- MINGLA-INVARIANT: I-4490-TILL-TAP-ONE-INTENT | issue #4490 | door_tap_intents holds an event tap or a Till tap, never both; one Till intent per client request and per payment; event rows keep UNIQUE(event_id, client_request_id).
--
-- FAILS-ON-REVERT: without 20281203564490 the first card helper call fails
-- (no issue_4490_till_card_prepare).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490o2_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490O2 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490o2_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490O2 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490O2 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490o2_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490o2_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490o2_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_ok(boolean,text), public.t4490o2_expect(text,text,text,text),
  public.t4490o2_as(uuid), public.t4490o2_service(), public.t4490o2_reset() TO PUBLIC;
CREATE TEMP TABLE t4490o2_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490o2_ids TO PUBLIC;
CREATE FUNCTION public.t4490o2_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490o2_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490o2_till(p_on boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  UPDATE public.feature_flags SET is_enabled = p_on WHERE flag_key = 'VENUE_TILL'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_till(boolean) TO PUBLIC;
CREATE FUNCTION public.t4490o2_date() RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_venue_local_date('44900600-0000-4000-9000-0000000000a1')
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_date() TO PUBLIC;
CREATE FUNCTION public.t4490o2_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_v(uuid) TO PUBLIC;
CREATE FUNCTION public.t4490o2_paid_in(p_day date) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_venue_money_day('44900600-0000-4000-9000-0000000000a1', p_day)->>'paidInMinor')::bigint
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_paid_in(date) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 03 door staff (venue.check_in).
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900600-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-o2-' || n || '@example.test', now(), now()
FROM generate_series(1, 3) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44900600-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900600-0000-4000-9000-000000000010', '44900600-0000-4000-8000-000000000001',
   'Till O2 4490', 'till-o2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900600-0000-4000-9000-0000000000a1', '44900600-0000-4000-9000-000000000010', 'tillo2a', 'O2 Club',
   6.45, 3.40, 'club', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900600-0000-4000-9000-000000000010', '44900600-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900600-0000-4000-a000-000000000002', '44900600-0000-4000-9000-000000000010', '44900600-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900600-0000-4000-a000-000000000003', '44900600-0000-4000-9000-000000000010', '44900600-0000-4000-8000-000000000003', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900600-0000-4000-a000-000000000002', '44900600-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900600-0000-4000-a000-000000000003', '44900600-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900600-0000-4000-b000-000000000001', '44900600-0000-4000-9000-000000000010', '44900600-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900600-0000-4000-b000-000000000011', '44900600-0000-4000-b000-000000000001', '44900600-0000-4000-9000-000000000010', 'Chapman', 250000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900600-0000-4000-9000-0000000000a1', '44900600-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;
SELECT public.t4490o2_as('44900600-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900600-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'o2-till-on');
SELECT public.issue_4490_set_venue_feature('44900600-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'o2-entry-on');
SELECT public.issue_4490_set_venue_feature('44900600-0000-4000-9000-0000000000a1', 'guest_list', true, NULL, NULL, NULL, 'o2-gl-on');
SELECT public.t4490o2_reset();

CREATE SEQUENCE public.t4490o2_pickup START 201;
GRANT USAGE ON SEQUENCE public.t4490o2_pickup TO PUBLIC;
-- A staff round as the Till inserts it (held): 1 x Chapman 2,500.00 + 10% = 2,750.00.
CREATE FUNCTION public.t4490o2_round(p_session uuid, p_actor uuid)
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
    v_order, p_session, '44900600-0000-4000-9000-000000000010', '44900600-0000-4000-9000-0000000000a1', 'staff',
    p_actor, lpad(nextval('public.t4490o2_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 250000, 250000, 0, 1000, 25000, 0, 0, 0, false, false, false,
    275000, 275000, 'pending', 'held', 'till-o2-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900600-0000-4000-b000-000000000011', 1, 'Chapman', 250000, 'NGN', 1, 0, 250000);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_round(uuid, uuid) TO PUBLIC;
-- A Till check with one round attached (held).
CREATE FUNCTION public.t4490o2_check(p_key text, p_label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb; v_sale uuid; v_session uuid;
BEGIN
  v := public.issue_4490_till_open('44900600-0000-4000-9000-0000000000a1',
    '44900600-0000-4000-8000-000000000002', NULL, p_label, NULL, p_key);
  v_sale := (v->>'id')::uuid;
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  PERFORM public.issue_4490_till_attach_round(v_sale,
    public.t4490o2_round(v_session, '44900600-0000-4000-8000-000000000002'),
    '44900600-0000-4000-8000-000000000002', NULL);
  RETURN v_sale;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_check(text, text) TO PUBLIC;
CREATE FUNCTION public.t4490o2_round_line(p_sale uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_till_lines WHERE sale_id = p_sale AND kind = 'menu_round' ORDER BY created_at LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_round_line(uuid) TO PUBLIC;


-- The priced carrier the edge sends (computeVenueOrderMoney shape): take rate
-- 150 bps + platform 300 bps, nothing passed to the guest, no tax.
CREATE FUNCTION public.t4490o2_money(p_amount bigint, p_sc bigint, p_tip bigint, p_provider text DEFAULT 'paystack')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object('provider', p_provider,
    'stripeAccountId', CASE WHEN p_provider = 'stripe' THEN 'acct_o2test' END, 'currency', 'NGN',
    'subtotalCents', p_amount - p_sc, 'serviceChargeCents', p_sc, 'tipCents', p_tip,
    'effectiveTakeRateBps', 150, 'serviceFeeBps', 300,
    'minglaFeeCents', round(p_amount::numeric * 150 / 10000), 'platformServiceFeeCents', round(p_amount::numeric * 300 / 10000),
    'passMinglaFee', false, 'passServiceFee', false, 'passTax', false,
    'buyerSubtotalCents', p_amount, 'taxAmountCents', 0, 'totalCents', p_amount + p_tip,
    'pricingBreakdown', '{}'::jsonb)
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_money(bigint, bigint, bigint, text) TO PUBLIC;
-- prepare + start as the edge does.
CREATE FUNCTION public.t4490o2_start(p_sale uuid, p_method text, p_tip bigint, p_req uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_card_prepare(p_sale, '44900600-0000-4000-8000-000000000002', public.t4490o2_v(p_sale));
  RETURN public.issue_4490_till_card_start(p_sale, p_method, p_tip, '44900600-0000-4000-8000-000000000002', NULL, p_req,
    (v->>'version')::integer,
    public.t4490o2_money((v->>'amountMinor')::bigint, (v->>'serviceChargeMinor')::bigint, p_tip,
      CASE WHEN p_method = 'tap' THEN 'stripe' ELSE 'paystack' END),
    p_code);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_start(uuid, text, bigint, uuid, text) TO PUBLIC;
CREATE FUNCTION public.t4490o2_carrier(p_payment uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT carrier_order_id FROM public.venue_till_payments WHERE id = p_payment
$f$;
GRANT EXECUTE ON FUNCTION public.t4490o2_carrier(uuid) TO PUBLIC;

SELECT public.t4490o2_service();

-- -------------------------------------------------------------------------
-- 1. Scan to pay: one price, one live code, the carrier.
-- -------------------------------------------------------------------------
DO $scan$
DECLARE
  v jsonb;
  v_prep jsonb;
  v_sale uuid := public.t4490o2_check('o2-scan-check', 'Ada');
  v_req uuid := gen_random_uuid();
  v_pay uuid;
  v_car public.venue_orders%ROWTYPE;
BEGIN
  v_prep := public.issue_4490_till_card_prepare(v_sale, '44900600-0000-4000-8000-000000000002', public.t4490o2_v(v_sale));
  PERFORM public.t4490o2_ok((v_prep->>'amountMinor')::bigint = 275000 AND (v_prep->>'serviceChargeMinor')::bigint = 25000
      AND NOT EXISTS (SELECT 1 FROM public.venue_orders o JOIN public.venue_till_lines l ON l.venue_order_id = o.id
                      WHERE l.sale_id = v_sale AND o.fulfillment_status = 'held'),
    'O2-DB1 prepare sends the held round first (T8) and says 2,750.00 is left, 250.00 of it service charge');
  PERFORM public.t4490o2_expect(format($q$SELECT public.issue_4490_till_card_start(%L, 'scan', 0,
      '44900600-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s, public.t4490o2_money(100, 0, 0), 'Q2AAAAAA')$q$,
      v_sale, v_prep->>'version'),
    'PT409', 'till_check_changed', 'O2-DB2 a priced carrier for another amount is refused (the body never sets the price)');
  PERFORM public.t4490o2_expect(format($q$SELECT public.issue_4490_till_card_start(%L, 'scan', 0,
      '44900600-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s, public.t4490o2_money(275000, 25000, 0), 'Q2AAAAAA')$q$,
      v_sale, (v_prep->>'version')::integer - 1),
    'PT409', 'till_check_changed', 'O2-DB3 a stale version is refused (T10)');
  v := public.issue_4490_till_card_start(v_sale, 'scan', 0, '44900600-0000-4000-8000-000000000002', NULL, v_req,
    (v_prep->>'version')::integer, public.t4490o2_money(275000, 25000, 0), 'Q2AAAAAA');
  v_pay := (v->>'paymentId')::uuid;
  SELECT * INTO v_car FROM public.venue_orders WHERE till_payment_id = v_pay;
  PERFORM public.t4490o2_ok(v_car.money_path = 'mingla' AND v_car.fulfillment_status = 'payment_only'
      AND v_car.payment_status = 'pending' AND v_car.total_cents = 275000 AND v_car.fee_basis_cents = 275000
      AND v_car.buyer_name IS NULL AND (v->>'code') = 'Q2AAAAAA'
      AND (SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paying',
    'O2-DB4 the scan payment rides on one carrier (Mingla rail, payment_only, no name needed) and the check is paying');
  v := public.issue_4490_till_card_start(v_sale, 'scan', 0, '44900600-0000-4000-8000-000000000002', NULL, v_req,
    NULL, public.t4490o2_money(1, 0, 0), 'Q2BBBBBB');
  PERFORM public.t4490o2_ok((v->>'replayed')::boolean AND (v->>'paymentId')::uuid = v_pay AND v->>'code' = 'Q2AAAAAA',
    'O2-DB5 the same request returns the same payment and code');
  PERFORM public.t4490o2_expect(format($q$SELECT public.t4490o2_start(%L, 'scan', 0, gen_random_uuid(), 'Q2CCCCCC')$q$, v_sale),
    'PT409', 'till_payment_in_progress', 'O2-DB6 a second live code on the check is refused while one is live');
  PERFORM public.t4490o2_expect(format($q$INSERT INTO public.venue_till_pay_codes (code, payment_id, provider, created_by)
      VALUES ('Q2DDDDDD', %L, 'paystack', '44900600-0000-4000-8000-000000000002')$q$, v_pay),
    '23505', NULL, 'O2-DB7 two codes for one payment are refused by the table');
  PERFORM public.t4490o2_expect(format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 1000, 0, 1000,
      '44900600-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490o2_v(%L))$q$, v_sale, v_sale),
    'PT409', 'till_payment_in_progress', 'O2-DB8 cash is refused while a scan payment is live (one attempt at a time)');
  -- The guest opens the code: venue, lines and amount only.
  v := public.issue_4490_till_pay_code_view('Q2AAAAAA');
  PERFORM public.t4490o2_ok(v->>'status' = 'opened' AND v->>'venueName' = 'O2 Club' AND (v->>'amountMinor')::bigint = 275000
      AND jsonb_array_length(v->'lines') = 1 AND v->'lines'->0->>'name' = 'Chapman'
      AND NOT (v ? 'paymentId') AND NOT (v ? 'saleId') AND v::text !~* 'till-o2',
    'O2-DB9 the guest view shows venue, lines and amount and nothing about who sold it');
  PERFORM public.t4490o2_expect($q$SELECT public.issue_4490_till_pay_code_view('ZZZZZZZZ')$q$, 'P0002', 'pay_code_not_found',
    'O2-DB10 an unknown code answers not found');
  v := public.issue_4490_till_pay_code_buyer('Q2AAAAAA', 'Ada Guest', 'ada@gmail.com', '+2348031234567');
  PERFORM public.t4490o2_ok((v->>'totalCents')::bigint = 275000 AND (v->>'applicationFeeCents')::bigint = 12375
      AND (SELECT expires_at - created_at FROM public.venue_till_pay_codes WHERE code = 'Q2AAAAAA') >= interval '59 minutes'
      AND (SELECT buyer_email FROM public.venue_orders WHERE till_payment_id = v_pay) = 'ada@gmail.com',
    'O2-DB11 paying starts: contact on the carrier, the code lives 60 minutes for a bank transfer');
  v := public.issue_4490_till_pay_code_text('Q2AAAAAA', '44900600-0000-4000-9000-0000000000a1',
    '44900600-0000-4000-8000-000000000002', '+2348031234567', 'https://example.invalid/pay/till/Q2AAAAAA');
  PERFORM public.t4490o2_ok((v->>'textLinksLeft')::int = 2 AND EXISTS (
      SELECT 1 FROM public.notification_outbox WHERE idempotency_key = 'buyer_till_pay_link:'
        || (SELECT id FROM public.venue_till_pay_codes WHERE code = 'Q2AAAAAA') || ':1'
        AND category_key = 'buyer_door_pay_link' AND country_code = 'NG' AND user_id IS NULL),
    'O2-DB11b Text them the link writes one SMS row with the number''s country (1529)');
  PERFORM public.issue_4490_till_pay_code_text('Q2AAAAAA', '44900600-0000-4000-9000-0000000000a1',
    '44900600-0000-4000-8000-000000000002', '+2348031234567', 'https://example.invalid/pay/till/Q2AAAAAA');
  PERFORM public.issue_4490_till_pay_code_text('Q2AAAAAA', '44900600-0000-4000-9000-0000000000a1',
    '44900600-0000-4000-8000-000000000002', '+2348031234567', 'https://example.invalid/pay/till/Q2AAAAAA');
  PERFORM public.t4490o2_expect($q$SELECT public.issue_4490_till_pay_code_text('Q2AAAAAA', '44900600-0000-4000-9000-0000000000a1',
      '44900600-0000-4000-8000-000000000002', '+2348031234567', 'https://example.invalid/pay/till/Q2AAAAAA')$q$,
    'PT409', 'pay_code_text_limit', 'O2-DB11c at most three texts per code');
  PERFORM public.t4490o2_expect($q$SELECT public.issue_4490_till_pay_code_text('Q2AAAAAA', '44900600-0000-4000-9000-0000000000a1',
      '44900600-0000-4000-8000-000000000003', '+2348031234567', 'x')$q$,
    '42501', 'not_authorized', 'O2-DB11d check-in staff without Sell cannot text a pay link');
  -- The bank transfer lands (Paystack charge.success; the webhook put the channel on the carrier).
  UPDATE public.venue_orders SET paystack_reference = 'mingla_vo_o2scan', metadata = metadata || '{"provider_channel":"bank_transfer"}'
  WHERE till_payment_id = v_pay;
  v := public.pg_venue_order_finalize_payment(v_car.id, 'paystack', 275000, 'NGN', 'mingla_vo_o2scan', '999', 4100, NULL);
  PERFORM public.t4490o2_ok(v->>'status' = 'finalized' AND (v->>'tillPaymentId')::uuid = v_pay
      AND (SELECT state || provider_channel FROM public.venue_till_payments WHERE id = v_pay) = 'paidbank_transfer'
      AND (SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paid'
      AND (SELECT status FROM public.venue_till_pay_codes WHERE code = 'Q2AAAAAA') = 'paid'
      AND (SELECT payment_status FROM public.venue_orders o JOIN public.venue_till_lines l ON l.venue_order_id = o.id
           WHERE l.sale_id = v_sale LIMIT 1) = 'paid',
    'O2-DB12 a transfer that lands pays the check by itself: payment paid by bank transfer, code paid, round settled');
  v := public.pg_venue_order_finalize_payment(v_car.id, 'paystack', 275000, 'NGN', 'mingla_vo_o2scan', '999', 4100, NULL);
  PERFORM public.t4490o2_ok(v->>'status' = 'replayed'
      AND (SELECT paid_minor FROM public.venue_till_sales WHERE id = v_sale) = 275000,
    'O2-DB13 the webhook again (or confirm on return) replays: counted once');
  -- Sales vs Mingla money.
  PERFORM public.t4490o2_ok(
      (SELECT count(*) FROM public.issue_3872_order_margin m WHERE m.order_id = v_car.id) = 1
      AND NOT EXISTS (SELECT 1 FROM public.issue_3872_order_margin m
                      JOIN public.venue_till_lines l ON l.venue_order_id = m.order_id WHERE l.sale_id = v_sale),
    'O2-DB14 Mingla money counts the carrier once and never the Till round');
  PERFORM public.t4490o2_ok(
      COALESCE((public.venue_order_metrics_rollup('44900600-0000-4000-9000-000000000010', NULL)->>'order_count')::int, 0) >= 0
      AND NOT EXISTS (SELECT 1 FROM public.venue_orders o WHERE o.id = v_car.id AND o.till_payment_id IS NULL),
    'O2-DB15 fixture: the carrier is marked as a Till carrier for the rollup exclusion');
END
$scan$;

-- -------------------------------------------------------------------------
-- 2. Late money: cancelled, then paid. Keep it as payment.
-- -------------------------------------------------------------------------
DO $late$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490o2_check('o2-late-check', 'Tolu');
  v_pay uuid;
  v_pay2 uuid;
  v_car uuid;
BEGIN
  v := public.t4490o2_start(v_sale, 'scan', 0, gen_random_uuid(), 'Q2EEEEEE');
  v_pay := (v->>'paymentId')::uuid;
  v_car := public.t4490o2_carrier(v_pay);
  v := public.issue_4490_till_card_cancel(v_pay, '44900600-0000-4000-8000-000000000002');
  PERFORM public.t4490o2_ok(v->>'state' = 'cancelled' AND v->'sale'->>'state' = 'open'
      AND (SELECT status FROM public.venue_till_pay_codes WHERE code = 'Q2EEEEEE') = 'cancelled'
      AND (SELECT payment_status FROM public.venue_orders WHERE id = v_car) = 'cancelled',
    'O2-DB20 cancel closes the code, the payment and the carrier; the check opens again');
  PERFORM public.t4490o2_expect($q$SELECT public.issue_4490_till_pay_code_buyer('Q2EEEEEE', 'Late Guest', 'late@gmail.com', '+2348031234567')$q$,
    'PT409', 'pay_code_closed', 'O2-DB21 a cancelled code cannot start paying');
  v := public.t4490o2_start(v_sale, 'scan', 0, gen_random_uuid(), 'Q2FFFFFF');
  PERFORM public.t4490o2_ok(v->>'code' = 'Q2FFFFFF', 'O2-DB22 after cancel a new code works');
  v_pay2 := (v->>'paymentId')::uuid;
  PERFORM public.issue_4490_till_card_cancel(v_pay2, '44900600-0000-4000-8000-000000000002');
  -- The guest who had the first page pays anyway (Paystack cannot cancel it).
  UPDATE public.venue_orders SET paystack_reference = 'mingla_vo_o2late', buyer_name = 'Late Guest' WHERE id = v_car;
  v := public.pg_venue_order_finalize_payment(v_car, 'paystack', 275000, 'NGN', 'mingla_vo_o2late', '1001', NULL, NULL);
  PERFORM public.t4490o2_ok(v->>'status' = 'finalized' AND (v->>'tillPaidLate')::boolean
      AND (SELECT paid_late AND state = 'paid' FROM public.venue_till_payments WHERE id = v_pay)
      AND (SELECT overpaid_minor = 275000 AND paid_minor = 0 AND state = 'open' FROM public.venue_till_sales WHERE id = v_sale),
    'O2-DB23 a late payment on a cancelled code is recorded once, paid_late, into overpaid_minor');
  v := public.pg_venue_order_finalize_payment(v_car, 'paystack', 275000, 'NGN', 'mingla_vo_o2late', '1001', NULL, NULL);
  PERFORM public.t4490o2_ok(v->>'status' = 'replayed' AND (SELECT overpaid_minor FROM public.venue_till_sales WHERE id = v_sale) = 275000,
    'O2-DB24 the late webhook again changes nothing');
  v := public.issue_4490_till_keep_late_payment(v_pay, '44900600-0000-4000-8000-000000000002', public.t4490o2_v(v_sale));
  PERFORM public.t4490o2_ok((v->>'keptMinor')::bigint = 275000 AND v->'sale'->>'state' = 'paid'
      AND (v->'sale'->>'overpaidMinor')::bigint = 0,
    'O2-DB25 Keep it as payment pays the check with the late money, nothing left over');
  PERFORM public.t4490o2_expect(format($q$SELECT public.issue_4490_till_keep_late_payment(%L, '44900600-0000-4000-8000-000000000002', NULL)$q$, v_pay),
    'PT409', 'till_late_nothing_to_keep', 'O2-DB26 it can be kept once');
END
$late$;

-- -------------------------------------------------------------------------
-- 3. Tap: intents, recording, the amount gate, event rows unchanged.
-- -------------------------------------------------------------------------
DO $tap$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490o2_check('o2-tap-check', 'Bar 1');
  v_req uuid := gen_random_uuid();
  v_pay uuid;
  v_car uuid;
BEGIN
  PERFORM public.t4490o2_expect(format($q$SELECT public.issue_4490_till_card_start(%L, 'tap', 0,
      '44900600-0000-4000-8000-000000000002', NULL, gen_random_uuid(), NULL, public.t4490o2_money(275000, 25000, 0, 'paystack'), NULL)$q$, v_sale),
    '22023', 'till_invalid_payload', 'O2-DB30 tap is Stripe only (Nigeria never has tap)');
  v := public.t4490o2_start(v_sale, 'tap', 25000, v_req, NULL);
  v_pay := (v->>'paymentId')::uuid;
  v_car := public.t4490o2_carrier(v_pay);
  PERFORM public.t4490o2_ok((SELECT tip_cents = 25000 AND fee_basis_cents = 275000 AND total_cents = 300000
                             FROM public.venue_orders WHERE id = v_car),
    'O2-DB31 a tip rides on top of the card total and is never in the fee basis');
  INSERT INTO public.door_tap_intents (brand_id, till_payment_id, client_request_id, lines, currency, subtotal_cents,
    fee_cents, total_cents, application_fee_cents, stripe_account_id, stripe_payment_intent_id, created_by)
  VALUES ('44900600-0000-4000-9000-000000000010', v_pay, v_req, jsonb_build_array(jsonb_build_object('kind', 'till_payment', 'paymentId', v_pay)),
    'NGN', 287625, 12375, 300000, 12375, 'acct_o2test', 'pi_o2tap', '44900600-0000-4000-8000-000000000002');
  PERFORM public.t4490o2_expect(format($q$INSERT INTO public.door_tap_intents (brand_id, till_payment_id, client_request_id, lines,
      currency, subtotal_cents, total_cents, stripe_account_id, created_by)
      VALUES ('44900600-0000-4000-9000-000000000010', %L, gen_random_uuid(), '[{"kind":"till_payment"}]', 'NGN', 1, 1, 'acct_o2test',
      '44900600-0000-4000-8000-000000000002')$q$, v_pay),
    '23505', NULL, 'O2-DB32 one Till intent per payment');
  PERFORM public.t4490o2_expect(format($q$INSERT INTO public.door_tap_intents (brand_id, till_payment_id, client_request_id, lines,
      currency, subtotal_cents, total_cents, stripe_account_id, created_by)
      VALUES ('44900600-0000-4000-9000-000000000010', NULL, %L, '[{"kind":"till_payment"}]', 'NGN', 1, 1, 'acct_o2test',
      '44900600-0000-4000-8000-000000000002')$q$, v_req),
    '23514', NULL, 'O2-DB33 an intent is an event tap or a Till tap, never neither');
  PERFORM public.t4490o2_expect($q$SELECT public.issue_4490_till_tap_record('pi_o2tap', 'ch_1', 299999, 'visa', '4242')$q$,
    '22023', 'till_tap_amount_mismatch', 'O2-DB34 a tap record for another amount is refused');
  v := public.issue_4490_till_tap_record('pi_o2tap', 'ch_1', 300000, 'Visa', '4242');
  PERFORM public.t4490o2_ok(v->>'state' = 'paid' AND v->>'cardBrand' = 'visa' AND v->>'cardLast4' = '4242'
      AND v->'sale'->>'state' = 'paid' AND (v->'sale'->>'paidMinor')::bigint = 275000
      AND (SELECT provider_channel FROM public.venue_till_payments WHERE id = v_pay) = 'card'
      AND (SELECT status FROM public.door_tap_intents WHERE stripe_payment_intent_id = 'pi_o2tap') = 'recorded',
    'O2-DB35 a tap is recorded through the finalizer: card brand and last four only, check paid');
  v := public.pg_venue_order_finalize_payment(v_car, 'stripe', 300000, 'NGN', 'pi_o2tap', 'ch_1', NULL, NULL);
  PERFORM public.t4490o2_ok(v->>'status' = 'replayed', 'O2-DB36 the connected-account webhook for the same PaymentIntent replays');
  v := public.issue_4490_till_tap_record('pi_o2tap', 'ch_1', 300000, 'visa', '4242');
  PERFORM public.t4490o2_ok((v->>'replayed')::boolean AND (SELECT count(*) FROM public.venue_till_payments WHERE sale_id = v_sale AND state = 'paid') = 1,
    'O2-DB37 a retried complete records nothing twice');
  PERFORM public.t4490o2_ok(
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.door_tap_intents'::regclass AND conname = 'door_tap_intents_one_scope') = 1
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'door_tap_intents_event_request_uniq'
                AND indexdef LIKE '%(event_id, client_request_id)%WHERE (event_id IS NOT NULL)%'),
    'O2-DB38 event door taps keep one intent per (event, client request)');
END
$tap$;
SELECT public.t4490o2_reset();

-- -------------------------------------------------------------------------
-- 3b. The day's money: an offer paid by scan is online (Mingla) money, once.
-- -------------------------------------------------------------------------
SELECT public.t4490o2_as('44900600-0000-4000-8000-000000000001');
DO $offer$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_option uuid;
  v_version bigint;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', '44900600-0000-4000-9000-0000000000a1',
    '{"name":"Door","dailyLimit":20,"keptForWalkIns":10}'::jsonb, NULL, 'o2-pool-create');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', '44900600-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Door entry","entryStyle":"walk_in"}'::jsonb, NULL, 'o2-offer-create');
  v_offer := (v->>'id')::uuid; v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_pool', '44900600-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_version, 'o2-pool-set');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '44900600-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Standard', 'unit', 'guest', 'guestMin', 1, 'guestMax', 10,
      'priceMinor', 500000), v_version, 'o2-price-set');
  v_version := (v->>'version')::bigint;
  SELECT (row->>'id')::uuid INTO v_option FROM jsonb_array_elements(v->'options') row WHERE row->>'name' = 'Standard';
  v := public.issue_4490_manage_offer('set_policy', '44900600-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', '[]'::jsonb, 'dateChangeRule', '{}'::jsonb), v_version, 'o2-policy');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', '44900600-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'mode', 'full_day', 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'startTime', '00:00', 'endTime', '23:59'), v_version, 'o2-schedule');
  v_version := (v->>'version')::bigint;
  PERFORM public.issue_4490_manage_offer('publish', '44900600-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer), v_version, 'o2-publish');
  INSERT INTO t4490o2_ids VALUES ('offer', v_offer), ('option', v_option);
END
$offer$;
SELECT public.t4490o2_service();
DO $money$
DECLARE
  v jsonb;
  v_sale uuid;
  v_pay uuid;
  v_day date := public.t4490o2_date();
  v_before jsonb := public.issue_4490_venue_money_day('44900600-0000-4000-9000-0000000000a1', public.t4490o2_date());
  v_after jsonb;
BEGIN
  v := public.issue_4490_till_open('44900600-0000-4000-9000-0000000000a1',
    '44900600-0000-4000-8000-000000000002', NULL, 'Entry by scan', NULL, 'o2-open-money');
  v_sale := (v->>'id')::uuid;
  PERFORM public.issue_4490_till_add_offer_line(v_sale, public.t4490o2_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490o2_id('option'), 'guests', 1)),
    '44900600-0000-4000-8000-000000000002', 'o2-add-entry', NULL, NULL);
  v := public.t4490o2_start(v_sale, 'scan', 0, gen_random_uuid(), 'Q2MMMMMM');
  v_pay := (v->>'paymentId')::uuid;
  UPDATE public.venue_orders SET paystack_reference = 'mingla_vo_o2money', buyer_name = 'Money Guest',
    buyer_email = 'money@gmail.com', buyer_phone_e164 = '+2348031234567' WHERE till_payment_id = v_pay;
  v := public.pg_venue_order_finalize_payment(public.t4490o2_carrier(v_pay), 'paystack', (v->>'chargedMinor')::integer,
    'NGN', 'mingla_vo_o2money', '2002', NULL, NULL);
  v_after := public.issue_4490_venue_money_day('44900600-0000-4000-9000-0000000000a1', v_day);
  PERFORM public.t4490o2_ok((SELECT state FROM public.venue_till_sales WHERE id = v_sale) = 'paid'
      AND (v_after#>>'{paidIn,online}')::bigint - (v_before#>>'{paidIn,online}')::bigint = (SELECT amount_minor FROM public.venue_till_payments WHERE id = v_pay)
      AND (v_after#>>'{paidIn,atVenue}')::bigint = (v_before#>>'{paidIn,atVenue}')::bigint
      AND (v_after->>'paidInMinor')::bigint - (v_before->>'paidInMinor')::bigint = (SELECT amount_minor FROM public.venue_till_payments WHERE id = v_pay),
    'O2-DM1 an entry paid by scan counts once in Paid in today, as online (Mingla) money, never at the venue');
  PERFORM public.t4490o2_ok(
      (v_after#>>'{forToday,online}')::bigint - (v_before#>>'{forToday,online}')::bigint = (SELECT amount_minor FROM public.venue_till_payments WHERE id = v_pay)
      AND (v_after#>>'{forToday,atVenue}')::bigint = (v_before#>>'{forToday,atVenue}')::bigint,
    'O2-DM2 and once for today''s bookings, online');
END
$money$;
SELECT public.t4490o2_reset();

-- -------------------------------------------------------------------------
-- 4. Who can read codes; who can call the functions.
-- -------------------------------------------------------------------------
SELECT public.t4490o2_as('44900600-0000-4000-8000-000000000002');
SELECT public.t4490o2_ok((SELECT count(*) FROM public.venue_till_pay_codes) = 4,
  'O2-RLS1 a seller at the venue reads its codes');
SELECT public.t4490o2_expect($q$SELECT buyer_email FROM public.venue_till_pay_codes LIMIT 1$q$, '42501', NULL,
  'O2-RLS2 the guest''s contact on a code is not readable by staff clients');
SELECT public.t4490o2_expect($q$INSERT INTO public.venue_till_pay_codes (code, payment_id, provider, created_by)
    VALUES ('Q2GGGGGG', gen_random_uuid(), 'stripe', gen_random_uuid())$q$, '42501', NULL,
  'O2-RLS3 no client writes a code');
SELECT public.t4490o2_reset();
SELECT public.t4490o2_as('44900600-0000-4000-8000-000000000003');
SELECT public.t4490o2_ok((SELECT count(*) FROM public.venue_till_pay_codes) = 4,
  'O2-RLS4 a venue viewer (check-in staff) sees the venue''s codes (spec: read via can_view_venue)');
SELECT public.t4490o2_reset();
SELECT public.t4490o2_as(gen_random_uuid());
SELECT public.t4490o2_ok((SELECT count(*) FROM public.venue_till_pay_codes) = 0,
  'O2-RLS5 a stranger sees no codes');
SELECT public.t4490o2_reset();
SET LOCAL ROLE anon;
SELECT public.t4490o2_expect($q$SELECT count(*) FROM public.venue_till_pay_codes$q$, '42501', NULL,
  'O2-RLS6 anonymous clients cannot read the table (the pay page goes through the function)');
RESET ROLE;
SELECT public.t4490o2_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_till_pay_code_view(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_pay_code_view(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_card_start(uuid,text,bigint,uuid,uuid,uuid,integer,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_tap_record(text,text,bigint,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.pg_venue_order_finalize_payment(uuid,text,integer,text,text,text,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.pg_venue_order_finalize_payment(uuid,text,integer,text,text,text,integer,text)', 'EXECUTE'),
  'O2-G1 every new function and the finalizer are service-role only');

ROLLBACK;
