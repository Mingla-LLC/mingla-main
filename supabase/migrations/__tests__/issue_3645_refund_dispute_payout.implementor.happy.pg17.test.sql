-- Issue #3645 — instalment refunds, disputes and payouts on both rails (PG17).
--
-- Proves:
--   1. record_paystack_refund_outcome accepts the order_installment source and
--      opens the post-release debt for a released instalment (S-3).
--   2. biz_compute_refund_for_cancel attributes each instalment at what it
--      charged net of refunds (all-in on Paystack, unchanged on Stripe) (S-2).
--   3. biz_cancel_trip_booking_begin keys instalment refund attempts to the
--      instalment (deposit stays on the order).
--   4. A Paystack dispute on an instalment reference is stored against the
--      instalment (single subject) and returns the parent order.
--   5. Payout sweep, switch ON: the instalment candidate uses the row's provider,
--      gross = charged, minus refunds and open disputes on both rails; a fully
--      refunded instalment has no candidate. Switch OFF (shipped): nothing.

BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_ng uuid := gen_random_uuid();
  v_us uuid := gen_random_uuid();
  v_eng uuid := gen_random_uuid();
  v_eus uuid := gen_random_uuid();
  v_p uuid := gen_random_uuid();
  v_s uuid := gen_random_uuid();
  v_p1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid();
  v_p3 uuid := gen_random_uuid();
  v_s1 uuid := gen_random_uuid();
  v_rel uuid := gen_random_uuid();
  v_now timestamptz := timestamptz '2026-12-10 12:00:00+00';
  v_collected timestamptz := timestamptz '2026-12-08 12:00:00+00';
  r jsonb;
  v_rows record;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3645-rdp@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region, pricing_currency,
    default_currency, payout_hold_cutover_at)
  VALUES (v_ng, v_owner, 'RDP ng', 'issue-3645-rdp-ng', 'paystack', 'NG', 'NGN', 'NGN', timestamptz '2020-01-01'),
         (v_us, v_owner, 'RDP us', 'issue-3645-rdp-us', 'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, currency) VALUES
    (v_eng, v_ng, 'RDP trip ng', 'issue-3645-rdp-ng-trip', 'trip', 'live', 'NGN'),
    (v_eus, v_us, 'RDP trip us', 'issue-3645-rdp-us-trip', 'trip', 'live', 'USD');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_eng, v_now + interval '40 days', v_now + interval '45 days', 'UTC', true),
    (v_eus, v_now + interval '40 days', v_now + interval '45 days', 'UTC', true);
  UPDATE public.events SET refund_policy = jsonb_build_object('kind', 'custom',
    'tiers', jsonb_build_array(jsonb_build_object('days_before_start', 30, 'refund_pct', 50)))
   WHERE id IN (v_eng, v_eus);
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, installment_plan_root)
  VALUES (v_p, v_eng, 250000, 'NGN', 'paid', 'mingla_3645_rdp', '3645201', 'legacy', true),
         (v_s, v_eus, 2500, 'USD', 'paid', 'pi_3645_rdp', 'ch_3645_rdp', 'legacy', true);
  INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at, status,
    stripe_payment_intent_id, stripe_charge_id, collected_at, provider, collection_method, buyer_total_cents,
    plan_bound_at, application_fee_amount_cents, provider_fee_cents, payout_accounting_state, refunded_amount_cents)
  VALUES
    (v_p1, v_p, 1, 500000, 'NGN', v_collected, 'collected', 'mingla-inst-' || v_p1 || '-a1', NULL, v_collected,
      'paystack', 'auto_card', 541250, now(), 22500, 8000, 'ready', 41250),
    (v_p2, v_p, 2, 250000, 'NGN', v_collected, 'collected', 'mingla-inst-' || v_p2 || '-l1', NULL, v_collected,
      'paystack', 'pay_link', 270625, now(), 11250, 4000, 'ready', 270625),
    (v_p3, v_p, 3, 250000, 'NGN', v_now + interval '20 days', 'scheduled', NULL, NULL, NULL,
      'paystack', 'pay_link', 270625, now(), NULL, 0, 'pending', 0),
    (v_s1, v_s, 1, 7500, 'USD', v_collected, 'collected', 'pi_3645_rdp_i1', 'ch_3645_rdp_i1', v_collected,
      'stripe', 'auto_card', NULL, now(), 338, 0, 'ready', 500);
  UPDATE public.order_installments SET status = 'refunded' WHERE id = v_p2;

  -- 2. Trip-cancel compute at 50%: Paystack instalment 1 = 541250 − 41250 = 500000 → 250000.
  r := public.biz_compute_refund_for_cancel(v_p, v_now);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'rdp_2_compute_%', r; END IF;
  SELECT (e->>'paid_cents')::bigint AS paid, (e->>'refund_cents')::bigint AS refund INTO v_rows
    FROM jsonb_array_elements(r->'per_payment_refund') e WHERE e->>'installment_id' = v_p1::text;
  IF v_rows.paid <> 500000 OR v_rows.refund <> 250000 THEN RAISE EXCEPTION 'rdp_2_paystack_attr_%', r; END IF;
  IF (r->>'paid_total_cents')::bigint <> 250000 + 500000 THEN RAISE EXCEPTION 'rdp_2_paid_total_%', r; END IF;
  -- Stripe: buyer_total NULL → amount_cents − refunded = 7000.
  r := public.biz_compute_refund_for_cancel(v_s, v_now);
  SELECT (e->>'paid_cents')::bigint AS paid INTO v_rows
    FROM jsonb_array_elements(r->'per_payment_refund') e WHERE e->>'installment_id' = v_s1::text;
  IF v_rows.paid <> 7000 THEN RAISE EXCEPTION 'rdp_2_stripe_attr_%', r; END IF;

  -- 3. Trip cancel begin (Paystack): the pending refund satisfies fee-truth and
  -- instalment attempts are keyed to the instalment.
  r := public.biz_cancel_trip_booking_begin(v_p, 'operator', v_owner, 'Host cancelled this booking', v_now);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'rdp_3_begin_%', r; END IF;
  IF EXISTS (
    SELECT 1 FROM public.refunds
     WHERE id = (r->>'refund_id')::uuid
       AND (application_fee_refund_status <> 'unknown_legacy'
         OR application_fee_refunded_cents IS NOT NULL)
  ) THEN RAISE EXCEPTION 'rdp_3_pending_fee_truth'; END IF;
  SELECT count(*) INTO v_count FROM public.paystack_refund_attempts
   WHERE local_refund_id = (r->>'refund_id')::uuid
     AND ((source_type = 'order_installment' AND source_id = v_p1 AND transaction_reference = 'mingla-inst-' || v_p1 || '-a1')
       OR (source_type = 'order' AND source_id = v_p AND transaction_reference = 'mingla_3645_rdp'));
  IF v_count <> 2 THEN RAISE EXCEPTION 'rdp_3_attempt_keys_%', v_count; END IF;

  -- 4. Dispute on an instalment reference.
  r := public.record_paystack_dispute_outcome('dsp_3645_rdp', 'mingla-inst-' || v_p1 || '-a1',
    'charge.dispute.create', 'awaiting-merchant-feedback', NULL, 200000, 'NGN', 'fraud', NULL, '{}'::jsonb, v_now);
  IF r->>'order_installment_id' <> v_p1::text OR r->>'order_id' <> v_p::text OR (r->>'matched')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'rdp_4_dispute_%', r;
  END IF;
  SELECT count(*) INTO v_count FROM public.paystack_disputes
   WHERE paystack_dispute_id = 'dsp_3645_rdp' AND order_installment_id = v_p1 AND order_id IS NULL
     AND brand_id = v_ng AND amount_cents = 200000;
  IF v_count <> 1 THEN RAISE EXCEPTION 'rdp_4_dispute_row'; END IF;
  -- Replay updates, never duplicates.
  PERFORM public.record_paystack_dispute_outcome('dsp_3645_rdp', 'mingla-inst-' || v_p1 || '-a1',
    'charge.dispute.remind', 'awaiting-merchant-feedback', NULL, 200000, 'NGN', 'fraud', NULL, '{}'::jsonb, v_now);
  IF (SELECT count(*) FROM public.paystack_disputes WHERE paystack_dispute_id = 'dsp_3645_rdp') <> 1 THEN
    RAISE EXCEPTION 'rdp_4_dispute_duplicated';
  END IF;

  -- 5. Sweep: shipped switch OFF → no instalment candidates.
  PERFORM public.run_payout_release_dark_sweep(v_now);
  IF EXISTS (SELECT 1 FROM public.payout_release_items WHERE source_type = 'order_installment') THEN
    RAISE EXCEPTION 'rdp_5_switch_off_attached';
  END IF;
  CREATE OR REPLACE FUNCTION public.issue_2036_installment_payout_ready()
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $ready$ SELECT true; $ready$;
  -- A Stripe dispute on the Stripe instalment charge.
  INSERT INTO public.stripe_disputes(stripe_dispute_id, stripe_account_id, stripe_charge_id, amount, currency, status, reason, raw_event)
  VALUES ('dp_3645_rdp', 'acct_3645_rdp', 'ch_3645_rdp_i1', 1000, 'usd', 'needs_response', 'fraudulent', '{}'::jsonb);
  PERFORM public.run_payout_release_dark_sweep(v_now);
  -- Paystack instalment 1: provider paystack, gross 541250, refunded 41250, disputed 200000.
  SELECT i.gross_cents, i.refunded_cents, i.disputed_cents, rel.provider INTO v_rows
    FROM public.payout_release_items i JOIN public.brand_payout_releases rel ON rel.id = i.release_id
   WHERE i.source_type = 'order_installment' AND i.source_id = v_p1;
  IF v_rows.provider <> 'paystack' OR v_rows.gross_cents <> 541250 OR v_rows.refunded_cents <> 41250
     OR v_rows.disputed_cents <> 200000 THEN
    RAISE EXCEPTION 'rdp_5_paystack_item_% % % %', v_rows.provider, v_rows.gross_cents, v_rows.refunded_cents, v_rows.disputed_cents;
  END IF;
  -- Fully refunded instalment 2: no candidate.
  IF EXISTS (SELECT 1 FROM public.payout_release_items WHERE source_type = 'order_installment' AND source_id = v_p2) THEN
    RAISE EXCEPTION 'rdp_5_fully_refunded_attached';
  END IF;
  -- Stripe instalment: provider stripe, gross 7500, refunded 500, disputed 1000.
  SELECT i.gross_cents, i.refunded_cents, i.disputed_cents, rel.provider INTO v_rows
    FROM public.payout_release_items i JOIN public.brand_payout_releases rel ON rel.id = i.release_id
   WHERE i.source_type = 'order_installment' AND i.source_id = v_s1;
  IF v_rows.provider <> 'stripe' OR v_rows.gross_cents <> 7500 OR v_rows.refunded_cents <> 500
     OR v_rows.disputed_cents <> 1000 THEN
    RAISE EXCEPTION 'rdp_5_stripe_item_% % % %', v_rows.provider, v_rows.gross_cents, v_rows.refunded_cents, v_rows.disputed_cents;
  END IF;
  -- 1. Refund outcome on the released instalment payout opens the debt (S-3).
  SELECT i.release_id INTO v_rel FROM public.payout_release_items i
   WHERE i.source_type = 'order_installment' AND i.source_id = v_p1;
  UPDATE public.brand_payout_releases SET status = 'released', released_at = v_now,
    organiser_cash_delivered_cents = net_release_cents WHERE id = v_rel;
  r := public.record_paystack_refund_outcome('order_installment', v_p1, NULL,
    'mingla-inst-' || v_p1 || '-a1', 'mingla_trip_refund:x:' || v_p1, 'rfnd_3645_rdp', 100000, 'processed', NULL, v_now);
  IF (r->>'debt_created')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'rdp_1_debt_%', r; END IF;
END
$test$;

ROLLBACK;
