-- ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — REVOKE anon + authenticated
-- EXECUTE on the 4 SECURITY DEFINER RPCs introduced by 20260612000000.
--
-- HOTFIX RATIONALE (P0 security gap discovered at Phase C live-fire 2026-05-18):
--
-- The parent migration's `REVOKE ALL ON FUNCTION ... FROM PUBLIC` + selective
-- `GRANT EXECUTE TO authenticated, service_role` did NOT prevent anon from
-- gaining EXECUTE. Reason: Supabase's project-level ALTER DEFAULT PRIVILEGES
-- grants `EXECUTE ON FUNCTIONS TO anon, authenticated, service_role` for every
-- function created by the `postgres` role. That default grant fires AFTER the
-- `CREATE FUNCTION` and BEFORE / independent of the per-function GRANT
-- statements. The effective ACL after the parent migration was:
--
--   {postgres=X, anon=X, authenticated=X, service_role=X}
--
-- All 4 RPCs (biz_compute_refund_for_cancel, biz_cancel_trip_booking_begin,
-- biz_cancel_trip_booking_commit, biz_cancel_trip_booking_rollback) were
-- callable by anon via `POST /rest/v1/rpc/<function-name>` directly through
-- PostgREST, bypassing the cancel-trip-booking edge function's auth gate
-- (dual JWT / HMAC-token validation). An anonymous caller knowing only an
-- order UUID could:
--   - Read full refund preview (paid_total_cents, per-PI breakdown, stripe_payment_intent_id)
--   - INVOKE the begin RPC with arbitrary actor_kind/user_id and flip
--     orders.cancelled_at + cancel ALL scheduled installments WITHOUT auth
--   - Mark the refund row succeeded via the commit RPC
--
-- Defense in depth requires:
--   1. REVOKE the 4 RPCs from anon + authenticated (this migration).
--   2. Edge function `cancel-trip-booking` uses service_role to call them
--      (already true per existing implementation — it uses serviceClient()).
--   3. Edge function does its own auth (buyer HMAC token OR operator JWT)
--      before invoking the begin RPC (already true).
--
-- `validate_refund_policy` is IMMUTABLE + pure (no data access). anon EXECUTE
-- on it is safe and is left intact — the client-side RefundPolicyEditor in
-- Phase E may want to call it for inline validation feedback, though even
-- that is preferable to call via authenticated context.
--
-- Codified as I-PROPOSED-TR4-RPC-SERVICE-ROLE-ONLY (a new sub-invariant under
-- the I-PROPOSED-TR4-* family). Tester adversarial in Phase H should include
-- a probe that `POST /rest/v1/rpc/biz_cancel_trip_booking_begin` from an anon
-- client returns 401 or 403 (NOT 200).

BEGIN;

REVOKE EXECUTE ON FUNCTION biz_compute_refund_for_cancel(uuid, timestamptz) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION biz_cancel_trip_booking_begin(uuid, text, uuid, text, timestamptz) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION biz_cancel_trip_booking_commit(uuid, text[], int, timestamptz) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION biz_cancel_trip_booking_rollback(uuid, text) FROM anon, authenticated;

-- Re-confirm service_role still has EXECUTE (idempotent — the parent migration
-- already granted, but defense-in-depth in case Supabase default privileges
-- ever shift).
GRANT EXECUTE ON FUNCTION biz_compute_refund_for_cancel(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION biz_cancel_trip_booking_begin(uuid, text, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION biz_cancel_trip_booking_commit(uuid, text[], int, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION biz_cancel_trip_booking_rollback(uuid, text) TO service_role;

-- Self-verification: after this migration, the ACL for all 4 functions must
-- show ONLY postgres + service_role with EXECUTE (no anon, no authenticated).
DO $verify$
DECLARE
  v_fn text;
  v_acl_text text;
  v_fns text[] := ARRAY[
    'biz_compute_refund_for_cancel',
    'biz_cancel_trip_booking_begin',
    'biz_cancel_trip_booking_commit',
    'biz_cancel_trip_booking_rollback'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    SELECT proacl::text INTO v_acl_text FROM pg_proc WHERE proname = v_fn;
    IF v_acl_text LIKE '%anon=X%' THEN
      RAISE EXCEPTION 'ORCH-0875 hotfix: % still has anon EXECUTE in ACL %', v_fn, v_acl_text;
    END IF;
    IF v_acl_text LIKE '%authenticated=X%' THEN
      RAISE EXCEPTION 'ORCH-0875 hotfix: % still has authenticated EXECUTE in ACL %', v_fn, v_acl_text;
    END IF;
    IF v_acl_text NOT LIKE '%service_role=X%' THEN
      RAISE EXCEPTION 'ORCH-0875 hotfix: % missing service_role EXECUTE in ACL %', v_fn, v_acl_text;
    END IF;
  END LOOP;
  RAISE NOTICE 'ORCH-0875 hotfix complete: 4 RPCs revoked from anon + authenticated, service_role retained.';
END $verify$;

COMMIT;
