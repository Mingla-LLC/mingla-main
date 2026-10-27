\set ON_ERROR_STOP on

-- Issue #4114 Wave 4 retest — tester adversarial suite for chat attachment
-- ownership. Different angles from the implementor's O-01..O-04:
--
--   R-01  a view-once message's stored path must be EXACTLY the private-bucket
--         shape <conversation_id>/once/<uuid>.<ext> in its own conversation.
--         A path that only starts with "<conversation_id>/once/" but is not
--         that exact shape (a dot segment, a doubled slash, an encoded
--         character, upper-case hex, a trailing slash) is refused (23514).
--   R-02  the sender of a view-once message cannot change it afterwards into
--         something its checks would refuse: turning view_once off while the
--         path is in once/, turning view_once on for an ordinary path, or
--         repointing it at another sender's once/ object (all 23514).
--   R-03  brand team access is scoped to the event's OWN brand: a member of
--         another brand, an invited-but-unaccepted member and a removed member
--         of the event's brand read none of the event chat's attachments.
--   R-04  an object without an uploader (owner NULL) can be deleted by no
--         user, and a once/ object without an uploader is readable by none.
--
-- FAILS-ON-REVERT: R-01 fails until the trigger requires the exact shape for
-- a view-once path. Drop the brand join or the accepted/removed filters from
-- issue_4114_is_event_chat_team_member and R-03 fails; drop the once/ branch
-- of the trigger and R-02 fails.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114r_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114r_ids TO authenticated;
CREATE TEMP TABLE t4114r_names (tag text PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON t4114r_names TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.t4114r_as(p_tag text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := (SELECT id FROM t4114r_ids WHERE tag = p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
END $fn$;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_dm uuid;
  v_event_chat uuid;
  v_alice uuid;
  v_bob uuid;
  v_guest uuid;
  v_host_x uuid;
  v_host_y uuid;
  v_brand_x uuid := gen_random_uuid();
  v_brand_y uuid := gen_random_uuid();
  v_event_x uuid := gen_random_uuid();
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['alice', 'bob', 'guest', 'host_x', 'host_y',
                               'team_y', 'invited_x', 'removed_x'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114r-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114r-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114r_ids VALUES (v_tag, v_id);
  END LOOP;
  v_alice := (SELECT id FROM t4114r_ids WHERE tag = 'alice');
  v_bob := (SELECT id FROM t4114r_ids WHERE tag = 'bob');
  v_guest := (SELECT id FROM t4114r_ids WHERE tag = 'guest');
  v_host_x := (SELECT id FROM t4114r_ids WHERE tag = 'host_x');
  v_host_y := (SELECT id FROM t4114r_ids WHERE tag = 'host_y');

  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_alice) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    VALUES (v_dm, v_alice, now() - interval '1 day'), (v_dm, v_bob, now() - interval '1 day');
  INSERT INTO t4114r_ids VALUES ('dm', v_dm);

  -- Brand X owns the event; brand Y is someone else's brand. team_y is an
  -- accepted member of Y only; invited_x never accepted X; removed_x left X.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.creator_accounts(id) VALUES (v_host_x), (v_host_y);
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (v_brand_x, v_host_x, 'T4114R X', 't4114r-x-' || left(v_brand_x::text, 8)),
    (v_brand_y, v_host_y, 'T4114R Y', 't4114r-y-' || left(v_brand_y::text, 8));
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at, invited_at, removed_at) VALUES
    (v_brand_y, (SELECT id FROM t4114r_ids WHERE tag = 'team_y'), 'brand_admin', now(), now(), NULL),
    (v_brand_x, (SELECT id FROM t4114r_ids WHERE tag = 'invited_x'), 'brand_admin', NULL, now(), NULL),
    (v_brand_x, (SELECT id FROM t4114r_ids WHERE tag = 'removed_x'), 'brand_admin', now() - interval '2 days',
     now() - interval '2 days', now() - interval '1 day');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme)
    VALUES (v_event_x, v_brand_x, v_host_x, 'T4114R event', 't4114r-event-' || left(v_event_x::text, 8),
            'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
  INSERT INTO public.conversations(type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only)
    VALUES ('group', 'event', v_event_x, 'T4114R event', v_host_x, true, false)
    RETURNING id INTO v_event_chat;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    VALUES (v_event_chat, v_guest, now() - interval '1 day');
  SET LOCAL session_replication_role = origin;
  INSERT INTO t4114r_ids VALUES ('event_chat', v_event_chat);

  INSERT INTO t4114r_names VALUES
    ('alice_once',   v_dm || '/once/' || gen_random_uuid() || '.jpg'),
    ('bob_once',     v_dm || '/once/' || gen_random_uuid() || '.jpg'),
    ('bob_normal',   v_dm || '/' || gen_random_uuid() || '.jpg'),
    ('guest_normal', v_event_chat || '/' || gen_random_uuid() || '.jpg'),
    ('orphan_once',  v_dm || '/once/' || gen_random_uuid() || '.jpg'),
    ('orphan_plain', v_dm || '/' || gen_random_uuid() || '.jpg');

  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
    VALUES (v_dm, v_alice, 'Photo', 'image', (SELECT name FROM t4114r_names WHERE tag = 'alice_once'), true);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
    VALUES (v_dm, v_bob, 'Photo', 'image', (SELECT name FROM t4114r_names WHERE tag = 'bob_once'), true);
  INSERT INTO t4114r_ids SELECT 'msg_bob_once', id FROM public.messages
    WHERE file_url = (SELECT name FROM t4114r_names WHERE tag = 'bob_once');
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
    VALUES (v_dm, v_bob, 'Photo', 'image', (SELECT name FROM t4114r_names WHERE tag = 'bob_normal'));
  INSERT INTO t4114r_ids SELECT 'msg_bob_normal', id FROM public.messages
    WHERE file_url = (SELECT name FROM t4114r_names WHERE tag = 'bob_normal');
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
    VALUES (v_event_chat, v_guest, 'Photo', 'image', (SELECT name FROM t4114r_names WHERE tag = 'guest_normal'));

  INSERT INTO storage.objects(bucket_id, name, owner) VALUES
    ('message-attachments', (SELECT name FROM t4114r_names WHERE tag = 'alice_once'), v_alice),
    ('message-attachments', (SELECT name FROM t4114r_names WHERE tag = 'bob_once'), v_bob),
    ('message-attachments', (SELECT name FROM t4114r_names WHERE tag = 'bob_normal'), v_bob),
    ('message-attachments', (SELECT name FROM t4114r_names WHERE tag = 'guest_normal'), v_guest),
    ('message-attachments', (SELECT name FROM t4114r_names WHERE tag = 'orphan_once'), NULL),
    ('message-attachments', (SELECT name FROM t4114r_names WHERE tag = 'orphan_plain'), NULL);
END $fixture$;

-- R-01: bob, as himself, tries view-once paths that only look like his folder.
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114r_as('bob');
DO $r01$
DECLARE
  v_dm uuid := (SELECT id FROM t4114r_ids WHERE tag = 'dm');
  v_bob uuid := (SELECT id FROM t4114r_ids WHERE tag = 'bob');
  v_obj text := split_part((SELECT name FROM t4114r_names WHERE tag = 'alice_once'), '/', 3);
  v_paths text[] := ARRAY[
    v_dm || '/once/./' || v_obj,
    v_dm || '/once//' || v_obj,
    v_dm || '/once/' || replace(v_obj, '.jpg', '%2Ejpg'),
    v_dm || '/once/' || upper(split_part(v_obj, '.', 1)) || '.jpg',
    v_dm || '/once/' || v_obj || '/'
  ];
  v_path text;
  v_accepted text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_path IN ARRAY v_paths LOOP
    BEGIN
      INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
        VALUES (v_dm, v_bob, 'Photo', 'image', v_path, true);
      v_accepted := v_accepted || v_path;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  IF cardinality(v_accepted) > 0 THEN
    RAISE EXCEPTION 'R-01: % view-once path(s) not in the exact private-bucket shape were accepted: %',
      cardinality(v_accepted), v_accepted;
  END IF;
END $r01$;

-- R-02: bob changes his own view-once and ordinary messages afterwards.
DO $r02$
DECLARE
  v_once uuid := (SELECT id FROM t4114r_ids WHERE tag = 'msg_bob_once');
  v_plain uuid := (SELECT id FROM t4114r_ids WHERE tag = 'msg_bob_normal');
  v_refused integer := 0;
  v_rows integer;
BEGIN
  BEGIN
    UPDATE public.messages SET view_once = false WHERE id = v_once;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN v_refused := v_refused + 1; END IF;  -- no update right is also a refusal
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  BEGIN
    UPDATE public.messages SET view_once = true WHERE id = v_plain;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN v_refused := v_refused + 1; END IF;
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  BEGIN
    UPDATE public.messages SET file_url = (SELECT name FROM t4114r_names WHERE tag = 'alice_once')
     WHERE id = v_once;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN v_refused := v_refused + 1; END IF;
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  IF v_refused <> 3 THEN
    RAISE EXCEPTION 'R-02 (as bob): expected 3 refused changes, got %', v_refused;
  END IF;
END $r02$;
RESET ROLE;

-- R-02 again as the table owner, so the trigger (not a missing UPDATE right)
-- is what refuses.
DO $r02_trigger$
DECLARE
  v_once uuid := (SELECT id FROM t4114r_ids WHERE tag = 'msg_bob_once');
  v_plain uuid := (SELECT id FROM t4114r_ids WHERE tag = 'msg_bob_normal');
  v_refused integer := 0;
BEGIN
  BEGIN
    UPDATE public.messages SET view_once = false WHERE id = v_once;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  BEGIN
    UPDATE public.messages SET view_once = true WHERE id = v_plain;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  BEGIN
    UPDATE public.messages SET file_url = (SELECT name FROM t4114r_names WHERE tag = 'alice_once')
     WHERE id = v_once;
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  IF v_refused <> 3 THEN
    RAISE EXCEPTION 'R-02 (trigger): expected 3 refused changes, got %', v_refused;
  END IF;
END $r02_trigger$;

-- R-03: brand team scope.
SET LOCAL ROLE authenticated;
DO $r03$
DECLARE
  v_tag text;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['team_y', 'invited_x', 'removed_x'] LOOP
    PERFORM pg_temp.t4114r_as(v_tag);
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
               AND name IN (SELECT name FROM t4114r_names)) THEN
      RAISE EXCEPTION 'R-03: % must read none of the event chat''s attachments', v_tag;
    END IF;
  END LOOP;
END $r03$;
RESET ROLE;

DO $r03_functions$
DECLARE
  v_chat uuid := (SELECT id FROM t4114r_ids WHERE tag = 'event_chat');
  v_tag text;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['team_y', 'invited_x', 'removed_x'] LOOP
    IF public.issue_4114_is_event_chat_team_member(v_chat, (SELECT id FROM t4114r_ids WHERE tag = v_tag)) THEN
      RAISE EXCEPTION 'R-03: % is not on the event''s brand team', v_tag;
    END IF;
  END LOOP;
END $r03_functions$;

-- R-04: objects without an uploader.
DO $r04$
DECLARE
  v_tag text;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['alice', 'bob'] LOOP
    IF public.issue_4114_can_delete_chat_attachment((SELECT name FROM t4114r_names WHERE tag = 'orphan_plain'),
                                                    NULL, (SELECT id FROM t4114r_ids WHERE tag = v_tag))
       OR public.issue_4114_can_delete_chat_attachment((SELECT name FROM t4114r_names WHERE tag = 'orphan_once'),
                                                       NULL, (SELECT id FROM t4114r_ids WHERE tag = v_tag)) THEN
      RAISE EXCEPTION 'R-04: % must not delete an object with no uploader', v_tag;
    END IF;
    IF public.issue_4114_can_read_chat_attachment((SELECT name FROM t4114r_names WHERE tag = 'orphan_once'),
                                                  NULL, (SELECT id FROM t4114r_ids WHERE tag = v_tag)) THEN
      RAISE EXCEPTION 'R-04: % must not read a once/ object with no uploader', v_tag;
    END IF;
  END LOOP;
END $r04$;

SELECT 'issue_4114_chat_media_ownership tester adversarial: R-01..R-04 PASS' AS result;

ROLLBACK;
