\set ON_ERROR_STOP on

-- #4402 polish PR, migration M5 (20280704404402), spec amendment A1 + A2:
--   A1  a failed post fixed with a NEW link can pass review (posts_verified);
--   A2  a payout account name with no word in common with the creator's
--       names is flagged for Admin review (OQ-5 / E21), never blocking payouts.
-- Every fixture rolls back.
--
-- MINGLA-INVARIANT: I-4402-POST-4 | issue #4402 | a resubmitted platform never keeps an earlier failed link that would block posts_verified
-- MINGLA-INVARIANT: I-4402-PAYEE-NAME-1 | issue #4402 | a bank account name with no word in common with the creator's names is flagged for Admin review and never blocks a payout

BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

DO $test$
DECLARE
  v_host uuid := '44020600-0000-4000-8000-000000000001';
  v_creator uuid := '44020600-0000-4000-8000-000000000002';
  v_admin uuid := '44020600-0000-4000-8000-000000000003';
  v_brand uuid := '44020600-0000-4000-8000-000000000004';
  v_city uuid := '44020600-0000-4000-8000-000000000005';
  v_gigs uuid[] := '{}'; v_int uuid[] := '{}'; v_c uuid[] := '{}';
  v_answer jsonb; v_failed boolean; v_total bigint; v_quote jsonb; v_post1 uuid; v_post2 uuid; v_deadline timestamptz;
  v_expected timestamptz; v_n integer; v_before integer; i integer; v_ws jsonb; v_body text;
BEGIN
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'creator_gigs_enabled';
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'i4402r-host@test.local'), (v_creator, 'i4402r-creator@test.local'), (v_admin, 'i4402r-admin@mingla.test');
  INSERT INTO public.admin_users(email, status) VALUES ('i4402r-admin@mingla.test', 'active');
  INSERT INTO public.creator_accounts(id, email, display_name) VALUES (v_host, 'i4402r-host@test.local', 'Polish Host');
  -- A venue-style gig (no event row): OQ-6, the brand's zone is the gig's zone.
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, default_timezone)
  VALUES (v_brand, v_host, 'Issue 4402 Polish Host', 'issue-4402-resubmit-host', 'USD', 'Africa/Lagos');
  INSERT INTO public.seeding_cities(id, google_place_id, name, country, country_code, center_lat, center_lng,
    bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city, 'issue-4402-resubmit-city', 'Resubmit City', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5);
  INSERT INTO public.creator_profiles(creator_account_id, display_name, home_city_id, usage_ads_opt_in)
  VALUES (v_creator, 'Polish Creator', v_city, true);
  FOR i IN 1..1 LOOP
    v_gigs := v_gigs || ('44020600-0000-4000-8000-0000000000a' || i)::uuid;
    v_int := v_int || ('44020600-0000-4000-8000-0000000000b' || i)::uuid;
    INSERT INTO public.gigs(id, brand_id, listing_kind, listing_id, title_public, brief_public, format_key,
      deliverables, city_id, category, shoot_window_start, shoot_window_end, post_by, currency, status, created_by)
    VALUES (v_gigs[i], v_brand, 'event', gen_random_uuid(), 'Polish video ' || i,
      'Create a clear launch video showing the experience and its atmosphere.', 'behind_the_scenes',
      '[{"platform":"instagram","kind":"reel","count":1}]', v_city, 'nightlife',
      current_date + 2, current_date + 3, current_date + 7, 'USD', 'open', v_host);
  END LOOP;
  PERFORM pg_temp.act(v_creator);
  PERFORM public.creator_agreement_sign(DATE '1990-01-01');
  FOR i IN 1..1 LOOP
    INSERT INTO public.gig_interest(id, gig_id, creator_account_id, quoted_minor) VALUES (v_int[i], v_gigs[i], v_creator, 10000);
  END LOOP;
  PERFORM pg_temp.act(v_host);
  FOR i IN 1..1 LOOP
    v_answer := public.gig_offer_prepare(v_int[i], '{"fee_minor":10000,"rights_accepted":true}'::jsonb, 'i4402r-offer-' || i);
    IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'offer %: %', i, v_answer; END IF;
    v_c := v_c || (v_answer->>'contract_id')::uuid;
  END LOOP;
  v_total := (v_answer->>'total_minor')::bigint;
  PERFORM pg_temp.act(NULL);
  FOR i IN 1..1 LOOP
    PERFORM public.gig_hold_set_provider_ref(v_c[i], 1, 'gig_hold', 'pi_i4402r_' || i);
    PERFORM public.gig_hold_mark_captured(v_c[i], 1, 'pi_i4402r_' || i);
  END LOOP;

  -- ── A1. Fail, resubmit with a NEW link, pass -> posts_verified. ─────────
  PERFORM public.issue_3872_contract_apply_state(v_c[1], 'posting', now() + interval '3 days', NULL, NULL, NULL);
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_posts_submit(v_c[1], '[{"platform":"instagram","url":"https://instagram.com/reel/i4402r-ok"},{"platform":"tiktok","url":"https://tiktok.com/@c/video/old"}]'::jsonb);
  SELECT id INTO v_post1 FROM public.gig_posts WHERE contract_id = v_c[1] AND platform = 'instagram';
  SELECT id INTO v_post2 FROM public.gig_posts WHERE contract_id = v_c[1] AND platform = 'tiktok';
  PERFORM pg_temp.act(v_admin);
  PERFORM public.admin_gig_post_decide(v_post1, 'passed', NULL);
  v_answer := public.admin_gig_post_decide(v_post2, 'failed', 'The video was posted without @resubmithost.');
  IF v_answer->>'state' <> 'posts_failed' THEN RAISE EXCEPTION 'A1 fail: %', v_answer; END IF;
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_posts_submit(v_c[1], '[{"platform":"tiktok","url":"https://tiktok.com/@c/video/new"}]'::jsonb);
  IF EXISTS (SELECT 1 FROM public.gig_posts WHERE id = v_post2) THEN RAISE EXCEPTION 'A1 the failed link was not retired'; END IF;
  IF (SELECT check_status FROM public.gig_posts WHERE id = v_post1) <> 'passed' THEN RAISE EXCEPTION 'A1 a passed link on another platform was touched'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_events WHERE contract_id = v_c[1] AND kind = 'post_reviewed' AND (data->>'post_id')::uuid = v_post2) THEN
    RAISE EXCEPTION 'A1 the review history was lost';
  END IF;
  SELECT id INTO v_post2 FROM public.gig_posts WHERE contract_id = v_c[1] AND platform = 'tiktok';
  PERFORM pg_temp.act(v_admin);
  v_answer := public.admin_gig_post_decide(v_post2, 'passed', NULL);
  IF v_answer->>'state' <> 'posts_verified' THEN RAISE EXCEPTION 'A1 the fixed post did not verify: %', v_answer; END IF;

  -- ── A2. Payout account name check (OQ-5 / E21). ─────────────────────────
  PERFORM pg_temp.act(NULL);
  INSERT INTO public.payee_accounts(user_id, paystack_recipient_code, paystack_status, paystack_currency)
  VALUES (v_creator, 'RCP_i4402r', 'verified', 'NGN')
  ON CONFLICT (user_id) DO UPDATE SET paystack_recipient_code = 'RCP_i4402r', paystack_status = 'verified';
  -- Shares the word "creator" (case and punctuation ignored): no flag.
  v_answer := public.issue_4402_payee_name_review_set(v_creator, 'POLISH-CREATOR LTD');
  IF (v_answer->>'name_review_required')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'A2 matching name flagged: %', v_answer; END IF;
  -- No word in common: flagged, with a reason; payouts stay connected.
  v_answer := public.issue_4402_payee_name_review_set(v_creator, 'JOHN DOE ENTERPRISES');
  IF (SELECT name_review_required FROM public.payee_accounts WHERE user_id = v_creator) IS NOT TRUE
     OR (SELECT name_review_reason FROM public.payee_accounts WHERE user_id = v_creator) IS NULL
     OR (SELECT paystack_status FROM public.payee_accounts WHERE user_id = v_creator) <> 'verified' THEN
    RAISE EXCEPTION 'A2 mismatch not flagged: %', v_answer;
  END IF;
  PERFORM pg_temp.act(v_admin);
  SELECT q INTO v_ws FROM jsonb_array_elements(public.admin_creator_queue('all')) q WHERE (q->>'creator_id')::uuid = v_creator;
  IF (v_ws->'payout_name_review'->>'required')::boolean IS NOT TRUE OR NOT (v_ws->'flags' ? 'payout_name_review') THEN
    RAISE EXCEPTION 'A2 Admin queue: %', v_ws;
  END IF;
  PERFORM pg_temp.act(v_creator);
  IF (public.issue_3872_my_earnings_summary()->'payoutAccount'->'paystack'->>'nameReviewRequired')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'A2 Explorer payout read: %', public.issue_3872_my_earnings_summary()->'payoutAccount';
  END IF;
  v_failed := false;
  BEGIN PERFORM public.issue_4402_payee_name_review_set(v_creator, 'Anything');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A2 a signed-in user set their own review flag'; END IF;
END;
$test$;

ROLLBACK;
\echo 'issue #4402 polish M5 (post resubmit, payee name review) passed'
