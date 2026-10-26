-- Issue #4114: the undo-action functions are server-only.
--
-- No app, web surface or edge function calls public.execute_undo_action or
-- public.get_undo_actions, so signed-in clients no longer get EXECUTE on them;
-- service_role keeps it. Anon was already revoked by 20270104000000.
--
-- Idempotent: every statement can run twice.

BEGIN;

DO $restrict$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.execute_undo_action(text, uuid)',
    'public.get_undo_actions(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE NOTICE '#4114: % not present; nothing to restrict', fn;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);

    IF has_function_privilege('authenticated', fn, 'EXECUTE')
       OR has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#4114 assert failed: a client role can still EXECUTE %', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#4114 assert failed: service_role cannot EXECUTE %', fn;
    END IF;
  END LOOP;
END
$restrict$;

NOTIFY pgrst, 'reload schema';

COMMIT;
