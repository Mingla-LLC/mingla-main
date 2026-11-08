\set ON_ERROR_STOP on

-- Issue #4261 Wave A2 — plans in the chat (chat plans + deck matches).
--
--   P-01  create place(pool) / address / link / none x set / poll / none;
--         pool values come from place_pool, never from the client.
--   P-02  create is idempotent by client_id.
--   P-03  the plan message is type plan; a member cannot insert a plan
--         message directly, and its sender cannot update or delete it.
--   P-04  vote / RSVP / thumbs toggles are idempotent and post NO messages.
--   P-05  add_option posts exactly one time_added line; a duplicate time adds
--         a vote and no line; the creator's own early times post nothing; the
--         9th time -> PT409.
--   P-06  lock by a non-creator -> not_allowed; by the creator -> scheduled,
--         one locked line, calendar rows only for Going members; an RSVP
--         change after lock moves the calendar rows.
--   P-07  deck: a saved card gets its deck plan; deck thumbs write
--         board_votes; deck Maybe writes board_card_rsvps.maybe; deck
--         add_option flips when_mode to poll; deck lock by a non-admin ->
--         not_allowed, by the admin -> board_saved_cards.is_locked + the
--         existing card message, and the plan row itself is not mirrored.
--   P-08  a reply to a plan gets plan_id + a server plan_quote of the sender's
--         own votes and RSVP; a forged cross-chat plan_id is nulled; a forged
--         plan_quote is replaced; an edit cannot change either.
--   P-09  a non-member reads zero rows from the five plan tables and
--         chat_plans_for_conversation -> not_allowed; the member list shape.
--   P-10  a plan in a program or support chat -> not_allowed; a blocked pair
--         -> unavailable.
--   P-11  cancel removes calendar rows and posts one line; cancel twice and
--         RSVP after cancel -> PT409.
--   P-12  search_plan_places excludes is_servable = false, prefix first,
--         needs 2+ characters; plan_create refuses a non-servable pool id.
--   P-13  the message_type CHECK still accepts the seven prior types + plan.
--   P-14  realtime publication carries chat_plans and group_join_requests.
--   P-15  deleting a saved card cascades its deck plan, options and votes;
--         deleting a chat with a plan works.
--   P-16  grants: anon has nothing on the five tables, authenticated only
--         SELECT; RPCs authenticated-only; helpers internal.
--
-- MINGLA-INVARIANT: I-4261-ONE-PLAN-ENTITY | issue #4261 | Every Matches or Plans card is exactly one chat_plans row; a deck match's row is created by the saved-card trigger and its lock truth stays board_saved_cards.is_locked.
-- MINGLA-INVARIANT: I-4261-VOTES-POST-NO-LINES | issue #4261 | Time votes, RSVPs and thumbs never insert a chat message; only plan creation, new times, lock-in, cancel and group joins do.
-- MINGLA-INVARIANT: I-4261-PLAN-MESSAGES-RPC-ONLY | issue #4261 | A message of type plan is written, changed or deleted only inside the plan RPCs.
-- MINGLA-INVARIANT: I-4261-PLAN-QUOTE-SERVER-OWNED | issue #4261 | messages.plan_id and plan_quote are set by the server trigger from the sender's own plan state; client values are discarded.
--
-- FAILS-ON-REVERT (replay the chain without
-- 20280403044261_issue_4261_chat_plans.sql): the \ir below is the migration
-- itself; without it P-01 fails on its first call (plan_create does not
-- exist) and P-07 finds no deck plan for a new saved card.
--
-- Run after the full migration chain on PostgreSQL 17. The re-apply proves
-- the migration is idempotent; everything after it rolls back.

-- #4334 renamed mapbox_id to provider_place_id and regenerated every plan
-- function body, so the 4261 files can no longer re-run on top of it. The
-- re-apply is of the current owner of those bodies, which also proves it is
-- idempotent.
\ir ../20280513004334_issue_4334_google_places.sql

BEGIN;

-- The bare PostgreSQL image has no Supabase Realtime server, so the ORCH-0931
-- session_updated broadcast trigger would fail on realtime.send. Switch that
-- one trigger off for this transaction when realtime.send is missing (the
-- ROLLBACK restores it). Same pattern as issue_4114_dm_collab.
DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

CREATE TEMP TABLE t4261p_ids (tag text PRIMARY KEY, id uuid NOT NULL);
CREATE TEMP TABLE t4261p_vals (tag text PRIMARY KEY, val text);
GRANT SELECT ON t4261p_ids TO authenticated;
GRANT SELECT, INSERT, UPDATE ON t4261p_vals TO authenticated;

CREATE FUNCTION pg_temp.t4261p_as(p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM t4261p_ids WHERE tag = p_tag;
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $f$;
CREATE FUNCTION pg_temp.t4261p_id(p_tag text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM t4261p_ids WHERE tag = p_tag
$f$;
CREATE FUNCTION pg_temp.t4261p_val(p_tag text) RETURNS text LANGUAGE sql AS $f$
  SELECT val FROM t4261p_vals WHERE tag = p_tag
$f$;
CREATE FUNCTION pg_temp.t4261p_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $f$;
CREATE FUNCTION pg_temp.t4261p_msgs(p_conv uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM public.messages WHERE conversation_id = p_conv
$f$;

DO $fixture$
DECLARE
  v_tag text;
  v_id uuid;
  v_conv uuid;
  v_session uuid;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['seth','ada','kemi','tobi','outsider','blk'] LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4261p-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 't4261p-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4261p_ids VALUES (v_tag, v_id);
  END LOOP;

  -- DM Seth <-> Ada.
  INSERT INTO public.conversations(type, linked_entity_type, created_by)
    VALUES ('direct', 'direct', pg_temp.t4261p_id('seth')) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id)
    VALUES (v_conv, pg_temp.t4261p_id('seth')), (v_conv, pg_temp.t4261p_id('ada'));
  INSERT INTO t4261p_ids VALUES ('dm', v_conv);

  -- DM Kemi <-> Blk, where Kemi blocked Blk.
  INSERT INTO public.conversations(type, linked_entity_type, created_by)
    VALUES ('direct', 'direct', pg_temp.t4261p_id('kemi')) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id)
    VALUES (v_conv, pg_temp.t4261p_id('kemi')), (v_conv, pg_temp.t4261p_id('blk'));
  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (pg_temp.t4261p_id('kemi'), pg_temp.t4261p_id('blk'));
  INSERT INTO t4261p_ids VALUES ('dm_blocked', v_conv);

  -- Plain group "Book club": Seth (creator), Ada, Kemi.
  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
    VALUES ('group', 'direct', 'Book club', pg_temp.t4261p_id('seth')) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES
    (v_conv, pg_temp.t4261p_id('seth')), (v_conv, pg_temp.t4261p_id('ada')), (v_conv, pg_temp.t4261p_id('kemi'));
  INSERT INTO t4261p_ids VALUES ('plain', v_conv);

  -- Program chat and support chat (not plan chats).
  INSERT INTO public.conversations(type, linked_entity_type, name, created_by, program_kind, program_target_user_id)
    VALUES ('group', 'direct', 'Mingla Local', pg_temp.t4261p_id('seth'), 'local', pg_temp.t4261p_id('seth'))
    RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_conv, pg_temp.t4261p_id('seth'));
  INSERT INTO t4261p_ids VALUES ('program', v_conv);
  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
    VALUES ('group', 'support', 'Support', pg_temp.t4261p_id('seth')) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_conv, pg_temp.t4261p_id('seth'));
  INSERT INTO t4261p_ids VALUES ('support', v_conv);

  -- Session group "Saturday crew": Tobi creates; Seth, Ada, Kemi accepted.
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('Saturday crew', pg_temp.t4261p_id('tobi'), 'active') RETURNING id INTO v_session;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_session, pg_temp.t4261p_id('tobi'), true), (v_session, pg_temp.t4261p_id('seth'), true),
    (v_session, pg_temp.t4261p_id('ada'), true), (v_session, pg_temp.t4261p_id('kemi'), true);
  INSERT INTO t4261p_ids VALUES ('session', v_session), ('crew', public.resolve_session_conversation(v_session));

  -- Place pool.
  INSERT INTO public.place_pool(google_place_id, name, address, city, lat, lng, is_active, is_servable, stored_photo_urls)
    VALUES ('t4261p-skyline', 'Skyline Terrace T4261', '1 Marina Rd, Lagos', 'Lagos', 6.45, 3.39, true, true,
            ARRAY['https://example.test/skyline.jpg'])
    RETURNING id INTO v_id;
  INSERT INTO t4261p_ids VALUES ('pool_skyline', v_id);
  INSERT INTO public.place_pool(google_place_id, name, address, city, lat, lng, is_active, is_servable)
    VALUES ('t4261p-hidden', 'Skyline Hidden T4261', '2 Marina Rd, Lagos', 'Lagos', 6.46, 3.38, true, false)
    RETURNING id INTO v_id;
  INSERT INTO t4261p_ids VALUES ('pool_hidden', v_id);
END $fixture$;

-- ── P-16 grants ─────────────────────────────────────────────────────────────
DO $p16$
DECLARE
  v_t text;
  v_p text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['chat_plans','chat_plan_time_options','chat_plan_time_votes','chat_plan_rsvps','chat_plan_reactions'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass) THEN
      RAISE EXCEPTION 'P-16: RLS must be enabled on %', v_t;
    END IF;
    FOREACH v_p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || v_t, v_p) THEN
        RAISE EXCEPTION 'P-16: anon must not hold % on %', v_p, v_t;
      END IF;
      IF v_p <> 'SELECT' AND has_table_privilege('authenticated', 'public.' || v_t, v_p) THEN
        RAISE EXCEPTION 'P-16: authenticated must not hold % on %', v_p, v_t;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_p IN ARRAY ARRAY[
    'public.plan_create(uuid,uuid,text,text,jsonb,text,text,timestamptz,timestamptz[],boolean,text)',
    'public.plan_add_option(uuid,timestamptz)', 'public.plan_set_vote(uuid,boolean)',
    'public.plan_set_rsvp(uuid,text)', 'public.plan_set_reaction(uuid,text)',
    'public.plan_lock(uuid,uuid,timestamptz,integer,uuid)', 'public.plan_update(uuid,text,text)',
    'public.plan_cancel(uuid)', 'public.chat_plans_for_conversation(uuid)',
    'public.search_plan_places(text,double precision,double precision,integer)'] LOOP
    IF has_function_privilege('anon', v_p, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_p, 'EXECUTE') THEN
      RAISE EXCEPTION 'P-16: % must be authenticated-only', v_p;
    END IF;
  END LOOP;
  FOREACH v_p IN ARRAY ARRAY[
    'public.chat_plan_require_member(uuid,uuid)', 'public.chat_plan_can_lock(public.chat_plans,uuid)',
    'public.chat_plan_effective_status(public.chat_plans)',
    'public.chat_plan_post_event(uuid,uuid,text,uuid,jsonb,text)', 'public.chat_plan_sync_calendar(uuid)',
    'public.chat_plan_check_time(timestamptz,text)'] LOOP
    IF has_function_privilege('authenticated', v_p, 'EXECUTE') OR has_function_privilege('anon', v_p, 'EXECUTE') THEN
      RAISE EXCEPTION 'P-16: % is internal', v_p;
    END IF;
  END LOOP;
END $p16$;

-- ── P-01 create ─────────────────────────────────────────────────────────────
DO $p01$
DECLARE
  r jsonb;
  v_plan public.chat_plans%ROWTYPE;
  v_before bigint := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
BEGIN
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  -- a) pool place, time vote with two times. The client lies about the name.
  r := public.plan_create(pg_temp.t4261p_id('plain'), '00000000-0000-4000-8000-000000004261', 'Rooftop drinks',
         'place', jsonb_build_object('poolId', pg_temp.t4261p_id('pool_skyline'), 'name', 'FAKE NAME', 'lat', 1, 'lng', 1),
         NULL, 'poll', NULL, ARRAY[now() + interval '2 days', now() + interval '3 days'], true, 'Bring cash');
  INSERT INTO t4261p_vals VALUES ('plan_a', r ->> 'planId'), ('msg_a', r ->> 'messageId');
  -- b) typed address, set time.
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, NULL, 'address',
         jsonb_build_object('name', '12 Admiralty Way'), NULL, 'set', now() + interval '5 days', NULL, NULL, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_b', r ->> 'planId');
  -- c) link, no time, blank title -> domain.
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, '  ', 'link', NULL,
         'https://www.Example.com/events/42?ref=chat', 'none', NULL, NULL, NULL, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_c', r ->> 'planId');
  -- d) nowhere, no time.
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, 'Board games', 'none', NULL, NULL, 'none', NULL, NULL, NULL, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_d', r ->> 'planId');
  -- e) Google place in the DM, a vote with no times yet.
  r := public.plan_create(pg_temp.t4261p_id('dm'), NULL, NULL, 'place',
         jsonb_build_object('providerPlaceId', 'ChIJlekkiConservation1', 'name', 'Lekki Conservation Centre', 'address', 'Lekki, Lagos', 'lat', 6.44, 'lng', 3.53),
         NULL, 'poll', NULL, NULL, true, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_e', r ->> 'planId');
  RESET ROLE;

  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) - v_before <> 4 THEN
    RAISE EXCEPTION 'P-01: four plans in Book club post four plan messages';
  END IF;

  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_a')::uuid;
  IF v_plan.place_name <> 'Skyline Terrace T4261' OR v_plan.place_address <> '1 Marina Rd, Lagos'
     OR v_plan.place_lat <> 6.45 OR v_plan.place_photo_url <> 'https://example.test/skyline.jpg'
     OR v_plan.status <> 'deciding' OR v_plan.when_mode <> 'poll' OR v_plan.note <> 'Bring cash'
     OR v_plan.title <> 'Rooftop drinks' OR v_plan.source <> 'chat' THEN
    RAISE EXCEPTION 'P-01a: pool values come from place_pool (got %)', row_to_json(v_plan);
  END IF;
  IF (SELECT count(*) FROM public.chat_plan_time_options WHERE plan_id = v_plan.id) <> 2 THEN
    RAISE EXCEPTION 'P-01a: two time options';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_plan_rsvps WHERE plan_id = v_plan.id AND user_id = pg_temp.t4261p_id('seth') AND status = 'going') THEN
    RAISE EXCEPTION 'P-01a: the creator is Going';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages
       WHERE id = pg_temp.t4261p_val('msg_a')::uuid AND message_type = 'plan' AND plan_id = v_plan.id
         AND card_payload = jsonb_build_object('kind', 'plan', 'planId', v_plan.id)
         AND content = 'Seth added a plan: Rooftop drinks' AND sender_id = pg_temp.t4261p_id('seth')) THEN
    RAISE EXCEPTION 'P-01a: the plan message';
  END IF;
  IF v_plan.message_id <> pg_temp.t4261p_val('msg_a')::uuid THEN
    RAISE EXCEPTION 'P-01a: the plan stores its message';
  END IF;

  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_b')::uuid;
  IF v_plan.status <> 'scheduled' OR v_plan.duration_minutes <> 120 OR v_plan.locked_by <> pg_temp.t4261p_id('seth')
     OR v_plan.title <> '12 Admiralty Way' OR v_plan.where_kind <> 'address' THEN
    RAISE EXCEPTION 'P-01b: set-time plan (got %)', row_to_json(v_plan);
  END IF;
  IF (SELECT count(*) FROM public.calendar_entries WHERE chat_plan_id = v_plan.id) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.calendar_entries WHERE chat_plan_id = v_plan.id
                    AND user_id = pg_temp.t4261p_id('seth') AND source = 'chat_plan' AND status = 'confirmed'
                    AND scheduled_at = v_plan.scheduled_at AND card_data ->> 'title' = '12 Admiralty Way') THEN
    RAISE EXCEPTION 'P-01b: a set-time plan is on the creator''s calendar at once';
  END IF;

  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_c')::uuid;
  IF v_plan.link_domain <> 'example.com' OR v_plan.title <> 'example.com' OR v_plan.where_kind <> 'link' THEN
    RAISE EXCEPTION 'P-01c: link domain and default title (got %)', row_to_json(v_plan);
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_d')::uuid;
  IF v_plan.where_kind <> 'none' OR v_plan.when_mode <> 'none' OR v_plan.title <> 'Board games' THEN
    RAISE EXCEPTION 'P-01d: none/none';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_e')::uuid;
  IF v_plan.provider_place_id <> 'ChIJlekkiConservation1' OR v_plan.place_pool_id IS NOT NULL OR v_plan.place_photo_url IS NOT NULL
     OR v_plan.title <> 'Lekki Conservation Centre' THEN
    RAISE EXCEPTION 'P-01e: Google place';
  END IF;

  -- Validation refusals.
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  IF pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, 'x', 'none', NULL, NULL, 'set', now() - interval '1 hour', NULL, NULL, NULL)$q$, pg_temp.t4261p_id('plain'))) NOT LIKE '22023:invalid_input' THEN
    RAISE EXCEPTION 'P-01: a past set time is invalid_input';
  END IF;
  IF pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, 'x', 'link', NULL, 'javascript:alert(1)', 'none', NULL, NULL, NULL, NULL)$q$, pg_temp.t4261p_id('plain'))) NOT LIKE '22023:invalid_input' THEN
    RAISE EXCEPTION 'P-01: a non-http link is invalid_input';
  END IF;
  IF pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, 'x', 'none', NULL, NULL, 'poll', NULL, ARRAY[now() + interval '1 day'], false, NULL)$q$, pg_temp.t4261p_id('plain'))) NOT LIKE '22023:invalid_input' THEN
    RAISE EXCEPTION 'P-01: a closed vote needs two times';
  END IF;
  RESET ROLE;
END $p01$;

-- ── P-02 idempotent ─────────────────────────────────────────────────────────
DO $p02$
DECLARE
  r jsonb;
  v_before bigint := (SELECT count(*) FROM public.chat_plans) + pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
BEGIN
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.plan_create(pg_temp.t4261p_id('plain'), '00000000-0000-4000-8000-000000004261', 'Rooftop drinks again',
         'none', NULL, NULL, 'none', NULL, NULL, NULL, NULL);
  RESET ROLE;
  IF (r ->> 'created')::boolean OR r ->> 'planId' <> pg_temp.t4261p_val('plan_a') OR r ->> 'messageId' <> pg_temp.t4261p_val('msg_a') THEN
    RAISE EXCEPTION 'P-02: same client_id returns the first plan (got %)', r;
  END IF;
  IF v_before <> (SELECT count(*) FROM public.chat_plans) + pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) THEN
    RAISE EXCEPTION 'P-02: a retry writes nothing';
  END IF;
END $p02$;

-- ── P-03 plan messages are RPC-only ────────────────────────────────────────
DO $p03$
DECLARE
  v_err text;
BEGIN
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format(
    $q$INSERT INTO public.messages(conversation_id, sender_id, content, message_type, card_payload, plan_id)
       VALUES (%L, %L, 'fake', 'plan', jsonb_build_object('kind','plan','planId',%L::uuid), %L)$q$,
    pg_temp.t4261p_id('plain'), pg_temp.t4261p_id('ada'), pg_temp.t4261p_val('plan_a'), pg_temp.t4261p_val('plan_a')));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-03: a member cannot insert a plan message (got %)', v_err;
  END IF;

  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format($q$UPDATE public.messages SET content = 'edited' WHERE id = %L$q$, pg_temp.t4261p_val('msg_a')));
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-03: the sender cannot edit a plan message (got %)', v_err;
  END IF;
  v_err := pg_temp.t4261p_try(format($q$UPDATE public.messages SET deleted_at = now() WHERE id = %L$q$, pg_temp.t4261p_val('msg_a')));
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-03: the sender cannot unsend a plan message (got %)', v_err;
  END IF;
  v_err := pg_temp.t4261p_try(format($q$DELETE FROM public.messages WHERE id = %L$q$, pg_temp.t4261p_val('msg_a')));
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-03: the sender cannot delete a plan message (got %)', v_err;
  END IF;
  -- An ordinary message cannot be turned into a plan message.
  INSERT INTO public.messages(conversation_id, sender_id, content)
    VALUES (pg_temp.t4261p_id('plain'), pg_temp.t4261p_id('seth'), 'hello') ;
  v_err := pg_temp.t4261p_try(format(
    $q$UPDATE public.messages SET message_type = 'plan', plan_id = %L, card_payload = jsonb_build_object('kind','plan')
       WHERE conversation_id = %L AND content = 'hello'$q$, pg_temp.t4261p_val('plan_a'), pg_temp.t4261p_id('plain')));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-03: a message cannot become a plan message (got %)', v_err;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = pg_temp.t4261p_val('msg_a')::uuid
                 AND content = 'Seth added a plan: Rooftop drinks' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'P-03: the plan message is unchanged';
  END IF;
END $p03$;

-- ── P-04 votes, RSVPs and thumbs post no lines ─────────────────────────────
DO $p04$
DECLARE
  v_before bigint := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  v_opt uuid := (SELECT id FROM public.chat_plan_time_options WHERE plan_id = pg_temp.t4261p_val('plan_a')::uuid ORDER BY starts_at LIMIT 1);
  v_plan uuid := pg_temp.t4261p_val('plan_a')::uuid;
BEGIN
  INSERT INTO t4261p_vals VALUES ('opt_a1', v_opt::text);
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_set_vote(v_opt, true);
  PERFORM public.plan_set_vote(v_opt, true);
  PERFORM public.plan_set_vote(v_opt, false);
  PERFORM public.plan_set_vote(v_opt, true);
  PERFORM public.plan_set_rsvp(v_plan, 'maybe');
  PERFORM public.plan_set_rsvp(v_plan, 'maybe');
  PERFORM public.plan_set_rsvp(v_plan, NULL);
  PERFORM public.plan_set_rsvp(v_plan, 'going');
  PERFORM public.plan_set_reaction(v_plan, 'up');
  PERFORM public.plan_set_reaction(v_plan, 'up');
  PERFORM public.plan_set_reaction(v_plan, NULL);
  PERFORM public.plan_set_reaction(v_plan, 'down');
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_set_rsvp(v_plan, 'maybe');
  PERFORM public.plan_set_reaction(v_plan, 'up');
  RESET ROLE;

  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) <> v_before THEN
    RAISE EXCEPTION 'P-04: votes, RSVPs and thumbs must post no messages (% -> %)', v_before, pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  END IF;
  IF (SELECT count(*) FROM public.chat_plan_time_votes WHERE option_id = v_opt AND user_id = pg_temp.t4261p_id('ada')) <> 1
     OR (SELECT status FROM public.chat_plan_rsvps WHERE plan_id = v_plan AND user_id = pg_temp.t4261p_id('ada')) <> 'going'
     OR (SELECT kind FROM public.chat_plan_reactions WHERE plan_id = v_plan AND user_id = pg_temp.t4261p_id('ada')) <> 'down' THEN
    RAISE EXCEPTION 'P-04: final vote/RSVP/thumb state';
  END IF;
END $p04$;

-- ── P-05 new times ──────────────────────────────────────────────────────────
DO $p05$
DECLARE
  r jsonb;
  v_before bigint;
  v_plan uuid := pg_temp.t4261p_val('plan_a')::uuid;
  v_t timestamptz := date_trunc('hour', now()) + interval '4 days';
  v_err text;
  i int;
BEGIN
  -- The creator adding a time within a minute of creating posts nothing.
  v_before := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.plan_add_option(v_plan, v_t - interval '12 hours');
  RESET ROLE;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) <> v_before OR (r ->> 'existed')::boolean THEN
    RAISE EXCEPTION 'P-05: the creator''s own early time posts no line (got %)', r;
  END IF;

  v_before := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  r := public.plan_add_option(v_plan, v_t);
  RESET ROLE;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) - v_before <> 1 THEN
    RAISE EXCEPTION 'P-05: a new time posts exactly one line';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('plain')
       AND message_type = 'system' AND card_payload ->> 'kind' = 'plan_event' AND card_payload ->> 'event' = 'time_added'
       AND card_payload ->> 'planId' = v_plan::text AND card_payload ->> 'actorId' = pg_temp.t4261p_id('ada')::text
       AND (card_payload ->> 'startsAt')::timestamptz = v_t AND sender_id IS NULL AND plan_id IS NULL
       AND content = 'Ada added a time to the vote on Rooftop drinks') THEN
    RAISE EXCEPTION 'P-05: the time_added line shape';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_plan_time_votes WHERE option_id = (r ->> 'optionId')::uuid AND user_id = pg_temp.t4261p_id('ada')) THEN
    RAISE EXCEPTION 'P-05: adding a time votes for it';
  END IF;

  v_before := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  r := public.plan_add_option(v_plan, v_t);
  RESET ROLE;
  IF (r ->> 'existed')::boolean IS NOT TRUE OR pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) <> v_before
     OR NOT EXISTS (SELECT 1 FROM public.chat_plan_time_votes WHERE option_id = (r ->> 'optionId')::uuid AND user_id = pg_temp.t4261p_id('kemi')) THEN
    RAISE EXCEPTION 'P-05: a duplicate time adds a vote and no line (got %)', r;
  END IF;

  -- 4 options now; fill to 8, then the 9th is refused.
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  FOR i IN 1..4 LOOP
    PERFORM public.plan_add_option(v_plan, v_t + make_interval(days => i));
  END LOOP;
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_add_option(%L, %L)', v_plan, v_t + interval '20 days'));
  RESET ROLE;
  IF (SELECT count(*) FROM public.chat_plan_time_options WHERE plan_id = v_plan) <> 8 THEN
    RAISE EXCEPTION 'P-05: eight options before the ninth';
  END IF;
  IF v_err <> 'PT409:conflict_too_many_times' THEN
    RAISE EXCEPTION 'P-05: the ninth time is PT409 (got %)', v_err;
  END IF;
END $p05$;

-- ── P-06 lock ───────────────────────────────────────────────────────────────
DO $p06$
DECLARE
  r jsonb;
  v_err text;
  v_before bigint;
  v_plan uuid := pg_temp.t4261p_val('plan_a')::uuid;
  v_opt uuid := pg_temp.t4261p_val('opt_a1')::uuid;
BEGIN
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_lock(%L, %L)', v_plan, v_opt));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-06: a non-creator cannot lock (got %)', v_err;
  END IF;

  v_before := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.plan_lock(v_plan, v_opt);
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_lock(%L, %L)', v_plan, v_opt));
  RESET ROLE;
  IF v_err <> 'PT409:conflict_plan_not_deciding' THEN
    RAISE EXCEPTION 'P-06: locking twice is PT409 (got %)', v_err;
  END IF;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) - v_before <> 1
     OR NOT EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('plain')
       AND card_payload ->> 'event' = 'locked' AND card_payload ->> 'planId' = v_plan::text
       AND content = 'Seth locked in Rooftop drinks') THEN
    RAISE EXCEPTION 'P-06: one locked line';
  END IF;
  IF (SELECT status FROM public.chat_plans WHERE id = v_plan) <> 'scheduled'
     OR (SELECT scheduled_at FROM public.chat_plans WHERE id = v_plan) <> (SELECT starts_at FROM public.chat_plan_time_options WHERE id = v_opt) THEN
    RAISE EXCEPTION 'P-06: scheduled at the chosen time';
  END IF;
  -- Going: Seth + Ada. Kemi is Maybe.
  IF (SELECT array_agg(user_id ORDER BY user_id) FROM public.calendar_entries WHERE chat_plan_id = v_plan)
     <> (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.t4261p_id('seth'), pg_temp.t4261p_id('ada')]) x) THEN
    RAISE EXCEPTION 'P-06: calendar rows only for Going members';
  END IF;

  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_set_rsvp(v_plan, 'cant');
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_set_rsvp(v_plan, 'going');
  RESET ROLE;
  IF (SELECT array_agg(user_id ORDER BY user_id) FROM public.calendar_entries WHERE chat_plan_id = v_plan)
     <> (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.t4261p_id('seth'), pg_temp.t4261p_id('kemi')]) x) THEN
    RAISE EXCEPTION 'P-06: an RSVP change after lock moves the calendar rows';
  END IF;
END $p06$;

-- ── P-07 deck matches ──────────────────────────────────────────────────────
DO $p07$
DECLARE
  v_card uuid;
  v_plan public.chat_plans%ROWTYPE;
  v_err text;
  v_before bigint;
  r jsonb;
  v_list jsonb;
  v_when timestamptz := date_trunc('hour', now()) + interval '6 days';
BEGIN
  INSERT INTO public.board_saved_cards(session_id, experience_id, card_data, saved_by)
    VALUES (pg_temp.t4261p_id('session'), 't4261p-skyline', jsonb_build_object('title', 'Afro jazz night', 'image', 'https://example.test/jazz.jpg'),
            pg_temp.t4261p_id('ada'))
    RETURNING id INTO v_card;
  INSERT INTO t4261p_vals VALUES ('card', v_card::text);
  SELECT * INTO v_plan FROM public.chat_plans WHERE saved_card_id = v_card;
  IF NOT FOUND OR v_plan.source <> 'deck' OR v_plan.conversation_id <> pg_temp.t4261p_id('crew')
     OR v_plan.title <> 'Afro jazz night' OR v_plan.created_by <> pg_temp.t4261p_id('ada') OR v_plan.when_mode <> 'none' THEN
    RAISE EXCEPTION 'P-07: a saved card gets exactly its deck plan (got %)', row_to_json(v_plan);
  END IF;
  INSERT INTO t4261p_vals VALUES ('deck_plan', v_plan.id::text);

  v_before := pg_temp.t4261p_msgs(pg_temp.t4261p_id('crew'));
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_set_reaction(v_plan.id, 'up');
  PERFORM public.plan_set_rsvp(v_plan.id, 'maybe');
  RESET ROLE;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('crew')) <> v_before THEN
    RAISE EXCEPTION 'P-07: deck thumbs and RSVP post no lines';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.board_votes WHERE session_id = pg_temp.t4261p_id('session')
                 AND saved_card_id = v_card AND user_id = pg_temp.t4261p_id('seth') AND vote_type = 'up') THEN
    RAISE EXCEPTION 'P-07: deck thumbs write board_votes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.board_card_rsvps WHERE session_id = pg_temp.t4261p_id('session')
                 AND saved_card_id = v_card AND user_id = pg_temp.t4261p_id('seth') AND rsvp_status = 'maybe') THEN
    RAISE EXCEPTION 'P-07: deck Maybe writes board_card_rsvps.maybe';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_plan_reactions WHERE plan_id = v_plan.id)
     OR EXISTS (SELECT 1 FROM public.chat_plan_rsvps WHERE plan_id = v_plan.id) THEN
    RAISE EXCEPTION 'P-07: deck thumbs/RSVP are never copied into the chat-plan tables';
  END IF;

  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.plan_add_option(v_plan.id, v_when);
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_lock(%L, %L)', v_plan.id, r ->> 'optionId'));
  RESET ROLE;
  IF (SELECT when_mode FROM public.chat_plans WHERE id = v_plan.id) <> 'poll' THEN
    RAISE EXCEPTION 'P-07: a deck time vote flips when_mode to poll';
  END IF;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-07: a non-admin cannot lock a deck plan (got %)', v_err;
  END IF;

  v_before := (SELECT count(*) FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('crew') AND message_type = 'card');
  PERFORM pg_temp.t4261p_as('tobi');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_lock(v_plan.id, (r ->> 'optionId')::uuid);
  v_list := public.chat_plans_for_conversation(pg_temp.t4261p_id('crew'));
  RESET ROLE;
  IF NOT (SELECT is_locked FROM public.board_saved_cards WHERE id = v_card) THEN
    RAISE EXCEPTION 'P-07: the admin lock sets board_saved_cards.is_locked';
  END IF;
  IF (SELECT count(*) FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('crew') AND message_type = 'card'
       AND card_payload ->> 'lockInEvent' = 'card_locked_and_scheduled') - v_before <> 1 THEN
    RAISE EXCEPTION 'P-07: the existing lock card message is posted once';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = v_plan.id;
  IF v_plan.status <> 'deciding' OR v_plan.scheduled_at IS NOT NULL OR v_plan.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'P-07: deck lock truth is never mirrored into chat_plans';
  END IF;
  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = v_plan.id::text;
  IF r ->> 'status' <> 'scheduled' OR (r ->> 'scheduledAt')::timestamptz <> v_when OR r -> 'cardData' ->> 'title' <> 'Afro jazz night'
     OR r -> 'rsvps' -> 'maybe' <> jsonb_build_array(pg_temp.t4261p_id('seth')) THEN
    RAISE EXCEPTION 'P-07: the list shows the deck plan as scheduled (got %)', r;
  END IF;
END $p07$;

-- ── P-08 comments and server quotes ────────────────────────────────────────
DO $p08$
DECLARE
  v_msg public.messages%ROWTYPE;
  v_expected jsonb;
  v_list jsonb;
  r jsonb;
BEGIN
  SELECT jsonb_build_object(
    'title', 'Rooftop drinks',
    'votedStartsAt', COALESCE((SELECT jsonb_agg(to_jsonb(o.starts_at) ORDER BY o.starts_at)
       FROM public.chat_plan_time_votes v JOIN public.chat_plan_time_options o ON o.id = v.option_id
      WHERE v.plan_id = pg_temp.t4261p_val('plan_a')::uuid AND v.user_id = pg_temp.t4261p_id('ada')), '[]'::jsonb),
    'rsvp', 'cant') INTO v_expected;
  IF jsonb_array_length(v_expected -> 'votedStartsAt') < 2 THEN
    RAISE EXCEPTION 'P-08: fixture expects Ada to have voted at least two times';
  END IF;

  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  INSERT INTO public.messages(conversation_id, sender_id, content, reply_to_id, plan_quote)
    VALUES (pg_temp.t4261p_id('plain'), pg_temp.t4261p_id('ada'), 'Running late', pg_temp.t4261p_val('msg_a')::uuid,
            '{"title":"forged","rsvp":"going"}'::jsonb);
  -- A forged cross-chat plan id (the DM plan) is dropped.
  INSERT INTO public.messages(conversation_id, sender_id, content, plan_id, plan_quote)
    VALUES (pg_temp.t4261p_id('plain'), pg_temp.t4261p_id('ada'), 'forged tag', pg_temp.t4261p_val('plan_e')::uuid,
            '{"title":"forged"}'::jsonb);
  RESET ROLE;

  SELECT * INTO v_msg FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('plain') AND content = 'Running late';
  IF v_msg.plan_id <> pg_temp.t4261p_val('plan_a')::uuid OR v_msg.plan_quote <> v_expected THEN
    RAISE EXCEPTION 'P-08: a reply gets plan_id and the server quote (got % / %, expected %)', v_msg.plan_id, v_msg.plan_quote, v_expected;
  END IF;
  SELECT * INTO v_msg FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('plain') AND content = 'forged tag';
  IF v_msg.plan_id IS NOT NULL OR v_msg.plan_quote IS NOT NULL THEN
    RAISE EXCEPTION 'P-08: a cross-chat plan_id is nulled (got % / %)', v_msg.plan_id, v_msg.plan_quote;
  END IF;

  -- An edit cannot change the server-owned fields.
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  UPDATE public.messages SET content = 'Running very late', plan_quote = '{"title":"edited"}'::jsonb, plan_id = NULL
   WHERE conversation_id = pg_temp.t4261p_id('plain') AND content = 'Running late';
  RESET ROLE;
  SELECT * INTO v_msg FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('plain') AND content = 'Running very late';
  IF v_msg.plan_id IS DISTINCT FROM pg_temp.t4261p_val('plan_a')::uuid OR v_msg.plan_quote <> v_expected THEN
    RAISE EXCEPTION 'P-08: an edit keeps plan_id and plan_quote';
  END IF;

  -- A deck comment (client tags the deck plan) gets the deck RSVP mapped.
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  INSERT INTO public.messages(conversation_id, sender_id, content, plan_id)
    VALUES (pg_temp.t4261p_id('crew'), pg_temp.t4261p_id('seth'), 'jazz!', pg_temp.t4261p_val('deck_plan')::uuid);
  v_list := public.chat_plans_for_conversation(pg_temp.t4261p_id('plain'));
  RESET ROLE;
  SELECT * INTO v_msg FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('crew') AND content = 'jazz!';
  IF v_msg.plan_id <> pg_temp.t4261p_val('deck_plan')::uuid OR v_msg.plan_quote ->> 'rsvp' <> 'maybe'
     OR jsonb_array_length(v_msg.plan_quote -> 'votedStartsAt') <> 1 THEN
    RAISE EXCEPTION 'P-08: deck comment quote (got %)', v_msg.plan_quote;
  END IF;

  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = pg_temp.t4261p_val('plan_a');
  IF (r ->> 'commentCount')::int <> 1 THEN
    RAISE EXCEPTION 'P-08: the plan counts its one comment (got %)', r ->> 'commentCount';
  END IF;
END $p08$;

-- ── P-09 non-members see nothing; the list shape ───────────────────────────
DO $p09$
DECLARE
  v_n bigint;
  v_err text;
  v_list jsonb;
  r jsonb;
BEGIN
  PERFORM pg_temp.t4261p_as('outsider');
  SET LOCAL ROLE authenticated;
  v_n := (SELECT count(*) FROM public.chat_plans) + (SELECT count(*) FROM public.chat_plan_time_options)
       + (SELECT count(*) FROM public.chat_plan_time_votes) + (SELECT count(*) FROM public.chat_plan_rsvps)
       + (SELECT count(*) FROM public.chat_plan_reactions);
  v_err := pg_temp.t4261p_try(format('SELECT public.chat_plans_for_conversation(%L)', pg_temp.t4261p_id('plain')));
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'P-09: a non-member reads zero plan rows (got %)', v_n;
  END IF;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-09: a non-member cannot list plans (got %)', v_err;
  END IF;

  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  v_n := (SELECT count(*) FROM public.chat_plans WHERE conversation_id = pg_temp.t4261p_id('plain'));
  v_list := public.chat_plans_for_conversation(pg_temp.t4261p_id('plain'));
  RESET ROLE;
  IF v_n <> 4 OR jsonb_array_length(v_list -> 'plans') <> 4 OR (v_list ->> 'memberCount')::int <> 3
     OR (v_list ->> 'viewerId')::uuid <> pg_temp.t4261p_id('kemi') OR v_list -> 'historyVisibleFrom' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'P-09: a member lists the four plans (rows %, %)', v_n, v_list;
  END IF;
  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = pg_temp.t4261p_val('plan_d');
  IF (r ->> 'canLock')::boolean OR (r ->> 'canEdit')::boolean OR NOT (r ->> 'canAddTime')::boolean
     OR r ->> 'createdByName' <> 'Seth' OR NOT (r ->> 'messageVisible')::boolean OR r -> 'place' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'P-09: flags for a member who did not create the plan (got %)', r;
  END IF;
  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = pg_temp.t4261p_val('plan_c');
  -- D-back (#4261) adds the preview fields (title, imageUrl, siteName, fetchedAt).
  IF NOT (r -> 'link' @> jsonb_build_object('url', 'https://www.Example.com/events/42?ref=chat', 'domain', 'example.com')) THEN
    RAISE EXCEPTION 'P-09: link shape (got %)', r -> 'link';
  END IF;
END $p09$;

-- ── P-10 non-plan chats and blocks ─────────────────────────────────────────
DO $p10$
DECLARE
  v_err text;
BEGIN
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, 'x', 'none', NULL, NULL, 'none', NULL, NULL, NULL, NULL)$q$, pg_temp.t4261p_id('program')));
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-10: no plans in a program chat (got %)', v_err;
  END IF;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, 'x', 'none', NULL, NULL, 'none', NULL, NULL, NULL, NULL)$q$, pg_temp.t4261p_id('support')));
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-10: no plans in a support chat (got %)', v_err;
  END IF;
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, 'x', 'none', NULL, NULL, 'none', NULL, NULL, NULL, NULL)$q$, pg_temp.t4261p_id('dm_blocked')));
  RESET ROLE;
  IF v_err <> '42501:unavailable' THEN
    RAISE EXCEPTION 'P-10: a blocked pair gets unavailable (got %)', v_err;
  END IF;
END $p10$;

-- ── P-11 cancel ─────────────────────────────────────────────────────────────
DO $p11$
DECLARE
  v_before bigint := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  v_plan uuid := pg_temp.t4261p_val('plan_b')::uuid;
  v_err text;
  v_err2 text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.calendar_entries WHERE chat_plan_id = v_plan) THEN
    RAISE EXCEPTION 'P-11: fixture: the set plan is on a calendar';
  END IF;
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_cancel(%L)', v_plan));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'P-11: only the creator cancels (got %)', v_err;
  END IF;
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_cancel(v_plan);
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_cancel(%L)', v_plan));
  v_err2 := pg_temp.t4261p_try(format($q$SELECT public.plan_set_rsvp(%L, 'going')$q$, v_plan));
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.calendar_entries WHERE chat_plan_id = v_plan) THEN
    RAISE EXCEPTION 'P-11: cancel removes calendar rows';
  END IF;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) - v_before <> 1
     OR NOT EXISTS (SELECT 1 FROM public.messages WHERE card_payload ->> 'event' = 'cancelled'
                    AND card_payload ->> 'planId' = v_plan::text AND content = 'Seth cancelled 12 Admiralty Way') THEN
    RAISE EXCEPTION 'P-11: one cancelled line';
  END IF;
  IF v_err <> 'PT409:conflict_plan_cancelled' OR v_err2 <> 'PT409:conflict_plan_cancelled' THEN
    RAISE EXCEPTION 'P-11: cancel twice / RSVP after cancel are PT409 (got % / %)', v_err, v_err2;
  END IF;
END $p11$;

-- ── P-12 place search ───────────────────────────────────────────────────────
DO $p12$
DECLARE
  v_ids uuid[];
  v_short int;
  v_err text;
BEGIN
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id) INTO v_ids FROM public.search_plan_places('skyline t4261', 6.45, 3.39, 8);
  SELECT count(*) INTO v_short FROM public.search_plan_places('s', NULL, NULL, 5);
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, NULL, 'place', jsonb_build_object('poolId', %L::text), NULL, 'none', NULL, NULL, NULL, NULL)$q$,
             pg_temp.t4261p_id('plain'), pg_temp.t4261p_id('pool_hidden')));
  RESET ROLE;
  IF v_ids IS NULL OR v_ids[1] <> pg_temp.t4261p_id('pool_skyline') THEN
    RAISE EXCEPTION 'P-12: the servable pool place is found first (got %)', v_ids;
  END IF;
  IF pg_temp.t4261p_id('pool_hidden') = ANY (v_ids) THEN
    RAISE EXCEPTION 'P-12: is_servable = false is excluded';
  END IF;
  IF v_short <> 0 THEN
    RAISE EXCEPTION 'P-12: a one-character query returns nothing';
  END IF;
  IF v_err <> '22023:invalid_input' THEN
    RAISE EXCEPTION 'P-12: plan_create refuses a non-servable pool place (got %)', v_err;
  END IF;
END $p12$;

-- ── P-13 message types ─────────────────────────────────────────────────────
DO $p13$
DECLARE
  v_def text := (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                  WHERE conrelid = 'public.messages'::regclass AND conname = 'messages_message_type_check');
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['text','image','video','file','card','system','brand_enquiry_card','plan'] LOOP
    IF position(quote_literal(v_t) || '::text' IN v_def) = 0 THEN
      RAISE EXCEPTION 'P-13: message_type % must stay allowed (%)', v_t, v_def;
    END IF;
  END LOOP;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.board_card_rsvps'::regclass AND conname = 'board_card_rsvps_rsvp_status_check')
     NOT LIKE '%attending%not_attending%maybe%' THEN
    RAISE EXCEPTION 'P-13: board_card_rsvps keeps attending/not_attending and adds maybe';
  END IF;
END $p13$;

-- ── P-14 realtime ───────────────────────────────────────────────────────────
DO $p14$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_plans', 'group_join_requests', 'messages'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'P-14: public.% must be in supabase_realtime', t;
    END IF;
  END LOOP;
  IF (SELECT relreplident FROM pg_class WHERE oid = 'public.chat_plans'::regclass) <> 'f' THEN
    RAISE EXCEPTION 'P-14: chat_plans needs REPLICA IDENTITY FULL';
  END IF;
END $p14$;

-- ── P-15 cascades ───────────────────────────────────────────────────────────
DO $p15$
DECLARE
  v_plan uuid := pg_temp.t4261p_val('deck_plan')::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_plan_time_options WHERE plan_id = v_plan)
     OR NOT EXISTS (SELECT 1 FROM public.chat_plan_time_votes WHERE plan_id = v_plan) THEN
    RAISE EXCEPTION 'P-15: fixture: the deck plan has options and votes';
  END IF;
  DELETE FROM public.board_saved_cards WHERE id = pg_temp.t4261p_val('card')::uuid;
  IF EXISTS (SELECT 1 FROM public.chat_plans WHERE id = v_plan)
     OR EXISTS (SELECT 1 FROM public.chat_plan_time_options WHERE plan_id = v_plan)
     OR EXISTS (SELECT 1 FROM public.chat_plan_time_votes WHERE plan_id = v_plan) THEN
    RAISE EXCEPTION 'P-15: deleting a saved card removes its deck plan, options and votes';
  END IF;
  IF (SELECT plan_id FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('crew') AND content = 'jazz!') IS NOT NULL THEN
    RAISE EXCEPTION 'P-15: a comment outlives its deck plan with plan_id cleared';
  END IF;

  DELETE FROM public.conversations WHERE id = pg_temp.t4261p_id('dm');
  IF EXISTS (SELECT 1 FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_e')::uuid) THEN
    RAISE EXCEPTION 'P-15: deleting a chat removes its plans';
  END IF;
END $p15$;

ROLLBACK;

\echo 'issue_4261_chat_plans: all assertions passed'
