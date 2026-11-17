\set ON_ERROR_STOP on
-- #4453 milestone 10: executable PostgreSQL 17 proof of the plan-preview
-- migration (20280801004453). BEGIN ... ROLLBACK: every fixture rolls back.
-- MINGLA-INVARIANT: I-SITES-PLAN-FEED-ONE-BODY | issue #4453 | brand_site_offerings_feed(site) resolves the site's brand and returns brand_site_offerings_feed_for_brand(brand): the two return equal rows; both are service-role only.
-- MINGLA-INVARIANT: I-SITES-PLAN-PREVIEW-RATE | issue #4453 | brand_site_plan_preview_take refuses a 4th plan-preview request within a minute and a 21st within a day, per brand; the counter table is closed to clients.
--
-- T-1  grants and shape: service role only (inputs: authenticated through the plan gate); SECURITY DEFINER; search_path; static SQL; tables closed.
-- T-2  SITES_PLAN_PREVIEW seeded off; the allowlist is seeded empty; on for a listed brand only, then for all when the flag is on.
-- T-3  feed by brand equals the site feed (one body); an unknown site or brand raises sites_not_found; the site feed's body calls the brand feed.
-- T-4  inputs: gated at content rank 20 by brand_site_plan_gate; refused without a signed-in member; read only.
-- T-5  rate limit: 3 a minute then refused; 20 a day then refused; another brand is unaffected.
-- T-6  writes nothing to brand_sites (the preview reads only).
--
-- FAILS-ON-REVERT: drop 20280801004453 -> T-1 (functions missing); feed(site) keeps its own body -> T-3c;
-- drop the minute check -> T-5b; drop the day check -> T-5d; drop the gate -> T-4a.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 plan preview FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- T-1 grants and shape
SELECT pg_temp.p_assert(bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE')
    AND NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')),
  'T-1a feed, flag and rate limit are service-role only')
FROM unnest(ARRAY['public.brand_site_offerings_feed_for_brand(uuid)', 'public.brand_site_offerings_feed(uuid)',
  'public.brand_site_plan_preview_take(uuid)', 'public.brand_site_plan_preview_on(uuid)']) AS f;
SELECT pg_temp.p_assert(has_function_privilege('authenticated', 'public.brand_site_plan_preview_inputs(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.brand_site_plan_preview_inputs(uuid)', 'EXECUTE'),
  'T-1b inputs: signed-in members only (the plan gate decides)');
SELECT pg_temp.p_assert(count(*) = 5 AND bool_and(p.prosecdef)
    AND bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
    AND bool_and(p.prosrc !~* '\mEXECUTE\M'),
  'T-1c SECURITY DEFINER, explicit search_path, static SQL')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('brand_site_offerings_feed_for_brand', 'brand_site_offerings_feed',
  'brand_site_plan_preview_inputs', 'brand_site_plan_preview_take', 'brand_site_plan_preview_on');
SELECT pg_temp.p_assert(bool_and(NOT has_table_privilege('authenticated', t, 'SELECT') AND NOT has_table_privilege('anon', t, 'SELECT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass)),
  'T-1d both tables closed to anon and authenticated, RLS on')
FROM unnest(ARRAY['public.brand_site_plan_preview_brands', 'public.brand_site_plan_preview_requests']) AS t;

-- Fixtures: two brands; only the first has a site.
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-4000-8000-00000010a001', 'm10-owner@4453.invalid');
INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES ('00000000-0000-4000-8000-00000010a001', now(), now());
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('00000000-0000-4000-8000-0000001b0001', '00000000-0000-4000-8000-00000010a001', 'M10 Alpha', 'm10-alpha', 'GBP'),
  ('00000000-0000-4000-8000-0000001b0002', '00000000-0000-4000-8000-00000010a001', 'M10 Beta', 'm10-beta', 'GBP');
INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
  ('00000000-0000-4000-8000-0000001c0001', '00000000-0000-4000-8000-0000001b0001', 'provisioning', '00000000-0000-4000-8000-00000010a001');

-- T-2 flag
SELECT pg_temp.p_assert((SELECT count(*) = 1 AND bool_and(NOT is_enabled) FROM public.feature_flags WHERE flag_key = 'SITES_PLAN_PREVIEW'),
  'T-2a SITES_PLAN_PREVIEW seeded off');
SELECT pg_temp.p_assert((SELECT count(*) = 0 FROM public.brand_site_plan_preview_brands), 'T-2b the allowlist is seeded empty');
SELECT pg_temp.p_assert(NOT public.brand_site_plan_preview_on('00000000-0000-4000-8000-0000001b0001'), 'T-2c off for an unlisted brand');
INSERT INTO public.brand_site_plan_preview_brands (brand_id) VALUES ('00000000-0000-4000-8000-0000001b0001');
SELECT pg_temp.p_assert(public.brand_site_plan_preview_on('00000000-0000-4000-8000-0000001b0001')
    AND NOT public.brand_site_plan_preview_on('00000000-0000-4000-8000-0000001b0002'), 'T-2d on for the listed brand only');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_PLAN_PREVIEW';
SELECT pg_temp.p_assert(public.brand_site_plan_preview_on('00000000-0000-4000-8000-0000001b0002'), 'T-2e on for every brand when the flag is on');
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'SITES_PLAN_PREVIEW';

-- T-3 one body
SELECT pg_temp.p_assert(
  (public.brand_site_offerings_feed('00000000-0000-4000-8000-0000001c0001') - 'generated_at')
    = (public.brand_site_offerings_feed_for_brand('00000000-0000-4000-8000-0000001b0001') - 'generated_at'),
  'T-3a the site feed and the brand feed return equal rows');
SELECT pg_temp.p_assert(
  public.brand_site_offerings_feed_for_brand('00000000-0000-4000-8000-0000001b0002') ? 'offerings',
  'T-3b a brand with no site still has a feed (the plan preview runs before a site exists)');
SELECT pg_temp.p_assert(
  (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_offerings_feed' AND pronamespace = 'public'::regnamespace)
    ~ 'RETURN public\.brand_site_offerings_feed_for_brand\(v_brand_id\)'
  AND (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_offerings_feed' AND pronamespace = 'public'::regnamespace) !~ 'pg_public_trips_by_brand',
  'T-3c the site feed has no body of its own');
DO $t$
BEGIN
  BEGIN
    PERFORM public.brand_site_offerings_feed('00000000-0000-4000-8000-0000001cffff');
    RAISE EXCEPTION 'issue #4453 plan preview FAIL: T-3d unknown site did not raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'sites_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.brand_site_offerings_feed_for_brand('00000000-0000-4000-8000-0000001bffff');
    RAISE EXCEPTION 'issue #4453 plan preview FAIL: T-3d unknown brand did not raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'sites_not_found' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS  T-3d an unknown site or brand raises sites_not_found';
END
$t$;

-- T-4 inputs
SELECT pg_temp.p_assert(
  (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_plan_preview_inputs' AND pronamespace = 'public'::regnamespace)
    ~ 'PERFORM public\.brand_site_plan_gate\(p_brand_id, 20\)',
  'T-4a inputs are gated at content rank 20 by the plan gate');
DO $t$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.brand_site_plan_preview_inputs('00000000-0000-4000-8000-0000001b0001');
    RAISE EXCEPTION 'issue #4453 plan preview FAIL: T-4b inputs answered without a member';
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
    IF SQLERRM LIKE 'issue #4453%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS  T-4b inputs refuse a caller who is not a signed-in member';
END
$t$;
SELECT pg_temp.p_assert(
  (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_plan_preview_inputs' AND pronamespace = 'public'::regnamespace)
    !~* '\m(INSERT|UPDATE|DELETE)\M',
  'T-4c inputs write nothing');

-- T-5 rate limit
SELECT pg_temp.p_assert((public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')->>'allowed')::boolean
    AND (public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')->>'allowed')::boolean
    AND (public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')->>'allowed')::boolean,
  'T-5a three requests in a minute are allowed');
SELECT pg_temp.p_assert(public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')
    = '{"allowed": false, "reason": "minute"}'::jsonb, 'T-5b the 4th in a minute is refused');
SELECT pg_temp.p_assert((public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0002')->>'allowed')::boolean,
  'T-5c another brand is unaffected');
UPDATE public.brand_site_plan_preview_requests SET created_at = now() - interval '2 hours'
WHERE brand_id = '00000000-0000-4000-8000-0000001b0001';
INSERT INTO public.brand_site_plan_preview_requests (brand_id, created_at)
SELECT '00000000-0000-4000-8000-0000001b0001', now() - interval '3 hours' FROM generate_series(1, 17);
SELECT pg_temp.p_assert(public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')
    = '{"allowed": false, "reason": "day"}'::jsonb, 'T-5d the 21st in a day is refused');
INSERT INTO public.brand_site_plan_preview_requests (brand_id, created_at)
VALUES ('00000000-0000-4000-8000-0000001b0002', now() - interval '2 days');
SELECT public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0002');
SELECT pg_temp.p_assert((SELECT count(*) = 0 FROM public.brand_site_plan_preview_requests
    WHERE brand_id = '00000000-0000-4000-8000-0000001b0002' AND created_at < now() - interval '1 day'),
  'T-5e rows older than a day are pruned');

-- T-6 reads only
SELECT pg_temp.p_assert((SELECT count(*) = 1 FROM public.brand_sites WHERE brand_id IN
    ('00000000-0000-4000-8000-0000001b0001', '00000000-0000-4000-8000-0000001b0002')),
  'T-6 the feeds and the rate limit created no site');

ROLLBACK;
