-- #4490 fix round 1 (N52; 20281203214490): service windows that close at 00:00 or after midnight.
-- Executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-PAST-MIDNIGHT-SERVICE-DAY | issue #4490 | a table service period or an opening window whose close is at or before its open runs past midnight: its slots are listed on the day it starts (last seating = close - turn - buffer), never repeated on the next day; the guest writer, the waitlist and the door ("today", gate sale) bucket a past-midnight time to that service day.
--
-- M-1 slots: Fri 17:00-00:00, Sat brunch + 17:00-00:00, Sun 17:00-23:00 (unchanged), Thu club 22:00-02:00, a 24:00 close.
-- M-2 service day helpers (table periods, opening hours, special days).
-- M-3 a guest books Thursday's 00:30 table (Friday on the calendar); the slot is then taken on Thursday only.
-- M-4 the freed past-midnight table goes to Thursday's waitlist.
--
-- FAILS-ON-REVERT (seen): pg_venue_available_slots without the wrap -> M-1a "Friday 17:00-00:00 ... (0 slots)";
-- pg_create_guest_reservation on the calendar date -> M-3a slot_unavailable; on_table_opened on the calendar date -> M-4b.
\set ON_ERROR_STOP on
BEGIN;
-- (shared #4490 P2 suite fixture; copied into each suite)
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES', 'STAY_RESERVE_READS', 'STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;

CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;

GRANT EXECUTE ON FUNCTION public.t4490_ok(boolean, text), public.t4490_expect(text, text, text, text),
  public.t4490_as(uuid), public.t4490_service(), public.t4490_reset() TO PUBLIC;


INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('44909100-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'fx1-owner-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44909100-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44909100-0000-4000-9000-000000000010', '44909100-0000-4000-8000-000000000001', 'Night Owl FX1 4490',
        'night-owl-fx1-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44909100-0000-4000-9000-0000000000a1', '44909100-0000-4000-9000-000000000010', 'nightowlfx14490', 'Night Owl FX1', 6.45, 3.40, 'club', 'verified', 'NG');
-- Fri 17:00-00:00; Sat 11:00-15:00 + 17:00-00:00; Sun 17:00-23:00; Thu 22:00-02:00; Tue 18:00-24:00 (a 24:00 close).
INSERT INTO public.venue_availability_config (brand_id, venue_id, iana_timezone, service_periods, turn_times,
  slot_granularity_minutes, advance_window_days, buffer_minutes, min_notice_minutes)
VALUES ('44909100-0000-4000-9000-000000000010', '44909100-0000-4000-9000-0000000000a1', 'Africa/Lagos',
        '[{"start":"17:00","end":"00:00","days":[5]},
          {"start":"11:00","end":"15:00","days":[6]},{"start":"17:00","end":"00:00","days":[6]},
          {"start":"17:00","end":"23:00","days":[0]},
          {"start":"22:00","end":"02:00","days":[4]},
          {"start":"18:00","end":"24:00","days":[2]}]'::jsonb,
        '{"p4":120}'::jsonb, 30, 30, 0, 0);
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
VALUES ('44909100-0000-4000-9000-000000000010', '44909100-0000-4000-9000-0000000000a1', true);
INSERT INTO public.venue_features (venue_id, brand_id, feature_key, enabled) VALUES
  ('44909100-0000-4000-9000-0000000000a1', '44909100-0000-4000-9000-000000000010', 'table_reservations', true),
  ('44909100-0000-4000-9000-0000000000a1', '44909100-0000-4000-9000-000000000010', 'waitlist', true);
INSERT INTO public.venue_tables (id, brand_id, venue_id, name, capacity)
VALUES ('44909100-0000-4000-9000-0000000000b1', '44909100-0000-4000-9000-000000000010', '44909100-0000-4000-9000-0000000000a1', 'T1', 4);
-- Opening hours (brand_hours weekday Mon=0..Sun=6): Thu 22:00-02:00, Fri 17:00-00:00.
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal) VALUES
  ('44909100-0000-4000-9000-000000000010', '44909100-0000-4000-9000-0000000000a1', 3, '22:00', '02:00', false, 0),
  ('44909100-0000-4000-9000-000000000010', '44909100-0000-4000-9000-0000000000a1', 4, '17:00', '00:00', false, 0);

-- The next Thursday at least 3 days ahead, and its Fri / Sat / Sun / Tue.
CREATE FUNCTION public.fx1_thu() RETURNS date LANGUAGE sql AS $f$
  SELECT d::date FROM generate_series((now() AT TIME ZONE 'Africa/Lagos')::date + 3,
                                      (now() AT TIME ZONE 'Africa/Lagos')::date + 9, interval '1 day') d
  WHERE extract(dow FROM d) = 4 LIMIT 1 $f$;
CREATE FUNCTION public.fx1_at(p_day date, p_hhmm text) RETURNS timestamptz LANGUAGE sql AS $f$
  SELECT (p_day + p_hhmm::time) AT TIME ZONE 'Africa/Lagos' $f$;
CREATE FUNCTION public.fx1_labels(p_day date) RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE(string_agg(s.slot_local_label, ',' ORDER BY s.slot_start_utc), '')
  FROM public.pg_venue_available_slots(p_day, 4, '44909100-0000-4000-9000-0000000000a1') s $f$;
GRANT EXECUTE ON FUNCTION public.fx1_thu(), public.fx1_at(date, text), public.fx1_labels(date) TO PUBLIC;

-- ===========================================================================
-- M-1 Slots.
-- ===========================================================================
SELECT public.t4490_as(NULL);
DO $m1$
DECLARE
  thu date := public.fx1_thu();
  l text;
  n integer;
BEGIN
  l := public.fx1_labels(thu + 1);
  PERFORM public.t4490_ok(l = '17:00,17:30,18:00,18:30,19:00,19:30,20:00,20:30,21:00,21:30,22:00',
    format('M-1a Friday 17:00-00:00 with a 2-hour table: 17:00 to 22:00, last seating 22:00 (%s slots: %s)',
           COALESCE(array_length(string_to_array(NULLIF(l, ''), ','), 1), 0), l));
  l := public.fx1_labels(thu + 2);
  PERFORM public.t4490_ok(l = '11:00,11:30,12:00,12:30,13:00,17:00,17:30,18:00,18:30,19:00,19:30,20:00,20:30,21:00,21:30,22:00',
    'M-1b Saturday: brunch 11:00-13:00 and the evening 17:00-22:00 (' || l || ')');
  l := public.fx1_labels(thu + 3);
  PERFORM public.t4490_ok(l = '17:00,17:30,18:00,18:30,19:00,19:30,20:00,20:30,21:00',
    'M-1c Sunday 17:00-23:00 is unchanged: 17:00 to 21:00 (' || l || ')');
  l := public.fx1_labels(thu);
  PERFORM public.t4490_ok(l = '22:00,22:30,23:00,23:30,00:00',
    'M-1d Thursday club night 22:00-02:00: 22:00 to 00:00 on Thursday (' || l || ')');
  SELECT count(*) INTO n FROM public.pg_venue_available_slots(thu + 1, 4, '44909100-0000-4000-9000-0000000000a1') s
  WHERE s.slot_start_utc < public.fx1_at(thu + 1, '12:00');
  PERFORM public.t4490_ok(n = 0, 'M-1e Thursday''s 00:00 seating is not repeated on Friday');
  PERFORM public.t4490_ok((SELECT s.slot_start_utc FROM public.pg_venue_available_slots(thu, 4, '44909100-0000-4000-9000-0000000000a1') s
                           ORDER BY s.slot_start_utc DESC LIMIT 1) = public.fx1_at(thu + 1, '00:00'),
    'M-1f Thursday''s last seating is the instant Friday 00:00 Lagos (the true time, labelled on Thursday)');
  l := public.fx1_labels(thu + 5);
  PERFORM public.t4490_ok(l = '18:00,18:30,19:00,19:30,20:00,20:30,21:00,21:30,22:00',
    'M-1g a 24:00 close reads as midnight: Tuesday 18:00 to 22:00 (' || l || ')');
END
$m1$;
SELECT public.t4490_reset();

-- ===========================================================================
-- M-2 Service-day helpers.
-- ===========================================================================
DO $m2$
DECLARE
  thu date := public.fx1_thu();
  a1 uuid := '44909100-0000-4000-9000-0000000000a1';
BEGIN
  PERFORM public.t4490_ok(public.issue_4490_table_service_date(a1, public.fx1_at(thu + 1, '00:30')) = thu,
    'M-2a a table at 00:30 Friday sits in Thursday''s 22:00-02:00 period: Thursday');
  PERFORM public.t4490_ok(public.issue_4490_table_service_date(a1, public.fx1_at(thu + 1, '02:00')) = thu + 1,
    'M-2b 02:00 Friday (the close) is Friday');
  PERFORM public.t4490_ok(public.issue_4490_table_service_date(a1, public.fx1_at(thu + 2, '00:10')) = thu + 2,
    'M-2c 00:10 Saturday after Friday''s 00:00 close is Saturday');
  PERFORM public.t4490_ok(public.issue_4490_venue_service_date(a1, public.fx1_at(thu + 1, '01:30')) = thu,
    'M-2d the door at 01:30 Friday: still Thursday''s night (opening hours 22:00-02:00)');
  PERFORM public.t4490_ok(public.issue_4490_venue_service_date(a1, public.fx1_at(thu + 1, '02:30')) = thu + 1,
    'M-2e at 02:30 Friday the door is on Friday');
  PERFORM public.t4490_ok(public.issue_4490_venue_service_date(a1, public.fx1_at(thu + 2, '00:30')) = thu + 2,
    'M-2f Friday closes at 00:00, so 00:30 Saturday is Saturday');
  INSERT INTO public.venue_special_hours (venue_id, brand_id, local_date, is_closed, windows)
  VALUES (a1, '44909100-0000-4000-9000-000000000010', thu, true, '[]'::jsonb);
  PERFORM public.t4490_ok(public.issue_4490_venue_service_date(a1, public.fx1_at(thu + 1, '01:30')) = thu + 1
                          AND public.issue_4490_table_service_date(a1, public.fx1_at(thu + 1, '00:30')) = thu + 1,
    'M-2g Thursday closed as a special day: 01:30 Friday is Friday');
  UPDATE public.venue_special_hours SET is_closed = false, windows = '[{"open":"21:00","close":"03:00"}]'::jsonb
  WHERE venue_id = a1 AND local_date = thu;
  PERFORM public.t4490_ok(public.issue_4490_venue_service_date(a1, public.fx1_at(thu + 1, '02:30')) = thu
                          AND public.issue_4490_table_service_date(a1, public.fx1_at(thu + 1, '02:30')) = thu,
    'M-2h Thursday special day 21:00-03:00: 02:30 Friday is still Thursday');
  DELETE FROM public.venue_special_hours WHERE venue_id = a1 AND local_date = thu;
END
$m2$;

CREATE TEMP TABLE t4490_ids_fx1 (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids_fx1 TO PUBLIC;

-- ===========================================================================
-- M-3 A guest books Thursday's 00:00 seating; M-4 the waitlist on Thursday.
-- ===========================================================================
SELECT public.t4490_service();
DO $m3$
DECLARE
  thu date := public.fx1_thu();
  a1 uuid := '44909100-0000-4000-9000-0000000000a1';
  r public.reservations;
  v jsonb;
BEGIN
  r := public.pg_create_guest_reservation(a1, public.fx1_at(thu + 1, '00:00'), 4, 'website', 'guest', NULL, 'Guest Late',
    NULL, 'late-fx1@example.test', NULL, 'NGN', NULL, 'none', NULL, NULL, NULL, 'confirmed', NULL, NULL, NULL);
  PERFORM public.t4490_ok(r.id IS NOT NULL AND r.status = 'confirmed',
    'M-3a a guest books Thursday''s 00:00 seating (Friday on the calendar)');
  PERFORM public.t4490_ok(public.fx1_labels(thu) = '22:00,22:30,23:00,23:30,00:00'
    AND (SELECT bool_and(s.is_full) FROM public.pg_venue_available_slots(thu, 4, a1) s
         WHERE s.slot_start_utc > public.fx1_at(thu, '22:00')),
    'M-3b the one table is now full from 22:30 to 00:00 on Thursday');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.pg_venue_available_slots(thu + 1, 4, a1) s WHERE s.is_full),
    'M-3c Friday''s evening is untouched');
  PERFORM public.t4490_expect(format($q$SELECT public.pg_create_guest_reservation(%L, %L::timestamptz, 4, 'website', 'guest', NULL,
      'Guest Two', NULL, 'two-fx1@example.test', NULL, 'NGN', NULL, 'none', NULL, NULL, NULL, 'confirmed', NULL, NULL, NULL)$q$,
      a1, public.fx1_at(thu + 1, '00:00')),
    'P0001', 'slot_unavailable', 'M-3d a second party for the same 00:00 table is refused');
  v := public.pg_join_venue_waitlist(a1, 4, thu, NULL, NULL,
    '{"name":"Ngozi Late","email":"ngozi-fx1@example.test"}'::jsonb, sha256('fx1-wl'::bytea));
  INSERT INTO t4490_ids_fx1 SELECT 'wl', (v->>'waitlistId')::uuid;
  INSERT INTO t4490_ids_fx1 VALUES ('res', r.id);
END
$m3$;
SELECT public.t4490_reset();
DO $m4$
DECLARE
  thu date := public.fx1_thu();
  w uuid := (SELECT v FROM t4490_ids_fx1 WHERE k = 'wl');
BEGIN
  PERFORM public.t4490_ok((SELECT status FROM public.venue_waitlist WHERE id = w) = 'waiting'
                          AND (SELECT desired_date FROM public.venue_waitlist WHERE id = w) = thu,
    'M-4a Ngozi waits for a table on Thursday night');
  UPDATE public.reservations SET status = 'cancelled_by_guest' WHERE id = (SELECT v FROM t4490_ids_fx1 WHERE k = 'res');
  PERFORM public.t4490_ok((SELECT status FROM public.venue_waitlist WHERE id = w) = 'notified'
                          AND (SELECT offered_slot_at FROM public.venue_waitlist WHERE id = w) = public.fx1_at(thu + 1, '00:00'),
    'M-4b the 00:00 table (Friday on the calendar) is freed: Thursday''s waitlist is told, offered 00:00');
END
$m4$;

ROLLBACK;
