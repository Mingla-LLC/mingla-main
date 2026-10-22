\set ON_ERROR_STOP on

-- Issue #3645 payout-screen read model — adversarial boundary/security proof.

BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '3645f200-0000-4000-8000-000000000001';
  v_other constant uuid := '3645f200-0000-4000-8000-000000000002';
  v_brand constant uuid := '3645f200-0000-4000-8000-000000000003';
  v_due constant timestamptz := '2027-12-20 10:00:00+00';
  v_error text;
  v_refused boolean := false;
BEGIN
  IF public.payout_screen_host_state('pending', NULL, v_due, false, v_due + interval '7 hours 59 minutes 59 seconds') <> 'sending_today'
     OR public.payout_screen_host_state('pending', NULL, v_due, false, v_due + interval '8 hours') <> 'late_on_us'
     OR public.payout_screen_host_state('released', NULL, v_due, true, v_due + interval '3 days') <> 'paid'
     OR public.payout_screen_host_state('in_flight', NULL, v_due, true, v_due + interval '3 days') <> 'on_its_way'
     OR public.payout_screen_host_state('pending', 'waiting_for_bank', v_due, false, v_due) <> 'waiting_for_bank'
     OR public.payout_screen_host_state('blocked_kyc', NULL, v_due, false, v_due) <> 'needs_you'
     OR public.payout_screen_host_state('blocked_kyc', 'external account missing', v_due, false, v_due) <> 'needs_you'
     OR public.payout_screen_host_state('blocked_balance', 'bank balance short', v_due, false, v_due + interval '8 hours') <> 'late_on_us'
     OR public.payout_screen_host_state('failed', NULL, v_due, false, v_due) <> 'couldnt_send'
     OR public.payout_screen_host_state('pending', NULL, v_due, true, v_due) <> 'paused' THEN
    RAISE EXCEPTION 'host payout state boundary or priority regressed';
  END IF;

  IF has_function_privilege('anon', 'public.brand_get_payout_screen(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_list_payouts(text,text,uuid,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.payout_screen_host_state(text,text,timestamptz,boolean,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'payout screen helper/RPC execute privileges are too broad';
  END IF;

  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'issue-3645-adversarial-owner@example.test'),
    (v_other, 'issue-3645-adversarial-other@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'issue-3645-adversarial-owner@example.test'),
    (v_other, 'issue-3645-adversarial-other@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_owner, 'Issue 3645 adversarial', 'issue-3645-payout-adversarial', 'USD');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  BEGIN
    PERFORM public.brand_get_payout_screen(v_brand);
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := true;
  WHEN others THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error LIKE '%insufficient_finance_permission%' THEN
      v_refused := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_refused THEN
    RESET ROLE;
    RAISE EXCEPTION 'unrelated authenticated user read another brand payout screen';
  END IF;

  v_refused := false;
  BEGIN
    PERFORM public.admin_list_payouts(NULL, NULL, NULL, 25, 0);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error LIKE '%not_authorized%' THEN v_refused := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF NOT v_refused THEN
    RAISE EXCEPTION 'non-admin read the unified admin payout console';
  END IF;

  RAISE NOTICE 'issue_3645_payout_screen_reads_adversarial_pass';
END;
$test$;

ROLLBACK;
