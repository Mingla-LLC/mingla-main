-- Issue #3645 — instalment refunds, disputes and payouts on both rails (M4 of 4).
--
--   * Event cancellation refunds every collected instalment, not only the
--     deposit (D-2, both rails).
--   * Instalment refunds are their own money: refund rows that return one
--     instalment's payment (refunds.order_installment_id) never count against
--     the deposit's orders.refunded_amount_cents; the per-instalment counter
--     order_installments.refunded_amount_cents is their single truth.
--   * Paystack refund outcomes accept the order_installment source, so a refund
--     after payout opens the post-release debt for that instalment (S-3).
--   * Trip cancel computes each instalment refund on what it charged (S-2).
--   * A Paystack dispute on an instalment reference is stored against it.
--   * The payout sweep's instalment arm uses the row's provider, the charged
--     amount, its refunds and its open disputes (D-3). Still gated by
--     issue_2036_installment_payout_ready() (false).
--
-- Every re-emitted function is copied from its latest definition with only
-- the hunks listed in __tests__/issue_3645_reemit_hunks.ts (structural test).

BEGIN;

-- =============================================================================
-- §1. Schema: progress, attempts and disputes learn the instalment source.
-- =============================================================================
DO $block$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT c.conname, c.conrelid::regclass AS rel
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND ((c.conrelid = 'public.event_cancel_refund_progress'::regclass
             AND pg_get_constraintdef(c.oid) ILIKE '%source_type%')
         OR (c.conrelid = 'public.paystack_refund_attempts'::regclass
             AND pg_get_constraintdef(c.oid) ILIKE '%source_type%')
         OR (c.conrelid = 'public.paystack_disputes'::regclass
             AND c.conname = 'paystack_disputes_single_subject'))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', v_con.rel, v_con.conname);
  END LOOP;
END
$block$;

ALTER TABLE public.event_cancel_refund_progress
  ADD CONSTRAINT event_cancel_refund_progress_source_type_check
  CHECK (source_type IN ('order', 'order_installment'));

ALTER TABLE public.paystack_refund_attempts
  ADD CONSTRAINT paystack_refund_attempts_source_type_check
  CHECK (source_type IN ('order', 'venue_reservation', 'order_installment'));

ALTER TABLE public.paystack_disputes
  ADD COLUMN IF NOT EXISTS order_installment_id uuid NULL
    REFERENCES public.order_installments(id);
CREATE INDEX IF NOT EXISTS idx_paystack_disputes_order_installment_id
  ON public.paystack_disputes (order_installment_id)
  WHERE order_installment_id IS NOT NULL;
ALTER TABLE public.paystack_disputes
  ADD CONSTRAINT paystack_disputes_single_subject CHECK (
    (
      (order_id IS NOT NULL)::integer
      + (venue_reservation_id IS NOT NULL)::integer
      + (rsvp_contribution_id IS NOT NULL)::integer
      + (venue_menu_order_id IS NOT NULL)::integer
      + (order_installment_id IS NOT NULL)::integer
    ) <= 1
  );

-- Per-instalment refund applications (idempotency for the counter). Keyed by
-- (refund, instalment): one trip-cancel refund row covers several payments.
CREATE TABLE IF NOT EXISTS public.order_installment_refund_applications (
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE RESTRICT,
  installment_id uuid NOT NULL REFERENCES public.order_installments(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (refund_id, installment_id)
);
ALTER TABLE public.order_installment_refund_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_installment_refund_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.order_installment_refund_applications TO service_role;

-- =============================================================================
-- §2. Re-emitted functions (latest definitions + authorised hunks only).
-- =============================================================================

-- ---- cancel_event_refund_prepare (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.cancel_event_refund_prepare(p_event_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_brand_id uuid;
  v_provider text;
  v_release record;
  v_temp public.organiser_payout_debts;
  v_total integer;
  v_rsvp_count integer;
  v_run_status text;
  v_pending_ids uuid[];
  v_installments_cancelled integer := 0;
BEGIN
  -- 1. Status-first guard (binding race guard + the SOLE authorization).
  SELECT status, brand_id INTO v_status, v_brand_id
  FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'event_not_cancelled' USING ERRCODE = 'P0002';
  END IF;

  SELECT CASE WHEN b.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END
  INTO v_provider FROM public.brands b WHERE b.id = v_brand_id;
  v_provider := COALESCE(v_provider, 'stripe');

  -- 1b. #3645 PR2 — freeze sales (idempotent).
  UPDATE public.ticket_types
  SET sale_end_at = p_now,
      is_disabled = true,
      updated_at = p_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL
    AND is_hidden IS NOT TRUE
    AND available_online IS TRUE
    AND (
      sale_end_at IS NULL
      OR sale_end_at > p_now
      OR is_disabled IS NOT TRUE
    );

  UPDATE public.events
  SET bookings_closed = true,
      bookings_closed_at = COALESCE(bookings_closed_at, p_now)
  WHERE id = p_event_id
    AND bookings_closed IS NOT TRUE;

  -- 1c. #3645 PR5 / #2030 — cancel scheduled/failed installments on this event's
  --     orders (mirror biz_cancel_trip_booking_begin). Collected rows stay.
  UPDATE public.order_installments oi
  SET status = 'cancelled',
      cancelled_at = p_now
  FROM public.orders o
  WHERE o.id = oi.order_id
    AND o.event_id = p_event_id
    AND oi.status IN ('scheduled', 'failed')
    AND oi.cancelled_at IS NULL;
  GET DIAGNOSTICS v_installments_cancelled = ROW_COUNT;

  -- 2. Stop releases (event-scoped; NEVER releases).
  WITH locked AS (
    SELECT id FROM public.brand_payout_releases
    WHERE event_id = p_event_id
      AND status IN (
        'pending','blocked_kyc','blocked_balance','blocked_otp','blocked_over_cap',
        'fee_unreconciled','blocked_anchor','reanchored'
      )
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.brand_payout_releases r
  SET status = 'cancelled_event', updated_at = p_now
  FROM locked WHERE r.id = locked.id;

  -- 3. Atomic debt conversion BEFORE any refund (Stripe only).
  FOR v_release IN
    SELECT r.id AS release_id
    FROM public.brand_payout_releases r
    WHERE r.event_id = p_event_id
      AND r.status = 'released'
      AND r.provider = 'stripe'
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    SELECT * INTO v_temp FROM public.organiser_payout_debts
    WHERE origin_release_id = v_release.release_id
      AND kind = 'post_release_postponement'
      AND status = 'open'
    FOR UPDATE;
    IF FOUND AND v_temp.principal_cents > 0 THEN
      PERFORM public.convert_postponement_debt_to_permanent(
        v_release.release_id, 'post_release_cancellation', v_temp.principal_cents, p_now
      );
    END IF;
  END LOOP;

  -- 4. Open / refresh the backstop run.
  INSERT INTO public.event_cancel_refund_runs (event_id, status, last_attempt_at, opened_at)
  VALUES (p_event_id, 'awaiting_review', p_now, p_now)
  ON CONFLICT (event_id) DO UPDATE SET
    last_attempt_at = p_now;

  -- 5. Enumerate + persist per-object progress rows (orders only).
  INSERT INTO public.event_cancel_refund_progress (
    event_id, source_type, source_id, provider, amount_cents, status
  )
  -- Issue #3872: a cancelled event returns what each buyer was charged
  -- (buyer_total_cents, which includes passed fees and added tax), on every
  -- rail. orders.total_cents is the ticket base on Stripe paths.
  SELECT p_event_id, 'order', o.id, v_provider,
         (COALESCE(o.buyer_total_cents, o.total_cents)::integer
           - COALESCE(o.refunded_amount_cents, 0)), 'pending'
  FROM public.orders o
  WHERE o.event_id = p_event_id
    AND o.payment_status IN ('paid','partial_refund')
    AND (COALESCE(o.buyer_total_cents, o.total_cents)::integer
           - COALESCE(o.refunded_amount_cents, 0)) > 0
  ON CONFLICT (source_type, source_id) DO NOTHING;

  -- 5a. Issue #3645 (both rails): every collected instalment is its own money
  --     object, refunded for what it charged and has not had back. Its refunds
  --     never count against the deposit (orders.refunded_amount_cents).
  INSERT INTO public.event_cancel_refund_progress (
    event_id, source_type, source_id, provider, amount_cents, status
  )
  SELECT p_event_id, 'order_installment', oi.id, oi.provider,
         (coalesce(oi.buyer_total_cents, oi.amount_cents) - oi.refunded_amount_cents)::integer,
         'pending'
  FROM public.order_installments oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.event_id = p_event_id
    AND oi.status = 'collected'
    AND (coalesce(oi.buyer_total_cents, oi.amount_cents) - oi.refunded_amount_cents) > 0
  ON CONFLICT (source_type, source_id) DO NOTHING;

  SELECT count(*)::integer INTO v_total
  FROM public.event_cancel_refund_progress WHERE event_id = p_event_id;

  -- 5b. RSVP chip-in contributions.
  SELECT count(*)::integer INTO v_rsvp_count
  FROM public.event_rsvp_contributions c
  WHERE c.event_id = p_event_id
    AND c.status IN ('paid','partially_refunded')
    AND c.buyer_total_cents > c.refunded_amount_cents;

  -- 6. Resolve the run status from the refund work.
  UPDATE public.event_cancel_refund_runs
  SET total_objects = v_total,
      status = CASE
        WHEN status = 'completed' THEN status
        WHEN v_total = 0 AND v_rsvp_count = 0 THEN 'completed'
        ELSE status
      END,
      completed_at = CASE
        WHEN status <> 'completed' AND v_total = 0 AND v_rsvp_count = 0
             AND completed_at IS NULL THEN p_now
        ELSE completed_at
      END
  WHERE event_id = p_event_id
  RETURNING status INTO v_run_status;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_pending_ids
  FROM public.event_cancel_refund_progress
  WHERE event_id = p_event_id AND status IN ('pending','failed_retryable');

  RETURN jsonb_build_object(
    'run_status', v_run_status,
    'total_objects', v_total,
    'pending_object_ids', to_jsonb(v_pending_ids),
    'rsvp_pending_count', v_rsvp_count,
    'installments_cancelled', v_installments_cancelled
  );
END;
$function$;

-- ---- issue_3872_cancel_refund_order (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.issue_3872_cancel_refund_order(
  p_order_id uuid,
  p_lines jsonb,
  p_reason text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_lines jsonb;
  v_line jsonb;
  v_item public.order_line_items%ROWTYPE;
  v_existing_refunded integer;
  v_existing public.refunds%ROWTYPE;
  v_manifest jsonb;
  v_line_base bigint := 0;
  v_other bigint;
  v_charged bigint;
  v_amount bigint;
  v_allocated bigint := 0;
  v_alloc bigint;
  v_idx integer := 0;
  v_count integer;
  v_full boolean;
  v_status text;
  v_refund_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);

  SELECT * INTO v_existing FROM public.refunds
   WHERE metadata->>'idempotency_key' = p_idempotency_key AND order_id = p_order_id
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    v_manifest := v_existing.metadata->'refund_request_manifest';
    IF v_manifest IS NULL
       OR v_manifest->>'reason' IS DISTINCT FROM trim(p_reason)
       OR (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'order_line_item_id', l->>'order_line_item_id', 'quantity', (l->>'quantity')::int)
             ORDER BY l->>'order_line_item_id'), '[]'::jsonb)
           FROM jsonb_array_elements(v_manifest->'lines') l)
          IS DISTINCT FROM
          (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'order_line_item_id', l->>'order_line_item_id', 'quantity', (l->>'quantity')::int)
             ORDER BY l->>'order_line_item_id'), '[]'::jsonb)
           FROM jsonb_array_elements(v_lines) l) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'refund_id', v_existing.id, 'order_id', p_order_id,
      'amount_cents', v_existing.amount_cents, 'currency', v_existing.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status', v_manifest->>'proposed_new_payment_status',
      'is_full_refund', (v_manifest->>'is_full_refund')::boolean,
      'lines', v_manifest->'lines', 'reason', v_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    SELECT * INTO v_item FROM public.order_line_items
     WHERE id::text = v_line->>'order_line_item_id' AND order_id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;
    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;
    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_item.id AND r.status IN ('pending', 'succeeded');
    IF v_existing_refunded + (v_line->>'quantity')::int > v_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_existing_refunded, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    v_line_base := v_line_base + (v_line->>'amount_cents')::bigint;
  END LOOP;
  v_count := jsonb_array_length(v_lines);
  IF v_count = 0 OR v_line_base <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  -- Would every line be fully refunded after this?
  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0) FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id AND r.status IN ('pending', 'succeeded')
      ) + COALESCE((SELECT (l->>'quantity')::int FROM jsonb_array_elements(v_lines) l
                    WHERE l->>'order_line_item_id' = oli.id::text), 0)
  ) INTO v_full;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_other
  FROM public.refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded')
    AND order_installment_id IS NULL;  -- issue #3645: instalment refunds are not deposit refunds
  v_charged := COALESCE(v_order.buyer_total_cents, v_order.total_cents);
  -- Everything that remains when the last tickets go back; otherwise the lines
  -- (a cancellation always returns every remaining ticket, so this is the norm).
  v_amount := CASE WHEN v_full THEN v_charged - v_other ELSE LEAST(v_line_base, v_charged - v_other) END;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;
  v_status := CASE WHEN v_full THEN 'refunded' ELSE 'partial_refund' END;

  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id, v_amount::integer, v_order.currency, trim(p_reason), NULL, 'pending',
    v_order.stripe_payment_intent_id, v_order.stripe_charge_id,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  ) RETURNING id INTO v_refund_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) ORDER BY value->>'order_line_item_id' LOOP
    v_idx := v_idx + 1;
    v_alloc := CASE WHEN v_idx = v_count THEN v_amount - v_allocated
      ELSE floor(v_amount::numeric * (v_line->>'amount_cents')::bigint / v_line_base)::bigint END;
    v_allocated := v_allocated + v_alloc;
    INSERT INTO public.refund_line_items (refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents)
    SELECT v_refund_id, oli.id, oli.ticket_type_id, (v_line->>'quantity')::int, v_alloc::integer
    FROM public.order_line_items oli WHERE oli.id::text = v_line->>'order_line_item_id';
  END LOOP;

  v_manifest := jsonb_build_object(
    'lines', (SELECT jsonb_agg(jsonb_build_object(
        'order_line_item_id', rli.order_line_item_id::text, 'quantity', rli.quantity,
        'amount_cents', rli.amount_cents) ORDER BY rli.order_line_item_id::text)
      FROM public.refund_line_items rli WHERE rli.refund_id = v_refund_id),
    'reason', trim(p_reason),
    'amount_cents', v_amount,
    'proposed_new_payment_status', v_status,
    'is_full_refund', v_full,
    'issue_3872_cancellation', jsonb_build_object(
      'ticket_lines_cents', v_line_base,
      'fees_and_tax_cents', GREATEST(0, v_amount - v_line_base),
      'charged_total_cents', v_charged)
  );
  UPDATE public.refunds
  SET metadata = metadata || jsonb_build_object('refund_request_manifest', v_manifest)
  WHERE id = v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id, 'order_id', p_order_id,
    'amount_cents', v_amount, 'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_status,
    'is_full_refund', v_full,
    'lines', v_manifest->'lines', 'reason', trim(p_reason),
    'idempotent_replay', false
  );
END
$fn$;

-- ---- admin_refund_order_commit (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.admin_refund_order_commit(
  p_refund_id uuid,
  p_stripe_refund_id text,
  p_application_fee_refunded_cents integer,
  p_status text,
  p_stripe_tax_transaction_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
      processed_at = now()
  WHERE id = p_refund_id;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = v_order.id AND status = 'succeeded'
    AND order_installment_id IS NULL;  -- issue #3645: instalment refunds are not deposit refunds

  IF NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = v_order.id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status = 'succeeded'
      )
  ) THEN
    v_new_payment_status := 'refunded';
  ELSE
    v_new_payment_status := 'partial_refund';
  END IF;

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
$$;

-- ---- record_paystack_refund_outcome (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.record_paystack_refund_outcome(
  p_source_type text,
  p_source_id uuid,
  p_local_refund_id uuid,
  p_transaction_reference text,
  p_merchant_note text,
  p_provider_refund_id text,
  p_amount_cents integer,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_attempt_id uuid;
  v_release_id uuid;
  v_release public.brand_payout_releases;
  v_liability integer;
  v_adjustment_key text;
  v_debt_id uuid;
  v_debt public.organiser_payout_debts;
  v_temp public.organiser_payout_debts;
  v_target_liability integer;
  v_growth integer;
  v_overlap integer;
  v_recovered_overlap integer;
  v_left integer;
  v_take integer;
  v_app record;
  v_room integer;
BEGIN
  IF p_source_type NOT IN ('order','venue_reservation','order_installment')
     OR p_source_id IS NULL
     OR p_transaction_reference IS NULL OR btrim(p_transaction_reference)=''
     OR p_merchant_note IS NULL OR btrim(p_merchant_note)=''
     OR p_amount_cents<0
     OR p_status NOT IN ('pending','accepted','processed','failed') THEN
    RAISE EXCEPTION 'invalid_paystack_refund_outcome' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.paystack_refund_attempts(
    source_type,source_id,local_refund_id,transaction_reference,merchant_note,
    provider_refund_id,amount_cents,currency,status,error_message,idempotency_key,
    created_at,updated_at
  ) VALUES(
    p_source_type,p_source_id,p_local_refund_id,p_transaction_reference,p_merchant_note,
    NULLIF(p_provider_refund_id,''),p_amount_cents,'ngn',p_status,p_error_message,
    'paystack-refund:'||p_merchant_note,p_now,p_now
  )
  ON CONFLICT(idempotency_key) DO UPDATE SET
    provider_refund_id=coalesce(
      public.paystack_refund_attempts.provider_refund_id,
      excluded.provider_refund_id
    ),
    status=CASE
      WHEN public.paystack_refund_attempts.status='processed' THEN 'processed'
      WHEN excluded.status='processed' THEN 'processed'
      WHEN excluded.status='failed' THEN 'failed'
      WHEN public.paystack_refund_attempts.status='accepted'
        OR excluded.status='accepted' THEN 'accepted'
      ELSE public.paystack_refund_attempts.status
    END,
    error_message=excluded.error_message,
    updated_at=excluded.updated_at
  RETURNING id INTO v_attempt_id;

  IF p_status<>'processed' THEN
    RETURN jsonb_build_object('attempt_id',v_attempt_id,'debt_created',false);
  END IF;

  SELECT pri.release_id INTO v_release_id
  FROM public.payout_release_items pri
  JOIN public.brand_payout_releases r ON r.id=pri.release_id
  WHERE pri.source_type=p_source_type
    AND pri.source_id=p_source_id
    AND r.provider='paystack'
    AND r.status='released'
  LIMIT 1;
  IF v_release_id IS NULL THEN
    RETURN jsonb_build_object('attempt_id',v_attempt_id,'debt_created',false);
  END IF;

  SELECT * INTO v_release FROM public.brand_payout_releases
  WHERE id=v_release_id FOR UPDATE;
  PERFORM 1
  FROM public.brand_payout_releases r
  WHERE r.brand_id = v_release.brand_id
    AND r.currency = v_release.currency
    AND r.status = 'released'
    AND (
      v_release.event_id IS NULL
      OR r.event_id IS NOT DISTINCT FROM v_release.event_id
    )
  ORDER BY r.id
  FOR UPDATE;
  v_room:=public.organiser_refund_debt_room_cents(
    v_release.brand_id, v_release.currency, v_release.event_id, v_release.id
  );
  v_liability:=least(p_amount_cents, v_room);
  IF v_liability<=0 THEN
    RETURN jsonb_build_object('attempt_id',v_attempt_id,'debt_created',false);
  END IF;

  v_adjustment_key:='paystack-refund-liability:'||v_attempt_id;
  INSERT INTO public.payout_ledger_adjustments(
    release_id,brand_id,currency,kind,amount_cents,provider_ref,idempotency_key,created_at
  ) VALUES(
    v_release.id,v_release.brand_id,v_release.currency,'post_release_refund',
    v_liability,NULLIF(p_provider_refund_id,''),v_adjustment_key,p_now
  ) ON CONFLICT(idempotency_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT id INTO v_debt_id FROM public.organiser_payout_debts
    WHERE origin_release_id=v_release.id AND kind='post_release_refund';
    RETURN jsonb_build_object(
      'attempt_id',v_attempt_id,'debt_created',v_debt_id IS NOT NULL,'debt_id',v_debt_id
    );
  END IF;

  SELECT least(
    least(coalesce(sum(amount_cents),0), 2147483647::bigint)::integer,
    v_room
  ) INTO v_target_liability
  FROM public.payout_ledger_adjustments
  WHERE release_id=v_release.id AND kind='post_release_refund';

  SELECT * INTO v_debt FROM public.organiser_payout_debts
  WHERE origin_release_id=v_release.id AND kind='post_release_refund'
  FOR UPDATE;
  IF NOT FOUND THEN
    v_debt_id:=public.convert_postponement_debt_to_permanent(
      v_release.id,'post_release_refund',v_target_liability,p_now
    );
  ELSIF v_target_liability>v_debt.principal_cents THEN
    v_growth:=v_target_liability-v_debt.principal_cents;
    SELECT * INTO v_temp FROM public.organiser_payout_debts
    WHERE origin_release_id=v_release.id
      AND kind='post_release_postponement' AND status='open'
    FOR UPDATE;
    IF FOUND THEN
      v_overlap:=least(v_growth,v_temp.principal_cents);
      v_recovered_overlap:=least(v_overlap,v_temp.recovered_cents);
    ELSE
      v_overlap:=0;
      v_recovered_overlap:=0;
    END IF;

    UPDATE public.organiser_payout_debts SET
      principal_cents=v_target_liability,
      recovered_cents=recovered_cents+v_recovered_overlap,
      status=CASE
        WHEN recovered_cents+v_recovered_overlap=v_target_liability THEN 'closed'
        ELSE 'open'
      END,
      closed_at=CASE
        WHEN recovered_cents+v_recovered_overlap=v_target_liability THEN p_now
        ELSE NULL
      END,
      updated_at=p_now
    WHERE id=v_debt.id;
    v_debt_id:=v_debt.id;

    IF v_overlap>0 THEN
      v_left:=v_recovered_overlap;
      FOR v_app IN
        SELECT * FROM public.payout_debt_applications
        WHERE debt_id=v_temp.id AND released_at IS NULL
          AND amount_cents>converted_cents
        ORDER BY created_at,id FOR UPDATE
      LOOP
        EXIT WHEN v_left=0;
        v_take:=least(v_left,v_app.amount_cents-v_app.converted_cents);
        UPDATE public.payout_debt_applications
        SET converted_cents=converted_cents+v_take WHERE id=v_app.id;
        INSERT INTO public.payout_debt_applications(
          debt_id,release_id,amount_cents,idempotency_key,created_at
        ) VALUES(
          v_debt.id,v_app.release_id,v_take,
          'converted-apply:'||v_debt.id||':'||v_app.id||':'||v_target_liability,p_now
        );
        v_left:=v_left-v_take;
      END LOOP;
      UPDATE public.organiser_payout_debts SET
        principal_cents=principal_cents-v_overlap,
        recovered_cents=recovered_cents-v_recovered_overlap,
        status=CASE WHEN principal_cents-v_overlap=0 THEN 'converted' ELSE 'open' END,
        closed_at=CASE WHEN principal_cents-v_overlap=0 THEN p_now ELSE NULL END,
        updated_at=p_now
      WHERE id=v_temp.id;
      INSERT INTO public.payout_debt_events(
        debt_id,event_kind,amount_cents,release_id,idempotency_key,created_at
      ) VALUES(
        v_temp.id,'cancellation_converted',v_overlap,v_release.id,
        'postpone-convert:'||v_temp.id||':post_release_refund:'||v_target_liability,p_now
      );
    END IF;
  ELSE
    v_debt_id:=v_debt.id;
  END IF;
  RETURN jsonb_build_object(
    'attempt_id',v_attempt_id,'debt_created',true,'debt_id',v_debt_id
  );
END;
$fn$;

-- ---- biz_compute_refund_for_cancel (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION biz_compute_refund_for_cancel(
  p_order_id uuid,
  p_cancel_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
        'refund_cents', FLOOR(v_installment.amount_cents * v_tier_pct / 100.0)::bigint,
        'currency', v_installment.currency
      );
    END LOOP;

    -- Append the deposit row (orders-level, installment_id=NULL).
    v_per_installment_refund := v_per_installment_refund || jsonb_build_object(
      'installment_id', NULL,
      'ordinal', 0,
      'source_pi', v_order.stripe_payment_intent_id,
      'paid_cents', v_order.total_cents,
      'refund_cents', FLOOR(v_order.total_cents * v_tier_pct / 100.0)::bigint,
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
      'refund_cents', FLOOR(v_order.total_cents * v_tier_pct / 100.0)::bigint,
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
  );
END;
$$;

-- ---- biz_cancel_trip_booking_begin (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.biz_cancel_trip_booking_begin(
  p_order_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_reason text,
  p_cancel_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
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

  v_compute:=public.biz_compute_refund_for_cancel(p_order_id,p_cancel_at);
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
  );
END;
$fn$;

-- ---- paystack_release_has_unresolved_dispute (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.paystack_release_has_unresolved_dispute(
  p_release_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.payout_release_items item
    JOIN public.paystack_disputes dispute ON (
      (item.source_type = 'order' AND dispute.order_id = item.source_id)
      OR (
        item.source_type = 'rsvp_contribution'
        AND dispute.rsvp_contribution_id = item.source_id
      )
      OR (
        item.source_type = 'venue_menu_order'
        AND dispute.venue_menu_order_id = item.source_id
      )
      OR (  -- issue #3645
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
    WHERE item.release_id = p_release_id
      AND dispute.is_resolved IS NOT TRUE
  );
$fn$;

-- ---- refresh_paystack_dispute_release_projection (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.refresh_paystack_dispute_release_projection(
  p_release_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_disputed integer;
  v_net integer;
  v_unresolved boolean;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id = p_release_id
    AND provider = 'paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_release.status = 'released' THEN
    RAISE EXCEPTION 'pending_paystack_release_required' USING ERRCODE = 'P0001';
  END IF;

  WITH item_holds AS (
    SELECT
      item.id,
      item.disputed_cents AS snapshot_disputed_cents,
      item.net_cents AS snapshot_net_cents,
      least(
        item.net_cents::bigint,
        coalesce(sum(dispute.amount_cents::bigint) FILTER (
          WHERE dispute.id IS NOT NULL
            AND (
              dispute.is_resolved IS NOT TRUE
              OR lower(coalesce(dispute.resolution, '')) IN (
                'merchant-accepted', 'merchant_accepted', 'accepted'
              )
            )
        ), 0)
      ) AS hold_cents
    FROM public.payout_release_items item
    LEFT JOIN public.paystack_disputes dispute ON (
      (item.source_type = 'order' AND dispute.order_id = item.source_id)
      OR (
        item.source_type = 'rsvp_contribution'
        AND dispute.rsvp_contribution_id = item.source_id
      )
      OR (
        item.source_type = 'venue_menu_order'
        AND dispute.venue_menu_order_id = item.source_id
      )
      OR (  -- issue #3645
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
    WHERE item.release_id = p_release_id
    GROUP BY item.id, item.disputed_cents, item.net_cents
  ), totals AS (
    SELECT
      least(
        coalesce(sum(snapshot_disputed_cents::bigint + hold_cents), 0),
        2147483647::bigint
      )::integer AS disputed_cents,
      least(
        coalesce(sum(snapshot_net_cents::bigint - hold_cents), 0),
        2147483647::bigint
      )::integer AS net_release_cents
    FROM item_holds
  )
  SELECT disputed_cents, net_release_cents
  INTO v_disputed, v_net
  FROM totals;

  v_unresolved := public.paystack_release_has_unresolved_dispute(p_release_id);

  UPDATE public.brand_payout_releases
  SET disputed_cents = v_disputed,
      net_release_cents = v_net,
      status = CASE WHEN status = 'in_flight' THEN 'pending' ELSE status END,
      paystack_execution_claim_id = CASE
        WHEN status = 'in_flight' THEN NULL ELSE paystack_execution_claim_id END,
      paystack_execution_claimed_at = CASE
        WHEN status = 'in_flight' THEN NULL ELSE paystack_execution_claimed_at END,
      error_message = CASE
        WHEN v_unresolved THEN 'paystack_dispute_open'
        WHEN error_message = 'paystack_dispute_open' THEN NULL
        ELSE error_message
      END,
      updated_at = p_now
  WHERE id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id,
    'disputed_cents', v_disputed,
    'net_release_cents', v_net,
    'unresolved', v_unresolved
  );
END;
$fn$;

-- ---- record_paystack_dispute_outcome_pre_3645_append_only_fix (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.record_paystack_dispute_outcome_pre_3645_append_only_fix(
  p_paystack_dispute_id text,
  p_transaction_reference text,
  p_event_name text,
  p_status text,
  p_resolution text,
  p_amount_cents integer,
  p_currency text,
  p_reason text DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL,
  p_raw jsonb DEFAULT '{}'::jsonb,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ref text := nullif(btrim(p_transaction_reference), '');
  v_dispute_id text := nullif(btrim(p_paystack_dispute_id), '');
  v_currency text := lower(coalesce(nullif(btrim(p_currency), ''), 'ngn'));
  v_status text := coalesce(nullif(btrim(p_status), ''), 'pending');
  v_resolution text := nullif(btrim(p_resolution), '');
  v_event text := coalesce(nullif(btrim(p_event_name), ''), 'charge.dispute.create');
  v_amount integer := greatest(coalesce(p_amount_cents, 0), 0);
  v_order_id uuid;
  v_reservation_id uuid;
  v_contribution_id uuid;
  v_venue_order_id uuid;
  v_installment_id uuid;  -- issue #3645
  v_brand_id uuid;
  v_due timestamptz;
  v_row public.paystack_disputes%ROWTYPE;
  v_source_type text;
  v_source_id uuid;
  v_release public.brand_payout_releases%ROWTYPE;
  v_room integer;
  v_liability integer;
  v_target integer;
  v_debt_id uuid;
  v_debt public.organiser_payout_debts%ROWTYPE;
  v_temp public.organiser_payout_debts%ROWTYPE;
  v_adj_key text;
  v_merchant_lost boolean;
  v_merchant_won boolean;
  v_debt_created boolean := false;
  v_hold_cents integer;
  v_growth integer;
  v_overlap integer;
  v_recovered_overlap integer;
  v_left integer;
  v_take integer;
  v_app record;
BEGIN
  IF v_dispute_id IS NULL OR v_ref IS NULL THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_outcome' USING ERRCODE = '22023';
  END IF;
  IF v_event NOT IN (
    'charge.dispute.create', 'charge.dispute.remind', 'charge.dispute.resolve'
  ) THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_event' USING ERRCODE = '22023';
  END IF;

  -- Resolve subject in the same order as paystackWebhookRouter charge matching.
  SELECT o.id, e.brand_id INTO v_order_id, v_brand_id
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.stripe_payment_intent_id = v_ref
  LIMIT 1;
  IF v_order_id IS NULL THEN
    SELECT tcs.order_id, e.brand_id INTO v_order_id, v_brand_id
    FROM public.ticket_checkout_sessions tcs
    JOIN public.orders o ON o.id = tcs.order_id
    JOIN public.events e ON e.id = o.event_id
    WHERE tcs.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL THEN
    SELECT c.id, c.brand_id INTO v_contribution_id, v_brand_id
    FROM public.event_rsvp_contributions c
    WHERE c.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL THEN
    SELECT rcs.reservation_id, rcs.brand_id INTO v_reservation_id, v_brand_id
    FROM public.reservation_checkout_sessions rcs
    WHERE rcs.paystack_reference = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL AND v_reservation_id IS NULL THEN
    SELECT vo.id, vo.brand_id INTO v_venue_order_id, v_brand_id
    FROM public.venue_orders vo
    WHERE vo.paystack_reference = v_ref
    LIMIT 1;
  END IF;

  -- issue #3645: an instalment payment reference is its own subject.
  IF v_order_id IS NULL AND v_contribution_id IS NULL AND v_reservation_id IS NULL
     AND v_venue_order_id IS NULL THEN
    SELECT oi.id, e.brand_id INTO v_installment_id, v_brand_id
    FROM public.order_installments oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.events e ON e.id = o.event_id
    WHERE oi.provider = 'paystack'
      AND (oi.stripe_payment_intent_id = v_ref
           OR EXISTS (SELECT 1 FROM public.order_installment_charge_attempts att
                       WHERE att.installment_id = oi.id AND att.reference = v_ref
                         AND att.state IN ('succeeded', 'refund_due', 'refunded')))
    LIMIT 1;
  END IF;

  v_due := coalesce(p_due_at, p_now + interval '16 hours');

  INSERT INTO public.paystack_disputes(
    paystack_dispute_id, transaction_reference, brand_id, order_id,
    venue_reservation_id, rsvp_contribution_id, venue_menu_order_id, order_installment_id,
    amount_cents, currency, status, resolution,
    reason, response_due_by, is_resolved, raw_event, created_at, updated_at
  ) VALUES (
    v_dispute_id, v_ref, v_brand_id, v_order_id, v_reservation_id,
    v_contribution_id, v_venue_order_id, v_installment_id,
    v_amount, v_currency, v_status, v_resolution, nullif(btrim(p_reason), ''),
    v_due, v_event = 'charge.dispute.resolve', p_raw, p_now, p_now
  )
  ON CONFLICT (paystack_dispute_id) DO UPDATE SET
    transaction_reference = excluded.transaction_reference,
    brand_id = coalesce(public.paystack_disputes.brand_id, excluded.brand_id),
    order_id = coalesce(public.paystack_disputes.order_id, excluded.order_id),
    venue_reservation_id = coalesce(
      public.paystack_disputes.venue_reservation_id, excluded.venue_reservation_id
    ),
    rsvp_contribution_id = coalesce(
      public.paystack_disputes.rsvp_contribution_id, excluded.rsvp_contribution_id
    ),
    venue_menu_order_id = coalesce(
      public.paystack_disputes.venue_menu_order_id, excluded.venue_menu_order_id
    ),
    order_installment_id = coalesce(
      public.paystack_disputes.order_installment_id, excluded.order_installment_id
    ),
    amount_cents = CASE
      WHEN excluded.amount_cents > 0 THEN excluded.amount_cents
      ELSE public.paystack_disputes.amount_cents
    END,
    currency = excluded.currency,
    status = excluded.status,
    resolution = coalesce(excluded.resolution, public.paystack_disputes.resolution),
    reason = coalesce(excluded.reason, public.paystack_disputes.reason),
    response_due_by = coalesce(
      public.paystack_disputes.response_due_by, excluded.response_due_by
    ),
    is_resolved = public.paystack_disputes.is_resolved
      OR excluded.is_resolved,
    raw_event = excluded.raw_event,
    updated_at = excluded.updated_at
  RETURNING * INTO v_row;

  v_merchant_lost := v_event = 'charge.dispute.resolve'
    AND lower(coalesce(v_resolution, '')) IN (
      'merchant-accepted', 'merchant_accepted', 'accepted'
    );
  v_merchant_won := v_event = 'charge.dispute.resolve'
    AND NOT v_merchant_lost;

  IF v_row.order_id IS NOT NULL THEN
    v_source_type := 'order';
    v_source_id := v_row.order_id;
  ELSIF v_row.rsvp_contribution_id IS NOT NULL THEN
    v_source_type := 'rsvp_contribution';
    v_source_id := v_row.rsvp_contribution_id;
  ELSIF v_row.venue_reservation_id IS NOT NULL THEN
    SELECT rcs.id INTO v_source_id
    FROM public.reservation_checkout_sessions rcs
    WHERE rcs.reservation_id = v_row.venue_reservation_id
      AND rcs.status = 'completed'
    ORDER BY rcs.created_at DESC
    LIMIT 1;
    v_source_type := 'venue_reservation';
  ELSIF v_row.venue_menu_order_id IS NOT NULL THEN
    v_source_type := 'venue_menu_order';
    v_source_id := v_row.venue_menu_order_id;
  ELSIF v_row.order_installment_id IS NOT NULL THEN
    v_source_type := 'order_installment';
    v_source_id := v_row.order_installment_id;
  END IF;

  IF v_source_type IS NOT NULL AND v_source_id IS NOT NULL AND v_row.amount_cents > 0 THEN
    SELECT r.* INTO v_release
    FROM public.payout_release_items pri
    JOIN public.brand_payout_releases r ON r.id = pri.release_id
    WHERE pri.source_type = v_source_type
      AND pri.source_id = v_source_id
      AND r.provider = 'paystack'
    ORDER BY CASE WHEN r.status = 'released' THEN 0 ELSE 1 END, r.created_at DESC
    LIMIT 1
    FOR UPDATE OF r;

    IF FOUND AND v_release.status <> 'released' THEN
      -- Pending/planned: hold disputed cash (or clear on merchant win).
      IF v_merchant_won THEN
        v_hold_cents := 0;
      ELSIF v_merchant_lost
        OR v_event IN ('charge.dispute.create', 'charge.dispute.remind')
      THEN
        v_hold_cents := v_row.amount_cents;
      ELSE
        v_hold_cents := NULL;
      END IF;

      IF v_hold_cents IS NOT NULL THEN
        UPDATE public.payout_release_items
        SET disputed_cents = v_hold_cents,
            -- #3645 flat 4.5%: host net ignores partner_share and provider_fee
            net_cents = greatest(
              0,
              gross_cents - refunded_cents - v_hold_cents
                - mingla_fee_cents
            )
        WHERE source_type = v_source_type
          AND source_id = v_source_id;

        UPDATE public.brand_payout_releases release_row
        SET disputed_cents = totals.disputed,
            net_release_cents = totals.net,
            updated_at = p_now
        FROM (
          SELECT
            sum(item.disputed_cents)::integer AS disputed,
            sum(item.net_cents)::integer AS net
          FROM public.payout_release_items item
          WHERE item.release_id = v_release.id
        ) totals
        WHERE release_row.id = v_release.id;

        IF v_merchant_lost AND NOT v_row.debt_opened THEN
          UPDATE public.paystack_disputes
          SET debt_opened = true, updated_at = p_now
          WHERE id = v_row.id;
          v_debt_created := true;
        END IF;
      END IF;

    ELSIF FOUND AND v_release.status = 'released'
      AND v_merchant_lost AND NOT v_row.debt_opened
    THEN
      PERFORM 1
      FROM public.brand_payout_releases r
      WHERE r.brand_id = v_release.brand_id
        AND r.currency = v_release.currency
        AND r.status = 'released'
        AND (
          v_release.event_id IS NULL
          OR r.event_id IS NOT DISTINCT FROM v_release.event_id
        )
      ORDER BY r.id
      FOR UPDATE;

      v_room := public.organiser_refund_debt_room_cents(
        v_release.brand_id, v_release.currency, v_release.event_id, v_release.id
      );
      v_liability := least(v_row.amount_cents, v_room);
      IF v_liability > 0 THEN
        v_adj_key := 'paystack-dispute-liability:' || v_dispute_id;
        INSERT INTO public.payout_ledger_adjustments(
          release_id, brand_id, currency, kind, amount_cents,
          provider_ref, idempotency_key, created_at
        ) VALUES (
          v_release.id, v_release.brand_id, v_release.currency,
          'post_release_dispute', v_liability, v_dispute_id, v_adj_key, p_now
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        SELECT least(
          least(coalesce(sum(amount_cents), 0), 2147483647::bigint)::integer,
          v_room
        ) INTO v_target
        FROM public.payout_ledger_adjustments
        WHERE release_id = v_release.id AND kind = 'post_release_dispute';

        SELECT * INTO v_debt FROM public.organiser_payout_debts
        WHERE origin_release_id = v_release.id AND kind = 'post_release_dispute'
        FOR UPDATE;
        IF NOT FOUND THEN
          v_debt_id := public.convert_postponement_debt_to_permanent(
            v_release.id, 'post_release_dispute', v_target, p_now
          );
        ELSIF v_target > v_debt.principal_cents THEN
          -- Mirror PR3 refund growth: transfer overlapping postponement first.
          v_growth := v_target - v_debt.principal_cents;
          SELECT * INTO v_temp FROM public.organiser_payout_debts
          WHERE origin_release_id = v_release.id
            AND kind = 'post_release_postponement' AND status = 'open'
          FOR UPDATE;
          IF FOUND THEN
            v_overlap := least(v_growth, v_temp.principal_cents);
            v_recovered_overlap := least(v_overlap, v_temp.recovered_cents);
          ELSE
            v_overlap := 0;
            v_recovered_overlap := 0;
          END IF;

          UPDATE public.organiser_payout_debts SET
            principal_cents = v_target,
            recovered_cents = recovered_cents + v_recovered_overlap,
            status = CASE
              WHEN recovered_cents + v_recovered_overlap = v_target THEN 'closed'
              ELSE 'open'
            END,
            closed_at = CASE
              WHEN recovered_cents + v_recovered_overlap = v_target THEN p_now
              ELSE NULL
            END,
            updated_at = p_now
          WHERE id = v_debt.id;
          v_debt_id := v_debt.id;

          IF v_overlap > 0 THEN
            v_left := v_recovered_overlap;
            FOR v_app IN
              SELECT * FROM public.payout_debt_applications
              WHERE debt_id = v_temp.id AND released_at IS NULL
                AND amount_cents > converted_cents
              ORDER BY created_at, id FOR UPDATE
            LOOP
              EXIT WHEN v_left = 0;
              v_take := least(v_left, v_app.amount_cents - v_app.converted_cents);
              UPDATE public.payout_debt_applications
              SET converted_cents = converted_cents + v_take WHERE id = v_app.id;
              INSERT INTO public.payout_debt_applications(
                debt_id, release_id, amount_cents, idempotency_key, created_at
              ) VALUES (
                v_debt.id, v_app.release_id, v_take,
                'converted-apply:' || v_debt.id || ':' || v_app.id || ':' || v_target,
                p_now
              );
              v_left := v_left - v_take;
            END LOOP;
            UPDATE public.organiser_payout_debts SET
              principal_cents = principal_cents - v_overlap,
              recovered_cents = recovered_cents - v_recovered_overlap,
              status = CASE
                WHEN principal_cents - v_overlap = 0 THEN 'converted'
                ELSE 'open'
              END,
              closed_at = CASE
                WHEN principal_cents - v_overlap = 0 THEN p_now
                ELSE NULL
              END,
              updated_at = p_now
            WHERE id = v_temp.id;
            INSERT INTO public.payout_debt_events(
              debt_id, event_kind, amount_cents, release_id, idempotency_key, created_at
            ) VALUES (
              v_temp.id, 'cancellation_converted', v_overlap, v_release.id,
              'postpone-convert:' || v_temp.id || ':post_release_dispute:' || v_target,
              p_now
            );
          END IF;
        ELSE
          v_debt_id := v_debt.id;
        END IF;

        UPDATE public.paystack_disputes
        SET debt_opened = true, updated_at = p_now
        WHERE id = v_row.id;
        v_debt_created := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'dispute_id', v_row.id,
    'paystack_dispute_id', v_dispute_id,
    'matched', (
      v_row.order_id IS NOT NULL
      OR v_row.venue_reservation_id IS NOT NULL
      OR v_row.rsvp_contribution_id IS NOT NULL
      OR v_row.venue_menu_order_id IS NOT NULL
      OR v_row.order_installment_id IS NOT NULL
    ),
    'brand_id', v_row.brand_id,
    'order_id', coalesce(v_row.order_id, (
      SELECT oi.order_id FROM public.order_installments oi WHERE oi.id = v_row.order_installment_id
    )),
    'order_installment_id', v_row.order_installment_id,
    'venue_reservation_id', v_row.venue_reservation_id,
    'rsvp_contribution_id', v_row.rsvp_contribution_id,
    'venue_menu_order_id', v_row.venue_menu_order_id,
    'response_due_by', v_row.response_due_by,
    'is_resolved', v_row.is_resolved OR v_event = 'charge.dispute.resolve',
    'merchant_lost', v_merchant_lost,
    'debt_created', v_debt_created,
    'debt_id', v_debt_id
  );
END;
$fn$;

-- ---- record_paystack_dispute_outcome (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.record_paystack_dispute_outcome(
  p_paystack_dispute_id text,
  p_transaction_reference text,
  p_event_name text,
  p_status text,
  p_resolution text,
  p_amount_cents integer,
  p_currency text,
  p_reason text DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL,
  p_raw jsonb DEFAULT '{}'::jsonb,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ref text := nullif(btrim(p_transaction_reference), '');
  v_dispute_id text := nullif(btrim(p_paystack_dispute_id), '');
  v_currency text := lower(coalesce(nullif(btrim(p_currency), ''), 'ngn'));
  v_status text := coalesce(nullif(btrim(p_status), ''), 'pending');
  v_resolution text := nullif(btrim(p_resolution), '');
  v_event text := coalesce(nullif(btrim(p_event_name), ''), 'charge.dispute.create');
  v_amount integer := greatest(coalesce(p_amount_cents, 0), 0);
  v_order_id uuid;
  v_reservation_id uuid;
  v_contribution_id uuid;
  v_venue_order_id uuid;
  v_brand_id uuid;
  v_source_type text;
  v_source_id uuid;
  v_release public.brand_payout_releases%ROWTYPE;
  v_release_found boolean := false;
  v_row public.paystack_disputes%ROWTYPE;
  v_due timestamptz;
  v_merchant_lost boolean;
  v_debt_created boolean := false;
BEGIN
  IF v_dispute_id IS NULL OR v_ref IS NULL THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_outcome' USING ERRCODE = '22023';
  END IF;
  IF v_event NOT IN (
    'charge.dispute.create', 'charge.dispute.remind', 'charge.dispute.resolve'
  ) THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_event' USING ERRCODE = '22023';
  END IF;

  -- issue #3645: an instalment payment reference is its own dispute subject
  -- (source_type order_installment; single subject, order_id stays NULL and the
  -- parent order is returned for the host notification). A pending release is
  -- projected here like every other source; no release, a released payout or a
  -- zero amount go to the fallback, which knows instalments too.
  DECLARE
    v_inst_id uuid;
  BEGIN
    SELECT oi.id, ev.brand_id INTO v_inst_id, v_brand_id
    FROM public.order_installments oi
    JOIN public.orders od ON od.id = oi.order_id
    JOIN public.events ev ON ev.id = od.event_id
    WHERE oi.provider = 'paystack'
      AND (oi.stripe_payment_intent_id = v_ref
           OR EXISTS (SELECT 1 FROM public.order_installment_charge_attempts att
                       WHERE att.installment_id = oi.id AND att.reference = v_ref
                         AND att.state IN ('succeeded', 'refund_due', 'refunded')))
    LIMIT 1;
    IF v_inst_id IS NOT NULL THEN
      SELECT release_row.* INTO v_release
      FROM public.payout_release_items item
      JOIN public.brand_payout_releases release_row ON release_row.id = item.release_id
      WHERE item.source_type = 'order_installment'
        AND item.source_id = v_inst_id
        AND release_row.provider = 'paystack'
      ORDER BY CASE WHEN release_row.status = 'released' THEN 0 ELSE 1 END,
        release_row.created_at DESC
      LIMIT 1
      FOR UPDATE OF release_row;
      IF NOT FOUND OR v_release.status = 'released' OR v_amount = 0 THEN
        RETURN public.record_paystack_dispute_outcome_pre_3645_append_only_fix(
          p_paystack_dispute_id, p_transaction_reference, p_event_name, p_status,
          p_resolution, p_amount_cents, p_currency, p_reason, p_due_at, p_raw, p_now
        );
      END IF;
      INSERT INTO public.paystack_disputes(
        paystack_dispute_id, transaction_reference, brand_id, order_installment_id,
        amount_cents, currency, status, resolution,
        reason, response_due_by, is_resolved, raw_event, created_at, updated_at
      ) VALUES (
        v_dispute_id, v_ref, v_brand_id, v_inst_id,
        v_amount, v_currency, v_status, v_resolution, nullif(btrim(p_reason), ''),
        coalesce(p_due_at, p_now + interval '16 hours'), v_event = 'charge.dispute.resolve',
        p_raw, p_now, p_now
      )
      ON CONFLICT (paystack_dispute_id) DO UPDATE SET
        transaction_reference = excluded.transaction_reference,
        brand_id = coalesce(public.paystack_disputes.brand_id, excluded.brand_id),
        order_installment_id = coalesce(
          public.paystack_disputes.order_installment_id, excluded.order_installment_id
        ),
        amount_cents = CASE
          WHEN excluded.amount_cents > 0 THEN excluded.amount_cents
          ELSE public.paystack_disputes.amount_cents
        END,
        currency = excluded.currency,
        status = excluded.status,
        resolution = coalesce(excluded.resolution, public.paystack_disputes.resolution),
        reason = coalesce(excluded.reason, public.paystack_disputes.reason),
        response_due_by = coalesce(
          public.paystack_disputes.response_due_by, excluded.response_due_by
        ),
        is_resolved = public.paystack_disputes.is_resolved OR excluded.is_resolved,
        raw_event = excluded.raw_event,
        updated_at = excluded.updated_at
      RETURNING * INTO v_row;
      v_merchant_lost := v_event = 'charge.dispute.resolve'
        AND lower(coalesce(v_resolution, '')) IN (
          'merchant-accepted', 'merchant_accepted', 'accepted'
        );
      PERFORM public.refresh_paystack_dispute_release_projection(v_release.id, p_now);
      IF v_merchant_lost AND NOT v_row.debt_opened THEN
        UPDATE public.paystack_disputes
        SET debt_opened = true, updated_at = p_now
        WHERE id = v_row.id;
        v_debt_created := true;
      END IF;
      RETURN jsonb_build_object(
        'dispute_id', v_row.id,
        'paystack_dispute_id', v_dispute_id,
        'matched', true,
        'brand_id', v_row.brand_id,
        'order_id', (SELECT oi.order_id FROM public.order_installments oi WHERE oi.id = v_inst_id),
        'order_installment_id', v_inst_id,
        'venue_reservation_id', NULL,
        'rsvp_contribution_id', NULL,
        'venue_menu_order_id', NULL,
        'response_due_by', v_row.response_due_by,
        'is_resolved', v_row.is_resolved OR v_event = 'charge.dispute.resolve',
        'merchant_lost', v_merchant_lost,
        'debt_created', v_debt_created,
        'debt_id', NULL
      );
    END IF;
  END;

  SELECT orders.id, events.brand_id INTO v_order_id, v_brand_id
  FROM public.orders
  JOIN public.events ON events.id = orders.event_id
  WHERE orders.stripe_payment_intent_id = v_ref
  LIMIT 1;
  IF v_order_id IS NULL THEN
    SELECT checkout.order_id, events.brand_id INTO v_order_id, v_brand_id
    FROM public.ticket_checkout_sessions checkout
    JOIN public.orders orders ON orders.id = checkout.order_id
    JOIN public.events events ON events.id = orders.event_id
    WHERE checkout.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL THEN
    SELECT contribution.id, contribution.brand_id
    INTO v_contribution_id, v_brand_id
    FROM public.event_rsvp_contributions contribution
    WHERE contribution.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL THEN
    SELECT checkout.reservation_id, checkout.brand_id
    INTO v_reservation_id, v_brand_id
    FROM public.reservation_checkout_sessions checkout
    WHERE checkout.paystack_reference = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL AND v_reservation_id IS NULL THEN
    SELECT venue_order.id, venue_order.brand_id
    INTO v_venue_order_id, v_brand_id
    FROM public.venue_orders venue_order
    WHERE venue_order.paystack_reference = v_ref
    LIMIT 1;
  END IF;

  IF v_order_id IS NOT NULL THEN
    v_source_type := 'order';
    v_source_id := v_order_id;
  ELSIF v_contribution_id IS NOT NULL THEN
    v_source_type := 'rsvp_contribution';
    v_source_id := v_contribution_id;
  ELSIF v_reservation_id IS NOT NULL THEN
    SELECT checkout.id INTO v_source_id
    FROM public.reservation_checkout_sessions checkout
    WHERE checkout.reservation_id = v_reservation_id
      AND checkout.status = 'completed'
    ORDER BY checkout.created_at DESC
    LIMIT 1;
    v_source_type := 'venue_reservation';
  ELSIF v_venue_order_id IS NOT NULL THEN
    v_source_type := 'venue_menu_order';
    v_source_id := v_venue_order_id;
  END IF;

  IF v_source_type IS NOT NULL AND v_source_id IS NOT NULL THEN
    SELECT release_row.* INTO v_release
    FROM public.payout_release_items item
    JOIN public.brand_payout_releases release_row ON release_row.id = item.release_id
    WHERE item.source_type = v_source_type
      AND item.source_id = v_source_id
      AND release_row.provider = 'paystack'
    ORDER BY CASE WHEN release_row.status = 'released' THEN 0 ELSE 1 END,
      release_row.created_at DESC
    LIMIT 1
    FOR UPDATE OF release_row;
    v_release_found := FOUND;
  END IF;

  IF NOT v_release_found OR v_release.status = 'released' OR v_amount = 0 THEN
    RETURN public.record_paystack_dispute_outcome_pre_3645_append_only_fix(
      p_paystack_dispute_id, p_transaction_reference, p_event_name, p_status,
      p_resolution, p_amount_cents, p_currency, p_reason, p_due_at, p_raw, p_now
    );
  END IF;

  v_due := coalesce(p_due_at, p_now + interval '16 hours');
  INSERT INTO public.paystack_disputes(
    paystack_dispute_id, transaction_reference, brand_id, order_id,
    venue_reservation_id, rsvp_contribution_id, venue_menu_order_id,
    amount_cents, currency, status, resolution,
    reason, response_due_by, is_resolved, raw_event, created_at, updated_at
  ) VALUES (
    v_dispute_id, v_ref, v_brand_id, v_order_id, v_reservation_id,
    v_contribution_id, v_venue_order_id,
    v_amount, v_currency, v_status, v_resolution, nullif(btrim(p_reason), ''),
    v_due, v_event = 'charge.dispute.resolve', p_raw, p_now, p_now
  )
  ON CONFLICT (paystack_dispute_id) DO UPDATE SET
    transaction_reference = excluded.transaction_reference,
    brand_id = coalesce(public.paystack_disputes.brand_id, excluded.brand_id),
    order_id = coalesce(public.paystack_disputes.order_id, excluded.order_id),
    venue_reservation_id = coalesce(
      public.paystack_disputes.venue_reservation_id, excluded.venue_reservation_id
    ),
    rsvp_contribution_id = coalesce(
      public.paystack_disputes.rsvp_contribution_id, excluded.rsvp_contribution_id
    ),
    venue_menu_order_id = coalesce(
      public.paystack_disputes.venue_menu_order_id, excluded.venue_menu_order_id
    ),
    amount_cents = CASE
      WHEN excluded.amount_cents > 0 THEN excluded.amount_cents
      ELSE public.paystack_disputes.amount_cents
    END,
    currency = excluded.currency,
    status = excluded.status,
    resolution = coalesce(excluded.resolution, public.paystack_disputes.resolution),
    reason = coalesce(excluded.reason, public.paystack_disputes.reason),
    response_due_by = coalesce(
      public.paystack_disputes.response_due_by, excluded.response_due_by
    ),
    is_resolved = public.paystack_disputes.is_resolved OR excluded.is_resolved,
    raw_event = excluded.raw_event,
    updated_at = excluded.updated_at
  RETURNING * INTO v_row;

  v_merchant_lost := v_event = 'charge.dispute.resolve'
    AND lower(coalesce(v_resolution, '')) IN (
      'merchant-accepted', 'merchant_accepted', 'accepted'
    );

  PERFORM public.refresh_paystack_dispute_release_projection(v_release.id, p_now);

  IF v_merchant_lost AND NOT v_row.debt_opened THEN
    -- No debt is opened before cash leaves. This flag means the liability was
    -- already accounted in the release projection, preventing a replay after
    -- release from charging the host a second time.
    UPDATE public.paystack_disputes
    SET debt_opened = true, updated_at = p_now
    WHERE id = v_row.id;
    v_debt_created := true;
  END IF;

  RETURN jsonb_build_object(
    'dispute_id', v_row.id,
    'paystack_dispute_id', v_dispute_id,
    'matched', true,
    'brand_id', v_row.brand_id,
    'order_id', v_row.order_id,
    'venue_reservation_id', v_row.venue_reservation_id,
    'rsvp_contribution_id', v_row.rsvp_contribution_id,
    'venue_menu_order_id', v_row.venue_menu_order_id,
    'response_due_by', v_row.response_due_by,
    'is_resolved', v_row.is_resolved OR v_event = 'charge.dispute.resolve',
    'merchant_lost', v_merchant_lost,
    'debt_created', v_debt_created,
    'debt_id', NULL
  );
END;
$fn$;

-- ---- run_payout_release_dark_sweep (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.run_payout_release_dark_sweep(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_row record; v_release_id uuid; v_created integer:=0; v_matured integer;
  v_opened integer; v_refreshed jsonb;
BEGIN
  v_refreshed:=public.refresh_pending_payout_release_truth(p_now);
  v_opened:=public.sync_post_release_postponement_debts(p_now);
  v_matured:=public.mature_postponement_debts(p_now);
  FOR v_row IN
    WITH candidates AS (
      SELECT 'order'::text source_type,o.id source_id,e.brand_id,o.event_id,
        occ.event_date_id,b.payment_provider provider,lower(o.currency::text) currency,
        -- Issue #3872 (F10): gross is what the provider charged (buyer_total_cents);
        -- orders.total_cents is the ticket base on Stripe paths.
        o.created_at finalized_at,occ.end_at anchor_end_at,
        coalesce(o.buyer_total_cents,o.total_cents)::int gross_cents,
        o.refunded_amount_cents refunded_cents,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.order_id=o.id AND d.status NOT IN ('won','warning_closed')),0) disputed_cents,
        -- Issue #3872: only the fee Mingla kept. A refund with
        -- refund_application_fee returns part of the fee to the host's balance.
        greatest(0,coalesce(o.stripe_application_fee_amount_cents,0)-coalesce((
          SELECT sum(rf.application_fee_refunded_cents)::int FROM public.refunds rf
          WHERE rf.order_id=o.id AND rf.status='succeeded'
            AND rf.application_fee_refund_status='succeeded_positive'
        ),0)) mingla_fee_cents,
        coalesce((SELECT sum(ps.partner_share_cents)::int FROM public.partner_splits ps
          WHERE ps.order_id=o.id),0) partner_share_cents,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)) provider_fee_cents,occ.event_date_id::text occurrence_key
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      JOIN public.brands b ON b.id=e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,o.created_at
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='order' AND fs.source_id=o.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE o.payment_status IN ('paid','partial_refund')
        AND o.total_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND o.created_at>b.payout_hold_cutover_at AND e.status<>'cancelled'
      UNION ALL
      SELECT 'rsvp_contribution',c.id,e.brand_id,c.event_id,occ.event_date_id,c.provider,
        lower(c.currency),coalesce(c.paid_at,c.created_at),occ.end_at,
        c.buyer_total_cents,
        greatest(c.refunded_amount_cents,coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.buyer_state='processed'
        ),0)),0,
        greatest(0,coalesce(c.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),
        occ.event_date_id::text
      FROM public.event_rsvp_contributions c JOIN public.events e ON e.id=c.event_id
      JOIN public.brands b ON b.id=c.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        c.event_id,NULL,coalesce(c.paid_at,c.created_at)
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='rsvp_contribution' AND fs.source_id=c.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE c.status IN ('paid','partially_refunded') AND b.payout_hold_cutover_at IS NOT NULL
        AND coalesce(c.paid_at,c.created_at)>b.payout_hold_cutover_at AND e.status<>'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_reservation',s.id,s.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(s.currency::text),r.created_at,s.reserved_for,s.amount_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.buyer_state='processed'
        ),0),0,
        -- Issue #3872: the deposit pays Mingla an application fee; deduct what
        -- Mingla kept (this arm used to deduct 0 and over-release by the fee).
        greatest(0,coalesce(s.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'reservation:'||s.id::text
      FROM public.reservation_checkout_sessions s
      JOIN public.reservations r ON r.id=s.reservation_id
      JOIN public.brands b ON b.id=s.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_reservation' AND fs.source_id=s.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND r.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_menu_order',vo.id,vo.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(vo.currency),vo.confirmed_at,vo.created_at,vo.total_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.buyer_state='processed'
        ),0),
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.venue_order_id=vo.id AND d.status NOT IN ('won','warning_closed')),0),
        -- #3645 flat 4.5%: Mingla take = mingla_fee + platform_service_fee
        -- (equals application_fee_amount at charge). Fee reversals reduce it.
        greatest(0,coalesce(vo.mingla_fee_cents,0)+coalesce(vo.platform_service_fee_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.fee_state='processed'
        ),0)),
        0,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'venue_order:'||vo.id::text
      FROM public.venue_orders vo
      JOIN public.brands b ON b.id=vo.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_menu_order' AND fs.source_id=vo.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE vo.money_path='mingla'
        AND vo.payment_status IN ('paid','partial_refund')
        AND vo.total_cents>0
        AND vo.confirmed_at IS NOT NULL
        AND b.payout_hold_cutover_at IS NOT NULL
        AND vo.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      -- #3645 / #2036 — collected installment arm. Fees live on the row
      -- (application_fee_amount_cents / provider_fee_cents). Gated by
      -- issue_2036_installment_payout_ready() (default false). Skip cancelled
      -- events. Maturity = collected_at + 1 day via attach (payment+24h).
      SELECT 'order_installment',oi.id,e.brand_id,o.event_id,occ.event_date_id,
        -- #3645: the instalment's own immutable provider; never derive from mutable brands.payment_provider.
        oi.provider,
        lower(oi.currency::text),oi.collected_at,oi.collected_at,
        coalesce(oi.buyer_total_cents,oi.amount_cents)::integer,oi.refunded_amount_cents::integer,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE oi.provider='stripe' AND d.stripe_charge_id=oi.stripe_charge_id
            AND d.status NOT IN ('won','warning_closed')),0)
        +coalesce((SELECT sum(pd.amount_cents)::int FROM public.paystack_disputes pd
          WHERE pd.order_installment_id=oi.id AND pd.is_resolved IS NOT TRUE),0),
        coalesce(oi.application_fee_amount_cents,0),0,
        coalesce(oi.provider_fee_cents,0),
        -- Unique per installment payment so a later installment never mutates
        -- an already-released release keyed by shared occurrence (#3645).
        'order_installment:' || oi.id::text
      FROM public.order_installments oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,oi.collected_at
      ) occ ON true
      WHERE public.issue_2036_installment_payout_ready()
        AND oi.status = 'collected'
        AND oi.payout_accounting_state = 'ready'
        AND oi.collected_at IS NOT NULL
        AND oi.amount_cents > 0
        AND oi.application_fee_amount_cents IS NOT NULL
        AND b.payout_hold_cutover_at IS NOT NULL
        AND oi.collected_at > b.payout_hold_cutover_at
        AND e.status <> 'cancelled'
    )
    -- Issue #3645: every sale becomes sweep-eligible about 24 hours after its
    -- payment, independent of the event or reservation date.
    SELECT * FROM candidates c
    WHERE c.finalized_at IS NOT NULL
      AND c.finalized_at + interval '1 day' <= p_now
      AND c.gross_cents-c.refunded_cents-c.disputed_cents>0
      AND NOT EXISTS (SELECT 1 FROM public.payout_release_items i
        WHERE i.source_type=c.source_type AND i.source_id=c.source_id)
    ORDER BY c.finalized_at,c.source_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.source_type||':'||v_row.source_id::text,0)
    );
    IF v_row.source_type IN ('venue_reservation','rsvp_contribution','venue_menu_order') AND EXISTS (
      SELECT 1 FROM public.source_refunds sr
      WHERE sr.source_type=v_row.source_type AND sr.source_id=v_row.source_id
        AND sr.financial_state<>'reconciled'
    ) THEN CONTINUE; END IF;
    v_release_id:=public.attach_payout_release(
      v_row.source_type,v_row.source_id,v_row.brand_id,v_row.event_id,v_row.event_date_id,
      v_row.occurrence_key,v_row.provider,v_row.currency,v_row.finalized_at,v_row.anchor_end_at,
      v_row.gross_cents,v_row.refunded_cents,v_row.disputed_cents,v_row.mingla_fee_cents,
      v_row.partner_share_cents,v_row.provider_fee_cents
    );
    PERFORM public.apply_open_payout_debts(v_release_id,p_now);
    v_created:=v_created+1;
  END LOOP;
  RETURN jsonb_build_object(
    'dark',true,'attached',v_created,'opened_postponement_debts',v_opened,
    'matured_debts',v_matured,'refreshed',v_refreshed,'executed',0
  );
END $function$;

-- =============================================================================
-- §3. Event-cancel refund of one collected instalment (both rails). Same
--     idempotency and response shape as issue_3872_cancel_refund_order, so the
--     fan-out continues with admin_refund_order_commit + the mark below.
-- =============================================================================
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
  v_amount := v_charged - v_inst.refunded_amount_cents - v_unapplied;
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

-- =============================================================================
-- §4. Apply a succeeded refund to one instalment's counter (idempotent per
--     refund + instalment). Fully refunded → status 'refunded'.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_mark_installment_refunded(
  p_installment_id uuid,
  p_refund_id uuid,
  p_amount_cents bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_inst public.order_installments;
  v_charged bigint;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_refund_amount' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.refunds WHERE id = p_refund_id) THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.issue_3645_lock_installment_graph(p_installment_id) IS NULL THEN
    RAISE EXCEPTION 'installment_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id;
  v_charged := coalesce(v_inst.buyer_total_cents, v_inst.amount_cents);

  INSERT INTO public.order_installment_refund_applications (refund_id, installment_id, amount_cents)
  VALUES (p_refund_id, p_installment_id, p_amount_cents)
  ON CONFLICT (refund_id, installment_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'installment_id', v_inst.id,
      'refunded_amount_cents', v_inst.refunded_amount_cents, 'status', v_inst.status);
  END IF;
  IF v_inst.refunded_amount_cents + p_amount_cents > v_charged THEN
    RAISE EXCEPTION 'installment_overrefund' USING ERRCODE = 'P0005';
  END IF;

  UPDATE public.order_installments
     SET refunded_amount_cents = refunded_amount_cents + p_amount_cents,
         status = CASE
           WHEN status = 'collected' AND refunded_amount_cents + p_amount_cents = v_charged
           THEN 'refunded' ELSE status END
   WHERE id = p_installment_id
  RETURNING * INTO v_inst;

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'installment_id', v_inst.id,
    'refunded_amount_cents', v_inst.refunded_amount_cents, 'status', v_inst.status);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_mark_installment_refunded(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_mark_installment_refunded(uuid, uuid, bigint) TO service_role;

COMMIT;
