\set ON_ERROR_STOP on

-- #4435 Phase 0 characterization (CHANGE): today's reopen law for a removed
-- (hidden) 1:1 chat. Each assertion carries a `-- RULE:` tag; the build may
-- flip only a tagged assertion, only in the wave that implements it.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE k4(tag text PRIMARY KEY, id uuid NOT NULL);

CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS
  $f$ SELECT id FROM k4 WHERE tag = p_tag $f$;

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

CREATE FUNCTION pg_temp.hidden(p_conv uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT hidden_at IS NOT NULL FROM public.conversation_participant_lifecycle
                    WHERE conversation_id = p_conv AND user_id = pg_temp.u(p_tag)), false)
$f$;

CREATE FUNCTION pg_temp.act(p_tag text, p_conv uuid, p_action text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  SET LOCAL ROLE authenticated;
  PERFORM public.set_conversation_lifecycle(p_conv, p_action);
  RESET ROLE;
END $f$;

DO $fixture$
DECLARE v_tag text; v_id uuid; v_dm uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['me','peer'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'p0c4-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'p0c4-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k4 VALUES (v_tag, v_id);
  END LOOP;
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES
    (pg_temp.u('me'), pg_temp.u('peer'), 'accepted'), (pg_temp.u('peer'), pg_temp.u('me'), 'accepted');
  INSERT INTO public.conversations(type, linked_entity_type, created_by)
    VALUES ('direct', 'direct', pg_temp.u('me')) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, pg_temp.u('me')), (v_dm, pg_temp.u('peer'));
  INSERT INTO public.messages(conversation_id, sender_id, content, created_at)
    VALUES (v_dm, pg_temp.u('peer'), 'p0c4 first', now() - interval '1 hour');
  INSERT INTO k4 VALUES ('dm', v_dm);
END $fixture$;

-- RULE: REOPEN-own-send I hide the chat, then I send: it stays hidden for me.
DO $own$
DECLARE v_dm uuid := pg_temp.u('dm');
BEGIN
  PERFORM pg_temp.act('me', v_dm, 'hide');
  INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_dm, pg_temp.u('me'), 'p0c4 mine');
  PERFORM pg_temp.ok('REOPEN-own-send my own message keeps it hidden', pg_temp.hidden(v_dm, 'me'));
END $own$;

-- RULE: REOPEN-peer the peer sends: it comes back (stays true after the build).
DO $peer$
DECLARE v_dm uuid := pg_temp.u('dm');
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_dm, pg_temp.u('peer'), 'p0c4 theirs');
  PERFORM pg_temp.ok('REOPEN-peer the peer''s message brings it back', NOT pg_temp.hidden(v_dm, 'me'));
END $peer$;

-- RULE: REOPEN-archived archived and hidden, the peer sends: it stays hidden.
DO $arch$
DECLARE v_dm uuid := pg_temp.u('dm');
BEGIN
  PERFORM pg_temp.act('me', v_dm, 'archive');
  PERFORM pg_temp.act('me', v_dm, 'hide');
  INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (v_dm, pg_temp.u('peer'), 'p0c4 theirs archived');
  PERFORM pg_temp.ok('REOPEN-archived an archived and removed chat stays hidden', pg_temp.hidden(v_dm, 'me'));
  PERFORM pg_temp.ok('REOPEN-archived archive is untouched',
    (SELECT archived_at IS NOT NULL FROM public.conversation_participant_lifecycle WHERE conversation_id = v_dm AND user_id = pg_temp.u('me')));
END $arch$;

ROLLBACK;
