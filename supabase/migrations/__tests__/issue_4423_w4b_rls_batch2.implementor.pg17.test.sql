-- Issue #4423 Wave 4b batch 2 (profiles and user_* tables) -- implementor suite for
-- 20280707314423_issue_4423_w4b_rls_batch2_profiles_social.sql, on the fully replayed PG17 schema.
-- Everything is rolled back.
--
--   MECH    the 34 rewritten policies keep their command, mode and roles,
--           and their USING / WITH CHECK text equals the original (text pinned
--           below, taken from production pg_policies) once the sub-select
--           wrappers are removed; no per-row auth.*() call is left.
--   PARITY  on the 12 tables, anon, an owner, another user and
--           service_role see the same rows and get the same UPDATE, DELETE and
--           INSERT results with the rewritten policies as with the originals.
--
-- FAILS-ON-REVERT: without the migration every policy below still has a bare
-- per-row call (MECH fails); a rewrite that changes meaning fails MECH and,
-- where the seeded rows reach it, PARITY.
--
-- Shared harness: issue_4423_w4b_rls_parity.fixture.sql.
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;
-- pg_policies prints names relative to this path, as it did in production
set local search_path = public;
\ir issue_4423_w4b_rls_parity.fixture.sql

insert into w4b_expected (tablename, policyname, cmd, permissive, roles, qual, with_check) values
  ('profiles', 'Friends can read friend profiles', 'SELECT', 'PERMISSIVE', 'public', '((visibility_mode = ANY (ARRAY[''public''::text, ''friends''::text])) AND (EXISTS ( SELECT 1
   FROM friends
  WHERE ((friends.status = ''accepted''::text) AND (((friends.user_id = auth.uid()) AND (friends.friend_user_id = profiles.id)) OR ((friends.friend_user_id = auth.uid()) AND (friends.user_id = profiles.id)))))))', null),
  ('profiles', 'Profiles viewable except by blocked users', 'SELECT', 'PERMISSIVE', 'authenticated', '((auth.uid() = id) OR (NOT is_blocked_by(id, auth.uid())))', null),
  ('profiles', 'Users can insert own profile', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = id)'),
  ('profiles', 'Users can insert their own profile', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = id)'),
  ('profiles', 'Users can read own profile', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = id)', null),
  ('profiles', 'Users can update own profile', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = id)', '(auth.uid() = id)'),
  ('profiles', 'Users can update their own profile', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = id)', null),
  ('profiles', 'Users can view their own profile', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = id)', null),
  ('user_activity', 'Users can insert their own activity', 'INSERT', 'PERMISSIVE', 'public', null, '(user_id = auth.uid())'),
  ('user_activity', 'Users can view their own activity', 'SELECT', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('user_interactions', 'Users can insert their own interactions', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((auth.uid() IS NOT NULL) AND (user_id = auth.uid()))'),
  ('user_interactions', 'Users can update their own interactions', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('user_interactions', 'Users can view their own interactions', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('user_levels', 'Service role manages levels', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('user_location_history', 'Users can insert their own location history', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('user_location_history', 'Users can view their own location history', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('user_map_settings', 'Users manage own map settings', 'ALL', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('user_preference_learning', 'Users and paired users can view preferences', 'SELECT', 'PERMISSIVE', 'public', '((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM pairings
  WHERE (((pairings.user_a_id = auth.uid()) AND (pairings.user_b_id = user_preference_learning.user_id)) OR ((pairings.user_b_id = auth.uid()) AND (pairings.user_a_id = user_preference_learning.user_id))))))', null),
  ('user_preference_learning', 'Users can insert their own preferences', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('user_preference_learning', 'Users can update their own preferences', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('user_preference_learning', 'Users can view their own preferences', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('user_push_tokens', 'Users can delete their own push tokens', 'DELETE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('user_push_tokens', 'Users can insert their own push tokens', 'INSERT', 'PERMISSIVE', 'public', null, '(user_id = auth.uid())'),
  ('user_push_tokens', 'Users can update their own push tokens', 'UPDATE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('user_push_tokens', 'Users can view their own push tokens', 'SELECT', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('user_reports', 'Users can create reports', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = reporter_id)'),
  ('user_reports', 'Users can view their own reports', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = reporter_id)', null),
  ('user_sessions', 'Users can insert their own sessions', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('user_sessions', 'Users can update their own sessions', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('user_sessions', 'Users can view their own sessions', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('user_taste_matches', 'Service role manages taste matches', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('user_taste_matches', 'Users read own taste matches', 'SELECT', 'PERMISSIVE', 'public', '((auth.uid() = user_a_id) OR (auth.uid() = user_b_id))', null),
  ('user_visits', 'Paired users can view visits', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM pairings
  WHERE (((pairings.user_a_id = auth.uid()) AND (pairings.user_b_id = user_visits.user_id)) OR ((pairings.user_b_id = auth.uid()) AND (pairings.user_a_id = user_visits.user_id)))))', null),
  ('user_visits', 'Users can manage their own visits', 'ALL', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)');

select pg_temp.w4b_mechanical('W4b batch 2', 34);
select pg_temp.w4b_parity('W4b batch 2');
select pg_temp.w4b_report('W4b batch 2', 9);

rollback;
