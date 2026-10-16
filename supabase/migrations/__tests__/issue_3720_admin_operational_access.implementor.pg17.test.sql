-- #3720 scoped Admin Community & Support access, executable PostgreSQL 17 proof.
-- Runs after the complete migration replay and rolls every fixture back.
-- MINGLA-INVARIANT: I-3720-ADMIN-OPERATIONAL-ACCESS | issue #3720 | Operational grants never confer admin_console and require an active Admin team membership.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t3720_access_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3720_access_people VALUES
  ('owner',     '37200000-0000-4000-a100-000000000001', 'issue3720-access-owner@test.local'),
  ('admin',     '37200000-0000-4000-a100-000000000002', 'issue3720-access-admin@test.local'),
  ('support',   '37200000-0000-4000-a100-000000000003', 'issue3720-access-support@test.local'),
  ('community', '37200000-0000-4000-a100-000000000004', 'issue3720-access-community@test.local'),
  ('dual',      '37200000-0000-4000-a100-000000000005', 'issue3720-access-dual@test.local'),
  ('ordinary',  '37200000-0000-4000-a100-000000000006', 'issue3720-access-ordinary@test.local'),
  ('invited',   '37200000-0000-4000-a100-000000000007', 'issue3720-access-invited@test.local'),
  ('outsider',  '37200000-0000-4000-a100-000000000008', 'issue3720-access-outsider@test.local');

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT id, email, now() FROM t3720_access_people;

INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('issue3720-access-owner@test.local', 'owner', 'active', now()),
  ('issue3720-access-admin@test.local', 'admin', 'active', now());

INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue3720-access-support@test.local', 'growth', 'active', now()),
  ('issue3720-access-community@test.local', 'growth', 'active', now()),
  ('issue3720-access-dual@test.local', 'partner', 'active', now()),
  ('issue3720-access-ordinary@test.local', 'growth', 'active', now()),
  ('issue3720-access-invited@test.local', 'growth', 'invited', null);

INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('37200000-0000-4000-a100-000000000003', true, false, 'staff'),
  ('37200000-0000-4000-a100-000000000005', true, false, 'lead'),
  ('37200000-0000-4000-a100-000000000006', false, false, 'staff'),
  ('37200000-0000-4000-a100-000000000008', true, false, 'staff');

INSERT INTO public.community_staff (user_id, role, enabled) VALUES
  ('37200000-0000-4000-a100-000000000004', 'moderator', true),
  ('37200000-0000-4000-a100-000000000005', 'agent', true),
  ('37200000-0000-4000-a100-000000000006', 'moderator', false),
  ('37200000-0000-4000-a100-000000000008', 'agent', true);

CREATE FUNCTION pg_temp.t3720_operational(p_who text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_answer text;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t3720_access_people WHERE who = p_who;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.email', v_email, true);
  SELECT public.admin_team_my_operational_areas()::text INTO v_answer;
  RESET ROLE;
  RETURN v_answer;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

CREATE FUNCTION pg_temp.t3720_base_areas(p_who text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_answer text;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t3720_access_people WHERE who = p_who;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.email', v_email, true);
  SELECT public.admin_team_my_access()->>'areas' INTO v_answer;
  RESET ROLE;
  RETURN v_answer;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

DO $proof$
BEGIN
  IF pg_temp.t3720_operational('owner') <> '{community_support,community_support_support,community_support_community}'
     OR pg_temp.t3720_operational('admin') <> '{community_support,community_support_support,community_support_community}' THEN
    RAISE EXCEPTION 'full_admin_operational_areas_wrong';
  END IF;
  IF pg_temp.t3720_operational('support') <> '{community_support,community_support_support}' THEN
    RAISE EXCEPTION 'support_operational_areas_wrong';
  END IF;
  IF pg_temp.t3720_operational('community') <> '{community_support,community_support_community}' THEN
    RAISE EXCEPTION 'community_operational_areas_wrong';
  END IF;
  IF pg_temp.t3720_operational('dual') <> '{community_support,community_support_support,community_support_community}' THEN
    RAISE EXCEPTION 'dual_operational_areas_wrong';
  END IF;
  IF pg_temp.t3720_operational('ordinary') <> '{}'
     OR pg_temp.t3720_operational('invited') <> '{}'
     OR pg_temp.t3720_operational('outsider') <> '{}' THEN
    RAISE EXCEPTION 'inactive_disabled_or_non_team_grant_widened_access';
  END IF;
  IF pg_temp.t3720_base_areas('support') <> '["role_home", "crm", "beta_leads"]' THEN
    RAISE EXCEPTION 'base_role_area_contract_changed';
  END IF;
  IF has_function_privilege('anon', 'public.admin_team_my_operational_areas()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_team_my_operational_areas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'operational_access_acl_wrong';
  END IF;
END;
$proof$;

ROLLBACK;
