-- #4490 spec 08 O4 fix round 3 (spec 08 §15): executable PostgreSQL 17 proof
-- for migration 20281203674490. The suite owns its fixture (the O4 tables/hour
-- fixture, its own ids) and rolls back.
--
-- MINGLA-INVARIANT: I-4490-DEPOSIT-EXCESS-REFUNDED-ONCE | issue #4490 | a paid table deposit larger than the check it is credited on is used only up to the bill; when the check is finished (paid or Close check) the excess goes back to the guest on the booking-refund rail (source_refunds venue_reservation, refund_kind venue_deposit_excess, the deposit's original payment) exactly once; the booking is completed and no other refund of that deposit can be written.
--
-- FAILS-ON-REVERT: with the 608490 finalize (no excess refund) Z3 fails
-- first; with the 608490 refund guard (no excess allowance) the first excess
-- refund is refused (Z3).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490z_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490Z FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490z_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490Z FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490Z FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490z_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490z_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490z_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_ok(boolean,text), public.t4490z_expect(text,text,text,text),
  public.t4490z_as(uuid), public.t4490z_service(), public.t4490z_reset() TO PUBLIC;
CREATE TEMP TABLE t4490z_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490z_ids TO PUBLIC;
CREATE FUNCTION public.t4490z_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490z_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490z_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
CREATE FUNCTION public.t4490z_sale(p_sale uuid) RETURNS public.venue_till_sales LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_v(uuid), public.t4490z_sale(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 05 check-in only staff, 06 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900610-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-fix3-' || n || '@example.test', now(), now()
FROM generate_series(1, 6) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900610-0000-4000-8000-000000000001', now()), ('44900610-0000-4000-8000-000000000006', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900610-0000-4000-9000-000000000010', '44900610-0000-4000-8000-000000000001',
   'Till Fix3 4490', 'till-fix3-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900610-0000-4000-9000-0000000000a1', '44900610-0000-4000-9000-000000000010', 'tillfixc', 'Hour Hall',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900610-0000-4000-9000-000000000010', '44900610-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900610-0000-4000-a000-000000000002', '44900610-0000-4000-9000-000000000010', '44900610-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900610-0000-4000-a000-000000000005', '44900610-0000-4000-9000-000000000010', '44900610-0000-4000-8000-000000000005', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900610-0000-4000-a000-000000000002', '44900610-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900610-0000-4000-a000-000000000005', '44900610-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900610-0000-4000-b000-000000000001', '44900610-0000-4000-9000-000000000010', '44900610-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900610-0000-4000-b000-000000000011', '44900610-0000-4000-b000-000000000001', '44900610-0000-4000-9000-000000000010', 'Chapman', 1000000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900610-0000-4000-9000-0000000000a1', '44900610-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;

-- About noon in the venue's time zone, whenever this runs.
SELECT public.t4490z_service();
SELECT public.issue_4490_ensure_booking_settings('44900610-0000-4000-9000-0000000000a1');
SELECT public.t4490z_reset();
UPDATE public.venue_booking_settings
SET timezone = CASE WHEN 12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer >= 0
                    THEN 'Etc/GMT-' || (12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer)
                    ELSE 'Etc/GMT+' || (extract(hour FROM now() AT TIME ZONE 'UTC')::integer - 12) END
WHERE venue_id = '44900610-0000-4000-9000-0000000000a1';
SELECT public.t4490z_ok(extract(hour FROM now() AT TIME ZONE public.issue_4490_venue_timezone('44900610-0000-4000-9000-0000000000a1')) BETWEEN 11 AND 13,
  'Z-0 fixture: it is about noon in the venue''s time zone');

SELECT public.t4490z_as('44900610-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  a uuid := '44900610-0000-4000-9000-0000000000a1';
  v jsonb;
  s jsonb;
  v_board uuid;
  v_pool uuid;
  v_closed uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a, 'till', true, NULL, NULL, NULL, 'o4z-setup-till-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'menu', true, NULL, NULL, NULL, 'o4z-setup-menu-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'by_the_hour', true, NULL, NULL, NULL, 'o4z-setup-hour-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'table_reservations', true, NULL, NULL, NULL, 'o4z-setup-tables-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'min_spend_tables', true, NULL, NULL, NULL, 'o4z-setup-minspend-on', true);
  -- Boardroom: one room, 30-minute steps, 60-120 minutes, 15 minutes cleanup, staff can start it.
  s := public.issue_4490_manage_space('create', a, '{"name":"Boardroom","setting":"indoor","capacity_seated":10}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Boardroom"}'::jsonb, NULL, 'o4z-setup-board-draft');
  v_board := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_board, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'o4z-setup-board-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_board, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 1200000), (v->>'version')::bigint, 'o4z-setup-board-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_board, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4z-setup-board-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_board, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4z-setup-board-hours');
  v := public.issue_4490_manage_hour('set_length', a, jsonb_build_object('offerId', v_board, 'stepMinutes', 30, 'minMinutes', 60,
    'maxMinutes', 120), (v->>'version')::bigint, 'o4z-setup-board-len');
  v := public.issue_4490_manage_hour('set_rules', a, jsonb_build_object('offerId', v_board, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 15, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'o4z-setup-board-rules');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_board), (v->>'version')::bigint, 'o4z-setup-board-pub');
  -- Pool tables: 3 units, any one, 60-minute steps, staff can start them.
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Pool table"}'::jsonb, NULL, 'o4z-setup-pool-draft');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_pool,
    'units', jsonb_build_object('count', 3, 'name', 'Pool table', 'seats', 4)), (v->>'version')::bigint, 'o4z-setup-pool-units');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_pool, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 4, 'priceMinor', 500000), (v->>'version')::bigint, 'o4z-setup-pool-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_pool, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4z-setup-pool-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_pool, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4z-setup-pool-hours');
  v := public.issue_4490_manage_hour('set_length', a, jsonb_build_object('offerId', v_pool, 'stepMinutes', 60, 'minMinutes', 60,
    'maxMinutes', 240), (v->>'version')::bigint, 'o4z-setup-pool-len');
  v := public.issue_4490_manage_hour('set_rules', a, jsonb_build_object('offerId', v_pool, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 0, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'o4z-setup-pool-rules');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_pool), (v->>'version')::bigint, 'o4z-setup-pool-pub');
  -- A room staff may NOT start.
  s := public.issue_4490_manage_space('create', a, '{"name":"Studio","setting":"indoor","capacity_seated":6}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Studio"}'::jsonb, NULL, 'o4z-setup-studio-draft');
  v_closed := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_closed, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'o4z-setup-studio-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_closed, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 800000), (v->>'version')::bigint, 'o4z-setup-studio-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_closed, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4z-setup-studio-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_closed, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4z-setup-studio-hours');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_closed), (v->>'version')::bigint, 'o4z-setup-studio-pub');
  -- Tables: T1 (minimum spend 50,000.00), T2.
  s := public.issue_4490_manage_space('create', a, '{"name":"Dining room","setting":"indoor","capacity_seated":40}'::jsonb, NULL);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T1', 'capacity', 4, 'minSpendMinor', 5000000,
    'spaceId', s->>'id'), 'o4z-setup-t1');
  INSERT INTO t4490z_ids VALUES ('board', v_board), ('pool', v_pool), ('studio', v_closed), ('t1', (v->>'id')::uuid);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T2', 'capacity', 4, 'spaceId', s->>'id'), 'o4z-setup-t2');
  INSERT INTO t4490z_ids VALUES ('t2', (v->>'id')::uuid);
END
$setup$;
SELECT public.t4490z_reset();
INSERT INTO t4490z_ids
SELECT 'spot_' || t.name, q.id FROM public.qr_spots q JOIN public.venue_tables t ON t.id = q.venue_table_id
WHERE t.venue_id = '44900610-0000-4000-9000-0000000000a1';
INSERT INTO t4490z_ids
SELECT 'pool_unit_' || row_number() OVER (ORDER BY s.sort_order, s.name), s.id
FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
WHERE os.offering_id = public.t4490z_id('pool');

CREATE SEQUENCE public.t4490z_pickup START 101;
GRANT USAGE ON SEQUENCE public.t4490z_pickup TO PUBLIC;
-- A held Till round: n x Chapman 10,000.00 + 10% service charge.
CREATE FUNCTION public.t4490z_round(p_sale uuid, p_qty integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_order uuid := gen_random_uuid();
  v_session uuid;
BEGIN
  SELECT session_id INTO v_session FROM public.venue_till_sales WHERE id = p_sale;
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, v_session, '44900610-0000-4000-9000-000000000010', '44900610-0000-4000-9000-0000000000a1', 'staff',
    '44900610-0000-4000-8000-000000000002', lpad(nextval('public.t4490z_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 1000000 * p_qty, 1000000 * p_qty, 0, 1000, 100000 * p_qty, 0, 0, 0, false, false, false,
    1100000 * p_qty, 1100000 * p_qty, 'pending', 'held', 'till-z-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900610-0000-4000-b000-000000000011', 1, 'Chapman', 1000000, 'NGN', p_qty, 0, 1000000 * p_qty);
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, '44900610-0000-4000-8000-000000000002', NULL);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_round(uuid, integer) TO PUBLIC;
CREATE FUNCTION public.t4490z_open(p_key text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_till_open('44900610-0000-4000-9000-0000000000a1', '44900610-0000-4000-8000-000000000002',
    NULL, NULL, NULL, 'o4z-hour-key:' || p_key)->>'id')::uuid
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_open(text) TO PUBLIC;
CREATE FUNCTION public.t4490z_start(p_sale uuid, p_offer uuid, p_space uuid, p_minutes integer, p_key text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_start_session(p_sale, p_offer, p_space, p_minutes, 2,
    '44900610-0000-4000-8000-000000000002', 'o4z-hour-start:' || p_key,
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_start(uuid, uuid, uuid, integer, text) TO PUBLIC;
CREATE FUNCTION public.t4490z_line(p_sale uuid, p_kind text) RETURNS public.venue_till_lines
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.venue_till_lines WHERE sale_id = p_sale AND kind = p_kind ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_line(uuid, text) TO PUBLIC;

-- Users of this suite: 03 an event manager of the brand (the O4 test's
-- attacker), 04 a guest.
INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
VALUES ('44900610-0000-4000-9000-000000000010', '44900610-0000-4000-8000-000000000003', 'event_manager', now(), now());
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled, fee_enabled, fee_refundable, cancel_cutoff_hours)
VALUES ('44900610-0000-4000-9000-000000000010', '44900610-0000-4000-9000-0000000000a1', true, true, true, 1)
ON CONFLICT (venue_id) DO UPDATE SET fee_refundable = true, cancel_cutoff_hours = 1;
-- A booking whose table deposit was paid online (as the checkout writes it).
CREATE FUNCTION public.t4490z_paid(p_key text, p_table uuid, p_amount integer, p_at timestamptz DEFAULT now())
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_res uuid;
BEGIN
  INSERT INTO public.reservations (brand_id, venue_id, reserved_for, party_size, status, payment_status, source, created_via,
    guest_name, guest_email, guest_phone_e164, table_id, fee_cents, fee_currency, payment_intent_id)
  VALUES ('44900610-0000-4000-9000-000000000010', '44900610-0000-4000-9000-0000000000a1', p_at, 2, 'confirmed', 'paid',
    'website', 'guest', 'Guest ' || p_key, p_key || '@example.test', '+2348030004490', p_table, p_amount, 'NGN', 'pay_' || p_key)
  RETURNING id INTO v_res;
  INSERT INTO public.reservation_checkout_sessions (brand_id, venue_id, reservation_id, reserved_for, party_size, buyer_name,
    buyer_email, buyer_phone_e164, amount_cents, currency, created_via, status, application_fee_amount_cents,
    paystack_reference, guest_cancel_token_hash)
  VALUES ('44900610-0000-4000-9000-000000000010', '44900610-0000-4000-9000-0000000000a1', v_res, p_at, 2, 'Guest ' || p_key,
    p_key || '@example.test', '+2348030004490', p_amount, 'NGN', 'web', 'completed', 0, 'mingla_resv_' || p_key,
    'v1:' || encode(extensions.digest('tok-' || p_key, 'sha256'), 'hex'));
  RETURN v_res;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_paid(text, uuid, integer, timestamptz) TO PUBLIC;
CREATE FUNCTION public.t4490z_res(p_res uuid) RETURNS public.reservations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.reservations WHERE id = p_res
$f$;
CREATE FUNCTION public.t4490z_refunds(p_res uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT count(*) FROM public.source_refunds WHERE source_type = 'venue_reservation' AND subject_id = p_res
$f$;
CREATE FUNCTION public.t4490z_live_credit(p_res uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT count(*) FROM public.venue_till_lines WHERE reservation_id = p_res AND kind = 'deposit_credit' AND state <> 'voided'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_res(uuid), public.t4490z_refunds(uuid), public.t4490z_live_credit(uuid) TO PUBLIC;

CREATE FUNCTION public.t4490z_day(p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_venue_money_day('44900610-0000-4000-9000-0000000000a1',
    public.issue_4490_venue_local_date('44900610-0000-4000-9000-0000000000a1') + p_offset)
$f$;
-- What changed in "Paid in today" between two reads.
CREATE FUNCTION public.t4490z_delta(p_before jsonb, p_after jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object(
    'online', (p_after#>>'{paidIn,online}')::bigint - (p_before#>>'{paidIn,online}')::bigint,
    'atVenue', (p_after#>>'{paidIn,atVenue}')::bigint - (p_before#>>'{paidIn,atVenue}')::bigint,
    'tableDeposits', (p_after#>>'{paidIn,tableDeposits}')::bigint - (p_before#>>'{paidIn,tableDeposits}')::bigint,
    'refunded', (p_after#>>'{paidIn,refunded}')::bigint - (p_before#>>'{paidIn,refunded}')::bigint,
    'paidIn', (p_after->>'paidInMinor')::bigint - (p_before->>'paidInMinor')::bigint)
$f$;
-- A share paid by scan whose transfer lands (Mingla money).
CREATE FUNCTION public.t4490z_scan_share(p_sale uuid, p_share uuid, p_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_till_card_prepare_share(p_sale, p_share, '44900610-0000-4000-8000-000000000002',
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale));
  v := public.issue_4490_till_card_start_share(p_sale, p_share, 'scan', 0, '44900610-0000-4000-8000-000000000002', NULL,
    gen_random_uuid(), (v->>'version')::integer,
    jsonb_build_object('provider', 'paystack', 'totalCents', (v->>'amountMinor')::bigint,
      'subtotalCents', (v->>'amountMinor')::bigint - (v->>'serviceChargeMinor')::bigint,
      'serviceChargeCents', (v->>'serviceChargeMinor')::bigint, 'tipCents', 0, 'currency', 'NGN',
      'effectiveTakeRateBps', 0, 'serviceFeeBps', 0, 'minglaFeeCents', 0, 'platformServiceFeeCents', 0,
      'buyerSubtotalCents', (v->>'amountMinor')::bigint, 'taxAmountCents', 0), p_code);
  PERFORM public.issue_4490_till_apply_payment((v->>'paymentId')::uuid);
  RETURN (v->>'paymentId')::uuid;
END
$f$;
CREATE FUNCTION public.t4490z_cash(p_sale uuid, p_amount bigint) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_take_payment(p_sale, 'cash', p_amount, 0, p_amount,
    '44900610-0000-4000-8000-000000000002', NULL, gen_random_uuid(), (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
CREATE FUNCTION public.t4490z_cash_share(p_sale uuid, p_share uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_pay_share(p_sale, p_share, 'cash', (SELECT amount_minor FROM public.venue_till_shares WHERE id = p_share), 0,
    (SELECT amount_minor FROM public.venue_till_shares WHERE id = p_share), '44900610-0000-4000-8000-000000000002', NULL,
    gen_random_uuid(), (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
CREATE FUNCTION public.t4490z_share(p_sale uuid, p_no integer) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_till_shares WHERE sale_id = p_sale AND share_no = p_no
$f$;
-- The booking side: what each booking of a check has recorded, by method.
CREATE FUNCTION public.t4490z_booked(p_sale uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT COALESCE(string_agg(x.m || ':' || x.a, ',' ORDER BY x.m), '')
  FROM (SELECT CASE WHEN o.method = 'till' THEN 'till/' || tp.method ELSE o.method END AS m, sum(o.amount_minor) AS a
        FROM public.venue_offline_payments o
        LEFT JOIN public.venue_till_payments tp ON tp.id = o.till_payment_id
        WHERE o.group_id IN (SELECT l.stay_group_id FROM public.venue_till_lines l WHERE l.sale_id = p_sale)
        GROUP BY 1) x
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_day(integer), public.t4490z_delta(jsonb, jsonb), public.t4490z_scan_share(uuid, uuid, text),
  public.t4490z_cash(uuid, bigint), public.t4490z_cash_share(uuid, uuid), public.t4490z_share(uuid, integer),
  public.t4490z_booked(uuid) TO PUBLIC;
-- More tables for these checks (T3, T4).
CREATE FUNCTION public.t4490z_seat(p_res uuid, p_spot text, p_key text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_till_seat('44900610-0000-4000-9000-0000000000a1', '44900610-0000-4000-8000-000000000002',
    public.t4490z_id(p_spot), NULL, p_res, NULL, NULL, p_key)->>'id')::uuid
$f$;
CREATE FUNCTION public.t4490z_void(p_sale uuid, p_line uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_void(p_sale, p_line, NULL, '44900610-0000-4000-8000-000000000002', 'made wrong', false,
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale)) IS NOT NULL AND true
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_seat(uuid, text, text), public.t4490z_void(uuid, uuid) TO PUBLIC;

CREATE FUNCTION public.t4490z_excess(p_res uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT COALESCE(string_agg(sr.refund_kind || ':' || sr.buyer_refund_requested_cents || ':' || sr.buyer_state, ',' ORDER BY sr.requested_at), 'none')
  FROM public.source_refunds sr WHERE sr.source_type = 'venue_reservation' AND sr.subject_id = p_res
$f$;
CREATE FUNCTION public.t4490z_close(p_sale uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_close_covered(p_sale, '44900610-0000-4000-8000-000000000002',
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
-- A check seated at a table with a paid deposit and n Chapman (10,000.00 + 10%).
CREATE FUNCTION public.t4490z_check(p_key text, p_spot text, p_deposit integer, p_qty integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE r uuid; s uuid;
BEGIN
  r := public.t4490z_paid(p_key, NULL, p_deposit, now() + interval '1 day');
  s := public.t4490z_seat(r, p_spot, 'o4z-seat-' || p_key);
  IF p_qty > 0 THEN PERFORM public.t4490z_round(s, p_qty); END IF;
  PERFORM public.issue_4490_till_reprice(s);
  INSERT INTO t4490z_ids VALUES (p_key || '_res', r), (p_key || '_sale', s);
  RETURN s;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490z_excess(uuid), public.t4490z_close(uuid), public.t4490z_check(text, text, integer, integer) TO PUBLIC;

-- -------------------------------------------------------------------------
-- Z. Spec 08 §15: the unused part of a deposit goes back to the guest, once.
-- -------------------------------------------------------------------------
SELECT public.t4490z_service();
DO $less$
DECLARE
  s uuid := public.t4490z_check('z1', 'spot_T1', 500000, 1);
  v jsonb;
BEGIN
  PERFORM public.t4490z_ok((public.t4490z_sale(s)).total_due_minor = 600000, 'Z1-0 deposit 5,000.00 on an 11,000.00 bill: 6,000.00 to pay');
  v := public.t4490z_cash(s, 600000);
  PERFORM public.t4490z_ok((v->>'salePaid')::boolean AND public.t4490z_excess(public.t4490z_id('z1_res')) = 'none'
      AND (public.t4490z_res(public.t4490z_id('z1_res'))).status = 'completed',
    'Z1 deposit below the bill: paid in cash, no refund row, the booking completed');
  -- 3c: a refund of a later payment on that check never re-triggers a deposit refund.
  PERFORM public.issue_4490_till_refund((v->>'paymentId')::uuid, 100000, 0, 'Paid twice', false,
    '44900610-0000-4000-8000-000000000001', NULL, gen_random_uuid());
  PERFORM public.t4490z_ok(public.t4490z_excess(public.t4490z_id('z1_res')) = 'none',
    'Z3c refunding 1,000.00 of the cash payment afterwards writes no deposit refund');
END
$less$;
SELECT public.t4490z_reset();

SELECT public.t4490z_service();
DO $equal$
DECLARE
  s uuid := public.t4490z_check('z2', 'spot_T1', 1100000, 1);
  v jsonb;
BEGIN
  v := public.t4490z_close(s);
  PERFORM public.t4490z_ok((v->>'closed')::boolean AND public.t4490z_excess(public.t4490z_id('z2_res')) = 'none'
      AND (v->>'depositRefundMinor') IS NULL,
    'Z2 deposit exactly the bill (11,000.00): Close check, nothing refunded');
  s := public.t4490z_check('z3', 'spot_T1', 1100001, 1);
  v := public.t4490z_close(s);
  PERFORM public.t4490z_ok(public.t4490z_excess(public.t4490z_id('z3_res')) = 'venue_deposit_excess:1:queued'
      AND (v->>'depositRefundMinor')::bigint = 1,
    'Z3 deposit one kobo above the bill: Close check refunds that one kobo, once');
END
$equal$;
SELECT public.t4490z_reset();

SELECT public.t4490z_service();
DO $more$
DECLARE
  b0 jsonb := public.t4490z_day();
  b1 jsonb;
  s uuid := public.t4490z_check('z4', 'spot_T1', 2000000, 1);
  v jsonb;
  v_ref public.source_refunds%ROWTYPE;
BEGIN
  b1 := public.t4490z_day();
  v := public.t4490z_close(s);
  SELECT * INTO v_ref FROM public.source_refunds WHERE subject_id = public.t4490z_id('z4_res');
  PERFORM public.t4490z_ok(v_ref.refund_kind = 'venue_deposit_excess' AND v_ref.buyer_refund_requested_cents = 900000
      AND v_ref.source_id = (SELECT id FROM public.reservation_checkout_sessions WHERE reservation_id = public.t4490z_id('z4_res'))
      AND v_ref.provider = 'paystack' AND v_ref.provider_payment_reference = 'mingla_resv_z4' AND v_ref.buyer_state = 'queued'
      AND v_ref.fee_reversal_required_cents = 0 AND v_ref.organizer_refund_liability_cents = 900000
      AND (SELECT count(*) FROM public.source_refund_ledger_allocations a WHERE a.refund_id = v_ref.id) = 2
      AND (SELECT count(*) FROM public.source_refund_events e WHERE e.refund_id = v_ref.id AND e.event_type = 'requested') = 1
      AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments WHERE sale_id = s),
    'Z4 deposit 20,000.00 on an 11,000.00 bill (service charge in it): Close check, 9,000.00 back on the booking-refund rail (queued to the original Paystack payment), no payment row');
  PERFORM public.t4490z_ok((v->>'creditUsedMinor')::bigint = 1100000 AND (v->>'depositRefundMinor')::bigint = 900000,
    'Z4b the check shows the deposit used (11,000.00) and refunded (9,000.00)');
  PERFORM public.t4490z_ok(public.t4490z_delta(b0, b1) = '{"online":0,"atVenue":0,"tableDeposits":2000000,"refunded":0,"paidIn":2000000}'::jsonb
      AND public.t4490z_delta(b1, public.t4490z_day()) = '{"online":0,"atVenue":0,"tableDeposits":0,"refunded":900000,"paidIn":-900000}'::jsonb,
    'Z3f Paid in today: the deposit counts once when paid; using it is not takings; the excess comes off as a deposit refund '
      || public.t4490z_delta(b1, public.t4490z_day())::text);
  -- 3d: a finished check: its deposit cannot be voided, the close replays, the refund is never written twice.
  PERFORM public.t4490z_expect(format($q$SELECT public.t4490z_void(%L, %L)$q$, s, (public.t4490z_line(s, 'deposit_credit')).id),
    'PT409', NULL, 'Z3d-1 the deposit on a finished check cannot be voided');
  v := public.t4490z_close(s);
  PERFORM public.t4490z_ok((v->>'replayed')::boolean
      AND public.issue_4490_till_refund_deposit_excess(s, '44900610-0000-4000-8000-000000000002') = v_ref.id
      AND (SELECT count(*) FROM public.source_refunds WHERE subject_id = public.t4490z_id('z4_res')) = 1,
    'Z3d-2 closing again replays and the excess refund is never written twice');
END
$more$;
SELECT public.t4490z_reset();
-- 3a: the used part can never be refunded afterwards.
SELECT public.t4490z_as('44900610-0000-4000-8000-000000000003');
SELECT public.t4490z_expect(format($q$SELECT public.biz_venue_cancel_paid_reservation(%L, 'x')$q$, public.t4490z_id('z4_res')),
  'P0001', 'already_refunded', 'Z3a-1 after the check is finished the Host cancel refunds nothing more');
SELECT public.t4490z_expect(format($q$SELECT public.biz_reservation_transition(%L, 'no_show', NULL, 'x')$q$, public.t4490z_id('z4_res')),
  '23514', NULL, 'Z3a-2 ... nor can the completed booking be marked a no-show');
SELECT public.t4490z_reset();
SELECT public.t4490z_ok((SELECT count(*) FROM public.source_refunds WHERE subject_id = public.t4490z_id('z4_res')) = 1
    AND (public.t4490z_res(public.t4490z_id('z4_res'))).status = 'completed',
  'Z3a-3 the booking is completed with its one excess refund');

-- 3a (live credit) and 3b: before the check is finished.
SELECT public.t4490z_service();
SELECT public.t4490z_check('z5', 'spot_T2', 2000000, 1) IS NOT NULL;
SELECT public.t4490z_reset();
SELECT public.t4490z_as('44900610-0000-4000-8000-000000000003');
SELECT public.t4490z_expect(format($q$SELECT public.biz_venue_cancel_paid_reservation(%L, 'x')$q$, public.t4490z_id('z5_res')),
  'P0001', 'seated_no_auto_refund', 'Z3a-4 while the deposit is on the open check a cancel refunds nothing');
SELECT public.t4490z_expect(format($q$SELECT public.biz_reservation_transition(%L, 'no_show', NULL, 'x')$q$, public.t4490z_id('z5_res')),
  'P0001', 'reservation_deposit_used', 'Z3a-5 ... nor a no-show');
SELECT public.t4490z_reset();
SELECT public.t4490z_service();
SELECT public.t4490z_void(public.t4490z_id('z5_sale'), (public.t4490z_line(public.t4490z_id('z5_sale'), 'deposit_credit')).id);
SELECT public.t4490z_reset();
SELECT public.t4490z_as('44900610-0000-4000-8000-000000000003');
SELECT public.biz_venue_cancel_paid_reservation(public.t4490z_id('z5_res'), 'guest left') IS NOT NULL;
SELECT public.t4490z_reset();
SELECT public.t4490z_ok(public.t4490z_excess(public.t4490z_id('z5_res')) = 'venue_staff_cancel:2000000:queued',
  'Z3b deposit voided before the check is finished: unseated, the Host cancel refunds the WHOLE 20,000.00 once, no excess refund');

-- Lines voided after seating: the bill drops below the deposit; the credit follows it.
SELECT public.t4490z_service();
DO $voided$
DECLARE
  s uuid := public.t4490z_check('z6', 'spot_T1', 1500000, 1);
  v_order uuid;
  v jsonb;
BEGIN
  v_order := public.t4490z_round(s, 1);
  PERFORM public.issue_4490_till_reprice(s);
  PERFORM public.t4490z_ok((public.t4490z_sale(s)).total_due_minor = 700000, 'Z6-0 deposit 15,000.00 on 22,000.00: 7,000.00 to pay');
  PERFORM public.t4490z_void(s, (SELECT id FROM public.venue_till_lines WHERE venue_order_id = v_order));
  v := public.issue_4490_till_sale_projection(s);
  PERFORM public.t4490z_ok((v->>'totalDueMinor')::bigint = 0 AND (v->>'creditUsedMinor')::bigint = 1100000,
    'Z6-1 a round voided: the bill is 11,000.00, the credit used follows it (11,000.00 of 15,000.00), nothing to pay');
  v := public.t4490z_close(s);
  PERFORM public.t4490z_ok(public.t4490z_excess(public.t4490z_id('z6_res')) = 'venue_deposit_excess:400000:queued',
    'Z6 Close check refunds the 4,000.00 the bill no longer needs');
END
$voided$;
SELECT public.t4490z_reset();

-- 3e: shares. The deposit comes off before the shares are cut; a deposit below
-- the bill refunds nothing; a bill that drops below it after a split drops the
-- shares, and Close check refunds the excess.
SELECT public.t4490z_service();
DO $shares$
DECLARE
  s uuid := public.t4490z_check('z7', 'spot_T1', 500000, 3);
  v jsonb;
  v_order uuid;
BEGIN
  v := public.issue_4490_till_set_split(s, 'even', '{"count":2}', '44900610-0000-4000-8000-000000000002', public.t4490z_v(s));
  PERFORM public.t4490z_ok((v#>>'{shares,0,amountMinor}')::bigint + (v#>>'{shares,1,amountMinor}')::bigint = 2800000,
    'Z7-0 33,000.00 less the 5,000.00 deposit, split in 2: the shares add up to 28,000.00');
  PERFORM public.t4490z_cash_share(s, public.t4490z_share(s, 1));
  v := public.t4490z_cash_share(s, public.t4490z_share(s, 2));
  PERFORM public.t4490z_ok((v->>'salePaid')::boolean AND public.t4490z_excess(public.t4490z_id('z7_res')) = 'none',
    'Z3e-1 both shares paid: the deposit is used in full, nothing refunded');
  s := public.t4490z_check('z8', 'spot_T1', 1500000, 1);
  v_order := public.t4490z_round(s, 1);
  PERFORM public.issue_4490_till_reprice(s);
  PERFORM public.issue_4490_till_set_split(s, 'even', '{"count":2}', '44900610-0000-4000-8000-000000000002', public.t4490z_v(s));
  PERFORM public.t4490z_void(s, (SELECT id FROM public.venue_till_lines WHERE venue_order_id = v_order));
  PERFORM public.t4490z_ok(NOT EXISTS (SELECT 1 FROM public.venue_till_shares WHERE sale_id = s AND state = 'unpaid'),
    'Z3e-2 a split check whose bill drops below the deposit loses its unpaid shares');
  v := public.t4490z_close(s);
  PERFORM public.t4490z_ok(public.t4490z_excess(public.t4490z_id('z8_res')) = 'venue_deposit_excess:400000:queued',
    'Z3e-3 ... and Close check refunds the 4,000.00 excess (the rule is the same split or not)');
END
$shares$;
SELECT public.t4490z_reset();

-- A refund owed while the deposit's payout is in flight, or with no provider
-- reference, is recorded for ops: never dropped, never queued twice.
SELECT public.t4490z_service();
DO $attention$
DECLARE
  s uuid := public.t4490z_check('z9', 'spot_T1', 2000000, 1);
  r uuid := public.t4490z_id('z9_res');
BEGIN
  UPDATE public.reservation_checkout_sessions SET paystack_reference = NULL WHERE reservation_id = r;
  PERFORM public.t4490z_close(s);
  PERFORM public.t4490z_ok(public.t4490z_excess(r) = 'checkout_provider_reference_unresolved:900000:needs_attention'
      AND (SELECT ops_status || ':' || last_error_code FROM public.source_refunds WHERE subject_id = r) = 'needs_review:payment_reference_missing',
    'Z9 no provider reference: the 9,000.00 is recorded as owed for ops review (needs_attention), the check still closes');
END
$attention$;
SELECT public.t4490z_reset();
SELECT public.t4490z_ok(NOT has_function_privilege('authenticated', 'public.issue_4490_till_refund_deposit_excess(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_till_refund_deposit_excess(uuid,uuid)', 'EXECUTE'),
  'Z10 the excess refund is internal (service role only)');
-- Nobody but the excess path can write a refund while the deposit is live,
-- even with the marker set: only the excess kinds pass.
SELECT public.t4490z_service();
SELECT public.t4490z_check('z11', 'spot_T1', 300000, 1) IS NOT NULL;
SELECT public.t4490z_reset();
SELECT public.t4490z_expect(format($q$SELECT set_config('mingla.issue_4490_deposit_excess', %L, true);
    INSERT INTO public.source_refunds (source_type, source_id, subject_id, brand_id, venue_id, refund_kind, requested_by_type,
      reason, provider, currency, original_charge_cents, buyer_refund_requested_cents, fee_reversal_required_cents, fee_state,
      fee_leg_kind, organizer_refund_liability_cents, platform_fee_absorption_cents, provider_payment_reference, idempotency_key)
    SELECT 'venue_reservation', cs.id, cs.reservation_id, cs.brand_id, cs.venue_id, 'venue_eligible_cancel', 'guest',
      'test', 'paystack', 'NGN', cs.amount_cents, cs.amount_cents, 0, 'not_required', 'not_required', cs.amount_cents, 0,
      cs.paystack_reference, 'z11-test' FROM public.reservation_checkout_sessions cs WHERE cs.reservation_id = %L$q$,
    public.t4490z_id('z11_res'), public.t4490z_id('z11_res')),
  'P0001', 'reservation_deposit_used', 'Z11 with the marker set, a cancel-kind refund of a live deposit is still refused');
ROLLBACK;
