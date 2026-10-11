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

INSERT INTO public.brand_people(id, brand_id, linked_user_id, display_name, record_status)
VALUES (
  '00000000-3682-4000-8000-000000000030',
  '00000000-3682-4000-8000-000000000010',
  '00000000-3682-4000-8000-000000000002',
  'Book Follower',
  'active'
);
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

SELECT set_config('request.jwt.claim.sub', '00000000-3682-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

DO $followers$
DECLARE
  v_plan jsonb;
  v_legacy jsonb;
BEGIN
  -- Legacy four-key Host payloads remain accepted (new flags default false).
  v_legacy := public.biz_replace_offering_invite_plan_v1(
    '00000000-3682-4000-8000-000000000020',
    '{"includeEveryone":false,"manualGroupIds":[],"personIds":[],"excludedPersonIds":[]}',
    0, '00000000-3682-4000-8000-000000000050');
  IF (v_legacy->>'selectedCount')::integer <> 0 OR (v_legacy->>'selectionRevision')::integer <> 1 THEN
    RAISE EXCEPTION 'T-3682-I-01 FAIL: legacy 4-key clear should succeed empty: %', v_legacy;
  END IF;

  v_plan := public.biz_replace_offering_invite_plan_v1(
    '00000000-3682-4000-8000-000000000020',
    '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
    1, '00000000-3682-4000-8000-000000000051');
  IF (v_plan->>'selectedCount')::integer <> 2 THEN
    RAISE EXCEPTION 'T-3682-I-02 FAIL: expected book+outside followers, got %', v_plan;
  END IF;
  IF NOT (v_plan->'brandPersonIds' @> jsonb_build_array('00000000-3682-4000-8000-000000000030')) THEN
    RAISE EXCEPTION 'T-3682-I-02 FAIL: book-linked follower missing from plan: %', v_plan;
  END IF;
  -- Assert the second member without reading brand_people under authenticated RLS.
  IF (
    SELECT count(*) FROM jsonb_array_elements_text(v_plan->'brandPersonIds') x
    WHERE x <> '00000000-3682-4000-8000-000000000030'
  ) <> 1 THEN
    RAISE EXCEPTION 'T-3682-I-02 FAIL: outside follower missing from plan: %', v_plan;
  END IF;
END;
$followers$;

RESET ROLE;
-- Outside follower must have been ensured into brand_people (postgres role).
DO $ensured$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_people
     WHERE brand_id = '00000000-3682-4000-8000-000000000010'
       AND linked_user_id = '00000000-3682-4000-8000-000000000003'
       AND record_status = 'active'
  ) THEN
    RAISE EXCEPTION 'T-3682-I-02b FAIL: outside follower person row was not ensured';
  END IF;
END;
$ensured$;

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
    2, '00000000-3682-4000-8000-000000000052');
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
DECLARE
  v_plan jsonb;
  v_friend_person uuid;
BEGIN
  v_plan := public.biz_replace_offering_invite_plan_v1(
    '00000000-3682-4000-8000-000000000020',
    '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":false,"includeFriendsOfFollowers":true,"manualGroupIds":[],"personIds":[]}',
    3, '00000000-3682-4000-8000-000000000053');
  IF (v_plan->>'selectedCount')::integer < 1 THEN
    RAISE EXCEPTION 'T-3682-I-04 FAIL: friends of followers produced empty plan: %', v_plan;
  END IF;
  -- Friend-of-follower must not be a current follower or book-linked person.
  IF v_plan->'brandPersonIds' @> jsonb_build_array('00000000-3682-4000-8000-000000000030') THEN
    RAISE EXCEPTION 'T-3682-I-04 FAIL: book follower leaked into friends-only plan: %', v_plan;
  END IF;
END;
$friends$;

RESET ROLE;
DO $friend_ensured$
DECLARE v_person uuid;
BEGIN
  SELECT id INTO v_person FROM public.brand_people
   WHERE brand_id = '00000000-3682-4000-8000-000000000010'
     AND linked_user_id = '00000000-3682-4000-8000-000000000004'
     AND record_status = 'active';
  IF v_person IS NULL THEN
    RAISE EXCEPTION 'T-3682-I-04b FAIL: friend-of-follower person row was not ensured';
  END IF;
END;
$friend_ensured$;

ROLLBACK;
