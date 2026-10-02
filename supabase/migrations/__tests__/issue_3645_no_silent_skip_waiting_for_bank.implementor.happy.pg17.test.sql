-- Issue #3645 PR8 — no silent skip when money is due but bank/recipient missing.
-- Proves: mature pending release without payout destination stays pending with
-- error_message=waiting_for_bank, writes one alert-outbox row, and is NOT
-- claimed. Claim helpers no longer gate on event_end+3d.

BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-000000000081';
  v_brand   constant uuid := '36450000-0000-4000-8000-000000000082';
  v_stripe  constant uuid := '36450000-0000-4000-8000-000000000083';
  v_rel_ps  constant uuid := '36450000-0000-4000-8000-000000000084';
  v_rel_st  constant uuid := '36450000-0000-4000-8000-000000000085';
  v_now     constant timestamptz := '2027-08-01 12:00:00+00';
  v_surfaced integer;
  v_status text;
  v_err text;
  v_alerts integer;
  v_claim_count integer;
  v_def text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-3645-pr8@example.test');

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency,
    payout_hold_cutover_at
  ) VALUES
    (v_brand, v_owner, 'PR8 Hold No Bank', '3645-pr8-hold', 'NGN',
     'paystack', 'NG', 'NG', 'NGN', v_now - interval '30 days'),
    (v_stripe, v_owner, 'PR8 Stripe No Payouts', '3645-pr8-stripe', 'GBP',
     'stripe', NULL, 'GB', 'GBP', NULL);

  INSERT INTO public.stripe_connect_accounts (
    brand_id, stripe_account_id, charges_enabled, payouts_enabled,
    country, default_currency
  ) VALUES (
    v_stripe, 'acct_3645_pr8', true, false, 'GB', 'gbp'
  );

  -- Mature pending Paystack release, no recipient → must surface, not claim.
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, status
  ) VALUES (
    v_rel_ps, v_brand, '3645-pr8-ps', 'order', 'paystack', 'ngn',
    v_now - interval '2 days', v_now - interval '1 day',
    10000, 1000, 9000, 'pending'
  );

  -- Mature pending Stripe release, charges ok but payouts_enabled false.
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, status
  ) VALUES (
    v_rel_st, v_stripe, '3645-pr8-st', 'order', 'stripe', 'gbp',
    v_now - interval '2 days', v_now - interval '1 day',
    5000, 500, 4500, 'pending'
  );

  SELECT count(*)::integer INTO v_surfaced
  FROM public.surface_payout_releases_waiting_for_bank(50, v_now);
  IF v_surfaced <> 2 THEN
    RAISE EXCEPTION 'issue_3645 PR8: expected 2 surfaced waiting-for-bank, got %',
      v_surfaced;
  END IF;

  SELECT status, error_message INTO v_status, v_err
  FROM public.brand_payout_releases WHERE id = v_rel_ps;
  IF v_status <> 'pending' OR v_err <> 'waiting_for_bank' THEN
    RAISE EXCEPTION 'issue_3645 PR8: Paystack release silently dropped or status changed (% / %)',
      v_status, v_err;
  END IF;

  SELECT status, error_message INTO v_status, v_err
  FROM public.brand_payout_releases WHERE id = v_rel_st;
  IF v_status <> 'pending' OR v_err <> 'waiting_for_bank' THEN
    RAISE EXCEPTION 'issue_3645 PR8: Stripe release silently dropped or status changed (% / %)',
      v_status, v_err;
  END IF;

  SELECT count(*)::integer INTO v_alerts
  FROM public.payout_release_alert_outbox
  WHERE alert_kind = 'waiting_for_bank'
    AND release_id IN (v_rel_ps, v_rel_st);
  IF v_alerts <> 2 THEN
    RAISE EXCEPTION 'issue_3645 PR8: expected 2 waiting_for_bank outbox rows, got %',
      v_alerts;
  END IF;

  -- Idempotent: second surface does not duplicate alerts or drop the release.
  SELECT count(*)::integer INTO v_surfaced
  FROM public.surface_payout_releases_waiting_for_bank(50, v_now);
  IF v_surfaced <> 2 THEN
    RAISE EXCEPTION 'issue_3645 PR8: re-surface must still return both rows, got %',
      v_surfaced;
  END IF;
  SELECT count(*)::integer INTO v_alerts
  FROM public.payout_release_alert_outbox
  WHERE alert_kind = 'waiting_for_bank'
    AND release_id IN (v_rel_ps, v_rel_st);
  IF v_alerts <> 2 THEN
    RAISE EXCEPTION 'issue_3645 PR8: alert outbox must stay one-per-release, got %',
      v_alerts;
  END IF;

  -- Claim must not pick either up (no bank / no payouts_enabled).
  SELECT count(*)::integer INTO v_claim_count
  FROM public.claim_paystack_payout_releases(20, v_now);
  IF v_claim_count <> 0 THEN
    RAISE EXCEPTION 'issue_3645 PR8: Paystack claim must stay empty without recipient';
  END IF;
  SELECT count(*)::integer INTO v_claim_count
  FROM public.claim_stripe_payout_releases(20, v_now);
  IF v_claim_count <> 0 THEN
    RAISE EXCEPTION 'issue_3645 PR8: Stripe claim must stay empty without payouts_enabled';
  END IF;

  -- Still pending after claim attempts.
  IF (SELECT status FROM public.brand_payout_releases WHERE id = v_rel_ps)
       <> 'pending'
     OR (SELECT status FROM public.brand_payout_releases WHERE id = v_rel_st)
       <> 'pending' THEN
    RAISE EXCEPTION 'issue_3645 PR8: claim path must not consume waiting-for-bank releases';
  END IF;

  -- Residual event+3d gate must be gone from claim bodies.
  v_def := pg_get_functiondef(
    'public.claim_stripe_payout_releases(integer,timestamptz)'::regprocedure
  );
  IF position('3 days' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue_3645 PR8: claim_stripe still mentions 3 days maturity';
  END IF;
  v_def := pg_get_functiondef(
    'public.claim_paystack_payout_releases(integer,timestamptz)'::regprocedure
  );
  IF position('3 days' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue_3645 PR8: claim_paystack still mentions 3 days maturity';
  END IF;
END
$test$;

ROLLBACK;
