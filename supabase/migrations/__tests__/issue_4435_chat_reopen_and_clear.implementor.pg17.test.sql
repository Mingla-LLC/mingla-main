\set ON_ERROR_STOP on

-- #4435 M-B (20280708064435): a removed chat comes back when either person
-- writes; Clear chat hides earlier messages for the person who cleared only.
-- Runs on the fully replayed PG17 schema; everything rolls back.
--
-- MINGLA-INVARIANT: I-4435-REOPEN-EITHER-SENDER | issue #4435 | a new human message from any participant, the sender included, clears hidden state; messages never clear archive state
-- MINGLA-INVARIANT: I-4435-CLEAR-IS-PRIVATE | issue #4435 | Clear chat hides messages created at or before the cutoff from that person only
--
-- Messages in this one transaction carry explicit past timestamps: a clear's
-- cutoff is now(), the transaction start.
--
-- Cases: R-OWN, R-PEER, R-SYSTEM, R-ARCHIVED, K-CLEAR, K-PEER, K-NEW, K-GROUP,
-- K-STATE, K-REFUSED, K-PRIVATE, T-REVERT, T-CATALOG.

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
    INSERT INTO auth.users(id, email) VALUES (v_id, 'c6-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'c6-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag)) ON CONFLICT (id) DO NOTHING;
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
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('c6 crew', pg_temp.u('g1'), 'active') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_s, pg_temp.u('g1'), true), (v_s, pg_temp.u('g2'), true), (v_s, pg_temp.u('me'), true);
  SELECT id INTO v_conv FROM public.conversations WHERE session_id = v_s AND linked_entity_type = 'session';
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES
    (v_conv, pg_temp.u('g1'), 'crew old', now() - interval '1 hour');
  INSERT INTO k6 VALUES ('crew', v_conv);
END $fixture$;

-- ── Reopen law ─────────────────────────────────────────────────────────────
DO $reopen$
DECLARE v_dm uuid := pg_temp.u('dm');
BEGIN
  PERFORM pg_temp.act('me', v_dm, 'hide');
  PERFORM pg_temp.ok('R-OWN hidden chat is off my list', NOT pg_temp.listed('me', v_dm));
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, created_at)
    VALUES (v_dm, NULL, 'system line', 'system', now() - interval '40 minutes');
  PERFORM pg_temp.ok('R-SYSTEM a system message keeps it removed', pg_temp.hidden(v_dm, 'me'));
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_dm, pg_temp.u('me'), 'from my profile', now() - interval '30 minutes');
  PERFORM pg_temp.ok('R-OWN my own message brings it back', NOT pg_temp.hidden(v_dm, 'me') AND pg_temp.listed('me', v_dm));
  PERFORM pg_temp.act('me', v_dm, 'hide');
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_dm, pg_temp.u('peer'), 'from them', now() - interval '30 minutes');
  PERFORM pg_temp.ok('R-PEER the peer''s message brings it back', NOT pg_temp.hidden(v_dm, 'me'));
  PERFORM pg_temp.act('me', v_dm, 'archive');
  PERFORM pg_temp.act('me', v_dm, 'hide');
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_dm, pg_temp.u('peer'), 'to archived', now() - interval '30 minutes');
  PERFORM pg_temp.ok('R-ARCHIVED an archived and removed chat comes back, still archived',
    NOT pg_temp.hidden(v_dm, 'me')
    AND (SELECT archived_at IS NOT NULL FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm AND user_id = pg_temp.u('me')));
  PERFORM pg_temp.act('me', v_dm, 'unarchive');
  -- the peer's own row is never created or changed by my hide
  PERFORM pg_temp.ok('R-PEER the peer has no lifecycle row',
    NOT EXISTS (SELECT 1 FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm AND user_id = pg_temp.u('peer')));
END $reopen$;

-- ── Clear chat ─────────────────────────────────────────────────────────────
DO $clear$
DECLARE v_dm uuid := pg_temp.u('dm'); r jsonb; v_before text[]; v_peer_before text[];
BEGIN
  v_before := pg_temp.visible('me', v_dm);
  v_peer_before := pg_temp.visible('peer', v_dm);
  PERFORM pg_temp.act('me', v_dm, 'archive');
  r := pg_temp.act('me', v_dm, 'clear');
  PERFORM pg_temp.ok('K-CLEAR returns clearedAt', r ->> 'clearedAt' IS NOT NULL AND r ? 'hiddenAt' AND r ? 'archivedAt');
  -- (within this one transaction a clear's cutoff is the transaction start, and
  -- messages written by a signed-in sender get the server's clock time, so the
  -- messages sent above land after the cutoff; the two fixture messages do not)
  PERFORM pg_temp.ok('K-CLEAR every message at or before the cutoff is gone for me',
    'old 1' = ANY (v_before) AND 'old 2' = ANY (v_before)
    AND NOT ('old 1' = ANY (pg_temp.visible('me', v_dm))) AND NOT ('old 2' = ANY (pg_temp.visible('me', v_dm)))
    AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = v_dm
                     AND m.created_at <= (r ->> 'clearedAt')::timestamptz AND m.message_type <> 'system'
                     AND m.content = ANY (pg_temp.visible('me', v_dm))));
  PERFORM pg_temp.ok('K-PEER the other person still sees all of them', pg_temp.visible('peer', v_dm) = v_peer_before);
  PERFORM pg_temp.ok('K-STATE clear keeps archive state', (r ->> 'archivedAt') IS NOT NULL);
  PERFORM pg_temp.act('me', v_dm, 'unarchive');
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at) VALUES (v_dm, pg_temp.u('peer'), 'after clear', now() + interval '1 second');
  PERFORM pg_temp.ok('K-NEW new messages appear normally', 'after clear' = ANY (pg_temp.visible('me', v_dm)));
  PERFORM pg_temp.ok('K-STATE a new message never clears cleared_at',
    (SELECT cleared_at IS NOT NULL FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm AND user_id = pg_temp.u('me')));
  r := pg_temp.act('me', v_dm, 'hide');
  PERFORM pg_temp.ok('K-STATE hide keeps cleared_at', r ->> 'clearedAt' IS NOT NULL);
END $clear$;

DO $group$
DECLARE v_conv uuid := pg_temp.u('crew');
BEGIN
  PERFORM pg_temp.act('me', v_conv, 'clear');
  PERFORM pg_temp.ok('K-GROUP clearing a group clears it for me', pg_temp.visible('me', v_conv) = ARRAY[]::text[]);
  PERFORM pg_temp.ok('K-GROUP everyone else still sees it', pg_temp.visible('g1', v_conv) = ARRAY['crew old'] AND pg_temp.visible('g2', v_conv) = ARRAY['crew old']);
END $group$;

DO $refused$
DECLARE v_dm uuid := pg_temp.u('dm'); v_state text := 'none'; v_seen int; v_me uuid := pg_temp.u('me');
BEGIN
  PERFORM pg_temp.as_user('x');
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.set_conversation_lifecycle(v_dm, 'clear');
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'refused';
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('K-REFUSED someone outside the chat cannot clear it', v_state = 'refused');
  v_state := 'none';
  PERFORM pg_temp.as_user('me');
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.set_conversation_lifecycle(v_dm, 'wipe');
  EXCEPTION WHEN invalid_parameter_value THEN v_state := 'refused';
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('K-REFUSED an unknown action is still refused', v_state = 'refused');
  -- K-PRIVATE: the peer cannot read my cutoff
  PERFORM pg_temp.as_user('peer');
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_seen FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm AND user_id = v_me;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('K-PRIVATE my lifecycle row (with cleared_at) is unreadable to the peer', v_seen = 0);
END $refused$;

-- ── T-REVERT ───────────────────────────────────────────────────────────────
DO $revert$
DECLARE v_dm uuid := pg_temp.u('dm'); v_hidden boolean; v_seen text[];
BEGIN
  BEGIN
    DROP POLICY messages_cleared_for_me ON public.messages;
    v_seen := pg_temp.visible('me', v_dm);
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT435';
  EXCEPTION WHEN SQLSTATE 'XT435' THEN NULL;
  END;
  PERFORM pg_temp.ok('T-REVERT without the policy the cleared messages come back (K-CLEAR fails on revert)', 'old 1' = ANY (v_seen));
  BEGIN
    CREATE OR REPLACE FUNCTION public.tg_reopen_hidden_conversation_on_human_message()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $b$
    BEGIN
      IF NEW.sender_id IS NULL OR NEW.deleted_at IS NOT NULL OR NEW.message_type = 'system' THEN RETURN NEW; END IF;
      UPDATE public.conversation_participant_lifecycle lifecycle SET hidden_at = NULL
       WHERE lifecycle.conversation_id = NEW.conversation_id AND lifecycle.user_id <> NEW.sender_id
         AND lifecycle.hidden_at IS NOT NULL AND lifecycle.archived_at IS NULL
         AND EXISTS (SELECT 1 FROM public.content_share_recipient_candidates(lifecycle.user_id, false, true) c
                      WHERE c.conversation_id = NEW.conversation_id);
      RETURN NEW;
    END $b$;
    PERFORM pg_temp.act('me', v_dm, 'hide');
    INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_dm, pg_temp.u('me'), 'revert own');
    v_hidden := pg_temp.hidden(v_dm, 'me');
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'XT435';
  EXCEPTION WHEN SQLSTATE 'XT435' THEN NULL;
  END;
  PERFORM pg_temp.ok('T-REVERT with the old reopen law my own message keeps it removed (R-OWN fails on revert)', v_hidden);
END $revert$;

-- ── T-CATALOG ──────────────────────────────────────────────────────────────
DO $catalog$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'messages'
                  AND policyname = 'messages_cleared_for_me' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'FAIL T-CATALOG messages_cleared_for_me must be a RESTRICTIVE SELECT policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                      AND schemaname = 'public' AND tablename = 'conversation_participant_lifecycle') THEN
    RAISE EXCEPTION 'FAIL T-CATALOG lifecycle rows are not published to realtime';
  END IF;
  IF has_table_privilege('anon', 'public.conversation_participant_lifecycle', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL T-CATALOG anon must not read lifecycle rows';
  END IF;
  RAISE NOTICE 'PASS T-CATALOG policy, publication and grants';
END $catalog$;

ROLLBACK;
