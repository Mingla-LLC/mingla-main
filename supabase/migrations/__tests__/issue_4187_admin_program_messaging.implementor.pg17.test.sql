\set ON_ERROR_STOP on
-- #4187: the Admin program-message rail is authorized, idempotent, durable,
-- recipient-visible through the ordinary chat RLS, and cannot be left.
BEGIN;

CREATE FUNCTION pg_temp.issue_4187_act(p_user uuid) RETURNS void LANGUAGE sql AS $function$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true),
         set_config(
           'request.jwt.claims',
           CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END,
           true
         );
$function$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id, email) VALUES
  ('41870000-0000-4000-8000-000000000001', 'issue4187-admin-one@mingla.test'),
  ('41870000-0000-4000-8000-000000000002', 'issue4187-admin-two@mingla.test'),
  ('41870000-0000-4000-8000-000000000003', 'issue4187-creator@mingla.test'),
  ('41870000-0000-4000-8000-000000000004', 'issue4187-local@mingla.test'),
  ('41870000-0000-4000-8000-000000000005', 'issue4187-outsider@mingla.test');

INSERT INTO public.profiles(id, email, display_name, username) VALUES
  ('41870000-0000-4000-8000-000000000001', 'issue4187-admin-one@mingla.test', 'Admin One', 'admin-one'),
  ('41870000-0000-4000-8000-000000000002', 'issue4187-admin-two@mingla.test', 'Admin Two', 'admin-two'),
  ('41870000-0000-4000-8000-000000000003', 'issue4187-creator@mingla.test', 'Ada Creator', 'ada-creator'),
  ('41870000-0000-4000-8000-000000000004', 'issue4187-local@mingla.test', 'Lola Local', 'lola-local'),
  ('41870000-0000-4000-8000-000000000005', 'issue4187-outsider@mingla.test', 'Outside User', 'outside-user');

INSERT INTO public.admin_users(email, status) VALUES
  ('issue4187-admin-one@mingla.test', 'active'),
  ('issue4187-admin-two@mingla.test', 'active');

INSERT INTO public.creator_accounts(id, email, display_name) VALUES
  ('41870000-0000-4000-8000-000000000003', 'issue4187-creator@mingla.test', 'Ada Creator');

INSERT INTO public.seeding_cities(
  id, google_place_id, name, country, country_code, center_lat, center_lng,
  bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status
) VALUES (
  '41870000-0000-4000-8000-000000000006', 'issue4187-lagos', 'Issue 4187 Lagos', 'Nigeria', 'NG',
  6.455, 3.384, 6.30, 3.20, 6.70, 3.60, 'launched'
);
INSERT INTO public.local_applications(user_id, city_id, why)
VALUES (
  '41870000-0000-4000-8000-000000000004',
  '41870000-0000-4000-8000-000000000006',
  'I know Lagos deeply and can show visitors thoughtful local places.'
);
SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_admin_one constant uuid := '41870000-0000-4000-8000-000000000001';
  v_admin_two constant uuid := '41870000-0000-4000-8000-000000000002';
  v_creator constant uuid := '41870000-0000-4000-8000-000000000003';
  v_local constant uuid := '41870000-0000-4000-8000-000000000004';
  v_outsider constant uuid := '41870000-0000-4000-8000-000000000005';
  v_client constant uuid := '41870000-0000-4000-8000-000000000010';
  v_media_client constant uuid := '41870000-0000-4000-8000-000000000011';
  v_media_path text;
  v_result jsonb;
  v_retry jsonb;
  v_conversation uuid;
  v_failed boolean;
BEGIN
  -- Non-Admins cannot list people, open threads, or send.
  PERFORM pg_temp.issue_4187_act(v_outsider);
  v_failed := false;
  BEGIN
    PERFORM public.admin_program_local_people();
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := SQLERRM = 'admin_only';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-Admin listed Local recipients'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.admin_program_message_send('creator', v_creator, 'No access', gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := SQLERRM = 'admin_only';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-Admin sent a program message'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.admin_program_media_prepare('creator', v_creator);
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := SQLERRM = 'admin_only';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-Admin prepared a program media upload'; END IF;

  PERFORM pg_temp.issue_4187_act(v_admin_one);

  -- Opening an unused recipient creates no ghost conversation.
  v_result := public.admin_program_conversation_thread('creator', v_creator);
  IF v_result->>'conversation_id' IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.conversations WHERE program_kind = 'creator' AND program_target_user_id = v_creator) THEN
    RAISE EXCEPTION 'opening a thread created a ghost: %', v_result;
  END IF;

  -- The Local directory includes applicants even before they are seated.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.admin_program_local_people()) person
    WHERE person->>'target_user_id' = v_local::text
      AND person->>'display_name' = 'Lola Local'
      AND person->>'city' = 'Issue 4187 Lagos'
  ) THEN
    RAISE EXCEPTION 'Local applicant missing from durable message directory';
  END IF;

  -- Media prepare creates/reuses the canonical folder but does not expose an
  -- empty thread to the recipient before a durable message exists.
  v_result := public.admin_program_media_prepare('creator', v_creator);
  v_conversation := (v_result->>'conversation_id')::uuid;
  IF v_conversation IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.conversation_participants
       WHERE conversation_id = v_conversation AND user_id = v_admin_one
     )
     OR EXISTS (
       SELECT 1 FROM public.conversation_participants
       WHERE conversation_id = v_conversation AND user_id = v_creator
     ) THEN
    RAISE EXCEPTION 'media prepare exposed an empty thread: %', v_result;
  END IF;

  -- First send reuses that canonical group and writes one message.
  v_result := public.admin_program_message_send('creator', v_creator, 'Welcome to the Creator program.', v_client);
  IF (v_result->>'conversation_id')::uuid IS DISTINCT FROM v_conversation
     OR v_result->'message'->>'content' <> 'Welcome to the Creator program.' THEN
    RAISE EXCEPTION 'first send failed: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations conversation
    WHERE conversation.id = v_conversation
      AND conversation.type = 'group'
      AND conversation.linked_entity_type = 'direct'
      AND conversation.name = 'Mingla Creator team'
      AND conversation.program_kind = 'creator'
      AND conversation.program_target_user_id = v_creator
  ) THEN
    RAISE EXCEPTION 'program conversation shape is wrong';
  END IF;
  IF (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = v_conversation) <> 2 THEN
    RAISE EXCEPTION 'first send did not add exact Admin + recipient participants';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages message
    WHERE message.id = (v_result->'message'->>'id')::uuid
      AND message.client_id = v_client
      AND message.sender_display_name_snapshot = 'Mingla Creator team'
      AND message.sender_role_snapshot = 'Mingla'
  ) THEN
    RAISE EXCEPTION 'official sender snapshot missing';
  END IF;

  -- Same client id is a true retry: same row, one audit event.
  v_retry := public.admin_program_message_send('creator', v_creator, 'Welcome to the Creator program.', v_client);
  IF v_retry->'message'->>'id' IS DISTINCT FROM v_result->'message'->>'id'
     OR (SELECT count(*) FROM public.messages WHERE conversation_id = v_conversation AND client_id = v_client) <> 1
     OR (SELECT count(*) FROM public.admin_audit_log WHERE action = 'program.message_sent' AND metadata->>'message_id' = v_result->'message'->>'id') <> 1 THEN
    RAISE EXCEPTION 'retry duplicated message or audit: first %, retry %', v_result, v_retry;
  END IF;

  -- Admin media must be the Admin-owned object in this conversation's
  -- canonical private bucket folder. The same client id remains idempotent.
  v_media_path := v_conversation::text || '/' || v_media_client::text || '.jpg';
  INSERT INTO storage.objects(bucket_id, name, owner, metadata)
  VALUES (
    'message-attachments',
    v_media_path,
    v_admin_one,
    jsonb_build_object('size', 8, 'mimetype', 'image/jpeg')
  );
  v_result := public.admin_program_message_send(
    'creator', v_creator, 'Reference photo', v_media_client,
    'image', v_media_path, 'reference.jpg', 8, 1200, 800, NULL
  );
  IF v_result->'message'->>'message_type' <> 'image'
     OR v_result->'message'->>'file_url' <> v_media_path
     OR (v_result->'message'->>'file_size')::bigint <> 8 THEN
    RAISE EXCEPTION 'Admin image message failed: %', v_result;
  END IF;
  v_retry := public.admin_program_message_send(
    'creator', v_creator, 'Reference photo', v_media_client,
    'image', v_media_path, 'reference.jpg', 8, 1200, 800, NULL
  );
  IF v_retry->'message'->>'id' IS DISTINCT FROM v_result->'message'->>'id'
     OR (SELECT count(*) FROM public.messages WHERE conversation_id = v_conversation AND client_id = v_media_client) <> 1 THEN
    RAISE EXCEPTION 'Admin image retry duplicated the message';
  END IF;

  INSERT INTO storage.objects(bucket_id, name, owner, metadata)
  VALUES (
    'message-attachments',
    v_conversation::text || '/41870000-0000-4000-8000-000000000012.jpg',
    v_outsider,
    jsonb_build_object('size', 8, 'mimetype', 'image/jpeg')
  );
  v_failed := false;
  BEGIN
    PERFORM public.admin_program_message_send(
      'creator', v_creator, '', '41870000-0000-4000-8000-000000000012',
      'image', v_conversation::text || '/41870000-0000-4000-8000-000000000012.jpg',
      'claimed.jpg', 8, NULL, NULL, NULL
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_failed := SQLERRM = 'media_upload_unavailable';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Admin claimed another uploader''s media object'; END IF;

  -- Another Admin can open the shared thread and becomes a participant for
  -- RLS-filtered Realtime and incoming-reply notifications.
  PERFORM pg_temp.issue_4187_act(v_admin_two);
  v_retry := public.admin_program_conversation_thread('creator', v_creator);
  IF jsonb_array_length(v_retry->'messages') <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.conversation_participants
       WHERE conversation_id = v_conversation AND user_id = v_admin_two
     ) THEN
    RAISE EXCEPTION 'second Admin did not join/read shared thread: %', v_retry;
  END IF;

  -- Invalid targets fail closed.
  v_failed := false;
  BEGIN
    PERFORM public.admin_program_message_send('creator', v_outsider, 'Wrong target', gen_random_uuid());
  EXCEPTION WHEN invalid_parameter_value THEN
    v_failed := SQLERRM = 'program_recipient_unavailable';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'invalid program target was accepted'; END IF;
END;
$test$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.issue_4187_act('41870000-0000-4000-8000-000000000005');
DO $containment$
DECLARE
  v_outsider constant uuid := '41870000-0000-4000-8000-000000000005';
  v_creator constant uuid := '41870000-0000-4000-8000-000000000003';
  v_conversation uuid;
  v_failed boolean := false;
BEGIN
  -- Program markers are RPC-only: an ordinary user cannot squat or impersonate
  -- the official thread by using the generic conversation INSERT policy.
  BEGIN
    INSERT INTO public.conversations(
      type, linked_entity_type, name, created_by, is_enabled,
      is_broadcast_only, program_kind, program_target_user_id
    ) VALUES (
      'group', 'direct', 'Mingla Local team', v_outsider, true,
      false, 'local', v_outsider
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'ordinary user created an official program thread'; END IF;

  SELECT id INTO v_conversation FROM public.conversations
  WHERE program_kind = 'creator' AND program_target_user_id = v_creator;
  v_failed := false;
  BEGIN
    INSERT INTO public.conversation_participants(conversation_id, user_id)
    VALUES (v_conversation, v_outsider);
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'outsider joined a managed program thread'; END IF;
END;
$containment$;

-- The recipient reads and replies through the ordinary participant policies.
SELECT pg_temp.issue_4187_act('41870000-0000-4000-8000-000000000003');
DO $recipient$
DECLARE
  v_creator constant uuid := '41870000-0000-4000-8000-000000000003';
  v_conversation uuid;
  v_failed boolean := false;
BEGIN
  SELECT id INTO v_conversation
  FROM public.conversations
  WHERE program_kind = 'creator' AND program_target_user_id = v_creator;

  IF (SELECT count(*) FROM public.messages WHERE conversation_id = v_conversation) <> 2 THEN
    RAISE EXCEPTION 'recipient cannot read the Admin text and image';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.list_connection_conversation_access() access
    WHERE access.conversation_id = v_conversation
  ) THEN
    RAISE EXCEPTION 'recipient program thread is missing from the canonical Explorer chat list';
  END IF;

  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, client_id)
  VALUES (v_conversation, v_creator, 'Thanks — I received it.', 'text', gen_random_uuid());

  INSERT INTO storage.objects(bucket_id, name, owner, metadata)
  VALUES (
    'message-attachments',
    v_conversation::text || '/41870000-0000-4000-8000-000000000020.mp4',
    v_creator,
    jsonb_build_object('size', 12, 'mimetype', 'video/mp4')
  );
  INSERT INTO public.messages(
    conversation_id, sender_id, content, message_type, client_id,
    file_url, file_name, file_size, media_width, media_height, media_duration_ms
  ) VALUES (
    v_conversation, v_creator, 'My reply video', 'video', gen_random_uuid(),
    v_conversation::text || '/41870000-0000-4000-8000-000000000020.mp4',
    'reply.mp4', 12, 1080, 1920, 2000
  );

  BEGIN
    PERFORM public.leave_group_conversation(v_conversation);
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := SQLERRM = 'managed_conversation_cannot_be_left';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'recipient left a managed program thread'; END IF;
END;
$recipient$;
RESET ROLE;

-- Admin sees the reply in the same history.
SELECT pg_temp.issue_4187_act('41870000-0000-4000-8000-000000000001');
DO $reply$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.admin_program_conversation_thread(
    'creator', '41870000-0000-4000-8000-000000000003'
  );
  IF jsonb_array_length(v_result->'messages') <> 4
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_result->'messages') message
       WHERE message->>'content' = 'Thanks — I received it.'
         AND (message->>'is_from_recipient')::boolean IS TRUE
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_result->'messages') message
       WHERE message->>'message_type' = 'video'
         AND message->>'file_name' = 'reply.mp4'
         AND message->>'file_url' LIKE '%/41870000-0000-4000-8000-000000000020.mp4'
         AND (message->>'is_from_recipient')::boolean IS TRUE
     ) THEN
    RAISE EXCEPTION 'Admin cannot see recipient reply: %', v_result;
  END IF;
END;
$reply$;

DO $grants$
BEGIN
  IF has_function_privilege('anon', 'public.admin_program_local_people()', 'execute')
     OR has_function_privilege('anon', 'public.admin_program_conversation_thread(text,uuid)', 'execute')
     OR has_function_privilege('anon', 'public.admin_program_media_prepare(text,uuid)', 'execute')
     OR has_function_privilege('anon', 'public.admin_program_message_send(text,uuid,text,uuid,text,text,text,bigint,integer,integer,integer)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.admin_program_media_prepare(text,uuid)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.admin_program_message_send(text,uuid,text,uuid,text,text,text,bigint,integer,integer,integer)', 'execute') THEN
    RAISE EXCEPTION 'program message RPC grants drifted';
  END IF;
END;
$grants$;

ROLLBACK;
