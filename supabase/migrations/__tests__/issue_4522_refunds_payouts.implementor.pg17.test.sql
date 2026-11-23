-- MINGLA-INVARIANT: I-4522-10 | issue #4522 | A non-refundable deposit frozen in v2 terms is kept only on a traveler's own cancel; an operator or host cancel refunds it, and collected flexible payments refund and pay out like planned ones.
\set ON_ERROR_STOP on

-- Issue #4522 slice 8 (M4, 20281129064522): refunds and payouts for v2
-- orders — flexible and superseded rows, "Deposit is non-refundable" (D-9),
-- and add-ons paid today or spread.

BEGIN;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

INSERT INTO auth.users(id, email) VALUES
  ('45220008-0000-4000-8000-000000000001', 'refund-host@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('45220008-0000-4000-8000-000000000001', 'refund-host@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES ('45220008-0000-4000-8000-000000000010', '45220008-0000-4000-8000-000000000001',
        'Refund brand', 'refund-brand-4522', 'NGN', 'paystack', 'NG');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
  currency, refund_policy)
VALUES ('45220008-0000-4000-8000-000000000020', '45220008-0000-4000-8000-000000000010',
        '45220008-0000-4000-8000-000000000001', 'Refund trip', 'refund-trip-4522', 'trip', 'scheduled',
        'public', 'Africa/Lagos', 'NGN',
        '{"kind":"flexible","tiers":[{"days_before_start":0,"refund_pct":100}],"deposit_non_refundable":true}');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220008-0000-4000-8000-000000000020', now() + interval '120 days', now() + interval '127 days',
        'Africa/Lagos', true);
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited,
  min_purchase_qty, available_online, available_in_person)
VALUES ('45220008-0000-4000-8000-000000000030', '45220008-0000-4000-8000-000000000020', 'Room',
        120000000, 'NGN', false, 20, false, 1, true, false);

CREATE FUNCTION pg_temp.seed_order(p_order uuid, p_terms jsonb, p_addon_mode text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms,
    addon_payment_mode, stripe_payment_intent_id)
  VALUES (p_order, '45220008-0000-4000-8000-000000000020', 'refund-buyer@example.test', 'Refund Buyer',
    '+2348000000003', 30000000, 'NGN', 'online_card', 'paid', 'online_checkout', true, p_terms,
    p_addon_mode, 'ps_deposit_' || p_order::text);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, planned_application_fee_cents, ticket_type_id,
    addon_portion_minor)
  SELECT p_order, g, 30000000, 'NGN', now() + (g * 20 || ' days')::interval, 'scheduled', 'paystack', 'pay_link',
         now(), 30600000, 1350000, '45220008-0000-4000-8000-000000000030',
         CASE WHEN p_addon_mode = 'spread' THEN 1000000 ELSE 0 END
    FROM generate_series(1, 3) g;
END $$;

-- A v2 order with a non-refundable ₦300,000 deposit and one ₦100,000
-- flexible payment collected; a superseded row from an earlier rebalance.
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000a1',
  '{"v":2,"deposit_minor":30000000,"deposit_non_refundable":true,"flex_enabled":true,"auto_adjust":true}', NULL);
INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
  collection_method, plan_bound_at, buyer_total_cents, kind, flex_client_key, line_allocation,
  collected_at, stripe_payment_intent_id)
VALUES ('45220008-0000-4000-8000-0000000000a1', 4, 10000000, 'NGN', now(), 'collected', 'paystack', 'pay_link',
  now(), 10200000, 'flex', 'client-key-refund', '[{"ticket_type_id":"45220008-0000-4000-8000-000000000030","net_minor":10000000,"addon_minor":0}]',
  now(), 'ps_flex_refund');
UPDATE public.order_installments SET status = 'superseded', superseded_at = now()
 WHERE order_id = '45220008-0000-4000-8000-0000000000a1' AND ordinal = 1;
-- A legacy order: no v2 terms.
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000a2', NULL, NULL);
-- A true single-payment legacy order above the int4 × 100 overflow threshold.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
  currency, payment_method, payment_status, source, installment_plan_root, stripe_payment_intent_id)
VALUES ('45220008-0000-4000-8000-0000000000a5', '45220008-0000-4000-8000-000000000020',
  'single-refund-buyer@example.test', 'Single Refund Buyer', '+2348000000004', 30000000,
  'NGN', 'online_card', 'paid', 'online_checkout', false, 'pi_single_refund_overflow');

-- A. SC-14: a traveler's cancel refunds the flexible payment and keeps the deposit.
DO $$
DECLARE v_c jsonb; v_dep jsonb;
BEGIN
  v_c := public.biz_compute_refund_for_cancel('45220008-0000-4000-8000-0000000000a1');
  SELECT r INTO v_dep FROM jsonb_array_elements(v_c->'per_payment_refund') r WHERE r->>'note' = 'deposit';
  IF (v_c->>'refund_total_cents')::bigint <> 10200000 OR (v_dep->>'refund_cents')::bigint <> 0
     -- The kept deposit has its own key, never an element (#4522 rework F7).
     OR (v_c->>'deposit_non_refundable_cents')::bigint IS DISTINCT FROM 30000000
     OR jsonb_array_length(v_c->'per_payment_refund') <> 2
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_c->'per_payment_refund') r WHERE NOT r ? 'refund_cents')
     OR (v_c->>'paid_total_cents')::bigint <> 40200000 THEN
    RAISE EXCEPTION 'A-1 SC-14 traveler cancel: %', v_c;
  END IF;
  -- Superseded rows are neither refunded nor cancelled.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_c->'installments_to_cancel') x
              JOIN public.order_installments oi ON oi.id = (x->>'installment_id')::uuid
             WHERE oi.status = 'superseded')
     OR jsonb_array_length(v_c->'installments_to_cancel') <> 2 THEN
    RAISE EXCEPTION 'A-2 superseded rows must be left alone: %', v_c->'installments_to_cancel';
  END IF;
END $$;

-- A2. The cancel preview for a named actor matches what begin computes.
DO $$
BEGIN
  IF (public.issue_4522_compute_refund_for_cancel_as('45220008-0000-4000-8000-0000000000a1', now(), 'operator')
        ->>'refund_total_cents')::bigint <> 40200000
     OR (public.issue_4522_compute_refund_for_cancel_as('45220008-0000-4000-8000-0000000000a1', now(), 'buyer')
        ->>'refund_total_cents')::bigint <> 10200000
     OR public.issue_4522_compute_refund_for_cancel_as('45220008-0000-4000-8000-0000000000a1', now(), 'guest')
        ->>'reason' <> 'invalid_actor_kind'
     OR COALESCE(current_setting('mingla.cancel_actor_kind', true), '') <> '' THEN
    RAISE EXCEPTION 'A2-1 the per-actor preview is wrong';
  END IF;
END $$;

-- A3. Pass 5 (T9-2): a cancel never goes through while a charge of the
--     booking can still land (its money would be left out of the refund);
--     nothing is written, and the same cancel works once the charge settles.
--     FAILS ON REVERT: begin cancelled the order with the charge in flight.
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000a9',
  '{"v":2,"deposit_minor":30000000,"flex_enabled":true,"auto_adjust":true}', NULL);
DO $$
DECLARE
  v_o constant uuid := '45220008-0000-4000-8000-0000000000a9';
  v_row uuid;
  v_attempt uuid;
  v_b jsonb;
  v_case text;
BEGIN
  SELECT id INTO v_row FROM public.order_installments WHERE order_id = v_o AND ordinal = 1;
  FOREACH v_case IN ARRAY ARRAY['card_marked', 'second_provider_attempt', 'flex_open'] LOOP
    IF v_case = 'card_marked' THEN
      -- the card path's in-flight mark (createInstallmentPI): a PaymentIntent on a scheduled card row
      INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
        collection_method, stripe_payment_intent_id)
      VALUES (v_o, 5, 10000000, 'NGN', now(), 'scheduled', 'stripe', 'auto_card', 'pi_in_flight_t92');
    ELSIF v_case = 'second_provider_attempt' THEN
      INSERT INTO public.order_installment_charge_attempts(installment_id, provider, attempt_no, method, reference,
        state, amount_cents, application_fee_cents)
      VALUES (v_row, 'paystack', 1, 'auto_card', 'mingla-inst-' || v_row::text || '-a1', 'unknown', 30600000, 1350000)
      RETURNING id INTO v_attempt;
    ELSE
      INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
        collection_method, plan_bound_at, buyer_total_cents, kind, flex_client_key, line_allocation)
      VALUES (v_o, 9, 10000000, 'NGN', now(), 'scheduled', 'paystack', 'pay_link', now(), 10200000, 'flex',
        'client-key-t92', '[{"ticket_type_id":"45220008-0000-4000-8000-000000000030","net_minor":10000000,"addon_minor":0}]');
    END IF;
    FOREACH v_b IN ARRAY ARRAY[
      public.biz_cancel_trip_booking_begin(v_o, 'operator', '45220008-0000-4000-8000-000000000001', 'Host cancelled this booking'),
      public.biz_cancel_trip_booking_begin(v_o, 'buyer', NULL, 'Changed my plans for the trip')] LOOP
      IF COALESCE((v_b->>'ok')::boolean, true) OR v_b->>'reason' IS DISTINCT FROM 'balance_payment_in_flight' THEN
        RAISE EXCEPTION 'A3-1 % : a cancel with a charge in flight must be refused: %', v_case, v_b;
      END IF;
    END LOOP;
    IF (SELECT cancelled_at FROM public.orders WHERE id = v_o) IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.refunds WHERE order_id = v_o)
       OR EXISTS (SELECT 1 FROM public.order_installments WHERE order_id = v_o AND status = 'cancelled') THEN
      RAISE EXCEPTION 'A3-2 % : a refused cancel writes nothing', v_case;
    END IF;
    -- the charge settles: the row is no longer in flight
    IF v_case = 'card_marked' THEN
      -- released after the read-back found it never charged (issue_4522_release_unconfirmed_stripe_charge)
      UPDATE public.order_installments SET stripe_payment_intent_id = NULL
       WHERE order_id = v_o AND ordinal = 5;
    ELSIF v_case = 'second_provider_attempt' THEN
      UPDATE public.order_installment_charge_attempts SET state = 'failed', resolved_at = now() WHERE id = v_attempt;
    ELSE
      UPDATE public.order_installments SET status = 'failed', failed_at = now(), failure_reason = 'card_declined' WHERE order_id = v_o AND ordinal = 9;
      UPDATE public.order_installments SET status = 'superseded', superseded_at = now() WHERE order_id = v_o AND ordinal = 9;
    END IF;
  END LOOP;
  v_b := public.biz_cancel_trip_booking_begin(v_o, 'operator', '45220008-0000-4000-8000-000000000001', 'Host cancelled this booking');
  IF NOT COALESCE((v_b->>'ok')::boolean, false) OR (SELECT cancelled_at FROM public.orders WHERE id = v_o) IS NULL THEN
    RAISE EXCEPTION 'A3-3 once nothing is in flight the same cancel goes through: %', v_b;
  END IF;
END $$;

-- B. SC-14 / D-9: an operator cancel refunds everything, deposit included,
--    and leaves superseded rows as they are.
DO $$
DECLARE v_b jsonb;
BEGIN
  v_b := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000000a1', 'operator',
    '45220008-0000-4000-8000-000000000001', 'Host cancelled this booking');
  IF NOT COALESCE((v_b->>'ok')::boolean, false) OR (v_b->>'refund_total_cents')::bigint <> 40200000 THEN
    RAISE EXCEPTION 'B-1 an operator cancel refunds the deposit too: %', v_b;
  END IF;
  IF (SELECT string_agg(ordinal || ':' || status, ',' ORDER BY ordinal) FROM public.order_installments
        WHERE order_id = '45220008-0000-4000-8000-0000000000a1')
     IS DISTINCT FROM '1:superseded,2:cancelled,3:cancelled,4:collected' THEN
    RAISE EXCEPTION 'B-2 cancel must cancel open rows only';
  END IF;
  IF COALESCE(current_setting('mingla.cancel_actor_kind', true), '') <> '' THEN
    RAISE EXCEPTION 'B-3 the actor mark must not outlive the computation';
  END IF;
END $$;

-- C. A legacy order is refunded exactly as before (deposit at the policy rate).
DO $$
DECLARE v_c jsonb;
BEGIN
  v_c := public.biz_compute_refund_for_cancel('45220008-0000-4000-8000-0000000000a2');
  IF (v_c->>'refund_total_cents')::bigint <> 30000000
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_c->'per_payment_refund') r WHERE r ? 'deposit_non_refundable_cents')
     OR v_c ? 'deposit_non_refundable_cents' THEN
    RAISE EXCEPTION 'C-1 a legacy refund changed: %', v_c;
  END IF;
END $$;

-- C2. Fails on revert: the old int4 multiplication raises integer out of
--     range before the division for a ₦300,000 refund at 100%.
DO $$
DECLARE v_c jsonb;
BEGIN
  v_c := public.biz_compute_refund_for_cancel('45220008-0000-4000-8000-0000000000a5');
  IF NOT COALESCE((v_c->>'ok')::boolean, false)
     OR (v_c->>'paid_total_cents')::bigint <> 30000000
     OR (v_c->>'refund_total_cents')::bigint <> 30000000
     OR (v_c->'per_payment_refund'->0->>'refund_cents')::bigint <> 30000000 THEN
    RAISE EXCEPTION 'C2-1 large single-payment refund must not overflow: %', v_c;
  END IF;
END $$;

-- D. SC-15: a collected flexible row enters payout accounting; a superseded row never does.
DO $$
DECLARE v_flex uuid; v_sup uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_flex FROM public.order_installments
   WHERE order_id = '45220008-0000-4000-8000-0000000000a1' AND kind = 'flex';
  SELECT id INTO v_sup FROM public.order_installments
   WHERE order_id = '45220008-0000-4000-8000-0000000000a1' AND status = 'superseded';
  -- N2: until it is settled, what it paid and what it overpaid is not known,
  -- so it waits outside payouts; settled with nothing over, it is ready.
  v_r := public.record_order_installment_provider_sale(v_flex, 450000, 15000);
  IF NOT COALESCE((v_r->>'ok')::boolean, false)
     OR (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_flex) <> 'pending' THEN
    RAISE EXCEPTION 'D-1a an unsettled flexible row must wait outside payouts: %', v_r;
  END IF;
  -- A flexible payment that fits the open balance: ready once settled.
  PERFORM pg_temp.seed_order('45220008-0000-4000-8000-0000000000a6',
    '{"v":2,"deposit_minor":30000000,"flex_enabled":true,"auto_adjust":true}', NULL);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, kind, flex_client_key, line_allocation,
    collected_at, stripe_payment_intent_id)
  VALUES ('45220008-0000-4000-8000-0000000000a6', 4, 10000000, 'NGN', now(), 'collected', 'paystack', 'pay_link',
    now(), 10200000, 'flex', 'client-key-payout', '[{"ticket_type_id":"45220008-0000-4000-8000-000000000030","net_minor":10000000,"addon_minor":0}]',
    now(), 'ps_flex_payout')
  RETURNING id INTO v_flex;
  v_r := public.record_order_installment_provider_sale(v_flex, 450000, 15000);
  IF (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_flex) <> 'pending' THEN
    RAISE EXCEPTION 'D-1b an unsettled flexible row must wait outside payouts: %', v_r;
  END IF;
  v_r := public.issue_4522_settle_flex_payment(v_flex);
  IF NOT COALESCE((v_r->>'ok')::boolean, false) OR (v_r->>'heldMinor')::bigint <> 0
     OR (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_flex) <> 'ready' THEN
    RAISE EXCEPTION 'D-1 a settled flexible row must be payout-ready: %', v_r;
  END IF;
  v_r := public.record_order_installment_provider_sale(v_sup, 450000, 15000);
  IF (v_r->>'reason') <> 'not_collected'
     OR (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_sup) <> 'pending' THEN
    RAISE EXCEPTION 'D-2 a superseded row must never become payout-ready: %', v_r;
  END IF;
END $$;

-- E. Add-ons: a spread add-on comes off the open rows first; a today add-on
--    is refunded from the deposit.
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000a3',
  '{"v":2,"deposit_minor":30000000,"flex_enabled":false,"auto_adjust":true}', 'spread');
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000a4',
  '{"v":2,"deposit_minor":30000000,"flex_enabled":false,"auto_adjust":true}', 'today');
DO $$
DECLARE v_r jsonb;
BEGIN
  v_r := public.issue_4522_remove_spread_addon('45220008-0000-4000-8000-0000000000a3',
    '45220008-0000-4000-8000-000000000030', 2000000);
  IF (v_r->>'removedFromOpenMinor')::bigint <> 2000000 OR (v_r->>'refundFromCollectedMinor')::bigint <> 0
     OR (SELECT sum(addon_portion_minor) FROM public.order_installments
          WHERE order_id = '45220008-0000-4000-8000-0000000000a3' AND status = 'scheduled') <> 1000000
     OR (SELECT sum(amount_cents) FROM public.order_installments
          WHERE order_id = '45220008-0000-4000-8000-0000000000a3' AND status = 'scheduled') <> 88000000
     OR NOT EXISTS (SELECT 1 FROM public.order_balance_events
          WHERE order_id = '45220008-0000-4000-8000-0000000000a3' AND reason = 'addon_removed') THEN
    RAISE EXCEPTION 'E-1 SC-13 removing a spread add-on before paying it refunds nothing: %', v_r;
  END IF;
  v_r := public.issue_4522_remove_spread_addon('45220008-0000-4000-8000-0000000000a3',
    '45220008-0000-4000-8000-000000000030', 5000000);
  IF (v_r->>'removedFromOpenMinor')::bigint <> 1000000 OR (v_r->>'refundFromCollectedMinor')::bigint <> 4000000 THEN
    RAISE EXCEPTION 'E-2 only the uncollected share comes off the rows: %', v_r;
  END IF;
  v_r := public.issue_4522_remove_spread_addon('45220008-0000-4000-8000-0000000000a4',
    '45220008-0000-4000-8000-000000000030', 2000000);
  IF (v_r->>'refundFromCollectedMinor')::bigint <> 2000000 OR v_r->>'mode' <> 'today'
     OR (SELECT sum(amount_cents) FROM public.order_installments
          WHERE order_id = '45220008-0000-4000-8000-0000000000a4' AND status = 'scheduled') <> 90000000 THEN
    RAISE EXCEPTION 'E-3 a today add-on is refunded from the deposit, rows untouched: %', v_r;
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4522_remove_spread_addon(uuid,uuid,bigint,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'E-4 service role only';
  END IF;
END $$;

-- F. issue #4522 E-6 — a cancel whose refund comes to nothing cancels with no
--    refund row (refunds.amount_cents must be positive): a traveler cancelling
--    a v2 order with only the non-refundable deposit paid, and a host
--    cancelling an old-plan order on a trip with no cancellation policy.
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000b6',
  '{"v":2,"deposit_minor":30000000,"deposit_non_refundable":true,"flex_enabled":false,"auto_adjust":true}', NULL);
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
  currency, refund_policy)
VALUES ('45220008-0000-4000-8000-000000000021', '45220008-0000-4000-8000-000000000010',
        '45220008-0000-4000-8000-000000000001', 'No policy trip', 'no-policy-trip-4522', 'trip', 'scheduled',
        'public', 'Africa/Lagos', 'NGN', NULL);
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220008-0000-4000-8000-000000000021', now() + interval '120 days', now() + interval '127 days',
        'Africa/Lagos', true);
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000b7', NULL, NULL);
UPDATE public.orders SET event_id = '45220008-0000-4000-8000-000000000021'
 WHERE id = '45220008-0000-4000-8000-0000000000b7';
DO $$
DECLARE v_b jsonb; r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('45220008-0000-4000-8000-0000000000b6'::uuid, 'buyer'),
    ('45220008-0000-4000-8000-0000000000b7'::uuid, 'operator')
  ) v(order_id, actor) LOOP
    v_b := public.biz_cancel_trip_booking_begin(r.order_id, r.actor,
      '45220008-0000-4000-8000-000000000001', 'Cancelled with nothing to refund');
    IF NOT COALESCE((v_b->>'ok')::boolean, false) OR (v_b->>'refund_total_cents')::bigint <> 0
       OR v_b->>'refund_id' IS NOT NULL THEN
      RAISE EXCEPTION 'F-1 a $0 cancel (%) succeeds with no refund id: %', r.actor, v_b;
    END IF;
    IF EXISTS (SELECT 1 FROM public.refunds WHERE order_id = r.order_id)
       OR EXISTS (SELECT 1 FROM public.paystack_refund_attempts WHERE source_id = r.order_id) THEN
      RAISE EXCEPTION 'F-2 a $0 cancel (%) writes no refund and no provider attempt', r.actor;
    END IF;
    IF (SELECT cancelled_at FROM public.orders WHERE id = r.order_id) IS NULL
       OR EXISTS (SELECT 1 FROM public.order_installments WHERE order_id = r.order_id AND status <> 'cancelled') THEN
      RAISE EXCEPTION 'F-3 a $0 cancel (%) still cancels the booking and its open rows', r.actor;
    END IF;
    -- a second press is the ordinary already-cancelled answer, never a refund
    IF public.biz_cancel_trip_booking_begin(r.order_id, r.actor, NULL, NULL)->>'reason' <> 'already_cancelled' THEN
      RAISE EXCEPTION 'F-4 a repeated $0 cancel (%) is already_cancelled', r.actor;
    END IF;
  END LOOP;
END $$;

-- G. Pass 6 (S9-1): a refund is recorded where its charge lives.
--    The orders below have the shape a REAL plan order has (verified on
--    real-path orders in the s9 rig: buyer web -> ticket-checkout-create ->
--    provider mock -> webhook -> finalize -> cron): orders.total_cents and
--    buyer_total_cents hold the DEPOSIT only; each collected instalment is its
--    own row with its own charge (Stripe rows: buyer_total_cents NULL, own
--    PaymentIntent; second-provider rows: own transaction reference).
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES ('45220008-0000-4000-8000-000000000011', '45220008-0000-4000-8000-000000000001',
        'Card refund brand', 'card-refund-brand-4522', 'USD', 'stripe', 'US');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
  currency, refund_policy)
VALUES ('45220008-0000-4000-8000-000000000022', '45220008-0000-4000-8000-000000000011',
        '45220008-0000-4000-8000-000000000001', 'Card trip', 'card-trip-4522', 'trip', 'scheduled',
        'public', 'America/New_York', 'USD', '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":100}]}');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220008-0000-4000-8000-000000000022', now() + interval '120 days', now() + interval '127 days',
        'America/New_York', true);
INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, buyer_total_cents,
  list_subtotal_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, pricing_source,
  currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms, stripe_payment_intent_id)
VALUES ('45220008-0000-4000-8000-0000000000c1', '45220008-0000-4000-8000-000000000022', 'card-plan@example.test',
  'Card Plan', '+12025550111', 30000, 30000, 30000, 30000, 0, 0, 'provider_reconciled',
  'USD', 'online_card', 'paid', 'online_checkout', true,
  '{"v":2,"deposit_minor":30000,"deposit_non_refundable":true,"flex_enabled":true,"auto_adjust":true}', 'pi_g_deposit');
INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
  collection_method, plan_bound_at, collected_at, stripe_payment_intent_id, application_fee_amount_cents, payout_accounting_state)
SELECT '45220008-0000-4000-8000-0000000000c1', g, 30000, 'USD', now() - interval '1 day',
       CASE WHEN g < 3 THEN 'collected' ELSE 'scheduled' END, 'stripe', 'auto_card', now() - interval '2 days',
       CASE WHEN g < 3 THEN now() - interval '1 day' END, CASE WHEN g < 3 THEN 'pi_g_row' || g END,
       CASE WHEN g < 3 THEN 1350 END, CASE WHEN g < 3 THEN 'ready' ELSE 'pending' END
  FROM generate_series(1, 3) g;

-- G1. A host cancel of deposit + two collected instalments refunds 90,000 at
--     the provider (three charges); the last charge's finalize settles it.
--     FAILS ON REVERT: main's finalize asks the order to hold 90,000 and
--     orders_refunded_amount_not_exceed_total refuses (the s8 finding).
DO $$
DECLARE v_b jsonb; v_refund uuid; v_owner uuid := gen_random_uuid(); v_err text;
BEGIN
  v_b := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000000c1', 'operator',
    '45220008-0000-4000-8000-000000000001', 'Host cancelled the trip');
  v_refund := (v_b->>'refund_id')::uuid;
  IF (v_b->>'refund_total_cents')::bigint <> 90000 THEN
    RAISE EXCEPTION 'G1-0 the cancel refunds deposit and both instalments: %', v_b;
  END IF;
  -- the provider refunded all three charges; two attempts already settled
  INSERT INTO public.ticket_refund_attempts(refund_id, order_id, request_fingerprint, expected_attempt_count,
    provider, provider_mode, currency, connected_account_id, charge_id, payment_intent_id, application_fee_amount_text,
    requested_refund_amount_text,
    buyer_refund_id, buyer_refund_amount_text, fee_refund_amount_text, status, lease_owner, lease_epoch, lease_expires_at)
  SELECT v_refund, '45220008-0000-4000-8000-0000000000c1', 'g1:' || x.pi, 3, 'stripe', 'test', 'usd', 'acct_g1',
         'ch_' || x.pi, x.pi, '0',
         '30000', 're_' || x.pi, '30000', CASE WHEN x.last THEN NULL ELSE '0' END,
         CASE WHEN x.last THEN 'pending_visibility' ELSE 'not_applicable' END, v_owner, 1, now() + interval '2 minutes'
    FROM (VALUES ('pi_g_row1', false), ('pi_g_row2', false), ('pi_g_deposit', true)) x(pi, last);
  -- before it is recorded, each refunded instalment is held from payouts
  IF (SELECT count(*) FROM public.order_installments WHERE order_id = '45220008-0000-4000-8000-0000000000c1'
        AND status = 'collected' AND payout_accounting_state = 'pending') <> 2 THEN
    RAISE EXCEPTION 'G1-1 a provider refund not yet on its row holds the row from payouts';
  END IF;
  v_err := pg_temp.raised(format($f$SELECT public.issue_2097_finalize_refund_attempt(
    (SELECT id FROM public.ticket_refund_attempts WHERE refund_id = %L AND payment_intent_id = 'pi_g_deposit'),
    %L, 1, 'not_applicable', NULL, '0', '0', NULL)$f$, v_refund, v_owner));
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'G1-2 the finalize records the cancel (was: %)', v_err;
  END IF;
  IF (SELECT status FROM public.refunds WHERE id = v_refund) <> 'succeeded'
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000000c1') <> 30000 THEN
    RAISE EXCEPTION 'G1-3 the order holds only its own (deposit) charge refunded';
  END IF;
  IF (SELECT count(*) FROM public.order_installments WHERE order_id = '45220008-0000-4000-8000-0000000000c1'
        AND status = 'refunded' AND refunded_amount_cents = 30000) <> 2
     OR (SELECT count(*) FROM public.order_installment_refund_applications WHERE refund_id = v_refund) <> 2 THEN
    RAISE EXCEPTION 'G1-4 each instalment refund is recorded on its own row';
  END IF;
  -- deposit + rows = what the provider returned
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000000c1')
     + (SELECT sum(refunded_amount_cents) FROM public.order_installments
         WHERE order_id = '45220008-0000-4000-8000-0000000000c1') <> 90000 THEN
    RAISE EXCEPTION 'G1-5 our books match the provider (90,000)';
  END IF;
  -- the edge's own mark afterwards is a replay, never a second count
  IF NOT (public.issue_3645_mark_installment_refunded(
        (SELECT id FROM public.order_installments WHERE order_id = '45220008-0000-4000-8000-0000000000c1' AND ordinal = 1),
        v_refund, 30000)->>'replayed')::boolean THEN
    RAISE EXCEPTION 'G1-6 the edge mark after the finalize replays';
  END IF;
  -- a non-plan order keeps exactly the plain sum
  IF public.issue_4522_order_charge_refunded_cents('45220008-0000-4000-8000-0000000000a5')
     <> (SELECT COALESCE(sum(amount_cents), 0) FROM public.refunds
          WHERE order_id = '45220008-0000-4000-8000-0000000000a5' AND status = 'succeeded') THEN
    RAISE EXCEPTION 'G1-7 an order with no instalments counts every settled refund';
  END IF;
END $$;

-- G2. A second-provider cancel settles. FAILS ON REVERT: main's commit wrote
--     the zero fee with status unknown_legacy and
--     refunds_application_fee_amount_truth_check refused, so no naira trip
--     cancel ever settled. A traveler's cancel that keeps the non-refundable
--     deposit leaves the order partly refunded (the kept deposit stays payable).
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000c2',
  '{"v":2,"deposit_minor":30000000,"deposit_non_refundable":true,"flex_enabled":true,"auto_adjust":true}', NULL);
UPDATE public.order_installments SET status = 'collected', collected_at = now() - interval '1 day',
       stripe_payment_intent_id = 'mingla-inst-g2-a1', provider_transaction_id = '4522900001',
       application_fee_amount_cents = 1350000, payout_accounting_state = 'ready'
 WHERE order_id = '45220008-0000-4000-8000-0000000000c2' AND ordinal = 1;
INSERT INTO public.order_line_items(order_id, ticket_type_id, unit_price_cents, total_cents, quantity, payment_plan_choice)
VALUES ('45220008-0000-4000-8000-0000000000c2', '45220008-0000-4000-8000-000000000030', 120000000, 120000000, 1, 'installments');
DO $$
DECLARE v_b jsonb; v_refund uuid; v_row uuid; v_c jsonb; v_err text;
BEGIN
  SELECT id INTO v_row FROM public.order_installments WHERE order_id = '45220008-0000-4000-8000-0000000000c2' AND ordinal = 1;
  v_b := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000000c2', 'buyer', NULL, NULL);
  v_refund := (v_b->>'refund_id')::uuid;
  IF (v_b->>'refund_total_cents')::bigint <> 30600000 THEN
    RAISE EXCEPTION 'G2-0 the traveler gets the instalment back and keeps no deposit refund: %', v_b;
  END IF;
  -- the edge's order after the provider: outcome, row mark, line, commit
  UPDATE public.paystack_refund_attempts SET status = 'processed', provider_refund_id = 'ps_rf_g2'
   WHERE local_refund_id = v_refund;
  PERFORM public.issue_3645_mark_installment_refunded(v_row, v_refund, 30600000);
  INSERT INTO public.refund_line_items(refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents, installment_id)
  SELECT v_refund, id, ticket_type_id, 1, 30600000, v_row FROM public.order_line_items
   WHERE order_id = '45220008-0000-4000-8000-0000000000c2';
  v_err := pg_temp.raised(format($f$SELECT public.biz_cancel_trip_booking_commit(%L, ARRAY['ps_rf_g2'], 0, now())$f$, v_refund));
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'G2-1 the second-provider cancel commits (was: %)', v_err;
  END IF;
  IF (SELECT status || '/' || application_fee_refund_status FROM public.refunds WHERE id = v_refund)
       <> 'succeeded/not_applicable'
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000000c2') <> 0
     OR (SELECT payment_status FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000000c2') <> 'partial_refund' THEN
    RAISE EXCEPTION 'G2-2 settled with no deposit refund on the order, still partly refunded: %',
      (SELECT row_to_json(o)::text FROM (SELECT payment_status, refunded_amount_cents FROM public.orders
        WHERE id = '45220008-0000-4000-8000-0000000000c2') o);
  END IF;
END $$;

-- G3. A second-provider refund of an instalment charge holds that row from
--     payouts until the row records it, then releases it (a partial refund
--     keeps the row collected).
DO $$
DECLARE v_row uuid; v_refund uuid;
BEGIN
  SELECT id INTO v_row FROM public.order_installments WHERE order_id = '45220008-0000-4000-8000-0000000000a2' AND ordinal = 2;
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'mingla-inst-g3-a1',
         provider_transaction_id = '4522900002', application_fee_amount_cents = 1350000, payout_accounting_state = 'ready'
   WHERE id = v_row;
  INSERT INTO public.refunds(order_id, amount_cents, currency, status, reason)
  VALUES ('45220008-0000-4000-8000-0000000000a2', 1000000, 'NGN', 'pending', 'g3 partial') RETURNING id INTO v_refund;
  INSERT INTO public.paystack_refund_attempts(source_type, source_id, local_refund_id, transaction_reference,
    merchant_note, amount_cents, currency, status, idempotency_key, provider_refund_id)
  VALUES ('order_installment', v_row, v_refund, 'mingla-inst-g3-a1', 'mingla_trip_refund:' || v_refund || ':' || v_row, 1000000,
    'ngn', 'processed', 'g3-' || v_refund, 'ps_rf_g3');
  IF (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_row) <> 'pending' THEN
    RAISE EXCEPTION 'G3-1 refunded at the provider, not yet on the row: held';
  END IF;
  PERFORM public.issue_3645_mark_installment_refunded(v_row, v_refund, 1000000);
  IF (SELECT status || '/' || payout_accounting_state FROM public.order_installments WHERE id = v_row) <> 'collected/ready' THEN
    RAISE EXCEPTION 'G3-2 recorded on the row: payable again for what is left';
  END IF;
END $$;

-- H. Pass 6 (S9-2): a paid plan order whose paid-in-full claim was never
--    answered is listed for the next instalment run, until it is claimed;
--    an order with money still owed, a cancelled order and one whose last
--    payment is under 15 minutes old are not. FAILS ON REVERT: no list.
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000d1',
  '{"v":2,"deposit_minor":30000000,"deposit_non_refundable":false,"flex_enabled":true,"auto_adjust":true}', NULL);
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000000d2',
  '{"v":2,"deposit_minor":30000000,"deposit_non_refundable":false,"flex_enabled":true,"auto_adjust":true}', NULL);
UPDATE public.order_installments SET status = 'collected', collected_at = now(),
       stripe_payment_intent_id = 'mingla-inst-h-' || id, provider_transaction_id = '45229' || ordinal
 WHERE order_id IN ('45220008-0000-4000-8000-0000000000d1', '45220008-0000-4000-8000-0000000000d2')
   AND (order_id = '45220008-0000-4000-8000-0000000000d1' OR ordinal < 3);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.issue_4522_unsent_paid_in_full(50, now() + interval '1 hour') x
                  WHERE x = '45220008-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION 'H-1 a paid order with no claim is listed for the next run';
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_4522_unsent_paid_in_full(50, now() + interval '1 hour') x
              WHERE x = '45220008-0000-4000-8000-0000000000d2') THEN
    RAISE EXCEPTION 'H-2 an order still owing a payment is not listed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_4522_unsent_paid_in_full(50, now()) x
              WHERE x = '45220008-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION 'H-3 a payment under 15 minutes old is left to its own path';
  END IF;
  IF NOT public.issue_4522_claim_paid_in_full_notice('45220008-0000-4000-8000-0000000000d1', 'instalment_run_retry') THEN
    RAISE EXCEPTION 'H-4a the run claims it';
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_4522_unsent_paid_in_full(50, now() + interval '1 hour') x
                 WHERE x = '45220008-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION 'H-4 once claimed (by the run), it is never listed again';
  END IF;
  UPDATE public.order_installments SET status = 'collected', collected_at = now(),
         stripe_payment_intent_id = 'mingla-inst-h-' || id, provider_transaction_id = '452293'
   WHERE order_id = '45220008-0000-4000-8000-0000000000d2' AND ordinal = 3;
  UPDATE public.orders SET cancelled_at = now() WHERE id = '45220008-0000-4000-8000-0000000000d2';
  IF EXISTS (SELECT 1 FROM public.issue_4522_unsent_paid_in_full(50, now() + interval '1 hour') x
              WHERE x = '45220008-0000-4000-8000-0000000000d2') THEN
    RAISE EXCEPTION 'H-5 a cancelled order is never told it is paid in full';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4522_unsent_paid_in_full(integer,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'H-6 service role only';
  END IF;
END $$;

ROLLBACK;
