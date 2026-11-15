\set ON_ERROR_STOP on
-- #4339: a /links strip shows only within its dates, in its own time zone.
-- Executable PostgreSQL 17 proof for 20280708004339_issue_4339_links_strip_time_zone.sql.
--
-- I-4339-LINKS-STRIP-WINDOW (enforced here): a published strip is public only
-- while now() is in [shows_on 00:00, (COALESCE(shows_until, shows_on) + 1)
-- 00:00) in the strip's time_zone; public.links_strip_window() is its only
-- owner, and the policy, links_page_strips() and admin_links_strips_list()
-- all answer from it.
--
-- W  the window at the exact boundary minutes: 23:59 / 00:00 in Africa/Lagos
--    and America/New_York, and across the 8 Mar 2026 US clock change.
-- A  anon: the reader and the table policy agree with the admin status for
--    live, scheduled and ended strips in zones a whole day apart; a scheduled
--    strip is never readable directly; the reader returns time_zone,
--    starts_at and ends_at equal to the window.
-- S  admin_links_strip_save: an invalid or missing zone is refused
--    (links_time_zone_invalid), a window already over in ITS zone is refused,
--    the same day in a zone where it is still running is accepted, the zone
--    is stored and updated.
-- G  one save overload (the old 8-argument signature is gone), the column is
--    NOT NULL with no default, grants and security modes as intended.
-- C  the table's CHECK refuses a zone Postgres cannot read on a direct INSERT
--    or UPDATE, and the readers keep answering (tester P2-2).
-- FAILS-ON-REVERT: without the migration W fails (no links_strip_window) and
-- A fails (a scheduled strip is public).
-- Runs after the full migration replay; every fixture rolls back.
BEGIN;

CREATE FUNCTION pg_temp.tz_act(p_user uuid) RETURNS void LANGUAGE sql AS $function$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true),
         set_config('request.jwt.claims',
           CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$function$;
GRANT EXECUTE ON FUNCTION pg_temp.tz_act(uuid) TO anon, authenticated;

-- ═══ W: the window at its boundary minutes ═════════════════════════════════
DO $test$
DECLARE
  v_case record;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    -- Lagos (GMT+1): Mon 16 – Sat 28 Nov 2026.
    ('lagos 23:59 Sun 15 (before)', '2026-11-16'::date, '2026-11-28'::date, 'Africa/Lagos', '2026-11-15 22:59:00+00'::timestamptz, false),
    ('lagos 00:00 Mon 16 (first minute)', '2026-11-16', '2026-11-28', 'Africa/Lagos', '2026-11-15 23:00:00+00', true),
    ('lagos 23:59 Sat 28 (last minute)', '2026-11-16', '2026-11-28', 'Africa/Lagos', '2026-11-28 22:59:00+00', true),
    ('lagos 23:59:59.999 Sat 28', '2026-11-16', '2026-11-28', 'Africa/Lagos', '2026-11-28 22:59:59.999+00', true),
    ('lagos 00:00 Sun 29 (after)', '2026-11-16', '2026-11-28', 'Africa/Lagos', '2026-11-28 23:00:00+00', false),
    -- New York (EST, GMT-5): a one-day strip on Mon 16 Nov 2026.
    ('new york 23:59 Sun 15', '2026-11-16', NULL::date, 'America/New_York', '2026-11-16 04:59:00+00', false),
    ('new york 00:00 Mon 16', '2026-11-16', NULL, 'America/New_York', '2026-11-16 05:00:00+00', true),
    ('new york 23:59 Mon 16', '2026-11-16', NULL, 'America/New_York', '2026-11-17 04:59:00+00', true),
    ('new york 00:00 Tue 17', '2026-11-16', NULL, 'America/New_York', '2026-11-17 05:00:00+00', false),
    -- The same day in Lagos is a different instant: 00:00 New York is 06:00 Lagos.
    ('lagos one day: 05:00Z is 06:00 Mon 16', '2026-11-16', NULL, 'Africa/Lagos', '2026-11-16 05:00:00+00', true),
    ('lagos one day: 23:00Z is 00:00 Tue 17', '2026-11-16', NULL, 'Africa/Lagos', '2026-11-16 23:00:00+00', false),
    -- Sun 8 Mar 2026: New York springs forward at 02:00 (EST -5 -> EDT -4); the day is 23 hours.
    ('dst 23:59 Sat 7 (EST)', '2026-03-08', NULL, 'America/New_York', '2026-03-08 04:59:00+00', false),
    ('dst 00:00 Sun 8 (EST)', '2026-03-08', NULL, 'America/New_York', '2026-03-08 05:00:00+00', true),
    ('dst 03:30 Sun 8 (EDT)', '2026-03-08', NULL, 'America/New_York', '2026-03-08 07:30:00+00', true),
    ('dst 23:59 Sun 8 (EDT)', '2026-03-08', NULL, 'America/New_York', '2026-03-09 03:59:00+00', true),
    ('dst 00:00 Mon 9 (EDT)', '2026-03-08', NULL, 'America/New_York', '2026-03-09 04:00:00+00', false),
    -- A run across the change ends at EDT midnight.
    ('dst run Sat 7 – Sun 8, last minute', '2026-03-07', '2026-03-08', 'America/New_York', '2026-03-09 03:59:00+00', true),
    ('dst run Sat 7 – Sun 8, first minute', '2026-03-07', '2026-03-08', 'America/New_York', '2026-03-07 05:00:00+00', true),
    ('dst run Sat 7 – Sun 8, after', '2026-03-07', '2026-03-08', 'America/New_York', '2026-03-09 04:00:00+00', false)
  ) AS c(label, shows_on, shows_until, zone, at_instant, expected) LOOP
    IF (public.links_strip_window(v_case.shows_on, v_case.shows_until, v_case.zone) @> v_case.at_instant) IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION 'W: % expected %, window %', v_case.label, v_case.expected,
        public.links_strip_window(v_case.shows_on, v_case.shows_until, v_case.zone);
    END IF;
  END LOOP;

  IF public.links_strip_window('2026-03-08', NULL, 'America/New_York')
     IS DISTINCT FROM tstzrange('2026-03-08 05:00:00+00', '2026-03-09 04:00:00+00', '[)') THEN
    RAISE EXCEPTION 'W: the 8 Mar New York window is not 05:00Z – 04:00Z (23 hours)';
  END IF;
  IF public.links_strip_window('2026-11-16', '2026-11-28', 'Africa/Lagos')
     IS DISTINCT FROM tstzrange('2026-11-15 23:00:00+00', '2026-11-28 23:00:00+00', '[)') THEN
    RAISE EXCEPTION 'W: the Lagos window bounds are wrong';
  END IF;
  -- shows_until equal to shows_on is the same as no end date.
  IF public.links_strip_window('2026-11-16', '2026-11-16', 'UTC') IS DISTINCT FROM public.links_strip_window('2026-11-16', NULL, 'UTC') THEN
    RAISE EXCEPTION 'W: a same-day end differs from a one-day strip';
  END IF;
END
$test$;

-- ═══ Fixtures relative to now(), in zones a whole day apart ════════════════
-- Pacific/Kiritimati is UTC+14 and Pacific/Pago_Pago is UTC-11: Kiritimati's
-- calendar is always 1 or 2 days ahead, so Kiritimati's today is still in the
-- future in Pago Pago, and Pago Pago's today is already over in Kiritimati.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('4339d000-0000-4000-a000-000000000001', 'issue4339-tz-support@test.local', now());
INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue4339-tz-support@test.local', 'growth', 'active', now());
INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('4339d000-0000-4000-a000-000000000001', true, false, 'staff');

CREATE TEMP TABLE tz_fixture (id uuid PRIMARY KEY, want text NOT NULL) ON COMMIT DROP;
GRANT SELECT ON tz_fixture TO anon, authenticated;
INSERT INTO tz_fixture VALUES
  ('4339d000-0000-4000-9000-000000000001', 'live'),       -- today in Lagos
  ('4339d000-0000-4000-9000-000000000002', 'live'),       -- today in New York, run to next week
  ('4339d000-0000-4000-9000-000000000003', 'scheduled'),  -- tomorrow in Lagos
  ('4339d000-0000-4000-9000-000000000004', 'ended'),      -- yesterday in New York
  ('4339d000-0000-4000-9000-000000000005', 'live'),       -- Kiritimati's today, in Kiritimati
  ('4339d000-0000-4000-9000-000000000006', 'scheduled'),  -- the same day, in Pago Pago
  ('4339d000-0000-4000-9000-000000000007', 'live'),       -- Pago Pago's today, in Pago Pago
  ('4339d000-0000-4000-9000-000000000008', 'ended'),      -- the same day, in Kiritimati
  ('4339d000-0000-4000-9000-000000000009', 'unpublished'); -- live window, not published

INSERT INTO public.links_strips (id, shows_on, shows_until, time_zone, title, label, opens, position, is_published) VALUES
  ('4339d000-0000-4000-9000-000000000001', (now() AT TIME ZONE 'Africa/Lagos')::date, NULL, 'Africa/Lagos', 'Lagos today', 'New', 'host', 1, true),
  ('4339d000-0000-4000-9000-000000000002', (now() AT TIME ZONE 'America/New_York')::date, (now() AT TIME ZONE 'America/New_York')::date + 7, 'America/New_York', 'New York week', 'New', 'host', 2, true),
  ('4339d000-0000-4000-9000-000000000003', (now() AT TIME ZONE 'Africa/Lagos')::date + 1, (now() AT TIME ZONE 'Africa/Lagos')::date + 3, 'Africa/Lagos', 'Lagos from tomorrow', 'Featured', 'host', 3, true),
  ('4339d000-0000-4000-9000-000000000004', (now() AT TIME ZONE 'America/New_York')::date - 3, (now() AT TIME ZONE 'America/New_York')::date - 1, 'America/New_York', 'New York over', 'New', 'host', 4, true),
  ('4339d000-0000-4000-9000-000000000005', (now() AT TIME ZONE 'Pacific/Kiritimati')::date, NULL, 'Pacific/Kiritimati', 'Kiritimati today', 'New', 'host', 5, true),
  ('4339d000-0000-4000-9000-000000000006', (now() AT TIME ZONE 'Pacific/Kiritimati')::date, NULL, 'Pacific/Pago_Pago', 'Kiritimati day in Pago Pago', 'New', 'host', 6, true),
  ('4339d000-0000-4000-9000-000000000007', (now() AT TIME ZONE 'Pacific/Pago_Pago')::date, NULL, 'Pacific/Pago_Pago', 'Pago Pago today', 'New', 'host', 7, true),
  ('4339d000-0000-4000-9000-000000000008', (now() AT TIME ZONE 'Pacific/Pago_Pago')::date, NULL, 'Pacific/Kiritimati', 'Pago Pago day in Kiritimati', 'New', 'host', 8, true),
  ('4339d000-0000-4000-9000-000000000009', (now() AT TIME ZONE 'Africa/Lagos')::date, NULL, 'Africa/Lagos', 'Hidden draft', 'New', 'host', 9, false);

-- ═══ A: what anon sees agrees with the window ══════════════════════════════
SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_live uuid[] := ARRAY['4339d000-0000-4000-9000-000000000001', '4339d000-0000-4000-9000-000000000002',
                         '4339d000-0000-4000-9000-000000000005', '4339d000-0000-4000-9000-000000000007']::uuid[];
  v_reader uuid[];
  v_table uuid[];
  v_row record;
BEGIN
  SELECT array_agg(strip.id ORDER BY strip.position) INTO v_reader
  FROM public.links_page_strips() strip WHERE strip.id IN (SELECT id FROM tz_fixture);
  SELECT array_agg(strip.id ORDER BY strip.position) INTO v_table
  FROM public.links_strips strip WHERE strip.id IN (SELECT id FROM tz_fixture);
  IF v_reader IS DISTINCT FROM v_live THEN
    RAISE EXCEPTION 'A: reader rows wrong: %', (SELECT array_agg(strip.title ORDER BY strip.position)
      FROM public.links_page_strips() strip WHERE strip.id IN (SELECT id FROM tz_fixture));
  END IF;
  IF v_table IS DISTINCT FROM v_live THEN
    RAISE EXCEPTION 'A: the table policy disagrees with the reader: %', v_table;
  END IF;
  -- A scheduled strip is not readable directly, whatever columns are asked for.
  IF EXISTS (SELECT 1 FROM public.links_strips WHERE id IN ('4339d000-0000-4000-9000-000000000003', '4339d000-0000-4000-9000-000000000006')) THEN
    RAISE EXCEPTION 'A: anon read a scheduled strip from the table';
  END IF;
  -- The reader carries the zone and the window, exactly.
  FOR v_row IN SELECT strip.* FROM public.links_page_strips() strip WHERE strip.id IN (SELECT id FROM tz_fixture) LOOP
    IF v_row.time_zone IS NULL
       OR tstzrange(v_row.starts_at, v_row.ends_at, '[)') IS DISTINCT FROM public.links_strip_window(v_row.shows_on, v_row.shows_until, v_row.time_zone)
       OR NOT (v_row.starts_at <= now() AND now() < v_row.ends_at) THEN
      RAISE EXCEPTION 'A: reader window wrong for %: % % %', v_row.title, v_row.time_zone, v_row.starts_at, v_row.ends_at;
    END IF;
  END LOOP;
  IF (SELECT strip.time_zone FROM public.links_page_strips() strip WHERE strip.id = '4339d000-0000-4000-9000-000000000001') <> 'Africa/Lagos' THEN
    RAISE EXCEPTION 'A: reader lost the zone';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ S: the save RPC, and the admin list's status ══════════════════════════
SELECT pg_temp.tz_act('4339d000-0000-4000-a000-000000000001');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_lagos constant date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_kiri constant date := (now() AT TIME ZONE 'Pacific/Kiritimati')::date;
  v_pago constant date := (now() AT TIME ZONE 'Pacific/Pago_Pago')::date;
  v_case record;
  v_message text;
  v_row public.links_strips;
  v_again public.links_strips;
BEGIN
  -- L: the admin list's status is the window's answer, for every fixture.
  IF EXISTS (
    SELECT 1 FROM public.admin_links_strips_list() strip
    JOIN tz_fixture fixture ON fixture.id = strip.id
    WHERE fixture.want <> 'unpublished' AND strip.status IS DISTINCT FROM fixture.want
  ) THEN
    RAISE EXCEPTION 'L: admin status wrong: %', (SELECT jsonb_agg(jsonb_build_object('title', strip.title, 'status', strip.status, 'want', fixture.want))
      FROM public.admin_links_strips_list() strip JOIN tz_fixture fixture ON fixture.id = strip.id);
  END IF;
  -- The unpublished strip is inside its window: live by date, hidden by is_published.
  IF (SELECT strip.status FROM public.admin_links_strips_list() strip WHERE strip.id = '4339d000-0000-4000-9000-000000000009') <> 'live' THEN
    RAISE EXCEPTION 'L: status of an unpublished strip in its window is not live';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_links_strips_list() strip JOIN tz_fixture fixture ON fixture.id = strip.id
             WHERE strip.is_expired IS DISTINCT FROM (strip.status = 'ended')
                OR tstzrange(strip.starts_at, strip.ends_at, '[)') IS DISTINCT FROM public.links_strip_window(strip.shows_on, strip.shows_until, strip.time_zone)) THEN
    RAISE EXCEPTION 'L: is_expired or the window disagree with status';
  END IF;

  -- Zones Postgres does not know by that exact name are refused.
  FOR v_case IN SELECT * FROM (VALUES ('Mars/Olympus_Mons'), ('africa/lagos'), ('Lagos'), (''), ('GMT+1 '), (NULL::text)) AS c(zone) LOOP
    v_message := NULL;
    BEGIN
      PERFORM public.admin_links_strip_save(NULL, v_lagos, 'Zone', 'New', 'host', NULL, NULL, NULL, v_case.zone);
    EXCEPTION WHEN raise_exception THEN v_message := SQLERRM;
    END;
    IF v_message IS DISTINCT FROM 'links_time_zone_invalid' THEN
      RAISE EXCEPTION 'S: zone % expected links_time_zone_invalid, got %', quote_nullable(v_case.zone), v_message;
    END IF;
  END LOOP;
  -- The 8-argument call (no zone) resolves to the new function and is refused.
  v_message := NULL;
  BEGIN
    PERFORM public.admin_links_strip_save(NULL, v_lagos, 'Old caller', 'New', 'host', NULL, NULL, NULL);
  EXCEPTION WHEN raise_exception THEN v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'links_time_zone_invalid' THEN
    RAISE EXCEPTION 'S: a save without a zone was not refused (%)', v_message;
  END IF;

  -- A window already over in ITS zone is refused; the UTC-1 grace is gone.
  FOR v_case IN SELECT * FROM (VALUES
    (v_pago, NULL::date, 'Pacific/Kiritimati', 'links_shows_on_invalid'),     -- Pago Pago's today is over in Kiritimati
    (v_pago - 3, v_pago, 'Pacific/Kiritimati', 'links_shows_until_invalid'),
    (v_lagos - 1, NULL::date, 'Africa/Lagos', 'links_shows_on_invalid'),       -- yesterday in Lagos
    (v_lagos, v_lagos - 1, 'Africa/Lagos', 'links_shows_until_invalid'),       -- ends before it starts
    (NULL::date, v_lagos, 'Africa/Lagos', 'links_shows_on_invalid')
  ) AS c(shows_on, shows_until, zone, expected) LOOP
    v_message := NULL;
    BEGIN
      PERFORM public.admin_links_strip_save(NULL, v_case.shows_on, 'Over', 'New', 'host', NULL, NULL, v_case.shows_until, v_case.zone);
    EXCEPTION WHEN raise_exception THEN v_message := SQLERRM;
    END;
    IF v_message IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION 'S: % expected %, got %', to_jsonb(v_case), v_case.expected, v_message;
    END IF;
  END LOOP;

  -- The same day is still running in Pago Pago: accepted, and the zone is stored.
  v_row := public.admin_links_strip_save(NULL, v_pago, 'Pago Pago today', 'Featured', 'explorer', NULL, NULL, NULL, 'Pacific/Pago_Pago');
  IF v_row.time_zone IS DISTINCT FROM 'Pacific/Pago_Pago' OR v_row.shows_on <> v_pago THEN
    RAISE EXCEPTION 'S: saved strip wrong: %', to_jsonb(v_row);
  END IF;
  -- A future strip is accepted (scheduled), with named arguments as PostgREST sends them.
  v_again := public.admin_links_strip_save(p_id => NULL, p_shows_on => v_kiri + 2, p_title => 'Next week',
    p_label => 'New', p_opens => 'host', p_url => NULL, p_blog_post_id => NULL,
    p_shows_until => v_kiri + 4, p_time_zone => 'Europe/London');
  IF (SELECT strip.status FROM public.admin_links_strips_list() strip WHERE strip.id = v_again.id) <> 'scheduled' THEN
    RAISE EXCEPTION 'S: a future strip is not scheduled';
  END IF;
  -- An update changes the zone; moving Pago Pago's today to Kiritimati is refused (over there).
  v_message := NULL;
  BEGIN
    PERFORM public.admin_links_strip_save(v_row.id, v_pago, 'Pago Pago today', 'Featured', 'explorer', NULL, NULL, NULL, 'Pacific/Kiritimati');
  EXCEPTION WHEN raise_exception THEN v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'links_shows_on_invalid' THEN
    RAISE EXCEPTION 'S: re-zoning into an ended window was not refused (%)', v_message;
  END IF;
  v_again := public.admin_links_strip_save(v_row.id, v_lagos, 'Lagos now', 'Featured', 'explorer', NULL, NULL, v_lagos + 2, 'Africa/Lagos');
  IF v_again.time_zone <> 'Africa/Lagos' OR v_again.shows_until <> v_lagos + 2 OR v_again.position <> v_row.position THEN
    RAISE EXCEPTION 'S: update did not store the zone: %', to_jsonb(v_again);
  END IF;
  IF (SELECT strip.status FROM public.admin_links_strips_list() strip WHERE strip.id = v_row.id) <> 'live' THEN
    RAISE EXCEPTION 'S: the updated strip is not live';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ G: one overload, the column, grants ═══════════════════════════════════
DO $test$
BEGIN
  IF to_regprocedure('public.admin_links_strip_save(uuid,date,text,text,text,text,uuid,date)') IS NOT NULL
     OR to_regprocedure('public.admin_links_strip_save(uuid,date,text,text,text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'G: an old admin_links_strip_save signature still exists';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_links_strip_save') <> 1 THEN
    RAISE EXCEPTION 'G: more than one admin_links_strip_save overload';
  END IF;
  IF (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.links_strips'::regclass AND attname = 'time_zone') IS NOT TRUE
     OR EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                WHERE d.adrelid = 'public.links_strips'::regclass AND a.attname = 'time_zone') THEN
    RAISE EXCEPTION 'G: time_zone must be NOT NULL with no default';
  END IF;
  IF EXISTS (SELECT 1 FROM public.links_strips WHERE time_zone IS NULL) THEN
    RAISE EXCEPTION 'G: a strip has no zone';
  END IF;
  IF has_function_privilege('anon', 'public.admin_links_strip_save(uuid,date,text,text,text,text,uuid,date,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_links_strip_save(uuid,date,text,text,text,text,uuid,date,text)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.admin_links_strip_save(uuid,date,text,text,text,text,uuid,date,text)'::regprocedure)
     OR has_function_privilege('anon', 'public.admin_links_strips_list()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.links_page_strips()', 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.links_page_strips()'::regprocedure)
     OR NOT has_function_privilege('anon', 'public.links_strip_window(date,date,text)', 'EXECUTE')
     OR (SELECT prosecdef OR provolatile <> 'i' FROM pg_proc WHERE oid = 'public.links_strip_window(date,date,text)'::regprocedure) THEN
    RAISE EXCEPTION 'G: grants or security modes drifted';
  END IF;
  IF NOT has_column_privilege('anon', 'public.links_strips', 'time_zone', 'SELECT')
     OR has_column_privilege('anon', 'public.links_strips', 'created_by', 'SELECT') THEN
    RAISE EXCEPTION 'G: column grants wrong';
  END IF;
END
$test$;

-- ═══ C: the table refuses a zone Postgres cannot read (tester P2-2) ═══════
-- Before the CHECK, one such row made every reader error (22023) and blanked
-- /links and the Admin list. Direct writes (service role, SQL) are refused now.
DO $test$
DECLARE
  v_state text;
  v_zone text;
BEGIN
  FOREACH v_zone IN ARRAY ARRAY['Mars/Olympus', 'Not/A_Zone', '', '   '] LOOP
    v_state := NULL;
    BEGIN
      INSERT INTO public.links_strips (shows_on, time_zone, title, label, opens, position, is_published)
      VALUES ((now() AT TIME ZONE 'utc')::date, v_zone, 'Bad zone', 'New', 'host', 99, true);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_state = CONSTRAINT_NAME;
    END;
    IF v_state IS DISTINCT FROM 'links_strips_time_zone_valid' THEN
      RAISE EXCEPTION 'C: INSERT with zone % was not refused by the CHECK (%)', quote_literal(v_zone), v_state;
    END IF;
  END LOOP;
  v_state := NULL;
  BEGIN
    UPDATE public.links_strips SET time_zone = 'Mars/Olympus' WHERE id = '4339d000-0000-4000-9000-000000000001';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_state = CONSTRAINT_NAME;
  END;
  IF v_state IS DISTINCT FROM 'links_strips_time_zone_valid' THEN
    RAISE EXCEPTION 'C: UPDATE to Mars/Olympus was not refused (%)', v_state;
  END IF;
  IF NOT public.links_strip_time_zone_valid('Africa/Lagos') OR public.links_strip_time_zone_valid('Mars/Olympus')
     OR public.links_strip_time_zone_valid(NULL) THEN
    RAISE EXCEPTION 'C: links_strip_time_zone_valid answers wrong';
  END IF;
END
$test$;
-- The readers still answer after the refused writes.
SET LOCAL ROLE anon;
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.links_page_strips() strip WHERE strip.id = '4339d000-0000-4000-9000-000000000001') THEN
    RAISE EXCEPTION 'C: the reader lost the Lagos strip after the refused writes';
  END IF;
END
$test$;
RESET ROLE;
SELECT pg_temp.tz_act('4339d000-0000-4000-a000-000000000001');
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.admin_links_strips_list() strip WHERE strip.id::text LIKE '4339d000-%') < 9 THEN
    RAISE EXCEPTION 'C: the admin list does not answer after the refused writes';
  END IF;
END
$test$;
RESET ROLE;

SELECT 'issue_4339_links_strip_time_zone: W A S L G C passed' AS result;
ROLLBACK;
