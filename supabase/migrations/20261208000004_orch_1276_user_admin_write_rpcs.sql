-- ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — user admin write-RPCs (D1, D2).
--
-- Golden template (ORCH-1271). profiles HAS updated_at (nullable) → SET
-- updated_at=now(). $$ body delimiter per shipped precedent + registry-gate parsers.
--
-- D1 is an APP-enforced disable (profiles.active=false) — NOT an auth-level ban.
-- A true auth ban / hard-delete is DEFERRED to a service_role edge fn (SPEC §5 D3).
--
-- Enforces: I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT, -ADMIN-WRITE-AUDITED, -ADMIN-SINGLE-GATE.

--------------------------------------------------------------------------------
-- D1 — admin_set_user_active (HIGH). Disable / enable via profiles.active.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_active(
  p_user_id uuid,
  p_active  boolean,
  p_reason  text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(p) INTO v_before FROM public.profiles p WHERE p.id = p_user_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.profiles SET active = p_active, updated_at = now()
   WHERE id = p_user_id RETURNING to_jsonb(profiles) INTO v_after;
  PERFORM public.admin_write_audit('user.set_active', 'user', p_user_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_user_active(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_set_user_active still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_user_active(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_set_user_active (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- D2 — admin_set_user_beta (LOW / audit-only). Beta toggle via profiles.is_beta_tester.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_beta(
  p_user_id uuid,
  p_is_beta boolean,
  p_reason  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  SELECT to_jsonb(p) INTO v_before FROM public.profiles p WHERE p.id = p_user_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.profiles SET is_beta_tester = p_is_beta, updated_at = now()
   WHERE id = p_user_id RETURNING to_jsonb(profiles) INTO v_after;
  PERFORM public.admin_write_audit('user.set_beta', 'user', p_user_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after), false);  -- LOW: reason optional
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_beta(uuid, boolean, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_user_beta(uuid, boolean, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_user_beta(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_set_user_beta still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_user_beta(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_set_user_beta (admin UI would break)';
  END IF;
END $$;
