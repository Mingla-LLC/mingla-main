-- ORCH-0829-B D-1: Past-expiry in-flight checkout sessions are no longer
-- treated as "genuine retries" by the idempotency-key short-circuit.
--
-- Pre-existing bug: biz_ticket_checkout_create_session (last replaced in
-- migration 20260520000002_orch_0791_session_terminal_tombstone.sql) only
-- tombstones the idempotency_key when the existing session's status is in
-- the terminal set ('paid_completed','free_completed','failed','expired').
-- It does NOT tombstone when the session is past expires_at but still in
-- an in-flight status ('pending_free','requires_payment',
-- 'processing_payment','awaiting_web_redirect') — typically because the
-- buyer abandoned without completing payment and no Stripe webhook ever
-- drove the row to a terminal status. The next retry by the same buyer
-- for the same inputs computes the SAME deterministic idempotency_key,
-- matches the stuck row, short-circuits, and the edge function reuses the
-- stale Stripe PaymentIntent via `ticket_checkout:<sessionId>` Stripe
-- idempotency key. Stripe RN PaymentSheet on iOS 26 cannot present a
-- stale (often >1 hour old) PaymentIntent and hangs at the loading
-- skeleton for ~90s before silently dismissing with no order created.
--
-- Fix: extend the tombstone-eligibility predicate so that any session
-- with expires_at < now() is also a tombstone candidate, regardless of
-- status. Transition the tombstoned row's status to 'expired' in the
-- same UPDATE so the system has consistent state going forward (terminal
-- statuses are preserved as-is); set failed_at to now() on the
-- transition so observability and reconciliation queries can find
-- abandoned-then-tombstoned sessions.
--
-- Invariant established: I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE — see
-- Mingla_Artifacts/INVARIANT_REGISTRY.md (added at ORCH-0829-B CLOSE).
-- CI gate: .github/workflows/strict-grep-mingla-business.yml job
-- orch-0829b-d1-checkout-expiry-tombstone.
--
-- Reference: original RPC at 20260515000013_orch_0777_ticket_checkout_core.sql.
-- Tombstone semantics introduced in 20260520000002_orch_0791_session_terminal_tombstone.sql.
-- This migration only restructures the tombstone-eligibility predicate;
-- the rest of the body is preserved verbatim from 20260520000002.

BEGIN;

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
  p_application_fee_amount_cents integer DEFAULT 0
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
BEGIN
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
    -- ORCH-0791: terminal sessions are historical artifacts; do not reuse them.
    -- ORCH-0829-B D-1: past-expiry in-flight sessions are also dead artifacts;
    -- their Stripe PaymentIntent (if any) is stale and Stripe SDK cannot
    -- present a stale clientSecret. Treat them as tombstone candidates and
    -- transition status to 'expired' so the system state is consistent.
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
      -- Fall through to the normal create path below.
    ELSE
      -- In-flight session within its expiry window — preserve I-CHECKOUT-IDEMPOTENT
      -- for genuine retries during checkout.
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
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items
      );
    END IF;
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, s.stripe_account_id, s.charges_enabled
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

  v_session_id := gen_random_uuid();

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
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

    v_total := v_total + (v_ticket_type.price_cents * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_ticket_type.price_cents,
      'totalCents', v_ticket_type.price_cents * v_qty
    ));
  END LOOP;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE WHEN v_total > 0 THEN v_event.stripe_account_id ELSE NULL END;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    COALESCE(v_currency, 'GBP'::character(3)), v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0)
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
    'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items
  );
END;
$$;

COMMIT;
