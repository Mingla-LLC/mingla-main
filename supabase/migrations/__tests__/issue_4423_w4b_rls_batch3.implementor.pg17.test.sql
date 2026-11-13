-- Issue #4423 Wave 4b batch 3 (orders, events, tickets and brands) -- implementor suite for
-- 20280707324423_issue_4423_w4b_rls_batch3_commerce.sql, on the fully replayed PG17 schema.
-- Everything is rolled back.
--
--   MECH    the 66 rewritten policies keep their command, mode and roles,
--           and their USING / WITH CHECK text equals the original (text pinned
--           below, taken from production pg_policies) once the sub-select
--           wrappers are removed; no per-row auth.*() call is left.
--   PARITY  on the 38 tables, anon, an owner, another user and
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
  ('brand_circle_exits', 'brand_circle_exits_owner_delete', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('brand_circle_exits', 'brand_circle_exits_owner_insert', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('brand_circle_exits', 'brand_circle_exits_owner_select', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('brand_circle_exits', 'brand_circle_exits_owner_update', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('brand_circle_preferences', 'brand_circle_preferences_owner_delete', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('brand_circle_preferences', 'brand_circle_preferences_owner_insert', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('brand_circle_preferences', 'brand_circle_preferences_owner_select', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('brand_circle_preferences', 'brand_circle_preferences_owner_update', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('brand_creator_roster', 'roster_host_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'biz_is_brand_member_for_read(brand_id, auth.uid())', null),
  ('brand_currency_reconciliations', 'brand_currency_reconciliations_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_admin_user() OR (biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))', null),
  ('brand_discount_targets', 'bdt_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brand_discounts d
  WHERE ((d.id = brand_discount_targets.discount_id) AND (d.deleted_at IS NULL) AND (COALESCE(biz_brand_effective_rank(d.brand_id, auth.uid()), 0) >= 20))))', null),
  ('brand_discounts', 'bd_read', 'SELECT', 'PERMISSIVE', 'authenticated', '((deleted_at IS NULL) AND (COALESCE(biz_brand_effective_rank(brand_id, auth.uid()), 0) >= 20))', null),
  ('brand_enquiries', 'brand_enquiries_read', 'SELECT', 'PERMISSIVE', 'authenticated', 'issue_4111_enquiry_row_readable(brand_enquiries.*, auth.uid())', null),
  ('brand_follow_channel_prefs', 'bfcp_owner_select', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('brand_follows', 'bf_owner_delete', 'DELETE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('brand_follows', 'bf_owner_insert', 'INSERT', 'PERMISSIVE', 'public', null, '(auth.uid() = user_id)'),
  ('brand_follows', 'bf_owner_select', 'SELECT', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', null),
  ('brand_follows', 'bf_owner_update', 'UPDATE', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
  ('brand_group_audit_log', 'brand_group_audit_operator_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(is_support_staff(auth.uid()) OR is_admin_user())', null),
  ('brand_group_reads', 'brand_group_reads_self', 'SELECT', 'PERMISSIVE', 'authenticated', '(user_id = auth.uid())', null),
  ('brand_hours', 'Brand owners can select own brand_hours', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = brand_hours.brand_id) AND (b.account_id = auth.uid()) AND (b.deleted_at IS NULL))))', null),
  ('brand_invitations', 'brand_invitations_insert_brand_admin_plus', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((invited_by = auth.uid()) AND ((EXISTS ( SELECT 1
   FROM (brand_team_members m
     JOIN brands b ON ((b.id = m.brand_id)))
  WHERE ((m.brand_id = brand_invitations.brand_id) AND (m.user_id = auth.uid()) AND (m.removed_at IS NULL) AND (m.accepted_at IS NOT NULL) AND (b.deleted_at IS NULL) AND (m.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text]))))) OR (EXISTS ( SELECT 1
   FROM (brands b
     JOIN creator_accounts a ON ((a.id = b.account_id)))
  WHERE ((b.id = brand_invitations.brand_id) AND (a.id = auth.uid()) AND (b.deleted_at IS NULL))))))'),
  ('brand_invitations', 'brand_invitations_select_brand_admin_plus', 'SELECT', 'PERMISSIVE', 'authenticated', '((EXISTS ( SELECT 1
   FROM (brand_team_members m
     JOIN brands b ON ((b.id = m.brand_id)))
  WHERE ((m.brand_id = brand_invitations.brand_id) AND (m.user_id = auth.uid()) AND (m.removed_at IS NULL) AND (m.accepted_at IS NOT NULL) AND (b.deleted_at IS NULL) AND (m.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text]))))) OR (EXISTS ( SELECT 1
   FROM (brands b
     JOIN creator_accounts a ON ((a.id = b.account_id)))
  WHERE ((b.id = brand_invitations.brand_id) AND (a.id = auth.uid()) AND (b.deleted_at IS NULL)))))', null),
  ('brand_invitations', 'brand_invitations_update_brand_admin_plus', 'UPDATE', 'PERMISSIVE', 'authenticated', '((EXISTS ( SELECT 1
   FROM (brand_team_members m
     JOIN brands b ON ((b.id = m.brand_id)))
  WHERE ((m.brand_id = brand_invitations.brand_id) AND (m.user_id = auth.uid()) AND (m.removed_at IS NULL) AND (m.accepted_at IS NOT NULL) AND (b.deleted_at IS NULL) AND (m.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text]))))) OR (EXISTS ( SELECT 1
   FROM (brands b
     JOIN creator_accounts a ON ((a.id = b.account_id)))
  WHERE ((b.id = brand_invitations.brand_id) AND (a.id = auth.uid()) AND (b.deleted_at IS NULL)))))', '((EXISTS ( SELECT 1
   FROM (brand_team_members m
     JOIN brands b ON ((b.id = m.brand_id)))
  WHERE ((m.brand_id = brand_invitations.brand_id) AND (m.user_id = auth.uid()) AND (m.removed_at IS NULL) AND (m.accepted_at IS NOT NULL) AND (b.deleted_at IS NULL) AND (m.role = ANY (ARRAY[''brand_owner''::text, ''brand_admin''::text]))))) OR (EXISTS ( SELECT 1
   FROM (brands b
     JOIN creator_accounts a ON ((a.id = b.account_id)))
  WHERE ((b.id = brand_invitations.brand_id) AND (a.id = auth.uid()) AND (b.deleted_at IS NULL)))))'),
  ('brand_payout_releases', 'brand_payout_releases_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank(''finance_manager''::text))', null),
  ('brand_place_pipeline_state', 'brand_place_pipeline_state_owner_insert', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = brand_place_pipeline_state.brand_id) AND (b.account_id = auth.uid()) AND (b.deleted_at IS NULL))))'),
  ('brand_place_pipeline_state', 'brand_place_pipeline_state_owner_select', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = brand_place_pipeline_state.brand_id) AND (b.account_id = auth.uid()) AND (b.deleted_at IS NULL))))', null),
  ('brand_place_pipeline_state', 'brand_place_pipeline_state_owner_update', 'UPDATE', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = brand_place_pipeline_state.brand_id) AND (b.account_id = auth.uid()) AND (b.deleted_at IS NULL))))', '(EXISTS ( SELECT 1
   FROM brands b
  WHERE ((b.id = brand_place_pipeline_state.brand_id) AND (b.account_id = auth.uid()) AND (b.deleted_at IS NULL))))'),
  ('brand_site_hosts', 'brand_site_hosts_marketing_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brand_sites site
  WHERE ((site.id = brand_site_hosts.site_id) AND (biz_brand_effective_rank(site.brand_id, auth.uid()) >= 20))))', null),
  ('brand_site_operation_receipts', 'brand_site_receipts_marketing_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(biz_brand_effective_rank(brand_id, auth.uid()) >= 20)', null),
  ('brand_site_publications', 'brand_site_publications_marketing_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brand_sites site
  WHERE ((site.id = brand_site_publications.site_id) AND (biz_brand_effective_rank(site.brand_id, auth.uid()) >= 20))))', null),
  ('brand_sites', 'brand_sites_marketing_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(biz_brand_effective_rank(brand_id, auth.uid()) >= 20)', null),
  ('brand_team_member_venue_grants', 'member venue grants admins or self can read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM brand_team_members member
  WHERE ((member.id = brand_team_member_venue_grants.member_id) AND ((member.user_id = auth.uid()) OR (biz_brand_effective_rank_for_caller(member.brand_id) >= biz_role_rank(''brand_admin''::text))))))', null),
  ('brand_team_members', 'Members and admins read brand_team_members', 'SELECT', 'PERMISSIVE', 'authenticated', '((user_id = auth.uid()) OR biz_is_brand_admin_plus_for_caller(brand_id))', null),
  ('brands', 'Account owner can insert brand', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((account_id = auth.uid()) AND (deleted_at IS NULL))'),
  ('brands', 'Account owner can select own brands', 'SELECT', 'PERMISSIVE', 'authenticated', '(account_id = auth.uid())', null),
  ('brands', 'Account owner can update own brand', 'UPDATE', 'PERMISSIVE', 'authenticated', '(account_id = auth.uid())', '(account_id = auth.uid())'),
  ('brands', 'venue staff can select assigned brand', 'SELECT', 'PERMISSIVE', 'authenticated', '((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM (brand_team_members member
     JOIN brand_team_member_venue_grants grant_row ON ((grant_row.member_id = member.id)))
  WHERE ((member.brand_id = brands.id) AND (member.user_id = auth.uid()) AND (member.role = ''venue_staff''::text) AND (member.accepted_at IS NOT NULL) AND (member.removed_at IS NULL)))))', null),
  ('event_cancel_refund_progress', 'event_cancel_refund_progress_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_cancel_refund_progress.event_id) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''finance_manager''::text)))))', null),
  ('event_cancel_refund_runs', 'event_cancel_refund_runs_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_cancel_refund_runs.event_id) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''finance_manager''::text)))))', null),
  ('event_cover_video_jobs', 'Authorized managers can read cover video jobs', 'SELECT', 'PERMISSIVE', 'authenticated', '(((target_kind = ANY (ARRAY[''event''::text, ''trip_day_media''::text])) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_cover_video_jobs.event_id) AND (e.brand_id = event_cover_video_jobs.brand_id) AND (e.deleted_at IS NULL) AND (biz_brand_effective_rank_for_caller(e.brand_id) >= biz_role_rank(''event_manager''::text)))))) OR ((target_kind = ANY (ARRAY[''brand''::text, ''venue''::text])) AND (biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank(''brand_admin''::text))) OR ((target_kind = ''venue_draft''::text) AND (requested_by = auth.uid()) AND (biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank(''brand_admin''::text))) OR ((target_kind = ''ad_creative''::text) AND (requested_by = auth.uid()) AND (((brand_id IS NULL) AND is_admin_user()) OR ((brand_id IS NOT NULL) AND (biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank(''marketing_manager''::text))))))', null),
  ('event_rsvp_contributions', 'event_rsvp_contributions_guest_read_own', 'SELECT', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('event_rsvp_contributions', 'event_rsvp_contributions_host_read', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_rsvp_contributions.event_id) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', null),
  ('event_rsvp_guests', 'event_rsvp_guests_host_read', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM (event_rsvps r
     JOIN events e ON ((e.id = r.event_id)))
  WHERE ((r.id = event_rsvp_guests.rsvp_id) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', null),
  ('event_rsvp_guests', 'event_rsvp_guests_owner_read', 'SELECT', 'PERMISSIVE', 'public', '((EXISTS ( SELECT 1
   FROM event_rsvps r
  WHERE ((r.id = event_rsvp_guests.rsvp_id) AND (r.user_id = auth.uid())))) OR (matched_user_id = auth.uid()))', null),
  ('event_rsvps', 'event_rsvps_guest_insert_own', 'INSERT', 'PERMISSIVE', 'public', null, '((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_rsvps.event_id) AND (e.event_type = ''rsvp''::text) AND (e.status = ANY (ARRAY[''scheduled''::text, ''live''::text])) AND (e.deleted_at IS NULL)))))'),
  ('event_rsvps', 'event_rsvps_guest_read_own', 'SELECT', 'PERMISSIVE', 'public', '(user_id = auth.uid())', null),
  ('event_rsvps', 'event_rsvps_guest_update_own', 'UPDATE', 'PERMISSIVE', 'public', '(user_id = auth.uid())', '((user_id = auth.uid()) AND (rsvp_status = ANY (ARRAY[''going''::text, ''not_going''::text, ''maybe''::text])))'),
  ('event_rsvps', 'event_rsvps_host_read', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_rsvps.event_id) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', null),
  ('event_rsvps', 'event_rsvps_host_write', 'UPDATE', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_rsvps.event_id) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))', '(EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_rsvps.event_id) AND (biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text)))))'),
  ('event_scanners', 'Event manager plus insert event_scanners', 'INSERT', 'PERMISSIVE', 'authenticated', null, '(biz_is_event_manager_plus_for_caller(event_id) AND (assigned_by = auth.uid()))'),
  ('event_scanners', 'Scanners and managers read event_scanners', 'SELECT', 'PERMISSIVE', 'authenticated', '((user_id = auth.uid()) OR biz_is_event_manager_plus_for_caller(event_id))', null),
  ('events', 'Event manager plus can insert events', 'INSERT', 'PERMISSIVE', 'authenticated', null, '((deleted_at IS NULL) AND (created_by = auth.uid()) AND (biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank(''event_manager''::text)))'),
  ('order_attributions', 'order_attributions_brand_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(COALESCE(biz_brand_effective_rank(brand_id, auth.uid()), 0) >= 20)', null),
  ('order_installments', 'order_installments_read_buyer', 'SELECT', 'PERMISSIVE', 'public', '(EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_installments.order_id) AND (o.buyer_user_id IS NOT NULL) AND (o.buyer_user_id = auth.uid()))))', null),
  ('ticket_checkout_session_items', 'Brand team reads ticket_checkout_session_items', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM ticket_checkout_sessions s
  WHERE ((s.id = ticket_checkout_session_items.checkout_session_id) AND biz_is_brand_member_for_read(s.brand_id, auth.uid()))))', null),
  ('ticket_checkout_session_items', 'Service role manages ticket_checkout_session_items', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('ticket_checkout_sessions', 'Brand team reads ticket_checkout_sessions', 'SELECT', 'PERMISSIVE', 'authenticated', 'biz_is_brand_member_for_read(brand_id, auth.uid())', null),
  ('ticket_checkout_sessions', 'Service role manages ticket_checkout_sessions', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('ticket_event_dates', 'Buyer or brand team can select ticket event dates', 'SELECT', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM (tickets t
     LEFT JOIN orders o ON ((o.id = t.order_id)))
  WHERE ((t.id = ticket_event_dates.ticket_id) AND (biz_is_brand_member_for_read(biz_event_brand_id(t.event_id), auth.uid()) OR (NOT (o.buyer_user_id IS DISTINCT FROM auth.uid()))))))', null),
  ('ticket_order_notifications', 'Brand team reads ticket_order_notifications', 'SELECT', 'PERMISSIVE', 'authenticated', 'biz_is_brand_member_for_read(biz_event_brand_id(event_id), auth.uid())', null),
  ('ticket_order_notifications', 'Service role manages ticket_order_notifications', 'ALL', 'PERMISSIVE', 'public', '(auth.role() = ''service_role''::text)', '(auth.role() = ''service_role''::text)'),
  ('ticket_type_links', 'ticket_type_links_team_read', 'SELECT', 'PERMISSIVE', 'authenticated', '(biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank(''event_manager''::text))', null),
  ('tickets', 'Buyer or brand team can select tickets', 'SELECT', 'PERMISSIVE', 'authenticated', '(biz_is_brand_member_for_read(biz_event_brand_id(event_id), auth.uid()) OR (holder_user_id = auth.uid()) OR ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = tickets.order_id) AND (o.buyer_user_id = auth.uid())))) AND ((holder_user_id IS NULL) OR (holder_user_id = auth.uid()))))', null),
  ('tickets', 'Finance plus can update tickets', 'UPDATE', 'PERMISSIVE', 'authenticated', '(biz_brand_effective_rank(biz_event_brand_id(event_id), auth.uid()) >= biz_role_rank(''finance_manager''::text))', '(biz_brand_effective_rank(biz_event_brand_id(event_id), auth.uid()) >= biz_role_rank(''finance_manager''::text))'),
  ('tickets', 'Scanners can update tickets for check-in', 'UPDATE', 'PERMISSIVE', 'authenticated', '(EXISTS ( SELECT 1
   FROM event_scanners es
  WHERE ((es.event_id = tickets.event_id) AND (es.user_id = auth.uid()) AND (es.removed_at IS NULL) AND COALESCE(((es.permissions ->> ''scan''::text))::boolean, true))))', '(EXISTS ( SELECT 1
   FROM event_scanners es
  WHERE ((es.event_id = tickets.event_id) AND (es.user_id = auth.uid()) AND (es.removed_at IS NULL) AND COALESCE(((es.permissions ->> ''scan''::text))::boolean, true))))');

select pg_temp.w4b_mechanical('W4b batch 3', 66);
select pg_temp.w4b_parity('W4b batch 3');
select pg_temp.w4b_report('W4b batch 3', 9);

rollback;
