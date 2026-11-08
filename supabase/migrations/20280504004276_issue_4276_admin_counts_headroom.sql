-- Issue #4276: give the two Place pool > Pipeline counts room to finish.
--
-- Admin calls through PostgREST run as `authenticated`, whose statement_timeout is 8s.
-- In production (2026-11-08, pg_stat_statements) admin_place_pipeline_redo_counts()
-- averaged about 6.0s with a 7.2s worst case, and admin_place_pipeline_funnel(uuid)
-- averaged about 2.5s with a 5.9s worst case. Right after Abuja's 4,133 new places
-- landed, the first load of the Pipeline tab failed with "canceling statement due to
-- statement timeout" and only loaded on Try again. Both counts grow with the place pool.
--
-- A function-level SET statement_timeout applies to RPC calls made through the Data API
-- (Supabase docs, Database > Timeouts > Function level). This raises the ceiling for these
-- two admin-only reads to 20s and changes nothing else: same body, grants and search_path.
--
-- Rollback:
--   ALTER FUNCTION public.admin_place_pipeline_funnel(uuid) RESET statement_timeout;
--   ALTER FUNCTION public.admin_place_pipeline_redo_counts() RESET statement_timeout;

ALTER FUNCTION public.admin_place_pipeline_funnel(uuid) SET statement_timeout = '20s';
ALTER FUNCTION public.admin_place_pipeline_redo_counts() SET statement_timeout = '20s';
