-- #3988 — executable gallery paging and output contract proof.
-- FAILS-ON-REVERT: the list RPC, metadata columns, totals and stable keyset cursor do not exist before C-M1.
-- MINGLA-INVARIANT: I-3988-MEDIA-LIST-MEMBERS-ONLY | issue #3988 | Brand-group files are listed only to callers issue_3720_brand_group_can_access admits; listings never expose Drive ids, storage paths or uploader ids; paging is keyset (created_at, id) so no row is skipped or repeated.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('39880000-0000-4000-bc00-000000000001','media-owner@test.local','{"full_name":"Media Owner"}'),
  ('39880000-0000-4000-bc00-000000000002','media-member@test.local','{"full_name":"Media Member"}');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('39880000-0000-4000-bc00-000000000001','media-owner@test.local','Media Owner','media_owner','business'),
  ('39880000-0000-4000-bc00-000000000002','media-member@test.local','Media Member','media_member','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name)
VALUES ('39880000-0000-4000-bc00-000000000001','media-owner@test.local','Media Owner','Media Gallery Host');
INSERT INTO public.brands(id,account_id,name,slug)
VALUES ('39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000001','Media Gallery Brand','issue-3988-media-gallery');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES ('39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','marketing_manager',now());

DO $proof$
DECLARE
  v_conversation uuid;
  v_result jsonb;
  v_page jsonb;
  v_cursor jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_expected_keys text[] := ARRAY[
    'createdAt','durationMs','fileId','height','kind','messageId','mime','name',
    'senderDisplayName','senderRole','sizeBytes','thumbState','width'
  ];
  v_actual_keys text[];
  v_index integer;
  v_file_id uuid;
BEGIN
  SELECT id INTO STRICT v_conversation
  FROM public.conversations
  WHERE linked_entity_type='brand' AND brand_id='39880000-0000-4000-bd00-000000000001';

  INSERT INTO public.messages(
    id,conversation_id,sender_id,content,message_type,created_at,
    sender_display_name_snapshot,sender_role_snapshot,deleted_at
  ) VALUES
    ('39881000-0000-4000-bd00-000000000001',v_conversation,'39880000-0000-4000-bc00-000000000002','one','image','2026-10-20 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000002',v_conversation,'39880000-0000-4000-bc00-000000000002','two','video','2026-10-19 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000003',v_conversation,'39880000-0000-4000-bc00-000000000002','three','image','2026-10-18 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000004',v_conversation,'39880000-0000-4000-bc00-000000000002','four','video','2026-09-17 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000005',v_conversation,'39880000-0000-4000-bc00-000000000002','five','image','2026-09-16 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000006',v_conversation,'39880000-0000-4000-bc00-000000000002','six','file','2026-10-15 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000007',v_conversation,'39880000-0000-4000-bc00-000000000002','seven','file','2026-09-14 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000008',v_conversation,'39880000-0000-4000-bc00-000000000002','eight','file','2026-09-13 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000009',v_conversation,'39880000-0000-4000-bc00-000000000002','pending','image','2026-10-21 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000010',v_conversation,'39880000-0000-4000-bc00-000000000002','failed','image','2026-10-22 10:00Z','Gallery Sender',NULL,NULL),
    ('39881000-0000-4000-bd00-000000000011',v_conversation,'39880000-0000-4000-bc00-000000000002','deleted','image','2026-10-23 10:00Z','Gallery Sender',NULL,'2026-10-23 11:00Z');

  INSERT INTO public.brand_group_files(
    id,conversation_id,brand_id,uploader_user_id,actor_mode,original_filename,
    declared_mime,declared_size_bytes,verified_mime,verified_size_bytes,storage_path,
    provider_file_id,message_id,state,created_at,media_width,media_height,media_duration_ms,thumb_state
  ) VALUES
    ('39882000-0000-4000-bd00-000000000001',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','one.jpg','image/jpeg',101,'image/jpeg',101,'3988/one','drive-one','39881000-0000-4000-bd00-000000000001','ready','2026-10-20 10:00Z',1200,900,NULL,'ready'),
    ('39882000-0000-4000-bd00-000000000002',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','two.mp4','video/mp4',102,'video/mp4',102,'3988/two','drive-two','39881000-0000-4000-bd00-000000000002','ready','2026-10-19 10:00Z',1080,1920,65000,'ready'),
    ('39882000-0000-4000-bd00-000000000003',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','three.png','image/png',103,'image/png',103,'3988/three','drive-three','39881000-0000-4000-bd00-000000000003','ready','2026-10-18 10:00Z',800,800,NULL,'pending'),
    ('39882000-0000-4000-bd00-000000000004',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','four.mp4','video/mp4',104,'video/mp4',104,'3988/four','drive-four','39881000-0000-4000-bd00-000000000004','ready','2026-09-17 10:00Z',1920,1080,5000,'ready'),
    ('39882000-0000-4000-bd00-000000000005',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','five.jpg','image/jpeg',105,'image/jpeg',105,'3988/five','drive-five','39881000-0000-4000-bd00-000000000005','ready','2026-09-16 10:00Z',600,900,NULL,'ready'),
    ('39882000-0000-4000-bd00-000000000006',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','six.pdf','application/pdf',106,'application/pdf',106,'3988/six','drive-six','39881000-0000-4000-bd00-000000000006','ready','2026-10-15 10:00Z',NULL,NULL,NULL,'none'),
    ('39882000-0000-4000-bd00-000000000007',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','seven.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',107,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',107,'3988/seven','drive-seven','39881000-0000-4000-bd00-000000000007','ready','2026-09-14 10:00Z',NULL,NULL,NULL,'none'),
    ('39882000-0000-4000-bd00-000000000008',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','eight.txt','text/plain',108,'text/plain',108,'3988/eight','drive-eight','39881000-0000-4000-bd00-000000000008','ready','2026-09-13 10:00Z',NULL,NULL,NULL,'none'),
    ('39882000-0000-4000-bd00-000000000009',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','pending.jpg','image/jpeg',109,NULL,NULL,'3988/pending',NULL,'39881000-0000-4000-bd00-000000000009','prepared','2026-10-21 10:00Z',NULL,NULL,NULL,'pending'),
    ('39882000-0000-4000-bd00-000000000010',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','failed.jpg','image/jpeg',110,NULL,NULL,'3988/failed',NULL,'39881000-0000-4000-bd00-000000000010','failed','2026-10-22 10:00Z',NULL,NULL,NULL,'pending'),
    ('39882000-0000-4000-bd00-000000000011',v_conversation,'39880000-0000-4000-bd00-000000000001','39880000-0000-4000-bc00-000000000002','brand','deleted.jpg','image/jpeg',111,'image/jpeg',111,'3988/deleted','drive-deleted','39881000-0000-4000-bd00-000000000011','ready','2026-10-23 10:00Z',100,100,NULL,'ready');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub','39880000-0000-4000-bc00-000000000002',true);
  v_result := public.issue_3988_list_brand_group_media(v_conversation,'media',NULL,NULL,2);
  RESET ROLE;

  IF v_result->>'schemaVersion'<>'1'
     OR (v_result#>>'{totals,media}')::integer<>5
     OR (v_result#>>'{totals,files}')::integer<>3
     OR jsonb_array_length(v_result->'rows')<>2
     OR v_result->'nextCursor' IS NULL THEN
    RAISE EXCEPTION 'first_page_or_totals_wrong:%',v_result;
  END IF;
  SELECT array_agg(key ORDER BY key) INTO v_actual_keys
  FROM jsonb_object_keys(v_result->'rows'->0) key;
  SELECT array_agg(key ORDER BY key) INTO v_expected_keys FROM unnest(v_expected_keys) key;
  IF v_actual_keys IS DISTINCT FROM v_expected_keys THEN
    RAISE EXCEPTION 'row_shape_wrong:%',v_actual_keys;
  END IF;
  IF v_result::text ~ 'provider_file_id|storage_path|uploader_user_id|brand_id|drive-' THEN
    RAISE EXCEPTION 'private_provider_data_leaked';
  END IF;

  FOR v_index IN 0..jsonb_array_length(v_result->'rows')-1 LOOP
    v_ids := array_append(v_ids,(v_result->'rows'->v_index->>'fileId')::uuid);
  END LOOP;
  v_cursor := v_result->'nextCursor';

  -- A concurrent newer insert must not perturb the older keyset chain.
  INSERT INTO public.messages(id,conversation_id,sender_id,content,message_type,created_at,sender_display_name_snapshot)
  VALUES ('39881000-0000-4000-bd00-000000000012',v_conversation,'39880000-0000-4000-bc00-000000000002','newer','image','2026-10-24 10:00Z','Gallery Sender');
  INSERT INTO public.brand_group_files(
    id,conversation_id,brand_id,uploader_user_id,actor_mode,original_filename,declared_mime,
    declared_size_bytes,verified_mime,verified_size_bytes,storage_path,provider_file_id,message_id,state,created_at
  ) VALUES (
    '39882000-0000-4000-bd00-000000000012',v_conversation,'39880000-0000-4000-bd00-000000000001',
    '39880000-0000-4000-bc00-000000000002','brand','newer.jpg','image/jpeg',112,'image/jpeg',112,
    '3988/newer','drive-newer','39881000-0000-4000-bd00-000000000012','ready','2026-10-24 10:00Z'
  );

  LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub','39880000-0000-4000-bc00-000000000002',true);
    v_page := public.issue_3988_list_brand_group_media(
      v_conversation,'media',(v_cursor->>'createdAt')::timestamptz,(v_cursor->>'id')::uuid,2
    );
    RESET ROLE;
    FOR v_index IN 0..jsonb_array_length(v_page->'rows')-1 LOOP
      v_file_id := (v_page->'rows'->v_index->>'fileId')::uuid;
      v_ids := array_append(v_ids,v_file_id);
    END LOOP;
    v_cursor := v_page->'nextCursor';
    EXIT WHEN v_cursor IS NULL OR v_cursor='null'::jsonb;
  END LOOP;

  IF cardinality(v_ids)<>5
     OR (SELECT count(DISTINCT id) FROM unnest(v_ids) id)<>5
     OR '39882000-0000-4000-bd00-000000000012'::uuid=ANY(v_ids) THEN
    RAISE EXCEPTION 'keyset_chain_repeated_skipped_or_admitted_newer:%',v_ids;
  END IF;
END;
$proof$;

ROLLBACK;
