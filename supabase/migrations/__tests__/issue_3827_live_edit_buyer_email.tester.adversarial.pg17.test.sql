\set ON_ERROR_STOP on

-- Issue #3827 — tester adversarial proof for the buyer email on a live edit
-- (migration 20271014103827). Run after the full migration chain on
-- PostgreSQL 17.
--
-- The implementor's suite proves the feature does what it says on the happy
-- path. This one attacks it from the other side:
--   A. a host's save is never blocked or lost, whatever the recorder meets;
--      drafts, trips and unwatched columns are never captured; publishing and
--      unpublishing never leave anything that could be sent;
--   B. one logical edit is one record, on every write path (the atomic
--      function, a leaf called directly, a plain table write by a signed-in
--      manager, the RSVP graph function);
--   C. nothing is sent that should not be (added dates, a change put back,
--      nobody booked, refunded-only, a listing that ended, refund-all, the
--      switch off, missing switch rows);
--   D. several edits become one email, timed by the 5 / 15 / 20 minute rule;
--   E. no street, stop address or place name is stored anywhere, and no client
--      role reaches a notice, a switch, the pilot, the allowlist or the fan-out;
--   F. who is a recipient, counted once;
--   G. the fan-out and a retried delivery never create a second row.
--
-- TIME. Every function under test reads now(), which is fixed for the length
-- of a transaction. Time is advanced by moving the stored timestamps of the
-- waiting notice back (first_unsent_at, created_at, send_after,
-- fanned_out_at), never by sleeping.
--
-- FAILS WITHOUT THE MIGRATION: every case stops at its first statement
-- (`event_edit_notices` does not exist). FAILS WITH ONLY THE THREE RE-EMITTED
-- BODIES REVERTED to their 20270828003827 / 20270323001919 text (md5 of
-- prosrc then equals production's 62323b17 / a4b8db86 / 2695010c): TA-02,
-- TB-01, TB-04, TC-02, TC-03, TC-04, TD-01, TD-02, TD-03, TF-01, TF-02 and
-- TG-01 fail (no flush: the edit is recorded at commit as `direct` with no
-- reason, `buyer_notice` is missing from the answer, and a live RSVP edit
-- queues its legacy row even when the notice owns the change).
--
-- Every case rolls back. Nothing here sends anything.

-- ── fixtures ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.t3827e_settle() RETURNS void
LANGUAGE plpgsql AS $settle$
BEGIN
  -- Fires every deferred trigger now, as COMMIT would, then goes back to
  -- deferring so the next statement behaves as in production.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
END;
$settle$;

CREATE OR REPLACE FUNCTION pg_temp.t3827e_publish_payload(p_hide_address boolean, p_revision integer)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'T3827E night',
    'timezone', 'America/New_York',
    'is_online', false,
    'city', 'Brooklyn',
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'in_person',
      'requestedVisibility', 'public',
      'clientRevision', p_revision,
      'city', 'Brooklyn',
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '61 Wythe Avenue, Brooklyn'),
      'hideAddressUntilTicket', p_hide_address,
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '12 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))))
$payload$;

CREATE OR REPLACE FUNCTION pg_temp.t3827e_event(p_tag text, p_hide_address boolean DEFAULT false)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_tier uuid, v_revision integer)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827e-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827E ' || p_tag, 't3827e-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_event, v_brand, v_user, 'T3827E draft', 't3827e-draft-' || v_event, 'event', 'draft',
    'draft', 'America/New_York');
  PERFORM public.issue_1719_publish_event_with_poster(v_event,
    pg_temp.t3827e_publish_payload(p_hide_address, 1), 1);
  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.status IS DISTINCT FROM 'scheduled'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'fixture: the published event is not the shape the suite assumes (status %, theme %)',
      v_row.status, v_row.theme -> 'business_event';
  END IF;
  SELECT tt.id INTO v_tier FROM public.ticket_types AS tt
   WHERE tt.event_id = v_event AND tt.deleted_at IS NULL LIMIT 1;
  v_revision := COALESCE((v_row.theme #>> '{business_event,clientRevision}')::integer, 0);
  PERFORM pg_temp.t3827e_settle();
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.t3827e_buyer(p_event uuid, p_tier uuid, p_email text, p_name text DEFAULT 'T3827E Buyer')
RETURNS uuid LANGUAGE plpgsql AS $buyer$
DECLARE
  v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
                            payment_method, payment_status, source)
  VALUES (v_order, p_event, p_email, p_name, '+15550003827', 0, 'free', 'paid', 'online_checkout');
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status)
  VALUES (gen_random_uuid(), v_order, p_tier, p_event, 'mingla:v1:ticket:' || gen_random_uuid()::text,
          md5(gen_random_uuid()::text), 'valid', 'auto');
  RETURN v_order;
END;
$buyer$;

CREATE OR REPLACE FUNCTION pg_temp.t3827e_go_live(p_brand uuid, p_allowlist_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $live$
BEGIN
  INSERT INTO public.event_update_email_pilot_brands(brand_id) VALUES (p_brand) ON CONFLICT DO NOTHING;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email';
  UPDATE public.feature_flags SET is_enabled = p_allowlist_only
   WHERE flag_key = 'event_update_buyer_email_allowlist_only';
END;
$live$;

CREATE OR REPLACE FUNCTION pg_temp.t3827e_rsvp(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_guest uuid)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  v_guest := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827e-rsvp-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827E RSVP ' || p_tag, 't3827e-rsvp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'T3827E RSVP', 't3827e-rsvp-draft-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  PERFORM public.business_update_rsvp_graph(v_event, jsonb_build_object(
    '__expectedClientRevision', 1,
    'title', 'T3827E RSVP',
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
  IF v_row.status IS NULL OR v_row.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'fixture: the RSVP did not publish (status %)', v_row.status;
  END IF;
  -- Publishing (draft to scheduled) is not a live edit.
  PERFORM pg_temp.t3827e_settle();
  IF EXISTS (SELECT 1 FROM public.event_edit_notices AS n WHERE n.event_id = v_event)
     OR EXISTS (SELECT 1 FROM public.event_edit_notice_pending AS p WHERE p.event_id = v_event) THEN
    RAISE EXCEPTION 'fixture: publishing an RSVP recorded an edit notice or left a capture behind';
  END IF;
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_guest, v_event, 'T3827E Guest', 't3827e-guest-' || v_guest || '@example.test', '+15550003827',
          'going', 'approved');
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.t3827e_experience(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_tier uuid, v_date text)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_start timestamptz;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  v_tier := gen_random_uuid();
  v_date := to_char((now() + interval '20 days')::date, 'YYYY-MM-DD');
  v_start := (v_date || ' 18:00:00')::timestamp AT TIME ZONE 'America/New_York';
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827e-exp-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827E Exp ' || p_tag, 't3827e-exp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode, experience_intents, experience_intent)
  VALUES (v_event, v_brand, v_user, 'T3827E walk', 'A walk through two rooms for the suite.',
    't3827e-exp-' || v_event, 'experience', 'draft', 'draft', 'America/New_York', 'USD',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, v_start, v_start + interval '3 hours', 'America/New_York', true);
  INSERT INTO public.experience_stops(event_id, stop_order, place_id, place_name, address, lat, lng, start_time)
  VALUES (v_event, 0, 'place-one', 'Velvet Cellar', '11 Secret Lane, Brooklyn', 40.71001, -73.95001, '18:00'),
         (v_event, 1, 'place-two', 'Glasshouse Loft', '22 Hidden Row, Brooklyn', 40.72002, -73.96002, '19:30');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, is_free, display_order)
  VALUES (v_tier, v_event, 'Spot', 0, true, 0);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = v_event;
  PERFORM pg_temp.t3827e_settle();
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.t3827e_experience_payload(
  p_date text, p_second_address text DEFAULT '22 Hidden Row, Brooklyn',
  p_second_time text DEFAULT '19:30', p_second_name text DEFAULT 'Glasshouse Loft')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'T3827E walk',
    'description', 'A walk through two rooms for the suite.',
    'experience_intents', jsonb_build_array('group-fun'),
    'location_mode', 'per_stop',
    'pricing_mode', 'whole',
    'is_free', true,
    'timezone', 'America/New_York',
    'whenMode', 'single',
    'when', jsonb_build_object('date', p_date, 'doorsOpen', '18:00', 'endsAt', '21:00'),
    'stops', jsonb_build_array(
      jsonb_build_object('place_id', 'place-one', 'place_name', 'Velvet Cellar',
        'address', '11 Secret Lane, Brooklyn', 'lat', 40.71001, 'lng', -73.95001, 'start_time', '18:00'),
      jsonb_build_object('place_id', 'place-two', 'place_name', p_second_name,
        'address', p_second_address, 'lat', 40.72002, 'lng', -73.96002, 'start_time', p_second_time)))
$payload$;

-- Everything the feature stores or queues about one event, as one string.
CREATE OR REPLACE FUNCTION pg_temp.t3827e_everything(p_event uuid)
RETURNS text LANGUAGE sql AS $all$
  SELECT COALESCE((SELECT string_agg(row_to_json(n)::text, ' ') FROM public.event_edit_notices AS n
                    WHERE n.event_id = p_event), '')
      || ' ' || COALESCE((SELECT string_agg(row_to_json(p)::text, ' ') FROM public.event_edit_notice_pending AS p
                    WHERE p.event_id = p_event), '')
      || ' ' || COALESCE((SELECT string_agg(row_to_json(r)::text, ' ') FROM public.rsvp_notifications AS r
                    WHERE r.event_id = p_event AND r.payload ? 'noticeId'), '')
$all$;

-- ─── TA-01: a save is never blocked, whatever the recorder meets ─────────────
BEGIN;
DO $ta01$
DECLARE
  f record;
  v_result jsonb;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('ta01');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);

  -- A theme that is not an object at all, then one that is an array.
  UPDATE public.events SET theme = '"not an object"'::jsonb WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT theme FROM public.events WHERE id = f.v_event) IS DISTINCT FROM '"not an object"'::jsonb THEN
    RAISE EXCEPTION 'TA-01 FAIL: a write of a malformed theme did not land';
  END IF;
  UPDATE public.events SET theme = '[1, {"business_event": 7}]'::jsonb WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  UPDATE public.events
     SET theme = jsonb_build_object('business_event', jsonb_build_object(
           'format', 12, 'hideAddressUntilTicket', 'maybe',
           'location', jsonb_build_array('a', 'b')))
   WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT theme #>> '{business_event,format}' FROM public.events WHERE id = f.v_event) IS DISTINCT FROM '12' THEN
    RAISE EXCEPTION 'TA-01 FAIL: a write of a theme with wrong-typed fields did not land';
  END IF;

  -- A very large theme (about 3 MB in a key the notice never reads).
  UPDATE public.events
     SET theme = jsonb_build_object(
           'padding', repeat('x', 3000000),
           'business_event', jsonb_build_object('format', 'in_person', 'location',
             jsonb_build_object('venueName', 'Big Theme Hall', 'address', '1 Large Street')))
   WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT theme #>> '{business_event,location,venueName}' FROM public.events WHERE id = f.v_event)
       IS DISTINCT FROM 'Big Theme Hall' THEN
    RAISE EXCEPTION 'TA-01 FAIL: a write of a very large theme did not land';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event
              AND pg_column_size(row_to_json(event_edit_notices.*)::text) > 100000) THEN
    RAISE EXCEPTION 'TA-01 FAIL: the large theme was copied into a notice';
  END IF;

  -- The switch rows are gone: the edit lands and is held, and the fan-out
  -- treats the missing allowlist switch as ON (fail closed).
  DELETE FROM public.feature_flags WHERE flag_key LIKE 'event_update_buyer_email%';
  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT timezone FROM public.events WHERE id = f.v_event) <> 'America/Chicago' THEN
    RAISE EXCEPTION 'TA-01 FAIL: with the switch rows missing the write did not land';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event
                  AND state = 'held' AND hold_code = 'feature_off'
                  AND changes @> '[{"field":"timezone"}]'::jsonb) THEN
    RAISE EXCEPTION 'TA-01 FAIL: with the switch rows missing the edit was not held / feature_off';
  END IF;
  IF (public.event_edit_notice_fanout(20) ->> 'rows')::integer <> 0 THEN
    RAISE EXCEPTION 'TA-01 FAIL: with the switch rows missing something was fanned out';
  END IF;

  -- (A brand cannot be deleted under a live event: issue_2063 refuses it, so
  -- that state is not reachable.)
  BEGIN
    UPDATE public.brands SET deleted_at = now() WHERE id = f.v_brand;
    RAISE EXCEPTION 'TA-01 FAIL: a brand with a live event was deleted; the recorder must then be proven against it';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'brand_delete_blocked_by_events%' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_n FROM public.event_edit_notice_pending WHERE event_id = f.v_event;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TA-01 FAIL: % captures were left behind', v_n;
  END IF;
  RAISE NOTICE 'TA-01 PASS: malformed, wrong-typed and very large themes and missing switch rows never block a write';
END $ta01$;
ROLLBACK;

-- ─── TA-02: the snapshot, the recorder and the failure log all broken at once ─
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.t3827e_break_everything() RETURNS trigger
LANGUAGE plpgsql AS $break$
BEGIN
  RAISE EXCEPTION 't3827e: the notice tables are broken on purpose';
END;
$break$;
DO $ta02$
DECLARE
  f record;
  v_result jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('ta02');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  -- Neither a notice nor a capture can be written: even the failure log fails.
  CREATE TRIGGER t3827e_break_notices BEFORE INSERT ON public.event_edit_notices
    FOR EACH ROW EXECUTE FUNCTION pg_temp.t3827e_break_everything();
  CREATE TRIGGER t3827e_break_pending BEFORE INSERT ON public.event_edit_notice_pending
    FOR EACH ROW EXECUTE FUNCTION pg_temp.t3827e_break_everything();

  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT theme #>> '{business_event,location,venueName}' FROM public.events WHERE id = f.v_event)
       IS DISTINCT FROM 'The Bedford Hall' THEN
    RAISE EXCEPTION 'TA-02 FAIL: the atomic save was lost when nothing could be recorded';
  END IF;
  IF v_result -> 'buyer_notice' IS NULL OR v_result #>> '{buyer_notice,state}' = 'scheduled' THEN
    RAISE EXCEPTION 'TA-02 FAIL: the save answered that an email is scheduled when nothing could be recorded (%)',
      v_result -> 'buyer_notice';
  END IF;

  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = f.v_event;
  UPDATE public.event_dates SET end_at = end_at + interval '30 minutes' WHERE event_id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT timezone FROM public.events WHERE id = f.v_event) <> 'America/Chicago' THEN
    RAISE EXCEPTION 'TA-02 FAIL: a direct write was lost when nothing could be recorded';
  END IF;
  IF (public.event_edit_notice_fanout(20) ->> 'rows')::integer <> 0 THEN
    RAISE EXCEPTION 'TA-02 FAIL: something was fanned out with the recorder broken';
  END IF;
  RAISE NOTICE 'TA-02 PASS: with the notice table, the capture table and the failure log all refusing writes, every save still lands and nothing is promised or sent';
END $ta02$;
ROLLBACK;

-- ─── TA-03: drafts, trips and unwatched columns are never captured ───────────
BEGIN;
DO $ta03$
DECLARE
  f record;
  v_trip uuid := gen_random_uuid();
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('ta03');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);

  -- Every column the notice does not watch, on a live event with a buyer.
  UPDATE public.events
     SET title = 'T3827E night, renamed', description = 'New words.', city = 'Queens',
         show_on_discover = NOT COALESCE(show_on_discover, false), updated_at = now(),
         location_geo = location_geo, theme = theme, timezone = timezone,
         location_text = location_text, online_url = online_url
   WHERE id = f.v_event;
  UPDATE public.ticket_types SET name = 'Free entry, renamed' WHERE event_id = f.v_event;
  SELECT count(*) INTO v_n FROM public.event_edit_notice_pending;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TA-03 FAIL: an update that changed no watched value captured the listing (% captures)', v_n;
  END IF;

  -- A live trip is not on this rail: its timezone, theme and dates may move.
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_trip, f.v_brand, f.v_user, 'T3827E trip', 't3827e-trip-' || v_trip, 'trip', 'draft', 'draft',
    'America/New_York');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_trip, now() + interval '40 days', now() + interval '44 days', 'Europe/Lisbon', true);
  UPDATE public.events SET status = 'scheduled' WHERE id = v_trip;
  IF (SELECT status FROM public.events WHERE id = v_trip) <> 'scheduled' THEN
    RAISE EXCEPTION 'fixture: the trip did not become scheduled';
  END IF;
  UPDATE public.events
     SET timezone = 'Europe/Lisbon', location_text = 'Lisbon',
         theme = jsonb_build_object('business_trip', jsonb_build_object('destination', 'Lisbon'))
   WHERE id = v_trip;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_trip, now() + interval '50 days', now() + interval '54 days', 'Europe/Lisbon', false);
  UPDATE public.event_dates SET end_at = end_at + interval '1 day' WHERE event_id = v_trip;
  SELECT count(*) INTO v_n FROM public.event_edit_notice_pending;
  PERFORM pg_temp.t3827e_settle();
  IF v_n <> 0 OR EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = v_trip) THEN
    RAISE EXCEPTION 'TA-03 FAIL: a live trip was captured or recorded (% captures)', v_n;
  END IF;
  IF public.business_event_notice_snapshot(v_trip) IS NOT NULL THEN
    RAISE EXCEPTION 'TA-03 FAIL: a trip has a notice snapshot';
  END IF;

  -- A soft-deleted live event is not captured either.
  UPDATE public.events SET deleted_at = now() WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = f.v_event;
  SELECT count(*) INTO v_n FROM public.event_edit_notice_pending;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TA-03 FAIL: a deleted event was captured';
  END IF;
  RAISE NOTICE 'TA-03 PASS: unwatched columns, a live trip and a deleted event are never captured';
END $ta03$;
ROLLBACK;

-- ─── TA-04: unpublish (scheduled to draft) and re-publish leave nothing that
--     could ever be sent, and no capture behind ────────────────────────────────
BEGIN;
DO $ta04$
DECLARE
  f record;
  x record;
  v_n integer;
  v_rev integer;
BEGIN
  -- A ticketed event with nobody booked (unpublish refuses otherwise).
  SELECT * INTO f FROM pg_temp.t3827e_event('ta04');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  v_rev := (public.business_unpublish_event_to_draft(f.v_event) ->> 'client_revision')::integer;
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT status FROM public.events WHERE id = f.v_event) <> 'draft' THEN
    RAISE EXCEPTION 'TA-04 FAIL: the event was not unpublished';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'TA-04 FAIL: unpublishing an event left a capture behind';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event
              AND (state = 'scheduled' OR send_after IS NOT NULL)) THEN
    RAISE EXCEPTION 'TA-04 FAIL: unpublishing an event left a notice that can be sent';
  END IF;
  -- Draft edits after the unpublish record nothing more.
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event;
  UPDATE public.events SET timezone = 'America/Chicago', location_text = 'Elsewhere' WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> v_n THEN
    RAISE EXCEPTION 'TA-04 FAIL: a draft edit after the unpublish was recorded';
  END IF;
  -- Publishing again (draft to scheduled) through the real publish function
  -- records nothing and flushes nothing stale.
  PERFORM public.issue_1719_publish_event_with_poster(f.v_event,
    pg_temp.t3827e_publish_payload(false, v_rev + 1), v_rev + 1);
  IF (SELECT status FROM public.events WHERE id = f.v_event) <> 'scheduled' THEN
    RAISE EXCEPTION 'fixture: the event did not publish again';
  END IF;
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> v_n
     OR EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'TA-04 FAIL: publishing again recorded a notice or left a capture';
  END IF;
  IF (public.event_edit_notice_fanout(20) ->> 'rows')::integer <> 0 THEN
    RAISE EXCEPTION 'TA-04 FAIL: something was fanned out after unpublish and re-publish';
  END IF;

  -- The same for an experience.
  SELECT * INTO x FROM pg_temp.t3827e_experience('ta04x');
  PERFORM pg_temp.t3827e_go_live(x.v_brand);
  PERFORM public.business_unpublish_experience_to_draft(x.v_event, NULL);
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT status FROM public.events WHERE id = x.v_event) <> 'draft' THEN
    RAISE EXCEPTION 'TA-04 FAIL: the experience was not unpublished';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id = x.v_event)
     OR EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = x.v_event
                 AND (state = 'scheduled' OR send_after IS NOT NULL)) THEN
    RAISE EXCEPTION 'TA-04 FAIL: unpublishing an experience left a capture or a notice that can be sent';
  END IF;
  RAISE NOTICE 'TA-04 PASS: unpublish and re-publish leave no capture and nothing that can be sent (event notices after unpublish: %, experience: %)',
    v_n, (SELECT count(*) FROM public.event_edit_notices WHERE event_id = x.v_event);
END $ta04$;
ROLLBACK;

-- ─── TB-01: one record per edit through the atomic function ──────────────────
BEGIN;
DO $tb01$
DECLARE
  f record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('tb01');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  -- Core and taxonomy in one save: two leaves write, one record.
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object(
      'core', jsonb_build_object('venueName', 'The Bedford Hall', 'description', 'New words.'),
      'taxonomy', jsonb_build_object(
        'city', 'Brooklyn',
        'partyTypes', jsonb_build_array('festival'),
        'vibeTags', jsonb_build_array('social'),
        'musicGenres', '[]'::jsonb,
        'locationGeo', jsonb_build_object('lat', 40.7081, 'lng', -73.9571),
        'locationText', '250 Bedford Avenue, Brooklyn',
        'coordinatePrecision', 'approximate')),
    'Moving the night to the new room', f.v_revision + 1);
  PERFORM pg_temp.t3827e_settle();
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TB-01 FAIL: one atomic save wrote % notice rows (%)', v_n,
      (SELECT jsonb_agg(jsonb_build_object('source', source, 'state', state, 'changes', changes))
         FROM public.event_edit_notices WHERE event_id = f.v_event);
  END IF;
  IF v_notice.source <> 'event' OR v_notice.reason IS DISTINCT FROM 'Moving the night to the new room'
     OR v_notice.state <> 'scheduled' OR v_notice.edited_by IS DISTINCT FROM f.v_user
     OR v_result #>> '{buyer_notice,notice_id}' IS DISTINCT FROM v_notice.id::text THEN
    RAISE EXCEPTION 'TB-01 FAIL: the one record is not the flushed one with its reason (%)',
      to_jsonb(v_notice) - 'base_snapshot' - 'after_snapshot';
  END IF;
  IF v_notice.changes IS DISTINCT FROM jsonb_build_array(
       jsonb_build_object('field', 'venue', 'old', 'Lantern Room', 'new', 'The Bedford Hall'),
       jsonb_build_object('field', 'address', 'old', '61 Wythe Avenue, Brooklyn', 'new', '250 Bedford Avenue, Brooklyn')) THEN
    RAISE EXCEPTION 'TB-01 FAIL: venue and address changed in one save but the record holds %', v_notice.changes;
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'TB-01 FAIL: a capture outlived the save';
  END IF;
  RAISE NOTICE 'TB-01 PASS: core and taxonomy changed in one atomic save: exactly one record, the flushed one';
END $tb01$;
ROLLBACK;

-- ─── TB-02: a leaf called directly records exactly once, as `direct` ─────────
BEGIN;
DO $tb02$
DECLARE
  f record;
  g record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('tb02');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);

  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], 40.7081, -73.9571, '250 Bedford Avenue, Brooklyn', 'approximate');
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TB-02 FAIL: a leaf call recorded before the transaction ended';
  END IF;
  PERFORM pg_temp.t3827e_settle();
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF v_n <> 1 OR v_notice.source <> 'direct' OR v_notice.reason IS NOT NULL
     OR v_notice.edited_by IS DISTINCT FROM f.v_user OR v_notice.state <> 'scheduled'
     OR v_notice.changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
          'field', 'address', 'old', '61 Wythe Avenue, Brooklyn', 'new', '250 Bedford Avenue, Brooklyn')) THEN
    RAISE EXCEPTION 'TB-02 FAIL: a direct taxonomy leaf call was not recorded exactly once as direct (% rows, %)',
      v_n, to_jsonb(v_notice) - 'base_snapshot' - 'after_snapshot';
  END IF;

  -- The when leaf, called directly. With a sale it refuses a new time, so
  -- this is an event nobody has booked: one record, logged, nothing to send.
  SELECT * INTO g FROM pg_temp.t3827e_event('tb02w');
  PERFORM pg_temp.t3827e_go_live(g.v_brand);
  PERFORM public.business_patch_event_when(g.v_event,
    jsonb_build_object('whenMode', 'single', 'timezone', 'America/New_York',
      'when', jsonb_build_object('date', to_char(now() + interval '12 days', 'YYYY-MM-DD'),
        'doorsOpen', '21:00', 'endsAt', '23:30')),
    'Doors open an hour later', g.v_revision + 1);
  PERFORM pg_temp.t3827e_settle();
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = g.v_event;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = g.v_event;
  IF v_n <> 1 OR v_notice.source <> 'direct' OR v_notice.state <> 'logged'
     OR v_notice.changes #>> '{0,field}' IS DISTINCT FROM 'dates'
     OR jsonb_array_length(v_notice.changes #> '{0,old}') <> 1 THEN
    RAISE EXCEPTION 'TB-02 FAIL: a direct when leaf call was not recorded exactly once with the old and new time (% rows, %)',
      v_n, to_jsonb(v_notice) - 'base_snapshot' - 'after_snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id IN (f.v_event, g.v_event)) THEN
    RAISE EXCEPTION 'TB-02 FAIL: a capture outlived the leaf calls';
  END IF;
  RAISE NOTICE 'TB-02 PASS: the taxonomy and when leaves called directly each record exactly once, as direct';
END $tb02$;
ROLLBACK;

-- ─── TB-03: a plain table write by a signed-in manager records exactly once ──
BEGIN;
DO $tb03$
DECLARE
  f record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('tb03');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);

  -- As the brand owner, through row security, in three statements.
  SET LOCAL ROLE authenticated;
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event,location,venueName}', '"The Bedford Hall"'::jsonb),
         location_text = 'The Bedford Hall · 61 Wythe Avenue, Brooklyn'
   WHERE id = f.v_event;
  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = f.v_event;
  UPDATE public.event_dates SET start_at = start_at + interval '1 hour' WHERE event_id = f.v_event;
  RESET ROLE;
  IF (SELECT timezone FROM public.events WHERE id = f.v_event) <> 'America/Chicago' THEN
    RAISE EXCEPTION 'fixture: row security did not let the owner write the event';
  END IF;
  SELECT count(*) INTO v_n FROM public.event_edit_notice_pending WHERE event_id = f.v_event;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TB-03 FAIL: three writes in one transaction left % captures (expected 1)', v_n;
  END IF;
  PERFORM pg_temp.t3827e_settle();
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF v_n <> 1 OR v_notice.source <> 'direct' OR v_notice.edited_by IS DISTINCT FROM f.v_user
     OR jsonb_array_length(v_notice.changes) <> 3 THEN
    RAISE EXCEPTION 'TB-03 FAIL: three table writes were not one direct record of three changes (% rows, %)',
      v_n, v_notice.changes;
  END IF;
  -- Firing the deferred net a second time records nothing more.
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> 1 THEN
    RAISE EXCEPTION 'TB-03 FAIL: settling twice recorded twice';
  END IF;
  RAISE NOTICE 'TB-03 PASS: three table writes by the signed-in owner are one direct record with the actor';
END $tb03$;
ROLLBACK;

-- ─── TB-04: the RSVP graph function reaches biz_update_live_rsvp: one record ──
BEGIN;
DO $tb04$
DECLARE
  f record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_rsvp('tb04');
  v_result := public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'T3827E RSVP',
      'location', jsonb_build_object('venueName', 'The Bedford Hall', 'address', '61 Wythe Avenue, Brooklyn')),
    'Moving to a bigger room for everyone', NULL);
  PERFORM pg_temp.t3827e_settle();
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF v_n <> 1 OR v_notice.source <> 'rsvp'
     OR v_notice.reason IS DISTINCT FROM 'Moving to a bigger room for everyone'
     OR v_notice.state <> 'held' OR v_notice.hold_code IS DISTINCT FROM 'feature_off' THEN
    RAISE EXCEPTION 'TB-04 FAIL: a live RSVP edit through the graph function was not one rsvp record held / feature_off (% rows, %)',
      v_n, to_jsonb(v_notice) - 'base_snapshot' - 'after_snapshot';
  END IF;
  -- With the switch off the guest is alerted exactly as before: one legacy row.
  IF (SELECT count(*) FROM public.rsvp_notifications AS n
       WHERE n.event_id = f.v_event AND n.template_key = 'rsvp_event_updated'
         AND NOT (n.payload ? 'noticeId')) <> 1 THEN
    RAISE EXCEPTION 'TB-04 FAIL: with the switch off the going guest lost the alert they get today';
  END IF;

  -- Switch on: the same path records once more and queues nothing itself.
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  v_result := public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'T3827E RSVP',
      'location', jsonb_build_object('venueName', 'A Third Room', 'address', '61 Wythe Avenue, Brooklyn')),
    'The second room fell through too', NULL);
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> 2
     OR (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') <> 1
     OR (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) <> 1 THEN
    RAISE EXCEPTION 'TB-04 FAIL: with the switch on the graph edit did not record once and leave the queue alone (% notices, % queue rows)',
      (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event),
      (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event);
  END IF;
  RAISE NOTICE 'TB-04 PASS: a live RSVP edit through the graph function is one record; legacy alert kept while off, not doubled while on';
END $tb04$;
ROLLBACK;

-- ─── TC-01: added dates, and a change put back, send nothing ─────────────────
BEGIN;
DO $tc01$
DECLARE
  f record;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('tc01');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);

  -- What the recurrence top-up does: it only ADDS occurrences.
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  SELECT f.v_event, now() + make_interval(days => 12 + 7 * g), now() + make_interval(days => 12 + 7 * g, hours => 3),
         'America/New_York', false
    FROM generate_series(1, 6) AS g;
  PERFORM pg_temp.t3827e_settle();
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event)
     OR EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'TC-01 FAIL: adding occurrences recorded a notice or left a capture';
  END IF;

  -- Changed and put back inside one transaction: nothing happened.
  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = f.v_event;
  UPDATE public.event_dates SET start_at = start_at + interval '2 hours' WHERE event_id = f.v_event AND is_master;
  UPDATE public.event_dates SET start_at = start_at - interval '2 hours' WHERE event_id = f.v_event AND is_master;
  UPDATE public.events SET timezone = 'America/New_York' WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'TC-01 FAIL: a change put back in the same transaction was recorded';
  END IF;

  -- Changed in one transaction, put back in the next: the waiting email is
  -- withdrawn and nothing is ever fanned out.
  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') <> 1 THEN
    RAISE EXCEPTION 'TC-01 FAIL: a timezone change with a buyer was not scheduled';
  END IF;
  UPDATE public.events SET timezone = 'America/New_York' WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') THEN
    RAISE EXCEPTION 'TC-01 FAIL: after the change was put back an email is still waiting';
  END IF;
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 hour'
   WHERE event_id = f.v_event AND send_after IS NOT NULL;
  IF (public.event_edit_notice_fanout(20) ->> 'rows')::integer <> 0
     OR EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'TC-01 FAIL: a change that was put back was fanned out';
  END IF;
  RAISE NOTICE 'TC-01 PASS: added occurrences record nothing; a change put back (same transaction, or the next) sends nothing';
END $tc01$;
ROLLBACK;

-- ─── TC-02: nobody to tell, or a listing no longer on sale ───────────────────
BEGIN;
DO $tc02$
DECLARE
  f record;
  g record;
  v_order uuid;
  v_notice public.event_edit_notices%ROWTYPE;
BEGIN
  -- Refunded-only: every order refunded, every ticket refunded.
  SELECT * INTO f FROM pg_temp.t3827e_event('tc02a');
  v_order := pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'gone@example.test');
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_order;
  UPDATE public.tickets SET status = 'refunded' WHERE order_id = v_order;
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF v_notice.state <> 'logged' OR v_notice.audience_count <> 0 OR v_notice.send_after IS NOT NULL THEN
    RAISE EXCEPTION 'TC-02 FAIL: a refunded-only event scheduled an email (%, audience %)',
      v_notice.state, v_notice.audience_count;
  END IF;

  -- A cancelled order (still marked paid) is not a recipient either.
  v_order := pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'cancelled@example.test');
  UPDATE public.orders SET cancelled_at = now() WHERE id = v_order;
  UPDATE public.tickets SET status = 'void' WHERE order_id = v_order;
  IF EXISTS (SELECT 1 FROM public.business_event_buyer_rows(f.v_event) AS b
              WHERE b.email IN ('gone@example.test', 'cancelled@example.test')) THEN
    RAISE EXCEPTION 'TC-02 FAIL: a refunded or cancelled buyer is a recipient';
  END IF;

  -- The listing ends, or is cancelled, between the edit and the fan-out.
  SELECT * INTO g FROM pg_temp.t3827e_event('tc02b');
  PERFORM pg_temp.t3827e_buyer(g.v_event, g.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(g.v_brand);
  PERFORM public.business_update_live_event_atomic(g.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', g.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = g.v_event;
  UPDATE public.events SET status = 'ended' WHERE id = g.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = g.v_event;
  IF v_notice.state <> 'held' OR v_notice.hold_code IS DISTINCT FROM 'event_not_live'
     OR EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = g.v_event) THEN
    RAISE EXCEPTION 'TC-02 FAIL: an ended event was fanned out (%, %)', v_notice.state, v_notice.hold_code;
  END IF;
  RAISE NOTICE 'TC-02 PASS: refunded-only and cancelled buyers are nobody; an event that ended before the fan-out is held';
END $tc02$;
ROLLBACK;

-- ─── TC-03: non-material edits never schedule anything ───────────────────────
BEGIN;
DO $tc03$
DECLARE
  f record;
  v_result jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('tc03');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('title', 'T3827E night, renamed',
      'description', 'A longer description of the night.')),
    'Tidying the title and the words', f.v_revision + 1);
  PERFORM pg_temp.t3827e_settle();
  -- The same venue and address sent again, with different spacing and case
  -- only in the venue: the stored value is what is compared.
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Lantern Room')),
    'Saving the same venue once more', f.v_revision + 2);
  PERFORM pg_temp.t3827e_settle();
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event
              AND (state <> 'logged' OR changes <> '[]'::jsonb OR send_after IS NOT NULL))
     OR (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> 2
     OR v_result #>> '{buyer_notice,material}' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'TC-03 FAIL: a title, description or same-venue save was not simply logged (%)',
      (SELECT jsonb_agg(jsonb_build_object('state', state, 'changes', changes))
         FROM public.event_edit_notices WHERE event_id = f.v_event);
  END IF;
  IF (public.event_edit_notice_fanout(20) ->> 'rows')::integer <> 0 THEN
    RAISE EXCEPTION 'TC-03 FAIL: a non-material edit was fanned out';
  END IF;
  RAISE NOTICE 'TC-03 PASS: title, description and a same-value venue save are logged with nothing changed and send nothing';
END $tc03$;
ROLLBACK;

-- ─── TC-04: "refund all and proceed" through the real save is held ───────────
BEGIN;
DO $tc04$
DECLARE
  f record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('tc04');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  -- An email is already waiting for an earlier venue change.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  -- The host moves the date and acknowledges that every buyer is refunded.
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('when', jsonb_build_object('whenMode', 'single', 'timezone', 'America/New_York',
      'acknowledgeSoldImpact', true,
      'when', jsonb_build_object('date', to_char(now() + interval '19 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))),
    'Moving the date and refunding everyone', f.v_revision + 2);
  PERFORM pg_temp.t3827e_settle();
  SELECT * INTO v_notice FROM public.event_edit_notices
   WHERE event_id = f.v_event ORDER BY created_at DESC, (reason = 'Moving the date and refunding everyone') DESC LIMIT 1;
  IF v_result #>> '{buyer_notice,state}' IS DISTINCT FROM 'held'
     OR v_result #>> '{buyer_notice,hold_code}' IS DISTINCT FROM 'refund_all' THEN
    RAISE EXCEPTION 'TC-04 FAIL: a refund-all save was not held (%)', v_result -> 'buyer_notice';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') THEN
    RAISE EXCEPTION 'TC-04 FAIL: after a refund-all save an email saying "your ticket is still valid" is still waiting';
  END IF;
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 hour'
   WHERE event_id = f.v_event AND send_after IS NOT NULL;
  IF (public.event_edit_notice_fanout(20) ->> 'rows')::integer <> 0 THEN
    RAISE EXCEPTION 'TC-04 FAIL: something was fanned out after a refund-all save';
  END IF;
  RAISE NOTICE 'TC-04 PASS: a refund-all save through the real function is held and withdraws the email already waiting';
END $tc04$;
ROLLBACK;

-- ─── TD-01: three edits in two minutes are one email, first old to last new ──
BEGIN;
DO $td01$
DECLARE
  f record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_old public.event_edit_notices%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('td01');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);

  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Two')),
    'The first room has a power fault', f.v_revision + 1);
  -- One minute passes.
  UPDATE public.event_edit_notices
     SET first_unsent_at = first_unsent_at - interval '1 minute', created_at = created_at - interval '1 minute',
         send_after = send_after - interval '1 minute'
   WHERE event_id = f.v_event;
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], 40.7081, -73.9571, '250 Bedford Avenue, Brooklyn', 'approximate');
  PERFORM pg_temp.t3827e_settle();
  -- Another minute passes.
  UPDATE public.event_edit_notices
     SET first_unsent_at = first_unsent_at - interval '1 minute', created_at = created_at - interval '1 minute',
         send_after = send_after - interval '1 minute'
   WHERE event_id = f.v_event;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Three')),
    'The second room fell through too', f.v_revision + 2);
  PERFORM pg_temp.t3827e_settle();

  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF v_n <> 1 OR (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> 3
     OR (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'superseded') <> 2 THEN
    RAISE EXCEPTION 'TD-01 FAIL: three edits must be three records with exactly one waiting (% waiting)', v_n;
  END IF;
  IF v_notice.notice_changes IS DISTINCT FROM jsonb_build_array(
       jsonb_build_object('field', 'venue', 'old', 'Lantern Room', 'new', 'Room Three'),
       jsonb_build_object('field', 'address', 'old', '61 Wythe Avenue, Brooklyn', 'new', '250 Bedford Avenue, Brooklyn')) THEN
    RAISE EXCEPTION 'TD-01 FAIL: the one email is not first-old to last-new across all three edits (%)',
      v_notice.notice_changes;
  END IF;
  IF v_notice.first_unsent_at IS DISTINCT FROM now() - interval '2 minutes'
     OR v_notice.send_after IS DISTINCT FROM now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'TD-01 FAIL: expected the first unsent edit 2 minutes ago and a send 5 quiet minutes from now (first %, send in %)',
      now() - v_notice.first_unsent_at, v_notice.send_after - now();
  END IF;

  -- The fan-out writes ONE row for the buyer, for the waiting notice only.
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE id = v_notice.id;
  PERFORM public.event_edit_notice_fanout(20);
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) <> 1
     OR (SELECT payload ->> 'noticeId' FROM public.rsvp_notifications WHERE event_id = f.v_event)
          IS DISTINCT FROM v_notice.id::text THEN
    RAISE EXCEPTION 'TD-01 FAIL: three edits produced % delivery rows (expected 1, for the waiting notice)',
      (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event);
  END IF;
  RAISE NOTICE 'TD-01 PASS: three edits in two minutes (function, leaf, function) are one email, first old to last new, one delivery row';
END $td01$;
ROLLBACK;

-- ─── TD-02: the edges of the 5 / 15 / 20 minute rule ─────────────────────────
BEGIN;
DO $td02$
DECLARE
  f record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_sent public.event_edit_notices%ROWTYPE;
  v_rev integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('td02');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  v_rev := f.v_revision;

  -- First edit 10 minutes ago: now + 5 equals first + 15 exactly.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room 1')), 'A reason long enough', v_rev + 1);
  UPDATE public.event_edit_notices SET first_unsent_at = now() - interval '10 minutes',
         created_at = now() - interval '10 minutes' WHERE event_id = f.v_event AND state = 'scheduled';
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room 2')), 'A reason long enough', v_rev + 2);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF v_notice.send_after IS DISTINCT FROM now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'TD-02 FAIL: at exactly 10 minutes the send should be in 5 (got %)', v_notice.send_after - now();
  END IF;

  -- First edit 14 minutes 59 seconds ago: one second left, never later.
  UPDATE public.event_edit_notices SET first_unsent_at = now() - interval '14 minutes 59 seconds'
   WHERE id = v_notice.id;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room 3')), 'A reason long enough', v_rev + 3);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF v_notice.send_after IS DISTINCT FROM now() + interval '1 second' THEN
    RAISE EXCEPTION 'TD-02 FAIL: at 14:59 the send should be in 1 second (got %)', v_notice.send_after - now();
  END IF;

  -- First edit 40 minutes ago (the worker was down): the next edit is due at
  -- once, never pushed out again, and still exactly one waiting notice.
  UPDATE public.event_edit_notices SET first_unsent_at = now() - interval '40 minutes' WHERE id = v_notice.id;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room 4')), 'A reason long enough', v_rev + 4);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF v_notice.send_after IS DISTINCT FROM now() - interval '25 minutes'
     OR (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') <> 1 THEN
    RAISE EXCEPTION 'TD-02 FAIL: a notice past its 15 minute cap must be due at once (send in %)', v_notice.send_after - now();
  END IF;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_sent FROM public.event_edit_notices WHERE id = v_notice.id;
  IF v_sent.state <> 'fanned_out' THEN
    RAISE EXCEPTION 'TD-02 FAIL: the overdue notice was not fanned out (%)', v_sent.state;
  END IF;

  -- At most three an hour: an edit 19 minutes 59 seconds after an email waits
  -- 5 minutes (the quiet window is the longer wait); one 1 minute after waits
  -- 19; one 21 minutes after waits 5.
  UPDATE public.event_edit_notices SET fanned_out_at = now() - interval '19 minutes 59 seconds' WHERE id = v_sent.id;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room 5')), 'A reason long enough', v_rev + 5);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF v_notice.send_after IS DISTINCT FROM now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'TD-02 FAIL: 19:59 after an email the send should be in 5 minutes (got %)', v_notice.send_after - now();
  END IF;
  UPDATE public.event_edit_notices SET fanned_out_at = now() - interval '1 minute' WHERE id = v_sent.id;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room 6')), 'A reason long enough', v_rev + 6);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF v_notice.send_after IS DISTINCT FROM now() + interval '19 minutes' THEN
    RAISE EXCEPTION 'TD-02 FAIL: 1 minute after an email the send should be in 19 minutes (got %)', v_notice.send_after - now();
  END IF;
  -- The 20 minute spacing wins over the 15 minute cap: first unsent 14
  -- minutes ago, previous email 1 minute ago.
  UPDATE public.event_edit_notices SET first_unsent_at = now() - interval '14 minutes' WHERE id = v_notice.id;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room 7')), 'A reason long enough', v_rev + 7);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF v_notice.send_after IS DISTINCT FROM now() + interval '19 minutes' THEN
    RAISE EXCEPTION 'TD-02 FAIL: the 20 minute spacing must win over the 15 minute cap (send in %)', v_notice.send_after - now();
  END IF;
  -- The fan-out honours it: nothing goes while the spacing has time left.
  IF (public.event_edit_notice_fanout(20) ->> 'notices')::integer <> 0 THEN
    RAISE EXCEPTION 'TD-02 FAIL: a second email went out inside 20 minutes of the first';
  END IF;
  RAISE NOTICE 'TD-02 PASS: exact edges of the quiet window, the 15 minute cap, an overdue notice, and the 20 minute spacing';
END $td02$;
ROLLBACK;

-- ─── TD-03: an edit that lands after the fan-out and before the send ─────────
BEGIN;
DO $td03$
DECLARE
  f record;
  v_first public.event_edit_notices%ROWTYPE;
  v_second public.event_edit_notices%ROWTYPE;
  v_rows integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('td03');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Two')),
    'The first room has a power fault', f.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_first FROM public.event_edit_notices WHERE event_id = f.v_event;
  SELECT count(*) INTO v_rows FROM public.rsvp_notifications WHERE event_id = f.v_event;

  -- The delivery is still pending when the host edits again.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Three')),
    'The second room fell through too', f.v_revision + 2);
  SELECT * INTO v_second FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF NOT FOUND OR v_second.id = v_first.id THEN
    RAISE EXCEPTION 'TD-03 FAIL: an edit after the fan-out did not open a new waiting notice';
  END IF;
  -- The email already queued is not rewritten under the worker.
  IF (SELECT row_to_json(n)::text FROM public.event_edit_notices AS n WHERE n.id = v_first.id)
       IS DISTINCT FROM row_to_json(v_first)::text THEN
    RAISE EXCEPTION 'TD-03 FAIL: the notice already fanned out was changed by a later edit';
  END IF;
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) <> v_rows THEN
    RAISE EXCEPTION 'TD-03 FAIL: a later edit added or removed delivery rows of the notice already fanned out';
  END IF;
  -- The next email starts from what the first one told the buyer, 20 minutes on.
  IF v_second.notice_changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
       'field', 'venue', 'old', 'Room Two', 'new', 'Room Three'))
     OR v_second.send_after IS DISTINCT FROM v_first.fanned_out_at + interval '20 minutes' THEN
    RAISE EXCEPTION 'TD-03 FAIL: the follow-up is not "Room Two to Room Three", 20 minutes after the first (%, send in %)',
      v_second.notice_changes, v_second.send_after - now();
  END IF;
  -- Putting the venue back to what the FIRST email said withdraws the follow-up.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Two')),
    'Back to the second room after all', f.v_revision + 3);
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') THEN
    RAISE EXCEPTION 'TD-03 FAIL: after returning to what buyers were last told, an email is still waiting';
  END IF;
  -- Putting it back to the ORIGINAL venue is a real change from what buyers
  -- were last told (Room Two): it must be sent.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Lantern Room')),
    'Back in the first room after all', f.v_revision + 4);
  SELECT * INTO v_second FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF NOT FOUND OR v_second.notice_changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
       'field', 'venue', 'old', 'Room Two', 'new', 'Lantern Room')) THEN
    RAISE EXCEPTION 'TD-03 FAIL: buyers were told "Room Two"; going back to the original venue must be emailed (%)',
      (SELECT jsonb_agg(jsonb_build_object('state', state, 'nc', notice_changes) ORDER BY created_at)
         FROM public.event_edit_notices WHERE event_id = f.v_event);
  END IF;
  RAISE NOTICE 'TD-03 PASS: an edit after the fan-out opens a new notice from what was sent, 20 minutes on; the queued email is untouched';
END $td03$;
ROLLBACK;

-- ─── TE-01: no street of a hide-address event is stored or queued, anywhere ──
BEGIN;
DO $te01$
DECLARE
  f record;
  g record;
  h record;
  v_all text;
BEGIN
  -- (a) Hidden before and after; address and venue change; fanned out.
  SELECT * INTO f FROM pg_temp.t3827e_event('te01a', true);
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object(
      'core', jsonb_build_object('venueName', 'The Bedford Hall'),
      'taxonomy', jsonb_build_object(
        'city', 'Brooklyn', 'partyTypes', jsonb_build_array('festival'),
        'vibeTags', jsonb_build_array('social'), 'musicGenres', '[]'::jsonb,
        'locationGeo', jsonb_build_object('lat', 40.7081, 'lng', -73.9571),
        'locationText', '250 Bedford Avenue, Brooklyn', 'coordinatePrecision', 'approximate')),
    'Moving the night to the new room', f.v_revision + 1);
  -- A direct leaf write and a plain table write on the same hidden event.
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], 40.7081, -73.9571, '77 Kent Avenue, Brooklyn', 'approximate');
  PERFORM pg_temp.t3827e_settle();
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event,location,address}', '"5 Berry Street, Brooklyn"'::jsonb)
   WHERE id = f.v_event;
  PERFORM pg_temp.t3827e_settle();
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = f.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  v_all := pg_temp.t3827e_everything(f.v_event);
  IF v_all ~* 'Wythe|Bedford Avenue|Kent Avenue|Berry Street' THEN
    RAISE EXCEPTION 'TE-01 FAIL (a): a street of a hide-address event is stored or queued: %', v_all;
  END IF;
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event AND payload ? 'noticeId') <> 1 THEN
    RAISE EXCEPTION 'TE-01 FAIL (a): the hidden-address notice was not fanned out to its one buyer';
  END IF;

  -- (b) The address is hidden BY the same edit that changes it.
  SELECT * INTO g FROM pg_temp.t3827e_event('te01b', false);
  PERFORM pg_temp.t3827e_buyer(g.v_event, g.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(g.v_brand);
  UPDATE public.events
     SET theme = jsonb_set(jsonb_set(theme, '{business_event,hideAddressUntilTicket}', 'true'::jsonb),
           '{business_event,location,address}', '"250 Bedford Avenue, Brooklyn"'::jsonb)
   WHERE id = g.v_event;
  PERFORM pg_temp.t3827e_settle();
  v_all := pg_temp.t3827e_everything(g.v_event);
  IF v_all ~* 'Wythe|Bedford Avenue' OR NOT EXISTS (
       SELECT 1 FROM public.event_edit_notices WHERE event_id = g.v_event
          AND notice_changes @> '[{"field":"address","withheld":true}]'::jsonb) THEN
    RAISE EXCEPTION 'TE-01 FAIL (b): hiding the address in the same edit that changes it stored a street: %', v_all;
  END IF;

  -- (c) The address is REVEALED by the same edit that changes it: it was
  -- withheld before, so neither the old nor the new street is stored.
  SELECT * INTO h FROM pg_temp.t3827e_event('te01c', true);
  PERFORM pg_temp.t3827e_buyer(h.v_event, h.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(h.v_brand);
  UPDATE public.events
     SET theme = jsonb_set(jsonb_set(theme, '{business_event,hideAddressUntilTicket}', 'false'::jsonb),
           '{business_event,location,address}', '"250 Bedford Avenue, Brooklyn"'::jsonb)
   WHERE id = h.v_event;
  PERFORM pg_temp.t3827e_settle();
  v_all := pg_temp.t3827e_everything(h.v_event);
  IF v_all ~* 'Wythe|Bedford Avenue' THEN
    RAISE EXCEPTION 'TE-01 FAIL (c): revealing the address in the same edit that changes it stored a street: %', v_all;
  END IF;

  -- (d) A hidden listing that has only its label (no structured halves): the
  -- label may hold the street, so not even the "venue" is stored.
  UPDATE public.events
     SET theme = jsonb_set(theme #- '{business_event,location}', '{business_event,hideAddressUntilTicket}', 'true'::jsonb),
         location_text = 'Speakeasy · 9 Lorimer Street'
   WHERE id = h.v_event;
  PERFORM pg_temp.t3827e_settle();
  UPDATE public.events SET location_text = 'Speakeasy · 14 Havemeyer Street' WHERE id = h.v_event;
  PERFORM pg_temp.t3827e_settle();
  v_all := pg_temp.t3827e_everything(h.v_event);
  IF v_all ~* 'Lorimer|Havemeyer|Speakeasy' THEN
    RAISE EXCEPTION 'TE-01 FAIL (d): the label of a hide-address listing is stored in a notice: %', v_all;
  END IF;
  RAISE NOTICE 'TE-01 PASS: hidden before and after, hidden by the edit, revealed by the edit, and label-only: no street is stored or queued on any write path';
END $te01$;
ROLLBACK;

-- ─── TE-02: experiences store no stop address and no place name, anywhere ────
BEGIN;
DO $te02$
DECLARE
  f record;
  v_all text;
  v_result jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_experience('te02');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  -- Through the function: a stop is renamed, moved and re-timed.
  v_result := public.biz_update_live_experience(f.v_event,
    pg_temp.t3827e_experience_payload(f.v_date, '99 Veiled Yard, Brooklyn', '20:00', 'Moonlit Annex'),
    'That stop is closed on the night');
  PERFORM pg_temp.t3827e_settle();
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> 1 THEN
    RAISE EXCEPTION 'TE-02 FAIL: one experience save wrote % records (the delete-and-reinsert must not record twice)',
      (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event);
  END IF;
  -- A plain table write to a stop, and a stop added by a table write.
  UPDATE public.experience_stops SET address = '3 Lantern Mews, Brooklyn', place_name = 'Copper Still'
   WHERE event_id = f.v_event AND stop_order = 0;
  PERFORM pg_temp.t3827e_settle();
  INSERT INTO public.experience_stops(event_id, stop_order, place_id, place_name, address, lat, lng, start_time)
  VALUES (f.v_event, 2, 'place-three', 'Orchid Vault', '8 Quiet Alley, Brooklyn', 40.73, -73.97, '21:00');
  PERFORM pg_temp.t3827e_settle();
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = f.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  v_all := pg_temp.t3827e_everything(f.v_event);
  IF v_all ~* 'Secret Lane|Hidden Row|Veiled Yard|Lantern Mews|Quiet Alley|Velvet Cellar|Glasshouse Loft|Moonlit Annex|Copper Still|Orchid Vault|place-one|place-two|place-three|40\.7' THEN
    RAISE EXCEPTION 'TE-02 FAIL: a stop address, place name, place id or coordinate is stored or queued: %', v_all;
  END IF;
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> 3
     OR NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event
                     AND state = 'fanned_out' AND notice_changes @> '[{"field":"route"}]'::jsonb) THEN
    RAISE EXCEPTION 'TE-02 FAIL: the route changes were not recorded once each and sent as one route change (%)',
      (SELECT jsonb_agg(jsonb_build_object('source', source, 'state', state, 'nc', notice_changes) ORDER BY created_at)
         FROM public.event_edit_notices WHERE event_id = f.v_event);
  END IF;

  -- A re-save with the values now stored changes nothing a buyer acts on.
  RAISE NOTICE 'TE-02 PASS: an experience edit by function and by table write stores no stop address, place name, place id or coordinate';
END $te02$;
ROLLBACK;

-- ─── TE-03: no client role reaches a notice, a switch, the pilot, the
--     allowlist, the fan-out or any internal function ─────────────────────────
BEGIN;
DO $te03$
DECLARE
  f record;
  v_scanner uuid := gen_random_uuid();
  v_marketer uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_sql text;
  v_role text;
  v_refused boolean;
  v_status jsonb;
  v_fn record;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('te03');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada-private@example.test');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ben-private@example.test');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);

  -- Every new function: none is executable by anon, and only the status read
  -- is executable by a signed-in host.
  FOR v_fn IN
    SELECT p.oid::regprocedure::text AS sig, p.proname
      FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'event\_edit\_notice%' OR p.proname IN (
            'business_event_notice_snapshot', 'business_event_buyer_rows',
            'business_event_record_edit_notice', 'business_event_buyer_notice_status'))
  LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'TE-03 FAIL: anon may execute %', v_fn.sig;
    END IF;
    IF v_fn.proname <> 'business_event_buyer_notice_status'
       AND pg_catalog.has_function_privilege('authenticated', v_fn.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'TE-03 FAIL: a signed-in host may execute %', v_fn.sig;
    END IF;
  END LOOP;

  -- Reads and writes, as each client role, with the owner's own token.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    FOREACH v_sql IN ARRAY ARRAY[
      'SELECT 1 FROM public.event_edit_notices LIMIT 1',
      'SELECT 1 FROM public.event_edit_notice_pending LIMIT 1',
      'SELECT 1 FROM public.event_update_email_allowlist LIMIT 1',
      'SELECT 1 FROM public.event_update_email_pilot_brands LIMIT 1',
      format('INSERT INTO public.event_update_email_pilot_brands(brand_id) VALUES (%L)', gen_random_uuid()),
      'INSERT INTO public.event_update_email_allowlist(email) VALUES (''me@example.test'')',
      'UPDATE public.event_edit_notices SET state = ''scheduled'', send_after = now()',
      'DELETE FROM public.event_edit_notices',
      'DELETE FROM public.event_update_email_allowlist',
      format('INSERT INTO public.event_edit_notice_pending(xid, event_id) VALUES (1, %L)', f.v_event),
      'SELECT public.event_edit_notice_fanout(1)',
      format('SELECT public.event_edit_notice_brand_live(%L)', f.v_brand),
      format('SELECT public.event_edit_notice_audience(%L)', f.v_event),
      format('SELECT public.event_edit_notice_capture(%L)', f.v_event),
      format('SELECT public.event_edit_notice_record_failure(%L, NULL, NULL, ''direct'')', f.v_event),
      format('SELECT public.business_event_record_edit_notice(%L, NULL, NULL, NULL, NULL, ''direct'', false)', f.v_event),
      format('SELECT public.event_edit_notice_flush(%L, ''a reason long enough'', ''event'', false)', f.v_event),
      format('SELECT * FROM public.business_event_buyer_rows(%L)', f.v_event),
      format('SELECT public.business_event_notice_snapshot(%L)', f.v_event)]
    LOOP
      v_refused := false;
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      BEGIN
        EXECUTE v_sql;
      EXCEPTION WHEN insufficient_privilege THEN
        v_refused := true;
      END;
      RESET ROLE;
      IF NOT v_refused THEN
        RAISE EXCEPTION 'TE-03 FAIL: role % could run: %', v_role, v_sql;
      END IF;
    END LOOP;
  END LOOP;

  -- A signed-in host cannot turn the switches (zero rows, or refused).
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.feature_flags SET is_enabled = true WHERE flag_key LIKE 'event_update_buyer_email%';
    UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email_allowlist_only';
    INSERT INTO public.feature_flags(flag_key, is_enabled) VALUES ('event_update_buyer_email_all_brands', true)
      ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  IF (SELECT is_enabled FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email_all_brands')
     OR (SELECT is_enabled FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email_allowlist_only')
          IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TE-03 FAIL: a signed-in host changed a buyer-email switch';
  END IF;

  -- The status read: counts only, and only for event managers and above.
  SET LOCAL ROLE authenticated;
  v_status := public.business_event_buyer_notice_status(f.v_event);
  RESET ROLE;
  IF v_status::text ~* '@|example\.test|ada|ben' OR (v_status ->> 'audience')::integer <> 2
     OR (v_status #>> '{last,pending}')::integer <> 2 THEN
    RAISE EXCEPTION 'TE-03 FAIL: the host status is wrong or carries an address or a name (%)', v_status;
  END IF;

  INSERT INTO auth.users(id, email) VALUES
    (v_scanner, 't3827e-scanner-' || v_scanner || '@example.test'),
    (v_marketer, 't3827e-marketer-' || v_marketer || '@example.test'),
    (v_manager, 't3827e-manager-' || v_manager || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_scanner), (v_marketer), (v_manager);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (f.v_brand, v_scanner, 'scanner', now()),
         (f.v_brand, v_marketer, 'marketing_manager', now()),
         (f.v_brand, v_manager, 'event_manager', now());
  PERFORM set_config('request.jwt.claim.sub', v_scanner::text, true);
  v_refused := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.business_event_buyer_notice_status(f.v_event);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM = 'insufficient_event_permission';
  END;
  RESET ROLE;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'TE-03 FAIL: a scanner read the buyer notice status';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  SET LOCAL ROLE authenticated;
  v_status := public.business_event_buyer_notice_status(f.v_event);
  RESET ROLE;
  IF (v_status ->> 'audience')::integer <> 2 THEN
    RAISE EXCEPTION 'TE-03 FAIL: an event manager could not read the status';
  END IF;

  -- One recipient per queued row: no row carries another buyer's address.
  IF EXISTS (SELECT 1 FROM public.rsvp_notifications AS n
              WHERE n.event_id = f.v_event
                AND n.payload::text LIKE '%ada-private%' AND n.payload::text LIKE '%ben-private%') THEN
    RAISE EXCEPTION 'TE-03 FAIL: a queued row carries two buyers'' addresses';
  END IF;
  RAISE NOTICE 'TE-03 PASS: anon and signed-in hosts reach no table, switch or internal function; the status read is counts only and refuses a scanner';
END $te03$;
ROLLBACK;

-- ─── TF-01: who is a recipient, counted once ─────────────────────────────────
BEGIN;
DO $tf01$
DECLARE
  f record;
  r record;
  v_app_user uuid := gen_random_uuid();
  v_order uuid;
  v_notice public.event_edit_notices%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('tf01');
  -- The same person on two orders, in different case and with stray spaces.
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'Ada.Lovelace@Example.TEST', 'Ada');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, '  ada.lovelace@example.test ', 'Ada L');
  -- A door sale with no address, and one with a blank address.
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, NULL, 'Door One');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, '   ', 'Door Two');
  -- A ticket handed to someone else: the attendee has their own address.
  v_order := pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'giver@example.test', 'Giver');
  UPDATE public.tickets SET attendee_email = 'Receiver@example.test', attendee_name = 'Receiver',
         status = 'transferred' WHERE order_id = v_order;
  -- Not buyers: refunded, and a void ticket on a cancelled order.
  v_order := pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'refunded@example.test');
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_order;
  UPDATE public.tickets SET status = 'refunded' WHERE order_id = v_order;

  -- The rows are the count, on the same data, as the owner.
  SELECT count(*) INTO v_n FROM public.business_event_buyer_rows(f.v_event);
  IF v_n IS DISTINCT FROM public.business_event_buyer_count(f.v_event) THEN
    RAISE EXCEPTION 'TF-01 FAIL: business_event_buyer_rows has % rows, business_event_buyer_count says %',
      v_n, public.business_event_buyer_count(f.v_event);
  END IF;

  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;

  -- ada (once), giver, receiver: three rows. Two door sales: no address.
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) <> 3
     OR (SELECT count(DISTINCT payload ->> 'recipientEmail') FROM public.rsvp_notifications WHERE event_id = f.v_event) <> 3
     OR EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = f.v_event
                 AND payload ->> 'recipientEmail' NOT IN ('ada.lovelace@example.test', 'giver@example.test', 'receiver@example.test')) THEN
    RAISE EXCEPTION 'TF-01 FAIL: expected one row each for ada, giver and receiver, got %',
      (SELECT jsonb_agg(payload ->> 'recipientEmail') FROM public.rsvp_notifications WHERE event_id = f.v_event);
  END IF;
  IF v_notice.no_email_count <> 2 OR v_notice.audience_count <> 5 THEN
    RAISE EXCEPTION 'TF-01 FAIL: expected 5 people, 2 of them without an address (got %, %)',
      v_notice.audience_count, v_notice.no_email_count;
  END IF;
  -- Email only, exactly one delivery each.
  IF (SELECT count(*) FROM public.rsvp_notification_deliveries AS d
        JOIN public.rsvp_notifications AS n ON n.id = d.notification_id
       WHERE n.event_id = f.v_event) <> 3
     OR EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries AS d
                  JOIN public.rsvp_notifications AS n ON n.id = d.notification_id
                 WHERE n.event_id = f.v_event AND d.channel <> 'email') THEN
    RAISE EXCEPTION 'TF-01 FAIL: a buyer row seeded something other than one email delivery';
  END IF;

  -- RSVP: going and approved only. Waitlisted, pending approval, denied and
  -- not-going guests are not recipients.
  SELECT * INTO r FROM pg_temp.t3827e_rsvp('tf01r');
  INSERT INTO public.event_rsvps(event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (r.v_event, 'Waiting', 'waitlisted@example.test', '+15550000001', 'waitlisted', 'approved'),
         (r.v_event, 'Pending', 'pending@example.test', '+15550000002', 'going', 'pending'),
         (r.v_event, 'Denied', 'denied@example.test', '+15550000003', 'going', 'denied'),
         (r.v_event, 'Not going', 'notgoing@example.test', '+15550000004', 'not_going', 'approved'),
         (r.v_event, 'Not going', 'notgoing2@example.test', '+15550000006', 'not_going', 'pending');
  -- A going guest who is an app user with no address: still owed an alert.
  INSERT INTO auth.users(id, email) VALUES (v_app_user, 't3827e-app-' || v_app_user || '@example.test');
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (r.v_event, v_app_user, 'App user', NULL, NULL, 'going', 'approved');
  SELECT count(*) INTO v_n FROM public.business_event_buyer_rows(r.v_event);
  PERFORM set_config('request.jwt.claim.sub', r.v_user::text, true);
  IF v_n <> 2 OR v_n IS DISTINCT FROM public.business_event_buyer_count(r.v_event) THEN
    RAISE EXCEPTION 'TF-01 FAIL: expected the 2 going and approved guests only, rows % count %',
      v_n, public.business_event_buyer_count(r.v_event);
  END IF;
  PERFORM pg_temp.t3827e_go_live(r.v_brand);
  PERFORM public.biz_update_live_rsvp(r.v_event, jsonb_build_object('title', 'T3827E RSVP',
    'location', jsonb_build_object('venueName', 'The Bedford Hall', 'address', '61 Wythe Avenue, Brooklyn')),
    'Moving to a bigger room for everyone');
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = r.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  IF EXISTS (SELECT 1 FROM public.rsvp_notifications AS n
              WHERE n.event_id = r.v_event
                AND n.payload::text ~* 'waitlisted@|pending@|denied@|notgoing@|\+1555000000[1-4]')
     OR (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = r.v_event AND payload ? 'noticeId') <> 2 THEN
    RAISE EXCEPTION 'TF-01 FAIL: a waitlisted, pending, denied or not-going guest was queued, or a going guest was missed (%)',
      (SELECT jsonb_agg(payload - 'noticeId') FROM public.rsvp_notifications WHERE event_id = r.v_event);
  END IF;
  RAISE NOTICE 'TF-01 PASS: one row per distinct address whatever the case; door sales counted as no address; attendee and buyer both told; only going and approved guests';
END $tf01$;
ROLLBACK;

-- ─── TF-02: allowlist-only, attacked ─────────────────────────────────────────
BEGIN;
DO $tf02$
DECLARE
  f record;
  r record;
  v_app_user uuid := gen_random_uuid();
  v_notice public.event_edit_notices%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('tf02');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'Tester.Inbox@Example.test', 'Tester');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'tester.inbox+real@example.test', 'Plus');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'xtester.inbox@example.test', 'Prefix');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'tester.inbox@example.test.evil.test', 'Suffix');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, NULL, 'Door');
  PERFORM pg_temp.t3827e_go_live(f.v_brand, true);
  INSERT INTO public.event_update_email_allowlist(email) VALUES ('tester.inbox@example.test');
  -- The allowlist only holds lower-case, trimmed addresses.
  BEGIN
    INSERT INTO public.event_update_email_allowlist(email) VALUES ('Mixed@Example.test');
    RAISE EXCEPTION 'TF-02 FAIL: the allowlist accepted a mixed-case address that could never match';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) <> 1
     OR (SELECT payload ->> 'recipientEmail' FROM public.rsvp_notifications WHERE event_id = f.v_event)
          IS DISTINCT FROM 'tester.inbox@example.test'
     OR (SELECT count(*) FROM public.rsvp_notification_deliveries AS d
           JOIN public.rsvp_notifications AS n ON n.id = d.notification_id WHERE n.event_id = f.v_event) <> 1
     OR v_notice.held_count <> 3 THEN
    RAISE EXCEPTION 'TF-02 FAIL: allowlist-only let a look-alike through or miscounted (rows %, held %)',
      (SELECT jsonb_agg(payload ->> 'recipientEmail') FROM public.rsvp_notifications WHERE event_id = f.v_event),
      v_notice.held_count;
  END IF;

  -- The allowlist switch row is missing: still allowlist-only.
  DELETE FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  DELETE FROM public.event_update_email_allowlist;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'A Third Room')),
    'The second room fell through too', f.v_revision + 2);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second', fanned_out_at = now() - interval '1 hour'
   WHERE event_id = f.v_event AND state IN ('scheduled', 'fanned_out');
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = f.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) <> 1 THEN
    RAISE EXCEPTION 'TF-02 FAIL: with the allowlist switch row missing and an empty allowlist, a buyer was queued';
  END IF;

  -- An RSVP in the pilot with allowlist-only on: a guest who is not on the
  -- list gets no row on ANY channel (no text, no push either).
  SELECT * INTO r FROM pg_temp.t3827e_rsvp('tf02r');
  INSERT INTO public.feature_flags(flag_key, is_enabled) VALUES ('event_update_buyer_email_allowlist_only', true)
    ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
  INSERT INTO public.event_update_email_pilot_brands(brand_id) VALUES (r.v_brand);
  INSERT INTO auth.users(id, email) VALUES (v_app_user, 't3827e-app-' || v_app_user || '@example.test');
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (r.v_event, v_app_user, 'App user', NULL, NULL, 'going', 'approved');
  PERFORM public.biz_update_live_rsvp(r.v_event, jsonb_build_object('title', 'T3827E RSVP',
    'location', jsonb_build_object('venueName', 'The Bedford Hall', 'address', '61 Wythe Avenue, Brooklyn')),
    'Moving to a bigger room for everyone');
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = r.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = r.v_event;
  IF EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = r.v_event AND payload ? 'noticeId')
     OR v_notice.held_count <> 2 THEN
    RAISE EXCEPTION 'TF-02 FAIL: allowlist-only queued an RSVP guest who is not on the list (held %)', v_notice.held_count;
  END IF;
  RAISE NOTICE 'TF-02 PASS: allowlist-only matches the whole lower-cased address only, fails closed without its switch row, and holds off-list RSVP guests on every channel';
END $tf02$;
ROLLBACK;

-- ─── TG-01: the fan-out and a retried delivery never make a second row ───────
BEGIN;
DO $tg01$
DECLARE
  f record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_keys text;
  v_claim record;
  v_rows integer;
  v_deliveries integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827e_event('tg01');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ada@example.test', 'Ada');
  PERFORM pg_temp.t3827e_buyer(f.v_event, f.v_tier, 'ben@example.test', 'Ben');
  PERFORM pg_temp.t3827e_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  SELECT string_agg(idempotency_key, ',' ORDER BY idempotency_key), count(*) INTO v_keys, v_rows
    FROM public.rsvp_notifications WHERE event_id = f.v_event;
  SELECT count(*) INTO v_deliveries FROM public.rsvp_notification_deliveries AS d
    JOIN public.rsvp_notifications AS n ON n.id = d.notification_id WHERE n.event_id = f.v_event;
  IF v_rows <> 2 OR v_deliveries <> 2
     OR v_keys IS DISTINCT FROM (SELECT string_agg(k, ',' ORDER BY k) FROM (VALUES
          ('event_edit:' || v_notice.id::text || ':' || md5('ada@example.test')),
          ('event_edit:' || v_notice.id::text || ':' || md5('ben@example.test'))) AS t(k)) THEN
    RAISE EXCEPTION 'TG-01 FAIL: the keys are not event_edit:<notice>:<md5 of the lower-cased address> (%)', v_keys;
  END IF;

  -- The fan-out again, and again after the notice is forced back to waiting
  -- (as if the worker had died between the rows and the state change).
  PERFORM public.event_edit_notice_fanout(20);
  UPDATE public.event_edit_notices SET state = 'scheduled', send_after = now() - interval '1 second',
         fanned_out_at = NULL WHERE id = v_notice.id;
  PERFORM public.event_edit_notice_fanout(20);
  -- A buyer changes the case of their address between two runs.
  UPDATE public.orders SET buyer_email = 'ADA@EXAMPLE.TEST' WHERE event_id = f.v_event AND buyer_email = 'ada@example.test';
  UPDATE public.event_edit_notices SET state = 'scheduled', send_after = now() - interval '1 second',
         fanned_out_at = NULL WHERE id = v_notice.id;
  PERFORM public.event_edit_notice_fanout(20);
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) <> 2
     OR (SELECT string_agg(idempotency_key, ',' ORDER BY idempotency_key) FROM public.rsvp_notifications
          WHERE event_id = f.v_event) IS DISTINCT FROM v_keys
     OR (SELECT count(*) FROM public.rsvp_notification_deliveries AS d
           JOIN public.rsvp_notifications AS n ON n.id = d.notification_id WHERE n.event_id = f.v_event) <> 2 THEN
    RAISE EXCEPTION 'TG-01 FAIL: a repeated fan-out added a row or a delivery, or changed a key';
  END IF;

  -- A delivery that fails and is retried is the same row, attempted again.
  UPDATE public.rsvp_notification_deliveries AS d SET next_attempt_at = now() - interval '1 second'
    FROM public.rsvp_notifications AS n WHERE n.id = d.notification_id AND n.event_id = f.v_event;
  FOR v_claim IN
    SELECT * FROM public.claim_rsvp_notification_deliveries(NULL, 50) AS c
     WHERE c.notification_id IN (SELECT id FROM public.rsvp_notifications WHERE event_id = f.v_event)
  LOOP
    PERFORM public.finish_rsvp_notification_delivery(v_claim.delivery_id, v_claim.lease_id,
      'failed_retryable', NULL, 'provider_rate_limited');
  END LOOP;
  IF (SELECT count(*) FROM public.rsvp_notification_deliveries AS d
        JOIN public.rsvp_notifications AS n ON n.id = d.notification_id WHERE n.event_id = f.v_event) <> 2
     OR EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries AS d
                  JOIN public.rsvp_notifications AS n ON n.id = d.notification_id
                 WHERE n.event_id = f.v_event AND d.status NOT IN ('failed_retryable', 'pending')) THEN
    RAISE EXCEPTION 'TG-01 FAIL: a retried delivery created a second row or was not left retryable (%)',
      (SELECT jsonb_agg(d.status) FROM public.rsvp_notification_deliveries AS d
         JOIN public.rsvp_notifications AS n ON n.id = d.notification_id WHERE n.event_id = f.v_event);
  END IF;
  RAISE NOTICE 'TG-01 PASS: stable keys; a repeated fan-out (even with the notice forced back to waiting, even after a case change) and a retried delivery add nothing';
END $tg01$;
ROLLBACK;

\echo 'issue_3827_live_edit_buyer_email.tester.adversarial: all cases passed'
