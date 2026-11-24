\set ON_ERROR_STOP on
-- #4490 P1-2: executable PostgreSQL 17 proof of opening hours with several
-- windows a day and special days (20281203014490). BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-HOURS-ONE-HOME | issue #4490 | opening hours live only in venue-keyed brand_hours (+ venue_special_hours for single dates); venue_public_view.hours keeps the pre-#4490 shape byte-for-byte (window 0 per weekday) and every window reads from hours_windows.
--
-- H-1  the legacy day shape round-trips: the same rows as before (window 0), the same derived periods.
-- H-2  a split shift is stored as two windows and derived into two periods for that day.
-- H-3  overlapping windows are refused (payload and direct row); a closed day carries no window.
-- H-4  venue_public_view.hours equals the pre-#4490 expression for every legacy shape (closed, missing
--      times, past midnight); a split shift shows window 0 in `hours` and both in `hours_windows`.
-- H-5  slots: a date with no special day is identical to the pre-#4490 engine (copied verbatim below);
--      a closed special day has none; a special day's windows replace the weekly periods for that date.
-- H-6  special-day RPCs: validation, upsert, clear, authority; RLS read (owner yes, outsider 0, anon denied).
-- H-7  venue_public_view.special_hours lists the next 60 days only.
--
-- FAILS-ON-REVERT: drop the window_ordinal = 0 filter in the view -> H-4b; drop the special-day lookup
-- in the slot engine -> H-5b; drop the overlap guard -> H-3b.

BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

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
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;

-- The pre-#4490 slot engine (20261130000002 engine v4), verbatim but renamed.
CREATE FUNCTION public.t4490_old_slots(
  p_date       date,
  p_party_size int,
  p_venue_id   uuid DEFAULT NULL,
  p_brand_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  slot_start_utc   timestamptz,
  slot_local_label text,
  remaining        int,
  is_full          boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_venue_id      uuid := p_venue_id;
  v_legacy_ids    uuid[];
  v_enabled       boolean;
  v_cfg           public.venue_availability_config%ROWTYPE;
  v_tz            text;
  v_dow           int;
  v_turn_min      int;
  v_buffer_min    int;
  v_gran_min      int;
  v_eligible_cnt  int;
  v_eligible_ids  uuid[];
  v_cap_per_slot  int;
  v_now           timestamptz := now();
BEGIN
  IF p_date IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN;
  END IF;

  -- [TRANSITIONAL-1] legacy consumer-binary shim — shipped consumer binaries
  -- call { p_brand_id, ... } (useVenueAvailability.ts) and consumer OTA is
  -- frozen. Resolve the brand's venue IFF the brand has exactly one venue row;
  -- else return ZERO rows (fail-soft empty slot list, no crash, no dead 500).
  -- Exit condition: next consumer native build ships + OTA freeze lifts →
  -- drop p_brand_id + this block in a follow-on migration.
  IF v_venue_id IS NULL THEN
    IF p_brand_id IS NULL THEN
      RETURN;
    END IF;
    SELECT array_agg(v.id) INTO v_legacy_ids
    FROM public.venue_listings v
    WHERE v.brand_id = p_brand_id;
    IF v_legacy_ids IS NULL OR array_length(v_legacy_ids, 1) <> 1 THEN
      RETURN;
    END IF;
    v_venue_id := v_legacy_ids[1];
  END IF;

  SELECT reservations_enabled INTO v_enabled
  FROM public.venue_reservation_settings
  WHERE venue_id = v_venue_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  SELECT * INTO v_cfg
  FROM public.venue_availability_config
  WHERE venue_id = v_venue_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_buffer_min := COALESCE(v_cfg.buffer_minutes, 0);
  v_gran_min   := COALESCE(v_cfg.slot_granularity_minutes, 15);
  IF v_gran_min < 1 THEN
    v_gran_min := 15;
  END IF;

  v_tz := NULLIF(btrim(COALESCE(v_cfg.iana_timezone, '')), '');
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  v_turn_min := public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, p_party_size);

  IF EXISTS (
    SELECT 1 FROM public.venue_blackouts b
    WHERE b.venue_id = v_venue_id
      AND b.applies_to = 'all'
      AND p_date BETWEEN b.date_start AND b.date_end
  ) THEN
    RETURN;
  END IF;

  -- ELIGIBLE TABLES: active, reservable, party-fitting, not blacked out, and —
  -- SOFT-DELETE — NOT soft-deleted. A deleted table can never produce a slot.
  SELECT array_agg(t.id), count(*)::int
  INTO v_eligible_ids, v_eligible_cnt
  FROM public.venue_tables t
  WHERE t.venue_id = v_venue_id
    AND t.is_active
    AND t.deleted_at IS NULL                       -- SOFT-DELETE exclusion
    AND t.reservation_policy = 'reservable'
    AND p_party_size BETWEEN COALESCE(t.min_party, 1)
                         AND LEAST(COALESCE(t.max_party, t.capacity), t.capacity)
    AND NOT EXISTS (
      SELECT 1 FROM public.venue_blackouts b
      WHERE b.venue_id = v_venue_id
        AND p_date BETWEEN b.date_start AND b.date_end
        AND (
          (b.applies_to = 'table' AND b.table_id = t.id)
          OR (b.applies_to = 'zone' AND b.zone IS NOT DISTINCT FROM t.zone)
        )
    );

  v_eligible_cnt := COALESCE(v_eligible_cnt, 0);
  IF v_eligible_cnt = 0 THEN
    RETURN;
  END IF;

  v_cap_per_slot := LEAST(COALESCE(v_cfg.max_reservations_per_slot, v_eligible_cnt), v_eligible_cnt);

  v_dow := EXTRACT(dow FROM p_date)::int;

  RETURN QUERY
  WITH periods AS (
    SELECT
      pr.value->>'start' AS p_start,
      pr.value->>'end'   AS p_end
    FROM jsonb_array_elements(COALESCE(v_cfg.service_periods, '[]'::jsonb)) AS pr(value)
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(pr.value->'days', '[]'::jsonb)) AS d(dow)
      WHERE d.dow::int = v_dow
    )
      AND (pr.value->>'start') ~ '^[0-2][0-9]:[0-5][0-9]$'
      AND (pr.value->>'end')   ~ '^[0-2][0-9]:[0-5][0-9]$'
  ),
  bounds AS (
    SELECT
      ((p_date::timestamp) AT TIME ZONE v_tz) AS local_midnight_utc,
      ((split_part(p.p_start, ':', 1))::int * 60 + (split_part(p.p_start, ':', 2))::int) AS start_min,
      ((split_part(p.p_end,   ':', 1))::int * 60 + (split_part(p.p_end,   ':', 2))::int) AS end_min
    FROM periods p
  ),
  candidates AS (
    SELECT
      (b.local_midnight_utc + make_interval(mins => g.minute_of_day)) AS slot_utc,
      g.minute_of_day
    FROM bounds b
    CROSS JOIN LATERAL generate_series(
      b.start_min,
      b.end_min - (v_turn_min + v_buffer_min),
      v_gran_min
    ) AS g(minute_of_day)
    WHERE b.end_min - (v_turn_min + v_buffer_min) >= b.start_min
  ),
  windowed AS (
    SELECT DISTINCT c.slot_utc, c.minute_of_day
    FROM candidates c
    WHERE c.slot_utc >= v_now + make_interval(mins => COALESCE(v_cfg.min_notice_minutes, 0))
      AND p_date <= ((v_now AT TIME ZONE v_tz)::date + COALESCE(v_cfg.advance_window_days, 30))
  ),
  scored AS (
    SELECT
      w.slot_utc,
      w.minute_of_day,
      v_cap_per_slot - (
        SELECT count(*)::int
        FROM public.reservations r
        WHERE r.venue_id = v_venue_id
          AND r.status IN ('requested', 'confirmed', 'seated')
          AND (r.table_id IS NULL OR r.table_id = ANY (v_eligible_ids))
          AND r.reserved_for
                < (w.slot_utc + make_interval(mins => v_turn_min + v_buffer_min))
          AND (r.reserved_for
                + make_interval(mins =>
                    public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, r.party_size)
                    + v_buffer_min)) > w.slot_utc
      ) AS remaining_calc
    FROM windowed w
  )
  SELECT
    s.slot_utc AS slot_start_utc,
    to_char(s.slot_utc AT TIME ZONE v_tz, 'HH24:MI') AS slot_local_label,
    GREATEST(s.remaining_calc, 0) AS remaining,
    (s.remaining_calc <= 0) AS is_full
  FROM scored s
  ORDER BY s.slot_utc;
END;
$function$;

-- The pre-#4490 `hours` expression of venue_public_view (20270227001719).
CREATE FUNCTION public.t4490_old_hours(p_venue uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday, 'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
  FROM public.brand_hours bh WHERE bh.venue_id = p_venue;
$f$;

-- Fixture: owner 01, outsider 02; brand 10; venues A (verified restaurant) and B (verified, mixed legacy shapes).
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44901000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'h' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 2) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44901000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('44901000-0000-4000-9000-000000000010', '44901000-0000-4000-8000-000000000001', 'Hours 4490', 'hours-4490', 'NGN', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
  ('44901000-0000-4000-9000-0000000000a1', '44901000-0000-4000-9000-000000000010', 'hoursa4490', 'Hours A', 6.45, 3.40, 'restaurant', 'verified'),
  ('44901000-0000-4000-9000-0000000000b1', '44901000-0000-4000-9000-000000000010', 'hoursb4490', 'Hours B', 6.46, 3.41, 'restaurant', 'verified');
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled) VALUES
  ('44901000-0000-4000-9000-000000000010', '44901000-0000-4000-9000-0000000000a1', true);
INSERT INTO public.venue_tables (brand_id, venue_id, name, capacity)
SELECT '44901000-0000-4000-9000-000000000010', '44901000-0000-4000-9000-0000000000a1', 'T' || n, 4 FROM generate_series(1, 3) n;

-- H-1 legacy shape ---------------------------------------------------------------
SELECT public.t4490_as('44901000-0000-4000-8000-000000000001');
SELECT public.biz_upsert_brand_hours('44901000-0000-4000-9000-0000000000a1', (
  SELECT jsonb_agg(jsonb_build_object('weekday', d, 'open_time', '12:00', 'close_time', '22:00', 'is_closed', false) ORDER BY d)
  FROM generate_series(0, 6) d));
SELECT public.biz_upsert_brand_hours('44901000-0000-4000-9000-0000000000b1', jsonb_build_array(
  jsonb_build_object('weekday', 0, 'open_time', '09:00', 'close_time', '17:00', 'is_closed', false),
  jsonb_build_object('weekday', 1, 'open_time', NULL, 'close_time', NULL, 'is_closed', true),
  jsonb_build_object('weekday', 2, 'open_time', '', 'close_time', '', 'is_closed', false),
  jsonb_build_object('weekday', 3, 'open_time', '18:00', 'close_time', '02:00', 'is_closed', false),
  jsonb_build_object('weekday', 4, 'open_time', '10:00', 'close_time', '23:30', 'is_closed', false),
  jsonb_build_object('weekday', 5, 'open_time', '11:00', 'close_time', '23:00', 'is_closed', false),
  jsonb_build_object('weekday', 6, 'is_closed', true)));
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  (SELECT count(*) FROM public.brand_hours WHERE venue_id = '44901000-0000-4000-9000-0000000000b1') = 7
  AND (SELECT bool_and(window_ordinal = 0) FROM public.brand_hours WHERE venue_id = '44901000-0000-4000-9000-0000000000b1')
  AND (SELECT jsonb_agg(jsonb_build_array(weekday, open_time, close_time, is_closed) ORDER BY weekday)
       FROM public.brand_hours WHERE venue_id = '44901000-0000-4000-9000-0000000000b1')
     = '[[0,"09:00:00","17:00:00",false],[1,null,null,true],[2,null,null,false],[3,"18:00:00","02:00:00",false],[4,"10:00:00","23:30:00",false],[5,"11:00:00","23:00:00",false],[6,null,null,true]]'::jsonb,
  'H-1a the legacy payload writes the same seven rows as before, all window 0');
SELECT public.t4490_ok(
  (SELECT service_periods FROM public.venue_availability_config WHERE venue_id = '44901000-0000-4000-9000-0000000000b1')
  = '[{"end":"17:00","days":[1],"name":"Open","type":"derived_from_hours","start":"09:00"},{"end":"02:00","days":[4],"name":"Open","type":"derived_from_hours","start":"18:00"},{"end":"23:30","days":[5],"name":"Open","type":"derived_from_hours","start":"10:00"},{"end":"23:00","days":[6],"name":"Open","type":"derived_from_hours","start":"11:00"}]'::jsonb,
  'H-1b the legacy week derives the same periods (closed and time-less days skipped)');

-- H-2 split shift ----------------------------------------------------------------
SELECT public.t4490_as('44901000-0000-4000-8000-000000000001');
SELECT public.biz_upsert_brand_hours('44901000-0000-4000-9000-0000000000b1', jsonb_build_array(
  jsonb_build_object('weekday', 0, 'windows', jsonb_build_array(jsonb_build_object('open', '17:00', 'close', '23:00'), jsonb_build_object('open', '11:00', 'close', '15:00')), 'is_closed', false),
  jsonb_build_object('weekday', 1, 'windows', '[]'::jsonb, 'is_closed', true),
  jsonb_build_object('weekday', 2, 'open_time', '12:00', 'close_time', '20:00', 'is_closed', false),
  jsonb_build_object('weekday', 3, 'windows', jsonb_build_array(jsonb_build_object('open', '18:00', 'close', '02:00')), 'is_closed', false),
  jsonb_build_object('weekday', 4, 'windows', jsonb_build_array(jsonb_build_object('open', '07:00', 'close', '10:00'), jsonb_build_object('open', '12:00', 'close', '14:00'), jsonb_build_object('open', '16:00', 'close', '18:00'), jsonb_build_object('open', '19:00', 'close', '23:00')), 'is_closed', false),
  jsonb_build_object('weekday', 5, 'open_time', '11:00', 'close_time', '23:00', 'is_closed', false),
  jsonb_build_object('weekday', 6, 'is_closed', true)));
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  (SELECT jsonb_agg(jsonb_build_array(window_ordinal, open_time, close_time) ORDER BY window_ordinal)
   FROM public.brand_hours WHERE venue_id = '44901000-0000-4000-9000-0000000000b1' AND weekday = 0)
  = '[[0,"11:00:00","15:00:00"],[1,"17:00:00","23:00:00"]]'::jsonb
  AND (SELECT count(*) FROM public.brand_hours WHERE venue_id = '44901000-0000-4000-9000-0000000000b1' AND weekday = 4) = 4,
  'H-2a a split shift is two windows in time order; four windows fit in a day; old and new day shapes mix');
SELECT public.t4490_ok(
  (SELECT jsonb_agg(p->>'start' || '-' || (p->>'end')) FROM jsonb_array_elements(
     (SELECT service_periods FROM public.venue_availability_config WHERE venue_id = '44901000-0000-4000-9000-0000000000b1')) p
   WHERE p->'days' = '[1]'::jsonb) = '["11:00-15:00", "17:00-23:00"]'::jsonb,
  'H-2b the split day derives two service periods, in window order');

-- H-3 overlap and closed-day guards -------------------------------------------------------
SELECT public.t4490_as('44901000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$SELECT public.biz_upsert_brand_hours('44901000-0000-4000-9000-0000000000b1', (
  SELECT jsonb_agg(CASE WHEN d = 0
    THEN jsonb_build_object('weekday', 0, 'windows', jsonb_build_array(jsonb_build_object('open','11:00','close','15:00'), jsonb_build_object('open','14:30','close','20:00')), 'is_closed', false)
    ELSE jsonb_build_object('weekday', d, 'open_time', '12:00', 'close_time', '20:00', 'is_closed', false) END ORDER BY d)
  FROM generate_series(0, 6) d))$$, '22023', 'hours_windows_invalid', 'H-3a overlapping windows in one day are refused');
SELECT public.t4490_expect($$SELECT public.biz_upsert_brand_hours('44901000-0000-4000-9000-0000000000b1', (
  SELECT jsonb_agg(CASE WHEN d = 0
    THEN jsonb_build_object('weekday', 0, 'windows', jsonb_build_array(jsonb_build_object('open','20:00','close','03:00'), jsonb_build_object('open','22:00','close','23:00')), 'is_closed', false)
    ELSE jsonb_build_object('weekday', d, 'open_time', '12:00', 'close_time', '20:00', 'is_closed', false) END ORDER BY d)
  FROM generate_series(0, 6) d))$$, '22023', 'hours_windows_invalid', 'H-3b a window inside a past-midnight window is refused');
SELECT public.t4490_expect($$SELECT public.biz_upsert_brand_hours('44901000-0000-4000-9000-0000000000b1', (
  SELECT jsonb_agg(jsonb_build_object('weekday', d, 'windows', (SELECT jsonb_agg(jsonb_build_object('open', lpad((h*2)::text,2,'0') || ':00', 'close', lpad((h*2+1)::text,2,'0') || ':00')) FROM generate_series(0, 4) h), 'is_closed', false) ORDER BY d)
  FROM generate_series(0, 6) d))$$, '22023', 'hours_windows_invalid', 'H-3c at most four windows a day');
SELECT public.t4490_reset();
SELECT public.t4490_expect($$INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal) VALUES ('44901000-0000-4000-9000-000000000010','44901000-0000-4000-9000-0000000000b1',0,'14:00','16:00',false,2)$$,
  '22023', 'hours_windows_overlap', 'H-3d a direct overlapping row is refused by the table guard');
SELECT public.t4490_expect($$INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal) VALUES ('44901000-0000-4000-9000-000000000010','44901000-0000-4000-9000-0000000000b1',6,'10:00','12:00',false,1)$$,
  '22023', 'hours_closed_day_has_windows', 'H-3e a closed day carries no window');
SELECT public.t4490_expect($$INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal) VALUES ('44901000-0000-4000-9000-000000000010','44901000-0000-4000-9000-0000000000b1',2,'21:00','22:00',false,4)$$,
  '23514', NULL, 'H-3f window_ordinal is 0..3');

-- H-4 public view hours ------------------------------------------------------------------
SELECT public.t4490_ok(
  (SELECT hours::text FROM public.venue_public_view WHERE id = '44901000-0000-4000-9000-0000000000a1')
  = public.t4490_old_hours('44901000-0000-4000-9000-0000000000a1')::text,
  'H-4a a one-window week: hours is byte-identical to the pre-#4490 expression');
SELECT public.t4490_as('44901000-0000-4000-8000-000000000001');
SELECT public.biz_upsert_brand_hours('44901000-0000-4000-9000-0000000000b1', jsonb_build_array(
  jsonb_build_object('weekday', 0, 'open_time', '09:00', 'close_time', '17:00', 'is_closed', false),
  jsonb_build_object('weekday', 1, 'open_time', NULL, 'close_time', NULL, 'is_closed', true),
  jsonb_build_object('weekday', 2, 'open_time', '', 'close_time', '', 'is_closed', false),
  jsonb_build_object('weekday', 3, 'open_time', '18:00', 'close_time', '02:00', 'is_closed', false),
  jsonb_build_object('weekday', 4, 'open_time', '10:00', 'close_time', '23:30', 'is_closed', false),
  jsonb_build_object('weekday', 5, 'open_time', '11:00', 'close_time', '23:00', 'is_closed', false),
  jsonb_build_object('weekday', 6, 'is_closed', true)));
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  (SELECT hours::text FROM public.venue_public_view WHERE id = '44901000-0000-4000-9000-0000000000b1')
  = public.t4490_old_hours('44901000-0000-4000-9000-0000000000b1')::text,
  'H-4b closed, time-less and past-midnight legacy days: hours byte-identical');
SELECT public.t4490_ok(
  (SELECT hours_windows::text = hours::text FROM public.venue_public_view WHERE id = '44901000-0000-4000-9000-0000000000b1') IS FALSE
  AND (SELECT jsonb_array_length(hours_windows) = 7 AND hours_windows->0 ? 'window_ordinal'
       FROM public.venue_public_view WHERE id = '44901000-0000-4000-9000-0000000000b1'),
  'H-4c hours_windows carries window_ordinal on every row');
SELECT public.t4490_as('44901000-0000-4000-8000-000000000001');
SELECT public.biz_upsert_brand_hours('44901000-0000-4000-9000-0000000000b1', (
  SELECT jsonb_agg(CASE WHEN d = 0
    THEN jsonb_build_object('weekday', 0, 'windows', jsonb_build_array(jsonb_build_object('open','11:00','close','15:00'), jsonb_build_object('open','17:00','close','23:00')), 'is_closed', false)
    ELSE jsonb_build_object('weekday', d, 'open_time', '12:00', 'close_time', '20:00', 'is_closed', false) END ORDER BY d)
  FROM generate_series(0, 6) d));
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  (SELECT jsonb_array_length(hours) = 7 AND hours->0->>'open_time' = '11:00' AND NOT (hours->0 ? 'window_ordinal')
     AND jsonb_array_length(hours_windows) = 8
     AND hours_windows->1 = '{"weekday":0,"window_ordinal":1,"open_time":"17:00","close_time":"23:00","is_closed":false}'::jsonb
   FROM public.venue_public_view WHERE id = '44901000-0000-4000-9000-0000000000b1'),
  'H-4d a split shift: hours shows one row per weekday (window 0); hours_windows shows both windows');

-- H-5 slots --------------------------------------------------------------------------------
UPDATE public.venue_availability_config SET iana_timezone = 'Africa/Lagos', iana_timezone_source = 'operator', advance_window_days = 60
WHERE venue_id = '44901000-0000-4000-9000-0000000000a1';
DO $h5$
DECLARE
  v_day date := ((now() AT TIME ZONE 'Africa/Lagos')::date + 7);
  v_next date := ((now() AT TIME ZONE 'Africa/Lagos')::date + 8);
  v_new jsonb;
  v_old jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.slot_start_utc) INTO v_new FROM public.pg_venue_available_slots(v_day, 2, '44901000-0000-4000-9000-0000000000a1') s;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.slot_start_utc) INTO v_old FROM public.t4490_old_slots(v_day, 2, '44901000-0000-4000-9000-0000000000a1') s;
  PERFORM public.t4490_ok(v_new IS NOT NULL AND jsonb_array_length(v_new) > 10 AND v_new = v_old,
    'H-5a with no special day the slots equal the pre-#4490 engine exactly');
  PERFORM public.t4490_as('44901000-0000-4000-8000-000000000001');
  PERFORM public.issue_4490_set_special_hours('44901000-0000-4000-9000-0000000000a1', v_day, true, NULL, 'Staff party');
  PERFORM public.issue_4490_set_special_hours('44901000-0000-4000-9000-0000000000a1', v_next, false,
    jsonb_build_array(jsonb_build_object('open', '18:00', 'close', '21:00')), 'Late opening');
  PERFORM public.t4490_reset();
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.pg_venue_available_slots(v_day, 2, '44901000-0000-4000-9000-0000000000a1')),
    'H-5b a closed special day has no slots');
  PERFORM public.t4490_ok(
    (SELECT min(slot_local_label) = '18:00' AND max(slot_local_label) < '21:00' AND count(*) > 0
     FROM public.pg_venue_available_slots(v_next, 2, '44901000-0000-4000-9000-0000000000a1'))
    AND EXISTS (SELECT 1 FROM public.t4490_old_slots(v_next, 2, '44901000-0000-4000-9000-0000000000a1') WHERE slot_local_label = '12:00'),
    'H-5c a special day''s windows replace the weekly periods for that date only');
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.slot_start_utc) INTO v_new FROM public.pg_venue_available_slots(v_day + 2, 2, '44901000-0000-4000-9000-0000000000a1') s;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.slot_start_utc) INTO v_old FROM public.t4490_old_slots(v_day + 2, 2, '44901000-0000-4000-9000-0000000000a1') s;
  PERFORM public.t4490_ok(v_new = v_old, 'H-5d the next ordinary day is unchanged');
END
$h5$;

-- H-6 special-day RPCs ---------------------------------------------------------------------
SELECT public.t4490_as('44901000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_special_hours('44901000-0000-4000-9000-0000000000a1', current_date + 3, false, '[]'::jsonb, NULL)$$,
  '22023', 'special_day_windows_invalid', 'H-6a an open special day needs a window');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_special_hours('44901000-0000-4000-9000-0000000000a1', current_date + 3, false, '[{"open":"25:00","close":"26:00"}]'::jsonb, NULL)$$,
  '22023', 'special_day_windows_invalid', 'H-6b window times are HH:MM');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_special_hours('44901000-0000-4000-9000-0000000000a1', current_date + 3, false, '[{"open":"10:00","close":"14:00"},{"open":"13:00","close":"15:00"}]'::jsonb, NULL)$$,
  '22023', 'special_day_windows_invalid', 'H-6c special-day windows may not overlap');
DO $h6$
DECLARE
  v1 jsonb;
  v2 jsonb;
  v3 jsonb;
BEGIN
  v1 := public.issue_4490_set_special_hours('44901000-0000-4000-9000-0000000000a1', current_date + 3, false,
    '[{"open":"10:00","close":"14:00"}]'::jsonb, ' Holiday hours ');
  v2 := public.issue_4490_set_special_hours('44901000-0000-4000-9000-0000000000a1', current_date + 3, true, '[{"open":"10:00","close":"14:00"}]'::jsonb, NULL);
  PERFORM public.t4490_ok(v1->>'label' = 'Holiday hours' AND (v2->>'is_closed')::boolean AND v2->'windows' = '[]'::jsonb
      AND (v2->>'version')::int = 2 AND v2->>'id' = v1->>'id',
    'H-6d set is an upsert per date; closing drops the windows; the label is trimmed');
  v3 := public.issue_4490_clear_special_hours('44901000-0000-4000-9000-0000000000a1', current_date + 3);
  PERFORM public.t4490_ok((v3->>'cleared')::boolean
      AND NOT EXISTS (SELECT 1 FROM public.venue_special_hours WHERE venue_id = '44901000-0000-4000-9000-0000000000a1' AND local_date = current_date + 3),
    'H-6e clear removes the date');
END
$h6$;
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_special_hours) = 2, 'H-6f the owner reads the venue''s special days');
SELECT public.t4490_as('44901000-0000-4000-8000-000000000002');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_special_hours) = 0, 'H-6g an outsider reads none');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_special_hours('44901000-0000-4000-9000-0000000000a1', current_date + 4, true, NULL, NULL)$$,
  '42501', 'not_authorized', 'H-6h an outsider cannot set a special day');
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect($$SELECT count(*) FROM public.venue_special_hours$$, '42501', NULL, 'H-6i anon has no direct read');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_public_view WHERE id = '44901000-0000-4000-9000-0000000000a1') = 1,
  'H-6j anon still reads the public view');
SELECT public.t4490_reset();

-- H-7 special_hours horizon -------------------------------------------------------------------
INSERT INTO public.venue_special_hours (venue_id, brand_id, local_date, is_closed) VALUES
  ('44901000-0000-4000-9000-0000000000a1', '44901000-0000-4000-9000-000000000010', (now() AT TIME ZONE 'UTC')::date + 61, true),
  ('44901000-0000-4000-9000-0000000000a1', '44901000-0000-4000-9000-000000000010', (now() AT TIME ZONE 'UTC')::date - 5, true);
SELECT public.t4490_ok(
  (SELECT jsonb_array_length(special_hours) = 2
     AND special_hours->0->>'label' = 'Staff party' AND (special_hours->0->>'is_closed')::boolean
     AND special_hours->1->'windows' = '[{"open":"18:00","close":"21:00"}]'::jsonb
   FROM public.venue_public_view WHERE id = '44901000-0000-4000-9000-0000000000a1'),
  'H-7 special_hours lists the next 60 days only (a day 61 ahead and a past day are left out)');

ROLLBACK;
