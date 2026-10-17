-- #3720 Completion Wave 2 — official Brand groups executable happy path.
-- MINGLA-INVARIANT: I-3720-BRAND-GROUP-DERIVATION | issue #3720 | Every non-deleted Host brand has exactly one official Brand group whose participant roster follows accepted, non-removed brand membership.
-- MINGLA-INVARIANT: I-3720-BRAND-GROUP-ATTRIBUTION | issue #3720 | Brand-group messages are RPC-only, preserve reply/related context and snapshot a real sender name plus the Mingla Support role when applicable.
-- MINGLA-INVARIANT: I-3720-BRAND-GROUP-SYNC | issue #3720 | Read/watch state and message activity are realtime-capable and notification fan-out remains recipient-scoped.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t3720_brand_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3720_brand_people VALUES
  ('owner',   '37200000-0000-4000-b100-000000000001', 'wave2-owner@test.local',   'Olivia Owner'),
  ('member',  '37200000-0000-4000-b100-000000000002', 'wave2-member@test.local',  'Maya Member'),
  ('dual',    '37200000-0000-4000-b100-000000000003', 'wave2-dual@test.local',    'Dayo Dual'),
  ('support', '37200000-0000-4000-b100-000000000004', 'wave2-support@test.local', 'Simone Support'),
  ('removed', '37200000-0000-4000-b100-000000000005', 'wave2-removed@test.local', 'Riley Removed');

INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT id,email,jsonb_build_object('full_name',display_name)
FROM t3720_brand_people;

INSERT INTO public.profiles(id,email,display_name,username,account_type)
SELECT id,email,display_name,'wave2_'||who,'business'
FROM t3720_brand_people;

INSERT INTO public.creator_accounts(id,email,display_name,business_name)
SELECT id,email,display_name,'Wave 2 Host'
FROM t3720_brand_people WHERE who='owner';

INSERT INTO public.support_staff(user_id,enabled,available,display_name,role)
SELECT id,true,true,display_name,'staff'
FROM t3720_brand_people WHERE who IN ('support','dual');

INSERT INTO public.brands(id,account_id,name,slug)
VALUES
  ('37200000-0000-4000-b200-000000000001', '37200000-0000-4000-b100-000000000001', 'Acme Social', 'wave2-acme-social'),
  ('37200000-0000-4000-b200-000000000002', '37200000-0000-4000-b100-000000000001', 'Bravo Nights', 'wave2-bravo-nights');

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
SELECT '37200000-0000-4000-b200-000000000001',id,'marketing_manager',now()
FROM t3720_brand_people WHERE who IN ('member','dual','removed');

DO $proof$
DECLARE
  v_brand constant uuid := '37200000-0000-4000-b200-000000000001';
  v_brand_two constant uuid := '37200000-0000-4000-b200-000000000002';
  v_member constant uuid := '37200000-0000-4000-b100-000000000002';
  v_dual constant uuid := '37200000-0000-4000-b100-000000000003';
  v_support constant uuid := '37200000-0000-4000-b100-000000000004';
  v_removed constant uuid := '37200000-0000-4000-b100-000000000005';
  v_conversation uuid;
  v_second_conversation uuid;
  v_member_message uuid;
  v_support_message uuid;
  v_dual_message uuid;
  v_signal uuid;
  v_count bigint;
  v_text text;
BEGIN
  SELECT id INTO STRICT v_conversation
  FROM public.conversations
  WHERE linked_entity_type='brand' AND brand_id=v_brand;
  SELECT id INTO STRICT v_second_conversation
  FROM public.conversations
  WHERE linked_entity_type='brand' AND brand_id=v_brand_two;

  IF (SELECT count(*) FROM public.conversations WHERE linked_entity_type='brand' AND brand_id=v_brand) <> 1
     OR (SELECT count(*) FROM public.conversations WHERE linked_entity_type='brand' AND brand_id=v_brand_two) <> 1 THEN
    RAISE EXCEPTION 'one_official_group_per_brand_failed';
  END IF;
  IF (SELECT count(*) FROM public.conversation_participants WHERE conversation_id=v_conversation) <> 4 THEN
    RAISE EXCEPTION 'derived_roster_missing_active_members';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_member::text,true);
  SELECT count(*),min(access_kind) INTO v_count,v_text FROM public.issue_3720_list_brand_groups();
  IF v_count<>1 OR v_text<>'brand' THEN RAISE EXCEPTION 'member_group_listing_wrong:%:%',v_count,v_text; END IF;
  v_member_message:=public.issue_3720_send_brand_group_message(
    v_conversation,'Can Support confirm the new campaign date?',NULL,'{}'::uuid[],'brand'
  );
  RESET ROLE;

  IF (SELECT sender_display_name_snapshot FROM public.messages WHERE id=v_member_message)<>'Maya Member'
     OR (SELECT sender_role_snapshot FROM public.messages WHERE id=v_member_message) IS NOT NULL THEN
    RAISE EXCEPTION 'brand_sender_snapshot_wrong';
  END IF;
  -- All calls in this executable proof share one outer transaction, so now()
  -- is stable. Move the member's read cursor behind the next fixture message
  -- to model two real API transactions.
  UPDATE public.brand_group_reads
  SET last_read_at=now()-interval '1 second'
  WHERE conversation_id=v_conversation AND user_id=v_member;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_support::text,true);
  SELECT count(*),min(access_kind) INTO v_count,v_text FROM public.issue_3720_list_brand_groups();
  IF v_count<>2 OR v_text<>'support' THEN RAISE EXCEPTION 'support_cross_brand_listing_wrong:%:%',v_count,v_text; END IF;
  IF public.issue_3720_set_brand_group_watch(v_conversation,true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'watch_toggle_not_persisted';
  END IF;
  v_support_message:=public.issue_3720_send_brand_group_message(
    v_conversation,'Yes — we will confirm it with you today.',v_member_message,ARRAY[v_member_message],'support'
  );
  RESET ROLE;

  IF (SELECT sender_display_name_snapshot FROM public.messages WHERE id=v_support_message)<>'Simone Support'
     OR (SELECT sender_role_snapshot FROM public.messages WHERE id=v_support_message)<>'Mingla Support'
     OR (SELECT reply_to_id FROM public.messages WHERE id=v_support_message)<>v_member_message
     OR (SELECT related_message_ids FROM public.messages WHERE id=v_support_message)<>ARRAY[v_member_message] THEN
    RAISE EXCEPTION 'support_attribution_or_reply_context_wrong';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.brand_group_message'
      AND user_id=v_member
      AND payload->>'conversation_id'=v_conversation::text
      AND payload->>'deep_link'='mingla-business://messages/'||v_conversation::text
  ) THEN RAISE EXCEPTION 'reply_notification_missing_or_misrouted'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.brand_group_message'
      AND country_code IS NOT NULL
  ) THEN RAISE EXCEPTION 'push_only_brand_group_notification_invented_sms_country'; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_member::text,true);
  SELECT unread_count INTO v_count FROM public.issue_3720_list_brand_groups()
  WHERE conversation_id=v_conversation;
  IF v_count<>1 THEN RAISE EXCEPTION 'member_unread_count_wrong:%',v_count; END IF;
  PERFORM public.issue_3720_mark_brand_group_read(v_conversation);
  SELECT unread_count INTO v_count FROM public.issue_3720_list_brand_groups()
  WHERE conversation_id=v_conversation;
  IF v_count<>0 THEN RAISE EXCEPTION 'read_state_did_not_clear_unread:%',v_count; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_dual::text,true);
  SELECT access_kind INTO v_text FROM public.issue_3720_list_brand_groups()
  WHERE conversation_id=v_conversation;
  IF v_text<>'brand' THEN RAISE EXCEPTION 'dual_role_group_not_deduplicated_as_brand'; END IF;
  v_dual_message:=public.issue_3720_send_brand_group_message(
    v_conversation,'I am replying in my Support capacity.',v_support_message,'{}'::uuid[],'support'
  );
  v_signal:=public.issue_3720_create_brand_message_product_signal(
    '37200000-0000-4000-b300-000000000001',v_member_message,'feature',
    'Campaign date confirmation','Hosts need a confirmed campaign date.',
    'Host Messages','A host asks Support inside the official Brand group.',
    'The host cannot finish campaign planning.',1,'normal',now()+interval '1 day',
    'Product confirms the canonical date source.','We recorded this with Product and will update you tomorrow.'
  );
  RESET ROLE;

  IF (SELECT sender_role_snapshot FROM public.messages WHERE id=v_dual_message)<>'Mingla Support'
     OR NOT EXISTS(
       SELECT 1 FROM public.support_product_signal_sources
       WHERE signal_id=v_signal AND source_kind='brand_group_message' AND source_id=v_member_message
     ) THEN RAISE EXCEPTION 'dual_role_or_product_signal_bridge_failed'; END IF;

  UPDATE public.brand_team_members SET removed_at=now()
  WHERE brand_id=v_brand AND user_id=v_removed AND removed_at IS NULL;
  IF EXISTS(
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id=v_conversation AND user_id=v_removed
  ) THEN RAISE EXCEPTION 'removed_member_remained_in_derived_roster'; END IF;

  UPDATE public.brands SET name='Acme Social Updated' WHERE id=v_brand;
  IF (SELECT name FROM public.conversations WHERE id=v_conversation)<>'Acme Social Updated · Brand group' THEN
    RAISE EXCEPTION 'brand_group_name_did_not_follow_brand';
  END IF;

  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
     AND NOT EXISTS(
       SELECT 1 FROM pg_publication_tables
       WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='brand_group_reads'
     ) THEN RAISE EXCEPTION 'brand_group_read_state_not_realtime'; END IF;
END;
$proof$;

ROLLBACK;
