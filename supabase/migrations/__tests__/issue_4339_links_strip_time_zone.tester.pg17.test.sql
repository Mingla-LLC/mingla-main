\set ON_ERROR_STOP on
-- #4339 tester (adversarial): a /links strip shows only within its dates, in
-- its own time zone. A different angle from the implementor's suite:
--
-- T1 the window never depends on the session TimeZone (PostgREST, psql or a
--    cron can run with any setting), across 6 session zones.
-- T2 clock changes the implementor's suite does not cover: the New York
--    fall-back day (25 hours), zones whose clocks jump AT midnight
--    (America/Santiago, Asia/Beirut: the day starts at 01:00), a 30-minute
--    change (Australia/Lord_Howe) and a 45-minute offset (Asia/Kathmandu).
-- T3 a sweep of 12 zones x 9 start days around today: the reader, the anon
--    table policy and the admin status agree for every strip, and no row the
--    reader returns is outside its window, under two session zones.
-- T4 zone spellings the save must refuse (padded, offset strings, POSIX
--    strings with a sign) and the old Admin call (8 named args, no zone).
-- T5 who may call what: anon executes no admin RPC; a signed-in non-staff
--    user is refused by list and save; the window helper is pure.
-- FAILS-ON-REVERT: without 20280708004339 every block fails (no
-- links_strip_window, no time_zone column, no 9-argument save).
-- Runs after the full migration replay; every fixture rolls back.
BEGIN;

CREATE FUNCTION pg_temp.tzt_act(p_user uuid) RETURNS void LANGUAGE sql AS $function$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true),
         set_config('request.jwt.claims',
           CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$function$;
GRANT EXECUTE ON FUNCTION pg_temp.tzt_act(uuid) TO anon, authenticated;

-- ═══ T1: the session TimeZone changes nothing ══════════════════════════════
DO $test$
DECLARE
  v_zone text;
  v_want tstzrange := tstzrange('2026-11-15 23:00:00+00', '2026-11-28 23:00:00+00', '[)');
BEGIN
  FOREACH v_zone IN ARRAY ARRAY['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York', 'Asia/Kathmandu', 'Africa/Lagos'] LOOP
    PERFORM set_config('TimeZone', v_zone, true);
    IF public.links_strip_window('2026-11-16', '2026-11-28', 'Africa/Lagos') IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION 'T1: session zone % moved the Lagos window to %', v_zone,
        public.links_strip_window('2026-11-16', '2026-11-28', 'Africa/Lagos');
    END IF;
  END LOOP;
  PERFORM set_config('TimeZone', 'UTC', true);
END
$test$;

-- ═══ T2: clock changes and odd offsets ═════════════════════════════════════
DO $test$
DECLARE
  v_case record;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    -- Sun 1 Nov 2026: New York falls back at 02:00 (EDT -4 -> EST -5); the day is 25 hours.
    ('new york fall-back', '2026-11-01'::date, NULL::date, 'America/New_York', '2026-11-01 04:00:00+00'::timestamptz, '2026-11-02 05:00:00+00'::timestamptz),
    -- Sun 6 Sep 2026: Chile springs forward at 24:00, so 00:00 does not exist; the day starts 01:00 (-03).
    ('santiago no-midnight', '2026-09-06', NULL, 'America/Santiago', '2026-09-06 04:00:00+00', '2026-09-07 03:00:00+00'),
    -- Sun 29 Mar 2026: Beirut springs forward at 00:00; the day starts 01:00 (+03).
    ('beirut no-midnight', '2026-03-29', NULL, 'Asia/Beirut', '2026-03-28 22:00:00+00', '2026-03-29 21:00:00+00'),
    -- Sun 4 Oct 2026: Lord Howe moves 30 minutes (+10:30 -> +11) at 02:00.
    ('lord howe half-hour', '2026-10-04', NULL, 'Australia/Lord_Howe', '2026-10-03 13:30:00+00', '2026-10-04 13:00:00+00'),
    -- Kathmandu is +05:45 all year.
    ('kathmandu +5:45', '2026-11-16', '2026-11-17', 'Asia/Kathmandu', '2026-11-15 18:15:00+00', '2026-11-17 18:15:00+00'),
    -- Kiritimati (+14) and Pago Pago (-11): the same calendar day, 25 hours apart.
    ('kiritimati', '2026-11-16', NULL, 'Pacific/Kiritimati', '2026-11-15 10:00:00+00', '2026-11-16 10:00:00+00'),
    ('pago pago', '2026-11-16', NULL, 'Pacific/Pago_Pago', '2026-11-16 11:00:00+00', '2026-11-17 11:00:00+00')
  ) AS c(label, shows_on, shows_until, zone, starts_at, ends_at) LOOP
    IF public.links_strip_window(v_case.shows_on, v_case.shows_until, v_case.zone)
       IS DISTINCT FROM tstzrange(v_case.starts_at, v_case.ends_at, '[)') THEN
      RAISE EXCEPTION 'T2: % window %, want [%, %)', v_case.label,
        public.links_strip_window(v_case.shows_on, v_case.shows_until, v_case.zone), v_case.starts_at, v_case.ends_at;
    END IF;
    -- One microsecond before the start is out, the start is in, the end is out.
    IF public.links_strip_window(v_case.shows_on, v_case.shows_until, v_case.zone) @> (v_case.starts_at - interval '1 microsecond')
       OR NOT public.links_strip_window(v_case.shows_on, v_case.shows_until, v_case.zone) @> v_case.starts_at
       OR NOT public.links_strip_window(v_case.shows_on, v_case.shows_until, v_case.zone) @> (v_case.ends_at - interval '1 microsecond')
       OR public.links_strip_window(v_case.shows_on, v_case.shows_until, v_case.zone) @> v_case.ends_at THEN
      RAISE EXCEPTION 'T2: % boundary instants wrong', v_case.label;
    END IF;
  END LOOP;
END
$test$;

-- ═══ Fixtures: one staff member, one signed-in non-staff user ══════════════
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('4339e000-0000-4000-a000-000000000001', 'issue4339-tester-staff@test.local', now()),
  ('4339e000-0000-4000-a000-000000000002', 'issue4339-tester-member@test.local', now());
INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue4339-tester-staff@test.local', 'growth', 'active', now());
INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('4339e000-0000-4000-a000-000000000001', true, false, 'staff');

-- ═══ T3: a sweep around today ══════════════════════════════════════════════
-- 12 zones x start days today-4 .. today+4 (UTC calendar), one- and three-day strips.
DELETE FROM public.links_strips;
INSERT INTO public.links_strips (shows_on, shows_until, time_zone, title, label, opens, position, is_published)
SELECT (now() AT TIME ZONE 'UTC')::date + d, CASE WHEN d % 2 = 0 THEN NULL ELSE (now() AT TIME ZONE 'UTC')::date + d + 2 END,
       z, left('Sweep ' || z || ' ' || d, 60), 'New', 'host', row_number() OVER (), true
FROM unnest(ARRAY['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Pacific/Chatham', 'Asia/Kathmandu', 'Asia/Kolkata', 'Africa/Lagos',
                  'Europe/London', 'America/New_York', 'America/St_Johns', 'America/Santiago', 'Australia/Lord_Howe', 'UTC']) AS z
CROSS JOIN generate_series(-4, 4) AS d;

CREATE TEMP TABLE tzt_policy (id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tzt_reader (id uuid PRIMARY KEY, starts_at timestamptz, ends_at timestamptz) ON COMMIT DROP;
GRANT ALL ON tzt_policy, tzt_reader TO anon, authenticated;

SET LOCAL ROLE anon;
SELECT pg_temp.tzt_act(NULL);
SET LOCAL TimeZone = 'Pacific/Kiritimati';
INSERT INTO tzt_policy SELECT id FROM public.links_strips;
INSERT INTO tzt_reader SELECT id, starts_at, ends_at FROM public.links_page_strips();
SET LOCAL TimeZone = 'Pacific/Pago_Pago';
DO $test$
BEGIN
  -- The same answer under the opposite session zone.
  IF (SELECT array_agg(id ORDER BY id) FROM public.links_page_strips())
     IS DISTINCT FROM (SELECT array_agg(id ORDER BY id) FROM tzt_reader) THEN
    RAISE EXCEPTION 'T3: the reader changed with the session zone';
  END IF;
  IF (SELECT array_agg(id ORDER BY id) FROM public.links_strips)
     IS DISTINCT FROM (SELECT array_agg(id ORDER BY id) FROM tzt_policy) THEN
    RAISE EXCEPTION 'T3: the table policy changed with the session zone';
  END IF;
  IF EXISTS (SELECT 1 FROM tzt_reader WHERE NOT (starts_at <= now() AND now() < ends_at)) THEN
    RAISE EXCEPTION 'T3: the reader returned a strip outside its window';
  END IF;
  IF (SELECT array_agg(id ORDER BY id) FROM tzt_reader) IS DISTINCT FROM (SELECT array_agg(id ORDER BY id) FROM tzt_policy) THEN
    RAISE EXCEPTION 'T3: the reader and the table policy disagree';
  END IF;
  IF (SELECT count(*) FROM tzt_reader) = 0 OR (SELECT count(*) FROM tzt_reader) = 108 THEN
    RAISE EXCEPTION 'T3: the sweep is degenerate (% live of 108)', (SELECT count(*) FROM tzt_reader);
  END IF;
END
$test$;
RESET ROLE;
SET LOCAL TimeZone = 'UTC';

SET LOCAL ROLE authenticated;
SELECT pg_temp.tzt_act('4339e000-0000-4000-a000-000000000001');
DO $test$
DECLARE
  v_bad jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('title', list.title, 'status', list.status))
  INTO v_bad
  FROM public.admin_links_strips_list() list
  LEFT JOIN tzt_reader reader ON reader.id = list.id
  WHERE (list.status = 'live') IS DISTINCT FROM (reader.id IS NOT NULL)
     OR (list.status = 'scheduled') IS DISTINCT FROM (list.starts_at > now())
     OR (list.status = 'ended') IS DISTINCT FROM (list.ends_at <= now())
     OR list.status NOT IN ('scheduled', 'live', 'ended');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T3: admin status disagrees with what anon can read: %', v_bad;
  END IF;
  IF (SELECT count(DISTINCT status) FROM public.admin_links_strips_list()) <> 3 THEN
    RAISE EXCEPTION 'T3: the sweep did not produce all three statuses';
  END IF;
END
$test$;

-- ═══ T4: zone spellings and the old Admin call ═════════════════════════════
DO $test$
DECLARE
  v_case record;
  v_message text;
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES (' Africa/Lagos'), ('Africa/Lagos '), ('Africa//Lagos'), ('UTC+1'), ('+01:00'), ('-05'),
                                      ('GMT+01:00'), ('Africa/Lagos;'), ('AFRICA/LAGOS'), ('Europe/Kyiv%')) AS c(zone) LOOP
    v_message := NULL;
    BEGIN
      PERFORM public.admin_links_strip_save(NULL, v_today, 'Spelling', 'New', 'host', NULL, NULL, NULL, v_case.zone);
    EXCEPTION WHEN raise_exception THEN v_message := SQLERRM;
    END;
    IF v_message IS DISTINCT FROM 'links_time_zone_invalid' THEN
      RAISE EXCEPTION 'T4: zone % expected links_time_zone_invalid, got %', quote_literal(v_case.zone), quote_nullable(v_message);
    END IF;
  END LOOP;

  -- The pre-#4339 Admin sends 8 named arguments; PostgREST resolves them to
  -- the one 9-argument save, which must refuse rather than guess a zone.
  v_message := NULL;
  BEGIN
    PERFORM public.admin_links_strip_save(p_id => NULL, p_shows_on => v_today, p_title => 'Old Admin', p_label => 'New',
      p_opens => 'host', p_url => NULL, p_blog_post_id => NULL, p_shows_until => NULL);
  EXCEPTION WHEN raise_exception THEN v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'links_time_zone_invalid' THEN
    RAISE EXCEPTION 'T4: the old Admin call was not refused (%)', quote_nullable(v_message);
  END IF;

  -- A strip that ends at this very instant is over: the boundary is exclusive.
  IF NOT EXISTS (SELECT 1 FROM public.admin_links_strips_list() WHERE status = 'ended') THEN
    RAISE EXCEPTION 'T4: no ended strip to compare';
  END IF;
  IF (SELECT count(*) FROM public.links_strips WHERE title = 'Old Admin' OR title = 'Spelling') <> 0 THEN
    RAISE EXCEPTION 'T4: a refused save wrote a row';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ T5: who may call what ═════════════════════════════════════════════════
DO $test$
BEGIN
  IF has_function_privilege('anon', 'public.admin_links_strips_list()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_links_strip_save(uuid,date,text,text,text,text,uuid,date,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_links_strip_delete(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_links_strips_reorder(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'T5: anon can execute an admin links RPC';
  END IF;
  IF NOT has_function_privilege('anon', 'public.links_page_strips()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.links_strip_window(date,date,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T5: anon lost the public reader or the window helper';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.links_strip_window(date,date,text)'::regprocedure) <> 'i'
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.links_strip_window(date,date,text)'::regprocedure)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.links_page_strips()'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.links_strip_window(date,date,text)'::regprocedure
                    AND 'search_path=""' = ANY (proconfig)) THEN
    RAISE EXCEPTION 'T5: links_strip_window / links_page_strips security shape drifted';
  END IF;
  IF has_column_privilege('anon', 'public.links_strips', 'created_by', 'SELECT')
     OR has_table_privilege('anon', 'public.links_strips', 'INSERT')
     OR has_table_privilege('anon', 'public.links_strips', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.links_strips', 'UPDATE') THEN
    RAISE EXCEPTION 'T5: anon or authenticated gained a write or a private column';
  END IF;
END
$test$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.tzt_act('4339e000-0000-4000-a000-000000000002');
DO $test$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM count(*) FROM public.admin_links_strips_list();
  EXCEPTION WHEN insufficient_privilege THEN v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'links_forbidden' THEN
    RAISE EXCEPTION 'T5: a non-staff user listed the strips (%)', quote_nullable(v_message);
  END IF;
  v_message := NULL;
  BEGIN
    PERFORM public.admin_links_strip_save(NULL, (now() AT TIME ZONE 'UTC')::date + 1, 'Member', 'New', 'host', NULL, NULL, NULL, 'UTC');
  EXCEPTION WHEN insufficient_privilege THEN v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'links_forbidden' THEN
    RAISE EXCEPTION 'T5: a non-staff user saved a strip (%)', quote_nullable(v_message);
  END IF;
END
$test$;
RESET ROLE;

SELECT 'issue_4339_links_strip_time_zone.tester: T1 T2 T3 T4 T5 passed' AS result;
ROLLBACK;
