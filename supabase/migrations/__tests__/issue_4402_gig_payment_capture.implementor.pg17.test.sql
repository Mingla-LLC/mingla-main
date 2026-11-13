\set ON_ERROR_STOP on

-- #4402 — creator-hire payments are always recorded; a paid hold is never
-- retired as unpaid; a late payment on a retired offer is refunded in full.
-- Every fixture rolls back.
--
-- MINGLA-INVARIANT: I-4402-C | issue #4402 | no code path retires a pending gig hold to failed without a provider check proving it unpaid
-- I-4402-D (capture checks the ledger row) is declared in the Deno capture-core suite.

BEGIN;

DO $test$
DECLARE
  v_host uuid := '44020000-0000-4000-8000-000000000001';
  v_creator uuid := '44020000-0000-4000-8000-000000000002';
  v_brand uuid := '44020000-0000-4000-8000-000000000003';
  v_city uuid := '44020000-0000-4000-8000-000000000004';
  v_gigs uuid[] := ARRAY[
    '44020000-0000-4000-8000-0000000000a1'::uuid, '44020000-0000-4000-8000-0000000000a2'::uuid,
    '44020000-0000-4000-8000-0000000000a3'::uuid, '44020000-0000-4000-8000-0000000000a4'::uuid,
    '44020000-0000-4000-8000-0000000000a5'::uuid];
  v_interests uuid[] := ARRAY[
    '44020000-0000-4000-8000-0000000000b1'::uuid, '44020000-0000-4000-8000-0000000000b2'::uuid,
    '44020000-0000-4000-8000-0000000000b3'::uuid, '44020000-0000-4000-8000-0000000000b4'::uuid,
    '44020000-0000-4000-8000-0000000000b5'::uuid];
  v_contracts uuid[] := '{}';
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid;
  v_answer jsonb; v_failed boolean; v_total bigint; v_quote jsonb; v_fn text; i integer; v_claim uuid;
BEGIN
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'creator_gigs_enabled';
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'issue-4402-host@test.local'), (v_creator, 'issue-4402-creator@test.local');
  INSERT INTO public.creator_accounts(id, email, display_name) VALUES
    (v_host, 'issue-4402-host@test.local', 'Capture Host');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_host, 'Issue 4402 Capture Host', 'issue-4402-capture-host', 'USD');
  INSERT INTO public.seeding_cities(id, google_place_id, name, country, country_code, center_lat, center_lng,
    bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city, 'issue-4402-city', 'Capture City', 'United States', 'US', 35.7, -78.6, 35.6, -78.7, 35.8, -78.5);
  INSERT INTO public.creator_profiles(creator_account_id, display_name, home_city_id, usage_ads_opt_in)
  VALUES (v_creator, 'Capture Creator', v_city, true);
  FOR i IN 1..5 LOOP
    INSERT INTO public.gigs(id, brand_id, listing_kind, listing_id, title_public, brief_public, format_key,
      deliverables, city_id, category, shoot_window_start, shoot_window_end, post_by, currency, status, created_by)
    VALUES (v_gigs[i], v_brand, 'event', gen_random_uuid(), 'Capture video ' || i,
      'Create a clear launch video showing the experience and its atmosphere.', 'behind_the_scenes',
      '[{"platform":"instagram","kind":"reel","count":1}]', v_city, 'nightlife',
      current_date + 2, current_date + 3, current_date + 7, 'USD', 'open', v_host);
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', v_creator::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  PERFORM public.creator_agreement_sign(DATE '1990-01-01');
  FOR i IN 1..5 LOOP
    INSERT INTO public.gig_interest(id, gig_id, creator_account_id, quoted_minor)
    VALUES (v_interests[i], v_gigs[i], v_creator, 10000);
  END LOOP;

  -- 6. The prepare answer carries brand_id (the server builds the return URL).
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  FOR i IN 1..5 LOOP
    v_answer := public.gig_offer_prepare(v_interests[i], '{"fee_minor":10000,"rights_accepted":true}'::jsonb, '4402-offer-' || i);
    IF (v_answer->>'ok')::boolean IS DISTINCT FROM true OR (v_answer->>'brand_id')::uuid IS DISTINCT FROM v_brand THEN
      RAISE EXCEPTION '#4402 prepare answer must carry brand_id: %', v_answer;
    END IF;
    v_contracts := v_contracts || (v_answer->>'contract_id')::uuid;
  END LOOP;
  v_a := v_contracts[1]; v_b := v_contracts[2]; v_c := v_contracts[3]; v_d := v_contracts[4]; v_e := v_contracts[5];
  v_total := (v_answer->>'total_minor')::bigint;

  -- Service role from here on.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- 1. The provider reference is stored once; a different one is refused.
  v_answer := public.gig_hold_set_provider_ref(v_a, 1, 'gig_hold', 'pi_4402_a');
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'set_provider_ref first write: %', v_answer; END IF;
  v_answer := public.gig_hold_set_provider_ref(v_a, 1, 'gig_hold', 'pi_4402_a');
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'set_provider_ref replay: %', v_answer; END IF;
  v_failed := false;
  BEGIN PERFORM public.gig_hold_set_provider_ref(v_a, 1, 'gig_hold', 'pi_4402_other');
  EXCEPTION WHEN others THEN v_failed := SQLERRM = 'hold_provider_mismatch'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'set_provider_ref accepted a second reference'; END IF;

  -- 2. A pending hold with a stored reference refuses a capture under another
  --    reference (the old body overwrote it).
  v_failed := false;
  BEGIN PERFORM public.gig_hold_mark_captured(v_a, 1, 'pi_4402_other');
  EXCEPTION WHEN others THEN v_failed := SQLERRM = 'hold_provider_mismatch'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#4402 a pending hold was captured under a different reference'; END IF;
  v_answer := public.gig_hold_mark_captured(v_a, 1, 'pi_4402_a');
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM false OR (v_answer->>'late_capture')::boolean IS DISTINCT FROM false
     OR v_answer->>'status' <> 'captured' THEN
    RAISE EXCEPTION 'capture: %', v_answer;
  END IF;
  v_answer := public.gig_hold_mark_captured(v_a, 1, 'pi_4402_a');
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'capture twice must replay: %', v_answer; END IF;
  v_failed := false;
  BEGIN PERFORM public.gig_hold_mark_captured(v_a, 1, 'pi_4402_third');
  EXCEPTION WHEN others THEN v_failed := SQLERRM = 'hold_provider_mismatch'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'captured hold accepted a different reference'; END IF;

  -- 4. The sweep retires only contracts passed in as proven unpaid.
  UPDATE public.gig_contracts SET state_deadline_at = now() - interval '1 hour' WHERE id IN (v_b, v_c, v_d);
  v_answer := public.gig_pending_offer_sweep(now(), ARRAY[v_b, v_d]);
  IF (v_answer->>'retired')::integer <> 2 THEN RAISE EXCEPTION 'sweep retired: %', v_answer; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_contracts WHERE id = v_c AND state = 'offered')
     OR NOT EXISTS (SELECT 1 FROM public.gig_holds WHERE contract_id = v_c AND status = 'pending') THEN
    RAISE EXCEPTION '#4402 the sweep retired a contract that was not proven unpaid';
  END IF;
  v_answer := public.gig_pending_offer_sweep(now(), NULL);
  IF (v_answer->>'retired')::integer <> 0 THEN RAISE EXCEPTION 'a sweep with no proven ids retired something: %', v_answer; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_interest WHERE id = v_interests[4] AND status = 'shortlisted') THEN
    RAISE EXCEPTION 'a proven-unpaid retire must let the host offer again';
  END IF;
  IF to_regprocedure('public.gig_pending_offer_sweep(timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION '#4402 the unproven one-argument sweep still exists';
  END IF;
  -- The deadline candidates list the unpaid offer for the provider check.
  v_answer := public.gig_pending_offer_candidates(now());
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_answer) e WHERE (e->>'contract_id')::uuid = v_c) THEN
    RAISE EXCEPTION 'pending offer candidates missing C: %', v_answer;
  END IF;

  -- 5. Reconcile candidates: a pending hold (Paystack reference derived) and a
  --    retired hold.
  UPDATE public.gig_holds SET rail = 'paystack', currency = 'NGN' WHERE contract_id = v_c;
  v_answer := public.gig_payment_reconcile_candidates(interval '0 seconds', 100);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_answer->'candidates') e
                  WHERE (e->>'contract_id')::uuid = v_c AND e->>'reason' = 'pending' AND e->>'kind' = 'gig_hold'
                    AND e->>'reference' = 'ghold_' || replace(v_c::text, '-', '') || '_v1') THEN
    RAISE EXCEPTION 'reconcile candidates missing the pending Paystack hold: %', v_answer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_answer->'candidates') e
                  WHERE (e->>'contract_id')::uuid = v_b AND e->>'reason' = 'retired') THEN
    RAISE EXCEPTION 'reconcile candidates missing the retired hold: %', v_answer;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_answer->'candidates') e WHERE (e->>'contract_id')::uuid = v_a) THEN
    RAISE EXCEPTION 'a captured live hold is not a reconcile candidate: %', v_answer;
  END IF;

  -- F2: a checked row goes behind never-checked rows (no starvation), and a
  -- row proven unpaid long enough becomes terminal and is never probed again.
  v_answer := public.gig_payment_check_record(v_c, 'gig_hold', 1, 'pending', 'ongoing');
  IF (v_answer->>'terminal')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'a pending check made a row terminal: %', v_answer; END IF;
  v_answer := public.gig_payment_reconcile_candidates(interval '0 seconds', 1);
  IF jsonb_array_length(v_answer->'candidates') <> 1
     OR (v_answer->'candidates'->0->>'contract_id')::uuid = v_c THEN
    RAISE EXCEPTION '#4402 a recently checked row starved a never-checked one: %', v_answer;
  END IF;
  v_answer := public.gig_payment_check_record(v_c, 'gig_hold', 1, 'not_paid', 'abandoned', interval '1 day');
  IF (v_answer->>'terminal')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'a fresh not-paid row became terminal: %', v_answer; END IF;
  v_answer := public.gig_payment_check_record(v_c, 'gig_hold', 1, 'not_paid', 'abandoned', interval '0 seconds');
  IF (v_answer->>'terminal')::boolean IS DISTINCT FROM true OR (v_answer->>'checks')::integer <> 3 THEN
    RAISE EXCEPTION 'an old not-paid row must become terminal: %', v_answer;
  END IF;
  v_answer := public.gig_payment_reconcile_candidates(interval '0 seconds', 100);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_answer->'candidates') e WHERE (e->>'contract_id')::uuid = v_c) THEN
    RAISE EXCEPTION '#4402 a terminal row is still re-checked: %', v_answer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_payment_checks WHERE contract_id = v_c AND terminal_proof->>'provider_status' = 'abandoned') THEN
    RAISE EXCEPTION 'terminal rows must keep the provider proof';
  END IF;

  -- 3. A payment that lands after the offer was retired is recorded for refund.
  v_answer := public.gig_hold_mark_captured(v_b, 1, 'pi_4402_b');
  IF (v_answer->>'late_capture')::boolean IS DISTINCT FROM true OR v_answer->>'status' <> 'captured' THEN
    RAISE EXCEPTION '#4402 late payment on a retired offer was not recorded: %', v_answer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_events WHERE contract_id = v_b AND kind = 'late_capture_refund_due') THEN
    RAISE EXCEPTION 'late capture wrote no late_capture_refund_due event';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gig_events WHERE contract_id = v_b AND kind = 'hold_captured') THEN
    RAISE EXCEPTION 'late capture must not announce the offer to the creator';
  END IF;
  v_answer := public.gig_hold_mark_captured(v_b, 1, 'pi_4402_b');
  -- F3: only the first recorder asks for the refund; a replay says retired.
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM true OR (v_answer->>'late_capture')::boolean IS DISTINCT FROM false
     OR (v_answer->>'retired')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '#4402 a late capture replay asked for a second refund: %', v_answer;
  END IF;
  -- F3: the host's cancel cannot refund an offer retired as unpaid.
  IF public.issue_3872_gig_refund_branch_allowed(v_b, 'host_before_accept') THEN
    RAISE EXCEPTION '#4402 host_before_accept is open on a retired offer';
  END IF;
  v_answer := public.gig_payment_reconcile_candidates(interval '0 seconds', 100);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_answer->'candidates') e
                  WHERE (e->>'contract_id')::uuid = v_b AND e->>'reason' = 'refund_due' AND e->>'reference' = 'pi_4402_b') THEN
    RAISE EXCEPTION 'reconcile candidates missing the refund-due late payment: %', v_answer;
  END IF;

  -- F3: one refund claim per hold. A second recorder is in flight; a failure
  -- backs off; a retaken claim counts attempts; the last attempt gives up and
  -- leaves the reconcile set.
  v_answer := public.gig_refund_claim(v_b, 'payment_late');
  IF (v_answer->>'claimed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'first claim: %', v_answer; END IF;
  v_claim := (v_answer->>'claim_id')::uuid;
  v_answer := public.gig_refund_claim(v_b, 'payment_late');
  IF (v_answer->>'claimed')::boolean IS DISTINCT FROM false OR v_answer->>'reason' <> 'in_flight' THEN
    RAISE EXCEPTION '#4402 two refunds were claimed for one hold: %', v_answer;
  END IF;
  v_answer := public.gig_refund_claim(v_b, 'host_before_accept');
  IF (v_answer->>'claimed')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '#4402 a second branch claimed the same hold: %', v_answer;
  END IF;
  v_answer := public.gig_refund_claim_finish(v_claim, false, NULL, 'paystack 502', 2);
  IF v_answer->>'status' <> 'failed' OR (v_answer->>'next_attempt_at')::timestamptz <= now() THEN
    RAISE EXCEPTION 'a failed refund must back off: %', v_answer;
  END IF;
  v_answer := public.gig_refund_claim(v_b, 'payment_late');
  IF v_answer->>'reason' <> 'backoff' THEN RAISE EXCEPTION 'claim inside the backoff: %', v_answer; END IF;
  UPDATE public.gig_refund_claims SET next_attempt_at = now() - interval '1 second' WHERE id = v_claim;
  v_answer := public.gig_refund_claim(v_b, 'payment_late');
  IF (v_answer->>'claimed')::boolean IS DISTINCT FROM true OR (v_answer->>'attempt')::integer <> 2 THEN
    RAISE EXCEPTION 'retaking a claim after its backoff: %', v_answer;
  END IF;
  v_answer := public.gig_refund_claim_finish(v_claim, false, NULL, 'paystack 502', 2);
  IF v_answer->>'status' <> 'gave_up' THEN RAISE EXCEPTION 'the last attempt must give up: %', v_answer; END IF;
  v_answer := public.gig_payment_reconcile_candidates(interval '0 seconds', 100);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_answer->'candidates') e
              WHERE (e->>'contract_id')::uuid = v_b AND e->>'reason' = 'refund_due') THEN
    RAISE EXCEPTION 'a given-up refund is still retried: %', v_answer;
  END IF;
  -- A completed claim is a replay, never a second provider refund.
  v_answer := public.gig_refund_claim(v_e, 'host_before_accept');
  IF (v_answer->>'claimed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'claim e: %', v_answer; END IF;
  PERFORM public.gig_refund_claim_finish((v_answer->>'claim_id')::uuid, true, 're_4402_e');
  v_answer := public.gig_refund_claim(v_e, 'host_before_accept');
  IF v_answer->>'reason' <> 'completed' OR v_answer->>'provider_ref' <> 're_4402_e' THEN
    RAISE EXCEPTION 'a completed refund must replay: %', v_answer;
  END IF;

  -- The payment_late refund is a full refund and keeps the offer retired.
  v_quote := public.gig_refund_quote(v_b, 'payment_late');
  IF (v_quote->>'refund_minor')::bigint <> v_total OR (v_quote->>'creator_fee_minor')::bigint <> 0 THEN
    RAISE EXCEPTION 'payment_late must refund the full total: %', v_quote;
  END IF;
  v_failed := false;
  BEGIN PERFORM public.gig_refund_record(v_b, 'payment_late', v_total - 1, 0, 're_4402_b');
  EXCEPTION WHEN others THEN v_failed := SQLERRM = 'refund_amount_mismatch'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'payment_late accepted a short refund'; END IF;
  v_answer := public.gig_refund_record(v_b, 'payment_late', v_total, 0, 're_4402_b');
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'payment_late record: %', v_answer; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_contracts WHERE id = v_b AND state = 'cancelled' AND cancel_reason = 'payment_not_completed')
     OR NOT EXISTS (SELECT 1 FROM public.gig_holds WHERE contract_id = v_b AND status = 'refunded' AND refunded_minor = v_total) THEN
    RAISE EXCEPTION 'payment_late must refund the hold and leave the retired contract hidden';
  END IF;
  v_answer := public.gig_refund_record(v_b, 'payment_late', v_total, 0, 're_4402_b');
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'payment_late replay: %', v_answer; END IF;
  v_answer := public.gig_payment_reconcile_candidates(interval '0 seconds', 100);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_answer->'candidates') e WHERE (e->>'contract_id')::uuid = v_b) THEN
    RAISE EXCEPTION 'a refunded late payment is still a candidate: %', v_answer;
  END IF;
  -- payment_late is machine-only: the user refund path rejects it.
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  v_failed := false;
  BEGIN PERFORM public.gig_refund_authorize(v_d, 'payment_late');
  EXCEPTION WHEN others THEN v_failed := SQLERRM = 'invalid_refund_branch'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a host could ask for a payment_late refund'; END IF;
  v_failed := false;
  BEGIN PERFORM public.gig_hold_mark_captured(v_c, 1, 'pi_4402_user');
  EXCEPTION WHEN others THEN v_failed := SQLERRM = 'service_role_only'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a signed-in user could capture a hold'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- A failed hold under any other cancel reason still refuses capture.
  PERFORM public.issue_3872_contract_apply_state(v_e, 'cancelled', NULL, NULL, NULL, 'host_before_accept');
  UPDATE public.gig_holds SET status = 'failed' WHERE contract_id = v_e;
  v_failed := false;
  BEGIN PERFORM public.gig_hold_mark_captured(v_e, 1, 'pi_4402_e');
  EXCEPTION WHEN others THEN v_failed := SQLERRM = 'hold_not_pending'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a failed hold under another cancel reason was captured'; END IF;

  -- F1 (tester repro): a signed-in host calling gig_offer_prepare directly on
  -- an unpaid offer must not retire it; only the proven service path can.
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  v_answer := public.gig_offer_prepare(v_interests[3], '{"fee_minor":10000,"rights_accepted":true}'::jsonb, '4402-offer-direct-retry');
  IF v_answer->>'error' IS DISTINCT FROM 'payment_unverified' OR (v_answer->>'contract_id')::uuid IS DISTINCT FROM v_c THEN
    RAISE EXCEPTION '#4402 F1 a direct prepare was not refused: %', v_answer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_holds WHERE contract_id = v_c AND status = 'pending')
     OR NOT EXISTS (SELECT 1 FROM public.gig_contracts WHERE id = v_c AND state = 'offered') THEN
    RAISE EXCEPTION '#4402 F1 a direct prepare retired an unproven hold';
  END IF;
  v_failed := false;
  BEGIN PERFORM public.gig_offer_retire_unpaid(v_c, '{"provider_status":"not_found"}'::jsonb);
  EXCEPTION WHEN others THEN v_failed := SQLERRM = 'service_role_only'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#4402 F1 a host could retire an offer'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  v_failed := false;
  BEGIN PERFORM public.gig_offer_retire_unpaid(v_c, '{}'::jsonb);
  EXCEPTION WHEN others THEN v_failed := SQLERRM = 'provider_proof_required'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#4402 F1 retire without provider proof'; END IF;
  v_answer := public.gig_offer_retire_unpaid(v_c, '{"provider_status":"not_found","source":"test"}'::jsonb);
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'proven retire: %', v_answer; END IF;
  IF (public.gig_offer_retire_unpaid(v_a, '{"provider_status":"not_found"}'::jsonb)->>'error') IS DISTINCT FROM 'not_retirable' THEN
    RAISE EXCEPTION '#4402 F1 a captured offer was retirable';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  v_answer := public.gig_offer_prepare(v_interests[3], '{"fee_minor":10000,"rights_accepted":true}'::jsonb, '4402-offer-after-proof');
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'retry after a proven retire: %', v_answer; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- Every new or replaced money function refuses anon and authenticated.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.gig_hold_set_provider_ref(uuid,integer,text,text)',
    'public.gig_hold_mark_captured(uuid,integer,text)',
    'public.gig_topup_mark_captured(uuid,integer,text)',
    'public.gig_refund_record(uuid,text,bigint,bigint,text)',
    'public.issue_4402_gig_refund_record_impl(uuid,text,bigint,bigint,text)',
    'public.gig_pending_offer_sweep(timestamptz,uuid[])',
    'public.gig_pending_offer_candidates(timestamptz)',
    'public.gig_payment_reconcile_candidates(interval,integer)',
    'public.gig_payment_check_record(uuid,text,integer,text,text,interval)',
    'public.gig_refund_claim(uuid,text)',
    'public.gig_refund_claim_finish(uuid,boolean,text,text,integer)',
    'public.gig_offer_retire_unpaid(uuid,jsonb)'] LOOP
    IF has_function_privilege('anon', v_fn, 'execute') OR has_function_privilege('authenticated', v_fn, 'execute') THEN
      RAISE EXCEPTION '#4402 % is executable by a client role', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'execute') THEN
      RAISE EXCEPTION '#4402 % is not executable by service_role', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.gig_offer_prepare(uuid,jsonb,text)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.gig_offer_prepare(uuid,jsonb,text)', 'execute') THEN
    RAISE EXCEPTION 'gig_offer_prepare grants changed';
  END IF;
  RAISE NOTICE '#4402 gig payment capture: all assertions passed';
END;
$test$;

ROLLBACK;
