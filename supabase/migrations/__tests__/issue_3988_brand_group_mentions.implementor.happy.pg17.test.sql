-- #3988 — executable proof for access-checked Brand-group mentions.
-- MINGLA-INVARIANT: I-3988-BRAND-GROUP-MENTIONS | issue #3988 | Only accepted, non-removed Brand-group members can be mentioned; a direct mention bypasses the thread mute but not the downstream global channel preference.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t3988_mentions_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  username text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3988_mentions_people VALUES
  ('author',   '39881111-0000-4000-b800-000000000001', 'mention-author@test.local',   'Amina Author',   'amina_author'),
  ('member',   '39881111-0000-4000-b800-000000000002', 'mention-member@test.local',   'Bola Member',    'bola_member'),
  ('muted',    '39881111-0000-4000-b800-000000000003', 'mention-muted@test.local',    'Chidi Muted',    'chidi_muted'),
  ('removed',  '39881111-0000-4000-b800-000000000004', 'mention-removed@test.local',  'Dami Removed',   'dami_removed'),
  ('outsider', '39881111-0000-4000-b800-000000000005', 'mention-outsider@test.local', 'Efe Outsider',   'efe_outsider');

INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT id, email, jsonb_build_object('full_name', display_name)
FROM t3988_mentions_people;

INSERT INTO public.profiles(id, email, display_name, username, account_type)
SELECT id, email, display_name, username, 'business'
FROM t3988_mentions_people;

INSERT INTO public.creator_accounts(id, email, display_name, business_name)
SELECT id, email, display_name, 'Mention Test Host'
FROM t3988_mentions_people WHERE who = 'author';

INSERT INTO public.brands(id, account_id, name, slug)
VALUES(
  '39881111-0000-4000-b900-000000000001',
  '39881111-0000-4000-b800-000000000001',
  'Mention Test Brand',
  'issue-3988-mention-test-brand'
);

INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
SELECT '39881111-0000-4000-b900-000000000001', id, 'marketing_manager', now()
FROM t3988_mentions_people WHERE who IN ('member', 'muted', 'removed');

UPDATE public.brand_team_members
SET removed_at = now()
WHERE brand_id = '39881111-0000-4000-b900-000000000001'
  AND user_id = '39881111-0000-4000-b800-000000000004';

DO $proof$
DECLARE
  v_author constant uuid := '39881111-0000-4000-b800-000000000001';
  v_member constant uuid := '39881111-0000-4000-b800-000000000002';
  v_muted constant uuid := '39881111-0000-4000-b800-000000000003';
  v_removed constant uuid := '39881111-0000-4000-b800-000000000004';
  v_outsider constant uuid := '39881111-0000-4000-b800-000000000005';
  v_conversation uuid;
  v_mentioned_message uuid;
  v_plain_message uuid;
  v_count bigint;
BEGIN
  SELECT id INTO STRICT v_conversation
  FROM public.conversations
  WHERE brand_id = '39881111-0000-4000-b900-000000000001'
    AND linked_entity_type = 'brand';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_author::text, true);

  SELECT count(*) INTO v_count
  FROM public.issue_3988_list_brand_group_mention_candidates(v_conversation, 'chidi', 8)
  WHERE user_id = v_muted AND display_name = 'Chidi Muted' AND username = 'chidi_muted';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'active_member_candidate_missing:%', v_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.issue_3988_list_brand_group_mention_candidates(v_conversation, '', 20)
    WHERE user_id IN (v_author, v_removed, v_outsider)
  ) THEN
    RAISE EXCEPTION 'candidate_list_exposed_sender_removed_or_outsider';
  END IF;

  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_muted::text, true);
  PERFORM public.issue_3988_set_brand_group_muted(v_conversation, true);

  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_author::text, true);
  v_mentioned_message := public.issue_3720_send_brand_group_message(
    v_conversation,
    'Can @Chidi Muted confirm the launch time?',
    NULL,
    '{}'::uuid[],
    'brand',
    ARRAY[v_muted]
  );
  RESET ROLE;

  SELECT count(*) INTO v_count
  FROM public.messages
  WHERE id = v_mentioned_message
    AND mentions = to_jsonb(ARRAY[v_muted]);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'message_mentions_not_persisted';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.notification_outbox
  WHERE category_key = 'business.brand_group_message'
    AND payload->>'message_id' = v_mentioned_message::text
    AND user_id = v_muted
    AND payload->>'mentioned' = 'true';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'muted_direct_mention_did_not_receive_one_notification:%', v_count;
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_author::text, true);
  v_plain_message := public.issue_3720_send_brand_group_message(
    v_conversation,
    'Routine update without a direct mention.',
    NULL,
    '{}'::uuid[],
    'brand',
    '{}'::uuid[]
  );
  RESET ROLE;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.brand_group_message'
      AND payload->>'message_id' = v_plain_message::text
      AND user_id = v_muted
  ) THEN
    RAISE EXCEPTION 'muted_member_received_nonmention_notification';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_author::text, true);
  BEGIN
    PERFORM public.issue_3720_send_brand_group_message(
      v_conversation,
      'This outsider must be rejected.',
      NULL,
      '{}'::uuid[],
      'brand',
      ARRAY[v_outsider]
    );
    RAISE EXCEPTION 'outsider_mention_was_accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM 1 FROM public.issue_3988_list_brand_group_mention_candidates(v_conversation, '', 8);
    RAISE EXCEPTION 'outsider_candidate_lookup_was_accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
  RESET ROLE;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.brand_group_message'
      AND payload->>'message_id' = v_mentioned_message::text
      AND user_id = v_member
      AND payload->>'mentioned' = 'false'
  ) THEN
    RAISE EXCEPTION 'ordinary_active_member_fanout_regressed';
  END IF;
END;
$proof$;

ROLLBACK;
