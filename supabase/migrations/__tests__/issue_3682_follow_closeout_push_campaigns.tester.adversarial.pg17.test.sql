-- MINGLA-INVARIANT: I-3682-EXTENDED-SWITCH-AT-SEND | issue #3682 | No push or account invite reaches a friend of a follower while any of the three extended switches is off, including sends confirmed before the switch went off.
-- #3682 closeout — TESTER adversarial suite (push campaigns, Friends of
-- followers kill switches, campaign groups, brand isolation).
-- Different angles from the implementor suite:
--   T3-01  push to Friends of followers is refused by the SERVER at quote and
--          at confirm while ANY one of the three extended switches is off.
--   T3-02  switching any extended switch off AFTER confirm (scheduled send)
--          stops the push to friends of followers at send time; followers in
--          the same brand are unaffected.
--   T3-03  account invites to friends of followers obey the same kill switch
--          at dispatch time.
--   T3-04  a campaign group cannot be borrowed from another brand or author,
--          and cannot be changed afterwards.
--   T3-05  one campaign on push + email + SMS is one blast in both the Host
--          usage and the admin overview; a second campaign makes two.
--   T3-06  one brand can never read another brand's push recipients: no table
--          access, no worklist access, and a foreign actor id is refused.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('brand_circle_followers_v1', 'brand_circle_extended_v1',
  'brand_circle_extended_controls_ios_v1', 'brand_circle_extended_controls_android_v1',
  'business_wizard_invite_selection_v1', 'business_wizard_invite_dispatch_v1',
  'contact_import_v1', 'brand_book_blast_v1');

CREATE TABLE IF NOT EXISTS auth.identities(
  user_id uuid NOT NULL, provider text NOT NULL, identity_data jsonb NOT NULL,
  provider_id text NOT NULL);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

-- 01 owner C, 02 owner D, 03 admin, 11 follower R, 12 friend X (opted in),
-- 13 follower S.
INSERT INTO auth.users(id, email) VALUES
  ('3682c300-0000-4000-8000-000000000001', 'owner-c-3682t3@example.test'),
  ('3682c300-0000-4000-8000-000000000002', 'owner-d-3682t3@example.test'),
  ('3682c300-0000-4000-8000-000000000003', 'admin-3682t3@mingla-fixture.org'),
  ('3682c300-0000-4000-8000-000000000011', NULL),
  ('3682c300-0000-4000-8000-000000000012', NULL),
  ('3682c300-0000-4000-8000-000000000013', NULL);
INSERT INTO auth.identities(user_id, provider, identity_data, provider_id) VALUES
  ('3682c300-0000-4000-8000-000000000012', 'email', '{"email":"friend-x@leak.example.test"}',
   '3682c300-0000-4000-8000-000000000012');
INSERT INTO public.admin_users(email, role, status)
VALUES ('admin-3682t3@mingla-fixture.org', 'admin', 'active');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('3682c300-0000-4000-8000-000000000001', 'owner-c-3682t3@example.test'),
  ('3682c300-0000-4000-8000-000000000002', 'owner-d-3682t3@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('3682c300-0000-4000-8000-0000000000c0', '3682c300-0000-4000-8000-000000000001',
   'T3 Brand C', 'issue-3682-t3-c', 'USD', now(), now()),
  ('3682c300-0000-4000-8000-0000000000d0', '3682c300-0000-4000-8000-000000000002',
   'T3 Brand D', 'issue-3682-t3-d', 'USD', now(), now());
INSERT INTO public.profiles(id, first_name, last_name, display_name, username, active,
  has_completed_onboarding, visibility_mode) VALUES
  ('3682c300-0000-4000-8000-000000000011', 'Root', 'R', 'Root R', 't3-3682-r', true, true, 'friends'),
  ('3682c300-0000-4000-8000-000000000012', 'Friend', 'X', 'Friend X', 't3-3682-x', true, true, 'friends'),
  ('3682c300-0000-4000-8000-000000000013', 'Second', 'S', 'Second S', 't3-3682-s', true, true, 'friends');
INSERT INTO public.brand_follows(user_id, brand_id) VALUES
  ('3682c300-0000-4000-8000-000000000011', '3682c300-0000-4000-8000-0000000000c0'),
  ('3682c300-0000-4000-8000-000000000013', '3682c300-0000-4000-8000-0000000000c0');
INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
  ('3682c300-0000-4000-8000-000000000011', '3682c300-0000-4000-8000-000000000012', 'accepted');
INSERT INTO public.brand_circle_preferences(user_id, extended_brand_reach_enabled, extended_brand_reach_decided_at)
VALUES ('3682c300-0000-4000-8000-000000000012', true, now());

INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated) VALUES
  ('3682c300-2000-4000-8000-000000000001', '3682c300-0000-4000-8000-000000000001',
   '3682c300-0000-4000-8000-0000000000c0', 'Friends of followers',
   jsonb_build_object('kind', 'brand_circle_extended', 'brand_id', '3682c300-0000-4000-8000-0000000000c0'), true),
  ('3682c300-2000-4000-8000-000000000002', '3682c300-0000-4000-8000-000000000001',
   '3682c300-0000-4000-8000-0000000000c0', 'Followers',
   jsonb_build_object('kind', 'brand_followers', 'brand_id', '3682c300-0000-4000-8000-0000000000c0'), true),
  ('3682c300-2000-4000-8000-000000000003', '3682c300-0000-4000-8000-000000000002',
   '3682c300-0000-4000-8000-0000000000d0', 'Followers D',
   jsonb_build_object('kind', 'brand_followers', 'brand_id', '3682c300-0000-4000-8000-0000000000d0'), true);
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status) VALUES
  ('3682c300-3000-4000-8000-000000000001', '3682c300-0000-4000-8000-000000000001',
   '3682c300-0000-4000-8000-0000000000c0', '3682c300-2000-4000-8000-000000000001', 'Friends push', 'push',
   '{"kind":"push","body":"Friends night is on."}', 'draft'),
  ('3682c300-3000-4000-8000-000000000002', '3682c300-0000-4000-8000-000000000001',
   '3682c300-0000-4000-8000-0000000000c0', '3682c300-2000-4000-8000-000000000002', 'Followers push', 'push',
   '{"kind":"push","body":"Followers night is on."}', 'draft'),
  ('3682c300-3000-4000-8000-0000000000d1', '3682c300-0000-4000-8000-000000000002',
   '3682c300-0000-4000-8000-0000000000d0', '3682c300-2000-4000-8000-000000000003', 'D email', 'email',
   '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}', 'draft');

CREATE OR REPLACE FUNCTION pg_temp.t3_snapshot(p_campaign uuid, p_quote jsonb, p_req uuid)
RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object(
    'quoteVersion', 1, 'quoteHash', repeat('c', 64), 'contentHash', repeat('c', 64),
    'quotedAt', now(), 'brandId', p_quote ->> 'brandId',
    'content', p_quote -> 'content', 'audienceId', p_quote ->> 'audienceId',
    'audienceKind', p_quote ->> 'audienceKind', 'selectedCount', (p_quote ->> 'selectedCount')::int,
    'reachableCount', (SELECT count(*) FROM jsonb_array_elements(p_quote -> 'candidates') x
                        WHERE (x ->> 'allowed')::boolean),
    'candidates', p_quote -> 'candidates')
$fn$;

-- ── T3-01 any one extended switch off → server refuses quote and confirm ────
DO $t3a$
DECLARE v_flag text; v_quote jsonb; v_snap jsonb;
BEGIN
  v_quote := public.biz_marketing_push_quote_candidates_v1(
    '3682c300-0000-4000-8000-000000000001', '3682c300-3000-4000-8000-000000000001');
  IF NOT (v_quote -> 'candidates' @> '[{"recipientUserId":"3682c300-0000-4000-8000-000000000012","reason":"extended","allowed":true}]'::jsonb) THEN
    RAISE EXCEPTION 'T3-01 FAIL: fixture: friend of follower not reachable with all switches on: %', v_quote;
  END IF;
  v_snap := pg_temp.t3_snapshot('3682c300-3000-4000-8000-000000000001', v_quote, gen_random_uuid());
  FOREACH v_flag IN ARRAY ARRAY['brand_circle_extended_v1', 'brand_circle_extended_controls_ios_v1',
                                'brand_circle_extended_controls_android_v1'] LOOP
    UPDATE public.feature_flags SET is_enabled = (flag_key <> v_flag)
     WHERE flag_key IN ('brand_circle_extended_v1', 'brand_circle_extended_controls_ios_v1',
                        'brand_circle_extended_controls_android_v1');
    BEGIN
      PERFORM public.biz_marketing_push_quote_candidates_v1(
        '3682c300-0000-4000-8000-000000000001', '3682c300-3000-4000-8000-000000000001');
      RAISE EXCEPTION 'T3-01 FAIL: push quote to friends of followers allowed with % off', v_flag;
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    BEGIN
      PERFORM public.biz_confirm_marketing_push_send_v1(
        '3682c300-0000-4000-8000-000000000001', '3682c300-3000-4000-8000-000000000001',
        gen_random_uuid(), v_snap, NULL);
      RAISE EXCEPTION 'T3-01 FAIL: push confirm to friends of followers allowed with % off', v_flag;
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
  END LOOP;
  -- A flag row that is missing entirely is "off", not "on".
  UPDATE public.feature_flags SET is_enabled = true
   WHERE flag_key IN ('brand_circle_extended_v1', 'brand_circle_extended_controls_ios_v1',
                      'brand_circle_extended_controls_android_v1');
  IF EXISTS (SELECT 1 FROM public.marketing_book_send_executions
              WHERE campaign_id = '3682c300-3000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'T3-01 FAIL: a refused confirm left an execution';
  END IF;
END;
$t3a$;

-- ── T3-02 kill switch between confirm and a scheduled send ──────────────────
DO $t3b$
DECLARE v_quote jsonb; v_work jsonb; v_follow_work jsonb;
BEGIN
  v_quote := public.biz_marketing_push_quote_candidates_v1(
    '3682c300-0000-4000-8000-000000000001', '3682c300-3000-4000-8000-000000000001');
  PERFORM public.biz_confirm_marketing_push_send_v1(
    '3682c300-0000-4000-8000-000000000001', '3682c300-3000-4000-8000-000000000001',
    '3682c300-4000-4000-8000-000000000001',
    pg_temp.t3_snapshot('3682c300-3000-4000-8000-000000000001', v_quote, NULL), now() + interval '1 day');
  v_quote := public.biz_marketing_push_quote_candidates_v1(
    '3682c300-0000-4000-8000-000000000001', '3682c300-3000-4000-8000-000000000002');
  PERFORM public.biz_confirm_marketing_push_send_v1(
    '3682c300-0000-4000-8000-000000000001', '3682c300-3000-4000-8000-000000000002',
    '3682c300-4000-4000-8000-000000000002',
    pg_temp.t3_snapshot('3682c300-3000-4000-8000-000000000002', v_quote, NULL), now() + interval '1 day');

  -- Ops switches Friends of followers off (Android controls) before the send.
  UPDATE public.feature_flags SET is_enabled = false
   WHERE flag_key = 'brand_circle_extended_controls_android_v1';
  v_work := public.biz_marketing_push_send_worklist_v1('3682c300-3000-4000-8000-000000000001');
  IF jsonb_array_length(v_work -> 'work') <> 0 THEN
    RAISE EXCEPTION 'T3-02 FAIL: a confirmed push still reached friends of followers after the switch went off: %', v_work;
  END IF;
  IF (SELECT status FROM public.marketing_push_messages
       WHERE campaign_id = '3682c300-3000-4000-8000-000000000001'
         AND user_id = '3682c300-0000-4000-8000-000000000012') <> 'skipped' THEN
    RAISE EXCEPTION 'T3-02 FAIL: the friend-of-follower row must be skipped, not left queued';
  END IF;
  v_follow_work := public.biz_marketing_push_send_worklist_v1('3682c300-3000-4000-8000-000000000002');
  IF jsonb_array_length(v_follow_work -> 'work') <> 2 THEN
    RAISE EXCEPTION 'T3-02 FAIL: followers must still get their push: %', v_follow_work;
  END IF;
  UPDATE public.feature_flags SET is_enabled = true
   WHERE flag_key = 'brand_circle_extended_controls_android_v1';
END;
$t3b$;

-- ── T3-03 the same kill switch for account invites to friends of followers ──
INSERT INTO public.events(
  id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, party_types, rsvp_approval_mode, rsvp_discoverable, theme, created_at, updated_at
) VALUES ('3682c300-1000-4000-8000-000000000001', '3682c300-0000-4000-8000-0000000000c0',
  '3682c300-0000-4000-8000-000000000001', 'event', 'T3 draft', 'issue-3682-t3-draft',
  'draft', 'draft', 'USD', 'UTC', '{}', 'auto', false, '{}', now(), now());
SELECT set_config('request.jwt.claim.sub', '3682c300-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"3682c300-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.biz_replace_offering_invite_plan_v1('3682c300-1000-4000-8000-000000000001',
  '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":false,"includeFriendsOfFollowers":true,"manualGroupIds":[],"personIds":[]}',
  0, '3682c300-5000-4000-8000-000000000001') ->> 'accountRecipientCount' AS t3_friends_selected;
RESET ROLE;
SELECT private.enqueue_wizard_invites_on_publish_v1('3682c300-1000-4000-8000-000000000001', 1, true);
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'brand_circle_extended_v1';
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
DO $t3c$
DECLARE v_jobs jsonb; v_job jsonb; v_build jsonb;
BEGIN
  v_jobs := public.issue_1780_claim_wizard_invite_outbox_v1(10);
  SELECT j INTO v_job FROM jsonb_array_elements(v_jobs) j
   WHERE j ->> 'eventId' = '3682c300-1000-4000-8000-000000000001';
  IF (v_job ->> 'accountRecipientCount')::int <> 1 THEN
    RAISE EXCEPTION 'T3-03 FAIL: fixture: friend of follower not sealed: %', v_jobs;
  END IF;
  v_build := public.issue_3682_build_wizard_account_invites_v1(
    (v_job ->> 'outboxJobId')::uuid, (v_job ->> 'sealedSelectionId')::uuid, (v_job ->> 'leaseToken')::uuid);
  IF jsonb_array_length(v_build -> 'work') <> 0 THEN
    RAISE EXCEPTION 'T3-03 FAIL: account invite to a friend of a follower sent after the switch went off: %', v_build -> 'work';
  END IF;
END;
$t3c$;
RESET ROLE;
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'brand_circle_extended_v1';

-- ── T3-04 campaign groups cannot be borrowed or moved ───────────────────────
DO $t3d$
BEGIN
  BEGIN
    INSERT INTO public.marketing_campaigns(account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
    VALUES ('3682c300-0000-4000-8000-000000000002', '3682c300-0000-4000-8000-0000000000d0',
      '3682c300-2000-4000-8000-000000000003', 'D joins C', 'push',
      '{"kind":"push","body":"x"}', 'draft', '3682c300-3000-4000-8000-000000000002');
    RAISE EXCEPTION 'T3-04 FAIL: brand D joined brand C''s campaign group';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.marketing_campaigns(account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
    VALUES ('3682c300-0000-4000-8000-000000000002', '3682c300-0000-4000-8000-0000000000c0',
      '3682c300-2000-4000-8000-000000000002', 'Other author', 'sms',
      '{"kind":"sms","body":"x"}', 'draft', '3682c300-3000-4000-8000-000000000002');
    RAISE EXCEPTION 'T3-04 FAIL: another author joined the campaign group';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    UPDATE public.marketing_campaigns SET campaign_group_id = '3682c300-3000-4000-8000-000000000001'
     WHERE id = '3682c300-3000-4000-8000-000000000002';
    RAISE EXCEPTION 'T3-04 FAIL: a campaign moved to another group';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$t3d$;

-- ── T3-05 push + email + SMS = one blast; another campaign = two ────────────
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id) VALUES
  ('3682c300-3000-4000-8000-000000000003', '3682c300-0000-4000-8000-000000000001',
   '3682c300-0000-4000-8000-0000000000c0', '3682c300-2000-4000-8000-000000000002', 'Followers email', 'email',
   '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}', 'draft', '3682c300-3000-4000-8000-000000000002'),
  ('3682c300-3000-4000-8000-000000000004', '3682c300-0000-4000-8000-000000000001',
   '3682c300-0000-4000-8000-0000000000c0', '3682c300-2000-4000-8000-000000000002', 'Followers sms', 'sms',
   '{"kind":"sms","body":"Hi"}', 'draft', '3682c300-3000-4000-8000-000000000002');
INSERT INTO public.marketing_book_send_executions(
  brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
  selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
  estimated_cost_minor, currency, cost_kind, quoted_at, scheduled_for, send_mode)
SELECT '3682c300-0000-4000-8000-0000000000c0', c, '3682c300-0000-4000-8000-000000000001',
  gen_random_uuid(), 1, repeat('f', 64), repeat('f', 64), 2, 2, 0, 0, 0, NULL, NULL,
  'not_metered', now(), now(), 'now'
FROM unnest(ARRAY['3682c300-3000-4000-8000-000000000003', '3682c300-3000-4000-8000-000000000004']::uuid[]) c;

DO $t3e$
DECLARE v_usage jsonb; v_admin jsonb; v_row jsonb;
BEGIN
  -- Group 1 = followers push + email + sms; group 2 = friends push (confirmed in T3-02).
  v_usage := public.biz_brand_blast_usage_v1('3682c300-0000-4000-8000-000000000001', '3682c300-0000-4000-8000-0000000000c0');
  IF (v_usage ->> 'blastsThisWeek')::int <> 2 THEN
    RAISE EXCEPTION 'T3-05 FAIL: Host usage counted % blasts for 2 campaigns (%)', v_usage ->> 'blastsThisWeek', v_usage;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '3682c300-0000-4000-8000-000000000003', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"3682c300-0000-4000-8000-000000000003","role":"authenticated","email":"admin-3682t3@mingla-fixture.org"}', true);
  v_admin := public.admin_messaging_limits_overview();
  SELECT b INTO v_row FROM jsonb_array_elements(v_admin -> 'brands') b
   WHERE b ->> 'brand_id' = '3682c300-0000-4000-8000-0000000000c0';
  IF (v_row ->> 'blasts_this_week')::int <> 2 OR (v_row ->> 'push_used')::int <> 3 THEN
    RAISE EXCEPTION 'T3-05 FAIL: admin overview %', v_row;
  END IF;
  IF (v_usage ->> 'blastsThisWeek')::int <> (v_row ->> 'blasts_this_week')::int THEN
    RAISE EXCEPTION 'T3-05 FAIL: Host and admin disagree';
  END IF;
END;
$t3e$;

-- ── T3-06 brand isolation ───────────────────────────────────────────────────
DO $t3f$
BEGIN
  -- Owner D (no role on brand C) cannot quote brand C's push even through the
  -- service-role path that trusts the actor id the edge function passes.
  BEGIN
    PERFORM public.biz_marketing_push_quote_candidates_v1(
      '3682c300-0000-4000-8000-000000000002', '3682c300-3000-4000-8000-000000000002');
    RAISE EXCEPTION 'T3-06 FAIL: a foreign actor quoted brand C''s followers';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_brand_blast_usage_v1('3682c300-0000-4000-8000-000000000002', '3682c300-0000-4000-8000-0000000000c0');
    RAISE EXCEPTION 'T3-06 FAIL: a foreign actor read brand C''s usage';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$t3f$;
SELECT set_config('request.jwt.claim.sub', '3682c300-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"3682c300-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t3g$
BEGIN
  BEGIN
    PERFORM 1 FROM public.marketing_push_messages LIMIT 1;
    RAISE EXCEPTION 'T3-06 FAIL: a host can select push recipients';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_marketing_push_send_worklist_v1('3682c300-3000-4000-8000-000000000002');
    RAISE EXCEPTION 'T3-06 FAIL: a host can read a push worklist';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_3682_campaign_push_reason('3682c300-0000-4000-8000-0000000000c0',
      '3682c300-0000-4000-8000-000000000011', 'follower');
    RAISE EXCEPTION 'T3-06 FAIL: a host can probe another brand''s followers';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.marketing_campaigns WHERE brand_id = '3682c300-0000-4000-8000-0000000000c0') THEN
    RAISE EXCEPTION 'T3-06 FAIL: brand D sees brand C''s campaigns';
  END IF;
END;
$t3g$;
RESET ROLE;

ROLLBACK;
