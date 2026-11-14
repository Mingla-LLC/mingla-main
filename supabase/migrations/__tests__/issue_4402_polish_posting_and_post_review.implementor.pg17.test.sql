\set ON_ERROR_STOP on

-- #4402 polish PR, migration M1 (20280704004402): posting deadline, Admin post
-- review, missed-post refund, re-offer after a cancelled offer, the new gig
-- notices and the Work card for a post waiting over 24 h. Every fixture
-- rolls back.
--
-- MINGLA-INVARIANT: I-4402-POST-1 | issue #4402 | a posts_submitted contract never has state_deadline_at (T-M1-b)
-- MINGLA-INVARIANT: I-4402-POST-2 | issue #4402 | approved/posting/posts_failed carry a post deadline and posts_submitted carries an Admin queue row (T-M1-a, T-M1-b)
-- MINGLA-INVARIANT: I-4402-POST-3 | issue #4402 | only an admin records a post review; a fail needs a 5-300 character reason (T-M1-a)

BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

-- OQ-10 fixture: production routes automatic cards to a fallback main task;
-- this suite gives the fallback a main task of its own.
DO $routes$
DECLARE v_id uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('44020100-0000-4000-afff-0000000000a1', 'route-owner.i4402p@test.local'),
    ('44020100-0000-4000-afff-0000000000a2', 'route-watch.i4402p@test.local') ON CONFLICT DO NOTHING;
  INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
    ('route-owner.i4402p@test.local', 'admin', 'active', now()), ('route-watch.i4402p@test.local', 'admin', 'active', now()) ON CONFLICT DO NOTHING;
  INSERT INTO public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by)
  VALUES ('I4402 main task for automatic cards', 'Where this suite''s automatic cards go.', 'Never closed.', current_date + 60, 'explicit',
          public.ops_sprint_ensure(current_date), 'system@usemingla.com', 'system@usemingla.com') RETURNING id INTO v_id;
  INSERT INTO public.ops_work_people (card_id, email, role, added_by) VALUES
    (v_id, 'route-owner.i4402p@test.local', 'owner', 'system@usemingla.com'), (v_id, 'route-watch.i4402p@test.local', 'watcher', 'system@usemingla.com');
  UPDATE public.ops_settings SET value = jsonb_build_object('routes', '{}'::jsonb, 'fallback', v_id) WHERE key = 'auto_card_routes';
END
$routes$;

DO $test$
DECLARE
  v_host uuid := '44020100-0000-4000-8000-000000000001';
  v_creator uuid := '44020100-0000-4000-8000-000000000002';
  v_admin uuid := '44020100-0000-4000-8000-000000000003';
  v_brand uuid := '44020100-0000-4000-8000-000000000004';
  v_city uuid := '44020100-0000-4000-8000-000000000005';
  v_gigs uuid[] := '{}'; v_int uuid[] := '{}'; v_c uuid[] := '{}';
  v_answer jsonb; v_failed boolean; v_total bigint; v_quote jsonb; v_post1 uuid; v_post2 uuid; v_deadline timestamptz;
  v_expected timestamptz; v_n integer; v_before integer; i integer; v_ws jsonb; v_body text;
BEGIN
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'creator_gigs_enabled';
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'i4402p-host@test.local'), (v_creator, 'i4402p-creator@test.local'), (v_admin, 'i4402p-admin@mingla.test');
  INSERT INTO public.admin_users(email, status) VALUES ('i4402p-admin@mingla.test', 'active');
  INSERT INTO public.creator_accounts(id, email, display_name) VALUES (v_host, 'i4402p-host@test.local', 'Polish Host');
  -- A venue-style gig (no event row): OQ-6, the brand's zone is the gig's zone.
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, default_timezone)
  VALUES (v_brand, v_host, 'Issue 4402 Polish Host', 'issue-4402-polish-host', 'USD', 'Africa/Lagos');
  INSERT INTO public.seeding_cities(id, google_place_id, name, country, country_code, center_lat, center_lng,
    bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city, 'issue-4402-polish-city', 'Polish City', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5);
  INSERT INTO public.creator_profiles(creator_account_id, display_name, home_city_id, usage_ads_opt_in)
  VALUES (v_creator, 'Polish Creator', v_city, true);
  FOR i IN 1..9 LOOP
    v_gigs := v_gigs || ('44020100-0000-4000-8000-0000000000a' || i)::uuid;
    v_int := v_int || ('44020100-0000-4000-8000-0000000000b' || i)::uuid;
    INSERT INTO public.gigs(id, brand_id, listing_kind, listing_id, title_public, brief_public, format_key,
      deliverables, city_id, category, shoot_window_start, shoot_window_end, post_by, currency, status, created_by)
    VALUES (v_gigs[i], v_brand, 'event', gen_random_uuid(), 'Polish video ' || i,
      'Create a clear launch video showing the experience and its atmosphere.', 'behind_the_scenes',
      '[{"platform":"instagram","kind":"reel","count":1}]', v_city, 'nightlife',
      current_date + 2, current_date + 3, current_date + 7, 'USD', 'open', v_host);
  END LOOP;
  PERFORM pg_temp.act(v_creator);
  PERFORM public.creator_agreement_sign(DATE '1990-01-01');
  FOR i IN 1..9 LOOP
    INSERT INTO public.gig_interest(id, gig_id, creator_account_id, quoted_minor) VALUES (v_int[i], v_gigs[i], v_creator, 10000);
  END LOOP;
  PERFORM pg_temp.act(v_host);
  FOR i IN 1..9 LOOP
    v_answer := public.gig_offer_prepare(v_int[i], '{"fee_minor":10000,"rights_accepted":true}'::jsonb, 'i4402p-offer-' || i);
    IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'offer %: %', i, v_answer; END IF;
    v_c := v_c || (v_answer->>'contract_id')::uuid;
  END LOOP;
  v_total := (v_answer->>'total_minor')::bigint;
  PERFORM pg_temp.act(NULL);
  FOR i IN 1..9 LOOP
    PERFORM public.gig_hold_set_provider_ref(v_c[i], 1, 'gig_hold', 'pi_i4402p_' || i);
    PERFORM public.gig_hold_mark_captured(v_c[i], 1, 'pi_i4402p_' || i);
  END LOOP;

  -- ── T-M1-b. Approving sets the post deadline in the gig's zone. ──────────
  -- post_by = current_date+7 -> end of that day in Lagos, plus 24 h grace.
  v_expected := ((current_date + 8)::timestamp AT TIME ZONE 'Africa/Lagos') + interval '24 hours';
  IF public.issue_3872_gig_timezone(v_gigs[1]) <> 'Africa/Lagos' THEN RAISE EXCEPTION 'OQ-6: venue gig zone is not the brand zone'; END IF;
  PERFORM public.issue_3872_contract_apply_state(v_c[1], 'delivered', now() + interval '3 days', NULL, NULL, NULL);
  PERFORM pg_temp.act(v_host);
  v_answer := public.gig_transition(v_c[1], 'delivered', 'approve', '{}'::jsonb);
  SELECT state_deadline_at INTO v_deadline FROM public.gig_contracts WHERE id = v_c[1];
  IF v_answer->>'state' <> 'approved' OR v_deadline IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'T-M1-b approve deadline: % (want %)', v_deadline, v_expected;
  END IF;
  -- T-M1-e. The creator hears the deadline in the gig zone, 11:59 PM style.
  SELECT payload->>'body' INTO v_body FROM public.notification_outbox
   WHERE category_key = 'creator.gig.video_approved' AND payload->>'contract_id' = v_c[1]::text;
  IF v_body IS NULL OR v_body NOT LIKE 'Post it by %11:59 PM Lagos time and add the links in Mingla.' THEN
    RAISE EXCEPTION 'T-M1-e approve notice: %', v_body;
  END IF;
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_transition(v_c[1], 'approved', 'start_posting', '{}'::jsonb);
  IF (SELECT state_deadline_at FROM public.gig_contracts WHERE id = v_c[1]) IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'T-M1-b posting keeps the post deadline';
  END IF;
  PERFORM public.gig_posts_submit(v_c[1], '[{"platform":"instagram","url":"https://instagram.com/reel/i4402a"},{"platform":"tiktok","url":"https://tiktok.com/@c/video/1"}]'::jsonb);
  IF (SELECT state FROM public.gig_contracts WHERE id = v_c[1]) <> 'posts_submitted'
     OR (SELECT state_deadline_at FROM public.gig_contracts WHERE id = v_c[1]) IS NOT NULL THEN
    RAISE EXCEPTION 'T-M1-b I-4402-POST-1: posts_submitted must have no deadline';
  END IF;
  IF (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'business.gig.posts_submitted' AND payload->>'contract_id' = v_c[1]::text) < 1 THEN
    RAISE EXCEPTION 'T-M1-e posts_submitted notice missing';
  END IF;
  SELECT id INTO v_post1 FROM public.gig_posts WHERE contract_id = v_c[1] AND platform = 'instagram';
  SELECT id INTO v_post2 FROM public.gig_posts WHERE contract_id = v_c[1] AND platform = 'tiktok';

  -- ── T-M1-a. Admin review. ─────────────────────────────────────────────────
  PERFORM pg_temp.act(v_admin);
  v_answer := public.admin_gig_queue();
  IF (SELECT count(*) FROM jsonb_array_elements(v_answer->'post_checks') e WHERE (e->>'contract_id')::uuid = v_c[1]) <> 2 THEN
    RAISE EXCEPTION 'T-M1-a queue post_checks: %', v_answer->'post_checks';
  END IF;
  PERFORM pg_temp.act(v_host);
  v_failed := false;
  BEGIN PERFORM public.admin_gig_post_decide(v_post1, 'passed', NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'T-M1-a a non-admin decided a post'; END IF;
  v_failed := false;
  BEGIN PERFORM public.admin_gig_queue();
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'T-M1-a a non-admin read the queue'; END IF;
  PERFORM pg_temp.act(v_admin);
  v_answer := public.admin_gig_post_decide(v_post2, 'failed', 'bad');
  IF v_answer->>'error' IS DISTINCT FROM 'reason_required' THEN RAISE EXCEPTION 'T-M1-a short reason: %', v_answer; END IF;
  v_answer := public.admin_gig_post_decide(v_post2, 'maybe', NULL);
  IF v_answer->>'error' IS DISTINCT FROM 'invalid_check_result' THEN RAISE EXCEPTION 'T-M1-a bad result: %', v_answer; END IF;
  v_answer := public.admin_gig_post_decide(v_post1, 'passed', NULL);
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true OR v_answer->>'state' <> 'posts_submitted' THEN RAISE EXCEPTION 'T-M1-a first pass: %', v_answer; END IF;
  v_answer := public.admin_gig_post_decide(v_post1, 'passed', NULL);
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M1-a replay: %', v_answer; END IF;
  IF (SELECT check_detail->>'method' FROM public.gig_posts WHERE id = v_post1) <> 'admin_review'
     OR (SELECT (check_detail->>'reviewed_by')::uuid FROM public.gig_posts WHERE id = v_post1) <> v_admin THEN
    RAISE EXCEPTION 'T-M1-a check_detail';
  END IF;
  v_answer := public.admin_gig_post_decide(v_post2, 'failed', 'The post is missing @polishhost.');
  SELECT state_deadline_at INTO v_deadline FROM public.gig_contracts WHERE id = v_c[1];
  IF v_answer->>'state' <> 'posts_failed' OR v_deadline < now() + interval '48 hours' THEN
    RAISE EXCEPTION 'T-M1-a/b fail -> posts_failed with >=48 h: % %', v_answer, v_deadline;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'creator.gig.posts_failed'
                  AND payload->>'contract_id' = v_c[1]::text AND payload->>'body' = 'One of your posts needs a fix: The post is missing @polishhost.') THEN
    RAISE EXCEPTION 'T-M1-e failed notice carries the reason';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_events WHERE contract_id = v_c[1] AND kind = 'post_reviewed' AND actor = 'admin' AND data->>'result' = 'failed') THEN
    RAISE EXCEPTION 'T-M1-a post_reviewed event';
  END IF;
  v_answer := public.admin_gig_post_decide(v_post1, 'failed', 'Changed my mind about this.');
  IF v_answer->>'error' IS DISTINCT FROM 'post_not_reviewable' THEN RAISE EXCEPTION 'T-M1-a not reviewable: %', v_answer; END IF;
  -- The creator fixes the post; a pass on every post verifies with 48 h to release.
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_posts_submit(v_c[1], '[{"platform":"tiktok","url":"https://tiktok.com/@c/video/1"}]'::jsonb);
  PERFORM pg_temp.act(v_admin);
  v_answer := public.admin_gig_post_decide(v_post2, 'passed', NULL);
  SELECT state_deadline_at INTO v_deadline FROM public.gig_contracts WHERE id = v_c[1];
  IF v_answer->>'state' <> 'posts_verified' OR v_deadline NOT BETWEEN now() + interval '47 hours' AND now() + interval '49 hours' THEN
    RAISE EXCEPTION 'T-M1-a all passed -> posts_verified + 48 h: % %', v_answer, v_deadline;
  END IF;

  -- ── T-M1-f. The service-role path still works. ───────────────────────────
  PERFORM pg_temp.act(NULL);
  PERFORM public.issue_3872_contract_apply_state(v_c[2], 'posts_submitted', NULL, NULL, NULL, NULL);
  INSERT INTO public.gig_posts(contract_id, platform, url) VALUES (v_c[2], 'instagram', 'https://instagram.com/reel/i4402f') RETURNING id INTO v_post1;
  v_answer := public.gig_post_check_record(v_post1, 'passed', '{}'::jsonb);
  IF (SELECT state FROM public.gig_contracts WHERE id = v_c[2]) <> 'posts_verified' THEN RAISE EXCEPTION 'T-M1-f service record: %', v_answer; END IF;
  PERFORM pg_temp.act(v_admin);
  v_failed := false;
  BEGIN PERFORM public.gig_post_check_record(v_post1, 'passed', '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'T-M1-f gig_post_check_record must stay service-role only'; END IF;
  IF has_function_privilege('authenticated', 'public.issue_4402_gig_post_check_apply(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-M1-f the internal apply is executable by authenticated';
  END IF;

  -- ── T-M1-c. post_missed refund. ──────────────────────────────────────────
  PERFORM pg_temp.act(NULL);
  PERFORM public.issue_3872_contract_apply_state(v_c[3], 'posting', now() + interval '2 hours', NULL, NULL, NULL);
  IF public.issue_3872_gig_refund_branch_allowed(v_c[3], 'post_missed') THEN RAISE EXCEPTION 'T-M1-c allowed before the deadline'; END IF;
  PERFORM public.issue_3872_contract_apply_state(v_c[3], 'posting', now() - interval '1 minute', NULL, NULL, NULL);
  PERFORM public.issue_3872_contract_apply_state(v_c[4], 'posts_submitted', NULL, NULL, NULL, NULL);
  UPDATE public.gig_contracts SET state_deadline_at = now() - interval '1 minute' WHERE id = v_c[4];
  IF public.issue_3872_gig_refund_branch_allowed(v_c[4], 'post_missed') THEN RAISE EXCEPTION 'T-M1-c allowed in posts_submitted'; END IF;
  IF NOT public.issue_3872_gig_refund_branch_allowed(v_c[3], 'post_missed') THEN RAISE EXCEPTION 'T-M1-c not allowed after the deadline'; END IF;
  v_quote := public.gig_refund_quote(v_c[3], 'post_missed');
  IF (v_quote->>'refund_minor')::bigint <> v_total OR (v_quote->>'creator_fee_minor')::bigint <> 0 THEN
    RAISE EXCEPTION 'T-M1-c OQ-2 full refund: % (total %)', v_quote, v_total;
  END IF;
  v_answer := public.gig_refund_record(v_c[3], 'post_missed', v_total, 0, 're_i4402p_3');
  IF v_answer->>'state' <> 'cancelled'
     OR NOT EXISTS (SELECT 1 FROM public.gig_contracts WHERE id = v_c[3] AND state = 'cancelled' AND cancel_reason = 'post_missed')
     OR NOT EXISTS (SELECT 1 FROM public.gig_holds WHERE contract_id = v_c[3] AND status = 'refunded') THEN
    RAISE EXCEPTION 'T-M1-c record: %', v_answer;
  END IF;
  v_answer := public.gig_refund_record(v_c[3], 'post_missed', v_total, 0, 're_i4402p_3');
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M1-c replay: %', v_answer; END IF;
  IF (SELECT count(*) FROM public.gig_events WHERE contract_id = v_c[3] AND kind = 'refund_recorded') <> 1 THEN RAISE EXCEPTION 'T-M1-c one claim'; END IF;
  IF (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'creator.gig.post_missed' AND payload->>'contract_id' = v_c[3]::text) <> 1
     OR (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'business.gig.post_missed' AND payload->>'contract_id' = v_c[3]::text) < 1 THEN
    RAISE EXCEPTION 'T-M1-e post_missed notices';
  END IF;
  PERFORM pg_temp.act(v_host);
  v_ws := public.gig_contract_workspace(v_c[3]);
  IF (v_ws->>'refunded_minor')::bigint <> v_total OR v_ws->>'timezone' <> 'Africa/Lagos' OR v_ws->'format_structure' IS NULL THEN
    RAISE EXCEPTION 'workspace fields: refunded % tz % structure %', v_ws->'refunded_minor', v_ws->'timezone', v_ws->'format_structure';
  END IF;

  -- ── T-M1-d. Re-offer after a cancel before acceptance. ───────────────────
  PERFORM pg_temp.act(NULL);
  v_quote := public.gig_refund_quote(v_c[5], 'host_before_accept');
  PERFORM public.gig_refund_record(v_c[5], 'host_before_accept', (v_quote->>'refund_minor')::bigint, (v_quote->>'creator_fee_minor')::bigint, 're_i4402p_5');
  IF (SELECT status FROM public.gig_interest WHERE id = v_int[5]) <> 'shortlisted' THEN RAISE EXCEPTION 'T-M1-d host cancel did not reopen'; END IF;
  IF (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'creator.gig.offer_cancelled' AND payload->>'contract_id' = v_c[5]::text) <> 1 THEN
    RAISE EXCEPTION 'T-M1-e offer_cancelled notice';
  END IF;
  PERFORM pg_temp.act(v_host);
  v_answer := public.gig_offer_prepare(v_int[5], '{"fee_minor":10000,"rights_accepted":true}'::jsonb, 'i4402p-reoffer-5');
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M1-d re-offer refused: %', v_answer; END IF;
  -- #4430 Q1 (Seth, 14 Nov): a creator decline now reopens too, so the host
  -- may offer the same creator again.
  PERFORM pg_temp.act(NULL);
  v_quote := public.gig_refund_quote(v_c[6], 'creator_decline');
  PERFORM public.gig_refund_record(v_c[6], 'creator_decline', (v_quote->>'refund_minor')::bigint, (v_quote->>'creator_fee_minor')::bigint, 're_i4402p_6');
  IF (SELECT status FROM public.gig_interest WHERE id = v_int[6]) <> 'shortlisted' THEN RAISE EXCEPTION 'T-M1-d creator decline did not reopen (#4430 Q1)'; END IF;
  -- The backfill reopens a stuck row (the production dcf7f167 shape) and only that.
  PERFORM public.issue_3872_contract_apply_state(v_c[7], 'cancelled', NULL, NULL, NULL, 'host_before_accept');
  IF public.issue_4402_reopen_stuck_interest() <> 1 THEN RAISE EXCEPTION 'T-M1-d backfill count'; END IF;
  IF (SELECT status FROM public.gig_interest WHERE id = v_int[7]) <> 'shortlisted'
     OR (SELECT status FROM public.gig_interest WHERE id = v_int[6]) <> 'shortlisted' THEN
    RAISE EXCEPTION 'T-M1-d backfill touched the wrong rows';
  END IF;

  -- ── T-M1-e. Shoot confirmed tells the party that did not confirm. ────────
  PERFORM public.issue_3872_contract_apply_state(v_c[8], 'accepted', NULL, NULL, NULL, NULL);
  INSERT INTO public.gig_shoot_plans(contract_id, shoot_at, proposed_by, proposal_count, confirmed_at, confirmed_by)
  VALUES (v_c[8], ((current_date + 2)::timestamp + time '18:00') AT TIME ZONE 'Africa/Lagos', 'creator', 1, now(), 'host');
  PERFORM pg_temp.act(v_host);
  PERFORM public.gig_transition(v_c[8], 'accepted', 'plan_confirmed', '{}'::jsonb);
  SELECT payload->>'body' INTO v_body FROM public.notification_outbox WHERE category_key = 'creator.gig.shoot_confirmed' AND payload->>'contract_id' = v_c[8]::text;
  IF v_body IS NULL OR v_body NOT LIKE '%6:00 PM Lagos time. Open the gig for the details.' THEN RAISE EXCEPTION 'T-M1-e shoot notice: %', v_body; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'business.gig.shoot_confirmed' AND payload->>'contract_id' = v_c[8]::text) THEN
    RAISE EXCEPTION 'T-M1-e the confirming host was told too';
  END IF;

  -- ── T-M1-e. Post reminder: once, in the 24 h before the deadline. ────────
  PERFORM pg_temp.act(NULL);
  PERFORM public.issue_3872_contract_apply_state(v_c[9], 'approved', now() + interval '30 hours', NULL, NULL, NULL);
  PERFORM public.gig_notification_tick(now());
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'creator.gig.post_reminder' AND payload->>'contract_id' = v_c[9]::text) THEN
    RAISE EXCEPTION 'T-M1-e reminder fired before the 24 h window';
  END IF;
  PERFORM public.gig_notification_tick(now() + interval '7 hours');
  SELECT count(*) INTO v_before FROM public.notification_outbox WHERE category_key = 'business.gig.post_due_soon' AND payload->>'contract_id' = v_c[9]::text;
  PERFORM public.gig_notification_tick(now() + interval '8 hours');
  SELECT count(*) INTO v_n FROM public.notification_outbox WHERE category_key = 'creator.gig.post_reminder' AND payload->>'contract_id' = v_c[9]::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'T-M1-e reminder count %', v_n; END IF;
  IF (SELECT payload->>'title' FROM public.notification_outbox WHERE category_key = 'creator.gig.post_reminder' AND payload->>'contract_id' = v_c[9]::text) NOT LIKE 'Post your video by %Lagos time' THEN
    RAISE EXCEPTION 'T-M1-e reminder title';
  END IF;
  IF (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'business.gig.post_due_soon' AND payload->>'contract_id' = v_c[9]::text) <> v_before THEN
    RAISE EXCEPTION 'T-M1-e host due-soon notice repeated';
  END IF;

  -- ── OQ-10. A post waiting over 24 h opens one Work card; a pass closes it. ─
  PERFORM public.issue_3872_contract_apply_state(v_c[4], 'posts_submitted', NULL, NULL, NULL, NULL);
  INSERT INTO public.gig_posts(contract_id, platform, url, submitted_at) VALUES (v_c[4], 'instagram', 'https://instagram.com/reel/i4402w', now() - interval '25 hours')
  RETURNING id INTO v_post1;
  v_answer := public.gig_notification_tick(now());
  PERFORM public.gig_notification_tick(now());
  IF (SELECT count(*) FROM public.ops_work_cards WHERE auto_key = 'gig_post_review:' || v_c[4]::text AND status <> 'done') <> 1 THEN
    RAISE EXCEPTION 'OQ-10 Work card: % (route alarms: %)', v_answer,
      (SELECT count(*) FROM public.ops_work_cards WHERE auto_key LIKE 'route_missing:%');
  END IF;
  PERFORM pg_temp.act(v_admin);
  PERFORM public.admin_gig_post_decide(v_post1, 'passed', NULL);
  IF EXISTS (SELECT 1 FROM public.ops_work_cards WHERE auto_key = 'gig_post_review:' || v_c[4]::text AND status <> 'done') THEN
    RAISE EXCEPTION 'OQ-10 the Work card did not close after the review';
  END IF;
END;
$test$;

ROLLBACK;
\echo 'issue #4402 polish M1 (posting deadline, post review, post_missed, re-offer, notices) passed'
