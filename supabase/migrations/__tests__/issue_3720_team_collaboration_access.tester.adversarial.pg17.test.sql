-- #3720 Completion Wave 6 — independent least-privilege proof.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('37200000-0000-4000-8000-000000000691','wave6-outsider@test.local',now()),
  ('37200000-0000-4000-8000-000000000692','wave6-revoked@test.local',now()),
  ('37200000-0000-4000-8000-000000000693','wave6-growth-denied@test.local',now());
INSERT INTO public.admin_team_members(email,role,status,accepted_at) VALUES
  ('wave6-revoked@test.local','partner','revoked',now()),
  ('wave6-growth-denied@test.local','growth','active',now());

DO $proof$
DECLARE
  v_outsider constant uuid := '37200000-0000-4000-8000-000000000691';
  v_revoked constant uuid := '37200000-0000-4000-8000-000000000692';
  v_growth constant uuid := '37200000-0000-4000-8000-000000000693';
  v_denied boolean;
BEGIN
  IF public.issue_3720_active_team_member(v_outsider)
     OR public.issue_3720_active_team_member(v_revoked)
     OR public.is_support_staff(v_outsider)
     OR public.is_support_staff(v_revoked) THEN
    RAISE EXCEPTION 'inactive_identity_received_team_access';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_denied:=false;
  BEGIN PERFORM public.issue_3720_list_team_mentions(50,NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'outsider_listed_mentions'; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_growth::text,true);
  v_denied:=false;
  BEGIN PERFORM public.issue_3720_list_data_room_access(10);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'growth_read_data_room_audit'; END IF;
  v_denied:=false;
  BEGIN PERFORM public.issue_3720_log_data_room_access(v_growth,'room_open',NULL,true);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'authenticated_forged_data_room_audit'; END IF;
  RESET ROLE;

  IF has_table_privilege('authenticated','public.team_mentions','INSERT')
     OR has_table_privilege('authenticated','public.team_mentions','UPDATE')
     OR has_table_privilege('authenticated','public.team_data_room_access_log','SELECT')
     OR has_function_privilege('anon','public.issue_3720_team_my_permissions()','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3720_log_data_room_access(uuid,text,text,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'wave6_acl_open';
  END IF;
  IF public.admin_team_role_areas('growth') && ARRAY['admin_console','team_manage']::text[]
     OR public.admin_team_role_areas('partner') && ARRAY['admin_console','team_manage']::text[] THEN
    RAISE EXCEPTION 'nonadmin_privilege_drift';
  END IF;
END;
$proof$;
ROLLBACK;
