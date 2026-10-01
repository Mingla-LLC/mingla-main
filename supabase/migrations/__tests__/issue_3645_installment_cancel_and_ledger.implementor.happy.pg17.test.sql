-- Issue #3645 PR5 — installment cancel stop + payout ledger readiness gate (PG17).
--
-- Proves:
--   1. cancel_event_refund_prepare flips scheduled installments to cancelled and
--      returns installments_cancelled.
--   2. With issue_2036_installment_payout_ready() = false (default), a collected
--      ready installment does NOT attach into payout_release_items.
--   3. Temporarily flipping the readiness gate to true inside the transaction
--      lets the dark sweep attach source_type = order_installment.

BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-0000000000e1';
  v_brand   constant uuid := '36450000-0000-4000-8000-0000000000e2';
  v_event   constant uuid := '36450000-0000-4000-8000-0000000000e3';
  v_event_b constant uuid := '36450000-0000-4000-8000-0000000000eb';
  v_order   constant uuid := '36450000-0000-4000-8000-0000000000e4';
  v_order_b constant uuid := '36450000-0000-4000-8000-0000000000ec';
  v_inst    constant uuid := '36450000-0000-4000-8000-0000000000e5';
  v_inst_b  constant uuid := '36450000-0000-4000-8000-0000000000ed';
  v_date    constant uuid := '36450000-0000-4000-8000-0000000000e6';
  v_date_b  constant uuid := '36450000-0000-4000-8000-0000000000ee';
  v_now     timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_collected timestamptz := timestamptz '2026-09-28 12:00:00+00';
  v_prep    jsonb;
  v_status  text;
  v_state   text;
  v_count   integer;
  v_ready   boolean;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-3645-pr5@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 PR5 Brand', 'issue-3645-pr5-inst',
    'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
  );

  -- Event A: cancelled — proves installment cancel on prepare.
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'PR5 Cancel Event', 'issue-3645-pr5-cancel', 'cancelled', 'USD');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (
    v_date, v_event,
    v_now + interval '7 days', v_now + interval '8 days', 'UTC', true
  );
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, event_date_id
  ) VALUES (
    v_order, v_event, 2500, 'USD', 'paid',
    'pi_3645_pr5_dep', 'ch_3645_pr5_dep', 'legacy', v_date
  );
  INSERT INTO public.order_installments(
    id, order_id, ordinal, amount_cents, currency, due_at, status
  ) VALUES (
    v_inst, v_order, 1, 7500, 'USD', v_now - interval '1 day', 'scheduled'
  );

  v_prep := public.cancel_event_refund_prepare(v_event, v_now);
  IF coalesce((v_prep->>'installments_cancelled')::integer, -1) <> 1 THEN
    RAISE EXCEPTION 'pr5_cancel_expected_1_installment_got_%', v_prep;
  END IF;
  SELECT status, cancelled_at IS NOT NULL
    INTO v_status, v_ready
  FROM public.order_installments WHERE id = v_inst;
  IF v_status <> 'cancelled' OR v_ready IS NOT TRUE THEN
    RAISE EXCEPTION 'pr5_installment_not_cancelled_status_%_cancelled_at_%', v_status, v_ready;
  END IF;

  -- Event B: live — collected ready installment for ledger proofs.
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event_b, v_brand, 'PR5 Ledger Event', 'issue-3645-pr5-ledger', 'live', 'USD');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (
    v_date_b, v_event_b,
    v_now + interval '14 days', v_now + interval '15 days', 'UTC', true
  );
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, event_date_id
  ) VALUES (
    v_order_b, v_event_b, 2500, 'USD', 'paid',
    'pi_3645_pr5_dep_b', 'ch_3645_pr5_dep_b', 'legacy', v_date_b
  );
  INSERT INTO public.order_installments(
    id, order_id, ordinal, amount_cents, currency, due_at, status,
    stripe_payment_intent_id, stripe_charge_id, collected_at,
    application_fee_amount_cents, provider_fee_cents, payout_accounting_state
  ) VALUES (
    v_inst_b, v_order_b, 1, 7500, 'USD', v_collected - interval '1 day', 'collected',
    'pi_3645_pr5_inst', 'ch_3645_pr5_inst', v_collected,
    113, 0, 'ready'
  );

  -- Readiness defaults false: ready row must NOT attach.
  IF public.issue_2036_installment_payout_ready() IS NOT FALSE THEN
    RAISE EXCEPTION 'pr5_readiness_must_default_false';
  END IF;

  PERFORM public.run_payout_release_dark_sweep(v_now);
  SELECT count(*) INTO v_count
  FROM public.payout_release_items
  WHERE source_type = 'order_installment' AND source_id = v_inst_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'pr5_ready_false_must_not_attach_got_%', v_count;
  END IF;
  SELECT payout_accounting_state INTO v_state
  FROM public.order_installments WHERE id = v_inst_b;
  IF v_state <> 'ready' THEN
    RAISE EXCEPTION 'pr5_accounting_state_should_stay_ready_got_%', v_state;
  END IF;

  -- Flip readiness inside this transaction only, then sweep attaches.
  CREATE OR REPLACE FUNCTION public.issue_2036_installment_payout_ready()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $ready$ SELECT true; $ready$;

  IF public.issue_2036_installment_payout_ready() IS NOT TRUE THEN
    RAISE EXCEPTION 'pr5_readiness_flip_failed';
  END IF;

  PERFORM public.run_payout_release_dark_sweep(v_now);
  SELECT count(*) INTO v_count
  FROM public.payout_release_items
  WHERE source_type = 'order_installment' AND source_id = v_inst_b;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'pr5_ready_true_must_attach_got_%', v_count;
  END IF;
  SELECT payout_accounting_state INTO v_state
  FROM public.order_installments WHERE id = v_inst_b;
  IF v_state <> 'attached' THEN
    RAISE EXCEPTION 'pr5_accounting_state_expected_attached_got_%', v_state;
  END IF;

  RAISE NOTICE 'issue_3645_installment_cancel_and_ledger_pass';
END;
$test$;

ROLLBACK;
