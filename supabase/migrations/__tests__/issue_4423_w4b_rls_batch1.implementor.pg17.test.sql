-- Issue #4423 Wave 4b batch 1 (messaging, conversations, notifications and team tables) -- implementor suite for
-- 20280705304423_issue_4423_w4b_rls_batch1_messaging.sql, on the fully replayed PG17 schema.
-- Everything is rolled back.
--
--   MECH    the 57 rewritten policies keep their command, mode and roles,
--           and their USING / WITH CHECK text equals the original (text pinned
--           below, taken from production pg_policies) once the sub-select
--           wrappers are removed; no per-row auth.*() call is left.
--   PARITY  on the 13 tables, anon, an owner, another user and
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
  ('conversation_participant_lifecycle', 'conversation_participant_lifecycle_owner_select', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('conversation_participants', 'conversation_participants_brand_enquiry_update_guard', 'UPDATE', 'RESTRICTIVE', 'authenticated', 'issue_4111_participant_row_allowed(conversation_id, auth.uid())', 'issue_4111_participant_row_allowed(conversation_id, auth.uid())'),
  ('conversation_participants', 'conversation_participants_brand_group_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_3720_brand_group_can_access(conversation_id, auth.uid())', null),
  ('conversation_participants', 'conversation_participants_brand_team_member_delete', 'DELETE', 'PERMISSIVE', 'public', 'is_conversation_brand_team_member(conversation_id, auth.uid())', null),
  ('conversation_participants', 'conversation_participants_brand_team_member_read', 'SELECT', 'PERMISSIVE', 'public', 'is_conversation_brand_team_member(conversation_id, auth.uid())', null),
  ('conversation_participants', 'conversation_participants_direct_self_add', 'INSERT', 'PERMISSIVE', 'public', null, '((user_id = auth.uid()) AND is_direct_conversation(conversation_id))'),
  ('conversation_participants', 'Users can update their own participation', 'UPDATE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('conversation_participants', 'Users can view participants in their conversations', 'SELECT', 'PERMISSIVE', 'public', '((user_id = auth.uid()) OR is_conversation_participant(conversation_id, auth.uid()))', null),
  ('conversation_presence', 'conversation_presence_support_staff_read', 'SELECT', 'PERMISSIVE', 'public', '((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_presence.conversation_id) AND (c.linked_entity_type = ''support''::text)))) AND (is_support_staff(auth.uid()) OR is_admin_user()))', null),
  ('conversation_presence', 'Participants can read conversation presence', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = conversation_presence.conversation_id) AND (cp.user_id = auth.uid()))))', null),
  ('conversation_presence', 'Users can update own presence', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('conversation_presence', 'Users can upsert own presence', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('conversations', 'conversations_brand_enquiry_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((linked_entity_type = ''brand_enquiry''::text) AND issue_4111_enquiry_can_read(id, auth.uid()))', null),
  ('conversations', 'conversations_brand_group_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((linked_entity_type = ''brand''::text) AND issue_3720_brand_group_can_access(id, auth.uid()))', null),
  ('conversations', 'conversations_brand_support_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((linked_entity_type = ''support''::text) AND (EXISTS ( SELECT 1
   FROM support_tickets ticket
  WHERE ((ticket.conversation_id = conversations.id) AND (ticket.visibility = ''brand''::text) AND issue_4382_is_brand_member(ticket.brand_id, auth.uid())))))', null),
  ('conversations', 'conversations_brand_team_member_read', 'SELECT', 'PERMISSIVE', 'public', '((linked_entity_type = ANY (ARRAY[''trip''::text, ''event''::text])) AND (event_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (brand_team_members btm
     JOIN events e ON ((e.brand_id = btm.brand_id)))
  WHERE ((e.id = conversations.event_id) AND (btm.user_id = auth.uid()) AND (btm.accepted_at IS NOT NULL) AND (btm.removed_at IS NULL)))))', null),
  ('conversations', 'conversations_brand_team_member_update', 'UPDATE', 'PERMISSIVE', 'public', '((linked_entity_type = ANY (ARRAY[''trip''::text, ''event''::text])) AND (event_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (brand_team_members btm
     JOIN events e ON ((e.brand_id = btm.brand_id)))
  WHERE ((e.id = conversations.event_id) AND (btm.user_id = auth.uid()) AND (btm.accepted_at IS NOT NULL) AND (btm.removed_at IS NULL)))))', '((linked_entity_type = ANY (ARRAY[''trip''::text, ''event''::text])) AND (event_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (brand_team_members btm
     JOIN events e ON ((e.brand_id = btm.brand_id)))
  WHERE ((e.id = conversations.event_id) AND (btm.user_id = auth.uid()) AND (btm.accepted_at IS NOT NULL) AND (btm.removed_at IS NULL)))))'),
  ('conversations', 'conversations_support_staff_read', 'SELECT', 'PERMISSIVE', 'public', '((linked_entity_type = ''support''::text) AND (is_support_staff(auth.uid()) OR is_admin_user()))', null),
  ('conversations', 'Users can create conversations', 'INSERT', 'PERMISSIVE', 'public', null, '(created_by = auth.uid())'),
  ('conversations', 'Users can view conversations they participate in', 'SELECT', 'PERMISSIVE', 'public', '(((created_by = auth.uid()) OR is_conversation_participant(id, auth.uid())) AND (linked_entity_type IS DISTINCT FROM ''support''::text))', null),
  ('conversations', 'Users can view their conversations', 'SELECT', 'PERMISSIVE', 'public', '(is_conversation_participant(id, auth.uid()) AND (linked_entity_type IS DISTINCT FROM ''support''::text))', null),
  ('message_media_views', 'message_media_views_read_own', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('message_media_views', 'message_media_views_sender_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_4114_is_message_sender(message_id, auth.uid())', null),
  ('message_reads', 'message_reads_brand_enquiry_reader_insert', 'INSERT', 'RESTRICTIVE', 'authenticated', null, 'issue_4111_read_receipt_allowed(message_id, auth.uid())'),
  ('message_reads', 'message_reads_brand_enquiry_reader_update', 'UPDATE', 'RESTRICTIVE', 'authenticated', 'issue_4111_read_receipt_allowed(message_id, auth.uid())', 'issue_4111_read_receipt_allowed(message_id, auth.uid())'),
  ('message_reads', 'Users can mark messages as read', 'ALL', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('message_reads', 'Users can view read receipts for messages', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversation_participants cp ON ((cp.conversation_id = m.conversation_id)))
  WHERE ((m.id = message_reads.message_id) AND (cp.user_id = auth.uid()))))', null),
  ('messages', 'messages_brand_enquiry_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((deleted_at IS NULL) AND issue_4111_enquiry_can_read(conversation_id, auth.uid()))', null),
  ('messages', 'messages_brand_group_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((deleted_at IS NULL) AND issue_3720_brand_group_can_access(conversation_id, auth.uid()))', null),
  ('messages', 'messages_brand_support_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM support_tickets ticket
  WHERE ((ticket.conversation_id = messages.conversation_id) AND (ticket.visibility = ''brand''::text) AND issue_4382_is_brand_member(ticket.brand_id, auth.uid())))))', null),
  ('messages', 'messages_brand_team_member_insert', 'INSERT', 'PERMISSIVE', 'public', null, '((sender_id = auth.uid()) AND is_conversation_brand_team_member(conversation_id, auth.uid()))'),
  ('messages', 'messages_brand_team_member_read', 'SELECT', 'PERMISSIVE', 'public', '((deleted_at IS NULL) AND is_conversation_brand_team_member(conversation_id, auth.uid()))', null),
  ('messages', 'messages_brand_team_member_update', 'UPDATE', 'PERMISSIVE', 'public', 'is_conversation_brand_team_member(conversation_id, auth.uid())', 'is_conversation_brand_team_member(conversation_id, auth.uid())'),
  ('messages', 'messages_broadcast_only_enforcement', 'INSERT', 'RESTRICTIVE', 'public', null, 'can_insert_message_into_conversation(conversation_id, auth.uid())'),
  ('messages', 'messages_history_visible_from', 'SELECT', 'RESTRICTIVE', 'public', '(NOT (EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = messages.conversation_id) AND (cp.user_id = auth.uid()) AND (cp.history_visible_from IS NOT NULL) AND (messages.created_at < cp.history_visible_from)))))', null),
  ('messages', 'messages_support_internal_insert_guard', 'INSERT', 'RESTRICTIVE', 'public', null, '((NOT is_internal) OR ((( SELECT is_support_staff(auth.uid()) AS is_support_staff) OR ( SELECT is_admin_user() AS is_admin_user)) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.linked_entity_type = ''support''::text))))))'),
  ('messages', 'messages_support_internal_read_guard', 'SELECT', 'RESTRICTIVE', 'public', '((NOT is_internal) OR ( SELECT is_support_staff(auth.uid()) AS is_support_staff) OR ( SELECT is_admin_user() AS is_admin_user))', null),
  ('messages', 'messages_support_internal_update_guard', 'UPDATE', 'RESTRICTIVE', 'public', '((NOT is_internal) OR ( SELECT is_support_staff(auth.uid()) AS is_support_staff) OR ( SELECT is_admin_user() AS is_admin_user))', '((NOT is_internal) OR ( SELECT is_support_staff(auth.uid()) AS is_support_staff) OR ( SELECT is_admin_user() AS is_admin_user))'),
  ('messages', 'messages_support_staff_insert', 'INSERT', 'PERMISSIVE', 'public', null, '((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.linked_entity_type = ''support''::text)))) AND (is_support_staff(auth.uid()) OR is_admin_user()))'),
  ('messages', 'messages_support_staff_read', 'SELECT', 'PERMISSIVE', 'public', '((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.linked_entity_type = ''support''::text)))) AND (is_support_staff(auth.uid()) OR is_admin_user()))', null),
  ('messages', 'Users can delete their own messages', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = sender_id)', null),
  ('messages', 'Users can send messages to conversations they participate in', 'INSERT', 'PERMISSIVE', 'public', null, '((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = messages.conversation_id) AND (cp.user_id = auth.uid())))) AND (NOT (EXISTS ( SELECT 1
   FROM blocked_users bu
  WHERE (((bu.blocker_id = auth.uid()) AND (bu.blocked_id IN ( SELECT cp2.user_id
           FROM conversation_participants cp2
          WHERE ((cp2.conversation_id = messages.conversation_id) AND (cp2.user_id <> auth.uid()))))) OR ((bu.blocked_id = auth.uid()) AND (bu.blocker_id IN ( SELECT cp3.user_id
           FROM conversation_participants cp3
          WHERE ((cp3.conversation_id = messages.conversation_id) AND (cp3.user_id <> auth.uid()))))))))))'),
  ('messages', 'Users can update their own messages', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = sender_id)', null),
  ('messages', 'Users can view messages in conversations', 'SELECT', 'PERMISSIVE', 'public', '((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = messages.conversation_id) AND (cp.user_id = auth.uid())))))', null),
  ('messages', 'Users can view messages in their conversations', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = messages.conversation_id) AND (cp.user_id = auth.uid()))))', null),
  ('notification_channel_prefs', 'notification_channel_prefs_owner', 'ALL', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('notification_deliveries', 'notification_deliveries_read_own', 'SELECT', 'PERMISSIVE', 'authenticated', '((notification_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM notifications n
  WHERE ((n.id = notification_deliveries.notification_id) AND (n.user_id = auth.uid())))))', null),
  ('notification_preferences', 'User manages own notification preferences', 'ALL', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ('notification_preferences', 'Users can delete their own preferences', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('notification_preferences', 'Users can insert their own preferences', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('notification_preferences', 'Users can read their own preferences', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('notification_preferences', 'Users can update their own preferences', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('notifications', 'Users can delete own notifications', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('notifications', 'Users can read own notifications', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('notifications', 'Users can update own notifications (mark read)', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('team_mentions', 'team_mentions_recipient_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(target_user_id = auth.uid())', null),
  ('team_reads', 'team_reads_own_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((user_id = auth.uid()) AND team_chat_can_read(thread_id))', null);

select pg_temp.w4b_mechanical('W4b batch 1', 57);
select pg_temp.w4b_parity('W4b batch 1');
select pg_temp.w4b_report('W4b batch 1', 9);

rollback;
