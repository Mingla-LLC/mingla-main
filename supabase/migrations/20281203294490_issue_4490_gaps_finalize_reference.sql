-- #4490 07 retest 3, N147: pg_venue_order_finalize_payment refuses provider
-- evidence that belongs to another order (defence in depth). Number: the next
-- free number in spec 07's reserved range (264490..354490).
--
-- Re-emits the latest body (20270312001790) unchanged except the marked
-- reference check. Signature and grants unchanged (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.pg_venue_order_finalize_payment(
  p_order_id uuid,
  p_provider text,
  p_paid_amount_cents integer,
  p_currency text,
  p_payment_intent_id text DEFAULT NULL,
  p_charge_id text DEFAULT NULL,
  p_provider_fee_cents integer DEFAULT NULL,
  p_provider_balance_transaction_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_session public.venue_order_sessions%ROWTYPE;
  v_is_settlement boolean;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('stripe','paystack') THEN
    RAISE EXCEPTION 'invalid_provider' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'status', 'not_found');
  END IF;

  -- N147 (#4490): the provider evidence must belong to THIS order. A Paystack
  -- reference is the order's own paystack_reference; a Stripe payment intent,
  -- once recorded, must match. Refused before any write (no caller sends a
  -- foreign reference today: webhook and return both look the order up by it).
  IF p_provider = 'paystack'
     AND (p_payment_intent_id IS NULL OR v_order.paystack_reference IS DISTINCT FROM p_payment_intent_id) THEN
    RETURN jsonb_build_object('matched', false, 'status', 'reference_mismatch');
  END IF;
  IF p_provider = 'stripe' AND p_payment_intent_id IS NOT NULL
     AND v_order.stripe_payment_intent_id IS NOT NULL
     AND v_order.stripe_payment_intent_id <> p_payment_intent_id THEN
    RETURN jsonb_build_object('matched', false, 'status', 'reference_mismatch');
  END IF;

  -- A venue-collected order has no provider and never reaches this path.
  IF v_order.money_path <> 'mingla' THEN
    RETURN jsonb_build_object('matched', false, 'status', 'not_a_mingla_order');
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object(
      'matched', true, 'status', 'replayed', 'orderId', v_order.id,
      'brandId', v_order.brand_id);
  END IF;

  IF p_paid_amount_cents IS DISTINCT FROM v_order.total_cents
     OR upper(coalesce(p_currency,'')) <> v_order.currency THEN
    UPDATE public.venue_orders
       SET payment_status = 'failed', failed_at = now()
     WHERE id = p_order_id;
    RETURN jsonb_build_object(
      'matched', true, 'status', 'amount_or_currency_mismatch',
      'orderId', v_order.id, 'brandId', v_order.brand_id);
  END IF;

  UPDATE public.venue_orders
     SET payment_status = 'paid',
         confirmed_at = coalesce(confirmed_at, now()),
         provider = p_provider,
         stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
         stripe_charge_id = coalesce(stripe_charge_id, p_charge_id)
   WHERE id = p_order_id;

  -- The snapshot the sweep INNER JOINs — written ONLY when the provider told us
  -- the REAL fee (Paystack returns `fees` on verify). A NULL fee writes NOTHING:
  -- per-charge provider fees are immutable ledger inputs and a zero placeholder
  -- would over-release the venue by exactly the processing cost. The order then
  -- WAITS, and `list_missing_payout_source_fees` (extended below) hands it to
  -- the shipped payout-release-sweep fee-capture loop, which resolves the true
  -- balance-transaction fee from the provider. Money is never released on a
  -- guess (P-49.3).
  IF p_provider_fee_cents IS NOT NULL THEN
    INSERT INTO public.payout_source_fee_snapshots (
      source_type, source_id, provider_fee_cents, provider_balance_transaction_id
    ) VALUES (
      'venue_menu_order', p_order_id, greatest(0, p_provider_fee_cents),
      p_provider_balance_transaction_id
    )
    ON CONFLICT (source_type, source_id) DO NOTHING;
  END IF;

  -- P-2a — a paid TAB SETTLEMENT order closes its tab and settles its children.
  -- `closed_by_user_id` is the settlement order's taken_by_user_id: the staff
  -- member who actually closed the tab. The webhook has no user of its own, and
  -- inventing one would make the close-shape CHECK a lie.
  v_is_settlement := coalesce(v_order.metadata->>'tab_settlement','') = 'true';
  IF v_is_settlement AND v_order.taken_by_user_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.venue_order_sessions
     WHERE id = v_order.session_id FOR UPDATE;
    IF FOUND AND v_session.tab_state = 'settling' THEN
      UPDATE public.venue_orders
         SET payment_status = 'paid',
             confirmed_at = coalesce(confirmed_at, now()),
             metadata = metadata || jsonb_build_object(
               'settled_by_venue_order_id', p_order_id::text)
       WHERE session_id = v_session.id
         AND money_path = 'venue_collected'
         AND payment_status = 'pending';
      UPDATE public.venue_order_sessions
         SET tab_state = 'closed', closed_at = now(),
             closed_by_user_id = v_order.taken_by_user_id
       WHERE id = v_session.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'matched', true, 'status', 'finalized', 'orderId', v_order.id,
    'brandId', v_order.brand_id, 'tabClosed', v_is_settlement);
END;
$fn$;

