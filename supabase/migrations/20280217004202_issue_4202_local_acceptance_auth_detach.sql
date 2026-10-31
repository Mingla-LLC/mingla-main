-- Issue #4202 release-gate repair.
--
-- Explorer deletion removes auth.users only after the account has no active
-- Business side. A retained Local application and its immutable signed
-- agreement previously referenced auth.users with ON DELETE RESTRICT, so one
-- historical Local acceptance could make the otherwise-valid deletion fail.
-- Detach only the deleted login id; retain the application and every signed
-- agreement field as durable audit evidence.

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.local_applications
  DROP CONSTRAINT local_applications_user_id_fkey,
  ALTER COLUMN user_id DROP NOT NULL,
  ADD CONSTRAINT local_applications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.local_agreement_acceptances
  DROP CONSTRAINT local_agreement_acceptances_user_id_fkey,
  ALTER COLUMN user_id DROP NOT NULL,
  ADD CONSTRAINT local_agreement_acceptances_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.issue_4182_local_agreement_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The auth.users foreign-key action is an internal nested trigger. Permit
    -- only that one-field identity detach; direct writes and every legal field
    -- remain immutable.
    IF pg_trigger_depth() > 1
      AND OLD.user_id IS NOT NULL
      AND NEW.user_id IS NULL
      AND (to_jsonb(NEW) - 'user_id')
          IS NOT DISTINCT FROM (to_jsonb(OLD) - 'user_id') THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'local_agreement_acceptance_immutable'
    USING ERRCODE = '55000';
END;
$function$;

COMMENT ON FUNCTION public.issue_4182_local_agreement_immutable() IS
  '#4182/#4202 append-only signature guard. Only the nested auth.users ON DELETE SET NULL action may detach user_id; direct writes, deletes and every signed agreement field remain forbidden.';

DO $verify$
DECLARE
  v_application_delete "char";
  v_acceptance_delete "char";
BEGIN
  SELECT c.confdeltype
    INTO v_application_delete
  FROM pg_constraint c
  WHERE c.conrelid = 'public.local_applications'::regclass
    AND c.conname = 'local_applications_user_id_fkey';

  SELECT c.confdeltype
    INTO v_acceptance_delete
  FROM pg_constraint c
  WHERE c.conrelid = 'public.local_agreement_acceptances'::regclass
    AND c.conname = 'local_agreement_acceptances_user_id_fkey';

  IF v_application_delete IS DISTINCT FROM 'n'
    OR v_acceptance_delete IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION '#4202 verify: Local auth references are not ON DELETE SET NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('local_applications', 'local_agreement_acceptances')
      AND column_name = 'user_id'
      AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION '#4202 verify: Local auth reference remains NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.local_agreement_acceptances'::regclass
      AND tgname = 'issue_4182_local_agreement_immutable'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION '#4202 verify: immutable agreement trigger is absent or disabled';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
