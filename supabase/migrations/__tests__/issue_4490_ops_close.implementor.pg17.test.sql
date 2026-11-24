-- #4490 spec 08 O5 part B: executable PostgreSQL 17 proof for migration
-- 20281203704490 (the daily close, the drawer, Move to tomorrow, export, the
-- one business day). The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-CLOSE-SNAPSHOT-IMMUTABLE | issue #4490 | a closed day's venue_day_closes.totals is written once by issue_4490_day_close and never changes while the day is closed (any other UPDATE or a DELETE raises day_close_immutable; history only grows); money that lands later for that day is listed as late from the snapshot's own payment ids, never added to the snapshot.
-- MINGLA-INVARIANT: I-4490-CLOSE-ONE-DAY | issue #4490 | the daily close, the Till's business date and Paid in today use one day: the venue's service day (issue_4490_venue_service_date); venue_till_settings.day_starts_at is not read.
-- MINGLA-INVARIANT: I-4490-CLOSE-RECONCILES | issue #4490 | a day's close adds up: Σ by payment type = Σ by person = takings; tips by server + tips of non-staff rows = tips; takings - refunds = net; Paid in today's at-the-venue part = the Till's offer parts taken in cash or on the venue's machine + door money, and its online part = the Till's offer parts taken by tap or scan + bookings paid online.
-- MINGLA-INVARIANT: I-4490-CLOSE-NEVER-MOVES-MONEY | issue #4490 | closing, reopening, carrying a check and recording the drawer write no payment, refund, offline payment or source refund row.
--
-- FAILS-ON-REVERT (verified on a fresh replay): drop the close guard trigger
-- and C-SNAP-1 fails (the snapshot can be rewritten); put
-- issue_4490_till_business_date back on day_starts_at and C-DAY-1 fails;
-- make open checks never block and C-BLOCK-0 fails; read live money for a
-- closed day and C-LATE-1 fails; leave paid outs out of the drawer and
-- C-SUM-15 fails.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t5b_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490C FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t5b_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490C FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490C FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t5b_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t5b_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t5b_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t5b_ok(boolean,text), public.t5b_expect(text,text,text,text),
  public.t5b_as(uuid), public.t5b_service(), public.t5b_reset() TO PUBLIC;
CREATE TEMP TABLE t5b_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t5b_ids TO PUBLIC;
CREATE FUNCTION public.t5b_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t5b_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t5b_id(text) TO PUBLIC;
CREATE FUNCTION public.t5b_v(p_sale uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.venue_till_sales WHERE id = p_sale
$f$;
GRANT EXECUTE ON FUNCTION public.t5b_v(uuid) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell), 03 finance manager (money, no sell),
-- 04 second seller (venue.sell), 05 door staff (venue.check_in), 06 another
-- brand's owner, 07 a Till device login, 08 an auto-added Mingla admin.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900613-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-close-' || n || '@example.test', now(), now()
FROM generate_series(1, 8) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900613-0000-4000-8000-000000000001', now()), ('44900613-0000-4000-8000-000000000006', now());
INSERT INTO public.profiles (id, display_name) VALUES
  ('44900613-0000-4000-8000-000000000002', 'Ada Seller'), ('44900613-0000-4000-8000-000000000004', 'Bola Bar')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900613-0000-4000-9000-000000000010', '44900613-0000-4000-8000-000000000001',
   'Till Close 4490', 'till-close-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900613-0000-4000-9000-000000000020', '44900613-0000-4000-8000-000000000006',
   'Other Close 4490', 'other-close-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-9000-000000000010', 'tillclosea', 'Close Club',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG'),
  ('44900613-0000-4000-9000-0000000000b1', '44900613-0000-4000-9000-000000000020', 'tillcloseb', 'Other Club',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
-- Open 10:00 to 03:00 every day: the night runs past midnight.
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-9000-0000000000a1', d, '10:00', '03:00', false
FROM generate_series(0, 6) d;
-- TEST-MOD-APPROVED #4490 (08-O5 fix 1): since 20281203734490 a moment's day uses the hours in force
-- AT that moment (venue_hours_history). This fixture writes its hours now and then places money in the
-- past, so it states that these hours were always the venue's: no history, the live hours for every moment.
DELETE FROM public.venue_hours_history WHERE venue_id = '44900613-0000-4000-9000-0000000000a1';
-- The Mingla admin row (#4579, on main since d3527e3b93): a brand_admin row
-- granted_via = 'mingla_admin' tied to its admin_users row. The admin row is
-- 'invited' so #4579's status trigger adds nothing on the other brand; the
-- member row is written as #4579's grant writes it.
-- TEST-MOD-APPROVED #4490 (merge of #4579): #4579's column exists with a CHECK that
-- a mingla_admin row names its admin_users row, so the suite no longer adds the column.
INSERT INTO public.admin_users (id, email, role, status) VALUES
  ('44900613-0000-4000-b000-000000000008', 'till-close-8@example.test', 'admin', 'invited');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900613-0000-4000-a000-000000000002', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900613-0000-4000-a000-000000000003', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-8000-000000000003', 'finance_manager', now()),
  ('44900613-0000-4000-a000-000000000004', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-8000-000000000004', 'venue_staff', now()),
  ('44900613-0000-4000-a000-000000000005', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-8000-000000000005', 'venue_staff', now()),
  ('44900613-0000-4000-a000-000000000007', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-8000-000000000007', 'venue_staff', now()),
  ('44900613-0000-4000-a000-000000000008', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-8000-000000000008', 'brand_admin', now());
UPDATE public.brand_team_members
   SET granted_via = 'mingla_admin', granted_admin_user_id = '44900613-0000-4000-b000-000000000008'
 WHERE id = '44900613-0000-4000-a000-000000000008';
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900613-0000-4000-a000-000000000002', '44900613-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900613-0000-4000-a000-000000000004', '44900613-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900613-0000-4000-a000-000000000005', '44900613-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']),
  ('44900613-0000-4000-a000-000000000007', '44900613-0000-4000-9000-0000000000a1', 'custom',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900613-0000-4000-b000-000000000001', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900613-0000-4000-b000-000000000011', '44900613-0000-4000-b000-000000000001', '44900613-0000-4000-9000-000000000010', 'Chapman', 500000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;

-- About noon in the venue's time zone, whenever this runs (offers sell now).
SELECT public.t5b_service();
SELECT public.issue_4490_ensure_booking_settings('44900613-0000-4000-9000-0000000000a1');
SELECT public.t5b_reset();
UPDATE public.venue_booking_settings
SET timezone = CASE WHEN 12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer >= 0
                    THEN 'Etc/GMT-' || (12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer)
                    ELSE 'Etc/GMT+' || (extract(hour FROM now() AT TIME ZONE 'UTC')::integer - 12) END
WHERE venue_id = '44900613-0000-4000-9000-0000000000a1';

-- D = yesterday's service day; t5b_at(D + offset days, 'HH:MI') = that local moment.
CREATE FUNCTION public.t5b_today() RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT public.issue_4490_venue_service_date('44900613-0000-4000-9000-0000000000a1', now())
$f$;
CREATE FUNCTION public.t5b_d() RETURNS date LANGUAGE sql STABLE AS $f$ SELECT public.t5b_today() - 1 $f$;
CREATE FUNCTION public.t5b_at(p_day_offset integer, p_time text) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT ((public.t5b_d() + p_day_offset)::timestamp + p_time::time)
         AT TIME ZONE public.issue_4490_venue_timezone('44900613-0000-4000-9000-0000000000a1')
$f$;
GRANT EXECUTE ON FUNCTION public.t5b_today(), public.t5b_d(), public.t5b_at(integer, text) TO PUBLIC;
SELECT public.t5b_ok(extract(hour FROM now() AT TIME ZONE public.issue_4490_venue_timezone('44900613-0000-4000-9000-0000000000a1')) BETWEEN 11 AND 13,
  'C-0 fixture: it is about noon in the venue''s time zone; D is yesterday''s service day');

SELECT public.t5b_as('44900613-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  a uuid := '44900613-0000-4000-9000-0000000000a1';
  v jsonb;
  s jsonb;
  v_board uuid;
  v_board_space uuid;
  v_pool uuid;
  v_offer uuid;
  v_option uuid;
  v_version bigint;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a, 'till', true, NULL, NULL, NULL, 'c5b-key-till-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'menu', true, NULL, NULL, NULL, 'c5b-key-menu-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'by_the_hour', true, NULL, NULL, NULL, 'c5b-key-hour-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'table_reservations', true, NULL, NULL, NULL, 'c5b-key-tables-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'min_spend_tables', true, NULL, NULL, NULL, 'c5b-key-minspend-on', true);
  PERFORM public.issue_4490_set_venue_feature(a, 'entry', true, NULL, NULL, NULL, 'c5b-key-entry-on', true);
  -- Boardroom by the hour: 30-minute steps, 60-120 minutes, staff can start it.
  s := public.issue_4490_manage_space('create', a, '{"name":"Boardroom","setting":"indoor","capacity_seated":10}'::jsonb, NULL);
  v_board_space := (s->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"by_the_hour","name":"Boardroom"}'::jsonb, NULL, 'c5b-key-board-draft');
  v_board := (v->>'id')::uuid;
  v := public.issue_4490_manage_hour('set_place', a, jsonb_build_object('offerId', v_board, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'c5b-key-board-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_board, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 1200000), (v->>'version')::bigint, 'c5b-key-board-price');
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_board, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'c5b-key-board-policy');
  v := public.issue_4490_manage_hour('set_hours', a, jsonb_build_object('offerId', v_board, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '06:00', 'endTime', '22:00'), (v->>'version')::bigint, 'c5b-key-board-hours');
  v := public.issue_4490_manage_hour('set_length', a, jsonb_build_object('offerId', v_board, 'stepMinutes', 30, 'minMinutes', 60,
    'maxMinutes', 120), (v->>'version')::bigint, 'c5b-key-board-len');
  v := public.issue_4490_manage_hour('set_rules', a, jsonb_build_object('offerId', v_board, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 0, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'c5b-key-board-rules');
  v := public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_board), (v->>'version')::bigint, 'c5b-key-board-pub');
  -- Tables T1 and T2.
  s := public.issue_4490_manage_space('create', a, '{"name":"Dining room","setting":"indoor","capacity_seated":40}'::jsonb, NULL);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T1', 'capacity', 4, 'spaceId', s->>'id'), 'c5b-key-t1');
  INSERT INTO t5b_ids VALUES ('t1', (v->>'id')::uuid);
  v := public.issue_4490_manage_table('create', a, jsonb_build_object('name', 'T2', 'capacity', 4, 'spaceId', s->>'id'), 'c5b-key-t2');
  INSERT INTO t5b_ids VALUES ('t2', (v->>'id')::uuid), ('board', v_board), ('board_space', v_board_space);
  -- Entry at the door: 3,000.00 a guest.
  v := public.issue_4490_manage_capacity_pool('create', a, '{"name":"Door","dailyLimit":40,"keptForWalkIns":10}'::jsonb, NULL, 'c5b-key-pool');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', a, '{"kind":"entry","name":"Door entry","entryStyle":"walk_in"}'::jsonb, NULL, 'c5b-key-entry');
  v_offer := (v->>'id')::uuid; v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_pool', a, jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_version, 'c5b-key-entry-pool');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', a, jsonb_build_object('offerId', v_offer, 'name', 'Standard',
    'unit', 'guest', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 300000), v_version, 'c5b-key-entry-price');
  v_version := (v->>'version')::bigint;
  SELECT (row->>'id')::uuid INTO v_option FROM jsonb_array_elements(v->'options') row WHERE row->>'name' = 'Standard';
  v := public.issue_4490_manage_offer('set_policy', a, jsonb_build_object('offerId', v_offer, 'refundLadder', '[]'::jsonb,
    'dateChangeRule', '{}'::jsonb), v_version, 'c5b-key-entry-policy');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', a, jsonb_build_object('offerId', v_offer, 'mode', 'full_day',
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '00:00', 'endTime', '23:59'), v_version, 'c5b-key-entry-schedule');
  v_version := (v->>'version')::bigint;
  PERFORM public.issue_4490_manage_offer('publish', a, jsonb_build_object('offerId', v_offer), v_version, 'c5b-key-entry-publish');
  INSERT INTO t5b_ids VALUES ('entry', v_offer), ('entry_option', v_option);
END
$setup$;
SELECT public.t5b_reset();
INSERT INTO t5b_ids
SELECT 'spot_' || t.name, q.id FROM public.qr_spots q JOIN public.venue_tables t ON t.id = q.venue_table_id
WHERE t.venue_id = '44900613-0000-4000-9000-0000000000a1';
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled, fee_enabled, fee_refundable, cancel_cutoff_hours)
VALUES ('44900613-0000-4000-9000-000000000010', '44900613-0000-4000-9000-0000000000a1', true, true, true, 1)
ON CONFLICT (venue_id) DO UPDATE SET fee_refundable = true, cancel_cutoff_hours = 1;

-- ---------------------------------------------------------------------------
-- Builders (as the Till edge calls them).
-- ---------------------------------------------------------------------------
CREATE SEQUENCE public.t5b_pickup START 301;
GRANT USAGE ON SEQUENCE public.t5b_pickup TO PUBLIC;
-- A held round of n x Chapman 5,000.00 + 10% service charge, taken by p_actor.
CREATE FUNCTION public.t5b_round(p_sale uuid, p_qty integer, p_actor uuid) RETURNS uuid
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
    v_order, v_session, '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-9000-0000000000a1', 'staff',
    p_actor, lpad(nextval('public.t5b_pickup')::text, 3, '0'), 'Guest',
    'venue_collected', 'NGN', 500000 * p_qty, 500000 * p_qty, 0, 1000, 50000 * p_qty, 0, 0, 0, false, false, false,
    550000 * p_qty, 550000 * p_qty, 'pending', 'held', 'till-c5b-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  SELECT v_order, '44900613-0000-4000-b000-000000000011', n, 'Chapman', 500000, 'NGN', 1, 0, 500000
  FROM generate_series(1, p_qty) n;
  PERFORM public.issue_4490_till_attach_round(p_sale, v_order, p_actor, NULL);
  RETURN v_order;
END
$f$;
CREATE FUNCTION public.t5b_open(p_key text, p_actor uuid, p_label text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT (public.issue_4490_till_open('44900613-0000-4000-9000-0000000000a1', p_actor,
    NULL, p_label, NULL, 'c5b-key-open:' || p_key)->>'id')::uuid
$f$;
-- A check with one round of n Chapman.
CREATE FUNCTION public.t5b_check(p_key text, p_qty integer, p_actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_sale uuid;
BEGIN
  v_sale := public.t5b_open(p_key, p_actor, initcap(p_key));
  PERFORM public.t5b_round(v_sale, p_qty, p_actor);
  INSERT INTO t5b_ids VALUES ('sale_' || p_key, v_sale);
  RETURN v_sale;
END
$f$;
CREATE FUNCTION public.t5b_cash(p_sale uuid, p_amount bigint, p_tip bigint, p_actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_take_payment(p_sale, 'cash', p_amount, p_tip, p_amount + p_tip, p_actor, NULL,
    gen_random_uuid(), public.t5b_v(p_sale));
  RETURN (v#>>'{payment,id}')::uuid;
END
$f$;
CREATE FUNCTION public.t5b_machine(p_sale uuid, p_amount bigint, p_actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_take_payment(p_sale, 'own_machine', p_amount, 0, NULL, p_actor, NULL,
    gen_random_uuid(), public.t5b_v(p_sale));
  RETURN (v#>>'{payment,id}')::uuid;
END
$f$;
-- The priced carrier the edge sends: take rate 150 bps + platform 300 bps,
-- optionally the Mingla fee passed to the guest, no tax.
CREATE FUNCTION public.t5b_money(p_amount bigint, p_sc bigint, p_tip bigint, p_provider text, p_pass boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object('provider', p_provider,
    'stripeAccountId', CASE WHEN p_provider = 'stripe' THEN 'acct_c5btest' END, 'currency', 'NGN',
    'subtotalCents', p_amount - p_sc, 'serviceChargeCents', p_sc, 'tipCents', p_tip,
    'effectiveTakeRateBps', 150, 'serviceFeeBps', 300,
    'minglaFeeCents', round(p_amount::numeric * 150 / 10000), 'platformServiceFeeCents', round(p_amount::numeric * 300 / 10000),
    'passMinglaFee', p_pass, 'passServiceFee', false, 'passTax', false,
    'buyerSubtotalCents', p_amount + CASE WHEN p_pass THEN round(p_amount::numeric * 150 / 10000) ELSE 0 END,
    'taxAmountCents', 0,
    'totalCents', p_amount + p_tip + CASE WHEN p_pass THEN round(p_amount::numeric * 150 / 10000) ELSE 0 END,
    'pricingBreakdown', '{}'::jsonb)
$f$;
-- Start a scan (or tap) payment for what is left; returns the payment id.
CREATE FUNCTION public.t5b_card_start(p_sale uuid, p_method text, p_tip bigint, p_actor uuid, p_code text, p_pass boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_card_prepare(p_sale, p_actor, public.t5b_v(p_sale));
  v := public.issue_4490_till_card_start(p_sale, p_method, p_tip, p_actor, NULL, gen_random_uuid(),
    (v->>'version')::integer,
    public.t5b_money((v->>'amountMinor')::bigint, (v->>'serviceChargeMinor')::bigint, p_tip,
      CASE WHEN p_method = 'tap' THEN 'stripe' ELSE 'paystack' END, p_pass),
    p_code);
  RETURN (v->>'paymentId')::uuid;
END
$f$;
-- A scan payment lands (Paystack charge.success with the channel).
CREATE FUNCTION public.t5b_scan_lands(p_payment uuid, p_channel text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_car public.venue_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_car FROM public.venue_orders WHERE till_payment_id = p_payment;
  UPDATE public.venue_orders SET paystack_reference = 'mingla_vo_' || replace(v_car.id::text, '-', ''),
    metadata = metadata || jsonb_build_object('provider_channel', p_channel)
  WHERE id = v_car.id;
  RETURN public.pg_venue_order_finalize_payment(v_car.id, 'paystack', v_car.total_cents, 'NGN',
    'mingla_vo_' || replace(v_car.id::text, '-', ''), 'ch-' || left(v_car.id::text, 8), NULL, NULL);
END
$f$;
-- A booking whose table deposit was paid online two days before D.
CREATE FUNCTION public.t5b_booking(p_key text, p_table uuid, p_amount integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v_res uuid;
BEGIN
  INSERT INTO public.reservations (brand_id, venue_id, reserved_for, party_size, status, payment_status, source, created_via,
    guest_name, guest_email, guest_phone_e164, table_id, fee_cents, fee_currency, payment_intent_id, created_at)
  VALUES ('44900613-0000-4000-9000-000000000010', '44900613-0000-4000-9000-0000000000a1', now(), 2, 'confirmed', 'paid',
    'website', 'guest', 'Guest ' || p_key, p_key || '@example.test', '+2348030004490', p_table, p_amount, 'NGN',
    'pay_' || p_key, public.t5b_at(-2, '12:00'))
  RETURNING id INTO v_res;
  INSERT INTO public.reservation_checkout_sessions (brand_id, venue_id, reservation_id, reserved_for, party_size, buyer_name,
    buyer_email, buyer_phone_e164, amount_cents, currency, created_via, status, application_fee_amount_cents,
    paystack_reference, guest_cancel_token_hash)
  VALUES ('44900613-0000-4000-9000-000000000010', '44900613-0000-4000-9000-0000000000a1', v_res, now(), 2, 'Guest ' || p_key,
    p_key || '@example.test', '+2348030004490', p_amount, 'NGN', 'web', 'completed', 0, 'mingla_resv_' || p_key,
    'v1:' || encode(extensions.digest('tok-' || p_key, 'sha256'), 'hex'));
  RETURN v_res;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t5b_round(uuid, integer, uuid), public.t5b_open(text, uuid, text),
  public.t5b_check(text, integer, uuid), public.t5b_cash(uuid, bigint, bigint, uuid), public.t5b_machine(uuid, bigint, uuid),
  public.t5b_money(bigint, bigint, bigint, text, boolean), public.t5b_card_start(uuid, text, bigint, uuid, text, boolean),
  public.t5b_scan_lands(uuid, text), public.t5b_booking(text, uuid, integer) TO PUBLIC;

-- Test-only time travel inside this rolled-back transaction: a check (and
-- everything of it) happened at a given moment; a refund at another. The
-- money rows are append-only, so their guards are switched off here only.
ALTER TABLE public.venue_offline_payments DISABLE TRIGGER USER;
ALTER TABLE public.source_refunds DISABLE TRIGGER USER;
ALTER TABLE public.stay_reservation_events DISABLE TRIGGER USER;
-- TEST-MOD-APPROVED #4490 (08-O5 fix 1): the close reads the day the Till STORED when the money was
-- recorded (business_date, opened_business_date), so time travel moves the stored day with the moment,
-- exactly as the Till would have written it then.
CREATE FUNCTION public.t5b_move(p_sale uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  UPDATE public.venue_till_sales SET created_at = p_at - interval '30 minutes',
    opened_business_date = public.issue_4490_till_business_date(venue_id, p_at - interval '30 minutes'),
    business_date = CASE WHEN paid_at IS NULL THEN business_date ELSE public.issue_4490_till_business_date(venue_id, p_at) END,
    paid_at = CASE WHEN paid_at IS NULL THEN NULL ELSE p_at END WHERE id = p_sale;
  UPDATE public.venue_till_payments SET created_at = p_at - interval '1 minute',
    business_date = CASE WHEN paid_at IS NULL THEN business_date
                         ELSE public.issue_4490_till_business_date('44900613-0000-4000-9000-0000000000a1', p_at) END,
    paid_at = CASE WHEN paid_at IS NULL THEN NULL ELSE p_at END WHERE sale_id = p_sale;
  UPDATE public.venue_offline_payments SET created_at = p_at
  WHERE till_payment_id IN (SELECT id FROM public.venue_till_payments WHERE sale_id = p_sale);
  UPDATE public.venue_orders SET confirmed_at = CASE WHEN confirmed_at IS NULL THEN NULL ELSE p_at END
  WHERE till_payment_id IN (SELECT id FROM public.venue_till_payments WHERE sale_id = p_sale);
  UPDATE public.venue_till_lines SET voided_at = CASE WHEN voided_at IS NULL THEN NULL ELSE p_at - interval '10 minutes' END
  WHERE sale_id = p_sale;
  UPDATE public.venue_order_items SET voided_at = p_at - interval '10 minutes'
  WHERE voided_at IS NOT NULL
    AND venue_order_id IN (SELECT venue_order_id FROM public.venue_till_lines WHERE sale_id = p_sale AND kind = 'menu_round');
  UPDATE public.source_refunds SET requested_at = p_at WHERE idempotency_key = 'venue_deposit_excess:' || p_sale;
END
$f$;
CREATE FUNCTION public.t5b_move_refunds(p_sale uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  UPDATE public.venue_till_refunds SET created_at = p_at,
    business_date = public.issue_4490_till_business_date('44900613-0000-4000-9000-0000000000a1', p_at)
  WHERE payment_id IN (SELECT id FROM public.venue_till_payments WHERE sale_id = p_sale);
  UPDATE public.venue_till_lines SET refunded_at = p_at WHERE sale_id = p_sale AND refunded_at IS NOT NULL;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t5b_move(uuid, timestamptz), public.t5b_move_refunds(uuid, timestamptz) TO PUBLIC;

-- ===========================================================================
-- C-DAY. One business day: the Till's date is the service day.
-- ===========================================================================
SELECT public.t5b_service();
UPDATE public.venue_till_settings SET day_starts_at = '00:00' WHERE venue_id = '44900613-0000-4000-9000-0000000000a1';
INSERT INTO public.venue_till_settings (venue_id, brand_id, day_starts_at)
SELECT '44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-9000-000000000010', '00:00'
WHERE NOT EXISTS (SELECT 1 FROM public.venue_till_settings WHERE venue_id = '44900613-0000-4000-9000-0000000000a1');
SELECT public.t5b_ok(
    public.issue_4490_till_business_date('44900613-0000-4000-9000-0000000000a1', public.t5b_at(1, '00:40')) = public.t5b_d()
    AND public.issue_4490_till_business_date('44900613-0000-4000-9000-0000000000a1', public.t5b_at(1, '04:00')) = public.t5b_d() + 1
    AND public.issue_4490_till_business_date('44900613-0000-4000-9000-0000000000a1', public.t5b_at(0, '09:00')) = public.t5b_d(),
  'C-DAY-1 the Till''s business date is the service day: 00:40 after a night open to 03:00 is the night before; 04:00 is the next day');
SELECT public.t5b_ok(
    public.issue_4490_till_business_date('44900613-0000-4000-9000-0000000000a1', public.t5b_at(1, '00:40'))
      = public.issue_4490_venue_service_date('44900613-0000-4000-9000-0000000000a1', public.t5b_at(1, '00:40')),
  'C-DAY-2 day_starts_at (set to 00:00 here) is not read: the Till and Paid in today use one day');

-- ===========================================================================
-- C-FIX. The hand-built day D at Close Club (every kind O1-O4 can produce).
-- ===========================================================================
DO $day$
DECLARE
  s uuid;
  p uuid;
  p2 uuid;
  v jsonb;
  v_share1 uuid;
  v_share2 uuid;
  v_share3 uuid;
  v_line uuid;
  v_res uuid;
  ada uuid := '44900613-0000-4000-8000-000000000002';
  bola uuid := '44900613-0000-4000-8000-000000000004';
  owner uuid := '44900613-0000-4000-8000-000000000001';
  mingla uuid := '44900613-0000-4000-8000-000000000008';
BEGIN
  -- S1 cash: 2 Chapman 11,000.00 (1,000.00 service), tip 1,000.00, D 19:00.
  s := public.t5b_check('s1', 2, ada);
  PERFORM public.t5b_cash(s, 1100000, 100000, ada);
  PERFORM public.t5b_move(s, public.t5b_at(0, '19:00'));
  -- S2 own machine: 1 Chapman 5,500.00, Bola, D 19:10.
  s := public.t5b_check('s2', 1, bola);
  PERFORM public.t5b_machine(s, 550000, bola);
  PERFORM public.t5b_move(s, public.t5b_at(0, '19:10'));
  -- S3 scan by card: 5,500.00 + tip 550.00, D 19:20.
  s := public.t5b_check('s3', 1, ada);
  p := public.t5b_card_start(s, 'scan', 55000, ada, 'C5BAAAAA', false);
  PERFORM public.t5b_scan_lands(p, 'card');
  PERFORM public.t5b_move(s, public.t5b_at(0, '19:20'));
  -- S4 scan by bank transfer: 2 Chapman 11,000.00, D 19:30.
  s := public.t5b_check('s4', 2, ada);
  p := public.t5b_card_start(s, 'scan', 0, ada, 'C5BBBBBB', false);
  PERFORM public.t5b_scan_lands(p, 'bank_transfer');
  PERFORM public.t5b_move(s, public.t5b_at(0, '19:30'));
  -- S5 tap: 5,500.00 + tip 500.00, the Mingla fee (82.50) passed to the guest, Bola, D 19:40.
  s := public.t5b_check('s5', 1, bola);
  p := public.t5b_card_start(s, 'tap', 50000, bola, NULL, true);
  INSERT INTO public.door_tap_intents (brand_id, till_payment_id, client_request_id, lines, currency, subtotal_cents,
    fee_cents, total_cents, application_fee_cents, stripe_account_id, stripe_payment_intent_id, created_by)
  VALUES ('44900613-0000-4000-9000-000000000010', p, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('kind', 'till_payment', 'paymentId', p)),
    'NGN', 583500, 24750, 608250, 24750, 'acct_c5btest', 'pi_c5btap', bola);
  PERFORM public.issue_4490_till_tap_record('pi_c5btap', 'ch_c5b', 608250, 'visa', '4242');
  PERFORM public.t5b_move(s, public.t5b_at(0, '19:40'));
  -- S6 part payments: 3 Chapman 16,500.00: 6,000.00 cash, then 10,500.00 on the venue's machine, D 20:00.
  s := public.t5b_check('s6', 3, ada);
  PERFORM public.t5b_cash(s, 600000, 0, ada);
  PERFORM public.t5b_machine(s, 1050000, ada);
  PERFORM public.t5b_move(s, public.t5b_at(0, '20:00'));
  -- S7 split evenly in three (5,500.00 each): cash, scan by card, cash; share 3 refunded in cash at 21:00.
  s := public.t5b_check('s7', 3, ada);
  v := public.issue_4490_till_set_split(s, 'even', '{"count":3}'::jsonb, ada, public.t5b_v(s));
  SELECT id INTO v_share1 FROM public.venue_till_shares WHERE sale_id = s AND share_no = 1;
  SELECT id INTO v_share2 FROM public.venue_till_shares WHERE sale_id = s AND share_no = 2;
  SELECT id INTO v_share3 FROM public.venue_till_shares WHERE sale_id = s AND share_no = 3;
  PERFORM public.issue_4490_till_pay_share(s, v_share1, 'cash', 550000, 0, 550000, ada, NULL, gen_random_uuid(), public.t5b_v(s));
  v := public.issue_4490_till_card_prepare_share(s, v_share2, ada, public.t5b_v(s));
  v := public.issue_4490_till_card_start_share(s, v_share2, 'scan', 0, ada, NULL, gen_random_uuid(), (v->>'version')::integer,
    public.t5b_money((v->>'amountMinor')::bigint, (v->>'serviceChargeMinor')::bigint, 0, 'paystack', false), 'C5BCCCCC');
  PERFORM public.t5b_scan_lands((v->>'paymentId')::uuid, 'card');
  v := public.issue_4490_till_pay_share(s, v_share3, 'cash', 550000, 0, 550000, ada, NULL, gen_random_uuid(), public.t5b_v(s));
  SELECT id INTO p FROM public.venue_till_payments WHERE share_id = v_share3 AND state = 'paid';
  PERFORM public.t5b_move(s, public.t5b_at(0, '20:40'));
  PERFORM public.issue_4490_till_refund(p, 550000, 0, 'Guest asked', false, owner, NULL, gen_random_uuid());
  PERFORM public.t5b_move_refunds(s, public.t5b_at(0, '21:00'));
  -- S8a late money kept: a scan code cancelled, then paid anyway; kept as payment. D 20:50.
  s := public.t5b_check('s8a', 1, ada);
  p := public.t5b_card_start(s, 'scan', 0, ada, 'C5BDDDDD', false);
  PERFORM public.issue_4490_till_card_cancel(p, ada);
  PERFORM public.t5b_scan_lands(p, 'card');
  PERFORM public.issue_4490_till_keep_late_payment(p, ada, public.t5b_v(s));
  PERFORM public.t5b_move(s, public.t5b_at(0, '20:50'));
  -- S8b late money refunded: code cancelled, paid in cash, the old code paid too; the card money refunded at 21:05.
  s := public.t5b_check('s8b', 1, ada);
  p := public.t5b_card_start(s, 'scan', 0, ada, 'C5BEEEEE', false);
  PERFORM public.issue_4490_till_card_cancel(p, ada);
  PERFORM public.t5b_cash(s, 550000, 0, ada);
  PERFORM public.t5b_scan_lands(p, 'card');
  PERFORM public.t5b_move(s, public.t5b_at(0, '20:55'));
  PERFORM public.issue_4490_till_mint_carrier_refund(p, 550000, 0, owner, NULL, 'Paid twice', gen_random_uuid());
  PERFORM public.t5b_move_refunds(s, public.t5b_at(0, '21:05'));
  -- S9 a voided line: 2 Chapman, one voided before sending, the rest in cash. D 21:10.
  s := public.t5b_check('s9', 2, ada);
  SELECT i.id INTO p2 FROM public.venue_order_items i JOIN public.venue_till_lines l ON l.venue_order_id = i.venue_order_id
  WHERE l.sale_id = s ORDER BY i.line_no DESC LIMIT 1;
  PERFORM public.issue_4490_till_void(s, NULL, p2, ada, 'mistake', true, public.t5b_v(s));
  PERFORM public.t5b_cash(s, 550000, 0, ada);
  PERFORM public.t5b_move(s, public.t5b_at(0, '21:10'));
  -- S10 Entry for 2 (6,000.00) in cash, the line refunded at 21:30.
  s := public.t5b_open('s10', ada, 'S10');
  INSERT INTO t5b_ids VALUES ('sale_s10', s);
  v := public.issue_4490_till_add_offer_line(s, public.t5b_id('entry'), NULL,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t5b_id('entry_option'), 'guests', 2)), ada, 'c5b-key-s10-line');
  SELECT (l->>'id')::uuid INTO v_line FROM jsonb_array_elements(v->'lines') l WHERE l->>'kind' = 'entry';
  PERFORM public.t5b_cash(s, 600000, 0, ada);
  PERFORM public.t5b_move(s, public.t5b_at(0, '21:20'));
  PERFORM public.issue_4490_till_refund_line(v_line, owner, NULL, 'Guest left', gen_random_uuid());
  PERFORM public.t5b_move_refunds(s, public.t5b_at(0, '21:30'));
  -- S11 a gate sale: 2 Entry in cash at the door (6,000.00), D 21:40.
  v := public.issue_4490_gate_sale('44900613-0000-4000-9000-0000000000a1', public.t5b_id('entry'),
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t5b_id('entry_option'), 'guests', 2)),
    'cash', '{}'::jsonb, 'c5b-key-gate-1', '44900613-0000-4000-8000-000000000005', NULL, NULL);
  UPDATE public.stay_reservation_events SET created_at = public.t5b_at(0, '21:40')
  WHERE group_id = (v#>>'{booking,groupId}')::uuid AND event_type = 'stay_offer_gate_paid';
  INSERT INTO t5b_ids VALUES ('gate_group', (v#>>'{booking,groupId}')::uuid);
  -- S12 a staff-started Boardroom hour (12,000.00) with "Add 30 min" (6,000.00), cash, D 18:00.
  s := public.t5b_open('s12', ada, 'Boardroom');
  INSERT INTO t5b_ids VALUES ('sale_s12', s);
  v := public.issue_4490_till_start_session(s, public.t5b_id('board'), public.t5b_id('board_space'), 60, 2, ada,
    'c5b-key-s12-start', public.t5b_v(s));
  SELECT id INTO v_line FROM public.venue_till_lines WHERE sale_id = s AND kind = 'by_the_hour' ORDER BY created_at LIMIT 1;
  v := public.issue_4490_till_extend_session(s, v_line, 30, ada, 'c5b-key-s12-extend', public.t5b_v(s));
  PERFORM public.t5b_cash(s, (SELECT total_due_minor - paid_minor FROM public.venue_till_sales WHERE id = s), 0, ada);
  PERFORM public.t5b_move(s, public.t5b_at(0, '18:00'));
  -- S13 a 5,000.00 deposit on an 11,000.00 bill: 6,000.00 in cash, D 22:00.
  v_res := public.t5b_booking('s13', public.t5b_id('t2'), 500000);
  v := public.issue_4490_till_seat('44900613-0000-4000-9000-0000000000a1', ada, public.t5b_id('spot_T2'), NULL, v_res,
    NULL, NULL, 'c5b-key-s13-seat');
  s := (v->>'id')::uuid;
  INSERT INTO t5b_ids VALUES ('sale_s13', s);
  PERFORM public.t5b_round(s, 2, ada);
  PERFORM public.t5b_cash(s, (SELECT total_due_minor - paid_minor FROM public.venue_till_sales WHERE id = s), 0, ada);
  PERFORM public.t5b_move(s, public.t5b_at(0, '22:00'));
  -- S14 a 20,000.00 deposit on a 5,500.00 bill: Close check (nothing due); 14,500.00 goes back to the guest. D 22:10.
  v_res := public.t5b_booking('s14', public.t5b_id('t1'), 2000000);
  v := public.issue_4490_till_seat('44900613-0000-4000-9000-0000000000a1', ada, public.t5b_id('spot_T1'), NULL, v_res,
    NULL, NULL, 'c5b-key-s14-seat');
  s := (v->>'id')::uuid;
  INSERT INTO t5b_ids VALUES ('sale_s14', s);
  PERFORM public.t5b_round(s, 1, ada);
  PERFORM public.issue_4490_till_close_covered(s, ada, public.t5b_v(s));
  PERFORM public.t5b_move(s, public.t5b_at(0, '22:10'));
  -- S17 past midnight: 00:40 after the night of D, cash with a 100.00 tip, taken by the Mingla admin.
  s := public.t5b_check('s17', 1, mingla);
  PERFORM public.t5b_cash(s, 550000, 10000, mingla);
  PERFORM public.t5b_move(s, public.t5b_at(1, '00:40'));
  -- S18 the next day (04:00) and S19b the day before (23:00): never in D.
  s := public.t5b_check('s18', 1, ada);
  PERFORM public.t5b_cash(s, 550000, 0, ada);
  PERFORM public.t5b_move(s, public.t5b_at(1, '04:00'));
  s := public.t5b_check('s19b', 1, ada);
  PERFORM public.t5b_cash(s, 550000, 0, ada);
  PERFORM public.t5b_move(s, public.t5b_at(-1, '23:00'));
  -- S19 an open check opened on D (blocks the close); S20 a check waiting on a scan code (does not block).
  s := public.t5b_check('s19', 1, ada);
  PERFORM public.t5b_move(s, public.t5b_at(0, '23:10'));
  s := public.t5b_check('s20', 1, ada);
  p := public.t5b_card_start(s, 'scan', 0, ada, 'C5BFFFFF', false);
  INSERT INTO t5b_ids VALUES ('s20_pay', p);
  PERFORM public.t5b_move(s, public.t5b_at(0, '23:20'));
END
$day$;

-- A guest page order paid online at the venue on D (3,300.00; never in the drawer).
INSERT INTO public.venue_order_sessions (id, brand_id, venue_id, currency)
VALUES ('44900613-0000-4000-c000-000000000001', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-9000-0000000000a1', 'NGN');
INSERT INTO public.venue_orders (
  session_id, brand_id, venue_id, source, pickup_code, buyer_name, buyer_email, buyer_phone_e164,
  money_path, provider, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
  tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
  buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, confirmed_at)
VALUES ('44900613-0000-4000-c000-000000000001', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-9000-0000000000a1',
  'guest_page', '777', 'Online Guest', 'online@example.test', '+2348030004491', 'mingla', 'paystack', 'NGN',
  300000, 300000, 0, 1000, 30000, 0, 0, 0, false, false, false, 330000, 330000, 'paid', 'placed', 'c5b-key-online-1',
  public.t5b_at(0, '20:30'));

-- The drawer: a float set, then changed (the newer one counts), and a paid out.
SELECT public.issue_4490_cash_movement('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 'float', 5000000, NULL,
  '44900613-0000-4000-8000-000000000003', NULL, '44900613-0000-4000-d000-000000000001');
SELECT public.issue_4490_cash_movement('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 'float', 5500000, 'Topped up',
  '44900613-0000-4000-8000-000000000003', NULL, '44900613-0000-4000-d000-000000000002');
SELECT public.issue_4490_cash_movement('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 'paid_out', 300000, 'Ice delivery',
  '44900613-0000-4000-8000-000000000003', NULL, '44900613-0000-4000-d000-000000000003');

-- Every money row the day made (so we can prove the close moves none).
CREATE TEMP TABLE t5b_money_rows AS
SELECT (SELECT count(*) FROM public.venue_till_payments) AS payments, (SELECT count(*) FROM public.venue_till_refunds) AS refunds,
       (SELECT count(*) FROM public.venue_offline_payments) AS offline, (SELECT count(*) FROM public.source_refunds) AS source_refunds;
GRANT ALL ON t5b_money_rows TO PUBLIC;

-- ===========================================================================
-- C-SUM. Every line of the summary equals the hand-built day.
-- ===========================================================================
DO $sum$
DECLARE
  v jsonb := public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000003', NULL);
  t jsonb := v->'totals';
  m jsonb;
  ada jsonb;
  bola jsonb;
  mingla jsonb;
  owner jsonb;
BEGIN
  SELECT jsonb_object_agg(e->>'method', e) INTO m FROM jsonb_array_elements(t->'byMethod') e;
  SELECT e INTO ada FROM jsonb_array_elements(t->'people') e WHERE e->>'userId' = '44900613-0000-4000-8000-000000000002';
  SELECT e INTO bola FROM jsonb_array_elements(t->'people') e WHERE e->>'userId' = '44900613-0000-4000-8000-000000000004';
  SELECT e INTO mingla FROM jsonb_array_elements(t->'people') e WHERE e->>'userId' = '44900613-0000-4000-8000-000000000008';
  SELECT e INTO owner FROM jsonb_array_elements(t->'people') e WHERE e->>'userId' = '44900613-0000-4000-8000-000000000001';
  RAISE NOTICE 'summary %', t::text;
  PERFORM public.t5b_ok(v->>'state' = 'open' AND v->>'currency' = 'NGN' AND (v->>'businessDate')::date = public.t5b_d(),
    'C-SUM-0 D is open, in NGN');
  PERFORM public.t5b_ok((t#>>'{takings,count}')::int = 18 AND (t#>>'{takings,amountMinor}')::bigint = 12900000
      AND (t#>>'{takings,tipMinor}')::bigint = 215000,
    'C-SUM-1 takings: 18 payments, 129,000.00, tips 2,150.00 (the 00:40 sale counts; 04:00 and the day before do not; the pending scan does not) ' || (t->'takings')::text);
  PERFORM public.t5b_ok(
      (m#>>'{cash,count}')::int = 10 AND (m#>>'{cash,amountMinor}')::bigint = 7450000 AND (m#>>'{cash,tipMinor}')::bigint = 110000
      AND (m#>>'{own_machine,count}')::int = 2 AND (m#>>'{own_machine,amountMinor}')::bigint = 1600000
      AND (m#>>'{tap,count}')::int = 1 AND (m#>>'{tap,amountMinor}')::bigint = 550000 AND (m#>>'{tap,tipMinor}')::bigint = 50000
      AND (m#>>'{scan_card,count}')::int = 4 AND (m#>>'{scan_card,amountMinor}')::bigint = 2200000
      AND (m#>>'{scan_card,tipMinor}')::bigint = 55000
      AND (m#>>'{scan_transfer,count}')::int = 1 AND (m#>>'{scan_transfer,amountMinor}')::bigint = 1100000
      AND NOT (m ? 'scan_other') AND NOT (m ? 'room'),
    'C-SUM-2 by payment type: cash 74,500.00 (10, tips 1,100.00), own machine 16,000.00 (2), tap 5,500.00, scan by card 22,000.00 (4 incl. both late), scan by transfer 11,000.00 ' || (t->'byMethod')::text);
  PERFORM public.t5b_ok((t#>>'{takings,guestFeesMinor}')::bigint = 8250,
    'C-SUM-3 guest-paid card fees: 82.50 (the Mingla fee the tap guest paid)');
  PERFORM public.t5b_ok((t#>>'{refunds,count}')::int = 3 AND (t#>>'{refunds,amountMinor}')::bigint = 1700000
      AND (t#>>'{refunds,tipMinor}')::bigint = 0
      AND (owner->>'refundCount')::int = 3 AND (owner->>'refundMinor')::bigint = 1700000,
    'C-SUM-4 refunds on D: 3, 17,000.00 (a split share in cash, a late card payment, an Entry line), all by the owner ' || (t->'refunds')::text);
  PERFORM public.t5b_ok((t#>>'{net,takingsMinor}')::bigint = 11200000 AND (t#>>'{net,tipMinor}')::bigint = 215000,
    'C-SUM-5 net: takings - refunds = 112,000.00');
  PERFORM public.t5b_ok((t#>>'{voids,count}')::int = 1 AND (t#>>'{voids,amountMinor}')::bigint = 500000
      AND (ada->>'voidCount')::int = 1 AND (ada->>'voidMinor')::bigint = 500000,
    'C-SUM-6 voids: one Chapman 5,000.00, by Ada ' || (t->'voids')::text);
  PERFORM public.t5b_ok((ada->>'salesCount')::int = 15 AND (ada->>'salesMinor')::bigint = 11250000
      AND (ada->>'tipsTakenMinor')::bigint = 155000 AND (ada->>'cashTakenMinor')::bigint = 7000000
      AND ada->>'kind' = 'person' AND ada->>'name' = 'Ada Seller'
      AND (bola->>'salesCount')::int = 2 AND (bola->>'salesMinor')::bigint = 1100000 AND (bola->>'tipsServedMinor')::bigint = 50000
      AND (mingla->>'salesMinor')::bigint = 550000 AND mingla->>'kind' = 'mingla_support'
      AND (mingla->>'cashTakenMinor')::bigint = 560000,
    'C-SUM-7 sales by person: Ada 112,500.00 (15), Bola 11,000.00 (2), the Mingla admin 5,500.00 labelled Mingla support ' || (t->'people')::text);
  PERFORM public.t5b_ok(jsonb_array_length(t->'tipsByServer') = 2
      AND (t#>>'{tipsByServer,0,userId}') = '44900613-0000-4000-8000-000000000002'
      AND (t#>>'{tipsByServer,0,tipsServedMinor}')::bigint = 155000
      AND (t#>>'{tipsByServer,1,tipsServedMinor}')::bigint = 50000
      AND (t->>'tipsOtherMinor')::bigint = 10000,
    'C-SUM-8 tips by who served: Ada 1,550.00, Bola 500.00; the Mingla admin''s 100.00 is kept out of staff tips (tipsOther) ' || (t->'tipsByServer')::text);
  PERFORM public.t5b_ok((t->>'serviceChargeMinor')::bigint = 954545,
    'C-SUM-9 service charge: 9,545.45 (the deposit carries its share of the 5,000.00 booking''s service charge) ' || (t->>'serviceChargeMinor'));
  PERFORM public.t5b_ok((t#>>'{depositsUsed,count}')::int = 2 AND (t#>>'{depositsUsed,amountMinor}')::bigint = 1050000,
    'C-SUM-10 deposits used: 10,500.00 on 2 checks (5,000.00 + 5,500.00 of the 20,000.00 one); never takings ' || (t->'depositsUsed')::text);
  PERFORM public.t5b_ok((t#>>'{depositRefunded,count}')::int = 1 AND (t#>>'{depositRefunded,amountMinor}')::bigint = 1450000,
    'C-SUM-11 deposit refunded: 14,500.00 back to the guest (apart from Till refunds) ' || (t->'depositRefunded')::text);
  PERFORM public.t5b_ok((t#>>'{orderedOnline,count}')::int = 1 AND (t#>>'{orderedOnline,amountMinor}')::bigint = 330000,
    'C-SUM-12 ordered online at the venue: 3,300.00 (not in the drawer)');
  PERFORM public.t5b_ok((t#>>'{door,amountMinor}')::bigint = 600000 AND (t#>>'{door,byMethod,0,method}') = 'door_cash',
    'C-SUM-13 sold at the door outside the Till: the gate sale 6,000.00 in cash ' || (t->'door')::text);
  PERFORM public.t5b_ok((t#>>'{card,chargedMinor}')::bigint = 3963250 AND (t#>>'{card,minglaFeesMinor}')::bigint = 173250
      AND (t#>>'{card,refundedMinor}')::bigint = 550000 AND (t#>>'{card,toBankMinor}')::bigint = 3240000,
    'C-SUM-14 card money: charged 39,632.50, Mingla fees 1,732.50, card refunds 5,500.00, to your bank 32,400.00 ' || (t->'card')::text);
  PERFORM public.t5b_ok((t#>>'{cash,floatMinor}')::bigint = 5500000 AND (t#>>'{cash,cashPaymentsMinor}')::bigint = 7450000
      AND (t#>>'{cash,cashTipsMinor}')::bigint = 110000 AND (t#>>'{cash,doorCashMinor}')::bigint = 600000
      AND (t#>>'{cash,cashRefundsMinor}')::bigint = 1150000 AND (t#>>'{cash,paidOutMinor}')::bigint = 300000
      AND (t#>>'{cash,expectedMinor}')::bigint = 12210000,
    'C-SUM-15 expected in the drawer: float 55,000.00 (the newer float) + cash 74,500.00 + cash tips 1,100.00 + door 6,000.00 - cash refunds 11,500.00 - paid out 3,000.00 = 122,100.00 ' || (t->'cash')::text);
  PERFORM public.t5b_ok((t#>>'{categories,bookingsMinor}')::bigint = 2400000 AND (t#>>'{categories,onOpenChecksMinor}')::bigint = 0
      AND (t#>>'{categories,foodAndDrinkMinor}')::bigint = 10500000,
    'C-SUM-16 what it was for: entry and sessions 24,000.00, food and drink 105,000.00 ' || (t->'categories')::text);
  PERFORM public.t5b_ok((t#>>'{reconcile,byMethodMatches}')::boolean AND (t#>>'{reconcile,byPersonMatches}')::boolean
      AND (t#>>'{reconcile,tipsMatch}')::boolean,
    'C-REC-1 Σ by payment type = Σ by person = takings; tips by server + other = tips');
  PERFORM public.t5b_ok((t#>>'{reconcile,atVenueMatches}')::boolean AND (t#>>'{reconcile,onlineMatches}')::boolean
      AND (t#>>'{paidInToday,paidIn,atVenue}')::bigint = 3000000 AND (t#>>'{reconcile,doorMinor}')::bigint = 600000
      AND (t#>>'{reconcile,tillBookingsAtVenueMinor}')::bigint = 2400000
      AND (t#>>'{paidInToday,paidIn,online}')::bigint = 0
      AND (t#>>'{paidInToday,paidIn,refunded}')::bigint = 2050000
      AND (t#>>'{paidInToday,paidInMinor}')::bigint = 950000,
    'C-REC-2 Paid in today for D (its own function): at the venue 30,000.00 = the Till''s entry and sessions 24,000.00 + the door 6,000.00; online 0; refunded 20,500.00 (Entry line 6,000.00 + deposit excess 14,500.00) ' || (t->'paidInToday')::text);
  PERFORM public.t5b_ok((v->>'blockingCount')::int = 1
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'openChecks') e
                  WHERE (e->>'saleId')::uuid = public.t5b_id('sale_s19') AND (e->>'blocks')::boolean)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'openChecks') e
                  WHERE (e->>'saleId')::uuid = public.t5b_id('sale_s20') AND (e->>'waitingForScan')::boolean
                    AND NOT (e->>'blocks')::boolean)
      AND NOT (v->>'canClose')::boolean,
    'C-BLOCK-0 the open check blocks; the check waiting on a scan code is listed and does not block ' || (v->'openChecks')::text);
END
$sum$;

-- ===========================================================================
-- C-RIGHTS. Who may see and close the day.
-- ===========================================================================
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000002', NULL)$q$, '42501', 'not_authorized', 'C-R1 a seller without money rights is refused');
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000005', NULL)$q$, '42501', 'not_authorized', 'C-R2 door staff are refused');
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000006', NULL)$q$, '42501', 'not_authorized', 'C-R3 another brand''s owner is refused');
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000007', NULL)$q$, '28000', 'pin_session_required', 'C-R4 a Till device acting as itself needs a PIN session');
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_close('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 0,
    '44900613-0000-4000-8000-000000000003', '44900613-0000-4000-8000-000000000007', gen_random_uuid())$q$,
  '28000', 'pin_session_invalid', 'C-R5 a member named on a Till device with no live session is refused');
-- A live PIN session on the device: first the seller (sell only), then the finance manager.
INSERT INTO public.venue_staff_switch_sessions (venue_id, brand_id, device_user_id, member_id, member_user_id, token_hash, expires_at)
VALUES ('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-8000-000000000007',
  '44900613-0000-4000-a000-000000000002', '44900613-0000-4000-8000-000000000002', extensions.gen_random_bytes(32), now() + interval '1 hour');
SELECT public.t5b_expect($q$SELECT public.issue_4490_cash_movement('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 'paid_out',
    100, 'x', '44900613-0000-4000-8000-000000000002', '44900613-0000-4000-8000-000000000007', gen_random_uuid())$q$,
  '42501', 'not_authorized', 'C-R6 in a PIN session the seller (no money rights) cannot touch the drawer');
UPDATE public.venue_staff_switch_sessions SET ended_at = now(), ended_reason = 'switched'
WHERE device_user_id = '44900613-0000-4000-8000-000000000007';
INSERT INTO public.venue_staff_switch_sessions (venue_id, brand_id, device_user_id, member_id, member_user_id, token_hash, expires_at)
VALUES ('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-9000-000000000010', '44900613-0000-4000-8000-000000000007',
  '44900613-0000-4000-a000-000000000003', '44900613-0000-4000-8000-000000000003', extensions.gen_random_bytes(32), now() + interval '1 hour');
SELECT public.t5b_ok((public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000003', '44900613-0000-4000-8000-000000000007')#>>'{totals,takings,amountMinor}')::bigint = 12900000,
  'C-R7 in a PIN session the finance manager (money rights) reads the day on the device');
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'VENUE_TILL';
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000001', NULL)$q$, 'P0001', 'till_not_enabled', 'C-R8 with the Till release off the close is refused');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_TILL';
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d() + 2,
    '44900613-0000-4000-8000-000000000001', NULL)$q$, '22023', 'day_out_of_range', 'C-R9 a day after today cannot be read');
SELECT public.t5b_reset();
SELECT public.t5b_ok(NOT has_table_privilege('authenticated', 'public.venue_day_closes', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.venue_day_closes', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.venue_cash_movements', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.venue_cash_movements', 'INSERT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_day_closes'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_cash_movements'::regclass),
  'C-RLS-1 both tables: RLS on, no read or write for signed-in or signed-out callers');
SELECT public.t5b_ok(NOT has_function_privilege('authenticated', 'public.issue_4490_day_summary(uuid,date,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4490_day_close(uuid,date,bigint,uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_day_reopen(uuid,date,text,uuid,uuid)', 'EXECUTE'),
  'C-RLS-2 the close functions are service role only');
SELECT public.t5b_service();

-- ===========================================================================
-- C-BLOCK / C-CLOSE. Open checks block; Move to tomorrow; close; snapshot.
-- ===========================================================================
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_close('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 12160000,
    '44900613-0000-4000-8000-000000000003', NULL, gen_random_uuid())$q$,
  'PT409', 'day_checks_open', 'C-BLOCK-1 the open check blocks the close');
CREATE TEMP TABLE t5b_carry AS SELECT public.issue_4490_till_carry_over(public.t5b_id('sale_s19'), public.t5b_d(),
    '44900613-0000-4000-8000-000000000003', NULL) AS v;
SELECT public.t5b_ok((SELECT (v->>'carriedPast')::date FROM t5b_carry) = public.t5b_d()
    AND (SELECT carried_past FROM public.venue_till_sales WHERE id = public.t5b_id('sale_s19')) = public.t5b_d(),
  'C-BLOCK-2 Move to tomorrow marks the check carried past D');
SELECT public.t5b_ok((public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_today(),
    '44900613-0000-4000-8000-000000000003', NULL)->>'blockingCount')::int = 1,
  'C-BLOCK-3 the carried check now blocks the next day instead');
SELECT public.t5b_ok((v->>'state') = 'closed' AND NOT (v->>'replayed')::boolean
    AND (v#>>'{close,cashCountedMinor}')::bigint = 12160000 AND (v#>>'{close,cashExpectedMinor}')::bigint = 12210000
    AND (v#>>'{close,differenceMinor}')::bigint = -50000,
  'C-CLOSE-1 closed with 121,600.00 counted against 122,100.00 expected: 500.00 short')
FROM (SELECT public.issue_4490_day_close('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 12160000,
        '44900613-0000-4000-8000-000000000003', NULL, '44900613-0000-4000-e000-000000000001') AS v) x;
SELECT public.t5b_ok((public.issue_4490_day_close('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 1,
    '44900613-0000-4000-8000-000000000003', NULL, '44900613-0000-4000-e000-000000000001')->>'replayed')::boolean,
  'C-CLOSE-2 the same request again answers the close it made (replayed), counting nothing again');
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_close('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 1,
    '44900613-0000-4000-8000-000000000003', NULL, gen_random_uuid())$q$,
  'PT409', 'day_already_closed', 'C-CLOSE-3 a second close of the same day is refused (one close per venue per day)');
SELECT public.t5b_ok((SELECT count(*) FROM public.audit_log WHERE action = 'till.close'
                      AND target_id = (SELECT id::text FROM public.venue_day_closes WHERE venue_id = '44900613-0000-4000-9000-0000000000a1'
                                       AND business_date = public.t5b_d())) = 1
    AND (SELECT count(*) FROM public.audit_log WHERE action = 'till.cash_movement' AND brand_id = '44900613-0000-4000-9000-000000000010') = 3
    AND (SELECT count(*) FROM public.audit_log WHERE action = 'till.carry_over' AND brand_id = '44900613-0000-4000-9000-000000000010') = 1,
  'C-CLOSE-4 audit rows: one till.close, three till.cash_movement, one till.carry_over');
SELECT public.t5b_ok((SELECT payments FROM t5b_money_rows) = (SELECT count(*) FROM public.venue_till_payments)
    AND (SELECT refunds FROM t5b_money_rows) = (SELECT count(*) FROM public.venue_till_refunds)
    AND (SELECT offline FROM t5b_money_rows) = (SELECT count(*) FROM public.venue_offline_payments)
    AND (SELECT source_refunds FROM t5b_money_rows) = (SELECT count(*) FROM public.source_refunds),
  'C-CLOSE-5 closing and carrying a check moved no money (no payment, refund, offline payment or source refund row)');
SELECT public.t5b_expect($q$SELECT public.issue_4490_cash_movement('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 'paid_out',
    100, 'late', '44900613-0000-4000-8000-000000000003', NULL, gen_random_uuid())$q$,
  'PT409', 'day_already_closed', 'C-CLOSE-6 the drawer of a closed day cannot change');

CREATE TEMP TABLE t5b_snap AS SELECT totals FROM public.venue_day_closes
WHERE venue_id = '44900613-0000-4000-9000-0000000000a1' AND business_date = public.t5b_d();
GRANT ALL ON t5b_snap TO PUBLIC;
SELECT public.t5b_expect($q$UPDATE public.venue_day_closes SET totals = '{}'::jsonb
    WHERE venue_id = '44900613-0000-4000-9000-0000000000a1'$q$, '42501', 'day_close_immutable',
  'C-SNAP-1 the snapshot cannot be rewritten (service role, direct update)');
SELECT public.t5b_reset();
SELECT public.t5b_expect($q$UPDATE public.venue_day_closes SET cash_counted_minor = 0, difference_minor = cash_counted_minor * 0 - cash_expected_minor
    WHERE venue_id = '44900613-0000-4000-9000-0000000000a1'$q$, '42501', 'day_close_immutable',
  'C-SNAP-2 not even by the database owner: the guard refuses any write it did not open');
SELECT public.t5b_expect($q$DELETE FROM public.venue_day_closes WHERE venue_id = '44900613-0000-4000-9000-0000000000a1'$q$,
  '42501', 'day_close_immutable', 'C-SNAP-3 a close is never deleted');
SELECT public.t5b_service();

-- ===========================================================================
-- C-LATE. The scan code that was waiting is paid after the close (that night).
-- ===========================================================================
DO $late$
DECLARE
  v jsonb;
BEGIN
  PERFORM public.t5b_scan_lands(public.t5b_id('s20_pay'), 'bank_transfer');
  PERFORM public.t5b_move(public.t5b_id('sale_s20'), public.t5b_at(0, '23:55'));
  v := public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000003', NULL);
  PERFORM public.t5b_ok(v->>'state' = 'closed' AND (v#>>'{totals,takings,amountMinor}')::bigint = 12900000
      AND (SELECT totals FROM t5b_snap) = (SELECT totals FROM public.venue_day_closes
                                           WHERE venue_id = '44900613-0000-4000-9000-0000000000a1' AND business_date = public.t5b_d()),
    'C-LATE-1 the stored snapshot did not change: takings still 129,000.00');
  PERFORM public.t5b_ok((v#>>'{late,count}')::int = 1 AND (v#>>'{late,amountMinor}')::bigint = 550000
      AND (v#>>'{late,payments,0,method}') = 'scan_transfer' AND (v#>>'{late,payments,0,checkLabel}') = 'S20',
    'C-LATE-2 the payment that landed after the close is in D''s late list (5,500.00, scan by transfer), no reopen needed ' || (v->'late')::text);
  -- #4490 08-O5 fix 4: each late payment names who took it (Host shows it when the check has no name).
  PERFORM public.t5b_ok(jsonb_typeof(v#>'{late,payments,0,takenBy}') = 'object'
      AND (v#>>'{late,payments,0,takenBy,kind}') IS NOT NULL,
    'C-LATE-2b the late payment names who took it (takenBy) ' || (v#>'{late,payments,0}')::text);
  v := public.issue_4490_day_export('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000003', NULL);
  PERFORM public.t5b_ok(jsonb_array_length(v->'rows') = 19
      AND (SELECT count(*) FROM jsonb_array_elements(v->'rows') r WHERE (r->>'late')::boolean) = 1
      AND (SELECT count(*) FROM jsonb_array_elements(v->'rows') r WHERE (r->>'paidAfterCancel')::boolean) = 2
      AND (SELECT sum((r->>'amountMinor')::bigint) FROM jsonb_array_elements(v->'rows') r) = 12900000 + 550000
      AND v::text !~* 'example\.test',
    'C-EXP-1 export: one row per payment of D (19 incl. the late one), late and paid-after-cancel flagged, no email');
END
$late$;

-- ===========================================================================
-- C-REOPEN. Reopen keeps history; the cash is counted again.
-- ===========================================================================
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_reopen('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), '  ',
    '44900613-0000-4000-8000-000000000003', NULL)$q$, '22023', 'day_reason_required', 'C-REOPEN-0 a reason is required');
DO $reopen$
DECLARE
  v jsonb;
  r public.venue_day_closes%ROWTYPE;
BEGIN
  v := public.issue_4490_day_reopen('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 'Miscounted the float',
    '44900613-0000-4000-8000-000000000001', NULL);
  SELECT * INTO r FROM public.venue_day_closes WHERE venue_id = '44900613-0000-4000-9000-0000000000a1' AND business_date = public.t5b_d();
  PERFORM public.t5b_ok(r.state = 'reopened' AND r.reopen_count = 1 AND r.totals IS NULL AND r.cash_counted_minor IS NULL
      AND jsonb_array_length(r.history) = 1 AND r.history->0->'totals' = (SELECT totals FROM t5b_snap)
      AND (r.history->0->>'cashCountedMinor')::bigint = 12160000 AND r.history->0->>'reason' = 'Miscounted the float'
      AND v->>'state' = 'reopened' AND (v#>>'{totals,takings,amountMinor}')::bigint = 12900000 + 550000,
    'C-REOPEN-1 reopened: the snapshot and its count moved into history with the reason; the live day now holds the late payment');
  PERFORM public.t5b_expect($q$SELECT public.issue_4490_day_reopen('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 'again',
      '44900613-0000-4000-8000-000000000001', NULL)$q$, 'PT409', 'day_not_closed', 'C-REOPEN-2 an open day cannot be reopened');
  v := public.issue_4490_day_close('44900613-0000-4000-9000-0000000000a1', public.t5b_d(), 12210000,
    '44900613-0000-4000-8000-000000000001', NULL, gen_random_uuid());
  SELECT * INTO r FROM public.venue_day_closes WHERE venue_id = '44900613-0000-4000-9000-0000000000a1' AND business_date = public.t5b_d();
  PERFORM public.t5b_ok(r.state = 'closed' AND r.difference_minor = 0 AND r.cash_counted_minor = 12210000
      AND jsonb_array_length(r.history) = 1 AND r.reopen_count = 1 AND (v#>>'{late,count}')::int = 0
      AND (r.totals#>>'{takings,amountMinor}')::bigint = 13450000,
    'C-REOPEN-3 closed again after counting again: Balanced; history kept; the late payment is now inside the new snapshot');
  PERFORM public.t5b_ok((SELECT count(*) FROM public.audit_log WHERE action = 'till.reopen' AND target_id = r.id::text) = 1,
    'C-REOPEN-4 one till.reopen audit row');
END
$reopen$;
-- A close older than 7 days cannot be reopened.
INSERT INTO public.venue_day_closes (venue_id, brand_id, business_date, state, currency, cash_counted_minor, cash_expected_minor,
  difference_minor, totals, closed_by_user_id, closed_at)
VALUES ('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-9000-000000000010', public.t5b_today() - 9, 'closed', 'NGN',
  0, 0, 0, '{"takings":{"amountMinor":0}}'::jsonb, '44900613-0000-4000-8000-000000000001', now() - interval '9 days');
SELECT public.t5b_expect($q$SELECT public.issue_4490_day_reopen('44900613-0000-4000-9000-0000000000a1', public.t5b_today() - 9,
    'too late', '44900613-0000-4000-8000-000000000001', NULL)$q$, 'PT409', 'day_reopen_too_late',
  'C-REOPEN-5 a day more than 7 days back cannot be reopened');

-- ===========================================================================
-- C-DRAWER. The float has one owner; Same as yesterday; a replay.
-- ===========================================================================
DO $drawer$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_cash_movements_list('44900613-0000-4000-9000-0000000000a1', public.t5b_today(),
    '44900613-0000-4000-8000-000000000003', NULL);
  PERFORM public.t5b_ok((v->>'previousFloatMinor')::bigint = 5500000 AND (v->>'floatMinor')::bigint = 0,
    'C-DRAWER-1 the next day offers "Same as yesterday" at 55,000.00');
  v := public.issue_4490_cash_movement('44900613-0000-4000-9000-0000000000a1', public.t5b_today(), 'float', 5500000, NULL,
    '44900613-0000-4000-8000-000000000003', NULL, '44900613-0000-4000-d000-000000000009');
  v := public.issue_4490_cash_movement('44900613-0000-4000-9000-0000000000a1', public.t5b_today(), 'float', 5500000, NULL,
    '44900613-0000-4000-8000-000000000003', NULL, '44900613-0000-4000-d000-000000000009');
  PERFORM public.t5b_ok((v->>'replayed')::boolean
      AND (SELECT count(*) FROM public.venue_cash_movements WHERE client_request_id = '44900613-0000-4000-d000-000000000009') = 1,
    'C-DRAWER-2 the same request id again records nothing twice');
  PERFORM public.t5b_expect($q$SELECT public.issue_4490_cash_movement('44900613-0000-4000-9000-0000000000a1', public.t5b_today(),
      'float', 100, NULL, '44900613-0000-4000-8000-000000000003', NULL, '44900613-0000-4000-d000-000000000009')$q$,
    'PT409', 'till_request_reused', 'C-DRAWER-3 the same request id for another amount is refused');
  PERFORM public.t5b_expect($q$SELECT public.issue_4490_cash_movement('44900613-0000-4000-9000-0000000000a1', public.t5b_today(),
      'paid_out', 100, NULL, '44900613-0000-4000-8000-000000000003', NULL, gen_random_uuid())$q$,
    '22023', 'cash_movement_invalid', 'C-DRAWER-4 a paid out needs a note');
  PERFORM public.t5b_expect($q$UPDATE public.venue_cash_movements SET amount_minor = 1$q$, '42501', 'cash_movement_append_only',
    'C-DRAWER-5 the drawer rows are append only');
END
$drawer$;

-- ===========================================================================
-- C-PEOPLE. Who a person is on the close.
-- ===========================================================================
SELECT public.t5b_ok(public.issue_4490_close_person('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-8000-000000000007')->>'kind' = 'device'
    AND public.issue_4490_close_person('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-8000-000000000007')->>'name' IS NULL
    AND public.issue_4490_close_person('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-8000-000000000008')->>'kind' = 'mingla_support'
    AND public.issue_4490_close_person('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-8000-000000000003')->>'kind' = 'person'
    AND public.issue_4490_close_person('44900613-0000-4000-9000-0000000000a1', NULL)->>'kind' = 'system',
  'C-PEOPLE-1 a Till device is never a person; an auto-added Mingla admin is Mingla support; nobody is the Till itself');
SELECT public.t5b_ok(NOT (public.issue_4490_day_summary('44900613-0000-4000-9000-0000000000a1', public.t5b_d(),
    '44900613-0000-4000-8000-000000000001', NULL)::text ~* 'example\.test'),
  'C-PEOPLE-2 the summary never carries an email');

-- ===========================================================================
-- C-SET. Settings › Selling in person: brand admins only; no day start.
-- ===========================================================================
SELECT public.t5b_ok((v->>'version')::bigint >= 1 AND NOT (v ? 'dayStartsAt') AND (v->>'serviceChargeBps')::int = 1000
    AND (v->>'pastMidnightDays')::int = 7 AND v->>'printPaper' = 'a4',
  'C-SET-1 the owner reads the settings: a row with a version to match, the service charge, the night runs past midnight on 7 days; no day start ' || v::text)
FROM (SELECT public.issue_4490_till_settings_read('44900613-0000-4000-9000-0000000000a1', '44900613-0000-4000-8000-000000000001') AS v) x;
SELECT public.t5b_expect($q$SELECT public.issue_4490_till_settings_read('44900613-0000-4000-9000-0000000000a1',
    '44900613-0000-4000-8000-000000000003')$q$, '42501', 'not_authorized', 'C-SET-2 a finance manager cannot open the Till settings');
SELECT public.t5b_expect($q$SELECT public.issue_4490_till_settings_read('44900613-0000-4000-9000-0000000000a1',
    '44900613-0000-4000-8000-000000000007')$q$, '42501', 'not_authorized', 'C-SET-3 a Till device login cannot open the Till settings');

SELECT public.t5b_reset();
ROLLBACK;
