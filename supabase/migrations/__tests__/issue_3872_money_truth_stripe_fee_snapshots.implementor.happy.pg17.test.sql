-- Issue #3872 PR 1 (money truth) — Stripe fee snapshots captured before #3872
-- included Mingla's application fee; the one-time correction removes it (PG17).
--
-- MINGLA-INVARIANT: I-3872-LEGACY-STRIPE-FEE-SNAPSHOTS-CORRECTED | issue #3872 | A Stripe fee snapshot captured before #3872 has its source's application fee removed exactly once, Paystack snapshots are untouched, and the corrected release net equals the provider balance net.
--
-- Fixture: production order 6d25e937's shape and the sandbox balance
-- transaction (fee 166 = Stripe 121 + application fee 45, net 2969).
-- Fails before #3872's §9: the correction does not exist and the release
-- deducts the application fee twice
-- (with gross 3135: 3135 - 45 - 166 = 2924 versus 3135 - 45 - 121 = 2969).

BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '38720000-0000-4000-8000-0000000d0001';
  v_brand constant uuid := '38720000-0000-4000-8000-0000000d0002';
  v_event constant uuid := '38720000-0000-4000-8000-0000000d0003';
  v_date  constant uuid := '38720000-0000-4000-8000-0000000d0004';
  v_order constant uuid := '38720000-0000-4000-8000-0000000d0005';
  v_ng    constant uuid := '38720000-0000-4000-8000-0000000d0006';
  v_now   constant timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_r jsonb;
  v_net integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3872-fee@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region, pricing_currency,
    default_currency, payout_hold_cutover_at)
  VALUES (v_brand, v_owner, 'Issue 3872 fee', 'issue-3872-fee', 'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Issue 3872 fee', 'issue-3872-fee-ev', 'live', 'USD');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (v_date, v_event, v_now - interval '5 days', v_now - interval '4 days', 'UTC', true);
  INSERT INTO public.orders(id, event_id, event_date_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, stripe_application_fee_amount_cents, created_at,
    list_subtotal_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source)
  VALUES
    (v_order, v_event, v_date, 3000, 'USD', 'paid', 'pi_3872_fee', 'ch_3872_fee', 'legacy', 45, v_now - interval '6 days',
     3000, 3000, 135, 0, 3135, 'provider_reconciled'),
    (v_ng, v_event, v_date, 10000, 'USD', 'paid', 'mingla_3872_fee', '3872000', 'legacy', 150, v_now - interval '6 days',
     10000, 10000, 0, 0, 10000, 'provider_reconciled');
  -- What the pre-#3872 capture stored: the whole balance transaction fee.
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents, provider_balance_transaction_id)
  VALUES ('order', v_order, 166, 'txn_3872_legacy'), ('order', v_ng, 150, '6467822302');

  v_r := public.issue_3872_correct_stripe_fee_snapshots();
  -- The snapshot itself is append-only and stays as captured; the correction is
  -- its own append-only row.
  IF (SELECT provider_fee_cents FROM public.payout_source_fee_snapshots WHERE source_id = v_order) <> 166
     OR (SELECT c.application_fee_cents FROM public.issue_3872_fee_snapshot_corrections c
           JOIN public.payout_source_fee_snapshots fs ON fs.id = c.snapshot_id WHERE fs.source_id = v_order) <> 45 THEN
    RAISE EXCEPTION 'legacy Stripe snapshot must get a 45 correction row and stay 166, got %', v_r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_3872_fee_snapshot_corrections c
               JOIN public.payout_source_fee_snapshots fs ON fs.id = c.snapshot_id WHERE fs.source_id = v_ng) THEN
    RAISE EXCEPTION 'a Paystack snapshot must not be corrected';
  END IF;
  -- Idempotent.
  v_r := public.issue_3872_correct_stripe_fee_snapshots();
  IF (v_r->>'corrected')::int <> 0 THEN
    RAISE EXCEPTION 'a second correction must add nothing, got %', v_r;
  END IF;
  BEGIN
    UPDATE public.issue_3872_fee_snapshot_corrections SET application_fee_cents = 0;
    RAISE EXCEPTION 'corrections must be append-only';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'payout_ledger_append_only' THEN RAISE; END IF;
  END;

  PERFORM public.run_payout_release_dark_sweep(v_now);
  SELECT net_cents INTO v_net FROM public.payout_release_items WHERE source_id = v_order;
  IF v_net <> 2969 THEN
    RAISE EXCEPTION 'release net must equal the balance transaction net 2969, got %', v_net;
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_3872_correct_stripe_fee_snapshots()', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants: the correction is service_role only';
  END IF;
  RAISE NOTICE 'issue_3872 stripe fee snapshots pass';
END
$test$;

ROLLBACK;
