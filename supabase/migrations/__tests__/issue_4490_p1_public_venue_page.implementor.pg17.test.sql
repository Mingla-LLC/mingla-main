\set ON_ERROR_STOP on
-- #4490 P1-5: executable PostgreSQL 17 proof of the feature-driven public
-- venue page (20281203044490). BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-PUBLIC-PAGE-FEATURES-NOT-CATEGORY | issue #4490 | the public venue page lists only features that are on, have every dependency met and have shipped; venue_category never adds a way in (a play venue with tables but table reservations off offers no table booking).
--
-- P-1  grants: the public read is anon + authenticated; the payload builder is service-only; preview and admin reads are signed-in only.
-- P-2  the venue_public_view gate: unverified, deleted-brand and unknown venues answer NULL.
-- P-3  shape: venue (= the venue_public_view row), currency, features, spaces, hours, events, tables, offers []; no ways_to_come, no booking_bar.
-- P-4  Gameland-like: a play venue with tables but table reservations off has no table way in; a restaurant with reservations on does (partyMax).
-- P-5  features: unbuilt features and features with an unmet dependency are left out.
-- P-6  spaces: active only, in order; planShape only when set; photo URLs.
-- P-7  events: next six public, future events at the venue while events_here is on; none when it is off.
-- P-8  hours: weekly = every window; specialDays.
-- P-9  Host preview: brand members see a pending venue; outsiders and anon cannot.
-- P-10 admin read: Mingla admins only.
--
-- FAILS-ON-REVERT: drop the built filter in issue_4490_public_features -> P-5a; read venue_category
-- for tables -> P-4a; drop the claim gate -> P-2a.

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


-- Fixture: owner 01, outsider 02, admin 03.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44904000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 3) n;
INSERT INTO public.admin_users (email, role, status) VALUES ('p3-4490@example.test', 'admin', 'active');
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44904000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('44904000-0000-4000-9000-000000000010', '44904000-0000-4000-8000-000000000001', 'Gameland P 4490', 'gameland-p-4490', 'NGN', now(), now()),
  ('44904000-0000-4000-9000-000000000020', '44904000-0000-4000-8000-000000000001', 'Gone P 4490', 'gone-p-4490', 'NGN', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
  ('44904000-0000-4000-9000-0000000000a1', '44904000-0000-4000-9000-000000000010', 'gameland', 'Gameland Lagos', 6.45, 3.40, 'play', 'verified'),
  ('44904000-0000-4000-9000-0000000000a2', '44904000-0000-4000-9000-000000000010', 'gogi', 'Gogi', 6.45, 3.41, 'restaurant', 'verified'),
  ('44904000-0000-4000-9000-0000000000a3', '44904000-0000-4000-9000-000000000010', 'pending', 'Pending Place', 6.45, 3.42, 'play', 'pending_review'),
  ('44904000-0000-4000-9000-0000000000a4', '44904000-0000-4000-9000-000000000020', 'gone', 'Gone Place', 6.45, 3.43, 'play', 'verified');
UPDATE public.brands SET deleted_at = now() WHERE id = '44904000-0000-4000-9000-000000000020';
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled) VALUES
  ('44904000-0000-4000-9000-000000000010', '44904000-0000-4000-9000-0000000000a1', false),
  ('44904000-0000-4000-9000-000000000010', '44904000-0000-4000-9000-0000000000a2', true);
INSERT INTO public.venue_tables (brand_id, venue_id, name, capacity) VALUES
  ('44904000-0000-4000-9000-000000000010', '44904000-0000-4000-9000-0000000000a1', 'Lounge 1', 8),
  ('44904000-0000-4000-9000-000000000010', '44904000-0000-4000-9000-0000000000a2', 'T1', 4),
  ('44904000-0000-4000-9000-000000000010', '44904000-0000-4000-9000-0000000000a2', 'T2', 10);
INSERT INTO public.venue_spaces (id, venue_id, brand_id, name, setting, capacity_standing, capacity_seated, photos, plan_shape, sort_order) VALUES
  ('44904000-0000-4000-a000-0000000000a1', '44904000-0000-4000-9000-0000000000a1', '44904000-0000-4000-9000-000000000010', 'The Lawn', 'outdoor', 400, NULL,
   '[{"url":"https://img.example.test/lawn.jpg","alt":"Lawn"}]'::jsonb, '{"x":0,"y":0,"w":500,"h":300}'::jsonb, 1),
  ('44904000-0000-4000-a000-0000000000a2', '44904000-0000-4000-9000-0000000000a1', '44904000-0000-4000-9000-000000000010', 'Arcade', 'indoor', 120, 40,
   '[]'::jsonb, NULL, 0);
INSERT INTO public.venue_spaces (venue_id, brand_id, name, capacity_standing, is_active, archived_at) VALUES
  ('44904000-0000-4000-9000-0000000000a1', '44904000-0000-4000-9000-000000000010', 'Old Shed', 10, false, now());

-- [TEST-MOD-APPROVED #4490] W2 fix 1: guest list shipped too (20281203394490), so
-- every feature is built and none is left to be P-5a's unbuilt example. The
-- filter is still proven: for this transaction the built list is every feature
-- except guest list (a stand-in for a phase that has not shipped). It is set
-- here, before the first page read, because PostgreSQL keeps a SQL function's
-- plan (with this IMMUTABLE list folded in) for the rest of the transaction.
-- No other assertion reads guest list. Same assertions.
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT array_remove(public.issue_4490_feature_keys(), 'guest_list'); $f$;

-- P-1 grants -------------------------------------------------------------------------
SELECT public.t4490_ok(
  has_function_privilege('anon', 'public.pg_public_venue_page(text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.pg_public_venue_page(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_venue_page_payload(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_venue_page_payload(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.biz_preview_venue_page(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_venue_features(uuid)', 'EXECUTE')
  AND (SELECT bool_and(p.prosecdef AND 'search_path=""' = ANY(p.proconfig)) FROM pg_proc p
       WHERE p.proname IN ('pg_public_venue_page', 'biz_preview_venue_page', 'admin_venue_features', 'issue_4490_venue_page_payload')),
  'P-1 the public read is anon + authenticated; everything else is signed-in or service only');

-- P-2 gate ---------------------------------------------------------------------------
SELECT public.t4490_as(NULL);
SELECT public.t4490_ok(
  public.pg_public_venue_page('gameland-p-4490', 'pending') IS NULL
  AND public.pg_public_venue_page('gone-p-4490', 'gone') IS NULL
  AND public.pg_public_venue_page('gameland-p-4490', 'nope') IS NULL
  AND public.pg_public_venue_page('gameland-p-4490', 'gameland') IS NOT NULL,
  'P-2 unverified, deleted-brand and unknown venues answer NULL to anon; a verified venue answers');

-- P-3 shape ---------------------------------------------------------------------------
SELECT public.t4490_ok(
  (SELECT p ?& ARRAY['version', 'venue', 'currencyCode', 'minorUnitExponent', 'vat', 'features', 'spaces', 'hours', 'events', 'tables', 'offers']
     AND NOT (p ? 'ways_to_come') AND NOT (p ? 'booking_bar')
     AND p->>'currencyCode' = 'NGN' AND (p->>'minorUnitExponent')::int = 2
     AND p->'offers' = '[]'::jsonb AND p->'vat' = 'null'::jsonb
   FROM (SELECT public.pg_public_venue_page('gameland-p-4490', 'gameland') AS p) x),
  'P-3a the payload carries the C contract keys, offers empty, no ways_to_come or booking_bar');
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  (SELECT public.pg_public_venue_page('gameland-p-4490', 'gameland')->'venue')
  = (SELECT to_jsonb(v) FROM public.venue_public_view v WHERE v.id = '44904000-0000-4000-9000-0000000000a1'),
  'P-3b the venue object equals the venue_public_view row column for column');

-- P-4 Gameland-like ----------------------------------------------------------------------
SELECT public.t4490_ok(
  (SELECT NOT (p->'features' ? 'table_reservations') AND p->'tables' = 'null'::jsonb
   FROM (SELECT public.pg_public_venue_page('gameland-p-4490', 'gameland') AS p) x),
  'P-4a a play venue with tables but table reservations off offers no table way in');
SELECT public.t4490_ok(
  (SELECT p->'features' ? 'table_reservations' AND (p->'tables'->>'partyMax')::int = 10
     -- [TEST-MOD-APPROVED #4490] P5 fills pickATable (false while "Pick a table" is off).
     AND p->'tables'->'pickATable' = 'false'::jsonb
   FROM (SELECT public.pg_public_venue_page('gameland-p-4490', 'gogi') AS p) x),
  'P-4b a restaurant with reservations on offers tables, party max = its largest table');

-- P-5 features filter -------------------------------------------------------------------
-- [TEST-MOD-APPROVED #4490] P2-P6 shipped entry, group packages, private hire, by the hour and memberships; the unbuilt example is now guest list.
-- [TEST-MOD-APPROVED #4490] W2 fix 1: the built list is the stand-in set before
-- P-1 (guest list left out), see there.
INSERT INTO public.venue_features (venue_id, brand_id, feature_key, enabled) VALUES
  ('44904000-0000-4000-9000-0000000000a1', '44904000-0000-4000-9000-000000000010', 'guest_list', true),
  ('44904000-0000-4000-9000-0000000000a1', '44904000-0000-4000-9000-000000000010', 'events_here', true),
  ('44904000-0000-4000-9000-0000000000a2', '44904000-0000-4000-9000-000000000010', 'menu', false),
  ('44904000-0000-4000-9000-0000000000a2', '44904000-0000-4000-9000-000000000010', 'table_ordering', true);
SELECT public.t4490_ok(
  (SELECT p->'features' = '["menu","events_here"]'::jsonb FROM (SELECT public.pg_public_venue_page('gameland-p-4490', 'gameland') AS p) x)
  AND (SELECT NOT (p->'features' ? 'table_ordering') AND NOT (p->'features' ? 'menu')
       FROM (SELECT public.pg_public_venue_page('gameland-p-4490', 'gogi') AS p) x),
  'P-5a an unbuilt feature (guest list) and a feature whose parent is off (ordering without menu) are left out');

-- P-6 spaces ----------------------------------------------------------------------------
SELECT public.t4490_ok(
  (SELECT p->'spaces' = '[{"id":"44904000-0000-4000-a000-0000000000a2","name":"Arcade","setting":"indoor","capacitySeated":40,"capacityStanding":120,"photoUrls":[]},{"id":"44904000-0000-4000-a000-0000000000a1","name":"The Lawn","setting":"outdoor","planShape":{"h":300,"w":500,"x":0,"y":0},"photoUrls":["https://img.example.test/lawn.jpg"],"capacityStanding":400}]'::jsonb
   FROM (SELECT public.pg_public_venue_page('gameland-p-4490', 'gameland') AS p) x),
  'P-6 active spaces in order; planShape only when set; photo URLs; archived spaces left out');

-- P-7 events ----------------------------------------------------------------------------
DO $p7$
DECLARE
  v_ev uuid;
  i int;
  p jsonb;
BEGIN
  FOR i IN 1..7 LOOP
    INSERT INTO public.events (brand_id, title, slug, event_type, visibility, status, timezone, currency, venue_id, space_id)
    VALUES ('44904000-0000-4000-9000-000000000010', 'Night ' || i, 'night-' || i || '-4490',
            CASE WHEN i = 2 THEN 'experience' ELSE 'event' END, 'public', 'scheduled', 'Africa/Lagos', 'NGN',
            '44904000-0000-4000-9000-0000000000a1', CASE WHEN i = 1 THEN '44904000-0000-4000-a000-0000000000a1'::uuid END)
    RETURNING id INTO v_ev;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_ev, now() + make_interval(days => i), now() + make_interval(days => i, hours => 3), 'Africa/Lagos', true);
  END LOOP;
  INSERT INTO public.events (brand_id, title, slug, event_type, visibility, status, timezone, currency, venue_id)
  VALUES ('44904000-0000-4000-9000-000000000010', 'Secret', 'secret-4490', 'event', 'private', 'scheduled', 'Africa/Lagos', 'NGN',
          '44904000-0000-4000-9000-0000000000a1') RETURNING id INTO v_ev;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_ev, now() + interval '12 hours', now() + interval '15 hours', 'Africa/Lagos', true);
  INSERT INTO public.events (brand_id, title, slug, event_type, visibility, status, timezone, currency, venue_id)
  VALUES ('44904000-0000-4000-9000-000000000010', 'Past', 'past-4490', 'event', 'public', 'scheduled', 'Africa/Lagos', 'NGN',
          '44904000-0000-4000-9000-0000000000a1') RETURNING id INTO v_ev;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_ev, now() - interval '2 days', now() - interval '2 days' + interval '3 hours', 'Africa/Lagos', true);

  p := public.pg_public_venue_page('gameland-p-4490', 'gameland');
  PERFORM public.t4490_ok(jsonb_array_length(p->'events'->'upcoming') = 6
      AND p->'events'->'upcoming'->0->>'title' = 'Night 1'
      AND p->'events'->'upcoming'->0->>'spaceName' = 'The Lawn'
      AND p->'events'->'upcoming'->0->>'href' = '/e/gameland-p-4490/night-1-4490'
      AND p->'events'->'upcoming'->1->>'kind' = 'experience'
      AND p->'events'->'upcoming'->1->>'href' = '/exp/gameland-p-4490/night-2-4490'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'events'->'upcoming') e WHERE e->>'title' IN ('Secret', 'Past', 'Night 7')),
    'P-7a the next six public future events at the venue, soonest first (private, past and the seventh left out)');
  UPDATE public.venue_features SET enabled = false WHERE venue_id = '44904000-0000-4000-9000-0000000000a1' AND feature_key = 'events_here';
  p := public.pg_public_venue_page('gameland-p-4490', 'gameland');
  PERFORM public.t4490_ok(p->'events'->'upcoming' = '[]'::jsonb, 'P-7b with events_here off the page lists no events');
END
$p7$;

-- P-8 hours ------------------------------------------------------------------------------
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal) VALUES
  ('44904000-0000-4000-9000-000000000010', '44904000-0000-4000-9000-0000000000a1', 0, '11:00', '15:00', false, 0),
  ('44904000-0000-4000-9000-000000000010', '44904000-0000-4000-9000-0000000000a1', 0, '17:00', '23:00', false, 1);
INSERT INTO public.venue_special_hours (venue_id, brand_id, local_date, is_closed, label) VALUES
  ('44904000-0000-4000-9000-0000000000a1', '44904000-0000-4000-9000-000000000010', (now() AT TIME ZONE 'UTC')::date + 3, true, 'Private event');
SELECT public.t4490_ok(
  (SELECT jsonb_array_length(p->'hours'->'weekly') = 2 AND p->'hours'->'weekly'->1->>'open_time' = '17:00'
     AND p->'hours'->'specialDays'->0->>'label' = 'Private event'
     AND jsonb_array_length(p->'venue'->'hours') = 1
   FROM (SELECT public.pg_public_venue_page('gameland-p-4490', 'gameland') AS p) x),
  'P-8 hours.weekly carries every window, specialDays the closed date; venue.hours stays one row per weekday');

-- P-9 preview -----------------------------------------------------------------------------
SELECT public.t4490_as('44904000-0000-4000-8000-000000000001');
SELECT public.t4490_ok(
  (SELECT (p->>'preview')::boolean AND p->'venue'->>'name' = 'Pending Place'
   FROM (SELECT public.biz_preview_venue_page('44904000-0000-4000-9000-0000000000a3') AS p) x),
  'P-9a a brand member previews a venue still in review');
SELECT public.t4490_as('44904000-0000-4000-8000-000000000002');
SELECT public.t4490_expect($$SELECT public.biz_preview_venue_page('44904000-0000-4000-9000-0000000000a3')$$,
  '42501', 'not_authorized', 'P-9b an outsider cannot preview');
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect($$SELECT public.biz_preview_venue_page('44904000-0000-4000-9000-0000000000a3')$$,
  '42501', NULL, 'P-9c anon cannot preview');

-- P-10 admin ------------------------------------------------------------------------------
SELECT public.t4490_as('44904000-0000-4000-8000-000000000003');
SELECT public.t4490_ok(
  (SELECT p->>'venue_id' = '44904000-0000-4000-9000-0000000000a3' AND p->'page'->'venue'->>'name' = 'Pending Place'
   FROM (SELECT public.admin_venue_features('44904000-0000-4000-9000-0000000000a3') AS p) x),
  'P-10a a Mingla admin reads features and the page of any venue');
SELECT public.t4490_as('44904000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$SELECT public.admin_venue_features('44904000-0000-4000-9000-0000000000a3')$$,
  '42501', 'not_authorized', 'P-10b a brand owner is not a Mingla admin');
SELECT public.t4490_reset();

ROLLBACK;
