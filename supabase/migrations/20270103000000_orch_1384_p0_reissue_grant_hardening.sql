-- ORCH-1384 [partner brand-management verbs] — P0-1 grant hardening (REWORK
-- after TEST FAIL, TEST_ORCH-1384_PARTNER_BRAND_MANAGEMENT.md §3).
--
-- WHY THIS MIGRATION EXISTS (the default-privileges footgun, again):
-- `partner_reissue_brand_invitation` was EXECUTE-able by anon + authenticated
-- on live prod. Migration 20270102000000 ran `REVOKE ALL ... FROM PUBLIC` +
-- `GRANT EXECUTE ... TO service_role` and called that "service_role ONLY" —
-- but Supabase projects carry `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated, service_role`, so every CREATE FUNCTION
-- lands with direct per-ROLE ACL entries, and a PUBLIC revoke does NOT strip
-- a per-role grant. EXACT recurrence of the ORCH-1338 P2-1 class (remediated
-- by 20261227000000_orch_1338_p2_revoke_anon_execute.sql).
--
-- WHY P0 (not defense-in-depth): the reissue RPC is SECURITY DEFINER with NO
-- auth.uid() gate — its only auth is the grant boundary plus a caller-SUPPLIED
-- p_partner_account_id. Anon EXECUTE therefore = a brand-ownership-token
-- minting vector (attacker-chosen p_token_hash on a fresh brand_owner
-- invitation → accept → seize the brand). Proven live by the tester:
--   has_function_privilege('anon',          reissue, 'EXECUTE') = true
--   has_function_privilege('authenticated', reissue, 'EXECUTE') = true
--
-- PROD WAS EMERGENCY-HARDENED LIVE by the orchestrator on 2026-07-17
-- (verified end-state: reissue anon=false / authenticated=false /
-- service_role=true; cancel + disconnect anon=false, authenticated kept).
-- THIS migration codifies that live patch durably — fresh environments and
-- re-applies converge on the same grant state; on current prod every
-- statement below is an idempotent no-op and the DO-block asserts pass.
--
-- P2-2 fold-in: partner_cancel_pending_link + partner_disconnect_link keep
-- `authenticated` (both fail-close in-body on `auth.uid() IS NULL` →
-- 'forbidden', proven live) but drop the latent anon + PUBLIC EXECUTE, per
-- the ORCH-1338 standard.
--
-- The lifecycle migration 20270102000000 also carries the corrected explicit
-- per-role REVOKE in its grant footer (REWORK amendment) so fresh
-- environments are born fail-closed; this file is the authoritative
-- re-assert for every environment that already applied the original text.
--
-- SAFE-MIGRATION PROTOCOL: grants-only DDL (no CREATE/DROP FUNCTION, no
-- table DDL, no RLS change); idempotent — REVOKE/GRANT re-runs are no-ops;
-- post-apply DO-block asserts abort the transaction on any drift from the
-- intended end-state; NOTIFY pgrst last.
--
-- DO NOT auto-apply — orchestrator/Seth applies at SHIP.

BEGIN;

-- ---------------------------------------------------------------------------
-- P0-1 — reissue: service_role ONLY (edge fn partner-reissue-invitation owns
-- JWT auth; SPEC §4.4 RPC-3 / §7 A-6).
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- P2-2 — cancel: authenticated stays (in-body auth.uid() forbidden-gate);
-- anon + PUBLIC dropped.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.partner_cancel_pending_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_cancel_pending_link(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- P2-2 — disconnect: same shape as cancel.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.partner_disconnect_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_disconnect_link(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Post-apply asserts — the orchestrator's 2026-07-17 live-probe values are
-- the contract. ORCH-1338 lesson: never trust a REVOKE's effect without
-- probing EFFECTIVE privilege. Any mismatch aborts the whole transaction.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_reissue    text := 'public.partner_reissue_brand_invitation(uuid,uuid,text,text,timestamptz)';
  v_cancel     text := 'public.partner_cancel_pending_link(uuid)';
  v_disconnect text := 'public.partner_disconnect_link(uuid)';
BEGIN
  -- reissue: service_role ONLY.
  IF has_function_privilege('anon', v_reissue, 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1384 P0-1 assert failed: anon retains EXECUTE on partner_reissue_brand_invitation';
  END IF;
  IF has_function_privilege('authenticated', v_reissue, 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1384 P0-1 assert failed: authenticated retains EXECUTE on partner_reissue_brand_invitation';
  END IF;
  IF NOT has_function_privilege('service_role', v_reissue, 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1384 P0-1 assert failed: service_role LOST EXECUTE on partner_reissue_brand_invitation (edge fn would break)';
  END IF;

  -- cancel: authenticated + service_role, never anon.
  IF has_function_privilege('anon', v_cancel, 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1384 P2-2 assert failed: anon retains EXECUTE on partner_cancel_pending_link';
  END IF;
  IF NOT has_function_privilege('authenticated', v_cancel, 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1384 P2-2 assert failed: authenticated LOST EXECUTE on partner_cancel_pending_link (client verb would break)';
  END IF;
  IF NOT has_function_privilege('service_role', v_cancel, 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1384 P2-2 assert failed: service_role LOST EXECUTE on partner_cancel_pending_link';
  END IF;

  -- disconnect: authenticated + service_role, never anon.
  IF has_function_privilege('anon', v_disconnect, 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1384 P2-2 assert failed: anon retains EXECUTE on partner_disconnect_link';
  END IF;
  IF NOT has_function_privilege('authenticated', v_disconnect, 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1384 P2-2 assert failed: authenticated LOST EXECUTE on partner_disconnect_link (client verb would break)';
  END IF;
  IF NOT has_function_privilege('service_role', v_disconnect, 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1384 P2-2 assert failed: service_role LOST EXECUTE on partner_disconnect_link';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
