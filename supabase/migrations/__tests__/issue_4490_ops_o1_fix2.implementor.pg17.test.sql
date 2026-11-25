-- #4490 spec 08 O1 fix round 2: executable PostgreSQL 17 proof for migration
-- 20281203544490 (overpaid follows every refund; the day's money puts Till
-- money and its refund on one service day; gate sales with the Till off are
-- counted once and never become a Till check; one guest-list arrival is sold
-- once; what the Orders queue lists for Till rounds once the Till is off).
-- The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-OVERPAID-FOLLOWS-REFUNDS | issue #4490 | a Till check's overpaid_minor is never more than what its payments took beyond what is counted against the bill and not yet refunded: every venue_till_refunds row re-derives it (refunds come out of the extra first; on an open check the rest is no longer counted as paid), so the overpaid banner clears once the extra is refunded.
-- MINGLA-INVARIANT: I-4490-DAY-MONEY-ONE-DAY-RULE | issue #4490 | issue_4490_venue_money_day puts money taken in the Till and its refund on the venue's service day (issue_4490_venue_service_date of the moment each happened), so a sale and its refund on the same night never split across two days, and a gate sale paid in cash or by transfer counts once on the service day it was taken.
-- MINGLA-INVARIANT: I-4490-DOOR-SALE-ONE-PATH | issue #4490 | a gate sale made with the Till off is never a Till check (no venue_till_sales or Till line for its booking, before or after the Till is switched on), and a guest-list arrival on an open Till check cannot also be sold at the gate.
--
-- FAILS-ON-REVERT: without 20281203544490 F2-OP2 fails first (the refunded
-- check keeps overpaid 1,000.00).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490f2_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490F2 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490f2_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490F2 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490F2 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490f2_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490f2_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490f2_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_ok(boolean,text), public.t4490f2_expect(text,text,text,text),
  public.t4490f2_as(uuid), public.t4490f2_service(), public.t4490f2_reset() TO PUBLIC;
CREATE TEMP TABLE t4490f2_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490f2_ids TO PUBLIC;
CREATE FUNCTION public.t4490f2_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490f2_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490f2_till(p_on boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  UPDATE public.feature_flags SET is_enabled = p_on WHERE flag_key = 'VENUE_TILL'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_till(boolean) TO PUBLIC;
CREATE FUNCTION public.t4490f2_date() RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_venue_local_date('44900500-0000-4000-9000-0000000000a1')
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_date() TO PUBLIC;
CREATE FUNCTION public.t4490f2_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_v(uuid) TO PUBLIC;
CREATE FUNCTION public.t4490f2_paid_in(p_day date) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_venue_money_day('44900500-0000-4000-9000-0000000000a1', p_day)->>'paidInMinor')::bigint
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_paid_in(date) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 03 door staff (venue.check_in).
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900500-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-f2-' || n || '@example.test', now(), now()
FROM generate_series(1, 3) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44900500-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000001',
   'Till Fix Two 4490', 'till-f2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-9000-000000000010', 'tillf2a', 'Fix Two Club',
   6.45, 3.40, 'club', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900500-0000-4000-a000-000000000002', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900500-0000-4000-a000-000000000003', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000003', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900500-0000-4000-a000-000000000002', '44900500-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900500-0000-4000-a000-000000000003', '44900500-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900500-0000-4000-b000-000000000001', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900500-0000-4000-b000-000000000011', '44900500-0000-4000-b000-000000000001', '44900500-0000-4000-9000-000000000010', 'Chapman', 250000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;
SELECT public.t4490f2_as('44900500-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900500-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'f2-till-on');
-- TEST-MOD-APPROVED #4490 (08-O3 part A, T8): the venue has kitchen screens, so a sent round waits for
-- the kitchen (placed) as these assertions expect; without a screen it is delivered at send.
SELECT public.issue_4490_set_venue_feature('44900500-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'f2-menu-on-a');
SELECT public.issue_4490_set_venue_feature('44900500-0000-4000-9000-0000000000a1', 'kitchen_screens', true, NULL, NULL, NULL, 'f2-screens-on-a');
SELECT public.issue_4490_set_venue_feature('44900500-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'f2-entry-on');
SELECT public.issue_4490_set_venue_feature('44900500-0000-4000-9000-0000000000a1', 'guest_list', true, NULL, NULL, NULL, 'f2-gl-on');
SELECT public.t4490f2_reset();

CREATE SEQUENCE public.t4490f2_pickup START 201;
GRANT USAGE ON SEQUENCE public.t4490f2_pickup TO PUBLIC;
-- A staff round as the Till inserts it (held): 1 x Chapman 2,500.00 + 10% = 2,750.00.
CREATE FUNCTION public.t4490f2_round(p_session uuid, p_actor uuid)
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
    v_order, p_session, '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-9000-0000000000a1', 'staff',
    p_actor, lpad(nextval('public.t4490f2_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 250000, 250000, 0, 1000, 25000, 0, 0, 0, false, false, false,
    275000, 275000, 'pending', 'held', 'till-f2-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900500-0000-4000-b000-000000000011', 1, 'Chapman', 250000, 'NGN', 1, 0, 250000);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_round(uuid, uuid) TO PUBLIC;
-- A Till check with one round attached (held).
CREATE FUNCTION public.t4490f2_check(p_key text, p_label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb; v_sale uuid; v_session uuid;
BEGIN
  v := public.issue_4490_till_open('44900500-0000-4000-9000-0000000000a1',
    '44900500-0000-4000-8000-000000000002', NULL, p_label, NULL, p_key);
  v_sale := (v->>'id')::uuid;
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = v_sale;
  PERFORM public.issue_4490_till_attach_round(v_sale,
    public.t4490f2_round(v_session, '44900500-0000-4000-8000-000000000002'),
    '44900500-0000-4000-8000-000000000002', NULL);
  RETURN v_sale;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_check(text, text) TO PUBLIC;
CREATE FUNCTION public.t4490f2_round_line(p_sale uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_till_lines WHERE sale_id = p_sale AND kind = 'menu_round' ORDER BY created_at LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_round_line(uuid) TO PUBLIC;

-- -------------------------------------------------------------------------
-- 1. O1-B2: overpaid follows every refund.
-- -------------------------------------------------------------------------
SELECT public.t4490f2_service();
DO $overpaid$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f2_check('f2-open-op', 'Tolu');
  v_payment uuid;
BEGIN
  -- Part paid 1,000.00 on a 2,750.00 check, then every line voided (owner).
  v := public.issue_4490_till_take_payment(v_sale, 'own_machine', 100000, 0, NULL,
    '44900500-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f2_v(v_sale));
  v_payment := (v->>'paymentId')::uuid;
  v := public.issue_4490_till_void(v_sale, public.t4490f2_round_line(v_sale), NULL,
    '44900500-0000-4000-8000-000000000001', 'Changed their mind', false, public.t4490f2_v(v_sale));
  PERFORM public.t4490f2_ok(v->>'state' = 'paid' AND (v->>'totalDueMinor')::bigint = 0
      AND (v->>'overpaidMinor')::bigint = 100000,
    'F2-OP1 fixture: voiding every line of a part-paid check closes it with 1,000.00 to refund');
  v := public.issue_4490_till_refund(v_payment, 100000, 0, 'Guest asked', false,
    '44900500-0000-4000-8000-000000000001', NULL, gen_random_uuid());
  PERFORM public.t4490f2_ok(v#>>'{sale,state}' = 'refunded' AND (v#>>'{sale,overpaidMinor}')::bigint = 0
      AND (SELECT overpaid_minor FROM public.venue_till_sales WHERE id = v_sale) = 0
      AND public.issue_4490_till_overpaid_derived(v_sale) = 0,
    'F2-OP2 once the extra is refunded the check reads refunded with nothing left to refund (O1-B2)');
  INSERT INTO t4490f2_ids VALUES ('op_sale', v_sale);
END
$overpaid$;

DO $overpaid_part$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f2_check('f2-open-op2', 'Part');
  v_payment uuid;
BEGIN
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 100000, 0, 100000,
    '44900500-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f2_v(v_sale));
  v_payment := (v->>'paymentId')::uuid;
  PERFORM public.issue_4490_till_void(v_sale, public.t4490f2_round_line(v_sale), NULL,
    '44900500-0000-4000-8000-000000000001', 'Walked out', false, public.t4490f2_v(v_sale));
  v := public.issue_4490_till_refund(v_payment, 40000, 0, 'Guest asked', false,
    '44900500-0000-4000-8000-000000000001', NULL, gen_random_uuid());
  PERFORM public.t4490f2_ok((v#>>'{sale,overpaidMinor}')::bigint = 60000 AND v#>>'{sale,state}' = 'partially_refunded',
    'F2-OP3 a part refund of the extra leaves only the rest to refund (600.00)');
  v := public.issue_4490_till_refund(v_payment, 60000, 0, 'Guest asked', false,
    '44900500-0000-4000-8000-000000000001', NULL, gen_random_uuid());
  PERFORM public.t4490f2_ok((v#>>'{sale,overpaidMinor}')::bigint = 0 AND v#>>'{sale,state}' = 'refunded',
    'F2-OP4 the rest refunded: nothing left to refund');
END
$overpaid_part$;

DO $open_refund$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490f2_check('f2-open-op3', 'Open');
  v_payment uuid;
  v_version integer;
BEGIN
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 100000, 0, 100000,
    '44900500-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f2_v(v_sale));
  v_payment := (v->>'paymentId')::uuid;
  v_version := public.t4490f2_v(v_sale);
  v := public.issue_4490_till_refund(v_payment, 100000, 0, 'Wrong amount', false,
    '44900500-0000-4000-8000-000000000001', NULL, gen_random_uuid());
  PERFORM public.t4490f2_ok(v#>>'{sale,state}' = 'open' AND (v#>>'{sale,paidMinor}')::bigint = 0
      AND (v#>>'{sale,remainingMinor}')::bigint = 275000 AND (v#>>'{sale,overpaidMinor}')::bigint = 0
      AND public.t4490f2_v(v_sale) > v_version,
    'F2-OP5 a part payment refunded on an open check is no longer counted as paid: all 2,750.00 is due again');
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 275000, 0, 275000,
    '44900500-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f2_v(v_sale));
  PERFORM public.t4490f2_ok((v->>'salePaid')::boolean
      AND (SELECT overpaid_minor FROM public.venue_till_sales WHERE id = v_sale) = 0,
    'F2-OP6 the check is then paid in full once, with nothing over');
END
$open_refund$;
SELECT public.t4490f2_reset();

-- -------------------------------------------------------------------------
-- 2. Entry offer and guest list fixture.
-- -------------------------------------------------------------------------
SELECT public.t4490f2_as('44900500-0000-4000-8000-000000000001');
DO $offer_setup$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_option uuid;
  v_version bigint;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', '44900500-0000-4000-9000-0000000000a1',
    '{"name":"Door","dailyLimit":20,"keptForWalkIns":10}'::jsonb, NULL, 'f2-pool-create');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', '44900500-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Door entry","entryStyle":"walk_in"}'::jsonb, NULL, 'f2-offer-create');
  v_offer := (v->>'id')::uuid; v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_pool', '44900500-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_version, 'f2-pool-set');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '44900500-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Standard', 'unit', 'guest', 'guestMin', 1, 'guestMax', 10,
      'priceMinor', 500000), v_version, 'f2-price-set');
  v_version := (v->>'version')::bigint;
  SELECT (row->>'id')::uuid INTO v_option FROM jsonb_array_elements(v->'options') row WHERE row->>'name' = 'Standard';
  v := public.issue_4490_manage_offer('set_policy', '44900500-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', '[]'::jsonb, 'dateChangeRule', '{}'::jsonb), v_version, 'f2-policy');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', '44900500-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'mode', 'full_day', 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'startTime', '00:00', 'endTime', '23:59'), v_version, 'f2-schedule');
  v_version := (v->>'version')::bigint;
  PERFORM public.issue_4490_manage_offer('publish', '44900500-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer), v_version, 'f2-publish');
  v := public.issue_4490_manage_guest_list('set_terms', '44900500-0000-4000-9000-0000000000a1',
    jsonb_build_object('freeUntil', NULL, 'reducedUntil', '23:59', 'reducedPriceOptionId', v_option,
      'plusOnesMax', 3, 'closesMinutesBefore', 0), NULL, 'f2-gl-terms');
  v := public.issue_4490_manage_guest_list('add_entry', '44900500-0000-4000-9000-0000000000a1',
    jsonb_build_object('localDate', public.t4490f2_date(), 'guestName', 'Ada List', 'plusOnes', 0), NULL, 'f2-gl-add-1');
  INSERT INTO t4490f2_ids VALUES ('pool', v_pool), ('offer', v_offer), ('option', v_option), ('entry1', (v#>>'{entry,id}')::uuid);
  v := public.issue_4490_manage_guest_list('add_entry', '44900500-0000-4000-9000-0000000000a1',
    jsonb_build_object('localDate', public.t4490f2_date(), 'guestName', 'Bisi List', 'plusOnes', 0), NULL, 'f2-gl-add-2');
  INSERT INTO t4490f2_ids VALUES ('entry2', (v#>>'{entry,id}')::uuid);
END
$offer_setup$;
SELECT public.t4490f2_reset();

-- -------------------------------------------------------------------------
-- 3. Spec 08 §13: a gate sale with the Till off counts once and never
--    becomes a Till check when the Till is switched on.
-- -------------------------------------------------------------------------
SELECT public.t4490f2_till(false);
SELECT public.t4490f2_service();
DO $gate$
DECLARE
  v jsonb;
  v_before bigint := public.t4490f2_paid_in(public.t4490f2_date());
  v_sales bigint := (SELECT count(*) FROM public.venue_till_sales WHERE venue_id = '44900500-0000-4000-9000-0000000000a1');
  v_group uuid;
  v_pass uuid;
BEGIN
  PERFORM public.t4490f2_ok(NOT public.issue_4490_till_enabled('44900500-0000-4000-9000-0000000000a1'),
    'F2-GS0 fixture: the Till is off for the venue (release flag off)');
  v := public.issue_4490_gate_sale('44900500-0000-4000-9000-0000000000a1', public.t4490f2_id('offer'),
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f2_id('option'), 'guests', 2)),
    'cash', '{}'::jsonb, 'f2-gate-cash-1', '44900500-0000-4000-8000-000000000003', NULL, NULL);
  v_group := (v#>>'{booking,groupId}')::uuid;
  v_pass := (v->>'passId')::uuid;
  PERFORM public.t4490f2_ok(v_group IS NOT NULL AND v_pass IS NOT NULL
      AND (SELECT state FROM public.stay_reservation_groups WHERE id = v_group) = 'confirmed'
      AND (SELECT payment_collection FROM public.stay_reservation_groups WHERE id = v_group) = 'property',
    'F2-GS1 door staff sell 2 Entry at the gate for cash with the Till off (the pre-O1 sell flow)');
  PERFORM public.t4490f2_ok(public.t4490f2_paid_in(public.t4490f2_date()) = v_before + 1000000
      AND (public.issue_4490_venue_money_day('44900500-0000-4000-9000-0000000000a1', public.t4490f2_date())#>>'{paidIn,atVenue}')::bigint >= 1000000,
    'F2-GS2 the gate sale is in Paid in today (at the venue) once: +10,000.00');
  PERFORM public.t4490f2_ok(
    public.issue_4490_check_in_list('44900500-0000-4000-9000-0000000000a1', public.t4490f2_date(),
      '44900500-0000-4000-8000-000000000003')::text LIKE '%' || v_pass::text || '%',
    'F2-GS3 the gate sale is on the check-in list');
  PERFORM public.t4490f2_ok(
    (SELECT count(*) FROM public.venue_till_sales WHERE venue_id = '44900500-0000-4000-9000-0000000000a1') = v_sales
    AND NOT EXISTS (SELECT 1 FROM public.venue_till_lines WHERE stay_group_id = v_group)
    AND NOT EXISTS (SELECT 1 FROM public.venue_offline_payments WHERE group_id = v_group),
    'F2-GS4 no Till check, Till line or second money row is made for it');
  INSERT INTO t4490f2_ids VALUES ('gate_group', v_group);
END
$gate$;
SELECT public.t4490f2_till(true);
DO $gate_till_on$
DECLARE
  v jsonb;
BEGIN
  PERFORM public.t4490f2_ok(public.issue_4490_till_enabled('44900500-0000-4000-9000-0000000000a1'),
    'F2-GS5 fixture: the Till is switched on');
  v := public.issue_4490_till_checks('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000002');
  PERFORM public.t4490f2_ok(v::text NOT LIKE '%' || public.t4490f2_id('gate_group')::text || '%'
      AND NOT EXISTS (SELECT 1 FROM public.venue_till_lines WHERE stay_group_id = public.t4490f2_id('gate_group'))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'open') c
                      WHERE (c->>'totalDueMinor')::bigint = 1000000),
    'F2-GS6 with the Till on, the gate sale is never an open check and is not offered again');
END
$gate_till_on$;

-- Guest list: the server's answer follows the same switch; one arrival is sold once.
DO $guest_list$
DECLARE
  v jsonb;
  v_sale uuid;
BEGIN
  PERFORM public.t4490f2_till(false);
  v := public.issue_4490_admit_guest_list('44900500-0000-4000-9000-0000000000a1', public.t4490f2_id('entry1'), 1,
    '44900500-0000-4000-8000-000000000003');
  PERFORM public.t4490f2_ok(v->>'result' = 'sell' AND (v->>'priceOptionId')::uuid = public.t4490f2_id('option'),
    'F2-GL1 Till off: a reduced-window arrival is sold at the gate (result sell, the list price option)');
  PERFORM public.t4490f2_till(true);
  v := public.issue_4490_admit_guest_list('44900500-0000-4000-9000-0000000000a1', public.t4490f2_id('entry1'), 1,
    '44900500-0000-4000-8000-000000000003');
  PERFORM public.t4490f2_ok(v->>'result' = 'sell_in_till',
    'F2-GL2 Till on: the same arrival is sold in the Till (result sell_in_till)');
  v := public.issue_4490_till_open('44900500-0000-4000-9000-0000000000a1',
    '44900500-0000-4000-8000-000000000002', NULL, 'Ada', NULL, 'f2-open-gl');
  v_sale := (v->>'id')::uuid;
  PERFORM public.issue_4490_till_add_offer_line(v_sale, public.t4490f2_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f2_id('option'), 'guests', 1)),
    '44900500-0000-4000-8000-000000000002', 'f2-gl-line', public.t4490f2_id('entry1'));
  PERFORM public.t4490f2_expect(
    format($q$SELECT public.issue_4490_guest_list_gate_sale(%L, %L, 1, 'cash', '{}'::jsonb, 'f2-gl-gate-1',
      '44900500-0000-4000-8000-000000000003', NULL, NULL)$q$,
      '44900500-0000-4000-9000-0000000000a1', public.t4490f2_id('entry1')),
    'PT409', 'guest_list_entry_on_check', 'F2-GL3 an arrival on an open Till check cannot also be sold at the gate');
  PERFORM public.t4490f2_ok((SELECT arrived FROM public.venue_guest_list_entries WHERE id = public.t4490f2_id('entry1')) = 0,
    'F2-GL4 the refused gate sale admitted nobody');
  PERFORM public.t4490f2_till(false);
  v := public.issue_4490_guest_list_gate_sale('44900500-0000-4000-9000-0000000000a1', public.t4490f2_id('entry2'), 1,
    'cash', '{}'::jsonb, 'f2-gl-gate-2', '44900500-0000-4000-8000-000000000003', NULL, NULL);
  PERFORM public.t4490f2_ok(v->>'passId' IS NOT NULL
      AND (SELECT arrived FROM public.venue_guest_list_entries WHERE id = public.t4490f2_id('entry2')) = 1,
    'F2-GL5 Till off: another arrival is sold at the gate at the list price and marked arrived once');
END
$guest_list$;
SELECT public.t4490f2_reset();

-- -------------------------------------------------------------------------
-- 4. O1-B3: a Till sale and its refund land on one service day.
-- -------------------------------------------------------------------------
SELECT public.t4490f2_till(true);
SELECT public.t4490f2_service();
DO $sale_refund$
DECLARE
  v jsonb;
  v_sale uuid;
  v_line uuid;
BEGIN
  v := public.issue_4490_till_open('44900500-0000-4000-9000-0000000000a1',
    '44900500-0000-4000-8000-000000000002', NULL, 'Night', NULL, 'f2-open-night');
  v_sale := (v->>'id')::uuid;
  v := public.issue_4490_till_add_offer_line(v_sale, public.t4490f2_id('offer'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f2_id('option'), 'guests', 1)),
    '44900500-0000-4000-8000-000000000002', 'f2-night-line');
  SELECT (l->>'id')::uuid INTO v_line FROM jsonb_array_elements(v->'lines') l;
  PERFORM public.issue_4490_till_take_payment(v_sale, 'cash', 500000, 0, 500000,
    '44900500-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490f2_v(v_sale));
  PERFORM public.issue_4490_till_refund_line(v_line, '44900500-0000-4000-8000-000000000001', NULL, 'Guest asked', gen_random_uuid());
  INSERT INTO t4490f2_ids VALUES ('night_line', v_line),
    ('night_pay', (SELECT o.id FROM public.venue_offline_payments o
                   JOIN public.venue_till_payments p ON p.id = o.till_payment_id WHERE p.sale_id = v_sale));
  PERFORM public.t4490f2_ok(public.t4490f2_id('night_pay') IS NOT NULL
      AND (SELECT state FROM public.venue_till_lines WHERE id = v_line) = 'refunded',
    'F2-DAY0 fixture: one Entry sold in the Till for cash (5,000.00) and its line refunded');
END
$sale_refund$;
SELECT public.t4490f2_reset();
-- Test-only: offline payments are append-only; the suite moves its own row in
-- time (as if taken at that moment) inside this rolled-back transaction.
ALTER TABLE public.venue_offline_payments DISABLE TRIGGER issue_4490_offline_payments_append_only;

-- Move the sale and the refund to given venue-local moments (as if they
-- happened then; paid_on as the Till writes it) and read the three days.
CREATE FUNCTION public.t4490f2_night(p_sale_local timestamp, p_refund_local timestamp)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_venue uuid := '44900500-0000-4000-9000-0000000000a1';
  v_tz text := public.issue_4490_venue_timezone('44900500-0000-4000-9000-0000000000a1');
  v_sale_at timestamptz := p_sale_local AT TIME ZONE v_tz;
  v_refund_at timestamptz := p_refund_local AT TIME ZONE v_tz;
  v_d date := p_sale_local::date;
BEGIN
  UPDATE public.venue_offline_payments
  SET created_at = v_sale_at, paid_on = public.issue_4490_till_business_date(v_venue, v_sale_at)
  WHERE id = public.t4490f2_id('night_pay');
  UPDATE public.venue_till_lines SET refunded_at = v_refund_at WHERE id = public.t4490f2_id('night_line');
  RETURN jsonb_build_object(
    'before', public.t4490f2_paid_in(v_d - 1), 'day', public.t4490f2_paid_in(v_d), 'after', public.t4490f2_paid_in(v_d + 1),
    'saleDay', public.issue_4490_venue_service_date(v_venue, v_sale_at),
    'refundDay', public.issue_4490_venue_service_date(v_venue, v_refund_at), 'tz', v_tz);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f2_night(timestamp, timestamp) TO PUBLIC;
SELECT public.t4490f2_service();

DO $nights$
DECLARE
  v jsonb;
BEGIN
  -- Lagos, a venue whose day does not cross midnight (open 00:00-23:59).
  v := public.t4490f2_night('2030-03-02 00:02', '2030-03-02 00:05');
  PERFORM public.t4490f2_ok(v->>'tz' = 'Africa/Lagos' AND (v->>'before')::bigint = 0 AND (v->>'day')::bigint = 0
      AND (v->>'after')::bigint = 0,
    'F2-DAY1 Lagos 00:02 sale, 00:05 refund: one service day, nets to 0; no day goes negative (O1-B3) ' || v::text);
  v := public.t4490f2_night('2030-03-02 04:59', '2030-03-02 05:01');
  PERFORM public.t4490f2_ok((v->>'before')::bigint = 0 AND (v->>'day')::bigint = 0,
    'F2-DAY2 Lagos 04:59 sale, 05:01 refund (either side of the Till''s 05:00 day): same service day ' || v::text);
  v := public.t4490f2_night('2030-03-02 23:58', '2030-03-03 00:03');
  PERFORM public.t4490f2_ok((v->>'day')::bigint = 500000 AND (v->>'after')::bigint = -500000
      AND v->>'saleDay' = '2030-03-02' AND v->>'refundDay' = '2030-03-03',
    'F2-DAY3 a refund made on a later service day comes off that day (the rule is the same, the days differ) ' || v::text);
  -- A venue that closes at 02:00 (open 18:00-02:00 every day).
  UPDATE public.brand_hours SET open_time = '18:00', close_time = '02:00'
  WHERE venue_id = '44900500-0000-4000-9000-0000000000a1';
  v := public.t4490f2_night('2030-03-02 01:30', '2030-03-02 01:45');
  PERFORM public.t4490f2_ok((v->>'before')::bigint = 0 AND (v->>'day')::bigint = 0
      AND v->>'saleDay' = '2030-03-01' AND v->>'refundDay' = '2030-03-01',
    'F2-DAY4 closes at 02:00: a 01:30 sale and 01:45 refund are both the night before ' || v::text);
  v := public.t4490f2_night('2030-03-02 03:00', '2030-03-02 03:10');
  PERFORM public.t4490f2_ok((v->>'before')::bigint = 0 AND (v->>'day')::bigint = 0
      AND v->>'saleDay' = '2030-03-02' AND v->>'refundDay' = '2030-03-02',
    'F2-DAY5 closes at 02:00: a 03:00 sale and 03:10 refund are both the new day (the Till''s 05:00 day would split them) ' || v::text);
  -- Second timezone: the same venue read in New York (UTC-5).
  UPDATE public.venue_listings SET country_code = 'US' WHERE id = '44900500-0000-4000-9000-0000000000a1';
  UPDATE public.venue_booking_settings SET timezone = 'America/New_York' WHERE venue_id = '44900500-0000-4000-9000-0000000000a1';
  UPDATE public.venue_availability_config SET iana_timezone = 'America/New_York' WHERE venue_id = '44900500-0000-4000-9000-0000000000a1';
  UPDATE public.brand_hours SET open_time = '00:00', close_time = '23:59'
  WHERE venue_id = '44900500-0000-4000-9000-0000000000a1';
  v := public.t4490f2_night('2030-03-02 00:02', '2030-03-02 00:05');
  PERFORM public.t4490f2_ok(v->>'tz' = 'America/New_York' AND (v->>'before')::bigint = 0 AND (v->>'day')::bigint = 0
      AND (v->>'after')::bigint = 0,
    'F2-DAY6 New York 00:02 sale, 00:05 refund: one service day, nets to 0 ' || v::text);
  v := public.t4490f2_night('2030-03-02 04:59', '2030-03-02 05:01');
  PERFORM public.t4490f2_ok((v->>'before')::bigint = 0 AND (v->>'day')::bigint = 0,
    'F2-DAY7 New York 04:59 sale, 05:01 refund: same service day ' || v::text);
  UPDATE public.brand_hours SET open_time = '18:00', close_time = '02:00'
  WHERE venue_id = '44900500-0000-4000-9000-0000000000a1';
  v := public.t4490f2_night('2030-03-02 03:00', '2030-03-02 03:10');
  PERFORM public.t4490f2_ok((v->>'before')::bigint = 0 AND (v->>'day')::bigint = 0,
    'F2-DAY8 New York, closes at 02:00: 03:00 sale and 03:10 refund on one day ' || v::text);
END
$nights$;
SELECT public.t4490f2_reset();
ALTER TABLE public.venue_offline_payments ENABLE TRIGGER issue_4490_offline_payments_append_only;

-- -------------------------------------------------------------------------
-- 5. Orders (O1-B25): what the queue lists for Till rounds once the Till is
--    off. The queue's own filter (spec 08 §11 T2, useVenueOrders) never reads
--    the Till switch: a sent round is a kitchen order to make (venue
--    collected) whether the Till is on or off; a held round never shows; a
--    voided round is cancelled (Done), never New.
-- -------------------------------------------------------------------------
SELECT public.t4490f2_till(true);
SELECT public.t4490f2_service();
DO $orders$
DECLARE
  v_held_sale uuid := public.t4490f2_check('f2-open-held', 'Held');
  v_held_order uuid;
BEGIN
  -- The Till is switched off after the round was put on a check.
  PERFORM public.t4490f2_till(false);
  SELECT l.venue_order_id INTO v_held_order FROM public.venue_till_lines l
  WHERE l.sale_id = v_held_sale AND l.kind = 'menu_round';
  CREATE TEMP TABLE t4490f2_queue ON COMMIT DROP AS
  SELECT o.id, o.fulfillment_status, o.payment_status FROM public.venue_orders o
  WHERE o.venue_id = '44900500-0000-4000-9000-0000000000a1'
    AND o.fulfillment_status NOT IN ('held', 'payment_only')
    AND (o.metadata->>'tab_settlement' IS NULL OR o.metadata->>'tab_settlement' <> 'true')
    AND (o.money_path = 'venue_collected' OR o.payment_status IN ('paid', 'partial_refund', 'refunded'));
  PERFORM public.t4490f2_ok(NOT EXISTS (SELECT 1 FROM t4490f2_queue WHERE id = v_held_order),
    'F2-OR1 Till off: a round still held on a check (never sent) is not in the Orders queue');
  PERFORM public.t4490f2_ok(EXISTS (
      SELECT 1 FROM t4490f2_queue q JOIN public.venue_till_lines l ON l.venue_order_id = q.id
      JOIN public.venue_till_sales s ON s.id = l.sale_id
      WHERE s.id = (SELECT v FROM t4490f2_ids WHERE k = 'op_sale') AND q.fulfillment_status = 'cancelled'),
    'F2-OR2 Till off: a voided Till round is cancelled (the Done view), never a new order to make');
  PERFORM public.t4490f2_ok(NOT EXISTS (
      SELECT 1 FROM t4490f2_queue q JOIN public.venue_till_lines l ON l.venue_order_id = q.id
      WHERE q.fulfillment_status = 'placed' AND l.state = 'voided'),
    'F2-OR3 no voided Till round is listed as New');
  PERFORM public.t4490f2_ok(EXISTS (
      SELECT 1 FROM t4490f2_queue q JOIN public.venue_till_lines l ON l.venue_order_id = q.id
      WHERE q.fulfillment_status = 'placed' AND q.payment_status = 'paid' AND l.state = 'committed'),
    'F2-OR4 a sent, paid Till round stays in the queue for the kitchen to make, Till on or off');
END
$orders$;
SELECT public.t4490f2_reset();

SELECT public.t4490f2_ok(
  NOT has_function_privilege('authenticated', 'public.issue_4490_till_overpaid_derived(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_overpaid_derived(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_refund_settles()', 'EXECUTE'),
  'F2-G1 the new functions are service-role only');

ROLLBACK;
