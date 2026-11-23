-- #4490 spec 08 O4 fix round 1: executable PostgreSQL 17 proof for migration
-- 20280809608490 (the four defects of the independent O4 test). The suite
-- owns its fixture (the O4 tables/hour fixture, its own ids) and rolls back.
--
-- MINGLA-INVARIANT: I-4490-DEPOSIT-REFUND-READS-LIVE-CREDIT | issue #4490 | while a booking's paid table deposit is live on a Till check (a deposit_credit line that is not voided) no refund obligation for that booking can be written (source_refunds BEFORE INSERT: reservation_deposit_used), whatever reservations.deposit_applied_sale_id says; that stamp is written only by the #4490 Till functions (reservation_deposit_server_owned for anyone else) and the booking cannot leave 'seated' except to 'completed' (reservation_deposit_used).
-- MINGLA-INVARIANT: I-4490-TILL-OFFER-MONEY-BY-PAYMENT | issue #4490 | Till money for an offer line is recorded on its booking split by what paid it (each payment's part against that payment, on its own day and method; the table deposit's part as table_deposit, never counted again in Paid in today); the parts add up to the line exactly; a refund of one payment comes off by that payment's offer part on the refund's day.
-- MINGLA-INVARIANT: I-4490-COVERED-CHECK-CLOSES | issue #4490 | a check the table deposit fully pays (due exactly 0, something bought) is closed by staff with sell rights with no payment row and no money moved; it is refused while anything is due; version-checked; a retry answers the close.
-- MINGLA-INVARIANT: I-4490-STAFF-START-UNIT-FREE-NOW | issue #4490 | a session staff start at the Till claims its unit from now (not only from the rounded start) to its end; a unit in use now is refused offer_space_taken with the time it frees up.
--
-- FAILS-ON-REVERT: with the 607490 refund guard (stamp only) X1-5 fails;
-- without the reservations trigger X1-2 fails; with the 607490 finalize X3-1
-- fails (the deposit counted twice); without the close function X2-2 fails;
-- with the 607490 start_session X4-2 fails (a unit in use is started).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490x_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490X FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490x_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490X FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490X FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490x_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490x_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490x_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_ok(boolean,text), public.t4490x_expect(text,text,text,text),
  public.t4490x_as(uuid), public.t4490x_service(), public.t4490x_reset() TO PUBLIC;
CREATE TEMP TABLE t4490x_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490x_ids TO PUBLIC;
CREATE FUNCTION public.t4490x_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490x_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490x_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
CREATE FUNCTION public.t4490x_sale(p_sale uuid) RETURNS public.venue_till_sales LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_v(uuid), public.t4490x_sale(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 05 check-in only staff, 06 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900608-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-fix-' || n || '@example.test', now(), now()
FROM generate_series(1, 6) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900608-0000-4000-8000-000000000001', now()), ('44900608-0000-4000-8000-000000000006', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900608-0000-4000-9000-000000000010', '44900608-0000-4000-8000-000000000001',
   'Till Fix 4490', 'till-fix-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900608-0000-4000-9000-0000000000a1', '44900608-0000-4000-9000-000000000010', 'tillfixa', 'Hour Hall',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900608-0000-4000-9000-000000000010', '44900608-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900608-0000-4000-a000-000000000002', '44900608-0000-4000-9000-000000000010', '44900608-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900608-0000-4000-a000-000000000005', '44900608-0000-4000-9000-000000000010', '44900608-0000-4000-8000-000000000005', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900608-0000-4000-a000-000000000002', '44900608-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900608-0000-4000-a000-000000000005', '44900608-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900608-0000-4000-b000-000000000001', '44900608-0000-4000-9000-000000000010', '44900608-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900608-0000-4000-b000-000000000011', '44900608-0000-4000-b000-000000000001', '44900608-0000-4000-9000-000000000010', 'Chapman', 1000000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900608-0000-4000-9000-0000000000a1', '44900608-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;

-- About noon in the venue's time zone, whenever this runs.
SELECT public.t4490x_service();
SELECT public.issue_4490_ensure_booking_settings('44900608-0000-4000-9000-0000000000a1');
SELECT public.t4490x_reset();
UPDATE public.venue_booking_settings
SET timezone = CASE WHEN 12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer >= 0
                    THEN 'Etc/GMT-' || (12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer)
                    ELSE 'Etc/GMT+' || (extract(hour FROM now() AT TIME ZONE 'UTC')::integer - 12) END
WHERE venue_id = '44900608-0000-4000-9000-0000000000a1';
SELECT public.t4490x_ok(extract(hour FROM now() AT TIME ZONE public.issue_4490_venue_timezone('44900608-0000-4000-9000-0000000000a1')) BETWEEN 11 AND 13,
  'X-0 fixture: it is about noon in the venue''s time zone');

SELECT public.t4490x_as('44900608-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  a uuid := '44900608-0000-4000-9000-0000000000a1';
  v jsonb;
  s jsonb;
  v_board uuid;
  v_pool uuid;
  v_closed uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a, 'till', true, NULL, NULL, NULL, 'o4x-setup-till-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'menu', true, NULL, NULL, NULL, 'o4x-setup-menu-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'by_the_hour', true, NULL, NULL, NULL, 'o4x-setup-hour-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'table_reservations', true, NULL, NULL, NULL, 'o4x-setup-tables-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'min_spend_tables', true, NULL, NULL, NULL, 'o4x-setup-minspend-on', true);
  -- Boardroom: one room, 30-minute steps, 60-120 minutes, 15 minutes cleanup, staff can start it.
  s := public.issue_4490_manage_space('create', a, '{"name":"Boardroom","setting":"indoor","capacity_seated":10}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Boardroom"}'::jsonb, NULL, 'o4x-setup-board-draft');
  v_board := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_board, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'o4x-setup-board-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_board, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 1200000), (v->>'version')::bigint, 'o4x-setup-board-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_board, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4x-setup-board-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_board, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4x-setup-board-hours');
  v := public.issue_4490_manage_hour('set_length', a, jsonb_build_object('offerId', v_board, 'stepMinutes', 30, 'minMinutes', 60,
    'maxMinutes', 120), (v->>'version')::bigint, 'o4x-setup-board-len');
  v := public.issue_4490_manage_hour('set_rules', a, jsonb_build_object('offerId', v_board, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 15, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'o4x-setup-board-rules');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_board), (v->>'version')::bigint, 'o4x-setup-board-pub');
  -- Pool tables: 3 units, any one, 60-minute steps, staff can start them.
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Pool table"}'::jsonb, NULL, 'o4x-setup-pool-draft');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_pool,
    'units', jsonb_build_object('count', 3, 'name', 'Pool table', 'seats', 4)), (v->>'version')::bigint, 'o4x-setup-pool-units');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_pool, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 4, 'priceMinor', 500000), (v->>'version')::bigint, 'o4x-setup-pool-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_pool, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4x-setup-pool-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_pool, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4x-setup-pool-hours');
  v := public.issue_4490_manage_hour('set_length', a, jsonb_build_object('offerId', v_pool, 'stepMinutes', 60, 'minMinutes', 60,
    'maxMinutes', 240), (v->>'version')::bigint, 'o4x-setup-pool-len');
  v := public.issue_4490_manage_hour('set_rules', a, jsonb_build_object('offerId', v_pool, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 0, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'o4x-setup-pool-rules');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_pool), (v->>'version')::bigint, 'o4x-setup-pool-pub');
  -- A room staff may NOT start.
  s := public.issue_4490_manage_space('create', a, '{"name":"Studio","setting":"indoor","capacity_seated":6}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Studio"}'::jsonb, NULL, 'o4x-setup-studio-draft');
  v_closed := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_closed, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'o4x-setup-studio-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_closed, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 800000), (v->>'version')::bigint, 'o4x-setup-studio-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_closed, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4x-setup-studio-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_closed, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4x-setup-studio-hours');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_closed), (v->>'version')::bigint, 'o4x-setup-studio-pub');
  -- Tables: T1 (minimum spend 50,000.00), T2.
  s := public.issue_4490_manage_space('create', a, '{"name":"Dining room","setting":"indoor","capacity_seated":40}'::jsonb, NULL);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T1', 'capacity', 4, 'minSpendMinor', 5000000,
    'spaceId', s->>'id'), 'o4x-setup-t1');
  INSERT INTO t4490x_ids VALUES ('board', v_board), ('pool', v_pool), ('studio', v_closed), ('t1', (v->>'id')::uuid);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T2', 'capacity', 4, 'spaceId', s->>'id'), 'o4x-setup-t2');
  INSERT INTO t4490x_ids VALUES ('t2', (v->>'id')::uuid);
END
$setup$;
SELECT public.t4490x_reset();
INSERT INTO t4490x_ids
SELECT 'spot_' || t.name, q.id FROM public.qr_spots q JOIN public.venue_tables t ON t.id = q.venue_table_id
WHERE t.venue_id = '44900608-0000-4000-9000-0000000000a1';
INSERT INTO t4490x_ids
SELECT 'pool_unit_' || row_number() OVER (ORDER BY s.sort_order, s.name), s.id
FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
WHERE os.offering_id = public.t4490x_id('pool');

CREATE SEQUENCE public.t4490x_pickup START 101;
GRANT USAGE ON SEQUENCE public.t4490x_pickup TO PUBLIC;
-- A held Till round: n x Chapman 10,000.00 + 10% service charge.
CREATE FUNCTION public.t4490x_round(p_sale uuid, p_qty integer) RETURNS uuid
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
    v_order, v_session, '44900608-0000-4000-9000-000000000010', '44900608-0000-4000-9000-0000000000a1', 'staff',
    '44900608-0000-4000-8000-000000000002', lpad(nextval('public.t4490x_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 1000000 * p_qty, 1000000 * p_qty, 0, 1000, 100000 * p_qty, 0, 0, 0, false, false, false,
    1100000 * p_qty, 1100000 * p_qty, 'pending', 'held', 'till-x-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900608-0000-4000-b000-000000000011', 1, 'Chapman', 1000000, 'NGN', p_qty, 0, 1000000 * p_qty);
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, '44900608-0000-4000-8000-000000000002', NULL);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_round(uuid, integer) TO PUBLIC;
CREATE FUNCTION public.t4490x_open(p_key text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_till_open('44900608-0000-4000-9000-0000000000a1', '44900608-0000-4000-8000-000000000002',
    NULL, NULL, NULL, 'o4x-hour-key:' || p_key)->>'id')::uuid
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_open(text) TO PUBLIC;
CREATE FUNCTION public.t4490x_start(p_sale uuid, p_offer uuid, p_space uuid, p_minutes integer, p_key text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_start_session(p_sale, p_offer, p_space, p_minutes, 2,
    '44900608-0000-4000-8000-000000000002', 'o4x-hour-start:' || p_key,
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_start(uuid, uuid, uuid, integer, text) TO PUBLIC;
CREATE FUNCTION public.t4490x_line(p_sale uuid, p_kind text) RETURNS public.venue_till_lines
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.venue_till_lines WHERE sale_id = p_sale AND kind = p_kind ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_line(uuid, text) TO PUBLIC;

-- Users of this suite: 03 an event manager of the brand (the O4 test's
-- attacker), 04 a guest.
INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
VALUES ('44900608-0000-4000-9000-000000000010', '44900608-0000-4000-8000-000000000003', 'event_manager', now(), now());
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled, fee_enabled, fee_refundable, cancel_cutoff_hours)
VALUES ('44900608-0000-4000-9000-000000000010', '44900608-0000-4000-9000-0000000000a1', true, true, true, 1)
ON CONFLICT (venue_id) DO UPDATE SET fee_refundable = true, cancel_cutoff_hours = 1;
-- A booking whose table deposit was paid online (as the checkout writes it).
CREATE FUNCTION public.t4490x_paid(p_key text, p_table uuid, p_amount integer, p_at timestamptz DEFAULT now())
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_res uuid;
BEGIN
  INSERT INTO public.reservations (brand_id, venue_id, reserved_for, party_size, status, payment_status, source, created_via,
    guest_name, guest_email, guest_phone_e164, table_id, fee_cents, fee_currency, payment_intent_id)
  VALUES ('44900608-0000-4000-9000-000000000010', '44900608-0000-4000-9000-0000000000a1', p_at, 2, 'confirmed', 'paid',
    'website', 'guest', 'Guest ' || p_key, p_key || '@example.test', '+2348030004490', p_table, p_amount, 'NGN', 'pay_' || p_key)
  RETURNING id INTO v_res;
  INSERT INTO public.reservation_checkout_sessions (brand_id, venue_id, reservation_id, reserved_for, party_size, buyer_name,
    buyer_email, buyer_phone_e164, amount_cents, currency, created_via, status, application_fee_amount_cents,
    paystack_reference, guest_cancel_token_hash)
  VALUES ('44900608-0000-4000-9000-000000000010', '44900608-0000-4000-9000-0000000000a1', v_res, p_at, 2, 'Guest ' || p_key,
    p_key || '@example.test', '+2348030004490', p_amount, 'NGN', 'web', 'completed', 0, 'mingla_resv_' || p_key,
    'v1:' || encode(extensions.digest('tok-' || p_key, 'sha256'), 'hex'));
  RETURN v_res;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_paid(text, uuid, integer, timestamptz) TO PUBLIC;
CREATE FUNCTION public.t4490x_res(p_res uuid) RETURNS public.reservations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.reservations WHERE id = p_res
$f$;
CREATE FUNCTION public.t4490x_refunds(p_res uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT count(*) FROM public.source_refunds WHERE source_type = 'venue_reservation' AND subject_id = p_res
$f$;
CREATE FUNCTION public.t4490x_live_credit(p_res uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT count(*) FROM public.venue_till_lines WHERE reservation_id = p_res AND kind = 'deposit_credit' AND state <> 'voided'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_res(uuid), public.t4490x_refunds(uuid), public.t4490x_live_credit(uuid) TO PUBLIC;

-- -------------------------------------------------------------------------
-- X1. O4-T1: a deposit on a check is never also refunded.
-- -------------------------------------------------------------------------
SELECT public.t4490x_service();
DO $seat$
DECLARE
  v jsonb;
  r uuid := public.t4490x_paid('x1', public.t4490x_id('t2'), 500000, now() + interval '1 day');
BEGIN
  v := public.issue_4490_till_seat('44900608-0000-4000-9000-0000000000a1', '44900608-0000-4000-8000-000000000002',
    public.t4490x_id('spot_T2'), NULL, r, NULL, NULL, 'o4x-seat-x1');
  PERFORM public.t4490x_round((v->>'id')::uuid, 2);
  INSERT INTO t4490x_ids VALUES ('x1_res', r), ('x1_sale', (v->>'id')::uuid);
  PERFORM public.t4490x_ok((public.t4490x_res(r)).status = 'seated' AND (public.t4490x_res(r)).deposit_applied_sale_id = (v->>'id')::uuid
      AND public.t4490x_live_credit(r) = 1,
    'X1-1 fixture: a booking with a 5,000.00 deposit is seated at the Till; the deposit is on the check');
END
$seat$;
SELECT public.t4490x_reset();

-- The O4 test's attack, step by step, as the brand's event manager through
-- RLS (what PostgREST runs for PATCH /rest/v1/reservations).
SELECT public.t4490x_as('44900608-0000-4000-8000-000000000003');
SELECT public.t4490x_expect(format($q$UPDATE public.reservations SET deposit_applied_sale_id = NULL WHERE id = %L$q$, public.t4490x_id('x1_res')),
  '42501', 'reservation_deposit_server_owned', 'X1-2 an event manager cannot clear the deposit stamp (server-owned)');
SELECT public.t4490x_expect(format($q$UPDATE public.reservations SET deposit_applied_sale_id = %L WHERE id = %L$q$,
    gen_random_uuid(), public.t4490x_id('x1_res')),
  '42501', 'reservation_deposit_server_owned', 'X1-2b ... nor point it at another check');
SELECT public.t4490x_expect(format($q$UPDATE public.reservations SET status = 'confirmed' WHERE id = %L$q$, public.t4490x_id('x1_res')),
  'P0001', 'reservation_deposit_used', 'X1-3 a booking whose deposit is on a check cannot be moved back to confirmed');
SELECT public.t4490x_expect(format($q$UPDATE public.reservations SET deposit_applied_sale_id = NULL, status = 'confirmed' WHERE id = %L$q$,
    public.t4490x_id('x1_res')),
  '42501', 'reservation_deposit_server_owned', 'X1-4 the O4 test''s one-PATCH attack (stamp NULL + confirmed) is refused');
SELECT public.t4490x_expect(format($q$SELECT public.biz_venue_cancel_paid_reservation(%L, 'x')$q$, public.t4490x_id('x1_res')),
  'P0001', 'seated_no_auto_refund', 'X1-4b the paid cancel still refuses a seated booking (its own rule, unchanged)');
SELECT public.t4490x_expect(format($q$SELECT public.biz_reservation_transition(%L, 'cancelled_by_venue', NULL, 'x')$q$, public.t4490x_id('x1_res')),
  'P0001', 'reservation_deposit_used', 'X1-4c the plain transition cannot cancel it while its deposit is on the check');
SELECT public.t4490x_expect(format($q$SELECT public.biz_reservation_transition(%L, 'no_show', NULL, 'x')$q$, public.t4490x_id('x1_res')),
  'P0001', 'reservation_deposit_used', 'X1-4d ... nor mark it a no-show');
SELECT public.t4490x_expect(format($q$INSERT INTO public.reservations (brand_id, venue_id, reserved_for, party_size, status, source,
    created_via, guest_name, deposit_applied_sale_id) VALUES ('44900608-0000-4000-9000-000000000010',
    '44900608-0000-4000-9000-0000000000a1', now(), 2, 'confirmed', 'phone', 'operator', 'Stamp', %L)$q$, public.t4490x_id('x1_sale')),
  '42501', 'reservation_deposit_server_owned', 'X1-4e a new booking cannot be written with the stamp set');
DO $legit$
BEGIN
  -- The writes managers make every day still work on that booking.
  UPDATE public.reservations SET guest_notes = 'Window seat', party_size = 3 WHERE id = public.t4490x_id('x1_res');
  PERFORM public.t4490x_ok((public.t4490x_res(public.t4490x_id('x1_res'))).party_size = 3
      AND (public.t4490x_res(public.t4490x_id('x1_res'))).guest_notes = 'Window seat',
    'X1-6 ordinary manager edits (notes, party size) of that booking still save');
END
$legit$;
SELECT public.t4490x_reset();

-- (a) on its own: even with the stamp cleared and the booking moved back by
-- a path that bypassed the trigger, the live credit line refuses the refund.
ALTER TABLE public.reservations DISABLE TRIGGER issue_4490_reservation_deposit_owned_upd;
UPDATE public.reservations SET deposit_applied_sale_id = NULL, status = 'confirmed' WHERE id = public.t4490x_id('x1_res');
ALTER TABLE public.reservations ENABLE TRIGGER issue_4490_reservation_deposit_owned_upd;
SELECT public.t4490x_as('44900608-0000-4000-8000-000000000003');
SELECT public.t4490x_expect(format($q$SELECT public.biz_venue_cancel_paid_reservation(%L, 'x')$q$, public.t4490x_id('x1_res')),
  'P0001', 'reservation_deposit_used',
  'X1-5 stamp cleared and booking confirmed behind the trigger''s back: the paid cancel is still refused (the live credit line decides)');
SELECT public.t4490x_reset();
SELECT public.t4490x_ok(public.t4490x_refunds(public.t4490x_id('x1_res')) = 0 AND public.t4490x_live_credit(public.t4490x_id('x1_res')) = 1
    AND (public.t4490x_res(public.t4490x_id('x1_res'))).status = 'confirmed',
  'X1-5b nothing was refunded and nothing was cancelled (the cancel rolled back whole)');
SELECT public.t4490x_expect(format($q$SELECT public.pg_prepare_guest_venue_cancellation_refund(%L, 'tok-x1')$q$, public.t4490x_id('x1_res')),
  'P0001', 'reservation_deposit_used', 'X1-5c the guest''s own cancel link is refused too (same guard)');
-- Put the stamp back the way the Till wrote it (behind the trigger, test only).
ALTER TABLE public.reservations DISABLE TRIGGER issue_4490_reservation_deposit_owned_upd;
UPDATE public.reservations SET deposit_applied_sale_id = public.t4490x_id('x1_sale'), status = 'seated' WHERE id = public.t4490x_id('x1_res');
ALTER TABLE public.reservations ENABLE TRIGGER issue_4490_reservation_deposit_owned_upd;

-- Voiding the credit (the one way a live deposit leaves a check) gives the
-- deposit back to its booking: refundable again, exactly once.
SELECT public.t4490x_service();
DO $void$
DECLARE
  v jsonb;
  r uuid := public.t4490x_id('x1_res');
  s uuid := public.t4490x_id('x1_sale');
BEGIN
  v := public.issue_4490_till_void(s, (public.t4490x_line(s, 'deposit_credit')).id, NULL,
    '44900608-0000-4000-8000-000000000002', 'guest wants it back', false, public.t4490x_v(s));
  PERFORM public.t4490x_ok((public.t4490x_res(r)).deposit_applied_sale_id IS NULL AND public.t4490x_live_credit(r) = 0
      AND (public.t4490x_sale(s)).credit_minor = 0,
    'X1-7 voiding the credit line clears the stamp (the Till''s own path is allowed) and the deposit leaves the bill');
END
$void$;
SELECT public.t4490x_reset();
SELECT public.t4490x_as('44900608-0000-4000-8000-000000000003');
DO $again$
DECLARE
  v jsonb;
BEGIN
  UPDATE public.reservations SET status = 'confirmed' WHERE id = public.t4490x_id('x1_res');
  v := public.biz_venue_cancel_paid_reservation(public.t4490x_id('x1_res'), 'guest left');
  PERFORM public.t4490x_ok(v->'refund' IS NOT NULL AND public.t4490x_refunds(public.t4490x_id('x1_res')) = 1,
    'X1-8 once the credit is voided, the booking''s own rules apply again: cancelled with its refund (one refund row)');
  BEGIN
    v := public.biz_venue_cancel_paid_reservation(public.t4490x_id('x1_res'), 'guest left');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'X1-8b second cancel answered % %', SQLSTATE, SQLERRM;
  END;
  PERFORM public.t4490x_ok(public.t4490x_refunds(public.t4490x_id('x1_res')) = 1,
    'X1-8b cancelling it again refunds nothing more');
END
$again$;
SELECT public.t4490x_reset();
SELECT public.t4490x_service();
SELECT public.t4490x_expect(format($q$SELECT public.issue_4490_till_seat('44900608-0000-4000-9000-0000000000a1',
    '44900608-0000-4000-8000-000000000002', %L, NULL, %L, NULL, NULL, 'o4x-seat-x1b')$q$, public.t4490x_id('spot_T1'), public.t4490x_id('x1_res')),
  'P0002', 'till_booking_not_found', 'X1-8c a refunded booking can never be put on a check again');
SELECT public.t4490x_reset();

-- Completing a seated booking still works while its deposit is on the check.
SELECT public.t4490x_service();
DO $complete$
DECLARE
  v jsonb;
  r uuid := public.t4490x_paid('x1c', public.t4490x_id('t1'), 300000);
BEGIN
  v := public.issue_4490_till_seat('44900608-0000-4000-9000-0000000000a1', '44900608-0000-4000-8000-000000000002',
    public.t4490x_id('spot_T1'), NULL, r, NULL, NULL, 'o4x-seat-x1c');
  INSERT INTO t4490x_ids VALUES ('x1c_res', r), ('x1c_sale', (v->>'id')::uuid);
END
$complete$;
SELECT public.t4490x_reset();
SELECT public.t4490x_as('44900608-0000-4000-8000-000000000003');
DO $complete2$
BEGIN
  PERFORM public.biz_reservation_transition(public.t4490x_id('x1c_res'), 'completed', NULL, 'left happy');
  PERFORM public.t4490x_ok((public.t4490x_res(public.t4490x_id('x1c_res'))).status = 'completed'
      AND public.t4490x_live_credit(public.t4490x_id('x1c_res')) = 1,
    'X1-9 a seated booking with its deposit on the check can still be completed');
END
$complete2$;
SELECT public.t4490x_reset();

-- No deposit on any check: a paid booking cancels with its refund as before.
SELECT public.t4490x_service();
SELECT public.t4490x_paid('x1n', NULL, 200000) IS NOT NULL;
INSERT INTO t4490x_ids SELECT 'x1n_res', id FROM public.reservations WHERE guest_name = 'Guest x1n';
SELECT public.t4490x_reset();
SELECT public.t4490x_as('44900608-0000-4000-8000-000000000003');
DO $plain$
DECLARE
  v jsonb;
BEGIN
  v := public.biz_venue_cancel_paid_reservation(public.t4490x_id('x1n_res'), 'venue closed');
  PERFORM public.t4490x_ok(v->'refund' IS NOT NULL AND public.t4490x_refunds(public.t4490x_id('x1n_res')) = 1
      AND (public.t4490x_res(public.t4490x_id('x1n_res'))).status = 'cancelled_by_venue',
    'X1-10 a paid booking with no deposit on a check cancels with its refund (unchanged)');
END
$plain$;
SELECT public.t4490x_reset();
ROLLBACK;
