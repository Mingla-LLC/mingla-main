-- =====================================================================================
-- Issue #2333 — TESTER adversarial probe. NEW FILE, append-only.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/__tests__/issue_2333_online_publish_hybrid_boundary.tester.pg17.test.sql
--
-- DIFFERENT ANGLE FROM THE IMPLEMENTOR'S C-* / D-* PROBES — read this before editing.
-- The implementor proved the hybrid boundary holds when `theme.business_event.format`
-- is SEEDED as 'hybrid' and never moves. Every one of C-03, C-07, D-03 and D-09 plants
-- the format literal and then asserts on it in the same transaction. That proves the
-- three guards read the key correctly. It does NOT prove the key still says 'hybrid'
-- by the time they read it.
--
-- This file attacks the OTHER half: what WRITES that key, whether every site AGREES on
-- how to read it, and whether the relax is reachable by the role that actually calls it.
--
--   X-01  the format key is rewritten from `is_online` by the live event-lifecycle RPCs,
--         so a genuine HYBRID event becomes 'online' and the carve-out broadcasts it.
--   X-02  S1, S2 and S3 do not normalise the format token the same way, so one string
--         publishes but can neither be edited nor found.
--   X-03  fail-closed for every NON-STRING format shape (the implementor tested only an
--         absent key).
--   X-04  the reporting customer's actual draft shape — multi-date, two free waitlisted
--         tickets — surfaces EXACTLY ONCE in an unrelated market.
--   X-05  the SPEC's forward-looking online-RSVP claim, executed.
--   X-06  S2's relax must be REACHABLE by `authenticated`, the role the business app
--         calls it as.
--
-- WRITE-SAFE: every case runs in its own transaction that ROLLBACKs. Auth context via
-- request.jwt.claim.sub, which is what auth.uid() reads. Every case EXECUTES the real
-- RPCs — nothing here is satisfied by a definition grep (issue #2113).
--
-- EXPECTED STATE AT THE TIME OF WRITING: X-01, X-02 and X-06 FAIL. They are not
-- speculative — each was reproduced on a real PostgreSQL 17 with the full migration set
-- applied, in BOTH apply orders (20270422001972 before ours, and after). They are
-- written as hard assertions because each one is a contract this issue's own SPEC §6
-- declares, and a red gate is the correct signal until they are honoured.
--
-- FAILS-ON-REVERT — MEASURED, not asserted (delete the fix, do not comment it out):
--   * delete `AND v_format IS DISTINCT FROM 'online'` from 20270427002333 → X-04 goes
--     red: `city_required` is raised again and the customer's draft never publishes.
--     (X-03 and X-05 are deliberately NOT S1-sensitive — X-03 EXPECTS city_required and
--     X-05 runs the RSVP path, which carries no city guard at all.)
--   * delete the `AND lower(...->>'format') = 'online'` conjunct from 20270427002335
--     (the naive bare-is_online carve-out) → X-01 fails EARLIER and HARDER, at its own
--     setup assertion: the hybrid control leaks into London with no lifecycle round-trip
--     at all. X-01 therefore catches BOTH the naive predicate and the durability hole.
--   * delete the theme-format conjunct from 20270427002334 → X-02's patch column flips
--     for every spelling, so the three-site agreement it asserts changes shape.
-- =====================================================================================

\set ON_ERROR_STOP on

-- ─── shared seed helper ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.i2333_seed_brand(OUT o_user uuid, OUT o_brand uuid)
LANGUAGE plpgsql AS $$
BEGIN
  o_user := gen_random_uuid();
  o_brand := gen_random_uuid();
  INSERT INTO auth.users (id) VALUES (o_user);
  INSERT INTO public.creator_accounts (id) VALUES (o_user);
  INSERT INTO public.brands (id, account_id, name, slug, default_currency)
    VALUES (o_brand, o_user, 'i2333 tester', 'i2333-t-' || o_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', o_user::text, true);
END $$;

-- Build a publishable business_draft for a given format, with or without a city.
CREATE OR REPLACE FUNCTION pg_temp.i2333_draft(p_format jsonb, p_city text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'requestedVisibility', 'public',
    'city', p_city,
    'tickets', jsonb_build_array(jsonb_build_object(
      'name','Free entry','isFree',true,'price',0,'capacity',100)),
    'partyTypes', jsonb_build_array('festival'),
    'vibeTags', jsonb_build_array('exclusive'),
    'whenMode','single',
    'when', jsonb_build_object(
      'date', to_char(now() + interval '15 days','YYYY-MM-DD'),
      'doorsOpen','19:00','endsAt','22:00')))
  || CASE WHEN p_format IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('format', p_format) END;
$$;

-- Is the event returned by a browse of a market it does not belong to?
CREATE OR REPLACE FUNCTION pg_temp.i2333_visible_in(p_event uuid, p_city text)
RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      (public.pg_discover_business_events(
         ARRAY[p_city]::text[], now() - interval '1 day', now() + interval '365 days',
         NULL, NULL, NULL, 0, 100, NULL, NULL, NULL))->'rows') e
    WHERE (e->>'id')::uuid = p_event);
$$;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- X-01 — THE DURABILITY HOLE. A genuine HYBRID event must never reach a market it has
--        no catchment in, no matter what the host does to it in between.
--
-- I-2333-ONLINE-ONLY-CARVE-OUT-IS-FORMAT-SCOPED rests entirely on
-- I-2333-ONLINE-FORMAT-IS-DURABLE: "Any new RPC that writes events.theme for a standard
-- event must merge, never wholesale-replace." `business_unpublish_event_to_draft`
-- (20270422001972, #2089 — MERGED) does `UPDATE public.events SET ... theme =
-- v_payload->'theme'`, a wholesale replace, and the payload it installs comes from
-- `business_event_draft_payload_from_graph`, which sets
--     'format', CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END
-- `is_online` is TRUE for hybrid (serverDraftEventMapper.ts:708), so HYBRID is collapsed
-- to 'online' and can never be recovered — the client's `asDraftFormat` trusts any valid
-- enum value it finds. `business_duplicate_event_as_draft` installs the same payload.
-- BOTH are live buttons in the business app (businessEvents.ts:1086 and :1095).
--
-- Net effect once 20270427002335 is applied: a Lagos hybrid event with a real venue is
-- broadcast into every market on earth — the exact outcome the INVESTIGATION's F-8 calls
-- "spam, and is not what was decided".
-- ═══════════════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  s record; v_event uuid := gen_random_uuid(); v_dup jsonb; v_dup_id uuid;
  v_fmt_published text; v_fmt_dup text; v_fmt_unpub text; v_fmt_final text;
  v_leaked boolean; v_dup_leaks boolean;
BEGIN
  s := pg_temp.i2333_seed_brand();
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, s.o_brand, 'x01 hybrid', 'i2333-x01-'||v_event, 'event','draft','draft','UTC');

  -- A genuine hybrid event, published the correct way, WITH its real city.
  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title','Lagos Hybrid Summit','timezone','UTC','is_online',true,
    'online_url','https://zoom.us/j/9',
    'theme', jsonb_build_object('business_draft', pg_temp.i2333_draft('"hybrid"'::jsonb, 'Lagos'))));

  SELECT theme->'business_event'->>'format' INTO v_fmt_published
    FROM public.events WHERE id = v_event;
  IF v_fmt_published IS DISTINCT FROM 'hybrid' THEN
    RAISE EXCEPTION 'X-01 SETUP FAIL: a hybrid publish did not store format=hybrid (got %)', v_fmt_published;
  END IF;
  IF pg_temp.i2333_visible_in(v_event, 'London') THEN
    RAISE EXCEPTION 'X-01 SETUP FAIL: the hybrid control leaked into London before any round-trip';
  END IF;

  -- (a) DUPLICATE — businessEvents.ts:1095.
  v_dup := public.business_duplicate_event_as_draft(v_event);
  v_dup_id := ((v_dup->'event')->>'id')::uuid;
  SELECT COALESCE(theme->'business_draft'->>'format', theme->'business_event'->>'format')
    INTO v_fmt_dup FROM public.events WHERE id = v_dup_id;

  -- (b) UNPUBLISH TO DRAFT — businessEvents.ts:1086.
  PERFORM public.business_unpublish_event_to_draft(v_event);
  SELECT COALESCE(theme->'business_draft'->>'format', theme->'business_event'->>'format')
    INTO v_fmt_unpub FROM public.events WHERE id = v_event;

  -- (c) The host taps Publish again, sending back exactly what the server handed them.
  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title','Lagos Hybrid Summit','timezone','UTC','is_online',true,
    'online_url','https://zoom.us/j/9',
    'theme', jsonb_build_object('business_draft',
      (SELECT theme->'business_draft' FROM public.events WHERE id = v_event)
      || jsonb_build_object(
           'tickets', jsonb_build_array(jsonb_build_object(
             'name','Free entry','isFree',true,'price',0,'capacity',100)),
           'whenMode','single',
           'when', jsonb_build_object(
             'date', to_char(now() + interval '15 days','YYYY-MM-DD'),
             'doorsOpen','19:00','endsAt','22:00')))));
  SELECT theme->'business_event'->>'format' INTO v_fmt_final
    FROM public.events WHERE id = v_event;

  v_leaked := pg_temp.i2333_visible_in(v_event, 'London');
  v_dup_leaks := (v_fmt_dup = 'online');

  IF v_fmt_dup IS DISTINCT FROM 'hybrid' OR v_fmt_unpub IS DISTINCT FROM 'hybrid' THEN
    RAISE EXCEPTION
      'X-01 FAIL (DURABILITY): theme format is NOT durable — a HYBRID event became % after '
      'duplicate and % after unpublish. business_event_draft_payload_from_graph derives '
      'format from is_online, which is TRUE for hybrid. '
      'I-2333-ONLINE-FORMAT-IS-DURABLE is violated by 20270422001972.',
      v_fmt_dup, v_fmt_unpub;
  END IF;

  IF v_leaked THEN
    RAISE EXCEPTION
      'X-01 FAIL (BROADCAST): a HYBRID event in Lagos with a real venue surfaced in a '
      'LONDON browse after a duplicate/unpublish round-trip (format is now %). '
      'I-2333-ONLINE-ONLY-CARVE-OUT-IS-FORMAT-SCOPED is violated.', v_fmt_final;
  END IF;

  RAISE NOTICE 'X-01 PASS: a hybrid event survives the lifecycle round-trip and stays out of other markets';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- X-02 — ONE TOKEN, THREE READERS, THREE ANSWERS.
--        S1 normalises with lower(btrim(...)); S2 and S3 normalise with lower(...) only.
--        A format string that publishes must also be editable and findable, or the relax
--        hands the host exactly the two failures this issue exists to remove: the
--        soft-bricked edit (blast-radius audit §2) and the silent invisibility (§1).
-- ═══════════════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  variant text;
  s record; v_event uuid; v_published boolean; v_patched boolean; v_found boolean;
  v_disagreements text := '';
BEGIN
  FOREACH variant IN ARRAY ARRAY['online', 'Online', 'ONLINE', ' online ']
  LOOP
    s := pg_temp.i2333_seed_brand();
    v_event := gen_random_uuid();
    INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
      VALUES (v_event, s.o_brand, 'x02', 'i2333-x02-'||v_event, 'event','draft','draft','UTC');

    BEGIN
      PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
        'title','X02 probe','timezone','UTC','is_online',true,
        'online_url','https://zoom.us/j/2',
        'theme', jsonb_build_object('business_draft',
          pg_temp.i2333_draft(to_jsonb(variant)))));
      v_published := true;
    EXCEPTION WHEN OTHERS THEN v_published := false; END;

    IF v_published THEN
      BEGIN
        PERFORM public.business_patch_event_taxonomy(
          v_event, '', ARRAY['festival']::text[], ARRAY['exclusive']::text[],
          NULL, NULL, NULL, NULL, NULL);
        v_patched := true;
      EXCEPTION WHEN OTHERS THEN v_patched := false; END;
      v_found := pg_temp.i2333_visible_in(v_event, 'London');
    ELSE
      v_patched := false; v_found := false;
    END IF;

    RAISE NOTICE 'X-02  format=[%]  publish=%  patch=%  discover=%',
      variant, v_published, v_patched, v_found;

    -- The contract: whatever counts as online, counts as online at ALL THREE sites.
    IF NOT (v_published = v_patched AND v_patched = v_found) THEN
      v_disagreements := v_disagreements || format('  %L -> publish=%s patch=%s discover=%s',
        variant, v_published, v_patched, v_found);
    END IF;
  END LOOP;

  IF v_disagreements <> '' THEN
    RAISE EXCEPTION
      'X-02 FAIL (NORMALISATION ASYMMETRY): the three city guards do not agree on which '
      'format string is online.%  20270427002333 uses lower(btrim(...)); 20270427002334 '
      'and 20270427002335 use lower(...) with no btrim. A string that publishes but '
      'cannot be patched or found reproduces BOTH failures this issue set out to fix.',
      v_disagreements;
  END IF;
  RAISE NOTICE 'X-02 PASS: publish, patch and discovery agree on every online spelling';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- X-03 — FAIL CLOSED for every NON-STRING format shape. C-04 covered only an absent key;
--        a JSON null, a number, a boolean, an array and an object are all reachable
--        shapes for a jsonb payload and each must still demand a city.
-- ═══════════════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  shapes jsonb[] := ARRAY['null'::jsonb, '1'::jsonb, 'true'::jsonb,
                          '["online"]'::jsonb, '{"v":"online"}'::jsonb, '""'::jsonb];
  shape jsonb; s record; v_event uuid; v_leaked text := '';
BEGIN
  FOREACH shape IN ARRAY shapes
  LOOP
    s := pg_temp.i2333_seed_brand();
    v_event := gen_random_uuid();
    INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
      VALUES (v_event, s.o_brand, 'x03', 'i2333-x03-'||v_event, 'event','draft','draft','UTC');
    BEGIN
      PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
        'title','X03 probe','timezone','UTC','is_online',true,
        'theme', jsonb_build_object('business_draft', pg_temp.i2333_draft(shape))));
      v_leaked := v_leaked || ' ' || shape::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'city_required' THEN
        RAISE EXCEPTION 'X-03 FAIL: format % raised %, expected city_required', shape, SQLERRM;
      END IF;
    END;
  END LOOP;
  IF v_leaked <> '' THEN
    RAISE EXCEPTION 'X-03 FAIL: these NON-STRING format shapes published with no city (must fail closed):%', v_leaked;
  END IF;
  RAISE NOTICE 'X-03 PASS: every non-string format shape still demands a city (fail-closed)';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- X-04 — THE REPORTING CUSTOMER'S ACTUAL DRAFT, reproduced field-for-field:
--        draft 3014ea7e-f3e0-40d0-b112-a51f4e37e964 — format=online, city absent,
--        is_multi_date over two consecutive days, TWO free waitlisted tickets,
--        requestedVisibility=public, and the Google Maps pin in the joining-link field.
--
--        NEW ANGLE: the implementor's D-06 paginated six SINGLE-date rows. A multi-date
--        event has N event_dates rows and the discovery query INNER JOINs event_dates.
--        If more than one were flagged is_master the customer's event would appear
--        TWICE in every market and skew `total` and every page boundary.
-- ═══════════════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  s record; v_event uuid := gen_random_uuid(); r record;
  v_dates int; v_masters int; v_tt int; v_res jsonb; v_hits int; v_total int;
BEGIN
  s := pg_temp.i2333_seed_brand();
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, s.o_brand, 'Untitled draft', 'i2333-x04-'||v_event, 'event','draft','draft','Africa/Lagos');

  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title','Art Exhibition','timezone','Africa/Lagos',
    'is_online', true, 'is_multi_date', true,
    'online_url','https://maps.app.goo.gl/Qr8MotQCkTcSw7bp8?g_st=ic',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format','online', 'requestedVisibility','public', 'lastStepReached', 6,
      'tickets', jsonb_build_array(
        jsonb_build_object('name','General Admission','isFree',true,'price',0,'capacity',100,'waitlistEnabled',true),
        jsonb_build_object('name','VIP','isFree',true,'price',0,'capacity',20,'waitlistEnabled',true)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('exclusive','vibrant','artsy'),
      'whenMode','multi_date',
      'multiDates', jsonb_build_array(
        jsonb_build_object('date', to_char(now()+interval '10 days','YYYY-MM-DD'),'startTime','10:00','endTime','18:00'),
        jsonb_build_object('date', to_char(now()+interval '11 days','YYYY-MM-DD'),'startTime','10:00','endTime','18:00'))))));

  SELECT status, visibility, city, is_online, is_multi_date,
         theme->'business_event'->>'format' AS tf
    INTO r FROM public.events WHERE id = v_event;
  IF r.status <> 'scheduled' OR r.visibility <> 'public' THEN
    RAISE EXCEPTION 'X-04 FAIL: customer draft did not go live (status=% visibility=%)', r.status, r.visibility;
  END IF;
  IF r.city IS NOT NULL THEN
    RAISE EXCEPTION 'X-04 FAIL: a city was invented for an online event (%)', r.city;
  END IF;
  IF r.is_online IS NOT TRUE OR r.is_multi_date IS NOT TRUE OR r.tf <> 'online' THEN
    RAISE EXCEPTION 'X-04 FAIL: row shape wrong (online_flag=% multi_date_flag=% stored_enum=%)',
      r.is_online, r.is_multi_date, r.tf;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_master) INTO v_dates, v_masters
    FROM public.event_dates WHERE event_id = v_event;
  SELECT count(*) INTO v_tt FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL;
  IF v_dates <> 2 OR v_masters <> 1 THEN
    RAISE EXCEPTION 'X-04 FAIL: expected 2 dates with exactly 1 master, got % dates / % masters', v_dates, v_masters;
  END IF;
  IF v_tt <> 2 THEN
    RAISE EXCEPTION 'X-04 FAIL: expected 2 ticket types, got %', v_tt;
  END IF;

  -- Browsed from a market it has no city for. Exactly ONE occurrence, and `total` counts
  -- it once — a second master row would silently double-count and skew every page.
  v_res := public.pg_discover_business_events(
    ARRAY['London']::text[], now() - interval '1 day', now() + interval '365 days',
    NULL, NULL, NULL, 0, 100, NULL, NULL, NULL);
  SELECT count(*) INTO v_hits FROM jsonb_array_elements(v_res->'rows') e
    WHERE (e->>'id')::uuid = v_event;
  v_total := (v_res->>'total')::int;
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'X-04 FAIL: the multi-date online event appeared % times in one London page (expected exactly 1)', v_hits;
  END IF;
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'X-04 FAIL: total=% for a single multi-date online event (expected 1)', v_total;
  END IF;

  -- The card payload the consumer grid and the buyer page read.
  IF (SELECT e->>'brand_slug' FROM jsonb_array_elements(v_res->'rows') e
       WHERE (e->>'id')::uuid = v_event) IS NULL THEN
    RAISE EXCEPTION 'X-04 FAIL: the discovery row carries no brand_slug — the buyer URL cannot be built';
  END IF;
  IF (SELECT e#>>'{theme,business_event,format}' FROM jsonb_array_elements(v_res->'rows') e
       WHERE (e->>'id')::uuid = v_event) <> 'online' THEN
    RAISE EXCEPTION 'X-04 FAIL: the discovery row does not carry theme.business_event.format=online, '
      'which is what deriveSharedFormat reads to put the Online badge on the card';
  END IF;

  RAISE NOTICE 'X-04 PASS: the customer draft publishes, keeps a NULL city, and surfaces exactly once in an unrelated market';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- X-05 — the SPEC's forward-looking RSVP claim, EXECUTED rather than asserted:
--        "For rows created from now on, an online RSVP row that is public +
--        rsvp_discoverable will surface." business_publish_rsvp_draft has no city guard
--        at all, so it is the one path that could already mint the shape the carve-out
--        now admits.
-- ═══════════════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  s record; v_event uuid := gen_random_uuid();
  v_is_online boolean; v_city text; v_tf text; v_before boolean; v_after boolean;
BEGIN
  s := pg_temp.i2333_seed_brand();
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, s.o_brand, 'x05 rsvp', 'i2333-x05-'||v_event, 'rsvp','draft','draft','UTC');

  PERFORM public.business_publish_rsvp_draft(v_event, jsonb_build_object(
    'title','Online RSVP','timezone','UTC','is_online',true,
    'online_url','https://zoom.us/j/5',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format','online','requestedVisibility','public',
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('exclusive'),
      'whenMode','single',
      'when', jsonb_build_object(
        'date', to_char(now()+interval '12 days','YYYY-MM-DD'),
        'doorsOpen','19:00','endsAt','22:00')))));

  SELECT is_online, city, theme->'business_event'->>'format'
    INTO v_is_online, v_city, v_tf FROM public.events WHERE id = v_event;
  IF v_is_online IS NOT TRUE OR v_city IS NOT NULL OR v_tf <> 'online' THEN
    RAISE EXCEPTION 'X-05 SETUP FAIL: rsvp publish shape wrong (online_flag=% city_value=% stored_enum=%)',
      v_is_online, v_city, v_tf;
  END IF;

  -- The rsvp_discoverable gate must still hold: opting OUT keeps it out of every feed,
  -- carve-out or not. The carve-out widened LOCATION only.
  v_before := pg_temp.i2333_visible_in(v_event, 'London');
  IF v_before THEN
    RAISE EXCEPTION 'X-05 FAIL: an online RSVP surfaced while rsvp_discoverable was false — '
      'the carve-out widened more than location';
  END IF;

  UPDATE public.events SET rsvp_discoverable = true WHERE id = v_event;
  v_after := pg_temp.i2333_visible_in(v_event, 'London');
  IF NOT v_after THEN
    RAISE EXCEPTION 'X-05 FAIL: an online RSVP that opted IN still does not surface — '
      'the SPEC records this as the forward-looking behaviour of the carve-out';
  END IF;

  RAISE NOTICE 'X-05 PASS: an online RSVP surfaces only once the host opts in, in every market';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- X-06 — S2 MUST BE REACHABLE BY THE ROLE THAT CALLS IT.
--        `business_patch_event_taxonomy` is invoked straight from the business app via
--        PostgREST (businessEvents.ts:1226, `supabase.rpc(...)`), i.e. as `authenticated`.
--        20270422001972 (#2089, MERGED) ends with
--            REVOKE EXECUTE ON FUNCTION public.business_patch_event_taxonomy(...)
--              FROM PUBLIC, anon, authenticated;
--        granting it to service_role only. The relax in 20270427002334 is then correct
--        SQL that the app can never reach — and the published-event taxonomy edit path
--        is closed for EVERY event, not just online ones.
--
--        This case is conditional on #2089 being present so it stays meaningful in both
--        apply orders: prod's applied head is currently 20270423002290, which is BELOW
--        20270422001972, so today the grant survives and this passes.
-- ═══════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_2089_present boolean;
  v_can boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'business_guard_event_publish_visibility')
    INTO v_2089_present;
  v_can := has_function_privilege(
    'authenticated',
    'public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)',
    'EXECUTE');

  IF NOT v_2089_present THEN
    IF NOT v_can THEN
      RAISE EXCEPTION 'X-06 FAIL: authenticated cannot execute business_patch_event_taxonomy '
        'even without #2089 — 20270427002334 is unreachable from the business app';
    END IF;
    RAISE NOTICE 'X-06 PASS (pre-#2089 shape): authenticated can still reach the patch RPC';
    RETURN;
  END IF;

  IF NOT v_can THEN
    RAISE EXCEPTION
      'X-06 FAIL (S2 UNREACHABLE): 20270422001972 revoked EXECUTE on '
      'business_patch_event_taxonomy from `authenticated`, and the business app calls it '
      'directly as that role (businessEvents.ts:1226). The 20270427002334 relax cannot be '
      'reached, and every published-event taxonomy edit now fails with '
      '"permission denied for function business_patch_event_taxonomy" — for every event, '
      'not just online ones.';
  END IF;
  RAISE NOTICE 'X-06 PASS: authenticated can reach the patch RPC alongside #2089';
END $$;

DO $$ BEGIN RAISE NOTICE 'issue #2333 TESTER probe: X-01 … X-06 complete'; END $$;
