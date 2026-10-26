\set ON_ERROR_STOP on

-- Issue #4114 — only the service-role sweep may set view_once_purged_at.
--
--   V-01  a client (jwt role 'authenticated', row security on) cannot set
--         view_once_purged_at on its own, never-purged view-once message
--         (23514), and the column stays NULL.
--   V-02  a client cannot insert a message that already carries
--         view_once_purged_at (23514).
--   V-03  the service role can set view_once_purged_at on that message, both
--         directly and through issue_4114_mark_view_once_purged.
--
-- FAILS-ON-REVERT: delete the 'view_once_purge_is_server_owned' checks from
-- issue_4114_enforce_view_once_shape (or drop view_once_purged_at from the
-- trigger's UPDATE OF list) and V-01/V-02 fail.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114v_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114v_ids TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.t4114v_as(p_tag text, p_role text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := (SELECT id FROM t4114v_ids WHERE tag = p_tag);
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
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114v-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114v-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114v_ids VALUES (v_tag, v_id);
  END LOOP;
  v_ana := (SELECT id FROM t4114v_ids WHERE tag = 'ana');
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_ana) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_dm, id, now() - interval '30 days' FROM t4114v_ids;
  INSERT INTO t4114v_ids VALUES ('dm', v_dm);

  -- Server-side fixture row (no client claims): a live, never-purged view-once photo.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/once/' || gen_random_uuid() || '.jpg', true)
    RETURNING id INTO v_id;
  INSERT INTO t4114v_ids VALUES ('live_once', v_id);
END $fixture$;

-- V-01 / V-02 as ana under the authenticated role (row security on).
SELECT pg_temp.t4114v_as('ana', 'authenticated');
SET LOCAL ROLE authenticated;
DO $v01$
DECLARE
  v_id uuid := (SELECT id FROM t4114v_ids WHERE tag = 'live_once');
  v_dm uuid := (SELECT id FROM t4114v_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114v_ids WHERE tag = 'ana');
  v_refused boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = v_id) THEN
    RAISE EXCEPTION 'V-01: fixture row not visible to its sender';
  END IF;
  BEGIN
    UPDATE public.messages SET view_once_purged_at = now() WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'V-01: a client set view_once_purged_at on its own message';
  END IF;

  v_refused := false;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, view_once_purged_at)
      VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/once/' || gen_random_uuid() || '.jpg', true, now());
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'V-02: a client inserted a message already marked purged';
  END IF;
END $v01$;
RESET ROLE;

DO $v01b$
BEGIN
  IF (SELECT view_once_purged_at FROM public.messages
       WHERE id = (SELECT id FROM t4114v_ids WHERE tag = 'live_once')) IS NOT NULL THEN
    RAISE EXCEPTION 'V-01: view_once_purged_at changed after a refused client write';
  END IF;
END $v01b$;

-- V-03 the service role owns the column.
SELECT pg_temp.t4114v_as('ana', 'service_role');
DO $v03$
DECLARE
  v_id uuid := (SELECT id FROM t4114v_ids WHERE tag = 'live_once');
  v_marked integer;
BEGIN
  SELECT public.issue_4114_mark_view_once_purged(ARRAY[v_id]) INTO v_marked;
  IF v_marked <> 1 OR (SELECT view_once_purged_at FROM public.messages WHERE id = v_id) IS NULL THEN
    RAISE EXCEPTION 'V-03: the service sweep could not mark the message purged';
  END IF;
  UPDATE public.messages SET view_once_purged_at = now() - interval '1 minute' WHERE id = v_id;
  IF (SELECT view_once_purged_at FROM public.messages WHERE id = v_id) > now() - interval '30 seconds' THEN
    RAISE EXCEPTION 'V-03: the service role could not write view_once_purged_at';
  END IF;
END $v03$;

SELECT 'issue_4114_chat_media_purge_server_owned: V-01..V-03 PASS' AS result;

ROLLBACK;
