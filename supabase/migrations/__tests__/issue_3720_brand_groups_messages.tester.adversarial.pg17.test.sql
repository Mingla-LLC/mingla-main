-- #3720 Completion Wave 2 — independent hostile-access proof.
-- Proves cross-tenant denial, immediate revocation, actor-mode separation,
-- reply/quote containment, RPC-only writes and anonymous lockdown.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('37200000-0000-4000-b400-000000000001','wave2-adversarial-owner@test.local'),
  ('37200000-0000-4000-b400-000000000002','wave2-adversarial-member@test.local'),
  ('37200000-0000-4000-b400-000000000003','wave2-adversarial-outsider@test.local'),
  ('37200000-0000-4000-b400-000000000004','wave2-adversarial-disabled@test.local'),
  ('37200000-0000-4000-b400-000000000005','wave2-adversarial-support@test.local');

INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('37200000-0000-4000-b400-000000000001','wave2-adversarial-owner@test.local','Adversarial Owner','wave2_adv_owner','business'),
  ('37200000-0000-4000-b400-000000000002','wave2-adversarial-member@test.local','Adversarial Member','wave2_adv_member','business'),
  ('37200000-0000-4000-b400-000000000003','wave2-adversarial-outsider@test.local','Adversarial Outsider','wave2_adv_outsider','business'),
  ('37200000-0000-4000-b400-000000000004','wave2-adversarial-disabled@test.local','Disabled Support','wave2_adv_disabled','business'),
  ('37200000-0000-4000-b400-000000000005','wave2-adversarial-support@test.local','Active Support','wave2_adv_support','business');

INSERT INTO public.creator_accounts(id,email,display_name,business_name)
VALUES('37200000-0000-4000-b400-000000000001','wave2-adversarial-owner@test.local','Adversarial Owner','Adversarial Host');

INSERT INTO public.support_staff(user_id,enabled,available,display_name,role) VALUES
  ('37200000-0000-4000-b400-000000000004',false,true,'Disabled Support','staff'),
  ('37200000-0000-4000-b400-000000000005',true,false,'Active Support','staff');

-- [TEST-MOD-APPROVED #3988] Support staff must also be on the Mingla team, so
-- "enabled staff gets access, disabled loses it" is proven on real teammates.
INSERT INTO public.admin_team_members(email,role,status,accepted_at) VALUES
  ('wave2-adversarial-disabled@test.local','growth','active',now()),
  ('wave2-adversarial-support@test.local','growth','active',now());

INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('37200000-0000-4000-b500-000000000001','37200000-0000-4000-b400-000000000001','Adversarial Alpha','wave2-adversarial-alpha'),
  ('37200000-0000-4000-b500-000000000002','37200000-0000-4000-b400-000000000001','Adversarial Beta','wave2-adversarial-beta');

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES('37200000-0000-4000-b500-000000000001','37200000-0000-4000-b400-000000000002','event_manager',now());

CREATE FUNCTION pg_temp.t3720_rpc_result(p_user uuid,p_conversation uuid,p_action text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_result text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',p_user::text,true);
  IF p_action='list' THEN
    SELECT count(*)::text INTO v_result FROM public.issue_3720_list_brand_group_messages(p_conversation,20,NULL);
  ELSIF p_action='send_brand' THEN
    SELECT public.issue_3720_send_brand_group_message(p_conversation,'probe',NULL,'{}'::uuid[],'brand')::text INTO v_result;
  ELSIF p_action='send_support' THEN
    SELECT public.issue_3720_send_brand_group_message(p_conversation,'probe',NULL,'{}'::uuid[],'support')::text INTO v_result;
  ELSIF p_action='watch' THEN
    SELECT public.issue_3720_set_brand_group_watch(p_conversation,true)::text INTO v_result;
  END IF;
  RESET ROLE;
  RETURN 'OK:'||COALESCE(v_result,'');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:'||SQLSTATE||':'||SQLERRM;
END;
$$;

DO $proof$
DECLARE
  v_owner constant uuid := '37200000-0000-4000-b400-000000000001';
  v_member constant uuid := '37200000-0000-4000-b400-000000000002';
  v_outsider constant uuid := '37200000-0000-4000-b400-000000000003';
  v_disabled constant uuid := '37200000-0000-4000-b400-000000000004';
  v_support constant uuid := '37200000-0000-4000-b400-000000000005';
  v_first uuid;
  v_second uuid;
  v_first_message uuid;
  v_second_message uuid;
  v_result text;
  v_direct_blocked boolean:=false;
  v_cross_reply_blocked boolean:=false;
  v_cross_related_blocked boolean:=false;
  v_duplicate_blocked boolean:=false;
BEGIN
  SELECT id INTO STRICT v_first FROM public.conversations
  WHERE brand_id='37200000-0000-4000-b500-000000000001' AND linked_entity_type='brand';
  SELECT id INTO STRICT v_second FROM public.conversations
  WHERE brand_id='37200000-0000-4000-b500-000000000002' AND linked_entity_type='brand';

  IF pg_temp.t3720_rpc_result(v_outsider,v_first,'list') NOT LIKE 'ERR:42501:%'
     OR pg_temp.t3720_rpc_result(v_outsider,v_first,'watch') NOT LIKE 'ERR:42501:%'
     OR pg_temp.t3720_rpc_result(v_disabled,v_first,'list') NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'outsider_or_disabled_support_crossed_group_boundary';
  END IF;
  IF pg_temp.t3720_rpc_result(v_member,v_first,'send_support') NOT LIKE 'ERR:42501:%'
     OR pg_temp.t3720_rpc_result(v_support,v_first,'send_brand') NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'actor_mode_privilege_escalation_succeeded';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_member::text,true);
  v_first_message:=public.issue_3720_send_brand_group_message(v_first,'first group',NULL,'{}'::uuid[],'brand');
  BEGIN
    INSERT INTO public.messages(conversation_id,sender_id,content,message_type)
    VALUES(v_first,v_member,'direct insert bypass','text');
  EXCEPTION WHEN insufficient_privilege THEN v_direct_blocked:=true;
  END;
  RESET ROLE;
  IF NOT v_direct_blocked THEN RAISE EXCEPTION 'brand_group_direct_insert_was_not_blocked'; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_second_message:=public.issue_3720_send_brand_group_message(v_second,'second group',NULL,'{}'::uuid[],'brand');
  BEGIN
    PERFORM public.issue_3720_send_brand_group_message(v_first,'cross reply',v_second_message,'{}'::uuid[],'brand');
  EXCEPTION WHEN invalid_parameter_value THEN v_cross_reply_blocked:=true;
  END;
  BEGIN
    PERFORM public.issue_3720_send_brand_group_message(v_first,'cross related',NULL,ARRAY[v_second_message],'brand');
  EXCEPTION WHEN invalid_parameter_value THEN v_cross_related_blocked:=true;
  END;
  RESET ROLE;
  IF NOT v_cross_reply_blocked OR NOT v_cross_related_blocked THEN
    RAISE EXCEPTION 'cross_conversation_reply_or_related_context_accepted';
  END IF;

  BEGIN
    INSERT INTO public.conversations(type,linked_entity_type,brand_id,name,created_by,is_enabled,is_broadcast_only)
    VALUES('group','brand','37200000-0000-4000-b500-000000000001','Duplicate',v_owner,true,false);
  EXCEPTION WHEN unique_violation THEN v_duplicate_blocked:=true;
  END;
  IF NOT v_duplicate_blocked THEN RAISE EXCEPTION 'duplicate_official_brand_group_created'; END IF;

  UPDATE public.brand_team_members SET removed_at=now()
  WHERE brand_id='37200000-0000-4000-b500-000000000001' AND user_id=v_member AND removed_at IS NULL;
  IF pg_temp.t3720_rpc_result(v_member,v_first,'list') NOT LIKE 'ERR:42501:%'
     OR pg_temp.t3720_rpc_result(v_member,v_first,'send_brand') NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'removed_member_access_was_not_revoked_immediately';
  END IF;

  UPDATE public.support_staff SET enabled=false WHERE user_id=v_support;
  IF pg_temp.t3720_rpc_result(v_support,v_first,'list') NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'disabled_support_access_was_not_revoked_immediately';
  END IF;

  IF EXISTS(
    SELECT 1 FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
    WHERE ns.nspname='public'
      AND proc.proname LIKE 'issue_3720_%brand_group%'
      AND has_function_privilege('anon',proc.oid,'EXECUTE')
  ) OR has_function_privilege('anon','public.issue_3720_create_brand_message_product_signal(uuid,uuid,text,text,text,text,text,text,integer,text,timestamptz,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.issue_3720_link_brand_message_product_signal(uuid,integer,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anonymous_brand_group_rpc_execute_exposed';
  END IF;
  IF has_table_privilege('authenticated','public.brand_group_reads','INSERT')
     OR has_table_privilege('authenticated','public.brand_group_reads','UPDATE')
     OR has_table_privilege('authenticated','public.brand_group_audit_log','INSERT') THEN
    RAISE EXCEPTION 'authenticated_direct_mutation_grant_exposed';
  END IF;
END;
$proof$;

ROLLBACK;
