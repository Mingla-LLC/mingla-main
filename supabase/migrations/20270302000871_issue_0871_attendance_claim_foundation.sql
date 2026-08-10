-- Issue #871 — attendance ownership claim foundation.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS attendance_claim_token_digest bytea,
  ADD COLUMN IF NOT EXISTS attendance_claim_token_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_claim_token_consumed_at timestamptz;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_attendance_claim_proof_state_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_attendance_claim_proof_state_check CHECK (
    (attendance_claim_token_digest IS NULL
      AND attendance_claim_token_created_at IS NULL
      AND attendance_claim_token_consumed_at IS NULL)
    OR
    (octet_length(attendance_claim_token_digest) = 32
      AND attendance_claim_token_created_at IS NOT NULL
      AND attendance_claim_token_consumed_at IS NULL)
    OR
    (attendance_claim_token_digest IS NULL
      AND attendance_claim_token_created_at IS NOT NULL
      AND attendance_claim_token_consumed_at IS NOT NULL
      AND attendance_claim_token_consumed_at >= attendance_claim_token_created_at)
  );

CREATE UNIQUE INDEX IF NOT EXISTS orders_attendance_claim_unconsumed_digest_uniq
  ON public.orders (attendance_claim_token_digest)
  WHERE attendance_claim_token_digest IS NOT NULL
    AND attendance_claim_token_consumed_at IS NULL;

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS attendance_claim_link_window_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_claim_link_attempts integer NOT NULL DEFAULT 0
    CHECK (attendance_claim_link_attempts >= 0);

CREATE TABLE IF NOT EXISTS public.attendance_claim_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('rsvp', 'order')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  outcome text,
  CONSTRAINT attendance_claim_attempts_outcome_check CHECK (
    outcome IS NULL OR outcome IN (
      'success', 'idempotent_success', 'invalid', 'ineligible',
      'conflict', 'rate_limited', 'internal_error'
    )
  ),
  CONSTRAINT attendance_claim_attempts_lifecycle_check CHECK (
    (completed_at IS NULL AND outcome IS NULL)
    OR (completed_at IS NOT NULL AND outcome IS NOT NULL
      AND completed_at >= started_at)
  )
);

CREATE OR REPLACE FUNCTION public.guard_attendance_claim_attempt_terminal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF OLD.completed_at IS NOT NULL AND (
    NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.outcome IS DISTINCT FROM OLD.outcome
  ) THEN
    RAISE EXCEPTION 'attendance_claim_attempt_already_terminal';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS attendance_claim_attempt_terminal_guard
  ON public.attendance_claim_attempts;
CREATE TRIGGER attendance_claim_attempt_terminal_guard
BEFORE UPDATE ON public.attendance_claim_attempts
FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_claim_attempt_terminal();

ALTER TABLE public.attendance_claim_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_claim_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_claim_attempts TO service_role;

CREATE INDEX IF NOT EXISTS attendance_claim_attempts_rate_idx
  ON public.attendance_claim_attempts (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.attendance_claim_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('rsvp', 'order')),
  source_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category_key text NOT NULL DEFAULT 'attendance_claim_available'
    CHECK (category_key = 'attendance_claim_available'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed_retryable', 'failed_terminal')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz DEFAULT now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_claim_deliveries_retry_state_check CHECK (
    (status IN ('pending', 'failed_retryable') AND next_attempt_at IS NOT NULL)
    OR (status IN ('processing', 'sent', 'failed_terminal') AND next_attempt_at IS NULL)
  ),
  UNIQUE (kind, source_id)
);

ALTER TABLE public.attendance_claim_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_claim_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_claim_deliveries TO service_role;
CREATE INDEX IF NOT EXISTS attendance_claim_deliveries_drain_idx
  ON public.attendance_claim_deliveries (status, next_attempt_at, created_at, id)
  WHERE status IN ('pending', 'failed_retryable', 'processing');

INSERT INTO public.notification_categories(
  key, section, is_transactional, urgency, default_channels, reach_mode
) VALUES (
  'attendance_claim_available', 'Attendance', true, 'normal',
  ARRAY['inapp','push','email'], 'reach_once'
)
ON CONFLICT(key) DO UPDATE SET
  section=excluded.section, is_transactional=excluded.is_transactional,
  urgency=excluded.urgency, default_channels=excluded.default_channels,
  reach_mode=excluded.reach_mode, active=true;

CREATE OR REPLACE FUNCTION public.fixed_digest_equal(p_left bytea, p_right bytea)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $function$ SELECT octet_length(p_left) = 32
  AND octet_length(p_right) = 32
  AND p_left = p_right $function$;

COMMENT ON FUNCTION public.fixed_digest_equal(bytea, bytea) IS
  'Exact comparison for two already-HMACed/SHA-256 32-byte digests. PostgreSQL bytea equality is not represented as constant-time; public responses remain generic and bounded.';

REVOKE ALL ON FUNCTION public.fixed_digest_equal(bytea, bytea)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fixed_digest_equal(bytea, bytea)
  TO service_role;

CREATE OR REPLACE FUNCTION public.begin_attendance_claim_attempt(
  p_user_id uuid,
  p_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_attempt_id uuid;
  v_started_count integer;
  v_pruned_completed integer := 0;
  v_pruned_abandoned integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_kind NOT IN ('rsvp', 'order') THEN
    RAISE EXCEPTION 'invalid_attempt';
  END IF;

  -- Serialize admission per authenticated user. The attempt insert and rolling
  -- decision are one transaction, so concurrent requests cannot all pass.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 871));

  WITH doomed AS (
    SELECT id FROM public.attendance_claim_attempts
     WHERE completed_at < now() - interval '30 days'
     ORDER BY completed_at, id LIMIT 100
  ), deleted AS (
    DELETE FROM public.attendance_claim_attempts a USING doomed d
     WHERE a.id = d.id RETURNING 1
  ) SELECT count(*) INTO v_pruned_completed FROM deleted;

  WITH doomed AS (
    SELECT id FROM public.attendance_claim_attempts
     WHERE completed_at IS NULL AND started_at < now() - interval '24 hours'
     ORDER BY started_at, id LIMIT 100
  ), deleted AS (
    DELETE FROM public.attendance_claim_attempts a USING doomed d
     WHERE a.id = d.id RETURNING 1
  ) SELECT count(*) INTO v_pruned_abandoned FROM deleted;

  INSERT INTO public.attendance_claim_attempts(user_id, kind)
  VALUES (p_user_id, p_kind)
  RETURNING id INTO v_attempt_id;

  SELECT count(*) INTO v_started_count
    FROM public.attendance_claim_attempts
   WHERE user_id = p_user_id
     AND started_at >= now() - interval '10 minutes';

  IF v_started_count > 10 THEN
    UPDATE public.attendance_claim_attempts
       SET completed_at = now(), outcome = 'rate_limited'
     WHERE id = v_attempt_id;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_started_count <= 10,
    'attemptId', v_attempt_id,
    'retryAfterSeconds', 600,
    'prunedCompleted', v_pruned_completed,
    'prunedAbandoned', v_pruned_abandoned
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_attendance_claim_attempt(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_attendance_claim_attempt(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.take_attendance_claim_link_attempt(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session public.ticket_checkout_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_session.attendance_claim_link_window_started_at IS NULL
     OR v_session.attendance_claim_link_window_started_at <= now() - interval '10 minutes' THEN
    UPDATE public.ticket_checkout_sessions
       SET attendance_claim_link_window_started_at = now(),
           attendance_claim_link_attempts = 1
     WHERE id = p_session_id;
    RETURN true;
  END IF;
  IF v_session.attendance_claim_link_attempts >= 10 THEN RETURN false; END IF;
  UPDATE public.ticket_checkout_sessions
     SET attendance_claim_link_attempts = attendance_claim_link_attempts + 1
   WHERE id = p_session_id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.take_attendance_claim_link_attempt(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_attendance_claim_link_attempt(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_order_attendance_claim_proof(
  p_order_id uuid,
  p_event_id uuid,
  p_digest bytea,
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
BEGIN
  IF p_order_id IS NULL OR p_event_id IS NULL OR octet_length(p_digest) <> 32 THEN
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
  IF NOT FOUND OR v_order.payment_status NOT IN ('paid', 'partial_refund') OR NOT EXISTS (
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
    RETURN jsonb_build_object('result', 'already_issued');
  END IF;

  UPDATE public.orders SET
    attendance_claim_token_digest = p_digest,
    attendance_claim_token_created_at = now(),
    attendance_claim_token_consumed_at = NULL
  WHERE id = v_order.id;
  RETURN jsonb_build_object('result', 'issued');
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_order_attendance_claim_proof(uuid, uuid, bytea, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_order_attendance_claim_proof(uuid, uuid, bytea, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_attendance_claim_deliveries(p_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  v_orders integer := 0;
  v_rsvps integer := 0;
BEGIN
  WITH candidates AS (
    SELECT o.id AS source_id, o.event_id
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
     WHERE o.buyer_user_id IS NULL
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.visibility = 'public' AND e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND e.status IN ('scheduled', 'live')
       AND EXISTS (
         SELECT 1 FROM public.tickets t WHERE t.order_id = o.id
           AND t.approval_status IN ('auto', 'approved')
           AND ((e.status = 'scheduled' AND t.status = 'valid')
             OR (e.status = 'live' AND t.status IN ('valid', 'used')))
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.attendance_claim_deliveries d
          WHERE d.kind = 'order' AND d.source_id = o.id
       )
     ORDER BY o.created_at, o.id LIMIT v_limit
  ), inserted AS (
    INSERT INTO public.attendance_claim_deliveries(kind, source_id, event_id)
    SELECT 'order', source_id, event_id FROM candidates
    ON CONFLICT(kind, source_id) DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_orders FROM inserted;

  WITH candidates AS (
    SELECT r.id AS source_id, r.event_id
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
     WHERE r.user_id IS NULL AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved'
       AND e.event_type = 'rsvp'
       AND e.visibility = 'public' AND e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND e.status IN ('scheduled', 'live')
       AND NOT EXISTS (
         SELECT 1 FROM public.attendance_claim_deliveries d
          WHERE d.kind = 'rsvp' AND d.source_id = r.id
       )
     ORDER BY r.created_at, r.id LIMIT v_limit
  ), inserted AS (
    INSERT INTO public.attendance_claim_deliveries(kind, source_id, event_id)
    SELECT 'rsvp', source_id, event_id FROM candidates
    ON CONFLICT(kind, source_id) DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_rsvps FROM inserted;

  RETURN jsonb_build_object('orderEnqueued', v_orders, 'rsvpEnqueued', v_rsvps);
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_attendance_claim_deliveries(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_attendance_claim_deliveries(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_attendance_delivery_batch(p_limit integer DEFAULT 25)
RETURNS SETOF public.attendance_claim_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_lease uuid := gen_random_uuid();
BEGIN
  -- An expired processing lease is provider-acceptance ambiguous. Never rotate
  -- its proof on a later invocation: terminalize the queue row and leave the
  -- issued proof valid for any email the provider may have accepted.
  UPDATE public.attendance_claim_deliveries
     SET status = 'failed_terminal', next_attempt_at = NULL,
         lease_id = NULL, lease_expires_at = NULL,
         last_error_code = 'provider_ambiguous', updated_at = now()
   WHERE status = 'processing' AND lease_expires_at < now();

  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.attendance_claim_deliveries
     WHERE status IN ('pending', 'failed_retryable')
       AND next_attempt_at <= now()
     ORDER BY next_attempt_at, created_at, id
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50)
  )
  UPDATE public.attendance_claim_deliveries d
     SET status = 'processing', lease_id = v_lease,
         lease_expires_at = now() + interval '5 minutes',
         next_attempt_at = NULL,
         attempt_count = d.attempt_count + 1, updated_at = now()
    FROM picked p WHERE d.id = p.id
  RETURNING d.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_attendance_delivery_batch(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_delivery_batch(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_attendance_claim_delivery(
  p_delivery_id uuid,
  p_lease_id uuid,
  p_status text,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_attempt_count integer;
  v_final_status text;
BEGIN
  IF p_status NOT IN ('sent', 'failed_retryable', 'failed_terminal') THEN
    RETURN false;
  END IF;

  SELECT attempt_count INTO v_attempt_count
    FROM public.attendance_claim_deliveries
   WHERE id = p_delivery_id AND lease_id = p_lease_id
     AND status = 'processing'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_final_status := CASE
    WHEN p_status = 'failed_retryable' AND v_attempt_count >= 5
      THEN 'failed_terminal'
    ELSE p_status
  END;

  UPDATE public.attendance_claim_deliveries
     SET status = v_final_status,
         delivered_at = CASE WHEN v_final_status = 'sent' THEN now() ELSE delivered_at END,
         last_error_code = p_error_code,
         next_attempt_at = CASE WHEN v_final_status = 'failed_retryable'
           THEN now() + make_interval(secs => LEAST(3600,
             60 * (2 ^ GREATEST(v_attempt_count - 1, 0))::integer))
           ELSE NULL END,
         lease_id = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = p_delivery_id AND lease_id = p_lease_id
     AND status = 'processing';
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_attendance_claim_delivery(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_attendance_claim_delivery(uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_attendance_internal(
  p_user_id uuid,
  p_kind text,
  p_event_id uuid,
  p_source_id uuid,
  p_proof_digest bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_owner uuid;
  v_expected bytea;
  v_eligible boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL OR p_source_id IS NULL
     OR p_proof_digest IS NULL OR octet_length(p_proof_digest) <> 32
     OR p_kind NOT IN ('rsvp', 'order') THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.visibility = 'public'
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  IF (p_kind = 'rsvp' AND v_event.event_type <> 'rsvp')
     OR (p_kind = 'order' AND v_event.event_type NOT IN ('event', 'trip', 'experience')) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF p_kind = 'rsvp' THEN
    SELECT r.user_id,
           CASE WHEN r.pass_recovery_token_hash ~ '^[0-9a-fA-F]{64}$'
                THEN decode(r.pass_recovery_token_hash, 'hex') END,
           r.rsvp_status = 'going' AND r.approval_status = 'approved'
      INTO v_owner, v_expected, v_eligible
      FROM public.event_rsvps r
     WHERE r.id = p_source_id AND r.event_id = p_event_id
     FOR UPDATE;
  ELSE
    SELECT o.buyer_user_id,
           o.attendance_claim_token_digest,
           o.payment_status IN ('paid', 'partial_refund')
           AND EXISTS (
             SELECT 1
               FROM public.tickets t
              WHERE t.order_id = o.id
                AND (
                  (v_event.status = 'scheduled' AND t.status = 'valid') OR
                  (v_event.status = 'live' AND t.status IN ('valid', 'used'))
                )
                AND t.approval_status IN ('auto', 'approved')
           )
      INTO v_owner, v_expected, v_eligible
      FROM public.orders o
     WHERE o.id = p_source_id AND o.event_id = p_event_id
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  IF v_owner = p_user_id THEN
    RETURN jsonb_build_object('result', 'already_claimed', 'eventId', p_event_id);
  END IF;
  IF v_owner IS NOT NULL THEN RETURN jsonb_build_object('result', 'conflict'); END IF;
  IF v_expected IS NULL
     OR NOT public.fixed_digest_equal(v_expected, p_proof_digest) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  IF NOT v_eligible THEN RETURN jsonb_build_object('result', 'ineligible'); END IF;

  IF p_kind = 'rsvp' THEN
    -- The existing one-owner-per-event index must fail closed without leaking a
    -- lower-level unique violation or merging/deleting either RSVP.
    IF EXISTS (
      SELECT 1 FROM public.event_rsvps other
       WHERE other.event_id = p_event_id
         AND other.user_id = p_user_id
         AND other.id <> p_source_id
    ) THEN
      RETURN jsonb_build_object('result', 'conflict');
    END IF;
    UPDATE public.event_rsvps SET user_id = p_user_id WHERE id = p_source_id;
  ELSE
    UPDATE public.orders
       SET buyer_user_id = p_user_id,
           attendance_claim_token_digest = NULL,
           attendance_claim_token_consumed_at = now()
     WHERE id = p_source_id;
  END IF;

  RETURN jsonb_build_object('result', 'claimed', 'eventId', p_event_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_attendance_internal(uuid, text, uuid, uuid, bytea)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_internal(uuid, text, uuid, uuid, bytea)
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
