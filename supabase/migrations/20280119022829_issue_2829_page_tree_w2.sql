-- #2829 W2 — a refused publish says WHY when the owner can fix it.
--
-- Studio refuses a publish in which two things would answer the same address
-- (PATH_COLLISION) or a site holds more pages than allowed
-- (PAGE_LIMIT_EXCEEDED). The last good publication stays live either way, as
-- before. Until now Core recorded every such refusal as the same
-- PUBLISH_FAILED_LAST_GOOD_PRESERVED, so the Business app could only say
-- "try again" — and trying again fails the same way.
--
-- 1. brand_site_fail_publication gains a 4-argument form taking an optional
--    reason from a closed list. The reason is recorded on the receipt's
--    result (reason_code) and in the audit row; the receipt error code and
--    the publication failure code stay PUBLISH_FAILED_LAST_GOOD_PRESERVED, so
--    every existing reader is unchanged.
-- 2. The 3-argument form is kept (the callback still calls it when there is
--    no reason) and now delegates to the 4-argument form: one body, not two.
-- 3. The receipt result vocabulary gains reason_code.
--
-- Forward-only; replaces no data. Not applied by the author.

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
        'offline','download_url','bytes','reason_code']
    )
  );

CREATE OR REPLACE FUNCTION public.brand_site_fail_publication(
  p_site_id uuid,
  p_operation_id uuid,
  p_publication_id uuid,
  p_reason_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_result jsonb;
BEGIN
  -- #2829 — only reasons an owner can act on travel; anything else is refused
  -- rather than stored, so free text can never reach a receipt.
  IF p_reason_code IS NOT NULL
    AND p_reason_code NOT IN ('PATH_COLLISION', 'PAGE_LIMIT_EXCEEDED') THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO STRICT v_site
  FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  SELECT * INTO STRICT v_publication
  FROM public.brand_site_publications
  WHERE id = p_publication_id
    AND site_id = p_site_id
    AND operation_id = p_operation_id
  FOR UPDATE;
  IF v_publication.status = 'published' THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  UPDATE public.brand_site_publications
  SET status = 'failed', failed_at = clock_timestamp(),
    failure_code = 'PUBLISH_FAILED_LAST_GOOD_PRESERVED'
  WHERE id = p_publication_id;
  UPDATE public.brand_sites
  SET status = CASE
      WHEN last_successful_publication_id IS NULL THEN 'draft'
      ELSE 'published'
    END,
    provisioning_error_code = 'PUBLISH_FAILED_LAST_GOOD_PRESERVED'
  WHERE id = p_site_id;
  v_result := jsonb_build_object(
    'site_id', p_site_id,
    'publication_id', p_publication_id,
    'status', 'failed',
    'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL,
    'retryable', false
  ) || CASE WHEN p_reason_code IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('reason_code', p_reason_code) END;
  UPDATE public.brand_site_operation_receipts
  SET status = 'failed', completed_at = clock_timestamp(),
    error_code = 'PUBLISH_FAILED_LAST_GOOD_PRESERVED',
    result_summary = v_result
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id,
    operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, 'system', 'publication.failed',
    'publication', p_publication_id::text, p_operation_id,
    jsonb_build_object(
      'status', 'failed',
      'safe_error_code', 'PUBLISH_FAILED_LAST_GOOD_PRESERVED',
      'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL
    ) || CASE WHEN p_reason_code IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('reason_code', p_reason_code) END
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_fail_publication(
  p_site_id uuid,
  p_operation_id uuid,
  p_publication_id uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.brand_site_fail_publication(
    p_site_id, p_operation_id, p_publication_id, NULL::text
  );
$function$;

REVOKE ALL ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid) TO service_role;

COMMENT ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid,text) IS
  '#2829 W2 — record a refused publish (last good stays live) with an optional owner-fixable reason (PATH_COLLISION, PAGE_LIMIT_EXCEEDED) on the receipt and audit row.';

COMMIT;
