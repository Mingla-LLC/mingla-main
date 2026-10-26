\set ON_ERROR_STOP on

-- Issue #4114 Wave 4 — chat media on the private bucket, view once, cleanup.
--
--   I-01  schema: messages.view_once (NOT NULL DEFAULT false), view_once_purged_at,
--         message_media_views with RLS on, and message-attachments exists (and is
--         private wherever storage.buckets has a `public` column).
--   I-02  a view-once message must be a photo or video stored under
--         <conversation>/once/; anything else is refused (23514).
--   I-03  storage reads: participants read normal attachments; a non-participant
--         reads nothing; a RECIPIENT cannot read a view-once object (so cannot
--         sign or download it); only its sender can.
--   I-04  storage writes: a participant may upload into its own conversation's
--         folder; a non-participant and a malformed name are refused; only the
--         sender of the referencing message may delete.
--   I-05  message_media_views: a recipient reads only their own rows, the sender
--         reads every row for their message, and no client can insert.
--   I-06  cleanup lists exactly: view once opened by every recipient ('opened'),
--         older than 14 days ('expired'), unsent ('unsent'), and attachments no
--         message points at older than 2 days ('orphan'); it skips a group item
--         only one of two recipients opened, a fresh one, and a purged one.
--         Clients cannot call it.
--   I-07  marking purged takes the message out of the next sweep.
--
-- FAILS-ON-REVERT (replay the chain without 20271230034114): the fixture fails
-- (no view_once column). Deleting the view-once exclusions from
-- issue_4114_can_read_chat_attachment (the once/ branch and the belt-and-braces
-- check; either one alone still protects) fails I-03: the recipient reads it.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114m_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114m_ids TO authenticated;
CREATE TEMP TABLE t4114m_names (tag text PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON t4114m_names TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.t4114m_as(p_tag text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := (SELECT id FROM t4114m_ids WHERE tag = p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
END $fn$;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_conv uuid;
  v_group uuid;
  v_sender uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['sender', 'friend', 'third', 'stranger'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114m-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114m-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114m_ids VALUES (v_tag, v_id);
  END LOOP;
  v_sender := (SELECT id FROM t4114m_ids WHERE tag = 'sender');

  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_sender) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_conv, id, now() - interval '30 days' FROM t4114m_ids WHERE tag IN ('sender', 'friend');
  INSERT INTO t4114m_ids VALUES ('dm', v_conv);

  INSERT INTO public.conversations(type, created_by, name) VALUES ('group', v_sender, 'T4114 media group') RETURNING id INTO v_group;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_group, id, now() - interval '30 days' FROM t4114m_ids WHERE tag IN ('sender', 'friend', 'third');
  INSERT INTO t4114m_ids VALUES ('group', v_group);

  INSERT INTO t4114m_names VALUES
    ('normal',      v_conv || '/' || gen_random_uuid() || '.jpg'),
    ('once',        v_conv || '/once/' || gen_random_uuid() || '.jpg'),
    ('group_once',  v_group || '/once/' || gen_random_uuid() || '.mp4'),
    ('old_once',    v_conv || '/once/' || gen_random_uuid() || '.jpg'),
    ('unsent_once', v_conv || '/once/' || gen_random_uuid() || '.jpg'),
    ('fresh_once',  v_conv || '/once/' || gen_random_uuid() || '.jpg'),
    ('purged_once', v_conv || '/once/' || gen_random_uuid() || '.jpg'),
    ('orphan_old',  v_conv || '/' || gen_random_uuid() || '.jpg'),
    ('orphan_new',  v_conv || '/' || gen_random_uuid() || '.jpg');

  -- Messages (superuser fixture; the triggers still run).
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
    VALUES (v_conv, v_sender, 'Photo', 'image', (SELECT name FROM t4114m_names WHERE tag = 'normal'));
  INSERT INTO public.messages(id, conversation_id, sender_id, content, message_type, file_url, view_once)
    VALUES
      ((SELECT gen_random_uuid()), v_conv, v_sender, 'Photo', 'image', (SELECT name FROM t4114m_names WHERE tag = 'once'), true);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
    VALUES (v_group, v_sender, 'Video', 'video', (SELECT name FROM t4114m_names WHERE tag = 'group_once'), true);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, created_at)
    VALUES (v_conv, v_sender, 'Photo', 'image', (SELECT name FROM t4114m_names WHERE tag = 'old_once'), true, now() - interval '15 days');
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, deleted_at)
    VALUES (v_conv, v_sender, 'Photo', 'image', (SELECT name FROM t4114m_names WHERE tag = 'unsent_once'), true, now());
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
    VALUES (v_conv, v_sender, 'Photo', 'image', (SELECT name FROM t4114m_names WHERE tag = 'fresh_once'), true);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, view_once_purged_at)
    VALUES (v_conv, v_sender, 'Photo', 'image', (SELECT name FROM t4114m_names WHERE tag = 'purged_once'), true, now());

  INSERT INTO t4114m_ids SELECT 'msg_' || n.tag, m.id FROM public.messages m JOIN t4114m_names n ON n.name = m.file_url;

  -- Storage objects for the reads and the orphan sweep.
  INSERT INTO storage.objects(bucket_id, name, created_at)
    SELECT 'message-attachments', name,
      CASE WHEN tag = 'orphan_old' THEN now() - interval '3 days' ELSE now() END
    FROM t4114m_names;

  -- Views: the friend opened the 1:1 'once' item; in the group only the friend
  -- (not the third member) opened 'group_once'.
  INSERT INTO public.message_media_views(message_id, user_id)
    VALUES ((SELECT id FROM t4114m_ids WHERE tag = 'msg_once'), (SELECT id FROM t4114m_ids WHERE tag = 'friend')),
           ((SELECT id FROM t4114m_ids WHERE tag = 'msg_group_once'), (SELECT id FROM t4114m_ids WHERE tag = 'friend'));
END $fixture$;

-- I-01 schema.
DO $i01$
DECLARE
  v_type text; v_nullable text; v_default text; v_public boolean;
BEGIN
  SELECT data_type, is_nullable, column_default INTO v_type, v_nullable, v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'view_once';
  IF v_type IS DISTINCT FROM 'boolean' OR v_nullable IS DISTINCT FROM 'NO' OR v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'I-01: messages.view_once must be boolean NOT NULL DEFAULT false (got %, %, %)', v_type, v_nullable, v_default;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'view_once_purged_at') THEN
    RAISE EXCEPTION 'I-01: messages.view_once_purged_at missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.message_media_views'::regclass) THEN
    RAISE EXCEPTION 'I-01: message_media_views must have RLS on';
  END IF;
  -- The bucket must exist. Its `public` flag is checked only where the column
  -- exists: the bare supabase/postgres image CI replays on has storage.buckets
  -- without it (the Storage API adds it), so reading it directly fails to
  -- compile there. Same shape as issue_3720_brand_group_files_guides.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'message-attachments') THEN
    RAISE EXCEPTION 'I-01: message-attachments bucket missing';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public') THEN
    EXECUTE $sql$SELECT public FROM storage.buckets WHERE id = 'message-attachments'$sql$ INTO v_public;
    IF v_public IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'I-01: message-attachments must be private (got %)', v_public;
    END IF;
  END IF;
END $i01$;

-- I-02 view-once shape.
DO $i02$
DECLARE
  v_conv uuid := (SELECT id FROM t4114m_ids WHERE tag = 'dm');
  v_sender uuid := (SELECT id FROM t4114m_ids WHERE tag = 'sender');
  v_refused integer := 0;
BEGIN
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, view_once)
      VALUES (v_conv, v_sender, 'hi', 'text', true);
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
      VALUES (v_conv, v_sender, 'Photo', 'image', v_conv || '/' || gen_random_uuid() || '.jpg', true);
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
      VALUES (v_conv, v_sender, 'Photo', 'image', gen_random_uuid() || '/once/' || gen_random_uuid() || '.jpg', true);
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  IF v_refused <> 3 THEN
    RAISE EXCEPTION 'I-02: expected 3 refused view-once shapes, got %', v_refused;
  END IF;
END $i02$;

-- I-03 storage reads.
SET LOCAL ROLE authenticated;

SELECT pg_temp.t4114m_as('friend');
DO $i03_friend$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
                 AND name = (SELECT name FROM t4114m_names WHERE tag = 'normal')) THEN
    RAISE EXCEPTION 'I-03: a participant must read a normal attachment';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
             AND name IN (SELECT name FROM t4114m_names WHERE tag IN ('once', 'fresh_once', 'group_once'))) THEN
    RAISE EXCEPTION 'I-03: a recipient must NOT read a view-once object';
  END IF;
END $i03_friend$;

SELECT pg_temp.t4114m_as('sender');
DO $i03_sender$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
                 AND name = (SELECT name FROM t4114m_names WHERE tag = 'once')) THEN
    RAISE EXCEPTION 'I-03: the sender must read their own view-once object';
  END IF;
END $i03_sender$;

SELECT pg_temp.t4114m_as('stranger');
DO $i03_stranger$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments') THEN
    RAISE EXCEPTION 'I-03: a non-participant must read nothing in message-attachments';
  END IF;
END $i03_stranger$;

-- I-04 storage writes (policy functions; storage's own API checks these policies).
RESET ROLE;
DO $i04$
DECLARE
  v_conv uuid := (SELECT id FROM t4114m_ids WHERE tag = 'dm');
  v_friend uuid := (SELECT id FROM t4114m_ids WHERE tag = 'friend');
  v_sender uuid := (SELECT id FROM t4114m_ids WHERE tag = 'sender');
  v_stranger uuid := (SELECT id FROM t4114m_ids WHERE tag = 'stranger');
  v_new text := v_conv || '/' || gen_random_uuid() || '.mov';
BEGIN
  IF NOT public.issue_4114_can_write_chat_attachment(v_new, v_friend) THEN
    RAISE EXCEPTION 'I-04: a participant must upload into its conversation folder';
  END IF;
  IF public.issue_4114_can_write_chat_attachment(v_new, v_stranger) THEN
    RAISE EXCEPTION 'I-04: a non-participant must not upload';
  END IF;
  IF public.issue_4114_can_write_chat_attachment(v_conv || '/../x.jpg', v_friend)
     OR public.issue_4114_can_write_chat_attachment('chat-files/' || v_conv || '/x.jpg', v_friend)
     OR public.issue_4114_can_write_chat_attachment(v_conv || '/' || gen_random_uuid() || '.JPG', v_friend) THEN
    RAISE EXCEPTION 'I-04: malformed names must be refused';
  END IF;
  IF NOT public.issue_4114_can_delete_chat_attachment((SELECT name FROM t4114m_names WHERE tag = 'normal'), v_sender) THEN
    RAISE EXCEPTION 'I-04: the sender may delete their attachment';
  END IF;
  IF public.issue_4114_can_delete_chat_attachment((SELECT name FROM t4114m_names WHERE tag = 'normal'), v_friend) THEN
    RAISE EXCEPTION 'I-04: a recipient must not delete the sender''s attachment';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'message_attachments_insert' AND cmd = 'INSERT') THEN
    RAISE EXCEPTION 'I-04: message_attachments_insert policy missing';
  END IF;
END $i04$;

-- I-05 message_media_views RLS.
SET LOCAL ROLE authenticated;

SELECT pg_temp.t4114m_as('third');
DO $i05_third$
BEGIN
  IF EXISTS (SELECT 1 FROM public.message_media_views) THEN
    RAISE EXCEPTION 'I-05: a member must not read other people''s view rows';
  END IF;
END $i05_third$;

SELECT pg_temp.t4114m_as('friend');
DO $i05_friend$
DECLARE v_count integer; v_refused boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.message_media_views;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'I-05: the recipient reads exactly their 2 own rows (got %)', v_count;
  END IF;
  BEGIN
    INSERT INTO public.message_media_views(message_id, user_id)
      VALUES ((SELECT id FROM t4114m_ids WHERE tag = 'msg_fresh_once'), (SELECT id FROM t4114m_ids WHERE tag = 'friend'));
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'I-05: a client must not be able to record a view';
  END IF;
END $i05_friend$;

SELECT pg_temp.t4114m_as('sender');
DO $i05_sender$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.message_media_views
   WHERE message_id = (SELECT id FROM t4114m_ids WHERE tag = 'msg_group_once');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'I-05: the sender sees the views on their group message (got %)', v_count;
  END IF;
END $i05_sender$;

DO $i05_no_sweep$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM public.issue_4114_view_once_media_due(10);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'I-06: a client must not call the cleanup listing';
  END IF;
END $i05_no_sweep$;

RESET ROLE;

-- I-06 cleanup selects the right objects.
DO $i06$
DECLARE
  v_due text[];
  v_expected text[];
BEGIN
  SELECT array_agg(n.tag || ':' || d.reason ORDER BY n.tag)
    INTO v_due
    FROM public.issue_4114_view_once_media_due(1000) d
    JOIN t4114m_names n ON n.name = d.storage_path;
  v_expected := ARRAY['old_once:expired', 'once:opened', 'orphan_old:orphan', 'unsent_once:unsent'];
  IF v_due IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'I-06: cleanup listed % (expected %)', v_due, v_expected;
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_4114_view_once_media_due(1000) d
             WHERE d.reason <> 'orphan' AND d.message_id IS NULL) THEN
    RAISE EXCEPTION 'I-06: every view-once row carries its message id';
  END IF;
END $i06$;

-- I-07 marking purged removes it from the next sweep.
DO $i07$
DECLARE v_marked integer;
BEGIN
  SELECT public.issue_4114_mark_view_once_purged(ARRAY[(SELECT id FROM t4114m_ids WHERE tag = 'msg_once')]) INTO v_marked;
  IF v_marked <> 1 THEN
    RAISE EXCEPTION 'I-07: expected 1 message marked, got %', v_marked;
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_4114_view_once_media_due(1000) d
             WHERE d.storage_path = (SELECT name FROM t4114m_names WHERE tag = 'once')) THEN
    RAISE EXCEPTION 'I-07: a purged item must not be listed again';
  END IF;
END $i07$;

SELECT 'issue_4114_chat_media: I-01..I-07 PASS' AS result;

ROLLBACK;
