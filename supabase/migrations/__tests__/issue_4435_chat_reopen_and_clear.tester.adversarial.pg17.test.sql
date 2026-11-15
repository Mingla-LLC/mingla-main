\set ON_ERROR_STOP on

-- #4435 M-B (20280708064435) adversarial suite: crafted writes against the
-- reopen law and the Clear chat cutoff.
-- Runs on the fully replayed PG17 schema; everything rolls back.
--
--
-- Messages in this one transaction carry explicit past timestamps: a clear's
-- cutoff is now(), the transaction start.
--
-- Cases: A-DELETED, A-BLOCKED, A-REMOVED, A-DIRECT, A-OTHER-ROW, A-RECLEAR.

BEGIN;

DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

CREATE TEMP TABLE k6(tag text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM k6 WHERE tag = p_tag $f$;
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
CREATE FUNCTION pg_temp.act(p_tag text, p_conv uuid, p_action text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  r := public.set_conversation_lifecycle(p_conv, p_action);
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
CREATE FUNCTION pg_temp.hidden(p_conv uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT hidden_at IS NOT NULL FROM public.conversation_participant_lifecycle
                    WHERE conversation_id = p_conv AND user_id = pg_temp.u(p_tag)), false)
$f$;
-- Messages p_tag can read in p_conv under RLS.
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
CREATE FUNCTION pg_temp.listed(p_tag text, p_conv uuid) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE v boolean;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  SELECT EXISTS (SELECT 1 FROM public.list_connection_conversation_access() a WHERE a.conversation_id = p_conv) INTO v;
  PERFORM set_config('role', 'postgres', true);
  RETURN v;
END $f$;

DO $fixture$
DECLARE v_tag text; v_id uuid; v_dm uuid; v_s uuid; v_conv uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['me','peer','g1','g2','x'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'a6-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'a6-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag)) ON CONFLICT (id) DO NOTHING;
    INSERT INTO k6 VALUES (v_tag, v_id);
  END LOOP;
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (pg_temp.u('me'), pg_temp.u('peer'), 'accepted'), (pg_temp.u('peer'), pg_temp.u('me'), 'accepted');
  INSERT INTO public.conversations(type, linked_entity_type, created_by) VALUES ('direct', 'direct', pg_temp.u('me')) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, pg_temp.u('me')), (v_dm, pg_temp.u('peer'));
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES
    (v_dm, pg_temp.u('peer'), 'old 1', now() - interval '2 hours'),
    (v_dm, pg_temp.u('me'), 'old 2', now() - interval '1 hour');
  INSERT INTO k6 VALUES ('dm', v_dm);
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('a6 crew', pg_temp.u('g1'), 'active') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_s, pg_temp.u('g1'), true), (v_s, pg_temp.u('g2'), true), (v_s, pg_temp.u('me'), true);
  SELECT id INTO v_conv FROM public.conversations WHERE session_id = v_s AND linked_entity_type = 'session';
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES
    (v_conv, pg_temp.u('g1'), 'crew old', now() - interval '1 hour');
  INSERT INTO k6 VALUES ('crew', v_conv);
END $fixture$;


-- A-DELETED: a deleted message never reopens a removed chat.
DO $deleted$
DECLARE v_dm uuid := pg_temp.u('dm');
BEGIN
  PERFORM pg_temp.act('me', v_dm, 'hide');
  INSERT INTO public.messages(conversation_id, sender_id, content, deleted_at) VALUES (v_dm, pg_temp.u('peer'), 'gone', now());
  PERFORM pg_temp.ok('A-DELETED a deleted message keeps the chat removed', pg_temp.hidden(v_dm, 'me'));
END $deleted$;

-- A-BLOCKED: after a block the chat is not eligible, so a message does not bring it back.
DO $blocked$
DECLARE v_dm uuid := pg_temp.u('dm');
BEGIN
  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (pg_temp.u('me'), pg_temp.u('peer'));
  INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_dm, pg_temp.u('peer'), 'after block');
  PERFORM pg_temp.ok('A-BLOCKED an ineligible chat stays removed', pg_temp.hidden(v_dm, 'me'));
  DELETE FROM public.blocked_users WHERE blocker_id = pg_temp.u('me') AND blocked_id = pg_temp.u('peer');
END $blocked$;

-- A-REMOVED: someone who left a group cannot clear it and is not reopened by it.
DO $removed$
DECLARE v_conv uuid := pg_temp.u('crew'); v_state text := 'none';
BEGIN
  PERFORM pg_temp.act('g2', v_conv, 'hide');
  PERFORM pg_temp.as_user('g2');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.leave_group_conversation(v_conv);
  BEGIN
    PERFORM public.set_conversation_lifecycle(v_conv, 'clear');
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'refused';
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('A-REMOVED a person who left cannot clear the group', v_state = 'refused');
  INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_conv, pg_temp.u('g1'), 'after leave');
  PERFORM pg_temp.ok('A-REMOVED the leaver has no lifecycle row left (it cascaded away with the membership) or stays hidden',
    NOT EXISTS (SELECT 1 FROM public.conversation_participant_lifecycle WHERE conversation_id = v_conv AND user_id = pg_temp.u('g2') AND hidden_at IS NULL));
END $removed$;

-- A-DIRECT / A-OTHER-ROW: a client cannot write a cutoff for someone else.
DO $direct$
DECLARE v_dm uuid := pg_temp.u('dm'); v_peer uuid := pg_temp.u('peer'); v_err text := 'ok'; v_n bigint := 0;
BEGIN
  PERFORM pg_temp.as_user('me');
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    INSERT INTO public.conversation_participant_lifecycle(conversation_id, user_id, cleared_at) VALUES (v_dm, v_peer, now() + interval '1 day');
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  BEGIN
    UPDATE public.conversation_participant_lifecycle SET cleared_at = now() + interval '1 day' WHERE conversation_id = v_dm AND user_id = v_peer;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_n := 0;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('A-OTHER-ROW a client cannot insert a cutoff row for the peer', v_err <> 'ok');
  PERFORM pg_temp.ok('A-OTHER-ROW a client cannot update the peer''s row', v_n = 0);
  PERFORM pg_temp.ok('A-OTHER-ROW the peer still reads every message', 'old 1' = ANY (pg_temp.visible('peer', v_dm)));
END $direct$;

-- A-RECLEAR: clearing again moves the cutoff forward and never back.
DO $reclear$
DECLARE v_dm uuid := pg_temp.u('dm'); r1 jsonb; r2 jsonb;
BEGIN
  r1 := pg_temp.act('me', v_dm, 'clear');
  r2 := pg_temp.act('me', v_dm, 'clear');
  PERFORM pg_temp.ok('A-RECLEAR a second clear keeps a cutoff at or after the first',
    (r2 ->> 'clearedAt')::timestamptz >= (r1 ->> 'clearedAt')::timestamptz);
  r2 := pg_temp.act('me', v_dm, 'unarchive');
  PERFORM pg_temp.ok('A-RECLEAR unarchive keeps the cutoff', r2 ->> 'clearedAt' IS NOT NULL);
END $reclear$;

ROLLBACK;
