-- Issue #2830 — Website logo and cover validity on the local Sites stack.
--
-- The brand-context audit accepted only https media URLs. Production storage
-- is always https, but the local Sites stack serves storage over
-- http://127.0.0.1, so a real upload could never pass the logo/cover check
-- locally and end-to-end Website setup could not be certified. Loopback http
-- is accepted ONLY when the Sites service config row says environment='local'
-- (a row no migration can create; see the #2829 local-mode rails). Production
-- behaviour is unchanged: https only.

CREATE OR REPLACE FUNCTION public.brand_context_media_url_valid(p_url text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(p_url, '') ~ '^https://'
    OR (
      COALESCE(p_url, '') ~ '^http://(127[.]0[.]0[.]1|localhost)(:[0-9]+)?/'
      AND EXISTS (
        SELECT 1 FROM public.brand_site_service_config c
        WHERE c.environment = 'local'
      )
    );
$fn$;
REVOKE ALL ON FUNCTION public.brand_context_media_url_valid(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_context_media_url_valid(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.brand_context_completeness_internal(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_plan public.brand_site_plans%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_fields jsonb := '[]'::jsonb;
  v_social_present boolean;
  v_social_valid boolean;
  v_venue_selected boolean;
  v_required_gaps integer;
  v_recommended_gaps integer;
  v_verified integer;
  v_exceptions integer;
  v_validation_checks jsonb;
  v_failed_validation integer;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;

  v_social_present :=
    CASE WHEN jsonb_typeof(COALESCE(v_brand.social_links, '{}'::jsonb)) = 'object'
      THEN EXISTS (
        SELECT 1 FROM jsonb_each_text(COALESCE(v_brand.social_links, '{}'::jsonb)) e
        WHERE NULLIF(btrim(e.value), '') IS NOT NULL
      ) ELSE false END
    OR CASE WHEN jsonb_typeof(COALESCE(v_brand.custom_links, '[]'::jsonb)) = 'array'
      THEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_brand.custom_links, '[]'::jsonb)) e
        WHERE jsonb_typeof(e) = 'object'
          AND NULLIF(btrim(COALESCE(e->>'url','')), '') IS NOT NULL
      ) ELSE false END;
  v_social_valid :=
    CASE WHEN jsonb_typeof(COALESCE(v_brand.social_links, '{}'::jsonb)) = 'object'
      THEN NOT EXISTS (
        SELECT 1 FROM jsonb_each(COALESCE(v_brand.social_links, '{}'::jsonb)) e
        WHERE e.key NOT IN ('website','instagram','tiktok','x','facebook','youtube','linkedin','threads')
          OR jsonb_typeof(e.value) <> 'string'
          OR length(e.value#>>'{}') > 500 OR (e.value#>>'{}') !~ '^https://'
      ) ELSE false END
    AND CASE WHEN jsonb_typeof(COALESCE(v_brand.custom_links, '[]'::jsonb)) = 'array'
      THEN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_brand.custom_links, '[]'::jsonb)) e
        WHERE jsonb_typeof(e) <> 'object'
          OR NOT public.brand_site_json_keys_allowed(e,ARRAY['label','url'])
          OR jsonb_typeof(e->'label') <> 'string'
          OR jsonb_typeof(e->'url') <> 'string'
          OR length(btrim(COALESCE(e->>'label',''))) NOT BETWEEN 1 AND 80
          OR COALESCE(e->>'url','') !~ '^https://' OR length(COALESCE(e->>'url','')) > 1000
      ) ELSE false END;
  v_venue_selected := EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_plan.offerings_selected, ARRAY[]::text[])) item
    WHERE item LIKE 'venue_%'
  );

  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'name','Brand name','Identity','required',to_jsonb(v_brand.name),
    NULLIF(btrim(COALESCE(v_brand.name,'')),'') IS NOT NULL,
    length(btrim(COALESCE(v_brand.name,''))) BETWEEN 1 AND 80));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'description','Brand story','Identity','required',to_jsonb(v_brand.description),
    NULLIF(btrim(COALESCE(v_brand.description,'')),'') IS NOT NULL,
    length(COALESCE(v_brand.description,'')) <= 500));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'offerings_selected','What you offer','Offer','required',to_jsonb(v_plan.offerings_selected),
    v_plan.offerings_selected IS NOT NULL,true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'design_key','Website design','Design','required',
    to_jsonb(COALESCE(v_plan.design_key, v_site.design_key)),
    COALESCE(v_plan.design_key, v_site.design_key) IS NOT NULL,
    COALESCE(v_plan.design_key, v_site.design_key) IN ('atelier','voyage')));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'story.who','Who comes with you','Story','required',to_jsonb(v_plan.story->>'who'),
    NULLIF(btrim(COALESCE(v_plan.story->>'who','')),'') IS NOT NULL,
    length(COALESCE(v_plan.story->>'who','')) <= 300));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'story.why','Why they choose you','Story','required',to_jsonb(v_plan.story->>'why'),
    NULLIF(btrim(COALESCE(v_plan.story->>'why','')),'') IS NOT NULL,
    length(COALESCE(v_plan.story->>'why','')) <= 300));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'story.main_action','Main visitor action','Story','required',to_jsonb(v_plan.story->>'main_action'),
    NULLIF(btrim(COALESCE(v_plan.story->>'main_action','')),'') IS NOT NULL,
    length(COALESCE(v_plan.story->>'main_action','')) <= 300));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'approved_plan','Owner-approved plan','Approval','required',to_jsonb(v_plan.approved_plan),
    v_plan.approved_plan IS NOT NULL AND v_plan.approved_at IS NOT NULL,
    jsonb_typeof(v_plan.approved_plan) = 'object'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'venue_descriptor','Venue description','Offer',
    CASE WHEN v_venue_selected THEN 'recommended' ELSE 'optional' END,
    to_jsonb(v_plan.venue_descriptor),
    NULLIF(btrim(COALESCE(v_plan.venue_descriptor,'')),'') IS NOT NULL,
    length(COALESCE(v_plan.venue_descriptor,'')) <= 60));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'contact_email','Contact email','Contact','recommended',to_jsonb(v_brand.contact_email),
    NULLIF(btrim(COALESCE(v_brand.contact_email,'')),'') IS NOT NULL,
    COALESCE(v_brand.contact_email,'') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'contact_phone','Contact phone','Contact','recommended',to_jsonb(v_brand.contact_phone),
    NULLIF(btrim(COALESCE(v_brand.contact_phone,'')),'') IS NOT NULL,
    COALESCE(v_brand.contact_phone,'') ~ '^\+[1-9][0-9]{7,14}$'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'address','Address','Location','recommended',to_jsonb(v_brand.address),
    NULLIF(btrim(COALESCE(v_brand.address,'')),'') IS NOT NULL,
    length(COALESCE(v_brand.address,'')) <= 240));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'city_country','City and country','Location','recommended',
    jsonb_build_object('city',v_brand.city,'country_code',v_brand.country_code),
    NULLIF(btrim(COALESCE(v_brand.city,'')),'') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_brand.country_code,'')),'') IS NOT NULL,
    length(COALESCE(v_brand.city,'')) <= 120
      AND COALESCE(v_brand.country_code,'') ~ '^[A-Z]{2}$'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'social_links','Public website or social link','Links','recommended',
    jsonb_build_object(
      'social_links',COALESCE(v_brand.social_links,'{}'::jsonb),
      'custom_links',COALESCE(v_brand.custom_links,'[]'::jsonb)),
    v_social_present,v_social_valid));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'profile_photo','Brand logo','Media','recommended',to_jsonb(v_brand.profile_photo_url),
    NULLIF(btrim(COALESCE(v_brand.profile_photo_url,'')),'') IS NOT NULL,
    public.brand_context_media_url_valid(v_brand.profile_photo_url),true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'cover_media','Cover media','Media','recommended',to_jsonb(v_brand.cover_media_url),
    NULLIF(btrim(COALESCE(v_brand.cover_media_url,'')),'') IS NOT NULL,
    public.brand_context_media_url_valid(v_brand.cover_media_url),true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'theme','Mingla page theme','Design','recommended',
    jsonb_build_object('color',v_brand.theme_color,'font',v_brand.theme_font,'animation',v_brand.theme_animation),
    v_brand.theme_color IS NOT NULL OR v_brand.theme_font IS NOT NULL OR v_brand.theme_animation IS NOT NULL,
    (v_brand.theme_color IS NULL OR v_brand.theme_color ~ '^#[0-9a-fA-F]{6}$')
      AND (v_brand.theme_font IS NULL OR v_brand.theme_font IN (
        'inter','poppins','space_grotesk','plus_jakarta_sans','manrope','playfair_display',
        'dm_serif_display','fraunces','lora','bebas_neue','anton','unbounded','caveat','dancing_script'))
      AND (v_brand.theme_animation IS NULL OR v_brand.theme_animation IN (
        'none','confetti','fireworks','balloons','sparkles','glitter_shower',
        'snowfall','falling_petals','hearts','shimmer_reveal'))));

  v_validation_checks := jsonb_build_array(
    jsonb_build_object(
      'key','field_shapes','label','Field formats and allowed values',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement' <> 'optional' AND item->>'state'='invalid'
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','evidence_freshness','label','Evidence freshness and conflicts',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement' <> 'optional'
          AND item->>'state' IN ('stale','conflict')
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','required_dependencies','label','Required plan dependencies',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement'='required' AND item->>'state'<>'verified'
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','recommended_readiness','label','Recommended Website context',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement'='recommended'
          AND item->>'state' NOT IN ('verified','not_applicable')
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','human_handoffs','label','Owner media and file handoffs',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE COALESCE((item->>'human_action_required')::boolean,false)
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','cross_field_alignment','label','Cross-field and plan alignment',
      'state',CASE WHEN
        (v_venue_selected AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fields) item
          WHERE item->>'key'='venue_descriptor'
            AND item->>'state' IN ('verified','not_applicable')))
        OR (NULLIF(btrim(COALESCE(v_brand.address,'')),'') IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fields) item
          WHERE item->>'key'='city_country'
            AND item->>'state' IN ('verified','not_applicable')))
        OR (v_plan.approved_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fields) item
          WHERE item->>'key' IN (
            'offerings_selected','design_key','story.who','story.why','story.main_action')
            AND item->>'state'<>'verified'))
      THEN 'fail' ELSE 'pass' END)
  );
  SELECT count(*) INTO v_failed_validation
  FROM jsonb_array_elements(v_validation_checks) check_item
  WHERE check_item->>'state' <> 'pass';

  SELECT count(*) FILTER (
      WHERE item->>'requirement' = 'required' AND item->>'state' <> 'verified'
    ),
    count(*) FILTER (
      WHERE item->>'requirement' = 'recommended'
        AND item->>'state' NOT IN ('verified','not_applicable')
    ),
    count(*) FILTER (WHERE item->>'state' = 'verified'),
    count(*) FILTER (WHERE item->>'state' = 'not_applicable')
  INTO v_required_gaps, v_recommended_gaps, v_verified, v_exceptions
  FROM jsonb_array_elements(v_fields) item;

  RETURN jsonb_build_object(
    'revision', COALESCE(v_plan.revision, 0),
    'context_revision', public.brand_context_revision(p_brand_id),
    'design_key', COALESCE(v_plan.design_key, v_site.design_key),
    'fields', v_fields,
    'required_gap_count', v_required_gaps,
    'recommended_gap_count', v_recommended_gaps,
    'gap_count', v_required_gaps + v_recommended_gaps,
    'verified_count', v_verified,
    'exception_count', v_exceptions,
    'validation_checks', v_validation_checks,
    'failed_validation_count', v_failed_validation,
    'minimum_complete', v_required_gaps = 0,
    'context_complete', v_required_gaps = 0 AND v_recommended_gaps = 0
      AND v_failed_validation = 0,
    'checked_at', now()
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_context_completeness_internal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_context_completeness_internal(uuid)
  TO service_role;
