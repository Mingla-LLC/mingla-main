-- Issue #3645 PR10 — organiser payout visibility (PG17 happy path).
-- Proves:
--   * brand_get_payout_visibility returns the organiser-safe contract —
--     EXACTLY { payouts_paused, next_payout_at, earned_cents, on_its_way_cents,
--     paid_cents, currency } — for the brand owner AND a finance_manager.
--   * earned = paid + on-its-way; cancelled_event / failed releases are excluded;
--     next_payout_at is the earliest maturity among not-yet-paid money.
--   * an admin pause flips payouts_paused and nulls next_payout_at (a paused
--     brand is promised no date); resume restores it.
--   * the response never carries a ledger error_message (#1180 law) — a secret
--     error_message planted on a failed release does not appear anywhere.
--   * the hold trigger records one 'paused' / 'resumed' notice per transition and
--     the drain RPCs list then close them.

BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-000000000e01';
  v_admin   constant uuid := '36450000-0000-4000-8000-000000000e02';
  v_fin     constant uuid := '36450000-0000-4000-8000-000000000e03';
  v_brand   constant uuid := '36450000-0000-4000-8000-000000000e04';
  v_now     constant timestamptz := '2027-09-01 12:00:00+00';
  v_vis     jsonb;
  v_keys    text;
  v_count   integer;
  v_notice  uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-3645-pr10@example.test');
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'admin-3645-pr10@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3645-pr10@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO auth.users(id, email) VALUES (v_fin, 'fin-3645-pr10@example.test');

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency,
    payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'PR10 Visibility Brand', '3645-pr10-vis', 'NGN',
    'paystack', 'NG', 'NG', 'NGN', v_now - interval '60 days'
  );

  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_fin, 'finance_manager', now(), now());

  -- pending 9000 (matures v_now - 1 day), in_flight 2000, released 4500,
  -- cancelled 777 (excluded), failed 555 (excluded; carries a secret message).
  INSERT INTO public.brand_payout_releases (
    brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, organiser_cash_delivered_cents, status, released_at, error_message
  ) VALUES
    (v_brand, '3645-pr10-pend', 'order', 'paystack', 'ngn',
     v_now - interval '2 days', v_now - interval '1 day', 10000, 1000, 9000, NULL,
     'pending', NULL, NULL),
    (v_brand, '3645-pr10-fly', 'order', 'paystack', 'ngn',
     v_now - interval '2 days', v_now + interval '3 days', 2200, 200, 2000, NULL,
     'in_flight', NULL, NULL),
    (v_brand, '3645-pr10-paid', 'order', 'paystack', 'ngn',
     v_now - interval '10 days', v_now - interval '9 days', 5000, 500, 4500, 4500,
     'released', v_now - interval '9 days', NULL),
    (v_brand, '3645-pr10-canc', 'order', 'paystack', 'ngn',
     v_now - interval '10 days', v_now - interval '9 days', 800, 23, 777, NULL,
     'cancelled_event', NULL, NULL),
    (v_brand, '3645-pr10-fail', 'order', 'paystack', 'ngn',
     v_now - interval '10 days', v_now - interval '9 days', 600, 45, 555, NULL,
     'failed', NULL, 'SECRET_INTERNAL_otp_kyc_detail');

  -- ── Owner reads ───────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_vis := public.brand_get_payout_visibility(v_brand);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT string_agg(k, ',' ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_vis) k;
  IF v_keys IS DISTINCT FROM
     'currency,earned_cents,next_payout_at,on_its_way_cents,paid_cents,payouts_paused' THEN
    RAISE EXCEPTION 'pr10: visibility keys are not the contract (got %)', v_keys;
  END IF;
  IF (v_vis->>'payouts_paused')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'pr10: unpaused brand reported paused';
  END IF;
  IF (v_vis->>'on_its_way_cents')::bigint <> 11000 THEN
    RAISE EXCEPTION 'pr10: on_its_way expected 11000 (9000 pending + 2000 in_flight), got %',
      v_vis->>'on_its_way_cents';
  END IF;
  IF (v_vis->>'paid_cents')::bigint <> 4500 THEN
    RAISE EXCEPTION 'pr10: paid expected 4500, got %', v_vis->>'paid_cents';
  END IF;
  IF (v_vis->>'earned_cents')::bigint <> 15500 THEN
    RAISE EXCEPTION 'pr10: earned expected 15500 (cancelled/failed excluded), got %',
      v_vis->>'earned_cents';
  END IF;
  IF v_vis->>'currency' <> 'ngn' THEN
    RAISE EXCEPTION 'pr10: currency expected ngn, got %', v_vis->>'currency';
  END IF;
  IF (v_vis->>'next_payout_at')::timestamptz <> v_now - interval '1 day' THEN
    RAISE EXCEPTION 'pr10: next_payout_at expected earliest maturity, got %',
      v_vis->>'next_payout_at';
  END IF;
  -- #1180 law: no ledger internals leak into the organiser JSON.
  IF position('SECRET_INTERNAL' IN v_vis::text) > 0
     OR position('error_message' IN v_vis::text) > 0
     OR position('attempt_count' IN v_vis::text) > 0 THEN
    RAISE EXCEPTION 'pr10: visibility JSON leaked a ledger internal: %', v_vis;
  END IF;

  -- ── finance_manager reads the same answer ─────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_fin::text, true);
  v_vis := public.brand_get_payout_visibility(v_brand);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (v_vis->>'earned_cents')::bigint <> 15500 THEN
    RAISE EXCEPTION 'pr10: finance_manager earned mismatch (got %)', v_vis->>'earned_cents';
  END IF;

  -- ── Admin pause: flag flips, next_payout_at nulled, one notice recorded ───
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_set_brand_payouts_paused(v_brand, true, 'ops: PRIVATE admin reason');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_vis := public.brand_get_payout_visibility(v_brand);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (v_vis->>'payouts_paused')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'pr10: paused brand not reported paused';
  END IF;
  IF jsonb_typeof(v_vis->'next_payout_at') <> 'null' THEN
    RAISE EXCEPTION 'pr10: paused brand must have next_payout_at null (got %)', v_vis->'next_payout_at';
  END IF;
  IF (v_vis->>'on_its_way_cents')::bigint <> 11000 THEN
    RAISE EXCEPTION 'pr10: paused money must still count as on its way';
  END IF;
  -- The admin reason never reaches the organiser.
  IF position('PRIVATE admin reason' IN v_vis::text) > 0 THEN
    RAISE EXCEPTION 'pr10: admin pause reason leaked to organiser JSON';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.brand_payout_pause_notices
  WHERE brand_id = v_brand AND kind = 'paused' AND notified_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'pr10: expected exactly 1 pending paused notice, got %', v_count;
  END IF;

  -- Re-pausing (reason refresh) is an UPDATE, not a new transition.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_set_brand_payouts_paused(v_brand, true, 'ops: refreshed reason');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*)::integer INTO v_count
  FROM public.brand_payout_pause_notices WHERE brand_id = v_brand AND kind = 'paused';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'pr10: re-pause created a duplicate notice (got %)', v_count;
  END IF;

  -- Drain RPC lists it with the brand name; complete closes it.
  SELECT notice_id INTO v_notice
  FROM public.claim_brand_payout_pause_notices(50)
  WHERE brand_id = v_brand AND kind = 'paused';
  IF v_notice IS NULL THEN
    RAISE EXCEPTION 'pr10: claim_brand_payout_pause_notices did not list the paused notice';
  END IF;
  IF (SELECT brand_name FROM public.claim_brand_payout_pause_notices(50)
        WHERE notice_id = v_notice) <> 'PR10 Visibility Brand' THEN
    RAISE EXCEPTION 'pr10: notice missing brand name';
  END IF;
  PERFORM public.complete_brand_payout_pause_notices(ARRAY[v_notice]);
  IF EXISTS (SELECT 1 FROM public.claim_brand_payout_pause_notices(50) WHERE notice_id = v_notice) THEN
    RAISE EXCEPTION 'pr10: completed notice still listed';
  END IF;

  -- ── Resume: flag clears, date returns, a 'resumed' notice is recorded ─────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_set_brand_payouts_paused(v_brand, false, 'ops: cleared');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_vis := public.brand_get_payout_visibility(v_brand);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (v_vis->>'payouts_paused')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'pr10: resumed brand still reported paused';
  END IF;
  IF (v_vis->>'next_payout_at')::timestamptz <> v_now - interval '1 day' THEN
    RAISE EXCEPTION 'pr10: resumed brand next_payout_at not restored';
  END IF;
  SELECT count(*)::integer INTO v_count
  FROM public.brand_payout_pause_notices
  WHERE brand_id = v_brand AND kind = 'resumed' AND notified_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'pr10: expected 1 pending resumed notice, got %', v_count;
  END IF;

  -- The milestone column for Paystack bank-added exists and is claimable.
  INSERT INTO public.brand_appsflyer_milestones (brand_id, first_bank_added_at)
  VALUES (v_brand, now());

  RAISE NOTICE 'issue_3645_organiser_payout_visibility_implementor_happy_pass';
END;
$test$;

ROLLBACK;
