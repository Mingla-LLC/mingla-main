\set ON_ERROR_STOP on

-- Issue #4114 Wave 5 — a collab inside a 1:1 chat.
--
--   I-01  collaboration_sessions.conversation_id exists, references
--         conversations ON DELETE SET NULL, and a partial unique index allows one
--         live session per chat.
--   I-02  start_dm_collab in a friends' 1:1 chat creates NO group chat: the
--         session is pending and linked to the 1:1 chat, the starter is accepted,
--         the friend is invited (pending participant + pending invite), the
--         starter's prefs are seeded, and the "started" system row is in the chat.
--   I-03  non-friends are refused (not_friends); a blocked pair is refused
--         (blocked); a non-member of the chat is refused (conversation_unavailable).
--   I-04  a second live session in the same chat is refused
--         (collab_already_live), and the free plan's one open session is
--         enforced (session_limit_reached, decision D4).
--   I-05  the friend joins through accept_session_with_prefs: a "joined" row
--         lands in the 1:1 chat and nobody is added to or removed from it.
--   I-06  lock-and-schedule and the dead-end banner post into the 1:1 chat
--         (resolve_session_conversation), not into any group chat.
--   I-07  list_connection_conversation_access() returns the chat's live session.
--   I-08  leaving the active collab deletes the session (under two people) but
--         the 1:1 chat survives with both members and an "ended" row.
--   I-09  declining the invite ends the collab and keeps the chat.
--   I-10  nobody can point a session at a chat directly (dm_collab_link_forbidden),
--         and a group collab still gets its own group chat.
--   I-11  end_dm_collab: a stranger is refused; a member ends it, the chat stays.
--   I-12  deleting the 1:1 chat clears the link instead of deleting the session.
--
-- FAILS-ON-REVERT (replay the chain without 20271230044114): I-01 fails on its
-- first check (no conversation_id column) and start_dm_collab does not exist.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114d_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON t4114d_ids TO authenticated;

-- The bare PostgreSQL image has no Supabase Realtime server, so the ORCH-0931
-- session_updated broadcast trigger (participant_prefs changes) would fail on
-- realtime.send. Switch that one trigger off for this transaction when
-- realtime.send is missing (the ROLLBACK restores it).
DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

-- Free plan for everyone in this transaction.
DELETE FROM public.app_config WHERE config_key = 'global_plus_access';

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_conv uuid;
  v_pair text[];
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['ife', 'tomi', 'stranger', 'blocker', 'eve', 'outsider', 'gina'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114d-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114d-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    UPDATE public.profiles
       SET display_name = initcap(v_tag) || ' Test', first_name = initcap(v_tag),
           active = true, visibility_mode = 'public'
     WHERE id = v_id;
    INSERT INTO t4114d_ids VALUES (v_tag, v_id);
  END LOOP;

  -- Friends: ife-tomi, ife-blocker, ife-eve, tomi-gina. ife-stranger are not friends.
  FOREACH v_tag IN ARRAY ARRAY['tomi', 'blocker', 'eve'] LOOP
    INSERT INTO public.friends(user_id, friend_user_id, status)
      VALUES ((SELECT id FROM t4114d_ids WHERE tag = 'ife'), (SELECT id FROM t4114d_ids WHERE tag = v_tag), 'accepted');
  END LOOP;
  INSERT INTO public.friends(user_id, friend_user_id, status)
    VALUES ((SELECT id FROM t4114d_ids WHERE tag = 'gina'), (SELECT id FROM t4114d_ids WHERE tag = 'tomi'), 'accepted');
  INSERT INTO public.blocked_users(blocker_id, blocked_id)
    VALUES ((SELECT id FROM t4114d_ids WHERE tag = 'blocker'), (SELECT id FROM t4114d_ids WHERE tag = 'ife'));

  -- One 1:1 chat per pair.
  FOR v_tag IN SELECT unnest(ARRAY['tomi', 'stranger', 'blocker', 'eve']) LOOP
    INSERT INTO public.conversations(type, created_by)
      VALUES ('direct', (SELECT id FROM t4114d_ids WHERE tag = 'ife'))
      RETURNING id INTO v_conv;
    INSERT INTO public.conversation_participants(conversation_id, user_id)
      SELECT v_conv, id FROM t4114d_ids WHERE tag IN ('ife', v_tag);
    INSERT INTO t4114d_ids VALUES ('dm_' || v_tag, v_conv);
  END LOOP;
  INSERT INTO public.conversations(type, created_by)
    VALUES ('direct', (SELECT id FROM t4114d_ids WHERE tag = 'gina'))
    RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id)
    SELECT v_conv, id FROM t4114d_ids WHERE tag IN ('gina', 'tomi');
  INSERT INTO t4114d_ids VALUES ('dm_gina', v_conv);

  -- Ife's solo prefs, to prove they are seeded.
  INSERT INTO public.preferences(profile_id, categories, travel_mode, travel_constraint_value)
    VALUES ((SELECT id FROM t4114d_ids WHERE tag = 'ife'), ARRAY['drinks_and_music'], 'driving', 25)
    ON CONFLICT (profile_id) DO UPDATE
      SET categories = EXCLUDED.categories, travel_mode = EXCLUDED.travel_mode,
          travel_constraint_value = EXCLUDED.travel_constraint_value;
END $fixture$;

-- I-01 schema.
DO $i01$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.collaboration_sessions'::regclass
       AND con.contype = 'f' AND att.attname = 'conversation_id'
       AND con.confrelid = 'public.conversations'::regclass
       AND con.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'I-01: collaboration_sessions.conversation_id must reference conversations ON DELETE SET NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'collaboration_sessions_one_live_per_conversation'
       AND indexdef ILIKE '%UNIQUE%'
  ) THEN
    RAISE EXCEPTION 'I-01: one-live-session-per-chat unique index missing';
  END IF;
END $i01$;

SET LOCAL ROLE authenticated;

-- ── as Ife ──────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'ife'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'ife'), 'role', 'authenticated')::text, true);

DO $i02$
DECLARE
  v_result jsonb;
  v_session uuid;
  v_message text;
  v_refused boolean;
BEGIN
  v_result := public.start_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi'));
  v_session := (v_result->>'session_id')::uuid;
  IF v_session IS NULL OR v_result->>'invite_id' IS NULL THEN
    RAISE EXCEPTION 'I-02: start_dm_collab must return session_id and invite_id (%)', v_result;
  END IF;
  IF v_result->>'session_name' IS DISTINCT FROM 'Ife & Tomi' THEN
    RAISE EXCEPTION 'I-02: default name should be "Ife & Tomi", got %', v_result->>'session_name';
  END IF;
  INSERT INTO t4114d_ids VALUES ('s1', v_session), ('inv1', (v_result->>'invite_id')::uuid);

  -- I-03 refusals (still as Ife).
  v_refused := false;
  BEGIN
    PERFORM public.start_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 'dm_stranger'));
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; v_refused := true;
  END;
  IF NOT v_refused OR v_message <> 'not_friends' THEN
    RAISE EXCEPTION 'I-03: non-friends must be refused with not_friends (got %)', v_message;
  END IF;
  v_refused := false;
  BEGIN
    PERFORM public.start_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 'dm_blocker'));
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; v_refused := true;
  END;
  IF NOT v_refused OR v_message <> 'blocked' THEN
    RAISE EXCEPTION 'I-03: a blocked pair must be refused with blocked (got %)', v_message;
  END IF;
  v_refused := false;
  BEGIN
    PERFORM public.start_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 'dm_gina'));
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; v_refused := true;
  END;
  IF NOT v_refused OR v_message <> 'conversation_unavailable' THEN
    RAISE EXCEPTION 'I-03: a non-member must be refused (got %)', v_message;
  END IF;

  -- I-04b the free plan (Ife already has one open session).
  v_refused := false;
  BEGIN
    PERFORM public.start_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 'dm_eve'));
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; v_refused := true;
  END;
  IF NOT v_refused OR v_message NOT LIKE 'session_limit_reached:%' THEN
    RAISE EXCEPTION 'I-04: the free plan must refuse a second open session (got %)', v_message;
  END IF;
END $i02$;

RESET ROLE;

DO $i02_check$
DECLARE
  v_session uuid := (SELECT id FROM t4114d_ids WHERE tag = 's1');
  v_dm uuid := (SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi');
  v_ife uuid := (SELECT id FROM t4114d_ids WHERE tag = 'ife');
  v_tomi uuid := (SELECT id FROM t4114d_ids WHERE tag = 'tomi');
  v_prefs jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversations WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'I-02: a group chat was created for a 1:1 collab';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.collaboration_sessions
     WHERE id = v_session AND conversation_id = v_dm AND status = 'pending' AND created_by = v_ife
  ) THEN
    RAISE EXCEPTION 'I-02: session must be pending and linked to the 1:1 chat';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_session AND user_id = v_ife AND has_accepted)
     OR NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_session AND user_id = v_tomi AND has_accepted IS NOT TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.collaboration_invites WHERE session_id = v_session AND invited_user_id = v_tomi AND inviter_id = v_ife AND status = 'pending') THEN
    RAISE EXCEPTION 'I-02: starter accepted, friend invited (participant + invite) expected';
  END IF;
  SELECT participant_prefs -> v_ife::text INTO v_prefs FROM public.collaboration_sessions WHERE id = v_session;
  IF v_prefs->>'travel_mode' IS DISTINCT FROM 'driving' OR v_prefs->'categories' <> '["drinks_and_music"]'::jsonb THEN
    RAISE EXCEPTION 'I-02: the starter''s prefs were not seeded (%)', v_prefs;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages
     WHERE conversation_id = v_dm AND sender_id IS NULL AND message_type = 'system'
       AND card_payload->>'kind' = 'dm_collab' AND card_payload->>'event' = 'started'
       AND card_payload->>'session_id' = v_session::text AND content = 'Ife started a collab'
  ) THEN
    RAISE EXCEPTION 'I-02: the "started" system row is missing from the 1:1 chat';
  END IF;
  IF (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = v_dm) <> 2 THEN
    RAISE EXCEPTION 'I-02: the 1:1 chat roster changed';
  END IF;
END $i02_check$;

SET LOCAL ROLE authenticated;

-- ── as Tomi ─────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'tomi'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'tomi'), 'role', 'authenticated')::text, true);

DO $i04_i05$
DECLARE
  v_message text;
  v_refused boolean := false;
  v_result jsonb;
BEGIN
  -- I-04a a second live session in the same chat.
  BEGIN
    PERFORM public.start_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi'));
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; v_refused := true;
  END;
  IF NOT v_refused OR v_message <> 'collab_already_live' THEN
    RAISE EXCEPTION 'I-04: a second live session in one chat must be refused (got %)', v_message;
  END IF;

  -- The friend sees the session (RLS) by the chat id, as the app looks it up.
  IF NOT EXISTS (
    SELECT 1 FROM public.collaboration_sessions
     WHERE conversation_id = (SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi')
       AND status IN ('pending', 'active')
  ) THEN
    RAISE EXCEPTION 'I-05: the invited friend cannot read the chat''s live session';
  END IF;

  -- I-05 Join.
  v_result := public.accept_session_with_prefs(
    (SELECT id FROM t4114d_ids WHERE tag = 's1'),
    (SELECT id FROM t4114d_ids WHERE tag = 'inv1'),
    NULL, NULL, ARRAY['nature'], ARRAY[]::text[], 'walking', 30
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'I-05: accept failed (%)', v_result;
  END IF;
  -- The app activates the session once two have accepted (collaborationInviteService).
  UPDATE public.collaboration_sessions SET status = 'active'
   WHERE id = (SELECT id FROM t4114d_ids WHERE tag = 's1');
END $i04_i05$;

RESET ROLE;

DO $i05_check$
DECLARE
  v_dm uuid := (SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.messages
     WHERE conversation_id = v_dm AND message_type = 'system' AND card_payload->>'event' = 'joined'
       AND content = 'Tomi joined the collab'
  ) THEN
    RAISE EXCEPTION 'I-05: the "joined" row is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conversations WHERE session_id = (SELECT id FROM t4114d_ids WHERE tag = 's1')) THEN
    RAISE EXCEPTION 'I-05: a group chat appeared on accept';
  END IF;
  IF (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = v_dm) <> 2 THEN
    RAISE EXCEPTION 'I-05: the 1:1 chat roster changed on accept';
  END IF;
  INSERT INTO public.board_saved_cards(session_id, experience_id, card_data, saved_by)
    VALUES ((SELECT id FROM t4114d_ids WHERE tag = 's1'), 'place-t4114d',
            '{"title":"Bature Brewery","id":"place-t4114d"}'::jsonb,
            (SELECT id FROM t4114d_ids WHERE tag = 'ife'))
    RETURNING id INTO v_dm;
  INSERT INTO t4114d_ids VALUES ('card1', v_dm);
END $i05_check$;

SET LOCAL ROLE authenticated;

-- ── as Ife: lock, banner, list ──────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'ife'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'ife'), 'role', 'authenticated')::text, true);

DO $i06_i07$
DECLARE
  v_dm uuid := (SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi');
  v_session uuid := (SELECT id FROM t4114d_ids WHERE tag = 's1');
  v_banner uuid;
BEGIN
  PERFORM public.rpc_admin_lock_and_schedule_card(
    v_session, (SELECT id FROM t4114d_ids WHERE tag = 'card1'), now() + interval '2 days', 90
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.messages
     WHERE conversation_id = v_dm AND message_type = 'card'
       AND card_payload->>'lockInEvent' = 'card_locked_and_scheduled'
       AND card_payload->>'title' = 'Bature Brewery'
  ) THEN
    RAISE EXCEPTION 'I-06: the lock-and-schedule card did not land in the 1:1 chat';
  END IF;

  v_banner := public.rpc_post_collab_dead_end_banner(
    v_session, 'intersection_empty',
    jsonb_build_object('kind', 'collab_dead_end', 'participants', jsonb_build_array(jsonb_build_object('userId', 'x')), 'prose', 'No overlap yet')
  );
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = v_banner AND conversation_id = v_dm) THEN
    RAISE EXCEPTION 'I-06: the dead-end banner did not land in the 1:1 chat';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.list_connection_conversation_access() access
     WHERE access.conversation_id = v_dm AND access.live_session_id = v_session
       AND access.live_session_status = 'active'
  ) THEN
    RAISE EXCEPTION 'I-07: list_connection_conversation_access must return the chat''s live session';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.list_connection_conversation_access() access
     WHERE access.conversation_id = (SELECT id FROM t4114d_ids WHERE tag = 'dm_eve')
       AND access.live_session_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'I-07: a chat without a collab reported a live session';
  END IF;

  -- I-10 a member cannot repoint the session at another chat.
  BEGIN
    UPDATE public.collaboration_sessions
       SET conversation_id = (SELECT id FROM t4114d_ids WHERE tag = 'dm_eve')
     WHERE id = v_session;
    RAISE EXCEPTION 'I-10: repointing a session at another chat was allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $i06_i07$;

SET LOCAL ROLE authenticated;

-- ── as Tomi: leave ──────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'tomi'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'tomi'), 'role', 'authenticated')::text, true);

DELETE FROM public.session_participants
 WHERE session_id = (SELECT id FROM t4114d_ids WHERE tag = 's1')
   AND user_id = (SELECT id FROM t4114d_ids WHERE tag = 'tomi');

RESET ROLE;

DO $i08$
DECLARE
  v_dm uuid := (SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi');
BEGIN
  IF EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = (SELECT id FROM t4114d_ids WHERE tag = 's1')) THEN
    RAISE EXCEPTION 'I-08: the session should be deleted once under two people';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = v_dm) THEN
    RAISE EXCEPTION 'I-08: the 1:1 chat was deleted with the session';
  END IF;
  IF (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = v_dm) <> 2 THEN
    RAISE EXCEPTION 'I-08: leaving the collab removed someone from the 1:1 chat';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages
     WHERE conversation_id = v_dm AND message_type = 'system' AND card_payload->>'event' = 'ended'
  ) THEN
    RAISE EXCEPTION 'I-08: the "ended" row is missing';
  END IF;
  IF (SELECT count(*) FROM public.messages WHERE conversation_id = v_dm) < 5 THEN
    RAISE EXCEPTION 'I-08: chat history was lost with the session';
  END IF;
END $i08$;

SET LOCAL ROLE authenticated;

-- ── I-09 decline ends it ────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'ife'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'ife'), 'role', 'authenticated')::text, true);

DO $i09_start$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.start_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi'), 'Saturday plans');
  IF v_result->>'session_name' <> 'Saturday plans' THEN
    RAISE EXCEPTION 'I-09: a given name must be kept';
  END IF;
  INSERT INTO t4114d_ids VALUES ('s2', (v_result->>'session_id')::uuid);
END $i09_start$;

SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'tomi'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'tomi'), 'role', 'authenticated')::text, true);

UPDATE public.collaboration_invites SET status = 'declined'
 WHERE session_id = (SELECT id FROM t4114d_ids WHERE tag = 's2')
   AND invited_user_id = (SELECT id FROM t4114d_ids WHERE tag = 'tomi');

RESET ROLE;

DO $i09$
BEGIN
  IF EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = (SELECT id FROM t4114d_ids WHERE tag = 's2')) THEN
    RAISE EXCEPTION 'I-09: declining must end the 1:1 collab';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = (SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi')) THEN
    RAISE EXCEPTION 'I-09: declining deleted the chat';
  END IF;
END $i09$;

SET LOCAL ROLE authenticated;

-- ── I-10 group collabs unchanged; I-11 end_dm_collab ───────────────────
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'eve'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'eve'), 'role', 'authenticated')::text, true);

DO $i10$
DECLARE
  v_group_session uuid;
  v_refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.collaboration_sessions(name, created_by, status, conversation_id)
      VALUES ('Sneaky', (SELECT id FROM t4114d_ids WHERE tag = 'eve'), 'pending',
              (SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi'));
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'I-10: a direct insert linked a session to someone else''s chat';
  END IF;

  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('Eve group', (SELECT id FROM t4114d_ids WHERE tag = 'eve'), 'pending')
    RETURNING id INTO v_group_session;
  INSERT INTO t4114d_ids VALUES ('group1', v_group_session);
END $i10$;

RESET ROLE;

DO $i10_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
     WHERE session_id = (SELECT id FROM t4114d_ids WHERE tag = 'group1')
       AND type = 'group' AND linked_entity_type = 'session'
  ) THEN
    RAISE EXCEPTION 'I-10: a group collab lost its group chat';
  END IF;
END $i10_check$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'ife'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'ife'), 'role', 'authenticated')::text, true);

DO $i11_start$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.start_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi'));
  INSERT INTO t4114d_ids VALUES ('s3', (v_result->>'session_id')::uuid);
END $i11_start$;

SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'outsider'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'outsider'), 'role', 'authenticated')::text, true);

DO $i11_stranger$
DECLARE
  v_refused boolean := false;
BEGIN
  BEGIN
    PERFORM public.end_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 's3'));
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'I-11: a stranger ended someone''s collab';
  END IF;
END $i11_stranger$;

SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'tomi'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'tomi'), 'role', 'authenticated')::text, true);

SELECT public.end_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 's3'));

RESET ROLE;

DO $i11_i12$
DECLARE
  v_result jsonb;
  v_session uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = (SELECT id FROM t4114d_ids WHERE tag = 's3')) THEN
    RAISE EXCEPTION 'I-11: end_dm_collab did not end it';
  END IF;
  IF (SELECT count(*) FROM public.conversation_participants
       WHERE conversation_id = (SELECT id FROM t4114d_ids WHERE tag = 'dm_tomi')) <> 2 THEN
    RAISE EXCEPTION 'I-11: ending the collab changed the chat';
  END IF;

  -- I-12 deleting the chat keeps the session and clears the link.
  PERFORM set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114d_ids WHERE tag = 'gina'), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM t4114d_ids WHERE tag = 'gina'), 'role', 'authenticated')::text, true);
  v_result := public.start_dm_collab((SELECT id FROM t4114d_ids WHERE tag = 'dm_gina'));
  v_session := (v_result->>'session_id')::uuid;
  DELETE FROM public.conversations WHERE id = (SELECT id FROM t4114d_ids WHERE tag = 'dm_gina');
  IF NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_session AND conversation_id IS NULL) THEN
    RAISE EXCEPTION 'I-12: deleting the chat must clear the link, not delete the session';
  END IF;
END $i11_i12$;

SELECT 'issue_4114_dm_collab: I-01..I-12 PASS' AS result;

ROLLBACK;
