\set ON_ERROR_STOP on

-- #4435 Phase 0 characterization (KEEP): group, deck and plan rules that the
-- #4435 build must not change. This file is frozen for the whole build: if an
-- assertion here fails after a build wave, the wave is wrong, not this file.
--
-- Tags (one assertion block each):
--   R9      accepting a session invite adds a conversation_participants row;
--           deleting the participant removes it; a 1:1 collab is exempt
--   R7      accept_session_with_prefs sets invite + participant accepted and
--           current_position to the accepted frontier
--   R34     accepted prefs are written to participant_prefs
--   R13     rpc_record_swipe_and_check_match refuses a pending participant
--   INV-3   two accepted right swipes -> exactly one saved card; one -> none;
--           a duplicate right swipe adds no vote
--   INV-4   deleting a member's participant row keeps their swipe and vote rows
--   R15     chat_plan_can_lock: plan creator while a member, else group admin
--   R17     rpc_admin_lock_and_schedule_card: creator or is_admin only
--   R18     chat_group_is_admin: creator and is_admin true, member false
--   INV-7   chat_group_is_full: true at 15 accepted, false at 14, false for plain
--   R29     the tier trigger counts pending and active sessions
--   R31-delete   1:1 collab: deleting the friend's row deletes the session
--   R31-decline  1:1 collab: declining the invite deletes the session
--   R32     a member added to a group with messages gets history_visible_from;
--           it never changes on UPDATE
--   R11-sql pg_aggregate_collab_prefs returns the under-two result for 1 accepted
--   R36     is_session_participant is true for a pending row
--   R5-steps a declined friend request cancels invites both ways, deletes the
--           matching participant rows, cancels pending phone invites
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

-- Unlimited sessions for the fixture (R29 restores the free limit itself).
DELETE FROM public.app_config WHERE config_key = 'global_plus_access';
INSERT INTO public.app_config(config_key, config_value) VALUES ('global_plus_access', 'true');

CREATE TEMP TABLE k1(tag text PRIMARY KEY, id uuid NOT NULL);

CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS
  $f$ SELECT id FROM k1 WHERE tag = p_tag $f$;

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

DO $fixture$
DECLARE v_tag text; v_id uuid; i int;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['a','b','c','d','e','f','x1','x2','fr1','fr2','g','z','z2'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'p0k1-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'p0k1-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k1 VALUES (v_tag, v_id);
  END LOOP;
  FOR i IN 1..15 LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'p0k1-m' || i || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'p0k1-m' || i || '-' || v_id || '@example.test', 'M' || i, 'M' || i)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k1 VALUES ('m' || i, v_id);
  END LOOP;
END $fixture$;

-- G1: a creates; a, c, e accepted; b and d pending with pending invites.
DO $g1$
DECLARE v_s uuid; v_conv uuid;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('p0k1 g1', pg_temp.u('a'), 'active') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, current_position) VALUES
    (v_s, pg_temp.u('a'), true, 7), (v_s, pg_temp.u('c'), true, 3), (v_s, pg_temp.u('e'), true, 1),
    (v_s, pg_temp.u('b'), false, 0), (v_s, pg_temp.u('d'), false, 0);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status) VALUES
    (v_s, pg_temp.u('a'), pg_temp.u('b'), 'pending'), (v_s, pg_temp.u('a'), pg_temp.u('d'), 'pending');
  SELECT id INTO v_conv FROM public.conversations WHERE session_id = v_s AND linked_entity_type = 'session';
  IF v_conv IS NULL THEN RAISE EXCEPTION 'fixture: no session conversation'; END IF;
  INSERT INTO k1 VALUES ('g1', v_s), ('g1c', v_conv);
END $g1$;

-- ── R9 / R7 / R34: accept a pending invite ─────────────────────────────────
DO $r9$
DECLARE v_s uuid := pg_temp.u('g1'); v_inv uuid; r jsonb;
BEGIN
  SELECT id INTO v_inv FROM public.collaboration_invites WHERE session_id = v_s AND invited_user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('R9 pending invitee is not a chat member before accepting',
    NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = pg_temp.u('g1c') AND user_id = pg_temp.u('b')));
  PERFORM pg_temp.as_user('b');
  SET LOCAL ROLE authenticated;
  r := public.accept_session_with_prefs(v_s, v_inv, NULL, NULL, ARRAY['nature'], ARRAY[]::text[], 'walking', 30);
  RESET ROLE;
  PERFORM pg_temp.ok('R7 invite accepted',
    (SELECT status FROM public.collaboration_invites WHERE id = v_inv) = 'accepted');
  PERFORM pg_temp.ok('R7 participant accepted',
    (SELECT has_accepted FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b')));
  PERFORM pg_temp.ok('R7 current_position set to the accepted frontier (7)',
    (SELECT current_position FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b')) = 7);
  PERFORM pg_temp.ok('R9 accepting adds a conversation_participants row',
    EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = pg_temp.u('g1c') AND user_id = pg_temp.u('b')));
  PERFORM pg_temp.ok('R34 accepted prefs are written to participant_prefs',
    (SELECT participant_prefs ? pg_temp.u('b')::text FROM public.collaboration_sessions WHERE id = v_s));
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('R9 deleting the participant removes the chat member row',
    NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = pg_temp.u('g1c') AND user_id = pg_temp.u('b')));
END $r9$;

-- ── R36 / R13 ──────────────────────────────────────────────────────────────
DO $r13$
DECLARE v_s uuid := pg_temp.u('g1'); v_d uuid := pg_temp.u('d'); v_state text := 'none';
BEGIN
  PERFORM pg_temp.ok('R36 is_session_participant is true for a pending row',
    public.is_session_participant(v_s, v_d));
  PERFORM pg_temp.as_user('d');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.rpc_record_swipe_and_check_match(v_s, 'p0k1-exp-pending', v_d, '{"title":"x"}'::jsonb, 'right');
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'refused';
  END;
  RESET ROLE;
  PERFORM pg_temp.ok('R13 a pending participant cannot swipe', v_state = 'refused');
END $r13$;

-- ── INV-3: two accepted right swipes make exactly one saved card ───────────
DO $inv3$
DECLARE v_s uuid := pg_temp.u('g1'); v_a uuid := pg_temp.u('a'); v_c uuid := pg_temp.u('c'); v_card uuid;
BEGIN
  PERFORM pg_temp.as_user('a');
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_record_swipe_and_check_match(v_s, 'p0k1-exp1', v_a, '{"title":"Exp 1"}'::jsonb, 'right');
  PERFORM public.rpc_record_swipe_and_check_match(v_s, 'p0k1-exp2', v_a, '{"title":"Exp 2"}'::jsonb, 'right');
  RESET ROLE;
  PERFORM pg_temp.ok('INV-3 one right swipe saves nothing',
    NOT EXISTS (SELECT 1 FROM public.board_saved_cards WHERE session_id = v_s AND experience_id IN ('p0k1-exp1', 'p0k1-exp2')));
  PERFORM pg_temp.as_user('c');
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_record_swipe_and_check_match(v_s, 'p0k1-exp1', v_c, '{"title":"Exp 1"}'::jsonb, 'right');
  RESET ROLE;
  PERFORM pg_temp.ok('INV-3 two accepted right swipes save exactly one card',
    (SELECT count(*) FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'p0k1-exp1') = 1);
  SELECT id INTO v_card FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'p0k1-exp1';
  INSERT INTO k1 VALUES ('card1', v_card);
  PERFORM pg_temp.ok('INV-3 both swipers get an up vote',
    (SELECT count(*) FROM public.board_votes WHERE saved_card_id = v_card AND vote_type = 'up') = 2);
  PERFORM pg_temp.as_user('a');
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_record_swipe_and_check_match(v_s, 'p0k1-exp1', v_a, '{"title":"Exp 1"}'::jsonb, 'right');
  RESET ROLE;
  PERFORM pg_temp.ok('INV-3 a duplicate right swipe adds no vote',
    (SELECT count(*) FROM public.board_votes WHERE saved_card_id = v_card) = 2);
  PERFORM pg_temp.ok('INV-3 a duplicate right swipe adds no card',
    (SELECT count(*) FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'p0k1-exp1') = 1);
END $inv3$;

-- ── R15 / R17 / R18 (before INV-4 removes c) ────────────────────────────────
DO $r15$
DECLARE
  v_s uuid := pg_temp.u('g1'); v_conv uuid := pg_temp.u('g1c');
  v_plan_e public.chat_plans%ROWTYPE; v_plan_c public.chat_plans%ROWTYPE; v_state text := 'none';
  v_card uuid := pg_temp.u('card1');
BEGIN
  UPDATE public.session_participants SET is_admin = true WHERE session_id = v_s AND user_id = pg_temp.u('e');
  PERFORM pg_temp.ok('R18 creator is a group admin', public.chat_group_is_admin(v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('R18 is_admin member is a group admin', public.chat_group_is_admin(v_conv, pg_temp.u('e')));
  PERFORM pg_temp.ok('R18 plain member is not a group admin', NOT public.chat_group_is_admin(v_conv, pg_temp.u('c')));
  UPDATE public.session_participants SET is_admin = false WHERE session_id = v_s AND user_id = pg_temp.u('e');

  INSERT INTO public.chat_plans(conversation_id, source, created_by, title, when_mode, status)
    VALUES (v_conv, 'chat', pg_temp.u('e'), 'p0k1 plan by e', 'poll', 'deciding') RETURNING * INTO v_plan_e;
  INSERT INTO public.chat_plans(conversation_id, source, created_by, title, when_mode, status)
    VALUES (v_conv, 'chat', pg_temp.u('c'), 'p0k1 plan by c', 'poll', 'deciding') RETURNING * INTO v_plan_c;
  PERFORM pg_temp.ok('R15 the plan maker (a member) can lock', public.chat_plan_can_lock(v_plan_e, pg_temp.u('e')));
  PERFORM pg_temp.ok('R15 while the maker is a member, the admin cannot lock', NOT public.chat_plan_can_lock(v_plan_e, pg_temp.u('a')));
  INSERT INTO k1 VALUES ('plan_c', v_plan_c.id);

  -- R17: a non-admin member cannot lock and schedule a deck card.
  PERFORM pg_temp.as_user('e');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.rpc_admin_lock_and_schedule_card(v_s, v_card, now() + interval '2 days', 60);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%not authorized%' THEN v_state := 'refused'; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  PERFORM pg_temp.ok('R17 a non-admin member cannot lock and schedule', v_state = 'refused');
  v_state := 'none';
  BEGIN
    PERFORM pg_temp.as_user('a');
    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_admin_lock_and_schedule_card(v_s, v_card, now() + interval '2 days', 60);
    RESET ROLE;
    IF (SELECT is_locked FROM public.board_saved_cards WHERE id = v_card) THEN v_state := 'locked'; END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT435';
  EXCEPTION WHEN SQLSTATE 'XT435' THEN NULL;
  END;
  RESET ROLE;
  PERFORM pg_temp.ok('R17 the creator can lock and schedule', v_state = 'locked');
END $r15$;

-- ── INV-4: removing a member keeps their swipe and vote rows ───────────────
DO $inv4$
DECLARE v_s uuid := pg_temp.u('g1'); v_c uuid := pg_temp.u('c'); v_plan public.chat_plans%ROWTYPE;
BEGIN
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = v_c;
  PERFORM pg_temp.ok('INV-4 the removed member''s swipe rows stay',
    EXISTS (SELECT 1 FROM public.board_user_swipe_states WHERE session_id = v_s AND user_id = v_c));
  PERFORM pg_temp.ok('INV-4 the removed member''s vote rows stay',
    EXISTS (SELECT 1 FROM public.board_votes WHERE session_id = v_s AND user_id = v_c));
  PERFORM pg_temp.ok('INV-4 the saved card stays', EXISTS (SELECT 1 FROM public.board_saved_cards WHERE id = pg_temp.u('card1')));
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.u('plan_c');
  PERFORM pg_temp.ok('R15 a plan whose maker left falls back to the group admin',
    public.chat_plan_can_lock(v_plan, pg_temp.u('a')) AND NOT public.chat_plan_can_lock(v_plan, pg_temp.u('e')));
END $inv4$;

-- ── R32: history from join ─────────────────────────────────────────────────
DO $r32$
DECLARE v_s uuid := pg_temp.u('g1'); v_conv uuid := pg_temp.u('g1c'); v_from timestamptz;
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_conv, pg_temp.u('a'), 'p0k1 hello');
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('f'), true);
  SELECT history_visible_from INTO v_from FROM public.conversation_participants
   WHERE conversation_id = v_conv AND user_id = pg_temp.u('f');
  PERFORM pg_temp.ok('R32 a member added to a group with messages gets history_visible_from', v_from IS NOT NULL);
  UPDATE public.conversation_participants SET history_visible_from = NULL
   WHERE conversation_id = v_conv AND user_id = pg_temp.u('f');
  PERFORM pg_temp.ok('R32 history_visible_from never changes on UPDATE',
    (SELECT history_visible_from FROM public.conversation_participants WHERE conversation_id = v_conv AND user_id = pg_temp.u('f')) = v_from);
END $r32$;

-- ── R18 / INV-7: chat_group_is_full ────────────────────────────────────────
DO $inv7$
DECLARE v_s uuid; v_conv uuid; v_plain uuid; i int;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('p0k1 big', pg_temp.u('m1'), 'active') RETURNING id INTO v_s;
  FOR i IN 1..14 LOOP
    INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('m' || i), true);
  END LOOP;
  SELECT id INTO v_conv FROM public.conversations WHERE session_id = v_s AND linked_entity_type = 'session';
  PERFORM pg_temp.ok('INV-7 14 accepted is not full', NOT public.chat_group_is_full(v_conv));
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('m15'), true);
  PERFORM pg_temp.ok('INV-7 15 accepted is full', public.chat_group_is_full(v_conv));
  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
    VALUES ('group', 'direct', 'p0k1 plain', pg_temp.u('m1')) RETURNING id INTO v_plain;
  PERFORM pg_temp.ok('INV-7 a plain group is never full', NOT public.chat_group_is_full(v_plain));
  PERFORM pg_temp.ok('R18 a plain group admin is its creator',
    public.chat_group_is_admin(v_plain, pg_temp.u('m1')) AND NOT public.chat_group_is_admin(v_plain, pg_temp.u('m2')));
END $inv7$;

-- ── R11-sql: under two accepted ────────────────────────────────────────────
DO $r11$
DECLARE v_s uuid; r jsonb;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('p0k1 solo', pg_temp.u('g'), 'pending') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('g'), true);
  PERFORM public.upsert_participant_prefs(v_s, pg_temp.u('g'), '{"categories":["nature"]}'::jsonb);
  r := public.pg_aggregate_collab_prefs(v_s);
  PERFORM pg_temp.ok('R11-sql 1 accepted returns the under-two result',
    (r ->> 'acceptedCount')::int = 1 AND r -> 'categories' = '[]'::jsonb);
  PERFORM pg_temp.ok('R34 prefs written by upsert_participant_prefs',
    (SELECT participant_prefs -> pg_temp.u('g')::text -> 'categories' FROM public.collaboration_sessions WHERE id = v_s) = '["nature"]'::jsonb);
END $r11$;

-- ── R31: 1:1 collab rules ──────────────────────────────────────────────────
DO $r31$
DECLARE v_dm uuid; v_s uuid; v_s2 uuid;
BEGIN
  INSERT INTO public.conversations(type, linked_entity_type, created_by)
    VALUES ('direct', 'direct', pg_temp.u('x1')) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, pg_temp.u('x1')), (v_dm, pg_temp.u('x2'));
  PERFORM set_config('issue_4114.dm_collab_start', 'on', true);
  INSERT INTO public.collaboration_sessions(name, created_by, status, conversation_id)
    VALUES ('p0k1 dm', pg_temp.u('x1'), 'active', v_dm) RETURNING id INTO v_s;
  PERFORM set_config('issue_4114.dm_collab_start', 'off', true);
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_s, pg_temp.u('x1'), true), (v_s, pg_temp.u('x2'), true);
  PERFORM pg_temp.ok('R9 a 1:1 collab adds no group chat',
    NOT EXISTS (SELECT 1 FROM public.conversations WHERE session_id = v_s));
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('x2');
  PERFORM pg_temp.ok('R31-delete 1:1 collab ends when the friend leaves',
    NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  PERFORM pg_temp.ok('R9 leaving a 1:1 collab keeps both in the 1:1 chat',
    (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = v_dm) = 2);

  PERFORM set_config('issue_4114.dm_collab_start', 'on', true);
  INSERT INTO public.collaboration_sessions(name, created_by, status, conversation_id)
    VALUES ('p0k1 dm2', pg_temp.u('x1'), 'pending', v_dm) RETURNING id INTO v_s2;
  PERFORM set_config('issue_4114.dm_collab_start', 'off', true);
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_s2, pg_temp.u('x1'), true), (v_s2, pg_temp.u('x2'), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status)
    VALUES (v_s2, pg_temp.u('x1'), pg_temp.u('x2'), 'pending');
  UPDATE public.collaboration_invites SET status = 'declined' WHERE session_id = v_s2;
  PERFORM pg_temp.ok('R31-decline a declined 1:1 collab invite ends the collab',
    NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s2));
END $r31$;

-- ── R5-steps: friend-request decline cascade, steps 1, 2 and 4 ─────────────
DO $r5$
DECLARE v_s uuid; v_fr uuid; v_pi uuid;
BEGIN
  INSERT INTO public.friend_requests(sender_id, receiver_id, status)
    VALUES (pg_temp.u('fr1'), pg_temp.u('fr2'), 'pending') RETURNING id INTO v_fr;
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('p0k1 decline', pg_temp.u('fr1'), 'active') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_s, pg_temp.u('fr1'), true), (v_s, pg_temp.u('g'), true), (v_s, pg_temp.u('fr2'), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status)
    VALUES (v_s, pg_temp.u('fr1'), pg_temp.u('fr2'), 'pending');
  INSERT INTO public.pending_invites(inviter_id, phone_e164, status, converted_user_id)
    VALUES (pg_temp.u('fr1'), '+15550004435', 'pending', pg_temp.u('fr2')) RETURNING id INTO v_pi;
  UPDATE public.friend_requests SET status = 'declined' WHERE id = v_fr;
  PERFORM pg_temp.ok('R5-steps step 1 the session invite is cancelled',
    (SELECT status FROM public.collaboration_invites WHERE session_id = v_s AND invited_user_id = pg_temp.u('fr2')) = 'cancelled');
  PERFORM pg_temp.ok('R5-steps step 2 the invitee''s participant row is deleted',
    NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('fr2')));
  PERFORM pg_temp.ok('R5-steps step 4 the phone invite is cancelled',
    (SELECT status FROM public.pending_invites WHERE id = v_pi) = 'cancelled');
  PERFORM pg_temp.ok('R5-steps a group with another member stays',
    EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $r5$;

-- ── R29: the tier trigger counts pending and active sessions ───────────────
DELETE FROM public.app_config WHERE config_key = 'global_plus_access';
DO $r29$
DECLARE v_state text := 'none';
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('p0k1 z one', pg_temp.u('z'), 'pending');
  BEGIN
    INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('p0k1 z two', pg_temp.u('z'), 'active');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'session_limit_reached%' THEN v_state := 'refused'; ELSE RAISE; END IF;
  END;
  PERFORM pg_temp.ok('R29 a pending session counts toward the free limit', v_state = 'refused');
  v_state := 'none';
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('p0k1 z2 one', pg_temp.u('z2'), 'active');
  BEGIN
    INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('p0k1 z2 two', pg_temp.u('z2'), 'pending');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'session_limit_reached%' THEN v_state := 'refused'; ELSE RAISE; END IF;
  END;
  PERFORM pg_temp.ok('R29 an active session counts toward the free limit', v_state = 'refused');
END $r29$;

ROLLBACK;
