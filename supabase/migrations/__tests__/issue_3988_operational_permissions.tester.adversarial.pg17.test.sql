-- #3988 Community & Support permissions: independent tester adversarial proof.
-- Different angle from the implementor suite: hostile direct table writes by an
-- enabled lead, leftover rows on people who are not (or no longer) on the team,
-- hostile role words, retired paths, repeated presence calls and the anon ACL
-- of every new or redefined function. Runs after the full replay; rolls back.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t3988x_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3988x_people VALUES
  ('owner',         '3988a000-0000-4000-a000-000000000001', 'issue3988x-owner@test.local'),
  ('admin_norow',   '3988a000-0000-4000-a000-000000000002', 'issue3988x-admin@test.local'),
  ('lead_member',   '3988a000-0000-4000-a000-000000000003', 'issue3988x-lead@test.local'),
  ('growth_none',   '3988a000-0000-4000-a000-000000000004', 'issue3988x-growth@test.local'),
  ('partner_staff', '3988a000-0000-4000-a000-000000000005', 'issue3988x-partner@test.local'),
  ('revoked_rows',  '3988a000-0000-4000-a000-000000000006', 'issue3988x-revoked@test.local'),
  ('outsider_row',  '3988a000-0000-4000-a000-000000000007', 'issue3988x-outsider@test.local'),
  ('community_only','3988a000-0000-4000-a000-000000000008', 'issue3988x-community@test.local'),
  ('invited',       '3988a000-0000-4000-a000-000000000009', 'issue3988x-invited@test.local'),
  ('requester',     '3988a000-0000-4000-a000-000000000010', 'issue3988x-requester@test.local');

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT id, email, now() FROM t3988x_people;

INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('issue3988x-owner@test.local', 'owner', 'active', now()),
  ('issue3988x-admin@test.local', 'admin', 'active', now());

INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue3988x-lead@test.local',      'growth',  'active',  now()),
  ('issue3988x-growth@test.local',    'growth',  'active',  now()),
  ('issue3988x-partner@test.local',   'partner', 'active',  now()),
  ('issue3988x-revoked@test.local',   'growth',  'revoked', now()),
  ('issue3988x-community@test.local', 'growth',  'active',  now()),
  ('issue3988x-invited@test.local',   'growth',  'invited', NULL);

INSERT INTO public.support_staff (user_id, enabled, available, role, display_name) VALUES
  ('3988a000-0000-4000-a000-000000000003', true, false, 'lead',  'Lead fixture'),
  ('3988a000-0000-4000-a000-000000000005', true, false, 'staff', NULL),
  ('3988a000-0000-4000-a000-000000000006', true, true,  'lead',  NULL),
  ('3988a000-0000-4000-a000-000000000007', true, true,  'staff', NULL);

INSERT INTO public.community_staff (user_id, role, enabled) VALUES
  ('3988a000-0000-4000-a000-000000000006', 'moderator', true),
  ('3988a000-0000-4000-a000-000000000008', 'moderator', true);

INSERT INTO public.creator_accounts (id, email, display_name, business_name)
VALUES ('3988a000-0000-4000-a000-000000000010', 'issue3988x-requester@test.local', 'Requester', 'Issue 3988x Host');
INSERT INTO public.brands (id, account_id, name, slug)
VALUES ('3988a000-0000-4000-b000-000000000001', '3988a000-0000-4000-a000-000000000010', 'Issue 3988x Brand', 'issue-3988x-brand');

-- This proof owns presence: nobody outside the fixture is available.
UPDATE public.support_staff SET available = false
 WHERE user_id NOT IN (SELECT id FROM t3988x_people);

-- Evaluate one expression as a persona (or as anon with p_who = 'anon').
CREATE FUNCTION pg_temp.x_as(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_answer text;
BEGIN
  IF p_who = 'anon' THEN
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', 'anon', true);
  ELSE
    SELECT id, email INTO STRICT v_id, v_email FROM t3988x_people WHERE who = p_who;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
    PERFORM set_config('request.jwt.claim.email', v_email, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  END IF;
  EXECUTE 'SELECT (' || p_sql || ')::text' INTO v_answer;
  RESET ROLE;
  RETURN COALESCE(v_answer, 'NULL');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

-- Run one statement as a persona; returns the affected row count or ERR:<code>:<message>.
CREATE FUNCTION pg_temp.x_exec(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_rows integer;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t3988x_people WHERE who = p_who;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.email', v_email, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  RETURN v_rows::text;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

CREATE FUNCTION pg_temp.x_id(p_who text) RETURNS uuid
LANGUAGE sql AS $$ SELECT id FROM t3988x_people WHERE who = p_who; $$;

CREATE FUNCTION pg_temp.x_row(p_who text) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE((
    SELECT s.enabled::text || '/' || s.available::text || '/' || s.role
    FROM public.support_staff s WHERE s.user_id = pg_temp.x_id(p_who)
  ), 'none');
$$;

-- The requester opens a ticket. Captured before any later state change.
DO $ticket$
DECLARE v_ticket text;
BEGIN
  v_ticket := pg_temp.x_as('requester', 'public.create_support_ticket(''Adversarial ticket'', NULL)');
  IF v_ticket LIKE 'ERR:%' THEN RAISE EXCEPTION 'x_ticket_create_failed:%', v_ticket; END IF;
  PERFORM set_config('t3988x.ticket', v_ticket, true);
  PERFORM set_config('t3988x.conv',
    (SELECT conversation_id::text FROM public.support_tickets WHERE id = v_ticket::uuid), true);
END;
$ticket$;

-- A1. An enabled Support lead cannot write support_staff directly, in any shape,
--     on its own row or anyone else's. Every attempt is a privilege error and
--     the rows are byte-for-byte unchanged afterwards.
DO $a1$
DECLARE
  v_stmt text;
  v_result text;
  v_before_lead text := pg_temp.x_row('lead_member');
  v_before_outsider text := pg_temp.x_row('outsider_row');
BEGIN
  FOREACH v_stmt IN ARRAY ARRAY[
    'UPDATE public.support_staff SET available = true WHERE user_id = auth.uid()',
    'UPDATE public.support_staff SET role = ''staff'' WHERE user_id = auth.uid()',
    'UPDATE public.support_staff SET enabled = true, role = ''lead'' WHERE user_id = auth.uid()',
    'UPDATE public.support_staff SET enabled = false WHERE user_id = ''3988a000-0000-4000-a000-000000000007''',
    'INSERT INTO public.support_staff (user_id, enabled, role) VALUES (''3988a000-0000-4000-a000-000000000004'', true, ''lead'')',
    'INSERT INTO public.support_staff (user_id, enabled, role) VALUES (auth.uid(), true, ''lead'') ON CONFLICT (user_id) DO UPDATE SET available = true',
    'DELETE FROM public.support_staff WHERE user_id = auth.uid()',
    'DELETE FROM public.support_staff WHERE user_id = ''3988a000-0000-4000-a000-000000000007''',
    'TRUNCATE public.support_staff'
  ] LOOP
    v_result := pg_temp.x_exec('lead_member', v_stmt);
    IF v_result NOT LIKE 'ERR:42501:%' THEN
      RAISE EXCEPTION 'x_direct_staff_write_not_refused:%:%', v_stmt, v_result;
    END IF;
  END LOOP;

  -- A teammate with no row cannot create one for itself either.
  v_result := pg_temp.x_exec('growth_none',
    'INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES (auth.uid(), true, true, ''staff'')');
  IF v_result NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'x_self_enrol_not_refused:%', v_result;
  END IF;

  IF pg_temp.x_row('lead_member') <> v_before_lead OR pg_temp.x_row('outsider_row') <> v_before_outsider
     OR pg_temp.x_row('growth_none') <> 'none' THEN
    RAISE EXCEPTION 'x_staff_rows_changed:%:%:%', pg_temp.x_row('lead_member'), pg_temp.x_row('outsider_row'), pg_temp.x_row('growth_none');
  END IF;

  -- The lead still reads only its own row; the sanctioned path still works.
  IF pg_temp.x_as('lead_member', '(SELECT count(*) FROM public.support_staff)') <> '1' THEN
    RAISE EXCEPTION 'x_lead_reads_other_staff_rows:%', pg_temp.x_as('lead_member', '(SELECT count(*) FROM public.support_staff)');
  END IF;
  IF pg_temp.x_as('lead_member', 'public.support_set_available(true)') <> 'true'
     OR pg_temp.x_row('lead_member') <> 'true/true/lead'
     OR pg_temp.x_as('lead_member', 'public.support_set_available(false)') <> 'false' THEN
    RAISE EXCEPTION 'x_sanctioned_presence_path_broken:%', pg_temp.x_row('lead_member');
  END IF;
END;
$a1$;

-- A2. A removed teammate whose old rows are still enabled (Support lead row,
--     available, plus a Community moderator row) is refused everywhere.
DO $a2$
DECLARE
  v_result text;
  v_id uuid := pg_temp.x_id('revoked_rows');
BEGIN
  IF public.is_support_staff(v_id) THEN RAISE EXCEPTION 'x_revoked_is_support_staff'; END IF;
  IF public.community_role(v_id) IS NOT NULL THEN
    RAISE EXCEPTION 'x_revoked_has_community_role:%', public.community_role(v_id);
  END IF;
  IF public.community_can('moderate', v_id) THEN RAISE EXCEPTION 'x_revoked_can_moderate'; END IF;
  IF pg_temp.x_as('revoked_rows', 'public.community_can(''moderate'')') <> 'false' THEN
    RAISE EXCEPTION 'x_revoked_self_moderate:%', pg_temp.x_as('revoked_rows', 'public.community_can(''moderate'')');
  END IF;

  v_result := pg_temp.x_as('revoked_rows', '(SELECT count(*) FROM public.issue_3720_admin_list_posts(''question'', ''all''))');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'x_revoked_list_posts:%', v_result; END IF;
  v_result := pg_temp.x_as('revoked_rows', '(SELECT count(*) FROM public.issue_3720_admin_moderation_workspace(''first_posts''))');
  IF v_result NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'x_revoked_moderation_workspace:%', v_result; END IF;
  v_result := pg_temp.x_as('revoked_rows', '(SELECT count(*) FROM public.issue_3720_list_feature_guide(NULL::text))');
  IF v_result NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'x_revoked_feature_guide:%', v_result; END IF;

  v_result := pg_temp.x_as('revoked_rows',
    '(SELECT count(*) FROM public.support_tickets WHERE id = ' || quote_literal(current_setting('t3988x.ticket')) || '::uuid)');
  IF v_result <> '0' THEN RAISE EXCEPTION 'x_revoked_reads_ticket:%', v_result; END IF;
  v_result := pg_temp.x_as('revoked_rows',
    '(SELECT count(*) FROM public.issue_3720_list_brand_groups() WHERE brand_id = ''3988a000-0000-4000-b000-000000000001'')');
  IF v_result <> '0' THEN RAISE EXCEPTION 'x_revoked_lists_brand_group:%', v_result; END IF;

  v_result := pg_temp.x_exec('revoked_rows',
    'INSERT INTO public.messages (conversation_id, sender_id, content) VALUES ('
    || quote_literal(current_setting('t3988x.conv')) || '::uuid, auth.uid(), ''reply'')');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'x_revoked_replies_to_ticket:%', v_result; END IF;

  v_result := pg_temp.x_as('revoked_rows', 'public.support_set_available(true)');
  IF v_result NOT LIKE 'ERR:42501:not_support_staff%' THEN RAISE EXCEPTION 'x_revoked_presence:%', v_result; END IF;
  IF pg_temp.x_as('revoked_rows', 'public.issue_3988_capabilities()') <> '{}'
     OR pg_temp.x_as('revoked_rows', 'public.admin_team_my_operational_areas()') <> '{}' THEN
    RAISE EXCEPTION 'x_revoked_caps:%', pg_temp.x_as('revoked_rows', 'public.issue_3988_capabilities()');
  END IF;
END;
$a2$;

-- A3. A person who was never on the team but holds an enabled + available row
--     is not support staff, does not make Support "online" when it is the only
--     available row, and gets neither reply alerts nor new-ticket alerts.
DO $a3$
DECLARE
  v_id uuid := pg_temp.x_id('outsider_row');
  v_result text;
BEGIN
  IF public.is_support_staff(v_id) THEN RAISE EXCEPTION 'x_outsider_is_support_staff'; END IF;
  IF pg_temp.x_as('outsider_row', 'public.is_support_staff()') <> 'false' THEN
    RAISE EXCEPTION 'x_outsider_self_check:%', pg_temp.x_as('outsider_row', 'public.is_support_staff()');
  END IF;

  -- Only the outsider (and the removed teammate) are available now.
  IF (SELECT count(*) FROM public.support_staff WHERE available) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.support_staff WHERE user_id = v_id AND enabled AND available) THEN
    RAISE EXCEPTION 'x_presence_fixture_wrong';
  END IF;
  IF public.support_is_online() THEN RAISE EXCEPTION 'x_outsider_makes_support_online'; END IF;
  IF pg_temp.x_as('requester', 'public.support_is_online()') <> 'false' THEN
    RAISE EXCEPTION 'x_host_sees_support_online';
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_3988_support_alert_recipients() r(id)
              WHERE r.id IN (pg_temp.x_id('outsider_row'), pg_temp.x_id('revoked_rows'))) THEN
    RAISE EXCEPTION 'x_non_team_reply_alert_recipient';
  END IF;

  -- The new-ticket fan-out reached exactly the effective staff of this fixture.
  SELECT string_agg(p.who, ',' ORDER BY p.who) INTO v_result
  FROM public.notification_outbox o
  JOIN t3988x_people p ON p.id = o.user_id
  WHERE o.category_key = 'business.support_new_ticket'
    AND o.payload->>'ticket_id' = current_setting('t3988x.ticket');
  IF v_result IS DISTINCT FROM 'lead_member,partner_staff' THEN
    RAISE EXCEPTION 'x_new_ticket_outbox_recipients:%', v_result;
  END IF;

  v_result := pg_temp.x_as('outsider_row',
    '(SELECT count(*) FROM public.support_tickets WHERE id = ' || quote_literal(current_setting('t3988x.ticket')) || '::uuid)');
  IF v_result <> '0' THEN RAISE EXCEPTION 'x_outsider_reads_ticket:%', v_result; END IF;

  -- A real teammate going available is what flips the online state.
  -- (Two statements: a STABLE read inside the same expression would use the
  -- snapshot taken before the write.)
  v_result := pg_temp.x_as('partner_staff', 'public.support_set_available(true)');
  IF v_result <> 'true' THEN RAISE EXCEPTION 'x_teammate_presence_failed:%', v_result; END IF;
  IF NOT public.support_is_online() THEN
    RAISE EXCEPTION 'x_teammate_presence_does_not_flip_online';
  END IF;
  PERFORM pg_temp.x_as('partner_staff', 'public.support_set_available(false)');
END;
$a3$;

-- A4. People and roles refuses non-admin callers, people who are not active
--     teammates, and every role word other than off / teammate / lead.
DO $a4$
DECLARE
  v_case text[];
  v_result text;
  v_audit_before bigint := (SELECT count(*) FROM public.support_audit_log);
BEGIN
  FOREACH v_case SLICE 1 IN ARRAY ARRAY[
    ARRAY['growth_none',   '3988a000-0000-4000-a000-000000000004', 'lead',        'ERR:42501:not_authorized%'],
    ARRAY['partner_staff', '3988a000-0000-4000-a000-000000000005', 'lead',        'ERR:42501:not_authorized%'],
    ARRAY['lead_member',   '3988a000-0000-4000-a000-000000000004', 'teammate',    'ERR:42501:not_authorized%'],
    ARRAY['owner',         '3988a000-0000-4000-a000-000000000007', 'teammate',    'ERR:22023:not_on_team%'],
    ARRAY['owner',         '3988a000-0000-4000-a000-000000000006', 'lead',        'ERR:22023:not_on_team%'],
    ARRAY['owner',         '3988a000-0000-4000-a000-000000000009', 'teammate',    'ERR:22023:not_on_team%'],
    ARRAY['owner',         '3988a000-0000-4000-a000-0000000000ff', 'teammate',    'ERR:22023:not_on_team%'],
    ARRAY['owner',         '3988a000-0000-4000-a000-000000000004', 'agent',       'ERR:22023:role_retired%'],
    ARRAY['owner',         '3988a000-0000-4000-a000-000000000004', 'moderator',   'ERR:22023:role_retired%'],
    ARRAY['owner',         '3988a000-0000-4000-a000-000000000004', ' Moderator ', 'ERR:22023:role_retired%'],
    ARRAY['admin_norow',   '3988a000-0000-4000-a000-000000000004', 'admin',       'ERR:22023:invalid_role%'],
    ARRAY['admin_norow',   '3988a000-0000-4000-a000-000000000004', 'owner',       'ERR:22023:invalid_role%'],
    ARRAY['admin_norow',   '3988a000-0000-4000-a000-000000000004', 'staff',       'ERR:22023:invalid_role%'],
    ARRAY['admin_norow',   '3988a000-0000-4000-a000-000000000004', '',            'ERR:22023:invalid_role%'],
    ARRAY['admin_norow',   '3988a000-0000-4000-a000-000000000004', 'lead; --',    'ERR:22023:invalid_role%'],
    ARRAY['admin_norow',   '3988a000-0000-4000-a000-000000000004', 'off,lead',    'ERR:22023:invalid_role%']
  ] LOOP
    v_result := pg_temp.x_as(v_case[1],
      '(SELECT count(*) FROM public.issue_3988_set_permissions(' || quote_literal(v_case[2]) || '::uuid, '
      || quote_literal(v_case[3]) || ', NULL))');
    IF v_result NOT LIKE v_case[4] THEN
      RAISE EXCEPTION 'x_set_permissions_case:%:%:%=>%', v_case[1], v_case[2], v_case[3], v_result;
    END IF;
  END LOOP;

  v_result := pg_temp.x_as('owner',
    '(SELECT count(*) FROM public.issue_3988_set_permissions(''3988a000-0000-4000-a000-000000000004''::uuid, NULL, NULL))');
  IF v_result NOT LIKE 'ERR:22023:invalid_role%' THEN RAISE EXCEPTION 'x_set_permissions_null_role:%', v_result; END IF;
  v_result := pg_temp.x_as('owner', '(SELECT count(*) FROM public.issue_3988_set_permissions(NULL::uuid, ''lead'', NULL))');
  IF v_result NOT LIKE 'ERR:22023:user_id_required%' THEN RAISE EXCEPTION 'x_set_permissions_null_user:%', v_result; END IF;

  -- No refusal left a row or an audit entry behind.
  IF pg_temp.x_row('growth_none') <> 'none' OR pg_temp.x_row('invited') <> 'none'
     OR pg_temp.x_row('outsider_row') <> 'true/true/staff' OR pg_temp.x_row('revoked_rows') <> 'true/true/lead'
     OR pg_temp.x_row('partner_staff') <> 'true/false/staff'
     OR (SELECT count(*) FROM public.support_audit_log) <> v_audit_before THEN
    RAISE EXCEPTION 'x_refusal_left_side_effects';
  END IF;

  -- The only people list reader is an Owner/Admin.
  v_result := pg_temp.x_as('partner_staff', '(SELECT count(*) FROM public.issue_3988_admin_people())');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'x_people_list_leaks:%', v_result; END IF;
  v_result := pg_temp.x_as('lead_member', '(SELECT count(*) FROM public.issue_3988_remove_orphan_staff(''3988a000-0000-4000-a000-000000000007''))');
  IF v_result NOT LIKE 'ERR:42501:%' OR pg_temp.x_row('outsider_row') <> 'true/true/staff' THEN
    RAISE EXCEPTION 'x_non_admin_removes_orphan:%', v_result;
  END IF;
END;
$a4$;

-- A5. An Owner/Admin with no row calling the presence switch repeatedly ends
--     with exactly one row, enabled, holding the last value.
DO $a5$
DECLARE v_result text;
BEGIN
  IF pg_temp.x_row('admin_norow') <> 'none' THEN RAISE EXCEPTION 'x_admin_fixture_has_row'; END IF;
  IF pg_temp.x_as('admin_norow', 'public.support_set_available(true)') <> 'true'
     OR pg_temp.x_as('admin_norow', 'public.support_set_available(true)') <> 'true'
     OR pg_temp.x_as('admin_norow', 'public.support_set_available(false)') <> 'false' THEN
    RAISE EXCEPTION 'x_admin_presence_calls_failed:%', pg_temp.x_as('admin_norow', 'public.support_set_available(true)');
  END IF;
  IF (SELECT count(*) FROM public.support_staff WHERE user_id = pg_temp.x_id('admin_norow')) <> 1
     OR pg_temp.x_row('admin_norow') <> 'true/false/staff' THEN
    RAISE EXCEPTION 'x_admin_rota_row_wrong:%', pg_temp.x_row('admin_norow');
  END IF;
  -- A teammate with no row is still refused (only admins self-provision).
  v_result := pg_temp.x_as('growth_none', 'public.support_set_available(true)');
  IF v_result NOT LIKE 'ERR:42501:not_support_staff%' OR pg_temp.x_row('growth_none') <> 'none' THEN
    RAISE EXCEPTION 'x_teammate_self_provisions:%', v_result;
  END IF;
END;
$a5$;

-- A6. The retired Community role path refuses loudly and writes nothing; a
--     leftover enabled Community row with no Support row grants nothing.
DO $a6$
DECLARE
  v_result text;
  v_id uuid := pg_temp.x_id('community_only');
BEGIN
  v_result := pg_temp.x_as('owner', 'public.community_set_staff(''3988a000-0000-4000-a000-000000000004'', ''moderator'', true, NULL)');
  IF v_result NOT LIKE 'ERR:22023:role_retired%' THEN RAISE EXCEPTION 'x_set_staff_moderator:%', v_result; END IF;
  v_result := pg_temp.x_as('owner', 'public.community_set_staff(''3988a000-0000-4000-a000-000000000004'', ''agent'', true, NULL)');
  IF v_result NOT LIKE 'ERR:22023:role_retired%' THEN RAISE EXCEPTION 'x_set_staff_agent:%', v_result; END IF;
  v_result := pg_temp.x_as('lead_member', 'public.community_set_staff(auth.uid(), ''moderator'', true, NULL)');
  IF v_result NOT LIKE 'ERR:42501:not_authorized%' THEN RAISE EXCEPTION 'x_set_staff_non_admin:%', v_result; END IF;
  IF EXISTS (SELECT 1 FROM public.community_staff WHERE user_id IN (pg_temp.x_id('growth_none'), pg_temp.x_id('lead_member'))) THEN
    RAISE EXCEPTION 'x_set_staff_wrote_row';
  END IF;

  IF public.community_role(v_id) IS NOT NULL OR public.community_can('moderate', v_id) OR public.is_support_staff(v_id) THEN
    RAISE EXCEPTION 'x_community_row_grants:%', public.community_role(v_id);
  END IF;
  v_result := pg_temp.x_as('community_only', '(SELECT count(*) FROM public.issue_3720_admin_list_posts(''idea'', ''all''))');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'x_community_row_lists_posts:%', v_result; END IF;
  v_result := pg_temp.x_as('community_only', '(SELECT count(*) FROM public.issue_3720_admin_moderation_workspace(''first_posts''))');
  IF v_result NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'x_community_row_moderates:%', v_result; END IF;
  IF pg_temp.x_as('community_only', 'public.issue_3988_capabilities()') <> '{}'
     OR pg_temp.x_as('community_only', 'public.admin_team_my_operational_areas()') <> '{team_notifications}' THEN
    RAISE EXCEPTION 'x_community_row_caps:%/%', pg_temp.x_as('community_only', 'public.issue_3988_capabilities()'),
      pg_temp.x_as('community_only', 'public.admin_team_my_operational_areas()');
  END IF;
  IF pg_temp.x_as('owner', '(SELECT role FROM public.issue_3988_admin_people() WHERE user_id = ''3988a000-0000-4000-a000-000000000008'')') <> 'off' THEN
    RAISE EXCEPTION 'x_community_row_listed_as_role';
  END IF;
END;
$a6$;

-- A7. anon executes none of the new or redefined functions, and the people
--     functions are never callable without a session.
DO $a7$
DECLARE
  v_fn regprocedure;
  v_count integer := 0;
  v_result text;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.proname LIKE 'issue\_3988\_%' OR p.proname IN (
        'is_support_staff', 'community_role', 'community_can', 'community_set_staff',
        'support_set_available', 'support_is_online', 'create_support_ticket',
        'admin_team_my_operational_areas'))
  LOOP
    v_count := v_count + 1;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'x_anon_executes:%', v_fn;
    END IF;
  END LOOP;
  IF v_count < 14 THEN RAISE EXCEPTION 'x_acl_scan_too_small:%', v_count; END IF;

  IF has_function_privilege('authenticated', 'public.issue_3988_support_alert_recipients()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3988_backfill_permissions()', 'EXECUTE') THEN
    RAISE EXCEPTION 'x_service_only_function_exposed';
  END IF;

  v_result := pg_temp.x_as('anon', '(SELECT count(*) FROM public.issue_3988_set_permissions(''3988a000-0000-4000-a000-000000000004''::uuid, ''lead'', NULL))');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'x_anon_set_permissions:%', v_result; END IF;
  v_result := pg_temp.x_as('anon', '(SELECT count(*) FROM public.support_staff)');
  IF v_result NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'x_anon_reads_staff:%', v_result; END IF;
  IF pg_temp.x_row('growth_none') <> 'none' THEN RAISE EXCEPTION 'x_anon_wrote_row'; END IF;
END;
$a7$;

ROLLBACK;
