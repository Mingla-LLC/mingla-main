-- issue #4522 M3b — missed-payment rollover (D-7), the host money screen and
-- Admin balance reads. Inert while issue_4522_plan_v2_enabled() is false: no
-- order carries v2 terms, so rollover answers not_rollable and every caller
-- flags the booking at risk exactly as today.
--
-- Re-emitted (md5 drift-guarded): issue_3645_count_installment_failure
-- (20280202003645) — two hunks: a failed flexible row is closed, and the third
-- failure tries issue_4522_missed_rollover before flagging at risk. The
-- Stripe paths (createInstallmentPI, the PaymentIntent webhook) call the same
-- rollover RPC before they flag.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE v_actual text;
BEGIN
  SELECT md5(pg_get_functiondef('public.issue_3645_count_installment_failure(uuid,text,timestamptz)'::regprocedure))
    INTO v_actual;
  IF v_actual IS DISTINCT FROM '87c0d737ab4edff6ccc65fd5ee88eb3b' THEN
    RAISE EXCEPTION 'issue #4522 M3b drift: count_installment_failure expected 87c0d737ab4edff6ccc65fd5ee88eb3b, got %', v_actual;
  END IF;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 1. Missed-payment rollover (D-7: after the last automatic retry). A v2
--    order with auto-adjust moves a row that exhausted its retries onto its
--    later rows instead of flagging the booking; with no later row it is
--    flagged at risk exactly as today. Caller has written the failure.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_missed_rollover(
  p_installment_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_order public.orders;
  v_row public.order_installments;
  v_result jsonb;
BEGIN
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('rolledOver', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
  SELECT * INTO v_row FROM public.order_installments WHERE id = p_installment_id FOR UPDATE;
  IF v_row.kind <> 'scheduled' OR v_row.status <> 'failed' OR v_row.retry_count < 3
     OR COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) <> 2
     OR NOT COALESCE((v_order.payment_plan_terms->>'auto_adjust')::boolean, false)
     OR v_order.cancelled_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.order_installments oi
                     WHERE oi.order_id = v_order_id AND oi.id <> v_row.id AND oi.kind = 'scheduled'
                       AND oi.status IN ('scheduled', 'failed') AND oi.due_at > v_row.due_at) THEN
    RETURN jsonb_build_object('rolledOver', false, 'reason', 'not_rollable');
  END IF;
  -- The missed amount stays inside its own package: with no later open row
  -- of the same package it cannot be placed, and the booking is flagged.
  IF NOT EXISTS (SELECT 1 FROM public.order_installments oi
                  WHERE oi.order_id = v_order_id AND oi.id <> v_row.id AND oi.kind = 'scheduled'
                    AND oi.status IN ('scheduled', 'failed') AND oi.due_at > v_row.due_at
                    AND oi.ticket_type_id IS NOT DISTINCT FROM v_row.ticket_type_id) THEN
    RETURN jsonb_build_object('rolledOver', false, 'reason', 'no_later_row_in_package');
  END IF;
  IF public.issue_4522_order_has_open_flex(v_order_id, p_now) THEN
    RETURN jsonb_build_object('rolledOver', false, 'reason', 'flex_payment_in_flight');
  END IF;
  -- A rollover that cannot be placed (a later row's charge in flight, or the
  -- split would not hold) never aborts the caller: it is undone here and the
  -- caller flags the booking at risk, so the failure count always persists.
  BEGIN
    UPDATE public.order_installments
       SET status = 'superseded', superseded_at = p_now, next_retry_at = NULL,
           in_flight_attempt_id = NULL, updated_at = p_now
     WHERE id = v_row.id;
    UPDATE public.order_installment_pay_links SET revoked_at = p_now, revoked_reason = 'installment_superseded'
     WHERE installment_id = v_row.id AND revoked_at IS NULL;
    v_result := public.issue_4522_rebalance_order(v_order_id, 'missed_rollover', v_row.id, NULL,
      '[]'::jsonb, v_row.id);
  EXCEPTION
    WHEN SQLSTATE 'PT409' THEN
      RETURN jsonb_build_object('rolledOver', false, 'reason', 'balance_payment_in_flight');
    WHEN raise_exception THEN
      IF SQLERRM <> 'installment_rounding_invalid' THEN RAISE; END IF;
      RETURN jsonb_build_object('rolledOver', false, 'reason', 'installment_rounding_invalid');
  END;
  RETURN jsonb_build_object('rolledOver', true, 'remainingMinor', v_result->'remainingMinor',
    'orderId', v_order_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_missed_rollover(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_missed_rollover(uuid, timestamptz) TO service_role;
COMMENT ON FUNCTION public.issue_4522_missed_rollover(uuid, timestamptz) IS
  'Issue #4522 (D-7): after the last retry of a v2 auto-adjust order, the missed row is superseded and its amount joins the later rows (missed_rollover). rolledOver=false means the caller flags the booking at risk as before.';

-- ---------------------------------------------------------------------------
-- 2. Host money screen (server side): every v2 balance on a trip, for brand
--    members. Admin: one order's balance, for Mingla admins. Read-only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.biz_trip_event_balances(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_brand uuid;
BEGIN
  SELECT brand_id INTO v_brand FROM public.events WHERE id = p_event_id AND event_type = 'trip';
  IF NOT FOUND OR NOT public.biz_is_brand_member_for_read_for_caller(v_brand) THEN
    RAISE EXCEPTION 'balance_not_found' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.issue_4522_balance(o.id) ORDER BY o.created_at, o.id)
      FROM public.orders o
     WHERE o.event_id = p_event_id AND o.installment_plan_root
       AND COALESCE((o.payment_plan_terms->>'v')::integer, 0) = 2), '[]'::jsonb);
END
$fn$;
REVOKE ALL ON FUNCTION public.biz_trip_event_balances(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_trip_event_balances(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_trip_event_balances(uuid) IS
  'Issue #4522: the host money screen''s v2 balances for one trip (terms, open, superseded-aware rows, flexible payments and balance history); brand members only.';

CREATE FUNCTION public.admin_trip_order_balance(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_balance jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_balance := public.issue_4522_balance(p_order_id);
  IF v_balance IS NULL THEN RAISE EXCEPTION 'balance_not_found' USING ERRCODE = 'P0001'; END IF;
  RETURN v_balance || jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('installmentId', id, 'ordinal', ordinal, 'kind', kind,
      'status', status, 'dueAt', due_at, 'amountMinor', amount_cents,
      'addonPortionMinor', addon_portion_minor, 'scheduleVersion', schedule_version,
      'supersededAt', superseded_at, 'refundedMinor', refunded_amount_cents) ORDER BY due_at, id)
      FROM public.order_installments WHERE order_id = p_order_id), '[]'::jsonb));
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_trip_order_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_trip_order_balance(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_trip_order_balance(uuid) IS
  'Issue #4522: Admin order detail for a v2 trip order (terms, every row with kind / status / version / add-on share, balance and history). is_admin_user() only; read-only.';

-- ---------------------------------------------------------------------------
-- 3. The Paystack failure counter: flexible rows close; the third failure
--    of a v2 auto-adjust order rolls over instead of flagging.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3645_count_installment_failure(p_installment_id uuid, p_failure_reason text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inst public.order_installments;
  v_retry integer;
  v_next timestamptz;
  v_at_risk boolean := false;
  v_roll jsonb;
  v_order_id uuid;
BEGIN
  -- issue #4522 — lock order event → order → the order's open rows (ORDER BY
  -- id), as every other money path does, before this row: the rollover below
  -- takes the same graph, and locking the row first could deadlock (40P01).
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'installment_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.issue_4522_lock_order_graph(v_order_id);
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'installment_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- issue #4522 — a row a rebalance or rollover already superseded owes
  -- nothing: a late failure for it (a cron or webhook replay) is a no-op.
  IF v_inst.status = 'superseded' THEN
    RETURN jsonb_build_object('outcome', 'noop', 'reason', 'superseded',
      'retry_count', v_inst.retry_count, 'next_retry_at', NULL);
  END IF;
  v_retry := v_inst.retry_count + 1;
  v_next := public.issue_3645_next_retry_at(v_inst.due_at, v_retry, p_now);

  UPDATE public.order_installments
     SET status = 'failed',
         failed_at = p_now,
         failure_reason = left(coalesce(p_failure_reason, 'unknown_failure'), 240),
         retry_count = v_retry,
         next_retry_at = v_next,
         in_flight_attempt_id = NULL
   WHERE id = p_installment_id;

  -- issue #4522 — a failed flexible payment is closed (superseded), never
  -- retried, and never flags the booking.
  IF v_inst.kind = 'flex' THEN
    UPDATE public.order_installments
       SET status = 'superseded', superseded_at = p_now, next_retry_at = NULL
     WHERE id = p_installment_id;
    RETURN jsonb_build_object('outcome', 'failed', 'retry_count', v_retry,
      'next_retry_at', NULL, 'flex_closed', true);
  END IF;

  IF v_retry >= 3 THEN
    -- issue #4522 (D-7) — a v2 auto-adjust order rolls the missed row into its
    -- later rows; with no later row the booking is flagged as before.
    v_roll := public.issue_4522_missed_rollover(p_installment_id, p_now);
    IF NOT COALESCE((v_roll->>'rolledOver')::boolean, false) THEN
      UPDATE public.orders
         SET at_risk = true, at_risk_since = p_now, updated_at = p_now
       WHERE id = v_inst.order_id AND at_risk IS NOT TRUE;
      v_at_risk := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_at_risk THEN 'at_risk' ELSE 'failed' END,
    'retry_count', v_retry,
    'next_retry_at', v_next
  ) || CASE WHEN COALESCE((v_roll->>'rolledOver')::boolean, false)
         THEN jsonb_build_object('rolled_over', true) ELSE '{}'::jsonb END;
END
$function$;
REVOKE ALL ON FUNCTION public.issue_3645_count_installment_failure(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
