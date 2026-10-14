\set ON_ERROR_STOP on

-- Issue #3645 — implementor proof for three migrations:
--   20270831003645  brands.payout_country (remember the payout country picked)
--   20270901003645  pg_brand_offering_counts counts RSVPs on the Events tab
--   20270902003645  business_unpublish_rsvp_to_draft
-- Run after the full migration chain on PostgreSQL 17. Every case runs the
-- real functions with the payload shape the Business app sends and rolls back,
-- so the file can also run against production inside a rolled-back
-- transaction (every fixture row supplies `created_by`).
--
-- FAILS ON THE OLD SCHEMA: H-01 (no column), H-02 (events = 0, events_draft =
-- 0) and H-03 (no such function).

-- The payload the wizard autosaves for an in-person RSVP draft
-- (draftToServerUpdate: top-level snake_case columns + theme.business_draft).
CREATE OR REPLACE FUNCTION pg_temp.rsvp_payload(p_revision integer, p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    '__expectedClientRevision', p_revision,
    'title', 'Garden RSVP',
    'description', 'Bring a friend.',
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn, New York 11249, United States',
    'online_url', NULL,
    'currency', 'USD',
    'is_online', false,
    'timezone', 'America/New_York',
    'city', 'Brooklyn',
    'theme', jsonb_build_object('coverHue', 25, 'business_draft', jsonb_build_object(
      'format', 'in_person',
      'partyTypes', jsonb_build_array('house-party'),
      'vibeTags', jsonb_build_array('chill'),
      'musicGenres', '[]'::jsonb,
      'city', 'Brooklyn',
      'requestedVisibility', 'unlisted',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char((now() + make_interval(days => p_days))::date, 'YYYY-MM-DD'),
        'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'America/New_York'),
      'location', jsonb_build_object('venueName', 'Lantern Room',
        'address', '61 Wythe Avenue, Brooklyn, New York 11249, United States'),
      'hideAddressUntilTicket', false,
      'tickets', '[]'::jsonb,
      'isRsvp', true,
      'rsvpCapacity', 40,
      'rsvpAllowPlusOnes', true,
      'rsvpPlusOnesMax', 2,
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false,
      'rsvpContributionEnabled', false,
      'rsvpContributionSuggestedCents', NULL,
      'rsvpContributionMinCents', NULL,
      'clientRevision', p_revision)))
$payload$;

-- A brand with a currency, its owner (signed in), and an empty RSVP draft.
-- `created_by` is always supplied: production has it NOT NULL.
CREATE OR REPLACE FUNCTION pg_temp.rsvp_fixture(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid)
LANGUAGE plpgsql AS $fixture$
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'i3645-bank-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Bank setup ' || p_tag, 'i3645-bank-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'Garden RSVP', 'draft-i3645-bank-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  RETURN NEXT;
END;
$fixture$;

-- Saves the draft the way the wizard does, then publishes it the way the app does.
CREATE OR REPLACE FUNCTION pg_temp.publish_rsvp(p_event uuid, p_days integer DEFAULT 30)
RETURNS void LANGUAGE plpgsql AS $pub$
BEGIN
  PERFORM public.business_update_rsvp_graph(p_event, pg_temp.rsvp_payload(1, p_days), NULL, NULL);
  PERFORM public.business_publish_rsvp_graph(p_event, gen_random_uuid());
  IF (SELECT status FROM public.events WHERE id = p_event) IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'fixture: the RSVP did not publish';
  END IF;
END;
$pub$;

-- ─── H-01: the host's pick is remembered, and only as a 2-letter code ────────
BEGIN;
DO $h01$
DECLARE f record; v_rows integer; v_value text;
BEGIN
  SELECT * INTO f FROM pg_temp.rsvp_fixture('h01');
  IF (SELECT payout_country FROM public.brands WHERE id = f.v_brand) IS NOT NULL THEN
    RAISE EXCEPTION 'H-01 FAIL: a new brand already has a payout country';
  END IF;
  -- As the signed-in owner, through RLS: the app's own brand update.
  SET LOCAL ROLE authenticated;
  UPDATE public.brands SET payout_country = 'IE', default_currency = 'EUR' WHERE id = f.v_brand;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  SELECT payout_country INTO v_value FROM public.brands WHERE id = f.v_brand;
  RESET ROLE;
  IF v_rows <> 1 OR v_value IS DISTINCT FROM 'IE' THEN
    RAISE EXCEPTION 'H-01 FAIL: the owner could not save the payout country (rows %, value %)', v_rows, v_value;
  END IF;
  -- Clearing the choice clears the column.
  SET LOCAL ROLE authenticated;
  UPDATE public.brands SET payout_country = NULL WHERE id = f.v_brand;
  RESET ROLE;
  IF (SELECT payout_country FROM public.brands WHERE id = f.v_brand) IS NOT NULL THEN
    RAISE EXCEPTION 'H-01 FAIL: the payout country could not be cleared';
  END IF;
  -- Display-only: the address and VAT countries did not move with it.
  IF (SELECT country_code FROM public.brands WHERE id = f.v_brand) IS NOT NULL
     OR (SELECT payment_country FROM public.brands WHERE id = f.v_brand) IS NOT NULL THEN
    RAISE EXCEPTION 'H-01 FAIL: saving the payout country wrote the address or VAT country';
  END IF;
  RAISE NOTICE 'H-01 PASS: the payout country is saved and cleared by the owner, and nothing else moves';
END $h01$;
ROLLBACK;

-- ─── H-02: RSVPs count towards the Hub Events tab ────────────────────────────
BEGIN;
DO $h02$
DECLARE f record; v_counts record; v_published uuid := gen_random_uuid();
BEGIN
  SELECT * INTO f FROM pg_temp.rsvp_fixture('h02');
  -- The fixture draft RSVP is the brand's only Events-tab row.
  SELECT * INTO v_counts FROM public.pg_brand_offering_counts(f.v_brand);
  IF v_counts.events <> 0 OR v_counts.events_draft <> 1 THEN
    RAISE EXCEPTION 'H-02 FAIL: a draft RSVP is not counted (events %, events_draft %)',
      v_counts.events, v_counts.events_draft;
  END IF;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_published, f.v_brand, f.v_user, 'Second RSVP', 'draft-i3645-bank-' || v_published, 'rsvp',
    'draft', 'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  PERFORM pg_temp.publish_rsvp(v_published);
  SELECT * INTO v_counts FROM public.pg_brand_offering_counts(f.v_brand);
  IF v_counts.events <> 1 OR v_counts.events_draft <> 1 THEN
    RAISE EXCEPTION 'H-02 FAIL: a published RSVP is not counted (events %, events_draft %)',
      v_counts.events, v_counts.events_draft;
  END IF;
  IF v_counts.trips <> 0 OR v_counts.experiences <> 0 OR v_counts.trips_draft <> 0
     OR v_counts.experiences_draft <> 0 THEN
    RAISE EXCEPTION 'H-02 FAIL: an RSVP was counted as a trip or an experience';
  END IF;
  RAISE NOTICE 'H-02 PASS: draft and published RSVPs count towards the Events tab only';
END $h02$;
ROLLBACK;

-- ─── H-03: publish, return to draft, publish again ───────────────────────────
BEGIN;
DO $h03$
DECLARE f record; v_result jsonb; v_row public.events%ROWTYPE; v_draft jsonb; v_slug text;
BEGIN
  SELECT * INTO f FROM pg_temp.rsvp_fixture('h03');
  PERFORM pg_temp.publish_rsvp(f.v_event);
  SELECT slug INTO v_slug FROM public.events WHERE id = f.v_event;

  v_result := public.business_unpublish_rsvp_to_draft(f.v_event);

  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status IS DISTINCT FROM 'draft' OR v_row.visibility IS DISTINCT FROM 'draft'
     OR v_row.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'H-03 FAIL: the RSVP is %/% published_at % after going back to draft',
      v_row.status, v_row.visibility, v_row.published_at;
  END IF;
  IF v_row.show_on_discover OR v_row.show_in_swipeable_deck THEN
    RAISE EXCEPTION 'H-03 FAIL: a draft RSVP is still on a discovery surface';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_dates WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'H-03 FAIL: a draft RSVP kept its published date rows';
  END IF;
  IF v_row.event_type IS DISTINCT FROM 'rsvp' OR v_row.title IS DISTINCT FROM 'Garden RSVP'
     OR v_row.description IS DISTINCT FROM 'Bring a friend.' THEN
    RAISE EXCEPTION 'H-03 FAIL: the RSVP lost its type or details';
  END IF;
  v_draft := v_row.theme->'business_draft';
  IF v_draft IS NULL OR v_row.theme ? 'business_event' THEN
    RAISE EXCEPTION 'H-03 FAIL: the wizard form was not moved back to the draft';
  END IF;
  IF v_draft#>>'{when,date}' IS DISTINCT FROM to_char((now() + interval '30 days')::date, 'YYYY-MM-DD')
     OR v_draft#>>'{when,doorsOpen}' IS DISTINCT FROM '19:00'
     OR v_draft#>>'{when,endsAt}' IS DISTINCT FROM '23:00' THEN
    RAISE EXCEPTION 'H-03 FAIL: the date did not come back (%).', v_draft->'when';
  END IF;
  IF v_draft->>'requestedVisibility' IS DISTINCT FROM 'unlisted'
     OR v_draft->'partyTypes' IS DISTINCT FROM jsonb_build_array('house-party')
     OR v_draft->'vibeTags' IS DISTINCT FROM jsonb_build_array('chill')
     OR v_draft->>'city' IS DISTINCT FROM 'Brooklyn'
     OR (v_draft->>'rsvpCapacity')::integer IS DISTINCT FROM 40
     OR (v_draft->>'rsvpAllowPlusOnes')::boolean IS DISTINCT FROM true
     OR (v_draft->>'rsvpPlusOnesMax')::integer IS DISTINCT FROM 2
     OR v_draft#>>'{location,venueName}' IS DISTINCT FROM 'Lantern Room'
     OR (v_draft->>'isRsvp')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'H-03 FAIL: the draft form is incomplete: %', v_draft;
  END IF;
  IF v_result#>>'{event,status}' IS DISTINCT FROM 'draft' OR NOT (v_result ? 'client_revision') THEN
    RAISE EXCEPTION 'H-03 FAIL: the answer does not describe the draft: %', v_result;
  END IF;
  -- It is counted as a draft again.
  IF (SELECT events_draft FROM public.pg_brand_offering_counts(f.v_brand)) <> 1
     OR (SELECT events FROM public.pg_brand_offering_counts(f.v_brand)) <> 0 THEN
    RAISE EXCEPTION 'H-03 FAIL: Hub does not count the RSVP as a draft';
  END IF;

  -- And it publishes again from what was put back, with nothing re-typed.
  PERFORM public.business_publish_rsvp_graph(f.v_event, gen_random_uuid());
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status IS DISTINCT FROM 'scheduled' OR v_row.visibility IS DISTINCT FROM 'hidden'
     OR v_row.rsvp_capacity IS DISTINCT FROM 40 OR v_row.slug IS DISTINCT FROM v_slug
     OR v_row.party_types IS DISTINCT FROM ARRAY['house-party']::text[] THEN
    RAISE EXCEPTION 'H-03 FAIL: the RSVP did not publish again as it was (%/% cap % slug %)',
      v_row.status, v_row.visibility, v_row.rsvp_capacity, v_row.slug;
  END IF;
  IF (SELECT count(*) FROM public.event_dates WHERE event_id = f.v_event) <> 1 THEN
    RAISE EXCEPTION 'H-03 FAIL: the republished RSVP does not have exactly one date';
  END IF;
  RAISE NOTICE 'H-03 PASS: an RSVP nobody has answered goes back to draft whole and publishes again';
END $h03$;
ROLLBACK;

-- ─── H-04: what a live edit changed is what comes back ───────────────────────
BEGIN;
DO $h04$
DECLARE f record; v_draft jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.rsvp_fixture('h04');
  PERFORM pg_temp.publish_rsvp(f.v_event);
  -- A live edit writes the columns; the copy kept in the theme may be older.
  UPDATE public.events SET rsvp_capacity = 75, rsvp_approval_mode = 'manual', city = 'Queens'
   WHERE id = f.v_event;
  PERFORM public.business_unpublish_rsvp_to_draft(f.v_event);
  SELECT theme->'business_draft' INTO v_draft FROM public.events WHERE id = f.v_event;
  IF (v_draft->>'rsvpCapacity')::integer IS DISTINCT FROM 75
     OR v_draft->>'rsvpApprovalMode' IS DISTINCT FROM 'manual'
     OR v_draft->>'city' IS DISTINCT FROM 'Queens' THEN
    RAISE EXCEPTION 'H-04 FAIL: the draft came back with stale values: %', v_draft;
  END IF;
  RAISE NOTICE 'H-04 PASS: the draft is rebuilt from the live columns';
END $h04$;
ROLLBACK;
