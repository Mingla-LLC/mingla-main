-- Issue #3645 PR9 — admin pause/resume + debt view (PG17 happy path).
-- Proves:
--   * admin_set_brand_payouts_paused (admin JWT) sets the pause state + a visible
--     admin_paused marker, and the claim RPC then SKIPS the brand's mature money
--     (money accrues; release stays pending).
--   * resume clears the state + marker and the claim RPC then picks the release.
--   * both actions write a brand.payouts_pause / brand.payouts_resume audit row.
--   * admin_get_brand_payout_console reports the pause state, per-currency
--     balance, next payout, and outstanding/recovered debt (integer cents).
--   * admin_list_organiser_payout_debts lists the brand's debt with outstanding.

BEGIN;

DO $test$
DECLARE
  v_owner    constant uuid := '36450000-0000-4000-8000-000000000c01';
  v_admin    constant uuid := '36450000-0000-4000-8000-000000000c02';
  v_brand    constant uuid := '36450000-0000-4000-8000-000000000c03';
  v_rel_pend constant uuid := '36450000-0000-4000-8000-000000000c04';
  v_rel_orig constant uuid := '36450000-0000-4000-8000-000000000c05';
  v_now      constant timestamptz := '2027-09-01 12:00:00+00';
  v_claim    integer;
  v_status   text;
  v_err      text;
  v_paused   boolean;
  v_console  jsonb;
  v_debts    jsonb;
  v_bal      jsonb;
  v_audit    integer;
BEGIN
  -- Fixtures: a Paystack NG brand with an active recipient (claimable), one
  -- mature pending release, and one released origin carrying an open debt.
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-3645-pr9@example.test');
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'admin-3645-pr9@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3645-pr9@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency,
    payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'PR9 Pause Brand', '3645-pr9-pause', 'NGN',
    'paystack', 'NG', 'NG', 'NGN', v_now - interval '60 days'
  );

  INSERT INTO public.brand_paystack_recipients (
    brand_id, recipient_code, bank_code, account_fingerprint,
    account_number_masked, account_name, is_active
  ) VALUES (
    v_brand, 'RCP_3645pr9', '058', 'hmac-sha256:' || repeat('c', 64),
    '••••9999', 'PR9 Account', true
  );

  -- Mature pending release (net > 0): claimable once not paused.
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, status
  ) VALUES (
    v_rel_pend, v_brand, '3645-pr9-pend', 'order', 'paystack', 'ngn',
    v_now - interval '2 days', v_now - interval '1 day',
    10000, 1000, 9000, 'pending'
  );

  -- Released origin for an open debt (outstanding 3000 of 5000).
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, organiser_cash_delivered_cents, status, released_at
  ) VALUES (
    v_rel_orig, v_brand, '3645-pr9-orig', 'order', 'paystack', 'ngn',
    v_now - interval '10 days', v_now - interval '9 days',
    5000, 500, 0, 4500, 'released', v_now - interval '9 days'
  );

  INSERT INTO public.organiser_payout_debts (
    brand_id, currency, origin_release_id, kind,
    principal_cents, recovered_cents, status, idempotency_key
  ) VALUES (
    v_brand, 'ngn', v_rel_orig, 'post_release_refund',
    5000, 2000, 'open', 'pr9-test-debt:' || v_rel_orig::text
  );

  -- ── Pause (admin JWT) ──────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_set_brand_payouts_paused(v_brand, true, 'ops: suspected fraud review');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- Pause state lives in the admin-only hold table (presence of a row == paused).
  SELECT paused_at IS NOT NULL, reason
    INTO v_paused, v_err FROM public.brand_payout_admin_holds WHERE brand_id = v_brand;
  IF v_paused IS NOT TRUE THEN
    RAISE EXCEPTION 'pr9: pause did not create a brand_payout_admin_holds row';
  END IF;
  IF v_err IS DISTINCT FROM 'ops: suspected fraud review' THEN
    RAISE EXCEPTION 'pr9: pause reason not stored (got %)', v_err;
  END IF;

  SELECT status, error_message INTO v_status, v_err
  FROM public.brand_payout_releases WHERE id = v_rel_pend;
  IF v_status <> 'pending' OR v_err IS DISTINCT FROM 'admin_paused' THEN
    RAISE EXCEPTION 'pr9: paused release should stay pending/admin_paused (got % / %)',
      v_status, v_err;
  END IF;

  -- Claim must SKIP the paused brand (money accrues).
  SELECT count(*)::integer INTO v_claim
  FROM public.claim_paystack_payout_releases(20, v_now);
  IF v_claim <> 0 THEN
    RAISE EXCEPTION 'pr9: paused brand claimed % releases (expected 0)', v_claim;
  END IF;
  IF (SELECT status FROM public.brand_payout_releases WHERE id = v_rel_pend) <> 'pending' THEN
    RAISE EXCEPTION 'pr9: paused release was consumed by claim';
  END IF;

  -- Console reflects the pause + balance + debt.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_console := public.admin_get_brand_payout_console(v_brand);
  v_debts   := public.admin_list_organiser_payout_debts(NULL, NULL, v_brand, 25, 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF (v_console->'pause'->>'paused') <> 'true' THEN
    RAISE EXCEPTION 'pr9: console does not report paused';
  END IF;
  -- Single currency (ngn) → the only balance entry.
  v_bal := v_console->'balances'->0;
  IF (v_bal->>'currency') <> 'ngn' THEN
    RAISE EXCEPTION 'pr9: console balance currency expected ngn got %', v_bal->>'currency';
  END IF;
  IF (v_bal->>'pending_net_cents')::bigint <> 9000 THEN
    RAISE EXCEPTION 'pr9: console pending_net_cents expected 9000 got %', v_bal->>'pending_net_cents';
  END IF;
  IF (v_bal->>'admin_paused_cents')::bigint <> 9000 THEN
    RAISE EXCEPTION 'pr9: console admin_paused_cents expected 9000 got %', v_bal->>'admin_paused_cents';
  END IF;
  IF (v_console->'debts'->0->>'open_outstanding_cents')::bigint <> 3000 THEN
    RAISE EXCEPTION 'pr9: console open_outstanding_cents expected 3000 got %',
      v_console->'debts'->0->>'open_outstanding_cents';
  END IF;
  IF (v_console->>'next_payout_at') IS NULL THEN
    RAISE EXCEPTION 'pr9: console next_payout_at should be set for a pending release';
  END IF;

  IF (v_debts->>'total')::int <> 1 THEN
    RAISE EXCEPTION 'pr9: debt list total expected 1 got %', v_debts->>'total';
  END IF;
  IF (v_debts->'rows'->0->>'outstanding_cents')::bigint <> 3000 THEN
    RAISE EXCEPTION 'pr9: debt list outstanding_cents expected 3000 got %',
      v_debts->'rows'->0->>'outstanding_cents';
  END IF;

  -- Pause audit row present.
  SELECT count(*)::integer INTO v_audit
  FROM public.admin_audit_log
  WHERE action = 'brand.payouts_pause' AND target_id = v_brand::text;
  IF v_audit < 1 THEN
    RAISE EXCEPTION 'pr9: no brand.payouts_pause audit row';
  END IF;

  -- ── Resume (admin JWT) ─────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_set_brand_payouts_paused(v_brand, false, 'ops: review cleared');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- Resume removes the hold row entirely (state + reason gone in one delete).
  SELECT NOT EXISTS (SELECT 1 FROM public.brand_payout_admin_holds WHERE brand_id = v_brand)
    INTO v_paused;
  IF NOT v_paused THEN
    RAISE EXCEPTION 'pr9: resume did not remove the brand_payout_admin_holds row';
  END IF;
  IF (SELECT error_message FROM public.brand_payout_releases WHERE id = v_rel_pend) IS NOT NULL THEN
    RAISE EXCEPTION 'pr9: resume did not clear admin_paused marker';
  END IF;

  -- Claim now picks the matured release.
  SELECT count(*)::integer INTO v_claim
  FROM public.claim_paystack_payout_releases(20, v_now);
  IF v_claim <> 1 THEN
    RAISE EXCEPTION 'pr9: resumed brand claimed % releases (expected 1)', v_claim;
  END IF;
  IF (SELECT status FROM public.brand_payout_releases WHERE id = v_rel_pend) <> 'in_flight' THEN
    RAISE EXCEPTION 'pr9: resumed release not claimed to in_flight';
  END IF;

  SELECT count(*)::integer INTO v_audit
  FROM public.admin_audit_log
  WHERE action = 'brand.payouts_resume' AND target_id = v_brand::text;
  IF v_audit < 1 THEN
    RAISE EXCEPTION 'pr9: no brand.payouts_resume audit row';
  END IF;

  RAISE NOTICE 'issue_3645_admin_payout_pause_and_debt_implementor_happy_pass';
END;
$test$;

ROLLBACK;
