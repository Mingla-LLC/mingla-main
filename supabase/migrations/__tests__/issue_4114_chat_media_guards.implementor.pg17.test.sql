\set ON_ERROR_STOP on

-- Issue #4114 Wave 7 — thumbnails, the daily upload allowance (D17), video
-- retention (D18) and the storage early warning.
--
--   G-01  thumbnails: a participant may upload <conv>/<uuid>_thumb.jpg; the
--         same name under once/ or in a conversation they are not in is
--         refused. A message's thumb_path must be the sibling of its own
--         file_url in its own conversation, on an ordinary photo or video:
--         another conversation, another file's sibling, a view-once message
--         and a file_url that is a thumbnail are all refused (23514). A client
--         can never set media_expired_at.
--   G-02  D17: an upload that takes a person past 200 MB in 24 hours is refused
--         with chat_media_daily_limit; exactly 200 MB is accepted; once at the
--         limit, even the Storage API's metadata-less permission test is
--         refused; objects older than 24 hours and other people's do not
--         count; a retry of an object already stored is not refused; the
--         quota RPC reports the person's use.
--   G-03  D18: the sweep lists only ordinary videos older than 90 days, hands
--         out the full file (never the thumbnail), skips view once, photos,
--         younger videos and already-expired ones; marking is idempotent; a
--         thumbnail a message points at is never an orphan, an unreferenced
--         one is.
--   G-04  early warning: 6 GB names the 5 GB threshold once; after marking it
--         is not named again; 12 GB names only 10 GB. Clients cannot call it.
--
-- FAILS-ON-REVERT: drop the `|..._thumb\.jpg` alternative from
-- issue_4114_chat_attachment_conversation and G-01's upload fails; delete the
-- thumbnail block of issue_4114_enforce_view_once_shape and G-01's refusals
-- fail; delete the daily-limit trigger and G-02 fails; delete the
-- 'video_retention' query (or its 90-day filter) and G-03 fails; delete the
-- NOT EXISTS on issue_4114_chat_media_storage_alerts and G-04 fails.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114g_ids (tag text PRIMARY KEY, id uuid NOT NULL);
CREATE TEMP TABLE t4114g_names (tag text PRIMARY KEY, name text NOT NULL);
GRANT SELECT, INSERT ON t4114g_ids, t4114g_names TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.t4114g_as(p_tag text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := (SELECT id FROM t4114g_ids WHERE tag = p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
END $fn$;

CREATE OR REPLACE FUNCTION pg_temp.t4114g_service() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
END $fn$;

-- Start from an empty bucket so sizes and the early warning are exact.
DO $empty$
BEGIN
  ALTER TABLE storage.objects DISABLE TRIGGER USER;
  DELETE FROM storage.objects WHERE bucket_id = 'message-attachments';
  ALTER TABLE storage.objects ENABLE TRIGGER USER;
  DELETE FROM public.issue_4114_chat_media_storage_alerts;
END $empty$;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_dm uuid;
  v_other uuid;
  v_ana uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['ana', 'ben', 'cy'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114g-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114g-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114g_ids VALUES (v_tag, v_id);
  END LOOP;
  v_ana := (SELECT id FROM t4114g_ids WHERE tag = 'ana');
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_ana) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_dm, id, now() - interval '200 days' FROM t4114g_ids WHERE tag IN ('ana', 'ben');
  -- A chat ana is not in.
  INSERT INTO public.conversations(type, created_by)
    VALUES ('direct', (SELECT id FROM t4114g_ids WHERE tag = 'cy')) RETURNING id INTO v_other;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_other, id, now() - interval '200 days' FROM t4114g_ids WHERE tag IN ('ben', 'cy');
  INSERT INTO t4114g_ids VALUES ('dm', v_dm), ('other', v_other);

  v_id := gen_random_uuid();
  INSERT INTO t4114g_names VALUES
    ('photo',       v_dm || '/' || v_id || '.jpg'),
    ('photo_thumb', v_dm || '/' || v_id || '_thumb.jpg'),
    ('once_thumb',  v_dm || '/once/' || gen_random_uuid() || '_thumb.jpg'),
    ('other_thumb', v_other || '/' || gen_random_uuid() || '_thumb.jpg');
END $fixture$;

-- G-01 thumbnails, as ana (a client).
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114g_as('ana');
DO $g01_storage$
DECLARE
  v_ana uuid := (SELECT id FROM t4114g_ids WHERE tag = 'ana');
  v_refused integer := 0;
BEGIN
  -- The sibling thumbnail in her own chat uploads (the RLS insert policy).
  INSERT INTO storage.objects(bucket_id, name, owner)
    VALUES ('message-attachments', (SELECT name FROM t4114g_names WHERE tag = 'photo_thumb'), v_ana);
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, owner)
      VALUES ('message-attachments', (SELECT name FROM t4114g_names WHERE tag = 'once_thumb'), v_ana);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, owner)
      VALUES ('message-attachments', (SELECT name FROM t4114g_names WHERE tag = 'other_thumb'), v_ana);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  IF v_refused <> 2 THEN
    RAISE EXCEPTION 'G-01: a thumbnail under once/ or in another chat must be refused (refused %)', v_refused;
  END IF;
END $g01_storage$;

DO $g01_messages$
DECLARE
  v_dm uuid := (SELECT id FROM t4114g_ids WHERE tag = 'dm');
  v_other uuid := (SELECT id FROM t4114g_ids WHERE tag = 'other');
  v_ana uuid := (SELECT id FROM t4114g_ids WHERE tag = 'ana');
  v_photo text := (SELECT name FROM t4114g_names WHERE tag = 'photo');
  v_thumb text := (SELECT name FROM t4114g_names WHERE tag = 'photo_thumb');
  v_once uuid := gen_random_uuid();
  v_obj uuid := gen_random_uuid();
  v_msg uuid;
  v_refused text[] := ARRAY[]::text[];
  v_accepted text[] := ARRAY[]::text[];
BEGIN
  -- The canonical shape is accepted, with the media facts.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path,
                              media_width, media_height, media_album_id)
    VALUES (v_dm, v_ana, '', 'image', v_photo, v_thumb, 1600, 1200, gen_random_uuid())
    RETURNING id INTO v_msg;
  INSERT INTO t4114g_ids VALUES ('msg_photo', v_msg);

  -- A thumbnail in another conversation's folder.
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path)
      VALUES (v_dm, v_ana, '', 'image', v_dm || '/' || v_obj || '.jpg', v_other || '/' || v_obj || '_thumb.jpg');
    v_accepted := v_accepted || 'other_conversation'::text;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused || 'other_conversation'::text;
  END;
  -- Another file's thumbnail (not the sibling).
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path)
      VALUES (v_dm, v_ana, '', 'image', v_dm || '/' || v_obj || '.jpg', v_thumb);
    v_accepted := v_accepted || 'not_sibling'::text;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused || 'not_sibling'::text;
  END;
  -- View once never has a thumbnail.
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path, view_once)
      VALUES (v_dm, v_ana, '', 'video', v_dm || '/once/' || v_once || '.mp4', v_dm || '/' || v_once || '_thumb.jpg', true);
    v_accepted := v_accepted || 'view_once'::text;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused || 'view_once'::text;
  END;
  -- A thumbnail under once/ as thumb_path.
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path)
      VALUES (v_dm, v_ana, '', 'image', v_dm || '/' || v_obj || '.jpg', v_dm || '/once/' || v_obj || '_thumb.jpg');
    v_accepted := v_accepted || 'once_thumb'::text;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused || 'once_thumb'::text;
  END;
  -- A file_url that is a thumbnail name.
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
      VALUES (v_dm, v_ana, '', 'image', v_dm || '/' || gen_random_uuid() || '_thumb.jpg');
    v_accepted := v_accepted || 'file_is_thumb'::text;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused || 'file_is_thumb'::text;
  END;
  -- A file message cannot carry a thumbnail.
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path)
      VALUES (v_dm, v_ana, '', 'file', v_dm || '/' || v_obj || '.pdf', v_dm || '/' || v_obj || '_thumb.jpg');
    v_accepted := v_accepted || 'file_type'::text;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused || 'file_type'::text;
  END;
  -- Repointing an existing message's thumbnail elsewhere.
  BEGIN
    UPDATE public.messages SET thumb_path = v_dm || '/' || v_obj || '_thumb.jpg' WHERE id = v_msg;
    v_accepted := v_accepted || 'repoint'::text;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused || 'repoint'::text;
  END;
  -- A client cannot stamp or clear media_expired_at.
  BEGIN
    UPDATE public.messages SET media_expired_at = now() WHERE id = v_msg;
    v_accepted := v_accepted || 'expire_update'::text;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused || 'expire_update'::text;
  END;
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, media_expired_at)
      VALUES (v_dm, v_ana, '', 'video', v_dm || '/' || gen_random_uuid() || '.mp4', now());
    v_accepted := v_accepted || 'expire_insert'::text;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused || 'expire_insert'::text;
  END;

  IF cardinality(v_accepted) > 0 THEN
    RAISE EXCEPTION 'G-01: refused shapes were accepted: %', v_accepted;
  END IF;
  IF cardinality(v_refused) <> 9 THEN
    RAISE EXCEPTION 'G-01: expected 9 refusals, got %', v_refused;
  END IF;
END $g01_messages$;
RESET ROLE;

-- ben (the other participant) reads ana's thumbnail; cy (not in the chat) does not.
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114g_as('ben');
DO $g01_read$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
                 AND name = (SELECT name FROM t4114g_names WHERE tag = 'photo_thumb')) THEN
    RAISE EXCEPTION 'G-01: the other participant must read the thumbnail';
  END IF;
END $g01_read$;
SELECT pg_temp.t4114g_as('cy');
DO $g01_stranger$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
             AND name = (SELECT name FROM t4114g_names WHERE tag = 'photo_thumb')) THEN
    RAISE EXCEPTION 'G-01: someone outside the chat must not read the thumbnail';
  END IF;
END $g01_stranger$;
RESET ROLE;

-- G-02 D17 daily allowance. Objects are written the way the Storage API's
-- final insert writes them (service, owner = uploader, metadata.size).
SELECT pg_temp.t4114g_service();
DO $g02$
DECLARE
  v_dm uuid := (SELECT id FROM t4114g_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114g_ids WHERE tag = 'ana');
  v_ben uuid := (SELECT id FROM t4114g_ids WHERE tag = 'ben');
  v_mb bigint := 1048576;
  v_name text;
  v_refused boolean;
  v_used bigint;
  v_limit bigint;
BEGIN
  -- 300 MB uploaded 25 hours ago does not count (planted with the trigger
  -- off: as one upload it would itself be over the allowance).
  ALTER TABLE storage.objects DISABLE TRIGGER USER;
  INSERT INTO storage.objects(bucket_id, name, owner, metadata, created_at)
    VALUES ('message-attachments', v_dm || '/' || gen_random_uuid() || '.mp4', v_ana,
            jsonb_build_object('size', 300 * v_mb), now() - interval '25 hours');
  ALTER TABLE storage.objects ENABLE TRIGGER USER;
  -- 190 MB in the last day (ana's thumbnail from G-01 has no size).
  FOR i IN 1..19 LOOP
    INSERT INTO storage.objects(bucket_id, name, owner, metadata)
      VALUES ('message-attachments', v_dm || '/' || gen_random_uuid() || '.mp4', v_ana,
              jsonb_build_object('size', 10 * v_mb));
  END LOOP;

  -- 20 MB more would be 210 MB: refused, recognisably.
  v_refused := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, owner, metadata)
      VALUES ('message-attachments', v_dm || '/' || gen_random_uuid() || '.mp4', v_ana,
              jsonb_build_object('size', 20 * v_mb));
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'chat_media_daily_limit' THEN RAISE; END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'G-02: an upload past 200 MB must be refused'; END IF;

  -- Exactly 200 MB is within the allowance.
  v_name := v_dm || '/' || gen_random_uuid() || '.mp4';
  INSERT INTO storage.objects(bucket_id, name, owner, metadata)
    VALUES ('message-attachments', v_name, v_ana, jsonb_build_object('size', 10 * v_mb));

  -- At the limit, even the metadata-less permission test is refused (before any bytes move).
  v_refused := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, owner)
      VALUES ('message-attachments', v_dm || '/' || gen_random_uuid() || '_thumb.jpg', v_ana);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'chat_media_daily_limit' THEN RAISE; END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'G-02: at the limit, a new upload must be refused'; END IF;

  -- A retry of an object already stored reaches the unique name check (a
  -- duplicate, which the app counts as done), not the allowance.
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, owner, metadata)
      VALUES ('message-attachments', v_name, v_ana, jsonb_build_object('size', 10 * v_mb));
    RAISE EXCEPTION 'G-02: a duplicate name must not be stored twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Someone else is unaffected.
  INSERT INTO storage.objects(bucket_id, name, owner, metadata)
    VALUES ('message-attachments', v_dm || '/' || gen_random_uuid() || '.mp4', v_ben,
            jsonb_build_object('size', 25 * v_mb));

  -- Other buckets are never counted or refused.
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'messages') THEN
    INSERT INTO storage.objects(bucket_id, name, owner, metadata)
      VALUES ('messages', 't4114g/' || gen_random_uuid() || '.mp4', v_ana, jsonb_build_object('size', 500 * v_mb));
  END IF;

  IF public.issue_4114_chat_media_bytes_last_24h(v_ana) <> 200 * v_mb THEN
    RAISE EXCEPTION 'G-02: ana should have used exactly 200 MB, got %', public.issue_4114_chat_media_bytes_last_24h(v_ana);
  END IF;
END $g02$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114g_as('ana');
DO $g02_quota$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.issue_4114_chat_media_quota();
  IF v_row.used_bytes <> 200 * 1048576 OR v_row.limit_bytes <> 200 * 1048576 THEN
    RAISE EXCEPTION 'G-02: quota should read 200 MB of 200 MB, got % of %', v_row.used_bytes, v_row.limit_bytes;
  END IF;
  BEGIN
    PERFORM public.issue_4114_chat_media_bytes_last_24h((SELECT id FROM t4114g_ids WHERE tag = 'ben'));
    RAISE EXCEPTION 'G-02: a client must not read another person''s usage';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $g02_quota$;
RESET ROLE;

-- G-03 D18 retention (rows written by the service, so send times can be set).
SELECT pg_temp.t4114g_service();
DO $g03$
DECLARE
  v_dm uuid := (SELECT id FROM t4114g_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114g_ids WHERE tag = 'ana');
  v_old uuid := gen_random_uuid();
  v_young uuid := gen_random_uuid();
  v_once uuid := gen_random_uuid();
  v_photo uuid := gen_random_uuid();
  v_done uuid := gen_random_uuid();
  v_stray uuid := gen_random_uuid();
  v_old_msg uuid;
  v_photo_msg uuid;
  v_rows text[];
  v_marked integer;
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path, media_duration_ms, created_at)
    VALUES (v_dm, v_ana, '', 'video', v_dm || '/' || v_old || '.mp4', v_dm || '/' || v_old || '_thumb.jpg', 24000, now() - interval '91 days')
    RETURNING id INTO v_old_msg;
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path, created_at)
    VALUES (v_dm, v_ana, '', 'video', v_dm || '/' || v_young || '.mp4', v_dm || '/' || v_young || '_thumb.jpg', now() - interval '89 days');
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, view_once_purged_at, created_at)
    VALUES (v_dm, v_ana, '', 'video', v_dm || '/once/' || v_once || '.mp4', true, now(), now() - interval '120 days');
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path, created_at)
    VALUES (v_dm, v_ana, '', 'image', v_dm || '/' || v_photo || '.jpg', v_dm || '/' || v_photo || '_thumb.jpg', now() - interval '200 days')
    RETURNING id INTO v_photo_msg;
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, media_expired_at, created_at)
    VALUES (v_dm, v_ana, '', 'video', v_dm || '/' || v_done || '.mp4', now() - interval '1 day', now() - interval '150 days');

  -- Objects: the old video's thumbnail (referenced) and a stray thumbnail
  -- nothing points at, both older than two days (service-owned: no allowance).
  INSERT INTO storage.objects(bucket_id, name, owner, created_at) VALUES
    ('message-attachments', v_dm || '/' || v_old || '_thumb.jpg', NULL, now() - interval '91 days'),
    ('message-attachments', v_dm || '/' || v_stray || '_thumb.jpg', NULL, now() - interval '3 days');

  SELECT array_agg(d.reason || ':' || d.storage_path ORDER BY d.reason, d.storage_path) INTO v_rows
    FROM public.issue_4114_view_once_media_due(1000) d
    WHERE d.reason IN ('video_retention', 'orphan')
      AND split_part(d.storage_path, '/', 1) = v_dm::text;

  IF v_rows IS DISTINCT FROM ARRAY[
       'orphan:' || v_dm || '/' || v_stray || '_thumb.jpg',
       'video_retention:' || v_dm || '/' || v_old || '.mp4'
     ] THEN
    RAISE EXCEPTION 'G-03: expected only the old video''s full file and the stray thumbnail, got %', v_rows;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.issue_4114_view_once_media_due(1000) d
                 WHERE d.reason = 'video_retention' AND d.message_id = v_old_msg) THEN
    RAISE EXCEPTION 'G-03: the retention row must carry its message id';
  END IF;

  -- Marking: only the video, once.
  v_marked := public.issue_4114_mark_media_expired(ARRAY[v_old_msg, v_photo_msg]);
  IF v_marked <> 1 THEN RAISE EXCEPTION 'G-03: expected 1 video marked, got %', v_marked; END IF;
  v_marked := public.issue_4114_mark_media_expired(ARRAY[v_old_msg]);
  IF v_marked <> 0 THEN RAISE EXCEPTION 'G-03: marking twice must be a no-op, got %', v_marked; END IF;
  IF EXISTS (SELECT 1 FROM public.issue_4114_view_once_media_due(1000) d WHERE d.message_id = v_old_msg) THEN
    RAISE EXCEPTION 'G-03: an expired video must not be listed again';
  END IF;
  IF (SELECT thumb_path FROM public.messages WHERE id = v_old_msg) IS DISTINCT FROM v_dm || '/' || v_old || '_thumb.jpg' THEN
    RAISE EXCEPTION 'G-03: the thumbnail must stay on the message';
  END IF;
END $g03$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114g_as('ana');
DO $g03_client$
BEGIN
  BEGIN
    PERFORM public.issue_4114_mark_media_expired(ARRAY[gen_random_uuid()]);
    RAISE EXCEPTION 'G-03: a client must not mark media expired';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $g03_client$;
RESET ROLE;

-- G-04 early warning.
SELECT pg_temp.t4114g_service();
DO $g04$
DECLARE
  v_dm uuid := (SELECT id FROM t4114g_ids WHERE tag = 'dm');
  v_gb bigint := 1073741824;
  v_row record;
BEGIN
  -- So far the bucket holds well under 5 GB.
  SELECT * INTO v_row FROM public.issue_4114_chat_media_storage_due();
  IF cardinality(v_row.due_thresholds_gb) <> 0 THEN
    RAISE EXCEPTION 'G-04: nothing is due under 5 GB, got %', v_row.due_thresholds_gb;
  END IF;

  INSERT INTO storage.objects(bucket_id, name, owner, metadata)
    VALUES ('message-attachments', v_dm || '/' || gen_random_uuid() || '.mp4', NULL, jsonb_build_object('size', 6 * v_gb));
  SELECT * INTO v_row FROM public.issue_4114_chat_media_storage_due();
  IF v_row.due_thresholds_gb IS DISTINCT FROM ARRAY[5] THEN
    RAISE EXCEPTION 'G-04: 6 GB must name 5 GB, got %', v_row.due_thresholds_gb;
  END IF;
  IF public.issue_4114_chat_media_storage_mark_alerted(v_row.due_thresholds_gb, v_row.total_bytes) <> 1 THEN
    RAISE EXCEPTION 'G-04: marking 5 GB must record one alert';
  END IF;
  SELECT * INTO v_row FROM public.issue_4114_chat_media_storage_due();
  IF cardinality(v_row.due_thresholds_gb) <> 0 THEN
    RAISE EXCEPTION 'G-04: 5 GB must alert once, got % again', v_row.due_thresholds_gb;
  END IF;
  IF public.issue_4114_chat_media_storage_mark_alerted(ARRAY[5], v_row.total_bytes) <> 0 THEN
    RAISE EXCEPTION 'G-04: marking 5 GB twice must be a no-op';
  END IF;

  INSERT INTO storage.objects(bucket_id, name, owner, metadata)
    VALUES ('message-attachments', v_dm || '/' || gen_random_uuid() || '.mp4', NULL, jsonb_build_object('size', 6 * v_gb));
  SELECT * INTO v_row FROM public.issue_4114_chat_media_storage_due();
  IF v_row.due_thresholds_gb IS DISTINCT FROM ARRAY[10] THEN
    RAISE EXCEPTION 'G-04: 12 GB must name only 10 GB, got %', v_row.due_thresholds_gb;
  END IF;
END $g04$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114g_as('ana');
DO $g04_client$
BEGIN
  BEGIN
    PERFORM public.issue_4114_chat_media_storage_due();
    RAISE EXCEPTION 'G-04: a client must not read the bucket total';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4114_chat_media_storage_mark_alerted(ARRAY[20], 0);
    RAISE EXCEPTION 'G-04: a client must not mark an alert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $g04_client$;
RESET ROLE;

SELECT 'issue_4114_chat_media_guards: G-01..G-04 PASS' AS result;

ROLLBACK;
