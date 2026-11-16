\set ON_ERROR_STOP on

-- #4456 (20280715004456): Unsend for everyone, Delete for me, admin removal,
-- the private 30-day store, chat-file reads, reports that name a message, and
-- the wipe of rows unsent before this migration. Runs on the fully replayed
-- PG17 schema; everything rolls back.
--
-- MINGLA-INVARIANT: I-4456-UNSEND-SCRUBS | issue #4456 | every change of messages.deleted_at from NULL on an unsendable message leaves content empty, the file, thumbnail, card, mentions and media facts NULL or empty, and one private store row holding the original
-- MINGLA-INVARIANT: I-4456-UNSEND-FINAL | issue #4456 | an unsent message never comes back and its wiped fields are never put back, on any path
-- MINGLA-INVARIANT: I-4456-CLIENT-NO-CONTENT-WRITE | issue #4456 | anon and authenticated can UPDATE only deleted_at, updated_at, is_read and read_at on messages, and cannot DELETE
-- MINGLA-INVARIANT: I-4456-HIDE-IS-PER-USER | issue #4456 | a Delete for me row hides the message from its owner only
-- MINGLA-INVARIANT: I-4456-UNSENT-FILE-SERVER-ONLY | issue #4456 | after an unsend no app user can read the message's file or thumbnail, and a participant reads a chat file only while a live message points at it
-- MINGLA-INVARIANT: I-4456-EVIDENCE-RETENTION | issue #4456 | the private copy and its files are deleted 30 days after the unsend, never while an open report names the message
--
-- Cases: S-SENDER, S-OLD, S-IDEMPOTENT, S-ALBUM, S-VIEW-ONCE, S-CARD,
-- S-REACTIONS, S-NOTIFY, S-CONV, A-ADMIN, A-MEMBER, A-DM, A-VIEW-ONCE, A-MIXED,
-- V-PLAN, V-SYSTEM, V-INPUT, V-CROSS, V-OUTSIDER, V-SUPPORT, L-LEGACY-UPDATE,
-- H-HOST, X-SERVER, F-FINAL, ADV-* (client writes), D-HIDE, D-UNHIDE,
-- D-OUTSIDER, D-DIRECT, F-STORAGE, F-REUSE, R-REPORT, R-REPORT-FORGED,
-- P-SWEEP, P-HELD, B-BACKFILL, T-CATALOG.

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
DECLARE v_tag text; v_id uuid; v_dm uuid; v_s uuid; v_conv uuid; v_out uuid; v_sup uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['ana','ben','sam','tobi','eve'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 'u4456-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 'u4456-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO k VALUES (v_tag, v_id);
  END LOOP;
  INSERT INTO public.conversations(type, linked_entity_type, created_by) VALUES ('direct', 'direct', pg_temp.u('ana')) RETURNING id INTO v_dm;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, pg_temp.u('ana')), (v_dm, pg_temp.u('ben'));
  INSERT INTO k VALUES ('dm', v_dm);
  -- A session group: Sam created it (admin); Ana, Ben and Tobi are members.
  INSERT INTO public.collaboration_sessions(name, created_by, status) VALUES ('crew 4456', pg_temp.u('sam'), 'active') RETURNING id INTO v_s;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_s, pg_temp.u('sam'), true), (v_s, pg_temp.u('ana'), true), (v_s, pg_temp.u('ben'), true), (v_s, pg_temp.u('tobi'), true);
  SELECT id INTO v_conv FROM public.conversations WHERE session_id = v_s AND linked_entity_type = 'session';
  IF v_conv IS NULL THEN RAISE EXCEPTION 'fixture: session chat was not created'; END IF;
  INSERT INTO public.conversation_participants(conversation_id, user_id)
    SELECT v_conv, x FROM unnest(ARRAY[pg_temp.u('sam'), pg_temp.u('ana'), pg_temp.u('ben'), pg_temp.u('tobi')]) x
    ON CONFLICT DO NOTHING;
  INSERT INTO k VALUES ('crew', v_conv);
  -- A chat Eve is not in.
  INSERT INTO public.conversations(type, linked_entity_type, created_by) VALUES ('direct', 'direct', pg_temp.u('sam')) RETURNING id INTO v_out;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_out, pg_temp.u('sam')), (v_out, pg_temp.u('tobi'));
  INSERT INTO k VALUES ('other', v_out);
  INSERT INTO public.conversations(type, linked_entity_type, created_by) VALUES ('direct', 'support', pg_temp.u('ana')) RETURNING id INTO v_sup;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_sup, pg_temp.u('ana'));
  INSERT INTO k VALUES ('support', v_sup);
END $fixture$;

-- ── Unsend by the author ──────────────────────────────────────────────────
DO $sender$
DECLARE
  v_dm uuid := pg_temp.u('dm');
  v_file text := pg_temp.u('dm') || '/' || gen_random_uuid() || '.jpg';
  v_m uuid; v_old uuid; v_photo uuid; r text; e record;
BEGIN
  v_m := pg_temp.msg('t1', 'dm', 'ana', 'bring the tickets');
  v_photo := pg_temp.msg('photo', 'dm', 'ana', '', 'image', v_file, regexp_replace(v_file, '\.jpg$', '_thumb.jpg'));
  v_old := pg_temp.msg('old', 'dm', 'ana', 'sent last year', p_age => interval '400 days');
  INSERT INTO public.direct_message_reactions(message_id, user_id, emoji) VALUES (v_m, pg_temp.u('ben'), '❤️');
  INSERT INTO public.notifications(user_id, type, title, body, data, related_id, related_type)
    VALUES (pg_temp.u('ben'), 'direct_message_received', 'Ana', 'bring the tickets',
            jsonb_build_object('deepLink', 'mingla://chat/x', 'messageId', v_m), v_dm::text, 'conversation');
  ALTER TABLE public.conversations DISABLE TRIGGER update_conversations_updated_at;
  UPDATE public.conversations SET updated_at = now() - interval '1 day' WHERE id = v_dm;
  ALTER TABLE public.conversations ENABLE TRIGGER update_conversations_updated_at;
  PERFORM pg_temp.ok('S-CONV-before', (SELECT updated_at < now() - interval '1 hour' FROM public.conversations WHERE id = v_dm));

  r := pg_temp.unsend('ana', ARRAY[v_m]);
  PERFORM pg_temp.ok('S-SENDER returns the ids and the sender kind', (r::jsonb ->> 'kind') = 'sender' AND (r::jsonb -> 'unsent') ? v_m::text);
  PERFORM pg_temp.ok('S-SENDER the row is wiped', pg_temp.scrubbed(v_m));
  PERFORM pg_temp.ok('S-SENDER kind and actor', (SELECT unsent_kind = 'sender' AND unsent_by = pg_temp.u('ana') FROM public.messages WHERE id = v_m));
  SELECT * INTO e FROM public.message_unsend_evidence WHERE message_id = v_m;
  PERFORM pg_temp.ok('S-SENDER the store keeps the original for 30 days',
    e.original ->> 'content' = 'bring the tickets' AND e.unsent_kind = 'sender'
    AND e.purge_after BETWEEN now() + interval '29 days' AND now() + interval '31 days');
  PERFORM pg_temp.ok('S-REACTIONS reactions go', NOT EXISTS (SELECT 1 FROM public.direct_message_reactions WHERE message_id = v_m));
  PERFORM pg_temp.ok('S-NOTIFY the in-app row is quieted and loses its preview',
    (SELECT in_app_suppressed_at IS NOT NULL AND body = '' FROM public.notifications WHERE data ->> 'messageId' = v_m::text));
  PERFORM pg_temp.ok('S-CONV the chat is bumped for chat lists', (SELECT updated_at >= now() - interval '1 minute' FROM public.conversations WHERE id = v_dm));
  PERFORM pg_temp.ok('S-SENDER the tombstone stays readable to the other participant (realtime placeholder)',
    v_m = ANY (pg_temp.visible_ids('ben', v_dm)));

  r := pg_temp.unsend('ana', ARRAY[v_old]);
  PERFORM pg_temp.ok('S-OLD no time limit: a 400-day-old message unsends', pg_temp.scrubbed(v_old));

  r := pg_temp.unsend('ana', ARRAY[v_m]);
  PERFORM pg_temp.ok('S-IDEMPOTENT a second unsend is done, not an error', (r::jsonb ->> 'kind') = 'sender');
  PERFORM pg_temp.ok('S-IDEMPOTENT one store row', (SELECT count(*) FROM public.message_unsend_evidence WHERE message_id = v_m) = 1);

  r := pg_temp.unsend('ana', ARRAY[v_photo]);
  PERFORM pg_temp.ok('S-PHOTO wiped, store keeps file and thumbnail paths',
    pg_temp.scrubbed(v_photo)
    AND (SELECT file_path = v_file AND thumb_path = regexp_replace(v_file, '\.jpg$', '_thumb.jpg') FROM public.message_unsend_evidence WHERE message_id = v_photo));
END $sender$;

DO $kinds$
DECLARE
  v_crew uuid := pg_temp.u('crew');
  v_album uuid := gen_random_uuid();
  v_once_file text := pg_temp.u('crew') || '/once/' || gen_random_uuid() || '.jpg';
  a1 uuid; a2 uuid; a3 uuid; v_once uuid; v_card uuid; r text;
BEGIN
  a1 := pg_temp.msg('a1', 'crew', 'ana', '', 'image', pg_temp.u('crew') || '/' || gen_random_uuid() || '.jpg', NULL, false, NULL, interval '1 hour', v_album);
  a2 := pg_temp.msg('a2', 'crew', 'ana', '', 'image', pg_temp.u('crew') || '/' || gen_random_uuid() || '.jpg', NULL, false, NULL, interval '1 hour', v_album);
  a3 := pg_temp.msg('a3', 'crew', 'ana', '', 'image', pg_temp.u('crew') || '/' || gen_random_uuid() || '.jpg', NULL, false, NULL, interval '1 hour', v_album);
  r := pg_temp.unsend('ana', ARRAY[a1, a2, a3]);
  PERFORM pg_temp.ok('S-ALBUM one call unsends the whole album', pg_temp.scrubbed(a1) AND pg_temp.scrubbed(a2) AND pg_temp.scrubbed(a3));
  PERFORM pg_temp.ok('S-ALBUM keeps the album id so the thread shows one line',
    (SELECT bool_and(media_album_id = v_album) FROM public.messages WHERE id IN (a1, a2, a3)));

  v_once := pg_temp.msg('once', 'crew', 'ana', '', 'image', v_once_file, NULL, true);
  r := pg_temp.unsend('ana', ARRAY[v_once]);
  PERFORM pg_temp.ok('S-VIEW-ONCE unsends with no shape-check error (' || r || ')', pg_temp.scrubbed(v_once));

  v_card := pg_temp.msg('card', 'crew', 'ana', 'a place', 'card', NULL, NULL, false, '{"title":"Jetty"}'::jsonb);
  r := pg_temp.unsend('ana', ARRAY[v_card]);
  PERFORM pg_temp.ok('S-CARD a card keeps its type with no payload', pg_temp.scrubbed(v_card)
    AND (SELECT message_type = 'card' FROM public.messages WHERE id = v_card));
END $kinds$;

-- ── Admin removal ─────────────────────────────────────────────────────────
DO $admin$
DECLARE v_t uuid; v_t2 uuid; v_once uuid; v_dm_b uuid; v_mine uuid; r text;
BEGIN
  v_t := pg_temp.msg('tobi1', 'crew', 'tobi', 'selling 2 extra tickets');
  v_t2 := pg_temp.msg('tobi2', 'crew', 'tobi', 'dm me');
  r := pg_temp.unsend('ben', ARRAY[v_t]);
  PERFORM pg_temp.ok('A-MEMBER a member cannot remove someone else''s message (' || r || ')', r LIKE '42501%');
  PERFORM pg_temp.ok('A-MEMBER the message is untouched', (SELECT deleted_at IS NULL AND content = 'selling 2 extra tickets' FROM public.messages WHERE id = v_t));
  r := pg_temp.unsend('sam', ARRAY[v_t]);
  PERFORM pg_temp.ok('A-ADMIN the admin removes it (' || r || ')', (r::jsonb ->> 'kind') = 'admin' AND pg_temp.scrubbed(v_t));
  PERFORM pg_temp.ok('A-ADMIN recorded as an admin removal by Sam',
    (SELECT unsent_kind = 'admin' AND unsent_by = pg_temp.u('sam') FROM public.messages WHERE id = v_t));

  v_once := pg_temp.msg('tobi-once', 'crew', 'tobi', '', 'image', pg_temp.u('crew') || '/once/' || gen_random_uuid() || '.jpg', NULL, true);
  r := pg_temp.unsend('sam', ARRAY[v_once]);
  PERFORM pg_temp.ok('A-VIEW-ONCE admins cannot remove view-once items (' || r || ')', r LIKE '42501%');

  v_mine := pg_temp.msg('sam1', 'crew', 'sam', 'mine');
  r := pg_temp.unsend('sam', ARRAY[v_mine, v_t2]);
  PERFORM pg_temp.ok('A-MIXED own and others'' in one call is refused (' || r || ')', r LIKE '22023%');

  v_dm_b := pg_temp.msg('ben-dm', 'dm', 'ben', 'hey');
  r := pg_temp.unsend('ana', ARRAY[v_dm_b]);
  PERFORM pg_temp.ok('A-DM there is no admin in a 1:1 chat (' || r || ')', r LIKE '42501%');
END $admin$;

-- ── What cannot be unsent ─────────────────────────────────────────────────
DO $refused$
DECLARE v_sys uuid; v_ids uuid[]; v_a uuid; v_b uuid; v_out uuid; v_sup uuid; r text;
BEGIN
  v_sys := pg_temp.msg('sys', 'crew', 'ana', 'Ana joined', 'system');
  r := pg_temp.unsend('ana', ARRAY[v_sys]);
  PERFORM pg_temp.ok('V-SYSTEM a system row is refused (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ana', format('UPDATE public.messages SET deleted_at = now() WHERE id = %L', v_sys));
  PERFORM pg_temp.ok('V-SYSTEM also on the direct update path (' || r || ')', r LIKE '42501%');

  SELECT array_agg(pg_temp.msg('bulk' || g, 'dm', 'ana', 'x' || g)) INTO v_ids FROM generate_series(1, 11) g;
  r := pg_temp.unsend('ana', v_ids);
  PERFORM pg_temp.ok('V-INPUT eleven ids are refused (' || r || ')', r LIKE '22023%');
  r := pg_temp.unsend('ana', ARRAY[]::uuid[]);
  PERFORM pg_temp.ok('V-INPUT no ids are refused', r LIKE '22023%');
  r := pg_temp.unsend('ana', ARRAY[v_ids[1], v_ids[1]]);
  PERFORM pg_temp.ok('V-INPUT duplicate ids are refused', r LIKE '22023%');
  r := pg_temp.unsend('ana', ARRAY[gen_random_uuid()]);
  PERFORM pg_temp.ok('V-INPUT an unknown id is not_found (' || r || ')', r LIKE 'P0002%');

  v_a := pg_temp.msg('cross-a', 'dm', 'ana', 'one');
  v_b := pg_temp.msg('cross-b', 'crew', 'ana', 'two');
  r := pg_temp.unsend('ana', ARRAY[v_a, v_b]);
  PERFORM pg_temp.ok('V-CROSS ids from two chats are refused (' || r || ')', r LIKE '22023%');

  v_out := pg_temp.msg('outside', 'other', 'tobi', 'private');
  r := pg_temp.unsend('eve', ARRAY[v_out]);
  PERFORM pg_temp.ok('V-OUTSIDER a non-participant is refused (' || r || ')', r LIKE '42501%');
  PERFORM pg_temp.ok('V-OUTSIDER untouched', (SELECT deleted_at IS NULL FROM public.messages WHERE id = v_out));

  v_sup := pg_temp.msg('sup', 'support', 'ana', 'help');
  r := pg_temp.unsend('ana', ARRAY[v_sup]);
  PERFORM pg_temp.ok('V-SUPPORT support threads are excluded (' || r || ')', r LIKE '42501%');
END $refused$;

-- ── Plan cards are never unsent ───────────────────────────────────────────
DO $plan$
DECLARE v_plan uuid; v_m uuid; r text;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.chat_plans(conversation_id, source, created_by, title, when_mode)
    VALUES (pg_temp.u('crew'), 'chat', pg_temp.u('ana'), 'Jetty dinner', 'none') RETURNING id INTO v_plan;
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, plan_id, card_payload, created_at)
    VALUES (pg_temp.u('crew'), pg_temp.u('ana'), 'Ana added a plan: Jetty dinner', 'plan', v_plan,
            jsonb_build_object('kind', 'plan', 'planId', v_plan), now() - interval '1 hour')
    RETURNING id INTO v_m;
  SET LOCAL session_replication_role = origin;
  r := pg_temp.unsend('ana', ARRAY[v_m]);
  PERFORM pg_temp.ok('V-PLAN the RPC refuses a plan card (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ana', format('UPDATE public.messages SET deleted_at = now() WHERE id = %L', v_m));
  PERFORM pg_temp.ok('V-PLAN so does the direct update (' || r || ')', r LIKE '42501%');
  PERFORM pg_temp.ok('V-PLAN the card is untouched',
    (SELECT deleted_at IS NULL AND unsent_at IS NULL AND card_payload ->> 'kind' = 'plan' FROM public.messages WHERE id = v_m));
END $plan$;

-- ── Older Explorer builds: the direct deleted_at update becomes the unsend ──
DO $legacy$
DECLARE v_m uuid; r text;
BEGIN
  v_m := pg_temp.msg('legacy-app', 'dm', 'ana', 'from 1.1.6');
  INSERT INTO public.direct_message_reactions(message_id, user_id, emoji) VALUES (v_m, pg_temp.u('ben'), '🔥');
  r := pg_temp.try_as('ana', format(
    'UPDATE public.messages SET deleted_at = %L WHERE id = %L AND sender_id = %L',
    now()::text, v_m, pg_temp.u('ana')));
  PERFORM pg_temp.ok('L-LEGACY-UPDATE the old app''s update still works (' || r || ')', r = 'ok');
  PERFORM pg_temp.ok('L-LEGACY-UPDATE and is a full unsend', pg_temp.scrubbed(v_m)
    AND (SELECT unsent_kind = 'sender' FROM public.messages WHERE id = v_m)
    AND EXISTS (SELECT 1 FROM public.message_unsend_evidence WHERE message_id = v_m)
    AND NOT EXISTS (SELECT 1 FROM public.direct_message_reactions WHERE message_id = v_m));
  r := pg_temp.try_as('ben', format('UPDATE public.messages SET deleted_at = now() WHERE id = %L', pg_temp.u('ben-dm')));
  PERFORM pg_temp.ok('L-LEGACY-UPDATE the other person''s direct update reaches no row',
    r = 'ok' AND (SELECT unsent_kind = 'sender' FROM public.messages WHERE id = pg_temp.u('ben-dm')) IS NOT FALSE);
END $legacy$;

-- ── Host app moderation delete (brand team, event chat) ────────────────────
DO $host$
DECLARE v_host uuid := pg_temp.u('sam'); v_brand uuid := gen_random_uuid(); v_event uuid := gen_random_uuid();
  v_chat uuid; v_m uuid; r text;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.creator_accounts(id) VALUES (v_host) ON CONFLICT DO NOTHING;
  INSERT INTO public.brands(id, account_id, name, slug)
    VALUES (v_brand, v_host, 'T4456 brand', 't4456-brand-' || left(v_brand::text, 8));
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at, invited_at)
    VALUES (v_brand, v_host, 'brand_admin', now(), now());
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme)
    VALUES (v_event, v_brand, v_host, 'T4456 event', 't4456-event-' || left(v_event::text, 8),
            'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
  INSERT INTO public.conversations(type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only)
    VALUES ('group', 'event', v_event, 'T4456 event', v_host, true, false)
    RETURNING id INTO v_chat;
  -- The host is in the chat (a brand team member who is not a participant
  -- cannot read the removed row back, a separate, pre-existing limit).
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_chat, pg_temp.u('eve')), (v_chat, v_host);
  SET LOCAL session_replication_role = origin;
  INSERT INTO k VALUES ('event', v_chat);
  v_m := pg_temp.msg('guest', 'event', 'eve', 'guest words');
  -- The Host app's groupChatService.deleteMessage, as shipped.
  r := pg_temp.try_as('sam', format(
    'UPDATE public.messages SET deleted_at = now(), updated_at = now() WHERE id = %L', v_m));
  PERFORM pg_temp.ok('H-HOST the Host moderation delete still works (' || r || ')', r = 'ok');
  PERFORM pg_temp.ok('H-HOST and is wiped as a hidden host removal',
    pg_temp.scrubbed(v_m) AND (SELECT unsent_kind = 'host' AND unsent_by = pg_temp.u('sam') FROM public.messages WHERE id = v_m));
  v_m := pg_temp.msg('guest2', 'event', 'eve', 'more words');
  r := pg_temp.try_as('sam', format('UPDATE public.messages SET content = %L WHERE id = %L', 'host rewrote it', v_m));
  PERFORM pg_temp.ok('H-HOST the brand team cannot rewrite a guest''s message (' || r || ')', r LIKE '42501%');
END $host$;

-- ── Server removals (account deletion and the like) ─────────────────────────
DO $server$
DECLARE v_m uuid;
BEGIN
  v_m := pg_temp.msg('server', 'crew', 'tobi', 'bye');
  PERFORM pg_temp.as_server();
  UPDATE public.messages SET deleted_at = now() WHERE id = v_m;
  PERFORM pg_temp.ok('X-SERVER a server removal is wiped as a hidden kind',
    pg_temp.scrubbed(v_m) AND (SELECT unsent_kind = 'server' FROM public.messages WHERE id = v_m));
END $server$;

-- ── An unsent message never comes back ────────────────────────────────────
DO $final$
DECLARE v_m uuid := pg_temp.u('t1'); r text;
BEGIN
  PERFORM pg_temp.as_server();
  BEGIN
    UPDATE public.messages SET deleted_at = NULL WHERE id = v_m;
    RAISE EXCEPTION 'FAIL F-FINAL the server brought an unsent message back';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS F-FINAL even the server cannot bring it back';
  END;
  UPDATE public.messages SET content = 'restored', card_payload = '{"a":1}' WHERE id = v_m;
  PERFORM pg_temp.ok('F-FINAL wiped fields stay wiped', pg_temp.scrubbed(v_m));
  r := pg_temp.try_as('ana', format('UPDATE public.messages SET deleted_at = NULL WHERE id = %L', v_m));
  PERFORM pg_temp.ok('F-FINAL the author cannot bring it back (' || r || ')', r LIKE '23514%');
END $final$;

-- ── Adversarial client writes ─────────────────────────────────────────────
DO $adversarial$
DECLARE v_m uuid; r text;
BEGIN
  v_m := pg_temp.msg('adv', 'dm', 'ana', 'original words', 'card', NULL, NULL, false, '{"title":"x"}'::jsonb);
  r := pg_temp.try_as('ana', format('UPDATE public.messages SET content = %L WHERE id = %L', 'changed', v_m));
  PERFORM pg_temp.ok('ADV-CONTENT the author cannot change the text (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ana', format('UPDATE public.messages SET card_payload = %L WHERE id = %L', '{"title":"y"}', v_m));
  PERFORM pg_temp.ok('ADV-CARD the author cannot change the card (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ana', format('UPDATE public.messages SET file_url = %L WHERE id = %L', pg_temp.u('dm') || '/' || gen_random_uuid() || '.jpg', v_m));
  PERFORM pg_temp.ok('ADV-FILE the author cannot change the file (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ana', format('UPDATE public.messages SET conversation_id = %L WHERE id = %L', pg_temp.u('crew'), v_m));
  PERFORM pg_temp.ok('ADV-MOVE the author cannot move it to another chat (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ana', format('UPDATE public.messages SET unsent_kind = %L, unsent_at = now() WHERE id = %L', 'admin', v_m));
  PERFORM pg_temp.ok('ADV-TOMBSTONE the author cannot write the tombstone columns (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ana', format('DELETE FROM public.messages WHERE id = %L', v_m));
  PERFORM pg_temp.ok('ADV-DELETE the author cannot hard-delete (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ana', format('INSERT INTO public.messages(conversation_id, sender_id, content, unsent_kind, unsent_at, deleted_at) VALUES (%L, %L, %L, %L, now(), now())', pg_temp.u('dm'), pg_temp.u('ana'), 'born dead', 'admin'));
  PERFORM pg_temp.ok('ADV-INSERT a new message is never born a tombstone (' || r || ')', r LIKE '23514%');
  PERFORM pg_temp.ok('ADV-* the message is untouched',
    (SELECT content = 'original words' AND card_payload = '{"title":"x"}'::jsonb AND deleted_at IS NULL
       AND conversation_id = pg_temp.u('dm') FROM public.messages WHERE id = v_m));
  r := pg_temp.try_as('ben', format('UPDATE public.messages SET is_read = true, read_at = now() WHERE id = %L', v_m));
  PERFORM pg_temp.ok('ADV-READ the read flags stay writable (' || r || ')', r = 'ok');
  -- The read-receipt trigger (sync_message_read_status) updates messages as the reader.
  r := pg_temp.try_as('ben', format('INSERT INTO public.message_reads(message_id, user_id) VALUES (%L, %L)', v_m, pg_temp.u('ben')));
  PERFORM pg_temp.ok('ADV-READ a read receipt still saves (' || r || ')', r = 'ok');
  r := pg_temp.try_as('ana', format('INSERT INTO public.message_reads(message_id, user_id) VALUES (%L, %L)', v_m, pg_temp.u('ana')));
  PERFORM pg_temp.ok('ADV-READ the sender''s own read receipt still saves (' || r || ')', r = 'ok');
  r := pg_temp.try_as('ana', format('SELECT * FROM public.message_unsend_evidence'));
  PERFORM pg_temp.ok('ADV-STORE app users cannot read the private store (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ana', format('SELECT * FROM public.message_report_evidence'));
  PERFORM pg_temp.ok('ADV-STORE app users cannot read report copies (' || r || ')', r LIKE '42501%');
END $adversarial$;

-- ── Delete for me ─────────────────────────────────────────────────────────
DO $hide$
DECLARE v_m uuid; v_out uuid; r jsonb; v_res text;
BEGIN
  v_m := pg_temp.msg('hide-me', 'crew', 'tobi', 'only hide for ana');
  PERFORM pg_temp.as_user('ana');
  PERFORM set_config('role', 'authenticated', true);
  r := public.hide_messages_for_me(ARRAY[v_m]);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('D-HIDE counts one', (r ->> 'count')::int = 1);
  PERFORM pg_temp.ok('D-HIDE gone for Ana', NOT (v_m = ANY (pg_temp.visible_ids('ana', pg_temp.u('crew')))));
  PERFORM pg_temp.ok('D-HIDE still there for Ben', v_m = ANY (pg_temp.visible_ids('ben', pg_temp.u('crew'))));
  PERFORM pg_temp.ok('D-HIDE the message itself is untouched', (SELECT deleted_at IS NULL FROM public.messages WHERE id = v_m));
  v_res := pg_temp.try_as('ben', 'SELECT 1/(count(*)=0)::int FROM public.message_hidden_for');
  PERFORM pg_temp.ok('D-HIDE Ben cannot see Ana''s hide rows (' || v_res || ')', v_res = 'ok');

  PERFORM pg_temp.as_user('ana');
  PERFORM set_config('role', 'authenticated', true);
  r := public.unhide_messages_for_me(ARRAY[v_m]);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('D-UNHIDE Undo brings it back', (r ->> 'count')::int = 1 AND v_m = ANY (pg_temp.visible_ids('ana', pg_temp.u('crew'))));

  v_out := pg_temp.u('outside');
  PERFORM pg_temp.as_user('eve');
  PERFORM set_config('role', 'authenticated', true);
  r := public.hide_messages_for_me(ARRAY[v_out]);
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('D-OUTSIDER hiding a message in a chat I''m not in inserts nothing', (r ->> 'count')::int = 0);
  v_res := pg_temp.try_as('eve', format('INSERT INTO public.message_hidden_for(user_id, message_id) VALUES (%L, %L)', pg_temp.u('eve'), v_out));
  PERFORM pg_temp.ok('D-DIRECT a direct insert for an unreadable message is refused (' || v_res || ')', v_res LIKE '42501%');
  v_res := pg_temp.try_as('eve', format('INSERT INTO public.message_hidden_for(user_id, message_id) VALUES (%L, %L)', pg_temp.u('ben'), v_m));
  PERFORM pg_temp.ok('D-DIRECT nobody hides for someone else (' || v_res || ')', v_res LIKE '42501%');
  v_res := pg_temp.try_as('ana', format('UPDATE public.message_hidden_for SET user_id = %L', pg_temp.u('ben')));
  PERFORM pg_temp.ok('D-DIRECT hide rows cannot be moved (' || v_res || ')', v_res LIKE '42501%');
END $hide$;

-- ── Chat files ────────────────────────────────────────────────────────────
DO $files$
DECLARE
  v_file text := pg_temp.u('crew') || '/' || gen_random_uuid() || '.jpg';
  v_thumb text;
  v_m uuid; v_new text; r text;
BEGIN
  v_thumb := regexp_replace(v_file, '\.jpg$', '_thumb.jpg');
  v_m := pg_temp.msg('file1', 'crew', 'ana', '', 'image', v_file, v_thumb);
  PERFORM pg_temp.ok('F-STORAGE a member reads a live photo', pg_temp.can_read('ben', v_file, 'ana') AND pg_temp.can_read('ben', v_thumb, 'ana'));
  PERFORM pg_temp.ok('F-STORAGE an outsider does not', NOT pg_temp.can_read('eve', v_file, 'ana'));
  r := pg_temp.unsend('ana', ARRAY[v_m]);
  PERFORM pg_temp.ok('F-STORAGE after unsend no member reads the photo or thumbnail',
    NOT pg_temp.can_read('ben', v_file, 'ana') AND NOT pg_temp.can_read('ben', v_thumb, 'ana'));
  PERFORM pg_temp.ok('F-STORAGE nor its uploader', NOT pg_temp.can_read('ana', v_file, 'ana'));
  v_new := pg_temp.u('crew') || '/' || gen_random_uuid() || '.jpg';
  PERFORM pg_temp.ok('F-STORAGE a file no live message points at is the uploader''s only',
    pg_temp.can_read('ana', v_new, 'ana') AND NOT pg_temp.can_read('ben', v_new, 'ana'));
  r := pg_temp.try_as('ben', format(
    'INSERT INTO public.messages(conversation_id, sender_id, content, message_type, file_url) VALUES (%L, %L, %L, %L, %L)',
    pg_temp.u('crew'), pg_temp.u('ben'), '', 'image', v_file));
  PERFORM pg_temp.ok('F-REUSE a new message cannot point at an unsent file (' || r || ')', r LIKE '23514%');
END $files$;

-- ── Reports ───────────────────────────────────────────────────────────────
DO $reports$
DECLARE v_m uuid; v_r uuid; r text;
BEGIN
  v_m := pg_temp.msg('reported', 'crew', 'tobi', 'nasty words');
  PERFORM pg_temp.as_user('ben');
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.user_reports(reporter_id, reported_user_id, reason, details, message_id)
    VALUES (pg_temp.u('ben'), pg_temp.u('tobi'), 'harassment', 'in the crew chat', v_m)
    RETURNING id INTO v_r;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ok('R-REPORT the server keeps its own copy',
    (SELECT snapshot ->> 'content' = 'nasty words' AND message_id = v_m FROM public.message_report_evidence WHERE report_id = v_r));
  r := pg_temp.try_as('eve', format(
    'INSERT INTO public.user_reports(reporter_id, reported_user_id, reason, message_id) VALUES (%L, %L, %L, %L)',
    pg_temp.u('eve'), pg_temp.u('tobi'), 'spam', v_m));
  PERFORM pg_temp.ok('R-REPORT-FORGED an outsider cannot report a message they cannot see (' || r || ')', r LIKE '42501%');
  r := pg_temp.try_as('ben', format(
    'INSERT INTO public.user_reports(reporter_id, reported_user_id, reason, message_id) VALUES (%L, %L, %L, %L)',
    pg_temp.u('ben'), pg_temp.u('sam'), 'spam', v_m));
  PERFORM pg_temp.ok('R-REPORT-FORGED nor pin it on someone who did not write it (' || r || ')', r LIKE '42501%');
  INSERT INTO k VALUES ('report', v_r);
END $reports$;

-- ── Retention and the sweep ───────────────────────────────────────────────
DO $sweep$
DECLARE v_photo uuid := pg_temp.u('photo'); v_held uuid := pg_temp.u('reported'); v_text uuid := pg_temp.u('t1');
  v_due record; n integer; r text;
BEGIN
  r := pg_temp.unsend('tobi', ARRAY[v_held]);
  PERFORM pg_temp.ok('P-HELD reported message unsent', pg_temp.scrubbed(v_held));
  PERFORM pg_temp.ok('P-SWEEP nothing is due inside 30 days',
    NOT EXISTS (SELECT 1 FROM public.issue_4114_view_once_media_due(1000, now()) d WHERE d.reason = 'unsent_retention' AND d.message_id = v_photo));
  PERFORM pg_temp.ok('P-SWEEP the orphan rule leaves the kept files alone',
    NOT EXISTS (SELECT 1 FROM public.issue_4114_view_once_media_due(1000, now() + interval '3 days') d
                 JOIN public.message_unsend_evidence e ON d.storage_path IN (e.file_path, e.thumb_path)
                WHERE d.reason <> 'unsent_retention'));
  PERFORM pg_temp.ok('P-SWEEP after 30 days the photo and thumbnail are listed',
    (SELECT count(*) FROM public.issue_4114_view_once_media_due(1000, now() + interval '31 days') d
      WHERE d.reason = 'unsent_retention' AND d.message_id = v_photo) = 2);
  n := public.issue_4456_purge_unsent_evidence(ARRAY[v_photo, v_held], now() + interval '31 days');
  PERFORM pg_temp.ok('P-SWEEP the copy goes after the files', NOT EXISTS (SELECT 1 FROM public.message_unsend_evidence WHERE message_id = v_photo));
  PERFORM pg_temp.ok('P-SWEEP text-only copies go too', NOT EXISTS (SELECT 1 FROM public.message_unsend_evidence WHERE message_id = v_text));
  PERFORM pg_temp.ok('P-HELD an open report keeps the copy', EXISTS (SELECT 1 FROM public.message_unsend_evidence WHERE message_id = v_held));
  UPDATE public.user_reports SET status = 'resolved' WHERE id = pg_temp.u('report');
  n := public.issue_4456_purge_unsent_evidence(ARRAY[v_held], now() + interval '31 days');
  PERFORM pg_temp.ok('P-HELD once the report closes the copy goes', NOT EXISTS (SELECT 1 FROM public.message_unsend_evidence WHERE message_id = v_held));
  r := pg_temp.unsend('ana', ARRAY[pg_temp.msg('fresh', 'dm', 'ana', 'just now')]);
  PERFORM pg_temp.ok('P-SWEEP nothing reaches a copy before its date',
    public.issue_4456_purge_unsent_evidence(ARRAY[pg_temp.u('fresh')], now()) = 0
    AND EXISTS (SELECT 1 FROM public.message_unsend_evidence WHERE message_id = pg_temp.u('fresh')));
END $sweep$;

-- ── The rows unsent before this migration ─────────────────────────────────
DO $backfill$
DECLARE v_m uuid; v_plan_like uuid;
BEGIN
  v_m := pg_temp.msg('pre', 'dm', 'ben', 'removed in 2027', 'image', pg_temp.u('dm') || '/once/' || gen_random_uuid() || '.jpg', NULL, true);
  v_plan_like := pg_temp.msg('pre-sys', 'dm', 'ben', 'system line', 'system');
  -- As before this migration: removed with nothing wiped.
  ALTER TABLE public.messages DISABLE TRIGGER issue_4456_tombstone;
  UPDATE public.messages SET deleted_at = now() - interval '5 days' WHERE id IN (v_m, v_plan_like);
  ALTER TABLE public.messages ENABLE TRIGGER issue_4456_tombstone;
  PERFORM pg_temp.as_server();
  UPDATE public.messages
     SET unsent_at = now(), unsent_kind = 'legacy'
   WHERE deleted_at IS NOT NULL AND unsent_at IS NULL
     AND public.issue_4456_is_unsendable_type(message_type);
  PERFORM pg_temp.ok('B-BACKFILL an old removed view-once photo is wiped as legacy',
    pg_temp.scrubbed(v_m) AND (SELECT unsent_kind = 'legacy' FROM public.messages WHERE id = v_m)
    AND (SELECT original ->> 'content' = 'removed in 2027' AND unsent_kind = 'legacy' FROM public.message_unsend_evidence WHERE message_id = v_m));
  PERFORM pg_temp.ok('B-BACKFILL server-owned rows are left as they were',
    (SELECT unsent_at IS NULL AND content = 'system line' FROM public.messages WHERE id = v_plan_like));
  PERFORM pg_temp.ok('B-BACKFILL the migration left no unwiped removed message behind',
    NOT EXISTS (SELECT 1 FROM public.messages WHERE deleted_at IS NOT NULL AND unsent_at IS NULL
                  AND public.issue_4456_is_unsendable_type(message_type)));
END $backfill$;

-- ── Catalog ───────────────────────────────────────────────────────────────
DO $catalog$
BEGIN
  PERFORM pg_temp.ok('T-CATALOG authenticated cannot UPDATE content, card, file or chat',
    NOT has_column_privilege('authenticated', 'public.messages', 'content', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.messages', 'card_payload', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.messages', 'file_url', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.messages', 'conversation_id', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.messages', 'unsent_kind', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.messages', 'deleted_at', 'UPDATE'));
  PERFORM pg_temp.ok('T-CATALOG no client DELETE, no anon UPDATE',
    NOT has_table_privilege('authenticated', 'public.messages', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.messages', 'DELETE')
    AND NOT has_column_privilege('anon', 'public.messages', 'deleted_at', 'UPDATE'));
  PERFORM pg_temp.ok('T-CATALOG the store is server only',
    NOT has_table_privilege('authenticated', 'public.message_unsend_evidence', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.message_unsend_evidence', 'SELECT'));
  PERFORM pg_temp.ok('T-CATALOG Delete for me is a RESTRICTIVE SELECT policy',
    EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'messages'
              AND policyname = 'messages_hidden_for_me' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'));
  PERFORM pg_temp.ok('T-CATALOG the tombstone trigger runs after the view-once check and before the plan guard',
    'issue_4114_view_once_shape' < 'issue_4456_tombstone' AND 'issue_4456_tombstone' < 'tg_4261_guard_plan_messages');
  PERFORM pg_temp.ok('T-CATALOG unsend_messages is not callable by anon',
    NOT has_function_privilege('anon', 'public.unsend_messages(uuid[])', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.unsend_messages(uuid[])', 'EXECUTE'));
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    PERFORM pg_temp.ok('T-CATALOG messages and conversations stay published; hide rows are not',
      EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages')
      AND EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations')
      AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_hidden_for'));
  END IF;
END $catalog$;

ROLLBACK;
