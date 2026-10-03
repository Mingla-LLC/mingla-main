-- Issue #1345 — durable ops-alert outbox for paid NG reservations whose slot
-- was taken between Paystack charge and finalize (manual refund due; #1175 dark).
--
-- Finalize enqueues one row after the audit marker and returns without waiting
-- on Resend. paystack-webhook / venue-reservation-confirm drain pending rows
-- fail-open (claim → sendOpsAlertEmail → complete only on succeeded > 0).

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
  created_at    timestamptz NOT NULL DEFAULT now(),
  notified_at   timestamptz,
  CONSTRAINT reservation_slot_unavailable_alert_outbox_session_uniq
    UNIQUE (session_id),
  CONSTRAINT reservation_slot_unavailable_alert_outbox_idem_uniq
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS reservation_slot_unavailable_alert_outbox_pending_idx
  ON public.reservation_slot_unavailable_alert_outbox (created_at, id)
  WHERE notified_at IS NULL;

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
  '#1345 service_role-only outbox: paid Paystack reservation slot-unavailable needs MANUAL refund ops alert. Enqueued by finalize; drained by webhook/confirm. Complete only after Resend succeeded > 0.';

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

CREATE OR REPLACE FUNCTION public.claim_reservation_slot_unavailable_alerts(
  p_limit integer DEFAULT 20
) RETURNS TABLE(
  alert_id uuid,
  session_id uuid,
  reference text,
  amount_cents integer,
  currency text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT o.id, o.session_id, o.reference, o.amount_cents, o.currency
  FROM public.reservation_slot_unavailable_alert_outbox o
  WHERE o.notified_at IS NULL
  ORDER BY o.created_at, o.id
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$fn$;

CREATE OR REPLACE FUNCTION public.complete_reservation_slot_unavailable_alerts(
  p_alert_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.reservation_slot_unavailable_alert_outbox
  SET notified_at = now()
  WHERE id = ANY (coalesce(p_alert_ids, ARRAY[]::uuid[]))
    AND notified_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enqueue_reservation_slot_unavailable_alert(uuid, text, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_reservation_slot_unavailable_alerts(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_reservation_slot_unavailable_alerts(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_reservation_slot_unavailable_alert(uuid, text, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_reservation_slot_unavailable_alerts(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_reservation_slot_unavailable_alerts(uuid[])
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
       'public.claim_reservation_slot_unavailable_alerts(integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.complete_reservation_slot_unavailable_alerts(uuid[])',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION '#1345: outbox RPCs are executable by authenticated';
  END IF;
END
$seal$;

COMMIT;
