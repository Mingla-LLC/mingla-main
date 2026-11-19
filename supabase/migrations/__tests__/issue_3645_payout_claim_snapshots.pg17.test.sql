\set ON_ERROR_STOP on

-- Issue #3645 bundle 2e-1 — claim-time payout snapshots.
-- Migration 20281119003645_issue_3645_payout_claim_snapshots.sql.
-- Runs after the full chain on PostgreSQL 17, through the real claim, execute,
-- webhook-failure, leg-plan, authorize and reconcile functions. Rolls back.
--
-- MINGLA-INVARIANT: I-3645-PAYOUT-CLAIM-SNAPSHOT | issue #3645 | Every Stripe or Paystack claim of a payout release records one append-only snapshot of the release as claimed (money columns, effective withheld, projected totals, due = net + recredit); a released payout links the snapshot of the claim that paid it (Stripe: the recorded claim; Paystack: the claim whose due the organiser legs were planned from) or nothing, never another claim's; recording it never blocks or changes a payout.

BEGIN;

DO $test$
DECLARE
  v_owner    constant uuid := '36452e10-0000-4000-8000-000000000001';
  v_stranger constant uuid := '36452e10-0000-4000-8000-000000000002';
  v_fm       constant uuid := '36452e10-0000-4000-8000-000000000003';
  v_mm       constant uuid := '36452e10-0000-4000-8000-000000000004';
  v_brand_st constant uuid := '36452e10-0000-4000-8000-000000000011';
  v_brand_ps constant uuid := '36452e10-0000-4000-8000-000000000012';
  v_old      constant uuid := '36452e10-0000-4000-8000-000000000020';
  v_st_a     constant uuid := '36452e10-0000-4000-8000-000000000021';
  v_st_b     constant uuid := '36452e10-0000-4000-8000-000000000022';
  v_st_c     constant uuid := '36452e10-0000-4000-8000-000000000023';
  v_st_x     constant uuid := '36452e10-0000-4000-8000-000000000024';
  v_ps_a     constant uuid := '36452e10-0000-4000-8000-000000000031';
  v_ps_b     constant uuid := '36452e10-0000-4000-8000-000000000032';
  v_ps_c     constant uuid := '36452e10-0000-4000-8000-000000000033';
  v_ps_d     constant uuid := '36452e10-0000-4000-8000-000000000034';
  v_debt     constant uuid := '36452e10-0000-4000-8000-000000000040';
  v_now      constant timestamptz := '2027-09-01 12:00:00+00';
  v_snap     public.payout_release_claim_snapshots;
  v_rel      public.brand_payout_releases;
  v_claim    uuid;
  v_first    uuid;
  v_leg      uuid;
  v_count    integer;
  v_seen     integer;
  v_err      text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_stranger), (v_fm), (v_mm);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-2e1@example.test');

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency, payout_hold_cutover_at
  ) VALUES
    (v_brand_st, v_owner, '2e1 Stripe Brand', '3645-2e1-stripe', 'USD',
     'stripe', 'US', 'US', 'USD', v_now - interval '60 days'),
    (v_brand_ps, v_owner, '2e1 Paystack Brand', '3645-2e1-paystack', 'NGN',
     'paystack', 'NG', 'NG', 'NGN', v_now - interval '60 days');
  INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at) VALUES
    (v_brand_st, v_fm, 'finance_manager', v_now), (v_brand_st, v_mm, 'marketing_manager', v_now);
  INSERT INTO public.stripe_connect_accounts (
    brand_id, stripe_account_id, charges_enabled, payouts_enabled, country, default_currency
  ) VALUES (v_brand_st, 'acct_3645_2e1', true, true, 'US', 'usd');
  INSERT INTO public.brand_paystack_recipients (
    brand_id, recipient_code, bank_code, account_fingerprint,
    account_number_masked, account_name, is_active
  ) VALUES (
    v_brand_ps, 'RCP_3645_2e1', '058', 'hmac-sha256:' || repeat('e', 64),
    '••••2010', '2e1 Account', true
  );

  -- Stripe: A (recredit + debt), B (fails after paid, re-paid), C (paying
  -- snapshot refused), X (live inputs fail), OLD (debt origin, not yet due).
  -- Paystack: A (plan and pay), B (net drops while a leg is out), C (net rises,
  -- plan reused), D (nothing planned).
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, net_release_cents, status
  ) VALUES
    (v_old,  v_brand_st, '2e1-old',  'order', 'stripe', 'usd', v_now + interval '29 days', v_now + interval '30 days', 100, 0, 100, 'pending'),
    (v_st_a, v_brand_st, '2e1-st-a', 'order', 'stripe', 'usd', v_now - interval '2 days', v_now - interval '1 day', 12000, 2000, 10000, 'pending'),
    (v_ps_a, v_brand_ps, '2e1-ps-a', 'order', 'paystack', 'ngn', v_now - interval '2 days', v_now - interval '1 day', 10000, 1000, 9000, 'pending');

  INSERT INTO public.payout_ledger_adjustments (release_id, brand_id, currency, kind, amount_cents, idempotency_key)
  VALUES (v_st_a, v_brand_st, 'usd', 'maturity_recredit', 700, '2e1-recredit-a');
  INSERT INTO public.organiser_payout_debts (id, brand_id, currency, origin_release_id, kind, principal_cents, idempotency_key)
  VALUES (v_debt, v_brand_st, 'usd', v_old, 'post_release_refund', 1500, '2e1-debt');
  INSERT INTO public.payout_debt_applications (debt_id, release_id, amount_cents, idempotency_key)
  VALUES (v_debt, v_st_a, 1500, '2e1-debt-app');

  -- ── S1 a Stripe claim records one exact snapshot (recredit, withheld) ─────
  PERFORM public.claim_stripe_payout_releases(20, v_now);
  SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = v_st_a;
  SELECT * INTO v_snap FROM public.payout_release_claim_snapshots WHERE release_id = v_st_a;
  IF v_snap.id IS NULL OR v_snap.provider <> 'stripe'
     OR v_snap.claim_id IS DISTINCT FROM v_rel.stripe_execution_claim_id
     OR v_snap.maturity_recredit_cents IS DISTINCT FROM 700
     OR v_rel.maturity_recredit_cents IS DISTINCT FROM 700
     OR v_snap.net_release_cents IS DISTINCT FROM v_rel.net_release_cents
     OR v_snap.gross_cents <> 12000 OR v_snap.mingla_fee_cents <> 2000
     OR v_snap.due_cents <> v_rel.net_release_cents::bigint + 700
     OR v_snap.effective_withheld_cents IS DISTINCT FROM 1500
     OR (v_snap.projected->>'withheld_cents')::bigint IS DISTINCT FROM 1500
     OR v_snap.plan_reused IS NOT NULL THEN
    RAISE EXCEPTION 'S1 FAIL: snapshot does not match the claim: % / release %', to_jsonb(v_snap), to_jsonb(v_rel);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S1 PASS: a Stripe claim records recredit 700, withheld 1500 and due = net + recredit';

  -- ── S2 Stripe paid through record_stripe_payout_execution links its claim ─
  PERFORM public.record_stripe_payout_execution(v_st_a, v_rel.stripe_execution_claim_id, 'accepted', 'po_2e1_a', v_snap.due_cents::integer, NULL, v_now);
  SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = v_st_a;
  IF v_rel.status <> 'released' OR v_rel.paid_snapshot_id IS DISTINCT FROM v_snap.id
     OR v_rel.organiser_cash_delivered_cents::bigint IS DISTINCT FROM v_snap.due_cents THEN
    RAISE EXCEPTION 'S2 FAIL: paid Stripe release does not link what was sent: %', to_jsonb(v_rel);
  END IF;
  -- The payout.paid webhook writes 'released' again: the link stays.
  UPDATE public.brand_payout_releases SET status = 'released' WHERE id = v_st_a;
  UPDATE public.brand_payout_releases SET attempt_count = attempt_count + 1 WHERE id = v_st_a;
  IF (SELECT paid_snapshot_id FROM public.brand_payout_releases WHERE id = v_st_a) IS DISTINCT FROM v_snap.id
     OR (SELECT count(*) FROM public.payout_release_claim_snapshots WHERE release_id = v_st_a) <> 1 THEN
    RAISE EXCEPTION 'S2 FAIL: a later update moved the link or recorded a snapshot';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S2 PASS: a Stripe payout links its claim; due = cash delivered';

  -- ── S3 Stripe payout.failed, re-claimed at a new net, re-paid ─────────────
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, net_release_cents, status
  ) VALUES (v_st_b, v_brand_st, '2e1-st-b', 'order', 'stripe', 'usd',
            v_now - interval '2 days', v_now - interval '1 day', 12000, 2000, 10000, 'pending');
  PERFORM public.claim_stripe_payout_releases(20, v_now);
  SELECT id INTO v_first FROM public.payout_release_claim_snapshots WHERE release_id = v_st_b;
  PERFORM public.record_stripe_payout_execution(v_st_b,
    (SELECT stripe_execution_claim_id FROM public.brand_payout_releases WHERE id = v_st_b),
    'accepted', 'po_2e1_b1', 10000, NULL, v_now);
  IF (SELECT paid_snapshot_id FROM public.brand_payout_releases WHERE id = v_st_b) IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'S3 FAIL: first payment does not link its claim';
  END IF;
  PERFORM public.record_stripe_payout_webhook_failure('po_2e1_b1', true, 'no_account:x', v_now);
  SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = v_st_b;
  IF v_rel.status = 'released' OR v_rel.paid_snapshot_id IS NOT NULL THEN
    RAISE EXCEPTION 'S3 FAIL: a failed payout kept its paid link: %', to_jsonb(v_rel);
  END IF;
  UPDATE public.brand_payout_releases SET net_release_cents = 9000 WHERE id = v_st_b;
  PERFORM public.claim_stripe_payout_releases(20, v_now + interval '1 minute');
  SELECT * INTO v_snap FROM public.payout_release_claim_snapshots
   WHERE release_id = v_st_b ORDER BY seq DESC LIMIT 1;
  PERFORM public.record_stripe_payout_execution(v_st_b,
    (SELECT stripe_execution_claim_id FROM public.brand_payout_releases WHERE id = v_st_b),
    'accepted', 'po_2e1_b2', 9000, NULL, v_now);
  SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = v_st_b;
  IF v_snap.id = v_first OR v_snap.due_cents <> 9000
     OR v_rel.status <> 'released' OR v_rel.paid_snapshot_id IS DISTINCT FROM v_snap.id
     OR v_rel.organiser_cash_delivered_cents <> 9000 THEN
    RAISE EXCEPTION 'S3 FAIL: re-paid release links % (want %): %', v_rel.paid_snapshot_id, v_snap.id, to_jsonb(v_rel);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S3 PASS: a failed Stripe payout drops its link; the re-payment links its own claim';

  -- ── S4 the paying claim's snapshot was refused: no link, never an older one ─
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, net_release_cents, status
  ) VALUES (v_st_c, v_brand_st, '2e1-st-c', 'order', 'stripe', 'usd',
            v_now - interval '2 days', v_now - interval '1 day', 12000, 2000, 10000, 'pending');
  PERFORM public.claim_stripe_payout_releases(20, v_now);
  PERFORM public.record_stripe_payout_execution(v_st_c,
    (SELECT stripe_execution_claim_id FROM public.brand_payout_releases WHERE id = v_st_c),
    'retryable_error', NULL, 10000, 'timeout', v_now);
  IF (SELECT count(*) FROM public.payout_release_claim_snapshots WHERE release_id = v_st_c) <> 1
     OR (SELECT paid_snapshot_id FROM public.brand_payout_releases WHERE id = v_st_c) IS NOT NULL THEN
    RAISE EXCEPTION 'S4 FAIL: a put-back recorded a snapshot or a link';
  END IF;
  UPDATE public.brand_payout_releases SET net_release_cents = 7000 WHERE id = v_st_c;
  ALTER TABLE public.payout_release_claim_snapshots
    ADD CONSTRAINT t2e1_refuse CHECK (due_cents < 0) NOT VALID;
  PERFORM public.claim_stripe_payout_releases(20, v_now);
  ALTER TABLE public.payout_release_claim_snapshots DROP CONSTRAINT t2e1_refuse;
  PERFORM public.record_stripe_payout_execution(v_st_c,
    (SELECT stripe_execution_claim_id FROM public.brand_payout_releases WHERE id = v_st_c),
    'accepted', 'po_2e1_c', 7000, NULL, v_now);
  SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = v_st_c;
  IF v_rel.status <> 'released' OR v_rel.organiser_cash_delivered_cents <> 7000 OR v_rel.paid_snapshot_id IS NOT NULL THEN
    RAISE EXCEPTION 'S4 FAIL: want released, 7000 sent, no link: %', to_jsonb(v_rel);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S4 PASS: a refused snapshot never blocks the payout and never links an older claim';

  -- ── S5 the live inputs fail: still recorded from the release's own columns ─
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, net_release_cents, status
  ) VALUES (v_st_x, v_brand_st, '2e1-st-x', 'order', 'stripe', 'usd',
            v_now - interval '2 days', v_now - interval '1 day', 6000, 1000, 5000, 'pending');
  ALTER FUNCTION public.issue_3645_release_projected_totals(uuid) RENAME TO t2e1_projected_gone;
  PERFORM public.claim_stripe_payout_releases(20, v_now);
  ALTER FUNCTION public.t2e1_projected_gone(uuid) RENAME TO issue_3645_release_projected_totals;
  SELECT * INTO v_snap FROM public.payout_release_claim_snapshots WHERE release_id = v_st_x;
  IF (SELECT status FROM public.brand_payout_releases WHERE id = v_st_x) <> 'in_flight'
     OR v_snap.id IS NULL OR v_snap.projected IS NOT NULL OR v_snap.effective_withheld_cents IS NOT NULL
     OR v_snap.due_cents <> 5000 THEN
    RAISE EXCEPTION 'S5 FAIL: failing live inputs lost the snapshot or the claim: %', to_jsonb(v_snap);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S5 PASS: failing live inputs are left null; the claim goes on';

  -- ── S6 Paystack planned and paid through the real functions ───────────────
  PERFORM public.claim_paystack_payout_releases(20, v_now);
  SELECT paystack_execution_claim_id INTO v_claim FROM public.brand_payout_releases WHERE id = v_ps_a;
  SELECT * INTO v_snap FROM public.payout_release_claim_snapshots WHERE release_id = v_ps_a;
  IF v_snap.provider <> 'paystack' OR v_snap.claim_id IS DISTINCT FROM v_claim
     OR v_snap.due_cents <> 9000 OR v_snap.plan_reused IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'S6 FAIL: Paystack snapshot: %', to_jsonb(v_snap);
  END IF;
  PERFORM public.record_paystack_leg_plan(v_ps_a, v_claim,
    '[{"chunk_index":0,"principal_cents":8900,"estimated_fee_cents":90,"stamp_duty_cents":10}]'::jsonb, v_now);
  IF public.authorize_paystack_payout_execution(v_ps_a, v_claim, v_now) IS NOT TRUE THEN
    RAISE EXCEPTION 'S6 fixture: authorize refused';
  END IF;
  SELECT id INTO v_leg FROM public.payout_transfer_legs WHERE release_id = v_ps_a;
  PERFORM public.record_paystack_transfer_leg_outcome(v_leg, v_ps_a, 'succeeded', 'TRF_2e1_a', 'ref-2e1-a', NULL, v_now);
  PERFORM public.reconcile_paystack_transfer_leg_fee(v_leg, 90, 10, v_now);
  SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = v_ps_a;
  IF v_rel.status <> 'released' OR v_rel.paid_snapshot_id IS DISTINCT FROM v_snap.id
     OR v_rel.organiser_cash_delivered_cents <> 8900 THEN
    RAISE EXCEPTION 'S6 FAIL: paid Paystack release: %', to_jsonb(v_rel);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S6 PASS: a Paystack payout links the claim its legs were planned from (due 9000, 8900 sent after fees)';

  -- ── S7 net drops while a leg is out: the old leg pays, the old claim links ─
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, net_release_cents, status
  ) VALUES (v_ps_b, v_brand_ps, '2e1-ps-b', 'order', 'paystack', 'ngn',
            v_now - interval '2 days', v_now - interval '1 day', 10000, 1000, 9000, 'pending');
  PERFORM public.claim_paystack_payout_releases(20, v_now);
  SELECT paystack_execution_claim_id INTO v_claim FROM public.brand_payout_releases WHERE id = v_ps_b;
  SELECT id INTO v_first FROM public.payout_release_claim_snapshots WHERE release_id = v_ps_b;
  PERFORM public.record_paystack_leg_plan(v_ps_b, v_claim,
    '[{"chunk_index":0,"principal_cents":8900,"estimated_fee_cents":100,"stamp_duty_cents":0}]'::jsonb, v_now);
  SELECT id INTO v_leg FROM public.payout_transfer_legs WHERE release_id = v_ps_b;
  UPDATE public.payout_transfer_legs SET status = 'in_flight', provider_reference = 'ref-2e1-b' WHERE id = v_leg;
  -- A dispute refresh lowers net and puts the release back.
  UPDATE public.brand_payout_releases
     SET net_release_cents = 5000, disputed_cents = 4000, status = 'pending',
         paystack_execution_claim_id = NULL, paystack_execution_claimed_at = NULL
   WHERE id = v_ps_b;
  PERFORM public.claim_paystack_payout_releases(20, v_now);
  SELECT paystack_execution_claim_id INTO v_claim FROM public.brand_payout_releases WHERE id = v_ps_b;
  SELECT * INTO v_snap FROM public.payout_release_claim_snapshots WHERE release_id = v_ps_b AND claim_id = v_claim;
  IF v_snap.plan_reused IS DISTINCT FROM true OR v_snap.due_cents <> 5000 THEN
    RAISE EXCEPTION 'S7 FAIL: the re-claim snapshot: %', to_jsonb(v_snap);
  END IF;
  IF public.authorize_paystack_payout_execution(v_ps_b, v_claim, v_now) IS NOT FALSE THEN
    RAISE EXCEPTION 'S7 fixture: a plan above due was authorized';
  END IF;
  PERFORM public.reconcile_paystack_transfer_leg_fee(v_leg, 100, 0, v_now);
  SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = v_ps_b;
  IF v_rel.status <> 'released' OR v_rel.paid_snapshot_id IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'S7 FAIL: links % (want the planning claim %): %', v_rel.paid_snapshot_id, v_first, to_jsonb(v_rel);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S7 PASS: an old leg paid after a re-claim links the planning claim, not the re-claim';

  -- ── S8 net rises, the re-claim sends the kept plan: the planning claim links ─
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, net_release_cents, status
  ) VALUES (v_ps_c, v_brand_ps, '2e1-ps-c', 'order', 'paystack', 'ngn',
            v_now - interval '2 days', v_now - interval '1 day', 10000, 1000, 9000, 'pending');
  PERFORM public.claim_paystack_payout_releases(20, v_now);
  SELECT paystack_execution_claim_id INTO v_claim FROM public.brand_payout_releases WHERE id = v_ps_c;
  SELECT id INTO v_first FROM public.payout_release_claim_snapshots WHERE release_id = v_ps_c;
  PERFORM public.record_paystack_leg_plan(v_ps_c, v_claim,
    '[{"chunk_index":0,"principal_cents":8900,"estimated_fee_cents":90,"stamp_duty_cents":10}]'::jsonb, v_now);
  SELECT id INTO v_leg FROM public.payout_transfer_legs WHERE release_id = v_ps_c;
  PERFORM public.record_paystack_transfer_leg_outcome(v_leg, v_ps_c, 'retryable_error', NULL, 'ref-2e1-c', 'timeout', v_now);
  UPDATE public.brand_payout_releases SET net_release_cents = 9500 WHERE id = v_ps_c;
  PERFORM public.claim_paystack_payout_releases(20, v_now + interval '1 minute');
  SELECT paystack_execution_claim_id INTO v_claim FROM public.brand_payout_releases WHERE id = v_ps_c;
  IF (SELECT count(*) FROM public.payout_release_claim_snapshots WHERE release_id = v_ps_c) <> 2 THEN
    RAISE EXCEPTION 'S8 FAIL: the re-claim did not record a snapshot';
  END IF;
  IF public.authorize_paystack_payout_execution(v_ps_c, v_claim, v_now) IS NOT TRUE THEN
    RAISE EXCEPTION 'S8 fixture: the kept plan was refused';
  END IF;
  PERFORM public.record_paystack_transfer_leg_outcome(v_leg, v_ps_c, 'succeeded', 'TRF_2e1_c', 'ref-2e1-c', NULL, v_now);
  PERFORM public.reconcile_paystack_transfer_leg_fee(v_leg, 90, 10, v_now);
  SELECT * INTO v_rel FROM public.brand_payout_releases WHERE id = v_ps_c;
  IF v_rel.status <> 'released' OR v_rel.paid_snapshot_id IS DISTINCT FROM v_first
     OR v_rel.organiser_cash_delivered_cents <> 8900 THEN
    RAISE EXCEPTION 'S8 FAIL: links % (want %): %', v_rel.paid_snapshot_id, v_first, to_jsonb(v_rel);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S8 PASS: a kept plan sent on a re-claim links the claim it was planned from (due 9000, not 9500)';

  -- ── S9 Paystack with no legs: the settled claim links ─────────────────────
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, net_release_cents, status
  ) VALUES (v_ps_d, v_brand_ps, '2e1-ps-d', 'order', 'paystack', 'ngn',
            v_now - interval '2 days', v_now - interval '1 day', 10000, 1000, 9000, 'pending');
  PERFORM public.claim_paystack_payout_releases(20, v_now);
  SELECT * INTO v_snap FROM public.payout_release_claim_snapshots WHERE release_id = v_ps_d;
  UPDATE public.brand_payout_releases SET status = 'released', released_at = v_now WHERE id = v_ps_d;
  IF (SELECT paid_snapshot_id FROM public.brand_payout_releases WHERE id = v_ps_d) IS DISTINCT FROM v_snap.id THEN
    RAISE EXCEPTION 'S9 FAIL: a release with no legs does not link its claim';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S9 PASS: with nothing planned, the settled claim links';

  -- ── S10 snapshots are append-only, for service_role too ───────────────────
  BEGIN
    UPDATE public.payout_release_claim_snapshots SET due_cents = 0 WHERE release_id = v_st_a;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'S10 FAIL: a snapshot was updated'; END IF;
  SET LOCAL ROLE service_role;
  BEGIN
    DELETE FROM public.payout_release_claim_snapshots WHERE release_id = v_st_a;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  IF v_err IS NULL THEN RAISE EXCEPTION 'S10 FAIL: service_role deleted a snapshot'; END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S10 PASS: snapshots cannot be changed or deleted';

  -- ── S11 only the brand's finance managers read; nobody else writes ────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_fm::text, true);
  SELECT count(*)::integer INTO v_count FROM public.payout_release_claim_snapshots WHERE brand_id = v_brand_st;
  SELECT count(*)::integer INTO v_seen FROM public.payout_release_claim_snapshots WHERE brand_id = v_brand_ps;
  IF v_count < 4 OR v_seen <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'S11 FAIL: finance manager read % own / % other-brand snapshots', v_count, v_seen;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mm::text, true);
  SELECT count(*)::integer INTO v_seen FROM public.payout_release_claim_snapshots;
  IF v_seen <> 0 THEN RESET ROLE; RAISE EXCEPTION 'S11 FAIL: a marketing manager read % snapshots', v_seen; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  SELECT count(*)::integer INTO v_seen FROM public.payout_release_claim_snapshots;
  IF v_seen <> 0 THEN RESET ROLE; RAISE EXCEPTION 'S11 FAIL: a stranger read % snapshots', v_seen; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  BEGIN
    INSERT INTO public.payout_release_claim_snapshots (release_id, brand_id, provider, claim_id, due_cents)
    VALUES (v_st_a, v_brand_st, 'stripe', gen_random_uuid(), 1);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS NULL THEN RESET ROLE; RAISE EXCEPTION 'S11 FAIL: the owner wrote a snapshot'; END IF;
  UPDATE public.brand_payout_releases SET paid_snapshot_id = NULL WHERE id = v_st_a;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RESET ROLE; RAISE EXCEPTION 'S11 FAIL: the owner changed a paid link'; END IF;
  BEGIN
    PERFORM public.issue_3645_record_release_claim_snapshot();
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS NULL OR v_err NOT ILIKE '%permission denied%' THEN
    RESET ROLE; RAISE EXCEPTION 'S11 FAIL: authenticated may execute the trigger function (%)', v_err;
  END IF;
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*)::integer INTO v_seen FROM public.payout_release_claim_snapshots;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_err IS NULL THEN RAISE EXCEPTION 'S11 FAIL: anon read snapshots'; END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S11 PASS: only the brand''s finance managers read snapshots; no client writes';
END;
$test$;

ROLLBACK;
