-- #4273 wave A — the creation-wizard Invite step: sources combine into one
-- de-duplicated selection, and "How to reach them" methods are stored with the
-- plan, sealed at publish, and honoured by the quote and the dispatcher.
-- Runs on the fully applied migration chain.
--
-- MINGLA-INVARIANT: I-4273-INVITE-METHODS-HONOURED | issue #4273 | A wizard invite never travels by a method the host did not tick; a plan with no stored methods keeps the automatic behaviour.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('business_wizard_invite_selection_v1', 'business_wizard_invite_dispatch_v1',
  'brand_circle_followers_v1');
UPDATE public.feature_flags SET is_enabled = false
WHERE flag_key IN ('brand_circle_extended_v1', 'brand_circle_extended_controls_ios_v1',
  'brand_circle_extended_controls_android_v1');

CREATE TABLE IF NOT EXISTS auth.identities(
  user_id uuid NOT NULL, provider text NOT NULL, identity_data jsonb NOT NULL,
  provider_id text NOT NULL);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

-- Owner 01; Book follower 02 (in Your Book); outside follower 03.
INSERT INTO auth.users(id) VALUES
  ('42739100-0000-4000-8000-000000000001'),
  ('42739100-0000-4000-8000-000000000002'),
  ('42739100-0000-4000-8000-000000000003');
INSERT INTO public.creator_accounts(id, email, display_name)
VALUES ('42739100-0000-4000-8000-000000000001', 'owner-4273@example.test', 'Owner 4273');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('42739100-0000-4000-8000-000000000010', '42739100-0000-4000-8000-000000000001',
  'Invite Methods Brand', 'issue-4273-invite-methods', 'USD', now(), now());
INSERT INTO public.events(
  id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, party_types, rsvp_approval_mode, rsvp_discoverable, theme, created_at, updated_at
) VALUES
  ('42739100-1000-4000-8000-000000000001', '42739100-0000-4000-8000-000000000010',
   '42739100-0000-4000-8000-000000000001', 'event', 'Combined draft', 'issue-4273-combined',
   'draft', 'draft', 'USD', 'UTC', '{}', 'auto', false, '{}', now(), now()),
  ('42739100-1000-4000-8000-000000000002', '42739100-0000-4000-8000-000000000010',
   '42739100-0000-4000-8000-000000000001', 'rsvp', 'Legacy draft', 'issue-4273-legacy',
   'draft', 'draft', 'USD', 'UTC', '{}', 'auto', false, '{}', now(), now()),
  ('42739100-1000-4000-8000-000000000003', '42739100-0000-4000-8000-000000000010',
   '42739100-0000-4000-8000-000000000001', 'trip', 'SMS only draft', 'issue-4273-sms-only',
   'draft', 'draft', 'USD', 'UTC', '{}', 'auto', false, '{}', now(), now());
INSERT INTO public.profiles(id, first_name, last_name, display_name, username, active,
  has_completed_onboarding, visibility_mode)
VALUES
  ('42739100-0000-4000-8000-000000000002', 'Book', 'Follower', 'Book Follower', 'acct-4273-book', true, true, 'friends'),
  ('42739100-0000-4000-8000-000000000003', 'Outside', 'Follower', 'Outside Follower', 'acct-4273-out', true, true, 'friends');
INSERT INTO public.brand_people(id, brand_id, linked_user_id, display_name, record_status) VALUES
  ('42739100-2000-4000-8000-000000000001', '42739100-0000-4000-8000-000000000010',
   '42739100-0000-4000-8000-000000000002', 'Book Follower', 'active'),
  ('42739100-2000-4000-8000-000000000002', '42739100-0000-4000-8000-000000000010',
   NULL, 'Plain Guest', 'active'),
  ('42739100-2000-4000-8000-000000000003', '42739100-0000-4000-8000-000000000010',
   NULL, 'Group Guest', 'active');
INSERT INTO public.brand_follows(user_id, brand_id, muted_until) VALUES
  ('42739100-0000-4000-8000-000000000002', '42739100-0000-4000-8000-000000000010', NULL),
  ('42739100-0000-4000-8000-000000000003', '42739100-0000-4000-8000-000000000010', NULL);
INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition,
  is_system_generated, created_by)
VALUES ('42739100-4000-4000-8000-000000000001', '42739100-0000-4000-8000-000000000001',
  '42739100-0000-4000-8000-000000000010', 'Launch circle', '{"kind":"manual_group"}', false,
  '42739100-0000-4000-8000-000000000001');
INSERT INTO public.marketing_manual_group_memberships(brand_id, audience_id, brand_person_id,
  source, created_by)
VALUES ('42739100-0000-4000-8000-000000000010', '42739100-4000-4000-8000-000000000001',
  '42739100-2000-4000-8000-000000000003', 'book_picker', '42739100-0000-4000-8000-000000000001');

SELECT set_config('request.jwt.claim.sub', '42739100-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

DO $b1$
DECLARE v_plan jsonb; v_get jsonb; v_replay jsonb; v_legacy jsonb; v_sms jsonb;
  v_body jsonb := '{"deliveryChannels":["push","email"],"excludedPersonIds":[],"includeEveryone":true,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":["42739100-4000-4000-8000-000000000001"],"personIds":["42739100-2000-4000-8000-000000000002"]}';
BEGIN
  -- B-01 Everyone + Followers + a saved group + a chosen person combine. The
  -- Book follower is counted once (Book lane only); the outside follower rides
  -- the account lane once.
  v_plan := public.biz_replace_offering_invite_plan_v1(
    '42739100-1000-4000-8000-000000000001', v_body, 0, '42739100-3000-4000-8000-000000000001');
  IF (v_plan->>'selectedCount')::int <> 3
     OR (v_plan->>'accountRecipientCount')::int <> 1
     OR v_plan->'brandPersonIds' <> '["42739100-2000-4000-8000-000000000001","42739100-2000-4000-8000-000000000002","42739100-2000-4000-8000-000000000003"]'::jsonb THEN
    RAISE EXCEPTION 'B-01 FAIL: combined sources were not one de-duplicated set: %', v_plan;
  END IF;
  IF v_plan->'sources' <> '{"includeEveryone":true,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":["42739100-4000-4000-8000-000000000001"],"personIds":["42739100-2000-4000-8000-000000000002"],"excludedPersonIds":[]}'::jsonb
     OR v_plan->'deliveryChannels' <> '["email","push"]'::jsonb THEN
    RAISE EXCEPTION 'B-01 FAIL: sources/methods not stored: %', v_plan;
  END IF;
  -- B-02 Hydration returns the same sources and methods.
  v_get := public.biz_get_offering_invite_plan_v1('42739100-1000-4000-8000-000000000001');
  IF v_get->'sources' <> v_plan->'sources' OR v_get->'deliveryChannels' <> v_plan->'deliveryChannels' THEN
    RAISE EXCEPTION 'B-02 FAIL: hydration %', v_get;
  END IF;
  -- B-03 The same request replays its stored response.
  v_replay := public.biz_replace_offering_invite_plan_v1(
    '42739100-1000-4000-8000-000000000001', v_body, 0, '42739100-3000-4000-8000-000000000001');
  IF (v_replay->>'replayed')::boolean IS NOT TRUE OR v_replay->'deliveryChannels' <> '["email","push"]'::jsonb THEN
    RAISE EXCEPTION 'B-03 FAIL: replay %', v_replay;
  END IF;
  -- B-04 Invalid methods are refused: none, unknown, duplicate, not an array.
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1('42739100-1000-4000-8000-000000000001',
      v_body || '{"deliveryChannels":[]}', 1, gen_random_uuid());
    RAISE EXCEPTION 'B-04 FAIL: empty methods accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1('42739100-1000-4000-8000-000000000001',
      v_body || '{"deliveryChannels":["fax"]}', 1, gen_random_uuid());
    RAISE EXCEPTION 'B-04 FAIL: unknown method accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1('42739100-1000-4000-8000-000000000001',
      v_body || '{"deliveryChannels":["push","push"]}', 1, gen_random_uuid());
    RAISE EXCEPTION 'B-04 FAIL: duplicate method accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1('42739100-1000-4000-8000-000000000001',
      v_body || '{"deliveryChannels":"push"}', 1, gen_random_uuid());
    RAISE EXCEPTION 'B-04 FAIL: non-array methods accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  -- B-05 An older client's 6-key selection stores no methods (automatic).
  v_legacy := public.biz_replace_offering_invite_plan_v1(
    '42739100-1000-4000-8000-000000000002',
    '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":false,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":["42739100-2000-4000-8000-000000000002"]}',
    0, '42739100-3000-4000-8000-000000000002');
  IF v_legacy->'deliveryChannels' <> 'null'::jsonb OR (v_legacy->>'selectedCount')::int <> 1 THEN
    RAISE EXCEPTION 'B-05 FAIL: legacy save %', v_legacy;
  END IF;
  -- B-06 SMS only, Followers only.
  v_sms := public.biz_replace_offering_invite_plan_v1(
    '42739100-1000-4000-8000-000000000003',
    '{"deliveryChannels":["sms"],"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
    0, '42739100-3000-4000-8000-000000000003');
  IF (v_sms->>'selectedCount')::int <> 1 OR (v_sms->>'accountRecipientCount')::int <> 1
     OR v_sms->'deliveryChannels' <> '["sms"]'::jsonb THEN
    RAISE EXCEPTION 'B-06 FAIL: sms-only plan %', v_sms;
  END IF;
  -- B-07 Workers only: an authenticated caller cannot complete a job.
  BEGIN
    PERFORM public.issue_4273_complete_wizard_invite_outbox_no_methods_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'B-07 FAIL: authenticated reached the worker completion';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$b1$;
RESET ROLE;

-- B-08 A plan saved before #4273 (no stored sources) derives them.
UPDATE private.brand_offering_invite_plans SET selection_sources = NULL
WHERE event_id = '42739100-1000-4000-8000-000000000003';
DO $b8$
DECLARE v_resp jsonb;
BEGIN
  v_resp := private.issue_1780_plan_response('42739100-1000-4000-8000-000000000003');
  IF v_resp->'sources' <> '{"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":["42739100-2000-4000-8000-000000000001"],"excludedPersonIds":[]}'::jsonb THEN
    RAISE EXCEPTION 'B-08 FAIL: legacy sources %', v_resp;
  END IF;
END;
$b8$;

-- Quote as the service-role dispatcher.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
DO $b9$
DECLARE v_combined jsonb; v_sms jsonb;
BEGIN
  -- B-09 Push ticked: the outside follower can receive by push. SMS only: the
  -- account lane (push/email) has nothing the host ticked.
  v_combined := public.issue_3682_quote_wizard_account_invites_v1(
    '42739100-0000-4000-8000-000000000001', '42739100-1000-4000-8000-000000000001', 1);
  v_sms := public.issue_3682_quote_wizard_account_invites_v1(
    '42739100-0000-4000-8000-000000000001', '42739100-1000-4000-8000-000000000003', 1);
  IF (v_combined->>'push')::int <> 1 OR (v_combined->>'canReceiveCount')::int <> 1 THEN
    RAISE EXCEPTION 'B-09 FAIL: push-ticked quote %', v_combined;
  END IF;
  IF v_sms <> '{"accountRecipientCount":1,"canReceiveCount":0,"push":0,"email":0}'::jsonb THEN
    RAISE EXCEPTION 'B-09 FAIL: unticked methods were quoted: %', v_sms;
  END IF;
END;
$b9$;
RESET ROLE;

-- Publish (the publish path calls this private helper).
DO $b10$
BEGIN
  PERFORM private.enqueue_wizard_invites_on_publish_v1('42739100-1000-4000-8000-000000000001', 1, true);
  PERFORM private.enqueue_wizard_invites_on_publish_v1('42739100-1000-4000-8000-000000000002', 1, true);
  PERFORM private.enqueue_wizard_invites_on_publish_v1('42739100-1000-4000-8000-000000000003', 1, true);
  -- B-10 The methods are sealed with the selection (NULL = automatic).
  IF (SELECT delivery_channels FROM private.brand_offering_invite_selections
       WHERE event_id = '42739100-1000-4000-8000-000000000001') IS DISTINCT FROM ARRAY['email','push']
     OR (SELECT delivery_channels FROM private.brand_offering_invite_selections
          WHERE event_id = '42739100-1000-4000-8000-000000000002') IS NOT NULL
     OR (SELECT delivery_channels FROM private.brand_offering_invite_selections
          WHERE event_id = '42739100-1000-4000-8000-000000000003') IS DISTINCT FROM ARRAY['sms'] THEN
    RAISE EXCEPTION 'B-10 FAIL: methods were not sealed';
  END IF;
END;
$b10$;

SET LOCAL ROLE service_role;
DO $b11$
DECLARE v_jobs jsonb; v_job jsonb; v_build jsonb; v_done jsonb; v_combined jsonb; v_legacy jsonb;
BEGIN
  v_jobs := public.issue_1780_claim_wizard_invite_outbox_v1(10);
  SELECT j INTO v_job FROM jsonb_array_elements(v_jobs) j
   WHERE j->>'eventId' = '42739100-1000-4000-8000-000000000003';
  SELECT j INTO v_combined FROM jsonb_array_elements(v_jobs) j
   WHERE j->>'eventId' = '42739100-1000-4000-8000-000000000001';
  SELECT j INTO v_legacy FROM jsonb_array_elements(v_jobs) j
   WHERE j->>'eventId' = '42739100-1000-4000-8000-000000000002';
  -- B-11 The worker sees the sealed methods.
  IF v_job->'deliveryChannels' <> '["sms"]'::jsonb
     OR v_combined->'deliveryChannels' <> '["email","push"]'::jsonb
     OR v_legacy->'deliveryChannels' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'B-11 FAIL: claim %', v_jobs;
  END IF;
  -- B-12 SMS only: the account lane queues nothing and records why.
  v_build := public.issue_3682_build_wizard_account_invites_v1(
    (v_job->>'outboxJobId')::uuid, (v_job->>'sealedSelectionId')::uuid, (v_job->>'leaseToken')::uuid);
  IF jsonb_array_length(v_build->'work') <> 0 THEN
    RAISE EXCEPTION 'B-12 FAIL: an unticked method was queued: %', v_build;
  END IF;
  -- B-13 A job whose host ticked push cannot be closed as "no methods".
  BEGIN
    PERFORM public.issue_4273_complete_wizard_invite_outbox_no_methods_v1(
      (v_combined->>'outboxJobId')::uuid, (v_combined->>'sealedSelectionId')::uuid,
      (v_combined->>'leaseToken')::uuid);
    RAISE EXCEPTION 'B-13 FAIL: push-ticked job completed as no methods';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4273_complete_wizard_invite_outbox_no_methods_v1(
      (v_legacy->>'outboxJobId')::uuid, (v_legacy->>'sealedSelectionId')::uuid,
      (v_legacy->>'leaseToken')::uuid);
    RAISE EXCEPTION 'B-13 FAIL: automatic (legacy) job completed as no methods';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  -- B-14 The SMS-only job completes once its account lane is done.
  v_done := public.issue_4273_complete_wizard_invite_outbox_no_methods_v1(
    (v_job->>'outboxJobId')::uuid, (v_job->>'sealedSelectionId')::uuid, (v_job->>'leaseToken')::uuid);
  IF v_done->>'status' <> 'succeeded' THEN RAISE EXCEPTION 'B-14 FAIL: %', v_done; END IF;
END;
$b11$;
RESET ROLE;
DO $b12$
BEGIN
  IF (SELECT array_agg(reason ORDER BY channel) FROM private.brand_offering_account_invite_deliveries
       WHERE event_id = '42739100-1000-4000-8000-000000000003') <> ARRAY['method_not_chosen','method_not_chosen'] THEN
    RAISE EXCEPTION 'B-12 FAIL: the skipped methods were not recorded as not chosen';
  END IF;
  IF (SELECT state FROM private.brand_offering_invite_outbox
       WHERE event_id = '42739100-1000-4000-8000-000000000003') <> 'succeeded' THEN
    RAISE EXCEPTION 'B-14 FAIL: the outbox job did not succeed';
  END IF;
END;
$b12$;

ROLLBACK;
