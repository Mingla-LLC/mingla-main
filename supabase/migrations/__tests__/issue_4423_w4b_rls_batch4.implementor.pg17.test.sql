-- Issue #4423 Wave 4b batch 4 (every other public table) -- implementor suite for
-- 20280705334423_issue_4423_w4b_rls_batch4_rest.sql, on the fully replayed PG17 schema.
-- Everything is rolled back.
--
--   MECH    the 390 rewritten policies keep their command, mode and roles,
--           and their USING / WITH CHECK text equals the original (text pinned
--           below, taken from production pg_policies) once the sub-select
--           wrappers are removed; no per-row auth.*() call is left.
--   PARITY  on the 211 tables, anon, an owner, another user and
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
  ('_archive_card_pool', 'admin_update_card_pool', 'UPDATE', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', null),
  ('_archive_card_pool', 'authenticated_read_card_pool', 'SELECT', 'PERMISSIVE', 'public', '(auth.role() = ''authenticated''::text)', null),
  ('_archive_card_pool', 'service_role_all_card_pool', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('_archive_card_pool_stops', 'authenticated_read_card_pool_stops', 'SELECT', 'PERMISSIVE', 'public', '(auth.role() = ''authenticated''::text)', null),
  ('_archive_card_pool_stops', 'service_role_all_card_pool_stops', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('account_deletion_requests', 'Account owner can read own deletion requests', 'SELECT', 'PERMISSIVE', 'authenticated', '(auth.uid() = user_id)', null),
  ('activity_history', 'Users can insert activity history for boards they have access t', 'INSERT', 'PERMISSIVE', 'public', null, '((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = activity_history.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true))))))'),
  ('activity_history', 'Users can view activity history for boards they have access to', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = activity_history.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true)))))', null),
  ('ad_plan_drafts', 'ad_plan_drafts_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((created_by = auth.uid()) AND (is_admin_user() OR ((brand_id IS NOT NULL) AND biz_is_brand_member_for_read_for_caller(brand_id))))', null),
  ('admin_backfill_log', 'admin_insert_backfill_log', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))'),
  ('admin_backfill_log', 'admin_select_backfill_log', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', null),
  ('admin_backfill_log', 'service_role_all_backfill_log', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('admin_backfill_log_archive_orch_0671', 'service_role_only_archive_orch_0671', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('admin_config', 'service_role_all_admin_config', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('admin_email_log', 'admin_all_email_log', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))'),
  ('admin_subscription_overrides', 'Users can read own overrides', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('agent_conversations', 'Owner can delete own agent conversations', 'DELETE', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('agent_conversations', 'Owner can insert own agent conversations', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(user_id = auth.uid())'),
  ('agent_conversations', 'Owner can select own agent conversations', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('agent_conversations', 'Owner can update own agent conversations', 'UPDATE', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('agent_messages', 'Owner can insert own user agent messages', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((user_id = auth.uid()) AND (role = ''user''::text))'),
  ('agent_messages', 'Owner can select own agent messages', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('agent_operation_receipts', 'agent_operation_receipts_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('agent_pending_actions', 'Owner can delete own agent pending actions', 'DELETE', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('agent_pending_actions', 'Owner can insert own agent pending actions', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(user_id = auth.uid())'),
  ('agent_pending_actions', 'Owner can select own agent pending actions', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('agent_pending_actions', 'Owner can update own agent pending actions', 'UPDATE', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('agent_user_profile', 'Owner can delete own agent profile', 'DELETE', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('agent_user_profile', 'Owner can insert own agent profile', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(user_id = auth.uid())'),
  ('agent_user_profile', 'Owner can select own agent profile', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('agent_user_profile', 'Owner can update own agent profile', 'UPDATE', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('app_config', 'admin_delete_app_config', 'DELETE', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', null),
  ('app_config', 'admin_insert_app_config', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))'),
  ('app_config', 'admin_update_app_config', 'UPDATE', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', null),
  ('app_feedback', 'Users can insert own feedback', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('app_feedback', 'Users can read own feedback', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('appsflyer_devices', 'appsflyer_devices_delete_own', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('appsflyer_devices', 'appsflyer_devices_insert_own', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('appsflyer_devices', 'appsflyer_devices_select_own', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('appsflyer_devices', 'appsflyer_devices_update_own', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('archived_holidays', 'Paired users can view archived holidays', 'SELECT', 'PERMISSIVE', 'public', '((pairing_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM pairings
  WHERE ((pairings.id = archived_holidays.pairing_id) AND ((pairings.user_a_id = auth.uid()) OR (pairings.user_b_id = auth.uid()))))))', null),
  ('archived_holidays', 'Users can manage their own archived holidays', 'ALL', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('attribution_touches', 'attribution_touches_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(COALESCE(biz_brand_effective_rank(brand_id, auth.uid()), 0) >= 50)', null),
  ('audit_log', 'Users can read own audit_log rows', 'SELECT', 'PERMISSIVE', 'authenticated', '((user_id IS NOT NULL) AND (user_id = auth.uid()))', null),
  ('blocked_users', 'Users can create blocks', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = blocker_id)'),
  ('blocked_users', 'Users can remove their own blocks', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = blocker_id)', null),
  ('blocked_users', 'Users can view their own blocks', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = blocker_id)', null),
  ('board_card_message_reads', 'bcmr_select', 'SELECT', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('board_card_message_reads', 'Users can mark card messages as read', 'ALL', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('board_card_messages', 'bcm_insert', 'INSERT', 'PERMISSIVE', 'public', null, '((user_id = auth.uid()) AND is_session_participant(session_id, auth.uid()))'),
  ('board_card_messages', 'bcm_select', 'SELECT', 'PERMISSIVE', 'public', '((deleted_at IS NULL) AND is_session_participant(session_id, auth.uid()))', null),
  ('board_card_messages', 'Users can update their own card messages', 'UPDATE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('board_card_rsvps', 'bcr_select', 'SELECT', 'PERMISSIVE', 'public', '((user_id = auth.uid()) OR is_session_participant(session_id, auth.uid()))', null),
  ('board_card_rsvps', 'Users can manage their own RSVPs', 'ALL', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('board_cards', 'Users can add cards to boards they have access to', 'INSERT', 'PERMISSIVE', 'public', null, '(EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = board_cards.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true)))))'),
  ('board_cards', 'Users can view cards in boards they have access to', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = board_cards.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true)))))', null),
  ('board_collaborators', 'Collaborators can delete their own row or owner can delete any', 'DELETE', 'PERMISSIVE', 'public', '((auth.uid() = user_id) OR is_board_collaborator_as_owner(board_id, auth.uid()))', null),
  ('board_collaborators', 'Collaborators can update their own row', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('board_collaborators', 'Collaborators can view board collaborators', 'SELECT', 'PERMISSIVE', 'public', 'is_board_collaborator(board_id, auth.uid())', null),
  ('board_collaborators', 'Session participants can insert board collaborators', 'INSERT', 'PERMISSIVE', 'public', null, '(EXISTS ( SELECT 1
   FROM (collaboration_sessions cs
     JOIN session_participants sp ON ((sp.session_id = cs.id)))
  WHERE ((cs.board_id = board_collaborators.board_id) AND (sp.user_id = auth.uid()) AND (sp.has_accepted = true))))'),
  ('board_message_reactions', 'Participants can add reactions', 'INSERT', 'PERMISSIVE', 'public', null, '((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (board_messages bm
     JOIN session_participants sp ON ((sp.session_id = bm.session_id)))
  WHERE ((bm.id = board_message_reactions.message_id) AND (sp.user_id = auth.uid())))))'),
  ('board_message_reactions', 'Participants can view reactions', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM (board_messages bm
     JOIN session_participants sp ON ((sp.session_id = bm.session_id)))
  WHERE ((bm.id = board_message_reactions.message_id) AND (sp.user_id = auth.uid()))))', null),
  ('board_message_reactions', 'Users can remove their own reactions', 'DELETE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('board_message_reads', 'bmr_select', 'SELECT', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('board_message_reads', 'Users can mark messages as read', 'ALL', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('board_messages', 'bm_insert', 'INSERT', 'PERMISSIVE', 'public', null, '((user_id = auth.uid()) AND is_session_participant(session_id, auth.uid()))'),
  ('board_messages', 'bm_select', 'SELECT', 'PERMISSIVE', 'public', '((deleted_at IS NULL) AND is_session_participant(session_id, auth.uid()))', null),
  ('board_messages', 'Users can update their own messages', 'UPDATE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('board_participant_presence', 'bpp_delete', 'DELETE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('board_participant_presence', 'bpp_insert', 'INSERT', 'PERMISSIVE', 'public', null, '((user_id = auth.uid()) OR is_session_creator(session_id, auth.uid()))'),
  ('board_participant_presence', 'bpp_select', 'SELECT', 'PERMISSIVE', 'public', '((user_id = auth.uid()) OR is_session_participant(session_id, auth.uid()))', null),
  ('board_participant_presence', 'bpp_update', 'UPDATE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('board_saved_cards', 'bsc_insert_trigger_or_service_only', 'INSERT', 'PERMISSIVE', 'public', null, '((CURRENT_USER = ''postgres''::name) OR (auth.role() = ''service_role''::text))'),
  ('board_saved_cards', 'bsc_select', 'SELECT', 'PERMISSIVE', 'public', '((saved_by = auth.uid()) OR is_session_participant(session_id, auth.uid()))', null),
  ('board_saved_cards', 'Participants can remove saved cards from their sessions', 'DELETE', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM session_participants sp
  WHERE ((sp.session_id = board_saved_cards.session_id) AND (sp.user_id = auth.uid()))))', null),
  ('board_saved_cards', 'Participants can update saved cards in their sessions', 'UPDATE', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM session_participants sp
  WHERE ((sp.session_id = board_saved_cards.session_id) AND (sp.user_id = auth.uid()))))', '(EXISTS ( SELECT 1
   FROM session_participants sp
  WHERE ((sp.session_id = board_saved_cards.session_id) AND (sp.user_id = auth.uid()))))'),
  ('board_threads', 'Users can create threads in boards they have access to', 'INSERT', 'PERMISSIVE', 'public', null, '((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = board_threads.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true))))))'),
  ('board_threads', 'Users can delete their own threads', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('board_threads', 'Users can update their own threads', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('board_threads', 'Users can view threads in boards they have access to', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = board_threads.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true)))))', null),
  ('board_typing_indicators', 'bti_all', 'ALL', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('board_typing_indicators', 'bti_select', 'SELECT', 'PERMISSIVE', 'public', '((user_id = auth.uid()) OR is_session_participant(session_id, auth.uid()))', null),
  ('board_user_swipe_states', 'buss_all', 'ALL', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('board_user_swipe_states', 'buss_select', 'SELECT', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('board_votes', 'bv_delete', 'DELETE', 'PERMISSIVE', 'public', '((auth.uid() = user_id) AND (((session_id IS NOT NULL) AND is_session_participant(session_id, auth.uid())) OR ((board_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = board_votes.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true))))))))', null),
  ('board_votes', 'bv_select', 'SELECT', 'PERMISSIVE', 'public', '(((session_id IS NOT NULL) AND is_session_participant(session_id, auth.uid())) OR ((board_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = board_votes.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true)))))))', null),
  ('board_votes', 'Users can update their own votes', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('board_votes', 'Users can view votes in boards they have access to', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = board_votes.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true)))))', null),
  ('board_votes', 'Users can vote on cards in boards they have access to', 'INSERT', 'PERMISSIVE', 'public', null, '((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM boards b
  WHERE ((b.id = board_votes.board_id) AND ((b.created_by = auth.uid()) OR (b.is_public = true))))))'),
  ('board_votes', 'Users can vote on saved cards in their sessions', 'INSERT', 'PERMISSIVE', 'public', null, '((saved_card_id IS NOT NULL) AND (user_id = auth.uid()))'),
  ('boards', 'Users can create boards', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = created_by)'),
  ('boards', 'Users can delete their own boards', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = created_by)', null),
  ('boards', 'Users can update their own boards', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = created_by)', null),
  ('boards', 'Users can view public boards and their own boards', 'SELECT', 'PERMISSIVE', 'public', '((is_public = true) OR (created_by = auth.uid()))', null),
  ('business_notification_type_preferences', 'business_notification_type_preferences_delete_own', 'DELETE', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('business_notification_type_preferences', 'business_notification_type_preferences_insert_own', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(user_id = auth.uid())'),
  ('business_notification_type_preferences', 'business_notification_type_preferences_select_own', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('business_notification_type_preferences', 'business_notification_type_preferences_update_own', 'UPDATE', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('calendar_entries', 'Users can delete their own calendar entries', 'DELETE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('calendar_entries', 'Users can insert their own calendar entries', 'INSERT', 'PERMISSIVE', 'public', null, '(user_id = auth.uid())'),
  ('calendar_entries', 'Users can update their own calendar entries', 'UPDATE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('calendar_entries', 'Users can view their own calendar entries', 'SELECT', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('card_generation_runs', 'Admin insert card_generation_runs', 'INSERT', 'PERMISSIVE', 'public', null, '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))'),
  ('card_generation_runs', 'Admin read card_generation_runs', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', null),
  ('card_generation_runs', 'Service role full access card_generation_runs', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('channel_suppressions', 'channel_suppressions_read_own', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('chat_plans', 'chat_plans_member_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'is_conversation_participant(conversation_id, auth.uid())', null),
  ('checkout_refusals', 'Organisers read refusals for their own events', 'SELECT', 'PERMISSIVE', 'authenticated', '((brand_id IS NOT NULL) AND biz_is_brand_member_for_read(brand_id, auth.uid()))', null),
  ('collaboration_invites', 'ci_delete', 'DELETE', 'PERMISSIVE', 'public', '((auth.uid() = invited_user_id) OR (auth.uid() = inviter_id) OR is_session_creator(session_id, auth.uid()))', null),
  ('collaboration_invites', 'ci_insert', 'INSERT', 'PERMISSIVE', 'public', null, '((auth.uid() = inviter_id) OR is_session_creator(session_id, auth.uid()))'),
  ('collaboration_invites', 'ci_select', 'SELECT', 'PERMISSIVE', 'public', '((auth.uid() = invited_user_id) OR (auth.uid() = inviter_id) OR is_session_creator(session_id, auth.uid()))', null),
  ('collaboration_invites', 'ci_update', 'UPDATE', 'PERMISSIVE', 'public', '((auth.uid() = invited_user_id) OR (auth.uid() = inviter_id) OR is_session_creator(session_id, auth.uid()))', null),
  ('collaboration_sessions', 'cs_delete', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = created_by)', null),
  ('collaboration_sessions', 'cs_insert', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = created_by)'),
  ('collaboration_sessions', 'cs_select', 'SELECT', 'PERMISSIVE', 'public', '((auth.uid() = created_by) OR is_session_participant(id, auth.uid()) OR has_session_invite(id, auth.uid()))', null),
  ('collaboration_sessions', 'cs_update', 'UPDATE', 'PERMISSIVE', 'public', '((auth.uid() = created_by) OR is_session_participant(id, auth.uid()))', '((auth.uid() = created_by) OR is_session_participant(id, auth.uid()))'),
  ('community_audit_log', 'community_audit_log_staff_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_admin_user() OR is_support_staff(auth.uid()))', null),
  ('community_read_receipts', 'community_read_receipts_own', 'ALL', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('consent_records', 'consent_records_read_own', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('content_share_message_deliveries', 'content_share_message_deliveries_sender_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(sender_id = auth.uid())', null),
  ('creator_accounts', 'Creators can insert own account', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(auth.uid() = id)'),
  ('creator_accounts', 'Creators can read own account', 'SELECT', 'PERMISSIVE', 'authenticated', '(auth.uid() = id)', null),
  ('creator_accounts', 'Creators can update own account', 'UPDATE', 'PERMISSIVE', 'authenticated', '(auth.uid() = id)', '(auth.uid() = id)'),
  ('creator_handles', 'creator_handles_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(creator_account_id = auth.uid())', null),
  ('creator_media_jobs', 'creator_media_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(owner_id = auth.uid())', null),
  ('creator_packages', 'creator_packages_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(creator_account_id = auth.uid())', null),
  ('creator_profiles', 'creator_profiles_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(creator_account_id = auth.uid())', null),
  ('creator_saved_gigs', 'creator_saved_gigs_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(creator_account_id = auth.uid())', null),
  ('custom_holidays', 'Paired users can view custom holidays', 'SELECT', 'PERMISSIVE', 'public', '((pairing_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM pairings
  WHERE ((pairings.id = custom_holidays.pairing_id) AND ((pairings.user_a_id = auth.uid()) OR (pairings.user_b_id = auth.uid()))))))', null),
  ('custom_holidays', 'Users can manage their own custom holidays', 'ALL', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('direct_message_reactions', 'brand_group_reactions_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_3720_brand_group_can_access(issue_4304_brand_group_of_message(message_id), auth.uid())', null),
  ('direct_message_reactions', 'brand_group_reactions_scoped_insert', 'INSERT', 'RESTRICTIVE', 'authenticated', null, '((issue_4304_brand_group_of_message(message_id) IS NULL) OR (issue_3720_brand_group_can_access(issue_4304_brand_group_of_message(message_id), auth.uid()) AND (emoji = ANY (ARRAY[''❤️''::text, ''👍''::text, ''😂''::text, ''😮''::text, ''😢''::text, ''🔥''::text]))))'),
  ('direct_message_reactions', 'Users can add their own reactions', 'INSERT', 'PERMISSIVE', 'public', null, '(user_id = auth.uid())'),
  ('direct_message_reactions', 'Users can read reactions on their conversations', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversation_participants cp ON ((cp.conversation_id = m.conversation_id)))
  WHERE ((m.id = direct_message_reactions.message_id) AND (cp.user_id = auth.uid()))))', null),
  ('direct_message_reactions', 'Users can remove their own reactions', 'DELETE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('discount_grants', 'discount_grants_owner_or_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((grantee_user_id = auth.uid()) OR (COALESCE(biz_brand_effective_rank(brand_id, auth.uid()), 0) >= 20))', null),
  ('discover_city_watch', 'dcw_owner_select', 'SELECT', 'PERMISSIVE', 'authenticated', '(auth.uid() = user_id)', null),
  ('discover_daily_cache', 'discover_daily_cache_insert_own', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(auth.uid() = user_id)'),
  ('discover_daily_cache', 'discover_daily_cache_select_own', 'SELECT', 'PERMISSIVE', 'authenticated', '(auth.uid() = user_id)', null),
  ('discover_daily_cache', 'discover_daily_cache_update_own', 'UPDATE', 'PERMISSIVE', 'authenticated', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('engagement_metrics', 'admin_read_engagement_metrics', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = lower(auth.email())) AND (admin_users.status = ''active''::text))))', null),
  ('engagement_metrics', 'service_role_all_engagement_metrics', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('engagement_metrics', 'user_read_own_engagement', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('experience_edit_log', 'experience_edit_log_owner_read', 'SELECT', 'PERMISSIVE', 'public', '(biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text))', null),
  ('experience_feedback', 'Users can insert own experience feedback', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('experience_feedback', 'Users can read own experience feedback', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('experience_stops', 'experience_stops_select_owner', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = experience_stops.event_id) AND (e.deleted_at IS NULL) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', null),
  ('experience_stops', 'experience_stops_write_owner', 'ALL', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = experience_stops.event_id) AND (e.deleted_at IS NULL) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = experience_stops.event_id) AND (e.deleted_at IS NULL) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))'),
  ('feature_flags', 'admin_delete_feature_flags', 'DELETE', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', null),
  ('feature_flags', 'admin_insert_feature_flags', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))'),
  ('feature_flags', 'admin_update_feature_flags', 'UPDATE', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', null),
  ('friend_requests', 'fr_delete', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = sender_id)', null),
  ('friend_requests', 'fr_insert', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = sender_id)'),
  ('friend_requests', 'fr_select', 'SELECT', 'PERMISSIVE', 'public', '((auth.uid() = sender_id) OR (auth.uid() = receiver_id))', null),
  ('friend_requests', 'fr_update', 'UPDATE', 'PERMISSIVE', 'public', '((auth.uid() = sender_id) OR (auth.uid() = receiver_id))', null),
  ('friend_share_claims', 'friend_share_claims_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((owner_id = auth.uid()) OR (claimant_id = auth.uid()))', null),
  ('friend_share_links', 'friend_share_links_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('friends', 'Users can create friend requests', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('friends', 'Users can delete their own friendships', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('friends', 'Users can update their own friendships', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('friends', 'Users can view their own friendships', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('gig_change_proposals', 'proposals_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM gig_contracts c
  WHERE ((c.id = gig_change_proposals.contract_id) AND ((c.creator_account_id = auth.uid()) OR biz_is_brand_member_for_read(c.brand_id, auth.uid())))))', null),
  ('gig_contracts', 'contracts_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(((creator_account_id = auth.uid()) AND ((state <> ''offered''::text) OR issue_3872_offer_ready(id))) OR biz_is_brand_member_for_read(brand_id, auth.uid()))', null),
  ('gig_deliveries', 'deliveries_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(issue_3872_contract_party(contract_id, auth.uid()) IS NOT NULL)', null),
  ('gig_dispute_offers', 'offers_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM gig_disputes d
  WHERE ((d.id = gig_dispute_offers.dispute_id) AND (issue_3872_contract_party(d.contract_id, auth.uid()) IS NOT NULL))))', null),
  ('gig_disputes', 'disputes_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(issue_3872_contract_party(contract_id, auth.uid()) IS NOT NULL)', null),
  ('gig_events', 'events_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM gig_contracts c
  WHERE ((c.id = gig_events.contract_id) AND ((c.creator_account_id = auth.uid()) OR biz_is_brand_member_for_read(c.brand_id, auth.uid())))))', null),
  ('gig_holds', 'holds_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM gig_contracts c
  WHERE ((c.id = gig_holds.contract_id) AND ((c.creator_account_id = auth.uid()) OR biz_is_brand_member_for_read(c.brand_id, auth.uid())))))', null),
  ('gig_interest', 'interest_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((creator_account_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = gig_interest.gig_id) AND biz_is_brand_member_for_read(g.brand_id, auth.uid())))))', null),
  ('gig_invites', 'invites_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((creator_account_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM gigs g
  WHERE ((g.id = gig_invites.gig_id) AND biz_is_brand_member_for_read(g.brand_id, auth.uid())))))', null),
  ('gig_posts', 'posts_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(issue_3872_contract_party(contract_id, auth.uid()) IS NOT NULL)', null),
  ('gig_ratings', 'ratings_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(issue_3872_contract_party(contract_id, auth.uid()) IS NOT NULL)', null),
  ('gig_scripts', 'scripts_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(issue_3872_contract_party(contract_id, auth.uid()) IS NOT NULL)', null),
  ('gig_shoot_plans', 'shoot_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(issue_3872_contract_party(contract_id, auth.uid()) IS NOT NULL)', null),
  ('gig_terms_versions', 'terms_party_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM gig_contracts c
  WHERE ((c.id = gig_terms_versions.contract_id) AND ((c.creator_account_id = auth.uid()) OR biz_is_brand_member_for_read(c.brand_id, auth.uid())))))', null),
  ('gigs', 'gigs_host_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'biz_is_brand_member_for_read(brand_id, auth.uid())', null),
  ('group_invite_links', 'group_invite_links_member_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'is_conversation_participant(conversation_id, auth.uid())', null),
  ('group_join_requests', 'group_join_requests_member_or_self_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_conversation_participant(conversation_id, auth.uid()) OR (user_id = auth.uid()))', null),
  ('guest_roster_change_events', 'guest_roster_change_events_manager_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = guest_roster_change_events.event_id) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', null),
  ('host_tracking_links', 'host_tracking_links_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(COALESCE(biz_brand_effective_rank(brand_id, auth.uid()), 0) >= 20)', null),
  ('integrations', 'admin_all_integrations', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))'),
  ('leaderboard_presence', 'Users manage own presence', 'ALL', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('leaderboard_presence', 'Users see discoverable presence', 'SELECT', 'PERMISSIVE', 'public', '((user_id = auth.uid()) OR ((is_discoverable = true) AND (available_seats > 0) AND (last_swipe_at > (now() - ''24:00:00''::interval)) AND ((visibility_level = ''everyone''::text) OR ((visibility_level = ''friends''::text) AND (EXISTS ( SELECT 1
   FROM friends
  WHERE ((friends.status = ''accepted''::text) AND (friends.deleted_at IS NULL) AND (((friends.user_id = auth.uid()) AND (friends.friend_user_id = leaderboard_presence.user_id)) OR ((friends.friend_user_id = auth.uid()) AND (friends.user_id = leaderboard_presence.user_id))))))) OR ((visibility_level = ''friends_of_friends''::text) AND are_friends_or_fof(auth.uid(), user_id)) OR ((visibility_level = ''paired''::text) AND (EXISTS ( SELECT 1
   FROM friends
  WHERE ((friends.status = ''accepted''::text) AND (friends.deleted_at IS NULL) AND (((friends.user_id = auth.uid()) AND (friends.friend_user_id = leaderboard_presence.user_id)) OR ((friends.friend_user_id = auth.uid()) AND (friends.user_id = leaderboard_presence.user_id))))))))))', null),
  ('local_applications', 'local_applications_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('local_events', 'local_events_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM locals l
  WHERE ((l.id = local_events.local_id) AND (l.user_id = auth.uid()))))', null),
  ('local_months', 'local_months_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM locals l
  WHERE ((l.id = local_months.local_id) AND (l.user_id = auth.uid()))))', null),
  ('local_reviews', 'local_reviews_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM (local_months m
     JOIN locals l ON ((l.id = m.local_id)))
  WHERE ((m.id = local_reviews.local_month_id) AND (l.user_id = auth.uid()))))', null),
  ('locals', 'locals_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('marketing_audiences', 'marketing_audiences_delete', 'DELETE', 'PERMISSIVE', 'authenticated', '((query_definition <> ''{"kind": "manual_group"}''::jsonb) AND ((account_id = auth.uid()) OR ((brand_id IS NOT NULL) AND mkt_brand_min_rank(brand_id, ''event_manager''::text))))', null),
  ('marketing_audiences', 'marketing_audiences_insert', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((query_definition <> ''{"kind": "manual_group"}''::jsonb) AND (account_id = auth.uid()) AND ((brand_id IS NULL) OR mkt_brand_min_rank(brand_id, ''event_manager''::text)))'),
  ('marketing_audiences', 'marketing_audiences_select', 'SELECT', 'PERMISSIVE', 'authenticated', '
CASE
    WHEN (query_definition = ''{"kind": "manual_group"}''::jsonb) THEN ((deleted_at IS NULL) AND (brand_id IS NOT NULL) AND (COALESCE(biz_brand_effective_rank(brand_id, auth.uid()), ''-1''::integer) >= biz_role_rank(''marketing_manager''::text)))
    ELSE ((account_id = auth.uid()) OR ((brand_id IS NOT NULL) AND mkt_brand_min_rank(brand_id, ''brand_member''::text)))
END', null),
  ('marketing_audiences', 'marketing_audiences_update', 'UPDATE', 'PERMISSIVE', 'authenticated', '((query_definition <> ''{"kind": "manual_group"}''::jsonb) AND ((account_id = auth.uid()) OR ((brand_id IS NOT NULL) AND mkt_brand_min_rank(brand_id, ''event_manager''::text))))', '((query_definition <> ''{"kind": "manual_group"}''::jsonb) AND ((account_id = auth.uid()) OR ((brand_id IS NOT NULL) AND mkt_brand_min_rank(brand_id, ''event_manager''::text))))'),
  ('marketing_campaigns', 'marketing_campaigns_delete', 'DELETE', 'PERMISSIVE', 'authenticated', '((account_id = auth.uid()) OR mkt_brand_min_rank(brand_id, ''event_manager''::text))', null),
  ('marketing_campaigns', 'marketing_campaigns_insert', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((account_id = auth.uid()) AND mkt_brand_min_rank(brand_id, ''event_manager''::text))'),
  ('marketing_campaigns', 'marketing_campaigns_select', 'SELECT', 'PERMISSIVE', 'authenticated', '((account_id = auth.uid()) OR mkt_brand_min_rank(brand_id, ''brand_member''::text))', null),
  ('marketing_campaigns', 'marketing_campaigns_update', 'UPDATE', 'PERMISSIVE', 'authenticated', '((account_id = auth.uid()) OR mkt_brand_min_rank(brand_id, ''event_manager''::text))', 'mkt_brand_min_rank(brand_id, ''event_manager''::text)'),
  ('marketing_clicks', 'marketing_clicks_select', 'SELECT', 'PERMISSIVE', 'authenticated', '((link_kind = ''content''::text) AND (EXISTS ( SELECT 1
   FROM marketing_campaigns c
  WHERE ((c.id = marketing_clicks.campaign_id) AND ((c.account_id = auth.uid()) OR mkt_brand_min_rank(c.brand_id, ''brand_member''::text))))))', null),
  ('marketing_templates', 'marketing_templates_delete', 'DELETE', 'PERMISSIVE', 'authenticated', '((is_starter_pack = false) AND (account_id = auth.uid()))', null),
  ('marketing_templates', 'marketing_templates_insert', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((is_starter_pack = false) AND (account_id = auth.uid()) AND ((brand_id IS NULL) OR mkt_brand_min_rank(brand_id, ''event_manager''::text)))'),
  ('marketing_templates', 'marketing_templates_select', 'SELECT', 'PERMISSIVE', 'authenticated', '((is_starter_pack = true) OR (account_id = auth.uid()) OR ((brand_id IS NOT NULL) AND mkt_brand_min_rank(brand_id, ''brand_member''::text)))', null),
  ('marketing_templates', 'marketing_templates_update', 'UPDATE', 'PERMISSIVE', 'authenticated', '((is_starter_pack = false) AND (account_id = auth.uid()))', '((is_starter_pack = false) AND (account_id = auth.uid()) AND ((brand_id IS NULL) OR mkt_brand_min_rank(brand_id, ''event_manager''::text)))'),
  ('match_telemetry_events', 'mte_service_read', 'SELECT', 'PERMISSIVE', 'public', '((auth.role() = ''service_role''::text) OR (CURRENT_USER = ''postgres''::name))', null),
  ('match_telemetry_events', 'mte_trigger_insert', 'INSERT', 'PERMISSIVE', 'public', null, '((auth.role() = ''service_role''::text) OR (CURRENT_USER = ''postgres''::name))'),
  ('menu_items', 'menu items scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM menus menu
  WHERE ((menu.id = menu_items.menu_id) AND (issue_4188_has_venue_capability(menu.venue_id, auth.uid(), ''restaurant.manage_menu''::text) OR issue_4188_has_venue_capability(menu.venue_id, auth.uid(), ''restaurant.view_orders''::text)))))', null),
  ('menu_items', 'menu items scoped staff can write', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM menus menu
  WHERE ((menu.id = menu_items.menu_id) AND issue_4188_has_venue_capability(menu.venue_id, auth.uid(), ''restaurant.manage_menu''::text))))', '(EXISTS ( SELECT 1
   FROM menus menu
  WHERE ((menu.id = menu_items.menu_id) AND issue_4188_has_venue_capability(menu.venue_id, auth.uid(), ''restaurant.manage_menu''::text))))'),
  ('menus', 'menus scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', '(issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.manage_menu''::text) OR issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.view_orders''::text))', null),
  ('menus', 'menus scoped staff can write', 'ALL', 'PERMISSIVE', 'authenticated', 'issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.manage_menu''::text)', 'issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.manage_menu''::text)'),
  ('muted_users', 'Users can create mutes', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = muter_id)'),
  ('muted_users', 'Users can remove their own mutes', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = muter_id)', null),
  ('muted_users', 'Users can view their own mutes', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = muter_id)', null),
  ('organiser_payout_debts', 'payout_debts_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank(''finance_manager''::text))', null),
  ('pair_requests', 'Receiver can accept or decline visible pair requests', 'UPDATE', 'PERMISSIVE', 'public', '((auth.uid() = receiver_id) AND (visibility = ''visible''::text))', '(status = ANY (ARRAY[''accepted''::text, ''declined''::text]))'),
  ('pair_requests', 'Sender can cancel their pair requests', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = sender_id)', '(status = ''cancelled''::text)'),
  ('pair_requests', 'Users can create pair requests', 'INSERT', 'PERMISSIVE', 'public', null, '((auth.uid() = sender_id) AND (status = ''pending''::text))'),
  ('pair_requests', 'Users can view their own pair requests', 'SELECT', 'PERMISSIVE', 'public', '((auth.uid() = sender_id) OR (auth.uid() = receiver_id))', null),
  ('pairings', 'Users can delete their own pairings (unpair)', 'DELETE', 'PERMISSIVE', 'public', '((auth.uid() = user_a_id) OR (auth.uid() = user_b_id))', null),
  ('pairings', 'Users can view their own pairings', 'SELECT', 'PERMISSIVE', 'public', '((auth.uid() = user_a_id) OR (auth.uid() = user_b_id))', null),
  ('partner_brand_links', 'partner_brand_links_owner_select', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = partner_brand_links.brand_id) AND (b.account_id = auth.uid()))))', null),
  ('partner_brand_links', 'partner_brand_links_self_select', 'SELECT', 'PERMISSIVE', 'authenticated', '(partner_account_id = auth.uid())', null),
  ('partner_paystack_accounts', 'partner_paystack_self_select', 'SELECT', 'PERMISSIVE', 'public', '((account_id = auth.uid()) OR is_admin_user())', null),
  ('partner_splits', 'partner_splits_partner_self_select', 'SELECT', 'PERMISSIVE', 'public', '((partner_account_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM brand_team_members btm
  WHERE ((btm.brand_id = partner_splits.brand_id) AND (btm.user_id = auth.uid()) AND (btm.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text])) AND (btm.accepted_at IS NOT NULL) AND (btm.removed_at IS NULL)))) OR is_admin_user())', null),
  ('partner_stripe_connect_accounts', 'partner_stripe_self_select', 'SELECT', 'PERMISSIVE', 'public', '((account_id = auth.uid()) OR is_admin_user())', null),
  ('payee_accounts', 'payee_accounts_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('payee_debts', 'payee_debts_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(payee_user_id = auth.uid())', null),
  ('payee_payouts', 'payee_payouts_owner_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(payee_user_id = auth.uid())', null),
  ('payee_share_reversals', 'payee_share_reversals_owner_or_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM payee_shares share
  WHERE ((share.id = payee_share_reversals.share_id) AND ((share.payee_user_id = auth.uid()) OR (COALESCE(biz_brand_effective_rank(share.brand_id, auth.uid()), 0) >= 30)))))', null),
  ('payee_shares', 'payee_shares_owner_or_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((payee_user_id = auth.uid()) OR (COALESCE(biz_brand_effective_rank(brand_id, auth.uid()), 0) >= 30))', null),
  ('payout_debt_applications', 'payout_debt_applications_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM organiser_payout_debts d
  WHERE ((d.id = payout_debt_applications.debt_id) AND (biz_brand_effective_rank(d.brand_id, auth.uid()) >= biz_role_rank(''finance_manager''::text)))))', null),
  ('payout_debt_events', 'payout_debt_events_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM organiser_payout_debts d
  WHERE ((d.id = payout_debt_events.debt_id) AND (biz_brand_effective_rank(d.brand_id, auth.uid()) >= biz_role_rank(''finance_manager''::text)))))', null),
  ('payout_ledger_adjustments', 'payout_adjustments_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank(''finance_manager''::text))', null),
  ('payout_release_items', 'payout_release_items_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brand_payout_releases r
  WHERE ((r.id = payout_release_items.release_id) AND (biz_brand_effective_rank(r.brand_id, auth.uid()) >= biz_role_rank(''finance_manager''::text)))))', null),
  ('payout_transfer_legs', 'payout_transfer_legs_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brand_payout_releases r
  WHERE ((r.id = payout_transfer_legs.release_id) AND (biz_brand_effective_rank(r.brand_id, auth.uid()) >= biz_role_rank(''finance_manager''::text)))))', null),
  ('paystack_disputes', 'brand_payment_managers_select_paystack_disputes', 'SELECT', 'PERMISSIVE', 'authenticated', '(brand_id IN ( SELECT brand_team_members.brand_id
   FROM brand_team_members
  WHERE ((brand_team_members.user_id = auth.uid()) AND (brand_team_members.removed_at IS NULL) AND (brand_team_members.accepted_at IS NOT NULL) AND (brand_team_members.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text, ''finance_manager''::text])))))', null),
  ('pending_invites', 'Users can delete their own pending invites', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = inviter_id)', null),
  ('pending_invites', 'Users can insert their own pending invites', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = inviter_id)'),
  ('pending_invites', 'Users can read their own pending invites', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = inviter_id)', null),
  ('pending_invites', 'Users can update their own pending invites', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = inviter_id)', '(auth.uid() = inviter_id)'),
  ('pending_pair_invites', 'Users can cancel their own pending pair invites', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = inviter_id)', '(status = ''cancelled''::text)'),
  ('pending_pair_invites', 'Users can create pending pair invites', 'INSERT', 'PERMISSIVE', 'public', null, '((auth.uid() = inviter_id) AND (status = ''pending''::text))'),
  ('pending_pair_invites', 'Users can view their own pending pair invites', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = inviter_id)', null),
  ('pending_session_invites', 'Participants can read session pending invites', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM session_participants sp
  WHERE ((sp.session_id = pending_session_invites.session_id) AND (sp.user_id = auth.uid()))))', null),
  ('pending_session_invites', 'Users can insert their own pending session invites', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = inviter_id)'),
  ('pending_session_invites', 'Users can read their own pending session invites', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = inviter_id)', null),
  ('pending_session_invites', 'Users can update their own pending session invites', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = inviter_id)', '(auth.uid() = inviter_id)'),
  ('person_card_impressions', 'Paired users can view shared impressions', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM pairings
  WHERE (((pairings.user_a_id = auth.uid()) AND (pairings.user_b_id = person_card_impressions.user_id)) OR ((pairings.user_b_id = auth.uid()) AND (pairings.user_a_id = person_card_impressions.user_id)))))', null),
  ('person_card_impressions', 'Users can delete their own person card impressions', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('person_card_impressions', 'Users can insert their own person card impressions', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('person_card_impressions', 'Users can read their own person card impressions', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('photo_aesthetic_batches', 'admin_read_photo_aesthetic_batches', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))', null),
  ('photo_aesthetic_batches', 'service_role_all_photo_aesthetic_batches', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('photo_aesthetic_labels', 'admin_delete_photo_aesthetic_labels', 'DELETE', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))', null),
  ('photo_aesthetic_labels', 'admin_read_photo_aesthetic_labels', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))', null),
  ('photo_aesthetic_labels', 'admin_update_photo_aesthetic_labels', 'UPDATE', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))'),
  ('photo_aesthetic_labels', 'admin_write_photo_aesthetic_labels', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))'),
  ('photo_aesthetic_labels', 'service_role_all_photo_aesthetic_labels', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('photo_aesthetic_runs', 'admin_read_photo_aesthetic_runs', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))', null),
  ('photo_aesthetic_runs', 'service_role_all_photo_aesthetic_runs', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('photo_backfill_batches', 'service_role_all_photo_batches', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('photo_backfill_runs', 'service_role_all_photo_runs', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('place_admin_actions', 'admin_insert_place_admin_actions', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))'),
  ('place_admin_actions', 'admin_read_place_admin_actions', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))', null),
  ('place_admin_actions', 'service_role_all_place_admin_actions', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('place_collage_reencode_jobs', 'service_role_all_collage_reencode_jobs', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('place_discovery_price_range_revisions', 'place_discovery_price_revisions_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_admin_user() OR ((brand_id IS NOT NULL) AND (biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text))))', null),
  ('place_discovery_price_ranges', 'place_discovery_price_ranges_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_admin_user() OR ((brand_id IS NOT NULL) AND (biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text))))', null),
  ('place_external_reviews', 'admin_read_place_external_reviews', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))', null),
  ('place_external_reviews', 'service_role_all_place_external_reviews', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('place_intelligence_runs', 'admin_full_access', 'ALL', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM (auth.users u
     JOIN admin_users au ON ((au.email = (u.email)::text)))
  WHERE ((u.id = auth.uid()) AND (au.status = ''active''::text))))', '(EXISTS ( SELECT 1
   FROM (auth.users u
     JOIN admin_users au ON ((au.email = (u.email)::text)))
  WHERE ((u.id = auth.uid()) AND (au.status = ''active''::text))))'),
  ('place_intelligence_trial_runs', 'admin_read_pit_runs', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))', null),
  ('place_intelligence_trial_runs', 'service_role_all_pit_runs', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('place_pool', 'admin_update_place_pool', 'UPDATE', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))', '(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.email = auth.email()) AND (au.status = ''active''::text))))'),
  ('place_pool', 'authenticated_read_place_pool', 'SELECT', 'PERMISSIVE', 'public', '(auth.role() = ''authenticated''::text)', null),
  ('place_pool', 'place_pool_business_owner_update', 'UPDATE', 'PERMISSIVE', 'authenticated', '((claimed_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.account_id = auth.uid()) AND (b.deleted_at IS NULL) AND (b.id = place_pool.business_author_brand_id)))) OR (EXISTS ( SELECT 1
   FROM venue_listings v
  WHERE ((v.place_pool_id = place_pool.id) AND (biz_brand_effective_rank_for_caller(v.brand_id) >= biz_role_rank(''event_manager''::text))))))', '((claimed_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.account_id = auth.uid()) AND (b.deleted_at IS NULL) AND (b.id = place_pool.business_author_brand_id)))) OR (EXISTS ( SELECT 1
   FROM venue_listings v
  WHERE ((v.place_pool_id = place_pool.id) AND (biz_brand_effective_rank_for_caller(v.brand_id) >= biz_role_rank(''event_manager''::text))))))'),
  ('place_pool', 'service_role_all_place_pool', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('place_reviews', 'service_role_all_reviews', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('place_reviews', 'users_insert_own_reviews', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('place_reviews', 'users_read_own_reviews', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('place_reviews', 'users_update_own_reviews', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('preference_history', 'System can insert preference history', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('preference_history', 'Users can view their own preference history', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('preferences', 'Authenticated users can read display interests', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() IS NOT NULL)', null),
  ('preferences', 'Friends can read friend preferences', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = preferences.profile_id) AND (p.visibility_mode = ANY (ARRAY[''public''::text, ''friends''::text])) AND (EXISTS ( SELECT 1
           FROM friends
          WHERE ((friends.status = ''accepted''::text) AND (((friends.user_id = auth.uid()) AND (friends.friend_user_id = p.id)) OR ((friends.friend_user_id = auth.uid()) AND (friends.user_id = p.id)))))))))', null),
  ('preferences', 'Users can insert own preferences', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = profile_id)'),
  ('preferences', 'Users can read own preferences', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = profile_id)', null),
  ('preferences', 'Users can update own preferences', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = profile_id)', null),
  ('product_avengers_items', 'product_avengers_items_operator_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('product_avengers_reviews', 'product_avengers_reviews_operator_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('product_customer_update_drafts', 'product_customer_update_drafts_operator_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('product_signal_avengers_links', 'product_signal_avengers_links_operator_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('public_search_document_audit', 'public_search_document_audit_service_all', 'ALL', 'PERMISSIVE', 'service_role', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('public_search_documents', 'public_search_documents_service_all', 'ALL', 'PERMISSIVE', 'service_role', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('qr_spots', 'qr spots scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_4188_has_venue_capability(serving_venue_id, auth.uid(), ''restaurant.manage_qr''::text)', null),
  ('qr_spots', 'qr spots scoped staff can write', 'ALL', 'PERMISSIVE', 'authenticated', 'issue_4188_has_venue_capability(serving_venue_id, auth.uid(), ''restaurant.manage_qr''::text)', 'issue_4188_has_venue_capability(serving_venue_id, auth.uid(), ''restaurant.manage_qr''::text)'),
  ('referral_credits', 'Users can read their own referral credits', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = referrer_id)', null),
  ('referral_members', 'referral_members_owner_or_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((user_id = auth.uid()) OR (COALESCE(biz_brand_effective_rank(brand_id, auth.uid()), 0) >= 20))', null),
  ('referral_offer_listings', 'referral_offer_listings_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM referral_offers offer
  WHERE ((offer.id = referral_offer_listings.offer_id) AND (offer.deleted_at IS NULL) AND (COALESCE(biz_brand_effective_rank(offer.brand_id, auth.uid()), 0) >= 20))))', null),
  ('referral_offer_tiers', 'referral_offer_tiers_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM referral_offers offer
  WHERE ((offer.id = referral_offer_tiers.offer_id) AND (offer.deleted_at IS NULL) AND (COALESCE(biz_brand_effective_rank(offer.brand_id, auth.uid()), 0) >= 20))))', null),
  ('referral_offers', 'referral_offers_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((deleted_at IS NULL) AND (COALESCE(biz_brand_effective_rank(brand_id, auth.uid()), 0) >= 20))', null),
  ('refund_line_items', 'Refund line items direct select for RETURNING', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM refunds r
  WHERE ((r.id = refund_line_items.refund_id) AND (r.initiated_by = auth.uid()))))', null),
  ('refunds', 'Refunds owner direct select for RETURNING', 'SELECT', 'PERMISSIVE', 'authenticated', '((initiated_by = auth.uid()) OR biz_can_manage_payments_for_brand_for_caller(biz_order_brand_id(order_id)))', null),
  ('reservations', 'reservations consumer can read own', 'SELECT', 'PERMISSIVE', 'authenticated', '(consumer_user_id = auth.uid())', null),
  ('reservations', 'reservations scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.manage_reservations''::text)', null),
  ('rule_entries', 'admin_full_access_rule_entries', 'ALL', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = lower(auth.email())) AND (admin_users.status = ''active''::text))))', null),
  ('rule_set_versions', 'admin_full_access_rule_set_versions', 'ALL', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = lower(auth.email())) AND (admin_users.status = ''active''::text))))', null),
  ('rule_sets', 'admin_full_access_rule_sets', 'ALL', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = lower(auth.email())) AND (admin_users.status = ''active''::text))))', null),
  ('rules_run_results', 'admin_full_access_rules_run_results', 'ALL', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = lower(auth.email())) AND (admin_users.status = ''active''::text))))', null),
  ('rules_runs', 'admin_full_access_rules_runs', 'ALL', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = lower(auth.email())) AND (admin_users.status = ''active''::text))))', null),
  ('rules_versions', 'admin_full_access_rules_versions', 'ALL', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = lower(auth.email())) AND (admin_users.status = ''active''::text))))', null),
  ('saved_card', 'Owner can delete saved cards', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = profile_id)', null),
  ('saved_card', 'Owner can insert saved cards', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = profile_id)'),
  ('saved_card', 'Owner can select saved cards', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = profile_id)', null),
  ('saved_card', 'Owner can update saved cards', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = profile_id)', '(auth.uid() = profile_id)'),
  ('saved_card', 'Paired users can view saved cards', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM pairings
  WHERE (((pairings.user_a_id = auth.uid()) AND (pairings.user_b_id = saved_card.profile_id)) OR ((pairings.user_b_id = auth.uid()) AND (pairings.user_a_id = saved_card.profile_id)))))', null),
  ('saved_people', 'Users can delete their own saved people', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('saved_people', 'Users can insert their own saved people', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('saved_people', 'Users can read their own saved people', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('saved_people', 'Users can update their own saved people', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('scan_events', 'Brand team can select scan_events', 'SELECT', 'PERMISSIVE', 'authenticated', 'biz_is_brand_member_for_read(biz_event_brand_id(event_id), auth.uid())', null),
  ('scan_events', 'Scanners insert own scan_events', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((scanner_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM event_scanners es
  WHERE ((es.event_id = scan_events.event_id) AND (es.user_id = auth.uid()) AND (es.removed_at IS NULL) AND COALESCE(((es.permissions ->> ''scan''::text))::boolean, true)))))'),
  ('scanner_invitations', 'scanner_invitations_insert_event_manager_plus', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((invited_by = auth.uid()) AND ((EXISTS ( SELECT 1
   FROM (brand_team_members m
     JOIN brands b ON ((b.id = m.brand_id)))
  WHERE ((m.brand_id = scanner_invitations.brand_id) AND (m.user_id = auth.uid()) AND (m.removed_at IS NULL) AND (m.accepted_at IS NOT NULL) AND (b.deleted_at IS NULL) AND (m.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text, ''event_manager''::text]))))) OR (EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = scanner_invitations.brand_id) AND (b.account_id = auth.uid()) AND (b.deleted_at IS NULL))))))'),
  ('scanner_invitations', 'scanner_invitations_select_event_manager_plus', 'SELECT', 'PERMISSIVE', 'authenticated', '((EXISTS ( SELECT 1
   FROM (brand_team_members m
     JOIN brands b ON ((b.id = m.brand_id)))
  WHERE ((m.brand_id = scanner_invitations.brand_id) AND (m.user_id = auth.uid()) AND (m.removed_at IS NULL) AND (m.accepted_at IS NOT NULL) AND (b.deleted_at IS NULL) AND (m.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text, ''event_manager''::text]))))) OR (EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = scanner_invitations.brand_id) AND (b.account_id = auth.uid()) AND (b.deleted_at IS NULL)))))', null),
  ('scanner_invitations', 'scanner_invitations_update_event_manager_plus', 'UPDATE', 'PERMISSIVE', 'authenticated', '((EXISTS ( SELECT 1
   FROM (brand_team_members m
     JOIN brands b ON ((b.id = m.brand_id)))
  WHERE ((m.brand_id = scanner_invitations.brand_id) AND (m.user_id = auth.uid()) AND (m.removed_at IS NULL) AND (m.accepted_at IS NOT NULL) AND (b.deleted_at IS NULL) AND (m.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text, ''event_manager''::text]))))) OR (EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = scanner_invitations.brand_id) AND (b.account_id = auth.uid()) AND (b.deleted_at IS NULL)))))', '((EXISTS ( SELECT 1
   FROM (brand_team_members m
     JOIN brands b ON ((b.id = m.brand_id)))
  WHERE ((m.brand_id = scanner_invitations.brand_id) AND (m.user_id = auth.uid()) AND (m.removed_at IS NULL) AND (m.accepted_at IS NOT NULL) AND (b.deleted_at IS NULL) AND (m.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text, ''event_manager''::text]))))) OR (EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = scanner_invitations.brand_id) AND (b.account_id = auth.uid()) AND (b.deleted_at IS NULL)))))'),
  ('scheduled_activities', 'Users can delete their own scheduled activities', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('scheduled_activities', 'Users can insert their own scheduled activities', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('scheduled_activities', 'Users can update their own scheduled activities', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('scheduled_activities', 'Users can view their own scheduled activities', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('seeding_cities', 'admin_write_seeding_cities', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))'),
  ('seeding_cities', 'authenticated_read_seeding_cities', 'SELECT', 'PERMISSIVE', 'public', '(auth.role() = ''authenticated''::text)', null),
  ('seeding_cities', 'service_role_all_seeding_cities', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('seeding_operations', 'admin_write_seeding_operations', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))'),
  ('seeding_operations', 'authenticated_read_seeding_operations', 'SELECT', 'PERMISSIVE', 'public', '(auth.role() = ''authenticated''::text)', null),
  ('seeding_operations', 'service_role_all_seeding_operations', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('seeding_tiles', 'admin_write_seeding_tiles', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))', '(EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.email = auth.email()) AND (admin_users.status = ''active''::text))))'),
  ('seeding_tiles', 'authenticated_read_seeding_tiles', 'SELECT', 'PERMISSIVE', 'public', '(auth.role() = ''authenticated''::text)', null),
  ('seeding_tiles', 'service_role_all_seeding_tiles', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', null),
  ('session_curated_cache', 'scc_service_only', 'ALL', 'PERMISSIVE', 'public', '((auth.role() = ''service_role''::text) OR (CURRENT_USER = ''postgres''::name))', '((auth.role() = ''service_role''::text) OR (CURRENT_USER = ''postgres''::name))'),
  ('session_deck_cards', 'sdc_insert_service_only', 'INSERT', 'PERMISSIVE', 'public', null, '((CURRENT_USER = ''postgres''::name) OR (auth.role() = ''service_role''::text))'),
  ('session_deck_cards', 'sdc_select', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM session_participants sp
  WHERE ((sp.session_id = session_deck_cards.session_id) AND (sp.user_id = auth.uid()) AND (sp.has_accepted = true))))', null),
  ('session_deck_versions', 'sdv_insert_trigger_or_service_only', 'INSERT', 'PERMISSIVE', 'public', null, '((CURRENT_USER = ''postgres''::name) OR (auth.role() = ''service_role''::text))'),
  ('session_deck_versions', 'sdv_select', 'SELECT', 'PERMISSIVE', 'public', '((EXISTS ( SELECT 1
   FROM session_participants sp
  WHERE ((sp.session_id = session_deck_versions.session_id) AND (sp.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM collaboration_sessions cs
  WHERE ((cs.id = session_deck_versions.session_id) AND (cs.created_by = auth.uid())))))', null),
  ('session_participants', 'sp_delete', 'DELETE', 'PERMISSIVE', 'public', '((auth.uid() = user_id) OR is_session_creator(session_id, auth.uid()))', null),
  ('session_participants', 'sp_insert', 'INSERT', 'PERMISSIVE', 'public', null, '((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM collaboration_sessions cs
  WHERE ((cs.id = session_participants.session_id) AND (cs.created_by = auth.uid())))) OR is_session_participant(session_id, auth.uid()))'),
  ('session_participants', 'sp_select', 'SELECT', 'PERMISSIVE', 'public', '((auth.uid() = user_id) OR is_session_creator(session_id, auth.uid()) OR is_session_participant(session_id, auth.uid()))', null),
  ('session_participants', 'sp_update', 'UPDATE', 'PERMISSIVE', 'public', '((auth.uid() = user_id) OR is_session_creator(session_id, auth.uid()))', '((auth.uid() = user_id) OR is_session_creator(session_id, auth.uid()))'),
  ('stay_bulk_job_items', 'stay_bulk_job_items_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_admin_user() OR (EXISTS ( SELECT 1
   FROM stay_bulk_jobs j
  WHERE ((j.id = stay_bulk_job_items.job_id) AND issue_1387_has_brand_capability(j.brand_id, auth.uid(), ''read''::text)))))', null),
  ('stay_bulk_jobs', 'stay_bulk_jobs_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_currency_reconciliation_items', 'stay_currency_reconciliation_items_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_fee_versions', 'stay_fee_versions_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_offering_media', 'stay_offering_media_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_offerings', 'stay_offerings_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_place_schedule_rules', 'stay_place_schedule_rules_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_place_windows', 'stay_place_windows_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_policy_versions', 'stay_policy_versions_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_price_versions', 'stay_price_versions_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_room_nights', 'stay_room_nights_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_settings', 'stay_settings_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stay_units', 'stay_units_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_1387_has_brand_capability(brand_id, auth.uid(), ''read''::text)', null),
  ('stripe_disputes', 'brand_payment_managers_select_stripe_disputes', 'SELECT', 'PERMISSIVE', 'authenticated', '(brand_id IN ( SELECT brand_team_members.brand_id
   FROM brand_team_members
  WHERE ((brand_team_members.user_id = auth.uid()) AND (brand_team_members.removed_at IS NULL) AND (brand_team_members.accepted_at IS NOT NULL) AND (brand_team_members.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text, ''finance_manager''::text])))))', null),
  ('subscriptions', 'Users can read their own subscription', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('subscriptions', 'Users can update their own subscription', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('support_attachments', 'support_attachments_customer_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((NOT is_internal) AND (((message_id IS NOT NULL) AND (ticket_id IS NOT NULL) AND issue_4382_customer_can_view_ticket(ticket_id, auth.uid())) OR (uploaded_by = auth.uid())))', null),
  ('support_attachments', 'support_attachments_staff_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_4382_is_staff(auth.uid())', null),
  ('support_audit_log', 'support_audit_log_staff_read', 'SELECT', 'PERMISSIVE', 'public', '(is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('support_product_signal_sources', 'support_product_signal_sources_operator_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('support_product_signals', 'support_product_signals_operator_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('support_product_workflow_audit', 'support_product_workflow_audit_operator_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('support_staff', 'support_staff_self_read', 'SELECT', 'PERMISSIVE', 'public', '((user_id = auth.uid()) OR is_admin_user())', null),
  ('support_tickets', 'support_tickets_brand_member_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((visibility = ''brand''::text) AND issue_4382_is_brand_member(brand_id, auth.uid()))', null),
  ('support_tickets', 'support_tickets_requester_read', 'SELECT', 'PERMISSIVE', 'public', '(((requester_user_id = auth.uid()) AND (visibility <> ''internal''::text)) OR is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('support_tickets', 'support_tickets_staff_update', 'UPDATE', 'PERMISSIVE', 'public', '(is_support_staff(auth.uid()) OR is_admin_user())', '(is_support_staff(auth.uid()) OR is_admin_user())'),
  ('tag_along_requests', 'Receiver sees incoming requests', 'SELECT', 'PERMISSIVE', 'public', '(receiver_id = auth.uid())', null),
  ('tag_along_requests', 'Sender sees own requests', 'SELECT', 'PERMISSIVE', 'public', '(sender_id = auth.uid())', null),
  ('tag_along_requests', 'Service role manages requests', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('trip_days', 'trip_days_write_event_managers', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = trip_days.event_id) AND (e.event_type = ''trip''::text) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = trip_days.event_id) AND (e.event_type = ''trip''::text) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))'),
  ('trip_edit_log', 'trip_edit_log_owner_read', 'SELECT', 'PERMISSIVE', 'public', '(biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text))', null),
  ('trip_inclusions', 'trip_inclusions_write_event_managers', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = trip_inclusions.event_id) AND (e.event_type = ''trip''::text) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = trip_inclusions.event_id) AND (e.event_type = ''trip''::text) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))'),
  ('trip_intake_schemas', 'trip_intake_schemas_planner_all', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = trip_intake_schemas.event_id) AND (e.event_type = ''trip''::text) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', null),
  ('trip_pricing_tiers', 'trip_pricing_tiers_write_event_managers', 'ALL', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = trip_pricing_tiers.event_id) AND (e.event_type = ''trip''::text) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = trip_pricing_tiers.event_id) AND (e.event_type = ''trip''::text) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))'),
  ('twilio_message_status_events', 'Service role manages twilio_message_status_events', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('undo_actions', 'Users can delete their own undo actions', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('undo_actions', 'Users can insert their own undo actions', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('undo_actions', 'Users can view their own undo actions', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('venue_listings', 'venue listings scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM (brand_team_members member
     JOIN brand_team_member_venue_grants grant_row ON ((grant_row.member_id = member.id)))
  WHERE ((member.user_id = auth.uid()) AND (member.role = ''venue_staff''::text) AND (member.accepted_at IS NOT NULL) AND (member.removed_at IS NULL) AND (grant_row.venue_id = venue_listings.id))))', null),
  ('venue_order_item_modifiers', 'venue order modifiers scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM (venue_order_items item
     JOIN venue_orders order_row ON ((order_row.id = item.venue_order_id)))
  WHERE ((item.id = venue_order_item_modifiers.venue_order_item_id) AND (issue_4188_has_venue_capability(order_row.venue_id, auth.uid(), ''restaurant.view_orders''::text) OR issue_4188_has_venue_capability(order_row.venue_id, auth.uid(), ''restaurant.manage_orders''::text)))))', null),
  ('venue_order_items', 'venue order items scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM venue_orders order_row
  WHERE ((order_row.id = venue_order_items.venue_order_id) AND (issue_4188_has_venue_capability(order_row.venue_id, auth.uid(), ''restaurant.view_orders''::text) OR issue_4188_has_venue_capability(order_row.venue_id, auth.uid(), ''restaurant.manage_orders''::text)))))', null),
  ('venue_order_sessions', 'venue order sessions scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', '(issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.view_orders''::text) OR issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.manage_orders''::text))', null),
  ('venue_orders', 'venue orders scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', '(issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.view_orders''::text) OR issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.manage_orders''::text))', null),
  ('venue_reservation_settings', 'venue reservation settings scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM (brand_team_members member
     JOIN brand_team_member_venue_grants grant_row ON ((grant_row.member_id = member.id)))
  WHERE ((member.user_id = auth.uid()) AND (member.role = ''venue_staff''::text) AND (member.accepted_at IS NOT NULL) AND (member.removed_at IS NULL) AND (grant_row.venue_id = venue_reservation_settings.venue_id))))', null),
  ('venue_tables', 'venue tables scoped staff can read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.manage_reservations''::text)', null),
  ('venue_tables', 'venue tables scoped staff can write', 'ALL', 'PERMISSIVE', 'authenticated', 'issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.manage_reservations''::text)', 'issue_4188_has_venue_capability(venue_id, auth.uid(), ''restaurant.manage_reservations''::text)');

select pg_temp.w4b_mechanical('W4b batch 4', 390);
select pg_temp.w4b_parity('W4b batch 4');
select pg_temp.w4b_report('W4b batch 4', 9);

rollback;
