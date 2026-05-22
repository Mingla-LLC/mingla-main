-- ORCH-0914 [Trip Money tab redesign] — operator-initiated immediate charge
-- authorization RPC. This RPC does NOT create Stripe PaymentIntents; the new
-- manual-charge-installment edge function invokes the shared
-- _shared/installments/createInstallmentPI.ts helper after this RPC succeeds.

CREATE OR REPLACE FUNCTION public.biz_manual_charge_installment(
  p_installment_id uuid,
  p_atrisk_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_installment public.order_installments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_installment
  FROM public.order_installments
  WHERE id = p_installment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;

  IF v_installment.status NOT IN ('scheduled', 'failed') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'installment_not_chargeable',
      'current_status', v_installment.status
    );
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_installment.order_id;

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

  IF v_order.at_risk IS TRUE AND p_atrisk_override IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'at_risk_override_required',
      'installment_status', v_installment.status
    );
  END IF;

  UPDATE public.order_installments
    SET status = 'scheduled',
        next_retry_at = now() - interval '1 second',
        updated_at = now()
   WHERE id = p_installment_id
     AND status IN ('scheduled', 'failed');

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
    'INSTALLMENT_CHARGED_MANUALLY',
    'order_installment',
    p_installment_id,
    jsonb_build_object(
      'brand_id', v_event.brand_id,
      'order_id', v_order.id,
      'installment_id', p_installment_id,
      'atrisk_override', p_atrisk_override
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'installment_id', p_installment_id,
    'brand_id', v_event.brand_id,
    'event_id', v_order.event_id,
    'installment_status', v_installment.status,
    'atrisk_override', p_atrisk_override
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_manual_charge_installment(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_manual_charge_installment(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.biz_manual_charge_installment(uuid, boolean) IS
  'ORCH-0914: auth-gated manual installment charge request. Requires explicit at-risk override when orders.at_risk=true, queues the row for immediate helper execution, and appends INSTALLMENT_CHARGED_MANUALLY audit action.';
