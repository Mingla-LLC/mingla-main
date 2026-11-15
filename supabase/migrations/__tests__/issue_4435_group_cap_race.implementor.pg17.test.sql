-- #4435 W3c (spec part 3 §7, adversarial "concurrent adds racing the cap"):
-- two members add a friend each at the same moment to a group that holds 14
-- of 15. add_group_members locks the session row (FOR UPDATE OF cs) before it
-- counts, so the second call waits for the first to commit, then counts 15
-- and is refused with conflict_group_full: the cap holds, no partial add.
--
-- Real two-session test (dblink, the #4402 pattern), so fixtures are
-- committed in an isolated UUID namespace and removed at the end.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;

-- A run cut short leaves committed fixtures: clear the namespace first.
DO $preclean$
BEGIN
  ALTER TABLE public.collaboration_sessions ENABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  DELETE FROM public.collaboration_sessions WHERE id = '44350c00-0000-4000-8000-0000000000aa';
  DELETE FROM public.friends WHERE user_id::text LIKE '44350c00-%' OR friend_user_id::text LIKE '44350c00-%';
  DELETE FROM public.profiles WHERE id::text LIKE '44350c00-%';
  DELETE FROM auth.users WHERE id::text LIKE '44350c00-%';
END;
$preclean$;


DO $setup$
DECLARE
  v_owner uuid := '44350c00-0000-4000-8000-000000000001';
  v_member uuid := '44350c00-0000-4000-8000-000000000002';
  v_f1 uuid := '44350c00-0000-4000-8000-000000000003';
  v_f2 uuid := '44350c00-0000-4000-8000-000000000004';
  v_session uuid := '44350c00-0000-4000-8000-0000000000aa';
  v_id uuid;
  i int;
BEGIN
  FOR i IN 1..16 LOOP
    v_id := ('44350c00-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid;
    INSERT INTO auth.users(id, email) VALUES (v_id, 'issue-4435-race-filler-' || i || '@test.local');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'issue-4435-race-filler-' || i || '@test.local', 'Filler' || i, 'Filler' || i)
      ON CONFLICT (id) DO NOTHING;
  END LOOP;
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'issue-4435-race-owner@test.local'), (v_member, 'issue-4435-race-member@test.local'),
    (v_f1, 'issue-4435-race-f1@test.local'), (v_f2, 'issue-4435-race-f2@test.local');
  INSERT INTO public.profiles(id, email, first_name, display_name) VALUES
    (v_owner, 'issue-4435-race-owner@test.local', 'Owner', 'Owner'),
    (v_member, 'issue-4435-race-member@test.local', 'Member', 'Member'),
    (v_f1, 'issue-4435-race-f1@test.local', 'Fone', 'Fone'),
    (v_f2, 'issue-4435-race-f2@test.local', 'Ftwo', 'Ftwo')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (v_owner, v_f1, 'accepted'), (v_f1, v_owner, 'accepted'),
    (v_member, v_f2, 'accepted'), (v_f2, v_member, 'accepted');
  INSERT INTO public.collaboration_sessions(id, name, created_by, status)
    VALUES (v_session, 'issue 4435 race', v_owner, 'active');
  -- 14 accepted: the owner, the member and 12 fillers.
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at) VALUES
    (v_session, v_owner, true, now() - interval '20 minutes'),
    (v_session, v_member, true, now() - interval '19 minutes');
  FOR i IN 1..12 LOOP
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at)
      VALUES (v_session, ('44350c00-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, true,
              now() - make_interval(mins => 18 - i));
  END LOOP;
  IF (SELECT count(*) FROM public.session_participants WHERE session_id = v_session AND has_accepted) <> 14 THEN
    RAISE EXCEPTION '#4435 race setup: expected 14 accepted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE session_id = v_session AND linked_entity_type = 'session') THEN
    RAISE EXCEPTION '#4435 race setup: the session group chat was not created';
  END IF;
END;
$setup$;

-- This image has no realtime.send (the session broadcast trigger calls it).
-- The two dblink sessions need committed state, so the trigger is switched
-- off here and always switched back on in the cleanup below.
DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

CREATE TEMP TABLE issue_4435_race_result(verdict text);

DO $race$
DECLARE
  -- TCP loopback: the image trusts 127.0.0.1 (see #4402).
  v_conn text := format('dbname=%L user=%L host=127.0.0.1 port=%L', current_database(), current_user,
    current_setting('port'));
  v_session uuid := '44350c00-0000-4000-8000-0000000000aa';
  v_conv uuid;
  v_owner_claims text := json_build_object('sub', '44350c00-0000-4000-8000-000000000001', 'role', 'authenticated')::text;
  v_member_claims text := json_build_object('sub', '44350c00-0000-4000-8000-000000000002', 'role', 'authenticated')::text;
  v_a text; v_b text; v_b_error text; v_held boolean; v_b_rows int;
  v_accepted int;
BEGIN
  SELECT id INTO v_conv FROM public.conversations WHERE session_id = v_session AND linked_entity_type = 'session';
  PERFORM dblink_connect('issue4435_a', v_conn);
  PERFORM dblink_connect('issue4435_b', v_conn);
  -- A (the owner) adds F1 and keeps its one-statement transaction open for 1 s.
  PERFORM dblink_send_query('issue4435_a', format($q$
    SELECT public.add_group_members(%L, ARRAY['44350c00-0000-4000-8000-000000000003']::uuid[])::text,
           (pg_sleep(1) IS NULL)
      FROM (SELECT set_config('request.jwt.claim.sub', '44350c00-0000-4000-8000-000000000001', true),
                   set_config('request.jwt.claims', %L, true)) claims
  $q$, v_conv, v_owner_claims));
  PERFORM pg_sleep(0.2);
  -- B (another accepted member) adds F2 while A is still open.
  PERFORM dblink_send_query('issue4435_b', format($q$
    SELECT public.add_group_members(%L, ARRAY['44350c00-0000-4000-8000-000000000004']::uuid[])::text
      FROM (SELECT set_config('request.jwt.claim.sub', '44350c00-0000-4000-8000-000000000002', true),
                   set_config('request.jwt.claims', %L, true)) claims
  $q$, v_conv, v_member_claims));
  PERFORM pg_sleep(0.2);
  IF dblink_is_busy('issue4435_b') <> 1 THEN
    RAISE EXCEPTION '#4435 RACE FAIL: the second add did not wait for the first (no session lock)';
  END IF;
  SELECT answer, held INTO v_a, v_held FROM dblink_get_result('issue4435_a') AS t(answer text, held boolean);
  SELECT count(*) INTO v_b_rows FROM dblink_get_result('issue4435_b', false) AS t(answer text);
  v_b_error := dblink_error_message('issue4435_b');
  PERFORM dblink_disconnect('issue4435_a');
  PERFORM dblink_disconnect('issue4435_b');

  SELECT count(*) INTO v_accepted FROM public.session_participants WHERE session_id = v_session AND has_accepted;
  IF v_a IS NULL OR (v_a::jsonb -> 'added') IS DISTINCT FROM '["44350c00-0000-4000-8000-000000000003"]'::jsonb THEN
    RAISE EXCEPTION '#4435 RACE FAIL: the first add did not land: %', v_a;
  END IF;
  IF v_b_rows <> 0 OR v_b_error NOT LIKE '%conflict_group_full%' THEN
    RAISE EXCEPTION '#4435 RACE FAIL: the concurrent second add was not refused at the cap (rows %, error %)', v_b_rows, v_b_error;
  END IF;
  IF v_accepted <> 15 THEN
    RAISE EXCEPTION '#4435 RACE FAIL: the cap did not hold: % accepted', v_accepted;
  END IF;
  IF EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_session
              AND user_id = '44350c00-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION '#4435 RACE FAIL: the refused add left a partial member';
  END IF;
  INSERT INTO issue_4435_race_result VALUES ('PASS');
EXCEPTION WHEN OTHERS THEN
  -- Recorded, not raised: the cleanup below must always run.
  INSERT INTO issue_4435_race_result VALUES (SQLERRM);
  PERFORM dblink_disconnect(name) FROM unnest(dblink_get_connections()) AS name;
END;
$race$;

-- Committed fixtures out (the session first: its chat, rows and seats go with it).
DO $cleanup$
BEGIN
  ALTER TABLE public.collaboration_sessions ENABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  DELETE FROM public.collaboration_sessions WHERE id = '44350c00-0000-4000-8000-0000000000aa';
  DELETE FROM public.friends WHERE user_id::text LIKE '44350c00-%' OR friend_user_id::text LIKE '44350c00-%';
  DELETE FROM public.profiles WHERE id::text LIKE '44350c00-%';
  DELETE FROM auth.users WHERE id::text LIKE '44350c00-%';
END;
$cleanup$;
DO $verdict$
DECLARE v text := (SELECT verdict FROM issue_4435_race_result LIMIT 1);
BEGIN
  IF v IS DISTINCT FROM 'PASS' THEN RAISE EXCEPTION '%', coalesce(v, '#4435 RACE FAIL: no verdict'); END IF;
  RAISE NOTICE '#4435 RACE PASS: two concurrent adds at 14 of 15: one in, one refused, 15 accepted';
END;
$verdict$;
\echo 'issue #4435 concurrent adds against the 15 cap passed'
