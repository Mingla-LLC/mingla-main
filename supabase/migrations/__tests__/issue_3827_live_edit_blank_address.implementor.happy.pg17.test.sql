\set ON_ERROR_STOP on

-- Issue #3827 — implementor proof that a BLANK address on a live edit means
-- "no address sent", whatever kind of blank it is.
-- Run after the full migration chain on PostgreSQL 17.
--
-- BEFORE. business_patch_event_taxonomy decided "was an address sent?" with a
-- test that only knew ordinary spaces, while the label composer
-- (business_event_location_label) decides "is this half blank?" with the full
-- set: spaces, tabs, line breaks, no-break spaces. An address of a single tab
-- or a single no-break space therefore counted as an address, and the composer
-- then stored nothing for it: the event's address was CLEARED and the label
-- lost it. An address of ordinary spaces was (correctly) left alone.
--
-- AFTER. One definition of blank, the composer's. A blank address leaves the
-- structured address, the venue and the label exactly as stored.
--
-- WHAT IS STORED FOR A REAL ADDRESS (unchanged by this fix, pinned in B-04):
-- ordinary spaces are trimmed from both ends, as they always were; any other
-- surrounding whitespace is stored as sent, and the label is composed from the
-- halves exactly as stored.
--
-- FAILS-ON-REVERT (restore the `IF v_location_text IS NULL THEN` test in
-- business_patch_event_taxonomy): B-01, B-02 and B-03 fail on the first
-- assertion each. B-04 and B-05 hold on BOTH sides: they are the guard that
-- the fix changed nothing for a real address or for ordinary spaces.
--
-- Every case executes the real functions. Each case rolls back.

-- A brand, its owner and a PUBLISHED in-person ticketed event with a venue, an
-- address and an exact pin. Published through the entry point the wizard calls.
CREATE OR REPLACE FUNCTION pg_temp.issue_3827_blank_fixture(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_revision integer)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'issue-3827-blank-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Issue 3827 blank ' || p_tag, 'issue-3827-blank-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_event, v_brand, v_user, 'Issue 3827 draft', 'issue-3827-blank-draft-' || v_event, 'event', 'draft',
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
      'hideAddressUntilTicket', false,
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '12 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')))), 1);
  UPDATE public.events SET location_geo = point(-73.9578, 40.7222), coordinate_precision = 'exact'
   WHERE id = v_event;
  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.status IS DISTINCT FROM 'scheduled'
     OR v_row.location_text IS DISTINCT FROM 'Lantern Room · 61 Wythe Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Lantern Room'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'fixture: the published event is not the shape the suite assumes (status %, label %, theme %)',
      v_row.status, v_row.location_text, v_row.theme -> 'business_event';
  END IF;
  v_revision := COALESCE((v_row.theme #>> '{business_event,clientRevision}')::integer, 0);
  RETURN NEXT;
END;
$fixture$;

-- The taxonomy block EditPublishedScreen sends, with the address text given.
-- 'chill' is added to the vibes so each case can prove the save itself landed.
CREATE OR REPLACE FUNCTION pg_temp.issue_3827_blank_taxonomy(p_location_text text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $taxonomy$
  SELECT jsonb_build_object(
    'city', 'Brooklyn',
    'partyTypes', jsonb_build_array('festival'),
    'vibeTags', jsonb_build_array('social', 'chill'),
    'musicGenres', '[]'::jsonb,
    'locationGeo', jsonb_build_object('lat', 40.7222, 'lng', -73.9578),
    'locationText', p_location_text)
$taxonomy$;

-- Raises unless the location is exactly as published and the save landed.
CREATE OR REPLACE FUNCTION pg_temp.issue_3827_blank_assert_unchanged(p_case text, p_event uuid)
RETURNS void LANGUAGE plpgsql AS $assert$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.events WHERE id = p_event;
  IF v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION '% FAIL: a blank address changed the stored address to %', p_case,
      COALESCE(quote_literal(v_row.theme #>> '{business_event,location,address}'), 'NULL');
  END IF;
  IF v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Lantern Room' THEN
    RAISE EXCEPTION '% FAIL: a blank address changed the venue to %', p_case,
      COALESCE(quote_literal(v_row.theme #>> '{business_event,location,venueName}'), 'NULL');
  END IF;
  IF v_row.location_text IS DISTINCT FROM 'Lantern Room · 61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION '% FAIL: a blank address changed the label to %', p_case,
      COALESCE(quote_literal(v_row.location_text), 'NULL');
  END IF;
  IF v_row.coordinate_precision IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION '% FAIL: the unmoved pin lost its precision (%)', p_case, v_row.coordinate_precision;
  END IF;
  IF NOT (v_row.vibe_tags @> ARRAY['chill']::text[]) THEN
    RAISE EXCEPTION '% FAIL: the save did not land (vibes %), so the case proves nothing', p_case, v_row.vibe_tags;
  END IF;
END;
$assert$;

-- ─── B-01: an address of a single TAB leaves the location alone ──────────────
BEGIN;
DO $b01$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_blank_fixture('b01');
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_blank_taxonomy(E'\t')),
    'Adding a vibe to the listing', f.v_revision + 1);
  PERFORM pg_temp.issue_3827_blank_assert_unchanged('B-01', f.v_event);
  RAISE NOTICE 'B-01 PASS: a tab-only address leaves the address, the venue and the label as stored';
END $b01$;
ROLLBACK;

-- ─── B-02: an address of a single NO-BREAK SPACE leaves the location alone ───
BEGIN;
DO $b02$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_blank_fixture('b02');
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_blank_taxonomy(chr(160))),
    'Adding a vibe to the listing', f.v_revision + 1);
  PERFORM pg_temp.issue_3827_blank_assert_unchanged('B-02', f.v_event);
  RAISE NOTICE 'B-02 PASS: a no-break-space-only address leaves the address, the venue and the label as stored';
END $b02$;
ROLLBACK;

-- ─── B-03: every mix of blank characters, straight at the taxonomy function ──
BEGIN;
DO $b03$
DECLARE
  f record;
  v_blank text;
  v_count integer := 0;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_blank_fixture('b03');
  FOREACH v_blank IN ARRAY ARRAY[
    E'\n', E'\r\n', E' \t ', chr(160) || chr(160), E'\t' || chr(160) || E' \r\n'
  ] LOOP
    PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn',
      ARRAY['festival']::text[], ARRAY['social', 'chill']::text[], ARRAY[]::text[],
      40.7222, -73.9578, v_blank, '');
    PERFORM pg_temp.issue_3827_blank_assert_unchanged('B-03 (' || quote_literal(v_blank) || ')', f.v_event);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'B-03 PASS: % kinds of blank address all mean "unchanged"', v_count;
END $b03$;
ROLLBACK;

-- ─── B-04: a REAL address keeps the storage rule it always had ───────────────
BEGIN;
DO $b04$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_blank_fixture('b04');
  -- Ordinary spaces around a real address are trimmed.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_blank_taxonomy('  250 Bedford Avenue, Brooklyn  ')),
    'Moving the night to the new room', f.v_revision + 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '250 Bedford Avenue, Brooklyn'
     OR v_row.location_text IS DISTINCT FROM 'Lantern Room · 250 Bedford Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'B-04 FAIL: a space-padded address was stored as % with label %',
      quote_literal(v_row.theme #>> '{business_event,location,address}'), quote_literal(v_row.location_text);
  END IF;
  -- Tabs around a real address: it IS an address, so it is stored. Only
  -- ordinary spaces are trimmed; the rest is kept as sent, and the label is
  -- composed from the halves exactly as stored.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_blank_taxonomy(E'\t99 Kent Avenue, Brooklyn\t')),
    'Moving the night once more', f.v_revision + 2);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM E'\t99 Kent Avenue, Brooklyn\t'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Lantern Room'
     OR v_row.location_text IS DISTINCT FROM E'Lantern Room · \t99 Kent Avenue, Brooklyn\t'
     OR v_row.location_text IS DISTINCT FROM public.business_event_location_label(
          v_row.theme #>> '{business_event,location,venueName}',
          v_row.theme #>> '{business_event,location,address}') THEN
    RAISE EXCEPTION 'B-04 FAIL: a tab-padded address was stored as % with label %',
      quote_literal(v_row.theme #>> '{business_event,location,address}'), quote_literal(v_row.location_text);
  END IF;
  RAISE NOTICE 'B-04 PASS: a real address is stored (spaces trimmed, other padding as sent) and the label is derived from it';
END $b04$;
ROLLBACK;

-- ─── B-05: ordinary spaces and an absent address still mean "unchanged" ──────
BEGIN;
DO $b05$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3827_blank_fixture('b05');
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_blank_taxonomy('   ')),
    'Adding a vibe to the listing', f.v_revision + 1);
  PERFORM pg_temp.issue_3827_blank_assert_unchanged('B-05 (spaces)', f.v_event);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_blank_taxonomy(NULL)),
    'Adding a vibe to the listing', f.v_revision + 2);
  PERFORM pg_temp.issue_3827_blank_assert_unchanged('B-05 (null)', f.v_event);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.issue_3827_blank_taxonomy('')),
    'Adding a vibe to the listing', f.v_revision + 3);
  PERFORM pg_temp.issue_3827_blank_assert_unchanged('B-05 (empty)', f.v_event);
  RAISE NOTICE 'B-05 PASS: spaces, an empty string and no address at all still leave the location as stored';
END $b05$;
ROLLBACK;
