-- Issue #1345 — durable ops-alert outbox for paid NG reservations whose slot
-- was taken between Paystack charge and finalize (manual refund due; #1175 dark).
--
-- Finalize marks the session failed AND enqueues the outbox row in ONE RPC
-- (replay re-ensures the row). payout-release-sweep drains with a real claim
-- lease (FOR UPDATE SKIP LOCKED + claim_id), fail-open, same pattern as the
-- pause/outcome notice drains. Complete requires a matching claim_id.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reservation_slot_unavailable_alert_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL,
  reference     text NOT NULL,
  amount_cents  integer,
  currency      text,
  -- Idempotency: one alert job per session (slot-unavailable is terminal).
  idempotency_key text NOT NULL
    GENERATED ALWAYS AS (
      'paystack.reservation_slot_unavailable_refund_due:' || session_id::text
    ) STORED,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatching', 'provider_accepted')),
  delivery_attempt_count integer NOT NULL DEFAULT 0
    CHECK (delivery_attempt_count >= 0),
  dispatch_claim_id uuid,
  dispatch_claimed_at timestamptz,
  last_delivery_error text,
  notified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_slot_unavailable_alert_outbox_session_uniq
    UNIQUE (session_id),
  CONSTRAINT reservation_slot_unavailable_alert_outbox_idem_uniq
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS reservation_slot_unavailable_alert_outbox_retry_idx
  ON public.reservation_slot_unavailable_alert_outbox (status, created_at)
  WHERE status IN ('pending', 'dispatching');

ALTER TABLE public.reservation_slot_unavailable_alert_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_slot_unavailable_alert_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reservation_slot_unavailable_alert_outbox
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.reservation_slot_unavailable_alert_outbox TO service_role;

CREATE POLICY reservation_slot_unavailable_alert_outbox_service_all
  ON public.reservation_slot_unavailable_alert_outbox
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.reservation_slot_unavailable_alert_outbox IS
  '#1345 service_role-only outbox: paid Paystack reservation slot-unavailable needs MANUAL refund ops alert. Enqueued atomically with session failed mark; drained by payout-release-sweep with claim leases. Complete only after Resend succeeded > 0 with matching claim_id.';

-- Standalone enqueue (idempotent). Prefer record_reservation_slot_unavailable_refund_due
-- from finalize so session mark + outbox share one transaction.
CREATE OR REPLACE FUNCTION public.enqueue_reservation_slot_unavailable_alert(
  p_session_id uuid,
  p_reference text,
  p_amount_cents integer DEFAULT NULL,
  p_currency text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_session_id IS NULL OR nullif(btrim(coalesce(p_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reservation_slot_unavailable_alert_enqueue_fields_required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.reservation_slot_unavailable_alert_outbox (
    session_id, reference, amount_cents, currency
  ) VALUES (
    p_session_id,
    btrim(p_reference),
    p_amount_cents,
    nullif(btrim(coalesce(p_currency, '')), '')
  )
  ON CONFLICT (session_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.reservation_slot_unavailable_alert_outbox
    WHERE session_id = p_session_id;
  END IF;
  RETURN v_id;
END;
$fn$;

-- Atomic: mark session failed (slot_unavailable_after_charge_refund_due) +
-- enqueue outbox. Idempotent on replay when the session is already in that
-- terminal failure_reason (still ensures the outbox row exists).
CREATE OR REPLACE FUNCTION public.record_reservation_slot_unavailable_refund_due(
  p_session_id uuid,
  p_reference text,
  p_amount_cents integer DEFAULT NULL,
  p_currency text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_session public.reservation_checkout_sessions%ROWTYPE;
  v_alert_id uuid;
BEGIN
  IF p_session_id IS NULL OR nullif(btrim(coalesce(p_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reservation_slot_unavailable_refund_due_fields_required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.reservation_checkout_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_checkout_session_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Only move non-terminal / matching-terminal sessions. Never overwrite a
  -- different terminal failure_reason or a completed mint.
  IF v_session.reservation_id IS NOT NULL OR v_session.status = 'completed' THEN
    RAISE EXCEPTION 'reservation_slot_unavailable_refund_due_already_finalized'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_session.status = 'failed'
     AND coalesce(v_session.failure_reason, '') IS DISTINCT FROM
       'slot_unavailable_after_charge_refund_due' THEN
    RAISE EXCEPTION 'reservation_slot_unavailable_refund_due_other_failure'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.reservation_checkout_sessions
  SET status = 'failed',
      failure_reason = 'slot_unavailable_after_charge_refund_due',
      updated_at = now()
  WHERE id = p_session_id;

  v_alert_id := public.enqueue_reservation_slot_unavailable_alert(
    p_session_id,
    p_reference,
    p_amount_cents,
    p_currency
  );
  RETURN v_alert_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.claim_reservation_slot_unavailable_alerts(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  alert_id uuid,
  session_id uuid,
  reference text,
  amount_cents integer,
  currency text,
  claim_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT o.id
    FROM public.reservation_slot_unavailable_alert_outbox o
    WHERE o.status = 'pending'
       OR (
         o.status = 'dispatching'
         AND o.dispatch_claimed_at < p_now - interval '10 minutes'
       )
    ORDER BY o.created_at, o.id
    FOR UPDATE OF o SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
  ),
  claimed AS (
    UPDATE public.reservation_slot_unavailable_alert_outbox o
    SET status = 'dispatching',
        dispatch_claim_id = gen_random_uuid(),
        dispatch_claimed_at = p_now,
        updated_at = p_now
    FROM eligible
    WHERE o.id = eligible.id
    RETURNING o.*
  )
  SELECT
    c.id,
    c.session_id,
    c.reference,
    c.amount_cents,
    c.currency,
    c.dispatch_claim_id
  FROM claimed c
  ORDER BY c.created_at, c.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_reservation_slot_unavailable_alert_delivery(
  p_alert_id uuid,
  p_claim_id uuid,
  p_outcome text,
  p_error_message text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_alert public.reservation_slot_unavailable_alert_outbox;
BEGIN
  IF p_outcome NOT IN ('provider_accepted', 'retryable') THEN
    RAISE EXCEPTION 'invalid_reservation_slot_unavailable_alert_outcome'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_alert
  FROM public.reservation_slot_unavailable_alert_outbox
  WHERE id = p_alert_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_slot_unavailable_alert_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_alert.status <> 'dispatching'
     OR v_alert.dispatch_claim_id IS DISTINCT FROM p_claim_id THEN
    RAISE EXCEPTION 'stale_reservation_slot_unavailable_alert_claim'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.reservation_slot_unavailable_alert_outbox
  SET status = CASE p_outcome
        WHEN 'provider_accepted' THEN 'provider_accepted'
        ELSE 'pending'
      END,
      delivery_attempt_count = delivery_attempt_count + 1,
      dispatch_claim_id = NULL,
      dispatch_claimed_at = NULL,
      last_delivery_error = CASE
        WHEN p_outcome = 'provider_accepted' THEN NULL
        ELSE left(coalesce(p_error_message, 'alert_delivery_failed'), 1000)
      END,
      notified_at = CASE
        WHEN p_outcome = 'provider_accepted' THEN p_now
        ELSE notified_at
      END,
      updated_at = p_now
  WHERE id = p_alert_id;

  RETURN CASE p_outcome
    WHEN 'provider_accepted' THEN 'provider_accepted'
    ELSE 'pending'
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enqueue_reservation_slot_unavailable_alert(uuid, text, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_reservation_slot_unavailable_refund_due(uuid, text, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_reservation_slot_unavailable_alerts(integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_reservation_slot_unavailable_alert_delivery(uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_reservation_slot_unavailable_alert(uuid, text, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_reservation_slot_unavailable_refund_due(uuid, text, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_reservation_slot_unavailable_alerts(integer, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_reservation_slot_unavailable_alert_delivery(uuid, uuid, text, text, timestamptz)
  TO service_role;

-- Install-time auth seal (matches #3645 pause-notice outbox pattern).
DO $seal$
BEGIN
  IF has_table_privilege('authenticated', 'public.reservation_slot_unavailable_alert_outbox', 'SELECT')
     OR has_table_privilege('anon', 'public.reservation_slot_unavailable_alert_outbox', 'SELECT') THEN
    RAISE EXCEPTION '#1345: reservation_slot_unavailable_alert_outbox is reachable by anon/authenticated';
  END IF;
  IF has_function_privilege(
       'authenticated',
       'public.enqueue_reservation_slot_unavailable_alert(uuid,text,integer,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.record_reservation_slot_unavailable_refund_due(uuid,text,integer,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_reservation_slot_unavailable_alerts(integer,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.record_reservation_slot_unavailable_alert_delivery(uuid,uuid,text,text,timestamptz)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION '#1345: outbox RPCs are executable by authenticated';
  END IF;
END
$seal$;

COMMIT;
