\set ON_ERROR_STOP on

-- Issue #4114 Wave 4 rework 3 — a view-once purge cannot be undone by a client.
--
--   P-01  once view_once_purged_at is set on an unsent view-once message, a
--         client cannot bring it back (deleted_at set back to NULL, 23514).
--         Run as a client request inside a privileged caller (the jwt role is
--         'authenticated', row security does not hide the unsent row), so the
--         trigger itself is what refuses.
--   P-02  a client cannot clear view_once_purged_at (23514).
--   P-03  a client cannot move view_once_purged_at to another time (23514).
--   P-04  the rule is scoped to purged messages: a client can still unsend a
--         purged message, can still restore an unsent message that was never
--         purged, and service code can still write view_once_purged_at.
--
-- FAILS-ON-REVERT: delete the "IF OLD.view_once_purged_at IS NOT NULL" block of
-- issue_4114_enforce_view_once_shape (or drop deleted_at / view_once_purged_at
-- from the trigger's UPDATE OF list) and P-01..P-03 fail.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114p_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114p_ids TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.t4114p_as(p_tag text, p_role text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := (SELECT id FROM t4114p_ids WHERE tag = p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_id::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', p_role)::text, true);
END $fn$;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_dm uuid;
  v_ana uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['ana', 'ben'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114p-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114p-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114p_ids VALUES (v_tag, v_id);
  END LOOP;
  v_ana := (SELECT id FROM t4114p_ids WHERE tag = 'ana');
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_ana) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_dm, id, now() - interval '30 days' FROM t4114p_ids;
  INSERT INTO t4114p_ids VALUES ('dm', v_dm);

  -- Server-side fixture rows (no client claims, so the trigger keeps them).
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, deleted_at, view_once_purged_at)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/once/' || gen_random_uuid() || '.jpg', true, now() - interval '2 hours', now() - interval '1 hour')
    RETURNING id INTO v_id;
  INSERT INTO t4114p_ids VALUES ('unsent_purged', v_id);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, view_once_purged_at)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/once/' || gen_random_uuid() || '.jpg', true, now() - interval '1 hour')
    RETURNING id INTO v_id;
  INSERT INTO t4114p_ids VALUES ('opened_purged', v_id);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, deleted_at)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/once/' || gen_random_uuid() || '.jpg', true, now() - interval '5 minutes')
    RETURNING id INTO v_id;
  INSERT INTO t4114p_ids VALUES ('unsent_live', v_id);
END $fixture$;

-- P-01: a client request run by a privileged caller cannot restore an unsent, purged message.
SELECT pg_temp.t4114p_as('ana', 'authenticated');
DO $p01$
DECLARE
  v_id uuid := (SELECT id FROM t4114p_ids WHERE tag = 'unsent_purged');
  v_refused boolean := false;
BEGIN
  BEGIN
    UPDATE public.messages SET deleted_at = NULL WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused OR (SELECT deleted_at FROM public.messages WHERE id = v_id) IS NULL THEN
    RAISE EXCEPTION 'P-01: a client brought back a purged view-once message';
  END IF;
  -- Neither may it clear the purge on that row.
  v_refused := false;
  BEGIN
    UPDATE public.messages SET view_once_purged_at = NULL, deleted_at = NULL WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'P-01: a client cleared the purge of an unsent view-once message';
  END IF;
END $p01$;

-- P-02 / P-03 / P-04 as ana under the authenticated role (row security on).
SET LOCAL ROLE authenticated;
DO $p02$
DECLARE
  v_id uuid := (SELECT id FROM t4114p_ids WHERE tag = 'opened_purged');
  v_refused integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = v_id) THEN
    RAISE EXCEPTION 'P-02: fixture row not visible to its sender';
  END IF;
  BEGIN
    UPDATE public.messages SET view_once_purged_at = NULL WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  BEGIN
    UPDATE public.messages SET view_once_purged_at = now() + interval '1 day' WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  IF v_refused <> 2 THEN
    RAISE EXCEPTION 'P-02/P-03: expected 2 refused purge changes, got %', v_refused;
  END IF;

END $p02$;
RESET ROLE;

DO $p04$
DECLARE
  v_live uuid := (SELECT id FROM t4114p_ids WHERE tag = 'unsent_live');
  v_opened uuid := (SELECT id FROM t4114p_ids WHERE tag = 'opened_purged');
BEGIN
  -- Unsending a purged message still works (client request, privileged caller,
  -- since the sender's own row policy hides unsent rows).
  PERFORM pg_temp.t4114p_as('ana', 'authenticated');
  UPDATE public.messages SET deleted_at = now() WHERE id = v_opened;
  IF (SELECT deleted_at FROM public.messages WHERE id = v_opened) IS NULL THEN
    RAISE EXCEPTION 'P-04: a client could not unsend a purged message';
  END IF;
  -- A never-purged unsent message can still be restored by a client request.
  UPDATE public.messages SET deleted_at = NULL WHERE id = v_live;
  IF (SELECT deleted_at FROM public.messages WHERE id = v_live) IS NOT NULL THEN
    RAISE EXCEPTION 'P-04: the rule reached a message that was never purged';
  END IF;
  -- Service code still owns the purge column.
  PERFORM pg_temp.t4114p_as('ana', 'service_role');
  UPDATE public.messages SET view_once_purged_at = now() WHERE id = v_opened;
END $p04$;

SELECT 'issue_4114_chat_media_purge_final: P-01..P-04 PASS' AS result;

ROLLBACK;
