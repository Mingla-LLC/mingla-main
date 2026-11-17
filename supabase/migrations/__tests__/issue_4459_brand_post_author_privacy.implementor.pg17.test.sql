\set ON_ERROR_STOP on

-- #4459 (20280805004459) item 5: a brand post never tells a guest which team
-- member wrote it, on any read path; the brand team still sees the author.
-- Everything rolls back.
--
-- MINGLA-INVARIANT: I-4459-BRAND-POST-AUTHOR-TEAM-ONLY | issue #4459 | a guest reads no brand-team user id from a brand post or a brand removal: messages rows (the same rows realtime publishes), reply previews, unsend tombstones and every RPC they can call; the author lives only in brand_guest_post_authors, which only the brand team reads
--
-- FAILS-ON-REVERT: write the team member into messages.sender_id again in
-- issue_4459_send_brand_guest_message (or keep unsent_by on a brand removal,
-- or open brand_guest_post_authors to members) and P-* fails.

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
    PERFORM pg_temp.as_server();
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN v_state || ' ' || v_msg;
  END;
END $f$;
-- A jsonb RPC result as p_tag (or the SQLSTATE and message as a json string).
CREATE FUNCTION pg_temp.rpc_as(p_tag text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v_state text; v_msg text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(p_tag);
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql INTO r;
    PERFORM set_config('role', 'postgres', true);
    PERFORM pg_temp.as_server();
    RETURN r;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN to_jsonb(v_state || ' ' || v_msg);
  END;
END $f$;
-- Count of rows p_sql (a SELECT count(*)) returns as p_tag under RLS.
CREATE FUNCTION pg_temp.count_as(p_tag text, p_sql text) RETURNS integer LANGUAGE plpgsql AS $f$
DECLARE r integer;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO r;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.as_server();
  RETURN r;
END $f$;

CREATE TEMP SEQUENCE i4459_phone START 1000000;
-- A person with a proved phone (an order's owner must own its contact, #4063).
CREATE FUNCTION pg_temp.person(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, 'i4459-' || p_tag || '-' || v || '@example.test');
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v, '+1555' || nextval('i4459_phone'));
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;
-- A brand with its owner (the owner joins the team through the brand trigger).
CREATE FUNCTION pg_temp.brand(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_owner uuid := pg_temp.person(p_tag || '_owner'); v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider)
    VALUES (v, v_owner, 'Brand ' || p_tag, 'i4459-' || p_tag || '-' || v, 'stripe');
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.listing(p_tag text, p_brand text, p_type text, p_start interval DEFAULT interval '2 days')
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, is_recurring)
    VALUES (v, pg_temp.u(p_brand), 'Listing ' || p_tag, 'i4459-' || p_tag || '-' || v,
            p_type, 'draft', 'draft', 'UTC', false, false);
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.paid_order(p_listing text, p_buyer text, p_status text DEFAULT 'paid',
  p_source text DEFAULT 'online_checkout') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, payment_status, payment_method,
                            total_cents, source, door_payment_method)
    VALUES (v, pg_temp.u(p_listing), pg_temp.u(p_buyer), NULL,
            (SELECT phone_e164 FROM public.verified_phone_identities WHERE user_id = pg_temp.u(p_buyer)), p_status,
            CASE WHEN p_source = 'door_sale' THEN 'cash' ELSE 'free' END, 0, p_source,
            CASE WHEN p_source = 'door_sale' THEN 'cash' END);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.chat(p_brand text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT c.id FROM public.conversations c
   WHERE c.brand_id = pg_temp.u(p_brand) AND c.linked_entity_type = 'brand_guests'
$f$;
CREATE FUNCTION pg_temp.chats(p_brand text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.conversations c
   WHERE c.brand_id = pg_temp.u(p_brand) AND c.linked_entity_type = 'brand_guests'
$f$;
CREATE FUNCTION pg_temp.member(p_brand text, p_person text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.conversation_participants cp
                  WHERE cp.conversation_id = pg_temp.chat(p_brand) AND cp.user_id = pg_temp.u(p_person))
$f$;
CREATE FUNCTION pg_temp.in_one(p_brand text, p_person text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT pg_temp.chats(p_brand) = 1 AND pg_temp.member(p_brand, p_person)
$f$;

SELECT pg_temp.as_server();

SELECT pg_temp.as_server();
SELECT pg_temp.brand('b1');
SELECT pg_temp.listing('ev', 'b1', 'event');
SELECT pg_temp.person(t) FROM unnest(ARRAY['ana', 'ben', 'mgr']) AS t;
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (pg_temp.u('b1'), pg_temp.u('mgr'), 'event_manager', now(), now());
SELECT pg_temp.paid_order('ev', 'ana');
SELECT pg_temp.paid_order('ev', 'ben');

-- Every brand-team user id, as text.
CREATE FUNCTION pg_temp.team_ids() RETURNS text[] LANGUAGE sql AS $f$
  SELECT array_agg(m.user_id::text) FROM public.brand_team_members m WHERE m.brand_id = pg_temp.u('b1')
$f$;
CREATE FUNCTION pg_temp.leaks(p_json text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM unnest(pg_temp.team_ids()) t WHERE position(t IN p_json) > 0)
$f$;
-- What a guest reads, as one text blob, under RLS.
CREATE FUNCTION pg_temp.read_as(p_tag text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO r;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.as_server();
  RETURN COALESCE(r, '');
END $f$;

DO $p$
DECLARE v jsonb; v_brand_post uuid; v_brand_post2 uuid; v_guest_post uuid; v_reply uuid; v_blob text; v_conv uuid := pg_temp.chat('b1');
BEGIN
  -- Two brand posts (owner and manager), a guest post and a guest reply to a brand post.
  v := pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L, NULL, %L)', v_conv, 'Doors at 8', gen_random_uuid()));
  v_brand_post := (v->>'id')::uuid;
  PERFORM pg_temp.ok('P-SEND-TEAM the team member who posted gets the author back', (v->>'author_id')::uuid = pg_temp.u('mgr'));
  v := pg_temp.rpc_as('b1_owner', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', v_conv, 'Bar is open'));
  v_brand_post2 := (v->>'id')::uuid;
  v := pg_temp.rpc_as('ana', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L, %L)', v_conv, 'See you', v_brand_post));
  v_reply := (v->>'id')::uuid;
  PERFORM pg_temp.ok('P-GUEST-OWN a guest post still carries its guest sender', (v->>'sender_id')::uuid = pg_temp.u('ana') AND v->>'author_id' IS NULL);

  -- The stored row (what realtime publishes, column for column) names no one.
  PERFORM pg_temp.ok('P-ROW the stored brand post has no sender',
    (SELECT sender_id IS NULL AND sender_kind = 'brand' FROM public.messages WHERE id = v_brand_post)
    AND NOT pg_temp.leaks((SELECT to_jsonb(m)::text FROM public.messages m WHERE m.id = v_brand_post)));

  -- Guest reads: every message row, the reply preview read, the last-message read.
  v_blob := pg_temp.read_as('ben', format('SELECT string_agg(to_jsonb(m)::text, '','') FROM public.messages m WHERE m.conversation_id = %L', v_conv));
  PERFORM pg_temp.ok('P-SELECT a guest reads every message row and finds no team id', length(v_blob) > 0 AND NOT pg_temp.leaks(v_blob));
  v_blob := pg_temp.read_as('ben', format('SELECT to_jsonb(r)::text FROM public.messages r WHERE r.id = (SELECT reply_to_id FROM public.messages WHERE id = %L)', v_reply));
  PERFORM pg_temp.ok('P-REPLY the replied-to brand post (reply preview read) names no one', length(v_blob) > 0 AND NOT pg_temp.leaks(v_blob));
  v_blob := pg_temp.read_as('ben', format('SELECT to_jsonb(m)::text FROM public.messages m WHERE m.conversation_id = %L AND m.id = %L', v_conv, v_brand_post2));
  PERFORM pg_temp.ok('P-LAST the last-message read names no one', length(v_blob) > 0 AND NOT pg_temp.leaks(v_blob));
  v_blob := pg_temp.read_as('ben', 'SELECT string_agg(to_jsonb(a)::text, '','') FROM public.list_connection_conversation_access() a');
  PERFORM pg_temp.ok('P-LIST the Chats list access RPC names no team member', NOT pg_temp.leaks(v_blob));

  -- The author table: the team reads it, a guest reads nothing.
  PERFORM pg_temp.ok('P-AUTHORS-GUEST a guest reads no author row',
    pg_temp.count_as('ben', 'SELECT count(*) FROM public.brand_guest_post_authors') = 0);
  PERFORM pg_temp.ok('P-AUTHORS-TEAM the team sees who posted',
    pg_temp.read_as('b1_owner', format('SELECT author_id::text FROM public.brand_guest_post_authors WHERE message_id = %L', v_brand_post)) = pg_temp.u('mgr')::text);
  PERFORM pg_temp.ok('P-AUTHORS-WRITE no client can write an author row',
    pg_temp.try_as('mgr', format('INSERT INTO public.brand_guest_post_authors(message_id, conversation_id, author_id) VALUES (%L, %L, %L)', v_reply, v_conv, pg_temp.u('mgr'))) NOT LIKE 'ok%');

  -- Unsend: a guest cannot remove a brand post; the brand can, and the line names no one.
  PERFORM pg_temp.ok('P-UNSEND-GUEST a guest cannot unsend a brand post',
    pg_temp.rpc_as('ben', format('SELECT public.unsend_messages(ARRAY[%L]::uuid[])', v_brand_post))::text LIKE '%42501%');
  v := pg_temp.rpc_as('mgr', format('SELECT public.unsend_messages(ARRAY[%L]::uuid[])', v_brand_post));
  PERFORM pg_temp.ok('P-UNSEND-TEAM the brand removes its own post (kind host)', v->>'kind' = 'host');
  v := pg_temp.rpc_as('mgr', format('SELECT public.unsend_messages(ARRAY[%L]::uuid[])', v_reply));
  PERFORM pg_temp.ok('P-UNSEND-MODERATE the brand removes a guest post (kind host)', v->>'kind' = 'host');
  v_blob := pg_temp.read_as('ben', format('SELECT string_agg(to_jsonb(m)::text, '','') FROM public.messages m WHERE m.conversation_id = %L', v_conv));
  PERFORM pg_temp.ok('P-TOMBSTONE brand removals name no team member', NOT pg_temp.leaks(v_blob)
    AND (SELECT bool_and(unsent_by IS NULL) FROM public.messages WHERE id IN (v_brand_post, v_reply)));
  v := pg_temp.rpc_as('ana', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', v_conv, 'mine'));
  PERFORM pg_temp.ok('P-UNSEND-SENDER a guest still unsends their own post (kind sender)',
    pg_temp.rpc_as('ana', format('SELECT public.unsend_messages(ARRAY[%L]::uuid[])', v->>'id'))->>'kind' = 'sender');

  -- Read receipts still work on a brand post.
  PERFORM pg_temp.as_user('ben');
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.message_reads(message_id, user_id) VALUES (v_brand_post2, pg_temp.u('ben'));
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.as_server();
  PERFORM pg_temp.ok('P-READS a guest marks a brand post read',
    EXISTS (SELECT 1 FROM public.message_reads WHERE message_id = v_brand_post2 AND user_id = pg_temp.u('ben')));

  -- An idempotent retry by the team finds its own brand post.
  v := pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L, NULL, %L)', v_conv, 'again',
    (SELECT client_id FROM public.messages WHERE id = v_brand_post2)));
  PERFORM pg_temp.ok('P-RETRY-OTHER another team member''s client id is not theirs to replay', v->>'id' IS DISTINCT FROM v_brand_post2::text OR v::text LIKE '%23505%');
END $p$;

ROLLBACK;
