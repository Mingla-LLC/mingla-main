-- #3645 reviewed Paystack installment activation (PG17, BEGIN ... ROLLBACK).
-- MINGLA-INVARIANT: I-3645-PAYSTACK-INSTALLMENTS-ACTIVE | issue #3645 | Public and authoring capability for Paystack trip installments is true only through this service-role-only switch; provider TEST checkout plus reusable-card charge proof and Seth's activation approval gate production apply.

BEGIN;

DO $test$
DECLARE
  v_owner uuid := '36450000-0000-4000-8000-000000000201';
  v_brand uuid := '36450000-0000-4000-8000-000000000202';
  v_event uuid := '36450000-0000-4000-8000-000000000203';
BEGIN
  IF public.issue_3645_paystack_installments_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'Paystack installment activation switch is not true';
  END IF;
  IF has_function_privilege('anon',
      'public.issue_3645_paystack_installments_enabled()', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.issue_3645_paystack_installments_enabled()', 'EXECUTE')
    OR NOT has_function_privilege('service_role',
      'public.issue_3645_paystack_installments_enabled()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Paystack installment activation ACL drifted';
  END IF;

  INSERT INTO auth.users(id, email) VALUES (v_owner, 'activation-3645@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'activation-3645@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider,
    pricing_region, pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Activation 3645', 'activation-3645', 'paystack',
    'NG', 'NGN', 'NGN'
  );
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type,
    status, visibility, timezone, currency
  ) VALUES (
    v_event, v_brand, v_owner, 'Activation trip', 'activation-trip-3645',
    'trip', 'draft', 'hidden', 'Africa/Lagos', 'NGN'
  );

  IF public.pg_trip_installments_supported(v_event) IS NOT TRUE THEN
    RAISE EXCEPTION 'Paystack trip did not inherit the active switch';
  END IF;
  IF public.pg_trip_installments_supported(gen_random_uuid()) IS NOT FALSE
    OR public.pg_trip_installments_supported(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'unknown trip capability did not fail closed';
  END IF;
END;
$test$;

ROLLBACK;
