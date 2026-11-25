-- #4490 spec 07 F: executable PostgreSQL 17 proof for multi-day passes.
-- The suite owns its fixture and rolls every row back.
--
-- MINGLA-INVARIANT: I-4490-MULTI-DAY-PASS | issue #4490 | a flex pass uses at most N distinct venue service days in its M-day window; a repeat admission on one service day does not spend another day.
-- MINGLA-INVARIANT: I-4490-MULTI-DAY-CAPACITY | issue #4490 | day one reserves at checkout and each later day draws the whole party from that service day's capacity exactly once.
--
-- FAILS-ON-REVERT: remove venue_pass_days from issue_4490_admit_pass and F-2
-- fails because two admissions on one day either spend two days or share the
-- legacy lifetime counter.
-- FAILS-ON-REVERT: let issue_4490_pass_admitted_on return a single-day pass's
-- admitted_count for every date and F-5c/F-5d fail because one gate sale today
-- fills every other day of the pool.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490f_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490F FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490f_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490F FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490F FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490f_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490f_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490f_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f_ok(boolean,text), public.t4490f_expect(text,text,text,text),
  public.t4490f_as(uuid), public.t4490f_service(), public.t4490f_reset() TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES', 'STAY_RESERVE_READS', 'STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('4490f000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f-owner@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('4490f000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at
) VALUES (
  '4490f000-0000-4000-9000-000000000010', '4490f000-0000-4000-8000-000000000001',
  'Flex F 4490', 'flex-f-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()
);
INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code
) VALUES (
  '4490f000-0000-4000-9000-0000000000a1', '4490f000-0000-4000-9000-000000000010',
  'flexfa1', 'Flex Venue', 6.45, 3.41, 'play', 'verified', 'NG'
);

CREATE TEMP TABLE t4490f_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490f_ids TO PUBLIC;
CREATE FUNCTION public.t4490f_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490f_ids WHERE k = p_k
$f$;
CREATE FUNCTION public.t4490f_key(p_seed text) RETURNS text LANGUAGE sql AS $f$
  SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex')
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f_id(text), public.t4490f_key(text) TO PUBLIC;

SELECT public.t4490f_as('4490f000-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_option uuid;
  v_version bigint;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(
    '4490f000-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'f-feature-on');
  v := public.issue_4490_manage_capacity_pool('create',
    '4490f000-0000-4000-9000-0000000000a1',
    '{"name":"Flex day","dailyLimit":30,"keptForWalkIns":0}'::jsonb, NULL, 'f-pool-create');
  v_pool := (v->>'id')::uuid;
  INSERT INTO t4490f_ids VALUES ('pool', v_pool);
  v := public.issue_4490_manage_offer('create_draft',
    '4490f000-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Flex entry","entryStyle":"day_pass"}'::jsonb, NULL, 'f-offer-create');
  v_offer := (v->>'id')::uuid;
  v_version := (v->>'version')::bigint;
  INSERT INTO t4490f_ids VALUES ('offer', v_offer);
  v := public.issue_4490_manage_offer('set_pool', '4490f000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_version, 'f-set-pool-1');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '4490f000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', '3-Day Pass', 'unit', 'guest',
      'guestMin', 1, 'guestMax', 4, 'priceMinor', 900000, 'passDays', 3, 'passWindowDays', 3),
    v_version, 'f-option-1');
  v_version := (v->>'version')::bigint;
  SELECT (row->>'id')::uuid INTO v_option FROM jsonb_array_elements(v->'options') row
  WHERE row->>'name' = '3-Day Pass';
  INSERT INTO t4490f_ids VALUES ('option', v_option);
  PERFORM public.t4490f_ok(
    (SELECT pass_days = 3 AND pass_window_days = 3 FROM public.venue_offer_price_options WHERE id = v_option)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'options') row
                  WHERE row->>'id' = v_option::text AND row->>'passDays' = '3' AND row->>'passWindowDays' = '3'),
    'F-1a Host option write and projection carry 3-in-3');
  v := public.issue_4490_manage_offer('upsert_price_option',
    '4490f000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Free 3-Day Pass', 'unit', 'guest',
      'guestMin', 1, 'guestMax', 1, 'priceMinor', 0, 'passDays', 3, 'passWindowDays', 3),
    v_version, 'f-option-free');
  v_version := (v->>'version')::bigint;
  SELECT (row->>'id')::uuid INTO v_option FROM jsonb_array_elements(v->'options') row
  WHERE row->>'name' = 'Free 3-Day Pass';
  INSERT INTO t4490f_ids VALUES ('free_option', v_option);
  PERFORM public.t4490f_reset();
  PERFORM public.t4490f_service();
  PERFORM public.t4490f_expect(
    format('UPDATE public.stay_offerings SET entry_style = ''timed_session'' WHERE id = %L', v_offer),
    '22023', 'multi_day_pass_not_allowed',
    'F-1a2 a direct writer cannot put a multi-day price on a timed session');
  PERFORM public.t4490f_reset();
  PERFORM public.t4490f_as('4490f000-0000-4000-8000-000000000001');
  v := public.issue_4490_manage_offer('set_policy', '4490f000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', '[]'::jsonb,
      'dateChangeRule', '{}'::jsonb), v_version, 'f-policy-1');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', '4490f000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'mode', 'full_day',
      'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '00:00', 'endTime', '23:59'),
    v_version, 'f-schedule-1');
  v_version := (v->>'version')::bigint;
  PERFORM public.issue_4490_manage_offer('publish', '4490f000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer), v_version, 'f-publish-1');
END
$setup$;
SELECT public.t4490f_reset();

CREATE FUNCTION public.t4490f_win(p_date date)
RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.stay_place_windows
  WHERE offering_id = public.t4490f_id('offer') AND local_date = p_date
  ORDER BY starts_at LIMIT 1
$f$;
CREATE FUNCTION public.t4490f_buy(p_seed text, p_guests integer)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_date date := public.issue_4490_venue_local_date('4490f000-0000-4000-9000-0000000000a1') + 1;
  v_quote jsonb;
  v_group jsonb;
  v_payment jsonb;
  v_ref text;
BEGIN
  v_quote := public.issue_4490_quote_offer(public.t4490f_id('offer'), public.t4490f_win(v_date),
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f_id('option'), 'guests', p_guests)),
    public.t4490f_key('cart:' || p_seed), NULL, 'quote-' || p_seed);
  v_group := public.issue_4490_create_offer_group(gen_random_uuid(), (v_quote->>'quoteId')::uuid,
    jsonb_build_object('name', 'Flex ' || p_seed, 'email', p_seed || '@example.test'),
    public.t4490f_key('cart:' || p_seed), NULL, sha256(convert_to('token:' || p_seed, 'UTF8')), 'hold-' || p_seed);
  v_payment := public.issue_4490_prepare_offer_payment((v_group->>'groupId')::uuid,
    sha256(convert_to('token:' || p_seed, 'UTF8')), NULL, 'payment-' || p_seed, (v_group->>'version')::bigint);
  v_ref := 'mingla_stay_' || replace(v_payment->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_payment->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-' || p_seed, 'charge.success', v_ref,
    'charge-' || p_seed, (v_payment->>'amountMinor')::bigint, 'NGN', 0, NULL);
  RETURN (v_group->>'groupId')::uuid;
END
$f$;
CREATE FUNCTION public.t4490f_qr(p_group uuid)
RETURNS text LANGUAGE sql AS $f$
  SELECT public.issue_4490_get_offer_booking(
    p_group, (SELECT buyer_token_hash FROM public.stay_reservation_groups WHERE id = p_group), NULL,
    'f-test-pepper-0123456789abcdef-4490')->'passes'->0->>'qrPayload'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f_win(date), public.t4490f_buy(text,integer), public.t4490f_qr(uuid) TO PUBLIC;

CREATE TEMP TABLE t4490f_passes (k text PRIMARY KEY, group_id uuid, pass_id uuid, qr text) ON COMMIT DROP;
GRANT ALL ON t4490f_passes TO PUBLIC;
SELECT public.t4490f_service();
DO $buy$
DECLARE
  v_group uuid;
  v_quote jsonb;
  v_booking jsonb;
BEGIN
  v_group := public.t4490f_buy('three', 2);
  INSERT INTO t4490f_passes SELECT 'three', v_group, p.id, public.t4490f_qr(v_group)
  FROM public.venue_passes p WHERE p.group_id = v_group;
  UPDATE public.venue_offer_price_options SET pass_days = 10, pass_window_days = 60
  WHERE id = public.t4490f_id('option');
  v_group := public.t4490f_buy('ten', 1);
  INSERT INTO t4490f_passes SELECT 'ten', v_group, p.id, public.t4490f_qr(v_group)
  FROM public.venue_passes p WHERE p.group_id = v_group;
  v_group := public.t4490f_buy('full', 1);
  INSERT INTO t4490f_passes SELECT 'full', v_group, p.id, public.t4490f_qr(v_group)
  FROM public.venue_passes p WHERE p.group_id = v_group;
  v_group := public.t4490f_buy('day2', 1);
  INSERT INTO t4490f_passes SELECT 'day2', v_group, p.id, public.t4490f_qr(v_group)
  FROM public.venue_passes p WHERE p.group_id = v_group;
  v_group := public.t4490f_buy('start', 1);
  INSERT INTO t4490f_passes SELECT 'start', v_group, p.id, public.t4490f_qr(v_group)
  FROM public.venue_passes p WHERE p.group_id = v_group;
  v_group := public.t4490f_buy('night', 1);
  INSERT INTO t4490f_passes SELECT 'night', v_group, p.id, public.t4490f_qr(v_group)
  FROM public.venue_passes p WHERE p.group_id = v_group;

  v_quote := public.issue_4490_quote_offer(
    public.t4490f_id('offer'),
    public.t4490f_win(public.issue_4490_venue_local_date('4490f000-0000-4000-9000-0000000000a1') + 1),
    jsonb_build_array(jsonb_build_object(
      'priceOptionId', public.t4490f_id('free_option'), 'guests', 1)),
    public.t4490f_key('cart:free'), NULL, 'quote-free');
  v_booking := public.issue_4490_create_offer_group(
    '4490f000-0000-4000-9000-0000000000f0', (v_quote->>'quoteId')::uuid,
    '{"name":"Free Flex","email":"free-flex@example.test"}'::jsonb,
    public.t4490f_key('cart:free'), NULL,
    sha256(convert_to('token:free', 'UTF8')), 'hold-free');
  PERFORM public.t4490f_ok(
    v_booking->>'state' = 'confirmed'
      AND EXISTS (SELECT 1 FROM public.venue_passes p
                  WHERE p.group_id = (v_booking->>'groupId')::uuid AND p.days_allowed = 3)
      AND EXISTS (SELECT 1 FROM public.stay_inventory_holds h
                  WHERE h.group_id = (v_booking->>'groupId')::uuid
                    AND h.state = 'converted' AND h.reason = 'free_offer')
      AND EXISTS (SELECT 1 FROM public.stay_inventory_commitments c
                  WHERE c.group_id = (v_booking->>'groupId')::uuid)
      AND NOT EXISTS (SELECT 1 FROM public.stay_payment_attempts a
                      WHERE a.group_id = (v_booking->>'groupId')::uuid),
    'F-1a3 a free multi-day offer confirms and issues its pass without a payment provider');
END
$buy$;

-- F-1: issuance snapshots the option and extends validity to the final day.
DO $f1$
DECLARE
  v_today date := public.issue_4490_venue_local_date('4490f000-0000-4000-9000-0000000000a1');
  v_venue public.venue_listings%ROWTYPE;
  v_log uuid;
BEGIN
  PERFORM public.t4490f_ok(
    EXISTS (SELECT 1 FROM public.venue_passes p JOIN t4490f_passes x ON x.pass_id = p.id
            WHERE x.k = 'three' AND p.days_allowed = 3
              AND p.valid_until_local_date = p.valid_local_date + 2 AND p.admitted_count = 0
              AND p.valid_to >= (p.valid_until_local_date::timestamp + time '23:59')
                    AT TIME ZONE 'Africa/Lagos'),
    'F-1b confirmation snapshots 3-in-3, extends the final service window and leaves the legacy counter unused');
  PERFORM public.t4490f_ok(
    EXISTS (SELECT 1 FROM public.venue_passes p JOIN t4490f_passes x ON x.pass_id = p.id
            WHERE x.k = 'ten' AND p.days_allowed = 10
              AND p.valid_until_local_date = p.valid_local_date + 59),
    'F-1c confirmation snapshots 10-in-60');
  INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal)
  VALUES ('4490f000-0000-4000-9000-000000000010', '4490f000-0000-4000-9000-0000000000a1',
    extract(isodow FROM v_today)::integer - 1, '18:00', '02:00', false, 1);
  -- TEST-MOD-APPROVED #4490: the O5 hours-history rule (ops_o5_fix1) reads any
  -- moment before the venue's latest hours change with the hours then in force,
  -- and this suite has just inserted the hours (change time = now). A moment
  -- earlier today therefore never used the new hours, so the result depended on
  -- the hour the suite ran. Ask about 01:00 tomorrow instead: always after the
  -- change, so the night-before rule is what is tested, on any run date.
  PERFORM public.t4490f_ok(
    public.issue_4490_venue_service_date('4490f000-0000-4000-9000-0000000000a1',
      ((v_today + 1)::timestamp + time '01:00') AT TIME ZONE 'Africa/Lagos') = v_today,
    'F-1d 01:00 belongs to the night-before service day');
  SELECT * INTO v_venue FROM public.venue_listings
  WHERE id = '4490f000-0000-4000-9000-0000000000a1';
  v_log := public.issue_4490_log_check_in(v_venue, NULL, NULL, NULL, 'not_found', 0, 'manual',
    '4490f000-0000-4000-8000-000000000001', jsonb_build_object('serviceDate', v_today - 1));
  PERFORM public.t4490f_ok(
    (SELECT local_date = v_today - 1 FROM public.venue_check_in_log WHERE id = v_log),
    'F-1e the check-in log keeps the service date used by undo');
  DELETE FROM public.brand_hours
  WHERE venue_id = '4490f000-0000-4000-9000-0000000000a1';
END
$f1$;

-- F-2: two admissions today use one day; the second undo deletes the row at 0.
DO $f2$
DECLARE
  v_today date := public.issue_4490_venue_local_date('4490f000-0000-4000-9000-0000000000a1');
  v_pass uuid := (SELECT pass_id FROM t4490f_passes WHERE k = 'three');
  v_one jsonb;
  v_two jsonb;
  v_undo jsonb;
  v_usage record;
  v_night uuid := (SELECT pass_id FROM t4490f_passes WHERE k = 'night');
  v_night_tz text;
  v_old_tz text;
  v_wall_date date;
  v_service_date date;
BEGIN
  UPDATE public.venue_passes SET valid_local_date = v_today - 2, valid_until_local_date = v_today,
    valid_from = now() - interval '3 days', valid_to = now() + interval '12 hours'
  WHERE id = v_pass;
  INSERT INTO public.venue_pass_days (pass_id, local_date, admitted_count)
  VALUES (v_pass, v_today - 2, 2), (v_pass, v_today - 1, 2);
  v_one := public.issue_4490_check_in_scan('4490f000-0000-4000-9000-0000000000a1',
    (SELECT qr FROM t4490f_passes WHERE k = 'three'), 1, true,
    '4490f000-0000-4000-8000-000000000001', 'f-test-pepper-0123456789abcdef-4490');
  v_two := public.issue_4490_check_in_scan('4490f000-0000-4000-9000-0000000000a1',
    (SELECT qr FROM t4490f_passes WHERE k = 'three'), 1, true,
    '4490f000-0000-4000-8000-000000000001', 'f-test-pepper-0123456789abcdef-4490');
  PERFORM public.t4490f_ok(v_one->>'result' = 'admitted' AND v_two->>'result' = 'admitted'
      AND public.issue_4490_pass_days_used(v_pass) = 3
      AND public.issue_4490_pass_admitted_on(v_pass, v_today) = 2
      AND (v_two->'pass'->>'dayNumber')::integer = 3,
    'F-2a a second admission on one service day does not spend another day');
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(public.t4490f_id('pool'), v_today);
  PERFORM public.t4490f_ok(v_usage.used_gate >= 2, 'F-2b a later day draws the whole party from day capacity once');
  v_undo := public.issue_4490_check_in_undo('4490f000-0000-4000-9000-0000000000a1',
    (v_two->>'logId')::uuid, '4490f000-0000-4000-8000-000000000001');
  v_undo := public.issue_4490_check_in_undo('4490f000-0000-4000-9000-0000000000a1',
    (v_one->>'logId')::uuid, '4490f000-0000-4000-8000-000000000001');
  PERFORM public.t4490f_ok(v_undo->>'result' = 'undone'
      AND NOT EXISTS (SELECT 1 FROM public.venue_pass_days d WHERE d.pass_id = v_pass AND d.local_date = v_today),
    'F-2c undo at zero deletes the day row so the day is not used');

  SELECT timezone INTO v_old_tz FROM public.venue_booking_settings
  WHERE venue_id = '4490f000-0000-4000-9000-0000000000a1';
  SELECT name INTO v_night_tz FROM pg_catalog.pg_timezone_names
  WHERE name NOT LIKE 'posix/%' AND name NOT LIKE 'right/%'
    AND (now() AT TIME ZONE name)::time >= time '00:00'
    AND (now() AT TIME ZONE name)::time < time '01:30'
  ORDER BY name LIMIT 1;
  PERFORM public.t4490f_ok(v_night_tz IS NOT NULL,
    'F-2d a timezone is available for the live past-midnight proof');
  UPDATE public.venue_booking_settings SET timezone = v_night_tz
  WHERE venue_id = '4490f000-0000-4000-9000-0000000000a1';
  v_wall_date := (now() AT TIME ZONE v_night_tz)::date;
  INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal)
  VALUES ('4490f000-0000-4000-9000-000000000010', '4490f000-0000-4000-9000-0000000000a1',
    extract(isodow FROM v_wall_date - 1)::integer - 1, '18:00', '02:00', false, 1);
  -- TEST-MOD-APPROVED #4490: the O5 hours-history capture stamps a change with
  -- statement_timestamp(), later than this transaction's now(), so the scan and
  -- the service-date read below (both at now()) would use the hours from before
  -- the insert. Backdate the versions just captured by a day (keeping their order) so the hours just inserted
  -- are the ones in force at now(), whatever time the suite runs.
  UPDATE public.venue_hours_history SET valid_from = valid_from - interval '1 day'
  WHERE venue_id = '4490f000-0000-4000-9000-0000000000a1' AND valid_from > now();
  v_service_date := public.issue_4490_venue_service_date(
    '4490f000-0000-4000-9000-0000000000a1', now());
  UPDATE public.venue_passes SET valid_local_date = v_service_date,
    valid_until_local_date = v_service_date + 59, valid_from = now() - interval '1 day',
    valid_to = now() + interval '60 days'
  WHERE id = v_night;
  v_one := public.issue_4490_check_in_scan('4490f000-0000-4000-9000-0000000000a1',
    (SELECT qr FROM t4490f_passes WHERE k = 'night'), NULL, true,
    '4490f000-0000-4000-8000-000000000001', 'f-test-pepper-0123456789abcdef-4490');
  PERFORM public.t4490f_ok(v_service_date = v_wall_date - 1
      AND v_one->>'result' = 'admitted'
      AND EXISTS (SELECT 1 FROM public.venue_pass_days d
                  WHERE d.pass_id = v_night AND d.local_date = v_service_date)
      AND EXISTS (SELECT 1 FROM public.venue_check_in_log l
                  WHERE l.id = (v_one->>'logId')::uuid AND l.local_date = v_service_date),
    'F-2e a live past-midnight scan and its undo authority stay on the night before');
  v_undo := public.issue_4490_check_in_undo('4490f000-0000-4000-9000-0000000000a1',
    (v_one->>'logId')::uuid, '4490f000-0000-4000-8000-000000000001');
  PERFORM public.t4490f_ok(v_undo->>'result' = 'undone'
      AND NOT EXISTS (SELECT 1 FROM public.venue_pass_days d WHERE d.pass_id = v_night),
    'F-2f past-midnight undo deletes the service-day row at zero');
  DELETE FROM public.brand_hours WHERE venue_id = '4490f000-0000-4000-9000-0000000000a1';
  -- Remove the cleanup capture stamped after this transaction's fixed now().
  -- Otherwise the history reader still sees the backdated overnight-hours
  -- version until the transaction ends and later blocks inherit yesterday's
  -- service date when this suite happens to run just after local midnight.
  DELETE FROM public.venue_hours_history
  WHERE venue_id = '4490f000-0000-4000-9000-0000000000a1' AND valid_from > now();
  UPDATE public.venue_booking_settings SET timezone = v_old_tz
  WHERE venue_id = '4490f000-0000-4000-9000-0000000000a1';
END
$f2$;

-- F-3: the 11th day is refused, day two is valid, and a full later day is refused.
DO $f3$
DECLARE
  v_today date := public.issue_4490_venue_local_date('4490f000-0000-4000-9000-0000000000a1');
  v_ten uuid := (SELECT pass_id FROM t4490f_passes WHERE k = 'ten');
  v_day2 uuid := (SELECT pass_id FROM t4490f_passes WHERE k = 'day2');
  v_start uuid := (SELECT pass_id FROM t4490f_passes WHERE k = 'start');
  v_full uuid := (SELECT pass_id FROM t4490f_passes WHERE k = 'full');
  v jsonb;
BEGIN
  UPDATE public.venue_passes SET valid_local_date = v_today - 30, valid_until_local_date = v_today + 29,
    valid_from = now() - interval '31 days', valid_to = now() + interval '30 days'
  WHERE id IN (v_ten, v_full);
  INSERT INTO public.venue_pass_days (pass_id, local_date, admitted_count)
  SELECT v_ten, v_today - n, 1 FROM generate_series(1, 10) n;
  v := public.issue_4490_check_in_scan('4490f000-0000-4000-9000-0000000000a1',
    (SELECT qr FROM t4490f_passes WHERE k = 'ten'), NULL, true,
    '4490f000-0000-4000-8000-000000000001', 'f-test-pepper-0123456789abcdef-4490');
  PERFORM public.t4490f_ok(v->>'result' = 'days_used' AND v->'pass'->>'allDaysUsed' = 'true',
    'F-3a the eleventh distinct day is all days used');

  UPDATE public.venue_passes SET valid_local_date = v_today - 1, valid_until_local_date = v_today + 58,
    valid_from = now() - interval '2 days', valid_to = now() + interval '59 days'
  WHERE id = v_day2;
  v := public.issue_4490_check_in_scan('4490f000-0000-4000-9000-0000000000a1',
    (SELECT qr FROM t4490f_passes WHERE k = 'day2'), NULL, true,
    '4490f000-0000-4000-8000-000000000001', 'f-test-pepper-0123456789abcdef-4490');
  PERFORM public.t4490f_ok(v->>'result' = 'admitted', 'F-3b day two is admitted, not wrong day');

  INSERT INTO public.venue_capacity_overrides (pool_id, venue_id, brand_id, local_date, closed)
  VALUES (public.t4490f_id('pool'), '4490f000-0000-4000-9000-0000000000a1',
    '4490f000-0000-4000-9000-000000000010', v_today, true);
  UPDATE public.venue_passes SET valid_local_date = v_today, valid_until_local_date = v_today + 59,
    valid_from = now() - interval '1 hour', valid_to = now() + interval '60 days'
  WHERE id = v_start;
  v := public.issue_4490_check_in_scan('4490f000-0000-4000-9000-0000000000a1',
    (SELECT qr FROM t4490f_passes WHERE k = 'start'), NULL, true,
    '4490f000-0000-4000-8000-000000000001', 'f-test-pepper-0123456789abcdef-4490');
  PERFORM public.t4490f_ok(v->>'result' = 'admitted',
    'F-3c day one uses the capacity already reserved at checkout');
  v := public.issue_4490_check_in_scan('4490f000-0000-4000-9000-0000000000a1',
    (SELECT qr FROM t4490f_passes WHERE k = 'full'), NULL, true,
    '4490f000-0000-4000-8000-000000000001', 'f-test-pepper-0123456789abcdef-4490');
  PERFORM public.t4490f_ok(v->>'result' = 'day_full', 'F-3d a full later day is refused as today is full');
END
$f3$;

-- F-4: every list reader uses the requested service date and cancellation
-- cannot mistake a used flex pass for unused.
DO $f4$
DECLARE
  v_today date := public.issue_4490_venue_local_date('4490f000-0000-4000-9000-0000000000a1');
  v_list jsonb;
  v_three uuid := (SELECT pass_id FROM t4490f_passes WHERE k = 'three');
BEGIN
  DELETE FROM public.venue_capacity_overrides WHERE pool_id = public.t4490f_id('pool') AND local_date = v_today;
  v_list := public.issue_4490_check_in_list('4490f000-0000-4000-9000-0000000000a1', v_today,
    '4490f000-0000-4000-8000-000000000001');
  PERFORM public.t4490f_ok(EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list->'passes') row
      WHERE row->>'passId' = v_three::text AND (row->>'daysAllowed')::integer = 3),
    'F-4a the day list includes a flex pass valid on that service date');
  PERFORM public.t4490f_expect(format(
      'SELECT public.issue_4490_cancel_preview(%L, (SELECT buyer_token_hash FROM public.stay_reservation_groups WHERE id = %L), NULL)',
      (SELECT group_id FROM t4490f_passes WHERE k = 'day2'), (SELECT group_id FROM t4490f_passes WHERE k = 'day2')),
    'PT409', 'offer_already_checked_in', 'F-4b a guest cannot cancel after using one flex day');
  PERFORM public.t4490f_ok(
    (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.venue_pass_days'::regclass)
      AND NOT has_table_privilege('anon', 'public.venue_pass_days', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.venue_pass_days', 'SELECT')
      AND has_table_privilege('service_role', 'public.venue_pass_days', 'SELECT')
      AND NOT has_function_privilege('authenticated',
        'public.issue_4490_pass_admitted_on(uuid,date)', 'EXECUTE')
      AND has_function_privilege('service_role',
        'public.issue_4490_confirm_free_offer(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated',
        'public.issue_4490_confirm_free_offer(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon',
        'public.issue_4490_confirm_free_offer(uuid)', 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                      WHERE polrelid = 'public.venue_pass_days'::regclass),
    'F-4c pass days and free confirmation are service-role only');
END
$f4$;

-- F-5: a single-day pass counts only on its own service date. Admitting a gate
-- sale today must not fill yesterday or tomorrow of the same pool, undo
-- restores it, and a scan after the pass's date keeps counting its own day.
DO $f5$
DECLARE
  v_venue constant uuid := '4490f000-0000-4000-9000-0000000000a1';
  v_owner constant uuid := '4490f000-0000-4000-8000-000000000001';
  v_today date := public.issue_4490_venue_local_date('4490f000-0000-4000-9000-0000000000a1');
  v_venue_row public.venue_listings%ROWTYPE;
  v_pool uuid := public.t4490f_id('pool');
  v_before_today record;
  v_before_next record;
  v_before_prev record;
  v_after record;
  v_list_next_before integer;
  v_sale jsonb;
  v_pass uuid;
  v_group uuid;
  v_undo jsonb;
  v_view jsonb;
  v_one jsonb;
  v_two jsonb;
  v_three jsonb;
  v_ten uuid := (SELECT pass_id FROM t4490f_passes WHERE k = 'ten');
BEGIN
  SELECT * INTO v_venue_row FROM public.venue_listings WHERE id = v_venue;
  UPDATE public.venue_offer_price_options SET pass_days = NULL, pass_window_days = NULL
  WHERE id = public.t4490f_id('option');
  SELECT * INTO v_before_today FROM public.issue_4490_pool_day_usage(v_pool, v_today);
  SELECT * INTO v_before_next FROM public.issue_4490_pool_day_usage(v_pool, v_today + 1);
  SELECT * INTO v_before_prev FROM public.issue_4490_pool_day_usage(v_pool, v_today - 1);
  v_list_next_before := (public.issue_4490_check_in_list(v_venue, v_today + 1, v_owner)->'totals'->>'admitted')::integer;

  v_sale := public.issue_4490_gate_sale(v_venue, public.t4490f_id('offer'),
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f_id('option'), 'guests', 3)),
    'cash', '{}'::jsonb, 'f5-gate-single', v_owner);
  v_pass := (v_sale->>'passId')::uuid;
  SELECT group_id INTO v_group FROM public.venue_passes WHERE id = v_pass;
  PERFORM public.t4490f_ok(v_sale->'admit'->>'result' = 'admitted'
      AND (SELECT days_allowed = 1 AND valid_local_date = v_today AND admitted_count = 3
           FROM public.venue_passes WHERE id = v_pass),
    'F-5a a gate sale today issues and admits a 3-guest single-day pass');
  SELECT * INTO v_after FROM public.issue_4490_pool_day_usage(v_pool, v_today);
  PERFORM public.t4490f_ok(v_after.used = v_before_today.used + 3
      AND v_after.used_gate = v_before_today.used_gate + 3,
    'F-5b its own day shows the 3 admitted guests once');
  SELECT * INTO v_after FROM public.issue_4490_pool_day_usage(v_pool, v_today + 1);
  PERFORM public.t4490f_ok(v_after.used = v_before_next.used
      AND v_after.used_gate = v_before_next.used_gate
      AND v_after.online_left = v_before_next.online_left,
    'F-5c tomorrow of the same pool is not filled by today''s admitted single-day pass');
  SELECT * INTO v_after FROM public.issue_4490_pool_day_usage(v_pool, v_today - 1);
  PERFORM public.t4490f_ok(v_after.used = v_before_prev.used
      AND v_after.used_gate = v_before_prev.used_gate,
    'F-5d yesterday of the same pool is not filled either');
  PERFORM public.t4490f_ok(public.issue_4490_pass_admitted_on(v_pass, v_today) = 3
      AND public.issue_4490_pass_admitted_on(v_pass, v_today + 1) = 0
      AND public.issue_4490_pass_admitted_on(v_pass, v_today - 1) = 0
      AND (public.issue_4490_pass_view(v_pass)->>'admittedCount')::integer = 3
      AND (public.issue_4490_check_in_list(v_venue, v_today + 1, v_owner)->'totals'->>'admitted')::integer
          = v_list_next_before,
    'F-5e admitted-on reads 3 on its own date and 0 on any other; the pass view and tomorrow''s list agree');

  v_undo := public.issue_4490_check_in_undo(v_venue, (v_sale->'admit'->>'logId')::uuid, v_owner);
  PERFORM public.t4490f_ok(v_undo->>'result' = 'undone'
      AND (v_undo->'pass'->>'admittedCount')::integer = 0
      AND public.issue_4490_pass_admitted_on(v_pass, v_today) = 0,
    'F-5f undo returns the pass to 0 admitted');
  SELECT * INTO v_after FROM public.issue_4490_pool_day_usage(v_pool, v_today + 1);
  PERFORM public.t4490f_ok(v_after.used = v_before_next.used AND v_after.online_left = v_before_next.online_left,
    'F-5g tomorrow is still unaffected after undo');

  -- Past its date: a pass for yesterday that is still inside valid_to (a late
  -- window, or a past-midnight scan) keeps counting against its own day.
  UPDATE public.venue_passes SET valid_local_date = v_today - 1,
    valid_from = now() - interval '1 day', valid_to = now() + interval '1 hour'
  WHERE id = v_pass;
  v_one := public.issue_4490_admit_pass(v_venue_row, v_pass, 1, true, v_owner, 'manual');
  v_two := public.issue_4490_admit_pass(v_venue_row, v_pass, 1, true, v_owner, 'manual');
  v_three := public.issue_4490_admit_pass(v_venue_row, v_pass, NULL, true, v_owner, 'manual');
  PERFORM public.t4490f_ok(v_one->>'result' = 'admitted'
      AND (v_one->'pass'->>'admittedCount')::integer = 1
      AND v_two->>'result' = 'admitted' AND (v_two->'pass'->>'admittedCount')::integer = 2
      AND v_three->>'result' = 'admitted' AND (v_three->>'admitted')::integer = 1
      AND (v_three->'pass'->>'admittedCount')::integer = 3
      AND (SELECT admitted_count FROM public.venue_passes WHERE id = v_pass) = 3,
    'F-5h scans after the pass''s own date count against that day and admit exactly the remaining guest');
  v_view := public.issue_4490_booking_projection(v_group, NULL);
  PERFORM public.t4490f_ok((v_view->'passes'->0->>'admittedCount')::integer = 3,
    'F-5i the booking projection shows the single-day pass fully used after its date');
  SELECT * INTO v_after FROM public.issue_4490_pool_day_usage(v_pool, v_today);
  PERFORM public.t4490f_ok(v_after.used = v_before_today.used + 3,
    'F-5j a late scan of yesterday''s pass does not count again on today''s pool');

  -- Multi-day passes keep reading their day rows.
  PERFORM public.t4490f_ok(public.issue_4490_pass_admitted_on(v_ten, v_today - 1) = 1
      AND public.issue_4490_pass_admitted_on(v_ten, v_today) = 0,
    'F-5k a multi-day pass still reads its own day rows');
END
$f5$;

SELECT public.t4490f_reset();
ROLLBACK;
