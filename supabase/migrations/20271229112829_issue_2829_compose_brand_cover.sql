-- #2829 W11 (amendment A17) — "Create website draft" hands Studio the
-- brand's cover so the composed Home opens with the brand's own photo when
-- it has one (the hero), and with the intentional colour panel otherwise.
-- Only adds three read-only fields to the compose inputs; the gates are
-- unchanged.
-- Do NOT apply here — orchestrator owns production apply.

BEGIN;
SET LOCAL lock_timeout = '10s';

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
BEGIN
  PERFORM public.brand_site_plan_gate(p_brand_id, 50);
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.brand_id IS NULL OR v_plan.approved_at IS NULL OR v_plan.offerings_selected IS NULL THEN
    RAISE EXCEPTION 'sites_plan_not_ready';
  END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN
    RAISE EXCEPTION 'sites_plan_locked';
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  IF v_site.id IS NULL OR v_site.status IN ('provisioning','error') THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  RETURN jsonb_build_object(
    'site_id', v_site.id,
    'brand_id', p_brand_id,
    'revision', v_plan.revision,
    'offerings_selected', to_jsonb(v_plan.offerings_selected),
    'venue_descriptor', v_plan.venue_descriptor,
    'story', v_plan.story,
    'brand', jsonb_build_object(
      'name', v_brand.name,
      'description', v_brand.description,
      'contact_email', v_brand.contact_email,
      'city', v_brand.city,
      'address', v_brand.address,
      -- #2829 W11 (A17): the brand's Mingla cover, so the composed Home can
      -- open with it. Studio imports only a cover stored in Mingla's own
      -- public cover storage; anything else is ignored there.
      'cover_media_url', v_brand.cover_media_url,
      'cover_media_type', v_brand.cover_media_type,
      'cover_media_poster_url', v_brand.cover_media_poster_url
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_authorize_compose(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_authorize_compose(uuid) TO authenticated, service_role;

COMMIT;
