-- MINGLA-INVARIANT: I-4522-10 | issue #4522 | A non-refundable deposit frozen in v2 terms is kept only on a traveler's own cancel; an operator or host cancel refunds it, and collected flexible payments refund and pay out like planned ones.
\set ON_ERROR_STOP on

-- Issue #4522 slice 8 (M4, 20281125064522): refunds and payouts for v2
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

ROLLBACK;
