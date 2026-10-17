-- Issue #3645 — paid-without-ticket finder uses the canonical full-admin guard.
-- Runs after the complete migration replay and rolls every fixture back.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_admin constant uuid := '36450000-0000-4000-a100-000000000101';
  v_user  constant uuid := '36450000-0000-4000-a100-000000000102';
  v_source text;
  v_count int;
BEGIN
  SELECT p.prosrc INTO v_source
    FROM pg_proc p
   WHERE p.oid = 'public.admin_list_paid_without_ticket(int)'::regprocedure;

  IF v_source !~ 'public\.is_admin_user\(\)'
     OR v_source ~ 'public\.is_admin\(\)' THEN
    RAISE EXCEPTION 'issue_3645_paid_without_ticket_guard_wrong_%', v_source;
  END IF;

  IF has_function_privilege('anon', 'public.admin_list_paid_without_ticket(int)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_list_paid_without_ticket(int)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_list_paid_without_ticket(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_paid_without_ticket_acl_wrong';
  END IF;

  INSERT INTO auth.users(id, email) VALUES
    (v_admin, 'admin-3645-paid-without-ticket@example.test'),
    (v_user, 'user-3645-paid-without-ticket@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3645-paid-without-ticket@example.test', 'admin', 'active');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT count(*) INTO v_count FROM public.admin_list_paid_without_ticket(1);
  IF v_count < 0 THEN
    RAISE EXCEPTION 'issue_3645_paid_without_ticket_admin_bad_count_%', v_count;
  END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    PERFORM * FROM public.admin_list_paid_without_ticket(1);
    RAISE EXCEPTION 'issue_3645_paid_without_ticket_non_admin_should_fail';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'not authorized' THEN
      RAISE EXCEPTION 'issue_3645_paid_without_ticket_wrong_denial_%', SQLERRM;
    END IF;
  END;
  RESET ROLE;

  RAISE NOTICE 'issue_3645_paid_without_ticket_admin_guard_pass';
END;
$test$;

ROLLBACK;
