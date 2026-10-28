\set ON_ERROR_STOP on

-- MINGLA-INVARIANT: I-1318-CONFIGURED-VAT-NO-STRIPE-DETOUR | issue #1318 | Paystack may pass configured VAT without Stripe; every Stripe or unconfigured market remains fail-closed on a fresh provider attestation.
BEGIN;

SELECT set_config(
  'request.jwt.claim.sub',
  '13180000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id)
VALUES ('13180000-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id)
VALUES ('13180000-0000-4000-8000-000000000001');

INSERT INTO public.brands(
  id, account_id, name, slug, default_currency,
  payment_provider, payment_country,
  default_pass_tax, default_pass_mingla_fee, default_pass_service_fee
) VALUES
  (
    '13180000-0000-4000-8000-000000000010',
    '13180000-0000-4000-8000-000000000001',
    'Issue 1318 Nigeria', 'issue-1318-nigeria', 'NGN',
    'paystack', 'NG', false, false, false
  ),
  (
    '13180000-0000-4000-8000-000000000011',
    '13180000-0000-4000-8000-000000000001',
    'Issue 1318 Stripe', 'issue-1318-stripe', 'GBP',
    'stripe', 'GB', false, false, false
  ),
  (
    '13180000-0000-4000-8000-000000000012',
    '13180000-0000-4000-8000-000000000001',
    'Issue 1318 unconfigured Paystack', 'issue-1318-unconfigured-paystack', 'GBP',
    'paystack', 'GB', false, false, false
  );

INSERT INTO public.events(
  id, brand_id, title, slug, event_type, status, currency, theme, pass_tax
) VALUES
  (
    '13180000-0000-4000-8000-000000000020',
    '13180000-0000-4000-8000-000000000010',
    'Nigeria configured VAT', 'issue-1318-ng-event',
    'event', 'scheduled', 'NGN', '{}'::jsonb, false
  ),
  (
    '13180000-0000-4000-8000-000000000021',
    '13180000-0000-4000-8000-000000000011',
    'Stripe attestation still required', 'issue-1318-stripe-event',
    'event', 'scheduled', 'GBP', '{}'::jsonb, false
  ),
  (
    '13180000-0000-4000-8000-000000000022',
    '13180000-0000-4000-8000-000000000012',
    'Unconfigured Paystack still fails closed', 'issue-1318-unconfigured-event',
    'event', 'scheduled', 'GBP', '{}'::jsonb, false
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.country_vat_config
    WHERE country = 'NG' AND vat_rate_bps = 750
  ) THEN
    RAISE EXCEPTION 'ng_configured_vat_missing';
  END IF;
END;
$$;

SELECT public.business_patch_pricing_switches(
  '13180000-0000-4000-8000-000000000020',
  '{"pass_tax":true}'::jsonb
);
SELECT public.business_patch_brand_pricing_defaults(
  '13180000-0000-4000-8000-000000000010',
  '{"default_pass_tax":true}'::jsonb
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE id = '13180000-0000-4000-8000-000000000020'
      AND pass_tax IS TRUE
  ) THEN
    RAISE EXCEPTION 'configured_ng_event_vat_was_rejected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands
    WHERE id = '13180000-0000-4000-8000-000000000010'
      AND default_pass_tax IS TRUE
  ) THEN
    RAISE EXCEPTION 'configured_ng_brand_vat_was_rejected';
  END IF;

  BEGIN
    PERFORM public.business_patch_pricing_switches(
      '13180000-0000-4000-8000-000000000021',
      '{"pass_tax":true}'::jsonb
    );
    RAISE EXCEPTION 'stripe_tax_registration_bypass';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tax_registration_required' THEN
      RAISE;
    END IF;
  END;

  IF (
    SELECT pass_tax FROM public.events
    WHERE id = '13180000-0000-4000-8000-000000000021'
  ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'rejected_stripe_tax_write_mutated_event';
  END IF;

  BEGIN
    PERFORM public.business_patch_pricing_switches(
      '13180000-0000-4000-8000-000000000022',
      '{"pass_tax":true}'::jsonb
    );
    RAISE EXCEPTION 'unconfigured_paystack_tax_registration_bypass';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tax_registration_required' THEN
      RAISE;
    END IF;
  END;

  IF (
    SELECT pass_tax FROM public.events
    WHERE id = '13180000-0000-4000-8000-000000000022'
  ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'rejected_unconfigured_paystack_write_mutated_event';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.issue_1974_require_fresh_tax_registration(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'tax_guard_became_client_callable';
  END IF;
END;
$$;

ROLLBACK;
