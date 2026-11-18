\set ON_ERROR_STOP on
-- #4453 PR 6b: executable PostgreSQL 17 proof that Journal, Grid and Terra are design keys.
-- MINGLA-INVARIANT: I-SITES-DESIGN-KEYS-ONE-LIST | issue #4453 | brand_site_design_keys() equals site-contracts DESIGN_KEYS (generated fixture); 6b replaces only the function.
--
-- T-1 SC-D1   brand_site_design_keys() returns exactly the eight keys through terra (DESIGN_KEYS order)
--             and equals the generated fixture.
-- T-2         still IMMUTABLE SQL returning text[], callable by anon, authenticated and service_role.
-- T-3 SC-D1   the plan CHECK (unchanged, it calls the function) accepts journal, grid, terra and every older key,
--             and still refuses an unknown key (23514).
-- T-4         brand_site_plan_save_design and brand_context_completeness_internal still read the function
--             (6b re-issued neither).
--
-- FAILS-ON-REVERT: drop 20280807034453 -> T-1 (the function still returns five keys) and T-3 (journal is refused).

\ir issue_4453_design_keys.fixture.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.k6b_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 6b design keys FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- #4453 6c: later design batches append keys, so 6b's eight lead the list (6c's suite pins the whole list).
SELECT pg_temp.k6b_assert(
  (public.brand_site_design_keys())[1:8] = ARRAY['atelier','voyage','nocturne','haven','maison','journal','grid','terra']::text[],
  'T-1a brand_site_design_keys() starts with the eight keys, atelier to terra');
SELECT pg_temp.k6b_assert(public.brand_site_design_keys() = :'contract_design_keys'::text[],
  'T-1b brand_site_design_keys() = generated DESIGN_KEYS ' || :'contract_design_keys');

SELECT pg_temp.k6b_assert(
  (SELECT p.provolatile = 'i' AND l.lanname = 'sql' AND p.prorettype = 'text[]'::regtype
     FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = 'public.brand_site_design_keys()'::regprocedure)
  AND has_function_privilege('anon', 'public.brand_site_design_keys()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.brand_site_design_keys()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.brand_site_design_keys()', 'EXECUTE'),
  'T-2 immutable SQL text[], callable by anon, authenticated and service_role');

-- T-3: the real constraint expression, evaluated on a probe table.
CREATE TEMP TABLE k6b_probe (design_key text);
DO $t3$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.brand_site_plans'::regclass AND c.conname = 'brand_site_plans_design_key_check';
  EXECUTE format('ALTER TABLE k6b_probe ADD CONSTRAINT k6b_probe_check %s', v_def);
END
$t3$;
INSERT INTO k6b_probe VALUES ('journal'), ('grid'), ('terra'), ('nocturne'), ('haven'), ('maison'), ('atelier'), ('voyage'), (NULL);
SELECT pg_temp.k6b_assert((SELECT count(*) = 9 FROM k6b_probe), 'T-3a journal, grid, terra, the 6a keys, atelier, voyage and NULL pass the CHECK');
DO $t3b$
BEGIN
  BEGIN
    INSERT INTO k6b_probe VALUES ('not_a_design');
    RAISE EXCEPTION 'issue #4453 6b design keys FAIL: T-3b a key no design has (not_a_design) was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  T-3b a key no design has (not_a_design) is refused (23514)';
  END;
END
$t3b$;

SELECT pg_temp.k6b_assert(
  (SELECT bool_and(p.prosrc LIKE '%brand_site_design_keys()%' AND p.prosrc NOT LIKE '%''journal''%')
     FROM pg_proc p
    WHERE p.oid IN ('public.brand_site_plan_save_design(uuid,integer,text,text,text)'::regprocedure,
                    'public.brand_context_completeness_internal(uuid)'::regprocedure)),
  'T-4 save_design and completeness_internal read the function, no literal list');

ROLLBACK;
