-- Issue #4453 PR 4 (design platform + Voyage): one list of website design keys.
--
-- Invariant I-SITES-DESIGN-KEYS-ONE-LIST (owned by its pg17 test): design keys come from
-- packages/site-contracts DESIGN_KEYS; Core's brand_site_design_keys(), the
-- brand_site_plans CHECK, brand_site_plan_save_design and
-- brand_context_completeness_internal all read the one function, and the pg17
-- test pins it to the generated fixture (issue_4453_design_keys.fixture.sql).
--
-- What changes:
-- 1. public.brand_site_design_keys() (IMMUTABLE, text[]) returns atelier and voyage.
--    Each later design PR (#4453 6a-c) replaces only this function.
-- 2. brand_site_plans_design_key_check reads it instead of a literal list.
-- 3. brand_site_plan_save_design (latest: 20280216002830) and
--    brand_context_completeness_internal (latest: 20280430011023) are
--    re-issued verbatim except for the design-key test, which calls it.
-- Static SQL only. No data changes: every stored design_key is atelier, voyage or NULL.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.brand_site_design_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['atelier','voyage']::text[]
$function$;

COMMENT ON FUNCTION public.brand_site_design_keys() IS
  '#4453 I-SITES-DESIGN-KEYS-ONE-LIST: the website design keys, equal to site-contracts DESIGN_KEYS. Replaced (never edited) by each design PR.';

REVOKE ALL ON FUNCTION public.brand_site_design_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.brand_site_design_keys() TO anon, authenticated, service_role;

ALTER TABLE public.brand_site_plans
  DROP CONSTRAINT IF EXISTS brand_site_plans_design_key_check;
ALTER TABLE public.brand_site_plans
  ADD CONSTRAINT brand_site_plans_design_key_check
    CHECK (design_key IS NULL OR design_key = ANY (public.brand_site_design_keys()));

-- Re-issued from 20280216002830 with the key list read from brand_site_design_keys().
CREATE OR REPLACE FUNCTION public.brand_site_plan_save_design(
  p_brand_id uuid,
  p_revision integer,
  p_design_key text,
  p_source_type text DEFAULT 'owner',
  p_source_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.brand_site_plans%ROWTYPE;
BEGIN
  PERFORM public.brand_site_plan_gate(p_brand_id, 50);
  IF p_design_key IS NULL OR NOT (p_design_key = ANY(public.brand_site_design_keys()))
    OR p_source_type NOT IN ('mingla','owner','public_research','imported')
    OR (p_source_url IS NOT NULL AND (length(p_source_url) > 1000 OR p_source_url !~ '^https://'))
    OR (p_source_type = 'public_research' AND p_source_url IS NULL) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  INSERT INTO public.brand_site_plans(brand_id, started_by, updated_by, offerings_selected)
  VALUES (p_brand_id, v_actor, v_actor, public.brand_site_plan_prefill_offerings(p_brand_id))
  ON CONFLICT (brand_id) DO NOTHING;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id FOR UPDATE;
  IF p_revision IS NULL OR p_revision <> v_plan.revision THEN
    RAISE EXCEPTION 'sites_revision_conflict';
  END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN
    RAISE EXCEPTION 'sites_plan_locked';
  END IF;
  UPDATE public.brand_site_plans SET
    design_key = p_design_key,
    approved_plan = CASE WHEN design_key IS DISTINCT FROM p_design_key THEN NULL ELSE approved_plan END,
    approved_at = CASE WHEN design_key IS DISTINCT FROM p_design_key THEN NULL ELSE approved_at END,
    approved_by = CASE WHEN design_key IS DISTINCT FROM p_design_key THEN NULL ELSE approved_by END,
    revision = revision + 1,
    lock_holder = v_actor,
    lock_expires_at = now() + interval '10 minutes',
    updated_at = now(),
    updated_by = v_actor
  WHERE brand_id = p_brand_id;
  INSERT INTO public.brand_context_field_evidence(
    brand_id, field_key, disposition, source_type, source_url,
    observed_at, owner_confirmed_at, updated_at, updated_by
  ) VALUES (
    p_brand_id, 'design_key', 'verified', p_source_type, p_source_url,
    now(), CASE WHEN p_source_type='owner' THEN now() ELSE NULL END, now(), v_actor
  ) ON CONFLICT (brand_id, field_key) DO UPDATE SET
    disposition = 'verified', source_type = EXCLUDED.source_type,
    source_url = EXCLUDED.source_url, observed_at = EXCLUDED.observed_at,
    owner_confirmed_at = EXCLUDED.owner_confirmed_at,
    exception_reason = NULL, evidence_candidates = '[]'::jsonb,
    recheck_fingerprint = NULL,
    updated_at = now(), updated_by = v_actor;
  INSERT INTO public.brand_site_audit_log(
    site_id,brand_id,actor_user_id,actor_kind,action,resource_kind,resource_id,metadata
  ) VALUES (
    (SELECT id FROM public.brand_sites WHERE brand_id = p_brand_id),
    p_brand_id,v_actor,'user','plan.saved','brand_site_plan',p_brand_id::text,
    jsonb_build_object('revision',v_plan.revision + 1,'fields',jsonb_build_array('design_key'))
  );
  RETURN public.brand_site_plan_get(p_brand_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.brand_site_plan_save_design(uuid,integer,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_save_design(uuid,integer,text,text,text)
  TO authenticated, service_role;

-- Re-issued from 20280430011023 with the key list read from brand_site_design_keys().
CREATE OR REPLACE FUNCTION public.brand_context_completeness_internal(p_brand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
    COALESCE(v_plan.design_key, v_site.design_key) = ANY(public.brand_site_design_keys())));
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
    jsonb_build_object('color',v_brand.theme_color,'font',v_brand.theme_font,'animation',v_brand.theme_animation,'gradient',v_brand.theme_gradient),
    v_brand.theme_color IS NOT NULL OR v_brand.theme_font IS NOT NULL OR v_brand.theme_animation IS NOT NULL,
    (v_brand.theme_color IS NULL OR v_brand.theme_color ~ '^#[0-9a-fA-F]{6}$')
      AND public.issue_1023_is_theme_font(v_brand.theme_font)
      AND public.issue_1023_is_theme_gradient(v_brand.theme_gradient)
      AND (v_brand.theme_animation IS NULL OR v_brand.theme_animation IN (
        'none','confetti','fireworks','balloons','sparkles','glitter_shower',
        'snowfall','falling_petals','hearts','shimmer_reveal',
    -- issue #1023: the 20 new theme motion slugs
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'))));

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
$function$
;

REVOKE ALL ON FUNCTION public.brand_context_completeness_internal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_context_completeness_internal(uuid)
  TO service_role;

COMMIT;
