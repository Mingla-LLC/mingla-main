\set ON_ERROR_STOP on

-- #4435 follow-up (QA round 1) regression suite for
-- 20280709004435_issue_4435_group_qa_fixes.sql. Runs on the fully replayed
-- PG17 schema; everything rolls back.
--
-- MINGLA-INVARIANT: I-4435-ACCEPT-CAP-AND-LIVE-INVITE | issue #4435 | accepting an invite never takes a group past its cap, and only a pending invite (or a repeat by a current member) is accepted (Q-CAP, Q-INVITE)
-- MINGLA-INVARIANT: I-4435-LEAVE-CLEARS-INVITE | issue #4435 | an accepted member leaving, by any path, takes their accepted invite with them (Q-LEAVE)
-- MINGLA-INVARIANT: I-4435-CURRENT-CREATOR-ONLY | issue #4435 | the creator's extra say over members, admins, settings, deleting the group and locking a plan holds only while the creator is an accepted member (Q-CREATOR)
-- MINGLA-INVARIANT: I-4435-MATCH-VOTES-CURRENT-MEMBERS | issue #4435 | a new match gets votes only from right-swipers who are still accepted members (Q-VOTES)
--
--   Q-CAP      a group of 14 with two older pending invites: the first accept
--              makes 15, the second is refused (PT409) and changes nothing;
--              the row backstop refuses any other path; updates and repeats
--              of accepted rows in a full group still work.
--   Q-INVITE   a declined invite, or an accepted invite left behind by
--              someone who is not a member, cannot be accepted; a repeated
--              accept by a current member still answers.
--   Q-LEAVE    leave_group_conversation, an own-row delete and
--              remove_group_member each delete the leaver's accepted invite;
--              the old invite cannot bring them back.
--   Q-CREATOR  a creator who left cannot remove members, change admins,
--              change group settings, delete the group, re-add themself,
--              count as a group admin, lock a deck plan or lock a card; a
--              creator who is still a member can; today's client create
--              (creator row, then invitees) and a half-made group's delete
--              still work.
--   Q-VOTES    a removed member's earlier right swipe adds no vote to a new
--              match made by current members.

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
    VALUES ('q8 ' || p_tag, pg_temp.u(p_members[1]), 'active') RETURNING id INTO v_s;
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
-- A pending invitee row plus pending invite from p_inviter.
CREATE FUNCTION pg_temp.invite(p_session uuid, p_inviter text, p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (p_session, pg_temp.u(p_tag), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status)
    VALUES (p_session, pg_temp.u(p_inviter), pg_temp.u(p_tag), 'pending') RETURNING id INTO v;
  RETURN v;
END $f$;

DO $fixture$
DECLARE v_tag text; v_id uuid; i int;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['a','b','c','d','e','p1','p2','x'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'q8-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'q8-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO kq VALUES (v_tag, v_id);
  END LOOP;
  FOR i IN 1..14 LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'q8-f' || i || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'q8-f' || i || '-' || v_id || '@example.test', 'F' || i, 'F' || i) ON CONFLICT (id) DO NOTHING;
    INSERT INTO kq VALUES ('f' || i, v_id);
  END LOOP;
  FOR v_tag IN SELECT tag FROM kq WHERE tag <> 'a' LOOP
    INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
      (pg_temp.u('a'), pg_temp.u(v_tag), 'accepted'), (pg_temp.u(v_tag), pg_temp.u('a'), 'accepted');
  END LOOP;
END $fixture$;

-- ── Q-CAP ───────────────────────────────────────────────────────────────────
DO $cap$
DECLARE v_s uuid; v_i1 uuid; v_i2 uuid; v_err text; v_n bigint;
BEGIN
  v_s := pg_temp.mk_group('cap', ARRAY['a','f1','f2','f3','f4','f5','f6','f7','f8','f9','f10','f11','f12','f13']);
  v_i1 := pg_temp.invite(v_s, 'a', 'p1');
  v_i2 := pg_temp.invite(v_s, 'a', 'p2');
  PERFORM pg_temp.ok('Q-CAP the group starts at 14 with two older pending invites', pg_temp.n_accepted(v_s) = 14);
  v_err := pg_temp.try_as('p1', pg_temp.accept_sql(v_s, v_i1));
  PERFORM pg_temp.ok('Q-CAP the first accept makes 15', v_err = 'ok' AND pg_temp.n_accepted(v_s) = 15 AND pg_temp.accepted(v_s, 'p1'));
  v_err := pg_temp.try_as('p2', pg_temp.accept_sql(v_s, v_i2));
  PERFORM pg_temp.ok('Q-CAP the second accept is refused as full and changes nothing',
    v_err LIKE 'PT409:conflict_group_full%' AND pg_temp.n_accepted(v_s) = 15 AND NOT pg_temp.accepted(v_s, 'p2')
    AND (SELECT status FROM public.collaboration_invites WHERE id = v_i2) = 'pending');
  v_err := pg_temp.try_as('p1', pg_temp.accept_sql(v_s, v_i1));
  PERFORM pg_temp.ok('Q-CAP a repeated accept by a member of the full group still answers', v_err = 'ok' AND pg_temp.n_accepted(v_s) = 15);
  -- the row backstop: a server path straight into a full group
  BEGIN
    UPDATE public.session_participants SET has_accepted = true WHERE session_id = v_s AND user_id = pg_temp.u('p2');
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM pg_temp.ok('Q-CAP the row backstop refuses turning a pending row accepted in a full group',
    v_err LIKE 'PT409:conflict_group_full%' AND NOT pg_temp.accepted(v_s, 'p2'));
  BEGIN
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at)
      VALUES (v_s, pg_temp.u('x'), true, now());
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM pg_temp.ok('Q-CAP the row backstop refuses a new accepted row in a full group (any server path)',
    v_err LIKE 'PT409:conflict_group_full%' AND NOT pg_temp.accepted(v_s, 'x'));
  -- accepted rows keep working in a full group
  v_n := pg_temp.rows_as('f3', format($$UPDATE public.session_participants SET notifications_muted = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('f3')));
  PERFORM pg_temp.ok('Q-CAP a member of a full group still mutes their own row', v_n = 1);
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at)
    VALUES (v_s, pg_temp.u('f4'), true, now())
    ON CONFLICT (session_id, user_id) DO UPDATE SET has_accepted = true;
  PERFORM pg_temp.ok('Q-CAP an upsert over an accepted row in a full group is not refused', pg_temp.n_accepted(v_s) = 15);
  -- a place freed by a removal lets the waiting invite in
  v_err := pg_temp.try_as('a', format($$SELECT public.remove_group_member(%L, %L)$$, pg_temp.conv_of(v_s), pg_temp.u('f5')));
  v_err := v_err || '|' || pg_temp.try_as('p2', pg_temp.accept_sql(v_s, v_i2));
  PERFORM pg_temp.ok('Q-CAP after a removal the waiting invite can be accepted', v_err = 'ok|ok' AND pg_temp.accepted(v_s, 'p2') AND pg_temp.n_accepted(v_s) = 15);
END $cap$;

-- ── Q-INVITE ────────────────────────────────────────────────────────────────
DO $inv$
DECLARE v_s uuid := pg_temp.mk_group('inv', ARRAY['a','b']); v_i uuid; v_err text;
BEGIN
  v_i := pg_temp.invite(v_s, 'a', 'c');
  UPDATE public.collaboration_invites SET status = 'declined' WHERE id = v_i;
  v_err := pg_temp.try_as('c', pg_temp.accept_sql(v_s, v_i));
  PERFORM pg_temp.ok('Q-INVITE a declined invite cannot be accepted', v_err <> 'ok' AND NOT pg_temp.accepted(v_s, 'c'));
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status)
    VALUES (v_s, pg_temp.u('a'), pg_temp.u('d'), 'accepted') RETURNING id INTO v_i;
  v_err := pg_temp.try_as('d', pg_temp.accept_sql(v_s, v_i));
  PERFORM pg_temp.ok('Q-INVITE an accepted invite held by a non-member cannot bring them in',
    v_err <> 'ok' AND NOT pg_temp.accepted(v_s, 'd'));
  v_i := pg_temp.invite_of(v_s, 'b');
  v_err := pg_temp.try_as('b', pg_temp.accept_sql(v_s, v_i));
  PERFORM pg_temp.ok('Q-INVITE a current member''s accepted invite still answers', v_err = 'ok' AND pg_temp.accepted(v_s, 'b'));
END $inv$;

-- ── Q-LEAVE ─────────────────────────────────────────────────────────────────
DO $leave$
DECLARE v_s uuid := pg_temp.mk_group('lv', ARRAY['a','b','c','d']); v_conv uuid; v_i uuid; v_err text;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  -- the leave function
  v_i := pg_temp.invite_of(v_s, 'b');
  v_err := pg_temp.try_as('b', format($$SELECT public.leave_group_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('Q-LEAVE leaving with the leave function clears the leaver''s invite',
    v_err = 'ok' AND NOT pg_temp.accepted(v_s, 'b') AND NOT EXISTS (SELECT 1 FROM public.collaboration_invites WHERE id = v_i));
  v_err := pg_temp.try_as('b', pg_temp.accept_sql(v_s, v_i));
  PERFORM pg_temp.ok('Q-LEAVE the old invite cannot bring the leaver back', v_err <> 'ok' AND NOT pg_temp.accepted(v_s, 'b'));
  -- today's app leave: delete my own row
  v_i := pg_temp.invite_of(v_s, 'c');
  v_err := pg_temp.try_as('c', format($$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('c')));
  PERFORM pg_temp.ok('Q-LEAVE an own-row leave clears the leaver''s invite',
    v_err = 'ok' AND NOT EXISTS (SELECT 1 FROM public.collaboration_invites WHERE id = v_i));
  v_err := pg_temp.try_as('c', pg_temp.accept_sql(v_s, v_i));
  PERFORM pg_temp.ok('Q-LEAVE nor can that old invite be used again', v_err <> 'ok' AND NOT pg_temp.accepted(v_s, 'c'));
  -- an admin removes
  v_i := pg_temp.invite_of(v_s, 'd');
  v_err := pg_temp.try_as('a', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('d')));
  PERFORM pg_temp.ok('Q-LEAVE a removal clears the removed member''s invite',
    v_err = 'ok' AND NOT EXISTS (SELECT 1 FROM public.collaboration_invites WHERE id = v_i));
  -- a pending invitee's own row going does not touch other invites
  v_i := pg_temp.invite(v_s, 'a', 'e');
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('e');
  PERFORM pg_temp.ok('Q-LEAVE a pending row going leaves its pending invite as it was',
    (SELECT status FROM public.collaboration_invites WHERE id = v_i) = 'pending');
END $leave$;

-- ── Q-CREATOR ───────────────────────────────────────────────────────────────
DO $creator$
DECLARE v_s uuid := pg_temp.mk_group('cr', ARRAY['a','b','c']); v_conv uuid; v_err text; v_n bigint; v_s2 uuid; v_card uuid; v_a uuid; v_b uuid; v_plan public.chat_plans%ROWTYPE;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  -- a creator who is still a member
  PERFORM pg_temp.ok('Q-CREATOR a member creator counts as creator and group admin',
    public.is_session_creator(v_s, pg_temp.u('a')) AND public.chat_group_is_admin(v_conv, pg_temp.u('a')));
  v_n := pg_temp.rows_as('a', format($$UPDATE public.session_participants SET is_admin = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('b')));
  PERFORM pg_temp.ok('Q-CREATOR a member creator still makes an admin directly', v_n = 1);
  UPDATE public.session_participants SET is_admin = false WHERE session_id = v_s AND user_id = pg_temp.u('b');
  v_err := pg_temp.try_as('a', format($$UPDATE public.collaboration_sessions SET max_participants = 15, name = 'q8 cr renamed' WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('Q-CREATOR a member creator still changes creator-only settings', v_err = 'ok');
  v_err := pg_temp.try_as('a', format($$SELECT public.rpc_admin_lock_and_schedule_card(%L, %L, now() + interval '2 days', 60)$$, v_s, gen_random_uuid()));
  PERFORM pg_temp.ok('Q-CREATOR a member creator passes the lock-and-schedule check (no such card)', v_err LIKE '%card not found%');

  -- the creator leaves; b inherits admin and (#4435 leftovers, Seth's decision)
  -- the creator's role
  v_err := pg_temp.try_as('a', format($$SELECT public.leave_group_conversation(%L)$$, v_conv));
  PERFORM pg_temp.ok('Q-CREATOR the creator leaves and the group stays, with b as its creator', v_err = 'ok'
    AND pg_temp.n_accepted(v_s) = 2 AND EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s AND created_by = pg_temp.u('b')));
  PERFORM pg_temp.ok('Q-CREATOR a creator who left is no longer the creator or a group admin',
    NOT public.is_session_creator(v_s, pg_temp.u('a')) AND NOT public.chat_group_is_admin(v_conv, pg_temp.u('a')));
  v_n := pg_temp.rows_as('a', format($$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('c')));
  PERFORM pg_temp.ok('Q-CREATOR a creator who left cannot remove a member', v_n <= 0 AND pg_temp.accepted(v_s, 'c'));
  v_n := pg_temp.rows_as('a', format($$UPDATE public.session_participants SET is_admin = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('c')));
  PERFORM pg_temp.ok('Q-CREATOR a creator who left cannot change admins',
    v_n <= 0 AND NOT (SELECT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('c')));
  -- #4435 leftovers: the creator's role passed to b, so a is an ordinary
  -- non-member: row security hides the group from a's writes (no row changes,
  -- no error) instead of the guard refusing them.
  v_err := pg_temp.try_as('a', format($$UPDATE public.collaboration_sessions SET max_participants = 50 WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('Q-CREATOR a creator who left cannot change creator-only settings',
    v_err = 'ok' AND (SELECT max_participants FROM public.collaboration_sessions WHERE id = v_s) = 15);
  v_err := pg_temp.try_as('a', format($$UPDATE public.collaboration_sessions SET name = 'taken back' WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('Q-CREATOR a creator who left cannot rename the group',
    v_err = 'ok' AND (SELECT name FROM public.collaboration_sessions WHERE id = v_s) = 'q8 cr renamed');
  v_err := pg_temp.try_as('a', format($$DELETE FROM public.collaboration_sessions WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('Q-CREATOR a creator who left cannot delete the group',
    v_err = 'ok' AND EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  v_err := pg_temp.try_as('a', format($$INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at, is_admin) VALUES (%L, %L, true, now(), true)$$, v_s, pg_temp.u('a')));
  PERFORM pg_temp.ok('Q-CREATOR a creator who left cannot put themself back', v_err LIKE '42501:%' AND NOT pg_temp.accepted(v_s, 'a'));
  v_err := pg_temp.try_as('a', format($$INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status) VALUES (%L, %L, %L, 'accepted')$$, v_s, pg_temp.u('x'), pg_temp.u('a')));
  PERFORM pg_temp.ok('Q-CREATOR a creator who left cannot write invites for the group as creator',
    v_err <> 'ok' AND NOT EXISTS (SELECT 1 FROM public.collaboration_invites WHERE session_id = v_s AND invited_user_id = pg_temp.u('a')));
  v_err := pg_temp.try_as('a', format($$SELECT public.rpc_admin_lock_and_schedule_card(%L, %L, now() + interval '2 days', 60)$$, v_s, gen_random_uuid()));
  PERFORM pg_temp.ok('Q-CREATOR a creator who left cannot lock and schedule a card', v_err LIKE '%not authorized%');
  INSERT INTO public.board_saved_cards(session_id, experience_id, card_data, saved_by)
    VALUES (v_s, 'q8-deck', '{"title":"D"}'::jsonb, pg_temp.u('b')) RETURNING id INTO v_card;
  -- a saved deck card brings its deck plan with it
  SELECT * INTO v_plan FROM public.chat_plans WHERE saved_card_id = v_card;
  PERFORM pg_temp.ok('Q-CREATOR fixture: the saved card has its deck plan', v_plan.id IS NOT NULL AND v_plan.source = 'deck');
  PERFORM pg_temp.ok('Q-CREATOR a creator who left cannot lock a deck plan; the inheriting admin can',
    NOT public.chat_plan_can_lock(v_plan, pg_temp.u('a')) AND public.chat_plan_can_lock(v_plan, pg_temp.u('b')));
  -- the remaining members still run the group
  v_err := pg_temp.try_as('b', format($$UPDATE public.collaboration_sessions SET name = 'q8 cr kept' WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('Q-CREATOR the remaining members still rename the group', v_err = 'ok');

  -- today's client create: session, creator row, then a pending invitee
  v_a := pg_temp.u('a'); v_b := pg_temp.u('b');
  PERFORM pg_temp.as_user('a');
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('q8 client made', v_a, 'pending') RETURNING id INTO v_s2;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at) VALUES (v_s2, v_a, true, now());
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status, invite_method)
    VALUES (v_s2, v_a, v_b, 'pending', 'friends_list');
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s2, v_b, false);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('Q-CREATOR today''s client create still works (creator row, then an invitee)',
    pg_temp.accepted(v_s2, 'a') AND EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s2 AND user_id = v_b));
  -- a half-made group (no member yet) can still be deleted by its creator
  PERFORM pg_temp.as_user('a');
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('q8 ghost', v_a, 'pending') RETURNING id INTO v_s2;
  PERFORM set_config('role', 'postgres', true);
  v_err := pg_temp.try_as('a', format($$DELETE FROM public.collaboration_sessions WHERE id = %L$$, v_s2));
  PERFORM pg_temp.ok('Q-CREATOR a half-made group is still deleted by its creator',
    v_err = 'ok' AND NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s2));
END $creator$;

-- ── Q-VOTES ─────────────────────────────────────────────────────────────────
DO $votes$
DECLARE v_s uuid := pg_temp.mk_group('vt', ARRAY['a','b','c']); v_card uuid;
BEGIN
  PERFORM pg_temp.call_as('c', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'q8-new', %L, '{"title":"N"}'::jsonb, 'right')$$, v_s, pg_temp.u('c')));
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('c');
  PERFORM pg_temp.call_as('a', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'q8-new', %L, '{"title":"N"}'::jsonb, 'right')$$, v_s, pg_temp.u('a')));
  PERFORM pg_temp.call_as('b', format($$SELECT public.rpc_record_swipe_and_check_match(%L, 'q8-new', %L, '{"title":"N"}'::jsonb, 'right')$$, v_s, pg_temp.u('b')));
  SELECT id INTO v_card FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'q8-new';
  PERFORM pg_temp.ok('Q-VOTES two current members make the match', v_card IS NOT NULL);
  PERFORM pg_temp.ok('Q-VOTES the new match has votes from the two current members only',
    (SELECT array_agg(user_id ORDER BY user_id) FROM public.board_votes WHERE saved_card_id = v_card)
      = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.u('a'), pg_temp.u('b')]) x));
  PERFORM pg_temp.ok('Q-VOTES the removed member''s swipe row is kept on record',
    EXISTS (SELECT 1 FROM public.board_user_swipe_states WHERE session_id = v_s AND user_id = pg_temp.u('c') AND experience_id = 'q8-new'));
END $votes$;

ROLLBACK;
