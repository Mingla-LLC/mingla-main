-- ORCH-0763D: server-authoritative draft discard.
--
-- Moves business draft deletion out of direct client-side table UPDATE paths
-- and into a SECURITY DEFINER RPC with explicit auth, lifecycle, brand, and
-- rank checks. The app still soft-deletes drafts; it just does so through the
-- same server-owned lifecycle pattern used by publish/cancel/end-sales.

CREATE OR REPLACE FUNCTION public.business_discard_event_draft(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_now timestamptz := now();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;

  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_discardable';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  UPDATE public.events
  SET deleted_at = v_now,
      updated_at = v_now
  WHERE id = p_event_id
    AND status = 'draft'
    AND deleted_at IS NULL
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'brand_id', v_event.brand_id,
    'deleted_at', v_event.deleted_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.business_discard_event_draft(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_discard_event_draft(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_discard_event_draft(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.business_discard_event_draft(uuid) IS
  'ORCH-0763D: server-authoritative soft-delete for business event drafts, restricted to event_manager rank or above.';
