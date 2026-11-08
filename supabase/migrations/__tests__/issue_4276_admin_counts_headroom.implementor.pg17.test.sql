-- Issue #4276 (counts headroom): implementor proof for
-- 20280504004276_issue_4276_admin_counts_headroom.sql.
--
-- MINGLA-INVARIANT: I-4276-ADMIN-COUNTS-HEADROOM | issue #4276 | The Pipeline tab's two heavy admin counts carry a 20s statement_timeout of their own, so they don't fail at the authenticated role's 8s limit
--
--   T-FUNNEL  admin_place_pipeline_funnel(uuid) has statement_timeout=20s and keeps its search_path
--   T-REDO    admin_place_pipeline_redo_counts() has statement_timeout=20s and keeps its search_path
--   T-GRANTS  anon still cannot execute either; authenticated still can
--
-- Fails on revert: without the migration neither function's proconfig carries statement_timeout.

DO $$
DECLARE
  v_cfg text[];
BEGIN
  SELECT proconfig INTO v_cfg FROM pg_proc WHERE oid = 'public.admin_place_pipeline_funnel(uuid)'::regprocedure;
  IF v_cfg IS NULL OR NOT ('statement_timeout=20s' = ANY (v_cfg)) THEN
    RAISE EXCEPTION 'T-FUNNEL: admin_place_pipeline_funnel lacks statement_timeout=20s: %', v_cfg;
  END IF;
  IF NOT (EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%')) THEN
    RAISE EXCEPTION 'T-FUNNEL: admin_place_pipeline_funnel lost its search_path: %', v_cfg;
  END IF;

  SELECT proconfig INTO v_cfg FROM pg_proc WHERE oid = 'public.admin_place_pipeline_redo_counts()'::regprocedure;
  IF v_cfg IS NULL OR NOT ('statement_timeout=20s' = ANY (v_cfg)) THEN
    RAISE EXCEPTION 'T-REDO: admin_place_pipeline_redo_counts lacks statement_timeout=20s: %', v_cfg;
  END IF;
  IF NOT (EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%')) THEN
    RAISE EXCEPTION 'T-REDO: admin_place_pipeline_redo_counts lost its search_path: %', v_cfg;
  END IF;

  IF has_function_privilege('anon', 'public.admin_place_pipeline_funnel(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.admin_place_pipeline_redo_counts()', 'execute') THEN
    RAISE EXCEPTION 'T-GRANTS: anon can execute an admin count';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_place_pipeline_funnel(uuid)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.admin_place_pipeline_redo_counts()', 'execute') THEN
    RAISE EXCEPTION 'T-GRANTS: authenticated lost execute on an admin count';
  END IF;

  RAISE NOTICE 'issue_4276_admin_counts_headroom: all checks passed';
END
$$;
