-- issue #3281 — let Stripe dashboard refund webhooks reconcile with the fee unknown.
--
-- The webhook router passes no application-fee amount (#2097: an ordinary
-- Refund carries no authoritative fee). The function stored 0 beside the
-- default unknown_legacy fee status, which refunds_application_fee_amount_truth_check
-- rejects, so every dashboard refund webhook failed. A new refund row now
-- stores NULL, and a matched pending refund keeps the fee it already has.
--
-- Accepting these rows also exposes two older gaps, closed here:
--   Two dashboard refunds allocated ticket lines before taking the order lock,
--     so both could take the same line. The insert path now locks first and
--     re-reads the refund, so a redelivery that waited finds it. It takes the
--     referral share before the order, in the same order as every settlement.
--   The allocator ignored lines held by pending in-app refunds.
--   Refunds smaller than a ticket each allocated nothing, so an order whose
--     refunds returned the whole charge kept valid tickets. The refund that
--     completes the charge now takes the paid tickets still held.
--   issue_2097_finalize_refund_attempt updated tickets before its order lock,
--     so its ticket counter lock could deadlock a dashboard refund. The order
--     lock now comes first; the rest of that body is the 20280301003281 one.
--   A replayed event re-ran the ticket void for an already settled refund.
--     Tickets are now voided only by the call that creates or settles it.
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
  v_settled boolean := false;
  v_open_lines int;
  v_idx int := 0;
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
    -- issue #3281 — only the call that settles the refund voids its tickets.
    v_settled := FOUND;
    v_refund_id := v_existing_refund_id;
  ELSE
    -- issue #3281 — lock the order before allocating, so two dashboard refunds
    -- never take the same line, and a redelivery that waited here finds the row.
    -- The referral share goes first: a settling refund's share trigger
    -- (issue_3872_refund_share_trigger) takes it before the order everywhere else.
    PERFORM 1 FROM public.payee_shares
    WHERE order_kind = 'ticket' AND order_id = p_order_id AND payee_kind = 'referral'
    FOR UPDATE;
    PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
    SELECT id INTO v_refund_id
    FROM public.refunds
    WHERE stripe_refund_id = p_stripe_refund_id;
    v_existing_refund_id := v_refund_id;
    IF v_refund_id IS NULL THEN
      v_settled := true;
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
                   -- issue #3281 — a pending in-app refund already holds its lines.
                   AND r.status IN ('pending', 'succeeded')
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

      -- issue #3281 — once the order's refunds return the whole charge, this
      -- refund's unallocated cents take the paid tickets still held, so refunds
      -- smaller than a ticket never leave a fully refunded order with valid tickets.
      IF v_remaining_to_allocate > 0
         AND (SELECT COALESCE(SUM(amount_cents), 0) FROM public.refunds
              WHERE order_id = p_order_id AND status = 'succeeded') >= v_order.total_cents THEN
        SELECT count(*) INTO v_open_lines
        FROM public.order_line_items oli
        WHERE oli.order_id = p_order_id AND oli.unit_price_cents > 0
          AND oli.quantity > (
            SELECT COALESCE(SUM(rli.quantity), 0)
            FROM public.refund_line_items rli
            JOIN public.refunds r ON r.id = rli.refund_id
            WHERE rli.order_line_item_id = oli.id AND r.status IN ('pending', 'succeeded'));
        FOR v_line IN
          SELECT oli.id, oli.ticket_type_id,
                 oli.quantity - (
                   SELECT COALESCE(SUM(rli.quantity), 0)
                   FROM public.refund_line_items rli
                   JOIN public.refunds r ON r.id = rli.refund_id
                   WHERE rli.order_line_item_id = oli.id AND r.status IN ('pending', 'succeeded')
                 ) AS open_qty
          FROM public.order_line_items oli
          WHERE oli.order_id = p_order_id AND oli.unit_price_cents > 0
          ORDER BY oli.id ASC
        LOOP
          CONTINUE WHEN v_line.open_qty <= 0;
          EXIT WHEN v_remaining_to_allocate <= 0;
          v_idx := v_idx + 1;
          -- Split only this refund's own cents, so no line claims more than was returned.
          v_alloc_amount := CASE WHEN v_idx >= v_open_lines THEN v_remaining_to_allocate
            ELSE GREATEST(v_remaining_to_allocate / (v_open_lines - v_idx + 1), 1) END;
          INSERT INTO public.refund_line_items (
            refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
          ) VALUES (
            v_refund_id, v_line.id, v_line.ticket_type_id, v_line.open_qty, v_alloc_amount
          );
          v_remaining_to_allocate := v_remaining_to_allocate - v_alloc_amount;
        END LOOP;
      END IF;
    END IF;
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
  -- issue #3281 — a replayed event must not void more tickets than the refund holds.
  IF v_settled THEN
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
  END IF;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'source', CASE WHEN v_existing_refund_id IS NULL THEN 'webhook_new' ELSE 'webhook_match' END
  );
END;
$function$;

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
  PERFORM 1 FROM public.orders WHERE id = v.order_id FOR NO KEY UPDATE;
    UPDATE public.tickets t SET status='refunded' FROM public.ticket_refund_quarantine x
      JOIN public.ticket_refund_attempts a ON a.id=x.attempt_id
      WHERE a.refund_id=v.refund_id AND x.ticket_id=t.id AND t.status='refund_pending';
    SELECT COALESCE(SUM(amount_cents),0) INTO v_total FROM public.refunds
      WHERE order_id=v.order_id AND status='succeeded';
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

NOTIFY pgrst, 'reload schema';

COMMIT;
