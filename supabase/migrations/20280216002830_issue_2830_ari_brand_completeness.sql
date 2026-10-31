-- Issue #2830 — Ari-owned Website setup and complete brand context.
--
-- I-2830-CONTEXT-IS-SERVER-TRUTH | Website readiness is derived from canonical
-- brand + plan values and field evidence. Clients and Ari never award ticks.
-- I-2830-NO-DRAFT-BEFORE-SETUP | Provision and compose both refuse until the
-- first five plan parts are done and every non-optional context field is
-- verified or has an owner-approved not-applicable exception.
-- I-2830-PRE-DRAFT-DESIGN | A design choice is revision-safe plan state and
-- does not require a brand_sites row.
-- I-2830-CONTEXT-WRITES-RECEIPTED | Ari context writes use the caller JWT,
-- rank checks, plan compare-and-set and the canonical operation receipt.

BEGIN;

SET LOCAL lock_timeout = '10s';

ALTER TABLE public.brand_site_plans
  ADD COLUMN design_key text
    CHECK (design_key IS NULL OR design_key IN ('atelier', 'voyage'));

CREATE TABLE public.brand_context_field_evidence (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  field_key text NOT NULL CHECK (field_key IN (
    'name','description','offerings_selected','design_key',
    'story.who','story.why','story.main_action','approved_plan',
    'venue_descriptor','contact_email','contact_phone','address',
    'city_country','social_links','profile_photo','cover_media','theme'
  )),
  disposition text NOT NULL DEFAULT 'verified'
    CHECK (disposition IN ('verified','not_applicable','stale','conflict')),
  source_type text NOT NULL DEFAULT 'mingla'
    CHECK (source_type IN ('mingla','owner','public_research','imported')),
  source_ref text CHECK (source_ref IS NULL OR length(source_ref) <= 300),
  source_url text CHECK (
    source_url IS NULL OR
    (length(source_url) <= 1000 AND source_url ~ '^https://')
  ),
  observed_at timestamptz NOT NULL DEFAULT now(),
  owner_confirmed_at timestamptz,
  exception_reason text CHECK (
    exception_reason IS NULL OR length(btrim(exception_reason)) BETWEEN 1 AND 500
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  PRIMARY KEY (brand_id, field_key),
  CONSTRAINT brand_context_evidence_exception_ck CHECK (
    (disposition = 'not_applicable') = (exception_reason IS NOT NULL)
  )
);
ALTER TABLE public.brand_context_field_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_context_field_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_context_field_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brand_context_field_evidence TO service_role;

CREATE OR REPLACE FUNCTION public.brand_context_field_json(
  p_brand_id uuid,
  p_key text,
  p_label text,
  p_group text,
  p_requirement text,
  p_value jsonb,
  p_present boolean,
  p_valid boolean,
  p_human_action boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_evidence public.brand_context_field_evidence%ROWTYPE;
  v_state text;
BEGIN
  SELECT * INTO v_evidence
  FROM public.brand_context_field_evidence
  WHERE brand_id = p_brand_id AND field_key = p_key;

  v_state := CASE
    WHEN v_evidence.disposition = 'not_applicable' AND p_requirement <> 'required'
      THEN 'not_applicable'
    WHEN v_evidence.disposition = 'conflict' THEN 'conflict'
    WHEN v_evidence.disposition = 'stale' THEN 'stale'
    WHEN v_evidence.source_type = 'public_research'
      AND v_evidence.observed_at < now() - interval '180 days' THEN 'stale'
    WHEN NOT p_present THEN 'missing'
    WHEN NOT p_valid THEN 'invalid'
    ELSE 'verified'
  END;

  RETURN jsonb_build_object(
    'key', p_key,
    'label', p_label,
    'group', p_group,
    'requirement', p_requirement,
    'state', v_state,
    'value', p_value,
    'source_type', COALESCE(v_evidence.source_type,
      CASE WHEN p_present THEN 'mingla' ELSE NULL END),
    'source_ref', COALESCE(v_evidence.source_ref,
      CASE WHEN p_present THEN 'mingla:brand:' || p_brand_id::text || ':' || p_key ELSE NULL END),
    'source_url', v_evidence.source_url,
    'observed_at', COALESCE(v_evidence.observed_at,
      CASE WHEN p_present THEN now() ELSE NULL END),
    'owner_confirmed_at', v_evidence.owner_confirmed_at,
    'exception_reason', v_evidence.exception_reason,
    'human_action_required', p_human_action AND v_state NOT IN ('verified','not_applicable')
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_context_field_json(
  uuid,text,text,text,text,jsonb,boolean,boolean,boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_context_field_json(
  uuid,text,text,text,text,jsonb,boolean,boolean,boolean
) TO service_role;

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
        SELECT 1 FROM jsonb_each_text(COALESCE(v_brand.social_links, '{}'::jsonb)) e
        WHERE e.key NOT IN ('website','instagram','tiktok','x','facebook','youtube','linkedin','threads')
          OR length(e.value) > 500 OR e.value !~ '^https://'
      ) ELSE false END
    AND CASE WHEN jsonb_typeof(COALESCE(v_brand.custom_links, '[]'::jsonb)) = 'array'
      THEN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_brand.custom_links, '[]'::jsonb)) e
        WHERE jsonb_typeof(e) <> 'object'
          OR NOT public.brand_site_json_keys_allowed(e,ARRAY['label','url'])
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
    COALESCE(v_brand.profile_photo_url,'') ~ '^https://',true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'cover_media','Cover media','Media','recommended',to_jsonb(v_brand.cover_media_url),
    NULLIF(btrim(COALESCE(v_brand.cover_media_url,'')),'') IS NOT NULL,
    COALESCE(v_brand.cover_media_url,'') ~ '^https://',true));
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
    'design_key', COALESCE(v_plan.design_key, v_site.design_key),
    'fields', v_fields,
    'required_gap_count', v_required_gaps,
    'recommended_gap_count', v_recommended_gaps,
    'gap_count', v_required_gaps + v_recommended_gaps,
    'verified_count', v_verified,
    'exception_count', v_exceptions,
    'minimum_complete', v_required_gaps = 0,
    'context_complete', v_required_gaps = 0 AND v_recommended_gaps = 0,
    'checked_at', now()
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_context_completeness_internal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_context_completeness_internal(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.brand_context_completeness(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.biz_brand_effective_rank(p_brand_id, auth.uid()) < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN public.brand_context_completeness_internal(p_brand_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_context_completeness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_context_completeness(uuid)
  TO authenticated, service_role;

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
  IF p_design_key NOT IN ('atelier','voyage')
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
    exception_reason = NULL, updated_at = now(), updated_by = v_actor;
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

-- The eight plan ticks remain server-derived. A plan-level design is enough
-- for the pre-draft Look step; existing sites retain their saved-look truth.
CREATE OR REPLACE FUNCTION public.brand_site_plan_status_internal(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan public.brand_site_plans%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_done jsonb;
  v_needed text[];
  v_kinds text[];
  v_first boolean;
  v_kind text;
  v_parts jsonb := '[]'::jsonb;
  v_part text;
  v_next text;
  v_count integer := 0;
  v_site_predates_plan boolean;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  v_site_predates_plan := v_site.id IS NOT NULL AND (
    v_site.last_successful_publication_id IS NOT NULL
    OR v_plan.brand_id IS NULL
    OR v_site.created_at < v_plan.started_at);
  v_plan.offerings_selected := COALESCE(v_plan.offerings_selected,
    public.brand_site_plan_prefill_offerings(p_brand_id));
  v_needed := public.brand_site_plan_offering_pages(v_plan.offerings_selected);
  v_kinds := ARRAY(SELECT unnest(COALESCE(v_plan.offerings_selected, ARRAY[]::text[]))
    INTERSECT SELECT unnest(ARRAY['trips','events','experiences']));
  v_first := cardinality(v_kinds) > 0;
  FOREACH v_kind IN ARRAY v_kinds LOOP
    IF public.brand_site_plan_offering_count(p_brand_id, v_kind, false) = 0 THEN
      v_first := false;
    END IF;
  END LOOP;
  v_done := jsonb_build_object(
    'offer', v_plan.offerings_selected IS NOT NULL,
    'brand', NULLIF(btrim(COALESCE(v_brand.name,'')),'') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_brand.description,'')),'') IS NOT NULL,
    'look', v_plan.design_key IS NOT NULL
      OR (v_site.id IS NOT NULL AND v_site.design_key IS NOT NULL AND v_site.tokens_saved_at IS NOT NULL)
      OR 'look' = ANY (COALESCE(v_plan.skipped_parts,ARRAY[]::text[])),
    'story', v_plan.story IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_plan.story->>'who','')),'') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_plan.story->>'why','')),'') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_plan.story->>'main_action','')),'') IS NOT NULL,
    'approve', (v_plan.approved_plan IS NOT NULL AND v_plan.approved_at IS NOT NULL)
      OR v_site_predates_plan,
    'build', (v_site.id IS NOT NULL AND v_plan.built_at IS NOT NULL
      AND v_plan.offerings_selected IS NOT NULL
      AND v_needed <@ COALESCE(v_plan.built_pages,ARRAY[]::text[])) OR v_site_predates_plan,
    'first_offering', v_first
      OR 'first_offering' = ANY (COALESCE(v_plan.skipped_parts,ARRAY[]::text[])),
    'publish', v_site.last_successful_publication_id IS NOT NULL
  );
  FOREACH v_part IN ARRAY public.brand_site_plan_parts() LOOP
    v_parts := v_parts || jsonb_build_object(
      'key',v_part,'done',(v_done->>v_part)::boolean,
      'skipped',v_part = ANY (COALESCE(v_plan.skipped_parts,ARRAY[]::text[])),
      'optional',v_part = 'first_offering');
    IF (v_done->>v_part)::boolean THEN v_count := v_count + 1;
    ELSIF v_next IS NULL THEN v_next := v_part;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('parts',v_parts,'done_count',v_count,'next_part',v_next);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_status_internal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_status_internal(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_plan_authorize_provision(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan public.brand_site_plans%ROWTYPE;
  v_status jsonb;
  v_context jsonb;
  v_part jsonb;
BEGIN
  PERFORM public.brand_site_plan_gate(p_brand_id, 50);
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.brand_id IS NULL THEN RAISE EXCEPTION 'sites_plan_not_ready'; END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> auth.uid() THEN RAISE EXCEPTION 'sites_plan_locked'; END IF;
  v_status := public.brand_site_plan_status_internal(p_brand_id);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_status->'parts') WITH ORDINALITY p(value,position)
    WHERE position <= 5 AND COALESCE((value->>'done')::boolean,false) = false
  ) THEN RAISE EXCEPTION 'sites_plan_not_ready'; END IF;
  v_context := public.brand_context_completeness_internal(p_brand_id);
  IF COALESCE((v_context->>'context_complete')::boolean,false) = false THEN
    RAISE EXCEPTION 'sites_context_incomplete';
  END IF;
  RETURN jsonb_build_object(
    'brand_id',p_brand_id,'revision',v_plan.revision,
    'design_key',v_plan.design_key,'context',v_context
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_authorize_provision(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_authorize_provision(uuid)
  TO authenticated, service_role;

-- The route performs the same check so it can return a named plan error, but
-- the RPC is also an authenticated boundary.  A client that calls it directly
-- must not create the first brand_sites row before setup is complete.
CREATE OR REPLACE FUNCTION public.brand_site_provision(
  p_brand_id uuid,
  p_operation_id uuid,
  p_arguments_digest text,
  p_label text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_suffix text;
  v_label text;
  v_seed text;
BEGIN
  IF v_actor IS NULL OR public.biz_brand_effective_rank(p_brand_id, v_actor) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_arguments_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  SELECT config.public_host_suffix INTO v_suffix
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1'
  FOR SHARE;
  IF v_suffix IS NULL THEN RAISE EXCEPTION 'sites_forbidden'; END IF;

  -- A completed receipt remains replayable even if the brand later changes.
  -- Only a new operation is subject to the current completeness gate.
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.arguments_digest <> p_arguments_digest OR
       v_receipt.brand_id <> p_brand_id OR v_receipt.kind <> 'provision' THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN COALESCE(v_receipt.result_summary, jsonb_build_object(
      'site_id', v_receipt.site_id, 'status', v_receipt.status));
  END IF;

  PERFORM public.brand_site_plan_authorize_provision(p_brand_id);

  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.brand_sites(brand_id, created_by)
    VALUES (p_brand_id, v_actor) RETURNING * INTO v_site;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_site_hosts host
    WHERE host.site_id = v_site.id AND host.kind = 'mingla_subdomain'
  ) THEN
    IF p_label IS NOT NULL THEN
      IF public.brand_site_subdomain_label(p_label) <> p_label
        OR EXISTS (SELECT 1 FROM public.brand_site_reserved_labels reserved
          WHERE reserved.label = p_label)
        OR EXISTS (SELECT 1 FROM public.brand_site_hosts host
          WHERE host.hostname = p_label || '.' || v_suffix) THEN
        RAISE EXCEPTION 'sites_label_unavailable';
      END IF;
      v_label := p_label;
    ELSE
      SELECT COALESCE(NULLIF(brand.slug, ''), brand.name) INTO v_seed
      FROM public.brands brand WHERE brand.id = p_brand_id;
      v_label := public.brand_site_available_label(v_seed, v_suffix);
    END IF;
    INSERT INTO public.brand_site_hosts(site_id, hostname, kind, status, is_primary, label)
    VALUES (v_site.id, v_label || '.' || v_suffix, 'mingla_subdomain', 'pending', true, v_label);
  END IF;
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at
  ) VALUES (
    p_operation_id, v_site.id, p_brand_id, v_actor, 'provision',
    p_arguments_digest, 'executing',
    jsonb_build_object('site_id', v_site.id, 'status', 'executing'), now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    v_site.id, p_brand_id, v_actor, 'user', 'site.provision_requested',
    'site', v_site.id::text, p_operation_id,
    jsonb_build_object('status', 'executing', 'renderer_version', 1)
  );
  RETURN jsonb_build_object('site_id', v_site.id, 'status', 'executing');
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_provision(uuid,uuid,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_provision(uuid,uuid,text,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_site_plan_authorize_compose(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.brand_site_plans%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_status jsonb;
BEGIN
  PERFORM public.brand_site_plan_gate(p_brand_id, 50);
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.brand_id IS NULL OR v_plan.approved_at IS NULL
    OR v_plan.offerings_selected IS NULL THEN RAISE EXCEPTION 'sites_plan_not_ready'; END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN RAISE EXCEPTION 'sites_plan_locked'; END IF;
  v_status := public.brand_site_plan_status_internal(p_brand_id);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_status->'parts') WITH ORDINALITY p(value,position)
    WHERE position <= 5 AND COALESCE((value->>'done')::boolean,false) = false
  ) OR COALESCE((public.brand_context_completeness_internal(p_brand_id)->>'context_complete')::boolean,false) = false
  THEN RAISE EXCEPTION 'sites_plan_not_ready'; END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  IF v_site.id IS NULL OR v_site.status IN ('provisioning','error') THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  RETURN jsonb_build_object(
    'site_id',v_site.id,'brand_id',p_brand_id,'revision',v_plan.revision,
    'design_key',COALESCE(v_plan.design_key,v_site.design_key,'atelier'),
    'offerings_selected',to_jsonb(v_plan.offerings_selected),
    'venue_descriptor',v_plan.venue_descriptor,'story',v_plan.story,
    'brand',jsonb_build_object(
      'name',v_brand.name,'description',v_brand.description,
      'contact_email',v_brand.contact_email,'contact_phone',v_brand.contact_phone,
      'city',v_brand.city,'country_code',v_brand.country_code,'address',v_brand.address,
      'social_links',v_brand.social_links,'profile_photo_url',v_brand.profile_photo_url,
      'cover_media_url',v_brand.cover_media_url,'cover_media_type',v_brand.cover_media_type,
      'cover_media_poster_url',v_brand.cover_media_poster_url));
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_authorize_compose(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_authorize_compose(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_update_brand_context(
  p_operation_id uuid,
  p_brand_id uuid,
  p_expected_plan_revision integer,
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
  v_begin jsonb;
  v_result jsonb;
  v_source_type text := COALESCE(NULLIF(p_evidence->>'source_type',''),'owner');
  v_source_ref text := NULLIF(btrim(COALESCE(p_evidence->>'source_ref','')),'');
  v_source_url text := NULLIF(btrim(COALESCE(p_evidence->>'source_url','')),'');
  v_observed_at timestamptz := COALESCE(NULLIF(p_evidence->>'observed_at','')::timestamptz,now());
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
  IF v_source_type NOT IN ('mingla','owner','public_research','imported')
    OR length(COALESCE(v_source_ref,'')) > 300
    OR (v_source_url IS NOT NULL AND (length(v_source_url) > 1000 OR v_source_url !~ '^https://'))
    OR (v_source_type = 'public_research' AND v_source_url IS NULL) THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM public.brand_site_plans
  WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.brand_id IS NULL OR p_expected_plan_revision IS NULL
    OR p_expected_plan_revision <> v_plan.revision THEN
    RAISE EXCEPTION 'sites_revision_conflict';
  END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN RAISE EXCEPTION 'sites_plan_locked'; END IF;

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
      SELECT 1 FROM jsonb_each_text(p_patch->'social_links') e
      WHERE e.key NOT IN ('website','instagram','tiktok','x','facebook','youtube','linkedin','threads')
        OR length(e.value) > 500 OR e.value !~ '^https://'
    )) THEN RAISE EXCEPTION 'invalid_social_links' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'custom_links' AND jsonb_typeof(p_patch->'custom_links') <> 'null' AND (
    jsonb_typeof(p_patch->'custom_links') <> 'array'
    OR jsonb_array_length(p_patch->'custom_links') > 10 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_patch->'custom_links') e
      WHERE jsonb_typeof(e) <> 'object'
        OR NOT public.brand_site_json_keys_allowed(e,ARRAY['label','url'])
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

  v_begin := public.agent_operation_receipt_begin(
    p_operation_id,'update_brand_context',jsonb_build_object(
      'brand_id',p_brand_id,'expected_plan_revision',p_expected_plan_revision,
      'patch',p_patch,'exceptions',p_exceptions,'evidence',p_evidence));
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result'; END IF;

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
      exception_reason=NULL,updated_at=now(),updated_by=v_actor;
  END LOOP;

  FOR v_exception IN SELECT value FROM jsonb_array_elements(p_exceptions) LOOP
    IF jsonb_typeof(v_exception) <> 'object'
      OR NOT public.brand_site_json_keys_allowed(v_exception,ARRAY['field_key','reason']) THEN
      RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
    END IF;
    v_field_key := v_exception->>'field_key';
    v_reason := NULLIF(btrim(COALESCE(v_exception->>'reason','')),'');
    IF v_field_key NOT IN (
      'venue_descriptor','contact_email','contact_phone','address','city_country',
      'social_links','profile_photo','cover_media','theme')
      OR v_reason IS NULL OR length(v_reason) > 500 THEN
      RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.brand_context_field_evidence(
      brand_id,field_key,disposition,source_type,source_ref,source_url,
      observed_at,owner_confirmed_at,exception_reason,updated_at,updated_by
    ) VALUES (
      p_brand_id,v_field_key,'not_applicable','owner',NULL,NULL,
      now(),now(),v_reason,now(),v_actor
    ) ON CONFLICT (brand_id,field_key) DO UPDATE SET
      disposition='not_applicable',source_type='owner',source_ref=NULL,source_url=NULL,
      observed_at=now(),owner_confirmed_at=now(),exception_reason=EXCLUDED.exception_reason,
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
    p_operation_id,'update_brand_context',jsonb_build_object(
      'brand_id',p_brand_id,'expected_plan_revision',p_expected_plan_revision,
      'patch',p_patch,'exceptions',p_exceptions,'evidence',p_evidence),v_result);
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_update_brand_context(uuid,uuid,integer,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_update_brand_context(uuid,uuid,integer,jsonb,jsonb,jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_start_brand_completeness_job(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_manifest jsonb;
  v_job public.ari_agent_jobs%ROWTYPE;
  v_pending text[];
BEGIN
  IF v_actor IS NULL OR NOT public.biz_is_brand_member_for_read(p_brand_id,v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  v_manifest := public.brand_context_completeness_internal(p_brand_id);
  v_pending := ARRAY(
    SELECT item->>'key' FROM jsonb_array_elements(v_manifest->'fields') item
    WHERE item->>'requirement' <> 'optional'
      AND item->>'state' NOT IN ('verified','not_applicable')
    ORDER BY item->>'group',item->>'key'
  );
  SELECT * INTO v_job FROM public.ari_agent_jobs
  WHERE user_id=v_actor AND brand_id=p_brand_id
    AND checkpoint->>'kind'='brand_completeness'
    AND status <> 'cancelled'
  ORDER BY updated_at DESC LIMIT 1;
  IF v_job.id IS NULL THEN
    INSERT INTO public.ari_agent_jobs(
      user_id,brand_id,idempotency_key,goal_summary,status,checkpoint,pending_step_keys
    ) VALUES (
      v_actor,p_brand_id,gen_random_uuid(),
      'Complete Website brand context with verified values or explicit owner exceptions',
      CASE WHEN cardinality(v_pending)=0 THEN 'completed' ELSE 'queued' END,
      jsonb_build_object(
        'kind','brand_completeness','context_revision',v_manifest->'revision',
        'checked_at',v_manifest->'checked_at','current_step',v_pending[1]),
      v_pending
    ) RETURNING * INTO v_job;
  ELSE
    UPDATE public.ari_agent_jobs SET
      status = CASE
        WHEN cardinality(v_pending)=0 THEN 'completed'
        WHEN status IN ('completed','failed','paused') THEN 'queued'
        ELSE status
      END,
      checkpoint = jsonb_build_object(
        'kind','brand_completeness','context_revision',v_manifest->'revision',
        'checked_at',v_manifest->'checked_at','current_step',v_pending[1]),
      pending_step_keys = v_pending,
      completed_step_keys = ARRAY(
        SELECT step_key FROM unnest(v_job.completed_step_keys) step_key
        WHERE NOT (step_key = ANY(v_pending))
      ),
      completed_at = CASE WHEN cardinality(v_pending)=0 THEN now() ELSE NULL END,
      last_error_code = NULL,
      revision = revision + 1,
      updated_at = now()
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  END IF;
  RETURN jsonb_build_object(
    'job',to_jsonb(v_job)-'user_id'-'lease_owner',
    'completeness',v_manifest,
    'resumed',v_job.created_at <> v_job.updated_at
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_start_brand_completeness_job(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_start_brand_completeness_job(uuid)
  TO authenticated, service_role;

COMMIT;
