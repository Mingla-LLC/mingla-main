-- Issue #4202 production-retest repair.
--
-- GoTrue models its pending-phone text fields with empty-string sentinels.
-- Setting either field to SQL NULL makes otherwise-valid email users unreadable
-- to GoTrue ("Database error finding user"). Keep the released phone authority
-- empty while preserving the representation GoTrue expects.

BEGIN;

DO $repair$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'phone_change_token'
  ) THEN
    EXECUTE $sql$
      UPDATE auth.users
      SET phone_change = COALESCE(phone_change, ''),
          phone_change_token = COALESCE(phone_change_token, ''),
          updated_at = now()
      WHERE phone_change IS NULL
         OR phone_change_token IS NULL
    $sql$;
  END IF;
END;
$repair$;

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
  -- columns, so keep their reference dynamic. NULL is correct for the current
  -- phone/timestamps; GoTrue requires empty strings for its pending text fields.
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
          phone_change = '',
          phone_change_token = '',
          phone_change_sent_at = NULL,
          updated_at = now()
      WHERE id = $1
        AND (
          phone IS NOT NULL
          OR phone_confirmed_at IS NOT NULL
          OR phone_change IS DISTINCT FROM ''
          OR phone_change_token IS DISTINCT FROM ''
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
  '#4202: service-role-only Explorer-deletion boundary. Clears auth.users phone authority using GoTrue-compatible pending-field sentinels, removes only the provider=phone identity and verified-phone possession row, and preserves email/social identities plus every Business-side row. Retry-safe.';

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
    $needle$phone_change = ''$needle$
    IN pg_get_functiondef(
      'public.release_explorer_phone_identity(uuid)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION '#4202 verify: GoTrue pending-phone sentinel is absent';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
