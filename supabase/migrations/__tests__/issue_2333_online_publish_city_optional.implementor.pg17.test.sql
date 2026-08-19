-- =====================================================================================
-- Issue #2333 — IMPLEMENTOR happy-path regression probe (SPEC §9).
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/__tests__/issue_2333_online_publish_city_optional.implementor.pg17.test.sql
--
-- Runs in CI against a real PostgreSQL 17 fixture with every migration applied
-- (.github/workflows/issue-2333-online-event-publish.yml).
--
-- WRITE-SAFE: every behavioural case runs inside its own transaction that ROLLBACKs,
-- so no fixture data survives. Auth context is supplied via request.jwt.claim.sub,
-- which is what auth.uid() reads.
--
-- SCOPE: this file covers the migrations that are IN SCOPE for the implementor's
-- S1+S2 dispatch:
--   20270427002333  business_publish_event_draft   — city_required becomes format-aware
--   20270427002334  business_patch_event_taxonomy  — same relax, keyed off the stored row
-- SPEC §9's third leg (T-8, pg_discover_business_events) is DELIBERATELY ABSENT: S3 is
-- HELD on open design question OQ-1 and its migration (20270427002335) does not exist
-- on this branch. When S3 lands it brings its own append-only test file.
--
-- EVERY CASE EXECUTES THE REAL RPC. Nothing here is satisfied by a definition grep
-- alone (issue #2113 — checks that carry no info); C-00 is a catalogue seal that runs
-- IN ADDITION to, never instead of, the executed mutations.
--
-- FAILS-ON-REVERT (delete the fix, do not comment it out):
--   * delete `AND v_format IS DISTINCT FROM 'online'` from 20270427002333 → C-01, C-05
--     and C-06 fail (the online publish is refused again), and C-00 fails.
--   * delete the `AND lower(COALESCE(v_event.theme->'business_event'->>'format',''))
--     <> 'online'` conjunct from 20270427002334 → C-06 fails (the online event is
--     uneditable again), and C-00 fails.
--
-- THE REGRESSION GATE — READ BEFORE CHANGING ANYTHING HERE.
-- `is_online` is written `draft.format === "online" || draft.format === "hybrid"`
-- (mingla-business/src/utils/serverDraftEventMapper.ts:708). A naive implementation
-- that keys either guard on `is_online` COMPILES and PASSES the online happy path
-- (C-01, C-05) while silently exempting HYBRID from a city the client REQUIRES for
-- hybrid (validateWhere:382-406). C-03 (SC-3 / T-3) and C-07 (SC-6 / T-7) are the two
-- cases that catch it, and they carry `is_online: true` in the payload / on the row so
-- an `is_online`-keyed guard cannot pass them by accident.
-- Pinned by DRAFT invariant I-2333-CITY-GUARDS-ARE-FORMAT-AWARE-NOT-ONLINE-AWARE.
-- =====================================================================================

\set ON_ERROR_STOP on

-- ─── C-00: catalogue seal — both guards are format-keyed, neither is is_online-keyed ──
-- Read off the LIVE installed definitions, not off the migration text, so a hand-edit
-- applied straight to a database is caught too. This is a seal, not the proof; the
-- proof is C-01 … C-09, which execute the mutations.
DO $$
DECLARE
  d_pub text;
  d_patch text;
  d_pub_code text;
  d_patch_code text;
BEGIN
  d_pub := pg_get_functiondef(
    'public.business_publish_event_draft(uuid,jsonb,integer)'::regprocedure);
  d_patch := pg_get_functiondef(
    'public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)'::regprocedure);

  IF position('v_format IS DISTINCT FROM ''online''' in d_pub) = 0 THEN
    RAISE EXCEPTION 'C-00 FAIL: business_publish_event_draft city_required is not keyed on format = online';
  END IF;
  IF position('v_format := lower(NULLIF(btrim(COALESCE(v_business_draft->>''format'', '''')), ''''))' in d_pub) = 0 THEN
    RAISE EXCEPTION 'C-00 FAIL: business_publish_event_draft does not read format from business_draft';
  END IF;
  IF position('''business_event''->>''format''' in d_patch) = 0 THEN
    RAISE EXCEPTION 'C-00 FAIL: business_patch_event_taxonomy city_required is not keyed on theme.business_event.format';
  END IF;

  -- The trap: neither city_required guard may mention is_online in its CONDITION.
  -- Comments are stripped first — both migrations deliberately EXPLAIN the is_online
  -- trap in prose right above the guard, and business_publish_event_draft legitimately
  -- WRITES is_online in its UPDATE, so the scan is over executable code only and is
  -- bounded to the block between the v_city read and the next guard.
  d_pub_code := regexp_replace(d_pub, '--[^' || chr(10) || ']*', '', 'g');
  d_patch_code := regexp_replace(d_patch, '--[^' || chr(10) || ']*', '', 'g');

  IF position('is_online' in substring(d_pub_code from position('v_city :=' in d_pub_code)
                                       for (position('party_types_required' in d_pub_code)
                                            - position('v_city :=' in d_pub_code)))) > 0 THEN
    RAISE EXCEPTION 'C-00 FAIL: the publish city_required block keys on is_online — is_online is TRUE for HYBRID (serverDraftEventMapper.ts:708)';
  END IF;
  IF position('is_online' in substring(d_patch_code from position('v_city :=' in d_patch_code)
                                       for (position('party_types_required' in d_patch_code)
                                            - position('v_city :=' in d_patch_code)))) > 0 THEN
    RAISE EXCEPTION 'C-00 FAIL: the patch city_required block keys on is_online — is_online is TRUE for HYBRID (serverDraftEventMapper.ts:708)';
  END IF;

  RAISE NOTICE 'C-00 PASS: both city_required guards key on format, neither on is_online';
END $$;

-- ─── C-01 (SC-1 / T-1): an ONLINE-ONLY draft publishes with no city ─────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_status text;
  v_city text;
  v_is_online boolean;
  v_theme_format text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2333 c01', 'i2333-c01-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'c01 draft', 'c01-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'C01 Online Exhibition',
    'timezone', 'UTC',
    'is_online', true,
    'online_url', 'https://zoom.us/j/123456789',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'online',
      -- issue #2333 fixture repair: #2089's business_guard_event_publish_visibility
      -- trigger (20270422001972, merged into main AFTER this file was written) refuses
      -- any business draft->scheduled transition whose stored
      -- theme.business_event.requestedVisibility is not one of public|unlisted|private.
      -- The publish RPC copies business_draft through to business_event (it is not in
      -- the strip list), so the DRAFT must carry it. The real client always sends it
      -- (serverDraftEventMapper.ts:349). ADDITIONS ONLY — no assertion is weakened.
      'requestedVisibility', 'public',
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('exclusive', 'vibrant', 'artsy'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));

  SELECT status, city, is_online, theme->'business_event'->>'format'
    INTO v_status, v_city, v_is_online, v_theme_format
    FROM public.events WHERE id = v_event;

  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'C-01 FAIL: online publish did not reach scheduled (got %)', v_status;
  END IF;
  IF v_city IS NOT NULL THEN
    RAISE EXCEPTION 'C-01 FAIL: online publish wrote city % (expected NULL)', v_city;
  END IF;
  IF v_is_online IS NOT TRUE THEN
    RAISE EXCEPTION 'C-01 FAIL: online publish did not set is_online (got %)', v_is_online;
  END IF;
  -- The durability claim S2 and S3 both rest on: publish promotes city out of the
  -- theme but leaves `format` behind in business_event.
  -- Pinned by DRAFT invariant I-2333-ONLINE-FORMAT-IS-DURABLE.
  IF v_theme_format IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'C-01 FAIL: theme.business_event.format is % after publish (expected online)', v_theme_format;
  END IF;
  RAISE NOTICE 'C-01 PASS: an online-only draft publishes with city NULL and keeps theme.business_event.format';
END $$;
ROLLBACK;

-- ─── C-02 (SC-2 / T-2): IN_PERSON with no city is still refused ─────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2333 c02', 'i2333-c02-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'c02 draft', 'c02-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  BEGIN
    PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
      'title', 'C02 In Person Party',
      'timezone', 'UTC',
      'theme', jsonb_build_object('business_draft', jsonb_build_object(
        'format', 'in_person',
        -- issue #2333 fixture repair: #2089's business_guard_event_publish_visibility
        -- trigger (20270422001972, merged into main AFTER this file was written) refuses
        -- any business draft->scheduled transition whose stored
        -- theme.business_event.requestedVisibility is not one of public|unlisted|private.
        -- The publish RPC copies business_draft through to business_event (it is not in
        -- the strip list), so the DRAFT must carry it. The real client always sends it
        -- (serverDraftEventMapper.ts:349). ADDITIONS ONLY — no assertion is weakened.
        'requestedVisibility', 'public',
        'tickets', jsonb_build_array(jsonb_build_object(
          'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
        'partyTypes', jsonb_build_array('festival'),
        'whenMode', 'single',
        'when', jsonb_build_object(
          'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
          'doorsOpen', '20:00', 'endsAt', '23:00')
      ))
    ));
    RAISE EXCEPTION 'C-02 FAIL: in_person publish with no city did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'city_required' THEN
      RAISE EXCEPTION 'C-02 FAIL: expected city_required, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'C-02 PASS: in_person with no city still raises city_required';
END $$;
ROLLBACK;

-- ─── C-03 (SC-3 / T-3): HYBRID with no city is still refused — THE REGRESSION GATE ──
-- The payload deliberately carries is_online = true, which is exactly what the client
-- sends for a hybrid draft (serverDraftEventMapper.ts:708). A guard keyed on is_online
-- passes this event through with no city; the correct guard refuses it.
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2333 c03', 'i2333-c03-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'c03 draft', 'c03-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  BEGIN
    PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
      'title', 'C03 Hybrid Party',
      'timezone', 'UTC',
      'is_online', true,                       -- what the client sends for HYBRID
      'online_url', 'https://meet.google.com/abc-defg-hij',
      'theme', jsonb_build_object('business_draft', jsonb_build_object(
        'format', 'hybrid',
        -- issue #2333 fixture repair: #2089's business_guard_event_publish_visibility
        -- trigger (20270422001972, merged into main AFTER this file was written) refuses
        -- any business draft->scheduled transition whose stored
        -- theme.business_event.requestedVisibility is not one of public|unlisted|private.
        -- The publish RPC copies business_draft through to business_event (it is not in
        -- the strip list), so the DRAFT must carry it. The real client always sends it
        -- (serverDraftEventMapper.ts:349). ADDITIONS ONLY — no assertion is weakened.
        'requestedVisibility', 'public',
        'tickets', jsonb_build_array(jsonb_build_object(
          'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
        'partyTypes', jsonb_build_array('festival'),
        'whenMode', 'single',
        'when', jsonb_build_object(
          'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
          'doorsOpen', '20:00', 'endsAt', '23:00')
      ))
    ));
    RAISE EXCEPTION 'C-03 FAIL: HYBRID publish with no city did NOT raise — the guard is keyed on is_online, not on format';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'city_required' THEN
      RAISE EXCEPTION 'C-03 FAIL: expected city_required, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'C-03 PASS (REGRESSION GATE): hybrid with no city still raises city_required despite is_online = true';
END $$;
ROLLBACK;

-- ─── C-04 (SC-4 / T-4): an ABSENT format fails CLOSED ───────────────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2333 c04', 'i2333-c04-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'c04 draft', 'c04-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  BEGIN
    PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
      'title', 'C04 Formatless Party',
      'timezone', 'UTC',
      'theme', jsonb_build_object('business_draft', jsonb_build_object(
        -- no 'format' key at all
        'tickets', jsonb_build_array(jsonb_build_object(
          'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
        'partyTypes', jsonb_build_array('festival'),
        'whenMode', 'single',
        'when', jsonb_build_object(
          'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
          'doorsOpen', '20:00', 'endsAt', '23:00')
      ))
    ));
    RAISE EXCEPTION 'C-04 FAIL: a draft with no format published with no city — the relax fails OPEN';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'city_required' THEN
      RAISE EXCEPTION 'C-04 FAIL: expected city_required, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'C-04 PASS: an absent format still demands a city (fail-closed)';
END $$;
ROLLBACK;

-- ─── C-05 (T-5): case and surrounding whitespace are normalised ─────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_status text;
  v_city text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2333 c05', 'i2333-c05-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'c05 draft', 'c05-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'C05 Shouty Online',
    'timezone', 'UTC',
    'is_online', true,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', '  ONLINE  ',
      -- issue #2333 fixture repair: #2089's business_guard_event_publish_visibility
      -- trigger (20270422001972, merged into main AFTER this file was written) refuses
      -- any business draft->scheduled transition whose stored
      -- theme.business_event.requestedVisibility is not one of public|unlisted|private.
      -- The publish RPC copies business_draft through to business_event (it is not in
      -- the strip list), so the DRAFT must carry it. The real client always sends it
      -- (serverDraftEventMapper.ts:349). ADDITIONS ONLY — no assertion is weakened.
      'requestedVisibility', 'public',
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));

  SELECT status, city INTO v_status, v_city FROM public.events WHERE id = v_event;
  IF v_status <> 'scheduled' OR v_city IS NOT NULL THEN
    RAISE EXCEPTION 'C-05 FAIL: "  ONLINE  " did not normalise (status %, city %)', v_status, v_city;
  END IF;
  RAISE NOTICE 'C-05 PASS: format is lower()ed and btrim()ed before the comparison';
END $$;
ROLLBACK;

-- ─── C-06 (SC-5 / T-6): a PUBLISHED online event stays editable ─────────────────────
-- Publishes through the real S1 path, then patches the real S2 path with the exact
-- shape EditPublishedScreen.tsx:1162 sends (finalCity ?? "" → NULLIF'd back to NULL).
-- This is the leg that proves S1 and S2 hand off: the row's format signal is whatever
-- publish actually left in the theme, not something the test planted.
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_city text;
  v_party text[];
  v_vibes text[];
  v_genres text[];
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2333 c06', 'i2333-c06-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'c06 draft', 'c06-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'C06 Online Exhibition',
    'timezone', 'UTC',
    'is_online', true,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'online',
      -- issue #2333 fixture repair: #2089's business_guard_event_publish_visibility
      -- trigger (20270422001972, merged into main AFTER this file was written) refuses
      -- any business draft->scheduled transition whose stored
      -- theme.business_event.requestedVisibility is not one of public|unlisted|private.
      -- The publish RPC copies business_draft through to business_event (it is not in
      -- the strip list), so the DRAFT must carry it. The real client always sends it
      -- (serverDraftEventMapper.ts:349). ADDITIONS ONLY — no assertion is weakened.
      'requestedVisibility', 'public',
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));

  PERFORM public.business_patch_event_taxonomy(
    v_event,
    '',                                             -- EditPublishedScreen sends "" for a null city
    ARRAY['rooftop-party']::text[],
    ARRAY['classy']::text[],
    ARRAY['afrobeats']::text[]
  );

  SELECT city, party_types, vibe_tags, music_genres
    INTO v_city, v_party, v_vibes, v_genres
    FROM public.events WHERE id = v_event;

  IF v_city IS NOT NULL THEN
    RAISE EXCEPTION 'C-06 FAIL: the patch wrote city % (expected NULL)', v_city;
  END IF;
  IF v_party IS DISTINCT FROM ARRAY['rooftop-party']::text[] THEN
    RAISE EXCEPTION 'C-06 FAIL: party_types not written (got %)', v_party;
  END IF;
  IF v_vibes IS DISTINCT FROM ARRAY['classy']::text[] THEN
    RAISE EXCEPTION 'C-06 FAIL: vibe_tags not written (got %)', v_vibes;
  END IF;
  IF v_genres IS DISTINCT FROM ARRAY['afrobeats']::text[] THEN
    RAISE EXCEPTION 'C-06 FAIL: music_genres not written (got %)', v_genres;
  END IF;
  RAISE NOTICE 'C-06 PASS: a published online event accepts a taxonomy patch with an empty city and stays city-less';
END $$;
ROLLBACK;

-- ─── C-07 (SC-6 / T-7): the patch still refuses a HYBRID row — THE REGRESSION GATE ──
-- The row is published hybrid WITH a city (so S1 lets it through) and therefore carries
-- is_online = true. A patch guard keyed on is_online would let its city be erased; the
-- correct guard, keyed on theme.business_event.format, refuses.
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_is_online boolean;
  v_fmt text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2333 c07', 'i2333-c07-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'c07 draft', 'c07-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'C07 Hybrid Party',
    'timezone', 'UTC',
    'is_online', true,                             -- what the client sends for HYBRID
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'hybrid',
      -- issue #2333 fixture repair: #2089's business_guard_event_publish_visibility
      -- trigger (20270422001972, merged into main AFTER this file was written) refuses
      -- any business draft->scheduled transition whose stored
      -- theme.business_event.requestedVisibility is not one of public|unlisted|private.
      -- The publish RPC copies business_draft through to business_event (it is not in
      -- the strip list), so the DRAFT must carry it. The real client always sends it
      -- (serverDraftEventMapper.ts:349). ADDITIONS ONLY — no assertion is weakened.
      'requestedVisibility', 'public',
      'city', 'Lagos',
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));

  SELECT is_online, theme->'business_event'->>'format'
    INTO v_is_online, v_fmt FROM public.events WHERE id = v_event;
  IF v_is_online IS NOT TRUE THEN
    RAISE EXCEPTION 'C-07 SETUP FAIL: the hybrid row is not is_online — the trap is not armed';
  END IF;
  IF v_fmt IS DISTINCT FROM 'hybrid' THEN
    RAISE EXCEPTION 'C-07 SETUP FAIL: theme.business_event.format is % (expected hybrid)', v_fmt;
  END IF;

  BEGIN
    PERFORM public.business_patch_event_taxonomy(
      v_event, '',
      ARRAY['rooftop-party']::text[],
      ARRAY['classy']::text[],
      ARRAY['afrobeats']::text[]
    );
    RAISE EXCEPTION 'C-07 FAIL: a HYBRID row accepted an empty city — the patch guard is keyed on is_online, not on format';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'city_required' THEN
      RAISE EXCEPTION 'C-07 FAIL: expected city_required, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'C-07 PASS (REGRESSION GATE): the patch still raises city_required for a hybrid row despite is_online = true';
END $$;
ROLLBACK;

-- ─── C-08 (SC-6 / T-7): the patch fails CLOSED when the row carries no format ───────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2333 c08', 'i2333-c08-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'c08 draft', 'c08-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'C08 Online Exhibition',
    'timezone', 'UTC',
    'is_online', true,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'online',
      -- issue #2333 fixture repair: #2089's business_guard_event_publish_visibility
      -- trigger (20270422001972, merged into main AFTER this file was written) refuses
      -- any business draft->scheduled transition whose stored
      -- theme.business_event.requestedVisibility is not one of public|unlisted|private.
      -- The publish RPC copies business_draft through to business_event (it is not in
      -- the strip list), so the DRAFT must carry it. The real client always sends it
      -- (serverDraftEventMapper.ts:349). ADDITIONS ONLY — no assertion is weakened.
      'requestedVisibility', 'public',
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));

  -- Simulate the falsifiable assumption behind I-2333-ONLINE-FORMAT-IS-DURABLE:
  -- a future writer that loses theme.business_event.format. The relax must degrade to
  -- demanding a city (fail-closed), never to a silent wrong-data state.
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event}', (theme->'business_event') - 'format')
   WHERE id = v_event;

  BEGIN
    PERFORM public.business_patch_event_taxonomy(
      v_event, '',
      ARRAY['rooftop-party']::text[],
      ARRAY['classy']::text[],
      ARRAY['afrobeats']::text[]
    );
    RAISE EXCEPTION 'C-08 FAIL: a row with no theme format accepted an empty city — the relax fails OPEN';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'city_required' THEN
      RAISE EXCEPTION 'C-08 FAIL: expected city_required, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'C-08 PASS: a lost theme format degrades to demanding a city (fail-closed)';
END $$;
ROLLBACK;

-- ─── C-09: the relax did not break the ORDINARY patch path ─────────────────────────
-- An in_person row with a REAL city must still patch normally. This is the "widened
-- one thing and nothing else" control for S2.
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_city text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2333 c09', 'i2333-c09-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'c09 draft', 'c09-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'C09 In Person Party',
    'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'in_person',
      -- issue #2333 fixture repair: #2089's business_guard_event_publish_visibility
      -- trigger (20270422001972, merged into main AFTER this file was written) refuses
      -- any business draft->scheduled transition whose stored
      -- theme.business_event.requestedVisibility is not one of public|unlisted|private.
      -- The publish RPC copies business_draft through to business_event (it is not in
      -- the strip list), so the DRAFT must carry it. The real client always sends it
      -- (serverDraftEventMapper.ts:349). ADDITIONS ONLY — no assertion is weakened.
      'requestedVisibility', 'public',
      'city', 'London',
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));

  SELECT city INTO v_city FROM public.events WHERE id = v_event;
  IF v_city <> 'London' THEN
    RAISE EXCEPTION 'C-09 FAIL: in_person publish did not write the city (got %)', v_city;
  END IF;

  PERFORM public.business_patch_event_taxonomy(
    v_event, 'Manchester',
    ARRAY['rooftop-party']::text[],
    ARRAY['classy']::text[],
    ARRAY['afrobeats']::text[]
  );

  SELECT city INTO v_city FROM public.events WHERE id = v_event;
  IF v_city <> 'Manchester' THEN
    RAISE EXCEPTION 'C-09 FAIL: the ordinary patch path no longer writes the city (got %)', v_city;
  END IF;
  RAISE NOTICE 'C-09 PASS: the ordinary in_person publish + patch path is unchanged';
END $$;
ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'issue #2333 implementor probe: C-00 … C-09 all PASS'; END $$;
