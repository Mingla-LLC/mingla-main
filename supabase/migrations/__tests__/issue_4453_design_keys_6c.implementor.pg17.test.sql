\set ON_ERROR_STOP on
-- #4453 PR 6c: executable PostgreSQL 17 proof that Pop, Sunset and Pulse are design keys (the list is complete).
-- Invariant I-SITES-DESIGN-KEYS-ONE-LIST (owned by its pg17 test): brand_site_design_keys() equals site-contracts DESIGN_KEYS (generated fixture); 6c replaces only the function.
--
-- T-1 SC-D1   brand_site_design_keys() returns exactly the eleven keys through pulse (DESIGN_KEYS order)
--             and equals the generated fixture.
-- T-2         still IMMUTABLE SQL returning text[], callable by anon, authenticated and service_role.
-- T-3 SC-D1   the plan CHECK (unchanged, it calls the function) accepts pop, sunset, pulse and every older key,
--             and still refuses an unknown key (23514).
-- T-4         brand_site_plan_save_design and brand_context_completeness_internal still read the function
--             (6c re-issued neither).
--
-- FAILS-ON-REVERT: drop 20280807064453 -> T-1 (the function still returns eight keys) and T-3 (pop is refused).

\ir issue_4453_design_keys.fixture.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.k6c_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 6c design keys FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

SELECT pg_temp.k6c_assert(
  public.brand_site_design_keys() = ARRAY['atelier','voyage','nocturne','haven','maison','journal','grid','terra','pop','sunset','pulse']::text[],
  'T-1a brand_site_design_keys() = the eleven keys, atelier to pulse');
SELECT pg_temp.k6c_assert(public.brand_site_design_keys() = :'contract_design_keys'::text[],
  'T-1b brand_site_design_keys() = generated DESIGN_KEYS ' || :'contract_design_keys');

SELECT pg_temp.k6c_assert(
  (SELECT p.provolatile = 'i' AND l.lanname = 'sql' AND p.prorettype = 'text[]'::regtype
     FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = 'public.brand_site_design_keys()'::regprocedure)
  AND has_function_privilege('anon', 'public.brand_site_design_keys()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.brand_site_design_keys()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.brand_site_design_keys()', 'EXECUTE'),
  'T-2 immutable SQL text[], callable by anon, authenticated and service_role');

-- T-3: the real constraint expression, evaluated on a probe table.
CREATE TEMP TABLE k6c_probe (design_key text);
DO $t3$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.brand_site_plans'::regclass AND c.conname = 'brand_site_plans_design_key_check';
  EXECUTE format('ALTER TABLE k6c_probe ADD CONSTRAINT k6c_probe_check %s', v_def);
END
$t3$;
INSERT INTO k6c_probe VALUES ('pop'), ('sunset'), ('pulse'), ('journal'), ('grid'), ('terra'), ('nocturne'), ('haven'), ('maison'), ('atelier'), ('voyage'), (NULL);
SELECT pg_temp.k6c_assert((SELECT count(*) = 12 FROM k6c_probe), 'T-3a pop, sunset, pulse, every earlier key and NULL pass the CHECK');
DO $t3b$
BEGIN
  BEGIN
    INSERT INTO k6c_probe VALUES ('not_a_design');
    RAISE EXCEPTION 'issue #4453 6c design keys FAIL: T-3b a key no design has (not_a_design) was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  T-3b a key no design has (not_a_design) is refused (23514)';
  END;
END
$t3b$;

SELECT pg_temp.k6c_assert(
  (SELECT bool_and(p.prosrc LIKE '%brand_site_design_keys()%' AND p.prosrc NOT LIKE '%''pulse''%')
     FROM pg_proc p
    WHERE p.oid IN ('public.brand_site_plan_save_design(uuid,integer,text,text,text)'::regprocedure,
                    'public.brand_context_completeness_internal(uuid)'::regprocedure)),
  'T-4 save_design and completeness_internal read the function, no literal list');

ROLLBACK;
