\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_owner uuid := '40630000-0000-4000-8000-000000006101';
  v_primary_user uuid := '40630000-0000-4000-8000-000000006102';
  v_guest_user uuid := '40630000-0000-4000-8000-000000006103';
  v_brand uuid := '40630000-0000-4000-8000-000000006104';
  v_event uuid := '40630000-0000-4000-8000-000000006105';
  v_date uuid := '40630000-0000-4000-8000-000000006106';
  v_rsvp uuid := '40630000-0000-4000-8000-000000006107';
  v_guest uuid := '40630000-0000-4000-8000-000000006108';
  v_primary_notification uuid := '40630000-0000-4000-8000-000000006109';
  v_guest_notification uuid := '40630000-0000-4000-8000-000000006110';
  v_payload jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'issue-4063-rsvp-owner@example.test'),
    (v_primary_user, 'issue-4063-rsvp-primary@example.test'),
    (v_guest_user, 'issue-4063-rsvp-guest@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (
    v_brand, v_owner, 'Issue 4063 RSVP Brand', 'issue-4063-rsvp-brand', 'USD'
  );
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, location_text, event_type,
    visibility, status, timezone
  ) VALUES (
    v_event, v_brand, v_owner, 'Real RSVP Event', 'issue-4063-rsvp-event',
    '17 RSVP Lane', 'rsvp', 'public', 'scheduled', 'America/Chicago'
  );
  INSERT INTO public.event_dates(
    id, event_id, start_at, end_at, timezone, is_master
  ) VALUES (
    v_date, v_event, '2026-11-07T23:30:00Z', '2026-11-08T02:00:00Z',
    'America/New_York', true
  );
  INSERT INTO public.event_rsvps(
    id, event_id, user_id, guest_name, guest_email, guest_phone,
    rsvp_status, approval_status, plus_count
  ) VALUES (
    v_rsvp, v_event, v_primary_user, 'Primary Guest',
    'primary-rsvp@example.test', '+12025550641', 'going', 'approved', 1
  );
  INSERT INTO public.event_rsvp_guests(
    id, rsvp_id, name, email, phone, matched_user_id
  ) VALUES (
    v_guest, v_rsvp, 'Plus One Guest', 'guest-rsvp@example.test',
    '+12025550642', v_guest_user
  );

  INSERT INTO public.rsvp_notifications(
    id, event_id, rsvp_id, recipient, template_key, payload,
    idempotency_key
  ) VALUES (
    v_primary_notification, v_event, v_rsvp, 'primary-rsvp@example.test',
    'rsvp_denied',
    jsonb_build_object('role', 'primary', 'eventName', 'Caller-owned title'),
    'issue-4063-rsvp-enrich-primary'
  );
  SELECT payload INTO v_payload
    FROM public.rsvp_notifications
   WHERE id = v_primary_notification;
  IF v_payload->>'eventId' <> v_event::text
     OR v_payload->>'eventName' <> 'Caller-owned title'
     OR v_payload->>'brandName' <> 'Issue 4063 RSVP Brand'
     OR v_payload->>'eventStartAt' <> '2026-11-07T23:30:00+00:00'
     OR v_payload->>'eventEndAt' <> '2026-11-08T02:00:00+00:00'
     OR v_payload->>'eventTimezone' <> 'America/New_York'
     OR v_payload->>'venueLine' <> '17 RSVP Lane'
     OR v_payload->>'recipientName' <> 'Primary Guest'
     OR v_payload->>'claimed' <> 'true' THEN
    RAISE EXCEPTION 'primary RSVP enrichment is malformed: %', v_payload;
  END IF;

  INSERT INTO public.rsvp_notifications(
    id, event_id, rsvp_id, recipient, template_key, payload,
    idempotency_key
  ) VALUES (
    v_guest_notification, v_event, v_rsvp, 'guest-rsvp@example.test',
    'rsvp_denied',
    jsonb_build_object(
      'role', 'guest', 'guestId', v_guest, 'venueLine', 'Caller-owned venue'
    ),
    'issue-4063-rsvp-enrich-guest'
  );
  SELECT payload INTO v_payload
    FROM public.rsvp_notifications
   WHERE id = v_guest_notification;
  IF v_payload->>'eventName' <> 'Real RSVP Event'
     OR v_payload->>'venueLine' <> 'Caller-owned venue'
     OR v_payload->>'leadName' <> 'Plus One Guest'
     OR v_payload->>'recipientName' <> 'Plus One Guest'
     OR v_payload->>'matchedUserId' <> v_guest_user::text
     OR v_payload->>'claimed' <> 'true' THEN
    RAISE EXCEPTION 'guest RSVP enrichment is malformed: %', v_payload;
  END IF;
END;
$test$;

ROLLBACK;
