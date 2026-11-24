-- #4490 spec 08 O1 fix round 1: executable PostgreSQL 17 proof for migration
-- 20281203554490 (one bill: the old order pad and the Till; voids on a
-- part-paid check; refunding an offer line cancels its booking; one
-- guest-list arrival per open check; payment order for receipts).
-- The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-ONE-BILL | issue #4490 | a tab and its Till check are one bill: the old order pad closing a tab closes its check in the same transaction with the pad's settlement carried (no Till payment invented), the pad's money actions are refused while the Till runs at the venue or once the check holds Till money, and the Till never takes money for a tab or round another path settled.
-- MINGLA-INVARIANT: I-4490-TILL-OFFER-REFUND-CANCELS | issue #4490 | refunding an offer line sold in the Till (or every payment of its check) cancels its booking through issue_4490_cancel, marks its pass refunded and counts the refund once in issue_4490_venue_money_day on the refund's service day.
-- MINGLA-INVARIANT: I-4490-TILL-PART-PAID-VOIDABLE | issue #4490 | until a Till check is fully paid every line is unpaid and may be voided by the usual rights; a void that leaves the money taken covering the rest closes the check as paid with any excess in overpaid_minor.
--
-- FAILS-ON-REVERT: without 20281203554490 the first assertion fails (the old
-- pad's tab close leaves its Till check open).
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
CREATE TEMP TABLE t4490f1_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490f1_ids TO PUBLIC;
CREATE FUNCTION public.t4490f1_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490f1_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490f1_till(p_on boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  UPDATE public.feature_flags SET is_enabled = p_on WHERE flag_key = 'VENUE_TILL'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_till(boolean) TO PUBLIC;
CREATE FUNCTION public.t4490f1_date() RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_venue_local_date('44900400-0000-4000-9000-0000000000a1')
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_date() TO PUBLIC;
CREATE FUNCTION public.t4490f1_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_v(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 03 scanner (rank 10), 04 finance
-- manager, 05 venue staff with check-in only, 06 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900400-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-f1-' || n || '@example.test', now(), now()
FROM generate_series(1, 6) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900400-0000-4000-8000-000000000001', now()), ('44900400-0000-4000-8000-000000000006', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900400-0000-4000-9000-000000000010', '44900400-0000-4000-8000-000000000001',
   'Till Fix One 4490', 'till-f1-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900400-0000-4000-9000-000000000020', '44900400-0000-4000-8000-000000000006',
   'Till Fix One Other 4490', 'till-f1-other-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900400-0000-4000-9000-0000000000a1', '44900400-0000-4000-9000-000000000010', 'tillf1a', 'Fix One Bar',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900400-0000-4000-9000-000000000010', '44900400-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900400-0000-4000-a000-000000000002', '44900400-0000-4000-9000-000000000010', '44900400-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900400-0000-4000-a000-000000000003', '44900400-0000-4000-9000-000000000010', '44900400-0000-4000-8000-000000000003', 'scanner', now()),
  ('44900400-0000-4000-a000-000000000004', '44900400-0000-4000-9000-000000000010', '44900400-0000-4000-8000-000000000004', 'finance_manager', now()),
  ('44900400-0000-4000-a000-000000000005', '44900400-0000-4000-9000-000000000010', '44900400-0000-4000-8000-000000000005', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900400-0000-4000-a000-000000000002', '44900400-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900400-0000-4000-a000-000000000005', '44900400-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900400-0000-4000-b000-000000000001', '44900400-0000-4000-9000-000000000010', '44900400-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900400-0000-4000-b000-000000000011', '44900400-0000-4000-b000-000000000001', '44900400-0000-4000-9000-000000000010', 'Chapman', 250000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900400-0000-4000-9000-0000000000a1', '44900400-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;
SELECT public.t4490f1_as('44900400-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900400-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'f1-till-on');
-- TEST-MOD-APPROVED #4490 (08-O3 part A, T8): the venue has kitchen screens, so a sent round waits for
-- the kitchen (placed) as these assertions expect; without a screen it is delivered at send.
SELECT public.issue_4490_set_venue_feature('44900400-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'f1-menu-on-a');
SELECT public.issue_4490_set_venue_feature('44900400-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'f1-screens-on-a');
SELECT public.issue_4490_set_venue_feature('44900400-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'f1-entry-on');
SELECT public.issue_4490_set_venue_feature('44900400-0000-4000-9000-0000000000a1', 'guest_list', true, NULL, NULL, NULL, 'f1-gl-on');
SELECT public.t4490f1_reset();

-- Pickup codes are unique while live: hand them out in order (never random).
CREATE SEQUENCE public.t4490f1_pickup START 101;
GRANT USAGE ON SEQUENCE public.t4490f1_pickup TO PUBLIC;
-- A staff round exactly as the order pad (status placed) or the Till (held)
-- inserts it: 1 x Chapman 2,500.00 + 10% = 2,750.00.
CREATE FUNCTION public.t4490f1_round(p_session uuid, p_status text, p_actor uuid)
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
    v_order, p_session, '44900400-0000-4000-9000-000000000010', '44900400-0000-4000-9000-0000000000a1', 'staff',
    p_actor, lpad(nextval('public.t4490f1_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 250000, 250000, 0, 1000, 25000, 0, 0, 0, false, false, false,
    275000, 275000, 'pending', p_status, 'till-f1-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900400-0000-4000-b000-000000000011', 1, 'Chapman', 250000, 'NGN', 1, 0, 250000);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_round(uuid, text, uuid) TO PUBLIC;
-- A sitting the pad starts (no tab yet).
CREATE FUNCTION public.t4490f1_session() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
  VALUES ('44900400-0000-4000-9000-000000000010', '44900400-0000-4000-9000-0000000000a1', 'NGN') RETURNING id
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_session() TO PUBLIC;
CREATE FUNCTION public.t4490f1_sale_of(p_session uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_till_sales WHERE session_id = p_session
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_sale_of(uuid) TO PUBLIC;
-- A Till check with one round attached (held).
CREATE FUNCTION public.t4490f1_check(p_key text, p_label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb; v_sale uuid; v_session uuid;
BEGIN
  v := public.issue_4490_till_open('44900400-0000-4000-9000-0000000000a1',
    '44900400-0000-4000-8000-000000000002', NULL, p_label, NULL, p_key);
  v_sale := (v->>'id')::uuid;
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  PERFORM public.issue_4490_till_attach_round(v_sale,
    public.t4490f1_round(v_session, 'held', '44900400-0000-4000-8000-000000000002'),
    '44900400-0000-4000-8000-000000000002', NULL);
  RETURN v_sale;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f1_check(text, text) TO PUBLIC;

-- -------------------------------------------------------------------------
-- 1. O1-N1: the pad closes a tab -> its check closes in the same transaction.
-- -------------------------------------------------------------------------
SELECT public.t4490f1_till(false);
SELECT public.t4490f1_as('44900400-0000-4000-8000-000000000001');
DO $pad_vc$
DECLARE
  v jsonb;
  v_session uuid := public.t4490f1_session();
  v_empty uuid := public.t4490f1_session();
  v_sale uuid;
BEGIN
  PERFORM public.t4490f1_round(v_session, 'placed', '44900400-0000-4000-8000-000000000001');
  PERFORM public.biz_venue_tab_open(v_session);
  v_sale := public.t4490f1_sale_of(v_session);
  PERFORM public.t4490f1_ok(v_sale IS NOT NULL
      AND (SELECT state = 'open' AND total_due_minor = 275000 FROM public.venue_till_sales WHERE id = v_sale),
    'F1-PAD0 fixture: a pad tab (Till off) has its check (T18), 2,750.00 due');
  v := public.biz_venue_tab_close(v_session, 'venue_collected');
  PERFORM public.t4490f1_ok(
    (SELECT state = 'paid' AND settled_outside = 'venue_collected' AND paid_minor = 0 AND overpaid_minor = 0
            AND paid_at IS NOT NULL AND business_date IS NOT NULL
     FROM public.venue_till_sales WHERE id = v_sale)
    AND NOT EXISTS (SELECT 1 FROM public.venue_till_lines WHERE sale_id = v_sale AND state = 'held')
    AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments WHERE sale_id = v_sale),
    'F1-PAD1 the pad closing a tab (paid to the venue) closes its check as paid, carrying the pad''s settlement, with no Till payment invented');
  INSERT INTO t4490f1_ids VALUES ('pad_vc_sale', v_sale);
  -- An empty tab: its check closes as voided.
  PERFORM public.biz_venue_tab_open(v_empty);
  PERFORM public.biz_venue_tab_close(v_empty, 'venue_collected');
  PERFORM public.t4490f1_ok(
    (SELECT state = 'voided' AND settled_outside = 'venue_collected' FROM public.venue_till_sales
     WHERE session_id = v_empty),
    'F1-PAD2 a tab closed with nothing on it closes its check as voided');
END
$pad_vc$;
SELECT public.t4490f1_reset();

-- bill_to_phone: the tab settles; when its one bill lands the check closes.
SELECT public.t4490f1_as('44900400-0000-4000-8000-000000000001');
DO $pad_btp$
DECLARE
  v jsonb;
  v_session uuid := public.t4490f1_session();
BEGIN
  PERFORM public.t4490f1_round(v_session, 'placed', '44900400-0000-4000-8000-000000000001');
  PERFORM public.biz_venue_tab_open(v_session);
  v := public.biz_venue_tab_close(v_session, 'bill_to_phone');
  INSERT INTO t4490f1_ids VALUES ('btp_session', v_session), ('btp_sale', public.t4490f1_sale_of(v_session));
END
$pad_btp$;
SELECT public.t4490f1_service();
DO $pad_btp_land$
DECLARE
  v jsonb;
  v_order uuid := gen_random_uuid();
BEGIN
  -- The settlement order venue-order-staff mints, already on the Mingla rail.
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code, buyer_name, buyer_email, buyer_phone_e164,
    money_path, provider, paystack_reference, currency, subtotal_cents, discount_cents, service_charge_bps,
    service_charge_cents, tip_cents, effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents,
    tax_amount_cents, total_cents, payment_status, idempotency_key, metadata
  ) VALUES (
    v_order, public.t4490f1_id('btp_session'), '44900400-0000-4000-9000-000000000010',
    '44900400-0000-4000-9000-0000000000a1', 'staff', '44900400-0000-4000-8000-000000000001', '771', 'Ada',
    'ada@example.test', '+2348031234567', 'mingla', 'paystack', 'mingla_vo_' || v_order, 'NGN', 250000, 0, 0,
    25000, 0, 500, 0, 13750, 0, false, false, false, 275000, 0, 275000, 'pending',
    'venue_tab_settlement:' || public.t4490f1_id('btp_session'),
    jsonb_build_object('tab_settlement', true, 'settles_session_id', public.t4490f1_id('btp_session')));
  -- While that bill is out on the guest's phone the Till cannot take it.
  PERFORM public.t4490f1_till(true);
  PERFORM public.t4490f1_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 275000, 0, 275000,
      '44900400-0000-4000-8000-000000000001', NULL, gen_random_uuid(), NULL)$q$, public.t4490f1_id('btp_sale')),
    'PT409', 'till_tab_settled_on_pad', 'F1-PAD3 while the pad''s bill is out on a phone the Till refuses the check');
  PERFORM public.t4490f1_till(false);
  v := public.pg_venue_order_finalize_payment(v_order, 'paystack', 275000, 'NGN', 'mingla_vo_' || v_order);
  PERFORM public.t4490f1_ok(v->>'status' = 'finalized'
      AND (SELECT state = 'paid' AND settled_outside = 'bill_to_phone' AND paid_minor = 0
           FROM public.venue_till_sales WHERE id = public.t4490f1_id('btp_sale')),
    'F1-PAD4 a tab billed to a phone closes its check when the bill lands (same transaction as the tab)');
END
$pad_btp_land$;
SELECT public.t4490f1_reset();

-- The Till on: the pad cannot close a tab; nor once a check holds Till money.
SELECT public.t4490f1_as('44900400-0000-4000-8000-000000000001');
DO $pad_refused$
DECLARE
  v_session uuid := public.t4490f1_session();
  v_session2 uuid := public.t4490f1_session();
BEGIN
  PERFORM public.t4490f1_round(v_session, 'placed', '44900400-0000-4000-8000-000000000001');
  PERFORM public.biz_venue_tab_open(v_session);
  PERFORM public.t4490f1_round(v_session2, 'placed', '44900400-0000-4000-8000-000000000001');
  PERFORM public.biz_venue_tab_open(v_session2);
  INSERT INTO t4490f1_ids VALUES ('race_session', v_session), ('race2_session', v_session2);
END
$pad_refused$;
SELECT public.t4490f1_till(true);
SELECT public.t4490f1_expect(
  format($q$SELECT public.biz_venue_tab_close(%L, 'venue_collected')$q$, public.t4490f1_id('race_session')),
  'P0001', 'tab_on_till', 'F1-PAD5 while the Till runs the pad''s tab close (paid to the venue) is refused');
SELECT public.t4490f1_expect(
  format($q$SELECT public.biz_venue_tab_close(%L, 'bill_to_phone')$q$, public.t4490f1_id('race_session')),
  'P0001', 'tab_on_till', 'F1-PAD6 while the Till runs the pad''s bill-to-phone close is refused');
SELECT public.t4490f1_reset();
-- R2: the Till takes part of the tab, the Till is switched off, the pad tries to close it.
SELECT public.t4490f1_service();
DO $race$
DECLARE v jsonb; v_sale uuid := public.t4490f1_sale_of(public.t4490f1_id('race2_session'));
BEGIN
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 100000, 0, 100000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  INSERT INTO t4490f1_ids VALUES ('race2_sale', v_sale);
END
$race$;
SELECT public.t4490f1_till(false);
SELECT public.t4490f1_as('44900400-0000-4000-8000-000000000001');
SELECT public.t4490f1_expect(
  format($q$SELECT public.biz_venue_tab_close(%L, 'venue_collected')$q$, public.t4490f1_id('race2_session')),
  'P0001', 'tab_on_till', 'F1-PAD7 a tab whose check holds Till money is never closed by the pad (Till off too)');
SELECT public.t4490f1_reset();

-- Backfill: a tab the pad closed before this fix (the trigger is bypassed, as
-- the suite owner, to stage the old state), with Till money on it (R2).
ALTER TABLE public.venue_order_sessions DISABLE TRIGGER issue_4490_till_tab_closed;
UPDATE public.venue_orders SET payment_status = 'paid', confirmed_at = now()
WHERE session_id = public.t4490f1_id('race2_session') AND payment_status = 'pending';
UPDATE public.venue_order_sessions SET tab_state = 'closed', settlement_method = 'venue_collected',
  closed_at = now(), closed_by_user_id = '44900400-0000-4000-8000-000000000001'
WHERE id = public.t4490f1_id('race2_session');
ALTER TABLE public.venue_order_sessions ENABLE TRIGGER issue_4490_till_tab_closed;
SELECT public.t4490f1_till(true);
SELECT public.t4490f1_service();
DO $backfill$
DECLARE v_sale uuid := public.t4490f1_id('race2_sale');
BEGIN
  PERFORM public.t4490f1_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 175000, 0, 175000,
      '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), NULL)$q$, v_sale),
    'PT409', 'till_tab_settled_on_pad', 'F1-PAD8 the Till refuses money for a tab the pad already closed');
  PERFORM public.issue_4490_till_close_on_pad(public.t4490f1_id('race2_session'));
  PERFORM public.t4490f1_ok(
    (SELECT state = 'paid' AND settled_outside = 'venue_collected' AND paid_minor = 0 AND overpaid_minor = 100000
     FROM public.venue_till_sales WHERE id = v_sale),
    'F1-PAD9 the backfill closes a pad-closed tab''s check, carrying the pad''s settlement; Till money on it is kept in overpaid');
END
$backfill$;
DO $backfill_refund$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_refund((SELECT id FROM public.venue_till_payments WHERE sale_id = public.t4490f1_id('race2_sale')),
    100000, 0, 'Paid twice', false, '44900400-0000-4000-8000-000000000004', NULL, gen_random_uuid());
  PERFORM public.t4490f1_ok(v#>>'{sale,state}' = 'refunded',
    'F1-PAD10 that overpaid Till money is refunded through the Till''s refund path');
END
$backfill_refund$;
SELECT public.t4490f1_reset();

-- The Till on: a standalone pad order joins a check the Till can take.
SELECT public.t4490f1_service();
DO $standalone$
DECLARE v jsonb; v_session uuid := public.t4490f1_session(); v_sale uuid;
BEGIN
  PERFORM public.t4490f1_round(v_session, 'placed', '44900400-0000-4000-8000-000000000003');
  v_sale := public.t4490f1_sale_of(v_session);
  PERFORM public.t4490f1_ok(v_sale IS NOT NULL
      AND (SELECT state = 'open' AND total_due_minor = 275000 AND server_user_id = '44900400-0000-4000-8000-000000000003'
           FROM public.venue_till_sales WHERE id = v_sale),
    'F1-PAD11 while the Till runs a standalone pad order joins a check of its own (the Till takes its money)');
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 275000, 0, 300000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  PERFORM public.t4490f1_ok((v->>'salePaid')::boolean
      AND (SELECT payment_status FROM public.venue_orders WHERE session_id = v_session) = 'paid',
    'F1-PAD12 the Till collects that order once');
  INSERT INTO t4490f1_ids VALUES ('paid_session', v_session);
END
$standalone$;
SELECT public.t4490f1_reset();
-- tab_open never turns a Till check into a tab.
SELECT public.t4490f1_service();
DO $till_session$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_open('44900400-0000-4000-9000-0000000000a1',
    '44900400-0000-4000-8000-000000000002', NULL, 'Till', NULL, 'f1-open-till-session');
  INSERT INTO t4490f1_ids VALUES ('till_sale', (v->>'id')::uuid),
    ('till_session', (SELECT session_id FROM public.venue_till_sales WHERE id = (v->>'id')::uuid));
END
$till_session$;
SELECT public.t4490f1_as('44900400-0000-4000-8000-000000000001');
SELECT public.t4490f1_expect(
  format($q$SELECT public.biz_venue_tab_open(%L)$q$, public.t4490f1_id('till_session')),
  'P0001', 'tab_on_till', 'F1-PAD13 the pad cannot open a tab on a check the Till opened');
SELECT public.t4490f1_reset();

-- -------------------------------------------------------------------------
-- 2. O1-N2: the old settle and the other order money paths.
-- -------------------------------------------------------------------------
SELECT public.t4490f1_service();
DO $guard$
DECLARE
  v_till_round uuid;
  v_pad_order uuid;
  v_session uuid;
BEGIN
  v_session := public.t4490f1_id('till_session');
  v_till_round := public.t4490f1_round(v_session, 'held', '44900400-0000-4000-8000-000000000002');
  PERFORM public.issue_4490_till_attach_round(public.t4490f1_id('till_sale'), v_till_round,
    '44900400-0000-4000-8000-000000000002', NULL);
  PERFORM public.issue_4490_till_send(public.t4490f1_id('till_sale'), '44900400-0000-4000-8000-000000000002');
  INSERT INTO t4490f1_ids VALUES ('till_round', v_till_round);
  PERFORM public.t4490f1_ok(public.issue_4490_pad_guard('settle', v_till_round, NULL, NULL,
      '44900400-0000-4000-8000-000000000001') = 'till_round',
    'F1-SET1 the old settle refuses a sent Till round, even for the owner');
  -- A plain pad order (no tab, no check) while the Till is off.
  PERFORM public.t4490f1_till(false);
  v_pad_order := public.t4490f1_round(public.t4490f1_session(), 'placed', '44900400-0000-4000-8000-000000000003');
  PERFORM public.t4490f1_ok(public.issue_4490_pad_guard('settle', v_pad_order, NULL, NULL,
      '44900400-0000-4000-8000-000000000003') = 'ok'
    AND public.issue_4490_pad_guard('settle', v_pad_order, NULL, NULL, '44900400-0000-4000-8000-000000000002') = 'ok',
    'F1-SET2 with the Till off a plain pad order still settles for brand roles (as on main) and venue.sell staff');
  PERFORM public.t4490f1_ok(public.issue_4490_pad_guard('settle', v_pad_order, NULL, NULL,
      '44900400-0000-4000-8000-000000000005') = 'not_authorized'
    AND public.issue_4490_pad_guard('settle', v_pad_order, NULL, NULL, '44900400-0000-4000-8000-000000000006') = 'not_authorized',
    'F1-SET3 venue staff without sell rights and another brand''s owner may not settle');
  PERFORM public.t4490f1_till(true);
  PERFORM public.t4490f1_ok(public.issue_4490_pad_guard('settle', v_pad_order, NULL, NULL,
      '44900400-0000-4000-8000-000000000001') = 'till_on',
    'F1-SET4 while the Till runs the old settle is refused for every order at the venue');
  PERFORM public.t4490f1_ok(public.issue_4490_pad_guard('create', NULL, public.t4490f1_id('paid_session'),
      '44900400-0000-4000-9000-0000000000a1', '44900400-0000-4000-8000-000000000001') = 'session_closed'
    AND public.issue_4490_pad_guard('create', NULL, NULL, '44900400-0000-4000-9000-0000000000a1',
      '44900400-0000-4000-8000-000000000005') = 'not_authorized',
    'F1-SET5 the pad cannot add a round to a paid check; staff without sell rights cannot use the pad');
  -- Defence in depth: a round another path marked paid is never collected again.
  UPDATE public.venue_orders SET payment_status = 'paid', confirmed_at = now() WHERE id = v_till_round;
  PERFORM public.t4490f1_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 275000, 0, 275000,
      '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), NULL)$q$, public.t4490f1_id('till_sale')),
    'PT409', 'till_round_settled_elsewhere', 'F1-SET6 the Till refuses money for a round another path already settled');
  UPDATE public.venue_orders SET payment_status = 'pending', confirmed_at = NULL WHERE id = v_till_round;
  UPDATE public.venue_orders SET money_path = 'mingla', provider = 'paystack', paystack_reference = 'mingla_vo_' || v_till_round,
    payment_status = 'failed', buyer_email = 'x@example.test', buyer_phone_e164 = '+2348031234567'
  WHERE id = v_till_round;
  PERFORM public.t4490f1_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 275000, 0, 275000,
      '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), NULL)$q$, public.t4490f1_id('till_sale')),
    'PT409', 'till_round_settled_elsewhere', 'F1-SET7 nor for a round another path moved onto the online rail');
  UPDATE public.venue_orders SET money_path = 'venue_collected', provider = NULL, paystack_reference = NULL,
    payment_status = 'pending', buyer_email = NULL, buyer_phone_e164 = NULL
  WHERE id = v_till_round;
END
$guard$;
SELECT public.t4490f1_reset();
-- The Orders queue and the refund decision.
SELECT public.t4490f1_as('44900400-0000-4000-8000-000000000001');
SELECT public.t4490f1_expect(
  format($q$SELECT public.biz_venue_order_transition(%L, 'cancelled')$q$, public.t4490f1_id('till_round')),
  'P0001', 'transition_not_allowed', 'F1-SET8 while the Till runs the queue cannot cancel a round on an open check (void it in the Till)');
SELECT public.t4490f1_expect(
  format($q$SELECT public.biz_venue_order_refund_decision(%L, 'approved', NULL)$q$, public.t4490f1_id('till_round')),
  'P0001', 'transition_not_allowed', 'F1-SET9 a venue refund decision never applies to a Till round');
SELECT public.t4490f1_reset();
SELECT public.t4490f1_till(false);
SELECT public.t4490f1_as('44900400-0000-4000-8000-000000000001');
DO $queue_off$
DECLARE v_session uuid := public.t4490f1_session(); v_r1 uuid; v_r2 uuid; v_sale uuid;
BEGIN
  v_r1 := public.t4490f1_round(v_session, 'placed', '44900400-0000-4000-8000-000000000001');
  v_r2 := public.t4490f1_round(v_session, 'placed', '44900400-0000-4000-8000-000000000001');
  PERFORM public.biz_venue_tab_open(v_session);
  v_sale := public.t4490f1_sale_of(v_session);
  PERFORM public.biz_venue_order_transition(v_r2, 'cancelled');
  PERFORM public.t4490f1_ok((SELECT total_due_minor FROM public.venue_till_sales WHERE id = v_sale) = 275000,
    'F1-SET10 with the Till off a queue cancel reprices the tab''s check in the same transaction');
END
$queue_off$;
SELECT public.t4490f1_reset();
SELECT public.t4490f1_till(true);

-- -------------------------------------------------------------------------
-- 3. O1-N3: voids on a part-paid check.
-- -------------------------------------------------------------------------
SELECT public.t4490f1_service();
DO $part$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f1_check('f1-open-part', 'Part');
  v_session uuid;
  v_late uuid;
  v_line uuid;
BEGIN
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  -- Two rounds (5,500.00); 1,000.00 taken (sends both).
  PERFORM public.issue_4490_till_attach_round(v_sale, public.t4490f1_round(v_session, 'held',
    '44900400-0000-4000-8000-000000000002'), '44900400-0000-4000-8000-000000000002', NULL);
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 100000, 0, 100000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  -- A round added after the part payment, not sent.
  v_late := public.t4490f1_round(v_session, 'held', '44900400-0000-4000-8000-000000000002');
  v := public.issue_4490_till_attach_round(v_sale, v_late, '44900400-0000-4000-8000-000000000002', NULL);
  SELECT id INTO v_line FROM public.venue_till_lines WHERE venue_order_id = v_late;
  v := public.issue_4490_till_void(v_sale, v_line, NULL, '44900400-0000-4000-8000-000000000002', 'Changed their mind',
    true, public.t4490f1_v(v_sale));
  PERFORM public.t4490f1_ok(v->>'state' = 'open' AND (v->>'totalDueMinor')::bigint = 550000
      AND (v->>'paidMinor')::bigint = 100000,
    'F1-VD1 after a part payment a seller voids an unpaid, unsent line; the balance recalculates');
  -- A sent line: sellers may not, money rights may.
  SELECT l.id INTO v_line FROM public.venue_till_lines l JOIN public.venue_orders o ON o.id = l.venue_order_id
  WHERE l.sale_id = v_sale AND l.state = 'held' AND o.fulfillment_status = 'placed' ORDER BY l.created_at LIMIT 1;
  PERFORM public.t4490f1_expect(
    format($q$SELECT public.issue_4490_till_void(%L, %L, NULL, '44900400-0000-4000-8000-000000000002', 'Made wrong', false, %s)$q$,
      v_sale, v_line, public.t4490f1_v(v_sale)),
    '42501', 'till_void_needs_money_rights', 'F1-VD2 a seller still cannot void a sent line after a part payment');
  v := public.issue_4490_till_void(v_sale, v_line, NULL, '44900400-0000-4000-8000-000000000001', 'Made wrong',
    false, public.t4490f1_v(v_sale));
  PERFORM public.t4490f1_ok(v->>'state' = 'open' AND (v->>'totalDueMinor')::bigint = 275000,
    'F1-VD3 the owner voids a sent line on a part-paid check');
  -- Paying the rest closes it.
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 175000, 0, 175000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  PERFORM public.t4490f1_ok((v->>'salePaid')::boolean, 'F1-VD4 the rest is paid and the check closes');
END
$part$;
-- A void that leaves the money taken covering more than the rest.
DO $over$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f1_check('f1-open-over', 'Over');
  v_session uuid;
  v_line uuid;
BEGIN
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  PERFORM public.issue_4490_till_attach_round(v_sale, public.t4490f1_round(v_session, 'held',
    '44900400-0000-4000-8000-000000000002'), '44900400-0000-4000-8000-000000000002', NULL);
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 400000, 0, 400000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  SELECT id INTO v_line FROM public.venue_till_lines WHERE sale_id = v_sale ORDER BY created_at DESC, id LIMIT 1;
  v := public.issue_4490_till_void(v_sale, v_line, NULL, '44900400-0000-4000-8000-000000000001', 'Walked out',
    false, public.t4490f1_v(v_sale));
  PERFORM public.t4490f1_ok(v->>'state' = 'paid' AND (v->>'paidMinor')::bigint = 275000
      AND (v->>'overpaidMinor')::bigint = 125000 AND (v->>'remainingMinor')::bigint = 0
      AND (SELECT payment_status FROM public.venue_orders o JOIN public.venue_till_lines l ON l.venue_order_id = o.id
           WHERE l.sale_id = v_sale AND l.state = 'committed') = 'paid',
    'F1-VD5 a void that leaves 4,000.00 paid against 2,750.00 closes the check as paid; 1,250.00 is kept as overpaid');
  v := public.issue_4490_till_refund((SELECT id FROM public.venue_till_payments WHERE sale_id = v_sale), 125000, 0,
    'Paid twice', false, '44900400-0000-4000-8000-000000000004', NULL, gen_random_uuid());
  PERFORM public.t4490f1_ok(v#>>'{sale,state}' = 'partially_refunded',
    'F1-VD6 the overpaid amount goes back through the refund path (money rights)');
END
$over$;
SELECT public.t4490f1_reset();

-- -------------------------------------------------------------------------
-- 4. Entry offers: the guest list (O1-N8), a lapsed hold (O1-N3), refunds
--    that cancel the booking (O1-N4).
-- -------------------------------------------------------------------------
SELECT public.t4490f1_as('44900400-0000-4000-8000-000000000001');
DO $offer_setup$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_option uuid;
  v_version bigint;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', '44900400-0000-4000-9000-0000000000a1',
    '{"name":"Door","dailyLimit":10,"keptForWalkIns":4}'::jsonb, NULL, 'f1-pool-create');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', '44900400-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Door entry","entryStyle":"walk_in"}'::jsonb, NULL, 'f1-offer-create');
  v_offer := (v->>'id')::uuid; v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_pool', '44900400-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_version, 'f1-pool-set');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '44900400-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Standard', 'unit', 'guest', 'guestMin', 1, 'guestMax', 10,
      'priceMinor', 500000), v_version, 'f1-price-set');
  v_version := (v->>'version')::bigint;
  SELECT (row->>'id')::uuid INTO v_option FROM jsonb_array_elements(v->'options') row WHERE row->>'name' = 'Standard';
  v := public.issue_4490_manage_offer('set_policy', '44900400-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', '[]'::jsonb, 'dateChangeRule', '{}'::jsonb), v_version, 'f1-policy');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', '44900400-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'mode', 'full_day', 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'startTime', '00:00', 'endTime', '23:59'), v_version, 'f1-schedule');
  v_version := (v->>'version')::bigint;
  PERFORM public.issue_4490_manage_offer('publish', '44900400-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer), v_version, 'f1-publish');
  v := public.issue_4490_manage_guest_list('set_terms', '44900400-0000-4000-9000-0000000000a1',
    jsonb_build_object('freeUntil', NULL, 'reducedUntil', '23:59', 'reducedPriceOptionId', v_option,
      'plusOnesMax', 3, 'closesMinutesBefore', 0), NULL, 'f1-gl-terms');
  v := public.issue_4490_manage_guest_list('add_entry', '44900400-0000-4000-9000-0000000000a1',
    jsonb_build_object('localDate', public.t4490f1_date(), 'guestName', 'Bola List', 'plusOnes', 0), NULL, 'f1-gl-add');
  INSERT INTO t4490f1_ids VALUES ('pool', v_pool), ('offer', v_offer), ('option', v_option),
    ('entry', (v#>>'{entry,id}')::uuid);
END
$offer_setup$;
SELECT public.t4490f1_reset();

SELECT public.t4490f1_service();
DO $guest_list$
DECLARE
  v jsonb;
  v_a uuid;
  v_b uuid;
BEGIN
  v := public.issue_4490_till_open('44900400-0000-4000-9000-0000000000a1',
    '44900400-0000-4000-8000-000000000002', NULL, 'GL A', NULL, 'f1-open-gl-a');
  v_a := (v->>'id')::uuid;
  v := public.issue_4490_till_open('44900400-0000-4000-9000-0000000000a1',
    '44900400-0000-4000-8000-000000000002', NULL, 'GL B', NULL, 'f1-open-gl-b');
  v_b := (v->>'id')::uuid;
  PERFORM public.issue_4490_till_add_offer_line(v_a, public.t4490f1_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f1_id('option'), 'guests', 1)),
    '44900400-0000-4000-8000-000000000002', 'f1-gl-line-a', public.t4490f1_id('entry'));
  PERFORM public.t4490f1_expect(
    format($q$SELECT public.issue_4490_till_add_offer_line(%L, %L, NULL,
      jsonb_build_array(jsonb_build_object('priceOptionId', %L, 'guests', 1)),
      '44900400-0000-4000-8000-000000000002', 'f1-gl-line-b', %L)$q$,
      v_b, public.t4490f1_id('offer'), public.t4490f1_id('option'), public.t4490f1_id('entry')),
    'PT409', 'guest_list_entry_on_check', 'F1-GL1 one guest-list arrival cannot sit on two open checks');
  PERFORM public.t4490f1_ok(
    (SELECT count(*) FROM public.venue_till_lines WHERE guest_list_entry_id = public.t4490f1_id('entry')) = 1
    AND (SELECT total_due_minor FROM public.venue_till_sales WHERE id = v_b) = 0,
    'F1-GL2 the refused add left nothing on the second check');
  INSERT INTO t4490f1_ids VALUES ('gl_a', v_a);
END
$guest_list$;

-- The hold lapses with part paid: drop the line and the check closes.
DO $lapse$
DECLARE
  v jsonb;
  v_sale uuid;
  v_line uuid;
  v_group uuid;
BEGIN
  v := public.issue_4490_till_open('44900400-0000-4000-9000-0000000000a1',
    '44900400-0000-4000-8000-000000000002', NULL, 'Lapse', NULL, 'f1-open-lapse');
  v_sale := (v->>'id')::uuid;
  v := public.issue_4490_till_add_offer_line(v_sale, public.t4490f1_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f1_id('option'), 'guests', 1)),
    '44900400-0000-4000-8000-000000000002', 'f1-lapse-line');
  SELECT (l->>'id')::uuid, (l->>'groupId')::uuid INTO v_line, v_group FROM jsonb_array_elements(v->'lines') l;
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 1000, 0, 1000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  -- The hold runs out (as the stay sweep would).
  UPDATE public.stay_inventory_holds SET state = 'expired', reason = 'expired', version = version + 1
  WHERE group_id = v_group AND state = 'active';
  PERFORM public.t4490f1_expect(
    format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', %s, 0, %s,
      '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$,
      v_sale, (SELECT total_due_minor - paid_minor FROM public.venue_till_sales WHERE id = v_sale),
      (SELECT total_due_minor - paid_minor FROM public.venue_till_sales WHERE id = v_sale), public.t4490f1_v(v_sale)),
    'PT409', 'till_hold_lapsed', 'F1-VD7 fixture: the last payment is refused once the entry hold has lapsed');
  v := public.issue_4490_till_void(v_sale, v_line, NULL, '44900400-0000-4000-8000-000000000002', 'Other',
    true, public.t4490f1_v(v_sale));
  PERFORM public.t4490f1_ok(v->>'state' = 'paid' AND (v->>'totalDueMinor')::bigint = 0
      AND (v->>'overpaidMinor')::bigint = 1000,
    'F1-VD8 the lapsed entry line is dropped and the part-paid check closes; the 10.00 taken is kept to refund');
END
$lapse$;
SELECT public.t4490f1_reset();

-- Refunding a paid Entry line cancels its booking (finance manager).
SELECT public.t4490f1_service();
DO $refund_line$
DECLARE
  v jsonb;
  v_sale uuid;
  v_line uuid;
  v_group uuid;
  v_pass uuid;
  v_left_before integer;
  v_left_paid integer;
  v_day jsonb;
  v_day2 jsonb;
  v_req uuid := '44900400-0000-4000-c000-000000000001';
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  SELECT gate_left INTO v_left_before FROM public.issue_4490_pool_day_usage(public.t4490f1_id('pool'), public.t4490f1_date());
  v_day := public.issue_4490_venue_money_day('44900400-0000-4000-9000-0000000000a1', public.t4490f1_date());
  v := public.issue_4490_till_open('44900400-0000-4000-9000-0000000000a1',
    '44900400-0000-4000-8000-000000000002', NULL, 'Entry', NULL, 'f1-open-entry');
  v_sale := (v->>'id')::uuid;
  v := public.issue_4490_till_add_offer_line(v_sale, public.t4490f1_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f1_id('option'), 'guests', 2)),
    '44900400-0000-4000-8000-000000000002', 'f1-entry-line');
  SELECT (l->>'id')::uuid, (l->>'groupId')::uuid INTO v_line, v_group FROM jsonb_array_elements(v->'lines') l;
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 1000000, 0, 1000000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  SELECT id INTO v_pass FROM public.venue_passes WHERE group_id = v_group;
  SELECT gate_left INTO v_left_paid FROM public.issue_4490_pool_day_usage(public.t4490f1_id('pool'), public.t4490f1_date());
  PERFORM public.t4490f1_ok((v->>'salePaid')::boolean
      AND (SELECT state FROM public.stay_reservation_groups WHERE id = v_group) = 'confirmed'
      AND (SELECT admitted_count FROM public.venue_passes WHERE id = v_pass) = 2 AND v_left_paid = v_left_before - 2
      AND (public.issue_4490_venue_money_day('44900400-0000-4000-9000-0000000000a1', public.t4490f1_date())->>'paidInMinor')::bigint
          = (v_day->>'paidInMinor')::bigint + 1000000,
    'F1-RF0 fixture: 2 entries sold and paid in the Till (10,000.00), both admitted, Paid in today +10,000.00');
  PERFORM public.t4490f1_expect(
    format($q$SELECT public.issue_4490_till_refund_line(%L, '44900400-0000-4000-8000-000000000002', NULL, 'Guest asked', gen_random_uuid())$q$, v_line),
    '42501', 'not_authorized', 'F1-RF1 a seller without money rights cannot refund an entry');
  v := public.issue_4490_till_refund_line(v_line, '44900400-0000-4000-8000-000000000004', NULL, 'Guest asked', v_req);
  PERFORM public.t4490f1_ok((v->>'refundedMinor')::bigint = 1000000 AND v#>>'{sale,state}' = 'refunded'
      AND (SELECT state FROM public.venue_till_lines WHERE id = v_line) = 'refunded'
      AND (SELECT sum(amount_minor) FROM public.venue_till_refunds WHERE line_id = v_line) = 1000000,
    'F1-RF2 a finance manager refunds the entry line in full from the check''s cash');
  PERFORM public.t4490f1_ok(
    (SELECT state FROM public.stay_reservation_groups WHERE id = v_group) = 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM public.stay_inventory_commitments WHERE group_id = v_group AND state = 'active')
    AND (SELECT gate_left FROM public.issue_4490_pool_day_usage(public.t4490f1_id('pool'), public.t4490f1_date())) = v_left_before
    AND EXISTS (SELECT 1 FROM public.stay_reservation_events WHERE group_id = v_group
                AND event_type = 'stay_reservation_cancelled' AND idempotency_key = 'offer-cancel:till-refund:' || v_line),
    'F1-RF3 the booking is cancelled through the venue offer cancel path and its places come back');
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = '44900400-0000-4000-9000-0000000000a1';
  PERFORM public.t4490f1_ok((SELECT status FROM public.venue_passes WHERE id = v_pass) = 'refunded'
      AND public.issue_4490_admit_pass(v_venue, v_pass, 1, true, '44900400-0000-4000-8000-000000000001', 'scan')->>'result' = 'void',
    'F1-RF4 the pass (already admitted) is marked refunded and the door refuses it');
  v_day2 := public.issue_4490_venue_money_day('44900400-0000-4000-9000-0000000000a1', public.t4490f1_date());
  PERFORM public.t4490f1_ok((v_day2->>'paidInMinor')::bigint = (v_day->>'paidInMinor')::bigint
      AND (v_day2#>>'{paidIn,refunded}')::bigint = (v_day#>>'{paidIn,refunded}')::bigint + 1000000,
    'F1-RF5 Paid in today counts the refund once, on the day it happened (back to where it was)');
  v := public.issue_4490_till_refund_line(v_line, '44900400-0000-4000-8000-000000000004', NULL, 'Guest asked', v_req);
  PERFORM public.t4490f1_ok((v->>'replayed')::boolean
      AND (SELECT count(*) FROM public.venue_till_refunds WHERE line_id = v_line) = 1
      AND (public.issue_4490_venue_money_day('44900400-0000-4000-9000-0000000000a1', public.t4490f1_date())->>'paidInMinor')::bigint
          = (v_day->>'paidInMinor')::bigint,
    'F1-RF6 a retried refund replays: nothing is refunded or counted twice');
  PERFORM public.t4490f1_expect(
    format($q$SELECT public.issue_4490_till_refund_line(%L, '44900400-0000-4000-8000-000000000004', NULL, 'Guest asked', gen_random_uuid())$q$, v_line),
    'PT409', 'till_line_not_paid', 'F1-RF7 a refunded line cannot be refunded again');
END
$refund_line$;

-- A full cash refund by amount (the tester's E1) cancels the booking too.
DO $refund_amount$
DECLARE
  v jsonb;
  v_sale uuid;
  v_group uuid;
  v_payment uuid;
BEGIN
  v := public.issue_4490_till_open('44900400-0000-4000-9000-0000000000a1',
    '44900400-0000-4000-8000-000000000002', NULL, 'Entry 2', NULL, 'f1-open-entry-2');
  v_sale := (v->>'id')::uuid;
  v := public.issue_4490_till_add_offer_line(v_sale, public.t4490f1_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f1_id('option'), 'guests', 1)),
    '44900400-0000-4000-8000-000000000002', 'f1-entry-line-2');
  SELECT (l->>'groupId')::uuid INTO v_group FROM jsonb_array_elements(v->'lines') l;
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 500000, 0, 500000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  v_payment := (v->>'paymentId')::uuid;
  v := public.issue_4490_till_refund(v_payment, 200000, 0, 'Guest asked', false,
    '44900400-0000-4000-8000-000000000001', NULL, gen_random_uuid());
  PERFORM public.t4490f1_ok((SELECT state FROM public.stay_reservation_groups WHERE id = v_group) = 'confirmed',
    'F1-RF8 a part refund by amount leaves the booking as it is');
  v := public.issue_4490_till_refund(v_payment, 300000, 0, 'Guest asked', false,
    '44900400-0000-4000-8000-000000000001', NULL, gen_random_uuid());
  PERFORM public.t4490f1_ok((SELECT state FROM public.stay_reservation_groups WHERE id = v_group) = 'cancelled'
      AND (SELECT status FROM public.venue_passes WHERE group_id = v_group) = 'refunded'
      AND (SELECT state FROM public.venue_till_lines WHERE stay_group_id = v_group) = 'refunded',
    'F1-RF9 once every payment is refunded in full the check''s entry booking is cancelled and its pass refunded');
END
$refund_amount$;
SELECT public.t4490f1_reset();

-- -------------------------------------------------------------------------
-- 5. O1-N5: payments have a real order; T9 who may take over a check.
-- -------------------------------------------------------------------------
SELECT public.t4490f1_service();
DO $order$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f1_check('f1-open-seq', 'Seq');
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 100000, 0, 100000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  v_p1 := (v->>'paymentId')::uuid;
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 175000, 0, 175000,
    '44900400-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f1_v(v_sale));
  v_p2 := (v->>'paymentId')::uuid;
  PERFORM public.t4490f1_ok(
    (SELECT paid_at FROM public.venue_till_payments WHERE id = v_p1) = (SELECT paid_at FROM public.venue_till_payments WHERE id = v_p2)
    AND (SELECT seq FROM public.venue_till_payments WHERE id = v_p1) < (SELECT seq FROM public.venue_till_payments WHERE id = v_p2)
    AND (public.issue_4490_till_receipt_projection(v_p2)->>'paidBeforeMinor')::bigint = 100000
    AND (public.issue_4490_till_receipt_projection(v_p1)->>'paidBeforeMinor')::bigint = 0,
    'F1-SEQ1 two payments in one moment: the receipt''s paid-before follows the payment sequence, never the id');
  v := public.issue_4490_till_servers('44900400-0000-4000-9000-0000000000a1', '44900400-0000-4000-8000-000000000002');
  PERFORM public.t4490f1_ok(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v) s WHERE (s->>'userId')::uuid = '44900400-0000-4000-8000-000000000002')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) s
                    WHERE (s->>'userId')::uuid IN ('44900400-0000-4000-8000-000000000004', '44900400-0000-4000-8000-000000000005')),
    'F1-SRV1 who may take over a check: the people who may sell here (not finance-only or check-in-only staff)');
  PERFORM public.t4490f1_expect(
    $q$SELECT public.issue_4490_till_servers('44900400-0000-4000-9000-0000000000a1', '44900400-0000-4000-8000-000000000005')$q$,
    '42501', 'not_authorized', 'F1-SRV2 staff who may not sell cannot list them');
END
$order$;
SELECT public.t4490f1_reset();
SELECT public.t4490f1_ok(
  NOT has_function_privilege('authenticated', 'public.issue_4490_pad_guard(text,uuid,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_refund_line(uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_servers(uuid,uuid)', 'EXECUTE'),
  'F1-G1 the new functions are service-role only');

ROLLBACK;
