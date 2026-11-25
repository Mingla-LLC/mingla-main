-- #4490 spec 08 O4 fix round 1: executable PostgreSQL 17 proof for migration
-- 20281203654490 (the four defects of the independent O4 test). The suite
-- owns its fixture (the O4 tables/hour fixture, its own ids) and rolls back.
--
-- MINGLA-INVARIANT: I-4490-DEPOSIT-REFUND-READS-LIVE-CREDIT | issue #4490 | while a booking's paid table deposit is live on a Till check (a deposit_credit line that is not voided) no refund obligation for that booking can be written (source_refunds BEFORE INSERT: reservation_deposit_used), whatever reservations.deposit_applied_sale_id says; that stamp is written only by the #4490 Till functions (reservation_deposit_server_owned for anyone else) and the booking cannot leave 'seated' except to 'completed' (reservation_deposit_used).
-- MINGLA-INVARIANT: I-4490-TILL-OFFER-MONEY-BY-PAYMENT | issue #4490 | Till money for an offer line is recorded on its booking split by what paid it (each payment's part against that payment, on its own day and method; the table deposit's part as table_deposit, never counted again in Paid in today); the parts add up to the line exactly; a refund of one payment comes off by that payment's offer part on the refund's day.
-- MINGLA-INVARIANT: I-4490-COVERED-CHECK-CLOSES | issue #4490 | a check the table deposit fully pays (due exactly 0, something bought) is closed by staff with sell rights with no payment row and no money moved; it is refused while anything is due; version-checked; a retry answers the close.
-- MINGLA-INVARIANT: I-4490-STAFF-START-UNIT-FREE-NOW | issue #4490 | a session staff start at the Till claims its unit from now (not only from the rounded start) to its end; a unit in use now is refused offer_space_taken with the time it frees up.
--
-- FAILS-ON-REVERT: with the 607490 refund guard (stamp only) X1-5 fails;
-- without the reservations triggers X1-2 fails; without the seated rule X1-3
-- fails; with the 607490 finalize (or the 589490 money day) X3-1 fails (the
-- deposit counted twice); with part payments dated at finalize X3-5 fails;
-- without the close function X2-2a fails; with the 607490 start_session X4-1
-- fails (a unit in use is started).
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

-- -------------------------------------------------------------------------
-- X4. O4-T4: a session staff start needs its unit free from NOW.
-- -------------------------------------------------------------------------
-- The pool table's day window is moved so that "now" sits 45 minutes into a
-- 60-minute step (the start rounds UP to now + about 15 minutes), whatever
-- the clock says when the suite runs; restored at the end.
CREATE TEMP TABLE t4490x_window (id uuid, starts_at timestamptz) ON COMMIT DROP;
GRANT ALL ON t4490x_window TO PUBLIC;
INSERT INTO t4490x_window
SELECT w.id, w.starts_at FROM public.stay_place_windows w
JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id AND r.active AND r.mode = 'flexible'
WHERE w.offering_id = public.t4490x_id('pool') AND NOT w.booked_block AND NOT w.stop_sell
  AND now() >= w.starts_at AND now() < w.ends_at;
SELECT public.t4490x_ok((SELECT count(*) FROM t4490x_window) = 1, 'X4-0 fixture: the pool tables have one day window open now');
CREATE FUNCTION public.t4490x_window_at(p_minutes_into integer) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  UPDATE public.stay_place_windows SET starts_at = date_trunc('minute', now()) - make_interval(mins => p_minutes_into)
  WHERE id = (SELECT id FROM t4490x_window)
$f$;
-- Pool table 1 is in use: its current booking (a block here) ends in 5 minutes.
CREATE FUNCTION public.t4490x_block(p_from timestamptz, p_to timestamptz) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  INSERT INTO public.venue_space_claims (space_id, source, booked_range, claim_range, state, block_reason)
  VALUES (public.t4490x_id('pool_unit_1'), 'block', tstzrange(p_from, p_to, '[)'), tstzrange(p_from, p_to, '[)'), 'committed', 'o4x test booking')
  RETURNING id
$f$;
CREATE FUNCTION public.t4490x_refusal(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE
  v_detail text;
BEGIN
  EXECUTE p_sql;
  RETURN jsonb_build_object('error', null);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN jsonb_build_object('error', SQLERRM, 'state', SQLSTATE, 'detail', NULLIF(v_detail, '')::jsonb);
END
$f$;
CREATE FUNCTION public.t4490x_void_session(p_sale uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_void(p_sale, (SELECT id FROM public.venue_till_lines WHERE sale_id = p_sale AND kind = 'by_the_hour' LIMIT 1),
    NULL, '44900608-0000-4000-8000-000000000002', 'test', false, (SELECT version FROM public.venue_till_sales WHERE id = p_sale)) IS NOT NULL
  AND true
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_window_at(integer), public.t4490x_block(timestamptz, timestamptz),
  public.t4490x_refusal(text), public.t4490x_void_session(uuid) TO PUBLIC;

SELECT public.t4490x_service();
DO $inuse$
DECLARE
  v jsonb;
  v_block uuid;
  v_sale uuid := public.t4490x_open('x4-a');
  v_any uuid := public.t4490x_open('x4-any');
  v_claim public.venue_space_claims%ROWTYPE;
BEGIN
  PERFORM public.t4490x_window_at(45);
  v_block := public.t4490x_block(now() - interval '55 minutes', now() + interval '5 minutes');
  v := public.t4490x_refusal(format($q$SELECT public.t4490x_start(%L, %L, %L, 60, 'x4-a')$q$,
    v_sale, public.t4490x_id('pool'), public.t4490x_id('pool_unit_1')));
  PERFORM public.t4490x_ok(v->>'error' = 'offer_space_taken' AND v->>'state' = 'PT409'
      AND v#>>'{detail,unitName}' = 'Pool table 1'
      AND (v#>>'{detail,freeAt}')::timestamptz = (SELECT upper(claim_range) FROM public.venue_space_claims WHERE id = v_block)
      AND NOT EXISTS (SELECT 1 FROM public.venue_till_lines WHERE sale_id = v_sale),
    'X4-1 at :45 a start on pool table 1, still in use for 5 minutes, is refused (offer_space_taken) with when it frees up '
      || COALESCE(v::text, ''));
  v := public.t4490x_start(v_any, public.t4490x_id('pool'), NULL, 60, 'x4-any');
  SELECT c.* INTO v_claim FROM public.venue_space_claims c
  WHERE c.group_id = (public.t4490x_line(v_any, 'by_the_hour')).stay_group_id;
  PERFORM public.t4490x_ok(v_claim.space_id <> public.t4490x_id('pool_unit_1') AND lower(v_claim.claim_range) <= now()
      AND lower(v_claim.booked_range) > now() AND upper(v_claim.booked_range) - lower(v_claim.booked_range) = interval '60 minutes'
      AND (public.t4490x_line(v_any, 'by_the_hour')).amount_minor = 500000,
    'X4-2 "Any free one" never picks the table in use: another table is held from now; the price is the rounded hour (5,000.00)');
  PERFORM public.t4490x_void_session(v_any);
  -- The booking ends: the same start now goes through, held from now.
  UPDATE public.venue_space_claims SET state = 'released', released_at = now(), release_reason = 'test' WHERE id = v_block;
  v := public.t4490x_start(v_sale, public.t4490x_id('pool'), public.t4490x_id('pool_unit_1'), 60, 'x4-a2');
  SELECT c.* INTO v_claim FROM public.venue_space_claims c
  WHERE c.group_id = (public.t4490x_line(v_sale, 'by_the_hour')).stay_group_id;
  PERFORM public.t4490x_ok(v_claim.space_id = public.t4490x_id('pool_unit_1') AND lower(v_claim.claim_range) <= now()
      AND lower(v_claim.booked_range) > now() AND (public.t4490x_line(v_sale, 'by_the_hour')).amount_minor = 500000
      AND EXISTS (SELECT 1 FROM public.venue_passes p WHERE p.group_id = v_claim.group_id AND p.valid_from <= now()),
    'X4-3 once it is free the start goes through: held from now, admitted now, charged for the rounded hour');
  PERFORM public.t4490x_void_session(v_sale);
END
$inuse$;
SELECT public.t4490x_reset();

SELECT public.t4490x_service();
DO $down$
DECLARE
  v jsonb;
  v_block uuid;
  v_sale uuid := public.t4490x_open('x4-down');
  v_claim public.venue_space_claims%ROWTYPE;
BEGIN
  -- 10 minutes into the step: the start rounds DOWN (it began 10 minutes ago).
  PERFORM public.t4490x_window_at(10);
  v := public.t4490x_start(v_sale, public.t4490x_id('pool'), public.t4490x_id('pool_unit_1'), 60, 'x4-down');
  SELECT c.* INTO v_claim FROM public.venue_space_claims c
  WHERE c.group_id = (public.t4490x_line(v_sale, 'by_the_hour')).stay_group_id;
  PERFORM public.t4490x_ok(lower(v_claim.booked_range) < now() AND lower(v_claim.claim_range) = lower(v_claim.booked_range),
    'X4-4 a start rounded down keeps working (its claim starts at the rounded start, already before now)');
  PERFORM public.t4490x_void_session(v_sale);
  -- Free now but booked before the session would end: the next booking's time.
  v_block := public.t4490x_block(now() + interval '20 minutes', now() + interval '80 minutes');
  v_sale := public.t4490x_open('x4-next');
  v := public.t4490x_refusal(format($q$SELECT public.t4490x_start(%L, %L, %L, 60, 'x4-next')$q$,
    v_sale, public.t4490x_id('pool'), public.t4490x_id('pool_unit_1')));
  PERFORM public.t4490x_ok(v->>'error' = 'offer_space_taken'
      AND (v#>>'{detail,nextAt}')::timestamptz = now() + interval '20 minutes' AND v#>'{detail,freeAt}' = 'null'::jsonb,
    'X4-5 a table free now but booked in 20 minutes is refused with the next booking''s time ' || COALESCE(v::text, ''));
  UPDATE public.venue_space_claims SET state = 'released', released_at = now(), release_reason = 'test' WHERE id = v_block;
  UPDATE public.stay_place_windows SET starts_at = (SELECT starts_at FROM t4490x_window) WHERE id = (SELECT id FROM t4490x_window);
  PERFORM public.t4490x_ok(NOT EXISTS (SELECT 1 FROM public.venue_space_claims c
                                       JOIN public.venue_offer_spaces os ON os.space_id = c.space_id AND os.offering_id = public.t4490x_id('pool')
                                       WHERE c.state IN ('held', 'committed')),
    'X4-6 fixture: every pool table is free again (sessions voided, test bookings released)');
END
$down$;
SELECT public.t4490x_reset();

-- -------------------------------------------------------------------------
-- X3. O4-T3: "Paid in today" counts what each payment actually took.
-- -------------------------------------------------------------------------
CREATE FUNCTION public.t4490x_day(p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_venue_money_day('44900608-0000-4000-9000-0000000000a1',
    public.issue_4490_venue_local_date('44900608-0000-4000-9000-0000000000a1') + p_offset)
$f$;
-- What changed in "Paid in today" between two reads.
CREATE FUNCTION public.t4490x_delta(p_before jsonb, p_after jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object(
    'online', (p_after#>>'{paidIn,online}')::bigint - (p_before#>>'{paidIn,online}')::bigint,
    'atVenue', (p_after#>>'{paidIn,atVenue}')::bigint - (p_before#>>'{paidIn,atVenue}')::bigint,
    'tableDeposits', (p_after#>>'{paidIn,tableDeposits}')::bigint - (p_before#>>'{paidIn,tableDeposits}')::bigint,
    'refunded', (p_after#>>'{paidIn,refunded}')::bigint - (p_before#>>'{paidIn,refunded}')::bigint,
    'paidIn', (p_after->>'paidInMinor')::bigint - (p_before->>'paidInMinor')::bigint)
$f$;
-- A share paid by scan whose transfer lands (Mingla money).
CREATE FUNCTION public.t4490x_scan_share(p_sale uuid, p_share uuid, p_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_till_card_prepare_share(p_sale, p_share, '44900608-0000-4000-8000-000000000002',
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale));
  v := public.issue_4490_till_card_start_share(p_sale, p_share, 'scan', 0, '44900608-0000-4000-8000-000000000002', NULL,
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
CREATE FUNCTION public.t4490x_cash(p_sale uuid, p_amount bigint) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_take_payment(p_sale, 'cash', p_amount, 0, p_amount,
    '44900608-0000-4000-8000-000000000002', NULL, gen_random_uuid(), (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
CREATE FUNCTION public.t4490x_cash_share(p_sale uuid, p_share uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_pay_share(p_sale, p_share, 'cash', (SELECT amount_minor FROM public.venue_till_shares WHERE id = p_share), 0,
    (SELECT amount_minor FROM public.venue_till_shares WHERE id = p_share), '44900608-0000-4000-8000-000000000002', NULL,
    gen_random_uuid(), (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
CREATE FUNCTION public.t4490x_share(p_sale uuid, p_no integer) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_till_shares WHERE sale_id = p_sale AND share_no = p_no
$f$;
-- The booking side: what each booking of a check has recorded, by method.
CREATE FUNCTION public.t4490x_booked(p_sale uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT COALESCE(string_agg(x.m || ':' || x.a, ',' ORDER BY x.m), '')
  FROM (SELECT CASE WHEN o.method = 'till' THEN 'till/' || tp.method ELSE o.method END AS m, sum(o.amount_minor) AS a
        FROM public.venue_offline_payments o
        LEFT JOIN public.venue_till_payments tp ON tp.id = o.till_payment_id
        WHERE o.group_id IN (SELECT l.stay_group_id FROM public.venue_till_lines l WHERE l.sale_id = p_sale)
        GROUP BY 1) x
$f$;
GRANT EXECUTE ON FUNCTION public.t4490x_day(integer), public.t4490x_delta(jsonb, jsonb), public.t4490x_scan_share(uuid, uuid, text),
  public.t4490x_cash(uuid, bigint), public.t4490x_cash_share(uuid, uuid), public.t4490x_share(uuid, integer),
  public.t4490x_booked(uuid) TO PUBLIC;
-- More tables for these checks (T3, T4).
SELECT public.t4490x_as('44900608-0000-4000-8000-000000000001');
SELECT public.issue_4490_manage_table('create', '44900608-0000-4000-9000-0000000000a1',
  jsonb_build_object('name', 'T3', 'capacity', 4, 'spaceId', (SELECT t.space_id FROM public.venue_tables t WHERE t.id = public.t4490x_id('t1'))), 'o4x-setup-t3') IS NOT NULL;
SELECT public.t4490x_reset();
INSERT INTO t4490x_ids
SELECT 'spot_' || t.name, q.id FROM public.qr_spots q JOIN public.venue_tables t ON t.id = q.venue_table_id
WHERE t.venue_id = '44900608-0000-4000-9000-0000000000a1' AND t.name = 'T3';

SELECT public.t4490x_service();
DO $deposit$
DECLARE
  v jsonb;
  b0 jsonb := public.t4490x_day();
  b1 jsonb;
  b2 jsonb;
  r uuid;
  v_sale uuid;
  v_group uuid;
BEGIN
  r := public.t4490x_paid('x3', public.t4490x_id('t3'), 500000);
  b1 := public.t4490x_day();
  v := public.issue_4490_till_seat('44900608-0000-4000-9000-0000000000a1', '44900608-0000-4000-8000-000000000002',
    public.t4490x_id('spot_T3'), NULL, r, NULL, NULL, 'o4x-seat-x3');
  v_sale := (v->>'id')::uuid;
  v := public.t4490x_start(v_sale, public.t4490x_id('board'), NULL, 60, 'x3-board');
  PERFORM public.t4490x_ok((v->>'totalDueMinor')::bigint = 700000 AND (v->>'creditMinor')::bigint = 500000,
    'X3-0 fixture: a 12,000.00 Boardroom hour on a check with a 5,000.00 deposit: 7,000.00 to pay');
  v := public.t4490x_cash(v_sale, 700000);
  b2 := public.t4490x_day();
  v_group := (public.t4490x_line(v_sale, 'by_the_hour')).stay_group_id;
  PERFORM public.t4490x_ok(public.t4490x_delta(b0, b1) = '{"online":0,"atVenue":0,"tableDeposits":500000,"refunded":0,"paidIn":500000}'::jsonb,
    'X3-1a the deposit paid online counts once, as a table deposit, the day it is paid ' || public.t4490x_delta(b0, b1)::text);
  PERFORM public.t4490x_ok(public.t4490x_delta(b1, b2) = '{"online":0,"atVenue":700000,"tableDeposits":0,"refunded":0,"paidIn":700000}'::jsonb,
    'X3-1 paying the 7,000.00 left in cash adds 7,000.00 at the venue and nothing online (the deposit is never counted twice) '
      || public.t4490x_delta(b1, b2)::text);
  PERFORM public.t4490x_ok(public.t4490x_booked(v_sale) = 'table_deposit:500000,till/cash:700000'
      AND (SELECT m.balance FROM public.issue_4490_booking_money(v_group) m) = 0,
    'X3-1b the session''s booking holds 7,000.00 cash + 5,000.00 paid by the deposit: fully paid, nothing due twice '
      || public.t4490x_booked(v_sale));
END
$deposit$;
SELECT public.t4490x_reset();

SELECT public.t4490x_service();
DO $split$
DECLARE
  v jsonb;
  b0 jsonb;
  b1 jsonb;
  b2 jsonb;
  v_sale uuid := public.t4490x_open('x3-split');
  v_cash uuid;
BEGIN
  PERFORM public.t4490x_start(v_sale, public.t4490x_id('pool'), NULL, 60, 'x3-split');
  PERFORM public.issue_4490_till_set_split(v_sale, 'even', '{"count":2}', '44900608-0000-4000-8000-000000000002', public.t4490x_v(v_sale));
  b0 := public.t4490x_day();
  PERFORM public.t4490x_scan_share(v_sale, public.t4490x_share(v_sale, 1), 'XTHREEAA');
  v := public.t4490x_cash_share(v_sale, public.t4490x_share(v_sale, 2));
  v_cash := (v->>'paymentId')::uuid;
  b1 := public.t4490x_day();
  PERFORM public.t4490x_ok((v->>'salePaid')::boolean
      AND public.t4490x_delta(b0, b1) = '{"online":250000,"atVenue":250000,"tableDeposits":0,"refunded":0,"paidIn":500000}'::jsonb,
    'X3-2 a 5,000.00 pool hour split evenly, share 1 by scan and share 2 in cash: 2,500.00 online and 2,500.00 at the venue '
      || public.t4490x_delta(b0, b1)::text);
  -- The cash share is refunded in full: it comes off once, that day.
  PERFORM public.issue_4490_till_refund(v_cash, 250000, 0, 'Guest left', false, '44900608-0000-4000-8000-000000000001',
    NULL, gen_random_uuid());
  b2 := public.t4490x_day();
  PERFORM public.t4490x_ok(public.t4490x_delta(b1, b2) = '{"online":0,"atVenue":0,"tableDeposits":0,"refunded":250000,"paidIn":-250000}'::jsonb,
    'X3-3 refunding the cash share takes 2,500.00 off that day as refunded; the scan share is untouched '
      || public.t4490x_delta(b1, b2)::text);
END
$split$;
SELECT public.t4490x_reset();

SELECT public.t4490x_service();
DO $byitem$
DECLARE
  v jsonb;
  b0 jsonb;
  b1 jsonb;
  v_sale uuid := public.t4490x_open('x3-items');
  v_line uuid;
  v_item uuid;
BEGIN
  PERFORM public.t4490x_start(v_sale, public.t4490x_id('pool'), NULL, 60, 'x3-items');
  PERFORM public.t4490x_round(v_sale, 1);
  PERFORM public.issue_4490_till_send(v_sale, '44900608-0000-4000-8000-000000000002');
  v_line := (public.t4490x_line(v_sale, 'by_the_hour')).id;
  SELECT i.id INTO v_item FROM public.venue_order_items i
  JOIN public.venue_till_lines l ON l.venue_order_id = i.venue_order_id WHERE l.sale_id = v_sale;
  PERFORM public.issue_4490_till_set_split(v_sale, 'by_item',
    jsonb_build_array(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('lineId', v_line, 'units', 1))),
                      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_item, 'units', 1)))),
    '44900608-0000-4000-8000-000000000002', public.t4490x_v(v_sale));
  b0 := public.t4490x_day();
  PERFORM public.t4490x_scan_share(v_sale, public.t4490x_share(v_sale, 1), 'XTHREEBB');
  v := public.t4490x_cash_share(v_sale, public.t4490x_share(v_sale, 2));
  b1 := public.t4490x_day();
  PERFORM public.t4490x_ok((v->>'salePaid')::boolean
      AND public.t4490x_delta(b0, b1) = '{"online":500000,"atVenue":0,"tableDeposits":0,"refunded":0,"paidIn":500000}'::jsonb
      AND public.t4490x_booked(v_sale) = 'till/scan:500000',
    'X3-4 split by item: the guest who took the pool table paid it by scan (5,000.00 online); the drinks share in cash adds nothing '
      || public.t4490x_delta(b0, b1)::text || ' ' || public.t4490x_booked(v_sale));
END
$byitem$;
SELECT public.t4490x_reset();

-- Part payments on different days land on their own days.
SELECT public.t4490x_service();
DO $days$
DECLARE
  v jsonb;
  y0 jsonb;
  t0 jsonb;
  y1 jsonb;
  t1 jsonb;
  v_sale uuid := public.t4490x_open('x3-days');
BEGIN
  PERFORM public.t4490x_start(v_sale, public.t4490x_id('pool'), NULL, 60, 'x3-days');
  y0 := public.t4490x_day(-1);
  t0 := public.t4490x_day();
  v := public.t4490x_cash(v_sale, 200000);
  -- Test only: that part payment was taken yesterday (moved in time inside
  -- this rolled-back transaction).
  UPDATE public.venue_till_payments SET paid_at = now() - interval '1 day' WHERE id = (v->>'paymentId')::uuid;
  v := public.t4490x_cash(v_sale, 300000);
  y1 := public.t4490x_day(-1);
  t1 := public.t4490x_day();
  PERFORM public.t4490x_ok((v->>'salePaid')::boolean
      AND (public.t4490x_delta(y0, y1)->>'atVenue')::bigint = 200000 AND (public.t4490x_delta(t0, t1)->>'atVenue')::bigint = 300000,
    'X3-5 a 2,000.00 part payment yesterday and the 3,000.00 rest today land on their own days '
      || public.t4490x_delta(y0, y1)::text || ' / ' || public.t4490x_delta(t0, t1)::text);
END
$days$;
SELECT public.t4490x_reset();

SELECT public.t4490x_ok(NOT EXISTS (
    SELECT 1 FROM public.venue_till_lines l
    JOIN public.venue_till_sales s ON s.id = l.sale_id AND s.venue_id = '44900608-0000-4000-9000-0000000000a1'
    WHERE l.kind IN ('entry', 'group_package', 'balance', 'by_the_hour') AND l.state IN ('committed', 'refunded')
      AND l.amount_minor <> COALESCE((SELECT sum(o.amount_minor) FROM public.venue_offline_payments o
                                      WHERE o.group_id = l.stay_group_id
                                        AND (o.idempotency_key LIKE 'till-line:' || l.id || ':%'
                                             OR o.idempotency_key = 'till-credit:' || l.id)), 0))
  AND (SELECT count(*) FROM public.venue_till_lines l JOIN public.venue_till_sales s ON s.id = l.sale_id
       WHERE s.venue_id = '44900608-0000-4000-9000-0000000000a1' AND l.kind = 'by_the_hour' AND l.state = 'committed') >= 4,
  'X3-6 on every paid check of this suite, the parts recorded for each offer line add up to the line exactly');


-- -------------------------------------------------------------------------
-- X2. O4-T2: a check the deposit fully pays can be closed (no money moves).
-- -------------------------------------------------------------------------
SELECT public.t4490x_service();
DO $covered$
DECLARE
  v jsonb;
  r uuid := public.t4490x_paid('x2', public.t4490x_id('t3'), 2000000);
  v_sale uuid;
BEGIN
  v := public.issue_4490_till_seat('44900608-0000-4000-9000-0000000000a1', '44900608-0000-4000-8000-000000000002',
    public.t4490x_id('spot_T3'), NULL, r, NULL, NULL, 'o4x-seat-x2');
  v_sale := (v->>'id')::uuid;
  PERFORM public.t4490x_round(v_sale, 1);
  PERFORM public.issue_4490_till_reprice(v_sale);
  INSERT INTO t4490x_ids VALUES ('x2_res', r), ('x2_sale', v_sale);
  PERFORM public.t4490x_ok((public.t4490x_sale(v_sale)).total_due_minor = 0 AND (public.t4490x_sale(v_sale)).credit_minor = 2000000
      AND (public.t4490x_sale(v_sale)).subtotal_minor + (public.t4490x_sale(v_sale)).service_charge_minor = 1100000,
    'X2-0 fixture: a 20,000.00 deposit on an 11,000.00 bill: nothing to pay');
END
$covered$;
SELECT public.t4490x_expect(format($q$SELECT public.issue_4490_till_take_payment(%L, 'cash', 100, 0, 100,
    '44900608-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, public.t4490x_id('x2_sale'), public.t4490x_v(public.t4490x_id('x2_sale'))),
  'PT409', 'till_nothing_to_pay', 'X2-1 there is nothing to take a payment for (unchanged)');
SELECT public.t4490x_expect(format($q$SELECT public.issue_4490_till_close_covered(%L, '44900608-0000-4000-8000-000000000002', %s)$q$,
    public.t4490x_id('x2_sale'), public.t4490x_v(public.t4490x_id('x2_sale')) - 1),
  'PT409', 'till_check_changed', 'X2-2a closing on an old version of the check is refused (T10)');
SELECT public.t4490x_expect(format($q$SELECT public.issue_4490_till_close_covered(%L, '44900608-0000-4000-8000-000000000005', %s)$q$,
    public.t4490x_id('x2_sale'), public.t4490x_v(public.t4490x_id('x2_sale'))),
  '42501', 'not_authorized', 'X2-2b staff without sell rights cannot close it');
DO $close$
DECLARE
  v jsonb;
  b0 jsonb := public.t4490x_day();
  v_sale uuid := public.t4490x_id('x2_sale');
  v_version integer := public.t4490x_v(public.t4490x_id('x2_sale'));
BEGIN
  v := public.issue_4490_till_close_covered(v_sale, '44900608-0000-4000-8000-000000000002', v_version);
  PERFORM public.t4490x_ok(NOT (v->>'replayed')::boolean AND (v->>'closed')::boolean
      AND (public.t4490x_sale(v_sale)).state = 'paid' AND (public.t4490x_sale(v_sale)).paid_minor = 0
      AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale)
      AND (public.t4490x_line(v_sale, 'deposit_credit')).state = 'committed'
      AND (SELECT o.payment_status FROM public.venue_orders o JOIN public.venue_till_lines l ON l.venue_order_id = o.id
           WHERE l.sale_id = v_sale) = 'paid'
      AND (public.t4490x_res(public.t4490x_id('x2_res'))).deposit_applied_sale_id = v_sale,
    'X2-2 Close check: the check is paid with no payment row, its round is paid, the deposit is used (credit committed)');
  -- TEST-MOD-APPROVED #4490 (08-O4 fix 3, spec 08 §15): the 9,000.00 the bill does not need now goes
  -- back to the guest as a deposit refund on its day; takings stay 0.
  PERFORM public.t4490x_ok(public.t4490x_delta(b0, public.t4490x_day()) = '{"online":0,"atVenue":0,"tableDeposits":0,"refunded":900000,"paidIn":-900000}'::jsonb,
    'X2-2c today''s takings for it are 0 (no money moved at the Till); the unused 9,000.00 of the deposit is refunded ' || public.t4490x_delta(b0, public.t4490x_day())::text);
  -- The same tap again (a lost answer, or a second device that saw the old
  -- version) answers the close; nothing else happens.
  v := public.issue_4490_till_close_covered(v_sale, '44900608-0000-4000-8000-000000000002', v_version);
  PERFORM public.t4490x_ok((v->>'replayed')::boolean AND (public.t4490x_sale(v_sale)).paid_minor = 0
      AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale),
    'X2-3 closing it again answers the close (replayed), nothing moves');
END
$close$;
SELECT public.t4490x_expect(format($q$SELECT public.issue_4490_till_void(%L, %L, NULL, '44900608-0000-4000-8000-000000000001', 'x', false, %s)$q$,
    public.t4490x_id('x2_sale'), (public.t4490x_line(public.t4490x_id('x2_sale'), 'deposit_credit')).id,
    public.t4490x_v(public.t4490x_id('x2_sale'))),
  'PT409', NULL, 'X2-4 the used deposit can no longer be taken off the closed check');
SELECT public.t4490x_as('44900608-0000-4000-8000-000000000003');
SELECT public.t4490x_expect(format($q$SELECT public.biz_venue_cancel_paid_reservation(%L, 'x')$q$, public.t4490x_id('x2_res')),
  'P0001', NULL, 'X2-4b ... and the booking''s deposit is not refunded (seated, used on the bill)');
SELECT public.t4490x_reset();
-- TEST-MOD-APPROVED #4490 (08-O4 fix 3, spec 08 §15): one row, the excess, and nothing more.
SELECT public.t4490x_ok(public.t4490x_refunds(public.t4490x_id('x2_res')) = 1
    AND (SELECT refund_kind || ':' || buyer_refund_requested_cents FROM public.source_refunds
         WHERE subject_id = public.t4490x_id('x2_res')) = 'venue_deposit_excess:900000',
  'X2-4c only the unused 9,000.00 of that deposit was refunded (one row); the used part never');

-- Never a write-off: anything due, or nothing bought, is refused.
SELECT public.t4490x_service();
DO $due$
DECLARE
  v jsonb;
  r uuid := public.t4490x_paid('x2b', public.t4490x_id('t3'), 500000);
  v_sale uuid;
  v_empty uuid;
BEGIN
  v := public.issue_4490_till_seat('44900608-0000-4000-9000-0000000000a1', '44900608-0000-4000-8000-000000000002',
    public.t4490x_id('spot_T3'), NULL, r, NULL, NULL, 'o4x-seat-x2b');
  v_sale := (v->>'id')::uuid;
  PERFORM public.t4490x_round(v_sale, 1);
  PERFORM public.issue_4490_till_reprice(v_sale);
  PERFORM public.t4490x_expect(format($q$SELECT public.issue_4490_till_close_covered(%L, '44900608-0000-4000-8000-000000000002', %s)$q$,
      v_sale, public.t4490x_v(v_sale)),
    'PT409', 'till_close_not_covered', 'X2-5 a check with 6,000.00 still to pay cannot be closed this way');
  PERFORM public.t4490x_ok((public.t4490x_sale(v_sale)).state = 'open' AND (public.t4490x_sale(v_sale)).total_due_minor = 600000,
    'X2-5b ... it stays open with 6,000.00 to pay');
  v := public.t4490x_cash(v_sale, 600000);
  r := public.t4490x_paid('x2c', public.t4490x_id('t3'), 500000);
  v := public.issue_4490_till_seat('44900608-0000-4000-9000-0000000000a1', '44900608-0000-4000-8000-000000000002',
    public.t4490x_id('spot_T3'), NULL, r, NULL, NULL, 'o4x-seat-x2c');
  v_empty := (v->>'id')::uuid;
  PERFORM public.t4490x_expect(format($q$SELECT public.issue_4490_till_close_covered(%L, '44900608-0000-4000-8000-000000000002', %s)$q$,
      v_empty, public.t4490x_v(v_empty)),
    'PT409', 'till_close_not_covered', 'X2-6 a check with nothing bought cannot be closed against the deposit');
END
$due$;
SELECT public.t4490x_reset();
SELECT public.t4490x_ok(NOT has_function_privilege('authenticated', 'public.issue_4490_till_close_covered(uuid,uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_till_close_covered(uuid,uuid,integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4490_till_close_covered(uuid,uuid,integer)', 'EXECUTE'),
  'X2-7 the close is internal (service role only; the Till edge checks who is asking)');

ROLLBACK;
