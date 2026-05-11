-- ORCH-0787 — Production-grade order refund + cancel flow.
--
-- Adds:
--   1. 'cancelled' value to orders.payment_status CHECK
--   2. orders.cancelled_at / cancelled_by / cancellation_reason / refunded_amount_cents columns
--   3. refunds.currency / stripe_payment_intent_id / stripe_charge_id / application_fee_refunded_cents / processed_at / metadata
--   4. refund_line_items table (line-level accounting)
--   5. Direct-predicate SELECT RLS on refunds (prevents RLS-RETURNING-OWNER-GAP per I-PROPOSED-H)
--   6. biz_refund_order, biz_refund_order_commit, biz_refund_order_commit_from_webhook, biz_cancel_order RPCs
--   7. Generated column payment_webhook_events.account_id (folded Q-7 / S-09 orphan-service fix)
--
-- Spec: SPEC_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md §2.
-- Investigation: INVESTIGATION_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md.

BEGIN;

-- =============================================================
-- §2.2 orders.payment_status: add 'cancelled'
-- =============================================================

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'pending'::text,
    'paid'::text,
    'failed'::text,
    'refunded'::text,
    'partial_refund'::text,
    'cancelled'::text
  ]));

-- =============================================================
-- §2.3 orders: new columns (cancellation state + refund cache)
-- =============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS refunded_amount_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_cancellation_reason_length;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancellation_reason_length
  CHECK (cancellation_reason IS NULL OR (length(trim(cancellation_reason)) BETWEEN 10 AND 200));

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_refunded_amount_nonnegative;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_refunded_amount_nonnegative
  CHECK (refunded_amount_cents >= 0);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_refunded_amount_not_exceed_total;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_refunded_amount_not_exceed_total
  CHECK (refunded_amount_cents <= total_cents);

COMMENT ON COLUMN public.orders.cancelled_at IS
  'ORCH-0787: when the order was intentionally cancelled by the organiser (not gateway failure). NULL for paid/refunded/failed.';
COMMENT ON COLUMN public.orders.refunded_amount_cents IS
  'ORCH-0787: denormalised cache of SUM(refunds.amount_cents WHERE status=''succeeded''). Source of truth is the refunds table.';

-- =============================================================
-- §2.4 refunds: new columns
-- =============================================================

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS currency character(3) NOT NULL DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS application_fee_refunded_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_stripe_refund_id
  ON public.refunds(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refunds_order_id_status
  ON public.refunds(order_id, status);

CREATE INDEX IF NOT EXISTS idx_refunds_metadata_idempotency_key
  ON public.refunds((metadata->>'idempotency_key'))
  WHERE metadata->>'idempotency_key' IS NOT NULL;

ALTER TABLE public.refunds
  DROP CONSTRAINT IF EXISTS refunds_reason_length;
ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_reason_length
  CHECK (reason IS NULL OR (length(trim(reason)) BETWEEN 10 AND 200));

ALTER TABLE public.refunds
  DROP CONSTRAINT IF EXISTS refunds_application_fee_nonnegative;
ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_application_fee_nonnegative
  CHECK (application_fee_refunded_cents >= 0);

-- =============================================================
-- §2.5 refund_line_items
-- =============================================================

CREATE TABLE IF NOT EXISTS public.refund_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
  order_line_item_id uuid NOT NULL REFERENCES public.order_line_items(id) ON DELETE RESTRICT,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_line_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT refund_line_items_amount_positive CHECK (amount_cents > 0),
  UNIQUE (refund_id, order_line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_refund_line_items_refund_id ON public.refund_line_items(refund_id);
CREATE INDEX IF NOT EXISTS idx_refund_line_items_order_line_item_id ON public.refund_line_items(order_line_item_id);

ALTER TABLE public.refund_line_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.refund_line_items IS
  'ORCH-0787: line-level refund accounting. Cumulative SUM(quantity) per (order_line_item_id) over succeeded refunds must not exceed order_line_items.quantity. Enforced by biz_refund_order RPC.';

-- =============================================================
-- §2.6 RLS policies — direct-predicate SELECT to prevent RLS-RETURNING-OWNER-GAP
-- =============================================================

-- Prevents RLS-RETURNING-OWNER-GAP (I-PROPOSED-H). The helper-based policy fails under .insert().select() chains.
DROP POLICY IF EXISTS "Refunds owner direct select for RETURNING" ON public.refunds;
CREATE POLICY "Refunds owner direct select for RETURNING"
  ON public.refunds
  FOR SELECT
  TO authenticated
  USING (
    initiated_by = auth.uid()
    OR
    biz_can_manage_payments_for_brand_for_caller(biz_order_brand_id(order_id))
  );

-- refund_line_items RLS: inherit refund-side access + direct-predicate SELECT for RETURNING safety.
DROP POLICY IF EXISTS "Refund line items inherit refund access" ON public.refund_line_items;
CREATE POLICY "Refund line items inherit refund access"
  ON public.refund_line_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.refunds r
      WHERE r.id = refund_line_items.refund_id
        AND biz_can_manage_payments_for_brand_for_caller(biz_order_brand_id(r.order_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.refunds r
      WHERE r.id = refund_line_items.refund_id
        AND biz_can_manage_payments_for_brand_for_caller(biz_order_brand_id(r.order_id))
    )
  );

DROP POLICY IF EXISTS "Refund line items direct select for RETURNING" ON public.refund_line_items;
CREATE POLICY "Refund line items direct select for RETURNING"
  ON public.refund_line_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.refunds r
      WHERE r.id = refund_line_items.refund_id
        AND r.initiated_by = auth.uid()
    )
  );

-- =============================================================
-- §7.1 Folded Q-7: payment_webhook_events.account_id generated column
--   Fixes brandStripeOrphanedRefundsService.ts column-name mismatch (S-09).
-- =============================================================

ALTER TABLE public.payment_webhook_events
  ADD COLUMN IF NOT EXISTS account_id text
  GENERATED ALWAYS AS (payload->>'account') STORED;

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_account_id_type
  ON public.payment_webhook_events(account_id, type)
  WHERE account_id IS NOT NULL;

COMMENT ON COLUMN public.payment_webhook_events.account_id IS
  'ORCH-0787 / S-09 fix: generated column mirroring payload->>''account'' so brandStripeOrphanedRefundsService can scope by connected account without parsing JSONB at read time.';

-- =============================================================
-- §2.7 RPC: biz_refund_order — two-step pattern (pending → commit).
--   Step 1 here: validate + insert refund row in 'pending' status + insert refund_line_items.
--   Does NOT advance orders.payment_status (that happens in commit RPC after Stripe acks).
-- =============================================================

CREATE OR REPLACE FUNCTION public.biz_refund_order(
  p_order_id uuid,
  p_lines jsonb,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_all_lines_fully_refunded boolean;
  v_proposed_new_payment_status text;
  v_existing_pending uuid;
BEGIN
  -- 0. Idempotency precheck: if a pending row with this idempotency key already exists, return it
  SELECT id INTO v_existing_pending
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
    AND status = 'pending'
  LIMIT 1;

  IF v_existing_pending IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    RETURN jsonb_build_object(
      'refund_id', v_existing_pending,
      'order_id', p_order_id,
      'amount_cents', (SELECT amount_cents FROM public.refunds WHERE id = v_existing_pending),
      'currency', v_order.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status', 'partial_refund',
      'is_full_refund', false,
      'idempotent_replay', true
    );
  END IF;

  -- 1. Load order + verify caller permission
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate order state
  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status USING ERRCODE = 'P0002';
  END IF;

  -- 3. Validate reason
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  -- 4. Validate lines: per-line cumulative refund must not exceed line quantity
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded, v_line_item.quantity
        USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents := v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  -- 5. Insert public.refunds row (status='pending' — edge function flips to 'succeeded' via commit RPC)
  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id,
    v_refund_amount_cents,
    v_order.currency,
    trim(p_reason),
    v_caller,
    'pending',
    v_order.stripe_payment_intent_id,
    v_order.stripe_charge_id,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  ) RETURNING id INTO v_refund_id;

  -- 6. Insert refund_line_items
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.refund_line_items (
      refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
    )
    SELECT
      v_refund_id,
      (v_line->>'order_line_item_id')::uuid,
      oli.ticket_type_id,
      (v_line->>'quantity')::int,
      (v_line->>'amount_cents')::int
    FROM public.order_line_items oli
    WHERE oli.id = (v_line->>'order_line_item_id')::uuid;
  END LOOP;

  -- 7. Compute proposed new payment_status (based on pending+succeeded refunds; final status set in commit)
  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status IN ('pending', 'succeeded')
      )
  ) INTO v_all_lines_fully_refunded;

  v_proposed_new_payment_status := CASE
    WHEN v_all_lines_fully_refunded THEN 'refunded'
    ELSE 'partial_refund'
  END;

  -- 8. Return manifest. orders.payment_status is NOT advanced here.
  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', p_order_id,
    'amount_cents', v_refund_amount_cents,
    'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded,
    'idempotent_replay', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.biz_refund_order(uuid, jsonb, text, text) TO authenticated;

COMMENT ON FUNCTION public.biz_refund_order(uuid, jsonb, text, text) IS
  'ORCH-0787: do NOT advance orders.payment_status here. Use biz_refund_order_commit after Stripe acks. Refund row stays pending between calls; webhook reconciles if Stripe responds before commit fires.';

-- =============================================================
-- §2.7 RPC: biz_refund_order_commit — finalises refund after Stripe success/failure.
--   Flips refunds.status, sets stripe_refund_id + processed_at + application_fee_refunded_cents,
--   advances orders.payment_status + orders.refunded_amount_cents, and voids the oldest N tickets
--   per affected line item (defense-in-depth Q-4 + oldest-first Q-3).
-- =============================================================

CREATE OR REPLACE FUNCTION public.biz_refund_order_commit(
  p_refund_id uuid,
  p_stripe_refund_id text,
  p_application_fee_refunded_cents integer,
  p_status text
)
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
    -- Idempotent: same commit fired twice (e.g., retry). Return the existing terminal state.
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
    SET status = 'failed', processed_at = now()
    WHERE id = p_refund_id;
    -- Failed refunds do NOT void tickets or advance orders.payment_status.
    -- The pending refund_line_items rows stay so the caller can retry (idempotency key)
    -- or so the operator can reconcile; cleanup is out of scope for this RPC.
    RETURN jsonb_build_object('refund_id', p_refund_id, 'status', 'failed', 'idempotent_replay', false);
  END IF;

  -- p_status = 'succeeded'
  UPDATE public.refunds
  SET status = 'succeeded',
      stripe_refund_id = p_stripe_refund_id,
      application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, 0),
      processed_at = now()
  WHERE id = p_refund_id;

  -- Compute cumulative refunded cents from succeeded refunds only.
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = v_order.id AND status = 'succeeded';

  -- Determine new payment_status from succeeded refund_line_items.
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

  -- Defense-in-depth (Q-4): void the oldest N tickets per affected line item (Q-3 oldest-first).
  -- Scanner gates on payment_status<>'paid' AND on tickets.status='valid'. Both must flip together.
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
    'idempotent_replay', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.biz_refund_order_commit(uuid, text, integer, text) TO authenticated;

-- =============================================================
-- Webhook-side commit variant: service-role only, no caller permission check.
--   Used by stripeWebhookRouter.handleRefundEvent when reconciling
--   dashboard-initiated refunds or post-edge-fn-success webhooks.
--   Race mitigation: matches on stripe_refund_id OR metadata.idempotency_key
--   (the latter is needed when the in-app refund row is still pending and
--   has not yet received stripe_refund_id).
-- =============================================================

CREATE OR REPLACE FUNCTION public.biz_refund_order_commit_from_webhook(
  p_order_id uuid,
  p_stripe_refund_id text,
  p_amount_cents integer,
  p_currency character,
  p_application_fee_refunded_cents integer,
  p_idempotency_key_hint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing_refund_id uuid;
  v_refund_id uuid;
  v_line record;
  v_remaining_to_allocate int;
  v_alloc_qty int;
  v_alloc_amount int;
  v_new_payment_status text;
  v_total_refunded_cents int;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Match path 1: refunds.stripe_refund_id = p_stripe_refund_id (idempotent webhook replay).
  SELECT id INTO v_existing_refund_id
  FROM public.refunds
  WHERE stripe_refund_id = p_stripe_refund_id;

  -- Match path 2: in-app refund pre-recorded with idempotency_key hint, still pending.
  IF v_existing_refund_id IS NULL AND p_idempotency_key_hint IS NOT NULL THEN
    SELECT id INTO v_existing_refund_id
    FROM public.refunds
    WHERE order_id = p_order_id
      AND status = 'pending'
      AND metadata->>'idempotency_key' = p_idempotency_key_hint
    LIMIT 1;
  END IF;

  IF v_existing_refund_id IS NOT NULL THEN
    -- Advance the existing row to succeeded (if pending) — no-op if already terminal.
    UPDATE public.refunds
    SET status = 'succeeded',
        stripe_refund_id = COALESCE(stripe_refund_id, p_stripe_refund_id),
        application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, 0),
        processed_at = COALESCE(processed_at, now())
    WHERE id = v_existing_refund_id
      AND status = 'pending';
    v_refund_id := v_existing_refund_id;
  ELSE
    -- Dashboard-initiated refund with no in-app pre-record.
    -- Create a new refund row + proportional refund_line_items (oldest-first allocation per Q-3).
    INSERT INTO public.refunds (
      order_id, amount_cents, currency, reason, initiated_by, status,
      stripe_payment_intent_id, stripe_charge_id, stripe_refund_id,
      application_fee_refunded_cents, processed_at, metadata
    ) VALUES (
      p_order_id,
      p_amount_cents,
      p_currency,
      'Dashboard-initiated refund (Stripe)',
      NULL,
      'succeeded',
      v_order.stripe_payment_intent_id,
      v_order.stripe_charge_id,
      p_stripe_refund_id,
      COALESCE(p_application_fee_refunded_cents, 0),
      now(),
      jsonb_build_object('source', 'webhook_reconciliation')
    ) RETURNING id INTO v_refund_id;

    -- Proportional allocation: walk order_line_items oldest-first, take as much qty as needed
    -- to cover p_amount_cents at unit_price_cents per ticket.
    v_remaining_to_allocate := p_amount_cents;
    FOR v_line IN
      SELECT id, ticket_type_id, quantity, unit_price_cents, total_cents,
             (
               SELECT COALESCE(SUM(rli.quantity), 0)
               FROM public.refund_line_items rli
               JOIN public.refunds r ON r.id = rli.refund_id
               WHERE rli.order_line_item_id = order_line_items.id
                 AND r.status = 'succeeded'
                 AND r.id <> v_refund_id
             ) AS already_refunded_qty
      FROM public.order_line_items
      WHERE order_id = p_order_id
      ORDER BY id ASC
    LOOP
      EXIT WHEN v_remaining_to_allocate <= 0;
      -- How many units can we refund from this line?
      v_alloc_qty := LEAST(
        v_line.quantity - v_line.already_refunded_qty,
        CASE WHEN v_line.unit_price_cents > 0
          THEN v_remaining_to_allocate / v_line.unit_price_cents
          ELSE 0
        END
      );
      IF v_alloc_qty <= 0 THEN
        CONTINUE;
      END IF;
      v_alloc_amount := v_alloc_qty * v_line.unit_price_cents;
      INSERT INTO public.refund_line_items (
        refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
      ) VALUES (
        v_refund_id, v_line.id, v_line.ticket_type_id, v_alloc_qty, v_alloc_amount
      );
      v_remaining_to_allocate := v_remaining_to_allocate - v_alloc_amount;
    END LOOP;
    -- If we couldn't fully allocate (e.g., partial-cent refund), the leftover stays at the
    -- order level only (orders.refunded_amount_cents reflects the Stripe truth via re-aggregation below).
  END IF;

  -- Recompute cumulative refunded cents and new payment_status.
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = p_order_id AND status = 'succeeded';

  IF NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
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
  WHERE id = p_order_id;

  -- Defense-in-depth ticket void (idempotent — only flips tickets still 'valid').
  FOR v_line IN
    SELECT rli.ticket_type_id, rli.quantity
    FROM public.refund_line_items rli
    WHERE rli.refund_id = v_refund_id
  LOOP
    UPDATE public.tickets t
    SET status = 'refunded'
    WHERE t.id IN (
      SELECT t2.id
      FROM public.tickets t2
      WHERE t2.order_id = p_order_id
        AND t2.ticket_type_id = v_line.ticket_type_id
        AND t2.status = 'valid'
      ORDER BY t2.created_at ASC
      LIMIT v_line.quantity
    );
  END LOOP;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'source', CASE WHEN v_existing_refund_id IS NULL THEN 'webhook_new' ELSE 'webhook_match' END
  );
END;
$function$;

-- Service-role only; never granted to authenticated. Called from the webhook handler.
REVOKE ALL ON FUNCTION public.biz_refund_order_commit_from_webhook(uuid, text, integer, character, integer, text) FROM PUBLIC;

-- =============================================================
-- §2.8 RPC: biz_cancel_order — free orders only (paid orders use refund flow per Q-1).
-- =============================================================

CREATE OR REPLACE FUNCTION public.biz_cancel_order(
  p_order_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_caller uuid := auth.uid();
  v_cancelled_at timestamptz := now();
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- Q-1: paid orders cannot be cancelled — they must be refunded.
  IF v_order.payment_method <> 'free' THEN
    RAISE EXCEPTION 'paid_orders_must_be_refunded_not_cancelled' USING ERRCODE = 'P0006';
  END IF;

  IF v_order.payment_status <> 'paid' THEN
    -- Idempotent: if already cancelled, return existing state.
    IF v_order.payment_status = 'cancelled' THEN
      RETURN jsonb_build_object(
        'order_id', p_order_id,
        'status', 'cancelled',
        'cancelled_at', v_order.cancelled_at,
        'idempotent_replay', true
      );
    END IF;
    RAISE EXCEPTION 'order_not_cancellable: status=%', v_order.payment_status USING ERRCODE = 'P0007';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  UPDATE public.orders
  SET payment_status = 'cancelled',
      cancelled_at = v_cancelled_at,
      cancelled_by = v_caller,
      cancellation_reason = trim(p_reason),
      updated_at = v_cancelled_at
  WHERE id = p_order_id;

  UPDATE public.tickets
  SET status = 'void'
  WHERE order_id = p_order_id
    AND status = 'valid';

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'status', 'cancelled',
    'cancelled_at', v_cancelled_at,
    'idempotent_replay', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.biz_cancel_order(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.biz_cancel_order(uuid, text) IS
  'ORCH-0787: free orders only. Paid orders raise paid_orders_must_be_refunded_not_cancelled (Q-1 operator decision).';

COMMIT;
