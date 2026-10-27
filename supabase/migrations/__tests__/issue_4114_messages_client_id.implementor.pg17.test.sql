\set ON_ERROR_STOP on

-- Issue #4114 Wave 1 — a chat message's client id makes sends and retries land once.
--
--   I-01  messages.client_id exists, is a nullable uuid, and the unique index
--         messages_unique_client_id_per_conversation covers
--         (conversation_id, client_id) WHERE client_id IS NOT NULL.
--   I-02  a participant's insert with a client id succeeds through the normal
--         INSERT policies (as role authenticated), and the row carries it back.
--   I-03  a retry with the same client id in the same conversation is refused
--         with unique_violation (23505) naming the index, and leaves exactly one
--         row — which the sender can read back by (conversation_id, client_id).
--   I-04  messages without a client id (legacy and server-written rows) are not
--         constrained: two NULL client ids in one conversation both land.
--   I-05  the same client id in a different conversation is allowed (the key is
--         per conversation).
--
-- FAILS-ON-REVERT (replay the chain without 20271230004114): I-01 fails on its
-- first check (no column), and I-03's retry inserts a second row.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4114_ids (tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t4114_ids TO authenticated;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_conv uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['sender', 'friend', 'other'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4114-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email)
      VALUES (v_id, 't4114-' || v_tag || '-' || v_id || '@example.test')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4114_ids VALUES (v_tag, v_id);
  END LOOP;

  FOREACH v_tag IN ARRAY ARRAY['conv_a', 'conv_b'] LOOP
    INSERT INTO public.conversations(type, created_by)
      VALUES ('direct', (SELECT id FROM t4114_ids WHERE tag = 'sender'))
      RETURNING id INTO v_conv;
    INSERT INTO public.conversation_participants(conversation_id, user_id)
      SELECT v_conv, id FROM t4114_ids WHERE tag IN ('sender', CASE WHEN v_tag = 'conv_a' THEN 'friend' ELSE 'other' END);
    INSERT INTO t4114_ids VALUES (v_tag, v_conv);
  END LOOP;

  INSERT INTO t4114_ids VALUES ('client', gen_random_uuid());
END $fixture$;

-- I-01 schema shape.
DO $i01$
DECLARE
  v_type text;
  v_nullable text;
  v_def text;
BEGIN
  SELECT data_type, is_nullable INTO v_type, v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'client_id';
  IF v_type IS DISTINCT FROM 'uuid' OR v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'I-01: messages.client_id must be a nullable uuid (got %, %)', v_type, v_nullable;
  END IF;

  SELECT pg_get_indexdef(indexrelid) INTO v_def
    FROM pg_index
   WHERE indexrelid = 'public.messages_unique_client_id_per_conversation'::regclass
     AND indisunique;
  IF v_def IS NULL
     OR v_def NOT LIKE '%(conversation_id, client_id)%'
     OR v_def NOT LIKE '%WHERE (client_id IS NOT NULL)%' THEN
    RAISE EXCEPTION 'I-01: unique partial index missing or wrong: %', v_def;
  END IF;
END $i01$;

-- I-02 .. I-05 as the signed-in sender, through the real INSERT policies.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t4114_ids WHERE tag = 'sender'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM t4114_ids WHERE tag = 'sender'), 'role', 'authenticated')::text, true);

DO $sends$
DECLARE
  v_sender uuid := (SELECT id FROM t4114_ids WHERE tag = 'sender');
  v_conv_a uuid := (SELECT id FROM t4114_ids WHERE tag = 'conv_a');
  v_conv_b uuid := (SELECT id FROM t4114_ids WHERE tag = 'conv_b');
  v_client uuid := (SELECT id FROM t4114_ids WHERE tag = 'client');
  v_first_id uuid;
  v_returned_client uuid;
  v_found_id uuid;
  v_count integer;
  v_constraint text;
  v_refused boolean := false;
BEGIN
  -- I-02
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, client_id)
    VALUES (v_conv_a, v_sender, 'hello once', 'text', v_client)
    RETURNING id, client_id INTO v_first_id, v_returned_client;
  IF v_returned_client IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'I-02: insert did not carry client_id back (got %)', v_returned_client;
  END IF;

  -- I-03 retry with the same client id
  BEGIN
    INSERT INTO public.messages(conversation_id, sender_id, content, message_type, client_id)
      VALUES (v_conv_a, v_sender, 'hello once', 'text', v_client);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'I-03: a retry with the same client id inserted a second row';
  END IF;
  IF v_constraint IS DISTINCT FROM 'messages_unique_client_id_per_conversation' THEN
    RAISE EXCEPTION 'I-03: retry refused by the wrong constraint: %', v_constraint;
  END IF;

  SELECT count(*), min(id::text)::uuid INTO v_count, v_found_id
    FROM public.messages
   WHERE conversation_id = v_conv_a AND client_id = v_client AND sender_id = v_sender;
  IF v_count <> 1 OR v_found_id IS DISTINCT FROM v_first_id THEN
    RAISE EXCEPTION 'I-03: expected the one original row back by client id, got % rows (%)', v_count, v_found_id;
  END IF;

  -- I-04 NULL client ids are unconstrained
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type)
    VALUES (v_conv_a, v_sender, 'legacy one', 'text'), (v_conv_a, v_sender, 'legacy two', 'text');
  SELECT count(*) INTO v_count FROM public.messages
   WHERE conversation_id = v_conv_a AND client_id IS NULL AND content LIKE 'legacy %';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'I-04: expected 2 NULL-client-id rows, got %', v_count;
  END IF;

  -- I-05 same client id in another conversation
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, client_id)
    VALUES (v_conv_b, v_sender, 'hello elsewhere', 'text', v_client);
  SELECT count(*) INTO v_count FROM public.messages WHERE client_id = v_client;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'I-05: expected the client id once in each conversation, got %', v_count;
  END IF;
END $sends$;

RESET ROLE;

SELECT 'issue_4114_messages_client_id: I-01..I-05 PASS' AS result;

ROLLBACK;
