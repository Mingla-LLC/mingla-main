-- #3988 — independent authorization, validation, clamp and privacy proof.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t3988_media_people(
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL
) ON COMMIT DROP;
INSERT INTO t3988_media_people VALUES
  ('owner','39883000-0000-4000-be00-000000000001','gallery-owner@test.local','Gallery Owner'),
  ('member','39883000-0000-4000-be00-000000000002','gallery-member@test.local','Gallery Member'),
  ('removed','39883000-0000-4000-be00-000000000003','gallery-removed@test.local','Gallery Removed'),
  ('outsider','39883000-0000-4000-be00-000000000004','gallery-outsider@test.local','Gallery Outsider'),
  ('support','39883000-0000-4000-be00-000000000005','gallery-support@test.local','Gallery Support'),
  ('admin','39883000-0000-4000-be00-000000000006','gallery-admin@test.local','Gallery Admin');

INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT id,email,jsonb_build_object('full_name',display_name) FROM t3988_media_people;
INSERT INTO public.profiles(id,email,display_name,username,account_type)
SELECT id,email,display_name,'media_adv_'||who,'business' FROM t3988_media_people;
INSERT INTO public.creator_accounts(id,email,display_name,business_name)
SELECT id,email,display_name,'Adversarial Gallery Host' FROM t3988_media_people WHERE who='owner';
INSERT INTO public.support_staff(user_id,enabled,available,display_name,role)
SELECT id,true,true,display_name,'staff' FROM t3988_media_people WHERE who='support';
INSERT INTO public.admin_team_members(email,role,status,accepted_at)
SELECT email,'growth','active',now() FROM t3988_media_people WHERE who='support';
INSERT INTO public.admin_users(email,role,status,accepted_at)
SELECT email,'admin','active',now() FROM t3988_media_people WHERE who='admin';
INSERT INTO public.brands(id,account_id,name,slug)
VALUES ('39883000-0000-4000-bf00-000000000001','39883000-0000-4000-be00-000000000001','Adversarial Gallery','issue-3988-media-adversarial');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
SELECT '39883000-0000-4000-bf00-000000000001',id,'marketing_manager',now()
FROM t3988_media_people WHERE who IN ('member','removed');
UPDATE public.brand_team_members
SET removed_at=now()
WHERE brand_id='39883000-0000-4000-bf00-000000000001'
  AND user_id='39883000-0000-4000-be00-000000000003';

CREATE FUNCTION pg_temp.t3988_media_call(
  p_user uuid,
  p_conversation uuid,
  p_kind text,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_limit integer
) RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_user IS NULL THEN
    SET LOCAL ROLE anon;
  ELSE
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub',p_user::text,true);
  END IF;
  v_result:=public.issue_3988_list_brand_group_media(
    p_conversation,p_kind,p_cursor_created_at,p_cursor_id,p_limit
  );
  RESET ROLE;
  RETURN 'OK:'||v_result::text;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:'||SQLSTATE||':'||SQLERRM;
END;
$function$;

DO $proof$
DECLARE
  v_member constant uuid := '39883000-0000-4000-be00-000000000002';
  v_removed constant uuid := '39883000-0000-4000-be00-000000000003';
  v_outsider constant uuid := '39883000-0000-4000-be00-000000000004';
  v_support constant uuid := '39883000-0000-4000-be00-000000000005';
  v_admin constant uuid := '39883000-0000-4000-be00-000000000006';
  v_conversation uuid;
  v_result text;
  v_json jsonb;
  v_ids uuid[];
BEGIN
  SELECT id INTO STRICT v_conversation
  FROM public.conversations
  WHERE linked_entity_type='brand' AND brand_id='39883000-0000-4000-bf00-000000000001';

  INSERT INTO public.messages(
    id,conversation_id,sender_id,content,message_type,created_at,sender_display_name_snapshot
  )
  SELECT md5('issue3988-media-message-'||g)::uuid,v_conversation,v_member,'fixture '||g,'image',
    '2026-08-01 00:00Z'::timestamptz + g*interval '1 minute','Gallery Member'
  FROM generate_series(1,101) g;
  INSERT INTO public.brand_group_files(
    id,conversation_id,brand_id,uploader_user_id,actor_mode,original_filename,
    declared_mime,declared_size_bytes,verified_mime,verified_size_bytes,storage_path,
    provider_file_id,message_id,state,created_at,media_width,media_height,thumb_state
  )
  SELECT md5('issue3988-media-file-'||g)::uuid,v_conversation,'39883000-0000-4000-bf00-000000000001',
    v_member,'brand','fixture-'||g||'.jpg','image/jpeg',100+g,'image/jpeg',100+g,
    '3988/adversarial/'||g,'private-drive-id-'||g,md5('issue3988-media-message-'||g)::uuid,
    'ready','2026-08-01 00:00Z'::timestamptz + g*interval '1 minute',100,100,'ready'
  FROM generate_series(1,101) g;

  FOREACH v_result IN ARRAY ARRAY[
    pg_temp.t3988_media_call(NULL,v_conversation,'media',NULL,NULL,60),
    pg_temp.t3988_media_call(v_outsider,v_conversation,'media',NULL,NULL,60),
    pg_temp.t3988_media_call(v_removed,v_conversation,'media',NULL,NULL,60)
  ] LOOP
    IF v_result NOT LIKE 'ERR:42501:%' THEN
      RAISE EXCEPTION 'unauthorized_gallery_call_not_hidden:%',v_result;
    END IF;
  END LOOP;

  v_result:=pg_temp.t3988_media_call(v_support,v_conversation,'media',NULL,NULL,1);
  IF v_result NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'support_gallery_access_failed:%',v_result; END IF;
  v_result:=pg_temp.t3988_media_call(v_admin,v_conversation,'media',NULL,NULL,1);
  IF v_result NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'admin_gallery_access_failed:%',v_result; END IF;

  v_result:=pg_temp.t3988_media_call(v_member,v_conversation,'all',NULL,NULL,60);
  IF v_result NOT LIKE 'ERR:22023:media_kind_invalid%' THEN
    RAISE EXCEPTION 'invalid_kind_accepted:%',v_result;
  END IF;
  v_result:=pg_temp.t3988_media_call(v_member,v_conversation,'media',now(),NULL,60);
  IF v_result NOT LIKE 'ERR:22023:media_cursor_invalid%' THEN
    RAISE EXCEPTION 'half_cursor_accepted:%',v_result;
  END IF;

  v_result:=pg_temp.t3988_media_call(v_member,v_conversation,'media',NULL,NULL,0);
  v_json:=substring(v_result FROM 4)::jsonb;
  IF jsonb_array_length(v_json->'rows')<>1 THEN RAISE EXCEPTION 'zero_limit_not_clamped_to_one'; END IF;
  v_result:=pg_temp.t3988_media_call(v_member,v_conversation,'media',NULL,NULL,999);
  v_json:=substring(v_result FROM 4)::jsonb;
  IF jsonb_array_length(v_json->'rows')<>100 OR v_json->'nextCursor' IS NULL THEN
    RAISE EXCEPTION 'large_limit_not_clamped_to_one_hundred';
  END IF;
  IF v_json::text ~ 'provider_file_id|storage_path|uploader_user_id|brand_id|private-drive-id' THEN
    RAISE EXCEPTION 'private_storage_or_provider_data_leaked';
  END IF;

  SELECT array_agg(md5('issue3988-meta-id-'||g)::uuid) INTO v_ids FROM generate_series(1,201) g;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub',v_member::text,true);
    PERFORM * FROM public.issue_3988_brand_group_file_media_meta(v_conversation,v_ids);
    RAISE EXCEPTION 'meta_accepted_more_than_200_ids';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLSTATE<>'22023' OR SQLERRM<>'media_ids_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub',v_member::text,true);
    PERFORM public.issue_3988_set_brand_group_file_media(v_ids[1],1,1,0,'ready');
    RAISE EXCEPTION 'authenticated_user_executed_service_setter';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLSTATE<>'42501' THEN RAISE; END IF;
  END;

  IF has_function_privilege(
       'authenticated',
       'public.issue_3988_set_brand_group_file_media(uuid,integer,integer,integer,text)',
       'EXECUTE'
     ) OR has_function_privilege(
       'anon',
       'public.issue_3988_list_brand_group_media(uuid,text,timestamptz,uuid,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'gallery_rpc_grants_wrong';
  END IF;
END;
$proof$;

ROLLBACK;
