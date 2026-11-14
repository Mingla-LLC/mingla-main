\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4238-MISSING-KEY-LOUD | issue #4238 | ad_tracking_health is readable only by admins (RLS), writable only by the service role, and admin_set_ad_connection_test_code refuses non-admins and writes only extra.test_event_code; ad_attribution_touches.external_click_id_type refuses an unknown click-id type.

-- Issue #4238 Wave 1 (M-1) — run after the full migration chain on PostgreSQL 17
-- as supabase_admin over 127.0.0.1.
--
--   H1  ad_tracking_health: RLS on; anon has no access; a signed-in non-admin
--       reads zero rows and cannot write; an admin reads the rows.
--   H2  admin_set_ad_connection_test_code: 42501 for a non-admin; 22023 for a
--       bad platform or a bad code; saves and clears only test_event_code,
--       leaving every other extra key untouched; P0002 with no connection.
--   H3  external_click_id_type: NULL and the seven known types are accepted;
--       an unknown type is refused by the CHECK.
--   H4  The new function is not executable by anon or PUBLIC.

CREATE OR REPLACE FUNCTION pg_temp.th_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 tracking-health FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.th_as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $s$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
END $s$;

BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('42380000-0000-4000-c000-000000000001', 'th-host@mingla-fixture.org'),
  ('42380000-0000-4000-c000-000000000002', 'th-admin@mingla-fixture.org');
INSERT INTO public.admin_users(email, role, status)
VALUES ('th-admin@mingla-fixture.org', 'admin', 'active');

INSERT INTO public.ad_tracking_health (channel, lane, token_present, pixel_configured, failures_1h)
VALUES ('meta', 'consumer', false, true, 2);

-- The consumer Meta connection may already exist from seed data; make sure
-- one row exists with a known extra to prove only one key changes.
INSERT INTO public.ad_connections (platform, lane, display_name, external_account_id, auth_kind, token_env_var, extra)
VALUES ('meta', 'consumer', 'Meta (fixture)', 'act_4238', 'system_user_token', 'META_SYSTEM_USER_TOKEN',
        '{"dataset_id":"px-th","capi_env_var":"META_CAPI_ACCESS_TOKEN"}'::jsonb)
ON CONFLICT (platform, lane) DO UPDATE
SET extra = '{"dataset_id":"px-th","capi_env_var":"META_CAPI_ACCESS_TOKEN"}'::jsonb;
DELETE FROM public.ad_connections WHERE platform = 'tiktok' AND lane = 'consumer';

-- H1 / H4 ----------------------------------------------------------------------
DO $h1$
BEGIN
  PERFORM pg_temp.th_assert(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_tracking_health'::regclass),
    'H1 ad_tracking_health has RLS on');
  PERFORM pg_temp.th_assert(
    NOT has_table_privilege('anon', 'public.ad_tracking_health', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.ad_tracking_health', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.ad_tracking_health', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.ad_tracking_health', 'DELETE'),
    'H1 anon reads nothing; signed-in users cannot write health rows');
  PERFORM pg_temp.th_assert(
    has_table_privilege('service_role', 'public.ad_tracking_health', 'INSERT')
    AND has_table_privilege('service_role', 'public.ad_tracking_health', 'UPDATE'),
    'H1 the service role writes health rows');
  PERFORM pg_temp.th_assert(
    NOT has_function_privilege('anon', 'public.admin_set_ad_connection_test_code(text,text)', 'EXECUTE'),
    'H4 anon cannot execute admin_set_ad_connection_test_code');
END
$h1$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.th_as_user('42380000-0000-4000-c000-000000000001');
DO $h1b$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.ad_tracking_health;
  PERFORM pg_temp.th_assert(v_n = 0, 'H1 a signed-in non-admin reads zero health rows');
  BEGIN
    PERFORM public.admin_set_ad_connection_test_code('meta', 'TEST123');
    PERFORM pg_temp.th_assert(false, 'H2 a non-admin must be refused');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.th_assert(true, 'H2 a non-admin is refused with 42501');
  END;
END
$h1b$;

SELECT pg_temp.th_as_user('42380000-0000-4000-c000-000000000002');
DO $h2$
DECLARE
  v_n integer;
  v_out jsonb;
BEGIN
  SELECT count(*) INTO v_n FROM public.ad_tracking_health WHERE channel = 'meta';
  PERFORM pg_temp.th_assert(v_n = 1, 'H1 an admin reads the health rows');

  BEGIN
    PERFORM public.admin_set_ad_connection_test_code('snapchat', 'TEST123');
    PERFORM pg_temp.th_assert(false, 'H2 a bad platform must be refused');
  EXCEPTION WHEN invalid_parameter_value THEN
    PERFORM pg_temp.th_assert(true, 'H2 a platform other than meta/tiktok is refused with 22023');
  END;
  BEGIN
    PERFORM public.admin_set_ad_connection_test_code('meta', 'bad code; drop');
    PERFORM pg_temp.th_assert(false, 'H2 a bad code must be refused');
  EXCEPTION WHEN invalid_parameter_value THEN
    PERFORM pg_temp.th_assert(true, 'H2 a code outside [A-Za-z0-9_-]{1,64} is refused with 22023');
  END;
  BEGIN
    PERFORM public.admin_set_ad_connection_test_code('tiktok', 'TEST123');
    PERFORM pg_temp.th_assert(false, 'H2 a missing connection must be refused');
  EXCEPTION WHEN no_data_found THEN
    PERFORM pg_temp.th_assert(true, 'H2 a missing consumer connection raises P0002');
  END;

  v_out := public.admin_set_ad_connection_test_code('meta', '  TEST4238  ');
  PERFORM pg_temp.th_assert(v_out ->> 'test_event_code' = 'TEST4238',
    'H2 an admin saves a trimmed test code');
END
$h2$;

RESET ROLE;
DO $h2b$
DECLARE
  v_extra jsonb;
BEGIN
  SELECT extra INTO v_extra FROM public.ad_connections WHERE platform = 'meta' AND lane = 'consumer';
  PERFORM pg_temp.th_assert(
    v_extra = '{"dataset_id":"px-th","capi_env_var":"META_CAPI_ACCESS_TOKEN","test_event_code":"TEST4238"}'::jsonb,
    'H2 only extra.test_event_code was written');
END
$h2b$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.th_as_user('42380000-0000-4000-c000-000000000002');
SELECT public.admin_set_ad_connection_test_code('meta', NULL);
RESET ROLE;
DO $h2c$
BEGIN
  PERFORM pg_temp.th_assert(
    (SELECT extra FROM public.ad_connections WHERE platform = 'meta' AND lane = 'consumer')
      = '{"dataset_id":"px-th","capi_env_var":"META_CAPI_ACCESS_TOKEN"}'::jsonb,
    'H2 a NULL code clears only test_event_code');
END
$h2c$;

-- H3 ---------------------------------------------------------------------------
DO $h3$
DECLARE
  v_type text;
  v_n integer := 0;
BEGIN
  PERFORM pg_temp.th_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ad_attribution_touches'
        AND column_name = 'external_click_id_type' AND is_nullable = 'YES'),
    'H3 ad_attribution_touches.external_click_id_type exists and is nullable');
  INSERT INTO public.ad_attribution_touches (click_id, network, surface, external_click_id)
  VALUES ('th-click-legacy', 'meta', 'web', 'fbclid-legacy');
  FOREACH v_type IN ARRAY ARRAY['fbclid', 'ttclid', 'sccid', 'gclid', 'gbraid', 'wbraid', 'rdt_cid'] LOOP
    INSERT INTO public.ad_attribution_touches (click_id, network, surface, external_click_id, external_click_id_type)
    VALUES ('th-click-' || v_type, 'other', 'web', 'x-' || v_type, v_type);
    v_n := v_n + 1;
  END LOOP;
  PERFORM pg_temp.th_assert(v_n = 7, 'H3 NULL and the seven known click-id types are accepted');
  BEGIN
    INSERT INTO public.ad_attribution_touches (click_id, network, surface, external_click_id, external_click_id_type)
    VALUES ('th-click-bad', 'other', 'web', 'x', 'msclkid');
    PERFORM pg_temp.th_assert(false, 'H3 an unknown click-id type must be refused');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.th_assert(true, 'H3 an unknown click-id type is refused by the CHECK');
  END;
END
$h3$;

ROLLBACK;
