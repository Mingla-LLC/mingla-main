-- #3988 Community & Support permissions, executable PostgreSQL 17 proof.
-- MINGLA-INVARIANT: I-3988-TAB-AREA-EQUALS-RPC-GUARD | issue #3988 | Every Community and Support area an Admin teammate receives is computed from the same predicate as the RPC guard behind its tabs, so a shown tab always loads and a permitted tab is never hidden.
-- MINGLA-INVARIANT: I-3988-OPERATIONAL-ACCESS-REQUIRES-ACTIVE-TEAM | issue #3988 | Community and Support powers require a current, non-removed Mingla team record; a support_staff or community_staff row alone grants nothing.
-- MINGLA-INVARIANT: I-3988-STAFF-ROWS-ADMIN-WRITE-ONLY | issue #3988 | Only Owner or Admin functions and the service role write support_staff; a signed-in user changes only their own availability through support_set_available.
-- Runs after the complete migration replay and rolls every fixture back.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t3988_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3988_people VALUES
  ('owner',     '39880000-0000-4000-a100-000000000001', 'issue3988-owner@test.local'),
  ('admin',     '39880000-0000-4000-a100-000000000002', 'issue3988-admin@test.local'),
  ('teammate',  '39880000-0000-4000-a100-000000000003', 'issue3988-teammate@test.local'),
  ('lead',      '39880000-0000-4000-a100-000000000004', 'issue3988-lead@test.local'),
  ('off',       '39880000-0000-4000-a100-000000000005', 'issue3988-off@test.local'),
  ('partner',   '39880000-0000-4000-a100-000000000006', 'issue3988-partner@test.local'),
  ('revoked',   '39880000-0000-4000-a100-000000000007', 'issue3988-revoked@test.local'),
  ('outsider',  '39880000-0000-4000-a100-000000000008', 'issue3988-outsider@test.local'),
  ('leftover',  '39880000-0000-4000-a100-000000000009', 'issue3988-leftover@test.local'),
  ('requester', '39880000-0000-4000-a100-000000000010', 'issue3988-requester@test.local');

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT id, email, now() FROM t3988_people;

INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('issue3988-owner@test.local', 'owner', 'active', now()),
  ('issue3988-admin@test.local', 'admin', 'active', now());

INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue3988-teammate@test.local', 'growth', 'active', now()),
  ('issue3988-lead@test.local', 'growth', 'active', now()),
  ('issue3988-off@test.local', 'growth', 'active', now()),
  ('issue3988-partner@test.local', 'partner', 'active', now()),
  ('issue3988-revoked@test.local', 'growth', 'revoked', now()),
  ('issue3988-leftover@test.local', 'growth', 'active', now());

INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('39880000-0000-4000-a100-000000000003', true, false, 'staff'),
  ('39880000-0000-4000-a100-000000000004', true, false, 'lead'),
  ('39880000-0000-4000-a100-000000000006', true, false, 'staff'),
  ('39880000-0000-4000-a100-000000000007', true, true, 'staff'),
  ('39880000-0000-4000-a100-000000000008', true, true, 'staff');

INSERT INTO public.community_staff (user_id, role, enabled) VALUES
  ('39880000-0000-4000-a100-000000000007', 'moderator', true),
  ('39880000-0000-4000-a100-000000000009', 'moderator', true);

-- A Host brand: its official Brand group is the Support tab fixture.
INSERT INTO public.creator_accounts (id, email, display_name, business_name)
VALUES ('39880000-0000-4000-a100-000000000010', 'issue3988-requester@test.local', 'Requester', 'Issue 3988 Host');
INSERT INTO public.brands (id, account_id, name, slug)
VALUES ('39880000-0000-4000-b200-000000000001', '39880000-0000-4000-a100-000000000010', 'Issue 3988 Brand', 'issue-3988-brand');

-- Earlier suites may leave available rows behind; this proof owns presence.
UPDATE public.support_staff SET available = false
 WHERE user_id NOT IN (SELECT id FROM t3988_people);

-- Run one SQL expression as a persona; returns its text value or ERR:<code>:<message>.
CREATE FUNCTION pg_temp.t3988_as(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_answer text;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t3988_people WHERE who = p_who;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.email', v_email, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SELECT (' || p_sql || ')::text' INTO v_answer;
  RESET ROLE;
  RETURN COALESCE(v_answer, 'NULL');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

-- Run one statement as a persona; returns the affected row count or ERR:<code>:<message>.
CREATE FUNCTION pg_temp.t3988_exec(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_rows integer;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t3988_people WHERE who = p_who;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.email', v_email, true);
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  RETURN v_rows::text;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

CREATE FUNCTION pg_temp.t3988_areas(p_who text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.t3988_as(p_who, 'public.admin_team_my_operational_areas()');
$$;

-- A requester opens a ticket: the new-ticket alert reaches only effective staff.
DO $ticket$
DECLARE v_ticket text;
BEGIN
  v_ticket := pg_temp.t3988_as('requester', 'public.create_support_ticket(''Help with my event'', NULL)');
  IF v_ticket LIKE 'ERR:%' THEN RAISE EXCEPTION 'ticket_create_failed:%', v_ticket; END IF;
  PERFORM set_config('t3988.ticket', v_ticket, true);
END;
$ticket$;

DO $proof$
DECLARE
  v_full constant text := '{community_support,community_support_support,team_notifications,community_support_community,data_room}';
  v_team constant text := '{community_support,community_support_support,team_notifications,community_support_community}';
  v_who text;
  v_areas text;
  v_has_community boolean;
  v_has_support boolean;
  v_result text;
  v_rpc text;
BEGIN
  -- 1. Every persona gets exactly one of the fused role shapes.
  IF pg_temp.t3988_areas('owner') <> v_full OR pg_temp.t3988_areas('admin') <> v_full THEN
    RAISE EXCEPTION 'full_admin_areas_wrong:%/%', pg_temp.t3988_areas('owner'), pg_temp.t3988_areas('admin');
  END IF;
  IF pg_temp.t3988_areas('teammate') <> v_team OR pg_temp.t3988_areas('lead') <> v_team THEN
    RAISE EXCEPTION 'support_teammate_does_not_get_both:%/%', pg_temp.t3988_areas('teammate'), pg_temp.t3988_areas('lead');
  END IF;
  IF pg_temp.t3988_areas('partner') <> v_full THEN
    RAISE EXCEPTION 'partner_teammate_areas_wrong:%', pg_temp.t3988_areas('partner');
  END IF;
  IF pg_temp.t3988_areas('off') <> '{team_notifications}' THEN
    RAISE EXCEPTION 'role_off_still_opens_tabs:%', pg_temp.t3988_areas('off');
  END IF;
  IF pg_temp.t3988_areas('leftover') <> '{team_notifications}' THEN
    RAISE EXCEPTION 'leftover_community_row_grants_access:%', pg_temp.t3988_areas('leftover');
  END IF;
  IF pg_temp.t3988_areas('revoked') <> '{}' OR pg_temp.t3988_areas('outsider') <> '{}' THEN
    RAISE EXCEPTION 'staff_row_without_team_grants_access:%/%', pg_temp.t3988_areas('revoked'), pg_temp.t3988_areas('outsider');
  END IF;

  -- 2. Shown tab <=> its RPC guard passes, for every persona and every tab RPC.
  FOREACH v_who IN ARRAY ARRAY['owner','admin','teammate','lead','off','partner','revoked','outsider','leftover'] LOOP
    v_areas := pg_temp.t3988_areas(v_who);
    v_has_community := v_areas LIKE '%community_support_community%';
    v_has_support := v_areas LIKE '%community_support_support%';

    FOREACH v_rpc IN ARRAY ARRAY[
      '(SELECT count(*) FROM public.issue_3720_admin_list_posts(''idea'', ''all''))',
      '(SELECT count(*) FROM public.issue_3720_admin_list_posts(''question'', ''all''))',
      '(SELECT count(*) FROM public.issue_3720_admin_moderation_workspace(''first_posts''))'
    ] LOOP
      v_result := pg_temp.t3988_as(v_who, v_rpc);
      IF (v_result NOT LIKE 'ERR:%') IS DISTINCT FROM v_has_community THEN
        RAISE EXCEPTION 'community_tab_guard_mismatch:%:%:%', v_who, v_rpc, v_result;
      END IF;
    END LOOP;

    v_result := pg_temp.t3988_as(v_who, '(SELECT count(*) FROM public.issue_3720_list_feature_guide(NULL::text))');
    IF (v_result NOT LIKE 'ERR:%') IS DISTINCT FROM v_has_support THEN
      RAISE EXCEPTION 'feature_guide_guard_mismatch:%:%', v_who, v_result;
    END IF;

    -- Brand groups filter rather than raise: the Host's group is listed iff Support is shown.
    v_result := pg_temp.t3988_as(v_who,
      '(SELECT count(*) FROM public.issue_3720_list_brand_groups() WHERE brand_id = ''39880000-0000-4000-b200-000000000001'')');
    IF (v_result = '1') IS DISTINCT FROM v_has_support THEN
      RAISE EXCEPTION 'brand_group_visibility_mismatch:%:%', v_who, v_result;
    END IF;

    -- Tickets are RLS-guarded: the fixture ticket is visible iff Support is shown.
    v_result := pg_temp.t3988_as(v_who,
      '(SELECT count(*) FROM public.support_tickets WHERE id = ' || quote_literal(current_setting('t3988.ticket')) || '::uuid)');
    IF (v_result = '1') IS DISTINCT FROM v_has_support THEN
      RAISE EXCEPTION 'ticket_visibility_mismatch:%:%', v_who, v_result;
    END IF;

    -- The availability switch is shown with Support and must then work.
    v_result := pg_temp.t3988_as(v_who, 'public.support_set_available(false)');
    IF (v_result = 'false') IS DISTINCT FROM v_has_support THEN
      RAISE EXCEPTION 'availability_switch_mismatch:%:%', v_who, v_result;
    END IF;
  END LOOP;

  -- 3. Overview counts stay Admin-only.
  IF pg_temp.t3988_as('owner', '(public.issue_3720_admin_overview() IS NOT NULL)') <> 'true'
     OR pg_temp.t3988_as('teammate', '(public.issue_3720_admin_overview() IS NOT NULL)') NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'overview_scope_changed';
  END IF;
END;
$proof$;

-- 4. Alerts, online state and recipients follow effective Support staff only.
DO $alerts$
DECLARE v_ticket uuid := current_setting('t3988.ticket')::uuid;
BEGIN
  IF (SELECT array_agg(user_id ORDER BY user_id)::text FROM public.notification_outbox
       WHERE category_key = 'business.support_new_ticket' AND payload->>'ticket_id' = v_ticket::text
         AND user_id IN (SELECT id FROM t3988_people))
     IS DISTINCT FROM '{39880000-0000-4000-a100-000000000003,39880000-0000-4000-a100-000000000004,39880000-0000-4000-a100-000000000006}' THEN
    RAISE EXCEPTION 'new_ticket_alert_recipients_wrong';
  END IF;

  -- Only the non-team and revoked rows were available: nobody real is online.
  UPDATE public.support_staff SET available = false
   WHERE user_id IN ('39880000-0000-4000-a100-000000000003','39880000-0000-4000-a100-000000000004','39880000-0000-4000-a100-000000000006');
  IF public.support_is_online() THEN RAISE EXCEPTION 'non_team_row_made_support_online'; END IF;
  IF EXISTS (SELECT 1 FROM public.issue_3988_support_alert_recipients() r(id) WHERE r.id IN (SELECT id FROM t3988_people)) THEN
    RAISE EXCEPTION 'non_team_row_receives_reply_alerts';
  END IF;

  IF pg_temp.t3988_as('teammate', 'public.support_set_available(true)') <> 'true' THEN
    RAISE EXCEPTION 'teammate_cannot_go_available';
  END IF;
  IF NOT public.support_is_online() THEN RAISE EXCEPTION 'available_teammate_not_online'; END IF;
  IF (SELECT array_agg(r.id)::text FROM public.issue_3988_support_alert_recipients() r(id)
       WHERE r.id IN (SELECT id FROM t3988_people)) <> '{39880000-0000-4000-a100-000000000003}' THEN
    RAISE EXCEPTION 'reply_alert_recipients_wrong';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_3988_support_alert_recipients()', 'EXECUTE') THEN
    RAISE EXCEPTION 'alert_recipients_exposed_to_clients';
  END IF;
END;
$alerts$;

-- 5. Owner/Admin first toggle puts them on the rota, exactly once.
DO $rota$
BEGIN
  DELETE FROM public.support_staff WHERE user_id = '39880000-0000-4000-a100-000000000002';
  IF pg_temp.t3988_as('admin', 'public.support_set_available(true)') <> 'true'
     OR pg_temp.t3988_as('admin', 'public.support_set_available(true)') <> 'true' THEN
    RAISE EXCEPTION 'admin_first_toggle_failed';
  END IF;
  IF (SELECT count(*) FROM public.support_staff WHERE user_id = '39880000-0000-4000-a100-000000000002' AND enabled AND available) <> 1 THEN
    RAISE EXCEPTION 'admin_rota_row_not_created_once';
  END IF;
END;
$rota$;

-- 6. Staff rows are admin-write only; availability is the only self-write.
DO $writes$
DECLARE v_result text;
BEGIN
  v_result := pg_temp.t3988_exec('teammate',
    'UPDATE public.support_staff SET role = ''lead'', enabled = true WHERE user_id = auth.uid()');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'self_promotion_not_refused:%', v_result; END IF;
  v_result := pg_temp.t3988_exec('off',
    'INSERT INTO public.support_staff(user_id, enabled, role) VALUES (auth.uid(), true, ''lead'')');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'self_insert_not_refused:%', v_result; END IF;
  v_result := pg_temp.t3988_exec('revoked',
    'UPDATE public.support_staff SET enabled = true WHERE user_id = auth.uid()');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'self_reenable_not_refused:%', v_result; END IF;
  v_result := pg_temp.t3988_exec('teammate', 'DELETE FROM public.support_staff WHERE user_id = auth.uid()');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'self_delete_not_refused:%', v_result; END IF;
  IF has_table_privilege('anon', 'public.support_staff', 'SELECT') THEN
    RAISE EXCEPTION 'anon_reads_support_staff';
  END IF;
END;
$writes$;

-- 7. People and roles: one role per teammate, set by Owner/Admin. (Both admins
--    toggled availability above, so both are on the rota.)
DO $people$
DECLARE
  v_result text;
  v_row record;
BEGIN
  v_result := pg_temp.t3988_as('owner',
    '(SELECT string_agg(email || ''='' || role || ''/'' || team_status || ''/'' || effective, '','' ORDER BY email) FROM public.issue_3988_admin_people() WHERE email LIKE ''issue3988-%'')');
  IF v_result <> 'issue3988-admin@test.local=included_rota/active/true,issue3988-lead@test.local=lead/active/true,issue3988-leftover@test.local=off/active/true,issue3988-off@test.local=off/active/true,issue3988-outsider@test.local=off/none/false,issue3988-owner@test.local=included_rota/active/true,issue3988-partner@test.local=teammate/active/true,issue3988-revoked@test.local=off/none/false,issue3988-teammate@test.local=teammate/active/true' THEN
    RAISE EXCEPTION 'people_list_wrong:%', v_result;
  END IF;
  IF pg_temp.t3988_as('teammate', '(SELECT count(*) FROM public.issue_3988_admin_people())') NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'people_list_not_admin_only';
  END IF;

  -- Turn the "off" teammate on: both Community and Support appear at once.
  v_result := pg_temp.t3988_as('admin',
    '(SELECT role FROM public.issue_3988_set_permissions(''39880000-0000-4000-a100-000000000005'', ''teammate'', NULL))');
  IF v_result <> 'teammate' OR pg_temp.t3988_areas('off') <> '{community_support,community_support_support,team_notifications,community_support_community}' THEN
    RAISE EXCEPTION 'set_teammate_did_not_take_effect:%:%', v_result, pg_temp.t3988_areas('off');
  END IF;
  IF pg_temp.t3988_as('off', '(SELECT count(*) FROM public.issue_3720_admin_list_posts(''idea'', ''all''))') LIKE 'ERR:%' THEN
    RAISE EXCEPTION 'new_teammate_ideas_refused';
  END IF;

  -- Turn the teammate off: every tab, alert and ticket goes away.
  v_result := pg_temp.t3988_as('owner',
    '(SELECT role FROM public.issue_3988_set_permissions(''39880000-0000-4000-a100-000000000003'', ''off'', NULL))');
  IF v_result <> 'off' OR pg_temp.t3988_areas('teammate') <> '{team_notifications}'
     OR pg_temp.t3988_as('teammate', '(SELECT count(*) FROM public.issue_3720_admin_moderation_workspace(''first_posts''))') NOT LIKE 'ERR:42501:%'
     OR pg_temp.t3988_as('teammate', '(SELECT count(*) FROM public.support_tickets)') <> '0'
     OR EXISTS (SELECT 1 FROM public.issue_3988_support_alert_recipients() r(id) WHERE r.id = '39880000-0000-4000-a100-000000000003') THEN
    RAISE EXCEPTION 'set_off_did_not_remove_access';
  END IF;

  -- Promote to lead.
  v_result := pg_temp.t3988_as('owner',
    '(SELECT role FROM public.issue_3988_set_permissions(''39880000-0000-4000-a100-000000000003'', ''lead'', ''Lead Name''))');
  IF v_result <> 'lead'
     OR (SELECT role || '/' || display_name FROM public.support_staff WHERE user_id = '39880000-0000-4000-a100-000000000003') <> 'lead/Lead Name' THEN
    RAISE EXCEPTION 'set_lead_failed';
  END IF;

  -- Refusals.
  IF pg_temp.t3988_as('owner', '(SELECT count(*) FROM public.issue_3988_set_permissions(''39880000-0000-4000-a100-000000000008'', ''teammate'', NULL))') NOT LIKE 'ERR:22023:not_on_team%'
     OR pg_temp.t3988_as('owner', '(SELECT count(*) FROM public.issue_3988_set_permissions(''39880000-0000-4000-a100-000000000007'', ''teammate'', NULL))') NOT LIKE 'ERR:22023:not_on_team%'
     OR pg_temp.t3988_as('owner', '(SELECT count(*) FROM public.issue_3988_set_permissions(''39880000-0000-4000-a100-000000000004'', ''agent'', NULL))') NOT LIKE 'ERR:22023:role_retired%'
     OR pg_temp.t3988_as('lead', '(SELECT count(*) FROM public.issue_3988_set_permissions(''39880000-0000-4000-a100-000000000005'', ''off'', NULL))') NOT LIKE 'ERR:42501:not_authorized%'
     OR pg_temp.t3988_as('owner', 'public.community_set_staff(''39880000-0000-4000-a100-000000000005'', ''moderator'', true, NULL)') NOT LIKE 'ERR:22023:role_retired%' THEN
    RAISE EXCEPTION 'set_permissions_refusals_wrong';
  END IF;

  -- Removing someone from the team ends their access with no extra step.
  UPDATE public.admin_team_members SET status = 'revoked' WHERE email = 'issue3988-lead@test.local';
  IF pg_temp.t3988_areas('lead') <> '{}' OR public.is_support_staff('39880000-0000-4000-a100-000000000004') THEN
    RAISE EXCEPTION 'team_removal_not_immediate';
  END IF;

  -- Old access left on a non-team person can be switched off by an Admin.
  v_result := pg_temp.t3988_as('admin', 'public.issue_3988_remove_orphan_staff(''39880000-0000-4000-a100-000000000008'')');
  IF v_result <> '1'
     OR EXISTS (SELECT 1 FROM public.support_staff WHERE user_id = '39880000-0000-4000-a100-000000000008' AND (enabled OR available))
     OR pg_temp.t3988_as('admin', 'public.issue_3988_remove_orphan_staff(''39880000-0000-4000-a100-000000000006'')') NOT LIKE 'ERR:22023:still_on_team%' THEN
    RAISE EXCEPTION 'remove_orphan_staff_wrong:%', v_result;
  END IF;
END;
$people$;

-- 8. Backfill by predicate: every current scoped teammate is on Support,
--    leftover Community rows map to Support and switch off, and enabled rows
--    on non-team people switch off. Owners/Admins get no new row.
DO $backfill$
BEGIN
  INSERT INTO public.community_staff (user_id, role, enabled) VALUES
    ('39880000-0000-4000-a100-000000000006', 'agent', true)
  ON CONFLICT (user_id) DO UPDATE SET role = 'agent', enabled = true;
  UPDATE public.support_staff SET enabled = true, available = true WHERE user_id = '39880000-0000-4000-a100-000000000008';
  DELETE FROM public.support_staff WHERE user_id IN ('39880000-0000-4000-a100-000000000001','39880000-0000-4000-a100-000000000009');
  UPDATE public.support_staff SET enabled = false WHERE user_id = '39880000-0000-4000-a100-000000000005';

  PERFORM public.issue_3988_backfill_permissions();

  IF EXISTS (SELECT 1 FROM public.community_staff WHERE enabled) THEN
    RAISE EXCEPTION 'backfill_left_community_rows_enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.support_staff s WHERE s.enabled AND NOT public.issue_3720_active_team_member(s.user_id)) THEN
    RAISE EXCEPTION 'backfill_left_non_team_rows_enabled';
  END IF;
  IF (SELECT string_agg(p.who || '=' || COALESCE(s.enabled::text, 'none') || '/' || COALESCE(s.role, '-'), ',' ORDER BY p.who)
        FROM t3988_people p LEFT JOIN public.support_staff s ON s.user_id = p.id
       WHERE p.who IN ('owner','off','partner','leftover','outsider','revoked','lead'))
     <> 'lead=false/lead,leftover=true/staff,off=true/staff,outsider=false/staff,owner=none/-,partner=true/staff,revoked=false/staff' THEN
    RAISE EXCEPTION 'backfill_outcome_wrong:%', (SELECT string_agg(p.who || '=' || COALESCE(s.enabled::text, 'none') || '/' || COALESCE(s.role, '-'), ',' ORDER BY p.who)
        FROM t3988_people p LEFT JOIN public.support_staff s ON s.user_id = p.id
       WHERE p.who IN ('owner','off','partner','leftover','outsider','revoked','lead'));
  END IF;
  IF pg_temp.t3988_areas('leftover') <> '{community_support,community_support_support,team_notifications,community_support_community}' THEN
    RAISE EXCEPTION 'backfilled_community_row_not_support_teammate';
  END IF;
END;
$backfill$;

-- 9. Functions owned elsewhere keep their contracts; new RPCs are not public.
DO $contracts$
BEGIN
  IF pg_temp.t3988_as('off', 'public.admin_team_my_access()->>''areas''') <> '["role_home", "crm", "beta_leads"]' THEN
    RAISE EXCEPTION 'base_role_area_contract_changed:%', pg_temp.t3988_as('off', 'public.admin_team_my_access()->>''areas''');
  END IF;
  IF has_function_privilege('anon', 'public.issue_3988_capabilities()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3988_admin_people()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3988_set_permissions(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3988_remove_orphan_staff(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3988_backfill_permissions()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_team_my_operational_areas()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_team_my_operational_areas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3988_acl_wrong';
  END IF;
END;
$contracts$;

ROLLBACK;
