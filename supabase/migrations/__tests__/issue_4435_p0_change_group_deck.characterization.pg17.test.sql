\set ON_ERROR_STOP on

-- #4435 Phase 0 characterization (CHANGE): today's group and deck behaviour
-- that the #4435 build changes on purpose. Each assertion carries a
-- `-- RULE: R<n>` tag; the build may flip only a tagged assertion, only in
-- the wave that implements that rule, and the commit message names the tag.
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

DELETE FROM public.app_config WHERE config_key = 'global_plus_access';
INSERT INTO public.app_config(config_key, config_value) VALUES ('global_plus_access', 'true');

CREATE TEMP TABLE k2(tag text PRIMARY KEY, id uuid NOT NULL);

CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS
  $f$ SELECT id FROM k2 WHERE tag = p_tag $f$;

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

-- A session group created by p_creator with p_accepted accepted (creator first).
CREATE FUNCTION pg_temp.mk_group(p_tag text, p_status text, p_accepted text[]) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_s uuid; v_t text;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('p0c2 ' || p_tag, pg_temp.u(p_accepted[1]), p_status) RETURNING id INTO v_s;
  FOREACH v_t IN ARRAY p_accepted LOOP
    INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u(v_t), true);
  END LOOP;
  INSERT INTO k2 VALUES (p_tag, v_s);
  INSERT INTO k2 SELECT p_tag || 'c', id FROM public.conversations WHERE session_id = v_s AND linked_entity_type = 'session';
  RETURN v_s;
END $f$;

DO $fixture$
DECLARE v_tag text; v_id uuid; i int;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['a','b','c','d','p','q','r','j','fr1','fr2'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'p0c2-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'p0c2-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k2 VALUES (v_tag, v_id);
  END LOOP;
  FOR i IN 1..16 LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'p0c2-m' || i || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'p0c2-m' || i || '-' || v_id || '@example.test', 'M' || i, 'M' || i)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k2 VALUES ('m' || i, v_id);
  END LOOP;
  -- a and b are friends (for add_group_members).
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (pg_temp.u('a'), pg_temp.u('b'), 'accepted'), (pg_temp.u('b'), pg_temp.u('a'), 'accepted');
END $fixture$;

-- RULE: R1 (R1-two-to-one) an active group of 2 accepted; one leaves -> the session is deleted.
DO $r1a$
DECLARE v_s uuid := pg_temp.mk_group('two', 'active', ARRAY['a','b']);
BEGIN
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('R1-two-to-one leaving a 2-person group deletes it',
    NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $r1a$;

-- RULE: R1 (R1-pending-solo) a pending group with only its creator survives an UPDATE (mute).
DO $r1b$
DECLARE v_s uuid := pg_temp.mk_group('solo', 'pending', ARRAY['a']);
BEGIN
  UPDATE public.session_participants SET notifications_muted = true WHERE session_id = v_s AND user_id = pg_temp.u('a');
  PERFORM pg_temp.ok('R1-pending-solo a pending creator-only group survives a mute',
    EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $r1b$;

-- RULE: R5 (R5-group) a declined friend request deletes a group left with only its creator.
DO $r5$
DECLARE v_s uuid := pg_temp.mk_group('decline', 'pending', ARRAY['fr1']); v_fr uuid;
BEGIN
  INSERT INTO public.friend_requests(sender_id, receiver_id, status)
    VALUES (pg_temp.u('fr1'), pg_temp.u('fr2'), 'pending') RETURNING id INTO v_fr;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('fr2'), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status)
    VALUES (v_s, pg_temp.u('fr1'), pg_temp.u('fr2'), 'pending');
  UPDATE public.friend_requests SET status = 'declined' WHERE id = v_fr;
  PERFORM pg_temp.ok('R5-group a decline deletes a group left with only its creator',
    NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $r5$;

-- RULE: R8 (R8-pending-caller) a pending participant can invite through add_friend_to_session.
DO $r8a$
DECLARE v_s uuid := pg_temp.mk_group('r8', 'active', ARRAY['a','b']); r jsonb; v_q uuid := pg_temp.u('q');
BEGIN
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('p'), false);
  PERFORM pg_temp.as_user('p');
  SET LOCAL ROLE authenticated;
  r := public.add_friend_to_session(v_s, v_q);
  RESET ROLE;
  PERFORM pg_temp.ok('R8-pending-caller a pending participant invites (outcome invited)', r ->> 'outcome' = 'invited');
END $r8a$;

-- RULE: R8 (R8-no-cap) add_friend_to_session invites at 15 accepted.
DO $r8b$
DECLARE v_s uuid; r jsonb; i int; v_x uuid := pg_temp.u('m16');
BEGIN
  v_s := pg_temp.mk_group('full', 'active', ARRAY['m1']);
  FOR i IN 2..15 LOOP
    INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('m' || i), true);
  END LOOP;
  PERFORM pg_temp.as_user('m1');
  SET LOCAL ROLE authenticated;
  r := public.add_friend_to_session(v_s, v_x);
  RESET ROLE;
  PERFORM pg_temp.ok('R8-no-cap an invite at 15 accepted still succeeds', r ->> 'outcome' = 'invited');
END $r8b$;

-- RULE: R12 (R12-removed-counts) a removed member's earlier right swipe still counts toward a new match.
DO $r12$
DECLARE v_s uuid := pg_temp.mk_group('r12', 'active', ARRAY['a','b','c']); v_a uuid := pg_temp.u('a'); v_b uuid := pg_temp.u('b');
BEGIN
  PERFORM pg_temp.as_user('a');
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_record_swipe_and_check_match(v_s, 'p0c2-x', v_a, '{"title":"X"}'::jsonb, 'right');
  RESET ROLE;
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = v_a;
  PERFORM pg_temp.as_user('b');
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_record_swipe_and_check_match(v_s, 'p0c2-x', v_b, '{"title":"X"}'::jsonb, 'right');
  RESET ROLE;
  PERFORM pg_temp.ok('R12-removed-counts a removed member''s swipe still makes a match',
    EXISTS (SELECT 1 FROM public.board_saved_cards WHERE session_id = v_s AND experience_id = 'p0c2-x'));
END $r12$;

-- RULE: R14 (R14-removed-votes) a removed member's time vote and RSVP still show on a deciding plan.
DO $r14$
DECLARE v_s uuid := pg_temp.mk_group('r14', 'active', ARRAY['a','b','r']); v_conv uuid; v_plan uuid; v_opt uuid; r jsonb; v_r uuid := pg_temp.u('r');
BEGIN
  v_conv := pg_temp.u('r14c');
  INSERT INTO public.chat_plans(conversation_id, source, created_by, title, when_mode, status)
    VALUES (v_conv, 'chat', pg_temp.u('a'), 'p0c2 plan', 'poll', 'deciding') RETURNING id INTO v_plan;
  INSERT INTO public.chat_plan_time_options(plan_id, starts_at, added_by)
    VALUES (v_plan, now() + interval '3 days', pg_temp.u('a')) RETURNING id INTO v_opt;
  INSERT INTO public.chat_plan_time_votes(option_id, plan_id, user_id) VALUES (v_opt, v_plan, v_r);
  INSERT INTO public.chat_plan_rsvps(plan_id, user_id, status) VALUES (v_plan, v_r, 'going');
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = v_r;
  PERFORM pg_temp.as_user('a');
  SET LOCAL ROLE authenticated;
  r := public.chat_plans_for_conversation(v_conv);
  RESET ROLE;
  PERFORM pg_temp.ok('R14-removed-votes the removed member''s time vote still shows',
    (r -> 'plans' -> 0 -> 'options' -> 0 -> 'voterIds') @> to_jsonb(ARRAY[v_r]));
  PERFORM pg_temp.ok('R14-removed-votes the removed member''s RSVP still shows',
    (r -> 'plans' -> 0 -> 'rsvps' -> 'going') @> to_jsonb(ARRAY[v_r]));
END $r14$;

-- RULE: R16 (R16-solo-lock) with 1 accepted member, an attending RSVP locks the card.
DO $r16a$
DECLARE v_s uuid := pg_temp.mk_group('r16a', 'pending', ARRAY['a']); v_card uuid;
BEGIN
  INSERT INTO public.board_saved_cards(session_id, experience_id, card_data, saved_by)
    VALUES (v_s, 'p0c2-solo', '{"title":"Solo"}'::jsonb, pg_temp.u('a')) RETURNING id INTO v_card;
  INSERT INTO public.board_card_rsvps(session_id, saved_card_id, user_id, rsvp_status)
    VALUES (v_s, v_card, pg_temp.u('a'), 'attending');
  PERFORM pg_temp.ok('R16-solo-lock a group of one auto-locks on one attending RSVP',
    (SELECT is_locked FROM public.board_saved_cards WHERE id = v_card));
END $r16a$;

-- RULE: R16 (R16-removed-rsvp) a removed member's attending RSVP counts toward all-going.
DO $r16b$
DECLARE v_s uuid := pg_temp.mk_group('r16b', 'active', ARRAY['a','b','c']); v_card uuid;
BEGIN
  INSERT INTO public.board_saved_cards(session_id, experience_id, card_data, saved_by)
    VALUES (v_s, 'p0c2-rsvp', '{"title":"Rsvp"}'::jsonb, pg_temp.u('a')) RETURNING id INTO v_card;
  INSERT INTO public.board_card_rsvps(session_id, saved_card_id, user_id, rsvp_status)
    VALUES (v_s, v_card, pg_temp.u('b'), 'attending');
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b');
  INSERT INTO public.board_card_rsvps(session_id, saved_card_id, user_id, rsvp_status)
    VALUES (v_s, v_card, pg_temp.u('a'), 'attending');
  PERFORM pg_temp.ok('R16-removed-rsvp the removed member''s RSVP completes all-going',
    (SELECT is_locked FROM public.board_saved_cards WHERE id = v_card));
END $r16b$;

-- RULE: R19 (R19-direct) add_group_members has no session branch: the creator cannot add a friend directly.
-- RULE: R20 add_group_members on a session chat raises not_allowed.
DO $r20$
DECLARE v_s uuid := pg_temp.mk_group('r20', 'active', ARRAY['a','c']); v_conv uuid; v_state text := 'none'; v_b uuid := pg_temp.u('b');
BEGIN
  v_conv := pg_temp.u('r20c');
  PERFORM pg_temp.as_user('a');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.add_group_members(v_conv, ARRAY[v_b]);
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM = 'not_allowed' THEN v_state := 'not_allowed'; END IF;
  END;
  RESET ROLE;
  PERFORM pg_temp.ok('R20 add_group_members on a session chat raises not_allowed', v_state = 'not_allowed');
  PERFORM pg_temp.ok('R19-direct nothing was added',
    NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s AND user_id = v_b));
END $r20$;

-- RULE: R21 a link join to a session group returns invited and a pending invite.
DO $r21$
DECLARE v_s uuid := pg_temp.mk_group('r21', 'active', ARRAY['a','c']); v_conv uuid; v_link jsonb; r jsonb;
BEGIN
  v_conv := pg_temp.u('r21c');
  PERFORM pg_temp.as_user('a');
  SET LOCAL ROLE authenticated;
  v_link := public.get_or_create_group_link(v_conv);
  PERFORM public.set_group_link_approval(v_conv, false);
  RESET ROLE;
  PERFORM pg_temp.as_user('j');
  SET LOCAL ROLE authenticated;
  r := public.join_group_by_link(v_link ->> 'token', NULL);
  RESET ROLE;
  PERFORM pg_temp.ok('R21 a session link join returns invited', r ->> 'status' = 'invited');
  PERFORM pg_temp.ok('R21 the joiner holds a pending link invite',
    (SELECT status FROM public.collaboration_invites WHERE session_id = v_s AND invited_user_id = pg_temp.u('j')) = 'pending');
  PERFORM pg_temp.ok('R21 the joiner is not yet a chat member',
    NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = v_conv AND user_id = pg_temp.u('j')));
END $r21$;

ROLLBACK;
