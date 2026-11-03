\set ON_ERROR_STOP on

-- Issue #4238 — tester adversarial suite for "one ad covers every date".
-- Runs after the full migration chain on PostgreSQL 17 as supabase_admin over
-- 127.0.0.1. Everything happens inside one transaction that is rolled back, so
-- now() is frozen for the whole file: a date ending "exactly now" is a real
-- boundary here, not a race.
--
-- Different angles from the implementor suite:
--   X1  every future date cancelled (by cancelled_at AND by status) except a
--       past one → ended; the hourly pause guard reads this same RPC.
--   X2  a date ending exactly at now() is NOT bookable; a trip departing
--       exactly at now() is NOT bookable.
--   X3  time zone: events.timezone blank → the master date's zone; both blank
--       → UTC. A Lagos 00:30 date is returned as an instant (no viewer zone).
--   X4  a sold-out tier beside a tier still on sale → ok, and the sold-out
--       tier's later sale end never stretches last_bookable_at.
--   X5  RSVP at capacity exactly (plus-ones count; pending / maybe do not).
--   X6  an experience with time slots: per_start capacity, past slots never
--       counted, dates_remaining = future slots only.
--   X7  a trip with several departures: one departed → the rest still count;
--       the trip-level booking deadline passed → bookings_closed for all.
--   X8  an unlisted event's canonical URL opens for an ANONYMOUS buyer through
--       pg_direct_event_checkout_bundle (the buyer page's reader), even after
--       its first date has passed; an unlisted trip stays excluded from the
--       picker list and its buyer reader returns nothing.
--   X9  ad_plan_destination_resolve (the only path ad-plan create_version and
--       the launch gates use) carries last_bookable_at through, so the
--       schedule cap is not a no-op.
--   X10 last_bookable_at for a series whose keyed tier is valid for the early
--       dates only still ends at the last bookable date (documented) and the
--       pause-guard view of "after the first date" vs "after the last date".
--
-- Fails on revert: X1/X2/X7/X10 go red on the wave1 master-date rule (series
-- "ended" after date one); X3/X9 go red without the new keys; X8 goes red on
-- the old public-only candidate filter.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 tester adversarial FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.r(p_type text, p_slug text)
RETURNS jsonb LANGUAGE sql AS $r$
  SELECT public.ad_destination_resolve(p_type, 'issue-4238-tester', p_slug)
$r$;

CREATE OR REPLACE FUNCTION pg_temp.o(
  p_n int, p_type text, p_slug text, p_visibility text DEFAULT 'public',
  p_tz text DEFAULT 'Africa/Lagos')
RETURNS uuid LANGUAGE plpgsql AS $o$
DECLARE v_id uuid := ('42385555-1000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, status, event_type, visibility, timezone)
  VALUES (v_id, '42385555-0000-4000-8000-000000000010', 'Tester ' || p_slug, p_slug,
          'scheduled', p_type, p_visibility, p_tz);
  RETURN v_id;
END $o$;

-- Absolute timestamps (so a test can say "exactly now").
CREATE OR REPLACE FUNCTION pg_temp.d(
  p_event uuid, p_start timestamptz, p_end timestamptz, p_master boolean DEFAULT false,
  p_cancelled boolean DEFAULT false, p_status text DEFAULT 'active',
  p_tz text DEFAULT 'Africa/Lagos', p_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $d$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, is_master, timezone,
                                 cancelled_at, status, occurrence_key)
  VALUES (v_id, p_event, p_start, p_end, p_master, p_tz,
          CASE WHEN p_cancelled THEN now() ELSE NULL END, p_status,
          coalesce(p_key, 'k-' || v_id::text));
  RETURN v_id;
END $d$;

CREATE OR REPLACE FUNCTION pg_temp.t(
  p_event uuid, p_qty int DEFAULT NULL, p_sale_end timestamptz DEFAULT NULL,
  p_keys text[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $t$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total,
    is_unlimited, sale_end_at, valid_occurrence_keys)
  VALUES (v_id, p_event, 'Tier', 500000, 'NGN', p_qty, p_qty IS NULL, p_sale_end, p_keys);
  RETURN v_id;
END $t$;

CREATE OR REPLACE FUNCTION pg_temp.sell(p_event uuid, p_tier uuid, p_n int)
RETURNS void LANGUAGE plpgsql AS $s$
DECLARE v_order uuid := gen_random_uuid(); i int;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, payment_status, source)
  VALUES (v_order, p_event, '42385555-0000-4000-8000-000000000003', 'paid', 'manual_import');
  FOR i IN 1..p_n LOOP
    INSERT INTO public.tickets(order_id, ticket_type_id, event_id, status, qr_code)
    VALUES (v_order, p_tier, p_event, 'valid', 'issue-4238-tester-' || p_tier::text || '-' || i);
  END LOOP;
END $s$;

INSERT INTO auth.users(id) VALUES
  ('42385555-0000-4000-8000-000000000001'),
  ('42385555-0000-4000-8000-000000000002'),
  ('42385555-0000-4000-8000-000000000003'),
  ('42385555-0000-4000-8000-000000000004'),
  ('42385555-0000-4000-8000-000000000005');
INSERT INTO public.creator_accounts(id, email)
VALUES ('42385555-0000-4000-8000-000000000001', 'owner-4238-tester@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('42385555-0000-4000-8000-000000000010', '42385555-0000-4000-8000-000000000001',
        'Tester Brand', 'issue-4238-tester', 'NGN', now(), now());
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
VALUES ('42385555-0000-4000-8000-000000000010', '42385555-0000-4000-8000-000000000002', 'scanner', now());

DO $fx$
DECLARE v uuid; v_tier uuid; v_open uuid;
BEGIN
  -- X1a: past first date; every future date cancelled by cancelled_at.
  v := pg_temp.o(1, 'event', 'all-cancelled-but-past');
  PERFORM pg_temp.d(v, now() - interval '7 days', now() - interval '7 days' + interval '3 hours', true);
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours', false, true);
  PERFORM pg_temp.d(v, now() + interval '14 days', now() + interval '14 days 3 hours', false, true);
  PERFORM pg_temp.t(v);
  -- X1b: same, but the future dates are cancelled by status only.
  v := pg_temp.o(2, 'event', 'status-cancelled-but-past');
  PERFORM pg_temp.d(v, now() - interval '7 days', now() - interval '7 days' + interval '3 hours', true);
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours', false, false, 'cancelled');
  PERFORM pg_temp.t(v);
  -- X1c: control — one future date survives → ok, dates_remaining 1.
  v := pg_temp.o(3, 'event', 'one-survivor');
  PERFORM pg_temp.d(v, now() - interval '7 days', now() - interval '7 days' + interval '3 hours', true);
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours', false, true);
  PERFORM pg_temp.d(v, now() + interval '14 days', now() + interval '14 days 3 hours');
  PERFORM pg_temp.t(v);

  -- X2: exactly now.
  v := pg_temp.o(4, 'event', 'ends-exactly-now');
  PERFORM pg_temp.d(v, now() - interval '3 hours', now(), true);
  PERFORM pg_temp.t(v);
  v := pg_temp.o(5, 'trip', 'departs-exactly-now');
  PERFORM pg_temp.d(v, now(), now() + interval '3 days', true);
  PERFORM pg_temp.t(v);
  v := pg_temp.o(6, 'event', 'ends-now-plus-later');
  PERFORM pg_temp.d(v, now() - interval '3 hours', now(), true);
  PERFORM pg_temp.d(v, now() + interval '1 day', now() + interval '1 day 2 hours');
  PERFORM pg_temp.t(v);

  -- X3: time zone fallbacks (event_dates.timezone is NOT NULL; blank '' is the empty case). 00:30 Lagos on the date ten days out.
  v := pg_temp.o(7, 'event', 'tz-from-master', 'public', '   ');
  PERFORM pg_temp.d(v,
    ((date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '10 days 30 minutes') AT TIME ZONE 'Africa/Lagos'),
    ((date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '10 days 3 hours') AT TIME ZONE 'Africa/Lagos'),
    true, false, 'active', 'Africa/Lagos');
  PERFORM pg_temp.t(v);
  v := pg_temp.o(8, 'event', 'tz-none', 'public', NULL);
  PERFORM pg_temp.d(v, now() + interval '10 days', now() + interval '10 days 2 hours', true, false, 'active', '');
  PERFORM pg_temp.t(v);

  -- X4: sold-out tier (sale end +30 d) beside an open tier (sale end +10 d).
  v := pg_temp.o(9, 'event', 'sold-out-plus-open');
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours', true);
  PERFORM pg_temp.d(v, now() + interval '40 days', now() + interval '40 days 3 hours');
  v_tier := pg_temp.t(v, 2, now() + interval '30 days');
  v_open := pg_temp.t(v, 50, now() + interval '10 days');
  PERFORM pg_temp.sell(v, v_tier, 2);
  -- X4b: both tiers sold out → nothing_on_sale.
  v := pg_temp.o(10, 'event', 'all-tiers-sold-out');
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours', true);
  v_tier := pg_temp.t(v, 1);
  PERFORM pg_temp.sell(v, v_tier, 1);
  v_tier := pg_temp.t(v, 1);
  PERFORM pg_temp.sell(v, v_tier, 1);

  -- X5: RSVP at capacity exactly (1 + 2 plus-ones = 3 of 3).
  v := pg_temp.o(11, 'rsvp', 'rsvp-at-capacity');
  UPDATE public.events SET rsvp_capacity = 3, rsvp_waitlist_enabled = false WHERE id = v;
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours', true);
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status, plus_count)
  VALUES (v, '42385555-0000-4000-8000-000000000003', 'Guest', 'going', 'approved', 2);
  -- X5b: one under capacity once pending and maybe answers are ignored.
  v := pg_temp.o(12, 'rsvp', 'rsvp-pending-not-counted');
  UPDATE public.events SET rsvp_capacity = 3, rsvp_waitlist_enabled = false WHERE id = v;
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours', true);
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status, plus_count)
  VALUES (v, '42385555-0000-4000-8000-000000000003', 'Guest', 'going', 'approved', 1),
         (v, '42385555-0000-4000-8000-000000000004', 'Guest', 'going', 'pending', 0),
         (v, '42385555-0000-4000-8000-000000000005', 'Guest', 'maybe', 'approved', 0);

  -- X6: experience with time slots, per_start capacity of 1, one sold.
  v := pg_temp.o(13, 'experience', 'experience-slots');
  UPDATE public.events SET capacity_scope = 'per_start' WHERE id = v;
  PERFORM pg_temp.d(v, now() - interval '2 days', now() - interval '2 days' + interval '1 hour', true);
  PERFORM pg_temp.d(v, now() - interval '1 day', now() - interval '1 day' + interval '1 hour');
  PERFORM pg_temp.d(v, now() + interval '1 day', now() + interval '1 day 1 hour');
  PERFORM pg_temp.d(v, now() + interval '2 days', now() + interval '2 days 1 hour');
  v_tier := pg_temp.t(v, 1);
  PERFORM pg_temp.sell(v, v_tier, 1);
  -- X6b: every slot past.
  v := pg_temp.o(14, 'experience', 'experience-slots-past');
  UPDATE public.events SET capacity_scope = 'per_start' WHERE id = v;
  PERFORM pg_temp.d(v, now() - interval '2 days', now() - interval '2 days' + interval '1 hour', true);
  PERFORM pg_temp.d(v, now() - interval '1 hour', now());
  PERFORM pg_temp.t(v);

  -- X7: trip with three departures; the first has left.
  v := pg_temp.o(15, 'trip', 'trip-many-departures');
  PERFORM pg_temp.d(v, now() - interval '2 days', now() + interval '3 days', true);
  PERFORM pg_temp.d(v, now() + interval '20 days', now() + interval '25 days');
  PERFORM pg_temp.d(v, now() + interval '40 days', now() + interval '45 days');
  PERFORM pg_temp.t(v);
  -- X7b: same trip shape, the (trip-level) booking deadline has passed.
  v := pg_temp.o(16, 'trip', 'trip-many-deadline-past');
  PERFORM pg_temp.d(v, now() - interval '2 days', now() + interval '3 days', true);
  PERFORM pg_temp.d(v, now() + interval '20 days', now() + interval '25 days');
  PERFORM pg_temp.t(v);
  UPDATE public.events SET booking_deadline = now() - interval '1 minute' WHERE id = v;

  -- X8: unlisted series whose first date has passed; unlisted trip.
  v := pg_temp.o(17, 'event', 'unlisted-series', 'hidden');
  PERFORM pg_temp.d(v, now() - interval '7 days', now() - interval '7 days' + interval '3 hours', true);
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours');
  PERFORM pg_temp.d(v, now() + interval '14 days', now() + interval '14 days 3 hours');
  PERFORM pg_temp.t(v);
  v := pg_temp.o(18, 'trip', 'unlisted-trip-x', 'hidden');
  PERFORM pg_temp.d(v, now() + interval '10 days', now() + interval '14 days', true);
  PERFORM pg_temp.t(v);

  -- X10: keyed tier valid for date 2 only; date 3 later with no ticket for it.
  v := pg_temp.o(19, 'event', 'keyed-early-only');
  PERFORM pg_temp.d(v, now() - interval '7 days', now() - interval '7 days' + interval '3 hours', true, false, 'active', 'Africa/Lagos', 'kd1');
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours', false, false, 'active', 'Africa/Lagos', 'kd2');
  PERFORM pg_temp.d(v, now() + interval '21 days', now() + interval '21 days 3 hours', false, false, 'active', 'Africa/Lagos', 'kd3');
  PERFORM pg_temp.t(v, NULL, NULL, ARRAY['kd2']);
  -- X10b: keyed tier valid only for the past date → nothing on sale.
  v := pg_temp.o(20, 'event', 'keyed-past-only');
  PERFORM pg_temp.d(v, now() - interval '7 days', now() - interval '7 days' + interval '3 hours', true, false, 'active', 'Africa/Lagos', 'kp1');
  PERFORM pg_temp.d(v, now() + interval '7 days', now() + interval '7 days 3 hours', false, false, 'active', 'Africa/Lagos', 'kp2');
  PERFORM pg_temp.t(v, NULL, NULL, ARRAY['kp1']);
END
$fx$;

-- ── X1 ──
SELECT pg_temp.ok(pg_temp.r('event', 'all-cancelled-but-past')->>'availability' = 'ended'
  AND (pg_temp.r('event', 'all-cancelled-but-past')->>'dates_remaining')::int = 0,
  'X1 every future date cancelled (cancelled_at), only a past one left → ended, 0 dates');
SELECT pg_temp.ok(pg_temp.r('event', 'status-cancelled-but-past')->>'code' = 'destination_ended',
  'X1 future date cancelled by status only → ended');
SELECT pg_temp.ok((pg_temp.r('event', 'one-survivor')->>'ok')::boolean
  AND (pg_temp.r('event', 'one-survivor')->>'dates_remaining')::int = 1
  AND (pg_temp.r('event', 'one-survivor')->>'next_date')::timestamptz = now() + interval '14 days',
  'X1 control: the one surviving future date is next, cancelled one skipped');

-- ── X2 ──
SELECT pg_temp.ok(pg_temp.r('event', 'ends-exactly-now')->>'availability' = 'ended',
  'X2 a date ending exactly at now() is not bookable');
SELECT pg_temp.ok(pg_temp.r('trip', 'departs-exactly-now')->>'availability' = 'ended',
  'X2 a trip departing exactly at now() is not bookable');
SELECT pg_temp.ok((pg_temp.r('event', 'ends-now-plus-later')->>'ok')::boolean
  AND (pg_temp.r('event', 'ends-now-plus-later')->>'dates_remaining')::int = 1
  AND (pg_temp.r('event', 'ends-now-plus-later')->>'starts_at')::timestamptz = now() + interval '1 day',
  'X2 the date ending now is dropped; the later one is next');

-- ── X3 ──
SELECT pg_temp.ok(pg_temp.r('event', 'tz-from-master')->>'timezone' = 'Africa/Lagos',
  'X3 blank events.timezone falls back to the master date zone');
SELECT pg_temp.ok(pg_temp.r('event', 'tz-none')->>'timezone' = 'UTC',
  'X3 no zone anywhere → UTC');
SELECT pg_temp.ok(
  to_char(((pg_temp.r('event', 'tz-from-master')->>'next_date')::timestamptz) AT TIME ZONE 'Africa/Lagos', 'HH24:MI') = '00:30'
  AND to_char(((pg_temp.r('event', 'tz-from-master')->>'next_date')::timestamptz) AT TIME ZONE 'America/New_York', 'HH24:MI') IN ('18:30', '19:30'),
  'X3 a Lagos 00:30 date is an instant: 00:30 in Lagos, the evening before in New York');

-- ── X4 ──
SELECT pg_temp.ok((pg_temp.r('event', 'sold-out-plus-open')->>'ok')::boolean,
  'X4 one tier sold out, another on sale → ok');
SELECT pg_temp.ok((pg_temp.r('event', 'sold-out-plus-open')->>'last_bookable_at')::timestamptz = now() + interval '10 days',
  'X4 the sold-out tier''s later sale end never stretches last_bookable_at');
SELECT pg_temp.ok(pg_temp.r('event', 'all-tiers-sold-out')->>'availability' = 'nothing_on_sale',
  'X4 every tier sold out → nothing_on_sale');

-- ── X5 ──
SELECT pg_temp.ok(pg_temp.r('rsvp', 'rsvp-at-capacity')->>'availability' = 'nothing_on_sale'
  AND pg_temp.r('rsvp', 'rsvp-at-capacity')->>'code' = 'destination_nothing_on_sale',
  'X5 RSVP exactly at capacity (plus-ones count) → nothing_on_sale');
SELECT pg_temp.ok((pg_temp.r('rsvp', 'rsvp-pending-not-counted')->>'ok')::boolean,
  'X5 pending approvals and maybe answers do not fill an RSVP');

-- ── X6 ──
SELECT pg_temp.ok((pg_temp.r('experience', 'experience-slots')->>'ok')::boolean
  AND (pg_temp.r('experience', 'experience-slots')->>'dates_remaining')::int = 2
  AND (pg_temp.r('experience', 'experience-slots')->>'next_date')::timestamptz = now() + interval '1 day'
  AND pg_temp.r('experience', 'experience-slots')->>'canonical_url' LIKE '%/exp/issue-4238-tester/experience-slots',
  'X6 experience slots: per-slot capacity, 2 future slots, next is tomorrow, /exp/ link');
SELECT pg_temp.ok(pg_temp.r('experience', 'experience-slots-past')->>'availability' = 'ended',
  'X6 an experience whose last slot ended at now() is ended');

-- ── X7 ──
SELECT pg_temp.ok((pg_temp.r('trip', 'trip-many-departures')->>'ok')::boolean
  AND (pg_temp.r('trip', 'trip-many-departures')->>'dates_remaining')::int = 2
  AND (pg_temp.r('trip', 'trip-many-departures')->>'next_date')::timestamptz = now() + interval '20 days'
  AND (pg_temp.r('trip', 'trip-many-departures')->>'last_bookable_at')::timestamptz = now() + interval '40 days',
  'X7 a departed first departure never ends the trip; last bookable = last departure start');
SELECT pg_temp.ok(pg_temp.r('trip', 'trip-many-deadline-past')->>'availability' = 'bookings_closed',
  'X7 trip-level booking deadline passed → bookings_closed for every departure');

-- ── X9 the plan gate carries the cap ──
SELECT pg_temp.ok(
  (public.ad_plan_destination_resolve('public_mingla_page', 'event:issue-4238-tester:one-survivor', '["meta"]'::jsonb)->>'last_bookable_at')::timestamptz
    = now() + interval '14 days 3 hours'
  AND (public.ad_plan_destination_resolve('public_mingla_page', 'event:issue-4238-tester:one-survivor', '["meta"]'::jsonb)->>'ready')::boolean,
  'X9 ad_plan_destination_resolve passes last_bookable_at through to create_version');
SELECT pg_temp.ok(
  (public.ad_plan_destination_resolve('public_mingla_page', 'event:issue-4238-tester:all-cancelled-but-past', '["meta"]'::jsonb)->>'ready')::boolean = false,
  'X9 the launch gate is not ready once only a past date is left');

-- ── X10 ──
-- #4238 r6 rework (P3-2): dates_remaining counts only dates something on sale
-- covers, so the one ticketed future date (kd2) is the count, not kd2 + kd3.
SELECT pg_temp.ok((pg_temp.r('event', 'keyed-early-only')->>'ok')::boolean
  AND (pg_temp.r('event', 'keyed-early-only')->>'dates_remaining')::int = 1,
  'X10 a keyed tier valid for a future date keeps the series promotable, counting only its date');
SELECT pg_temp.ok(pg_temp.r('event', 'keyed-past-only')->>'availability' = 'nothing_on_sale',
  'X10 a keyed tier valid only for a past date → nothing_on_sale');

-- ── X8 unlisted, through the buyer page's own reader, as anon ──
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.ok(
  (public.pg_direct_event_checkout_bundle(NULL, 'issue-4238-tester', 'unlisted-series')::jsonb ->> 'eventSlug') = 'unlisted-series'
  AND (public.pg_direct_event_checkout_bundle(NULL, 'issue-4238-tester', 'unlisted-series')::jsonb ->> 'nextStartAt')::timestamptz = now() + interval '7 days'
  AND public.pg_direct_event_checkout_bundle(NULL, 'issue-4238-tester', 'private-x') IS NULL,
  'X8 an anonymous buyer opens the unlisted series link (pg_direct_event_checkout_bundle)');
SELECT pg_temp.ok(
  coalesce(public.pg_public_trip_by_slug('issue-4238-tester', 'unlisted-trip-x')::text, 'null') = 'null',
  'X8 the unlisted trip link does not open for a buyer');
RESET ROLE;

SELECT pg_temp.ok((pg_temp.r('event', 'unlisted-series')->>'ok')::boolean
  AND pg_temp.r('event', 'unlisted-series')->>'canonical_url' = public.ad_public_web_origin() || '/e/issue-4238-tester/unlisted-series'
  AND (pg_temp.r('event', 'unlisted-series')->>'dates_remaining')::int = 2,
  'X8 the ad lands on the same /e/ link the buyer opened, covering both future dates');
SELECT pg_temp.ok(pg_temp.r('trip', 'unlisted-trip-x')->>'availability' = 'unlisted',
  'X8 unlisted trip refused by the resolver');

SELECT set_config('request.jwt.claim.sub', '42385555-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"42385555-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM public.ad_advertisable_pages('unlisted-trip-x', NULL, false, '42385555-0000-4000-8000-000000000010', 0)),
  'X8 unlisted trip is not offered in the picker list');
SELECT pg_temp.ok(EXISTS (
    SELECT 1 FROM public.ad_advertisable_pages('unlisted-trip-x', NULL, true, '42385555-0000-4000-8000-000000000010', 0)
    WHERE availability = 'unlisted' AND NOT ok AND canonical_url IS NULL),
  'X8 with reasons on, the unlisted trip is greyed with availability unlisted and no link');
SELECT pg_temp.ok(EXISTS (
    SELECT 1 FROM public.ad_advertisable_pages('unlisted-series', NULL, false, '42385555-0000-4000-8000-000000000010', 0)
    WHERE ok AND dates_remaining = 2),
  'X8 the unlisted series is promotable in the picker list');
RESET ROLE;

\echo 'issue #4238 tester adversarial: all passed'
ROLLBACK;
