\set ON_ERROR_STOP on

-- Issue #4114 Wave 4 rework — chat attachment access is keyed on the uploader,
-- and the brand team of an event chat can show its guests' media.
--
--   O-01  message paths: a participant cannot point an ordinary message (insert
--         or update) into a once/ folder, cannot reuse a path another sender's
--         message already holds (ordinary or view once), and cannot point a
--         message at another conversation's folder (all 23514).
--   O-02  even if such a row existed, a participant who did not upload a once/
--         object can neither read nor delete it; the uploader still can.
--   O-03  a brand team member of an event chat reads a guest's ordinary
--         attachment, never a once/ one, never one whose message was unsent,
--         and can delete nothing.
--   O-04  a signed-in user outside the chat and outside the brand team reads
--         neither.
--
-- FAILS-ON-REVERT: drop the once/ and path-reuse branches from
-- issue_4114_enforce_view_once_shape and O-01 fails; key read on "a message by
-- me points at it" again and O-02 fails; drop the brand team branch from
-- issue_4114_can_read_chat_attachment and O-03 fails.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114o_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114o_ids TO authenticated;
CREATE TEMP TABLE t4114o_names (tag text PRIMARY KEY, name text NOT NULL);
GRANT SELECT ON t4114o_names TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.t4114o_as(p_tag text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := (SELECT id FROM t4114o_ids WHERE tag = p_tag);
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
  v_other uuid;
  v_event_chat uuid;
  v_alice uuid;
  v_bob uuid;
  v_guest uuid;
  v_host uuid;
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['alice', 'bob', 'guest', 'host', 'teammate', 'stranger'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114o-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114o-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114o_ids VALUES (v_tag, v_id);
  END LOOP;
  v_alice := (SELECT id FROM t4114o_ids WHERE tag = 'alice');
  v_bob := (SELECT id FROM t4114o_ids WHERE tag = 'bob');
  v_guest := (SELECT id FROM t4114o_ids WHERE tag = 'guest');
  v_host := (SELECT id FROM t4114o_ids WHERE tag = 'host');

  -- A 1:1 chat between alice and bob, and a chat bob is not in.
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_alice) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    VALUES (v_dm, v_alice, now() - interval '1 day'), (v_dm, v_bob, now() - interval '1 day');
  INSERT INTO t4114o_ids VALUES ('dm', v_dm);
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_alice) RETURNING id INTO v_other;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    VALUES (v_other, v_alice, now() - interval '1 day'), (v_other, v_guest, now() - interval '1 day');
  INSERT INTO t4114o_ids VALUES ('other', v_other);

  -- An event chat: the host's brand, a teammate on its team, one guest (the
  -- event chat adds buyers as participants; the brand team is not added).
  -- Replica mode keeps the event's own chat-creating trigger out of the way so
  -- the chat below is the only one.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(id, account_id, name, slug)
    VALUES (v_brand, v_host, 'T4114 ownership', 't4114-ownership-' || left(v_brand::text, 8));
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at, invited_at)
    VALUES (v_brand, (SELECT id FROM t4114o_ids WHERE tag = 'teammate'), 'brand_admin', now(), now());
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme)
    VALUES (v_event, v_brand, v_host, 'T4114 event', 't4114-ownership-event-' || left(v_event::text, 8),
            'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
  INSERT INTO public.conversations(type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only)
    VALUES ('group', 'event', v_event, 'T4114 event', v_host, true, false)
    RETURNING id INTO v_event_chat;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    VALUES (v_event_chat, v_guest, now() - interval '1 day');
  SET LOCAL session_replication_role = origin;
  INSERT INTO t4114o_ids VALUES ('event_chat', v_event_chat);

  INSERT INTO t4114o_names VALUES
    ('alice_once',    v_dm || '/once/' || gen_random_uuid() || '.jpg'),
    ('alice_normal',  v_dm || '/' || gen_random_uuid() || '.jpg'),
    ('bob_fresh',     v_dm || '/' || gen_random_uuid() || '.jpg'),
    ('guest_normal',  v_event_chat || '/' || gen_random_uuid() || '.jpg'),
    ('guest_once',    v_event_chat || '/once/' || gen_random_uuid() || '.jpg'),
    ('guest_unsent',  v_event_chat || '/' || gen_random_uuid() || '.jpg');

  -- Alice's own uploads and messages.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
    VALUES (v_dm, v_alice, 'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'alice_once'), true);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
    VALUES (v_dm, v_alice, 'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'alice_normal'));
  -- Bob's own ordinary photo (O-01 tries to repoint it).
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
    VALUES (v_dm, v_bob, 'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'bob_fresh'));
  INSERT INTO t4114o_ids SELECT 'msg_bob_fresh', id FROM public.messages
    WHERE file_url = (SELECT name FROM t4114o_names WHERE tag = 'bob_fresh');
  -- The guest's event chat media.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
    VALUES (v_event_chat, v_guest, 'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'guest_normal'));
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
    VALUES (v_event_chat, v_guest, 'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'guest_once'), true);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, deleted_at)
    VALUES (v_event_chat, v_guest, 'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'guest_unsent'), now());

  INSERT INTO storage.objects(bucket_id, name, owner)
  VALUES
    ('message-attachments', (SELECT name FROM t4114o_names WHERE tag = 'alice_once'), v_alice),
    ('message-attachments', (SELECT name FROM t4114o_names WHERE tag = 'alice_normal'), v_alice),
    ('message-attachments', (SELECT name FROM t4114o_names WHERE tag = 'bob_fresh'), v_bob),
    ('message-attachments', (SELECT name FROM t4114o_names WHERE tag = 'guest_normal'), v_guest),
    ('message-attachments', (SELECT name FROM t4114o_names WHERE tag = 'guest_once'), v_guest),
    ('message-attachments', (SELECT name FROM t4114o_names WHERE tag = 'guest_unsent'), v_guest);
END $fixture$;

-- O-01 message paths, written by bob as himself.
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114o_as('bob');
DO $o01_insert$
DECLARE
  v_dm uuid := (SELECT id FROM t4114o_ids WHERE tag = 'dm');
  v_bob uuid := (SELECT id FROM t4114o_ids WHERE tag = 'bob');
  v_refused integer := 0;
BEGIN
  -- An ordinary message pointing at alice's view-once object.
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
      VALUES (v_dm, v_bob, 'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'alice_once'));
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  -- A view-once message reusing alice's view-once path.
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, view_once)
      VALUES (v_dm, v_bob, 'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'alice_once'), true);
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  -- An ordinary message reusing alice's ordinary path.
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
      VALUES (v_dm, v_bob, 'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'alice_normal'));
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  -- A message in bob's chat pointing into another conversation's folder.
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
      VALUES (v_dm, v_bob, 'Photo', 'image',
              (SELECT id FROM t4114o_ids WHERE tag = 'other') || '/' || gen_random_uuid() || '.jpg');
  EXCEPTION WHEN check_violation THEN v_refused := v_refused + 1;
  END;
  IF v_refused <> 4 THEN
    RAISE EXCEPTION 'O-01: expected 4 refused message paths from bob, got %', v_refused;
  END IF;
END $o01_insert$;
RESET ROLE;

-- The same guard holds when an existing ordinary message is repointed.
DO $o01_update$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    UPDATE public.messages
       SET file_url = (SELECT name FROM t4114o_names WHERE tag = 'alice_once')
     WHERE id = (SELECT id FROM t4114o_ids WHERE tag = 'msg_bob_fresh');
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'O-01: repointing an ordinary message at a once/ object must be refused';
  END IF;
END $o01_update$;

-- O-02: plant the row the guard refuses (replica mode skips the trigger) and
-- show storage still refuses bob, because access follows the uploader.
SET LOCAL session_replication_role = replica;
INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url)
  VALUES ((SELECT id FROM t4114o_ids WHERE tag = 'dm'), (SELECT id FROM t4114o_ids WHERE tag = 'bob'),
          'Photo', 'image', (SELECT name FROM t4114o_names WHERE tag = 'alice_once'));
SET LOCAL session_replication_role = origin;

DO $o02_functions$
DECLARE
  v_name text := (SELECT name FROM t4114o_names WHERE tag = 'alice_once');
  v_owner uuid := (SELECT owner FROM storage.objects WHERE bucket_id = 'message-attachments' AND name = (SELECT name FROM t4114o_names WHERE tag = 'alice_once'));
  v_alice uuid := (SELECT id FROM t4114o_ids WHERE tag = 'alice');
  v_bob uuid := (SELECT id FROM t4114o_ids WHERE tag = 'bob');
BEGIN
  IF public.issue_4114_can_read_chat_attachment(v_name, v_owner, v_bob) THEN
    RAISE EXCEPTION 'O-02: bob must not read alice''s view-once object';
  END IF;
  IF public.issue_4114_can_delete_chat_attachment(v_name, v_owner, v_bob) THEN
    RAISE EXCEPTION 'O-02: bob must not delete alice''s view-once object';
  END IF;
  IF NOT public.issue_4114_can_read_chat_attachment(v_name, v_owner, v_alice)
     OR NOT public.issue_4114_can_delete_chat_attachment(v_name, v_owner, v_alice) THEN
    RAISE EXCEPTION 'O-02: the uploader must still read and delete her own object';
  END IF;
END $o02_functions$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114o_as('bob');
DO $o02_bob$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
             AND name = (SELECT name FROM t4114o_names WHERE tag = 'alice_once')) THEN
    RAISE EXCEPTION 'O-02: bob must not SELECT alice''s view-once object';
  END IF;
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'message-attachments'
      AND name IN (SELECT name FROM t4114o_names WHERE tag IN ('alice_once', 'alice_normal'));
  EXCEPTION WHEN OTHERS THEN
    -- Some storage builds refuse SQL deletes outright; the check below is what counts.
    NULL;
  END;
END $o02_bob$;
RESET ROLE;

DO $o02_survives$
BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'message-attachments'
      AND name IN (SELECT name FROM t4114o_names WHERE tag IN ('alice_once', 'alice_normal'))) <> 2 THEN
    RAISE EXCEPTION 'O-02: bob''s delete must not remove alice''s objects';
  END IF;
END $o02_survives$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114o_as('alice');
DO $o02_alice$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
                 AND name = (SELECT name FROM t4114o_names WHERE tag = 'alice_once')) THEN
    RAISE EXCEPTION 'O-02: alice must still SELECT her own view-once object';
  END IF;
END $o02_alice$;

-- O-03 the brand team of the event chat.
SELECT pg_temp.t4114o_as('teammate');
DO $o03_teammate$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
                 AND name = (SELECT name FROM t4114o_names WHERE tag = 'guest_normal')) THEN
    RAISE EXCEPTION 'O-03: a brand team member must read a guest''s event chat photo';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
             AND name = (SELECT name FROM t4114o_names WHERE tag = 'guest_once')) THEN
    RAISE EXCEPTION 'O-03: a brand team member must never read a view-once object';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
             AND name = (SELECT name FROM t4114o_names WHERE tag = 'guest_unsent')) THEN
    RAISE EXCEPTION 'O-03: a brand team member must not read the media of an unsent message';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
             AND name IN (SELECT name FROM t4114o_names WHERE tag IN ('alice_once', 'alice_normal', 'bob_fresh'))) THEN
    RAISE EXCEPTION 'O-03: a brand team member reads nothing outside their event chat';
  END IF;
END $o03_teammate$;
RESET ROLE;

DO $o03_no_delete$
DECLARE
  v_name text := (SELECT name FROM t4114o_names WHERE tag = 'guest_normal');
BEGIN
  IF public.issue_4114_can_delete_chat_attachment(v_name, (SELECT id FROM t4114o_ids WHERE tag = 'guest'),
                                                  (SELECT id FROM t4114o_ids WHERE tag = 'teammate')) THEN
    RAISE EXCEPTION 'O-03: a brand team member must not delete a guest''s media';
  END IF;
  IF NOT public.issue_4114_can_read_chat_attachment(v_name, (SELECT id FROM t4114o_ids WHERE tag = 'guest'),
                                                    (SELECT id FROM t4114o_ids WHERE tag = 'guest')) THEN
    RAISE EXCEPTION 'O-03: the guest reads their own photo';
  END IF;
END $o03_no_delete$;

-- O-04 someone outside the chat and the team.
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114o_as('stranger');
DO $o04_stranger$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'
             AND name IN (SELECT name FROM t4114o_names)) THEN
    RAISE EXCEPTION 'O-04: a stranger must read no chat media';
  END IF;
END $o04_stranger$;
RESET ROLE;

SELECT 'issue_4114_chat_media_ownership: O-01..O-04 PASS' AS result;

ROLLBACK;
