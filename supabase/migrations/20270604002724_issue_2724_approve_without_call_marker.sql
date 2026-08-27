-- Issue #2724: a phone-call marker is optional audit metadata and is not an
-- approval prerequisite. This is the latest effective #1255 state machine
-- with only the obsolete must_mark_called_first branch removed.

CREATE OR REPLACE FUNCTION public.biz_review_venue_claim (
  p_venue_id uuid,
  p_action text,
  p_rejection_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_dup_count integer := 0;
  v_reason text;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_admin_user () THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_action NOT IN ('mark_called', 'approve', 'reject', 'need_more_info') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT *
  INTO v_venue
  FROM public.venue_listings v
  WHERE v.id = p_venue_id
    AND v.claim_status IN ('pending_review','verified','rejected');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found';
  END IF;

  IF p_action = 'mark_called' THEN
    IF v_venue.claim_status <> 'pending_review' THEN
      IF v_venue.marked_called_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'noop', true);
      END IF;
      RAISE EXCEPTION 'venue_not_pending_review';
    END IF;

    IF v_venue.marked_called_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'noop', true);
    END IF;

    UPDATE public.venue_listings
    SET
      marked_called_at = now(),
      marked_called_by = auth.uid()
    WHERE id = p_venue_id;

    RETURN jsonb_build_object('ok', true, 'action', 'mark_called');
  END IF;

  IF p_action = 'need_more_info' THEN
    IF v_venue.claim_status <> 'pending_review' THEN
      RAISE EXCEPTION 'venue_not_pending_review';
    END IF;

    UPDATE public.venue_listings
    SET claim_follow_up_at = now()
    WHERE id = p_venue_id;

    RETURN jsonb_build_object('ok', true, 'action', 'need_more_info');
  END IF;

  IF p_action = 'approve' THEN
    IF v_venue.claim_status = 'verified' THEN
      RETURN jsonb_build_object('ok', true, 'noop', true, 'claim_status', 'verified');
    END IF;

    IF v_venue.claim_status <> 'pending_review' THEN
      RAISE EXCEPTION 'venue_not_pending_review';
    END IF;

    -- Duplicate-claim guard, venue-keyed: the same google place verified on
    -- ANOTHER venue row anywhere blocks the approve.
    IF v_venue.google_place_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.venue_listings v2
      WHERE v2.id <> p_venue_id
        AND v2.google_place_id = v_venue.google_place_id
        AND v2.claim_status = 'verified'
    ) THEN
      RAISE EXCEPTION 'google_place_already_verified';
    END IF;

    UPDATE public.venue_listings
    SET
      claim_status = 'verified',
      rejection_reason = NULL,
      claim_follow_up_at = NULL,
      duplicate_of_venue_id = NULL
    WHERE id = p_venue_id;

    IF v_venue.google_place_id IS NOT NULL THEN
      UPDATE public.venue_listings
      SET duplicate_of_venue_id = p_venue_id
      WHERE id <> p_venue_id
        AND google_place_id = v_venue.google_place_id
        AND claim_status = 'pending_review'
        AND duplicate_of_venue_id IS DISTINCT FROM p_venue_id;

      GET DIAGNOSTICS v_dup_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
      'ok',
      true,
      'action',
      'approve',
      'claim_status',
      'verified',
      'duplicate_flagged_count',
      v_dup_count
    );
  END IF;

  IF v_venue.claim_status = 'rejected' THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'claim_status', 'rejected');
  END IF;

  IF v_venue.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'venue_not_pending_review';
  END IF;

  v_reason := nullif(trim(coalesce(p_rejection_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required';
  END IF;

  UPDATE public.venue_listings
  SET
    claim_status = 'rejected',
    rejection_reason = v_reason,
    claim_follow_up_at = NULL,
    duplicate_of_venue_id = NULL
  WHERE id = p_venue_id;

  RETURN jsonb_build_object(
    'ok',
    true,
    'action',
    'reject',
    'claim_status',
    'rejected'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_review_venue_claim(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_review_venue_claim(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_review_venue_claim(uuid, text, text) TO authenticated;
