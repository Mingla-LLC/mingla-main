\set ON_ERROR_STOP on

-- Issue #4130 (Wave 4b) — the place funnel, the feature flag board and the
-- owner's "restart the tour for everyone". Run after the full migration chain
-- on PostgreSQL 17; every case runs inside BEGIN … ROLLBACK.
--
--   C-01  Every new RPC exists, is SECURITY DEFINER with the admin guard first;
--         anon cannot run it.
--   C-02  The funnel counts active -> checked by Bouncer -> visible -> with
--         stored photos, every share of ACTIVE places (inactive places and the
--         backfill-failed photo marker never count), and per city.
--   C-03  A signed-in non-admin is refused by every RPC.
--   C-04  A flag changes only with a reason; each change writes one audit row
--         with who and why, which the board shows; asking for the state it
--         already has changes nothing and writes nothing; the board reads the
--         issue number out of the description.
--   C-05  Restarting the tour for everyone: an admin who is not the owner is
--         refused; the owner must type RESTART and give a reason; then every
--         account's tour restarts and one audit row is written.
--   C-06  Last active on Team and roles is the owner's to read: the later of a
--         teammate's last sign-in and last recorded admin action.
-- MINGLA-INVARIANT: I-4130-SYSTEM-PAGES-ADMIN-ONLY | issue #4130 | The place funnel and flag board are admin-only aggregates; a flag changes only through admin_set_feature_flag with a reason and an audit row; restarting the tour for everyone is owner-only, needs the typed word RESTART and a reason, and writes an audit row.

CREATE OR REPLACE FUNCTION pg_temp.w4b_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4130 wave 4b FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- Does running p_sql raise an error whose message contains p_token?
CREATE OR REPLACE FUNCTION pg_temp.w4b_refused(p_sql text, p_token text)
RETURNS boolean LANGUAGE plpgsql AS $a$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN position(p_token IN SQLERRM) > 0;
END
$a$;

BEGIN;
DO $c01$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_place_pool_funnel(text,uuid)',
    'public.admin_feature_flags_board()',
    'public.admin_set_feature_flag(text,boolean,text)',
    'public.admin_restart_tour_for_everyone(text,text)',
    'public.admin_team_last_active()'
  ] LOOP
    PERFORM pg_temp.w4b_assert(to_regprocedure(v_fn) IS NOT NULL, 'C-01 exists ' || v_fn);
    PERFORM pg_temp.w4b_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'C-01 anon cannot run ' || v_fn);
    PERFORM pg_temp.w4b_assert(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'C-01 signed-in may call ' || v_fn);
    PERFORM pg_temp.w4b_assert(
      (SELECT p.prosecdef AND p.prosrc ~ 'IF NOT public\.is_admin_user\(\) THEN RAISE EXCEPTION' FROM pg_proc p WHERE p.oid = v_fn::regprocedure),
      'C-01 definer + admin guard ' || v_fn);
  END LOOP;
END
$c01$;
ROLLBACK;

BEGIN;
DO $c02$
DECLARE
  v_admin    constant uuid := '41300000-0000-4000-a4b0-000000000001';
  v_outsider constant uuid := '41300000-0000-4000-a4b0-000000000002';
  v_city     constant uuid := '41300000-0000-4000-a4b0-000000000100';
  v_city2    constant uuid := '41300000-0000-4000-a4b0-000000000101';
  v jsonb;
  v_row jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_admin,    'w4b-admin@mingla-fixture.org'),
    (v_outsider, 'w4b-outsider@mingla-fixture.org');
  INSERT INTO public.admin_users(email, role, status) VALUES ('w4b-admin@mingla-fixture.org', 'admin', 'active');

  INSERT INTO public.seeding_cities(id, google_place_id, name, country, country_code, center_lat, center_lng,
                                    bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city,  'w4b-city-1', 'W4b Town',  'Fixtureland', 'FX', 1, 1, 0, 0, 2, 2),
         (v_city2, 'w4b-city-2', 'W4b Other', 'Fixtureland', 'FX', 5, 5, 4, 4, 6, 6);

  -- Six places in the first city:
  --   1 active, checked, visible, photos
  --   2 active, checked, visible, no photos
  --   3 active, checked, NOT visible (excluded), photos
  --   4 active, not yet checked, photos
  --   5 active, photo backfill failed (marker only) -> no photos
  --   6 INACTIVE, checked, visible, photos -> counts nowhere
  INSERT INTO public.place_pool(google_place_id, name, lat, lng, city_id, is_active, is_servable,
                                bouncer_validated_at, stored_photo_urls) VALUES
    ('w4b-p1', 'P1', 1, 1, v_city, true,  true,  now(), ARRAY['a.jpg']),
    ('w4b-p2', 'P2', 1, 1, v_city, true,  true,  now(), NULL),
    ('w4b-p3', 'P3', 1, 1, v_city, true,  false, now(), ARRAY['b.jpg']),
    ('w4b-p4', 'P4', 1, 1, v_city, true,  NULL,  NULL,  ARRAY['c.jpg']),
    ('w4b-p5', 'P5', 1, 1, v_city, true,  NULL,  NULL,  ARRAY['__backfill_failed__']),
    ('w4b-p6', 'P6', 1, 1, v_city, false, true,  now(), ARRAY['d.jpg']),
    ('w4b-q1', 'Q1', 5, 5, v_city2, true, true,  now(), ARRAY['e.jpg']);

  REFRESH MATERIALIZED VIEW public.admin_place_pool_mv;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  v := public.admin_place_pool_funnel(NULL, v_city);
  PERFORM pg_temp.w4b_assert((v ->> 'active')::int = 5, 'C-02 active places (inactive left out): ' || (v ->> 'active'));
  PERFORM pg_temp.w4b_assert((v ->> 'checked')::int = 3, 'C-02 checked by Bouncer: ' || (v ->> 'checked'));
  PERFORM pg_temp.w4b_assert((v ->> 'visible')::int = 2, 'C-02 Explorers can see: ' || (v ->> 'visible'));
  PERFORM pg_temp.w4b_assert((v ->> 'with_photos')::int = 3,
    'C-02 stored photos counted over ACTIVE places, marker excluded: ' || (v ->> 'with_photos'));
  PERFORM pg_temp.w4b_assert(jsonb_array_length(v -> 'cities') = 1, 'C-02 one city in a city scope');
  v_row := v -> 'cities' -> 0;
  PERFORM pg_temp.w4b_assert(v_row ->> 'city_name' = 'W4b Town' AND (v_row ->> 'visible')::int = 2, 'C-02 the city row carries the same counts');

  v := public.admin_place_pool_funnel('FX', NULL);
  PERFORM pg_temp.w4b_assert((v ->> 'active')::int = 6 AND jsonb_array_length(v -> 'cities') = 2,
    'C-02 a country scope adds up both cities');

  -- C-03: a signed-in person who is not on the admin team.
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused('SELECT public.admin_place_pool_funnel(NULL, NULL)', 'not_authorized'), 'C-03 funnel refuses a non-admin');
  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused('SELECT public.admin_feature_flags_board()', 'not_authorized'), 'C-03 board refuses a non-admin');
  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused($q$SELECT public.admin_set_feature_flag('x', true, 'r')$q$, 'not_authorized'), 'C-03 flag change refuses a non-admin');
  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused($q$SELECT public.admin_restart_tour_for_everyone('RESTART', 'r')$q$, 'not_authorized'), 'C-03 restart refuses a non-admin');
  RESET ROLE;
END
$c02$;
ROLLBACK;

BEGIN;
DO $c04$
DECLARE
  v_admin constant uuid := '41300000-0000-4000-a4b0-000000000001';
  v jsonb;
  v_flag jsonb;
  v_audits bigint;
  v_state boolean;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'w4b-admin@mingla-fixture.org');
  INSERT INTO public.admin_users(email, role, status) VALUES ('w4b-admin@mingla-fixture.org', 'admin', 'active');
  INSERT INTO public.feature_flags(flag_key, is_enabled, description)
  VALUES ('w4b_fixture_flag', false, 'Shows the fixture panel (#4130)');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused($q$SELECT public.admin_set_feature_flag('w4b_fixture_flag', true, '  ')$q$, 'reason_required'),
    'C-04 a change without a reason is refused');
  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused($q$SELECT public.admin_set_feature_flag('w4b_no_such_flag', true, 'why')$q$, 'not_found'),
    'C-04 an unknown flag is refused');

  v := public.admin_set_feature_flag('w4b_fixture_flag', true, 'Launching the fixture');
  PERFORM pg_temp.w4b_assert((v ->> 'changed')::boolean AND (v ->> 'is_enabled')::boolean, 'C-04 the flag is turned on');

  v := public.admin_set_feature_flag('w4b_fixture_flag', true, 'Again');
  PERFORM pg_temp.w4b_assert(NOT (v ->> 'changed')::boolean, 'C-04 asking for the state it has changes nothing');

  SELECT v_el INTO v_flag FROM jsonb_array_elements(public.admin_feature_flags_board()) v_el
   WHERE v_el ->> 'flag_key' = 'w4b_fixture_flag';
  PERFORM pg_temp.w4b_assert((v_flag ->> 'is_enabled')::boolean, 'C-04 the board shows it on');
  PERFORM pg_temp.w4b_assert(v_flag ->> 'issue' = '4130', 'C-04 the board reads the issue number: ' || COALESCE(v_flag ->> 'issue', 'null'));
  PERFORM pg_temp.w4b_assert(v_flag ->> 'last_changed_by' = 'w4b-admin@mingla-fixture.org', 'C-04 the board names who changed it');
  PERFORM pg_temp.w4b_assert(v_flag ->> 'last_reason' = 'Launching the fixture', 'C-04 the board shows why');
  RESET ROLE;

  SELECT f.is_enabled INTO v_state FROM public.feature_flags f WHERE f.flag_key = 'w4b_fixture_flag';
  PERFORM pg_temp.w4b_assert(v_state, 'C-04 the table holds the new state');
  SELECT count(*) INTO v_audits FROM public.admin_audit_log a
   WHERE a.target_type = 'feature_flag' AND a.target_id = 'w4b_fixture_flag';
  PERFORM pg_temp.w4b_assert(v_audits = 1, 'C-04 exactly one audit row (the no-op wrote none): ' || v_audits);
END
$c04$;
ROLLBACK;

BEGIN;
DO $c05$
DECLARE
  v_owner  constant uuid := '41300000-0000-4000-a4b0-000000000010';
  v_admin  constant uuid := '41300000-0000-4000-a4b0-000000000011';
  v_person constant uuid := '41300000-0000-4000-a4b0-000000000012';
  v jsonb;
  v_step integer;
  v_audits bigint;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner,  'w4b-owner@mingla-fixture.org'),
    (v_admin,  'w4b-admin2@mingla-fixture.org'),
    (v_person, 'w4b-person@mingla-fixture.org');
  INSERT INTO public.admin_users(email, role, status) VALUES
    ('w4b-owner@mingla-fixture.org',  'owner', 'active'),
    ('w4b-admin2@mingla-fixture.org', 'admin', 'active');
  INSERT INTO public.profiles(id, email, display_name, coach_mark_step)
  VALUES (v_person, 'w4b-person@mingla-fixture.org', 'W4b Person', 5)
  ON CONFLICT (id) DO UPDATE SET coach_mark_step = 5;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused($q$SELECT public.admin_restart_tour_for_everyone('RESTART', 'testing')$q$, 'owner_only'),
    'C-05 an admin who is not the owner is refused');

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused($q$SELECT public.admin_restart_tour_for_everyone('restart', 'testing')$q$, 'confirmation_required'),
    'C-05 the word must be typed exactly');
  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused($q$SELECT public.admin_restart_tour_for_everyone('RESTART', '')$q$, 'reason_required'),
    'C-05 a reason is required');

  v := public.admin_restart_tour_for_everyone('RESTART', 'New tour shipped');
  PERFORM pg_temp.w4b_assert((v ->> 'restarted')::int >= 1, 'C-05 accounts restarted: ' || (v ->> 'restarted'));
  RESET ROLE;

  SELECT p.coach_mark_step INTO v_step FROM public.profiles p WHERE p.id = v_person;
  PERFORM pg_temp.w4b_assert(v_step = 0, 'C-05 the fixture account starts the tour again');
  SELECT count(*) INTO v_audits FROM public.admin_audit_log a
   WHERE a.action = 'testing.restart_tour_for_everyone' AND a.reason = 'New tour shipped';
  PERFORM pg_temp.w4b_assert(v_audits = 1, 'C-05 one audit row with the reason');
END
$c05$;
ROLLBACK;

BEGIN;
DO $c06$
DECLARE
  v_owner constant uuid := '41300000-0000-4000-a4b0-000000000020';
  v_admin constant uuid := '41300000-0000-4000-a4b0-000000000021';
  v_row jsonb;
BEGIN
  INSERT INTO auth.users(id, email, last_sign_in_at) VALUES
    (v_owner, 'w4b-owner6@mingla-fixture.org', now()),
    (v_admin, 'w4b-admin6@mingla-fixture.org', now() - interval '3 days');
  INSERT INTO public.admin_users(email, role, status) VALUES
    ('w4b-owner6@mingla-fixture.org', 'owner', 'active'),
    ('w4b-admin6@mingla-fixture.org', 'admin', 'active');
  INSERT INTO public.admin_audit_log(admin_email, action, target_type, target_id, created_at)
  VALUES ('w4b-admin6@mingla-fixture.org', 'fixture.action', 'fixture', 'x', now() - interval '1 day');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.w4b_assert(pg_temp.w4b_refused('SELECT public.admin_team_last_active()', 'owner_only'),
    'C-06 an admin who is not the owner is refused');

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SELECT r INTO v_row FROM jsonb_array_elements(public.admin_team_last_active()) r
   WHERE r ->> 'email' = 'w4b-admin6@mingla-fixture.org';
  PERFORM pg_temp.w4b_assert(
    (v_row ->> 'last_active_at')::timestamptz > now() - interval '2 days',
    'C-06 last active is the later of sign-in (3 days) and last action (1 day)');
  RESET ROLE;
END
$c06$;
ROLLBACK;
