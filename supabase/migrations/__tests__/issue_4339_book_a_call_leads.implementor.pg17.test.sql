\set ON_ERROR_STOP on
-- #4339 round A: every confirmed Book a call booking is an Inbound lead.
-- Executable PostgreSQL 17 proof, after the full migration replay.
--
-- T-01  book_call_leads: RLS on; anon and signed-in can neither read nor write
--       it; the service role can insert and read.
-- T-02  booking_key is unique: a second write of the same booking is a no-op
--       through ON CONFLICT DO NOTHING (what PostgREST's on_conflict sends).
-- T-03  the checks: an unknown ICP, a non-https social link or a bad email is
--       refused.
-- C-01  admin_inbound_leads and admin_book_call_lead_get: SECURITY DEFINER,
--       anon cannot run them, signed-in may call them.
-- I-01  as an admin: the booking is listed ONCE as source book_a_call, with
--       the business (the venue, else the name), its ICP, social link,
--       website, call time and source; it is counted; no email address is
--       returned; a booking with no venue shows the booker's name.
-- I-02  a growth teammate (beta_leads area) sees bookings; an outsider is
--       refused both RPCs.
-- I-03  admin_book_call_lead_get returns the email and social for Add to
--       Hosts; null for an unknown id.
-- I-04  a staff/test booking is hidden unless asked for.
-- I-05  the #4130 rows are unchanged: beta and web tool leads still listed.
-- #4339 Creators and Locals calls:
-- T-04  each audience's own fields: an unknown audience, a Host call with no
--       ICP, a Creator call with no city / no or an unknown `makes` / an ICP,
--       and a Local call with no city are refused.
-- C-02  admin_calendar_calls: SECURITY DEFINER, anon cannot run it, signed-in
--       may call it.
-- I-06  Inbound leads exposes the audience, the city and the program fields;
--       a Creator or Local call is never matched to a host card.
-- I-07  the Calendar calls layer: every audience's call in the range, with
--       its audience, name, call_at, city, ICP or makes, social, Meet link,
--       lead id and status; nothing outside the range; staff/test hidden
--       unless asked; no email address; an outsider and a bad range refused.
--
-- FAILS-ON-REVERT: dropping the `UNION ALL ... FROM public.book_call_leads`
-- branch from admin_inbound_leads fails I-01; dropping the booking_key UNIQUE
-- constraint fails T-02; dropping book_call_leads_audience_fields_check fails
-- T-04; dropping the 'audience' key from the booking json fails I-06;
-- dropping admin_calendar_calls fails C-02 and I-07.
-- MINGLA-INVARIANT: I-4339-BOOK-A-CALL-IS-AN-INBOUND-LEAD | issue #4339 | proved by T-01..T-03, I-01..I-05 here.

CREATE OR REPLACE FUNCTION pg_temp.bc_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4339 book a call FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.bc_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;

-- ═══ T-01 / C-01: the table and the grants ═══════════════════════════════════
BEGIN;
DO $t01$
DECLARE
  v_fn text;
BEGIN
  PERFORM pg_temp.bc_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.book_call_leads'::regclass), 'T-01 RLS is on');
  PERFORM pg_temp.bc_assert((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'book_call_leads') = 0, 'T-01 no policies');
  PERFORM pg_temp.bc_assert(NOT has_table_privilege('anon', 'public.book_call_leads', 'SELECT')
                        AND NOT has_table_privilege('anon', 'public.book_call_leads', 'INSERT'), 'T-01 anon cannot read or write');
  PERFORM pg_temp.bc_assert(NOT has_table_privilege('authenticated', 'public.book_call_leads', 'SELECT')
                        AND NOT has_table_privilege('authenticated', 'public.book_call_leads', 'INSERT')
                        AND NOT has_table_privilege('authenticated', 'public.book_call_leads', 'UPDATE')
                        AND NOT has_table_privilege('authenticated', 'public.book_call_leads', 'DELETE'), 'T-01 signed-in cannot read or write');
  PERFORM pg_temp.bc_assert(has_table_privilege('service_role', 'public.book_call_leads', 'INSERT')
                        AND has_table_privilege('service_role', 'public.book_call_leads', 'SELECT'), 'T-01 the service role inserts and reads');
  FOREACH v_fn IN ARRAY ARRAY['public.admin_inbound_leads(boolean,integer)', 'public.admin_book_call_lead_get(uuid)', 'public.admin_calendar_calls(timestamptz,timestamptz,boolean)'] LOOP
    PERFORM pg_temp.bc_assert(to_regprocedure(v_fn) IS NOT NULL, 'C-01 exists ' || v_fn);
    PERFORM pg_temp.bc_assert((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn::regprocedure), 'C-01 definer ' || v_fn);
    PERFORM pg_temp.bc_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'C-01 anon cannot run ' || v_fn);
    PERFORM pg_temp.bc_assert(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'C-01 signed-in may call ' || v_fn);
  END LOOP;
END
$t01$;
ROLLBACK;

-- The client roles really are refused (not only by the catalog).
BEGIN;
SET LOCAL ROLE anon;
DO $t01b$
DECLARE v_err text := 'none';
BEGIN
  BEGIN
    PERFORM 1 FROM public.book_call_leads;
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'denied';
  END;
  IF v_err <> 'denied' THEN RAISE EXCEPTION 'issue #4339 book a call FAIL: T-01 anon read the table'; END IF;
  RAISE NOTICE 'PASS  T-01 anon read is denied';
END
$t01b$;
RESET ROLE;
ROLLBACK;

-- ═══ T-02 / T-03 / I-01..I-05 ═══════════════════════════════════════════════════
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $main$
DECLARE
  v_admin    constant uuid := '43390000-0000-4000-b000-000000000001';
  v_outsider constant uuid := '43390000-0000-4000-b000-000000000002';
  v_growth   constant uuid := '43390000-0000-4000-b000-000000000003';
  v_beta     constant uuid := '43390000-0000-4000-b000-000000000400';
  v_tool     constant uuid := '43390000-0000-4000-b000-000000000402';
  v_book     uuid;
  v_book_nv  uuid;
  v_book_t   uuid;
  v_call     constant timestamptz := date_trunc('minute', now()) + interval '3 days';
  v jsonb; v_rows jsonb; v_row jsonb; v_err text; v_n bigint;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
    (v_admin,    'bc4339-admin@mingla-fixture.org', now()),
    (v_outsider, 'bc4339-outsider@mingla-fixture.org', now()),
    (v_growth,   'bc4339-growth@mingla-fixture.org', now());
  INSERT INTO public.admin_users(email, role, status) VALUES ('bc4339-admin@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.admin_team_members(email, role, status) VALUES ('bc4339-growth@mingla-fixture.org', 'growth', 'active');

  -- The #4130 rows, so I-05 can see the union kept them.
  INSERT INTO public.beta_access_leads (id, created_at, brand_type, brand_name, contact_name, city, email, source)
  VALUES (v_beta, now() - interval '3 days', ARRAY['restaurant'], 'Bc4339 Beta Bistro', 'Ada', 'Lagos', 'bc4339-beta@mingla-fixture.org', 'organiser_marketing');
  INSERT INTO public.tool_leads (id, tool, input, email, lane)
  VALUES (v_tool, 'venues', jsonb_build_object('name', 'Bc4339 Tool Cafe', 'city', 'Durham'), 'bc4339-tool@mingla-fixture.org', 'web');

  -- ── T-02: what growth-tools-book writes, twice (a retried write) ──────────
  SET LOCAL ROLE service_role;
  INSERT INTO public.book_call_leads (booking_key, calendar_event_id, name, email, venue, icp, social_platform, social_handle, social_url, website, call_at, source)
  VALUES ('gcal:bc4339evt1', 'bc4339evt1', 'Ada Lovelace', 'ada@bc4339-bluenote.org', 'Bc4339 Blue Note', 'restaurants', 'instagram', '@bluenote',
          'https://instagram.com/bluenote', 'https://bluenote.example', v_call, 'venue_grader')
  ON CONFLICT (booking_key) DO NOTHING;
  INSERT INTO public.book_call_leads (booking_key, calendar_event_id, name, email, venue, icp, social_platform, social_handle, social_url, website, call_at, source)
  VALUES ('gcal:bc4339evt1', 'bc4339evt1', 'Ada Lovelace', 'ada@bc4339-bluenote.org', 'Bc4339 Blue Note', 'restaurants', 'instagram', '@bluenote',
          'https://instagram.com/bluenote', 'https://bluenote.example', v_call, 'venue_grader')
  ON CONFLICT (booking_key) DO NOTHING;
  -- No venue: the business is the booker's name.
  INSERT INTO public.book_call_leads (booking_key, name, email, icp, social_platform, social_handle, social_url, call_at)
  VALUES ('gcal:bc4339evt2', 'Grace Hopper', 'grace@bc4339-trips.org', 'trips', 'tiktok', '@gracetrips', 'https://tiktok.com/@gracetrips', v_call + interval '1 hour');
  -- A staff booking (a usemingla.com address) is a test row.
  INSERT INTO public.book_call_leads (booking_key, name, email, venue, icp, social_platform, social_url, call_at)
  VALUES ('gcal:bc4339evt3', 'Staff Person', 'bc4339-staff@usemingla.com', 'Bc4339 Staff Venue', 'play', 'x', 'https://x.com/staff', v_call);
  SELECT count(*) INTO v_n FROM public.book_call_leads WHERE booking_key = 'gcal:bc4339evt1';
  RESET ROLE;
  PERFORM pg_temp.bc_assert(v_n = 1, 'T-02 a retried write of one booking adds nothing');
  SELECT id INTO v_book FROM public.book_call_leads WHERE booking_key = 'gcal:bc4339evt1';
  SELECT id INTO v_book_nv FROM public.book_call_leads WHERE booking_key = 'gcal:bc4339evt2';
  SELECT id INTO v_book_t FROM public.book_call_leads WHERE booking_key = 'gcal:bc4339evt3';

  -- ── T-03: the checks ──────────────────────────────────────────────────────
  BEGIN
    INSERT INTO public.book_call_leads (booking_key, name, email, icp, social_platform, social_url, call_at)
    VALUES ('gcal:bc4339bad1', 'Bad Icp', 'bad@bc4339.org', 'nightclub', 'instagram', 'https://instagram.com/x', v_call);
    v_err := 'none';
  EXCEPTION WHEN check_violation THEN v_err := 'refused';
  END;
  PERFORM pg_temp.bc_assert(v_err = 'refused', 'T-03 an unknown ICP is refused');
  BEGIN
    INSERT INTO public.book_call_leads (booking_key, name, email, icp, social_platform, social_url, call_at)
    VALUES ('gcal:bc4339bad2', 'Bad Link', 'bad@bc4339.org', 'art', 'instagram', 'javascript:alert(1)', v_call);
    v_err := 'none';
  EXCEPTION WHEN check_violation THEN v_err := 'refused';
  END;
  PERFORM pg_temp.bc_assert(v_err = 'refused', 'T-03 a social link that is not https is refused');
  BEGIN
    INSERT INTO public.book_call_leads (booking_key, name, email, icp, social_platform, social_url, call_at)
    VALUES ('gcal:bc4339bad3', 'Bad Email', 'not an email', 'art', 'instagram', 'https://instagram.com/x', v_call);
    v_err := 'none';
  EXCEPTION WHEN check_violation THEN v_err := 'refused';
  END;
  PERFORM pg_temp.bc_assert(v_err = 'refused', 'T-03 a bad email is refused');

  -- ── I-01: as an admin ─────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_admin);
  v := public.admin_inbound_leads(false, 500);
  RESET ROLE;
  v_rows := v -> 'rows';
  PERFORM pg_temp.bc_assert((SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_book::text) = 1,
    'I-01 the booking is listed once');
  SELECT r INTO v_row FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_book::text;
  PERFORM pg_temp.bc_assert(v_row ->> 'source' = 'book_a_call', 'I-01 its source is book_a_call');
  PERFORM pg_temp.bc_assert(v_row ->> 'business' = 'Bc4339 Blue Note', 'I-01 the business is the venue');
  PERFORM pg_temp.bc_assert(v_row #>> '{booking,icp}' = 'restaurants', 'I-01 the ICP');
  PERFORM pg_temp.bc_assert(v_row #>> '{booking,social_url}' = 'https://instagram.com/bluenote'
                        AND v_row #>> '{booking,social_platform}' = 'instagram', 'I-01 the social as its profile link');
  PERFORM pg_temp.bc_assert(v_row #>> '{booking,website}' = 'https://bluenote.example', 'I-01 the website');
  PERFORM pg_temp.bc_assert((v_row #>> '{booking,call_at}')::timestamptz = v_call, 'I-01 the call time');
  PERFORM pg_temp.bc_assert(v_row #>> '{booking,source}' = 'venue_grader', 'I-01 the source');
  PERFORM pg_temp.bc_assert((v_row ->> 'has_email')::boolean, 'I-01 a booking always has an email');
  PERFORM pg_temp.bc_assert((SELECT r ->> 'business' FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_book_nv::text) = 'Grace Hopper',
    'I-01 with no venue, the business is the booker''s name');
  PERFORM pg_temp.bc_assert(position('@bc4339' IN v_rows::text) = 0 AND position('ada@' IN v_rows::text) = 0,
    'I-01 no email address is returned');
  PERFORM pg_temp.bc_assert((v #>> '{summary,book_a_call}')::int >= 2, 'I-01 bookings are counted');
  PERFORM pg_temp.bc_assert((v #>> '{can_see,book_a_call}')::boolean, 'I-01 the admin may see bookings');
  -- ── I-04 the staff booking ────────────────────────────────────────────────
  PERFORM pg_temp.bc_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_book_t::text),
    'I-04 a staff booking is hidden by default');
  -- ── I-05 the #4130 kinds are still there ──────────────────────────────────
  PERFORM pg_temp.bc_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_beta::text AND r ->> 'source' = 'beta'),
    'I-05 the beta lead is still listed');
  PERFORM pg_temp.bc_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_tool::text AND r ->> 'source' = 'tool'),
    'I-05 the web tool lead is still listed');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_admin);
  v := public.admin_inbound_leads(true, 500);
  RESET ROLE;
  PERFORM pg_temp.bc_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'rows') r WHERE r ->> 'id' = v_book_t::text AND (r ->> 'is_test')::boolean),
    'I-04 the staff booking shows when asked for, marked as test');

  -- ── I-03 Add to Hosts reads the contact details ───────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_admin);
  v := public.admin_book_call_lead_get(v_book);
  RESET ROLE;
  PERFORM pg_temp.bc_assert(v ->> 'email' = 'ada@bc4339-bluenote.org' AND v ->> 'social_url' = 'https://instagram.com/bluenote'
                        AND v ->> 'name' = 'Ada Lovelace', 'I-03 the email and social for Add to Hosts');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_admin);
  v := public.admin_book_call_lead_get(gen_random_uuid());
  RESET ROLE;
  PERFORM pg_temp.bc_assert(v IS NULL, 'I-03 an unknown booking is null');

  -- ── I-02 growth and outsider ──────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_growth);
  v := public.admin_inbound_leads(false, 500);
  RESET ROLE;
  PERFORM pg_temp.bc_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'rows') r WHERE r ->> 'id' = v_book::text),
    'I-02 a growth teammate sees bookings');
  PERFORM pg_temp.bc_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'rows') r WHERE r ->> 'source' = 'tool'),
    'I-02 still no web tool lead for a growth teammate');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_outsider);
  BEGIN
    PERFORM public.admin_inbound_leads(false, 500);
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.bc_assert(v_err = 'not_authorized', 'I-02 an outsider is refused inbound leads');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_outsider);
  BEGIN
    PERFORM public.admin_book_call_lead_get(v_book);
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.bc_assert(v_err = 'not_authorized', 'I-02 an outsider is refused a booking''s contact details');
END
$main$;
ROLLBACK;

-- ═══ T-04 / I-06 / I-07: Creators and Locals calls, and the Calendar layer ═══
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $calls$
DECLARE
  v_admin    constant uuid := '43390000-0000-4000-b000-000000000011';
  v_outsider constant uuid := '43390000-0000-4000-b000-000000000012';
  v_growth   constant uuid := '43390000-0000-4000-b000-000000000013';
  v_from     constant timestamptz := '2031-03-01 00:00:00+00';
  v_to       constant timestamptz := '2031-04-01 00:00:00+00';
  v_host uuid; v_creator uuid; v_local uuid; v_staff uuid; v_late uuid;
  v jsonb; v_rows jsonb; v_row jsonb; v_err text; v_case record;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
    (v_admin,    'cl4339-admin@mingla-fixture.org', now()),
    (v_outsider, 'cl4339-outsider@mingla-fixture.org', now()),
    (v_growth,   'cl4339-growth@mingla-fixture.org', now());
  INSERT INTO public.admin_users(email, role, status) VALUES ('cl4339-admin@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.admin_team_members(email, role, status) VALUES ('cl4339-growth@mingla-fixture.org', 'growth', 'active');
  -- A host card named like the creator: a Creator call must never match it.
  INSERT INTO public.crm_records (pipeline, name, stage, created_by, updated_by)
  VALUES ('hosts', 'Ada Okafor', 'prospect', 'cl4339-admin@mingla-fixture.org', 'cl4339-admin@mingla-fixture.org');

  -- ── what growth-tools-book writes for each audience ──────────────────────
  SET LOCAL ROLE service_role;
  INSERT INTO public.book_call_leads (booking_key, audience, name, email, venue, icp, social_platform, social_handle, social_url, call_at, booker_time_zone, meet_url, event_url)
  VALUES ('gcal:cl4339host', 'host', 'Grace Host', 'grace@cl4339-host.org', 'Cl4339 Supper Club', 'events', 'instagram', '@supper', 'https://instagram.com/supper',
          '2031-03-10 15:00:00+00', 'America/New_York', 'https://meet.google.com/aaa-bbbb-ccc', 'https://calendar.google.com/event?eid=h');
  INSERT INTO public.book_call_leads (booking_key, audience, name, email, city, creator_makes, work_url, social_platform, social_handle, social_url, call_at, booker_time_zone, meet_url)
  VALUES ('gcal:cl4339creator', 'creator', 'Ada Okafor', 'ada@cl4339-hey.org', 'Lagos', 'both', 'https://adashoots.example/reel', 'tiktok', '@adashoots',
          'https://tiktok.com/@adashoots', '2031-03-11 23:30:00+00', 'Africa/Lagos', 'https://meet.google.com/ddd-eeee-fff');
  INSERT INTO public.book_call_leads (booking_key, audience, name, email, city, first_place, social_platform, social_handle, social_url, call_at)
  VALUES ('gcal:cl4339local', 'local', 'Tobi Adeyemi', 'tobi@cl4339-mail.org', 'Raleigh', 'Bida Manda', 'instagram', '@tobieats',
          'https://instagram.com/tobieats', '2031-03-12 09:00:00+00');
  INSERT INTO public.book_call_leads (booking_key, audience, name, email, city, social_platform, social_url, call_at)
  VALUES ('gcal:cl4339staff', 'local', 'Staff Local', 'cl4339-staff@usemingla.com', 'Lagos', 'x', 'https://x.com/staff', '2031-03-13 09:00:00+00');
  INSERT INTO public.book_call_leads (booking_key, audience, name, email, city, creator_makes, social_platform, social_url, call_at)
  VALUES ('gcal:cl4339late', 'creator', 'Late Creator', 'late@cl4339-mail.org', 'Paris', 'video', 'instagram', 'https://instagram.com/late', '2031-04-02 09:00:00+00');
  RESET ROLE;
  SELECT id INTO v_host FROM public.book_call_leads WHERE booking_key = 'gcal:cl4339host';
  SELECT id INTO v_creator FROM public.book_call_leads WHERE booking_key = 'gcal:cl4339creator';
  SELECT id INTO v_local FROM public.book_call_leads WHERE booking_key = 'gcal:cl4339local';
  SELECT id INTO v_staff FROM public.book_call_leads WHERE booking_key = 'gcal:cl4339staff';
  SELECT id INTO v_late FROM public.book_call_leads WHERE booking_key = 'gcal:cl4339late';
  PERFORM pg_temp.bc_assert((SELECT audience FROM public.book_call_leads WHERE id = v_host) = 'host', 'T-04 a Host call is stored as host');

  -- ── T-04: each audience's own fields ──────────────────────────────────────
  FOR v_case IN
    SELECT * FROM (VALUES
      ('an unknown audience',          'promoter', NULL::text, 'Lagos',  'video'),
      ('a Host call with no ICP',      'host',     NULL,       NULL,     NULL),
      ('a Creator call with no city',  'creator',  NULL,       NULL,     'video'),
      ('a Creator call with no makes', 'creator',  NULL,       'Lagos',  NULL),
      ('an unknown makes',             'creator',  NULL,       'Lagos',  'audio'),
      ('a Creator call with an ICP',   'creator',  'events',   'Lagos',  'video'),
      ('a Local call with no city',    'local',    NULL,       NULL,     NULL),
      ('a Local call with makes',      'local',    NULL,       'Lagos',  'video')
    ) AS t(label, audience, icp, city, makes)
  LOOP
    BEGIN
      INSERT INTO public.book_call_leads (booking_key, audience, name, email, icp, city, creator_makes, social_platform, social_url, call_at)
      VALUES ('gcal:cl4339bad', v_case.audience, 'Bad Row', 'bad@cl4339.org', v_case.icp, v_case.city, v_case.makes, 'instagram', 'https://instagram.com/x', v_from);
      v_err := 'none';
    EXCEPTION WHEN check_violation THEN v_err := 'refused';
    END;
    PERFORM pg_temp.bc_assert(v_err = 'refused', 'T-04 ' || v_case.label || ' is refused');
  END LOOP;

  -- ── I-06: Inbound leads ───────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_admin);
  v := public.admin_inbound_leads(false, 500);
  RESET ROLE;
  v_rows := v -> 'rows';
  SELECT r INTO v_row FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_creator::text;
  PERFORM pg_temp.bc_assert(v_row ->> 'source' = 'book_a_call' AND v_row #>> '{booking,audience}' = 'creator', 'I-06 a Creator call is a book_a_call lead with audience creator');
  PERFORM pg_temp.bc_assert(v_row ->> 'city' = 'Lagos' AND v_row #>> '{booking,city}' = 'Lagos', 'I-06 its city');
  PERFORM pg_temp.bc_assert(v_row #>> '{booking,creator_makes}' = 'both' AND v_row #>> '{booking,work_url}' = 'https://adashoots.example/reel', 'I-06 what they make and their work');
  PERFORM pg_temp.bc_assert(v_row -> 'host' = 'null'::jsonb, 'I-06 a Creator call is never matched to a host card');
  PERFORM pg_temp.bc_assert((SELECT r #>> '{booking,audience}' FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_local::text) = 'local'
                        AND (SELECT r #>> '{booking,first_place}' FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_local::text) = 'Bida Manda',
    'I-06 a Local call with its first place');
  PERFORM pg_temp.bc_assert((SELECT r #>> '{booking,audience}' FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_host::text) = 'host',
    'I-06 a Host call says host');

  -- ── I-07: the Calendar calls layer ────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_admin);
  v := public.admin_calendar_calls(v_from, v_to, false);
  RESET ROLE;
  v_rows := v -> 'rows';
  PERFORM pg_temp.bc_assert(
    (SELECT array_agg(r ->> 'audience' ORDER BY (r ->> 'call_at')::timestamptz) FROM jsonb_array_elements(v_rows) r
      WHERE r ->> 'id' IN (v_host::text, v_creator::text, v_local::text)) = ARRAY['host', 'creator', 'local'],
    'I-07 Host, Creator and Local calls, in time order');
  PERFORM pg_temp.bc_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_late::text), 'I-07 nothing outside the range');
  PERFORM pg_temp.bc_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_staff::text), 'I-07 a staff call is hidden by default');
  SELECT r INTO v_row FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_creator::text;
  PERFORM pg_temp.bc_assert(v_row ->> 'name' = 'Ada Okafor' AND (v_row ->> 'call_at')::timestamptz = '2031-03-11 23:30:00+00'
                        AND v_row ->> 'city' = 'Lagos' AND v_row ->> 'makes' = 'both'
                        AND v_row ->> 'social_url' = 'https://tiktok.com/@adashoots'
                        AND v_row ->> 'meet_url' = 'https://meet.google.com/ddd-eeee-fff'
                        AND v_row ->> 'booker_time_zone' = 'Africa/Lagos'
                        AND v_row ->> 'lead_id' = v_creator::text AND v_row ->> 'status' = 'booked',
    'I-07 a call carries what the panel shows');
  PERFORM pg_temp.bc_assert((SELECT r ->> 'icp' FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_host::text) = 'events'
                        AND (SELECT r ->> 'event_url' FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_host::text) = 'https://calendar.google.com/event?eid=h',
    'I-07 a Host call carries what they run and the calendar link');
  PERFORM pg_temp.bc_assert(position('@cl4339' IN v_rows::text) = 0 AND position('usemingla.com' IN v_rows::text) = 0, 'I-07 no email address is returned');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_admin);
  v := public.admin_calendar_calls(v_from, v_to, true);
  RESET ROLE;
  PERFORM pg_temp.bc_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'rows') r WHERE r ->> 'id' = v_staff::text AND (r ->> 'is_test')::boolean),
    'I-07 the staff call shows when asked for, marked as test');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_growth);
  v := public.admin_calendar_calls(v_from, v_to, false);
  RESET ROLE;
  PERFORM pg_temp.bc_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'rows') r WHERE r ->> 'id' = v_local::text), 'I-07 a growth teammate sees calls');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_outsider);
  BEGIN
    PERFORM public.admin_calendar_calls(v_from, v_to, false);
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.bc_assert(v_err = 'not_authorized', 'I-07 an outsider is refused the calls');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bc_as(v_admin);
  BEGIN
    PERFORM public.admin_calendar_calls(v_to, v_from, false);
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.bc_assert(v_err = 'invalid_range', 'I-07 a backwards range is refused');
END
$calls$;
ROLLBACK;
