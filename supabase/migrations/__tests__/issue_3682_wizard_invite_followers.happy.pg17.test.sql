-- #3682 Wave 2.8b — Followers / Friends of followers expand into invite plans.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN (
  'business_wizard_invite_selection_v1',
  'brand_circle_followers_v1',
  'brand_circle_extended_v1',
  'brand_circle_extended_controls_ios_v1',
  'brand_circle_extended_controls_android_v1'
);

INSERT INTO auth.users(id) VALUES
  ('00000000-3682-4000-8000-000000000001'),
  ('00000000-3682-4000-8000-000000000002'),
  ('00000000-3682-4000-8000-000000000003'),
  ('00000000-3682-4000-8000-000000000004');
INSERT INTO public.creator_accounts(id, email, display_name)
VALUES ('00000000-3682-4000-8000-000000000001', 'owner-3682-invite@example.test', 'Issue 3682 Invite Owner');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES (
  '00000000-3682-4000-8000-000000000010',
  '00000000-3682-4000-8000-000000000001',
  'Issue 3682 Invite Brand',
  'issue-3682-invite-brand',
  'USD', now(), now()
);
INSERT INTO public.events(
  id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, party_types, rsvp_approval_mode, rsvp_discoverable, theme, created_at, updated_at
) VALUES (
  '00000000-3682-4000-8000-000000000020',
  '00000000-3682-4000-8000-000000000010',
  '00000000-3682-4000-8000-000000000001',
  'event', 'Follower invite draft', 'issue-3682-invite-event',
  'draft', 'draft', 'USD', 'UTC', '{}', 'auto', false, '{}', now(), now()
);

INSERT INTO public.profiles(id, first_name, last_name, display_name, username, active, has_completed_onboarding, visibility_mode)
VALUES
  ('00000000-3682-4000-8000-000000000002', 'Book', 'Follower', 'Book Follower', 'book-follower-3682', true, true, 'friends'),
  ('00000000-3682-4000-8000-000000000003', 'Outside', 'Follower', 'Outside Follower', 'outside-follower-3682', true, true, 'friends'),
  ('00000000-3682-4000-8000-000000000004', 'Friend', 'OfFollower', 'Friend Of Follower', 'fof-3682', true, true, 'friends');

-- Circle sources only map existing Book people (no auto-promote).
INSERT INTO public.brand_people(id, brand_id, linked_user_id, display_name, record_status) VALUES
  ('00000000-3682-4000-8000-000000000030', '00000000-3682-4000-8000-000000000010',
   '00000000-3682-4000-8000-000000000002', 'Book Follower', 'active'),
  ('00000000-3682-4000-8000-000000000031', '00000000-3682-4000-8000-000000000010',
   '00000000-3682-4000-8000-000000000003', 'Outside Follower', 'active'),
  ('00000000-3682-4000-8000-000000000032', '00000000-3682-4000-8000-000000000010',
   '00000000-3682-4000-8000-000000000004', 'Friend Of Follower', 'active');

INSERT INTO public.brand_follows(user_id, brand_id) VALUES
  ('00000000-3682-4000-8000-000000000002', '00000000-3682-4000-8000-000000000010'),
  ('00000000-3682-4000-8000-000000000003', '00000000-3682-4000-8000-000000000010');
INSERT INTO public.friends(user_id, friend_user_id, status)
VALUES (
  '00000000-3682-4000-8000-000000000002',
  '00000000-3682-4000-8000-000000000004',
  'accepted'
);
INSERT INTO public.brand_circle_preferences(user_id, extended_brand_reach_enabled, extended_brand_reach_decided_at)
VALUES ('00000000-3682-4000-8000-000000000004', true, now());

-- Seed a pre-migration four-key receipt so replay still works after normalization.
INSERT INTO private.brand_offering_invite_mutation_receipts(
  event_id, client_request_id, actor_id, request_hash, response_json
) VALUES (
  '00000000-3682-4000-8000-000000000020',
  '00000000-3682-4000-8000-000000000050',
  '00000000-3682-4000-8000-000000000001',
  encode(extensions.digest(convert_to(
    jsonb_build_object(
      'expectedRevision', 0,
      'selection', '{"includeEveryone":false,"manualGroupIds":[],"personIds":[],"excludedPersonIds":[]}'::jsonb
    )::text, 'UTF8'), 'sha256'), 'hex'),
  jsonb_build_object(
    'eventId', '00000000-3682-4000-8000-000000000020',
    'eventType', 'event', 'selectionRevision', 1, 'selectedCount', 0,
    'brandPersonIds', '[]'::jsonb, 'selectionHash',
    encode(extensions.digest(convert_to('[]', 'UTF8'), 'sha256'), 'hex'),
    'state', 'draft', 'publishedSelectionRevision', NULL, 'updatedAt', NULL,
    'replayed', false)
);

SELECT set_config('request.jwt.claim.sub', '00000000-3682-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

DO $followers$
DECLARE
  v_plan jsonb;
  v_legacy jsonb;
BEGIN
  -- Legacy four-key receipt replay (hash of raw four-key payload).
  v_legacy := public.biz_replace_offering_invite_plan_v1(
    '00000000-3682-4000-8000-000000000020',
    '{"includeEveryone":false,"manualGroupIds":[],"personIds":[],"excludedPersonIds":[]}',
    0, '00000000-3682-4000-8000-000000000050');
  IF (v_legacy->>'replayed')::boolean IS DISTINCT FROM true
     OR (v_legacy->>'selectedCount')::integer <> 0 THEN
    RAISE EXCEPTION 'T-3682-I-01 FAIL: legacy 4-key receipt replay failed: %', v_legacy;
  END IF;

  v_plan := public.biz_replace_offering_invite_plan_v1(
    '00000000-3682-4000-8000-000000000020',
    '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
    0, '00000000-3682-4000-8000-000000000051');
  IF (v_plan->>'selectedCount')::integer <> 2 THEN
    RAISE EXCEPTION 'T-3682-I-02 FAIL: expected book+outside followers, got %', v_plan;
  END IF;
  IF NOT (v_plan->'brandPersonIds' @> jsonb_build_array(
      '00000000-3682-4000-8000-000000000030',
      '00000000-3682-4000-8000-000000000031')) THEN
    RAISE EXCEPTION 'T-3682-I-02 FAIL: follower person ids missing: %', v_plan;
  END IF;
END;
$followers$;

RESET ROLE;
UPDATE public.brand_follows
SET muted_until = now() + interval '7 days'
WHERE user_id = '00000000-3682-4000-8000-000000000002'
  AND brand_id = '00000000-3682-4000-8000-000000000010';
SET LOCAL ROLE authenticated;

DO $muted$
DECLARE v_plan jsonb;
BEGIN
  v_plan := public.biz_replace_offering_invite_plan_v1(
    '00000000-3682-4000-8000-000000000020',
    '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
    1, '00000000-3682-4000-8000-000000000052');
  IF (v_plan->>'selectedCount')::integer <> 1 THEN
    RAISE EXCEPTION 'T-3682-I-03 FAIL: muted book follower should be skipped: %', v_plan;
  END IF;
  IF v_plan->'brandPersonIds' @> jsonb_build_array('00000000-3682-4000-8000-000000000030') THEN
    RAISE EXCEPTION 'T-3682-I-03 FAIL: muted follower leaked into plan: %', v_plan;
  END IF;
END;
$muted$;

RESET ROLE;
UPDATE public.brand_follows
SET muted_until = NULL
WHERE user_id = '00000000-3682-4000-8000-000000000002'
  AND brand_id = '00000000-3682-4000-8000-000000000010';
SET LOCAL ROLE authenticated;

DO $friends$
DECLARE v_plan jsonb;
BEGIN
  v_plan := public.biz_replace_offering_invite_plan_v1(
    '00000000-3682-4000-8000-000000000020',
    '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":false,"includeFriendsOfFollowers":true,"manualGroupIds":[],"personIds":[]}',
    2, '00000000-3682-4000-8000-000000000053');
  IF NOT (v_plan->'brandPersonIds' @> jsonb_build_array('00000000-3682-4000-8000-000000000032')) THEN
    RAISE EXCEPTION 'T-3682-I-04 FAIL: friend-of-follower missing from plan: %', v_plan;
  END IF;
  IF v_plan->'brandPersonIds' @> jsonb_build_array('00000000-3682-4000-8000-000000000030')
     OR v_plan->'brandPersonIds' @> jsonb_build_array('00000000-3682-4000-8000-000000000031') THEN
    RAISE EXCEPTION 'T-3682-I-04 FAIL: followers leaked into friends-only plan: %', v_plan;
  END IF;
END;
$friends$;

RESET ROLE;
ROLLBACK;
