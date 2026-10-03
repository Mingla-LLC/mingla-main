-- Issue #3645 PR10 — organiser payout visibility (PG17 adversarial).
-- Proves the hard edges of brand_get_payout_visibility + the pause-notice outbox:
--   * a non-member, a non-payments role (scanner; event_manager — which ranks
--     ABOVE finance_manager but is still not a payments manager), and a
--     finance_manager of ANOTHER brand are all refused with 42501.
--   * an unauthenticated (no sub) call is refused with 42501; NULL brand refused.
--   * anon has no EXECUTE; authenticated cannot read the hold table or the
--     notice outbox, and cannot call the sweep-side drain RPCs.
--   * a brand with no releases still answers (zeros) rather than erroring.
--   * a removed (soft-deleted) finance_manager loses access.

BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-000000000f01';
  v_other   constant uuid := '36450000-0000-4000-8000-000000000f02';
  v_scanner constant uuid := '36450000-0000-4000-8000-000000000f03';
  v_evmgr   constant uuid := '36450000-0000-4000-8000-000000000f04';
  v_fin_oth constant uuid := '36450000-0000-4000-8000-000000000f05';
  v_removed constant uuid := '36450000-0000-4000-8000-000000000f06';
  v_stranger constant uuid := '36450000-0000-4000-8000-000000000f07';
  v_brand   constant uuid := '36450000-0000-4000-8000-000000000f08';
  v_brand2  constant uuid := '36450000-0000-4000-8000-000000000f09';
  v_now     constant timestamptz := '2027-09-01 12:00:00+00';
  v_sqlstate text;
  v_vis     jsonb;
  v_uid     uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES
    (v_owner), (v_other), (v_scanner), (v_evmgr), (v_fin_oth), (v_removed), (v_stranger);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'owner-3645-pr10adv@example.test'),
    (v_other, 'other-3645-pr10adv@example.test');

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency,
    payout_hold_cutover_at
  ) VALUES
    (v_brand, v_owner, 'PR10 Adv Brand', '3645-pr10-adv', 'NGN',
     'paystack', 'NG', 'NG', 'NGN', v_now - interval '60 days'),
    (v_brand2, v_other, 'PR10 Adv Other', '3645-pr10-adv2', 'NGN',
     'paystack', 'NG', 'NG', 'NGN', v_now - interval '60 days');

  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at)
  VALUES
    (v_brand, v_scanner, 'scanner', now(), now(), NULL),
    (v_brand, v_evmgr, 'event_manager', now(), now(), NULL),
    (v_brand2, v_fin_oth, 'finance_manager', now(), now(), NULL),
    (v_brand, v_removed, 'finance_manager', now() - interval '2 days',
     now() - interval '2 days', now() - interval '1 day');

  -- Each of these callers must be refused with 42501 on v_brand.
  FOREACH v_uid IN ARRAY ARRAY[v_stranger, v_scanner, v_evmgr, v_fin_oth, v_removed] LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    v_sqlstate := NULL;
    BEGIN
      PERFORM public.brand_get_payout_visibility(v_brand);
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    IF v_sqlstate IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'pr10adv: caller % was not refused with 42501 (got %)', v_uid, v_sqlstate;
    END IF;
  END LOOP;

  -- Unauthenticated (no sub) and NULL brand are refused.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.brand_get_payout_visibility(v_brand);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'pr10adv: unauthenticated call not refused (got %)', v_sqlstate;
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.brand_get_payout_visibility(NULL);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'pr10adv: NULL brand not refused (got %)', v_sqlstate;
  END IF;

  -- The owner of a brand with ZERO releases gets zeros (not an error) and the
  -- brand's default currency.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_vis := public.brand_get_payout_visibility(v_brand);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (v_vis->>'earned_cents')::bigint <> 0 OR (v_vis->>'on_its_way_cents')::bigint <> 0
     OR (v_vis->>'paid_cents')::bigint <> 0 THEN
    RAISE EXCEPTION 'pr10adv: empty brand should be all zeros (got %)', v_vis;
  END IF;
  IF jsonb_typeof(v_vis->'next_payout_at') <> 'null' THEN
    RAISE EXCEPTION 'pr10adv: empty brand next_payout_at should be null';
  END IF;
  IF v_vis->>'currency' <> 'ngn' THEN
    RAISE EXCEPTION 'pr10adv: empty brand currency should fall back to default (ngn), got %',
      v_vis->>'currency';
  END IF;

  -- authenticated can read neither the hold table nor the notice outboxes.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_sqlstate := NULL;
  BEGIN
    PERFORM 1 FROM public.brand_payout_pause_notices;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr10adv: authenticated could read brand_payout_pause_notices (got %)', v_sqlstate;
  END IF;
  v_sqlstate := NULL;
  BEGIN
    PERFORM 1 FROM public.brand_payout_outcome_notices;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr10adv: authenticated could read brand_payout_outcome_notices (got %)', v_sqlstate;
  END IF;
  v_sqlstate := NULL;
  BEGIN
    PERFORM 1 FROM public.brand_payout_admin_holds;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr10adv: authenticated could read brand_payout_admin_holds (got %)', v_sqlstate;
  END IF;
  -- ...and cannot call the sweep-side drain RPCs (pause + outcome).
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.claim_brand_payout_pause_notices(10);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr10adv: authenticated could call claim_brand_payout_pause_notices (got %)', v_sqlstate;
  END IF;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.complete_brand_payout_pause_notices(ARRAY[gen_random_uuid()]);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr10adv: authenticated could call complete_brand_payout_pause_notices (got %)', v_sqlstate;
  END IF;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.claim_brand_payout_outcome_notices(10);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'pr10adv: authenticated could call claim_brand_payout_outcome_notices (got %)', v_sqlstate;
  END IF;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.complete_brand_payout_outcome_notices(ARRAY[gen_random_uuid()]);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'pr10adv: authenticated could call complete_brand_payout_outcome_notices (got %)', v_sqlstate;
  END IF;

  -- anon has no EXECUTE on the organiser read.
  IF has_function_privilege('anon', 'public.brand_get_payout_visibility(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'pr10adv: anon can EXECUTE brand_get_payout_visibility';
  END IF;

  -- A notice for a vanished brand can never be delivered: complete() closes it.
  INSERT INTO public.brand_payout_pause_notices (brand_id, kind)
  VALUES (gen_random_uuid(), 'paused');
  PERFORM public.complete_brand_payout_pause_notices(ARRAY[]::uuid[]);
  IF EXISTS (
    SELECT 1 FROM public.brand_payout_pause_notices n
    WHERE n.notified_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = n.brand_id)
  ) THEN
    RAISE EXCEPTION 'pr10adv: orphan notice left open';
  END IF;

  RAISE NOTICE 'issue_3645_organiser_payout_visibility_tester_adversarial_pass';
END;
$test$;

ROLLBACK;
