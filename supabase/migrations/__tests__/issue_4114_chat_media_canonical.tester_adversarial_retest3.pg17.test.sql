\set ON_ERROR_STOP on

-- Issue #4114 Wave 4, tester retest 3 — attacks the canonical-path rework from
-- angles the implementor suite does not cover.
--
--   A-01  path fuzz on INSERT and UPDATE (ordinary and view-once): upper-case
--         hex in either uuid, an upper-case extension, a double extension, an
--         empty or missing extension, a 9-character extension, Unicode
--         lookalikes (Cyrillic a, full-width digit, division slash, full-width
--         dot), a trailing newline, a leading space, a backslash separator, an
--         upper-case ONCE folder, a doubled once folder, an un-hyphenated uuid
--         and a 10,000-character name are all refused (23514). A NUL byte can
--         never reach the column at all.
--   A-02  legacy URLs: http(s) in any letter case still pass for an ordinary
--         message on insert and update; a view-once message refuses them; other
--         schemes and protocol-relative names are refused.
--   A-03  issue_4114_chat_attachment_conversation returns NULL for every fuzz
--         name (it is the single shape authority the trigger, storage policies
--         and sweep share).
--   A-04  issue_4114_chat_attachment_owner: no EXECUTE for anon or
--         authenticated (and a call as either raises 42501); service_role can;
--         a planted object with a non-canonical name never has its owner
--         returned.
--   A-05  the sweep never lists a planted view-once row whose path is
--         upper-case, double-extension or in another conversation's folder,
--         nor an orphan object with a lookalike name.
--   A-06  server-owned send time does not get in the way of the server:
--         service_role and a no-claims (migration) session can still set and
--         change created_at, including on a view-once message.
--
-- FAILS-ON-REVERT: loosen the regex in issue_4114_chat_attachment_conversation
-- to case-insensitive (A-01 fails; dropping only the trigger's
-- "attachment_path_not_canonical" branch does not, because a NULL folder still
-- trips "attachment_path_outside_conversation"), treat every caller as a
-- client in the trigger's created_at gate (A-06 fails),
-- re-grant the owner function to authenticated (A-04 fails), or drop the
-- canonical filter in the due listing (A-05 fails).
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114x_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114x_ids TO authenticated, anon, service_role;

CREATE TEMP TABLE t4114x_fuzz (name text NOT NULL);
GRANT SELECT ON t4114x_fuzz TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION pg_temp.t4114x_as(p_tag text, p_role text DEFAULT 'authenticated') RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := (SELECT id FROM t4114x_ids WHERE tag = p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_id::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', p_role)::text, true);
END $fn$;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_dm uuid;
  v_other uuid;
  v_ana uuid;
  v_obj text := gen_random_uuid()::text;
  v_base text;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['ana', 'ben'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114x-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114x-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114x_ids VALUES (v_tag, v_id);
  END LOOP;
  v_ana := (SELECT id FROM t4114x_ids WHERE tag = 'ana');
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_ana) RETURNING id INTO v_dm;
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_ana) RETURNING id INTO v_other;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_dm, id, now() - interval '30 days' FROM t4114x_ids;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_other, id, now() - interval '30 days' FROM t4114x_ids;
  INSERT INTO t4114x_ids VALUES ('dm', v_dm), ('other', v_other);

  v_base := v_dm::text;
  INSERT INTO t4114x_fuzz(name) VALUES
    (upper(v_base) || '/' || v_obj || '.jpg'),
    (v_base || '/' || upper(v_obj) || '.jpg'),
    (v_base || '/' || v_obj || '.JPG'),
    (v_base || '/' || v_obj || '.jpg.exe'),
    (v_base || '/' || v_obj || '.'),
    (v_base || '/' || v_obj),
    (v_base || '/' || v_obj || '.abcdefghi'),
    (v_base || '/' || translate(v_obj, 'a', U&'\0430') || '.jpg'),
    (v_base || '/' || v_obj || U&'.jp\FF10'),
    (v_base || U&'\2215' || v_obj || '.jpg'),
    (v_base || '/' || v_obj || U&'\FF0Ejpg'),
    (v_base || '/' || v_obj || '.jpg' || E'\n'),
    (' ' || v_base || '/' || v_obj || '.jpg'),
    (v_base || E'\\' || v_obj || '.jpg'),
    (v_base || '/ONCE/' || v_obj || '.jpg'),
    (v_base || '/once/once/' || v_obj || '.jpg'),
    (replace(v_base, '-', '') || '/' || v_obj || '.jpg'),
    (v_base || '/' || v_obj || '.' || repeat('a', 10000)),
    (v_base || '/' || repeat(v_obj, 300) || '.jpg');
END $fixture$;

-- A-01 / A-02 as ana (a client).
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114x_as('ana');

DO $a01$
DECLARE
  v_dm uuid := (SELECT id FROM t4114x_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114x_ids WHERE tag = 'ana');
  v_name text;
  v_once text;
  v_accepted text[] := ARRAY[]::text[];
  v_plain uuid;
  v_nul_refused boolean := false;
BEGIN
  FOR v_name IN SELECT name FROM t4114x_fuzz LOOP
    BEGIN
      INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
        VALUES (v_dm, v_ana, 'Photo', 'image', v_name);
      v_accepted := v_accepted || ('insert:' || left(v_name, 80));
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    -- The same name in the once/ folder for a view-once message (first '/' only,
    -- so a name with no real separator stays separator-less).
    v_once := regexp_replace(v_name, '/', '/once/');
    BEGIN
      INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
        VALUES (v_dm, v_ana, 'Photo', 'image', v_once, true);
      v_accepted := v_accepted || ('once:' || left(v_once, 80));
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  -- UPDATE: a canonical message cannot be moved onto any fuzz name.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/' || gen_random_uuid() || '.jpg')
    RETURNING id INTO v_plain;
  FOR v_name IN SELECT name FROM t4114x_fuzz LOOP
    BEGIN
      UPDATE public.messages SET file_url = v_name WHERE id = v_plain;
      v_accepted := v_accepted || ('update:' || left(v_name, 80));
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  IF cardinality(v_accepted) > 0 THEN
    RAISE EXCEPTION 'A-01: non-canonical names accepted: %', v_accepted;
  END IF;

  -- A NUL byte cannot be stored in text at all.
  BEGIN
    PERFORM v_dm || '/' || gen_random_uuid() || '.jpg' || chr(0);
  EXCEPTION WHEN OTHERS THEN v_nul_refused := true;
  END;
  IF NOT v_nul_refused THEN
    RAISE EXCEPTION 'A-01: a NUL byte reached a text value';
  END IF;
END $a01$;

DO $a02$
DECLARE
  v_dm uuid := (SELECT id FROM t4114x_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114x_ids WHERE tag = 'ana');
  v_id uuid;
  v_url text;
  v_bad text;
  v_accepted text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_url IN ARRAY ARRAY[
    'https://example.supabase.co/storage/v1/object/public/messages/' || v_dm || '/a.jpg',
    'HTTPS://example.supabase.co/storage/v1/object/public/messages/' || v_dm || '/b.JPG',
    'http://example.test/x/y/z.png'
  ] LOOP
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
      VALUES (v_dm, v_ana, 'Photo', 'image', v_url) RETURNING id INTO v_id;
    UPDATE public.messages SET file_url = v_url || '?v=2' WHERE id = v_id;
    BEGIN
      INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
        VALUES (v_dm, v_ana, 'Photo', 'image', v_url, true);
      v_accepted := v_accepted || ('view-once url:' || v_url);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  FOREACH v_bad IN ARRAY ARRAY[
    'ftp://example.test/' || v_dm || '/' || gen_random_uuid() || '.jpg',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    '//example.test/' || v_dm || '/' || gen_random_uuid() || '.jpg',
    'https:/' || v_dm || '/' || gen_random_uuid() || '.jpg'
  ] LOOP
    BEGIN
      INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
        VALUES (v_dm, v_ana, 'Photo', 'image', v_bad);
      v_accepted := v_accepted || ('scheme:' || v_bad);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  IF cardinality(v_accepted) > 0 THEN
    RAISE EXCEPTION 'A-02: accepted: %', v_accepted;
  END IF;
END $a02$;

-- A-04 (client half): neither authenticated nor anon may call the owner lookup.
DO $a04_client$
DECLARE v_refused integer := 0;
BEGIN
  BEGIN
    PERFORM public.issue_4114_chat_attachment_owner((SELECT id FROM t4114x_ids WHERE tag = 'dm') || '/' || gen_random_uuid() || '.jpg');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  IF v_refused <> 1 THEN
    RAISE EXCEPTION 'A-04: authenticated reached issue_4114_chat_attachment_owner';
  END IF;
END $a04_client$;
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.t4114x_as('ana', 'anon');
DO $a04_anon$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    PERFORM public.issue_4114_chat_attachment_owner('x');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A-04: anon reached issue_4114_chat_attachment_owner';
  END IF;
END $a04_anon$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true), set_config('request.jwt.claims', '', true),
       set_config('request.jwt.claim.sub', '', true);

DO $a03_a04$
DECLARE
  v_dm uuid := (SELECT id FROM t4114x_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114x_ids WHERE tag = 'ana');
  v_name text;
  v_leaks text[] := ARRAY[]::text[];
  v_proname text := 'public.issue_4114_chat_attachment_owner(text)';
BEGIN
  IF has_function_privilege('anon', v_proname, 'EXECUTE')
     OR has_function_privilege('authenticated', v_proname, 'EXECUTE')
     OR has_function_privilege('public', v_proname, 'EXECUTE') THEN
    RAISE EXCEPTION 'A-04: the owner lookup is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', v_proname, 'EXECUTE') THEN
    RAISE EXCEPTION 'A-04: service_role must be able to call the owner lookup';
  END IF;

  FOR v_name IN SELECT name FROM t4114x_fuzz LOOP
    IF public.issue_4114_chat_attachment_conversation(v_name) IS NOT NULL THEN
      v_leaks := v_leaks || ('shape:' || left(v_name, 80));
    END IF;
    -- Plant the object directly (as if uploaded by some other path) and confirm
    -- its owner is never returned for a non-canonical name.
    INSERT INTO storage.objects(bucket_id, name, owner, created_at)
      VALUES ('message-attachments', v_name, v_ana, now() - interval '5 days')
      ON CONFLICT DO NOTHING;
    IF public.issue_4114_chat_attachment_owner(v_name) IS NOT NULL THEN
      v_leaks := v_leaks || ('owner:' || left(v_name, 80));
    END IF;
  END LOOP;
  IF cardinality(v_leaks) > 0 THEN
    RAISE EXCEPTION 'A-03/A-04: fuzz names treated as canonical: %', v_leaks;
  END IF;
END $a03_a04$;

-- A-05: planted rows and objects around the guards are never listed.
DO $a05$
DECLARE
  v_dm uuid := (SELECT id FROM t4114x_ids WHERE tag = 'dm');
  v_other uuid := (SELECT id FROM t4114x_ids WHERE tag = 'other');
  v_ana uuid := (SELECT id FROM t4114x_ids WHERE tag = 'ana');
  v_obj text := gen_random_uuid()::text;
  v_planted text[] := ARRAY[
    upper(v_dm::text) || '/once/' || v_obj || '.jpg',
    v_dm || '/once/' || v_obj || '.jpg.exe',
    v_other || '/once/' || v_obj || '.jpg'
  ];
  v_path text;
  v_listed text[];
  v_hit text[] := ARRAY[]::text[];
BEGIN
  SET LOCAL session_replication_role = replica;
  FOREACH v_path IN ARRAY v_planted LOOP
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, created_at)
      VALUES (v_dm, v_ana, 'Photo', 'image', v_path, true, now() - interval '20 days');
  END LOOP;
  SET LOCAL session_replication_role = origin;

  SELECT array_agg(d.storage_path) INTO v_listed FROM public.issue_4114_view_once_media_due(1000) d;
  v_listed := COALESCE(v_listed, ARRAY[]::text[]);
  FOREACH v_path IN ARRAY v_planted LOOP
    IF v_path = ANY(v_listed) THEN v_hit := v_hit || v_path; END IF;
  END LOOP;
  FOR v_path IN SELECT name FROM t4114x_fuzz LOOP
    IF v_path = ANY(v_listed) THEN v_hit := v_hit || left(v_path, 80); END IF;
  END LOOP;
  IF cardinality(v_hit) > 0 THEN
    RAISE EXCEPTION 'A-05: non-canonical paths listed for deletion: %', v_hit;
  END IF;
END $a05$;

-- A-06: the server keeps control of created_at.
DO $a06_postgres$
DECLARE
  v_dm uuid := (SELECT id FROM t4114x_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114x_ids WHERE tag = 'ana');
  v_id uuid;
  v_at timestamptz;
BEGIN
  -- A migration / seed session (no JWT claims) inserts with its own time and changes it.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, created_at)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/once/' || gen_random_uuid() || '.jpg', true, '2026-01-02T03:04:05Z')
    RETURNING id, created_at INTO v_id, v_at;
  IF v_at <> '2026-01-02T03:04:05Z'::timestamptz THEN
    RAISE EXCEPTION 'A-06: a no-claims insert lost its created_at (%)', v_at;
  END IF;
  UPDATE public.messages SET created_at = '2026-02-02T00:00:00Z' WHERE id = v_id;
  INSERT INTO t4114x_ids VALUES ('seeded', v_id);
END $a06_postgres$;

-- The trigger keys on the JWT role; the session stays the owner so RLS does
-- not depend on whether the harness gives service_role BYPASSRLS.
SELECT set_config('request.jwt.claim.role', 'service_role', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $a06_service$
DECLARE
  v_dm uuid := (SELECT id FROM t4114x_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114x_ids WHERE tag = 'ana');
  v_id uuid;
  v_at timestamptz;
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once, created_at)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/once/' || gen_random_uuid() || '.jpg', true, '2026-03-03T00:00:00Z')
    RETURNING id, created_at INTO v_id, v_at;
  IF v_at <> '2026-03-03T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'A-06: a service_role insert lost its created_at (%)', v_at;
  END IF;
  UPDATE public.messages SET created_at = '2026-04-04T00:00:00Z'
   WHERE id = (SELECT id FROM t4114x_ids WHERE tag = 'seeded');
  UPDATE public.messages SET created_at = '2026-05-05T00:00:00Z' WHERE id = v_id;
END $a06_service$;

SELECT 'issue_4114_chat_media_canonical tester adversarial retest 3: A-01..A-06 PASS' AS result;

ROLLBACK;
