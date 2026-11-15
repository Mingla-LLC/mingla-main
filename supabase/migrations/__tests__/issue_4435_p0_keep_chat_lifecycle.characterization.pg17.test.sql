\set ON_ERROR_STOP on

-- #4435 Phase 0 characterization (KEEP): chat list lifecycle rules the #4435
-- build must not change. Frozen for the whole build.
--
--   HIDE-PRIVATE  hide removes the chat from my list only; the peer's list and
--                 lifecycle row are unchanged and I cannot read their row
--   ARCHIVE       archive / unarchive round-trip
--   ARCHIVE-STAYS a new message never clears archived_at
--   SYSTEM-NO-REOPEN a system message never reopens a hidden chat
--   LEAVE         leave_group_conversation removes the chat and session rows
--   PINS          pin and mark-unread are unchanged by hide
--   HISTORY       a member added after messages cannot read earlier messages
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

CREATE TEMP TABLE k3(tag text PRIMARY KEY, id uuid NOT NULL);

CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS
  $f$ SELECT id FROM k3 WHERE tag = p_tag $f$;

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

-- The conversation ids p_tag can see in its list (list_connection_conversation_access).
CREATE FUNCTION pg_temp.listed(p_tag text, p_conv uuid) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE v boolean;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  SET LOCAL ROLE authenticated;
  SELECT EXISTS (SELECT 1 FROM public.list_connection_conversation_access() a WHERE a.conversation_id = p_conv) INTO v;
  RESET ROLE;
  RETURN v;
END $f$;

DO $fixture$
DECLARE v_tag text; v_id uuid; v_dm uuid; v_s uuid; v_conv uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['me','peer','late','g1','g2'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'p0k3-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'p0k3-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k3 VALUES (v_tag, v_id);
  END LOOP;
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (pg_temp.u('me'), pg_temp.u('peer'), 'accepted'), (pg_temp.u('peer'), pg_temp.u('me'), 'accepted');
  INSERT INTO public.conversations(type, linked_entity_type, created_by)
    VALUES ('direct', 'direct', pg_temp.u('me')) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, pg_temp.u('me')), (v_dm, pg_temp.u('peer'));
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at)
    VALUES (v_dm, pg_temp.u('peer'), 'p0k3 first', now() - interval '1 hour');
  INSERT INTO k3 VALUES ('dm', v_dm);

  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('p0k3 crew', pg_temp.u('g1'), 'active') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_s, pg_temp.u('g1'), true), (v_s, pg_temp.u('g2'), true), (v_s, pg_temp.u('me'), true);
  SELECT id INTO v_conv FROM public.conversations WHERE session_id = v_s AND linked_entity_type = 'session';
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at)
    VALUES (v_conv, pg_temp.u('g1'), 'p0k3 crew before', now() - interval '1 hour');
  INSERT INTO k3 VALUES ('crew', v_s), ('crewc', v_conv);
END $fixture$;

-- ── PINS + HIDE-PRIVATE ────────────────────────────────────────────────────
DO $hide$
DECLARE v_dm uuid := pg_temp.u('dm'); v_seen int;
BEGIN
  PERFORM pg_temp.ok('HIDE-PRIVATE the chat starts in my list', pg_temp.listed('me', v_dm));
  PERFORM pg_temp.as_user('me');
  SET LOCAL ROLE authenticated;
  PERFORM public.set_conversation_list_state(v_dm, 'pin');
  PERFORM public.set_conversation_list_state(v_dm, 'mark_unread');
  PERFORM public.set_conversation_lifecycle(v_dm, 'hide');
  RESET ROLE;
  PERFORM pg_temp.ok('HIDE-PRIVATE hide removes it from my list', NOT pg_temp.listed('me', v_dm));
  PERFORM pg_temp.ok('HIDE-PRIVATE the peer still sees it', pg_temp.listed('peer', v_dm));
  PERFORM pg_temp.ok('HIDE-PRIVATE the peer has no lifecycle row',
    NOT EXISTS (SELECT 1 FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm AND user_id = pg_temp.u('peer')));
  PERFORM pg_temp.ok('PINS hide keeps pin and mark-unread',
    (SELECT pinned_at IS NOT NULL AND marked_unread_at IS NOT NULL AND hidden_at IS NOT NULL
       FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm AND user_id = pg_temp.u('me')));
  -- The peer cannot read my lifecycle row.
  PERFORM pg_temp.as_user('peer');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm;
  RESET ROLE;
  PERFORM pg_temp.ok('HIDE-PRIVATE my lifecycle row is unreadable to the peer', v_seen = 0);
END $hide$;

-- ── SYSTEM-NO-REOPEN ───────────────────────────────────────────────────────
DO $sys$
DECLARE v_dm uuid := pg_temp.u('dm');
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type) VALUES (v_dm, NULL, 'p0k3 system', 'system');
  PERFORM pg_temp.ok('SYSTEM-NO-REOPEN a system message keeps it hidden',
    (SELECT hidden_at IS NOT NULL FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm AND user_id = pg_temp.u('me')));
END $sys$;

-- ── ARCHIVE + ARCHIVE-STAYS ────────────────────────────────────────────────
DO $arch$
DECLARE v_dm uuid := pg_temp.u('dm'); r jsonb;
BEGIN
  DELETE FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm;
  PERFORM pg_temp.as_user('me');
  SET LOCAL ROLE authenticated;
  r := public.set_conversation_lifecycle(v_dm, 'archive');
  RESET ROLE;
  PERFORM pg_temp.ok('ARCHIVE archive sets archivedAt', r ->> 'archivedAt' IS NOT NULL AND r ->> 'hiddenAt' IS NULL);
  INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_dm, pg_temp.u('peer'), 'p0k3 while archived');
  INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_dm, pg_temp.u('me'), 'p0k3 mine while archived');
  PERFORM pg_temp.ok('ARCHIVE-STAYS messages never clear archived_at',
    (SELECT archived_at IS NOT NULL FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm AND user_id = pg_temp.u('me')));
  PERFORM pg_temp.as_user('me');
  SET LOCAL ROLE authenticated;
  r := public.set_conversation_lifecycle(v_dm, 'unarchive');
  RESET ROLE;
  PERFORM pg_temp.ok('ARCHIVE unarchive clears archivedAt', r ->> 'archivedAt' IS NULL);
  PERFORM pg_temp.ok('ARCHIVE the response keys stay conversationId, hiddenAt, archivedAt',
    r ?& ARRAY['conversationId', 'hiddenAt', 'archivedAt']);
END $arch$;

-- ── HISTORY ────────────────────────────────────────────────────────────────
DO $hist$
DECLARE v_s uuid := pg_temp.u('crew'); v_conv uuid := pg_temp.u('crewc'); v_old int; v_new int;
BEGIN
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('late'), true);
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at)
    VALUES (v_conv, pg_temp.u('g1'), 'p0k3 crew after', now() + interval '1 second');
  PERFORM pg_temp.as_user('late');
  SET LOCAL ROLE authenticated;
  SELECT count(*) FILTER (WHERE content = 'p0k3 crew before'), count(*) FILTER (WHERE content = 'p0k3 crew after')
    INTO v_old, v_new FROM public.messages WHERE conversation_id = v_conv;
  RESET ROLE;
  PERFORM pg_temp.ok('HISTORY a late joiner cannot read earlier messages', v_old = 0);
  PERFORM pg_temp.ok('HISTORY a late joiner reads newer messages', v_new = 1);
END $hist$;

-- ── LEAVE ──────────────────────────────────────────────────────────────────
DO $leave$
DECLARE v_s uuid := pg_temp.u('crew'); v_conv uuid := pg_temp.u('crewc');
BEGIN
  PERFORM pg_temp.as_user('me');
  SET LOCAL ROLE authenticated;
  PERFORM public.leave_group_conversation(v_conv);
  RESET ROLE;
  PERFORM pg_temp.ok('LEAVE removes my chat member row',
    NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = v_conv AND user_id = pg_temp.u('me')));
  PERFORM pg_temp.ok('LEAVE removes my session row',
    NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('me')));
  PERFORM pg_temp.ok('LEAVE the group stays for the others',
    EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $leave$;

ROLLBACK;
