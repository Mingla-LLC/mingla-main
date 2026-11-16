-- issue #4420 wave 2 (D-S7) — "This booking is under another email".
--
-- A signed-in guest who opens a Stay booking made for a different contact
-- was told "stay group not found". The stay-reservations edge function now
-- answers `stay_group_other_contact` with a MASKED address, so the page can
-- say whose email the booking is under without revealing it.
--
-- Two functions:
--   issue_4420_mask_email(text)  — pure: first character, "•••", "@domain".
--   issue_4420_stay_group_masked_contact(uuid) — the masked guest email of a
--     group, or NULL. SERVICE ROLE ONLY: the edge function calls it after the
--     caller's own read was refused, and never returns more than the mask.

CREATE OR REPLACE FUNCTION public.issue_4420_mask_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_email IS NULL THEN NULL
    WHEN position('@' IN btrim(p_email)) < 2 THEN NULL
    ELSE
      left(btrim(p_email), 1)
      || '•••'
      || substr(btrim(p_email), position('@' IN btrim(p_email)))
  END;
$function$;

COMMENT ON FUNCTION public.issue_4420_mask_email(text) IS
  'issue #4420 — mask an email as first character + ••• + @domain; NULL when not an address.';

CREATE OR REPLACE FUNCTION public.issue_4420_stay_group_masked_contact(p_group_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT public.issue_4420_mask_email(g.guest_snapshot->>'email')
  FROM public.stay_reservation_groups g
  WHERE g.id = p_group_id;
$function$;

COMMENT ON FUNCTION public.issue_4420_stay_group_masked_contact(uuid) IS
  'issue #4420 — the masked guest email of a Stay group (service role only; used by stay-reservations get_group when the caller is not the booking contact).';

REVOKE ALL ON FUNCTION public.issue_4420_stay_group_masked_contact(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_4420_stay_group_masked_contact(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_stay_group_masked_contact(uuid) TO service_role;
