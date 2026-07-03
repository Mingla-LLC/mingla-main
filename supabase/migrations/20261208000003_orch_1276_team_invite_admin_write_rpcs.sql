-- ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — team/invite admin write-RPCs (C1–C3).
--
-- Golden template (ORCH-1271). brand_team_members + brand_invitations have NO
-- updated_at → these RPCs MUST NOT set it; they use state columns removed_at /
-- revoked_at. $$ body delimiter per shipped precedent + registry-gate parsers.
--
-- Verified constraints (live prod 2026-07-03):
--   brand_team_members_accepted_removed_excl: (removed_at IS NULL OR accepted_at IS NOT NULL)
--     → C2 cannot set removed_at on a never-accepted row → branch: soft-remove
--       accepted rows, DELETE un-accepted rows.
--   role CHECK: brand_owner|brand_admin|event_manager|finance_manager|marketing_manager|scanner
--   invitation status CHECK: pending|accepted|revoked|expired|declined
--   Orphan-owner guard: never demote/remove the member whose user_id = the
--     brand's account_id (that member IS the account owner).
--
-- Enforces: I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT, -ADMIN-WRITE-AUDITED, -ADMIN-SINGLE-GATE.

--------------------------------------------------------------------------------
-- C1 — admin_set_team_member_role (HIGH). Validates role CHECK + orphan-owner.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_team_member_role(
  p_member_id uuid,
  p_role      text,
  p_reason    text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_role NOT IN ('brand_owner', 'brand_admin', 'event_manager',
                    'finance_manager', 'marketing_manager', 'scanner') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  SELECT to_jsonb(m) INTO v_before FROM public.brand_team_members m WHERE m.id = p_member_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  -- Orphan-owner guard: cannot demote the member who IS the brand's account owner.
  IF (v_before->>'user_id') = (SELECT b.account_id::text FROM public.brands b
                               WHERE b.id = (v_before->>'brand_id')::uuid)
     AND p_role <> 'brand_owner' THEN
    RAISE EXCEPTION 'cannot_demote_account_owner';  -- orch-strict-grep-allow account_owner (error code for brands.account_id owner, not the renamed role)
  END IF;
  UPDATE public.brand_team_members SET role = p_role  -- NO updated_at on this table
   WHERE id = p_member_id RETURNING to_jsonb(brand_team_members) INTO v_after;
  PERFORM public.admin_write_audit('team_member.set_role', 'team_member', p_member_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_team_member_role(uuid, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_team_member_role(uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_team_member_role(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_set_team_member_role still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_team_member_role(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_set_team_member_role (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- C2 — admin_remove_team_member (HIGH). Orphan-owner guard, then branch on the
-- exclusion CHECK: accepted rows get removed_at; never-accepted rows are DELETEd.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_remove_team_member(
  p_member_id uuid,
  p_reason    text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(m) INTO v_before FROM public.brand_team_members m WHERE m.id = p_member_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  -- Orphan-owner guard: cannot remove the member who IS the brand's account owner.
  IF (v_before->>'user_id') = (SELECT b.account_id::text FROM public.brands b
                               WHERE b.id = (v_before->>'brand_id')::uuid) THEN
    RAISE EXCEPTION 'cannot_remove_account_owner';  -- orch-strict-grep-allow account_owner (error code for brands.account_id owner, not the renamed role)
  END IF;
  IF (v_before->>'accepted_at') IS NOT NULL THEN
    UPDATE public.brand_team_members SET removed_at = now()  -- NO updated_at on this table
     WHERE id = p_member_id RETURNING to_jsonb(brand_team_members) INTO v_after;
  ELSE
    DELETE FROM public.brand_team_members WHERE id = p_member_id;
    v_after := jsonb_build_object('deleted', true);
  END IF;
  PERFORM public.admin_write_audit('team_member.remove', 'team_member', p_member_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_remove_team_member(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_remove_team_member(uuid, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_remove_team_member(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_remove_team_member still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_remove_team_member(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_remove_team_member (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- C3 — admin_revoke_brand_invitation (HIGH). Only a pending invite is revocable.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revoke_brand_invitation(
  p_invitation_id uuid,
  p_reason        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(i) INTO v_before FROM public.brand_invitations i WHERE i.id = p_invitation_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF (v_before->>'status') <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;
  UPDATE public.brand_invitations SET status = 'revoked', revoked_at = now()  -- NO updated_at
   WHERE id = p_invitation_id RETURNING to_jsonb(brand_invitations) INTO v_after;
  PERFORM public.admin_write_audit('invitation.revoke', 'invitation', p_invitation_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_brand_invitation(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_revoke_brand_invitation(uuid, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_revoke_brand_invitation(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_revoke_brand_invitation still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_revoke_brand_invitation(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_revoke_brand_invitation (admin UI would break)';
  END IF;
END $$;
