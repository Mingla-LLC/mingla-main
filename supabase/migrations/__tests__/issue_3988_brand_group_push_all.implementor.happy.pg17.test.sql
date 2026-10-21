-- #3988 — happy-path executable proof for all-participant Brand-group push.
-- FAILS-ON-REVERT: reverting either producer to the #3720 watcher-only CTE
-- removes required B/C/staff/admin rows and fails the exact recipient checks.
-- MINGLA-INVARIANT: I-3988-BRAND-GROUP-PUSH-ALL-PARTICIPANTS | issue #3988 | Every eligible participant receives one durable row per message except the sender and muted users; the global v2 channel preference remains default-on when absent.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t3988_push_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3988_push_people VALUES
  ('a',       '39880000-0000-4000-b800-000000000001', 'push-a@test.local',       'Amina Author'),
  ('b',       '39880000-0000-4000-b800-000000000002', 'push-b@test.local',       'Bola Brand'),
  ('c',       '39880000-0000-4000-b800-000000000003', 'push-c@test.local',       'Chidi Brand'),
  ('removed', '39880000-0000-4000-b800-000000000004', 'push-removed@test.local', 'Rita Removed'),
  ('staff',   '39880000-0000-4000-b800-000000000005', 'push-staff@test.local',   'Sam Support'),
  ('admin',   '39880000-0000-4000-b800-000000000006', 'push-admin@test.local',   'Ada Admin');

INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT id,email,jsonb_build_object('full_name',display_name)
FROM t3988_push_people;

INSERT INTO public.profiles(id,email,display_name,username,account_type)
SELECT id,email,display_name,'issue3988_'||who,'business'
FROM t3988_push_people;

INSERT INTO public.creator_accounts(id,email,display_name,business_name)
SELECT id,email,display_name,'Issue 3988 Host'
FROM t3988_push_people WHERE who='a';

INSERT INTO public.support_staff(user_id,enabled,available,display_name,role)
SELECT id,true,true,display_name,'staff'
FROM t3988_push_people WHERE who='staff';

INSERT INTO public.admin_team_members(email,role,status,accepted_at)
SELECT email,'growth','active',now()
FROM t3988_push_people WHERE who='staff';

INSERT INTO public.admin_users(email,role,status,accepted_at)
SELECT email,'admin','active',now()
FROM t3988_push_people WHERE who='admin';

INSERT INTO public.brands(id,account_id,name,slug)
VALUES(
  '39880000-0000-4000-b900-000000000001',
  '39880000-0000-4000-b800-000000000001',
  'All Push Brand',
  'issue-3988-all-push-brand'
);

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
SELECT
  '39880000-0000-4000-b900-000000000001',id,'marketing_manager',now()
FROM t3988_push_people WHERE who IN ('b','c','removed');

UPDATE public.brand_team_members
SET removed_at=now()
WHERE brand_id='39880000-0000-4000-b900-000000000001'
  AND user_id='39880000-0000-4000-b800-000000000004';

DO $proof$
DECLARE
  v_a constant uuid := '39880000-0000-4000-b800-000000000001';
  v_b constant uuid := '39880000-0000-4000-b800-000000000002';
  v_c constant uuid := '39880000-0000-4000-b800-000000000003';
  v_removed constant uuid := '39880000-0000-4000-b800-000000000004';
  v_staff constant uuid := '39880000-0000-4000-b800-000000000005';
  v_admin constant uuid := '39880000-0000-4000-b800-000000000006';
  v_conversation uuid;
  v_first uuid;
  v_second uuid;
  v_file uuid;
  v_file_message uuid;
  v_file_retry uuid;
  v_prepared jsonb;
  v_count bigint;
  v_muted boolean;
BEGIN
  SELECT id INTO STRICT v_conversation
  FROM public.conversations
  WHERE brand_id='39880000-0000-4000-b900-000000000001'
    AND linked_entity_type='brand';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_a::text,true);
  v_first:=public.issue_3720_send_brand_group_message(
    v_conversation,'Every participant should receive this message.',NULL,'{}'::uuid[],'brand'
  );
  RESET ROLE;

  SELECT count(*) INTO v_count
  FROM public.notification_outbox
  WHERE category_key='business.brand_group_message'
    AND payload->>'message_id'=v_first::text;
  IF v_count<>4 THEN RAISE EXCEPTION 'first_fanout_count_wrong:%',v_count; END IF;

  IF EXISTS (
    (SELECT expected.user_id
     FROM (VALUES(v_b),(v_c),(v_staff),(v_admin)) AS expected(user_id)
     EXCEPT
     SELECT outbox.user_id FROM public.notification_outbox outbox
     WHERE outbox.category_key='business.brand_group_message'
       AND outbox.payload->>'message_id'=v_first::text)
    UNION ALL
    (SELECT outbox.user_id FROM public.notification_outbox outbox
     WHERE outbox.category_key='business.brand_group_message'
       AND outbox.payload->>'message_id'=v_first::text
     EXCEPT
     SELECT expected.user_id
     FROM (VALUES(v_b),(v_c),(v_staff),(v_admin)) AS expected(user_id))
  ) THEN RAISE EXCEPTION 'first_fanout_recipient_set_wrong'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.brand_group_message'
      AND payload->>'message_id'=v_first::text
      AND user_id IN (v_a,v_removed)
  ) THEN RAISE EXCEPTION 'sender_or_removed_member_received_first_push'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.brand_group_message'
      AND payload->>'message_id'=v_first::text
      AND (
        payload->>'deep_link'<>'mingla-business://messages/'||v_conversation::text
        OR idempotency_key<>'business.brand_group_message:'||v_first::text||':'||user_id::text
        OR country_code IS NOT NULL
      )
  ) THEN RAISE EXCEPTION 'first_fanout_route_or_idempotency_wrong'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.notification_channel_prefs
    WHERE user_id=v_b AND category_key='business.brand_group_message' AND channel='push'
  ) OR public.can_send(v_b,'business.brand_group_message','push',NULL) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'absent_global_channel_pref_was_not_allowed';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_c::text,true);
  IF public.issue_3988_set_brand_group_muted(v_conversation,true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'mute_rpc_did_not_return_true';
  END IF;
  SELECT muted INTO v_muted
  FROM public.issue_3720_list_brand_groups()
  WHERE conversation_id=v_conversation;
  IF v_muted IS DISTINCT FROM true THEN RAISE EXCEPTION 'list_rpc_did_not_return_muted'; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_a::text,true);
  v_second:=public.issue_3720_send_brand_group_message(
    v_conversation,'Muted C should be the only eligible participant skipped.',v_first,'{}'::uuid[],'brand'
  );
  v_prepared:=public.issue_3720_prepare_brand_group_files(
    v_conversation,'brand','[{"name":"run-sheet.pdf","mime_type":"application/pdf","size_bytes":128}]'::jsonb
  );
  RESET ROLE;

  SELECT (v_prepared->0->>'file_id')::uuid INTO STRICT v_file;

  SELECT count(*) INTO v_count
  FROM public.notification_outbox
  WHERE category_key='business.brand_group_message'
    AND payload->>'message_id'=v_second::text;
  IF v_count<>3 OR EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.brand_group_message'
      AND payload->>'message_id'=v_second::text AND user_id=v_c
  ) THEN RAISE EXCEPTION 'muted_recipient_was_not_skipped:%',v_count; END IF;

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SET LOCAL ROLE service_role;
  v_file_message:=public.issue_3720_complete_brand_group_file(
    v_file,'drive-issue-3988-file','application/pdf',128
  );
  v_file_retry:=public.issue_3720_complete_brand_group_file(
    v_file,'drive-issue-3988-file','application/pdf',128
  );
  RESET ROLE;

  IF v_file_retry<>v_file_message THEN RAISE EXCEPTION 'file_retry_changed_message_id'; END IF;
  SELECT count(*) INTO v_count
  FROM public.notification_outbox
  WHERE category_key='business.brand_group_message'
    AND payload->>'message_id'=v_file_message::text;
  IF v_count<>3 THEN RAISE EXCEPTION 'file_fanout_or_retry_count_wrong:%',v_count; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.brand_group_message'
      AND payload->>'message_id'=v_file_message::text
      AND (
        user_id=v_c
        OR payload->>'body'<>'Shared a file: run-sheet.pdf'
        OR payload->>'deep_link'<>'mingla-business://messages/'||v_conversation::text
        OR idempotency_key<>'business.brand_group_message:'||v_file_message::text||':'||user_id::text
      )
  ) THEN RAISE EXCEPTION 'file_fanout_payload_or_mute_wrong'; END IF;

  IF (SELECT count(*) FROM public.brand_group_audit_log
      WHERE conversation_id=v_conversation AND actor_user_id=v_c AND action='muted')<>1 THEN
    RAISE EXCEPTION 'mute_audit_row_missing';
  END IF;
END;
$proof$;

ROLLBACK;
