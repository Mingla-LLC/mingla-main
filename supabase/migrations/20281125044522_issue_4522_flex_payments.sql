-- issue #4522 M3 — flexible ("pay any amount") payments, rebalancing,
-- claim guards and balance links. Inert while issue_4522_plan_v2_enabled() is
-- false: no v2 order can exist (M1/M2), and begin_flex refuses with
-- payment_plan_v2_unavailable. Lock order everywhere: event → order → the
-- order's open rows ORDER BY id (as issue_3645_lock_installment_graph).
--
-- Re-emitted (md5 drift-guarded), one hunk each:
--   claim_order_installment_for_charge (20270725003645) — refuses a flex row
--     and any planned row while a flex row is open (flex_payment_in_flight).
--   issue_3645_begin_installment_attempt (20280202003645) — the same guard
--     for planned Paystack rows; a flex row may start its own attempt.
--   issue_3645_checkpoint_pay_link_installment (20280202003645) — a v2 row
--     below the provider's minimum is never counted as an unpaid failure.
-- Conflicts raise PT409 (balance_payment_in_flight, balance_changed), never 40001.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.claim_order_installment_for_charge(uuid)','fc915f58ff0c2c665fd701da9f792a23'),
    ('public.issue_3645_begin_installment_attempt(uuid,text,bigint,boolean,timestamptz)','18253e8ae6725e5533c83fab15390014'),
    ('public.issue_3645_checkpoint_pay_link_installment(uuid,timestamptz)','f9ce7aeeeba4ef9fe5db6a743bf9278d')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4522 M3 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 0. The flexible payment's client key (idempotent replay of "Pay").
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_installments ADD COLUMN flex_client_key text NULL;
ALTER TABLE public.order_installments
  ADD CONSTRAINT order_installments_flex_client_key_check
    CHECK ((kind = 'flex') = (flex_client_key IS NOT NULL)
           AND (flex_client_key IS NULL OR char_length(flex_client_key) BETWEEN 8 AND 120));
CREATE UNIQUE INDEX uq_order_flex_client_key
  ON public.order_installments (order_id, flex_client_key) WHERE flex_client_key IS NOT NULL;
COMMENT ON COLUMN public.order_installments.flex_client_key IS
  'Issue #4522: the client key of a flexible payment; the same key replays the same row.';

-- ---------------------------------------------------------------------------
-- 0b. Money collected beyond what the plan still owed (two charges racing:
--     a planned row and a flexible payment both landing, or a released
--     payment confirmed late). It is never kept, paid out or dropped: it is
--     returned to the traveler automatically against the charge that carried
--     it (issue_4522_overpayment_policy decides, today always 'refund'), shown
--     on the balance (buyer, host, Admin) and audited.
--     held → refund_pending → refunded, or refund_failed (retried by the
--     scheduled sweep), or needs_ops (automatic refunding stopped: three
--     refusals in a row, below the provider's minimum partial refund, or a
--     refund the provider reversed; an ops action or a matched provider
--     refund resolves it). 'applied' is reserved for a later "apply to the
--     balance" policy and has no writer.
--     amount_minor is in plan units (what the plan did not owe);
--     refund_minor is in charge units (what goes back to the traveler: the
--     buyer total's share on a Paystack row, the same number on Stripe).
--     Each provider refund is one row of order_overpayment_refund_attempts;
--     what is returned is the sum of its succeeded attempts (T3-1).
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_overpayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  installment_id uuid NOT NULL REFERENCES public.order_installments(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('flex_exceeds_balance', 'superseded_row_collected',
                                         'late_amount_mismatch', 'collected_above_row')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  refund_minor bigint NOT NULL CHECK (refund_minor > 0),
  currency character(3) NOT NULL,
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  provider_ref text NULL,
  state text NOT NULL DEFAULT 'held'
    CHECK (state IN ('held', 'refund_pending', 'refunded', 'refund_failed', 'needs_ops', 'applied')),
  refund_attempt_no integer NOT NULL DEFAULT 0 CHECK (refund_attempt_no >= 0),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  needs_ops_reason text NULL,
  refund_id uuid NULL REFERENCES public.refunds(id),
  provider_refund_id text NULL,
  last_error text NULL,
  next_attempt_at timestamptz NULL,
  ops_alerted_at timestamptz NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  resolved_by uuid NULL,
  CONSTRAINT order_overpayments_resolved_consistent
    CHECK ((state IN ('refunded', 'applied')) = (resolved_at IS NOT NULL)),
  CONSTRAINT order_overpayments_pending_has_refund
    CHECK (state <> 'refund_pending' OR refund_id IS NOT NULL),
  CONSTRAINT order_overpayments_one_per_cause UNIQUE (installment_id, reason)
);
CREATE INDEX order_overpayments_open_by_order ON public.order_overpayments (order_id)
  WHERE state IN ('held', 'refund_pending', 'refund_failed', 'needs_ops');
CREATE INDEX order_overpayments_open_by_installment ON public.order_overpayments (installment_id)
  WHERE state IN ('held', 'refund_pending', 'refund_failed', 'needs_ops');
CREATE INDEX order_overpayments_open_by_provider_ref ON public.order_overpayments (provider_ref)
  WHERE state IN ('held', 'refund_pending', 'refund_failed', 'needs_ops');
-- N9: no client role and no direct table access at all; every reader and
-- writer is a SECURITY DEFINER function below (the edge calls those).
ALTER TABLE public.order_overpayments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_overpayments FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.order_overpayments IS
  'Issue #4522: money a v2 trip order collected beyond what it owed. Returned to the traveler automatically (issue_4522_overpayment_policy), shown on the balance for the buyer, host and Admin, excluded from payouts and from policy refunds; never kept or dropped silently.';

-- Paid-in-full email: one claim per order, so a late, retried or swept
-- settlement that completes the balance sends it once and never twice.
CREATE TABLE public.order_paid_in_full_notices (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL
);
ALTER TABLE public.order_paid_in_full_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_paid_in_full_notices FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.order_paid_in_full_notices IS
  'Issue #4522 (N7): the one paid-in-full email claim per order (issue_4522_claim_paid_in_full_notice).';

-- The reclaim window: a flexible payment younger than this is never even
-- checked (the buyer may still be on the payment sheet). The same 15
-- minutes the instalment reconcile waits before it treats a created attempt
-- as stale (process-scheduled-installments FIFTEEN_MINUTES_MS). One owner;
-- the edge mirror is FLEX_RECLAIM_WINDOW_MS in _shared/installments/flexReclaim.ts.
CREATE FUNCTION public.issue_4522_flex_reclaim_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$ SELECT interval '15 minutes' $fn$;
REVOKE ALL ON FUNCTION public.issue_4522_flex_reclaim_window() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_flex_reclaim_window() TO service_role;

-- N3: the hard ceiling. A flexible payment the provider still reports as
-- processing is kept in flight up to this long after it opened; past it, it
-- is flagged for ops once (issue_4522_flag_stuck_flex) and keeps blocking:
-- it is never released on time alone. Edge mirror: FLEX_IN_FLIGHT_CEILING_MS.
CREATE FUNCTION public.issue_4522_flex_in_flight_ceiling()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$ SELECT interval '24 hours' $fn$;
REVOKE ALL ON FUNCTION public.issue_4522_flex_in_flight_ceiling() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_flex_in_flight_ceiling() TO service_role;

-- When a stuck flexible payment was flagged for ops (once per row).
ALTER TABLE public.order_installments ADD COLUMN flex_flagged_at timestamptz NULL;
COMMENT ON COLUMN public.order_installments.flex_flagged_at IS
  'Issue #4522 (N3): when a flexible payment still in flight past issue_4522_flex_in_flight_ceiling() was flagged for ops.';

-- ---------------------------------------------------------------------------
-- 1. Lock graph and small internal readers.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_lock_order_graph(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_id uuid;
  v_status text;
BEGIN
  SELECT event_id INTO v_event_id FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- event → order → open rows (ORDER BY id), as issue_3645_lock_installment_graph.
  SELECT status INTO v_status FROM public.events WHERE id = v_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  PERFORM 1 FROM public.order_installments
    WHERE order_id = p_order_id AND status IN ('scheduled', 'failed')
    ORDER BY id FOR UPDATE;
  RETURN v_status;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_lock_order_graph(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- N3: an open flexible payment blocks the cron, rollover and a new payment
-- until the edge has asked the provider what happened to it and either
-- settled it (the success path) or released it with the provider's answer
-- (issue_4522_release_flex_verified). Time alone never releases it.
-- p_now is kept for the callers' signature; it no longer decides anything.
CREATE FUNCTION public.issue_4522_order_has_open_flex(p_order_id uuid, p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.order_installments
                  WHERE order_id = p_order_id AND kind = 'flex' AND status IN ('scheduled', 'failed'))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_order_has_open_flex(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- A planned row is in flight while a provider charge of its CURRENT attempt
-- can still land: a Paystack attempt that is created / unknown; a Stripe
-- PaymentIntent createInstallmentPI wrote on a scheduled row (any failure
-- moves the row to failed, so the id on a scheduled row is the current
-- attempt's); or a failed Stripe row whose retry is due (the cron is charging
-- it, and a retry's PaymentIntent id cannot be written on a failed row). A
-- failed row that still carries an earlier attempt's PaymentIntent and waits
-- for a later retry is not in flight.
CREATE FUNCTION public.issue_4522_stripe_charge_in_flight(
  p_provider text, p_status text, p_payment_intent_id text, p_next_retry_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT p_provider = 'stripe'
     AND ((p_status = 'scheduled' AND p_payment_intent_id IS NOT NULL)
          OR (p_status = 'failed' AND p_next_retry_at IS NOT NULL AND p_next_retry_at <= now()))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_stripe_charge_in_flight(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_4522_order_has_open_attempt(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.order_installments oi
     WHERE oi.order_id = p_order_id AND oi.kind = 'scheduled'
       AND oi.status IN ('scheduled', 'failed')
       AND (oi.in_flight_attempt_id IS NOT NULL
            OR public.issue_4522_stripe_charge_in_flight(oi.provider, oi.status, oi.stripe_payment_intent_id, oi.next_retry_at)
            OR EXISTS (SELECT 1 FROM public.order_installment_charge_attempts a
                        WHERE a.installment_id = oi.id AND a.state IN ('created', 'unknown'))))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_order_has_open_attempt(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- N3: the open flexible payments the edge must check with the provider
-- (past the reclaim window, no Paystack attempt in flight: those belong to
-- the attempt reconcile). Read only; one order (begin) or every order (the
-- sweep). Nothing is released here.
CREATE FUNCTION public.issue_4522_flex_payments_to_verify(
  p_order_id uuid,
  p_now timestamptz DEFAULT now(),
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'installmentId', oi.id, 'orderId', oi.order_id, 'provider', oi.provider,
           'status', oi.status,
           'stripePaymentIntentId', oi.stripe_payment_intent_id,
           'attemptReference', la.reference, 'attemptState', la.state,
           'attemptCreatedAt', la.created_at,
           'attemptCount', COALESCE(ac.n, 0),
           'openedAt', oi.due_at,
           'pastCeiling', oi.due_at <= p_now - public.issue_4522_flex_in_flight_ceiling(),
           'flaggedAt', oi.flex_flagged_at)
         ORDER BY oi.due_at, oi.id), '[]'::jsonb)
    FROM (SELECT * FROM public.order_installments
           WHERE kind = 'flex' AND status IN ('scheduled', 'failed') AND in_flight_attempt_id IS NULL
             AND (p_order_id IS NULL OR order_id = p_order_id)
             AND due_at <= p_now - public.issue_4522_flex_reclaim_window()
           ORDER BY due_at, id
           LIMIT greatest(COALESCE(p_limit, 100), 1)) oi
    LEFT JOIN LATERAL (SELECT a.reference, a.state, a.created_at FROM public.order_installment_charge_attempts a
                        WHERE a.installment_id = oi.id ORDER BY a.attempt_no DESC LIMIT 1) la ON true
    LEFT JOIN LATERAL (SELECT count(*) AS n FROM public.order_installment_charge_attempts a
                        WHERE a.installment_id = oi.id) ac ON true
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_flex_payments_to_verify(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_flex_payments_to_verify(uuid, timestamptz, integer) TO service_role;

-- N3: release ONE open flexible payment, only on the provider's answer.
--   provider_canceled  — Stripe: the PaymentIntent is canceled (the edge
--                        cancelled it and read back status canceled, or it
--                        already was); p_provider_ref must be the row's own id.
--   provider_failed    — Paystack: the latest attempt's transaction verified
--                        failed or reversed; p_provider_ref is its reference,
--                        and no attempt of the row is still created/unknown.
--   provider_abandoned — Paystack: the latest attempt verified "abandoned"
--                        (an unfinished checkout the buyer's open tab can
--                        still complete, so not final on its own: T3-5) and
--                        it is older than issue_4522_flex_in_flight_ceiling()
--                        (the 24 hours the codebase treats an abandoned
--                        checkout as payable, ABANDONED_FINAL_MS).
--   no_provider_charge — nothing was ever presented to pay: a Stripe row with
--                        no PaymentIntent id (the edge stores the id before it
--                        hands the payment sheet out), or a Paystack row with
--                        no attempt at all.
-- Anything else (succeeded, processing, unknown) is not a release: the
-- success path settles it, or it stays in flight. Service role only.
CREATE FUNCTION public.issue_4522_release_flex_verified(
  p_installment_id uuid,
  p_verified text,
  p_provider_ref text,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_row public.order_installments;
  v_latest public.order_installment_charge_attempts;
BEGIN
  IF p_verified IS NULL OR p_verified NOT IN ('provider_canceled', 'provider_failed', 'provider_abandoned', 'no_provider_charge') THEN
    RAISE EXCEPTION 'flex_release_reason_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_row FROM public.order_installments WHERE id = p_installment_id FOR UPDATE;
  IF v_row.kind <> 'flex' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_flex');
  END IF;
  IF v_row.status NOT IN ('scheduled', 'failed') THEN
    -- Already settled, closed or released: nothing to do.
    RETURN jsonb_build_object('ok', true, 'released', false, 'status', v_row.status);
  END IF;
  IF v_row.in_flight_attempt_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_in_flight');
  END IF;
  IF v_row.due_at > p_now - public.issue_4522_flex_reclaim_window() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_recent');
  END IF;
  IF p_verified = 'provider_canceled' THEN
    IF v_row.provider <> 'stripe' OR v_row.stripe_payment_intent_id IS NULL
       OR v_row.stripe_payment_intent_id IS DISTINCT FROM p_provider_ref THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'provider_ref_mismatch');
    END IF;
  ELSIF p_verified IN ('provider_failed', 'provider_abandoned') THEN
    SELECT * INTO v_latest FROM public.order_installment_charge_attempts
     WHERE installment_id = p_installment_id ORDER BY attempt_no DESC LIMIT 1;
    IF v_row.provider <> 'paystack' OR v_latest.id IS NULL
       OR v_latest.reference IS DISTINCT FROM p_provider_ref
       OR EXISTS (SELECT 1 FROM public.order_installment_charge_attempts a
                   WHERE a.installment_id = p_installment_id AND a.state IN ('created', 'unknown', 'succeeded')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'provider_ref_mismatch');
    END IF;
    IF p_verified = 'provider_abandoned'
       AND v_latest.created_at > p_now - public.issue_4522_flex_in_flight_ceiling() THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'abandoned_not_final');
    END IF;
  ELSE
    IF (v_row.provider = 'stripe' AND v_row.stripe_payment_intent_id IS NOT NULL)
       OR (v_row.provider = 'paystack' AND EXISTS (SELECT 1 FROM public.order_installment_charge_attempts a
                                                    WHERE a.installment_id = p_installment_id)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'provider_charge_exists');
    END IF;
  END IF;
  UPDATE public.order_installments
     SET status = 'superseded', superseded_at = p_now, next_retry_at = NULL,
         failure_reason = COALESCE(failure_reason, 'flex_released:' || p_verified), updated_at = p_now
   WHERE id = p_installment_id;
  PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_flex_released',
    jsonb_build_object('order_id', v_order_id, 'verified', p_verified, 'provider_ref', p_provider_ref));
  RETURN jsonb_build_object('ok', true, 'released', true, 'orderId', v_order_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_release_flex_verified(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_release_flex_verified(uuid, text, text, timestamptz) TO service_role;

-- N3: a flexible payment still in flight past the ceiling is flagged for ops
-- once (true the first time; the edge then sends the ops alert). It keeps
-- blocking the order until the provider answers.
CREATE FUNCTION public.issue_4522_flag_stuck_flex(
  p_installment_id uuid,
  p_provider_status text,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.order_installments
     SET flex_flagged_at = p_now, updated_at = p_now
   WHERE id = p_installment_id AND kind = 'flex' AND status IN ('scheduled', 'failed')
     AND flex_flagged_at IS NULL
     AND due_at <= p_now - public.issue_4522_flex_in_flight_ceiling();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_flex_stuck',
      jsonb_build_object('provider_status', left(COALESCE(p_provider_status, 'unknown'), 80)));
  END IF;
  RETURN v_n = 1;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_flag_stuck_flex(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_flag_stuck_flex(uuid, text, timestamptz) TO service_role;

-- What stops the cron charging an order more: a collected flexible payment
-- whose settlement has not run yet (the collected total can meet or pass
-- what the order owes while planned rows still look open). Held overpayment
-- never stalls the plan (N4): it is returned to the traveler on its own.
-- NULL means chargeable.
CREATE FUNCTION public.issue_4522_collection_guard(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.order_installments oi
                  WHERE oi.order_id = p_order_id AND oi.kind = 'flex' AND oi.status = 'collected'
                    AND NOT EXISTS (SELECT 1 FROM public.order_balance_events e
                                     WHERE e.trigger_installment_id = oi.id AND e.reason = 'flex_payment'))
      THEN 'flex_settlement_pending'
  END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_collection_guard(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1b. Overpayments: never paid out, always returned, never twice.
-- ---------------------------------------------------------------------------
-- THE policy for money collected beyond what an order owes. One owner, so a
-- later "apply it to the remaining balance" option changes only this
-- function (and adds its writer), never the callers. Today: refund.
CREATE FUNCTION public.issue_4522_overpayment_policy(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$ SELECT 'refund'::text $fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_policy(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- A collected row is kept out of payouts while part of it is overpayment not
-- yet returned, or while it is a flexible payment not yet settled (the split
-- between what it paid and what it overpaid is not known yet).
-- Rework 9 (T8-1): also while a second-provider overpayment whose unanswered
-- refund ops closed with 'retry' is still watched (detail.retry_watch_from,
-- until the lane closes the watch after issue_4522_overpayment_pending_ceiling()):
-- the original refund may yet complete at the provider with its webhook lost.
CREATE FUNCTION public.issue_4522_row_payout_blocked(p_installment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.order_overpayments op
                  WHERE op.installment_id = p_installment_id
                    AND (op.state IN ('held', 'refund_pending', 'refund_failed', 'needs_ops')
                         OR (op.state = 'refunded' AND op.detail ? 'retry_watch_from'
                             AND NOT (op.detail ? 'retry_watch_closed_at'))))
      OR EXISTS (SELECT 1 FROM public.order_installments oi
                  WHERE oi.id = p_installment_id AND oi.kind = 'flex' AND oi.status = 'collected'
                    AND NOT EXISTS (SELECT 1 FROM public.order_balance_events e
                                     WHERE e.trigger_installment_id = oi.id AND e.reason = 'flex_payment'))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_row_payout_blocked(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Keep the payout state in step with the block above. The payout candidates
-- (run_payout_release_dark_sweep and issue_3645_unattached_payout_sources)
-- read only payout_accounting_state = 'ready': a blocked 'ready' row goes
-- back to 'pending'; an unblocked 'pending' row whose provider sale is
-- recorded (record_order_installment_provider_sale sets the fee) goes to
-- 'ready'. 'attached' and 'manual_review' are never touched.
CREATE FUNCTION public.issue_4522_sync_row_payout_hold(p_installment_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_blocked boolean := public.issue_4522_row_payout_blocked(p_installment_id);
  v_state text;
BEGIN
  UPDATE public.order_installments
     SET payout_accounting_state = CASE WHEN v_blocked THEN 'pending' ELSE 'ready' END,
         updated_at = now()
   WHERE id = p_installment_id
     AND ((v_blocked AND payout_accounting_state = 'ready')
          OR (NOT v_blocked AND payout_accounting_state = 'pending' AND status = 'collected'
              AND application_fee_amount_cents IS NOT NULL));
  SELECT payout_accounting_state INTO v_state FROM public.order_installments WHERE id = p_installment_id;
  IF v_blocked AND v_state = 'attached' THEN
    -- Attached to a payout before the overpayment was known: still returned
    -- to the traveler; ops is told (the edge alerts on this audit).
    PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_overpayment_after_payout_attached',
      jsonb_build_object('installment_id', p_installment_id));
  END IF;
  RETURN v_state;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_sync_row_payout_hold(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Hold money collected beyond what is owed (idempotent per cause), keep it
-- out of payouts, and queue it for return to the traveler.
--   p_amount_minor — plan units the order did not owe;
--   p_refund_minor — charge units to return (NULL: derived from the row:
--                    the same number on Stripe, the buyer total's share on a
--                    Paystack row, rounded so the traveler never gets less).
CREATE FUNCTION public.issue_4522_hold_overpayment(
  p_installment_id uuid,
  p_reason text,
  p_amount_minor bigint,
  p_provider_ref text,
  p_detail jsonb DEFAULT '{}'::jsonb,
  p_refund_minor bigint DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.order_installments;
  v_id uuid;
  v_refund bigint;
  v_charged bigint;
BEGIN
  SELECT * INTO v_row FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RETURN NULL;
  END IF;
  v_charged := COALESCE(v_row.buyer_total_cents, v_row.amount_cents);
  v_refund := COALESCE(p_refund_minor,
    CASE WHEN v_row.buyer_total_cents IS NULL OR v_row.amount_cents <= 0 THEN p_amount_minor
         WHEN p_amount_minor >= v_row.amount_cents THEN v_charged
         -- ceil(amount × buyer_total / amount_cents): integer arithmetic only.
         ELSE (p_amount_minor * v_row.buyer_total_cents + v_row.amount_cents - 1) / v_row.amount_cents END);
  IF v_refund <= 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.order_overpayments (order_id, installment_id, reason, amount_minor, refund_minor,
    currency, provider, provider_ref, detail)
  VALUES (v_row.order_id, v_row.id, p_reason, p_amount_minor, v_refund, v_row.currency, v_row.provider,
    p_provider_ref, COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object('policy', public.issue_4522_overpayment_policy(v_row.order_id)))
  ON CONFLICT (installment_id, reason) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_overpayment_held',
      jsonb_build_object('overpayment_id', v_id, 'reason', p_reason, 'amount_minor', p_amount_minor,
        'refund_minor', v_refund, 'order_id', v_row.order_id, 'provider_ref', p_provider_ref));
    PERFORM public.issue_4522_sync_row_payout_hold(p_installment_id);
  END IF;
  RETURN v_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_hold_overpayment(uuid, text, bigint, text, jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- A planned row's charge that landed for more than the row now owes (the
-- row was re-spread by a flexible payment between the cron's claim and the
-- PaymentIntent id being saved): the row is collected for its own amount and
-- the excess is returned. Service role (the Stripe webhook).
CREATE FUNCTION public.issue_4522_hold_collected_excess(
  p_installment_id uuid,
  p_received_minor bigint,
  p_provider_ref text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.order_installments;
  v_excess bigint;
  v_id uuid;
BEGIN
  SELECT * INTO v_row FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  v_excess := COALESCE(p_received_minor, 0) - COALESCE(v_row.buyer_total_cents, v_row.amount_cents);
  IF v_row.kind <> 'scheduled' OR v_row.status NOT IN ('collected', 'refunded') OR v_excess <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'heldMinor', 0);
  END IF;
  v_id := public.issue_4522_hold_overpayment(p_installment_id, 'collected_above_row', v_excess, p_provider_ref,
    jsonb_build_object('received_minor', p_received_minor, 'row_amount_minor', v_row.amount_cents,
      'schedule_version', v_row.schedule_version), v_excess);
  RETURN jsonb_build_object('ok', true, 'heldMinor', v_excess, 'overpaymentId', v_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_hold_collected_excess(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_hold_collected_excess(uuid, bigint, text) TO service_role;

-- T3-3 / T3-9 (I-4522-COLLECTED-IS-WHAT-WAS-CHARGED): the safety net for a
-- planned Stripe row's charge that landed for LESS than the row owes. It
-- should never fire: a charge is confirmed only after
-- issue_4522_mark_stripe_charge_in_flight fixed its amount under the order
-- lock, and no re-spread changes a row in flight. If it ever does, the row is
-- recorded for exactly what the provider collected; the rest is re-opened as
-- its own planned row of the same package, due when the row was due, so the
-- cron charges it like any due row (or, too small to charge alone, joins the
-- next open row). Nothing is ever written off. alertOps tells the webhook to
-- alert ops once. Paid, paid-in-full, payouts and cancel refunds count only
-- money actually collected. The add-on portion, planned fee and referral
-- share split in proportion (the re-opened row takes the rounded-down part).
-- Idempotent: once recorded, the row's amount is what was received.
CREATE FUNCTION public.issue_4522_record_short_collection(
  p_installment_id uuid,
  p_received_minor bigint,
  p_provider_ref text,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_row public.order_installments;
  v_short bigint;
  v_addon bigint;
  v_ref bigint;
  v_fee bigint;
  v_new uuid;
  v_folded boolean := false;
BEGIN
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_row FROM public.order_installments WHERE id = p_installment_id FOR UPDATE;
  IF v_row.kind <> 'scheduled' OR v_row.provider <> 'stripe' OR v_row.status <> 'collected'
     OR v_row.buyer_total_cents IS NOT NULL OR p_received_minor IS NULL OR p_received_minor <= 0
     OR v_row.refunded_amount_cents <> 0 THEN
    RETURN jsonb_build_object('ok', true, 'shortMinor', 0, 'reason', 'not_applicable');
  END IF;
  v_short := v_row.amount_cents - p_received_minor;
  IF v_short <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'shortMinor', 0);
  END IF;
  v_addon := least(floor(v_row.addon_portion_minor::numeric * v_short / v_row.amount_cents)::bigint, v_row.addon_portion_minor);
  v_ref := least(floor(v_row.referral_share_minor::numeric * v_short / v_row.amount_cents)::bigint, v_row.referral_share_minor);
  v_fee := CASE WHEN v_row.planned_application_fee_cents IS NULL THEN NULL
    ELSE least(floor(v_row.planned_application_fee_cents::numeric * v_short / v_row.amount_cents)::bigint,
               v_row.planned_application_fee_cents) END;
  UPDATE public.order_installments
     SET amount_cents = p_received_minor,
         addon_portion_minor = addon_portion_minor - v_addon,
         referral_share_minor = referral_share_minor - v_ref,
         planned_application_fee_cents = planned_application_fee_cents - v_fee,
         updated_at = p_now
   WHERE id = v_row.id;
  -- T4-3: a short the provider could not charge on its own joins the next
  -- open row (same package first) instead of becoming a row of its own.
  IF v_short < COALESCE(public.issue_3355_provider_minimum_charge_minor(v_row.currency), 0) THEN
    SELECT id INTO v_new FROM public.order_installments
     WHERE order_id = v_row.order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
       AND NOT public.issue_4522_row_in_flight(id)
     ORDER BY (ticket_type_id IS NOT DISTINCT FROM v_row.ticket_type_id) DESC, due_at, id LIMIT 1;
    IF v_new IS NOT NULL THEN
      UPDATE public.order_installments
         SET amount_cents = amount_cents + v_short, addon_portion_minor = addon_portion_minor + v_addon,
             referral_share_minor = referral_share_minor + v_ref,
             planned_application_fee_cents = planned_application_fee_cents + v_fee,
             schedule_version = schedule_version + 1, pre_charge_notice_sent_at = NULL, updated_at = p_now
       WHERE id = v_new;
      v_folded := true;
    END IF;
  END IF;
  IF NOT v_folded THEN
    -- orch-strict-grep-allow tr3-schedule-currency-pinned — the re-opened row is the rest of one row and takes that row's currency, which checkout pinned from the session.
    INSERT INTO public.order_installments (order_id, ordinal, amount_cents, currency, due_at, status, provider,
      collection_method, ticket_type_id, kind, addon_portion_minor, referral_share_minor,
      planned_application_fee_cents, plan_bound_at)
    VALUES (v_row.order_id,
      (SELECT max(ordinal) + 1 FROM public.order_installments WHERE order_id = v_row.order_id),
      v_short, v_row.currency, v_row.due_at, 'scheduled', v_row.provider, v_row.collection_method,
      v_row.ticket_type_id, 'scheduled', v_addon, v_ref, v_fee, v_row.plan_bound_at)
    RETURNING id INTO v_new;
  END IF;
  PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_short_collection',
    jsonb_build_object('order_id', v_row.order_id, 'row_amount_minor', v_row.amount_cents,
      'received_minor', p_received_minor, 'reopened_minor', v_short, 'reopened_installment_id', v_new,
      'folded', v_folded, 'provider_ref', p_provider_ref));
  RETURN jsonb_build_object('ok', true, 'shortMinor', v_short, 'reopenedInstallmentId', v_new,
    'folded', v_folded, 'orderId', v_row.order_id, 'currency', trim(v_row.currency),
    'rowAmountMinor', v_row.amount_cents, 'receivedMinor', p_received_minor, 'alertOps', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_record_short_collection(uuid, bigint, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_record_short_collection(uuid, bigint, text, timestamptz) TO service_role;

-- T3-1 / T3-2 (third rework) — one row per provider refund of an
-- overpayment. What an overpayment has returned is the sum of its succeeded
-- attempts; nothing is ever re-created while an earlier attempt can still
-- complete at the provider.
--   state     creating  — reserved before the provider call; its answer was
--                          not received yet (a timeout, or the write after
--                          the call was lost). Checked with the provider by
--                          its own key, never replaced by a new refund.
--             pending   — the provider accepted it (its refund id is stored)
--                          and has not finished. Checked by that id.
--             succeeded / failed — the provider's final answer.
--   origin    mingla         — the lane created it;
--             provider_match — a refund made at the provider itself (its
--                              dashboard) on the charge that carried the
--                              overpayment, matched to it by the webhook;
--             ops            — ops recorded a return made by hand.
-- Hard guard (I-4522-OVERPAY-REFUND-ONCE): creating + pending + succeeded
-- attempts of one overpayment never add up to more than its refund_minor
-- (issue_4522_overpayment_attempts_guard), so no logic slip can refund it
-- twice. Each attempt fits refunds.amount_cents (32-bit): a larger
-- overpayment is returned in several parts (T3-6).
CREATE TABLE public.order_overpayment_refund_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overpayment_id uuid NOT NULL REFERENCES public.order_overpayments(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  origin text NOT NULL CHECK (origin IN ('mingla', 'provider_match', 'ops')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 2147483647),
  state text NOT NULL CHECK (state IN ('creating', 'pending', 'succeeded', 'failed')),
  refund_id uuid NULL REFERENCES public.refunds(id),
  provider_refund_id text NULL,
  idempotency_key text NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  CONSTRAINT order_overpayment_refund_attempts_no UNIQUE (overpayment_id, attempt_no),
  CONSTRAINT order_overpayment_refund_attempts_final_resolved
    CHECK ((state IN ('succeeded', 'failed')) = (resolved_at IS NOT NULL)),
  CONSTRAINT order_overpayment_refund_attempts_pending_has_id
    CHECK (state <> 'pending' OR provider_refund_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_overpayment_attempt_provider_refund
  ON public.order_overpayment_refund_attempts (overpayment_id, provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;
CREATE INDEX order_overpayment_refund_attempts_by_provider_refund
  ON public.order_overpayment_refund_attempts (provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;
ALTER TABLE public.order_overpayment_refund_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_overpayment_refund_attempts FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.order_overpayment_refund_attempts IS
  'Issue #4522 (T3-1): each provider refund of an overpayment, with the provider''s refund id. Creating + pending + succeeded never exceed the overpayment (trigger issue_4522_overpayment_attempts_guard). Closed to every client role.';

CREATE FUNCTION public.issue_4522_overpayment_attempts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cap bigint;
  v_other bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.overpayment_id <> OLD.overpayment_id OR NEW.attempt_no <> OLD.attempt_no
     OR NEW.origin <> OLD.origin OR NEW.amount_minor <> OLD.amount_minor) THEN
    RAISE EXCEPTION 'overpayment_attempt_immutable' USING ERRCODE = '23514';
  END IF;
  -- Serialises every writer of one overpayment's attempts.
  SELECT refund_minor INTO v_cap FROM public.order_overpayments WHERE id = NEW.overpayment_id FOR UPDATE;
  IF NEW.state IN ('creating', 'pending', 'succeeded') THEN
    SELECT COALESCE(sum(amount_minor), 0) INTO v_other FROM public.order_overpayment_refund_attempts
     WHERE overpayment_id = NEW.overpayment_id AND id <> NEW.id
       AND state IN ('creating', 'pending', 'succeeded');
    IF v_other + NEW.amount_minor > v_cap THEN
      RAISE EXCEPTION 'overpayment_refund_exceeds_amount' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_attempts_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER issue_4522_overpayment_attempts_guard
BEFORE INSERT OR UPDATE ON public.order_overpayment_refund_attempts
FOR EACH ROW EXECUTE FUNCTION public.issue_4522_overpayment_attempts_guard();

-- The lane's named limits (edge mirrors in _shared/installments/overpaymentRefunds.ts).
-- T3-7: the smallest partial refund each provider accepts, in charge units.
--   Paystack: PAYSTACK_MIN_REFUND_SUBUNITS (_shared/paystackRefunds.ts), 5,000 kobo = NGN 50.
--   Stripe: no minimum for a partial refund.
CREATE FUNCTION public.issue_4522_overpayment_min_refund_minor(p_provider text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$ SELECT CASE WHEN p_provider = 'paystack' THEN 5000 ELSE 1 END::bigint $fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_min_refund_minor(text) FROM PUBLIC, anon, authenticated, service_role;
-- T3-6: the largest single refund part (refunds.amount_cents is a 32-bit integer).
CREATE FUNCTION public.issue_4522_overpayment_max_refund_part()
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$ SELECT 2147483647::bigint $fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_max_refund_part() FROM PUBLIC, anon, authenticated, service_role;
-- T3-1: a refund still pending at the provider this long after it was
-- created is reported to ops once; it keeps being checked and is never
-- replaced by a new refund.
CREATE FUNCTION public.issue_4522_overpayment_pending_ceiling()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$ SELECT interval '7 days' $fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_pending_ceiling() FROM PUBLIC, anon, authenticated, service_role;
-- T3-1: Stripe keeps an idempotency key for about 24 hours. An attempt whose
-- answer was never received is re-sent with its own key only inside this
-- window; after it, the provider's refund list is read instead.
CREATE FUNCTION public.issue_4522_overpayment_key_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$ SELECT interval '23 hours' $fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_key_window() FROM PUBLIC, anon, authenticated, service_role;
-- T3-2: refusals in a row after which automatic refunding stops (needs_ops).
CREATE FUNCTION public.issue_4522_overpayment_failure_limit()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$ SELECT 3 $fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_failure_limit() FROM PUBLIC, anon, authenticated, service_role;

-- What an overpayment has returned (succeeded attempts) and has committed
-- (creating + pending + succeeded), in charge units.
CREATE FUNCTION public.issue_4522_overpayment_returned_minor(p_overpayment_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(sum(amount_minor), 0)::bigint FROM public.order_overpayment_refund_attempts
   WHERE overpayment_id = p_overpayment_id AND state = 'succeeded'
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_returned_minor(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.issue_4522_overpayment_committed_minor(p_overpayment_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(sum(amount_minor), 0)::bigint FROM public.order_overpayment_refund_attempts
   WHERE overpayment_id = p_overpayment_id AND state IN ('creating', 'pending', 'succeeded')
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_committed_minor(uuid) FROM PUBLIC, anon, authenticated, service_role;
-- T6-2: what actually went back to the traveler on the charge for an
-- overpayment: its succeeded attempts plus each succeeded refund past the
-- amount recorded in detail.over_refunded (a failed one moved no money; one
-- an attempt also names is counted once). A new refund never exceeds
-- refund_minor minus this.
CREATE FUNCTION public.issue_4522_overpayment_back_minor(p_overpayment_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.issue_4522_overpayment_returned_minor(o.id) + COALESCE((
           SELECT sum((e->>'amount_minor')::bigint)
             FROM jsonb_array_elements(COALESCE(o.detail->'over_refunded', '[]'::jsonb)) e
            WHERE COALESCE(e->>'status', 'succeeded') = 'succeeded'
              -- T7-1: once it is one of the attempts, that attempt alone counts it.
              AND NOT (e ? 'adopted_attempt_no')
              AND NOT EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts a
                               WHERE a.overpayment_id = o.id AND a.state = 'succeeded'
                                 AND a.provider_refund_id = e->>'provider_refund_id')), 0)::bigint
    FROM public.order_overpayments o WHERE o.id = p_overpayment_id
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_back_minor(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The overpayments that need the edge's attention now: new ones, failed
-- ones whose retry is due, and ones with a refund at the provider whose
-- answer is older than a few minutes (checked by its refund id). needs_ops
-- is never listed (only an ops action or a matched provider refund moves
-- it), except T6-1: one stopped for 'provider_refunded_more' whose recorded
-- refund is still open at the provider is checked by that refund's id as
-- when refund_pending (no new refund, no new alert), so ops can act once it
-- resolves; rework 7: likewise 'provider_refund_unconfirmed', and on the
-- second provider an open attempt without an id (looked for in the list).
CREATE FUNCTION public.issue_4522_overpayments_due(
  p_order_id uuid DEFAULT NULL,
  p_now timestamptz DEFAULT now(),
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('overpaymentId', op.id, 'orderId', op.order_id,
           'state', op.state) ORDER BY (op.state = 'refunded'), op.created_at, op.id), '[]'::jsonb)
    FROM (SELECT * FROM public.order_overpayments
           WHERE (p_order_id IS NULL OR order_id = p_order_id)
             AND (state = 'held'
                  OR (state = 'refund_failed' AND COALESCE(next_attempt_at, p_now) <= p_now)
                  OR (state = 'refund_pending' AND (p_order_id IS NOT NULL OR updated_at <= p_now - interval '5 minutes'))
                  OR (state = 'needs_ops' AND needs_ops_reason IN ('provider_refunded_more', 'provider_refund_unconfirmed')
                      AND (p_order_id IS NOT NULL OR updated_at <= p_now - interval '5 minutes')
                      AND ((EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts a
                                     WHERE a.overpayment_id = order_overpayments.id AND a.state IN ('creating', 'pending'))
                            -- rework 7: a second-provider attempt without an id is only looked for, never re-sent
                            AND (provider = 'paystack' OR NOT EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts a
                                       WHERE a.overpayment_id = order_overpayments.id AND a.state IN ('creating', 'pending')
                                         AND a.provider_refund_id IS NULL)))
                           -- T7-2: an extra refund still pending is re-read on the charge
                           OR detail->'over_refunded' @> '[{"status": "pending"}]'::jsonb))
                  -- Rework 9 (T8-1): a refunded overpayment whose unanswered
                  -- refund ops closed with 'retry' is watched: the charge's
                  -- refunds are re-read (nothing is sent) until the watch closes.
                  OR (state = 'refunded' AND detail ? 'retry_watch_from' AND NOT (detail ? 'retry_watch_closed_at')
                      AND (p_order_id IS NOT NULL OR updated_at <= p_now - interval '5 minutes')))
           -- Watched rows come after every row that may still need a refund.
           ORDER BY (state = 'refunded'), created_at, id
           LIMIT greatest(COALESCE(p_limit, 100), 1)) op
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayments_due(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_overpayments_due(uuid, timestamptz, integer) TO service_role;

-- One attempt as the edge needs it.
CREATE FUNCTION public.issue_4522_overpayment_attempt_json(
  a public.order_overpayment_refund_attempts,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object('attemptNo', a.attempt_no, 'origin', a.origin, 'state', a.state,
    'amountMinor', a.amount_minor, 'providerRefundId', a.provider_refund_id,
    'idempotencyKey', a.idempotency_key, 'refundId', a.refund_id, 'createdAt', a.created_at,
    'withinKeyWindow', a.created_at > p_now - public.issue_4522_overpayment_key_window())
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_attempt_json(public.order_overpayment_refund_attempts, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Move an overpayment to needs_ops (automatic refunding stops). True when
-- ops has not been told yet for this stop (the edge then alerts once).
CREATE FUNCTION public.issue_4522_overpayment_to_needs_ops(
  p_overpayment_id uuid,
  p_reason text,
  p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_op public.order_overpayments;
BEGIN
  SELECT * INTO v_op FROM public.order_overpayments WHERE id = p_overpayment_id FOR UPDATE;
  UPDATE public.order_overpayments
     SET state = 'needs_ops', needs_ops_reason = p_reason, next_attempt_at = NULL, resolved_at = NULL,
         ops_alerted_at = COALESCE(ops_alerted_at, p_now), updated_at = p_now
   WHERE id = p_overpayment_id;
  IF v_op.state IS DISTINCT FROM 'needs_ops' OR v_op.needs_ops_reason IS DISTINCT FROM p_reason THEN
    PERFORM public.issue_3645_audit_installment(v_op.installment_id, 'tr3.installment_overpayment_needs_ops',
      jsonb_build_object('overpayment_id', v_op.id, 'reason', p_reason,
        'remaining_minor', v_op.refund_minor - public.issue_4522_overpayment_returned_minor(v_op.id)));
  END IF;
  PERFORM public.issue_4522_sync_row_payout_hold(v_op.installment_id);
  RETURN v_op.ops_alerted_at IS NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_to_needs_ops(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- T5-1: a refund at the provider that carries an overpayment attempt's own
-- identity (its key or metadata) but is not the refund recorded for it: the
-- provider created our request late, or its lists lagged and a re-send made a
-- second one. That money has left, so it is handled as a late refund past the
-- amount: recorded once per provider refund (detail.over_refunded),
-- automatic refunding stops (needs_ops 'provider_refunded_more') and ops is
-- told once what was owed back and what was refunded. A failed refund moved
-- no money and is not recorded; T6-4: a recorded one's later final answer
-- updates its status (a failed one stops counting), never a second alert.
-- NULL when nothing new was recorded. The caller holds the order graph.
CREATE FUNCTION public.issue_4522_overpayment_extra_refund(
  p_overpayment_id uuid,
  p_attempt_no integer,
  p_provider_refund_id text,
  p_amount_minor bigint,
  p_status text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_op public.order_overpayments;
  v_refunded bigint;
  v_pending bigint;
  v_returned bigint;
  v_alert boolean;
  v_status text := CASE WHEN p_status IN ('failed', 'not_found') THEN 'failed' ELSE p_status END;
BEGIN
  SELECT * INTO v_op FROM public.order_overpayments WHERE id = p_overpayment_id FOR UPDATE;
  IF NOT FOUND OR v_status IS NULL OR v_status NOT IN ('pending', 'succeeded', 'failed')
     OR COALESCE(p_provider_refund_id, '') = '' OR COALESCE(p_amount_minor, 0) <= 0 THEN
    RETURN NULL;
  END IF;
  IF v_status <> 'pending' THEN
    UPDATE public.order_overpayments
       SET detail = jsonb_set(detail, '{over_refunded}', (
             SELECT jsonb_agg(CASE WHEN e ? 'status' AND e->>'provider_refund_id' = p_provider_refund_id
                                   THEN e || jsonb_build_object('status', v_status) ELSE e END ORDER BY n)
               FROM jsonb_array_elements(detail->'over_refunded') WITH ORDINALITY x(e, n)))
     WHERE id = v_op.id AND detail->'over_refunded' @> jsonb_build_array(jsonb_build_object('provider_refund_id', p_provider_refund_id));
  END IF;
  IF v_status = 'failed' THEN
    RETURN NULL;
  END IF;
  UPDATE public.order_overpayments
     SET detail = detail || jsonb_build_object('over_refunded', COALESCE(detail->'over_refunded', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('unmatched_attempt_no', p_attempt_no,
                'provider_refund_id', p_provider_refund_id, 'amount_minor', p_amount_minor,
                'status', p_status, 'at', p_now)))
   WHERE id = v_op.id AND NOT (COALESCE(detail->'over_refunded', '[]'::jsonb)
           @> jsonb_build_array(jsonb_build_object('provider_refund_id', p_provider_refund_id)));
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- T6-2: a failed refund is not counted; what is still pending is named.
  SELECT public.issue_4522_overpayment_committed_minor(v_op.id)
           + COALESCE(sum((e->>'amount_minor')::bigint) FILTER (WHERE COALESCE(e->>'status', '') <> 'failed'), 0),
         COALESCE((SELECT sum(amount_minor) FROM public.order_overpayment_refund_attempts
                    WHERE overpayment_id = v_op.id AND state IN ('creating', 'pending')), 0)
           + COALESCE(sum((e->>'amount_minor')::bigint) FILTER (WHERE e->>'status' = 'pending'), 0)
    INTO v_refunded, v_pending
    FROM public.order_overpayments o, jsonb_array_elements(o.detail->'over_refunded') e
   WHERE o.id = v_op.id;
  PERFORM public.issue_3645_audit_installment(v_op.installment_id, 'tr3.installment_overpayment_over_refunded',
    jsonb_build_object('overpayment_id', v_op.id, 'unmatched_attempt_no', p_attempt_no,
      'provider_refund_id', p_provider_refund_id, 'amount_minor', p_amount_minor,
      'over_minor', v_refunded - v_op.refund_minor, 'status', p_status));
  UPDATE public.order_overpayments SET ops_alerted_at = NULL WHERE id = v_op.id;
  v_alert := public.issue_4522_overpayment_to_needs_ops(v_op.id, 'provider_refunded_more', p_now);
  v_returned := public.issue_4522_overpayment_returned_minor(v_op.id);
  RETURN jsonb_build_object('ok', true, 'changed', true, 'state', 'needs_ops', 'attemptNo', p_attempt_no,
    'alertOps', v_alert, 'alertKind', 'provider_refunded_more', 'overRefundedMinor', v_refunded - v_op.refund_minor,
    'refundMinor', v_op.refund_minor, 'refundedMinor', v_refunded, 'pendingMinor', v_pending,
    'extraProviderRefundId', p_provider_refund_id,
    'returnedMinor', v_returned, 'remainingMinor', v_op.refund_minor - v_returned);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_extra_refund(uuid, integer, text, bigint, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Plan the next step for one overpayment (T3-1). The caller is the edge lane.
--   action 'verify'       — an attempt is creating or pending at the
--                           provider: check each one (by refund id; a
--                           creating attempt by its own key inside the key
--                           window, else by the provider's refund list) and
--                           record the answer. Nothing new is created.
--   action 'verify_prior' — an earlier attempt failed: re-read each of its
--                           provider refunds (p_verified_through = the
--                           highest attempt number the edge re-read this
--                           pass) before anything new is created.
--   action 'reconcile'    — T4-1: nothing is open and money is still owed:
--                           the edge first offers every refund the provider
--                           lists on the charge to issue_4522_overpayment_refund_event
--                           (adopted by id, metadata, or as a refund Mingla
--                           did not make), then plans again with
--                           p_reconciled = true. No attempt is reserved
--                           before the provider was asked.
--   action 'create'       — a new attempt was reserved here (state
--                           creating, its refunds row pending): send it with
--                           its idempotency key and record the answer.
--   busy                  — T4-1: another worker reserved or answered an
--                           attempt under two minutes ago and may still be
--                           talking to the provider: this one does nothing.
--   needs_ops             — below the provider's minimum (T3-7): stopped,
--                           alertOps once.
CREATE FUNCTION public.issue_4522_begin_overpayment_refund(
  p_overpayment_id uuid,
  p_verified_through integer DEFAULT NULL,
  p_reconciled boolean DEFAULT false,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_op public.order_overpayments;
  v_row public.order_installments;
  v_brand uuid;
  v_base jsonb;
  v_returned bigint;
  v_remaining bigint;
  v_min bigint;
  v_part bigint;
  v_attempt_no integer;
  v_refund_id uuid;
  v_key text;
  v_alert boolean := false;
  v_kind text;
  v_extra jsonb;
  v_att_id uuid;
BEGIN
  SELECT * INTO v_op FROM public.order_overpayments WHERE id = p_overpayment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_op.order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'overpayment_not_found');
  END IF;
  SELECT * INTO v_op FROM public.order_overpayments WHERE id = p_overpayment_id FOR UPDATE;
  -- Rework 9 (T8-1): after ops closed an unanswered second-provider refund
  -- with 'retry', the original may still complete at the provider with its
  -- webhook lost. For issue_4522_overpayment_pending_ceiling() after that
  -- retry the charge's refunds are re-read (action 'reconcile': the
  -- original's own merchant note names this overpayment and attempt, so a
  -- completed one is recorded as refunded past the amount, stopped for ops
  -- once, payout kept held). Nothing is ever sent from here. Then the watch
  -- closes and the host's payout for the charge is released.
  IF v_op.state = 'refunded' AND v_op.detail ? 'retry_watch_from' AND NOT (v_op.detail ? 'retry_watch_closed_at') THEN
    IF (v_op.detail->>'retry_watch_from')::timestamptz <= p_now - public.issue_4522_overpayment_pending_ceiling() THEN
      UPDATE public.order_overpayments
         SET detail = detail || jsonb_build_object('retry_watch_closed_at', p_now), updated_at = p_now
       WHERE id = v_op.id;
      PERFORM public.issue_3645_audit_installment(v_op.installment_id, 'tr3.installment_overpayment_retry_watch_closed',
        jsonb_build_object('overpayment_id', v_op.id, 'watched_from', v_op.detail->>'retry_watch_from'));
      PERFORM public.issue_4522_sync_row_payout_hold(v_op.installment_id);
    ELSIF NOT COALESCE(p_reconciled, false) THEN
      UPDATE public.order_overpayments SET updated_at = p_now WHERE id = v_op.id;
      RETURN jsonb_build_object('ok', true, 'done', false, 'action', 'reconcile',
        'overpaymentId', v_op.id, 'orderId', v_op.order_id, 'installmentId', v_op.installment_id,
        'brandId', (SELECT e.brand_id FROM public.orders o JOIN public.events e ON e.id = o.event_id
                     WHERE o.id = v_op.order_id),
        'provider', v_op.provider, 'providerRef', v_op.provider_ref, 'currency', trim(v_op.currency),
        'refundMinor', v_op.refund_minor, 'state', v_op.state, 'watch', true);
    END IF;
  END IF;
  IF v_op.state IN ('refunded', 'applied') THEN
    RETURN jsonb_build_object('ok', true, 'done', true, 'state', v_op.state);
  END IF;
  IF public.issue_4522_overpayment_policy(v_op.order_id) <> 'refund' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'policy_not_refund');
  END IF;
  SELECT * INTO v_row FROM public.order_installments WHERE id = v_op.installment_id;
  SELECT e.brand_id INTO v_brand FROM public.orders o JOIN public.events e ON e.id = o.event_id
   WHERE o.id = v_op.order_id;
  v_returned := public.issue_4522_overpayment_returned_minor(v_op.id);
  -- T6-2: a succeeded refund past the amount also went back to the traveler.
  v_remaining := v_op.refund_minor - public.issue_4522_overpayment_back_minor(v_op.id);
  v_base := jsonb_build_object('ok', true, 'done', false,
    'overpaymentId', v_op.id, 'orderId', v_op.order_id, 'installmentId', v_op.installment_id,
    'brandId', v_brand, 'provider', v_op.provider, 'providerRef', v_op.provider_ref,
    'currency', trim(v_op.currency), 'refundMinor', v_op.refund_minor, 'returnedMinor', v_returned,
    'remainingMinor', v_remaining, 'state', v_op.state);

  -- 0. T4-1: one sweep at a time. A creating attempt touched under two
  --    minutes ago belongs to a worker that may still be waiting on the
  --    provider (the order-graph lock above serialises the begins).
  IF EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts
              WHERE overpayment_id = v_op.id AND state = 'creating'
                AND updated_at > p_now - interval '2 minutes') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'busy');
  END IF;
  -- 1. Anything still open at the provider is checked first; never replaced.
  IF EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts
              WHERE overpayment_id = v_op.id AND state IN ('creating', 'pending')) THEN
    -- Rework 7: a second-provider create is sent once and only looked for
    -- after (no idempotency key there). Still unseen past the in-flight
    -- ceiling: ops is told once (provider_refund_unconfirmed); checking goes on.
    IF v_op.provider = 'paystack' AND NOT (v_op.detail ? 'unconfirmed_alerted_at')
       AND EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts
                    WHERE overpayment_id = v_op.id AND state = 'creating' AND provider_refund_id IS NULL
                      AND created_at <= p_now - public.issue_4522_flex_in_flight_ceiling()) THEN
      UPDATE public.order_overpayments SET detail = detail || jsonb_build_object('unconfirmed_alerted_at', p_now)
       WHERE id = v_op.id;
      IF v_op.state <> 'needs_ops' THEN
        PERFORM public.issue_4522_overpayment_to_needs_ops(v_op.id, 'provider_refund_unconfirmed', p_now);
      END IF;
      v_alert := true;
      v_kind := 'provider_refund_unconfirmed';
    ELSIF v_op.ops_alerted_at IS NULL AND EXISTS (
         SELECT 1 FROM public.order_overpayment_refund_attempts
          WHERE overpayment_id = v_op.id AND state IN ('creating', 'pending')
            AND created_at <= p_now - public.issue_4522_overpayment_pending_ceiling()) THEN
      UPDATE public.order_overpayments SET ops_alerted_at = p_now WHERE id = v_op.id;
      PERFORM public.issue_3645_audit_installment(v_op.installment_id, 'tr3.installment_overpayment_refund_pending_long',
        jsonb_build_object('overpayment_id', v_op.id));
      v_alert := true;
      v_kind := 'refund_pending_too_long';
    END IF;
    RETURN v_base || jsonb_build_object('action', 'verify', 'alertOps', v_alert, 'alertKind', v_kind,
      'attempts', (SELECT jsonb_agg(public.issue_4522_overpayment_attempt_json(a, p_now) ORDER BY a.attempt_no)
                     FROM public.order_overpayment_refund_attempts a
                    WHERE a.overpayment_id = v_op.id AND a.state IN ('creating', 'pending')));
  END IF;
  IF v_op.state = 'needs_ops' THEN
    -- T7-2: an extra refund still pending is re-read on the charge (every 5
    -- minutes), so ops can act once it ends even if its webhook is lost.
    IF NOT COALESCE(p_reconciled, false) AND v_op.detail->'over_refunded' @> '[{"status": "pending"}]'::jsonb THEN
      UPDATE public.order_overpayments SET updated_at = p_now WHERE id = v_op.id;
      RETURN v_base || jsonb_build_object('action', 'reconcile');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'needs_ops', 'needsOpsReason', v_op.needs_ops_reason);
  END IF;
  -- T7-4: a total that counts extra refunds is trusted only after the
  -- provider was asked again (one may have been reversed, its webhook lost).
  IF v_remaining <= 0 AND NOT COALESCE(p_reconciled, false) AND v_op.provider_ref IS NOT NULL
     AND public.issue_4522_overpayment_back_minor(v_op.id) <> v_returned THEN
    RETURN v_base || jsonb_build_object('action', 'reconcile');
  END IF;
  IF v_remaining <= 0 THEN
    -- T7-1: an extra refund that returned the money instead of the recorded
    -- one becomes one of its attempts (whole, within the amount), so the row,
    -- the cancel refund and the payout count it exactly as a recorded refund.
    FOR v_extra IN SELECT e FROM jsonb_array_elements(COALESCE(v_op.detail->'over_refunded', '[]'::jsonb)) e
                    WHERE e->>'status' = 'succeeded' AND COALESCE(e->>'provider_refund_id', '') <> ''
                      AND NOT EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts a
                                       WHERE a.overpayment_id = v_op.id AND a.provider_refund_id = e->>'provider_refund_id') LOOP
      v_part := (v_extra->>'amount_minor')::bigint;
      CONTINUE WHEN v_part > least(v_op.refund_minor - public.issue_4522_overpayment_committed_minor(v_op.id),
                                   public.issue_4522_overpayment_max_refund_part());
      SELECT COALESCE(max(attempt_no), 0) + 1 INTO v_attempt_no
        FROM public.order_overpayment_refund_attempts WHERE overpayment_id = v_op.id;
      INSERT INTO public.refunds (order_id, amount_cents, reason, status, currency,
        stripe_payment_intent_id, stripe_charge_id, metadata, order_installment_id, buyer_refund_status)
      VALUES (v_op.order_id, v_part::integer, 'Overpayment returned by an extra refund at the provider', 'pending',
        v_op.currency, CASE WHEN v_op.provider = 'stripe' THEN v_row.stripe_payment_intent_id END,
        CASE WHEN v_op.provider = 'stripe' THEN v_row.stripe_charge_id END,
        jsonb_build_object('source', 'issue_4522_overpayment', 'overpayment_id', v_op.id, 'attempt_no', v_attempt_no,
          'reason', v_op.reason, 'origin', 'provider_match', 'provider_refund_id', v_extra->>'provider_refund_id'),
        v_op.installment_id, 'provider_pending')
      RETURNING id INTO v_refund_id;
      INSERT INTO public.order_overpayment_refund_attempts (overpayment_id, attempt_no, origin, amount_minor,
        state, refund_id, provider_refund_id, created_at, updated_at)
      VALUES (v_op.id, v_attempt_no, 'provider_match', v_part, 'pending', v_refund_id, v_extra->>'provider_refund_id',
        p_now, p_now)
      RETURNING id INTO v_att_id;
      UPDATE public.order_overpayments
         SET detail = jsonb_set(detail, '{over_refunded}', (
               SELECT jsonb_agg(CASE WHEN x->>'provider_refund_id' = v_extra->>'provider_refund_id'
                                     THEN x || jsonb_build_object('adopted_attempt_no', v_attempt_no) ELSE x END ORDER BY n)
                 FROM jsonb_array_elements(detail->'over_refunded') WITH ORDINALITY y(x, n))),
             refund_attempt_no = v_attempt_no, refund_id = v_refund_id
       WHERE id = v_op.id;
      PERFORM public.issue_4522_apply_overpayment_attempt_outcome(v_att_id, 'succeeded', v_extra->>'provider_refund_id',
        NULL, p_now);
    END LOOP;
    IF (SELECT state FROM public.order_overpayments WHERE id = v_op.id) = 'refunded' THEN
      RETURN jsonb_build_object('ok', true, 'done', true, 'state', 'refunded');
    END IF;
    UPDATE public.order_overpayments
       SET state = 'refunded', resolved_at = p_now, updated_at = p_now, needs_ops_reason = NULL
     WHERE id = v_op.id;
    PERFORM public.issue_4522_sync_row_payout_hold(v_op.installment_id);
    RETURN jsonb_build_object('ok', true, 'done', true, 'state', 'refunded');
  END IF;
  IF v_op.state = 'refund_failed' AND COALESCE(v_op.next_attempt_at, p_now) > p_now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'retry_not_due', 'nextAttemptAt', v_op.next_attempt_at);
  END IF;
  -- 2. Every earlier refund the provider knows is re-read before a new one.
  IF EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts
              WHERE overpayment_id = v_op.id AND state = 'failed' AND provider_refund_id IS NOT NULL
                AND attempt_no > COALESCE(p_verified_through, 0)) THEN
    RETURN v_base || jsonb_build_object('action', 'verify_prior',
      'attempts', (SELECT jsonb_agg(public.issue_4522_overpayment_attempt_json(a, p_now) ORDER BY a.attempt_no)
                     FROM public.order_overpayment_refund_attempts a
                    WHERE a.overpayment_id = v_op.id AND a.state = 'failed' AND a.provider_refund_id IS NOT NULL));
  END IF;
  -- Already returned by a full refund of the same charge (a refund made
  -- outside this lane that consumed the overpaid part): resolved, never a
  -- second provider refund.
  IF v_op.reason = 'flex_exceeds_balance'
     AND (v_row.refunded_amount_cents - v_returned) + v_op.refund_minor > COALESCE(v_row.buyer_total_cents, v_row.amount_cents) THEN
    UPDATE public.order_overpayments
       SET state = 'refunded', resolved_at = p_now, updated_at = p_now,
           detail = detail || jsonb_build_object('resolved_by', 'charge_already_refunded')
     WHERE id = v_op.id;
    PERFORM public.issue_4522_sync_row_payout_hold(v_op.installment_id);
    RETURN jsonb_build_object('ok', true, 'done', true, 'state', 'refunded', 'resolvedBy', 'charge_already_refunded');
  END IF;
  IF v_op.provider_ref IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'provider_ref_missing');
  END IF;
  -- 3. T3-7: below the provider's minimum partial refund it can never be
  --    refunded automatically: stop now, alert ops once, never retry daily.
  v_min := public.issue_4522_overpayment_min_refund_minor(v_op.provider);
  IF v_remaining < v_min THEN
    v_alert := public.issue_4522_overpayment_to_needs_ops(v_op.id, 'below_provider_minimum', p_now);
    RETURN v_base || jsonb_build_object('ok', false, 'reason', 'needs_ops', 'needsOpsReason', 'below_provider_minimum',
      'alertOps', v_alert, 'alertKind', 'below_provider_minimum', 'minRefundMinor', v_min);
  END IF;
  -- 4. T4-1: the provider is asked what already exists on the charge first.
  IF NOT COALESCE(p_reconciled, false) THEN
    RETURN v_base || jsonb_build_object('action', 'reconcile');
  END IF;
  -- 5. Reserve the next part: at most one 32-bit refund row (T3-6), and
  --    never leaving a last part below the provider's minimum.
  v_part := least(v_remaining, public.issue_4522_overpayment_max_refund_part());
  IF v_remaining - v_part > 0 AND v_remaining - v_part < v_min THEN
    v_part := v_remaining - v_min;
  END IF;
  SELECT COALESCE(max(attempt_no), 0) + 1 INTO v_attempt_no
    FROM public.order_overpayment_refund_attempts WHERE overpayment_id = v_op.id;
  v_key := 'mingla_overpay_refund:' || v_op.id || ':' || v_attempt_no;
  INSERT INTO public.refunds (order_id, amount_cents, reason, status, currency,
    stripe_payment_intent_id, stripe_charge_id, metadata, order_installment_id, buyer_refund_status)
  VALUES (v_op.order_id, v_part::integer,
    'Overpayment returned automatically to the traveler', 'pending', v_op.currency,
    CASE WHEN v_op.provider = 'stripe' THEN v_op.provider_ref END,
    CASE WHEN v_op.provider = 'stripe' THEN v_row.stripe_charge_id END,
    jsonb_build_object('source', 'issue_4522_overpayment', 'overpayment_id', v_op.id,
      'attempt_no', v_attempt_no, 'reason', v_op.reason, 'origin', 'mingla'),
    v_op.installment_id, 'provider_pending')
  RETURNING id INTO v_refund_id;
  INSERT INTO public.order_overpayment_refund_attempts (overpayment_id, attempt_no, origin, amount_minor,
    state, refund_id, idempotency_key, created_at, updated_at)
  VALUES (v_op.id, v_attempt_no, 'mingla', v_part, 'creating', v_refund_id, v_key, p_now, p_now);
  UPDATE public.order_overpayments
     SET state = 'refund_pending', refund_attempt_no = v_attempt_no, refund_id = v_refund_id,
         next_attempt_at = NULL, updated_at = p_now
   WHERE id = v_op.id;
  RETURN v_base || jsonb_build_object('action', 'create', 'attemptNo', v_attempt_no, 'amountMinor', v_part,
    'refundId', v_refund_id, 'idempotencyKey', v_key, 'remainingAfterMinor', v_remaining - v_part);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_begin_overpayment_refund(uuid, integer, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_begin_overpayment_refund(uuid, integer, boolean, timestamptz) TO service_role;

-- Apply one provider answer to one attempt, then settle the overpayment's
-- state. Replays and out-of-order answers are no-ops: a final answer is
-- never downgraded, a pending one never replaces succeeded or failed (except
-- a failed attempt the provider now reports live, and a succeeded refund the
-- provider reversed, which stops the lane for ops). Caller holds the graph.
--   succeeded       — returned (a flexible payment's part is also marked on
--                     its row, so payouts and later refunds never count it).
--   pending         — accepted, not finished (needs its refund id).
--   unknown         — no answer: unchanged, same key next time.
--   failed/not_found — refused / never created at the provider.
CREATE FUNCTION public.issue_4522_apply_overpayment_attempt_outcome(
  p_attempt_id uuid,
  p_outcome text,
  p_provider_refund_id text,
  p_error text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_att public.order_overpayment_refund_attempts;
  v_op public.order_overpayments;
  v_prev text;
  v_new text;
  v_id text;
  v_returned bigint;
  v_live boolean;
  v_state text;
  v_alert boolean := false;
  v_alert_kind text;
  v_fails integer;
  v_over bigint;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded', 'pending', 'unknown', 'failed', 'not_found') THEN
    RAISE EXCEPTION 'overpayment_outcome_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_att FROM public.order_overpayment_refund_attempts WHERE id = p_attempt_id FOR UPDATE;
  SELECT * INTO v_op FROM public.order_overpayments WHERE id = v_att.overpayment_id FOR UPDATE;
  IF p_provider_refund_id IS NOT NULL AND v_att.provider_refund_id IS NOT NULL
     AND v_att.provider_refund_id <> p_provider_refund_id THEN
    -- T5-1: a second refund made for this attempt (a late or re-sent create).
    RETURN COALESCE(public.issue_4522_overpayment_extra_refund(v_op.id, v_att.attempt_no, p_provider_refund_id,
             v_att.amount_minor, p_outcome, p_now), '{}'::jsonb)
      || jsonb_build_object('ok', false, 'reason', 'provider_refund_id_mismatch', 'attemptNo', v_att.attempt_no);
  END IF;
  v_id := COALESCE(v_att.provider_refund_id, p_provider_refund_id);
  v_prev := v_att.state;
  v_new := CASE
    WHEN p_outcome = 'succeeded' THEN 'succeeded'
    WHEN p_outcome IN ('failed', 'not_found') THEN 'failed'
    WHEN p_outcome = 'pending' AND v_id IS NOT NULL AND v_prev IN ('creating', 'pending', 'failed') THEN 'pending'
    ELSE v_prev END;
  -- A final answer is never downgraded; not_found never touches a final one.
  -- T4-1: only the provider's own word on THIS refund (its id) reverses a
  -- succeeded one; a refused create (no id) never does.
  IF v_prev = 'succeeded' AND NOT (v_new = 'failed' AND p_outcome = 'failed'
                                   AND p_provider_refund_id IS NOT NULL AND p_provider_refund_id = v_id) THEN
    v_new := 'succeeded';
  END IF;
  IF v_prev = 'failed' AND p_outcome = 'not_found' THEN v_new := 'failed'; END IF;

  IF v_new = v_prev THEN
    UPDATE public.order_overpayment_refund_attempts
       SET provider_refund_id = v_id,
           last_error = CASE WHEN p_outcome IN ('unknown', 'failed', 'not_found') AND v_prev IN ('creating', 'pending')
                             THEN left(COALESCE(p_error, p_outcome), 300) ELSE last_error END,
           updated_at = p_now
     WHERE id = v_att.id;
    UPDATE public.order_overpayments SET updated_at = p_now
     WHERE id = v_op.id AND (state = 'refund_pending'
                             OR needs_ops_reason IN ('provider_refunded_more', 'provider_refund_unconfirmed'));
    RETURN jsonb_build_object('ok', true, 'changed', false, 'state', v_op.state, 'attemptNo', v_att.attempt_no,
      'attemptState', v_prev);
  END IF;
  -- Rework 7: the provider answered an unconfirmed refund: it is back with the
  -- automatic lane (settled below as for any answer) and may alert ops again.
  IF v_op.needs_ops_reason = 'provider_refund_unconfirmed' THEN
    UPDATE public.order_overpayments
       SET state = 'refund_pending', needs_ops_reason = NULL, ops_alerted_at = NULL,
           detail = detail - 'unconfirmed_alerted_at', updated_at = p_now
     WHERE id = v_op.id;
    SELECT * INTO v_op FROM public.order_overpayments WHERE id = v_op.id;
  END IF;

  -- T4-1: a refund the provider has that was counted failed would take the
  -- overpayment past its amount (e.g. a late answer after another refund
  -- went out). Once the provider says it succeeded, the money already left:
  -- it is recorded on the overpayment, automatic refunding stops and ops is
  -- told the exact extra amount once; the event is acknowledged, never
  -- refused forever. Still pending: acknowledged, unchanged.
  IF v_prev = 'failed' AND v_new IN ('pending', 'succeeded') THEN
    v_over := public.issue_4522_overpayment_committed_minor(v_op.id) + v_att.amount_minor - v_op.refund_minor;
    IF v_over > 0 THEN
      UPDATE public.order_overpayments
         SET detail = detail || jsonb_build_object('over_refunded', COALESCE(detail->'over_refunded', '[]'::jsonb)
               || jsonb_build_array(jsonb_build_object('attempt_no', v_att.attempt_no, 'provider_refund_id', v_id,
                    'amount_minor', v_att.amount_minor, 'over_minor', v_over, 'at', p_now)))
       WHERE id = v_op.id AND v_new = 'succeeded' AND NOT (COALESCE(detail->'over_refunded', '[]'::jsonb)
               @> jsonb_build_array(jsonb_build_object('attempt_no', v_att.attempt_no)));
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'changed', false, 'state', v_op.state, 'attemptNo', v_att.attempt_no,
          'attemptState', v_prev);
      END IF;
      PERFORM public.issue_3645_audit_installment(v_op.installment_id, 'tr3.installment_overpayment_over_refunded',
        jsonb_build_object('overpayment_id', v_op.id, 'attempt_no', v_att.attempt_no, 'provider_refund_id', v_id,
          'over_minor', v_over, 'status', v_new));
      UPDATE public.order_overpayments SET ops_alerted_at = NULL WHERE id = v_op.id;
      v_alert := public.issue_4522_overpayment_to_needs_ops(v_op.id, 'provider_refunded_more', p_now);
      RETURN jsonb_build_object('ok', true, 'changed', true, 'state', 'needs_ops', 'attemptNo', v_att.attempt_no,
        'attemptState', v_prev, 'alertOps', v_alert, 'alertKind', 'provider_refunded_more', 'overRefundedMinor', v_over,
        'refundMinor', v_op.refund_minor, 'refundedMinor', v_op.refund_minor + v_over,
        'returnedMinor', public.issue_4522_overpayment_returned_minor(v_op.id),
        'remainingMinor', v_op.refund_minor - public.issue_4522_overpayment_returned_minor(v_op.id));
    END IF;
  END IF;

  UPDATE public.order_overpayment_refund_attempts
     SET state = v_new, provider_refund_id = v_id,
         last_error = CASE WHEN v_new = 'failed' THEN left(COALESCE(p_error, p_outcome), 300)
                           WHEN v_new = 'succeeded' THEN NULL ELSE last_error END,
         resolved_at = CASE WHEN v_new IN ('succeeded', 'failed') THEN p_now END,
         updated_at = p_now
   WHERE id = v_att.id;
  UPDATE public.refunds
     SET status = CASE v_new WHEN 'succeeded' THEN 'succeeded' WHEN 'failed' THEN 'failed' ELSE 'pending' END,
         buyer_refund_status = CASE v_new WHEN 'succeeded' THEN 'succeeded' WHEN 'failed' THEN 'failed'
                                          ELSE 'provider_pending' END,
         stripe_refund_id = CASE WHEN v_att.origin = 'mingla' THEN COALESCE(stripe_refund_id, v_id) ELSE stripe_refund_id END,
         processed_at = CASE WHEN v_new = 'succeeded' THEN p_now ELSE processed_at END,
         buyer_refunded_at = CASE WHEN v_new = 'succeeded' THEN p_now ELSE buyer_refunded_at END
   WHERE id = v_att.refund_id;
  -- Only a flexible payment's excess is part of its row's recorded charge.
  IF v_new = 'succeeded' AND v_op.reason = 'flex_exceeds_balance' AND v_att.refund_id IS NOT NULL THEN
    PERFORM public.issue_3645_mark_installment_refunded(v_op.installment_id, v_att.refund_id, v_att.amount_minor);
  END IF;
  PERFORM public.issue_3645_audit_installment(v_op.installment_id, 'tr3.installment_overpayment_attempt_' || v_new,
    jsonb_build_object('overpayment_id', v_op.id, 'attempt_no', v_att.attempt_no, 'origin', v_att.origin,
      'amount_minor', v_att.amount_minor, 'provider_refund_id', v_id, 'previous', v_prev,
      'error', left(COALESCE(p_error, ''), 300)));

  v_returned := public.issue_4522_overpayment_returned_minor(v_op.id);
  v_live := EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts
                     WHERE overpayment_id = v_op.id AND state IN ('creating', 'pending'));
  IF v_prev = 'succeeded' AND v_new = 'failed' THEN
    -- The provider reversed a refund it had completed: the money is back
    -- with the charge; automatic refunding stops and ops decides.
    -- T4-4: the row no longer counts it as refunded (a later retry's refund
    -- is then counted once, as the provider's ledger shows).
    IF v_op.reason = 'flex_exceeds_balance' AND v_att.refund_id IS NOT NULL THEN
      DELETE FROM public.order_installment_refund_applications
       WHERE refund_id = v_att.refund_id AND installment_id = v_op.installment_id;
      IF FOUND THEN
        UPDATE public.order_installments
           SET refunded_amount_cents = refunded_amount_cents - v_att.amount_minor,
               status = CASE WHEN status = 'refunded' THEN 'collected' ELSE status END
         WHERE id = v_op.installment_id;
      END IF;
    END IF;
    PERFORM public.issue_4522_overpayment_to_needs_ops(v_op.id, 'provider_reversed_refund', p_now);
    v_alert := true;
    v_alert_kind := 'provider_reversed_refund';
    v_state := 'needs_ops';
  -- T5-1: an overpayment refunded more than owed stays with ops when it completes.
  ELSIF v_returned >= v_op.refund_minor AND v_op.needs_ops_reason IS DISTINCT FROM 'provider_refunded_more' THEN
    UPDATE public.order_overpayments
       SET state = 'refunded', provider_refund_id = COALESCE(v_id, provider_refund_id), last_error = NULL,
           needs_ops_reason = NULL, consecutive_failures = 0, next_attempt_at = NULL,
           resolved_at = p_now, updated_at = p_now
     WHERE id = v_op.id;
    PERFORM public.issue_3645_audit_installment(v_op.installment_id, 'tr3.installment_overpayment_refunded',
      jsonb_build_object('overpayment_id', v_op.id, 'refund_minor', v_op.refund_minor,
        'provider_refund_id', v_id, 'origin', v_att.origin));
    v_state := 'refunded';
  ELSIF v_live THEN
    UPDATE public.order_overpayments
       SET state = 'refund_pending', provider_refund_id = COALESCE(v_id, provider_refund_id), updated_at = p_now
     WHERE id = v_op.id;
    v_state := 'refund_pending';
  ELSIF v_op.needs_ops_reason IS NOT NULL THEN
    UPDATE public.order_overpayments SET state = 'needs_ops', updated_at = p_now WHERE id = v_op.id;
    v_state := 'needs_ops';
  ELSIF v_new = 'failed' AND v_att.origin = 'mingla' THEN
    v_fails := v_op.consecutive_failures + 1;
    UPDATE public.order_overpayments
       SET consecutive_failures = v_fails, last_error = left(COALESCE(p_error, p_outcome), 300), updated_at = p_now
     WHERE id = v_op.id;
    IF v_fails >= public.issue_4522_overpayment_failure_limit() THEN
      -- T3-2: automatic refunding stops; nothing more is sent until an ops
      -- action or a matched provider refund resolves it.
      v_alert := public.issue_4522_overpayment_to_needs_ops(v_op.id, 'refund_failed_repeatedly', p_now);
      v_alert_kind := 'refund_failed_repeatedly';
      v_state := 'needs_ops';
    ELSE
      UPDATE public.order_overpayments
         SET state = 'refund_failed',
             -- 1h, 2h ... capped at 24h.
             next_attempt_at = p_now + least(interval '1 hour' * power(2, greatest(v_fails - 1, 0)), interval '24 hours')
       WHERE id = v_op.id;
      v_state := 'refund_failed';
    END IF;
  ELSE
    -- A part was returned and more remains (T3-6), or a matched provider
    -- refund failed: the next part is due now.
    UPDATE public.order_overpayments
       SET state = 'held', consecutive_failures = CASE WHEN v_new = 'succeeded' THEN 0 ELSE consecutive_failures END,
           next_attempt_at = NULL, updated_at = p_now
     WHERE id = v_op.id;
    v_state := 'held';
  END IF;
  PERFORM public.issue_4522_sync_row_payout_hold(v_op.installment_id);
  RETURN jsonb_build_object('ok', true, 'changed', true, 'state', v_state, 'attemptNo', v_att.attempt_no,
    'attemptState', v_new, 'alertOps', v_alert, 'alertKind', v_alert_kind,
    'returnedMinor', v_returned, 'remainingMinor', v_op.refund_minor - v_returned);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_apply_overpayment_attempt_outcome(uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Record the provider's answer for one attempt (the edge lane, after a
-- create, a retrieve by refund id, a re-send with the same key, or a read
-- of the provider's refund list). See issue_4522_apply_overpayment_attempt_outcome.
CREATE FUNCTION public.issue_4522_finish_overpayment_refund(
  p_overpayment_id uuid,
  p_attempt_no integer,
  p_outcome text,
  p_provider_refund_id text,
  p_error text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_op public.order_overpayments;
  v_att_id uuid;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded', 'pending', 'unknown', 'failed', 'not_found') THEN
    RAISE EXCEPTION 'overpayment_outcome_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_op FROM public.order_overpayments WHERE id = p_overpayment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_op.order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'overpayment_not_found');
  END IF;
  SELECT id INTO v_att_id FROM public.order_overpayment_refund_attempts
   WHERE overpayment_id = p_overpayment_id AND attempt_no = p_attempt_no;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;
  RETURN public.issue_4522_apply_overpayment_attempt_outcome(v_att_id, p_outcome, p_provider_refund_id, p_error, p_now);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_finish_overpayment_refund(uuid, integer, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_finish_overpayment_refund(uuid, integer, text, text, text, timestamptz) TO service_role;

-- A refund event from a provider's webhook (T3-1 / T3-2). Matched, in order:
--   1. by the provider refund id stored on an attempt (any origin);
--   2. by the attempt named in Mingla's own refund metadata (Stripe
--      mingla_overpayment_id + mingla_overpayment_attempt; Paystack merchant
--      note mingla_overpay_refund:<id>:<n>) whose id was never stored — the
--      amount must match the attempt;
--   3. a refund NOT made by Mingla (p_mingla_created false: e.g. the
--      provider's dashboard) on a charge that carries an unreturned
--      overpayment: allocated to that overpayment first, up to what it still
--      owes and is not already being refunded, which resolves it and stops
--      its retries (an ops refund after the alert is matched here).
-- handled=false leaves the event to the caller's existing path. Idempotent:
-- a replay or an out-of-order event never moves an attempt backwards.
CREATE FUNCTION public.issue_4522_overpayment_refund_event(
  p_provider text,
  p_provider_refund_id text,
  p_payment_ref text,
  p_amount_minor bigint,
  p_status text,
  p_overpayment_id uuid DEFAULT NULL,
  p_attempt_no integer DEFAULT NULL,
  p_mingla_created boolean DEFAULT true,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_att public.order_overpayment_refund_attempts;
  v_op public.order_overpayments;
  v_row public.order_installments;
  v_results jsonb := '[]'::jsonb;
  v_res jsonb;
  v_left bigint;
  v_take bigint;
  v_refund_id uuid;
  v_attempt_no integer;
  v_att_id uuid;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('stripe', 'paystack')
     OR p_status IS NULL OR p_status NOT IN ('succeeded', 'pending', 'failed') THEN
    RAISE EXCEPTION 'overpayment_refund_event_invalid' USING ERRCODE = '22023';
  END IF;
  -- 1. A stored provider refund id (a matched dashboard refund may cover
  --    several overpayments of the same charge).
  IF p_provider_refund_id IS NOT NULL AND p_provider_refund_id <> '' THEN
    FOR v_att_id IN
      SELECT a.id FROM public.order_overpayment_refund_attempts a
        JOIN public.order_overpayments op ON op.id = a.overpayment_id
       WHERE a.provider_refund_id = p_provider_refund_id AND op.provider = p_provider
       ORDER BY op.created_at, a.attempt_no
    LOOP
      SELECT op.* INTO v_op FROM public.order_overpayments op
        JOIN public.order_overpayment_refund_attempts a ON a.overpayment_id = op.id WHERE a.id = v_att_id;
      PERFORM public.issue_4522_lock_order_graph(v_op.order_id);
      v_res := public.issue_4522_apply_overpayment_attempt_outcome(v_att_id, p_status, p_provider_refund_id, NULL, p_now);
      v_results := v_results || jsonb_build_array(v_res || jsonb_build_object('overpaymentId', v_op.id,
        'orderId', v_op.order_id, 'installmentId', v_op.installment_id, 'currency', trim(v_op.currency),
        'providerRef', v_op.provider_ref, 'refundMinor', v_op.refund_minor));
    END LOOP;
    IF jsonb_array_length(v_results) > 0 THEN
      RETURN jsonb_build_object('handled', true, 'matchedBy', 'provider_refund_id', 'results', v_results);
    END IF;
  END IF;
  -- 2. Mingla's own refund, named by its metadata.
  IF p_overpayment_id IS NOT NULL THEN
    SELECT * INTO v_op FROM public.order_overpayments WHERE id = p_overpayment_id AND provider = p_provider;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('handled', false, 'reason', 'overpayment_not_found');
    END IF;
    PERFORM public.issue_4522_lock_order_graph(v_op.order_id);
    SELECT * INTO v_att FROM public.order_overpayment_refund_attempts
     WHERE overpayment_id = v_op.id AND attempt_no = p_attempt_no AND origin = 'mingla';
    IF NOT FOUND OR (v_att.provider_refund_id IS NOT NULL AND v_att.provider_refund_id <> p_provider_refund_id)
       OR (p_amount_minor IS NOT NULL AND p_amount_minor > 0 AND p_amount_minor <> v_att.amount_minor) THEN
      PERFORM public.issue_3645_audit_installment(v_op.installment_id, 'tr3.installment_overpayment_event_unmatched',
        jsonb_build_object('overpayment_id', v_op.id, 'attempt_no', p_attempt_no,
          'provider_refund_id', p_provider_refund_id, 'amount_minor', p_amount_minor, 'status', p_status));
      -- T5-1: a second refund for an attempt whose own refund is recorded goes to ops once.
      v_res := CASE WHEN v_att.provider_refund_id <> p_provider_refund_id
        THEN public.issue_4522_overpayment_extra_refund(v_op.id, p_attempt_no, p_provider_refund_id,
               p_amount_minor, p_status, p_now) END;
      RETURN jsonb_build_object('handled', true, 'matchedBy', 'none', 'reason', 'attempt_mismatch',
        'overpaymentId', v_op.id, 'results', CASE WHEN v_res IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
          v_res || jsonb_build_object('overpaymentId', v_op.id, 'orderId', v_op.order_id,
            'installmentId', v_op.installment_id, 'currency', trim(v_op.currency),
            'providerRef', v_op.provider_ref)) END);
    END IF;
    v_res := public.issue_4522_apply_overpayment_attempt_outcome(v_att.id, p_status, p_provider_refund_id, NULL, p_now);
    RETURN jsonb_build_object('handled', true, 'matchedBy', 'metadata', 'results', jsonb_build_array(
      v_res || jsonb_build_object('overpaymentId', v_op.id, 'orderId', v_op.order_id,
        'installmentId', v_op.installment_id, 'currency', trim(v_op.currency),
        'providerRef', v_op.provider_ref, 'refundMinor', v_op.refund_minor)));
  END IF;
  -- 3. A refund made at the provider itself on a charge carrying an
  --    unreturned overpayment: the overpaid money is returned first.
  IF p_mingla_created IS NOT FALSE OR p_status = 'failed' OR COALESCE(p_amount_minor, 0) <= 0
     OR p_provider_refund_id IS NULL OR p_provider_refund_id = '' OR p_payment_ref IS NULL THEN
    RETURN jsonb_build_object('handled', false);
  END IF;
  -- T4-1: a refund Mingla already recorded elsewhere (its id is known) is
  -- explained, even when the provider's list shows it without metadata.
  IF EXISTS (SELECT 1 FROM public.refunds WHERE p_provider = 'stripe' AND stripe_refund_id = p_provider_refund_id)
     OR EXISTS (SELECT 1 FROM public.paystack_refund_attempts
                 WHERE p_provider = 'paystack' AND provider_refund_id = p_provider_refund_id) THEN
    RETURN jsonb_build_object('handled', false, 'reason', 'known_refund');
  END IF;
  v_left := p_amount_minor;
  FOR v_op IN
    SELECT op.* FROM public.order_overpayments op
      JOIN public.order_installments oi ON oi.id = op.installment_id
     WHERE op.provider = p_provider
       AND op.state IN ('held', 'refund_pending', 'refund_failed', 'needs_ops')
       AND (op.provider_ref = p_payment_ref
            OR (p_provider = 'stripe' AND oi.stripe_payment_intent_id = p_payment_ref))
     ORDER BY op.created_at, op.id
  LOOP
    EXIT WHEN v_left <= 0;
    PERFORM public.issue_4522_lock_order_graph(v_op.order_id);
    SELECT * INTO v_op FROM public.order_overpayments WHERE id = v_op.id FOR UPDATE;
    v_take := least(v_op.refund_minor - public.issue_4522_overpayment_committed_minor(v_op.id), v_left,
                    public.issue_4522_overpayment_max_refund_part());
    CONTINUE WHEN v_take <= 0;
    SELECT * INTO v_row FROM public.order_installments WHERE id = v_op.installment_id;
    SELECT COALESCE(max(attempt_no), 0) + 1 INTO v_attempt_no
      FROM public.order_overpayment_refund_attempts WHERE overpayment_id = v_op.id;
    INSERT INTO public.refunds (order_id, amount_cents, reason, status, currency,
      stripe_payment_intent_id, stripe_charge_id, metadata, order_installment_id, buyer_refund_status)
    VALUES (v_op.order_id, v_take::integer, 'Overpayment returned by a refund made at the provider', 'pending',
      v_op.currency, CASE WHEN v_op.provider = 'stripe' THEN v_row.stripe_payment_intent_id END,
      CASE WHEN v_op.provider = 'stripe' THEN v_row.stripe_charge_id END,
      jsonb_build_object('source', 'issue_4522_overpayment', 'overpayment_id', v_op.id,
        'attempt_no', v_attempt_no, 'reason', v_op.reason, 'origin', 'provider_match',
        'provider_refund_id', p_provider_refund_id, 'provider_refund_amount_minor', p_amount_minor),
      v_op.installment_id, 'provider_pending')
    RETURNING id INTO v_refund_id;
    INSERT INTO public.order_overpayment_refund_attempts (overpayment_id, attempt_no, origin, amount_minor,
      state, refund_id, provider_refund_id, created_at, updated_at)
    VALUES (v_op.id, v_attempt_no, 'provider_match', v_take, 'pending', v_refund_id, p_provider_refund_id, p_now, p_now)
    RETURNING id INTO v_att_id;
    UPDATE public.order_overpayments
       SET state = 'refund_pending', refund_attempt_no = v_attempt_no, refund_id = v_refund_id, updated_at = p_now
     WHERE id = v_op.id;
    v_res := CASE WHEN p_status = 'succeeded'
      THEN public.issue_4522_apply_overpayment_attempt_outcome(v_att_id, 'succeeded', p_provider_refund_id, NULL, p_now)
      ELSE jsonb_build_object('ok', true, 'changed', true, 'state', 'refund_pending', 'attemptNo', v_attempt_no,
             'attemptState', 'pending') END;
    v_results := v_results || jsonb_build_array(v_res || jsonb_build_object('overpaymentId', v_op.id,
      'orderId', v_op.order_id, 'installmentId', v_op.installment_id, 'currency', trim(v_op.currency),
      'providerRef', v_op.provider_ref, 'refundMinor', v_op.refund_minor, 'allocatedMinor', v_take));
    v_left := v_left - v_take;
  END LOOP;
  IF jsonb_array_length(v_results) = 0 THEN
    RETURN jsonb_build_object('handled', false);
  END IF;
  RETURN jsonb_build_object('handled', true, 'matchedBy', 'provider_charge', 'results', v_results,
    'allocatedMinor', p_amount_minor - v_left);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_overpayment_refund_event(text, text, text, bigint, text, uuid, integer, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_overpayment_refund_event(text, text, text, bigint, text, uuid, integer, boolean, timestamptz) TO service_role;

-- T3-2: the ops actions that resolve a stopped overpayment (service role;
-- the ops alert names them). Refused while a refund is open at the provider.
--   retry            — automatic refunding starts again (needs_ops or
--                      refund_failed → held; the failure count restarts).
--                      Rework 7: the ONLY way a second-provider overpayment
--                      gets another create after an unanswered one (ops
--                      checked the dashboard: provider_refund_unconfirmed).
--   refunded_by_hand — ops returned the remaining money outside the lane
--                      (p_provider_refund_id names that refund): recorded
--                      as returned, in parts that fit a refund row.
CREATE FUNCTION public.issue_4522_resolve_overpayment_by_ops(
  p_overpayment_id uuid,
  p_action text,
  p_actor uuid,
  p_provider_refund_id text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_op public.order_overpayments;
  v_remaining bigint;
  v_part bigint;
  v_attempt_no integer;
  v_refund_id uuid;
  v_att_id uuid;
  v_res jsonb;
  v_k integer := 0;
  v_closed boolean := false;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('retry', 'refunded_by_hand') THEN
    RAISE EXCEPTION 'overpayment_ops_action_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_op FROM public.order_overpayments WHERE id = p_overpayment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_op.order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'overpayment_not_found');
  END IF;
  SELECT * INTO v_op FROM public.order_overpayments WHERE id = p_overpayment_id FOR UPDATE;
  IF v_op.state IN ('refunded', 'applied') THEN
    RETURN jsonb_build_object('ok', true, 'done', true, 'state', v_op.state);
  END IF;
  -- Rework 7: ops found no refund at the provider for a second-provider
  -- refund it was told is unconfirmed: that attempt is closed as never
  -- created, so the lane (which re-reads the charge's refunds first) may send
  -- again. Only when every open attempt is such an unconfirmed one.
  IF p_action = 'retry' AND v_op.state = 'needs_ops' AND v_op.provider = 'paystack'
     AND v_op.detail ? 'unconfirmed_alerted_at'
     AND NOT EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts
                      WHERE overpayment_id = v_op.id AND state IN ('creating', 'pending')
                        AND NOT (state = 'creating' AND provider_refund_id IS NULL
                                 AND created_at <= p_now - public.issue_4522_flex_in_flight_ceiling())) THEN
    FOR v_att_id IN SELECT id FROM public.order_overpayment_refund_attempts
                     WHERE overpayment_id = v_op.id AND state = 'creating' ORDER BY attempt_no LOOP
      PERFORM public.issue_4522_apply_overpayment_attempt_outcome(v_att_id, 'not_found', NULL,
        'ops_retry: no refund at the provider', p_now);
      v_closed := true;
    END LOOP;
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_overpayment_refund_attempts
              WHERE overpayment_id = v_op.id AND state IN ('creating', 'pending'))
     -- T7-2: an extra refund still pending at the provider may yet complete.
     OR EXISTS (SELECT 1 FROM public.order_overpayments
                 WHERE id = v_op.id AND detail->'over_refunded' @> '[{"status": "pending"}]'::jsonb) THEN
    RAISE EXCEPTION 'overpayment_refund_open_at_provider' USING ERRCODE = 'PT409';
  END IF;
  IF p_action = 'retry' THEN
    IF v_op.state NOT IN ('needs_ops', 'refund_failed') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_stopped', 'state', v_op.state);
    END IF;
    UPDATE public.order_overpayments
       SET state = 'held', needs_ops_reason = NULL, consecutive_failures = 0, next_attempt_at = NULL,
           ops_alerted_at = NULL, updated_at = p_now,
           detail = (detail - 'unconfirmed_alerted_at') || jsonb_build_object('ops_retry_at', p_now, 'ops_retry_by', p_actor)
                    -- Rework 9 (T8-1): an unanswered refund was closed as never
                    -- created: the charge is watched for it (see begin).
                    || CASE WHEN v_closed THEN jsonb_build_object('retry_watch_from', p_now) ELSE '{}'::jsonb END
     WHERE id = v_op.id;
    PERFORM public.issue_3645_audit_installment(v_op.installment_id, 'tr3.installment_overpayment_ops_retry',
      jsonb_build_object('overpayment_id', v_op.id, 'actor', p_actor, 'note', left(COALESCE(p_note, ''), 300)));
    RETURN jsonb_build_object('ok', true, 'state', 'held');
  END IF;
  IF p_provider_refund_id IS NULL OR btrim(p_provider_refund_id) = '' THEN
    RAISE EXCEPTION 'provider_refund_id_required' USING ERRCODE = '22023';
  END IF;
  v_remaining := v_op.refund_minor - public.issue_4522_overpayment_committed_minor(v_op.id);
  WHILE v_remaining > 0 LOOP
    v_k := v_k + 1;
    v_part := least(v_remaining, public.issue_4522_overpayment_max_refund_part());
    SELECT COALESCE(max(attempt_no), 0) + 1 INTO v_attempt_no
      FROM public.order_overpayment_refund_attempts WHERE overpayment_id = v_op.id;
    INSERT INTO public.refunds (order_id, amount_cents, reason, status, currency, metadata,
      order_installment_id, buyer_refund_status)
    VALUES (v_op.order_id, v_part::integer, 'Overpayment returned by hand by Mingla ops', 'pending', v_op.currency,
      jsonb_build_object('source', 'issue_4522_overpayment', 'overpayment_id', v_op.id, 'attempt_no', v_attempt_no,
        'reason', v_op.reason, 'origin', 'ops', 'actor', p_actor, 'note', left(COALESCE(p_note, ''), 300)),
      v_op.installment_id, 'provider_pending')
    RETURNING id INTO v_refund_id;
    INSERT INTO public.order_overpayment_refund_attempts (overpayment_id, attempt_no, origin, amount_minor,
      state, refund_id, provider_refund_id, created_at, updated_at)
    VALUES (v_op.id, v_attempt_no, 'ops', v_part, 'pending', v_refund_id,
      btrim(p_provider_refund_id) || CASE WHEN v_k > 1 THEN '#' || v_k ELSE '' END,
      p_now, p_now)
    RETURNING id INTO v_att_id;
    v_res := public.issue_4522_apply_overpayment_attempt_outcome(v_att_id, 'succeeded', NULL, NULL, p_now);
    v_remaining := v_remaining - v_part;
  END LOOP;
  UPDATE public.order_overpayments SET resolved_by = p_actor WHERE id = v_op.id;
  RETURN jsonb_build_object('ok', true, 'state', (SELECT state FROM public.order_overpayments WHERE id = v_op.id));
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_resolve_overpayment_by_ops(uuid, text, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_resolve_overpayment_by_ops(uuid, text, uuid, text, text, timestamptz) TO service_role;

-- The overpayments of one order, for the buyer, host and Admin views.
CREATE FUNCTION public.issue_4522_order_overpayments(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('overpaymentId', id, 'state', state,
           'reason', reason, 'refundMinor', refund_minor, 'amountMinor', amount_minor,
           'returnedMinor', public.issue_4522_overpayment_returned_minor(id),
           'needsOpsReason', needs_ops_reason,
           'currency', trim(currency), 'createdAt', created_at, 'resolvedAt', resolved_at,
           'attempts', refund_attempt_no) ORDER BY created_at, id), '[]'::jsonb)
    FROM public.order_overpayments WHERE order_id = p_order_id
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_order_overpayments(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- N7: the one paid-in-full email per order. True only for the first claim.
CREATE FUNCTION public.issue_4522_claim_paid_in_full_notice(p_order_id uuid, p_source text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_installments
              WHERE order_id = p_order_id AND status IN ('scheduled', 'failed')) THEN
    RETURN false;
  END IF;
  INSERT INTO public.order_paid_in_full_notices (order_id, source)
  VALUES (p_order_id, left(COALESCE(p_source, 'unknown'), 60))
  ON CONFLICT (order_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_claim_paid_in_full_notice(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_claim_paid_in_full_notice(uuid, text) TO service_role;

-- A planned row whose provider charge can still land: a Paystack attempt
-- in flight, or a Stripe PaymentIntent of its current attempt.
CREATE FUNCTION public.issue_4522_row_in_flight(p_installment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.order_installments oi
                  WHERE oi.id = p_installment_id
                    AND (oi.in_flight_attempt_id IS NOT NULL
                         OR public.issue_4522_stripe_charge_in_flight(oi.provider, oi.status,
                              oi.stripe_payment_intent_id, oi.next_retry_at)))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_row_in_flight(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Rebalance (spec §6.3). Caller holds the order graph lock. Moves money
--    only between open rows of kind 'scheduled'; the latest due date never
--    drops; every changed row bumps schedule_version and loses its notice
--    claim; one order_balance_events row records before and after.
--    p_paid: [{ticket_type_id, net_minor, addon_minor}] leaving the balance.
--    p_rolled_in_row: a superseded missed row whose amount joins later rows.
-- ---------------------------------------------------------------------------
-- I-4522-NEVER-WRITE-OFF: a v2 order whose whole open balance is above zero
-- but below the provider's minimum charge
-- (issue_3355_provider_minimum_charge_minor) cannot be charged: the provider
-- refuses it. It is never written off ("Mingla must never lose money"): it
-- stays owed (never paid in full; payouts as for any open balance), is never
-- sent to the provider, failed, dunned or flagged at risk, and ops are told
-- once. This audits the leftover once per order and amount and returns the
-- amount the first time (the caller alerts ops), 0 otherwise or when the rule
-- does not apply (strictly below the floor; never while a charge can still
-- land). The caller holds the order's locks.
CREATE FUNCTION public.issue_4522_flag_unchargeable_remainder(p_order_id uuid, p_source text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders;
  v_floor bigint;
  v_rem bigint;
  v_charge bigint;
  v_first uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) <> 2 THEN
    RETURN 0;
  END IF;
  v_floor := COALESCE(public.issue_3355_provider_minimum_charge_minor(v_order.currency), 0);
  SELECT COALESCE(sum(amount_cents), 0), COALESCE(sum(COALESCE(buyer_total_cents, amount_cents)), 0)
    INTO v_rem, v_charge
    FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
  IF v_rem <= 0 OR v_rem >= v_floor OR v_charge >= v_floor
     OR public.issue_4522_order_has_open_flex(p_order_id)
     OR EXISTS (SELECT 1 FROM public.order_installments
                 WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
                   AND public.issue_4522_row_in_flight(id)) THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_log a
               JOIN public.order_installments oi ON a.target_id = oi.id::text
              WHERE a.target_type = 'order_installment' AND oi.order_id = p_order_id
                AND a.action = 'tr3.installment_below_provider_minimum_owed'
                AND (a.after->>'amount_minor')::bigint = v_rem) THEN
    RETURN 0;
  END IF;
  SELECT id INTO v_first FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
   ORDER BY due_at, id LIMIT 1;
  PERFORM public.issue_3645_audit_installment(v_first, 'tr3.installment_below_provider_minimum_owed',
    jsonb_build_object('order_id', p_order_id, 'amount_minor', v_rem, 'currency', trim(v_order.currency),
      'provider_minimum_minor', v_floor, 'source', p_source));
  RETURN v_rem;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_flag_unchargeable_remainder(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_4522_rebalance_order(
  p_order_id uuid,
  p_reason text,
  p_trigger_installment_id uuid,
  p_actor uuid,
  p_paid jsonb DEFAULT '[]'::jsonb,
  p_rolled_in_row uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_unit constant bigint := 100;
  v_order public.orders;
  v_roll public.order_installments;
  v_min bigint;
  v_before jsonb;
  v_after jsonb;
  v_dates timestamptz[];
  v_n integer;
  v_r2 bigint;
  v_old_sum bigint;
  v_old_bt bigint;
  v_old_fee bigint;
  v_old_ref bigint;
  v_new_bt_total bigint;
  v_new_fee_total bigint;
  v_new_ref_total bigint;
  v_line record;
  v_rows uuid[];
  v_row_dates timestamptz[];
  v_k integer;
  v_trip bigint;
  v_addon bigint;
  v_tbase bigint;
  v_abase bigint;
  v_id uuid;
  v_amt bigint;
  v_add bigint;
  v_keep integer;
  v_bt_run bigint := 0;
  v_fee_run bigint := 0;
  v_ref_run bigint := 0;
  v_last_kept uuid;
  v_floor bigint;
  v_big uuid;
  v_kept_count integer := 0;
  v_kept_seen integer := 0;
  v_has_bt boolean;
BEGIN
  IF p_reason NOT IN ('flex_payment', 'missed_rollover', 'addon_removed', 'host_adjust') THEN
    RAISE EXCEPTION 'rebalance_reason_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF p_rolled_in_row IS NOT NULL THEN
    SELECT * INTO v_roll FROM public.order_installments WHERE id = p_rolled_in_row AND order_id = p_order_id;
  END IF;
  -- #3645 provider floor (issue_3355_provider_minimum_charge_minor, the SQL
  -- mirror of _shared/money/providerMinimums.ts): a re-spread never splits
  -- into rows the provider cannot charge (₦100 on Paystack, 50¢ on Stripe).
  v_min := greatest(
    CASE WHEN COALESCE((v_order.payment_plan_terms->>'flex_enabled')::boolean, false)
         THEN COALESCE((v_order.payment_plan_terms->>'min_payment_minor')::bigint, c_unit)
         ELSE c_unit END,
    COALESCE(public.issue_3355_provider_minimum_charge_minor(v_order.currency), 0));
  v_floor := COALESCE(public.issue_3355_provider_minimum_charge_minor(v_order.currency), 0);

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.i4522_open (
    id uuid, ticket_type_id uuid, due_at timestamptz, amount bigint, addon bigint,
    bt bigint, fee bigint, ref bigint) ON COMMIT DROP;
  -- WHERE true: hosted PostgREST sessions (service_role, authenticated, anon)
  -- preload pg-safeupdate, which rejects a DELETE with no WHERE clause even
  -- on a temp table (same trap as #4238's ad_list_cand).
  DELETE FROM pg_temp.i4522_open WHERE true;
  INSERT INTO pg_temp.i4522_open
  SELECT oi.id, oi.ticket_type_id, oi.due_at, oi.amount_cents, oi.addon_portion_minor,
         oi.buyer_total_cents, oi.planned_application_fee_cents, oi.referral_share_minor
    FROM public.order_installments oi
   WHERE oi.order_id = p_order_id AND oi.kind = 'scheduled' AND oi.status IN ('scheduled', 'failed')
     AND (p_rolled_in_row IS NULL OR oi.due_at > v_roll.due_at)
     -- A flexible payment, and a missed payment rolled in, are placed around
     -- a row whose provider charge can still land: it keeps its amount (the
     -- charge was fixed for exactly that amount when the row was marked in
     -- flight), so what lands is what the row owes and the moved money goes
     -- to rows not being charged (I-4522-CHARGE-IS-WHAT-IS-OWED).
     AND (p_reason NOT IN ('flex_payment', 'missed_rollover') OR NOT public.issue_4522_row_in_flight(oi.id));
  -- Any other re-spread (an add-on removed): a row whose provider charge can
  -- still land keeps its amount, so the re-spread waits (PT409) and its
  -- caller retries.
  IF EXISTS (SELECT 1 FROM pg_temp.i4522_open o WHERE public.issue_4522_row_in_flight(o.id)) THEN
    RAISE EXCEPTION 'balance_payment_in_flight' USING ERRCODE = 'PT409';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'ordinal', oi.ordinal, 'due_at', oi.due_at,
           'amount_cents', oi.amount_cents, 'addon_portion_minor', oi.addon_portion_minor,
           'status', oi.status, 'schedule_version', oi.schedule_version) ORDER BY oi.due_at, oi.id), '[]')
    INTO v_before FROM public.order_installments oi
   WHERE oi.order_id = p_order_id AND oi.kind = 'scheduled' AND oi.status IN ('scheduled', 'failed');

  -- Per line: R2 = open + rolled in - paid (trip and add-on parts separately).
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.i4522_line (
    ticket_type_id uuid, trip bigint, addon bigint) ON COMMIT DROP;
  DELETE FROM pg_temp.i4522_line WHERE true; -- pg-safeupdate: see above
  INSERT INTO pg_temp.i4522_line
  SELECT t.ticket_type_id, sum(t.trip), sum(t.addon) FROM (
    SELECT ticket_type_id, amount - addon AS trip, addon FROM pg_temp.i4522_open
    UNION ALL
    SELECT v_roll.ticket_type_id, v_roll.amount_cents - v_roll.addon_portion_minor, v_roll.addon_portion_minor
     WHERE p_rolled_in_row IS NOT NULL
    UNION ALL
    SELECT (x->>'ticket_type_id')::uuid, -(x->>'net_minor')::bigint, -(x->>'addon_minor')::bigint
      FROM jsonb_array_elements(COALESCE(p_paid, '[]'::jsonb)) x
  ) t GROUP BY t.ticket_type_id;
  IF EXISTS (SELECT 1 FROM pg_temp.i4522_line WHERE trip < 0 OR addon < 0)
     OR (p_rolled_in_row IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_temp.i4522_open)) THEN
    RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
  END IF;
  -- T4-3: a package left owing less than the provider can charge joins the
  -- package owing the most (its rows go; nothing is lost or created).
  SELECT ticket_type_id INTO v_big FROM pg_temp.i4522_line WHERE trip + addon > 0
   ORDER BY trip + addon DESC, ticket_type_id NULLS LAST LIMIT 1;
  UPDATE pg_temp.i4522_line b
     SET trip = b.trip + s.trip, addon = b.addon + s.addon
    FROM (SELECT sum(trip) AS trip, sum(addon) AS addon FROM pg_temp.i4522_line
           WHERE trip + addon > 0 AND trip + addon < v_floor AND ticket_type_id IS DISTINCT FROM v_big) s
   WHERE s.trip IS NOT NULL AND b.ticket_type_id IS NOT DISTINCT FROM v_big;
  IF FOUND THEN
    UPDATE pg_temp.i4522_line SET trip = 0, addon = 0
     WHERE trip + addon > 0 AND trip + addon < v_floor AND ticket_type_id IS DISTINCT FROM v_big;
  END IF;
  SELECT COALESCE(sum(trip + addon), 0) INTO v_r2 FROM pg_temp.i4522_line;
  SELECT COALESCE(sum(amount), 0), sum(bt), sum(fee), COALESCE(sum(ref), 0), bool_and(bt IS NOT NULL)
    INTO v_old_sum, v_old_bt, v_old_fee, v_old_ref, v_has_bt FROM pg_temp.i4522_open;

  -- Dates: drop the earliest while a whole-unit split falls under the minimum.
  SELECT array_agg(DISTINCT due_at ORDER BY due_at) INTO v_dates FROM pg_temp.i4522_open;
  v_n := COALESCE(array_length(v_dates, 1), 0);
  WHILE v_n > 1 AND (v_r2 / v_n) / c_unit * c_unit < v_min LOOP
    v_dates := v_dates[2:v_n];
    v_n := v_n - 1;
  END LOOP;

  -- New totals for the provider-locked price, the planned fee and the referral share.
  IF v_old_sum > 0 THEN
    v_new_bt_total := CASE WHEN v_has_bt THEN floor(v_old_bt::numeric * v_r2 / v_old_sum)::bigint END;
    v_new_fee_total := CASE WHEN v_old_fee IS NOT NULL THEN floor(v_old_fee::numeric * v_r2 / v_old_sum)::bigint END;
    v_new_ref_total := least(floor(v_old_ref::numeric * v_r2 / v_old_sum)::bigint, v_r2);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.i4522_new (
    id uuid, amount bigint, addon bigint) ON COMMIT DROP;
  DELETE FROM pg_temp.i4522_new WHERE true; -- pg-safeupdate: see above
  IF v_r2 > 0 THEN
    FOR v_line IN SELECT * FROM pg_temp.i4522_line WHERE trip + addon > 0 ORDER BY ticket_type_id NULLS LAST LOOP
      SELECT array_agg(o.id ORDER BY o.due_at, o.id), array_agg(o.due_at ORDER BY o.due_at, o.id)
        INTO v_rows, v_row_dates
        FROM pg_temp.i4522_open o
       WHERE o.ticket_type_id IS NOT DISTINCT FROM v_line.ticket_type_id AND o.due_at = ANY (v_dates);
      IF v_rows IS NULL THEN
        -- The line's own dates all dropped: its latest row keeps the balance.
        SELECT array_agg(o.id), array_agg(o.due_at) INTO v_rows, v_row_dates FROM (
          SELECT o.id, o.due_at FROM pg_temp.i4522_open o
           WHERE o.ticket_type_id IS NOT DISTINCT FROM v_line.ticket_type_id
           ORDER BY o.due_at DESC, o.id DESC LIMIT 1) o;
      END IF;
      IF v_rows IS NULL THEN
        RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
      END IF;
      v_keep := array_length(v_rows, 1);
      -- T4-3: never split a package into rows the provider cannot charge.
      WHILE v_keep > 1 AND (v_line.trip / v_keep) / c_unit * c_unit + (v_line.addon / v_keep) / c_unit * c_unit < v_floor LOOP
        v_rows := v_rows[2:v_keep];
        v_keep := v_keep - 1;
      END LOOP;
      v_tbase := (v_line.trip / v_keep) / c_unit * c_unit;
      v_abase := (v_line.addon / v_keep) / c_unit * c_unit;
      FOR v_k IN 1..v_keep LOOP
        v_trip := CASE WHEN v_k < v_keep THEN v_tbase ELSE v_line.trip - v_tbase * (v_keep - 1) END;
        v_addon := CASE WHEN v_k < v_keep THEN v_abase ELSE v_line.addon - v_abase * (v_keep - 1) END;
        IF v_trip + v_addon <= 0 THEN
          RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO pg_temp.i4522_new VALUES (v_rows[v_k], v_trip + v_addon, v_addon);
      END LOOP;
    END LOOP;
  END IF;

  -- Dropped (or emptied) rows: superseded. Their pay links stop working.
  UPDATE public.order_installments oi
     SET status = 'superseded', superseded_at = now(), next_retry_at = NULL, updated_at = now()
    FROM pg_temp.i4522_open o
   WHERE oi.id = o.id AND NOT EXISTS (SELECT 1 FROM pg_temp.i4522_new n WHERE n.id = o.id);
  UPDATE public.order_installment_pay_links l
     SET revoked_at = now(), revoked_reason = 'installment_superseded'
    FROM pg_temp.i4522_open o
   WHERE l.installment_id = o.id AND l.revoked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_temp.i4522_new n WHERE n.id = o.id);

  -- Kept rows: new amounts; locked price, planned fee and referral share scale
  -- by the order's ratio, rounded down once, the last kept row absorbing.
  SELECT count(*) INTO v_kept_count FROM pg_temp.i4522_new;
  FOR v_id, v_amt, v_add IN
    SELECT n.id, n.amount, n.addon FROM pg_temp.i4522_new n
      JOIN pg_temp.i4522_open o ON o.id = n.id ORDER BY o.due_at, o.id
  LOOP
    v_kept_seen := v_kept_seen + 1;
    UPDATE public.order_installments
       SET amount_cents = v_amt,
           addon_portion_minor = v_add,
           buyer_total_cents = CASE WHEN v_new_bt_total IS NULL THEN buyer_total_cents
             WHEN v_kept_seen < v_kept_count THEN floor(v_amt::numeric * v_old_bt / v_old_sum)::bigint
             ELSE v_new_bt_total - v_bt_run END,
           planned_application_fee_cents = CASE WHEN v_new_fee_total IS NULL THEN planned_application_fee_cents
             WHEN v_kept_seen < v_kept_count THEN floor(v_amt::numeric * v_old_fee / v_old_sum)::bigint
             ELSE v_new_fee_total - v_fee_run END,
           referral_share_minor = CASE WHEN v_kept_seen < v_kept_count
             THEN least(floor(v_amt::numeric * v_old_ref / v_old_sum)::bigint, v_amt)
             ELSE least(greatest(COALESCE(v_new_ref_total, 0) - v_ref_run, 0), v_amt) END,
           schedule_version = schedule_version + 1,
           pre_charge_notice_sent_at = NULL,
           updated_at = now()
     WHERE id = v_id
     RETURNING buyer_total_cents, planned_application_fee_cents, referral_share_minor
       INTO v_amt, v_add, v_trip;
    v_bt_run := v_bt_run + COALESCE(v_amt, 0);
    v_fee_run := v_fee_run + COALESCE(v_add, 0);
    v_ref_run := v_ref_run + COALESCE(v_trip, 0);
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'ordinal', oi.ordinal, 'due_at', oi.due_at,
           'amount_cents', oi.amount_cents, 'addon_portion_minor', oi.addon_portion_minor,
           'status', oi.status, 'schedule_version', oi.schedule_version) ORDER BY oi.due_at, oi.id), '[]')
    INTO v_after FROM public.order_installments oi
   WHERE oi.order_id = p_order_id AND oi.kind = 'scheduled' AND oi.status IN ('scheduled', 'failed');

  -- I-4522-2: money is conserved.
  IF (SELECT COALESCE(sum((x->>'amount_cents')::bigint), 0) FROM jsonb_array_elements(v_after) x)
     <> (SELECT COALESCE(sum((x->>'amount_cents')::bigint), 0) FROM jsonb_array_elements(v_before) x)
        + COALESCE(v_roll.amount_cents, 0)
        - (SELECT COALESCE(sum((x->>'net_minor')::bigint + (x->>'addon_minor')::bigint), 0)
             FROM jsonb_array_elements(COALESCE(p_paid, '[]'::jsonb)) x) THEN
    RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.order_balance_events (order_id, reason, trigger_installment_id, before, after, actor)
  VALUES (p_order_id, p_reason, p_trigger_installment_id, v_before, v_after, p_actor);

  RETURN jsonb_build_object('remainingMinor', v_r2, 'rows', v_after);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_rebalance_order(uuid, text, uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4522_rebalance_order(uuid, text, uuid, uuid, jsonb, uuid) IS
  'Issue #4522 §6.3: re-spreads an order''s open scheduled rows after a flexible payment (p_paid) or a missed payment rolled in (p_rolled_in_row). Internal; the caller holds the order graph lock.';

-- ---------------------------------------------------------------------------
-- 3. The balance of a v2 order (buyer, host and the balance page read this).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_balance(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders;
  v_event public.events;
  v_remaining bigint;
  v_collected bigint;
  v_flexible boolean;
  v_min bigint;
  v_next jsonb;
  v_floor bigint;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_remaining FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
  -- N5: what counts as paid toward the trip excludes money the plan did not
  -- owe (overpayment held, being returned or returned); it has its own fields.
  SELECT COALESCE(sum(amount_cents), 0) INTO v_collected FROM public.order_installments
   WHERE order_id = p_order_id AND status IN ('collected', 'refunded');
  v_collected := v_collected - (
    SELECT COALESCE(sum(op.amount_minor), 0) FROM public.order_overpayments op
      JOIN public.order_installments oi ON oi.id = op.installment_id
     WHERE op.order_id = p_order_id AND op.reason = 'flex_exceeds_balance'
       AND oi.status IN ('collected', 'refunded'));
  v_floor := COALESCE(public.issue_3355_provider_minimum_charge_minor(v_order.currency), 0);
  v_flexible := COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) = 2
    AND COALESCE((v_order.payment_plan_terms->>'flex_enabled')::boolean, false)
    AND public.issue_4522_plan_v2_enabled()
    AND v_order.cancelled_at IS NULL AND v_event.status <> 'cancelled' AND v_remaining > 0;
  -- #3645: never below the provider floor (same rule as issue_4522_begin_flex_payment).
  v_min := least(greatest(COALESCE((v_order.payment_plan_terms->>'min_payment_minor')::bigint, v_remaining),
                          COALESCE(public.issue_3355_provider_minimum_charge_minor(v_order.currency), 0)),
                 v_remaining);
  SELECT jsonb_build_object(
      'installmentId', min(id::text),
      'dueAt', due_at,
      'amountMinor', sum(amount_cents),
      'status', CASE WHEN bool_or(status = 'failed') THEN 'failed' ELSE 'scheduled' END)
    INTO v_next
    FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
   GROUP BY due_at
   ORDER BY due_at LIMIT 1;
  RETURN jsonb_build_object(
    'orderId', v_order.id,
    'eventId', v_order.event_id,
    'currency', trim(v_order.currency),
    'depositMinor', v_order.total_cents,
    'paidMinor', v_order.total_cents + v_collected,
    'remainingMinor', v_remaining,
    'totalMinor', v_order.total_cents + v_collected + v_remaining,
    'terms', v_order.payment_plan_terms,
    'addonPaymentMode', v_order.addon_payment_mode,
    'canPayAnyAmount', v_flexible,
    'minPaymentMinor', CASE WHEN v_flexible THEN v_min END,
    -- T4-3: a payment short of the whole balance leaves at least the
    -- provider's minimum owing. Allowed: minPaymentMinor .. maxPartialMinor,
    -- or exactly remainingMinor; null = only the whole balance.
    'maxPartialMinor', CASE WHEN v_flexible AND v_remaining - v_floor >= v_min THEN v_remaining - v_floor END,
    -- A remaining balance below this stays owed (never written off): the
    -- traveler is not offered a payment the provider would refuse.
    'providerMinimumMinor', v_floor,
    'paymentInFlight', public.issue_4522_order_has_open_flex(p_order_id)
                       OR public.issue_4522_order_has_open_attempt(p_order_id)
                       OR public.issue_4522_collection_guard(p_order_id) IS NOT DISTINCT FROM 'flex_settlement_pending',
    -- Money collected beyond what was owed that is still being returned to
    -- the traveler (held, refund pending or a failed refund being retried),
    -- in what the traveler gets back; returned money is overpaymentRefundedMinor.
    -- T3-1: what is returned is what the provider completed (a large
    -- overpayment goes back in parts; a stopped one waits for ops).
    'heldCreditMinor', (SELECT COALESCE(sum(refund_minor - public.issue_4522_overpayment_returned_minor(id)), 0)
                          FROM public.order_overpayments
                         WHERE order_id = p_order_id AND state IN ('held', 'refund_pending', 'refund_failed', 'needs_ops')),
    'overpaymentRefundedMinor', (SELECT COALESCE(sum(CASE WHEN state = 'refunded' THEN refund_minor
                                                          ELSE public.issue_4522_overpayment_returned_minor(id) END), 0)
                                   FROM public.order_overpayments
                                  WHERE order_id = p_order_id AND state <> 'applied'),
    'overpayments', public.issue_4522_order_overpayments(p_order_id),
    'nextPayment', v_next,
    'openRows', COALESCE((SELECT jsonb_agg(jsonb_build_object('installmentId', id, 'dueAt', due_at,
        'amountMinor', amount_cents, 'addonPortionMinor', addon_portion_minor,
        'planLineId', ticket_type_id, 'status', status)
        ORDER BY due_at, id) FROM public.order_installments
       WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')), '[]'),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('installmentId', id, 'kind', kind,
        'status', status, 'amountMinor', amount_cents, 'collectedAt', collected_at,
        'refundedMinor', refunded_amount_cents) ORDER BY collected_at, id)
        FROM public.order_installments
       WHERE order_id = p_order_id AND status IN ('collected', 'refunded')), '[]'),
    'balanceEvents', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason,
        'triggerInstallmentId', trigger_installment_id, 'createdAt', created_at,
        'before', before, 'after', after) ORDER BY created_at, id)
        FROM public.order_balance_events WHERE order_id = p_order_id), '[]'));
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_balance(uuid) TO service_role;

-- The buyer (orders.buyer_user_id) or a member of the brand. Anyone else gets
-- the same answer as an order that does not exist.
CREATE FUNCTION public.biz_trip_order_balance(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_buyer uuid;
  v_brand uuid;
  v_uid uuid := auth.uid();
BEGIN
  SELECT o.buyer_user_id, e.brand_id INTO v_buyer, v_brand
    FROM public.orders o JOIN public.events e ON e.id = o.event_id
   WHERE o.id = p_order_id AND e.event_type = 'trip';
  IF NOT FOUND OR v_uid IS NULL
     OR NOT (v_buyer = v_uid OR public.biz_is_brand_member_for_read_for_caller(v_brand)) THEN
    RAISE EXCEPTION 'balance_not_found' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.issue_4522_balance(p_order_id)
    || jsonb_build_object('viewer', CASE WHEN v_buyer = v_uid THEN 'buyer' ELSE 'host' END);
END
$fn$;
REVOKE ALL ON FUNCTION public.biz_trip_order_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_trip_order_balance(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_trip_order_balance(uuid) IS
  'Issue #4522: a v2 trip order''s balance for its buyer or a member of its brand; balance_not_found for anyone else.';

-- ---------------------------------------------------------------------------
-- 4. Begin a flexible payment ("pay any amount"). Service role only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_begin_flex_payment(
  p_order_id uuid,
  p_amount_minor bigint,
  p_expected_remaining_minor bigint,
  p_client_key text,
  p_method text,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_status text;
  v_order public.orders;
  v_existing public.order_installments;
  v_remaining bigint;
  v_provider text;
  v_currency character(3);
  v_bt bigint;
  v_fee bigint;
  v_ref bigint;
  v_alloc jsonb := '[]'::jsonb;
  v_addon_total bigint := 0;
  v_line record;
  v_lines integer;
  v_seen integer := 0;
  v_run bigint := 0;
  v_part bigint;
  v_part_addon bigint;
  v_ordinal integer;
  v_id uuid;
  v_min bigint;
  v_flexible boolean;
  v_next_due bigint;
  v_released jsonb := '[]'::jsonb;
  v_rem_left bigint;
  v_floor bigint;
  v_left bigint;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('auto_card', 'pay_link') THEN
    RAISE EXCEPTION 'invalid_attempt_method' USING ERRCODE = '22023';
  END IF;
  IF p_client_key IS NULL OR char_length(p_client_key) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'flex_client_key_invalid' USING ERRCODE = '22023';
  END IF;
  v_event_status := public.issue_4522_lock_order_graph(p_order_id);
  IF v_event_status IS NULL THEN
    RAISE EXCEPTION 'balance_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'order_cancelled' USING ERRCODE = 'P0001'; END IF;
  IF v_event_status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) <> 2 THEN
    RAISE EXCEPTION 'plan_not_flexible' USING ERRCODE = 'P0001';
  END IF;
  v_flexible := COALESCE((v_order.payment_plan_terms->>'flex_enabled')::boolean, false);
  IF v_order.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'deposit_not_paid' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4522_plan_v2_enabled() THEN
    RAISE EXCEPTION 'payment_plan_v2_unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- The same key replays the same row, and only the same request: a key
  -- reused for another amount or method is refused and never touches it.
  SELECT * INTO v_existing FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'flex' AND flex_client_key = p_client_key;
  IF FOUND THEN
    IF v_existing.amount_cents IS DISTINCT FROM p_amount_minor
       OR v_existing.collection_method IS DISTINCT FROM p_method THEN
      RAISE EXCEPTION 'flex_client_key_reused' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('installmentId', v_existing.id, 'amountMinor', v_existing.amount_cents,
      'buyerTotalMinor', COALESCE(v_existing.buyer_total_cents, v_existing.amount_cents),
      'currency', trim(v_existing.currency), 'provider', v_existing.provider,
      'status', v_existing.status, 'replayed', true, 'released', '[]'::jsonb);
  END IF;
  -- N3: an earlier flexible payment still open blocks this one, however old:
  -- the edge asks the provider first (issue_4522_flex_payments_to_verify) and
  -- settles or releases it on the provider's answer, then begins again.
  -- 'released' stays in the answer (always empty) for older edge builds.
  IF public.issue_4522_order_has_open_flex(p_order_id, p_now) OR public.issue_4522_order_has_open_attempt(p_order_id)
     OR public.issue_4522_collection_guard(p_order_id) IS NOT DISTINCT FROM 'flex_settlement_pending' THEN
    RAISE EXCEPTION 'balance_payment_in_flight' USING ERRCODE = 'PT409';
  END IF;

  SELECT COALESCE(sum(amount_cents), 0), sum(buyer_total_cents), sum(planned_application_fee_cents),
         COALESCE(sum(referral_share_minor), 0), min(provider), min(currency)
    INTO v_remaining, v_bt, v_fee, v_ref, v_provider, v_currency
    FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
  IF v_remaining IS DISTINCT FROM p_expected_remaining_minor THEN
    RAISE EXCEPTION 'balance_changed' USING ERRCODE = 'PT409', DETAIL = v_remaining::text;
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_amount_minor > v_remaining THEN
    RAISE EXCEPTION 'flex_amount_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_next_due
    FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
     AND due_at = (SELECT min(due_at) FROM public.order_installments
                    WHERE order_id = p_order_id AND kind = 'scheduled'
                      AND status IN ('scheduled', 'failed'));
  IF NOT v_flexible AND p_amount_minor NOT IN (v_next_due, v_remaining) THEN
    RAISE EXCEPTION 'plan_not_flexible' USING ERRCODE = 'P0001';
  END IF;
  -- #3645 (refuse charges below the provider minimum): the smallest flexible
  -- payment is the host's minimum or the provider floor, whichever is larger,
  -- capped at the balance (issue_4522_balance quotes the same number).
  v_min := CASE WHEN v_flexible
    THEN least(greatest(COALESCE((v_order.payment_plan_terms->>'min_payment_minor')::bigint, 0),
                        COALESCE(public.issue_3355_provider_minimum_charge_minor(v_order.currency), 0)),
               v_remaining)
    ELSE 0 END;
  IF p_amount_minor < v_min THEN
    RAISE EXCEPTION 'flex_amount_below_minimum' USING ERRCODE = '22023', DETAIL = v_min::text;
  END IF;
  -- T4-3 (I-4522-FLEX-NO-UNPAYABLE-REMAINDER): pay the whole balance, or
  -- leave at least the provider's minimum owing (issue_4522_balance quotes
  -- maxPartialMinor). A whole balance the provider cannot charge is never
  -- sent (it would be refused) and never written off: it stays owed and ops
  -- are alerted once (I-4522-NEVER-WRITE-OFF).
  v_floor := COALESCE(public.issue_3355_provider_minimum_charge_minor(v_order.currency), 0);
  IF v_flexible AND p_amount_minor < v_remaining AND v_remaining - p_amount_minor < v_floor THEN
    RAISE EXCEPTION 'flex_amount_leaves_unpayable_remainder' USING ERRCODE = '22023',
      DETAIL = greatest(v_remaining - v_floor, 0)::text;
  END IF;
  IF v_remaining < v_floor THEN
    v_left := public.issue_4522_flag_unchargeable_remainder(p_order_id, 'flex_payment');
    RETURN jsonb_build_object('installmentId', NULL, 'belowProviderMinimum', true,
      'remainingMinor', v_remaining, 'alertOps', v_left > 0, 'order_id', p_order_id,
      'amountMinor', 0, 'currency', trim(v_currency), 'provider', v_provider, 'released', '[]'::jsonb);
  END IF;
  IF v_provider = 'stripe' AND p_method <> 'auto_card' THEN
    RAISE EXCEPTION 'invalid_attempt_method' USING ERRCODE = '22023';
  END IF;

  -- Allocate across packages pro rata to each one's open remaining by largest
  -- remainder: every line takes floor(amount × line / R), then the leftover
  -- minor units go one each to the lines with the largest fractional parts
  -- (ties by package order). A line never takes more than it owes, so any
  -- amount from the minimum up to R allocates exactly. The add-on share is
  -- pro rata within each line.
  v_rem_left := p_amount_minor - (
    SELECT COALESCE(sum(floor(p_amount_minor::numeric * l.amt / v_remaining)), 0)::bigint
      FROM (SELECT sum(amount_cents) AS amt FROM public.order_installments
             WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
             GROUP BY ticket_type_id) l);
  FOR v_line IN
    SELECT l.ticket_type_id, l.amt, l.addon,
           floor(p_amount_minor::numeric * l.amt / v_remaining)::bigint AS base,
           row_number() OVER (ORDER BY (p_amount_minor::numeric * l.amt) % v_remaining DESC,
                              l.ticket_type_id NULLS LAST) AS frac_rank
      FROM (SELECT ticket_type_id, sum(amount_cents) AS amt, sum(addon_portion_minor) AS addon
              FROM public.order_installments
             WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
             GROUP BY ticket_type_id) l
     ORDER BY l.ticket_type_id NULLS LAST
  LOOP
    v_part := v_line.base + CASE WHEN v_line.frac_rank <= v_rem_left THEN 1 ELSE 0 END;
    IF v_part > v_line.amt THEN
      RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_run := v_run + v_part;
    CONTINUE WHEN v_part = 0;
    v_part_addon := floor(v_part::numeric * v_line.addon / v_line.amt)::bigint;
    v_addon_total := v_addon_total + v_part_addon;
    v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_line.ticket_type_id, 'net_minor', v_part - v_part_addon, 'addon_minor', v_part_addon));
  END LOOP;
  IF v_run <> p_amount_minor THEN
    RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(max(ordinal), 0) + 1 INTO v_ordinal FROM public.order_installments WHERE order_id = p_order_id;
  -- orch-strict-grep-allow tr3-schedule-currency-pinned — a flexible row takes the currency of the order's own open rows (v_currency), which checkout pinned from the session.
  INSERT INTO public.order_installments (
    order_id, ordinal, amount_cents, currency, due_at, status, provider, collection_method,
    kind, flex_client_key, line_allocation, addon_portion_minor, ticket_type_id,
    referral_share_minor, buyer_total_cents, planned_application_fee_cents, plan_bound_at
  ) VALUES (
    p_order_id, v_ordinal, p_amount_minor, v_currency, p_now, 'scheduled', v_provider, p_method,
    'flex', p_client_key, v_alloc, v_addon_total, NULL,
    least(floor(v_ref::numeric * p_amount_minor / v_remaining)::bigint, p_amount_minor),
    CASE WHEN v_provider = 'paystack' AND v_bt IS NOT NULL
      THEN floor(p_amount_minor::numeric * v_bt / v_remaining)::bigint END,
    CASE WHEN v_fee IS NOT NULL THEN floor(p_amount_minor::numeric * v_fee / v_remaining)::bigint END,
    CASE WHEN v_provider = 'paystack' THEN p_now END
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('installmentId', v_id, 'amountMinor', p_amount_minor,
    'buyerTotalMinor', CASE WHEN v_provider = 'paystack' AND v_bt IS NOT NULL
      THEN floor(p_amount_minor::numeric * v_bt / v_remaining)::bigint ELSE p_amount_minor END,
    'currency', trim(v_currency), 'provider', v_provider, 'status', 'scheduled',
    'remainingBeforeMinor', v_remaining, 'replayed', false, 'released', v_released);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_begin_flex_payment(uuid, bigint, bigint, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_begin_flex_payment(uuid, bigint, bigint, text, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Settle a collected flexible payment: rebalance once (idempotent).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_settle_flex_payment(p_installment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_row public.order_installments;
  v_result jsonb;
  v_applied jsonb;
  v_applied_total bigint;
  v_before_remaining bigint;
  v_after_remaining bigint;
BEGIN
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_row FROM public.order_installments WHERE id = p_installment_id FOR UPDATE;
  IF v_row.kind <> 'flex' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_flex');
  END IF;
  IF v_row.status <> 'collected' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_collected', 'status', v_row.status);
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_balance_events
              WHERE trigger_installment_id = p_installment_id AND reason = 'flex_payment') THEN
    SELECT jsonb_build_object('ok', true, 'replayed', true,
             'remainingMinor', COALESCE(sum(amount_cents), 0),
             'paidInFull', COALESCE(sum(amount_cents), 0) = 0,
             'completedBalance', false, 'orderId', v_order_id)
      INTO v_result FROM public.order_installments
     WHERE order_id = v_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
    RETURN v_result;
  END IF;
  -- Apply the payment only up to what each package still owes: a planned
  -- charge may have landed after this payment began (two charges racing).
  -- Anything beyond is held as an overpayment, never raised (a webhook must
  -- not retry forever) and never charged again by the cron.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ticket_type_id', a.ticket_type_id,
           'net_minor', a.applied_net, 'addon_minor', a.applied_addon) ORDER BY a.ord), '[]'::jsonb),
         COALESCE(sum(a.applied_net + a.applied_addon), 0)
    INTO v_applied, v_applied_total
    FROM (
      SELECT x.ord, x.ticket_type_id, x.applied_total - least(x.applied_total - least(x.addon, x.open_addon), x.open_trip) AS applied_addon,
             least(x.applied_total - least(x.addon, x.open_addon), x.open_trip) AS applied_net
        FROM (
          SELECT p.ord, p.ticket_type_id, p.net, p.addon,
                 COALESCE(o.open_trip, 0) AS open_trip, COALESCE(o.open_addon, 0) AS open_addon,
                 least(p.net + p.addon, COALESCE(o.open_trip, 0) + COALESCE(o.open_addon, 0)) AS applied_total
            FROM (SELECT ord, (e->>'ticket_type_id')::uuid AS ticket_type_id,
                         greatest(COALESCE((e->>'net_minor')::bigint, 0), 0) AS net,
                         greatest(COALESCE((e->>'addon_minor')::bigint, 0), 0) AS addon
                    FROM jsonb_array_elements(COALESCE(v_row.line_allocation, '[]'::jsonb)) WITH ORDINALITY t(e, ord)) p
            LEFT JOIN (SELECT ticket_type_id, sum(amount_cents - addon_portion_minor) AS open_trip,
                              sum(addon_portion_minor) AS open_addon
                         FROM public.order_installments
                        WHERE order_id = v_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
                          -- a row whose own charge can still land is not paid by this payment
                          AND NOT public.issue_4522_row_in_flight(id)
                        GROUP BY ticket_type_id) o
              ON o.ticket_type_id IS NOT DISTINCT FROM p.ticket_type_id) x
       WHERE x.applied_total > 0) a;
  IF v_row.amount_cents > v_applied_total THEN
    PERFORM public.issue_4522_hold_overpayment(p_installment_id, 'flex_exceeds_balance',
      v_row.amount_cents - v_applied_total,
      COALESCE(v_row.stripe_payment_intent_id, v_row.provider_transaction_id),
      jsonb_build_object('allocated', v_row.line_allocation, 'applied', v_applied));
  END IF;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_before_remaining FROM public.order_installments
   WHERE order_id = v_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
  v_result := public.issue_4522_rebalance_order(v_order_id, 'flex_payment', p_installment_id, NULL,
    v_applied, NULL);
  -- What is still owed, in-flight rows included (they keep their amounts).
  SELECT COALESCE(sum(amount_cents), 0) INTO v_after_remaining FROM public.order_installments
   WHERE order_id = v_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
  IF v_after_remaining = 0 THEN
    UPDATE public.order_balance_links SET revoked_at = now(), revoked_reason = 'paid_in_full'
     WHERE order_id = v_order_id AND revoked_at IS NULL;
  END IF;
  -- The split between paid and overpaid is now known: lift the payout hold
  -- unless part of this payment is being returned.
  PERFORM public.issue_4522_sync_row_payout_hold(p_installment_id);
  RETURN jsonb_build_object('ok', true, 'replayed', false,
    'remainingMinor', v_after_remaining,
    'paidInFull', v_after_remaining = 0,
    -- N7: this settlement is the one that completed the balance.
    'completedBalance', v_before_remaining > 0 AND v_after_remaining = 0,
    'orderId', v_order_id,
    'heldMinor', v_row.amount_cents - v_applied_total);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_settle_flex_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_settle_flex_payment(uuid) TO service_role;

-- A failed flexible payment is closed (superseded, failure kept) so the
-- one-open-flex index frees; it is never retried.
CREATE FUNCTION public.issue_4522_close_failed_flex(p_installment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_n integer;
BEGIN
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  UPDATE public.order_installments
     SET status = 'superseded', superseded_at = now(), next_retry_at = NULL,
         in_flight_attempt_id = NULL, updated_at = now()
   WHERE id = p_installment_id AND kind = 'flex' AND status IN ('failed', 'scheduled');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n = 1, 'closed', v_n = 1);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_close_failed_flex(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_close_failed_flex(uuid) TO service_role;

-- A provider success for a row that is no longer open. Idempotent; the
-- webhook acks only on ok = true.
--   * a flexible payment that was released (abandoned past the window) or
--     closed after a failure, then confirmed late: it is collected and
--     settled like any flexible payment (anything beyond the balance is held);
--   * a planned row superseded while its charge was landing: the whole
--     charge is held as an overpayment (never kept, never paid out).
-- A cancelled row is not handled here (the caller's existing recovery).
CREATE FUNCTION public.issue_4522_record_late_collection(
  p_installment_id uuid,
  p_amount_minor bigint,
  p_provider_ref text,
  p_charge_ref text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_row public.order_installments;
  v_settle jsonb;
  v_held uuid;
BEGIN
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_row FROM public.order_installments WHERE id = p_installment_id FOR UPDATE;
  IF v_row.status = 'collected' THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'already_collected', 'kind', v_row.kind);
  END IF;
  IF v_row.status <> 'superseded' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_superseded', 'status', v_row.status);
  END IF;
  IF v_row.kind = 'flex' THEN
    IF p_amount_minor IS NOT NULL AND p_amount_minor <> v_row.amount_cents
       AND p_amount_minor <> COALESCE(v_row.buyer_total_cents, v_row.amount_cents) THEN
      -- A late success for an amount we never asked for: recorded with the
      -- real amount, returned in full, and flagged for ops. The plan is not
      -- touched (the traveler still owes what they owed). Never a webhook
      -- that retries until the provider gives up.
      v_held := public.issue_4522_hold_overpayment(p_installment_id, 'late_amount_mismatch',
        p_amount_minor, p_provider_ref,
        jsonb_build_object('superseded_at', v_row.superseded_at, 'row_amount_minor', v_row.amount_cents,
          'received_minor', p_amount_minor, 'charge_ref', p_charge_ref), p_amount_minor);
      PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_flex_late_amount_mismatch',
        jsonb_build_object('order_id', v_order_id, 'row_amount_minor', v_row.amount_cents,
          'received_minor', p_amount_minor, 'provider_ref', p_provider_ref));
      RETURN jsonb_build_object('ok', true, 'outcome', 'held', 'kind', v_row.kind,
        'alertOps', v_held IS NOT NULL, 'reason', 'amount_mismatch', 'replayed', v_held IS NULL);
    END IF;
    UPDATE public.order_installments
       SET status = 'collected', superseded_at = NULL, collected_at = p_now,
           failed_at = NULL, failure_reason = NULL, next_retry_at = NULL,
           stripe_payment_intent_id = CASE WHEN provider = 'stripe' THEN COALESCE(p_provider_ref, stripe_payment_intent_id)
                                           ELSE stripe_payment_intent_id END,
           stripe_charge_id = CASE WHEN provider = 'stripe' THEN COALESCE(p_charge_ref, stripe_charge_id)
                                   ELSE stripe_charge_id END,
           updated_at = p_now
     WHERE id = p_installment_id;
    PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_flex_late_collected',
      jsonb_build_object('order_id', v_order_id, 'amount_minor', v_row.amount_cents, 'provider_ref', p_provider_ref));
    v_settle := public.issue_4522_settle_flex_payment(p_installment_id);
    RETURN jsonb_build_object('ok', COALESCE((v_settle->>'ok')::boolean, false), 'outcome', 'flex_collected',
      'kind', 'flex', 'amountMinor', v_row.amount_cents, 'settle', v_settle);
  END IF;
  -- The whole charge is returned: what the provider received, else what the
  -- row would have charged.
  v_held := public.issue_4522_hold_overpayment(p_installment_id, 'superseded_row_collected',
    COALESCE(p_amount_minor, v_row.amount_cents), p_provider_ref,
    jsonb_build_object('superseded_at', v_row.superseded_at, 'row_amount_minor', v_row.amount_cents),
    COALESCE(p_amount_minor, v_row.buyer_total_cents, v_row.amount_cents));
  RETURN jsonb_build_object('ok', true, 'outcome', 'held', 'kind', v_row.kind,
    'replayed', v_held IS NULL);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_record_late_collection(uuid, bigint, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_record_late_collection(uuid, bigint, text, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. "Pay toward your balance" links (raw token never stored; 30 days; one
--    live link per order; revoked when paid in full or cancelled).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_issue_balance_link(
  p_order_id uuid,
  p_token_hash bytea,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_status text;
  v_order public.orders;
  v_id uuid;
  v_expires timestamptz := p_now + interval '30 days';
BEGIN
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid_token_hash' USING ERRCODE = '22023';
  END IF;
  v_event_status := public.issue_4522_lock_order_graph(p_order_id);
  IF v_event_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'balance_not_found');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.cancelled_at IS NOT NULL OR v_event_status = 'cancelled'
     OR COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) <> 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'balance_not_open');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_installments WHERE order_id = p_order_id
                  AND kind = 'scheduled' AND status IN ('scheduled', 'failed')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'paid_in_full');
  END IF;
  UPDATE public.order_balance_links SET revoked_at = p_now, revoked_reason = 'replaced'
   WHERE order_id = p_order_id AND revoked_at IS NULL;
  INSERT INTO public.order_balance_links (order_id, token_hash, expires_at, created_at)
  VALUES (p_order_id, p_token_hash, v_expires, p_now) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'link_id', v_id, 'expires_at', v_expires);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_issue_balance_link(uuid, bytea, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_issue_balance_link(uuid, bytea, timestamptz) TO service_role;

CREATE FUNCTION public.issue_4522_resolve_balance_link(
  p_token_hash bytea,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_link public.order_balance_links;
  v_order public.orders;
  v_event public.events;
BEGIN
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  SELECT * INTO v_link FROM public.order_balance_links WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'invalid'); END IF;
  IF v_link.expires_at <= p_now
     OR (v_link.revoked_at IS NOT NULL AND v_link.revoked_reason IS DISTINCT FROM 'paid_in_full') THEN
    RETURN jsonb_build_object('state', 'expired');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_link.order_id;
  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  UPDATE public.order_balance_links SET open_count = open_count + 1, last_opened_at = p_now
   WHERE id = v_link.id;
  RETURN jsonb_build_object(
    'state', CASE
      WHEN v_order.cancelled_at IS NOT NULL OR v_event.status = 'cancelled' THEN 'no_longer_due'
      WHEN v_link.revoked_reason = 'paid_in_full' THEN 'paid'
      ELSE 'payable' END,
    'order_id', v_order.id,
    'trip_title', v_event.title,
    'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = v_event.brand_id));
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_resolve_balance_link(bytea, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_resolve_balance_link(bytea, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Claim guards (I-4522-4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_order_installment_for_charge(p_installment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inst public.order_installments;
  v_order public.orders;
  v_event_status text;
  v_order_id uuid;
  v_event_id uuid;
  v_guard text;
  v_left bigint;
BEGIN
  IF p_installment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_id_required');
  END IF;

  -- Lightweight reads discover the lock graph without holding row locks yet.
  -- Lock order MUST match cancel_event_refund_prepare: event → order → installment
  -- (otherwise concurrent claim/cancel deadlocks).
  SELECT order_id INTO v_order_id
  FROM public.order_installments
  WHERE id = p_installment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;

  SELECT event_id INTO v_event_id
  FROM public.orders
  WHERE id = v_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  SELECT e.status INTO v_event_status
  FROM public.events e
  WHERE e.id = v_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_missing');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  SELECT * INTO v_inst
  FROM public.order_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;

  -- Re-validate chargeability on the locked rows.
  IF v_inst.status NOT IN ('scheduled', 'failed') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'installment_not_chargeable',
      'status', v_inst.status
    );
  END IF;
  IF v_inst.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_cancelled');
  END IF;
  IF v_order.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  END IF;
  IF v_event_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  END IF;

  -- issue #4522 — a flexible payment is never charged here (it has its own
  -- payment), and no planned row is charged while one is open (I-4522-4).
  IF v_inst.kind = 'flex' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'flex_not_cron_chargeable');
  END IF;
  IF public.issue_4522_order_has_open_flex(v_order.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'flex_payment_in_flight');
  END IF;
  -- Never charge an order whose collected money already covers what it
  -- owes: a flexible payment not yet settled, or an overpayment held.
  v_guard := public.issue_4522_collection_guard(v_order.id);
  IF v_guard IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_guard);
  END IF;
  -- T4-3: a v2 row the provider would refuse as too small is never sent and
  -- never written off: it waits (no charge, no failure, no reminder) and
  -- stays owed; once it is the whole balance, ops are alerted once
  -- (I-4522-NEVER-WRITE-OFF, alertOps).
  IF v_inst.kind = 'scheduled' AND COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) = 2
     AND COALESCE(v_inst.buyer_total_cents, v_inst.amount_cents)
         < COALESCE(public.issue_3355_provider_minimum_charge_minor(v_inst.currency), 0) THEN
    v_left := public.issue_4522_flag_unchargeable_remainder(v_order.id, 'charge_claim');
    RETURN jsonb_build_object('ok', false, 'reason', 'below_provider_minimum',
      'alertOps', v_left > 0, 'remainingMinor', v_left, 'order_id', v_order.id, 'currency', trim(v_inst.currency));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'installment_id', v_inst.id,
    'order_id', v_order.id,
    'event_id', v_order.event_id,
    'status', v_inst.status,
    'retry_count', v_inst.retry_count,
    'amount_cents', v_inst.amount_cents,
    'currency', v_inst.currency
  );
END;
$function$;

-- I-4522-CHARGE-IS-WHAT-IS-OWED: a planned Stripe charge is confirmed only
-- after this marks its row in flight, under the order graph lock (event →
-- order → open rows), for exactly the amount and schedule version the
-- unconfirmed PaymentIntent was created with. The marker is the existing one
-- (the PaymentIntent id on a scheduled row: issue_4522_stripe_charge_in_flight),
-- so from here no rollover, re-spread or flexible payment changes the row
-- until the charge settles. A row that changed since the amount was read is
-- refused (balance_changed): the caller cancels the unconfirmed
-- PaymentIntent and the next run charges the new amount under a new key.
-- Every claim refusal is returned as is. Service role (createInstallmentPI).
CREATE FUNCTION public.issue_4522_mark_stripe_charge_in_flight(
  p_installment_id uuid,
  p_payment_intent_id text,
  p_amount_cents bigint,
  p_schedule_version integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_claim jsonb;
  v_row public.order_installments;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id = '' THEN
    RAISE EXCEPTION 'payment_intent_required' USING ERRCODE = '22023';
  END IF;
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  v_claim := public.claim_order_installment_for_charge(p_installment_id);
  IF NOT COALESCE((v_claim->>'ok')::boolean, false) THEN
    RETURN v_claim;
  END IF;
  SELECT * INTO v_row FROM public.order_installments WHERE id = p_installment_id;
  IF v_row.provider <> 'stripe' OR v_row.status <> 'scheduled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_chargeable', 'status', v_row.status);
  END IF;
  IF v_row.amount_cents IS DISTINCT FROM p_amount_cents
     OR v_row.schedule_version IS DISTINCT FROM p_schedule_version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'balance_changed',
      'amount_cents', v_row.amount_cents, 'schedule_version', v_row.schedule_version);
  END IF;
  UPDATE public.order_installments
     SET stripe_payment_intent_id = p_payment_intent_id, updated_at = now()
   WHERE id = p_installment_id;
  RETURN v_claim || jsonb_build_object('marked', true, 'schedule_version', v_row.schedule_version);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_mark_stripe_charge_in_flight(uuid, text, bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_mark_stripe_charge_in_flight(uuid, text, bigint, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3645_begin_installment_attempt(p_installment_id uuid, p_method text, p_application_fee_cents bigint, p_atrisk_override boolean DEFAULT false, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event_status text;
  v_inst public.order_installments;
  v_order public.orders;
  v_attempt_no integer;
  v_reference text;
  v_attempt_id uuid;
  v_left bigint;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('auto_card', 'pay_link', 'approve') THEN
    RAISE EXCEPTION 'invalid_attempt_method' USING ERRCODE = '22023';
  END IF;
  v_event_status := public.issue_3645_lock_installment_graph(p_installment_id);
  IF v_event_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_inst.order_id;

  IF v_inst.status NOT IN ('scheduled', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_chargeable', 'status', v_inst.status);
  END IF;
  IF v_inst.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_cancelled');
  END IF;
  IF v_order.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  END IF;
  IF v_event_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  END IF;
  IF v_inst.provider <> 'paystack' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_paystack');
  END IF;
  -- issue #4522 — no planned row is charged while a flexible payment is open.
  IF v_inst.kind = 'scheduled' AND public.issue_4522_order_has_open_flex(v_inst.order_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'flex_payment_in_flight');
  END IF;
  IF v_inst.kind = 'scheduled' AND public.issue_4522_collection_guard(v_inst.order_id) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', public.issue_4522_collection_guard(v_inst.order_id));
  END IF;
  IF v_inst.plan_bound_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_bound');
  END IF;
  IF v_inst.buyer_total_cents IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'amount_missing');
  END IF;
  -- T4-3: as claim_order_installment_for_charge — never send a charge the
  -- provider refuses as too small, never write it off.
  IF v_inst.kind = 'scheduled' AND COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) = 2
     AND v_inst.buyer_total_cents < COALESCE(public.issue_3355_provider_minimum_charge_minor(v_inst.currency), 0) THEN
    v_left := public.issue_4522_flag_unchargeable_remainder(v_order.id, 'charge_claim');
    RETURN jsonb_build_object('ok', false, 'reason', 'below_provider_minimum',
      'alertOps', v_left > 0, 'remainingMinor', v_left, 'order_id', v_order.id, 'currency', trim(v_inst.currency));
  END IF;
  IF v_inst.in_flight_attempt_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_in_flight');
  END IF;
  IF p_method = 'auto_card' AND v_inst.collection_method <> 'auto_card' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_auto_card');
  END IF;
  IF p_method = 'auto_card' AND v_order.at_risk IS TRUE AND NOT coalesce(p_atrisk_override, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_at_risk');
  END IF;
  IF p_application_fee_cents IS NULL OR p_application_fee_cents < 0
     OR p_application_fee_cents > v_inst.buyer_total_cents THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'application_fee_invalid');
  END IF;

  UPDATE public.order_installment_charge_attempts
     SET state = 'superseded', resolved_at = p_now
   WHERE installment_id = p_installment_id AND state = 'paused';

  SELECT coalesce(max(attempt_no), 0) + 1 INTO v_attempt_no
    FROM public.order_installment_charge_attempts
   WHERE installment_id = p_installment_id;
  v_reference := 'mingla-inst-' || p_installment_id::text || '-'
    || CASE p_method WHEN 'auto_card' THEN 'a' WHEN 'pay_link' THEN 'l' ELSE 'p' END
    || v_attempt_no::text;

  INSERT INTO public.order_installment_charge_attempts (
    installment_id, provider, attempt_no, method, reference, state,
    amount_cents, application_fee_cents, created_at
  ) VALUES (
    p_installment_id, 'paystack', v_attempt_no, p_method, v_reference, 'created',
    v_inst.buyer_total_cents, p_application_fee_cents, p_now
  ) RETURNING id INTO v_attempt_id;

  UPDATE public.order_installments
     SET in_flight_attempt_id = v_attempt_id
   WHERE id = p_installment_id;

  PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_paystack_attempt_created',
    jsonb_build_object('attempt_id', v_attempt_id, 'attempt_no', v_attempt_no, 'method', p_method,
      'amount_cents', v_inst.buyer_total_cents));

  RETURN jsonb_build_object(
    'ok', true,
    'attempt_id', v_attempt_id,
    'reference', v_reference,
    'amount_cents', v_inst.buyer_total_cents,
    'application_fee_cents', p_application_fee_cents,
    'attempt_no', v_attempt_no
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.issue_3645_checkpoint_pay_link_installment(p_installment_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event_status text;
  v_inst public.order_installments;
  v_order public.orders;
  v_fail jsonb;
  v_left bigint;
BEGIN
  v_event_status := public.issue_3645_lock_installment_graph(p_installment_id);
  IF v_event_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_inst.order_id;
  IF v_inst.provider <> 'paystack' OR v_inst.collection_method <> 'pay_link' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pay_link');
  END IF;
  IF v_inst.status NOT IN ('scheduled', 'failed') OR v_inst.cancelled_at IS NOT NULL
     OR v_order.cancelled_at IS NOT NULL OR v_event_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_open');
  END IF;
  IF v_inst.in_flight_attempt_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_in_flight');
  END IF;
  -- issue #4522 (I-4522-NEVER-WRITE-OFF) — a v2 row below the provider's
  -- minimum can never be paid by its link, so an unpaid link is not a
  -- failure: no failure counted, no at risk, no dunning, no new link. It
  -- stays owed; once it is the whole balance, ops are alerted once.
  IF v_inst.kind = 'scheduled' AND COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) = 2
     AND COALESCE(v_inst.buyer_total_cents, v_inst.amount_cents)
         < COALESCE(public.issue_3355_provider_minimum_charge_minor(v_inst.currency), 0) THEN
    v_left := public.issue_4522_flag_unchargeable_remainder(v_order.id, 'pay_link_checkpoint');
    RETURN jsonb_build_object('ok', false, 'reason', 'below_provider_minimum',
      'alertOps', v_left > 0, 'remainingMinor', v_left, 'order_id', v_order.id, 'currency', trim(v_inst.currency));
  END IF;
  IF v_inst.retry_count >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_at_risk');
  END IF;
  IF (v_inst.status = 'scheduled' AND v_inst.due_at > p_now)
     OR (v_inst.status = 'failed' AND (v_inst.next_retry_at IS NULL OR v_inst.next_retry_at > p_now)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'checkpoint_not_reached');
  END IF;
  v_fail := public.issue_3645_count_installment_failure(p_installment_id, 'pay_link_unpaid', p_now);
  PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_paystack_' || (v_fail ->> 'outcome'),
    jsonb_build_object('reason', 'pay_link_unpaid', 'retry_count', v_fail -> 'retry_count'));
  RETURN v_fail || jsonb_build_object('ok', true, 'installment_id', p_installment_id, 'order_id', v_inst.order_id);
END
$function$;

COMMIT;
