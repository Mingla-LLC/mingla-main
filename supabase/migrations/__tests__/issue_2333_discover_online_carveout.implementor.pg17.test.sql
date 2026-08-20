-- =====================================================================================
-- Issue #2333 — S3 IMPLEMENTOR regression probe: the ONLINE-ONLY discovery carve-out.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/__tests__/issue_2333_discover_online_carveout.implementor.pg17.test.sql
--
-- Runs in CI against a real PostgreSQL 17 fixture with every migration applied
-- (.github/workflows/issue-2333-online-event-publish.yml).
--
-- NEW FILE, append-only. The S1+S2 probe
-- (issue_2333_online_publish_city_optional.implementor.pg17.test.sql) is NOT edited —
-- it declared in its own header that SPEC §9 leg 3 (T-8) was deliberately absent
-- because 20270427002335 did not exist yet. This file is that leg, plus the negative
-- cases the carve-out demands.
--
-- SCOPE: 20270427002335 — pg_discover_business_events gains a THIRD OR arm on the
-- location predicate so an ONLINE-ONLY event surfaces in EVERY market.
--
-- WRITE-SAFE: every case runs inside its own transaction that ROLLBACKs. No fixture
-- data survives. The RPC is SECURITY DEFINER and STABLE, so no auth context is needed
-- (the existing #1020 suites call it the same way).
--
-- EVERY BEHAVIOURAL CASE EXECUTES THE REAL RPC (issue #2113 — a check that only greps
-- a definition carries no information). D-00 is a catalogue seal that runs IN ADDITION
-- to, never instead of, the executed queries.
--
-- FAILS-ON-REVERT (delete the fix, do not comment it out):
--   * delete the third OR arm from 20270427002335 → D-01, D-02, D-04 and D-08 fail
--     (the online event is returned by no market again), and D-00 fails.
--   * WIDEN the arm to a bare `e.is_online IS TRUE` (the naive version — it compiles
--     and passes D-01/D-02/D-04) → D-03 and D-09 fail, and D-00 fails.
--
-- ══ THE REGRESSION GATE — READ BEFORE CHANGING ANYTHING HERE ══
-- `is_online` is written `draft.format === "online" || draft.format === "hybrid"`
-- (mingla-business/src/utils/serverDraftEventMapper.ts:708). A carve-out keyed on a
-- BARE `e.is_online` compiles, passes every online happy path in this file, and
-- silently broadcasts every HYBRID event — which has a real venue, a real city and a
-- real catchment — into every market on earth. The correct predicate and the naive one
-- differ by ONE conjunct and both produce a feed that looks plausible.
--   D-03  a HYBRID event with a city is NOT returned for a different market.
--   D-09  the same, with a pin, and with the geo arm active but out of radius.
-- Those two are the only cases that catch it.
-- Pinned by DRAFT invariant I-2333-ONLINE-ONLY-CARVE-OUT-IS-FORMAT-SCOPED.
-- =====================================================================================

\set ON_ERROR_STOP on

-- ─── D-00: catalogue seal — the carve-out is format-scoped, not bare is_online ───────
-- Read off the LIVE installed definition, not off the migration text, so a hand-edit
-- applied straight to a database is caught too. A seal, not the proof; the proof is
-- D-01 … D-12, which execute the RPC.
DO $$
DECLARE
  d text;
  d_code text;
BEGIN
  d := pg_get_functiondef(
    'public.pg_discover_business_events(text[],timestamptz,timestamptz,text[],text[],text[],integer,integer,double precision,double precision,double precision)'::regprocedure);

  -- Comments are stripped first: the migration deliberately EXPLAINS the is_online
  -- trap in prose right above the arm, and the projection legitimately emits
  -- `is_online` as a column. The scan is over executable code only.
  d_code := regexp_replace(d, '--[^' || chr(10) || ']*', '', 'g');

  IF position('''business_event''->>''format''' in d_code) = 0 THEN
    RAISE EXCEPTION 'D-00 FAIL: pg_discover_business_events has no theme.business_event.format carve-out — the online arm is missing or is not format-scoped';
  END IF;

  -- The trap: the carve-out must pair is_online with the format test. A bare
  -- `e.is_online IS TRUE` arm that is NOT immediately conjoined with the format test
  -- is the naive version.
  IF position('e.is_online IS TRUE' in d_code) = 0 THEN
    RAISE EXCEPTION 'D-00 FAIL: the online arm lost its e.is_online conjunct (a stale theme key alone must never widen the feed)';
  END IF;
  IF position(
       'e.is_online IS TRUE' || chr(10) ||
       '              AND lower(btrim(' || chr(10) ||
       '                COALESCE(e.theme->''business_event''->>''format'', ''''),' || chr(10) ||
       '                E'' \t\n\r\f\v'' || chr(160)' || chr(10) ||
       '              )) = ''online'''
       in d_code) = 0 THEN
    RAISE EXCEPTION 'D-00 FAIL: e.is_online is not conjoined with format = online — is_online is TRUE for HYBRID too (serverDraftEventMapper.ts:708)';
  END IF;

  RAISE NOTICE 'D-00 PASS: the discovery carve-out is format-scoped (is_online AND format = online), not bare is_online';
END $$;

-- ─── D-01 (SC-7 / T-8): an ONLINE-ONLY event surfaces in a market that is not its own
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_online uuid := gen_random_uuid();
  v_result jsonb;
  v_found boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
    VALUES (v_user, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
    VALUES (v_brand, v_user, 'i2333-d01-' || v_brand, 'I2333 D01', 'USD', now(), now());

  -- Exactly the row 20270427002333 now produces: no city, no pin, is_online true,
  -- theme.business_event.format = 'online'.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    published_at, created_at, updated_at)
  VALUES (v_online, v_brand, 'event', 'D01 Online Exhibition', 'i2333-d01-' || v_online, 'd',
    'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
    jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
    now(), now(), now());

  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
    VALUES (gen_random_uuid(), v_online, now() + interval '5 day',
            now() + interval '5 day' + interval '3 hour', 'UTC', true);

  -- Browsing London. The event has no city and no pin, so BOTH pre-existing arms are
  -- false for it. Before the carve-out this returned nothing, in every market.
  v_result := public.pg_discover_business_events(
    ARRAY['London'], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 20, NULL, NULL, NULL);

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_online
  ) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'D-01 FAIL: an online-only event was NOT returned for a market that is not its own — the carve-out is missing';
  END IF;
  RAISE NOTICE 'D-01 PASS: an online-only event surfaces in a market it has no city for';
END $$;
ROLLBACK;

-- ─── D-02 (SC-7 / T-8): the same row surfaces for p_cities => '{}' with NO coords ────
-- The degenerate anchor (_build-response.ts: no city name AND no fallback coords)
-- returned NOTHING at all before this change. It now returns online events only.
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_online uuid := gen_random_uuid();
  v_result jsonb;
  v_found boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
    VALUES (v_user, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
    VALUES (v_brand, v_user, 'i2333-d02-' || v_brand, 'I2333 D02', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    published_at, created_at, updated_at)
  VALUES (v_online, v_brand, 'event', 'D02 Online Workshop', 'i2333-d02-' || v_online, 'd',
    'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
    jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
    now(), now(), now());

  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
    VALUES (gen_random_uuid(), v_online, now() + interval '5 day',
            now() + interval '5 day' + interval '3 hour', 'UTC', true);

  v_result := public.pg_discover_business_events(
    ARRAY[]::text[], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 20, NULL, NULL, NULL);

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_online
  ) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'D-02 FAIL: an online-only event was NOT returned for an empty p_cities with no coords';
  END IF;
  RAISE NOTICE 'D-02 PASS: an online-only event surfaces for an empty p_cities with no coords';
END $$;
ROLLBACK;

-- ─── D-03 (SC-8 / T-9): HYBRID IS NOT BROADCAST — THE REGRESSION GATE ───────────────
-- The row carries is_online = true, which is exactly what the client writes for a
-- hybrid draft (serverDraftEventMapper.ts:708). A carve-out keyed on a bare
-- `e.is_online IS TRUE` returns this Lagos event to a London browser. The correct
-- format-scoped arm does not.
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_hybrid uuid := gen_random_uuid();
  v_online uuid := gen_random_uuid();
  v_result jsonb;
  v_found boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
    VALUES (v_user, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
    VALUES (v_brand, v_user, 'i2333-d03-' || v_brand, 'I2333 D03', 'USD', now(), now());

  -- A HYBRID event: a real venue in a real city, AND is_online = true.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    published_at, created_at, updated_at)
  VALUES (v_hybrid, v_brand, 'event', 'D03 Hybrid Lagos Summit', 'i2333-d03h-' || v_hybrid, 'd',
    'scheduled', 'public', 'USD', 'UTC', 'Lagos', point(3.3792, 6.5244), true,
    jsonb_build_object('business_event', jsonb_build_object('format', 'hybrid')),
    now(), now(), now());

  -- A genuinely online event in the same call, so a total wipe-out of the carve-out
  -- cannot make D-03 pass for the wrong reason.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    published_at, created_at, updated_at)
  VALUES (v_online, v_brand, 'event', 'D03 Online Control', 'i2333-d03o-' || v_online, 'd',
    'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
    jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
    now(), now(), now());

  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  SELECT gen_random_uuid(), e, now() + interval '5 day',
         now() + interval '5 day' + interval '3 hour', 'UTC', true
  FROM (VALUES (v_hybrid), (v_online)) AS t(e);

  v_result := public.pg_discover_business_events(
    ARRAY['London'], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 20, NULL, NULL, NULL);

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_hybrid
  ) INTO v_found;
  IF v_found THEN
    RAISE EXCEPTION 'D-03 FAIL (REGRESSION GATE): a HYBRID event in Lagos was broadcast into a London browse — the carve-out keys on bare is_online, which is TRUE for hybrid (serverDraftEventMapper.ts:708)';
  END IF;

  -- The paired positive: the arm IS live in this same call.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_online
  ) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'D-03 FAIL: the online control row was also absent — D-03 would have passed for the wrong reason';
  END IF;

  RAISE NOTICE 'D-03 PASS (REGRESSION GATE): a hybrid Lagos event is NOT broadcast to London, while an online event in the same call IS';
END $$;
ROLLBACK;

-- ─── D-04 (T-10): coords-anchored browse also returns the online event ──────────────
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_online uuid := gen_random_uuid();
  v_result jsonb;
  v_found boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
    VALUES (v_user, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
    VALUES (v_brand, v_user, 'i2333-d04-' || v_brand, 'I2333 D04', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    published_at, created_at, updated_at)
  VALUES (v_online, v_brand, 'event', 'D04 Online Class', 'i2333-d04-' || v_online, 'd',
    'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
    jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
    now(), now(), now());

  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
    VALUES (gen_random_uuid(), v_online, now() + interval '5 day',
            now() + interval '5 day' + interval '3 hour', 'UTC', true);

  -- Coords anchor: p_cities => '{}' plus a London centre + 50 km radius. The geo arm
  -- is ACTIVE, and the online row has no pin — so only the new arm can admit it.
  v_result := public.pg_discover_business_events(
    ARRAY[]::text[], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 20,
    p_center_lng => -0.1276, p_center_lat => 51.5072, p_radius_km => 50);

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_online
  ) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'D-04 FAIL: an online-only event was NOT returned for a coords-anchored browse';
  END IF;
  RAISE NOTICE 'D-04 PASS: an online-only event surfaces for a coords-anchored browse with no pin of its own';
END $$;
ROLLBACK;

-- ─── D-05 (SC-9 / T-11): the carve-out widened LOCATION and nothing else ────────────
-- One negative case per unrelated gate. Every row below is online-only and would be
-- admitted by the location predicate; each is excluded by a DIFFERENT gate.
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_private  uuid := gen_random_uuid();
  v_draft    uuid := gen_random_uuid();
  v_deleted  uuid := gen_random_uuid();
  v_past     uuid := gen_random_uuid();
  v_facet    uuid := gen_random_uuid();
  v_blocked  uuid := gen_random_uuid();
  v_control  uuid := gen_random_uuid();
  v_result jsonb;
  v_found boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
    VALUES (v_user, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
    VALUES (v_brand, v_user, 'i2333-d05-' || v_brand, 'I2333 D05', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    party_types, deleted_at, published_at, created_at, updated_at)
  VALUES
    (v_private, v_brand, 'event', 'D05 private',  'i2333-d05a-' || v_private, 'd',
     'scheduled', 'private', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     ARRAY['festival'], NULL, now(), now(), now()),
    (v_draft, v_brand, 'event', 'D05 draft',      'i2333-d05b-' || v_draft, 'd',
     'draft', 'public', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     ARRAY['festival'], NULL, NULL, now(), now()),
    (v_deleted, v_brand, 'event', 'D05 deleted',  'i2333-d05c-' || v_deleted, 'd',
     'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     ARRAY['festival'], now(), now(), now(), now()),
    (v_past, v_brand, 'event', 'D05 past',        'i2333-d05d-' || v_past, 'd',
     'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     ARRAY['festival'], NULL, now(), now(), now()),
    (v_facet, v_brand, 'event', 'D05 facet',      'i2333-d05e-' || v_facet, 'd',
     'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     ARRAY['club-night'], NULL, now(), now(), now()),
    (v_blocked, v_brand, 'event', 'D05 blocked',  'i2333-d05f-' || v_blocked, 'd',
     'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     ARRAY['festival'], NULL, now(), now(), now()),
    (v_control, v_brand, 'event', 'D05 control',  'i2333-d05g-' || v_control, 'd',
     'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     ARRAY['festival'], NULL, now(), now(), now());

  -- Future master dates for everything except the deliberately past one.
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  SELECT gen_random_uuid(), e, now() + interval '5 day',
         now() + interval '5 day' + interval '3 hour', 'UTC', true
  FROM (VALUES (v_private), (v_draft), (v_deleted), (v_facet), (v_blocked), (v_control)) AS t(e);
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
    VALUES (gen_random_uuid(), v_past, now() - interval '10 day',
            now() - interval '10 day' + interval '3 hour', 'UTC', true);

  -- The #1931 ordinary-read block: an active transition job with the block installed.
  INSERT INTO public.event_private_media_transition_jobs
    (transition_id, event_id, direction, target_visibility, state,
     ordinary_read_blocked_at, expected_event_updated_at, source_fingerprint,
     created_at, updated_at)
  VALUES (gen_random_uuid(), v_blocked, 'enter_private', 'private', 'preparing',
          now(), now(), repeat('a', 64), now(), now());

  v_result := public.pg_discover_business_events(
    ARRAY['London'], now() - interval '1 day', now() + interval '30 day',
    ARRAY['festival'], NULL, NULL, 0, 50, NULL, NULL, NULL);

  -- The control proves the carve-out IS live for this exact shape, so every negative
  -- below is attributable to its own gate rather than to a dead arm.
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_control) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'D-05 FAIL: the online control row was absent — every negative below would pass for the wrong reason';
  END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_private) INTO v_found;
  IF v_found THEN RAISE EXCEPTION 'D-05 FAIL: a PRIVATE online event surfaced — the carve-out widened visibility'; END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_draft) INTO v_found;
  IF v_found THEN RAISE EXCEPTION 'D-05 FAIL: a DRAFT online event surfaced — the carve-out widened status'; END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_deleted) INTO v_found;
  IF v_found THEN RAISE EXCEPTION 'D-05 FAIL: a DELETED online event surfaced — the carve-out widened deleted_at'; END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_past) INTO v_found;
  IF v_found THEN RAISE EXCEPTION 'D-05 FAIL: a PAST online event surfaced — the carve-out widened the date window'; END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_facet) INTO v_found;
  IF v_found THEN RAISE EXCEPTION 'D-05 FAIL: a FACET-MISMATCHED online event surfaced — the carve-out widened the party-type filter'; END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_blocked) INTO v_found;
  IF v_found THEN RAISE EXCEPTION 'D-05 FAIL: an ORDINARY-READ-BLOCKED online event surfaced — the carve-out bypassed issue_1931_event_ordinary_read_blocked'; END IF;

  RAISE NOTICE 'D-05 PASS: the carve-out widened LOCATION only — private, draft, deleted, past, facet-mismatched and read-blocked online events all stay out';
END $$;
ROLLBACK;

-- ─── D-06 (SC-10 / T-12): total and OFFSET/LIMIT stay consistent ────────────────────
-- 3 online rows + 3 London-city rows, all matching the same facet. total must be 6 for
-- a London browse, pages must not overlap, and the union of two pages of 2 must be 4
-- distinct ids.
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_page1 jsonb;
  v_page2 jsonb;
  v_total integer;
  v_distinct integer;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
    VALUES (v_user, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
    VALUES (v_brand, v_user, 'i2333-d06-' || v_brand, 'I2333 D06', 'USD', now(), now());

  -- 3 online-only rows.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    party_types, published_at, created_at, updated_at)
  SELECT gen_random_uuid(), v_brand, 'event', 'D06 online ' || i, 'i2333-d06o-' || i || '-' || v_brand, 'd',
         'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
         jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
         ARRAY['festival'], now(), now(), now()
  FROM generate_series(1, 3) i;

  -- 3 London rows.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    party_types, published_at, created_at, updated_at)
  SELECT gen_random_uuid(), v_brand, 'event', 'D06 london ' || i, 'i2333-d06l-' || i || '-' || v_brand, 'd',
         'scheduled', 'public', 'USD', 'UTC', 'London', NULL, false,
         jsonb_build_object('business_event', jsonb_build_object('format', 'in_person')),
         ARRAY['festival'], now(), now(), now()
  FROM generate_series(1, 3) i;

  -- Distinct start times so the ORDER BY is total and paging is deterministic.
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  SELECT gen_random_uuid(), e.id,
         now() + (row_number() OVER (ORDER BY e.slug)) * interval '1 day',
         now() + (row_number() OVER (ORDER BY e.slug)) * interval '1 day' + interval '3 hour',
         'UTC', true
  FROM public.events e WHERE e.brand_id = v_brand;

  v_page1 := public.pg_discover_business_events(
    ARRAY['London'], now() - interval '1 day', now() + interval '30 day',
    ARRAY['festival'], NULL, NULL, 0, 2, NULL, NULL, NULL);
  v_page2 := public.pg_discover_business_events(
    ARRAY['London'], now() - interval '1 day', now() + interval '30 day',
    ARRAY['festival'], NULL, NULL, 2, 2, NULL, NULL, NULL);

  v_total := (v_page1->>'total')::integer;
  IF v_total <> 6 THEN
    RAISE EXCEPTION 'D-06 FAIL: total is % for 3 online + 3 London rows (expected 6) — the carve-out skewed COUNT(*) OVER ()', v_total;
  END IF;
  IF (v_page2->>'total')::integer <> 6 THEN
    RAISE EXCEPTION 'D-06 FAIL: total is % on page 2 (expected 6)', (v_page2->>'total')::integer;
  END IF;
  IF jsonb_array_length(v_page1->'rows') <> 2 OR jsonb_array_length(v_page2->'rows') <> 2 THEN
    RAISE EXCEPTION 'D-06 FAIL: p_limit=2 returned %/% rows (expected 2/2)',
      jsonb_array_length(v_page1->'rows'), jsonb_array_length(v_page2->'rows');
  END IF;

  SELECT count(DISTINCT elem->>'id') INTO v_distinct
    FROM (SELECT jsonb_array_elements(v_page1->'rows') AS elem
          UNION ALL
          SELECT jsonb_array_elements(v_page2->'rows') AS elem) u;
  IF v_distinct <> 4 THEN
    RAISE EXCEPTION 'D-06 FAIL: pages 1 and 2 share rows (% distinct ids across 4 slots)', v_distinct;
  END IF;

  RAISE NOTICE 'D-06 PASS: total = 6 across the widened row set, pages of 2 do not overlap';
END $$;
ROLLBACK;

-- ─── D-07: the ordinary city path is untouched (control) ────────────────────────────
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_london uuid := gen_random_uuid();
  v_lagos  uuid := gen_random_uuid();
  v_result jsonb;
  v_found boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
    VALUES (v_user, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
    VALUES (v_brand, v_user, 'i2333-d07-' || v_brand, 'I2333 D07', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    published_at, created_at, updated_at)
  VALUES
    (v_london, v_brand, 'event', 'D07 London', 'i2333-d07a-' || v_london, 'd',
     'scheduled', 'public', 'USD', 'UTC', 'London', NULL, false,
     jsonb_build_object('business_event', jsonb_build_object('format', 'in_person')),
     now(), now(), now()),
    (v_lagos, v_brand, 'event', 'D07 Lagos', 'i2333-d07b-' || v_lagos, 'd',
     'scheduled', 'public', 'USD', 'UTC', 'Lagos', NULL, false,
     jsonb_build_object('business_event', jsonb_build_object('format', 'in_person')),
     now(), now(), now());

  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  SELECT gen_random_uuid(), e, now() + interval '5 day',
         now() + interval '5 day' + interval '3 hour', 'UTC', true
  FROM (VALUES (v_london), (v_lagos)) AS t(e);

  v_result := public.pg_discover_business_events(
    ARRAY['London'], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 20, NULL, NULL, NULL);

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_london) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'D-07 FAIL: a plain London in-person event stopped being returned for a London browse';
  END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_lagos) INTO v_found;
  IF v_found THEN
    RAISE EXCEPTION 'D-07 FAIL: a plain Lagos in-person event leaked into a London browse';
  END IF;

  RAISE NOTICE 'D-07 PASS: the ordinary city path is unchanged — London in, Lagos out';
END $$;
ROLLBACK;

-- ─── D-08: BOTH conjuncts are load-bearing ─────────────────────────────────────────
-- The arm is `e.is_online IS TRUE AND format = 'online'`. Neither half alone may admit
-- a row: a stale/hand-edited theme key must not widen the feed, and is_online alone is
-- the hybrid trap.
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_flag_only  uuid := gen_random_uuid();  -- is_online true, theme format ABSENT
  v_theme_only uuid := gen_random_uuid();  -- theme format 'online', is_online FALSE
  v_both       uuid := gen_random_uuid();  -- control: both
  v_result jsonb;
  v_found boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
    VALUES (v_user, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
    VALUES (v_brand, v_user, 'i2333-d08-' || v_brand, 'I2333 D08', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    published_at, created_at, updated_at)
  VALUES
    (v_flag_only, v_brand, 'event', 'D08 flag only', 'i2333-d08a-' || v_flag_only, 'd',
     'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('title', 'no format key')),
     now(), now(), now()),
    (v_theme_only, v_brand, 'event', 'D08 theme only', 'i2333-d08b-' || v_theme_only, 'd',
     'scheduled', 'public', 'USD', 'UTC', NULL, NULL, false,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     now(), now(), now()),
    (v_both, v_brand, 'event', 'D08 both', 'i2333-d08c-' || v_both, 'd',
     'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     now(), now(), now());

  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  SELECT gen_random_uuid(), e, now() + interval '5 day',
         now() + interval '5 day' + interval '3 hour', 'UTC', true
  FROM (VALUES (v_flag_only), (v_theme_only), (v_both)) AS t(e);

  v_result := public.pg_discover_business_events(
    ARRAY['London'], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 20, NULL, NULL, NULL);

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_both) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'D-08 FAIL: the both-conjuncts control row was absent — the carve-out is dead';
  END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_flag_only) INTO v_found;
  IF v_found THEN
    RAISE EXCEPTION 'D-08 FAIL: is_online alone admitted a row with no theme format — that is the bare-is_online (hybrid-broadcast) predicate';
  END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_theme_only) INTO v_found;
  IF v_found THEN
    RAISE EXCEPTION 'D-08 FAIL: a theme format key alone admitted a row with is_online false — a stale theme key must never widen the feed';
  END IF;

  RAISE NOTICE 'D-08 PASS: both conjuncts are load-bearing — neither is_online alone nor the theme key alone admits a row';
END $$;
ROLLBACK;

-- ─── D-09 (SC-8 / T-9 second angle): hybrid stays out with the GEO ARM ACTIVE ───────
-- D-03 ran with no coords, so only the city arm and the new arm were live. Here the
-- geo arm is live too, with the hybrid event's real pin OUTSIDE the radius. A bare
-- is_online carve-out still leaks it in; the format-scoped one does not.
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_hybrid uuid := gen_random_uuid();
  v_online uuid := gen_random_uuid();
  v_result jsonb;
  v_found boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
    VALUES (v_user, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
    VALUES (v_brand, v_user, 'i2333-d09-' || v_brand, 'I2333 D09', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo, is_online, theme,
    published_at, created_at, updated_at)
  VALUES
    (v_hybrid, v_brand, 'event', 'D09 Hybrid Lagos', 'i2333-d09h-' || v_hybrid, 'd',
     'scheduled', 'public', 'USD', 'UTC', 'Lagos', point(3.3792, 6.5244), true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'hybrid')),
     now(), now(), now()),
    (v_online, v_brand, 'event', 'D09 Online Control', 'i2333-d09o-' || v_online, 'd',
     'scheduled', 'public', 'USD', 'UTC', NULL, NULL, true,
     jsonb_build_object('business_event', jsonb_build_object('format', 'online')),
     now(), now(), now());

  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  SELECT gen_random_uuid(), e, now() + interval '5 day',
         now() + interval '5 day' + interval '3 hour', 'UTC', true
  FROM (VALUES (v_hybrid), (v_online)) AS t(e);

  -- London centre, 50 km. Lagos is ~5,000 km away, so the geo arm is decisively false.
  v_result := public.pg_discover_business_events(
    ARRAY['London'], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 20,
    p_center_lng => -0.1276, p_center_lat => 51.5072, p_radius_km => 50);

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_hybrid) INTO v_found;
  IF v_found THEN
    RAISE EXCEPTION 'D-09 FAIL (REGRESSION GATE): a HYBRID Lagos event with a real pin 5000km away surfaced in a 50km London browse — bare-is_online carve-out';
  END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
                  WHERE (elem->>'id')::uuid = v_online) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'D-09 FAIL: the online control row was also absent — D-09 would have passed for the wrong reason';
  END IF;

  RAISE NOTICE 'D-09 PASS (REGRESSION GATE): with the geo arm active, a hybrid Lagos event stays out of a London browse while an online event comes in';
END $$;
ROLLBACK;

DO $$ BEGIN
  RAISE NOTICE 'issue #2333 S3 implementor probe: D-00 … D-09 all PASS';
END $$;
