\set ON_ERROR_STOP on

-- Issue #3827 — tester RETEST 5 for the buyer email on a live edit (migration
-- 20271014103827), after the round-5 rework (541309b18). Run after the full
-- migration chain on PostgreSQL 17. What a host is told about a sent email
-- must describe the moment it went out, not the switch as it is now:
--
--   T5-01  a waiting email while testing; testing ends before the send: the
--          sent notice is reported as NOT tested, and stays so when testing
--          is switched back on.
--   T5-02  an email sent while testing; testing ends afterwards: the sent
--          notice is still reported as tested, and the guests held at the
--          fan-out are still reported as alerted the usual way.
--   T5-03  merged edits across a testing flip: only the notice that went out
--          carries the flag, and it carries the value at its fan-out.
--
-- FAILS ON REVERT: with event_edit_notice_fanout and
-- business_event_buyer_notice_status put back to their 0c6fdea64 bodies (the
-- round-4 head), T5-01, T5-02 and T5-03 all fail.
--
-- The lock order of the fan-out (event row, then the per-event lock, then the
-- notice row) can only be shown with two sessions; that proof is in the
-- retest-5 report on the issue, not here.
--
-- Every case rolls back. Nothing here sends anything.

-- ── fixtures (copied from the retest suite; pg_temp is per session) ────────
CREATE OR REPLACE FUNCTION pg_temp.t3827r_settle() RETURNS void
LANGUAGE plpgsql AS $settle$
BEGIN
  -- Fires every deferred trigger now, as COMMIT would, then goes back to
  -- deferring so the next statement behaves as in production.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
END;
$settle$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_publish_payload(p_hide_address boolean, p_revision integer)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'T3827R night',
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

CREATE OR REPLACE FUNCTION pg_temp.t3827r_event(p_tag text, p_hide_address boolean DEFAULT false)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_tier uuid, v_revision integer)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827r-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827R ' || p_tag, 't3827r-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_event, v_brand, v_user, 'T3827R draft', 't3827r-draft-' || v_event, 'event', 'draft',
    'draft', 'America/New_York');
  PERFORM public.issue_1719_publish_event_with_poster(v_event,
    pg_temp.t3827r_publish_payload(p_hide_address, 1), 1);
  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.status IS DISTINCT FROM 'scheduled'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'fixture: the published event is not the shape the suite assumes (status %, theme %)',
      v_row.status, v_row.theme -> 'business_event';
  END IF;
  SELECT tt.id INTO v_tier FROM public.ticket_types AS tt
   WHERE tt.event_id = v_event AND tt.deleted_at IS NULL LIMIT 1;
  v_revision := COALESCE((v_row.theme #>> '{business_event,clientRevision}')::integer, 0);
  PERFORM pg_temp.t3827r_settle();
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_buyer(p_event uuid, p_tier uuid, p_email text, p_name text DEFAULT 'T3827R Buyer')
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

CREATE OR REPLACE FUNCTION pg_temp.t3827r_go_live(p_brand uuid, p_allowlist_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $live$
BEGIN
  INSERT INTO public.event_update_email_pilot_brands(brand_id) VALUES (p_brand) ON CONFLICT DO NOTHING;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email';
  UPDATE public.feature_flags SET is_enabled = p_allowlist_only
   WHERE flag_key = 'event_update_buyer_email_allowlist_only';
END;
$live$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_rsvp(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_guest uuid)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  v_guest := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827r-rsvp-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827R RSVP ' || p_tag, 't3827r-rsvp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'T3827R RSVP', 't3827r-rsvp-draft-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  PERFORM public.business_update_rsvp_graph(v_event, jsonb_build_object(
    '__expectedClientRevision', 1,
    'title', 'T3827R RSVP',
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
  PERFORM pg_temp.t3827r_settle();
  IF EXISTS (SELECT 1 FROM public.event_edit_notices AS n WHERE n.event_id = v_event)
     OR EXISTS (SELECT 1 FROM public.event_edit_notice_pending AS p WHERE p.event_id = v_event) THEN
    RAISE EXCEPTION 'fixture: publishing an RSVP recorded an edit notice or left a capture behind';
  END IF;
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_guest, v_event, 'T3827R Guest', 't3827r-guest-' || v_guest || '@example.test', '+15550003827',
          'going', 'approved');
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_rsvp_trio(p_tag text)
RETURNS TABLE(v_event uuid, v_brand uuid, v_off uuid, v_on uuid, v_phone uuid)
LANGUAGE plpgsql AS $trio$
DECLARE f record; v_member uuid := gen_random_uuid();
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_rsvp(p_tag);
  -- A signed-in guest who gave a phone and no email.
  INSERT INTO auth.users(id, email) VALUES (v_member, 't3827r-member-' || v_member || '@example.test');
  v_event := f.v_event; v_brand := f.v_brand; v_off := f.v_guest;
  v_on := gen_random_uuid(); v_phone := gen_random_uuid();
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_on, f.v_event, 'Listed Guest', 'Tester.' || p_tag || '@Example.test', '+15550003828', 'going', 'approved');
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_phone, f.v_event, v_member, 'Phone Guest', NULL, '+15550003829', 'going', 'approved');
  INSERT INTO public.event_update_email_allowlist(email) VALUES (lower('tester.' || p_tag || '@example.test'));
  RETURN NEXT;
END $trio$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_rsvp_move(p_event uuid, p_address text)
RETURNS void LANGUAGE plpgsql AS $mv$
BEGIN
  PERFORM public.business_update_rsvp_graph(p_event,
    jsonb_build_object('title', 'T3827R RSVP',
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', p_address)),
    'Moving to the bigger room', NULL);
  PERFORM pg_temp.t3827r_settle();
END $mv$;


-- The worker's half of a send, as rsvp-notify does it: claim the due
-- deliveries of one event (optionally one channel), ask the send check for a
-- notice copy, and on a hold ask for the usual alert, then complete the
-- delivery. Anything not asked for is parked a year ahead and put back after.
CREATE OR REPLACE FUNCTION pg_temp.t3827r3_work(p_event uuid, p_channel text, p_outcome text)
RETURNS text LANGUAGE plpgsql AS $work$
DECLARE c record; v_check text; v_out text := '';
BEGIN
  UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now() + interval '1 year'
   WHERE status IN ('pending', 'failed_retryable')
     AND ((p_channel IS NOT NULL AND channel <> p_channel)
          OR notification_id NOT IN (SELECT id FROM public.rsvp_notifications WHERE event_id = p_event));
  FOR c IN SELECT * FROM public.claim_rsvp_notification_deliveries(NULL, 100) LOOP
    IF c.payload ? 'noticeId' THEN
      v_check := public.event_edit_notice_send_check((c.payload ->> 'noticeId')::uuid, c.payload ->> 'recipientEmail');
      IF v_check <> 'ok' THEN
        IF c.payload ? 'rsvp_id' AND v_check <> 'notice_missing' THEN
          PERFORM public.event_edit_notice_legacy_alert((c.payload ->> 'noticeId')::uuid, (c.payload ->> 'rsvp_id')::uuid);
        END IF;
        PERFORM public.finish_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'failed_terminal', NULL, v_check);
        v_out := v_out || c.channel || ':' || v_check || ' ';
        CONTINUE;
      END IF;
    END IF;
    PERFORM public.finish_rsvp_notification_delivery(c.delivery_id, c.lease_id, p_outcome, 'fixture-provider-id', NULL);
    v_out := v_out || c.channel || ':' || p_outcome || ' ';
  END LOOP;
  UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now()
   WHERE next_attempt_at > now() + interval '300 days';
  RETURN v_out;
END $work$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r3_due(p_event uuid) RETURNS void LANGUAGE sql AS $due$
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = p_event AND state = 'scheduled';
$due$;

-- Alerts the usual way, per guest: {rsvp_id: count}.
CREATE OR REPLACE FUNCTION pg_temp.t3827r3_alerts(p_event uuid) RETURNS jsonb LANGUAGE sql AS $al$
  SELECT COALESCE(jsonb_object_agg(x.rsvp_id, x.n), '{}'::jsonb) FROM (
    SELECT r.rsvp_id::text AS rsvp_id, count(*) AS n FROM public.rsvp_notifications AS r
     WHERE r.event_id = p_event AND r.template_key = 'rsvp_event_updated' AND NOT (r.payload ? 'noticeId')
     GROUP BY r.rsvp_id) AS x
$al$;
CREATE OR REPLACE FUNCTION pg_temp.t3827r3_copies(p_event uuid) RETURNS integer LANGUAGE sql AS $cp$
  SELECT count(*)::integer FROM public.rsvp_notifications AS r WHERE r.event_id = p_event AND r.payload ? 'noticeId'
$cp$;

-- A ticketed event's address moves by a plain table write (recorded `direct`).
CREATE OR REPLACE FUNCTION pg_temp.t3827r3_move_street(p_event uuid) RETURNS void LANGUAGE plpgsql AS $mv$
BEGIN
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event,location,address}', '"250 Bedford Avenue, Brooklyn"'::jsonb)
   WHERE id = p_event;
  PERFORM pg_temp.t3827r_settle();
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = p_event AND state = 'scheduled') THEN
    RAISE EXCEPTION 'fixture: the street move did not wait as an email';
  END IF;
END $mv$;


-- Everything already recorded for the event moves p_minutes into the past,
-- and the usual alerts get a unique key, so the next save in this same
-- transaction reads as a later save (now() is fixed inside a transaction).
CREATE OR REPLACE FUNCTION pg_temp.t3827r4_age(p_event uuid, p_minutes integer) RETURNS void
LANGUAGE plpgsql AS $age$
BEGIN
  UPDATE public.event_edit_notices
     SET created_at = created_at - make_interval(mins => p_minutes),
         first_unsent_at = first_unsent_at - make_interval(mins => p_minutes)
   WHERE event_id = p_event;
  UPDATE public.rsvp_notifications
     SET created_at = created_at - make_interval(mins => p_minutes),
         idempotency_key = idempotency_key || ':aged' || p_minutes
   WHERE event_id = p_event;
END $age$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r4_timezone(p_event uuid, p_timezone text) RETURNS void
LANGUAGE plpgsql AS $tz$
BEGIN
  PERFORM public.business_update_rsvp_graph(p_event,
    jsonb_build_object('title', 'T3827R RSVP', 'timezone', p_timezone),
    'Correcting the time zone for guests', NULL);
  PERFORM pg_temp.t3827r_settle();
END $tz$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r5_status(p_event uuid, p_brand uuid) RETURNS jsonb
LANGUAGE plpgsql AS $st$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', (SELECT account_id::text FROM public.brands WHERE id = p_brand), true);
  RETURN public.business_event_buyer_notice_status(p_event) -> 'last';
END $st$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r5_testing(p_on boolean) RETURNS void LANGUAGE sql AS $tt$
  UPDATE public.feature_flags SET is_enabled = p_on WHERE flag_key = 'event_update_buyer_email_allowlist_only';
$tt$;

-- ─── T5-01: testing ends before the send, then comes back ──────────────────
BEGIN;
DO $t501$
DECLARE
  t record;
  v_last jsonb;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('t501');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, true);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');
  v_last := pg_temp.t3827r5_status(t.v_event, t.v_brand);
  IF (v_last ->> 'state') <> 'scheduled' OR (v_last ->> 'testing') <> 'true' THEN
    RAISE EXCEPTION 'T5-01 fixture: a waiting email while testing reads as tested (%)', v_last;
  END IF;

  PERFORM pg_temp.t3827r5_testing(false);
  PERFORM pg_temp.t3827r3_due(t.v_event);
  PERFORM public.event_edit_notice_fanout(20);
  IF (SELECT tested_at_fanout FROM public.event_edit_notices WHERE event_id = t.v_event AND state = 'fanned_out')
       IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T5-01 FAIL: a notice fanned out with testing off must record that it was not tested';
  END IF;
  PERFORM pg_temp.t3827r5_testing(true);
  v_last := pg_temp.t3827r5_status(t.v_event, t.v_brand);
  IF (v_last ->> 'state') <> 'fanned_out' OR (v_last ->> 'testing') <> 'false' THEN
    RAISE EXCEPTION 'T5-01 FAIL: a notice sent untested must read as untested after testing is switched back on (%)', v_last;
  END IF;
  RAISE NOTICE 'T5-01 PASS: a sent notice is described by the switch at its send, not the switch now';
END $t501$;
ROLLBACK;

-- ─── T5-02: sent while testing; testing ends afterwards ────────────────────
BEGIN;
DO $t502$
DECLARE
  t record;
  v_last jsonb;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('t502');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, true);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');
  PERFORM pg_temp.t3827r3_due(t.v_event);
  PERFORM public.event_edit_notice_fanout(20);
  PERFORM pg_temp.t3827r3_work(t.v_event, NULL, 'sent');
  PERFORM pg_temp.t3827r5_testing(false);
  v_last := pg_temp.t3827r5_status(t.v_event, t.v_brand);
  IF (v_last ->> 'testing') <> 'true'
     OR (v_last ->> 'sent') <> '1'
     OR (v_last ->> 'alerted') <> '2' THEN
    RAISE EXCEPTION 'T5-02 FAIL: an email sent while testing must still read as tested, one test address emailed, two alerted (%)',
      v_last;
  END IF;
  RAISE NOTICE 'T5-02 PASS: a notice sent under test still reads as tested after testing ends';
END $t502$;
ROLLBACK;

-- ─── T5-03: merged edits across a testing flip ─────────────────────────────
BEGIN;
DO $t503$
DECLARE
  t record;
  v_flags jsonb;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('t503');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, false);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');   -- A, untested
  PERFORM pg_temp.t3827r4_age(t.v_event, 3);
  PERFORM pg_temp.t3827r5_testing(true);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '300 Kent Avenue, Brooklyn');      -- B, merges, tested
  PERFORM pg_temp.t3827r3_due(t.v_event);
  PERFORM public.event_edit_notice_fanout(20);
  SELECT jsonb_object_agg(state, tested_at_fanout) INTO v_flags
    FROM public.event_edit_notices WHERE event_id = t.v_event;
  IF v_flags IS DISTINCT FROM jsonb_build_object('superseded', NULL, 'fanned_out', true) THEN
    RAISE EXCEPTION 'T5-03 FAIL: only the notice that went out carries the testing flag, as it was at its fan-out (got %)', v_flags;
  END IF;
  PERFORM pg_temp.t3827r5_testing(false);
  IF (pg_temp.t3827r5_status(t.v_event, t.v_brand) ->> 'testing') <> 'true' THEN
    RAISE EXCEPTION 'T5-03 FAIL: the merged notice sent under test must read as tested';
  END IF;
  RAISE NOTICE 'T5-03 PASS: merged edits carry the testing flag of the moment they went out';
END $t503$;
ROLLBACK;
