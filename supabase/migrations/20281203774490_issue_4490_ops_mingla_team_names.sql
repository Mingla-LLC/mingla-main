-- Issue #4490, after #4579 ("Mingla Team works on every brand"): Till staff
-- names follow #4579's public-name rule.
--
-- #4579 adds every active Mingla admin to every live brand as a full Brand
-- admin (brand_team_members.granted_via = 'mingla_admin'). Seth decided full
-- parity (#4490 comment, 23 Nov 19:22): they sell, approve and close like any
-- Brand admin, hold a Till PIN, and get the same order and escalation pushes.
-- What changes is only how they are NAMED: never an email, a handle or a
-- profile name (profile first names equal the email handle for Mingla staff),
-- always #4579's issue_4579_admin_public_name with the Mingla mark.
--
-- One rule, issue_4490_staff_name(brand, user, fallback): a Mingla Team member
-- of the brand (issue_4579_is_mingla_team_member: ever added by Mingla, no
-- active invited row) is "<public name> from Mingla", or "Mingla Team" when
-- #4579 refuses every name; anyone else keeps the fallback the caller passes
-- (the floor display name). The words "from Mingla" are the Mingla mark on
-- every #4490 surface, because several are plain text (kitchen tickets, the
-- day-close CSV and PDF, the PIN pad greeting).
--
-- Surfaces, all through the functions patched here:
--   * issue_4490_floor_person_name: kitchen and station "sent by", accepted
--     by, ready by, voided by, picked up by; stock "set by" and "marked by";
--     the PIN unlock greeting and the PIN session's member name; and, through
--     issue_4490_close_person, the day close (closed by, reopened by, sales
--     and tips by person, late payments "Taken by", cash movements) and its
--     CSV and PDF exports.
--   * issue_4490_till_servers ("Who's selling?") and issue_4490_pin_staff (the
--     PIN pad and its approver list): the same name, plus isMinglaTeam.
--   * issue_4490_close_person: kind mingla_support is now read from #4579's
--     own helper instead of the to_jsonb(granted_via) stand-in.
--
-- Full parity on PINs: issue_4490_pin_member_eligible no longer leaves Mingla
-- admins out, so a Mingla admin appears on "Who's selling?" and can hold and
-- use a Till PIN exactly as any Brand admin. The stand-in helper
-- issue_4490_pin_member_is_mingla_admin is dropped (its only caller).
--
-- Till receipts name no staff member; nothing to change there. No new column,
-- no new venue_id: the #2099 pending-venue seal does not move. Functions are
-- patched in place (each patch refuses a definition it does not recognise),
-- so owners, SECURITY DEFINER, search_path and grants are kept.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_mtn_patch(p_sig regprocedure, p_old text, p_new text, p_count integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 Mingla Team names patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ===========================================================================
-- 1. The one naming rule.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_staff_name(p_brand_id uuid, p_user_id uuid, p_fallback text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN public.issue_4579_is_mingla_team_member(p_brand_id, p_user_id) THEN
      CASE WHEN n.name = 'Mingla Team' THEN 'Mingla Team' ELSE n.name || ' from Mingla' END
    ELSE p_fallback
  END
  FROM (SELECT public.issue_4579_admin_public_name(p_user_id) AS name) n;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_staff_name(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_staff_name(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.issue_4490_staff_name(uuid, uuid, text) IS
  'Issue #4490 after #4579: a Mingla Team member of the brand is "<public name> from Mingla" (or "Mingla Team"); anyone else the fallback. Never an email or handle.';

-- ===========================================================================
-- 2. The floor display name (kitchen, stock, PIN, and the day close through
--    issue_4490_close_person).
-- ===========================================================================
SELECT pg_temp.issue_4490_mtn_patch(
  'public.issue_4490_floor_person_name(uuid,uuid)'::regprocedure,
  $old$    ELSE (
      SELECT COALESCE(
        NULLIF(btrim(ca.display_name), ''),
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), ''))
      FROM (SELECT 1) one$old$,
  $new$    ELSE (
      SELECT public.issue_4490_staff_name(
        (SELECT v.brand_id FROM public.venue_listings v WHERE v.id = p_venue_id),
        p_user_id,
        COALESCE(
          NULLIF(btrim(ca.display_name), ''),
          NULLIF(btrim(p.display_name), ''),
          NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), '')))
      FROM (SELECT 1) one$new$
);

-- ===========================================================================
-- 3. "Who's selling?": the same name, plus isMinglaTeam.
-- ===========================================================================
SELECT pg_temp.issue_4490_mtn_patch(
  'public.issue_4490_till_servers(uuid,uuid)'::regprocedure,
  $old$        'name', COALESCE(
          NULLIF(btrim(ca.display_name), ''),
          NULLIF(btrim(p.display_name), ''),
          NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), '')),
        'role', m.role,$old$,
  $new$        'name', public.issue_4490_staff_name(m.brand_id, m.user_id, COALESCE(
          NULLIF(btrim(ca.display_name), ''),
          NULLIF(btrim(p.display_name), ''),
          NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), ''))),
        'isMinglaTeam', public.issue_4579_is_mingla_team_member(m.brand_id, m.user_id),
        'role', m.role,$new$
);

-- ===========================================================================
-- 4. The PIN pad and its approver list: the same name, plus isMinglaTeam.
-- ===========================================================================
SELECT pg_temp.issue_4490_mtn_patch(
  'public.issue_4490_pin_staff(uuid,uuid)'::regprocedure,
  $old$      'name', COALESCE(
        NULLIF(btrim(ca.display_name), ''),
        NULLIF(btrim(pr.display_name), ''),
        NULLIF(btrim(concat_ws(' ', NULLIF(btrim(pr.first_name), ''), NULLIF(btrim(pr.last_name), ''))), ''),
        'Team member'),
      'role', m.role,$old$,
  $new$      'name', public.issue_4490_staff_name(m.brand_id, m.user_id, COALESCE(
        NULLIF(btrim(ca.display_name), ''),
        NULLIF(btrim(pr.display_name), ''),
        NULLIF(btrim(concat_ws(' ', NULLIF(btrim(pr.first_name), ''), NULLIF(btrim(pr.last_name), ''))), ''),
        'Team member')),
      'isMinglaTeam', public.issue_4579_is_mingla_team_member(m.brand_id, m.user_id),
      'role', m.role,$new$
);

-- ===========================================================================
-- 5. The day close: kind mingla_support from #4579's helper (exit of the
--    to_jsonb stand-in). The name is the floor name above.
-- ===========================================================================
SELECT pg_temp.issue_4490_mtn_patch(
  'public.issue_4490_close_person(uuid,uuid)'::regprocedure,
  $old$      'kind', CASE WHEN EXISTS (
          SELECT 1 FROM public.brand_team_members m JOIN public.venue_listings v ON v.brand_id = m.brand_id
          WHERE v.id = p_venue_id AND m.user_id = p_user_id
            AND to_jsonb(m) ->> 'granted_via' = 'mingla_admin') THEN 'mingla_support' ELSE 'person' END,$old$,
  $new$      'kind', CASE WHEN public.issue_4579_is_mingla_team_member(
          (SELECT v.brand_id FROM public.venue_listings v WHERE v.id = p_venue_id), p_user_id)
        THEN 'mingla_support' ELSE 'person' END,$new$
);

-- ===========================================================================
-- 6. Full parity on PINs: a Mingla admin may hold and use a Till PIN.
-- ===========================================================================
SELECT pg_temp.issue_4490_mtn_patch(
  'public.issue_4490_pin_member_eligible(uuid,uuid,text)'::regprocedure,
  $old$      AND NOT public.issue_4490_pin_member_is_mingla_admin(m.id)
$old$,
  ''
);

DROP FUNCTION public.issue_4490_pin_member_is_mingla_admin(uuid);

COMMIT;
