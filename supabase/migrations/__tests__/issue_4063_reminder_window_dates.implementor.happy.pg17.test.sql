-- #4063 Wave 2 — bought-date reminder selection, fixed window and payloads.
-- MINGLA-INVARIANT: I-4063-REMINDERS-ONE-PER-BOUGHT-DATE | issue #4063 | Reminder windows run every five minutes, select only still-valid purchased dates, and remain idempotent per order, occurrence and lead bucket.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.i4063_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION '#4063 reminder FAIL: %', p_message;
  END IF;
END
$$;

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id, email) VALUES
  ('40630000-0000-4000-8000-0000000000a1', 'reminder-owner-4063@example.test'),
  ('40630000-0000-4000-8000-0000000000a2', 'reminder-buyer-4063@example.test');

INSERT INTO public.creator_accounts(id, email) VALUES
  ('40630000-0000-4000-8000-0000000000a1', 'reminder-owner-4063@example.test');

INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000a1',
   'Issue 4063 Reminder Brand', 'issue-4063-reminder-brand', 'USD');

INSERT INTO public.venue_listings(
  id, brand_id, slug, name, address, city, lat, lng, venue_category, claim_status
) VALUES (
  '40630000-0000-4000-8000-0000000000c1',
  '40630000-0000-4000-8000-0000000000b1',
  'issue4063remindervenue', 'Reminder Room', '1 Reminder Way', 'Brooklyn',
  40.7, -74.0, 'restaurant', 'verified'
);

INSERT INTO public.venue_availability_config(
  id, brand_id, venue_id, iana_timezone, iana_timezone_source
) VALUES (
  '40630000-0000-4000-8000-0000000000c2',
  '40630000-0000-4000-8000-0000000000b1',
  '40630000-0000-4000-8000-0000000000c1',
  'America/New_York', 'operator'
);

INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, location_text, currency
) VALUES
  ('40630000-0000-4000-8000-0000000000e1',
   '40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000a1',
   'Recurring Nights', 'issue-4063-recurring-nights', 'event', 'live', 'public',
   'America/New_York', 'Reminder Room', 'USD'),
  ('40630000-0000-4000-8000-0000000000e2',
   '40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000a1',
   'Outside Window', 'issue-4063-outside-window', 'event', 'live', 'public',
   'UTC', 'Later Hall', 'USD'),
  ('40630000-0000-4000-8000-0000000000e3',
   '40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000a1',
   'Old Key Event', 'issue-4063-old-key', 'event', 'live', 'public',
   'UTC', 'Legacy Hall', 'USD'),
  ('40630000-0000-4000-8000-0000000000e4',
   '40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000a1',
   'Partial Refund Event', 'issue-4063-partial-refund', 'event', 'live', 'public',
   'Europe/London', 'Partial Hall', 'USD'),
  ('40630000-0000-4000-8000-0000000000e5',
   '40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000a1',
   'Refunded Event', 'issue-4063-refunded', 'event', 'live', 'public',
   'UTC', 'Refund Hall', 'USD'),
  ('40630000-0000-4000-8000-0000000000e6',
   '40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000a1',
   'Cancelled Ticket Event', 'issue-4063-cancelled-ticket', 'event', 'live', 'public',
   'UTC', 'Cancel Hall', 'USD'),
  ('40630000-0000-4000-8000-0000000000e7',
   '40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000a1',
   'Booked Experience', 'issue-4063-booked-experience', 'experience', 'live', 'public',
   'Africa/Lagos', 'Experience Stop', 'USD');

INSERT INTO public.event_dates(
  id, event_id, start_at, end_at, timezone, is_master, override_title
) VALUES
  ('40630000-0000-4000-8000-0000000000d1',
   '40630000-0000-4000-8000-0000000000e1',
   now() + interval '2 hours 1 minute', now() + interval '3 hours 1 minute',
   'America/New_York', true, 'Date A'),
  ('40630000-0000-4000-8000-0000000000d2',
   '40630000-0000-4000-8000-0000000000e1',
   now() + interval '2 hours 2 minutes', now() + interval '3 hours 2 minutes',
   'America/New_York', false, 'Date B'),
  ('40630000-0000-4000-8000-0000000000d3',
   '40630000-0000-4000-8000-0000000000e2',
   now() + interval '2 hours 4 minutes', now() + interval '3 hours 4 minutes',
   'UTC', true, NULL),
  ('40630000-0000-4000-8000-0000000000d4',
   '40630000-0000-4000-8000-0000000000e3',
   now() + interval '2 hours 2 minutes', now() + interval '3 hours 2 minutes',
   'UTC', true, NULL),
  ('40630000-0000-4000-8000-0000000000d5',
   '40630000-0000-4000-8000-0000000000e4',
   now() + interval '2 hours 2 minutes', now() + interval '3 hours 2 minutes',
   'Europe/London', true, NULL),
  ('40630000-0000-4000-8000-0000000000d6',
   '40630000-0000-4000-8000-0000000000e5',
   now() + interval '2 hours 2 minutes', now() + interval '3 hours 2 minutes',
   'UTC', true, NULL),
  ('40630000-0000-4000-8000-0000000000d7',
   '40630000-0000-4000-8000-0000000000e6',
   now() + interval '2 hours 2 minutes', now() + interval '3 hours 2 minutes',
   'UTC', true, NULL);

INSERT INTO public.orders(
  id, event_id, event_date_id, buyer_user_id, buyer_email, buyer_phone_e164,
  total_cents, currency, payment_method, payment_status, source, booked_start_at
) VALUES
  ('40630000-0000-4000-8000-000000000101',
   '40630000-0000-4000-8000-0000000000e1', NULL, NULL,
   'recurring-4063@example.test', '+14155550101', 1000, 'USD', 'online_card', 'paid',
   'manual_import', NULL),
  ('40630000-0000-4000-8000-000000000102',
   '40630000-0000-4000-8000-0000000000e2',
   '40630000-0000-4000-8000-0000000000d3', NULL,
   'outside-4063@example.test', NULL, 1000, 'USD', 'online_card', 'paid',
   'manual_import', NULL),
  ('40630000-0000-4000-8000-000000000103',
   '40630000-0000-4000-8000-0000000000e3',
   '40630000-0000-4000-8000-0000000000d4', NULL,
   'old-key-4063@example.test', NULL, 1000, 'USD', 'online_card', 'paid',
   'manual_import', NULL),
  ('40630000-0000-4000-8000-000000000104',
   '40630000-0000-4000-8000-0000000000e4',
   '40630000-0000-4000-8000-0000000000d5', NULL,
   'partial-4063@example.test', NULL, 1000, 'USD', 'online_card', 'partial_refund',
   'manual_import', NULL),
  ('40630000-0000-4000-8000-000000000105',
   '40630000-0000-4000-8000-0000000000e5',
   '40630000-0000-4000-8000-0000000000d6', NULL,
   'refunded-4063@example.test', NULL, 1000, 'USD', 'online_card', 'refunded',
   'manual_import', NULL),
  ('40630000-0000-4000-8000-000000000106',
   '40630000-0000-4000-8000-0000000000e6',
   '40630000-0000-4000-8000-0000000000d7', NULL,
   'cancelled-4063@example.test', NULL, 1000, 'USD', 'online_card', 'paid',
   'manual_import', NULL),
  ('40630000-0000-4000-8000-000000000107',
   '40630000-0000-4000-8000-0000000000e7', NULL,
   '40630000-0000-4000-8000-0000000000a2',
   'experience-4063@example.test', '+2348012345607', 1000, 'USD', 'online_card',
   'paid', 'manual_import', now() + interval '2 hours 2 minutes');

INSERT INTO public.tickets(
  id, order_id, ticket_type_id, event_id, qr_code, status, approval_status
) VALUES
  ('40630000-0000-4000-8000-000000000201',
   '40630000-0000-4000-8000-000000000101',
   '40630000-0000-4000-8000-000000000301',
   '40630000-0000-4000-8000-0000000000e1', 'i4063-qr-201', 'valid', 'approved'),
  ('40630000-0000-4000-8000-000000000202',
   '40630000-0000-4000-8000-000000000102',
   '40630000-0000-4000-8000-000000000302',
   '40630000-0000-4000-8000-0000000000e2', 'i4063-qr-202', 'valid', 'approved'),
  ('40630000-0000-4000-8000-000000000203',
   '40630000-0000-4000-8000-000000000103',
   '40630000-0000-4000-8000-000000000303',
   '40630000-0000-4000-8000-0000000000e3', 'i4063-qr-203', 'valid', 'approved'),
  ('40630000-0000-4000-8000-000000000204',
   '40630000-0000-4000-8000-000000000104',
   '40630000-0000-4000-8000-000000000304',
   '40630000-0000-4000-8000-0000000000e4', 'i4063-qr-204', 'valid', 'approved'),
  ('40630000-0000-4000-8000-000000000205',
   '40630000-0000-4000-8000-000000000105',
   '40630000-0000-4000-8000-000000000305',
   '40630000-0000-4000-8000-0000000000e5', 'i4063-qr-205', 'valid', 'approved'),
  ('40630000-0000-4000-8000-000000000206',
   '40630000-0000-4000-8000-000000000106',
   '40630000-0000-4000-8000-000000000306',
   '40630000-0000-4000-8000-0000000000e6', 'i4063-qr-206', 'refunded', 'approved'),
  ('40630000-0000-4000-8000-000000000207',
   '40630000-0000-4000-8000-000000000107',
   '40630000-0000-4000-8000-000000000307',
   '40630000-0000-4000-8000-0000000000e7', 'i4063-qr-207', 'valid', 'approved');

INSERT INTO public.ticket_event_dates(ticket_id, event_date_id) VALUES
  ('40630000-0000-4000-8000-000000000201',
   '40630000-0000-4000-8000-0000000000d2');

INSERT INTO public.notification_outbox(
  category_key, contact, brand_id, payload, idempotency_key, country_code, created_at
) VALUES (
  'buyer_event_reminder', 'old-key-4063@example.test',
  '40630000-0000-4000-8000-0000000000b1', '{}'::jsonb,
  'buyer_event_reminder:40630000-0000-4000-8000-000000000103:2h', NULL,
  now() - interval '1 hour'
);

INSERT INTO public.reservations(
  id, brand_id, venue_id, reserved_for, party_size, status, source, created_via,
  guest_name, guest_phone_e164, guest_email, consumer_user_id
) VALUES
  ('40630000-0000-4000-8000-000000000401',
   '40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000c1',
   now() + interval '2 hours 2 minutes', 4, 'confirmed', 'website', 'guest',
   'Reminder Guest', '+14155550401', 'reservation-4063@example.test',
   '40630000-0000-4000-8000-0000000000a2'),
  ('40630000-0000-4000-8000-000000000402',
   '40630000-0000-4000-8000-0000000000b1',
   '40630000-0000-4000-8000-0000000000c1',
   now() + interval '2 hours 4 minutes', 2, 'confirmed', 'website', 'guest',
   'Later Guest', '+14155550402', 'later-4063@example.test', NULL);

SET LOCAL session_replication_role = origin;

SELECT pg_temp.i4063_assert(
  public.pg_notify_reminders_enqueue(2, '2h', 999) = 4,
  'first tick must enqueue bought Date B, partial refund, experience and reservation only'
);
SELECT pg_temp.i4063_assert(
  public.pg_notify_reminders_enqueue(2, '2h', 1) = 0,
  'second overlapping five-minute tick must be idempotent'
);
SELECT pg_temp.i4063_assert(
  public.pg_notify_reminders_enqueue(2, '2h', 30) = 0,
  'third overlapping five-minute tick must remain idempotent'
);

SELECT pg_temp.i4063_assert((
  SELECT count(*) = 1
    FROM public.notification_outbox
   WHERE idempotency_key =
     'buyer_event_reminder:40630000-0000-4000-8000-000000000101:40630000-0000-4000-8000-0000000000d2:2h'
     AND contact = '+14155550101'
     AND payload->>'event_date_id' = '40630000-0000-4000-8000-0000000000d2'
     AND payload->>'date_title' = 'Date B'
     AND payload->>'timezone' = 'America/New_York'
), 'recurring order must remind for bought Date B and phone-first contact only');

SELECT pg_temp.i4063_assert(NOT EXISTS (
  SELECT 1 FROM public.notification_outbox
   WHERE idempotency_key LIKE
     'buyer_event_reminder:40630000-0000-4000-8000-000000000101:40630000-0000-4000-8000-0000000000d1:%'
), 'recurring order must not remind for unbought Date A');

SELECT pg_temp.i4063_assert(NOT EXISTS (
  SELECT 1 FROM public.notification_outbox
   WHERE idempotency_key LIKE
     'buyer_event_reminder:40630000-0000-4000-8000-000000000102:%'
), 'event at lead plus four minutes must stay outside the fixed window');

SELECT pg_temp.i4063_assert(NOT EXISTS (
  SELECT 1 FROM public.notification_outbox
   WHERE idempotency_key =
     'buyer_event_reminder:40630000-0000-4000-8000-000000000103:40630000-0000-4000-8000-0000000000d4:2h'
), 'old no-date idempotency key within 26 hours must suppress the new key');

SELECT pg_temp.i4063_assert(EXISTS (
  SELECT 1 FROM public.notification_outbox
   WHERE idempotency_key =
     'buyer_event_reminder:40630000-0000-4000-8000-000000000104:40630000-0000-4000-8000-0000000000d5:2h'
), 'partial-refund order with a valid ticket must be reminded');

SELECT pg_temp.i4063_assert(NOT EXISTS (
  SELECT 1 FROM public.notification_outbox
   WHERE idempotency_key LIKE
     'buyer_event_reminder:40630000-0000-4000-8000-000000000105:%'
      OR idempotency_key LIKE
     'buyer_event_reminder:40630000-0000-4000-8000-000000000106:%'
), 'fully refunded orders and orders without a valid ticket must stay quiet');

SELECT pg_temp.i4063_assert(EXISTS (
  SELECT 1 FROM public.notification_outbox
   WHERE idempotency_key =
     'buyer_event_reminder:40630000-0000-4000-8000-000000000107:booked:2h'
     AND payload->>'kind' = 'experience'
     AND payload->>'claimed' = 'true'
     AND payload->>'timezone' = 'Africa/Lagos'
), 'experience reminder must use booked_start_at and the booked key');

SELECT pg_temp.i4063_assert(EXISTS (
  SELECT 1 FROM public.notification_outbox
   WHERE idempotency_key =
     'buyer_reservation_reminder:40630000-0000-4000-8000-000000000401:2h'
     AND payload->>'venue_id' = '40630000-0000-4000-8000-0000000000c1'
     AND payload->>'venue_name' = 'Reminder Room'
     AND payload->>'timezone' = 'America/New_York'
     AND payload->>'claimed' = 'true'
), 'reservation reminder must carry the trusted venue payload');

SELECT pg_temp.i4063_assert(NOT EXISTS (
  SELECT 1 FROM public.notification_outbox
   WHERE idempotency_key =
     'buyer_reservation_reminder:40630000-0000-4000-8000-000000000402:2h'
), 'reservation at lead plus four minutes must stay outside the fixed window');

SELECT pg_temp.i4063_assert((
  SELECT schedule = '*/5 * * * *'
    FROM cron.job
   WHERE jobname = 'orch_1161_notify_reminders'
), 'reminder cron must run every five minutes');

ROLLBACK;
