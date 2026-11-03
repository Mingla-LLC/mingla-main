\set ON_ERROR_STOP on

-- Issue #4238 — Host ads promote every date of a series. Runs after the full
-- migration chain on PostgreSQL 17 as supabase_admin over 127.0.0.1.
--
--   T1  Weekly event, first date past, three future: ok, starts_at = next date,
--       dates_remaining 3. (The hourly pause guard resolves this same RPC, so a
--       live ad on it is NOT paused after the first date.)
--   T2  Every date past: ended (the pause guard now pauses it).
--   T3  A cancelled future date never counts.
--   T4  Sold out with future dates: nothing_on_sale.
--   T5  Sales closed, and sales not started: nothing_on_sale.
--   T6  One hidden tier plus one sellable tier: ok.
--   T7  Trip past its booking deadline / bookings_closed / departed.
--   T8  Unlisted event vs unlisted trip vs unlisted experience; private.
--   T9  RSVP not on the Explorer feed: ok; full: nothing_on_sale; full with
--       waitlist: ok.
--   T10 Boundary: a date ending one minute ahead is bookable, one minute
--       behind is not; a trip departing in one minute is; soon under 48 h.
--   T11 last_bookable_at = least(last date, last sale end, trip deadline).
--   T12 ad_advertisable_pages: include_unavailable on/off, order, unlisted
--       event listed, anon cannot execute, non-member 42501.
--   T13 a non-member resolving a private, unpublished, unlisted-trip/experience
--       or deleted-brand page gets only {ok, code, page_type, availability,
--       availability_reason}; a member still sees title + reason in the list.
--   T14 a tier valid only for the early dates caps last_bookable_at at the end
--       of the last date it covers.
--
-- MINGLA-INVARIANT: I-4238-AD-SERIES-ENDS-AT-LAST-BOOKABLE-DATE | issue #4238 | A dated offering can be advertised while one of its dates can still be booked (an event, RSVP or experience date until it ends, a trip departure until it starts; cancelled dates never count); its first date passing never ends it.
-- MINGLA-INVARIANT: I-4238-AD-SOMETHING-ON-SALE | issue #4238 | An offering can be advertised only when something can be bought or RSVPed now: a listed, enabled, online, open ticket inside its sale window with places left for a bookable date, or an RSVP with room or a waitlist; a trip also needs bookings open before its deadline.
-- MINGLA-INVARIANT: I-4238-AD-REFUSAL-IS-BARE | issue #4238 | The signed-in ad resolver refuses a page that is not open to the public (private, unpublished, moderation-blocked, deleted brand, unlisted trip or experience) with only ok, code, page_type, availability and availability_reason; title, cover, city, ids and slugs come only from the membership-checked list.
-- MINGLA-INVARIANT: I-4238-AD-UNLISTED-FOLLOWS-THE-LINK | issue #4238 | Unlisted events and RSVPs can be advertised because their link opens; unlisted trips and experiences cannot, because their link does not; private, unpublished and moderation-blocked offerings never can.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 ads all dates FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.r(p_type text, p_slug text)
RETURNS jsonb LANGUAGE sql AS $r$
  SELECT public.ad_destination_resolve(p_type, 'issue-4238-dates', p_slug)
$r$;

-- An offering with optional dates (offsets in hours from now: start, end).
CREATE OR REPLACE FUNCTION pg_temp.offering(
  p_n int, p_type text, p_slug text, p_visibility text DEFAULT 'public',
  p_status text DEFAULT 'scheduled')
RETURNS uuid LANGUAGE plpgsql AS $o$
DECLARE v_id uuid := ('42380000-1000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, status, event_type, visibility, timezone)
  VALUES (v_id, '42380000-0000-4000-8000-000000000010', 'Offering ' || p_slug, p_slug,
          p_status, p_type, p_visibility, 'Africa/Lagos');
  RETURN v_id;
END $o$;

CREATE OR REPLACE FUNCTION pg_temp.add_date(
  p_event uuid, p_start interval, p_end interval, p_master boolean DEFAULT false,
  p_cancelled boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql AS $d$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, is_master, timezone, cancelled_at)
  VALUES (v_id, p_event, now() + p_start, now() + p_end, p_master, 'Africa/Lagos',
          CASE WHEN p_cancelled THEN now() ELSE NULL END);
  RETURN v_id;
END $d$;

CREATE OR REPLACE FUNCTION pg_temp.add_tier(
  p_event uuid, p_qty int DEFAULT NULL, p_sale_start interval DEFAULT NULL,
  p_sale_end interval DEFAULT NULL, p_hidden boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql AS $t$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total,
    is_unlimited, sale_start_at, sale_end_at, is_hidden)
  VALUES (v_id, p_event, 'Tier', 500000, 'NGN', p_qty, p_qty IS NULL,
    CASE WHEN p_sale_start IS NULL THEN NULL ELSE now() + p_sale_start END,
    CASE WHEN p_sale_end IS NULL THEN NULL ELSE now() + p_sale_end END,
    p_hidden);
  RETURN v_id;
END $t$;

INSERT INTO auth.users(id) VALUES
  ('42380000-0000-4000-8000-000000000001'),
  ('42380000-0000-4000-8000-000000000002'),
  ('42380000-0000-4000-8000-000000000003');
INSERT INTO public.creator_accounts(id, email) VALUES ('42380000-0000-4000-8000-000000000001', 'owner-4238@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('42380000-0000-4000-8000-000000000010', '42380000-0000-4000-8000-000000000001',
        'Dates Brand', 'issue-4238-dates', 'NGN', now(), now());
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
VALUES ('42380000-0000-4000-8000-000000000010', '42380000-0000-4000-8000-000000000002', 'scanner', now());

DO $fx$
DECLARE v uuid; v_tier uuid; i int;
BEGIN
  -- T1 weekly: first date past, three future.
  v := pg_temp.offering(1, 'event', 'weekly');
  PERFORM pg_temp.add_date(v, interval '-7 days', interval '-7 days' + interval '3 hours', true);
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours');
  PERFORM pg_temp.add_date(v, interval '14 days', interval '14 days 3 hours');
  PERFORM pg_temp.add_date(v, interval '21 days', interval '21 days 3 hours');
  PERFORM pg_temp.add_tier(v);
  -- T2 all past.
  v := pg_temp.offering(2, 'event', 'all-past');
  PERFORM pg_temp.add_date(v, interval '-14 days', interval '-14 days 3 hours', true);
  PERFORM pg_temp.add_date(v, interval '-7 days', interval '-7 days 3 hours');
  PERFORM pg_temp.add_tier(v);
  -- T3 only future date is cancelled.
  v := pg_temp.offering(3, 'event', 'cancelled-future');
  PERFORM pg_temp.add_date(v, interval '-7 days', interval '-7 days 3 hours', true);
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', false, true);
  PERFORM pg_temp.add_tier(v);
  -- T4 sold out with future dates (2 tickets of 2 sold).
  v := pg_temp.offering(4, 'event', 'sold-out');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  PERFORM pg_temp.add_date(v, interval '14 days', interval '14 days 3 hours');
  v_tier := pg_temp.add_tier(v, 2);
  -- T5a sales ended; T5b sales not started.
  v := pg_temp.offering(5, 'event', 'sales-ended');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  PERFORM pg_temp.add_tier(v, NULL, NULL, interval '-1 day');
  v := pg_temp.offering(6, 'event', 'sales-later');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  PERFORM pg_temp.add_tier(v, NULL, interval '1 day', NULL);
  -- T6 hidden + sellable tier.
  v := pg_temp.offering(7, 'event', 'one-hidden');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  PERFORM pg_temp.add_tier(v, NULL, NULL, NULL, true);
  PERFORM pg_temp.add_tier(v);
  -- T7 trips.
  v := pg_temp.offering(8, 'trip', 'trip-deadline-past');
  PERFORM pg_temp.add_date(v, interval '10 days', interval '14 days', true);
  PERFORM pg_temp.add_tier(v);
  UPDATE public.events SET booking_deadline = now() - interval '1 hour' WHERE id = v;
  v := pg_temp.offering(9, 'trip', 'trip-closed');
  PERFORM pg_temp.add_date(v, interval '10 days', interval '14 days', true);
  PERFORM pg_temp.add_tier(v);
  UPDATE public.events SET bookings_closed = true WHERE id = v;
  v := pg_temp.offering(10, 'trip', 'trip-departed');
  PERFORM pg_temp.add_date(v, interval '-1 day', interval '5 days', true);
  PERFORM pg_temp.add_tier(v);
  v := pg_temp.offering(11, 'trip', 'trip-open');
  PERFORM pg_temp.add_date(v, interval '10 days', interval '14 days', true);
  PERFORM pg_temp.add_tier(v, NULL, NULL, interval '8 days');
  UPDATE public.events SET booking_deadline = now() + interval '6 days' WHERE id = v;
  -- T8 visibility.
  v := pg_temp.offering(12, 'event', 'unlisted-event', 'hidden');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  PERFORM pg_temp.add_tier(v);
  v := pg_temp.offering(13, 'trip', 'unlisted-trip', 'hidden');
  PERFORM pg_temp.add_date(v, interval '10 days', interval '14 days', true);
  PERFORM pg_temp.add_tier(v);
  v := pg_temp.offering(14, 'experience', 'unlisted-experience', 'hidden');
  PERFORM pg_temp.add_date(v, interval '2 days', interval '2 days 8 hours', true);
  PERFORM pg_temp.add_tier(v);
  v := pg_temp.offering(15, 'event', 'private-event', 'private');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  PERFORM pg_temp.add_tier(v);
  v := pg_temp.offering(16, 'event', 'unpublished-event', 'draft', 'draft');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  -- T9 RSVPs.
  v := pg_temp.offering(17, 'rsvp', 'rsvp-off-feed');
  UPDATE public.events SET rsvp_discoverable = false WHERE id = v;
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  v := pg_temp.offering(18, 'rsvp', 'rsvp-full');
  UPDATE public.events SET rsvp_capacity = 2, rsvp_waitlist_enabled = false WHERE id = v;
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status, plus_count)
  VALUES (v, '42380000-0000-4000-8000-000000000003', 'Guest', 'going', 'approved', 1);
  v := pg_temp.offering(19, 'rsvp', 'rsvp-full-waitlist');
  UPDATE public.events SET rsvp_capacity = 2, rsvp_waitlist_enabled = true WHERE id = v;
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status, plus_count)
  VALUES (v, '42380000-0000-4000-8000-000000000003', 'Guest', 'going', 'approved', 1);
  v := pg_temp.offering(26, 'rsvp', 'unlisted-rsvp', 'hidden');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  -- T10 boundaries.
  v := pg_temp.offering(20, 'event', 'ends-in-a-minute');
  PERFORM pg_temp.add_date(v, interval '-3 hours', interval '1 minute', true);
  PERFORM pg_temp.add_tier(v);
  v := pg_temp.offering(21, 'event', 'ended-a-minute-ago');
  PERFORM pg_temp.add_date(v, interval '-3 hours', interval '-1 minute', true);
  PERFORM pg_temp.add_tier(v);
  v := pg_temp.offering(22, 'trip', 'departs-in-a-minute');
  PERFORM pg_temp.add_date(v, interval '1 minute', interval '3 days', true);
  PERFORM pg_temp.add_tier(v);
  -- T11 last bookable: dated tiers 12 and 20 days, last date end 21 days 3h.
  v := pg_temp.offering(23, 'event', 'sale-ends');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  PERFORM pg_temp.add_date(v, interval '21 days', interval '21 days 3 hours');
  PERFORM pg_temp.add_tier(v, NULL, NULL, interval '12 days');
  PERFORM pg_temp.add_tier(v, NULL, NULL, interval '20 days');
  v := pg_temp.offering(24, 'event', 'one-open-ended-tier');
  PERFORM pg_temp.add_date(v, interval '7 days', interval '7 days 3 hours', true);
  PERFORM pg_temp.add_tier(v, NULL, NULL, interval '2 days');
  PERFORM pg_temp.add_tier(v);
  -- An experience with a running window.
  v := pg_temp.offering(25, 'experience', 'experience-running');
  PERFORM pg_temp.add_date(v, interval '-2 days', interval '-2 days 8 hours', true);
  PERFORM pg_temp.add_date(v, interval '-1 hour', interval '7 hours');
  PERFORM pg_temp.add_tier(v);
END
$fx$;

-- Two tickets sold on the sold-out tier.
DO $sold$
DECLARE v_tier uuid; v_order uuid := gen_random_uuid(); i int;
BEGIN
  SELECT id INTO v_tier FROM public.ticket_types WHERE event_id = '42380000-1000-4000-8000-000000000004';
  INSERT INTO public.orders(id, event_id, buyer_user_id, payment_status, source)
  VALUES (v_order, '42380000-1000-4000-8000-000000000004', '42380000-0000-4000-8000-000000000003', 'paid', 'manual_import');
  FOR i IN 1..2 LOOP
    INSERT INTO public.tickets(order_id, ticket_type_id, event_id, status, qr_code)
    VALUES (v_order, v_tier, '42380000-1000-4000-8000-000000000004', 'valid', 'issue-4238-qr-' || i);
  END LOOP;
END
$sold$;

-- ── T1 ──
DO $t1$
DECLARE j jsonb := pg_temp.r('event', 'weekly');
BEGIN
  PERFORM pg_temp.t_assert((j->>'ok')::boolean, 'T1 series with a past first date is advertisable');
  PERFORM pg_temp.t_assert((j->>'dates_remaining')::int = 3, 'T1 dates_remaining = 3');
  PERFORM pg_temp.t_assert((j->>'starts_at')::timestamptz > now() + interval '6 days'
    AND (j->>'starts_at')::timestamptz < now() + interval '8 days', 'T1 starts_at is the next date, not the first');
  PERFORM pg_temp.t_assert(j->>'next_date' = j->>'starts_at', 'T1 next_date = starts_at');
  PERFORM pg_temp.t_assert(j->>'canonical_url' = 'https://host.usemingla.com/e/issue-4238-dates/weekly', 'T1 series page URL');
  PERFORM pg_temp.t_assert(j->>'timezone' = 'Africa/Lagos', 'T1 event time zone returned');
  PERFORM pg_temp.t_assert((j->>'last_bookable_at')::timestamptz > now() + interval '21 days', 'T1 last_bookable_at = last date end');
END $t1$;

-- ── T2/T3 ──
SELECT pg_temp.t_assert(pg_temp.r('event', 'all-past')->>'availability' = 'ended'
  AND pg_temp.r('event', 'all-past')->>'code' = 'destination_ended'
  AND (pg_temp.r('event', 'all-past')->>'ok')::boolean = false, 'T2 every date past → ended');
SELECT pg_temp.t_assert(pg_temp.r('event', 'cancelled-future')->>'availability' = 'ended', 'T3 cancelled future date does not count');

-- ── T4/T5/T6 ──
SELECT pg_temp.t_assert(pg_temp.r('event', 'sold-out')->>'availability' = 'nothing_on_sale', 'T4 sold out → nothing_on_sale');
SELECT pg_temp.t_assert(pg_temp.r('event', 'sales-ended')->>'availability' = 'nothing_on_sale', 'T5 sales ended → nothing_on_sale');
SELECT pg_temp.t_assert(pg_temp.r('event', 'sales-later')->>'availability' = 'nothing_on_sale', 'T5 sales not started → nothing_on_sale');
SELECT pg_temp.t_assert((pg_temp.r('event', 'one-hidden')->>'ok')::boolean, 'T6 one sellable tier is enough');

-- ── T7 ──
SELECT pg_temp.t_assert(pg_temp.r('trip', 'trip-deadline-past')->>'availability' = 'bookings_closed', 'T7 trip past its booking deadline → bookings_closed');
SELECT pg_temp.t_assert(pg_temp.r('trip', 'trip-closed')->>'availability' = 'bookings_closed', 'T7 bookings_closed trip');
SELECT pg_temp.t_assert(pg_temp.r('trip', 'trip-departed')->>'availability' = 'ended', 'T7 departed trip → ended');
SELECT pg_temp.t_assert((pg_temp.r('trip', 'trip-open')->>'ok')::boolean
  AND pg_temp.r('trip', 'trip-open')->>'canonical_url' = 'https://host.usemingla.com/t/issue-4238-dates/trip-open', 'T7 open trip ok on /t/');

-- ── T8 ──
SELECT pg_temp.t_assert((pg_temp.r('event', 'unlisted-event')->>'ok')::boolean
  AND pg_temp.r('event', 'unlisted-event')->>'canonical_url' = 'https://host.usemingla.com/e/issue-4238-dates/unlisted-event', 'T8 unlisted event ok on its link');
SELECT pg_temp.t_assert((pg_temp.r('rsvp', 'unlisted-rsvp')->>'ok')::boolean, 'T8 unlisted RSVP ok');
SELECT pg_temp.t_assert(pg_temp.r('trip', 'unlisted-trip')->>'availability' = 'unlisted'
  AND pg_temp.r('trip', 'unlisted-trip')->>'code' = 'destination_unlisted_not_linkable', 'T8 unlisted trip refused');
SELECT pg_temp.t_assert(pg_temp.r('experience', 'unlisted-experience')->>'availability' = 'unlisted', 'T8 unlisted experience refused');
SELECT pg_temp.t_assert(pg_temp.r('event', 'private-event')->>'availability' = 'private', 'T8 private event refused');
SELECT pg_temp.t_assert(pg_temp.r('event', 'unpublished-event')->>'availability' = 'draft', 'T8 unpublished event refused');

-- ── T9 ──
SELECT pg_temp.t_assert((pg_temp.r('rsvp', 'rsvp-off-feed')->>'ok')::boolean
  AND pg_temp.r('rsvp', 'rsvp-off-feed')->>'result_kind' = 'signups', 'T9 RSVP off the Explorer feed is advertisable');
SELECT pg_temp.t_assert(pg_temp.r('rsvp', 'rsvp-full')->>'availability' = 'nothing_on_sale', 'T9 full RSVP → nothing_on_sale');
SELECT pg_temp.t_assert((pg_temp.r('rsvp', 'rsvp-full-waitlist')->>'ok')::boolean, 'T9 full RSVP with waitlist ok');

-- ── T10 ──
SELECT pg_temp.t_assert((pg_temp.r('event', 'ends-in-a-minute')->>'ok')::boolean
  AND pg_temp.r('event', 'ends-in-a-minute')->>'availability' = 'soon', 'T10 date ending in a minute still bookable, soon');
SELECT pg_temp.t_assert(pg_temp.r('event', 'ended-a-minute-ago')->>'availability' = 'ended', 'T10 date ended a minute ago → ended');
SELECT pg_temp.t_assert((pg_temp.r('trip', 'departs-in-a-minute')->>'ok')::boolean, 'T10 trip departing in a minute bookable');
SELECT pg_temp.t_assert((pg_temp.r('experience', 'experience-running')->>'ok')::boolean
  AND (pg_temp.r('experience', 'experience-running')->>'dates_remaining')::int = 1, 'T10 running experience window bookable');

-- ── T11 ──
DO $t11$
DECLARE j jsonb := pg_temp.r('event', 'sale-ends'); k jsonb := pg_temp.r('event', 'one-open-ended-tier');
  t jsonb := pg_temp.r('trip', 'trip-open');
BEGIN
  PERFORM pg_temp.t_assert(abs(extract(epoch FROM (j->>'last_bookable_at')::timestamptz - (now() + interval '20 days'))) < 5,
    'T11 last_bookable_at = latest tier sale end when every tier has one');
  PERFORM pg_temp.t_assert(abs(extract(epoch FROM (k->>'last_bookable_at')::timestamptz - (now() + interval '7 days 3 hours'))) < 5,
    'T11 an open-ended tier ignores the ticket term');
  PERFORM pg_temp.t_assert(abs(extract(epoch FROM (t->>'last_bookable_at')::timestamptz - (now() + interval '6 days'))) < 5,
    'T11 trip: booking deadline is the earliest term');
END $t11$;

-- ── T12 list ──
SELECT pg_temp.t_assert(NOT has_function_privilege('anon', 'public.ad_advertisable_pages(text,text[],boolean,uuid,integer)', 'EXECUTE'), 'T12 anon cannot list');
SELECT pg_temp.t_assert(NOT has_function_privilege('anon', 'public.ad_offering_destination_by_id(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ad_offering_destination_by_id(uuid)', 'EXECUTE'), 'T12 rule owner is service only');
SELECT pg_temp.t_assert(NOT has_function_privilege('anon', 'public.ad_destination_resolve(text,text,text)', 'EXECUTE'), 'T12 anon cannot resolve');

SELECT set_config('request.jwt.claim.sub', '42380000-0000-4000-8000-000000000002', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);

DO $t12$
DECLARE n_all int; n_ok int; n_bad int; first_bad int; last_ok int;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)
  INTO n_ok, n_bad
  FROM (SELECT * FROM public.ad_advertisable_pages(NULL, ARRAY['event','rsvp','trip','experience'], true, '42380000-0000-4000-8000-000000000010', 0)
        UNION ALL SELECT * FROM public.ad_advertisable_pages(NULL, ARRAY['event','rsvp','trip','experience'], true, '42380000-0000-4000-8000-000000000010', 1)) p;
  PERFORM pg_temp.t_assert(n_ok + n_bad = 26, 'T12 include_unavailable lists every offering (26)');
  PERFORM pg_temp.t_assert(n_ok > 0 AND n_bad > 0, 'T12 both ok and unavailable rows');
  SELECT count(*) INTO n_all FROM public.ad_advertisable_pages(NULL, ARRAY['event','rsvp','trip','experience'], false, '42380000-0000-4000-8000-000000000010', 0);
  PERFORM pg_temp.t_assert(n_all = n_ok, 'T12 without include_unavailable only ok rows');
  PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM public.ad_advertisable_pages('unlisted-event', NULL, false, '42380000-0000-4000-8000-000000000010', 0)
     WHERE entity_slug = 'unlisted-event' AND ok), 'T12 unlisted event listed as promotable');
  PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM public.ad_advertisable_pages('unpublished', NULL, true, '42380000-0000-4000-8000-000000000010', 0)
     WHERE entity_slug = 'unpublished-event' AND availability = 'draft' AND NOT ok), 'T12 unpublished shown with its reason');
  PERFORM pg_temp.t_assert(NOT EXISTS (SELECT 1 FROM public.ad_advertisable_pages('unpublished', NULL, false, '42380000-0000-4000-8000-000000000010', 0)),
    'T12 unpublished hidden without include_unavailable');
  PERFORM pg_temp.t_assert((SELECT dates_remaining = 3 AND next_date = starts_at AND timezone = 'Africa/Lagos'
     FROM public.ad_advertisable_pages('weekly', NULL, false, '42380000-0000-4000-8000-000000000010', 0) WHERE entity_slug = 'weekly'),
     'T12 list returns next_date, dates_remaining, timezone');
  WITH p AS (
    SELECT row_number() OVER () AS rn, ok FROM public.ad_advertisable_pages(NULL, ARRAY['event','rsvp','trip','experience'], true, '42380000-0000-4000-8000-000000000010', 0)
  ) SELECT min(rn) FILTER (WHERE NOT ok), max(rn) FILTER (WHERE ok) INTO first_bad, last_ok FROM p;
  PERFORM pg_temp.t_assert(first_bad IS NULL OR last_ok IS NULL OR last_ok < first_bad, 'T12 ok rows sort first');
END $t12$;

SELECT set_config('request.jwt.claim.sub', '42380000-0000-4000-8000-000000000003', false);
DO $t12b$
BEGIN
  BEGIN
    PERFORM * FROM public.ad_advertisable_pages(NULL, NULL, true, '42380000-0000-4000-8000-000000000010', 0);
    RAISE EXCEPTION 'issue #4238 ads all dates FAIL: T12 non-member listed';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  T12 non-member refused 42501';
  END;
END $t12b$;

-- ── T13 bare refusals (I-4238-AD-REFUSAL-IS-BARE) ──
-- A signed-in account that is not a brand member, guessing brand + slug,
-- learns nothing about a page that is not open to the public: only
-- {ok, code, page_type, availability, availability_reason}. A member still
-- sees the title and the reason through the membership-checked list.
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('42380000-0000-4000-8000-000000000020', '42380000-0000-4000-8000-000000000001',
        'Gone Brand', 'issue-4238-gone', 'NGN', now(), now());
INSERT INTO public.events(id, brand_id, title, slug, status, event_type, visibility, timezone, city, cover_media_url)
VALUES ('42380000-1000-4000-8000-000000000099', '42380000-0000-4000-8000-000000000020',
        'Gone brand party', 'gone-party', 'scheduled', 'event', 'public', 'Africa/Lagos', 'Yaba', 'https://cdn.test/gone.jpg');
INSERT INTO public.event_dates(event_id, start_at, end_at, is_master, timezone)
VALUES ('42380000-1000-4000-8000-000000000099', now() + interval '7 days', now() + interval '7 days 3 hours', true, 'Africa/Lagos');
-- The delete guard refuses a brand with events; a deleted brand whose rows
-- survived is the case the resolver must still refuse bare.
SET LOCAL session_replication_role = replica;
UPDATE public.brands SET deleted_at = now() WHERE id = '42380000-0000-4000-8000-000000000020';
SET LOCAL session_replication_role = origin;
UPDATE public.events SET city = 'Ikoyi', cover_media_url = 'https://cdn.test/secret.jpg'
WHERE brand_id = '42380000-0000-4000-8000-000000000010';

SELECT set_config('request.jwt.claim.sub', '42380000-0000-4000-8000-000000000003', false);
SELECT set_config('request.jwt.claims', '{"sub":"42380000-0000-4000-8000-000000000003","role":"authenticated"}', false);
SET ROLE authenticated;
DO $t13$
DECLARE j jsonb; k text;
  v_cases text[][] := ARRAY[
    ARRAY['event', 'issue-4238-dates', 'private-event', 'private'],
    ARRAY['event', 'issue-4238-dates', 'unpublished-event', 'draft'],
    ARRAY['trip', 'issue-4238-dates', 'unlisted-trip', 'unlisted'],
    ARRAY['experience', 'issue-4238-dates', 'unlisted-experience', 'unlisted'],
    ARRAY['event', 'issue-4238-gone', 'gone-party', 'draft']];
  i int;
BEGIN
  FOR i IN 1..array_length(v_cases, 1) LOOP
    j := public.ad_destination_resolve(v_cases[i][1], v_cases[i][2], v_cases[i][3]);
    PERFORM pg_temp.t_assert((j->>'ok')::boolean IS FALSE AND j->>'availability' = v_cases[i][4],
      'T13 non-member refused ' || v_cases[i][3] || ' as ' || v_cases[i][4]);
    FOR k IN SELECT jsonb_object_keys(j) LOOP
      PERFORM pg_temp.t_assert(k IN ('ok', 'code', 'page_type', 'availability', 'availability_reason'),
        'T13 ' || v_cases[i][3] || ' refusal key "' || k || '" is one of the bare five');
    END LOOP;
    PERFORM pg_temp.t_assert(j::text NOT LIKE '%Offering%' AND j::text NOT LIKE '%cdn.test%'
      AND j::text NOT LIKE '%Ikoyi%' AND j::text NOT LIKE '%Gone%' AND j::text NOT LIKE '%42380000%',
      'T13 ' || v_cases[i][3] || ' refusal carries no title, cover, city, brand or id');
  END LOOP;
END $t13$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '42380000-0000-4000-8000-000000000002', false);
SELECT set_config('request.jwt.claims', '{"sub":"42380000-0000-4000-8000-000000000002","role":"authenticated"}', false);
SET ROLE authenticated;
SELECT pg_temp.t_assert((SELECT title = 'Offering private-event' AND availability = 'private'
    AND availability_reason = 'admin.dest.private' AND canonical_url IS NULL AND NOT ok
  FROM public.ad_advertisable_pages('private-event', NULL, true, '42380000-0000-4000-8000-000000000010', 0)
  WHERE entity_slug = 'private-event'),
  'T13 a member still sees their own private page''s title and reason in the picker');
SELECT pg_temp.t_assert((SELECT title = 'Offering unlisted-trip' AND availability_reason = 'admin.dest.unlisted'
  FROM public.ad_advertisable_pages('unlisted-trip', NULL, true, '42380000-0000-4000-8000-000000000010', 0)
  WHERE entity_slug = 'unlisted-trip'),
  'T13 a member still sees their own unlisted trip''s title and reason');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', false);
SELECT set_config('request.jwt.claims', '', false);

-- ── T14 a tier valid only for the early dates caps last_bookable_at ──
-- Dates in 7 and 21 days; the only ticket covers the 7-day date. Nothing is on
-- sale for the 21-day date, so the ad ends when the 7-day date ends.
INSERT INTO public.events(id, brand_id, title, slug, status, event_type, visibility, timezone)
VALUES ('42380000-1000-4000-8000-000000000098', '42380000-0000-4000-8000-000000000010',
        'Offering keyed-early', 'keyed-early', 'scheduled', 'event', 'public', 'Africa/Lagos');
INSERT INTO public.event_dates(event_id, start_at, end_at, is_master, timezone, occurrence_key) VALUES
  ('42380000-1000-4000-8000-000000000098', now() + interval '7 days', now() + interval '7 days 3 hours', true, 'Africa/Lagos', 'ke1'),
  ('42380000-1000-4000-8000-000000000098', now() + interval '21 days', now() + interval '21 days 3 hours', false, 'Africa/Lagos', 'ke2');
INSERT INTO public.ticket_types(event_id, name, price_cents, currency, quantity_total, is_unlimited, valid_occurrence_keys)
VALUES ('42380000-1000-4000-8000-000000000098', 'Early', 500000, 'NGN', NULL, true, ARRAY['ke1']);
DO $t14$
DECLARE j jsonb := pg_temp.r('event', 'keyed-early');
BEGIN
  PERFORM pg_temp.t_assert((j->>'ok')::boolean AND (j->>'dates_remaining')::int = 2, 'T14 keyed-early series promotable');
  PERFORM pg_temp.t_assert(abs(extract(epoch FROM (j->>'last_bookable_at')::timestamptz - (now() + interval '7 days 3 hours'))) < 5,
    'T14 last_bookable_at = end of the last date anything is on sale for (not the last date)');
END $t14$;

SELECT set_config('request.jwt.claim.sub', '', false);
\echo 'issue #4238 ads all dates: all passed'
ROLLBACK;
