-- #3988 — independent adversarial proof for Brand-group push fan-out.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t3988_adversarial_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3988_adversarial_people VALUES
  ('owner',          '39880000-0000-4000-ba00-000000000001', 'adv-owner@test.local',          'Owner One'),
  ('dual',           '39880000-0000-4000-ba00-000000000002', 'adv-dual@test.local',           'Dual Member'),
  ('reply',          '39880000-0000-4000-ba00-000000000003', 'adv-reply@test.local',          'Reply Author'),
  ('support_sender', '39880000-0000-4000-ba00-000000000004', 'adv-support@test.local',        'Support Sender'),
  ('disabled_staff', '39880000-0000-4000-ba00-000000000005', 'adv-disabled-staff@test.local', 'Disabled Staff'),
  ('inactive_admin', '39880000-0000-4000-ba00-000000000006', 'adv-inactive-admin@test.local', 'Inactive Admin'),
  ('outsider',       '39880000-0000-4000-ba00-000000000007', 'adv-outsider@test.local',       'Outside User');

INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT id,email,jsonb_build_object('full_name',display_name)
FROM t3988_adversarial_people;

INSERT INTO public.profiles(id,email,display_name,username,account_type)
SELECT id,email,display_name,'issue3988_adv_'||who,'business'
FROM t3988_adversarial_people;

INSERT INTO public.creator_accounts(id,email,display_name,business_name)
SELECT id,email,display_name,'Issue 3988 Adversarial Host'
FROM t3988_adversarial_people WHERE who='owner';

INSERT INTO public.support_staff(user_id,enabled,available,display_name,role)
SELECT id,
  who<>'disabled_staff',
  true,
  display_name,
  'staff'
FROM t3988_adversarial_people
WHERE who IN ('dual','support_sender','disabled_staff');

INSERT INTO public.admin_team_members(email,role,status,accepted_at)
SELECT email,'growth','active',now()
FROM t3988_adversarial_people
WHERE who IN ('dual','support_sender','disabled_staff');

INSERT INTO public.admin_users(email,role,status,accepted_at)
SELECT email,'admin','revoked',now()
FROM t3988_adversarial_people WHERE who='inactive_admin';

INSERT INTO public.brands(id,account_id,name,slug)
VALUES(
  '39880000-0000-4000-bb00-000000000001',
  '39880000-0000-4000-ba00-000000000001',
  'Adversarial Push Brand',
  'issue-3988-adversarial-push'
);

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
SELECT '39880000-0000-4000-bb00-000000000001',id,'marketing_manager',now()
FROM t3988_adversarial_people WHERE who IN ('dual','reply');

CREATE FUNCTION pg_temp.t3988_push_rpc(
  p_user uuid,
  p_conversation uuid,
  p_action text,
  p_reply uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE v_result text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',p_user::text,true);
  IF p_action='mute' THEN
    SELECT public.issue_3988_set_brand_group_muted(p_conversation,true)::text INTO v_result;
  ELSIF p_action='send_brand' THEN
    SELECT public.issue_3720_send_brand_group_message(
      p_conversation,'adversarial brand send',p_reply,'{}'::uuid[],'brand'
    )::text INTO v_result;
  ELSIF p_action='send_support' THEN
    SELECT public.issue_3720_send_brand_group_message(
      p_conversation,'adversarial support send',p_reply,'{}'::uuid[],'support'
    )::text INTO v_result;
  END IF;
  RESET ROLE;
  RETURN 'OK:'||COALESCE(v_result,'');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:'||SQLSTATE||':'||SQLERRM;
END;
$function$;

DO $proof$
DECLARE
  v_owner constant uuid := '39880000-0000-4000-ba00-000000000001';
  v_dual constant uuid := '39880000-0000-4000-ba00-000000000002';
  v_reply constant uuid := '39880000-0000-4000-ba00-000000000003';
  v_support constant uuid := '39880000-0000-4000-ba00-000000000004';
  v_disabled constant uuid := '39880000-0000-4000-ba00-000000000005';
  v_inactive_admin constant uuid := '39880000-0000-4000-ba00-000000000006';
  v_outsider constant uuid := '39880000-0000-4000-ba00-000000000007';
  v_brand constant uuid := '39880000-0000-4000-bb00-000000000001';
  v_conversation uuid;
  v_reply_message uuid;
  v_support_message uuid;
  v_last_read_before timestamptz;
  v_count_before bigint;
  v_result text;
BEGIN
  SELECT id INTO STRICT v_conversation
  FROM public.conversations
  WHERE brand_id=v_brand AND linked_entity_type='brand';

  v_result:=pg_temp.t3988_push_rpc(v_outsider,v_conversation,'mute');
  IF v_result NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'outsider_muted_foreign_group:%',v_result;
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_reply::text,true);
  v_reply_message:=public.issue_3720_send_brand_group_message(
    v_conversation,'Reply target seed',NULL,'{}'::uuid[],'brand'
  );
  PERFORM public.issue_3720_mark_brand_group_read(v_conversation);
  SELECT last_read_at INTO STRICT v_last_read_before
  FROM public.brand_group_reads
  WHERE conversation_id=v_conversation AND user_id=v_reply;
  PERFORM public.issue_3988_set_brand_group_muted(v_conversation,true);
  IF (SELECT last_read_at FROM public.brand_group_reads
      WHERE conversation_id=v_conversation AND user_id=v_reply)
      IS DISTINCT FROM v_last_read_before THEN
    RAISE EXCEPTION 'mute_changed_last_read_at';
  END IF;
  RESET ROLE;

  DELETE FROM public.notification_outbox
  WHERE category_key='business.brand_group_message';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_support::text,true);
  v_support_message:=public.issue_3720_send_brand_group_message(
    v_conversation,'Support reply after mute',v_reply_message,'{}'::uuid[],'support'
  );
  RESET ROLE;

  IF (SELECT count(*) FROM public.notification_outbox
      WHERE category_key='business.brand_group_message'
        AND payload->>'message_id'=v_support_message::text)<>2 THEN
    RAISE EXCEPTION 'support_send_fanout_count_wrong';
  END IF;
  IF (SELECT count(*) FROM public.notification_outbox
      WHERE category_key='business.brand_group_message'
        AND payload->>'message_id'=v_support_message::text
        AND user_id=v_dual)<>1 THEN
    RAISE EXCEPTION 'dual_member_staff_was_not_deduplicated';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.brand_group_message'
      AND payload->>'message_id'=v_support_message::text
      AND user_id IN (v_support,v_reply,v_disabled,v_inactive_admin)
  ) THEN
    RAISE EXCEPTION 'sender_muted_reply_disabled_staff_or_inactive_admin_received_push';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.brand_group_message'
      AND payload->>'message_id'=v_support_message::text
      AND user_id=v_owner
  ) THEN RAISE EXCEPTION 'eligible_owner_missing_from_support_send'; END IF;

  SELECT count(*) INTO v_count_before
  FROM public.notification_outbox
  WHERE category_key='business.brand_group_message';
  UPDATE public.conversations SET is_enabled=false WHERE id=v_conversation;
  v_result:=pg_temp.t3988_push_rpc(v_owner,v_conversation,'send_brand');
  IF v_result NOT LIKE 'ERR:42501:%' OR
     (SELECT count(*) FROM public.notification_outbox
      WHERE category_key='business.brand_group_message')<>v_count_before THEN
    RAISE EXCEPTION 'disabled_group_produced_notification:%',v_result;
  END IF;

  UPDATE public.conversations SET is_enabled=true WHERE id=v_conversation;
  UPDATE public.brands SET deleted_at=now() WHERE id=v_brand;
  v_result:=pg_temp.t3988_push_rpc(v_owner,v_conversation,'send_brand');
  IF v_result NOT LIKE 'ERR:42501:%' OR
     (SELECT count(*) FROM public.notification_outbox
      WHERE category_key='business.brand_group_message')<>v_count_before THEN
    RAISE EXCEPTION 'soft_deleted_brand_produced_notification:%',v_result;
  END IF;

  IF has_function_privilege(
    'anon','public.issue_3988_set_brand_group_muted(uuid,boolean)','EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated','public.issue_3988_set_brand_group_muted(uuid,boolean)','EXECUTE'
  ) THEN RAISE EXCEPTION 'mute_rpc_grants_wrong'; END IF;
END;
$proof$;

ROLLBACK;
