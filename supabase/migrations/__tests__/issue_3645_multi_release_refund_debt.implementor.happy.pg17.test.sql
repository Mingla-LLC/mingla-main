-- Issue #3645 PR3 — refund liability spills across multiple released payouts (PG17).
-- Origin release delivered 4000; a sibling released row for the same event delivered
-- another 4000. A 6000 refund against the origin source must open a 6000 debt (not
-- clamp to 4000), and apply_open_payout_debts recovers the remainder from a later
-- pending release.

BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-0000000000d1';
  v_brand   constant uuid := '36450000-0000-4000-8000-0000000000d2';
  v_event   constant uuid := '36450000-0000-4000-8000-0000000000d3';
  v_order   constant uuid := '36450000-0000-4000-8000-0000000000d4';
  v_rel_a   constant uuid := '36450000-0000-4000-8000-0000000000d5';
  v_rel_b   constant uuid := '36450000-0000-4000-8000-0000000000d6';
  v_rel_c   constant uuid := '36450000-0000-4000-8000-0000000000d7';
  v_now     timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_out     jsonb;
  v_debt_id uuid;
  v_principal integer;
  v_recovered integer;
  v_status text;
  v_applied integer;
  v_cap integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3645-pr3@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 PR3 Brand', 'issue-3645-pr3-multi',
    'paystack', 'NG', 'NGN', 'NGN'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Multi Release Event', 'issue-3645-pr3-ev', 'published', 'NGN');
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source
  ) VALUES (
    v_order, v_event, 6000, 'NGN', 'paid', NULL, NULL, 'legacy'
  );

  -- Two released payouts for the same event (payment+24h shape).
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, organiser_cash_delivered_cents, status, released_at
  ) VALUES
    (
      v_rel_a, v_brand, v_event, 'pr3-rel-a', 'order', 'paystack', 'ngn',
      v_now - interval '3 days', v_now - interval '2 days', 4000, 0,
      4000, 4000, 'released', v_now - interval '2 days'
    ),
    (
      v_rel_b, v_brand, v_event, 'pr3-rel-b', 'order', 'paystack', 'ngn',
      v_now - interval '2 days', v_now - interval '1 day', 4000, 0,
      4000, 4000, 'released', v_now - interval '1 day'
    );

  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    net_cents, source_finalized_at
  ) VALUES (
    v_rel_a, 'order', v_order, 4000, 0, 4000, v_now - interval '3 days'
  );

  v_cap := public.organiser_released_cash_cap_cents(v_brand, 'ngn', v_event);
  IF v_cap <> 8000 THEN
    RAISE EXCEPTION 'pr3_cap_expected_8000_got_%', v_cap;
  END IF;

  -- Refund asks for 6000 against the origin release that only delivered 4000.
  v_out := public.record_paystack_refund_outcome(
    'order', v_order, NULL,
    'pr3-tx-ref', 'mingla_order_refund:' || v_order::text,
    'pr3-provider-refund', 6000, 'processed', NULL, v_now
  );
  IF coalesce((v_out->>'debt_created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'pr3_expected_debt_created_got_%', v_out;
  END IF;
  v_debt_id := (v_out->>'debt_id')::uuid;

  SELECT principal_cents, recovered_cents, status
    INTO v_principal, v_recovered, v_status
  FROM public.organiser_payout_debts WHERE id = v_debt_id;
  IF v_principal <> 6000 THEN
    RAISE EXCEPTION 'pr3_debt_principal_expected_6000_got_%', v_principal;
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'pr3_debt_status_expected_open_got_%', v_status;
  END IF;

  -- Later pending release recovers part of the spill.
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, status
  ) VALUES (
    v_rel_c, v_brand, v_event, 'pr3-rel-c', 'order', 'paystack', 'ngn',
    v_now + interval '1 day', v_now + interval '1 day', 3000, 0,
    3000, 'pending'
  );

  v_applied := public.apply_open_payout_debts(v_rel_c, v_now);
  IF v_applied <> 3000 THEN
    RAISE EXCEPTION 'pr3_apply_expected_3000_got_%', v_applied;
  END IF;

  SELECT principal_cents, recovered_cents, status
    INTO v_principal, v_recovered, v_status
  FROM public.organiser_payout_debts WHERE id = v_debt_id;
  IF v_recovered <> 3000 THEN
    RAISE EXCEPTION 'pr3_recovered_expected_3000_got_%', v_recovered;
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'pr3_debt_should_remain_open_after_partial_got_%', v_status;
  END IF;

  RAISE NOTICE 'issue_3645_multi_release_refund_debt_pass';
END;
$test$;

ROLLBACK;
