\set ON_ERROR_STOP on

-- Independent tester security-boundary proof for #1974. A client preflight is
-- not an authorization boundary: the authenticated SECURITY DEFINER command
-- itself must refuse pass-tax=true when no fresh provider attestation exists.
BEGIN;

SELECT set_config('request.jwt.claim.sub','19740000-0000-4000-8000-000000000401',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO auth.users(id) VALUES ('19740000-0000-4000-8000-000000000401');
INSERT INTO public.creator_accounts(id) VALUES ('19740000-0000-4000-8000-000000000401');
INSERT INTO public.brands(id,account_id,name,slug,default_currency)
VALUES (
  '19740000-0000-4000-8000-000000000410',
  '19740000-0000-4000-8000-000000000401',
  'Issue 1974 tester tax',
  'issue-1974-tester-tax',
  'EUR'
);
INSERT INTO public.events(
  id,brand_id,title,slug,event_type,status,currency,theme,pass_tax
) VALUES (
  '19740000-0000-4000-8000-000000000420',
  '19740000-0000-4000-8000-000000000410',
  'Tax boundary probe',
  'issue-1974-tax-boundary-probe',
  'event','scheduled','EUR','{}'::jsonb,false
);

DO $$
BEGIN
  BEGIN
    PERFORM public.business_patch_pricing_switches(
      '19740000-0000-4000-8000-000000000420',
      '{"pass_tax":true}'::jsonb
    );
    RAISE EXCEPTION 'tax_registration_direct_rpc_bypass';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tax_registration_required' THEN RAISE; END IF;
  END;
  IF (SELECT pass_tax FROM public.events
      WHERE id='19740000-0000-4000-8000-000000000420') IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'rejected_tax_bypass_mutated_event'; END IF;
END $$;

ROLLBACK;
