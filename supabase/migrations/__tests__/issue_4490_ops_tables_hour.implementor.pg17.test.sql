-- #4490 spec 08 O4: executable PostgreSQL 17 proof for migration 20281203644490
-- (by the hour started by staff, "Add 30 min", tables, the table-deposit
-- credit and its refund guard). The suite owns its fixture and rolls back.
-- The venue's time zone is chosen so that it is about noon there whenever
-- the suite runs (sessions start "now").
--
-- MINGLA-INVARIANT: I-4490-DEPOSIT-USED-ONCE | issue #4490 | a booking's paid table deposit is on at most one live Till check (partial UNIQUE venue_till_lines(reservation_id) WHERE kind = 'deposit_credit' AND state <> 'voided'; PT409 deposit_already_used), comes off that check's bill (total_due = subtotal + service charge - deposit, floor 0), and while it is applied no refund obligation for the booking can be written (BEFORE INSERT on source_refunds: reservation_deposit_used).
-- MINGLA-INVARIANT: I-4490-TILL-SESSION-CLAIMS-ITS-TIME | issue #4490 | a by-the-hour session started or extended at the Till claims its unit for exactly the time on the check (issue_4490_claim_hour_unit / issue_4490_claim_spaces; a taken unit is PT409 offer_space_taken and moves nothing), and voiding the session's line releases the claim.
--
-- FAILS-ON-REVERT: without 20281203644490 every block fails at once. With
-- the reprice credit patch reverted D-1 fails (the deposit does not come off);
-- with the deposit_once index dropped D-3 fails; with the source_refunds
-- guard dropped D-4 fails; with the session claim skipped when the unit is
-- taken (A10's "money only" version) H-4b fails first (a taken unit is not
-- refused), then H-6.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490h_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490H FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490h_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490H FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490H FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490h_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490h_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490h_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490h_ok(boolean,text), public.t4490h_expect(text,text,text,text),
  public.t4490h_as(uuid), public.t4490h_service(), public.t4490h_reset() TO PUBLIC;
CREATE TEMP TABLE t4490h_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490h_ids TO PUBLIC;
CREATE FUNCTION public.t4490h_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490h_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490h_id(text) TO PUBLIC;
CREATE FUNCTION public.t4490h_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
CREATE FUNCTION public.t4490h_sale(p_sale uuid) RETURNS public.venue_till_sales LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t4490h_v(uuid), public.t4490h_sale(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 05 check-in only staff, 06 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900607-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-hour-' || n || '@example.test', now(), now()
FROM generate_series(1, 6) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900607-0000-4000-8000-000000000001', now()), ('44900607-0000-4000-8000-000000000006', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900607-0000-4000-9000-000000000010', '44900607-0000-4000-8000-000000000001',
   'Till Hour 4490', 'till-hour-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900607-0000-4000-9000-0000000000a1', '44900607-0000-4000-9000-000000000010', 'tillhoura', 'Hour Hall',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900607-0000-4000-9000-000000000010', '44900607-0000-4000-9000-0000000000a1', d, '00:00', '23:59', false
FROM generate_series(0, 6) d;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900607-0000-4000-a000-000000000002', '44900607-0000-4000-9000-000000000010', '44900607-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900607-0000-4000-a000-000000000005', '44900607-0000-4000-9000-000000000010', '44900607-0000-4000-8000-000000000005', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900607-0000-4000-a000-000000000002', '44900607-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900607-0000-4000-a000-000000000005', '44900607-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900607-0000-4000-b000-000000000001', '44900607-0000-4000-9000-000000000010', '44900607-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900607-0000-4000-b000-000000000011', '44900607-0000-4000-b000-000000000001', '44900607-0000-4000-9000-000000000010', 'Chapman', 1000000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900607-0000-4000-9000-0000000000a1', '44900607-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;

-- About noon in the venue's time zone, whenever this runs.
SELECT public.t4490h_service();
SELECT public.issue_4490_ensure_booking_settings('44900607-0000-4000-9000-0000000000a1');
SELECT public.t4490h_reset();
UPDATE public.venue_booking_settings
SET timezone = CASE WHEN 12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer >= 0
                    THEN 'Etc/GMT-' || (12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer)
                    ELSE 'Etc/GMT+' || (extract(hour FROM now() AT TIME ZONE 'UTC')::integer - 12) END
WHERE venue_id = '44900607-0000-4000-9000-0000000000a1';
SELECT public.t4490h_ok(extract(hour FROM now() AT TIME ZONE public.issue_4490_venue_timezone('44900607-0000-4000-9000-0000000000a1')) BETWEEN 11 AND 13,
  'H-0 fixture: it is about noon in the venue''s time zone');

SELECT public.t4490h_as('44900607-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  a uuid := '44900607-0000-4000-9000-0000000000a1';
  v jsonb;
  s jsonb;
  v_board uuid;
  v_pool uuid;
  v_closed uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a, 'till', true, NULL, NULL, NULL, 'o4h-setup-till-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'menu', true, NULL, NULL, NULL, 'o4h-setup-menu-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'by_the_hour', true, NULL, NULL, NULL, 'o4h-setup-hour-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'table_reservations', true, NULL, NULL, NULL, 'o4h-setup-tables-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'min_spend_tables', true, NULL, NULL, NULL, 'o4h-setup-minspend-on', true);
  -- Boardroom: one room, 30-minute steps, 60-120 minutes, 15 minutes cleanup, staff can start it.
  s := public.issue_4490_manage_space('create', a, '{"name":"Boardroom","setting":"indoor","capacity_seated":10}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Boardroom"}'::jsonb, NULL, 'o4h-setup-board-draft');
  v_board := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_board, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'o4h-setup-board-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_board, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 1200000), (v->>'version')::bigint, 'o4h-setup-board-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_board, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4h-setup-board-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_board, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4h-setup-board-hours');
  v := public.issue_4490_manage_hour('set_length', a, jsonb_build_object('offerId', v_board, 'stepMinutes', 30, 'minMinutes', 60,
    'maxMinutes', 120), (v->>'version')::bigint, 'o4h-setup-board-len');
  v := public.issue_4490_manage_hour('set_rules', a, jsonb_build_object('offerId', v_board, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 15, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'o4h-setup-board-rules');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_board), (v->>'version')::bigint, 'o4h-setup-board-pub');
  -- Pool tables: 3 units, any one, 60-minute steps, staff can start them.
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Pool table"}'::jsonb, NULL, 'o4h-setup-pool-draft');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_pool,
    'units', jsonb_build_object('count', 3, 'name', 'Pool table', 'seats', 4)), (v->>'version')::bigint, 'o4h-setup-pool-units');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_pool, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 4, 'priceMinor', 500000), (v->>'version')::bigint, 'o4h-setup-pool-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_pool, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4h-setup-pool-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_pool, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4h-setup-pool-hours');
  v := public.issue_4490_manage_hour('set_length', a, jsonb_build_object('offerId', v_pool, 'stepMinutes', 60, 'minMinutes', 60,
    'maxMinutes', 240), (v->>'version')::bigint, 'o4h-setup-pool-len');
  v := public.issue_4490_manage_hour('set_rules', a, jsonb_build_object('offerId', v_pool, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 0, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'o4h-setup-pool-rules');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_pool), (v->>'version')::bigint, 'o4h-setup-pool-pub');
  -- A room staff may NOT start.
  s := public.issue_4490_manage_space('create', a, '{"name":"Studio","setting":"indoor","capacity_seated":6}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Studio"}'::jsonb, NULL, 'o4h-setup-studio-draft');
  v_closed := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_closed, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'o4h-setup-studio-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_closed, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 800000), (v->>'version')::bigint, 'o4h-setup-studio-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_closed, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'o4h-setup-studio-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_closed, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'o4h-setup-studio-hours');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_closed), (v->>'version')::bigint, 'o4h-setup-studio-pub');
  -- Tables: T1 (minimum spend 50,000.00), T2.
  s := public.issue_4490_manage_space('create', a, '{"name":"Dining room","setting":"indoor","capacity_seated":40}'::jsonb, NULL);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T1', 'capacity', 4, 'minSpendMinor', 5000000,
    'spaceId', s->>'id'), 'o4h-setup-t1');
  INSERT INTO t4490h_ids VALUES ('board', v_board), ('pool', v_pool), ('studio', v_closed), ('t1', (v->>'id')::uuid);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T2', 'capacity', 4, 'spaceId', s->>'id'), 'o4h-setup-t2');
  INSERT INTO t4490h_ids VALUES ('t2', (v->>'id')::uuid);
END
$setup$;
SELECT public.t4490h_reset();
INSERT INTO t4490h_ids
SELECT 'spot_' || t.name, q.id FROM public.qr_spots q JOIN public.venue_tables t ON t.id = q.venue_table_id
WHERE t.venue_id = '44900607-0000-4000-9000-0000000000a1';
INSERT INTO t4490h_ids
SELECT 'pool_unit_' || row_number() OVER (ORDER BY s.sort_order, s.name), s.id
FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
WHERE os.offering_id = public.t4490h_id('pool');

CREATE SEQUENCE public.t4490h_pickup START 101;
GRANT USAGE ON SEQUENCE public.t4490h_pickup TO PUBLIC;
-- A held Till round: n x Chapman 10,000.00 + 10% service charge.
CREATE FUNCTION public.t4490h_round(p_sale uuid, p_qty integer) RETURNS uuid
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
    v_order, v_session, '44900607-0000-4000-9000-000000000010', '44900607-0000-4000-9000-0000000000a1', 'staff',
    '44900607-0000-4000-8000-000000000002', lpad(nextval('public.t4490h_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 1000000 * p_qty, 1000000 * p_qty, 0, 1000, 100000 * p_qty, 0, 0, 0, false, false, false,
    1100000 * p_qty, 1100000 * p_qty, 'pending', 'held', 'till-h-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900607-0000-4000-b000-000000000011', 1, 'Chapman', 1000000, 'NGN', p_qty, 0, 1000000 * p_qty);
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, '44900607-0000-4000-8000-000000000002', NULL);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490h_round(uuid, integer) TO PUBLIC;
CREATE FUNCTION public.t4490h_open(p_key text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_till_open('44900607-0000-4000-9000-0000000000a1', '44900607-0000-4000-8000-000000000002',
    NULL, NULL, NULL, 'o4-hour-key:' || p_key)->>'id')::uuid
$f$;
GRANT EXECUTE ON FUNCTION public.t4490h_open(text) TO PUBLIC;
CREATE FUNCTION public.t4490h_start(p_sale uuid, p_offer uuid, p_space uuid, p_minutes integer, p_key text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_till_start_session(p_sale, p_offer, p_space, p_minutes, 2,
    '44900607-0000-4000-8000-000000000002', 'o4-hour-start:' || p_key,
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale))
$f$;
GRANT EXECUTE ON FUNCTION public.t4490h_start(uuid, uuid, uuid, integer, text) TO PUBLIC;
CREATE FUNCTION public.t4490h_line(p_sale uuid, p_kind text) RETURNS public.venue_till_lines
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT * FROM public.venue_till_lines WHERE sale_id = p_sale AND kind = p_kind ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t4490h_line(uuid, text) TO PUBLIC;

-- -------------------------------------------------------------------------
-- 1. Starting a session now.
-- -------------------------------------------------------------------------
SELECT public.t4490h_service();
DO $start$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490h_open('board-a');
  v_line public.venue_till_lines%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_claim public.venue_space_claims%ROWTYPE;
BEGIN
  v := public.t4490h_start(v_sale, public.t4490h_id('board'), NULL, 60, 'board-a');
  v_line := public.t4490h_line(v_sale, 'by_the_hour');
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = v_line.stay_group_id;
  SELECT * INTO v_claim FROM public.venue_space_claims WHERE group_id = v_group.id;
  PERFORM public.t4490h_ok(v_line.amount_minor = 1200000 AND v_line.state = 'held'
      AND (public.t4490h_sale(v_sale)).total_due_minor = 1200000
      AND v_group.state = 'confirmed' AND v_group.booking_source = 'walk_in' AND v_group.payment_collection = 'till'
      AND v_group.created_by_staff_user_id = '44900607-0000-4000-8000-000000000002' AND v_group.till_sale_id = v_sale,
    'H-1 a Boardroom hour started now: 12,000.00 on the check; the booking is a confirmed walk-in collected by the Till');
  PERFORM public.t4490h_ok(v_claim.state = 'committed' AND lower(v_claim.booked_range) <= now() + interval '15 minutes'
      AND lower(v_claim.booked_range) >= now() - interval '15 minutes'
      AND upper(v_claim.booked_range) - lower(v_claim.booked_range) = interval '60 minutes'
      AND upper(v_claim.claim_range) = upper(v_claim.booked_range) + interval '15 minutes'
      AND extract(minute FROM lower(v_claim.booked_range))::integer % 30 = 0,
    'H-1b the room is claimed (committed) from now rounded to the 30-minute step, for 60 minutes plus 15 minutes cleanup');
  PERFORM public.t4490h_ok(EXISTS (SELECT 1 FROM public.venue_passes p WHERE p.group_id = v_group.id AND p.admitted_count >= 1),
    'H-1c admitted on create: the session''s pass is issued and used');
  PERFORM public.t4490h_ok(jsonb_array_length(v->'hourSessions') = 1
      AND (v#>>'{hourSessions,0,endsAt}')::timestamptz = upper(v_claim.booked_range)
      AND v#>>'{hourSessions,0,unitName}' = 'Boardroom',
    'H-1d the check shows the session (Boardroom, ends at its booked end)');
  -- A retry of the same start answers the same check, nothing new.
  v := public.issue_4490_till_start_session(v_sale, public.t4490h_id('board'), NULL, 60, 2,
    '44900607-0000-4000-8000-000000000002', 'o4-hour-start:board-a', NULL);
  PERFORM public.t4490h_ok((v->>'replayed')::boolean
      AND (SELECT count(*) FROM public.venue_till_lines WHERE sale_id = v_sale AND kind = 'by_the_hour') = 1,
    'H-1e a retried start (same key) books nothing new');
  INSERT INTO t4490h_ids VALUES ('board_sale', v_sale), ('board_line', v_line.id), ('board_group', v_group.id);
  -- The room is taken: another check cannot start it.
  PERFORM public.t4490h_expect(format($q$SELECT public.t4490h_start(public.t4490h_open('board-b'), %L, NULL, 60, 'board-b')$q$,
      public.t4490h_id('board')),
    'PT409', 'offer_space_taken', 'H-2 staff start refuses a room that is taken (offer_space_taken)');
  PERFORM public.t4490h_expect(format($q$SELECT public.t4490h_start(public.t4490h_open('studio-a'), %L, NULL, 60, 'studio-a')$q$,
      public.t4490h_id('studio')),
    'PT409', 'offer_staff_start_off', 'H-3 an offer staff may not start is refused (offer_staff_start_off)');
END
$start$;
SELECT public.t4490h_reset();

-- Pool tables: a chosen unit, a taken unit, any free unit.
SELECT public.t4490h_service();
DO $units$
DECLARE
  v jsonb;
  v_a uuid := public.t4490h_open('pool-a');
  v_c uuid := public.t4490h_open('pool-c');
  v_unit2 uuid;
BEGIN
  v := public.t4490h_start(v_a, public.t4490h_id('pool'), public.t4490h_id('pool_unit_1'), 60, 'pool-a');
  PERFORM public.t4490h_ok((SELECT c.space_id FROM public.venue_space_claims c
                            WHERE c.group_id = (public.t4490h_line(v_a, 'by_the_hour')).stay_group_id) = public.t4490h_id('pool_unit_1')
      AND (public.t4490h_line(v_a, 'by_the_hour')).amount_minor = 500000,
    'H-4 the pool table staff picked is the one claimed (5,000.00 for an hour)');
  PERFORM public.t4490h_expect(format($q$SELECT public.t4490h_start(public.t4490h_open('pool-b'), %L, %L, 60, 'pool-b')$q$,
      public.t4490h_id('pool'), public.t4490h_id('pool_unit_1')),
    'PT409', 'offer_space_taken', 'H-4b the same pool table on another check is refused (offer_space_taken)');
  v := public.t4490h_start(v_c, public.t4490h_id('pool'), NULL, 60, 'pool-c');
  SELECT c.space_id INTO v_unit2 FROM public.venue_space_claims c
  WHERE c.group_id = (public.t4490h_line(v_c, 'by_the_hour')).stay_group_id;
  PERFORM public.t4490h_ok(v_unit2 IS NOT NULL AND v_unit2 <> public.t4490h_id('pool_unit_1'),
    'H-4c with no unit picked, a free pool table is claimed');
  INSERT INTO t4490h_ids VALUES ('pool_sale', v_a);
END
$units$;
SELECT public.t4490h_reset();

-- -------------------------------------------------------------------------
-- 2. "Add 30 min" claims the time and adds the money (T13).
-- -------------------------------------------------------------------------
SELECT public.t4490h_service();
DO $extend$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490h_id('board_sale');
  v_root uuid := public.t4490h_id('board_line');
  v_end timestamptz;
  v_space uuid;
  v_ext public.venue_till_lines%ROWTYPE;
BEGIN
  SELECT ends_at, space_ids[1] INTO v_end, v_space FROM public.issue_4490_till_session_span(v_root);
  v := public.issue_4490_till_extend_session(v_sale, v_root, 30, '44900607-0000-4000-8000-000000000002',
    'o4-hour-ext:1', public.t4490h_v(v_sale));
  SELECT * INTO v_ext FROM public.venue_till_lines WHERE sale_id = v_sale AND extends_line_id = v_root;
  PERFORM public.t4490h_ok(v_ext.amount_minor = 600000 AND v_ext.kind = 'by_the_hour'
      AND (SELECT ends_at FROM public.issue_4490_till_session_span(v_root)) = v_end + interval '30 minutes'
      AND (public.t4490h_sale(v_sale)).total_due_minor = 1800000
      AND EXISTS (SELECT 1 FROM public.venue_space_claims c WHERE c.group_id = v_ext.stay_group_id
                  AND c.state = 'committed' AND lower(c.booked_range) = v_end
                  AND upper(c.claim_range) = v_end + interval '45 minutes')
      AND (SELECT upper(c.claim_range) FROM public.venue_space_claims c
           WHERE c.group_id = public.t4490h_id('board_group')) = v_end,
    'H-5 Add 30 min: the next 30 minutes are claimed on the same room (cleanup moves after it) and 6,000.00 is added; the session ends 30 minutes later');
  -- Someone else has the room after that: the next block is refused with their time.
  INSERT INTO public.venue_space_claims (space_id, source, booked_range, claim_range, state, block_reason)
  VALUES (v_space, 'block', tstzrange(v_end + interval '45 minutes', v_end + interval '105 minutes', '[)'),
          tstzrange(v_end + interval '45 minutes', v_end + interval '105 minutes', '[)'), 'committed', 'Board meeting');
  BEGIN
    PERFORM public.issue_4490_till_extend_session(v_sale, v_root, 30, '44900607-0000-4000-8000-000000000002',
      'o4-hour-ext:2', public.t4490h_v(v_sale));
    RAISE EXCEPTION 'T4490H FAIL: H-6 a taken next block must be refused';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    DECLARE v_detail text;
    BEGIN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      PERFORM public.t4490h_ok(SQLERRM = 'offer_space_taken'
          AND (v_detail::jsonb->>'nextAt')::timestamptz = v_end + interval '45 minutes'
          AND v_detail::jsonb->>'unitName' = 'Boardroom',
        'H-6 Add 30 min when the room is booked next refuses (offer_space_taken) and says when the next booking starts');
    END;
  END;
  PERFORM public.t4490h_ok((SELECT count(*) FROM public.venue_till_lines WHERE sale_id = v_sale AND kind = 'by_the_hour') = 2
      AND (public.t4490h_sale(v_sale)).total_due_minor = 1800000
      AND (SELECT ends_at FROM public.issue_4490_till_session_span(v_root)) = v_end + interval '30 minutes',
    'H-6b ... and nothing changed: no new line, no new claim, the cleanup back where it was');
END
$extend$;
SELECT public.t4490h_reset();

-- -------------------------------------------------------------------------
-- 3. Paying a session records it on its bookings; voiding one frees the unit.
-- -------------------------------------------------------------------------
SELECT public.t4490h_service();
DO $paysession$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490h_id('board_sale');
BEGIN
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 1800000, 0, 1800000,
    '44900607-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490h_v(v_sale));
  PERFORM public.t4490h_ok((v->>'salePaid')::boolean
      AND (SELECT count(*) FROM public.venue_offline_payments op
           JOIN public.venue_till_lines l ON l.stay_group_id = op.group_id
           WHERE l.sale_id = v_sale AND op.method = 'till') = 2
      AND (SELECT sum(op.amount_minor) FROM public.venue_offline_payments op
           JOIN public.venue_till_lines l ON l.stay_group_id = op.group_id WHERE l.sale_id = v_sale) = 1800000,
    'H-7 paying the check records the session and the added 30 minutes on their bookings (18,000.00 at the venue)');
END
$paysession$;
SELECT public.t4490h_reset();

SELECT public.t4490h_service();
DO $voidsession$
DECLARE
  v jsonb;
  v_sale uuid := public.t4490h_id('pool_sale');
  v_line public.venue_till_lines%ROWTYPE := public.t4490h_line(public.t4490h_id('pool_sale'), 'by_the_hour');
BEGIN
  v := public.issue_4490_till_void(v_sale, v_line.id, NULL, '44900607-0000-4000-8000-000000000002', 'Changed their mind',
    false, public.t4490h_v(v_sale));
  PERFORM public.t4490h_ok((SELECT state FROM public.venue_till_lines WHERE id = v_line.id) = 'voided'
      AND (SELECT state FROM public.stay_reservation_groups WHERE id = v_line.stay_group_id) = 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM public.venue_space_claims c WHERE c.group_id = v_line.stay_group_id AND c.state <> 'released'),
    'H-8 voiding the session line cancels its booking and frees the pool table');
  v := public.t4490h_start(public.t4490h_open('pool-again'), public.t4490h_id('pool'), public.t4490h_id('pool_unit_1'), 60, 'pool-again');
  PERFORM public.t4490h_ok(true, 'H-8b ... and that pool table can be started again');
END
$voidsession$;
SELECT public.t4490h_reset();

-- -------------------------------------------------------------------------
-- 4. Tables: a walk-in gets a staff reservation; the minimum spend shows.
-- -------------------------------------------------------------------------
SELECT public.t4490h_service();
DO $walkin$
DECLARE
  v jsonb;
  v_sale uuid;
  v_res public.reservations%ROWTYPE;
BEGIN
  v := public.issue_4490_till_seat('44900607-0000-4000-9000-0000000000a1', '44900607-0000-4000-8000-000000000002',
    public.t4490h_id('spot_T1'), 3, NULL, NULL, NULL, 'o4-hour-seat:t1');
  v_sale := (v->>'id')::uuid;
  SELECT * INTO v_res FROM public.reservations WHERE id = (public.t4490h_sale(v_sale)).reservation_id;
  PERFORM public.t4490h_ok(v_res.status = 'seated' AND v_res.source = 'walk_in' AND v_res.created_via = 'operator'
      AND v_res.party_size = 3 AND v_res.table_id = public.t4490h_id('t1')
      AND (SELECT reservation_id FROM public.venue_order_sessions WHERE id = (public.t4490h_sale(v_sale)).session_id) = v_res.id,
    'H-9 a walk-in seated at T1 (Table reservations on): a staff reservation for now, seated, linked to the check');
  PERFORM public.t4490h_ok((v#>>'{minimumSpend,minimumMinor}')::bigint = 5000000 AND (v#>>'{minimumSpend,shortMinor}')::bigint = 5000000,
    'H-10 the check shows T1''s minimum spend: 50,000.00 to reach it');
  PERFORM public.t4490h_round(v_sale, 2);
  v := public.issue_4490_till_sale_projection(v_sale);
  PERFORM public.t4490h_ok((v#>>'{minimumSpend,shortMinor}')::bigint = 3000000,
    'H-10b after 20,000.00 of food and drink: 30,000.00 to reach the minimum spend');
  PERFORM public.t4490h_expect(format($q$SELECT public.issue_4490_till_seat('44900607-0000-4000-9000-0000000000a1',
      '44900607-0000-4000-8000-000000000002', %L, 2, NULL, NULL, NULL, 'o4-hour-seat:t1-again')$q$, public.t4490h_id('spot_T1')),
    'PT409', 'till_spot_has_check', 'H-11 seating a table that has its own check is refused');
  PERFORM public.t4490h_expect(format($q$SELECT public.issue_4490_till_seat('44900607-0000-4000-9000-0000000000a1',
      '44900607-0000-4000-8000-000000000005', %L, 2, NULL, NULL, NULL, 'o4-hour-seat:t2-noright')$q$, public.t4490h_id('spot_T2')),
    '42501', 'not_authorized', 'H-12 staff who may not sell cannot seat a table');
END
$walkin$;
SELECT public.t4490h_reset();

-- -------------------------------------------------------------------------
-- 5. A booking's paid deposit comes off the bill, once (T12).
-- -------------------------------------------------------------------------
INSERT INTO public.reservations (id, brand_id, venue_id, reserved_for, party_size, status, source, created_via,
  guest_name, guest_phone_e164, table_id, fee_cents, fee_currency, payment_status)
VALUES ('44900607-0000-4000-d000-000000000001', '44900607-0000-4000-9000-000000000010', '44900607-0000-4000-9000-0000000000a1',
  now(), 4, 'confirmed', 'mingla', 'guest', 'Ada Deposit', '+2348031234567', public.t4490h_id('t2'), 500000, 'NGN', 'paid'),
  ('44900607-0000-4000-d000-000000000002', '44900607-0000-4000-9000-000000000010', '44900607-0000-4000-9000-0000000000a1',
  now(), 2, 'confirmed', 'mingla', 'guest', 'Bayo NoDeposit', '+2348031234568', NULL, NULL, NULL, 'none');
SELECT public.t4490h_service();
DO $deposit$
DECLARE
  v jsonb;
  v_sale uuid;
  v_s public.venue_till_sales%ROWTYPE;
  v_pay uuid;
BEGIN
  v := public.issue_4490_till_seat('44900607-0000-4000-9000-0000000000a1', '44900607-0000-4000-8000-000000000002',
    public.t4490h_id('spot_T2'), NULL, '44900607-0000-4000-d000-000000000001', NULL, NULL, 'o4-hour-seat:ada');
  v_sale := (v->>'id')::uuid;
  PERFORM public.t4490h_round(v_sale, 3);
  v_s := public.t4490h_sale(v_sale);
  -- 3 x 10,000.00 + 10% = 33,000.00; deposit 5,000.00 off -> 28,000.00.
  PERFORM public.t4490h_ok(v_s.subtotal_minor = 3000000 AND v_s.service_charge_minor = 300000
      AND v_s.credit_minor = 500000 AND v_s.total_due_minor = 2800000
      AND (public.t4490h_line(v_sale, 'deposit_credit')).amount_minor = 500000
      AND (SELECT deposit_applied_sale_id FROM public.reservations WHERE id = '44900607-0000-4000-d000-000000000001') = v_sale
      AND (SELECT status FROM public.reservations WHERE id = '44900607-0000-4000-d000-000000000001') = 'seated',
    'D-1 seating Ada''s booking: the 5,000.00 paid deposit comes off the bill (33,000.00 - 5,000.00 = 28,000.00); the service charge is on the full bill; the booking is seated and marked used on this check');
  PERFORM public.t4490h_expect(format($q$SELECT public.issue_4490_till_seat('44900607-0000-4000-9000-0000000000a1',
      '44900607-0000-4000-8000-000000000002', %L, NULL, '44900607-0000-4000-d000-000000000001', NULL, NULL, 'o4-hour-seat:ada-2')$q$,
      public.t4490h_id('spot_T1')),
    'PT409', NULL, 'D-2 seating the same booking on another check is refused (its table has a check / its deposit is used)');
  PERFORM public.t4490h_expect(format($q$INSERT INTO public.venue_till_lines (sale_id, kind, reservation_id, amount_minor, state)
      VALUES (%L, 'deposit_credit', '44900607-0000-4000-d000-000000000001', 500000, 'held')$q$, public.t4490h_open('dep-dup')),
    '23505', NULL, 'D-3 a second live credit for the same booking cannot exist (partial unique index)');
  -- No refund obligation for that booking can be written while the deposit is applied.
  PERFORM public.t4490h_expect($q$INSERT INTO public.source_refunds (source_type, subject_id)
      VALUES ('venue_reservation', '44900607-0000-4000-d000-000000000001')$q$,
    'P0001', 'reservation_deposit_used', 'D-4 a refund of the applied deposit is refused (reservation_deposit_used)');
  PERFORM public.t4490h_expect($q$INSERT INTO public.source_refunds (source_type, subject_id)
      VALUES ('venue_reservation', '44900607-0000-4000-d000-000000000002')$q$,
    '23502', NULL, 'D-4b another booking''s refund row is not touched by the guard (it fails on its own missing columns, as before)');
  -- Evenly is fine; by item is not (part of the bill is paid).
  PERFORM public.t4490h_expect(format($q$SELECT public.issue_4490_till_set_split(%L, 'by_item', '[{"items":[]},{"items":[]}]'::jsonb,
      '44900607-0000-4000-8000-000000000002', %s)$q$, v_sale, public.t4490h_v(v_sale)),
    'PT409', 'till_split_after_part_payment', 'D-5 by item is refused on a check with a deposit (part of it is paid)');
  v := public.issue_4490_till_set_split(v_sale, 'even', '{"count":2}'::jsonb, '44900607-0000-4000-8000-000000000002',
    public.t4490h_v(v_sale));
  PERFORM public.t4490h_ok((SELECT sum(amount_minor) FROM public.venue_till_shares WHERE sale_id = v_sale) = 2800000
      AND (SELECT sum(service_charge_minor) FROM public.venue_till_shares WHERE sale_id = v_sale) = 300000 - 45455,
    'D-5b evenly in 2: the shares add up to the 28,000.00 left; they carry the service charge less the deposit''s part (454.55)');
  PERFORM public.issue_4490_till_set_split(v_sale, 'none', '{}'::jsonb, '44900607-0000-4000-8000-000000000002',
    public.t4490h_v(v_sale));
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 2800000, 0, 2800000,
    '44900607-0000-4000-8000-000000000002', NULL, gen_random_uuid(), public.t4490h_v(v_sale));
  v_pay := (v->>'paymentId')::uuid;
  PERFORM public.t4490h_ok((v->>'salePaid')::boolean
      AND (SELECT service_charge_minor FROM public.venue_till_payments WHERE id = v_pay) = 300000 - 45455
      AND (SELECT deposit_applied_sale_id FROM public.reservations WHERE id = '44900607-0000-4000-d000-000000000001') = v_sale,
    'D-6 the rest (28,000.00) is paid; the payment carries 2,545.45 service charge (the deposit carried 454.55); the deposit stays used');
  PERFORM public.t4490h_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.issue_4490_till_receipt_build(v_pay)->'lines') x
                                   WHERE x->>'label' = 'Deposit paid online' AND (x->>'amountMinor')::bigint = -500000),
    'D-6b the receipt shows the deposit as money off (-5,000.00)');
END
$deposit$;
SELECT public.t4490h_reset();

SELECT public.t4490h_service();
DO $depvoid$
DECLARE
  v jsonb;
  v_sale uuid;
BEGIN
  -- Bayo booked any table and paid a 3,000.00 deposit; seated at T2 (free again).
  UPDATE public.reservations SET fee_cents = 300000, fee_currency = 'NGN', payment_status = 'paid'
  WHERE id = '44900607-0000-4000-d000-000000000002';
  v := public.issue_4490_till_seat('44900607-0000-4000-9000-0000000000a1', '44900607-0000-4000-8000-000000000002',
    public.t4490h_id('spot_T2'), NULL, '44900607-0000-4000-d000-000000000002', NULL, NULL, 'o4-hour-seat:bayo');
  v_sale := (v->>'id')::uuid;
  PERFORM public.t4490h_ok((v->>'creditMinor')::bigint = 300000 AND (v->>'totalDueMinor')::bigint = 0
      AND (SELECT table_id FROM public.reservations WHERE id = '44900607-0000-4000-d000-000000000002') = public.t4490h_id('t2'),
    'D-7 a deposit larger than the bill so far: the bill is 0.00 (floor), the booking takes the table it was seated at');
  v := public.issue_4490_till_void(v_sale, (public.t4490h_line(v_sale, 'deposit_credit')).id, NULL,
    '44900607-0000-4000-8000-000000000002', 'Changed their mind', false, public.t4490h_v(v_sale));
  PERFORM public.t4490h_ok((SELECT deposit_applied_sale_id FROM public.reservations WHERE id = '44900607-0000-4000-d000-000000000002') IS NULL
      AND (v->>'creditMinor')::bigint = 0,
    'D-8 voiding the credit line: the deposit is no longer used on the check and follows the booking''s own rules again');
  PERFORM public.t4490h_expect($q$INSERT INTO public.source_refunds (source_type, subject_id)
      VALUES ('venue_reservation', '44900607-0000-4000-d000-000000000002')$q$,
    '23502', NULL, 'D-8b ... so a refund row for it is no longer refused by the guard (it fails only on its own missing columns)');
END
$depvoid$;
SELECT public.t4490h_reset();

-- -------------------------------------------------------------------------
-- 6. The Till reads, and the grants.
-- -------------------------------------------------------------------------
SELECT public.t4490h_service();
DO $reads$
DECLARE
  v jsonb := public.issue_4490_till_catalog('44900607-0000-4000-9000-0000000000a1', '44900607-0000-4000-8000-000000000002');
BEGIN
  PERFORM public.t4490h_ok((v->>'tableReservationsOn')::boolean AND (v->>'minSpendOn')::boolean
      AND jsonb_array_length(v->'tables') = 2
      AND (SELECT (x->>'minSpendMinor')::bigint FROM jsonb_array_elements(v->'tables') x WHERE x->>'name' = 'T1') = 5000000
      AND (SELECT count(*) FROM jsonb_array_elements(v->'hourOffers') x) = 2
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'hourOffers') x WHERE x->>'name' = 'Studio')
      AND (SELECT jsonb_array_length(x->'units') FROM jsonb_array_elements(v->'hourOffers') x WHERE x->>'name' = 'Pool table') = 3,
    'H-13 the Till catalog lists the tables (with T1''s minimum spend) and the sessions staff can start (not the Studio)');
END
$reads$;
SELECT public.t4490h_reset();
SELECT public.t4490h_ok(
  NOT has_function_privilege('authenticated', 'public.issue_4490_till_start_session(uuid,uuid,uuid,integer,integer,uuid,text,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_extend_session(uuid,uuid,integer,uuid,text,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_seat(uuid,uuid,uuid,integer,uuid,text,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_session_book(uuid,uuid,uuid,uuid,integer,uuid,text,tstzrange,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_catalog_extras(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_till_seat(uuid,uuid,uuid,integer,uuid,text,uuid,text)', 'EXECUTE')
  AND (SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p
       WHERE p.proname IN ('issue_4490_till_start_session', 'issue_4490_till_extend_session', 'issue_4490_till_seat',
                           'issue_4490_till_session_book', 'issue_4490_till_session_span', 'issue_4490_till_catalog_extras',
                           'issue_4490_reservation_deposit_refund_guard', 'issue_4490_till_line_voided')),
  'H-14 the new functions are internal (service role only), SECURITY DEFINER with an empty search_path');
SELECT public.t4490h_as('44900607-0000-4000-8000-000000000006');
SELECT public.t4490h_ok((SELECT count(*) FROM public.venue_till_lines WHERE kind = 'deposit_credit') = 0,
  'H-15 another brand''s owner reads no Till lines (RLS unchanged)');
SELECT public.t4490h_reset();

ROLLBACK;
