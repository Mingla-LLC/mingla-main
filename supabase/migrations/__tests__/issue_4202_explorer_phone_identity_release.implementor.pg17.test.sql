-- MINGLA-INVARIANT: I-4202-EXPLORER-DELETE-FREES-PHONE | issue #4202 | Explorer deletion removes the GoTrue phone identity and verified-phone ledger while preserving email/social identities and any retained Business login.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id, email, phone)
VALUES (
  '42020000-0000-4000-8000-000000000099',
  'release-4202@example.test',
  '32466178389'
);

INSERT INTO auth.identities(user_id, provider, provider_id, identity_data)
VALUES
  (
    '42020000-0000-4000-8000-000000000099',
    'email',
    'release-4202@example.test',
    '{"email":"release-4202@example.test","email_verified":true}'::jsonb
  ),
  (
    '42020000-0000-4000-8000-000000000099',
    'phone',
    '32466178389',
    '{"phone":"32466178389","phone_verified":true}'::jsonb
  );

INSERT INTO public.verified_phone_identities(user_id, phone_e164)
VALUES (
  '42020000-0000-4000-8000-000000000099',
  '+32466178389'
);

SELECT public.release_explorer_phone_identity(
  '42020000-0000-4000-8000-000000000099'
);

DO $proof$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.identities
    WHERE user_id = '42020000-0000-4000-8000-000000000099'
      AND provider = 'phone'
  ) THEN
    RAISE EXCEPTION '#4202: phone identity survived release';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.identities
    WHERE user_id = '42020000-0000-4000-8000-000000000099'
      AND provider = 'email'
  ) THEN
    RAISE EXCEPTION '#4202: retained email identity was removed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.verified_phone_identities
    WHERE user_id = '42020000-0000-4000-8000-000000000099'
  ) THEN
    RAISE EXCEPTION '#4202: verified-phone ledger survived release';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.release_explorer_phone_identity(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.release_explorer_phone_identity(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION '#4202: client role can release a phone identity';
  END IF;
END;
$proof$;

ROLLBACK;
