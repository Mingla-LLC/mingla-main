-- ORCH-1271 [Admin authorization & audit FOUNDATION] — (2b/2c) audited-write PRIMITIVE.
--
-- Ships the shared audited-write helper + the ONE golden reference RPC that
-- unit-proves the whole guard + reason + audit seam WITHOUT mutating any
-- business data (D1: "built and unit-proven, unwired").
--
--   * admin_write_audit(...)  — the shared SECURITY DEFINER helper every future
--     admin write RPC calls to write admin_audit_log. Guard-first: a JWT caller
--     MUST be an active admin. Service-role edge fns call with NO JWT
--     (auth.uid() IS NULL) after their own admin re-check and pass p_actor_*.
--   * admin_audit_probe(...)  — the golden template's guard + reason + audit
--     spine minus a business mutation. It is the demo action the placeholder
--     BusinessConsolePage's HighRiskActionModal calls to prove the primitive
--     end-to-end. It writes an admin.audit_probe row and mutates nothing else.
--
-- Both set search_path = 'public' (matches the hardened admin_set_platform_take_rate
-- exemplar) to prevent search_path hijack of the admin_audit_log / auth.users refs.
--
-- Enforces: I-PROPOSED-1271-ADMIN-WRITE-AUDITED + I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT.

--------------------------------------------------------------------------------
-- 2b. Shared audited-write helper.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_write_audit(
  p_action        text,
  p_entity_type   text,
  p_entity_id     text,
  p_reason        text,
  p_metadata      jsonb    DEFAULT '{}'::jsonb,
  p_require_reason boolean DEFAULT true,
  p_actor_email   text     DEFAULT NULL,   -- edge-fn (service_role) path override
  p_actor_uid     uuid     DEFAULT NULL    -- edge-fn (service_role) path override
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid   uuid;
  v_email text;
  v_id    uuid;
BEGIN
  -- GUARD (first executable statement): a JWT caller MUST be an active admin.
  -- Service-role edge fns call with no JWT (auth.uid() IS NULL) after their own
  -- admin re-check, and pass p_actor_* explicitly.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_require_reason AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  v_uid   := COALESCE(p_actor_uid, auth.uid());
  v_email := COALESCE(p_actor_email, (SELECT email FROM auth.users WHERE id = auth.uid()));
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'actor_unresolved';
  END IF;
  INSERT INTO public.admin_audit_log
    (admin_email, actor_uid, action, target_type, target_id, reason, metadata)
  VALUES
    (v_email, v_uid, p_action, p_entity_type, p_entity_id, p_reason, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

--------------------------------------------------------------------------------
-- 2c. Golden reference RPC (deployed, unit-proven) — mutates NO business data.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_audit_probe(p_reason text, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';   -- gate = first statement
  END IF;
  RETURN public.admin_write_audit(
    'admin.audit_probe', 'self_test', NULL, p_reason,
    jsonb_build_object('note', p_note), true);
END;
$$;

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS if either function is absent post-create.
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_write_audit'
  ) THEN
    RAISE EXCEPTION 'ORCH-1271 primitive: admin_write_audit function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_audit_probe'
  ) THEN
    RAISE EXCEPTION 'ORCH-1271 primitive: admin_audit_probe function missing';
  END IF;
END $$;
