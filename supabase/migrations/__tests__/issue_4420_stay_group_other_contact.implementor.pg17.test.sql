\set ON_ERROR_STOP on
-- #4420 wave 2 (D-S7): the masked contact of a Stay group is readable by the
-- service role only, and never returns more than "first char ••• @domain".
BEGIN;

DO $$
BEGIN
  IF public.issue_4420_mask_email('guest.glassstay@example.com') <> 'g•••@example.com' THEN
    RAISE EXCEPTION 'mask: expected g•••@example.com, got %',
      public.issue_4420_mask_email('guest.glassstay@example.com');
  END IF;
  IF public.issue_4420_mask_email('  Ada@Mingla.test ') <> 'A•••@Mingla.test' THEN
    RAISE EXCEPTION 'mask: surrounding spaces must be trimmed';
  END IF;
  IF public.issue_4420_mask_email('not-an-email') IS NOT NULL THEN
    RAISE EXCEPTION 'mask: a value without @ must be NULL';
  END IF;
  IF public.issue_4420_mask_email('@example.com') IS NOT NULL THEN
    RAISE EXCEPTION 'mask: an address with no local part must be NULL';
  END IF;
  IF public.issue_4420_mask_email(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'mask: NULL in, NULL out';
  END IF;
END $$;

-- An unknown group has no contact.
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF public.issue_4420_stay_group_masked_contact('00000000-0000-4000-8000-000000004420') IS NOT NULL THEN
    RAISE EXCEPTION 'lookup: an unknown group must return NULL';
  END IF;
END $$;
RESET ROLE;

-- Guests (anon, authenticated) cannot call the lookup.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.issue_4420_stay_group_masked_contact(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute the masked-contact lookup';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4420_stay_group_masked_contact(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute the masked-contact lookup';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.issue_4420_stay_group_masked_contact(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute the masked-contact lookup';
  END IF;
END $$;

ROLLBACK;
