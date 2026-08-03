-- Issue #1179 (initiative #1013 sub-issue J) — cancellation refund fan-out
-- PostgreSQL 17 contract proof. Run after all migrations against a disposable
-- database. Every write rolls back; any missing invariant raises and makes psql
-- ON_ERROR_STOP fail.
--
-- IMPLEMENTOR HAPPY-PATH REGRESSION (fails-on-revert angle: forward happy-path +
-- atomic Stripe-only debt conversion). Asserts, for a cancelled event:
--   * every pending/blocked release for the event → 'cancelled_event' (SC-1)
--   * the Stripe released occurrence's temporary post_release_postponement debt is
--     converted to a permanent post_release_cancellation debt of EQUAL principal,
--     BEFORE any refund, and the temp debt is reduced to zero / 'converted' (SC-3);
--     Σ open permanent debt ≤ organiser_cash_delivered_cents (SC-4,
--     I-PROPOSED-1179-NO-DOUBLE-WITHHOLD)
--   * the PAYSTACK released occurrence's temp debt is NOT converted by J (F owns it —
--     no double withhold) (SC-4 / I-PROPOSED-1179-NO-DOUBLE-WITHHOLD)
--   * every paid, not-fully-refunded order → one 'pending' progress row; run opens
--     'in_progress'; UNIQUE(source_type,source_id) makes re-prepare a no-op (SC-5)
--   * claim leases the batch ('refunding', attempt_count 1); mark 'refunded' drives
--     the run to 'completed'
--   * prepare on a NON-cancelled event raises event_not_cancelled and writes NOTHING
--     (SC-8, I-PROPOSED-1179-CANCEL-REFUNDS-ONLY-ON-CANCELLED)
--
-- Reverting §4.2 step 2 (release-stop) OR step 3 (Stripe debt conversion) of
-- 20270110000009 FAILS this test; restoring PASSES.
BEGIN;

DO $test$
DECLARE
  v_owner        constant uuid := '11790000-0000-4000-8000-000000000001';
  v_brand        constant uuid := '11790000-0000-4000-8000-000000000010';
  v_event        constant uuid := '11790000-0000-4000-8000-000000000020';
  v_live_event   constant uuid := '11790000-0000-4000-8000-000000000021';
  v_order_a      constant uuid := '11790000-0000-4000-8000-000000000030';
  v_order_b      constant uuid := '11790000-0000-4000-8000-000000000031';
  v_ttype_a      constant uuid := '11790000-0000-4000-8000-000000000040';
  v_ttype_b      constant uuid := '11790000-0000-4000-8000-000000000041';
  v_line_a       constant uuid := '11790000-0000-4000-8000-000000000050';
  v_line_b       constant uuid := '11790000-0000-4000-8000-000000000051';
  v_rel_pending  constant uuid := '11790000-0000-4000-8000-000000000060';
  v_rel_stripe   constant uuid := '11790000-0000-4000-8000-000000000061';
  v_rel_paystack constant uuid := '11790000-0000-4000-8000-000000000062';
  v_rel_live     constant uuid := '11790000-0000-4000-8000-000000000063';
  v_prep         jsonb;
  v_prep2        jsonb;
  v_status       text;
  v_count        integer;
  v_perm_open    integer;
  v_claimed      integer;
  v_pid          uuid;
  v_raised       boolean := false;
BEGIN
  ------------------------------------------------------------------------------
  -- Seed: brand (STRIPE), a cancelled event + a live event, two paid orders.
  ------------------------------------------------------------------------------
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-1179@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 1179 Brand', 'issue-1179-brand',
    'stripe', 'US', 'USD', 'USD'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES
    (v_event,      v_brand, 'Cancelled Event', 'issue-1179-cancelled', 'cancelled', 'USD'),
    (v_live_event, v_brand, 'Live Event',      'issue-1179-live',      'ended',     'USD');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents)
  VALUES
    (v_ttype_a, v_event, 'GA A', 6000),
    (v_ttype_b, v_event, 'GA B', 4000);
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source
  ) VALUES
    (v_order_a, v_event, 6000,  'USD', 'paid',           'pi_1179_a', 'ch_1179_a', 'legacy'),
    (v_order_b, v_event, 4000,  'USD', 'paid',           'pi_1179_b', 'ch_1179_b', 'legacy');
  INSERT INTO public.order_line_items(
    id, order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  ) VALUES
    (v_line_a, v_order_a, v_ttype_a, 1, 6000, 6000),
    (v_line_b, v_order_b, v_ttype_b, 1, 4000, 4000);

  ------------------------------------------------------------------------------
  -- Seed releases (CHECK: releasable_at = anchor_end_at + 3 days):
  --   * a PENDING release for the cancelled event  → must become cancelled_event
  --   * a RELEASED STRIPE release + open temp debt  → must convert (J owns it)
  --   * a RELEASED PAYSTACK release + open temp debt → must NOT convert (F owns it)
  --   * a PENDING release for the LIVE event        → must stay pending
  ------------------------------------------------------------------------------
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, net_release_cents,
    organiser_cash_delivered_cents, status, released_at
  ) VALUES
    (v_rel_pending, v_brand, v_event, 'pending-occ', 'order', 'stripe', 'usd',
     now() + interval '2 days', now() + interval '5 days', 10000, 10000, 0,
     'pending', NULL),
    (v_rel_stripe, v_brand, v_event, 'stripe-released-occ', 'order', 'stripe', 'usd',
     now() - interval '4 days', now() - interval '1 day', 8000, 8000, 8000,
     'released', now() - interval '1 day'),
    (v_rel_paystack, v_brand, v_event, 'paystack-released-occ', 'order', 'paystack', 'usd',
     now() - interval '4 days', now() - interval '1 day', 7000, 7000, 7000,
     'released', now() - interval '1 day'),
    (v_rel_live, v_brand, v_live_event, 'live-occ', 'order', 'stripe', 'usd',
     now() + interval '2 days', now() + interval '5 days', 5000, 5000, 0,
     'pending', NULL);

  -- Open a temporary post_release_postponement debt on each released occurrence.
  PERFORM public.open_post_release_postponement_debt(v_rel_stripe,   now() + interval '10 days');
  PERFORM public.open_post_release_postponement_debt(v_rel_paystack, now() + interval '10 days');

  ------------------------------------------------------------------------------
  -- ACT: prepare the fan-out for the cancelled event.
  ------------------------------------------------------------------------------
  v_prep := public.cancel_event_refund_prepare(v_event);

  IF (v_prep->>'total_objects')::int <> 2 THEN
    RAISE EXCEPTION 'prepare_total_objects_expected_2_got_%', v_prep->>'total_objects';
  END IF;
  IF v_prep->>'run_status' <> 'in_progress' THEN
    RAISE EXCEPTION 'prepare_run_status_expected_in_progress_got_%', v_prep->>'run_status';
  END IF;

  -- SC-1: the pending release for the cancelled event is stopped.
  SELECT status INTO v_status FROM public.brand_payout_releases WHERE id = v_rel_pending;
  IF v_status <> 'cancelled_event' THEN
    RAISE EXCEPTION 'SC1_pending_release_not_cancelled_event_got_%', v_status;
  END IF;

  -- SC-1: the pending release for the LIVE event is untouched.
  SELECT status INTO v_status FROM public.brand_payout_releases WHERE id = v_rel_live;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'SC1_live_event_release_wrongly_touched_got_%', v_status;
  END IF;

  -- SC-3: Stripe temp debt converted to post_release_cancellation of equal principal.
  SELECT status INTO v_status FROM public.organiser_payout_debts
   WHERE origin_release_id = v_rel_stripe AND kind = 'post_release_postponement';
  IF v_status <> 'converted' THEN
    RAISE EXCEPTION 'SC3_stripe_temp_debt_not_converted_got_%', v_status;
  END IF;
  SELECT count(*) INTO v_count FROM public.organiser_payout_debts
   WHERE origin_release_id = v_rel_stripe
     AND kind = 'post_release_cancellation' AND principal_cents = 8000;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SC3_stripe_permanent_cancellation_debt_missing_count_%', v_count;
  END IF;

  -- SC-4: Σ open permanent debt against the Stripe release ≤ organiser_cash_delivered_cents.
  SELECT COALESCE(sum(principal_cents - recovered_cents), 0) INTO v_perm_open
    FROM public.organiser_payout_debts
   WHERE origin_release_id = v_rel_stripe
     AND kind IN ('post_release_cancellation','post_release_refund','post_release_dispute')
     AND status = 'open';
  IF v_perm_open > 8000 THEN
    RAISE EXCEPTION 'SC4_double_withhold_open_permanent_%_exceeds_cash_8000', v_perm_open;
  END IF;

  -- SC-4 / no double withhold: J did NOT convert the PAYSTACK release (F owns it).
  SELECT status INTO v_status FROM public.organiser_payout_debts
   WHERE origin_release_id = v_rel_paystack AND kind = 'post_release_postponement';
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'SC4_paystack_temp_debt_wrongly_touched_got_%', v_status;
  END IF;
  SELECT count(*) INTO v_count FROM public.organiser_payout_debts
   WHERE origin_release_id = v_rel_paystack AND kind = 'post_release_cancellation';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SC4_paystack_wrongly_converted_by_J_count_%', v_count;
  END IF;

  -- SC-2 (prep): one pending progress row per paid order, provider resolved.
  SELECT count(*) INTO v_count FROM public.event_cancel_refund_progress
   WHERE event_id = v_event AND status = 'pending' AND source_type = 'order'
     AND provider = 'stripe';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'SC2_progress_rows_expected_2_got_%', v_count;
  END IF;

  ------------------------------------------------------------------------------
  -- SC-5: re-prepare is a no-op (UNIQUE(source_type,source_id) guard).
  ------------------------------------------------------------------------------
  v_prep2 := public.cancel_event_refund_prepare(v_event);
  SELECT count(*) INTO v_count FROM public.event_cancel_refund_progress WHERE event_id = v_event;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'SC5_reprepare_grew_progress_rows_to_%', v_count;
  END IF;
  -- Stripe temp debt still converted once (no second cancellation debt).
  SELECT count(*) INTO v_count FROM public.organiser_payout_debts
   WHERE origin_release_id = v_rel_stripe AND kind = 'post_release_cancellation';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SC5_reprepare_created_second_cancellation_debt_count_%', v_count;
  END IF;

  ------------------------------------------------------------------------------
  -- claim → lease the batch; mark refunded → run completes.
  ------------------------------------------------------------------------------
  SELECT count(*) INTO v_claimed FROM public.cancel_event_refund_claim(v_event, 25);
  IF v_claimed <> 2 THEN
    RAISE EXCEPTION 'claim_expected_2_got_%', v_claimed;
  END IF;
  SELECT count(*) INTO v_count FROM public.event_cancel_refund_progress
   WHERE event_id = v_event AND status = 'refunding' AND attempt_count = 1;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'claim_did_not_lease_both_got_%', v_count;
  END IF;

  -- A second immediate claim leases nothing (fresh lease excludes re-claim).
  SELECT count(*) INTO v_claimed FROM public.cancel_event_refund_claim(v_event, 25);
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'second_immediate_claim_released_%', v_claimed;
  END IF;

  FOR v_pid IN SELECT id FROM public.event_cancel_refund_progress WHERE event_id = v_event LOOP
    PERFORM public.cancel_event_refund_mark(v_pid, 'refunded', NULL, NULL);
  END LOOP;

  SELECT status INTO v_status FROM public.event_cancel_refund_runs WHERE event_id = v_event;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'run_not_completed_after_all_refunded_got_%', v_status;
  END IF;
  SELECT refunded_objects INTO v_count FROM public.event_cancel_refund_runs WHERE event_id = v_event;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'run_refunded_objects_expected_2_got_%', v_count;
  END IF;

  ------------------------------------------------------------------------------
  -- SC-8: prepare on a NON-cancelled (live) event raises + writes NOTHING.
  ------------------------------------------------------------------------------
  BEGIN
    PERFORM public.cancel_event_refund_prepare(v_live_event);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%event_not_cancelled%' THEN
      v_raised := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SC8_prepare_on_live_event_did_not_raise';
  END IF;
  SELECT count(*) INTO v_count FROM public.event_cancel_refund_runs WHERE event_id = v_live_event;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SC8_live_event_run_row_created_%', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.event_cancel_refund_progress WHERE event_id = v_live_event;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SC8_live_event_progress_rows_created_%', v_count;
  END IF;
  -- and the live event's pending release is still pending (no releases stopped).
  SELECT status INTO v_status FROM public.brand_payout_releases WHERE id = v_rel_live;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'SC8_live_event_release_stopped_got_%', v_status;
  END IF;

  RAISE NOTICE 'issue_1179_pg17_pass release-stop + Stripe-only atomic debt conversion + no double withhold + progress idempotency + claim/mark lifecycle + status-first';
END;
$test$;

ROLLBACK;
