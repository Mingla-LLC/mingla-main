-- #4173 — executable privacy and current-membership proof for the Brand-group roster.
-- MINGLA-INVARIANT: I-4173-BRAND-GROUP-ROSTER-PRIVACY | issue #4173 | Brand-group roster names, emails and roles are returned only to an authenticated caller who can access that exact Brand-group conversation, and only for active accepted teammates.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t4173_people(
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO t4173_people VALUES
  ('owner',   '41730000-0000-4000-b800-000000000001', 'owner-4173@test.local',   'Olivia Owner'),
  ('member',  '41730000-0000-4000-b800-000000000002', 'member-4173@test.local',  'Manny Member'),
  ('removed', '41730000-0000-4000-b800-000000000003', 'removed-4173@test.local', 'Rina Removed'),
  ('pending', '41730000-0000-4000-b800-000000000004', 'pending-4173@test.local', 'Pia Pending'),
  ('outsider','41730000-0000-4000-b800-000000000005', 'outsider-4173@test.local','Oscar Outsider');

INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT id,email,jsonb_build_object('full_name',display_name) FROM t4173_people;
INSERT INTO public.profiles(id,email,display_name,username,account_type)
SELECT id,email,display_name,'roster_'||who,'business' FROM t4173_people;
INSERT INTO public.creator_accounts(id,email,display_name,business_name)
SELECT id,email,display_name,'Roster Test Host' FROM t4173_people WHERE who='owner';
INSERT INTO public.brands(id,account_id,name,slug)
VALUES ('41730000-0000-4000-b900-000000000001','41730000-0000-4000-b800-000000000001','Roster Test Brand','issue-4173-roster-test');

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
SELECT '41730000-0000-4000-b900-000000000001',id,
  'marketing_manager',
  CASE WHEN who='pending' THEN NULL ELSE now() END
FROM t4173_people WHERE who IN ('member','removed','pending');
UPDATE public.brand_team_members
SET removed_at=now()
WHERE brand_id='41730000-0000-4000-b900-000000000001'
  AND user_id='41730000-0000-4000-b800-000000000003';

CREATE FUNCTION pg_temp.t4173_roster_call(p_user uuid,p_conversation uuid)
RETURNS text LANGUAGE plpgsql AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_user IS NULL THEN
    SET LOCAL ROLE anon;
  ELSE
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub',p_user::text,true);
  END IF;
  SELECT jsonb_agg(to_jsonb(roster) ORDER BY roster.role,roster.email)
  INTO v_result
  FROM public.issue_4173_list_brand_group_members(p_conversation) roster;
  RESET ROLE;
  RETURN 'OK:'||COALESCE(v_result,'[]'::jsonb)::text;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:'||SQLSTATE||':'||SQLERRM;
END;
$function$;

DO $proof$
DECLARE
  v_owner constant uuid := '41730000-0000-4000-b800-000000000001';
  v_member constant uuid := '41730000-0000-4000-b800-000000000002';
  v_removed constant uuid := '41730000-0000-4000-b800-000000000003';
  v_pending constant uuid := '41730000-0000-4000-b800-000000000004';
  v_outsider constant uuid := '41730000-0000-4000-b800-000000000005';
  v_conversation uuid;
  v_result text;
  v_json jsonb;
BEGIN
  SELECT id INTO STRICT v_conversation
  FROM public.conversations
  WHERE linked_entity_type='brand'
    AND brand_id='41730000-0000-4000-b900-000000000001';

  FOREACH v_result IN ARRAY ARRAY[
    pg_temp.t4173_roster_call(NULL,v_conversation),
    pg_temp.t4173_roster_call(v_outsider,v_conversation),
    pg_temp.t4173_roster_call(v_removed,v_conversation),
    pg_temp.t4173_roster_call(v_pending,v_conversation)
  ] LOOP
    IF v_result NOT LIKE 'ERR:42501:%' THEN
      RAISE EXCEPTION 'unauthorized_roster_call_not_hidden:%',v_result;
    END IF;
  END LOOP;

  v_result:=pg_temp.t4173_roster_call(v_member,v_conversation);
  IF v_result NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'member_roster_access_failed:%',v_result; END IF;
  v_json:=substring(v_result FROM 4)::jsonb;
  IF jsonb_array_length(v_json)<>2 THEN
    RAISE EXCEPTION 'roster_did_not_return_exactly_active_members:%',v_json;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_json) row
    WHERE row->>'user_id'=v_owner::text
      AND row->>'display_name'='Olivia Owner'
      AND row->>'email'='owner-4173@test.local'
      AND row->>'role'='brand_owner'
  ) THEN RAISE EXCEPTION 'owner_identity_or_role_missing:%',v_json; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_json) row
    WHERE row->>'user_id' IN (v_removed::text,v_pending::text,v_outsider::text)
  ) THEN RAISE EXCEPTION 'inactive_or_outsider_identity_leaked:%',v_json; END IF;

  IF has_function_privilege('anon','public.issue_4173_list_brand_group_members(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.issue_4173_list_brand_group_members(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'roster_rpc_grants_wrong';
  END IF;
END;
$proof$;

ROLLBACK;
