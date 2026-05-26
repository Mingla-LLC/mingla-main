-- META-ORCH-0972 Sub-D grant rework
-- pg_brand_offering_counts is owner-side/authenticated-only. Supabase default
-- function grants can leave anon with EXECUTE unless revoked explicitly.

BEGIN;

REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_brand_offering_counts(uuid) TO authenticated;

COMMIT;
