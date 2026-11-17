\set ON_ERROR_STOP on

-- #4456 tester adversarial suite (20280721004456). Independent of the
-- implementor suite: it reads the catalog instead of sampling columns, checks
-- the trigger order the tombstone depends on, forges the unsend-kind setting,
-- and checks every read path and the file rule as a matrix. Everything rolls
-- back.
--
-- FAILS-ON-REVERT: restore the table-wide UPDATE/DELETE grant on messages
-- (T-COLS), drop or rename issue_4456_tombstone (T-ORDER, T-READ), restore
-- the 20271230064114 body of issue_4114_can_read_chat_attachment (T-FILES), or
-- let a server write bring a tombstone back (T-FINAL-SERVER).
--
-- MINGLA-INVARIANT: I-4456-CLIENT-WRITE-CATALOG | issue #4456 | every messages column except deleted_at, updated_at, is_read and read_at is closed to UPDATE for anon and authenticated, and DELETE is closed, checked from the catalog so a new column is covered too

BEGIN;

DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

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
-- Runs p_sql as the signed-in p_tag; returns 'ok' or the SQLSTATE and message.
CREATE FUNCTION pg_temp.try_as(p_tag text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(p_tag);
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql;
    PERFORM set_config('role', 'postgres', true);
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN v_state || ' ' || v_msg;
  END;
END $f$;
-- unsend_messages as p_tag; returns the result or the SQLSTATE and message.
CREATE FUNCTION pg_temp.unsend(p_tag text, p_ids uuid[]) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v_state text; v_msg text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(p_tag);
    PERFORM set_config('role', 'authenticated', true);
    r := public.unsend_messages(p_ids);
    PERFORM set_config('role', 'postgres', true);
    RETURN r::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN v_state || ' ' || v_msg;
  END;
END $f$;
-- Message contents p_tag can read in p_conv under the read rules.
CREATE FUNCTION pg_temp.visible_ids(p_tag text, p_conv uuid) RETURNS uuid[] LANGUAGE plpgsql AS $f$
DECLARE r uuid[];
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO r FROM public.messages WHERE conversation_id = p_conv;
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
CREATE FUNCTION pg_temp.can_read(p_tag text, p_path text, p_owner text) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE r boolean;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  r := public.issue_4114_can_read_chat_attachment(p_path, pg_temp.u(p_owner), pg_temp.u(p_tag));
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $f$;
CREATE FUNCTION pg_temp.scrubbed(p_id uuid) RETURNS boolean LANGUAGE sql AS $f$
  SELECT m.content = '' AND m.file_url IS NULL AND m.thumb_path IS NULL AND m.file_name IS NULL
     AND m.file_size IS NULL AND m.card_payload IS NULL AND m.card_tags = '[]'::jsonb
     AND m.mentions = '[]'::jsonb AND m.media_width IS NULL AND m.media_height IS NULL
     AND m.media_duration_ms IS NULL AND m.deleted_at IS NOT NULL AND m.unsent_at IS NOT NULL
  FROM public.messages m WHERE m.id = p_id
$f$;
CREATE FUNCTION pg_temp.msg(p_tag text, p_conv text, p_sender text, p_content text,
  p_type text DEFAULT 'text', p_file text DEFAULT NULL, p_thumb text DEFAULT NULL,
  p_once boolean DEFAULT false, p_card jsonb DEFAULT NULL, p_age interval DEFAULT interval '1 hour',
  p_album uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  PERFORM pg_temp.as_server();
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, thumb_path,
      view_once, card_payload, created_at, media_width, media_height, media_album_id, mentions)
    VALUES (pg_temp.u(p_conv), pg_temp.u(p_sender), p_content, p_type, p_file, p_thumb,
      p_once, p_card, now() - p_age,
      CASE WHEN p_type IN ('image', 'video') AND NOT p_once THEN 800 END,
      CASE WHEN p_type IN ('image', 'video') AND NOT p_once THEN 600 END,
      p_album, '["x"]'::jsonb)
    RETURNING id INTO v;
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;


DO $fixture$
DECLARE v_tag text; v_id uuid; v_dm uuid; v_g uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['ana','ben','eve'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4456-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 't4456-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k VALUES (v_tag, v_id);
  END LOOP;
  INSERT INTO public.conversations(type, linked_entity_type, created_by) VALUES ('direct', 'direct', pg_temp.u('ana')) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, pg_temp.u('ana')), (v_dm, pg_temp.u('ben'));
  INSERT INTO k VALUES ('dm', v_dm);
END $fixture$;

-- T-COLS: from the catalog, not a sample.
DO $cols$
DECLARE c record; v_open text[] := ARRAY[]::text[];
BEGIN
  FOR c IN SELECT attname FROM pg_attribute WHERE attrelid = 'public.messages'::regclass AND attnum > 0 AND NOT attisdropped LOOP
    IF c.attname NOT IN ('deleted_at', 'updated_at', 'is_read', 'read_at')
       AND (has_column_privilege('authenticated', 'public.messages', c.attname, 'UPDATE')
            OR has_column_privilege('anon', 'public.messages', c.attname, 'UPDATE')) THEN
      v_open := v_open || c.attname::text;
    END IF;
  END LOOP;
  PERFORM pg_temp.ok('T-COLS no other column is client-writable (' || array_to_string(v_open, ',') || ')', cardinality(v_open) = 0);
  PERFORM pg_temp.ok('T-COLS no client DELETE or TRUNCATE',
    NOT has_table_privilege('authenticated', 'public.messages', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.messages', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.messages', 'TRUNCATE'));
  PERFORM pg_temp.ok('T-COLS the unsend write stays open (live 1.2.0 OTA path)',
    has_column_privilege('authenticated', 'public.messages', 'deleted_at', 'UPDATE'));
END $cols$;

-- T-ORDER: the tombstone runs after the view-once shape check and before the
-- plan guard and the updated_at stamp (triggers fire in name order).
DO $order$
DECLARE v text[];
BEGIN
  SELECT array_agg(tgname::text ORDER BY tgname) INTO v FROM pg_trigger
   WHERE tgrelid = 'public.messages'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
     AND (tgtype & 2) = 2 AND (tgtype & 16) = 16;  -- BEFORE ... UPDATE
  PERFORM pg_temp.ok('T-ORDER tombstone present and enabled', 'issue_4456_tombstone' = ANY (v));
  PERFORM pg_temp.ok('T-ORDER after the view-once shape check',
    array_position(v, 'issue_4114_view_once_shape') < array_position(v, 'issue_4456_tombstone'));
  PERFORM pg_temp.ok('T-ORDER before the plan guard',
    array_position(v, 'issue_4456_tombstone') < array_position(v, 'tg_4261_guard_plan_messages'));
END $order$;

-- T-GUC: a client that forges the unsend-kind setting cannot choose a hidden
-- kind (making its placeholder vanish) or claim admin on its own message.
DO $guc$
DECLARE v_m uuid; v_n uuid; r text;
BEGIN
  v_m := pg_temp.msg('g1', 'dm', 'ben', 'ben writes');
  PERFORM set_config('issue_4456.unsend_kind', 'legacy', true);
  r := pg_temp.try_as('ben', format('UPDATE public.messages SET deleted_at = now() WHERE id = %L', v_m));
  PERFORM set_config('issue_4456.unsend_kind', '', true);
  PERFORM pg_temp.ok('T-GUC forged legacy kind is ignored (' || r || ')',
    (SELECT unsent_kind = 'sender' AND content = '' FROM public.messages WHERE id = v_m));
  v_n := pg_temp.msg('g2', 'dm', 'ben', 'ben again');
  PERFORM set_config('issue_4456.unsend_kind', 'admin', true);
  r := pg_temp.try_as('ben', format('UPDATE public.messages SET deleted_at = now() WHERE id = %L', v_n));
  PERFORM set_config('issue_4456.unsend_kind', '', true);
  PERFORM pg_temp.ok('T-GUC forged admin kind on a 1:1 is refused (' || r || ')',
    r LIKE '42501%' AND (SELECT deleted_at IS NULL FROM public.messages WHERE id = v_n));
END $guc$;

-- T-READ: every client read path returns a wiped tombstone.
DO $reads$
DECLARE v_m uuid; v_c text; v_n integer;
BEGIN
  v_m := pg_temp.msg('r1', 'dm', 'ana', 'nobody should read this again');
  PERFORM pg_temp.unsend('ana', ARRAY[v_m]);
  PERFORM pg_temp.as_user('ben');
  PERFORM set_config('role', 'authenticated', true);
  SELECT content INTO v_c FROM public.messages WHERE id = v_m AND (deleted_at IS NULL OR unsent_kind IN ('sender', 'admin'));
  SELECT count(*) INTO v_n FROM public.messages
   WHERE id = v_m AND (content LIKE '%nobody%' OR file_url IS NOT NULL OR card_payload IS NOT NULL OR mentions <> '[]'::jsonb);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('T-READ new read filter returns the empty placeholder', v_c = '');
  PERFORM pg_temp.ok('T-READ no column still carries the original', v_n = 0);
  PERFORM pg_temp.ok('T-READ the original is only in the private store',
    (SELECT original ->> 'content' FROM public.message_unsend_evidence WHERE message_id = v_m) = 'nobody should read this again');
END $reads$;

-- T-FILES: the read rule as a matrix, and no collateral on another live file.
DO $files$
DECLARE
  v_dm uuid := pg_temp.u('dm');
  v_a text := pg_temp.u('dm') || '/' || gen_random_uuid() || '.jpg';
  v_b text := pg_temp.u('dm') || '/' || gen_random_uuid() || '.jpg';
  v_pa uuid; v_pb uuid;
BEGIN
  v_pa := pg_temp.msg('fa', 'dm', 'ana', '', 'image', v_a);
  v_pb := pg_temp.msg('fb', 'dm', 'ana', '', 'image', v_b);
  PERFORM pg_temp.ok('T-FILES live: member reads', pg_temp.can_read('ben', v_a, 'ana'));
  PERFORM pg_temp.ok('T-FILES live: owner reads', pg_temp.can_read('ana', v_a, 'ana'));
  PERFORM pg_temp.ok('T-FILES live: outsider cannot', NOT pg_temp.can_read('eve', v_a, 'ana'));
  -- Delete for me is not an unsend: the file stays readable to the hider.
  PERFORM pg_temp.as_user('ben');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.hide_messages_for_me(ARRAY[v_pa]);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('T-FILES hidden for me: still a live message', pg_temp.can_read('ben', v_a, 'ana'));
  PERFORM pg_temp.unsend('ana', ARRAY[v_pa]);
  PERFORM pg_temp.ok('T-FILES unsent: member cannot', NOT pg_temp.can_read('ben', v_a, 'ana'));
  PERFORM pg_temp.ok('T-FILES unsent: owner cannot', NOT pg_temp.can_read('ana', v_a, 'ana'));
  PERFORM pg_temp.ok('T-FILES unsent: outsider cannot', NOT pg_temp.can_read('eve', v_a, 'ana'));
  PERFORM pg_temp.ok('T-FILES the other live photo is untouched', pg_temp.can_read('ben', v_b, 'ana'));
END $files$;

-- T-FINAL-SERVER: not even the server brings a tombstone back.
DO $final$
DECLARE v_m uuid; v_state text;
BEGIN
  v_m := pg_temp.msg('f1', 'dm', 'ana', 'gone for good');
  PERFORM pg_temp.unsend('ana', ARRAY[v_m]);
  PERFORM pg_temp.as_server();
  BEGIN
    UPDATE public.messages SET deleted_at = NULL WHERE id = v_m;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  PERFORM pg_temp.ok('T-FINAL-SERVER server restore refused (' || v_state || ')', v_state = '23514');
  UPDATE public.messages SET content = 'put back', unsent_kind = 'legacy' WHERE id = v_m;
  PERFORM pg_temp.ok('T-FINAL-SERVER server rewrite cannot refill or rekind',
    (SELECT content = '' AND unsent_kind = 'sender' FROM public.messages WHERE id = v_m));
END $final$;

ROLLBACK;
