-- Issue #4202 release-gate repair.
--
-- GoTrue's admin update with `{ phone: "" }` clears auth.users.phone but keeps
-- the provider=phone identity. Explorer deletion therefore failed closed at
-- its readback and the number could not become a brand-new registration. This
-- service-role-only boundary removes the GoTrue identity and Mingla's verified
-- possession ledger together; delete-user still clears auth.users.phone first
-- and reads the user back before it reports success.

BEGIN;

CREATE OR REPLACE FUNCTION public.release_explorer_phone_identity(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_identity_rows integer := 0;
  v_ledger_rows integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'release_explorer_phone_identity requires p_user_id';
  END IF;

  DELETE FROM auth.identities
  WHERE user_id = p_user_id
    AND provider = 'phone';
  GET DIAGNOSTICS v_identity_rows = ROW_COUNT;

  DELETE FROM public.verified_phone_identities
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_ledger_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'released',
    'identity_rows', v_identity_rows,
    'ledger_rows', v_ledger_rows
  );
END;
$function$;

COMMENT ON FUNCTION public.release_explorer_phone_identity(uuid) IS
  '#4202: service-role-only Explorer-deletion boundary. Removes only the provider=phone GoTrue identity and verified-phone possession row after delete-user clears auth.users.phone; email/social identities and all Business-side rows survive.';

REVOKE ALL ON FUNCTION public.release_explorer_phone_identity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_explorer_phone_identity(uuid)
  TO service_role;

DO $verify$
BEGIN
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
    RAISE EXCEPTION '#4202 verify: client role can release phone identity';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.release_explorer_phone_identity(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION '#4202 verify: service_role cannot release phone identity';
  END IF;
END;
$verify$;

COMMIT;
