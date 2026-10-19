-- Issue #3872 PR 1 (money truth, F5) — proportional partner reversal, the real
-- database functions (PG17).
--
-- MINGLA-INVARIANT: I-3872-PROPORTIONAL-PARTNER-REVERSAL | issue #3872 | a refund
-- gives back floor(original share x fee refunded / fee); untransferred splits
-- are reduced in place; recording a reversal is idempotent and bounded.
--
-- Fails before 20271107003872_issue_3872_money_truth.sql: the plan/record
-- functions and partner_splits.reversed_cents do not exist; the only tool was
-- mark_partner_split_reversed, which closes the whole split on any refund.

BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '38720000-0000-4000-8000-0000000a0001';
  v_partner constant uuid := '38720000-0000-4000-8000-0000000a0002';
  v_brand   constant uuid := '38720000-0000-4000-8000-0000000a0010';
  v_event   constant uuid := '38720000-0000-4000-8000-0000000a0020';
  v_o1 constant uuid := '38720000-0000-4000-8000-0000000a0031';
  v_o2 constant uuid := '38720000-0000-4000-8000-0000000a0032';
  v_o3 constant uuid := '38720000-0000-4000-8000-0000000a0033';
  v_plan jsonb;
  v_split public.partner_splits%ROWTYPE;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_partner);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'owner-3872-pr@example.test'), (v_partner, 'partner-3872-pr@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency)
  VALUES (v_brand, v_owner, 'Issue 3872 partner', 'issue-3872-partner', 'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Issue 3872 partner', 'issue-3872-partner-ev', 'live', 'USD');
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, stripe_application_fee_amount_cents)
  VALUES
    (v_o1, v_event, 1000000, 'USD', 'paid', 'pi_3872_pr_1', 'ch_3872_pr_1', 'legacy', 15000),
    (v_o2, v_event, 1000000, 'USD', 'paid', 'pi_3872_pr_2', 'ch_3872_pr_2', 'legacy', 15000),
    (v_o3, v_event, 1000000, 'USD', 'paid', 'pi_3872_pr_3', 'ch_3872_pr_3', 'legacy', 15000);
  INSERT INTO public.partner_splits(order_id, brand_id, partner_account_id, mingla_fee_cents,
    partner_share_cents, transfer_currency, stripe_application_fee_id, stripe_transfer_id, status, provider)
  VALUES
    (v_o1, v_brand, v_partner, 15000, 1500, 'usd', 'fee_3872_tr', 'tr_3872_tr', 'transferred', 'stripe'),
    (v_o2, v_brand, v_partner, 15000, 1500, 'usd', 'fee_3872_held', NULL, 'held', 'stripe'),
    (v_o3, v_brand, v_partner, 15000, 1500, 'usd', 'fee_3872_keep', 'tr_3872_keep', 'transferred', 'stripe');

  -- Transferred: first refund returns 10% of the fee -> reverse 150.
  v_plan := public.issue_3872_partner_split_refund_plan('fee_3872_tr', 15000, 1500);
  IF v_plan->>'outcome' <> 'reverse' OR (v_plan->>'reverse_cents')::int <> 150
     OR (v_plan->>'target_reversed_cents')::int <> 150 THEN
    RAISE EXCEPTION 'transferred: first refund must reverse 150, got %', v_plan;
  END IF;
  PERFORM public.issue_3872_partner_split_record_reversal('fee_3872_tr', 150, 'trr_1');
  -- Replay of the same refund: nothing more.
  v_plan := public.issue_3872_partner_split_refund_plan('fee_3872_tr', 15000, 1500);
  IF v_plan->>'outcome' <> 'nothing_to_reverse' THEN
    RAISE EXCEPTION 'transferred: replay must not reverse again, got %', v_plan;
  END IF;
  -- Recording the same target twice is idempotent.
  PERFORM public.issue_3872_partner_split_record_reversal('fee_3872_tr', 150, 'trr_1');
  SELECT * INTO v_split FROM public.partner_splits WHERE stripe_application_fee_id = 'fee_3872_tr';
  IF v_split.reversed_cents <> 150 OR v_split.status <> 'transferred' THEN
    RAISE EXCEPTION 'transferred: after 10%% expected reversed 150 and still transferred, got % %',
      v_split.reversed_cents, v_split.status;
  END IF;
  -- Second refund returns the rest of the fee -> reverse the remaining 1350.
  v_plan := public.issue_3872_partner_split_refund_plan('fee_3872_tr', 15000, 15000);
  IF (v_plan->>'reverse_cents')::int <> 1350 THEN
    RAISE EXCEPTION 'transferred: second refund must reverse the remaining 1350, got %', v_plan;
  END IF;
  PERFORM public.issue_3872_partner_split_record_reversal('fee_3872_tr', 1500, 'trr_2');
  SELECT * INTO v_split FROM public.partner_splits WHERE stripe_application_fee_id = 'fee_3872_tr';
  IF v_split.reversed_cents <> 1500 OR v_split.status <> 'reversed' OR v_split.partner_share_cents <> 1500 THEN
    RAISE EXCEPTION 'transferred: fully reversed expected, got reversed % status % share %',
      v_split.reversed_cents, v_split.status, v_split.partner_share_cents;
  END IF;

  -- Held: reduced in place, no transfer instruction.
  v_plan := public.issue_3872_partner_split_refund_plan('fee_3872_held', 15000, 1500);
  SELECT * INTO v_split FROM public.partner_splits WHERE stripe_application_fee_id = 'fee_3872_held';
  IF v_plan->>'outcome' <> 'reduced_in_place' OR v_split.partner_share_cents <> 1350
     OR v_split.original_partner_share_cents <> 1500 OR v_split.status <> 'held' THEN
    RAISE EXCEPTION 'held: expected share 1350 held in place, got % / % %', v_plan,
      v_split.partner_share_cents, v_split.status;
  END IF;
  v_plan := public.issue_3872_partner_split_refund_plan('fee_3872_held', 15000, 15000);
  SELECT * INTO v_split FROM public.partner_splits WHERE stripe_application_fee_id = 'fee_3872_held';
  IF v_split.partner_share_cents <> 0 OR v_split.status <> 'cancelled_refund' THEN
    RAISE EXCEPTION 'held: full refund must cancel the split, got % %', v_split.partner_share_cents, v_split.status;
  END IF;

  -- A refund that returns none of the fee leaves the share alone.
  v_plan := public.issue_3872_partner_split_refund_plan('fee_3872_keep', 15000, 0);
  IF v_plan->>'outcome' <> 'nothing_to_reverse' THEN
    RAISE EXCEPTION 'keep: no fee refunded must reverse nothing, got %', v_plan;
  END IF;

  -- Bounds: a reversal target above the original share is refused.
  BEGIN
    PERFORM public.issue_3872_partner_split_record_reversal('fee_3872_keep', 1501, 'trr_x');
    RAISE EXCEPTION 'bounds: a target above the share must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF has_function_privilege('authenticated', 'public.issue_3872_partner_split_refund_plan(text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3872_partner_split_record_reversal(text,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants: partner reversal functions are service_role only';
  END IF;
  RAISE NOTICE 'issue_3872 partner reversal pass';
END
$test$;

ROLLBACK;
