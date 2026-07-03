-- ORCH-1276 P1 FIX — admin_reassign_brand_owner arms the account_id immutability bypass.
--
-- Tester live-fire (prod gqnoajqerqhnvulmnyvv, 2026-07-03): a valid reassign
-- RAISED 'brands.account_id is immutable' — the BEFORE-UPDATE trigger
-- biz_prevent_brand_account_id_change() blocks ANY change to brands.account_id
-- unless the caller first arms the txn-local bypass GUC. Verified against the live
-- trigger body (pg_get_functiondef) + the ORCH-1081 transfer path:
--   IF current_setting('app.allow_brand_owner_transfer', true) = 'on' THEN RETURN NEW;
-- ORCH-1081's accept_invite_and_transfer_brand_ownership arms it with
--   PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);
-- right before its account_id UPDATE. The shipped 20261208000001 A2 RPC omitted it.
--
-- This idempotent CREATE OR REPLACE re-defines admin_reassign_brand_owner WITH the
-- arming call (also present in 20261208000001 for fresh installs) so prod — where
-- 20261208000001 is already applied and will NOT be re-run — gets the fix. Re-
-- applies the least-privilege REVOKE/GRANT + self-assert (same as the original).
--
-- Enforces: I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT, -ADMIN-WRITE-AUDITED, -ADMIN-SINGLE-GATE.

CREATE OR REPLACE FUNCTION public.admin_reassign_brand_owner(
  p_brand_id       uuid,
  p_new_account_id uuid,
  p_reason         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(b) INTO v_before FROM public.brands b WHERE b.id = p_brand_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_accounts
                 WHERE id = p_new_account_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_new_owner';
  END IF;
  -- ORCH-1276 P1 fix: arm the txn-local bypass for biz_prevent_brand_account_id_change()
  -- (is_local=true → transaction-scoped) — the SAME mechanism ORCH-1081 uses. Without
  -- it the trigger raises 'brands.account_id is immutable' and the reassign fails.
  PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);
  UPDATE public.brands SET account_id = p_new_account_id, updated_at = now()
   WHERE id = p_brand_id RETURNING to_jsonb(brands) INTO v_after;
  PERFORM public.admin_write_audit('brand.reassign_owner', 'brand', p_brand_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_reassign_brand_owner(uuid, uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reassign_brand_owner(uuid, uuid, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_reassign_brand_owner(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_reassign_brand_owner still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_reassign_brand_owner(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_reassign_brand_owner (admin UI would break)';
  END IF;
END $$;
