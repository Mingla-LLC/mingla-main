-- MINGLA-INVARIANT: I-4522-10 | issue #4522 | A non-refundable deposit frozen in v2 terms is kept only on a traveler's own cancel; an operator or host cancel refunds it, and collected flexible payments refund and pay out like planned ones.
-- MINGLA-INVARIANT: I-4522-HOST-NEVER-PAID-REFUNDS | issue #4522 | A host is never paid money that went back to a traveler: no payout sends more than its sales are worth after their refunds, and a refund after payout becomes the host's payout debt.
-- MINGLA-INVARIANT: I-4522-CANCEL-COMPLETABLE | issue #4522 | One trip cancel is one refund operation: until every refund it intends is made and recorded it stays in progress, a host retry and the instalment run resume it, no refund is sent twice, and the booking's sales stay held from payouts.
-- MINGLA-INVARIANT: I-4522-TRIP-CALENDAR-DAYS | issue #4522 | Trip refund tiers count calendar days from the cancel date in the trip's zone to the stored departure date, and a trip stops taking bookings when its departure day begins in its zone.
-- MINGLA-INVARIANT: I-3645-PROVIDER-REFUND-TRUTH | issue #3645 | A refund is counted on its exact provider charge only while confirmed; terminal failure cannot be resurrected and pending provider money blocks payout.
-- MINGLA-INVARIANT: I-3645-LATE-REFUND-DEBT-AUTHORIZATION | issue #3645 | Debt opened before payout authorization reduces the payable claim and its growth refreshes the operator alert.
\set ON_ERROR_STOP on

-- Issue #4522 slice 8 (M4, 20281202084522): refunds and payouts for v2
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

-- I. Section 8 (gaps 1 and 2): a host is never paid money that went back to
--    a traveler. Orders have the shape real full-pay and plan orders have on
--    the s9/s10 rigs (buyer web request sequence -> provider mock -> webhook
--    -> finalize): total_cents = buyer_total_cents = the charge (the deposit
--    on a plan order), stripe_application_fee_amount_cents = 4.5% of it.
--    Attached by the REAL payout sweep, refunds recorded by the REAL commit /
--    finalize functions, paid through the REAL claim / authorize / record.
--    Deferred triggers fire at commit in production; this suite rolls back,
--    so SET CONSTRAINTS ALL IMMEDIATE stands in for each commit.
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country,
  payout_hold_cutover_at)
VALUES ('45220008-0000-4000-8000-000000000012', '45220008-0000-4000-8000-000000000001',
        'Payout card brand', 'payout-card-brand-4522', 'USD', 'stripe', 'US', now() - interval '30 days'),
       ('45220008-0000-4000-8000-000000000013', '45220008-0000-4000-8000-000000000001',
        'Payout naira brand', 'payout-naira-brand-4522', 'NGN', 'paystack', 'NG', now() - interval '30 days');
INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, charges_enabled, payouts_enabled, country, default_currency)
VALUES ('45220008-0000-4000-8000-000000000012', 'acct_i4522', true, true, 'US', 'usd');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
  currency, refund_policy)
VALUES ('45220008-0000-4000-8000-000000000024', '45220008-0000-4000-8000-000000000012',
        '45220008-0000-4000-8000-000000000001', 'Payout card trip', 'payout-card-trip-4522', 'trip', 'scheduled',
        'public', 'America/New_York', 'USD', '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":100}]}'),
       ('45220008-0000-4000-8000-000000000025', '45220008-0000-4000-8000-000000000013',
        '45220008-0000-4000-8000-000000000001', 'Payout naira trip', 'payout-naira-trip-4522', 'trip', 'scheduled',
        'public', 'Africa/Lagos', 'NGN', '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":100}]}'),
       ('45220008-0000-4000-8000-000000000026', '45220008-0000-4000-8000-000000000012',
        '45220008-0000-4000-8000-000000000001', 'Payout plan trip', 'payout-plan-trip-4522', 'trip', 'scheduled',
        'public', 'America/New_York', 'USD', '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":100}]}');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220008-0000-4000-8000-000000000024', now() + interval '120 days', now() + interval '124 days', 'America/New_York', true),
       ('45220008-0000-4000-8000-000000000025', now() + interval '120 days', now() + interval '124 days', 'Africa/Lagos', true),
       ('45220008-0000-4000-8000-000000000026', now() + interval '120 days', now() + interval '124 days', 'America/New_York', true);

CREATE FUNCTION pg_temp.sale(p_order uuid, p_event uuid, p_cur text, p_total integer, p_ref text, p_plan boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, buyer_total_cents,
    list_subtotal_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, pricing_source, currency, payment_method,
    payment_status, source, installment_plan_root, stripe_payment_intent_id, stripe_application_fee_amount_cents,
    stripe_application_fee_id, created_at)
  VALUES (p_order, p_event, 'payout-' || p_ref || '@example.test', 'Payout Buyer', '+12025550199', p_total, p_total,
    p_total, p_total, 0, 0, 'provider_reconciled', p_cur, 'online_card', 'paid', 'online_checkout', p_plan,
    p_ref, (p_total * 45) / 1000, 'fee_' || p_ref, now() - interval '2 days');
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', p_order, (p_total * 29) / 1000 + 30);
END $$;

CREATE FUNCTION pg_temp.rel(p_order uuid) RETURNS public.brand_payout_releases LANGUAGE sql AS $$
  SELECT r.* FROM public.payout_release_items i JOIN public.brand_payout_releases r ON r.id = i.release_id
   WHERE i.source_type = 'order' AND i.source_id = p_order;
$$;

-- A card refund recorded as the refund edge records it: a pending refund row,
-- the provider attempt, then the 2097 finalize with the fee evidence.
CREATE FUNCTION pg_temp.card_refund(p_order uuid, p_amount integer, p_fee_back integer, p_finish boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_refund uuid; v_attempt uuid; v_owner uuid := gen_random_uuid(); v_fee integer; v_ref text;
BEGIN
  SELECT stripe_application_fee_amount_cents, stripe_payment_intent_id INTO v_fee, v_ref
    FROM public.orders WHERE id = p_order;
  INSERT INTO public.refunds(order_id, amount_cents, currency, status, reason)
  SELECT p_order, p_amount, currency, 'pending', 'i4522 host refund' FROM public.orders WHERE id = p_order
  RETURNING id INTO v_refund;
  IF NOT p_finish THEN RETURN v_refund; END IF;
  INSERT INTO public.ticket_refund_attempts(refund_id, order_id, request_fingerprint, expected_attempt_count,
    provider, provider_mode, currency, connected_account_id, charge_id, payment_intent_id, application_fee_id,
    application_fee_amount_text, baseline_amount_refunded_text, requested_refund_amount_text,
    buyer_refund_id, buyer_refund_amount_text, status, lease_owner, lease_epoch, lease_expires_at)
  VALUES (v_refund, p_order, 'i:' || v_refund, 1, 'stripe', 'test', 'usd', 'acct_i4522', 'ch_' || v_ref, v_ref,
    'fee_' || v_ref, v_fee::text,
    coalesce((SELECT sum(application_fee_refunded_cents) FROM public.refunds WHERE order_id = p_order AND status = 'succeeded'), 0)::text,
    p_amount::text, 're_' || v_refund, p_amount::text, 'pending_visibility', v_owner, 1, now() + interval '2 minutes')
  RETURNING id INTO v_attempt;
  PERFORM public.issue_2097_finalize_refund_attempt(v_attempt, v_owner, 1, 'succeeded_positive', 'fr_' || v_refund,
    p_fee_back::text,
    (coalesce((SELECT sum(application_fee_refunded_cents) FROM public.refunds WHERE order_id = p_order AND status = 'succeeded'), 0)
      + p_fee_back)::text, NULL);
  RETURN v_refund;
END $$;

-- Three $500 card sales; the real sweep attaches them to one payout.
SELECT pg_temp.sale('45220008-0000-4000-8000-0000000000e1', '45220008-0000-4000-8000-000000000024', 'USD', 50000, 'pi_i1', false);
SELECT pg_temp.sale('45220008-0000-4000-8000-0000000000e2', '45220008-0000-4000-8000-000000000024', 'USD', 50000, 'pi_i2', false);
SELECT pg_temp.sale('45220008-0000-4000-8000-0000000000e3', '45220008-0000-4000-8000-000000000024', 'USD', 50000, 'pi_i3', false);
SELECT public.run_payout_release_dark_sweep(now());
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- I1. Attached and pending: a full refund comes off the payout as soon as it
--     is asked for (held while pending), and stays off once recorded.
--     FAILS ON REVERT: the release kept 143,250 (all three sales' net).
DO $$
DECLARE v_r public.brand_payout_releases; v_refund uuid;
BEGIN
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000e1');
  IF v_r.status <> 'pending' OR v_r.net_release_cents <> 143250 THEN
    RAISE EXCEPTION 'I1-0 three sales attached at 47,750 each: % %', v_r.status, v_r.net_release_cents;
  END IF;
  v_refund := pg_temp.card_refund('45220008-0000-4000-8000-0000000000e1', 50000, 2250, false);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (pg_temp.rel('45220008-0000-4000-8000-0000000000e1')).net_release_cents <> 95500 THEN
    RAISE EXCEPTION 'I1-1 a sale with a refund pending is held from its payout: %',
      (pg_temp.rel('45220008-0000-4000-8000-0000000000e1')).net_release_cents;
  END IF;
  UPDATE public.refunds SET status = 'cancelled' WHERE id = v_refund;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (pg_temp.rel('45220008-0000-4000-8000-0000000000e1')).net_release_cents <> 143250 THEN
    RAISE EXCEPTION 'I1-2 a refund that never happened holds nothing';
  END IF;
  PERFORM pg_temp.card_refund('45220008-0000-4000-8000-0000000000e1', 50000, 2250);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000e1');
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000000e1') <> 50000
     OR v_r.net_release_cents <> 95500 OR v_r.refunded_cents <> 50000 THEN
    RAISE EXCEPTION 'I1-3 a recorded full refund leaves the other two sales due (95,500): net % refunded %',
      v_r.net_release_cents, v_r.refunded_cents;
  END IF;
END $$;

-- I2. The execution guard: a release left owing too much (as main leaves one
--     whose sale was refunded after it was attached) is never sent at that
--     amount; it is put back owing what its sales are worth, ops are told
--     once, and the next claim sends the right amount.
--     FAILS ON REVERT: authorize answered true for 143,250.
DO $$
DECLARE v_r public.brand_payout_releases; v_claim record; v_ok boolean;
BEGIN
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000e1');
  UPDATE public.brand_payout_releases SET net_release_cents = 143250, refunded_cents = 0 WHERE id = v_r.id;
  SELECT * INTO v_claim FROM public.claim_stripe_payout_releases(100, now()) c WHERE c.release_id = v_r.id;
  IF v_claim.net_release_cents <> 143250 THEN
    RAISE EXCEPTION 'I2-0 the stale release is claimed: %', v_claim;
  END IF;
  v_ok := public.authorize_stripe_payout_execution(v_r.id, v_claim.claim_id, 143250, now());
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000e1');
  IF v_ok OR v_r.status <> 'pending' OR v_r.net_release_cents <> 95500
     OR v_r.error_message <> 'payout_refund_unreconciled' THEN
    RAISE EXCEPTION 'I2-1 never sent above what the sales are worth: ok % status % net %', v_ok, v_r.status, v_r.net_release_cents;
  END IF;
  IF (SELECT count(*) FROM public.payout_release_alert_outbox
       WHERE release_id = v_r.id AND error_message LIKE 'payout_refund_unreconciled:%') <> 1 THEN
    RAISE EXCEPTION 'I2-2 ops are told once';
  END IF;
  SELECT * INTO v_claim FROM public.claim_stripe_payout_releases(100, now()) c WHERE c.release_id = v_r.id;
  IF NOT public.authorize_stripe_payout_execution(v_r.id, v_claim.claim_id, 95500, now()) THEN
    RAISE EXCEPTION 'I2-3 the right amount is sent';
  END IF;
  PERFORM public.record_stripe_payout_execution(v_r.id, v_claim.claim_id, 'accepted', 'po_i4522', 95500, NULL, now());
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000e1');
  IF v_r.status <> 'released' OR v_r.organiser_cash_delivered_cents <> 95500
     OR EXISTS (SELECT 1 FROM public.organiser_payout_debts WHERE origin_release_id = v_r.id) THEN
    RAISE EXCEPTION 'I2-4 paid 95,500 and owes nothing back';
  END IF;
END $$;

-- I3. Already paid: a partial refund (10,000, fee 450 back) becomes the
--     host's #3645 payout debt (9,550), ops are told once, and the next
--     payout nets it off: cumulative transfers = collected - refunded - fees.
--     FAILS ON REVERT: no debt; the next payout paid the full 47,750.
DO $$
DECLARE v_r public.brand_payout_releases; v_next public.brand_payout_releases;
BEGIN
  PERFORM pg_temp.card_refund('45220008-0000-4000-8000-0000000000e2', 10000, 450);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000e2');
  IF (SELECT principal_cents::text || '/' || status FROM public.organiser_payout_debts
       WHERE origin_release_id = v_r.id AND kind = 'post_release_refund') IS DISTINCT FROM '9550/open' THEN
    RAISE EXCEPTION 'I3-1 the refund after payout is the host''s debt: %',
      (SELECT row_to_json(d)::text FROM public.organiser_payout_debts d WHERE origin_release_id = v_r.id);
  END IF;
  IF (SELECT count(*) FROM public.payout_release_alert_outbox
       WHERE release_id = v_r.id AND error_message LIKE 'payout_refund_debt_opened:%') <> 1 THEN
    RAISE EXCEPTION 'I3-2 ops are told once about the debt';
  END IF;
  -- recorded again (a replayed commit): no second count
  PERFORM public.issue_4522_sync_order_payouts('45220008-0000-4000-8000-0000000000e2');
  IF (SELECT sum(principal_cents) FROM public.organiser_payout_debts WHERE origin_release_id = v_r.id) <> 9550 THEN
    RAISE EXCEPTION 'I3-3 a replay never grows the debt';
  END IF;
  PERFORM pg_temp.sale('45220008-0000-4000-8000-0000000000e4', '45220008-0000-4000-8000-000000000024', 'USD', 50000, 'pi_i4', false);
  PERFORM public.run_payout_release_dark_sweep(now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_next := pg_temp.rel('45220008-0000-4000-8000-0000000000e4');
  IF v_next.id = v_r.id OR v_next.net_release_cents <> 47750 - 9550 THEN
    RAISE EXCEPTION 'I3-4 the next payout nets the debt off: %', v_next.net_release_cents;
  END IF;
  -- 4 sales of 50,000; refunded 60,000; Mingla keeps 4 x 2,250 - 2,250 - 450
  IF v_r.organiser_cash_delivered_cents + v_next.net_release_cents <> 200000 - 60000 - (9000 - 2700) THEN
    RAISE EXCEPTION 'I3-5 the host is paid exactly collected - refunded - fees';
  END IF;
END $$;

-- I4. Gap 2: a plan deposit whose provider refund is made but not recorded
--     (the recording failed) is held from its payout; recorded, it stays off.
--     FAILS ON REVERT: the deposit stayed due in full (28,650).
DO $$
DECLARE v_refund uuid; v_r public.brand_payout_releases;
BEGIN
  PERFORM pg_temp.sale('45220008-0000-4000-8000-0000000000e5', '45220008-0000-4000-8000-000000000026', 'USD', 30000, 'pi_i5', true);
  PERFORM public.run_payout_release_dark_sweep(now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000e5');
  IF v_r.net_release_cents <> 28650 THEN
    RAISE EXCEPTION 'I4-0 the $300 deposit attached at 28,650: %', v_r.net_release_cents;
  END IF;
  v_refund := pg_temp.card_refund('45220008-0000-4000-8000-0000000000e5', 30000, 0, false);
  INSERT INTO public.ticket_refund_attempts(refund_id, order_id, request_fingerprint, expected_attempt_count,
    provider, provider_mode, currency, charge_id, payment_intent_id, requested_refund_amount_text,
    buyer_refund_id, buyer_refund_amount_text, status)
  VALUES (v_refund, '45220008-0000-4000-8000-0000000000e5', 'i4:' || v_refund, 1, 'stripe', 'test', 'usd',
    'ch_pi_i5', 'pi_i5', '30000', 're_i5', '30000', 'pending_visibility');
  UPDATE public.refunds SET status = 'failed' WHERE id = v_refund;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (pg_temp.rel('45220008-0000-4000-8000-0000000000e5')).net_release_cents <> 0 THEN
    RAISE EXCEPTION 'I4-1 a refund the provider made and our books did not record holds the deposit: %',
      (pg_temp.rel('45220008-0000-4000-8000-0000000000e5')).net_release_cents;
  END IF;
END $$;

-- I5. Second provider, attached and waiting for a bank: a full refund takes
--     the item off (the s9 finding: 286,500 stayed due); the host then adds
--     a bank and nothing is claimed. Then a refund that lands while a
--     transfer is planned: authorize refuses the plan and ops are told.
--     FAILS ON REVERT: net stayed 28,650,000; authorize answered true.
--     (The second provider keeps no fee on a refund: its refund row carries
--     the zero fee as not_applicable, as the trip-cancel commit records it.)
DO $$
DECLARE v_refund uuid; v_r public.brand_payout_releases; v_claim record; v_ok boolean;
BEGIN
  PERFORM pg_temp.sale('45220008-0000-4000-8000-0000000000f1', '45220008-0000-4000-8000-000000000025', 'NGN', 30000000, 'mingla_i_f1', false);
  PERFORM pg_temp.sale('45220008-0000-4000-8000-0000000000f2', '45220008-0000-4000-8000-000000000025', 'NGN', 30000000, 'mingla_i_f2', false);
  PERFORM public.run_payout_release_dark_sweep(now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000f1');
  IF v_r.provider <> 'paystack' OR v_r.net_release_cents <> 2 * 28650000 THEN
    RAISE EXCEPTION 'I5-0 two naira sales attached at 28,650,000: %', v_r.net_release_cents;
  END IF;
  INSERT INTO public.refunds(order_id, amount_cents, currency, status, reason,
    application_fee_refund_status, application_fee_refunded_cents)
  VALUES ('45220008-0000-4000-8000-0000000000f1', 30000000, 'NGN', 'pending', 'i5 host refund',
    'not_applicable', 0) RETURNING id INTO v_refund;
  PERFORM public.record_paystack_refund_outcome('order', '45220008-0000-4000-8000-0000000000f1', v_refund,
    'mingla_i_f1', 'mingla_refund:' || v_refund, 'ps_rf_i5', 30000000, 'processed', NULL, now());
  PERFORM public.admin_refund_order_commit(v_refund, 'ps_rf_i5', 0, 'succeeded', NULL);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000f1');
  IF v_r.net_release_cents <> 28650000 THEN
    RAISE EXCEPTION 'I5-1 the refunded naira sale is off its payout: %', v_r.net_release_cents;
  END IF;
  -- the host adds a bank; the payout is claimed for the one sale left
  INSERT INTO public.brand_paystack_recipients(brand_id, recipient_code, bank_code, account_fingerprint,
    account_number_masked, account_name, is_active)
  VALUES ('45220008-0000-4000-8000-000000000013', 'RCP_i4522', '058', 'hmac-sha256:' || repeat('a4', 32), '••••1234', 'Payout Host', true);
  SELECT * INTO v_claim FROM public.claim_paystack_payout_releases(100, now()) c WHERE c.release_id = v_r.id;
  IF v_claim.net_release_cents <> 28650000 THEN
    RAISE EXCEPTION 'I5-2 claimed for what is left: %', v_claim;
  END IF;
  PERFORM public.record_paystack_leg_plan(v_r.id, v_claim.claim_id,
    '[{"chunk_index":0,"principal_cents":28640000,"estimated_fee_cents":5000,"stamp_duty_cents":5000,"fee_schedule_version":"i4522"}]'::jsonb, now());
  -- the second sale is refunded while its transfer is planned
  INSERT INTO public.refunds(order_id, amount_cents, currency, status, reason,
    application_fee_refund_status, application_fee_refunded_cents)
  VALUES ('45220008-0000-4000-8000-0000000000f2', 30000000, 'NGN', 'pending', 'i5 second refund',
    'not_applicable', 0) RETURNING id INTO v_refund;
  PERFORM public.record_paystack_refund_outcome('order', '45220008-0000-4000-8000-0000000000f2', v_refund,
    'mingla_i_f2', 'mingla_refund:' || v_refund, 'ps_rf_i5b', 30000000, 'processed', NULL, now());
  PERFORM public.admin_refund_order_commit(v_refund, 'ps_rf_i5b', 0, 'succeeded', NULL);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_ok := public.authorize_paystack_payout_execution(v_r.id, v_claim.claim_id, now());
  v_r := pg_temp.rel('45220008-0000-4000-8000-0000000000f1');
  IF v_ok OR v_r.status <> 'pending' OR v_r.net_release_cents <> 0
     OR NOT EXISTS (SELECT 1 FROM public.payout_release_alert_outbox
                     WHERE release_id = v_r.id AND alert_kind = 'paystack_plan_exceeds_due') THEN
    RAISE EXCEPTION 'I5-3 never sends money refunded while the transfer was planned: ok % status % net %',
      v_ok, v_r.status, v_r.net_release_cents;
  END IF;
END $$;

-- I6. A naira refund after payout is owed once, whichever records it first
--     (found on the real path: the debt was booked by both the owner and
--     record_paystack_refund_outcome, 97,750,000 for a 47,740,000 payout).
--     Two paid sales of one trip, so the debt is not capped by the payout.
--     The debt is what the host was paid for the sale (28,650,000), not the
--     refund (30,000,000, G-2). FAILS ON REVERT: 57,280,000.
CREATE FUNCTION pg_temp.pay_naira(p_order uuid, p_ref text) RETURNS public.brand_payout_releases
LANGUAGE plpgsql AS $$
DECLARE v_r public.brand_payout_releases; v_claim record; v_leg uuid;
BEGIN
  PERFORM pg_temp.sale(p_order, '45220008-0000-4000-8000-000000000027', 'NGN', 30000000, p_ref, false);
  PERFORM public.run_payout_release_dark_sweep(now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_r := pg_temp.rel(p_order);
  SELECT * INTO v_claim FROM public.claim_paystack_payout_releases(100, now()) c WHERE c.release_id = v_r.id;
  PERFORM public.record_paystack_leg_plan(v_r.id, v_claim.claim_id,
    '[{"chunk_index":0,"principal_cents":28640000,"estimated_fee_cents":5000,"stamp_duty_cents":5000,"fee_schedule_version":"i4522"}]'::jsonb, now());
  IF NOT public.authorize_paystack_payout_execution(v_r.id, v_claim.claim_id, now()) THEN
    RAISE EXCEPTION 'I6-0 the naira payout is sent';
  END IF;
  SELECT id INTO v_leg FROM public.payout_transfer_legs WHERE release_id = v_r.id AND kind = 'organiser';
  PERFORM public.record_paystack_transfer_leg_outcome(v_leg, v_r.id, 'succeeded', 'TRF_' || p_ref, 'ref-' || p_ref, NULL, now());
  PERFORM public.reconcile_paystack_transfer_leg_fee(v_leg, 5000, 5000, now());
  RETURN pg_temp.rel(p_order);
END $$;
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
  currency, refund_policy)
VALUES ('45220008-0000-4000-8000-000000000027', '45220008-0000-4000-8000-000000000013',
  '45220008-0000-4000-8000-000000000001', 'Payout naira trip 2', 'payout-naira-trip-2-4522', 'trip', 'scheduled',
  'public', 'Africa/Lagos', 'NGN', '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":100}]}');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220008-0000-4000-8000-000000000027', now() + interval '120 days', now() + interval '124 days', 'Africa/Lagos', true);
DO $$
DECLARE v_r public.brand_payout_releases; v_other public.brand_payout_releases; v_refund uuid;
BEGIN
  v_r := pg_temp.pay_naira('45220008-0000-4000-8000-0000000000f3', 'mingla_i_f3');
  v_other := pg_temp.pay_naira('45220008-0000-4000-8000-0000000000f4', 'mingla_i_f4');
  IF v_r.status <> 'released' OR v_other.status <> 'released' OR v_other.id = v_r.id THEN
    RAISE EXCEPTION 'I6-1 two paid naira payouts: % %', v_r.status, v_other.status;
  END IF;
  -- the refund is recorded on the order first, then its provider outcome
  INSERT INTO public.refunds(order_id, amount_cents, currency, status, reason,
    application_fee_refund_status, application_fee_refunded_cents)
  VALUES ('45220008-0000-4000-8000-0000000000f3', 30000000, 'NGN', 'pending', 'i6 refund after payout',
    'not_applicable', 0) RETURNING id INTO v_refund;
  PERFORM public.admin_refund_order_commit(v_refund, 'ps_rf_i6', 0, 'succeeded', NULL);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM public.record_paystack_refund_outcome('order', '45220008-0000-4000-8000-0000000000f3', v_refund,
    'mingla_i_f3', 'mingla_refund:' || v_refund, 'ps_rf_i6', 30000000, 'processed', NULL, now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (SELECT sum(principal_cents) FROM public.organiser_payout_debts
       WHERE origin_release_id = v_r.id AND kind = 'post_release_refund') <> 28650000 THEN
    RAISE EXCEPTION 'I6-2 the refund after payout is owed once, what the host was paid for it: %',
      (SELECT sum(principal_cents) FROM public.organiser_payout_debts WHERE origin_release_id = v_r.id);
  END IF;
  IF (SELECT count(*) FROM public.payout_release_alert_outbox
       WHERE release_id = v_r.id AND error_message LIKE 'payout_refund_debt_opened:%') <> 1 THEN
    RAISE EXCEPTION 'I6-3 ops are told once';
  END IF;
END $$;

-- I7. G-2 (sixth pass, B755E91F): a naira trip cancel after the deposit was
--     paid out and the first instalment was not. The second provider's
--     outcome books the whole cancel (deposit + instalment) against the
--     order's payout; the host owes back only what it was paid for the
--     deposit, and the unpaid instalment comes off its own payout.
--     FAILS ON REVERT: debt 60,600,000 for a 28,650,000 payout.
CREATE FUNCTION pg_temp.pay_out(p_release uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_claim record; v_leg uuid;
BEGIN
  SELECT * INTO v_claim FROM public.claim_paystack_payout_releases(100, now()) c WHERE c.release_id = p_release;
  PERFORM public.record_paystack_leg_plan(p_release, v_claim.claim_id, jsonb_build_array(jsonb_build_object(
    'chunk_index', 0, 'principal_cents', v_claim.net_release_cents - 10000, 'estimated_fee_cents', 5000,
    'stamp_duty_cents', 5000, 'fee_schedule_version', 'i4522')), now());
  IF NOT public.authorize_paystack_payout_execution(p_release, v_claim.claim_id, now()) THEN
    RAISE EXCEPTION 'pay_out: not authorized';
  END IF;
  SELECT id INTO v_leg FROM public.payout_transfer_legs WHERE release_id = p_release AND kind = 'organiser';
  PERFORM public.record_paystack_transfer_leg_outcome(v_leg, p_release, 'succeeded', 'TRF_' || p_release, 'ref-' || p_release, NULL, now());
  PERFORM public.reconcile_paystack_transfer_leg_fee(v_leg, 5000, 5000, now());
END $$;
UPDATE public.brands SET payout_hold_cutover_at = now() - interval '30 days' WHERE id = '45220008-0000-4000-8000-000000000010';
INSERT INTO public.brand_paystack_recipients(brand_id, recipient_code, bank_code, account_fingerprint,
  account_number_masked, account_name, is_active)
VALUES ('45220008-0000-4000-8000-000000000010', 'RCP_i4522g7', '058', 'hmac-sha256:' || repeat('c6', 32), '••••5678', 'Refund Host', true);
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000007a1',
  '{"v":2,"deposit_minor":30000000,"deposit_non_refundable":false,"flex_enabled":true,"auto_adjust":true}', NULL);
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000007a2',
  '{"v":2,"deposit_minor":30000000,"deposit_non_refundable":false,"flex_enabled":true,"auto_adjust":true}', NULL);
INSERT INTO public.order_line_items(order_id, ticket_type_id, unit_price_cents, total_cents, quantity, payment_plan_choice)
VALUES ('45220008-0000-4000-8000-0000000007a1', '45220008-0000-4000-8000-000000000030', 120000000, 120000000, 1, 'installments');
UPDATE public.orders SET created_at = now() - interval '2 days', stripe_application_fee_amount_cents = 1350000
 WHERE id IN ('45220008-0000-4000-8000-0000000007a1', '45220008-0000-4000-8000-0000000007a2');
INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
VALUES ('order', '45220008-0000-4000-8000-0000000007a1', 450000), ('order', '45220008-0000-4000-8000-0000000007a2', 450000);
DO $$
DECLARE v_dep public.brand_payout_releases; v_row uuid; v_row_rel public.brand_payout_releases; v_b jsonb; v_refund uuid;
BEGIN
  -- both deposits paid out (two payouts of the trip)
  PERFORM public.run_payout_release_dark_sweep(now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_dep := pg_temp.rel('45220008-0000-4000-8000-0000000007a1');
  PERFORM pg_temp.pay_out(v_dep.id);
  IF (pg_temp.rel('45220008-0000-4000-8000-0000000007a2')).status = 'pending' THEN
    PERFORM pg_temp.pay_out((pg_temp.rel('45220008-0000-4000-8000-0000000007a2')).id);
  END IF;
  v_dep := pg_temp.rel('45220008-0000-4000-8000-0000000007a1');
  IF v_dep.status <> 'released' THEN RAISE EXCEPTION 'I7-0 the deposit is paid out: %', v_dep.status; END IF;
  -- the first instalment is collected and attached, not paid out
  SELECT id INTO v_row FROM public.order_installments WHERE order_id = '45220008-0000-4000-8000-0000000007a1' AND ordinal = 1;
  UPDATE public.order_installments SET status = 'collected', collected_at = now() - interval '2 days',
         stripe_payment_intent_id = 'mingla-inst-7a1-a1', provider_transaction_id = '4522977001',
         application_fee_amount_cents = 1350000, payout_accounting_state = 'ready'
   WHERE id = v_row;
  PERFORM public.run_payout_release_dark_sweep(now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  SELECT r.* INTO v_row_rel FROM public.payout_release_items i JOIN public.brand_payout_releases r ON r.id = i.release_id
   WHERE i.source_type = 'order_installment' AND i.source_id = v_row;
  IF v_row_rel.status <> 'pending' OR v_row_rel.net_release_cents <= 0 THEN
    RAISE EXCEPTION 'I7-1 the instalment waits in its own payout: % %', v_row_rel.status, v_row_rel.net_release_cents;
  END IF;
  -- the host cancels: deposit + instalment refunded, the outcome booked on the order (main's router)
  v_b := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000007a1', 'operator',
    '45220008-0000-4000-8000-000000000001', 'Host cancelled the trip');
  v_refund := (v_b->>'refund_id')::uuid;
  PERFORM public.record_paystack_refund_outcome('order', '45220008-0000-4000-8000-0000000007a1', v_refund,
    'ps_deposit_45220008-0000-4000-8000-0000000007a1', 'mingla_trip_refund:' || v_refund, 'ps_rf_i7',
    (v_b->>'refund_total_cents')::integer, 'processed', NULL, now());
  PERFORM public.issue_3645_mark_installment_refunded(v_row, v_refund, 30600000);
  PERFORM public.biz_cancel_trip_booking_commit(v_refund, ARRAY['ps_rf_i7'], 0, now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (SELECT sum(principal_cents) FROM public.organiser_payout_debts
       WHERE origin_release_id = v_dep.id AND kind = 'post_release_refund') <> 28650000 THEN
    RAISE EXCEPTION 'I7-2 the host owes back only what it was paid for the deposit (28,650,000): %',
      (SELECT sum(principal_cents) FROM public.organiser_payout_debts WHERE origin_release_id = v_dep.id);
  END IF;
  IF (SELECT net_release_cents FROM public.brand_payout_releases WHERE id = v_row_rel.id) <> 0 THEN
    RAISE EXCEPTION 'I7-3 the unpaid instalment comes off its own payout';
  END IF;
  IF (SELECT count(*) FROM public.payout_release_alert_outbox
       WHERE release_id = v_dep.id AND error_message LIKE 'payout_refund_debt_opened:%') <> 1 THEN
    RAISE EXCEPTION 'I7-4 ops are told once';
  END IF;
END $$;

-- I8. G-4 (sixth pass): a cancel whose refund was refused before any money
--     moved leaves the booking cancelled with its refund failed; every sale
--     of it is held from payouts until a refund is recorded.
--     FAILS ON REVERT: the deposit stayed due (28,650,000).
DO $$
DECLARE v_r public.brand_payout_releases;
BEGIN
  PERFORM pg_temp.sale('45220008-0000-4000-8000-0000000000e9', '45220008-0000-4000-8000-000000000026', 'USD', 30000, 'pi_i9', true);
  PERFORM public.run_payout_release_dark_sweep(now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (pg_temp.rel('45220008-0000-4000-8000-0000000000e9')).net_release_cents <> 28650 THEN
    RAISE EXCEPTION 'I8-0 the deposit attached at 28,650';
  END IF;
  UPDATE public.orders SET cancelled_at = now() WHERE id = '45220008-0000-4000-8000-0000000000e9';
  INSERT INTO public.refunds(order_id, amount_cents, currency, status, reason)
  VALUES ('45220008-0000-4000-8000-0000000000e9', 30000, 'USD', 'pending', 'i8 cancel refund');
  UPDATE public.refunds SET status = 'failed' WHERE order_id = '45220008-0000-4000-8000-0000000000e9';
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (pg_temp.rel('45220008-0000-4000-8000-0000000000e9')).net_release_cents <> 0 THEN
    RAISE EXCEPTION 'I8-1 a cancelled booking whose refund failed is held from payouts: %',
      (pg_temp.rel('45220008-0000-4000-8000-0000000000e9')).net_release_cents;
  END IF;
END $$;

-- J. G-3 / G-4: one trip cancel is one refund operation, always completable.
--    A card plan order shaped like a real one (deposit on the order, each
--    collected instalment its own charge), on the card trip of section G.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, buyer_total_cents,
  list_subtotal_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, pricing_source,
  currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms, stripe_payment_intent_id)
VALUES ('45220008-0000-4000-8000-0000000004f1', '45220008-0000-4000-8000-000000000022', 'card-op@example.test',
  'Card Op', '+12025550112', 30000, 30000, 30000, 30000, 0, 0, 'provider_reconciled',
  'USD', 'online_card', 'paid', 'online_checkout', true,
  '{"v":2,"deposit_minor":30000,"deposit_non_refundable":true,"flex_enabled":true,"auto_adjust":true}', 'pi_j_deposit');
INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
  collection_method, plan_bound_at, collected_at, stripe_payment_intent_id, application_fee_amount_cents, payout_accounting_state)
SELECT '45220008-0000-4000-8000-0000000004f1', g, 30000, 'USD', now() - interval '1 day',
       CASE WHEN g < 3 THEN 'collected' ELSE 'scheduled' END, 'stripe', 'auto_card', now() - interval '2 days',
       CASE WHEN g < 3 THEN now() - interval '1 day' END, CASE WHEN g < 3 THEN 'pi_j_row' || g END,
       CASE WHEN g < 3 THEN 1350 END, CASE WHEN g < 3 THEN 'ready' ELSE 'pending' END
  FROM generate_series(1, 3) g;

-- J1. Begin writes the refunds the cancel intends on its refunds row; a host
--     retry of the cancelled booking resumes that same operation (same refund,
--     same amounts, who cancelled and why). FAILS ON REVERT: the retry answered
--     "already_cancelled" with the deposit refund never sent (G-3).
DO $$
DECLARE v_b jsonb; v_r jsonb; v_op jsonb;
BEGIN
  v_b := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000004f1', 'operator',
    '45220008-0000-4000-8000-000000000001', 'Host cancelled: weather');
  IF NOT COALESCE((v_b->>'operation')::boolean, false) OR (v_b->>'refund_total_cents')::bigint <> 90000 THEN
    RAISE EXCEPTION 'J1-0 the cancel is one operation refunding 90,000: %', v_b;
  END IF;
  v_op := public.issue_4522_trip_cancel_operation('45220008-0000-4000-8000-0000000004f1');
  IF v_op IS NULL OR jsonb_array_length(v_op->'per_payment_refund') <> 3
     OR v_op->>'actor_kind' <> 'operator' OR v_op->>'reason' <> 'Host cancelled: weather' THEN
    RAISE EXCEPTION 'J1-1 the operation lists the three intended refunds and its actor: %', v_op;
  END IF;
  v_r := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000004f1', 'operator',
    '45220008-0000-4000-8000-000000000001', 'Host pressed it again');
  IF NOT COALESCE((v_r->>'resume')::boolean, false) OR v_r->>'refund_id' <> v_b->>'refund_id'
     OR (v_r->>'refund_total_cents')::bigint <> 90000 OR v_r->>'cancel_reason' <> 'Host cancelled: weather'
     OR jsonb_array_length(v_r->'per_payment_refund') <> 3 THEN
    RAISE EXCEPTION 'J1-2 a retry resumes the same operation: %', v_r;
  END IF;
  IF (SELECT count(*) FROM public.refunds WHERE order_id = '45220008-0000-4000-8000-0000000004f1') <> 1 THEN
    RAISE EXCEPTION 'J1-3 a resume never opens a second refund';
  END IF;
  -- while it is in progress every sale of the booking counts 0 for payouts
  IF (SELECT n.net_cents FROM public.issue_4522_payout_item_now('order', '45220008-0000-4000-8000-0000000004f1',
        30000, 0, 0, 1350, 28650) n) <> 0
     OR (SELECT n.net_cents FROM public.order_installments oi
           CROSS JOIN LATERAL public.issue_4522_payout_item_now('order_installment', oi.id, 30000, 0, 0, 1350, 28650) n
          WHERE oi.order_id = '45220008-0000-4000-8000-0000000004f1' AND oi.ordinal = 1) <> 0 THEN
    RAISE EXCEPTION 'J1-4 a cancel in progress holds its sales from payouts';
  END IF;
END $$;

-- J2. The read-back and the one alert: listed once untouched for 2 minutes;
--     ops alerted exactly once, at the 3rd failure (then no longer listed);
--     completed once. FAILS ON REVERT: no read-back (functions absent).
DO $$
DECLARE v_refund uuid; v_n jsonb; v_alerts int := 0; i int;
BEGIN
  SELECT id INTO v_refund FROM public.refunds WHERE order_id = '45220008-0000-4000-8000-0000000004f1';
  IF '45220008-0000-4000-8000-0000000004f1'::uuid IN (SELECT public.issue_4522_trip_cancels_to_resume(50)) THEN
    RAISE EXCEPTION 'J2-0 a cancel just begun is left to its own call';
  END IF;
  UPDATE public.refunds SET metadata = jsonb_set(metadata, '{trip_cancel,last_attempt_at}', to_jsonb(now() - interval '3 minutes'))
   WHERE id = v_refund;
  IF '45220008-0000-4000-8000-0000000004f1'::uuid NOT IN (SELECT public.issue_4522_trip_cancels_to_resume(50)) THEN
    RAISE EXCEPTION 'J2-1 an operation untouched for 2 minutes is resumed by the instalment run';
  END IF;
  v_n := public.issue_4522_trip_cancel_note(v_refund, 'waiting', 'fee_truth_pending_visibility');
  IF (v_n->>'failures')::int <> 0 OR (v_n->>'alert')::boolean THEN
    RAISE EXCEPTION 'J2-2 waiting on the provider is no failure: %', v_n;
  END IF;
  FOR i IN 1..4 LOOP
    v_n := public.issue_4522_trip_cancel_note(v_refund, 'failure', 'refund refused', CASE WHEN i = 1 THEN 'deposit' END);
    IF (v_n->>'alert')::boolean THEN v_alerts := v_alerts + 1; END IF;
    IF i = 3 AND NOT (v_n->>'alert')::boolean THEN RAISE EXCEPTION 'J2-3 the 3rd failure alerts ops'; END IF;
  END LOOP;
  IF v_alerts <> 1 THEN RAISE EXCEPTION 'J2-4 ops are alerted exactly once (%)', v_alerts; END IF;
  IF (SELECT metadata #>> '{trip_cancel,card_tries,deposit}' FROM public.refunds WHERE id = v_refund) <> '1' THEN
    RAISE EXCEPTION 'J2-5 a refused card refund takes a new provider key next time';
  END IF;
  UPDATE public.refunds SET metadata = jsonb_set(metadata, '{trip_cancel,last_attempt_at}', to_jsonb(now() - interval '3 minutes'))
   WHERE id = v_refund;
  IF '45220008-0000-4000-8000-0000000004f1'::uuid IN (SELECT public.issue_4522_trip_cancels_to_resume(50)) THEN
    RAISE EXCEPTION 'J2-6 past the budget the run stops (ops have it; a host retry still resumes)';
  END IF;
  IF NOT (public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000004f1', 'operator', NULL, 'again')->>'resume')::boolean THEN
    RAISE EXCEPTION 'J2-7 a host retry still resumes past the budget';
  END IF;
  IF NOT (public.issue_4522_trip_cancel_note(v_refund, 'completed', NULL)->>'first_completion')::boolean
     OR (public.issue_4522_trip_cancel_note(v_refund, 'completed', NULL)->>'first_completion')::boolean THEN
    RAISE EXCEPTION 'J2-8 an operation completes exactly once';
  END IF;
  IF public.issue_4522_trip_cancel_operation('45220008-0000-4000-8000-0000000004f1') IS NOT NULL
     OR public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000004f1', 'operator', NULL, 'again')->>'reason'
        <> 'already_cancelled' THEN
    RAISE EXCEPTION 'J2-9 a completed cancel is no longer in progress';
  END IF;
END $$;

-- J3. A second-provider refund of an operation is sent at most once: one
--     claim wins; a provider refusal (no money moved) releases it. FAILS ON
--     REVERT: nothing marked a sent refund, so a resume could send it again.
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000004f3', NULL, NULL);
DO $$
DECLARE v_b jsonb; v_note text;
BEGIN
  v_b := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000004f3', 'operator', NULL, 'Host cancelled');
  v_note := 'mingla_trip_refund:' || (v_b->>'refund_id') || ':deposit';
  IF NOT public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note)
     OR public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note) THEN
    RAISE EXCEPTION 'J3-0 exactly one caller may send it';
  END IF;
  IF NOT public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note, true)
     OR NOT public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note) THEN
    RAISE EXCEPTION 'J3-1 a refused refund may be sent once more';
  END IF;
  PERFORM public.record_paystack_refund_outcome('order', '45220008-0000-4000-8000-0000000004f3', (v_b->>'refund_id')::uuid,
    'ps_deposit_45220008-0000-4000-8000-0000000004f3', v_note, '4522001', 30000000, 'accepted');
  IF public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note)
     OR public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note, true) THEN
    RAISE EXCEPTION 'J3-2 a refund the provider answered is never sent again';
  END IF;
END $$;

-- J4. Card cancel final status: every charge refunded in full ends
--     'refunded'; a kept deposit leaves it 'partial_refund'. FAILS ON REVERT:
--     a card cancel that refunded everything stayed 'partial_refund'.
DO $$
DECLARE v_refund uuid; v_row record;
BEGIN
  SELECT id INTO v_refund FROM public.refunds WHERE order_id = '45220008-0000-4000-8000-0000000004f1';
  FOR v_row IN SELECT id FROM public.order_installments
                WHERE order_id = '45220008-0000-4000-8000-0000000004f1' AND status = 'collected' LOOP
    PERFORM public.issue_3645_mark_installment_refunded(v_row.id, v_refund, 30000);
  END LOOP;
  UPDATE public.refunds SET status = 'succeeded', application_fee_refunded_cents = 0,
         application_fee_refund_status = 'not_applicable', processed_at = now() WHERE id = v_refund;
  UPDATE public.orders SET refunded_amount_cents = public.issue_4522_order_charge_refunded_cents(id),
         payment_status = 'partial_refund' WHERE id = '45220008-0000-4000-8000-0000000004f1';
  IF public.issue_4522_settle_trip_cancel_status('45220008-0000-4000-8000-0000000004f1') <> 'refunded' THEN
    RAISE EXCEPTION 'J4-0 a fully refunded cancelled booking ends refunded';
  END IF;
  UPDATE public.orders SET refunded_amount_cents = 0 WHERE id = '45220008-0000-4000-8000-0000000004f1';
  IF public.issue_4522_settle_trip_cancel_status('45220008-0000-4000-8000-0000000004f1') <> 'partial_refund' THEN
    RAISE EXCEPTION 'J4-1 a kept deposit leaves it partly refunded';
  END IF;
END $$;

-- J5. Seventh pass (H-2): a second-provider cancel whose instalment refund got
--     no answer while its deposit refund was processed. Each refund the
--     provider confirms is recorded against its own charge at once (the
--     refund webhook writes the attempt through record_paystack_refund_outcome);
--     the cancel stays in progress until the last one, and settles once.
--     A plan order shaped like a real one: the order row is the ₦300,000
--     deposit, the collected instalment its own charge. FAILS ON REVERT: the
--     processed deposit stayed unrecorded (order ₦0 refunded) until the
--     unanswered instalment was resolved.
SELECT pg_temp.seed_order('45220008-0000-4000-8000-0000000004f5', NULL, NULL);
UPDATE public.order_installments SET status = 'collected', collected_at = now() - interval '1 day',
       due_at = now() - interval '1 day', stripe_payment_intent_id = 'mingla-inst-j5-a1', payout_accounting_state = 'ready'
 WHERE order_id = '45220008-0000-4000-8000-0000000004f5' AND ordinal = 1;
DO $$
DECLARE v_b jsonb; v_refund uuid; v_row uuid; v_o public.orders;
BEGIN
  v_b := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000004f5', 'operator', NULL, 'Host cancelled');
  v_refund := (v_b->>'refund_id')::uuid;
  SELECT id INTO v_row FROM public.order_installments WHERE order_id = '45220008-0000-4000-8000-0000000004f5' AND ordinal = 1;
  IF (v_b->>'refund_total_cents')::bigint <> 60600000 THEN
    RAISE EXCEPTION 'J5-0 the cancel refunds the deposit and the collected instalment: %', v_b;
  END IF;
  -- the instalment refund was sent and never answered
  PERFORM public.issue_4522_claim_trip_paystack_send(v_refund, 'mingla_trip_refund:' || v_refund || ':' || v_row);
  -- the deposit refund: queued, then processed (its webhook)
  PERFORM public.record_paystack_refund_outcome('order', '45220008-0000-4000-8000-0000000004f5', v_refund,
    'ps_deposit_45220008-0000-4000-8000-0000000004f5', 'mingla_trip_refund:' || v_refund || ':deposit', '4522j51', 30000000, 'accepted');
  SELECT * INTO v_o FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000004f5';
  IF v_o.refunded_amount_cents <> 0 THEN
    RAISE EXCEPTION 'J5-1 a refund the provider only queued is not yet refunded money: %', v_o.refunded_amount_cents;
  END IF;
  PERFORM public.record_paystack_refund_outcome('order', '45220008-0000-4000-8000-0000000004f5', v_refund,
    'ps_deposit_45220008-0000-4000-8000-0000000004f5', 'mingla_trip_refund:' || v_refund || ':deposit', '4522j51', 30000000, 'processed');
  SELECT * INTO v_o FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000004f5';
  IF v_o.refunded_amount_cents <> 30000000 OR v_o.payment_status <> 'partial_refund' THEN
    RAISE EXCEPTION 'J5-2 the confirmed deposit refund is recorded on the order at once: % %',
      v_o.refunded_amount_cents, v_o.payment_status;
  END IF;
  IF (SELECT status FROM public.refunds WHERE id = v_refund) <> 'pending'
     OR public.issue_4522_trip_cancel_operation('45220008-0000-4000-8000-0000000004f5') IS NULL
     OR (SELECT refunded_amount_cents FROM public.order_installments WHERE id = v_row) <> 0 THEN
    RAISE EXCEPTION 'J5-3 the cancel stays in progress; the unanswered instalment is not recorded';
  END IF;
  IF (SELECT n.net_cents FROM public.order_installments oi
        CROSS JOIN LATERAL public.issue_4522_payout_item_now('order_installment', oi.id, 30600000, 0, 0, 1350000, 29050000) n
       WHERE oi.id = v_row) <> 0 THEN
    RAISE EXCEPTION 'J5-4 the instalment whose refund is unknown stays held from payouts';
  END IF;
  -- the provider shows the instalment refund later (read-back or its webhook)
  PERFORM public.record_paystack_refund_outcome('order', '45220008-0000-4000-8000-0000000004f5', v_refund,
    'mingla-inst-j5-a1', 'mingla_trip_refund:' || v_refund || ':' || v_row, '4522j52', 30600000, 'processed');
  IF (SELECT refunded_amount_cents FROM public.order_installments WHERE id = v_row) <> 30600000
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000004f5') <> 30000000 THEN
    RAISE EXCEPTION 'J5-5 the instalment refund is recorded on its own row, the deposit stays counted once';
  END IF;
  -- the cancel's commit settles it: nothing counted twice
  IF NOT (public.biz_cancel_trip_booking_commit(v_refund, ARRAY['4522j52', '4522j51'], 0)->>'ok')::boolean
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000004f5') <> 30000000
     OR public.issue_4522_settle_trip_cancel_status('45220008-0000-4000-8000-0000000004f5') <> 'refunded' THEN
    RAISE EXCEPTION 'J5-6 the commit settles the cancel once and the booking ends refunded';
  END IF;
END $$;

-- J6. Seventh pass (H-1 a): a cancel after an earlier refund of the same
--     charge refunds at most what is left on it: policy % × (paid − already
--     refunded − a kept deposit), floor 0, per charge. Orders shaped like real
--     ones: a plan order whose $420 deposit carried a $120 add-on paid today
--     (the add-on refunded first), and a $1,000 pay-in-full order with one of
--     two seats ($500) refunded first. FAILS ON REVERT: the preview and begin
--     asked for $420 / $1,000, which the provider refused (more than is
--     unrefunded) and the booking stayed cancelled with nothing refunded.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, buyer_total_cents,
  list_subtotal_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, pricing_source,
  currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms,
  addon_payment_mode, stripe_payment_intent_id)
VALUES ('45220008-0000-4000-8000-0000000004f7', '45220008-0000-4000-8000-000000000022', 'addon-first@example.test',
  'Addon First', '+12025550114', 42000, 42000, 42000, 42000, 0, 0, 'provider_reconciled',
  'USD', 'online_card', 'partial_refund', 'online_checkout', true,
  '{"v":2,"deposit_minor":30000,"deposit_non_refundable":true,"flex_enabled":false,"auto_adjust":true}', 'today',
  'pi_j6_deposit'),
  ('45220008-0000-4000-8000-0000000004f8', '45220008-0000-4000-8000-000000000022', 'seat-first@example.test',
  'Seat First', '+12025550115', 100000, 100000, 100000, 100000, 0, 0, 'provider_reconciled',
  'USD', 'online_card', 'partial_refund', 'online_checkout', false, NULL, NULL, 'pi_j6_full');
INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
  collection_method, plan_bound_at)
SELECT '45220008-0000-4000-8000-0000000004f7', g, 30000, 'USD', now() + (g * 20 || ' days')::interval,
       'scheduled', 'stripe', 'auto_card', now()
  FROM generate_series(1, 3) g;
INSERT INTO public.refunds(order_id, amount_cents, currency, status, reason, application_fee_refunded_cents,
  application_fee_refund_status, processed_at)
VALUES ('45220008-0000-4000-8000-0000000004f7', 12000, 'USD', 'succeeded', 'Add-on refunded', 540, 'succeeded_positive', now()),
       ('45220008-0000-4000-8000-0000000004f8', 50000, 'USD', 'succeeded', 'One seat refunded', 2250, 'succeeded_positive', now());
UPDATE public.orders SET refunded_amount_cents = public.issue_4522_order_charge_refunded_cents(id)
 WHERE id IN ('45220008-0000-4000-8000-0000000004f7', '45220008-0000-4000-8000-0000000004f8');
DO $$
DECLARE v jsonb; v_e jsonb;
BEGIN
  -- host cancel: the deposit is refunded (D-9), but only what is left of it
  v := public.issue_4522_compute_refund_for_cancel_as('45220008-0000-4000-8000-0000000004f7', now(), 'operator');
  v_e := v->'per_payment_refund'->(jsonb_array_length(v->'per_payment_refund') - 1);
  IF (v->>'refund_total_cents')::bigint <> 30000 OR (v_e->>'refund_cents')::bigint <> 30000
     OR (v_e->>'paid_cents')::bigint <> 30000 OR (v_e->>'charge_cents')::bigint <> 42000 THEN
    RAISE EXCEPTION 'J6-0 add-on refunded first: the host cancel refunds the $300 left, never $420: %', v;
  END IF;
  -- traveler: the non-refundable trip part is kept; nothing else is left
  v := public.issue_4522_compute_refund_for_cancel_as('45220008-0000-4000-8000-0000000004f7', now(), 'buyer');
  IF (v->>'refund_total_cents')::bigint <> 0 THEN
    RAISE EXCEPTION 'J6-1 the traveler keeps nothing more back than is left: %', v;
  END IF;
  -- pay in full, one of two seats refunded: 100% of the $500 left
  v := public.issue_4522_compute_refund_for_cancel_as('45220008-0000-4000-8000-0000000004f8', now(), 'operator');
  IF (v->>'refund_total_cents')::bigint <> 50000 OR (v->>'paid_total_cents')::bigint <> 50000
     OR (v->'per_payment_refund'->0->>'charge_cents')::bigint <> 100000 THEN
    RAISE EXCEPTION 'J6-2 seat refunded first: the cancel refunds the $500 left: %', v;
  END IF;
  -- begin writes the same amount the preview showed
  v := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-0000000004f8', 'operator', NULL, 'Host cancelled');
  IF (v->>'refund_total_cents')::bigint <> 50000 THEN
    RAISE EXCEPTION 'J6-3 begin refunds what the preview showed: %', v;
  END IF;
END $$;
-- a 50% tier applies to what is left (spec §5.5: base = paid − already refunded)
UPDATE public.events SET refund_policy = '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":50}]}'
 WHERE id = '45220008-0000-4000-8000-000000000022';
DO $$
BEGIN
  IF (public.issue_4522_compute_refund_for_cancel_as('45220008-0000-4000-8000-0000000004f7', now(), 'operator')
        ->>'refund_total_cents')::bigint <> 15000 THEN
    RAISE EXCEPTION 'J6-4 a 50%% tier is half of what is left';
  END IF;
END $$;
UPDATE public.events SET refund_policy = '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":100}]}'
 WHERE id = '45220008-0000-4000-8000-000000000022';

-- J7. Seventh pass (H-1 b): no state of a cancel is "in progress" forever in
--     silence. Waiting on the provider (or refused by it) past 24 hours is
--     one ops alert ('stuck'); before that, waiting alerts nobody. FAILS ON
--     REVERT: waiting never counted, so no alert was ever sent.
DO $$
DECLARE v_refund uuid; v_n jsonb; v_alerts int := 0; i int;
BEGIN
  SELECT id INTO v_refund FROM public.refunds WHERE order_id = '45220008-0000-4000-8000-0000000004f8'
     AND metadata ? 'trip_cancel';
  v_n := public.issue_4522_trip_cancel_note(v_refund, 'waiting', 'fee_truth_awaiting_application_fee');
  IF (v_n->>'alert')::boolean THEN RAISE EXCEPTION 'J7-0 a fresh wait alerts nobody'; END IF;
  UPDATE public.refunds SET created_at = now() - interval '25 hours' WHERE id = v_refund;
  FOR i IN 1..3 LOOP
    v_n := public.issue_4522_trip_cancel_note(v_refund, 'waiting', 'fee_truth_awaiting_application_fee');
    IF (v_n->>'alert')::boolean THEN
      v_alerts := v_alerts + 1;
      IF v_n->>'cause' <> 'stuck' THEN RAISE EXCEPTION 'J7-1 the alert names its cause: %', v_n; END IF;
    END IF;
  END LOOP;
  IF v_alerts <> 1 THEN RAISE EXCEPTION 'J7-2 past 24 hours ops are told exactly once (%)', v_alerts; END IF;
  IF '45220008-0000-4000-8000-0000000004f8'::uuid IN (SELECT public.issue_4522_trip_cancels_to_resume(50))
     AND (SELECT (metadata #>> '{trip_cancel,failures}')::int FROM public.refunds WHERE id = v_refund) <> 0 THEN
    RAISE EXCEPTION 'J7-3 waiting is still no failure';
  END IF;
END $$;

-- J8. Seventh pass (H-7): a host or Admin refund of a second-provider order
--     commits with its zero fee recorded as not applicable, so the refund
--     settles and the order shows it. A pay-in-full second-provider order
--     shaped like a real one. FAILS ON REVERT: the commit broke
--     refunds_application_fee_amount_truth_check after the provider had
--     refunded, and the refund stayed pending (order ₦0 refunded).
INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
  currency, payment_method, payment_status, source, installment_plan_root, stripe_payment_intent_id, stripe_charge_id)
VALUES ('45220008-0000-4000-8000-0000000004f9', '45220008-0000-4000-8000-000000000020', 'ng-full@example.test',
  'NG Full', '+2348000000009', 50000000, 'NGN', 'online_card', 'paid', 'online_checkout', false,
  'mingla_j8_reference', '4522500001'),
  ('45220008-0000-4000-8000-0000000004fa', '45220008-0000-4000-8000-000000000020', 'ng-full2@example.test',
  'NG Full Two', '+2348000000010', 50000000, 'NGN', 'online_card', 'paid', 'online_checkout', false,
  'mingla_j8_reference2', '4522500002');
INSERT INTO public.refunds(id, order_id, amount_cents, currency, status, reason)
VALUES ('45220008-0000-4000-8000-0000000004fb', '45220008-0000-4000-8000-0000000004f9', 20000000, 'NGN', 'pending', 'Host refund'),
       ('45220008-0000-4000-8000-0000000004fc', '45220008-0000-4000-8000-0000000004fa', 50000000, 'NGN', 'pending', 'Admin refund');
DO $$
DECLARE v jsonb;
BEGIN
  -- Pass 8 (P8-3): set both claim forms, as the sibling suites do; on the
  -- CI image auth.uid() reads request.jwt.claim.sub.
  PERFORM set_config('request.jwt.claim.sub', '45220008-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"45220008-0000-4000-8000-000000000001","role":"authenticated"}', true);
  v := public.biz_refund_order_commit('45220008-0000-4000-8000-0000000004fb', '4522j81', 0, 'succeeded');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF (SELECT status || '/' || application_fee_refund_status FROM public.refunds WHERE id = '45220008-0000-4000-8000-0000000004fb')
       <> 'succeeded/not_applicable'
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000004f9') <> 20000000 THEN
    RAISE EXCEPTION 'J8-0 a host refund of a second-provider order settles and is recorded: %', v;
  END IF;
  v := public.admin_refund_order_commit('45220008-0000-4000-8000-0000000004fc', '4522j82', 0, 'succeeded');
  IF (SELECT status || '/' || application_fee_refund_status FROM public.refunds WHERE id = '45220008-0000-4000-8000-0000000004fc')
       <> 'succeeded/not_applicable'
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id = '45220008-0000-4000-8000-0000000004fa') <> 50000000 THEN
    RAISE EXCEPTION 'J8-1 an Admin refund of a second-provider order settles and is recorded: %', v;
  END IF;
END $$;

-- K. G-6: refund tiers count CALENDAR days in the trip's zone. Trips as the
--    builder stores them (each date at UTC midnight, #4420): departure
--    20 Mar 2027 in New York (DST starts 14 Mar), Lagos and Tokyo; 100% from
--    7 days before, 50% from 3. Each row: the cancel moment as a local wall
--    clock, the days and percent expected. FAILS ON REVERT: whole 24-hour
--    blocks to the stored instant (New York 13 Mar 23:59 gave 5 days / 50%,
--    the eve of departure gave -1 / 0%).
CREATE FUNCTION pg_temp.k_trip(p_event uuid, p_tz text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
    currency, refund_policy)
  VALUES (p_event, '45220008-0000-4000-8000-000000000011', '45220008-0000-4000-8000-000000000001',
    'Zone trip ' || p_tz, 'zone-trip-' || lower(replace(p_tz, '/', '-')), 'trip', 'scheduled', 'public', p_tz, 'USD',
    '{"kind":"custom","tiers":[{"days_before_start":7,"refund_pct":100},{"days_before_start":3,"refund_pct":50}]}');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (p_event, '2027-03-20 00:00:00+00', '2027-03-24 23:59:59+00', p_tz, true);
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, buyer_total_cents,
    list_subtotal_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, pricing_source,
    currency, payment_method, payment_status, source, installment_plan_root, stripe_payment_intent_id)
  VALUES (p_event, p_event, 'zone@example.test', 'Zone Buyer', '+12025550113', 10000, 10000,
    10000, 10000, 0, 0, 'provider_reconciled',
    'USD', 'online_card', 'paid', 'online_checkout', false, 'pi_zone_' || p_event::text);
END $$;
DO $$
DECLARE r record; v jsonb;
BEGIN
  PERFORM pg_temp.k_trip('45220008-0000-4000-8000-00000000a0a1', 'America/New_York');
  PERFORM pg_temp.k_trip('45220008-0000-4000-8000-00000000a0a2', 'Africa/Lagos');
  PERFORM pg_temp.k_trip('45220008-0000-4000-8000-00000000a0a3', 'Asia/Tokyo');
  FOR r IN SELECT * FROM (VALUES
    ('45220008-0000-4000-8000-00000000a0a1'::uuid, 'America/New_York', '2027-03-13 23:59', 7, 100),
    ('45220008-0000-4000-8000-00000000a0a1'::uuid, 'America/New_York', '2027-03-14 00:00', 6, 50),
    ('45220008-0000-4000-8000-00000000a0a1'::uuid, 'America/New_York', '2027-03-14 03:30', 6, 50),
    ('45220008-0000-4000-8000-00000000a0a1'::uuid, 'America/New_York', '2027-03-17 00:00', 3, 50),
    ('45220008-0000-4000-8000-00000000a0a1'::uuid, 'America/New_York', '2027-03-17 23:59', 3, 50),
    ('45220008-0000-4000-8000-00000000a0a1'::uuid, 'America/New_York', '2027-03-18 00:00', 2, 0),
    ('45220008-0000-4000-8000-00000000a0a1'::uuid, 'America/New_York', '2027-03-19 23:45', 1, 0),
    ('45220008-0000-4000-8000-00000000a0a1'::uuid, 'America/New_York', '2027-03-20 10:00', 0, 0),
    ('45220008-0000-4000-8000-00000000a0a2'::uuid, 'Africa/Lagos', '2027-03-13 23:59', 7, 100),
    ('45220008-0000-4000-8000-00000000a0a2'::uuid, 'Africa/Lagos', '2027-03-14 00:00', 6, 50),
    ('45220008-0000-4000-8000-00000000a0a2'::uuid, 'Africa/Lagos', '2027-03-17 00:00', 3, 50),
    ('45220008-0000-4000-8000-00000000a0a2'::uuid, 'Africa/Lagos', '2027-03-17 23:59', 3, 50),
    ('45220008-0000-4000-8000-00000000a0a2'::uuid, 'Africa/Lagos', '2027-03-18 00:00', 2, 0),
    ('45220008-0000-4000-8000-00000000a0a3'::uuid, 'Asia/Tokyo', '2027-03-13 23:59', 7, 100),
    ('45220008-0000-4000-8000-00000000a0a3'::uuid, 'Asia/Tokyo', '2027-03-14 00:00', 6, 50),
    ('45220008-0000-4000-8000-00000000a0a3'::uuid, 'Asia/Tokyo', '2027-03-17 23:59', 3, 50),
    ('45220008-0000-4000-8000-00000000a0a3'::uuid, 'Asia/Tokyo', '2027-03-18 00:00', 2, 0)
  ) k(event_id, tz, wall, days, pct) LOOP
    v := public.issue_4522_compute_refund_for_cancel_as(r.event_id, (r.wall::timestamp AT TIME ZONE r.tz), 'buyer');
    IF (v->>'days_remaining')::int <> r.days OR (v->>'tier_pct')::int <> r.pct
       OR (v->>'refund_total_cents')::bigint <> 10000 * r.pct / 100 THEN
      RAISE EXCEPTION 'K-0 % at % local: expected % days at % pct, got % at %', r.tz, r.wall, r.days, r.pct,
        v->>'days_remaining', v->>'tier_pct';
    END IF;
  END LOOP;
  -- the refund begin writes is the preview's (same moment, same rule)
  v := public.biz_cancel_trip_booking_begin('45220008-0000-4000-8000-00000000a0a1', 'buyer', NULL, NULL,
    '2027-03-13 23:59'::timestamp AT TIME ZONE 'America/New_York');
  IF (v->>'refund_total_cents')::bigint <> 10000 OR (v->>'tier_pct')::int <> 100 THEN
    RAISE EXCEPTION 'K-1 the refund equals the preview at the boundary: %', v;
  END IF;
END $$;

-- L. G-6 (S2): a trip stops taking bookings when its departure day begins in
--    its zone; client and server use the same instant. FAILS ON REVERT:
--    function absent (checkout refused from 19:59 New York on the LAST day).
DO $$
BEGIN
  IF public.issue_4522_trip_booking_closed('45220008-0000-4000-8000-00000000a0a1', '2027-03-20 03:59:59+00')
     OR NOT public.issue_4522_trip_booking_closed('45220008-0000-4000-8000-00000000a0a1', '2027-03-20 04:00:00+00')
     OR public.issue_4522_trip_booking_closed('45220008-0000-4000-8000-00000000a0a2', '2027-03-19 22:59:59+00')
     OR NOT public.issue_4522_trip_booking_closed('45220008-0000-4000-8000-00000000a0a2', '2027-03-19 23:00:00+00')
     OR public.issue_4522_trip_booking_closed('45220008-0000-4000-8000-00000000a0a3', '2027-03-19 14:59:59+00')
     OR NOT public.issue_4522_trip_booking_closed('45220008-0000-4000-8000-00000000a0a3', '2027-03-19 15:00:00+00') THEN
    RAISE EXCEPTION 'L-0 bookings close at 00:00 on the departure day in the trip''s zone';
  END IF;
END $$;

-- D-1: a provider reversal reaches a real #2097-settled card refund.
DO $$
DECLARE
  v_order uuid := '36450000-0000-4000-8000-0000000000d1';
  v_id uuid;
  v_result jsonb;
BEGIN
  PERFORM pg_temp.sale(v_order, '45220008-0000-4000-8000-000000000024', 'USD', 50000, 'pi_3645_d1', false);
  v_id := pg_temp.card_refund(v_order, 10000, 450);
  UPDATE public.orders SET cancelled_at=now() WHERE id=v_order;
  v_result := public.issue_3645_record_stripe_refund_lifecycle(
    're_' || v_id, 'pi_3645_d1', 'acct_wrong', 'usd', 10000, 'failed', now());
  IF v_result->>'status' <> 'mismatched'
     OR (SELECT status FROM public.refunds WHERE id=v_id) <> 'succeeded' THEN
    RAISE EXCEPTION 'D1: another connected account must not reverse this refund: %',v_result;
  END IF;
  v_result := public.issue_3645_record_stripe_refund_lifecycle(
    're_' || v_id, 'pi_3645_d1', 'acct_i4522', 'usd', 10000, 'failed', now());
  IF v_result->>'status' <> 'matched'
     OR v_result #>> '{buyer_correction,cancelled}' IS DISTINCT FROM 'true'
     OR (SELECT status FROM public.refunds WHERE id=v_id) <> 'failed'
     OR (SELECT buyer_refund_status FROM public.refunds WHERE id=v_id) <> 'failed'
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id=v_order) <> 0
     OR (SELECT payment_status FROM public.orders WHERE id=v_order) <> 'cancelled'
     OR public.issue_3645_unresolved_provider_refund_cents(v_order,NULL) <> 10000 THEN
    RAISE EXCEPTION 'D1: provider failure must reverse the buyer ledger and keep the cancellation: %',v_result;
  END IF;
  PERFORM public.issue_3645_record_stripe_refund_lifecycle(
    're_' || v_id, 'pi_3645_d1', 'acct_i4522', 'usd', 10000, 'failed', now());
  IF (SELECT count(*) FROM public.ticket_order_notifications
      WHERE order_id=v_order AND payload->>'template_key'='buyer_refund_failed') <> 1 THEN
    RAISE EXCEPTION 'D1: replays must produce exactly one buyer correction';
  END IF;
END;
$$;

-- A failed terminal event can arrive before an older success. A tombstone
-- for the exact charge fences the older event, and unrelated refunds can
-- still settle from pending through the normal dashboard allocator.
DO $$
DECLARE
  v_order uuid := '36450000-0000-4000-8000-0000000000d3';
  v_result jsonb;
BEGIN
  PERFORM pg_temp.sale(v_order, '45220008-0000-4000-8000-000000000024', 'USD', 50000, 'pi_3645_d3', false);
  v_result := public.issue_3645_record_stripe_refund_lifecycle(
    're_3645_pending', 'pi_3645_d3', 'acct_i4522', 'usd', 10000, 'pending', now());
  IF v_result->>'status' <> 'matched' OR NOT EXISTS (
    SELECT 1 FROM public.refunds WHERE stripe_refund_id='re_3645_pending'
      AND status='pending' AND buyer_refund_status='provider_pending'
  ) OR (SELECT refunded_amount_cents FROM public.orders WHERE id=v_order) <> 0 THEN
    RAISE EXCEPTION 'D1: dashboard refund pending must not count as paid';
  END IF;
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re_3645_pending',10000,'usd',NULL,NULL);
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id=v_order) <> 10000 THEN
    RAISE EXCEPTION 'D1: matching success should settle the pending amount';
  END IF;
  PERFORM public.issue_3645_record_stripe_refund_lifecycle(
    're_3645_failed_first', 'pi_3645_d3', 'acct_i4522', 'usd', 5000, 'failed', now());
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re_3645_failed_first',5000,'usd',NULL,NULL);
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id=v_order) <> 10000
     OR (SELECT status FROM public.refunds WHERE stripe_refund_id='re_3645_failed_first') <> 'failed' THEN
    RAISE EXCEPTION 'D1: a stale success resurrected a terminal failure';
  END IF;
END;
$$;

-- D-2: one exact reference is enough for a dashboard refund with a human
-- note. Pending holds money, processed records it, and an old replay is inert.
DO $$
DECLARE
  v_order uuid := '36450000-0000-4000-8000-0000000000d2';
  v_result jsonb;
  v_part uuid;
  v_when timestamptz := now();
BEGIN
  PERFORM pg_temp.sale(v_order, '45220008-0000-4000-8000-000000000025', 'NGN', 30000000, 'ps_3645_d2', false);
  UPDATE public.orders SET stripe_charge_id='36450001' WHERE id=v_order;
  PERFORM public.run_payout_release_dark_sweep(now());

  v_result := public.issue_3645_reconcile_paystack_dashboard_refund(
    '364501', 'ps_3645_d2', 'Refund requested by customer', 'ngn', 1000000, 'accepted', v_when);
  IF v_result->>'status' <> 'matched'
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id=v_order) <> 0
     OR (SELECT net_cents FROM public.issue_4522_payout_item_now(
       'order',v_order,30000000,0,0,1350000,28650000)) <> 0 THEN
    RAISE EXCEPTION 'D2: provider pending must hold payout without booking a refund: %', v_result;
  END IF;
  v_result := public.issue_3645_reconcile_paystack_dashboard_refund(
    '364501', 'ps_3645_d2', NULL, 'ngn', 1000000, 'processed', v_when + interval '1 minute');
  PERFORM public.issue_3645_reconcile_paystack_dashboard_refund(
    '364501', 'ps_3645_d2', NULL, 'ngn', 1000000, 'accepted', v_when);
  IF v_result->>'status' <> 'matched'
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id=v_order) <> 1000000
     OR (SELECT count(*) FROM public.refunds WHERE order_id=v_order AND status='succeeded') <> 1
     OR (SELECT status FROM public.paystack_refund_attempts WHERE provider_refund_id='364501') <> 'processed' THEN
    RAISE EXCEPTION 'D2: successful charge refund must be booked exactly once: %',v_result;
  END IF;
  v_result := public.issue_3645_reconcile_paystack_dashboard_refund(
    '364502', 'ps_3645_d2', NULL, 'usd', 1000000, 'processed', v_when);
  IF v_result->>'status' <> 'mismatched'
     OR EXISTS (SELECT 1 FROM public.paystack_refund_attempts WHERE provider_refund_id='364502') THEN
    RAISE EXCEPTION 'D2: conflicting currency must be surfaced without booking: %',v_result;
  END IF;

  INSERT INTO public.order_installments(order_id,ordinal,amount_cents,currency,due_at,status,
    provider,collection_method,buyer_total_cents,collected_at,stripe_payment_intent_id)
  VALUES(v_order,1,1500000,'NGN',now(),'collected','paystack','pay_link',1500000,now(),'ps_3645_d2_row')
  RETURNING id INTO v_part;

  PERFORM public.issue_3645_reconcile_paystack_dashboard_refund(
    '364503', 'ps_3645_d2_row', NULL, 'ngn', 200000, 'accepted', v_when);
  IF NOT public.issue_4522_row_payout_blocked(v_part) THEN
    RAISE EXCEPTION 'D2: a dashboard refund must hold an installment before it is attached';
  END IF;
  PERFORM public.issue_3645_reconcile_paystack_dashboard_refund(
    '364503', 'ps_3645_d2_row', NULL, 'ngn', 200000, 'processed', v_when + interval '1 minute');
  IF (SELECT refunded_amount_cents FROM public.order_installments WHERE id=v_part) <> 200000
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id=v_order) <> 1000000
     OR public.issue_4522_row_payout_blocked(v_part) THEN
    RAISE EXCEPTION 'D2: installment refunds are applied to their own charge and release its pending hold';
  END IF;
END;
$$;

-- H-3 / H-4: a real card release already paid two sales. A later release
-- is attached and claimed first. New/refreshed debt must be visible to its
-- final authorization even though the late release's own sale never changed.
DO $$
DECLARE
  v_first uuid := '36450000-0000-4000-8000-0000000000a1';
  v_second uuid := '36450000-0000-4000-8000-0000000000a2';
  v_new uuid := '36450000-0000-4000-8000-0000000000a3';
  v_brand uuid := '36450000-0000-4000-8000-000000000030';
  v_event uuid := '36450000-0000-4000-8000-000000000040';
  v_host uuid := '45220008-0000-4000-8000-000000000001';
  v_origin public.brand_payout_releases;
  v_later public.brand_payout_releases;
  v_claim record;
  v_alert record;
  v_debt public.organiser_payout_debts;
  v_payout integer;
BEGIN
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,payment_provider,payment_country,payout_hold_cutover_at)
  VALUES(v_brand,v_host,'Late debt Stripe','late-debt-stripe-3645','USD','stripe','US',now()-interval '30 days');
  INSERT INTO public.stripe_connect_accounts(brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency)
  VALUES(v_brand,'acct_3645_h3',true,true,'US','usd');
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency)
  VALUES(v_event,v_brand,v_host,'Late debt card payout','late-debt-card-payout-3645','trip','scheduled','public','America/New_York','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES(v_event,now()+interval '120 days',now()+interval '124 days','America/New_York',true);
  PERFORM pg_temp.sale(v_first,v_event,'USD',50000,'pi_3645_h31',false);
  PERFORM pg_temp.sale(v_second,v_event,'USD',50000,'pi_3645_h32',false);
  PERFORM public.run_payout_release_dark_sweep(now()+interval '3 days');
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_origin := pg_temp.rel(v_first);
  IF v_origin.id IS DISTINCT FROM (pg_temp.rel(v_second)).id THEN
    RAISE EXCEPTION 'H3: two sales did not attach to one release';
  END IF;
  SELECT * INTO STRICT v_claim FROM public.claim_stripe_payout_releases(100,now()+interval '3 days')
  WHERE release_id=v_origin.id;
  v_payout := v_claim.net_release_cents + v_claim.maturity_recredit_cents;
  IF NOT public.authorize_stripe_payout_execution(v_origin.id,v_claim.claim_id,v_payout,now()+interval '3 days') THEN
    RAISE EXCEPTION 'H3/H4: fixture origin did not authorize';
  END IF;
  PERFORM public.record_stripe_payout_execution(v_origin.id,v_claim.claim_id,'accepted','po_3645_h3',
    v_payout,NULL,now()+interval '3 days');

  PERFORM pg_temp.sale(v_new,v_event,'USD',100000,'pi_3645_h4',false);
  PERFORM public.run_payout_release_dark_sweep(now()+interval '4 days');
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_later := pg_temp.rel(v_new);
  SELECT * INTO STRICT v_claim FROM public.claim_stripe_payout_releases(100,now()+interval '4 days')
  WHERE release_id=v_later.id;

  PERFORM pg_temp.card_refund(v_first,10000,450);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  SELECT * INTO STRICT v_alert FROM public.claim_payout_release_alerts(100,now()+interval '4 days')
  WHERE release_id=v_origin.id AND alert_kind='payout_refund_debt';
  IF v_alert.idempotency_key NOT LIKE '%:r1' THEN RAISE EXCEPTION 'H3: first revision'; END IF;
  IF public.authorize_stripe_payout_execution(v_later.id,v_claim.claim_id,
       v_claim.net_release_cents+v_claim.maturity_recredit_cents,now()+interval '4 days') THEN
    RAISE EXCEPTION 'H4: earlier release did not reserve the first newly opened slice';
  END IF;
  SELECT * INTO STRICT v_claim FROM public.claim_stripe_payout_releases(100,now()+interval '4 days')
  WHERE release_id=v_later.id;

  PERFORM pg_temp.card_refund(v_second,10000,450);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF public.record_payout_release_alert_delivery(v_alert.alert_id,v_alert.claim_id,
       'provider_accepted',NULL,now()+interval '4 days') <> 'pending' THEN
    RAISE EXCEPTION 'H3: a prior dispatch cannot mark the increased debt alert sent: %',
      (SELECT to_jsonb(o) FROM public.payout_release_alert_outbox o WHERE id=v_alert.alert_id);
  END IF;
  SELECT * INTO STRICT v_alert FROM public.claim_payout_release_alerts(100,now()+interval '4 days')
  WHERE release_id=v_origin.id AND alert_kind='payout_refund_debt';
  IF v_alert.idempotency_key NOT LIKE '%:r2' OR v_alert.error_message NOT LIKE '%19100 USD%' THEN
    RAISE EXCEPTION 'H3: debt growth needs the new amount and key: %',v_alert;
  END IF;

  IF public.authorize_stripe_payout_execution(v_later.id,v_claim.claim_id,
       v_claim.net_release_cents+v_claim.maturity_recredit_cents,now()+interval '4 days') THEN
    RAISE EXCEPTION 'H4: old claim authorized after post-claim debt became visible';
  END IF;
  SELECT * INTO STRICT v_debt FROM public.organiser_payout_debts
  WHERE origin_release_id=v_origin.id AND kind='post_release_refund';
  IF v_debt.recovered_cents <> 19100 OR (
       SELECT count(*) FROM public.payout_debt_applications
       WHERE debt_id=v_debt.id AND release_id=v_later.id
     ) <> 2
     OR (SELECT count(*) FROM public.payout_debt_applications
         WHERE debt_id=v_debt.id AND release_id=v_later.id
           AND idempotency_key LIKE 'late-debt-apply:%') <> 2
     OR (SELECT net_release_cents FROM public.brand_payout_releases WHERE id=v_later.id)
       <> v_claim.net_release_cents-9550 THEN
    RAISE EXCEPTION 'H4: failed authorization must reserve exactly the new debt: %',v_debt;
  END IF;
END;
$$;

-- H-4 Paystack: preserve the old plan, create fresh chunk identities for a
-- wholly untouched plan, and settle the lower plan without an extra transfer.
DO $$
DECLARE
  v_brand uuid := '36450000-0000-4000-8000-000000000010';
  v_event uuid := '36450000-0000-4000-8000-000000000020';
  v_host uuid := '45220008-0000-4000-8000-000000000001';
  v_origin_sale uuid := '36450000-0000-4000-8000-000000000010'::uuid;
  v_later_sale uuid := '36450000-0000-4000-8000-000000000011';
  v_origin public.brand_payout_releases;
  v_later public.brand_payout_releases;
  v_claim record;
  v_leg public.payout_transfer_legs;
  v_due integer;
BEGIN
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,payment_provider,payment_country,payout_hold_cutover_at)
  VALUES(v_brand,v_host,'Late debt Paystack','late-debt-paystack-3645','NGN','paystack','NG',now()-interval '30 days');
  INSERT INTO public.brand_paystack_recipients(brand_id,recipient_code,bank_code,account_fingerprint,
    account_number_masked,account_name,is_active)
  VALUES(v_brand,'RCP_3645_h4','058','hmac-sha256:'||repeat('bb',32),'••••0010','Late Debt',true);
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency)
  VALUES(v_event,v_brand,v_host,'Late debt payout','late-debt-payout-3645','trip','scheduled','public','Africa/Lagos','NGN');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES(v_event,now()+interval '120 days',now()+interval '124 days','Africa/Lagos',true);

  PERFORM pg_temp.sale(v_origin_sale,v_event,'NGN',30000000,'ps_3645_h4_origin',false);
  UPDATE public.orders SET stripe_charge_id='36450410' WHERE id=v_origin_sale;
  PERFORM public.run_payout_release_dark_sweep(now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_origin := pg_temp.rel(v_origin_sale);
  PERFORM pg_temp.pay_out(v_origin.id);

  PERFORM pg_temp.sale(v_later_sale,v_event,'NGN',30000000,'ps_3645_h4_later',false);
  PERFORM public.run_payout_release_dark_sweep(now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  v_later := pg_temp.rel(v_later_sale);
  SELECT * INTO STRICT v_claim FROM public.claim_paystack_payout_releases(100,now())
  WHERE release_id=v_later.id;
  v_due := v_claim.net_release_cents + v_claim.maturity_recredit_cents;
  PERFORM public.record_paystack_leg_plan(v_later.id,v_claim.claim_id,jsonb_build_array(jsonb_build_object(
    'chunk_index',0,'principal_cents',v_due-10000,'estimated_fee_cents',5000,'stamp_duty_cents',5000)),now());

  PERFORM public.issue_3645_reconcile_paystack_dashboard_refund(
    '36450411','ps_3645_h4_origin',NULL,'ngn',1000000,'processed',now());
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF public.authorize_paystack_payout_execution(v_later.id,v_claim.claim_id,now()) THEN
    RAISE EXCEPTION 'H4: should reject Paystack plan for an amount before post-claim refund debt';
  END IF;
  IF (SELECT recovered_cents FROM public.organiser_payout_debts
      WHERE origin_release_id=v_origin.id AND kind='post_release_refund') IS DISTINCT FROM 1000000
     OR NOT EXISTS (SELECT 1 FROM public.payout_transfer_legs
       WHERE release_id=v_later.id AND chunk_index=0 AND refund_debt_superseded_at IS NOT NULL
         AND provider_reference IS NULL) THEN
    RAISE EXCEPTION 'H4: debt must be reserved once and the old untouched plan preserved';
  END IF;
  SELECT * INTO STRICT v_claim FROM public.claim_paystack_payout_releases(100,now())
  WHERE release_id=v_later.id;
  IF v_due - 1000000 <> v_claim.net_release_cents + v_claim.maturity_recredit_cents THEN
    RAISE EXCEPTION 'H4: re-claim must carry reduced value';
  END IF;
  v_due := v_due - 1000000;
  PERFORM public.record_paystack_leg_plan(v_later.id,v_claim.claim_id,jsonb_build_array(jsonb_build_object(
    'chunk_index',0,'principal_cents',v_due-10000,'estimated_fee_cents',5000,'stamp_duty_cents',5000)),now());
  IF NOT public.authorize_paystack_payout_execution(v_later.id,v_claim.claim_id,now()) THEN
    RAISE EXCEPTION 'H4: the reduced, fresh Paystack plan should be eligible';
  END IF;
  SELECT * INTO STRICT v_leg FROM public.payout_transfer_legs
  WHERE release_id=v_later.id AND kind='organiser' AND refund_debt_superseded_at IS NULL;
  IF v_leg.chunk_index <> 1 THEN RAISE EXCEPTION 'H4: never reuse a superseded chunk reference'; END IF;
  PERFORM public.record_paystack_transfer_leg_outcome(v_leg.id,v_later.id,'succeeded','TRF_3645_h4','ref-3645-h4',NULL,now());
  IF public.reconcile_paystack_transfer_leg_fee(v_leg.id,5000,5000,now()) <> 'released' THEN
    RAISE EXCEPTION 'H4: settled replacement plan wrongly waited on the superseded leg';
  END IF;
END;
$$;

ROLLBACK;
