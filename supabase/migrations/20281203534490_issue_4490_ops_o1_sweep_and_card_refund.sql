-- Issue #4490, spec 08 O1 part 2 (slot 58, "spare for fixes"): two O1
-- server rules the Till core left open.
--
-- 1. Held rounds that never joined a check (spec 08 §3 O1: "a held round not
--    attached within 10 minutes is cancelled by venue-offer-sweep"). A Till
--    round is inserted held by the edge and then attached; if the attach
--    fails and the edge's own cancel is lost, the round would sit held for
--    ever. The sweep cancels exactly those: held, unpaid, staff, venue
--    collected, no Till line, older than 10 minutes. Bounded, idempotent,
--    never touches a paid, sent, attached or carrier row. The reprice no
--    longer adopts a HELD round (only attach_round adds one), so a round that
--    failed to attach cannot join a check silently before the sweep runs; nor
--    a payment_only carrier (T1), which is written before its payment links
--    it (the two foreign keys are not deferrable).
-- 2. One card refund per card payment (spec 08 §3 O1 Refunds; §9 / §11.4
--    item 6 / §12 item 1): issue_4490_till_mint_carrier_refund mints an
--    amount-aware source_refunds row (refund kind venue_till_refund) on the
--    payment's carrier venue order, fee reversed pro rata; the source_refunds
--    unique key makes it one per carrier; anything further is paid back in
--    cash and recorded. No carrier exists until tap / scan to pay (O2); the
--    path is built and proven here so O2 adds no refund migration.
-- No venue_id column is added (the #2099 dependency seal is unchanged).
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o1p2_patch(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O1 part 2 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1a. The reprice adopts a legacy tab's rounds, never a held Till round or a
--     carrier.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o1p2_patch(
  'public.issue_4490_till_reprice(uuid)'::regprocedure,
  $old$    AND o.till_payment_id IS NULL
    AND coalesce(o.metadata->>'tab_settlement', '') <> 'true'
    AND NOT EXISTS$old$,
  $new$    AND o.till_payment_id IS NULL
    AND o.fulfillment_status NOT IN ('held', 'payment_only')
    AND coalesce(o.metadata->>'tab_settlement', '') <> 'true'
    AND NOT EXISTS$new$
);

-- ---------------------------------------------------------------------------
-- 1b. The sweep (called by venue-offer-sweep every 15 minutes).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_sweep_held_rounds(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  WITH stale AS (
    SELECT o.id
    FROM public.venue_orders o
    WHERE o.fulfillment_status = 'held'
      AND o.payment_status = 'pending'
      AND o.source = 'staff'
      AND o.money_path = 'venue_collected'
      AND o.till_payment_id IS NULL
      AND o.created_at < now() - interval '10 minutes'
      AND NOT EXISTS (SELECT 1 FROM public.venue_till_lines l WHERE l.venue_order_id = o.id)
    ORDER BY o.created_at, o.id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
    FOR UPDATE SKIP LOCKED
  ), swept AS (
    UPDATE public.venue_orders o
    SET fulfillment_status = 'cancelled',
        payment_status = 'cancelled',
        cancelled_at = now(),
        metadata = o.metadata || jsonb_build_object('till_held_swept', true)
    FROM stale
    WHERE o.id = stale.id
    RETURNING o.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_ids FROM swept;
  RETURN jsonb_build_object('cancelled', COALESCE(array_length(v_ids, 1), 0));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. One card refund per card payment.
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_refunds
  DROP CONSTRAINT IF EXISTS source_refunds_refund_kind_check;
ALTER TABLE public.source_refunds
  ADD CONSTRAINT source_refunds_refund_kind_check CHECK (refund_kind = ANY (ARRAY[
    'venue_eligible_cancel','rsvp_discretionary','event_cancel','stay_cancellation',
    'venue_order_guest_cancel','venue_order_venue_approved','late_payment_no_value',
    'checkout_provider_reference_unresolved','venue_staff_cancel','venue_till_refund']));

CREATE OR REPLACE FUNCTION public.issue_4490_till_mint_carrier_refund(
  p_payment_id uuid,
  p_amount_minor bigint,
  p_tip_minor bigint,
  p_actor uuid,
  p_device_user uuid,
  p_reason text,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment public.venue_till_payments%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_carrier public.venue_orders%ROWTYPE;
  v_existing public.venue_till_refunds%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_amount bigint := COALESCE(p_amount_minor, 0);
  v_tip bigint := COALESCE(p_tip_minor, 0);
  v_total bigint;
  v_fee bigint;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_done_amount bigint;
  v_done_tip bigint;
  v_till_refund_id uuid;
  v_all_refunded boolean;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL OR v_amount < 0 OR v_tip < 0 OR v_amount + v_tip = 0
     OR char_length(v_reason) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_payment.sale_id FOR UPDATE;
  IF NOT public.issue_4490_till_enabled(v_sale.venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_manage_money(v_sale.venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM public.venue_till_refunds
  WHERE payment_id = v_payment.id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('refundId', v_existing.id, 'sourceRefundId', v_existing.source_refund_id,
      'replayed', true, 'sale', public.issue_4490_till_sale_projection(v_sale.id));
  END IF;
  IF v_payment.method NOT IN ('tap', 'scan') OR v_payment.carrier_order_id IS NULL THEN
    RAISE EXCEPTION 'till_refund_method_unavailable' USING ERRCODE = 'PT409';
  END IF;
  IF v_payment.state NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'till_payment_not_refundable' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_carrier FROM public.venue_orders WHERE id = v_payment.carrier_order_id FOR UPDATE;
  IF NOT FOUND OR v_carrier.money_path <> 'mingla' OR v_carrier.payment_status NOT IN ('paid', 'partial_refund')
     OR v_carrier.total_cents <= 0 THEN
    RAISE EXCEPTION 'till_payment_not_refundable' USING ERRCODE = 'PT409';
  END IF;
  -- One card refund per card payment (the source_refunds unique key holds one
  -- row per carrier and kind); any refund still in flight on the carrier also
  -- stops a second one, as pg_venue_order_mint_refund does.
  IF EXISTS (SELECT 1 FROM public.source_refunds sr
             WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = v_carrier.id
               AND (sr.refund_kind = 'venue_till_refund'
                    OR sr.buyer_state NOT IN ('failed_terminal', 'processed'))) THEN
    RAISE EXCEPTION 'till_card_refunded_once' USING ERRCODE = 'PT409';
  END IF;
  SELECT COALESCE(sum(r.amount_minor), 0), COALESCE(sum(r.tip_minor), 0) INTO v_done_amount, v_done_tip
  FROM public.venue_till_refunds r WHERE r.payment_id = v_payment.id;
  IF v_amount > v_payment.amount_minor - v_done_amount OR v_tip > v_payment.tip_minor - v_done_tip THEN
    RAISE EXCEPTION 'till_refund_over_paid' USING ERRCODE = '22023';
  END IF;
  IF v_tip > 0 AND v_done_amount + v_amount < v_payment.amount_minor THEN
    RAISE EXCEPTION 'till_refund_tip_last' USING ERRCODE = '22023';
  END IF;
  v_total := v_amount + v_tip;
  IF v_total > v_carrier.total_cents - COALESCE(v_carrier.refunded_amount_cents, 0) THEN
    RAISE EXCEPTION 'till_refund_over_paid' USING ERRCODE = '22023';
  END IF;
  -- Mingla's fee comes back pro rata (half up), never more than the refund.
  v_fee := LEAST(v_total, floor((COALESCE(v_carrier.mingla_fee_cents, 0)::numeric * v_total)
                                / v_carrier.total_cents + 0.5)::bigint);

  INSERT INTO public.source_refunds(
    source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
    requested_by_type, requested_by_user_id, reason, provider, currency,
    original_charge_cents, buyer_refund_requested_cents,
    original_application_fee_cents, fee_reversal_required_cents,
    fee_state, fee_leg_kind, financial_state,
    organizer_refund_liability_cents, platform_fee_absorption_cents,
    provider_payment_reference, provider_account_reference, idempotency_key
  ) VALUES (
    'venue_menu_order', v_carrier.id, v_carrier.id, v_carrier.brand_id, v_carrier.venue_id,
    'venue_till_refund', 'brand_staff', p_actor,
    'Refund at the venue: ' || v_reason,
    COALESCE(v_carrier.provider, 'stripe'), upper(v_carrier.currency),
    v_carrier.total_cents, v_total,
    v_carrier.mingla_fee_cents, v_fee,
    CASE WHEN v_fee = 0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee = 0 THEN 'not_required'
         WHEN COALESCE(v_carrier.provider, 'stripe') = 'stripe' THEN 'stripe_application_fee_refund'
         ELSE 'paystack_ledger_allocation' END,
    'pending',
    v_total - v_fee, v_fee,
    COALESCE(v_carrier.stripe_charge_id, v_carrier.stripe_payment_intent_id,
             v_carrier.paystack_reference, 'venue_order:' || v_carrier.id::text),
    v_carrier.stripe_account_id,
    'venue_till_refund:' || v_carrier.id::text
  ) RETURNING * INTO v_refund;

  INSERT INTO public.source_refund_ledger_allocations(
    refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
  ) VALUES (
    v_refund.id, 'buyer_refund', v_refund.buyer_refund_requested_cents,
    v_refund.currency, v_refund.provider, 'prepared',
    'source-refund-allocation:buyer:' || v_refund.id);
  IF v_refund.organizer_refund_liability_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'organizer_refund_liability', v_refund.organizer_refund_liability_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:organizer:' || v_refund.id);
  END IF;
  IF v_refund.platform_fee_absorption_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'platform_application_fee_reversal', v_refund.platform_fee_absorption_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:platform:' || v_refund.id);
  END IF;
  INSERT INTO public.source_refund_events(
    refund_id, event_key, event_type, to_state, actor_type, safe_reason_code
  ) VALUES (
    v_refund.id, 'requested:' || v_refund.id, 'requested', 'queued', 'operator', 'venue_till_refund');

  INSERT INTO public.venue_till_refunds (
    payment_id, amount_minor, tip_minor, method, source_refund_id, reason, by_user_id, device_user_id,
    business_date, restocked, client_request_id
  ) VALUES (
    v_payment.id, v_amount, v_tip, v_payment.method, v_refund.id, v_reason, p_actor,
    COALESCE(p_device_user, p_actor), public.issue_4490_till_business_date(v_sale.venue_id, now()),
    false, p_client_request_id
  ) RETURNING id INTO v_till_refund_id;
  v_all_refunded := v_done_amount + v_amount = v_payment.amount_minor AND v_done_tip + v_tip = v_payment.tip_minor;
  UPDATE public.venue_till_payments
  SET state = CASE WHEN v_all_refunded THEN 'refunded' ELSE 'partially_refunded' END, updated_at = now()
  WHERE id = v_payment.id;
  IF v_sale.state IN ('paid', 'partially_refunded', 'refunded') THEN
    UPDATE public.venue_till_sales
    SET state = CASE WHEN NOT EXISTS (
          SELECT 1 FROM public.venue_till_payments p
          WHERE p.sale_id = v_sale.id AND p.state IN ('paid', 'partially_refunded')) THEN 'refunded'
        ELSE 'partially_refunded' END,
        version = version + 1, updated_at = now()
    WHERE id = v_sale.id;
  END IF;
  RETURN jsonb_build_object('refundId', v_till_refund_id, 'sourceRefundId', v_refund.id,
    'amountMinor', v_total, 'feeReversalMinor', v_fee, 'replayed', false,
    'sale', public.issue_4490_till_sale_projection(v_sale.id));
END;
$function$;

REVOKE ALL ON FUNCTION
  public.issue_4490_till_sweep_held_rounds(integer),
  public.issue_4490_till_mint_carrier_refund(uuid, bigint, bigint, uuid, uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_till_sweep_held_rounds(integer),
  public.issue_4490_till_mint_carrier_refund(uuid, bigint, bigint, uuid, uuid, text, uuid)
TO service_role;

COMMIT;
