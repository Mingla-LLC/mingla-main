-- [TEST-MOD-APPROVED #2060]
-- Independent-review truth must not be writable by the certification service.
-- The service role may collect bounded evidence, but it cannot declare the
-- tester verdict through either the completion RPC or a direct table update.
BEGIN;

DO $test$
DECLARE
  v_service_can_complete boolean;
  v_public_can_complete boolean;
  v_service_can_update_run boolean;
BEGIN
  SELECT has_function_privilege(
    'service_role',
    'public.ari_cert_record_completion(uuid,text,text,text,integer)',
    'EXECUTE'
  ) INTO v_service_can_complete;

  SELECT has_function_privilege(
    'public',
    'public.ari_cert_record_completion(uuid,text,text,text,integer)',
    'EXECUTE'
  ) INTO v_public_can_complete;

  SELECT has_table_privilege(
    'service_role',
    'public.ari_cert_runs',
    'UPDATE'
  ) INTO v_service_can_update_run;

  IF v_service_can_complete OR v_public_can_complete OR v_service_can_update_run THEN
    RAISE EXCEPTION
      'issue_2060_independent_verdict_boundary_open: service_execute=%, public_execute=%, service_update=%',
      v_service_can_complete,
      v_public_can_complete,
      v_service_can_update_run;
  END IF;
END;
$test$;

ROLLBACK;
