-- Ve3 (#101) — Admin claim review: call-then-approve, need-more-info, duplicate flags, persisted rejection.

BEGIN;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS claim_follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS duplicate_of_brand_id uuid REFERENCES public.brands (id),
  ADD COLUMN IF NOT EXISTS marked_called_at timestamptz,
  ADD COLUMN IF NOT EXISTS marked_called_by uuid,
  ADD COLUMN IF NOT EXISTS claim_decision_emailed_at timestamptz;

COMMENT ON COLUMN public.brands.rejection_reason IS
  'Ve3 — admin rejection note emailed to venue operator.';
COMMENT ON COLUMN public.brands.claim_follow_up_at IS
  'Ve3 — set when admin requests more info; claim_status stays pending_review.';
COMMENT ON COLUMN public.brands.duplicate_of_brand_id IS
  'Ve3 — sibling pending claim flagged after another brand with same google_place_id was approved.';
COMMENT ON COLUMN public.brands.marked_called_at IS
  'Ve3 — admin marked venue as called before approve.';
COMMENT ON COLUMN public.brands.claim_decision_emailed_at IS
  'Ve3 — last approve/reject decision email sent at.';

CREATE INDEX IF NOT EXISTS idx_brands_duplicate_of_brand_id
  ON public.brands (duplicate_of_brand_id)
  WHERE duplicate_of_brand_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.biz_review_venue_claim (uuid, text);

CREATE OR REPLACE FUNCTION public.biz_review_venue_claim (
  p_brand_id uuid,
  p_action text,
  p_rejection_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand public.brands%ROWTYPE;
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
  INTO v_brand
  FROM public.brands b
  WHERE b.id = p_brand_id
    AND b.deleted_at IS NULL
    AND b.kind = 'physical';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  IF p_action = 'mark_called' THEN
    IF v_brand.claim_status <> 'pending_review' THEN
      IF v_brand.marked_called_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'noop', true);
      END IF;
      RAISE EXCEPTION 'brand_not_pending_review';
    END IF;

    IF v_brand.marked_called_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'noop', true);
    END IF;

    UPDATE public.brands
    SET
      marked_called_at = now(),
      marked_called_by = auth.uid()
    WHERE id = p_brand_id;

    RETURN jsonb_build_object('ok', true, 'action', 'mark_called');
  END IF;

  IF p_action = 'need_more_info' THEN
    IF v_brand.claim_status <> 'pending_review' THEN
      RAISE EXCEPTION 'brand_not_pending_review';
    END IF;

    UPDATE public.brands
    SET claim_follow_up_at = now()
    WHERE id = p_brand_id;

    RETURN jsonb_build_object('ok', true, 'action', 'need_more_info');
  END IF;

  IF p_action = 'approve' THEN
    IF v_brand.claim_status = 'verified' THEN
      RETURN jsonb_build_object('ok', true, 'noop', true, 'claim_status', 'verified');
    END IF;

    IF v_brand.claim_status <> 'pending_review' THEN
      RAISE EXCEPTION 'brand_not_pending_review';
    END IF;

    IF v_brand.marked_called_at IS NULL THEN
      RAISE EXCEPTION 'must_mark_called_first';
    END IF;

    IF v_brand.google_place_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.brands b2
      WHERE b2.deleted_at IS NULL
        AND b2.id <> p_brand_id
        AND b2.google_place_id = v_brand.google_place_id
        AND b2.claim_status = 'verified'
    ) THEN
      RAISE EXCEPTION 'google_place_already_verified';
    END IF;

    UPDATE public.brands
    SET
      claim_status = 'verified',
      verified_at = now(),
      verified_by = auth.uid(),
      rejection_reason = NULL,
      claim_follow_up_at = NULL,
      duplicate_of_brand_id = NULL
    WHERE id = p_brand_id;

    IF v_brand.google_place_id IS NOT NULL THEN
      UPDATE public.brands
      SET duplicate_of_brand_id = p_brand_id
      WHERE deleted_at IS NULL
        AND id <> p_brand_id
        AND google_place_id = v_brand.google_place_id
        AND claim_status = 'pending_review'
        AND duplicate_of_brand_id IS DISTINCT FROM p_brand_id;

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

  -- reject
  IF v_brand.claim_status = 'rejected' THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'claim_status', 'rejected');
  END IF;

  IF v_brand.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'brand_not_pending_review';
  END IF;

  v_reason := nullif(trim(coalesce(p_rejection_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required';
  END IF;

  UPDATE public.brands
  SET
    claim_status = 'rejected',
    rejection_reason = v_reason,
    verified_at = NULL,
    verified_by = NULL,
    claim_follow_up_at = NULL,
    duplicate_of_brand_id = NULL
  WHERE id = p_brand_id;

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

GRANT EXECUTE ON FUNCTION public.biz_review_venue_claim (uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.biz_review_venue_claim IS
  'Ve3 — admin venue claim actions: mark_called, approve (requires call), reject, need_more_info.';

-- Structural verify
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'brands'
      AND column_name = 'rejection_reason'
  ) THEN
    RAISE EXCEPTION 'Ve3 verify FAIL: brands.rejection_reason missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'biz_review_venue_claim'
      AND pg_get_function_result(p.oid) = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'Ve3 verify FAIL: biz_review_venue_claim must return jsonb';
  END IF;
END;
$$;

COMMIT;
