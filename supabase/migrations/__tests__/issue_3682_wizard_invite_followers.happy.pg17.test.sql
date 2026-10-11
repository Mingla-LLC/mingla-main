-- #3682 Wave 2.8b — Followers / Friends of followers expand into invite plans.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key = 'business_wizard_invite_selection_v1';

INSERT INTO auth.users(id) VALUES
  ('00000000-3682-4000-8000-000000000001'),
  ('00000000-3682-4000-8000-000000000002'),
  ('00000000-3682-4000-8000-000000000003');
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
  ('00000000-3682-4000-8000-000000000003', 'Outside', 'Follower', 'Outside Follower', 'outside-follower-3682', true, true, 'friends');

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

SELECT set_config('request.jwt.claim.sub', '00000000-3682-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

DO $followers$
DECLARE
  v_plan jsonb;
  v_person uuid;
BEGIN
  -- Old 4-key selection must fail the widened lock.
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1(
      '00000000-3682-4000-8000-000000000020',
      '{"includeEveryone":false,"manualGroupIds":[],"personIds":[],"excludedPersonIds":[]}',
      0, '00000000-3682-4000-8000-000000000050');
    RAISE EXCEPTION 'T-3682-I-01 FAIL: old 4-key selection was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  v_plan := public.biz_replace_offering_invite_plan_v1(
    '00000000-3682-4000-8000-000000000020',
    '{"excludedPersonIds":[],"includeEveryone":false,"includeFollowers":true,"includeFriendsOfFollowers":false,"manualGroupIds":[],"personIds":[]}',
    0, '00000000-3682-4000-8000-000000000051');
  IF (v_plan->>'selectedCount')::integer <> 2 THEN
    RAISE EXCEPTION 'T-3682-I-02 FAIL: expected book+outside followers, got %', v_plan;
  END IF;
  IF NOT (v_plan->'brandPersonIds' @> jsonb_build_array('00000000-3682-4000-8000-000000000030')) THEN
    RAISE EXCEPTION 'T-3682-I-02 FAIL: book-linked follower missing from plan: %', v_plan;
  END IF;
  SELECT id INTO v_person
    FROM public.brand_people
   WHERE brand_id = '00000000-3682-4000-8000-000000000010'
     AND linked_user_id = '00000000-3682-4000-8000-000000000003'
     AND record_status = 'active';
  IF v_person IS NULL OR NOT (v_plan->'brandPersonIds' @> jsonb_build_array(v_person::text)) THEN
    RAISE EXCEPTION 'T-3682-I-02 FAIL: outside follower was not ensured into brand_people/plan: %', v_plan;
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
ROLLBACK;
