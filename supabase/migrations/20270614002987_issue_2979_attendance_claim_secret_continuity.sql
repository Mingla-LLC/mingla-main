-- Issue #2979 — preserve legacy attendance claims while the governed secret
-- becomes the current issuer/verifier. No secret material is stored here.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS attendance_claim_token_generation text,
  ADD COLUMN IF NOT EXISTS attendance_claim_legacy_token_digest bytea,
  ADD COLUMN IF NOT EXISTS attendance_claim_legacy_token_created_at timestamptz;

-- Existing live proofs were made with the direct (legacy_v1) secret. Tag all
-- of them before tightening the state constraint; selection into the recovery
-- ledger remains the narrower, execution-time eligibility query below.
UPDATE public.orders
   SET attendance_claim_token_generation = 'legacy_v1'
 WHERE attendance_claim_token_digest IS NOT NULL
   AND attendance_claim_token_generation IS NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_attendance_claim_proof_state_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_attendance_claim_proof_state_check CHECK (
    attendance_claim_token_generation IN ('legacy_v1', 'governed_v2')
      OR attendance_claim_token_generation IS NULL
  ),
  ADD CONSTRAINT orders_attendance_claim_current_generation_check CHECK (
    (attendance_claim_token_digest IS NULL) =
      (attendance_claim_token_generation IS NULL)
  ),
  ADD CONSTRAINT orders_attendance_claim_current_digest_length_check CHECK (
    attendance_claim_token_digest IS NULL
      OR octet_length(attendance_claim_token_digest) = 32
  ),
  ADD CONSTRAINT orders_attendance_claim_legacy_pair_check CHECK (
    (attendance_claim_legacy_token_digest IS NULL) =
      (attendance_claim_legacy_token_created_at IS NULL)
  ),
  ADD CONSTRAINT orders_attendance_claim_legacy_digest_length_check CHECK (
    attendance_claim_legacy_token_digest IS NULL
      OR octet_length(attendance_claim_legacy_token_digest) = 32
  ),
  ADD CONSTRAINT orders_attendance_claim_proof_lifecycle_check CHECK (
    (attendance_claim_token_digest IS NULL
      AND attendance_claim_token_created_at IS NULL
      AND attendance_claim_token_consumed_at IS NULL)
    OR
    (attendance_claim_token_digest IS NOT NULL
      AND attendance_claim_token_created_at IS NOT NULL
      AND attendance_claim_token_consumed_at IS NULL)
    OR
    (attendance_claim_token_digest IS NULL
      AND attendance_claim_token_created_at IS NOT NULL
      AND attendance_claim_token_consumed_at IS NOT NULL
      AND attendance_claim_token_consumed_at >= attendance_claim_token_created_at)
  );

CREATE UNIQUE INDEX IF NOT EXISTS orders_attendance_claim_legacy_digest_uniq
  ON public.orders (attendance_claim_legacy_token_digest)
  WHERE attendance_claim_legacy_token_digest IS NOT NULL;

ALTER TABLE public.attendance_claim_deliveries
  DROP CONSTRAINT IF EXISTS attendance_claim_deliveries_kind_check;
ALTER TABLE public.attendance_claim_deliveries
  ADD CONSTRAINT attendance_claim_deliveries_kind_check CHECK (
    kind IN ('rsvp', 'order', 'order_recovery_email', 'order_recovery_sms')
  );
ALTER TABLE public.attendance_claim_deliveries
  ADD COLUMN IF NOT EXISTS provider_attempt_started_at timestamptz;

CREATE TABLE IF NOT EXISTS public.attendance_claim_recovery_items (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  recovery_generation text NOT NULL DEFAULT 'issue_2979_governed_v2'
    CHECK (recovery_generation = 'issue_2979_governed_v2'),
  selected_at timestamptz NOT NULL DEFAULT now(),
  selected_token_created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  requires_secondary_delivery boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'selected' CHECK (state IN (
    'selected', 'replacement_issued', 'delivery_safe', 'claimed',
    'no_longer_eligible', 'attention_required', 'legacy_retired'
  )),
  delivery_safe_at timestamptz,
  replacement_issued_at timestamptz,
  reconciled_at timestamptz,
  primary_delivery_id uuid REFERENCES public.attendance_claim_deliveries(id)
    ON DELETE SET NULL,
  secondary_delivery_id uuid REFERENCES public.attendance_claim_deliveries(id)
    ON DELETE SET NULL,
  resolved_via text CHECK (resolved_via IS NULL OR resolved_via IN (
    'governed_token', 'legacy_token', 'verified_identity',
    'lifecycle_ineligible'
  ))
);

ALTER TABLE public.attendance_claim_recovery_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_claim_recovery_items
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.attendance_claim_recovery_items TO service_role;

-- Select only currently entitling, unowned, unconsumed completed-checkout
-- orders with a reachable identifier. Counts are derived at execution time.
WITH selected AS (
  SELECT o.id
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    JOIN public.brands b ON b.id = e.brand_id
   WHERE o.buyer_user_id IS NULL
     AND o.attendance_claim_token_digest IS NOT NULL
     AND o.attendance_claim_token_consumed_at IS NULL
     AND o.payment_status IN ('paid', 'partial_refund')
     AND e.event_type IN ('event', 'trip', 'experience')
     AND e.visibility = 'public'
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live')
     AND EXISTS (
       SELECT 1 FROM public.tickets t
        WHERE t.order_id = o.id
          AND t.approval_status IN ('auto', 'approved')
          AND ((e.status = 'scheduled' AND t.status = 'valid')
            OR (e.status = 'live' AND t.status IN ('valid', 'used')))
     )
     AND EXISTS (
       SELECT 1 FROM public.ticket_checkout_sessions s
        WHERE s.order_id = o.id
          AND s.status IN ('paid_completed', 'free_completed')
     )
     AND (btrim(coalesce(o.buyer_email, '')) <> ''
       OR coalesce(o.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$')
)
UPDATE public.orders o
   SET attendance_claim_legacy_token_digest = o.attendance_claim_token_digest,
       attendance_claim_legacy_token_created_at =
         o.attendance_claim_token_created_at
  FROM selected s
 WHERE o.id = s.id
   AND o.attendance_claim_legacy_token_digest IS NULL;

INSERT INTO public.attendance_claim_recovery_items(
  order_id, selected_token_created_at, requires_secondary_delivery
)
SELECT o.id,
       o.attendance_claim_legacy_token_created_at,
       btrim(coalesce(o.buyer_email, '')) = ''
       OR EXISTS (
         SELECT 1 FROM public.ticket_order_notifications n
          WHERE n.order_id = o.id
            AND n.channel = 'email'
            AND n.status = 'failed_terminal'
       )
  FROM public.orders o
 WHERE o.attendance_claim_legacy_token_digest IS NOT NULL
ON CONFLICT (order_id) DO NOTHING;

INSERT INTO public.attendance_claim_deliveries(
  kind, source_id, event_id, status, next_attempt_at, last_error_code
)
SELECT 'order_recovery_email', r.order_id, o.event_id,
       CASE WHEN r.requires_secondary_delivery
         THEN 'failed_terminal' ELSE 'pending' END,
       CASE WHEN r.requires_secondary_delivery THEN NULL ELSE now() END,
       CASE WHEN r.requires_secondary_delivery
         THEN 'historical_or_unavailable_email' ELSE NULL END
  FROM public.attendance_claim_recovery_items r
  JOIN public.orders o ON o.id = r.order_id
ON CONFLICT (kind, source_id) DO NOTHING;

UPDATE public.attendance_claim_recovery_items r
   SET primary_delivery_id = d.id,
       updated_at = now()
  FROM public.attendance_claim_deliveries d
 WHERE d.kind = 'order_recovery_email'
   AND d.source_id = r.order_id
   AND r.primary_delivery_id IS NULL;

INSERT INTO public.attendance_claim_deliveries(
  kind, source_id, event_id, status, next_attempt_at
)
SELECT 'order_recovery_sms', r.order_id, o.event_id, 'pending', now()
  FROM public.attendance_claim_recovery_items r
  JOIN public.orders o ON o.id = r.order_id
 WHERE r.requires_secondary_delivery
ON CONFLICT (kind, source_id) DO NOTHING;

UPDATE public.attendance_claim_recovery_items r
   SET secondary_delivery_id = d.id,
       updated_at = now()
  FROM public.attendance_claim_deliveries d
 WHERE d.kind = 'order_recovery_sms'
   AND d.source_id = r.order_id
   AND r.secondary_delivery_id IS NULL;

CREATE OR REPLACE FUNCTION public.issue_order_attendance_claim_proof_v2(
  p_order_id uuid,
  p_event_id uuid,
  p_digest bytea,
  p_generation text,
  p_allow_retry_rotation boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_secondary boolean;
BEGIN
  IF p_order_id IS NULL OR p_event_id IS NULL
     OR p_digest IS NULL OR octet_length(p_digest) <> 32
     OR p_generation NOT IN ('legacy_v1', 'governed_v2') THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.id = p_order_id AND o.event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_order.buyer_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  SELECT e.* INTO v_event FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.event_type IN ('event', 'trip', 'experience')
     AND e.visibility = 'public'
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live');
  IF NOT FOUND OR v_order.payment_status NOT IN ('paid', 'partial_refund')
     OR NOT EXISTS (
       SELECT 1 FROM public.tickets t
        WHERE t.order_id = v_order.id
          AND t.approval_status IN ('auto', 'approved')
          AND ((v_event.status = 'scheduled' AND t.status = 'valid')
            OR (v_event.status = 'live' AND t.status IN ('valid', 'used')))
     ) THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  IF v_order.attendance_claim_token_digest IS NOT NULL
     AND v_order.attendance_claim_token_consumed_at IS NULL
     AND NOT p_allow_retry_rotation THEN
    RETURN jsonb_build_object(
      'result', 'already_issued',
      'generation', v_order.attendance_claim_token_generation
    );
  END IF;

  UPDATE public.orders
     SET attendance_claim_token_digest = p_digest,
         attendance_claim_token_generation = p_generation,
         attendance_claim_token_created_at = now(),
         attendance_claim_token_consumed_at = NULL,
         attendance_claim_legacy_token_digest = CASE
           WHEN p_generation = 'legacy_v1' THEN p_digest
           ELSE attendance_claim_legacy_token_digest END,
         attendance_claim_legacy_token_created_at = CASE
           WHEN p_generation = 'legacy_v1' THEN now()
           ELSE attendance_claim_legacy_token_created_at END
   WHERE id = v_order.id;

  IF p_generation = 'legacy_v1'
     AND EXISTS (
       SELECT 1 FROM public.ticket_checkout_sessions s
        WHERE s.order_id = v_order.id
          AND s.status IN ('paid_completed', 'free_completed')
     )
     AND (btrim(coalesce(v_order.buyer_email, '')) <> ''
       OR coalesce(v_order.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$') THEN
    v_secondary := btrim(coalesce(v_order.buyer_email, '')) = '' OR EXISTS (
      SELECT 1 FROM public.ticket_order_notifications n
       WHERE n.order_id = v_order.id
         AND n.channel = 'email'
         AND n.status = 'failed_terminal'
    );
    INSERT INTO public.attendance_claim_recovery_items(
      order_id, selected_token_created_at, requires_secondary_delivery
    ) VALUES (v_order.id, now(), v_secondary)
    ON CONFLICT (order_id) DO UPDATE SET
      selected_token_created_at = excluded.selected_token_created_at,
      requires_secondary_delivery =
        public.attendance_claim_recovery_items.requires_secondary_delivery
          OR excluded.requires_secondary_delivery,
      updated_at = now();
    INSERT INTO public.attendance_claim_deliveries(
      kind, source_id, event_id, status, next_attempt_at, last_error_code
    ) VALUES (
      'order_recovery_email', v_order.id, v_order.event_id,
      CASE WHEN v_secondary THEN 'failed_terminal' ELSE 'pending' END,
      CASE WHEN v_secondary THEN NULL ELSE now() END,
      CASE WHEN v_secondary THEN 'historical_or_unavailable_email' ELSE NULL END
    ) ON CONFLICT (kind, source_id) DO NOTHING;
    UPDATE public.attendance_claim_recovery_items r
       SET primary_delivery_id = d.id, updated_at = now()
      FROM public.attendance_claim_deliveries d
     WHERE r.order_id = v_order.id
       AND d.kind = 'order_recovery_email' AND d.source_id = v_order.id;
    IF v_secondary THEN
      INSERT INTO public.attendance_claim_deliveries(
        kind, source_id, event_id, status, next_attempt_at
      ) VALUES (
        'order_recovery_sms', v_order.id, v_order.event_id, 'pending', now()
      ) ON CONFLICT (kind, source_id) DO NOTHING;
      UPDATE public.attendance_claim_recovery_items r
         SET secondary_delivery_id = d.id, updated_at = now()
        FROM public.attendance_claim_deliveries d
       WHERE r.order_id = v_order.id
         AND d.kind = 'order_recovery_sms' AND d.source_id = v_order.id;
    END IF;
  ELSIF p_generation = 'governed_v2' THEN
    UPDATE public.attendance_claim_recovery_items
       SET state = 'replacement_issued',
           replacement_issued_at = now(),
           updated_at = now()
     WHERE order_id = v_order.id
       AND state IN ('selected', 'replacement_issued');
  END IF;

  RETURN jsonb_build_object('result', 'issued', 'generation', p_generation);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_order_attendance_claim_proof_v2(
  uuid, uuid, bytea, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_order_attendance_claim_proof_v2(
  uuid, uuid, bytea, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_order_attendance_claim_proof(
  p_order_id uuid,
  p_event_id uuid,
  p_digest bytea,
  p_allow_retry_rotation boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.issue_order_attendance_claim_proof_v2(
    p_order_id, p_event_id, p_digest, 'legacy_v1', p_allow_retry_rotation);
$function$;

CREATE OR REPLACE FUNCTION public.claim_attendance_internal_v2(
  p_user_id uuid,
  p_kind text,
  p_event_id uuid,
  p_source_id uuid,
  p_current_proof_digest bytea,
  p_legacy_proof_digest bytea DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_owner uuid;
  v_current bytea;
  v_legacy bytea;
  v_generation text;
  v_eligible boolean := false;
  v_current_match boolean := false;
  v_legacy_match boolean := false;
  v_resolved text;
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL OR p_source_id IS NULL
     OR p_current_proof_digest IS NULL
     OR octet_length(p_current_proof_digest) <> 32
     OR (p_legacy_proof_digest IS NOT NULL
       AND octet_length(p_legacy_proof_digest) <> 32)
     OR p_kind NOT IN ('rsvp', 'order') THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.visibility = 'public' AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live');
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'ineligible'); END IF;
  IF (p_kind = 'rsvp' AND v_event.event_type <> 'rsvp')
     OR (p_kind = 'order'
       AND v_event.event_type NOT IN ('event', 'trip', 'experience')) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF p_kind = 'rsvp' THEN
    SELECT r.user_id,
           CASE WHEN r.pass_recovery_token_hash ~ '^[0-9a-fA-F]{64}$'
             THEN decode(r.pass_recovery_token_hash, 'hex') END,
           r.rsvp_status = 'going' AND r.approval_status = 'approved'
      INTO v_owner, v_current, v_eligible
      FROM public.event_rsvps r
     WHERE r.id = p_source_id AND r.event_id = p_event_id FOR UPDATE;
  ELSE
    SELECT o.buyer_user_id, o.attendance_claim_token_digest,
           o.attendance_claim_legacy_token_digest,
           o.attendance_claim_token_generation,
           o.payment_status IN ('paid', 'partial_refund') AND EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.order_id = o.id
                AND t.approval_status IN ('auto', 'approved')
                AND ((v_event.status = 'scheduled' AND t.status = 'valid')
                  OR (v_event.status = 'live'
                    AND t.status IN ('valid', 'used')))
           )
      INTO v_owner, v_current, v_legacy, v_generation, v_eligible
      FROM public.orders o
     WHERE o.id = p_source_id AND o.event_id = p_event_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  IF v_owner = p_user_id THEN
    RETURN jsonb_build_object('result', 'already_claimed', 'eventId', p_event_id);
  END IF;
  IF v_owner IS NOT NULL THEN RETURN jsonb_build_object('result', 'conflict'); END IF;
  IF p_kind = 'order' AND v_legacy IS NOT NULL
     AND p_legacy_proof_digest IS NULL THEN
    RETURN jsonb_build_object('result', 'secret_unavailable');
  END IF;

  v_current_match := v_current IS NOT NULL
    AND public.fixed_digest_equal(v_current, p_current_proof_digest);
  v_legacy_match := v_legacy IS NOT NULL
    AND p_legacy_proof_digest IS NOT NULL
    AND public.fixed_digest_equal(v_legacy, p_legacy_proof_digest);
  IF NOT v_current_match AND NOT v_legacy_match THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  IF NOT v_eligible THEN RETURN jsonb_build_object('result', 'ineligible'); END IF;

  IF p_kind = 'rsvp' THEN
    IF EXISTS (
      SELECT 1 FROM public.event_rsvps other
       WHERE other.event_id = p_event_id AND other.user_id = p_user_id
         AND other.id <> p_source_id
    ) THEN RETURN jsonb_build_object('result', 'conflict'); END IF;
    UPDATE public.event_rsvps SET user_id = p_user_id WHERE id = p_source_id;
  ELSE
    v_resolved := CASE
      WHEN v_current_match AND v_generation = 'governed_v2'
        THEN 'governed_token'
      WHEN v_legacy_match THEN 'legacy_token'
      ELSE 'legacy_token' END;
    UPDATE public.orders
       SET buyer_user_id = p_user_id,
           attendance_claim_token_digest = NULL,
           attendance_claim_token_generation = NULL,
           attendance_claim_legacy_token_digest = NULL,
           attendance_claim_legacy_token_created_at = NULL,
           attendance_claim_token_consumed_at = now()
     WHERE id = p_source_id;
    UPDATE public.attendance_claim_recovery_items
       SET state = 'claimed', resolved_via = v_resolved,
           reconciled_at = now(), updated_at = now()
     WHERE order_id = p_source_id;
  END IF;
  RETURN jsonb_build_object('result', 'claimed', 'eventId', p_event_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_attendance_internal_v2(
  uuid, text, uuid, uuid, bytea, bytea) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_internal_v2(
  uuid, text, uuid, uuid, bytea, bytea) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_attendance_internal(
  p_user_id uuid, p_kind text, p_event_id uuid, p_source_id uuid,
  p_proof_digest bytea
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.claim_attendance_internal_v2(
    p_user_id, p_kind, p_event_id, p_source_id, p_proof_digest, NULL);
$function$;

-- Replace only the proof-retirement portion of the #2217 identity claim. The
-- provider-verified identifier source and single-argument signature remain.
CREATE OR REPLACE FUNCTION public.claim_attendance_by_verified_identity(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_emails text[];
  v_phones text[];
  v_order record;
  v_claimed jsonb := '[]'::jsonb;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim'; END IF;
  SELECT coalesce(array_agg(value) FILTER (WHERE kind = 'email'), '{}'::text[]),
         coalesce(array_agg(value) FILTER (WHERE kind = 'phone'), '{}'::text[])
    INTO v_emails, v_phones
    FROM public.verified_account_identifiers(p_user_id);
  IF coalesce(array_length(v_emails, 1), 0) = 0
     AND coalesce(array_length(v_phones, 1), 0) = 0 THEN
    RETURN jsonb_build_object('claimed', v_claimed, 'count', 0);
  END IF;

  FOR v_order IN
    SELECT o.id, o.event_id
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
     WHERE o.buyer_user_id IS NULL
       AND o.attendance_identity_claim_armed_at IS NOT NULL
       AND ((btrim(coalesce(o.buyer_email, '')) <> ''
          AND lower(btrim(o.buyer_email)) = ANY (v_emails))
        OR (coalesce(o.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$'
          AND o.buyer_phone_e164 = ANY (v_phones)))
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.visibility = 'public' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.order_id = o.id
            AND t.approval_status IN ('auto', 'approved')
            AND ((e.status = 'scheduled' AND t.status = 'valid')
              OR (e.status = 'live' AND t.status IN ('valid', 'used')))
       )
     ORDER BY o.created_at, o.id LIMIT 25
  LOOP
    UPDATE public.orders o
       SET buyer_user_id = p_user_id,
           attendance_claim_token_digest = NULL,
           attendance_claim_token_generation = NULL,
           attendance_claim_legacy_token_digest = NULL,
           attendance_claim_legacy_token_created_at = NULL,
           attendance_claim_token_consumed_at = CASE
             WHEN o.attendance_claim_token_created_at IS NOT NULL
               THEN coalesce(o.attendance_claim_token_consumed_at, now())
             ELSE o.attendance_claim_token_consumed_at END
     WHERE o.id = v_order.id AND o.buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.attendance_claim_recovery_items
       SET state = 'claimed', resolved_via = 'verified_identity',
           reconciled_at = now(), updated_at = now()
     WHERE order_id = v_order.id;
    PERFORM public.add_buyer_to_event_chat(
      v_order.event_id, p_user_id, v_order.id, NULL);
    UPDATE public.pending_trip_chat_claims
       SET claimed_at = now(), claimed_by_user_id = p_user_id
     WHERE order_id = v_order.id AND claimed_at IS NULL;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'orderId', v_order.id, 'eventId', v_order.event_id));
  END LOOP;
  RETURN jsonb_build_object(
    'claimed', v_claimed, 'count', jsonb_array_length(v_claimed));
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_issue_2979_attendance_claim_recovery()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'total', count(*),
    'selected', count(*) FILTER (WHERE state = 'selected'),
    'replacementIssued', count(*) FILTER (WHERE state = 'replacement_issued'),
    'deliverySafe', count(*) FILTER (WHERE state = 'delivery_safe'),
    'claimed', count(*) FILTER (WHERE state = 'claimed'),
    'attentionRequired', count(*) FILTER (WHERE state = 'attention_required'),
    'legacyRetired', count(*) FILTER (WHERE state = 'legacy_retired'),
    'legacyProofs', count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = attendance_claim_recovery_items.order_id
         AND o.attendance_claim_legacy_token_digest IS NOT NULL
    ))
  ) FROM public.attendance_claim_recovery_items;
$function$;

CREATE OR REPLACE FUNCTION public.claim_issue_2979_attendance_claim_recovery_batch(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE(
  order_id uuid, event_id uuid, delivery_id uuid, lease_id uuid,
  channel text, attempt_count integer, buyer_email text,
  buyer_phone_e164 text, event_title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 10), 1), 25);
  v_lease_seconds integer := LEAST(GREATEST(coalesce(p_lease_seconds, 120), 30), 300);
BEGIN
  -- Only a lease durably marked immediately before provider I/O is acceptance
  -- ambiguous. A crash before that marker is a definite no-send and may retry.
  WITH ambiguous AS (
    UPDATE public.attendance_claim_deliveries d
       SET status = 'sent', delivered_at = now(),
           last_error_code = 'provider_acceptance_ambiguous',
           lease_id = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE d.kind IN ('order_recovery_email', 'order_recovery_sms')
       AND d.status = 'processing' AND d.lease_expires_at <= now()
       AND d.provider_attempt_started_at IS NOT NULL
     RETURNING d.source_id
  )
  UPDATE public.attendance_claim_recovery_items r
     SET state = 'delivery_safe', delivery_safe_at = coalesce(r.delivery_safe_at, now()),
         updated_at = now()
   WHERE r.order_id IN (SELECT e.source_id FROM ambiguous e)
     AND r.state IN ('selected', 'replacement_issued');

  UPDATE public.attendance_claim_deliveries d
     SET status = 'failed_retryable', next_attempt_at = now(),
         lease_id = NULL, lease_expires_at = NULL,
         provider_attempt_started_at = NULL,
         last_error_code = 'lease_expired_before_provider', updated_at = now()
   WHERE d.kind IN ('order_recovery_email', 'order_recovery_sms')
     AND d.status = 'processing' AND d.lease_expires_at <= now()
     AND d.provider_attempt_started_at IS NULL;

  -- Re-decide lifecycle eligibility before leasing. This is deliberately the
  -- same ownership/payment/event/ticket truth used by issuance, not the
  -- historical selection count.
  UPDATE public.attendance_claim_recovery_items r
     SET state = 'no_longer_eligible',
         resolved_via = 'lifecycle_ineligible',
         reconciled_at = now(), updated_at = now()
   WHERE r.state IN ('selected', 'replacement_issued')
     AND NOT EXISTS (
       SELECT 1
         FROM public.orders o
         JOIN public.events e ON e.id = o.event_id
         JOIN public.brands b ON b.id = e.brand_id
        WHERE o.id = r.order_id
          AND o.buyer_user_id IS NULL
          AND o.attendance_claim_token_consumed_at IS NULL
          AND o.attendance_claim_legacy_token_digest IS NOT NULL
          AND o.payment_status IN ('paid', 'partial_refund')
          AND e.event_type IN ('event', 'trip', 'experience')
          AND e.visibility = 'public'
          AND e.deleted_at IS NULL AND b.deleted_at IS NULL
          AND e.status IN ('scheduled', 'live')
          AND EXISTS (
            SELECT 1 FROM public.tickets t
             WHERE t.order_id = o.id
               AND t.approval_status IN ('auto', 'approved')
               AND ((e.status = 'scheduled' AND t.status = 'valid')
                 OR (e.status = 'live' AND t.status IN ('valid', 'used')))
          )
     );
  UPDATE public.attendance_claim_deliveries d
     SET status = 'failed_terminal', next_attempt_at = NULL,
         lease_id = NULL, lease_expires_at = NULL,
         last_error_code = 'source_ineligible', updated_at = now()
   WHERE d.kind IN ('order_recovery_email', 'order_recovery_sms')
     AND d.status IN ('pending', 'failed_retryable')
     AND EXISTS (
       SELECT 1 FROM public.attendance_claim_recovery_items r
        WHERE r.order_id = d.source_id
          AND r.state = 'no_longer_eligible'
     );

  RETURN QUERY WITH candidates AS (
    SELECT d.id
      FROM public.attendance_claim_deliveries d
      JOIN public.attendance_claim_recovery_items r ON r.order_id = d.source_id
      JOIN public.orders o ON o.id = r.order_id
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
     WHERE d.kind IN ('order_recovery_email', 'order_recovery_sms')
       AND d.status IN ('pending', 'failed_retryable')
       AND d.next_attempt_at <= now()
       AND r.state IN ('selected', 'replacement_issued')
       AND o.buyer_user_id IS NULL
       AND o.attendance_claim_legacy_token_digest IS NOT NULL
       AND o.attendance_claim_token_consumed_at IS NULL
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.visibility = 'public' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL
       AND e.status IN ('scheduled', 'live')
       AND EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.order_id = o.id
            AND t.approval_status IN ('auto', 'approved')
            AND ((e.status = 'scheduled' AND t.status = 'valid')
              OR (e.status = 'live' AND t.status IN ('valid', 'used')))
       )
     ORDER BY d.created_at, d.id
     FOR UPDATE OF d SKIP LOCKED
     LIMIT v_limit
  ), leased AS (
    UPDATE public.attendance_claim_deliveries d
       SET status = 'processing', attempt_count = d.attempt_count + 1,
           next_attempt_at = NULL, lease_id = gen_random_uuid(),
           lease_expires_at = now() + make_interval(secs => v_lease_seconds),
           provider_attempt_started_at = NULL,
           updated_at = now()
      FROM candidates c WHERE d.id = c.id
    RETURNING d.*
  )
  SELECT l.source_id, l.event_id, l.id, l.lease_id,
         CASE l.kind WHEN 'order_recovery_email' THEN 'email' ELSE 'sms' END,
         l.attempt_count, o.buyer_email, o.buyer_phone_e164, e.title
    FROM leased l JOIN public.orders o ON o.id = l.source_id
    JOIN public.events e ON e.id = l.event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_issue_2979_attendance_claim_provider_attempt(
  p_order_id uuid,
  p_delivery_id uuid,
  p_lease_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.attendance_claim_deliveries
     SET provider_attempt_started_at = coalesce(provider_attempt_started_at, now()),
         updated_at = now()
   WHERE id = p_delivery_id AND source_id = p_order_id
     AND kind IN ('order_recovery_email', 'order_recovery_sms')
     AND status = 'processing' AND lease_id = p_lease_id
     AND lease_expires_at > now();
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_issue_2979_attendance_claim_delivery(
  p_order_id uuid,
  p_delivery_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_delivery public.attendance_claim_deliveries%ROWTYPE;
  v_secondary_id uuid;
  v_secondary_lease uuid;
BEGIN
  IF p_outcome NOT IN ('accepted', 'ambiguous', 'retryable', 'terminal') THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT d.* INTO v_delivery FROM public.attendance_claim_deliveries d
   WHERE d.id = p_delivery_id AND d.source_id = p_order_id
     AND d.kind IN ('order_recovery_email', 'order_recovery_sms')
   FOR UPDATE;
  IF NOT FOUND OR v_delivery.status <> 'processing'
     OR v_delivery.lease_id IS DISTINCT FROM p_lease_id THEN
    RETURN jsonb_build_object('result', 'stale_lease');
  END IF;

  IF p_outcome IN ('accepted', 'ambiguous') THEN
    IF v_delivery.provider_attempt_started_at IS NULL THEN
      RETURN jsonb_build_object('result', 'provider_boundary_missing');
    END IF;
    UPDATE public.attendance_claim_deliveries
       SET status = 'sent', delivered_at = now(), next_attempt_at = NULL,
           lease_id = NULL, lease_expires_at = NULL,
           last_error_code = CASE WHEN p_outcome = 'ambiguous'
             THEN 'provider_acceptance_ambiguous' ELSE NULL END,
           updated_at = now()
     WHERE id = v_delivery.id;
    UPDATE public.attendance_claim_recovery_items
       SET state = 'delivery_safe', delivery_safe_at = coalesce(delivery_safe_at, now()),
           updated_at = now()
     WHERE order_id = p_order_id;
    RETURN jsonb_build_object('result', 'delivery_safe');
  END IF;

  IF p_outcome = 'retryable' AND v_delivery.attempt_count < 5 THEN
    UPDATE public.attendance_claim_deliveries
       SET status = 'failed_retryable',
           next_attempt_at = now() + make_interval(secs => LEAST(
             3600, 60 * (2 ^ GREATEST(v_delivery.attempt_count - 1, 0))::integer)),
           lease_id = NULL, lease_expires_at = NULL,
           provider_attempt_started_at = NULL,
           last_error_code = left(coalesce(p_error_code, 'retryable'), 80),
           updated_at = now()
     WHERE id = v_delivery.id;
    RETURN jsonb_build_object('result', 'retryable');
  END IF;

  UPDATE public.attendance_claim_deliveries
     SET status = 'failed_terminal', next_attempt_at = NULL,
         lease_id = NULL, lease_expires_at = NULL,
         last_error_code = left(coalesce(p_error_code, 'terminal'), 80),
         updated_at = now()
   WHERE id = v_delivery.id;

  IF v_delivery.kind = 'order_recovery_email'
     AND EXISTS (
       SELECT 1 FROM public.orders o WHERE o.id = p_order_id
         AND coalesce(o.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$'
     ) THEN
    INSERT INTO public.attendance_claim_deliveries(
      kind, source_id, event_id, status, attempt_count,
      next_attempt_at, lease_id, lease_expires_at
    ) VALUES (
      'order_recovery_sms', p_order_id, v_delivery.event_id, 'processing', 1,
      NULL, gen_random_uuid(), now() + interval '120 seconds'
    )
    ON CONFLICT (kind, source_id) DO UPDATE SET
      status = 'processing', attempt_count =
        public.attendance_claim_deliveries.attempt_count + 1,
      next_attempt_at = NULL, lease_id = gen_random_uuid(),
      lease_expires_at = now() + interval '120 seconds', updated_at = now()
      , provider_attempt_started_at = NULL
    WHERE public.attendance_claim_deliveries.status IN ('pending', 'failed_retryable')
    RETURNING id, lease_id INTO v_secondary_id, v_secondary_lease;
    IF v_secondary_id IS NOT NULL THEN
      UPDATE public.attendance_claim_recovery_items
         SET requires_secondary_delivery = true,
             secondary_delivery_id = v_secondary_id,
             state = 'replacement_issued', updated_at = now()
       WHERE order_id = p_order_id;
      RETURN jsonb_build_object(
        'result', 'secondary_required',
        'deliveryId', v_secondary_id,
        'leaseId', v_secondary_lease
      );
    END IF;
  END IF;

  UPDATE public.attendance_claim_recovery_items
     SET state = 'attention_required', updated_at = now()
   WHERE order_id = p_order_id;
  RETURN jsonb_build_object('result', 'attention_required');
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_issue_2979_attendance_claim_recovery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_retired integer;
  v_latest_safe timestamptz;
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

  SELECT max(delivery_safe_at) INTO v_latest_safe
    FROM public.attendance_claim_recovery_items
   WHERE state = 'delivery_safe';
  IF v_latest_safe IS NOT NULL AND v_latest_safe > now() - interval '72 hours' THEN
    RAISE EXCEPTION 'issue_2979_grace_period_active';
  END IF;

  WITH retired AS (
    UPDATE public.orders o
       SET attendance_claim_legacy_token_digest = NULL,
           attendance_claim_legacy_token_created_at = NULL
      FROM public.attendance_claim_recovery_items r
     WHERE r.order_id = o.id
       AND r.state IN ('delivery_safe', 'no_longer_eligible')
       AND o.attendance_claim_legacy_token_digest IS NOT NULL
    RETURNING o.id
  ) SELECT count(*) INTO v_retired FROM retired;
  UPDATE public.attendance_claim_recovery_items
     SET state = 'legacy_retired', reconciled_at = now(), updated_at = now()
   WHERE state IN ('delivery_safe', 'no_longer_eligible');
  RETURN jsonb_build_object('result', 'finalized', 'retired', v_retired);
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_issue_2979_attendance_claim_recovery()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_issue_2979_attendance_claim_recovery_batch(integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_issue_2979_attendance_claim_delivery(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_issue_2979_attendance_claim_provider_attempt(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_issue_2979_attendance_claim_recovery()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_issue_2979_attendance_claim_recovery()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_issue_2979_attendance_claim_recovery_batch(integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_issue_2979_attendance_claim_delivery(uuid, uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_issue_2979_attendance_claim_provider_attempt(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_issue_2979_attendance_claim_recovery()
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
