\set ON_ERROR_STOP on

-- Implementor happy path: a current provider attestation tied to the brand's
-- still-active Stripe account admits pass-tax=true through both canonical
-- pricing commands, while sparse sibling values remain unchanged.
BEGIN;

SELECT set_config('request.jwt.claim.sub','19740000-0000-4000-8000-000000000501',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO auth.users(id) VALUES ('19740000-0000-4000-8000-000000000501');
INSERT INTO public.creator_accounts(id) VALUES ('19740000-0000-4000-8000-000000000501');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,
  default_pass_tax,default_pass_mingla_fee,default_pass_service_fee
) VALUES (
  '19740000-0000-4000-8000-000000000510',
  '19740000-0000-4000-8000-000000000501',
  'Issue 1974 attested tax',
  'issue-1974-attested-tax',
  'EUR',false,false,true
);
INSERT INTO public.stripe_connect_accounts(
  brand_id,stripe_account_id,charges_enabled,detached_at,country,default_currency
) VALUES (
  '19740000-0000-4000-8000-000000000510',
  'acct_issue1974_attested',true,NULL,'IE','EUR'
);
INSERT INTO public.events(
  id,brand_id,title,slug,event_type,status,currency,theme,
  pass_tax,pass_mingla_fee,pass_service_fee
) VALUES (
  '19740000-0000-4000-8000-000000000520',
  '19740000-0000-4000-8000-000000000510',
  'Attested tax happy path',
  'issue-1974-attested-tax-happy',
  'event','scheduled','EUR','{}'::jsonb,false,NULL,true
);
INSERT INTO public.brand_tax_registration_attestations(
  brand_id,stripe_account_id,has_active_registration,observed_at,source
) VALUES (
  '19740000-0000-4000-8000-000000000510',
  'acct_issue1974_attested',true,clock_timestamp(),
  'brand-tax-registrations-list'
);

SELECT public.business_patch_pricing_switches(
  '19740000-0000-4000-8000-000000000520',
  '{"pass_tax":true}'::jsonb
);
SELECT public.business_patch_brand_pricing_defaults(
  '19740000-0000-4000-8000-000000000510',
  '{"default_pass_tax":true}'::jsonb
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE id='19740000-0000-4000-8000-000000000520'
      AND pass_tax IS TRUE
      AND pass_mingla_fee IS NULL
      AND pass_service_fee IS TRUE
  ) THEN RAISE EXCEPTION 'fresh_event_tax_attestation_not_honored'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands
    WHERE id='19740000-0000-4000-8000-000000000510'
      AND default_pass_tax IS TRUE
      AND default_pass_mingla_fee IS FALSE
      AND default_pass_service_fee IS TRUE
  ) THEN RAISE EXCEPTION 'fresh_brand_tax_attestation_not_honored'; END IF;
  IF has_function_privilege(
    'service_role',
    'public.business_update_live_event(uuid,jsonb,text,integer)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'legacy_ticket_writer_still_externally_reachable'; END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.business_update_live_event_atomic(uuid,jsonb,text,integer)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'canonical_business_atomic_owner_not_reachable'; END IF;
END $$;

ROLLBACK;
