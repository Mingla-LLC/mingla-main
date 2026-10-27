\set ON_ERROR_STOP on

-- Issue #4114 Wave 4 rework 3 — the send time of every client message is the
-- server's.
--
--   S-01  a client inserts an ORDINARY photo with a chosen created_at (13 days
--         ago, just inside the 14-day view-once window) and then turns it into
--         a view-once message by moving it into its once/ folder. The stored
--         send time is the server's clock, not the chosen one, so the 14-day
--         expiry cannot be shortened or stretched this way.
--   S-02  a client's plain text message with a far-future created_at is
--         stamped with the server clock.
--   S-03  service code (role service_role) and migrations keep the created_at
--         they write.
--
-- FAILS-ON-REVERT: put back "AND NEW.view_once IS TRUE" on the INSERT branch of
-- issue_4114_enforce_view_once_shape (stamping only view-once inserts) and
-- S-01 and S-02 fail.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114s_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114s_ids TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.t4114s_as(p_tag text, p_role text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := (SELECT id FROM t4114s_ids WHERE tag = p_tag);
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
  v_ana uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['ana', 'ben'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114s-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114s-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114s_ids VALUES (v_tag, v_id);
  END LOOP;
  v_ana := (SELECT id FROM t4114s_ids WHERE tag = 'ana');
  INSERT INTO public.conversations(type, created_by) VALUES ('direct', v_ana) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id, joined_at)
    SELECT v_dm, id, now() - interval '30 days' FROM t4114s_ids;
  INSERT INTO t4114s_ids VALUES ('dm', v_dm);
END $fixture$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.t4114s_as('ana', 'authenticated');

DO $s01$
DECLARE
  v_dm uuid := (SELECT id FROM t4114s_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114s_ids WHERE tag = 'ana');
  v_obj text := gen_random_uuid()::text;
  v_id uuid;
  v_created timestamptz;
  v_once boolean;
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url, created_at)
    VALUES (v_dm, v_ana, 'Photo', 'image', v_dm || '/' || v_obj || '.jpg', now() - interval '13 days')
    RETURNING id, created_at INTO v_id, v_created;
  IF v_created < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'S-01: a client chose an ordinary message''s send time (%)', v_created;
  END IF;

  UPDATE public.messages
     SET view_once = true, file_url = v_dm || '/once/' || v_obj || '.jpg'
   WHERE id = v_id
   RETURNING view_once, created_at INTO v_once, v_created;
  IF v_once IS NOT TRUE THEN
    RAISE EXCEPTION 'S-01: the message did not become view-once';
  END IF;
  IF v_created < now() - interval '1 minute' OR v_created > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'S-01: the view-once message carries a client-chosen send time (%)', v_created;
  END IF;
END $s01$;

DO $s02$
DECLARE
  v_dm uuid := (SELECT id FROM t4114s_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114s_ids WHERE tag = 'ana');
  v_created timestamptz;
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, created_at)
    VALUES (v_dm, v_ana, 'hi', 'text', now() + interval '10 years')
    RETURNING created_at INTO v_created;
  IF v_created > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'S-02: a client chose a text message''s send time (%)', v_created;
  END IF;
END $s02$;
RESET ROLE;

-- S-03: service code keeps its created_at (seeding, imports).
SELECT pg_temp.t4114s_as('ana', 'service_role');
DO $s03$
DECLARE
  v_dm uuid := (SELECT id FROM t4114s_ids WHERE tag = 'dm');
  v_ana uuid := (SELECT id FROM t4114s_ids WHERE tag = 'ana');
  v_want timestamptz := now() - interval '3 days';
  v_created timestamptz;
BEGIN
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, created_at)
    VALUES (v_dm, v_ana, 'seeded', 'text', v_want)
    RETURNING created_at INTO v_created;
  IF v_created IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'S-03: service code lost its created_at (% <> %)', v_created, v_want;
  END IF;
END $s03$;

SELECT 'issue_4114_chat_media_send_time: S-01..S-03 PASS' AS result;

ROLLBACK;
