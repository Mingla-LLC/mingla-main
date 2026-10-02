-- Issue #3645 PR9 — admin pause/resume + debt view (PG17 adversarial).
-- Proves the hard edges:
--   * non-admin JWT is rejected (not_authorized) on pause, console, and list.
--   * empty reason is rejected (reason_required).
--   * the brands CHECK forbids a paused state without a reason (and a reason
--     without a paused state).
--   * pause never clobbers a waiting_for_bank marker, and resume leaves it.
--   * anon has no EXECUTE on any PR9 RPC; claim stays service_role-only.

BEGIN;

DO $test$
DECLARE
  v_owner  constant uuid := '36450000-0000-4000-8000-000000000d01';
  v_admin  constant uuid := '36450000-0000-4000-8000-000000000d02';
  v_nonadm constant uuid := '36450000-0000-4000-8000-000000000d03';
  v_brand  constant uuid := '36450000-0000-4000-8000-000000000d04';
  v_rel_wb constant uuid := '36450000-0000-4000-8000-000000000d05';
  v_now    constant timestamptz := '2027-09-01 12:00:00+00';
  v_err    text;
  v_ok     boolean;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-3645-pr9adv@example.test');
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'admin-3645-pr9adv@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3645-pr9adv@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  -- A non-admin signed-in user.
  INSERT INTO auth.users(id, email) VALUES (v_nonadm, 'nonadmin-3645-pr9adv@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_nonadm, 'nonadmin-3645-pr9adv@example.test');

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency,
    payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'PR9 Adv Brand', '3645-pr9-adv', 'NGN',
    'paystack', 'NG', 'NG', 'NGN', v_now - interval '60 days'
  );

  -- A pending release already flagged waiting_for_bank (PR8).
  INSERT INTO public.brand_payout_releases (
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    net_release_cents, status, error_message
  ) VALUES (
    v_rel_wb, v_brand, '3645-pr9-adv-wb', 'order', 'paystack', 'ngn',
    v_now - interval '2 days', v_now - interval '1 day',
    10000, 1000, 9000, 'pending', 'waiting_for_bank'
  );

  -- 1. non-admin pause → not_authorized.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_nonadm::text, true);
  BEGIN
    PERFORM public.admin_set_brand_payouts_paused(v_brand, true, 'should fail');
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr9adv: non-admin pause was allowed';
  EXCEPTION WHEN sqlstate 'P0001' OR others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%not_authorized%' THEN
      RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
      RAISE EXCEPTION 'pr9adv: non-admin pause wrong error: %', v_err;
    END IF;
  END;

  -- 2. non-admin console / list → not_authorized.
  BEGIN
    PERFORM public.admin_get_brand_payout_console(v_brand);
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr9adv: non-admin console was allowed';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%not_authorized%' THEN
      RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
      RAISE EXCEPTION 'pr9adv: non-admin console wrong error: %', v_err;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_list_organiser_payout_debts(NULL, NULL, v_brand, 25, 0);
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr9adv: non-admin debt list was allowed';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%not_authorized%' THEN
      RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
      RAISE EXCEPTION 'pr9adv: non-admin debt list wrong error: %', v_err;
    END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- 3. admin pause with empty reason → reason_required.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.admin_set_brand_payouts_paused(v_brand, true, '   ');
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr9adv: empty-reason pause was allowed';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%reason_required%' THEN
      RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
      RAISE EXCEPTION 'pr9adv: empty-reason wrong error: %', v_err;
    END IF;
  END;

  -- 4. valid pause does NOT clobber the waiting_for_bank marker.
  PERFORM public.admin_set_brand_payouts_paused(v_brand, true, 'ops: hold while investigating');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (SELECT error_message FROM public.brand_payout_releases WHERE id = v_rel_wb)
       <> 'waiting_for_bank' THEN
    RAISE EXCEPTION 'pr9adv: pause clobbered waiting_for_bank marker';
  END IF;

  -- resume leaves waiting_for_bank intact (only clears admin_paused).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_set_brand_payouts_paused(v_brand, false, 'ops: done');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (SELECT error_message FROM public.brand_payout_releases WHERE id = v_rel_wb)
       <> 'waiting_for_bank' THEN
    RAISE EXCEPTION 'pr9adv: resume wrongly cleared waiting_for_bank marker';
  END IF;

  -- 5. CHECK: a paused state with no reason is rejected.
  BEGIN
    UPDATE public.brands
    SET payouts_admin_paused_at = v_now, payouts_admin_pause_reason = NULL
    WHERE id = v_brand;
    RAISE EXCEPTION 'pr9adv: CHECK allowed paused state with no reason';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;

  -- and a reason with no paused state is rejected.
  BEGIN
    UPDATE public.brands
    SET payouts_admin_paused_at = NULL, payouts_admin_pause_reason = 'orphan'
    WHERE id = v_brand;
    RAISE EXCEPTION 'pr9adv: CHECK allowed a reason with no paused state';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;

  -- 6. privilege: anon has no EXECUTE on any PR9 RPC; claim stays service_role-only.
  v_ok := has_function_privilege('anon',
            'public.admin_set_brand_payouts_paused(uuid,boolean,text)', 'EXECUTE')
       OR has_function_privilege('anon',
            'public.admin_get_brand_payout_console(uuid)', 'EXECUTE')
       OR has_function_privilege('anon',
            'public.admin_list_organiser_payout_debts(text,text,uuid,integer,integer)', 'EXECUTE')
       OR has_function_privilege('authenticated',
            'public.claim_paystack_payout_releases(integer,timestamptz)', 'EXECUTE');
  IF v_ok THEN
    RAISE EXCEPTION 'pr9adv: a PR9 RPC leaked EXECUTE to anon/authenticated';
  END IF;

  RAISE NOTICE 'issue_3645_admin_payout_pause_and_debt_tester_adversarial_pass';
END;
$test$;

ROLLBACK;
