\set ON_ERROR_STOP on

-- Independent round-two tester proof for #1974. A positive provider
-- attestation is valid only for the exact currently-connected Stripe account
-- and only inside its bounded freshness window. Account rotation, expiry,
-- future-dated observations, and a current negative must all fail closed
-- without mutating the event.
BEGIN;

SELECT set_config('request.jwt.claim.sub','19740000-0000-4000-8000-000000000601',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO auth.users(id) VALUES ('19740000-0000-4000-8000-000000000601');
INSERT INTO public.creator_accounts(id) VALUES ('19740000-0000-4000-8000-000000000601');
INSERT INTO public.brands(id,account_id,name,slug,default_currency)
VALUES (
  '19740000-0000-4000-8000-000000000610',
  '19740000-0000-4000-8000-000000000601',
  'Issue 1974 tester rotation',
  'issue-1974-tester-rotation',
  'EUR'
);
INSERT INTO public.stripe_connect_accounts(
  brand_id,stripe_account_id,charges_enabled,detached_at,country,default_currency
) VALUES (
  '19740000-0000-4000-8000-000000000610',
  'acct_issue1974_original',true,NULL,'IE','EUR'
);
INSERT INTO public.events(
  id,brand_id,title,slug,event_type,status,currency,theme,pass_tax
) VALUES (
  '19740000-0000-4000-8000-000000000620',
  '19740000-0000-4000-8000-000000000610',
  'Tax attestation rotation probe',
  'issue-1974-tax-attestation-rotation',
  'event','scheduled','EUR','{}'::jsonb,false
);
INSERT INTO public.brand_tax_registration_attestations(
  brand_id,stripe_account_id,has_active_registration,observed_at,source
) VALUES (
  '19740000-0000-4000-8000-000000000610',
  'acct_issue1974_original',true,clock_timestamp(),
  'brand-tax-registrations-list'
);

-- Establish that the fixture begins with a usable attestation.
SELECT public.issue_1974_require_fresh_tax_registration(
  '19740000-0000-4000-8000-000000000610'
);

-- Rotate the connected account while the old account's positive attestation
-- remains fresh. The old proof must not transfer to the new money account.
UPDATE public.stripe_connect_accounts
SET stripe_account_id='acct_issue1974_rotated'
WHERE brand_id='19740000-0000-4000-8000-000000000610';

DO $$
BEGIN
  BEGIN
    PERFORM public.business_patch_pricing_switches(
      '19740000-0000-4000-8000-000000000620',
      '{"pass_tax":true}'::jsonb
    );
    RAISE EXCEPTION 'rotated_account_reused_stale_attestation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tax_registration_required' THEN RAISE; END IF;
  END;
  IF (SELECT pass_tax FROM public.events
      WHERE id='19740000-0000-4000-8000-000000000620') IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'account_rotation_rejection_mutated_event'; END IF;
END $$;

UPDATE public.brand_tax_registration_attestations
SET stripe_account_id='acct_issue1974_rotated',
    has_active_registration=true,
    observed_at=clock_timestamp()-interval '6 minutes'
WHERE brand_id='19740000-0000-4000-8000-000000000610';

DO $$
BEGIN
  BEGIN
    PERFORM public.issue_1974_require_fresh_tax_registration(
      '19740000-0000-4000-8000-000000000610'
    );
    RAISE EXCEPTION 'expired_attestation_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tax_registration_required' THEN RAISE; END IF;
  END;
END $$;

UPDATE public.brand_tax_registration_attestations
SET observed_at=clock_timestamp()+interval '31 seconds'
WHERE brand_id='19740000-0000-4000-8000-000000000610';

DO $$
BEGIN
  BEGIN
    PERFORM public.issue_1974_require_fresh_tax_registration(
      '19740000-0000-4000-8000-000000000610'
    );
    RAISE EXCEPTION 'future_attestation_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tax_registration_required' THEN RAISE; END IF;
  END;
END $$;

UPDATE public.brand_tax_registration_attestations
SET has_active_registration=false,
    observed_at=clock_timestamp()
WHERE brand_id='19740000-0000-4000-8000-000000000610';

DO $$
BEGIN
  BEGIN
    PERFORM public.issue_1974_require_fresh_tax_registration(
      '19740000-0000-4000-8000-000000000610'
    );
    RAISE EXCEPTION 'negative_attestation_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tax_registration_required' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
