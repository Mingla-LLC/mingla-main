-- #3720 Admin -> Community & Support -> Team loads, executable PostgreSQL 17 proof.
-- Runs after the complete migration replay and rolls every fixture back.
-- Before 20271115003720 every call raised 42702
-- `column reference "user_id" is ambiguous`; this suite calls the real
-- function as a signed-in admin with Community and Support staff present.
-- It also executes every other plpgsql RETURNS TABLE read model added by the
-- Wave 8 Community console migrations, because an output-column collision only
-- surfaces when the query runs, never at CREATE time.
-- MINGLA-INVARIANT: I-3720-ADMIN-TEAM-ROSTER-LOADS | issue #3720 | The Admin Team roster RPC returns rows for an admin when Community and Support staff exist; every column reference that shares a name with an output column is table-qualified.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t3720_roster_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3720_roster_people VALUES
  ('admin',     '37200000-0000-4000-a115-000000000001', 'issue3720-roster-admin@test.local'),
  ('community', '37200000-0000-4000-a115-000000000002', 'issue3720-roster-community@test.local'),
  ('support',   '37200000-0000-4000-a115-000000000003', 'issue3720-roster-support@test.local'),
  ('dual',      '37200000-0000-4000-a115-000000000004', 'issue3720-roster-dual@test.local'),
  ('disabled',  '37200000-0000-4000-a115-000000000005', 'issue3720-roster-disabled@test.local'),
  ('outsider',  '37200000-0000-4000-a115-000000000006', 'issue3720-roster-outsider@test.local');

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT id, email, now() FROM t3720_roster_people;

INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('issue3720-roster-admin@test.local', 'admin', 'active', now());

INSERT INTO public.community_staff (user_id, role, enabled, display_name) VALUES
  ('37200000-0000-4000-a115-000000000002', 'moderator', true, 'Roster Moderator'),
  ('37200000-0000-4000-a115-000000000004', 'agent', true, NULL),
  ('37200000-0000-4000-a115-000000000005', 'moderator', false, NULL);

INSERT INTO public.support_staff (user_id, enabled, available, role, display_name) VALUES
  ('37200000-0000-4000-a115-000000000003', true, true, 'staff', 'Roster Support'),
  ('37200000-0000-4000-a115-000000000004', true, false, 'lead', NULL),
  ('37200000-0000-4000-a115-000000000005', false, false, 'staff', NULL);

CREATE TEMP TABLE t3720_roster_result (
  user_id uuid,
  display_name text,
  email text,
  community_role text,
  support_role text,
  available boolean,
  last_active timestamptz,
  enabled boolean
) ON COMMIT DROP;
GRANT ALL ON t3720_roster_result TO authenticated;
GRANT SELECT ON t3720_roster_people TO authenticated;

CREATE FUNCTION pg_temp.t3720_as(p_who text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t3720_roster_people WHERE who = p_who;
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.email', v_email, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
END;
$$;

-- 1. The admin loads the roster.
SELECT pg_temp.t3720_as('admin');
SET LOCAL ROLE authenticated;
INSERT INTO t3720_roster_result SELECT * FROM public.issue_3720_admin_team_roster();
RESET ROLE;

DO $proof$
DECLARE
  v_row record;
BEGIN
  IF (SELECT count(*) FROM t3720_roster_result r
       JOIN t3720_roster_people p ON p.id = r.user_id) <> 4 THEN
    RAISE EXCEPTION 'roster_fixture_rows_expected_4_got_%',
      (SELECT count(*) FROM t3720_roster_result r JOIN t3720_roster_people p ON p.id = r.user_id);
  END IF;

  SELECT * INTO v_row FROM t3720_roster_result WHERE user_id = '37200000-0000-4000-a115-000000000001';
  IF NOT FOUND OR v_row.community_role IS DISTINCT FROM 'admin' OR v_row.enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'roster_admin_row_wrong: %', row_to_json(v_row);
  END IF;

  SELECT * INTO v_row FROM t3720_roster_result WHERE user_id = '37200000-0000-4000-a115-000000000002';
  IF NOT FOUND OR v_row.community_role IS DISTINCT FROM 'moderator'
     OR v_row.support_role IS NOT NULL OR v_row.display_name IS DISTINCT FROM 'Roster Moderator' THEN
    RAISE EXCEPTION 'roster_community_row_wrong: %', row_to_json(v_row);
  END IF;

  SELECT * INTO v_row FROM t3720_roster_result WHERE user_id = '37200000-0000-4000-a115-000000000003';
  IF NOT FOUND OR v_row.support_role IS DISTINCT FROM 'staff' OR v_row.available IS NOT TRUE
     OR v_row.community_role IS NOT NULL OR v_row.display_name IS DISTINCT FROM 'Roster Support' THEN
    RAISE EXCEPTION 'roster_support_row_wrong: %', row_to_json(v_row);
  END IF;

  SELECT * INTO v_row FROM t3720_roster_result WHERE user_id = '37200000-0000-4000-a115-000000000004';
  IF NOT FOUND OR v_row.community_role IS DISTINCT FROM 'agent' OR v_row.support_role IS DISTINCT FROM 'lead'
     OR v_row.available IS NOT FALSE THEN
    RAISE EXCEPTION 'roster_dual_row_wrong: %', row_to_json(v_row);
  END IF;

  IF EXISTS (SELECT 1 FROM t3720_roster_result
              WHERE user_id IN ('37200000-0000-4000-a115-000000000005', '37200000-0000-4000-a115-000000000006')) THEN
    RAISE EXCEPTION 'roster_lists_disabled_or_outsider';
  END IF;
END;
$proof$;

-- 2. A signed-in non-admin is still refused.
SELECT pg_temp.t3720_as('outsider');
SET LOCAL ROLE authenticated;
DO $refused$
BEGIN
  BEGIN
    PERFORM * FROM public.issue_3720_admin_team_roster();
    RAISE EXCEPTION 'roster_open_to_non_admin';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$refused$;
RESET ROLE;

-- 3. Every other Wave 8 plpgsql RETURNS TABLE read model runs for an admin
-- without an output-column collision.
SELECT pg_temp.t3720_as('admin');
SET LOCAL ROLE authenticated;
DO $readmodels$
DECLARE
  v_section text;
  v_kind text;
BEGIN
  FOREACH v_kind IN ARRAY ARRAY['idea', 'question'] LOOP
    PERFORM * FROM public.issue_3720_admin_list_posts(v_kind, NULL);
    PERFORM * FROM public.issue_3720_admin_list_posts(v_kind, 'all');
  END LOOP;
  PERFORM * FROM public.issue_3720_admin_list_posts('question', 'unanswered');
  PERFORM * FROM public.issue_3720_admin_list_posts('question', 'answered');
  PERFORM * FROM public.issue_3720_admin_list_posts('question', 'locked');
  PERFORM * FROM public.issue_3720_admin_list_posts('idea', 'new');
  FOREACH v_section IN ARRAY ARRAY['reports', 'first_posts', 'appeals', 'hidden', 'paused_hosts', 'audit_log'] LOOP
    PERFORM * FROM public.issue_3720_admin_moderation_workspace(v_section);
  END LOOP;
  PERFORM * FROM public.issue_3720_admin_announcement_deliveries();
  PERFORM * FROM public.issue_3720_admin_list_roadmap_cards();
END;
$readmodels$;
RESET ROLE;

-- 4. The fixed function keeps its contract.
DO $contract$
DECLARE
  v_proc record;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig INTO v_proc
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'issue_3720_admin_team_roster' AND p.pronargs = 0;
  IF NOT FOUND OR v_proc.prosecdef IS NOT TRUE OR v_proc.provolatile <> 's'
     OR NOT (v_proc.proconfig @> ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'roster_contract_changed: %', row_to_json(v_proc);
  END IF;
  IF has_function_privilege('anon', 'public.issue_3720_admin_team_roster()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.issue_3720_admin_team_roster()', 'EXECUTE') THEN
    RAISE EXCEPTION 'roster_grants_changed';
  END IF;
END;
$contract$;

ROLLBACK;
