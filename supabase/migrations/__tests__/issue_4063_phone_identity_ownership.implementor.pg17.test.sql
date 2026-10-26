-- Issue #4063 — phone onboarding must fail closed across every durable owner.
--
-- MINGLA-INVARIANT: I-4063-PHONE-OWNER-FAIL-CLOSED | issue #4063 | phone onboarding refuses a number owned by another account in profiles, the verified-phone ledger, or GoTrue; incomplete ownership reads never fall through to OTP

\set ON_ERROR_STOP on
BEGIN;

-- [TEST-MOD-APPROVED #4063] The repository replay uses a reduced auth.users
-- fixture while production GoTrue owns this column. Model that production
-- authority inside this rolled-back test transaction before exercising it.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE OR REPLACE FUNCTION pg_temp.i4063_phone_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4063 phone owner FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS %', p_label;
END $$;

DO $fixture$
DECLARE
  v_profile uuid := '40630000-0000-4000-8000-000000009101';
  v_ledger uuid := '40630000-0000-4000-8000-000000009102';
  v_auth uuid := '40630000-0000-4000-8000-000000009103';
BEGIN
  INSERT INTO auth.users(id, email, phone) VALUES
    (v_profile, 'phone-profile-4063@example.test', NULL),
    (v_ledger, 'phone-ledger-4063@example.test', NULL),
    (v_auth, 'phone-auth-4063@example.test', '12025559103');

  INSERT INTO public.profiles(id, email, phone) VALUES
    (v_profile, 'phone-profile-4063@example.test', '+12025559101'),
    (v_ledger, 'phone-ledger-4063@example.test', NULL),
    (v_auth, 'phone-auth-4063@example.test', NULL)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    phone = EXCLUDED.phone;

  INSERT INTO public.verified_phone_identities(user_id, phone_e164)
  VALUES (v_ledger, '+12025559102');
END;
$fixture$;

DO $test$
DECLARE
  v_profile uuid := '40630000-0000-4000-8000-000000009101';
  v_ledger uuid := '40630000-0000-4000-8000-000000009102';
  v_auth uuid := '40630000-0000-4000-8000-000000009103';
  v_sources text[];
  v_err text;
BEGIN
  SELECT owner_sources INTO v_sources
    FROM public.phone_identity_owners('+12025559101')
   WHERE owner_user_id = v_profile;
  PERFORM pg_temp.i4063_phone_assert(
    v_sources = ARRAY['profile']::text[],
    'P1 profiles.phone is an ownership authority'
  );

  SELECT owner_sources INTO v_sources
    FROM public.phone_identity_owners('+12025559102')
   WHERE owner_user_id = v_ledger;
  PERFORM pg_temp.i4063_phone_assert(
    v_sources = ARRAY['verified_phone_identity']::text[],
    'P2 the verified-phone possession ledger is an ownership authority'
  );

  SELECT owner_sources INTO v_sources
    FROM public.phone_identity_owners('+12025559103')
   WHERE owner_user_id = v_auth;
  PERFORM pg_temp.i4063_phone_assert(
    v_sources = ARRAY['auth_user']::text[],
    'P3 bare GoTrue phones normalize to E.164 and remain owners'
  );

  UPDATE public.profiles SET phone = '+12025559102' WHERE id = v_ledger;
  SELECT owner_sources INTO v_sources
    FROM public.phone_identity_owners('+12025559102')
   WHERE owner_user_id = v_ledger;
  PERFORM pg_temp.i4063_phone_assert(
    v_sources = ARRAY['profile','verified_phone_identity']::text[],
    'P4 one user is returned once with every owning source'
  );

  BEGIN
    PERFORM public.phone_identity_owners('12025559103');
    RAISE EXCEPTION 'invalid phone unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.i4063_phone_assert(
    v_err = 'phone_invalid',
    'P5 the ownership authority rejects non-E.164 input'
  );

  PERFORM pg_temp.i4063_phone_assert(
    NOT has_function_privilege('anon', 'public.phone_identity_owners(text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.phone_identity_owners(text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.phone_identity_owners(text)', 'EXECUTE'),
    'P6 only service_role may inspect cross-account phone ownership'
  );
END;
$test$;

ROLLBACK;
