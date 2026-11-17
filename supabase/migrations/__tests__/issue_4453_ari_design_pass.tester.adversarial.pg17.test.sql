\set ON_ERROR_STOP on
-- #4453 milestone 7 tester (adversarial): Ari's design-pass migration
-- (20280728004453) attacked from the angles the implementor's suite does not
-- take. BEGIN ... ROLLBACK: every fixture rolls back.
-- MINGLA-INVARIANT: I-SITES-DESIGN-PASS-SERVICE-ROLE-ONLY | issue #4453 | anon and authenticated cannot EXECUTE brand_site_flag_on / brand_site_compose_facts / brand_site_live_fingerprints / brand_site_record_fingerprint or touch brand_site_flag_brands, even by calling them directly.
--
-- A-1  calling as anon / authenticated is refused at runtime (42501), not just by catalogue privilege;
--      authenticated cannot read, insert or delete allowlist rows.
-- A-2  flag keys are exact: case and whitespace variants are never on, even with both flags on globally.
-- A-3  per brand: allowlisting brand A never turns a flag on for brand B, a NULL brand or the other flag;
--      removing the allowlist row turns it off again; the flag alone (is_enabled) is the only global switch.
-- A-4  the Young and Stamped seed is a no-op without that brand, and a soft-deleted brand with that slug is not seeded.
-- A-5  compose facts carry exactly four keys, no text but this brand's own venue ids, and nothing for a NULL site.
-- A-6  fingerprints: an oversized or wrongly typed fingerprint is refused; a brand's own live site is never in its list;
--      a site whose brand is the caller's is excluded even when published; NULL brand lists every other live site.
--
-- FAILS-ON-REVERT: grant EXECUTE to authenticated on any function -> A-1a; drop `p_flag IN (...)`
-- -> A-2; drop `l.brand_id = p_brand_id` -> A-3a; drop the octet_length guard -> A-6a;
-- drop `bs.brand_id IS DISTINCT FROM p_brand_id` -> A-6b.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 m7 tester FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- Fixtures: two brands with one site each.
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-4000-8000-00000000d001', 'm7-tester@4453.invalid');
INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES ('00000000-0000-4000-8000-00000000d001', now(), now());
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('00000000-0000-4000-8000-0000000d0b01', '00000000-0000-4000-8000-00000000d001', 'M7T Alpha', 'm7t-alpha', 'NGN'),
  ('00000000-0000-4000-8000-0000000d0b02', '00000000-0000-4000-8000-00000000d001', 'M7T Beta', 'm7t-beta', 'NGN');
INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
  ('00000000-0000-4000-8000-0000000d0c01', '00000000-0000-4000-8000-0000000d0b01', 'provisioning', '00000000-0000-4000-8000-00000000d001'),
  ('00000000-0000-4000-8000-0000000d0c02', '00000000-0000-4000-8000-0000000d0b02', 'provisioning', '00000000-0000-4000-8000-00000000d001');

-- A-1 runtime refusal for anon and authenticated
DO $t$
DECLARE
  r text;
  call text;
  refused int := 0;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH call IN ARRAY ARRAY[
      'SELECT public.brand_site_flag_on(''SITES_ARI_DESIGN_PASS'', ''00000000-0000-4000-8000-0000000d0b01'')',
      'SELECT public.brand_site_compose_facts(''00000000-0000-4000-8000-0000000d0c01'')',
      'SELECT public.brand_site_live_fingerprints(''trips'', NULL)',
      'SELECT public.brand_site_record_fingerprint(''00000000-0000-4000-8000-0000000d0c01'', ''{"design":"pulse","format":"trips","home":[]}'')',
      'SELECT count(*) FROM public.brand_site_flag_brands',
      'INSERT INTO public.brand_site_flag_brands(flag_key, brand_id) VALUES (''SITES_ARI_DESIGN_PASS'', ''00000000-0000-4000-8000-0000000d0b02'')',
      'DELETE FROM public.brand_site_flag_brands'
    ] LOOP
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', r);
        EXECUTE call;
        RESET ROLE;
        RAISE EXCEPTION 'issue #4453 m7 tester FAIL: A-1a % was allowed: %', r, call;
      EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        refused := refused + 1;
      END;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.p_assert(refused = 14, 'A-1a anon and authenticated are refused (42501) on all 4 functions and the allowlist');
END
$t$;
SELECT pg_temp.p_assert((SELECT design_fingerprint IS NULL FROM public.brand_sites WHERE id = '00000000-0000-4000-8000-0000000d0c01'),
  'A-1b a refused fingerprint write stored nothing');

-- A-2 exact flag keys
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key IN ('SITES_ARI_DESIGN_PASS', 'SITES_STYLE_LIBRARY');
SELECT pg_temp.p_assert(
  public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000d0b01')
  AND NOT public.brand_site_flag_on('sites_ari_design_pass', '00000000-0000-4000-8000-0000000d0b01')
  AND NOT public.brand_site_flag_on(' SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000d0b01')
  AND NOT public.brand_site_flag_on('SITES_STYLE_LIBRARY ', '00000000-0000-4000-8000-0000000d0b01')
  AND NOT public.brand_site_flag_on(NULL, '00000000-0000-4000-8000-0000000d0b01'),
  'A-2 case and whitespace variants of the flag keys are never on');
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key IN ('SITES_ARI_DESIGN_PASS', 'SITES_STYLE_LIBRARY');

-- A-3 per brand, per flag
INSERT INTO public.brand_site_flag_brands(flag_key, brand_id) VALUES ('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000d0b01');
SELECT pg_temp.p_assert(
  public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000d0b01')
  AND NOT public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000d0b02')
  AND NOT public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', NULL)
  AND NOT public.brand_site_flag_on('SITES_STYLE_LIBRARY', '00000000-0000-4000-8000-0000000d0b01'),
  'A-3a an allowlist row covers one flag for one brand only (not another brand, not NULL, not the other flag)');
DELETE FROM public.brand_site_flag_brands WHERE brand_id = '00000000-0000-4000-8000-0000000d0b01';
SELECT pg_temp.p_assert(NOT public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000d0b01'),
  'A-3b removing the row turns the flag off again');
SELECT pg_temp.p_assert(NOT EXISTS (
    SELECT 1 FROM public.brand_site_flag_brands l JOIN public.brands b ON b.id = l.brand_id
    WHERE b.slug IS DISTINCT FROM 'youngandstamped'),
  'A-3c after replay the allowlist holds nothing but Young and Stamped');

-- A-4 the seed is slug-exact and skips deleted brands (re-run the seed statement against fixtures)
INSERT INTO public.brands(id, account_id, name, slug, default_currency, deleted_at) VALUES
  ('00000000-0000-4000-8000-0000000d0b03', '00000000-0000-4000-8000-00000000d001', 'Gone', 'youngandstamped', 'NGN', now()),
  ('00000000-0000-4000-8000-0000000d0b04', '00000000-0000-4000-8000-00000000d001', 'Near miss', 'young-and-stamped', 'NGN', NULL);
INSERT INTO public.brand_site_flag_brands (flag_key, brand_id)
SELECT f.flag_key, b.id FROM public.brands b
CROSS JOIN (VALUES ('SITES_ARI_DESIGN_PASS'), ('SITES_STYLE_LIBRARY')) AS f(flag_key)
WHERE b.slug = 'youngandstamped' AND b.deleted_at IS NULL
ON CONFLICT (flag_key, brand_id) DO NOTHING;
SELECT pg_temp.p_assert(NOT EXISTS (SELECT 1 FROM public.brand_site_flag_brands
    WHERE brand_id IN ('00000000-0000-4000-8000-0000000d0b03', '00000000-0000-4000-8000-0000000d0b04')),
  'A-4 the seed matches the exact slug only and never a deleted brand');

-- A-5 compose facts shape
SELECT pg_temp.p_assert(public.brand_site_compose_facts(NULL) IS NULL, 'A-5a a NULL site answers NULL');
SELECT pg_temp.p_assert(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.brand_site_compose_facts('00000000-0000-4000-8000-0000000d0c01')) k)
    = ARRAY['live_stay_offerings', 'mingla_reviews', 'published_menu', 'venues']
  AND public.brand_site_compose_facts('00000000-0000-4000-8000-0000000d0c01')::text !~* 'm7t|alpha|beta|@|ngn',
  'A-5b exactly four keys and no brand name, slug, email or currency');

-- A-6 fingerprints
SELECT pg_temp.p_assert(
  NOT public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000d0c01',
    jsonb_build_object('design', 'voyage', 'format', 'trips', 'home', '[]'::jsonb, 'pad', repeat('x', 5000)))
  AND NOT public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000d0c01', '{"design":1,"format":"trips","home":[]}')
  AND NOT public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000d0c01', '{"design":"voyage","format":"trips","home":"hero"}')
  AND NOT public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000d0c01', '[]'),
  'A-6a oversized and wrongly typed fingerprints are refused');
SELECT pg_temp.p_assert((SELECT design_fingerprint IS NULL FROM public.brand_sites WHERE id = '00000000-0000-4000-8000-0000000d0c01'),
  'A-6a refused fingerprints stored nothing');
SELECT pg_temp.p_assert(
  public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000d0c01', '{"design":"voyage","format":"trips","home":["hero:a"]}')
  AND public.brand_site_record_fingerprint('00000000-0000-4000-8000-0000000d0c02', '{"design":"terra","format":"trips","home":["hero:b"]}'),
  'A-6 fixture fingerprints stored');
UPDATE public.brand_sites SET last_successful_publication_id = gen_random_uuid()
WHERE id IN ('00000000-0000-4000-8000-0000000d0c01', '00000000-0000-4000-8000-0000000d0c02');
SELECT pg_temp.p_assert(
  NOT public.brand_site_live_fingerprints('trips', '00000000-0000-4000-8000-0000000d0b01') @> '[{"design":"voyage","home":["hero:a"]}]'
  AND public.brand_site_live_fingerprints('trips', '00000000-0000-4000-8000-0000000d0b01') @> '[{"design":"terra","home":["hero:b"]}]',
  'A-6b a brand never sees its own live look, and does see the other brand''s');
SELECT pg_temp.p_assert(
  public.brand_site_live_fingerprints('trips', NULL) @> '[{"design":"voyage","home":["hero:a"]},{"design":"terra","home":["hero:b"]}]'
  AND public.brand_site_live_fingerprints('Trips', NULL) = '[]'::jsonb
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.brand_site_live_fingerprints('trips', NULL)) e
                  WHERE e::text ~ '0000000d0b0|0000000d0c0'),
  'A-6c NULL brand lists every live look; the format is exact; no brand or site id leaves');

ROLLBACK;
