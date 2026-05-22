-- ORCH-0914 [Trip Money tab redesign] — operator-initiated reminder ledger.
-- Rate-limit contract: max 1 reminder per order per 24h, enforced by the
-- SECURITY DEFINER RPC with an advisory transaction lock. PostgreSQL cannot
-- safely express `sent_at > now() - interval '24 hours'` as a partial unique
-- index predicate, because index predicates must be immutable.

CREATE TABLE IF NOT EXISTS public.manual_buyer_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by_user_id uuid NOT NULL REFERENCES auth.users(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  delivery_results jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_manual_buyer_reminders_order_recent
  ON public.manual_buyer_reminders (order_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_manual_buyer_reminders_brand_recent
  ON public.manual_buyer_reminders (brand_id, sent_at DESC);

ALTER TABLE public.manual_buyer_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manual_buyer_reminders_brand_member_read
  ON public.manual_buyer_reminders;

CREATE POLICY manual_buyer_reminders_brand_member_read
  ON public.manual_buyer_reminders
  FOR SELECT
  TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

CREATE OR REPLACE FUNCTION public.biz_send_installment_reminder(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_recent_count integer;
  v_reminder_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = v_order.event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_not_found');
  END IF;

  IF NOT public.biz_is_brand_member_for_read_for_caller(v_event.brand_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('manual_buyer_reminders:' || p_order_id::text, 0)
  );

  SELECT count(*) INTO v_recent_count
  FROM public.manual_buyer_reminders
  WHERE order_id = p_order_id
    AND sent_at > now() - interval '24 hours';

  IF v_recent_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.manual_buyer_reminders (
    order_id,
    sent_by_user_id,
    brand_id
  )
  VALUES (
    p_order_id,
    v_user_id,
    v_event.brand_id
  )
  RETURNING id INTO v_reminder_id;

  INSERT INTO public.audit_log (
    user_id,
    brand_id,
    event_id,
    action,
    target_type,
    target_id,
    after
  )
  VALUES (
    v_user_id,
    v_event.brand_id,
    v_order.event_id,
    'INSTALLMENT_REMINDER_SENT',
    'order',
    p_order_id,
    jsonb_build_object('brand_id', v_event.brand_id, 'reminder_id', v_reminder_id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'reminder_id', v_reminder_id,
    'brand_id', v_event.brand_id,
    'event_id', v_order.event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_send_installment_reminder(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_send_installment_reminder(uuid) TO authenticated;

COMMENT ON TABLE public.manual_buyer_reminders IS
  'ORCH-0914: operator-initiated installment reminder ledger. RPC-enforced 1 reminder per order per 24h.';

COMMENT ON FUNCTION public.biz_send_installment_reminder(uuid) IS
  'ORCH-0914: auth-gated manual installment reminder request. Enforces per-order 24h rate-limit, writes reminder ledger row, and appends INSTALLMENT_REMINDER_SENT audit action.';
