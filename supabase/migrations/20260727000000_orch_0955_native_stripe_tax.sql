-- ORCH-0955 [Native Stripe Tax for Platforms].
-- Adds persistence for native Stripe Tax calculations, committed tax
-- transactions, and refund reversals. Also refreshes the latest
-- biz_ticket_checkout_create_session definition so the edge function can
-- reuse the RPC-owned per-tier line items for tax.calculations.create.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_tax_transaction_id text,
  ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;

COMMENT ON COLUMN public.orders.stripe_tax_transaction_id IS
  'Stripe Tax transaction id (tt_...) committed by stripeWebhookRouter.handleTicketCheckoutPaymentIntent on payment_intent.succeeded via tax.transactions.createFromCalculation. NULL on free / pre-ORCH-0955 historical orders. Connected-account-scoped (brand is merchant of record per ORCH-0843 direct-charge). ORCH-0955.';

COMMENT ON COLUMN public.orders.tax_breakdown IS
  'Full tax_breakdown array from Stripe Tax transaction (per-jurisdiction line items). Populated alongside stripe_tax_transaction_id. NULL when tax_amount_cents=0. Used for per-jurisdiction receipt rendering. ORCH-0955.';

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS stripe_tax_transaction_id text;

COMMENT ON COLUMN public.refunds.stripe_tax_transaction_id IS
  'Stripe Tax reversal transaction id (tt_...) issued by refund-order.index.ts after stripe.refunds.create succeeds, via tax.transactions.createReversal against the original orders.stripe_tax_transaction_id. NULL when the parent order had no committed tax. ORCH-0955.';

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS tax_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_calculation_id text;

COMMENT ON COLUMN public.ticket_checkout_sessions.tax_amount_cents IS
  'Stripe Tax amount in cents, populated by ticket-checkout-create after tax.calculations.create. Copied into orders.tax_amount_cents by biz_ticket_checkout_finalize on payment_intent.succeeded. ORCH-0955.';

COMMENT ON COLUMN public.ticket_checkout_sessions.tax_calculation_id IS
  'Stripe tax_calculation id (taxcalc_...). Read by stripeWebhookRouter.handleTicketCheckoutPaymentIntent to call tax.transactions.createFromCalculation. ORCH-0955.';

COMMENT ON COLUMN public.orders.tax_amount_cents IS
  'Stripe Tax amount collected on this order, in cents. Native paid path (ORCH-0955): populated by stripeWebhookRouter.handleTicketCheckoutPaymentIntent from the Stripe Tax transaction.amount_total (calc result). Web Checkout Session path (ORCH-0804): populated from session.total_details.amount_tax. Brand is merchant of record (Connect direct charge per ORCH-0843 - connected account is merchant of record implicitly via Stripe-Account header; automatic_tax.liability is NOT set on direct charges).';

COMMENT ON COLUMN public.orders.tax_calculation_id IS
  'Stripe tax_calculation reference (taxcalc_...). Native paid path (ORCH-0955): minted in ticket-checkout-create.index.ts before paymentIntents.create; passed forward to webhook commit via PI metadata.mingla_tax_calculation_id. Web Checkout Session path (ORCH-0804): minted by Stripe automatic_tax on session creation. NULL on free / door-sale / pre-ORCH-0804 historical orders.';

-- Replaces the latest public.biz_ticket_checkout_create_session body
-- (ORCH-0915) with the same signature plus lineItems/subtotalCents in the
-- returned JSONB contract.

DROP FUNCTION IF EXISTS public.biz_ticket_checkout_create_session(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean,
  jsonb,
  text,
  timestamptz,
  integer
);

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,
  p_payment_plan_choice text DEFAULT 'auto'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
  v_is_trip boolean := false;
  v_line_count int := 0;
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_full_price_cents bigint;
  v_deposit_cents bigint;
  v_installments_out jsonb := '[]'::jsonb;
  v_running_installment_total bigint := 0;
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  v_last_ord int := 0;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;

  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'subtotalCents', v_existing.total_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items,
        'lineItems', v_items,
        'installmentSchedule', v_existing.installment_schedule
      );
    END IF;
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         s.stripe_account_id, s.charges_enabled
    INTO v_event
    FROM public.events e
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility <> 'public' OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_qty := COALESCE((v_line ->> 'quantity')::integer, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      RAISE EXCEPTION 'ticket_sales_not_started';
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    IF NOT v_ticket_type.is_unlimited THEN
      SELECT COUNT(*)
        INTO v_sold
        FROM public.tickets t
       WHERE t.ticket_type_id = v_ticket_type.id
         AND t.status IN ('valid', 'used', 'transferred');

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment');

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_qty > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
    END IF;

    IF v_currency IS NULL THEN
      v_currency := v_ticket_type.currency;
    ELSIF v_currency <> v_ticket_type.currency THEN
      RAISE EXCEPTION 'mixed_currency_cart';
    END IF;

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
    END IF;

    v_total := v_total + (v_ticket_type.price_cents * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_ticket_type.price_cents,
      'totalCents', v_ticket_type.price_cents * v_qty
    ));
  END LOOP;

  IF v_is_trip AND v_first_ticket_type_id IS NOT NULL THEN
    SELECT tpt.tier_metadata
      INTO v_tier_metadata
      FROM public.trip_pricing_tiers tpt
     WHERE tpt.event_id = p_event_id
       AND tpt.ticket_type_id = v_first_ticket_type_id;

    IF FOUND AND v_tier_metadata IS NOT NULL THEN
      v_installments_input := v_tier_metadata -> 'installments';
      IF v_installments_input IS NOT NULL AND jsonb_typeof(v_installments_input) = 'object' THEN
        IF v_line_count > 1 THEN
          RAISE EXCEPTION 'ticket_lines_mixed_with_installments';
        END IF;

        IF p_payment_plan_choice <> 'full' THEN
          v_deposit_pct := COALESCE((v_installments_input ->> 'deposit_pct')::numeric, 0);
          v_inst_array := v_installments_input -> 'installments';

          IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
            RAISE EXCEPTION 'installment_deposit_pct_out_of_range';
          END IF;
          IF v_inst_array IS NULL OR jsonb_typeof(v_inst_array) <> 'array' THEN
            RAISE EXCEPTION 'installment_schedule_malformed';
          END IF;

          v_inst_count := jsonb_array_length(v_inst_array);
          IF v_inst_count < 1 OR v_inst_count > 11 THEN
            RAISE EXCEPTION 'installment_count_out_of_range';
          END IF;

          v_pct_sum := v_deposit_pct;
          v_full_price_cents := v_total;

          FOR v_i IN 0 .. v_inst_count - 1 LOOP
            v_inst_item := v_inst_array -> v_i;
            v_inst_ord := COALESCE((v_inst_item ->> 'ordinal')::int, -1);
            v_inst_pct := COALESCE((v_inst_item ->> 'pct')::numeric, 0);
            v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
            v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

            IF v_inst_ord <> v_i + 1 THEN
              RAISE EXCEPTION 'installment_ordinal_invalid';
            END IF;
            IF v_inst_pct <= 0 OR v_inst_pct >= 100 THEN
              RAISE EXCEPTION 'installment_pct_out_of_range';
            END IF;
            IF (v_inst_days IS NULL AND v_inst_fixed IS NULL)
               OR (v_inst_days IS NOT NULL AND v_inst_fixed IS NOT NULL) THEN
              RAISE EXCEPTION 'installment_due_mode_invalid';
            END IF;

            v_pct_sum := v_pct_sum + v_inst_pct;
            v_last_ord := v_inst_ord;
          END LOOP;

          IF abs(v_pct_sum - 100) > 0.01 THEN
            RAISE EXCEPTION 'installment_pct_sum_mismatch';
          END IF;

          v_deposit_cents := floor(v_full_price_cents::numeric * v_deposit_pct / 100)::bigint;
          v_running_installment_total := 0;
          v_installments_out := '[]'::jsonb;

          FOR v_i IN 0 .. v_inst_count - 1 LOOP
            v_inst_item := v_inst_array -> v_i;
            v_inst_ord := (v_inst_item ->> 'ordinal')::int;
            v_inst_pct := (v_inst_item ->> 'pct')::numeric;
            v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
            v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

            IF v_inst_days IS NOT NULL THEN
              IF v_inst_days < 1 THEN
                RAISE EXCEPTION 'installment_days_after_booking_invalid';
              END IF;
              v_inst_due := v_now + (v_inst_days || ' days')::interval;
            ELSE
              v_inst_due := (v_inst_fixed)::timestamptz;
            END IF;

            IF v_i = 0 AND v_inst_due <= v_now THEN
              RAISE EXCEPTION 'installment_schedule_past_due_at_booking';
            END IF;

            IF v_i < v_inst_count - 1 THEN
              v_inst_amount := floor(v_full_price_cents::numeric * v_inst_pct / 100)::bigint;
              v_running_installment_total := v_running_installment_total + v_inst_amount;
            ELSE
              v_inst_amount := v_full_price_cents - v_deposit_cents - v_running_installment_total;
              IF v_inst_amount <= 0 THEN
                RAISE EXCEPTION 'installment_rounding_invalid';
              END IF;
            END IF;

            v_installments_out := v_installments_out || jsonb_build_array(jsonb_build_object(
              'ordinal', v_inst_ord,
              'pct', v_inst_pct,
              'amountCents', v_inst_amount,
              'dueAt', to_char(v_inst_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            ));
          END LOOP;

          v_total := v_deposit_cents::integer;
        END IF;
      END IF;
    END IF;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE WHEN v_total > 0 THEN v_event.stripe_account_id ELSE NULL END;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    COALESCE(v_currency, 'GBP'::character(3)), v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE
      WHEN v_installments_out <> '[]'::jsonb THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_deposit_cents,
          'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
          'installments', v_installments_out
        )
      ELSE NULL
    END
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', CASE
      WHEN v_installments_out <> '[]'::jsonb THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_deposit_cents,
          'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
          'installments', v_installments_out
        )
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text) TO service_role;

-- Replace the 4-argument refund commit RPC with a backward-compatible
-- 5-argument version whose new tax transaction id parameter defaults to NULL.
DROP FUNCTION IF EXISTS public.biz_refund_order_commit(uuid, text, integer, text);

CREATE OR REPLACE FUNCTION public.biz_refund_order_commit(
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
      processed_at = now()
  WHERE id = p_refund_id;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = v_order.id AND status = 'succeeded';

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
$function$;

GRANT EXECUTE ON FUNCTION public.biz_refund_order_commit(uuid, text, integer, text, text) TO authenticated;

COMMIT;
