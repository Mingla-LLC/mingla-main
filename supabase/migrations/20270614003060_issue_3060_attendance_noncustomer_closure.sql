-- #3060 — Seth confirmed the #2979 recovery population contains no current
-- buyers. Record that business decision without fabricating delivery, deleting
-- history, or weakening the ordinary lifecycle/delivery-safe retirement path.

BEGIN;

CREATE TABLE public.attendance_claim_recovery_operator_closures (
  closure_id text PRIMARY KEY CHECK (
    closure_id = 'issue_3060_no_current_buyers'
  ),
  expected_count integer NOT NULL CHECK (expected_count > 0),
  set_sha256 text NOT NULL CHECK (set_sha256 ~ '^[0-9a-f]{64}$'),
  decision_reference text NOT NULL CHECK (
    decision_reference =
      'https://github.com/Mingla-LLC/mingla-main/issues/2979#issuecomment-5514866755'
  ),
  closed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attendance_claim_recovery_operator_closures
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_claim_recovery_operator_closures
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.attendance_claim_recovery_operator_closures
  TO service_role;

ALTER TABLE public.attendance_claim_recovery_items
  ADD COLUMN operator_closure_id text
    REFERENCES public.attendance_claim_recovery_operator_closures(closure_id)
    ON DELETE RESTRICT;

ALTER TABLE public.attendance_claim_recovery_items
  DROP CONSTRAINT IF EXISTS attendance_claim_recovery_items_resolved_via_check;
ALTER TABLE public.attendance_claim_recovery_items
  ADD CONSTRAINT attendance_claim_recovery_items_resolved_via_check CHECK (
    resolved_via IS NULL OR resolved_via IN (
      'governed_token', 'legacy_token', 'verified_identity',
      'lifecycle_ineligible', 'operator_confirmed_no_current_buyer'
    )
  );

ALTER TABLE public.attendance_claim_recovery_items
  DROP CONSTRAINT IF EXISTS attendance_claim_recovery_items_operator_resolution_check;
ALTER TABLE public.attendance_claim_recovery_items
  ADD CONSTRAINT attendance_claim_recovery_items_operator_resolution_check CHECK (
    (
      resolved_via = 'operator_confirmed_no_current_buyer'
      AND operator_closure_id = 'issue_3060_no_current_buyers'
    ) OR (
      resolved_via IS DISTINCT FROM 'operator_confirmed_no_current_buyer'
      AND operator_closure_id IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.close_issue_3060_attendance_noncustomer_history(
  p_expected_count integer,
  p_expected_set_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_closure constant text := 'issue_3060_no_current_buyers';
  v_decision constant text :=
    'https://github.com/Mingla-LLC/mingla-main/issues/2979#issuecomment-5514866755';
  v_expected_sha text := lower(btrim(coalesce(p_expected_set_sha256, '')));
  v_actual_count integer;
  v_open_count integer;
  v_actual_sha text;
  v_transitioned integer;
  v_terminalized integer;
  v_existing public.attendance_claim_recovery_operator_closures%ROWTYPE;
BEGIN
  IF p_expected_count IS NULL OR p_expected_count <= 0
     OR v_expected_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'issue_3060_invalid_expected_set';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('issue_2979_attendance_claim_recovery')
  );

  SELECT * INTO v_existing
    FROM public.attendance_claim_recovery_operator_closures
   WHERE closure_id = v_closure
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.expected_count = p_expected_count
       AND v_existing.set_sha256 = v_expected_sha
       AND v_existing.decision_reference = v_decision THEN
      RETURN jsonb_build_object(
        'result', 'already_closed',
        'closed', v_existing.expected_count
      );
    END IF;
    RAISE EXCEPTION 'issue_3060_closure_receipt_mismatch';
  END IF;

  SELECT count(*),
         count(*) FILTER (
           WHERE state IN ('selected', 'replacement_issued')
         ),
         encode(
           extensions.digest(
             convert_to(
               coalesce(
                 string_agg(order_id::text, ',' ORDER BY order_id),
                 ''
               ),
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         )
    INTO v_actual_count, v_open_count, v_actual_sha
    FROM public.attendance_claim_recovery_items;

  IF v_actual_count <> p_expected_count
     OR v_open_count <> p_expected_count
     OR v_actual_sha <> v_expected_sha THEN
    RAISE EXCEPTION 'issue_3060_recovery_set_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.attendance_claim_recovery_items r
      JOIN public.orders o ON o.id = r.order_id
     WHERE o.buyer_user_id IS NOT NULL
        OR o.attendance_claim_token_consumed_at IS NOT NULL
        OR o.attendance_claim_legacy_token_digest IS NULL
  ) THEN
    RAISE EXCEPTION 'issue_3060_buyer_activity_detected';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.attendance_claim_recovery_items r
      LEFT JOIN public.attendance_claim_deliveries primary_delivery
        ON primary_delivery.id = r.primary_delivery_id
       AND primary_delivery.source_id = r.order_id
       AND primary_delivery.kind = 'order_recovery_email'
      LEFT JOIN public.attendance_claim_deliveries secondary_delivery
        ON secondary_delivery.id = r.secondary_delivery_id
       AND secondary_delivery.source_id = r.order_id
       AND secondary_delivery.kind = 'order_recovery_sms'
     WHERE primary_delivery.id IS NULL
        OR (r.requires_secondary_delivery AND secondary_delivery.id IS NULL)
        OR (NOT r.requires_secondary_delivery AND r.secondary_delivery_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'issue_3060_delivery_inventory_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.attendance_claim_deliveries d
      JOIN public.attendance_claim_recovery_items r ON r.order_id = d.source_id
     WHERE d.kind IN ('order_recovery_email', 'order_recovery_sms')
       AND (
         (d.kind = 'order_recovery_email' AND d.id <> r.primary_delivery_id)
         OR (
           d.kind = 'order_recovery_sms'
           AND d.id IS DISTINCT FROM r.secondary_delivery_id
         )
       )
  ) THEN
    RAISE EXCEPTION 'issue_3060_delivery_inventory_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.attendance_claim_deliveries d
      JOIN public.attendance_claim_recovery_items r ON r.order_id = d.source_id
     WHERE d.kind IN ('order_recovery_email', 'order_recovery_sms')
       AND (
         d.status NOT IN ('pending', 'failed_terminal')
         OR d.attempt_count <> 0
         OR d.provider_attempt_started_at IS NOT NULL
         OR d.delivered_at IS NOT NULL
         OR d.lease_id IS NOT NULL
         OR d.lease_expires_at IS NOT NULL
         OR (
           d.status = 'failed_terminal'
           AND d.last_error_code IS DISTINCT FROM
             'historical_or_unavailable_email'
         )
       )
  ) THEN
    RAISE EXCEPTION 'issue_3060_provider_activity_detected';
  END IF;

  INSERT INTO public.attendance_claim_recovery_operator_closures(
    closure_id, expected_count, set_sha256, decision_reference
  ) VALUES (v_closure, p_expected_count, v_expected_sha, v_decision);

  UPDATE public.attendance_claim_recovery_items
     SET state = 'no_longer_eligible',
         resolved_via = 'operator_confirmed_no_current_buyer',
         operator_closure_id = v_closure,
         reconciled_at = now(),
         updated_at = now()
   WHERE state IN ('selected', 'replacement_issued');
  GET DIAGNOSTICS v_transitioned = ROW_COUNT;
  IF v_transitioned <> p_expected_count THEN
    RAISE EXCEPTION 'issue_3060_transition_count_mismatch';
  END IF;

  UPDATE public.attendance_claim_deliveries d
     SET status = 'failed_terminal',
         next_attempt_at = NULL,
         lease_id = NULL,
         lease_expires_at = NULL,
         provider_attempt_started_at = NULL,
         last_error_code = 'operator_confirmed_no_current_buyer',
         updated_at = now()
   WHERE d.kind IN ('order_recovery_email', 'order_recovery_sms')
     AND d.status = 'pending'
     AND EXISTS (
       SELECT 1
         FROM public.attendance_claim_recovery_items r
        WHERE r.order_id = d.source_id
          AND r.operator_closure_id = v_closure
     );
  GET DIAGNOSTICS v_terminalized = ROW_COUNT;

  RETURN jsonb_build_object(
    'result', 'closed',
    'closed', p_expected_count,
    'terminalized', v_terminalized
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.close_issue_3060_attendance_noncustomer_history(
  integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_issue_3060_attendance_noncustomer_history(
  integer, text
) TO service_role;

-- Preserve the #2979 finalizer as the sole retirement owner. The ordinary
-- delivery-safe and lifecycle-ineligible paths are unchanged. Only rows tied
-- to the durable #3060 operator receipt also clear their active proof, because
-- no governed replacement was delivered and no current buyer exists to claim.
CREATE OR REPLACE FUNCTION public.finalize_issue_2979_attendance_claim_recovery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_retired integer;
  v_latest_safe timestamptz;
  v_operator_count integer;
  v_operator_sha text;
  v_operator_receipt
    public.attendance_claim_recovery_operator_closures%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('issue_2979_attendance_claim_recovery'));
  IF EXISTS (SELECT 1 FROM public.attendance_claim_recovery_items
    WHERE state IN ('selected', 'replacement_issued', 'attention_required')) THEN
    RAISE EXCEPTION 'issue_2979_recovery_incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_claim_deliveries d
    JOIN public.attendance_claim_recovery_items r ON r.order_id = d.source_id
    WHERE d.kind IN ('order_recovery_email', 'order_recovery_sms')
      AND d.status IN ('pending', 'processing', 'failed_retryable')
  ) THEN RAISE EXCEPTION 'issue_2979_delivery_work_remaining'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_items r
    JOIN public.orders o ON o.id = r.order_id
    WHERE r.state = 'delivery_safe'
      AND (o.attendance_claim_token_generation <> 'governed_v2'
        OR o.attendance_claim_token_digest IS NULL)
  ) THEN RAISE EXCEPTION 'issue_2979_governed_proof_missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_items r
    WHERE r.state = 'delivery_safe' AND NOT EXISTS (
      SELECT 1 FROM public.attendance_claim_deliveries d
       WHERE d.source_id = r.order_id
         AND d.kind IN ('order_recovery_email', 'order_recovery_sms')
         AND d.status = 'sent'
    )
  ) THEN RAISE EXCEPTION 'issue_2979_delivery_reconciliation_failed'; END IF;
  SELECT * INTO v_operator_receipt
    FROM public.attendance_claim_recovery_operator_closures
   WHERE closure_id = 'issue_3060_no_current_buyers';
  IF FOUND THEN
    SELECT count(*),
           encode(
             extensions.digest(
               convert_to(
                 coalesce(
                   string_agg(r.order_id::text, ',' ORDER BY r.order_id),
                   ''
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           )
      INTO v_operator_count, v_operator_sha
      FROM public.attendance_claim_recovery_items r
     WHERE r.operator_closure_id = v_operator_receipt.closure_id
       AND r.resolved_via = 'operator_confirmed_no_current_buyer';
    IF v_operator_receipt.decision_reference <>
         'https://github.com/Mingla-LLC/mingla-main/issues/2979#issuecomment-5514866755'
       OR v_operator_count <> v_operator_receipt.expected_count
       OR v_operator_sha <> v_operator_receipt.set_sha256 THEN
      RAISE EXCEPTION 'issue_3060_operator_receipt_mismatch';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_items r
     WHERE r.resolved_via = 'operator_confirmed_no_current_buyer'
        OR r.operator_closure_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'issue_3060_operator_receipt_missing';
  END IF;

  SELECT max(delivery_safe_at) INTO v_latest_safe
    FROM public.attendance_claim_recovery_items
   WHERE state = 'delivery_safe';
  IF v_latest_safe IS NOT NULL AND v_latest_safe > now() - interval '72 hours' THEN
    RAISE EXCEPTION 'issue_2979_grace_period_active';
  END IF;

  WITH retired AS (
    UPDATE public.orders o
       SET attendance_claim_token_digest = CASE
             WHEN r.resolved_via = 'operator_confirmed_no_current_buyer'
               THEN NULL
             ELSE o.attendance_claim_token_digest
           END,
           attendance_claim_token_generation = CASE
             WHEN r.resolved_via = 'operator_confirmed_no_current_buyer'
               THEN NULL
             ELSE o.attendance_claim_token_generation
           END,
           attendance_claim_token_created_at = CASE
             WHEN r.resolved_via = 'operator_confirmed_no_current_buyer'
               THEN NULL
             ELSE o.attendance_claim_token_created_at
           END,
           attendance_claim_legacy_token_digest = NULL,
           attendance_claim_legacy_token_created_at = NULL
      FROM public.attendance_claim_recovery_items r
     WHERE r.order_id = o.id
       AND r.state IN ('delivery_safe', 'no_longer_eligible')
       AND (
         o.attendance_claim_legacy_token_digest IS NOT NULL
         OR (
           r.resolved_via = 'operator_confirmed_no_current_buyer'
           AND o.attendance_claim_token_digest IS NOT NULL
         )
       )
    RETURNING o.id
  ) SELECT count(*) INTO v_retired FROM retired;
  UPDATE public.attendance_claim_recovery_items
     SET state = 'legacy_retired', reconciled_at = now(), updated_at = now()
   WHERE state IN ('delivery_safe', 'no_longer_eligible');
  RETURN jsonb_build_object('result', 'finalized', 'retired', v_retired);
END;
$function$;

COMMIT;
NOTIFY pgrst, 'reload schema';
