\set ON_ERROR_STOP on

-- Issue #3645 bundle 2e-1 — claim-time payout snapshots.
-- Migration 20281119003645_issue_3645_payout_claim_snapshots.sql.
-- Runs after the full chain on PostgreSQL 17, through the real claim
-- functions. Everything rolls back.
--
-- MINGLA-INVARIANT: I-3645-PAYOUT-CLAIM-SNAPSHOT | issue #3645 | Every Stripe or Paystack claim of a payout release records one append-only snapshot of the release as claimed (money columns, effective withheld, projected totals, due = net + recredit); a release that is paid links the latest snapshot; recording it never blocks or changes a payout.

BEGIN;

DO $test$
DECLARE
  v_owner    constant uuid := '36452e10-0000-4000-8000-000000000001';
  v_stranger constant uuid := '36452e10-0000-4000-8000-000000000002';
  v_brand_st constant uuid := '36452e10-0000-4000-8000-000000000003';
  v_brand_ps constant uuid := '36452e10-0000-4000-8000-000000000004';
  v_rel_st   constant uuid := '36452e10-0000-4000-8000-000000000005';
  v_rel_ps   constant uuid := '36452e10-0000-4000-8000-000000000006';
  v_rel_x    constant uuid := '36452e10-0000-4000-8000-000000000007';
  v_now      constant timestamptz := '2027-09-01 12:00:00+00';
  v_snap     public.payout_release_claim_snapshots;
  v_count    integer;
  v_err      text;
  v_first    uuid;
  v_seen     integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_stranger);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-2e1@example.test');

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency, payout_hold_cutover_at
  ) VALUES
    (v_brand_st, v_owner, '2e1 Stripe Brand', '3645-2e1-stripe', 'USD',
     'stripe', 'US', 'US', 'USD', v_now - interval '60 days'),
    (v_brand_ps, v_owner, '2e1 Paystack Brand', '3645-2e1-paystack', 'NGN',
     'paystack', 'NG', 'NG', 'NGN', v_now - interval '60 days');
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

  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, net_release_cents, status
  ) VALUES
    (v_rel_st, v_brand_st, '3645-2e1-st', 'order', 'stripe', 'usd',
     v_now - interval '2 days', v_now - interval '1 day', 12000, 2000, 10000, 'pending'),
    (v_rel_ps, v_brand_ps, '3645-2e1-ps', 'order', 'paystack', 'ngn',
     v_now - interval '2 days', v_now - interval '1 day', 10000, 1000, 9000, 'pending');

  -- ── S1 a Stripe claim records one exact snapshot; money is untouched ──────
  SELECT count(*)::integer INTO v_count FROM public.claim_stripe_payout_releases(20, v_now);
  IF v_count <> 1 THEN RAISE EXCEPTION 'S1 fixture: claimed % releases', v_count; END IF;
  SELECT * INTO v_snap FROM public.payout_release_claim_snapshots WHERE release_id = v_rel_st;
  IF v_snap.id IS NULL THEN RAISE EXCEPTION 'S1 FAIL: no snapshot for the Stripe claim'; END IF;
  IF v_snap.provider <> 'stripe'
     OR v_snap.claim_id IS DISTINCT FROM (SELECT stripe_execution_claim_id FROM public.brand_payout_releases WHERE id = v_rel_st)
     OR v_snap.gross_cents <> 12000 OR v_snap.mingla_fee_cents <> 2000 OR v_snap.net_release_cents <> 10000
     OR v_snap.due_cents <> 10000 + COALESCE(v_snap.maturity_recredit_cents, 0)
     OR v_snap.projected IS NULL OR v_snap.effective_withheld_cents IS NULL THEN
    RAISE EXCEPTION 'S1 FAIL: snapshot does not match the claim: %', to_jsonb(v_snap);
  END IF;
  IF (SELECT net_release_cents FROM public.brand_payout_releases WHERE id = v_rel_st) <> 10000 THEN
    RAISE EXCEPTION 'S1 FAIL: recording the snapshot changed the release';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S1 PASS: a Stripe claim records one exact snapshot; money untouched';

  -- ── S2 a Paystack claim records its snapshot ───────────────────────────────
  SELECT count(*)::integer INTO v_count FROM public.claim_paystack_payout_releases(20, v_now);
  IF v_count <> 1 THEN RAISE EXCEPTION 'S2 fixture: claimed % releases', v_count; END IF;
  SELECT * INTO v_snap FROM public.payout_release_claim_snapshots WHERE release_id = v_rel_ps;
  IF v_snap.provider <> 'paystack' OR v_snap.due_cents <> 9000 + COALESCE(v_snap.maturity_recredit_cents, 0)
     OR v_snap.claim_id IS DISTINCT FROM (SELECT paystack_execution_claim_id FROM public.brand_payout_releases WHERE id = v_rel_ps) THEN
    RAISE EXCEPTION 'S2 FAIL: Paystack snapshot: %', to_jsonb(v_snap);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S2 PASS: a Paystack claim records its snapshot';

  -- ── S3 an unrelated update records nothing; paid links the snapshot ───────
  UPDATE public.brand_payout_releases SET attempt_count = attempt_count + 1 WHERE id = v_rel_st;
  SELECT count(*)::integer INTO v_count FROM public.payout_release_claim_snapshots WHERE release_id = v_rel_st;
  IF v_count <> 1 THEN RAISE EXCEPTION 'S3 FAIL: an unrelated update recorded a snapshot (%)', v_count; END IF;
  SELECT id INTO v_first FROM public.payout_release_claim_snapshots WHERE release_id = v_rel_st;
  UPDATE public.brand_payout_releases
     SET status = 'released', released_at = v_now, stripe_execution_claim_id = NULL
   WHERE id = v_rel_st;
  IF (SELECT paid_snapshot_id FROM public.brand_payout_releases WHERE id = v_rel_st) IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'S3 FAIL: the paid release does not link its snapshot';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S3 PASS: unrelated updates record nothing; paid links the snapshot';

  -- ── S4 a re-claim records a second snapshot; paid links the latest ────────
  -- (Paystack: a refresh puts the release back to pending, then it is claimed again.)
  UPDATE public.brand_payout_releases
     SET status = 'pending', paystack_execution_claim_id = NULL, paystack_execution_claimed_at = NULL
   WHERE id = v_rel_ps;
  SELECT count(*)::integer INTO v_count FROM public.claim_paystack_payout_releases(20, v_now);
  SELECT count(*)::integer INTO v_count FROM public.payout_release_claim_snapshots WHERE release_id = v_rel_ps;
  IF v_count <> 2 THEN RAISE EXCEPTION 'S4 FAIL: a re-claim recorded % snapshots, want 2', v_count; END IF;
  UPDATE public.brand_payout_releases SET status = 'released', released_at = v_now WHERE id = v_rel_ps;
  IF (SELECT paid_snapshot_id FROM public.brand_payout_releases WHERE id = v_rel_ps) IS DISTINCT FROM (
       SELECT s.id FROM public.payout_release_claim_snapshots s
        WHERE s.release_id = v_rel_ps
          AND s.claim_id = (SELECT paystack_execution_claim_id FROM public.brand_payout_releases WHERE id = v_rel_ps)) THEN
    RAISE EXCEPTION 'S4 FAIL: paid does not link the latest claim''s snapshot';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S4 PASS: a re-claim records a second snapshot; paid links the latest';

  -- ── S5 snapshots are append-only ──────────────────────────────────────────
  BEGIN
    UPDATE public.payout_release_claim_snapshots SET due_cents = 0 WHERE release_id = v_rel_st;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'S5 FAIL: a snapshot was updated'; END IF;
  BEGIN
    DELETE FROM public.payout_release_claim_snapshots WHERE release_id = v_rel_st;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'S5 FAIL: a snapshot was deleted'; END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S5 PASS: snapshots cannot be changed or deleted';

  -- ── S6 recording never blocks a payout ────────────────────────────────────
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, net_release_cents, status
  ) VALUES (
    v_rel_x, v_brand_st, '3645-2e1-x', 'order', 'stripe', 'usd',
    v_now - interval '2 days', v_now - interval '1 day', 6000, 1000, 5000, 'pending'
  );
  -- The snapshot insert itself fails: the claim still goes through, unrecorded.
  ALTER TABLE public.payout_release_claim_snapshots
    ADD CONSTRAINT t2e1_refuse CHECK (due_cents < 0) NOT VALID;
  SELECT count(*)::integer INTO v_count FROM public.claim_stripe_payout_releases(20, v_now);
  IF v_count <> 1 OR (SELECT status FROM public.brand_payout_releases WHERE id = v_rel_x) <> 'in_flight' THEN
    RAISE EXCEPTION 'S6 FAIL: a failing snapshot blocked the claim (claimed %)', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payout_release_claim_snapshots WHERE release_id = v_rel_x) THEN
    RAISE EXCEPTION 'S6 FAIL: a refused snapshot was recorded';
  END IF;
  ALTER TABLE public.payout_release_claim_snapshots DROP CONSTRAINT t2e1_refuse;
  -- The live helpers fail: the snapshot is still recorded from the release's own columns.
  UPDATE public.brand_payout_releases
     SET status = 'pending', stripe_execution_claim_id = NULL, stripe_execution_claimed_at = NULL
   WHERE id = v_rel_x;
  ALTER FUNCTION public.issue_3645_release_projected_totals(uuid) RENAME TO t2e1_projected_gone;
  SELECT count(*)::integer INTO v_count FROM public.claim_stripe_payout_releases(20, v_now);
  ALTER FUNCTION public.t2e1_projected_gone(uuid) RENAME TO issue_3645_release_projected_totals;
  SELECT * INTO v_snap FROM public.payout_release_claim_snapshots WHERE release_id = v_rel_x;
  IF v_count <> 1 OR v_snap.id IS NULL OR v_snap.projected IS NOT NULL OR v_snap.due_cents <> 5000 + COALESCE(v_snap.maturity_recredit_cents, 0) THEN
    RAISE EXCEPTION 'S6 FAIL: helpers failing lost the snapshot or the claim (claimed %, %)', v_count, to_jsonb(v_snap);
  END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S6 PASS: recording never blocks a claim; failed live inputs are left null';

  -- ── S7 only finance managers of the brand can read snapshots ──────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  SELECT count(*)::integer INTO v_seen FROM public.payout_release_claim_snapshots;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SELECT count(*)::integer INTO v_count
    FROM public.payout_release_claim_snapshots WHERE brand_id IN (v_brand_st, v_brand_ps);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_seen <> 0 THEN RAISE EXCEPTION 'S7 FAIL: a stranger read % snapshots', v_seen; END IF;
  IF v_count < 4 THEN RAISE EXCEPTION 'S7 FAIL: the owner read only % snapshots', v_count; END IF;
  RAISE NOTICE 'ISSUE-3645-2E1 S7 PASS: only the brand''s finance managers read snapshots';
END;
$test$;

ROLLBACK;
