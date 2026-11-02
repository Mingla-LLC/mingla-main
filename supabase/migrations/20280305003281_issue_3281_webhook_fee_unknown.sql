-- issue #3281 — let Stripe dashboard refund webhooks reconcile with the fee unknown.
--
-- The webhook router passes no application-fee amount (#2097: an ordinary
-- Refund carries no authoritative fee). The function stored 0 beside the
-- default unknown_legacy fee status, which refunds_application_fee_amount_truth_check
-- rejects, so every dashboard refund webhook failed. A new refund row now
-- stores NULL, and a matched pending refund keeps the fee it already has.
-- The body is otherwise the terminal one from 20280301003281.

BEGIN;

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
        -- issue #3281 — no fee amount keeps the fee fields as they are (#2097).
        application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, application_fee_refunded_cents),
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
      -- issue #3281 — unknown until fee evidence arrives (#2097 unknown_legacy).
      p_application_fee_refunded_cents,
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

  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
  -- Recompute cumulative refunded cents and new payment_status.
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = p_order_id AND status = 'succeeded';

  -- issue #3281 — a replay must not undo a settled full cancellation.
  v_new_payment_status := public.issue_3281_settled_payment_status(p_order_id);

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

NOTIFY pgrst, 'reload schema';

COMMIT;
