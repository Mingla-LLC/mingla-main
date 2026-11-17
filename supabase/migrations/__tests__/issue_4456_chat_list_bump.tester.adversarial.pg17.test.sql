\set ON_ERROR_STOP on

-- #4456 tester adversarial: the Chats list live channel listens for UPDATEs on
-- public.conversations (useSocialRealtime chat-list-live-*). It only hears a
-- new message if the send itself bumps the conversation row. This checks that
-- an app send, made as the signed-in sender (not as the server), moves
-- last_message_at and updated_at. Everything rolls back.
--
-- MINGLA-INVARIANT: I-4456-SEND-BUMPS-CHAT | issue #4456 | a message an app user sends bumps its conversation's last_message_at and updated_at under that user's own role, so the Chats list live channel (UPDATE on conversations) hears every new message and every new chat's first message

BEGIN;
DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;
CREATE TEMP TABLE k(tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON k TO authenticated;

DO $bump$
DECLARE v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_dm uuid; v_g uuid; v_before timestamptz; r record;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_a, 't4456b-a-' || v_a || '@example.test'), (v_b, 't4456b-b-' || v_b || '@example.test');
  INSERT INTO public.conversations(type, linked_entity_type, created_by) VALUES ('direct', 'direct', v_a) RETURNING id INTO v_dm;
  INSERT INTO public.conversations(type, linked_entity_type, created_by, name) VALUES ('group', 'direct', v_a, 'crew') RETURNING id INTO v_g;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, v_a), (v_dm, v_b), (v_g, v_a), (v_g, v_b);
  ALTER TABLE public.conversations DISABLE TRIGGER update_conversations_updated_at;
  UPDATE public.conversations SET updated_at = now() - interval '1 day', last_message_at = NULL WHERE id IN (v_dm, v_g);
  ALTER TABLE public.conversations ENABLE TRIGGER update_conversations_updated_at;

  FOR r IN SELECT * FROM (VALUES ('1:1', v_dm), ('group', v_g)) AS t(kind, conv) LOOP
    PERFORM set_config('request.jwt.claim.sub', v_b::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type) VALUES (r.conv, v_b, 'new message', 'text');
    PERFORM set_config('role', 'postgres', true);
    IF (SELECT last_message_at IS NULL OR updated_at < now() - interval '1 hour' FROM public.conversations WHERE id = r.conv) THEN
      RAISE EXCEPTION 'FAIL BUMP % send as the sender does not bump the conversation (last_message_at=%, updated_at=%)', r.kind,
        (SELECT last_message_at FROM public.conversations WHERE id = r.conv), (SELECT updated_at FROM public.conversations WHERE id = r.conv);
    END IF;
    RAISE NOTICE 'PASS BUMP % send bumps the conversation', r.kind;
  END LOOP;
END $bump$;
ROLLBACK;
