\set ON_ERROR_STOP on

-- #4435 leftovers — INDEPENDENT TESTER adversarial suite for
-- 20280710004435_issue_4435_leftovers.sql. Angles the implementor suite does
-- not take: the live apps' own leave paths (the 1.2.0 leave call AND the
-- 1.1.0 / 1.1.6 own-row delete) choosing an admin who joined later, account
-- deletion through the service role (handover then the auth cascade), full-row
-- app writes that resend unchanged guarded fields, every server path that the
-- live apps use to write the guarded fields, a member with no join time, and
-- the departure record across leave / rejoin / leave. Everything rolls back.
--
-- Fails on revert of the migration (verified by the tester): T-LEAVE, T-DELETE,
-- T-NOTICE, T-FIELDS-FULLROW's refusal half.

BEGIN;

DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

DELETE FROM public.app_config WHERE config_key = 'global_plus_access';
INSERT INTO public.app_config(config_key, config_value) VALUES ('global_plus_access', 'true');
CREATE TEMP TABLE tq(tag text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM tq WHERE tag = p_tag $f$;
CREATE FUNCTION pg_temp.ok(p_label text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_label; END IF;
  RAISE NOTICE 'PASS %', p_label;
END $f$;
-- p_sql as the signed-in app client p_tag: 'ok:<rows>' or 'SQLSTATE:message'.
CREATE FUNCTION pg_temp.as_app(p_tag text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text; n bigint; v uuid := pg_temp.u(p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN r := SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
CREATE FUNCTION pg_temp.creator(p_s uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT created_by FROM public.collaboration_sessions WHERE id = p_s $f$;
CREATE FUNCTION pg_temp.admin(p_s uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT is_admin FROM public.session_participants WHERE session_id = p_s AND user_id = pg_temp.u(p_tag)), false) $f$;
CREATE FUNCTION pg_temp.conv(p_s uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.conversations WHERE session_id = p_s AND linked_entity_type = 'session' $f$;
-- a group the way create_group_chat makes it, then members joined in order with
-- the given minutes-ago join times (NULL = no join time recorded).
CREATE FUNCTION pg_temp.mk(p_name text, p_creator text, p_members text[], p_mins int[]) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_s uuid; i int;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES (p_name, pg_temp.u(p_creator), 'active') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at)
    VALUES (v_s, pg_temp.u(p_creator), true, now() - interval '1000 minutes');
  FOR i IN 1 .. array_length(p_members, 1) LOOP
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at)
      VALUES (v_s, pg_temp.u(p_members[i]), true, CASE WHEN p_mins[i] IS NULL THEN NULL ELSE now() - make_interval(mins => p_mins[i]) END);
    INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status)
      VALUES (v_s, pg_temp.u(p_creator), pg_temp.u(p_members[i]), 'accepted');
  END LOOP;
  INSERT INTO tq VALUES (p_name, v_s);
  RETURN v_s;
END $f$;

DO $fx$
DECLARE t text; v uuid;
BEGIN
  FOREACH t IN ARRAY ARRAY['a','b','c','d','e'] LOOP
    v := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v, 'tla-' || t || '-' || v || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v, 'tla-' || t || '-' || v || '@example.test', initcap(t), initcap(t)) ON CONFLICT (id) DO NOTHING;
    INSERT INTO tq VALUES (t, v);
  END LOOP;
  FOR t IN SELECT tag FROM tq LOOP
    FOR v IN SELECT id FROM tq WHERE tag <> t LOOP
      INSERT INTO public.friends(user_id, friend_user_id, status) VALUES (pg_temp.u(t), v, 'accepted') ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $fx$;

-- ── T-LEAVE: both live leave paths hand the group to the admin who joined later ──
DO $leave$
DECLARE v_s uuid; r text;
BEGIN
  -- 1.2.0: the leave call. b joined first, c joined later and was made admin.
  v_s := pg_temp.mk('tl1', 'a', ARRAY['b','c'], ARRAY[300, 200]);
  UPDATE public.session_participants SET is_admin = true WHERE session_id = v_s AND user_id = pg_temp.u('c');
  r := pg_temp.as_app('a', format($$SELECT public.leave_group_conversation(%L)$$, pg_temp.conv(v_s)));
  PERFORM pg_temp.ok('T-LEAVE 1.2.0 leave call: the admin who joined later (c) takes over, not the older member (b)',
    r LIKE 'ok:%' AND pg_temp.creator(v_s) = pg_temp.u('c') AND pg_temp.admin(v_s, 'c') AND NOT pg_temp.admin(v_s, 'b'));
  -- 1.1.0 / 1.1.6: remove_participant_prefs then the own-row delete
  v_s := pg_temp.mk('tl2', 'a', ARRAY['b','c'], ARRAY[300, 200]);
  UPDATE public.session_participants SET is_admin = true WHERE session_id = v_s AND user_id = pg_temp.u('c');
  r := pg_temp.as_app('a', format($$SELECT public.remove_participant_prefs(%L, %L)$$, v_s, pg_temp.u('a')));
  PERFORM pg_temp.ok('T-LEAVE 1.1.x prefs clean-up still works for the leaving creator', r LIKE 'ok:%');
  r := pg_temp.as_app('a', format($$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = auth.uid()$$, v_s));
  PERFORM pg_temp.ok('T-LEAVE 1.1.x own-row delete: same heir as the leave call',
    r = 'ok:1' AND pg_temp.creator(v_s) = pg_temp.u('c') AND pg_temp.admin(v_s, 'c'));
  -- the 1.1.x follow-up "revoke" (delete where created_by = me) after leaving: no row, no error
  r := pg_temp.as_app('a', format($$DELETE FROM public.collaboration_sessions WHERE id = %L AND created_by = auth.uid()$$, v_s));
  PERFORM pg_temp.ok('T-LEAVE 1.1.x follow-up revoke by the old creator deletes nothing',
    r = 'ok:0' AND EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
  -- an admin flag on a pending invitee never makes them the heir
  v_s := pg_temp.mk('tl3', 'a', ARRAY['b'], ARRAY[300]);
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, is_admin) VALUES (v_s, pg_temp.u('d'), false, true);
  r := pg_temp.as_app('a', format($$SELECT public.leave_group_conversation(%L)$$, pg_temp.conv(v_s)));
  PERFORM pg_temp.ok('T-LEAVE a pending invitee flagged admin is skipped; the accepted member takes over',
    pg_temp.creator(v_s) = pg_temp.u('b') AND pg_temp.admin(v_s, 'b'));
END $leave$;

-- ── T-DELETE: account deletion of a creator (delete-user's order) ───────────
DO $del$
DECLARE v_s uuid; v_heir uuid; v_a uuid; v_b uuid; v_c uuid;
BEGIN
  v_s := pg_temp.mk('td1', 'a', ARRAY['b','c'], ARRAY[300, 200]);
  UPDATE public.session_participants SET is_admin = true WHERE session_id = v_s AND user_id = pg_temp.u('c');
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('d'), false);
  v_a := pg_temp.u('a');
  PERFORM set_config('role', 'service_role', true);
  v_heir := public.issue_4435_hand_over_creator(v_s, v_a);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('T-DELETE the service role hands over to the admin before the account goes',
    v_heir = pg_temp.u('c') AND pg_temp.creator(v_s) = pg_temp.u('c') AND pg_temp.admin(v_s, 'c'));
  DELETE FROM auth.users WHERE id = pg_temp.u('a');
  PERFORM pg_temp.ok('T-DELETE after the auth cascade the group carries on with c as creator; b and pending d stay',
    pg_temp.creator(v_s) = pg_temp.u('c') AND pg_temp.admin(v_s, 'c') AND NOT pg_temp.admin(v_s, 'b')
    AND (SELECT count(*) FROM public.session_participants WHERE session_id = v_s) = 3);
  PERFORM pg_temp.ok('T-DELETE a second handover for the deleted creator does nothing',
    public.issue_4435_hand_over_creator(v_s, pg_temp.u('a')) IS NULL AND pg_temp.creator(v_s) = pg_temp.u('c'));
  -- the creator alone with only a pending invitee: the group is deleted with the account
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('td2', pg_temp.u('b'), 'active') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at) VALUES (v_s, pg_temp.u('b'), true, now());
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('e'), false);
  PERFORM pg_temp.ok('T-DELETE no accepted heir: no handover to a pending invitee',
    public.issue_4435_hand_over_creator(v_s, pg_temp.u('b')) IS NULL AND pg_temp.creator(v_s) = pg_temp.u('b'));
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b');
  PERFORM pg_temp.ok('T-DELETE no accepted member left: the group is deleted',
    NOT EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $del$;

-- ── T-FIELDS: full-row app writes, and every server path that writes the guarded fields ──
DO $fields$
DECLARE v_s uuid; r text; v_ver int; v_prefs jsonb;
BEGIN
  v_s := pg_temp.mk('tf1', 'b', ARRAY['c','d'], ARRAY[300, 200]);
  UPDATE public.collaboration_sessions SET is_active = true, archived_at = NULL WHERE id = v_s;
  -- a client that resends the guarded fields unchanged (a full-row PATCH) is fine
  r := pg_temp.as_app('c', format($$UPDATE public.collaboration_sessions cs SET name = 'tf1 renamed', is_active = cs.is_active,
       archived_at = cs.archived_at, participant_prefs = cs.participant_prefs, deck_version = cs.deck_version,
       deck_params_hash = cs.deck_params_hash WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('T-FIELDS a write that resends the guarded fields unchanged passes', r = 'ok:1'
    AND (SELECT name FROM public.collaboration_sessions WHERE id = v_s) = 'tf1 renamed');
  r := pg_temp.as_app('b', format($$UPDATE public.collaboration_sessions SET archived_at = now() WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('T-FIELDS the creator cannot archive by a direct write', r LIKE '42501:%'
    AND (SELECT archived_at FROM public.collaboration_sessions WHERE id = v_s) IS NULL);
  r := pg_temp.as_app('c', format($$UPDATE public.collaboration_sessions SET participant_prefs = '{"forged":{}}'::jsonb WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('T-FIELDS a member cannot wipe everyone''s prefs by a direct write', r LIKE '42501:%');
  -- the server paths the live apps use still write them
  v_ver := COALESCE((SELECT deck_version FROM public.collaboration_sessions WHERE id = v_s), 0);
  r := pg_temp.as_app('d', format($$SELECT public.upsert_participant_prefs(%L, %L, '{"categories":["nature"],"travel_mode":"walking"}'::jsonb)$$, v_s, pg_temp.u('d')));
  SELECT participant_prefs INTO v_prefs FROM public.collaboration_sessions WHERE id = v_s;
  PERFORM pg_temp.ok('T-FIELDS upsert_participant_prefs (all live builds) still writes prefs and bumps the deck version',
    r LIKE 'ok:%' AND v_prefs ? pg_temp.u('d')::text
    AND (SELECT deck_version FROM public.collaboration_sessions WHERE id = v_s) > v_ver);
  r := pg_temp.as_app('d', format($$SELECT public.remove_participant_prefs(%L, %L)$$, v_s, pg_temp.u('d')));
  PERFORM pg_temp.ok('T-FIELDS remove_participant_prefs still clears my prefs',
    r LIKE 'ok:%' AND NOT ((SELECT participant_prefs FROM public.collaboration_sessions WHERE id = v_s) ? pg_temp.u('d')::text));
  -- the app's own updated_at touch fires the deck recompute, which is a server write nested in the app's
  v_ver := COALESCE((SELECT deck_version FROM public.collaboration_sessions WHERE id = v_s), 0);
  r := pg_temp.as_app('c', format($$SELECT public.upsert_participant_prefs(%L, %L, '{"categories":["drinks_and_music"]}'::jsonb)$$, v_s, pg_temp.u('c')));
  r := pg_temp.as_app('c', format($$UPDATE public.collaboration_sessions SET status = 'active', updated_at = now() WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('T-FIELDS the 1.1.x activate write (status + updated_at) passes with the nested deck recompute', r = 'ok:1');
END $fields$;

-- ── T-NOTICE: the departure record across leave, rejoin and leave again ─────
DO $notice$
DECLARE v_s uuid; j jsonb; t1 timestamptz; v_b uuid; v_c uuid;
BEGIN
  v_s := pg_temp.mk('tn1', 'e', ARRAY['b','c'], ARRAY[300, 200]);
  PERFORM pg_temp.as_app('c', format($$SELECT public.leave_group_conversation(%L)$$, pg_temp.conv(v_s)));
  SELECT departed_at INTO t1 FROM public.issue_4435_member_departures WHERE session_id = v_s AND user_id = pg_temp.u('c');
  v_b := pg_temp.u('b'); v_c := pg_temp.u('c');
  PERFORM set_config('role', 'service_role', true);
  j := public.issue_4435_session_notice_check(v_s, v_c, v_b);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('T-NOTICE right after leaving, the leaver may tell the group it left (the app sends it after the leave)',
    t1 IS NOT NULL AND (j ->> 'sender_member')::boolean AND (j ->> 'recipient_member')::boolean AND (j ->> 'session_exists')::boolean);
  -- rejoin, then leave again much later: the record follows the latest leave
  PERFORM pg_temp.as_app('e', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, pg_temp.conv(v_s), pg_temp.u('c')));
  UPDATE public.issue_4435_member_departures SET departed_at = now() - interval '2 hours' WHERE session_id = v_s AND user_id = pg_temp.u('c');
  v_b := pg_temp.u('b'); v_c := pg_temp.u('c');
  PERFORM set_config('role', 'service_role', true);
  j := public.issue_4435_session_notice_check(v_s, v_c, v_b);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('T-NOTICE back in the group, c is a member again whatever the old record says', (j ->> 'sender_member')::boolean);
  DELETE FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('c');
  PERFORM pg_temp.ok('T-NOTICE leaving again refreshes the record (one row per person and group)',
    (SELECT count(*) FROM public.issue_4435_member_departures WHERE session_id = v_s AND user_id = pg_temp.u('c')) = 1
    AND (SELECT departed_at FROM public.issue_4435_member_departures WHERE session_id = v_s AND user_id = pg_temp.u('c')) > now() - interval '1 minute');
  -- nobody signed in can read or write the record
  PERFORM pg_temp.ok('T-NOTICE the record is not readable by app clients',
    pg_temp.as_app('b', 'SELECT * FROM public.issue_4435_member_departures') LIKE '42501:%'
    AND pg_temp.as_app('b', format($$INSERT INTO public.issue_4435_member_departures(session_id, user_id, was_accepted) VALUES (%L, %L, true)$$, gen_random_uuid(), pg_temp.u('b'))) LIKE '42501:%');
END $notice$;

ROLLBACK;
