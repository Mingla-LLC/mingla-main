\set ON_ERROR_STOP on

-- Issue #4114 Wave 4 rework — canonical attachment paths and server-owned
-- send time.
--
--   C-01  an ordinary message's stored path must be exactly
--         <conversation_id>/<uuid>.<ext>: a dot segment, an empty segment, an
--         encoded character, upper-case hex or a trailing slash is refused
--         (23514); the canonical path is accepted.
--   C-02  legacy public-bucket URLs keep working: an https:// file_url is
--         accepted on insert and on update; a view-once message can never use
--         one (23514).
--   C-03  a client cannot choose a message's send time (every client insert
--         is stamped with the server clock) and cannot change any message's
--         created_at afterwards (23514).
--   C-04  the cleanup listing only hands out canonical paths: a planted
--         view-once row with a non-canonical path and a non-canonical storage
--         object are never listed.
--   C-05  issue_4114_chat_attachment_owner returns the uploader, NULL for a
--         missing or non-canonical name, and clients cannot call it.
--
-- FAILS-ON-REVERT: loosen the canonical-shape regex in
-- issue_4114_chat_attachment_conversation and C-01 fails (that regex is the
-- real guard: deleting only the "attachment_path_not_canonical" branch of
-- issue_4114_enforce_view_once_shape does NOT fail C-01, because a NULL
-- conversation is still refused as attachment_path_outside_conversation, also
-- 23514); delete the created_at
-- block and C-03 fails; delete the canonical filters from
-- issue_4114_view_once_media_due and C-04 fails.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114c_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114c_ids TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.t4114c_as(p_tag text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := (SELECT id FROM t4114c_ids WHERE tag = p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
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
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114c-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114c-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114c_ids VALUES (v_tag, v_id);
  END LOOP;
  v_ana := (SELECT id FROM t4114c_ids WHERE tag = 'ana');
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_ana) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_dm, id, now() - interval '30 days' FROM t4114c_ids;
  INSERT INTO t4114c_ids VALUES ('dm', v_dm);
END $fixture$;

-- C-01 / C-02 / C-03 as ana (a client).
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114c_as('ana');

DO $c01$
DECLARE
  v_dm uuid := (SELECT id FROM t4114c_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114c_ids WHERE tag = 'ana');
  v_obj text := gen_random_uuid()::text;
  v_paths text[] := ARRAY[
    v_dm || '/./' || v_obj || '.jpg',
    v_dm || '/../' || v_obj || '.jpg',
    v_dm || '//' || v_obj || '.jpg',
    v_dm || '/' || v_obj || '%2Ejpg',
    v_dm || '/' || upper(v_obj) || '.jpg',
    v_dm || '/' || v_obj || '.jpg/',
    v_dm || '/' || v_obj || '.jpg?x=1',
    'chat-files/' || v_dm || '/' || v_obj || '.jpg'
  ];
  v_path text;
  v_accepted text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_path IN ARRAY v_paths LOOP
    BEGIN
      INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
        VALUES (v_dm, v_ana, 'Photo', 'image', v_path);
      v_accepted := v_accepted || v_path;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  IF cardinality(v_accepted) > 0 THEN
    RAISE EXCEPTION 'C-01: non-canonical paths accepted: %', v_accepted;
  END IF;
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/' || v_obj || '.jpg');
END $c01$;

DO $c02$
DECLARE
  v_dm uuid := (SELECT id FROM t4114c_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114c_ids WHERE tag = 'ana');
  v_url text := 'https://example.supabase.co/storage/v1/object/public/messages/' || gen_random_uuid() || '/a.jpg';
  v_id uuid;
  v_refused boolean := false;
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_url) RETURNING id INTO v_id;
  UPDATE public.messages SET file_url = v_url || '?v=2' WHERE id = v_id;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
      VALUES (v_dm, v_ana, 'Photo', 'image', v_url, true);
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'C-02: a view-once message must not use a public URL';
  END IF;
END $c02$;

DO $c03$
DECLARE
  v_dm uuid := (SELECT id FROM t4114c_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114c_ids WHERE tag = 'ana');
  v_once uuid;
  v_plain uuid;
  v_created timestamptz;
  v_refused integer := 0;
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, created_at)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/once/' || gen_random_uuid() || '.jpg', true, now() + interval '10 years')
    RETURNING id, created_at INTO v_once, v_created;
  IF v_created > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'C-03: a client chose a view-once send time (%)', v_created;
  END IF;
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type)
    VALUES (v_dm, v_ana, 'hi', 'text') RETURNING id INTO v_plain;
  BEGIN
    UPDATE public.messages SET created_at = now() + interval '10 years' WHERE id = v_once;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  BEGIN
    UPDATE public.messages SET created_at = now() - interval '1 year' WHERE id = v_plain;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  IF v_refused <> 2 THEN
    RAISE EXCEPTION 'C-03: expected 2 refused created_at changes, got %', v_refused;
  END IF;
  -- An ordinary edit that leaves created_at alone still works.
  UPDATE public.messages SET content = 'hi again' WHERE id = v_plain;
END $c03$;

DO $c05_client$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    PERFORM public.issue_4114_chat_attachment_owner('x');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'C-05: a client must not call issue_4114_chat_attachment_owner';
  END IF;
END $c05_client$;
RESET ROLE;

-- C-04: rows and objects planted around the guards are never handed to the deleter.
DO $c04$
DECLARE
  v_dm uuid := (SELECT id FROM t4114c_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114c_ids WHERE tag = 'ana');
  v_bad_once text := v_dm || '/once/../' || gen_random_uuid() || '.jpg';
  v_bad_orphan text := v_dm || '/../' || gen_random_uuid() || '.jpg';
  v_good_orphan text := v_dm || '/' || gen_random_uuid() || '.jpg';
  v_listed text[];
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, created_at)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_bad_once, true, now() - interval '20 days');
  SET LOCAL session_replication_role = origin;
  INSERT INTO storage.objects(bucket_id, name, owner, created_at) VALUES
    ('message-attachments', v_bad_orphan, v_ana, now() - interval '5 days'),
    ('message-attachments', v_good_orphan, v_ana, now() - interval '5 days');
  SELECT array_agg(d.storage_path) INTO v_listed FROM public.issue_4114_view_once_media_due(1000) d;
  IF v_bad_once = ANY(COALESCE(v_listed, ARRAY[]::text[])) OR v_bad_orphan = ANY(COALESCE(v_listed, ARRAY[]::text[])) THEN
    RAISE EXCEPTION 'C-04: a non-canonical path was listed for deletion: %', v_listed;
  END IF;
  IF NOT (v_good_orphan = ANY(COALESCE(v_listed, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'C-04: the canonical orphan must still be listed (got %)', v_listed;
  END IF;

  -- C-05 owner lookup.
  IF public.issue_4114_chat_attachment_owner(v_good_orphan) IS DISTINCT FROM v_ana THEN
    RAISE EXCEPTION 'C-05: owner lookup must return the uploader';
  END IF;
  IF public.issue_4114_chat_attachment_owner(v_bad_orphan) IS NOT NULL
     OR public.issue_4114_chat_attachment_owner(v_dm || '/' || gen_random_uuid() || '.jpg') IS NOT NULL THEN
    RAISE EXCEPTION 'C-05: owner lookup must be NULL for a non-canonical or missing name';
  END IF;
END $c04$;

SELECT 'issue_4114_chat_media_canonical: C-01..C-05 PASS' AS result;

ROLLBACK;
