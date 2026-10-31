-- Issue #4202 release-gate repair.
--
-- GoTrue currently answers a service-role `{ phone: "" }` update with 200 but
-- leaves auth.users.phone populated. The deletion boundary then reads the row
-- back and correctly refuses to claim success. Move the authoritative phone
-- detach into the same service-role-only database function that already owns
-- the phone identity and verified-possession cleanup, making retries safe.

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
  v_user_rows integer := 0;
  v_identity_rows integer := 0;
  v_ledger_rows integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'release_explorer_phone_identity requires p_user_id';
  END IF;

  -- The full-history CI auth stub intentionally omits GoTrue-owned phone
  -- columns, so keep their reference dynamic. Production GoTrue owns all five
  -- columns and the UPDATE runs there as the SECURITY DEFINER owner.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'phone'
  ) THEN
    EXECUTE $sql$
      UPDATE auth.users
      SET phone = NULL,
          phone_confirmed_at = NULL,
          phone_change = NULL,
          phone_change_token = NULL,
          phone_change_sent_at = NULL,
          updated_at = now()
      WHERE id = $1
        AND (
          phone IS NOT NULL
          OR phone_confirmed_at IS NOT NULL
          OR phone_change IS NOT NULL
          OR phone_change_token IS NOT NULL
          OR phone_change_sent_at IS NOT NULL
        )
    $sql$ USING p_user_id;
    GET DIAGNOSTICS v_user_rows = ROW_COUNT;
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
    'user_rows', v_user_rows,
    'identity_rows', v_identity_rows,
    'ledger_rows', v_ledger_rows
  );
END;
$function$;

COMMENT ON FUNCTION public.release_explorer_phone_identity(uuid) IS
  '#4202: service-role-only Explorer-deletion boundary. Clears auth.users phone and pending-phone state, removes only the provider=phone identity and verified-phone possession row, and preserves email/social identities plus every Business-side row. Retry-safe.';

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

  IF position(
    'UPDATE auth.users'
    IN pg_get_functiondef(
      'public.release_explorer_phone_identity(uuid)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION '#4202 verify: auth.users phone release is absent';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
