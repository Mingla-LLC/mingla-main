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
BEGIN
  SET LOCAL ROLE anon;
  SELECT location_geo, location_text, theme INTO v_row
    FROM public.events_public_view WHERE id = v_gated;
  RESET ROLE;

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
END $t$;

ROLLBACK;
