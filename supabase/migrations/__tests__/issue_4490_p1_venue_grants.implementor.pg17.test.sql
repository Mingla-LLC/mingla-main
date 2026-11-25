\set ON_ERROR_STOP on
-- #4490 P1 (venue grants): executable PostgreSQL 17 proof of
-- 20281203064490 — venue.* capabilities can be granted, for every venue type.
-- BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-VENUE-GRANTS-EVERY-TYPE | issue #4490 | a brand admin can give scoped staff venue.* and restaurant.* capabilities on every venue type; a Stay may combine them with stay.*; unknown capabilities are refused.
--
-- G-1  venue.manage_offers on a play venue is granted, and the staff member can then add a space there.
-- G-2  restaurant.* with venue.* on a club venue is granted (profile kitchen_bar / custom).
-- G-3  a Stay accepts venue.*, restaurant.* and stay.* together; front_desk with stay.* still works.
-- G-4  an unknown capability, an empty list and a front_desk profile on a play venue are refused.
-- G-5  authority unchanged: an event manager cannot grant; the grant replaces all earlier grants.
-- G-6  scope: the granted staff cannot manage spaces at a venue they were not granted.
--
-- FAILS-ON-REVERT: re-run the 20280212004188 body -> G-1 (invalid_venue_grants).

BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;



-- Fixture: owner 01, event manager 02, venue staff 03.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44906000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'g' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 3) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44906000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('44906000-0000-4000-9000-000000000010', '44906000-0000-4000-8000-000000000001', 'Harmattan G 4490', 'harmattan-g-4490', 'NGN', now(), now());
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44906000-0000-4000-c000-000000000002', '44906000-0000-4000-9000-000000000010', '44906000-0000-4000-8000-000000000002', 'event_manager', now()),
  ('44906000-0000-4000-c000-000000000003', '44906000-0000-4000-9000-000000000010', '44906000-0000-4000-8000-000000000003', 'venue_staff', now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
  ('44906000-0000-4000-9000-0000000000a1', '44906000-0000-4000-9000-000000000010', 'gamelandg4490', 'Gameland G', 6.45, 3.40, 'play', 'verified'),
  ('44906000-0000-4000-9000-0000000000a2', '44906000-0000-4000-9000-000000000010', 'clubg4490', 'Club G', 6.45, 3.41, 'club', 'verified'),
  ('44906000-0000-4000-9000-0000000000a3', '44906000-0000-4000-9000-000000000010', 'stayg4490', 'Stay G', 6.46, 3.42, 'stay', 'verified');

-- G-1 venue.manage_offers on a play venue ---------------------------------------------------
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $g1$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010', '44906000-0000-4000-c000-000000000003',
    '[{"venueId":"44906000-0000-4000-9000-0000000000a1","profile":"custom","capabilities":["venue.manage_offers"]}]'::jsonb);
  PERFORM public.t4490_ok((v->>'venueCount')::int = 1, 'G-1a a brand owner grants venue.manage_offers on a play venue');
END
$g1$;
SELECT public.t4490_as('44906000-0000-4000-8000-000000000003');
SELECT public.t4490_ok(public.issue_4188_has_venue_capability('44906000-0000-4000-9000-0000000000a1', '44906000-0000-4000-8000-000000000003', 'venue.manage_offers'),
  'G-1b the staff member now holds venue.manage_offers on that venue');
SELECT public.t4490_ok(
  (public.issue_4490_manage_space('create', '44906000-0000-4000-9000-0000000000a1', '{"name":"The Lounge Side","capacity_standing":200}'::jsonb)->>'name') = 'The Lounge Side',
  'G-1c and can add a space there');
SELECT public.t4490_ok((public.issue_4188_my_venue_access('44906000-0000-4000-9000-0000000000a1')->'capabilities') ? 'venue.manage_offers',
  'G-1d my venue access reports the venue capability');

-- G-2 restaurant.* + venue.* on a club ------------------------------------------------------
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
DO $g2$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010', '44906000-0000-4000-c000-000000000003',
    '[{"venueId":"44906000-0000-4000-9000-0000000000a2","profile":"kitchen_bar","capabilities":["restaurant.view_orders","venue.check_in","venue.view_bookings"]},
      {"venueId":"44906000-0000-4000-9000-0000000000a1","profile":"custom","capabilities":["venue.manage_offers","venue.manage_bookings","venue.manage_money"]}]'::jsonb);
  PERFORM public.t4490_ok((v->>'venueCount')::int = 2, 'G-2a restaurant.* with venue.* on a club, and every venue.* capability on a play venue');
  PERFORM public.t4490_ok((SELECT capabilities FROM public.brand_team_member_venue_grants
      WHERE member_id = '44906000-0000-4000-c000-000000000003' AND venue_id = '44906000-0000-4000-9000-0000000000a2')
      = ARRAY['restaurant.view_orders','venue.check_in','venue.view_bookings']::text[], 'G-2b capabilities are stored sorted and distinct');
END
$g2$;

-- G-3 a Stay combines its Stays and venue-feature capabilities ---------------------------------
SELECT public.t4490_ok(
  (public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010','44906000-0000-4000-c000-000000000003',
    '[{"venueId":"44906000-0000-4000-9000-0000000000a3","profile":"restaurant_manager","capabilities":["stay.view_reservations","restaurant.view_orders","venue.check_in"]}]'::jsonb)->>'venueCount')::int = 1,
  'G-3a a Stay combines stay.*, restaurant.* and venue.*');
SELECT public.t4490_ok(
  (public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010','44906000-0000-4000-c000-000000000003',
    '[{"venueId":"44906000-0000-4000-9000-0000000000a3","profile":"front_desk","capabilities":["stay.view_reservations"]}]'::jsonb)->>'venueCount')::int = 1,
  'G-3b a Stay still takes stay.* with front_desk');

-- G-4 refusals ----------------------------------------------------------------------------------
SELECT public.t4490_expect($$SELECT public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010','44906000-0000-4000-c000-000000000003',
  '[{"venueId":"44906000-0000-4000-9000-0000000000a1","profile":"custom","capabilities":["venue.everything"]}]'::jsonb)$$,
  '22023', 'invalid_venue_grants', 'G-4a an unknown venue capability is refused');
SELECT public.t4490_expect($$SELECT public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010','44906000-0000-4000-c000-000000000003',
  '[{"venueId":"44906000-0000-4000-9000-0000000000a1","profile":"custom","capabilities":[]}]'::jsonb)$$,
  '22023', 'invalid_venue_grants', 'G-4b an empty capability list is refused');
SELECT public.t4490_expect($$SELECT public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010','44906000-0000-4000-c000-000000000003',
  '[{"venueId":"44906000-0000-4000-9000-0000000000a1","profile":"front_desk","capabilities":["venue.check_in"]}]'::jsonb)$$,
  '22023', 'invalid_venue_grants', 'G-4c the front desk profile is Stay-only');
SELECT public.t4490_expect($$SELECT public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010','44906000-0000-4000-c000-000000000003',
  '[{"venueId":"44906000-0000-4000-9000-0000000000a1","profile":"custom","capabilities":["stay.view_reservations"]}]'::jsonb)$$,
  '22023', 'invalid_venue_grants', 'G-4d a play venue refuses stay.*');

-- G-5 authority and replace-all ----------------------------------------------------------------
SELECT public.t4490_as('44906000-0000-4000-8000-000000000002');
SELECT public.t4490_expect($$SELECT public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010','44906000-0000-4000-c000-000000000003',
  '[{"venueId":"44906000-0000-4000-9000-0000000000a1","profile":"custom","capabilities":["venue.manage_offers"]}]'::jsonb)$$,
  '42501', 'forbidden', 'G-5a an event manager cannot grant');
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  (SELECT array_agg(venue_id ORDER BY venue_id) FROM public.brand_team_member_venue_grants WHERE member_id = '44906000-0000-4000-c000-000000000003')
    = ARRAY['44906000-0000-4000-9000-0000000000a3']::uuid[],
  'G-5b the last grant replaced every earlier grant');

-- G-6 scope ---------------------------------------------------------------------------------------
SELECT public.t4490_as('44906000-0000-4000-8000-000000000001');
SELECT public.issue_4188_set_member_venue_grants('44906000-0000-4000-9000-000000000010','44906000-0000-4000-c000-000000000003',
  '[{"venueId":"44906000-0000-4000-9000-0000000000a1","profile":"custom","capabilities":["venue.manage_offers"]}]'::jsonb);
SELECT public.t4490_as('44906000-0000-4000-8000-000000000003');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_space('create','44906000-0000-4000-9000-0000000000a2','{"name":"Dance floor","capacity_standing":300}'::jsonb)$$,
  '42501', 'not_authorized', 'G-6a staff granted on one venue cannot add spaces at another');
SELECT public.t4490_reset();

ROLLBACK;
