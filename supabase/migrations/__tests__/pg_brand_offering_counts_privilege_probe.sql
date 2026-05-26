-- META-ORCH-0972 Sub-D grant rework live/local privilege probe.
-- Expected row after migration:
-- anon_can_execute = false, authenticated_can_execute = true

SELECT
  has_function_privilege(
    'anon',
    'public.pg_brand_offering_counts(uuid)',
    'execute'
  ) AS anon_can_execute,
  has_function_privilege(
    'authenticated',
    'public.pg_brand_offering_counts(uuid)',
    'execute'
  ) AS authenticated_can_execute;
