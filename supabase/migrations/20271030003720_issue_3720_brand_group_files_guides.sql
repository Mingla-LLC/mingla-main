-- #3720 Completion Wave 3 — private Brand-group files backed by Shared Drive.
--
-- Provider object and folder ids never leave service-role paths. Authenticated
-- callers receive only stable Mingla file ids and stream content through the
-- brand-group-files Edge authorization boundary. A private staging bucket
-- supplies progress/retry; every object write and every view rechecks current
-- Brand-group access.

BEGIN;

DO $guard$
DECLARE v_before text;
BEGIN
  SELECT pg_get_functiondef('public.is_admin_user()'::regprocedure) INTO v_before;
  PERFORM set_config('issue_3720.is_admin_user_before', md5(v_before), true);
END;
$guard$;

CREATE TABLE IF NOT EXISTS public.brand_group_drive_bindings (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL UNIQUE REFERENCES public.brands(id) ON DELETE CASCADE,
  canonical_host_folder_name text NOT NULL,
  provider text NOT NULL DEFAULT 'google_drive',
  shared_drive_id text,
  host_folder_id text,
  media_packet_folder_id text,
  host_uploads_folder_id text,
  staff_sharing_folder_id text,
  state text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  last_error_code text,
  provisioned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_group_drive_bindings_provider_check CHECK (provider='google_drive'),
  CONSTRAINT brand_group_drive_bindings_state_check CHECK (state IN ('pending','provisioning','ready','failed')),
  CONSTRAINT brand_group_drive_bindings_folder_name_nonempty CHECK (btrim(canonical_host_folder_name)<>'')
);

CREATE INDEX IF NOT EXISTS brand_group_drive_bindings_pending_idx
  ON public.brand_group_drive_bindings(state, updated_at)
  WHERE state IN ('pending','provisioning','failed');

CREATE TABLE IF NOT EXISTS public.brand_group_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  uploader_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_mode text NOT NULL,
  original_filename text NOT NULL,
  declared_mime text NOT NULL,
  declared_size_bytes bigint NOT NULL,
  verified_mime text,
  verified_size_bytes bigint,
  storage_path text NOT NULL UNIQUE,
  provider_file_id text UNIQUE,
  message_id uuid UNIQUE REFERENCES public.messages(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'prepared',
  attempt_count integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT brand_group_files_actor_mode_check CHECK (actor_mode IN ('brand','support')),
  CONSTRAINT brand_group_files_state_check CHECK (state IN ('prepared','transferring','ready','failed','discarding','discarded')),
  CONSTRAINT brand_group_files_name_nonempty CHECK (btrim(original_filename)<>''),
  CONSTRAINT brand_group_files_size_check CHECK (declared_size_bytes BETWEEN 1 AND 104857600)
);

CREATE INDEX IF NOT EXISTS brand_group_files_conversation_idx
  ON public.brand_group_files(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brand_group_files_uploader_idx
  ON public.brand_group_files(uploader_user_id, created_at DESC);

ALTER TABLE public.brand_group_drive_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_group_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_group_drive_bindings, public.brand_group_files FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brand_group_drive_bindings, public.brand_group_files TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'brand-group-file-staging','brand-group-file-staging',false,104857600,
  ARRAY[
    'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif',
    'video/mp4','video/quicktime','video/webm',
    'audio/mpeg','audio/mp4','audio/wav','audio/x-m4a',
    'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','text/csv','application/csv'
  ]::text[]
)
ON CONFLICT(id) DO UPDATE SET
  public=false,
  file_size_limit=EXCLUDED.file_size_limit,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.issue_3720_can_stage_brand_group_file(
  p_storage_path text,p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL
    AND p_user_id=auth.uid()
    AND EXISTS(
      SELECT 1 FROM public.brand_group_files f
      WHERE f.storage_path=p_storage_path
        AND f.uploader_user_id=p_user_id
        AND f.state IN ('prepared','failed')
        AND f.created_at>now()-interval '24 hours'
        AND public.issue_3720_brand_group_can_access(f.conversation_id,p_user_id)
    );
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_can_stage_brand_group_file(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_can_stage_brand_group_file(text,uuid) TO authenticated,service_role;

DROP POLICY IF EXISTS brand_group_file_staging_insert ON storage.objects;
CREATE POLICY brand_group_file_staging_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='brand-group-file-staging'
    AND public.issue_3720_can_stage_brand_group_file(name,auth.uid())
  );

DROP POLICY IF EXISTS brand_group_file_staging_update ON storage.objects;
CREATE POLICY brand_group_file_staging_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id='brand-group-file-staging'
    AND public.issue_3720_can_stage_brand_group_file(name,auth.uid())
  )
  WITH CHECK (
    bucket_id='brand-group-file-staging'
    AND public.issue_3720_can_stage_brand_group_file(name,auth.uid())
  );

DROP POLICY IF EXISTS brand_group_file_staging_select ON storage.objects;
CREATE POLICY brand_group_file_staging_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id='brand-group-file-staging'
    AND public.issue_3720_can_stage_brand_group_file(name,auth.uid())
  );

CREATE OR REPLACE FUNCTION public.issue_3720_ensure_official_brand_group(p_brand_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_brand public.brands%ROWTYPE;v_conversation_id uuid;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id=p_brand_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.conversations(type,linked_entity_type,brand_id,name,created_by,is_enabled,is_broadcast_only)
  VALUES('group','brand',v_brand.id,v_brand.name||' · Brand group',v_brand.account_id,v_brand.deleted_at IS NULL,false)
  ON CONFLICT(brand_id) WHERE linked_entity_type='brand' AND brand_id IS NOT NULL
  DO UPDATE SET name=EXCLUDED.name,is_enabled=EXCLUDED.is_enabled,updated_at=now()
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants(conversation_id,user_id)
  SELECT v_conversation_id,member.user_id FROM public.brand_team_members member
  WHERE member.brand_id=p_brand_id AND member.accepted_at IS NOT NULL AND member.removed_at IS NULL
  ON CONFLICT(conversation_id,user_id) DO NOTHING;

  DELETE FROM public.conversation_participants participant
  WHERE participant.conversation_id=v_conversation_id
    AND NOT EXISTS(SELECT 1 FROM public.brand_team_members member
      WHERE member.brand_id=p_brand_id AND member.user_id=participant.user_id
        AND member.accepted_at IS NOT NULL AND member.removed_at IS NULL);

  INSERT INTO public.brand_group_drive_bindings(
    conversation_id,brand_id,canonical_host_folder_name,state,updated_at
  ) VALUES(
    v_conversation_id,v_brand.id,btrim(v_brand.name),
    CASE WHEN v_brand.deleted_at IS NULL THEN 'pending' ELSE 'failed' END,now()
  )
  ON CONFLICT(conversation_id) DO UPDATE SET
    canonical_host_folder_name=EXCLUDED.canonical_host_folder_name,
    state=CASE
      WHEN v_brand.deleted_at IS NOT NULL THEN 'failed'
      WHEN brand_group_drive_bindings.state='ready' THEN 'ready'
      ELSE 'pending'
    END,
    last_error_code=CASE WHEN v_brand.deleted_at IS NULL THEN NULL ELSE 'BRAND_REMOVED' END,
    updated_at=now();

  RETURN v_conversation_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_ensure_official_brand_group(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_ensure_official_brand_group(uuid) TO service_role;

SELECT public.issue_3720_ensure_official_brand_group(id) FROM public.brands;

CREATE OR REPLACE FUNCTION public.issue_3720_prepare_brand_group_files(
  p_conversation_id uuid,p_actor_mode text,p_files jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,storage,pg_temp
AS $function$
DECLARE
  v_actor uuid:=auth.uid();v_conversation public.conversations%ROWTYPE;
  v_is_member boolean;v_is_support boolean;v_total bigint:=0;v_count integer;
  v_existing_bytes bigint;v_existing_count integer;
  v_file jsonb;v_id uuid;v_name text;v_mime text;v_size bigint;v_path text;v_out jsonb:='[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_conversation FROM public.conversations
  WHERE id=p_conversation_id AND linked_entity_type='brand' AND is_enabled IS TRUE;
  IF NOT FOUND OR NOT public.issue_3720_brand_group_can_access(p_conversation_id,v_actor) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.brand_team_members m
    WHERE m.brand_id=v_conversation.brand_id AND m.user_id=v_actor
      AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL) INTO v_is_member;
  v_is_support:=public.is_support_staff(v_actor) OR public.is_admin_user();
  IF p_actor_mode NOT IN ('brand','support')
    OR (p_actor_mode='brand' AND NOT v_is_member)
    OR (p_actor_mode='support' AND NOT v_is_support) THEN
    RAISE EXCEPTION 'invalid_actor_mode' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_files)<>'array' THEN RAISE EXCEPTION 'invalid_files' USING ERRCODE='22023'; END IF;
  v_count:=jsonb_array_length(p_files);
  IF v_count NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'file_count_exceeded' USING ERRCODE='22023'; END IF;

  -- Bound abandoned staging exposure per person. The matching sweeper below
  -- retires anything that was not finalized within 24 hours.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_3720_files:'||v_actor::text,0));
  SELECT COALESCE(sum(declared_size_bytes),0),count(*)
  INTO v_existing_bytes,v_existing_count
  FROM public.brand_group_files
  WHERE uploader_user_id=v_actor AND state IN ('prepared','transferring','failed','discarding');
  IF v_existing_count+v_count>20 THEN
    RAISE EXCEPTION 'outstanding_file_count_exceeded' USING ERRCODE='54000';
  END IF;

  FOR v_file IN SELECT value FROM jsonb_array_elements(p_files) LOOP
    v_name:=left(regexp_replace(btrim(COALESCE(v_file->>'name','')), '[\\/[:cntrl:]]', '_', 'g'),180);
    v_mime:=lower(split_part(btrim(COALESCE(v_file->>'mime_type','')), ';', 1));
    BEGIN v_size:=(v_file->>'size_bytes')::bigint; EXCEPTION WHEN OTHERS THEN v_size:=0; END;
    IF v_name='' OR v_size NOT BETWEEN 1 AND 104857600 OR NOT (
      v_mime LIKE 'image/%' OR v_mime LIKE 'video/%' OR v_mime LIKE 'audio/%'
      OR v_mime IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv','application/csv')
    ) THEN RAISE EXCEPTION 'unsupported_file' USING ERRCODE='22023'; END IF;
    v_total:=v_total+v_size;
    IF v_total>262144000 THEN RAISE EXCEPTION 'file_total_exceeded' USING ERRCODE='22023'; END IF;
    IF v_existing_bytes+v_total>524288000 THEN
      RAISE EXCEPTION 'outstanding_file_bytes_exceeded' USING ERRCODE='54000';
    END IF;

    v_id:=gen_random_uuid();
    v_path:=p_conversation_id::text||'/'||v_id::text||'/source';
    INSERT INTO public.brand_group_files(
      id,conversation_id,brand_id,uploader_user_id,actor_mode,original_filename,
      declared_mime,declared_size_bytes,storage_path
    ) VALUES(
      v_id,p_conversation_id,v_conversation.brand_id,v_actor,p_actor_mode,v_name,
      v_mime,v_size,v_path
    );
    v_out:=v_out||jsonb_build_array(jsonb_build_object(
      'file_id',v_id,'storage_path',v_path,'name',v_name,'mime_type',v_mime,'size_bytes',v_size
    ));
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_prepare_brand_group_files(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_prepare_brand_group_files(uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_claim_drive_binding()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_row public.brand_group_drive_bindings%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.brand_group_drive_bindings b
  WHERE (
    b.state='pending'
    OR (b.state='failed' AND b.attempt_count<8 AND b.updated_at<now()-interval '2 minutes')
    OR (b.state='provisioning' AND b.lease_expires_at<now())
  )
  ORDER BY CASE b.state WHEN 'pending' THEN 0 WHEN 'provisioning' THEN 1 ELSE 2 END,b.updated_at,b.conversation_id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.brand_group_drive_bindings SET
    state='provisioning',attempt_count=attempt_count+1,lease_expires_at=now()+interval '5 minutes',
    last_error_code=NULL,updated_at=now()
  WHERE conversation_id=v_row.conversation_id;
  RETURN jsonb_build_object(
    'conversation_id',v_row.conversation_id,'brand_id',v_row.brand_id,
    'canonical_host_folder_name',v_row.canonical_host_folder_name,
    'host_folder_id',v_row.host_folder_id,'media_packet_folder_id',v_row.media_packet_folder_id,
    'host_uploads_folder_id',v_row.host_uploads_folder_id,'staff_sharing_folder_id',v_row.staff_sharing_folder_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_claim_drive_binding() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_claim_drive_binding() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_complete_drive_binding(
  p_conversation_id uuid,p_shared_drive_id text,p_host_folder_id text,p_media_packet_folder_id text,
  p_host_uploads_folder_id text,p_staff_sharing_folder_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[p_shared_drive_id,p_host_folder_id,p_media_packet_folder_id,p_host_uploads_folder_id,p_staff_sharing_folder_id]) v WHERE btrim(COALESCE(v,''))='') THEN
    RAISE EXCEPTION 'provider_ids_required' USING ERRCODE='22023';
  END IF;
  UPDATE public.brand_group_drive_bindings SET
    shared_drive_id=p_shared_drive_id,host_folder_id=p_host_folder_id,
    media_packet_folder_id=p_media_packet_folder_id,host_uploads_folder_id=p_host_uploads_folder_id,
    staff_sharing_folder_id=p_staff_sharing_folder_id,state='ready',lease_expires_at=NULL,
    last_error_code=NULL,provisioned_at=COALESCE(provisioned_at,now()),updated_at=now()
  WHERE conversation_id=p_conversation_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_complete_drive_binding(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_complete_drive_binding(uuid,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_fail_drive_binding(p_conversation_id uuid,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.brand_group_drive_bindings SET state='failed',lease_expires_at=NULL,
    last_error_code=left(COALESCE(NULLIF(btrim(p_error_code),''),'PROVISION_FAILED'),80),updated_at=now()
  WHERE conversation_id=p_conversation_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_fail_drive_binding(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_fail_drive_binding(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_claim_brand_group_file(p_file_id uuid,p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,storage,pg_temp
AS $function$
DECLARE v_file public.brand_group_files%ROWTYPE;v_binding public.brand_group_drive_bindings%ROWTYPE;v_object record;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_file FROM public.brand_group_files WHERE id=p_file_id FOR UPDATE;
  IF NOT FOUND OR v_file.uploader_user_id<>p_user_id
     OR NOT public.issue_3720_brand_group_can_access(v_file.conversation_id,p_user_id) THEN
    RAISE EXCEPTION 'file_unavailable' USING ERRCODE='42501';
  END IF;
  IF v_file.state='ready' THEN RETURN jsonb_build_object('state','ready','file_id',v_file.id,'message_id',v_file.message_id); END IF;
  IF v_file.state='transferring' AND v_file.lease_expires_at>=now() THEN
    RETURN jsonb_build_object('state','transferring','file_id',v_file.id);
  END IF;
  IF v_file.state NOT IN ('prepared','failed','transferring') THEN
    RAISE EXCEPTION 'file_unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_binding FROM public.brand_group_drive_bindings WHERE conversation_id=v_file.conversation_id;
  IF NOT FOUND OR v_binding.state<>'ready' THEN RAISE EXCEPTION 'drive_not_ready' USING ERRCODE='55000'; END IF;
  SELECT metadata INTO v_object FROM storage.objects
  WHERE bucket_id='brand-group-file-staging' AND name=v_file.storage_path;
  IF NOT FOUND OR COALESCE((v_object.metadata->>'size')::bigint,0)<>v_file.declared_size_bytes THEN
    RAISE EXCEPTION 'upload_incomplete' USING ERRCODE='22023';
  END IF;
  UPDATE public.brand_group_files SET state='transferring',attempt_count=attempt_count+1,
    lease_expires_at=now()+interval '5 minutes',last_error_code=NULL,updated_at=now()
  WHERE id=v_file.id;
  RETURN jsonb_build_object(
    'state','transferring','file_id',v_file.id,'conversation_id',v_file.conversation_id,
    'brand_id',v_file.brand_id,'uploader_user_id',v_file.uploader_user_id,'actor_mode',v_file.actor_mode,
    'name',v_file.original_filename,'mime_type',v_file.declared_mime,'size_bytes',v_file.declared_size_bytes,
    'storage_path',v_file.storage_path,
    'target_folder_id',CASE WHEN v_file.actor_mode='support' THEN v_binding.staff_sharing_folder_id ELSE v_binding.host_uploads_folder_id END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_claim_brand_group_file(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_claim_brand_group_file(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_fail_brand_group_file(p_file_id uuid,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.brand_group_files SET state='failed',lease_expires_at=NULL,
    last_error_code=left(COALESCE(NULLIF(btrim(p_error_code),''),'TRANSFER_FAILED'),80),updated_at=now()
  WHERE id=p_file_id AND state<>'ready';
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_fail_brand_group_file(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_fail_brand_group_file(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_claim_stale_brand_group_file()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_file public.brand_group_files%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_file FROM public.brand_group_files f
  WHERE f.state<>'ready' AND f.created_at<now()-interval '24 hours' AND (
    f.state='prepared'
    OR (f.state='failed' AND f.updated_at<now()-interval '2 minutes')
    OR (f.state IN ('transferring','discarding') AND f.lease_expires_at<now())
  )
  ORDER BY f.created_at,f.id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.brand_group_files SET state='discarding',lease_expires_at=now()+interval '5 minutes',
    last_error_code=NULL,updated_at=now() WHERE id=v_file.id;
  RETURN jsonb_build_object('file_id',v_file.id,'storage_path',v_file.storage_path);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_claim_stale_brand_group_file() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_claim_stale_brand_group_file() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_complete_stale_brand_group_file(p_file_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.brand_group_files SET state='discarded',lease_expires_at=NULL,
    last_error_code='STAGING_EXPIRED',updated_at=now()
  WHERE id=p_file_id AND state='discarding';
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_complete_stale_brand_group_file(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_complete_stale_brand_group_file(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_complete_brand_group_file(
  p_file_id uuid,p_provider_file_id text,p_verified_mime text,p_verified_size bigint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_file public.brand_group_files%ROWTYPE;v_message_id uuid;v_display_name text;v_role text;
  v_message_type text;v_brand_name text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_file FROM public.brand_group_files WHERE id=p_file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'file_unavailable' USING ERRCODE='P0002'; END IF;
  IF v_file.state='ready' AND v_file.message_id IS NOT NULL THEN RETURN v_file.message_id; END IF;
  IF NOT public.issue_3720_brand_group_can_access(v_file.conversation_id,v_file.uploader_user_id) THEN
    RAISE EXCEPTION 'file_access_removed' USING ERRCODE='42501';
  END IF;
  IF btrim(COALESCE(p_provider_file_id,''))='' OR p_verified_size<>v_file.declared_size_bytes THEN
    RAISE EXCEPTION 'provider_verification_failed' USING ERRCODE='22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(CASE WHEN v_file.actor_mode='support' THEN staff.display_name END),''),
    NULLIF(btrim(profile.display_name),''),NULLIF(btrim(concat_ws(' ',profile.first_name,profile.last_name)),''),
    NULLIF(btrim(profile.username),''),NULLIF(btrim(identity.raw_user_meta_data->>'full_name'),''),
    NULLIF(btrim(identity.raw_user_meta_data->>'name'),''),'Mingla teammate')
  INTO v_display_name
  FROM auth.users identity
  LEFT JOIN public.profiles profile ON profile.id=identity.id
  LEFT JOIN public.support_staff staff ON staff.user_id=identity.id
  WHERE identity.id=v_file.uploader_user_id;
  v_display_name:=COALESCE(v_display_name,'Mingla teammate');
  v_role:=CASE WHEN v_file.actor_mode='support' THEN 'Mingla Support' ELSE NULL END;
  v_message_type:=CASE
    WHEN p_verified_mime LIKE 'image/%' THEN 'image'
    WHEN p_verified_mime LIKE 'video/%' THEN 'video'
    ELSE 'file'
  END;

  INSERT INTO public.messages(
    conversation_id,sender_id,content,message_type,file_url,file_name,file_size,
    sender_display_name_snapshot,sender_role_snapshot
  ) VALUES(
    v_file.conversation_id,v_file.uploader_user_id,v_file.original_filename,v_message_type,
    NULL,v_file.original_filename,p_verified_size,v_display_name,v_role
  ) RETURNING id INTO v_message_id;

  UPDATE public.brand_group_files SET provider_file_id=p_provider_file_id,
    verified_mime=lower(split_part(p_verified_mime,';',1)),verified_size_bytes=p_verified_size,
    message_id=v_message_id,state='ready',lease_expires_at=NULL,last_error_code=NULL,
    completed_at=now(),updated_at=now()
  WHERE id=p_file_id;
  UPDATE public.conversations SET last_message_at=now(),updated_at=now() WHERE id=v_file.conversation_id;
  SELECT name INTO v_brand_name FROM public.brands WHERE id=v_file.brand_id;

  INSERT INTO public.brand_group_audit_log(conversation_id,brand_id,actor_user_id,action,message_id,metadata)
  VALUES(v_file.conversation_id,v_file.brand_id,v_file.uploader_user_id,'file_shared',v_message_id,
    jsonb_build_object('file_id',p_file_id,'actor_mode',v_file.actor_mode,'mime_type',p_verified_mime,'size_bytes',p_verified_size));

  INSERT INTO public.notification_outbox(category_key,user_id,brand_id,country_code,payload,idempotency_key,status)
  SELECT 'business.brand_group_message',reads.user_id,v_file.brand_id,NULL,
    jsonb_build_object('message_id',v_message_id,'conversation_id',v_file.conversation_id,
      'brand_id',v_file.brand_id,'brand_name',v_brand_name,'sender_name',v_display_name,
      'body','Shared a file: '||v_file.original_filename,'deep_link','mingla-business://messages/'||v_file.conversation_id::text),
    'business.brand_group_message:'||v_message_id::text||':'||reads.user_id::text,'pending'
  FROM public.brand_group_reads reads
  WHERE reads.conversation_id=v_file.conversation_id AND reads.push_enabled IS TRUE
    AND reads.user_id<>v_file.uploader_user_id
    AND public.issue_3720_brand_group_can_access(v_file.conversation_id,reads.user_id)
  ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN v_message_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_complete_brand_group_file(uuid,text,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_complete_brand_group_file(uuid,text,text,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_authorize_brand_group_file(p_file_id uuid,p_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
  SELECT CASE WHEN auth.role()='service_role' THEN (
    SELECT jsonb_build_object(
      'file_id',f.id,'conversation_id',f.conversation_id,'provider_file_id',f.provider_file_id,
      'name',f.original_filename,'mime_type',f.verified_mime,'size_bytes',f.verified_size_bytes
    )
    FROM public.brand_group_files f
    WHERE f.id=p_file_id AND f.state='ready' AND f.provider_file_id IS NOT NULL
      AND public.issue_3720_brand_group_can_access(f.conversation_id,p_user_id)
  ) ELSE NULL END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_authorize_brand_group_file(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_authorize_brand_group_file(uuid,uuid) TO service_role;

DROP FUNCTION IF EXISTS public.issue_3720_list_brand_group_messages(uuid,integer,timestamptz);
CREATE FUNCTION public.issue_3720_list_brand_group_messages(
  p_conversation_id uuid,p_limit integer DEFAULT 80,p_before timestamptz DEFAULT NULL
) RETURNS TABLE(
  id uuid,conversation_id uuid,sender_id uuid,content text,created_at timestamptz,
  reply_to_id uuid,related_message_ids uuid[],sender_display_name text,sender_role text,
  reply_content text,reply_sender_display_name text,message_type text,file_id uuid,
  file_name text,file_size bigint,file_mime text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
BEGIN
  IF NOT public.issue_3720_brand_group_can_access(p_conversation_id,auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT m.id,m.conversation_id,m.sender_id,m.content,m.created_at,m.reply_to_id,m.related_message_ids,
    COALESCE(NULLIF(btrim(m.sender_display_name_snapshot),''),NULLIF(btrim(p.display_name),''),
      NULLIF(btrim(concat_ws(' ',p.first_name,p.last_name)),''),NULLIF(btrim(p.username),''),'Mingla member'),
    NULLIF(btrim(m.sender_role_snapshot),''),reply.content,
    COALESCE(NULLIF(btrim(reply.sender_display_name_snapshot),''),NULLIF(btrim(reply_profile.display_name),''),
      NULLIF(btrim(concat_ws(' ',reply_profile.first_name,reply_profile.last_name)),''),
      NULLIF(btrim(reply_profile.username),''),'Mingla member'),
    m.message_type::text,f.id,f.original_filename,f.verified_size_bytes,f.verified_mime
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id=m.sender_id
  LEFT JOIN public.messages reply ON reply.id=m.reply_to_id AND reply.conversation_id=m.conversation_id
  LEFT JOIN public.profiles reply_profile ON reply_profile.id=reply.sender_id
  LEFT JOIN public.brand_group_files f ON f.message_id=m.id AND f.state='ready'
  WHERE m.conversation_id=p_conversation_id AND m.deleted_at IS NULL
    AND (p_before IS NULL OR m.created_at<p_before)
  ORDER BY m.created_at DESC,m.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,80),1),200);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_list_brand_group_messages(uuid,integer,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_brand_group_messages(uuid,integer,timestamptz) TO authenticated,service_role;

DO $cron$
DECLARE v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE '#3720: pg_cron/pg_net unavailable; Drive binding provisioner not scheduled';
    RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='supabase_url')
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key') THEN
    RAISE NOTICE '#3720: runtime vault rows unavailable; Drive binding provisioner not scheduled';
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='issue_3720_brand_group_drive_provision';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule(
    'issue_3720_brand_group_drive_provision','* * * * *',
    $job$SELECT net.http_post(
      url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)||'/functions/v1/brand-group-files',
      headers:=jsonb_build_object(
        'content-type','application/json',
        'authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)
      ),
      body:='{"action":"provision_pending"}'::jsonb,
      timeout_milliseconds:=25000
    )$job$
  );
END;
$cron$;

DO $guard$
DECLARE v_after text;v_before_md5 text:=current_setting('issue_3720.is_admin_user_before',true);
BEGIN
  SELECT pg_get_functiondef('public.is_admin_user()'::regprocedure) INTO v_after;
  IF v_before_md5 IS NULL OR md5(v_after)<>v_before_md5 THEN RAISE EXCEPTION 'is_admin_user_changed'; END IF;
END;
$guard$;

COMMIT;
