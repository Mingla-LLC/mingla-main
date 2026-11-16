\set ON_ERROR_STOP on

-- #4435 independent tester suite (M-A 20280708054435 + M-B 20280708064435),
-- from angles the implementor suites do not take. Runs on the fully replayed
-- PG17 schema; everything rolls back.
--
-- MINGLA-INVARIANT: I-4435-GROUP-EDGES | issue #4435 | group membership, admin handover, the 15 cap across add paths, re-admission, Clear chat boundaries and today's app paths hold at their edges (E-INPUT, E-CAP, E-ADMIN, E-CHAIN, E-READD, E-PENDING, E-CLEAR, E-COMBO, E-REJOIN, E-OLDAPP, E-MUTE)
--
--   E-INPUT  add_group_members: duplicates, NULL, self, blocked, non-friend,
--            existing member and pending invitee in one call; all-skipped
--            calls post nothing; size limits apply after de-duplication.
--   E-CAP    the 15 cap across link join, direct add, the board-screen invite,
--            join approval and create, all against one group.
--   E-ADMIN  the last admin (creator gone) cannot demote or remove themself;
--            handover order and its tie-break.
--   E-CHAIN  creator leaves, then the second-to-last, then the last person:
--            the group lives until the last leaves, then it and its chat go.
--   E-READD  a removed member re-added through the server: no match appears
--            from the re-admission itself; open-plan answers come back.
--   E-PENDING an admin removes a pending invitee: the old invite cannot be
--            accepted afterwards.
--   E-CLEAR  Clear chat cutoff boundary: a message at the cutoff instant is
--            hidden, one microsecond later is shown; the peer sees all.
--   E-COMBO  hidden + archived + cleared: a new message brings the chat back
--            archived, keeps the cutoff, and old messages stay cleared.
--   E-REJOIN a person who cleared, left and rejoined a group sees only what
--            was sent after rejoining.
--   E-OLDAPP today's app calls (client create, accept, board invite, link
--            join, lifecycle actions, creator promote, own-row leave).
--   E-MUTE   a member mutes their own group notifications; nobody else can.

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

CREATE TEMP TABLE k7(tag text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM k7 WHERE tag = p_tag $f$;
CREATE FUNCTION pg_temp.as_user(p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid := pg_temp.u(p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $f$;
-- Back to a server writer (no client claims), so explicit message times are kept.
CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
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
-- p_sql (one jsonb value) as the app client p_tag.
CREATE FUNCTION pg_temp.call_as(p_tag text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO r;
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
CREATE FUNCTION pg_temp.accepted(p_session uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = p_session AND user_id = pg_temp.u(p_tag) AND has_accepted)
$f$;
CREATE FUNCTION pg_temp.admin(p_session uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT is_admin FROM public.session_participants WHERE session_id = p_session AND user_id = pg_temp.u(p_tag)), false)
$f$;
CREATE FUNCTION pg_temp.n_accepted(p_session uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM public.session_participants WHERE session_id = p_session AND has_accepted
$f$;
CREATE FUNCTION pg_temp.conv_of(p_session uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.conversations WHERE session_id = p_session AND linked_entity_type = 'session'
$f$;
CREATE FUNCTION pg_temp.events(p_conv uuid, p_event text) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM public.messages WHERE conversation_id = p_conv AND card_payload ->> 'event' = p_event
$f$;
-- A session group made by postgres: members accepted in order (first = creator),
-- each joined one minute after the previous.
CREATE FUNCTION pg_temp.mk_group(p_tag text, p_members text[]) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_s uuid; v_t text; i int := 0;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('e7 ' || p_tag, pg_temp.u(p_members[1]), 'active') RETURNING id INTO v_s;
  FOREACH v_t IN ARRAY p_members LOOP
    i := i + 1;
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at)
      VALUES (v_s, pg_temp.u(v_t), true, now() - make_interval(mins => 100 - i));
  END LOOP;
  INSERT INTO k7 VALUES (p_tag, v_s);
  RETURN v_s;
END $f$;
-- Messages p_tag can read in p_conv under RLS (non-system), by content.
CREATE FUNCTION pg_temp.visible(p_tag text, p_conv uuid) RETURNS text[] LANGUAGE plpgsql AS $f$
DECLARE r text[];
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  SELECT COALESCE(array_agg(content ORDER BY created_at), ARRAY[]::text[]) INTO r
    FROM public.messages WHERE conversation_id = p_conv AND message_type <> 'system';
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
CREATE FUNCTION pg_temp.life(p_conv uuid, p_tag text) RETURNS public.conversation_participant_lifecycle LANGUAGE sql AS $f$
  SELECT * FROM public.conversation_participant_lifecycle WHERE conversation_id = p_conv AND user_id = pg_temp.u(p_tag)
$f$;

DO $fixture$
DECLARE v_tag text; v_id uuid; i int;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['a','b','c','d','e','n1','blk','bb','j','t1','t2','t3','me','peer','g1'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'e7-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'e7-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k7 VALUES (v_tag, v_id);
  END LOOP;
  FOR i IN 1..15 LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'e7-f' || i || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'e7-f' || i || '-' || v_id || '@example.test', 'F' || i, 'F' || i) ON CONFLICT (id) DO NOTHING;
    INSERT INTO k7 VALUES ('f' || i, v_id);
  END LOOP;
  -- a is friends with everyone except n1; b is friends with c and d.
  FOR v_tag IN SELECT tag FROM k7 WHERE tag NOT IN ('a', 'n1') LOOP
    INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
      (pg_temp.u('a'), pg_temp.u(v_tag), 'accepted'), (pg_temp.u(v_tag), pg_temp.u('a'), 'accepted');
  END LOOP;
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (pg_temp.u('b'), pg_temp.u('c'), 'accepted'), (pg_temp.u('c'), pg_temp.u('b'), 'accepted'),
    (pg_temp.u('b'), pg_temp.u('d'), 'accepted'), (pg_temp.u('d'), pg_temp.u('b'), 'accepted');
  -- a blocked blk; bb blocked c (a member of the group below), not a.
  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES
    (pg_temp.u('a'), pg_temp.u('blk')), (pg_temp.u('bb'), pg_temp.u('c'));
END $fixture$;

-- ── E-INPUT ─────────────────────────────────────────────────────────────────
DO $input$
DECLARE v_s uuid := pg_temp.mk_group('in', ARRAY['a','b','c']); v_conv uuid; r jsonb; v_err text; v_before bigint;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('d'), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status) VALUES (v_s, pg_temp.u('a'), pg_temp.u('d'), 'pending');
  r := pg_temp.call_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L,%L,%L,NULL,%L,%L,%L,%L,%L,%L]::uuid[])$$,
    v_conv, pg_temp.u('e'), pg_temp.u('e'), pg_temp.u('e'), pg_temp.u('a'), pg_temp.u('n1'), pg_temp.u('blk'),
    pg_temp.u('b'), pg_temp.u('d'), pg_temp.u('bb')));
  PERFORM pg_temp.ok('E-INPUT one call adds only the eligible people, each once (a friend and the pending invitee)',
    (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(r -> 'added') x)
      = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.u('e')::text, pg_temp.u('d')::text]) x));
  PERFORM pg_temp.ok('E-INPUT self, a non-friend, a blocked friend, a member and a friend who blocked a member are skipped',
    (SELECT count(*) FROM jsonb_array_elements_text(r -> 'skipped')) = 5
    AND NOT pg_temp.accepted(v_s, 'n1') AND NOT pg_temp.accepted(v_s, 'blk') AND NOT pg_temp.accepted(v_s, 'bb'));
  PERFORM pg_temp.ok('E-INPUT the pending invitee becomes an accepted member with an accepted invite',
    pg_temp.accepted(v_s, 'd')
    AND (SELECT status FROM public.collaboration_invites WHERE session_id = v_s AND invited_user_id = pg_temp.u('d')) = 'accepted');
  PERFORM pg_temp.ok('E-INPUT exactly one members_added line naming the two added people',
    pg_temp.events(v_conv, 'members_added') = 1
    AND (SELECT jsonb_array_length(card_payload -> 'userIds') FROM public.messages
          WHERE conversation_id = v_conv AND card_payload ->> 'event' = 'members_added') = 2);
  v_before := pg_temp.events(v_conv, 'members_added');
  r := pg_temp.call_as('b', format($$SELECT public.add_group_members(%L, ARRAY[%L,%L]::uuid[])$$, v_conv, pg_temp.u('c'), pg_temp.u('b')));
  PERFORM pg_temp.ok('E-INPUT a call where everyone is skipped adds nobody and posts no line',
    r -> 'added' = '[]'::jsonb AND pg_temp.events(v_conv, 'members_added') = v_before);
  v_err := pg_temp.try_as('a', format($$SELECT public.add_group_members(%L, ARRAY[]::uuid[])$$, v_conv));
  PERFORM pg_temp.ok('E-INPUT an empty list is refused', v_err LIKE '22023:%');
  v_err := pg_temp.try_as('a', format($$SELECT public.add_group_members(%L, NULL)$$, v_conv));
  PERFORM pg_temp.ok('E-INPUT a NULL list is refused', v_err LIKE '22023:%');
  v_err := pg_temp.try_as('a', format($$SELECT public.add_group_members(%L, (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 21)))$$, v_conv));
  PERFORM pg_temp.ok('E-INPUT 21 distinct people in one call are refused', v_err LIKE '22023:%');
  v_err := pg_temp.try_as('a', format($$SELECT public.add_group_members(%L, array_fill(%L::uuid, ARRAY[30]))$$, v_conv, pg_temp.u('f1')));
  PERFORM pg_temp.ok('E-INPUT 30 copies of one friend count as one person', v_err = 'ok' AND pg_temp.accepted(v_s, 'f1'));
END $input$;

-- ── E-CAP ───────────────────────────────────────────────────────────────────
DO $cap$
DECLARE v_s uuid; v_conv uuid; v_link jsonb; r jsonb; v_err text; v_req jsonb; v_n bigint;
BEGIN
  v_s := pg_temp.mk_group('cap', ARRAY['a','f1','f2','f3','f4','f5','f6','f7','f8','f9','f10','f11','f12']);
  v_conv := pg_temp.conv_of(v_s);
  v_link := pg_temp.call_as('a', format($$SELECT public.get_or_create_group_link(%L)$$, v_conv));
  PERFORM pg_temp.try_as('a', format($$SELECT public.set_group_link_approval(%L, false)$$, v_conv));
  r := pg_temp.call_as('j', format($$SELECT public.join_group_by_link(%L, NULL)$$, v_link ->> 'token'));
  PERFORM pg_temp.ok('E-CAP 13 + a link join = 14', r ->> 'status' = 'joined' AND pg_temp.n_accepted(v_s) = 14);
  r := pg_temp.call_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('e')));
  PERFORM pg_temp.ok('E-CAP + a direct add = 15', pg_temp.n_accepted(v_s) = 15);
  v_err := pg_temp.try_as('n1', format($$SELECT public.join_group_by_link(%L, NULL)$$, v_link ->> 'token'));
  PERFORM pg_temp.ok('E-CAP a link join at 15 is refused', v_err LIKE 'PT409:conflict_group_full%' AND NOT pg_temp.accepted(v_s, 'n1'));
  v_err := pg_temp.try_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('f13')));
  PERFORM pg_temp.ok('E-CAP a direct add at 15 is refused', v_err LIKE 'PT409:conflict_group_full%' AND NOT pg_temp.accepted(v_s, 'f13'));
  r := pg_temp.call_as('a', format($$SELECT public.add_friend_to_session(%L, %L)$$, v_s, pg_temp.u('f13')));
  PERFORM pg_temp.ok('E-CAP the board-screen invite at 15 says the group is full and writes nothing',
    r ->> 'error_code' = 'session_full'
    AND NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('f13'))
    AND NOT EXISTS (SELECT 1 FROM public.collaboration_invites WHERE session_id = v_s AND invited_user_id = pg_temp.u('f13')));
  -- a join request decided while full
  PERFORM pg_temp.try_as('a', format($$SELECT public.set_group_link_approval(%L, true)$$, v_conv));
  INSERT INTO public.group_join_requests(conversation_id, user_id) VALUES (v_conv, pg_temp.u('n1')) RETURNING to_jsonb(group_join_requests.*) INTO v_req;
  v_err := pg_temp.try_as('a', format($$SELECT public.decide_group_join_request(%L, true)$$, v_req ->> 'id'));
  PERFORM pg_temp.ok('E-CAP approving a join request at 15 lets nobody in',
    v_err <> 'ok' AND NOT pg_temp.accepted(v_s, 'n1') AND pg_temp.n_accepted(v_s) = 15);
  -- a removal frees one place, which the link fills
  PERFORM pg_temp.try_as('a', format($$SELECT public.set_group_link_approval(%L, false)$$, v_conv));
  v_err := pg_temp.try_as('a', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('f1')));
  r := pg_temp.call_as('n1', format($$SELECT public.join_group_by_link(%L, NULL)$$, v_link ->> 'token'));
  PERFORM pg_temp.ok('E-CAP after a removal the next link join fills the freed place exactly',
    v_err = 'ok' AND r ->> 'status' = 'joined' AND pg_temp.n_accepted(v_s) = 15);
  -- create: 15 entries that include the creator and a duplicate are 14 friends
  r := pg_temp.call_as('a', format($$SELECT public.create_group_chat('e7 full', ARRAY[%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L]::uuid[])$$,
    pg_temp.u('a'), pg_temp.u('f1'), pg_temp.u('f2'), pg_temp.u('f3'), pg_temp.u('f4'), pg_temp.u('f5'), pg_temp.u('f6'), pg_temp.u('f7'),
    pg_temp.u('f8'), pg_temp.u('f9'), pg_temp.u('f10'), pg_temp.u('f11'), pg_temp.u('f12'), pg_temp.u('f13'), pg_temp.u('f14'), pg_temp.u('f1')));
  PERFORM pg_temp.ok('E-CAP create with the creator and a duplicate in the list makes a full group of 15',
    pg_temp.n_accepted((r ->> 'sessionId')::uuid) = 15 AND jsonb_array_length(r -> 'added') = 14);
  SELECT count(*) INTO v_n FROM public.collaboration_sessions WHERE name = 'e7 over';
  v_err := pg_temp.try_as('a', format($$SELECT public.create_group_chat('e7 over', ARRAY[%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L]::uuid[])$$,
    pg_temp.u('f1'), pg_temp.u('f2'), pg_temp.u('f3'), pg_temp.u('f4'), pg_temp.u('f5'), pg_temp.u('f6'), pg_temp.u('f7'), pg_temp.u('f8'),
    pg_temp.u('f9'), pg_temp.u('f10'), pg_temp.u('f11'), pg_temp.u('f12'), pg_temp.u('f13'), pg_temp.u('f14'), pg_temp.u('f15')));
  PERFORM pg_temp.ok('E-CAP create with 15 friends is refused and leaves no group behind',
    v_err LIKE 'PT409:conflict_group_full%'
    AND (SELECT count(*) FROM public.collaboration_sessions WHERE name = 'e7 over') = v_n);
END $cap$;

-- ── E-ADMIN ─────────────────────────────────────────────────────────────────
DO $admin$
DECLARE v_s uuid := pg_temp.mk_group('adm', ARRAY['a','b','c','d']); v_conv uuid; v_err text; v_t uuid; v_heir uuid;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  PERFORM pg_temp.try_as('a', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.try_as('a', format($$SELECT public.leave_group_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('E-ADMIN the creator left; b is the only admin', NOT pg_temp.accepted(v_s, 'a') AND pg_temp.admin(v_s, 'b')
    AND NOT pg_temp.admin(v_s, 'c') AND NOT pg_temp.admin(v_s, 'd'));
  v_err := pg_temp.try_as('b', format($$SELECT public.set_group_admin(%L, %L, false)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('E-ADMIN the last admin cannot demote themself', v_err LIKE '42501:last_admin%' AND pg_temp.admin(v_s, 'b'));
  v_err := pg_temp.try_as('b', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('E-ADMIN an admin cannot remove themself (they leave instead)', v_err LIKE '22023:%' AND pg_temp.accepted(v_s, 'b'));
  v_err := pg_temp.try_as('b', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('E-ADMIN the creator who left still cannot be removed or touched', v_err LIKE '42501:creator_protected%');
  v_err := pg_temp.try_as('b', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('E-ADMIN a creator who left cannot be made admin while out', v_err LIKE 'P0002:%');
  v_err := pg_temp.try_as('c', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('c')));
  PERFORM pg_temp.ok('E-ADMIN a member cannot make themself admin', v_err LIKE '42501:not_allowed%' AND NOT pg_temp.admin(v_s, 'c'));
  v_err := pg_temp.try_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('e')));
  PERFORM pg_temp.ok('E-ADMIN the creator who left cannot add people', v_err LIKE '42501:not_allowed%');
  PERFORM pg_temp.try_as('b', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('c')));
  v_err := pg_temp.try_as('b', format($$SELECT public.set_group_admin(%L, %L, false)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('E-ADMIN with a second admin the first may step down', v_err = 'ok' AND NOT pg_temp.admin(v_s, 'b') AND pg_temp.admin(v_s, 'c'));
  PERFORM pg_temp.try_as('c', format($$SELECT public.leave_group_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('E-ADMIN when the last admin leaves the longest-standing member (b, not d) inherits',
    pg_temp.admin(v_s, 'b') AND NOT pg_temp.admin(v_s, 'd')
    AND (SELECT count(*) FROM public.session_participants WHERE session_id = v_s AND has_accepted AND is_admin) = 1);
  -- tie-break: equal join times fall back to the smallest user id
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('e7 tie', pg_temp.u('t1'), 'active') RETURNING id INTO v_t;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at, created_at)
    SELECT v_t, pg_temp.u(x), true, now() - interval '1 hour', now() - interval '1 hour' FROM unnest(ARRAY['t1','t2','t3']) x;
  PERFORM pg_temp.try_as('t1', format($$SELECT public.leave_group_conversation(%L)$$, pg_temp.conv_of(v_t)));
  SELECT user_id INTO v_heir FROM public.session_participants WHERE session_id = v_t AND is_admin;
  PERFORM pg_temp.ok('E-ADMIN a tie in join time hands over to exactly one member, the smallest id',
    v_heir = LEAST(pg_temp.u('t2'), pg_temp.u('t3'))
    AND (SELECT count(*) FROM public.session_participants WHERE session_id = v_t AND is_admin) = 1);
END $admin$;

-- ── E-CHAIN ─────────────────────────────────────────────────────────────────
DO $chain$
DECLARE r jsonb; v_s uuid; v_conv uuid; v_err text;
BEGIN
  r := pg_temp.call_as('a', format($$SELECT public.create_group_chat('e7 chain', ARRAY[%L,%L]::uuid[])$$, pg_temp.u('b'), pg_temp.u('c')));
  v_s := (r ->> 'sessionId')::uuid; v_conv := (r ->> 'conversationId')::uuid;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('d'), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status) VALUES (v_s, pg_temp.u('b'), pg_temp.u('d'), 'pending');
  v_err := pg_temp.try_as('a', format($$SELECT public.leave_group_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('E-CHAIN the creator leaves: the group stays with one admin among b and c',
    v_err = 'ok' AND EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s)
    AND (SELECT count(*) FROM public.session_participants WHERE session_id = v_s AND has_accepted AND is_admin) = 1);
  v_err := pg_temp.try_as('b', format($$SELECT public.leave_group_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('E-CHAIN the second-to-last leaves: the last person is alone, admin, and still in the chat',
    v_err = 'ok' AND pg_temp.n_accepted(v_s) = 1 AND pg_temp.admin(v_s, 'c')
    AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = v_conv AND user_id = pg_temp.u('c')));
  r := pg_temp.call_as('c', format($$SELECT public.chat_plans_for_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('E-CHAIN the person left alone still reads the group', (r ->> 'memberCount')::int = 1);
  v_err := pg_temp.try_as('c', format($$SELECT public.leave_group_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('E-CHAIN the last accepted person leaves: the group, its pending invite and its chat are gone',
    v_err = 'ok' AND NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s)
    AND NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s)
    AND NOT EXISTS (SELECT 1 FROM public.collaboration_invites WHERE session_id = v_s)
    AND NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = v_conv));
END $chain$;

-- ── E-READD ─────────────────────────────────────────────────────────────────
DO $readd$
DECLARE v_s uuid := pg_temp.mk_group('rd', ARRAY['a','b','c']); v_conv uuid; v_plan uuid; v_err text; r jsonb; v_b uuid := pg_temp.u('b');
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  INSERT INTO public.chat_plans(conversation_id, source, created_by, title, when_mode, status)
    VALUES (v_conv, 'chat', pg_temp.u('a'), 'e7 open', 'poll', 'deciding') RETURNING id INTO v_plan;
  INSERT INTO public.chat_plan_rsvps(plan_id, user_id, status) VALUES (v_plan, v_b, 'going');
  PERFORM pg_temp.call_as('b', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'e7-x', %L, '{"title":"X"}'::jsonb, 'right')$$, v_s, v_b));
  v_err := pg_temp.try_as('a', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, v_b));
  PERFORM pg_temp.ok('E-READD the server removes b: rows gone, swipe kept', v_err = 'ok' AND NOT pg_temp.accepted(v_s, 'b')
    AND NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = v_conv AND user_id = v_b)
    AND EXISTS (SELECT 1 FROM public.board_user_swipe_states WHERE session_id = v_s AND user_id = v_b AND experience_id = 'e7-x'));
  v_err := pg_temp.try_as('b', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'e7-y', %L, '{"title":"Y"}'::jsonb, 'right')$$, v_s, v_b));
  PERFORM pg_temp.ok('E-READD a removed member cannot swipe', v_err <> 'ok');
  PERFORM pg_temp.call_as('c', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'e7-x', %L, '{"title":"X"}'::jsonb, 'right')$$, v_s, pg_temp.u('c')));
  PERFORM pg_temp.ok('E-READD while b is out, b''s old swipe plus c''s makes no match',
    NOT EXISTS (SELECT 1 FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'e7-x'));
  r := pg_temp.call_as('a', format($$SELECT public.chat_plans_for_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('E-READD while b is out, b''s RSVP is not counted on the open plan',
    (SELECT p FROM jsonb_array_elements(r -> 'plans') p WHERE p ->> 'id' = v_plan::text) -> 'rsvps' -> 'going' = '[]'::jsonb);
  r := pg_temp.call_as('c', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, v_b));
  PERFORM pg_temp.ok('E-READD any member re-adds b through the server', pg_temp.accepted(v_s, 'b') AND r -> 'added' = to_jsonb(ARRAY[v_b]));
  PERFORM pg_temp.ok('E-READD re-admission by itself creates no match from old swipes',
    NOT EXISTS (SELECT 1 FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'e7-x'));
  PERFORM pg_temp.ok('E-READD re-admission starts b at the group''s deck frontier',
    (SELECT current_position FROM public.session_participants WHERE session_id = v_s AND user_id = v_b)
      = (SELECT max(current_position) FROM public.session_participants WHERE session_id = v_s AND has_accepted));
  r := pg_temp.call_as('a', format($$SELECT public.chat_plans_for_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('E-READD b''s open-plan RSVP counts again once b is back',
    (SELECT p FROM jsonb_array_elements(r -> 'plans') p WHERE p ->> 'id' = v_plan::text) -> 'rsvps' -> 'going' = to_jsonb(ARRAY[v_b]));
END $readd$;

-- ── E-PENDING ───────────────────────────────────────────────────────────────
DO $pending$
DECLARE v_s uuid := pg_temp.mk_group('pd', ARRAY['a','b']); v_conv uuid; v_inv uuid; v_err text;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('d'), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status) VALUES (v_s, pg_temp.u('a'), pg_temp.u('d'), 'pending') RETURNING id INTO v_inv;
  v_err := pg_temp.try_as('a', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('d')));
  PERFORM pg_temp.ok('E-PENDING an admin withdraws a pending invite', v_err = 'ok'
    AND NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('d'))
    AND NOT EXISTS (SELECT 1 FROM public.collaboration_invites WHERE id = v_inv));
  v_err := pg_temp.try_as('d', format($$SELECT public.accept_session_with_prefs(%L, %L, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[], 'walking', 30)$$, v_s, v_inv));
  PERFORM pg_temp.ok('E-PENDING the withdrawn invite can no longer be accepted', v_err <> 'ok' AND NOT pg_temp.accepted(v_s, 'd'));
  v_err := pg_temp.try_as('d', format($$INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (%L, %L, false)$$, v_s, pg_temp.u('d')));
  PERFORM pg_temp.ok('E-PENDING nor can the person put themself back', v_err LIKE '42501:%');
END $pending$;

-- ── E-CLEAR ─────────────────────────────────────────────────────────────────
DO $clear$
DECLARE v_dm uuid; v_cut timestamptz; v_me uuid := pg_temp.u('me'); v_peer uuid := pg_temp.u('peer'); v_unread bigint;
BEGIN
  PERFORM pg_temp.as_server();
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES (v_me, v_peer, 'accepted'), (v_peer, v_me, 'accepted');
  INSERT INTO public.conversations(type, linked_entity_type, created_by) VALUES ('direct', 'direct', v_me) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, v_me), (v_dm, v_peer);
  INSERT INTO k7 VALUES ('dm', v_dm);
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_dm, v_peer, 'before', now() - interval '1 hour');
  v_cut := (pg_temp.call_as('me', format($$SELECT public.set_conversation_lifecycle(%L, 'clear')$$, v_dm)) ->> 'clearedAt')::timestamptz;
  PERFORM pg_temp.as_server();
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES
    (v_dm, v_peer, 'at cutoff', v_cut),
    (v_dm, v_peer, 'just after', v_cut + interval '1 microsecond'),
    (v_dm, v_me, 'mine after', v_cut + interval '2 microseconds');
  PERFORM pg_temp.ok('E-CLEAR the cutoff is the instant stored on my row', (pg_temp.life(v_dm, 'me')).cleared_at = v_cut);
  PERFORM pg_temp.ok('E-CLEAR a message at the cutoff instant is hidden; one microsecond later is shown',
    pg_temp.visible('me', v_dm) = ARRAY['just after', 'mine after']);
  PERFORM pg_temp.ok('E-CLEAR the peer still reads all four', pg_temp.visible('peer', v_dm) = ARRAY['before', 'at cutoff', 'just after', 'mine after']);
  PERFORM pg_temp.as_user('me');
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_unread FROM public.messages m
   WHERE m.conversation_id = v_dm AND m.sender_id IS DISTINCT FROM v_me
     AND NOT EXISTS (SELECT 1 FROM public.message_reads r WHERE r.message_id = m.id AND r.user_id = v_me);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('E-CLEAR my unread count only sees what came after the cutoff', v_unread = 1);
  -- a client cannot backdate a message behind someone's cutoff (or ahead of it)
  PERFORM pg_temp.try_as('peer', format($$INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (%L, %L, 'backdated', now() - interval '1 day')$$, v_dm, v_peer));
  PERFORM pg_temp.as_server();
  PERFORM pg_temp.ok('E-CLEAR a client-sent message gets the server''s time, after the cutoff, and is shown',
    (SELECT created_at FROM public.messages WHERE conversation_id = v_dm AND content = 'backdated') > v_cut
    AND 'backdated' = ANY (pg_temp.visible('me', v_dm)));
END $clear$;

-- ── E-COMBO ─────────────────────────────────────────────────────────────────
DO $combo$
DECLARE v_dm uuid := pg_temp.u('dm'); v_cut timestamptz; l public.conversation_participant_lifecycle; v_listed boolean;
BEGIN
  v_cut := (pg_temp.life(v_dm, 'me')).cleared_at;
  PERFORM pg_temp.call_as('me', format($$SELECT public.set_conversation_lifecycle(%L, 'archive')$$, v_dm));
  PERFORM pg_temp.call_as('me', format($$SELECT public.set_conversation_lifecycle(%L, 'hide')$$, v_dm));
  l := pg_temp.life(v_dm, 'me');
  PERFORM pg_temp.ok('E-COMBO hidden, archived and cleared at once', l.hidden_at IS NOT NULL AND l.archived_at IS NOT NULL AND l.cleared_at = v_cut);
  PERFORM pg_temp.as_server();
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_dm, pg_temp.u('peer'), 'comes back', v_cut + interval '3 microseconds');
  l := pg_temp.life(v_dm, 'me');
  PERFORM pg_temp.ok('E-COMBO their message brings it back still archived, the cutoff unchanged',
    l.hidden_at IS NULL AND l.archived_at IS NOT NULL AND l.cleared_at = v_cut);
  PERFORM pg_temp.as_user('me');
  PERFORM set_config('role', 'authenticated', true);
  SELECT EXISTS (SELECT 1 FROM public.list_connection_conversation_access() a WHERE a.conversation_id = v_dm AND a.archived_at IS NOT NULL) INTO v_listed;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('E-COMBO it is listed again, under Archived', v_listed);
  PERFORM pg_temp.ok('E-COMBO the cleared messages stay cleared', NOT ('before' = ANY (pg_temp.visible('me', v_dm))) AND 'comes back' = ANY (pg_temp.visible('me', v_dm)));
  PERFORM pg_temp.call_as('me', format($$SELECT public.set_conversation_lifecycle(%L, 'hide')$$, v_dm));
  PERFORM pg_temp.as_server();
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_dm, pg_temp.u('me'), 'my own', v_cut + interval '4 microseconds');
  l := pg_temp.life(v_dm, 'me');
  PERFORM pg_temp.ok('E-COMBO my own message also brings it back archived', l.hidden_at IS NULL AND l.archived_at IS NOT NULL);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type) VALUES (v_dm, NULL, 'system line', 'system');
  PERFORM pg_temp.call_as('me', format($$SELECT public.set_conversation_lifecycle(%L, 'hide')$$, v_dm));
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type) VALUES (v_dm, NULL, 'system line 2', 'system');
  PERFORM pg_temp.ok('E-COMBO a system line never brings it back', (pg_temp.life(v_dm, 'me')).hidden_at IS NOT NULL);
END $combo$;

-- ── E-REJOIN ────────────────────────────────────────────────────────────────
DO $rejoin$
DECLARE v_s uuid := pg_temp.mk_group('rj', ARRAY['g1','me','peer']); v_conv uuid; v_link jsonb; r jsonb;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  PERFORM pg_temp.as_server();
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_conv, pg_temp.u('g1'), 'group old', now() - interval '1 hour');
  PERFORM pg_temp.call_as('me', format($$SELECT public.set_conversation_lifecycle(%L, 'clear')$$, v_conv));
  PERFORM pg_temp.ok('E-REJOIN my clear hides the group''s old message only for me',
    NOT ('group old' = ANY (pg_temp.visible('me', v_conv))) AND 'group old' = ANY (pg_temp.visible('peer', v_conv)));
  PERFORM pg_temp.try_as('me', format($$SELECT public.leave_group_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('E-REJOIN leaving drops my lifecycle row with its cutoff', (pg_temp.life(v_conv, 'me')).conversation_id IS NULL);
  PERFORM pg_temp.as_server();
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_conv, pg_temp.u('g1'), 'while away', now() - interval '1 minute');
  v_link := pg_temp.call_as('g1', format($$SELECT public.get_or_create_group_link(%L)$$, v_conv));
  PERFORM pg_temp.try_as('g1', format($$SELECT public.set_group_link_approval(%L, false)$$, v_conv));
  r := pg_temp.call_as('me', format($$SELECT public.join_group_by_link(%L, NULL)$$, v_link ->> 'token'));
  PERFORM pg_temp.as_server();
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_conv, pg_temp.u('g1'), 'after rejoin', now() + interval '1 second');
  PERFORM pg_temp.ok('E-REJOIN back by link, I see only what was sent after I rejoined',
    r ->> 'status' = 'joined' AND pg_temp.visible('me', v_conv) = ARRAY['after rejoin']);
END $rejoin$;

-- ── E-OLDAPP ────────────────────────────────────────────────────────────────
DO $oldapp$
DECLARE v_s uuid; v_inv uuid; v_err text; r jsonb; v_conv uuid; v_link jsonb; v_a uuid := pg_temp.u('a'); v_b uuid := pg_temp.u('b');
BEGIN
  -- today's create: client inserts a pending session, the creator row, a pending invitee
  PERFORM pg_temp.as_user('a');
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('e7 old app', v_a, 'pending') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at) VALUES (v_s, v_a, true, now());
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status, invite_method)
    VALUES (v_s, v_a, v_b, 'pending', 'friends_list') RETURNING id INTO v_inv;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, v_b, false);
  UPDATE public.collaboration_sessions SET updated_at = now() WHERE id = v_s;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('E-OLDAPP the client-made pending group with its creator survives every write',
    EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s AND status = 'pending'));
  v_err := pg_temp.try_as('b', format($$SELECT public.accept_session_with_prefs(%L, %L, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[], 'walking', 30)$$, v_s, v_inv));
  PERFORM pg_temp.ok('E-OLDAPP the invitee accepts as today', v_err = 'ok' AND pg_temp.accepted(v_s, 'b'));
  v_err := pg_temp.try_as('a', format($$UPDATE public.collaboration_sessions SET status = 'active' WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('E-OLDAPP the client still activates the group at two', v_err = 'ok');
  r := pg_temp.call_as('b', format($$SELECT public.add_friend_to_session(%L, %L)$$, v_s, pg_temp.u('d')));
  PERFORM pg_temp.ok('E-OLDAPP a board-screen invite from an accepted member is a pending invite, inside today''s outcomes',
    r ->> 'outcome' = 'invited' AND NOT pg_temp.accepted(v_s, 'd'));
  v_err := pg_temp.try_as('a', format($$UPDATE public.session_participants SET is_admin = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('b')));
  PERFORM pg_temp.ok('E-OLDAPP the creator''s direct promote still works', v_err = 'ok' AND pg_temp.admin(v_s, 'b'));
  v_err := pg_temp.try_as('d', format($$UPDATE public.session_participants SET is_admin = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('d')));
  PERFORM pg_temp.ok('E-OLDAPP a non-creator''s direct admin write on their own row stays refused', v_err LIKE '42501:%');
  PERFORM pg_temp.ok('E-OLDAPP a non-creator''s direct write on someone else''s row touches nothing',
    pg_temp.rows_as('b', format($$UPDATE public.session_participants SET notifications_muted = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('a'))) <= 0);
  -- lifecycle actions today's app sends keep their answer shape
  v_conv := pg_temp.conv_of(v_s);
  r := pg_temp.call_as('b', format($$SELECT public.set_conversation_lifecycle(%L, 'archive')$$, v_conv));
  PERFORM pg_temp.ok('E-OLDAPP archive answers with the keys today''s app reads',
    r ? 'conversationId' AND r ? 'hiddenAt' AND r ? 'archivedAt' AND r ->> 'archivedAt' IS NOT NULL AND r ->> 'clearedAt' IS NULL);
  r := pg_temp.call_as('b', format($$SELECT public.set_conversation_lifecycle(%L, 'unarchive')$$, v_conv));
  PERFORM pg_temp.ok('E-OLDAPP unarchive as today', r ->> 'archivedAt' IS NULL);
  v_err := pg_temp.try_as('b', format($$SELECT public.set_conversation_lifecycle(%L, 'delete')$$, v_conv));
  PERFORM pg_temp.ok('E-OLDAPP an unknown action is still refused', v_err LIKE '22023:%');
  -- link join as today's app reads it
  v_link := pg_temp.call_as('a', format($$SELECT public.get_or_create_group_link(%L)$$, v_conv));
  PERFORM pg_temp.try_as('a', format($$SELECT public.set_group_link_approval(%L, false)$$, v_conv));
  r := pg_temp.call_as('e', format($$SELECT public.join_group_by_link(%L, NULL)$$, v_link ->> 'token'));
  PERFORM pg_temp.ok('E-OLDAPP a link join answers joined with the session id (today''s mapper opens the chat)',
    r ->> 'status' = 'joined' AND (r ->> 'sessionId')::uuid = v_s AND pg_temp.accepted(v_s, 'e'));
  -- today's leave: delete my own row; a 3-person group stays
  v_err := pg_temp.try_as('e', format($$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('e')));
  PERFORM pg_temp.ok('E-OLDAPP own-row leave works and keeps the group', v_err = 'ok' AND NOT pg_temp.accepted(v_s, 'e')
    AND EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $oldapp$;

-- ── E-MUTE ──────────────────────────────────────────────────────────────────
DO $mute$
DECLARE v_s uuid := pg_temp.mk_group('mu', ARRAY['a','b','c']); v_n bigint;
BEGIN
  v_n := pg_temp.rows_as('b', format($$UPDATE public.session_participants SET notifications_muted = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('b')));
  PERFORM pg_temp.ok('E-MUTE a member mutes their own group notifications',
    v_n = 1 AND (SELECT notifications_muted FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b')));
  v_n := pg_temp.rows_as('c', format($$UPDATE public.session_participants SET notifications_muted = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('a')));
  PERFORM pg_temp.ok('E-MUTE another member cannot mute someone else',
    v_n <= 0 AND NOT (SELECT notifications_muted FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('a')));
END $mute$;

ROLLBACK;
