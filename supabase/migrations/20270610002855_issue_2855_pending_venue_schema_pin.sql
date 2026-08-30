-- Issue #2855: forward-only approval of the reviewed current dependency schema.
-- The six post-#2099 venue-reference lanes remain dynamically discovered and
-- default-disallowed; this migration changes no table, helper, row, or policy.

CREATE OR REPLACE FUNCTION public.preview_pending_venue_identity_correction(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_pool public.place_pool%ROWTYPE;
  v_pipeline public.brand_place_pipeline_state%ROWTYPE;
  v_inv jsonb;
  v_code text;
  v_sensitive text[] := '{}';
  v_disallowed bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id=p_venue_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF NOT public.is_admin_user() AND NOT EXISTS (
    SELECT 1 FROM public.brand_team_members m WHERE m.brand_id=v_venue.brand_id
      AND m.user_id=v_uid AND m.role='brand_owner' AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
  ) THEN RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORIZED'); END IF;
  IF v_venue.claim_status<>'pending_review' THEN v_code:='NOT_PENDING';
  ELSIF v_venue.claim_follow_up_at IS NOT NULL THEN v_code:='FOLLOW_UP_ACTIVE';
  ELSIF v_venue.rejection_reason IS NOT NULL OR v_venue.marked_called_at IS NOT NULL
     OR v_venue.duplicate_of_venue_id IS NOT NULL OR v_venue.cover_media_url IS NOT NULL
     OR v_venue.cover_media_poster_url IS NOT NULL OR v_venue.theme_color_override IS NOT NULL
     OR v_venue.theme_font_override IS NOT NULL OR v_venue.theme_animation_override IS NOT NULL THEN v_code:='POOL_INELIGIBLE';
  ELSIF v_venue.place_pool_id IS NULL THEN v_code:='POOL_INELIGIBLE'; END IF;
  IF v_code IS NULL THEN
    SELECT * INTO v_pool FROM public.place_pool WHERE id=v_venue.place_pool_id;
    IF NOT FOUND OR v_pool.is_active IS DISTINCT FROM true OR v_pool.is_claimed IS DISTINCT FROM true
       OR v_pool.is_servable IS DISTINCT FROM false OR v_pool.fetched_via IS DISTINCT FROM 'business_authored'
       OR v_pool.google_place_id IS NOT NULL OR v_pool.business_author_brand_id IS DISTINCT FROM v_venue.brand_id
       OR (v_pool.business_authoring_inputs IS NOT NULL AND jsonb_typeof(v_pool.business_authoring_inputs)<>'object')
       OR (v_pool.business_authoring_inputs ? 'tier1' AND v_pool.business_authoring_inputs->'tier1' IS NOT NULL
           AND jsonb_typeof(v_pool.business_authoring_inputs->'tier1')<>'object')
    THEN v_code:='POOL_INELIGIBLE'; END IF;
  END IF;
  IF v_code IS NULL THEN
    SELECT * INTO v_pipeline FROM public.brand_place_pipeline_state WHERE venue_id=v_venue.id;
    IF (v_pool.ai_signal_scores IS NOT NULL AND v_pool.ai_signal_scores<>'{}'::jsonb) THEN v_sensitive:=array_append(v_sensitive,'ai_signal_scores'); END IF;
    IF (v_pool.ai_signal_scores_veto IS NOT NULL AND v_pool.ai_signal_scores_veto<>'{}'::jsonb) THEN v_sensitive:=array_append(v_sensitive,'ai_signal_scores_veto'); END IF;
    IF (v_pool.photo_analysis IS NOT NULL AND v_pool.photo_analysis<>'{}'::jsonb) THEN v_sensitive:=array_append(v_sensitive,'photo_analysis'); END IF;
    IF (v_pool.photo_aesthetic_data IS NOT NULL AND v_pool.photo_aesthetic_data<>'{}'::jsonb) THEN v_sensitive:=array_append(v_sensitive,'photo_aesthetic_data'); END IF;
    IF (v_pool.photo_collage_url IS NOT NULL AND v_pool.photo_collage_url<>'') THEN v_sensitive:=array_append(v_sensitive,'photo_collage_url'); END IF;
    IF (v_pool.photo_collage_fingerprint IS NOT NULL AND v_pool.photo_collage_fingerprint<>'') THEN v_sensitive:=array_append(v_sensitive,'photo_collage_fingerprint'); END IF;
    IF (v_pipeline.last_error_message IS NOT NULL AND v_pipeline.last_error_message<>'') THEN v_sensitive:=array_append(v_sensitive,'last_error_message'); END IF;
    IF cardinality(v_sensitive)>0 THEN v_code:='SENSITIVE_STATE_NOT_EMPTY'; END IF;
  END IF;
  v_inv:=public.issue_2099_pending_venue_dependency_inventory(v_venue.id,v_venue.place_pool_id);
  IF v_code IS NULL AND v_inv->>'schema_fingerprint'<>('52f4624c994529d2e63b8f70b79a3fcf' || 'e28f3ff90dafe300bc45439e37cd2921') THEN v_code:='DEPENDENCY_SCHEMA_CHANGED'; END IF;
  SELECT COALESCE(sum((x->>'count')::bigint),0) INTO v_disallowed FROM jsonb_array_elements(COALESCE(v_inv->'lanes','[]')) x WHERE x->>'classification'='disallowed';
  IF v_code IS NULL AND v_disallowed>0 THEN v_code:='DEPENDENCY_NOT_EMPTY'; END IF;
  IF v_code IS NULL AND ((SELECT count(*) FROM public.brand_hours WHERE venue_id=v_venue.id AND brand_id=v_venue.brand_id)<>7
    OR (SELECT count(*) FROM public.brand_hours WHERE venue_id=v_venue.id)<>7
    OR (SELECT count(*) FROM public.brand_place_pipeline_state WHERE venue_id=v_venue.id AND brand_id=v_venue.brand_id AND place_pool_id=v_venue.place_pool_id)<>1
    OR (SELECT count(*) FROM public.venue_availability_config WHERE venue_id=v_venue.id AND brand_id=v_venue.brand_id AND place_pool_id=v_venue.place_pool_id)<>1
    OR (SELECT count(*) FROM public.venue_reservation_settings WHERE venue_id=v_venue.id AND brand_id=v_venue.brand_id AND place_pool_id=v_venue.place_pool_id)<>1)
  THEN v_code:='DEPENDENCY_NOT_EMPTY'; END IF;
  RETURN jsonb_build_object('ok',v_code IS NULL,'eligible',v_code IS NULL,'code',v_code,
    'venue_id',v_venue.id,'brand_id',v_venue.brand_id,'place_pool_id',v_venue.place_pool_id,
    'current',jsonb_build_object('name',v_venue.name,'slug',v_venue.slug,'category',v_venue.venue_category,'updated_at',v_venue.updated_at),
    'schema_fingerprint',v_inv->>'schema_fingerprint','state_fingerprint',v_inv->>'state_fingerprint',
    'dependency_counts',v_inv->'lanes','safe_fields',to_jsonb(v_sensitive));
END $$;
ALTER FUNCTION public.preview_pending_venue_identity_correction(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_pending_venue_identity_correction(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.preview_pending_venue_identity_correction(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_pending_venue_identity(
  p_venue_id uuid,
  p_expected_brand_id uuid,
  p_expected_place_pool_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_name text,
  p_expected_slug text,
  p_expected_category text,
  p_new_name text,
  p_new_slug text,
  p_new_category text,
  p_reason text,
  p_request_id uuid,
  p_expected_schema_fingerprint text,
  p_expected_state_fingerprint text,
  p_mode text DEFAULT 'forward',
  p_source_audit_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_uid uuid:=auth.uid();
  v_actor_kind text;
  v_venue public.venue_listings%ROWTYPE;
  v_pool public.place_pool%ROWTYPE;
  v_pipeline public.brand_place_pipeline_state%ROWTYPE;
  v_settings public.venue_reservation_settings%ROWTYPE;
  v_availability public.venue_availability_config%ROWTYPE;
  v_inv jsonb;
  v_existing public.venue_identity_correction_audit%ROWTYPE;
  v_source public.venue_identity_correction_audit%ROWTYPE;
  v_request_fingerprint text;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_sensitive text[]:='{}';
  v_disallowed bigint;
  v_rel record;
  v_inputs jsonb;
  v_old jsonb;
  v_primary_type text;
  v_types text[];
  v_audit_id uuid;
  v_seal_ok boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id=p_venue_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF public.is_admin_user() THEN v_actor_kind:='admin';
  ELSIF EXISTS (SELECT 1 FROM public.brand_team_members m WHERE m.brand_id=v_venue.brand_id AND m.user_id=v_uid
      AND m.role='brand_owner' AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL) THEN v_actor_kind:='brand_owner';
  ELSE RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORIZED'); END IF;

  v_request_fingerprint:=encode(extensions.digest(jsonb_build_object('actor',v_uid,'venue',p_venue_id,'expected_brand',p_expected_brand_id,
    'expected_pool',p_expected_place_pool_id,'expected_updated_at',p_expected_updated_at,'expected_name',p_expected_name,
    'expected_slug',p_expected_slug,'expected_category',p_expected_category,'new_name',p_new_name,'new_slug',p_new_slug,
    'new_category',p_new_category,'reason',p_reason,'mode',p_mode,'source_audit',p_source_audit_id,
    'schema',p_expected_schema_fingerprint,'state',p_expected_state_fingerprint)::text,'sha256'),'hex');
  SELECT * INTO v_existing FROM public.venue_identity_correction_audit WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.actor_uid=v_uid AND v_existing.corrected_venue_id=p_venue_id AND v_existing.request_fingerprint=v_request_fingerprint
      THEN RETURN v_existing.result; END IF;
    RETURN jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');
  END IF;
  IF p_mode NOT IN ('forward','rollback') OR (p_mode='forward' AND p_source_audit_id IS NOT NULL)
     OR (p_mode='rollback' AND p_source_audit_id IS NULL) THEN RETURN jsonb_build_object('ok',false,'code','REQUEST_CONFLICT'); END IF;
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REQUEST_CONFLICT'); END IF;
  IF length(btrim(COALESCE(p_new_name,''))) NOT BETWEEN 1 AND 80 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_NAME'); END IF;
  IF COALESCE(p_new_slug,'') !~ '^[a-z0-9]{1,32}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SLUG'); END IF;
  IF p_new_category NOT IN ('restaurant','play','creative_and_arts','stay') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CATEGORY'); END IF;
  IF btrim(COALESCE(p_reason,''))='' THEN RETURN jsonb_build_object('ok',false,'code','AUDIT_FAILED'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('issue-2099-pending-venue-identity-correction',0));
  SELECT * INTO v_venue FROM public.venue_listings WHERE id=p_venue_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF public.is_admin_user() THEN v_actor_kind:='admin';
  ELSIF NOT EXISTS (SELECT 1 FROM public.brand_team_members m WHERE m.brand_id=v_venue.brand_id AND m.user_id=v_uid
      AND m.role='brand_owner' AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)
    THEN RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORIZED'); END IF;
  -- Re-check under the issue lock: simultaneous byte-equivalent retries must
  -- return the first durable result rather than observe its later CAS state.
  SELECT * INTO v_existing FROM public.venue_identity_correction_audit WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.actor_uid=v_uid AND v_existing.corrected_venue_id=p_venue_id AND v_existing.request_fingerprint=v_request_fingerprint
      THEN RETURN v_existing.result; END IF;
    RETURN jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');
  END IF;
  IF v_venue.claim_status<>'pending_review' THEN RETURN jsonb_build_object('ok',false,'code','NOT_PENDING'); END IF;
  IF v_venue.claim_follow_up_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','FOLLOW_UP_ACTIVE'); END IF;
  IF v_venue.rejection_reason IS NOT NULL OR v_venue.marked_called_at IS NOT NULL OR v_venue.duplicate_of_venue_id IS NOT NULL
    OR v_venue.cover_media_url IS NOT NULL OR v_venue.cover_media_poster_url IS NOT NULL OR v_venue.theme_color_override IS NOT NULL
    OR v_venue.theme_font_override IS NOT NULL OR v_venue.theme_animation_override IS NOT NULL OR v_venue.place_pool_id IS NULL
    THEN RETURN jsonb_build_object('ok',false,'code','POOL_INELIGIBLE'); END IF;
  IF v_venue.brand_id IS DISTINCT FROM p_expected_brand_id OR v_venue.place_pool_id IS DISTINCT FROM p_expected_place_pool_id
    THEN RETURN jsonb_build_object('ok',false,'code','IDENTITY_MISMATCH'); END IF;
  IF v_venue.updated_at IS DISTINCT FROM p_expected_updated_at OR v_venue.name IS DISTINCT FROM p_expected_name
    OR v_venue.slug IS DISTINCT FROM p_expected_slug OR v_venue.venue_category IS DISTINCT FROM p_expected_category
    THEN RETURN jsonb_build_object('ok',false,'code','STALE_VERSION'); END IF;
  SELECT * INTO v_pool FROM public.place_pool WHERE id=v_venue.place_pool_id FOR UPDATE;
  IF NOT FOUND OR v_pool.is_active IS DISTINCT FROM true OR v_pool.is_claimed IS DISTINCT FROM true OR v_pool.is_servable IS DISTINCT FROM false
    OR v_pool.fetched_via IS DISTINCT FROM 'business_authored' OR v_pool.google_place_id IS NOT NULL
    OR v_pool.business_author_brand_id IS DISTINCT FROM v_venue.brand_id
    OR (v_pool.business_authoring_inputs IS NOT NULL AND jsonb_typeof(v_pool.business_authoring_inputs)<>'object')
    OR (v_pool.business_authoring_inputs ? 'tier1' AND v_pool.business_authoring_inputs->'tier1' IS NOT NULL
        AND jsonb_typeof(v_pool.business_authoring_inputs->'tier1')<>'object')
    THEN RETURN jsonb_build_object('ok',false,'code','POOL_INELIGIBLE'); END IF;

  LOCK TABLE public.issue_2099_dependency_schema_guard IN SHARE MODE NOWAIT;
  SELECT EXISTS(
    SELECT 1 FROM pg_catalog.pg_event_trigger et
    JOIN pg_catalog.pg_proc p ON p.oid=et.evtfoid
    JOIN pg_catalog.pg_roles er ON er.oid=et.evtowner
    JOIN pg_catalog.pg_roles pr ON pr.oid=p.proowner
    WHERE et.evtname='issue_2099_dependency_ddl_guard' AND et.evtevent='ddl_command_start'
      AND et.evtenabled IN ('O','A') AND et.evttags IS NULL
      AND p.oid='public.issue_2099_dependency_ddl_guard()'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
      AND er.rolname='postgres' AND pr.rolname='postgres'
  ) INTO v_seal_ok;
  IF NOT v_seal_ok THEN RETURN jsonb_build_object('ok',false,'code','DDL_SEAL_UNAVAILABLE'); END IF;

  v_inv:=public.issue_2099_pending_venue_dependency_inventory(v_venue.id,v_pool.id);
  IF v_inv->>'schema_fingerprint' IS DISTINCT FROM p_expected_schema_fingerprint
     OR v_inv->>'schema_fingerprint'<>('52f4624c994529d2e63b8f70b79a3fcf' || 'e28f3ff90dafe300bc45439e37cd2921')
    THEN RETURN jsonb_build_object('ok',false,'code','DEPENDENCY_SCHEMA_CHANGED'); END IF;
  FOR v_rel IN
    WITH relevant AS (
      SELECT DISTINCT n.nspname,c.relname
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attname IN ('venue_id','serving_venue_id','duplicate_of_venue_id','place_pool_id')
      UNION
      SELECT DISTINCT n.nspname,c.relname
      FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class ref ON ref.oid=con.confrelid
      WHERE con.contype='f' AND n.nspname='public' AND c.relkind IN ('r','p') AND ref.relname IN ('venue_listings','place_pool')
      UNION SELECT 'public',x FROM unnest(ARRAY['brand_hours','brand_place_pipeline_state','venue_availability_config','venue_reservation_settings']) x
    ) SELECT * FROM relevant ORDER BY nspname,relname
  LOOP EXECUTE format('LOCK TABLE %I.%I IN SHARE MODE NOWAIT',v_rel.nspname,v_rel.relname); END LOOP;

  PERFORM 1 FROM public.brand_hours WHERE venue_id=v_venue.id ORDER BY weekday,id FOR UPDATE;
  SELECT * INTO v_pipeline FROM public.brand_place_pipeline_state WHERE venue_id=v_venue.id FOR UPDATE;
  SELECT * INTO v_settings FROM public.venue_reservation_settings WHERE venue_id=v_venue.id FOR UPDATE;
  SELECT * INTO v_availability FROM public.venue_availability_config WHERE venue_id=v_venue.id FOR UPDATE;
  v_inv:=public.issue_2099_pending_venue_dependency_inventory(v_venue.id,v_pool.id);
  IF v_inv->>'schema_fingerprint' IS DISTINCT FROM p_expected_schema_fingerprint THEN RETURN jsonb_build_object('ok',false,'code','DEPENDENCY_SCHEMA_CHANGED'); END IF;
  IF v_inv->>'state_fingerprint' IS DISTINCT FROM p_expected_state_fingerprint THEN RETURN jsonb_build_object('ok',false,'code','STALE_VERSION'); END IF;
  SELECT COALESCE(sum((x->>'count')::bigint),0) INTO v_disallowed FROM jsonb_array_elements(v_inv->'lanes') x WHERE x->>'classification'='disallowed';
  IF v_disallowed>0 OR (SELECT count(*) FROM public.brand_hours WHERE venue_id=v_venue.id)<>7
    OR (SELECT count(*) FROM public.brand_hours WHERE venue_id=v_venue.id AND brand_id=v_venue.brand_id)<>7
    OR v_pipeline.id IS NULL OR v_pipeline.brand_id<>v_venue.brand_id OR v_pipeline.place_pool_id<>v_pool.id
    OR v_settings.venue_id IS NULL OR v_settings.brand_id<>v_venue.brand_id OR v_settings.place_pool_id<>v_pool.id
    OR v_availability.id IS NULL OR v_availability.brand_id<>v_venue.brand_id OR v_availability.place_pool_id<>v_pool.id
    THEN RETURN jsonb_build_object('ok',false,'code','DEPENDENCY_NOT_EMPTY'); END IF;
  IF (v_pool.ai_signal_scores IS NOT NULL AND v_pool.ai_signal_scores<>'{}') THEN v_sensitive:=array_append(v_sensitive,'ai_signal_scores'); END IF;
  IF (v_pool.ai_signal_scores_veto IS NOT NULL AND v_pool.ai_signal_scores_veto<>'{}') THEN v_sensitive:=array_append(v_sensitive,'ai_signal_scores_veto'); END IF;
  IF (v_pool.photo_analysis IS NOT NULL AND v_pool.photo_analysis<>'{}') THEN v_sensitive:=array_append(v_sensitive,'photo_analysis'); END IF;
  IF (v_pool.photo_aesthetic_data IS NOT NULL AND v_pool.photo_aesthetic_data<>'{}') THEN v_sensitive:=array_append(v_sensitive,'photo_aesthetic_data'); END IF;
  IF (v_pool.photo_collage_url IS NOT NULL AND v_pool.photo_collage_url<>'') THEN v_sensitive:=array_append(v_sensitive,'photo_collage_url'); END IF;
  IF (v_pool.photo_collage_fingerprint IS NOT NULL AND v_pool.photo_collage_fingerprint<>'') THEN v_sensitive:=array_append(v_sensitive,'photo_collage_fingerprint'); END IF;
  IF (v_pipeline.last_error_message IS NOT NULL AND v_pipeline.last_error_message<>'') THEN v_sensitive:=array_append(v_sensitive,'last_error_message'); END IF;
  IF cardinality(v_sensitive)>0 THEN RETURN jsonb_build_object('ok',false,'code','SENSITIVE_STATE_NOT_EMPTY','safe_fields',to_jsonb(v_sensitive)); END IF;
  IF p_mode='forward' AND p_new_category='stay' AND p_expected_category<>'stay'
    AND NOT COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key='STAY_VENUE_AUTHORING'),false)
    THEN RETURN jsonb_build_object('ok',false,'code','STAY_AUTHORING_DISABLED'); END IF;
  IF EXISTS (SELECT 1 FROM public.venue_listings WHERE brand_id=v_venue.brand_id AND slug=p_new_slug AND id<>v_venue.id)
    THEN RETURN jsonb_build_object('ok',false,'code','SLUG_COLLISION'); END IF;

  v_before:=jsonb_build_object(
    'venue',jsonb_build_object('name',v_venue.name,'slug',v_venue.slug,'category',v_venue.venue_category,'updated_at',v_venue.updated_at),
    'pool',jsonb_build_object('name',v_pool.name,'primary_type',v_pool.primary_type,'types',v_pool.types,'primary_type_display_name',v_pool.primary_type_display_name,
      'business_authoring_status',v_pool.business_authoring_status,'is_servable',v_pool.is_servable,'bouncer_reason',v_pool.bouncer_reason,'bouncer_validated_at',v_pool.bouncer_validated_at,
      'passes_pre_photo_check',v_pool.passes_pre_photo_check,'pre_photo_bouncer_reason',v_pool.pre_photo_bouncer_reason,'pre_photo_bouncer_validated_at',v_pool.pre_photo_bouncer_validated_at,
      'business_recommend_edit_count',v_pool.business_recommend_edit_count,'updated_at',v_pool.updated_at,
      'preserved_fingerprint',encode(extensions.digest(((to_jsonb(v_pool)-ARRAY['name','primary_type','types','primary_type_display_name','business_authoring_status','business_authoring_inputs','is_servable','bouncer_reason','bouncer_validated_at','passes_pre_photo_check','pre_photo_bouncer_reason','pre_photo_bouncer_validated_at','ai_signal_scores','ai_signal_scores_veto','photo_analysis','photo_aesthetic_data','photo_collage_url','photo_collage_fingerprint','business_recommend_edit_count','updated_at'])::text),'sha256'),'hex'),
      'inputs',jsonb_build_object('root_sql_null',v_pool.business_authoring_inputs IS NULL,'tier1_present',COALESCE(v_pool.business_authoring_inputs ? 'tier1',false),
        'tier1_sql_null',v_pool.business_authoring_inputs->'tier1' IS NULL,'name_present',COALESCE(v_pool.business_authoring_inputs->'tier1' ? 'name',false),'name',v_pool.business_authoring_inputs#>'{tier1,name}',
        'category_present',COALESCE(v_pool.business_authoring_inputs->'tier1' ? 'venueCategory',false),'category',v_pool.business_authoring_inputs#>'{tier1,venueCategory}'),
      'sensitive',jsonb_build_object('ai_signal_scores',CASE WHEN v_pool.ai_signal_scores IS NULL THEN 'sql_null' ELSE 'empty_object' END,
        'ai_signal_scores_veto',CASE WHEN v_pool.ai_signal_scores_veto IS NULL THEN 'sql_null' ELSE 'empty_object' END,
        'photo_analysis',CASE WHEN v_pool.photo_analysis IS NULL THEN 'sql_null' ELSE 'empty_object' END,
        'photo_aesthetic_data',CASE WHEN v_pool.photo_aesthetic_data IS NULL THEN 'sql_null' ELSE 'empty_object' END,
        'photo_collage_url',CASE WHEN v_pool.photo_collage_url IS NULL THEN 'sql_null' ELSE 'empty_string' END,
        'photo_collage_fingerprint',CASE WHEN v_pool.photo_collage_fingerprint IS NULL THEN 'sql_null' ELSE 'empty_string' END)),
    'pipeline',jsonb_build_object('id',v_pipeline.id,'status',v_pipeline.status,'tier1_completed_at',v_pipeline.tier1_completed_at,'tier2_completed_at',v_pipeline.tier2_completed_at,
      'stage_status',v_pipeline.stage_status,'bouncer_reasons',v_pipeline.bouncer_reasons,'last_error_code',v_pipeline.last_error_code,
      'last_error_message_empty',CASE WHEN v_pipeline.last_error_message IS NULL THEN 'sql_null' ELSE 'empty_string' END,'coaching',v_pipeline.coaching,'updated_at',v_pipeline.updated_at),
    'settings',to_jsonb(v_settings)-ARRAY['brand_id','place_pool_id','venue_id','created_at'],
    'availability',to_jsonb(v_availability)-ARRAY['brand_id','place_pool_id','venue_id','created_at'],
    'identity',jsonb_build_object('venue_id',v_venue.id,'brand_id',v_venue.brand_id,'place_pool_id',v_pool.id));

  IF p_mode='rollback' THEN
    SELECT * INTO v_source FROM public.venue_identity_correction_audit WHERE id=p_source_audit_id AND action='forward' FOR SHARE;
    IF NOT FOUND OR v_source.corrected_venue_id<>v_venue.id OR v_source.brand_id<>v_venue.brand_id OR v_source.corrected_place_pool_id<>v_pool.id
      THEN RETURN jsonb_build_object('ok',false,'code','REQUEST_CONFLICT'); END IF;
    IF v_before IS DISTINCT FROM v_source.after_state OR p_new_name IS DISTINCT FROM v_source.before_state#>>'{venue,name}'
      OR p_new_slug IS DISTINCT FROM v_source.before_state#>>'{venue,slug}' OR p_new_category IS DISTINCT FROM v_source.before_state#>>'{venue,category}'
      THEN RETURN jsonb_build_object('ok',false,'code','STALE_VERSION'); END IF;
    v_old:=v_source.before_state;
    v_inputs:=v_pool.business_authoring_inputs;
    IF (v_old#>>'{pool,inputs,root_sql_null}')::boolean THEN v_inputs:=NULL;
    ELSE
      v_inputs:=COALESCE(v_inputs,'{}'::jsonb);
      IF NOT (v_old#>>'{pool,inputs,tier1_present}')::boolean THEN v_inputs:=v_inputs-'tier1';
      ELSIF (v_old#>>'{pool,inputs,tier1_sql_null}')::boolean THEN v_inputs:=jsonb_set(v_inputs,'{tier1}','null'::jsonb,true);
      ELSE
        IF (v_old#>>'{pool,inputs,name_present}')::boolean THEN v_inputs:=jsonb_set(v_inputs,'{tier1,name}',v_old#>'{pool,inputs,name}',true); ELSE v_inputs:=v_inputs#-'{tier1,name}'; END IF;
        IF (v_old#>>'{pool,inputs,category_present}')::boolean THEN v_inputs:=jsonb_set(v_inputs,'{tier1,venueCategory}',v_old#>'{pool,inputs,category}',true); ELSE v_inputs:=v_inputs#-'{tier1,venueCategory}'; END IF;
      END IF;
    END IF;
    UPDATE public.venue_listings SET name=v_old#>>'{venue,name}',slug=v_old#>>'{venue,slug}',venue_category=v_old#>>'{venue,category}' WHERE id=v_venue.id;
    UPDATE public.place_pool SET name=v_old#>>'{pool,name}',primary_type=v_old#>>'{pool,primary_type}',
      types=ARRAY(SELECT jsonb_array_elements_text(v_old#>'{pool,types}')),primary_type_display_name=v_old#>>'{pool,primary_type_display_name}',
      business_authoring_status=v_old#>>'{pool,business_authoring_status}',business_authoring_inputs=v_inputs,is_servable=(v_old#>>'{pool,is_servable}')::boolean,
      bouncer_reason=v_old#>>'{pool,bouncer_reason}',bouncer_validated_at=(v_old#>>'{pool,bouncer_validated_at}')::timestamptz,
      passes_pre_photo_check=(v_old#>>'{pool,passes_pre_photo_check}')::boolean,pre_photo_bouncer_reason=v_old#>>'{pool,pre_photo_bouncer_reason}',
      pre_photo_bouncer_validated_at=(v_old#>>'{pool,pre_photo_bouncer_validated_at}')::timestamptz,
      ai_signal_scores=CASE v_old#>>'{pool,sensitive,ai_signal_scores}' WHEN 'empty_object' THEN '{}'::jsonb ELSE NULL END,
      ai_signal_scores_veto=CASE v_old#>>'{pool,sensitive,ai_signal_scores_veto}' WHEN 'empty_object' THEN '{}'::jsonb ELSE NULL END,
      photo_analysis=CASE v_old#>>'{pool,sensitive,photo_analysis}' WHEN 'empty_object' THEN '{}'::jsonb ELSE NULL END,
      photo_aesthetic_data=CASE v_old#>>'{pool,sensitive,photo_aesthetic_data}' WHEN 'empty_object' THEN '{}'::jsonb ELSE NULL END,
      photo_collage_url=CASE v_old#>>'{pool,sensitive,photo_collage_url}' WHEN 'empty_string' THEN '' ELSE NULL END,
      photo_collage_fingerprint=CASE v_old#>>'{pool,sensitive,photo_collage_fingerprint}' WHEN 'empty_string' THEN '' ELSE NULL END,
      business_recommend_edit_count=(v_old#>>'{pool,business_recommend_edit_count}')::integer WHERE id=v_pool.id;
    UPDATE public.brand_place_pipeline_state SET status=v_old#>>'{pipeline,status}',tier1_completed_at=(v_old#>>'{pipeline,tier1_completed_at}')::timestamptz,
      tier2_completed_at=(v_old#>>'{pipeline,tier2_completed_at}')::timestamptz,stage_status=v_old#>'{pipeline,stage_status}',
      bouncer_reasons=ARRAY(SELECT jsonb_array_elements_text(v_old#>'{pipeline,bouncer_reasons}')),last_error_code=v_old#>>'{pipeline,last_error_code}',
      last_error_message=CASE v_old#>>'{pipeline,last_error_message_empty}' WHEN 'empty_string' THEN '' ELSE NULL END,coaching=v_old#>'{pipeline,coaching}' WHERE id=v_pipeline.id;
    UPDATE public.venue_reservation_settings SET reservations_enabled=(v_old#>>'{settings,reservations_enabled}')::boolean,fee_enabled=(v_old#>>'{settings,fee_enabled}')::boolean,
      fee_amount_cents=(v_old#>>'{settings,fee_amount_cents}')::integer,fee_currency=v_old#>>'{settings,fee_currency}',fee_refundable=(v_old#>>'{settings,fee_refundable}')::boolean,
      cancel_cutoff_hours=(v_old#>>'{settings,cancel_cutoff_hours}')::integer,no_show_fee_policy=v_old#>>'{settings,no_show_fee_policy}',
      pass_fee_override=(v_old#>>'{settings,pass_fee_override}')::boolean,pass_tax_override=(v_old#>>'{settings,pass_tax_override}')::boolean WHERE venue_id=v_venue.id;
    UPDATE public.venue_availability_config SET service_periods=v_old#>'{availability,service_periods}',turn_times=v_old#>'{availability,turn_times}',
      buffer_minutes=(v_old#>>'{availability,buffer_minutes}')::integer,max_reservations_per_slot=(v_old#>>'{availability,max_reservations_per_slot}')::integer,
      slot_granularity_minutes=(v_old#>>'{availability,slot_granularity_minutes}')::integer,advance_window_days=(v_old#>>'{availability,advance_window_days}')::integer,
      min_notice_minutes=(v_old#>>'{availability,min_notice_minutes}')::integer WHERE venue_id=v_venue.id;
  ELSE
    SELECT CASE p_new_category WHEN 'restaurant' THEN 'restaurant' WHEN 'play' THEN 'amusement_center' WHEN 'creative_and_arts' THEN 'art_gallery' ELSE 'lodging' END,
      CASE p_new_category WHEN 'restaurant' THEN ARRAY['restaurant','food','point_of_interest'] WHEN 'play' THEN ARRAY['amusement_center']
        WHEN 'creative_and_arts' THEN ARRAY['art_gallery','point_of_interest'] ELSE ARRAY['lodging','point_of_interest','establishment'] END
      INTO v_primary_type,v_types;
    v_inputs:=COALESCE(v_pool.business_authoring_inputs,'{}'::jsonb);
    IF NOT (v_inputs ? 'tier1') OR v_inputs->'tier1' IS NULL THEN v_inputs:=jsonb_set(v_inputs,'{tier1}','{}'::jsonb,true); END IF;
    v_inputs:=jsonb_set(jsonb_set(v_inputs,'{tier1,name}',to_jsonb(btrim(p_new_name)),true),'{tier1,venueCategory}',to_jsonb(p_new_category),true);
    UPDATE public.venue_listings SET name=btrim(p_new_name),slug=p_new_slug,venue_category=p_new_category WHERE id=v_venue.id;
    UPDATE public.place_pool SET name=btrim(p_new_name),primary_type=v_primary_type,types=v_types,primary_type_display_name=NULL,
      business_authoring_status='processing',business_authoring_inputs=v_inputs,is_servable=false,bouncer_reason='pending_business_pipeline',bouncer_validated_at=NULL,
      passes_pre_photo_check=NULL,pre_photo_bouncer_reason=NULL,pre_photo_bouncer_validated_at=NULL,ai_signal_scores=NULL,ai_signal_scores_veto=NULL,
      photo_analysis=NULL,photo_aesthetic_data=NULL,photo_collage_url=NULL,photo_collage_fingerprint=NULL,business_recommend_edit_count=0 WHERE id=v_pool.id;
    UPDATE public.brand_place_pipeline_state SET status='processing',tier1_completed_at=NULL,tier2_completed_at=NULL,stage_status='{}',bouncer_reasons='{}',
      coaching='[]',last_error_code=NULL,last_error_message=NULL WHERE id=v_pipeline.id;
    UPDATE public.venue_reservation_settings SET reservations_enabled=false,fee_enabled=false,fee_amount_cents=NULL,fee_currency=NULL,fee_refundable=true,
      cancel_cutoff_hours=24,no_show_fee_policy='forfeit',pass_fee_override=NULL,pass_tax_override=NULL WHERE venue_id=v_venue.id;
    UPDATE public.venue_availability_config SET service_periods='[]',turn_times='{}',buffer_minutes=0,max_reservations_per_slot=NULL,
      slot_granularity_minutes=15,advance_window_days=30,min_notice_minutes=0 WHERE venue_id=v_venue.id;
  END IF;

  SELECT * INTO v_venue FROM public.venue_listings WHERE id=p_venue_id;
  SELECT * INTO v_pool FROM public.place_pool WHERE id=v_venue.place_pool_id;
  SELECT * INTO v_pipeline FROM public.brand_place_pipeline_state WHERE venue_id=v_venue.id;
  SELECT * INTO v_settings FROM public.venue_reservation_settings WHERE venue_id=v_venue.id;
  SELECT * INTO v_availability FROM public.venue_availability_config WHERE venue_id=v_venue.id;
  v_after:=jsonb_build_object(
    'venue',jsonb_build_object('name',v_venue.name,'slug',v_venue.slug,'category',v_venue.venue_category,'updated_at',v_venue.updated_at),
    'pool',jsonb_build_object('name',v_pool.name,'primary_type',v_pool.primary_type,'types',v_pool.types,'primary_type_display_name',v_pool.primary_type_display_name,
      'business_authoring_status',v_pool.business_authoring_status,'is_servable',v_pool.is_servable,'bouncer_reason',v_pool.bouncer_reason,'bouncer_validated_at',v_pool.bouncer_validated_at,
      'passes_pre_photo_check',v_pool.passes_pre_photo_check,'pre_photo_bouncer_reason',v_pool.pre_photo_bouncer_reason,'pre_photo_bouncer_validated_at',v_pool.pre_photo_bouncer_validated_at,
      'business_recommend_edit_count',v_pool.business_recommend_edit_count,'updated_at',v_pool.updated_at,
      'preserved_fingerprint',encode(extensions.digest(((to_jsonb(v_pool)-ARRAY['name','primary_type','types','primary_type_display_name','business_authoring_status','business_authoring_inputs','is_servable','bouncer_reason','bouncer_validated_at','passes_pre_photo_check','pre_photo_bouncer_reason','pre_photo_bouncer_validated_at','ai_signal_scores','ai_signal_scores_veto','photo_analysis','photo_aesthetic_data','photo_collage_url','photo_collage_fingerprint','business_recommend_edit_count','updated_at'])::text),'sha256'),'hex'),
      'inputs',jsonb_build_object('root_sql_null',v_pool.business_authoring_inputs IS NULL,'tier1_present',COALESCE(v_pool.business_authoring_inputs ? 'tier1',false),
        'tier1_sql_null',v_pool.business_authoring_inputs->'tier1' IS NULL,'name_present',COALESCE(v_pool.business_authoring_inputs->'tier1' ? 'name',false),'name',v_pool.business_authoring_inputs#>'{tier1,name}',
        'category_present',COALESCE(v_pool.business_authoring_inputs->'tier1' ? 'venueCategory',false),'category',v_pool.business_authoring_inputs#>'{tier1,venueCategory}'),
      'sensitive',jsonb_build_object('ai_signal_scores',CASE WHEN v_pool.ai_signal_scores IS NULL THEN 'sql_null' ELSE 'empty_object' END,
        'ai_signal_scores_veto',CASE WHEN v_pool.ai_signal_scores_veto IS NULL THEN 'sql_null' ELSE 'empty_object' END,
        'photo_analysis',CASE WHEN v_pool.photo_analysis IS NULL THEN 'sql_null' ELSE 'empty_object' END,
        'photo_aesthetic_data',CASE WHEN v_pool.photo_aesthetic_data IS NULL THEN 'sql_null' ELSE 'empty_object' END,
        'photo_collage_url',CASE WHEN v_pool.photo_collage_url IS NULL THEN 'sql_null' ELSE 'empty_string' END,
        'photo_collage_fingerprint',CASE WHEN v_pool.photo_collage_fingerprint IS NULL THEN 'sql_null' ELSE 'empty_string' END)),
    'pipeline',jsonb_build_object('id',v_pipeline.id,'status',v_pipeline.status,'tier1_completed_at',v_pipeline.tier1_completed_at,'tier2_completed_at',v_pipeline.tier2_completed_at,
      'stage_status',v_pipeline.stage_status,'bouncer_reasons',v_pipeline.bouncer_reasons,'last_error_code',v_pipeline.last_error_code,
      'last_error_message_empty',CASE WHEN v_pipeline.last_error_message IS NULL THEN 'sql_null' ELSE 'empty_string' END,
      'coaching',v_pipeline.coaching,'updated_at',v_pipeline.updated_at),
    'settings',to_jsonb(v_settings)-ARRAY['brand_id','place_pool_id','venue_id','created_at'],
    'availability',to_jsonb(v_availability)-ARRAY['brand_id','place_pool_id','venue_id','created_at'],
    'identity',jsonb_build_object('venue_id',v_venue.id,'brand_id',v_venue.brand_id,'place_pool_id',v_pool.id));
  v_audit_id:=gen_random_uuid();
  v_result:=jsonb_build_object('ok',true,'request_id',p_request_id,'audit_id',v_audit_id,'venue_id',v_venue.id,'brand_id',v_venue.brand_id,'place_pool_id',v_pool.id,
    'before',v_before->'venue','after',v_after->'venue','reset',jsonb_build_object('pipeline',true,'reservations',true,'availability',true));
  BEGIN
    INSERT INTO public.venue_identity_correction_audit(id,request_id,corrected_venue_id,brand_id,corrected_place_pool_id,actor_uid,actor_kind,action,source_audit_id,
      reason,request_fingerprint,schema_fingerprint,state_fingerprint,dependency_counts,before_state,after_state,result)
    VALUES(v_audit_id,p_request_id,v_venue.id,v_venue.brand_id,v_pool.id,v_uid,v_actor_kind,p_mode,p_source_audit_id,btrim(p_reason),v_request_fingerprint,
      v_inv->>'schema_fingerprint',v_inv->>'state_fingerprint',v_inv->'lanes',v_before,v_after,v_result);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P2099',MESSAGE='audit_failed'; END;
  RETURN v_result;
EXCEPTION
  WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','CORRECTION_BUSY');
  WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','SLUG_COLLISION');
  WHEN SQLSTATE 'P2099' THEN RETURN jsonb_build_object('ok',false,'code','AUDIT_FAILED');
  WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','AUDIT_FAILED');
END $$;
ALTER FUNCTION public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid) TO authenticated;

-- #2855 apply-time seal: approving today's reviewed schema may change only
-- the two public RPC pin comparisons. It never broadens the four-table baseline.
DO $issue_2855$
DECLARE
  v_preview_oid oid := 'public.preview_pending_venue_identity_correction(uuid)'::regprocedure;
  v_writer_oid oid := 'public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure;
  v_preview_def text;
  v_writer_def text;
  v_new_pin_left text := '52f4624c994529d2e63b8f70b79a3fcf';
  v_new_pin_right text := 'e28f3ff90dafe300bc45439e37cd2921';
  v_old_pin_left text := '9a8c2a743af413f17f3b3e75e4f656f3';
  v_old_pin_right text := 'e9cf3867cda091eb204bb9d5460f1ba0';
BEGIN
  SELECT pg_get_functiondef(v_preview_oid) INTO v_preview_def;
  SELECT pg_get_functiondef(v_writer_oid) INTO v_writer_def;

  IF position(v_new_pin_left IN v_preview_def) = 0
     OR position(v_new_pin_right IN v_preview_def) = 0
     OR position(v_new_pin_left IN v_writer_def) = 0
     OR position(v_new_pin_right IN v_writer_def) = 0
     OR position(v_old_pin_left IN v_preview_def) > 0
     OR position(v_old_pin_right IN v_preview_def) > 0
     OR position(v_old_pin_left IN v_writer_def) > 0
     OR position(v_old_pin_right IN v_writer_def) > 0 THEN
    RAISE EXCEPTION 'issue_2855_schema_pin_definition_mismatch';
  END IF;

  IF NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.oid = v_preview_oid
        AND n.nspname = 'public'
        AND r.rolname = 'postgres'
        AND p.prosecdef
        AND p.provolatile = 's'
        AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
    ) OR NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.oid = v_writer_oid
        AND n.nspname = 'public'
        AND r.rolname = 'postgres'
        AND p.prosecdef
        AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
    ) THEN
    RAISE EXCEPTION 'issue_2855_rpc_owner_security_or_config_mismatch';
  END IF;

  IF NOT has_function_privilege('authenticated', v_preview_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_writer_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_preview_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_writer_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_preview_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_writer_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_2855_rpc_application_grant_mismatch';
  END IF;
END
$issue_2855$;
