-- issue #4522 M4 — refunds and payouts for v2 orders: flexible payments,
-- superseded rows, "Deposit is non-refundable" and add-ons paid today or spread.
--
-- What needs no change (verified against the latest bodies):
--   * biz_compute_refund_for_cancel and cancel_event_refund_prepare refund
--     every `collected` row, so flexible payments are refunded like planned
--     ones; `superseded` rows are never collected and never cancelled.
--   * The payout ledger and the #3645 / #4521 claims read `status =
--     'collected'` and payout_accounting_state, never ticket_type_id, so a
--     collected flexible row pays out like a planned one and a superseded row
--     never enters a claim (U-8 / U-9).
--   * A trip the host cancels (cancel_event_refund_prepare) refunds the
--     deposit in full (D-9).
-- Re-emitted (md5 drift-guarded):
--   biz_compute_refund_for_cancel (20280204003645) — a traveler's cancel keeps
--     the deposit's trip part when the v2 terms froze deposit_non_refundable;
--     every percentage calculation widens before multiplying, so large legacy
--     and v2 refunds cannot overflow the orders integer column.
--   biz_cancel_trip_booking_begin (20280204003645) — marks the actor so an
--     operator cancel refunds that deposit (D-9).

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.biz_compute_refund_for_cancel(uuid,timestamptz)','72d1629b3db78f4dbbad280565234d1b'),
    ('public.biz_cancel_trip_booking_begin(uuid,text,uuid,text,timestamptz)','3bb652b695930105fa5d1cb1c0ce32ea')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4522 M4 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 1. The policy refund keeps a non-refundable deposit on a traveler's cancel.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_compute_refund_for_cancel(p_order_id uuid, p_cancel_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_event_start timestamptz;
  v_policy jsonb;
  v_tiers jsonb;
  v_days_remaining int;
  v_tier_pct int;
  v_paid_total_cents bigint;
  v_refund_total_cents bigint;
  v_installments jsonb := '[]'::jsonb;
  v_installment record;
  v_per_installment_refund jsonb := '[]'::jsonb;
  v_deposit_kept bigint := 0;
BEGIN
  -- Fetch order + event
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  IF v_event.event_type IS DISTINCT FROM 'trip' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_trip');
  END IF;
  IF v_order.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  END IF;

  -- Determine trip start. Tr2 sidecar event_dates.start_at MIN aggregate per
  -- I-PROPOSED-TR2-* date sidecar pattern. If event_dates is empty (data
  -- integrity issue), reject with no_trip_start_date — operator must fix
  -- before Tr4 cancel can compute.
  SELECT min(start_at) INTO v_event_start
  FROM public.event_dates
  WHERE event_id = v_event.id;
  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_trip_start_date');
  END IF;

  -- Days remaining (floor to whole days; negative when after trip start).
  v_days_remaining := FLOOR(EXTRACT(EPOCH FROM (v_event_start - p_cancel_at)) / 86400)::int;

  -- Resolve refund policy. Trip-level overrides absent → tier_pct = 0 (no refund).
  v_policy := COALESCE(v_event.refund_policy, '{}'::jsonb);
  v_tiers := COALESCE(v_policy->'tiers', '[]'::jsonb);
  v_tier_pct := 0;
  -- Iterate tiers descending by days_before_start; first match wins (longest-notice tier first).
  SELECT (tier_entry->>'refund_pct')::int INTO v_tier_pct
  FROM jsonb_array_elements(v_tiers) AS tier_entry
  WHERE (tier_entry->>'days_before_start')::int <= v_days_remaining
  ORDER BY (tier_entry->>'days_before_start')::int DESC
  LIMIT 1;
  v_tier_pct := COALESCE(v_tier_pct, 0);

  -- Paid total + per-payment refund attribution.
  -- For installment-plan-root orders: deposit lives on orders.total_cents +
  -- each collected installment has its own row in order_installments.
  -- For single-payment orders: orders.total_cents is the only paid amount.
  IF v_order.installment_plan_root THEN
    -- Deposit (orders row) + sum of collected installments
    SELECT v_order.total_cents +
           COALESCE(sum(coalesce(buyer_total_cents, amount_cents) - refunded_amount_cents), 0)
    INTO v_paid_total_cents
    FROM public.order_installments
    WHERE order_id = v_order.id AND status = 'collected';

    -- Build per-installment refund attribution (one row per collected installment).
    FOR v_installment IN
      SELECT id, coalesce(buyer_total_cents, amount_cents) - refunded_amount_cents AS amount_cents,
             currency, stripe_payment_intent_id, ordinal
      FROM public.order_installments
      WHERE order_id = v_order.id AND status = 'collected'
      ORDER BY ordinal ASC
    LOOP
      v_per_installment_refund := v_per_installment_refund || jsonb_build_object(
        'installment_id', v_installment.id,
        'ordinal', v_installment.ordinal,
        'source_pi', v_installment.stripe_payment_intent_id,
        'paid_cents', v_installment.amount_cents,
        'refund_cents', FLOOR(v_installment.amount_cents::numeric * v_tier_pct / 100.0)::bigint,
        'currency', v_installment.currency
      );
    END LOOP;

    -- issue #4522 — "Deposit is non-refundable", as frozen in the v2 terms at
    -- checkout: the deposit's trip part is kept on a traveler's cancel (the
    -- add-ons paid today with it follow their own refund rules). A host or
    -- operator cancel refunds it (D-9): biz_cancel_trip_booking_begin marks
    -- the actor for this transaction.
    IF COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) = 2
       AND COALESCE((v_order.payment_plan_terms->>'deposit_non_refundable')::boolean, false)
       AND COALESCE(current_setting('mingla.cancel_actor_kind', true), '') <> 'operator' THEN
      v_deposit_kept := least(greatest(COALESCE((v_order.payment_plan_terms->>'deposit_minor')::bigint, 0), 0),
                              v_order.total_cents::bigint);
    END IF;

    -- Append the deposit row (orders-level, installment_id=NULL).
    v_per_installment_refund := v_per_installment_refund || jsonb_build_object(
      'installment_id', NULL,
      'ordinal', 0,
      'source_pi', v_order.stripe_payment_intent_id,
      'paid_cents', v_order.total_cents,
      'refund_cents', FLOOR((v_order.total_cents - v_deposit_kept)::numeric * v_tier_pct / 100.0)::bigint,
      'currency', v_order.currency,
      'note', 'deposit'
    );
  ELSE
    -- Single-payment order: total_cents = paid.
    v_paid_total_cents := v_order.total_cents;
    v_per_installment_refund := jsonb_build_array(jsonb_build_object(
      'installment_id', NULL,
      'ordinal', 0,
      'source_pi', v_order.stripe_payment_intent_id,
      'paid_cents', v_order.total_cents,
      'refund_cents', FLOOR(v_order.total_cents::numeric * v_tier_pct / 100.0)::bigint,
      'currency', v_order.currency
    ));
  END IF;

  -- Sum refund_cents across attributions for total (handles per-row rounding).
  SELECT COALESCE(sum((r->>'refund_cents')::bigint), 0) INTO v_refund_total_cents
  FROM jsonb_array_elements(v_per_installment_refund) AS r;

  -- Scheduled + failed installments to cancel (for write path); cron will
  -- skip these per AND cancelled_at IS NULL filter.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('installment_id', id, 'ordinal', ordinal, 'due_at', due_at)
           ORDER BY ordinal), '[]'::jsonb)
  INTO v_installments
  FROM public.order_installments
  WHERE order_id = v_order.id
    AND status IN ('scheduled', 'failed')
    AND cancelled_at IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'event_id', v_event.id,
    'cancel_at', p_cancel_at,
    'trip_start', v_event_start,
    'days_remaining', v_days_remaining,
    'tier_pct', v_tier_pct,
    'paid_total_cents', v_paid_total_cents,
    'refund_total_cents', v_refund_total_cents,
    'currency', v_order.currency,
    'per_payment_refund', v_per_installment_refund,
    'installments_to_cancel', v_installments,
    'policy_kind', COALESCE(v_policy->>'kind', 'none')
  -- issue #4522 — the deposit kept by "Deposit is non-refundable" has its own
  -- key (never an element of per_payment_refund); absent when nothing is kept.
  ) || CASE WHEN v_deposit_kept > 0
       THEN jsonb_build_object('deposit_non_refundable_cents', v_deposit_kept) ELSE '{}'::jsonb END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Cancel begin marks its actor for the computation above.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_cancel_trip_booking_begin(p_order_id uuid, p_actor_kind text, p_actor_user_id uuid, p_reason text, p_cancel_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_compute jsonb;
  v_refund_id uuid;
  v_existing_refund public.refunds;
  v_order public.orders;
  v_payment jsonb;
  v_payment_rows jsonb := '[]'::jsonb;
  v_suffix text;
  v_paid_cents integer;
  v_paid_total integer := 0;
  v_provider text;
BEGIN
  IF p_actor_kind IS NULL OR p_actor_kind NOT IN ('buyer','operator') THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_actor_kind');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','order_not_found');
  END IF;
  SELECT b.payment_provider INTO v_provider
  FROM public.orders o
  JOIN public.events e ON e.id=o.event_id
  JOIN public.brands b ON b.id=e.brand_id
  WHERE o.id=p_order_id;

  IF v_order.cancelled_at IS NOT NULL THEN
    SELECT r.* INTO v_existing_refund
    FROM public.refunds r
    WHERE r.order_id=p_order_id AND r.status='pending'
      AND EXISTS(
        SELECT 1 FROM public.paystack_refund_attempts a
        WHERE a.local_refund_id=r.id
          AND a.merchant_note LIKE 'mingla_trip_refund:'||r.id||':%'
          AND a.status IN ('pending','accepted','processed')
      )
    ORDER BY r.created_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'reason','already_cancelled');
    END IF;

    FOR v_payment IN
      SELECT jsonb_build_object(
        'merchant_note',a.merchant_note,
        'transaction_reference',a.transaction_reference,
        'amount_cents',a.amount_cents
      )
      FROM public.paystack_refund_attempts a
      WHERE a.local_refund_id=v_existing_refund.id
        AND a.merchant_note LIKE
          'mingla_trip_refund:'||v_existing_refund.id||':%'
      ORDER BY a.created_at,a.id
    LOOP
      v_suffix:=split_part(v_payment->>'merchant_note',':',3);
      IF v_suffix='deposit' THEN
        v_paid_cents:=v_order.total_cents;
      ELSE
        SELECT amount_cents INTO v_paid_cents
        FROM public.order_installments
        WHERE id=v_suffix::uuid AND order_id=p_order_id;
      END IF;
      v_paid_total:=v_paid_total+coalesce(v_paid_cents,0);
      v_payment_rows:=v_payment_rows||jsonb_build_object(
        'installment_id',CASE WHEN v_suffix='deposit' THEN NULL ELSE v_suffix END,
        'ordinal',0,
        'source_pi',v_payment->>'transaction_reference',
        'paid_cents',coalesce(v_paid_cents,0),
        'refund_cents',(v_payment->>'amount_cents')::integer,
        'currency',v_existing_refund.currency
      );
    END LOOP;

    RETURN jsonb_build_object(
      'ok',true,
      'refund_id',v_existing_refund.id,
      'per_payment_refund',v_payment_rows,
      'refund_total_cents',v_existing_refund.amount_cents,
      'currency',v_existing_refund.currency,
      'tier_pct',CASE WHEN v_paid_total>0
        THEN round(v_existing_refund.amount_cents*100.0/v_paid_total)::integer
        ELSE 0 END,
      'installments_to_cancel','[]'::jsonb,
      'paystack_retry',true
    );
  END IF;

  -- issue #4522 (D-9) — a host or operator cancel refunds a non-refundable deposit.
  PERFORM set_config('mingla.cancel_actor_kind',p_actor_kind,true);
  v_compute:=public.biz_compute_refund_for_cancel(p_order_id,p_cancel_at);
  PERFORM set_config('mingla.cancel_actor_kind','',true);
  IF NOT (v_compute->>'ok')::boolean THEN
    RETURN v_compute;
  END IF;

  INSERT INTO public.refunds(
    order_id,amount_cents,currency,status,reason,
    application_fee_refunded_cents
  ) VALUES(
    p_order_id,(v_compute->>'refund_total_cents')::bigint,
    v_compute->>'currency','pending',
    left(coalesce(p_reason,'tr4_cancel'),200),NULL
  ) RETURNING id INTO v_refund_id;

  IF v_provider='paystack' THEN
    FOR v_payment IN
      SELECT value FROM jsonb_array_elements(v_compute->'per_payment_refund')
    LOOP
      IF (v_payment->>'refund_cents')::integer>0 THEN
        v_suffix:=coalesce(v_payment->>'installment_id','deposit');
        INSERT INTO public.paystack_refund_attempts(
          source_type,source_id,local_refund_id,transaction_reference,
          merchant_note,amount_cents,currency,status,idempotency_key
        ) VALUES(
          CASE WHEN v_payment->>'installment_id' IS NULL THEN 'order' ELSE 'order_installment' END,
          coalesce((v_payment->>'installment_id')::uuid,p_order_id),v_refund_id,v_payment->>'source_pi',
          'mingla_trip_refund:'||v_refund_id||':'||v_suffix,
          (v_payment->>'refund_cents')::integer,'ngn','pending',
          'paystack-refund:mingla_trip_refund:'||v_refund_id||':'||v_suffix
        );
      END IF;
    END LOOP;
  END IF;

  UPDATE public.orders SET
    cancelled_at=p_cancel_at,cancellation_reason=p_reason,
    cancelled_by=p_actor_user_id,at_risk=false,at_risk_since=NULL
  WHERE id=p_order_id;
  UPDATE public.order_installments SET
    status='cancelled',cancelled_at=p_cancel_at,cancelled_by=p_actor_user_id
  WHERE order_id=p_order_id AND status IN ('scheduled','failed')
    AND cancelled_at IS NULL;

  RETURN jsonb_build_object(
    'ok',true,'refund_id',v_refund_id,
    'per_payment_refund',v_compute->'per_payment_refund',
    'refund_total_cents',v_compute->'refund_total_cents',
    'currency',v_compute->'currency','tier_pct',v_compute->'tier_pct',
    'installments_to_cancel',v_compute->'installments_to_cancel'
  ) || CASE WHEN v_compute ? 'deposit_non_refundable_cents'
       THEN jsonb_build_object('deposit_non_refundable_cents', v_compute->'deposit_non_refundable_cents')
       ELSE '{}'::jsonb END;
END;
$function$;

-- The same computation for a named actor (the cancel edge's preview and its
-- Paystack minimum check), so a preview matches what begin will compute.
CREATE FUNCTION public.issue_4522_compute_refund_for_cancel_as(
  p_order_id uuid,
  p_cancel_at timestamptz,
  p_actor_kind text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF p_actor_kind IS NULL OR p_actor_kind NOT IN ('buyer', 'operator') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_actor_kind');
  END IF;
  PERFORM set_config('mingla.cancel_actor_kind', p_actor_kind, true);
  v_result := public.biz_compute_refund_for_cancel(p_order_id, COALESCE(p_cancel_at, now()));
  PERFORM set_config('mingla.cancel_actor_kind', '', true);
  RETURN v_result;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_compute_refund_for_cancel_as(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_compute_refund_for_cancel_as(uuid, timestamptz, text) TO service_role;
COMMENT ON FUNCTION public.issue_4522_compute_refund_for_cancel_as(uuid, timestamptz, text) IS
  'Issue #4522: biz_compute_refund_for_cancel for a named actor (buyer | operator), so a cancel preview matches biz_cancel_trip_booking_begin when a v2 deposit is non-refundable.';
-- ---------------------------------------------------------------------------
-- 3. Removing a spread add-on (the #3281 add-on refund calls this first): the
--    add-on's share comes off the open rows of its package before anything
--    is refunded; only what was already collected is left to refund.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_remove_spread_addon(
  p_order_id uuid,
  p_ticket_type_id uuid,
  p_addon_minor bigint,
  p_actor uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders;
  v_open_addon bigint;
  v_take bigint;
  v_result jsonb;
BEGIN
  IF p_addon_minor IS NULL OR p_addon_minor <= 0 THEN
    RAISE EXCEPTION 'addon_amount_invalid' USING ERRCODE = '22023';
  END IF;
  IF public.issue_4522_lock_order_graph(p_order_id) IS NULL THEN
    RAISE EXCEPTION 'balance_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.addon_payment_mode IS DISTINCT FROM 'spread' THEN
    -- Today add-ons were paid with the deposit: all of it is a refund.
    RETURN jsonb_build_object('removedFromOpenMinor', 0, 'refundFromCollectedMinor', p_addon_minor,
      'mode', COALESCE(v_order.addon_payment_mode, 'none'));
  END IF;
  IF public.issue_4522_order_has_open_flex(p_order_id) OR public.issue_4522_order_has_open_attempt(p_order_id) THEN
    RAISE EXCEPTION 'balance_payment_in_flight' USING ERRCODE = 'PT409';
  END IF;
  SELECT COALESCE(sum(addon_portion_minor), 0) INTO v_open_addon FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
     AND ticket_type_id IS NOT DISTINCT FROM p_ticket_type_id;
  v_take := least(v_open_addon, p_addon_minor);
  IF v_take > 0 THEN
    v_result := public.issue_4522_rebalance_order(p_order_id, 'addon_removed', NULL, p_actor,
      jsonb_build_array(jsonb_build_object('ticket_type_id', p_ticket_type_id, 'net_minor', 0,
        'addon_minor', v_take)), NULL);
  END IF;
  RETURN jsonb_build_object('removedFromOpenMinor', v_take,
    'refundFromCollectedMinor', p_addon_minor - v_take, 'mode', 'spread',
    'remainingMinor', v_result->'remainingMinor');
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_remove_spread_addon(uuid, uuid, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_remove_spread_addon(uuid, uuid, bigint, uuid) TO service_role;
COMMENT ON FUNCTION public.issue_4522_remove_spread_addon(uuid, uuid, bigint, uuid) IS
  'Issue #4522 §5.5 / #3281 §9.4: an add-on removed from a spread order first comes off the open rows of its package (rebalance addon_removed); refundFromCollectedMinor is what the caller still refunds from collected payments. A today order refunds it all from the deposit.';

COMMIT;
