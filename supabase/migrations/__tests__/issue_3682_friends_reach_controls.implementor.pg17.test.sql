-- #3682 closeout wave 3 — Explorer Friends of followers controls, leaving a
-- brand's circle, and admin weekly blasts counted per campaign group.
-- Runs on the fully applied migration chain.
--
-- MINGLA-INVARIANT: I-3682-FRIENDS-REACH-OPT-IN | issue #3682 | Nobody is reached as a friend of a follower unless they switched it on from a build whose controls switch is live; leaving a brand's circle sticks until the guest follows again or allows it.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('36829500-0000-4000-8000-000000000001', 'owner-3682f@example.test'),
  ('36829500-0000-4000-8000-000000000002', 'guest-3682f@example.test'),
  ('36829500-0000-4000-8000-000000000003', 'admin-3682f@mingla-fixture.org');
INSERT INTO public.creator_accounts(id, email)
VALUES ('36829500-0000-4000-8000-000000000001', 'owner-3682f@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('36829500-0000-4000-8000-000000000010', '36829500-0000-4000-8000-000000000001',
  'Reach Brand', 'issue-3682-reach-brand', 'USD', now(), now());
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
VALUES ('36829500-0000-4000-8000-000000000002', 'Gia', 'Gia', 'reach-3682-gia', true, true, 'friends');
INSERT INTO public.admin_users(email, role, status)
VALUES ('admin-3682f@mingla-fixture.org', 'admin', 'active');

UPDATE public.feature_flags SET is_enabled = false
 WHERE flag_key IN ('brand_circle_extended_controls_ios_v1', 'brand_circle_extended_controls_android_v1');

SELECT set_config('request.jwt.claim.sub', '36829500-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"36829500-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- F-01 Default off; the dark build reads controlsLive=false and cannot write.
DO $f1$
DECLARE v jsonb;
BEGIN
  v := public.issue_3682_explorer_friends_reach_v1('ios');
  IF (v ->> 'controlsLive')::boolean OR (v ->> 'extendedEnabled')::boolean
     OR jsonb_array_length(v -> 'exits') <> 0 THEN
    RAISE EXCEPTION 'F-01 FAIL: default read %', v;
  END IF;
  BEGIN
    PERFORM public.issue_3682_set_friends_reach_v1('ios', true);
    RAISE EXCEPTION 'F-01 FAIL: write allowed while controls are off';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.brand_circle_preferences
              WHERE user_id = '36829500-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'F-01 FAIL: a refused write left a preference row';
  END IF;
END;
$f1$;

-- F-02 Per-platform: iOS live does not make Android live; on/off stamps a decision.
UPDATE public.feature_flags SET is_enabled = true
 WHERE flag_key = 'brand_circle_extended_controls_ios_v1';
DO $f2$
DECLARE v jsonb;
BEGIN
  IF (public.issue_3682_explorer_friends_reach_v1('android') ->> 'controlsLive')::boolean THEN
    RAISE EXCEPTION 'F-02 FAIL: Android live from the iOS switch';
  END IF;
  BEGIN
    PERFORM public.issue_3682_set_friends_reach_v1('android', true);
    RAISE EXCEPTION 'F-02 FAIL: Android write allowed';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  v := public.issue_3682_set_friends_reach_v1('ios', true);
  IF NOT (v ->> 'extendedEnabled')::boolean OR v ->> 'decidedAt' IS NULL
     OR NOT (v ->> 'controlsLive')::boolean THEN
    RAISE EXCEPTION 'F-02 FAIL: opt-in %', v;
  END IF;
  v := public.issue_3682_set_friends_reach_v1('ios', false);
  IF (v ->> 'extendedEnabled')::boolean OR v ->> 'decidedAt' IS NULL THEN
    RAISE EXCEPTION 'F-02 FAIL: opt-out %', v;
  END IF;
END;
$f2$;

-- F-03 "Unfollow and stop invites through friends": follow row gone, exit
-- row with both stamps, listed for undo with name/slug only.
INSERT INTO public.brand_follows(user_id, brand_id, source)
VALUES ('36829500-0000-4000-8000-000000000002', '36829500-0000-4000-8000-000000000010', 'brand_page');
DO $f3$
DECLARE v jsonb; r jsonb;
BEGIN
  r := public.issue_3682_set_brand_circle_exit_v1('36829500-0000-4000-8000-000000000010', true, true);
  IF (r ->> 'following')::boolean OR NOT (r ->> 'stopped')::boolean THEN
    RAISE EXCEPTION 'F-03 FAIL: result %', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_circle_exits
                  WHERE brand_id = '36829500-0000-4000-8000-000000000010'
                    AND user_id = '36829500-0000-4000-8000-000000000002'
                    AND visibility_exited_at IS NOT NULL AND delivery_exited_at IS NOT NULL) THEN
    RAISE EXCEPTION 'F-03 FAIL: exit row missing';
  END IF;
  v := public.issue_3682_explorer_friends_reach_v1('ios');
  IF jsonb_array_length(v -> 'exits') <> 1
     OR v -> 'exits' -> 0 ->> 'brandSlug' <> 'issue-3682-reach-brand'
     OR v -> 'exits' -> 0 ->> 'exitedAt' IS NULL THEN
    RAISE EXCEPTION 'F-03 FAIL: exits list %', v;
  END IF;
END;
$f3$;

-- F-04 An automatic follow never re-adds a guest who left; an explicit
-- follow clears the exit.
DO $f4$
BEGIN
  INSERT INTO public.brand_follows(user_id, brand_id, source)
  VALUES ('36829500-0000-4000-8000-000000000002', '36829500-0000-4000-8000-000000000010', 'purchase')
  ON CONFLICT ON CONSTRAINT brand_follows_user_brand_key DO NOTHING;
  IF EXISTS (SELECT 1 FROM public.brand_follows
              WHERE user_id = '36829500-0000-4000-8000-000000000002'
                AND brand_id = '36829500-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'F-04 FAIL: a purchase re-followed a guest who left the circle';
  END IF;
  INSERT INTO public.brand_follows(user_id, brand_id, source)
  VALUES ('36829500-0000-4000-8000-000000000002', '36829500-0000-4000-8000-000000000010', 'brand_page');
  IF EXISTS (SELECT 1 FROM public.brand_circle_exits
              WHERE brand_id = '36829500-0000-4000-8000-000000000010'
                AND user_id = '36829500-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'F-04 FAIL: following again left the guest unreachable';
  END IF;
END;
$f4$;

-- F-05 Stop without unfollowing (non-follower path), then Allow again.
DELETE FROM public.brand_follows WHERE user_id = '36829500-0000-4000-8000-000000000002';
DO $f5$
DECLARE r jsonb;
BEGIN
  PERFORM public.issue_3682_set_brand_circle_exit_v1('36829500-0000-4000-8000-000000000010', true, false);
  r := public.issue_3682_set_brand_circle_exit_v1('36829500-0000-4000-8000-000000000010', false, false);
  IF (r ->> 'stopped')::boolean OR EXISTS (SELECT 1 FROM public.brand_circle_exits
              WHERE user_id = '36829500-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'F-05 FAIL: allow again %', r;
  END IF;
END;
$f5$;

-- F-06 Signed-out callers are refused; anon has no EXECUTE.
DO $f6$
BEGIN
  IF has_function_privilege('anon', 'public.issue_3682_set_brand_circle_exit_v1(uuid, boolean, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3682_set_friends_reach_v1(text, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3682_friends_reach_controls_live(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F-06 FAIL: grants too wide';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.issue_3682_explorer_friends_reach_v1('ios');
    RAISE EXCEPTION 'F-06 FAIL: signed-out read allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$f6$;

-- F-07 Admin weekly blasts count one multi-channel campaign once.
INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated)
VALUES ('36829500-2000-4000-8000-000000000001', '36829500-0000-4000-8000-000000000001',
  '36829500-0000-4000-8000-000000000010', 'Followers',
  jsonb_build_object('kind', 'brand_followers', 'brand_id', '36829500-0000-4000-8000-000000000010'), true);
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
VALUES ('36829500-3000-4000-8000-000000000001', '36829500-0000-4000-8000-000000000001',
  '36829500-0000-4000-8000-000000000010', '36829500-2000-4000-8000-000000000001', 'Email part', 'email',
  '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}', 'draft');
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
VALUES ('36829500-3000-4000-8000-000000000002', '36829500-0000-4000-8000-000000000001',
  '36829500-0000-4000-8000-000000000010', '36829500-2000-4000-8000-000000000001', 'Push part', 'push',
  '{"kind":"push","body":"Doors at 9."}', 'draft', '36829500-3000-4000-8000-000000000001');
INSERT INTO public.marketing_book_send_executions(
  brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
  selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
  estimated_cost_minor, currency, cost_kind, quoted_at, scheduled_for, send_mode)
SELECT '36829500-0000-4000-8000-000000000010', c, '36829500-0000-4000-8000-000000000001',
  gen_random_uuid(), 1, repeat('f', 64), repeat('f', 64), 1, 1, 0, 0, 0, NULL, NULL,
  'not_metered', now(), now(), 'now'
FROM unnest(ARRAY['36829500-3000-4000-8000-000000000001',
                  '36829500-3000-4000-8000-000000000002']::uuid[]) c;
SELECT set_config('request.jwt.claim.sub', '36829500-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"36829500-0000-4000-8000-000000000003","role":"authenticated"}', true);
DO $f7$
DECLARE v jsonb; row jsonb;
BEGIN
  v := public.admin_messaging_limits_overview();
  SELECT b INTO row FROM jsonb_array_elements(v -> 'brands') b
   WHERE b ->> 'brand_id' = '36829500-0000-4000-8000-000000000010';
  IF row IS NULL OR (row ->> 'blasts_this_week')::int <> 1
     OR (row ->> 'email_used')::int <> 1 OR (row ->> 'push_used')::int <> 1 THEN
    RAISE EXCEPTION 'F-07 FAIL: admin usage %', row;
  END IF;
END;
$f7$;

ROLLBACK;
