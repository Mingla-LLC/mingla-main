\set ON_ERROR_STOP on

-- #4435 QA round 2: independent tester suite for 20280709004435 (group QA
-- fixes), from angles the implementor suite does not take. Runs on the fully
-- replayed PG17 schema; everything rolls back.
--
-- MINGLA-INVARIANT: I-4435-QA2-LIVE-APP | issue #4435 | the live Explorer app's client-side group calls (create order, creator reads, presence, accept, admin toggle, revoke, lock-in, delete, cancel, 1:1 plan) keep working after the membership tightening, and people who left can come back through a new invite or the link (T-LIVE, T-EXIT, T-REJOIN, T-CAP, T-ORPHAN, T-GRANT)
--
--   T-LIVE   the live app's exact client sequences, as the signed-in client.
--   T-EXIT   the live app's "exit board" after the creator leaves a group of
--            two: its follow-up deletes are refused, the group stays with an
--            heir admin, and the other person keeps it.
--   T-REJOIN a person who left comes back through a new invite (board invite
--            or Add people) or the group link, even though the old invite is
--            gone; a creator who left and is re-invited comes back as an
--            ordinary member (#4435 leftovers: the creator's role passed on).
--   T-CAP    the 15 cap at accept counts accepted rows only, a lowered cap is
--            honoured, and a full group's members still update their rows.
--   T-ORPHAN a group whose creator is in the chat but was never a group
--            member (one exists in production) has no manager under the new
--            rule; its members still use it.
--   T-GRANT  the new helper is not callable without signing in.

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
-- p_sql as the client p_tag: 'ok:<rows>' or 'SQLSTATE:message'.
CREATE FUNCTION pg_temp.try_as(p_tag text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text; n bigint;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN r := SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
-- one scalar read as the client p_tag (NULL on error).
CREATE FUNCTION pg_temp.val_as(p_tag text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql INTO r;
  EXCEPTION WHEN OTHERS THEN r := NULL;
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
-- Runs (tag, sql) pairs in order as the client; returns each try_as result
-- joined by '|'. (Postgres does not promise left-to-right AND evaluation, so
-- every write runs here, in order, before any check reads the outcome.)
CREATE FUNCTION pg_temp.steps(VARIADIC p text[]) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE i int := 1; out text[] := ARRAY[]::text[];
BEGIN
  WHILE i < array_length(p, 1) LOOP
    out := out || pg_temp.try_as(p[i], p[i + 1]);
    i := i + 2;
  END LOOP;
  RETURN array_to_string(out, '|');
END $f$;
CREATE FUNCTION pg_temp.accepted(p_session uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = p_session AND user_id = pg_temp.u(p_tag) AND has_accepted)
$f$;
CREATE FUNCTION pg_temp.n_accepted(p_session uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM public.session_participants WHERE session_id = p_session AND has_accepted
$f$;
CREATE FUNCTION pg_temp.accept_sql(p_session uuid, p_invite uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT format($q$SELECT public.accept_session_with_prefs(%L, %L, NULL, NULL, ARRAY['nature'], ARRAY[]::text[], 'walking', 30)$q$, p_session, p_invite)
$f$;
CREATE FUNCTION pg_temp.invite_of(p_session uuid, p_tag text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.collaboration_invites WHERE session_id = p_session AND invited_user_id = pg_temp.u(p_tag)
   ORDER BY created_at DESC LIMIT 1
$f$;
-- The live app's createCollaborativeSession: session, own accepted row, then
-- per friend a pending row and a pending invite, all as the client.
CREATE FUNCTION pg_temp.live_create(p_creator text, p_name text, p_friends text[]) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_s uuid; v_t text; r text;
BEGIN
  v_s := pg_temp.val_as(p_creator, format($q$INSERT INTO public.collaboration_sessions(name, created_by, status, board_id) VALUES (%L, %L, 'pending', NULL) RETURNING id::text$q$, p_name, pg_temp.u(p_creator)))::uuid;
  IF v_s IS NULL THEN RAISE EXCEPTION 'FAIL live_create session insert'; END IF;
  r := pg_temp.try_as(p_creator, format($q$INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at) VALUES (%L, %L, true, now())$q$, v_s, pg_temp.u(p_creator)));
  IF r <> 'ok:1' THEN RAISE EXCEPTION 'FAIL live_create own row: %', r; END IF;
  FOREACH v_t IN ARRAY p_friends LOOP
    r := pg_temp.try_as(p_creator, format($q$INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (%L, %L, false)$q$, v_s, pg_temp.u(v_t)));
    IF r <> 'ok:1' THEN RAISE EXCEPTION 'FAIL live_create invitee row %: %', v_t, r; END IF;
    r := pg_temp.try_as(p_creator, format($q$INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status, pending_friendship) VALUES (%L, %L, %L, 'pending', false) RETURNING id$q$, v_s, pg_temp.u(p_creator), pg_temp.u(v_t)));
    IF r <> 'ok:1' THEN RAISE EXCEPTION 'FAIL live_create invite %: %', v_t, r; END IF;
  END LOOP;
  RETURN v_s;
END $f$;

DO $fixture$
DECLARE v_tag text; v_id uuid; i int;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['a','b','c','d','e','x'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'q2-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'q2-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag)) ON CONFLICT (id) DO NOTHING;
    INSERT INTO kq VALUES (v_tag, v_id);
  END LOOP;
  FOR i IN 1..16 LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'q2-f' || i || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'q2-f' || i || '-' || v_id || '@example.test', 'F' || i, 'F' || i) ON CONFLICT (id) DO NOTHING;
    INSERT INTO kq VALUES ('f' || i, v_id);
  END LOOP;
  -- everyone is friends with everyone (the add paths need friendship)
  INSERT INTO public.friends(user_id, friend_user_id, status)
    SELECT p.id, q.id, 'accepted' FROM kq p, kq q WHERE p.id <> q.id;
END $fixture$;

-- ── T-LIVE ──────────────────────────────────────────────────────────────────
DO $live$
DECLARE v_s uuid; r text; v_card uuid; v_conv uuid; v_j jsonb;
BEGIN
  v_s := pg_temp.live_create('a', 'q2 live', ARRAY['b','c','d']);
  PERFORM pg_temp.ok('T-LIVE the live create order works (session, own row, pending rows and invites)',
    pg_temp.n_accepted(v_s) = 1 AND (SELECT count(*) FROM public.collaboration_invites WHERE session_id = v_s AND status = 'pending') = 3);
  PERFORM pg_temp.ok('T-LIVE the creator reads every invite and every row of the group',
    pg_temp.val_as('a', format($q$SELECT count(*)::text FROM public.collaboration_invites WHERE session_id = %L$q$, v_s)) = '3'
    AND pg_temp.val_as('a', format($q$SELECT count(*)::text FROM public.session_participants WHERE session_id = %L$q$, v_s)) = '4');
  r := pg_temp.try_as('a', format($q$INSERT INTO public.board_participant_presence(session_id, user_id, is_online, last_seen_at) VALUES (%L, %L, true, now()) ON CONFLICT (session_id, user_id) DO UPDATE SET is_online = true$q$, v_s, pg_temp.u('a')));
  PERFORM pg_temp.ok('T-LIVE the creator''s presence upsert works', r = 'ok:1');
  r := pg_temp.try_as('b', format($q$INSERT INTO public.board_participant_presence(session_id, user_id, is_online, last_seen_at) VALUES (%L, %L, true, now()) ON CONFLICT (session_id, user_id) DO UPDATE SET is_online = true$q$, v_s, pg_temp.u('b')));
  PERFORM pg_temp.ok('T-LIVE a pending invitee''s presence upsert works', r = 'ok:1');
  PERFORM pg_temp.ok('T-LIVE the first invitee accepts', pg_temp.try_as('b', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'b'))) = 'ok:1');
  PERFORM pg_temp.ok('T-LIVE the second invitee accepts', pg_temp.try_as('c', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'c'))) = 'ok:1');
  PERFORM pg_temp.ok('T-LIVE the accepting client activates the group',
    pg_temp.try_as('b', format($q$UPDATE public.collaboration_sessions SET status = 'active', updated_at = now() WHERE id = %L AND status = 'pending'$q$, v_s)) = 'ok:1');
  r := pg_temp.steps('a', format($q$UPDATE public.session_participants SET is_admin = true WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('b')),
                     'a', format($q$UPDATE public.session_participants SET is_admin = false WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('b')));
  PERFORM pg_temp.ok('T-LIVE the creator makes and unmakes an admin directly', r = 'ok:1|ok:1');
  r := pg_temp.steps('a', format($q$DELETE FROM public.collaboration_invites WHERE session_id = %L AND invited_user_id = %L AND status = 'pending'$q$, v_s, pg_temp.u('d')),
                     'a', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L AND has_accepted = false$q$, v_s, pg_temp.u('d')));
  PERFORM pg_temp.ok('T-LIVE the creator revokes a pending invite and its pending row', r = 'ok:1|ok:1');
  INSERT INTO public.board_saved_cards(session_id, experience_id, card_data, saved_by)
    VALUES (v_s, 'q2-exp-1', '{"title":"Q2"}', pg_temp.u('a')) RETURNING id INTO v_card;
  r := pg_temp.try_as('a', format($q$SELECT public.rpc_admin_lock_and_schedule_card(%L, %L, now() + interval '2 days', 60)$q$, v_s, v_card));
  PERFORM pg_temp.ok('T-LIVE the creator locks a deck card in', r = 'ok:1' AND (SELECT is_locked FROM public.board_saved_cards WHERE id = v_card));
  r := pg_temp.steps('a', format($q$DELETE FROM public.collaboration_invites WHERE session_id = %L AND invited_user_id = %L$q$, v_s, pg_temp.u('c')),
                     'a', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('c')));
  PERFORM pg_temp.ok('T-LIVE the creator removes a member (invite, then row)', r = 'ok:1|ok:1' AND NOT pg_temp.accepted(v_s, 'c'));
  -- the creator deletes the whole group: partners first, then the session
  r := pg_temp.steps('a', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id <> %L$q$, v_s, pg_temp.u('a')),
                     'a', format($q$DELETE FROM public.collaboration_sessions WHERE id = %L$q$, v_s));
  PERFORM pg_temp.ok('T-LIVE the creator deletes the group (partners first, then the session)',
    r = 'ok:1|ok:1' AND NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  -- cancel a pending collab chat (nobody accepted yet): every write succeeds
  v_s := pg_temp.live_create('a', 'q2 pending', ARRAY['e']);
  r := pg_temp.steps('a', format($q$DELETE FROM public.collaboration_invites WHERE session_id = %L$q$, v_s),
                     'a', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id <> %L$q$, v_s, pg_temp.u('a')),
                     'a', format($q$DELETE FROM public.collaboration_sessions WHERE id = %L$q$, v_s));
  PERFORM pg_temp.ok('T-LIVE the creator cancels a pending group (invites, rows, session)',
    r = 'ok:1|ok:1|ok:1' AND NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  -- a half-made group (insert failed before the own row) is still cleaned up
  v_s := pg_temp.val_as('a', format($q$INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('q2 ghost', %L, 'pending') RETURNING id::text$q$, pg_temp.u('a')))::uuid;
  r := pg_temp.try_as('a', format($q$DELETE FROM public.collaboration_sessions WHERE id = %L$q$, v_s));
  PERFORM pg_temp.ok('T-LIVE a ghost group with no rows is deleted by its creator',
    r = 'ok:1' AND NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  -- the 1:1 plan (start_dm_collab / accept / end)
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', pg_temp.u('a')) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_conv, pg_temp.u('a')), (v_conv, pg_temp.u('b'));
  v_j := pg_temp.val_as('a', format($q$SELECT public.start_dm_collab(%L, 'q2 dm')::text$q$, v_conv))::jsonb;
  v_s := (v_j ->> 'session_id')::uuid;
  PERFORM pg_temp.ok('T-LIVE the 1:1 plan starts', v_s IS NOT NULL);
  r := pg_temp.try_as('b', pg_temp.accept_sql(v_s, (v_j ->> 'invite_id')::uuid));
  PERFORM pg_temp.ok('T-LIVE the friend accepts the 1:1 plan', r = 'ok:1' AND pg_temp.n_accepted(v_s) = 2);
  r := pg_temp.try_as('a', format($q$SELECT public.end_dm_collab(%L)$q$, v_s));
  PERFORM pg_temp.ok('T-LIVE the starter ends the 1:1 plan', r = 'ok:1');
END $live$;

-- ── T-EXIT ──────────────────────────────────────────────────────────────────
DO $exit$
DECLARE v_s uuid; r3 text; r4 text;
BEGIN
  v_s := pg_temp.live_create('a', 'q2 exit', ARRAY['b']);
  PERFORM pg_temp.try_as('b', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'b')));
  -- SessionViewModal: count (2), delete own row, then "auto-delete" the rest
  PERFORM pg_temp.ok('T-EXIT the creator''s own-row leave works',
    pg_temp.try_as('a', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('a'))) = 'ok:1');
  r3 := pg_temp.try_as('a', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id <> %L$q$, v_s, pg_temp.u('a')));
  r4 := pg_temp.try_as('a', format($q$DELETE FROM public.collaboration_sessions WHERE id = %L$q$, v_s));
  PERFORM pg_temp.ok('T-EXIT the creator who left removes nobody afterwards', r3 = 'ok:0' AND pg_temp.accepted(v_s, 'b'));
  -- #4435 leftovers: b took over the creator's role, so row security hides the
  -- group from a's delete (no row, no error; the app only logs either way).
  PERFORM pg_temp.ok('T-EXIT the creator who left cannot delete the group (a refusal the app only logs)',
    r4 = 'ok:0' AND (SELECT created_by FROM public.collaboration_sessions WHERE id = v_s) = pg_temp.u('b'));
  PERFORM pg_temp.ok('T-EXIT the other person keeps the group and becomes its admin',
    EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s)
    AND (SELECT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b')));
  PERFORM pg_temp.ok('T-EXIT the follow-up invite decline touches nothing and does not fail',
    pg_temp.try_as('a', format($q$UPDATE public.collaboration_invites SET status = 'declined' WHERE session_id = %L AND invited_user_id = %L AND status = 'pending'$q$, v_s, pg_temp.u('a'))) = 'ok:0');
  INSERT INTO kq VALUES ('s_exit', v_s);
END $exit$;

-- ── T-REJOIN ────────────────────────────────────────────────────────────────
DO $rejoin$
DECLARE v_s uuid; r text; v_conv uuid; v_link jsonb; v_j jsonb;
BEGIN
  v_s := pg_temp.live_create('a', 'q2 rejoin', ARRAY['b','c']);
  PERFORM pg_temp.try_as('b', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'b')));
  PERFORM pg_temp.try_as('c', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'c')));
  -- C leaves the live-app way (own row, then decline)
  PERFORM pg_temp.try_as('c', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('c')));
  PERFORM pg_temp.ok('T-REJOIN leaving removed the leaver''s invite',
    NOT EXISTS (SELECT 1 FROM public.collaboration_invites WHERE session_id = v_s AND invited_user_id = pg_temp.u('c')));
  -- a board-screen invite (add_friend_to_session) brings C back as a pending invite
  v_j := pg_temp.val_as('b', format($q$SELECT public.add_friend_to_session(%L, %L)::text$q$, v_s, pg_temp.u('c')))::jsonb;
  PERFORM pg_temp.ok('T-REJOIN a member re-invites the person who left', v_j ->> 'outcome' = 'invited');
  PERFORM pg_temp.ok('T-REJOIN the new invite is accepted and they are back',
    pg_temp.try_as('c', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'c'))) = 'ok:1' AND pg_temp.accepted(v_s, 'c'));
  -- C leaves again and comes back by the group link
  PERFORM pg_temp.try_as('c', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('c')));
  v_conv := (SELECT id FROM public.conversations WHERE session_id = v_s AND linked_entity_type = 'session');
  v_link := pg_temp.val_as('a', format($q$SELECT public.get_or_create_group_link(%L)::text$q$, v_conv))::jsonb;
  PERFORM pg_temp.try_as('a', format($q$SELECT public.set_group_link_approval(%L, false)$q$, v_conv));
  v_j := pg_temp.val_as('c', format($q$SELECT public.join_group_by_link(%L, NULL)::text$q$, v_link ->> 'token'))::jsonb;
  PERFORM pg_temp.ok('T-REJOIN the person who left comes back by the group link',
    v_j ->> 'status' = 'joined' AND pg_temp.accepted(v_s, 'c'));
  -- Add people (add_group_members) after a leave
  PERFORM pg_temp.try_as('c', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('c')));
  r := pg_temp.try_as('b', format($q$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$q$, v_conv, pg_temp.u('c')));
  PERFORM pg_temp.ok('T-REJOIN Add people brings the person who left straight back', r = 'ok:1' AND pg_temp.accepted(v_s, 'c'));
  -- the creator leaves, is re-invited, accepts: they are an ordinary member
  -- (#4435 leftovers, Seth's decision; before this it was the creator again)
  PERFORM pg_temp.try_as('a', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('a')));
  PERFORM pg_temp.ok('T-REJOIN a creator who left is not the creator', NOT public.is_session_creator(v_s, pg_temp.u('a')));
  v_j := pg_temp.val_as('b', format($q$SELECT public.add_friend_to_session(%L, %L)::text$q$, v_s, pg_temp.u('a')))::jsonb;
  r := pg_temp.try_as('a', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'a')));
  PERFORM pg_temp.ok('T-REJOIN the creator who left can be re-invited and accept', v_j ->> 'outcome' = 'invited' AND r = 'ok:1');
  r := pg_temp.try_as('a', format($q$UPDATE public.session_participants SET is_admin = false WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('b')));
  PERFORM pg_temp.ok('T-REJOIN back as a member, the old creator is an ordinary member and the heir keeps the role',
    NOT public.is_session_creator(v_s, pg_temp.u('a'))
    AND (SELECT created_by FROM public.collaboration_sessions WHERE id = v_s) IN (pg_temp.u('b'), pg_temp.u('c'))
    AND public.is_session_creator(v_s, (SELECT created_by FROM public.collaboration_sessions WHERE id = v_s))
    AND (SELECT sp.is_admin FROM public.session_participants sp JOIN public.collaboration_sessions cs
          ON cs.id = sp.session_id AND cs.created_by = sp.user_id WHERE cs.id = v_s)
    AND r = 'ok:0');
END $rejoin$;

-- ── T-CAP ───────────────────────────────────────────────────────────────────
DO $cap$
DECLARE v_s uuid; i int; r text; v_inv uuid;
BEGIN
  v_s := pg_temp.live_create('a', 'q2 cap', ARRAY['x']);  -- x stays pending
  FOR i IN 1..14 LOOP
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at) VALUES (v_s, pg_temp.u('f' || i), true, now());
  END LOOP;
  PERFORM pg_temp.ok('T-CAP fixture: 15 accepted plus one pending invitee', pg_temp.n_accepted(v_s) = 15);
  r := pg_temp.try_as('x', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'x')));
  PERFORM pg_temp.ok('T-CAP a pending invitee cannot accept into a full group (pending rows are not counted as members)',
    r LIKE 'PT409:%' AND NOT pg_temp.accepted(v_s, 'x')
    AND (SELECT status FROM public.collaboration_invites WHERE id = pg_temp.invite_of(v_s, 'x')) = 'pending');
  PERFORM pg_temp.ok('T-CAP a member of the full group still saves their deck position',
    pg_temp.try_as('f3', format($q$UPDATE public.session_participants SET notifications_muted = true WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('f3'))) = 'ok:1');
  -- one leaves: the waiting invitee gets in, the 16th friend does not
  PERFORM pg_temp.try_as('f14', format($q$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('f14')));
  PERFORM pg_temp.ok('T-CAP after one leaves the waiting invitee gets in',
    pg_temp.try_as('x', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'x'))) = 'ok:1' AND pg_temp.n_accepted(v_s) = 15);
  -- a lowered cap is honoured at accept
  v_s := pg_temp.live_create('a', 'q2 small', ARRAY['b','c']);
  UPDATE public.collaboration_sessions SET max_participants = 2 WHERE id = v_s;
  PERFORM pg_temp.ok('T-CAP a group capped at 2 takes its first invitee', pg_temp.try_as('b', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'b'))) = 'ok:1');
  PERFORM pg_temp.ok('T-CAP and refuses the next', pg_temp.try_as('c', pg_temp.accept_sql(v_s, pg_temp.invite_of(v_s, 'c'))) LIKE 'PT409:%');
END $cap$;

-- ── T-ORPHAN ────────────────────────────────────────────────────────────────
DO $orphan$
DECLARE v_s uuid; v_conv uuid; r text;
BEGIN
  -- the production shape: creator a is in the group chat but has no group row;
  -- three accepted members, no admin.
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('q2 orphan', pg_temp.u('a'), 'active') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at) VALUES
    (v_s, pg_temp.u('b'), true, now()), (v_s, pg_temp.u('c'), true, now()), (v_s, pg_temp.u('d'), true, now());
  v_conv := (SELECT id FROM public.conversations WHERE session_id = v_s AND linked_entity_type = 'session');
  IF v_conv IS NOT NULL THEN
    INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_conv, pg_temp.u('a')) ON CONFLICT DO NOTHING;
  END IF;
  PERFORM pg_temp.ok('T-ORPHAN the non-member creator has no creator powers', NOT public.is_session_creator(v_s, pg_temp.u('a')));
  PERFORM pg_temp.ok('T-ORPHAN nobody in the group is an admin', NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s AND is_admin));
  PERFORM pg_temp.ok('T-ORPHAN members still rename the group',
    pg_temp.try_as('b', format($q$UPDATE public.collaboration_sessions SET name = 'q2 orphan 2' WHERE id = %L$q$, v_s)) = 'ok:1');
  r := pg_temp.try_as('b', format($q$UPDATE public.session_participants SET is_admin = true WHERE session_id = %L AND user_id = %L$q$, v_s, pg_temp.u('c')));
  PERFORM pg_temp.ok('T-ORPHAN no member can make an admin directly', (r LIKE '42501:%' OR r = 'ok:0')
    AND NOT (SELECT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('c')));
  r := pg_temp.try_as('b', format($q$SELECT public.set_group_admin(%L, %L, true)$q$, v_conv, pg_temp.u('c')));
  PERFORM pg_temp.ok('T-ORPHAN no member can make an admin through the server either', r NOT LIKE 'ok:%'
    AND NOT (SELECT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('c')));
  PERFORM pg_temp.ok('T-ORPHAN the non-member creator cannot delete it', pg_temp.try_as('a', format($q$DELETE FROM public.collaboration_sessions WHERE id = %L$q$, v_s)) LIKE '42501:%');
END $orphan$;

-- ── T-GRANT ─────────────────────────────────────────────────────────────────
DO $grant$
BEGIN
  PERFORM pg_temp.ok('T-GRANT the new helper is not callable signed out',
    NOT has_function_privilege('anon', 'public.issue_4435_has_accepted_member(uuid)', 'EXECUTE'));
  PERFORM pg_temp.ok('T-GRANT the new trigger functions are not callable by the client',
    NOT has_function_privilege('authenticated', 'public.tg_issue_4435_group_cap()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.tg_issue_4435_leave_clears_invite()', 'EXECUTE'));
END $grant$;

ROLLBACK;
