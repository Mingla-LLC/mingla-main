-- ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — account admin write-RPCs (B1, B2).
--
-- Golden template (ORCH-1271 20261204000003 §GOLDEN). creator_accounts HAS
-- updated_at (NOT NULL) → SET updated_at=now(). Lifecycle is deleted_at ONLY (no
-- suspend/status column) → account "suspend" == soft-delete (B2). $$ body
-- delimiter per shipped precedent + registry-gate parsers. Actor bound server-side.
--
-- Enforces: I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT, -ADMIN-WRITE-AUDITED, -ADMIN-SINGLE-GATE.

--------------------------------------------------------------------------------
-- B1 — admin_update_account (LOW / audit-only). Whitelisted jsonb-patch:
-- business_name, phone_e164, marketing_opt_in (bool, NOT NULL), display_name,
-- email. All other keys IGNORED (esp. deleted_at / partner_enabled / default_brand_id).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_account(
  p_user_id uuid,
  p_patch   jsonb,
  p_reason  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  SELECT to_jsonb(a) INTO v_before FROM public.creator_accounts a WHERE a.id = p_user_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  UPDATE public.creator_accounts SET
    business_name    = CASE WHEN p_patch ? 'business_name' THEN p_patch->>'business_name' ELSE business_name END,
    phone_e164       = CASE WHEN p_patch ? 'phone_e164'    THEN p_patch->>'phone_e164'    ELSE phone_e164 END,
    display_name     = CASE WHEN p_patch ? 'display_name'  THEN p_patch->>'display_name'  ELSE display_name END,
    email            = CASE WHEN p_patch ? 'email'         THEN p_patch->>'email'         ELSE email END,
    -- marketing_opt_in is NOT NULL bool; only a non-null value replaces it.
    marketing_opt_in = CASE WHEN (p_patch ? 'marketing_opt_in')
                              AND (p_patch->>'marketing_opt_in') IS NOT NULL
                            THEN (p_patch->>'marketing_opt_in')::boolean ELSE marketing_opt_in END,
    updated_at       = now()
   WHERE id = p_user_id
   RETURNING to_jsonb(creator_accounts) INTO v_after;

  PERFORM public.admin_write_audit('account.update', 'account', p_user_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after), false);  -- LOW: reason optional
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_update_account(uuid, jsonb, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_account(uuid, jsonb, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_update_account(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_update_account still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_update_account(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_update_account (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- B2 — admin_set_account_deleted (HIGH). Soft-delete / restore via
-- creator_accounts.deleted_at (the account's only lifecycle column).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_account_deleted(
  p_user_id uuid,
  p_deleted boolean,
  p_reason  text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(a) INTO v_before FROM public.creator_accounts a WHERE a.id = p_user_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.creator_accounts
     SET deleted_at = CASE WHEN p_deleted THEN now() ELSE NULL END, updated_at = now()
   WHERE id = p_user_id RETURNING to_jsonb(creator_accounts) INTO v_after;
  PERFORM public.admin_write_audit('account.set_deleted', 'account', p_user_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_account_deleted(uuid, boolean, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_account_deleted(uuid, boolean, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_account_deleted(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_set_account_deleted still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_account_deleted(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_set_account_deleted (admin UI would break)';
  END IF;
END $$;
