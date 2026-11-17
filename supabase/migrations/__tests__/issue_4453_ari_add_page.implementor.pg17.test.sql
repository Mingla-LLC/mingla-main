\set ON_ERROR_STOP on
-- #4453 milestone 11: executable PostgreSQL 17 proof of the "Add a page with
-- Ari" flag migration (20280803004453). BEGIN ... ROLLBACK: fixtures roll back.
-- MINGLA-INVARIANT: I-SITES-ARI-ADD-PAGE-FLAG-PER-BRAND | issue #4453 | SITES_ARI_ADD_PAGE is seeded off with no brand allowlisted; brand_site_flag_on is true for it only when the flag is on or the brand is in brand_site_flag_brands; read by service role only; the milestone 7 flags read as before.
--
-- T-1  grants and shape: service role only; SECURITY DEFINER; search_path set; static SQL.
-- T-2  SITES_ARI_ADD_PAGE seeded off; no brand is allowlisted for it by the migration.
-- T-3  off for every brand; on for an allowlisted brand only; on for all when the flag is on.
-- T-4  the milestone 7 flags are unchanged; an unknown key is false and is refused by the allowlist.
-- T-5  the three Ari-page content actions sit at the content minimum (20); other ranks are unchanged.
--
-- FAILS-ON-REVERT: drop 20280803004453 -> T-2a (no flag row) and T-3b (allowlist insert refused);
-- drop the new key from brand_site_flag_on -> T-3b; drop the three actions from min_rank -> T-5a.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 add page FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- T-1
SELECT pg_temp.p_assert(NOT has_function_privilege('authenticated', 'public.brand_site_flag_on(text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.brand_site_flag_on(text,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.brand_site_flag_on(text,uuid)', 'EXECUTE'),
  'T-1a the flag read is service-role only');
SELECT pg_temp.p_assert(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
    AND p.prosrc !~* '\mEXECUTE\M' AND p.prosrc ~ 'SITES_ARI_ADD_PAGE',
  'T-1b SECURITY DEFINER, explicit search_path, static SQL, knows SITES_ARI_ADD_PAGE')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'brand_site_flag_on';

-- T-2
SELECT pg_temp.p_assert((SELECT count(*) = 1 AND bool_and(NOT is_enabled) FROM public.feature_flags WHERE flag_key = 'SITES_ARI_ADD_PAGE'),
  'T-2a SITES_ARI_ADD_PAGE seeded off');
SELECT pg_temp.p_assert(NOT EXISTS (SELECT 1 FROM public.brand_site_flag_brands WHERE flag_key = 'SITES_ARI_ADD_PAGE'),
  'T-2b no brand allowlisted by the migration');

-- Fixtures
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-4000-8000-00000000b011', 'm11-owner@4453.invalid');
INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES ('00000000-0000-4000-8000-00000000b011', now(), now());
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('00000000-0000-4000-8000-0000000b1101', '00000000-0000-4000-8000-00000000b011', 'M11 Alpha', 'm11-alpha', 'NGN'),
  ('00000000-0000-4000-8000-0000000b1102', '00000000-0000-4000-8000-00000000b011', 'M11 Beta', 'm11-beta', 'NGN');

-- T-3
SELECT pg_temp.p_assert(NOT public.brand_site_flag_on('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000b1101')
    AND NOT public.brand_site_flag_on('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000b1102'),
  'T-3a off for every brand');
INSERT INTO public.brand_site_flag_brands (flag_key, brand_id) VALUES ('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000b1101');
SELECT pg_temp.p_assert(public.brand_site_flag_on('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000b1101')
    AND NOT public.brand_site_flag_on('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000b1102'),
  'T-3b on for the allowlisted brand only');
SELECT pg_temp.p_assert(NOT public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000b1101'),
  'T-3c the add-page allowlist row does not switch on another flag');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_ARI_ADD_PAGE';
SELECT pg_temp.p_assert(public.brand_site_flag_on('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000b1102'),
  'T-3d on for every brand when the flag is on');

-- T-4
SELECT pg_temp.p_assert(NOT public.brand_site_flag_on('SITES_PROOF_PART', '00000000-0000-4000-8000-0000000b1101')
    AND NOT public.brand_site_flag_on('NOPE', '00000000-0000-4000-8000-0000000b1101'),
  'T-4a an unknown key is false');
DO $t$
BEGIN
  BEGIN
    INSERT INTO public.brand_site_flag_brands (flag_key, brand_id) VALUES ('SITES_PROOF_PART', '00000000-0000-4000-8000-0000000b1101');
    RAISE EXCEPTION 'issue #4453 add page FAIL: T-4b the allowlist accepted an unknown flag';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  T-4b the allowlist refuses an unknown flag';
  END;
END
$t$;
INSERT INTO public.brand_site_flag_brands (flag_key, brand_id) VALUES ('SITES_STYLE_LIBRARY', '00000000-0000-4000-8000-0000000b1102');
SELECT pg_temp.p_assert(public.brand_site_flag_on('SITES_STYLE_LIBRARY', '00000000-0000-4000-8000-0000000b1102'),
  'T-4c the milestone 7 flags still read through the allowlist');

-- T-5
SELECT pg_temp.p_assert(public.brand_site_content_min_rank('ari_page_answer') = 20
    AND public.brand_site_content_min_rank('ari_page_accept') = 20
    AND public.brand_site_content_min_rank('ari_page_remove') = 20,
  'T-5a the Ari-page content actions are at the content minimum');
SELECT pg_temp.p_assert(public.brand_site_content_min_rank('mark_reviewed') = 20
    AND public.brand_site_content_min_rank('confirm_review') = 50
    AND public.brand_site_content_min_rank('set_offering_visibility') = 50
    AND public.brand_site_content_min_rank('ari_page_publish_everything') IS NULL,
  'T-5b every other rank is unchanged; an unknown action has no rank');

ROLLBACK;
