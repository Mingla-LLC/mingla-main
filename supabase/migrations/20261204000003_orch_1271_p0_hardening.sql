-- ORCH-1271 P0 HARDENING — admin_write_audit actor-forgery + fail-open + reason-bypass.
-- (append-only rework of the audited-write primitive; supersedes the 20261204000002 body.)
--
-- P0 (tester live-fire on prod gqnoajqerqhnvulmnyvv, 2026-07-03): public.admin_write_audit
-- was EXECUTE-granted to anon/authenticated/PUBLIC; its guard
--   IF auth.uid() IS NOT NULL AND NOT is_admin_user()
-- FAILS OPEN for anon (auth.uid() IS NULL → guard skipped), and
--   COALESCE(p_actor_*, auth.uid())
-- let ANY caller forge the audit actor. An anon curl to /rest/v1/rpc/admin_write_audit
-- returned 200 + a forged audit row. A live containment hotfix (REVOKE EXECUTE from
-- anon/authenticated/PUBLIC — verified anon/authenticated false, service_role true) was
-- already applied to prod; this migration makes it PERMANENT in code + closes P1/P2:
--   (b) actor is bound SERVER-SIDE — a JWT caller's actor is ALWAYS auth.uid()/its email
--       (cannot be forged via p_actor_*); only the no-JWT service_role edge path (after
--       its own admin re-check) may supply p_actor_*.
--   (a) least-privilege: admin_write_audit EXECUTE only for service_role (edge fn) +
--       SECURITY DEFINER admin_* RPCs (which call it in definer=postgres context).
--   (c) reason gate normalizes ASCII + Unicode invisible whitespace (NBSP, ZWSP/ZWNJ/ZWJ,
--       LSEP/PSEP, BOM) to empty BEFORE the emptiness check → invisible-char bypass closed.
--   (d) admin_audit_probe EXECUTE only for authenticated (admin UI); anon/PUBLIC revoked.
--
-- Guard kept; search_path=public kept. Does NOT touch is_admin_user() (spec Q3).
-- Enforces: I-PROPOSED-1271-ADMIN-WRITE-AUDITED + I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT.

--------------------------------------------------------------------------------
-- (b)+(c) Rebind actor server-side + harden the reason gate.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_write_audit(
  p_action        text,
  p_entity_type   text,
  p_entity_id     text,
  p_reason        text,
  p_metadata      jsonb    DEFAULT '{}'::jsonb,
  p_require_reason boolean DEFAULT true,
  p_actor_email   text     DEFAULT NULL,   -- service_role (no-JWT) edge path ONLY
  p_actor_uid     uuid     DEFAULT NULL    -- service_role (no-JWT) edge path ONLY
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid   uuid;
  v_email text;
  v_id    uuid;
BEGIN
  -- GUARD (first executable statement): a JWT caller MUST be an active admin.
  -- EXECUTE is revoked from anon/authenticated/PUBLIC (below), so the only direct
  -- callers are service_role (no JWT) + SECURITY DEFINER admin_* RPCs (definer=postgres).
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  -- Reason gate — delete ASCII + Unicode invisible whitespace (space/tab/nl/cr/ff/vt,
  -- NBSP=160, ZWSP=8203, ZWNJ=8204, ZWJ=8205, LSEP=8232, PSEP=8233, BOM=65279) BEFORE the
  -- emptiness check so an all-invisible reason cannot bypass reason_required.
  IF p_require_reason AND translate(
       COALESCE(p_reason, ''),
       E' \t\n\r\f\v' || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8232) || chr(8233) || chr(65279),
       ''
     ) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  -- Actor binding — a JWT caller's actor is ALWAYS auth.uid()/its email (p_actor_* is
  -- IGNORED so it cannot be forged). Only the no-JWT service_role path uses p_actor_*.
  IF auth.uid() IS NOT NULL THEN
    v_uid   := auth.uid();
    v_email := (SELECT email FROM auth.users WHERE id = auth.uid());
  ELSE
    v_uid   := p_actor_uid;
    v_email := p_actor_email;
  END IF;
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
-- (a) Least-privilege on the helper. Matches the live hotfix; idempotent. service_role
--     (edge fn) keeps EXECUTE; SECURITY DEFINER admin_* RPCs call it in definer context.
--------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_write_audit(text,text,text,text,jsonb,boolean,text,uuid)
  FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_write_audit(text,text,text,text,jsonb,boolean,text,uuid)
  TO service_role;

--------------------------------------------------------------------------------
-- (d) Least-privilege on the probe: authenticated (admin UI) ONLY; anon has no business
--     calling it.
--------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_audit_probe(text,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_audit_probe(text,text) TO authenticated;

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS unless the privilege lockdown holds (anon/authenticated
-- cannot execute the helper; service_role can; anon cannot execute the probe;
-- authenticated can). Runtime-proves the P0 containment at apply time.
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon',          'public.admin_write_audit(text,text,text,text,jsonb,boolean,text,uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.admin_write_audit(text,text,text,text,jsonb,boolean,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1271 P0: admin_write_audit still EXECUTE-able by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.admin_write_audit(text,text,text,text,jsonb,boolean,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1271 P0: service_role lost EXECUTE on admin_write_audit (edge fn would break)';
  END IF;
  IF has_function_privilege('anon', 'public.admin_audit_probe(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1271 P0: admin_audit_probe still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_audit_probe(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1271 P0: authenticated lost EXECUTE on admin_audit_probe (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- GOLDEN WRITE-RPC TEMPLATE (wave-2 canonical — 1272/1273/1274 copy this).
-- Supersedes the SPEC §2d skeleton: every admin write RPC MUST guard-first, gate
-- reason, audit via admin_write_audit, AND ship the least-privilege REVOKE so it
-- can never be reached by anon/authenticated directly (P0 root cause). Only the
-- admin UI's authenticated role (for user-JWT RPCs) or service_role (edge fns)
-- may execute it; the actor is bound server-side and can never be forged.
--
--   CREATE OR REPLACE FUNCTION public.admin_<verb>_<entity>(p_<id> uuid, p_<field> <type>, p_reason text)
--   RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
--   DECLARE v_before jsonb; v_after jsonb;
--   BEGIN
--     IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;   -- guard FIRST
--     IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
--     SELECT to_jsonb(t) INTO v_before FROM public.<table> t WHERE t.id = p_<id>;
--     IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
--     UPDATE public.<table> SET <field> = p_<field>, updated_at = now()
--      WHERE id = p_<id> RETURNING to_jsonb(public.<table>) INTO v_after;
--     PERFORM public.admin_write_audit('<entity>.<verb>', '<entity>', p_<id>::text, p_reason,
--       jsonb_build_object('before', v_before, 'after', v_after));   -- audit
--     RETURN v_after;
--   END; $fn$;
--   -- LEAST-PRIVILEGE (MANDATORY — closes the P0 fail-open class by construction):
--   REVOKE EXECUTE ON FUNCTION public.admin_<verb>_<entity>(uuid,<type>,text) FROM anon, PUBLIC;
--   GRANT  EXECUTE ON FUNCTION public.admin_<verb>_<entity>(uuid,<type>,text) TO authenticated;  -- user-JWT admin RPC
--   -- (service_role-only variants: REVOKE ... FROM anon, authenticated, PUBLIC; GRANT ... TO service_role;)
--------------------------------------------------------------------------------
