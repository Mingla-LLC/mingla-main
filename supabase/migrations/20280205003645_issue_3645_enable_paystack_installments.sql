BEGIN;
SET LOCAL lock_timeout = '10s';

-- MINGLA-INVARIANT: I-3645-PAYSTACK-INSTALLMENTS-ACTIVE | issue #3645 | public and authoring capability for Paystack trip installments is true only through this service-role-only switch; provider TEST checkout plus reusable-card charge proof and Seth's activation approval gate production apply
CREATE OR REPLACE FUNCTION public.issue_3645_paystack_installments_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$ SELECT true $fn$;

REVOKE ALL ON FUNCTION public.issue_3645_paystack_installments_enabled()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_paystack_installments_enabled()
  TO service_role;
COMMENT ON FUNCTION public.issue_3645_paystack_installments_enabled() IS
  'Issue #3645: Paystack trip payment plans are active after the reviewed TEST-provider checkout and reusable-card charge proof. Service-role authority only.';

COMMIT;
