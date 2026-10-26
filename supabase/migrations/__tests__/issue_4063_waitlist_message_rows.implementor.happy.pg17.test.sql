-- #4063 Wave 2 — waitlist contact rows remain switch-safe and idempotent.
-- MINGLA-INVARIANT: I-4063-WAITLIST-ONE-ROW-PER-CONTACT | issue #4063 | With messages_v2 enabled, waitlist invitations enqueue independent email and normalized SMS rows while invalid phones remain silent.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i4063_waitlist_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION '#4063 waitlist FAIL: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.i4063_waitlist_fixture(
  OUT event_id uuid,
  OUT ticket_type_id uuid,
  OUT event_date_id uuid
)
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
BEGIN
  event_id := gen_random_uuid();
  ticket_type_id := gen_random_uuid();
  event_date_id := gen_random_uuid();

  INSERT INTO auth.users(id, email)
  VALUES (v_user, 'waitlist-owner-4063-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_user, 'waitlist-owner-4063-' || v_user || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_user, 'Issue 4063 Waitlist',
    'issue-4063-waitlist-' || v_brand, 'stripe', 'US', 'USD', 'USD'
  );
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, published_at, theme
  ) VALUES (
    event_id, v_brand, v_user, 'Issue 4063 Waitlist Event',
    'issue-4063-waitlist-event-' || event_id, 'event', 'scheduled', 'public',
    'America/New_York', 'USD', now(),
    jsonb_build_object('business_event', jsonb_build_object(
      'format', 'in_person', 'hideAddressUntilTicket', false,
      'settings', jsonb_build_object('privateGuestList', false)
    ))
  );
  INSERT INTO public.event_dates(
    id, event_id, start_at, end_at, timezone, is_master
  ) VALUES (
    event_date_id, event_id, now() + interval '10 days',
    now() + interval '10 days 4 hours', 'America/New_York', true
  );
  INSERT INTO public.ticket_types(
    id, event_id, name, price_cents, quantity_total, currency, waitlist_enabled
  ) VALUES (
    ticket_type_id, event_id, 'GA', 0, 100, 'USD', true
  );
END
$$;

BEGIN;
DO $test$
DECLARE
  fixture record;
  v_old uuid;
  v_both uuid;
  v_email_only uuid;
  v_primary uuid;
BEGIN
  SELECT * INTO fixture FROM pg_temp.i4063_waitlist_fixture();

  UPDATE public.issue_4063_switches
     SET enabled = false, changed_at = NULL
   WHERE name = 'messages_v2';

  INSERT INTO public.waitlist_entries(
    event_id, ticket_type_id, email, phone, name, status, qty_requested, created_at
  ) VALUES (
    fixture.event_id, fixture.ticket_type_id, 'old-4063@example.test',
    '+14155550100', 'Old Shape', 'waiting', 1, now() - interval '4 minutes'
  ) RETURNING id INTO v_old;

  PERFORM pg_temp.i4063_waitlist_assert(
    public.issue_2947_waitlist_drain_for_ticket_type(fixture.ticket_type_id, 1) = 1,
    'switch-off drain must invite one buyer'
  );
  PERFORM pg_temp.i4063_waitlist_assert((
    SELECT count(*) = 1
      FROM public.ticket_order_notifications
     WHERE idempotency_key = 'waitlist_invite:' || v_old::text
       AND channel = 'email'
       AND recipient = 'old-4063@example.test'
       AND NOT (payload ? 'event_date_id')
  ), 'switch-off path must preserve the original single email row and payload');
  PERFORM pg_temp.i4063_waitlist_assert(NOT EXISTS (
    SELECT 1 FROM public.ticket_order_notifications
     WHERE idempotency_key LIKE 'waitlist_invite:' || v_old::text || ':%'
  ), 'switch-off path must not emit v2 suffixed keys');

  UPDATE public.issue_4063_switches
     SET enabled = true, changed_at = now()
   WHERE name = 'messages_v2';

  INSERT INTO public.waitlist_entries(
    event_id, ticket_type_id, email, phone, name, status, qty_requested, created_at
  ) VALUES (
    fixture.event_id, fixture.ticket_type_id, 'both-4063@example.test',
    '+1 (415) 555-0102', 'Both Contacts', 'waiting', 1,
    now() - interval '3 minutes'
  ) RETURNING id INTO v_both;
  INSERT INTO public.waitlist_entries(
    event_id, ticket_type_id, email, phone, name, status, qty_requested, created_at
  ) VALUES (
    fixture.event_id, fixture.ticket_type_id, 'email-4063@example.test',
    'not-a-phone', 'Email Only', 'waiting', 1,
    now() - interval '2 minutes'
  ) RETURNING id INTO v_email_only;
  PERFORM pg_temp.i4063_waitlist_assert(
    public.issue_2947_waitlist_drain_for_ticket_type(fixture.ticket_type_id, 2) = 2,
    'switch-on drain must count each invited buyer once, not once per channel'
  );

  PERFORM pg_temp.i4063_waitlist_assert((
    SELECT count(*) = 2
      FROM public.ticket_order_notifications
     WHERE idempotency_key IN (
       'waitlist_invite:' || v_both::text || ':email',
       'waitlist_invite:' || v_both::text || ':sms'
     )
  ), 'buyer with both contacts must get independent email and SMS rows');
  PERFORM pg_temp.i4063_waitlist_assert(EXISTS (
    SELECT 1 FROM public.ticket_order_notifications
     WHERE idempotency_key = 'waitlist_invite:' || v_both::text || ':sms'
       AND channel = 'sms'
       AND recipient = '+14155550102'
       AND payload->>'channel_hint' = 'sms'
       AND payload->>'event_date_id' = fixture.event_date_id::text
       AND payload->>'timezone' = 'America/New_York'
       AND (payload->>'start_at')::timestamptz = now() + interval '10 days'
  ), 'SMS row must normalize the handset and carry canonical occurrence facts');

  SELECT notification_id INTO v_primary
    FROM public.waitlist_entries WHERE id = v_both;
  PERFORM pg_temp.i4063_waitlist_assert(v_primary = (
    SELECT id FROM public.ticket_order_notifications
     WHERE idempotency_key = 'waitlist_invite:' || v_both::text || ':email'
  ), 'entry notification_id must prefer the email row when both contacts exist');

  PERFORM pg_temp.i4063_waitlist_assert((
    SELECT count(*) = 1
      FROM public.ticket_order_notifications
     WHERE idempotency_key = 'waitlist_invite:' || v_email_only::text || ':email'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ticket_order_notifications
     WHERE idempotency_key = 'waitlist_invite:' || v_email_only::text || ':sms'
  ), 'invalid phone must skip only the SMS row when email remains usable');

  PERFORM pg_temp.i4063_waitlist_assert(
    public.issue_2947_waitlist_drain_for_ticket_type(fixture.ticket_type_id, 2) = 0,
    're-drain must not duplicate already invited rows'
  );
END
$test$;
ROLLBACK;
