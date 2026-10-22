-- Issue #3645 — pending Paystack disputes project without rewriting ledger items.
-- MINGLA-INVARIANT: I-3645-PAYSTACK-DISPUTE-APPEND-ONLY | issue #3645 | A Paystack dispute may change the executable release projection, but it never updates or deletes payout_release_items; unresolved disputes fail closed again at final transfer authorization.
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '3645ad00-0000-4000-8000-000000000001';
  v_brand constant uuid := '3645ad00-0000-4000-8000-000000000002';
  v_event constant uuid := '3645ad00-0000-4000-8000-000000000003';
  v_order constant uuid := '3645ad00-0000-4000-8000-000000000004';
  v_release constant uuid := '3645ad00-0000-4000-8000-000000000005';
  v_now constant timestamptz := timestamptz '2026-10-22 16:00:00+00';
  v_item record;
  v_projection record;
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-append-only-happy@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Append Only', 'issue-3645-append-only',
    'paystack', 'NG', 'NGN', 'NGN'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (
    v_event, v_brand, 'Append Only Event', 'issue-3645-append-only-event',
    'live', 'NGN'
  );
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, source
  ) VALUES (
    v_order, v_event, 10000, 'NGN', 'paid',
    'psk_3645_append_only_happy', 'legacy'
  );
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents, status
  ) VALUES (
    v_release, v_brand, v_event, 'append-only-happy', 'order', 'paystack', 'ngn',
    v_now - interval '26 hours', v_now - interval '2 hours',
    10000, 450, 45, 300, 9550, 'pending'
  );
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_cents, source_finalized_at
  ) VALUES (
    v_release, 'order', v_order, 10000, 450, 45, 300, 9550,
    v_now - interval '26 hours'
  );

  v_result := public.record_paystack_dispute_outcome(
    'dsp_3645_append_only_happy', 'psk_3645_append_only_happy',
    'charge.dispute.create', 'pending', NULL, 2000, 'ngn', 'chargeback', NULL,
    '{"id":"dsp_3645_append_only_happy"}'::jsonb, v_now
  );
  IF coalesce((v_result->>'matched')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'happy_dispute_not_matched_%', v_result;
  END IF;

  SELECT * INTO v_item FROM public.payout_release_items
  WHERE release_id = v_release AND source_id = v_order;
  SELECT * INTO v_projection FROM public.brand_payout_releases WHERE id = v_release;
  IF v_item.disputed_cents <> 0 OR v_item.net_cents <> 9550 THEN
    RAISE EXCEPTION 'happy_item_mutated_disputed_%_net_%',
      v_item.disputed_cents, v_item.net_cents;
  END IF;
  IF v_projection.disputed_cents <> 2000
     OR v_projection.net_release_cents <> 7550
     OR v_projection.error_message <> 'paystack_dispute_open' THEN
    RAISE EXCEPTION 'happy_open_projection_wrong_%', row_to_json(v_projection);
  END IF;

  PERFORM public.record_paystack_dispute_outcome(
    'dsp_3645_append_only_happy', 'psk_3645_append_only_happy',
    'charge.dispute.resolve', 'resolved', 'declined', 2000, 'ngn',
    'chargeback', NULL,
    '{"id":"dsp_3645_append_only_happy","resolution":"declined"}'::jsonb,
    v_now + interval '1 hour'
  );
  SELECT * INTO v_projection FROM public.brand_payout_releases WHERE id = v_release;
  IF v_projection.disputed_cents <> 0
     OR v_projection.net_release_cents <> 9550
     OR v_projection.error_message IS NOT NULL THEN
    RAISE EXCEPTION 'happy_won_projection_wrong_%', row_to_json(v_projection);
  END IF;

  PERFORM public.record_paystack_dispute_outcome(
    'dsp_3645_append_only_lost', 'psk_3645_append_only_happy',
    'charge.dispute.resolve', 'resolved', 'merchant-accepted', 1500, 'ngn',
    'chargeback', NULL,
    '{"id":"dsp_3645_append_only_lost","resolution":"merchant-accepted"}'::jsonb,
    v_now + interval '2 hours'
  );
  SELECT * INTO v_projection FROM public.brand_payout_releases WHERE id = v_release;
  IF v_projection.disputed_cents <> 1500 OR v_projection.net_release_cents <> 8050 THEN
    RAISE EXCEPTION 'happy_lost_projection_wrong_%', row_to_json(v_projection);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organiser_payout_debts WHERE origin_release_id = v_release
  ) THEN
    RAISE EXCEPTION 'happy_pending_liability_must_not_open_debt';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.paystack_disputes
    WHERE paystack_dispute_id = 'dsp_3645_append_only_lost'
      AND debt_opened IS TRUE
  ) THEN
    RAISE EXCEPTION 'happy_pending_liability_not_marked_accounted';
  END IF;

  RAISE NOTICE 'issue_3645_paystack_dispute_append_only_happy_pass';
END;
$test$;

ROLLBACK;
