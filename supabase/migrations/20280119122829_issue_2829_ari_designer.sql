-- #2829 W9b — Ari as the website designer (Core side).
--
-- 1. "Websites are opening brand by brand": when someone on a brand that
--    isn't granted Mingla Sites asks Ari for a website, Ari gives the honest
--    answer AND records the interest so Mingla admins can see who is asking.
--    One row per brand, member and day (asking twice the same day is one
--    request). Admin-only read.
-- 2. The Website content gate learns the two new read actions the Publish
--    review uses: the work log ("Why it looks like this") and the six design
--    checks (both rank 20, like every other content read).
-- 3. A refused publish may name one more owner-fixable reason:
--    DESIGN_CHECKS_REQUIRED (a site's first publish waits until the design
--    checks have run on that exact draft; nothing goes live meanwhile).
-- (The Ari certification census for the designer tools is its own migration,
-- 20280119132829_issue_2829_ari_cert_capability_census.sql, so certification
-- backlog-repair tests can re-apply it without replaying this schema.)
--
-- Forward-only; replaces no data. Not applied by the author.

BEGIN;

-- ── 1. Interest from brands without websites ─────────────────────────────
CREATE TABLE public.brand_site_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('ari', 'business_app')),
  asked_on date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_site_interest_once_a_day UNIQUE (brand_id, user_id, asked_on)
);
CREATE INDEX brand_site_interest_brand_idx ON public.brand_site_interest (brand_id, created_at DESC);
ALTER TABLE public.brand_site_interest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_interest FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_site_interest FROM PUBLIC, anon, authenticated;

-- A member (rank >= 20) of a brand that is NOT granted Sites asks for one.
-- Granted brands record nothing (they can build a website already).
CREATE OR REPLACE FUNCTION public.brand_site_record_interest(
  p_brand_id uuid, p_source text DEFAULT 'ari'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_rank integer;
BEGIN
  IF v_actor IS NULL OR p_brand_id IS NULL OR p_source IS NULL
    OR p_source NOT IN ('ari', 'business_app') THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_actor);
  IF v_rank IS NULL OR v_rank < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF public.brand_site_entitled(p_brand_id) THEN
    RETURN jsonb_build_object('recorded', false, 'entitled', true);
  END IF;
  INSERT INTO public.brand_site_interest (brand_id, user_id, source)
  VALUES (p_brand_id, v_actor, p_source)
  ON CONFLICT ON CONSTRAINT brand_site_interest_once_a_day DO NOTHING;
  RETURN jsonb_build_object('recorded', true, 'entitled', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_record_interest(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_record_interest(uuid, text) TO authenticated, service_role;

-- Mingla admins: which brands are asking (newest first), never the members' contact details.
CREATE OR REPLACE FUNCTION public.brand_site_admin_interest(
  p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_json ORDER BY last_asked DESC)
    FROM (
      SELECT jsonb_build_object(
          'brand_id', interest.brand_id,
          'brand_name', brand.name,
          'requests', count(*),
          'members', count(DISTINCT interest.user_id),
          'last_asked_at', max(interest.created_at),
          'entitled', public.brand_site_entitled(interest.brand_id)
        ) AS row_json,
        max(interest.created_at) AS last_asked
      FROM public.brand_site_interest interest
      JOIN public.brands brand ON brand.id = interest.brand_id
      GROUP BY interest.brand_id, brand.name
      ORDER BY max(interest.created_at) DESC
      LIMIT v_limit
    ) rows
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_admin_interest(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_interest(integer) TO authenticated, service_role;

-- ── 2. The content gate's rank list (one list; the CMS re-checks it) ─────
CREATE OR REPLACE FUNCTION public.brand_site_content_min_rank(p_action text)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_action IN (
      'list','get','create','update','reorder','set_visibility','delete',
      'categories','create_category','rename_category','reorder_categories',
      'delete_category','media_upload_grant','media_complete','media_status',
      'media_library','offerings','past_trips','font_search','font_previews','draft_changes','pages','set_menu','cover','set_cover',
      -- #2829 W9b — "Why it looks like this" and the six design checks.
      'work_log','design_checks'
    ) THEN 20
    -- Only brand admins and owners confirm a review is real (§37 answer 2)
    -- and hide a past trip from the website (§37 answer 3).
    WHEN p_action IN ('confirm_review','set_offering_visibility') THEN 50
    ELSE NULL
  END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_min_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_content_min_rank(text) TO authenticated, service_role;

-- ── 3. One more owner-fixable publish refusal ────────────────────────────
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
    AND p_reason_code NOT IN ('PATH_COLLISION', 'PAGE_LIMIT_EXCEEDED', 'DESIGN_CHECKS_REQUIRED') THEN
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
REVOKE ALL ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid,text) TO service_role;

COMMENT ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid,text) IS
  '#2829 W2/W9b — record a refused publish (last good stays live) with an optional owner-fixable reason (PATH_COLLISION, PAGE_LIMIT_EXCEEDED, DESIGN_CHECKS_REQUIRED) on the receipt and audit row.';
COMMENT ON TABLE public.brand_site_interest IS
  '#2829 W9b — members of brands without Mingla Sites who asked for a website (one row per brand, member and day). Admin read only, via brand_site_admin_interest.';

COMMIT;
