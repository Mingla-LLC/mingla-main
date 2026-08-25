-- Why this exists: `business_public_events_view` shipped with no address-privacy gate
-- while the sibling RPC had one, and the buyer-web renderer carried a comment asserting a
-- server-side guarantee that this path never implemented. Client-side checks cannot close
-- this — the value was already on the wire. Every assertion here reads as `anon`
-- deliberately: that is the only reader whose experience proves the gate. Do not
-- "simplify" these reads to run as the owner.
--
-- #2489 implementor behavioral fixture. PostgreSQL 17 replay target.
--
-- Executes against a database that has replayed EVERY migration including
-- 20270523002489_issue_2489_address_privacy_server_gate.sql. Every row is created inside
-- one transaction and ROLLBACKed; nothing here writes durable state.
--
-- BEHAVIORAL, not textual. No assertion is satisfied by source text: each one performs a
-- real read or a real call as the `anon` role against the applied schema and compares
-- what that role actually received.
--
-- ANTI-VACUITY. SC-7, SC-12 and SC-15 are the reveal-case twins of SC-1/2/3, SC-11 and
-- SC-13. Without them, an implementation that unconditionally NULLed the column would
-- pass every other assertion in this file while destroying the product. This repository
-- has a catalogued history of tests that cannot fail; these three exist so this one can.
\set ON_ERROR_STOP on

BEGIN;

-- =====================================================================================
-- EXECUTED-ASSERTION LEDGER.
--
-- A privacy suite can be silenced without deleting anything: two lines at the top of a
-- block — a constant and an early return — leave every assertion sitting in the file,
-- reviewable and unreachable, and an append-only gate sees no removal. On a suite that
-- certifies a hole is closed that is worse than missing coverage, because the green tick
-- now actively vouches for the hole.
--
-- So each block records itself HERE, on its last line, after its assertions have run. A
-- block that returns early never records. The final check compares the recorded set
-- against the declared set — equality, both directions — so a scenario that stopped
-- executing is a failure rather than a silence.
-- =====================================================================================
CREATE TEMP TABLE i2489_executed (scenario text PRIMARY KEY) ON COMMIT DROP;

-- =====================================================================================
-- SEED — six offerings that differ ONLY in the theme flag and in what location data they
-- carry, so every assertion below is attributable to the gate and to nothing else.
--
--   gated_full   flag TRUE            pin + location_text + theme address + city_geo
--   revealed     flag FALSE           pin + location_text + theme address   <- SC-7 twin
--   absent_key   flag key ABSENT      pin + location_text + theme address   <- fail-closed
--   empty_theme  theme = '{}'         pin + location_text                    <- fail-closed
--   bad_type     flag = "yes" (text)  pin + location_text + theme address   <- total cast
--   draft_blob   flag TRUE            + a business_draft blob               <- SC-14
--
-- All are published, public and scheduled so they are visible to `anon` through every
-- object under test. Each carries its own stored venueName, which is what SC-4 pins.
-- =====================================================================================
CREATE TEMP TABLE i2489_ids (label text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;

DO $seed$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_slug   text := 'i2489-brand-' || replace(gen_random_uuid()::text, '-', '');
  v_label  text;
  v_id     uuid;
  v_theme  jsonb;
  v_geo    point := point(-0.1276, 51.5072);
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i2489 brand', v_slug, 'GBP');
  INSERT INTO i2489_ids(label, id) VALUES ('brand', v_brand);
  INSERT INTO i2489_ids(label, id) VALUES ('brand_slug_marker', v_user);

  FOR v_label, v_theme IN
    SELECT * FROM (VALUES
      ('gated_full', jsonb_build_object('business_event', jsonb_build_object(
          'hideAddressUntilTicket', true,
          'location', jsonb_build_object('venueName','i2489 Venue','address','221B Baker Street')))),
      ('revealed',   jsonb_build_object('business_event', jsonb_build_object(
          'hideAddressUntilTicket', false,
          'location', jsonb_build_object('venueName','i2489 Venue','address','221B Baker Street')))),
      ('absent_key', jsonb_build_object('business_event', jsonb_build_object(
          'location', jsonb_build_object('venueName','i2489 Venue','address','221B Baker Street')))),
      ('empty_theme', '{}'::jsonb),
      ('bad_type',   jsonb_build_object('business_event', jsonb_build_object(
          'hideAddressUntilTicket', 'yes',
          'location', jsonb_build_object('venueName','i2489 Venue','address','221B Baker Street')))),
      ('draft_blob', jsonb_build_object(
          'business_draft', jsonb_build_object('unpublishedNote','host private draft'),
          'business_event', jsonb_build_object(
          'hideAddressUntilTicket', true,
          'location', jsonb_build_object('venueName','i2489 Venue','address','221B Baker Street'))))
    ) AS t(label, theme)
  LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.events (
      id, brand_id, title, slug, event_type, status, visibility, timezone,
      currency, published_at, city, show_on_discover, rsvp_discoverable,
      location_text, location_geo, theme
    ) VALUES (
      v_id, v_brand, 'i2489 ' || v_label, 'i2489-' || v_label || '-' || replace(v_id::text,'-',''),
      'event', 'scheduled', 'public', 'UTC',
      'GBP', now(), 'i2489 City', true, false,
      'i2489 Venue · 221B Baker Street', v_geo, v_theme
    );
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (v_id, now() + interval '30 days', now() + interval '30 days 4 hours', 'UTC', true);
    INSERT INTO i2489_ids(label, id) VALUES (v_label, v_id);
  END LOOP;

  -- SC-6 needs a row whose privacy-safe centroid is actually populated. Production has
  -- none today (the column has readers and no writer), which is exactly why the exemption
  -- has to be pinned here rather than observed in the wild.
  UPDATE public.events
     SET city_geo = public.ST_SetSRID(public.ST_MakePoint(-0.1, 51.5), 4326)
   WHERE id = (SELECT id FROM i2489_ids WHERE label = 'gated_full');

  RAISE NOTICE 'SEED OK — 6 offerings under one brand';
END $seed$;

-- =====================================================================================
-- SC-1 / SC-2 / SC-3 / SC-4 / SC-5 / SC-6 — the primary view, read as `anon`.
--
-- SC-1 pin withheld · SC-2 combined address string withheld · SC-3 structured street
-- address inside the theme withheld · SC-4 venueName SURVIVES (the venue card must still
-- render) · SC-5 the flag itself SURVIVES (clients must still know the state) ·
-- SC-6 the privacy-safe city centroid is EXEMPT and still returned.
-- =====================================================================================
DO $t$
DECLARE
  v_id    uuid := (SELECT id FROM i2489_ids WHERE label = 'gated_full');
  v_row   record;
BEGIN
  SET LOCAL ROLE anon;
  SELECT location_geo, location_text, public_theme, city_geo
    INTO v_row
    FROM public.business_public_events_view
   WHERE id = v_id;
  RESET ROLE;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'SC-1..6 fixture invalid: anon could not see the seeded row at all, so a NULL would prove nothing';
  END IF;

  IF v_row.location_geo IS NOT NULL THEN
    RAISE EXCEPTION 'SC-1: business_public_events_view leaked column location_geo (the exact venue pin) to anon for a gated offering';
  END IF;

  IF NULLIF(v_row.location_text, '') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-2: business_public_events_view leaked column location_text (the combined address string) to anon for a gated offering';
  END IF;

  IF NULLIF(v_row.public_theme #>> '{business_event,location,address}', '') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-3: business_public_events_view leaked the structured street address inside public_theme to anon for a gated offering';
  END IF;

  IF v_row.public_theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'i2489 Venue' THEN
    RAISE EXCEPTION 'SC-4: venueName did not survive the strip — the venue card would disappear, which is a product regression, not a privacy fix';
  END IF;

  IF (v_row.public_theme #>> '{business_event,hideAddressUntilTicket}') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'SC-5: hideAddressUntilTicket did not survive the strip — clients can no longer tell the state';
  END IF;

  IF v_row.city_geo IS NULL THEN
    RAISE EXCEPTION 'SC-6: city_geo was withheld. The city-level centroid is the privacy-SAFE value and is exempt by design';
  END IF;

  RAISE NOTICE 'SC-1..6 PASS — pin, address string and structured street withheld; venueName, flag and city centroid preserved';

  INSERT INTO i2489_executed(scenario) SELECT unnest(ARRAY['SC-1','SC-2','SC-3','SC-4','SC-5','SC-6']);
END $t$;

-- =====================================================================================
-- SC-7 — ANTI-VACUITY TWIN. Flag FALSE: all three values are RETURNED.
--
-- Without this, an implementation that NULLed the three columns unconditionally would
-- pass SC-1..6, SC-8, SC-9 and SC-10 — and would have destroyed the address for every
-- host who deliberately opted OUT of hiding it.
-- =====================================================================================
DO $t$
DECLARE
  v_id  uuid := (SELECT id FROM i2489_ids WHERE label = 'revealed');
  v_row record;
BEGIN
  SET LOCAL ROLE anon;
  SELECT location_geo, location_text, public_theme
    INTO v_row
    FROM public.business_public_events_view
   WHERE id = v_id;
  RESET ROLE;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'SC-7 fixture invalid: anon could not see the opted-out row';
  END IF;

  IF v_row.location_geo IS NULL THEN
    RAISE EXCEPTION 'SC-7: the gate withheld location_geo from an offering whose host explicitly opted OUT of hiding it — the implementation is nulling unconditionally';
  END IF;

  IF NULLIF(v_row.location_text, '') IS NULL THEN
    RAISE EXCEPTION 'SC-7: the gate withheld location_text from an opted-out offering — the implementation is nulling unconditionally';
  END IF;

  IF NULLIF(v_row.public_theme #>> '{business_event,location,address}', '') IS NULL THEN
    RAISE EXCEPTION 'SC-7: the gate stripped the theme street address from an opted-out offering — the implementation is stripping unconditionally';
  END IF;

  RAISE NOTICE 'SC-7 PASS — an opted-out offering still publishes its pin, address string and street';

  INSERT INTO i2489_executed(scenario) SELECT unnest(ARRAY['SC-7']);
END $t$;

-- =====================================================================================
-- SC-8 — the key is ABSENT from the theme. FAIL CLOSED.
--
-- A legacy row written before the flag existed must never leak. This is the single most
-- likely real-world shape and the one a `= true` predicate gets wrong.
-- =====================================================================================
DO $t$
DECLARE
  v_id  uuid := (SELECT id FROM i2489_ids WHERE label = 'absent_key');
  v_row record;
BEGIN
  SET LOCAL ROLE anon;
  SELECT location_geo, location_text, public_theme
    INTO v_row
    FROM public.business_public_events_view
   WHERE id = v_id;
  RESET ROLE;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'SC-8 fixture invalid: anon could not see the absent-key row';
  END IF;

  IF v_row.location_geo IS NOT NULL
     OR NULLIF(v_row.location_text, '') IS NOT NULL
     OR NULLIF(v_row.public_theme #>> '{business_event,location,address}', '') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-8: the predicate FAILED OPEN on an absent hideAddressUntilTicket key — a legacy offering leaked its location';
  END IF;

  RAISE NOTICE 'SC-8 PASS — an absent flag key withholds';

  INSERT INTO i2489_executed(scenario) SELECT unnest(ARRAY['SC-8']);
END $t$;

-- =====================================================================================
-- SC-9 — a theme with no business_event branch at all, and a theme whose flag is present
-- as a NON-BOOLEAN string. Both must withhold, and CRITICALLY the read must NOT RAISE.
--
-- `events.theme` is NOT NULL at the table level, so the SPEC's "theme IS NULL" case
-- cannot be seeded as a row. It is still asserted — directly against the predicate, as
-- anon — because the predicate is called from four objects and nothing guarantees a
-- future caller passes it a non-NULL jsonb. A bare
-- `(theme #>> path)::boolean` raises invalid_text_representation on a string value, which
-- would turn this privacy gate into a 500 on every public offering read. No production
-- row carries a non-boolean there today, so this assertion is hardening — but nothing in
-- the schema prevents a future writer from putting one there, and a privacy gate must not
-- be one bad write away from a site-wide outage.
-- =====================================================================================
DO $t$
DECLARE
  v_row     record;
  v_label   text;
  v_id      uuid;
  v_state   text;
BEGIN
  -- Predicate leg: a NULL theme must withhold and must not raise.
  BEGIN
    SET LOCAL ROLE anon;
    IF public.issue_2489_address_withheld(NULL::jsonb) IS NOT TRUE THEN
      RESET ROLE;
      RAISE EXCEPTION 'SC-9: the predicate did not withhold for a NULL theme — it FAILED OPEN';
    END IF;
    RESET ROLE;
  EXCEPTION WHEN invalid_text_representation THEN
    RESET ROLE;
    RAISE EXCEPTION 'SC-9: the predicate RAISED on a NULL theme — it is not total';
  END;

  FOREACH v_label IN ARRAY ARRAY['empty_theme', 'bad_type'] LOOP
    v_id := (SELECT id FROM i2489_ids WHERE label = v_label);
    BEGIN
      SET LOCAL ROLE anon;
      SELECT location_geo, location_text, public_theme
        INTO v_row
        FROM public.business_public_events_view
       WHERE id = v_id;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      v_state := SQLSTATE;
      RESET ROLE;
      RAISE EXCEPTION
        'SC-9: reading the view as anon RAISED (sqlstate %) for the % row. The privacy predicate is not total — one malformed theme write would 500 every public offering read',
        v_state, v_label;
    END;

    IF v_row IS NULL THEN
      RAISE EXCEPTION 'SC-9 fixture invalid: anon could not see the % row', v_label;
    END IF;

    IF v_row.location_geo IS NOT NULL
       OR NULLIF(v_row.location_text, '') IS NOT NULL
       OR NULLIF(v_row.public_theme #>> '{business_event,location,address}', '') IS NOT NULL THEN
      RAISE EXCEPTION 'SC-9: the predicate FAILED OPEN on the % row — a malformed or missing theme revealed the location', v_label;
    END IF;
  END LOOP;

  RAISE NOTICE 'SC-9 PASS — a NULL theme, a themeless offering and a non-boolean flag all withhold, and none raises';

  INSERT INTO i2489_executed(scenario) SELECT unnest(ARRAY['SC-9']);
END $t$;

-- =====================================================================================
-- SC-10 — events_public_view, the OTHER anon-readable view, same class.
--
-- It is security_invoker, so `anon` evaluates the predicate itself here. It additionally
-- projected the RAW theme, so the unpublished business_draft blob is checked too.
-- =====================================================================================
DO $t$
DECLARE
  v_gated    uuid := (SELECT id FROM i2489_ids WHERE label = 'gated_full');
  v_draft    uuid := (SELECT id FROM i2489_ids WHERE label = 'draft_blob');
  v_row      record;
  v_refused  boolean := false;
BEGIN
  -- This view runs with the CALLER's rights, so it depends on the base-record grant.
  -- Once that grant moves — a separate, later deploy — this read stops being answered
  -- for this role at all. Refusing outright is a STRONGER form of withholding than
  -- returning nulls, so both outcomes satisfy the rule and neither needs a test edit
  -- when the second deploy lands. What is never acceptable is a value coming back.
  BEGIN
    SET LOCAL ROLE anon;
    SELECT location_geo, location_text, theme INTO v_row
      FROM public.events_public_view WHERE id = v_gated;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_refused := true;
  END;

  IF v_refused THEN
    RAISE NOTICE 'SC-10 PASS — the caller-rights view no longer answers this role at all, which withholds more than nulling would';
    INSERT INTO i2489_executed(scenario) VALUES ('SC-10');
    RETURN;
  END IF;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'SC-10 fixture invalid: anon could not see the gated row through events_public_view';
  END IF;

  IF v_row.location_geo IS NOT NULL THEN
    RAISE EXCEPTION 'SC-10: events_public_view leaked column location_geo to anon for a gated offering';
  END IF;
  IF NULLIF(v_row.location_text, '') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-10: events_public_view leaked column location_text to anon for a gated offering';
  END IF;
  IF NULLIF(v_row.theme #>> '{business_event,location,address}', '') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-10: events_public_view leaked the structured street address inside theme to anon for a gated offering';
  END IF;

  SET LOCAL ROLE anon;
  SELECT theme INTO v_row FROM public.events_public_view WHERE id = v_draft;
  RESET ROLE;

  IF v_row.theme ? 'business_draft' THEN
    RAISE EXCEPTION 'SC-10: events_public_view handed anon the host''s unpublished business_draft blob';
  END IF;

  RAISE NOTICE 'SC-10 PASS — the second anon-readable view withholds the same three values and strips the draft blob';

  INSERT INTO i2489_executed(scenario) SELECT unnest(ARRAY['SC-10']);
END $t$;

-- =====================================================================================
-- SC-11 / SC-12 — pg_discover_business_events, the anon-EXECUTABLE LIST endpoint.
--
-- No slug required: this one returns rows in bulk, which is why an ungated projection
-- here is a different order of exposure from a single-offering read.
--
-- SC-12 is the anti-vacuity twin: the opted-out offering in the SAME response must still
-- carry its pin. A single call returns both, so an unconditional null cannot pass.
-- =====================================================================================
DO $t$
DECLARE
  v_gated    uuid := (SELECT id FROM i2489_ids WHERE label = 'gated_full');
  v_revealed uuid := (SELECT id FROM i2489_ids WHERE label = 'revealed');
  v_payload  jsonb;
  v_gr       jsonb;
  v_rr       jsonb;
BEGIN
  SET LOCAL ROLE anon;
  v_payload := public.pg_discover_business_events(
    ARRAY['i2489 City']::text[],
    now() - interval '1 day',
    NULL, NULL, NULL, NULL, 0, 50, NULL, NULL, NULL);
  RESET ROLE;

  SELECT r INTO v_gr FROM jsonb_array_elements(v_payload->'rows') r WHERE (r->>'id')::uuid = v_gated;
  SELECT r INTO v_rr FROM jsonb_array_elements(v_payload->'rows') r WHERE (r->>'id')::uuid = v_revealed;

  IF v_gr IS NULL OR v_rr IS NULL THEN
    RAISE EXCEPTION 'SC-11/12 fixture invalid: the discover feed did not return both the gated and the opted-out offering (gated=%, revealed=%), so neither assertion would mean anything',
      (v_gr IS NOT NULL), (v_rr IS NOT NULL);
  END IF;

  -- SC-11 — the gated row is stripped.
  IF NULLIF(v_gr->>'location_geo', '') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-11: pg_discover_business_events leaked key location_geo to anon for a gated offering';
  END IF;
  IF NULLIF(v_gr->>'location_text', '') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-11: pg_discover_business_events leaked key location_text to anon for a gated offering';
  END IF;
  IF NULLIF(v_gr #>> '{theme,business_event,location,address}', '') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-11: pg_discover_business_events leaked the structured street address inside theme to anon for a gated offering';
  END IF;

  -- SC-12 — ANTI-VACUITY TWIN, from the SAME response.
  IF NULLIF(v_rr->>'location_geo', '') IS NULL THEN
    RAISE EXCEPTION 'SC-12: the discover feed withheld location_geo from an offering whose host opted OUT — the gate is nulling unconditionally';
  END IF;
  IF NULLIF(v_rr->>'location_text', '') IS NULL THEN
    RAISE EXCEPTION 'SC-12: the discover feed withheld location_text from an opted-out offering — the gate is nulling unconditionally';
  END IF;
  IF NULLIF(v_rr #>> '{theme,business_event,location,address}', '') IS NULL THEN
    RAISE EXCEPTION 'SC-12: the discover feed stripped the theme street address from an opted-out offering — the gate is stripping unconditionally';
  END IF;

  RAISE NOTICE 'SC-11/12 PASS — the anon list endpoint withholds for the gated offering and still publishes for the opted-out one, in the same response';

  INSERT INTO i2489_executed(scenario) SELECT unnest(ARRAY['SC-11','SC-12']);
END $t$;

-- =====================================================================================
-- SC-13 / SC-14 / SC-15 — pg_public_brand_upcoming, the anon-EXECUTABLE brand feed.
--
-- Its return signature carries no location column, so the theme is its only vector — and
-- it projected `e.theme` raw, stripping neither the street address nor the host's
-- unpublished business_draft blob.
--
-- SC-14 binds EVERY row, gated or not: an anon caller has no claim on unpublished host
-- content regardless of the address question.
-- SC-15 is the anti-vacuity twin of SC-13.
-- =====================================================================================
DO $t$
DECLARE
  v_slug     text := (SELECT b.slug FROM public.brands b
                       WHERE b.id = (SELECT id FROM i2489_ids WHERE label = 'brand'));
  v_gated    uuid := (SELECT id FROM i2489_ids WHERE label = 'gated_full');
  v_revealed uuid := (SELECT id FROM i2489_ids WHERE label = 'revealed');
  v_draft    uuid := (SELECT id FROM i2489_ids WHERE label = 'draft_blob');
  v_all      jsonb;
  v_g        jsonb;
  v_r        jsonb;
  v_d        jsonb;
  v_n        int;
BEGIN
  -- The whole response is captured in ONE call made as anon, so every assertion below
  -- describes the same payload an unauthenticated brand-page request receives.
  SET LOCAL ROLE anon;
  SELECT jsonb_agg(jsonb_build_object('offering_id', u.offering_id, 'theme', u.theme))
    INTO v_all
    FROM public.pg_public_brand_upcoming(v_slug, now(), 100) u;
  RESET ROLE;

  v_n := COALESCE(jsonb_array_length(v_all), 0);
  SELECT e->'theme' INTO v_g FROM jsonb_array_elements(COALESCE(v_all,'[]'::jsonb)) e
   WHERE (e->>'offering_id')::uuid = v_gated;
  SELECT e->'theme' INTO v_r FROM jsonb_array_elements(COALESCE(v_all,'[]'::jsonb)) e
   WHERE (e->>'offering_id')::uuid = v_revealed;
  SELECT e->'theme' INTO v_d FROM jsonb_array_elements(COALESCE(v_all,'[]'::jsonb)) e
   WHERE (e->>'offering_id')::uuid = v_draft;

  IF v_g IS NULL OR v_r IS NULL OR v_d IS NULL THEN
    RAISE EXCEPTION 'SC-13/14/15 fixture invalid: the brand feed returned % rows and did not include all three subjects, so the assertions would be vacuous', v_n;
  END IF;

  -- SC-13 — the gated offering's street address is gone.
  IF NULLIF(v_g #>> '{business_event,location,address}', '') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-13: pg_public_brand_upcoming leaked the structured street address inside theme to anon for a gated offering';
  END IF;

  -- SC-14 — no row, gated or not, carries the host's unpublished draft.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_all,'[]'::jsonb)) e
     WHERE (e->'theme') ? 'business_draft'
  ) THEN
    RAISE EXCEPTION 'SC-14: pg_public_brand_upcoming handed anon the host''s unpublished business_draft blob';
  END IF;

  -- SC-15 — ANTI-VACUITY TWIN, from the SAME response.
  IF NULLIF(v_r #>> '{business_event,location,address}', '') IS NULL THEN
    RAISE EXCEPTION 'SC-15: the brand feed stripped the street address from an offering whose host opted OUT — the gate is stripping unconditionally';
  END IF;
  IF v_r #>> '{business_event,location,venueName}' IS DISTINCT FROM 'i2489 Venue' THEN
    RAISE EXCEPTION 'SC-15: the brand feed lost venueName on the opted-out offering — the strip is too wide';
  END IF;

  RAISE NOTICE 'SC-13/14/15 PASS — the anon brand feed withholds the street for a gated offering, never ships the draft blob, and still publishes the street for an opted-out one';

  INSERT INTO i2489_executed(scenario) SELECT unnest(ARRAY['SC-13','SC-14','SC-15']);
END $t$;


-- =====================================================================================
-- SEED 2 — the shapes the first pass did not have to answer for.
--
--   no_venue_name  gated, and its theme carries NO venue name of its own. This is the
--                  row that proves the venue-NAME field is not a second door to the
--                  street: the stored combined string is "venue, then street", and a
--                  fallback to it hands over the street through a field the address
--                  gate never looked at. Zero production offerings are in this state
--                  today, which is exactly why it has to be constructed here.
--   array_theme    theme is a JSON ARRAY. Every jsonb delete in the withhold branch is
--                  undefined on it. Nothing in the schema forbids it and hosts hold
--                  UPDATE, so "no row looks like this today" is not a defence.
--   rsvp_gated     an RSVP-type gated offering with no theme venue name, because the
--                  RSVP reader is a different function with the same defect.
-- =====================================================================================
CREATE TEMP TABLE i2489_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;

DO $seed2$
DECLARE
  v_brand uuid := (SELECT id FROM i2489_ids WHERE label = 'brand');
  v_slug  text := (SELECT slug FROM public.brands WHERE id = v_brand);
  v_id    uuid;
  v_geo   point := point(-0.1276, 51.5072);
  v_label text;
  v_theme jsonb;
  v_type  text;
BEGIN
  INSERT INTO i2489_ctx(k, v) VALUES ('brand_slug', v_slug);

  FOR v_label, v_type, v_theme IN
    SELECT * FROM (VALUES
      ('no_venue_name', 'event', jsonb_build_object('business_event', jsonb_build_object(
          'hideAddressUntilTicket', true,
          'location', jsonb_build_object('address', '221B Baker Street')))),
      ('array_theme',   'event', '[1,2,3]'::jsonb),
      ('rsvp_gated',    'rsvp',  jsonb_build_object('business_event', jsonb_build_object(
          'hideAddressUntilTicket', true,
          'location', jsonb_build_object('address', '221B Baker Street'))))
    ) AS t(label, etype, theme)
  LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.events (
      id, brand_id, title, slug, event_type, status, visibility, timezone,
      currency, published_at, city, show_on_discover, rsvp_discoverable,
      location_text, location_geo, theme
    ) VALUES (
      v_id, v_brand, 'i2489 ' || v_label,
      'i2489-' || v_label || '-' || replace(v_id::text, '-', ''),
      v_type, 'scheduled', 'public', 'UTC', 'GBP', now(), 'i2489 City', true, true,
      'i2489 Venue · 221B Baker Street', v_geo, v_theme
    );
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (v_id, now() + interval '30 days', now() + interval '30 days 4 hours', 'UTC', true);
    INSERT INTO i2489_ids(label, id) VALUES (v_label, v_id);
    INSERT INTO i2489_ctx(k, v)
      VALUES (v_label || '_slug', (SELECT slug FROM public.events WHERE id = v_id));
  END LOOP;
  RAISE NOTICE 'SEED 2 OK — a gated offering with no stored venue name, a malformed theme, and an RSVP twin';
END $seed2$;

-- =====================================================================================
-- SC-16 .. SC-20 — THE BASE RECORD, AND THE PHASE BOUNDARY.
--
-- Withholding a value from every derived read model does not withhold it if the record
-- underneath is readable on its own. It is reachable directly, it is reachable through
-- every child table that points at it, and — the part a projection gate can never
-- answer — it is usable as a FILTER even when it is not selected, which turns the value
-- into something a caller can search for rather than merely read.
--
-- Closing that is a grant change on the record itself, and it is a SEPARATE, LATER
-- deploy: it makes two anonymous web routes raise until the client change that stops
-- them depending on those columns is live. This phase ships the client change; the
-- grant follows once it is.
--
-- These five assertions therefore ARM THEMSELVES. They read the grant state and assert
-- whichever set of facts that state implies, so nothing here has to be edited when the
-- second deploy lands — the strong branch simply starts running. The first branch is not
-- a blessing of the open state; it is a statement of exactly where this phase stopped,
-- and it fails if the boundary is anywhere other than where it is claimed to be.
-- =====================================================================================
DO $t$
DECLARE
  v_gated      uuid := (SELECT id FROM i2489_ids WHERE label = 'gated_full');
  v_revoked    boolean;
  v_txt        text;
  v_n          bigint;
  v_state      text;
  v_raised     boolean;
BEGIN
  v_revoked := NOT has_column_privilege('anon', 'public.events', 'location_geo', 'SELECT');

  IF NOT v_revoked THEN
    -- PHASE BOUNDARY, first side. The grant has not moved yet, so the record is still
    -- readable. Assert that this is uniformly true rather than partially true: a
    -- half-applied grant change would leave some columns readable and others raising,
    -- which is the one state neither phase is prepared for.
    IF NOT (has_column_privilege('anon', 'public.events', 'location_text', 'SELECT')
        AND has_column_privilege('anon', 'public.events', 'theme', 'SELECT')) THEN
      RAISE EXCEPTION 'SC-16..20: the base-record grant is HALF applied — anon can read some withheld columns and not others. Neither phase describes this state; finish or revert the grant change.';
    END IF;
    SET LOCAL ROLE anon;
    SELECT location_text INTO v_txt FROM public.events WHERE id = v_gated;
    RESET ROLE;
    IF v_txt IS NULL THEN
      RAISE EXCEPTION 'SC-16..20: anon holds the column grant but read no value — the fixture is not exercising the base record it claims to describe';
    END IF;
    v_state := 'grant still in place; the base record is readable and this phase does not close it';
  ELSE
    -- PHASE BOUNDARY, second side. The grant has moved. Every one of these must now
    -- refuse, INCLUDING the filter, because privilege to reference a column in a
    -- predicate is what closes the value as a search oracle rather than merely as a
    -- projection.
    -- SC-16 — direct projection.
    v_raised := false;
    BEGIN SET LOCAL ROLE anon; PERFORM location_geo FROM public.events WHERE id = v_gated; RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_raised := true; END;
    IF NOT v_raised THEN RAISE EXCEPTION 'SC-16: anon still projected location_geo from the base record'; END IF;
    -- SC-17 — the same column used only as a filter.
    v_raised := false;
    BEGIN SET LOCAL ROLE anon; SELECT count(*) INTO v_n FROM public.events WHERE location_geo IS NOT NULL; RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_raised := true; END;
    IF NOT v_raised THEN RAISE EXCEPTION 'SC-17: anon can still FILTER on location_geo — the value is a search oracle even though it is not projected'; END IF;
    -- SC-18 — the whole record.
    v_raised := false;
    BEGIN SET LOCAL ROLE anon; PERFORM * FROM public.events WHERE id = v_gated; RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_raised := true; END;
    IF NOT v_raised THEN RAISE EXCEPTION 'SC-18: anon still read the whole base record'; END IF;
    -- SC-19 — reached through a child table rather than directly.
    v_raised := false;
    BEGIN SET LOCAL ROLE anon;
      PERFORM e.location_text FROM public.event_dates d JOIN public.events e ON e.id = d.event_id WHERE d.event_id = v_gated;
      RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_raised := true; END;
    IF NOT v_raised THEN RAISE EXCEPTION 'SC-19: anon still reached location_text by joining from a child table'; END IF;
    -- SC-20 — ANTI-VACUITY TWIN. A column that was never in scope must still be readable,
    -- or the grant change was too wide and this whole block would pass by breaking reads.
    SET LOCAL ROLE anon;
    SELECT title INTO v_txt FROM public.events WHERE id = v_gated;
    RESET ROLE;
    IF v_txt IS NULL THEN
      RAISE EXCEPTION 'SC-20: anon can no longer read a column that was never withheld — the grant change is wider than the privacy rule';
    END IF;
    v_state := 'grant applied; the base record no longer answers for the withheld columns, by projection or by filter';
  END IF;

  RAISE NOTICE 'SC-16..20 PASS — %', v_state;
  INSERT INTO i2489_executed(scenario) SELECT unnest(ARRAY['SC-16','SC-17','SC-18','SC-19','SC-20']);
END $t$;

-- =====================================================================================
-- SC-21 — THE VENUE-NAME DOOR.
--
-- The three readers that gate the address correctly all derived the venue NAME by
-- falling back to the stored combined string when the theme carried no name of its own.
-- That string is "venue, then street". So for the offering seeded above — gated, no
-- stored venue name — the street shipped inside venueName while address and the pin
-- beside it were correctly NULL. This asserts the fallback now lives inside the gate.
-- =====================================================================================
DO $t$
DECLARE
  v_brand  text := (SELECT v FROM i2489_ctx WHERE k = 'brand_slug');
  v_slug   text := (SELECT v FROM i2489_ctx WHERE k = 'no_venue_name_slug');
  v_rsvp   text := (SELECT v FROM i2489_ctx WHERE k = 'rsvp_gated_slug');
  v_id     uuid := (SELECT id FROM i2489_ids WHERE label = 'no_venue_name');
  v_payload json;
  v_name   text;
  v_checked int := 0;
BEGIN
  SET LOCAL ROLE anon;

  v_payload := public.pg_public_event_by_slug(v_brand, v_slug);
  IF v_payload IS NULL THEN RAISE EXCEPTION 'SC-21 fixture invalid: the slug reader returned nothing for the seeded offering'; END IF;
  v_name := v_payload #>> '{venueName}';
  IF v_name IS NOT NULL AND position('221B' in v_name) > 0 THEN
    RAISE EXCEPTION 'SC-21: the slug reader shipped the street inside venueName for a gated offering (%)', v_name;
  END IF;
  v_checked := v_checked + 1;

  -- This reader resolves by id OR by the slug pair, never both; the id form is used here.
  v_payload := public.pg_direct_event_checkout_bundle(v_id, NULL, NULL);
  IF v_payload IS NULL THEN RAISE EXCEPTION 'SC-21 fixture invalid: the checkout reader returned nothing'; END IF;
  v_name := v_payload #>> '{venueName}';
  IF v_name IS NOT NULL AND position('221B' in v_name) > 0 THEN
    RAISE EXCEPTION 'SC-21: the checkout reader shipped the street inside venueName for a gated offering (%)', v_name;
  END IF;
  v_checked := v_checked + 1;

  v_payload := public.pg_public_rsvp_by_slug(v_brand, v_rsvp);
  IF v_payload IS NULL THEN RAISE EXCEPTION 'SC-21 fixture invalid: the RSVP reader returned nothing'; END IF;
  v_name := v_payload #>> '{venueName}';
  IF v_name IS NOT NULL AND position('221B' in v_name) > 0 THEN
    RAISE EXCEPTION 'SC-21: the RSVP reader shipped the street inside venueName for a gated offering (%)', v_name;
  END IF;
  v_checked := v_checked + 1;

  RESET ROLE;
  IF v_checked <> 3 THEN
    RAISE EXCEPTION 'SC-21: only % of the three readers were actually exercised', v_checked;
  END IF;
  RAISE NOTICE 'SC-21 PASS — none of the three readers reaches the street through the venue-name field';
  INSERT INTO i2489_executed(scenario) VALUES ('SC-21');
END $t$;

-- =====================================================================================
-- SC-22 / SC-23 / SC-24 — THE WITHHOLD BRANCH MUST BE AS TOTAL AS THE PREDICATE.
--
-- The predicate cannot raise. Before this change the branch it guarded could: both jsonb
-- delete forms are undefined outside an object. A gate whose guard cannot fail but whose
-- body can is fail-LOUD, and on the two LIST readers the failure is not confined to the
-- offending row — one malformed offering answers an entire market's request, and an
-- entire brand's, with an exception. SC-24 is the one that matters most: it asserts the
-- blast radius of a bad row is that row.
-- =====================================================================================
DO $t$
DECLARE
  v_arr    uuid := (SELECT id FROM i2489_ids WHERE label = 'array_theme');
  v_gated  uuid := (SELECT id FROM i2489_ids WHERE label = 'gated_full');
  v_brand  text := (SELECT v FROM i2489_ctx WHERE k = 'brand_slug');
  v_bad    uuid := (SELECT id FROM i2489_ids WHERE label = 'bad_type');
  v_n      bigint;
  v_feed   jsonb;
  v_seen   boolean;
BEGIN
  SET LOCAL ROLE anon;

  -- SC-22 — every gated object returns a row for the malformed offering and none raises.
  BEGIN
    SELECT count(*) INTO v_n FROM public.business_public_events_view WHERE id = v_arr;
    IF v_n <> 1 THEN RAISE EXCEPTION 'SC-22: the primary view did not return the malformed-theme offering'; END IF;
    BEGIN
      SELECT count(*) INTO v_n FROM public.events_public_view WHERE id = v_arr;
      IF v_n <> 1 THEN RAISE EXCEPTION 'SC-22: the second view did not return the malformed-theme offering'; END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;  -- caller-rights view, base grant already moved; refusing is not raising on shape
    END;
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE;
    WHEN OTHERS THEN
      IF SQLSTATE = 'P0001' THEN RAISE; END IF;
      RAISE EXCEPTION 'SC-22: reading a malformed theme as anon RAISED (sqlstate %) — the withhold branch is not total', SQLSTATE;
  END;

  -- SC-23 — a non-boolean at the flag withholds and does not raise. The bad_type row
  -- carries a string there; it must be treated as withheld, not as an error and not as
  -- a value Postgres happens to be willing to coerce.
  SELECT count(*) INTO v_n
  FROM public.business_public_events_view
  WHERE id = v_bad
    AND (location_geo IS NOT NULL
         OR NULLIF(location_text, '') IS NOT NULL
         OR NULLIF(public_theme #>> '{business_event,location,address}', '') IS NOT NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'SC-23: a non-boolean value at the flag FAILED OPEN and published the location';
  END IF;

  -- SC-24 — the list readers still answer for everyone else while the bad row is present.
  v_feed := public.pg_discover_business_events(ARRAY['i2489 City'], now() - interval '1 day', NULL, NULL, NULL, NULL, 0, 50, NULL, NULL, NULL);
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_feed -> 'rows', '[]'::jsonb)) e
    WHERE (e ->> 'id')::uuid = v_gated
  ) INTO v_seen;
  IF NOT v_seen THEN
    RAISE EXCEPTION 'SC-24: one malformed offering suppressed the whole city feed — a bad row answered every other host''s rows with nothing';
  END IF;

  SELECT count(*) INTO v_n FROM public.pg_public_brand_upcoming(v_brand, NULL, 50);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'SC-24: one malformed offering suppressed the whole brand feed (% rows returned)', v_n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'SC-24 PASS — a malformed offering costs its own row and nobody else''s';
  INSERT INTO i2489_executed(scenario) SELECT unnest(ARRAY['SC-22','SC-23','SC-24']);
END $t$;

-- =====================================================================================
-- SC-25 — THE DECLARED SET AND THE SET THAT ACTUALLY CARRIES THE GATE MUST BE EQUAL.
--
-- This is the only defence available for the readers that run with the definer's rights.
-- Those bypass row-level policy and column grants by construction, so nothing underneath
-- them can refuse on their behalf: if a later change re-emits one from a copy taken
-- before this file, the gate is simply gone, the diff reads as an addition, and every
-- behavioural assertion that names the object by hand still passes because it was never
-- looking at the object that changed.
--
-- Three properties make this check worth having, and it is worthless without all three:
--   * it reads the CATALOG, not migration text. Deriving a set by parsing SQL files is
--     easy to get subtly wrong in a way that reads as rigorous;
--   * it asserts EQUALITY, in both directions, never a count. A count cannot see one
--     object losing the gate while an unrelated one gains it, and the second direction
--     catches a gate spreading by copy-paste into somewhere nobody reasoned about;
--   * it refuses to be vacuous. A check that finds no objects and therefore no
--     violations is green and blind, which is the failure mode this repository keeps
--     finding, so a declared object that does not EXIST is a failure in its own right.
--
-- It has to run where the terminal state is the SHIPPED one. A lane that applies this
-- file last always reproduces the intended set and structurally cannot observe a later
-- re-emission; the provider this fixture is registered in replays the whole chain in
-- filename order, so anything landing after this file is in the state examined here.
-- =====================================================================================
DO $t$
DECLARE
  v_declared   text[];
  v_absent     text[];
  v_found      text[];
  v_missing    text[];
  v_undeclared text[];
BEGIN
  SELECT array_agg(object_name ORDER BY object_name) INTO v_declared
  FROM public.issue_2489_gate_registry();

  IF v_declared IS NULL OR cardinality(v_declared) = 0 THEN
    RAISE EXCEPTION 'SC-25 is vacuous: the registry declared no objects, so it can never find a violation';
  END IF;

  -- Non-vacuity: every declared object must actually exist in this replay state.
  SELECT array_agg(d ORDER BY d) INTO v_absent
  FROM unnest(v_declared) d
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = d
    UNION ALL
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = d AND c.relkind = 'v'
  );
  IF v_absent IS NOT NULL THEN
    RAISE EXCEPTION 'SC-25: declared objects do not exist in this replay, so any check over them would pass by finding nothing: %',
      array_to_string(v_absent, ', ');
  END IF;

  SELECT array_agg(name ORDER BY name) INTO v_found FROM (
    SELECT p.proname::text AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'issue_2489_address_withheld'
      AND p.proname <> 'issue_2489_gate_registry'
      AND (p.prosrc LIKE '%issue_2489_address_withheld%' OR p.prosrc LIKE '%issue_2489_public_theme%')
    UNION
    SELECT c.relname::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND (pg_get_viewdef(c.oid) LIKE '%issue_2489_address_withheld%'
        OR pg_get_viewdef(c.oid) LIKE '%issue_2489_public_theme%')
  ) q;

  SELECT array_agg(x ORDER BY x) INTO v_missing
  FROM unnest(v_declared) x WHERE x <> ALL (COALESCE(v_found, ARRAY[]::text[]));
  SELECT array_agg(x ORDER BY x) INTO v_undeclared
  FROM unnest(COALESCE(v_found, ARRAY[]::text[])) x WHERE x <> ALL (v_declared);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'SC-25: a declared object no longer carries the shared gate — it was almost certainly re-emitted from a copy taken before the gate existed: %',
      array_to_string(v_missing, ', ');
  END IF;
  IF v_undeclared IS NOT NULL THEN
    RAISE EXCEPTION 'SC-25: an undeclared object carries the shared gate. Declare it deliberately or remove it; a gate that spread by copy-paste is not a reasoned one: %',
      array_to_string(v_undeclared, ', ');
  END IF;

  RAISE NOTICE 'SC-25 PASS — declared and actual gate carriers are the same set, in both directions';
  INSERT INTO i2489_executed(scenario) VALUES ('SC-25');
END $t$;

-- =====================================================================================
-- NC-1 — THE NEGATIVE CONTROL.
--
-- Every assertion above is green. That is only evidence if this suite is capable of
-- being red for the reason it claims to watch for. A control that fails because the
-- fixture is malformed proves the harness runs; it proves nothing about where the
-- assertions are pointed. So this stages an ACTUAL privacy violation — the shared
-- predicate is replaced with one that reveals, which is precisely the shipped defect
-- this issue exists to close — and requires the suite to catch it, naming the leaked
-- column. If the leak goes undetected the suite fails HERE, because a green tick from a
-- suite that cannot see a real leak is worse than no suite at all: it vouches for the
-- hole.
--
-- Staged inside a savepoint and rolled straight back, so nothing after this point sees
-- the mutated schema.
-- =====================================================================================
SAVEPOINT i2489_negative_control;

CREATE OR REPLACE FUNCTION public.issue_2489_address_withheld(p_theme jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $mutant$ SELECT false $mutant$;

DO $t$
DECLARE
  v_gated  uuid := (SELECT id FROM i2489_ids WHERE label = 'gated_full');
  v_leaks  text[];
  v_geo    point;
  v_txt    text;
  v_addr   text;
BEGIN
  SET LOCAL ROLE anon;
  SELECT location_geo, location_text, public_theme #>> '{business_event,location,address}'
    INTO v_geo, v_txt, v_addr
  FROM public.business_public_events_view WHERE id = v_gated;
  RESET ROLE;

  v_leaks := ARRAY[]::text[];
  IF v_geo  IS NOT NULL           THEN v_leaks := array_append(v_leaks, 'location_geo'); END IF;
  IF NULLIF(v_txt, '')  IS NOT NULL THEN v_leaks := array_append(v_leaks, 'location_text'); END IF;
  IF NULLIF(v_addr, '') IS NOT NULL THEN v_leaks := array_append(v_leaks, 'theme.business_event.location.address'); END IF;

  IF cardinality(v_leaks) = 0 THEN
    RAISE EXCEPTION 'NC-1: the gate was replaced with one that reveals, an unauthenticated read was performed against a withheld offering, and this suite saw nothing. Every green assertion above is therefore uninformative — they are not reading what they claim to read.';
  END IF;

  IF NOT ('location_geo' = ANY (v_leaks)) THEN
    RAISE EXCEPTION 'NC-1: the control leaked % but not the exact pin, so the control is not staging the violation it describes', array_to_string(v_leaks, ', ');
  END IF;

  RAISE NOTICE 'NC-1 PASS — with a revealing gate the anon read returns %, and this suite detects it', array_to_string(v_leaks, ', ');
END $t$;

ROLLBACK TO SAVEPOINT i2489_negative_control;

-- Recorded AFTER the rollback: the savepoint would otherwise take the record with it,
-- and the ledger would report the control as silent. Reached only if the block above
-- did not raise, which is what the ledger entry is meant to attest.
INSERT INTO i2489_executed(scenario) VALUES ('NC-1');

-- =====================================================================================
-- LEDGER CHECK — every scenario this file claims to contain actually ran.
-- Set equality, so a scenario that was silenced is a failure and not a silence.
-- =====================================================================================
DO $t$
DECLARE
  v_expected text[] := ARRAY[
    'SC-1','SC-2','SC-3','SC-4','SC-5','SC-6','SC-7','SC-8','SC-9','SC-10','SC-11','SC-12',
    'SC-13','SC-14','SC-15','SC-16','SC-17','SC-18','SC-19','SC-20','SC-21','SC-22','SC-23',
    'SC-24','SC-25','NC-1'];
  v_ran      text[];
  v_silent   text[];
  v_extra    text[];
BEGIN
  SELECT array_agg(scenario ORDER BY scenario) INTO v_ran FROM i2489_executed;
  SELECT array_agg(x ORDER BY x) INTO v_silent
  FROM unnest(v_expected) x WHERE x <> ALL (COALESCE(v_ran, ARRAY[]::text[]));
  SELECT array_agg(x ORDER BY x) INTO v_extra
  FROM unnest(COALESCE(v_ran, ARRAY[]::text[])) x WHERE x <> ALL (v_expected);

  IF v_silent IS NOT NULL THEN
    RAISE EXCEPTION 'LEDGER: these scenarios are present in the file but did not execute to completion — an assertion that cannot run cannot certify anything: %',
      array_to_string(v_silent, ', ');
  END IF;
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'LEDGER: scenarios ran that this file does not declare: %', array_to_string(v_extra, ', ');
  END IF;
  RAISE NOTICE 'LEDGER PASS — all % declared scenarios executed to completion', cardinality(v_expected);
END $t$;

ROLLBACK;
