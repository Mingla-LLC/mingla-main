-- #3720 Completion Wave 3 — independent file-boundary and staging-abuse proof.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('37200000-0000-4000-b600-000000000001','wave3-owner@test.local'),
  ('37200000-0000-4000-b600-000000000002','wave3-member@test.local'),
  ('37200000-0000-4000-b600-000000000003','wave3-outsider@test.local');

INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('37200000-0000-4000-b600-000000000001','wave3-owner@test.local','Wave 3 Owner','wave3_owner','business'),
  ('37200000-0000-4000-b600-000000000002','wave3-member@test.local','Wave 3 Member','wave3_member','business'),
  ('37200000-0000-4000-b600-000000000003','wave3-outsider@test.local','Wave 3 Outsider','wave3_outsider','business');

INSERT INTO public.creator_accounts(id,email,display_name,business_name)
VALUES('37200000-0000-4000-b600-000000000001','wave3-owner@test.local','Wave 3 Owner','Wave 3 Host');

INSERT INTO public.brands(id,account_id,name,slug)
VALUES('37200000-0000-4000-b700-000000000001','37200000-0000-4000-b600-000000000001','Wave 3 Brand','wave3-brand');

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES('37200000-0000-4000-b700-000000000001','37200000-0000-4000-b600-000000000002','event_manager',now());

CREATE FUNCTION pg_temp.t3720_prepare(p_user uuid,p_conversation uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_result jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',p_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT public.issue_3720_prepare_brand_group_files(
    p_conversation,'brand','[{"name":"proof.txt","mime_type":"text/plain","size_bytes":10}]'::jsonb
  ) INTO v_result;
  RESET ROLE;
  RETURN 'OK:'||v_result::text;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:'||SQLSTATE||':'||SQLERRM;
END;
$$;

CREATE FUNCTION pg_temp.t3720_can_stage(p_user uuid,p_path text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_result boolean;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',p_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT public.issue_3720_can_stage_brand_group_file(p_path,p_user) INTO v_result;
  RESET ROLE;
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN false;
END;
$$;

DO $proof$
DECLARE
  v_owner constant uuid := '37200000-0000-4000-b600-000000000001';
  v_member constant uuid := '37200000-0000-4000-b600-000000000002';
  v_outsider constant uuid := '37200000-0000-4000-b600-000000000003';
  v_brand constant uuid := '37200000-0000-4000-b700-000000000001';
  v_conversation uuid;v_first_file uuid;v_first_path text;v_stale_file uuid;v_claim jsonb;v_result text;
BEGIN
  SELECT id INTO STRICT v_conversation FROM public.conversations
  WHERE brand_id=v_brand AND linked_entity_type='brand';

  IF NOT EXISTS(SELECT 1 FROM public.brand_group_drive_bindings
    WHERE conversation_id=v_conversation AND brand_id=v_brand AND state='pending') THEN
    RAISE EXCEPTION 'official_group_drive_binding_missing';
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id='brand-group-file-staging') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'staging_bucket_is_not_private';
  END IF;

  v_result:=pg_temp.t3720_prepare(v_outsider,v_conversation);
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'outsider_prepared_file:%',v_result; END IF;
  v_result:=pg_temp.t3720_prepare(v_member,v_conversation);
  IF v_result NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'member_prepare_failed:%',v_result; END IF;
  SELECT id,storage_path INTO STRICT v_first_file,v_first_path FROM public.brand_group_files
  WHERE uploader_user_id=v_member ORDER BY created_at,id LIMIT 1;
  IF NOT pg_temp.t3720_can_stage(v_member,v_first_path) THEN RAISE EXCEPTION 'member_cannot_stage_owned_file'; END IF;

  UPDATE public.brand_team_members SET removed_at=now()
  WHERE brand_id=v_brand AND user_id=v_member AND removed_at IS NULL;
  IF pg_temp.t3720_can_stage(v_member,v_first_path) THEN RAISE EXCEPTION 'removed_member_retained_staging_access'; END IF;
  IF pg_temp.t3720_prepare(v_member,v_conversation) NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'removed_member_prepared_another_file';
  END IF;

  UPDATE public.brand_team_members SET removed_at=NULL WHERE brand_id=v_brand AND user_id=v_member;
  v_result:=pg_temp.t3720_prepare(v_member,v_conversation);
  IF v_result NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'member_reprepare_failed:%',v_result; END IF;
  SELECT id INTO STRICT v_stale_file FROM public.brand_group_files
  WHERE uploader_user_id=v_member AND id<>v_first_file ORDER BY created_at DESC,id DESC LIMIT 1;
  UPDATE public.brand_group_files SET created_at=now()-interval '25 hours' WHERE id=v_stale_file;

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SET LOCAL ROLE service_role;
  SELECT public.issue_3720_claim_stale_brand_group_file() INTO v_claim;
  IF (v_claim->>'file_id')::uuid<>v_stale_file THEN RAISE EXCEPTION 'stale_file_not_claimed'; END IF;
  PERFORM public.issue_3720_complete_stale_brand_group_file(v_stale_file);
  RESET ROLE;
  IF (SELECT state FROM public.brand_group_files WHERE id=v_stale_file)<>'discarded' THEN
    RAISE EXCEPTION 'stale_file_not_discarded';
  END IF;

  INSERT INTO public.brand_group_files(
    conversation_id,brand_id,uploader_user_id,actor_mode,original_filename,
    declared_mime,declared_size_bytes,storage_path
  )
  SELECT v_conversation,v_brand,v_member,'brand','pending-'||n||'.txt','text/plain',10,
    v_conversation::text||'/'||gen_random_uuid()::text||'/source'
  FROM generate_series(1,19) n;
  v_result:=pg_temp.t3720_prepare(v_member,v_conversation);
  IF v_result NOT LIKE 'ERR:54000:outstanding_file_count_exceeded%' THEN
    RAISE EXCEPTION 'outstanding_count_cap_failed:%',v_result;
  END IF;

  IF has_table_privilege('authenticated','public.brand_group_files','SELECT')
     OR has_table_privilege('authenticated','public.brand_group_files','INSERT')
     OR has_table_privilege('authenticated','public.brand_group_drive_bindings','SELECT') THEN
    RAISE EXCEPTION 'provider_ledger_exposed_to_authenticated';
  END IF;
  IF has_function_privilege('anon','public.issue_3720_prepare_brand_group_files(uuid,text,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.issue_3720_can_stage_brand_group_file(text,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3720_claim_brand_group_file(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3720_authorize_brand_group_file(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3720_claim_stale_brand_group_file()','EXECUTE') THEN
    RAISE EXCEPTION 'file_rpc_permission_boundary_broken';
  END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.is_admin_user()'::regprocedure))<>'82e85b947e9f0669f47e4c8fe9d2e385' THEN
    RAISE EXCEPTION 'protected_is_admin_user_changed';
  END IF;
  IF (SELECT pg_get_function_result('public.issue_3720_list_brand_group_messages(uuid,integer,timestamptz)'::regprocedure)) LIKE '%provider%' THEN
    RAISE EXCEPTION 'provider_identity_returned_by_message_rpc';
  END IF;
END;
$proof$;

ROLLBACK;
