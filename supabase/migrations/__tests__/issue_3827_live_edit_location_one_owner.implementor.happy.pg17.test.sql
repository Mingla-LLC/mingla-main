\set ON_ERROR_STOP on

-- Issue #3827 — implementor proof that a live edit keeps the two copies of an
-- event's location in step, that "hide address until ticket" can be switched
-- off, and that a save which moves nothing keeps the pin's precision.
-- Run after the full migration chain on PostgreSQL 17.
--
-- BEFORE. A published event stores its location twice: the structured halves
-- in theme.business_event.location {venueName, address} (what the editor and
-- the public page read first) and the label events.location_text
-- ("venue · address"). The live-edit functions wrote the label only, from one
-- half, so a changed address came back as the old one and the label lost the
-- venue. The hide-address toggle was written to a key no reader uses. Every
-- taxonomy save wiped coordinate_precision.
--
-- AFTER (20270828003827). The structured halves are written and the label is
-- derived from them by one composer, business_event_location_label.
--
-- FAILS-ON-REVERT (replay the chain without 20270828003827): H-01, H-02, H-03,
-- H-04 and H-06 fail on the first assertion each; H-05 fails because the
-- helper it also checks does not exist. H-05's refusal itself is a guard that
-- must hold on BOTH sides of the change.
--
-- Every case executes the real functions with the payload shape the Business
-- client sends. Each case rolls back.

-- The label-composer parity table. This is the ONE copy: the Host app's jest
-- suite (mingla-business/src/utils/__tests__/issue_3827_live_edit_diff.implementor.test.ts)
-- reads the JSON inside the dollar-quoted block below out of THIS file (the
-- quote tag appears exactly twice in this file: do not use it elsewhere) and runs
-- the same rows through the TypeScript composer `locationTextForDraft`. Keep
-- it strict JSON. `venue`/`address` are the stored halves; `expected` is the
-- label, or null when there is nothing to show.
CREATE OR REPLACE FUNCTION pg_temp.issue_3827_label_cases()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT $cases$[
    {"name": "both halves", "venue": "Lantern Room", "address": "61 Wythe Avenue, Brooklyn", "expected": "Lantern Room · 61 Wythe Avenue, Brooklyn"},
    {"name": "venue only, address null", "venue": "Lantern Room", "address": null, "expected": "Lantern Room"},
    {"name": "address only, venue null", "venue": null, "address": "61 Wythe Avenue, Brooklyn", "expected": "61 Wythe Avenue, Brooklyn"},
    {"name": "neither", "venue": null, "address": null, "expected": null},
    {"name": "empty venue", "venue": "", "address": "61 Wythe Avenue, Brooklyn", "expected": "61 Wythe Avenue, Brooklyn"},
    {"name": "empty address", "venue": "Lantern Room", "address": "", "expected": "Lantern Room"},
    {"name": "venue of spaces", "venue": "   ", "address": "61 Wythe Avenue, Brooklyn", "expected": "61 Wythe Avenue, Brooklyn"},
    {"name": "address of tab and newlines", "venue": "Lantern Room", "address": "\t\r\n", "expected": "Lantern Room"},
    {"name": "venue of a no-break space", "venue": " ", "address": "61 Wythe Avenue, Brooklyn", "expected": "61 Wythe Avenue, Brooklyn"},
    {"name": "venue of an ideographic space and a byte-order mark", "venue": "　﻿", "address": "61 Wythe Avenue, Brooklyn", "expected": "61 Wythe Avenue, Brooklyn"},
    {"name": "both blank", "venue": " ", "address": "  ", "expected": null},
    {"name": "halves are joined as stored, not trimmed", "venue": " Lantern Room ", "address": "61 Wythe Avenue ", "expected": " Lantern Room  · 61 Wythe Avenue "},
    {"name": "identical halves are not merged", "venue": "Lantern Room", "address": "Lantern Room", "expected": "Lantern Room · Lantern Room"},
    {"name": "a zero-width space is not blank", "venue": "​", "address": "61 Wythe Avenue, Brooklyn", "expected": "​ · 61 Wythe Avenue, Brooklyn"},
    {"name": "a separator inside a half is kept", "venue": "Room · Two", "address": "61 Wythe Avenue", "expected": "Room · Two · 61 Wythe Avenue"}
  ]$cases$::jsonb
$fn$;

-- A brand with no bank, its owner, and a PUBLISHED in-person ticketed event
-- with a venue, an address, an exact pin and hide-address on. Published through
-- the entry point the wizard calls, so the row has the shape production rows have.
CREATE OR REPLACE FUNCTION pg_temp.issue_3827_event_fixture(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_revision integer)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'issue-3827-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Issue 3827 ' || p_tag, 'issue-3827-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_event, v_brand, v_user, 'Issue 3827 draft', 'issue-3827-draft-' || v_event, 'event', 'draft',
    'draft', 'America/New_York');
  PERFORM public.issue_1719_publish_event_with_poster(v_event, jsonb_build_object(
    'title', 'Issue 3827 night',
    'timezone', 'America/New_York',
    'is_online', false,
    'city', 'Brooklyn',
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'in_person',
      'requestedVisibility', 'public',
      'clientRevision', 1,
      'city', 'Brooklyn',
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '61 Wythe Avenue, Brooklyn'),
      'hideAddressUntilTicket', true,
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '12 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')))), 1);
  -- The Where-step pin, as the wizard's autosave leaves it.
  UPDATE public.events SET location_geo = point(-73.9578, 40.7222), coordinate_precision = 'exact'
   WHERE id = v_event;
  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.status IS DISTINCT FROM 'scheduled'
     OR v_row.location_text IS DISTINCT FROM 'Lantern Room · 61 Wythe Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Lantern Room'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn'
     OR (v_row.theme #>> '{business_event,hideAddressUntilTicket}')::boolean IS DISTINCT FROM true
     OR v_row.coordinate_precision IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION 'fixture: the published event is not the shape the suite assumes (status %, label %, theme %)',
      v_row.status, v_row.location_text, v_row.theme -> 'business_event';
  END IF;
  v_revision := COALESCE((v_row.theme #>> '{business_event,clientRevision}')::integer, 0);
  RETURN NEXT;
END;
$fixture$;

-- The taxonomy block EditPublishedScreen sends on every taxonomy save.
CREATE OR REPLACE FUNCTION pg_temp.issue_3827_taxonomy(
  p_lat numeric, p_lng numeric, p_location_text text, p_precision text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $taxonomy$
  SELECT jsonb_build_object(
    'city', 'Brooklyn',
    'partyTypes', jsonb_build_array('festival'),
    'vibeTags', jsonb_build_array('social', 'chill'),
    'musicGenres', '[]'::jsonb,
    'locationGeo', jsonb_build_object('lat', p_lat, 'lng', p_lng),
    'locationText', p_location_text)
    || CASE WHEN p_precision IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('coordinatePrecision', p_precision) END
$taxonomy$;

-- A brand with no bank, its owner, and a PUBLISHED in-person RSVP with a venue
-- and an address, published through the app's own two calls.
CREATE OR REPLACE FUNCTION pg_temp.issue_3827_rsvp_fixture(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'issue-3827-rsvp-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Issue 3827 RSVP ' || p_tag, 'issue-3827-rsvp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'Issue 3827 RSVP', 'issue-3827-rsvp-draft-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  PERFORM public.business_update_rsvp_graph(v_event, jsonb_build_object(
    '__expectedClientRevision', 1,
    'title', 'Issue 3827 RSVP',
    'description', NULL,
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn',
    'online_url', NULL,
    'currency', 'USD',
    'is_online', false,
    'timezone', 'America/New_York',
    'city', 'Brooklyn',
    'theme', jsonb_build_object('coverHue', 25, 'business_draft', jsonb_build_object(
      'format', 'in_person',
      'partyTypes', jsonb_build_array('house-party'),
      'vibeTags', '[]'::jsonb,
      'musicGenres', '[]'::jsonb,
      'city', 'Brooklyn',
      'requestedVisibility', 'public',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char((now() + interval '30 days')::date, 'YYYY-MM-DD'),
        'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'America/New_York'),
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '61 Wythe Avenue, Brooklyn'),
      'hideAddressUntilTicket', false,
      'tickets', '[]'::jsonb,
      'isRsvp', true,
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false,
      'rsvpContributionEnabled', false,
      'rsvpContributionSuggestedCents', NULL,
      'rsvpContributionMinCents', NULL,
      'clientRevision', 1))), NULL, NULL);
  PERFORM public.business_publish_rsvp_graph(v_event, gen_random_uuid());
  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.status IS NULL OR v_row.status NOT IN ('scheduled', 'live')
     OR v_row.location_text IS DISTINCT FROM 'Lantern Room · 61 Wythe Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Lantern Room'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'fixture: the published RSVP is not the shape the suite assumes (status %, label %, theme %)',
      v_row.status, v_row.location_text, v_row.theme -> 'business_event';
  END IF;
  IF public.pg_brand_can_collect(v_brand) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'fixture: the brand can already collect; H-05 would prove nothing';
  END IF;
  RETURN NEXT;
END;
$fixture$;

-- ─── H-01: an address edit moves the structured address, the label and the pin ─
BEGIN;
DO $h01$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_event_fixture('h01');
  -- What the editor sends when the host re-picks the address: the address text
  -- as taxonomy.locationText, the new pin and its precision.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_taxonomy(40.7081, -73.9571, '250 Bedford Avenue, Brooklyn', 'approximate')),
    'Moving the night to the new room', f.v_revision + 1);

  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '250 Bedford Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'H-01 FAIL: the structured address is still "%" — the editor will show the old address',
      v_row.theme #>> '{business_event,location,address}';
  END IF;
  IF v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Lantern Room' THEN
    RAISE EXCEPTION 'H-01 FAIL: an address edit changed the venue to "%"',
      v_row.theme #>> '{business_event,location,venueName}';
  END IF;
  IF v_row.location_text IS DISTINCT FROM 'Lantern Room · 250 Bedford Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'H-01 FAIL: the label is "%" (expected the venue and the new address)', v_row.location_text;
  END IF;
  IF v_row.location_text IS DISTINCT FROM public.business_event_location_label(
       v_row.theme #>> '{business_event,location,venueName}',
       v_row.theme #>> '{business_event,location,address}') THEN
    RAISE EXCEPTION 'H-01 FAIL: the label does not match the composer over the stored halves';
  END IF;
  IF v_row.location_geo IS NULL OR NOT (v_row.location_geo ~= point(-73.9571, 40.7081)) THEN
    RAISE EXCEPTION 'H-01 FAIL: the pin did not move (%)', v_row.location_geo;
  END IF;
  IF v_row.coordinate_precision IS DISTINCT FROM 'approximate' THEN
    RAISE EXCEPTION 'H-01 FAIL: the new pin lost its precision (%)', v_row.coordinate_precision;
  END IF;
  -- The rest of the theme is untouched by the location write.
  IF v_row.theme #>> '{business_event,format}' IS DISTINCT FROM 'in_person'
     OR (v_row.theme #>> '{business_event,hideAddressUntilTicket}')::boolean IS DISTINCT FROM true
     OR (v_row.theme #>> '{business_event,clientRevision}')::integer IS DISTINCT FROM f.v_revision + 1 THEN
    RAISE EXCEPTION 'H-01 FAIL: the location write disturbed a sibling theme key (%)', v_row.theme -> 'business_event';
  END IF;

  -- A venue-name edit in the same shape the editor sends keeps the address.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'Correcting the name of the venue', f.v_revision + 2);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'The Bedford Hall · 250 Bedford Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'The Bedford Hall'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '250 Bedford Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'H-01 FAIL: a venue edit left label "%" and halves %',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;
  RAISE NOTICE 'H-01 PASS: an address edit updates the structured address, the label and the pin, and keeps the venue';
END $h01$;
ROLLBACK;

-- ─── H-02: hide-address round-trips through the key every reader uses ─────────
BEGIN;
DO $h02$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_event_fixture('h02');
  -- The stale copy the old writer left behind on real rows.
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event,settings}',
       jsonb_build_object('hideAddressUntilTicket', true, 'allowTransfers', true), true)
   WHERE id = f.v_event;

  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('hideAddressUntilTicket', false)),
    'Showing the address to everyone now', f.v_revision + 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF (v_row.theme #>> '{business_event,hideAddressUntilTicket}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'H-02 FAIL: the host switched hide-address OFF and the key readers use is still % — the address stays hidden',
      v_row.theme #> '{business_event,hideAddressUntilTicket}';
  END IF;
  IF v_row.theme #> '{business_event,settings}' ? 'hideAddressUntilTicket' THEN
    RAISE EXCEPTION 'H-02 FAIL: the stale settings copy survived (%)', v_row.theme #> '{business_event,settings}';
  END IF;
  IF (v_row.theme #>> '{business_event,settings,allowTransfers}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'H-02 FAIL: removing the stale copy disturbed another setting (%)', v_row.theme #> '{business_event,settings}';
  END IF;

  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('hideAddressUntilTicket', true)),
    'Hiding the address again for now', f.v_revision + 2);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF (v_row.theme #>> '{business_event,hideAddressUntilTicket}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'H-02 FAIL: switching hide-address back ON did not stick (%)',
      v_row.theme #> '{business_event,hideAddressUntilTicket}';
  END IF;
  -- A save that does not mention the toggle leaves it alone.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'Issue 3827 night, renamed')),
    'Renaming the night for the poster', f.v_revision + 3);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF (v_row.theme #>> '{business_event,hideAddressUntilTicket}')::boolean IS DISTINCT FROM true
     OR v_row.location_text IS DISTINCT FROM 'Lantern Room · 61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'H-02 FAIL: an unrelated save changed hide-address or the label (% / %)',
      v_row.theme #> '{business_event,hideAddressUntilTicket}', v_row.location_text;
  END IF;
  RAISE NOTICE 'H-02 PASS: hide-address switches off and on through the direct child, and the stale settings copy is gone';
END $h02$;
ROLLBACK;

-- ─── H-03: a taxonomy save that moves nothing keeps the pin's precision ───────
BEGIN;
DO $h03$
DECLARE
  f record;
  v_before public.events%ROWTYPE;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_event_fixture('h03');
  SELECT * INTO v_before FROM public.events WHERE id = f.v_event;
  -- A vibe changed. The editor still sends the STORED pin, no precision (the
  -- shape installed apps send today), and locationText null.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_taxonomy(40.7222, -73.9578, NULL)),
    'Adding a vibe tag to the listing', f.v_revision + 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.coordinate_precision IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION 'H-03 FAIL: a save that moved nothing left precision % (expected the stored exact)',
      v_row.coordinate_precision;
  END IF;
  IF NOT (v_row.vibe_tags @> ARRAY['chill']::text[]) THEN
    RAISE EXCEPTION 'H-03 FAIL: the taxonomy edit itself did not save (%)', v_row.vibe_tags;
  END IF;
  IF v_row.location_text IS DISTINCT FROM v_before.location_text
     OR v_row.theme -> 'business_event' -> 'location' IS DISTINCT FROM v_before.theme -> 'business_event' -> 'location' THEN
    RAISE EXCEPTION 'H-03 FAIL: a save with no address changed the location (% / %)',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;
  -- A pin that really moved, sent without a precision, is NOT given the old one.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_taxonomy(40.7081, -73.9571, NULL)),
    'Moving the pin without a precision', f.v_revision + 2);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.coordinate_precision IS NOT NULL THEN
    RAISE EXCEPTION 'H-03 FAIL: a MOVED pin with no precision was given the old pin''s precision (%)',
      v_row.coordinate_precision;
  END IF;
  RAISE NOTICE 'H-03 PASS: an unrelated taxonomy save keeps the precision, and a moved pin does not inherit it';
END $h03$;
ROLLBACK;

-- ─── H-04: the RSVP `location` key writes both halves and derives the label ───
BEGIN;
DO $h04$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_rsvp_fixture('h04');
  -- rsvpEvents.updateLiveRsvp calls exactly this, with the diff payload.
  v_result := public.business_update_rsvp_graph(f.v_event, jsonb_build_object(
      'title', 'Issue 3827 RSVP',
      'location_text', 'The Bedford Hall · 250 Bedford Avenue, Brooklyn',
      'location', jsonb_build_object('venueName', 'The Bedford Hall', 'address', '250 Bedford Avenue, Brooklyn')),
    'Moving the gathering to a bigger room', NULL);
  IF (v_result #>> '{updateResult,ok}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'H-04 FAIL: the live RSVP edit was not accepted (%)', v_result -> 'updateResult';
  END IF;
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'The Bedford Hall'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '250 Bedford Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'H-04 FAIL: the structured halves are still % — the editor will show the old venue and address',
      v_row.theme #> '{business_event,location}';
  END IF;
  IF v_row.location_text IS DISTINCT FROM 'The Bedford Hall · 250 Bedford Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'H-04 FAIL: the label is "%"', v_row.location_text;
  END IF;

  -- The label comes from the halves, not from whatever location_text carried.
  PERFORM public.business_update_rsvp_graph(f.v_event, jsonb_build_object(
      'title', 'Issue 3827 RSVP',
      'location_text', 'a stale label an out-of-step client sent',
      'location', jsonb_build_object('venueName', NULL, 'address', '250 Bedford Avenue, Brooklyn')),
    'Dropping the venue name from the listing', NULL);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM '250 Bedford Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS NOT NULL
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '250 Bedford Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'H-04 FAIL: with `location` present the label was not derived from it (label "%", halves %)',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;

  -- An older client (no `location` key) behaves exactly as before.
  PERFORM public.business_update_rsvp_graph(f.v_event, jsonb_build_object(
      'title', 'Issue 3827 RSVP',
      'location_text', 'Older client label'),
    'An edit from an app that has not updated', NULL);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'Older client label'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '250 Bedford Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'H-04 FAIL: a payload without `location` no longer behaves as it did (label "%", halves %)',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;
  RAISE NOTICE 'H-04 PASS: the RSVP location key writes both halves and derives the label; without it nothing changes';
END $h04$;
ROLLBACK;

-- ─── H-05: a live RSVP still cannot switch chip-ins on without a bank ─────────
-- business_update_rsvp_graph hands every published-RSVP edit to
-- biz_update_live_rsvp(p_event_id, payload, p_reason) and relies on it for this
-- refusal. It must hold after the re-emit, by both doors.
BEGIN;
DO $h05$
DECLARE
  f record;
  v_refused boolean := false;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_rsvp_fixture('h05');
  BEGIN
    PERFORM public.business_update_rsvp_graph(f.v_event, jsonb_build_object(
        'title', 'Issue 3827 RSVP',
        'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn',
        'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '61 Wythe Avenue, Brooklyn'),
        'rsvpContributionEnabled', true,
        'rsvpContributionSuggestedCents', 1500,
        'rsvpContributionMinCents', 500),
      'Switching chip-ins on for this one', NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%stripe_charges_disabled%' THEN
      RAISE EXCEPTION 'H-05 FAIL: chip-ins on a live RSVP refused with the wrong error: % (%)', SQLERRM, SQLSTATE;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'H-05 FAIL: a live RSVP switched chip-ins ON for a brand that cannot collect';
  END IF;

  v_refused := false;
  BEGIN
    PERFORM public.biz_update_live_rsvp(f.v_event, jsonb_build_object(
        'title', 'Issue 3827 RSVP', 'rsvpContributionEnabled', true),
      'Switching chip-ins on, called directly');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%stripe_charges_disabled%' THEN
      RAISE EXCEPTION 'H-05 FAIL: the direct call refused with the wrong error: % (%)', SQLERRM, SQLSTATE;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'H-05 FAIL: biz_update_live_rsvp switched chip-ins ON for a brand that cannot collect';
  END IF;

  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF COALESCE(v_row.rsvp_contribution_enabled, false) THEN
    RAISE EXCEPTION 'H-05 FAIL: the refused edit left chip-ins on';
  END IF;
  -- The reason the graph function passes through is still accepted as given.
  IF (public.business_update_rsvp_graph(f.v_event, jsonb_build_object('title', 'Issue 3827 RSVP, renamed'),
        'Renaming the gathering', NULL) #>> '{updateResult,ok}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'H-05 FAIL: an ordinary live RSVP edit with a reason was not accepted';
  END IF;
  -- The owner sees no buyers on an RSVP nobody has answered.
  IF public.business_event_buyer_count(f.v_event) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'H-05 FAIL: an RSVP with no guests reports % buyers', public.business_event_buyer_count(f.v_event);
  END IF;
  RAISE NOTICE 'H-05 PASS: a live RSVP on a brand with no bank still refuses chip-ins with stripe_charges_disabled, by both doors';
END $h05$;
ROLLBACK;

-- ─── H-06: the SQL composer agrees with the shared parity table ──────────────
BEGIN;
DO $h06$
DECLARE
  c jsonb;
  v_got text;
  v_count integer := 0;
BEGIN
  FOR c IN SELECT value FROM jsonb_array_elements(pg_temp.issue_3827_label_cases()) LOOP
    v_got := public.business_event_location_label(c ->> 'venue', c ->> 'address');
    IF v_got IS DISTINCT FROM (c ->> 'expected') THEN
      RAISE EXCEPTION 'H-06 FAIL: case "%" composed % (expected %)',
        c ->> 'name', COALESCE(quote_literal(v_got), 'NULL'), COALESCE(quote_literal(c ->> 'expected'), 'NULL');
    END IF;
    v_count := v_count + 1;
  END LOOP;
  IF v_count < 15 THEN
    RAISE EXCEPTION 'H-06 FAIL: only % parity cases ran; the table was cut down', v_count;
  END IF;
  RAISE NOTICE 'H-06 PASS: business_event_location_label matches all % rows of the shared parity table', v_count;
END $h06$;
ROLLBACK;
