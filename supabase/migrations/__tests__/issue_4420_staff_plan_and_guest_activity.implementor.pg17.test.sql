\set ON_ERROR_STOP on

-- #4420 (20281120004420, 20281120014420). Runs on the fully replayed PG17
-- schema; everything rolls back.
--
-- INVARIANT issue-4420-plan-staff-read-only: support staff and admins may read
-- a brand plan in the Host app and never write it (write = team rank only).
-- INVARIANT issue-4420-guest-activity-team-only: issue_4420_brand_guest_activity
-- returns rows only for brands where auth.uid() is an accepted, not removed
-- brand team member; it writes nothing.
--
-- Cases
--   P-*  plan: staff read, staff cannot add, outsider still not_found, team
--        unchanged
--   G-*  guest activity: team sees unread guest messages after their read
--        marker, brand posts and own posts are not unread, a non-team user
--        and a guest see no rows, a removed teammate sees no rows
--
-- Fails on revert: dropping the staff path from brand_plan_can_read fails
-- P-STAFF-READ; letting the staff path into brand_plan_can_write fails
-- P-STAFF-NO-ADD; dropping the team filter from the activity function fails
-- G-OUTSIDER / G-GUEST / G-REMOVED; counting brand posts fails G-UNREAD.

BEGIN;

CREATE TEMP TABLE k(tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON k TO authenticated;
CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM k WHERE tag = p_tag $f$;
CREATE FUNCTION pg_temp.ok(p_label text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_label; END IF;
  RAISE NOTICE 'PASS %', p_label;
END $f$;
CREATE FUNCTION pg_temp.as_user(p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid := pg_temp.u(p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $f$;
CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
END $f$;
-- A jsonb RPC result as p_tag (or the SQLSTATE and message as a json string).
CREATE FUNCTION pg_temp.rpc_as(p_tag text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v_state text; v_msg text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(p_tag);
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql INTO r;
    PERFORM set_config('role', 'postgres', true);
    PERFORM pg_temp.as_server();
    RETURN r;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM set_config('role', 'postgres', true);
    RETURN to_jsonb(v_state || ' ' || v_msg);
  END;
END $f$;
CREATE FUNCTION pg_temp.person(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, 'i4420-' || p_tag || '-' || v || '@example.test');
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;

DO $setup$
DECLARE v_owner uuid; v_brand uuid := gen_random_uuid(); v_conv uuid; v_staff uuid; v_guest uuid;
BEGIN
  v_owner := pg_temp.person('owner');
  PERFORM pg_temp.person('mgr');
  PERFORM pg_temp.person('removed');
  PERFORM pg_temp.person('outsider');
  v_staff := pg_temp.person('staff');
  v_guest := pg_temp.person('guest');
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider)
    VALUES (v_brand, v_owner, 'Brand 4420', 'i4420-' || v_brand, 'stripe');
  INSERT INTO k VALUES ('brand', v_brand);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at) VALUES
    (v_brand, pg_temp.u('mgr'), 'marketing_manager', now(), now()),
    (v_brand, pg_temp.u('removed'), 'marketing_manager', now(), now())
  ON CONFLICT DO NOTHING;
  -- Mingla support staff: enabled support row + an active Mingla team member.
  INSERT INTO public.support_staff(user_id, enabled, available, display_name, role)
    VALUES (v_staff, true, true, 'Support 4420', 'lead');
  INSERT INTO public.admin_team_members(email, role, status, accepted_at)
    SELECT email, 'growth', 'active', now() FROM auth.users WHERE id = v_staff;

  v_conv := public.issue_4459_ensure_brand_guest_chat(v_brand);
  INSERT INTO k VALUES ('chat', v_conv);
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    VALUES (v_conv, v_guest, now() - interval '2 days')
  ON CONFLICT DO NOTHING;
  -- The manager read up to an hour ago.
  UPDATE public.conversation_participants SET last_read_at = now() - interval '1 hour'
   WHERE conversation_id = v_conv AND user_id = pg_temp.u('mgr');
  UPDATE public.brand_team_members SET removed_at = now()
   WHERE brand_id = v_brand AND user_id = pg_temp.u('removed');
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, sender_kind, created_at) VALUES
    (v_conv, v_guest, 'old guest question', 'text', 'guest', now() - interval '3 hours'),
    (v_conv, v_guest, 'Is there a dress code?', 'text', 'guest', now() - interval '30 minutes'),
    (v_conv, v_guest, 'What time does the music start?', 'text', 'guest', now() - interval '20 minutes'),
    (v_conv, NULL, 'Doors at 6pm', 'text', 'brand', now() - interval '10 minutes');
END
$setup$;

DO $cases$
DECLARE v jsonb; v_rows jsonb;
BEGIN
  -- P-*: the plan.
  PERFORM pg_temp.ok('P-STAFF-READ support staff can read the brand plan',
    public.brand_plan_can_read(pg_temp.u('brand'), pg_temp.u('staff')));
  PERFORM pg_temp.ok('P-STAFF-NO-ADD support staff can never write the plan',
    NOT public.brand_plan_can_write(pg_temp.u('brand'), pg_temp.u('staff')));
  PERFORM pg_temp.ok('P-OUTSIDER an outsider still cannot read the plan',
    NOT public.brand_plan_can_read(pg_temp.u('brand'), pg_temp.u('outsider')));
  PERFORM pg_temp.ok('P-TEAM a marketing manager still reads and writes',
    public.brand_plan_can_read(pg_temp.u('brand'), pg_temp.u('mgr'))
    AND public.brand_plan_can_write(pg_temp.u('brand'), pg_temp.u('mgr')));
  PERFORM pg_temp.ok('P-REMOVED a removed teammate cannot read',
    NOT public.brand_plan_can_read(pg_temp.u('brand'), pg_temp.u('removed')));
  v := pg_temp.rpc_as('staff', format('SELECT public.brand_plan_for_host(%L, current_date - 7, current_date + 30)', pg_temp.u('brand')));
  PERFORM pg_temp.ok('P-STAFF-FOR-HOST staff read the host plan with can_add false',
    jsonb_typeof(v) = 'object' AND (v->>'can_add')::boolean IS FALSE);
  v := pg_temp.rpc_as('staff', format('SELECT public.brand_plan_host_add(%L, %L::jsonb, %L)', pg_temp.u('brand'),
    jsonb_build_object('type', 'task', 'title', 'Staff task', 'on', (current_date + 3)::text), 'i4420-staff-add-1'));
  PERFORM pg_temp.ok('P-STAFF-ADD-REFUSED staff adding is refused as read_only',
    v::text LIKE '%42501%read_only%');
  v := pg_temp.rpc_as('outsider', format('SELECT public.brand_plan_for_host(%L, current_date - 7, current_date + 30)', pg_temp.u('brand')));
  PERFORM pg_temp.ok('P-OUTSIDER-FOR-HOST an outsider gets not_found', v::text LIKE '%P0002%not_found%');

  -- G-*: guest activity.
  v_rows := pg_temp.rpc_as('mgr', 'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() a');
  PERFORM pg_temp.ok('G-ROW the team member sees their brand''s Guest chat',
    jsonb_array_length(v_rows) = 1 AND v_rows->0->>'conversation_id' = pg_temp.u('chat')::text);
  PERFORM pg_temp.ok('G-UNREAD two guest messages after the read marker; the brand post is not unread',
    (v_rows->0->>'unread_count')::integer = 2);
  PERFORM pg_temp.ok('G-LAST the last line is the brand post',
    v_rows->0->>'last_message_preview' = 'Doors at 6pm' AND (v_rows->0->>'last_message_from_brand')::boolean);
  v_rows := pg_temp.rpc_as('outsider', 'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() a');
  PERFORM pg_temp.ok('G-OUTSIDER a non-team user sees no rows', v_rows = '[]'::jsonb);
  v_rows := pg_temp.rpc_as('guest', 'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() a');
  PERFORM pg_temp.ok('G-GUEST a guest sees no rows', v_rows = '[]'::jsonb);
  v_rows := pg_temp.rpc_as('removed', 'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() a');
  PERFORM pg_temp.ok('G-REMOVED a removed teammate sees no rows', v_rows = '[]'::jsonb);
  v_rows := pg_temp.rpc_as('staff', 'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() a');
  PERFORM pg_temp.ok('G-STAFF support staff not on the team see no Guest chat rows', v_rows = '[]'::jsonb);
  PERFORM pg_temp.ok('G-ANON anon cannot run it',
    NOT has_function_privilege('anon', 'public.issue_4420_brand_guest_activity()', 'EXECUTE'));

  -- G-READ: moving my own read marker clears my unread (the Host app's path).
  PERFORM pg_temp.as_user('mgr');
  PERFORM set_config('role', 'authenticated', true);
  UPDATE public.conversation_participants SET last_read_at = now()
   WHERE conversation_id = pg_temp.u('chat') AND user_id = pg_temp.u('mgr');
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.as_server();
  v_rows := pg_temp.rpc_as('mgr', 'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() a');
  PERFORM pg_temp.ok('G-READ after reading, unread is 0', (v_rows->0->>'unread_count')::integer = 0);
END
$cases$;

ROLLBACK;
