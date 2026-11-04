-- #3682 closeout wave 2 (A) — invite any follower at creation as an
-- account-only recipient. Runs on the fully applied migration chain.
--
-- MINGLA-INVARIANT: I-3682-ACCOUNT-INVITE-NEVER-BOOK | issue #3682 | An account-only invite recipient is never inserted into brand_people and its email/phone is never returned by an authenticated RPC.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('business_wizard_invite_selection_v1', 'business_wizard_invite_dispatch_v1',
  'brand_circle_followers_v1');
UPDATE public.feature_flags SET is_enabled = false
WHERE flag_key IN ('brand_circle_extended_v1', 'brand_circle_extended_controls_ios_v1',
  'brand_circle_extended_controls_android_v1');

-- The CI image has no GoTrue identities table; verified_account_identifiers
-- reads it when present, so this transaction provides one.
CREATE TABLE IF NOT EXISTS auth.identities(
  user_id uuid NOT NULL, provider text NOT NULL, identity_data jsonb NOT NULL,
  provider_id text NOT NULL);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

INSERT INTO auth.users(id) VALUES
  ('36829100-0000-4000-8000-000000000001'),
  ('36829100-0000-4000-8000-000000000002'),
  ('36829100-0000-4000-8000-000000000003'),
  ('36829100-0000-4000-8000-000000000004'),
  ('36829100-0000-4000-8000-000000000005');
INSERT INTO auth.identities(user_id, provider, identity_data, provider_id) VALUES
  ('36829100-0000-4000-8000-000000000003', 'email', '{"email":"outside-a@example.test"}',
   '36829100-0000-4000-8000-000000000003'),
  ('36829100-0000-4000-8000-000000000005', 'email', '{"email":"outside-b@example.test"}',
   '36829100-0000-4000-8000-000000000005');
INSERT INTO public.creator_accounts(id, email, display_name)
VALUES ('36829100-0000-4000-8000-000000000001', 'owner-3682a@example.test', 'Owner 3682a');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('36829100-0000-4000-8000-000000000010', '36829100-0000-4000-8000-000000000001',
  'Account Invite Brand', 'issue-3682-account-invite', 'USD', now(), now());
INSERT INTO public.events(
  id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, party_types, rsvp_approval_mode, rsvp_discoverable, theme, created_at, updated_at
) VALUES
  ('36829100-1000-4000-8000-000000000001', '36829100-0000-4000-8000-000000000010',
   '36829100-0000-4000-8000-000000000001', 'event', 'Mixed invite draft', 'issue-3682-acct-mixed',
   'draft', 'draft', 'USD', 'UTC', '{}', 'auto', false, '{}', now(), now()),
  ('36829100-1000-4000-8000-000000000002', '36829100-0000-4000-8000-000000000010',
   '36829100-0000-4000-8000-000000000001', 'event', 'Account only draft', 'issue-3682-acct-only',
   'draft', 'draft', 'USD', 'UTC', '{}', 'auto', false, '{}', now(), now()),
  ('36829100-1000-4000-8000-000000000003', '36829100-0000-4000-8000-000000000010',
   '36829100-0000-4000-8000-000000000001', 'event', 'Legacy client draft', 'issue-3682-acct-legacy',
   'draft', 'draft', 'USD', 'UTC', '{}', 'auto', false, '{}', now(), now());
INSERT INTO public.profiles(id, first_name, last_name, display_name, username, active,
  has_completed_onboarding, visibility_mode)
VALUES
  ('36829100-0000-4000-8000-000000000002', 'Book', 'Follower', 'Book Follower', 'acct-3682-book', true, true, 'friends'),
  ('36829100-0000-4000-8000-000000000003', 'Outside', 'A', 'Outside A', 'acct-3682-a', true, true, 'private'),
  ('36829100-0000-4000-8000-000000000004', 'Muted', 'Follower', 'Muted Follower', 'acct-3682-muted', true, true, 'friends'),
  ('36829100-0000-4000-8000-000000000005', 'Outside', 'B', 'Outside B', 'acct-3682-b', true, true, 'friends');
INSERT INTO public.brand_people(id, brand_id, linked_user_id, display_name, record_status) VALUES
  ('36829100-2000-4000-8000-000000000001', '36829100-0000-4000-8000-000000000010',
   '36829100-0000-4000-8000-000000000002', 'Book Follower', 'active');
INSERT INTO public.brand_follows(user_id, brand_id, muted_until) VALUES
  ('36829100-0000-4000-8000-000000000002', '36829100-0000-4000-8000-000000000010', NULL),
  ('36829100-0000-4000-8000-000000000003', '36829100-0000-4000-8000-000000000010', NULL),
  ('36829100-0000-4000-8000-000000000004', '36829100-0000-4000-8000-000000000010', 'infinity'),
  ('36829100-0000-4000-8000-000000000005', '36829100-0000-4000-8000-000000000010', NULL);
-- Outside B turned this brand's push off in Manage.
INSERT INTO public.brand_follow_channel_prefs(user_id, brand_id, channel, enabled) VALUES
  ('36829100-0000-4000-8000-000000000005', '36829100-0000-4000-8000-000000000010', 'push', false);
-- One email left this month for the brand.
INSERT INTO public.brand_messaging_limits(brand_id, email_monthly, sms_monthly, push_monthly, week_warning_at, reason)
VALUES ('36829100-0000-4000-8000-000000000010', 1, 100, NULL, 3, 'issue 3682 test');

CREATE TEMP TABLE acct_book_count AS
  SELECT count(*) AS n FROM public.brand_people WHERE brand_id = '36829100-0000-4000-8000-000000000010';

SELECT set_config('request.jwt.claim.sub', '36829100-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

DO $a1$
DECLARE v_plan jsonb; v_only jsonb; v_legacy jsonb;
BEGIN
  -- A-01 Followers = Book follower (Book lane) + every outside follower (account lane).
  v_plan := public.biz_replace_offering_invite_plan_v1(
    '36829100-1000-4000-8000-000000000001',
    '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
    0, '36829100-3000-4000-8000-000000000001');
  IF (v_plan->>'selectedCount')::int <> 1
     OR v_plan->'brandPersonIds' <> '["36829100-2000-4000-8000-000000000001"]'::jsonb
     OR (v_plan->>'accountRecipientCount')::int <> 2 THEN
    RAISE EXCEPTION 'A-01 FAIL: expected 1 Book + 2 account recipients (muted skipped): %', v_plan;
  END IF;
  -- A-02 The host never sees an address and the follower is never promoted.
  IF v_plan::text LIKE '%@%' THEN RAISE EXCEPTION 'A-02 FAIL: plan leaked an address: %', v_plan; END IF;
  -- A-03 Followers-only on a draft with no Book followers still selects them.
  v_only := public.biz_replace_offering_invite_plan_v1(
    '36829100-1000-4000-8000-000000000002',
    '{"excludedPersonIds":["36829100-2000-4000-8000-000000000001"],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
    0, '36829100-3000-4000-8000-000000000002');
  IF (v_only->>'selectedCount')::int <> 0 OR (v_only->>'accountRecipientCount')::int <> 2 THEN
    RAISE EXCEPTION 'A-03 FAIL: account-only selection: %', v_only;
  END IF;
  v_legacy := public.biz_replace_offering_invite_plan_v1(
    '36829100-1000-4000-8000-000000000003',
    '{"excludedPersonIds":["36829100-2000-4000-8000-000000000001"],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
    0, '36829100-3000-4000-8000-000000000003');
  -- A-04 Friends of followers stays gated while the extended switches are off.
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1(
      '36829100-1000-4000-8000-000000000001',
      '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":false,"includeFriendsOfFollowers":true,"manualGroupIds":[],"personIds":[]}',
      1, '36829100-3000-4000-8000-000000000004');
    RAISE EXCEPTION 'A-04 FAIL: friends of followers accepted while off';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  -- A-05 Authenticated callers cannot reach the dispatcher worklist.
  BEGIN
    PERFORM public.issue_3682_build_wizard_account_invites_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'A-05 FAIL: authenticated reached the worklist';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$a1$;

RESET ROLE;
DO $a2book$
BEGIN
  IF (SELECT count(*) FROM public.brand_people WHERE brand_id = '36829100-0000-4000-8000-000000000010')
     <> (SELECT n FROM acct_book_count) THEN
    RAISE EXCEPTION 'A-02 FAIL: an account recipient was written into Your Book';
  END IF;
END;
$a2book$;

-- Quote as the service-role dispatcher.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
DO $a2$
DECLARE v_quote jsonb;
BEGIN
  v_quote := public.issue_3682_quote_wizard_account_invites_v1(
    '36829100-0000-4000-8000-000000000001', '36829100-1000-4000-8000-000000000001', 1);
  -- Outside A: push + email (only one email left). Outside B: push off; email
  -- exhausted by the cap → cannot receive.
  IF v_quote <> '{"accountRecipientCount":2,"canReceiveCount":1,"push":1,"email":1}'::jsonb THEN
    RAISE EXCEPTION 'A-06 FAIL: quote %', v_quote;
  END IF;
  BEGIN
    PERFORM public.issue_3682_quote_wizard_account_invites_v1(
      '36829100-0000-4000-8000-000000000001', '36829100-1000-4000-8000-000000000001', 7);
    RAISE EXCEPTION 'A-06 FAIL: stale revision accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
END;
$a2$;
RESET ROLE;

-- Publish all three drafts (the publish path calls this private helper).
DO $a3$
DECLARE v_mixed jsonb; v_only jsonb; v_legacy jsonb;
BEGIN
  v_mixed := private.enqueue_wizard_invites_on_publish_v1('36829100-1000-4000-8000-000000000001', 1, true);
  v_only := private.enqueue_wizard_invites_on_publish_v1('36829100-1000-4000-8000-000000000002', 1, true);
  -- A-07 An older client that never saw account recipients publishes unconfirmed: empty lock.
  v_legacy := private.enqueue_wizard_invites_on_publish_v1('36829100-1000-4000-8000-000000000003', 1, false);
  IF (v_mixed->'inviteDelivery'->>'selectedCount')::int <> 3
     OR (v_only->'inviteDelivery'->>'selectedCount')::int <> 2
     OR (v_only->'inviteDelivery'->>'planned')::boolean IS NOT TRUE
     OR v_legacy->'inviteDelivery'->>'status' <> 'empty' THEN
    RAISE EXCEPTION 'A-07 FAIL: publish results % / % / %', v_mixed, v_only, v_legacy;
  END IF;
  IF (SELECT jsonb_array_length(account_recipients) FROM private.brand_offering_invite_selections
       WHERE event_id = '36829100-1000-4000-8000-000000000002') <> 2 THEN
    RAISE EXCEPTION 'A-07 FAIL: account recipients were not sealed';
  END IF;
END;
$a3$;

-- Outside B unfollows after publish: the send-time decision must see it.
DELETE FROM public.brand_follows
WHERE user_id = '36829100-0000-4000-8000-000000000005' AND brand_id = '36829100-0000-4000-8000-000000000010';

SET LOCAL ROLE service_role;
DO $a4$
DECLARE v_jobs jsonb; v_job jsonb; v_build jsonb; v_again jsonb; v_row jsonb; v_done jsonb;
BEGIN
  v_jobs := public.issue_1780_claim_wizard_invite_outbox_v1(10);
  SELECT j INTO v_job FROM jsonb_array_elements(v_jobs) j
   WHERE j->>'eventId' = '36829100-1000-4000-8000-000000000002';
  IF v_job IS NULL OR (v_job->>'accountRecipientCount')::int <> 2
     OR jsonb_array_length(v_job->'brandPersonIds') <> 0 THEN
    RAISE EXCEPTION 'A-08 FAIL: claim did not surface the account-only job: %', v_jobs;
  END IF;
  v_build := public.issue_3682_build_wizard_account_invites_v1(
    (v_job->>'outboxJobId')::uuid, (v_job->>'sealedSelectionId')::uuid, (v_job->>'leaseToken')::uuid);
  -- A-09 Outside A: push + email queued (email resolved server side). Outside B
  -- unfollowed at send time: nothing queued.
  IF jsonb_array_length(v_build->'work') <> 2
     OR NOT (v_build->'work' @> '[{"channel":"push","userId":"36829100-0000-4000-8000-000000000003"},{"channel":"email","userId":"36829100-0000-4000-8000-000000000003","email":"outside-a@example.test"}]'::jsonb)
     OR v_build->'context'->>'brandSlug' <> 'issue-3682-account-invite' THEN
    RAISE EXCEPTION 'A-09 FAIL: worklist %', v_build;
  END IF;
  -- A-10 A retry rebuilds nothing new and returns the same queued work.
  v_again := public.issue_3682_build_wizard_account_invites_v1(
    (v_job->>'outboxJobId')::uuid, (v_job->>'sealedSelectionId')::uuid, (v_job->>'leaseToken')::uuid);
  IF v_again->'work' <> v_build->'work' THEN RAISE EXCEPTION 'A-10 FAIL: retry changed the worklist'; END IF;
  -- A-11 Completion refuses while work is queued, then succeeds.
  BEGIN
    PERFORM public.issue_3682_complete_wizard_account_outbox_v1(
      (v_job->>'outboxJobId')::uuid, (v_job->>'sealedSelectionId')::uuid, (v_job->>'leaseToken')::uuid);
    RAISE EXCEPTION 'A-11 FAIL: completed with queued work';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_build->'work') LOOP
    IF NOT public.issue_3682_record_wizard_account_invite_v1(
        (v_job->>'outboxJobId')::uuid, (v_job->>'leaseToken')::uuid,
        (v_row->>'deliveryId')::uuid, 'sent', 'delivered') THEN
      RAISE EXCEPTION 'A-11 FAIL: record refused';
    END IF;
  END LOOP;
  v_done := public.issue_3682_complete_wizard_account_outbox_v1(
    (v_job->>'outboxJobId')::uuid, (v_job->>'sealedSelectionId')::uuid, (v_job->>'leaseToken')::uuid);
  IF v_done->>'status' <> 'succeeded' THEN RAISE EXCEPTION 'A-11 FAIL: %', v_done; END IF;
  -- A-12 The mixed job keeps its Book lane: account completion is refused there.
  SELECT j INTO v_job FROM jsonb_array_elements(v_jobs) j
   WHERE j->>'eventId' = '36829100-1000-4000-8000-000000000001';
  BEGIN
    PERFORM public.issue_3682_complete_wizard_account_outbox_v1(
      (v_job->>'outboxJobId')::uuid, (v_job->>'sealedSelectionId')::uuid, (v_job->>'leaseToken')::uuid);
    RAISE EXCEPTION 'A-12 FAIL: mixed job completed through the account lane';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
END;
$a4$;
RESET ROLE;
DO $a4b$
BEGIN
  IF (SELECT array_agg(reason ORDER BY channel) FROM private.brand_offering_account_invite_deliveries
       WHERE user_id = '36829100-0000-4000-8000-000000000005') <> ARRAY['unfollowed','unfollowed'] THEN
    RAISE EXCEPTION 'A-09 FAIL: unfollow was not honoured at send time';
  END IF;
END;
$a4b$;

-- A-13 The host's delivery view: names and states, never an address.
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $a5$
DECLARE v_view jsonb;
BEGIN
  v_view := public.biz_get_offering_account_invites_v1('36829100-1000-4000-8000-000000000002');
  IF (v_view->'counts'->>'invited')::int <> 2 OR (v_view->'counts'->>'reached')::int <> 1
     OR NOT (v_view->'recipients' @> '[{"displayName":"Outside A","push":"sent","email":"sent","reason":"follower"}]'::jsonb) THEN
    RAISE EXCEPTION 'A-13 FAIL: host view %', v_view;
  END IF;
  IF v_view::text LIKE '%@%' THEN RAISE EXCEPTION 'A-13 FAIL: host view leaked an address'; END IF;
END;
$a5$;
RESET ROLE;

ROLLBACK;
