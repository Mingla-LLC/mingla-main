\set ON_ERROR_STOP on

-- PostgreSQL 17 post-replay behavioural proof.
-- MINGLA-INVARIANT: I-4202-EXPLORER-PHONE-RELEASE | issue #4202 | Explorer deletion frees auth.users phone, its pending-phone state, the phone identity and possession ledger in one service-role boundary while preserving email identity; a retry is a no-op.

BEGIN;

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_change text,
  ADD COLUMN IF NOT EXISTS phone_change_token varchar(255),
  ADD COLUMN IF NOT EXISTS phone_change_sent_at timestamptz;

CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  provider_id text NOT NULL,
  identity_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.identities TO postgres;

CREATE TEMP TABLE issue_4202_release_results (
  attempt integer PRIMARY KEY,
  result jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO auth.users(
  id, email, phone, phone_confirmed_at, phone_change,
  phone_change_token, phone_change_sent_at
) VALUES (
  '42020000-0000-4000-8000-000000000209',
  'release-rpc-4202@example.test',
  '32466178389',
  '2026-10-30 12:00:00+00',
  '14155550199',
  'pending-phone-token',
  '2026-10-30 12:05:00+00'
);

INSERT INTO auth.identities(user_id, provider, provider_id, identity_data)
VALUES
  (
    '42020000-0000-4000-8000-000000000209',
    'email',
    'release-rpc-4202@example.test',
    '{"email":"release-rpc-4202@example.test","email_verified":true}'::jsonb
  ),
  (
    '42020000-0000-4000-8000-000000000209',
    'phone',
    '32466178389',
    '{"phone":"32466178389","phone_verified":true}'::jsonb
  );

INSERT INTO public.verified_phone_identities(user_id, phone_e164)
VALUES (
  '42020000-0000-4000-8000-000000000209',
  '+32466178389'
);

INSERT INTO issue_4202_release_results(attempt, result)
SELECT 1, public.release_explorer_phone_identity(
  '42020000-0000-4000-8000-000000000209'
);

INSERT INTO issue_4202_release_results(attempt, result)
SELECT 2, public.release_explorer_phone_identity(
  '42020000-0000-4000-8000-000000000209'
);

DO $proof$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  SELECT result INTO v_first
  FROM issue_4202_release_results
  WHERE attempt = 1;

  SELECT result INTO v_second
  FROM issue_4202_release_results
  WHERE attempt = 2;

  IF (v_first->>'user_rows')::integer <> 1
    OR (v_first->>'identity_rows')::integer <> 1
    OR (v_first->>'ledger_rows')::integer <> 1 THEN
    RAISE EXCEPTION '#4202 first release did not clear every phone authority: %', v_first;
  END IF;

  IF (v_second->>'user_rows')::integer <> 0
    OR (v_second->>'identity_rows')::integer <> 0
    OR (v_second->>'ledger_rows')::integer <> 0 THEN
    RAISE EXCEPTION '#4202 retry was not an idempotent no-op: %', v_second;
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = '42020000-0000-4000-8000-000000000209'
      AND (
        phone IS NOT NULL
        OR phone_confirmed_at IS NOT NULL
        OR phone_change IS NOT NULL
        OR phone_change_token IS NOT NULL
        OR phone_change_sent_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION '#4202 auth.users retained phone authority';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.identities
    WHERE user_id = '42020000-0000-4000-8000-000000000209'
      AND provider = 'phone'
  ) THEN
    RAISE EXCEPTION '#4202 phone identity survived release';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE user_id = '42020000-0000-4000-8000-000000000209'
      AND provider = 'email'
  ) THEN
    RAISE EXCEPTION '#4202 retained email identity was removed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.verified_phone_identities
    WHERE user_id = '42020000-0000-4000-8000-000000000209'
  ) THEN
    RAISE EXCEPTION '#4202 verified-phone ledger survived release';
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
    RAISE EXCEPTION '#4202 client role can release a phone identity';
  END IF;
END;
$proof$;

ROLLBACK;
