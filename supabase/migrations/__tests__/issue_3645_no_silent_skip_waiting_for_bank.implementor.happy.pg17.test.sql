-- Issue #3645 PR8 — no silent skip when money is due but bank/recipient missing.
-- Proves: mature pending release without payout destination stays pending with
-- error_message=waiting_for_bank, writes one alert-outbox row, and is NOT
-- claimed. Claim helpers no longer gate on event_end+3d (behavioral, not grep).
-- Also: unmarked waiting-for-bank rows are prioritized over already-marked ones
-- when the batch is larger than the limit.

BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-000000000081';
  v_brand   constant uuid := '36450000-0000-4000-8000-000000000082';
  v_stripe  constant uuid := '36450000-0000-4000-8000-000000000083';
  v_rel_ps  constant uuid := '36450000-0000-4000-8000-000000000084';
  v_rel_st  constant uuid := '36450000-0000-4000-8000-000000000085';
  -- Ready-destination brands (claim path) with event ended <3 days ago.
  v_brand_ps_ready constant uuid := '36450000-0000-4000-8000-000000000086';
  v_brand_st_ready constant uuid := '36450000-0000-4000-8000-000000000087';
  v_evt_ps  constant uuid := '36450000-0000-4000-8000-000000000088';
  v_evt_st  constant uuid := '36450000-0000-4000-8000-000000000089';
  v_ed_ps   constant uuid := '36450000-0000-4000-8000-00000000008a';
  v_ed_st   constant uuid := '36450000-0000-4000-8000-00000000008b';
  v_rel_ps_ready constant uuid := '36450000-0000-4000-8000-00000000008c';
  v_rel_st_ready constant uuid := '36450000-0000-4000-8000-00000000008d';
  v_now     constant timestamptz := '2027-08-01 12:00:00+00';
  v_surfaced integer;
  v_status text;
  v_err text;
  v_alerts integer;
  v_claim_count integer;
  v_unmarked integer;
  v_i integer;
  v_rel_id uuid;
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
     'stripe', NULL, 'GB', 'GBP', NULL),
    (v_brand_ps_ready, v_owner, 'PR8 Paystack Ready', '3645-pr8-ps-ready', 'NGN',
     'paystack', 'NG', 'NG', 'NGN', v_now - interval '30 days'),
    (v_brand_st_ready, v_owner, 'PR8 Stripe Ready', '3645-pr8-st-ready', 'GBP',
     'stripe', NULL, 'GB', 'GBP', NULL);

  INSERT INTO public.stripe_connect_accounts (
    brand_id, stripe_account_id, charges_enabled, payouts_enabled,
    country, default_currency
  ) VALUES
    (v_stripe, 'acct_3645_pr8', true, false, 'GB', 'gbp'),
    (v_brand_st_ready, 'acct_3645_pr8_ready', true, true, 'GB', 'gbp');

  INSERT INTO public.brand_paystack_recipients (
    brand_id, recipient_code, bank_code, account_fingerprint,
    account_number_masked, account_name, is_active
  ) VALUES (
    v_brand_ps_ready, 'RCP_3645pr8ready', '058',
    'hmac-sha256:' || repeat('b', 64),
    '••••1234', 'PR8 Ready Account', true
  );

  -- Event ended <3 days ago; releasable_at already mature (payment+24h).
  INSERT INTO public.events (
    id, brand_id, created_by, title, slug, status, event_type, currency
  ) VALUES
    (v_evt_ps, v_brand_ps_ready, v_owner, 'PR8 PS Event', '3645-pr8-ps-evt',
     'ended', 'event', 'NGN'),
    (v_evt_st, v_brand_st_ready, v_owner, 'PR8 ST Event', '3645-pr8-st-evt',
     'ended', 'event', 'GBP');

  INSERT INTO public.event_dates (id, event_id, start_at, end_at, is_master)
  VALUES
    (v_ed_ps, v_evt_ps, v_now - interval '2 days', v_now - interval '1 day', true),
    (v_ed_st, v_evt_st, v_now - interval '2 days', v_now - interval '1 day', true);

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

  -- Ready-destination event-anchored releases: event ended 1 day ago (<3d),
  -- releasable_at mature → BOTH claim RPCs must return them.
  INSERT INTO public.brand_payout_releases (
    id, brand_id, event_id, event_date_id, occurrence_key, surface,
    provider, currency, anchor_end_at, releasable_at, gross_cents,
    mingla_fee_cents, net_release_cents, status
  ) VALUES
    (v_rel_ps_ready, v_brand_ps_ready, v_evt_ps, v_ed_ps, '3645-pr8-ps-ready',
     'order', 'paystack', 'ngn', v_now - interval '1 day',
     v_now, 8000, 800, 7200, 'pending'),
    (v_rel_st_ready, v_brand_st_ready, v_evt_st, v_ed_st, '3645-pr8-st-ready',
     'order', 'stripe', 'gbp', v_now - interval '1 day',
     v_now, 6000, 600, 5400, 'pending');

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

  -- Claim must pick ready-destination event-anchored releases (event ended
  -- <3 days ago, releasable_at mature) and must NOT pick no-bank rows.
  SELECT count(*)::integer INTO v_claim_count
  FROM public.claim_paystack_payout_releases(20, v_now);
  IF v_claim_count <> 1 THEN
    RAISE EXCEPTION
      'issue_3645 PR8: Paystack claim expected exactly the ready release, got %',
      v_claim_count;
  END IF;
  IF (SELECT status FROM public.brand_payout_releases WHERE id = v_rel_ps_ready)
       <> 'in_flight' THEN
    RAISE EXCEPTION
      'issue_3645 PR8: Paystack claim missed event-anchored mature release (residual event+3d gate?)';
  END IF;
  IF (SELECT status FROM public.brand_payout_releases WHERE id = v_rel_ps)
       <> 'pending' THEN
    RAISE EXCEPTION 'issue_3645 PR8: Paystack claim must not consume waiting-for-bank';
  END IF;

  SELECT count(*)::integer INTO v_claim_count
  FROM public.claim_stripe_payout_releases(20, v_now);
  IF v_claim_count <> 1 THEN
    RAISE EXCEPTION
      'issue_3645 PR8: Stripe claim expected exactly the ready release, got %',
      v_claim_count;
  END IF;
  IF (SELECT status FROM public.brand_payout_releases WHERE id = v_rel_st_ready)
       <> 'in_flight' THEN
    RAISE EXCEPTION
      'issue_3645 PR8: Stripe claim missed event-anchored mature release (residual event+3d gate?)';
  END IF;
  IF (SELECT status FROM public.brand_payout_releases WHERE id = v_rel_st)
       <> 'pending' THEN
    RAISE EXCEPTION 'issue_3645 PR8: Stripe claim must not consume waiting-for-bank';
  END IF;

  -- Starvation: 6 already-marked oldest rows + 3 unmarked newer ones; limit 5
  -- must prefer the unmarked (otherwise the marked batch forever fills the cap).
  FOR v_i IN 1..6 LOOP
    v_rel_id := (
      '36450000-0000-4000-8000-0000000001' || lpad(v_i::text, 2, '0')
    )::uuid;
    INSERT INTO public.brand_payout_releases (
      id, brand_id, occurrence_key, surface, provider, currency,
      anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
      net_release_cents, status, error_message
    ) VALUES (
      v_rel_id, v_brand, '3645-pr8-starve-old-' || v_i, 'order', 'paystack', 'ngn',
      v_now - interval '11 days' - (v_i || ' hours')::interval,
      v_now - interval '10 days' - (v_i || ' hours')::interval,
      1000, 100, 900, 'pending', 'waiting_for_bank'
    );
  END LOOP;
  FOR v_i IN 1..3 LOOP
    v_rel_id := (
      '36450000-0000-4000-8000-0000000002' || lpad(v_i::text, 2, '0')
    )::uuid;
    INSERT INTO public.brand_payout_releases (
      id, brand_id, occurrence_key, surface, provider, currency,
      anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
      net_release_cents, status
    ) VALUES (
      v_rel_id, v_brand, '3645-pr8-starve-new-' || v_i, 'order', 'paystack', 'ngn',
      v_now - interval '1 day' - (v_i || ' hours')::interval,
      v_now - (v_i || ' hours')::interval,
      1000, 100, 900, 'pending'
    );
  END LOOP;

  SELECT count(*)::integer INTO v_unmarked
  FROM public.surface_payout_releases_waiting_for_bank(5, v_now) s
  WHERE s.release_id IN (
    '36450000-0000-4000-8000-000000000201'::uuid,
    '36450000-0000-4000-8000-000000000202'::uuid,
    '36450000-0000-4000-8000-000000000203'::uuid
  );
  IF v_unmarked <> 3 THEN
    RAISE EXCEPTION
      'issue_3645 PR8: starvation — expected all 3 unmarked in limit-5 batch, got %',
      v_unmarked;
  END IF;
END
$test$;

ROLLBACK;
