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
--     operator cancel refunds that deposit (D-9); writes the refunds the
--     cancel intends on its refunds row and resumes an unfinished cancel
--     (G-3 / G-4, section 6b).
--   record_order_installment_provider_sale (20270725003645) — a row that is
--     part overpayment not yet returned, or a flexible payment not yet
--     settled, stays 'pending' instead of 'ready', so no payout ever counts
--     money the traveler is owed back (N2, I-4522-OVERPAY-NEVER-PAID-OUT).
--   issue_3645_cancel_refund_installment (20280204003645) — a host's trip
--     cancel (event-cancel fan-out) asks the provider only for what is still
--     refundable on the charge: the overpaid part of a flexible payment not
--     yet returned is left to its own refund, so a pending overpayment
--     refund never makes the provider refuse the cancel refund (T3-1).
--   issue_3872_refund_share_trigger (20271221003872) — an overpayment refund
--     reverses no referral share (none was earned on money the plan did not
--     owe) and adds nothing to the reversal basis of later refunds (T3-4).
--   issue_3645_release_projected_totals (20280508003645),
--   authorize_stripe_payout_execution (20280422003645) and
--   authorize_paystack_payout_execution (20280602003645) — section 8: a
--     payout never pays the host money that went back to a traveler.
--   issue_2097_finalize_refund_attempt (20280305003281) and
--   biz_cancel_trip_booking_commit (20260612000000) — pass 6 (S9-1): a plan
--     order's charges are separate money: the order row holds the deposit
--     charge, each instalment or flexible payment its own. A refund is
--     recorded where its charge lives, in the same transaction that settles
--     it: an instalment charge's part on that row (issue_3645_mark_installment_refunded,
--     the one owner), the deposit charge's part on the order
--     (issue_4522_order_charge_refunded_cents). Before this a trip cancel that
--     refunded collected instalments asked the order to hold more than its
--     own charge and was refused (orders_refunded_amount_not_exceed_total)
--     after the provider had refunded; a second-provider cancel never
--     settled at all (refunds_application_fee_amount_truth_check).

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.biz_compute_refund_for_cancel(uuid,timestamptz)','72d1629b3db78f4dbbad280565234d1b'),
    ('public.biz_cancel_trip_booking_begin(uuid,text,uuid,text,timestamptz)','3bb652b695930105fa5d1cb1c0ce32ea'),
    ('public.record_order_installment_provider_sale(uuid,integer,integer,timestamptz)','4fd2f012df53833c54d02eb9ff20309f'),
    ('public.issue_3645_cancel_refund_installment(uuid,text,text)','ba50142f4b8b940893a4c870c54d62da'),
    ('public.issue_3872_refund_share_trigger()','416d98679e62a948931f9c675d2c45df'),
    ('public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text)','38eca7ecb7dc35ec12052a6a6e41f3c1'),
    ('public.biz_cancel_trip_booking_commit(uuid,text[],integer,timestamptz)','1c72d9102f9b3af8ca61ce8bb544510d'),
    ('public.issue_3645_release_projected_totals(uuid)','74819965113d92d5f27dbe71e31ea99a'),
    ('public.authorize_stripe_payout_execution(uuid,uuid,integer,timestamptz)','02024b64f8ac98326be5703410241645'),
    ('public.authorize_paystack_payout_execution(uuid,uuid,timestamptz)','d8c549c1a96ce54133cd8055c5e8219a')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4522 M4 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 0. Overpayment not yet returned (charge units), per row and per order.
--    Per row: only a flexible payment's excess lies inside the row's own
--    recorded charge; the other causes (a superseded row's charge, an
--    unexpected amount, a charge above the row) were never part of a
--    collected row's amount.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_row_unreturned_overpayment(p_installment_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(sum(refund_minor - public.issue_4522_overpayment_returned_minor(id)), 0)::bigint
    FROM public.order_overpayments
   WHERE installment_id = p_installment_id AND reason = 'flex_exceeds_balance'
     AND state IN ('held', 'refund_pending', 'refund_failed', 'needs_ops')
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_row_unreturned_overpayment(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_4522_order_unreturned_overpayment(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(sum(refund_minor - public.issue_4522_overpayment_returned_minor(id)), 0)::bigint
    FROM public.order_overpayments
   WHERE order_id = p_order_id AND state IN ('held', 'refund_pending', 'refund_failed', 'needs_ops')
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_order_unreturned_overpayment(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
  v_overpayment_return bigint := 0;
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
    -- issue #4522 (N2) — money a row collected beyond what the plan owed and
    -- has not yet returned is not part of the policy base: it goes back in
    -- full through its own refund (issue_4522_begin_overpayment_refund),
    -- whatever the tier, and is reported as overpayment_return_cents.
    SELECT v_order.total_cents +
           COALESCE(sum(coalesce(buyer_total_cents, amount_cents) - refunded_amount_cents
                        - public.issue_4522_row_unreturned_overpayment(id)), 0)
    INTO v_paid_total_cents
    FROM public.order_installments
    WHERE order_id = v_order.id AND status = 'collected';

    -- Build per-installment refund attribution (one row per collected installment).
    FOR v_installment IN
      SELECT id, coalesce(buyer_total_cents, amount_cents) - refunded_amount_cents
                 - public.issue_4522_row_unreturned_overpayment(id) AS amount_cents,
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
  v_overpayment_return := public.issue_4522_order_unreturned_overpayment(v_order.id);

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
       THEN jsonb_build_object('deposit_non_refundable_cents', v_deposit_kept) ELSE '{}'::jsonb END
  -- issue #4522 (N2) — overpayment returned in full on top of the policy
  -- refund (its own refund, never part of per_payment_refund); absent when none.
    || CASE WHEN v_overpayment_return > 0
       THEN jsonb_build_object('overpayment_return_cents', v_overpayment_return,
              'total_back_cents', v_refund_total_cents + v_overpayment_return)
       ELSE '{}'::jsonb END;
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
  v_op jsonb;
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
    -- issue #4522 G-3 / G-4 — an unfinished cancel is resumed with the
    -- refunds it intended at cancel time (section 6b), never re-computed.
    v_op:=public.issue_4522_trip_cancel_operation(p_order_id);
    IF v_op IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok',true,'resume',true,'operation',true,
        'refund_id',v_op->'refund_id',
        'per_payment_refund',v_op->'per_payment_refund',
        'refund_total_cents',v_op->'amount_cents',
        'currency',v_op->'currency','tier_pct',v_op->'tier_pct',
        'actor_kind',v_op->'actor_kind','cancel_reason',v_op->'reason',
        'card_tries',COALESCE(v_op->'card_tries','{}'::jsonb),
        'installments_to_cancel','[]'::jsonb
      ) || CASE WHEN v_op ? 'deposit_non_refundable_cents'
           THEN jsonb_build_object('deposit_non_refundable_cents',v_op->'deposit_non_refundable_cents')
           ELSE '{}'::jsonb END;
    END IF;
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

  -- issue #4522 pass 5 (T9-2) — never cancel while a charge of this order can
  -- still land (a marked card charge whose answer is unknown, a second-provider
  -- attempt created or unknown, an open flexible payment): its money would be
  -- left out of the refund. Under the order graph lock (the charge paths take
  -- it to mark), so no charge can start between this check and the cancel.
  -- The caller retries once the charge settles (webhook or the next cron
  -- read-back).
  IF public.issue_4522_lock_order_graph(p_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','order_not_found');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_installments oi
     WHERE oi.order_id=p_order_id AND oi.status IN ('scheduled','failed')
       AND (oi.kind='flex'
            OR oi.in_flight_attempt_id IS NOT NULL
            OR (oi.provider='stripe' AND oi.status='scheduled'
                AND oi.stripe_payment_intent_id IS NOT NULL AND oi.failed_at IS NULL)
            OR EXISTS (SELECT 1 FROM public.order_installment_charge_attempts a
                        WHERE a.installment_id=oi.id AND a.state IN ('created','unknown')))
  ) THEN
    RETURN jsonb_build_object('ok',false,'reason','balance_payment_in_flight');
  END IF;

  -- issue #4522 (D-9) — a host or operator cancel refunds a non-refundable deposit.
  PERFORM set_config('mingla.cancel_actor_kind',p_actor_kind,true);
  v_compute:=public.biz_compute_refund_for_cancel(p_order_id,p_cancel_at);
  PERFORM set_config('mingla.cancel_actor_kind','',true);
  IF NOT (v_compute->>'ok')::boolean THEN
    RETURN v_compute;
  END IF;

  -- issue #4522 (E-6) — a cancel whose refund comes to nothing (no policy
  -- tier applies, a non-refundable deposit) cancels with no refund row:
  -- refunds.amount_cents must be positive, and there is nothing to send.
  -- refund_id is then NULL and the edge skips every provider step.
  IF (v_compute->>'refund_total_cents')::bigint > 0 THEN
    -- issue #4522 G-3 / G-4 — the refunds row is the cancel's one refund
    -- operation: it carries the refunds this cancel intends (one per
    -- collected charge) and who cancelled, so a host retry and the
    -- instalment run can finish it exactly as it began (section 6b).
    INSERT INTO public.refunds(
      order_id,amount_cents,currency,status,reason,
      application_fee_refunded_cents,metadata
    ) VALUES(
      p_order_id,(v_compute->>'refund_total_cents')::bigint,
      v_compute->>'currency','pending',
      left(coalesce(p_reason,'tr4_cancel'),200),NULL,
      jsonb_build_object('trip_cancel',jsonb_build_object(
        'v',1,'actor_kind',p_actor_kind,'actor_user_id',p_actor_user_id,
        'reason',p_reason,'tier_pct',v_compute->'tier_pct',
        'per_payment_refund',v_compute->'per_payment_refund','failures',0)
        || CASE WHEN v_compute ? 'deposit_non_refundable_cents'
           THEN jsonb_build_object('deposit_non_refundable_cents',v_compute->'deposit_non_refundable_cents')
           ELSE '{}'::jsonb END)
    ) RETURNING id INTO v_refund_id;
  END IF;

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
    'ok',true,'refund_id',v_refund_id,'operation',v_refund_id IS NOT NULL,
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

-- ---------------------------------------------------------------------------
-- 3. Payouts never count money being returned (N2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_order_installment_provider_sale(p_installment_id uuid, p_application_fee_amount_cents integer, p_provider_fee_cents integer, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.order_installments;
BEGIN
  IF p_installment_id IS NULL THEN
    RAISE EXCEPTION 'installment_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_application_fee_amount_cents IS NULL OR p_application_fee_amount_cents < 0 THEN
    RAISE EXCEPTION 'invalid_application_fee' USING ERRCODE = '22023';
  END IF;
  IF p_provider_fee_cents IS NULL OR p_provider_fee_cents < 0 THEN
    RAISE EXCEPTION 'invalid_provider_fee' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.order_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'installment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IS DISTINCT FROM 'collected' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'not_collected',
      'status', v_row.status
    );
  END IF;

  UPDATE public.order_installments
  SET application_fee_amount_cents = p_application_fee_amount_cents,
      provider_fee_cents = p_provider_fee_cents,
      payout_accounting_state = CASE
        WHEN payout_accounting_state IN ('attached', 'manual_review')
          THEN payout_accounting_state
        -- issue #4522 (N2) — held back while part of it is being returned
        -- or while a flexible payment is unsettled; released by
        -- issue_4522_sync_row_payout_hold.
        WHEN public.issue_4522_row_payout_blocked(p_installment_id)
          THEN 'pending'
        ELSE 'ready'
      END,
      updated_at = p_now
  WHERE id = p_installment_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'installment_id', v_row.id,
    'payout_accounting_state', v_row.payout_accounting_state,
    'application_fee_amount_cents', v_row.application_fee_amount_cents,
    'provider_fee_cents', v_row.provider_fee_cents
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. A host's trip cancel refunds only what the charge still holds for the
--    trip (T3-1). Body as 20280204003645 except the overpayment term.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3645_cancel_refund_installment(
  p_installment_id uuid,
  p_reason text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_inst public.order_installments;
  v_order public.orders;
  v_brand_id uuid;
  v_existing public.refunds;
  v_charged bigint;
  v_unapplied bigint;
  v_amount bigint;
  v_refund_id uuid;
  v_account text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;
  IF public.issue_3645_lock_installment_graph(p_installment_id) IS NULL THEN
    RAISE EXCEPTION 'installment_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_inst.order_id;
  SELECT e.brand_id INTO v_brand_id FROM public.events e WHERE e.id = v_order.event_id;
  IF v_inst.provider = 'stripe' THEN
    SELECT sca.stripe_account_id INTO v_account
      FROM public.stripe_connect_accounts sca
     WHERE sca.brand_id = v_brand_id AND sca.detached_at IS NULL
     ORDER BY sca.created_at DESC
     LIMIT 1;
  END IF;
  v_charged := coalesce(v_inst.buyer_total_cents, v_inst.amount_cents);

  SELECT * INTO v_existing FROM public.refunds
   WHERE metadata ->> 'idempotency_key' = p_idempotency_key
     AND order_installment_id = p_installment_id
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'refund_id', v_existing.id, 'order_id', v_inst.order_id, 'installment_id', v_inst.id,
      'provider', v_inst.provider, 'amount_cents', v_existing.amount_cents,
      'currency', trim(v_existing.currency),
      'source_reference', v_inst.stripe_payment_intent_id,
      'provider_transaction_id', v_inst.provider_transaction_id,
      'stripe_charge_id', v_inst.stripe_charge_id,
      'application_fee_amount_cents', v_inst.application_fee_amount_cents,
      'connected_account_id', v_account,
      'is_full_refund', v_existing.amount_cents = v_charged AND v_inst.refunded_amount_cents = 0,
      'idempotent_replay', true
    );
  END IF;

  IF v_inst.status <> 'collected' THEN
    RAISE EXCEPTION 'installment_not_refundable: status=%', v_inst.status USING ERRCODE = 'P0002';
  END IF;

  -- Cancel refunds already issued for this instalment but not yet applied to
  -- its counter (pending, or committed before a crash) still count.
  SELECT coalesce(sum(r.amount_cents), 0) INTO v_unapplied
    FROM public.refunds r
   WHERE r.order_installment_id = p_installment_id
     AND r.status IN ('pending', 'succeeded')
     AND r.metadata ->> 'kind' = 'installment_cancel_refund'
     AND NOT EXISTS (SELECT 1 FROM public.order_installment_refund_applications a
                      WHERE a.refund_id = r.id AND a.installment_id = p_installment_id);
  -- issue #4522 (T3-1) — the overpaid part of a flexible payment that is not
  -- yet returned is refunded by its own lane (held, pending at the provider
  -- or stopped for ops); asking for it here would exceed what the provider
  -- still holds on the charge while that refund is pending.
  v_amount := v_charged - v_inst.refunded_amount_cents - v_unapplied
              - public.issue_4522_row_unreturned_overpayment(p_installment_id);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  INSERT INTO public.refunds (
    order_id, order_installment_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    v_inst.order_id, v_inst.id, v_amount::integer, v_inst.currency, trim(p_reason), NULL, 'pending',
    v_inst.stripe_payment_intent_id, v_inst.stripe_charge_id,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'kind', 'installment_cancel_refund')
  ) RETURNING id INTO v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id, 'order_id', v_inst.order_id, 'installment_id', v_inst.id,
    'provider', v_inst.provider, 'amount_cents', v_amount,
    'currency', trim(v_inst.currency),
    'source_reference', v_inst.stripe_payment_intent_id,
    'provider_transaction_id', v_inst.provider_transaction_id,
    'stripe_charge_id', v_inst.stripe_charge_id,
    'application_fee_amount_cents', v_inst.application_fee_amount_cents,
    'connected_account_id', v_account,
    'is_full_refund', v_amount = v_charged,
    'idempotent_replay', false
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_cancel_refund_installment(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_cancel_refund_installment(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. T3-4: an overpayment refund (refunds.metadata source
--    issue_4522_overpayment) is no reversal input. Body as 20271221003872
--    except that condition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_refund_share_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_eligible bigint;
BEGIN
  IF NEW.status='succeeded' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND COALESCE(NEW.metadata->>'source','') <> 'issue_4522_overpayment' THEN
    SELECT COALESCE(sum(amount_cents),NEW.amount_cents,0) INTO v_eligible
    FROM public.refund_line_items WHERE refund_id=NEW.id;
    PERFORM public.payee_share_reverse('ticket',NEW.order_id,
      'refund:'||COALESCE(NEW.stripe_refund_id,NEW.id::text),v_eligible);
  END IF;
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Pass 6 (S9-1): a refund is recorded where its charge lives.
--    The order row is the deposit charge (total_cents / buyer_total_cents are
--    the deposit on a plan order); each collected instalment and flexible
--    payment is its own charge with its own refunded_amount_cents, payout
--    state and order_installment_refund_applications. The order's figure is
--    every settled refund of the order minus the parts applied to its
--    instalment rows; a refund of one instalment (refunds.order_installment_id,
--    which every overpayment return also carries) is never the order's. On an
--    order with no instalment rows this is exactly the plain sum it replaces,
--    so orders_refunded_amount_not_exceed_total keeps guarding every order.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_order_charge_refunded_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(sum(r.amount_cents - LEAST(r.amount_cents, COALESCE((
           SELECT sum(x.amount_cents) FROM public.order_installment_refund_applications x
            WHERE x.refund_id = r.id), 0))), 0)::integer
    FROM public.refunds r
   WHERE r.order_id = p_order_id AND r.status = 'succeeded' AND r.order_installment_id IS NULL
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_order_charge_refunded_cents(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4522_order_charge_refunded_cents(uuid) IS
  'Issue #4522 (S9-1): what has been refunded of the order''s own charge (the deposit on a plan order): settled refunds of the order minus their parts applied to instalment rows; instalment refunds (order_installment_id) excluded. The one owner of orders.refunded_amount_cents for the refund finalize and the trip-cancel commit.';

-- Body as 20280305003281 except: instalment parts recorded on their rows
-- first, and the order total from issue_4522_order_charge_refunded_cents.
CREATE OR REPLACE FUNCTION public.issue_2097_finalize_refund_attempt(
  p_attempt_id uuid,p_lease_owner uuid,p_lease_epoch bigint,p_status text,
  p_fee_refund_id text,p_fee_refund_amount_text text,p_after_amount_refunded_text text,
  p_stripe_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v public.ticket_refund_attempts%ROWTYPE; v_refund public.refunds%ROWTYPE;
  v_total integer; v_order_status text; v_amount integer;
  v_attempt_count integer; v_expected_count integer; v_nonterminal_count integer;
  v_positive_total bigint; v_aggregate_status text;
BEGIN
  SELECT * INTO v FROM public.ticket_refund_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v.status IN ('succeeded_positive','not_applicable','fee_evidence_unavailable','evidence_conflict') THEN
    RETURN jsonb_build_object('status',v.status,'application_fee_refunded_cents',v.fee_refund_amount_text,'idempotent_replay',true);
  END IF;
  IF v.lease_owner IS DISTINCT FROM p_lease_owner OR v.lease_epoch<>p_lease_epoch OR v.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'stale_refund_lease';
  END IF;
  IF p_status NOT IN ('succeeded_positive','not_applicable','fee_evidence_unavailable','evidence_conflict') THEN RAISE EXCEPTION 'invalid_fee_status'; END IF;
  IF p_status='succeeded_positive' THEN
    IF p_fee_refund_id IS NULL OR p_fee_refund_amount_text !~ '^[1-9][0-9]{0,15}$'
      OR p_after_amount_refunded_text !~ '^[1-9][0-9]{0,15}$'
      OR p_after_amount_refunded_text::numeric-v.baseline_amount_refunded_text::numeric<>p_fee_refund_amount_text::numeric
      OR p_after_amount_refunded_text::numeric>v.application_fee_amount_text::numeric THEN
      RAISE EXCEPTION 'fee_evidence_conflict';
    END IF;
    v_amount:=p_fee_refund_amount_text::integer;
  ELSIF p_status='not_applicable' THEN
    IF v.application_fee_id IS NOT NULL OR v.application_fee_amount_text<>'0'
       OR p_fee_refund_id IS NOT NULL OR p_fee_refund_amount_text<>'0'
       OR p_after_amount_refunded_text<>'0' OR v.buyer_refund_id IS NULL THEN
      RAISE EXCEPTION 'no_fee_evidence_conflict';
    END IF;
    v_amount:=0;
  ELSIF p_status='evidence_conflict' AND p_fee_refund_amount_text IS NOT NULL THEN
    IF p_fee_refund_id IS NULL OR p_fee_refund_amount_text !~ '^(0|[1-9][0-9]{0,15})$' THEN
      RAISE EXCEPTION 'invalid_conflict_evidence';
    END IF;
  ELSIF p_fee_refund_amount_text IS NOT NULL THEN RAISE EXCEPTION 'unknown_fee_amount_must_be_null'; END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=v.refund_id FOR UPDATE;
  INSERT INTO public.ticket_refund_fee_evidence(attempt_id,stripe_event_id,application_fee_id,
    fee_refund_id,amount_text,currency,connected_account_id,charge_id,provider_mode,evidence_kind)
  VALUES(v.id,p_stripe_event_id,v.application_fee_id,p_fee_refund_id,p_fee_refund_amount_text,
    v.currency,v.connected_account_id,v.charge_id,v.provider_mode,
    CASE WHEN p_status='succeeded_positive' THEN 'fee_refund' WHEN p_status='not_applicable' THEN 'no_fee'
      WHEN p_status='fee_evidence_unavailable' THEN 'visibility_exhausted' ELSE 'conflict' END);
  UPDATE public.ticket_refund_attempts SET status=p_status,fee_refund_id=p_fee_refund_id,
    fee_refund_amount_text=CASE WHEN p_status IN ('succeeded_positive','not_applicable') THEN p_fee_refund_amount_text END,
    observed_fee_refund_amount_text=p_fee_refund_amount_text,last_observed_at=now(),next_observation_at=NULL,
    updated_at=now() WHERE id=v.id;
  SELECT COUNT(*),MAX(expected_attempt_count),
    COUNT(*) FILTER (WHERE status NOT IN ('succeeded_positive','not_applicable')),
    COALESCE(SUM(fee_refund_amount_text::bigint) FILTER (WHERE status='succeeded_positive'),0)
    INTO v_attempt_count,v_expected_count,v_nonterminal_count,v_positive_total
  FROM public.ticket_refund_attempts WHERE refund_id=v.refund_id;
  v_aggregate_status:=CASE
    WHEN EXISTS(SELECT 1 FROM public.ticket_refund_attempts a WHERE a.refund_id=v.refund_id AND a.status='evidence_conflict') THEN 'evidence_conflict'
    WHEN EXISTS(SELECT 1 FROM public.ticket_refund_attempts a WHERE a.refund_id=v.refund_id AND a.status='fee_evidence_unavailable') THEN 'fee_evidence_unavailable'
    WHEN v_attempt_count=v_expected_count AND v_nonterminal_count=0 AND v_positive_total>0 THEN 'succeeded_positive'
    WHEN v_attempt_count=v_expected_count AND v_nonterminal_count=0 THEN 'not_applicable'
    ELSE 'pending_visibility' END;
  UPDATE public.refunds SET application_fee_refund_status=v_aggregate_status,
    application_fee_refunded_cents=CASE WHEN v_aggregate_status='succeeded_positive' THEN v_positive_total::integer
      WHEN v_aggregate_status='not_applicable' THEN 0 ELSE NULL END,
    status=CASE WHEN v_aggregate_status IN ('succeeded_positive','not_applicable') THEN 'succeeded' ELSE status END,
    processed_at=CASE WHEN v_aggregate_status IN ('succeeded_positive','not_applicable')
      THEN COALESCE(processed_at,now()) ELSE processed_at END
  WHERE id=v.refund_id;
  IF v_aggregate_status IN ('succeeded_positive','not_applicable') THEN
  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  -- It comes before the ticket update: that update's counter trigger locks the
  -- ticket type, which a dashboard refund takes only after the order.
  -- issue #4522 pass 6 (S9-1) — each refunded instalment or flexible-payment
  -- charge of this refund is recorded on its own row, in this transaction,
  -- by the one owner (a replay is a no-op; the edge's own call replays too).
  -- Before the order lock: the instalment graph locks the event, then the order.
  PERFORM public.issue_3645_mark_installment_refunded(oi.id, v.refund_id, a.buyer_refund_amount_text::bigint)
     FROM public.ticket_refund_attempts a
     JOIN public.order_installments oi
       ON oi.order_id = a.order_id AND oi.stripe_payment_intent_id = a.payment_intent_id
    WHERE a.refund_id = v.refund_id AND a.buyer_refund_id IS NOT NULL
      AND a.buyer_refund_amount_text ~ '^[1-9][0-9]{0,15}$'
    ORDER BY oi.ordinal, oi.id;
  PERFORM 1 FROM public.orders WHERE id = v.order_id FOR NO KEY UPDATE;
    UPDATE public.tickets t SET status='refunded' FROM public.ticket_refund_quarantine x
      JOIN public.ticket_refund_attempts a ON a.id=x.attempt_id
      WHERE a.refund_id=v.refund_id AND x.ticket_id=t.id AND t.status='refund_pending';
    -- issue #4522 pass 6 (S9-1) — the order holds what was refunded of its own
    -- (deposit) charge; instalment charges are counted on their rows.
    v_total := public.issue_4522_order_charge_refunded_cents(v.order_id);
    v_order_status:=public.issue_3281_settled_payment_status(v.order_id);
    UPDATE public.orders SET payment_status=v_order_status,refunded_amount_cents=v_total,updated_at=now() WHERE id=v.order_id;
    IF p_status='succeeded_positive' THEN
      UPDATE public.mingla_revenue_log SET refunded_amount_cents=LEAST(amount_cents,
        p_after_amount_refunded_text::integer),refunded=(p_after_amount_refunded_text::integer>=amount_cents),updated_at=now()
        WHERE stripe_application_fee_id=v.application_fee_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('status',p_status,'aggregate_status',v_aggregate_status,
    'application_fee_refunded_cents',CASE WHEN v_aggregate_status='succeeded_positive' THEN v_positive_total::integer
      WHEN v_aggregate_status='not_applicable' THEN 0 END,
    'new_payment_status',v_order_status,'idempotent_replay',false);
END;$function$;

-- Body as 20260612000000 except: the zero fee is recorded with its status
-- (the second provider keeps no fee on a refund; the bare zero broke
-- refunds_application_fee_amount_truth_check, so no second-provider trip
-- cancel ever settled), and the order's deposit-charge refund and payment
-- status settle with the refund, as every other refund commit does.
CREATE OR REPLACE FUNCTION public.biz_cancel_trip_booking_commit(
  p_refund_id uuid,
  p_stripe_refund_ids text[],
  p_application_fee_refunded_cents int,
  p_processed_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  UPDATE public.refunds
    SET status = 'succeeded',
        stripe_refund_id = p_stripe_refund_ids[1],  -- primary refund id; full list in metadata
        application_fee_refunded_cents = p_application_fee_refunded_cents,
        application_fee_refund_status = CASE WHEN p_application_fee_refunded_cents = 0
          THEN 'not_applicable' ELSE application_fee_refund_status END,
        processed_at = p_processed_at
   WHERE id = p_refund_id AND status = 'pending'
  RETURNING order_id INTO v_order_id;
  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_not_pending_or_not_found');
  END IF;
  PERFORM 1 FROM public.orders WHERE id = v_order_id FOR NO KEY UPDATE;
  UPDATE public.orders
     SET refunded_amount_cents = public.issue_4522_order_charge_refunded_cents(v_order_id),
         -- a cancel that keeps part of the order's own charge (a deposit
         -- the traveler cannot get back) leaves it partly refunded, so what
         -- was kept is still the host's to be paid.
         payment_status = CASE
           WHEN public.issue_4522_order_charge_refunded_cents(v_order_id)
                >= COALESCE(buyer_total_cents, total_cents)
           THEN public.issue_3281_settled_payment_status(v_order_id)
           ELSE 'partial_refund' END,
         updated_at = now()
   WHERE id = v_order_id;
  RETURN jsonb_build_object('ok', true, 'refund_id', p_refund_id);
END;
$$;
REVOKE ALL ON FUNCTION public.biz_cancel_trip_booking_commit(uuid, text[], int, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_cancel_trip_booking_commit(uuid, text[], int, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 6b. G-3 / G-4: one trip cancel is one refund operation, always completable.
--     The cancel's refunds row is the operation. biz_cancel_trip_booking_begin
--     writes the refunds it intends (one per collected charge) into
--     metadata.trip_cancel with who cancelled and why. Until every intended
--     refund is made at the provider AND recorded, and the cancel's records
--     and buyer emails are written, the operation is in progress
--     (metadata.trip_cancel has no completed_at): a host retry of the cancel
--     (begin) and the instalment run (issue_4522_trip_cancels_to_resume)
--     resume it. While its refunds row is pending, issue_4522_payout_item_now
--     holds every sale of the booking at 0.
--     What was sent stays on the provider attempts: ticket_refund_attempts
--     (card, one per charge, same provider idempotency key on every replay)
--     and paystack_refund_attempts (second provider; error_message
--     'provider_call_started' marks one that was sent, so it is never sent
--     again — a sent one with no answer is read back, never re-sent).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_trip_cancel_operation(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object('refund_id', r.id, 'order_id', r.order_id,
           'amount_cents', r.amount_cents, 'currency', r.currency,
           'refund_status', r.status, 'created_at', r.created_at)
         || (r.metadata->'trip_cancel')
    FROM public.refunds r
   WHERE r.order_id = p_order_id AND r.status IN ('pending', 'succeeded')
     AND r.metadata ? 'trip_cancel' AND NOT (r.metadata->'trip_cancel' ? 'completed_at')
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_cancel_operation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_trip_cancel_operation(uuid) TO service_role;
COMMENT ON FUNCTION public.issue_4522_trip_cancel_operation(uuid) IS
  'Issue #4522 G-3/G-4: the unfinished trip cancel of an order (its refunds row, the refunds it intends, who cancelled), or NULL when none is in progress.';

-- The instalment run's read-back: cancels in progress, not touched for two
-- minutes, still inside the retry budget (3 failed attempts, the #3645
-- instalment budget); past it ops have been told once and a host retry is
-- still possible.
CREATE FUNCTION public.issue_4522_trip_cancels_to_resume(p_limit integer DEFAULT 20)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT r.order_id
    FROM public.refunds r
    JOIN public.orders o ON o.id = r.order_id
   WHERE r.status IN ('pending', 'succeeded') AND r.metadata ? 'trip_cancel'
     AND NOT (r.metadata->'trip_cancel' ? 'completed_at')
     AND o.cancelled_at IS NOT NULL
     AND COALESCE((r.metadata #>> '{trip_cancel,failures}')::integer, 0) < 3
     AND COALESCE((r.metadata #>> '{trip_cancel,last_attempt_at}')::timestamptz, r.created_at)
         <= now() - interval '2 minutes'
   ORDER BY r.created_at, r.id
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 50)
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_cancels_to_resume(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_trip_cancels_to_resume(integer) TO service_role;

-- One step of an operation, recorded on it. p_kind:
--   'failure'     a refund could not be made or recorded (counts toward 3);
--   'waiting'     the provider is still answering (no count);
--   'unconfirmed' a second-provider refund was sent with no answer;
--   'completed'   every intended refund made and recorded.
-- alert is true exactly once per cause: the 3rd failure, the first
-- unconfirmed. first_completion is true for the one call that completed it.
-- p_refused_charge: a card refund of this charge suffix ('deposit' or the
-- instalment id) that the provider refused with no money moved; the next try
-- uses a new provider key (a refused key would only replay its refusal).
CREATE FUNCTION public.issue_4522_trip_cancel_note(p_refund_id uuid, p_kind text, p_detail text DEFAULT NULL,
  p_refused_charge text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v jsonb;
  v_failures integer;
  v_cause text;
  v_alert boolean := false;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('failure', 'waiting', 'unconfirmed', 'completed') THEN
    RAISE EXCEPTION 'trip_cancel_note_kind_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT r.metadata->'trip_cancel' INTO v FROM public.refunds r WHERE r.id = p_refund_id FOR UPDATE;
  IF v IS NULL OR v ? 'completed_at' THEN
    RETURN jsonb_build_object('alert', false, 'first_completion', false,
      'failures', COALESCE((v->>'failures')::integer, 0));
  END IF;
  v_failures := COALESCE((v->>'failures')::integer, 0) + CASE WHEN p_kind = 'failure' THEN 1 ELSE 0 END;
  v_cause := CASE WHEN p_kind = 'failure' AND v_failures >= 3 THEN 'failure'
                  WHEN p_kind = 'unconfirmed' THEN 'unconfirmed' END;
  IF v_cause IS NOT NULL AND NOT (COALESCE(v->'alerted', '[]'::jsonb) ? v_cause) THEN
    v_alert := true;
    v := jsonb_set(v, '{alerted}', COALESCE(v->'alerted', '[]'::jsonb) || to_jsonb(v_cause));
  END IF;
  v := v || jsonb_build_object('failures', v_failures, 'last_attempt_at', now())
         || CASE WHEN p_detail IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('last_error', left(p_detail, 300)) END
         || CASE WHEN p_kind = 'completed' THEN jsonb_build_object('completed_at', now()) ELSE '{}'::jsonb END
         || CASE WHEN p_refused_charge IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('card_tries', COALESCE(v->'card_tries', '{}'::jsonb)
              || jsonb_build_object(p_refused_charge,
                   COALESCE((v #>> ARRAY['card_tries', p_refused_charge])::integer, 0) + 1)) END;
  UPDATE public.refunds SET metadata = jsonb_set(metadata, '{trip_cancel}', v) WHERE id = p_refund_id;
  RETURN jsonb_build_object('alert', v_alert, 'first_completion', p_kind = 'completed',
    'failures', v_failures);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_cancel_note(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_trip_cancel_note(uuid, text, text, text) TO service_role;

-- A second-provider refund of an operation is sent at most once: the one
-- caller that marks the attempt 'provider_call_started' sends it. p_release:
-- the provider answered that it refused it (no money moved), so it counts as
-- never sent again and a later run may send it.
CREATE FUNCTION public.issue_4522_claim_trip_paystack_send(
  p_refund_id uuid, p_merchant_note text, p_release boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_release THEN
    UPDATE public.paystack_refund_attempts
       SET error_message = 'refused_before_any_refund', updated_at = now()
     WHERE local_refund_id = p_refund_id AND merchant_note = p_merchant_note
       AND status = 'pending' AND provider_refund_id IS NULL
       AND error_message = 'provider_call_started';
    RETURN FOUND;
  END IF;
  UPDATE public.paystack_refund_attempts
     SET error_message = 'provider_call_started', updated_at = now()
   WHERE local_refund_id = p_refund_id AND merchant_note = p_merchant_note
     AND status = 'pending' AND provider_refund_id IS NULL
     AND error_message IS DISTINCT FROM 'provider_call_started';
  RETURN FOUND;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_claim_trip_paystack_send(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_claim_trip_paystack_send(uuid, text, boolean) TO service_role;


-- ---------------------------------------------------------------------------
-- 7. Pass 6 (S9-1): an instalment whose charge the provider has refunded is
--    never paid out before our books show it. issue_4522_row_payout_blocked
--    (20281129044522) holds the row while a provider refund of its charge has
--    no application on it; these keep its payout state in step.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_refund_payout_hold_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'ticket_refund_attempts' THEN
    PERFORM public.issue_4522_sync_row_payout_hold(oi.id)
       FROM public.order_installments oi
      WHERE oi.order_id = NEW.order_id AND oi.stripe_payment_intent_id = NEW.payment_intent_id;
    -- Section 8 (gap 2): a payout already holding the order's deposit or
    -- sale is held too while this provider refund is unrecorded.
    PERFORM public.issue_4522_sync_order_payouts(NEW.order_id);
  ELSIF TG_TABLE_NAME = 'paystack_refund_attempts' THEN
    IF NEW.source_type = 'order_installment' THEN
      PERFORM public.issue_4522_sync_row_payout_hold(NEW.source_id);
      PERFORM public.issue_4522_sync_order_payouts(oi.order_id)
         FROM public.order_installments oi WHERE oi.id = NEW.source_id;
    ELSE
      PERFORM public.issue_4522_sync_order_payouts(NEW.source_id);
    END IF;
  ELSE
    PERFORM public.issue_4522_sync_row_payout_hold(NEW.installment_id);
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_refund_payout_hold_trigger() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER issue_4522_refund_payout_hold
  AFTER INSERT OR UPDATE OF buyer_refund_id ON public.ticket_refund_attempts
  FOR EACH ROW WHEN (NEW.buyer_refund_id IS NOT NULL AND NEW.payment_intent_id IS NOT NULL)
  EXECUTE FUNCTION public.issue_4522_refund_payout_hold_trigger();
CREATE TRIGGER issue_4522_refund_payout_hold
  AFTER INSERT OR UPDATE OF status ON public.paystack_refund_attempts
  FOR EACH ROW WHEN (NEW.source_type IN ('order_installment', 'order'))
  EXECUTE FUNCTION public.issue_4522_refund_payout_hold_trigger();
CREATE TRIGGER issue_4522_refund_payout_hold
  AFTER INSERT ON public.order_installment_refund_applications
  FOR EACH ROW EXECUTE FUNCTION public.issue_4522_refund_payout_hold_trigger();

-- ---------------------------------------------------------------------------
-- 8. A host is never paid money that went back to a traveler (gaps 1 and 2 of
--    "Rework I"; Seth, 2026-11-23: "Yes, fix it here").
--    A sale is attached to a payout release with what it is worth at that
--    moment; payout_release_items is append-only, so a later refund never
--    reached the release (main: a fully refunded ₦286,500 item stayed due).
--    One formula now says what each order sale or instalment charge is worth
--    (issue_4522_payout_item_now) and issue_3645_release_projected_totals,
--    the one projection every unpaid-release writer already uses, reads it:
--      * recorded refunds since attach come off (never above the item);
--      * while a refund of the order is pending, or the provider refunded and
--        our books have not recorded it, the sale is held at 0 (the deposit
--        too: gap 2);
--      * other sources (RSVP, venue, stay) are unchanged.
--    Writers:
--      * issue_4522_sync_release_refunds (the one owner): an unpaid release
--        not being sent takes the projection, atomically with the refund that
--        changed it; a paid release opens or grows its #3645
--        post_release_refund payout debt, recovered from the next payouts; a
--        release being sent is left alone and synced when its outcome is
--        recorded (the status trigger below).
--      * the execution guard in both authorize functions re-reads the
--        projection under the release lock and never sends more.
--    Every refund-recording path reaches the owner through triggers on the
--    rows it settles (refunds, orders, order_installments, provider refund
--    attempts), so no refund path needs its own call. The refund paths never
--    wait on a busy release (SKIP LOCKED) and never fail because of a payout:
--    the guard at execution is the backstop.
-- ---------------------------------------------------------------------------

-- 8a0. A cancelled booking whose last refund did not go through (G-4: the
--      provider refused it before any money moved, the booking stays
--      cancelled): every sale of it is held from payouts until a refund is
--      recorded. A cancel that refunds nothing writes no refund row.
CREATE FUNCTION public.issue_4522_cancel_refund_unsettled(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = p_order_id AND o.cancelled_at IS NOT NULL
       AND (SELECT r.status FROM public.refunds r WHERE r.order_id = o.id
             ORDER BY r.created_at DESC, r.id DESC LIMIT 1) IN ('failed', 'cancelled'))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_cancel_refund_unsettled(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 8a. What one payout item is worth now: (refunded, net, settled net).
--     net is 0 while a refund of its charge is pending or unrecorded;
--     settled net counts recorded refunds only (what a paid release owes back).
CREATE FUNCTION public.issue_4522_payout_item_now(
  p_source_type text, p_source_id uuid, p_gross integer, p_refunded integer,
  p_disputed integer, p_fee integer, p_net integer)
RETURNS TABLE (refunded_cents bigint, net_cents bigint, settled_net_cents bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order uuid;
  v_refunded bigint;
  v_fee bigint := p_fee;
  v_held boolean := false;
  v_settled bigint;
BEGIN
  IF p_source_type = 'order' THEN
    -- The same figures the payout sweep attaches an order with.
    SELECT o.id, o.refunded_amount_cents,
           greatest(0, coalesce(o.stripe_application_fee_amount_cents, 0) - coalesce((
             SELECT sum(rf.application_fee_refunded_cents) FROM public.refunds rf
              WHERE rf.order_id = o.id AND rf.status = 'succeeded'
                AND rf.application_fee_refund_status = 'succeeded_positive'), 0))
      INTO v_order, v_refunded, v_fee
      FROM public.orders o WHERE o.id = p_source_id;
    v_held := EXISTS (SELECT 1 FROM public.refunds r
                       WHERE r.order_id = p_source_id AND r.status = 'pending'
                         AND r.order_installment_id IS NULL)
      OR EXISTS (SELECT 1 FROM public.ticket_refund_attempts a
                   JOIN public.refunds r ON r.id = a.refund_id
                  WHERE a.order_id = p_source_id AND a.buyer_refund_id IS NOT NULL
                    AND r.status <> 'succeeded' AND r.order_installment_id IS NULL)
      OR EXISTS (SELECT 1 FROM public.paystack_refund_attempts pa
                   LEFT JOIN public.refunds r ON r.id = pa.local_refund_id
                  WHERE pa.source_type = 'order' AND pa.source_id = p_source_id
                    AND pa.status <> 'failed'
                    AND (pa.status IN ('accepted', 'processed') OR pa.provider_refund_id IS NOT NULL)
                    AND r.status IS DISTINCT FROM 'succeeded')
      OR public.issue_4522_cancel_refund_unsettled(p_source_id);
  ELSIF p_source_type = 'order_installment' THEN
    SELECT oi.order_id, oi.refunded_amount_cents INTO v_order, v_refunded
      FROM public.order_installments oi WHERE oi.id = p_source_id;
    v_held := EXISTS (SELECT 1 FROM public.refunds r
                       WHERE r.order_id = v_order AND r.status = 'pending'
                         AND (r.order_installment_id IS NULL OR r.order_installment_id = p_source_id))
      OR public.issue_4522_row_refund_unrecorded(p_source_id)
      OR public.issue_4522_cancel_refund_unsettled(v_order);
  END IF;
  IF v_order IS NULL THEN
    RETURN QUERY SELECT p_refunded::bigint, p_net::bigint, p_net::bigint;
    RETURN;
  END IF;
  v_settled := least(p_net::bigint,
    greatest(0, p_gross::bigint - v_refunded - p_disputed - v_fee));
  RETURN QUERY SELECT greatest(p_refunded::bigint, least(p_gross::bigint, v_refunded)),
    CASE WHEN v_held THEN 0::bigint ELSE v_settled END, v_settled;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_payout_item_now(text, uuid, integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_payout_item_now(text, uuid, integer, integer, integer, integer, integer)
  TO service_role;

-- 8b. One ops alert per release and cause, through the #3645 alert outbox
--     (existing kinds; the sweep picks the words from the message prefix).
--     p_kind NULL: the release provider's attempt-cap kind.
CREATE FUNCTION public.issue_4522_alert_payout_refund(
  p_release_id uuid, p_kind text, p_message text, p_now timestamptz DEFAULT now())
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.payout_release_alert_outbox (
    release_id, alert_kind, idempotency_key, brand_id, error_message, created_at, updated_at)
  SELECT r.id,
         coalesce(p_kind, CASE WHEN r.provider = 'stripe' THEN 'stripe_attempt_cap' ELSE 'paystack_attempt_cap' END),
         'issue_4522:' || split_part(p_message, ':', 1) || ':' || r.id::text,
         r.brand_id, left(p_message, 1000), p_now, p_now
    FROM public.brand_payout_releases r WHERE r.id = p_release_id
  ON CONFLICT (release_id, alert_kind) DO NOTHING;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_alert_payout_refund(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- 8c. What a paid release owes back: what its sales were worth when it was
--     paid (the paying claim's snapshot, #3645 2e-1; without one, the items
--     as attached) minus what they are worth now after recorded refunds
--     (a refund still pending is not owed back until it settles).
CREATE FUNCTION public.issue_4522_release_refund_liability(p_release_id uuid, p_with_holds boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_paid bigint;
  v_now bigint;
  v_unheld bigint;
BEGIN
  SELECT (s.projected->>'items_net_cents')::bigint INTO v_paid
    FROM public.brand_payout_releases r
    JOIN public.payout_release_claim_snapshots s ON s.id = r.paid_snapshot_id
   WHERE r.id = p_release_id;
  IF v_paid IS NULL THEN
    SELECT coalesce(sum(i.net_cents), 0) INTO v_paid
      FROM public.payout_release_items i WHERE i.release_id = p_release_id;
  END IF;
  SELECT t.items_net_cents INTO v_now FROM public.issue_3645_release_projected_totals(p_release_id) t;
  -- p_with_holds: a refund the provider has made (or is making) counts as
  -- refunded even before our books record it (the cap below uses this).
  SELECT CASE WHEN p_with_holds THEN 0 ELSE coalesce(sum(n.settled_net_cents - n.net_cents), 0) END INTO v_unheld
    FROM public.payout_release_items i
   CROSS JOIN LATERAL public.issue_4522_payout_item_now(
     i.source_type, i.source_id, i.gross_cents, i.refunded_cents,
     i.disputed_cents, i.mingla_fee_cents, i.net_cents) n
   WHERE i.release_id = p_release_id AND i.source_type IN ('order', 'order_installment');
  RETURN greatest(0, v_paid - (coalesce(v_now, 0) + v_unheld));
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_release_refund_liability(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

-- 8d. The one owner. Returns what it did: projected | debt | busy | <status>.
--     p_wait = false (refund paths): never wait on a release a sweep or a
--     payout holds; the execution guard catches what this skips.
CREATE FUNCTION public.issue_4522_sync_release_refunds(
  p_release_id uuid, p_wait boolean DEFAULT false, p_now timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rel public.brand_payout_releases%ROWTYPE;
  v_p record;
  v_target bigint;
  v_room integer;
  v_debt public.organiser_payout_debts%ROWTYPE;
BEGIN
  SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = p_release_id;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF v_rel.status = 'released' THEN
    IF public.issue_4522_release_refund_liability(p_release_id) <= 0 THEN
      RETURN 'released';
    END IF;
    -- A debt must not be lost: wait. Same lock order as
    -- record_paystack_refund_outcome (the release, then the released pool).
    SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = p_release_id FOR UPDATE;
    IF v_rel.status <> 'released' THEN
      RETURN public.issue_4522_sync_release_refunds(p_release_id, p_wait, p_now);
    END IF;
    PERFORM 1 FROM public.brand_payout_releases r
     WHERE r.brand_id = v_rel.brand_id AND r.currency = v_rel.currency AND r.status = 'released'
       AND (v_rel.event_id IS NULL OR r.event_id IS NOT DISTINCT FROM v_rel.event_id)
     ORDER BY r.id FOR UPDATE;
    -- What the host was paid for sales since refunded. The debt is set to
    -- at least this (never added to): record_paystack_refund_outcome grows
    -- the same debt from its own per-refund adjustments the same way, so
    -- whichever records a refund first, it is counted once.
    v_target := public.issue_4522_release_refund_liability(p_release_id);
    v_room := public.organiser_refund_debt_room_cents(
      v_rel.brand_id, v_rel.currency, v_rel.event_id, p_release_id);
    v_target := least(v_target, v_room::bigint);
    IF v_target <= 0 THEN RETURN 'released'; END IF;
    SELECT * INTO v_debt FROM public.organiser_payout_debts
     WHERE origin_release_id = p_release_id AND kind = 'post_release_refund' FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM public.convert_postponement_debt_to_permanent(
        p_release_id, 'post_release_refund', v_target::integer, p_now);
    ELSIF v_target > v_debt.principal_cents THEN
      UPDATE public.organiser_payout_debts
         SET principal_cents = v_target::integer, status = 'open', closed_at = NULL, updated_at = p_now
       WHERE id = v_debt.id;
    END IF;
    RETURN 'debt';
  END IF;

  IF p_wait THEN
    SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = p_release_id FOR UPDATE;
  ELSE
    SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = p_release_id
      FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN 'busy'; END IF;
  END IF;
  IF v_rel.status = 'released' THEN
    RETURN public.issue_4522_sync_release_refunds(p_release_id, true, p_now);
  END IF;
  -- Being sent (claimed, or Paystack legs planned or under way), closed or
  -- failed: never moved here.
  IF NOT public.issue_3645_release_settleable(p_release_id) THEN
    RETURN v_rel.status;
  END IF;
  SELECT * INTO v_p FROM public.issue_3645_settle_release_projection(p_release_id, p_now);
  UPDATE public.brand_payout_releases
     SET refunded_cents = v_p.refunded_cents, disputed_cents = v_p.disputed_cents,
         net_release_cents = v_p.net_release_cents, updated_at = p_now
   WHERE id = p_release_id
     AND (refunded_cents, disputed_cents, net_release_cents)
         IS DISTINCT FROM (v_p.refunded_cents, v_p.disputed_cents, v_p.net_release_cents);
  RETURN 'projected';
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_sync_release_refunds(uuid, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_sync_release_refunds(uuid, boolean, timestamptz)
  TO service_role;

-- 8e. Every release holding the order's sale or one of its charges. Called
--     from refund-recording rows: it never raises (a refund the provider has
--     made is always recorded); a failure is a warning plus one ops alert.
CREATE FUNCTION public.issue_4522_sync_order_payouts(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release uuid;
  v_n integer := 0;
BEGIN
  IF p_order_id IS NULL THEN RETURN 0; END IF;
  FOR v_release IN
    SELECT DISTINCT i.release_id FROM public.payout_release_items i
     WHERE (i.source_type = 'order' AND i.source_id = p_order_id)
        OR (i.source_type = 'order_installment' AND i.source_id IN (
              SELECT oi.id FROM public.order_installments oi WHERE oi.order_id = p_order_id))
     ORDER BY 1
  LOOP
    BEGIN
      PERFORM public.issue_4522_sync_release_refunds(v_release, false, now());
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_4522_sync_order_payouts release=% sqlstate=% message=%',
        v_release, SQLSTATE, SQLERRM;
      BEGIN
        PERFORM public.issue_4522_alert_payout_refund(v_release, NULL,
          format('payout_refund_sync_failed: order %s %s %s', p_order_id, SQLSTATE, SQLERRM), now());
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'issue_4522_sync_order_payouts alert failed release=%', v_release;
      END;
    END;
  END LOOP;
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_sync_order_payouts(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_4522_refund_payout_sync_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    PERFORM public.issue_4522_sync_order_payouts(NEW.id);
  ELSIF TG_TABLE_NAME = 'payout_release_items' THEN
    -- Attached this transaction (the sweep holds the release): take the
    -- projection now, so a sale attached while a refund was pending or
    -- already recorded is never due in full.
    BEGIN
      PERFORM public.issue_4522_sync_release_refunds(NEW.release_id, true, now());
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_4522 attach sync release=% sqlstate=% message=%',
        NEW.release_id, SQLSTATE, SQLERRM;
    END;
  ELSE
    PERFORM public.issue_4522_sync_order_payouts(NEW.order_id);
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_refund_payout_sync_trigger() FROM PUBLIC, anon, authenticated, service_role;

-- At commit, after every row of the refund is settled (one consistent state,
-- whichever order a refund path writes refunds, orders and rows in).
CREATE CONSTRAINT TRIGGER issue_4522_refund_payout_sync
  AFTER INSERT OR UPDATE OF status ON public.refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.order_id IS NOT NULL)
  EXECUTE FUNCTION public.issue_4522_refund_payout_sync_trigger();
CREATE CONSTRAINT TRIGGER issue_4522_refund_payout_sync
  AFTER UPDATE OF refunded_amount_cents ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.refunded_amount_cents IS DISTINCT FROM NEW.refunded_amount_cents)
  EXECUTE FUNCTION public.issue_4522_refund_payout_sync_trigger();
CREATE CONSTRAINT TRIGGER issue_4522_refund_payout_sync
  AFTER UPDATE OF refunded_amount_cents ON public.order_installments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.refunded_amount_cents IS DISTINCT FROM NEW.refunded_amount_cents)
  EXECUTE FUNCTION public.issue_4522_refund_payout_sync_trigger();
CREATE CONSTRAINT TRIGGER issue_4522_refund_payout_sync
  AFTER INSERT ON public.payout_release_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.source_type IN ('order', 'order_installment'))
  EXECUTE FUNCTION public.issue_4522_refund_payout_sync_trigger();

-- A release whose payout was under way when a refund landed is synced when
-- the outcome is recorded: paid → the refund becomes its payout debt;
-- returned to pending (or blocked) → it takes the projection. Never raises
-- (the payout's own record must always be written).
CREATE FUNCTION public.issue_4522_release_outcome_sync_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  BEGIN
    PERFORM public.issue_4522_sync_release_refunds(NEW.id, true, now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_4522 outcome sync release=% sqlstate=% message=%', NEW.id, SQLSTATE, SQLERRM;
    BEGIN
      PERFORM public.issue_4522_alert_payout_refund(NEW.id, NULL,
        format('payout_refund_sync_failed: %s %s', SQLSTATE, SQLERRM), now());
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_4522 outcome sync alert failed release=%', NEW.id;
    END;
  END;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_release_outcome_sync_trigger() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue_4522_release_outcome_sync
  AFTER UPDATE OF status ON public.brand_payout_releases
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status <> 'in_flight')
  EXECUTE FUNCTION public.issue_4522_release_outcome_sync_trigger();

-- 8e2. G-2: a refund debt on an order payout never exceeds what the host
--      was paid for the sales since refunded (main's second-provider outcome
--      books every trip refund, instalments included, against the order's
--      payout at the full refunded amount). Charges never paid out come off
--      their own unpaid release instead (the owner above). Never below what
--      was already recovered.
CREATE FUNCTION public.issue_4522_refund_debt_cap_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cap bigint;
BEGIN
  -- Only where the payout's own sales were refunded (a refund row or a
  -- provider refund attempt for them); a debt opened on other grounds is
  -- left as it is.
  IF NOT EXISTS (
    SELECT 1 FROM public.payout_release_items i
      LEFT JOIN public.order_installments oi ON i.source_type = 'order_installment' AND oi.id = i.source_id
     WHERE i.release_id = NEW.origin_release_id AND i.source_type IN ('order', 'order_installment')
       AND (EXISTS (SELECT 1 FROM public.refunds r
                     WHERE r.order_id = CASE WHEN i.source_type = 'order' THEN i.source_id ELSE oi.order_id END)
            OR EXISTS (SELECT 1 FROM public.paystack_refund_attempts pa
                        WHERE pa.source_type = i.source_type AND pa.source_id = i.source_id))) THEN
    RETURN NEW;
  END IF;
  v_cap := greatest(public.issue_4522_release_refund_liability(NEW.origin_release_id, true), NEW.recovered_cents);
  IF NEW.principal_cents > v_cap THEN
    NEW.principal_cents := v_cap::integer;
    IF NEW.principal_cents <= NEW.recovered_cents THEN
      NEW.status := 'closed';
      NEW.closed_at := coalesce(NEW.closed_at, now());
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_refund_debt_cap_trigger() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue_4522_refund_debt_cap
  BEFORE INSERT OR UPDATE OF principal_cents ON public.organiser_payout_debts
  FOR EACH ROW WHEN (NEW.kind = 'post_release_refund')
  EXECUTE FUNCTION public.issue_4522_refund_debt_cap_trigger();

-- 8f. One ops alert when a refund after payout becomes a payout debt
--     (whichever #3645 path opened it).
CREATE FUNCTION public.issue_4522_refund_debt_alert_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.issue_4522_alert_payout_refund(NEW.origin_release_id, NULL,
    format('payout_refund_debt_opened: %s %s owed back from the next payouts', NEW.principal_cents, upper(NEW.currency)),
    now());
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_refund_debt_alert_trigger() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue_4522_refund_debt_alert
  AFTER INSERT OR UPDATE OF principal_cents ON public.organiser_payout_debts
  FOR EACH ROW WHEN (NEW.kind = 'post_release_refund' AND NEW.principal_cents > 0)
  EXECUTE FUNCTION public.issue_4522_refund_debt_alert_trigger();

-- 8g. The projection reads what each sale is worth now (body as
--     20280508003645 except the now_ lateral and its two uses).
CREATE OR REPLACE FUNCTION public.issue_3645_release_projected_totals(
  p_release_id uuid
) RETURNS TABLE (
  refunded_cents integer,
  disputed_cents integer,
  net_release_cents integer,
  items_net_cents bigint,
  withheld_cents bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH rel AS (
    SELECT r.id, r.provider,
      -- #3645 2d: Σ(amount − converted − returned) over the release's
      -- applications, not the attach-time columns, so debt handed back by
      -- issue_3645_return_unrecovered_release_debt is no longer withheld.
      public.issue_3645_release_effective_withheld(r.id) AS withheld
    FROM public.brand_payout_releases r
    WHERE r.id = p_release_id
  ), items AS (
    SELECT
      item.gross_cents::bigint AS gross,
      item.refunded_cents::bigint AS refunded,
      item.disputed_cents::bigint AS disputed,
      item.net_cents::bigint AS net,
      -- Paystack: same evidence as paystack_release_has_unresolved_dispute
      -- (unresolved, or resolved against the merchant).
      CASE WHEN rel.provider = 'paystack' THEN coalesce((
        SELECT sum(dispute.amount_cents::bigint)
        FROM public.paystack_disputes dispute
        WHERE (
            (item.source_type = 'order' AND dispute.order_id = item.source_id)
            OR (
              item.source_type = 'rsvp_contribution'
              AND dispute.rsvp_contribution_id = item.source_id
            )
            OR (
              item.source_type = 'venue_menu_order'
              AND dispute.venue_menu_order_id = item.source_id
            )
            OR (
              item.source_type = 'order_installment'
              AND dispute.order_installment_id = item.source_id
            )
            OR (
              item.source_type = 'venue_reservation'
              AND EXISTS (
                SELECT 1
                FROM public.reservation_checkout_sessions checkout
                WHERE checkout.id = item.source_id
                  AND checkout.reservation_id = dispute.venue_reservation_id
              )
            )
          )
          AND (
            dispute.is_resolved IS NOT TRUE
            OR lower(coalesce(dispute.resolution, '')) IN (
              'merchant-accepted', 'merchant_accepted', 'accepted'
            )
          )
      ), 0) ELSE 0 END AS paystack_hold,
      coalesce(stay.refunded, 0) AS stay_refunded,
      greatest(coalesce(stay.disputed, 0), 0) AS stay_disputed,
      greatest(coalesce(stay.net_hold, 0), 0) AS stay_net_hold,
      -- issue #4522 (section 8): what the sale is worth now, after the
      -- refunds recorded (or still being made) since it was attached.
      now_.refunded_cents AS now_refunded,
      now_.net_cents AS now_net
    FROM rel
    JOIN public.payout_release_items item ON item.release_id = rel.id
    LEFT JOIN LATERAL (
      SELECT
        sum(hold.refunded_cents)::bigint AS refunded,
        sum(hold.disputed_cents)::bigint AS disputed,
        sum(hold.net_hold_cents)::bigint AS net_hold
      FROM public.stay_payout_release_holds hold
      WHERE item.source_type = 'stay_reservation'
        AND hold.release_id = rel.id
        AND hold.line_id = item.source_id
    ) stay ON true
    CROSS JOIN LATERAL public.issue_4522_payout_item_now(
      item.source_type, item.source_id, item.gross_cents, item.refunded_cents,
      item.disputed_cents, item.mingla_fee_cents, item.net_cents
    ) now_
  ), per_item AS (
    SELECT
      least(gross, now_refunded + stay_refunded) AS refunded,
      disputed + least(net, paystack_hold) + stay_disputed AS disputed,
      now_net - least(now_net, paystack_hold + stay_net_hold) AS net
    FROM items
  )
  SELECT
    least(coalesce(sum(per_item.refunded), 0), 2147483647)::integer,
    least(coalesce(sum(per_item.disputed), 0), 2147483647)::integer,
    -- maturity_recredit_cents stays out: claims pay net + recredit.
    greatest(0, least(
      coalesce(sum(per_item.net), 0)
        - rel.withheld,
      2147483647
    ))::integer,
    coalesce(sum(per_item.net), 0)::bigint,
    rel.withheld
  FROM rel
  LEFT JOIN per_item ON true
  GROUP BY rel.withheld;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_release_projected_totals(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_release_projected_totals(uuid) TO service_role;

-- 8h. The execution guards (bodies as 20280422003645 / 20280602003645 except
--     the marked issue #4522 section 8 hunks).
CREATE OR REPLACE FUNCTION public.authorize_stripe_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_amount_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_event_status text;
  v_expected integer;
  v_owed record;  -- issue #4522 section 8
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='stripe'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stripe_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.stripe_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status<>'in_flight'
     OR v_release.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'stale_stripe_execution_claim' USING ERRCODE='P0001';
  END IF;
  -- #3645: like Paystack, fail closed while a stay dispute held on this
  -- unpaid release is open. Won returns the hold; lost keeps it and unblocks.
  IF public.issue_3645_stay_release_has_open_dispute(p_release_id) THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='stay_dispute_open',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;
  v_expected:=v_release.net_release_cents+v_release.maturity_recredit_cents;
  IF p_amount_cents IS DISTINCT FROM v_expected OR v_expected<=0 THEN
    RAISE EXCEPTION 'stripe_release_amount_not_ledger_exact'
      USING ERRCODE='P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT e.status INTO v_event_status
    FROM public.events e
    WHERE e.id=v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status='blocked_anchor',
          error_message='missing_live_event_truth',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_event_status='cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status='cancelled_event',
          error_message='event_cancelled_before_stripe_payout',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
  END IF;

  IF v_release.releasable_at > p_now THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='release_no_longer_mature',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;

  -- issue #4522 section 8: the last check before money moves. A refund (or
  -- an unrecorded provider refund) since this release's sales were attached
  -- lowered what it owes: never send the old amount. Store what it owes,
  -- put it back for the next claim, and tell ops once.
  SELECT * INTO v_owed FROM public.issue_3645_release_projected_totals(p_release_id);
  IF v_owed.net_release_cents < v_release.net_release_cents THEN
    UPDATE public.brand_payout_releases
    SET refunded_cents=v_owed.refunded_cents,
        disputed_cents=v_owed.disputed_cents,
        net_release_cents=v_owed.net_release_cents,
        status='pending',
        error_message='payout_refund_unreconciled',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    PERFORM public.issue_4522_alert_payout_refund(p_release_id, 'paystack_plan_exceeds_due',
      format('payout_refund_unreconciled: stripe due %s > owed %s',
        v_release.net_release_cents::bigint+v_release.maturity_recredit_cents,
        v_owed.net_release_cents::bigint+v_release.maturity_recredit_cents), p_now);
    RETURN false;
  END IF;

  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.authorize_stripe_payout_execution(uuid, uuid, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_stripe_payout_execution(uuid, uuid, integer, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_paystack_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_event_status text;
  v_plan_cents bigint;  -- #3645 bundle 4
  v_due_cents bigint;  -- #3645 bundle 4
  v_owed record;  -- issue #4522 section 8
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id = p_release_id AND provider = 'paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Fail closed before the stale-claim check so a dispute arriving between
  -- claim and authorization cleanly cancels that attempt without provider I/O.
  IF public.paystack_release_has_unresolved_dispute(p_release_id) THEN
    UPDATE public.brand_payout_releases
    SET status = 'pending',
        error_message = 'paystack_dispute_open',
        paystack_execution_claim_id = NULL,
        paystack_execution_claimed_at = NULL,
        updated_at = p_now
    WHERE id = p_release_id;
    RETURN false;
  END IF;

  IF v_release.paystack_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status <> 'in_flight'
     OR v_release.paystack_transfer_code IS NOT NULL THEN
    RAISE EXCEPTION 'stale_paystack_execution_claim' USING ERRCODE = 'P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT status INTO v_event_status
    FROM public.events
    WHERE id = v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status = 'blocked_anchor',
          error_message = 'missing_live_event_truth',
          paystack_execution_claim_id = NULL,
          paystack_execution_claimed_at = NULL,
          updated_at = p_now
      WHERE id = p_release_id;
      RETURN false;
    END IF;
    IF v_event_status = 'cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status = 'cancelled_event',
          error_message = 'event_cancelled_before_paystack_transfer',
          paystack_execution_claim_id = NULL,
          paystack_execution_claimed_at = NULL,
          updated_at = p_now
      WHERE id = p_release_id;
      RETURN false;
    END IF;
  END IF;

  IF v_release.releasable_at > p_now THEN
    UPDATE public.brand_payout_releases
    SET status = 'pending',
        error_message = 'release_no_longer_mature',
        paystack_execution_claim_id = NULL,
        paystack_execution_claimed_at = NULL,
        updated_at = p_now
    WHERE id = p_release_id;
    RETURN false;
  END IF;

  -- issue #4522 section 8: a refund (or an unrecorded provider refund)
  -- since this release's sales were attached lowers what it owes before the
  -- plan check below, which then refuses the larger plan and alerts ops.
  SELECT * INTO v_owed FROM public.issue_3645_release_projected_totals(p_release_id);
  IF v_owed.net_release_cents < v_release.net_release_cents THEN
    UPDATE public.brand_payout_releases
    SET refunded_cents = v_owed.refunded_cents,
        disputed_cents = v_owed.disputed_cents,
        net_release_cents = v_owed.net_release_cents,
        updated_at = p_now
    WHERE id = p_release_id;
    v_release.net_release_cents := v_owed.net_release_cents;
  END IF;

  -- #3645 bundle 4: the organiser legs were planned from the pool at claim
  -- time. If a hold or refund has since lowered what this release owes
  -- (its net plus recredits), sending that plan would overpay the host.
  -- Never send it: put the release back, keep the legs (a leg may already
  -- be at Paystack), and alert ops. If the release owes the plan again (a
  -- dispute won), the next claim sends it unchanged.
  SELECT coalesce(sum(
    leg.principal_cents::bigint + leg.estimated_fee_cents + leg.stamp_duty_cents
  ), 0)
  INTO v_plan_cents
  FROM public.payout_transfer_legs leg
  WHERE leg.release_id = p_release_id
    AND leg.kind = 'organiser'
    AND leg.status NOT IN ('failed', 'reversed');
  v_due_cents := v_release.net_release_cents::bigint + coalesce((
    SELECT sum(a.amount_cents)
    FROM public.payout_ledger_adjustments a
    WHERE a.release_id = p_release_id AND a.kind = 'maturity_recredit'
  ), 0);
  IF v_plan_cents > v_due_cents THEN
    UPDATE public.brand_payout_releases
    SET status = 'pending',
        error_message = 'paystack_plan_exceeds_due',
        paystack_execution_claim_id = NULL,
        paystack_execution_claimed_at = NULL,
        updated_at = p_now
    WHERE id = p_release_id;
    INSERT INTO public.payout_release_alert_outbox (
      release_id, alert_kind, idempotency_key, brand_id, error_message,
      created_at, updated_at
    ) VALUES (
      p_release_id, 'paystack_plan_exceeds_due',
      'paystack_plan_exceeds_due:' || p_release_id::text,
      v_release.brand_id,
      left(format('plan %s > due %s', v_plan_cents, v_due_cents), 1000),
      p_now, p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN false;
  END IF;

  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.authorize_paystack_payout_execution(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_paystack_payout_execution(uuid, uuid, timestamptz) TO service_role;

COMMIT;
