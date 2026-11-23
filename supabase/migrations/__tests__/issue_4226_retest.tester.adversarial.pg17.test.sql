\set ON_ERROR_STOP on

-- Issue #4226 RETEST adversarial suite (tester, independent of the implementor's
-- J-01..J-10 and of the first tester suite).
--   R-01  record_install_attribution end to end with the EXACT payload each app
--         builds ({ ...conversion, platform, app_id }) for a signed-in person with
--         NO device row: true + row created; repeat false; another person's id false
--         and untouched; missing platform / app_id raises; organic then media upgrade.
--   R-02  A signed-in non-admin cannot select / insert / update / delete person_journey
--         by any path (table, any view, any function that returns journey fields or
--         profile rows), and profiles / creator_accounts expose no journey field.
-- MINGLA-INVARIANT: I-4226-JOURNEY-PRIVATE-TABLE | issue #4226 | person_journey is readable and writable by no signed-in client path; profiles and creator_accounts carry no journey column.

CREATE TEMP TABLE t4226r_result(label text, ok boolean, detail text);
GRANT ALL ON t4226r_result TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.t4226r_check(p_ok boolean, p_label text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  INSERT INTO t4226r_result VALUES (p_label, COALESCE(p_ok, false), p_detail);
  IF COALESCE(p_ok, false) THEN RAISE NOTICE 'PASS  %', p_label;
  ELSE RAISE NOTICE 'FAIL  % %', p_label, COALESCE(p_detail, ''); END IF;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.t4226r_as(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', CASE WHEN p_uid IS NULL THEN 'anon' ELSE 'authenticated' END)::text, true);
END
$f$;

BEGIN;
DO $t$
DECLARE
  v_a  constant uuid := '42264000-0000-4000-a000-000000000011'; -- fresh Explorer, no device row
  v_b  constant uuid := '42264000-0000-4000-a000-000000000012'; -- fresh Host, no device row
  v_c  constant uuid := '42264000-0000-4000-a000-000000000013'; -- owns a device row used by others' tests
  v_d  constant uuid := '42264000-0000-4000-a000-000000000014'; -- non admin probe
  v_ret   boolean;
  v_msg   text;
  v_raised boolean;
  v_row   record;
  v_fn    record;
  v_cnt   int;
  -- exactly what the apps build: { ...conversion, platform, app_id }
  v_conv  jsonb := '{"af_status":"Non-organic","media_source":"tiktok_int","campaign":"launch","install_time":"2026-11-18 10:00:00.000","is_first_launch":true}'::jsonb;
BEGIN
  INSERT INTO auth.users(id, email, created_at)
  SELECT x.id, x.email, now() FROM (VALUES
    (v_a, 't4226r-a@mingla-fixture.org'), (v_b, 't4226r-b@mingla-fixture.org'),
    (v_c, 't4226r-c@mingla-fixture.org'), (v_d, 't4226r-d@mingla-fixture.org')) x(id, email);
  INSERT INTO public.profiles(id, email, display_name, created_at) VALUES
    (v_a, 't4226r-a@mingla-fixture.org', 'R A', now()), (v_b, 't4226r-b@mingla-fixture.org', 'R B', now()),
    (v_c, 't4226r-c@mingla-fixture.org', 'R C', now()), (v_d, 't4226r-d@mingla-fixture.org', 'R D', now());
  INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app) VALUES
    (v_c, 'af-r-c', 'ios', 'id99', 'consumer');
  INSERT INTO public.person_journey(user_id, signup_source) VALUES (v_c, 'friend_invite');

  ------------------------------------------------------------------ R-01
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226r_as(v_a);
  -- consumer app, iOS, no device row yet
  v_ret := public.record_install_attribution('af-r-a', 'consumer', v_conv || jsonb_build_object('platform', 'ios', 'app_id', 'id123456'));
  PERFORM pg_temp.t4226r_check(v_ret IS TRUE, 'R-01 first send with no device row returns true', v_ret::text);
  RESET ROLE;
  SELECT * INTO v_row FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-r-a';
  PERFORM pg_temp.t4226r_check(v_row.user_id = v_a AND v_row.app = 'consumer' AND v_row.platform = 'ios' AND v_row.app_id = 'id123456'
      AND v_row.media_source = 'tiktok_int' AND v_row.campaign = 'launch' AND v_row.af_status = 'Non-organic' AND v_row.install_time IS NOT NULL,
    'R-01 the device row was created with platform, app_id and the attribution', row_to_json(v_row)::text);
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_a);
  v_ret := public.record_install_attribution('af-r-a', 'consumer', v_conv || jsonb_build_object('platform', 'ios', 'app_id', 'id123456'));
  PERFORM pg_temp.t4226r_check(v_ret IS FALSE, 'R-01 second send returns false', v_ret::text);
  v_ret := public.record_install_attribution('af-r-a', 'consumer', '{"af_status":"Non-organic","media_source":"other","platform":"ios","app_id":"id123456"}'::jsonb);
  RESET ROLE;
  PERFORM pg_temp.t4226r_check(v_ret IS FALSE AND (SELECT media_source FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-r-a') = 'tiktok_int',
    'R-01 a later different media source never replaces the first');
  -- Host app, android
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_b);
  v_ret := public.record_install_attribution('af-r-b', 'business', v_conv || jsonb_build_object('platform', 'android', 'app_id', 'com.mingla.business'));
  RESET ROLE;
  PERFORM pg_temp.t4226r_check(v_ret IS TRUE AND EXISTS (SELECT 1 FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-r-b' AND user_id = v_b AND app = 'business' AND platform = 'android'),
    'R-01 Host app (android) creates its row');
  -- Another person's AppsFlyer id: false, row untouched, no row for the caller.
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_a);
  v_ret := public.record_install_attribution('af-r-c', 'consumer', '{"af_status":"Non-organic","media_source":"hijack","platform":"ios","app_id":"id1"}'::jsonb);
  RESET ROLE;
  PERFORM pg_temp.t4226r_check(v_ret IS FALSE
      AND NOT EXISTS (SELECT 1 FROM public.appsflyer_devices WHERE media_source = 'hijack')
      AND (SELECT count(*) FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-r-c') = 1
      AND (SELECT user_id FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-r-c') = v_c,
    'R-01 another person''s AppsFlyer id returns false and the row is untouched');
  -- Same person, other app, same id: false.
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_a);
  v_ret := public.record_install_attribution('af-r-a', 'business', v_conv || jsonb_build_object('platform', 'ios', 'app_id', 'id9'));
  RESET ROLE;
  PERFORM pg_temp.t4226r_check(v_ret IS FALSE AND (SELECT count(*) FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-r-a') = 1,
    'R-01 the same id from the other app returns false and creates nothing');
  -- Missing platform / app_id / junk platform raise (and write nothing).
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_d);
  FOREACH v_msg IN ARRAY ARRAY['{"af_status":"Non-organic","media_source":"x","app_id":"id1"}', '{"af_status":"Non-organic","media_source":"x","platform":"ios"}',
      '{"af_status":"Non-organic","media_source":"x","platform":"web","app_id":"id1"}', '{"af_status":"Non-organic","media_source":"x","platform":"","app_id":"id1"}'] LOOP
    v_raised := false;
    BEGIN PERFORM public.record_install_attribution('af-r-d', 'consumer', v_msg::jsonb);
    EXCEPTION WHEN others THEN v_raised := true; END;
    PERFORM pg_temp.t4226r_check(v_raised, 'R-01 raises: ' || left(v_msg, 70));
  END LOOP;
  RESET ROLE;
  PERFORM pg_temp.t4226r_check(NOT EXISTS (SELECT 1 FROM public.appsflyer_devices WHERE user_id = v_d), 'R-01 failed calls created no device row');
  -- Organic first, then a media source arrives: organic is upgraded (documented); then locked.
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_d);
  v_ret := public.record_install_attribution('af-r-d', 'consumer', '{"af_status":"Organic","platform":"ios","app_id":"id1"}'::jsonb);
  PERFORM pg_temp.t4226r_check(v_ret IS TRUE, 'R-01 organic first answer written');
  v_ret := public.record_install_attribution('af-r-d', 'consumer', '{"af_status":"Non-organic","media_source":"fb","platform":"ios","app_id":"id1"}'::jsonb);
  PERFORM pg_temp.t4226r_check(v_ret IS TRUE, 'R-01 organic upgraded by a media source');
  v_ret := public.record_install_attribution('af-r-d', 'consumer', '{"af_status":"Non-organic","media_source":"zz","platform":"ios","app_id":"id1"}'::jsonb);
  RESET ROLE;
  PERFORM pg_temp.t4226r_check(v_ret IS FALSE AND (SELECT media_source FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-r-d') = 'fb', 'R-01 then locked');
  -- the apps' later device registration upsert keeps the attribution
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_a);
  INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app, updated_at)
  VALUES (v_a, 'af-r-a', 'ios', 'id123456', 'consumer', now())
  ON CONFLICT (user_id, app, appsflyer_uid) DO UPDATE SET platform = EXCLUDED.platform, app_id = EXCLUDED.app_id, updated_at = EXCLUDED.updated_at;
  RESET ROLE;
  PERFORM pg_temp.t4226r_check((SELECT media_source FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-r-a') = 'tiktok_int', 'R-01 the later app device upsert keeps the attribution');
  -- anon
  SET LOCAL ROLE anon;
  v_raised := false;
  BEGIN PERFORM public.record_install_attribution('af-r-z', 'consumer', '{"platform":"ios","app_id":"x"}'::jsonb);
  EXCEPTION WHEN others THEN v_raised := true; END;
  RESET ROLE;
  PERFORM pg_temp.t4226r_check(v_raised, 'R-01 anon cannot call it');

  ------------------------------------------------------------------ R-02
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_d);
  FOR v_fn IN SELECT unnest(ARRAY[
      'SELECT * FROM public.person_journey', 'SELECT count(*) FROM public.person_journey',
      'SELECT signup_source FROM public.person_journey WHERE user_id = ''' || v_c || '''',
      'INSERT INTO public.person_journey(user_id, signup_source) VALUES (''' || v_d || ''', ''paid_ad'')',
      'UPDATE public.person_journey SET signup_source = ''x'' WHERE user_id = ''' || v_c || '''',
      'UPDATE public.person_journey SET signup_source = ''x''',
      'DELETE FROM public.person_journey', 'TRUNCATE public.person_journey',
      'INSERT INTO public.person_journey(user_id) VALUES (''' || v_d || ''') ON CONFLICT (user_id) DO UPDATE SET signup_source = ''x'' RETURNING *',
      'COPY public.person_journey TO STDOUT'
    ]) AS q LOOP
    v_raised := false; v_msg := NULL;
    BEGIN EXECUTE v_fn.q;
    EXCEPTION WHEN others THEN v_raised := true; v_msg := SQLERRM; END;
    PERFORM pg_temp.t4226r_check(v_raised, 'R-02 non-admin refused: ' || left(v_fn.q, 80), v_msg);
  END LOOP;
  RESET ROLE;
  PERFORM pg_temp.t4226r_check((SELECT signup_source FROM public.person_journey WHERE user_id = v_c) = 'friend_invite', 'R-02 the row was not changed');

  -- No view anywhere exposes journey fields to authenticated; no table other than person_journey has them
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('v','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
     AND pg_get_viewdef(c.oid) ~* '(person_journey|signup_source|onboarding_furthest|brand_setup_furthest|signup_surface)';
  PERFORM pg_temp.t4226r_check(v_cnt = 0, 'R-02 no view reads the journey fields', v_cnt::text);
  SELECT string_agg(table_schema || '.' || table_name || '.' || column_name, ', ') INTO v_msg FROM information_schema.columns
   WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_name <> 'person_journey'
     AND column_name ~ '^(signup_source|signup_source_detail|signup_surface|onboarding_furthest_step(_key|_at)?|brand_setup_furthest_step(_key|_at)?)$';
  PERFORM pg_temp.t4226r_check(v_msg IS NULL, 'R-02 profiles, creator_accounts and every other table carry no journey column', v_msg);
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_d);
  PERFORM pg_temp.t4226r_check((SELECT NOT (to_jsonb(p) ?| ARRAY['signup_source','signup_source_detail','signup_surface','onboarding_furthest_step','onboarding_furthest_step_key','onboarding_furthest_step_at'])
       FROM public.profiles p WHERE p.id = v_d), 'R-02 a profile row read as the person has no journey key');
  PERFORM pg_temp.t4226r_check((SELECT bool_and(NOT (to_jsonb(p) ?| ARRAY['signup_source','onboarding_furthest_step'])) FROM public.profiles p), 'R-02 every profile row the person can read has no journey key');
  v_raised := false;
  BEGIN PERFORM signup_source FROM public.profiles; EXCEPTION WHEN undefined_column THEN v_raised := true; END;
  PERFORM pg_temp.t4226r_check(v_raised, 'R-02 selecting signup_source from profiles is an undefined column');
  -- every function that returns those fields or whole profile rows is refused to a non-admin
  RESET ROLE;
  FOR v_fn IN SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND (pg_get_function_result(p.oid) ~* '(signup_source|onboarding_furthest|brand_setup_furthest|signup_surface)'
            OR p.prorettype IN ('public.profiles'::regtype, 'public.creator_accounts'::regtype, 'public.person_journey'::regtype)
            OR p.proname ~ '^admin_people_|^admin_person_|^admin_get_person')
       -- #3969 step 2: get_my_profile returns only the caller's own row; checked below.
       AND p.proname <> 'get_my_profile'
       AND has_function_privilege('authenticated', p.oid, 'execute') LOOP
    v_raised := false; v_msg := NULL;
    SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_d);
    BEGIN
      IF v_fn.proname = 'admin_people_filter_check' THEN
        v_raised := true; v_msg := 'input validator, no data (checked by the first tester)';
      ELSIF v_fn.args = '' THEN EXECUTE format('SELECT * FROM public.%I()', v_fn.proname);
      ELSIF v_fn.args IN ('p_filter jsonb', 'p_filters jsonb', 'p_named jsonb') THEN EXECUTE format('SELECT * FROM public.%I(%L::jsonb)', v_fn.proname, '{}');
      ELSIF v_fn.args = 'p_key text' THEN EXECUTE format('SELECT * FROM public.%I(%L)', v_fn.proname, 'x');
      ELSIF v_fn.args = 'p_user_id uuid' THEN EXECUTE format('SELECT * FROM public.%I(%L::uuid)', v_fn.proname, v_c);
      ELSIF v_fn.args = 'p_user_ids uuid[], p_query text' THEN EXECUTE format('SELECT * FROM public.%I(%L::uuid[], %L)', v_fn.proname, ARRAY[v_c]::text, 'x');
      ELSE v_raised := true; v_msg := 'SKIPPED UNKNOWN ARGS ' || v_fn.args; END IF;
    EXCEPTION WHEN others THEN v_raised := true; v_msg := SQLERRM; END;
    RESET ROLE;
    PERFORM pg_temp.t4226r_check(v_raised AND v_msg NOT LIKE 'SKIPPED%', 'R-02 non-admin refused by function ' || v_fn.proname || '(' || v_fn.args || ')', v_msg);
  END LOOP;
  -- #3969 step 2: the own-profile read returns the caller's row only, with no journey key.
  SET LOCAL ROLE authenticated; PERFORM pg_temp.t4226r_as(v_d);
  PERFORM pg_temp.t4226r_check((SELECT COALESCE(bool_and(g.id = v_d AND NOT (to_jsonb(g) ?| ARRAY['signup_source','signup_source_detail','signup_surface','onboarding_furthest_step','onboarding_furthest_step_key','onboarding_furthest_step_at'])), true)
       FROM public.get_my_profile() g), 'R-02 get_my_profile returns only the caller''s row and no journey key');
  RESET ROLE;

  SELECT string_agg(label || COALESCE(' :: ' || detail, ''), E'\n') INTO v_msg FROM t4226r_result WHERE NOT ok;
  IF v_msg IS NOT NULL THEN RAISE EXCEPTION 'issue #4226 retest adversarial FAIL:%', E'\n' || v_msg; END IF;
  RAISE NOTICE 'issue #4226 retest adversarial: % checks PASS', (SELECT count(*) FROM t4226r_result);
END
$t$;
ROLLBACK;
