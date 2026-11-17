-- Issue #4453 PR 6b (designs: Journal, Grid, Terra): the website design keys grow by three.
--
-- MINGLA-INVARIANT: I-SITES-DESIGN-KEYS-ONE-LIST | issue #4453 | design keys come from
-- packages/site-contracts DESIGN_KEYS; brand_site_design_keys() is the one Core list (the
-- plan CHECK, brand_site_plan_save_design and brand_context_completeness_internal read it),
-- pinned to the generated fixture by issue_4453_design_keys.implementor.pg17.test.sql.
--
-- What changes: public.brand_site_design_keys() is replaced (never edited) to return
-- atelier, voyage, nocturne, haven, maison, journal, grid and terra, in DESIGN_KEYS order.
-- Nothing else: the CHECK and both functions already call it (20280725004453). Static SQL
-- only. No data changes: the list only grows, so every stored design_key still passes the CHECK.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.brand_site_design_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['atelier','voyage','nocturne','haven','maison','journal','grid','terra']::text[]
$function$;

COMMENT ON FUNCTION public.brand_site_design_keys() IS
  '#4453 I-SITES-DESIGN-KEYS-ONE-LIST: the website design keys, equal to site-contracts DESIGN_KEYS. Replaced (never edited) by each design PR; 6b adds journal, grid and terra.';

REVOKE ALL ON FUNCTION public.brand_site_design_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.brand_site_design_keys() TO anon, authenticated, service_role;

COMMIT;
