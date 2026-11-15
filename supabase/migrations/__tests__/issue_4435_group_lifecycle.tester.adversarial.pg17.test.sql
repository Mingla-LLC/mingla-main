\set ON_ERROR_STOP on

-- #4435 M-A (20280708054435) adversarial suite: crafted callers against every
-- new membership function, the cap under split adds, and the old guards.
-- Runs on the fully replayed PG17 schema; everything rolls back.
--
--
-- Cases: X-PENDING, X-REMOVED, X-STRANGER, X-ANON, X-KIND, X-SPLIT-CAP,
-- X-SELF, X-DIRECT-WRITES, X-PREFS.

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

CREATE TEMP TABLE k5(tag text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM k5 WHERE tag = p_tag $f$;
CREATE FUNCTION pg_temp.as_user(p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid := pg_temp.u(p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $f$;
CREATE FUNCTION pg_temp.ok(p_label text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_label; END IF;
  RAISE NOTICE 'PASS %', p_label;
END $f$;
-- Runs p_sql as the authenticated client p_tag; returns 'ok' or 'SQLSTATE:message'.
CREATE FUNCTION pg_temp.try_as(p_tag text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql;
    r := 'ok';
  EXCEPTION WHEN OTHERS THEN r := SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
-- Runs p_sql (a SELECT returning one jsonb) as the authenticated client p_tag.
CREATE FUNCTION pg_temp.call_as(p_tag text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO r;
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
CREATE FUNCTION pg_temp.accepted(p_session uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = p_session AND user_id = pg_temp.u(p_tag) AND has_accepted)
$f$;
CREATE FUNCTION pg_temp.conv_of(p_session uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.conversations WHERE session_id = p_session AND linked_entity_type = 'session'
$f$;
-- A session group made by postgres: p_members accepted (first is the creator).
CREATE FUNCTION pg_temp.mk_group(p_tag text, p_members text[]) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_s uuid; v_t text; i int := 0;
BEGIN
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('x5 ' || p_tag, pg_temp.u(p_members[1]), 'active') RETURNING id INTO v_s;
  FOREACH v_t IN ARRAY p_members LOOP
    i := i + 1;
    INSERT INTO public.session_participants(session_id, user_id, has_accepted, joined_at)
      VALUES (v_s, pg_temp.u(v_t), true, now() - make_interval(mins => 100 - i));
  END LOOP;
  INSERT INTO k5 VALUES (p_tag, v_s);
  RETURN v_s;
END $f$;

DO $fixture$
DECLARE v_tag text; v_id uuid; i int;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['a','b','c','d','e','x','blk','j','fr2'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'x5-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'x5-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k5 VALUES (v_tag, v_id);
  END LOOP;
  FOR i IN 1..16 LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'x5-f' || i || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'x5-f' || i || '-' || v_id || '@example.test', 'F' || i, 'F' || i) ON CONFLICT (id) DO NOTHING;
    INSERT INTO k5 VALUES ('f' || i, v_id);
  END LOOP;
  -- a is friends with b, c, d, e, blk, f1..f16; b is friends with c, f1..f16.
  FOR v_tag IN SELECT tag FROM k5 WHERE tag IN ('b','c','d','e','blk') OR tag ~ '^f[0-9]+$' LOOP
    INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
      (pg_temp.u('a'), pg_temp.u(v_tag), 'accepted'), (pg_temp.u(v_tag), pg_temp.u('a'), 'accepted');
  END LOOP;
  FOR v_tag IN SELECT tag FROM k5 WHERE tag = 'c' OR tag ~ '^f[0-9]+$' LOOP
    INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
      (pg_temp.u('b'), pg_temp.u(v_tag), 'accepted'), (pg_temp.u(v_tag), pg_temp.u('b'), 'accepted');
  END LOOP;
  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (pg_temp.u('a'), pg_temp.u('blk'));
END $fixture$;


DO $setup$
DECLARE v_s uuid := pg_temp.mk_group('g', ARRAY['a','b','c']);
BEGIN
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES (v_s, pg_temp.u('d'), false);
  INSERT INTO public.collaboration_invites(session_id, inviter_id, invited_user_id, status) VALUES (v_s, pg_temp.u('a'), pg_temp.u('d'), 'pending');
  INSERT INTO k5 VALUES ('gc', pg_temp.conv_of(v_s));
END $setup$;

-- X-PENDING: a pending invitee cannot add, remove or promote.
DO $pending$
DECLARE v_conv uuid := pg_temp.u('gc'); v_err text;
BEGIN
  v_err := pg_temp.try_as('d', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('X-PENDING a pending invitee cannot add people', v_err LIKE '42501:not_allowed%');
  v_err := pg_temp.try_as('d', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('c')));
  PERFORM pg_temp.ok('X-PENDING a pending invitee cannot remove', v_err LIKE '42501:not_allowed%');
  v_err := pg_temp.try_as('d', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('d')));
  PERFORM pg_temp.ok('X-PENDING a pending invitee cannot promote', v_err LIKE '42501:not_allowed%');
  -- even a pending row flagged admin by the server is not enough
  UPDATE public.session_participants SET is_admin = true WHERE session_id = pg_temp.u('g') AND user_id = pg_temp.u('d');
  v_err := pg_temp.try_as('d', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('c')));
  PERFORM pg_temp.ok('X-PENDING a pending row with an admin flag still cannot remove', v_err LIKE '42501:not_allowed%' AND pg_temp.accepted(pg_temp.u('g'), 'c'));
  UPDATE public.session_participants SET is_admin = false WHERE session_id = pg_temp.u('g') AND user_id = pg_temp.u('d');
  v_err := pg_temp.try_as('a', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('d')));
  PERFORM pg_temp.ok('X-PENDING a pending invitee cannot be made admin', v_err LIKE 'P0002:not_found%');
END $pending$;

-- X-REMOVED: a removed admin loses every power.
DO $removed$
DECLARE v_conv uuid := pg_temp.u('gc'); v_err text;
BEGIN
  PERFORM pg_temp.call_as('a', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.call_as('a', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('b')));
  v_err := pg_temp.try_as('b', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('c')));
  PERFORM pg_temp.ok('X-REMOVED a removed admin cannot remove', v_err LIKE '42501:not_allowed%' AND pg_temp.accepted(pg_temp.u('g'), 'c'));
  v_err := pg_temp.try_as('b', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('f1')));
  PERFORM pg_temp.ok('X-REMOVED a removed member cannot add', v_err LIKE '42501:not_allowed%');
  v_err := pg_temp.try_as('b', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('X-REMOVED a removed member cannot promote', v_err LIKE '42501:not_allowed%');
END $removed$;

-- X-STRANGER / X-ANON / X-KIND
DO $stranger$
DECLARE v_conv uuid := pg_temp.u('gc'); v_err text; v_plain uuid; v_dm uuid;
BEGIN
  v_err := pg_temp.try_as('x', format($$SELECT public.remove_group_member(%L, %L)$$, v_conv, pg_temp.u('c')));
  PERFORM pg_temp.ok('X-STRANGER a non-member cannot remove', v_err LIKE '42501:not_allowed%');
  v_err := pg_temp.try_as('x', format($$SELECT public.set_group_admin(%L, %L, false)$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('X-STRANGER a non-member cannot demote', v_err LIKE '42501:not_allowed%');
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM set_config('role', 'anon', true);
    PERFORM public.create_group_chat('anon', ARRAY[]::uuid[]);
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('X-ANON anon cannot create a group', v_err = '42501');
  INSERT INTO public.conversations(type, linked_entity_type, name, created_by) VALUES ('group', 'direct', 'x5 plain', pg_temp.u('a')) RETURNING id INTO v_plain;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_plain, pg_temp.u('a')), (v_plain, pg_temp.u('c'));
  v_err := pg_temp.try_as('a', format($$SELECT public.remove_group_member(%L, %L)$$, v_plain, pg_temp.u('c')));
  PERFORM pg_temp.ok('X-KIND remove_group_member refuses a plain group', v_err LIKE '42501:not_allowed%');
  INSERT INTO public.conversations(type, linked_entity_type, created_by) VALUES ('direct', 'direct', pg_temp.u('a')) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, pg_temp.u('a')), (v_dm, pg_temp.u('c'));
  v_err := pg_temp.try_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_dm, pg_temp.u('b')));
  PERFORM pg_temp.ok('X-KIND add_group_members refuses a 1:1 chat', v_err LIKE '42501:not_allowed%');
  v_err := pg_temp.try_as('a', format($$SELECT public.set_group_admin(%L, %L, true)$$, gen_random_uuid(), pg_temp.u('c')));
  PERFORM pg_temp.ok('X-KIND an unknown conversation is refused', v_err LIKE '42501:not_allowed%');
END $stranger$;

-- X-SPLIT-CAP: two adds that each fit but together pass 15 -> the second is refused whole.
DO $split$
DECLARE v_s uuid := pg_temp.mk_group('cap', ARRAY['a','b']); v_conv uuid; v_err text; r jsonb;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  r := pg_temp.call_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%s]::uuid[])$$, v_conv,
         (SELECT string_agg(quote_literal(id), ',') FROM k5 WHERE tag ~ '^f([1-9]|1[0-1])$')));
  PERFORM pg_temp.ok('X-SPLIT-CAP first add to 13', (SELECT count(*) FROM public.session_participants WHERE session_id = v_s AND has_accepted) = 13);
  v_err := pg_temp.try_as('b', format($$SELECT public.add_group_members(%L, ARRAY[%L, %L, %L]::uuid[])$$, v_conv,
         pg_temp.u('f12'), pg_temp.u('f13'), pg_temp.u('f14')));
  PERFORM pg_temp.ok('X-SPLIT-CAP a second add past 15 is refused with no partial add',
    v_err LIKE 'PT409:conflict_group_full%' AND (SELECT count(*) FROM public.session_participants WHERE session_id = v_s) = 13);
  -- duplicates and already-members do not count toward the cap
  r := pg_temp.call_as('b', format($$SELECT public.add_group_members(%L, ARRAY[%L, %L, %L, %L]::uuid[])$$, v_conv,
         pg_temp.u('f12'), pg_temp.u('f12'), pg_temp.u('f1'), pg_temp.u('a')));
  PERFORM pg_temp.ok('X-SPLIT-CAP duplicates and members are skipped, not counted',
    r -> 'added' = to_jsonb(ARRAY[pg_temp.u('f12')]) AND (SELECT count(*) FROM public.session_participants WHERE session_id = v_s AND has_accepted) = 14);
  -- raising max_participants by a client is refused (creator-only setting from #4436, members cannot)
  v_err := pg_temp.try_as('b', format($$UPDATE public.collaboration_sessions SET max_participants = 100 WHERE id = %L$$, v_s));
  PERFORM pg_temp.ok('X-SPLIT-CAP a member cannot raise the cap', v_err LIKE '42501:%');
  -- the link path honours the same cap
  PERFORM pg_temp.call_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('f13')));
  r := pg_temp.call_as('a', format($$SELECT public.get_or_create_group_link(%L)$$, v_conv));
  PERFORM pg_temp.try_as('a', format($$SELECT public.set_group_link_approval(%L, false)$$, v_conv));
  v_err := pg_temp.try_as('j', format($$SELECT public.join_group_by_link(%L, NULL)$$, r ->> 'token'));
  PERFORM pg_temp.ok('X-SPLIT-CAP a link join into a full group is refused', v_err LIKE 'PT409:conflict_group_full%' AND NOT pg_temp.accepted(v_s, 'j'));
END $split$;

-- X-SELF: self-targeting edge cases.
DO $self$
DECLARE v_s uuid := pg_temp.mk_group('self', ARRAY['a','b']); v_conv uuid; v_err text; r jsonb;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  r := pg_temp.call_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('a')));
  PERFORM pg_temp.ok('X-SELF adding yourself is skipped', r -> 'added' = '[]'::jsonb);
  PERFORM pg_temp.call_as('a', format($$SELECT public.set_group_admin(%L, %L, true)$$, v_conv, pg_temp.u('b')));
  r := pg_temp.call_as('b', format($$SELECT public.set_group_admin(%L, %L, false)$$, v_conv, pg_temp.u('b')));
  PERFORM pg_temp.ok('X-SELF a second admin may step down while the creator stays admin',
    (SELECT NOT is_admin FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('b')));
  v_err := pg_temp.try_as('a', format($$SELECT public.remove_group_member(%L, NULL)$$, v_conv));
  PERFORM pg_temp.ok('X-SELF a NULL target is invalid_input', v_err LIKE '22023:%');
END $self$;

-- X-DIRECT-WRITES: the #4436 row guards still hold for the old app's paths.
DO $direct$
DECLARE v_s uuid := pg_temp.mk_group('dw', ARRAY['a','b','c']); v_err text;
BEGIN
  v_err := pg_temp.try_as('b', format($$UPDATE public.session_participants SET is_admin = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('c')));
  PERFORM pg_temp.ok('X-DIRECT-WRITES a non-creator cannot write is_admin directly (refused or no row changed)',
    (v_err LIKE '42501:%' OR v_err = 'ok')
    AND (SELECT NOT COALESCE(is_admin, false) FROM public.session_participants WHERE session_id = v_s AND user_id = pg_temp.u('c')));
  v_err := pg_temp.try_as('a', format($$UPDATE public.session_participants SET is_admin = true WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('c')));
  PERFORM pg_temp.ok('X-DIRECT-WRITES the old app''s creator promote still works', v_err = 'ok');
  v_err := pg_temp.try_as('b', format($$DELETE FROM public.session_participants WHERE session_id = %L AND user_id = %L$$, v_s, pg_temp.u('b')));
  PERFORM pg_temp.ok('X-DIRECT-WRITES leaving by deleting your own row still works and keeps the group',
    v_err = 'ok' AND EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = v_s));
END $direct$;

-- X-PREFS: an added member's deck prefs are written by the server, not by the adder.
DO $prefs$
DECLARE v_s uuid := pg_temp.mk_group('pf', ARRAY['a']); v_conv uuid; v_err text;
BEGIN
  v_conv := pg_temp.conv_of(v_s);
  INSERT INTO public.preferences(profile_id, categories) VALUES (pg_temp.u('e'), ARRAY['nature']) ON CONFLICT (profile_id) DO UPDATE SET categories = EXCLUDED.categories;
  PERFORM pg_temp.call_as('a', format($$SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])$$, v_conv, pg_temp.u('e')));
  PERFORM pg_temp.ok('X-PREFS the added member''s prefs come from their own preferences',
    (SELECT participant_prefs -> pg_temp.u('e')::text -> 'categories' FROM public.collaboration_sessions WHERE id = v_s) = '["nature"]'::jsonb);
  v_err := pg_temp.try_as('a', format($$SELECT public.upsert_participant_prefs(%L, %L, '{"categories":["x"]}'::jsonb)$$, v_s, pg_temp.u('e')));
  PERFORM pg_temp.ok('X-PREFS the adder still cannot overwrite them', v_err LIKE '42501:%');
END $prefs$;

ROLLBACK;
