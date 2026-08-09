-- [TEST-MOD-APPROVED #1564] — SIGNATURE PIN ONLY. `biz_create_venue_listing`
-- gained three APPENDED, DEFAULTED params (p_theme_color / p_theme_font /
-- p_theme_animation) so a venue can carry its own colours; the 18-arg overload
-- no longer exists, and `regprocedure` / `has_function_privilege` resolve by
-- the EXACT argument list. Every assertion in this file is unchanged — only the
-- signature string it looks the function up by. The grant expectations below
-- (anon has NO execute, authenticated does) are asserted exactly as before, now
-- against the real signature.
-- [TEST-MOD-APPROVED #1719] — SIGNATURE PIN ONLY. The binding all-writers
-- amendment adds one appended/defaulted poster URL; grant expectations and all
-- event_manager/staff behavior below are unchanged.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  ('00000000-1463-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a-1463@example.test', now(), now()),
  ('00000000-1463-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b-1463@example.test', now(), now()),
  ('00000000-1463-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager-a-1463@example.test', now(), now()),
  ('00000000-1463-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scanner-a-1463@example.test', now(), now());

INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('00000000-1463-4000-8000-000000000001', now()),
  ('00000000-1463-4000-8000-000000000002', now());

INSERT INTO public.brands (id, account_id, name, slug, default_currency) VALUES
  ('00000000-1463-4000-8000-000000000011', '00000000-1463-4000-8000-000000000001', 'Issue 1463 Brand A', 'issue-1463-brand-a', 'USD'),
  ('00000000-1463-4000-8000-000000000012', '00000000-1463-4000-8000-000000000002', 'Issue 1463 Brand B', 'issue-1463-brand-b', 'USD');

INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at) VALUES
  ('00000000-1463-4000-8000-000000000011', '00000000-1463-4000-8000-000000000003', 'event_manager', now()),
  ('00000000-1463-4000-8000-000000000011', '00000000-1463-4000-8000-000000000004', 'scanner', now());

UPDATE public.feature_flags
SET is_enabled = true
WHERE flag_key = 'STAY_VENUE_AUTHORING';

CREATE TEMP TABLE issue_1463_hours AS
SELECT '[
  {"weekday":0,"open_time":"09:00","close_time":"17:00","is_closed":false},
  {"weekday":1,"open_time":"09:00","close_time":"17:00","is_closed":false},
  {"weekday":2,"open_time":"09:00","close_time":"17:00","is_closed":false},
  {"weekday":3,"open_time":"09:00","close_time":"17:00","is_closed":false},
  {"weekday":4,"open_time":"09:00","close_time":"17:00","is_closed":false},
  {"weekday":5,"open_time":"10:00","close_time":"16:00","is_closed":false},
  {"weekday":6,"open_time":null,"close_time":null,"is_closed":true}
]'::jsonb AS value;
GRANT SELECT ON issue_1463_hours TO authenticated;
CREATE TEMP TABLE issue_1463_result (venue_id uuid NOT NULL);
GRANT INSERT, SELECT ON issue_1463_result TO authenticated;

-- The canonical venue manager can create one pending-review Stay for Brand A.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1463-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1463-4000-8000-000000000003","role":"authenticated"}', true);

DO $manager_create$
DECLARE
  v_venue_id uuid;
  v_hours jsonb;
  v_count integer;
BEGIN
  SELECT value INTO v_hours FROM issue_1463_hours;
  v_venue_id := public.biz_create_venue_listing(
    '00000000-1463-4000-8000-000000000011',
    'Issue 1463 Staff Stay',
    'issue1463staffstay',
    'A pending-review Stay created by permitted staff.',
    '', 35.7796, -78.6382, 'Raleigh', 'US', '1 Staff Stay Way',
    'stay', 'stay-1463@example.test', '+19195550146',
    '', '', v_hours, NULL, 'approximate'
  );
  INSERT INTO issue_1463_result (venue_id) VALUES (v_venue_id);

  SELECT count(*) INTO v_count
  FROM public.venue_listings
  WHERE id = v_venue_id
    AND brand_id = '00000000-1463-4000-8000-000000000011'
    AND venue_category = 'stay'
    AND claim_status = 'pending_review';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue_1463_manager_stay_not_pending_review';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.brand_hours
  WHERE venue_id = v_venue_id;
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'issue_1463_manager_stay_hours_expected_7_got_%', v_count;
  END IF;

END;
$manager_create$;

-- The same manager cannot create under a brand where they hold no role.
DO $cross_brand$
DECLARE
  v_before integer;
  v_hours jsonb;
BEGIN
  SELECT count(*) INTO v_before FROM public.venue_listings;
  SELECT value INTO v_hours FROM issue_1463_hours;
  BEGIN
    PERFORM public.biz_create_venue_listing(
      '00000000-1463-4000-8000-000000000012',
      'Cross Brand Escape', 'issue1463escape', '', '',
      1, 1, 'Elsewhere', 'US', '2 Escape Way', 'stay',
      '', '', '', '', v_hours, NULL, 'approximate'
    );
    RAISE EXCEPTION 'issue_1463_cross_brand_was_allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.venue_listings) <> v_before THEN
    RAISE EXCEPTION 'issue_1463_cross_brand_left_a_write';
  END IF;
END;
$cross_brand$;

-- A lower-ranked brand member remains forbidden with zero writes.
SELECT set_config('request.jwt.claim.sub', '00000000-1463-4000-8000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1463-4000-8000-000000000004","role":"authenticated"}', true);
DO $lower_role$
DECLARE
  v_before integer;
  v_hours jsonb;
BEGIN
  SELECT count(*) INTO v_before FROM public.venue_listings;
  SELECT value INTO v_hours FROM issue_1463_hours;
  BEGIN
    PERFORM public.biz_create_venue_listing(
      '00000000-1463-4000-8000-000000000011',
      'Scanner Escape', 'issue1463scanner', '', '',
      1, 1, 'Elsewhere', 'US', '3 Escape Way', 'stay',
      '', '', '', '', v_hours, NULL, 'approximate'
    );
    RAISE EXCEPTION 'issue_1463_lower_role_was_allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.venue_listings) <> v_before THEN
    RAISE EXCEPTION 'issue_1463_lower_role_left_a_write';
  END IF;
END;
$lower_role$;

-- Existing brand-owner creation remains valid.
SELECT set_config('request.jwt.claim.sub', '00000000-1463-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1463-4000-8000-000000000001","role":"authenticated"}', true);
DO $owner_create$
DECLARE
  v_venue_id uuid;
  v_hours jsonb;
BEGIN
  SELECT value INTO v_hours FROM issue_1463_hours;
  v_venue_id := public.biz_create_venue_listing(
    '00000000-1463-4000-8000-000000000011',
    'Issue 1463 Owner Restaurant', 'issue1463owner', '', '',
    35.7, -78.6, 'Raleigh', 'US', '4 Owner Way', 'restaurant',
    '', '', '', '', v_hours, NULL, 'approximate'
  );
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'issue_1463_owner_create_regressed';
  END IF;
END;
$owner_create$;

RESET ROLE;

DO $server_residue$
DECLARE
  v_venue_id uuid;
BEGIN
  SELECT venue_id INTO v_venue_id FROM issue_1463_result LIMIT 1;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_place_pipeline_state
    WHERE venue_id = v_venue_id AND status = 'draft'
  ) THEN
    RAISE EXCEPTION 'issue_1463_manager_stay_pipeline_missing';
  END IF;
END;
$server_residue$;

DO $grants$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.biz_create_venue_listing(uuid,text,text,text,text,double precision,double precision,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1463_anon_execute_was_granted';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.biz_create_venue_listing(uuid,text,text,text,text,double precision,double precision,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1463_authenticated_execute_missing';
  END IF;
END;
$grants$;

ROLLBACK;
