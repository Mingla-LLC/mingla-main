-- Issue #3645 — append-only and final-authorization dispute guards.
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '3645ad00-0000-4000-8000-000000000011';
  v_brand constant uuid := '3645ad00-0000-4000-8000-000000000012';
  v_event constant uuid := '3645ad00-0000-4000-8000-000000000013';
  v_order constant uuid := '3645ad00-0000-4000-8000-000000000014';
  v_release constant uuid := '3645ad00-0000-4000-8000-000000000015';
  v_claim constant uuid := '3645ad00-0000-4000-8000-000000000016';
  v_now constant timestamptz := timestamptz '2026-10-22 18:00:00+00';
  v_status text;
  v_error text;
  v_saved_claim uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-append-only-adversarial@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Guard', 'issue-3645-append-only-guard',
    'paystack', 'NG', 'NGN', 'NGN'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (
    v_event, v_brand, 'Guard Event', 'issue-3645-guard-event', 'live', 'NGN'
  );
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, source
  ) VALUES (
    v_order, v_event, 6000, 'NGN', 'paid',
    'psk_3645_append_only_guard', 'legacy'
  );
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, status, paystack_execution_claim_id,
    paystack_execution_claimed_at
  ) VALUES (
    v_release, v_brand, v_event, 'append-only-guard', 'order', 'paystack', 'ngn',
    v_now - interval '26 hours', v_now - interval '2 hours', 6000, 270, 5730,
    'in_flight', v_claim, v_now
  );
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    net_cents, source_finalized_at
  ) VALUES (
    v_release, 'order', v_order, 6000, 270, 5730, v_now - interval '26 hours'
  );

  BEGIN
    UPDATE public.payout_release_items SET disputed_cents = 100 WHERE release_id = v_release;
    RAISE EXCEPTION 'adversarial_item_update_should_fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%payout_ledger_append_only%' THEN
      RAISE EXCEPTION 'adversarial_wrong_append_only_error_%', SQLERRM;
    END IF;
  END;

  PERFORM public.record_paystack_dispute_outcome(
    'dsp_3645_append_only_guard', 'psk_3645_append_only_guard',
    'charge.dispute.create', 'pending', NULL, 1000, 'ngn', 'chargeback', NULL,
    '{"id":"dsp_3645_append_only_guard"}'::jsonb, v_now
  );
  SELECT status, error_message, paystack_execution_claim_id
  INTO v_status, v_error, v_saved_claim
  FROM public.brand_payout_releases WHERE id = v_release;
  IF v_status <> 'pending' OR v_error <> 'paystack_dispute_open'
     OR v_saved_claim IS NOT NULL THEN
    RAISE EXCEPTION 'adversarial_inflight_claim_not_revoked_%_%_%',
      v_status, v_error, v_saved_claim;
  END IF;

  UPDATE public.brand_payout_releases
  SET status = 'in_flight', paystack_execution_claim_id = v_claim,
      paystack_execution_claimed_at = v_now
  WHERE id = v_release;
  IF public.authorize_paystack_payout_execution(v_release, v_claim, v_now) IS NOT FALSE THEN
    RAISE EXCEPTION 'adversarial_unresolved_dispute_was_authorized';
  END IF;
  SELECT status, error_message, paystack_execution_claim_id
  INTO v_status, v_error, v_saved_claim
  FROM public.brand_payout_releases WHERE id = v_release;
  IF v_status <> 'pending' OR v_error <> 'paystack_dispute_open'
     OR v_saved_claim IS NOT NULL THEN
    RAISE EXCEPTION 'adversarial_authorize_did_not_fail_closed_%_%_%',
      v_status, v_error, v_saved_claim;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payout_transfer_legs
    WHERE release_id = v_release AND provider_reference IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'adversarial_provider_reference_written';
  END IF;

  RAISE NOTICE 'issue_3645_paystack_dispute_append_only_adversarial_pass';
END;
$test$;

ROLLBACK;
