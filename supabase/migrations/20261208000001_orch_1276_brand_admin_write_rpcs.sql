-- ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — brand admin write-RPCs (A1–A5).
--
-- Parent META-ORCH-1237; predecessor ORCH-1272 (READ, shipped). Every RPC copies
-- the ORCH-1271 GOLDEN write-RPC template (20261204000003 §GOLDEN block) VERBATIM in
-- shape: guard-first is_admin_user() → reason gate (HIGH only) → to_jsonb before-
-- capture → not_found → whitelisted/validated UPDATE (+ updated_at=now() — brands
-- HAS updated_at) → admin_write_audit(before/after) → least-privilege
-- REVOKE EXECUTE FROM anon,PUBLIC; GRANT TO authenticated → DO $$ self-assert.
--
-- $$ (not $fn$) is used as the body delimiter to match the shipped precedent
-- (admin_write_audit / admin_get_person / admin_audit_probe all use $$) AND the
-- append-only registry gate parsers (i-admin-write-audited / i-admin-gate-first-
-- statement slice the first $$ pair). The actor is bound SERVER-SIDE inside
-- admin_write_audit (auth.uid() in the SECURITY DEFINER context = the calling
-- admin) — p_actor_* is NEVER passed here.
--
-- HARD: brands.kind is NEVER read or written (META-ORCH-0972). A1's whitelist
-- excludes kind / account_id / claim_status / deleted_at / take_rate / stripe_*.
--
-- Enforces: I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT,
--           I-PROPOSED-1271-ADMIN-WRITE-AUDITED, I-PROPOSED-1271-ADMIN-SINGLE-GATE.

--------------------------------------------------------------------------------
-- A1 — admin_update_brand (LOW / audit-only). Whitelisted jsonb-patch. NEVER
-- writes kind / account_id / claim_status / deleted_at / money keys (any non-
-- whitelisted key in p_patch is IGNORED). Reason optional (audit-only).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_brand(
  p_brand_id uuid,
  p_patch    jsonb,
  p_reason   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  SELECT to_jsonb(b) INTO v_before FROM public.brands b WHERE b.id = p_brand_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  -- Whitelist validation (NOT NULL cols reject empty; venue_category CHECK).
  IF (p_patch ? 'name') AND btrim(COALESCE(p_patch->>'name', '')) = '' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF (p_patch ? 'pricing_currency') AND btrim(COALESCE(p_patch->>'pricing_currency', '')) = '' THEN
    RAISE EXCEPTION 'invalid_currency';
  END IF;
  IF (p_patch ? 'venue_category') AND (p_patch->>'venue_category') IS NOT NULL
     AND (p_patch->>'venue_category') NOT IN ('restaurant', 'play', 'creative_and_arts') THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;

  UPDATE public.brands SET
    name             = CASE WHEN p_patch ? 'name'             THEN p_patch->>'name'             ELSE name END,
    description      = CASE WHEN p_patch ? 'description'      THEN p_patch->>'description'      ELSE description END,
    contact_email    = CASE WHEN p_patch ? 'contact_email'   THEN p_patch->>'contact_email'   ELSE contact_email END,
    contact_phone    = CASE WHEN p_patch ? 'contact_phone'   THEN p_patch->>'contact_phone'   ELSE contact_phone END,
    pricing_currency = CASE WHEN p_patch ? 'pricing_currency' THEN p_patch->>'pricing_currency' ELSE pricing_currency END,
    default_currency = CASE WHEN p_patch ? 'default_currency' THEN p_patch->>'default_currency' ELSE default_currency END,
    venue_category   = CASE WHEN p_patch ? 'venue_category'   THEN p_patch->>'venue_category'   ELSE venue_category END,
    theme_color      = CASE WHEN p_patch ? 'theme_color'      THEN p_patch->>'theme_color'      ELSE theme_color END,
    theme_font       = CASE WHEN p_patch ? 'theme_font'       THEN p_patch->>'theme_font'       ELSE theme_font END,
    theme_animation  = CASE WHEN p_patch ? 'theme_animation'  THEN p_patch->>'theme_animation'  ELSE theme_animation END,
    -- social_links / custom_links are NOT NULL jsonb; only a jsonb object/array
    -- replaces them (a stray JSON null/scalar is ignored, preserving NOT NULL).
    social_links     = CASE WHEN (p_patch ? 'social_links')
                              AND jsonb_typeof(p_patch->'social_links') IN ('object', 'array')
                            THEN p_patch->'social_links' ELSE social_links END,
    custom_links     = CASE WHEN (p_patch ? 'custom_links')
                              AND jsonb_typeof(p_patch->'custom_links') IN ('object', 'array')
                            THEN p_patch->'custom_links' ELSE custom_links END,
    updated_at       = now()
   WHERE id = p_brand_id
   RETURNING to_jsonb(brands) INTO v_after;

  PERFORM public.admin_write_audit('brand.update', 'brand', p_brand_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after), false);  -- LOW: reason optional
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_update_brand(uuid, jsonb, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_brand(uuid, jsonb, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_update_brand(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_update_brand still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_update_brand(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_update_brand (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- A2 — admin_reassign_brand_owner (HIGH). Validates the new owner exists and is
-- not soft-deleted (brands.account_id is NOT NULL FK → creator_accounts.id).
--------------------------------------------------------------------------------
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
  -- ORCH-1276 P1 fix: brands.account_id is protected by the BEFORE-UPDATE trigger
  -- biz_prevent_brand_account_id_change(), which RAISES 'brands.account_id is
  -- immutable' unless the txn-local bypass GUC is armed. Arm it here (is_local=true
  -- → transaction-scoped) — the SAME mechanism ORCH-1081's
  -- accept_invite_and_transfer_brand_ownership uses. Without this the reassign
  -- fails 100% of the time in prod.
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

--------------------------------------------------------------------------------
-- A3/A4 — admin_set_brand_claim_status (HIGH). Suspend/revoke (A3) +
-- unsuspend/restore (A4) share this RPC. The allow-set EXCLUDES pending_review /
-- rejected — those stay in the claims flow (ClaimsPage). See SPEC Open Q1.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_brand_claim_status(
  p_brand_id uuid,
  p_status   text,
  p_reason   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_status NOT IN ('suspended', 'revoked', 'verified', 'none') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  SELECT to_jsonb(b) INTO v_before FROM public.brands b WHERE b.id = p_brand_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.brands SET claim_status = p_status, updated_at = now()
   WHERE id = p_brand_id RETURNING to_jsonb(brands) INTO v_after;
  PERFORM public.admin_write_audit('brand.set_claim_status', 'brand', p_brand_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_brand_claim_status(uuid, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_brand_claim_status(uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_brand_claim_status(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_set_brand_claim_status still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_brand_claim_status(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_set_brand_claim_status (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- A5 — admin_set_brand_deleted (HIGH). Soft-delete / restore via brands.deleted_at.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_brand_deleted(
  p_brand_id uuid,
  p_deleted  boolean,
  p_reason   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(b) INTO v_before FROM public.brands b WHERE b.id = p_brand_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.brands
     SET deleted_at = CASE WHEN p_deleted THEN now() ELSE NULL END, updated_at = now()
   WHERE id = p_brand_id RETURNING to_jsonb(brands) INTO v_after;
  PERFORM public.admin_write_audit('brand.set_deleted', 'brand', p_brand_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_brand_deleted(uuid, boolean, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_brand_deleted(uuid, boolean, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_brand_deleted(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: admin_set_brand_deleted still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_brand_deleted(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1276: authenticated lost EXECUTE on admin_set_brand_deleted (admin UI would break)';
  END IF;
END $$;
