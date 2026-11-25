-- #4490 spec 08 O4 fix round 2: executable PostgreSQL 17 proof for migration
-- 20281203664490 (and the server side of the browser-pass fixes). The suite
-- owns its fixture (the O4 tables/hour fixture, its own ids) and rolls back.
--
-- MINGLA-INVARIANT: I-4490-DEPOSIT-VOID-UNSEATS | issue #4490 | voiding a booking's table-deposit credit on an open Till check puts the booking back to the status it had before the Till seated it (audited) and the check lets go of it, so the booking's own refund rules apply: the Host's cancel refunds the deposit exactly once; while the credit is live a seated booking is never refunded.
-- MINGLA-INVARIANT: I-4490-EVEN-ONLY-NEEDS-MONEY | issue #4490 | a check is "even only" (By item refused and greyed) only after an unshared payment, a paid (or paying) even share, a refund or a deposit; an unpaid even split never locks By item.
--
-- FAILS-ON-REVERT: with the 608490 line-voided trigger Y3-1 fails (the
-- booking stays seated, so the Host's cancel would refund nothing); with the
-- 607490 sale extras Y2-1 fails (evenOnly true with nothing paid).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490y_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490Y FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490y_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490Y FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490Y FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490y_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490y_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490y_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_ok(boolean,text), public.t4490y_expect(text,text,text,text),
  public.t4490y_as(uuid), public.t4490y_service(), public.t4490y_reset() TO PUBLIC;
CREATE TEMP TABLE t4490y_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490y_ids TO PUBLIC;
CREATE FUNCTION public.t4490y_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490y_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490y_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
CREATE FUNCTION public.t4490y_sale(p_sale uuid) RETURNS public.venue_till_sales LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_v(uuid), public.t4490y_sale(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 05 check-in only staff, 06 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900609-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-fix2-' || n || '@example.test', now(), now()
FROM generate_series(1, 6) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900609-0000-4000-8000-000000000001', now()), ('44900609-0000-4000-8000-000000000006', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900609-0000-4000-9000-000000000010', '44900609-0000-4000-8000-000000000001',
   'Till Fix2 4490', 'till-fix2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900609-0000-4000-9000-0000000000a1', '44900609-0000-4000-9000-000000000010', 'tillfixb', 'Hour Hall',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900609-0000-4000-9000-000000000010', '44900609-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900609-0000-4000-a000-000000000002', '44900609-0000-4000-9000-000000000010', '44900609-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900609-0000-4000-a000-000000000005', '44900609-0000-4000-9000-000000000010', '44900609-0000-4000-8000-000000000005', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900609-0000-4000-a000-000000000002', '44900609-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900609-0000-4000-a000-000000000005', '44900609-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900609-0000-4000-b000-000000000001', '44900609-0000-4000-9000-000000000010', '44900609-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900609-0000-4000-b000-000000000011', '44900609-0000-4000-b000-000000000001', '44900609-0000-4000-9000-000000000010', 'Chapman', 1000000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900609-0000-4000-9000-0000000000a1', '44900609-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;

-- About noon in the venue's time zone, whenever this runs.
SELECT public.t4490y_service();
SELECT public.issue_4490_ensure_booking_settings('44900609-0000-4000-9000-0000000000a1');
SELECT public.t4490y_reset();
UPDATE public.venue_booking_settings
SET timezone = CASE WHEN 12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer >= 0
                    THEN 'Etc/GMT-' || (12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer)
                    ELSE 'Etc/GMT+' || (extract(hour FROM now() AT TIME ZONE 'UTC')::integer - 12) END
WHERE venue_id = '44900609-0000-4000-9000-0000000000a1';
SELECT public.t4490y_ok(extract(hour FROM now() AT TIME ZONE public.issue_4490_venue_timezone('44900609-0000-4000-9000-0000000000a1')) BETWEEN 11 AND 13,
  'Y-0 fixture: it is about noon in the venue''s time zone');

SELECT public.t4490y_as('44900609-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  a uuid := '44900609-0000-4000-9000-0000000000a1';
  v jsonb;
  s jsonb;
  v_board uuid;
  v_pool uuid;
  v_closed uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a, 'till', true, NULL, NULL, NULL, 'o4y-setup-till-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'menu', true, NULL, NULL, NULL, 'o4y-setup-menu-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'by_the_hour', true, NULL, NULL, NULL, 'o4y-setup-hour-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'table_reservations', true, NULL, NULL, NULL, 'o4y-setup-tables-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'min_spend_tables', true, NULL, NULL, NULL, 'o4y-setup-minspend-on', true);
  -- Boardroom: one room, 30-minute steps, 60-120 minutes, 15 minutes cleanup, staff can start it.
  s := public.issue_4490_manage_space('create', a, '{"name":"Boardroom","setting":"indoor","capacity_seated":10}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Boardroom"}'::jsonb, NULL, 'o4y-setup-board-draft');
  v_board := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_board, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'o4y-setup-board-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_board, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 1200000), (v->>'version')::bigint, 'o4y-setup-board-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_board, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4y-setup-board-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_board, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4y-setup-board-hours');
  v := public.issue_4490_manage_hour('set_length', a, jsonb_build_object('offerId', v_board, 'stepMinutes', 30, 'minMinutes', 60,
    'maxMinutes', 120), (v->>'version')::bigint, 'o4y-setup-board-len');
  v := public.issue_4490_manage_hour('set_rules', a, jsonb_build_object('offerId', v_board, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 15, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'o4y-setup-board-rules');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_board), (v->>'version')::bigint, 'o4y-setup-board-pub');
  -- Pool tables: 3 units, any one, 60-minute steps, staff can start them.
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Pool table"}'::jsonb, NULL, 'o4y-setup-pool-draft');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_pool,
    'units', jsonb_build_object('count', 3, 'name', 'Pool table', 'seats', 4)), (v->>'version')::bigint, 'o4y-setup-pool-units');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_pool, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 4, 'priceMinor', 500000), (v->>'version')::bigint, 'o4y-setup-pool-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_pool, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4y-setup-pool-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_pool, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4y-setup-pool-hours');
  v := public.issue_4490_manage_hour('set_length', a, jsonb_build_object('offerId', v_pool, 'stepMinutes', 60, 'minMinutes', 60,
    'maxMinutes', 240), (v->>'version')::bigint, 'o4y-setup-pool-len');
  v := public.issue_4490_manage_hour('set_rules', a, jsonb_build_object('offerId', v_pool, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 0, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'o4y-setup-pool-rules');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_pool), (v->>'version')::bigint, 'o4y-setup-pool-pub');
  -- A room staff may NOT start.
  s := public.issue_4490_manage_space('create', a, '{"name":"Studio","setting":"indoor","capacity_seated":6}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Studio"}'::jsonb, NULL, 'o4y-setup-studio-draft');
  v_closed := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_closed, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'o4y-setup-studio-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_closed, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 800000), (v->>'version')::bigint, 'o4y-setup-studio-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_closed, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4y-setup-studio-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_closed, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4y-setup-studio-hours');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_closed), (v->>'version')::bigint, 'o4y-setup-studio-pub');
  -- Tables: T1 (minimum spend 50,000.00), T2.
  s := public.issue_4490_manage_space('create', a, '{"name":"Dining room","setting":"indoor","capacity_seated":40}'::jsonb, NULL);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T1', 'capacity', 4, 'minSpendMinor', 5000000,
    'spaceId', s->>'id'), 'o4y-setup-t1');
  INSERT INTO t4490y_ids VALUES ('board', v_board), ('pool', v_pool), ('studio', v_closed), ('t1', (v->>'id')::uuid);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T2', 'capacity', 4, 'spaceId', s->>'id'), 'o4y-setup-t2');
  INSERT INTO t4490y_ids VALUES ('t2', (v->>'id')::uuid);
END
$setup$;
SELECT public.t4490y_reset();
INSERT INTO t4490y_ids
SELECT 'spot_' || t.name, q.id FROM public.qr_spots q JOIN public.venue_tables t ON t.id = q.venue_table_id
WHERE t.venue_id = '44900609-0000-4000-9000-0000000000a1';
INSERT INTO t4490y_ids
SELECT 'pool_unit_' || row_number() OVER (ORDER BY s.sort_order, s.name), s.id
FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
WHERE os.offering_id = public.t4490y_id('pool');

CREATE SEQUENCE public.t4490y_pickup START 101;
GRANT USAGE ON SEQUENCE public.t4490y_pickup TO PUBLIC;
-- A held Till round: n x Chapman 10,000.00 + 10% service charge.
CREATE FUNCTION public.t4490y_round(p_sale uuid, p_qty integer) RETURNS uuid
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
    v_order, v_session, '44900609-0000-4000-9000-000000000010', '44900609-0000-4000-9000-0000000000a1', 'staff',
    '44900609-0000-4000-8000-000000000002', lpad(nextval('public.t4490y_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 1000000 * p_qty, 1000000 * p_qty, 0, 1000, 100000 * p_qty, 0, 0, 0, false, false, false,
    1100000 * p_qty, 1100000 * p_qty, 'pending', 'held', 'till-y-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900609-0000-4000-b000-000000000011', 1, 'Chapman', 1000000, 'NGN', p_qty, 0, 1000000 * p_qty);
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, '44900609-0000-4000-8000-000000000002', NULL);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_round(uuid, integer) TO PUBLIC;
CREATE FUNCTION public.t4490y_open(p_key text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_till_open('44900609-0000-4000-9000-0000000000a1', '44900609-0000-4000-8000-000000000002',
    NULL, NULL, NULL, 'o4y-hour-key:' || p_key)->>'id')::uuid
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_open(text) TO PUBLIC;
CREATE FUNCTION public.t4490y_start(p_sale uuid, p_offer uuid, p_space uuid, p_minutes integer, p_key text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_start_session(p_sale, p_offer, p_space, p_minutes, 2,
    '44900609-0000-4000-8000-000000000002', 'o4y-hour-start:' || p_key,
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_start(uuid, uuid, uuid, integer, text) TO PUBLIC;
CREATE FUNCTION public.t4490y_line(p_sale uuid, p_kind text) RETURNS public.venue_till_lines
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.venue_till_lines WHERE sale_id = p_sale AND kind = p_kind ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_line(uuid, text) TO PUBLIC;

-- Users of this suite: 03 an event manager of the brand (the O4 test's
-- attacker), 04 a guest.
INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
VALUES ('44900609-0000-4000-9000-000000000010', '44900609-0000-4000-8000-000000000003', 'event_manager', now(), now());
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled, fee_enabled, fee_refundable, cancel_cutoff_hours)
VALUES ('44900609-0000-4000-9000-000000000010', '44900609-0000-4000-9000-0000000000a1', true, true, true, 1)
ON CONFLICT (venue_id) DO UPDATE SET fee_refundable = true, cancel_cutoff_hours = 1;
-- A booking whose table deposit was paid online (as the checkout writes it).
CREATE FUNCTION public.t4490y_paid(p_key text, p_table uuid, p_amount integer, p_at timestamptz DEFAULT now())
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_res uuid;
BEGIN
  INSERT INTO public.reservations (brand_id, venue_id, reserved_for, party_size, status, payment_status, source, created_via,
    guest_name, guest_email, guest_phone_e164, table_id, fee_cents, fee_currency, payment_intent_id)
  VALUES ('44900609-0000-4000-9000-000000000010', '44900609-0000-4000-9000-0000000000a1', p_at, 2, 'confirmed', 'paid',
    'website', 'guest', 'Guest ' || p_key, p_key || '@example.test', '+2348030004490', p_table, p_amount, 'NGN', 'pay_' || p_key)
  RETURNING id INTO v_res;
  INSERT INTO public.reservation_checkout_sessions (brand_id, venue_id, reservation_id, reserved_for, party_size, buyer_name,
    buyer_email, buyer_phone_e164, amount_cents, currency, created_via, status, application_fee_amount_cents,
    paystack_reference, guest_cancel_token_hash)
  VALUES ('44900609-0000-4000-9000-000000000010', '44900609-0000-4000-9000-0000000000a1', v_res, p_at, 2, 'Guest ' || p_key,
    p_key || '@example.test', '+2348030004490', p_amount, 'NGN', 'web', 'completed', 0, 'mingla_resv_' || p_key,
    'v1:' || encode(extensions.digest('tok-' || p_key, 'sha256'), 'hex'));
  RETURN v_res;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_paid(text, uuid, integer, timestamptz) TO PUBLIC;
CREATE FUNCTION public.t4490y_res(p_res uuid) RETURNS public.reservations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.reservations WHERE id = p_res
$f$;
CREATE FUNCTION public.t4490y_refunds(p_res uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT count(*) FROM public.source_refunds WHERE source_type = 'venue_reservation' AND subject_id = p_res
$f$;
CREATE FUNCTION public.t4490y_live_credit(p_res uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT count(*) FROM public.venue_till_lines WHERE reservation_id = p_res AND kind = 'deposit_credit' AND state <> 'voided'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_res(uuid), public.t4490y_refunds(uuid), public.t4490y_live_credit(uuid) TO PUBLIC;

CREATE FUNCTION public.t4490y_day(p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_venue_money_day('44900609-0000-4000-9000-0000000000a1',
    public.issue_4490_venue_local_date('44900609-0000-4000-9000-0000000000a1') + p_offset)
$f$;
-- What changed in "Paid in today" between two reads.
CREATE FUNCTION public.t4490y_delta(p_before jsonb, p_after jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object(
    'online', (p_after#>>'{paidIn,online}')::bigint - (p_before#>>'{paidIn,online}')::bigint,
    'atVenue', (p_after#>>'{paidIn,atVenue}')::bigint - (p_before#>>'{paidIn,atVenue}')::bigint,
    'tableDeposits', (p_after#>>'{paidIn,tableDeposits}')::bigint - (p_before#>>'{paidIn,tableDeposits}')::bigint,
    'refunded', (p_after#>>'{paidIn,refunded}')::bigint - (p_before#>>'{paidIn,refunded}')::bigint,
    'paidIn', (p_after->>'paidInMinor')::bigint - (p_before->>'paidInMinor')::bigint)
$f$;
-- A share paid by scan whose transfer lands (Mingla money).
CREATE FUNCTION public.t4490y_scan_share(p_sale uuid, p_share uuid, p_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_till_card_prepare_share(p_sale, p_share, '44900609-0000-4000-8000-000000000002',
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale));
  v := public.issue_4490_till_card_start_share(p_sale, p_share, 'scan', 0, '44900609-0000-4000-8000-000000000002', NULL,
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
CREATE FUNCTION public.t4490y_cash(p_sale uuid, p_amount bigint) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_take_payment(p_sale, 'cash', p_amount, 0, p_amount,
    '44900609-0000-4000-8000-000000000002', NULL, gen_random_uuid(), (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
CREATE FUNCTION public.t4490y_cash_share(p_sale uuid, p_share uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_pay_share(p_sale, p_share, 'cash', (SELECT amount_minor FROM public.venue_till_shares WHERE id = p_share), 0,
    (SELECT amount_minor FROM public.venue_till_shares WHERE id = p_share), '44900609-0000-4000-8000-000000000002', NULL,
    gen_random_uuid(), (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
CREATE FUNCTION public.t4490y_share(p_sale uuid, p_no integer) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT id FROM public.venue_till_shares WHERE sale_id = p_sale AND share_no = p_no
$f$;
-- The booking side: what each booking of a check has recorded, by method.
CREATE FUNCTION public.t4490y_booked(p_sale uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT COALESCE(string_agg(x.m || ':' || x.a, ',' ORDER BY x.m), '')
  FROM (SELECT CASE WHEN o.method = 'till' THEN 'till/' || tp.method ELSE o.method END AS m, sum(o.amount_minor) AS a
        FROM public.venue_offline_payments o
        LEFT JOIN public.venue_till_payments tp ON tp.id = o.till_payment_id
        WHERE o.group_id IN (SELECT l.stay_group_id FROM public.venue_till_lines l WHERE l.sale_id = p_sale)
        GROUP BY 1) x
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_day(integer), public.t4490y_delta(jsonb, jsonb), public.t4490y_scan_share(uuid, uuid, text),
  public.t4490y_cash(uuid, bigint), public.t4490y_cash_share(uuid, uuid), public.t4490y_share(uuid, integer),
  public.t4490y_booked(uuid) TO PUBLIC;
-- More tables for these checks (T3, T4).

CREATE FUNCTION public.t4490y_seat(p_res uuid, p_spot text, p_key text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_till_seat('44900609-0000-4000-9000-0000000000a1', '44900609-0000-4000-8000-000000000002',
    public.t4490y_id(p_spot), NULL, p_res, NULL, NULL, p_key)->>'id')::uuid
$f$;
CREATE FUNCTION public.t4490y_void(p_sale uuid, p_line uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_void(p_sale, p_line, NULL, '44900609-0000-4000-8000-000000000002', 'made wrong', false,
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale)) IS NOT NULL AND true
$f$;
GRANT EXECUTE ON FUNCTION public.t4490y_seat(uuid, text, text), public.t4490y_void(uuid, uuid) TO PUBLIC;

-- -------------------------------------------------------------------------
-- Y3. O4-B3: once the deposit is off the check, the Host's cancel refunds it once.
-- -------------------------------------------------------------------------
SELECT public.t4490y_service();
DO $unseat$
DECLARE
  r uuid := public.t4490y_paid('y3', public.t4490y_id('t2'), 500000, now() + interval '1 day');
  s uuid;
BEGIN
  s := public.t4490y_seat(r, 'spot_T2', 'o4y-seat-y3');
  PERFORM public.t4490y_round(s, 1);
  INSERT INTO t4490y_ids VALUES ('y3_res', r), ('y3_sale', s);
  PERFORM public.t4490y_ok((public.t4490y_res(r)).status = 'seated' AND public.t4490y_live_credit(r) = 1,
    'Y3-0 fixture: a booking with a 5,000.00 deposit seated at the Till, its deposit on the check');
  PERFORM public.t4490y_void(s, (public.t4490y_line(s, 'deposit_credit')).id);
  PERFORM public.t4490y_ok((public.t4490y_res(r)).status = 'confirmed' AND (public.t4490y_res(r)).deposit_applied_sale_id IS NULL
      AND public.t4490y_live_credit(r) = 0 AND (public.t4490y_sale(s)).reservation_id IS NULL
      AND (public.t4490y_sale(s)).state = 'open'
      AND EXISTS (SELECT 1 FROM public.audit_log a WHERE a.target_id = r::text AND a.action = 'venue_reservation.transition'
                  AND a.after->>'reason' = 'deposit taken off the bill at the Till' AND a.after->>'status' = 'confirmed'),
    'Y3-1 voiding the deposit credit unseats the booking (back to confirmed, audited) and the check lets go of it');
END
$unseat$;
SELECT public.t4490y_reset();
-- The Host's cancel (venue-reservation-cancel, actor venue, calls this RPC as the manager).
SELECT public.t4490y_as('44900609-0000-4000-8000-000000000003');
DO $cancel$
DECLARE
  v jsonb;
BEGIN
  v := public.biz_venue_cancel_paid_reservation(public.t4490y_id('y3_res'), 'guest left');
  PERFORM public.t4490y_ok(v->'refund' IS NOT NULL AND (v#>>'{refund,amount_cents}')::bigint = 500000
      AND public.t4490y_refunds(public.t4490y_id('y3_res')) = 1
      AND (public.t4490y_res(public.t4490y_id('y3_res'))).status = 'cancelled_by_venue',
    'Y3-2 the Host cancel then refunds the 5,000.00 deposit: one refund row');
  BEGIN
    v := public.biz_venue_cancel_paid_reservation(public.t4490y_id('y3_res'), 'guest left');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM public.t4490y_ok(public.t4490y_refunds(public.t4490y_id('y3_res')) = 1,
    'Y3-3 cancelling it again refunds nothing more (still one refund row)');
END
$cancel$;
SELECT public.t4490y_reset();

-- Voiding the whole check (every line, the deposit too): the same.
SELECT public.t4490y_service();
DO $wholecheck$
DECLARE
  r uuid := public.t4490y_paid('y3b', public.t4490y_id('t1'), 300000, now() + interval '1 day');
  s uuid;
  l record;
BEGIN
  s := public.t4490y_seat(r, 'spot_T1', 'o4y-seat-y3b');
  PERFORM public.t4490y_round(s, 1);
  FOR l IN SELECT id FROM public.venue_till_lines WHERE sale_id = s AND state = 'held' ORDER BY kind DESC LOOP
    PERFORM public.t4490y_void(s, l.id);
  END LOOP;
  INSERT INTO t4490y_ids VALUES ('y3b_res', r);
  PERFORM public.t4490y_ok((public.t4490y_res(r)).status = 'confirmed'
      AND NOT EXISTS (SELECT 1 FROM public.venue_till_lines WHERE sale_id = s AND state <> 'voided'),
    'Y3-4 voiding every line of the check (the deposit too) unseats the booking the same way');
END
$wholecheck$;
SELECT public.t4490y_reset();
SELECT public.t4490y_as('44900609-0000-4000-8000-000000000003');
DO $cancel2$
DECLARE
  v jsonb;
BEGIN
  v := public.biz_venue_cancel_paid_reservation(public.t4490y_id('y3b_res'), 'never came');
  PERFORM public.t4490y_ok(public.t4490y_refunds(public.t4490y_id('y3b_res')) = 1,
    'Y3-5 ... and the Host cancel refunds its deposit once');
END
$cancel2$;
SELECT public.t4490y_reset();

-- While the deposit is still on the check: refused, nothing refunded.
SELECT public.t4490y_service();
DO $live$
DECLARE
  r uuid := public.t4490y_paid('y3c', public.t4490y_id('t2'), 400000, now() + interval '1 day');
BEGIN
  -- T2's earlier check is still open: pay it so the table is free.
  PERFORM public.t4490y_cash(public.t4490y_id('y3_sale'), (public.t4490y_sale(public.t4490y_id('y3_sale'))).total_due_minor);
  PERFORM public.t4490y_seat(r, 'spot_T2', 'o4y-seat-y3c');
  INSERT INTO t4490y_ids VALUES ('y3c_res', r);
END
$live$;
SELECT public.t4490y_reset();
SELECT public.t4490y_as('44900609-0000-4000-8000-000000000003');
SELECT public.t4490y_expect(format($q$SELECT public.biz_venue_cancel_paid_reservation(%L, 'x')$q$, public.t4490y_id('y3c_res')),
  'P0001', 'seated_no_auto_refund', 'Y3-6 with the deposit still on the check the Host cancel refunds nothing (seated)');
SELECT public.t4490y_reset();
SELECT public.t4490y_ok(public.t4490y_refunds(public.t4490y_id('y3c_res')) = 0 AND public.t4490y_live_credit(public.t4490y_id('y3c_res')) = 1
    AND (public.t4490y_res(public.t4490y_id('y3c_res'))).status = 'seated',
  'Y3-7 ... the booking stays seated with its deposit on the check, no refund row');

-- -------------------------------------------------------------------------
-- Y2. O4-B2: an unpaid even split does not make the check "even only".
-- -------------------------------------------------------------------------
SELECT public.t4490y_service();
DO $even$
DECLARE
  v jsonb;
  s uuid := public.t4490y_open('y2');
  v_item uuid;
BEGIN
  PERFORM public.t4490y_round(s, 2);
  v := public.issue_4490_till_set_split(s, 'even', '{"count":2}', '44900609-0000-4000-8000-000000000002', public.t4490y_v(s));
  PERFORM public.t4490y_ok(jsonb_array_length(v->'shares') = 2 AND NOT (v#>>'{split,evenOnly}')::boolean,
    'Y2-1 "2 ways" with nothing paid: two unpaid shares and By item still allowed (evenOnly false)');
  SELECT i.id INTO v_item FROM public.venue_order_items i JOIN public.venue_till_lines l ON l.venue_order_id = i.venue_order_id
  WHERE l.sale_id = s;
  v := public.issue_4490_till_set_split(s, 'by_item',
    jsonb_build_array(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_item, 'units', 1))),
                      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('orderItemId', v_item, 'units', 1)))),
    '44900609-0000-4000-8000-000000000002', public.t4490y_v(s));
  PERFORM public.t4490y_ok(jsonb_array_length(v->'shares') = 2 AND v#>>'{shares,0,mode}' = 'by_item',
    'Y2-2 ... and By item then replaces it');
  v := public.issue_4490_till_set_split(s, 'even', '{"count":2}', '44900609-0000-4000-8000-000000000002', public.t4490y_v(s));
  PERFORM public.t4490y_cash_share(s, public.t4490y_share(s, 1));
  v := public.issue_4490_till_sale_projection(s);
  PERFORM public.t4490y_ok((v#>>'{split,evenOnly}')::boolean,
    'Y2-3 once an even share is paid, only an even split of the rest (evenOnly true; deviation 8 unchanged)');
  INSERT INTO t4490y_ids VALUES ('y2_sale', s);
END
$even$;
SELECT public.t4490y_reset();

-- -------------------------------------------------------------------------
-- O1-N3 still holds on a part-paid split check: a line can be added, and an
-- unpaid line voided (the browser's "locked basket" was the pay sheet open
-- over the menu, not a server rule).
-- -------------------------------------------------------------------------
SELECT public.t4490y_service();
DO $basket$
DECLARE
  s uuid := public.t4490y_id('y2_sale');
  v_order uuid;
  v_line uuid;
BEGIN
  v_order := public.t4490y_round(s, 1);
  SELECT id INTO v_line FROM public.venue_till_lines WHERE sale_id = s AND venue_order_id = v_order;
  PERFORM public.t4490y_ok((public.t4490y_sale(s)).state = 'open' AND (public.t4490y_sale(s)).paid_minor > 0
      AND NOT EXISTS (SELECT 1 FROM public.venue_till_shares WHERE sale_id = s AND state = 'unpaid'),
    'Y0-1 a part-paid split check takes a new round (the unpaid share is dropped, the paid one kept)');
  PERFORM public.t4490y_void(s, v_line);
  PERFORM public.t4490y_ok((SELECT state FROM public.venue_till_lines WHERE id = v_line) = 'voided',
    'Y0-2 ... and that unpaid round can be voided again (O1-N3)');
END
$basket$;
SELECT public.t4490y_reset();

-- -------------------------------------------------------------------------
-- Y1. O4-B1 on the server: a share's scan code carries exactly the share plus
-- the tip chosen (no recomputation); a tip above the payment is refused.
-- -------------------------------------------------------------------------
SELECT public.t4490y_service();
DO $tips$
DECLARE
  v jsonb;
  s uuid := public.t4490y_open('y1');
  sh uuid;
  p uuid;
BEGIN
  PERFORM public.t4490y_round(s, 3);
  PERFORM public.issue_4490_till_set_split(s, 'even', '{"count":3}', '44900609-0000-4000-8000-000000000002', public.t4490y_v(s));
  sh := public.t4490y_share(s, 3);
  -- 3 x 10,000.00 food, 10% service charge: 33,000.00 in 3; share 3 = 11,000.00; 10% of its food = 1,000.00.
  v := public.issue_4490_till_card_prepare_share(s, sh, '44900609-0000-4000-8000-000000000002', public.t4490y_v(s));
  v := public.issue_4490_till_card_start_share(s, sh, 'scan', 100000, '44900609-0000-4000-8000-000000000002', NULL,
    gen_random_uuid(), (v->>'version')::integer,
    jsonb_build_object('provider', 'paystack', 'totalCents', (v->>'amountMinor')::bigint + 100000,
      'subtotalCents', (v->>'amountMinor')::bigint - (v->>'serviceChargeMinor')::bigint,
      'serviceChargeCents', (v->>'serviceChargeMinor')::bigint, 'tipCents', 100000, 'currency', 'NGN',
      'effectiveTakeRateBps', 0, 'serviceFeeBps', 0, 'minglaFeeCents', 0, 'platformServiceFeeCents', 0,
      'buyerSubtotalCents', (v->>'amountMinor')::bigint, 'taxAmountCents', 0), 'YTHREEAB');
  p := (v->>'paymentId')::uuid;
  PERFORM public.t4490y_ok((SELECT amount_minor FROM public.venue_till_payments WHERE id = p) = 1100000
      AND (SELECT tip_minor FROM public.venue_till_payments WHERE id = p) = 100000
      AND (SELECT o.total_cents FROM public.venue_orders o WHERE o.till_payment_id = p) = 1200000
      AND (SELECT o.tip_cents FROM public.venue_orders o WHERE o.till_payment_id = p) = 100000,
    'Y1-1 the scan code for share 3 (11,000.00) with a 10% tip on its food (1,000.00) asks the guest for 12,000.00');
  PERFORM public.t4490y_expect(format($q$SELECT public.issue_4490_till_pay_share(%L, %L, 'cash', %s, %s, %s,
      '44900609-0000-4000-8000-000000000002', NULL, gen_random_uuid(), %s)$q$, s, public.t4490y_share(s, 1),
      (SELECT amount_minor FROM public.venue_till_shares WHERE id = public.t4490y_share(s, 1)),
      (SELECT amount_minor FROM public.venue_till_shares WHERE id = public.t4490y_share(s, 1)) + 1,
      2 * (SELECT amount_minor FROM public.venue_till_shares WHERE id = public.t4490y_share(s, 1)) + 1, public.t4490y_v(s)),
    '22023', 'till_tip_invalid', 'Y1-2 a tip above the share itself is refused (spec 08 §4: tips at most 100% of the share)');
END
$tips$;
SELECT public.t4490y_reset();
ROLLBACK;
