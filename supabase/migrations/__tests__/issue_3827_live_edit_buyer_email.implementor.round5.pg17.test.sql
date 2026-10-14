\set ON_ERROR_STOP on

-- Issue #3827 — implementor ROUND 5 for the buyer email, from the tester's
-- retest-4 findings (~/.mingla-private/3827/retest4/r4_runc7.sh).
-- Run after the full migration chain on PostgreSQL 17.
--
--   R5-01 (P2 deadlock) the fan-out takes a key-share lock on the event row
--         BEFORE the per-event lock, and the per-event lock before the notice
--         row: the order every live editor uses (event row, then the
--         recorder's per-event lock). Two-session proof kept in the round-5
--         report: with the old order an RSVP or event edit racing the fan-out
--         deadlocked and was held as recorder_error; with this order it
--         stays scheduled with its reason and the deadlock counter is flat.
--   R5-02 (P3 copy) the host status says a notice went out under test only
--         when it did: emails were not being tested at fan-out, then the
--         switch went off and the test-only flag came on; the status still
--         says testing = false.
--   R5-03 the reverse: a notice fanned out under test still says testing =
--         true after the test-only flag is turned off.
--
-- FAILS-ON-REVERT (migration at 541309b18~1, before this round): R5-01
-- (no event-row lock), R5-02 and R5-03 (testing follows today's flag).
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
CREATE OR REPLACE FUNCTION pg_temp.r5_work(p_event uuid, p_channel text, p_outcome text)
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

-- ─── R5-01: event row, then the per-event lock, then the notice row ────────
DO $r501$
DECLARE
  v_src text;
  v_event_lock integer;
  v_advisory integer;
  v_row integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.event_edit_notice_fanout(integer)'::pg_catalog.regprocedure;
  v_event_lock := strpos(v_src, 'FROM public.events AS e WHERE e.id = v_due.event_id FOR KEY SHARE');
  v_advisory := strpos(v_src, 'pg_advisory_xact_lock(');
  v_row := strpos(v_src, 'FOR UPDATE SKIP LOCKED');
  IF v_event_lock = 0 OR v_advisory = 0 OR v_row = 0
     OR NOT (v_event_lock < v_advisory AND v_advisory < v_row) THEN
    RAISE EXCEPTION 'R5-01 FAIL: the fan-out must lock the event row, then the per-event lock, then the notice row (event %, advisory %, row %)',
      v_event_lock, v_advisory, v_row;
  END IF;
  -- Every live editor locks the event row before the recorder's per-event lock.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.business_event_record_edit_notice(uuid, uuid, text, jsonb, jsonb, text, boolean)'::pg_catalog.regprocedure;
  IF strpos(v_src, 'pg_advisory_xact_lock(') = 0 THEN
    RAISE EXCEPTION 'R5-01 FAIL: the recorder no longer takes the per-event lock';
  END IF;
  RAISE NOTICE 'R5-01 PASS: the fan-out takes the event row, the per-event lock and the notice row in the editors'' order';
END $r501$;

-- ─── R5-02: not tested at fan-out stays not tested, whatever the switch says ─
BEGIN;
DO $r502$
DECLARE
  f record;
  v_status jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r502');
  PERFORM pg_temp.e3827_go_live(f.v_brand, false);
  PERFORM public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Moving to a bigger room for everyone');
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  PERFORM pg_temp.r5_work(f.v_event, 'email', 'sent');
  -- The kill switch mid-send, and the test-only flag back on.
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email';
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  PERFORM set_config('request.jwt.claim.sub', f.v_user::text, true);
  v_status := public.business_event_buyer_notice_status(f.v_event);
  IF v_status #>> '{last,state}' <> 'fanned_out' OR (v_status #>> '{last,sent}')::integer <> 1 THEN
    RAISE EXCEPTION 'R5-02 FIXTURE: expected one sent copy of a fanned-out notice (%)', v_status -> 'last';
  END IF;
  IF (v_status #>> '{last,testing}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'R5-02 FAIL: a notice sent with nothing under test is reported as tested (%)', v_status -> 'last';
  END IF;
  RAISE NOTICE 'R5-02 PASS: a notice that went out untested is never reported as tested';
END $r502$;
ROLLBACK;

-- ─── R5-03: tested at fan-out stays tested after the test-only flag goes off ─
BEGIN;
DO $r503$
DECLARE
  f record;
  v_status jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.e3827_rsvp('r503');
  PERFORM pg_temp.e3827_go_live(f.v_brand, true);
  INSERT INTO public.event_update_email_allowlist(email)
    SELECT lower(guest_email) FROM public.event_rsvps WHERE id = f.v_guest;
  PERFORM public.biz_update_live_rsvp(f.v_event, pg_temp.e3827_rsvp_payload('The Bedford Hall'),
    'Moving to a bigger room for everyone');
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE event_id = f.v_event;
  PERFORM public.event_edit_notice_fanout(20);
  PERFORM pg_temp.r5_work(f.v_event, 'email', 'sent');
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  PERFORM set_config('request.jwt.claim.sub', f.v_user::text, true);
  v_status := public.business_event_buyer_notice_status(f.v_event);
  IF (v_status #>> '{last,testing}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'R5-03 FAIL: a notice sent to a test address is no longer reported as tested (%)', v_status -> 'last';
  END IF;
  RAISE NOTICE 'R5-03 PASS: a notice sent under test is reported as tested after the flag goes off';
END $r503$;
ROLLBACK;

\echo 'issue_3827_live_edit_buyer_email.implementor.round5: all cases passed'
