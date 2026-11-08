\set ON_ERROR_STOP on
-- #4318 follow-up: a /links strip can run until shows_until. Executable PostgreSQL 17 proof.
--
-- R  anon (reader and table) sees a strip through the end of shows_until when
--    set, else through the end of shows_on; a run that ended is hidden.
-- K  the table refuses shows_until before shows_on.
-- S  admin_links_strip_save takes p_shows_until (default NULL), validates it,
--    stores it, clears it, and still accepts the 7-argument call.
-- L  admin_links_strips_list returns shows_until and computes is_expired from it.
-- G  one save overload, the old signature gone, grants unchanged.
-- Runs after the full migration replay; every fixture rolls back.
BEGIN;

CREATE FUNCTION pg_temp.su_act(p_user uuid) RETURNS void LANGUAGE sql AS $function$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true),
         set_config('request.jwt.claims',
           CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$function$;
GRANT EXECUTE ON FUNCTION pg_temp.su_act(uuid) TO anon, authenticated;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('4318c000-0000-4000-a000-000000000002', 'issue4318-until-support@test.local', now());
INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue4318-until-support@test.local', 'growth', 'active', now());
INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('4318c000-0000-4000-a000-000000000002', true, false, 'staff');

-- Other suites' rows are irrelevant: everything below filters on these ids.
INSERT INTO public.links_strips (id, shows_on, shows_until, title, label, opens, position, is_published) VALUES
  ('4318c000-0000-4000-9000-000000000001', (now() AT TIME ZONE 'utc')::date - 5, (now() AT TIME ZONE 'utc')::date + 2, 'Running all week', 'New', 'host', 1, true),
  ('4318c000-0000-4000-9000-000000000002', (now() AT TIME ZONE 'utc')::date - 5, (now() AT TIME ZONE 'utc')::date - 2, 'Run is over', 'New', 'host', 2, true),
  ('4318c000-0000-4000-9000-000000000003', (now() AT TIME ZONE 'utc')::date - 1, NULL, 'One day, last day', 'New', 'host', 3, true),
  ('4318c000-0000-4000-9000-000000000004', (now() AT TIME ZONE 'utc')::date - 2, NULL, 'One day, gone', 'New', 'host', 4, true),
  ('4318c000-0000-4000-9000-000000000005', (now() AT TIME ZONE 'utc')::date - 1, (now() AT TIME ZONE 'utc')::date - 1, 'Ends yesterday (UTC)', 'New', 'host', 5, true);

-- ═══ R: what anon sees ════════════════════════════════════════════════════
SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_want uuid[] := ARRAY['4318c000-0000-4000-9000-000000000001', '4318c000-0000-4000-9000-000000000003',
                         '4318c000-0000-4000-9000-000000000005']::uuid[];
BEGIN
  IF (SELECT array_agg(strip.id ORDER BY strip.position) FROM public.links_page_strips() strip
      WHERE strip.id::text LIKE '4318c000-%') IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'R: reader rows wrong: %',
      (SELECT array_agg(strip.title ORDER BY strip.position) FROM public.links_page_strips() strip WHERE strip.id::text LIKE '4318c000-%');
  END IF;
  IF (SELECT array_agg(strip.id ORDER BY strip.position) FROM public.links_strips strip
      WHERE strip.id::text LIKE '4318c000-%') IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'R: RLS rows wrong';
  END IF;
  IF (SELECT strip.shows_until FROM public.links_page_strips() strip WHERE strip.id = '4318c000-0000-4000-9000-000000000001')
     IS DISTINCT FROM (now() AT TIME ZONE 'utc')::date + 2 THEN
    RAISE EXCEPTION 'R: reader does not return shows_until';
  END IF;
  IF (SELECT strip.shows_until FROM public.links_page_strips() strip WHERE strip.id = '4318c000-0000-4000-9000-000000000003') IS NOT NULL THEN
    RAISE EXCEPTION 'R: a one-day strip grew a shows_until';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ K: the table refuses an end before the start ══════════════════════════
DO $test$
DECLARE v_state text;
BEGIN
  BEGIN
    INSERT INTO public.links_strips (shows_on, shows_until, title, label, opens, position)
    VALUES (current_date, current_date - 1, 'Backwards', 'New', 'host', 0);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_state = CONSTRAINT_NAME;
  END;
  IF v_state IS DISTINCT FROM 'links_strips_shows_until_after_shows_on' THEN
    RAISE EXCEPTION 'K: shows_until before shows_on accepted (%)', v_state;
  END IF;
END
$test$;

-- ═══ S and L: the save RPC and the admin list ═════════════════════════════
SELECT pg_temp.su_act('4318c000-0000-4000-a000-000000000002');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_today constant date := (now() AT TIME ZONE 'utc')::date;
  v_case record;
  v_message text;
  v_row public.links_strips;
  v_again public.links_strips;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    (v_today, v_today - 1, 'links_shows_until_invalid'),       -- ends before it starts
    (v_today - 5, v_today - 2, 'links_shows_until_invalid'),   -- a run already over
    (v_today - 2, NULL::date, 'links_shows_on_invalid'),       -- one day, already over
    (NULL::date, v_today + 3, 'links_shows_on_invalid')        -- an end with no start
  ) AS c(shows_on, shows_until, expected) LOOP
    v_message := NULL;
    BEGIN
      PERFORM public.admin_links_strip_save(NULL, v_case.shows_on, 'Run', 'New', 'host', NULL, NULL, v_case.shows_until);
    EXCEPTION WHEN raise_exception THEN v_message := SQLERRM;
    END;
    IF v_message IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION 'S: % expected %, got %', to_jsonb(v_case), v_case.expected, v_message;
    END IF;
  END LOOP;

  -- A run that started last week and ends next week is valid and stored.
  v_row := public.admin_links_strip_save(NULL, v_today - 5, 'Festival week', 'Featured', 'explorer', NULL, NULL, v_today + 4);
  IF v_row.shows_on <> v_today - 5 OR v_row.shows_until IS DISTINCT FROM v_today + 4 THEN
    RAISE EXCEPTION 'S: run stored wrong: %', to_jsonb(v_row);
  END IF;
  -- Same start and end is a one-day run.
  v_again := public.admin_links_strip_save(NULL, v_today, 'Today only', 'New', 'host', NULL, NULL, v_today);
  IF v_again.shows_until IS DISTINCT FROM v_today THEN RAISE EXCEPTION 'S: same-day end refused'; END IF;

  -- The 7-argument call (every existing caller) still works and stores NULL.
  v_again := public.admin_links_strip_save(NULL, v_today, 'Old caller', 'New', 'host', NULL, NULL);
  IF v_again.shows_until IS NOT NULL THEN RAISE EXCEPTION 'S: the 7-argument call stored an end date'; END IF;
  -- Named arguments without p_shows_until (how PostgREST calls it) too.
  v_again := public.admin_links_strip_save(p_id => NULL, p_shows_on => v_today, p_title => 'Named caller',
    p_label => 'New', p_opens => 'host', p_url => NULL, p_blog_post_id => NULL);
  IF v_again.shows_until IS NOT NULL THEN RAISE EXCEPTION 'S: the named call stored an end date'; END IF;

  -- An update can clear the end date; the strip then runs on shows_on only.
  v_again := public.admin_links_strip_save(v_row.id, v_today, 'Festival week', 'Featured', 'explorer', NULL, NULL, NULL);
  IF v_again.shows_until IS NOT NULL OR v_again.position <> v_row.position THEN
    RAISE EXCEPTION 'S: clearing the end date failed: %', to_jsonb(v_again);
  END IF;
  -- And set it again on update.
  v_again := public.admin_links_strip_save(v_row.id, v_today, 'Festival week', 'Featured', 'explorer', NULL, NULL, v_today + 6);
  IF v_again.shows_until IS DISTINCT FROM v_today + 6 THEN RAISE EXCEPTION 'S: setting the end date on update failed'; END IF;

  -- L: the list carries shows_until and expiry follows the later day.
  IF (SELECT strip.shows_until FROM public.admin_links_strips_list() strip WHERE strip.id = v_row.id)
     IS DISTINCT FROM v_today + 6 THEN
    RAISE EXCEPTION 'L: list lost shows_until';
  END IF;
  IF (SELECT strip.is_expired FROM public.admin_links_strips_list() strip WHERE strip.id = '4318c000-0000-4000-9000-000000000001')
     OR NOT (SELECT strip.is_expired FROM public.admin_links_strips_list() strip WHERE strip.id = '4318c000-0000-4000-9000-000000000002')
     OR NOT (SELECT strip.is_expired FROM public.admin_links_strips_list() strip WHERE strip.id = '4318c000-0000-4000-9000-000000000004') THEN
    RAISE EXCEPTION 'L: is_expired ignores shows_until';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ G: one overload, grants unchanged ════════════════════════════════════
DO $test$
BEGIN
  IF to_regprocedure('public.admin_links_strip_save(uuid,date,text,text,text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'G: the old 7-argument signature still exists beside the new one';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_links_strip_save') <> 1 THEN
    RAISE EXCEPTION 'G: more than one admin_links_strip_save overload';
  END IF;
  IF has_function_privilege('anon', 'public.admin_links_strip_save(uuid,date,text,text,text,text,uuid,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_links_strip_save(uuid,date,text,text,text,text,uuid,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_links_strips_list()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.links_page_strips()', 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.links_page_strips()'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.admin_links_strip_save(uuid,date,text,text,text,text,uuid,date)'::regprocedure) THEN
    RAISE EXCEPTION 'G: grants or security mode drifted';
  END IF;
  IF NOT has_column_privilege('anon', 'public.links_strips', 'shows_until', 'SELECT')
     OR has_column_privilege('anon', 'public.links_strips', 'created_by', 'SELECT') THEN
    RAISE EXCEPTION 'G: column grants wrong';
  END IF;
END
$test$;

ROLLBACK;
