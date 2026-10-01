-- Issue #3645 PR4 — Paystack dispute ingest + merchant-accepted debt (PG17).
BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-0000000000e1';
  v_brand   constant uuid := '36450000-0000-4000-8000-0000000000e2';
  v_event   constant uuid := '36450000-0000-4000-8000-0000000000e3';
  v_order   constant uuid := '36450000-0000-4000-8000-0000000000e4';
  v_rel     constant uuid := '36450000-0000-4000-8000-0000000000e5';
  v_now     timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_out     jsonb;
  v_due     timestamptz;
  v_debt_id uuid;
  v_principal integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-3645-dispute@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Dispute Brand', 'issue-3645-dispute',
    'paystack', 'NG', 'NGN', 'NGN'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Dispute Event', 'issue-3645-dispute-ev', 'live', 'NGN');
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, source
  ) VALUES (
    v_order, v_event, 5000, 'NGN', 'paid', 'psk_3645_dispute_ref', 'legacy'
  );
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, organiser_cash_delivered_cents, status, released_at
  ) VALUES (
    v_rel, v_brand, v_event, 'pr4-dispute-rel', 'order', 'paystack', 'ngn',
    v_now - interval '2 days', v_now - interval '1 day', 5000, 0,
    5000, 5000, 'released', v_now - interval '1 day'
  );
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    net_cents, source_finalized_at
  ) VALUES (
    v_rel, 'order', v_order, 5000, 0, 5000, v_now - interval '2 days'
  );

  -- create: record + 16h due default, no debt yet.
  v_out := public.record_paystack_dispute_outcome(
    'dsp_3645_1', 'psk_3645_dispute_ref', 'charge.dispute.create',
    'pending', NULL, 5000, 'ngn', 'chargeback', NULL,
    '{"id":"dsp_3645_1"}'::jsonb, v_now
  );
  IF coalesce((v_out->>'matched')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'pr4_create_expected_match_got_%', v_out;
  END IF;
  IF coalesce((v_out->>'debt_created')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'pr4_create_must_not_open_debt_got_%', v_out;
  END IF;
  v_due := (v_out->>'response_due_by')::timestamptz;
  IF v_due IS DISTINCT FROM v_now + interval '16 hours' THEN
    RAISE EXCEPTION 'pr4_due_expected_now_plus_16h_got_%', v_due;
  END IF;

  -- resolve declined on a separate dispute: no debt.
  v_out := public.record_paystack_dispute_outcome(
    'dsp_3645_declined', 'psk_3645_dispute_ref', 'charge.dispute.resolve',
    'resolved', 'declined', 5000, 'ngn', 'chargeback', NULL,
    '{"id":"dsp_3645_declined","resolution":"declined"}'::jsonb, v_now + interval '1 hour'
  );
  IF coalesce((v_out->>'debt_created')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'pr4_declined_must_not_open_debt_got_%', v_out;
  END IF;

  -- resolve merchant-accepted (includes 16h auto-accept): open debt.
  v_out := public.record_paystack_dispute_outcome(
    'dsp_3645_1', 'psk_3645_dispute_ref', 'charge.dispute.resolve',
    'resolved', 'merchant-accepted', 5000, 'ngn', 'chargeback', NULL,
    '{"id":"dsp_3645_1","resolution":"merchant-accepted"}'::jsonb,
    v_now + interval '2 hours'
  );
  IF coalesce((v_out->>'debt_created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'pr4_accepted_expected_debt_got_%', v_out;
  END IF;
  v_debt_id := (v_out->>'debt_id')::uuid;
  SELECT principal_cents INTO v_principal
  FROM public.organiser_payout_debts WHERE id = v_debt_id;
  IF v_principal <> 5000 THEN
    RAISE EXCEPTION 'pr4_debt_principal_expected_5000_got_%', v_principal;
  END IF;

  -- Idempotent re-drive does not double the debt.
  v_out := public.record_paystack_dispute_outcome(
    'dsp_3645_1', 'psk_3645_dispute_ref', 'charge.dispute.resolve',
    'resolved', 'merchant-accepted', 5000, 'ngn', 'chargeback', NULL,
    '{"id":"dsp_3645_1","resolution":"merchant-accepted"}'::jsonb,
    v_now + interval '3 hours'
  );
  IF coalesce((v_out->>'debt_created')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'pr4_replay_must_not_reopen_debt_got_%', v_out;
  END IF;

  RAISE NOTICE 'issue_3645_paystack_disputes_pass';
END;
$test$;

ROLLBACK;
