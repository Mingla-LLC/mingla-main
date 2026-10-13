\set ON_ERROR_STOP on

-- Issue #3827 — INDEPENDENT TESTER proof, the opposite axis to the implementor
-- suite. That one proves the repaired paths work (an address edit moves the
-- address, hide-address switches off, an unmoved pin keeps its precision).
-- This one attacks what the repair could have BROKEN or left open:
--
--   T-01  a venue-name-only edit never touches the address, the pin or the
--         precision; a blank venue clears only the venue half; a venue with a
--         trailing space or a " · " inside composes a label that does not move
--         again on the next identical save; a 4,000 character venue is stored.
--   T-02  the reason is owed to buyers and to nobody else: NULL and blank pass
--         with zero buyers (through the core AND the schedule leaf, so the
--         unchanged leaves really are handed a reason they accept); 9 and 201
--         characters are refused even with zero buyers; 10 and 200 pass.
--   T-03  one paid order restores `invalid_edit_reason` for a blank reason and
--         the refused save writes nothing; a real reason still saves.
--   T-04  the single definition of "buyer", state by state: refunded-only,
--         cancelled, pending and failed orders, void and refunded tickets, and
--         going-but-unapproved, waitlisted, maybe and declined RSVPs are zero;
--         a partial refund, a ticket awaiting refund, a transferred or used
--         ticket and an approved going RSVP are not.
--   T-05  Ari's whole-location patch (`address` with no `venueName`) through
--         the atomic owner replaces the whole location in the shape Ari create
--         writes; with both keys each half lands where it was sent.
--   T-06  a caller without the event permission learns nothing from the buyer
--         count and is refused by the edit whether or not they typed a reason;
--         a signed-out caller is refused; the internal helpers are not
--         executable by a client role and the edit functions kept their grants.
--   T-07  theme shapes: no `location` object (the label seeds the venue), no
--         `business_event` namespace at all, and a NULL address meaning
--         "unchanged" (row byte-identical apart from the taxonomy columns).
--   T-08  precision: a valid token on an unmoved pin wins; an unrecognised
--         token on an unmoved pin keeps what is stored; an unrecognised token
--         on a moved pin stores none; a first pin with no token stores none.
--   T-09  hide-address composes with a venue edit and a format edit in ONE
--         patch, and works on a row that has no `settings` object.
--   T-10  the live RSVP door: without a `location` key it behaves as before
--         with the reason the graph function hands it; an identical `location`
--         is not a material change (no guest is notified for nothing) and a
--         changed one is; a blank reason passes only with no going guests; the
--         graph function itself still demands a reason (untouched by ruling).
--   T-11  the visibility and refund-terms functions still refuse a blank
--         reason on an event with no buyers (untouched by ruling).
--   T-12  the composer is strict about what "blank" means and about NULL.
--
-- FAILS-ON-REVERT (replay the chain without 20270828003827): T-01 fails on its
-- first assertion (the venue edit overwrites the label with one half) and every
-- other case that calls a #3827 helper fails because the helper does not exist.
--
-- Run after the full migration chain on PostgreSQL 17. Each case rolls back.

-- A brand, its owner and a PUBLISHED in-person ticketed event with a venue, an
-- address, an exact pin and hide-address on, published through the entry point
-- the wizard calls. Returns the free tier's id for the buyer cases.
CREATE OR REPLACE FUNCTION pg_temp.t3827_event(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_revision integer, v_tier uuid)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827 ' || p_tag, 't3827-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_event, v_brand, v_user, 'T3827 draft', 't3827-draft-' || v_event, 'event', 'draft',
    'draft', 'America/New_York');
  PERFORM public.issue_1719_publish_event_with_poster(v_event, jsonb_build_object(
    'title', 'T3827 night',
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
  SELECT tt.id INTO v_tier FROM public.ticket_types AS tt
   WHERE tt.event_id = v_event AND tt.deleted_at IS NULL ORDER BY tt.created_at LIMIT 1;
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'fixture: the published event has no ticket tier';
  END IF;
  RETURN NEXT;
END;
$fixture$;

-- The taxonomy block the editor sends. p_precision NULL sends no token at all.
CREATE OR REPLACE FUNCTION pg_temp.t3827_taxonomy(
  p_lat numeric, p_lng numeric, p_location_text text, p_precision text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $taxonomy$
  SELECT jsonb_build_object(
    'city', 'Brooklyn',
    'partyTypes', jsonb_build_array('festival'),
    'vibeTags', jsonb_build_array('social'),
    'musicGenres', '[]'::jsonb,
    'locationGeo', CASE WHEN p_lat IS NULL THEN 'null'::jsonb
                        ELSE jsonb_build_object('lat', p_lat, 'lng', p_lng) END,
    'locationText', p_location_text)
    || CASE WHEN p_precision IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('coordinatePrecision', p_precision) END
$taxonomy$;

-- An order and/or a ticket in a given state, written as stored rows: the buyer
-- count reads STORED state, and this suite is about which stored states count.
CREATE OR REPLACE FUNCTION pg_temp.t3827_order(
  p_event uuid, p_tier uuid, p_payment_status text, p_cancelled boolean, p_ticket_status text)
RETURNS uuid LANGUAGE plpgsql AS $order$
DECLARE
  v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
                            payment_method, payment_status, source, cancelled_at)
  VALUES (v_order, p_event, 't3827-' || v_order || '@example.test', 'T3827 Buyer', '+15550003827', 0,
          'free', p_payment_status, 'online_checkout', CASE WHEN p_cancelled THEN now() END);
  IF p_ticket_status IS NOT NULL THEN
    INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status)
    VALUES (gen_random_uuid(), v_order, p_tier, p_event, 'mingla:v1:ticket:' || gen_random_uuid()::text,
            md5(gen_random_uuid()::text), p_ticket_status, 'auto');
  END IF;
  RETURN v_order;
END;
$order$;

CREATE OR REPLACE FUNCTION pg_temp.t3827_rsvp_guest(
  p_event uuid, p_rsvp_status text, p_approval_status text)
RETURNS uuid LANGUAGE plpgsql AS $guest$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_id, p_event, 'T3827 Guest', 't3827-' || v_id || '@example.test', '+15550003827',
          p_rsvp_status, p_approval_status);
  RETURN v_id;
END;
$guest$;

-- A brand with no bank, its owner, and a PUBLISHED in-person RSVP.
CREATE OR REPLACE FUNCTION pg_temp.t3827_rsvp(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827-rsvp-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827 RSVP ' || p_tag, 't3827-rsvp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'T3827 RSVP', 't3827-rsvp-draft-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  PERFORM public.business_update_rsvp_graph(v_event, jsonb_build_object(
    '__expectedClientRevision', 1,
    'title', 'T3827 RSVP',
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
     OR v_row.location_text IS DISTINCT FROM 'Lantern Room · 61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'fixture: the published RSVP is not the shape the suite assumes (status %, label %)',
      v_row.status, v_row.location_text;
  END IF;
  RETURN NEXT;
END;
$fixture$;

-- Runs the atomic owner and returns the error text, or NULL when it saved.
CREATE OR REPLACE FUNCTION pg_temp.t3827_try_atomic(
  p_event uuid, p_patch jsonb, p_reason text, p_revision integer)
RETURNS text LANGUAGE plpgsql AS $try$
BEGIN
  PERFORM public.business_update_live_event_atomic(p_event, p_patch, p_reason, p_revision);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$try$;

-- ─── T-01: a venue-name-only edit touches the venue and nothing else ──────────
BEGIN;
DO $t01$
DECLARE
  f record;
  v_before public.events%ROWTYPE;
  v_row public.events%ROWTYPE;
  v_label text;
  v_long text := repeat('Very Long Venue Name ', 200);
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t01');
  SELECT * INTO v_before FROM public.events WHERE id = f.v_event;

  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'Correcting the name of the venue', f.v_revision + 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'The Bedford Hall · 61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'T-01 FAIL: a venue-name-only edit left the label "%" (the address half was dropped or the venue did not move)',
      v_row.location_text;
  END IF;
  IF v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'T-01 FAIL: a venue-name-only edit changed the structured address to %',
      v_row.theme #> '{business_event,location,address}';
  END IF;
  IF v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'The Bedford Hall' THEN
    RAISE EXCEPTION 'T-01 FAIL: the structured venue is %', v_row.theme #> '{business_event,location,venueName}';
  END IF;
  IF NOT (v_row.location_geo ~= v_before.location_geo)
     OR v_row.coordinate_precision IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION 'T-01 FAIL: a venue-name-only edit moved the pin or its precision (% / %)',
      v_row.location_geo, v_row.coordinate_precision;
  END IF;
  IF (v_row.theme #>> '{business_event,hideAddressUntilTicket}')::boolean IS DISTINCT FROM true
     OR v_row.theme #>> '{business_event,format}' IS DISTINCT FROM 'in_person' THEN
    RAISE EXCEPTION 'T-01 FAIL: a venue edit disturbed a sibling theme key (%)', v_row.theme -> 'business_event';
  END IF;

  -- A trailing space (production has "Didi Museum ") and a separator inside the
  -- name. The label is the halves as stored, and saving the same name again
  -- must not move it: a label that drifts on every save is a phantom change.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Didi Museum ')),
    'Venue name as the host typed it', f.v_revision + 2);
  SELECT location_text INTO v_label FROM public.events WHERE id = f.v_event;
  IF v_label IS DISTINCT FROM 'Didi Museum  · 61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'T-01 FAIL: a venue with a trailing space composed "%"', v_label;
  END IF;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Didi Museum ')),
    'Saving the very same name again', f.v_revision + 3);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.t3827_taxonomy(40.7222, -73.9578, '61 Wythe Avenue, Brooklyn')),
    'Saving the very same address again', f.v_revision + 4);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM v_label
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Didi Museum ' THEN
    RAISE EXCEPTION 'T-01 FAIL: re-saving an unchanged venue and address moved the label from "%" to "%"',
      v_label, v_row.location_text;
  END IF;

  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room · Two')),
    'A venue whose name has the separator', f.v_revision + 5);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'Room · Two · 61 Wythe Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Room · Two'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'T-01 FAIL: a separator inside the venue name was split across the halves (label "%", halves %)',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;

  -- A blank venue clears the venue half only.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', E' \t ')),
    'Removing the venue name entirely', f.v_revision + 6);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM '61 Wythe Avenue, Brooklyn'
     OR v_row.theme #> '{business_event,location,venueName}' IS DISTINCT FROM 'null'::jsonb
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'T-01 FAIL: a blank venue did not clear just the venue (label "%", halves %)',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;

  -- A very long venue is stored whole in both copies.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', v_long)),
    'A very long venue name indeed', f.v_revision + 7);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM v_long
     OR v_row.location_text IS DISTINCT FROM v_long || ' · 61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'T-01 FAIL: a long venue name was cut or lost (label length %)', length(v_row.location_text);
  END IF;
  RAISE NOTICE 'T-01 PASS: a venue-name-only edit keeps the address, the pin and its precision, and the label does not drift';
END $t01$;
ROLLBACK;

-- ─── T-02: with no buyers the reason is optional, but never malformed ─────────
BEGIN;
DO $t02$
DECLARE
  f record;
  v_err text;
  v_row public.events%ROWTYPE;
  v_rev integer;
  v_new_date text := to_char(now() + interval '20 days', 'YYYY-MM-DD');
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t02');
  v_rev := f.v_revision;
  IF public.business_event_buyer_count(f.v_event) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'T-02 FAIL: a freshly published event reports % buyers', public.business_event_buyer_count(f.v_event);
  END IF;

  -- NULL reason, and the save reaches the core AND the schedule leaf. Both keep
  -- their own unconditional 10..200 check, so this only passes if the atomic
  -- owner hands them the resolved reason and not the raw one.
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object(
      'core', jsonb_build_object('name', 'T3827 night, renamed'),
      'when', jsonb_build_object('whenMode', 'single', 'timezone', 'America/New_York',
        'when', jsonb_build_object('date', v_new_date, 'doorsOpen', '21:00', 'endsAt', '23:30'))),
    NULL, v_rev + 1);
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'T-02 FAIL: a NULL reason on an event with no buyers was refused: %', v_err;
  END IF;
  v_rev := v_rev + 1;
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.title IS DISTINCT FROM 'T3827 night, renamed' THEN
    RAISE EXCEPTION 'T-02 FAIL: the save with a NULL reason did not write the title (%)', v_row.title;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_dates AS d
                  WHERE d.event_id = f.v_event
                    AND (d.start_at AT TIME ZONE 'America/New_York')::date = v_new_date::date) THEN
    RAISE EXCEPTION 'T-02 FAIL: the schedule leaf did not move the date on a save with a NULL reason';
  END IF;

  -- Blank and space-only are the same as NULL.
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'T3827 blank reason')), '', v_rev + 1);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION 'T-02 FAIL: an empty reason with no buyers was refused: %', v_err; END IF;
  v_rev := v_rev + 1;
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'T3827 spaces reason')), '     ', v_rev + 1);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION 'T-02 FAIL: a spaces-only reason with no buyers was refused: %', v_err; END IF;
  v_rev := v_rev + 1;

  -- A reason the host DID type is held to 10..200 even with no buyers: the
  -- relaxation is for "nothing typed", not for "something too short".
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'T3827 nine')), '123456789', v_rev + 1);
  IF v_err IS NULL OR v_err NOT LIKE '%invalid_edit_reason%' THEN
    RAISE EXCEPTION 'T-02 FAIL: a 9 character reason with no buyers was not refused as invalid_edit_reason (%)', v_err;
  END IF;
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'T3827 two-oh-one')), repeat('x', 201), v_rev + 1);
  IF v_err IS NULL OR v_err NOT LIKE '%invalid_edit_reason%' THEN
    RAISE EXCEPTION 'T-02 FAIL: a 201 character reason with no buyers was not refused as invalid_edit_reason (%)', v_err;
  END IF;
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.title IS DISTINCT FROM 'T3827 spaces reason' THEN
    RAISE EXCEPTION 'T-02 FAIL: a refused save still wrote the title (%)', v_row.title;
  END IF;

  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'T3827 ten')), '  1234567890  ', v_rev + 1);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION 'T-02 FAIL: a 10 character reason was refused: %', v_err; END IF;
  v_rev := v_rev + 1;
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'T3827 two hundred')), repeat('y', 200), v_rev + 1);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION 'T-02 FAIL: a 200 character reason was refused: %', v_err; END IF;

  -- The resolver itself, at the boundaries, on the same zero-buyer event.
  IF public.business_resolve_edit_reason(f.v_event, NULL) IS DISTINCT FROM 'No buyers at time of edit; no reason given'
     OR public.business_resolve_edit_reason(f.v_event, '   ') IS DISTINCT FROM 'No buyers at time of edit; no reason given'
     OR public.business_resolve_edit_reason(f.v_event, '123456789') IS NOT NULL
     OR public.business_resolve_edit_reason(f.v_event, ' 1234567890 ') IS DISTINCT FROM '1234567890'
     OR public.business_resolve_edit_reason(f.v_event, repeat('z', 200)) IS DISTINCT FROM repeat('z', 200)
     OR public.business_resolve_edit_reason(f.v_event, repeat('z', 201)) IS NOT NULL THEN
    RAISE EXCEPTION 'T-02 FAIL: the reason resolver is wrong at a boundary with zero buyers';
  END IF;
  -- The constant must itself be a reason every unchanged leaf accepts.
  IF length('No buyers at time of edit; no reason given') NOT BETWEEN 10 AND 200 THEN
    RAISE EXCEPTION 'T-02 FAIL: the no-buyers constant is not a 10..200 character reason';
  END IF;
  RAISE NOTICE 'T-02 PASS: NULL, empty and spaces-only reasons save with no buyers through every leaf; 9 and 201 characters are still refused';
END $t02$;
ROLLBACK;

-- ─── T-03: one paid order makes the reason mandatory again ────────────────────
BEGIN;
DO $t03$
DECLARE
  f record;
  v_err text;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t03');
  PERFORM pg_temp.t3827_order(f.v_event, f.v_tier, 'paid', false, 'valid');
  IF public.business_event_buyer_count(f.v_event) = 0 THEN
    RAISE EXCEPTION 'T-03 FAIL: an event with a paid order and a valid ticket reports no buyers';
  END IF;

  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'Renamed behind a buyer''s back', 'venueName', 'Somewhere Else'),
      'taxonomy', pg_temp.t3827_taxonomy(40.7081, -73.9571, '250 Bedford Avenue, Brooklyn', 'approximate')),
    NULL, f.v_revision + 1);
  IF v_err IS NULL OR v_err NOT LIKE '%invalid_edit_reason%' THEN
    RAISE EXCEPTION 'T-03 FAIL: a NULL reason on an event WITH a buyer was not refused as invalid_edit_reason (%)', v_err;
  END IF;
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'Renamed behind a buyer''s back')), '   ', f.v_revision + 1);
  IF v_err IS NULL OR v_err NOT LIKE '%invalid_edit_reason%' THEN
    RAISE EXCEPTION 'T-03 FAIL: a spaces-only reason on an event WITH a buyer was not refused (%)', v_err;
  END IF;
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'Renamed behind a buyer''s back')), '123456789', f.v_revision + 1);
  IF v_err IS NULL OR v_err NOT LIKE '%invalid_edit_reason%' THEN
    RAISE EXCEPTION 'T-03 FAIL: a 9 character reason on an event WITH a buyer was not refused (%)', v_err;
  END IF;

  -- The refusals wrote nothing: title, both location copies, pin and revision.
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.title IS DISTINCT FROM 'T3827 night'
     OR v_row.location_text IS DISTINCT FROM 'Lantern Room · 61 Wythe Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Lantern Room'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn'
     OR NOT (v_row.location_geo ~= point(-73.9578, 40.7222))
     OR COALESCE((v_row.theme #>> '{business_event,clientRevision}')::integer, 0) IS DISTINCT FROM f.v_revision THEN
    RAISE EXCEPTION 'T-03 FAIL: a refused save left a partial write (title %, label %, revision %)',
      v_row.title, v_row.location_text, v_row.theme #> '{business_event,clientRevision}';
  END IF;
  IF public.business_resolve_edit_reason(f.v_event, NULL) IS NOT NULL
     OR public.business_resolve_edit_reason(f.v_event, '') IS NOT NULL
     OR public.business_resolve_edit_reason(f.v_event, '1234567890') IS DISTINCT FROM '1234567890'
     OR public.business_resolve_edit_reason(f.v_event, repeat('z', 201)) IS NOT NULL THEN
    RAISE EXCEPTION 'T-03 FAIL: the reason resolver is wrong at a boundary with one buyer';
  END IF;

  -- A real reason still saves, exactly as it did before.
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'Renamed, and the buyers were told why')),
    'The headliner changed, see the new poster', f.v_revision + 1);
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'T-03 FAIL: a real reason on an event with a buyer was refused: %', v_err;
  END IF;
  RAISE NOTICE 'T-03 PASS: one paid order restores invalid_edit_reason for a blank reason, and the refused save writes nothing';
END $t03$;
ROLLBACK;

-- ─── T-04: which stored states are buyers ─────────────────────────────────────
BEGIN;
DO $t04$
DECLARE
  f record;
  o record;
  b record;
  s record;
  v_count integer;
  v_guest uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t04');
  SELECT * INTO o FROM pg_temp.t3827_event('t04-other');
  -- The count is asked as the FIRST event's owner from here on.
  PERFORM set_config('request.jwt.claim.sub', f.v_user::text, true);

  -- NOT buyers. Each is added and left in place, so the states also have to
  -- stay at zero in combination.
  PERFORM pg_temp.t3827_order(f.v_event, f.v_tier, 'refunded', false, 'refunded');
  PERFORM pg_temp.t3827_order(f.v_event, f.v_tier, 'refunded', false, 'void');
  PERFORM pg_temp.t3827_order(f.v_event, f.v_tier, 'cancelled', true, 'void');
  PERFORM pg_temp.t3827_order(f.v_event, f.v_tier, 'paid', true, 'void');       -- paid, then cancelled
  PERFORM pg_temp.t3827_order(f.v_event, f.v_tier, 'pending', false, NULL);     -- a checkout nobody finished
  PERFORM pg_temp.t3827_order(f.v_event, f.v_tier, 'failed', false, NULL);
  PERFORM pg_temp.t3827_rsvp_guest(f.v_event, 'going', 'pending');              -- going, not approved
  PERFORM pg_temp.t3827_rsvp_guest(f.v_event, 'going', 'denied');
  PERFORM pg_temp.t3827_rsvp_guest(f.v_event, 'waitlisted', 'approved');
  PERFORM pg_temp.t3827_rsvp_guest(f.v_event, 'maybe', 'approved');
  PERFORM pg_temp.t3827_rsvp_guest(f.v_event, 'not_going', 'approved');
  -- A buyer of ANOTHER event is not a buyer of this one.
  PERFORM pg_temp.t3827_order(o.v_event, o.v_tier, 'paid', false, 'valid');
  v_count := public.business_event_buyer_count(f.v_event);
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'T-04 FAIL: refunded, cancelled, pending and failed orders, void and refunded tickets and unapproved or not-going RSVPs counted as % buyers (expected 0)', v_count;
  END IF;
  -- And so a blank reason is still accepted for it.
  IF public.business_resolve_edit_reason(f.v_event, NULL) IS NULL THEN
    RAISE EXCEPTION 'T-04 FAIL: an event with only refunded and cancelled sales still demands a reason';
  END IF;

  -- Buyers, one state at a time, each on its own freshly published event so no
  -- state can hide behind another. A live ticket counts even when its order row
  -- does not (a refunded order with one ticket still awaiting its refund, a
  -- transfer, a scanned ticket), and a paid order counts with no ticket row.
  FOR s IN
    SELECT * FROM (VALUES
      ('partial_refund', NULL::text,        'a partly refunded order'),
      ('paid',           NULL::text,        'a paid order with no ticket row'),
      ('refunded',       'refund_pending',  'a ticket still awaiting its refund'),
      ('pending',        'transferred',     'a transferred ticket'),
      ('pending',        'used',            'a used ticket'),
      ('pending',        'valid',           'a valid ticket on an unpaid order')
    ) AS v(payment_status, ticket_status, label)
  LOOP
    SELECT * INTO b FROM pg_temp.t3827_event('t04-' || replace(s.label, ' ', '-'));
    IF public.business_event_buyer_count(b.v_event) IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'T-04 FAIL: a fresh event reports buyers before "%" was added', s.label;
    END IF;
    PERFORM pg_temp.t3827_order(b.v_event, b.v_tier, s.payment_status, false, s.ticket_status);
    IF public.business_event_buyer_count(b.v_event) = 0 THEN
      RAISE EXCEPTION 'T-04 FAIL: % is not counted as a buyer', s.label;
    END IF;
    IF public.business_resolve_edit_reason(b.v_event, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'T-04 FAIL: an event with % accepts a blank reason', s.label;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', f.v_user::text, true);
  v_guest := pg_temp.t3827_rsvp_guest(f.v_event, 'going', 'approved');
  IF public.business_event_buyer_count(f.v_event) = 0 THEN
    RAISE EXCEPTION 'T-04 FAIL: an approved going RSVP is not counted as a buyer';
  END IF;
  IF public.business_resolve_edit_reason(f.v_event, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'T-04 FAIL: an event with an approved going guest accepts a blank reason';
  END IF;
  RAISE NOTICE 'T-04 PASS: refunded-only, cancelled, pending, failed, void and unapproved are zero; partial refund, live tickets and approved going guests are buyers';
END $t04$;
ROLLBACK;

-- ─── T-05: Ari's whole-location patch through the atomic owner ────────────────
BEGIN;
DO $t05$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t05');
  -- ari_execute_event_operation's update_event sends core.address and never
  -- core.venueName: the text is the WHOLE location.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('address', 'Brooklyn Steel, 319 Frost Street')),
    'Ari moved the night to another hall', f.v_revision + 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'Brooklyn Steel, 319 Frost Street' THEN
    RAISE EXCEPTION 'T-05 FAIL: Ari''s location replace left the label "%" (the old venue or address survived in it)',
      v_row.location_text;
  END IF;
  IF v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Brooklyn Steel, 319 Frost Street'
     OR v_row.theme #> '{business_event,location,address}' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'T-05 FAIL: Ari''s location replace left the structured halves % — the editor and the public page read these first',
      v_row.theme #> '{business_event,location}';
  END IF;
  IF v_row.location_text IS DISTINCT FROM public.business_event_location_label(
       v_row.theme #>> '{business_event,location,venueName}',
       v_row.theme #>> '{business_event,location,address}') THEN
    RAISE EXCEPTION 'T-05 FAIL: after Ari''s edit the label and the structured halves disagree';
  END IF;

  -- The host then re-picks an address in the editor: it becomes the address
  -- half and Ari's text stays as the venue.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb,
      'taxonomy', pg_temp.t3827_taxonomy(40.7195, -73.9387, '319 Frost Street, Brooklyn', 'exact')),
    'Pinning the exact street address', f.v_revision + 2);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'Brooklyn Steel, 319 Frost Street · 319 Frost Street, Brooklyn' THEN
    RAISE EXCEPTION 'T-05 FAIL: an address edit after Ari''s replace composed "%"', v_row.location_text;
  END IF;

  -- Both keys in one core patch: each half lands where it was sent.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Elsewhere', 'address', '599 Johnson Avenue')),
    'Both halves sent in one patch', f.v_revision + 3);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'Elsewhere · 599 Johnson Avenue'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Elsewhere'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '599 Johnson Avenue' THEN
    RAISE EXCEPTION 'T-05 FAIL: a patch with both halves stored label "%" and halves %',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;

  -- An empty Ari address clears the location rather than leaving a stale half.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('address', '')),
    'Ari cleared the location entirely', f.v_revision + 4);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS NOT NULL
     OR v_row.theme #>> '{business_event,location,venueName}' IS NOT NULL
     OR v_row.theme #>> '{business_event,location,address}' IS NOT NULL THEN
    RAISE EXCEPTION 'T-05 FAIL: an empty whole-location patch left label "%" and halves %',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;
  RAISE NOTICE 'T-05 PASS: Ari''s address-only patch replaces the whole location in both copies';
END $t05$;
ROLLBACK;

-- ─── T-06: who may ask, and who may edit ──────────────────────────────────────
BEGIN;
DO $t06$
DECLARE
  f record;
  v_stranger uuid := gen_random_uuid();
  v_err text;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t06');
  INSERT INTO auth.users(id, email) VALUES (v_stranger, 't3827-stranger-' || v_stranger || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_stranger);

  -- Privileges, read from the catalogue.
  IF has_function_privilege('anon', 'public.business_event_buyer_count(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.business_event_buyer_count(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-06 FAIL: business_event_buyer_count must be callable by authenticated and not by anon';
  END IF;
  IF has_function_privilege('anon', 'public.business_resolve_edit_reason(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.business_resolve_edit_reason(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.business_event_theme_with_location(jsonb, text, boolean, text, boolean, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.business_event_theme_with_location(jsonb, text, boolean, text, boolean, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.business_event_location_label(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.business_event_location_label(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-06 FAIL: an internal #3827 helper is executable by a client role';
  END IF;
  -- The re-emitted functions kept exactly the grants they had.
  IF has_function_privilege('anon', 'public.business_update_live_event_atomic(uuid, jsonb, text, integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.business_update_live_event_atomic(uuid, jsonb, text, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.business_update_live_event(uuid, jsonb, text, integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.business_update_live_event(uuid, jsonb, text, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.business_update_live_event(uuid, jsonb, text, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.business_patch_event_taxonomy(uuid, text, text[], text[], text[], numeric, numeric, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.business_patch_event_taxonomy(uuid, text, text[], text[], text[], numeric, numeric, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.biz_update_live_rsvp(uuid, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-06 FAIL: a re-emitted live-edit function changed who may execute it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('business_patch_event_taxonomy', 'business_update_live_event',
                                  'business_update_live_event_atomic', 'biz_update_live_rsvp',
                                  'business_event_buyer_count')
                AND (NOT p.prosecdef
                     OR NOT (p.proconfig @> ARRAY['search_path=public, pg_temp']))) THEN
    RAISE EXCEPTION 'T-06 FAIL: a live-edit function lost SECURITY DEFINER or its pinned search_path';
  END IF;

  -- A signed-in stranger with no role on the brand.
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  BEGIN
    PERFORM public.business_event_buyer_count(f.v_event);
    RAISE EXCEPTION 'T-06 FAIL: a stranger was told how many buyers another brand''s event has';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%insufficient_event_permission%' THEN
      RAISE EXCEPTION 'T-06 FAIL: the stranger''s buyer count was refused with the wrong answer: %', SQLERRM;
    END IF;
  END;
  -- With no reason typed the edit must be REFUSED, not waved through as a
  -- zero-buyer edit; and a typed reason does not buy permission either.
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Stranger''s venue')), NULL, f.v_revision + 1);
  IF v_err IS NULL OR v_err NOT LIKE '%insufficient_event_permission%' THEN
    RAISE EXCEPTION 'T-06 FAIL: a stranger''s edit with no reason was not refused for permission (%)', v_err;
  END IF;
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Stranger''s venue')),
    'A perfectly good reason, no permission', f.v_revision + 1);
  IF v_err IS NULL OR v_err NOT LIKE '%insufficient_event_permission%' THEN
    RAISE EXCEPTION 'T-06 FAIL: a stranger''s edit with a reason was not refused for permission (%)', v_err;
  END IF;
  BEGIN
    PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
      ARRAY[]::text[], 40.7081, -73.9571, 'Stranger''s address', 'exact');
    RAISE EXCEPTION 'T-06 FAIL: a stranger moved another brand''s address';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%insufficient_event_permission%' THEN
      RAISE EXCEPTION 'T-06 FAIL: the stranger''s address edit was refused with the wrong answer: %', SQLERRM;
    END IF;
  END;

  -- Signed out.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.business_event_buyer_count(f.v_event);
    RAISE EXCEPTION 'T-06 FAIL: a signed-out caller was given a buyer count';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not_authenticated%' THEN
      RAISE EXCEPTION 'T-06 FAIL: the signed-out buyer count was refused with the wrong answer: %', SQLERRM;
    END IF;
  END;
  v_err := pg_temp.t3827_try_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Nobody''s venue')), NULL, f.v_revision + 1);
  IF v_err IS NULL OR v_err NOT LIKE '%not_authenticated%' THEN
    RAISE EXCEPTION 'T-06 FAIL: a signed-out edit with no reason was not refused as not_authenticated (%)', v_err;
  END IF;

  -- An event that does not exist tells the owner nothing either.
  PERFORM set_config('request.jwt.claim.sub', f.v_user::text, true);
  BEGIN
    PERFORM public.business_event_buyer_count(gen_random_uuid());
    RAISE EXCEPTION 'T-06 FAIL: a buyer count was returned for an event that does not exist';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%event_not_found%' THEN
      RAISE EXCEPTION 'T-06 FAIL: an unknown event was refused with the wrong answer: %', SQLERRM;
    END IF;
  END;

  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'Lantern Room · 61 Wythe Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Lantern Room' THEN
    RAISE EXCEPTION 'T-06 FAIL: a refused caller changed the location (%)', v_row.location_text;
  END IF;
  RAISE NOTICE 'T-06 PASS: strangers and signed-out callers get no count and no edit; helpers are internal; grants are unchanged';
END $t06$;
ROLLBACK;

-- ─── T-07: theme shapes the merge must survive ────────────────────────────────
BEGIN;
DO $t07$
DECLARE
  f record;
  v_before public.events%ROWTYPE;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t07');

  -- (a) A NULL address means "unchanged": the theme and the label are
  --     byte-identical afterwards, through the door authenticated callers have.
  SELECT * INTO v_before FROM public.events WHERE id = f.v_event;
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social', 'chill'],
    ARRAY[]::text[], 40.7222, -73.9578, NULL, '');
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social', 'chill'],
    ARRAY[]::text[], 40.7222, -73.9578, '    ', '');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme IS DISTINCT FROM v_before.theme
     OR v_row.location_text IS DISTINCT FROM v_before.location_text
     OR v_row.coordinate_precision IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION 'T-07 FAIL: a NULL or spaces-only address was not "unchanged" (label "%", precision %)',
      v_row.location_text, v_row.coordinate_precision;
  END IF;

  -- (b) No `location` object: the label is all there is, so it becomes the
  --     venue and the new address is added beside it. Nothing is lost.
  UPDATE public.events
     SET theme = theme #- '{business_event,location}', location_text = 'The Old Label'
   WHERE id = f.v_event;
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], NULL, NULL, '250 Bedford Avenue, Brooklyn', '');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '250 Bedford Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'The Old Label'
     OR v_row.location_text IS DISTINCT FROM 'The Old Label · 250 Bedford Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'T-07 FAIL: on a theme with no location object the address edit stored label "%" and halves %',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;
  IF v_row.theme #>> '{business_event,format}' IS DISTINCT FROM 'in_person'
     OR (v_row.theme #>> '{business_event,clientRevision}')::integer IS DISTINCT FROM f.v_revision THEN
    RAISE EXCEPTION 'T-07 FAIL: creating the location object disturbed a sibling key (%)', v_row.theme -> 'business_event';
  END IF;
  -- No new coordinate was sent: the pin and its precision are the stored ones.
  IF NOT (v_row.location_geo ~= point(-73.9578, 40.7222)) OR v_row.coordinate_precision IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION 'T-07 FAIL: an address edit with no pin moved the pin or its precision (% / %)',
      v_row.location_geo, v_row.coordinate_precision;
  END IF;

  -- (c) No `business_event` namespace at all (a jsonb_set would be a silent
  --     no-op here): the address still lands, and other theme keys survive.
  UPDATE public.events
     SET theme = jsonb_build_object('coverHue', 200, 'somethingElse', jsonb_build_object('keep', true)),
         location_text = NULL
   WHERE id = f.v_event;
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], NULL, NULL, '61 Wythe Avenue, Brooklyn', '');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS NOT NULL
     OR v_row.location_text IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'T-07 FAIL: on a theme with no business_event namespace the address edit stored label "%" and theme %',
      v_row.location_text, v_row.theme;
  END IF;
  IF (v_row.theme ->> 'coverHue')::integer IS DISTINCT FROM 200
     OR (v_row.theme #>> '{somethingElse,keep}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T-07 FAIL: creating the namespace dropped an unrelated theme key (%)', v_row.theme;
  END IF;

  -- (d) The merge helper on shapes that are not objects at all.
  IF public.business_event_theme_with_location('[]'::jsonb, NULL, true, 'V', true, 'A') #> '{business_event,location}'
       IS DISTINCT FROM jsonb_build_object('venueName', 'V', 'address', 'A')
     OR public.business_event_theme_with_location('{"business_event":"oops"}'::jsonb, NULL, true, 'V', false, NULL)
          #> '{business_event,location}' IS DISTINCT FROM jsonb_build_object('venueName', 'V')
     OR public.business_event_theme_with_location('{"business_event":{"location":[1,2]}}'::jsonb, 'L', false, NULL, true, 'A')
          #> '{business_event,location}' IS DISTINCT FROM jsonb_build_object('venueName', 'L', 'address', 'A')
     OR public.business_event_theme_with_location('{"a":1}'::jsonb, 'L', false, 'V', false, 'A')
          IS DISTINCT FROM '{"a":1}'::jsonb
     OR public.business_event_theme_with_location(NULL, 'L', NULL, 'V', NULL, 'A') IS NOT NULL THEN
    RAISE EXCEPTION 'T-07 FAIL: the theme merge is wrong on a non-object theme, namespace or location, or is not a no-op with neither flag';
  END IF;
  RAISE NOTICE 'T-07 PASS: NULL means unchanged, and the merge creates a missing location object or namespace without losing a sibling';
END $t07$;
ROLLBACK;

-- ─── T-08: precision tokens, moved and unmoved ────────────────────────────────
BEGIN;
DO $t08$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t08');

  -- Unmoved pin, unrecognised token: the stored precision is kept.
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], 40.7222, -73.9578, NULL, 'rooftop');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.coordinate_precision IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION 'T-08 FAIL: an unrecognised token on an unmoved pin left precision %', v_row.coordinate_precision;
  END IF;
  -- Unmoved pin, valid token: the token wins (the host re-picked the same place
  -- and the picker now knows it is only approximate).
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], 40.7222, -73.9578, NULL, ' approximate ');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.coordinate_precision IS DISTINCT FROM 'approximate' THEN
    RAISE EXCEPTION 'T-08 FAIL: a valid token on an unmoved pin was ignored (precision %)', v_row.coordinate_precision;
  END IF;
  -- Moved pin, unrecognised token: none is stored, and the old one is NOT kept.
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], 40.7081, -73.9571, NULL, 'rooftop');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.coordinate_precision IS NOT NULL OR NOT (v_row.location_geo ~= point(-73.9571, 40.7081)) THEN
    RAISE EXCEPTION 'T-08 FAIL: a moved pin with an unrecognised token stored precision % at %',
      v_row.coordinate_precision, v_row.location_geo;
  END IF;
  -- No pin sent: the stored pin and its (now unknown) precision stay.
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], NULL, NULL, NULL, 'exact');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.coordinate_precision IS NOT NULL OR NOT (v_row.location_geo ~= point(-73.9571, 40.7081)) THEN
    RAISE EXCEPTION 'T-08 FAIL: a token with no pin changed the precision (%) or the pin (%)',
      v_row.coordinate_precision, v_row.location_geo;
  END IF;
  -- A first pin on an event that had none, with no token: unknown, not invented.
  UPDATE public.events SET location_geo = NULL, coordinate_precision = NULL WHERE id = f.v_event;
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], 40.7222, -73.9578, NULL, '');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.coordinate_precision IS NOT NULL OR v_row.location_geo IS NULL THEN
    RAISE EXCEPTION 'T-08 FAIL: a first pin with no token stored precision % at %',
      v_row.coordinate_precision, v_row.location_geo;
  END IF;
  -- Only one of the two numbers the same is a MOVED pin.
  UPDATE public.events SET coordinate_precision = 'exact' WHERE id = f.v_event;
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], 40.7222, -73.9000, NULL, '');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.coordinate_precision IS NOT NULL THEN
    RAISE EXCEPTION 'T-08 FAIL: a pin that kept its latitude and changed its longitude kept precision %',
      v_row.coordinate_precision;
  END IF;
  RAISE NOTICE 'T-08 PASS: an unmoved pin keeps its precision unless a valid token says otherwise; a moved pin never inherits it';
END $t08$;
ROLLBACK;

-- ─── T-09: hide-address composes with the other theme writes in one patch ─────
BEGIN;
DO $t09$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t09');
  -- The production shape that started this: the direct child says hidden, a
  -- stale settings copy says not.
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event,settings}',
       jsonb_build_object('hideAddressUntilTicket', false, 'requireApproval', true), true)
   WHERE id = f.v_event;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object(
      'hideAddressUntilTicket', false, 'venueName', 'The Bedford Hall', 'format', 'hybrid',
      'allowTransfers', false)),
    'Showing the address and renaming the venue', f.v_revision + 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme #> '{business_event,hideAddressUntilTicket}' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'T-09 FAIL: hide-address sent with a venue edit did not reach the key readers use (%)',
      v_row.theme #> '{business_event,hideAddressUntilTicket}';
  END IF;
  IF v_row.theme #> '{business_event,settings}' ? 'hideAddressUntilTicket'
     OR (v_row.theme #>> '{business_event,settings,requireApproval}')::boolean IS DISTINCT FROM true
     OR (v_row.theme #>> '{business_event,settings,allowTransfers}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T-09 FAIL: the settings object is wrong after a combined patch (%)', v_row.theme #> '{business_event,settings}';
  END IF;
  IF v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'The Bedford Hall'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn'
     OR v_row.location_text IS DISTINCT FROM 'The Bedford Hall · 61 Wythe Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,format}' IS DISTINCT FROM 'hybrid'
     OR v_row.is_online IS DISTINCT FROM true
     OR (v_row.theme #>> '{business_event,clientRevision}')::integer IS DISTINCT FROM f.v_revision + 1 THEN
    RAISE EXCEPTION 'T-09 FAIL: one of the writes in a combined patch was lost (label "%", business_event %)',
      v_row.location_text, v_row.theme -> 'business_event';
  END IF;

  -- A row with no settings object at all, switching the toggle ON.
  UPDATE public.events SET theme = theme #- '{business_event,settings}' #- '{business_event,hideAddressUntilTicket}'
   WHERE id = f.v_event;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('hideAddressUntilTicket', true)),
    'Hiding the address until they buy', f.v_revision + 2);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.theme #> '{business_event,hideAddressUntilTicket}' IS DISTINCT FROM 'true'::jsonb
     OR v_row.theme #> '{business_event,settings}' ? 'hideAddressUntilTicket' THEN
    RAISE EXCEPTION 'T-09 FAIL: hide-address ON on a row with no settings object stored %', v_row.theme -> 'business_event';
  END IF;
  -- The location was not touched by a hide-only patch.
  IF v_row.location_text IS DISTINCT FROM 'The Bedford Hall · 61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'T-09 FAIL: a hide-address-only patch changed the label to "%"', v_row.location_text;
  END IF;
  RAISE NOTICE 'T-09 PASS: hide-address, a venue edit, a format edit and a setting land together, and the stale settings copy is gone';
END $t09$;
ROLLBACK;

-- ─── T-10: the live RSVP door ─────────────────────────────────────────────────
BEGIN;
DO $t10$
DECLARE
  f record;
  v_result jsonb;
  v_row public.events%ROWTYPE;
  v_before public.events%ROWTYPE;
  v_err text;
  v_notes integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_rsvp('t10');

  -- Nobody has answered: a blank reason is accepted at this door.
  v_result := public.biz_update_live_rsvp(f.v_event,
    jsonb_build_object('title', 'T3827 RSVP', 'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn'), NULL);
  IF (v_result ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T-10 FAIL: a blank reason on an RSVP nobody has answered was refused (%)', v_result;
  END IF;
  -- A typed reason is still held to 10..200 with nobody there.
  v_result := public.biz_update_live_rsvp(f.v_event, jsonb_build_object('title', 'T3827 RSVP'), 'too short');
  IF v_result ->> 'reason' IS DISTINCT FROM 'invalid_edit_reason' THEN
    RAISE EXCEPTION 'T-10 FAIL: a 9 character reason on an empty RSVP answered %', v_result;
  END IF;

  -- The graph function still demands a reason of its own (untouched by ruling):
  -- the RSVP wizard cannot reach the relaxed path.
  BEGIN
    PERFORM public.business_update_rsvp_graph(f.v_event, jsonb_build_object('title', 'T3827 RSVP'), NULL, NULL);
    RAISE EXCEPTION 'T-10 FAIL: business_update_rsvp_graph accepted a live RSVP edit with no reason';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%rsvp_edit_reason_invalid%' THEN
      RAISE EXCEPTION 'T-10 FAIL: the graph function refused a blank reason with the wrong answer: %', SQLERRM;
    END IF;
  END;

  -- One approved going guest.
  PERFORM pg_temp.t3827_rsvp_guest(f.v_event, 'going', 'approved');
  SELECT * INTO v_before FROM public.events WHERE id = f.v_event;
  v_result := public.biz_update_live_rsvp(f.v_event,
    jsonb_build_object('title', 'Renamed behind a guest''s back'), NULL);
  IF (v_result ->> 'ok')::boolean IS DISTINCT FROM false OR v_result ->> 'reason' IS DISTINCT FROM 'missing_edit_reason' THEN
    RAISE EXCEPTION 'T-10 FAIL: a blank reason with a going guest answered % (expected missing_edit_reason)', v_result;
  END IF;
  v_result := public.biz_update_live_rsvp(f.v_event,
    jsonb_build_object('title', 'Renamed behind a guest''s back'), '   ');
  IF v_result ->> 'reason' IS DISTINCT FROM 'missing_edit_reason' THEN
    RAISE EXCEPTION 'T-10 FAIL: a spaces-only reason with a going guest answered %', v_result;
  END IF;
  v_result := public.biz_update_live_rsvp(f.v_event,
    jsonb_build_object('title', 'Renamed behind a guest''s back'), repeat('x', 201));
  IF v_result ->> 'reason' IS DISTINCT FROM 'invalid_edit_reason' THEN
    RAISE EXCEPTION 'T-10 FAIL: a 201 character reason with a going guest answered %', v_result;
  END IF;
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.title IS DISTINCT FROM v_before.title THEN
    RAISE EXCEPTION 'T-10 FAIL: a refused RSVP edit wrote the title (%)', v_row.title;
  END IF;

  -- The reason the graph function hands over, and NO `location` key: exactly
  -- the older-client behaviour. The label is what was sent, and the structured
  -- halves are left alone.
  v_result := public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'T3827 RSVP', 'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn'),
    'A reason handed over by the graph function', NULL);
  IF (v_result #>> '{updateResult,ok}')::boolean IS DISTINCT FROM true
     OR (v_result #>> '{updateResult,notified_count}')::integer IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'T-10 FAIL: an unchanged-location edit without the key answered %', v_result -> 'updateResult';
  END IF;

  -- The new client sends `location` on EVERY save. Identical halves must not
  -- read as a material change, or every unrelated edit would message guests.
  SELECT count(*) INTO v_notes FROM public.rsvp_notifications WHERE event_id = f.v_event;
  v_result := public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'T3827 RSVP, new title',
      'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn',
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '61 Wythe Avenue, Brooklyn')),
    'Only the title changed this time', NULL);
  IF (v_result #>> '{updateResult,ok}')::boolean IS DISTINCT FROM true
     OR (v_result #>> '{updateResult,notified_count}')::integer IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) IS DISTINCT FROM v_notes THEN
    RAISE EXCEPTION 'T-10 FAIL: an identical `location` was treated as a material change and a guest was queued a message (%)',
      v_result -> 'updateResult';
  END IF;

  -- A changed venue IS material: the one going guest is queued exactly once.
  v_result := public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'T3827 RSVP, new title',
      'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn',
      'location', jsonb_build_object('venueName', 'The Bedford Hall', 'address', '61 Wythe Avenue, Brooklyn')),
    'Moving to the hall next door', NULL);
  IF (v_result #>> '{updateResult,notified_count}')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T-10 FAIL: a changed venue queued % messages for one going guest', v_result #>> '{updateResult,notified_count}';
  END IF;
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'The Bedford Hall · 61 Wythe Avenue, Brooklyn'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'The Bedford Hall' THEN
    RAISE EXCEPTION 'T-10 FAIL: the RSVP venue edit stored label "%" and halves %',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;

  -- `location` that is not an object (null, a string) is not the structured
  -- path: the label sent is the label stored, as for an older client.
  v_result := public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'T3827 RSVP, new title', 'location_text', 'Plain label', 'location', NULL),
    'A null location key from a client', NULL);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.location_text IS DISTINCT FROM 'Plain label'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'The Bedford Hall' THEN
    RAISE EXCEPTION 'T-10 FAIL: a null `location` key was treated as structured (label "%", halves %)',
      v_row.location_text, v_row.theme #> '{business_event,location}';
  END IF;
  RAISE NOTICE 'T-10 PASS: the live RSVP door relaxes the reason only with no going guests, and an identical location notifies nobody';
END $t10$;
ROLLBACK;

-- ─── T-11: visibility and refund terms still demand a reason ──────────────────
BEGIN;
DO $t11$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
  v_result jsonb;
  v_refused boolean;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('t11');
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF public.business_event_buyer_count(f.v_event) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'T-11 fixture: the event already has buyers';
  END IF;

  v_refused := false;
  BEGIN
    PERFORM public.business_set_event_visibility(f.v_event, 'private', NULL, v_row.updated_at);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%invalid_edit_reason%' THEN
      RAISE EXCEPTION 'T-11 FAIL: a visibility change with no reason was refused with the wrong answer: %', SQLERRM;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'T-11 FAIL: business_set_event_visibility accepted a blank reason (it is not relaxed by this change)';
  END IF;

  -- The refund-terms owner answers ok:false or raises; either way a blank
  -- reason must not be accepted and the terms must not move.
  v_refused := false;
  BEGIN
    v_result := public.business_patch_offering_refund_policy(f.v_event,
      jsonb_build_object('kind', 'no_refunds'), NULL);
    IF (v_result ->> 'ok')::boolean IS DISTINCT FROM true THEN
      v_refused := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'T-11 FAIL: business_patch_offering_refund_policy accepted a blank reason on a published event (%)', v_result;
  END IF;

  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.visibility IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'T-11 FAIL: the refused visibility change was written (%)', v_row.visibility;
  END IF;
  RAISE NOTICE 'T-11 PASS: visibility and refund terms still refuse a blank reason with no buyers';
END $t11$;
ROLLBACK;

-- ─── T-12: the composer on NULL and on what is and is not blank ───────────────
BEGIN;
DO $t12$
BEGIN
  IF public.business_event_location_label(NULL, NULL) IS NOT NULL
     OR public.business_event_location_label('', '') IS NOT NULL
     OR public.business_event_location_label(E'\n', chr(8232) || chr(8233)) IS NOT NULL
     OR public.business_event_location_label(chr(5760) || chr(8192) || chr(8202) || chr(8239) || chr(8287), NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'T-12 FAIL: a blank pair did not compose to NULL';
  END IF;
  -- Characters JavaScript's trim does NOT remove are not blank here either.
  IF public.business_event_location_label(chr(8203), NULL) IS DISTINCT FROM chr(8203)        -- zero-width space
     OR public.business_event_location_label(chr(8288), NULL) IS DISTINCT FROM chr(8288)     -- word joiner
     OR public.business_event_location_label(chr(6158), NULL) IS DISTINCT FROM chr(6158) THEN -- Mongolian vowel separator
    RAISE EXCEPTION 'T-12 FAIL: a character JavaScript does not trim was treated as blank';
  END IF;
  -- A half is never trimmed, reordered or de-duplicated.
  IF public.business_event_location_label('  A  ', '  B  ') IS DISTINCT FROM '  A   ·   B  '
     OR public.business_event_location_label('A', ' · ') IS DISTINCT FROM 'A ·  · '
     OR public.business_event_location_label('·', '·') IS DISTINCT FROM '· · ·' THEN
    RAISE EXCEPTION 'T-12 FAIL: the composer altered a half';
  END IF;
  -- An empty string and NULL are the same to the merge: the half is cleared.
  IF public.business_event_theme_with_location(
       '{"business_event":{"location":{"venueName":"V","address":"A"}}}'::jsonb, 'V · A', false, NULL, true, '')
       #> '{business_event,location}' IS DISTINCT FROM '{"venueName":"V","address":null}'::jsonb THEN
    RAISE EXCEPTION 'T-12 FAIL: setting a blank address did not clear the address half to null';
  END IF;
  RAISE NOTICE 'T-12 PASS: the composer returns NULL for a blank pair and never alters a non-blank half';
END $t12$;
ROLLBACK;
