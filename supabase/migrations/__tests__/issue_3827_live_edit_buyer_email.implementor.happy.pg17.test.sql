\set ON_ERROR_STOP on

-- Issue #3827 — implementor proof that a material change to a live listing is
-- recorded on the server, that the server alone decides whether buyers are
-- emailed, and that the feature ships switched off without silencing anything
-- that alerts a guest today.
-- Run after the full migration chain on PostgreSQL 17.
--
-- BEFORE. A live edit recorded nothing: the reason was validated and thrown
-- away, and the "we'll email your buyers" promise on screen was a console line.
-- A live RSVP edit queued `rsvp_event_updated` rows with no wording.
--
-- AFTER (20270903003827). Every live edit writes one `event_edit_notices` row.
-- The before-values are captured by triggers at the first write, so a leaf
-- call and a plain table UPDATE are covered too. One email per event after
-- five quiet minutes (15 at most after the first unsent edit, 20 at least
-- after the previous email). Ships off; pilot brands and an allowlist sit
-- behind the switch.
--
-- FAILS-ON-REVERT (replay the chain without 20270903003827): every case fails
-- at its first statement, because `event_edit_notices`, the flags and the
-- functions it calls do not exist. With only the three re-emitted bodies
-- reverted to their 20270828003827 / 20270323001919 text, E-01, E-02, E-03,
-- R-01, R-02, X-01 and S-01 fail (no notice row, no `buyer_notice` key).
--
-- Every case executes the real functions with the payload shape the Business
-- client sends. Each case rolls back. Nothing here sends anything: the suite
-- stops at the delivery ledger rows.

-- A brand, its owner, and a PUBLISHED in-person ticketed event with a venue,
-- an address and one free tier, published through the wizard's entry point.
CREATE OR REPLACE FUNCTION pg_temp.e3827_event(p_tag text, p_hide_address boolean DEFAULT false)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_tier uuid, v_revision integer)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'e3827-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'E3827 ' || p_tag, 'e3827-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_event, v_brand, v_user, 'E3827 draft', 'e3827-draft-' || v_event, 'event', 'draft',
    'draft', 'America/New_York');
  PERFORM public.issue_1719_publish_event_with_poster(v_event, jsonb_build_object(
    'title', 'E3827 night',
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
      'hideAddressUntilTicket', p_hide_address,
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '12 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')))), 1);
  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.status IS DISTINCT FROM 'scheduled'
     OR v_row.theme #>> '{business_event,location,venueName}' IS DISTINCT FROM 'Lantern Room'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'fixture: the published event is not the shape the suite assumes (status %, theme %)',
      v_row.status, v_row.theme -> 'business_event';
  END IF;
  SELECT tt.id INTO v_tier FROM public.ticket_types AS tt
   WHERE tt.event_id = v_event AND tt.deleted_at IS NULL LIMIT 1;
  v_revision := COALESCE((v_row.theme #>> '{business_event,clientRevision}')::integer, 0);
  -- Publishing is not a live edit: it must have recorded nothing.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF EXISTS (SELECT 1 FROM public.event_edit_notices AS n WHERE n.event_id = v_event)
     OR EXISTS (SELECT 1 FROM public.event_edit_notice_pending AS p WHERE p.event_id = v_event) THEN
    RAISE EXCEPTION 'fixture: publishing an event recorded an edit notice or left a capture behind';
  END IF;
  RETURN NEXT;
END;
$fixture$;

-- One paid order with one live ticket.
CREATE OR REPLACE FUNCTION pg_temp.e3827_buyer(p_event uuid, p_tier uuid, p_email text, p_name text DEFAULT 'E3827 Buyer')
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

-- Switch the feature on for one brand, as the rollout does.
CREATE OR REPLACE FUNCTION pg_temp.e3827_go_live(p_brand uuid, p_allowlist_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $live$
BEGIN
  INSERT INTO public.event_update_email_pilot_brands(brand_id) VALUES (p_brand) ON CONFLICT DO NOTHING;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email';
  UPDATE public.feature_flags SET is_enabled = p_allowlist_only
   WHERE flag_key = 'event_update_buyer_email_allowlist_only';
END;
$live$;

-- A brand, its owner, and a PUBLISHED in-person RSVP with one going guest.
CREATE OR REPLACE FUNCTION pg_temp.e3827_rsvp(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_guest uuid)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  v_guest := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'e3827-rsvp-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'E3827 RSVP ' || p_tag, 'e3827-rsvp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'E3827 RSVP', 'e3827-rsvp-draft-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  PERFORM public.business_update_rsvp_graph(v_event, jsonb_build_object(
    '__expectedClientRevision', 1,
    'title', 'E3827 RSVP',
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
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_guest, v_event, 'E3827 Guest', 'e3827-guest-' || v_guest || '@example.test', '+15550003827',
          'going', 'approved');
  RETURN NEXT;
END;
$fixture$;

-- The payload the RSVP editor sends for a live save, with the venue given.
CREATE OR REPLACE FUNCTION pg_temp.e3827_rsvp_payload(p_venue text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'E3827 RSVP',
    'location', jsonb_build_object('venueName', p_venue, 'address', '61 Wythe Avenue, Brooklyn'))
$payload$;

-- A brand, its owner, and a PUBLISHED two-stop free experience.
CREATE OR REPLACE FUNCTION pg_temp.e3827_experience(p_tag text)
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
  INSERT INTO auth.users(id, email) VALUES (v_user, 'e3827-exp-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'E3827 Exp ' || p_tag, 'e3827-exp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode, experience_intents, experience_intent)
  VALUES (v_event, v_brand, v_user, 'E3827 walk', 'A walk through two rooms for the suite.',
    'e3827-exp-' || v_event, 'experience', 'draft', 'draft', 'America/New_York', 'USD',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, v_start, v_start + interval '3 hours', 'America/New_York', true);
  INSERT INTO public.experience_stops(event_id, stop_order, place_id, place_name, address, lat, lng, start_time)
  VALUES (v_event, 0, 'place-one', 'First Room', '11 Secret Lane, Brooklyn', 40.71001, -73.95001, '18:00'),
         (v_event, 1, 'place-two', 'Second Room', '22 Hidden Row, Brooklyn', 40.72002, -73.96002, '19:30');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, is_free, display_order)
  VALUES (v_tier, v_event, 'Spot', 0, true, 0);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = v_event;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF EXISTS (SELECT 1 FROM public.event_edit_notices AS n WHERE n.event_id = v_event) THEN
    RAISE EXCEPTION 'fixture: building a draft experience and publishing it recorded an edit notice';
  END IF;
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.e3827_experience_payload(
  p_date text, p_second_address text DEFAULT '22 Hidden Row, Brooklyn',
  p_second_time text DEFAULT '19:30')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'E3827 walk',
    'description', 'A walk through two rooms for the suite.',
    'experience_intents', jsonb_build_array('group-fun'),
    'location_mode', 'per_stop',
    'pricing_mode', 'whole',
    'is_free', true,
    'timezone', 'America/New_York',
    'whenMode', 'single',
    'when', jsonb_build_object('date', p_date, 'doorsOpen', '18:00', 'endsAt', '21:00'),
    'stops', jsonb_build_array(
      jsonb_build_object('place_id', 'place-one', 'place_name', 'First Room',
        'address', '11 Secret Lane, Brooklyn', 'lat', 40.71001, 'lng', -73.95001, 'start_time', '18:00'),
      jsonb_build_object('place_id', 'place-two', 'place_name', 'Second Room',
        'address', p_second_address, 'lat', 40.72002, 'lng', -73.96002, 'start_time', p_second_time)))
$payload$;

-- ─── B-01: the buyer rows are the buyer count, and people are counted once ────
BEGIN;
DO $b01$
DECLARE
  f record;
  v_gone uuid;
  v_rows integer;
  v_count integer;
  v_recipients integer;
  v_no_email integer;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('b01');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'Ada@Example.test');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ben@example.test');
  -- A door sale with no address: one order, one ticket.
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, NULL);
  -- Not buyers: a refunded order with a refunded ticket.
  v_gone := pg_temp.e3827_buyer(f.v_event, f.v_tier, 'gone@example.test');
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_gone;
  UPDATE public.tickets AS t SET status = 'refunded'
    FROM public.orders AS o
   WHERE o.id = t.order_id AND o.event_id = f.v_event AND o.payment_status = 'refunded';

  SELECT count(*) INTO v_rows FROM public.business_event_buyer_rows(f.v_event);
  v_count := public.business_event_buyer_count(f.v_event);
  IF v_rows IS DISTINCT FROM v_count OR v_count <> 8 THEN
    RAISE EXCEPTION 'B-01 FAIL: business_event_buyer_rows returned % rows, business_event_buyer_count says % (expected 8 and equal)',
      v_rows, v_count;
  END IF;
  SELECT a.recipients, a.no_email INTO v_recipients, v_no_email
    FROM public.event_edit_notice_audience(f.v_event) AS a;
  IF v_recipients <> 2 OR v_no_email <> 1 THEN
    RAISE EXCEPTION 'B-01 FAIL: expected 2 distinct addresses and 1 buyer with none, got % and %',
      v_recipients, v_no_email;
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_event_buyer_rows(f.v_event) AS b WHERE b.email = 'gone@example.test') THEN
    RAISE EXCEPTION 'B-01 FAIL: a refunded buyer is in the buyer rows';
  END IF;
  RAISE NOTICE 'B-01 PASS: buyer rows equal the buyer count, and 2 addresses plus 1 buyer without one are counted once each';
END $b01$;
ROLLBACK;

-- ─── E-01: a material change with buyers schedules ONE notice; fan-out writes
--     one row per distinct address; a second fan-out writes nothing ───────────
BEGIN;
DO $e01$
DECLARE
  f record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
  v_fan jsonb;
  v_n integer;
  v_status jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('e01');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'Ada@Example.test', 'Ada');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test', 'Ada');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ben@example.test', 'Ben');
  PERFORM pg_temp.e3827_go_live(f.v_brand);

  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);

  IF v_result #>> '{buyer_notice,state}' IS DISTINCT FROM 'scheduled'
     OR (v_result #>> '{buyer_notice,audience}')::integer IS DISTINCT FROM 2
     OR (v_result #>> '{buyer_notice,live}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'E-01 FAIL: the save did not answer with a scheduled notice for 2 buyers (%)',
      v_result -> 'buyer_notice';
  END IF;
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'E-01 FAIL: % notice rows for one edit (expected 1)', v_n;
  END IF;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF v_notice.reason IS DISTINCT FROM 'The first room has a power fault'
     OR v_notice.edited_by IS DISTINCT FROM f.v_user
     OR v_notice.source IS DISTINCT FROM 'event'
     OR v_notice.brand_id IS DISTINCT FROM f.v_brand THEN
    RAISE EXCEPTION 'E-01 FAIL: the notice does not hold the actor, the reason and the source (%, %, %)',
      v_notice.edited_by, v_notice.reason, v_notice.source;
  END IF;
  IF v_notice.changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
       'field', 'venue', 'old', 'Lantern Room', 'new', 'The Bedford Hall'))
     OR v_notice.notice_changes IS DISTINCT FROM v_notice.changes THEN
    RAISE EXCEPTION 'E-01 FAIL: the old and new values are not stored as expected (%)', v_notice.changes;
  END IF;
  IF v_notice.send_after IS DISTINCT FROM now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'E-01 FAIL: the first notice is not sent after five quiet minutes (%)', v_notice.send_after - now();
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'E-01 FAIL: the flush left the capture behind';
  END IF;

  -- Not due yet: fan-out writes nothing.
  v_fan := public.event_edit_notice_fanout(20);
  IF (v_fan ->> 'rows')::integer <> 0 THEN
    RAISE EXCEPTION 'E-01 FAIL: fan-out sent before the quiet window ended (%)', v_fan;
  END IF;

  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE id = v_notice.id;
  v_fan := public.event_edit_notice_fanout(20);
  SELECT count(*) INTO v_n FROM public.rsvp_notifications AS n
   WHERE n.payload ->> 'noticeId' = v_notice.id::text;
  IF v_n <> 2 OR (v_fan ->> 'rows')::integer <> 2 THEN
    RAISE EXCEPTION 'E-01 FAIL: fan-out wrote % rows for 2 distinct addresses (%)', v_n, v_fan;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rsvp_notifications AS n
     WHERE n.payload ->> 'noticeId' = v_notice.id::text
       AND (n.template_key <> 'buyer_event_updated'
            OR n.rsvp_id IS NOT NULL
            OR n.idempotency_key <> 'event_edit:' || v_notice.id::text || ':' || md5(n.payload ->> 'recipientEmail')
            OR n.payload ->> 'recipientEmail' NOT IN ('ada@example.test', 'ben@example.test'))) THEN
    RAISE EXCEPTION 'E-01 FAIL: a fan-out row has the wrong template, key or address';
  END IF;
  -- Email only: no text message, push or in-app row is seeded for a buyer.
  IF EXISTS (
    SELECT 1 FROM public.rsvp_notification_deliveries AS d
      JOIN public.rsvp_notifications AS n ON n.id = d.notification_id
     WHERE n.payload ->> 'noticeId' = v_notice.id::text AND d.channel <> 'email')
     OR (SELECT count(*) FROM public.rsvp_notification_deliveries AS d
           JOIN public.rsvp_notifications AS n ON n.id = d.notification_id
          WHERE n.payload ->> 'noticeId' = v_notice.id::text AND d.channel = 'email') <> 2 THEN
    RAISE EXCEPTION 'E-01 FAIL: a buyer row must seed exactly one email delivery and no other channel';
  END IF;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE id = v_notice.id;
  IF v_notice.state <> 'fanned_out' OR v_notice.fanned_out_at IS NULL OR v_notice.audience_count <> 2 THEN
    RAISE EXCEPTION 'E-01 FAIL: the notice was not marked fanned out for 2 (%, %)', v_notice.state, v_notice.audience_count;
  END IF;

  -- A second fan-out inserts nothing.
  v_fan := public.event_edit_notice_fanout(20);
  SELECT count(*) INTO v_n FROM public.rsvp_notifications AS n
   WHERE n.payload ->> 'noticeId' = v_notice.id::text;
  IF v_n <> 2 OR (v_fan ->> 'rows')::integer <> 0 THEN
    RAISE EXCEPTION 'E-01 FAIL: a second fan-out wrote rows (% in the ledger, %)', v_n, v_fan;
  END IF;

  -- The host sees counts only.
  v_status := public.business_event_buyer_notice_status(f.v_event);
  IF (v_status ->> 'live')::boolean IS DISTINCT FROM true
     OR (v_status ->> 'audience')::integer <> 2
     OR v_status #>> '{last,state}' IS DISTINCT FROM 'fanned_out'
     OR (v_status #>> '{last,pending}')::integer <> 2
     OR (v_status #>> '{last,sent}')::integer <> 0
     OR v_status::text LIKE '%example.test%' THEN
    RAISE EXCEPTION 'E-01 FAIL: the host status is wrong or carries an address (%)', v_status;
  END IF;
  RAISE NOTICE 'E-01 PASS: one scheduled notice with the reason and the old and new venue; one email row per distinct address; a second fan-out adds nothing';
END $e01$;
ROLLBACK;

-- ─── E-02: an edit that changes nothing a buyer acts on is only logged, and so
--     is a material change nobody has booked ───────────────────────────────────
BEGIN;
DO $e02$
DECLARE
  f record;
  g record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('e02a');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand);
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('description', 'A longer description of the night.')),
    'Adding detail to the description', f.v_revision + 1);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF NOT FOUND OR v_notice.state <> 'logged' OR v_notice.changes <> '[]'::jsonb
     OR v_notice.reason IS DISTINCT FROM 'Adding detail to the description'
     OR v_result #>> '{buyer_notice,state}' IS DISTINCT FROM 'logged' THEN
    RAISE EXCEPTION 'E-02 FAIL: a description edit was not recorded as logged with its reason (%, %)',
      v_notice.state, v_result -> 'buyer_notice';
  END IF;

  SELECT * INTO g FROM pg_temp.e3827_event('e02b');
  PERFORM pg_temp.e3827_go_live(g.v_brand);
  v_result := public.business_update_live_event_atomic(g.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    NULL, g.v_revision + 1);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = g.v_event;
  IF NOT FOUND OR v_notice.state <> 'logged' OR jsonb_array_length(v_notice.changes) <> 1
     OR v_notice.send_after IS NOT NULL THEN
    RAISE EXCEPTION 'E-02 FAIL: a venue change nobody has booked was not simply logged (%, %)',
      v_notice.state, v_notice.changes;
  END IF;
  IF (public.event_edit_notice_fanout(20) ->> 'rows')::integer <> 0 THEN
    RAISE EXCEPTION 'E-02 FAIL: a logged notice was fanned out';
  END IF;
  RAISE NOTICE 'E-02 PASS: a non-material edit and a material edit with no buyers are logged and send nothing';
END $e02$;
ROLLBACK;

-- ─── E-03: with the feature flag OFF (as shipped) the edit is held ─────────────
BEGIN;
DO $e03$
DECLARE
  f record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
BEGIN
  IF (SELECT is_enabled FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email') IS DISTINCT FROM false
     OR (SELECT is_enabled FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email_all_brands') IS DISTINCT FROM false
     OR (SELECT is_enabled FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email_allowlist_only') IS DISTINCT FROM true
     OR EXISTS (SELECT 1 FROM public.event_update_email_pilot_brands)
     OR EXISTS (SELECT 1 FROM public.event_update_email_allowlist) THEN
    RAISE EXCEPTION 'E-03 FAIL: the feature does not ship off, allowlist-only, with an empty pilot and allowlist';
  END IF;
  SELECT * INTO f FROM pg_temp.e3827_event('e03');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF NOT FOUND OR v_notice.state <> 'held' OR v_notice.hold_code IS DISTINCT FROM 'feature_off'
     OR v_notice.send_after IS NOT NULL
     OR v_notice.reason IS DISTINCT FROM 'The first room has a power fault'
     OR (v_result #>> '{buyer_notice,live}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'E-03 FAIL: with the flag off the edit was not recorded as held / feature_off (%, %, %)',
      v_notice.state, v_notice.hold_code, v_result -> 'buyer_notice';
  END IF;
  -- The master switch alone is not enough: the brand is outside the pilot.
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email';
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'A Third Room')),
    'The second room fell through too', f.v_revision + 2);
  IF v_result #>> '{buyer_notice,hold_code}' IS DISTINCT FROM 'feature_off' THEN
    RAISE EXCEPTION 'E-03 FAIL: a brand outside the pilot was treated as live (%)', v_result -> 'buyer_notice';
  END IF;
  IF (public.event_edit_notice_fanout(20) ->> 'rows')::integer <> 0
     OR EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'E-03 FAIL: a held notice produced a delivery row';
  END IF;
  IF (public.business_event_buyer_notice_status(f.v_event) ->> 'live')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'E-03 FAIL: the host is told buyer emails are on';
  END IF;
  RAISE NOTICE 'E-03 PASS: flag off, or brand outside the pilot, records held / feature_off and sends nothing';
END $e03$;
ROLLBACK;

-- ─── E-04: allowlist-only keeps an off-list recipient from getting a delivery,
--     and switching the feature off stops a notice that is already waiting ─────
BEGIN;
DO $e04$
DECLARE
  f record;
  g record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('e04');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'on-list@example.test');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'off-list@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand, true);
  INSERT INTO public.event_update_email_allowlist(email) VALUES ('on-list@example.test');
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  SELECT count(*) INTO v_n FROM public.rsvp_notifications WHERE event_id = f.v_event;
  IF v_n <> 1 OR v_notice.state <> 'fanned_out' OR v_notice.held_count <> 1
     OR EXISTS (SELECT 1 FROM public.rsvp_notifications
                 WHERE event_id = f.v_event AND payload ->> 'recipientEmail' = 'off-list@example.test')
     OR EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries AS d
                  JOIN public.rsvp_notifications AS n ON n.id = d.notification_id
                 WHERE n.event_id = f.v_event AND n.payload ->> 'recipientEmail' <> 'on-list@example.test') THEN
    RAISE EXCEPTION 'E-04 FAIL: allowlist-only did not keep the off-list buyer out (% rows, held %)',
      v_n, v_notice.held_count;
  END IF;

  -- The kill switch is re-read at fan-out.
  SELECT * INTO g FROM pg_temp.e3827_event('e04b');
  PERFORM pg_temp.e3827_buyer(g.v_event, g.v_tier, 'on-list@example.test');
  INSERT INTO public.event_update_email_pilot_brands(brand_id) VALUES (g.v_brand);
  PERFORM public.business_update_live_event_atomic(g.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', g.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = g.v_event;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email';
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = g.v_event;
  IF v_notice.state <> 'held' OR v_notice.hold_code IS DISTINCT FROM 'feature_off'
     OR EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = g.v_event) THEN
    RAISE EXCEPTION 'E-04 FAIL: switching the feature off did not stop a waiting notice (%, %)',
      v_notice.state, v_notice.hold_code;
  END IF;
  RAISE NOTICE 'E-04 PASS: an off-list buyer gets no delivery row and is counted as held; the kill switch stops a waiting notice';
END $e04$;
ROLLBACK;

-- ─── E-05: an event that hides its address never has a street stored ─────────
BEGIN;
DO $e05$
DECLARE
  f record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_text text;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('e05', true);
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object(
      'core', jsonb_build_object('venueName', 'The Bedford Hall'),
      'taxonomy', jsonb_build_object(
        'city', 'Brooklyn',
        'partyTypes', jsonb_build_array('festival'),
        'vibeTags', jsonb_build_array('social'),
        'musicGenres', '[]'::jsonb,
        'locationGeo', jsonb_build_object('lat', 40.7081, 'lng', -73.9571),
        'locationText', '250 Bedford Avenue, Brooklyn',
        'coordinatePrecision', 'approximate')),
    'Moving the night to the new room', f.v_revision + 1);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  v_text := row_to_json(v_notice)::text;
  IF v_notice.state <> 'scheduled' THEN
    RAISE EXCEPTION 'E-05 FAIL: the change was not scheduled (%)', v_notice.state;
  END IF;
  IF v_text LIKE '%Wythe%' OR v_text LIKE '%Bedford Avenue%' THEN
    RAISE EXCEPTION 'E-05 FAIL: a street address of a hide-address event was stored in the notice: %', v_text;
  END IF;
  IF NOT (v_notice.notice_changes @> jsonb_build_array(jsonb_build_object('field', 'address', 'withheld', true)))
     OR NOT (v_notice.notice_changes @> jsonb_build_array(jsonb_build_object(
          'field', 'venue', 'old', 'Lantern Room', 'new', 'The Bedford Hall'))) THEN
    RAISE EXCEPTION 'E-05 FAIL: expected the venue names and a withheld address marker (%)', v_notice.notice_changes;
  END IF;
  RAISE NOTICE 'E-05 PASS: a hide-address event stores the venue names and "address changed", never a street';
END $e05$;
ROLLBACK;

-- ─── E-06: the 5 / 15 / 20 minute rule, merging, and "refund all" ─────────────
BEGIN;
DO $e06$
DECLARE
  f record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_first uuid;
  v_n integer;
  v_result jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('e06');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand);

  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Two')),
    'The first room has a power fault', f.v_revision + 1);
  SELECT id INTO v_first FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  -- Pretend that first edit was 12 minutes ago.
  UPDATE public.event_edit_notices
     SET first_unsent_at = now() - interval '12 minutes', created_at = now() - interval '12 minutes'
   WHERE id = v_first;

  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Three')),
    'The second room fell through too', f.v_revision + 2);
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF v_n <> 1 OR v_notice.id = v_first THEN
    RAISE EXCEPTION 'E-06 FAIL: a second edit must leave exactly one waiting notice, a new one (% waiting)', v_n;
  END IF;
  IF (SELECT state FROM public.event_edit_notices WHERE id = v_first) <> 'superseded'
     OR (SELECT superseded_by FROM public.event_edit_notices WHERE id = v_first) IS DISTINCT FROM v_notice.id THEN
    RAISE EXCEPTION 'E-06 FAIL: the first notice was not superseded by the second';
  END IF;
  -- One email: the FIRST old value against the LAST new one, the latest reason.
  IF v_notice.notice_changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
       'field', 'venue', 'old', 'Lantern Room', 'new', 'Room Three'))
     OR v_notice.changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
       'field', 'venue', 'old', 'Room Two', 'new', 'Room Three'))
     OR v_notice.reason IS DISTINCT FROM 'The second room fell through too' THEN
    RAISE EXCEPTION 'E-06 FAIL: the merged notice is not first-old to last-new with the latest reason (%, %)',
      v_notice.notice_changes, v_notice.reason;
  END IF;
  -- Never more than 15 minutes after the first unsent edit: 3 minutes left.
  IF v_notice.send_after IS DISTINCT FROM now() + interval '3 minutes' THEN
    RAISE EXCEPTION 'E-06 FAIL: the 15 minute cap was not applied (send in %)', v_notice.send_after - now();
  END IF;

  -- Put back to what buyers last knew: nothing left to send.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Lantern Room')),
    'Back in the first room after all', f.v_revision + 3);
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') THEN
    RAISE EXCEPTION 'E-06 FAIL: an edit that was put back still has an email waiting';
  END IF;

  -- Never within 20 minutes of the previous email for this event.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Four')),
    'A better room became available', f.v_revision + 4);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = f.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  UPDATE public.event_edit_notices SET fanned_out_at = now() - interval '4 minutes'
   WHERE event_id = f.v_event AND state = 'fanned_out';
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Five')),
    'One more move, sorry everyone', f.v_revision + 5);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF v_notice.send_after IS DISTINCT FROM now() + interval '16 minutes' THEN
    RAISE EXCEPTION 'E-06 FAIL: the 20 minute spacing was not applied (send in %)', v_notice.send_after - now();
  END IF;
  IF v_notice.notice_changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
       'field', 'venue', 'old', 'Room Four', 'new', 'Room Five')) THEN
    RAISE EXCEPTION 'E-06 FAIL: after an email went out the next one must start from what was sent (%)',
      v_notice.notice_changes;
  END IF;

  -- "Refund all and proceed" holds the email, and the one already waiting.
  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = f.v_event;
  v_result := public.event_edit_notice_flush(f.v_event, 'Moving the date and refunding everyone', 'event', true);
  IF v_result ->> 'state' IS DISTINCT FROM 'held' OR v_result ->> 'hold_code' IS DISTINCT FROM 'refund_all'
     OR EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') THEN
    RAISE EXCEPTION 'E-06 FAIL: a refund-all save did not hold the email (%)', v_result;
  END IF;
  RAISE NOTICE 'E-06 PASS: 5 minute quiet window, 15 minute cap, 20 minute spacing, first-old to last-new, a revert sends nothing, refund-all holds';
END $e06$;
ROLLBACK;

-- ─── R-01: flag OFF — a live RSVP edit still queues today's rows, exactly ─────
BEGIN;
DO $r01$
DECLARE
  f record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r01');
  v_result := public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Moving to a bigger room for everyone');
  IF (v_result ->> 'ok')::boolean IS DISTINCT FROM true OR (v_result ->> 'notified_count')::integer <> 1 THEN
    RAISE EXCEPTION 'R-01 FAIL: the RSVP edit did not save or did not count its going guest (%)',
      v_result - 'event';
  END IF;
  SELECT count(*) INTO v_n FROM public.rsvp_notifications AS n
   WHERE n.event_id = f.v_event AND n.rsvp_id = f.v_guest
     AND n.template_key = 'rsvp_event_updated'
     AND n.idempotency_key LIKE 'rsvp_update:' || f.v_event::text || ':%:' || f.v_guest::text
     AND NOT (n.payload ? 'noticeId');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R-01 FAIL: with the flag off the legacy rsvp_event_updated row was not queued (% rows): guests went silent', v_n;
  END IF;
  -- The same channels as before: the guest has an address and a phone.
  IF (SELECT count(*) FROM public.rsvp_notification_deliveries AS d
        JOIN public.rsvp_notifications AS n ON n.id = d.notification_id
       WHERE n.event_id = f.v_event AND d.channel IN ('email', 'sms')) <> 2 THEN
    RAISE EXCEPTION 'R-01 FAIL: the legacy row did not seed its email and text deliveries';
  END IF;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF NOT FOUND OR v_notice.state <> 'held' OR v_notice.hold_code IS DISTINCT FROM 'feature_off'
     OR v_notice.source <> 'rsvp' OR v_notice.reason IS DISTINCT FROM 'Moving to a bigger room for everyone'
     OR v_result #>> '{buyer_notice,hold_code}' IS DISTINCT FROM 'feature_off' THEN
    RAISE EXCEPTION 'R-01 FAIL: the RSVP edit was not recorded as held / feature_off (%, %)',
      v_notice.state, v_notice.hold_code;
  END IF;
  -- An unchanged re-save notifies nobody and is only logged.
  v_result := public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Saving again without changing a thing');
  IF (v_result ->> 'notified_count')::integer <> 0
     OR v_result #>> '{buyer_notice,state}' IS DISTINCT FROM 'logged' THEN
    RAISE EXCEPTION 'R-01 FAIL: an unchanged re-save notified guests or was not logged (%)', v_result - 'event';
  END IF;
  RAISE NOTICE 'R-01 PASS: flag off records held / feature_off and the RSVP still queues its legacy row and channels';
END $r01$;
ROLLBACK;

-- ─── R-02: flag ON — the edit notice owns the change; guests keep their channels
BEGIN;
DO $r02$
DECLARE
  f record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
  v_row public.rsvp_notifications%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r02');
  PERFORM pg_temp.e3827_go_live(f.v_brand);
  v_result := public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Moving to a bigger room for everyone');
  IF (v_result ->> 'notified_count')::integer <> 1
     OR v_result #>> '{buyer_notice,state}' IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'R-02 FAIL: expected notified_count 1 and a scheduled notice (%)', v_result - 'event';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'R-02 FAIL: with the notice scheduled the guest was ALSO queued immediately (would be told twice)';
  END IF;
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  SELECT * INTO v_row FROM public.rsvp_notifications WHERE event_id = f.v_event;
  IF NOT FOUND OR v_row.template_key <> 'rsvp_event_updated' OR v_row.rsvp_id IS DISTINCT FROM f.v_guest
     OR v_row.payload ->> 'noticeId' IS DISTINCT FROM v_notice.id::text
     OR v_row.idempotency_key NOT LIKE 'event_edit:' || v_notice.id::text || ':%' THEN
    RAISE EXCEPTION 'R-02 FAIL: the going guest did not get an rsvp_event_updated row tied to the notice';
  END IF;
  IF (SELECT count(*) FROM public.rsvp_notification_deliveries AS d
       WHERE d.notification_id = v_row.id AND d.channel IN ('email', 'sms')) <> 2 THEN
    RAISE EXCEPTION 'R-02 FAIL: the guest lost a channel they have today';
  END IF;
  RAISE NOTICE 'R-02 PASS: flag on, the notice owns the change: one row per going guest, tied to the notice, same channels';
END $r02$;
ROLLBACK;

-- ─── X-01: experiences — equal values record nothing material; a route change
--     is material and no stop address or place name is stored ─────────────────
BEGIN;
DO $x01$
DECLARE
  f record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
  v_text text;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_experience('x01');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand);

  -- A re-save with the same values deletes and re-inserts every date and stop.
  v_result := public.biz_update_live_experience(f.v_event, pg_temp.e3827_experience_payload(f.v_date),
    'Saving again without changing a thing');
  IF (v_result ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'X-01 FAIL: the experience re-save was refused (%)', v_result - 'event';
  END IF;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF NOT FOUND OR v_notice.state <> 'logged' OR v_notice.changes <> '[]'::jsonb
     OR v_notice.source <> 'experience'
     OR v_result #>> '{buyer_notice,state}' IS DISTINCT FROM 'logged' THEN
    RAISE EXCEPTION 'X-01 FAIL: an experience re-save with unchanged values recorded a material change (%, %)',
      v_notice.state, v_notice.changes;
  END IF;

  -- The second stop moves and starts later.
  v_result := public.biz_update_live_experience(f.v_event,
    pg_temp.e3827_experience_payload(f.v_date, '99 Veiled Yard, Brooklyn', '20:00'),
    'That stop is closed on the night');
  SELECT * INTO v_notice FROM public.event_edit_notices
   WHERE event_id = f.v_event AND state = 'scheduled';
  IF NOT FOUND
     OR v_notice.notice_changes IS DISTINCT FROM jsonb_build_array(
          jsonb_build_object('field', 'route'), jsonb_build_object('field', 'stop_times'))
     OR v_result #>> '{buyer_notice,state}' IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'X-01 FAIL: a moved and re-timed stop was not recorded as a route and stop-times change (%)',
      (SELECT jsonb_agg(to_jsonb(n) - 'base_snapshot' - 'after_snapshot') FROM public.event_edit_notices AS n WHERE n.event_id = f.v_event);
  END IF;
  SELECT string_agg(row_to_json(n)::text, ' ') INTO v_text
    FROM public.event_edit_notices AS n WHERE n.event_id = f.v_event;
  IF v_text ~* 'Secret Lane|Hidden Row|Veiled Yard|First Room|Second Room' THEN
    RAISE EXCEPTION 'X-01 FAIL: a stop address or place name was stored in a notice: %', v_text;
  END IF;
  RAISE NOTICE 'X-01 PASS: an unchanged experience re-save is logged with nothing changed; a route change is scheduled with no address or place name stored';
END $x01$;
ROLLBACK;

-- ─── D-01: a draft edit records nothing; a direct write to a live event is
--     recorded once, at commit, as `direct` ────────────────────────────────────
BEGIN;
DO $d01$
DECLARE
  f record;
  v_draft uuid := gen_random_uuid();
  v_n integer;
  v_notice public.event_edit_notices%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('d01');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');

  -- A draft: every watched column, its dates, and a draft experience's stops.
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_draft, f.v_brand, f.v_user, 'E3827 draft two', 'e3827-draft-two-' || v_draft, 'event', 'draft',
    'draft', 'America/New_York');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_draft, now() + interval '9 days', now() + interval '9 days 3 hours', 'America/New_York', true);
  UPDATE public.events SET timezone = 'America/Chicago', location_text = 'Somewhere else',
         online_url = 'https://example.test/room',
         theme = jsonb_build_object('business_draft', jsonb_build_object('format', 'online'))
   WHERE id = v_draft;
  UPDATE public.event_dates SET start_at = start_at + interval '1 day', end_at = end_at + interval '1 day'
   WHERE event_id = v_draft;
  DELETE FROM public.event_dates WHERE event_id = v_draft;
  SELECT count(*) INTO v_n FROM public.event_edit_notice_pending WHERE event_id = v_draft;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF v_n <> 0 OR EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = v_draft) THEN
    RAISE EXCEPTION 'D-01 FAIL: a draft edit was captured or recorded (% captures)', v_n;
  END IF;

  -- A live event: an update that touches no watched column captures nothing.
  UPDATE public.events SET title = 'E3827 night, renamed' WHERE id = f.v_event;
  IF EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'D-01 FAIL: renaming a live event captured its values';
  END IF;

  -- A plain table write of a watched value, with no live-edit function.
  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = f.v_event;
  UPDATE public.events SET timezone = 'America/Denver' WHERE id = f.v_event;
  SELECT count(*) INTO v_n FROM public.event_edit_notice_pending WHERE event_id = f.v_event;
  IF v_n <> 1 OR EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'D-01 FAIL: expected exactly one capture and no notice before commit (% captures)', v_n;
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  SELECT count(*) INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF v_n <> 1 OR v_notice.source <> 'direct' OR v_notice.reason IS NOT NULL
     OR v_notice.edited_by IS DISTINCT FROM f.v_user
     OR v_notice.changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
          'field', 'timezone', 'old', 'America/New_York', 'new', 'America/Denver'))
     OR v_notice.state <> 'held' OR v_notice.hold_code IS DISTINCT FROM 'feature_off' THEN
    RAISE EXCEPTION 'D-01 FAIL: a direct write was not recorded exactly once as direct, first value to last (% rows, %)',
      v_n, to_jsonb(v_notice) - 'base_snapshot' - 'after_snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'D-01 FAIL: the commit trigger left the capture behind';
  END IF;
  RAISE NOTICE 'D-01 PASS: a draft edit records nothing; a direct write to a live event is recorded once at commit';
END $d01$;
ROLLBACK;

-- ─── S-01: the recorder never aborts a save ───────────────────────────────────
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.e3827_break_recorder() RETURNS trigger
LANGUAGE plpgsql AS $break$
BEGIN
  IF NEW.hold_code IS DISTINCT FROM 'recorder_error' THEN
    RAISE EXCEPTION 'e3827: the notice table is broken on purpose';
  END IF;
  RETURN NEW;
END;
$break$;
CREATE TRIGGER e3827_break_recorder BEFORE INSERT ON public.event_edit_notices
  FOR EACH ROW EXECUTE FUNCTION pg_temp.e3827_break_recorder();
DO $s01$
DECLARE
  f record;
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('s01');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand);
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  IF (SELECT theme #>> '{business_event,location,venueName}' FROM public.events WHERE id = f.v_event)
       IS DISTINCT FROM 'The Bedford Hall' THEN
    RAISE EXCEPTION 'S-01 FAIL: the host''s save was lost when the recorder failed';
  END IF;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event;
  IF NOT FOUND OR v_notice.state <> 'held' OR v_notice.hold_code IS DISTINCT FROM 'recorder_error'
     OR v_result #>> '{buyer_notice,hold_code}' IS DISTINCT FROM 'recorder_error' THEN
    RAISE EXCEPTION 'S-01 FAIL: a recorder failure was not recorded as held / recorder_error (%)',
      v_result -> 'buyer_notice';
  END IF;
  -- The same for a direct write settled at commit.
  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = f.v_event;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (SELECT timezone FROM public.events WHERE id = f.v_event) <> 'America/Chicago'
     OR (SELECT count(*) FROM public.event_edit_notices
          WHERE event_id = f.v_event AND hold_code = 'recorder_error') <> 2 THEN
    RAISE EXCEPTION 'S-01 FAIL: a recorder failure at commit aborted the write or left no trace';
  END IF;
  RAISE NOTICE 'S-01 PASS: with the recorder broken the save still lands and the failure is recorded as held / recorder_error';
END $s01$;
ROLLBACK;

-- ─── S-02: who may read what ──────────────────────────────────────────────────
BEGIN;
DO $s02$
DECLARE
  f record;
  v_stranger uuid := gen_random_uuid();
  v_refused boolean;
  v_fn text;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('s02');
  INSERT INTO auth.users(id, email) VALUES (v_stranger, 'e3827-stranger-' || v_stranger || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_stranger);

  FOREACH v_fn IN ARRAY ARRAY[
    'SELECT 1 FROM public.event_edit_notices LIMIT 1',
    'SELECT 1 FROM public.event_edit_notice_pending LIMIT 1',
    'SELECT 1 FROM public.event_update_email_allowlist LIMIT 1',
    'SELECT 1 FROM public.event_update_email_pilot_brands LIMIT 1',
    'INSERT INTO public.event_update_email_allowlist(email) VALUES (''me@example.test'')',
    'SELECT public.event_edit_notice_fanout(1)',
    format('SELECT public.event_edit_notice_flush(%L, ''a reason long enough'', ''event'', false)', f.v_event),
    format('SELECT * FROM public.business_event_buyer_rows(%L)', f.v_event),
    format('SELECT public.business_event_notice_snapshot(%L)', f.v_event)]
  LOOP
    v_refused := false;
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE v_fn;
    EXCEPTION WHEN insufficient_privilege THEN
      v_refused := true;
    END;
    RESET ROLE;
    IF NOT v_refused THEN
      RAISE EXCEPTION 'S-02 FAIL: a signed-in host could run: %', v_fn;
    END IF;
  END LOOP;

  -- The owner may read the status; a stranger and a signed-out caller may not.
  SET LOCAL ROLE authenticated;
  PERFORM public.business_event_buyer_notice_status(f.v_event);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_refused := false;
  BEGIN
    PERFORM public.business_event_buyer_notice_status(f.v_event);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM = 'insufficient_event_permission';
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'S-02 FAIL: a stranger read the notice status of another brand''s event';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_refused := false;
  BEGIN
    PERFORM public.business_event_buyer_notice_status(f.v_event);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM = 'not_authenticated';
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'S-02 FAIL: a signed-out caller read the notice status';
  END IF;
  RAISE NOTICE 'S-02 PASS: the notice tables and internals are closed to hosts; only the brand''s own managers read the status';
END $s02$;
ROLLBACK;

-- ─── P-01 (rework M1): hide-address switched on while an email is WAITING ────
-- Before the fix the waiting notice kept both streets and was sent with them.
BEGIN;
DO $p01$
DECLARE
  f record;
  v_text text;
  v_result jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('p01');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb, 'taxonomy', jsonb_build_object(
      'city', 'Brooklyn', 'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'), 'musicGenres', '[]'::jsonb,
      'locationGeo', jsonb_build_object('lat', 40.7081, 'lng', -73.9571),
      'locationText', '250 Bedford Avenue, Brooklyn', 'coordinatePrecision', 'approximate')),
    'Moving the night to the new room', f.v_revision + 1);
  SELECT string_agg(row_to_json(n)::text, ' ') INTO v_text FROM public.event_edit_notices AS n
   WHERE n.event_id = f.v_event AND n.state = 'scheduled';
  IF v_text IS NULL OR v_text NOT LIKE '%Bedford Avenue%' THEN
    RAISE EXCEPTION 'P-01 FIXTURE: the waiting notice does not carry the new street (%)', v_text;
  END IF;

  -- The host now hides the address. Nothing material changed for buyers.
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('hideAddressUntilTicket', true)),
    'Hiding the address until people have a ticket', f.v_revision + 2);
  SELECT string_agg(row_to_json(n)::text, ' ') INTO v_text FROM public.event_edit_notices AS n
   WHERE n.event_id = f.v_event AND n.state IN ('scheduled', 'superseded');
  IF v_text ~ 'Wythe|Bedford Avenue' THEN
    RAISE EXCEPTION 'P-01 FAIL: a waiting notice still holds a street after the address was hidden: %', v_text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices AS n
                  WHERE n.event_id = f.v_event AND n.state = 'scheduled'
                    AND n.notice_changes @> '[{"field": "address", "withheld": true}]'::jsonb) THEN
    RAISE EXCEPTION 'P-01 FAIL: the waiting notice no longer says the address changed';
  END IF;
  RAISE NOTICE 'P-01 PASS: hiding the address while an email waits removes both streets and keeps "the address has changed"';
END $p01$;
ROLLBACK;

-- ─── P-02 (rework M1): switched on after fan-out, before every copy went ──────
BEGIN;
DO $p02$
DECLARE
  f record;
  v_text text;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('p02');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb, 'taxonomy', jsonb_build_object(
      'city', 'Brooklyn', 'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'), 'musicGenres', '[]'::jsonb,
      'locationGeo', jsonb_build_object('lat', 40.7081, 'lng', -73.9571),
      'locationText', '250 Bedford Avenue, Brooklyn', 'coordinatePrecision', 'approximate')),
    'Moving the night to the new room', f.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'fanned_out') THEN
    RAISE EXCEPTION 'P-02 FIXTURE: the notice was not fanned out';
  END IF;
  -- The host hides the address with a plain write (an older build's path).
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event,hideAddressUntilTicket}', 'true'::jsonb)
   WHERE id = f.v_event;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  SELECT string_agg(row_to_json(n)::text, ' ') INTO v_text FROM public.event_edit_notices AS n
   WHERE n.event_id = f.v_event AND n.state = 'fanned_out';
  IF v_text ~ 'Wythe|Bedford Avenue' THEN
    RAISE EXCEPTION 'P-02 FAIL: a fanned-out notice with an unsent copy still holds a street: %', v_text;
  END IF;
  RAISE NOTICE 'P-02 PASS: hiding the address after fan-out removes the streets from the notice the unsent copies are rendered from';
END $p02$;
ROLLBACK;

-- ─── P-03 (rework M1): hidden by the SAME edit that moves the address ────────
BEGIN;
DO $p03$
DECLARE
  f record;
  v_text text;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('p03');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand);
  -- A first move is waiting with both streets in clear.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'Room Two')),
    'The first room has a power fault', f.v_revision + 1);
  -- One save: a new street and hide-address on.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object(
      'core', jsonb_build_object('hideAddressUntilTicket', true),
      'taxonomy', jsonb_build_object(
        'city', 'Brooklyn', 'partyTypes', jsonb_build_array('festival'),
        'vibeTags', jsonb_build_array('social'), 'musicGenres', '[]'::jsonb,
        'locationGeo', jsonb_build_object('lat', 40.7081, 'lng', -73.9571),
        'locationText', '250 Bedford Avenue, Brooklyn', 'coordinatePrecision', 'approximate')),
    'Moving and hiding the address', f.v_revision + 2);
  SELECT string_agg(row_to_json(n)::text, ' ') INTO v_text FROM public.event_edit_notices AS n
   WHERE n.event_id = f.v_event;
  IF v_text ~ 'Wythe|Bedford Avenue' THEN
    RAISE EXCEPTION 'P-03 FAIL: a street was stored for an edit that hid the address: %', v_text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices AS n
                  WHERE n.event_id = f.v_event AND n.state = 'scheduled'
                    AND n.notice_changes @> '[{"field": "address", "withheld": true}]'::jsonb
                    AND n.notice_changes @> '[{"field": "venue", "old": "Lantern Room", "new": "Room Two"}]'::jsonb) THEN
    RAISE EXCEPTION 'P-03 FAIL: the merged notice should keep the venue names and say the address changed (%)',
      (SELECT jsonb_agg(notice_changes) FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled');
  END IF;
  RAISE NOTICE 'P-03 PASS: an edit that moves and hides the address stores the venue names and no street, on every row';
END $p03$;
ROLLBACK;

-- ─── R-03 (rework F1): allowlist-only in the pilot. A guest NOT on the list
--     still gets exactly today's alert; only a listed guest gets the new email ─
BEGIN;
DO $r03$
DECLARE
  f record;
  v_listed uuid := gen_random_uuid();
  v_result jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
  v_listed_email text;
  v_legacy_keys text[];
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r03');
  v_listed_email := 'e3827-listed-' || v_listed || '@example.test';
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_listed, f.v_event, 'Listed Guest', v_listed_email, '+15550003828', 'going', 'approved');
  PERFORM pg_temp.e3827_go_live(f.v_brand, true);
  INSERT INTO public.event_update_email_allowlist(email) VALUES (v_listed_email);

  v_result := public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Moving to a bigger room for everyone');
  IF v_result #>> '{buyer_notice,state}' IS DISTINCT FROM 'scheduled'
     OR (v_result ->> 'notified_count')::integer <> 2 THEN
    RAISE EXCEPTION 'R-03 FAIL: expected a scheduled notice and notified_count 2 (%)', v_result - 'event';
  END IF;
  -- The off-list guest: the same row main queues today, and only that.
  SELECT array_agg(n.idempotency_key) INTO v_legacy_keys FROM public.rsvp_notifications AS n
   WHERE n.event_id = f.v_event;
  IF array_length(v_legacy_keys, 1) IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM public.rsvp_notifications AS n
                     WHERE n.event_id = f.v_event AND n.rsvp_id = f.v_guest
                       AND n.template_key = 'rsvp_event_updated'
                       AND n.idempotency_key LIKE 'rsvp_update:' || f.v_event::text || ':%:' || f.v_guest::text
                       AND n.payload = jsonb_build_object('template_key', 'rsvp_event_updated',
                             'rsvp_id', f.v_guest, 'event_id', f.v_event)
                             || (n.payload - 'template_key' - 'rsvp_id' - 'event_id')
                       AND NOT (n.payload ? 'noticeId')) THEN
    RAISE EXCEPTION 'R-03 FAIL: the off-list guest did not get exactly today''s alert (keys %)', v_legacy_keys;
  END IF;
  IF (SELECT count(*) FROM public.rsvp_notification_deliveries AS d
        JOIN public.rsvp_notifications AS n ON n.id = d.notification_id
       WHERE n.event_id = f.v_event AND d.channel IN ('email', 'sms')) <> 2 THEN
    RAISE EXCEPTION 'R-03 FAIL: the off-list guest lost a channel they have today';
  END IF;

  -- Fan-out: the listed guest gets the notice-backed row; the other gets nothing more.
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'fanned_out';
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event AND payload ? 'noticeId') <> 1
     OR NOT EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = f.v_event
                     AND payload ->> 'noticeId' = v_notice.id::text AND rsvp_id = v_listed)
     OR v_notice.held_count <> 1 THEN
    RAISE EXCEPTION 'R-03 FAIL: fan-out did not give the listed guest (only) the new message (held %)', v_notice.held_count;
  END IF;
  RAISE NOTICE 'R-03 PASS: allowlist-only keeps today''s alert for an off-list guest and gives only the listed guest the new email';
END $r03$;
ROLLBACK;

-- ─── R-04 (rework F1): a guest already alerted while emails were being tested
--     is not told twice when allowlist-only is switched off before fan-out ────
BEGIN;
DO $r04$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r04');
  PERFORM pg_temp.e3827_go_live(f.v_brand, true);
  PERFORM public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Moving to a bigger room for everyone');
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) <> 1 THEN
    RAISE EXCEPTION 'R-04 FIXTURE: the off-list guest was not alerted';
  END IF;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = f.v_event) <> 1 THEN
    RAISE EXCEPTION 'R-04 FAIL: the guest was alerted twice for one change';
  END IF;
  RAISE NOTICE 'R-04 PASS: a guest given the earlier alert for this change is not told twice';
END $r04$;
ROLLBACK;

-- ─── S-03 (rework F2, F3): the host is told who an email can reach, and that
--     emails are being tested ──────────────────────────────────────────────────
BEGIN;
DO $s03$
DECLARE
  f record;
  v_status jsonb;
  v_result jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('s03');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ben@example.test');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, NULL);
  PERFORM pg_temp.e3827_go_live(f.v_brand, true);
  v_status := public.business_event_buyer_notice_status(f.v_event);
  IF (v_status ->> 'audience')::integer <> 2 OR (v_status ->> 'noEmail')::integer <> 1
     OR (v_status ->> 'allowlistOnly')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'S-03 FAIL: status must give 2 emailable, 1 without an address, and allowlist-only (%)', v_status;
  END IF;
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  IF (v_result #>> '{buyer_notice,audience}')::integer <> 2
     OR (v_result #>> '{buyer_notice,no_email}')::integer <> 1
     OR (v_result #>> '{buyer_notice,allowlist_only}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'S-03 FAIL: the save answer must carry the same facts (%)', v_result -> 'buyer_notice';
  END IF;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  IF (public.business_event_buyer_notice_status(f.v_event) ->> 'allowlistOnly')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'S-03 FAIL: allowlist-only off is not reported';
  END IF;
  RAISE NOTICE 'S-03 PASS: status and save answer give the emailable count, those without an address, and allowlist-only';
END $s03$;
ROLLBACK;

-- ─── S-04 (rework F4): the send-time check re-reads the switches ─────────────
BEGIN;
DO $s04$
DECLARE
  f record;
  v_notice uuid;
  v_status jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_event('s04');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.e3827_buyer(f.v_event, f.v_tier, 'ben@example.test');
  PERFORM pg_temp.e3827_go_live(f.v_brand);
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('venueName', 'The Bedford Hall')),
    'The first room has a power fault', f.v_revision + 1);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  SELECT id INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'fanned_out';
  IF public.event_edit_notice_send_check(v_notice, 'ada@example.test') <> 'ok' THEN
    RAISE EXCEPTION 'S-04 FAIL: a copy that may go was held';
  END IF;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  INSERT INTO public.event_update_email_allowlist(email) VALUES ('ben@example.test');
  IF public.event_edit_notice_send_check(v_notice, 'ada@example.test') <> 'held_allowlist'
     OR public.event_edit_notice_send_check(v_notice, ' Ben@Example.test ') <> 'ok' THEN
    RAISE EXCEPTION 'S-04 FAIL: allowlist-only switched back on is not re-read at send time';
  END IF;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email';
  IF public.event_edit_notice_send_check(v_notice, 'ben@example.test') <> 'held_feature_off'
     OR public.event_edit_notice_send_check(gen_random_uuid(), 'ben@example.test') <> 'notice_missing' THEN
    RAISE EXCEPTION 'S-04 FAIL: the off switch is not re-read at send time';
  END IF;
  -- A copy the worker held is counted as held, not as a failure.
  UPDATE public.rsvp_notification_deliveries AS d
     SET status = 'failed_terminal', safe_error_code = 'held_feature_off'
    FROM public.rsvp_notifications AS n
   WHERE n.id = d.notification_id AND n.payload ->> 'noticeId' = v_notice::text;
  v_status := public.business_event_buyer_notice_status(f.v_event);
  IF (v_status #>> '{last,failed}')::integer <> 0 OR (v_status #>> '{last,held}')::integer <> 2 THEN
    RAISE EXCEPTION 'S-04 FAIL: held copies must not read as failures (%)', v_status -> 'last';
  END IF;
  IF has_function_privilege('authenticated', 'public.event_edit_notice_send_check(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S-04 FAIL: a signed-in host can call the send check';
  END IF;
  RAISE NOTICE 'S-04 PASS: the send-time check re-reads the master switch, the pilot and the allowlist, and held copies are not failures';
END $s04$;
ROLLBACK;

\echo 'issue_3827_live_edit_buyer_email.implementor.happy: all cases passed'
