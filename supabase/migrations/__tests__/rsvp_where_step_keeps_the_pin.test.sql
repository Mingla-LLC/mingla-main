-- RSVP Where step — the picked address keeps its map pin, and the published
-- RSVP carries it. Pins 20270706000000_rsvp_where_step_keeps_the_pin.sql.
--
-- The production symptom: pick an address on an RSVP draft, the map preview
-- renders, and ~1 s later (the 700 ms autosave plus the round trip) it falls
-- back to "Pick an address to preview the map". business_update_rsvp_graph's
-- draft branch never wrote `location_geo`, and the wizard replaces its local
-- draft with the row that owner returns. business_publish_rsvp_draft never
-- promoted a coordinate either, so a published RSVP had no pin at all.
--
-- EVERY CASE EXECUTES THE REAL FUNCTION against the full migration chain, with
-- the payload shape the Business client sends (draftToServerUpdate: top-level
-- snake_case columns + theme.business_draft). Each case rolls back.
--
-- FAILS-ON-REVERT (delete 20270706000000_rsvp_where_step_keeps_the_pin.sql):
--   W-01 — the autosave response carries no location_geo (the wizard's map
--          blanks); W-03 — the column is never written, so there is no pin to
--          keep; W-04 / W-06 — the published RSVP has no pin and no precision;
--          W-07 — a re-picked address on a published RSVP never reaches the
--          column; W-08 — the fixture refuses to run without a stored pin.
--   Measured against the pre-fix bodies on PG17: W-01, W-03, W-04, W-06,
--   W-07a and W-08a fail; W-05 passes.
-- W-05 and W-08a are the adversarial half: publishing must never ERASE a pin
-- the row already holds, and a hidden address must still withhold the
-- coordinate now that RSVPs actually store one.
--
-- Run after the full migration chain on fresh PostgreSQL 17.
\set ON_ERROR_STOP on

-- The payload the wizard autosaves for an in-person RSVP draft. p_geo is the
-- picked point as {lat,lng} (or NULL once the address is cleared).
CREATE OR REPLACE FUNCTION pg_temp.where_pin_payload(
  p_revision integer, p_geo jsonb, p_precision text, p_hide_address boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    '__expectedClientRevision', p_revision,
    'title', 'Where pin RSVP',
    'description', NULL,
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn, New York 11249, United States',
    'online_url', NULL,
    'currency', 'USD',
    'is_online', false,
    'timezone', 'America/New_York',
    'city', CASE WHEN p_geo IS NULL THEN NULL ELSE 'Brooklyn' END,
    'location_geo', CASE WHEN p_geo IS NULL THEN NULL
                         ELSE '(' || (p_geo->>'lng') || ',' || (p_geo->>'lat') || ')' END,
    'theme', jsonb_build_object('coverHue', 25, 'business_draft', jsonb_build_object(
      'format', 'in_person',
      'partyTypes', jsonb_build_array('house-party'),
      'vibeTags', '[]'::jsonb,
      'musicGenres', '[]'::jsonb,
      'city', CASE WHEN p_geo IS NULL THEN NULL ELSE 'Brooklyn' END,
      'locationGeo', p_geo,
      'coordinatePrecision', p_precision,
      'requestedVisibility', 'public',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char((now() + interval '30 days')::date, 'YYYY-MM-DD'),
        'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'America/New_York'),
      'location', jsonb_build_object('venueName', 'Lantern Room',
        'address', '61 Wythe Avenue, Brooklyn, New York 11249, United States'),
      'hideAddressUntilTicket', p_hide_address,
      'tickets', '[]'::jsonb,
      'isRsvp', true,
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false,
      'rsvpContributionEnabled', false,
      'clientRevision', p_revision)))
$payload$;

CREATE OR REPLACE FUNCTION pg_temp.where_pin_fixture(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_brand_slug text, v_event uuid)
LANGUAGE plpgsql AS $fixture$
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  v_brand_slug := 'where-pin-' || p_tag || '-' || v_brand;
  INSERT INTO auth.users(id, email) VALUES (v_user, 'where-pin-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Where pin ' || p_tag, v_brand_slug, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'Where pin RSVP', 'draft-where-pin-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  RETURN NEXT;
END;
$fixture$;

-- 61 Wythe Avenue, Brooklyn. lng first in a Postgres point.
CREATE OR REPLACE FUNCTION pg_temp.wythe() RETURNS jsonb LANGUAGE sql IMMUTABLE AS
$$ SELECT jsonb_build_object('lat', 40.7219, 'lng', -73.9577) $$;

-- ─── W-01: the autosave response carries the pin (the wizard's map) ────────────
BEGIN;
DO $w01$
DECLARE
  f record;
  v_graph jsonb;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.where_pin_fixture('w01');
  v_graph := public.business_update_rsvp_graph(f.v_event,
    pg_temp.where_pin_payload(1, pg_temp.wythe(), 'exact'), NULL, NULL);

  -- serverRowToDraft reads response.event.location_geo; NULL here is the blank map.
  IF v_graph->'event'->>'location_geo' IS NULL THEN
    RAISE EXCEPTION 'W-01 FAIL: the autosave response has no location_geo — the wizard replaces its draft with this row and the map preview blanks';
  END IF;
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_geo IS NULL
     OR abs(v_row.location_geo[0] - (-73.9577)) > 1e-9
     OR abs(v_row.location_geo[1] - 40.7219) > 1e-9 THEN
    RAISE EXCEPTION 'W-01 FAIL: stored location_geo is % (expected (-73.9577,40.7219))', v_row.location_geo;
  END IF;
  RAISE NOTICE 'W-01 PASS: an RSVP draft autosave stores the picked pin and returns it';
END $w01$;
ROLLBACK;

-- ─── W-02 / W-03: clearing the address clears the pin; an absent key keeps it ──
BEGIN;
DO $w02$
DECLARE
  f record;
  v_geo point;
BEGIN
  SELECT * INTO f FROM pg_temp.where_pin_fixture('w02');
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.where_pin_payload(1, pg_temp.wythe(), 'exact'), NULL, NULL);

  -- W-03 — a save that does not carry the key leaves the pin alone.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.where_pin_payload(2, pg_temp.wythe(), 'exact') - 'location_geo', NULL, NULL);
  SELECT location_geo INTO v_geo FROM public.events WHERE id = f.v_event;
  IF v_geo IS NULL THEN
    RAISE EXCEPTION 'W-03 FAIL: a save without the location_geo key erased the stored pin';
  END IF;

  -- W-02 — the wizard clears the address: location_geo arrives as null.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.where_pin_payload(3, NULL, NULL), NULL, NULL);
  SELECT location_geo INTO v_geo FROM public.events WHERE id = f.v_event;
  IF v_geo IS NOT NULL THEN
    RAISE EXCEPTION 'W-02 FAIL: clearing the address left the old pin % on the draft', v_geo;
  END IF;
  RAISE NOTICE 'W-02/W-03 PASS: an explicit null clears the pin; an absent key keeps it';
END $w02$;
ROLLBACK;

-- ─── W-04: the app's publish entry point carries the pin to the live RSVP ─────
BEGIN;
DO $w04$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.where_pin_fixture('w04');
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.where_pin_payload(1, pg_temp.wythe(), 'exact'), NULL, NULL);
  -- rsvpEvents.publishRsvpDraft calls exactly this.
  PERFORM public.business_publish_rsvp_graph(f.v_event, gen_random_uuid());

  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status = 'draft' THEN
    RAISE EXCEPTION 'W-04 fixture FAIL: the RSVP did not publish';
  END IF;
  IF v_row.location_geo IS NULL THEN
    RAISE EXCEPTION 'W-04 FAIL: the published RSVP has no location_geo — map links fall back to free text';
  END IF;
  IF abs(v_row.location_geo[0] - (-73.9577)) > 1e-9 OR abs(v_row.location_geo[1] - 40.7219) > 1e-9 THEN
    RAISE EXCEPTION 'W-04 FAIL: published location_geo is % — point() must take (lng, lat)', v_row.location_geo;
  END IF;
  IF v_row.coordinate_precision IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION 'W-04 FAIL: published coordinate_precision is % (expected exact)', v_row.coordinate_precision;
  END IF;
  RAISE NOTICE 'W-04 PASS: publishing an RSVP promotes the pin and its precision';
END $w04$;
ROLLBACK;

-- ─── W-05 / W-06: publish keeps a stored pin; a bad precision never blocks ───
BEGIN;
DO $w05$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.where_pin_fixture('w05');
  -- W-05 — the blob has no coordinate but the row already holds one.
  UPDATE public.events SET location_geo = point(-0.1278, 51.5074), coordinate_precision = 'approximate'
    WHERE id = f.v_event;
  PERFORM public.business_publish_rsvp_draft(f.v_event,
    pg_temp.where_pin_payload(1, NULL, NULL), 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_geo IS NULL OR v_row.coordinate_precision IS DISTINCT FROM 'approximate' THEN
    RAISE EXCEPTION 'W-05 FAIL: publishing without a blob coordinate erased the stored pin (geo %, precision %)',
      v_row.location_geo, v_row.coordinate_precision;
  END IF;
  RAISE NOTICE 'W-05 PASS: publish keeps a stored pin when the draft carries none';
END $w05$;
ROLLBACK;

BEGIN;
DO $w06$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.where_pin_fixture('w06');
  PERFORM public.business_publish_rsvp_draft(f.v_event,
    pg_temp.where_pin_payload(1, pg_temp.wythe(), 'pinpoint'), 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status = 'draft' THEN
    RAISE EXCEPTION 'W-06 FAIL: an unrecognised precision blocked the publish';
  END IF;
  IF v_row.location_geo IS NULL OR v_row.coordinate_precision IS NOT NULL THEN
    RAISE EXCEPTION 'W-06 FAIL: expected the pin with a NULL precision, got geo % precision %',
      v_row.location_geo, v_row.coordinate_precision;
  END IF;
  RAISE NOTICE 'W-06 PASS: an unrecognised precision normalises to NULL and the pin still publishes';
END $w06$;
ROLLBACK;

-- ─── W-07: re-picking the address on a published RSVP ─────────────────────────
BEGIN;
DO $w07$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.where_pin_fixture('w07');
  PERFORM public.business_publish_rsvp_draft(f.v_event,
    pg_temp.where_pin_payload(1, pg_temp.wythe(), 'exact'), 1);

  -- W-07a — the editor re-picks an address: coordinate + precision together.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'Where pin RSVP', 'location_text', 'Somewhere else',
      'city', 'London', 'location_geo', '(-0.1278,51.5074)', 'coordinate_precision', 'approximate'),
    'Moving the RSVP to a new venue', NULL);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_geo IS NULL OR abs(v_row.location_geo[1] - 51.5074) > 1e-9
     OR v_row.coordinate_precision IS DISTINCT FROM 'approximate' THEN
    RAISE EXCEPTION 'W-07a FAIL: a re-picked address on a published RSVP stored geo % precision %',
      v_row.location_geo, v_row.coordinate_precision;
  END IF;

  -- W-07b — an unrelated edit keeps both.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'Where pin RSVP renamed'), 'Renaming the RSVP only', NULL);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_geo IS NULL OR v_row.coordinate_precision IS DISTINCT FROM 'approximate' THEN
    RAISE EXCEPTION 'W-07b FAIL: an unrelated live edit erased the pin (geo %, precision %)',
      v_row.location_geo, v_row.coordinate_precision;
  END IF;

  -- W-07c — a cleared address clears both.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'Where pin RSVP renamed', 'location_geo', NULL,
      'coordinate_precision', 'exact'),
    'Clearing the RSVP venue', NULL);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_geo IS NOT NULL OR v_row.coordinate_precision IS NOT NULL THEN
    RAISE EXCEPTION 'W-07c FAIL: a cleared address kept geo % precision %',
      v_row.location_geo, v_row.coordinate_precision;
  END IF;
  RAISE NOTICE 'W-07 PASS: the published RSVP editor writes, keeps and clears the pin';
END $w07$;
ROLLBACK;

-- ─── W-08: the public RSVP page still withholds a hidden address's pin ────────
BEGIN;
DO $w08$
DECLARE
  f record;
  v_slug text;
  v_page json;
BEGIN
  -- W-08a — hidden address: the stored pin must not reach the public page.
  SELECT * INTO f FROM pg_temp.where_pin_fixture('w08a');
  PERFORM public.business_publish_rsvp_draft(f.v_event,
    pg_temp.where_pin_payload(1, pg_temp.wythe(), 'exact', true), 1);
  SELECT slug INTO v_slug FROM public.events WHERE id = f.v_event;
  IF (SELECT location_geo FROM public.events WHERE id = f.v_event) IS NULL THEN
    RAISE EXCEPTION 'W-08a fixture FAIL: the pin was not stored, so the withholding is untested';
  END IF;
  v_page := public.pg_public_rsvp_by_slug(f.v_brand_slug, v_slug);
  IF v_page IS NULL THEN
    RAISE EXCEPTION 'W-08a fixture FAIL: the public RSVP page did not resolve';
  END IF;
  IF (v_page->'locationGeo')::text <> 'null' THEN
    RAISE EXCEPTION 'W-08a FAIL: a hidden address exposed its coordinate on the public page: %', v_page->'locationGeo';
  END IF;

  -- W-08b — public address: the page carries the pin, lat and lng the right way round.
  SELECT * INTO f FROM pg_temp.where_pin_fixture('w08b');
  PERFORM public.business_publish_rsvp_draft(f.v_event,
    pg_temp.where_pin_payload(1, pg_temp.wythe(), 'exact', false), 1);
  SELECT slug INTO v_slug FROM public.events WHERE id = f.v_event;
  v_page := public.pg_public_rsvp_by_slug(f.v_brand_slug, v_slug);
  IF v_page IS NULL OR (v_page->'locationGeo')::text = 'null' THEN
    RAISE EXCEPTION 'W-08b FAIL: a public RSVP page has no coordinate: %', v_page;
  END IF;
  IF abs((v_page->'locationGeo'->>'lat')::numeric - 40.7219) > 0.000001
     OR abs((v_page->'locationGeo'->>'lng')::numeric - (-73.9577)) > 0.000001 THEN
    RAISE EXCEPTION 'W-08b FAIL: public page coordinate is % (expected lat 40.7219, lng -73.9577)', v_page->'locationGeo';
  END IF;
  RAISE NOTICE 'W-08 PASS: the public RSVP page withholds a hidden pin and shows a public one';
END $w08$;
ROLLBACK;
