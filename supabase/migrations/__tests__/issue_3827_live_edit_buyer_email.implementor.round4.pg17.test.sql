\set ON_ERROR_STOP on

-- Issue #3827 — implementor ROUND 4 for the buyer email, from the tester's
-- retest-3 probes (~/.mingla-private/3827/retest3/probes.sql and runc5.sh).
-- Run after the full migration chain on PostgreSQL 17.
--
--   R4-01 (finding 3) a guest whose copy of this notice already went out on
--         one channel is never given today's alert when another channel of
--         the same copy is held (the allowlist changed, or the switch went
--         off, between the two channels).
--   R4-02 (finding 4) edit A waits, the switch goes off, edit B gives the
--         usual alert, the switch comes back, a time-zone-only edit C merges
--         into A: the fan-out tells every guest about C (an alert for B does
--         not stand for C).
--   R4-03 (finding 5) the fan-out takes the per-event lock BEFORE the notice
--         row lock, the recorder's order (two-session repro kept in the
--         round-4 report: the old order turned a concurrent save into
--         held / recorder_error, a caught deadlock).
--   R4-04 (finding 6) the host status counts a going guest with no email who
--         was reached by text or the app, and counts "no email address" only
--         for guests reached by nothing.
--
-- FAILS-ON-REVERT (migration at c6cabd6ee): R4-01 (a second, legacy row),
-- R4-02 (nobody is told about C), R4-03 (the row is locked first), R4-04
-- (no reachedOther; noEmail forced to 0).
--
-- Every case rolls back. Nothing here sends anything.

CREATE OR REPLACE FUNCTION pg_temp.e3827_go_live(p_brand uuid, p_allowlist_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $live$
BEGIN
  INSERT INTO public.event_update_email_pilot_brands(brand_id) VALUES (p_brand) ON CONFLICT DO NOTHING;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email';
  UPDATE public.feature_flags SET is_enabled = p_allowlist_only
   WHERE flag_key = 'event_update_buyer_email_allowlist_only';
END;
$live$;

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

CREATE OR REPLACE FUNCTION pg_temp.e3827_rsvp_payload(p_venue text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'E3827 RSVP',
    'location', jsonb_build_object('venueName', p_venue, 'address', '61 Wythe Avenue, Brooklyn'))
$payload$;


-- The delivery worker, as rsvp-notify runs it: claim, send check, today's
-- alert on a hold for a guest, then finish. `p_channel` limits the pass to one
-- channel; everything that is not held is finished with `p_outcome`.
CREATE OR REPLACE FUNCTION pg_temp.r4_work(p_event uuid, p_channel text, p_outcome text)
RETURNS text LANGUAGE plpgsql AS $w$
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
    PERFORM public.finish_rsvp_notification_delivery(c.delivery_id, c.lease_id, p_outcome, 'provider-id', NULL);
    v_out := v_out || c.channel || ':' || p_outcome || ' ';
  END LOOP;
  UPDATE public.rsvp_notification_deliveries SET next_attempt_at = now()
   WHERE next_attempt_at > now() + interval '300 days';
  RETURN v_out;
END $w$;

-- ─── R4-01: no usual alert after a copy already went out on another channel ─
BEGIN;
DO $r401$
DECLARE
  f record;
  v_work text;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r401');
  PERFORM pg_temp.e3827_go_live(f.v_brand, true);
  INSERT INTO public.event_update_email_allowlist(email)
    SELECT lower(guest_email) FROM public.event_rsvps WHERE id = f.v_guest;
  PERFORM public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Moving to a bigger room for everyone');
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  v_work := pg_temp.r4_work(f.v_event, 'email', 'sent');
  IF v_work NOT LIKE '%email:sent%' THEN
    RAISE EXCEPTION 'R4-01 FIXTURE: the email did not go out (%)', v_work;
  END IF;
  -- The address leaves the allowlist before the text goes.
  DELETE FROM public.event_update_email_allowlist;
  v_work := pg_temp.r4_work(f.v_event, 'sms', 'sent');
  IF v_work NOT LIKE '%sms:held_allowlist%' THEN
    RAISE EXCEPTION 'R4-01 FIXTURE: the text was not held (%)', v_work;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rsvp_notifications
              WHERE rsvp_id = f.v_guest AND NOT (payload ? 'noticeId')) THEN
    RAISE EXCEPTION 'R4-01 FAIL: the guest already had the new email and was given the usual alert too';
  END IF;
  RAISE NOTICE 'R4-01 PASS: a copy that went out on one channel never brings a second, usual alert';
END $r401$;
ROLLBACK;

-- ─── R4-01b: the same when the switch goes off between the two channels ────
BEGIN;
DO $r401b$
DECLARE
  f record;
  v_work text;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r401b');
  PERFORM pg_temp.e3827_go_live(f.v_brand, false);
  PERFORM public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Moving to a bigger room for everyone');
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  PERFORM pg_temp.r4_work(f.v_event, 'email', 'sent');
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email';
  v_work := pg_temp.r4_work(f.v_event, 'sms', 'sent');
  IF v_work NOT LIKE '%sms:held_feature_off%' THEN
    RAISE EXCEPTION 'R4-01b FIXTURE: the text was not held (%)', v_work;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rsvp_notifications
              WHERE rsvp_id = f.v_guest AND NOT (payload ? 'noticeId')) THEN
    RAISE EXCEPTION 'R4-01b FAIL: switched off after the email went, the guest was given the usual alert too';
  END IF;
  RAISE NOTICE 'R4-01b PASS: switched off between channels, a guest who had the email gets nothing more';
END $r401b$;
ROLLBACK;

-- ─── R4-02: an alert for an earlier change does not stand for a later one ────
BEGIN;
DO $r402$
DECLARE
  f record;
  v_told integer;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r402');
  PERFORM pg_temp.e3827_go_live(f.v_brand, false);
  -- A: emails on, waiting.
  PERFORM public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('Room A'), 'Moving to room A for everyone');
  UPDATE public.event_edit_notices
     SET created_at = created_at - interval '3 minutes', first_unsent_at = first_unsent_at - interval '3 minutes'
   WHERE event_id = f.v_event;
  -- B: switched off, so the usual alert goes (two minutes ago).
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email';
  PERFORM public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('Room B'), 'Moving to room B for everyone');
  UPDATE public.rsvp_notifications SET created_at = now() - interval '2 minutes',
         idempotency_key = idempotency_key || ':b'
   WHERE event_id = f.v_event;
  -- C: switched back on; a time-zone-only edit merges into A.
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email';
  PERFORM public.biz_update_live_rsvp(f.v_event,
    pg_temp.e3827_rsvp_payload('Room B') || jsonb_build_object('timezone', 'America/Chicago'),
    'Correcting the time zone for guests');
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') THEN
    RAISE EXCEPTION 'R4-02 FIXTURE: no waiting notice after C (%)',
      (SELECT jsonb_agg(jsonb_build_object('state', state, 'hold', hold_code)) FROM public.event_edit_notices WHERE event_id = f.v_event);
  END IF;
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  SELECT count(*) INTO v_told FROM public.rsvp_notifications
   WHERE event_id = f.v_event AND rsvp_id = f.v_guest AND payload ? 'noticeId';
  IF v_told <> 1 THEN
    RAISE EXCEPTION 'R4-02 FAIL: the guest was not told about the later change (% copies)', v_told;
  END IF;
  RAISE NOTICE 'R4-02 PASS: an alert for an earlier change does not stand for a later one';
END $r402$;
ROLLBACK;

-- ─── R4-03: the fan-out locks the event before the notice row ──────────────
DO $r403$
DECLARE
  v_src text;
  v_lock integer;
  v_row integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.event_edit_notice_fanout(integer)'::pg_catalog.regprocedure;
  v_lock := strpos(v_src, 'pg_advisory_xact_lock(');
  v_row := strpos(v_src, 'FOR UPDATE SKIP LOCKED');
  IF v_lock = 0 OR v_row = 0 OR v_lock > v_row THEN
    RAISE EXCEPTION 'R4-03 FAIL: the fan-out must take the per-event lock before the notice row lock (lock at %, row at %)', v_lock, v_row;
  END IF;
  -- The candidate query that picks due notices locks nothing.
  IF (length(v_src) - length(replace(v_src, 'FOR UPDATE', ''))) / length('FOR UPDATE') <> 1 THEN
    RAISE EXCEPTION 'R4-03 FAIL: the fan-out locks rows in more than one place';
  END IF;
  RAISE NOTICE 'R4-03 PASS: the fan-out takes locks in the recorder''s order';
END $r403$;

-- ─── R4-04: guests reached by text or the app are counted; "no email" is real ─
BEGIN;
DO $r404$
DECLARE
  f record;
  v_member uuid := gen_random_uuid();
  v_late uuid := gen_random_uuid();
  v_status jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r404');
  INSERT INTO auth.users(id, email) VALUES (v_member, 'e3827-member-' || v_member || '@example.test'),
                                           (v_late, 'e3827-late-' || v_late || '@example.test');
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (f.v_event, v_member, 'Phone Guest', NULL, '+15550003829', 'going', 'approved');
  PERFORM pg_temp.e3827_go_live(f.v_brand, false);
  PERFORM public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Moving to a bigger room for everyone');
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  PERFORM pg_temp.r4_work(f.v_event, NULL, 'sent');
  -- A guest who said yes after the fan-out, with no email: reached by nothing.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (f.v_event, v_late, 'Late Guest', NULL, '+15550003830', 'going', 'approved');
  PERFORM set_config('request.jwt.claim.sub', f.v_user::text, true);
  v_status := public.business_event_buyer_notice_status(f.v_event);
  IF (v_status #>> '{last,sent}')::integer <> 1
     OR (v_status #>> '{last,reachedOther}')::integer <> 1
     OR (v_status #>> '{last,noEmail}')::integer <> 1 THEN
    RAISE EXCEPTION 'R4-04 FAIL: expected 1 emailed, 1 reached by text or the app, 1 with no email reached by nothing (%)',
      v_status -> 'last';
  END IF;
  RAISE NOTICE 'R4-04 PASS: every going guest is counted once: emailed, reached by text or the app, or no email address';
END $r404$;
ROLLBACK;

\echo 'issue_3827_live_edit_buyer_email.implementor.round4: all cases passed'
