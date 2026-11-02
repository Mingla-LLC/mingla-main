-- Issue #2830 — Ari brand-context saves bind to the confirmed proposal.
--
-- ari_update_brand_context (20280216002830) passed agent_operation_receipt_begin
-- a rebuilt subset of the proposal (no why, no cites, exceptions always set),
-- while the receipt compares against the full confirmed agent_pending_actions
-- tool_args. Every confirmed update_brand_context therefore failed with
-- operation_binding_mismatch. Same signature and grants; only the binding changes.

CREATE OR REPLACE FUNCTION public.ari_update_brand_context(
  p_operation_id uuid,
  p_brand_id uuid,
  p_expected_plan_revision integer,
  p_expected_context_revision text,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_exceptions jsonb DEFAULT '[]'::jsonb,
  p_evidence jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.brand_site_plans%ROWTYPE;
  v_current_context_revision text;
  v_begin jsonb;
  v_result jsonb;
  v_receipt_args jsonb;
  v_confirmed_args jsonb;
  v_source_type text := COALESCE(NULLIF(p_evidence->>'source_type',''),'owner');
  v_source_ref text := NULLIF(btrim(COALESCE(p_evidence->>'source_ref','')),'');
  v_source_url text := NULLIF(btrim(COALESCE(p_evidence->>'source_url','')),'');
  v_observed_at timestamptz;
  v_key text;
  v_field_key text;
  v_exception jsonb;
  v_reason text;
BEGIN
  IF v_actor IS NULL OR NOT public.biz_is_brand_admin_plus_for_caller(p_brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_patch) <> 'object' OR jsonb_typeof(p_exceptions) <> 'array'
    OR jsonb_typeof(p_evidence) <> 'object'
    OR NOT public.brand_site_json_keys_allowed(p_patch,ARRAY[
      'name','description','contact_email','contact_phone','address','city',
      'country_code','social_links','custom_links','theme'])
    OR NOT public.brand_site_json_keys_allowed(p_evidence,ARRAY[
      'source_type','source_ref','source_url','observed_at'])
    OR (p_patch = '{}'::jsonb AND p_exceptions = '[]'::jsonb) THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
      SELECT 1 FROM jsonb_each(p_patch) entry
      WHERE (entry.key='name' AND jsonb_typeof(entry.value)<>'string')
        OR (entry.key IN (
          'description','contact_email','contact_phone','address','city','country_code')
          AND jsonb_typeof(entry.value) NOT IN ('string','null'))
        OR (entry.key IN ('social_links','theme')
          AND jsonb_typeof(entry.value) NOT IN ('object','null'))
        OR (entry.key='custom_links'
          AND jsonb_typeof(entry.value) NOT IN ('array','null'))
    )
    OR NOT (p_evidence ? 'source_type')
    OR jsonb_typeof(p_evidence->'source_type') <> 'string'
    OR (p_evidence ? 'source_ref' AND jsonb_typeof(p_evidence->'source_ref') <> 'string')
    OR (p_evidence ? 'source_url' AND jsonb_typeof(p_evidence->'source_url') <> 'string')
    OR (p_evidence ? 'observed_at' AND jsonb_typeof(p_evidence->'observed_at') <> 'string') THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF v_source_type NOT IN ('mingla','owner','public_research','imported')
    OR length(COALESCE(v_source_ref,'')) > 300
    OR (v_source_url IS NOT NULL AND (length(v_source_url) > 1000 OR v_source_url !~ '^https://'))
    OR (v_source_type = 'public_research' AND v_source_url IS NULL) THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_observed_at := COALESCE(NULLIF(p_evidence->>'observed_at','')::timestamptz,now());
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END;
  IF v_observed_at < timestamptz '2000-01-01 00:00:00+00'
    OR v_observed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_exceptions) > 9 THEN
    RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
  END IF;
  FOR v_exception IN SELECT value FROM jsonb_array_elements(p_exceptions) LOOP
    IF jsonb_typeof(v_exception) <> 'object'
      OR NOT public.brand_site_json_keys_allowed(v_exception,ARRAY['field_key','reason'])
      OR jsonb_typeof(v_exception->'field_key') <> 'string'
      OR jsonb_typeof(v_exception->'reason') <> 'string' THEN
      RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
    END IF;
    v_field_key := v_exception->>'field_key';
    v_reason := NULLIF(btrim(COALESCE(v_exception->>'reason','')),'');
    IF v_field_key NOT IN (
      'venue_descriptor','contact_email','contact_phone','address','city_country',
      'social_links','profile_photo','cover_media','theme')
      OR v_reason IS NULL OR length(v_reason) > 500
      OR (v_field_key='contact_email' AND p_patch ? 'contact_email')
      OR (v_field_key='contact_phone' AND p_patch ? 'contact_phone')
      OR (v_field_key='address' AND p_patch ? 'address')
      OR (v_field_key='city_country' AND (p_patch ? 'city' OR p_patch ? 'country_code'))
      OR (v_field_key='social_links' AND (p_patch ? 'social_links' OR p_patch ? 'custom_links'))
      OR (v_field_key='theme' AND p_patch ? 'theme') THEN
      RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_exceptions)) <>
    (SELECT count(DISTINCT item->>'field_key') FROM jsonb_array_elements(p_exceptions) item) THEN
    RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
  END IF;

  -- #2830: the operation receipt binds to the EXACT proposal the owner
  -- confirmed, which also carries the readable why and its citations. The
  -- original rebuilt a partial copy without them, so agent_operation_receipt_begin
  -- refused every Ari brand-context save as operation_binding_mismatch. Every
  -- value this function writes must still equal the confirmed proposal.
  SELECT tool_args INTO v_confirmed_args
    FROM public.agent_pending_actions
   WHERE id = p_operation_id
     AND user_id = auth.uid()
     AND tool_name = 'update_brand_context';
  IF v_confirmed_args IS NULL
    OR v_confirmed_args->>'brand_id' IS DISTINCT FROM p_brand_id::text
    OR v_confirmed_args->'expected_plan_revision'
      IS DISTINCT FROM to_jsonb(p_expected_plan_revision)
    OR v_confirmed_args->>'expected_context_revision'
      IS DISTINCT FROM p_expected_context_revision
    OR COALESCE(v_confirmed_args->'patch','{}'::jsonb) IS DISTINCT FROM p_patch
    OR COALESCE(v_confirmed_args->'exceptions','[]'::jsonb)
      IS DISTINCT FROM p_exceptions
    OR COALESCE(v_confirmed_args->'evidence','{}'::jsonb) IS DISTINCT FROM p_evidence THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;
  v_receipt_args := v_confirmed_args;
  v_begin := public.agent_operation_receipt_begin(
    p_operation_id,'update_brand_context',v_receipt_args);
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result'; END IF;

  SELECT * INTO v_plan FROM public.brand_site_plans
  WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.brand_id IS NULL OR p_expected_plan_revision IS NULL
    OR p_expected_plan_revision <> v_plan.revision THEN
    RAISE EXCEPTION 'sites_revision_conflict';
  END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN RAISE EXCEPTION 'sites_plan_locked'; END IF;
  PERFORM 1 FROM public.brands
  WHERE id=p_brand_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  PERFORM 1 FROM public.brand_context_field_evidence
  WHERE brand_id=p_brand_id FOR UPDATE;
  v_current_context_revision := public.brand_context_revision(p_brand_id);
  IF p_expected_context_revision IS NULL
    OR p_expected_context_revision !~ '^[0-9a-f]{64}$'
    OR p_expected_context_revision <> v_current_context_revision THEN
    RAISE EXCEPTION 'sites_context_revision_conflict';
  END IF;

  IF p_patch ? 'name' AND length(btrim(COALESCE(p_patch->>'name',''))) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid_brand_name' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'description' AND length(COALESCE(p_patch->>'description','')) > 500 THEN
    RAISE EXCEPTION 'invalid_description' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'contact_email' AND jsonb_typeof(p_patch->'contact_email') <> 'null'
    AND COALESCE(p_patch->>'contact_email','') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_contact_email' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'contact_phone' AND jsonb_typeof(p_patch->'contact_phone') <> 'null'
    AND COALESCE(p_patch->>'contact_phone','') !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'invalid_contact_phone' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'address' AND length(COALESCE(p_patch->>'address','')) > 240 THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'city' AND length(COALESCE(p_patch->>'city','')) > 120 THEN
    RAISE EXCEPTION 'invalid_city' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'country_code' AND jsonb_typeof(p_patch->'country_code') <> 'null'
    AND upper(COALESCE(p_patch->>'country_code','')) !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid_country_code' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'social_links' AND jsonb_typeof(p_patch->'social_links') <> 'null' AND (
    jsonb_typeof(p_patch->'social_links') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_each(p_patch->'social_links') e
      WHERE e.key NOT IN ('website','instagram','tiktok','x','facebook','youtube','linkedin','threads')
        OR jsonb_typeof(e.value) <> 'string'
        OR length(e.value#>>'{}') > 500 OR (e.value#>>'{}') !~ '^https://'
    )) THEN RAISE EXCEPTION 'invalid_social_links' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'custom_links' AND jsonb_typeof(p_patch->'custom_links') <> 'null' AND (
    jsonb_typeof(p_patch->'custom_links') <> 'array'
    OR jsonb_array_length(p_patch->'custom_links') > 10 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_patch->'custom_links') e
      WHERE jsonb_typeof(e) <> 'object'
        OR NOT public.brand_site_json_keys_allowed(e,ARRAY['label','url'])
        OR jsonb_typeof(e->'label') <> 'string'
        OR jsonb_typeof(e->'url') <> 'string'
        OR length(btrim(COALESCE(e->>'label',''))) NOT BETWEEN 1 AND 80
        OR COALESCE(e->>'url','') !~ '^https://' OR length(e->>'url') > 1000
    )) THEN RAISE EXCEPTION 'invalid_custom_links' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'theme' AND jsonb_typeof(p_patch->'theme') <> 'null' AND (
    jsonb_typeof(p_patch->'theme') <> 'object'
    OR NOT public.brand_site_json_keys_allowed(p_patch->'theme',ARRAY['color','font','animation'])
    OR ((p_patch->'theme' ? 'color') AND jsonb_typeof(p_patch->'theme'->'color') <> 'null'
      AND COALESCE(p_patch#>>'{theme,color}','') !~ '^#[0-9a-fA-F]{6}$')
    OR ((p_patch->'theme' ? 'font') AND jsonb_typeof(p_patch->'theme'->'font') <> 'null'
      AND COALESCE(p_patch#>>'{theme,font}','') NOT IN (
        'inter','poppins','space_grotesk','plus_jakarta_sans','manrope','playfair_display',
        'dm_serif_display','fraunces','lora','bebas_neue','anton','unbounded','caveat','dancing_script'))
    OR ((p_patch->'theme' ? 'animation') AND jsonb_typeof(p_patch->'theme'->'animation') <> 'null'
      AND COALESCE(p_patch#>>'{theme,animation}','') NOT IN (
        'none','confetti','fireworks','balloons','sparkles','glitter_shower',
        'snowfall','falling_petals','hearts','shimmer_reveal'))
    ) THEN RAISE EXCEPTION 'invalid_theme' USING ERRCODE = '22023'; END IF;

  UPDATE public.brands b SET
    name = CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE b.name END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(btrim(COALESCE(p_patch->>'description','')),'') ELSE b.description END,
    contact_email = CASE WHEN p_patch ? 'contact_email' THEN NULLIF(btrim(COALESCE(p_patch->>'contact_email','')),'') ELSE b.contact_email END,
    contact_phone = CASE WHEN p_patch ? 'contact_phone' THEN NULLIF(btrim(COALESCE(p_patch->>'contact_phone','')),'') ELSE b.contact_phone END,
    address = CASE WHEN p_patch ? 'address' THEN NULLIF(btrim(COALESCE(p_patch->>'address','')),'') ELSE b.address END,
    city = CASE WHEN p_patch ? 'city' THEN NULLIF(btrim(COALESCE(p_patch->>'city','')),'') ELSE b.city END,
    country_code = CASE WHEN p_patch ? 'country_code' THEN NULLIF(upper(btrim(COALESCE(p_patch->>'country_code',''))),'') ELSE b.country_code END,
    social_links = CASE WHEN p_patch ? 'social_links' THEN COALESCE(p_patch->'social_links','{}'::jsonb) ELSE b.social_links END,
    custom_links = CASE WHEN p_patch ? 'custom_links' THEN COALESCE(p_patch->'custom_links','[]'::jsonb) ELSE b.custom_links END,
    theme_color = CASE WHEN p_patch ? 'theme' THEN NULLIF(p_patch#>>'{theme,color}','') ELSE b.theme_color END,
    theme_font = CASE WHEN p_patch ? 'theme' THEN NULLIF(p_patch#>>'{theme,font}','') ELSE b.theme_font END,
    theme_animation = CASE WHEN p_patch ? 'theme' THEN NULLIF(p_patch#>>'{theme,animation}','') ELSE b.theme_animation END,
    updated_at = now()
  WHERE b.id = p_brand_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    v_field_key := CASE v_key
      WHEN 'city' THEN 'city_country' WHEN 'country_code' THEN 'city_country'
      WHEN 'theme' THEN 'theme' WHEN 'social_links' THEN 'social_links'
      WHEN 'custom_links' THEN 'social_links' ELSE v_key END;
    INSERT INTO public.brand_context_field_evidence(
      brand_id,field_key,disposition,source_type,source_ref,source_url,
      observed_at,owner_confirmed_at,updated_at,updated_by
    ) VALUES (
      p_brand_id,v_field_key,'verified',v_source_type,v_source_ref,v_source_url,
      v_observed_at,now(),now(),v_actor
    ) ON CONFLICT (brand_id,field_key) DO UPDATE SET
      disposition='verified',source_type=EXCLUDED.source_type,
      source_ref=EXCLUDED.source_ref,source_url=EXCLUDED.source_url,
      observed_at=EXCLUDED.observed_at,owner_confirmed_at=EXCLUDED.owner_confirmed_at,
      exception_reason=NULL,evidence_candidates='[]'::jsonb,
      recheck_fingerprint=NULL,updated_at=now(),updated_by=v_actor;
  END LOOP;

  FOR v_exception IN SELECT value FROM jsonb_array_elements(p_exceptions) LOOP
    v_field_key := v_exception->>'field_key';
    v_reason := NULLIF(btrim(COALESCE(v_exception->>'reason','')),'');
    INSERT INTO public.brand_context_field_evidence(
      brand_id,field_key,disposition,source_type,source_ref,source_url,
      observed_at,owner_confirmed_at,exception_reason,recheck_fingerprint,
      updated_at,updated_by
    ) VALUES (
      p_brand_id,v_field_key,'not_applicable','owner',NULL,NULL,
      now(),now(),v_reason,
      public.brand_context_recheck_fingerprint(p_brand_id,v_field_key),
      now(),v_actor
    ) ON CONFLICT (brand_id,field_key) DO UPDATE SET
      disposition='not_applicable',source_type='owner',source_ref=NULL,source_url=NULL,
      observed_at=now(),owner_confirmed_at=now(),exception_reason=EXCLUDED.exception_reason,
      evidence_candidates='[]'::jsonb,
      recheck_fingerprint=EXCLUDED.recheck_fingerprint,
      updated_at=now(),updated_by=v_actor;
  END LOOP;

  UPDATE public.brand_site_plans SET
    revision = revision + 1,lock_holder=v_actor,
    lock_expires_at=now()+interval '10 minutes',updated_at=now(),updated_by=v_actor
  WHERE brand_id=p_brand_id;
  v_result := jsonb_build_object(
    'brand_id',p_brand_id,'plan_revision',v_plan.revision+1,
    'completeness',public.brand_context_completeness_internal(p_brand_id));
  RETURN public.agent_operation_receipt_complete(
    p_operation_id,'update_brand_context',v_receipt_args,v_result);
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_update_brand_context(uuid,uuid,integer,text,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_update_brand_context(uuid,uuid,integer,text,jsonb,jsonb,jsonb)
  TO authenticated, service_role;
