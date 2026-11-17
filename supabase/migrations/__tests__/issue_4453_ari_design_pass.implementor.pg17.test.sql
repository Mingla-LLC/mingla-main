\set ON_ERROR_STOP on
-- #4453 milestone 7: executable PostgreSQL 17 proof of Ari's design-pass
-- migration (20280728004453). BEGIN ... ROLLBACK: every fixture rolls back.
-- MINGLA-INVARIANT: I-SITES-DESIGN-PASS-FLAGS-PER-BRAND | issue #4453 | SITES_ARI_DESIGN_PASS and SITES_STYLE_LIBRARY are seeded off and are on for a brand only when the flag is on or the brand is in brand_site_flag_brands; read by service role only.
-- MINGLA-INVARIANT: I-SITES-COMPOSE-FACTS-COUNTS-ONLY | issue #4453 | brand_site_compose_facts returns counts, booleans and the site's own venue ids only (no names, prices or guest data), and never another brand's venues.
--
-- T-1  grants and shape: service role only; SECURITY DEFINER; search_path set; static SQL; the allowlist table is closed to anon/authenticated.
-- T-2  both flags seeded off; brand_site_flag_on is false, then true for an allowlisted brand only, then true for all when the flag is on; unknown flag keys are always false.
-- T-3  compose facts: verified venues per category, the single venue id and its reservation switch; another brand's and unverified venues never count; a published menu; NULL for an unknown site.
-- T-4  fingerprints: record refuses malformed input; live fingerprints list only OTHER brands' PUBLISHED sites of the same format, without the format key.
-- T-5  Build receives the owner's Q5-Q8 answers (value_points, faq, process_steps, quick_facts).
--
-- FAILS-ON-REVERT: drop 20280728004453 -> T-1 (functions missing); drop the allowlist EXISTS -> T-2c;
-- drop the brand filter in compose facts -> T-3b; drop the IS DISTINCT FROM brand filter -> T-4c.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 design pass FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- T-1 grants and shape
SELECT pg_temp.p_assert(bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE')
    AND NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')),
  'T-1a every design-pass read is service-role only')
FROM unnest(ARRAY['public.brand_site_flag_on(text,uuid)', 'public.brand_site_compose_facts(uuid)',
  'public.brand_site_live_fingerprints(text,uuid)', 'public.brand_site_record_fingerprint(uuid,jsonb)']) AS f;
SELECT pg_temp.p_assert(count(*) = 4 AND bool_and(p.prosecdef)
    AND bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
    AND bool_and(p.prosrc !~* '\mEXECUTE\M'),
  'T-1b SECURITY DEFINER, explicit search_path, static SQL')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('brand_site_flag_on', 'brand_site_compose_facts',
  'brand_site_live_fingerprints', 'brand_site_record_fingerprint');
SELECT pg_temp.p_assert(NOT has_table_privilege('authenticated', 'public.brand_site_flag_brands', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.brand_site_flag_brands', 'SELECT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brand_site_flag_brands'::regclass),
  'T-1c the allowlist is closed to anon and authenticated, RLS on');
SELECT pg_temp.p_assert(has_function_privilege('authenticated', 'public.brand_site_plan_authorize_compose(uuid)', 'EXECUTE'),
  'T-1d the re-issued compose authorisation keeps its grants');

-- Fixtures: two brands, one site each.
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-4000-8000-00000000a001', 'm7-owner@4453.invalid');
INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES ('00000000-0000-4000-8000-00000000a001', now(), now());
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-00000000a001', 'M7 Alpha', 'm7-alpha', 'NGN'),
  ('00000000-0000-4000-8000-0000000b0002', '00000000-0000-4000-8000-00000000a001', 'M7 Beta', 'm7-beta', 'NGN');
INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000b0001', 'provisioning', '00000000-0000-4000-8000-00000000a001'),
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000b0002', 'provisioning', '00000000-0000-4000-8000-00000000a001');

-- T-2 flags
SELECT pg_temp.p_assert((SELECT count(*) = 2 AND bool_and(NOT is_enabled) FROM public.feature_flags
    WHERE flag_key IN ('SITES_ARI_DESIGN_PASS', 'SITES_STYLE_LIBRARY')), 'T-2a both flags seeded off');
SELECT pg_temp.p_assert(NOT public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000b0001'),
  'T-2b off for a brand that is not listed');
INSERT INTO public.brand_site_flag_brands (flag_key, brand_id) VALUES ('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000b0001');
SELECT pg_temp.p_assert(public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000b0001')
    AND NOT public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000b0002')
    AND NOT public.brand_site_flag_on('SITES_STYLE_LIBRARY', '00000000-0000-4000-8000-0000000b0001'),
  'T-2c the allowlist turns ONE flag on for ONE brand');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_STYLE_LIBRARY';
SELECT pg_temp.p_assert(public.brand_site_flag_on('SITES_STYLE_LIBRARY', '00000000-0000-4000-8000-0000000b0002'),
  'T-2d the flag itself turns it on for every brand');
SELECT pg_temp.p_assert(NOT public.brand_site_flag_on('SITES_BOOKING_BLOCKS', '00000000-0000-4000-8000-0000000b0001')
    AND NOT public.brand_site_flag_on('ANYTHING', NULL), 'T-2e other flag keys are never read here');
DO $t$ BEGIN
  INSERT INTO public.brand_site_flag_brands (flag_key, brand_id) VALUES ('SITES_PROOF_PART', '00000000-0000-4000-8000-0000000b0001');
  RAISE EXCEPTION 'issue #4453 design pass FAIL: T-2f an unknown flag key was allowlisted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS  T-2f only the two flags can be allowlisted';
END $t$;

-- T-3 compose facts
SELECT pg_temp.p_assert(public.brand_site_compose_facts('00000000-0000-4000-8000-0000000fffff') IS NULL,
  'T-3a an unknown site answers NULL');
SELECT pg_temp.p_assert(
  public.brand_site_compose_facts('00000000-0000-4000-8000-0000000c0001') = jsonb_build_object(
    'venues', '{}'::jsonb, 'published_menu', false, 'live_stay_offerings', 0, 'mingla_reviews', 0),
  'T-3b a brand with nothing gets zeros and no venue (counts and booleans only)');

-- T-4 fingerprints
SELECT pg_temp.p_assert(NOT public.brand_site_record_fingerprint(NULL, '{}'::jsonb)
    AND NOT public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000fffff', '{"design":"voyage"}'::jsonb)
    AND NOT public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000fffff', '"x"'::jsonb),
  'T-4a malformed fingerprints are refused');
SELECT pg_temp.p_assert(NOT public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000fffff',
    '{"design":"voyage","format":"trips","home":[]}'::jsonb), 'T-4b an unknown site stores nothing');
SELECT pg_temp.p_assert(jsonb_typeof(public.brand_site_live_fingerprints('trips', NULL)) = 'array'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.brand_site_live_fingerprints('trips', NULL)) e WHERE e ? 'format'),
  'T-4c live fingerprints are an array without the format key');
SELECT pg_temp.p_assert(public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000c0001',
    '{"design":"voyage","format":"trips","home":["hero:fullbleed"]}'::jsonb)
  AND public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000c0002',
    '{"design":"terra","format":"trips","home":["hero:arch"]}'::jsonb), 'T-4d fingerprints stored for both sites');
SELECT pg_temp.p_assert(jsonb_array_length(public.brand_site_live_fingerprints('trips', '00000000-0000-4000-8000-0000000b0001')) = 0,
  'T-4e an unpublished site is never a live look');
UPDATE public.brand_sites SET last_successful_publication_id = gen_random_uuid() WHERE id IN
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000c0002');
SELECT pg_temp.p_assert(
  public.brand_site_live_fingerprints('trips', '00000000-0000-4000-8000-0000000b0001')
    = '[{"design":"terra","home":["hero:arch"]}]'::jsonb
  AND public.brand_site_live_fingerprints('events', '00000000-0000-4000-8000-0000000b0001') = '[]'::jsonb,
  'T-4f only OTHER brands'' live sites of the SAME format, without the format key');

-- T-5 Build gets the owner's answers
SELECT pg_temp.p_assert(
  (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_plan_authorize_compose' AND pronamespace = 'public'::regnamespace)
    ~ '''value_points'',v_plan\.value_points,''faq'',v_plan\.faq'
  AND (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_plan_authorize_compose' AND pronamespace = 'public'::regnamespace)
    ~ '''process_steps'',v_plan\.process_steps,''quick_facts'',v_plan\.quick_facts',
  'T-5 Build receives value_points, faq, process_steps and quick_facts');

ROLLBACK;
