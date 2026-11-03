\set ON_ERROR_STOP on

-- Issue #4238 media-buyer — run after the full migration chain on PostgreSQL 17
-- as supabase_admin over 127.0.0.1.
--
--   M1  "Works here": seeded rows (TikTok GB, Reddit NG); a signed-in Host can
--       read nothing (admin-only RLS) and cannot write; anon has no access;
--       admin_set_ad_platform_country refuses a non-admin with 42501, needs a
--       reason for not_available, and not_checked deletes the row (unknown =
--       works).
--   M2  Per-app reach switch: admins only (42501 otherwise); Google has no
--       switch; it flips ad_connections.extra.audience_estimate_certified on
--       the consumer (Host) lane only and is audited append-only.
--   M3  Every new function is revoked from PUBLIC and anon.

CREATE OR REPLACE FUNCTION pg_temp.tmb_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 media-buyer FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.tmb_as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $s$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
END $s$;

BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('42380000-0000-4000-b000-000000000001', 'tmb-host@mingla-fixture.org'),
  ('42380000-0000-4000-b000-000000000002', 'tmb-admin@mingla-fixture.org');
INSERT INTO public.admin_users(email, role, status)
VALUES ('tmb-admin@mingla-fixture.org', 'admin', 'active');

-- M1 / M3 -----------------------------------------------------------------------
DO $m1$
DECLARE
  v_host  constant uuid := '42380000-0000-4000-b000-000000000001';
  v_admin constant uuid := '42380000-0000-4000-b000-000000000002';
  v_ok boolean;
  v_n integer;
  v_row public.ad_platform_country_availability%ROWTYPE;
BEGIN
  PERFORM pg_temp.tmb_assert(EXISTS (
    SELECT 1 FROM public.ad_platform_country_availability
    WHERE platform = 'tiktok' AND country_code = 'GB' AND status = 'not_available'
      AND reason LIKE 'TikTok can''t run ads in the United Kingdom%'),
    'M1 TikTok GB is seeded as not available with a plain reason');
  PERFORM pg_temp.tmb_assert(EXISTS (
    SELECT 1 FROM public.ad_platform_country_availability
    WHERE platform = 'reddit' AND country_code = 'NG' AND status = 'not_available'),
    'M1 Reddit NG is seeded as not available');
  PERFORM pg_temp.tmb_assert(
    NOT has_table_privilege('anon', 'public.ad_platform_country_availability', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.ad_platform_country_availability', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.ad_platform_country_availability', 'UPDATE'),
    'M1 anon reads nothing; signed-in users cannot write the table');
  PERFORM pg_temp.tmb_assert(
    NOT has_function_privilege('anon', 'public.admin_set_ad_platform_country(text,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.admin_set_ad_reach_estimates(text,boolean)', 'EXECUTE'),
    'M3 the new functions are not executable by anon');
  PERFORM pg_temp.tmb_assert(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_platform_country_availability'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_ops_switch_events'::regclass),
    'M3 RLS is on for both new tables');

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.tmb_as_user(v_host);
  SELECT count(*) INTO v_n FROM public.ad_platform_country_availability;
  PERFORM pg_temp.tmb_assert(v_n = 0, 'M1 a Host reads no availability rows directly');
  v_ok := false;
  BEGIN
    PERFORM public.admin_set_ad_platform_country('tiktok', 'GB', 'works', NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M1 a Host cannot mark an app/country (42501)');

  PERFORM pg_temp.tmb_as_user(v_admin);
  SELECT count(*) INTO v_n FROM public.ad_platform_country_availability;
  PERFORM pg_temp.tmb_assert(v_n >= 2, 'M1 an admin reads the table');
  v_ok := false;
  BEGIN
    PERFORM public.admin_set_ad_platform_country('reddit', 'gh', 'not_available', '  ');
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M1 not_available needs a reason');
  v_row := public.admin_set_ad_platform_country('reddit', 'gh', 'not_available', 'Reddit doesn''t run ads in Ghana.');
  PERFORM pg_temp.tmb_assert(v_row.country_code = 'GH' AND v_row.updated_by = v_admin,
    'M1 an admin marks Reddit GH (code upper-cased, author kept)');
  PERFORM public.admin_set_ad_platform_country('reddit', 'GH', 'not_checked', NULL);
  PERFORM pg_temp.tmb_assert(NOT EXISTS (
      SELECT 1 FROM public.ad_platform_country_availability
      WHERE platform = 'reddit' AND country_code = 'GH'),
    'M1 not_checked removes the row (unknown means it works)');
  v_ok := false;
  BEGIN
    PERFORM public.admin_set_ad_platform_country('myspace', 'GH', 'works', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M1 an unknown app is refused');
  RESET ROLE;
END
$m1$;

-- M2 -----------------------------------------------------------------------------
DO $m2$
DECLARE
  v_host  constant uuid := '42380000-0000-4000-b000-000000000001';
  v_admin constant uuid := '42380000-0000-4000-b000-000000000002';
  v_ok boolean;
  v_out jsonb;
  v_consumer uuid := gen_random_uuid();
  v_mingla uuid := gen_random_uuid();
BEGIN
  -- Fixture connections for TikTok on both lanes (constraints permitting).
  INSERT INTO public.ad_connections (id, platform, lane, display_name,
    external_account_id, auth_kind, token_env_var, status, connected, extra)
  VALUES
    (v_consumer, 'tiktok', 'consumer', 'TikTok consumer', 'adv-c',
     'system_user_token', 'TMB_TOKEN', 'connected', true, '{}'::jsonb),
    (v_mingla, 'tiktok', 'business', 'TikTok business', 'adv-b',
     'system_user_token', 'TMB_TOKEN', 'connected', true, '{}'::jsonb)
  ON CONFLICT (platform, lane) DO NOTHING;

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.tmb_as_user(v_host);
  v_ok := false;
  BEGIN PERFORM public.admin_set_ad_reach_estimates('tiktok', true);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M2 a Host cannot switch reach on (42501)');

  PERFORM pg_temp.tmb_as_user(v_admin);
  v_ok := false;
  BEGIN PERFORM public.admin_set_ad_reach_estimates('google', true);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M2 Google has no reach switch');
  v_out := public.admin_set_ad_reach_estimates('tiktok', true);
  PERFORM pg_temp.tmb_assert((v_out->>'enabled')::boolean, 'M2 an admin switches TikTok reach on');
  RESET ROLE;

  PERFORM pg_temp.tmb_assert(
    (SELECT (extra->>'audience_estimate_certified')::boolean FROM public.ad_connections
     WHERE platform = 'tiktok' AND lane = 'consumer' LIMIT 1),
    'M2 the Host lane flag is on');
  PERFORM pg_temp.tmb_assert(
    NOT EXISTS (SELECT 1 FROM public.ad_connections
      WHERE platform = 'tiktok' AND lane <> 'consumer'
        AND (extra->>'audience_estimate_certified')::boolean IS TRUE),
    'M2 other lanes are untouched');
  PERFORM pg_temp.tmb_assert(EXISTS (
      SELECT 1 FROM public.ad_ops_switch_events
      WHERE switch = 'reach_estimates' AND platform = 'tiktok'
        AND actor_id = v_admin AND (value->>'enabled')::boolean),
    'M2 the switch is audited with who flipped it');
  v_ok := false;
  BEGIN DELETE FROM public.ad_ops_switch_events WHERE platform = 'tiktok';
  EXCEPTION WHEN OTHERS THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M2 the audit is append-only');
END
$m2$;

ROLLBACK;
