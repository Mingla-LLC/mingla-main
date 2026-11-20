\set ON_ERROR_STOP on

-- #4420 tester adversarial (20281120004420, 20281120014420, 20281120024420).
-- Runs on the fully replayed PG17 schema; everything rolls back.
--
-- Angles the implementor suite does not take:
--   W-*  support staff can never change a plan item, even one they authored
--        while they were on the team (update / remove refused, row unchanged)
--   N-*  still not_found: disabled support row, inactive Mingla teammate,
--        a deleted brand (even for staff), and brand_plan_can_read is not
--        callable by anon or authenticated
--   A-*  guest activity: never another brand's row or last line; a support
--        staff member who is a participant of the room still sees nothing;
--        unread ignores the caller's own, deleted, system and pre-marker
--        messages; a deleted newest line is never the preview; a deleted
--        brand's room disappears; anon is refused at run time
--   H-*  search_path hijack: a caller schema shadowing the helper and the
--        tables changes nothing
--   E-*  ensure: twice gives one room; a brand delete/restore round trip goes
--        through the ON CONFLICT path and never flips an Open room; a room
--        ensured for an already deleted brand starts disabled and broadcast
--
-- Fails on revert: dropping `b.deleted_at IS NULL` from can_read fails
-- N-DELETED; letting staff into brand_plan_can_write fails W-*; dropping the
-- team filter fails A-OTHER / A-STAFF-PARTICIPANT; dropping any unread filter
-- fails its A-UNREAD-* case; letting ensure's ON CONFLICT set
-- is_broadcast_only fails E-ROUNDTRIP.

BEGIN;

CREATE TEMP TABLE k(tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON k TO authenticated, anon;
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
-- p_sql as p_tag in role p_role; the jsonb result, or 'SQLSTATE message'.
CREATE FUNCTION pg_temp.run_as(p_tag text, p_role text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v_state text; v_msg text;
BEGIN
  BEGIN
    IF p_tag IS NULL THEN
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
    ELSE
      PERFORM pg_temp.as_user(p_tag);
    END IF;
    PERFORM set_config('role', p_role, true);
    EXECUTE p_sql INTO r;
    PERFORM set_config('role', 'postgres', true);
    PERFORM pg_temp.as_server();
    RETURN r;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM set_config('role', 'postgres', true);
    PERFORM pg_temp.as_server();
    RETURN to_jsonb(v_state || ' ' || v_msg);
  END;
END $f$;
CREATE FUNCTION pg_temp.activity(p_tag text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.run_as(p_tag, 'authenticated',
    'SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.conversation_id), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() a')
$f$;
CREATE FUNCTION pg_temp.person(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, 'i4420t-' || p_tag || '-' || v || '@example.test');
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.brand(p_tag text, p_owner text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.creator_accounts(id) VALUES (pg_temp.u(p_owner)) ON CONFLICT DO NOTHING;
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider)
    VALUES (v, pg_temp.u(p_owner), 'T4420 ' || p_tag, 'i4420t-' || v, 'stripe');
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;

DO $setup$
DECLARE v_a uuid; v_b uuid; v_conv_a uuid; v_conv_b uuid;
BEGIN
  PERFORM pg_temp.person('owner_a');
  PERFORM pg_temp.person('owner_b');
  PERFORM pg_temp.person('mgr');          -- marketing manager on brand A only
  PERFORM pg_temp.person('staff');        -- support staff, formerly on brand A's team
  PERFORM pg_temp.person('staff_off');    -- support row disabled, no Mingla team row
  PERFORM pg_temp.person('ex_mingla');    -- Mingla teammate whose row is not active
  PERFORM pg_temp.person('stranger');
  PERFORM pg_temp.person('guest');
  v_a := pg_temp.brand('brand_a', 'owner_a');
  v_b := pg_temp.brand('brand_b', 'owner_b');

  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at) VALUES
    (v_a, pg_temp.u('mgr'), 'marketing_manager', now(), now()),
    (v_a, pg_temp.u('staff'), 'marketing_manager', now(), now())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.support_staff(user_id, enabled, available, display_name, role) VALUES
    (pg_temp.u('staff'), true, true, 'Support T4420', 'lead'),
    (pg_temp.u('staff_off'), false, false, 'Support off T4420', 'lead');
  INSERT INTO public.admin_team_members(email, role, status, accepted_at)
    SELECT email, 'growth', 'active', now() FROM auth.users WHERE id = pg_temp.u('staff');
  INSERT INTO public.admin_team_members(email, role, status)
    SELECT email, 'growth', 'invited' FROM auth.users WHERE id = pg_temp.u('ex_mingla');

  v_conv_a := public.issue_4459_ensure_brand_guest_chat(v_a);
  v_conv_b := public.issue_4459_ensure_brand_guest_chat(v_b);
  INSERT INTO k VALUES ('chat_a', v_conv_a), ('chat_b', v_conv_b);
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at) VALUES
    (v_conv_a, pg_temp.u('guest'), now() - interval '5 days'),
    (v_conv_b, pg_temp.u('guest'), now() - interval '5 days')
  ON CONFLICT DO NOTHING;
  UPDATE public.conversation_participants SET last_read_at = now() - interval '1 hour'
   WHERE conversation_id = v_conv_a AND user_id = pg_temp.u('mgr');

  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, sender_kind, created_at, deleted_at) VALUES
    -- brand A: exactly 1 counts as unread for mgr
    (v_conv_a, pg_temp.u('guest'), 'before the marker', 'text', 'guest', now() - interval '2 hours', NULL),
    (v_conv_a, pg_temp.u('guest'), 'counts', 'text', 'guest', now() - interval '40 minutes', NULL),
    (v_conv_a, pg_temp.u('guest'), 'deleted guest line', 'text', 'guest', now() - interval '30 minutes', now()),
    (v_conv_a, pg_temp.u('mgr'), 'my own reply', 'text', NULL, now() - interval '20 minutes', NULL),
    (v_conv_a, NULL, 'Joined', 'system', 'system', now() - interval '15 minutes', NULL),
    (v_conv_a, NULL, 'Brand post', 'text', 'brand', now() - interval '10 minutes', NULL),
    (v_conv_a, pg_temp.u('guest'), 'NEWEST BUT DELETED', 'text', 'guest', now() - interval '1 minute', now()),
    -- brand B: a secret last line nobody on brand A may see
    (v_conv_b, pg_temp.u('guest'), 'SECRET-BRAND-B', 'text', 'guest', now() - interval '5 minutes', NULL);

  -- The staff member used to be on brand A and authored a plan post (an idea
  -- they still own); then left the team.
  INSERT INTO public.content_calendar_items(title, stage, created_by, updated_by, brand_id, publish_at, brand_plan_author_id)
    VALUES ('Staff era post', 'idea', 'i4420t', 'i4420t', v_a, now() + interval '5 days', pg_temp.u('staff'))
    RETURNING id INTO v_b;
  INSERT INTO k VALUES ('post', v_b);
  UPDATE public.brand_team_members SET removed_at = now() WHERE brand_id = v_a AND user_id = pg_temp.u('staff');
  -- The staff member is also (wrongly) a participant of brand A's guest room.
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_conv_a, pg_temp.u('staff'))
  ON CONFLICT DO NOTHING;
END
$setup$;

DO $cases$
DECLARE v jsonb; v_rows jsonb; v_rev bigint; v_title text; v_bo boolean;
BEGIN
  -- W-*: staff never write, even their own former items.
  PERFORM pg_temp.ok('W-SETUP staff authored a post while on the team', pg_temp.u('post') IS NOT NULL);
  PERFORM pg_temp.ok('W-READ staff (now off the team) still read the plan',
    public.brand_plan_can_read(pg_temp.u('brand_a'), pg_temp.u('staff'))
    AND NOT public.brand_plan_can_write(pg_temp.u('brand_a'), pg_temp.u('staff')));
  SELECT revision, title INTO v_rev, v_title FROM public.content_calendar_items WHERE id = pg_temp.u('post');
  v := pg_temp.run_as('staff', 'authenticated', format('SELECT public.brand_plan_host_update(''post'', %L, %L::jsonb, %s)',
    pg_temp.u('post'), jsonb_build_object('title', 'staff rewrite')::text, v_rev));
  PERFORM pg_temp.ok('W-UPDATE-POST staff updating their former post is refused', v::text LIKE '%42501%read_only%');
  PERFORM pg_temp.ok('W-UPDATE-POST-ROW the post is unchanged',
    (SELECT title = v_title AND revision = v_rev AND deleted_at IS NULL FROM public.content_calendar_items WHERE id = pg_temp.u('post')));
  v := pg_temp.run_as('staff', 'authenticated', format('SELECT public.brand_plan_host_remove(''post'', %L, %s)', pg_temp.u('post'), v_rev));
  PERFORM pg_temp.ok('W-REMOVE-POST staff removing their former post is refused', v::text LIKE '%42501%' OR v::text LIKE '%P0002%');
  PERFORM pg_temp.ok('W-REMOVE-POST-ROW the post is still there',
    (SELECT deleted_at IS NULL FROM public.content_calendar_items WHERE id = pg_temp.u('post')));
  v := pg_temp.run_as('staff', 'authenticated', format('SELECT public.brand_plan_host_add(%L, %L::jsonb, %L)', pg_temp.u('brand_a'),
    jsonb_build_object('type', 'task', 'title', 'Staff add', 'on', (current_date + 3)::text), 'i4420t-staff-add'));
  PERFORM pg_temp.ok('W-ADD staff adding is refused as read_only', v::text LIKE '%42501%read_only%');
  v := pg_temp.run_as('staff', 'authenticated', format('SELECT public.brand_plan_for_host(%L, current_date - 7, current_date + 30)', pg_temp.u('brand_a')));
  PERFORM pg_temp.ok('W-FOR-HOST staff see can_add false', jsonb_typeof(v) = 'object' AND (v->>'can_add')::boolean IS FALSE);

  -- N-*: still not_found.
  FOREACH v_title IN ARRAY ARRAY['stranger', 'staff_off', 'ex_mingla', 'guest'] LOOP
    v := pg_temp.run_as(v_title, 'authenticated', format('SELECT public.brand_plan_for_host(%L, current_date - 7, current_date + 30)', pg_temp.u('brand_a')));
    PERFORM pg_temp.ok('N-' || v_title || ' gets not_found on the plan', v::text LIKE '%P0002%not_found%');
    v := pg_temp.run_as(v_title, 'authenticated', format('SELECT public.brand_plan_host_add(%L, %L::jsonb, %L)', pg_temp.u('brand_a'),
      jsonb_build_object('type', 'task', 'title', 'x', 'on', (current_date + 3)::text), 'i4420t-' || v_title));
    PERFORM pg_temp.ok('N-' || v_title || '-ADD gets not_found on add', v::text LIKE '%P0002%not_found%');
  END LOOP;
  v := pg_temp.run_as('staff', 'authenticated', format('SELECT to_jsonb(public.brand_plan_can_read(%L, %L))', pg_temp.u('brand_a'), pg_temp.u('staff')));
  PERFORM pg_temp.ok('N-DIRECT authenticated cannot call brand_plan_can_read', v::text LIKE '%42501%');
  v := pg_temp.run_as(NULL, 'anon', format('SELECT to_jsonb(public.brand_plan_can_read(%L, %L))', pg_temp.u('brand_a'), pg_temp.u('staff')));
  PERFORM pg_temp.ok('N-ANON anon cannot call brand_plan_can_read', v::text LIKE '%42501%');

  -- A-*: guest activity.
  v_rows := pg_temp.activity('mgr');
  PERFORM pg_temp.ok('A-ONE mgr sees exactly brand A''s room',
    jsonb_array_length(v_rows) = 1 AND v_rows->0->>'conversation_id' = pg_temp.u('chat_a')::text);
  PERFORM pg_temp.ok('A-OTHER brand B''s last line never appears', v_rows::text NOT LIKE '%SECRET-BRAND-B%');
  PERFORM pg_temp.ok('A-UNREAD-FILTERS own, deleted, system, brand and pre-marker lines are not unread',
    (v_rows->0->>'unread_count')::integer = 1);
  PERFORM pg_temp.ok('A-PREVIEW-DELETED a deleted newest line is never the preview',
    v_rows->0->>'last_message_preview' = 'Brand post' AND v_rows::text NOT LIKE '%NEWEST BUT DELETED%');
  PERFORM pg_temp.ok('A-STAFF-PARTICIPANT staff in the room but off the team see nothing', pg_temp.activity('staff') = '[]'::jsonb);
  PERFORM pg_temp.ok('A-GUEST a guest in two rooms sees nothing', pg_temp.activity('guest') = '[]'::jsonb);
  PERFORM pg_temp.ok('A-STRANGER a stranger sees nothing', pg_temp.activity('stranger') = '[]'::jsonb);
  v := pg_temp.run_as(NULL, 'anon', 'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() a');
  PERFORM pg_temp.ok('A-ANON anon is refused at run time', v::text LIKE '%42501%');
  v_rows := pg_temp.activity('owner_b');
  PERFORM pg_temp.ok('A-OWNER-B brand B''s owner sees only brand B',
    jsonb_array_length(v_rows) = 1 AND v_rows->0->>'conversation_id' = pg_temp.u('chat_b')::text);

  -- H-*: a caller-controlled schema shadowing helpers and tables does nothing.
  CREATE SCHEMA i4420_evil;
  CREATE TABLE i4420_evil.messages (LIKE public.messages);
  CREATE FUNCTION i4420_evil.issue_4459_is_brand_team(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
  CREATE FUNCTION i4420_evil.is_support_staff(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
  GRANT USAGE ON SCHEMA i4420_evil TO authenticated;
  PERFORM set_config('search_path', 'i4420_evil, public, pg_catalog', true);
  PERFORM pg_temp.ok('H-ACTIVITY a stranger with a hijacked search_path still sees nothing', pg_temp.activity('stranger') = '[]'::jsonb);
  v := pg_temp.run_as('stranger', 'authenticated', format('SELECT public.brand_plan_for_host(%L, current_date - 7, current_date + 30)', pg_temp.u('brand_a')));
  PERFORM pg_temp.ok('H-PLAN a stranger with a hijacked search_path still gets not_found', v::text LIKE '%P0002%not_found%');
  PERFORM set_config('search_path', 'public, extensions', true);

  -- E-*: ensure.
  PERFORM public.issue_4459_ensure_brand_guest_chat(pg_temp.u('brand_a'));
  PERFORM public.issue_4459_ensure_brand_guest_chat(pg_temp.u('brand_a'));
  PERFORM pg_temp.ok('E-TWICE ensure three times still gives one room with the same id',
    (SELECT count(*) = 1 AND min(id::text) = pg_temp.u('chat_a')::text FROM public.conversations
      WHERE brand_id = pg_temp.u('brand_a') AND linked_entity_type = 'brand_guests'));
  PERFORM pg_temp.ok('E-NEW brand B''s fresh room started broadcast-only',
    (SELECT is_broadcast_only FROM public.conversations WHERE id = pg_temp.u('chat_b')));
  UPDATE public.conversations SET is_broadcast_only = false WHERE id = pg_temp.u('chat_a');
  UPDATE public.brands SET deleted_at = now() WHERE id = pg_temp.u('brand_a');
  PERFORM public.issue_4459_ensure_brand_guest_chat(pg_temp.u('brand_a'));
  SELECT is_broadcast_only INTO v_bo FROM public.conversations WHERE id = pg_temp.u('chat_a');
  PERFORM pg_temp.ok('E-DELETE deleting the brand disables the room and keeps it Open',
    (SELECT NOT is_enabled FROM public.conversations WHERE id = pg_temp.u('chat_a')) AND v_bo IS FALSE);
  PERFORM pg_temp.ok('A-DELETED-BRAND a deleted brand''s room drops out of activity', pg_temp.activity('mgr') = '[]'::jsonb);
  v := pg_temp.run_as('staff', 'authenticated', format('SELECT public.brand_plan_for_host(%L, current_date - 7, current_date + 30)', pg_temp.u('brand_a')));
  PERFORM pg_temp.ok('N-DELETED staff get not_found on a deleted brand''s plan', v::text LIKE '%P0002%not_found%');
  UPDATE public.brands SET deleted_at = NULL WHERE id = pg_temp.u('brand_a');
  PERFORM public.issue_4459_ensure_brand_guest_chat(pg_temp.u('brand_a'));
  PERFORM pg_temp.ok('E-ROUNDTRIP restoring the brand re-enables the room and it is still Open',
    (SELECT is_enabled AND NOT is_broadcast_only FROM public.conversations WHERE id = pg_temp.u('chat_a')));

  -- A brand that is already deleted when its room is first ensured.
  PERFORM pg_temp.person('owner_c');
  PERFORM pg_temp.brand('brand_c', 'owner_c');
  UPDATE public.brands SET deleted_at = now() WHERE id = pg_temp.u('brand_c');
  DELETE FROM public.conversations WHERE brand_id = pg_temp.u('brand_c') AND linked_entity_type = 'brand_guests';
  PERFORM public.issue_4459_ensure_brand_guest_chat(pg_temp.u('brand_c'));
  PERFORM pg_temp.ok('E-DELETED-NEW a room first ensured for a deleted brand is disabled and broadcast',
    (SELECT count(*) = 1 AND bool_and(NOT is_enabled AND is_broadcast_only) FROM public.conversations
      WHERE brand_id = pg_temp.u('brand_c') AND linked_entity_type = 'brand_guests'));
  PERFORM pg_temp.ok('E-MISSING ensure for a brand that does not exist returns NULL',
    public.issue_4459_ensure_brand_guest_chat(gen_random_uuid()) IS NULL);
END
$cases$;

ROLLBACK;
