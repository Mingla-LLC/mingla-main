-- #3720 Slice E CI harness.
--
-- The original append-only happy-path test alters auth.users, so it must run
-- as the Supabase auth-table owner rather than the non-superuser postgres
-- role. It also deliberately becomes `authenticated`; give tables created by
-- the harness owner to that role and expose fixture outbox rows to the fixture
-- user/admin while the test runs. The included test ends with ROLLBACK, which
-- removes every harness-only privilege and policy together with its fixtures.
\set ON_ERROR_STOP on

BEGIN;

ALTER DEFAULT PRIVILEGES
  GRANT ALL ON TABLES TO authenticated;

GRANT SELECT ON TABLE public.notification_outbox TO authenticated;

CREATE POLICY issue_3720_ci_read_own_outbox
  ON public.notification_outbox
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_user());

\ir issue_3720_community_phase1_schema.implementor.happy.pg17.test.sql
