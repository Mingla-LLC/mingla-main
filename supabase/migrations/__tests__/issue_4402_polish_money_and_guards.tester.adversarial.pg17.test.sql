\set ON_ERROR_STOP on

-- #4402 polish PR, TESTER adversarial suite (mingla-tester L3). Attacks M1, M2,
-- M3 and M5 from angles the implementor suites do not cover:
--   A. money: a double post_missed record, a replay with other amounts, the
--      branch closing after the refund, and no post_missed after release;
--   B. min fee: currency spelling edges, an offer that takes its fee from the
--      interest quote, and a counter opened before the minimum existed;
--   C. guards: a creator or host calling the Admin post review and pick
--      window RPCs, a host failing posts, a creator passing their own posts,
--      and the internal helpers/table closed to anon and authenticated;
--   D. timer clog: every path into posts_submitted (first submit, and a
--      resubmit after a failed review) leaves state_deadline_at NULL;
--   E. the M1 deadline backfill on a contract with NO hold (the production
--      shape of QA contract 5afe2353): it gets a deadline, the refund branch
--      opens and, since the #4402 P1-1 fix, gig_refund_claim cancels it with
--      no refund and no provider call (it used to say nothing_due forever).
-- Every fixture rolls back.
--
-- MINGLA-INVARIANT: I-4402-POST-5 | issue #4402 | a post_missed contract with nothing held ends cancelled with no provider call, never an endless 409 retry

BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

DO $test$
DECLARE
  v_host uuid := '44029900-0000-4000-8000-000000000001';
  v_creator uuid := '44029900-0000-4000-8000-000000000002';
  v_admin uuid := '44029900-0000-4000-8000-000000000003';
  v_brand uuid := '44029900-0000-4000-8000-000000000004';
  v_city uuid := '44029900-0000-4000-8000-000000000005';
  v_gigs uuid[] := '{}'; v_int uuid[] := '{}'; v_c uuid[] := '{}';
  v_answer jsonb; v_quote jsonb; v_total bigint; v_failed boolean; v_post uuid; v_state text;
  v_deadline timestamptz; v_prop uuid; v_err text; i integer;
BEGIN
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'creator_gigs_enabled';
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'i4402t-host@test.local'), (v_creator, 'i4402t-creator@test.local'), (v_admin, 'i4402t-admin@mingla.test');
  INSERT INTO public.admin_users(email, status) VALUES ('i4402t-admin@mingla.test', 'active');
  INSERT INTO public.creator_accounts(id, email, display_name) VALUES (v_host, 'i4402t-host@test.local', 'Tester Host');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, default_timezone)
  VALUES (v_brand, v_host, 'Issue 4402 Tester Host', 'issue-4402-tester-host', 'USD', 'Africa/Lagos');
  INSERT INTO public.seeding_cities(id, google_place_id, name, country, country_code, center_lat, center_lng,
    bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city, 'issue-4402-tester-city', 'Tester City', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5);
  INSERT INTO public.creator_profiles(creator_account_id, display_name, home_city_id, usage_ads_opt_in)
  VALUES (v_creator, 'Tester Creator', v_city, true);
  FOR i IN 1..7 LOOP
    v_gigs := v_gigs || ('44029900-0000-4000-8000-0000000000a' || i)::uuid;
    v_int := v_int || ('44029900-0000-4000-8000-0000000000b' || i)::uuid;
    INSERT INTO public.gigs(id, brand_id, listing_kind, listing_id, title_public, brief_public, format_key,
      deliverables, city_id, category, shoot_window_start, shoot_window_end, post_by, currency, status, created_by)
    VALUES (v_gigs[i], v_brand, 'event', gen_random_uuid(), 'Tester video ' || i,
      'Create a clear launch video showing the experience and its atmosphere.', 'behind_the_scenes',
      '[{"platform":"instagram","kind":"reel","count":1}]', v_city, 'nightlife',
      current_date + 2, current_date + 3, current_date + 7, 'USD', 'open', v_host);
  END LOOP;
  PERFORM pg_temp.act(v_creator);
  PERFORM public.creator_agreement_sign(DATE '1990-01-01');
  FOR i IN 1..7 LOOP
    -- Interest 7 quotes $9.99: below the USD minimum (B).
    INSERT INTO public.gig_interest(id, gig_id, creator_account_id, quoted_minor)
    VALUES (v_int[i], v_gigs[i], v_creator, CASE WHEN i = 7 THEN 999 ELSE 10000 END);
  END LOOP;
  PERFORM pg_temp.act(v_host);
  FOR i IN 1..6 LOOP
    v_answer := public.gig_offer_prepare(v_int[i], '{"fee_minor":10000,"rights_accepted":true}'::jsonb, 'i4402t-offer-' || i);
    IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'setup offer %: %', i, v_answer; END IF;
    v_c := v_c || (v_answer->>'contract_id')::uuid;
  END LOOP;
  v_total := (v_answer->>'total_minor')::bigint;
  PERFORM pg_temp.act(NULL);
  FOR i IN 1..5 LOOP
    PERFORM public.gig_hold_set_provider_ref(v_c[i], 1, 'gig_hold', 'pi_i4402t_' || i);
    PERFORM public.gig_hold_mark_captured(v_c[i], 1, 'pi_i4402t_' || i);
  END LOOP;

  -- ── B. Minimum fee edges ────────────────────────────────────────────────
  IF public.issue_4402_gig_fee_below_minimum(999, ' usd ', 'fee_minor') IS NULL
     OR public.issue_4402_gig_fee_below_minimum(999, ' usd ', 'fee_minor')->>'currency' <> 'USD' THEN
    RAISE EXCEPTION 'B lower-case/padded USD bypassed the minimum';
  END IF;
  IF public.issue_4402_gig_fee_below_minimum(1000, 'usd', 'fee_minor') IS NOT NULL THEN RAISE EXCEPTION 'B USD at the minimum refused'; END IF;
  IF public.issue_4402_gig_fee_below_minimum(499999, 'NGN', 'fee_minor') IS NULL THEN RAISE EXCEPTION 'B NGN 4,999.99 accepted'; END IF;
  IF public.issue_4402_gig_fee_below_minimum(999, 'eur', 'x') IS NULL OR public.issue_4402_gig_fee_below_minimum(999, 'GBP', 'x') IS NULL THEN
    RAISE EXCEPTION 'B EUR/GBP below minimum accepted';
  END IF;
  IF public.issue_4402_gig_fee_below_minimum(1, 'CAD', 'x') IS NOT NULL OR public.issue_4402_gig_fee_below_minimum(1, NULL, 'x') IS NOT NULL THEN
    RAISE EXCEPTION 'B OQ-7: a currency with no minimum was refused';
  END IF;
  -- An offer with no fee_minor takes the interest quote ($9.99): refused.
  PERFORM pg_temp.act(v_host);
  v_answer := public.gig_offer_prepare(v_int[7], '{"rights_accepted":true}'::jsonb, 'i4402t-offer-7');
  IF v_answer->>'error' IS DISTINCT FROM 'fee_below_minimum' OR v_answer->>'field' <> 'fee_minor' OR (v_answer->>'min_minor')::bigint <> 1000 THEN
    RAISE EXCEPTION 'B offer via interest quote bypassed the minimum: %', v_answer;
  END IF;
  IF EXISTS(SELECT 1 FROM public.gig_contracts WHERE gig_id = v_gigs[7]) THEN RAISE EXCEPTION 'B refused offer still created a contract'; END IF;
  -- A counter opened before the minimum existed cannot be accepted below it.
  INSERT INTO public.gig_change_proposals(contract_id, from_version, proposed_by, changes, reason)
  VALUES (v_c[5], 1, 'creator', '{"fee_minor":500}'::jsonb, 'price') RETURNING id INTO v_prop;
  v_answer := public.gig_counter_respond(v_prop, true);
  IF v_answer->>'error' IS DISTINCT FROM 'fee_below_minimum' THEN RAISE EXCEPTION 'B legacy counter accepted below minimum: %', v_answer; END IF;
  IF (SELECT current_terms_version FROM public.gig_contracts WHERE id = v_c[5]) <> 1 THEN RAISE EXCEPTION 'B refused counter changed the terms'; END IF;
  -- ...but the host can still decline it (the minimum never traps an old counter).
  v_answer := public.gig_counter_respond(v_prop, false);
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'B host could not decline a below-minimum counter: %', v_answer; END IF;
  -- A creator counter below the minimum is refused.
  PERFORM pg_temp.act(v_creator);
  v_answer := public.gig_counter_send(v_c[5], 999, NULL);
  IF v_answer->>'error' IS DISTINCT FROM 'fee_below_minimum' THEN RAISE EXCEPTION 'B counter below minimum: %', v_answer; END IF;

  -- ── C. Guards (SECURITY DEFINER holes) ──────────────────────────────────
  PERFORM public.issue_3872_contract_apply_state(v_c[2], 'posting', now() + interval '2 days', NULL, NULL, NULL);
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_posts_submit(v_c[2], '[{"platform":"instagram","url":"https://instagram.com/reel/i4402t2"}]'::jsonb);
  SELECT id INTO v_post FROM public.gig_posts WHERE contract_id = v_c[2];
  -- creator -> admin post review
  v_failed := false;
  BEGIN PERFORM public.admin_gig_post_decide(v_post, 'passed', NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'C a creator passed their own post through admin_gig_post_decide'; END IF;
  -- creator -> gig_transition posts_passed
  v_failed := false;
  BEGIN PERFORM public.gig_transition(v_c[2], 'posts_submitted', 'posts_passed', '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'C a creator moved their own contract to posts_verified'; END IF;
  -- creator -> admin pick window
  v_failed := false;
  BEGIN PERFORM public.admin_local_open_pick_window(gen_random_uuid(), 'Please let me pick', 7);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'C a creator reached admin_local_open_pick_window'; END IF;
  -- creator -> payee name review flag (service role only)
  v_failed := false;
  BEGIN PERFORM public.issue_4402_payee_name_review_set(v_creator, 'Tester Creator');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'C a creator cleared their own payout name flag'; END IF;
  -- host -> admin post review, and host -> posts_failed
  PERFORM pg_temp.act(v_host);
  v_failed := false;
  BEGIN PERFORM public.admin_gig_post_decide(v_post, 'failed', 'Missing the brand tag');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'C a host reached admin_gig_post_decide'; END IF;
  v_failed := false;
  BEGIN PERFORM public.gig_transition(v_c[2], 'posts_submitted', 'posts_failed', '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'C a host failed a creator''s posts directly'; END IF;
  v_failed := false;
  BEGIN PERFORM public.admin_local_open_pick_window(gen_random_uuid(), 'Host trying it', 7);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'C a host reached admin_local_open_pick_window'; END IF;
  PERFORM pg_temp.act(NULL);
  IF (SELECT check_status FROM public.gig_posts WHERE id = v_post) <> 'pending'
     OR (SELECT state FROM public.gig_contracts WHERE id = v_c[2]) <> 'posts_submitted' THEN
    RAISE EXCEPTION 'C a refused call changed the post or contract';
  END IF;
  -- Internal helpers and the override table are closed to app roles.
  IF has_function_privilege('authenticated', 'public.issue_4402_gig_post_check_apply(uuid,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4402_gig_post_check_apply(uuid,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.gig_post_check_record(uuid,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4402_payee_name_review_set(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4402_reopen_stuck_interest()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_gig_post_decide(uuid,text,text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.local_pick_window_overrides', 'SELECT')
     OR has_table_privilege('anon', 'public.local_pick_window_overrides', 'SELECT')
     OR has_table_privilege('authenticated', 'public.local_pick_window_overrides', 'INSERT') THEN
    RAISE EXCEPTION 'C an internal #4402 helper or the override table is open to anon/authenticated';
  END IF;

  -- ── D. Timer clog: posts_submitted never carries a deadline ──────────────
  PERFORM pg_temp.act(v_admin);
  v_answer := public.admin_gig_post_decide(v_post, 'failed', 'The post is missing @brand');
  SELECT state, state_deadline_at INTO v_state, v_deadline FROM public.gig_contracts WHERE id = v_c[2];
  IF v_state <> 'posts_failed' OR v_deadline < now() + interval '47 hours' THEN
    RAISE EXCEPTION 'D posts_failed deadline: % %', v_state, v_deadline;
  END IF;
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_posts_submit(v_c[2], '[{"platform":"instagram","url":"https://instagram.com/reel/i4402t2fixed"}]'::jsonb);
  IF (SELECT state_deadline_at FROM public.gig_contracts WHERE id = v_c[2]) IS NOT NULL THEN
    RAISE EXCEPTION 'D I-4402-POST-1: a resubmit carried the posts_failed deadline into posts_submitted';
  END IF;
  IF (SELECT count(*) FROM public.gig_posts WHERE contract_id = v_c[2] AND check_status = 'failed') <> 0 THEN
    RAISE EXCEPTION 'D A1: the failed link survived a resubmit';
  END IF;
  -- The fixed contract is in the Admin queue (the other half of I-4402-POST-2).
  PERFORM pg_temp.act(v_admin);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.admin_gig_queue()->'post_checks') r WHERE r->>'contract_id' = v_c[2]::text) THEN
    RAISE EXCEPTION 'D a posts_submitted contract has neither a deadline nor a queue row';
  END IF;
  PERFORM pg_temp.act(NULL);

  -- ── A. Money: post_missed is refunded exactly once ──────────────────────
  PERFORM public.issue_3872_contract_apply_state(v_c[1], 'approved', now() - interval '1 minute', NULL, NULL, NULL);
  IF NOT public.issue_3872_gig_refund_branch_allowed(v_c[1], 'post_missed') THEN RAISE EXCEPTION 'A post_missed not allowed after the deadline'; END IF;
  IF public.issue_3872_gig_refund_branch_allowed(v_c[1], 'host_after_accept_before_lock') THEN RAISE EXCEPTION 'A a host cancel branch opened on an approved video'; END IF;
  v_quote := public.gig_refund_quote(v_c[1], 'post_missed');
  IF (v_quote->>'refund_minor')::bigint <> v_total OR (v_quote->>'creator_fee_minor')::bigint <> 0 THEN
    RAISE EXCEPTION 'A OQ-2 quote is not a full refund: %', v_quote;
  END IF;
  v_answer := public.gig_refund_claim(v_c[1], 'post_missed');
  IF (v_answer->>'claimed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A first claim: %', v_answer; END IF;
  v_answer := public.gig_refund_claim(v_c[1], 'post_missed');
  IF (v_answer->>'claimed')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'A a second concurrent claim was granted: %', v_answer; END IF;
  v_answer := public.gig_refund_record(v_c[1], 'post_missed', v_total, 0, 're_i4402t_1');
  IF v_answer->>'state' <> 'cancelled' THEN RAISE EXCEPTION 'A record: %', v_answer; END IF;
  v_answer := public.gig_refund_record(v_c[1], 'post_missed', v_total, 0, 're_i4402t_1');
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A replay: %', v_answer; END IF;
  v_failed := false;
  BEGIN PERFORM public.gig_refund_record(v_c[1], 'post_missed', v_total * 2, 0, 're_i4402t_2');
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A a second post_missed with a larger amount was recorded'; END IF;
  v_failed := false;
  BEGIN PERFORM public.gig_refund_record(v_c[1], 'upload_missed', v_total, 0, 're_i4402t_3');
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A a different branch refunded the same hold again'; END IF;
  IF public.issue_3872_gig_refund_branch_allowed(v_c[1], 'post_missed') THEN RAISE EXCEPTION 'A post_missed still open after the refund'; END IF;
  IF (SELECT refunded_minor FROM public.gig_holds WHERE contract_id = v_c[1]) <> v_total
     OR (SELECT status FROM public.gig_holds WHERE contract_id = v_c[1]) <> 'refunded'
     OR (SELECT cancel_reason FROM public.gig_contracts WHERE id = v_c[1]) <> 'post_missed'
     OR (SELECT state_deadline_at FROM public.gig_contracts WHERE id = v_c[1]) IS NOT NULL THEN
    RAISE EXCEPTION 'A hold/contract after post_missed is wrong';
  END IF;
  IF (SELECT count(*) FROM public.gig_events WHERE contract_id = v_c[1] AND kind = 'refund_recorded') <> 1
     OR (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'business.gig.post_missed' AND payload->>'contract_id' = v_c[1]::text) <> 1
     OR (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'creator.gig.post_missed' AND payload->>'contract_id' = v_c[1]::text) <> 1 THEN
    RAISE EXCEPTION 'A not exactly one refund event and one notice each';
  END IF;
  IF EXISTS(SELECT 1 FROM public.payee_shares WHERE order_kind = 'gig' AND order_id = v_c[1]) THEN
    RAISE EXCEPTION 'A OQ-2: the creator got a share on a missed post';
  END IF;

  -- No post_missed once the money is released (or verified, or before the deadline).
  PERFORM public.issue_3872_contract_apply_state(v_c[3], 'released', now() - interval '1 minute', NULL, NULL, NULL);
  PERFORM public.issue_3872_contract_apply_state(v_c[4], 'posts_verified', now() - interval '1 minute', NULL, NULL, NULL);
  IF public.issue_3872_gig_refund_branch_allowed(v_c[3], 'post_missed') OR public.issue_3872_gig_refund_branch_allowed(v_c[4], 'post_missed') THEN
    RAISE EXCEPTION 'A post_missed opened after release or verification';
  END IF;
  PERFORM public.issue_3872_contract_apply_state(v_c[4], 'posting', now() + interval '1 hour', NULL, NULL, NULL);
  IF public.issue_3872_gig_refund_branch_allowed(v_c[4], 'post_missed') THEN RAISE EXCEPTION 'A post_missed opened before the deadline'; END IF;

  -- ── E. The M1 backfill on a contract with no hold (5afe2353's shape) ────
  DELETE FROM public.gig_holds WHERE contract_id = v_c[6];
  PERFORM public.issue_3872_contract_apply_state(v_c[6], 'approved', NULL, NULL, NULL, NULL);
  UPDATE public.gig_contracts c   -- the exact M1 backfill statement
     SET state_deadline_at = greatest(public.issue_4402_gig_post_deadline(c.id), now() + interval '72 hours')
   WHERE c.state IN ('approved','posting','posts_failed') AND c.state_deadline_at IS NULL;
  SELECT state_deadline_at INTO v_deadline FROM public.gig_contracts WHERE id = v_c[6];
  IF v_deadline IS NULL OR v_deadline < now() + interval '71 hours' THEN RAISE EXCEPTION 'E backfill deadline: %', v_deadline; END IF;
  IF (SELECT count(*) FROM public.gig_contracts WHERE id = ANY(v_c) AND state_deadline_at IS NULL AND state IN ('approved','posting','posts_failed')) <> 0 THEN
    RAISE EXCEPTION 'E backfill left a posting-state contract without a deadline';
  END IF;
  -- 72 h later: the branch opens and the timer calls gig-refund. #4402 fix
  -- (tester P1-1): with nothing held, gig_refund_claim closes the contract
  -- itself (cancelled, post_missed, no provider call) and answers
  -- 'completed', so gig-refund returns ok and the timer never retries it.
  PERFORM public.issue_3872_contract_apply_state(v_c[6], 'approved', now() - interval '1 minute', NULL, NULL, NULL);
  IF NOT public.issue_3872_gig_refund_branch_allowed(v_c[6], 'post_missed') THEN RAISE EXCEPTION 'E branch closed'; END IF;
  v_answer := public.gig_refund_claim(v_c[6], 'post_missed');
  IF v_answer->>'reason' IS DISTINCT FROM 'completed' OR (v_answer->>'closed_without_refund')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'E hold-less post_missed is not terminal: %', v_answer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_contracts WHERE id = v_c[6] AND state = 'cancelled' AND cancel_reason = 'post_missed' AND state_deadline_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.gig_events WHERE contract_id = v_c[6] AND kind = 'post_missed_closed' AND (data->>'refund_minor')::bigint = 0)
     OR EXISTS (SELECT 1 FROM public.gig_refund_claims WHERE contract_id = v_c[6]) THEN
    RAISE EXCEPTION 'E hold-less close: wrong end state';
  END IF;
  RAISE NOTICE 'E: a hold-less approved contract past its post deadline is cancelled with no refund (claim=%)', v_answer->>'reason';
END
$test$;

ROLLBACK;
