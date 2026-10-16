-- #3720 notification reliability follow-up — production retained a direct
-- `anon` EXECUTE grant on create_support_ticket after the function was replaced.
-- Revoking PUBLIC alone does not remove Supabase's direct default-role grant.
--
-- INVARIANT: {"id":"I-3720-SUPPORT-TICKET-AUTH-ONLY","rule":"Only authenticated and service_role may execute create_support_ticket(text,uuid)."}

BEGIN;

REVOKE EXECUTE ON FUNCTION public.create_support_ticket(text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, uuid)
  TO authenticated, service_role;

DO $check$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.create_support_ticket(text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      '#3720 support-ticket lockdown failed: anon retains EXECUTE';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.create_support_ticket(text,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.create_support_ticket(text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      '#3720 support-ticket lockdown failed: intended caller lost EXECUTE';
  END IF;
END;
$check$;

COMMIT;
