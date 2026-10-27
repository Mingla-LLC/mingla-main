-- #2829 W3 — record which artifact generation, renderer and design a
-- publication is, and any font fallbacks the builder had to make.
--
-- Until now every publication row kept the column defaults (schema 1,
-- restaurant-website-v1), because only v1 artifacts existed. From W3 the CMS
-- builds v2 (`sites-v2`) artifacts drawn by a design; the runtime refuses an
-- artifact whose generation disagrees with what Core resolved, so Core must
-- record the generation the CMS actually wrote. Rollback to an earlier v1
-- publication keeps recording v1.
--
-- A publish never fails because a Google font would not load: the builder
-- falls back to the design's family and reports it. That report is stored on
-- the operation receipt (`font_warnings`) so the Business app can tell the
-- owner which font was used instead.
--
-- Forward-only. The original 8-argument completion stays callable unchanged
-- (it records a v1 publication, exactly as before); the 13-argument form is
-- its full body plus the generation, design and warnings, written in the SAME
-- updates (published rows and succeeded receipts are immutable afterwards).

BEGIN;

ALTER TABLE public.brand_site_operation_receipts
  DROP CONSTRAINT brand_site_receipts_result_ck;
ALTER TABLE public.brand_site_operation_receipts
  ADD CONSTRAINT brand_site_receipts_result_ck CHECK (
    public.brand_site_json_keys_allowed(
      result_summary,
      ARRAY['site_id','publication_id','status','destination','expires_at',
        'revision_id','artifact_digest','last_good_preserved','retryable',
        'brand_id','user_id','rank','generated_at',
        'rollback_source_publication_id','public_reachable',
        'public_status_code','public_checked_at',
        'offline','download_url','bytes','reason_code',
        'font_warnings','artifact_schema_version','design_key']
    )
  );

-- A font-warning list is at most three entries (display, body, accent), each
-- naming the slot, the requested and the used family (or "none") and a code
-- from a closed list. Nothing else can be stored.
CREATE OR REPLACE FUNCTION public.brand_site_valid_font_warnings(p_warnings jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_warnings IS NULL OR (
    jsonb_typeof(p_warnings) = 'array'
    AND jsonb_array_length(p_warnings) <= 3
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_warnings) AS entry(value)
      WHERE jsonb_typeof(entry.value) <> 'object'
        OR NOT public.brand_site_json_keys_allowed(entry.value, ARRAY['slot','requested','used','code'])
        OR (entry.value->>'slot') IS NULL
        OR (entry.value->>'slot') NOT IN ('display','body','accent')
        OR (entry.value->>'code') IS NULL
        OR (entry.value->>'code') NOT IN ('FONT_FETCH_FAILED','FONT_TOO_LARGE')
        OR coalesce(entry.value->>'requested', '') !~ '^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,62}[A-Za-z0-9])?$'
        OR coalesce(entry.value->>'used', '') !~ '^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,62}[A-Za-z0-9])?$'
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.brand_site_valid_font_warnings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_valid_font_warnings(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_complete_publication(
  p_site_id uuid,
  p_operation_id uuid,
  p_publication_id uuid,
  p_source_revision_id text,
  p_source_digest text,
  p_artifact_key text,
  p_artifact_digest text,
  p_probe_summary jsonb,
  p_artifact_schema_version integer,
  p_renderer_key text,
  p_design_key text,
  p_design_version integer,
  p_font_warnings jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_warnings jsonb := CASE WHEN coalesce(jsonb_array_length(p_font_warnings), 0) > 0
    THEN p_font_warnings ELSE NULL END;
BEGIN
  -- #2829 W3 — the generation pairs the runtime serves: v2 drawn by a named
  -- design, or v1 (a rollback to an earlier publication) with no design.
  IF NOT COALESCE(
      (p_artifact_schema_version = 2 AND p_renderer_key = 'sites-v2'
        AND p_design_key ~ '^[a-z][a-z0-9-]{1,31}$' AND p_design_version > 0)
      OR (p_artifact_schema_version = 1 AND p_renderer_key = 'restaurant-website-v1'
        AND p_design_key IS NULL AND p_design_version IS NULL),
      false
    )
    OR NOT COALESCE(public.brand_site_valid_font_warnings(p_font_warnings), false)
    OR (p_artifact_schema_version = 1 AND v_warnings IS NOT NULL) THEN
    RAISE EXCEPTION 'sites_callback_ambiguous';
  END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  SELECT * INTO STRICT v_publication FROM public.brand_site_publications
    WHERE id = p_publication_id AND operation_id = p_operation_id
      AND site_id = p_site_id FOR UPDATE;
  IF v_publication.status = 'published' THEN
    -- A replayed completion must describe the publication it already made.
    IF v_publication.artifact_schema_version <> p_artifact_schema_version
       OR v_publication.renderer_key <> p_renderer_key
       OR v_publication.design_key IS DISTINCT FROM p_design_key THEN
      RAISE EXCEPTION 'sites_callback_ambiguous';
    END IF;
    RETURN jsonb_build_object(
      'site_id', p_site_id, 'publication_id', p_publication_id,
      'artifact_digest', v_publication.artifact_digest, 'status', 'published',
      'artifact_schema_version', v_publication.artifact_schema_version
    );
  END IF;
  -- The same gates as the original completion (foundation, #2830).
  IF v_publication.status NOT IN ('queued','validating','materializing','probing','ambiguous')
     OR v_publication.source_revision_id <> p_source_revision_id
     OR v_publication.source_digest <> p_source_digest
     OR p_artifact_digest !~ '^[0-9a-f]{64}$'
     OR p_artifact_key <> 'publications/' || p_site_id::text || '/' ||
        p_publication_id::text || '/' || p_artifact_digest || '.json'
     OR NOT public.brand_site_json_keys_allowed(
       p_probe_summary,
       ARRAY['http_ok','digest_ok','renderer_ok','schema_ok','canonical_ok',
        'assets_ok','accessibility_ok','consent_ok','cta_ok','leak_check_ok',
        'observed_digest','status_code']
     )
     OR COALESCE((p_probe_summary->>'http_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'digest_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'renderer_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'schema_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'canonical_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'assets_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'accessibility_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'consent_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'cta_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'leak_check_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'status_code')::integer, 0) <> 200
     OR p_probe_summary->>'observed_digest' <> p_artifact_digest THEN
    RAISE EXCEPTION 'sites_callback_ambiguous';
  END IF;
  UPDATE public.brand_site_publications SET
    artifact_key = p_artifact_key,
    artifact_digest = p_artifact_digest,
    probe_summary = p_probe_summary,
    artifact_schema_version = p_artifact_schema_version,
    renderer_key = p_renderer_key,
    design_key = p_design_key,
    design_version = p_design_version,
    status = 'published',
    completed_at = clock_timestamp()
  WHERE id = p_publication_id;
  UPDATE public.brand_sites SET
    status = 'published', active_publication_id = p_publication_id,
    last_successful_publication_id = p_publication_id,
    provisioning_error_code = NULL,
    renderer_key = p_renderer_key,
    design_key = p_design_key
  WHERE id = p_site_id;
  UPDATE public.brand_site_operation_receipts SET
    status = 'succeeded', completed_at = clock_timestamp(),
    result_summary = jsonb_build_object(
      'site_id', p_site_id, 'publication_id', p_publication_id,
      'artifact_digest', p_artifact_digest, 'status', 'succeeded',
      'artifact_schema_version', p_artifact_schema_version
    )
    || CASE WHEN p_design_key IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('design_key', p_design_key) END
    || CASE WHEN v_warnings IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('font_warnings', v_warnings) END
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id,
    operation_id, after_digest, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, 'system', 'publication.published',
    'publication', p_publication_id::text, p_operation_id, p_artifact_digest,
    jsonb_build_object('status', 'published', 'schema_version', p_artifact_schema_version, 'renderer_version', 1)
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'publication_id', p_publication_id,
    'artifact_digest', p_artifact_digest, 'status', 'published',
    'artifact_schema_version', p_artifact_schema_version
  ) || CASE WHEN v_warnings IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('font_warnings', v_warnings) END;
END;
$function$;

REVOKE ALL ON FUNCTION public.brand_site_complete_publication(uuid,uuid,uuid,text,text,text,text,jsonb,integer,text,text,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_complete_publication(uuid,uuid,uuid,text,text,text,text,jsonb,integer,text,text,integer,jsonb)
  TO service_role;

COMMENT ON FUNCTION public.brand_site_complete_publication(uuid,uuid,uuid,text,text,text,text,jsonb,integer,text,text,integer,jsonb) IS
  '#2829 W3 — completes a publication and records the artifact generation, renderer and design the CMS wrote (v2 sites-v2 + design, or v1 for a rollback), plus any font fallbacks on the receipt.';

COMMIT;
