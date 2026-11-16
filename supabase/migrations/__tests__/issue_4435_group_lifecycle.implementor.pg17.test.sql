\set ON_ERROR_STOP on

-- #4435 M-A (20280708054435): group lifecycle, direct adds, server-checked
-- remove/promote, delete at zero, admin handover, current-member counting.
-- Runs on the fully replayed PG17 schema; everything rolls back.
--
-- MINGLA-INVARIANT: I-4435-GROUP-DELETE-AT-ZERO | issue #4435 | a group session is deleted only when no accepted member remains; a 1:1 collab session keeps the under-two rule
-- MINGLA-INVARIANT: I-4435-SERVER-CHECKED-MEMBERSHIP | issue #4435 | members are added, removed and promoted only by server functions that check the caller; every add path enforces max_participants
-- MINGLA-INVARIANT: I-4435-ADMIN-HANDOVER | issue #4435 | a group with accepted members always has an admin; the longest-standing member inherits when the last admin goes
-- MINGLA-INVARIANT: I-4435-MATCH-CURRENT-MEMBERS | issue #4435 | a new collab match needs right swipes from two current accepted members; existing saved cards never disappear when someone leaves
-- MINGLA-INVARIANT: I-4435-OPEN-VOTES-CURRENT-MEMBERS | issue #4435 | open plan votes and RSVPs count current members only; locked plans keep every vote; auto-lock needs two or more members
--
-- Cases: C-CREATE, C-ADD, C-LEGACY-INVITE, C-LINK, C-REMOVE, C-ADMIN,
-- C-HANDOVER, C-LEAVE, C-DECLINE, C-MATCH, C-VOTES, C-LOCK, C-GUARD,
-- C-OLDAPP, C-REVERT, C-CATALOG.

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

CREATE TEMP TABLE k5(tag text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM k5 WHERE tag = p_tag $f$;
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
-- Runs p_sql as the authenticated client p_tag; returns 'ok' or 'SQLSTATE:message'.
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
-- Runs p_sql (a SELECT returning one jsonb) as the authenticated client p_tag.
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
CREATE FUNCTION pg_temp.conv_of(p_session uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.conversations WHERE session_id = p_session AND linked_entity_type = 'session'
$f$;
-- A session group made by postgres: p_members accepted (first is the creator).
CREATE FUNCTION pg_temp.mk_group(p_tag text, p_members text[]) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_s uuid; v_t text; i int := 0;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('c5 ' || p_tag, pg_temp.u(p_members[1]), 'active') RETURNING id INTO v_s;
  FOREACH v_t IN ARRAY p_members LOOP
    i := i + 1;
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at)
      VALUES (v_s, pg_temp.u(v_t), true, now() - make_interval(mins => 100 - i));
  END LOOP;
  INSERT INTO k5 VALUES (p_tag, v_s);
  RETURN v_s;
END $f$;

DO $fixture$
DECLARE v_tag text; v_id uuid; i int;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['a','b','c','d','e','x','blk','j','fr2'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'c5-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'c5-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k5 VALUES (v_tag, v_id);
  END LOOP;
  FOR i IN 1..16 LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'c5-f' || i || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'c5-f' || i || '-' || v_id || '@example.test', 'F' || i, 'F' || i) ON CONFLICT (id) DO NOTHING;
    INSERT INTO k5 VALUES ('f' || i, v_id);
  END LOOP;
  -- a is friends with b, c, d, e, blk, f1..f16; b is friends with c, f1..f16.
  FOR v_tag IN SELECT tag FROM k5 WHERE tag IN ('b','c','d','e','blk') OR tag ~ '^f[0-9]+$' LOOP
    INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
      (pg_temp.u('a'), pg_temp.u(v_tag), 'accepted'), (pg_temp.u(v_tag), pg_temp.u('a'), 'accepted');
  END LOOP;
  FOR v_tag IN SELECT tag FROM k5 WHERE tag = 'c' OR tag ~ '^f[0-9]+$' LOOP
    INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
      (pg_temp.u('b'), pg_temp.u(v_tag), 'accepted'), (pg_temp.u(v_tag), pg_temp.u('b'), 'accepted');
  END LOOP;
  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (pg_temp.u('a'), pg_temp.u('blk'));
END $fixture$;

-- ── C-CREATE ───────────────────────────────────────────────────────────────
DO $create$
DECLARE r jsonb; v_s uuid; v_err text;
BEGIN
  r := pg_temp.call_as('a', $$SELECT public.create_group_chat('Just me', ARRAY[]::uuid[])$$);
  v_s := (r ->> 'sessionId')::uuid;
  PERFORM pg_temp.ok('C-CREATE 0 friends: live at creation',
    (SELECT status = 'active' AND board_id IS NOT NULL FROM public.collaboration_sessions WHERE id = v_s));
  PERFORM pg_temp.ok('C-CREATE 0 friends: creator accepted and in the chat',
    pg_temp.accepted(v_s, 'a') AND (r ->> 'conversationId')::uuid = pg_temp.conv_of(v_s)
    AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = pg_temp.conv_of(v_s) AND user_id = pg_temp.u('a')));
  PERFORM pg_temp.ok('C-CREATE 0 friends: creator owns the board and has deck prefs',
    EXISTS (SELECT 1 FROM public.board_collaborators WHERE board_id = (r ->> 'boardId')::uuid AND user_id = pg_temp.u('a') AND role = 'owner')
    AND (SELECT participant_prefs ? pg_temp.u('a')::text FROM public.collaboration_sessions WHERE id = v_s));
  INSERT INTO k5 VALUES ('solo', v_s);

  r := pg_temp.call_as('a', format($$SELECT public.create_group_chat('Crew', ARRAY[%L, %L, %L, %L, %L]::uuid[])$$,
         pg_temp.u('b'), pg_temp.u('c'), pg_temp.u('d'), pg_temp.u('x'), pg_temp.u('blk')));
  v_s := (r ->> 'sessionId')::uuid;
  PERFORM pg_temp.ok('C-CREATE 3 friends are accepted members at once',
    pg_temp.accepted(v_s, 'b') AND pg_temp.accepted(v_s, 'c') AND pg_temp.accepted(v_s, 'd'));
  PERFORM pg_temp.ok('C-CREATE the 3 friends are chat members',
    (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = pg_temp.conv_of(v_s)) = 4);
  PERFORM pg_temp.ok('C-CREATE a non-friend and a blocked friend are skipped',
    jsonb_array_length(r -> 'skipped') = 2 AND NOT pg_temp.accepted(v_s, 'x') AND NOT pg_temp.accepted(v_s, 'blk'));
  PERFORM pg_temp.ok('C-CREATE added friends have accepted invites, board seats and deck prefs',
    (SELECT count(*) FROM public.collaboration_invites WHERE session_id = v_s AND status = 'accepted') = 3
    AND (SELECT count(*) FROM public.board_collaborators WHERE board_id = (r ->> 'boardId')::uuid) = 4
    AND (SELECT participant_prefs ? pg_temp.u('d')::text FROM public.collaboration_sessions WHERE id = v_s));
  PERFORM pg_temp.ok('C-CREATE one members_added line',
    (SELECT count(*) FROM public.messages WHERE conversation_id = pg_temp.conv_of(v_s) AND card_payload ->> 'event' = 'members_added') = 1);
  INSERT INTO k5 VALUES ('crew', v_s);

  v_err := pg_temp.try_as('a', format($$SELECT public.create_group_chat('Too many', ARRAY[%s]::uuid[])$$,
    (SELECT string_agg(quote_literal(id), ',') FROM k5 WHERE tag ~ '^f([1-9]|1[0-5])$')));
  PERFORM pg_temp.ok('C-CREATE 15 friends is refused with conflict_group_full', v_err LIKE 'PT409:conflict_group_full%');
  v_err := pg_temp.try_as('a', $$SELECT public.create_group_chat('   ', ARRAY[]::uuid[])$$);
  PERFORM pg_temp.ok('C-CREATE a blank name is refused', v_err LIKE '22023:invalid_input%');
END $create$;

-- ── C-ADD: any accepted member adds directly, all or nothing at the cap ─────
DO $add$
DECLARE v_s uuid := pg_temp.u('crew'); v_conv uuid; r jsonb; v_err text; i int;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  r := pg_temp.call_as('b', format($$SELECT public.add_group_members(%L, ARRAY[%L, %L]::uuid[])$$, v_conv, pg_temp.u('f1'), pg_temp.u('a')));
  PERFORM pg_temp.ok('C-ADD a plain member adds a friend directly',
    pg_temp.accepted(v_s, 'f1') AND r -> 'added' = to_jsonb(ARRAY[pg_temp.u('f1')]) AND jsonb_array_length(r -> 'skipped') = 1);
  -- fill to 14: a adds f2..f10 (5 + 9 = 14)
  r := pg_temp.call_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%s]::uuid[])$$, v_conv,
         (SELECT string_agg(quote_literal(id), ',') FROM k5 WHERE tag ~ '^f([2-9]|10)$')));
  PERFORM pg_temp.ok('C-ADD the group holds 14 accepted',
    (SELECT count(*) FROM public.session_participants WHERE session_id = v_s AND has_accepted) = 14);
  v_err := pg_temp.try_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L, %L]::uuid[])$$, v_conv, pg_temp.u('f11'), pg_temp.u('f12')));
  PERFORM pg_temp.ok('C-ADD two more at 14 of 15 is refused', v_err LIKE 'PT409:conflict_group_full%');
  PERFORM pg_temp.ok('C-ADD the refused add left no partial member',
    NOT pg_temp.accepted(v_s, 'f11') AND NOT pg_temp.accepted(v_s, 'f12')
    AND NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s AND user_id IN (pg_temp.u('f11'), pg_temp.u('f12'))));
  r := pg_temp.call_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('f11')));
  PERFORM pg_temp.ok('C-ADD one more at 14 of 15 fills the group', pg_temp.accepted(v_s, 'f11'));
  v_err := pg_temp.try_as('x', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('f12')));
  PERFORM pg_temp.ok('C-ADD a non-member is refused', v_err LIKE '42501:not_allowed%');
  -- C-LEGACY-INVITE: add_friend_to_session from a full group
  r := pg_temp.call_as('a', format($$SELECT public.add_friend_to_session(%L, %L)$$, v_s, pg_temp.u('f12')));
  PERFORM pg_temp.ok('C-LEGACY-INVITE at 15 accepted add_friend_to_session returns session_full',
    r ->> 'outcome' = 'session_invalid' AND r ->> 'error_code' = 'session_full');
END $add$;

DO $legacy$
DECLARE v_s uuid := pg_temp.u('solo'); r jsonb;
BEGIN
  r := pg_temp.call_as('a', format($$SELECT public.add_friend_to_session(%L, %L)$$, v_s, pg_temp.u('e')));
  PERFORM pg_temp.ok('C-LEGACY-INVITE an accepted member still creates a pending invite',
    r ->> 'outcome' = 'invited' AND (SELECT status FROM public.collaboration_invites WHERE session_id = v_s AND invited_user_id = pg_temp.u('e')) = 'pending');
  r := pg_temp.call_as('e', format($$SELECT public.add_friend_to_session(%L, %L)$$, v_s, pg_temp.u('f13')));
  PERFORM pg_temp.ok('C-LEGACY-INVITE a pending participant gets not_session_member', r ->> 'outcome' = 'not_session_member');
END $legacy$;

-- ── C-LINK: a joiner is admitted at once, one joined_by_link line ───────────
DO $link$
DECLARE v_s uuid := pg_temp.mk_group('linked', ARRAY['b','c']); v_conv uuid; v_link jsonb; r jsonb;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  v_link := pg_temp.call_as('b', format($$SELECT public.get_or_create_group_link(%L)$$, v_conv));
  PERFORM pg_temp.try_as('b', format($$SELECT public.set_group_link_approval(%L, false)$$, v_conv));
  r := pg_temp.call_as('j', format($$SELECT public.join_group_by_link(%L, NULL)$$, v_link ->> 'token'));
  PERFORM pg_temp.ok('C-LINK a link join returns joined with the session id',
    r ->> 'status' = 'joined' AND (r ->> 'sessionId')::uuid = v_s);
  PERFORM pg_temp.ok('C-LINK the joiner is an accepted member and in the chat',
    pg_temp.accepted(v_s, 'j') AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = v_conv AND user_id = pg_temp.u('j')));
  PERFORM pg_temp.ok('C-LINK exactly one joined_by_link line for a new invite row',
    (SELECT count(*) FROM public.messages WHERE conversation_id = v_conv AND card_payload ->> 'event' = 'joined_by_link') = 1);
  -- an old pending link invite (from today's server) turns into a join with one line
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status, invite_method)
    VALUES (v_s, pg_temp.u('b'), pg_temp.u('e'), 'pending', 'link');
  r := pg_temp.call_as('e', format($$SELECT public.join_group_by_link(%L, NULL)$$, v_link ->> 'token'));
  PERFORM pg_temp.ok('C-LINK a pending link invite is admitted with exactly one line',
    pg_temp.accepted(v_s, 'e')
    AND (SELECT count(*) FROM public.messages WHERE conversation_id = v_conv AND card_payload ->> 'event' = 'joined_by_link'
           AND card_payload ->> 'userId' = pg_temp.u('e')::text) = 1);
  r := pg_temp.call_as('e', format($$SELECT public.join_group_by_link(%L, NULL)$$, v_link ->> 'token'));
  PERFORM pg_temp.ok('C-LINK joining again is already_member', r ->> 'status' = 'already_member');
  -- approval on: an approved joiner is in at once
  PERFORM pg_temp.try_as('b', format($$SELECT public.set_group_link_approval(%L, true)$$, v_conv));
  r := pg_temp.call_as('d', format($$SELECT public.join_group_by_link(%L, NULL)$$, v_link ->> 'token'));
  PERFORM pg_temp.ok('C-LINK with approval on the joiner waits', r ->> 'status' = 'requested' AND NOT pg_temp.accepted(v_s, 'd'));
  r := pg_temp.call_as('c', format($$SELECT public.decide_group_join_request(%L, true)$$, r ->> 'requestId'));
  PERFORM pg_temp.ok('C-LINK an approved joiner is in at once', r ->> 'status' = 'approved' AND pg_temp.accepted(v_s, 'd'));
END $link$;

-- ── C-REMOVE / C-ADMIN ─────────────────────────────────────────────────────
DO $remove$
DECLARE v_s uuid := pg_temp.mk_group('rm', ARRAY['a','b','c','d','e']); v_conv uuid; r jsonb; v_err text;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  v_err := pg_temp.try_as('c', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('d')));
  PERFORM pg_temp.ok('C-REMOVE a non-admin is refused with no change', v_err LIKE '42501:not_allowed%' AND pg_temp.accepted(v_s, 'd'));
  v_err := pg_temp.try_as('c', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('c')));
  PERFORM pg_temp.ok('C-ADMIN a non-admin cannot promote themselves', v_err LIKE '42501:not_allowed%');
  r := pg_temp.call_as('a', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('C-ADMIN the creator makes b an admin, one made_admin line',
    (SELECT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b'))
    AND (SELECT count(*) FROM public.messages WHERE conversation_id = v_conv AND card_payload ->> 'event' = 'made_admin') = 1);
  r := pg_temp.call_as('b', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('d')));
  PERFORM pg_temp.ok('C-REMOVE a non-creator admin removes a member from the group and the chat',
    r ->> 'removed' = pg_temp.u('d')::text AND NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('d'))
    AND NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = v_conv AND user_id = pg_temp.u('d')));
  PERFORM pg_temp.ok('C-REMOVE exactly one member_removed line',
    (SELECT count(*) FROM public.messages WHERE conversation_id = v_conv AND card_payload ->> 'event' = 'member_removed') = 1);
  v_err := pg_temp.try_as('b', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('d')));
  PERFORM pg_temp.ok('C-REMOVE removing someone not in the group is not_found', v_err LIKE 'P0002:not_found%');
  v_err := pg_temp.try_as('b', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('C-REMOVE nobody removes the creator', v_err LIKE '42501:creator_protected%' AND pg_temp.accepted(v_s, 'a'));
  v_err := pg_temp.try_as('b', format($$SELECT public.set_group_admin(%L, %L, false)$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('C-ADMIN nobody demotes the creator', v_err LIKE '42501:creator_protected%');
  v_err := pg_temp.try_as('b', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('C-REMOVE removing yourself is invalid_input (leave instead)', v_err LIKE '22023:invalid_input%');
  r := pg_temp.call_as('a', format($$SELECT public.set_group_admin(%L, %L, false)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('C-ADMIN removing an admin is allowed while another admin stays',
    (SELECT NOT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b')));
END $remove$;

DO $lastadmin$
DECLARE v_s uuid := pg_temp.mk_group('la', ARRAY['a','b','c']); v_conv uuid; v_err text;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  -- the creator leaves; b inherits; b is then the last admin
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('a');
  PERFORM pg_temp.ok('C-HANDOVER when the creator leaves, the longest-standing member becomes admin',
    (SELECT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b'))
    AND NOT (SELECT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('c')));
  v_err := pg_temp.try_as('b', format($$SELECT public.set_group_admin(%L, %L, false)$$, v_conv, pg_temp.u('b')));
  -- #4435 leftovers: b also inherited the creator's role, so the refusal is
  -- the creator's protection. The last-admin rule itself is pinned by
  -- issue_4435_leftovers.implementor (L-LAST-ADMIN, a group with no creator).
  PERFORM pg_temp.ok('C-ADMIN the last admin cannot be demoted', v_err LIKE '42501:creator_protected%'
    AND (SELECT created_by FROM public.collaboration_sessions WHERE id = v_s) = pg_temp.u('b'));
  -- b leaves; c inherits
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('C-HANDOVER the last person inherits admin and the group stays',
    (SELECT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('c'))
    AND EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('c');
  PERFORM pg_temp.ok('C-LEAVE the last person leaving deletes the group',
    NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $lastadmin$;

-- ── C-LEAVE: leave_group_conversation; 1:1 collab unchanged ────────────────
DO $leave$
DECLARE v_s uuid := pg_temp.mk_group('lv', ARRAY['a','b']); v_dm uuid; v_s2 uuid;
BEGIN
  PERFORM pg_temp.try_as('b', format($$SELECT public.leave_group_conversation(%L)$$, pg_temp.conv_of(v_s)));
  PERFORM pg_temp.ok('C-LEAVE the second-to-last leaving keeps the group for the last person',
    EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s) AND pg_temp.accepted(v_s, 'a'));
  INSERT INTO public.conversations(type, linked_entity_type, created_by) VALUES ('direct', 'direct', pg_temp.u('a')) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, pg_temp.u('a')), (v_dm, pg_temp.u('b'));
  PERFORM set_config('issue_4114.dm_collab_start', 'on', true);
  INSERT INTO public.collaboration_sessions(name, created_by, status, conversation_id) VALUES ('c5 dm', pg_temp.u('a'), 'active', v_dm) RETURNING id INTO v_s2;
  PERFORM set_config('issue_4114.dm_collab_start', 'off', true);
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s2, pg_temp.u('a'), true), (v_s2, pg_temp.u('b'), true);
  DELETE FROM public.session_participants WHERE session_id = v_s2 AND user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('C-LEAVE a 1:1 collab still ends when the friend leaves',
    NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s2));
END $leave$;

-- ── C-DECLINE ──────────────────────────────────────────────────────────────
DO $decline$
DECLARE v_s uuid := pg_temp.mk_group('dec', ARRAY['x']); v_fr uuid;
BEGIN
  INSERT INTO public.friend_requests(sender_id, receiver_id, status) VALUES (pg_temp.u('x'), pg_temp.u('fr2'), 'pending') RETURNING id INTO v_fr;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('fr2'), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status) VALUES (v_s, pg_temp.u('x'), pg_temp.u('fr2'), 'pending');
  UPDATE public.friend_requests SET status = 'declined' WHERE id = v_fr;
  PERFORM pg_temp.ok('C-DECLINE a declined friend request deletes no group',
    EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  PERFORM pg_temp.ok('C-DECLINE the invite is still cancelled (steps 1 and 2 unchanged)',
    (SELECT status FROM public.collaboration_invites WHERE session_id = v_s AND invited_user_id = pg_temp.u('fr2')) = 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('fr2')));
END $decline$;

-- ── C-MATCH ────────────────────────────────────────────────────────────────
DO $match$
DECLARE v_s uuid := pg_temp.mk_group('mt', ARRAY['a','b','c']); v_a uuid := pg_temp.u('a'); v_b uuid := pg_temp.u('b'); v_c uuid := pg_temp.u('c'); v_card uuid;
BEGIN
  -- an existing saved card stays when a voter leaves
  PERFORM pg_temp.call_as('a', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'c5-keep', %L, '{"title":"K"}'::jsonb, 'right')$$, v_s, v_a));
  PERFORM pg_temp.call_as('b', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'c5-keep', %L, '{"title":"K"}'::jsonb, 'right')$$, v_s, v_b));
  SELECT id INTO v_card FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'c5-keep';
  PERFORM pg_temp.ok('C-MATCH two current members still make a match', v_card IS NOT NULL);
  -- a's later swipe on a new card, then a is removed
  PERFORM pg_temp.call_as('a', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'c5-new', %L, '{"title":"N"}'::jsonb, 'right')$$, v_s, v_a));
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = v_a;
  PERFORM pg_temp.ok('C-MATCH the existing saved card stays after a voter leaves', EXISTS (SELECT 1 FROM public.board_saved_cards WHERE id = v_card));
  PERFORM pg_temp.call_as('b', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'c5-new', %L, '{"title":"N"}'::jsonb, 'right')$$, v_s, v_b));
  PERFORM pg_temp.ok('C-MATCH a removed member''s swipe plus one current swipe makes no match',
    NOT EXISTS (SELECT 1 FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'c5-new'));
  PERFORM pg_temp.call_as('c', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'c5-new', %L, '{"title":"N"}'::jsonb, 'right')$$, v_s, v_c));
  PERFORM pg_temp.ok('C-MATCH two current members'' swipes make the match',
    EXISTS (SELECT 1 FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'c5-new'));
  -- re-admitted: the old swipe counts again
  PERFORM pg_temp.call_as('b', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'c5-back', %L, '{"title":"B"}'::jsonb, 'right')$$, v_s, v_b));
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = v_b;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, v_b, true);
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, v_a, true);
  PERFORM pg_temp.call_as('a', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'c5-back', %L, '{"title":"B"}'::jsonb, 'right')$$, v_s, v_a));
  PERFORM pg_temp.ok('C-MATCH a re-admitted member''s earlier swipe counts again',
    EXISTS (SELECT 1 FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'c5-back'));
END $match$;

-- ── C-VOTES: open plans count current members; locked plans keep every row ─
DO $votes$
DECLARE v_s uuid := pg_temp.mk_group('vt', ARRAY['a','b','c']); v_conv uuid; v_open uuid; v_done uuid; v_opt uuid; v_opt2 uuid; v_po1 uuid; v_po2 uuid; r jsonb; v_b uuid := pg_temp.u('b'); v_c uuid := pg_temp.u('c');
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  INSERT INTO public.chat_plans(conversation_id, source, created_by, title, when_mode, status)
    VALUES (v_conv, 'chat', pg_temp.u('a'), 'c5 open', 'poll', 'deciding') RETURNING id INTO v_open;
  INSERT INTO public.chat_plan_time_options(plan_id, starts_at, added_by) VALUES (v_open, now() + interval '3 days', pg_temp.u('a')) RETURNING id INTO v_opt;
  INSERT INTO public.chat_plan_time_votes(option_id, plan_id, user_id) VALUES (v_opt, v_open, v_b), (v_opt, v_open, v_c);
  INSERT INTO public.chat_plan_rsvps(plan_id, user_id, status) VALUES (v_open, v_b, 'going'), (v_open, v_c, 'maybe');
  INSERT INTO public.chat_plans(conversation_id, source, created_by, title, when_mode, status, scheduled_at, duration_minutes, locked_at)
    VALUES (v_conv, 'chat', pg_temp.u('a'), 'c5 done', 'poll', 'scheduled', now() + interval '2 days', 60, now()) RETURNING id INTO v_done;
  INSERT INTO public.chat_plan_time_options(plan_id, starts_at, added_by) VALUES (v_done, now() + interval '2 days', pg_temp.u('a')) RETURNING id INTO v_opt2;
  INSERT INTO public.chat_plan_time_votes(option_id, plan_id, user_id) VALUES (v_opt2, v_done, v_b);
  INSERT INTO public.chat_plan_rsvps(plan_id, user_id, status) VALUES (v_done, v_b, 'going');
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = v_b;
  r := pg_temp.call_as('a', format($$SELECT public.chat_plans_for_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('C-VOTES an open plan drops the removed member''s time vote and RSVP, keeps the current member''s',
    (SELECT p FROM jsonb_array_elements(r -> 'plans') p WHERE p ->> 'id' = v_open::text) -> 'options' -> 0 -> 'voterIds' = to_jsonb(ARRAY[v_c])
    AND (SELECT p FROM jsonb_array_elements(r -> 'plans') p WHERE p ->> 'id' = v_open::text) -> 'rsvps' -> 'going' = '[]'::jsonb
    AND (SELECT p FROM jsonb_array_elements(r -> 'plans') p WHERE p ->> 'id' = v_open::text) -> 'rsvps' -> 'maybe' = to_jsonb(ARRAY[v_c]));
  PERFORM pg_temp.ok('C-VOTES a locked plan keeps every vote and RSVP',
    (SELECT p FROM jsonb_array_elements(r -> 'plans') p WHERE p ->> 'id' = v_done::text) -> 'options' -> 0 -> 'voterIds' = to_jsonb(ARRAY[v_b])
    AND (SELECT p FROM jsonb_array_elements(r -> 'plans') p WHERE p ->> 'id' = v_done::text) -> 'rsvps' -> 'going' = to_jsonb(ARRAY[v_b]));
  -- the place winner used by plan_lock counts current members only
  INSERT INTO public.chat_plan_place_options(plan_id, kind, identity_key, place_name, place_address, added_by, is_original)
    VALUES (v_open, 'address', 'c5-old', 'Old pick', '1 Old St', pg_temp.u('a'), true) RETURNING id INTO v_po1;
  INSERT INTO public.chat_plan_place_options(plan_id, kind, identity_key, place_name, place_address, added_by, is_original)
    VALUES (v_open, 'address', 'c5-new', 'New pick', '2 New St', pg_temp.u('a'), false) RETURNING id INTO v_po2;
  INSERT INTO public.chat_plan_place_votes(option_id, plan_id, user_id) VALUES (v_po1, v_open, v_b), (v_po2, v_open, v_c);
  INSERT INTO public.chat_plan_place_votes(option_id, plan_id, user_id)
    SELECT v_po1, v_open, id FROM k5 WHERE tag IN ('f14', 'f15');
  PERFORM pg_temp.ok('C-VOTES the place winner ignores votes from people not in the chat',
    public.chat_plan_place_leader(v_open) = v_po2);
END $votes$;

-- ── C-LOCK ─────────────────────────────────────────────────────────────────
DO $lock$
DECLARE v_s uuid := pg_temp.mk_group('lk', ARRAY['a','b']); v_card uuid;
BEGIN
  INSERT INTO public.board_saved_cards(session_id, experience_id, card_data, saved_by) VALUES (v_s, 'c5-lock', '{"title":"L"}'::jsonb, pg_temp.u('a')) RETURNING id INTO v_card;
  INSERT INTO public.board_card_rsvps(session_id, saved_card_id, user_id, rsvp_status) VALUES (v_s, v_card, pg_temp.u('a'), 'attending');
  PERFORM pg_temp.ok('C-LOCK one of two attending does not lock', NOT (SELECT is_locked FROM public.board_saved_cards WHERE id = v_card));
  INSERT INTO public.board_card_rsvps(session_id, saved_card_id, user_id, rsvp_status) VALUES (v_s, v_card, pg_temp.u('b'), 'attending');
  PERFORM pg_temp.ok('C-LOCK two members both attending lock as today', (SELECT is_locked FROM public.board_saved_cards WHERE id = v_card));
END $lock$;

-- ── C-GUARD: client writes are still refused after M-A ─────────────────────
DO $guard$
DECLARE v_s uuid := pg_temp.u('crew'); v_err text;
BEGIN
  v_err := pg_temp.try_as('b', format($$UPDATE public.session_participants SET is_admin = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('b')));
  PERFORM pg_temp.ok('C-GUARD a member''s direct admin write is still refused', v_err LIKE '42501:%');
  v_err := pg_temp.try_as('x', format($$INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (%L, %L, true)$$, v_s, pg_temp.u('x')));
  PERFORM pg_temp.ok('C-GUARD a direct accepted self-insert is still refused', v_err LIKE '42501:%');
  v_err := pg_temp.try_as('b', $$SELECT public.issue_4435_admit_member(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'link')$$);
  PERFORM pg_temp.ok('C-GUARD the admit helper is not callable by clients', v_err LIKE '42501:%');
END $guard$;

-- ── C-OLDAPP: today's app create + accept still work on the new server ─────
DO $oldapp$
DECLARE v_s uuid; v_inv uuid; v_err text; v_a uuid := pg_temp.u('a'); v_e uuid := pg_temp.u('e');
BEGIN
  PERFORM pg_temp.as_user('a');
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('c5 old app', v_a, 'pending') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at) VALUES (v_s, v_a, true, now());
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, v_e, false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status) VALUES (v_s, v_a, v_e, 'pending') RETURNING id INTO v_inv;
  PERFORM public.upsert_participant_prefs(v_s, v_a, '{"categories":["nature"]}'::jsonb);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('C-OLDAPP the old client create (pending, own row, pending invitee) is allowed and kept',
    EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s) AND pg_temp.accepted(v_s, 'a'));
  v_err := pg_temp.try_as('e', format($$SELECT public.accept_session_with_prefs(%L, %L, NULL, NULL, ARRAY['nature'], ARRAY[]::text[], 'walking', 30)$$, v_s, v_inv));
  PERFORM pg_temp.ok('C-OLDAPP the invitee accepts as today', v_err = 'ok' AND pg_temp.accepted(v_s, 'e'));
  v_err := pg_temp.try_as('a', format($$UPDATE public.collaboration_sessions SET status = 'active' WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('C-OLDAPP the old client activation still works', v_err = 'ok'
    AND (SELECT status FROM public.collaboration_sessions WHERE id = v_s) = 'active');
END $oldapp$;

-- ── C-REVERT: with the old cleanup body, a 2-person group dies at 1 ────────
DO $revert$
DECLARE v_s uuid := pg_temp.mk_group('rv', ARRAY['a','b']); v_gone boolean;
BEGIN
  BEGIN
    CREATE OR REPLACE FUNCTION public.cleanup_session_if_under_two_participants()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $b$
    DECLARE c integer; st text;
    BEGIN
      IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
      SELECT status INTO st FROM public.collaboration_sessions WHERE id = COALESCE(OLD.session_id, NEW.session_id);
      IF st IS DISTINCT FROM 'active' THEN RETURN COALESCE(NEW, OLD); END IF;
      SELECT count(*) INTO c FROM public.session_participants WHERE session_id = COALESCE(OLD.session_id, NEW.session_id) AND has_accepted;
      IF c < 2 THEN DELETE FROM public.collaboration_sessions WHERE id = COALESCE(OLD.session_id, NEW.session_id); END IF;
      RETURN COALESCE(NEW, OLD);
    END $b$;
    DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b');
    v_gone := NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s);
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT435';
  EXCEPTION WHEN SQLSTATE 'XT435' THEN NULL;
  END;
  PERFORM pg_temp.ok('C-REVERT without M-A the group dies at one member (so C-LEAVE fails on revert)', v_gone);
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('C-REVERT with M-A restored the group stays', EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $revert$;

-- ── C-CATALOG ──────────────────────────────────────────────────────────────
DO $catalog$
DECLARE v_p text;
BEGIN
  FOREACH v_p IN ARRAY ARRAY['public.create_group_chat(text,uuid[])', 'public.remove_group_member(uuid,uuid)',
    'public.set_group_admin(uuid,uuid,boolean)', 'public.add_group_members(uuid,uuid[])'] LOOP
    IF has_function_privilege('anon', v_p, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_p, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL C-CATALOG % grants', v_p;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_p::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'FAIL C-CATALOG % must be SECURITY DEFINER with search_path public, pg_temp', v_p;
    END IF;
  END LOOP;
  FOREACH v_p IN ARRAY ARRAY['public.issue_4435_admit_member(uuid,uuid,uuid,text)', 'public.issue_4435_member_prefs(uuid)',
    'public.chat_group_admit(uuid,uuid,uuid)', 'public.chat_plan_place_leader(uuid)'] LOOP
    IF has_function_privilege('authenticated', v_p, 'EXECUTE') OR has_function_privilege('anon', v_p, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL C-CATALOG % is internal', v_p;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cleanup_session_under_two_participants' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'FAIL C-CATALOG cleanup trigger binding';
  END IF;
  RAISE NOTICE 'PASS C-CATALOG grants, definer settings and trigger binding';
END $catalog$;

ROLLBACK;
