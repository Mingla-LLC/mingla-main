\set ON_ERROR_STOP on

-- Issue #4261 Wave D-back — suggest and vote on places; link previews.
--
--   LP-03 grants: anon nothing on the three new tables; authenticated SELECT
--         only on options/votes and nothing on previews; no TRUNCATE; the new
--         RPCs are authenticated-only, the helpers and the store internal.
--   PL-08 plan_create: Google place + link and typed address + link store the
--         link with its domain; pool place + link and a javascript: link ->
--         invalid_input; the A2 where/when combinations still create.
--   PL-01 the first suggestion on a pool-place plan seeds the original (with
--         the creator's vote) and the new option (with the suggester's vote);
--         exactly one place_added line carrying placeName and optionId.
--   PL-02 the same pool id / typed name+address / Google id again ->
--         existed:true, the vote is added, no line.
--   PL-03 the seventh place -> PT409 conflict_too_many_places.
--   PL-04 plan_set_place_vote on/off is idempotent and posts no line.
--   PL-05 open_times = false: a non-creator suggestion -> not_allowed; the
--         creator's -> ok.
--   PL-06 deck plan -> not_allowed; non-member -> not_allowed; blocked member
--         -> unavailable; scheduled or cancelled plan -> PT409.
--   PL-09 a reply to the plan gets plan_quote.votedPlaces = the sender's picks
--         in list order.
--   PL-10 chat_plans_for_conversation returns places, canAddPlace, link on a
--         place plan, and preview fields only after a store; deck plans
--         places = [] and canAddPlace = false.
--   PL-07 plan_lock with p_place_option_id copies that option (a Google place
--         with a link) into the plan and its calendar card_data; with NULL it
--         picks the leader (most votes; tie -> the original); the lock line
--         carries placeName + placeVoted; the four old named arguments still
--         resolve; pg_proc holds exactly one plan_lock.
--   LP-01 chat_plan_link_targets: a member gets the missing / stale URLs
--         (<= 7); a non-member -> not_allowed; a fresh ok is excluded; a
--         failed row older than 6 h is included.
--   LP-02 chat_plan_link_preview_store: authenticated -> permission denied;
--         service_role stores; an http:// image is stored as NULL; an unknown
--         URL writes nothing; the plan's updated_at moves.
--   LP-04 RLS: a non-member reads zero option / vote rows.
--   A2 regression: P-03, P-04 and P-06 of the A2 suite, unchanged.
--
-- MINGLA-INVARIANT: I-4261-PLACE-VOTES-POST-NO-LINES | issue #4261 | Place votes never insert a chat message; a new place suggestion inserts exactly one.
-- MINGLA-INVARIANT: I-4261-LOCK-COPIES-WINNING-PLACE | issue #4261 | Locking a chat plan with place options writes the winning option into the plan's where columns in the same statement that schedules it.
-- MINGLA-INVARIANT: I-4261-LINK-PREVIEW-SERVER-ONLY | issue #4261 | Link preview rows are written only by the service-role store function, only for URLs that exist on a plan or place option, and image URLs are https.
--
-- FAILS-ON-REVERT (replay the chain without
-- 20280403054261_issue_4261_plan_places_and_link_previews.sql): the \ir below
-- is the migration itself; without it LP-03 fails on its first table
-- (chat_plan_place_options does not exist) and PL-01 on plan_add_place.
--
-- Run after the full migration chain on PostgreSQL 17. #4334 renamed
-- mapbox_id to provider_place_id and owns the current plan function bodies,
-- so the re-applies are of 20280521004334_issue_4334_google_places.sql (the
-- 4261 file can no longer re-run on top of the rename). The two re-applies
-- prove that migration is idempotent; everything after them rolls back.

-- [TEST-MOD-APPROVED #3281] The re-applies below commit, and #4334 is no longer
-- the latest definition of every function it emits (20280523003281 re-emits
-- pg_direct_event_checkout_bundle, pg_public_rsvp_by_slug and
-- business_update_live_event_atomic). Snapshot every public function body
-- first and put back any body the re-apply rolled back, so later suites in the
-- same database see the chain's real latest definitions.
CREATE TEMP TABLE t4261_fn_before ON COMMIT PRESERVE ROWS AS
  SELECT p.oid, md5(p.prosrc) AS src_md5, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p');

\ir ../20280521004334_issue_4334_google_places.sql
\ir ../20280521004334_issue_4334_google_places.sql

DO $t4261_restore$
DECLARE
  r record;
  v_restored integer := 0;
BEGIN
  FOR r IN
    SELECT b.def FROM t4261_fn_before b JOIN pg_proc p ON p.oid = b.oid
     WHERE md5(p.prosrc) IS DISTINCT FROM b.src_md5
  LOOP
    EXECUTE r.def;
    v_restored := v_restored + 1;
  END LOOP;
  RAISE NOTICE 'issue #4261: restored % function bodies the #4334 re-apply rolled back', v_restored;
END
$t4261_restore$;
DROP TABLE t4261_fn_before;

BEGIN;

DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

CREATE TEMP TABLE t4261p_ids (tag text PRIMARY KEY, id uuid NOT NULL);
CREATE TEMP TABLE t4261p_vals (tag text PRIMARY KEY, val text);
GRANT SELECT ON t4261p_ids TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON t4261p_vals TO authenticated, service_role;

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
    INSERT INTO auth.users(id, email) VALUES (v_id, 't4261d-' || v_tag || '-' || v_id || '@example.test');
    INSERT INTO public.profiles(id, email, first_name, display_name)
      VALUES (v_id, 't4261d-' || v_tag || '-' || v_id || '@example.test', initcap(v_tag), initcap(v_tag))
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO t4261p_ids VALUES (v_tag, v_id);
  END LOOP;

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

  -- Session group "Saturday crew": Tobi creates; Seth, Ada, Kemi accepted.
  INSERT INTO public.collaboration_sessions(name, created_by, status)
    VALUES ('Saturday crew', pg_temp.t4261p_id('tobi'), 'active') RETURNING id INTO v_session;
  INSERT INTO public.session_participants(session_id, user_id, has_accepted) VALUES
    (v_session, pg_temp.t4261p_id('tobi'), true), (v_session, pg_temp.t4261p_id('seth'), true),
    (v_session, pg_temp.t4261p_id('ada'), true), (v_session, pg_temp.t4261p_id('kemi'), true);
  INSERT INTO t4261p_ids VALUES ('session', v_session), ('crew', public.resolve_session_conversation(v_session));

  -- Place pool.
  INSERT INTO public.place_pool(google_place_id, name, address, city, lat, lng, is_active, is_servable, stored_photo_urls)
    VALUES ('t4261d-skyline', 'Skyline Terrace T4261', '1 Marina Rd, Lagos', 'Lagos', 6.45, 3.39, true, true,
            ARRAY['https://example.test/skyline.jpg'])
    RETURNING id INTO v_id;
  INSERT INTO t4261p_ids VALUES ('pool_skyline', v_id);
  INSERT INTO public.place_pool(google_place_id, name, address, city, lat, lng, is_active, is_servable, stored_photo_urls)
    VALUES ('t4261d-lagoon', 'Lagoon Lounge T4261', '9 Ozumba Mbadiwe, Lagos', 'Lagos', 6.43, 3.42, true, true,
            ARRAY['https://example.test/lagoon.jpg'])
    RETURNING id INTO v_id;
  INSERT INTO t4261p_ids VALUES ('pool_lagoon', v_id);
END $fixture$;

-- ── LP-03 grants ────────────────────────────────────────────────────────────
DO $lp03$
DECLARE
  v_t text;
  v_p text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['chat_plan_place_options','chat_plan_place_votes','chat_plan_link_previews'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass) THEN
      RAISE EXCEPTION 'LP-03: RLS must be enabled on %', v_t;
    END IF;
    FOREACH v_p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || v_t, v_p) THEN
        RAISE EXCEPTION 'LP-03: anon must not hold % on %', v_p, v_t;
      END IF;
      IF (v_p <> 'SELECT' OR v_t = 'chat_plan_link_previews')
         AND has_table_privilege('authenticated', 'public.' || v_t, v_p) THEN
        RAISE EXCEPTION 'LP-03: authenticated must not hold % on %', v_p, v_t;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.chat_plan_place_options', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.chat_plan_place_votes', 'SELECT') THEN
    RAISE EXCEPTION 'LP-03: authenticated reads options and votes (through RLS)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.chat_plan_link_previews'::regclass) THEN
    RAISE EXCEPTION 'LP-03: link previews carry no policy';
  END IF;
  FOREACH v_p IN ARRAY ARRAY[
    'public.plan_add_place(uuid,text,jsonb,text)', 'public.plan_set_place_vote(uuid,boolean)',
    'public.plan_lock(uuid,uuid,timestamptz,integer,uuid)', 'public.chat_plan_link_targets(uuid)',
    'public.plan_create(uuid,uuid,text,text,jsonb,text,text,timestamptz,timestamptz[],boolean,text)',
    'public.chat_plans_for_conversation(uuid)'] LOOP
    IF has_function_privilege('anon', v_p, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_p, 'EXECUTE') THEN
      RAISE EXCEPTION 'LP-03: % must be authenticated-only', v_p;
    END IF;
  END LOOP;
  FOREACH v_p IN ARRAY ARRAY[
    'public.chat_plan_parse_where(text,jsonb,text)', 'public.chat_plan_place_leader(uuid)',
    'public.chat_plan_seed_original_place(public.chat_plans)',
    'public.chat_plan_place_identity_key(text,uuid,text,text,text,text)', 'public.chat_plan_link_json(text,text)',
    'public.chat_plan_link_preview_store(text,text,text,text,text,text)'] LOOP
    IF has_function_privilege('authenticated', v_p, 'EXECUTE') OR has_function_privilege('anon', v_p, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_p, 'EXECUTE') THEN
      RAISE EXCEPTION 'LP-03: % is internal (service_role only)', v_p;
    END IF;
  END LOOP;
END $lp03$;

-- ── PL-08 plan_create with a place link ────────────────────────────────────
DO $pl08$
DECLARE
  r jsonb;
  v_plan public.chat_plans%ROWTYPE;
  v_err text;
BEGIN
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  -- Google place + its menu link.
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, NULL, 'place',
         jsonb_build_object('providerPlaceId', 'ChIJlekkiConservation1', 'name', 'Lekki Conservation Centre', 'address', 'Lekki, Lagos', 'lat', 6.44, 'lng', 3.53),
         'https://www.LekkiCentre.example.com/menu', 'poll', NULL, ARRAY[now() + interval '2 days'], true, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_mbx', r ->> 'planId');
  -- Typed address + link.
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, 'Pottery', 'address',
         jsonb_build_object('name', 'Clay Studio', 'address', '4 Bourdillon Rd'), 'https://claystudio.example.com',
         'none', NULL, NULL, true, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_addr_link', r ->> 'planId');
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, 'x', 'place', jsonb_build_object('poolId', %L::text), 'https://skyline.example.com', 'none', NULL, NULL, NULL, NULL)$q$,
             pg_temp.t4261p_id('plain'), pg_temp.t4261p_id('pool_skyline')));
  IF v_err <> '22023:invalid_input' THEN
    RAISE EXCEPTION 'PL-08: a pool place never carries a link (got %)', v_err;
  END IF;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, 'x', 'address', '{"name":"Somewhere"}'::jsonb, 'javascript:alert(1)', 'none', NULL, NULL, NULL, NULL)$q$,
             pg_temp.t4261p_id('plain')));
  IF v_err <> '22023:invalid_input' THEN
    RAISE EXCEPTION 'PL-08: a javascript: place link is invalid_input (got %)', v_err;
  END IF;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_create(%L, NULL, 'x', 'link', NULL, 'javascript:alert(1)', 'none', NULL, NULL, NULL, NULL)$q$,
             pg_temp.t4261p_id('plain')));
  IF v_err <> '22023:invalid_input' THEN
    RAISE EXCEPTION 'PL-08: a javascript: link plan is invalid_input (got %)', v_err;
  END IF;
  -- A2 P-01 combinations still create.
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, 'Rooftop drinks',
         'place', jsonb_build_object('poolId', pg_temp.t4261p_id('pool_skyline'), 'name', 'FAKE NAME'),
         NULL, 'poll', NULL, ARRAY[now() + interval '2 days', now() + interval '3 days'], true, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_pool', r ->> 'planId');
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, NULL, 'address',
         jsonb_build_object('name', '12 Admiralty Way'), NULL, 'set', now() + interval '5 days', NULL, NULL, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_set', r ->> 'planId');
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, '  ', 'link', NULL,
         'https://www.Example.com/events/42?ref=chat', 'none', NULL, NULL, NULL, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_link', r ->> 'planId');
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, 'Board games', 'none', NULL, NULL, 'none', NULL, NULL, NULL, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_none', r ->> 'planId');
  RESET ROLE;

  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_mbx')::uuid;
  IF v_plan.where_kind <> 'place' OR v_plan.provider_place_id <> 'ChIJlekkiConservation1' OR v_plan.place_pool_id IS NOT NULL
     OR v_plan.link_url <> 'https://www.LekkiCentre.example.com/menu' OR v_plan.link_domain <> 'lekkicentre.example.com'
     OR v_plan.title <> 'Lekki Conservation Centre' THEN
    RAISE EXCEPTION 'PL-08: Google place + link (got %)', row_to_json(v_plan);
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_addr_link')::uuid;
  IF v_plan.where_kind <> 'address' OR v_plan.link_url <> 'https://claystudio.example.com'
     OR v_plan.link_domain <> 'claystudio.example.com' OR v_plan.place_name <> 'Clay Studio' THEN
    RAISE EXCEPTION 'PL-08: typed address + link (got %)', row_to_json(v_plan);
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_pool')::uuid;
  IF v_plan.place_name <> 'Skyline Terrace T4261' OR v_plan.place_photo_url <> 'https://example.test/skyline.jpg'
     OR v_plan.link_url IS NOT NULL THEN
    RAISE EXCEPTION 'PL-08: pool values come from place_pool (got %)', row_to_json(v_plan);
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_set')::uuid;
  IF v_plan.status <> 'scheduled' OR v_plan.title <> '12 Admiralty Way' OR v_plan.link_url IS NOT NULL THEN
    RAISE EXCEPTION 'PL-08: set-time address plan (got %)', row_to_json(v_plan);
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_link')::uuid;
  IF v_plan.where_kind <> 'link' OR v_plan.title <> 'example.com' OR v_plan.link_domain <> 'example.com' THEN
    RAISE EXCEPTION 'PL-08: link plan (got %)', row_to_json(v_plan);
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_none')::uuid;
  IF v_plan.where_kind <> 'none' OR v_plan.title <> 'Board games' THEN
    RAISE EXCEPTION 'PL-08: none/none plan';
  END IF;
END $pl08$;

-- ── PL-01 the first suggestion seeds the original ──────────────────────────
DO $pl01$
DECLARE
  r jsonb;
  v_plan uuid := pg_temp.t4261p_val('plan_pool')::uuid;
  v_before bigint := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  v_orig public.chat_plan_place_options%ROWTYPE;
  v_new public.chat_plan_place_options%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.chat_plan_place_options WHERE plan_id = v_plan) THEN
    RAISE EXCEPTION 'PL-01: a plan nobody suggested on has no place options';
  END IF;
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  -- The client lies about the pool place's name and photo.
  r := public.plan_add_place(v_plan, 'place',
         jsonb_build_object('poolId', pg_temp.t4261p_id('pool_lagoon'), 'name', 'FAKE', 'photoUrl', 'https://evil.example/x.jpg'));
  RESET ROLE;
  IF (r ->> 'existed')::boolean THEN
    RAISE EXCEPTION 'PL-01: a new place is not existed (got %)', r;
  END IF;
  INSERT INTO t4261p_vals VALUES ('opt_lagoon', r ->> 'optionId');

  SELECT * INTO v_orig FROM public.chat_plan_place_options WHERE plan_id = v_plan AND is_original;
  IF NOT FOUND OR v_orig.place_pool_id <> pg_temp.t4261p_id('pool_skyline') OR v_orig.kind <> 'place'
     OR v_orig.added_by <> pg_temp.t4261p_id('seth') OR v_orig.identity_key <> 'pool:' || pg_temp.t4261p_id('pool_skyline')
     OR v_orig.place_photo_url <> 'https://example.test/skyline.jpg' THEN
    RAISE EXCEPTION 'PL-01: the plan''s own place is seeded as the original (got %)', row_to_json(v_orig);
  END IF;
  INSERT INTO t4261p_vals VALUES ('opt_skyline', v_orig.id::text);
  IF NOT EXISTS (SELECT 1 FROM public.chat_plan_place_votes WHERE option_id = v_orig.id AND user_id = pg_temp.t4261p_id('seth'))
     OR (SELECT count(*) FROM public.chat_plan_place_votes WHERE option_id = v_orig.id) <> 1 THEN
    RAISE EXCEPTION 'PL-01: the original carries the creator''s vote only';
  END IF;
  SELECT * INTO v_new FROM public.chat_plan_place_options WHERE id = (r ->> 'optionId')::uuid;
  IF v_new.place_name <> 'Lagoon Lounge T4261' OR v_new.place_photo_url <> 'https://example.test/lagoon.jpg'
     OR v_new.is_original OR v_new.added_by <> pg_temp.t4261p_id('ada') OR v_new.plan_id <> v_plan THEN
    RAISE EXCEPTION 'PL-01: the suggested pool place takes place_pool values (got %)', row_to_json(v_new);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_plan_place_votes WHERE option_id = v_new.id AND user_id = pg_temp.t4261p_id('ada')) THEN
    RAISE EXCEPTION 'PL-01: the suggester votes for the suggestion';
  END IF;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) - v_before <> 1
     OR NOT EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('plain')
       AND message_type = 'system' AND sender_id IS NULL AND plan_id IS NULL
       AND card_payload ->> 'kind' = 'plan_event' AND card_payload ->> 'event' = 'place_added'
       AND card_payload ->> 'planId' = v_plan::text AND card_payload ->> 'actorId' = pg_temp.t4261p_id('ada')::text
       AND card_payload ->> 'placeName' = 'Lagoon Lounge T4261' AND card_payload ->> 'optionId' = v_new.id::text
       AND content = 'Ada suggested Lagoon Lounge T4261 for Rooftop drinks') THEN
    RAISE EXCEPTION 'PL-01: exactly one place_added line';
  END IF;
END $pl01$;

-- ── PL-02 duplicates add a vote and post nothing ───────────────────────────
DO $pl02$
DECLARE
  r jsonb;
  v_plan uuid := pg_temp.t4261p_val('plan_pool')::uuid;
  v_before bigint;
  v_opts bigint;
BEGIN
  -- Two more new places (each posts its line): a typed address and a Google place with a link.
  v_before := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  r := public.plan_add_place(v_plan, 'address', jsonb_build_object('name', '12 Admiralty Way', 'address', 'Lekki'));
  INSERT INTO t4261p_vals VALUES ('opt_admiralty', r ->> 'optionId');
  r := public.plan_add_place(v_plan, 'place',
         jsonb_build_object('providerPlaceId', 'ChIJterraKulture00001', 'name', 'Terra Kulture', 'address', 'Victoria Island', 'lat', 6.43, 'lng', 3.42),
         'https://terrakulture.example.com/menu');
  INSERT INTO t4261p_vals VALUES ('opt_google', r ->> 'optionId');
  RESET ROLE;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) - v_before <> 2 THEN
    RAISE EXCEPTION 'PL-02: two new places post two lines';
  END IF;
  IF (SELECT link_domain FROM public.chat_plan_place_options WHERE id = pg_temp.t4261p_val('opt_google')::uuid) <> 'terrakulture.example.com' THEN
    RAISE EXCEPTION 'PL-02: a suggested Google place keeps its link domain';
  END IF;

  v_before := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  v_opts := (SELECT count(*) FROM public.chat_plan_place_options WHERE plan_id = v_plan);
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  r := public.plan_add_place(v_plan, 'place', jsonb_build_object('poolId', pg_temp.t4261p_id('pool_lagoon')));
  IF NOT (r ->> 'existed')::boolean OR r ->> 'optionId' <> pg_temp.t4261p_val('opt_lagoon') THEN
    RAISE EXCEPTION 'PL-02: the same pool place is existed (got %)', r;
  END IF;
  r := public.plan_add_place(v_plan, 'address', jsonb_build_object('name', '  12 ADMIRALTY   way ', 'address', ' LEKKI '));
  IF NOT (r ->> 'existed')::boolean OR r ->> 'optionId' <> pg_temp.t4261p_val('opt_admiralty') THEN
    RAISE EXCEPTION 'PL-02: the same typed name + address is existed (got %)', r;
  END IF;
  r := public.plan_add_place(v_plan, 'place',
         jsonb_build_object('providerPlaceId', 'ChIJterraKulture00001', 'name', 'Terra Kulture VI', 'lat', 6.43, 'lng', 3.42));
  IF NOT (r ->> 'existed')::boolean OR r ->> 'optionId' <> pg_temp.t4261p_val('opt_google') THEN
    RAISE EXCEPTION 'PL-02: the same Google id is existed (got %)', r;
  END IF;
  -- The plan's own place, suggested again.
  r := public.plan_add_place(v_plan, 'place', jsonb_build_object('poolId', pg_temp.t4261p_id('pool_skyline')));
  IF NOT (r ->> 'existed')::boolean OR r ->> 'optionId' <> pg_temp.t4261p_val('opt_skyline') THEN
    RAISE EXCEPTION 'PL-02: the original suggested again is existed (got %)', r;
  END IF;
  RESET ROLE;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) <> v_before THEN
    RAISE EXCEPTION 'PL-02: duplicates post no line';
  END IF;
  IF (SELECT count(*) FROM public.chat_plan_place_options WHERE plan_id = v_plan) <> v_opts THEN
    RAISE EXCEPTION 'PL-02: duplicates add no option';
  END IF;
  IF (SELECT count(*) FROM public.chat_plan_place_votes WHERE plan_id = v_plan AND user_id = pg_temp.t4261p_id('kemi')) <> 4 THEN
    RAISE EXCEPTION 'PL-02: each duplicate adds the caller''s vote';
  END IF;
END $pl02$;

-- ── PL-04 place votes are idempotent and post no line ──────────────────────
DO $pl04$
DECLARE
  v_before bigint := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  v_opt uuid := pg_temp.t4261p_val('opt_google')::uuid;
  v_err text;
BEGIN
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_set_place_vote(v_opt, true);
  PERFORM public.plan_set_place_vote(v_opt, true);
  PERFORM public.plan_set_place_vote(v_opt, false);
  PERFORM public.plan_set_place_vote(v_opt, false);
  PERFORM public.plan_set_place_vote(v_opt, true);
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_set_place_vote(%L, NULL)', v_opt));
  IF v_err <> '22023:invalid_input' THEN
    RAISE EXCEPTION 'PL-04: p_on NULL is invalid_input (got %)', v_err;
  END IF;
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_set_place_vote(%L, true)', gen_random_uuid()));
  IF v_err <> 'P0002:not_found' THEN
    RAISE EXCEPTION 'PL-04: an unknown option is not_found (got %)', v_err;
  END IF;
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('outsider');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_set_place_vote(%L, true)', v_opt));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'PL-04: a non-member cannot vote (got %)', v_err;
  END IF;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) <> v_before THEN
    RAISE EXCEPTION 'PL-04: place votes post no messages';
  END IF;
  IF (SELECT count(*) FROM public.chat_plan_place_votes WHERE option_id = v_opt AND user_id = pg_temp.t4261p_id('seth')) <> 1 THEN
    RAISE EXCEPTION 'PL-04: the final vote state is on, once';
  END IF;
END $pl04$;

-- ── PL-03 six places at most ───────────────────────────────────────────────
DO $pl03$
DECLARE
  v_plan uuid := pg_temp.t4261p_val('plan_pool')::uuid;
  v_err text;
  v_list jsonb;
  r jsonb;
BEGIN
  -- skyline (original), lagoon, admiralty, terra kulture = 4; two more = 6.
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_add_place(v_plan, 'address', jsonb_build_object('name', 'Place Five'));
  PERFORM public.plan_add_place(v_plan, 'address', jsonb_build_object('name', 'Place Six'));
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_add_place(%L, 'address', '{"name":"Place Seven"}'::jsonb)$q$, v_plan));
  -- An existing place is still accepted at the cap (a vote, not a seventh option).
  r := public.plan_add_place(v_plan, 'address', jsonb_build_object('name', 'Place Five'));
  v_list := public.chat_plans_for_conversation(pg_temp.t4261p_id('plain'));
  RESET ROLE;
  IF (SELECT count(*) FROM public.chat_plan_place_options WHERE plan_id = v_plan) <> 6 THEN
    RAISE EXCEPTION 'PL-03: six options before the seventh';
  END IF;
  IF v_err <> 'PT409:conflict_too_many_places' THEN
    RAISE EXCEPTION 'PL-03: the seventh place is PT409 (got %)', v_err;
  END IF;
  IF NOT (r ->> 'existed')::boolean THEN
    RAISE EXCEPTION 'PL-03: a duplicate at the cap is existed (got %)', r;
  END IF;
  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = v_plan::text;
  IF (r ->> 'canAddPlace')::boolean THEN
    RAISE EXCEPTION 'PL-03: canAddPlace is false at six places';
  END IF;
END $pl03$;

-- ── PL-05 friends-can-add off ──────────────────────────────────────────────
DO $pl05$
DECLARE
  r jsonb;
  v_err text;
  v_list jsonb;
BEGIN
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.plan_create(pg_temp.t4261p_id('plain'), NULL, 'Closed vote', 'address', '{"name":"Clay Studio"}'::jsonb, NULL,
         'poll', NULL, ARRAY[now() + interval '2 days', now() + interval '3 days'], false, NULL);
  INSERT INTO t4261p_vals VALUES ('plan_closed', r ->> 'planId');
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_add_place(%L, 'address', '{"name":"Elsewhere"}'::jsonb)$q$, r ->> 'planId'));
  v_list := public.chat_plans_for_conversation(pg_temp.t4261p_id('plain'));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'PL-05: a non-creator cannot suggest when friends-can-add is off (got %)', v_err;
  END IF;
  IF (SELECT (x ->> 'canAddPlace')::boolean FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = r ->> 'planId') THEN
    RAISE EXCEPTION 'PL-05: canAddPlace is false for that member';
  END IF;
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.plan_add_place((r ->> 'planId')::uuid, 'address', '{"name":"Elsewhere"}'::jsonb);
  RESET ROLE;
  IF (r ->> 'existed')::boolean OR (SELECT count(*) FROM public.chat_plan_place_options WHERE plan_id = pg_temp.t4261p_val('plan_closed')::uuid) <> 2 THEN
    RAISE EXCEPTION 'PL-05: the creator may suggest (got %)', r;
  END IF;
END $pl05$;

-- ── PL-06 refusals ──────────────────────────────────────────────────────────
DO $pl06$
DECLARE
  v_card uuid;
  v_deck uuid;
  v_blocked uuid;
  v_err text;
  v_cancel uuid;
BEGIN
  INSERT INTO public.board_saved_cards(session_id, experience_id, card_data, saved_by)
    VALUES (pg_temp.t4261p_id('session'), 't4261d-skyline', jsonb_build_object('title', 'Afro jazz night'), pg_temp.t4261p_id('ada'))
    RETURNING id INTO v_card;
  SELECT id INTO v_deck FROM public.chat_plans WHERE saved_card_id = v_card;
  INSERT INTO t4261p_vals VALUES ('deck_plan', v_deck::text);

  PERFORM pg_temp.t4261p_as('tobi');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_add_place(%L, 'address', '{"name":"Somewhere"}'::jsonb)$q$, v_deck));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'PL-06: a deck match takes no alternative places (got %)', v_err;
  END IF;

  PERFORM pg_temp.t4261p_as('outsider');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_add_place(%L, 'address', '{"name":"Somewhere"}'::jsonb)$q$, pg_temp.t4261p_val('plan_pool')));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'PL-06: a non-member cannot suggest (got %)', v_err;
  END IF;

  INSERT INTO public.chat_plans(conversation_id, source, created_by, title, where_kind, when_mode)
    VALUES (pg_temp.t4261p_id('dm_blocked'), 'chat', pg_temp.t4261p_id('kemi'), 'Blocked plan', 'none', 'none')
    RETURNING id INTO v_blocked;
  PERFORM pg_temp.t4261p_as('blk');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_add_place(%L, 'address', '{"name":"Somewhere"}'::jsonb)$q$, v_blocked));
  RESET ROLE;
  IF v_err <> '42501:unavailable' THEN
    RAISE EXCEPTION 'PL-06: a blocked member gets unavailable (got %)', v_err;
  END IF;

  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_add_place(%L, 'address', '{"name":"Somewhere"}'::jsonb)$q$, pg_temp.t4261p_val('plan_set')));
  RESET ROLE;
  IF v_err <> 'PT409:conflict_plan_not_deciding' THEN
    RAISE EXCEPTION 'PL-06: a scheduled plan takes no suggestions (got %)', v_err;
  END IF;

  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  v_cancel := (public.plan_create(pg_temp.t4261p_id('plain'), NULL, 'Soon cancelled', 'none', NULL, NULL, 'none', NULL, NULL, NULL, NULL) ->> 'planId')::uuid;
  PERFORM public.plan_cancel(v_cancel);
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_add_place(%L, 'address', '{"name":"Somewhere"}'::jsonb)$q$, v_cancel));
  RESET ROLE;
  IF v_err <> 'PT409:conflict_plan_not_deciding' THEN
    RAISE EXCEPTION 'PL-06: a cancelled plan takes no suggestions (got %)', v_err;
  END IF;

  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format($q$SELECT public.plan_add_place(%L, 'link', NULL, 'https://example.com')$q$, pg_temp.t4261p_val('plan_none')));
  RESET ROLE;
  IF v_err <> '22023:invalid_input' THEN
    RAISE EXCEPTION 'PL-06: a suggestion is a place, not a bare link (got %)', v_err;
  END IF;
END $pl06$;

-- ── PL-09 quotes carry the sender's voted places ───────────────────────────
DO $pl09$
DECLARE
  v_msg public.messages%ROWTYPE;
  v_expected jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(o.place_name) ORDER BY o.is_original DESC, o.created_at, o.id), '[]'::jsonb)
    INTO v_expected
    FROM public.chat_plan_place_options o
   WHERE o.plan_id = pg_temp.t4261p_val('plan_pool')::uuid
     AND EXISTS (SELECT 1 FROM public.chat_plan_place_votes v WHERE v.option_id = o.id AND v.user_id = pg_temp.t4261p_id('ada'));
  IF jsonb_array_length(v_expected) <> 3 THEN
    RAISE EXCEPTION 'PL-09: fixture expects Ada to have voted three places (got %)', v_expected;
  END IF;

  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  INSERT INTO public.messages(conversation_id, sender_id, content, plan_id, plan_quote)
    VALUES (pg_temp.t4261p_id('plain'), pg_temp.t4261p_id('ada'), 'Lagoon please', pg_temp.t4261p_val('plan_pool')::uuid,
            '{"votedPlaces":["forged"]}'::jsonb);
  INSERT INTO public.messages(conversation_id, sender_id, content, plan_id)
    VALUES (pg_temp.t4261p_id('plain'), pg_temp.t4261p_id('ada'), 'Games?', pg_temp.t4261p_val('plan_none')::uuid);
  RESET ROLE;

  SELECT * INTO v_msg FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('plain') AND content = 'Lagoon please';
  IF v_msg.plan_quote -> 'votedPlaces' IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'PL-09: votedPlaces = the sender''s picks in list order (got %, expected %)', v_msg.plan_quote, v_expected;
  END IF;
  IF v_msg.plan_quote ->> 'title' <> 'Rooftop drinks' THEN
    RAISE EXCEPTION 'PL-09: the rest of the quote is unchanged (got %)', v_msg.plan_quote;
  END IF;
  SELECT * INTO v_msg FROM public.messages WHERE conversation_id = pg_temp.t4261p_id('plain') AND content = 'Games?';
  IF v_msg.plan_quote ? 'votedPlaces' THEN
    RAISE EXCEPTION 'PL-09: a plan without place options keeps the A2 quote shape (got %)', v_msg.plan_quote;
  END IF;
END $pl09$;

-- ── PL-10 the list shape ───────────────────────────────────────────────────
DO $pl10$
DECLARE
  v_list jsonb;
  r jsonb;
  v_ids jsonb;
BEGIN
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  v_list := public.chat_plans_for_conversation(pg_temp.t4261p_id('plain'));
  RESET ROLE;

  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = pg_temp.t4261p_val('plan_pool');
  IF jsonb_array_length(r -> 'places') <> 6 OR NOT (r -> 'places' -> 0 ->> 'isOriginal')::boolean
     OR r -> 'places' -> 0 ->> 'poolId' <> pg_temp.t4261p_id('pool_skyline')::text
     OR r -> 'places' -> 0 ->> 'photoUrl' <> 'https://example.test/skyline.jpg'
     OR r -> 'places' -> 0 -> 'link' <> 'null'::jsonb
     OR r -> 'link' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'PL-10: places on the pool plan, original first (got %)', r -> 'places';
  END IF;
  SELECT x INTO r FROM jsonb_array_elements(r -> 'places') x WHERE x ->> 'id' = pg_temp.t4261p_val('opt_google');
  SELECT jsonb_agg(v.user_id ORDER BY v.created_at, v.user_id) INTO v_ids
    FROM public.chat_plan_place_votes v WHERE v.option_id = pg_temp.t4261p_val('opt_google')::uuid;
  IF r ->> 'kind' <> 'place' OR r ->> 'providerPlaceId' <> 'ChIJterraKulture00001' OR r ->> 'name' <> 'Terra Kulture'
     OR r ->> 'addedBy' <> pg_temp.t4261p_id('ada')::text OR (r ->> 'isOriginal')::boolean
     OR r -> 'voterIds' <> v_ids
     OR r -> 'link' <> jsonb_build_object('url', 'https://terrakulture.example.com/menu', 'domain', 'terrakulture.example.com',
                                          'title', NULL, 'imageUrl', NULL, 'siteName', NULL, 'fetchedAt', NULL) THEN
    RAISE EXCEPTION 'PL-10: a place option row (got %)', r;
  END IF;

  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = pg_temp.t4261p_val('plan_mbx');
  IF r ->> 'whereKind' <> 'place' OR r -> 'place' ->> 'providerPlaceId' <> 'ChIJlekkiConservation1'
     OR r -> 'link' <> jsonb_build_object('url', 'https://www.LekkiCentre.example.com/menu', 'domain', 'lekkicentre.example.com',
                                          'title', NULL, 'imageUrl', NULL, 'siteName', NULL, 'fetchedAt', NULL)
     OR r -> 'places' <> '[]'::jsonb OR NOT (r ->> 'canAddPlace')::boolean THEN
    RAISE EXCEPTION 'PL-10: a Google place plan carries its link, no places yet, canAddPlace (got %)', r;
  END IF;

  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  v_list := public.chat_plans_for_conversation(pg_temp.t4261p_id('crew'));
  RESET ROLE;
  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = pg_temp.t4261p_val('deck_plan');
  IF r IS NULL OR r -> 'places' <> '[]'::jsonb OR (r ->> 'canAddPlace')::boolean THEN
    RAISE EXCEPTION 'PL-10: deck plans have places [] and canAddPlace false (got %)', r;
  END IF;
END $pl10$;

-- ── LP-01 link targets ──────────────────────────────────────────────────────
DO $lp01$
DECLARE
  r jsonb;
  v_err text;
  v_plan uuid := pg_temp.t4261p_val('plan_pool')::uuid;
  i int;
BEGIN
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  r := public.chat_plan_link_targets(pg_temp.t4261p_val('plan_mbx')::uuid);
  IF r -> 'urls' <> jsonb_build_array('https://www.LekkiCentre.example.com/menu') OR r ->> 'planId' <> pg_temp.t4261p_val('plan_mbx') THEN
    RAISE EXCEPTION 'LP-01: a member gets the plan''s missing link (got %)', r;
  END IF;
  r := public.chat_plan_link_targets(v_plan);
  IF r -> 'urls' <> jsonb_build_array('https://terrakulture.example.com/menu') THEN
    RAISE EXCEPTION 'LP-01: a place option''s link is a target (got %)', r;
  END IF;
  r := public.chat_plan_link_targets(pg_temp.t4261p_val('plan_none')::uuid);
  IF r -> 'urls' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'LP-01: a plan without links has no targets (got %)', r;
  END IF;
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('outsider');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format('SELECT public.chat_plan_link_targets(%L)', v_plan));
  RESET ROLE;
  IF v_err <> '42501:not_allowed' THEN
    RAISE EXCEPTION 'LP-01: a non-member gets not_allowed (got %)', v_err;
  END IF;

  -- Fresh ok -> excluded; failed older than 6 h -> included; failed recent -> excluded; ok older than 7 days -> included.
  INSERT INTO public.chat_plan_link_previews(url, outcome, title, fetched_at)
    VALUES ('https://terrakulture.example.com/menu', 'ok', 'Terra', now());
  INSERT INTO public.chat_plan_link_previews(url, outcome, fetched_at)
    VALUES ('https://www.LekkiCentre.example.com/menu', 'failed', now() - interval '7 hours');
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  IF public.chat_plan_link_targets(v_plan) -> 'urls' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'LP-01: a fresh ok preview is not a target';
  END IF;
  IF public.chat_plan_link_targets(pg_temp.t4261p_val('plan_mbx')::uuid) -> 'urls'
     <> jsonb_build_array('https://www.LekkiCentre.example.com/menu') THEN
    RAISE EXCEPTION 'LP-01: a failed preview older than 6 h is a target';
  END IF;
  RESET ROLE;
  UPDATE public.chat_plan_link_previews SET fetched_at = now() - interval '5 hours' WHERE url = 'https://www.LekkiCentre.example.com/menu';
  UPDATE public.chat_plan_link_previews SET fetched_at = now() - interval '8 days' WHERE url = 'https://terrakulture.example.com/menu';
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  IF public.chat_plan_link_targets(pg_temp.t4261p_val('plan_mbx')::uuid) -> 'urls' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'LP-01: a recent failed preview is not a target';
  END IF;
  IF public.chat_plan_link_targets(v_plan) -> 'urls' <> jsonb_build_array('https://terrakulture.example.com/menu') THEN
    RAISE EXCEPTION 'LP-01: an ok preview older than 7 days is a target';
  END IF;
  RESET ROLE;
  DELETE FROM public.chat_plan_link_previews;

  -- At most 7 (written directly past the RPC cap to prove the limit).
  FOR i IN 1..8 LOOP
    INSERT INTO public.chat_plan_place_options(plan_id, kind, place_name, link_url, link_domain, identity_key)
      VALUES (pg_temp.t4261p_val('plan_none')::uuid, 'address', 'Spot ' || i, 'https://spot' || i || '.example.com',
              'spot' || i || '.example.com', 't4261d-spot-' || i);
  END LOOP;
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  r := public.chat_plan_link_targets(pg_temp.t4261p_val('plan_none')::uuid);
  RESET ROLE;
  IF jsonb_array_length(r -> 'urls') <> 7 THEN
    RAISE EXCEPTION 'LP-01: at most 7 targets (got %)', r;
  END IF;
  DELETE FROM public.chat_plan_place_options WHERE identity_key LIKE 't4261d-spot-%';
END $lp01$;

-- ── LP-02 the store is service-role only ───────────────────────────────────
DO $lp02$
DECLARE
  v_err text;
  v_row public.chat_plan_link_previews%ROWTYPE;
  v_old timestamptz := now() - interval '1 day';
  v_list jsonb;
  r jsonb;
BEGIN
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try($q$SELECT public.chat_plan_link_preview_store('https://claystudio.example.com', 'ok', 'x', NULL, NULL, NULL)$q$);
  IF v_err NOT LIKE '42501:permission denied%' THEN
    RAISE EXCEPTION 'LP-02: authenticated cannot store a preview (got %)', v_err;
  END IF;
  v_err := pg_temp.t4261p_try($q$INSERT INTO public.chat_plan_link_previews(url, outcome) VALUES ('https://claystudio.example.com', 'ok')$q$);
  IF v_err NOT LIKE '42501:permission denied%' THEN
    RAISE EXCEPTION 'LP-02: authenticated cannot write previews directly (got %)', v_err;
  END IF;
  RESET ROLE;

  ALTER TABLE public.chat_plans DISABLE TRIGGER tg_4261_chat_plans_updated_at;
  UPDATE public.chat_plans SET updated_at = v_old
   WHERE id IN (pg_temp.t4261p_val('plan_addr_link')::uuid, pg_temp.t4261p_val('plan_pool')::uuid);
  ALTER TABLE public.chat_plans ENABLE TRIGGER tg_4261_chat_plans_updated_at;

  SET LOCAL ROLE service_role;
  PERFORM public.chat_plan_link_preview_store('https://claystudio.example.com', 'ok',
    E'  Clay   Studio\n— Lagos  ', 'Clay Studio', 'http://claystudio.example.com/cover.jpg', 'https://claystudio.example.com/');
  PERFORM public.chat_plan_link_preview_store('https://terrakulture.example.com/menu', 'ok',
    repeat('T', 300), repeat('S', 120), 'https://cdn.example.com/terra.jpg', NULL);
  PERFORM public.chat_plan_link_preview_store('https://never-pasted.example.com/', 'ok', 'Nope', NULL, NULL, NULL);
  PERFORM public.chat_plan_link_preview_store('https://claystudio.example.com', 'ok',
    'Clay Studio Lagos', 'Clay Studio', 'https://claystudio.example.com/cover.jpg', 'https://claystudio.example.com/');
  v_err := pg_temp.t4261p_try($q$SELECT public.chat_plan_link_preview_store('https://claystudio.example.com', 'pending', NULL, NULL, NULL, NULL)$q$);
  RESET ROLE;
  IF v_err <> '22023:invalid_input' THEN
    RAISE EXCEPTION 'LP-02: an unknown outcome is invalid_input (got %)', v_err;
  END IF;

  IF EXISTS (SELECT 1 FROM public.chat_plan_link_previews WHERE url = 'https://never-pasted.example.com/') THEN
    RAISE EXCEPTION 'LP-02: a URL no plan stores writes nothing';
  END IF;
  SELECT * INTO v_row FROM public.chat_plan_link_previews WHERE url = 'https://claystudio.example.com';
  IF v_row.attempts <> 2 OR v_row.title <> 'Clay Studio Lagos' OR v_row.image_url <> 'https://claystudio.example.com/cover.jpg' THEN
    RAISE EXCEPTION 'LP-02: an upsert counts attempts and replaces fields (got %)', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM public.chat_plan_link_previews WHERE url = 'https://terrakulture.example.com/menu';
  IF char_length(v_row.title) <> 200 OR char_length(v_row.site_name) <> 80 OR v_row.image_url <> 'https://cdn.example.com/terra.jpg' THEN
    RAISE EXCEPTION 'LP-02: title / site are truncated (got %)', row_to_json(v_row);
  END IF;
  IF (SELECT updated_at FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_addr_link')::uuid) <= v_old
     OR (SELECT updated_at FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_pool')::uuid) <= v_old THEN
    RAISE EXCEPTION 'LP-02: storing a preview bumps the plans that carry the URL (plan or place option)';
  END IF;

  -- An http:// image is stored as NULL.
  SET LOCAL ROLE service_role;
  PERFORM public.chat_plan_link_preview_store('https://www.LekkiCentre.example.com/menu', 'ok',
    'Lekki &amp; more', NULL, 'http://lekkicentre.example.com/cover.jpg', NULL);
  RESET ROLE;
  IF (SELECT image_url FROM public.chat_plan_link_previews WHERE url = 'https://www.LekkiCentre.example.com/menu') IS NOT NULL THEN
    RAISE EXCEPTION 'LP-02: an http:// image is stored as NULL';
  END IF;

  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  v_list := public.chat_plans_for_conversation(pg_temp.t4261p_id('plain'));
  RESET ROLE;
  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = pg_temp.t4261p_val('plan_addr_link');
  IF r -> 'link' ->> 'title' <> 'Clay Studio Lagos' OR r -> 'link' ->> 'imageUrl' <> 'https://claystudio.example.com/cover.jpg'
     OR r -> 'link' ->> 'siteName' <> 'Clay Studio' OR r -> 'link' ->> 'fetchedAt' IS NULL
     OR r -> 'link' ->> 'domain' <> 'claystudio.example.com' THEN
    RAISE EXCEPTION 'PL-10: preview fields appear after a store (got %)', r -> 'link';
  END IF;

  -- A failed fetch keeps the domain only, with fetchedAt set.
  SET LOCAL ROLE service_role;
  PERFORM public.chat_plan_link_preview_store('https://claystudio.example.com', 'failed', 'ignored', 'ignored', 'https://x.example.com/a.jpg', NULL);
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  v_list := public.chat_plans_for_conversation(pg_temp.t4261p_id('plain'));
  RESET ROLE;
  SELECT x INTO r FROM jsonb_array_elements(v_list -> 'plans') x WHERE x ->> 'id' = pg_temp.t4261p_val('plan_addr_link');
  IF r -> 'link' -> 'title' <> 'null'::jsonb OR r -> 'link' -> 'imageUrl' <> 'null'::jsonb OR r -> 'link' ->> 'fetchedAt' IS NULL THEN
    RAISE EXCEPTION 'PL-10: a failed preview shows no title / image but a fetchedAt (got %)', r -> 'link';
  END IF;
END $lp02$;

-- ── LP-04 RLS ───────────────────────────────────────────────────────────────
DO $lp04$
DECLARE
  v_n bigint;
  v_member bigint;
  v_err text;
BEGIN
  PERFORM pg_temp.t4261p_as('outsider');
  SET LOCAL ROLE authenticated;
  v_n := (SELECT count(*) FROM public.chat_plan_place_options) + (SELECT count(*) FROM public.chat_plan_place_votes);
  v_err := pg_temp.t4261p_try('SELECT count(*) FROM public.chat_plan_link_previews');
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'LP-04: a non-member reads zero option / vote rows (got %)', v_n;
  END IF;
  IF v_err NOT LIKE '42501:permission denied%' THEN
    RAISE EXCEPTION 'LP-04: nobody but the service role reads previews (got %)', v_err;
  END IF;
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  v_member := (SELECT count(*) FROM public.chat_plan_place_options WHERE plan_id = pg_temp.t4261p_val('plan_pool')::uuid);
  RESET ROLE;
  IF v_member <> 6 THEN
    RAISE EXCEPTION 'LP-04: a member reads the plan''s options (got %)', v_member;
  END IF;
END $lp04$;


-- ── PL-07 lock picks the winning place ─────────────────────────────────────
DO $pl07$
DECLARE
  r jsonb;
  v_err text;
  v_plan public.chat_plans%ROWTYPE;
  v_opt uuid;
  v_c uuid;
  v_d uuid;
  v_t timestamptz := date_trunc('hour', now()) + interval '6 days';
  v_before bigint;
  v_line public.messages%ROWTYPE;
  v_card jsonb;
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'plan_lock' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'PL-07: pg_proc holds exactly one plan_lock';
  END IF;

  -- a) The named option (a Google place with a link) wins on plan_pool.
  v_opt := (SELECT id FROM public.chat_plan_time_options WHERE plan_id = pg_temp.t4261p_val('plan_pool')::uuid ORDER BY starts_at LIMIT 1);
  v_before := pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain'));
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  -- A place option of another plan is refused.
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_lock(%L, %L, NULL, 120, %L)', pg_temp.t4261p_val('plan_pool'), v_opt,
             (SELECT id FROM public.chat_plan_place_options WHERE plan_id = pg_temp.t4261p_val('plan_closed')::uuid LIMIT 1)));
  IF v_err <> '22023:invalid_input' THEN
    RAISE EXCEPTION 'PL-07: a place option of another plan is invalid_input (got %)', v_err;
  END IF;
  r := public.plan_lock(pg_temp.t4261p_val('plan_pool')::uuid, v_opt, NULL, 120, pg_temp.t4261p_val('opt_google')::uuid);
  RESET ROLE;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_pool')::uuid;
  IF v_plan.status <> 'scheduled' OR v_plan.where_kind <> 'place' OR v_plan.place_pool_id IS NOT NULL
     OR v_plan.provider_place_id <> 'ChIJterraKulture00001' OR v_plan.place_name <> 'Terra Kulture' OR v_plan.place_address <> 'Victoria Island'
     OR v_plan.place_lat <> 6.43 OR v_plan.place_lng <> 3.42 OR v_plan.place_photo_url IS NOT NULL
     OR v_plan.link_url <> 'https://terrakulture.example.com/menu' OR v_plan.link_domain <> 'terrakulture.example.com'
     OR v_plan.scheduled_at <> (SELECT starts_at FROM public.chat_plan_time_options WHERE id = v_opt) THEN
    RAISE EXCEPTION 'PL-07a: the named place is copied into the plan (got %)', row_to_json(v_plan);
  END IF;
  SELECT card_data INTO v_card FROM public.calendar_entries
   WHERE chat_plan_id = v_plan.id AND user_id = pg_temp.t4261p_id('seth');
  IF v_card IS NULL OR v_card ->> 'placeName' <> 'Terra Kulture' OR v_card ->> 'linkUrl' <> 'https://terrakulture.example.com/menu'
     OR v_card ->> 'address' <> 'Victoria Island' OR v_card -> 'image' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'PL-07a: the calendar entry has the winning place (got %)', v_card;
  END IF;
  IF pg_temp.t4261p_msgs(pg_temp.t4261p_id('plain')) - v_before <> 1 THEN
    RAISE EXCEPTION 'PL-07a: one lock line';
  END IF;
  SELECT * INTO v_line FROM public.messages
   WHERE conversation_id = pg_temp.t4261p_id('plain') AND card_payload ->> 'event' = 'locked'
     AND card_payload ->> 'planId' = v_plan.id::text;
  IF v_line.content <> 'Seth locked in Rooftop drinks' OR v_line.card_payload ->> 'placeName' <> 'Terra Kulture'
     OR NOT (v_line.card_payload ->> 'placeVoted')::boolean OR v_line.card_payload ->> 'scheduledAt' IS NULL THEN
    RAISE EXCEPTION 'PL-07a: the lock line carries placeName + placeVoted (got %)', v_line.card_payload;
  END IF;

  -- b) NULL picks the leader (most votes), called with the four old named arguments.
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  v_c := (public.plan_create(pg_temp.t4261p_id('plain'), NULL, 'Leader vote', 'place',
           jsonb_build_object('poolId', pg_temp.t4261p_id('pool_skyline')), NULL, 'none', NULL, NULL, true, NULL) ->> 'planId')::uuid;
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  r := public.plan_add_place(v_c, 'place', jsonb_build_object('poolId', pg_temp.t4261p_id('pool_lagoon')));
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('kemi');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_set_place_vote((r ->> 'optionId')::uuid, true);
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_lock(p_plan_id => v_c, p_option_id => NULL, p_scheduled_at => v_t, p_duration_minutes => 90);
  RESET ROLE;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = v_c;
  IF v_plan.status <> 'scheduled' OR v_plan.duration_minutes <> 90 OR v_plan.place_pool_id <> pg_temp.t4261p_id('pool_lagoon')
     OR v_plan.place_name <> 'Lagoon Lounge T4261' OR v_plan.place_photo_url <> 'https://example.test/lagoon.jpg'
     OR v_plan.link_url IS NOT NULL THEN
    RAISE EXCEPTION 'PL-07b: NULL locks the leading place (got %)', row_to_json(v_plan);
  END IF;
  IF (SELECT card_data ->> 'image' FROM public.calendar_entries WHERE chat_plan_id = v_c AND user_id = pg_temp.t4261p_id('seth'))
     <> 'https://example.test/lagoon.jpg' THEN
    RAISE EXCEPTION 'PL-07b: the calendar entry has the leader''s photo';
  END IF;

  -- c) A tie goes to the original.
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  v_d := (public.plan_create(pg_temp.t4261p_id('plain'), NULL, 'Tie vote', 'place',
           jsonb_build_object('poolId', pg_temp.t4261p_id('pool_skyline')), NULL, 'none', NULL, NULL, true, NULL) ->> 'planId')::uuid;
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_add_place(v_d, 'place', jsonb_build_object('poolId', pg_temp.t4261p_id('pool_lagoon')));
  RESET ROLE;
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_lock(v_d, NULL, v_t);
  RESET ROLE;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = v_d;
  IF v_plan.place_pool_id <> pg_temp.t4261p_id('pool_skyline') OR v_plan.place_name <> 'Skyline Terrace T4261' THEN
    RAISE EXCEPTION 'PL-07c: a tie locks the original (got %)', row_to_json(v_plan);
  END IF;
  SELECT * INTO v_line FROM public.messages
   WHERE card_payload ->> 'event' = 'locked' AND card_payload ->> 'planId' = v_d::text;
  IF v_line.card_payload ->> 'placeName' <> 'Skyline Terrace T4261' OR NOT (v_line.card_payload ->> 'placeVoted')::boolean THEN
    RAISE EXCEPTION 'PL-07c: a voted original still says placeVoted (got %)', v_line.card_payload;
  END IF;

  -- d) A plan nobody suggested a place on locks as before (no placeVoted).
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  PERFORM public.plan_lock(pg_temp.t4261p_val('plan_mbx')::uuid, NULL, v_t);
  RESET ROLE;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = pg_temp.t4261p_val('plan_mbx')::uuid;
  SELECT * INTO v_line FROM public.messages
   WHERE card_payload ->> 'event' = 'locked' AND card_payload ->> 'planId' = v_plan.id::text;
  IF v_plan.provider_place_id <> 'ChIJlekkiConservation1' OR v_plan.link_url <> 'https://www.LekkiCentre.example.com/menu'
     OR v_line.card_payload ? 'placeVoted' OR v_line.card_payload ? 'placeName' THEN
    RAISE EXCEPTION 'PL-07d: no place options -> the plan''s own place, no placeVoted (got % / %)', row_to_json(v_plan), v_line.card_payload;
  END IF;

  -- e) A deck lock refuses a place option id.
  PERFORM pg_temp.t4261p_as('tobi');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_lock(%L, NULL, %L, 120, %L)', pg_temp.t4261p_val('deck_plan'), v_t,
             pg_temp.t4261p_val('opt_lagoon')));
  RESET ROLE;
  IF v_err <> '22023:invalid_input' THEN
    RAISE EXCEPTION 'PL-07e: a deck lock takes no place option (got %)', v_err;
  END IF;

  -- After the lock: no more suggestions or place votes.
  PERFORM pg_temp.t4261p_as('ada');
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.t4261p_try(format('SELECT public.plan_set_place_vote(%L, false)', pg_temp.t4261p_val('opt_lagoon')));
  RESET ROLE;
  IF v_err <> 'PT409:conflict_plan_not_deciding' THEN
    RAISE EXCEPTION 'PL-07: a locked plan takes no place votes (got %)', v_err;
  END IF;
END $pl07$;

-- ── A2 regression: P-03, P-04, P-06 unchanged ──────────────────────────────
-- Fixture for the copied blocks: plan_a and msg_a as A2 P-01a creates them.
DO $r00$
DECLARE
  r jsonb;
BEGIN
  PERFORM pg_temp.t4261p_as('seth');
  SET LOCAL ROLE authenticated;
  r := public.plan_create(pg_temp.t4261p_id('plain'), '00000000-0000-4000-8000-000000004261', 'Rooftop drinks',
         'place', jsonb_build_object('poolId', pg_temp.t4261p_id('pool_skyline'), 'name', 'FAKE NAME', 'lat', 1, 'lng', 1),
         NULL, 'poll', NULL, ARRAY[now() + interval '2 days', now() + interval '3 days'], true, 'Bring cash');
  INSERT INTO t4261p_vals VALUES ('plan_a', r ->> 'planId'), ('msg_a', r ->> 'messageId');
  RESET ROLE;
END $r00$;

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

ROLLBACK;

\echo 'issue_4261_plan_places_and_link_previews: all assertions passed'
