\set ON_ERROR_STOP on

-- Issue #4114 Wave 2a — pin up to 3 chats and mark a chat unread, privately.
--
--   I-01  conversation_participant_lifecycle has nullable pinned_at and
--         marked_unread_at; authenticated still has SELECT only (no INSERT /
--         UPDATE / DELETE), and the pin-limit trigger exists.
--   I-02  a member pins 3 chats through set_conversation_list_state; the 4th
--         pin is refused with pin_limit_reached and leaves 3 pins.
--   I-03  re-pinning an already pinned chat is not counted twice; unpinning
--         one frees a slot so the 4th chat can be pinned.
--   I-04  mark_unread sets marked_unread_at and leaves message_reads alone;
--         mark_read clears it. Pins survive both.
--   I-05  a non-member cannot pin a chat they are not in
--         (conversation_unavailable) and cannot read another member's row.
--   I-06  list_connection_conversation_access() returns pinned_at and
--         marked_unread_at for the caller's own chats.
--   I-07  the limit holds for writers that bypass the RPC (service role /
--         postgres inserting directly).
--
-- FAILS-ON-REVERT (replay the chain without 20271230014114): I-01 fails on its
-- first check (no pinned_at column), and the RPC does not exist for I-02.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114p_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114p_ids TO authenticated;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_conv uuid;
  v_me uuid;
  v_i integer;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['me', 'f1', 'f2', 'f3', 'f4', 'f5', 'outsider'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114p-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114p-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    UPDATE public.profiles
       SET display_name = 'T4114 ' || v_tag, active = true, visibility_mode = 'public'
     WHERE id = v_id;
    INSERT INTO t4114p_ids VALUES (v_tag, v_id);
  END LOOP;

  v_me := (SELECT id FROM t4114p_ids WHERE tag = 'me');
  FOR v_i IN 1..5 LOOP
    INSERT INTO public.conversations(type, created_by)
      VALUES ('direct', v_me)
      RETURNING id INTO v_conv;
    INSERT INTO public.conversation_participants(conversation_id, user_id)
      SELECT v_conv, id FROM t4114p_ids WHERE tag IN ('me', 'f' || v_i);
    INSERT INTO t4114p_ids VALUES ('conv' || v_i, v_conv);
  END LOOP;

  -- A message from f1 that "me" has read, to prove mark_unread leaves receipts alone.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type)
    VALUES ((SELECT id FROM t4114p_ids WHERE tag = 'conv1'),
            (SELECT id FROM t4114p_ids WHERE tag = 'f1'), 'hi', 'text')
    RETURNING id INTO v_id;
  INSERT INTO public.message_reads(message_id, user_id) VALUES (v_id, v_me);
  INSERT INTO t4114p_ids VALUES ('msg1', v_id);
END $fixture$;

-- I-01 schema shape and grants.
DO $i01$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'conversation_participant_lifecycle'
     AND column_name IN ('pinned_at', 'marked_unread_at')
     AND data_type = 'timestamp with time zone' AND is_nullable = 'YES';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'I-01: pinned_at and marked_unread_at must be nullable timestamptz (found %)', v_count;
  END IF;
  IF has_table_privilege('authenticated', 'public.conversation_participant_lifecycle', 'INSERT')
     OR has_table_privilege('authenticated', 'public.conversation_participant_lifecycle', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.conversation_participant_lifecycle', 'DELETE') THEN
    RAISE EXCEPTION 'I-01: authenticated must not write the lifecycle table directly';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.conversation_participant_lifecycle'::regclass
       AND tgname = 'conversation_pin_limit' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'I-01: conversation_pin_limit trigger missing';
  END IF;
END $i01$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114p_ids WHERE tag = 'me'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114p_ids WHERE tag = 'me'), 'role', 'authenticated')::text, true);

DO $pins$
DECLARE
  v_me uuid := (SELECT id FROM t4114p_ids WHERE tag = 'me');
  v_refused boolean := false;
  v_message text;
  v_count integer;
  v_result jsonb;
  v_first_pin timestamptz;
BEGIN
  -- I-02
  PERFORM public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv1'), 'pin');
  PERFORM public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv2'), 'pin');
  PERFORM public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv3'), 'pin');
  BEGIN
    PERFORM public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv4'), 'pin');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_refused := true;
  END;
  IF NOT v_refused OR v_message IS DISTINCT FROM 'pin_limit_reached' THEN
    RAISE EXCEPTION 'I-02: the 4th pin must be refused with pin_limit_reached (refused=%, message=%)', v_refused, v_message;
  END IF;
  SELECT count(*) INTO v_count FROM public.conversation_participant_lifecycle
   WHERE user_id = v_me AND pinned_at IS NOT NULL;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'I-02: expected 3 pins, got %', v_count;
  END IF;

  -- I-03 re-pin keeps the original time and does not count twice
  SELECT pinned_at INTO v_first_pin FROM public.conversation_participant_lifecycle
   WHERE user_id = v_me AND conversation_id = (SELECT id FROM t4114p_ids WHERE tag = 'conv1');
  v_result := public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv1'), 'pin');
  IF (v_result->>'pinnedAt')::timestamptz IS DISTINCT FROM v_first_pin THEN
    RAISE EXCEPTION 'I-03: re-pinning must keep the original pinned_at';
  END IF;
  PERFORM public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv2'), 'unpin');
  PERFORM public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv4'), 'pin');
  SELECT count(*) INTO v_count FROM public.conversation_participant_lifecycle
   WHERE user_id = v_me AND pinned_at IS NOT NULL;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'I-03: after unpin + pin expected 3 pins, got %', v_count;
  END IF;

  -- I-04
  v_result := public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv1'), 'mark_unread');
  IF v_result->>'markedUnreadAt' IS NULL OR v_result->>'pinnedAt' IS NULL THEN
    RAISE EXCEPTION 'I-04: mark_unread must set the flag and keep the pin (%)', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.message_reads
     WHERE message_id = (SELECT id FROM t4114p_ids WHERE tag = 'msg1') AND user_id = v_me
  ) THEN
    RAISE EXCEPTION 'I-04: mark_unread must not delete read receipts';
  END IF;
  v_result := public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv1'), 'mark_read');
  IF v_result->>'markedUnreadAt' IS NOT NULL OR v_result->>'pinnedAt' IS NULL THEN
    RAISE EXCEPTION 'I-04: mark_read must clear the flag and keep the pin (%)', v_result;
  END IF;

  -- I-06
  SELECT count(*) INTO v_count FROM public.list_connection_conversation_access() access
   WHERE access.pinned_at IS NOT NULL;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'I-06: list_connection_conversation_access must return the 3 pins, got %', v_count;
  END IF;
END $pins$;

-- I-05 as an outsider
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114p_ids WHERE tag = 'outsider'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114p_ids WHERE tag = 'outsider'), 'role', 'authenticated')::text, true);

DO $outsider$
DECLARE
  v_refused boolean := false;
  v_count integer;
BEGIN
  BEGIN
    PERFORM public.set_conversation_list_state((SELECT id FROM t4114p_ids WHERE tag = 'conv5'), 'pin');
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'I-05: a non-member pinned a chat they are not in';
  END IF;
  SELECT count(*) INTO v_count FROM public.conversation_participant_lifecycle
   WHERE user_id = (SELECT id FROM t4114p_ids WHERE tag = 'me');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I-05: another member''s list state was readable (% rows)', v_count;
  END IF;
END $outsider$;

RESET ROLE;

-- I-07 direct writes still meet the limit.
DO $direct$
DECLARE
  v_refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.conversation_participant_lifecycle(conversation_id, user_id, pinned_at)
      VALUES ((SELECT id FROM t4114p_ids WHERE tag = 'conv5'), (SELECT id FROM t4114p_ids WHERE tag = 'me'), now());
  EXCEPTION WHEN check_violation THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'I-07: a direct insert made a 4th pin';
  END IF;
END $direct$;

SELECT 'issue_4114_conversation_pins: I-01..I-07 PASS' AS result;

ROLLBACK;
