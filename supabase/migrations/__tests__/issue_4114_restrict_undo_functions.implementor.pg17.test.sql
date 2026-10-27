\set ON_ERROR_STOP on

-- Issue #4114: the undo-action functions are server-only.
--
--   U-01  authenticated and anon cannot EXECUTE public.execute_undo_action or
--         public.get_undo_actions (catalog check and a real call, 42501).
--   U-02  service_role can still EXECUTE both.
--
-- FAILS-ON-REVERT: drop 20271230054114_issue_4114_restrict_undo_functions.sql
-- from the chain (authenticated keeps the EXECUTE granted by 20270104000000)
-- and U-01 fails.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

DO $u01$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.execute_undo_action(text, uuid)',
    'public.get_undo_actions(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE EXCEPTION 'U-01: % missing from the replayed chain', fn;
    END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'U-01: authenticated can EXECUTE %', fn;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'U-01: anon can EXECUTE %', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'U-02: service_role cannot EXECUTE %', fn;
    END IF;
  END LOOP;
END $u01$;

SELECT set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $u01_call$
DECLARE
  v_refused integer := 0;
BEGIN
  BEGIN
    PERFORM public.get_undo_actions(gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  BEGIN
    PERFORM public.execute_undo_action('x', gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  IF v_refused <> 2 THEN
    RAISE EXCEPTION 'U-01: an authenticated call was not refused (% of 2 refused)', v_refused;
  END IF;
END $u01_call$;
RESET ROLE;

SELECT 'issue_4114_restrict_undo_functions: U-01..U-02 PASS' AS result;

ROLLBACK;
