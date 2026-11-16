\set ON_ERROR_STOP on

-- #4435 / #4436 last follow-up: regression suite for
-- 20280710004435_issue_4435_leftovers.sql. Runs on the fully replayed PG17
-- schema; everything rolls back.
--
-- MINGLA-INVARIANT: I-4435-CREATOR-PASSES-ON-LEAVE | issue #4435 | when the creator leaves a group that carries on, by any path, the creator's role passes to the member who takes over, who is an admin; a returning old creator is an ordinary member; a group with no accepted member left is deleted and 1:1 plans keep their rule (L-PASS, L-OWN-ROW, L-HALF, L-DM)
-- MINGLA-INVARIANT: I-4435-ONE-HEIR-RULE | issue #4435 | one function picks who takes over: the longest-standing admin, else the longest-standing member (join time, row age, user id) (L-HEIR, L-LAST-ADMIN)
-- MINGLA-INVARIANT: I-4436-UNUSED-GROUP-FIELDS-SERVER-ONLY | issue #4436 | app clients cannot change is_active, archived_at, participant_prefs, deck_version or deck_params_hash; the fields the live apps write still work and server functions are unaffected (L-FIELDS)
-- MINGLA-INVARIANT: I-4435-ACCEPT-SIGNED-IN-ONLY | issue #4435 | accept_session_with_prefs is not executable without signing in (L-GRANT)
-- MINGLA-INVARIANT: I-4435-SOCIAL-REALTIME-PUBLISHED-ONLY | issue #4435 | the app's social realtime channels bind only tables in supabase_realtime (L-REALTIME)
-- MINGLA-INVARIANT: I-4435-SESSION-NOTICE-CHECK | issue #4435 | the session notice check counts members and people who left in the last 10 minutes; a sender must have been accepted and, if gone, have left on their own (never removed); service-role only (L-NOTICE)

BEGIN;

DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

DELETE FROM public.app_config WHERE config_key = 'global_plus_access';
INSERT INTO public.app_config(config_key, config_value) VALUES ('global_plus_access', 'true');
CREATE TEMP TABLE kq(tag text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM kq WHERE tag = p_tag $f$;
CREATE FUNCTION pg_temp.as_user(p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid := pg_temp.u(p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $f$;
CREATE FUNCTION pg_temp.ok(p_label text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_label; END IF;
  RAISE NOTICE 'PASS %', p_label;
END $f$;
-- p_sql as the app client p_tag; 'ok' or 'SQLSTATE:message'.
CREATE FUNCTION pg_temp.try_as(p_tag text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql;
    r := 'ok';
  EXCEPTION WHEN OTHERS THEN r := SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
-- rows touched by p_sql run as the app client p_tag (-1 on error).
CREATE FUNCTION pg_temp.rows_as(p_tag text, p_sql text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN n := -1;
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN n;
END $f$;
CREATE FUNCTION pg_temp.call_as(p_tag text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO r;
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
CREATE FUNCTION pg_temp.accepted(p_session uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = p_session AND user_id = pg_temp.u(p_tag) AND has_accepted)
$f$;
CREATE FUNCTION pg_temp.n_accepted(p_session uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM public.session_participants WHERE session_id = p_session AND has_accepted
$f$;
CREATE FUNCTION pg_temp.conv_of(p_session uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.conversations WHERE session_id = p_session AND linked_entity_type = 'session'
$f$;
CREATE FUNCTION pg_temp.invite_of(p_session uuid, p_tag text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.collaboration_invites WHERE session_id = p_session AND invited_user_id = pg_temp.u(p_tag)
$f$;
CREATE FUNCTION pg_temp.accept_sql(p_session uuid, p_invite uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT format($$SELECT public.accept_session_with_prefs(%L, %L, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[], 'walking', 30)$$, p_session, p_invite)
$f$;
-- A session group made by postgres: members accepted in order (first = creator),
-- each with an accepted invite from the creator (like a real join).
CREATE FUNCTION pg_temp.mk_group(p_tag text, p_members text[]) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_s uuid; v_t text; i int := 0;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('lv ' || p_tag, pg_temp.u(p_members[1]), 'active') RETURNING id INTO v_s;
  FOREACH v_t IN ARRAY p_members LOOP
    i := i + 1;
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at)
      VALUES (v_s, pg_temp.u(v_t), true, now() - make_interval(mins => 100 - i));
    IF i > 1 THEN
      INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status)
        VALUES (v_s, pg_temp.u(p_members[1]), pg_temp.u(v_t), 'accepted');
    END IF;
  END LOOP;
  INSERT INTO kq VALUES (p_tag, v_s);
  RETURN v_s;
END $f$;

DO $fixture$
DECLARE v_tag text; v_id uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['a','b','c','d','e','x'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'lv-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'lv-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO kq VALUES (v_tag, v_id);
  END LOOP;
  FOR v_tag IN SELECT tag FROM kq WHERE tag <> 'a' LOOP
    INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
      (pg_temp.u('a'), pg_temp.u(v_tag), 'accepted'), (pg_temp.u(v_tag), pg_temp.u('a'), 'accepted');
  END LOOP;
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (pg_temp.u('b'), pg_temp.u('c'), 'accepted'), (pg_temp.u('c'), pg_temp.u('b'), 'accepted');
END $fixture$;

CREATE FUNCTION pg_temp.creator(p_session uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT created_by FROM public.collaboration_sessions WHERE id = p_session
$f$;
CREATE FUNCTION pg_temp.admin(p_session uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT is_admin FROM public.session_participants WHERE session_id = p_session AND user_id = pg_temp.u(p_tag)), false)
$f$;

-- ── L-PASS: the creator leaves a group that carries on ─────────────────────
DO $pass$
DECLARE v_s uuid := pg_temp.mk_group('pass', ARRAY['a','b','c']); v_conv uuid; v_err text;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  v_err := pg_temp.try_as('a', format($$SELECT public.leave_group_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('L-PASS the creator leaves and the longest-standing member is the creator and an admin',
    v_err = 'ok' AND pg_temp.creator(v_s) = pg_temp.u('b') AND pg_temp.admin(v_s, 'b') AND NOT pg_temp.admin(v_s, 'c')
    AND public.is_session_creator(v_s, pg_temp.u('b')) AND public.chat_group_is_admin(v_conv, pg_temp.u('b')));
  v_err := pg_temp.try_as('b', format($$UPDATE public.collaboration_sessions SET max_participants = 12 WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('L-PASS the new creator runs creator-only settings', v_err = 'ok'
    AND (SELECT max_participants FROM public.collaboration_sessions WHERE id = v_s) = 12);
  -- the old creator comes back through Add people
  v_err := pg_temp.try_as('b', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('L-PASS the old creator comes back as an ordinary member',
    v_err = 'ok' AND pg_temp.accepted(v_s, 'a') AND NOT public.is_session_creator(v_s, pg_temp.u('a'))
    AND NOT public.chat_group_is_admin(v_conv, pg_temp.u('a')) AND pg_temp.creator(v_s) = pg_temp.u('b'));
  v_err := pg_temp.try_as('a', format($$UPDATE public.collaboration_sessions SET max_participants = 15 WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('L-PASS the returning old creator has no creator-only say',
    v_err LIKE '42501:%' AND (SELECT max_participants FROM public.collaboration_sessions WHERE id = v_s) = 12);
  v_err := pg_temp.try_as('a', format($$SELECT public.set_group_admin(%L, %L, false)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('L-PASS the returning old creator cannot demote the new creator', v_err LIKE '42501:%' AND pg_temp.admin(v_s, 'b'));
  v_err := pg_temp.try_as('b', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('L-PASS an admin can promote the old creator (admin, still not the creator)',
    v_err = 'ok' AND pg_temp.admin(v_s, 'a') AND NOT public.is_session_creator(v_s, pg_temp.u('a')));
  v_err := pg_temp.try_as('b', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('L-PASS the old creator is no longer protected from removal', v_err = 'ok' AND NOT pg_temp.accepted(v_s, 'a'));
  v_err := pg_temp.try_as('c', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('L-PASS the new creator is protected like a creator', v_err LIKE '42501:%' AND pg_temp.accepted(v_s, 'b'));
END $pass$;

-- ── L-HEIR: an admin takes over first ──────────────────────────────────────
DO $heir$
DECLARE v_s uuid := pg_temp.mk_group('heir', ARRAY['a','b','c','d']);
BEGIN
  UPDATE public.session_participants SET is_admin = true WHERE session_id = v_s AND user_id = pg_temp.u('d');
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('a');
  PERFORM pg_temp.ok('L-HEIR the longest-standing admin (d) takes over before an older member (b)',
    pg_temp.creator(v_s) = pg_temp.u('d') AND pg_temp.admin(v_s, 'd') AND NOT pg_temp.admin(v_s, 'b'));
  PERFORM pg_temp.ok('L-HEIR the heir function agrees, and is service-role only',
    public.issue_4435_group_heir(v_s, pg_temp.u('d')) = pg_temp.u('b')
    AND NOT has_function_privilege('authenticated', 'public.issue_4435_group_heir(uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4435_group_heir(uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4435_hand_over_creator(uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4435_hand_over_creator(uuid, uuid)', 'EXECUTE'));
  PERFORM pg_temp.ok('L-HEIR handing over for someone who is not the creator does nothing',
    public.issue_4435_hand_over_creator(v_s, pg_temp.u('b')) IS NULL AND pg_temp.creator(v_s) = pg_temp.u('d'));
  -- the heir's join time decides among non-admins; a tie falls to the row age, then the smaller id
  UPDATE public.session_participants SET is_admin = false WHERE session_id = v_s;
  UPDATE public.session_participants SET joined_at = now() - interval '1 day', created_at = now() - interval '1 day'
   WHERE session_id = v_s AND user_id IN (pg_temp.u('b'), pg_temp.u('c'));
  PERFORM pg_temp.ok('L-HEIR a tie in join time and row age goes to the smaller user id',
    public.issue_4435_group_heir(v_s, pg_temp.u('d')) = LEAST(pg_temp.u('b'), pg_temp.u('c')));
END $heir$;

-- ── L-OWN-ROW: the live app's own-row leave and the old Exit board ─────────
DO $own$
DECLARE v_s uuid := pg_temp.mk_group('own', ARRAY['a','b']); r text; n1 bigint; n2 bigint;
BEGIN
  r := pg_temp.try_as('a', format($$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('a')));
  PERFORM pg_temp.ok('L-OWN-ROW the creator''s own-row leave hands the group to the other person',
    r = 'ok' AND pg_temp.creator(v_s) = pg_temp.u('b') AND pg_temp.admin(v_s, 'b'));
  n1 := pg_temp.rows_as('a', format($$DELETE FROM public.session_participants WHERE session_id = %L AND user_id <> %L$$, v_s, pg_temp.u('a')));
  n2 := pg_temp.rows_as('a', format($$DELETE FROM public.collaboration_sessions WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('L-OWN-ROW the old Exit board follow-ups touch nothing', n1 = 0 AND n2 = 0 AND pg_temp.accepted(v_s, 'b'));
  -- the old app's "ghost" cleanup of same-name sessions now cannot reach it
  n1 := pg_temp.rows_as('a', format($$DELETE FROM public.collaboration_sessions WHERE created_by = %L AND name = 'lv own'$$, pg_temp.u('a')));
  PERFORM pg_temp.ok('L-OWN-ROW the old creator''s same-name cleanup cannot find the group', n1 = 0
    AND EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  -- the new creator is the last one: leaving deletes the group
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('L-OWN-ROW the last person leaving still deletes the group', NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $own$;

-- ── L-HALF: a half-made group keeps today's rule ───────────────────────────
DO $half$
DECLARE v_s uuid := pg_temp.mk_group('half', ARRAY['a']);
BEGIN
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('b'), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status) VALUES (v_s, pg_temp.u('a'), pg_temp.u('b'), 'pending');
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('a');
  PERFORM pg_temp.ok('L-HALF the creator alone with a pending invitee leaves: the group is deleted, not handed to the invitee',
    NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $half$;

-- ── L-DM: 1:1 plans keep the #4114 rule ────────────────────────────────────
DO $dm$
DECLARE v_conv uuid; v_j jsonb; v_s uuid; r text;
BEGIN
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', pg_temp.u('a')) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_conv, pg_temp.u('a')), (v_conv, pg_temp.u('b'));
  v_j := pg_temp.call_as('a', format($$SELECT public.start_dm_collab(%L, 'lv dm')$$, v_conv));
  v_s := (v_j ->> 'session_id')::uuid;
  r := pg_temp.try_as('a', format($$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('a')));
  PERFORM pg_temp.ok('L-DM a pending 1:1 plan keeps its starter as creator when the starter''s row goes',
    v_s IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s) OR pg_temp.creator(v_s) = pg_temp.u('a')));
END $dm$;

-- ── L-LAST-ADMIN: the last-admin rule where there is no creator ────────────
DO $lastadmin$
DECLARE v_s uuid := pg_temp.mk_group('la', ARRAY['a','b','c']); v_conv uuid; v_err text;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  UPDATE public.collaboration_sessions SET created_by = NULL WHERE id = v_s;   -- creator's account deleted
  UPDATE public.session_participants SET is_admin = true WHERE session_id = v_s AND user_id = pg_temp.u('b');
  v_err := pg_temp.try_as('b', format($$SELECT public.set_group_admin(%L, %L, false)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('L-LAST-ADMIN the last admin of a group with no creator cannot step down', v_err LIKE '42501:last_admin%' AND pg_temp.admin(v_s, 'b'));
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('L-LAST-ADMIN when that admin leaves, the longest-standing member becomes admin',
    pg_temp.admin(v_s, 'a') AND NOT pg_temp.admin(v_s, 'c') AND pg_temp.creator(v_s) IS NULL);
END $lastadmin$;

-- ── L-FIELDS: fields no app writes are server-only ─────────────────────────
DO $fields$
DECLARE v_s uuid := pg_temp.mk_group('fields', ARRAY['a','b']); v_col text; v_sql text; v_err text; r1 text; r2 text; r3 text; r4 text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['is_active = false', 'archived_at = now()', 'participant_prefs = ''{"x":1}''::jsonb',
                                'deck_version = 99', 'deck_params_hash = ''forged''']
  LOOP
    v_sql := format('UPDATE public.collaboration_sessions SET %s WHERE id = %L', v_col, v_s);
    r1 := pg_temp.try_as('b', v_sql);
    r2 := pg_temp.try_as('a', v_sql);
    PERFORM pg_temp.ok('L-FIELDS a member cannot change ' || split_part(v_col, ' ', 1), r1 LIKE '42501:%');
    PERFORM pg_temp.ok('L-FIELDS the creator cannot change ' || split_part(v_col, ' ', 1), r2 LIKE '42501:%');
  END LOOP;
  PERFORM pg_temp.ok('L-FIELDS nothing changed',
    (SELECT is_active IS DISTINCT FROM false AND archived_at IS NULL AND deck_version IS DISTINCT FROM 99
            AND deck_params_hash IS DISTINCT FROM 'forged' AND NOT (COALESCE(participant_prefs, '{}'::jsonb) ? 'x')
       FROM public.collaboration_sessions WHERE id = v_s));
  -- what the live apps write still works
  r1 := pg_temp.try_as('b', format($$UPDATE public.collaboration_sessions SET name = 'lv renamed' WHERE id = %L$$, v_s));
  r2 := pg_temp.try_as('b', format($$UPDATE public.collaboration_sessions SET status = 'voting' WHERE id = %L$$, v_s));
  r3 := pg_temp.try_as('b', format($$UPDATE public.collaboration_sessions SET last_activity_at = now() WHERE id = %L$$, v_s));
  r4 := pg_temp.try_as('a', format($$UPDATE public.collaboration_sessions SET status = 'active', updated_at = now() WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('L-FIELDS a member still renames, sets status and touches activity',
    r1 = 'ok' AND r2 = 'ok' AND r3 = 'ok' AND r4 = 'ok'
    AND (SELECT name FROM public.collaboration_sessions WHERE id = v_s) = 'lv renamed');
  -- a server function still moves the deck on
  PERFORM public.rpc_force_deck_recycle(v_s, '{}'::uuid[]);
  PERFORM pg_temp.ok('L-FIELDS a server function still changes the deck version',
    (SELECT deck_version FROM public.collaboration_sessions WHERE id = v_s) IS NOT NULL);
  v_err := pg_temp.try_as('b', format($$SELECT public.upsert_participant_prefs(%L, %L, '{"categories":["x"]}'::jsonb)$$, v_s, pg_temp.u('b')));
  PERFORM pg_temp.ok('L-FIELDS a member still saves their own deck prefs through the server', v_err = 'ok'
    AND (SELECT participant_prefs ? pg_temp.u('b')::text FROM public.collaboration_sessions WHERE id = v_s));
END $fields$;

-- ── L-GRANT ────────────────────────────────────────────────────────────────
DO $grant$
BEGIN
  PERFORM pg_temp.ok('L-GRANT the accept call is not executable signed out',
    NOT has_function_privilege('anon', 'public.accept_session_with_prefs(uuid, uuid, numeric, numeric, text[], text[], text, integer, text, text, text[], boolean, text, boolean, boolean)', 'EXECUTE'));
  PERFORM pg_temp.ok('L-GRANT the accept call is still executable signed in',
    has_function_privilege('authenticated', 'public.accept_session_with_prefs(uuid, uuid, numeric, numeric, text[], text[], text, integer, text, text, text[], boolean, text, boolean, boolean)', 'EXECUTE'));
END $grant$;

-- ── L-NOTICE: the session notice check ─────────────────────────────────────
DO $notice$
DECLARE v_s uuid := pg_temp.mk_group('notice', ARRAY['a','b','c']); v_j jsonb; v_s2 uuid;
BEGIN
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('d'), false);
  v_j := public.issue_4435_session_notice_check(v_s, pg_temp.u('a'), pg_temp.u('d'));
  PERFORM pg_temp.ok('L-NOTICE a member to a pending invitee passes',
    (v_j ->> 'session_exists')::boolean AND (v_j ->> 'sender_member')::boolean AND (v_j ->> 'recipient_member')::boolean);
  v_j := public.issue_4435_session_notice_check(v_s, pg_temp.u('d'), pg_temp.u('a'));
  PERFORM pg_temp.ok('L-NOTICE a pending invitee is not an accepted sender', NOT (v_j ->> 'sender_member')::boolean);
  v_j := public.issue_4435_session_notice_check(v_s, pg_temp.u('x'), pg_temp.u('a'));
  PERFORM pg_temp.ok('L-NOTICE an outsider is not a sender', NOT (v_j ->> 'sender_member')::boolean);
  v_j := public.issue_4435_session_notice_check(v_s, pg_temp.u('a'), pg_temp.u('x'));
  PERFORM pg_temp.ok('L-NOTICE an outsider is not a recipient', NOT (v_j ->> 'recipient_member')::boolean);
  -- the creator deletes the group the app's way (partners first, then the session)
  PERFORM pg_temp.try_as('a', format($$DELETE FROM public.session_participants WHERE session_id = %L AND user_id <> %L$$, v_s, pg_temp.u('a')));
  PERFORM pg_temp.try_as('a', format($$DELETE FROM public.collaboration_sessions WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('L-NOTICE fixture: the group is gone', NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  v_j := public.issue_4435_session_notice_check(v_s, pg_temp.u('a'), pg_temp.u('b'));
  PERFORM pg_temp.ok('L-NOTICE right after a delete, the members are still known and the group is gone',
    NOT (v_j ->> 'session_exists')::boolean AND (v_j ->> 'sender_member')::boolean AND (v_j ->> 'recipient_member')::boolean);
  v_j := public.issue_4435_session_notice_check(v_s, pg_temp.u('d'), pg_temp.u('b'));
  PERFORM pg_temp.ok('L-NOTICE a pending invitee who left is still not an accepted sender', NOT (v_j ->> 'sender_member')::boolean);
  UPDATE public.issue_4435_member_departures SET departed_at = now() - interval '11 minutes' WHERE session_id = v_s;
  v_j := public.issue_4435_session_notice_check(v_s, pg_temp.u('a'), pg_temp.u('b'));
  PERFORM pg_temp.ok('L-NOTICE after 10 minutes the people who left no longer count',
    NOT (v_j ->> 'sender_member')::boolean AND NOT (v_j ->> 'recipient_member')::boolean);
  -- an unknown session id
  v_j := public.issue_4435_session_notice_check(gen_random_uuid(), pg_temp.u('a'), pg_temp.u('b'));
  PERFORM pg_temp.ok('L-NOTICE an unknown session has no members', NOT (v_j ->> 'session_exists')::boolean
    AND NOT (v_j ->> 'sender_member')::boolean AND NOT (v_j ->> 'recipient_member')::boolean);
  PERFORM pg_temp.ok('L-NOTICE the check and the record are service-role only',
    NOT has_function_privilege('authenticated', 'public.issue_4435_session_notice_check(uuid, uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4435_session_notice_check(uuid, uuid, uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4435_session_notice_check(uuid, uuid, uuid)', 'EXECUTE')
    AND NOT has_table_privilege('authenticated', 'public.issue_4435_member_departures', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.issue_4435_member_departures', 'SELECT'));
  -- left on their own vs removed: only the first still counts as a sender
  v_s2 := pg_temp.mk_group('notice3', ARRAY['a','b','c']);
  PERFORM pg_temp.try_as('a', format($$SELECT public.remove_group_member(%L, %L)$$, pg_temp.conv_of(v_s2), pg_temp.u('b')));
  PERFORM pg_temp.try_as('c', format($$SELECT public.leave_group_conversation(%L)$$, pg_temp.conv_of(v_s2)));
  PERFORM pg_temp.ok('L-NOTICE the departure record tells removed (b) from left (c)',
    (SELECT NOT left_voluntarily AND was_accepted FROM public.issue_4435_member_departures WHERE session_id = v_s2 AND user_id = pg_temp.u('b'))
    AND (SELECT left_voluntarily AND was_accepted FROM public.issue_4435_member_departures WHERE session_id = v_s2 AND user_id = pg_temp.u('c')));
  v_j := public.issue_4435_session_notice_check(v_s2, pg_temp.u('b'), pg_temp.u('a'));
  PERFORM pg_temp.ok('L-NOTICE a removed member cannot send to the group', NOT (v_j ->> 'sender_member')::boolean);
  v_j := public.issue_4435_session_notice_check(v_s2, pg_temp.u('c'), pg_temp.u('a'));
  PERFORM pg_temp.ok('L-NOTICE someone who just left on their own still can (the leave notice)', (v_j ->> 'sender_member')::boolean);
  v_j := public.issue_4435_session_notice_check(v_s2, pg_temp.u('a'), pg_temp.u('b'));
  PERFORM pg_temp.ok('L-NOTICE a removed member can still be told (the removal notice)', (v_j ->> 'recipient_member')::boolean);
  DELETE FROM public.session_participants WHERE session_id = v_s2 AND user_id = pg_temp.u('a');
  PERFORM pg_temp.ok('L-NOTICE a server-side delete is not voluntary',
    NOT (SELECT left_voluntarily FROM public.issue_4435_member_departures WHERE session_id = v_s2 AND user_id = pg_temp.u('a')));
  -- old rows are pruned on the next departure
  v_s2 := pg_temp.mk_group('notice2', ARRAY['a','b']);
  UPDATE public.issue_4435_member_departures SET departed_at = now() - interval '2 days' WHERE session_id = v_s;
  DELETE FROM public.session_participants WHERE session_id = v_s2 AND user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('L-NOTICE records older than a day are pruned',
    NOT EXISTS (SELECT 1 FROM public.issue_4435_member_departures WHERE session_id = v_s)
    AND EXISTS (SELECT 1 FROM public.issue_4435_member_departures WHERE session_id = v_s2 AND user_id = pg_temp.u('b')));
END $notice$;

-- ── L-REALTIME: what the app's social channels may bind ────────────────────
-- app-mobile/src/hooks/useSocialRealtime.ts binds these tables; a binding to a
-- table outside the publication silences its whole channel. Pinned with
-- app-mobile/src/hooks/__tests__/issue_4435_social_realtime.implementor.test.ts.
DO $realtime$
BEGIN
  PERFORM pg_temp.ok('L-REALTIME every table the social channels bind is published',
    (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename IN ('conversation_participants', 'friends', 'calendar_entries', 'pair_requests', 'pairings',
                        'conversation_participant_lifecycle')) = 6);
  PERFORM pg_temp.ok('L-REALTIME the three tables the app no longer binds are still unpublished (publishing them is a data-exposure decision)',
    NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename IN ('friend_requests', 'pending_invites', 'message_reads')));
END $realtime$;

ROLLBACK;
