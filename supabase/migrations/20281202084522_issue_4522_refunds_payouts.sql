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
--     and v2 refunds cannot overflow the orders integer column; days before
--     departure are calendar days in the trip's zone (G-6).
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
--   biz_refund_order_commit and admin_refund_order_commit (20280301003281) —
--     seventh pass (H-7): a second-provider refund commits with its zero
--     fee recorded as not applicable (the bare zero broke
--     refunds_application_fee_amount_truth_check, so a host or Admin refund
--     of a second-provider order never settled after the provider refunded).
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
--   tg_refunds_amount_immutable (20280707414423) — pass 8 (P8-2): the one
--     exception to the pinned cancel amount is a trip cancel's refund of a
--     charge NOT yet made, lowered (never raised) by
--     issue_4522_trip_cancel_resize_charge after the provider refused it as
--     more than the charge holds.

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
    ('public.authorize_paystack_payout_execution(uuid,uuid,timestamptz)','d8c549c1a96ce54133cd8055c5e8219a'),
    ('public.biz_refund_order_commit(uuid,text,integer,text,text)','69518ee8cfca51fb439df4bd90e93ca2'),
    ('public.admin_refund_order_commit(uuid,text,integer,text,text)','d5408a9eacd02fd8ebbb9bdb5b6e23be'),
    ('public.tg_refunds_amount_immutable()','a1c2fb6206726166f9a15d82b0244cb2')
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

-- Pass 8 (P8-1 / P8-2): refunds of the order's own charge still in flight
-- (a seat or add-on refund whose row is pending: not sent yet, sent with no
-- answer, or made at the provider and not yet recorded), as
-- {refund_id: amount on the order's charge}. A trip cancel counts them as
-- already refunded (spec 5.5 refund base), so the cancel and the pending
-- refund together never pass the policy. A trip cancel's own row is never
-- one of them (its confirmed parts are in issue_4522_order_charge_refunded_cents).
CREATE FUNCTION public.issue_4522_order_charge_inflight_refunds(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_object_agg(q.id::text, q.amount) FILTER (WHERE q.amount > 0), '{}'::jsonb)
    FROM (SELECT r.id,
                 (r.amount_cents - LEAST(r.amount_cents, COALESCE((
                    SELECT sum(x.amount_cents) FROM public.order_installment_refund_applications x
                     WHERE x.refund_id = r.id), 0)))::bigint AS amount
            FROM public.refunds r
           WHERE r.order_id = p_order_id AND r.status = 'pending' AND r.order_installment_id IS NULL
             AND NOT (COALESCE(r.metadata, '{}'::jsonb) ? 'trip_cancel')) q
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_order_charge_inflight_refunds(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
  v_charge_left bigint;
  v_inflight jsonb;
  v_inflight_cents bigint := 0;
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

  -- issue #4522 G-6 — days before departure are CALENDAR days: a trip date
  -- is its stored calendar date (UTC Y-M-D, #4420, the rule of
  -- issue_4522_plan_v2_schedule); the cancel moment is read as a date in the
  -- trip's zone. Before this, whole 24-hour blocks to the stored UTC-midnight
  -- instant lost a New York tier about 28 hours early (negative after start).
  v_days_remaining := (v_event_start AT TIME ZONE 'UTC')::date
    - (p_cancel_at AT TIME ZONE COALESCE(NULLIF(v_event.timezone, ''), 'UTC'))::date;

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
  -- Seventh pass (H-1): what is still refundable on the order's own charge
  -- (the deposit on a plan order, the whole payment otherwise). An earlier
  -- refund of it (an add-on, one line) is gone from the provider's charge, so
  -- the cancel never asks for it again. The rule, per charge (spec §5.5
  -- "refund base = paid − already refunded"): policy percentage × (paid −
  -- already refunded on that charge − a kept non-refundable deposit), floor
  -- 0, exactly as each instalment row already is.
  -- Pass 8 (P8-1 / P8-2): a refund of this charge still in flight (pending:
  -- not sent, sent with no answer, or made and not yet recorded) is already
  -- refunded for this rule. Ignoring it let the cancel and that refund
  -- together pass the policy (50% tier: $1,000 back where $750 was due) or
  -- ask the provider for more than the charge still holds (refused for ever).
  v_inflight := public.issue_4522_order_charge_inflight_refunds(v_order.id);
  SELECT COALESCE(sum(value::bigint), 0) INTO v_inflight_cents FROM jsonb_each_text(v_inflight);
  v_charge_left := greatest(0, v_order.total_cents::bigint
    - public.issue_4522_order_charge_refunded_cents(v_order.id) - v_inflight_cents);

  IF v_order.installment_plan_root THEN
    -- Deposit (orders row) + sum of collected installments
    -- issue #4522 (N2) — money a row collected beyond what the plan owed and
    -- has not yet returned is not part of the policy base: it goes back in
    -- full through its own refund (issue_4522_begin_overpayment_refund),
    -- whatever the tier, and is reported as overpayment_return_cents.
    SELECT v_charge_left +
           COALESCE(sum(coalesce(buyer_total_cents, amount_cents) - refunded_amount_cents
                        - public.issue_4522_row_unreturned_overpayment(id)), 0)
    INTO v_paid_total_cents
    FROM public.order_installments
    WHERE order_id = v_order.id AND status = 'collected';

    -- Build per-installment refund attribution (one row per collected installment).
    FOR v_installment IN
      SELECT id, coalesce(buyer_total_cents, amount_cents) - refunded_amount_cents
                 - public.issue_4522_row_unreturned_overpayment(id) AS amount_cents,
             coalesce(buyer_total_cents, amount_cents) AS charge_cents,
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
        -- H-1: the charge as made; a refund of all of it may omit the amount
        -- (a full reversal), anything less must name it.
        'charge_cents', v_installment.charge_cents,
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
                              v_charge_left);
    END IF;

    -- Append the deposit row (orders-level, installment_id=NULL).
    v_per_installment_refund := v_per_installment_refund || jsonb_build_object(
      'installment_id', NULL,
      'ordinal', 0,
      'source_pi', v_order.stripe_payment_intent_id,
      'paid_cents', v_charge_left,
      'charge_cents', v_order.total_cents,
      'refund_cents', FLOOR((v_charge_left - v_deposit_kept)::numeric * v_tier_pct / 100.0)::bigint,
      'currency', v_order.currency,
      'note', 'deposit'
    );
  ELSE
    -- Single-payment order: total_cents = paid; what is left of it after
    -- earlier refunds is what the cancel can refund (H-1).
    v_paid_total_cents := v_charge_left;
    v_per_installment_refund := jsonb_build_array(jsonb_build_object(
      'installment_id', NULL,
      'ordinal', 0,
      'source_pi', v_order.stripe_payment_intent_id,
      'paid_cents', v_charge_left,
      'charge_cents', v_order.total_cents,
      'refund_cents', FLOOR(v_charge_left::numeric * v_tier_pct / 100.0)::bigint,
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
       ELSE '{}'::jsonb END
  -- Pass 8 (P8-1): refunds of the order's charge counted as already refunded
  -- because they are still in flight; absent when none.
    || CASE WHEN v_inflight_cents > 0
       THEN jsonb_build_object('inflight_refund_cents', v_inflight_cents, 'inflight_refunds', v_inflight)
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
           ELSE '{}'::jsonb END
        -- Pass 9 (P9-2): an owed part sent after a counted refund failed
        -- (the booking was already cancelled; no second cancel notice).
        || CASE WHEN v_op ? 'shortfall_of'
           THEN jsonb_build_object('shortfall_of',v_op->'shortfall_of')
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
           ELSE '{}'::jsonb END
        -- Pass 8 (P8-1): the in-flight refunds this cancel counted as already
        -- refunded; one that later fails is owed (issue_4522_trip_cancel_inflight_failed).
        || CASE WHEN v_compute ? 'inflight_refunds'
           THEN jsonb_build_object('inflight_counted',v_compute->'inflight_refunds')
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
  SELECT (COALESCE((
    SELECT sum(r.amount_cents - LEAST(r.amount_cents, COALESCE((
             SELECT sum(x.amount_cents) FROM public.order_installment_refund_applications x
              WHERE x.refund_id = r.id), 0)))
      FROM public.refunds r
     WHERE r.order_id = p_order_id AND r.status = 'succeeded' AND r.order_installment_id IS NULL), 0)
    -- Seventh pass (H-2): a trip cancel still in progress is one refunds row
    -- that settles only when every refund it intends is done. The part of it
    -- the provider has already confirmed on the order's own charge (the
    -- deposit) is refunded money now and is counted now: second provider,
    -- its attempt processed; card, its attempt settled with a buyer refund.
    + COALESCE((
    SELECT sum(pa.amount_cents)
      FROM public.refunds r
      JOIN public.paystack_refund_attempts pa ON pa.local_refund_id = r.id
     WHERE r.order_id = p_order_id AND r.status = 'pending' AND r.order_installment_id IS NULL
       AND r.metadata ? 'trip_cancel' AND pa.status = 'processed'
       AND pa.merchant_note = 'mingla_trip_refund:' || r.id::text || ':deposit'), 0)
    + COALESCE((
    SELECT sum(a.buyer_refund_amount_text::bigint)
      FROM public.refunds r
      JOIN public.orders o ON o.id = r.order_id
      JOIN public.ticket_refund_attempts a ON a.refund_id = r.id
     WHERE r.order_id = p_order_id AND r.status = 'pending' AND r.order_installment_id IS NULL
       AND r.metadata ? 'trip_cancel' AND a.payment_intent_id = o.stripe_payment_intent_id
       AND a.status IN ('succeeded_positive', 'not_applicable') AND a.buyer_refund_id IS NOT NULL
       AND a.buyer_refund_amount_text ~ '^[1-9][0-9]{0,15}$'), 0))::integer
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_order_charge_refunded_cents(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4522_order_charge_refunded_cents(uuid) IS
  'Issue #4522 (S9-1, H-2): what has been refunded of the order''s own charge (the deposit on a plan order): settled refunds of the order minus their parts applied to instalment rows, plus the deposit part of a trip cancel still in progress that the provider has confirmed; instalment refunds (order_installment_id) excluded. The one owner of orders.refunded_amount_cents for the refund finalize, the trip-cancel commit and a confirmed refund of a cancel in progress.';

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

-- Seventh pass (H-7): bodies as 20280301003281 except the marked fee-status
-- line. The second provider keeps no fee on a refund: the commit records the
-- zero as not applicable, as biz_cancel_trip_booking_commit does above.
CREATE OR REPLACE FUNCTION public.biz_refund_order_commit(p_refund_id uuid, p_stripe_refund_id text, p_application_fee_refunded_cents integer, p_status text, p_stripe_tax_transaction_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_caller uuid := auth.uid();
  v_brand_id uuid;
  v_line_item record;
  v_new_payment_status text;
  v_total_refunded_cents int;
BEGIN
  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0010';
  END IF;
  IF v_refund.status <> 'pending' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
    RETURN jsonb_build_object(
      'refund_id', p_refund_id,
      'status', v_refund.status,
      'new_payment_status', v_order.payment_status,
      'total_refunded_cents', v_order.refunded_amount_cents,
      'idempotent_replay', true
    );
  END IF;
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid_commit_status' USING ERRCODE = 'P0012';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'failed' THEN
    UPDATE public.refunds
    SET status = 'failed',
        stripe_tax_transaction_id = COALESCE(p_stripe_tax_transaction_id, stripe_tax_transaction_id),
        processed_at = now()
    WHERE id = p_refund_id;
    RETURN jsonb_build_object('refund_id', p_refund_id, 'status', 'failed', 'idempotent_replay', false);
  END IF;

  UPDATE public.refunds
  SET status = 'succeeded',
      stripe_refund_id = p_stripe_refund_id,
      stripe_tax_transaction_id = p_stripe_tax_transaction_id,
      application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, 0),
      -- issue #4522 seventh pass (H-7): a zero fee is recorded with its status.
      application_fee_refund_status = CASE WHEN COALESCE(p_application_fee_refunded_cents, 0) = 0
        THEN 'not_applicable' ELSE application_fee_refund_status END,
      processed_at = now()
  WHERE id = p_refund_id;

  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  PERFORM 1 FROM public.orders WHERE id = v_order.id FOR NO KEY UPDATE;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = v_order.id AND status = 'succeeded';

  v_new_payment_status := public.issue_3281_settled_payment_status(v_order.id);

  UPDATE public.orders
  SET payment_status = v_new_payment_status,
      refunded_amount_cents = v_total_refunded_cents,
      updated_at = now()
  WHERE id = v_order.id;

  FOR v_line_item IN
    SELECT rli.ticket_type_id, rli.quantity
    FROM public.refund_line_items rli
    WHERE rli.refund_id = p_refund_id
  LOOP
    UPDATE public.tickets t
    SET status = 'refunded'
    WHERE t.id IN (
      SELECT t2.id
      FROM public.tickets t2
      WHERE t2.order_id = v_order.id
        AND t2.ticket_type_id = v_line_item.ticket_type_id
        AND t2.status = 'valid'
      ORDER BY t2.created_at ASC
      LIMIT v_line_item.quantity
    );
  END LOOP;

  RETURN jsonb_build_object(
    'refund_id', p_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'stripe_tax_transaction_id', p_stripe_tax_transaction_id,
    'idempotent_replay', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_refund_order_commit(p_refund_id uuid, p_stripe_refund_id text, p_application_fee_refunded_cents integer, p_status text, p_stripe_tax_transaction_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_line_item record;
  v_new_payment_status text;
  v_total_refunded_cents int;
BEGIN
  -- TWIN GUARD (first executable statement) — see admin_refund_order.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0010';
  END IF;
  IF v_refund.status <> 'pending' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
    RETURN jsonb_build_object(
      'refund_id', p_refund_id,
      'status', v_refund.status,
      'new_payment_status', v_order.payment_status,
      'total_refunded_cents', v_order.refunded_amount_cents,
      'idempotent_replay', true
    );
  END IF;
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid_commit_status' USING ERRCODE = 'P0012';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
  -- Brand permission gate REMOVED (admin twin; gate is the edge fn + service_role grant).

  IF p_status = 'failed' THEN
    UPDATE public.refunds
    SET status = 'failed',
        stripe_tax_transaction_id = COALESCE(p_stripe_tax_transaction_id, stripe_tax_transaction_id),
        processed_at = now()
    WHERE id = p_refund_id;
    RETURN jsonb_build_object('refund_id', p_refund_id, 'status', 'failed', 'idempotent_replay', false);
  END IF;

  UPDATE public.refunds
  SET status = 'succeeded',
      stripe_refund_id = p_stripe_refund_id,
      stripe_tax_transaction_id = p_stripe_tax_transaction_id,
      application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, 0),
      -- issue #4522 seventh pass (H-7): a zero fee is recorded with its status.
      application_fee_refund_status = CASE WHEN COALESCE(p_application_fee_refunded_cents, 0) = 0
        THEN 'not_applicable' ELSE application_fee_refund_status END,
      processed_at = now()
  WHERE id = p_refund_id;

  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  PERFORM 1 FROM public.orders WHERE id = v_order.id FOR NO KEY UPDATE;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = v_order.id AND status = 'succeeded'
    AND order_installment_id IS NULL;  -- issue #3645: instalment refunds are not deposit refunds

  v_new_payment_status := public.issue_3281_settled_payment_status(v_order.id);

  UPDATE public.orders
  SET payment_status = v_new_payment_status,
      refunded_amount_cents = v_total_refunded_cents,
      updated_at = now()
  WHERE id = v_order.id;

  FOR v_line_item IN
    SELECT rli.ticket_type_id, rli.quantity
    FROM public.refund_line_items rli
    WHERE rli.refund_id = p_refund_id
  LOOP
    UPDATE public.tickets t
    SET status = 'refunded'
    WHERE t.id IN (
      SELECT t2.id
      FROM public.tickets t2
      WHERE t2.order_id = v_order.id
        AND t2.ticket_type_id = v_line_item.ticket_type_id
        AND t2.status = 'valid'
      ORDER BY t2.created_at ASC
      LIMIT v_line_item.quantity
    );
  END LOOP;

  RETURN jsonb_build_object(
    'refund_id', p_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'stripe_tax_transaction_id', p_stripe_tax_transaction_id,
    'idempotent_replay', false
  );
END;
$function$;

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
   -- Pass 9 (P9-2): an owed part (shortfall_of) is newer than its cancel;
   -- written in the cancel's own transaction it ties, and still goes first.
   ORDER BY r.created_at DESC, (r.metadata->'trip_cancel' ? 'shortfall_of') DESC, r.id DESC
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
-- unconfirmed, the first step past the 24-hour ceiling ('stuck'); cause names
-- it. first_completion is true for the one call that completed it.
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
  -- Seventh pass (H-1 b): no step of a cancel stays "in progress" forever in
  -- silence. Still waiting on the provider (a refund whose fee or visibility
  -- it has not confirmed, or one it keeps refusing) past the in-flight hard
  -- ceiling (issue_4522_flex_in_flight_ceiling, 24 hours) is one alert, as
  -- the 3rd failure and an unanswered second-provider refund are.
  v_cause := CASE WHEN p_kind = 'failure' AND v_failures >= 3 THEN 'failure'
                  WHEN p_kind = 'unconfirmed' THEN 'unconfirmed'
                  WHEN p_kind IN ('waiting', 'failure')
                   AND (SELECT r.created_at FROM public.refunds r WHERE r.id = p_refund_id)
                       <= now() - public.issue_4522_flex_in_flight_ceiling()
                  THEN 'stuck' END;
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
    'failures', v_failures, 'cause', v_cause);
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

-- Pass 7 (card cancel final status): a cancelled booking whose every charge
-- (the order's own and each collected instalment or flexible payment) is
-- refunded in full ends 'refunded' on both providers; anything kept (a
-- non-refundable deposit, a partial tier) leaves it 'partial_refund'.
CREATE FUNCTION public.issue_4522_settle_trip_cancel_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_status text;
BEGIN
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
  UPDATE public.orders o
     SET payment_status = CASE
           WHEN o.refunded_amount_cents >= COALESCE(o.buyer_total_cents, o.total_cents)
            AND NOT EXISTS (SELECT 1 FROM public.order_installments oi
                             WHERE oi.order_id = o.id AND oi.status = 'collected'
                               AND oi.refunded_amount_cents < COALESCE(oi.buyer_total_cents, oi.amount_cents))
           THEN 'refunded' ELSE 'partial_refund' END,
         updated_at = now()
   WHERE o.id = p_order_id AND o.cancelled_at IS NOT NULL
     AND o.payment_status IN ('paid', 'partial_refund', 'refunded')
     AND EXISTS (SELECT 1 FROM public.refunds r WHERE r.order_id = o.id AND r.status = 'succeeded')
  RETURNING o.payment_status INTO v_status;
  RETURN v_status;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_settle_trip_cancel_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_settle_trip_cancel_status(uuid) TO service_role;

-- Seventh pass (H-2): every refund of a cancel in progress that the provider
-- confirms is recorded against its own charge at once, whatever happens to
-- the other refunds of the same cancel. A second-provider refund is
-- confirmed when its attempt is 'processed' (the refund webhook, the cancel's
-- read-back, or its own answer all write that row through
-- record_paystack_refund_outcome); a card refund when its attempt settles
-- with a buyer refund. An instalment's part goes on its row through the one
-- owner (issue_3645_mark_installment_refunded; a later replay is a no-op);
-- the deposit's part on the order (issue_4522_order_charge_refunded_cents).
-- The cancel itself still completes only when every intended refund is done
-- (the commit), and the buyer emails go then. Never raises: a recording that
-- fails here is left to the cancel's own resume, which alerts ops.
CREATE FUNCTION public.issue_4522_record_confirmed_cancel_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_installment uuid;
  v_amount bigint;
  v_charge_refunded integer;
BEGIN
  IF TG_TABLE_NAME = 'paystack_refund_attempts' THEN
    IF NEW.local_refund_id IS NULL
       OR NEW.merchant_note NOT LIKE 'mingla_trip_refund:' || NEW.local_refund_id::text || ':%' THEN
      RETURN NULL;
    END IF;
    SELECT * INTO v_refund FROM public.refunds WHERE id = NEW.local_refund_id;
    IF split_part(NEW.merchant_note, ':', 3) <> 'deposit' THEN
      v_installment := split_part(NEW.merchant_note, ':', 3)::uuid;
    END IF;
    v_amount := NEW.amount_cents;
  ELSE
    SELECT * INTO v_refund FROM public.refunds WHERE id = NEW.refund_id;
    SELECT oi.id INTO v_installment FROM public.order_installments oi
     WHERE oi.order_id = NEW.order_id AND oi.stripe_payment_intent_id = NEW.payment_intent_id;
    v_amount := NEW.buyer_refund_amount_text::bigint;
  END IF;
  IF v_refund.id IS NULL OR v_refund.status <> 'pending' OR NOT (v_refund.metadata ? 'trip_cancel')
     OR v_refund.order_installment_id IS NOT NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF v_installment IS NOT NULL THEN
      PERFORM public.issue_3645_mark_installment_refunded(v_installment, v_refund.id, v_amount);
    END IF;
    PERFORM 1 FROM public.orders WHERE id = v_refund.order_id FOR NO KEY UPDATE;
    v_charge_refunded := public.issue_4522_order_charge_refunded_cents(v_refund.order_id);
    UPDATE public.orders
       SET refunded_amount_cents = v_charge_refunded,
           payment_status = CASE WHEN v_charge_refunded > 0 AND payment_status = 'paid'
             THEN 'partial_refund' ELSE payment_status END,
           updated_at = now()
     WHERE id = v_refund.order_id AND refunded_amount_cents IS DISTINCT FROM v_charge_refunded;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_4522 confirmed cancel refund not recorded refund=% sqlstate=% message=%',
      v_refund.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_record_confirmed_cancel_refund() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue_4522_record_confirmed_cancel_refund
  AFTER INSERT OR UPDATE OF status ON public.paystack_refund_attempts
  FOR EACH ROW WHEN (NEW.status = 'processed' AND NEW.local_refund_id IS NOT NULL)
  EXECUTE FUNCTION public.issue_4522_record_confirmed_cancel_refund();
CREATE TRIGGER issue_4522_record_confirmed_cancel_refund
  AFTER UPDATE OF status ON public.ticket_refund_attempts
  FOR EACH ROW WHEN (NEW.status IN ('succeeded_positive', 'not_applicable')
    AND NEW.buyer_refund_id IS NOT NULL AND NEW.refund_id IS NOT NULL
    AND NEW.buyer_refund_amount_text ~ '^[1-9][0-9]{0,15}$')
  EXECUTE FUNCTION public.issue_4522_record_confirmed_cancel_refund();

-- Body as 20280707414423 except the pass-8 exception: inside
-- issue_4522_trip_cancel_resize_charge (its transaction-local mark names this
-- refund) a pending trip cancel's amount may be LOWERED, never raised, never
-- to zero. Every other change of amount_cents is still refused.
CREATE OR REPLACE FUNCTION public.tg_refunds_amount_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF OLD.amount_cents IS DISTINCT FROM NEW.amount_cents THEN
    IF COALESCE(current_setting('mingla.trip_cancel_resize_refund', true), '') = OLD.id::text
       AND OLD.status = 'pending' AND NEW.status = 'pending'
       AND COALESCE(OLD.metadata, '{}'::jsonb) ? 'trip_cancel'
       AND NEW.amount_cents > 0 AND NEW.amount_cents < OLD.amount_cents THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL: refunds.amount_cents is immutable post-insert (attempted change from % to %)',
      OLD.amount_cents, NEW.amount_cents;
  END IF;
  RETURN NEW;
END;
$function$;

-- Pass 8 (P8-2): a cancel's refund of one charge that the provider refused
-- because the charge holds less than asked (another refund of it was made,
-- and its answer lost) asks only for what is truly left, once. The rule is
-- the cancel's own (spec 5.5): policy % x (charge - refunded elsewhere - a
-- kept deposit), floor 0, where "refunded elsewhere" is the larger of what
-- Mingla knows (settled + in flight) and what the provider shows on that
-- charge (p_provider_refunded_elsewhere_cents: the cancel's read-back of the
-- provider's refund list, or what staff read on the provider's dashboard).
-- It only ever lowers the ask (never raises it, so nothing is refunded
-- twice), only for a part not yet made, and a replay is a no-op. The next
-- run sends the new amount (a second-provider part released after its
-- refusal is claimed again; a card part uses a new provider key). Never
-- calls the provider and never writes anything off.
CREATE FUNCTION public.issue_4522_trip_cancel_resize_charge(
  p_refund_id uuid, p_part text, p_provider_refunded_elsewhere_cents bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_refund public.refunds;
  v_tc jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_e jsonb;
  v_entry jsonb;
  v_charge bigint;
  v_known bigint;
  v_elsewhere bigint;
  v_left bigint;
  v_kept bigint := 0;
  v_old bigint;
  v_new bigint;
BEGIN
  IF p_provider_refunded_elsewhere_cents IS NOT NULL AND p_provider_refunded_elsewhere_cents < 0 THEN
    RAISE EXCEPTION 'refunded_elsewhere_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT order_id INTO v_order_id FROM public.refunds WHERE id = p_refund_id;
  IF v_order_id IS NULL OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_cancel_not_in_progress');
  END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  v_tc := v_refund.metadata->'trip_cancel';
  IF v_refund.status <> 'pending' OR v_tc IS NULL OR v_tc ? 'completed_at'
     OR v_refund.order_installment_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_cancel_not_in_progress');
  END IF;
  SELECT value INTO v_entry FROM jsonb_array_elements(v_tc->'per_payment_refund')
   WHERE COALESCE(value->>'installment_id', 'deposit') = p_part LIMIT 1;
  IF v_entry IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_cancel_part_not_found');
  END IF;
  v_old := (v_entry->>'refund_cents')::bigint;
  -- a part already made (or sent and unanswered) is never resized.
  IF EXISTS (SELECT 1 FROM public.paystack_refund_attempts pa
              WHERE pa.local_refund_id = p_refund_id
                AND pa.merchant_note = 'mingla_trip_refund:' || p_refund_id::text || ':' || p_part
                AND (pa.status IN ('processed', 'accepted') OR pa.provider_refund_id IS NOT NULL
                     OR pa.error_message = 'provider_call_started'))
     OR EXISTS (SELECT 1 FROM public.ticket_refund_attempts a
                 WHERE a.refund_id = p_refund_id AND a.payment_intent_id = v_entry->>'source_pi'
                   AND a.buyer_refund_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_cancel_part_already_sent');
  END IF;
  IF p_part = 'deposit' THEN
    SELECT COALESCE((v_entry->>'charge_cents')::bigint, o.total_cents::bigint),
           public.issue_4522_order_charge_refunded_cents(o.id)
             + COALESCE((SELECT sum(value::bigint)
                           FROM jsonb_each_text(public.issue_4522_order_charge_inflight_refunds(o.id))), 0)
      INTO v_charge, v_known
      FROM public.orders o WHERE o.id = v_order_id;
    v_kept := COALESCE((v_tc->>'deposit_non_refundable_cents')::bigint, 0);
  ELSE
    SELECT COALESCE(oi.buyer_total_cents, oi.amount_cents)::bigint,
           oi.refunded_amount_cents + public.issue_4522_row_unreturned_overpayment(oi.id)
      INTO v_charge, v_known
      FROM public.order_installments oi
     WHERE oi.id::text = p_part AND oi.order_id = v_order_id;
  END IF;
  v_elsewhere := GREATEST(COALESCE(v_known, 0), COALESCE(p_provider_refunded_elsewhere_cents, 0));
  v_left := GREATEST(0, COALESCE(v_charge, 0) - v_elsewhere);
  v_new := FLOOR(GREATEST(0, v_left - LEAST(v_kept, v_left))::numeric
                 * COALESCE((v_tc->>'tier_pct')::integer, 0) / 100.0)::bigint;
  IF v_new >= v_old THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'part', p_part, 'refund_cents', v_old,
      'refunded_elsewhere_cents', v_elsewhere);
  END IF;
  IF v_refund.amount_cents - (v_old - v_new) <= 0 THEN
    -- nothing at all is left to refund: staff finish it (escalate).
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_cancel_nothing_left', 'part', p_part,
      'refund_cents', v_new, 'refunded_elsewhere_cents', v_elsewhere);
  END IF;
  FOR v_e IN SELECT value FROM jsonb_array_elements(v_tc->'per_payment_refund') LOOP
    IF COALESCE(v_e->>'installment_id', 'deposit') = p_part THEN
      v_e := v_e || jsonb_build_object('refund_cents', v_new, 'paid_cents', v_left);
    END IF;
    v_entries := v_entries || jsonb_build_array(v_e);
  END LOOP;
  v_tc := v_tc || jsonb_build_object('per_payment_refund', v_entries,
    'resized', COALESCE(v_tc->'resized', '{}'::jsonb) || jsonb_build_object(p_part, jsonb_build_object(
      'from_cents', v_old, 'to_cents', v_new, 'refunded_elsewhere_cents', v_elsewhere,
      'provider_refunded_elsewhere_cents', p_provider_refunded_elsewhere_cents, 'at', now())));
  PERFORM set_config('mingla.trip_cancel_resize_refund', p_refund_id::text, true);
  UPDATE public.refunds
     SET amount_cents = amount_cents - (v_old - v_new),
         metadata = jsonb_set(metadata, '{trip_cancel}', v_tc)
   WHERE id = p_refund_id;
  PERFORM set_config('mingla.trip_cancel_resize_refund', '', true);
  -- the part's second-provider attempt (never sent, or released after a
  -- refusal) asks for the new amount; at zero it is never sent.
  UPDATE public.paystack_refund_attempts
     SET amount_cents = CASE WHEN v_new > 0 THEN v_new ELSE amount_cents END,
         status = CASE WHEN v_new > 0 THEN status ELSE 'failed' END,
         error_message = CASE WHEN v_new > 0 THEN error_message ELSE 'resized_to_nothing' END,
         updated_at = now()
   WHERE local_refund_id = p_refund_id
     AND merchant_note = 'mingla_trip_refund:' || p_refund_id::text || ':' || p_part
     AND status = 'pending' AND provider_refund_id IS NULL
     AND error_message IS DISTINCT FROM 'provider_call_started';
  -- Pass 9 (P9-4): the part's card attempt (the fee-truth row that the
  -- provider's answer is recorded against) asks for the new amount too, in
  -- this same transaction, before anything is sent: the next try sends the
  -- new amount and its answer records against it. A card attempt already
  -- holding a provider refund is never touched (the part was not resizable).
  UPDATE public.ticket_refund_attempts
     SET requested_refund_amount_text = v_new::text, updated_at = now()
   WHERE refund_id = p_refund_id AND payment_intent_id = v_entry->>'source_pi'
     AND buyer_refund_id IS NULL AND v_new > 0;
  RETURN jsonb_build_object('ok', true, 'changed', true, 'part', p_part, 'from_cents', v_old,
    'refund_cents', v_new, 'refunded_elsewhere_cents', v_elsewhere);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_cancel_resize_charge(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_trip_cancel_resize_charge(uuid, text, bigint) TO service_role;
COMMENT ON FUNCTION public.issue_4522_trip_cancel_resize_charge(uuid, text, bigint) IS
  'Issue #4522 pass 8 (P8-2): lower a trip cancel''s refund of one charge not yet made to policy % x (charge - refunded elsewhere - kept deposit), refunded elsewhere being the larger of Mingla''s records and the provider''s figure. Only lowers, only unsent parts, replay is a no-op; never calls the provider.';

-- Pass 8 (P8-1) / pass 9 (P9-2, P9-3): an in-flight refund a trip cancel
-- counted as already refunded that then fails (or is cancelled) leaves the
-- traveler owed the difference: what the cancel's policy would have refunded
-- without it minus what it did (issue_4522_trip_cancel_owed_if_failed).
--
-- Pass 9 (P9-2): the owed amount is SENT automatically, exactly once, by the
-- cancel's own resume, as its own trip cancel refund part on the same charge
-- (the order's charge: the deposit part). Its refunds row id is derived from
-- the cancel and the failed refund (md5 of both), so the row, its
-- second-provider merchant note and its card provider key
-- (tr4_cancel:<that id>:deposit) are the same on every replay and it can be
-- inserted only once. It is an ordinary cancel part: the resume sends it,
-- records it, the payout hold and debt rules see it as a cancel refund.
--
-- Terminal (the only states that send): the counted refund's row moved
-- pending -> 'failed' or 'cancelled' AND the provider holds no sign of it
-- having been made: no second-provider attempt of it processed, accepted,
-- carrying a provider refund id or sent with no answer, and no card attempt
-- of it holding a buyer refund or ever permitted to call the provider.
-- refund-order writes 'failed' only when the provider refused the refund
-- (a non-retryable refusal: nothing was created); an unknown outcome stays
-- 'pending' (P9-3 covers that). Any contradicting sign keeps the owed amount
-- recorded but NOT sent (held), and ops are told why. If the counted refund
-- later turns 'succeeded' while the owed part is not yet sent, that part is
-- cancelled (issue_4522_trip_cancel_inflight_recovered), so it is never paid
-- twice.
CREATE FUNCTION public.issue_4522_trip_cancel_owed_if_failed(
  p_tc jsonb, p_payment_plan_terms jsonb, p_failed_cents bigint)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_dep jsonb;
  v_left bigint;
  v_kept bigint;
  v_kept_new bigint;
  v_pct integer;
BEGIN
  SELECT value INTO v_dep FROM jsonb_array_elements(p_tc->'per_payment_refund')
   WHERE value->>'installment_id' IS NULL LIMIT 1;
  v_left := COALESCE((v_dep->>'paid_cents')::bigint, 0);
  v_pct := COALESCE((p_tc->>'tier_pct')::integer, 0);
  v_kept := COALESCE((p_tc->>'deposit_non_refundable_cents')::bigint, 0);
  v_kept_new := CASE WHEN v_kept > 0
    THEN LEAST(GREATEST(COALESCE((p_payment_plan_terms->>'deposit_minor')::bigint, 0), 0), v_left + p_failed_cents)
    ELSE 0 END;
  RETURN GREATEST(0, FLOOR(GREATEST(0, v_left + p_failed_cents - v_kept_new)::numeric * v_pct / 100.0)::bigint
          - FLOOR(GREATEST(0, v_left - v_kept)::numeric * v_pct / 100.0)::bigint);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_cancel_owed_if_failed(jsonb, jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- Pass 9 (P9-2): the provider holds a sign that this refund was made (or may
-- have been: sent with no answer, or a card call permitted).
CREATE FUNCTION public.issue_4522_refund_maybe_made(p_refund_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.paystack_refund_attempts pa
                  WHERE pa.local_refund_id = p_refund_id
                    AND (pa.status IN ('processed', 'accepted') OR pa.provider_refund_id IS NOT NULL
                         OR pa.error_message = 'provider_call_started'))
      OR EXISTS (SELECT 1 FROM public.ticket_refund_attempts a
                  WHERE a.refund_id = p_refund_id
                    AND (a.buyer_refund_id IS NOT NULL OR a.provider_call_permitted_at IS NOT NULL))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_refund_maybe_made(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_4522_trip_cancel_inflight_failed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_c record;
  v_dep jsonb;
  v_amt bigint;
  v_owed bigint;
  v_held boolean;
  v_sf uuid;
  v_provider text;
BEGIN
  v_held := public.issue_4522_refund_maybe_made(NEW.id);
  FOR v_c IN
    SELECT r.id, r.order_id, r.metadata->'trip_cancel' AS tc, o.payment_plan_terms
      FROM public.refunds r JOIN public.orders o ON o.id = r.order_id
     WHERE r.order_id = NEW.order_id AND r.id <> NEW.id AND r.status IN ('pending', 'succeeded')
       AND (r.metadata #> '{trip_cancel,inflight_counted}') ? NEW.id::text
       AND NOT (COALESCE(r.metadata #> '{trip_cancel,shortfalls}', '{}'::jsonb) ? NEW.id::text)
     FOR UPDATE OF r
  LOOP
    v_amt := (v_c.tc #>> ARRAY['inflight_counted', NEW.id::text])::bigint;
    v_owed := public.issue_4522_trip_cancel_owed_if_failed(v_c.tc, v_c.payment_plan_terms, v_amt);
    IF v_owed > 0 THEN
      SELECT value INTO v_dep FROM jsonb_array_elements(v_c.tc->'per_payment_refund')
       WHERE value->>'installment_id' IS NULL LIMIT 1;
      v_sf := NULL;
      IF NOT v_held AND v_dep IS NOT NULL AND NULLIF(v_dep->>'source_pi', '') IS NOT NULL THEN
        v_sf := md5('issue_4522_trip_cancel_shortfall:' || v_c.id::text || ':' || NEW.id::text)::uuid;
        INSERT INTO public.refunds(id, order_id, amount_cents, currency, status, reason,
          application_fee_refunded_cents, metadata)
        VALUES (v_sf, NEW.order_id, v_owed, NEW.currency, 'pending',
          left(COALESCE(v_c.tc->>'reason', 'tr4_cancel'), 200), NULL,
          jsonb_build_object('trip_cancel', jsonb_build_object(
            'v', 1, 'actor_kind', v_c.tc->'actor_kind', 'actor_user_id', v_c.tc->'actor_user_id',
            'reason', v_c.tc->'reason', 'tier_pct', v_c.tc->'tier_pct', 'failures', 0,
            'shortfall_of', jsonb_build_object('cancel_refund_id', v_c.id, 'failed_refund_id', NEW.id,
              'failed_refund_cents', v_amt),
            'per_payment_refund', jsonb_build_array(v_dep || jsonb_build_object('refund_cents', v_owed)))))
        ON CONFLICT (id) DO NOTHING;
        IF FOUND THEN
          SELECT b.payment_provider INTO v_provider
            FROM public.orders o JOIN public.events e ON e.id = o.event_id
            JOIN public.brands b ON b.id = e.brand_id
           WHERE o.id = NEW.order_id;
          IF v_provider = 'paystack' THEN
            INSERT INTO public.paystack_refund_attempts(
              source_type, source_id, local_refund_id, transaction_reference,
              merchant_note, amount_cents, currency, status, idempotency_key)
            VALUES ('order', NEW.order_id, v_sf, v_dep->>'source_pi',
              'mingla_trip_refund:' || v_sf::text || ':deposit', v_owed, 'ngn', 'pending',
              'paystack-refund:mingla_trip_refund:' || v_sf::text || ':deposit');
          END IF;
        END IF;
      END IF;
      UPDATE public.refunds
         SET metadata = jsonb_set(metadata, '{trip_cancel,shortfalls}',
               COALESCE(metadata #> '{trip_cancel,shortfalls}', '{}'::jsonb)
               || jsonb_build_object(NEW.id::text, jsonb_build_object(
                    'owed_cents', v_owed, 'currency', lower(btrim(NEW.currency)),
                    'failed_refund_cents', v_amt, 'tier_pct', COALESCE((v_c.tc->>'tier_pct')::integer, 0),
                    'at', now())
                  || CASE WHEN v_sf IS NOT NULL THEN jsonb_build_object('shortfall_refund_id', v_sf)
                          ELSE jsonb_build_object('held', true) END))
       WHERE id = v_c.id;
    END IF;
  END LOOP;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_cancel_inflight_failed() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue_4522_trip_cancel_inflight_failed
  AFTER UPDATE OF status ON public.refunds
  FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status IN ('failed', 'cancelled'))
  EXECUTE FUNCTION public.issue_4522_trip_cancel_inflight_failed();

-- Pass 9 (P9-2): a counted refund marked failed that later turns out to have
-- succeeded: its owed part, if not yet sent, is cancelled (nothing is sent,
-- the traveler is whole). One already sent is left as made and ops are told
-- (overlap) by the claim below; nothing is ever written off.
CREATE FUNCTION public.issue_4522_trip_cancel_inflight_recovered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_c record;
  v_sf uuid;
BEGIN
  FOR v_c IN
    SELECT r.id, r.metadata #> ARRAY['trip_cancel', 'shortfalls', NEW.id::text] AS s
      FROM public.refunds r
     WHERE r.order_id = NEW.order_id AND r.id <> NEW.id
       AND (r.metadata #> '{trip_cancel,shortfalls}') ? NEW.id::text
     FOR UPDATE OF r
  LOOP
    v_sf := NULLIF(v_c.s->>'shortfall_refund_id', '')::uuid;
    IF v_sf IS NULL THEN CONTINUE; END IF;
    IF NOT public.issue_4522_refund_maybe_made(v_sf)
       AND EXISTS (SELECT 1 FROM public.refunds WHERE id = v_sf AND status = 'pending') THEN
      UPDATE public.paystack_refund_attempts
         SET status = 'failed', error_message = 'shortfall_withdrawn_refund_succeeded', updated_at = now()
       WHERE local_refund_id = v_sf AND status = 'pending' AND provider_refund_id IS NULL;
      UPDATE public.refunds
         SET status = 'cancelled',
             metadata = jsonb_set(metadata, '{trip_cancel,withdrawn_at}', to_jsonb(now()))
       WHERE id = v_sf AND status = 'pending';
      UPDATE public.refunds
         SET metadata = jsonb_set(metadata, ARRAY['trip_cancel', 'shortfalls', NEW.id::text, 'withdrawn_at'], to_jsonb(now()))
       WHERE id = v_c.id;
    ELSE
      UPDATE public.refunds
         SET metadata = jsonb_set(metadata, ARRAY['trip_cancel', 'shortfalls', NEW.id::text, 'overlap_at'], to_jsonb(now()))
       WHERE id = v_c.id;
    END IF;
  END LOOP;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_cancel_inflight_recovered() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue_4522_trip_cancel_inflight_recovered
  AFTER UPDATE OF status ON public.refunds
  FOR EACH ROW WHEN (OLD.status IN ('failed', 'cancelled') AND NEW.status = 'succeeded')
  EXECUTE FUNCTION public.issue_4522_trip_cancel_inflight_recovered();

-- The instalment run's claim of what ops must be told, each returned once
-- (marked in the same statement):
--   kind 'shortfall'  an owed amount (P9-2: being sent automatically, or
--                     held when the provider shows a sign of the refund);
--   kind 'overlap'    a counted refund turned succeeded after its owed part
--                     was already sent;
--   kind 'unresolved' (P9-3) a counted refund still pending past the
--                     in-flight ceiling (24 h after the cancel): the amount
--                     at stake if it never goes through; nothing is sent.
CREATE FUNCTION public.issue_4522_claim_trip_cancel_shortfalls(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_r record;
  v_out jsonb := '[]'::jsonb;
  v_lim integer := least(greatest(COALESCE(p_limit, 20), 1), 50);
BEGIN
  FOR v_r IN
    SELECT r.id, r.order_id, s.key, s.value
      FROM public.refunds r
      CROSS JOIN LATERAL jsonb_each(r.metadata #> '{trip_cancel,shortfalls}') s
     WHERE r.metadata #> '{trip_cancel,shortfalls}' IS NOT NULL
       AND (NOT (s.value ? 'alerted_at') OR (s.value ? 'overlap_at' AND NOT (s.value ? 'overlap_alerted_at')))
     ORDER BY r.created_at, r.id
     LIMIT v_lim
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.refunds
       SET metadata = jsonb_set(metadata, ARRAY['trip_cancel', 'shortfalls', v_r.key],
             (metadata #> ARRAY['trip_cancel', 'shortfalls', v_r.key])
             || CASE WHEN v_r.value ? 'alerted_at' THEN jsonb_build_object('overlap_alerted_at', now())
                     ELSE jsonb_build_object('alerted_at', now()) END)
     WHERE id = v_r.id;
    v_out := v_out || jsonb_build_array(v_r.value || jsonb_build_object(
      'kind', CASE WHEN v_r.value ? 'alerted_at' THEN 'overlap' ELSE 'shortfall' END,
      'cancel_refund_id', v_r.id, 'order_id', v_r.order_id, 'failed_refund_id', v_r.key));
  END LOOP;
  -- Pass 9 (P9-3): counted refunds still unresolved past the ceiling.
  FOR v_r IN
    SELECT r.id, r.order_id, k.key, k.value::bigint AS amt, r.metadata->'trip_cancel' AS tc,
           o.payment_plan_terms, x.currency AS xcur
      FROM public.refunds r
      JOIN public.orders o ON o.id = r.order_id
      CROSS JOIN LATERAL jsonb_each_text(r.metadata #> '{trip_cancel,inflight_counted}') k
      JOIN public.refunds x ON x.id = k.key::uuid AND x.status = 'pending'
     WHERE r.metadata #> '{trip_cancel,inflight_counted}' IS NOT NULL
       AND r.status IN ('pending', 'succeeded')
       AND r.created_at <= now() - public.issue_4522_flex_in_flight_ceiling()
       AND NOT (COALESCE(r.metadata #> '{trip_cancel,inflight_unresolved_alerted}', '{}'::jsonb) ? k.key)
     ORDER BY r.created_at, r.id
     LIMIT v_lim
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.refunds
       SET metadata = jsonb_set(metadata, '{trip_cancel,inflight_unresolved_alerted}',
             COALESCE(metadata #> '{trip_cancel,inflight_unresolved_alerted}', '{}'::jsonb)
             || jsonb_build_object(v_r.key, now()))
     WHERE id = v_r.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'unresolved', 'cancel_refund_id', v_r.id, 'order_id', v_r.order_id,
      'failed_refund_id', v_r.key, 'pending_refund_cents', v_r.amt,
      'owed_cents', public.issue_4522_trip_cancel_owed_if_failed(v_r.tc, v_r.payment_plan_terms, v_r.amt),
      'tier_pct', COALESCE((v_r.tc->>'tier_pct')::integer, 0),
      'currency', lower(btrim(v_r.xcur))));
  END LOOP;
  RETURN v_out;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_claim_trip_cancel_shortfalls(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_claim_trip_cancel_shortfalls(integer) TO service_role;

-- Pass 9 (P9-5): a second-provider refund whose send failed BEFORE the
-- provider was asked (its own pre-send check, e.g. the refund list could not
-- be read) was never sent: the claim is handed back (not refused, not
-- "sent, no answer"), so the next run sends it once. The cancel counts the
-- attempt as a failure toward its 3-attempt ceiling.
CREATE FUNCTION public.issue_4522_unclaim_trip_paystack_send(p_refund_id uuid, p_merchant_note text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.paystack_refund_attempts
     SET error_message = 'not_sent_presend_check_failed', updated_at = now()
   WHERE local_refund_id = p_refund_id AND merchant_note = p_merchant_note
     AND status = 'pending' AND provider_refund_id IS NULL
     AND error_message = 'provider_call_started';
  RETURN FOUND;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_unclaim_trip_paystack_send(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_unclaim_trip_paystack_send(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Pass 6 (S9-1): an instalment whose charge the provider has refunded is
--    never paid out before our books show it. issue_4522_row_payout_blocked
--    (20281202064522) holds the row while a provider refund of its charge has
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

-- ---------------------------------------------------------------------------
-- 9. Seventh pass (H-2 ops tool; Seth, 2026-11-23: "yes build the ops tool").
--    A second-provider trip cancel refund that was sent and never answered is
--    never re-sent automatically, so the cancel could stay unfinished for
--    ever. Staff finish it from Admin > Refund operations, the way an
--    overpayment is resolved by hand (issue_4522_resolve_overpayment_by_ops):
--      refunded_at_provider — the provider's dashboard shows the refund:
--        staff give its reference and that one charge refund is recorded
--        through record_paystack_refund_outcome, exactly as the refund
--        webhook or the cancel's read-back records it ('processed'), so
--        issue_4522_record_confirmed_cancel_refund records the charge, the
--        payout holds and any payout debt follow as for a confirmed refund.
--        The cancel's failure count restarts and its next resume (the
--        instalment run, or the host pressing Cancel & refund again) finds
--        every refund made, commits it, settles the booking's status and
--        sends the traveler's refund email once (first_completion).
--      escalate — the provider shows no refund: the reason is recorded and
--        the item marked escalated. No money changes; nothing is re-sent.
--    Nothing here calls the provider, re-sends or writes anything off.
--    Staff only: the caller's own session (auth.uid()) must be an active
--    admin (is_admin_user(), as admin-source-refund-operations checks).
-- ---------------------------------------------------------------------------

-- A sent second-provider refund of a cancel in progress with no answer yet,
-- untouched for 15 minutes (a send in flight is never raced).
CREATE FUNCTION public.issue_4522_trip_attempt_unanswered(p_attempt public.paystack_refund_attempts)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT p_attempt.status = 'pending' AND p_attempt.provider_refund_id IS NULL
     AND p_attempt.error_message = 'provider_call_started'
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_attempt_unanswered(public.paystack_refund_attempts) FROM PUBLIC, anon, authenticated, service_role;

-- Pass 8 (P8-2): a refund of a cancel in progress that the provider refused
-- with no money moved (released for a later send), e.g. because the charge
-- holds less than asked after another refund of it whose answer was lost.
-- A retry repeats the same ask; staff finish it with what the provider shows.
CREATE FUNCTION public.issue_4522_trip_attempt_refused(p_attempt public.paystack_refund_attempts)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT p_attempt.status = 'pending' AND p_attempt.provider_refund_id IS NULL
     AND p_attempt.error_message = 'refused_before_any_refund'
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_attempt_refused(public.paystack_refund_attempts) FROM PUBLIC, anon, authenticated, service_role;

-- One cancel in progress, as the Refund operations panel shows it: the
-- order, the trip, and each charge refund with its state.
CREATE FUNCTION public.issue_4522_trip_cancel_ops_view(p_refund_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
           'refund_id', r.id, 'order_id', r.order_id, 'trip_name', e.title,
           'currency', lower(btrim(r.currency)), 'provider', 'paystack',
           'cancel_amount_cents', r.amount_cents,
           'unconfirmed_amount_cents', COALESCE(sum(pa.amount_cents)
             FILTER (WHERE public.issue_4522_trip_attempt_unanswered(pa)), 0),
           -- Pass 8 (P8-2): parts the provider refused (a retry repeats the ask).
           'refused_amount_cents', COALESCE(sum(pa.amount_cents)
             FILTER (WHERE public.issue_4522_trip_attempt_refused(pa)), 0),
           'waiting_since', min(pa.updated_at) FILTER (WHERE public.issue_4522_trip_attempt_unanswered(pa)
                                                         OR public.issue_4522_trip_attempt_refused(pa)),
           'escalated', COALESCE(bool_or((r.metadata #>> ARRAY['trip_cancel', 'ops_resolutions',
               split_part(pa.merchant_note, ':', 3), 'outcome']) = 'escalate')
             FILTER (WHERE public.issue_4522_trip_attempt_unanswered(pa)
                        OR public.issue_4522_trip_attempt_refused(pa)), false),
           'charges', jsonb_agg(jsonb_build_object(
               'attempt_id', pa.id,
               'part', split_part(pa.merchant_note, ':', 3),
               'ordinal', oi.ordinal,
               'amount_cents', pa.amount_cents,
               'currency', pa.currency,
               'state', CASE WHEN pa.status = 'processed' THEN 'recorded'
                             WHEN public.issue_4522_trip_attempt_unanswered(pa) THEN 'unanswered'
                             WHEN pa.status = 'accepted' THEN 'accepted'
                             WHEN pa.status = 'failed' THEN 'refused'
                             WHEN public.issue_4522_trip_attempt_refused(pa) THEN 'refused'
                             ELSE 'not_sent' END,
               'actionable', (public.issue_4522_trip_attempt_unanswered(pa)
                              OR public.issue_4522_trip_attempt_refused(pa))
                             AND pa.updated_at <= now() - interval '15 minutes',
               -- Pass 8 (P8-2): which staff outcomes fit this part.
               'outcomes', CASE WHEN public.issue_4522_trip_attempt_unanswered(pa)
                                THEN '["refunded_at_provider","escalate"]'::jsonb
                                WHEN public.issue_4522_trip_attempt_refused(pa)
                                THEN '["refunded_elsewhere","escalate"]'::jsonb
                                ELSE '[]'::jsonb END,
               'charge_cents', CASE WHEN split_part(pa.merchant_note, ':', 3) = 'deposit'
                                    THEN o.total_cents::bigint
                                    ELSE COALESCE(oi.buyer_total_cents, oi.amount_cents)::bigint END,
               'ops_resolution', r.metadata #> ARRAY['trip_cancel', 'ops_resolutions',
                                                     split_part(pa.merchant_note, ':', 3)],
               'waiting_since', CASE WHEN public.issue_4522_trip_attempt_unanswered(pa)
                                       OR public.issue_4522_trip_attempt_refused(pa) THEN pa.updated_at END)
             ORDER BY oi.ordinal NULLS FIRST, pa.created_at))
    FROM public.refunds r
    JOIN public.orders o ON o.id = r.order_id
    JOIN public.events e ON e.id = o.event_id
    JOIN public.paystack_refund_attempts pa
      ON pa.local_refund_id = r.id AND pa.merchant_note LIKE 'mingla_trip_refund:' || r.id::text || ':%'
    LEFT JOIN public.order_installments oi
      ON split_part(pa.merchant_note, ':', 3) <> 'deposit'
     AND oi.id::text = split_part(pa.merchant_note, ':', 3)
   WHERE r.id = p_refund_id AND r.status = 'pending' AND r.order_installment_id IS NULL
     AND r.metadata ? 'trip_cancel' AND NOT (r.metadata->'trip_cancel' ? 'completed_at')
   GROUP BY r.id, e.title
  HAVING bool_or(public.issue_4522_trip_attempt_unanswered(pa) OR public.issue_4522_trip_attempt_refused(pa))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_trip_cancel_ops_view(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The queue: every cancel in progress with a refund sent and unanswered for
-- 15 minutes or more, oldest first. Admin only.
CREATE FUNCTION public.issue_4522_list_unanswered_trip_cancel_refunds()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(v ORDER BY v->>'waiting_since', v->>'refund_id')
      FROM (SELECT public.issue_4522_trip_cancel_ops_view(x.id) AS v
              FROM (SELECT DISTINCT r.id
                      FROM public.refunds r
                      JOIN public.paystack_refund_attempts pa ON pa.local_refund_id = r.id
                     WHERE r.status = 'pending' AND r.metadata ? 'trip_cancel'
                       AND NOT (r.metadata->'trip_cancel' ? 'completed_at')
                       AND pa.merchant_note LIKE 'mingla_trip_refund:' || r.id::text || ':%'
                       AND (public.issue_4522_trip_attempt_unanswered(pa)
                            OR public.issue_4522_trip_attempt_refused(pa))
                       AND pa.updated_at <= now() - interval '15 minutes'
                     LIMIT 200) x) q
     WHERE v IS NOT NULL), '[]'::jsonb);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_list_unanswered_trip_cancel_refunds() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4522_list_unanswered_trip_cancel_refunds() TO authenticated;

CREATE FUNCTION public.issue_4522_get_unanswered_trip_cancel_refund(p_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4522_trip_cancel_ops_view(p_refund_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_get_unanswered_trip_cancel_refund(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4522_get_unanswered_trip_cancel_refund(uuid) TO authenticated;

-- The staff action. p_attempt_id: the unanswered charge refund
-- (paystack_refund_attempts.id). p_amount_cents / p_currency: what the panel
-- showed; a different one is refused (the item changed under the viewer).
-- A second identical call is a no-op that returns the same result.
CREATE FUNCTION public.issue_4522_resolve_trip_cancel_refund_by_ops(
  p_attempt_id uuid,
  p_outcome text,
  p_provider_refund_reference text,
  p_reason text,
  p_amount_cents bigint DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_refunded_elsewhere_cents bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_att public.paystack_refund_attempts;
  v_refund public.refunds;
  v_order_id uuid;
  v_part text;
  v_ref text;
  v_reason text;
  v_prior jsonb;
  v_entry jsonb;
  v_result jsonb;
  v_resize jsonb;
  v_charge bigint;
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('refunded_at_provider', 'refunded_elsewhere', 'escalate') THEN
    RAISE EXCEPTION 'trip_cancel_ops_outcome_invalid' USING ERRCODE = '22023';
  END IF;
  v_reason := btrim(COALESCE(p_reason, ''));
  IF length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = '22023';
  END IF;
  v_ref := NULLIF(btrim(COALESCE(p_provider_refund_reference, '')), '');
  IF p_outcome IN ('refunded_at_provider', 'refunded_elsewhere') AND (v_ref IS NULL OR length(v_ref) > 200) THEN
    RAISE EXCEPTION 'provider_refund_reference_required' USING ERRCODE = '22023';
  END IF;
  -- Pass 8 (P8-2): what the provider shows already refunded on this charge
  -- by other refunds (its dashboard), in minor units.
  IF p_outcome = 'refunded_elsewhere'
     AND (p_refunded_elsewhere_cents IS NULL OR p_refunded_elsewhere_cents <= 0) THEN
    RAISE EXCEPTION 'refunded_elsewhere_required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'escalate' THEN v_ref := NULL; END IF;

  SELECT * INTO v_att FROM public.paystack_refund_attempts WHERE id = p_attempt_id;
  IF NOT FOUND OR v_att.local_refund_id IS NULL
     OR v_att.merchant_note NOT LIKE 'mingla_trip_refund:' || v_att.local_refund_id::text || ':%' THEN
    RAISE EXCEPTION 'trip_cancel_refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT order_id INTO v_order_id FROM public.refunds WHERE id = v_att.local_refund_id;
  -- the instalment graph's order (event → order → rows), as every writer.
  IF v_order_id IS NULL OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RAISE EXCEPTION 'trip_cancel_refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_att FROM public.paystack_refund_attempts WHERE id = p_attempt_id FOR UPDATE;
  SELECT * INTO v_refund FROM public.refunds WHERE id = v_att.local_refund_id FOR UPDATE;
  v_part := split_part(v_att.merchant_note, ':', 3);
  v_prior := v_refund.metadata #> ARRAY['trip_cancel', 'ops_resolutions', v_part];

  -- Idempotent replay: the same answer again returns what was recorded.
  IF v_prior IS NOT NULL AND v_prior->>'outcome' = p_outcome
     AND (p_outcome = 'escalate' OR v_prior->>'reference' = v_ref)
     AND (p_outcome <> 'refunded_elsewhere'
          OR (v_prior->>'refunded_elsewhere_cents')::bigint = p_refunded_elsewhere_cents) THEN
    RETURN v_prior || jsonb_build_object('ok', true, 'idempotent_replay', true);
  END IF;
  -- Pass 9 (P9-6): once a figure is recorded for a part, a second, different
  -- figure or reference is refused (the first one stands; a replay of it is
  -- idempotent above).
  IF v_prior->>'outcome' = 'refunded_at_provider'
     OR (v_prior->>'outcome' = 'refunded_elsewhere' AND p_outcome = 'refunded_elsewhere') THEN
    RAISE EXCEPTION 'trip_cancel_refund_already_resolved' USING ERRCODE = 'PT409';
  END IF;
  IF v_att.status = 'processed' THEN
    RAISE EXCEPTION 'trip_cancel_refund_already_confirmed' USING ERRCODE = 'PT409';
  END IF;
  IF v_refund.status <> 'pending' OR v_refund.order_installment_id IS NOT NULL
     OR NOT (v_refund.metadata ? 'trip_cancel') OR v_refund.metadata->'trip_cancel' ? 'completed_at' THEN
    RAISE EXCEPTION 'trip_cancel_not_in_progress' USING ERRCODE = 'PT409';
  END IF;
  IF p_outcome = 'refunded_at_provider' AND NOT public.issue_4522_trip_attempt_unanswered(v_att) THEN
    RAISE EXCEPTION 'trip_cancel_refund_not_unanswered' USING ERRCODE = 'PT409';
  END IF;
  IF p_outcome = 'refunded_elsewhere' AND NOT public.issue_4522_trip_attempt_refused(v_att) THEN
    RAISE EXCEPTION 'trip_cancel_refund_not_refused' USING ERRCODE = 'PT409';
  END IF;
  IF p_outcome = 'escalate' AND NOT (public.issue_4522_trip_attempt_unanswered(v_att)
                                     OR public.issue_4522_trip_attempt_refused(v_att)) THEN
    RAISE EXCEPTION 'trip_cancel_refund_not_unanswered' USING ERRCODE = 'PT409';
  END IF;
  IF v_att.updated_at > now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'trip_cancel_refund_too_recent' USING ERRCODE = 'PT409';
  END IF;
  IF (p_amount_cents IS NOT NULL AND p_amount_cents <> v_att.amount_cents)
     OR (p_currency IS NOT NULL AND lower(btrim(p_currency)) <> v_att.currency)
     OR lower(btrim(v_refund.currency)) <> v_att.currency THEN
    RAISE EXCEPTION 'trip_cancel_refund_amount_or_currency_mismatch' USING ERRCODE = '22023';
  END IF;

  v_entry := jsonb_build_object('outcome', p_outcome, 'attempt_id', v_att.id, 'refund_id', v_refund.id,
    'order_id', v_refund.order_id, 'part', v_part, 'amount_cents', v_att.amount_cents,
    'currency', v_att.currency, 'reason', left(v_reason, 500), 'by', v_actor, 'at', now());

  IF p_outcome = 'refunded_at_provider' THEN
    -- Pass 8 (P8-5): a reference is the same whatever its case or spacing
    -- (v_ref is stored trimmed).
    IF EXISTS (SELECT 1 FROM public.paystack_refund_attempts
                WHERE lower(btrim(provider_refund_id)) = lower(v_ref) AND id <> v_att.id)
       OR EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts
                   WHERE lower(btrim(provider_refund_id)) = lower(v_ref))
       OR EXISTS (SELECT 1 FROM public.refunds WHERE lower(btrim(stripe_refund_id)) = lower(v_ref)) THEN
      RAISE EXCEPTION 'provider_refund_reference_already_used' USING ERRCODE = 'PT409';
    END IF;
    -- The one recording path of a confirmed second-provider refund (the
    -- refund webhook and the cancel's read-back use it too).
    PERFORM public.record_paystack_refund_outcome(v_att.source_type, v_att.source_id, v_att.local_refund_id,
      v_att.transaction_reference, v_att.merchant_note, v_ref, v_att.amount_cents, 'processed', NULL);
    -- issue_4522_record_confirmed_cancel_refund never raises; staff are
    -- told, and nothing is kept, if the charge did not record.
    IF (v_part <> 'deposit' AND NOT EXISTS (
          SELECT 1 FROM public.order_installment_refund_applications a
           WHERE a.refund_id = v_refund.id AND a.installment_id = v_part::uuid))
       OR (SELECT refunded_amount_cents FROM public.orders WHERE id = v_refund.order_id)
          IS DISTINCT FROM public.issue_4522_order_charge_refunded_cents(v_refund.order_id) THEN
      RAISE EXCEPTION 'trip_cancel_refund_not_recorded' USING ERRCODE = 'P0001';
    END IF;
    v_entry := v_entry || jsonb_build_object('reference', v_ref);
  END IF;

  IF p_outcome = 'refunded_elsewhere' THEN
    -- Pass 8 (P8-2): the cancel asks only for what the charge truly holds,
    -- by the cancel's own rule; nothing is sent from here (the next run
    -- sends the new amount once). The reference is the OTHER refund's, kept
    -- for the audit (it may already be on Mingla's own record of it).
    -- Pass 9 (GAP): the charge as made; a figure above it is refused (never
    -- trusted to raise or invent anything).
    SELECT CASE WHEN v_part = 'deposit'
                THEN COALESCE((SELECT (x->>'charge_cents')::bigint
                                 FROM jsonb_array_elements(v_refund.metadata #> '{trip_cancel,per_payment_refund}') x
                                WHERE x->>'installment_id' IS NULL LIMIT 1), o.total_cents::bigint)
                ELSE (SELECT COALESCE(oi.buyer_total_cents, oi.amount_cents)::bigint
                        FROM public.order_installments oi WHERE oi.id::text = v_part AND oi.order_id = o.id) END
      INTO v_charge
      FROM public.orders o WHERE o.id = v_refund.order_id;
    IF v_charge IS NULL OR p_refunded_elsewhere_cents > v_charge THEN
      RAISE EXCEPTION 'refunded_elsewhere_more_than_charge' USING ERRCODE = '22023';
    END IF;
    v_resize := public.issue_4522_trip_cancel_resize_charge(v_refund.id, v_part, p_refunded_elsewhere_cents);
    IF NOT COALESCE((v_resize->>'ok')::boolean, false)
       AND v_resize->>'reason' = 'trip_cancel_nothing_left' AND p_refunded_elsewhere_cents = v_charge THEN
      -- Pass 9 (GAP): Paystack shows this whole charge refunded already by
      -- another refund (e.g. its dashboard): nothing is left to send. That
      -- other refund (its reference, required) is recorded as this part,
      -- for the amount this part asked (never more), through the one
      -- recording path, so the cancel completes with nothing sent. The
      -- reference must not be on any other Mingla refund.
      IF EXISTS (SELECT 1 FROM public.paystack_refund_attempts
                  WHERE lower(btrim(provider_refund_id)) = lower(v_ref) AND id <> v_att.id)
         OR EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts
                     WHERE lower(btrim(provider_refund_id)) = lower(v_ref))
         OR EXISTS (SELECT 1 FROM public.refunds WHERE lower(btrim(stripe_refund_id)) = lower(v_ref)) THEN
        RAISE EXCEPTION 'provider_refund_reference_already_used' USING ERRCODE = 'PT409';
      END IF;
      PERFORM public.record_paystack_refund_outcome(v_att.source_type, v_att.source_id, v_att.local_refund_id,
        v_att.transaction_reference, v_att.merchant_note, v_ref, v_att.amount_cents, 'processed', NULL);
      IF (v_part <> 'deposit' AND NOT EXISTS (
            SELECT 1 FROM public.order_installment_refund_applications a
             WHERE a.refund_id = v_refund.id AND a.installment_id = v_part::uuid))
         OR (SELECT refunded_amount_cents FROM public.orders WHERE id = v_refund.order_id)
            IS DISTINCT FROM public.issue_4522_order_charge_refunded_cents(v_refund.order_id) THEN
        RAISE EXCEPTION 'trip_cancel_refund_not_recorded' USING ERRCODE = 'P0001';
      END IF;
      v_resize := jsonb_build_object('ok', true, 'changed', false, 'from_cents', v_att.amount_cents,
        'refund_cents', 0, 'recorded_whole_charge', true);
    ELSIF NOT COALESCE((v_resize->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_resize->>'reason', 'trip_cancel_resize_failed') USING ERRCODE = 'PT409';
    END IF;
    v_entry := v_entry || jsonb_build_object('reference', v_ref,
      'refunded_elsewhere_cents', p_refunded_elsewhere_cents,
      'from_cents', COALESCE((v_resize->>'from_cents')::bigint, v_att.amount_cents),
      'to_cents', (v_resize->>'refund_cents')::bigint, 'changed', (v_resize->>'changed')::boolean,
      'recorded_whole_charge', COALESCE((v_resize->>'recorded_whole_charge')::boolean, false));
  END IF;

  -- Recorded on the cancel itself. A recorded part restarts the failure
  -- count (as an overpayment retry does) so the next resume finishes it.
  UPDATE public.refunds
     SET metadata = jsonb_set(metadata, '{trip_cancel}',
           (metadata->'trip_cancel')
           || jsonb_build_object('ops_resolutions',
                COALESCE(metadata #> '{trip_cancel,ops_resolutions}', '{}'::jsonb)
                || jsonb_build_object(v_part, v_entry))
           || CASE WHEN p_outcome IN ('refunded_at_provider', 'refunded_elsewhere')
                THEN jsonb_build_object('failures', 0, 'last_attempt_at', now() - interval '2 minutes')
                ELSE '{}'::jsonb END)
   WHERE id = v_refund.id;

  INSERT INTO public.audit_log (user_id, brand_id, event_id, action, target_type, target_id, after)
  SELECT v_actor, e.brand_id, e.id,
         CASE WHEN p_outcome = 'refunded_at_provider' THEN 'trip_cancel_refund.recorded_by_ops'
              WHEN p_outcome = 'refunded_elsewhere' THEN 'trip_cancel_refund.resized_by_ops'
              ELSE 'trip_cancel_refund.escalated_by_ops' END,
         'order', o.id,
         -- Pass 8 (P8-4): the audit row itself carries why and the reference.
         jsonb_build_object('refund_id', v_refund.id, 'attempt_id', v_att.id, 'part', v_part,
           'amount_cents', v_att.amount_cents, 'currency', v_att.currency,
           'reason', left(v_reason, 500), 'provider_refund_reference', v_ref)
         || CASE WHEN p_outcome = 'refunded_elsewhere' THEN jsonb_build_object(
              'refunded_elsewhere_cents', p_refunded_elsewhere_cents,
              'from_cents', v_entry->'from_cents', 'to_cents', v_entry->'to_cents',
              'recorded_whole_charge', v_entry->'recorded_whole_charge') ELSE '{}'::jsonb END
    FROM public.orders o JOIN public.events e ON e.id = o.event_id
   WHERE o.id = v_refund.order_id;

  v_result := v_entry || jsonb_build_object('ok', true, 'idempotent_replay', false,
    'unanswered_left', (SELECT count(*) FROM public.paystack_refund_attempts pa
                         WHERE pa.local_refund_id = v_refund.id
                           AND public.issue_4522_trip_attempt_unanswered(pa)));
  RETURN v_result;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_resolve_trip_cancel_refund_by_ops(uuid, text, text, text, bigint, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4522_resolve_trip_cancel_refund_by_ops(uuid, text, text, text, bigint, text, bigint) TO authenticated;
COMMENT ON FUNCTION public.issue_4522_resolve_trip_cancel_refund_by_ops(uuid, text, text, text, bigint, text, bigint) IS
  'Issue #4522 (H-2): staff finish a second-provider trip cancel refund that was sent and never answered. refunded_at_provider records it with the provider reference through record_paystack_refund_outcome (as a confirmed refund) and restarts the cancel''s resume, which completes the cancel and sends the buyer email once; refunded_elsewhere (pass 8, P8-2: a part the provider refused because another refund of the charge was made) lowers that part to the cancel''s rule with what the provider shows and restarts the resume, which sends the remainder once; escalate records the reason only. Never calls the provider, never re-sends, never writes off. Admin session only (is_admin_user).';

COMMIT;
