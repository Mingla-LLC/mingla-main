\set ON_ERROR_STOP on

-- Issue #3827 — tester RETEST 3 for the buyer email on a live edit (migration
-- 20271014103827), after the second tester round. Run after the full
-- migration chain on PostgreSQL 17. Each case attacks one claim of the
-- round-3 rework (f0ee6de3c) from an angle the implementor's suite does not:
--
--   R3-01  (D2) the master switch goes OFF while an RSVP email waits, with
--          allowlist-only on: every going guest ends with exactly one
--          `rsvp_event_updated` alert (the off-list guests keep the one queued
--          at save, the listed guest gets one keyed to the save), no copy of
--          the new email, and a second fan-out adds nothing.
--   R3-02  (D2) the brand leaves the pilot while an RSVP email waits
--          (allowlist-only off, so nothing was queued at save): one alert per
--          going guest, keyed `rsvp_update:<event>:<save epoch>:<rsvp>`, and
--          calling the alert again (as the worker may, once per channel)
--          adds nothing.
--   R3-03  (D1) the allowlist changes mid-window: a listed guest taken off the
--          list before the send is held and alerted once; an off-list guest
--          put on the list before the send is not told twice.
--   R3-04  (D1) the worker's hold: a fanned-out copy held at send time is
--          turned into exactly one alert however many channels ask; a guest
--          who stopped going between save and send is never alerted; a
--          guest already alerted at save is not alerted again.
--   R3-05  a guest who cancels between save and send, then the switch goes
--          off: no alert for the cancelled guest, one for everyone else.
--   R3-06  (D3) the status splits held counts by reason: held while testing
--          (at fan-out and at send) and held because the switch went off.
--   R3-07  (small) the fan-out holds the per-event lock the recorder takes.
--   R3-08  (small) an address hidden after a notice went out is scrubbed from
--          it even when every copy was already delivered.
--
-- FAILS ON REVERT: with event_edit_notice_fanout,
-- business_event_buyer_notice_status and event_edit_notice_withhold_unsent put
-- back to their 97d33c60b bodies and event_edit_notice_legacy_alert dropped
-- (the second tester round's head), R3-01, R3-02, R3-03, R3-04, R3-05, R3-06,
-- R3-07 and R3-08 all fail.
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

-- ─── R3-01 (D2): master switch off mid-window, allowlist-only on ────────────
BEGIN;
DO $r301$
DECLARE
  t record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_alerts jsonb;
  v_expected jsonb;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('r301');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, true);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = t.v_event AND state = 'scheduled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'R3-01 fixture: the RSVP edit did not wait as an email';
  END IF;

  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email';
  PERFORM pg_temp.t3827r3_due(t.v_event);
  PERFORM public.event_edit_notice_fanout(20);
  PERFORM public.event_edit_notice_fanout(20);

  v_expected := jsonb_build_object(t.v_off::text, 1, t.v_on::text, 1, t.v_phone::text, 1);
  v_alerts := pg_temp.t3827r3_alerts(t.v_event);
  IF v_alerts IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'R3-01 FAIL: switched off mid-window, every going guest needs exactly one usual alert (want %, got %)',
      v_expected, v_alerts;
  END IF;
  IF pg_temp.t3827r3_copies(t.v_event) <> 0 THEN
    RAISE EXCEPTION 'R3-01 FAIL: a copy of the new email was queued after the switch went off';
  END IF;
  IF (SELECT state || '/' || hold_code FROM public.event_edit_notices WHERE id = v_notice.id) <> 'held/feature_off' THEN
    RAISE EXCEPTION 'R3-01 FAIL: the waiting notice must be held as feature_off';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rsvp_notifications
                  WHERE rsvp_id = t.v_on AND NOT (payload ? 'noticeId')
                    AND idempotency_key = 'rsvp_update:' || t.v_event::text || ':'
                        || extract(epoch FROM v_notice.created_at)::bigint::text || ':' || t.v_on::text) THEN
    RAISE EXCEPTION 'R3-01 FAIL: the listed guest''s alert is not keyed to the save that made the notice';
  END IF;
  RAISE NOTICE 'R3-01 PASS: switch off mid-window under allowlist-only gives every going guest exactly one usual alert';
END $r301$;
ROLLBACK;

-- ─── R3-02 (D2): the brand leaves the pilot mid-window ──────────────────────
BEGIN;
DO $r302$
DECLARE
  t record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_alerts jsonb;
  v_guest uuid;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('r302');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, false);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');
  IF pg_temp.t3827r3_alerts(t.v_event) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'R3-02 fixture: with emails on and testing over nothing is queued the usual way at save';
  END IF;
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = t.v_event AND state = 'scheduled';

  DELETE FROM public.event_update_email_pilot_brands WHERE brand_id = t.v_brand;
  PERFORM pg_temp.t3827r3_due(t.v_event);
  PERFORM public.event_edit_notice_fanout(20);
  -- The worker may ask again, once per channel and once per retry.
  FOREACH v_guest IN ARRAY ARRAY[t.v_off, t.v_on, t.v_phone, t.v_off, t.v_on, t.v_phone] LOOP
    IF public.event_edit_notice_legacy_alert(v_notice.id, v_guest) THEN
      RAISE EXCEPTION 'R3-02 FAIL: asking again queued a second alert for %', v_guest;
    END IF;
  END LOOP;

  v_alerts := pg_temp.t3827r3_alerts(t.v_event);
  IF v_alerts IS DISTINCT FROM jsonb_build_object(t.v_off::text, 1, t.v_on::text, 1, t.v_phone::text, 1) THEN
    RAISE EXCEPTION 'R3-02 FAIL: out of the pilot mid-window, one usual alert per going guest (got %)', v_alerts;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rsvp_notifications AS r
              WHERE r.event_id = t.v_event AND NOT (r.payload ? 'noticeId')
                AND (r.idempotency_key IS DISTINCT FROM 'rsvp_update:' || t.v_event::text || ':'
                       || extract(epoch FROM v_notice.created_at)::bigint::text || ':' || r.rsvp_id::text
                     OR (r.payload - ARRAY['entityId','recipientName','recipientEmail','recipientPhone',
                                           'primaryUserId','recoveryCreatedAt'])
                        IS DISTINCT FROM jsonb_build_object('template_key', 'rsvp_event_updated',
                                                            'rsvp_id', r.rsvp_id, 'event_id', t.v_event))) THEN
    RAISE EXCEPTION 'R3-02 FAIL: an alert differs from the row queued before this work (key or payload)';
  END IF;
  RAISE NOTICE 'R3-02 PASS: out of the pilot mid-window, one usual alert per guest in today''s shape; asking again adds nothing';
END $r302$;
ROLLBACK;

-- ─── R3-03 (D1): the allowlist changes mid-window ───────────────────────────
BEGIN;
DO $r303$
DECLARE
  t record;
  v_alerts jsonb;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('r303');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, true);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');
  -- The listed guest leaves the list; the off-list guest (already alerted at
  -- save) joins it.
  DELETE FROM public.event_update_email_allowlist WHERE email = 'tester.r303@example.test';
  INSERT INTO public.event_update_email_allowlist(email)
  SELECT lower(guest_email) FROM public.event_rsvps WHERE id = t.v_off;
  PERFORM pg_temp.t3827r3_due(t.v_event);
  PERFORM public.event_edit_notice_fanout(20);

  v_alerts := pg_temp.t3827r3_alerts(t.v_event);
  IF v_alerts IS DISTINCT FROM jsonb_build_object(t.v_off::text, 1, t.v_on::text, 1, t.v_phone::text, 1) THEN
    RAISE EXCEPTION 'R3-03 FAIL: after the allowlist changed, every guest needs exactly one usual alert (got %)', v_alerts;
  END IF;
  IF pg_temp.t3827r3_copies(t.v_event) <> 0 THEN
    RAISE EXCEPTION 'R3-03 FAIL: a guest put on the list after being alerted at save was told twice';
  END IF;
  RAISE NOTICE 'R3-03 PASS: an allowlist change mid-window leaves every guest told exactly once';
END $r303$;
ROLLBACK;

-- ─── R3-04 (D1): the worker's hold, asked once per channel ──────────────────
BEGIN;
DO $r304$
DECLARE
  t record;
  v_notice uuid;
  v_work text;
  v_gone uuid := gen_random_uuid();
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('r304');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, true);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');
  PERFORM pg_temp.t3827r3_due(t.v_event);
  PERFORM public.event_edit_notice_fanout(20);
  SELECT id INTO v_notice FROM public.event_edit_notices WHERE event_id = t.v_event AND state = 'fanned_out';
  IF (SELECT count(*) FROM public.rsvp_notification_deliveries AS d
        JOIN public.rsvp_notifications AS r ON r.id = d.notification_id
       WHERE r.rsvp_id = t.v_on AND r.payload ? 'noticeId') <> 2 THEN
    RAISE EXCEPTION 'R3-04 fixture: the listed guest''s copy should go by email and text';
  END IF;

  -- Taken off the list after the fan-out, before any channel was sent.
  DELETE FROM public.event_update_email_allowlist WHERE email = 'tester.r304@example.test';
  v_work := pg_temp.t3827r3_work(t.v_event, NULL, 'sent');
  IF v_work !~ 'email:held_allowlist' OR v_work !~ 'sms:held_allowlist' THEN
    RAISE EXCEPTION 'R3-04 FAIL: both channels of the copy must be held at send (%)', v_work;
  END IF;
  IF (SELECT count(*) FROM public.rsvp_notifications
       WHERE rsvp_id = t.v_on AND NOT (payload ? 'noticeId')) <> 1 THEN
    RAISE EXCEPTION 'R3-04 FAIL: a copy held on two channels must give exactly one usual alert (got %)',
      pg_temp.t3827r3_alerts(t.v_event);
  END IF;
  -- Alerted at save already: not again.
  IF public.event_edit_notice_legacy_alert(v_notice, t.v_off) THEN
    RAISE EXCEPTION 'R3-04 FAIL: a guest alerted at save was alerted again';
  END IF;
  -- Stopped going between save and send: never.
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_gone, t.v_event, 'Gone Guest', 'gone.r304@example.test', '+15550003830', 'going', 'approved');
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE id = v_gone;
  IF public.event_edit_notice_legacy_alert(v_notice, v_gone)
     OR EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE rsvp_id = v_gone) THEN
    RAISE EXCEPTION 'R3-04 FAIL: a guest who is no longer going was alerted';
  END IF;
  -- Another event's guest, through this notice: never.
  IF public.event_edit_notice_legacy_alert(v_notice, NULL)
     OR public.event_edit_notice_legacy_alert(gen_random_uuid(), t.v_on) THEN
    RAISE EXCEPTION 'R3-04 FAIL: an alert was queued for no guest or no notice';
  END IF;
  RAISE NOTICE 'R3-04 PASS: a copy held at send gives one usual alert whatever the channels; never a second, never for a guest who left';
END $r304$;
ROLLBACK;

-- ─── R3-05: a guest cancels between save and send, then the switch goes off ─
BEGIN;
DO $r305$
DECLARE
  t record;
  v_alerts jsonb;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('r305');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, false);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE id = t.v_off;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email';
  PERFORM pg_temp.t3827r3_due(t.v_event);
  PERFORM public.event_edit_notice_fanout(20);
  v_alerts := pg_temp.t3827r3_alerts(t.v_event);
  IF v_alerts IS DISTINCT FROM jsonb_build_object(t.v_on::text, 1, t.v_phone::text, 1) THEN
    RAISE EXCEPTION 'R3-05 FAIL: the guests still going get one alert each and the cancelled guest none (got %)', v_alerts;
  END IF;
  RAISE NOTICE 'R3-05 PASS: a guest who cancelled before the send is never alerted; the rest once each';
END $r305$;
ROLLBACK;

-- ─── R3-06 (D3): held counts split by reason ────────────────────────────────
BEGIN;
DO $r306$
DECLARE
  f record;
  v_work text;
  v_last jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_event('r306');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'Listed.R306@Example.test', 'Listed Buyer');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'offlist.r306@example.test', 'Off-list Buyer');
  INSERT INTO public.event_update_email_allowlist(email) VALUES ('listed.r306@example.test');
  PERFORM pg_temp.t3827r_go_live(f.v_brand, true);
  PERFORM pg_temp.t3827r3_move_street(f.v_event);
  PERFORM pg_temp.t3827r3_due(f.v_event);
  PERFORM public.event_edit_notice_fanout(20);
  -- The switch goes off before the listed buyer's copy is sent.
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email';
  v_work := pg_temp.t3827r3_work(f.v_event, NULL, 'sent');
  IF v_work !~ 'email:held_feature_off' THEN
    RAISE EXCEPTION 'R3-06 fixture: the listed copy should be held at send (%)', v_work;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', f.v_user::text, true);
  v_last := public.business_event_buyer_notice_status(f.v_event) -> 'last';
  IF (v_last ->> 'heldTesting') IS DISTINCT FROM '1'
     OR (v_last ->> 'heldSwitchedOff') IS DISTINCT FROM '1'
     OR (v_last ->> 'held') IS DISTINCT FROM '2'
     OR (v_last ->> 'sent') IS DISTINCT FROM '0'
     OR (v_last ->> 'failed') IS DISTINCT FROM '0'
     OR (v_last ->> 'pending') IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'R3-06 FAIL: one buyer held while testing and one held by the switch must be told apart (got %)', v_last;
  END IF;
  RAISE NOTICE 'R3-06 PASS: held while testing and held by the switch are counted apart, and never as failed';
END $r306$;
ROLLBACK;

-- ─── R3-07: the fan-out holds the recorder's per-event lock ─────────────────
-- A notice row written directly (no recorder in this transaction), so the
-- only way the lock can be held afterwards is the fan-out taking it.
BEGIN;
DO $r307$
DECLARE
  f record;
  v_key2 bigint;
  v_key1 bigint := hashtext('issue_3827_event_edit_notice')::bigint & 4294967295;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_event('r307');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'buyer.r307@example.test');
  PERFORM pg_temp.t3827r_go_live(f.v_brand, false);
  v_key2 := hashtext(f.v_event::text)::bigint & 4294967295;
  IF EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
              AND classid::bigint = v_key1 AND objid::bigint = v_key2) THEN
    RAISE EXCEPTION 'R3-07 fixture: the lock is already held before the fan-out';
  END IF;
  INSERT INTO public.event_edit_notices(event_id, brand_id, source, reason, changes, notice_changes, state,
    send_after, audience_count, first_unsent_at)
  VALUES (f.v_event, f.v_brand, 'event', 'A probe', '[{"field":"timezone","old":"America/New_York","new":"America/Chicago"}]',
    '[{"field":"timezone","old":"America/New_York","new":"America/Chicago"}]', 'scheduled',
    now() - interval '1 second', 1, now());
  PERFORM public.event_edit_notice_fanout(20);
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
                  AND classid::bigint = v_key1 AND objid::bigint = v_key2 AND objsubid = 2) THEN
    RAISE EXCEPTION 'R3-07 FAIL: the fan-out did not take the per-event lock the recorder takes';
  END IF;
  RAISE NOTICE 'R3-07 PASS: the fan-out holds the per-event lock';
END $r307$;
ROLLBACK;

-- ─── R3-08: an address hidden after every copy was delivered ────────────────
BEGIN;
DO $r308$
DECLARE
  f record;
  v_work text;
  v_notice jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_event('r308');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'buyer.r308@example.test');
  PERFORM pg_temp.t3827r_go_live(f.v_brand, false);
  PERFORM pg_temp.t3827r3_move_street(f.v_event);
  PERFORM pg_temp.t3827r3_due(f.v_event);
  PERFORM public.event_edit_notice_fanout(20);
  v_work := pg_temp.t3827r3_work(f.v_event, NULL, 'sent');
  IF v_work !~ 'email:sent' OR EXISTS (
       SELECT 1 FROM public.rsvp_notification_deliveries AS d JOIN public.rsvp_notifications AS r ON r.id = d.notification_id
        WHERE r.event_id = f.v_event AND d.status <> 'sent') THEN
    RAISE EXCEPTION 'R3-08 fixture: every copy should be delivered (%)', v_work;
  END IF;
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event,hideAddressUntilTicket}', 'true'::jsonb)
   WHERE id = f.v_event;
  PERFORM pg_temp.t3827r_settle();
  SELECT to_jsonb(n) INTO v_notice FROM public.event_edit_notices AS n
   WHERE n.event_id = f.v_event AND n.state = 'fanned_out';
  IF v_notice IS NULL OR v_notice::text ~* 'Wythe|Bedford' THEN
    RAISE EXCEPTION 'R3-08 FAIL: a delivered notice still holds a street after the address was hidden (%)', v_notice;
  END IF;
  RAISE NOTICE 'R3-08 PASS: a notice whose copies were all delivered loses its street when the address is hidden';
END $r308$;
ROLLBACK;
