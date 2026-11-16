\set ON_ERROR_STOP on

-- Issue #4238 W3 (amendment A) — builder intelligence. Runs after the full
-- migration chain on PostgreSQL 17 as supabase_admin over 127.0.0.1, in one
-- rolled-back transaction.
--
--   B1  the four new automation kinds are accepted; an unknown kind is refused.
--   B2  ad_creative_metrics_daily: RLS on, no client privilege (anon and
--       authenticated cannot read), negatives refused, one row per ad per day.
--   B3  admin_set_ad_past_guest_seed refuses a non-admin (42501).
--   B4  it refuses enabled=true with an empty or missing privacy-review
--       reference, and an unknown app.
--   B5  with a reference, an admin turns it on; only the consumer lane flips,
--       and the switch is audited with the reference and who flipped it.
--   B6  every connection starts with the seed off.
--   B7  anon cannot execute the RPC.
--
-- MINGLA-INVARIANT: I-4238-PAST-GUEST-SEED-NEEDS-REVIEW | issue #4238 | The past-guests seed (a customer list, R-3) can only be switched on by an admin through admin_set_ad_past_guest_seed with a non-empty privacy-review reference; every switch is audited in ad_ops_switch_events and the seed ships off on every app.

CREATE OR REPLACE FUNCTION pg_temp.bi_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 builder intelligence FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.bi_as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $s$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
END $s$;

BEGIN;

-- B6 first: before any switch in this transaction, no connection has it on.
SELECT pg_temp.bi_assert(NOT EXISTS (
    SELECT 1 FROM public.ad_connections
    WHERE (extra->>'past_guest_seed_enabled')::boolean IS TRUE),
  'B6 every connection starts with the past-guest seed off');

INSERT INTO auth.users(id, email) VALUES
  ('42380000-7110-4000-8000-000000000001', 'bi-host@mingla-fixture.org'),
  ('42380000-7110-4000-8000-000000000002', 'bi-admin@mingla-fixture.org');
INSERT INTO public.admin_users(email, role, status)
VALUES ('bi-admin@mingla-fixture.org', 'admin', 'active');
INSERT INTO public.creator_accounts(id, email)
VALUES ('42380000-7110-4000-8000-000000000001', 'bi-owner@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('42380000-7110-4000-8000-000000000010', '42380000-7110-4000-8000-000000000001',
        'BI Brand', 'issue-4238-bi', 'USD', now(), now());
INSERT INTO public.ad_plans(id, client_kind, owner_kind, brand_id, destination_family, destination_key, state)
VALUES ('42380000-7110-4000-8000-000000000801', 'host', 'host', '42380000-7110-4000-8000-000000000010',
        'public_mingla_page', 'event:issue-4238-bi:bi-1', 'live');

-- B1 -------------------------------------------------------------------------------
DO $b1$
DECLARE
  v_kind text;
  v_ok boolean;
BEGIN
  FOREACH v_kind IN ARRAY ARRAY['retarget_added','retarget_removed','creative_fatigue','apps_trimmed'] LOOP
    INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind, status, detail)
    VALUES ('42380000-7110-4000-8000-000000000801', 'meta', v_kind, 'applied', '{}');
  END LOOP;
  PERFORM pg_temp.bi_assert((SELECT count(*) = 4 FROM public.ad_plan_automation_events
      WHERE plan_id = '42380000-7110-4000-8000-000000000801'),
    'B1 retarget_added, retarget_removed, creative_fatigue and apps_trimmed are accepted');
  -- Fatigue repeats per creative (the 7-day window is the sweep's), so a
  -- second creative_fatigue row is accepted.
  INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind, status, detail)
  VALUES ('42380000-7110-4000-8000-000000000801', 'meta', 'creative_fatigue', 'pending',
          '{"creative_id":"x"}');
  PERFORM pg_temp.bi_assert(true, 'B1 creative_fatigue is not a once-only kind');
  v_ok := false;
  BEGIN
    INSERT INTO public.ad_plan_automation_events(plan_id, platform, kind)
    VALUES ('42380000-7110-4000-8000-000000000801', 'meta', 'retarget_everything');
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  PERFORM pg_temp.bi_assert(v_ok, 'B1 an unknown kind is refused');
  PERFORM pg_temp.bi_assert(EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ad_plan_automation_events_kind_check' AND convalidated),
    'B1 the widened kind check is validated');
END $b1$;

-- B2 -------------------------------------------------------------------------------
SELECT pg_temp.bi_assert(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_creative_metrics_daily'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.ad_creative_metrics_daily', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.ad_creative_metrics_daily', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.ad_creative_metrics_daily', 'INSERT')
  AND has_table_privilege('service_role', 'public.ad_creative_metrics_daily', 'INSERT'),
  'B2 metrics: RLS on, anon/authenticated cannot read or write, service role can');
SELECT pg_temp.bi_assert(NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ad_creative_metrics_daily'),
  'B2 metrics: no policies');
SELECT pg_temp.bi_assert(EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.ad_creative_metrics_daily'::regclass AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%campaign_id, provider_ad_id, metric_date%'),
  'B2 metrics: one row per campaign, ad and day');
DO $b2$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.ad_creative_metrics_daily(campaign_id, platform, provider_ad_id, metric_date, impressions, currency)
    VALUES (gen_random_uuid(), 'meta', 'ad-1', current_date, -1, 'USD');
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN v_ok := true; END;
  PERFORM pg_temp.bi_assert(v_ok, 'B2 metrics: a negative or orphan row is refused');
  v_ok := false;
  BEGIN
    INSERT INTO public.ad_creative_metrics_daily(campaign_id, platform, provider_ad_id, metric_date, currency)
    VALUES (gen_random_uuid(), 'facebook', 'ad-1', current_date, 'USD');
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN v_ok := true; END;
  PERFORM pg_temp.bi_assert(v_ok, 'B2 metrics: an unknown app is refused');
  PERFORM pg_temp.bi_assert(EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.ad_creative_metrics_daily'::regclass
        AND pg_get_constraintdef(oid) LIKE '%impressions >= 0%'),
    'B2 metrics: impressions must be zero or more');
END $b2$;

-- B3 / B4 / B5 ------------------------------------------------------------------------
DO $b3$
DECLARE
  v_host  constant uuid := '42380000-7110-4000-8000-000000000001';
  v_admin constant uuid := '42380000-7110-4000-8000-000000000002';
  v_ok boolean;
  v_out jsonb;
BEGIN
  INSERT INTO public.ad_connections (id, platform, lane, display_name,
    external_account_id, auth_kind, token_env_var, status, connected, extra)
  VALUES
    (gen_random_uuid(), 'snapchat', 'consumer', 'Snap consumer', 'snap-c',
     'system_user_token', 'BI_TOKEN', 'connected', true, '{}'::jsonb),
    (gen_random_uuid(), 'snapchat', 'business', 'Snap business', 'snap-b',
     'system_user_token', 'BI_TOKEN', 'connected', true, '{}'::jsonb)
  ON CONFLICT (platform, lane) DO NOTHING;

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bi_as_user(v_host);
  v_ok := false;
  BEGIN PERFORM public.admin_set_ad_past_guest_seed('snapchat', true, 'D2-2026-11');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.bi_assert(v_ok, 'B3 a Host cannot switch the past-guest seed (42501)');

  PERFORM pg_temp.bi_as_user(v_admin);
  v_ok := false;
  BEGIN PERFORM public.admin_set_ad_past_guest_seed('snapchat', true, '');
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.bi_assert(v_ok, 'B4 an empty privacy-review reference is refused');
  v_ok := false;
  BEGIN PERFORM public.admin_set_ad_past_guest_seed('snapchat', true, '   ');
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.bi_assert(v_ok, 'B4 a blank privacy-review reference is refused');
  v_ok := false;
  BEGIN PERFORM public.admin_set_ad_past_guest_seed('snapchat', true, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.bi_assert(v_ok, 'B4 a missing privacy-review reference is refused');
  v_ok := false;
  BEGIN PERFORM public.admin_set_ad_past_guest_seed('facebook', false, NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.bi_assert(v_ok, 'B4 an unknown app is refused');
  RESET ROLE;
  PERFORM pg_temp.bi_assert(NOT EXISTS (
      SELECT 1 FROM public.ad_connections
      WHERE (extra->>'past_guest_seed_enabled')::boolean IS TRUE),
    'B4 the refusals left every seed off');
  PERFORM pg_temp.bi_assert(NOT EXISTS (
      SELECT 1 FROM public.ad_ops_switch_events WHERE switch = 'past_guest_seed'),
    'B4 a refused switch writes no audit row');

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bi_as_user(v_admin);
  -- Switching OFF needs no reference.
  v_out := public.admin_set_ad_past_guest_seed('snapchat', false, NULL);
  PERFORM pg_temp.bi_assert(NOT (v_out->>'enabled')::boolean, 'B5 switching off needs no reference');
  v_out := public.admin_set_ad_past_guest_seed('snapchat', true, ' D2-2026-11 ');
  PERFORM pg_temp.bi_assert((v_out->>'enabled')::boolean, 'B5 an admin with a reference switches it on');
  RESET ROLE;
  PERFORM pg_temp.bi_assert(
    (SELECT (extra->>'past_guest_seed_enabled')::boolean FROM public.ad_connections
     WHERE platform = 'snapchat' AND lane = 'consumer' LIMIT 1),
    'B5 the Host lane flag is on');
  PERFORM pg_temp.bi_assert(NOT EXISTS (
      SELECT 1 FROM public.ad_connections
      WHERE platform = 'snapchat' AND lane <> 'consumer'
        AND (extra->>'past_guest_seed_enabled')::boolean IS TRUE),
    'B5 other lanes are untouched');
  PERFORM pg_temp.bi_assert(EXISTS (
      SELECT 1 FROM public.ad_ops_switch_events
      WHERE switch = 'past_guest_seed' AND platform = 'snapchat' AND actor_id = v_admin
        AND (value->>'enabled')::boolean AND value->>'privacy_review_ref' = 'D2-2026-11'),
    'B5 the switch is audited with the trimmed reference and who flipped it');
END $b3$;

-- B7 -------------------------------------------------------------------------------
SELECT pg_temp.bi_assert(
  NOT has_function_privilege('anon', 'public.admin_set_ad_past_guest_seed(text,boolean,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_set_ad_past_guest_seed(text,boolean,text)', 'EXECUTE'),
  'B7 anon cannot execute the seed RPC');

ROLLBACK;
